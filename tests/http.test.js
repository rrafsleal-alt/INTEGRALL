import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

/**
 * Testes de integração HTTP: sobem o servidor REAL (node server.js) em uma
 * porta efêmera, em modo memória, e exercitam as rotas como um cliente faria.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_TOKEN = 'token-de-teste-http-0123456789abcdef';
const ADMIN = {Authorization: `Bearer ${ADMIN_TOKEN}`};

let child;

async function api(pathName, {method = 'GET', headers = {}, body} = {}) {
  const response = await fetch(`${BASE}${pathName}`, {
    method,
    headers: {'Content-Type': 'application/json', ...headers},
    body: body == null ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await response.json(); } catch {}
  return {status: response.status, data};
}

test.before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      DATABASE_URL: '',
      ADMIN_API_TOKEN: ADMIN_TOKEN,
      SHIPPING_MODE: 'fixed',
      SHIPPING_FIXED_CENTS: '1500',
      ORDER_EXPIRE_DAYS: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  // Aguarda o servidor aceitar conexões (até ~10s)
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const {status} = await api('/api/health');
      if (status === 200) return;
    } catch {}
    await delay(200);
  }
  throw new Error('Servidor de teste não subiu.');
});

test.after(() => {
  child?.kill('SIGTERM');
});

test('GET /api/health responde com recursos e versão', async () => {
  const {status, data} = await api('/api/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.match(data.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof data.features, 'object');
});

test('GET /api/catalog não vaza cupons nem segredos e marca isAlcoholic', async () => {
  const {status, data} = await api('/api/catalog');
  assert.equal(status, 200);
  assert.equal(data.coupons, undefined);
  assert.equal(data.commerce.adminApiToken, undefined);
  assert.ok(Array.isArray(data.products) && data.products.length >= 1);
  const wine = data.products.find(p => p.department === 'vinhos');
  assert.equal(wine.isAlcoholic, true);
  const juice = data.products.find(p => p.department === 'sucos');
  assert.equal(juice.isAlcoholic, false);
});

test('fluxo completo: pedido → status → admin pago → estoque → rastreio', async () => {
  const catalog = (await api('/api/catalog')).data;
  const wine = catalog.products.find(p => p.department === 'vinhos');
  const variant = wine.variants[0];
  const stockBefore = variant.stock;

  // sem 18+ → 400
  const denied = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-AGE', items: [{productId: wine.id, variantId: variant.id, qty: 1}],
    shipping: {choice: 'pickup'}, customer: {name: 'T', email: 't@example.com'}
  }});
  assert.equal(denied.status, 400);
  assert.match(denied.data.error, /18 anos/);

  // com 18+ → cria
  const created = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-OK', ageConfirmed: true,
    items: [{productId: wine.id, variantId: variant.id, qty: 2}],
    shipping: {choice: 'delivery', cep: '01310930', street: 'Av P', number: '1', neighborhood: 'B', city: 'SP', state: 'SP'},
    customer: {name: 'Cliente HTTP', email: 'http@example.com'}
  }});
  assert.equal(created.status, 201);
  const order = created.data.order;
  assert.equal(order.shippingCents, 1500); // modo fixed
  assert.ok(order.checkoutToken);

  // idempotência
  const repeat = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-OK', ageConfirmed: true,
    items: [{productId: wine.id, variantId: variant.id, qty: 2}],
    shipping: {choice: 'delivery', cep: '01310930', street: 'Av P', number: '1', neighborhood: 'B', city: 'SP', state: 'SP'},
    customer: {name: 'Cliente HTTP', email: 'http@example.com'}
  }});
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.idempotent, true);
  assert.equal(repeat.data.order.id, order.id);

  // preço malicioso é ignorado
  const hacked = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-HACK', ageConfirmed: true,
    items: [{productId: wine.id, variantId: variant.id, qty: 1, unitPriceCents: 1}],
    shipping: {choice: 'pickup'}, customer: {name: 'H', email: 'h@example.com'}
  }});
  assert.equal(hacked.data.order.totalCents, variant.price);

  // status com token errado → 404
  const wrong = await api('/api/orders/status', {method: 'POST', body: {orderId: order.id, checkoutToken: 'x'.repeat(48)}});
  assert.equal(wrong.status, 404);

  // status com token certo
  const statusOk = await api('/api/orders/status', {method: 'POST', body: {orderId: order.id, checkoutToken: order.checkoutToken}});
  assert.equal(statusOk.status, 200);
  assert.equal(statusOk.data.order.status, 'received');

  // admin sem token → 401
  assert.equal((await api('/api/admin/orders')).status, 401);

  // admin marca pago → estoque baixa
  const paid = await api(`/api/admin/orders/${order.id}`, {method: 'PATCH', headers: ADMIN, body: {status: 'paid'}});
  assert.equal(paid.status, 200);
  assert.ok(paid.data.order.inventoryCommittedAt);
  const after = (await api('/api/catalog')).data.products.find(p => p.id === wine.id).variants.find(v => v.id === variant.id);
  assert.equal(after.stock, stockBefore - 2);

  // rastreio: salvar e ver como cliente
  const tracked = await api(`/api/admin/orders/${order.id}/tracking`, {method: 'PATCH', headers: ADMIN, body: {trackingCode: 'aa 123456789 br', trackingCarrier: 'Correios'}});
  assert.equal(tracked.status, 200);
  assert.equal(tracked.data.order.trackingCode, 'AA123456789BR'); // normalizado (espaços removidos, maiúsculas)
  const clientView = await api('/api/orders/status', {method: 'POST', body: {orderId: order.id, checkoutToken: order.checkoutToken}});
  assert.equal(clientView.data.order.trackingCode, 'AA123456789BR');
});

test('cupons: admin cria, público valida, pedido aplica e catálogo não vaza', async () => {
  const saved = await api('/api/admin/coupons', {method: 'PUT', headers: ADMIN, body: {coupons: [
    {code: 'HTTP10', type: 'percent', value: 10},
    {code: 'MINIMO', type: 'fixed', value: 500, minSubtotalCents: 100000}
  ]}});
  assert.equal(saved.status, 200);

  const valid = await api('/api/coupons/validate', {method: 'POST', body: {code: 'http10', subtotalCents: 10000}});
  assert.equal(valid.status, 200);
  assert.equal(valid.data.discountCents, 1000);

  const below = await api('/api/coupons/validate', {method: 'POST', body: {code: 'MINIMO', subtotalCents: 5000}});
  assert.equal(below.status, 404);
  assert.match(below.data.error, /mínimo/);

  const catalog = (await api('/api/catalog')).data;
  const juice = catalog.products.find(p => p.department === 'sucos');
  const jv = juice.variants[0];
  const order = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-COUPON', couponCode: 'HTTP10',
    items: [{productId: juice.id, variantId: jv.id, qty: 2}],
    shipping: {choice: 'pickup'}, customer: {name: 'C', email: 'c@example.com'}
  }});
  assert.equal(order.status, 201);
  assert.equal(order.data.order.discountCents, Math.floor(jv.price * 2 * 0.1));
});

test('cotação manual de frete recalcula desconto de cupom free_shipping', async () => {
  await api('/api/admin/coupons', {method: 'PUT', headers: ADMIN, body: {coupons: [{code: 'FRETEZERO', type: 'free_shipping'}]}});
  const catalog = (await api('/api/catalog')).data;
  const juice = catalog.products.find(p => p.department === 'sucos');
  const order = (await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-FREESHIP', couponCode: 'FRETEZERO',
    items: [{productId: juice.id, variantId: juice.variants[0].id, qty: 1}],
    shipping: {choice: 'delivery', cep: '01310930', street: 'R', number: '1', neighborhood: 'B', city: 'SP', state: 'SP'},
    customer: {name: 'F', email: 'f@example.com'}
  }})).data.order;
  assert.equal(order.discountCents, 1500); // frete fixo 1500 zerado pelo cupom

  // Admin redefine o frete para 5000 → desconto deve acompanhar (bug C2 corrigido)
  const updated = await api(`/api/admin/orders/${order.id}/shipping`, {method: 'PATCH', headers: ADMIN, body: {shippingCents: 5000}});
  assert.equal(updated.status, 200);
  assert.equal(updated.data.order.discountCents, 5000);
  assert.equal(updated.data.order.totalCents, updated.data.order.subtotalCents); // frete grátis de verdade
});

test('quantidade mínima e catálogo protegidos', async () => {
  const catalog = (await api('/api/catalog')).data;
  const mentirinha = catalog.products.find(p => p.name === 'Mentirinha');
  const below = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-MIN', items: [{productId: mentirinha.id, qty: 1}],
    shipping: {choice: 'pickup'}, customer: {name: 'M', email: 'm@example.com'}
  }});
  assert.equal(below.status, 400);
  assert.match(below.data.error, /mínima/);

  // editor de produtos: preço inválido rejeitado, válido aplicado
  const badPrice = await api(`/api/admin/products/${mentirinha.id}`, {method: 'PATCH', headers: ADMIN, body: {price: -5}});
  assert.equal(badPrice.status, 400);
  const notFound = await api('/api/admin/products/nao-existe', {method: 'PATCH', headers: ADMIN, body: {price: 1000}});
  assert.equal(notFound.status, 404);
  const okPrice = await api(`/api/admin/products/${mentirinha.id}`, {method: 'PATCH', headers: ADMIN, body: {price: 5590}});
  assert.equal(okPrice.status, 200);
  assert.equal(okPrice.data.product.price, 5590);
});

test('rotas de pagamento/frete indisponíveis degradam com clareza', async () => {
  // Mercado Pago sem credenciais → 503
  const pay = await api('/api/payments/checkout', {method: 'POST', body: {orderId: 'X', checkoutToken: 'Y'}});
  assert.equal(pay.status, 503);
  // Cotação automática desabilitada (modo fixed) → 404
  const quote = await api('/api/shipping/quote', {method: 'POST', body: {cep: '01310930', items: [{productId: 'x', qty: 1}]}});
  assert.equal(quote.status, 404);
  // 404 de API em JSON
  const missing = await api('/api/nao-existe', {method: 'POST', body: {}});
  assert.equal(missing.status, 404);
  assert.ok(missing.data.error);
});

test('payment_review bloqueia novo checkout (evita cobrança dupla em mediação)', async () => {
  const catalog = (await api('/api/catalog')).data;
  const juice = catalog.products.find(p => p.department === 'sucos');
  const order = (await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-REVIEW',
    items: [{productId: juice.id, variantId: juice.variants[0].id, qty: 1}],
    shipping: {choice: 'pickup'}, customer: {name: 'R', email: 'r@example.com'}
  }})).data.order;
  await api(`/api/admin/orders/${order.id}`, {method: 'PATCH', headers: ADMIN, body: {status: 'payment_review'}});
  // Mercado Pago desconfigurado responde 503 ANTES da checagem de status;
  // então validamos pela flag pública onlinePaymentAvailable, que usa paymentCanStart.
  const status = await api('/api/orders/status', {method: 'POST', body: {orderId: order.id, checkoutToken: order.checkoutToken}});
  assert.equal(status.data.order.onlinePaymentAvailable, false);
});

test('robots.txt é servido e bloqueia /admin e /api', async () => {
  const response = await fetch(`${BASE}/robots.txt`);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /Disallow: \/admin/);
  assert.match(text, /Disallow: \/api\//);
});

test('frete não pode mudar com pagamento em andamento (preferência MP ativa)', async () => {
  const catalog = (await api('/api/catalog')).data;
  const juice = catalog.products.find(p => p.department === 'sucos');
  const order = (await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-AWAITING-SHIP',
    items: [{productId: juice.id, variantId: juice.variants[0].id, qty: 1}],
    shipping: {choice: 'delivery', cep: '01310930', street: 'R', number: '1', neighborhood: 'B', city: 'SP', state: 'SP'},
    customer: {name: 'A', email: 'a@example.com'}
  }})).data.order;
  await api(`/api/admin/orders/${order.id}`, {method: 'PATCH', headers: ADMIN, body: {status: 'awaiting_payment'}});
  const blocked = await api(`/api/admin/orders/${order.id}/shipping`, {method: 'PATCH', headers: ADMIN, body: {shippingCents: 9999}});
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /pagamento em andamento/i);
});
