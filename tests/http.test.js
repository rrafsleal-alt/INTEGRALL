import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {hashPassword} from '../src/auth.js';
import {isolatedHttpEnvironment} from './fixtures/http-environment.mjs';

/**
 * Testes de integração HTTP: sobem o servidor REAL (node server.js) em uma
 * porta efêmera e diretório temporário exclusivo por teste, e exercitam as rotas como um cliente faria.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let PORT;
let BASE;
let testDataDir;
const ADMIN = {};
const ADMIN_EMAIL = 'admin-test@integrall.local';
const ADMIN_PASSWORD = 'Teste-Seguro-123!';
const ADMIN_SESSION_SECRET = 'test-session-secret-with-more-than-thirty-two-characters';

// Missing integration dependencies are an error, never a green skipped suite.
await import('express');
const httpTest = (name, fn) => test(name, {timeout: 30_000, concurrency: false}, fn);

let child;
let childOutput = '';

async function api(pathName, {method = 'GET', headers = {}, body} = {}) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  let requestBody;
  if (body instanceof FormData || typeof body === 'string' || Buffer.isBuffer(body)) {
    requestBody = body;
  } else if (body != null) {
    requestHeaders.set('Content-Type', 'application/json');
    requestBody = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${pathName}`, {method, headers: requestHeaders, body: requestBody, signal: AbortSignal.timeout(10_000)});
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return {status: response.status, data, headers: response.headers};
}

test.beforeEach(async () => {
  childOutput = '';
  for (const key of Object.keys(ADMIN)) delete ADMIN[key];

  testDataDir = await mkdtemp(path.join(os.tmpdir(), 'integrall-http-'));
  const portProbe = createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  PORT = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  BASE = `http://127.0.0.1:${PORT}`;
  const passwordHash = await hashPassword(ADMIN_PASSWORD, {cost: 4096});
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...isolatedHttpEnvironment(process.env),
      NODE_ENV: 'test',
      ADMIN_DEFAULT_LOGIN_ENABLED: 'false',
      LOCAL_DATA_DIR: testDataDir,
      MERCADO_PAGO_ACCESS_TOKEN: '',
      MERCADO_PAGO_WEBHOOK_SECRET: '',
      SMTP_HOST: '',
      CORREIOS_USER: '',
      JADLOG_TOKEN: '',
      PUBLIC_URL: '',
      PORT: String(PORT),
      DATABASE_URL: '',
      SHIPPING_MODE: 'fixed',
      SHIPPING_FIXED_CENTS: '1500',
      FREE_SHIPPING_CENTS: '0',
      ORDER_EXPIRE_DAYS: '0',
      ADMIN_EMAIL,
      ADMIN_PASSWORD_HASH: passwordHash,
      ADMIN_SESSION_SECRET,
      ADMIN_ROLE: 'admin'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { childOutput = (childOutput + chunk.toString()).slice(-16000); });
  child.stderr.on('data', chunk => { childOutput = (childOutput + chunk.toString()).slice(-16000); });
  // Aguarda o servidor aceitar conexões (até ~10s)
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const {status} = await api('/api/health');
      if (status === 200) {
        const login = await api('/api/admin/session/login', {method: 'POST', body: {email: ADMIN_EMAIL, password: ADMIN_PASSWORD}});
        assert.equal(login.status, 200);
        const setCookie = login.headers.get('set-cookie');
        assert.ok(setCookie);
        ADMIN.Cookie = setCookie.split(';', 1)[0];
        ADMIN['X-CSRF-Token'] = login.data.csrfToken;
        return;
      }
    } catch (error) {
      if (attempt === 49) throw new Error(`Servidor de teste não subiu: ${error?.message || error}\n${childOutput.slice(-4000)}`);
    }
    await delay(200);
  }
  throw new Error(`Servidor de teste não subiu.\n${childOutput.slice(-4000)}`);
});

test.afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    const forceStop = setTimeout(() => child.kill('SIGKILL'), 5_000);
    try { await stopped; } finally { clearTimeout(forceStop); }
  }
  if (testDataDir) await rm(testDataDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  child = null;
  testDataDir = null;
});

httpTest('GET /api/health responde com recursos e versão', async () => {
  const {status, data} = await api('/api/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.match(data.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof data.features, 'object');
});

httpTest('admin exige sessão e CSRF nas operações de escrita', async () => {
  const session = await api('/api/admin/session', {headers: {Cookie: ADMIN.Cookie}});
  assert.equal(session.status, 200);
  assert.equal(session.data.authenticated, true);
  assert.equal(session.data.user.role, 'admin');

  const withoutCsrf = await api('/api/admin/coupons', {
    method: 'PUT',
    headers: {Cookie: ADMIN.Cookie},
    body: {coupons: []}
  });
  assert.equal(withoutCsrf.status, 403);
  assert.equal(withoutCsrf.data.code, 'ADMIN_CSRF_INVALID');
});

httpTest('GET /api/catalog não vaza cupons nem segredos e marca isAlcoholic', async () => {
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

httpTest('fluxo completo: pedido → status → admin pago → estoque → rastreio', async () => {
  const catalog = (await api('/api/catalog')).data;
  const wine = catalog.products.find(p => p.department === 'vinhos');
  const variant = wine.variants[0];
  const stockBefore = variant.stock;
  const orderKey = 'http-main-order-key-0123456789abcdef0123456789abcdef';

  // sem 18+ → 400
  const denied = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-AGE', items: [{productId: wine.id, variantId: variant.id, qty: 1}],
    shipping: {choice: 'pickup'}, customer: {name: 'T', email: 't@example.com'}
  }});
  assert.equal(denied.status, 400);
  assert.match(denied.data.error, /18 anos/);

  // com 18+ → cria
  const created = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-OK', clientOrderKey: orderKey, ageConfirmed: true,
    items: [{productId: wine.id, variantId: variant.id, qty: 2}],
    shipping: {choice: 'delivery', cep: '01310930', street: 'Av P', number: '1', neighborhood: 'B', city: 'SP', state: 'SP'},
    customer: {name: 'Cliente HTTP', email: 'http@example.com'}
  }});
  assert.equal(created.status, 201);
  const order = created.data.order;
  assert.equal(order.shippingCents, 1500); // modo fixed
  assert.ok(order.checkoutToken);
  const stock = async () => (await api('/api/catalog')).data.products.find(p => p.id === wine.id).variants.find(v => v.id === variant.id).stock;
  assert.equal(await stock(), stockBefore - 2, 'a criação reserva as duas unidades antes do pagamento');

  // idempotência
  const repeat = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-OK', clientOrderKey: orderKey, ageConfirmed: true,
    items: [{productId: wine.id, variantId: variant.id, qty: 2}],
    shipping: {choice: 'delivery', cep: '01310930', street: 'Av P', number: '1', neighborhood: 'B', city: 'SP', state: 'SP'},
    customer: {name: 'Cliente HTTP', email: 'http@example.com'}
  }});
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.idempotent, true);
  assert.equal(repeat.data.order.id, order.id);
  assert.equal(await stock(), stockBefore - 2, 'repetir a mesma criação não reserva de novo');

  // colisão de clientOrderId sem a capability correta nunca revela pedido/token
  const collision = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-OK', clientOrderKey: 'wrong-order-key-0123456789abcdef0123456789abcdef', ageConfirmed: true,
    items: [{productId: wine.id, variantId: variant.id, qty: 2}],
    shipping: {choice: 'delivery', cep: '01310930', street: 'Av P', number: '1', neighborhood: 'B', city: 'SP', state: 'SP'},
    customer: {name: 'Outro cliente', email: 'outro@example.com'}
  }});
  assert.equal(collision.status, 409);
  assert.equal(collision.data.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(collision.data.order, undefined);
  assert.equal(collision.data.checkoutToken, undefined);

  // preço malicioso é ignorado
  const hacked = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-HACK', ageConfirmed: true,
    items: [{productId: wine.id, variantId: variant.id, qty: 1, unitPriceCents: 1}],
    shipping: {choice: 'pickup'}, customer: {name: 'H', email: 'h@example.com'}
  }});
  assert.equal(hacked.status, 201);
  assert.equal(hacked.data.order.totalCents, variant.price);
  assert.equal(await stock(), stockBefore - 3, 'o segundo pedido reserva mais uma unidade');
  const cancelled = await api(`/api/admin/orders/${hacked.data.order.id}`, {method: 'PATCH', headers: ADMIN, body: {status: 'cancelled'}});
  assert.equal(cancelled.status, 200);
  assert.ok(cancelled.data.order.inventoryReservationReleasedAt);
  assert.equal(await stock(), stockBefore - 2, 'cancelar o segundo pedido repõe somente a sua unidade');
  assert.equal((await api(`/api/admin/orders/${hacked.data.order.id}`, {method: 'PATCH', headers: ADMIN, body: {status: 'cancelled'}})).status, 200);
  assert.equal(await stock(), stockBefore - 2, 'cancelamento repetido não repõe estoque duas vezes');

  // status com token errado → 404
  const wrong = await api('/api/orders/status', {method: 'POST', body: {orderId: order.id, checkoutToken: 'x'.repeat(48)}});
  assert.equal(wrong.status, 404);

  // status com token certo
  const statusOk = await api('/api/orders/status', {method: 'POST', body: {orderId: order.id, checkoutToken: order.checkoutToken}});
  assert.equal(statusOk.status, 200);
  assert.equal(statusOk.data.order.status, 'received');

  // admin sem sessão → recusado; com sessão → permitido
  assert.equal((await api('/api/admin/orders')).status, 401);
  assert.equal((await api('/api/admin/orders', {headers: ADMIN})).status, 200);

  // admin marca pago → reserva é comprometida, sem uma segunda baixa
  const paid = await api(`/api/admin/orders/${order.id}`, {method: 'PATCH', headers: ADMIN, body: {status: 'paid'}});
  assert.equal(paid.status, 200);
  assert.ok(paid.data.order.inventoryCommittedAt);
  const after = (await api('/api/catalog')).data.products.find(p => p.id === wine.id).variants.find(v => v.id === variant.id);
  assert.equal(after.stock, stockBefore - 2);
  assert.equal((await api(`/api/admin/orders/${order.id}`, {method: 'PATCH', headers: ADMIN, body: {status: 'paid'}})).status, 200);
  assert.equal(await stock(), stockBefore - 2, 'confirmação de pagamento repetida não baixa novamente');

  // rastreio: salvar e ver como cliente
  const tracked = await api(`/api/admin/orders/${order.id}/tracking`, {method: 'PATCH', headers: ADMIN, body: {trackingCode: 'aa 123456789 br', trackingCarrier: 'Correios'}});
  assert.equal(tracked.status, 200);
  assert.equal(tracked.data.order.trackingCode, 'AA123456789BR'); // normalizado (espaços removidos, maiúsculas)
  const clientView = await api('/api/orders/status', {method: 'POST', body: {orderId: order.id, checkoutToken: order.checkoutToken}});
  assert.equal(clientView.data.order.trackingCode, 'AA123456789BR');
});

httpTest('cupons: admin cria, público valida, pedido aplica e catálogo não vaza', async () => {
  const before = await api('/api/admin/coupons', {headers: ADMIN});
  assert.equal(before.status, 200);
  const missingRevision = await api('/api/admin/coupons', {method: 'PUT', headers: ADMIN, body: {coupons: []}});
  assert.equal(missingRevision.status, 409);
  assert.equal(missingRevision.data.code, 'SECTION_REVISION_CONFLICT');
  const saved = await api('/api/admin/coupons', {method: 'PUT', headers: ADMIN, body: {revision: before.data.revision, coupons: [
    {code: 'HTTP10', type: 'percent', value: 10},
    {code: 'MINIMO', type: 'fixed', value: 500, minSubtotalCents: 100000}
  ]}});
  assert.equal(saved.status, 200);
  assert.ok(saved.data.revision && saved.data.revision !== before.data.revision);
  const stale = await api('/api/admin/coupons', {method: 'PUT', headers: ADMIN, body: {revision: before.data.revision, coupons: []}});
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'SECTION_REVISION_CONFLICT');

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
  assert.equal((await api('/api/catalog')).data.coupons, undefined);
});

httpTest('cotação manual de frete recalcula desconto de cupom free_shipping', async () => {
  const before = await api('/api/admin/coupons', {headers: ADMIN});
  assert.equal(before.status, 200);
  const saved = await api('/api/admin/coupons', {method: 'PUT', headers: ADMIN, body: {revision: before.data.revision, coupons: [{code: 'FRETEZERO', type: 'free_shipping'}]}});
  assert.equal(saved.status, 200);
  const catalog = (await api('/api/catalog')).data;
  const juice = catalog.products.find(p => p.department === 'sucos');
  const created = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-FREESHIP', couponCode: 'FRETEZERO',
    items: [{productId: juice.id, variantId: juice.variants[0].id, qty: 1}],
    shipping: {choice: 'delivery', cep: '01310930', street: 'R', number: '1', neighborhood: 'B', city: 'SP', state: 'SP'},
    customer: {name: 'F', email: 'f@example.com'}
  }});
  assert.equal(created.status, 201);
  const order = created.data.order;
  assert.equal(order.discountCents, 1500); // frete fixo 1500 zerado pelo cupom

  // Admin redefine o frete para 5000 → desconto deve acompanhar (bug C2 corrigido)
  const updated = await api(`/api/admin/orders/${order.id}/shipping`, {method: 'PATCH', headers: ADMIN, body: {shippingCents: 5000}});
  assert.equal(updated.status, 200);
  assert.equal(updated.data.order.discountCents, 5000);
  assert.equal(updated.data.order.totalCents, updated.data.order.subtotalCents); // frete grátis de verdade
});

httpTest('quantidade mínima e catálogo protegidos', async () => {
  const catalog = (await api('/api/catalog')).data;
  const mentirinha = catalog.products.find(p => p.name === 'Mentirinha');
  const below = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-MIN', items: [{productId: mentirinha.id, qty: 1}],
    shipping: {choice: 'pickup'}, customer: {name: 'M', email: 'm@example.com'}
  }});
  assert.equal(below.status, 400);
  assert.match(below.data.error, /mínima/);

  // editor de produtos: a revisão vem do catálogo administrativo, não do público.
  const adminProducts = await api('/api/admin/products', {headers: ADMIN});
  assert.equal(adminProducts.status, 200);
  const editable = adminProducts.data.products.find(p => p.id === mentirinha.id);
  assert.ok(editable._revision);
  const noRevision = await api(`/api/admin/products/${mentirinha.id}`, {method: 'PATCH', headers: ADMIN, body: {price: 5590}});
  assert.equal(noRevision.status, 409);
  assert.equal(noRevision.data.code, 'PRODUCT_REVISION_CONFLICT');
  const badPrice = await api(`/api/admin/products/${mentirinha.id}`, {method: 'PATCH', headers: ADMIN, body: {expectedRevision: editable._revision, price: -5}});
  assert.equal(badPrice.status, 400);
  const notFound = await api('/api/admin/products/nao-existe', {method: 'PATCH', headers: ADMIN, body: {price: 1000}});
  assert.equal(notFound.status, 404);
  const okPrice = await api(`/api/admin/products/${mentirinha.id}`, {method: 'PATCH', headers: ADMIN, body: {expectedRevision: editable._revision, price: 5590}});
  assert.equal(okPrice.status, 200);
  assert.equal(okPrice.data.product.price, 5590);
  const stalePrice = await api(`/api/admin/products/${mentirinha.id}`, {method: 'PATCH', headers: ADMIN, body: {expectedRevision: editable._revision, price: 1234}});
  assert.equal(stalePrice.status, 409);
  assert.equal(stalePrice.data.code, 'PRODUCT_REVISION_CONFLICT');
  assert.equal((await api('/api/catalog')).data.products.find(p => p.id === mentirinha.id).price, 5590);
});

httpTest('rotas de pagamento/frete indisponíveis degradam com clareza', async () => {
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

httpTest('máquina de estados bloqueia regressão administrativa', async () => {
  const catalog = (await api('/api/catalog')).data;
  const juice = catalog.products.find(p => p.department === 'sucos');
  const created = await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-STATE-GUARD',
    items: [{productId: juice.id, variantId: juice.variants[0].id, qty: 1}],
    shipping: {choice: 'pickup'}, customer: {name: 'State', email: 'state@example.com'}
  }});
  const orderId = created.data.order.id;
  assert.equal((await api(`/api/admin/orders/${orderId}`, {method: 'PATCH', headers: ADMIN, body: {status: 'paid'}})).status, 200);
  const invalid = await api(`/api/admin/orders/${orderId}`, {method: 'PATCH', headers: ADMIN, body: {status: 'received'}});
  assert.equal(invalid.status, 409);
  assert.equal(invalid.data.code, 'ORDER_TRANSITION_INVALID');
});

httpTest('payment_review bloqueia novo checkout (evita cobrança dupla em mediação)', async () => {
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

httpTest('robots.txt bloqueia toda indexação fora de produção', async () => {
  const response = await fetch(`${BASE}/robots.txt`);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /User-agent: \*/);
  assert.match(text, /Disallow: \/(?:\n|$)/);
});

httpTest('frete não pode mudar no status aguardando pagamento, mesmo sem preferência registrada', async () => {
  const catalog = (await api('/api/catalog')).data;
  const juice = catalog.products.find(p => p.department === 'sucos');
  const order = (await api('/api/orders', {method: 'POST', body: {
    clientOrderId: 'HTTP-AWAITING-SHIP',
    items: [{productId: juice.id, variantId: juice.variants[0].id, qty: 1}],
    shipping: {choice: 'delivery', cep: '01310930', street: 'R', number: '1', neighborhood: 'B', city: 'SP', state: 'SP'},
    customer: {name: 'A', email: 'a@example.com'}
  }})).data.order;
  const waiting = await api(`/api/admin/orders/${order.id}`, {method: 'PATCH', headers: ADMIN, body: {status: 'awaiting_payment'}});
  assert.equal(waiting.status, 200);
  const totalBefore = waiting.data.order.totalCents;
  const blocked = await api(`/api/admin/orders/${order.id}/shipping`, {method: 'PATCH', headers: ADMIN, body: {shippingCents: 9999}});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'ORDER_PAYMENT_TOTAL_LOCKED');
  assert.match(blocked.data.error, /pagamento em andamento/i);
  const unchanged = await api(`/api/admin/orders/${order.id}`, {headers: ADMIN});
  assert.equal(unchanged.data.order.totalCents, totalBefore);
  assert.equal(unchanged.data.order.shippingCents, 1500);
});

httpTest('admin envia foto do computador e a mídia fica disponível', async () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4//8/AAX+Av7czFnnAAAAAElFTkSuQmCC';
  const uploaded = await api('/api/admin/media/product-image', {method: 'POST', headers: ADMIN, body: {dataUrl: tinyPng}});
  assert.equal(uploaded.status, 201);
  assert.match(uploaded.data.url, /^\/media\/products\/media-/);
  const response = await fetch(`${BASE}${uploaded.data.url}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.ok((await response.arrayBuffer()).byteLength > 0);
});

httpTest('admin cria produto com variações, aparece na loja e pode ser excluído', async () => {
  // sem token → recusado
  const denied = await api('/api/admin/products', {method: 'POST', body: {name: 'X'}});
  assert.equal(denied.status, 401);
  // cria com variações (subprodutos)
  const created = await api('/api/admin/products', {method: 'POST', headers: ADMIN, body: {
    name: 'Vinho Teste HTTP', department: 'vinhos', subcategory: 'Teste', brand: 'Casa Teste',
    price: 4990, unit: '750ml', description: 'Produto de teste automatizado.',
    stock: 10, weightGrams: 1300, lengthCm: 9, widthCm: 9, heightCm: 31,
    variants: [{name: '750ml', price: 4990, stock: 10, weightGrams: 1300}, {name: '375ml', price: 2990, stock: 5, weightGrams: 750}]
  }});
  assert.equal(created.status, 201);
  const product = created.data.product;
  assert.ok(product.id.startsWith('product-'));
  assert.equal(product.variants.length, 2);
  assert.ok(product.variants.every(v => v.id.startsWith('variant-')));
  // aparece no catálogo público
  const publicCatalog = (await api('/api/catalog')).data;
  const found = publicCatalog.products.find(p => p.id === product.id);
  assert.ok(found, 'produto criado deve aparecer na loja');
  assert.equal(found.isAlcoholic, true);
  // nome vazio → 400
  const invalid = await api('/api/admin/products', {method: 'POST', headers: ADMIN, body: {price: 100}});
  assert.equal(invalid.status, 400);
  // exclui
  const removed = await api(`/api/admin/products/${product.id}`, {method: 'DELETE', headers: ADMIN});
  assert.equal(removed.status, 200);
  const after = (await api('/api/catalog')).data;
  assert.ok(!after.products.some(p => p.id === product.id), 'produto excluído sai da loja');
  // Exclusão lógica é idempotente: repetir confirma 200 e conserva a âncora de estoque.
  const again = await api(`/api/admin/products/${product.id}`, {method: 'DELETE', headers: ADMIN});
  assert.equal(again.status, 200);
  const archivedCatalog = await api('/api/admin/catalog', {headers: ADMIN});
  const archived = archivedCatalog.data.catalog.products.find(p => p.id === product.id);
  assert.ok(archived.deletedAt);
  assert.equal(archived.hidden, true);
  assert.equal(archived.available, false);
  assert.equal(archived.variants.length, 2);
  assert.equal((await api('/api/catalog')).data.products.some(p => p.id === product.id), false);
  assert.equal((await api('/api/admin/products', {headers: ADMIN})).data.products.some(p => p.id === product.id), false);
  assert.equal((await api('/api/admin/products/inexistente', {method: 'DELETE', headers: ADMIN})).status, 404);
});

httpTest('admin salva personalização (settings + visual) e a loja pública reflete', async () => {
  const snapshot = await api('/api/admin/settings', {headers: ADMIN});
  assert.equal(snapshot.status, 200);
  const before = snapshot.data.settings;
  assert.ok(before && typeof before === 'object');
  const withoutRevision = await api('/api/admin/settings', {method: 'PUT', headers: ADMIN, body: {settings: {...before, brand: 'Sem revisão'}}});
  assert.equal(withoutRevision.status, 409);
  assert.equal(withoutRevision.data.code, 'SECTION_REVISION_CONFLICT');
  const saved = await api('/api/admin/settings', {method: 'PUT', headers: ADMIN, body: {revision: snapshot.data.revision, settings: {
    ...before,
    brand: 'INTEGRALL TESTE',
    catalogTitle: 'Título Personalizado',
    visual: {...before.visual, colors: {...before.visual?.colors, primary: '#123456'},
      typography: {...before.visual?.typography, headingFont: 'classic', baseSize: 18},
      layout: {...before.visual?.layout, gridColumnsDesktop: 4, cardStyle: 'boxed'}}
  }}});
  assert.equal(saved.status, 200);
  assert.equal(saved.data.settings.brand, 'INTEGRALL TESTE');
  assert.equal(saved.data.settings.visual.colors.primary, '#123456');
  assert.equal(saved.data.settings.visual.typography.headingFont, 'classic');
  assert.equal(saved.data.settings.visual.layout.gridColumnsDesktop, 4);
  const stale = await api('/api/admin/settings', {method: 'PUT', headers: ADMIN, body: {revision: snapshot.data.revision, settings: before}});
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'SECTION_REVISION_CONFLICT');
  // catálogo público reflete
  const pub = (await api('/api/catalog')).data;
  assert.equal(pub.settings.brand, 'INTEGRALL TESTE');
  assert.equal(pub.settings.visual.colors.primary, '#123456');
  // valores fora do limite são normalizados, não rejeitados
  const clamped = await api('/api/admin/settings', {method: 'PUT', headers: ADMIN, body: {revision: saved.data.revision, settings: {
    ...saved.data.settings, visual: {...saved.data.settings.visual, layout: {...saved.data.settings.visual.layout, gridColumnsDesktop: 99}}
  }}});
  assert.equal(clamped.status, 200);
  // restaura marca original para não interferir em outros testes
  const restored = await api('/api/admin/settings', {method: 'PUT', headers: ADMIN, body: {revision: clamped.data.revision, settings: before}});
  assert.equal(restored.status, 200);
});
