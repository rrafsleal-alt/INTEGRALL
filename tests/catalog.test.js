import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCatalog, publicCatalog, buildOrder, calculateShipping} from '../src/catalog.js';

const raw = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const catalog = normalizeCatalog(raw);
const baseConfig = {
  mercadoPagoAccessToken: '',
  mercadoPagoWebhookSecret: '',
  whatsappNumber: '',
  shippingMode: 'fixed',
  shippingFixedCents: 1500,
  freeShippingCents: null
};

function simpleOrder(overrides = {}) {
  const product = catalog.products[0];
  return {
    clientOrderId: 'TEST-IDEMPOTENCY-1',
    customer: {name: 'Cliente', email: 'cliente@example.com'},
    shipping: {choice: 'pickup'},
    items: [{productId: product.id, variantId: product.variants?.[0]?.id || '', qty: 1}],
    ...overrides
  };
}

test('catálogo normaliza e não preserva segredos ou campos arbitrários', () => {
  assert.equal(catalog.products.length, 5);
  const poisoned = normalizeCatalog({
    ...raw,
    settings: {...raw.settings, internalSecret: 'settings-secret'},
    commerce: {...raw.commerce, adminApiToken: 'secret', accessToken: 'secret', webhookSecret: 'secret', arbitrarySecret: 'secret'},
    products: raw.products.map((product, index) => index ? product : {...product, internalSecret: 'product-secret', attributes: {...product.attributes, hiddenSecret: 'attribute-secret'}})
  });
  const published = publicCatalog(poisoned, baseConfig);
  assert.equal(published.settings.internalSecret, undefined);
  assert.equal(published.commerce.adminApiToken, undefined);
  assert.equal(published.commerce.accessToken, undefined);
  assert.equal(published.commerce.webhookSecret, undefined);
  assert.equal(published.commerce.arbitrarySecret, undefined);
  assert.equal(published.products[0].internalSecret, undefined);
  assert.equal(published.products[0].attributes.hiddenSecret, undefined);
  const legacyInput = {...raw, commerce: undefined, v8: {...raw.commerce, adminApiToken: 'legacy-secret'}};
  const legacy = normalizeCatalog(legacyInput);
  assert.equal(legacy.commerce.adminApiToken, undefined);
  assert.equal(legacy.commerce.paymentMethods.whatsapp, raw.commerce.paymentMethods.whatsapp);
});

test('catálogo público só habilita meios realmente configurados no servidor', () => {
  const noChannels = publicCatalog(catalog, baseConfig);
  assert.equal(noChannels.commerce.paymentMethods.card, false);
  assert.equal(noChannels.commerce.paymentMethods.whatsapp, false);
  const enabled = publicCatalog(catalog, {...baseConfig, mercadoPagoAccessToken: 'APP_USR_TEST', mercadoPagoWebhookSecret: 'webhook-test-secret', whatsappNumber: '5511999999999'});
  assert.equal(enabled.commerce.paymentMethods.card, true);
  assert.equal(enabled.commerce.paymentMethods.whatsapp, false);
  assert.equal(enabled.settings.whatsapp, '5511999999999');
});

test('pedido ignora preço enviado pelo navegador e recalcula no servidor', () => {
  const product = catalog.products[0];
  const expectedUnit = product.variants?.[0]?.price ?? product.price;
  const order = buildOrder({
    ...simpleOrder(),
    items: [{productId: product.id, variantId: product.variants?.[0]?.id || '', qty: 2, unitPriceCents: 1, price: 1}]
  }, catalog, baseConfig);
  assert.equal(order.items[0].unitPriceCents, expectedUnit);
  assert.equal(order.subtotalCents, expectedUnit * 2);
  assert.equal(order.shippingCents, 0);
  assert.equal(order.totalCents, expectedUnit * 2);
});

test('pedido gera id forte e token de checkout de capacidade', () => {
  const order = buildOrder(simpleOrder({clientOrderId: 'TOKEN-TEST'}), catalog, baseConfig);
  assert.match(order.id, /^INT-\d{8}-[A-F0-9]{16}$/);
  assert.match(order.checkoutToken, /^[a-f0-9]{48}$/);
});

test('frete fixo e frete grátis são calculados no servidor', () => {
  const fixed = calculateShipping({choice: 'delivery', cep: '01310930'}, 10000, catalog.settings, baseConfig);
  assert.equal(fixed.priceCents, 1500);
  assert.equal(fixed.quoted, false);
  const free = calculateShipping({choice: 'delivery', cep: '01310930'}, 10000, catalog.settings, {...baseConfig, freeShippingCents: 9000});
  assert.equal(free.priceCents, 0);
  assert.equal(free.label, 'Frete grátis');
});

test('modo cotação impede inventar preço de frete', () => {
  const quote = calculateShipping({choice: 'delivery', cep: '01310930'}, 10000, catalog.settings, {...baseConfig, shippingMode: 'quote'});
  assert.equal(quote.priceCents, null);
  assert.equal(quote.quoted, true);
});

test('pedido rejeita quantidade inválida, produto inexistente e email inválido', () => {
  const product = catalog.products[0];
  assert.throws(() => buildOrder({shipping:{choice:'pickup'},items:[{productId:product.id,qty:0}]}, catalog, baseConfig), /Quantidade inválida/);
  assert.throws(() => buildOrder({shipping:{choice:'pickup'},items:[{productId:'produto-que-nao-existe',qty:1}]}, catalog, baseConfig), /não está mais disponível/);
  assert.throws(() => buildOrder(simpleOrder({customer:{email:'invalido'}}), catalog, baseConfig), /E-mail inválido/);
});

test('catálogo rejeita ids de produto e variante duplicados', () => {
  assert.throws(() => normalizeCatalog({...raw, products: [raw.products[0], raw.products[0]]}), /produto duplicado/i);
  const product = raw.products.find(item => (item.variants || []).length) || raw.products[0];
  const duplicatedVariant = {...product, variants: [product.variants[0], product.variants[0]]};
  assert.throws(() => normalizeCatalog({...raw, products: [duplicatedVariant]}), /variante duplicado/i);
});

test('URLs inseguras de imagens importadas são descartadas', () => {
  const product = {...raw.products[0], images: ['javascript:alert(1)', 'http://inseguro.example/a.webp', '/assets/products/01-suco-integral-de-uva-bord.webp']};
  const normalized = normalizeCatalog({...raw, products:[product]});
  assert.deepEqual(normalized.products[0].images, ['/assets/products/01-suco-integral-de-uva-bord.webp']);
});

test('catálogo rejeita preço negativo', () => {
  const product = {...raw.products[0], price: -1};
  assert.throws(() => normalizeCatalog({...raw, products:[product]}), /Preço inválido/);
});

test('quantidades repetidas não contornam limite por pedido nem estoque', () => {
  const baseProduct = catalog.products[0];
  const limitedCatalog = structuredClone(catalog);
  const target = limitedCatalog.products.find(item => item.id === baseProduct.id);
  target.maxPerOrder = 3;
  if (target.variants?.[0]) target.variants[0].stock = 4;
  const variantId = target.variants?.[0]?.id || '';
  assert.throws(() => buildOrder({
    shipping:{choice:'pickup'},
    items:[
      {productId:target.id,variantId,qty:2},
      {productId:target.id,variantId,qty:2}
    ]
  }, limitedCatalog, baseConfig), /Quantidade máxima/);

  target.maxPerOrder = 99;
  assert.throws(() => buildOrder({
    shipping:{choice:'pickup'},
    items:[
      {productId:target.id,variantId,qty:3},
      {productId:target.id,variantId,qty:2}
    ]
  }, limitedCatalog, baseConfig), /Estoque insuficiente/);
});

test('frete fixo negativo de ambiente nunca reduz o total', () => {
  const quote = calculateShipping({choice:'delivery',cep:'01310930'}, 10000, catalog.settings, {...baseConfig, shippingFixedCents:-500});
  assert.equal(quote.priceCents, 0);
});

test('entrega exige endereço completo e contato', () => {
  const product = catalog.products[0];
  const variantId = product.variants?.[0]?.id || '';
  assert.throws(() => buildOrder({
    clientOrderId:'ADDRESS-1',customer:{name:'Cliente',email:'cliente@example.com'},shipping:{choice:'delivery',cep:'01310930'},items:[{productId:product.id,variantId,qty:1}]
  }, catalog, baseConfig), /endereço completo/i);
  const order = buildOrder({
    clientOrderId:'ADDRESS-2',customer:{name:'Cliente',email:'cliente@example.com'},shipping:{choice:'delivery',cep:'01310930',street:'Av. Paulista',number:'1000',neighborhood:'Bela Vista',city:'São Paulo',state:'SP'},items:[{productId:product.id,variantId,qty:1}]
  }, catalog, baseConfig);
  assert.equal(order.shipping.street,'Av. Paulista');
  assert.equal(order.shipping.state,'SP');
});

test('pedido com bebida alcoólica exige confirmação de maioridade', () => {
  const wine = catalog.products.find(product => product.department === 'vinhos');
  assert.ok(wine, 'catálogo precisa ter um vinho para este teste');
  const base = {
    clientOrderId: 'AGE-1',
    customer: {name: 'Cliente', email: 'cliente@example.com'},
    shipping: {choice: 'pickup'},
    items: [{productId: wine.id, variantId: wine.variants?.[0]?.id || '', qty: 1}]
  };
  assert.throws(() => buildOrder(base, catalog, baseConfig), /18 anos/);
  const confirmed = buildOrder({...base, ageConfirmed: true}, catalog, baseConfig);
  assert.equal(confirmed.containsAlcohol, true);
  assert.equal(confirmed.ageConfirmed, true);
  const juice = catalog.products.find(product => product.department === 'sucos');
  const soft = buildOrder({
    clientOrderId: 'AGE-2',
    customer: {name: 'Cliente', email: 'cliente@example.com'},
    shipping: {choice: 'pickup'},
    items: [{productId: juice.id, variantId: juice.variants?.[0]?.id || '', qty: 1}]
  }, catalog, baseConfig);
  assert.equal(soft.containsAlcohol, false);
});

test('cupons são normalizados, aplicados no servidor e não vazam no catálogo público', () => {
  const withCoupons = normalizeCatalog({
    ...raw,
    coupons: [
      {code: 'bemvindo10', type: 'percent', value: 10},
      {code: 'FRETEGRATIS', type: 'free_shipping'},
      {code: 'INVALIDO', type: 'hack', value: 99},
      {code: 'AB', type: 'percent', value: 10},
      {code: 'FIXO5', type: 'fixed', value: 500, minSubtotalCents: 3000}
    ]
  });
  assert.equal(withCoupons.coupons.length, 3);
  assert.equal(withCoupons.coupons[0].code, 'BEMVINDO10');
  const published = publicCatalog(withCoupons, baseConfig);
  assert.equal(published.coupons, undefined);

  const juice = withCoupons.products.find(product => product.department === 'sucos');
  const expectedUnit = juice.variants?.[0]?.price ?? juice.price;
  const order = buildOrder({
    clientOrderId: 'COUPON-1',
    customer: {name: 'Cliente', email: 'cliente@example.com'},
    shipping: {choice: 'pickup'},
    items: [{productId: juice.id, variantId: juice.variants?.[0]?.id || '', qty: 2}],
    couponCode: 'bemvindo10'
  }, withCoupons, baseConfig);
  const subtotal = expectedUnit * 2;
  const expectedDiscount = Math.floor(subtotal * 10 / 100);
  assert.equal(order.discountCents, expectedDiscount);
  assert.equal(order.totalCents, subtotal - expectedDiscount);
  assert.equal(order.coupon.code, 'BEMVINDO10');

  assert.throws(() => buildOrder({
    clientOrderId: 'COUPON-2',
    customer: {name: 'Cliente', email: 'cliente@example.com'},
    shipping: {choice: 'pickup'},
    items: [{productId: juice.id, variantId: juice.variants?.[0]?.id || '', qty: 1}],
    couponCode: 'NAOEXISTE'
  }, withCoupons, baseConfig), /[Cc]upom/);

  assert.throws(() => buildOrder({
    clientOrderId: 'COUPON-3',
    customer: {name: 'Cliente', email: 'cliente@example.com'},
    shipping: {choice: 'pickup'},
    items: [{productId: juice.id, variantId: juice.variants?.[0]?.id || '', qty: 1}],
    couponCode: 'FIXO5'
  }, withCoupons, baseConfig), /mínimo/);
});

test('cupom nunca zera nem negativa o total e expira corretamente', () => {
  const withCoupons = normalizeCatalog({
    ...raw,
    coupons: [
      {code: 'MEGA', type: 'fixed', value: 100_000_000},
      {code: 'VENCIDO', type: 'percent', value: 10, expiresAt: '2020-01-01T00:00:00-03:00'}
    ]
  });
  const juice = withCoupons.products.find(product => product.department === 'sucos');
  const expectedUnit = juice.variants?.[0]?.price ?? juice.price;
  const order = buildOrder({
    clientOrderId: 'COUPON-4',
    customer: {name: 'Cliente', email: 'cliente@example.com'},
    shipping: {choice: 'pickup'},
    items: [{productId: juice.id, variantId: juice.variants?.[0]?.id || '', qty: 1}],
    couponCode: 'MEGA'
  }, withCoupons, baseConfig);
  assert.ok(order.totalCents >= 100, 'total nunca fica abaixo de R$ 1,00');
  assert.equal(order.totalCents, expectedUnit - order.discountCents);

  assert.throws(() => buildOrder({
    clientOrderId: 'COUPON-5',
    customer: {name: 'Cliente', email: 'cliente@example.com'},
    shipping: {choice: 'pickup'},
    items: [{productId: juice.id, variantId: juice.variants?.[0]?.id || '', qty: 1}],
    couponCode: 'VENCIDO'
  }, withCoupons, baseConfig), /expirou/);
});

test('cupom de frete grátis desconta exatamente o frete calculado', () => {
  const withCoupons = normalizeCatalog({...raw, coupons: [{code: 'FRETEGRATIS', type: 'free_shipping'}]});
  const juice = withCoupons.products.find(product => product.department === 'sucos');
  const expectedUnit = juice.variants?.[0]?.price ?? juice.price;
  const order = buildOrder({
    clientOrderId: 'COUPON-6',
    customer: {name: 'Cliente', email: 'cliente@example.com'},
    shipping: {choice: 'delivery', cep: '01310930', street: 'Av. Paulista', number: '1000', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP'},
    items: [{productId: juice.id, variantId: juice.variants?.[0]?.id || '', qty: 1}],
    couponCode: 'FRETEGRATIS'
  }, withCoupons, {...baseConfig, shippingMode: 'fixed', shippingFixedCents: 1500});
  assert.equal(order.discountCents, 1500);
  assert.equal(order.totalCents, expectedUnit + 1500 - 1500);

  assert.throws(() => buildOrder({
    clientOrderId: 'COUPON-7',
    customer: {name: 'Cliente', email: 'cliente@example.com'},
    shipping: {choice: 'pickup'},
    items: [{productId: juice.id, variantId: juice.variants?.[0]?.id || '', qty: 1}],
    couponCode: 'FRETEGRATIS'
  }, withCoupons, baseConfig), /entrega/);
});
