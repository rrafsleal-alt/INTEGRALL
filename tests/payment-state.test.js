import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePayment} from '../src/payment-state.js';

const order = (status = 'awaiting_payment') => ({
  status,
  totalCents: 2390,
  payment: {preferenceId: 'PREF-123'}
});
const payment = (overrides = {}) => ({
  id: 1,
  status: 'approved',
  transaction_amount: 23.90,
  transaction_amount_refunded: 0,
  currency_id: 'BRL',
  preference_id: 'PREF-123',
  ...overrides
});

test('pagamento aprovado válido avança para pago', () => {
  assert.deepEqual(evaluatePayment(order(), payment()), {shouldUpdate:true,nextStatus:'paid',paymentStatus:'approved'});
});

test('valor, moeda ou preferência divergentes bloqueiam confirmação', () => {
  assert.equal(evaluatePayment(order(), payment({transaction_amount: 1})).warning, 'amount_mismatch');
  assert.equal(evaluatePayment(order(), payment({currency_id: 'USD'})).warning, 'currency_mismatch');
  assert.equal(evaluatePayment(order(), payment({preference_id: ''})).warning, 'preference_mismatch');
});

test('webhook pendente ou recusado atrasado não rebaixa pedido pago', () => {
  assert.equal(evaluatePayment(order('paid'), payment({status:'pending'})).shouldUpdate, false);
  assert.equal(evaluatePayment(order('preparing'), payment({status:'rejected'})).shouldUpdate, false);
});

test('mediação, reembolso parcial, reembolso total e chargeback ficam explícitos', () => {
  assert.equal(evaluatePayment(order('paid'), payment({status:'in_mediation'})).nextStatus, 'payment_review');
  assert.equal(evaluatePayment(order('paid'), payment({transaction_amount_refunded: 10})).nextStatus, 'payment_review');
  assert.equal(evaluatePayment(order('completed'), payment({status:'refunded'})).nextStatus, 'refunded');
  assert.equal(evaluatePayment(order('completed'), payment({status:'charged_back'})).nextStatus, 'chargeback');
});


test('pagamento expirado fica explícito e pode ser tentado novamente', () => {
  const result = evaluatePayment(order(), payment({status:'cancelled',status_detail:'expired'}));
  assert.equal(result.shouldUpdate, true);
  assert.equal(result.nextStatus, 'payment_expired');
  assert.equal(result.paymentStatus, 'expired');
});

test('pagamento aprovado de pedido cancelado vai para revisão, nunca ressuscita como pago', () => {
  const order = {status: 'cancelled', totalCents: 5000, payment: {preferenceId: 'pref-1'}};
  const payment = {status: 'approved', transaction_amount: 50, currency_id: 'BRL', preference_id: 'pref-1', transaction_amount_refunded: 0};
  const result = evaluatePayment(order, payment);
  assert.equal(result.nextStatus, 'payment_review');
  assert.equal(result.warning, 'approved_after_cancel');
});
