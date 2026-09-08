const LOCK_MS = 120_000;

function error(code, message) {
  return Object.assign(new Error(message), {code});
}

export function reusableCheckout(order, now = Date.now()) {
  if (!order || order.inventoryReservationReleasedAt || order.inventoryCommittedAt) return null;
  const expiresAt = Date.parse(order.inventoryReservationExpiresAt || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= Number(now) + 5_000) return null;
  const url = String(order.payment?.checkoutUrl || '');
  const preferenceId = String(order.payment?.preferenceId || '');
  if (!url || !preferenceId || !/^https:\/\//i.test(url)) return null;
  if (!['received', 'awaiting_payment', 'payment_failed'].includes(String(order.status || ''))) return null;
  return {url, preferenceId, orderId: order.id};
}

export function claimCheckout(order, {claimId, now = Date.now(), lockMs = LOCK_MS} = {}) {
  if (!order || !claimId) throw error('PAYMENT_CHECKOUT_INVALID', 'Não foi possível iniciar o pagamento.');
  const lockedAt = Date.parse(order.payment?.checkoutInProgressAt || '');
  if (order.payment?.checkoutClaimId && Number.isFinite(lockedAt) && lockedAt > Number(now) - Math.max(10_000, Number(lockMs) || LOCK_MS)) {
    throw error('PAYMENT_CHECKOUT_IN_PROGRESS', 'Já existe uma criação de pagamento em andamento para este pedido.');
  }
  const pending = Number(order.payment?.checkoutPendingAttempt);
  const previous = Number(order.payment?.attempt);
  const attempt = Number.isSafeInteger(pending) && pending >= 1 && pending <= 99
    ? pending
    : Math.max(1, Math.min(99, (Number.isSafeInteger(previous) ? previous : 0) + 1));
  return {
    attempt,
    payment: {
      checkoutClaimId: claimId,
      checkoutInProgressAt: new Date(Number(now)).toISOString(),
      checkoutPendingAttempt: attempt
    }
  };
}

export function clearCheckoutClaimPatch(order, claimId) {
  if (!order || String(order.payment?.checkoutClaimId || '') !== String(claimId || '')) return null;
  return {payment: {checkoutClaimId: '', checkoutInProgressAt: ''}};
}

export function completeCheckoutPatch(order, {claimId, checkout, attempt} = {}) {
  if (!order || String(order.payment?.checkoutClaimId || '') !== String(claimId || '')) {
    throw error('PAYMENT_CHECKOUT_CLAIM_LOST', 'A criação do pagamento perdeu a trava de concorrência. Tente novamente.');
  }
  if (!checkout?.id || !/^https:\/\//i.test(String(checkout.url || ''))) throw error('PAYMENT_CHECKOUT_INVALID', 'Resposta inválida do provedor de pagamento.');
  return {
    status: 'awaiting_payment',
    payment: {
      provider: 'mercadopago',
      preferenceId: String(checkout.id),
      checkoutUrl: String(checkout.url),
      status: 'pending',
      statusDetail: '',
      attempt: Math.max(1, Math.min(99, Number(attempt) || 1)),
      checkoutPendingAttempt: 0,
      checkoutClaimId: '',
      checkoutInProgressAt: ''
    }
  };
}
