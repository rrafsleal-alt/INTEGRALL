import {cleanText, productPrice} from './catalog.js';

function stockFor(product, variant) {
  if (variant?.stock != null) return Number(variant.stock);
  if (product?.stock != null) return Number(product.stock);
  return null;
}

/**
 * Valida os itens usados em uma cotação antes de chamar uma transportadora.
 * A cotação deve obedecer às mesmas regras essenciais do pedido: produto/variação
 * existentes, disponibilidade, quantidade, mínimo/máximo e estoque agregado.
 * Isso evita cotações "válidas" que seriam rejeitadas segundos depois no checkout.
 */
export function validateShippingQuoteItems(items, catalog) {
  const requested = Array.isArray(items) ? items : [];
  if (!requested.length || requested.length > 100) {
    const error = new Error('Informe entre 1 e 100 itens válidos para cotar o frete.');
    error.code = 'SHIPPING_ITEMS_INVALID';
    throw error;
  }

  const productsById = new Map((catalog?.products || []).map(product => [product.id, product]));
  const promotions = Array.isArray(catalog?.promotions) ? catalog.promotions : [];
  const productQuantities = new Map();
  const stockQuantities = new Map();
  const minimums = new Map();
  const normalizedItems = [];
  let subtotalCents = 0;
  let unitCount = 0;

  for (const item of requested) {
    const productId = cleanText(item?.productId, 120);
    const product = productsById.get(productId);
    if (!product || product.deletedAt || product.available === false || product.hidden === true) {
      throw new Error('Um dos produtos não está mais disponível para cotação.');
    }

    const requestedVariantId = cleanText(item?.variantId, 120);
    const pricing = productPrice(product, requestedVariantId, promotions);
    const variant = pricing.variant;
    const qty = Number(item?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
      throw new Error(`Quantidade inválida para ${product.name}.`);
    }

    const aggregateQty = (productQuantities.get(product.id) || 0) + qty;
    const maxPerOrder = product.maxPerOrder == null ? 999 : Number(product.maxPerOrder);
    if (aggregateQty > maxPerOrder) throw new Error(`Quantidade máxima de ${product.name}: ${maxPerOrder}.`);
    productQuantities.set(product.id, aggregateQty);
    minimums.set(product.id, {name: product.name, min: product.minPerOrder == null ? 1 : Number(product.minPerOrder)});

    const stock = stockFor(product, variant);
    if (stock != null && Number.isFinite(stock)) {
      const stockKey = variant?.stock != null ? `${product.id}::${variant.id}` : product.id;
      const aggregateStockQty = (stockQuantities.get(stockKey) || 0) + qty;
      if (aggregateStockQty > stock) throw new Error(`Estoque insuficiente para ${product.name}.`);
      stockQuantities.set(stockKey, aggregateStockQty);
    }

    const lineTotal = Number(pricing.unitPriceCents) * qty;
    if (!Number.isSafeInteger(lineTotal) || lineTotal <= 0) throw new Error(`Preço inválido para ${product.name}.`);
    subtotalCents += lineTotal;
    unitCount += qty;
    if (!Number.isSafeInteger(subtotalCents) || !Number.isSafeInteger(unitCount)) throw new Error('Cotação fora dos limites permitidos.');

    normalizedItems.push({productId: product.id, variantId: variant?.id || '', qty});
  }

  for (const [productId, rule] of minimums) {
    if (rule.min > 1 && (productQuantities.get(productId) || 0) < rule.min) {
      throw new Error(`Quantidade mínima de ${rule.name}: ${rule.min} unidade(s).`);
    }
  }

  return {items: normalizedItems, productsById, subtotalCents, unitCount};
}
