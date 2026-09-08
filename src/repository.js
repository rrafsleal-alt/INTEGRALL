import {createHash, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile} from 'node:fs/promises';
import {atomicWriteJson} from './local-state.js';
import path from 'node:path';
import {runMigrations} from './migrations.js';
import {LocalMediaStorage, MemoryMediaStorage, PostgresMediaStorage} from './media-storage.js';
import {reserveInventory, releaseInventory, commitInventory} from './inventory-reservation.js';
import {normalizeCatalog} from './catalog.js';

const INVENTORY_COMMIT_STATUSES = new Set(['paid', 'preparing', 'ready', 'completed']);
const INVENTORY_RELEASE_STATUSES = new Set(['payment_expired', 'cancelled']);
const RESERVATION_OPEN_STATUSES = new Set(['received', 'awaiting_payment', 'payment_failed']);

function postgresSsl(mode, ca = '') {
  const normalized = String(mode || '').toLowerCase();
  if (normalized === 'disable') return undefined;
  if (normalized === 'require') return {rejectUnauthorized: false};
  return {rejectUnauthorized: true, ...(ca ? {ca} : {})};
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function constantTimeStringEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

async function rollbackTransaction(client, context) {
  try {
    await client.query('ROLLBACK');
  } catch (error) {
    console.error(JSON.stringify({level: 'error', event: 'database_rollback_failed', context, message: String(error?.message || error).slice(0, 500)}));
  }
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
    // Cap do histórico: webhooks repetidos/edições não podem inflar o JSONB
    // indefinidamente. 100 eventos cobrem qualquer ciclo de vida real.
    if (next.history.length > 100) next.history = next.history.slice(-100);
  }
  return next;
}


export class Repository {
  constructor({databaseUrl, initialCatalog, production = false, localDataDir = '', databaseSslMode = 'disable', databaseCa = '', migrationsDir = '', inventoryReservationMinutes = 15, packagedMediaDir = ''}) {
    this.databaseUrl = databaseUrl;
    this.initialCatalog = initialCatalog;
    this.production = production;
    this.localDataDir = String(localDataDir || '').trim();
    this.databaseSslMode = String(databaseSslMode || (production ? 'verify-full' : 'disable'));
    this.databaseCa = String(databaseCa || '');
    this.migrationsDir = String(migrationsDir || path.join(process.cwd(), 'migrations'));
    this.inventoryReservationMinutes = Math.max(5, Math.min(120, Number(inventoryReservationMinutes) || 15));
    this.pool = null;
    this.mediaStorage = null;
    this.packagedMedia = packagedMediaDir ? new LocalMediaStorage(packagedMediaDir) : null;
    this.memoryTransaction = false;
    this.memoryCatalog = clone(initialCatalog);
    this.memoryOrders = new Map();
    this.clientIndex = new Map();
    this.memoryCustomers = new Map();
    this.memoryAudit = [];
    this.memoryCustomerAccounts = new Map();
    this.memoryLoginCodes = new Map();
    this.memoryCustomerSessions = new Map();
    this.memoryAdminSessions = new Map();
    this.memoryReviews = new Map();
    this.memoryRestockSubscriptions = new Map();
    this.memoryRestockLocks = new Set();
    this.memoryWriteTail = Promise.resolve();
  }

  // One durable snapshot is the commit point: orders and inventory never diverge.
  localSnapshot() {
    return clone({formatVersion: 1, catalog: this.memoryCatalog,
      orders: [...this.memoryOrders], customers: [...this.memoryCustomers],
      customerAccounts: [...this.memoryCustomerAccounts], audit: this.memoryAudit,
      reviews: [...this.memoryReviews], restockSubscriptions: [...this.memoryRestockSubscriptions]});
  }

  restoreLocalSnapshot(saved) {
    if (saved?.formatVersion !== 1 || !Array.isArray(saved.catalog?.products)) {
      throw new Error('Estado local inválido. Preserve os arquivos e restaure um backup; não reinicialize o estoque.');
    }
    for (const field of ['orders', 'customers', 'customerAccounts', 'reviews', 'restockSubscriptions']) {
      if (!Array.isArray(saved[field]) || saved[field].some(entry => !Array.isArray(entry) || entry.length !== 2)) {
        throw new Error(`Estado local inválido: ${field}.`);
      }
    }
    if (!Array.isArray(saved.audit)) throw new Error('Estado local inválido: audit.');
    this.memoryCatalog = clone(saved.catalog);
    this.memoryOrders = new Map(saved.orders);
    this.clientIndex = new Map([...this.memoryOrders.values()].map(order => [order.clientOrderId, order.id]));
    this.memoryCustomers = new Map(saved.customers);
    this.memoryCustomerAccounts = new Map(saved.customerAccounts);
    this.memoryReviews = new Map(saved.reviews);
    this.memoryRestockSubscriptions = new Map(saved.restockSubscriptions);
    this.memoryAudit = clone(saved.audit);
  }

  async withMemoryWriteLock(task) {
    const previous = this.memoryWriteTail;
    let release;
    this.memoryWriteTail = new Promise(resolve => { release = resolve; });
    await previous;
    const before = this.localSnapshot();
    this.memoryTransaction = true;
    try {
      const result = await task();
      await this.persistLocalState();
      return result;
    } catch (error) {
      this.restoreLocalSnapshot(before);
      throw error;
    } finally {
      this.memoryTransaction = false;
      release();
    }
  }

  async persistLocalState() {
    if (!this.localDataDir || this.pool) return;
    await atomicWriteJson(path.join(this.localDataDir, 'state.json'), this.localSnapshot());
    // Compatibility export only; state.json remains authoritative on restart.
    try { await atomicWriteJson(path.join(this.localDataDir, 'catalog.json'), this.memoryCatalog); }
    catch (error) { console.warn('[local-state] estado salvo; exportação do catálogo pendente:', error.message); }
  }

  get persistent() { return Boolean(this.pool); }

  async init() {
    if (!this.databaseUrl) {
      if (this.production) throw new Error('DATABASE_URL é obrigatório em produção.');
      if (this.localDataDir) {
        await mkdir(path.join(this.localDataDir, 'media'), {recursive: true});
        let savedState;
        try { savedState = JSON.parse(await readFile(path.join(this.localDataDir, 'state.json'), 'utf8')); }
        catch (error) { if (error?.code !== 'ENOENT') throw error; }
        if (savedState !== undefined) {
          this.restoreLocalSnapshot(savedState);
          this.memoryCatalog = normalizeCatalog(this.memoryCatalog);
        } else {
          try {
            const saved = JSON.parse(await readFile(path.join(this.localDataDir, 'catalog.json'), 'utf8'));
            if (!Array.isArray(saved?.products)) throw new Error('Catálogo local inválido.');
            this.memoryCatalog = normalizeCatalog(saved);
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
          }
        }
        await this.persistLocalState();
        this.mediaStorage = new LocalMediaStorage(path.join(this.localDataDir, 'media'));
      } else {
        this.mediaStorage = new MemoryMediaStorage();
      }
      await this.mediaStorage.init();
      return;
    }

    let pg;
    try { ({default: pg} = await import('pg')); }
    catch (error) {
      throw Object.assign(new Error('A dependência pg é obrigatória quando DATABASE_URL está configurada.'), {code: 'PG_DEPENDENCY_MISSING', cause: error});
    }
    this.pool = new pg.Pool({
      connectionString: this.databaseUrl,
      ssl: postgresSsl(this.databaseSslMode, this.databaseCa),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'integrall-online'
    });
    await this.pool.query('SELECT 1');
    await runMigrations(this.pool, this.migrationsDir);
    this.mediaStorage = new PostgresMediaStorage(this.pool);
    await this.mediaStorage.init();
    await this.pool.query(
      `INSERT INTO integrall_catalog (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(this.initialCatalog)]
    );
    // Catálogos persistidos por versões anteriores podem não conter slugs ou
    // campos novos. Normaliza uma vez no boot, preservando dados compatíveis e
    // tornando a migração de versão explícita antes de servir qualquer rota.
    const {rows: catalogRows} = await this.pool.query('SELECT data FROM integrall_catalog WHERE id = 1');
    const persisted = catalogRows[0]?.data ?? this.initialCatalog;
    const normalized = normalizeCatalog(persisted);
    if (JSON.stringify(persisted) !== JSON.stringify(normalized)) {
      await this.pool.query('UPDATE integrall_catalog SET data = $1::jsonb, updated_at = NOW() WHERE id = 1', [JSON.stringify(normalized)]);
    }
  }

  async persistLocalCatalog() {
    if (!this.memoryTransaction) await this.persistLocalState();
  }

  async getCatalog() {
    if (!this.pool) return clone(this.memoryCatalog);
    const {rows} = await this.pool.query('SELECT data FROM integrall_catalog WHERE id = 1');
    return rows[0]?.data ?? clone(this.initialCatalog);
  }

  async saveCatalog(catalog) {
    if (!this.pool) return this.withMemoryWriteLock(async () => {
      this.memoryCatalog = clone(catalog);
      return clone(this.memoryCatalog);
    });
    await this.pool.query(
      `INSERT INTO integrall_catalog (id, data, updated_at) VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [JSON.stringify(catalog)]
    );
    return catalog;
  }

  /** Atualiza o catálogo atomicamente sobre o estado mais recente. */
  async mutateCatalog(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('mutator precisa ser uma função.');
    if (!this.pool) return this.withMemoryWriteLock(async () => {
      const next = await mutator(clone(this.memoryCatalog));
      if (!next || typeof next !== 'object') throw new Error('A mutação do catálogo não retornou um catálogo válido.');
      this.memoryCatalog = clone(next);
      await this.persistLocalCatalog();
      return clone(this.memoryCatalog);
    });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows} = await client.query('SELECT data FROM integrall_catalog WHERE id = 1 FOR UPDATE');
      const current = rows[0]?.data ?? clone(this.initialCatalog);
      const next = await mutator(current);
      if (!next || typeof next !== 'object') throw new Error('A mutação do catálogo não retornou um catálogo válido.');
      await client.query(
        `INSERT INTO integrall_catalog (id, data, updated_at) VALUES (1, $1::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [JSON.stringify(next)]
      );
      await client.query('COMMIT');
      return next;
    } catch (error) {
      await rollbackTransaction(client, 'catalog_mutation');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveMedia(media) {
    if (!this.mediaStorage) throw new Error('Armazenamento de mídia não inicializado.');
    return this.mediaStorage.save(media);
  }

  async getMedia(id) {
    const current = this.mediaStorage ? await this.mediaStorage.get(id) : null;
    // Immutable packaged recovery assets survive clean deploys and an empty DB.
    return current || (this.packagedMedia ? this.packagedMedia.get(id) : null);
  }

  async listMedia(options = {}) {
    if (!this.mediaStorage) return [];
    return this.mediaStorage.list(options);
  }

  async deleteMedia(id) {
    if (!this.mediaStorage) return false;
    return this.mediaStorage.delete(id);
  }

  async recordAudit({requestId = '', actor = 'system', role = '', action, entityType, entityId = '', metadata = {}}) {
    const entry = {
      requestId: String(requestId || '').slice(0, 120),
      actor: String(actor || 'system').slice(0, 254),
      role: String(role || '').slice(0, 40),
      action: String(action || '').slice(0, 120),
      entityType: String(entityType || '').slice(0, 120),
      entityId: String(entityId || '').slice(0, 180),
      metadata: clone(metadata && typeof metadata === 'object' ? metadata : {}),
      createdAt: new Date().toISOString()
    };
    if (!entry.action || !entry.entityType) return null;
    if (!this.pool) return this.withMemoryWriteLock(async () => {
      this.memoryAudit.push(entry);
      if (this.memoryAudit.length > 2000) this.memoryAudit.splice(0, this.memoryAudit.length - 2000);
      return clone(entry);
    });
    const {rows} = await this.pool.query(
      `INSERT INTO integrall_audit_log (request_id, actor, role, action, entity_type, entity_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING id, created_at`,
      [entry.requestId, entry.actor, entry.role, entry.action, entry.entityType, entry.entityId, JSON.stringify(entry.metadata)]
    );
    return {...entry, id: rows[0]?.id, createdAt: rows[0]?.created_at?.toISOString?.() || rows[0]?.created_at};
  }

  async listAudit({limit = 100} = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    if (!this.pool) return clone(this.memoryAudit.slice(-safeLimit).reverse());
    const {rows} = await this.pool.query(
      `SELECT id, request_id, actor, role, action, entity_type, entity_id, metadata, created_at
         FROM integrall_audit_log ORDER BY created_at DESC LIMIT $1`,
      [safeLimit]
    );
    return rows.map(row => ({
      id: row.id,
      requestId: row.request_id,
      actor: row.actor,
      role: row.role,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata: row.metadata,
      createdAt: row.created_at?.toISOString?.() || row.created_at
    }));
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
    if (!this.pool) return this.withMemoryWriteLock(async () => {
      const existingId = this.clientIndex.get(order.clientOrderId);
      if (existingId && this.memoryOrders.has(existingId)) return {order: clone(this.memoryOrders.get(existingId)), created: false};
      const reserved = reserveInventory(this.memoryCatalog, order, this.inventoryReservationMinutes);
      this.memoryCatalog = reserved.catalog;
      await this.persistLocalCatalog();
      const nextOrder = reserved.order;
      this.memoryOrders.set(nextOrder.id, clone(nextOrder));
      this.clientIndex.set(nextOrder.clientOrderId, nextOrder.id);
      this.upsertMemoryCustomer(nextOrder);
      return {order: clone(nextOrder), created: true};
    });

    const existing = await this.getOrderByClientId(order.clientOrderId);
    if (existing) return {order: existing, created: false};

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serializa retries concorrentes do MESMO clientOrderId antes de tocar
      // no catálogo. Um SELECT ... FOR UPDATE não bloqueia uma linha que ainda
      // não existe; sem este advisory lock duas transações poderiam observar
      // ausência, a primeira reservar a última unidade e a segunda responder
      // OUT_OF_STOCK em vez de reconhecer o retry idempotente. O lock é
      // transacional, portanto é liberado automaticamente no COMMIT/ROLLBACK.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`integrall-order:${order.clientOrderId}`]);
      const duplicateResult = await client.query('SELECT data FROM integrall_orders WHERE client_order_id = $1 FOR UPDATE', [order.clientOrderId]);
      if (duplicateResult.rows[0]?.data) {
        await client.query('ROLLBACK');
        return {order: duplicateResult.rows[0].data, created: false};
      }
      const catalogResult = await client.query('SELECT data FROM integrall_catalog WHERE id = 1 FOR UPDATE');
      const catalog = catalogResult.rows[0]?.data ?? clone(this.initialCatalog);
      const reserved = reserveInventory(catalog, order, this.inventoryReservationMinutes);
      const nextOrder = reserved.order;
      await client.query('UPDATE integrall_catalog SET data = $1::jsonb, updated_at = NOW() WHERE id = 1', [JSON.stringify(reserved.catalog)]);
      await client.query(
        `INSERT INTO integrall_orders (id, client_order_id, data, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $4)`,
        [nextOrder.id, nextOrder.clientOrderId, JSON.stringify(nextOrder), nextOrder.createdAt]
      );
      const snapshot = customerSnapshot(nextOrder);
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
          [snapshot.key, JSON.stringify(snapshot.data), nextOrder.createdAt]
        );
      }
      await client.query('COMMIT');
      return {order: nextOrder, created: true};
    } catch (error) {
      await rollbackTransaction(client, 'order_creation');
      if (error?.code === '23505') {
        const duplicate = await this.getOrderByClientId(order.clientOrderId);
        if (duplicate) return {order: duplicate, created: false};
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Atualiza um pedido com lock (FOR UPDATE).
   * `patch` pode ser um objeto OU uma função (currentFresh) => patch | null.
   * A forma funcional é avaliada DENTRO do lock, sobre o estado mais recente —
   * obrigatória para decisões dependentes de estado (ex.: webhook de
   * pagamento), eliminando TOCTOU entre ler o pedido e gravar a decisão.
   * Retornar null da função aborta sem gravar (retorna o estado atual).
   */
  async updateOrder(id, patch, options = {}) {
    const resolvePatch = current => (typeof patch === 'function' ? patch(current) : patch);
    const shouldRelease = (current, next) => Boolean(current.inventoryReservedAt && !current.inventoryCommittedAt && !current.inventoryReservationReleasedAt && INVENTORY_RELEASE_STATUSES.has(next.status));
    const shouldCommitReserved = (current, next) => Boolean(current.inventoryReservedAt && !current.inventoryReservationReleasedAt && !current.inventoryCommittedAt && INVENTORY_COMMIT_STATUSES.has(next.status));
    const shouldRecommitReleased = (current, next) => Boolean(current.inventoryReservedAt && current.inventoryReservationReleasedAt && !current.inventoryCommittedAt && INVENTORY_COMMIT_STATUSES.has(next.status));
    if (!this.pool) return this.withMemoryWriteLock(async () => {
      const current = this.memoryOrders.has(id) ? clone(this.memoryOrders.get(id)) : null;
      if (!current) return null;
      const resolved = resolvePatch(current);
      if (resolved == null) return clone(current);
      let next = mergeOrder(current, resolved, typeof options === 'function' ? options(current) : options);
      if (shouldRelease(current, next)) {
        const result = releaseInventory(this.memoryCatalog, current);
        this.memoryCatalog = result.catalog;
        await this.persistLocalCatalog();
        next.inventoryReservationReleasedAt = new Date().toISOString();
        if (result.warnings.length) next.inventoryWarnings = [...(next.inventoryWarnings || []), ...result.warnings].slice(-50);
      } else if (shouldCommitReserved(current, next)) {
        next.inventoryCommittedAt = new Date().toISOString();
      } else if (shouldRecommitReleased(current, next) || (!current.inventoryReservedAt && !current.inventoryCommittedAt && INVENTORY_COMMIT_STATUSES.has(next.status))) {
        const result = commitInventory(this.memoryCatalog, next, {strict: true});
        this.memoryCatalog = result.catalog;
        await this.persistLocalCatalog();
        next.inventoryCommittedAt = new Date().toISOString();
        if (result.warnings.length) next.inventoryWarnings = result.warnings;
      }
      this.memoryOrders.set(id, clone(next));
      return clone(next);
    });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows} = await client.query('SELECT data FROM integrall_orders WHERE id = $1 FOR UPDATE', [id]);
      const current = rows[0]?.data;
      if (!current) { await client.query('ROLLBACK'); return null; }
      const resolved = resolvePatch(current);
      if (resolved == null) { await client.query('ROLLBACK'); return current; }
      let next = mergeOrder(current, resolved, typeof options === 'function' ? options(current) : options);

      if (shouldRelease(current, next) || shouldCommitReserved(current, next) || shouldRecommitReleased(current, next) || (!current.inventoryReservedAt && !current.inventoryCommittedAt && INVENTORY_COMMIT_STATUSES.has(next.status))) {
        if (shouldRelease(current, next)) {
          const catalogResult = await client.query('SELECT data FROM integrall_catalog WHERE id = 1 FOR UPDATE');
          const catalog = catalogResult.rows[0]?.data ?? clone(this.initialCatalog);
          const result = releaseInventory(catalog, current);
          await client.query('UPDATE integrall_catalog SET data = $1::jsonb, updated_at = NOW() WHERE id = 1', [JSON.stringify(result.catalog)]);
          next.inventoryReservationReleasedAt = new Date().toISOString();
          if (result.warnings.length) next.inventoryWarnings = [...(next.inventoryWarnings || []), ...result.warnings].slice(-50);
        } else if (shouldCommitReserved(current, next)) {
          next.inventoryCommittedAt = new Date().toISOString();
        } else {
          const catalogResult = await client.query('SELECT data FROM integrall_catalog WHERE id = 1 FOR UPDATE');
          const catalog = catalogResult.rows[0]?.data ?? clone(this.initialCatalog);
          const result = commitInventory(catalog, next, {strict: true});
          await client.query('UPDATE integrall_catalog SET data = $1::jsonb, updated_at = NOW() WHERE id = 1', [JSON.stringify(result.catalog)]);
          next.inventoryCommittedAt = new Date().toISOString();
          if (result.warnings.length) next.inventoryWarnings = result.warnings;
        }
      }

      await client.query('UPDATE integrall_orders SET data = $2::jsonb, updated_at = NOW() WHERE id = $1', [id, JSON.stringify(next)]);
      await client.query('COMMIT');
      return next;
    } catch (error) {
      await rollbackTransaction(client, 'order_update');
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

    // Patch FUNCIONAL: reconfirma o status DENTRO do lock. Sem isso, um
    // webhook poderia marcar o pedido como pago entre o SELECT e o UPDATE,
    // e o cancelamento automático sobrescreveria um pedido pago (TOCTOU).
    // O flag `applied` (por pedido) distingue "cancelei agora" de "já estava
    // em outro estado" — evita e-mail de expiração duplicado/indevido.
    const auditNote = {source: 'system', note: `Pedido cancelado automaticamente após ${days} dia(s) sem pagamento.`};
    const expireOne = async id => {
      let applied = false;
      const next = await this.updateOrder(id, current => {
        if (staleStatuses.includes(current.status) && String(current.createdAt) < cutoff) {
          applied = true;
          return {status: 'cancelled'};
        }
        return null;
      }, auditNote);
      if (next && applied) expired.push(next);
    };

    if (!this.pool) {
      for (const [id, order] of this.memoryOrders) {
        if (staleStatuses.includes(order.status) && String(order.createdAt) < cutoff) await expireOne(id);
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
    for (const row of rows) await expireOne(row.id);
    return expired;
  }

  async releaseExpiredReservations() {
    const expired = [];
    const now = new Date().toISOString();
    const releaseOne = async id => {
      let applied = false;
      const next = await this.updateOrder(id, current => {
        if (current.inventoryReservedAt && !current.inventoryCommittedAt && !current.inventoryReservationReleasedAt && RESERVATION_OPEN_STATUSES.has(current.status) && String(current.inventoryReservationExpiresAt || '') <= now) {
          applied = true;
          return {status: 'payment_expired'};
        }
        return null;
      }, {source: 'system', note: 'Reserva de estoque expirada e unidades devolvidas ao catálogo.'});
      if (next && applied) expired.push(next);
    };
    if (!this.pool) {
      for (const [id, order] of this.memoryOrders) {
        if (order.inventoryReservationExpiresAt && String(order.inventoryReservationExpiresAt) <= now) await releaseOne(id);
      }
      return expired;
    }
    const {rows} = await this.pool.query(
      `SELECT id FROM integrall_orders
       WHERE COALESCE(data->>'inventoryReservedAt','') <> ''
         AND COALESCE(data->>'inventoryCommittedAt','') = ''
         AND COALESCE(data->>'inventoryReservationReleasedAt','') = ''
         AND data->>'status' = ANY($1)
         AND data->>'inventoryReservationExpiresAt' <= $2
       LIMIT 300`,
      [[...RESERVATION_OPEN_STATUSES], now]
    );
    for (const row of rows) await releaseOne(row.id);
    return expired;
  }

  async ensureCustomerAccount(email) {
    const key = String(email || '').trim().toLowerCase();
    if (!key) return null;
    if (!this.pool) return this.withMemoryWriteLock(async () => {
      const existing = this.memoryCustomerAccounts.get(key) || {email: key, name: '', phone: '', addresses: [], favorites: [], createdAt: new Date().toISOString()};
      this.memoryCustomerAccounts.set(key, clone(existing));
      return clone(existing);
    });
    const seed = {email: key, name: '', phone: '', addresses: [], favorites: []};
    const {rows} = await this.pool.query(
      `INSERT INTO integrall_customer_accounts (email, data) VALUES ($1,$2::jsonb)
       ON CONFLICT (email) DO UPDATE SET updated_at = integrall_customer_accounts.updated_at
       RETURNING data, created_at, updated_at`, [key, JSON.stringify(seed)]);
    return {...rows[0].data, email: key, createdAt: rows[0].created_at?.toISOString?.() || rows[0].created_at, updatedAt: rows[0].updated_at?.toISOString?.() || rows[0].updated_at};
  }

  async getCustomerAccount(email) {
    const key = String(email || '').trim().toLowerCase();
    if (!key) return null;
    if (!this.pool) return this.memoryCustomerAccounts.has(key) ? clone(this.memoryCustomerAccounts.get(key)) : null;
    const {rows} = await this.pool.query('SELECT data, created_at, updated_at FROM integrall_customer_accounts WHERE email=$1', [key]);
    return rows[0] ? {...rows[0].data, email: key, createdAt: rows[0].created_at?.toISOString?.() || rows[0].created_at, updatedAt: rows[0].updated_at?.toISOString?.() || rows[0].updated_at} : null;
  }

  async saveCustomerAccount(email, data) {
    const key = String(email || '').trim().toLowerCase();
    if (!key) return null;
    const next = {...clone(data || {}), email: key};
    if (!this.pool) return this.withMemoryWriteLock(async () => { this.memoryCustomerAccounts.set(key, next); return clone(next); });
    const {rows} = await this.pool.query(
      `INSERT INTO integrall_customer_accounts (email,data,updated_at) VALUES ($1,$2::jsonb,NOW())
       ON CONFLICT (email) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()
       RETURNING data,created_at,updated_at`, [key, JSON.stringify(next)]);
    return {...rows[0].data, email: key, createdAt: rows[0].created_at?.toISOString?.() || rows[0].created_at, updatedAt: rows[0].updated_at?.toISOString?.() || rows[0].updated_at};
  }

  async updateCustomerAccount(email, updater) {
    const key = String(email || '').trim().toLowerCase();
    if (!key || typeof updater !== 'function') return null;

    if (!this.pool) {
      return this.withMemoryWriteLock(async () => {
        const current = this.memoryCustomerAccounts.get(key) || {
          email: key, name: '', phone: '', addresses: [], favorites: [], createdAt: new Date().toISOString()
        };
        const produced = await updater(clone(current));
        const next = {...clone(produced || current), email: key};
        this.memoryCustomerAccounts.set(key, next);
        return clone(next);
      });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let {rows} = await client.query(
        'SELECT data,created_at,updated_at FROM integrall_customer_accounts WHERE email=$1 FOR UPDATE',
        [key]
      );
      if (!rows[0]) {
        const seed = {email: key, name: '', phone: '', addresses: [], favorites: []};
        await client.query(
          'INSERT INTO integrall_customer_accounts (email,data) VALUES ($1,$2::jsonb) ON CONFLICT (email) DO NOTHING',
          [key, JSON.stringify(seed)]
        );
        ({rows} = await client.query(
          'SELECT data,created_at,updated_at FROM integrall_customer_accounts WHERE email=$1 FOR UPDATE',
          [key]
        ));
      }
      const row = rows[0];
      const current = row ? {...row.data, email: key} : {email: key, name: '', phone: '', addresses: [], favorites: []};
      const produced = await updater(clone(current));
      const next = {...clone(produced || current), email: key};
      const updated = await client.query(
        `UPDATE integrall_customer_accounts SET data=$2::jsonb,updated_at=NOW() WHERE email=$1
         RETURNING data,created_at,updated_at`,
        [key, JSON.stringify(next)]
      );
      await client.query('COMMIT');
      const saved = updated.rows[0];
      return {...saved.data, email: key, createdAt: saved.created_at?.toISOString?.() || saved.created_at, updatedAt: saved.updated_at?.toISOString?.() || saved.updated_at};
    } catch (error) {
      await rollbackTransaction(client, 'updateCustomerAccount');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveCustomerLoginCode({email, codeHash, expiresAt}) {
    const record = {email, codeHash, expiresAt, attempts: 0};
    if (!this.pool) { this.memoryLoginCodes.set(email, record); return clone(record); }
    await this.pool.query(`INSERT INTO integrall_customer_login_codes(email,code_hash,expires_at,attempts,created_at) VALUES($1,$2,$3,0,NOW()) ON CONFLICT(email) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,attempts=0,created_at=NOW()`, [email, codeHash, expiresAt]);
    return record;
  }
  async getCustomerLoginCode(email) {
    if (!this.pool) return this.memoryLoginCodes.has(email) ? clone(this.memoryLoginCodes.get(email)) : null;
    const {rows} = await this.pool.query('SELECT email,code_hash,expires_at,attempts FROM integrall_customer_login_codes WHERE email=$1', [email]);
    return rows[0] ? {email: rows[0].email, codeHash: rows[0].code_hash, expiresAt: rows[0].expires_at?.toISOString?.() || rows[0].expires_at, attempts: rows[0].attempts} : null;
  }
  async consumeCustomerLoginCode(email, candidateHash) {
    const key = String(email || '').trim().toLowerCase();
    const candidate = String(candidateHash || '');
    if (!key || !candidate) return false;

    if (!this.pool) {
      // Não há await entre a leitura e a mutação: no repositório em memória,
      // o consumo é atômico dentro do event loop e um código só autentica uma vez.
      const record = this.memoryLoginCodes.get(key);
      const expiresAt = Date.parse(record?.expiresAt), attempts = Number(record?.attempts);
      if (!record || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || !Number.isInteger(attempts) || attempts < 0 || attempts >= 5) return false;
      if (!constantTimeStringEqual(record.codeHash, candidate)) {
        record.attempts = Number(record.attempts || 0) + 1;
        return false;
      }
      this.memoryLoginCodes.delete(key);
      return true;
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows} = await client.query(
        'SELECT code_hash,expires_at,attempts FROM integrall_customer_login_codes WHERE email=$1 FOR UPDATE',
        [key]
      );
      const record = rows[0];
      const expiresAt = new Date(record?.expires_at).getTime(), attempts = Number(record?.attempts);
      if (!record || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || !Number.isInteger(attempts) || attempts < 0 || attempts >= 5) {
        await client.query('COMMIT');
        return false;
      }
      if (!constantTimeStringEqual(record.code_hash, candidate)) {
        await client.query('UPDATE integrall_customer_login_codes SET attempts=attempts+1 WHERE email=$1', [key]);
        await client.query('COMMIT');
        return false;
      }
      await client.query('DELETE FROM integrall_customer_login_codes WHERE email=$1', [key]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await rollbackTransaction(client, 'consume_customer_login_code');
      throw error;
    } finally {
      client.release();
    }
  }
  async incrementCustomerLoginAttempts(email) {
    if (!this.pool) { const item=this.memoryLoginCodes.get(email); if(item) item.attempts=Number(item.attempts||0)+1; return; }
    await this.pool.query('UPDATE integrall_customer_login_codes SET attempts=attempts+1 WHERE email=$1', [email]);
  }
  async deleteCustomerLoginCode(email) { if (!this.pool) return this.memoryLoginCodes.delete(email); await this.pool.query('DELETE FROM integrall_customer_login_codes WHERE email=$1',[email]); return true; }

  async saveCustomerSession({tokenHash,email,csrfToken,expiresAt}) {
    const item={tokenHash,email,csrfToken,expiresAt};
    if(!this.pool){
      const now=Date.now();
      for(const [key,session] of this.memoryCustomerSessions){if(!Number.isFinite(Date.parse(session.expiresAt))||Date.parse(session.expiresAt)<=now)this.memoryCustomerSessions.delete(key);}
      this.memoryCustomerSessions.set(tokenHash,item);return clone(item);
    }
    await this.pool.query('DELETE FROM integrall_customer_sessions WHERE expires_at <= NOW()');
    await this.pool.query('INSERT INTO integrall_customer_sessions(token_hash,email,csrf_token,expires_at) VALUES($1,$2,$3,$4)',[tokenHash,email,csrfToken,expiresAt]); return item;
  }
  async getCustomerSession(tokenHash) {
    if(!this.pool)return this.memoryCustomerSessions.has(tokenHash)?clone(this.memoryCustomerSessions.get(tokenHash)):null;
    const {rows}=await this.pool.query('SELECT token_hash,email,csrf_token,expires_at FROM integrall_customer_sessions WHERE token_hash=$1',[tokenHash]);
    return rows[0]?{tokenHash:rows[0].token_hash,email:rows[0].email,csrfToken:rows[0].csrf_token,expiresAt:rows[0].expires_at?.toISOString?.()||rows[0].expires_at}:null;
  }
  async deleteCustomerSession(tokenHash){if(!this.pool)return this.memoryCustomerSessions.delete(tokenHash);await this.pool.query('DELETE FROM integrall_customer_sessions WHERE token_hash=$1',[tokenHash]);return true;}

  async saveAdminSession({jti, email, role, expiresAt}) {
    const item = {jti: String(jti || ''), email: String(email || '').trim().toLowerCase(), role: String(role || ''), expiresAt: String(expiresAt || '')};
    if (!item.jti || !item.email || !item.role || !Number.isFinite(Date.parse(item.expiresAt))) return null;
    if (!this.pool) {
      const now = Date.now();
      for (const [key, session] of this.memoryAdminSessions) {
        if (Date.parse(session.expiresAt) <= now) this.memoryAdminSessions.delete(key);
      }
      this.memoryAdminSessions.set(item.jti, item);
      return clone(item);
    }
    await this.pool.query('DELETE FROM integrall_admin_sessions WHERE expires_at <= NOW()');
    await this.pool.query(
      `INSERT INTO integrall_admin_sessions(jti,email,role,expires_at,created_at)
       VALUES($1,$2,$3,$4,NOW())
       ON CONFLICT(jti) DO UPDATE SET email=EXCLUDED.email,role=EXCLUDED.role,expires_at=EXCLUDED.expires_at`,
      [item.jti, item.email, item.role, item.expiresAt]
    );
    return item;
  }

  async getAdminSession(jti) {
    const key = String(jti || '');
    if (!key) return null;
    if (!this.pool) {
      const item = this.memoryAdminSessions.get(key);
      if (!item) return null;
      if (Date.parse(item.expiresAt) <= Date.now()) {
        this.memoryAdminSessions.delete(key);
        return null;
      }
      return clone(item);
    }
    const {rows} = await this.pool.query('SELECT jti,email,role,expires_at FROM integrall_admin_sessions WHERE jti=$1 AND expires_at>NOW()', [key]);
    const row = rows[0];
    return row ? {jti: row.jti, email: row.email, role: row.role, expiresAt: row.expires_at?.toISOString?.() || row.expires_at} : null;
  }

  async deleteAdminSession(jti) {
    const key = String(jti || '');
    if (!key) return false;
    if (!this.pool) return this.memoryAdminSessions.delete(key);
    const result = await this.pool.query('DELETE FROM integrall_admin_sessions WHERE jti=$1', [key]);
    return Number(result.rowCount) > 0;
  }

  async listOrdersByEmail(email,{limit=100}={}) {
    const key=String(email||'').trim().toLowerCase(); const safeLimit=Math.max(1,Math.min(200,Number(limit)||100));
    if(!this.pool)return [...this.memoryOrders.values()].filter(o=>String(o.customer?.email||'').toLowerCase()===key).map(clone).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,safeLimit);
    const {rows}=await this.pool.query(`SELECT data FROM integrall_orders WHERE LOWER(COALESCE(data #>> '{customer,email}',''))=$1 ORDER BY created_at DESC LIMIT $2`,[key,safeLimit]); return rows.map(r=>r.data);
  }

  async findVerifiedPurchase(email, productId) {
    const key=String(email||'').trim().toLowerCase();
    const product=String(productId||'').trim();
    if(!key||!product)return null;
    const paidStatuses=new Set(['paid','preparing','ready','completed']);
    if(!this.pool){
      const match=[...this.memoryOrders.values()]
        .filter(order=>String(order.customer?.email||'').toLowerCase()===key && paidStatuses.has(order.status))
        .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))
        .find(order=>(order.items||[]).some(line=>line.productId===product));
      return match?clone(match):null;
    }
    const {rows}=await this.pool.query(
      `SELECT data FROM integrall_orders
       WHERE LOWER(COALESCE(data #>> '{customer,email}',''))=$1
         AND data->>'status'=ANY($2::text[])
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(data->'items','[]'::jsonb)) AS item
           WHERE item->>'productId'=$3
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [key,[...paidStatuses],product]
    );
    return rows[0]?.data??null;
  }

  async upsertReview(review) {
    const item=clone(review);
    if(!this.pool) return this.withMemoryWriteLock(async () => {
      const existing=[...this.memoryReviews.values()].find(r=>r.productId===item.productId&&r.email===item.email);
      if(existing)item.id=existing.id;
      this.memoryReviews.set(item.id,item);return clone(item);
    });
    const {rows}=await this.pool.query(`INSERT INTO integrall_reviews(id,product_id,email,rating,title,body,status,verified_order_id,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
      ON CONFLICT(product_id,email) DO UPDATE SET rating=EXCLUDED.rating,title=EXCLUDED.title,body=EXCLUDED.body,status='pending',verified_order_id=EXCLUDED.verified_order_id,updated_at=NOW()
      RETURNING id,product_id,email,rating,title,body,status,verified_order_id,created_at,updated_at`,[item.id,item.productId,item.email,item.rating,item.title,item.body,item.status,item.verifiedOrderId]);
    const r=rows[0];return {id:r.id,productId:r.product_id,email:r.email,rating:r.rating,title:r.title,body:r.body,status:r.status,verifiedOrderId:r.verified_order_id,createdAt:r.created_at?.toISOString?.()||r.created_at,updatedAt:r.updated_at?.toISOString?.()||r.updated_at};
  }
  async listReviews({productId='',status='',limit=200}={}) {
    const safeLimit=Math.max(1,Math.min(500,Number(limit)||200));
    if(!this.pool)return [...this.memoryReviews.values()].filter(r=>(!productId||r.productId===productId)&&(!status||r.status===status)).map(clone).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,safeLimit);
    const {rows}=await this.pool.query(`SELECT id,product_id,email,rating,title,body,status,verified_order_id,created_at,updated_at FROM integrall_reviews WHERE ($1='' OR product_id=$1) AND ($2='' OR status=$2) ORDER BY created_at DESC LIMIT $3`,[productId,status,safeLimit]);
    return rows.map(r=>({id:r.id,productId:r.product_id,email:r.email,rating:r.rating,title:r.title,body:r.body,status:r.status,verifiedOrderId:r.verified_order_id,createdAt:r.created_at?.toISOString?.()||r.created_at,updatedAt:r.updated_at?.toISOString?.()||r.updated_at}));
  }
  async updateReviewStatus(id,status){
    if(!this.pool) return this.withMemoryWriteLock(async () => {const item=this.memoryReviews.get(id);if(!item)return null;item.status=status;item.updatedAt=new Date().toISOString();return clone(item);});
    const {rows}=await this.pool.query(`UPDATE integrall_reviews SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING id,product_id,email,rating,title,body,status,verified_order_id,created_at,updated_at`,[id,status]);const r=rows[0];return r?{id:r.id,productId:r.product_id,email:r.email,rating:r.rating,title:r.title,body:r.body,status:r.status,verifiedOrderId:r.verified_order_id,createdAt:r.created_at?.toISOString?.()||r.created_at,updatedAt:r.updated_at?.toISOString?.()||r.updated_at}:null;
  }
  async reviewStats(){
    if(!this.pool){const grouped={};for(const r of this.memoryReviews.values()){if(r.status!=='published')continue;const g=grouped[r.productId]||{sum:0,count:0};g.sum+=Number(r.rating)||0;g.count+=1;grouped[r.productId]=g;}return Object.fromEntries(Object.entries(grouped).map(([id,g])=>[id,{count:g.count,average:g.count?g.sum/g.count:0}]));}
    const {rows}=await this.pool.query(`SELECT product_id,COUNT(*)::int count,AVG(rating)::float average FROM integrall_reviews WHERE status='published' GROUP BY product_id`);return Object.fromEntries(rows.map(r=>[r.product_id,{count:r.count,average:Number(r.average)||0}]));
  }

  async addRestockSubscription(item){
    if(!this.pool) return this.withMemoryWriteLock(async () => {const dup=[...this.memoryRestockSubscriptions.values()].find(s=>s.productId===item.productId&&s.variantId===item.variantId&&s.email.toLowerCase()===item.email.toLowerCase()&&s.status==='active');if(dup)return clone(dup);this.memoryRestockSubscriptions.set(item.id,clone(item));return clone(item);});
    const {rows}=await this.pool.query(`INSERT INTO integrall_restock_subscriptions(id,product_id,variant_id,email,status) VALUES($1,$2,$3,$4,'active') ON CONFLICT DO NOTHING RETURNING id,product_id,variant_id,email,status,created_at,notified_at`,[item.id,item.productId,item.variantId,item.email]);
    if(rows[0]){const r=rows[0];return {id:r.id,productId:r.product_id,variantId:r.variant_id,email:r.email,status:r.status,createdAt:r.created_at?.toISOString?.()||r.created_at,notifiedAt:r.notified_at?.toISOString?.()||r.notified_at};}
    const existing=await this.listRestockSubscriptions({status:'active',productId:item.productId});return existing.find(s=>s.variantId===item.variantId&&s.email.toLowerCase()===item.email.toLowerCase())||null;
  }
  async listRestockSubscriptions({status='',productId='',limit=500}={}){
    const safeLimit=Math.max(1,Math.min(1000,Number(limit)||500));
    if(!this.pool)return [...this.memoryRestockSubscriptions.values()].filter(s=>(!status||s.status===status)&&(!productId||s.productId===productId)).map(clone).slice(0,safeLimit);
    const {rows}=await this.pool.query(`SELECT id,product_id,variant_id,email,status,created_at,notified_at FROM integrall_restock_subscriptions WHERE ($1='' OR status=$1) AND ($2='' OR product_id=$2) ORDER BY created_at LIMIT $3`,[status,productId,safeLimit]);return rows.map(r=>({id:r.id,productId:r.product_id,variantId:r.variant_id,email:r.email,status:r.status,createdAt:r.created_at?.toISOString?.()||r.created_at,notifiedAt:r.notified_at?.toISOString?.()||r.notified_at}));
  }
  async markRestockNotified(ids){
    const list=(Array.isArray(ids)?ids:[]).filter(Boolean);if(!list.length)return 0;
    if(!this.pool) return this.withMemoryWriteLock(async () => {let count=0;for(const id of list){const item=this.memoryRestockSubscriptions.get(id);if(item){item.status='notified';item.notifiedAt=new Date().toISOString();count++;}}return count;});
    const {rowCount}=await this.pool.query(`UPDATE integrall_restock_subscriptions SET status='notified',notified_at=NOW() WHERE id=ANY($1::text[])`,[list]);return rowCount||0;
  }

  /**
   * Executa o envio de uma inscrição de reposição sob exclusão mútua.
   * Em PostgreSQL usa pg_try_advisory_lock: duas instâncias não enviam o
   * mesmo alerta simultaneamente. O status só vira "notified" depois que o
   * handler confirma sucesso; falha/throw mantém "active" para retry futuro.
   */
  async withRestockNotificationLock(id, handler){
    const key=String(id||'');
    if(!key||typeof handler!=='function')return {claimed:false,notified:false};
    if(!this.pool){
      if(this.memoryRestockLocks.has(key))return {claimed:false,notified:false};
      this.memoryRestockLocks.add(key);
      try{
        const item=this.memoryRestockSubscriptions.get(key);
        if(!item||item.status!=='active')return {claimed:true,notified:false};
        const ok=await handler(clone(item));
        if(ok){await this.markRestockNotified([key]);return {claimed:true,notified:true};}
        return {claimed:true,notified:false};
      }finally{this.memoryRestockLocks.delete(key);}
    }
    const client=await this.pool.connect();
    const lockName=`integrall-restock:${key}`;
    let locked=false;
    try{
      const lock=await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',[lockName]);
      locked=Boolean(lock.rows[0]?.locked);
      if(!locked)return {claimed:false,notified:false};
      const {rows}=await client.query(`SELECT id,product_id,variant_id,email,status,created_at,notified_at FROM integrall_restock_subscriptions WHERE id=$1 AND status='active'`,[key]);
      const r=rows[0];
      if(!r)return {claimed:true,notified:false};
      const item={id:r.id,productId:r.product_id,variantId:r.variant_id,email:r.email,status:r.status,createdAt:r.created_at?.toISOString?.()||r.created_at,notifiedAt:r.notified_at?.toISOString?.()||r.notified_at};
      const ok=await handler(item);
      if(!ok)return {claimed:true,notified:false};
      const updated=await client.query(`UPDATE integrall_restock_subscriptions SET status='notified',notified_at=NOW() WHERE id=$1 AND status='active'`,[key]);
      return {claimed:true,notified:Number(updated.rowCount)>0};
    }finally{
      if(locked)await client.query('SELECT pg_advisory_unlock(hashtext($1))',[lockName]).catch(()=>{});
      client.release();
    }
  }

  async health() {
    if (!this.pool) return {ok: true, mode: this.localDataDir ? 'local-file-development-only' : 'memory-development-only'};
    await this.pool.query('SELECT 1');
    return {ok: true, mode: 'postgresql'};
  }

  async close() {
    await this.memoryWriteTail;
    await this.pool?.end();
  }
}
