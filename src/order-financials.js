/**
 * Execute dentro de repo.updateOrder, sobre o pedido sob lock.
 * Um checkout pode estar no provedor ANTES de termos preferenceId. Mesmo um
 * timeout não prova que a preferência não foi criada: pendingAttempt conserva
 * a identidade usada no retry. Alterar o total nessa janela não é seguro.
 */
export function assertShippingEditable(order) {
  const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
  if (order?.shipping?.choice !== 'delivery') {
    fail('ORDER_SHIPPING_NOT_DELIVERY', 'Este pedido é para retirada e não precisa de cotação de frete.');
  }
  if (['awaiting_payment', 'payment_review'].includes(order.status)) {
    fail('ORDER_PAYMENT_TOTAL_LOCKED', 'Há um pagamento em andamento ou em análise. O frete e o total deste pedido não podem ser alterados.');
  }
  if (!['received', 'payment_failed'].includes(order.status) || order.inventoryCommittedAt || order.inventoryReservationReleasedAt) {
    fail('ORDER_SHIPPING_LOCKED', 'O frete não pode ser alterado depois da confirmação financeira/operacional ou do encerramento da reserva.');
  }
  const payment = order.payment || {};
  const nonzeroAttempt = value => value !== undefined && value !== null && value !== '' && value !== 0 && value !== '0';
  if (payment.preferenceId || payment.checkoutClaimId || payment.checkoutInProgressAt ||
      nonzeroAttempt(payment.checkoutPendingAttempt) || nonzeroAttempt(payment.attempt)) {
    fail('ORDER_PAYMENT_TOTAL_LOCKED', 'Já existe uma tentativa de pagamento em andamento ou uma preferência vinculada ao total atual. Recrie o pedido se o valor precisar mudar.');
  }
  return true;
}

function cents(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

/**
 * Recalcula o pedido quando um frete que estava "sob cotação" recebe preço.
 * Usa os descontos congelados no próprio pedido — nunca as promoções atuais do
 * catálogo — para evitar alterar retroativamente uma compra já criada.
 */
export function applyQuotedShipping(order, {shippingCents, label = 'Frete confirmado pela loja'} = {}) {
  const shipping = cents(shippingCents);
  if (shipping == null) throw Object.assign(new Error('Frete inválido.'), {code: 'ORDER_SHIPPING_INVALID'});
  const subtotal = cents(order?.subtotalCents);
  if (subtotal == null || subtotal <= 0) throw Object.assign(new Error('Subtotal do pedido inválido.'), {code: 'ORDER_TOTAL_INVALID'});

  const promotions = Array.isArray(order?.promotions) ? order.promotions.map(item => ({...item})) : [];
  const previousPromotionShipping = promotions.reduce((sum, item) => sum + Math.max(0, Number(item?.shippingDiscountCents) || 0), 0);
  const productPromotionDiscount = Math.max(0, (Number(order?.promotionDiscountCents) || 0) - previousPromotionShipping);

  let promotionShippingDiscount = 0;
  let shippingApplied = false;
  for (const item of promotions) {
    if (item?.type === 'free_shipping_threshold' && !shippingApplied) {
      item.shippingDiscountCents = shipping;
      promotionShippingDiscount = shipping;
      shippingApplied = true;
    } else if (item?.type === 'free_shipping_threshold') {
      item.shippingDiscountCents = 0;
    }
  }

  const promotionDiscountCents = productPromotionDiscount + promotionShippingDiscount;
  const couponDiscountCents = order?.coupon?.type === 'free_shipping'
    ? Math.max(0, shipping - promotionShippingDiscount)
    : Math.max(0, Number(order?.couponDiscountCents) || 0);
  const discountCents = promotionDiscountCents + couponDiscountCents;
  const totalCents = subtotal + shipping - discountCents;
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw Object.assign(new Error('O frete informado deixaria o total do pedido inválido.'), {code: 'ORDER_TOTAL_INVALID'});

  return {
    patch: {
      shipping: {priceCents: shipping, quoted: false, label: String(label || 'Frete confirmado pela loja').slice(0, 160)},
      shippingCents: shipping,
      discountCents,
      promotionDiscountCents,
      couponDiscountCents,
      promotions,
      totalCents,
      requiresShippingQuote: false
    },
    financial: {shippingCents: shipping, discountCents, promotionDiscountCents, couponDiscountCents, totalCents, label: String(label || '')}
  };
}
