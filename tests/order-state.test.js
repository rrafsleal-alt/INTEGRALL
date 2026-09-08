import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOrderTransition, canTransitionOrder, ORDER_TRANSITIONS} from '../src/order-state.js';

test('máquina de estados permite o fluxo comercial esperado', () => {
  assert.equal(canTransitionOrder('received', 'awaiting_payment'), true);
  assert.equal(canTransitionOrder('received', 'paid'), true);
  assert.equal(canTransitionOrder('paid', 'preparing'), true);
  assert.equal(canTransitionOrder('preparing', 'ready'), true);
  assert.equal(canTransitionOrder('ready', 'completed'), true);
  assert.equal(canTransitionOrder('completed', 'refunded'), true);
});

test('máquina de estados bloqueia regressões e transições impossíveis', () => {
  assert.equal(canTransitionOrder('completed', 'received'), false);
  assert.equal(canTransitionOrder('refunded', 'paid'), false);
  assert.throws(() => assertOrderTransition('paid', 'received'), error => error.code === 'ORDER_TRANSITION_INVALID');
  assert.throws(() => assertOrderTransition('paid', 'qualquer'), error => error.code === 'ORDER_STATUS_INVALID');
  assert.deepEqual(ORDER_TRANSITIONS.refunded, []);
});
