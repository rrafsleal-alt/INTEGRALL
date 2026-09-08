function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function managedInventoryLine(catalog, line) {
  const product = catalog?.products?.find(item => item.id === line.productId);
  if (!product) return {product: null, variant: null, target: null};
  const variant = line.variantId ? (product.variants || []).find(item => item.id === line.variantId) : null;
  if (variant && variant.stock != null) return {product, variant, target: variant};
  if (product.stock != null) return {product, variant, target: product};
  return {product, variant, target: null};
}

export function reserveInventory(catalog, order, reservationMinutes = 15, nowValue = Date.now()) {
  const nextCatalog = clone(catalog);
  const nextOrder = clone(order);
  const warnings = [];
  for (const line of nextOrder.items || []) {
    const {product, variant, target} = managedInventoryLine(nextCatalog, line);
    if (!product) throw Object.assign(new Error(`Produto não encontrado ao reservar estoque: ${line.productId}`), {code: 'OUT_OF_STOCK'});
    if (!target) continue;
    const qty = Number(line.qty) || 0;
    const before = Number(target.stock);
    if (!Number.isFinite(before) || qty <= 0 || before < qty) {
      const option = variant?.name ? ` / ${variant.name}` : '';
      throw Object.assign(new Error(`Estoque insuficiente para ${product.name}${option}. Atualize a sacola e tente novamente.`), {code: 'OUT_OF_STOCK'});
    }
    target.stock = before - qty;
  }
  const now = new Date(nowValue);
  nextOrder.inventoryReservedAt = now.toISOString();
  nextOrder.inventoryReservationExpiresAt = new Date(now.getTime() + Math.max(5, Math.min(120, Number(reservationMinutes) || 20)) * 60_000).toISOString();
  nextOrder.inventoryReservationReleasedAt = '';
  nextOrder.inventoryCommittedAt = nextOrder.inventoryCommittedAt || '';
  nextOrder.inventoryWarnings = Array.isArray(nextOrder.inventoryWarnings) ? nextOrder.inventoryWarnings : warnings;
  return {catalog: nextCatalog, order: nextOrder};
}

export function releaseInventory(catalog, order) {
  const nextCatalog = clone(catalog);
  const warnings = [];
  for (const line of order.items || []) {
    const {product, variant, target} = managedInventoryLine(nextCatalog, line);
    if (!product) { warnings.push(`Produto ausente ao liberar reserva: ${line.productId}`); continue; }
    if (!target) continue;
    const qty = Number(line.qty) || 0;
    const before = Number(target.stock);
    if (!Number.isFinite(before)) { warnings.push(`Estoque inválido ao liberar ${product.name}${variant?.name ? ` / ${variant.name}` : ''}`); continue; }
    target.stock = Math.max(0, before) + Math.max(0, qty);
  }
  return {catalog: nextCatalog, warnings};
}

export function commitInventory(catalog, order, {strict = false} = {}) {
  const nextCatalog = clone(catalog);
  const warnings = [];
  const fail = message => {
    if (strict) throw Object.assign(new Error(message), {code: 'OUT_OF_STOCK'});
    warnings.push(message);
  };
  for (const line of order.items || []) {
    const product = nextCatalog.products?.find(item => item.id === line.productId);
    if (!product) { fail(`Produto ausente no catálogo: ${line.productId}`); continue; }
    const qty = Number(line.qty) || 0;
    if (qty <= 0) continue;
    const variant = line.variantId ? (product.variants || []).find(item => item.id === line.variantId) : null;
    if (line.variantId && !variant && strict) {
      fail(`Variação removida do catálogo ao confirmar pagamento: ${product.name} / ${line.variant || line.variantId}`);
      continue;
    }
    if (variant && variant.stock != null) {
      const before = Number(variant.stock);
      if (!Number.isFinite(before)) { fail(`Estoque inválido em ${product.name} / ${variant.name}`); continue; }
      if (before < qty) { fail(`Estoque insuficiente ao confirmar pagamento: ${product.name} / ${variant.name}`); if (strict) continue; }
      variant.stock = Math.max(0, before - qty);
      continue;
    }
    if (product.stock != null) {
      const before = Number(product.stock);
      if (!Number.isFinite(before)) { fail(`Estoque inválido em ${product.name}`); continue; }
      if (before < qty) { fail(`Estoque insuficiente ao confirmar pagamento: ${product.name}`); if (strict) continue; }
      product.stock = Math.max(0, before - qty);
    }
  }
  return {catalog: nextCatalog, warnings};
}
