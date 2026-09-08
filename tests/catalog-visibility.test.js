import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, readdir, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeCatalog, publicCatalog, buildOrder} from '../src/catalog.js';
import {Repository} from '../src/repository.js';
import {showAllCatalogProducts, visibleCatalogProducts} from '../src/catalog-visibility.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const fixture = () => ({products: [
  {id: 'sale', name: 'Oferta', price: 1234, stock: 7, available: true, hidden: true, images: ['/assets/products/example.webp'], variants: []},
  {id: 'quote', name: 'Catálogo', price: 0, stock: null, available: false, hidden: true, images: [], variants: []}
]});

test('VIS-01: os 227 produtos do pacote estão visíveis, inclusive os 222 sem preço', async () => {
  const raw = await read('data/catalog.json');
  const actual = publicCatalog(raw, {});
  assert.equal(actual.products.length, 227);
  assert.equal(raw.products.filter(p => p.hidden === true).length, 0);
  assert.equal(actual.products.filter(p => p.price === 0).length, 222);
  assert.equal(actual.products.filter(p => p.available !== false).length, 5);
});

test('VIS-02: catálogo local e principal concordam em todos os IDs e na visibilidade', async () => {
  const a = normalizeCatalog(await read('data/catalog.json'));
  const b = normalizeCatalog(await read('data/local-state/catalog.json'));
  assert.deepEqual(b.products, a.products);
});

test('VIS-03: fallback e API mostram os mesmos 227 produtos e 52 variações', async () => {
  const raw = await read('data/catalog.json');
  const api = publicCatalog(raw, {});
  const html = await readFile(path.join(root, 'public/index.html'), 'utf8');
  const embedded = JSON.parse(html.match(/<script id="buildData" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded.products.map(p => p.id), api.products.map(p => p.id));
  assert.equal(embedded.products.flatMap(p => p.variants).length, 52);
  assert.equal(embedded.products.flatMap(p => p.variants).filter(v => v.price === 0).length, 48);
  assert.equal(embedded.coupons, undefined);
  assert.deepEqual(embedded.promotions, []);
  assert.ok(Object.values(embedded.commerce.paymentMethods).every(value => value === false));
});

test('VIS-04: nenhum dos 222 itens sem preço pode gerar pedido, nem com valor adulterado', async () => {
  const catalog = normalizeCatalog(await read('data/catalog.json'));
  const unpriced = catalog.products.filter(p => p.price === 0);
  assert.equal(unpriced.length, 222);
  for (const product of unpriced) {
    const payload = {items: [{productId: product.id, variantId: product.variants[0]?.id || '', qty: 1, price: 1, unitPriceCents: 1}], customer: {name: 'Teste', email: 'teste@example.test', phone: '11987654321'}, shipping: {choice: 'pickup'}, ageConfirmed: true};
    assert.throws(() => buildOrder(payload, catalog, {}), /disponível/, product.id);
  }
});

test('VIS-05: o backend ainda rejeita ativação de compra de produto sem preço', () => {
  const input = fixture(); input.products[1].available = true; input.products[1].hidden = false;
  assert.throws(() => normalizeCatalog(input), /preço maior que zero/);
});

test('VIS-06: desocultar é uma alteração explícita, imutável e repetível', () => {
  const raw = fixture(), before = structuredClone(raw);
  const first = showAllCatalogProducts(raw);
  assert.deepEqual(raw, before);
  assert.equal(first.summary.revealed, 2);
  for (let i = 0; i < 2; i++) assert.deepEqual(first.catalog.products[i], {...before.products[i], hidden: false});
  const second = showAllCatalogProducts(first.catalog);
  assert.deepEqual(second.catalog, first.catalog);
  assert.equal(second.summary.revealed, 0);
});

test('VIS-07: produto e variação excluídos nunca são ressuscitados ou expostos', () => {
  const raw = fixture();
  raw.products.push({id: 'deleted', name: 'Excluído', price: 999, hidden: true, deletedAt: '2026-01-01'});
  raw.products[0].variants = [{id: 'active', name: 'Visível', price: 1234}, {id: 'gone', name: 'Excluída', price: 555, deletedAt: '2026-01-01'}];
  raw.products[0].boxes = [{variantId: 'active', units: 1}, {variantId: 'gone', units: 2}];
  const next = showAllCatalogProducts(raw);
  assert.equal(next.summary.archived, 1);
  assert.deepEqual(next.catalog.products[2], raw.products[2]);
  const publicProducts = visibleCatalogProducts(next.catalog);
  assert.equal(publicProducts.length, 2);
  assert.deepEqual(publicProducts[0].variants.map(v => v.id), ['active']);
  assert.deepEqual(publicProducts[0].boxes.map(b => b.variantId), ['active']);
});

test('VIS-08: cadastro oculto marcado para venda mas sem preço passa a consulta, não a oferta grátis', () => {
  const input = fixture(); input.products[1].available = true;
  const result = showAllCatalogProducts(input);
  assert.equal(result.summary.pausedWithoutPrice, 1);
  assert.equal(result.catalog.products[1].available, false);
  assert.equal(result.catalog.products[1].price, 0);
  assert.doesNotThrow(() => normalizeCatalog(result.catalog));
});

test('VIS-09: preços, estoques, fotos e demais dados do catálogo original não mudam', async () => {
  const original = await read('backups/originais-v11.1.7/catalog.json');
  const updated = await read('data/catalog.json');
  for (const p of original.products) {
    const q = updated.products.find(item => item.id === p.id);
    assert.ok(q);
    for (const key of ['price', 'stock', 'available', 'minPerOrder', 'maxPerOrder', 'weightGrams', 'lengthCm', 'widthCm', 'heightCm']) assert.deepEqual(q[key], p[key], `${p.id}: ${key}`);
    for (const v of p.variants || []) {
      const w = (q.variants || []).find(item => item.id === v.id);
      assert.ok(w); assert.equal(w.price, v.price); assert.equal(w.stock, v.stock);
    }
  }
});

test('VIS-10: catálogo visual é uma cópia sem mutação da fonte', () => {
  const input = fixture(); input.products[0].hidden = false;
  const exposed = visibleCatalogProducts(input);
  exposed[0].price = 9999; exposed[0].images.push('/assets/other.webp');
  assert.equal(input.products[0].price, 1234);
  assert.equal(input.products[0].images.length, 1);
});

test('VIS-11: atualizar estado local com pedidos preserva os registros e persiste após reiniciar', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'integrall-visibility-'));
  const make = () => new Repository({databaseUrl: '', initialCatalog: normalizeCatalog(fixture()), localDataDir: directory});
  try {
    let repo = make(); await repo.init();
    await repo.withMemoryWriteLock(async () => {
      repo.memoryOrders.set('existing-order', {id: 'existing-order', clientOrderId: 'existing-client', status: 'paid', totalCents: 1234, items: []});
      repo.memoryCustomerAccounts.set('cliente@example.test', {email: 'cliente@example.test', name: 'Cliente'});
    });
    const before = repo.localSnapshot();
    await repo.mutateCatalog(current => showAllCatalogProducts(current).catalog);
    await repo.close(); repo = make(); await repo.init();
    const after = repo.localSnapshot();
    assert.equal(after.catalog.products.filter(p => p.hidden).length, 0);
    for (const key of ['orders', 'customers', 'customerAccounts', 'audit', 'reviews', 'restockSubscriptions']) assert.deepEqual(after[key], before[key], key);
    assert.equal(after.catalog.products[0].stock, 7);
    await repo.close();
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('VIS-12: comando de atualização faz backup, preserva o estado e pode ser reaplicado', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'integrall-show-all-'));
  try {
    const repo = new Repository({databaseUrl: '', initialCatalog: normalizeCatalog(fixture()), localDataDir: directory});
    await repo.init(); await repo.close();
    const original = await readFile(path.join(directory, 'state.json'), 'utf8');
    const env = {...process.env, NODE_ENV: 'test', DATABASE_URL: '', LOCAL_DATA_DIR: directory};
    const command = ['scripts/show-all-products.mjs', '--apply', '--server-stopped'];
    const run = () => spawnSync(process.execPath, command, {cwd: root, env, encoding: 'utf8', timeout: 15000});
    const result = run(); assert.equal(result.status, 0, result.stderr || result.stdout);
    const after = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'));
    assert.equal(after.catalog.products.filter(p => p.hidden).length, 0);
    const backups = await readdir(path.join(directory, 'visibilidade'));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(directory, 'visibilidade', backups[0], 'state.json'), 'utf8'), original);
    const again = run(); assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')), after);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('VIS-13: sem confirmação de parada, o comando não escreve no catálogo', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'integrall-show-all-guard-'));
  try {
    await writeFile(path.join(directory, 'state.json'), 'não alterar');
    const result = spawnSync(process.execPath, ['scripts/show-all-products.mjs', '--apply'], {cwd: root, env: {...process.env, DATABASE_URL: '', LOCAL_DATA_DIR: directory}, encoding: 'utf8'});
    assert.equal(result.status, 2);
    assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), 'não alterar');
    assert.deepEqual(await readdir(directory), ['state.json']);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('VIS-14: primeira inicialização real e reinício mantêm os 227 produtos públicos', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'integrall-visible-catalog-'));
  const catalog = normalizeCatalog(await read('data/catalog.json'));
  const make = () => new Repository({databaseUrl: '', initialCatalog: catalog, localDataDir: directory});
  try {
    let repo = make(); await repo.init();
    assert.equal(publicCatalog(await repo.getCatalog(), {}).products.length, 227);
    await repo.close();
    repo = make(); await repo.init();
    assert.equal(publicCatalog(await repo.getCatalog(), {}).products.length, 227);
    assert.equal((await repo.getCatalog()).products.filter(p => p.hidden === true).length, 0);
    await repo.close();
  } finally { await rm(directory, {recursive: true, force: true}); }
});
