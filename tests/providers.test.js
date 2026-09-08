import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ShippingProvider,
  PaymentProvider,
  ProviderCapabilityError,
  assertShippingProvider,
  assertPaymentProvider
} from '../src/providers.js';
import {CorreiosService} from '../src/correios.js';
import {JadlogService} from '../src/jadlog.js';
import {MercadoPagoService} from '../src/payments.js';

test('contratos recusam capacidades não declaradas de forma explícita', async () => {
  const shipping = new ShippingProvider({providerId: 'dev'});
  await assert.rejects(() => shipping.createLabel({}), ProviderCapabilityError);
  const payment = new PaymentProvider({providerId: 'dev'});
  await assert.rejects(() => payment.refund('x', 100), ProviderCapabilityError);
});

test('providers reais satisfazem os contratos da aplicação', () => {
  const correios = new CorreiosService();
  const jadlog = new JadlogService();
  const mercadoPago = new MercadoPagoService({});
  assert.equal(assertShippingProvider(correios), correios);
  assert.equal(assertShippingProvider(jadlog), jadlog);
  assert.equal(assertPaymentProvider(mercadoPago), mercadoPago);
  assert.equal(correios.supports('quote'), true);
  assert.equal(correios.supports('label'), false);
  assert.equal(mercadoPago.supports('webhook'), true);
  assert.equal(mercadoPago.supports('refund'), false);
});
