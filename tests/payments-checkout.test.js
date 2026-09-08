import test from 'node:test';
import assert from 'node:assert/strict';
import {MercadoPagoService} from '../src/payments.js';

test('preferência do Mercado Pago expira no máximo junto com a reserva de estoque', async () => {
  let request = null;
  const service = new MercadoPagoService({accessToken:'token-de-teste',webhookSecret:'segredo-de-teste',expirationDays:3});
  service.clients = async () => ({
    preference: {
      async create(value) {
        request = value;
        return {id:'PREF-1',init_point:'https://www.mercadopago.com/checkout/PREF-1'};
      }
    }
  });
  const reservation = new Date(Date.now() + 90_000).toISOString();
  const result = await service.createCheckout({
    id:'ORDER-1',
    totalCents:2500,
    discountCents:0,
    shippingCents:0,
    inventoryReservationExpiresAt:reservation,
    customer:{email:'cliente@example.com'},
    items:[{productId:'P1',name:'Produto',variant:'',qty:1,unitPriceCents:2500}]
  }, 'https://loja.example.com', 1);
  assert.equal(result.id,'PREF-1');
  assert.equal(request.body.date_of_expiration,reservation);
  assert.equal(request.requestOptions.idempotencyKey,'pref-ORDER-1-1');
});
