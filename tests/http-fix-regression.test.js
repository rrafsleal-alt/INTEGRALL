import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Repository} from '../src/repository.js';
import {normalizeCatalog, publicCatalog, buildOrder} from '../src/catalog.js';
import {sectionRevision, productRevision} from '../src/catalog-revision.js';
import {assertShippingEditable} from '../src/order-financials.js';
import {claimCheckout, clearCheckoutClaimPatch, completeCheckoutPatch} from '../src/payment-checkout-guard.js';
import {isolatedHttpEnvironment} from './fixtures/http-environment.mjs';
import {createRouteInvoker} from './fixtures/server-route-handler.mjs';

// Estoque e valores exclusivamente sintéticos. Não alteram o catálogo da loja.
const seed = () => normalizeCatalog({settings: {brand: 'Fixture HTTP', free: 0}, commerce: {}, products: [
  {id: 'P1', name: 'Produto de teste', department: 'outros', price: 1000, stock: 20, available: true,
    variants: [{id: 'V1', name: 'Unidade', price: 1000, stock: 20}], images: []}
]});
const shipping = {choice: 'delivery', cep: '01001000', street: 'Rua Teste', number: '1', neighborhood: 'Centro', city: 'São Paulo', state: 'SP'};
async function fixture(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'integrall-handler-regression-'));
  const repo = new Repository({databaseUrl: '', initialCatalog: seed(), localDataDir: dir});
  try {
    await repo.init();
    const invoke = await createRouteInvoker(repo);
    const createOrder = async (clientOrderId, qty = 1, extra = {}) => {
      const order = buildOrder({clientOrderId, items: [{productId: 'P1', variantId: 'V1', qty}], shipping,
        customer: {name: 'Cliente Teste', email: 'fixture@example.invalid'}, ...extra}, await repo.getCatalog(),
        {shippingMode: 'fixed', shippingFixedCents: 1500, freeShippingCents: 0});
      return (await repo.createOrder(order)).order;
    };
    await fn({repo, invoke, createOrder});
  } finally { await repo.close(); await rm(dir, {recursive: true, force: true, maxRetries: 3, retryDelay: 100}); }
}
const updateShipping = (invoke, id, amount = 9999) => invoke('PATCH', '/api/admin/orders/:id/shipping', {params: {id}, body: {shippingCents: amount}});
const productStock = async repo => (await repo.getCatalog()).products[0].variants[0].stock;

// Este arquivo verifica callbacks reais sem Express. Não é uma suíte HTTP substituta.
test('HTTPFIX-STOCK: duas reservas, cancelamento e pagamento não duplicam a baixa', () => fixture(async ({repo, invoke, createOrder}) => {
  const first = await createOrder('stock-first', 2);
  assert.equal(await productStock(repo), 18);
  const repeat = await repo.createOrder(first);
  assert.equal(repeat.created, false);
  assert.equal(await productStock(repo), 18);
  const second = await createOrder('stock-second', 1);
  assert.equal(await productStock(repo), 17);
  const cancel = () => invoke('PATCH', '/api/admin/orders/:id', {params: {id: second.id}, body: {status: 'cancelled'}});
  assert.equal((await cancel()).status, 200);
  assert.equal(await productStock(repo), 18);
  assert.equal((await cancel()).status, 200);
  assert.equal(await productStock(repo), 18);
  const pay = () => invoke('PATCH', '/api/admin/orders/:id', {params: {id: first.id}, body: {status: 'paid'}});
  const paid = await pay(); assert.equal(paid.status, 200); assert.ok(paid.data.order.inventoryCommittedAt);
  assert.equal((await pay()).status, 200);
  assert.equal(await productStock(repo), 18);
}));

test('HTTPFIX-COUPON: revisão obrigatória; gravação válida; revisão antiga não sobrescreve', () => fixture(async ({repo, invoke}) => {
  const before = await invoke('GET', '/api/admin/coupons');
  const coupons = [{code: 'FIX10', type: 'percent', value: 10}];
  const missing = await invoke('PUT', '/api/admin/coupons', {body: {coupons}});
  assert.equal(missing.status, 409); assert.equal(missing.data.code, 'SECTION_REVISION_CONFLICT');
  assert.equal(sectionRevision((await repo.getCatalog()).coupons), before.data.revision);
  const good = await invoke('PUT', '/api/admin/coupons', {body: {revision: before.data.revision, coupons}});
  assert.equal(good.status, 200);
  const stale = await invoke('PUT', '/api/admin/coupons', {body: {revision: before.data.revision, coupons: []}});
  assert.equal(stale.status, 409);
  assert.equal((await repo.getCatalog()).coupons[0].code, 'FIX10');
  assert.equal(publicCatalog(await repo.getCatalog(), {}).coupons, undefined);
}));

test('HTTPFIX-COUPON: frete grátis acompanha cotação manual após salvar cupom com revisão', () => fixture(async ({repo, invoke, createOrder}) => {
  const before = await invoke('GET', '/api/admin/coupons');
  const saved = await invoke('PUT', '/api/admin/coupons', {body: {revision: before.data.revision, coupons: [{code: 'FRETEZERO', type: 'free_shipping'}]}});
  assert.equal(saved.status, 200);
  const order = await createOrder('coupon-order', 1, {couponCode: 'FRETEZERO'});
  assert.equal(order.discountCents, 1500);
  const changed = await updateShipping(invoke, order.id, 5000);
  assert.equal(changed.status, 200); assert.equal(changed.data.order.discountCents, 5000);
  assert.equal(changed.data.order.totalCents, changed.data.order.subtotalCents);
  assert.equal((await repo.getOrder(order.id)).totalCents, 1000);
}));

test('HTTPFIX-PRODUCT: preço inválido com revisão retorna 400; sem revisão retorna 409', () => fixture(async ({repo, invoke}) => {
  const read = await invoke('GET', '/api/admin/products'); const before = read.data.products[0];
  assert.equal((await invoke('PATCH', '/api/admin/products/:id', {params: {id: 'P1'}, body: {price: -1}})).status, 409);
  const invalid = await invoke('PATCH', '/api/admin/products/:id', {params: {id: 'P1'}, body: {expectedRevision: before._revision, price: -1}});
  assert.equal(invalid.status, 400);
  assert.equal(productRevision((await repo.getCatalog()).products[0]), before._revision);
  const good = await invoke('PATCH', '/api/admin/products/:id', {params: {id: 'P1'}, body: {expectedRevision: before._revision, price: 5590}});
  assert.equal(good.status, 200); assert.equal(good.data.product.price, 5590);
  assert.equal((await invoke('PATCH', '/api/admin/products/:id', {params: {id: 'P1'}, body: {expectedRevision: before._revision, price: 1234}})).status, 409);
  assert.equal((await repo.getCatalog()).products[0].price, 5590);
}));

test('HTTPFIX-PRODUCT: reserva concorrente invalida revisão sem permitir sobrescrever estoque', () => fixture(async ({repo, invoke, createOrder}) => {
  const before = (await invoke('GET', '/api/admin/products')).data.products[0];
  await createOrder('stock-revision', 2);
  const stale = await invoke('PATCH', '/api/admin/products/:id', {params: {id: 'P1'}, body: {expectedRevision: before._revision, variants: before.variants}});
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'PRODUCT_REVISION_CONFLICT');
  assert.equal(await productStock(repo), 18);
}));

test('HTTPFIX-SETTINGS: personalização usa revisão e preserva gravação recente', () => fixture(async ({repo, invoke}) => {
  const before = await invoke('GET', '/api/admin/settings');
  const settings = {...before.data.settings, brand: 'Marca de teste', visual: {colors: {primary: '#123456'}}};
  assert.equal((await invoke('PUT', '/api/admin/settings', {body: {settings}})).status, 409);
  const good = await invoke('PUT', '/api/admin/settings', {body: {revision: before.data.revision, settings}});
  assert.equal(good.status, 200); assert.equal(good.data.settings.visual.colors.primary, '#123456');
  const stale = await invoke('PUT', '/api/admin/settings', {body: {revision: before.data.revision, settings: before.data.settings}});
  assert.equal(stale.status, 409);
  assert.equal((await repo.getCatalog()).settings.brand, 'Marca de teste');
  const restored = await invoke('PUT', '/api/admin/settings', {body: {revision: good.data.revision, settings: before.data.settings}});
  assert.equal(restored.status, 200); assert.equal((await repo.getCatalog()).settings.brand, before.data.settings.brand);
}));

test('HTTPFIX-SETTINGS: duas gravações na mesma revisão permitem exatamente uma', () => fixture(async ({repo, invoke}) => {
  const before = await invoke('GET', '/api/admin/settings');
  const results = await Promise.all(['A', 'B'].map(brand => invoke('PUT', '/api/admin/settings', {body: {revision: before.data.revision, settings: {...before.data.settings, brand}}})));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await repo.getCatalog()).settings.brand, results.find(r => r.status === 200).data.settings.brand);
}));

test('HTTPFIX-DELETE: excluir duas vezes mantém tombstone e cancelamento restitui reserva', () => fixture(async ({repo, invoke, createOrder}) => {
  const order = await createOrder('deleted-order', 2);
  const remove = () => invoke('DELETE', '/api/admin/products/:id', {params: {id: 'P1'}});
  assert.equal((await remove()).status, 200);
  const first = (await repo.getCatalog()).products[0]; assert.ok(first.deletedAt);
  assert.equal((await remove()).status, 200);
  const again = (await repo.getCatalog()).products[0]; assert.equal(again.deletedAt, first.deletedAt);
  assert.equal(again.variants[0].stock, 18);
  assert.equal(publicCatalog(await repo.getCatalog(), {}).products.length, 0);
  assert.equal((await invoke('GET', '/api/admin/products')).data.products.length, 0);
  assert.equal((await invoke('PATCH', '/api/admin/orders/:id', {params: {id: order.id}, body: {status: 'cancelled'}})).status, 200);
  assert.equal(await productStock(repo), 20);
  assert.equal(publicCatalog(await repo.getCatalog(), {}).products.length, 0);
  assert.equal((await invoke('DELETE', '/api/admin/products/:id', {params: {id: 'absent'}})).status, 404);
}));

for (const status of ['awaiting_payment', 'payment_review']) {
  test(`HTTPFIX-SHIPPING: handler recusa ${status} sem alterar total ou histórico`, () => fixture(async ({repo, invoke, createOrder}) => {
    const order = await createOrder(`locked-${status}`);
    await repo.updateOrder(order.id, {status}); const before = await repo.getOrder(order.id);
    const result = await updateShipping(invoke, order.id);
    assert.equal(result.status, 409); assert.equal(result.data.code, 'ORDER_PAYMENT_TOTAL_LOCKED');
    assert.deepEqual(await repo.getOrder(order.id), before);
  }));
}
for (const state of [
  {name: 'preferência ativa', payment: {preferenceId: 'FIXTURE-PREFERENCE'}},
  {name: 'claim ainda sem preferência', payment: {checkoutClaimId: 'fixture-claim', checkoutInProgressAt: new Date().toISOString(), checkoutPendingAttempt: 1}},
  {name: 'timeout com tentativa pendente', payment: {checkoutClaimId: '', checkoutInProgressAt: '', checkoutPendingAttempt: 1}},
  {name: 'claim antigo não prova ausência de cobrança', payment: {checkoutClaimId: 'old-claim', checkoutInProgressAt: '2000-01-01T00:00:00.000Z'}},
  {name: 'tentativa malformada falha fechada', payment: {checkoutPendingAttempt: 'not-a-number'}}
]) {
  test(`HTTPFIX-SHIPPING: ${state.name} bloqueia ajuste financeiro`, () => fixture(async ({repo, invoke, createOrder}) => {
    const order = await createOrder('provider-marker');
    await repo.updateOrder(order.id, {payment: state.payment}); const before = await repo.getOrder(order.id);
    const result = await updateShipping(invoke, order.id);
    assert.equal(result.status, 409); assert.equal(result.data.code, 'ORDER_PAYMENT_TOTAL_LOCKED');
    assert.deepEqual(await repo.getOrder(order.id), before);
  }));
}

test('HTTPFIX-SHIPPING: tentativa no provedor bloqueia mesmo sem preferenceId e após timeout', () => fixture(async ({repo, invoke, createOrder}) => {
  const order = await createOrder('race-order');
  await repo.updateOrder(order.id, current => ({payment: claimCheckout(current, {claimId: 'checkout-test'}).payment}));
  assert.equal((await repo.getOrder(order.id)).payment.preferenceId, '');
  assert.equal((await updateShipping(invoke, order.id)).status, 409);
  await repo.updateOrder(order.id, current => clearCheckoutClaimPatch(current, 'checkout-test'));
  assert.equal((await updateShipping(invoke, order.id)).status, 409);
  await repo.updateOrder(order.id, current => ({payment: claimCheckout(current, {claimId: 'retry'}).payment}));
  await repo.updateOrder(order.id, current => completeCheckoutPatch(current, {claimId: 'retry', attempt: 1, checkout: {id: 'fixture-pref', url: 'https://example.invalid/fixture'}}));
  assert.equal((await updateShipping(invoke, order.id)).status, 409);
  assert.equal((await repo.getOrder(order.id)).totalCents, order.totalCents);
}));

test('HTTPFIX-SHIPPING: erro de persistência não muda total apenas em memória', () => fixture(async ({repo, invoke, createOrder}) => {
  const order = await createOrder('disk-error'); const before = await repo.getOrder(order.id);
  const persist = repo.persistLocalState;
  repo.persistLocalState = async () => { throw new Error('fixture-disk-error'); };
  try { await assert.rejects(updateShipping(invoke, order.id), /fixture-disk-error/); }
  finally { repo.persistLocalState = persist; }
  assert.deepEqual(await repo.getOrder(order.id), before);
}));

test('HTTPFIX-SHIPPING: valores inválidos, retirada e pedido inexistente continuam recusados', () => fixture(async ({invoke, createOrder}) => {
  const pickup = await createOrder('pickup', 1, {shipping: {choice: 'pickup'}});
  assert.equal((await updateShipping(invoke, pickup.id)).status, 409);
  const delivery = await createOrder('bad-amount');
  for (const amount of [-1, 1.2, 'invalid']) assert.equal((await updateShipping(invoke, delivery.id, amount)).status, 400);
  assert.equal((await updateShipping(invoke, 'absent')).status, 404);
}));

test('HTTPFIX-SHIPPING: apenas estado aberto sem tentativa aceita cotação; finais falham fechados', () => {
  const order = {shipping: {choice: 'delivery'}, status: 'received', payment: {}};
  assert.equal(assertShippingEditable(order), true);
  assert.equal(assertShippingEditable({...order, status: 'payment_failed'}), true);
  for (const status of ['paid', 'preparing', 'ready', 'completed', 'refunded', 'chargeback', 'cancelled', 'payment_expired', '', 'unknown']) {
    assert.throws(() => assertShippingEditable({...order, status}), {code: 'ORDER_SHIPPING_LOCKED'});
  }
  assert.throws(() => assertShippingEditable({...order, inventoryCommittedAt: 'fixture'}), {code: 'ORDER_SHIPPING_LOCKED'});
  assert.throws(() => assertShippingEditable({...order, inventoryReservationReleasedAt: 'fixture'}), {code: 'ORDER_SHIPPING_LOCKED'});
});

test('HTTPFIX-ISOLATION: filho HTTP não herda credenciais, flags Node ou conexão real', () => {
  const source = {Path: 'fixture-path', SystemRoot: 'fixture-system', TEMP: 'fixture-temp', HOME: 'fixture-home',
    DATABASE_URL: 'private', CORREIOS_USER: 'private', CORREIOS_ACCESS_CODE: 'private', MERCADO_PAGO_ACCESS_TOKEN: 'private',
    SMTP_HOST: 'private', CUSTOMER_AUTH_SECRET: 'private', FREE_SHIPPING_CENTS: '1', NODE_OPTIONS: '--env-file=.env', LOCAL_DATA_DIR: 'private'};
  assert.deepEqual(isolatedHttpEnvironment(source), {Path: 'fixture-path', SystemRoot: 'fixture-system', TEMP: 'fixture-temp', HOME: 'fixture-home'});
  assert.equal(source.DATABASE_URL, 'private', 'não modifica o ambiente do processo chamador');
});

test('HTTPFIX-ISOLATION: suíte Express é obrigatória, isolada por teste e mantém validações negativas', async () => {
  const text = await readFile(new URL('./http.test.js', import.meta.url), 'utf8');
  assert.match(text, /await import\('express'\)/);
  assert.match(text, /test\.beforeEach\(/); assert.match(text, /test\.afterEach\(/);
  assert.match(text, /isolatedHttpEnvironment\(process\.env\)/);
  assert.match(text, /LOCAL_DATA_DIR: testDataDir/);
  assert.doesNotMatch(text, /\.skip\(|skip:\s*true/);
  assert.match(text, /ADMIN_CSRF_INVALID/); assert.match(text, /IDEMPOTENCY_CONFLICT/);
});
