import test from 'node:test';
import assert from 'node:assert/strict';
import {Repository} from '../src/repository.js';

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
  assert.deepEqual(expired.sort(), ['OLD-RECEIVED']);
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
