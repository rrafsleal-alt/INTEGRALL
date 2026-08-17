import {createHash} from 'node:crypto';
import pg from 'pg';
const {Pool} = pg;

const INVENTORY_COMMIT_STATUSES = new Set(['paid', 'preparing', 'ready', 'completed']);

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Escapa curingas do LIKE (% e _) para que a busca seja literal. */
function likePattern(term) {
  return `%${String(term).replace(/([\\%_])/g, '\\$1')}%`;
}

function customerKey(customer = {}) {
  const email = String(customer.email || '').trim().toLowerCase();
  const phone = digits(customer.phone);
  if (!email && !phone) return '';
  return createHash('sha256').update(`${email}|${phone}`).digest('hex');
}

function customerSnapshot(order) {
  const key = customerKey(order.customer);
  if (!key) return null;
  return {
    key,
    data: {
      name: String(order.customer?.name || ''),
      email: String(order.customer?.email || ''),
      phone: String(order.customer?.phone || ''),
      firstOrderAt: order.createdAt,
      lastOrderAt: order.createdAt,
      lastOrderId: order.id
    }
  };
}

function mergeOrder(current, patch, {source = 'system', note = ''} = {}) {
  const now = new Date().toISOString();
  const next = {...current, ...clone(patch), updatedAt: now};
  if (patch.payment) next.payment = {...(current.payment || {}), ...clone(patch.payment)};
  if (patch.shipping) next.shipping = {...(current.shipping || {}), ...clone(patch.shipping)};
  if (patch.customer) next.customer = {...(current.customer || {}), ...clone(patch.customer)};

  const statusChanged = patch.status && patch.status !== current.status;
  if (statusChanged || note) {
    next.history = Array.isArray(current.history) ? clone(current.history) : [];
    next.history.push({
      at: now,
      status: next.status || current.status,
      source,
      note: String(note || '').slice(0, 500)
    });
  }
  return next;
}

function commitInventory(catalog, order) {
  const nextCatalog = clone(catalog);
  const warnings = [];
  for (const line of order.items || []) {
    const product = nextCatalog.products?.find(item => item.id === line.productId);
    if (!product) {
      warnings.push(`Produto ausente no catálogo: ${line.productId}`);
      continue;
    }
    const qty = Number(line.qty) || 0;
    if (qty <= 0) continue;

    const variant = line.variantId ? (product.variants || []).find(item => item.id === line.variantId) : null;
    if (variant && variant.stock != null) {
      const before = Number(variant.stock);
      if (!Number.isFinite(before)) {
        warnings.push(`Estoque inválido em ${product.name} / ${variant.name}`);
        continue;
      }
      if (before < qty) warnings.push(`Estoque insuficiente ao confirmar pagamento: ${product.name} / ${variant.name}`);
      variant.stock = Math.max(0, before - qty);
      continue;
    }

    if (product.stock != null) {
      const before = Number(product.stock);
      if (!Number.isFinite(before)) {
        warnings.push(`Estoque inválido em ${product.name}`);
        continue;
      }
      if (before < qty) warnings.push(`Estoque insuficiente ao confirmar pagamento: ${product.name}`);
      product.stock = Math.max(0, before - qty);
    }
  }
  return {catalog: nextCatalog, warnings};
}

export class Repository {
  constructor({databaseUrl, initialCatalog, production = false}) {
    this.databaseUrl = databaseUrl;
    this.initialCatalog = initialCatalog;
    this.production = production;
    this.pool = null;
    this.memoryCatalog = clone(initialCatalog);
    this.memoryOrders = new Map();
    this.clientIndex = new Map();
    this.memoryCustomers = new Map();
  }

  get persistent() { return Boolean(this.pool); }

  async init() {
    if (!this.databaseUrl) {
      if (this.production) throw new Error('DATABASE_URL é obrigatório em produção.');
      return;
    }
    this.pool = new Pool({connectionString: this.databaseUrl, ssl: this.production ? {rejectUnauthorized: false} : undefined, max: 10});
    await this.pool.query('SELECT 1');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS integrall_catalog (
        id SMALLINT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT integrall_catalog_singleton CHECK (id = 1)
      );
      CREATE TABLE IF NOT EXISTS integrall_orders (
        id TEXT PRIMARY KEY,
        client_order_id TEXT UNIQUE NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS integrall_orders_created_idx ON integrall_orders (created_at DESC);
      CREATE INDEX IF NOT EXISTS integrall_orders_status_idx ON integrall_orders ((data->>'status'));
      CREATE TABLE IF NOT EXISTS integrall_customers (
        contact_key TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS integrall_customers_updated_idx ON integrall_customers (updated_at DESC);
    `);
    await this.pool.query(
      `INSERT INTO integrall_catalog (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(this.initialCatalog)]
    );
  }

  async getCatalog() {
    if (!this.pool) return clone(this.memoryCatalog);
    const {rows} = await this.pool.query('SELECT data FROM integrall_catalog WHERE id = 1');
    return rows[0]?.data ?? clone(this.initialCatalog);
  }

  async saveCatalog(catalog) {
    if (!this.pool) {
      this.memoryCatalog = clone(catalog);
      return this.getCatalog();
    }
    await this.pool.query(
      `INSERT INTO integrall_catalog (id, data, updated_at) VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [JSON.stringify(catalog)]
    );
    return catalog;
  }

  /**
   * Atualização atômica do catálogo: lê com lock (FOR UPDATE), aplica o
   * `mutator` sobre o estado MAIS RECENTE e salva na mesma transação.
   * Elimina a corrida ler→modificar→salvar entre edições do Admin e a baixa
   * de estoque dos webhooks/pedidos (que também trava a linha do catálogo).
   * O mutator recebe o catálogo atual e retorna o próximo (ou lança para abortar).
   */
  async mutateCatalog(mutator) {
    if (!this.pool) {
      const next = await mutator(clone(this.memoryCatalog));
      this.memoryCatalog = clone(next);
      return this.getCatalog();
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows} = await client.query('SELECT data FROM integrall_catalog WHERE id = 1 FOR UPDATE');
      const current = rows[0]?.data ?? clone(this.initialCatalog);
      const next = await mutator(current);
      await client.query(
        `INSERT INTO integrall_catalog (id, data, updated_at) VALUES (1, $1::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [JSON.stringify(next)]
      );
      await client.query('COMMIT');
      return next;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async getOrder(id) {
    if (!this.pool) return this.memoryOrders.has(id) ? clone(this.memoryOrders.get(id)) : null;
    const {rows} = await this.pool.query('SELECT data FROM integrall_orders WHERE id = $1', [id]);
    return rows[0]?.data ?? null;
  }

  async getOrderByClientId(clientOrderId) {
    if (!this.pool) {
      const id = this.clientIndex.get(clientOrderId);
      return id ? this.getOrder(id) : null;
    }
    const {rows} = await this.pool.query('SELECT data FROM integrall_orders WHERE client_order_id = $1', [clientOrderId]);
    return rows[0]?.data ?? null;
  }

  upsertMemoryCustomer(order) {
    const snapshot = customerSnapshot(order);
    if (!snapshot) return;
    const existing = this.memoryCustomers.get(snapshot.key);
    this.memoryCustomers.set(snapshot.key, {
      ...(existing || {}),
      ...snapshot.data,
      firstOrderAt: existing?.firstOrderAt || snapshot.data.firstOrderAt,
      lastOrderAt: order.createdAt,
      lastOrderId: order.id
    });
  }

  async createOrder(order) {
    const existing = await this.getOrderByClientId(order.clientOrderId);
    if (existing) return {order: existing, created: false};

    if (!this.pool) {
      this.memoryOrders.set(order.id, clone(order));
      this.clientIndex.set(order.clientOrderId, order.id);
      this.upsertMemoryCustomer(order);
      return {order: clone(order), created: true};
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO integrall_orders (id, client_order_id, data, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $4)`,
        [order.id, order.clientOrderId, JSON.stringify(order), order.createdAt]
      );
      const snapshot = customerSnapshot(order);
      if (snapshot) {
        await client.query(
          `INSERT INTO integrall_customers (contact_key, data, created_at, updated_at)
           VALUES ($1, $2::jsonb, $3, $3)
           ON CONFLICT (contact_key) DO UPDATE SET
             data = jsonb_set(
               jsonb_set(
                 jsonb_set(EXCLUDED.data, '{firstOrderAt}', COALESCE(integrall_customers.data->'firstOrderAt', EXCLUDED.data->'firstOrderAt')),
                 '{lastOrderAt}', EXCLUDED.data->'lastOrderAt'
               ),
               '{lastOrderId}', EXCLUDED.data->'lastOrderId'
             ),
             updated_at = NOW()`,
          [snapshot.key, JSON.stringify(snapshot.data), order.createdAt]
        );
      }
      await client.query('COMMIT');
      return {order, created: true};
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      if (error?.code === '23505') {
        const duplicate = await this.getOrderByClientId(order.clientOrderId);
        if (duplicate) return {order: duplicate, created: false};
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateOrder(id, patch, options = {}) {
    if (!this.pool) {
      const current = await this.getOrder(id);
      if (!current) return null;
      let next = mergeOrder(current, patch, options);
      if (!current.inventoryCommittedAt && INVENTORY_COMMIT_STATUSES.has(next.status)) {
        const result = commitInventory(this.memoryCatalog, next);
        this.memoryCatalog = result.catalog;
        next.inventoryCommittedAt = new Date().toISOString();
        if (result.warnings.length) next.inventoryWarnings = result.warnings;
      }
      this.memoryOrders.set(id, clone(next));
      return clone(next);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows} = await client.query('SELECT data FROM integrall_orders WHERE id = $1 FOR UPDATE', [id]);
      const current = rows[0]?.data;
      if (!current) {
        await client.query('ROLLBACK');
        return null;
      }
      let next = mergeOrder(current, patch, options);

      if (!current.inventoryCommittedAt && INVENTORY_COMMIT_STATUSES.has(next.status)) {
        const catalogResult = await client.query('SELECT data FROM integrall_catalog WHERE id = 1 FOR UPDATE');
        const catalog = catalogResult.rows[0]?.data ?? clone(this.initialCatalog);
        const result = commitInventory(catalog, next);
        await client.query('UPDATE integrall_catalog SET data = $1::jsonb, updated_at = NOW() WHERE id = 1', [JSON.stringify(result.catalog)]);
        next.inventoryCommittedAt = new Date().toISOString();
        if (result.warnings.length) next.inventoryWarnings = result.warnings;
      }

      await client.query('UPDATE integrall_orders SET data = $2::jsonb, updated_at = NOW() WHERE id = $1', [id, JSON.stringify(next)]);
      await client.query('COMMIT');
      return next;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async listOrders({status = '', search = '', limit = 300} = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 300));
    const normalizedStatus = String(status || '').trim();
    const q = String(search || '').toLowerCase().trim();
    if (!this.pool) {
      return [...this.memoryOrders.values()]
        .map(order => clone(order))
        .filter(order => !normalizedStatus || order.status === normalizedStatus)
        .filter(order => !q || `${order.id} ${order.clientOrderId} ${order.customer?.name || ''} ${order.customer?.email || ''} ${order.customer?.phone || ''}`.toLowerCase().includes(q))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, safeLimit);
    }

    const pattern = q ? likePattern(q) : '';
    const {rows} = await this.pool.query(
      `SELECT data
         FROM integrall_orders
        WHERE ($1 = '' OR data->>'status' = $1)
          AND ($2 = '' OR LOWER(CONCAT_WS(' ',
                id,
                client_order_id,
                COALESCE(data #>> '{customer,name}', ''),
                COALESCE(data #>> '{customer,email}', ''),
                COALESCE(data #>> '{customer,phone}', '')
              )) LIKE $2)
        ORDER BY created_at DESC
        LIMIT $3`,
      [normalizedStatus, pattern, safeLimit]
    );
    return rows.map(row => row.data);
  }

  async listCustomers({search = '', limit = 300} = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 300));
    const q = String(search || '').toLowerCase().trim();
    if (!this.pool) {
      return [...this.memoryCustomers.values()]
        .map(customer => clone(customer))
        .filter(customer => !q || `${customer.name || ''} ${customer.email || ''} ${customer.phone || ''}`.toLowerCase().includes(q))
        .sort((a, b) => String(b.lastOrderAt || '').localeCompare(String(a.lastOrderAt || '')))
        .slice(0, safeLimit);
    }
    const pattern = q ? likePattern(q) : '';
    const {rows} = await this.pool.query(
      `SELECT data FROM integrall_customers
       WHERE ($1 = '' OR LOWER(CONCAT_WS(' ', COALESCE(data->>'name',''), COALESCE(data->>'email',''), COALESCE(data->>'phone',''))) LIKE $1)
       ORDER BY updated_at DESC
       LIMIT $2`,
      [pattern, safeLimit]
    );
    return rows.map(row => row.data);
  }

  /**
   * Cancela pedidos sem pagamento criados há mais de `days` dias.
   * Considera apenas estados pré-financeiros; nunca toca pedidos pagos.
   */
  async expireStaleOrders(days) {
    const cutoffMs = Number(days) * 86_400_000;
    if (!Number.isFinite(cutoffMs) || cutoffMs <= 0) return [];
    const cutoff = new Date(Date.now() - cutoffMs).toISOString();
    const staleStatuses = ['received', 'awaiting_payment', 'payment_failed', 'payment_expired'];
    const expired = [];

    if (!this.pool) {
      for (const [id, order] of this.memoryOrders) {
        if (staleStatuses.includes(order.status) && String(order.createdAt) < cutoff) {
          const next = await this.updateOrder(id, {status: 'cancelled'}, {source: 'system', note: `Pedido cancelado automaticamente após ${days} dia(s) sem pagamento.`});
          if (next) expired.push(next.id);
        }
      }
      return expired;
    }

    const {rows} = await this.pool.query(
      `SELECT id FROM integrall_orders
        WHERE data->>'status' = ANY($1)
          AND created_at < $2
        LIMIT 200`,
      [staleStatuses, cutoff]
    );
    for (const row of rows) {
      const next = await this.updateOrder(row.id, {status: 'cancelled'}, {source: 'system', note: `Pedido cancelado automaticamente após ${days} dia(s) sem pagamento.`});
      if (next) expired.push(next.id);
    }
    return expired;
  }

  async health() {
    if (!this.pool) return {ok: true, mode: 'memory-development-only'};
    await this.pool.query('SELECT 1');
    return {ok: true, mode: 'postgresql'};
  }

  async close() {
    await this.pool?.end();
  }
}
