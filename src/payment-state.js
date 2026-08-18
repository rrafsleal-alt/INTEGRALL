const ADVANCED_STATUSES = new Set(['paid', 'preparing', 'ready', 'completed']);

function cents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

export function evaluatePayment(order, payment) {
  const expectedCents = Number(order?.totalCents || 0);
  const receivedCents = cents(payment?.transaction_amount);
  const refundedCents = cents(payment?.transaction_amount_refunded);
  const currency = String(payment?.currency_id || '').toUpperCase();
  const expectedPreferenceId = String(order?.payment?.preferenceId || '');
  const receivedPreferenceId = String(payment?.preference_id || '');
  const status = String(payment?.status || '').toLowerCase();
  const statusDetail = String(payment?.status_detail || '').toLowerCase();
  const advanced = ADVANCED_STATUSES.has(order?.status);

  const preferenceMismatch = Boolean(expectedPreferenceId) && expectedPreferenceId !== receivedPreferenceId;
  const currencyMismatch = Boolean(currency) && currency !== 'BRL';
  const amountMismatch = receivedCents !== expectedCents;
  if (preferenceMismatch || currencyMismatch || amountMismatch) {
    const warning = preferenceMismatch ? 'preference_mismatch' : currencyMismatch ? 'currency_mismatch' : 'amount_mismatch';
    return advanced
      ? {shouldUpdate: false, nextStatus: order.status, paymentStatus: warning, warning}
      : {shouldUpdate: true, nextStatus: 'payment_failed', paymentStatus: warning, warning};
  }

  if (status === 'approved') {
    if (refundedCents >= expectedCents && expectedCents > 0) return {shouldUpdate: true, nextStatus: 'refunded', paymentStatus: 'refunded'};
    if (refundedCents > 0) return {shouldUpdate: true, nextStatus: 'payment_review', paymentStatus: 'partially_refunded'};
    // Pagamento aprovado de pedido CANCELADO não pode ressuscitá-lo como
    // 'paid' (a loja pode ter cancelado por falta de estoque). Vai para
    // revisão: o dinheiro entrou e a operação decide (reembolsar ou atender).
    if (order.status === 'cancelled') {
      return {shouldUpdate: true, nextStatus: 'payment_review', paymentStatus: 'approved_after_cancel', warning: 'approved_after_cancel'};
    }
    return {
      shouldUpdate: true,
      nextStatus: ['preparing', 'ready', 'completed'].includes(order.status) ? order.status : 'paid',
      paymentStatus: status
    };
  }

  if (status === 'in_mediation') return {shouldUpdate: true, nextStatus: 'payment_review', paymentStatus: status};
  if (['pending', 'in_process', 'authorized'].includes(status)) {
    return advanced
      ? {shouldUpdate: false, nextStatus: order.status, paymentStatus: status}
      : {shouldUpdate: true, nextStatus: 'awaiting_payment', paymentStatus: status};
  }
  if (status === 'cancelled' && statusDetail === 'expired' || status === 'expired') {
    return advanced
      ? {shouldUpdate: false, nextStatus: order.status, paymentStatus: 'expired'}
      : {shouldUpdate: true, nextStatus: 'payment_expired', paymentStatus: 'expired'};
  }
  if (['rejected', 'cancelled', 'canceled'].includes(status)) {
    return advanced
      ? {shouldUpdate: false, nextStatus: order.status, paymentStatus: status}
      : {shouldUpdate: true, nextStatus: 'payment_failed', paymentStatus: status};
  }
  if (status === 'refunded') return {shouldUpdate: true, nextStatus: 'refunded', paymentStatus: status};
  if (status === 'charged_back') return {shouldUpdate: true, nextStatus: 'chargeback', paymentStatus: status};
  return {shouldUpdate: false, nextStatus: order.status, paymentStatus: status};
}
