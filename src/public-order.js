/**
 * Projeção mínima de um pedido para respostas destinadas ao cliente.
 *
 * Dados internos (CEP completo, origem e observações administrativas do
 * histórico, token de checkout, endereço e dados pessoais) nunca devem sair
 * por uma rota pública baseada apenas no token de acompanhamento.
 */
export function toPublicOrder(order, {onlinePaymentAvailable = false} = {}) {
  const source = order && typeof order === 'object' ? order : {};
  return {
    id: source.id || '',
    status: source.status || '',
    createdAt: source.createdAt || '',
    updatedAt: source.updatedAt || '',
    subtotalCents: Number(source.subtotalCents) || 0,
    shippingCents: source.shippingCents == null ? null : Math.max(0, Number(source.shippingCents) || 0),
    discountCents: Number(source.discountCents) || 0,
    promotionDiscountCents: Number(source.promotionDiscountCents) || 0,
    couponDiscountCents: Number(source.couponDiscountCents) || 0,
    promotions: Array.isArray(source.promotions)
      ? source.promotions.map(item => ({name: item?.name || '', type: item?.type || ''}))
      : [],
    coupon: source.coupon?.code || '',
    trackingCode: source.trackingCode || '',
    trackingCarrier: source.trackingCarrier || '',
    trackingUrl: source.trackingUrl || '',
    totalCents: Number(source.totalCents) || 0,
    requiresShippingQuote: Boolean(source.requiresShippingQuote),
    shipping: {
      choice: source.shipping?.choice || '',
      label: source.shipping?.label || '',
      days: source.shipping?.days || '',
      service: source.shipping?.service || '',
      deadline: source.shipping?.deadline || '',
      volumes: source.shipping?.volumes || 0,
      homeDelivery: source.shipping?.homeDelivery ?? null
    },
    items: Array.isArray(source.items)
      ? source.items.map(item => ({
          name: item?.name || '',
          variant: item?.variant || '',
          qty: Math.max(0, Number(item?.qty) || 0),
          lineTotalCents: Math.max(0, Number(item?.lineTotalCents) || 0)
        }))
      : [],
    payment: {
      provider: source.payment?.provider || '',
      status: source.payment?.status || '',
      statusDetail: source.payment?.statusDetail || '',
      approvedAt: source.payment?.approvedAt || ''
    },
    // O cliente precisa da linha do tempo, mas não de observações ou origem
    // internas, que podem conter detalhes operacionais do atendimento.
    history: Array.isArray(source.history)
      ? source.history.slice(-30).map(event => ({at: event?.at || '', status: event?.status || ''}))
      : [],
    inventoryReservationExpiresAt: source.inventoryReservationExpiresAt || '',
    onlinePaymentAvailable: Boolean(onlinePaymentAvailable)
  };
}
