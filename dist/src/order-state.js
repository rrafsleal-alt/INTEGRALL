import {ORDER_STATUSES} from './catalog.js';

const transitionEntries = {
  received: ['awaiting_payment', 'paid', 'payment_failed', 'payment_expired', 'payment_review', 'cancelled'],
  awaiting_payment: ['paid', 'payment_failed', 'payment_expired', 'payment_review', 'cancelled'],
  payment_failed: ['awaiting_payment', 'paid', 'payment_expired', 'payment_review', 'cancelled'],
  payment_expired: ['paid', 'payment_review', 'cancelled'],
  payment_review: ['paid', 'refunded', 'chargeback', 'cancelled'],
  paid: ['preparing', 'refunded', 'chargeback'],
  preparing: ['ready', 'refunded', 'chargeback'],
  ready: ['completed', 'refunded', 'chargeback'],
  completed: ['refunded', 'chargeback'],
  cancelled: ['payment_review'],
  refunded: [],
  chargeback: []
};

export const ORDER_TRANSITIONS = Object.freeze(Object.fromEntries(
  ORDER_STATUSES.map(status => [status, Object.freeze(transitionEntries[status] || [])])
));

export function canTransitionOrder(from, to) {
  if (!ORDER_STATUSES.includes(from) || !ORDER_STATUSES.includes(to)) return false;
  if (from === to) return true;
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertOrderTransition(from, to) {
  if (!ORDER_STATUSES.includes(to)) {
    const error = new Error('Status de pedido inválido.');
    error.code = 'ORDER_STATUS_INVALID';
    throw error;
  }
  if (!canTransitionOrder(from, to)) {
    const error = new Error(`Transição de pedido não permitida: ${from} → ${to}.`);
    error.code = 'ORDER_TRANSITION_INVALID';
    throw error;
  }
  return true;
}
