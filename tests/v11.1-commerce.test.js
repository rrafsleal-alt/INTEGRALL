import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeCatalog, productPrice, calculateAutomaticPromotions, buildOrder, effectiveFreeShippingThreshold, slugify} from '../src/catalog.js';
import {reserveInventory, releaseInventory} from '../src/inventory-reservation.js';
import {CustomerAuth} from '../src/customer-auth.js';

const config = {mercadoPagoAccessToken:'', mercadoPagoWebhookSecret:'', whatsappNumber:'', shippingMode:'fixed', shippingFixedCents:1500, freeShippingCents:null};

function commerceCatalog(overrides={}) {
  return normalizeCatalog({
    version: 11,
    settings: {free: 50000},
    commerce: {},
    coupons: [],
    promotions: [
      {id:'sale-1', name:'Oferta Produto', type:'sale_price', active:true, productId:'p1', salePriceCents:8000, badge:'OFERTA'},
      {id:'qty-1', name:'10% em 3+', type:'quantity_percent', active:true, productId:'p1', value:10, minQty:3},
      {id:'shipping-1', name:'Frete 299', type:'free_shipping_threshold', active:true, minSubtotalCents:29900}
    ],
    products: [
      {id:'p1', name:'Produto Especial', price:10000, stock:5, stockMin:2, available:true, images:[], variants:[], department:'cafes'},
      {id:'p2', name:'Produto Secundário', price:5000, stock:2, available:true, images:[], variants:[], department:'sucos'}
    ],
    ...overrides
  });
}

function directOrder(id='R1', qty=2) {
  const now=new Date().toISOString();
  return {id,clientOrderId:`client-${id}`,createdAt:now,updatedAt:now,status:'received',customer:{name:'Cliente',email:'cliente@example.com',phone:'11999999999'},items:[{productId:'p1',variantId:'',qty,name:'Produto Especial',unitPriceCents:8000,lineTotalCents:8000*qty}],subtotalCents:8000*qty,shippingCents:0,discountCents:0,totalCents:8000*qty,payment:{},history:[]};
}

test('v11.1 gera slugs amigáveis únicos para páginas de produto', () => {
  assert.equal(slugify('Café Vovó D’Amázia 250g'), 'cafe-vovo-d-amazia-250g');
  const catalog=normalizeCatalog({version:11,settings:{},commerce:{},products:[
    {id:'a-1',name:'Café Especial',price:1000,images:[],variants:[]},
    {id:'a-2',name:'Café Especial',price:1200,images:[],variants:[]}
  ]});
  assert.equal(catalog.products[0].slug,'cafe-especial');
  assert.notEqual(catalog.products[0].slug,catalog.products[1].slug);
  assert.match(catalog.products[1].slug,/^cafe-especial-/);
});

test('v11.1 aplica preço promocional e desconto automático no servidor', () => {
  const catalog=commerceCatalog();
  const product=catalog.products.find(item=>item.id==='p1');
  const price=productPrice(product,'',catalog.promotions);
  assert.equal(price.regularPriceCents,10000);
  assert.equal(price.unitPriceCents,8000);

  const lines=[{productId:'p1',variantId:'',qty:3,unitPriceCents:8000,lineTotalCents:24000}];
  const result=calculateAutomaticPromotions({lines,productsById:new Map(catalog.products.map(item=>[item.id,item])),promotions:catalog.promotions,shippingPriceCents:1500});
  assert.equal(result.discountCents,2400);
  assert.equal(result.shippingDiscountCents,0);
  assert.ok(result.applied.some(item=>item.id==='qty-1'));

  const order=buildOrder({clientOrderId:'PROMO-ORDER',customer:{name:'Cliente',email:'cliente@example.com'},shipping:{choice:'pickup'},items:[{productId:'p1',qty:3}]},catalog,config);
  assert.equal(order.items[0].unitPriceCents,8000);
  assert.equal(order.subtotalCents,24000);
  assert.equal(order.promotionDiscountCents,2400);
  assert.equal(order.totalCents,21600);
});

test('v11.1 promoção pode reduzir o limite efetivo de frete grátis', () => {
  const catalog=commerceCatalog();
  assert.equal(effectiveFreeShippingThreshold(catalog),29900);
});

test('v11.1 reserva estoque de forma imutável e libera na expiração/cancelamento', () => {
  const catalog=commerceCatalog({promotions:[]});
  const order=directOrder('RESERVE-1',2);
  const reserved=reserveInventory(catalog,order,20,Date.parse('2026-09-02T12:00:00Z'));
  assert.equal(catalog.products.find(item=>item.id==='p1').stock,5, 'catálogo original não é mutado');
  assert.equal(reserved.catalog.products.find(item=>item.id==='p1').stock,3);
  assert.equal(reserved.order.inventoryReservedAt,'2026-09-02T12:00:00.000Z');
  assert.equal(reserved.order.inventoryReservationExpiresAt,'2026-09-02T12:20:00.000Z');
  const released=releaseInventory(reserved.catalog,reserved.order);
  assert.equal(released.catalog.products.find(item=>item.id==='p1').stock,5);
});

test('v11.1 reserva impede sobrevenda da última unidade', () => {
  const catalog=commerceCatalog({promotions:[],products:[{id:'p1',name:'Último Item',price:1000,stock:1,available:true,images:[],variants:[]}]});
  const first=directOrder('ONLY-1',1);first.items[0].unitPriceCents=1000;first.items[0].lineTotalCents=1000;first.subtotalCents=1000;first.totalCents=1000;
  const reserved=reserveInventory(catalog,first,20);
  const second=structuredClone(first);second.id='ONLY-2';second.clientOrderId='client-ONLY-2';
  assert.throws(()=>reserveInventory(reserved.catalog,second,20),error=>error?.code==='OUT_OF_STOCK');
  assert.equal(reserved.catalog.products[0].stock,0);
});

test('v11.1 conta do cliente autentica por código com sessão HttpOnly', async () => {
  const accounts=new Map(),codes=new Map(),sessions=new Map();
  const repository={
    async saveCustomerLoginCode(item){codes.set(item.email,{...item,attempts:0})},
    async getCustomerLoginCode(email){return codes.get(email)||null},
    async incrementCustomerLoginAttempts(email){const item=codes.get(email);if(item)item.attempts=(item.attempts||0)+1},
    async deleteCustomerLoginCode(email){codes.delete(email)},
    async consumeCustomerLoginCode(email,candidateHash){const item=codes.get(email);if(!item||Date.parse(item.expiresAt)<=Date.now()||Number(item.attempts)>=5)return false;if(item.codeHash!==candidateHash){item.attempts=(item.attempts||0)+1;return false;}codes.delete(email);return true;},
    async ensureCustomerAccount(email){if(!accounts.has(email))accounts.set(email,{email,name:'',phone:'',addresses:[],favorites:[]});return structuredClone(accounts.get(email))},
    async saveCustomerSession(item){sessions.set(item.tokenHash,item)},
    async getCustomerSession(tokenHash){return sessions.get(tokenHash)||null},
    async deleteCustomerSession(tokenHash){sessions.delete(tokenHash)}
  };
  const auth=new CustomerAuth({repository,secureCookies:false,sessionDays:30,codeMinutes:10,codeSecret:'c'.repeat(64)});
  const login=await auth.createLoginCode('Cliente@Example.com');
  assert.match(login.code,/^\d{6}$/);
  const verified=await auth.verifyLoginCode('cliente@example.com',login.code);
  assert.equal(verified.account.email,'cliente@example.com');
  assert.ok(verified.token.length>20);
  assert.match(auth.cookie(verified.token,verified.expiresAt),/HttpOnly/);
  const session=await auth.readSession({headers:{cookie:auth.cookie(verified.token,verified.expiresAt).split(';')[0]}});
  assert.equal(session.email,'cliente@example.com');
});

test('v11.1 endpoints de avaliações verificadas e avise-me estão protegidos no servidor', async () => {
  const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
  assert.match(server,/app\.post\('\/api\/products\/:id\/reviews',[\s\S]*customerSession[\s\S]*customerCsrf/);
  assert.match(server,/REVIEW_PURCHASE_REQUIRED/);
  assert.match(server,/status: 'pending'/);
  assert.match(server,/app\.post\('\/api\/stock-alerts'/);
  assert.match(server,/processRestockAlerts/);
  assert.match(server,/listRestockSubscriptions/);
});

test('v11.1 frontend/admin contém todos os pontos de integração principais', async () => {
  const [index,admin,catalogJs,commerceJs,checkoutJs,server]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/admin.html',import.meta.url),'utf8'),
    readFile(new URL('../public/js/store/catalog.js',import.meta.url),'utf8'),
    readFile(new URL('../public/js/store/commerce-v111.js',import.meta.url),'utf8'),
    readFile(new URL('../public/js/store/checkout.js',import.meta.url),'utf8'),
    readFile(new URL('../server.js',import.meta.url),'utf8')
  ]);
  for(const id of ['advancedFilterBox','searchSuggestions','freeShippingProgress','accountModal','productReviews','restockAlertForm']) assert.match(index,new RegExp(`id="${id}"`));
  for(const id of ['promotionForm','inventoryAlertsBody','reviewsBody','pfSlug','pfStockMin','pfRestockDate']) assert.match(admin,new RegExp(`id="${id}"`));
  assert.match(catalogJs,/\/produto\/\$\{encodeURIComponent\(product\.slug\)\}/);
  assert.match(commerceJs,/account\/reorder/);
  assert.match(checkoutJs,/automaticPromotionPreview/);
  assert.match(server,/app\.get\('\/produto\/:slug'/);
  assert.match(server,/releaseExpiredReservations/);
});
