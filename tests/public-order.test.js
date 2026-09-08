import test from 'node:test';
import assert from 'node:assert/strict';
import {toPublicOrder} from '../src/public-order.js';

test('projeção pública do pedido remove dados pessoais e observações internas', () => {
  const publicView = toPublicOrder({
    id: 'INT-PRIVACY-1',
    status: 'preparing',
    createdAt: '2026-09-02T12:00:00.000Z',
    updatedAt: '2026-09-02T12:30:00.000Z',
    customer: {name: 'Cliente', email: 'cliente@example.com', phone: '11999999999'},
    checkoutToken: 'segredo-de-acompanhamento',
    shipping: {
      choice: 'delivery',
      cep: '01310100',
      street: 'Avenida Paulista',
      number: '1000',
      label: 'Correios PAC',
      days: 5
    },
    items: [{productId: 'P1', variantId: 'V1', name: 'Produto', variant: '750 ml', qty: 1, lineTotalCents: 2500}],
    history: [{at: '2026-09-02T12:30:00.000Z', status: 'preparing', source: 'admin', note: 'Separar da prateleira reservada do cliente VIP.'}],
    payment: {provider: 'mercado_pago', status: 'approved'},
    totalCents: 2500
  }, {onlinePaymentAvailable: true});

  assert.equal(publicView.id, 'INT-PRIVACY-1');
  assert.equal(publicView.shipping.label, 'Correios PAC');
  assert.equal(publicView.onlinePaymentAvailable, true);
  assert.deepEqual(publicView.history, [{at: '2026-09-02T12:30:00.000Z', status: 'preparing'}]);
  assert.equal('cep' in publicView.shipping, false);
  assert.equal('customer' in publicView, false);
  assert.equal('checkoutToken' in publicView, false);
  assert.equal('source' in publicView.history[0], false);
  assert.equal('note' in publicView.history[0], false);
  assert.equal('productId' in publicView.items[0], false);
  assert.equal('variantId' in publicView.items[0], false);
});

test('projeção pública tolera pedido parcial sem lançar exceção', () => {
  assert.doesNotThrow(() => toPublicOrder(null));
  const value = toPublicOrder({id: 'PARCIAL'});
  assert.equal(value.id, 'PARCIAL');
  assert.deepEqual(value.items, []);
  assert.deepEqual(value.history, []);
  assert.equal(value.totalCents, 0);
});
