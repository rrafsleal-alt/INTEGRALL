import test from 'node:test';
import assert from 'node:assert/strict';
import {Repository} from '../src/repository.js';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('repositório em memória lista pedidos sem falhar no structuredClone', async () => {
  const repo = new Repository({databaseUrl: '', initialCatalog: {version: 9, settings: {}, commerce: {}, products: []}, production: false});
  await repo.init();
  const order = {
    id: 'INT-TEST-1',
    clientOrderId: 'CLIENT-TEST-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'received',
    customer: {name: 'Cliente Teste', email: 'teste@example.com', phone: '11999999999'},
    items: [],
    subtotalCents: 1000,
    shippingCents: 0,
    totalCents: 1000,
    payment: {}
  };
  const created = await repo.createOrder(order);
  assert.equal(created.created, true);
  const orders = await repo.listOrders();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].id, order.id);
  assert.notEqual(orders[0], order);
});

test('repositório consolida cliente e baixa estoque exatamente uma vez ao confirmar pagamento', async () => {
  const initialCatalog = {
    version: 9,
    settings: {}, commerce: {},
    products: [{id:'P1',name:'Produto',stock:5,variants:[]}]
  };
  const repo = new Repository({databaseUrl:'',initialCatalog,production:false});
  await repo.init();
  const now = new Date().toISOString();
  const order = {
    id:'INT-STOCK-1',clientOrderId:'CLIENT-STOCK-1',createdAt:now,updatedAt:now,status:'received',
    customer:{name:'Ana',email:'ana@example.com',phone:'11999999999'},
    items:[{productId:'P1',variantId:'',qty:2,name:'Produto',lineTotalCents:2000}],
    subtotalCents:2000,shippingCents:0,totalCents:2000,payment:{},history:[]
  };
  await repo.createOrder(order);
  assert.equal((await repo.listCustomers())[0].email,'ana@example.com');
  const paid = await repo.updateOrder(order.id,{status:'paid'},{source:'test'});
  assert.ok(paid.inventoryCommittedAt);
  assert.equal((await repo.getCatalog()).products[0].stock,3);
  await repo.updateOrder(order.id,{status:'preparing'},{source:'test'});
  assert.equal((await repo.getCatalog()).products[0].stock,3);
});

test('pedidos antigos sem pagamento expiram; pedidos pagos nunca expiram', async () => {
  const repo = new Repository({databaseUrl: '', initialCatalog: {version: 9, settings: {}, commerce: {}, products: []}, production: false});
  await repo.init();
  const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const base = {clientOrderId: '', createdAt: old, updatedAt: old, customer: {name: 'X', email: 'x@x.com'}, items: [], subtotalCents: 1000, shippingCents: 0, totalCents: 1000, payment: {}};
  await repo.createOrder({...base, id: 'OLD-RECEIVED', clientOrderId: 'c1', status: 'received'});
  await repo.createOrder({...base, id: 'OLD-PAID', clientOrderId: 'c2', status: 'paid'});
  await repo.createOrder({...base, id: 'NEW-RECEIVED', clientOrderId: 'c3', status: 'received', createdAt: new Date().toISOString()});
  const expired = await repo.expireStaleOrders(7);
  assert.deepEqual(expired.map(order => order.id).sort(), ['OLD-RECEIVED']);
  assert.equal(expired[0].status, 'cancelled'); // pedido completo (para notificação por e-mail)
  assert.equal((await repo.getOrder('OLD-RECEIVED')).status, 'cancelled');
  assert.equal((await repo.getOrder('OLD-PAID')).status, 'paid');
  assert.equal((await repo.getOrder('NEW-RECEIVED')).status, 'received');
  const zero = await repo.expireStaleOrders(0);
  assert.deepEqual(zero, []);
});

test('mutateCatalog aplica mutação sobre o estado mais recente e propaga erros sem salvar', async () => {
  const repo = new Repository({
    databaseUrl: '',
    initialCatalog: {version: 9, settings: {}, commerce: {}, coupons: [], products: [{id: 'p1', name: 'Produto', price: 1000, variants: [], attributes: {}, images: []}]},
    production: false
  });
  await repo.init();

  // Mutação 1: muda o preço
  await repo.mutateCatalog(current => {
    current.products[0].price = 2000;
    return current;
  });
  // Mutação 2 (concorrente lógica): parte do estado JÁ atualizado, não de um snapshot velho
  await repo.mutateCatalog(current => {
    assert.equal(current.products[0].price, 2000);
    current.products[0].stock = 5;
    return current;
  });
  const catalog = await repo.getCatalog();
  assert.equal(catalog.products[0].price, 2000);
  assert.equal(catalog.products[0].stock, 5);

  // Mutação que lança: nada é salvo
  await assert.rejects(() => repo.mutateCatalog(() => { throw new Error('valida e aborta'); }), /valida e aborta/);
  const unchanged = await repo.getCatalog();
  assert.equal(unchanged.products[0].price, 2000);
});

test('busca com % e _ é tratada literalmente (sem curinga acidental)', async () => {
  const repo = new Repository({databaseUrl: '', initialCatalog: {version: 9, settings: {}, commerce: {}, coupons: [], products: []}, production: false});
  await repo.init();
  const base = {createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'received', items: [], subtotalCents: 1000, shippingCents: 0, totalCents: 1000, payment: {}};
  await repo.createOrder({...base, id: 'A1', clientOrderId: 'c1', customer: {name: 'Suco 100% Integral', email: 'a@a.com'}});
  await repo.createOrder({...base, id: 'A2', clientOrderId: 'c2', customer: {name: 'Maria Comum', email: 'b@b.com'}});
  const hits = await repo.listOrders({search: '100%'});
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'A1');
});

test('updateOrder funcional: decisão tomada sobre o estado fresco (anti-TOCTOU do webhook)', async () => {
  const repo = new Repository({databaseUrl: '', initialCatalog: {version: 9, settings: {}, commerce: {}, coupons: [], products: []}, production: false});
  await repo.init();
  const base = {clientOrderId: 'toctou-1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), customer: {name: 'X', email: 'x@x.com'}, items: [], subtotalCents: 5000, shippingCents: 0, totalCents: 5000, payment: {preferenceId: 'pref-1'}};
  await repo.createOrder({...base, id: 'TOCTOU-1', status: 'awaiting_payment'});

  // Simula admin cancelando ANTES da decisão do webhook ser aplicada
  await repo.updateOrder('TOCTOU-1', {status: 'cancelled'}, {source: 'admin'});

  // Webhook usa a forma funcional: enxerga 'cancelled' e decide payment_review
  let seenStatus = null;
  const updated = await repo.updateOrder('TOCTOU-1', current => {
    seenStatus = current.status;
    if (current.status === 'cancelled') return {status: 'payment_review'};
    return {status: 'paid'};
  }, () => ({source: 'webhook'}));
  assert.equal(seenStatus, 'cancelled');
  assert.equal(updated.status, 'payment_review');

  // Retornar null aborta sem gravar
  const before = await repo.getOrder('TOCTOU-1');
  const aborted = await repo.updateOrder('TOCTOU-1', () => null, {source: 'noop'});
  assert.equal(aborted.status, before.status);
  assert.equal((aborted.history || []).length, (before.history || []).length);
});


test('catálogo local de versão anterior é normalizado e persistido sem perder o produto', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(),'integrall-catalog-migration-'));
  const localDataDir = path.join(base,'local-state');
  await mkdir(localDataDir,{recursive:true});
  const legacy = {
    version: 9,
    settings: {},
    commerce: {},
    products: [{id:'LEGACY-1',name:'Produto Antigo Árvore',price:1200,available:true,images:[],variants:[],attributes:{}}]
  };
  await writeFile(path.join(localDataDir,'catalog.json'),JSON.stringify(legacy),'utf8');
  try {
    const repo = new Repository({databaseUrl:'',initialCatalog:{version:9,settings:{},commerce:{},products:[]},production:false,localDataDir});
    await repo.init();
    const migrated = await repo.getCatalog();
    assert.equal(migrated.products.length,1);
    assert.equal(migrated.products[0].id,'LEGACY-1');
    assert.equal(migrated.products[0].slug,'produto-antigo-arvore');
    const onDisk = JSON.parse(await readFile(path.join(localDataDir,'catalog.json'),'utf8'));
    assert.equal(onDisk.products[0].slug,'produto-antigo-arvore');
  } finally {
    await rm(base,{recursive:true,force:true});
  }
});

test('código de login do cliente é consumido uma única vez no repositório em memória', async () => {
  const repo = new Repository({databaseUrl: '', initialCatalog: {version: 9, settings: {}, commerce: {}, products: []}, production: false});
  await repo.init();
  const email = 'atomic@example.com';
  const codeHash = 'hmac-sha256$' + 'a'.repeat(64);
  await repo.saveCustomerLoginCode({email, codeHash, expiresAt: new Date(Date.now() + 60_000).toISOString()});
  const results = await Promise.all([
    repo.consumeCustomerLoginCode(email, codeHash),
    repo.consumeCustomerLoginCode(email, codeHash)
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(await repo.getCustomerLoginCode(email), null);
});

test('código incorreto incrementa tentativas sem consumir o código válido', async () => {
  const repo = new Repository({databaseUrl: '', initialCatalog: {version: 9, settings: {}, commerce: {}, products: []}, production: false});
  await repo.init();
  const email = 'attempts@example.com';
  const codeHash = 'hmac-sha256$' + 'b'.repeat(64);
  await repo.saveCustomerLoginCode({email, codeHash, expiresAt: new Date(Date.now() + 60_000).toISOString()});
  assert.equal(await repo.consumeCustomerLoginCode(email, 'hmac-sha256$' + 'c'.repeat(64)), false);
  assert.equal((await repo.getCustomerLoginCode(email)).attempts, 1);
  assert.equal(await repo.consumeCustomerLoginCode(email, codeHash), true);
});

test('sessão administrativa persistida pode ser revogada imediatamente', async () => {
  const repo = new Repository({databaseUrl: '', initialCatalog: {version: 9, settings: {}, commerce: {}, products: []}, production: false});
  await repo.init();
  const session = {jti:'admin-session-1',email:'admin@example.com',role:'admin',expiresAt:new Date(Date.now()+60_000).toISOString()};
  await repo.saveAdminSession(session);
  assert.equal((await repo.getAdminSession(session.jti)).email, session.email);
  assert.equal(await repo.deleteAdminSession(session.jti), true);
  assert.equal(await repo.getAdminSession(session.jti), null);
});
