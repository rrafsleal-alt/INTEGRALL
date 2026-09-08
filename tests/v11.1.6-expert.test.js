import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Repository} from '../src/repository.js';
import {calculateAutomaticPromotions, normalizeCatalog, buildOrder, isStockAlertPurchasable, productPrice, publicCatalog} from '../src/catalog.js';
import {applyQuotedShipping} from '../src/order-financials.js';
import {claimCheckout, clearCheckoutClaimPatch, completeCheckoutPatch, reusableCheckout} from '../src/payment-checkout-guard.js';
import {toPublicOrder} from '../src/public-order.js';
import {CorreiosService} from '../src/correios.js';
import {JadlogService} from '../src/jadlog.js';
import {MercadoPagoService} from '../src/payments.js';
import {canTransitionOrder} from '../src/order-state.js';
import {hashClientOrderKey, hashOrderIntent, hashOrderRequestIntent, idempotencyOwnership, normalizeClientOrderKey} from '../src/order-idempotency.js';
import {assertCatalogRevision, assertProductRevision, assertSectionRevision, catalogRevision, productRevision, sectionRevision} from '../src/catalog-revision.js';
import {safeEqual} from '../src/security.js';
import {reserveInventory, releaseInventory} from '../src/inventory-reservation.js';
import {isValidPublicUrl} from '../src/config.js';
import {validateShippingQuoteItems} from '../src/shipping-quote.js';

function orderBase(id='ORDER-X', qty=1) {
  const now=new Date().toISOString();
  return {id,clientOrderId:`client-${id}`,createdAt:now,updatedAt:now,status:'received',customer:{name:'Cliente',email:'c@example.com'},items:[{productId:'p1',variantId:'',qty,name:'Produto',unitPriceCents:1000,lineTotalCents:1000*qty}],subtotalCents:1000*qty,shippingCents:0,discountCents:0,totalCents:1000*qty,payment:{},history:[]};
}

test('pagamento tardio após liberação recompromete estoque; se não houver estoque, aborta atomicamente', async () => {
  const catalog={version:11,settings:{},commerce:{},products:[{id:'p1',name:'Produto',price:1000,stock:2,available:true,images:[],variants:[]}]};
  const repo=new Repository({databaseUrl:'',initialCatalog:catalog,production:false});await repo.init();
  await repo.createOrder(orderBase('LATE-1',2));
  assert.equal((await repo.getCatalog()).products[0].stock,0);
  const expired=await repo.updateOrder('LATE-1',{status:'payment_expired'},{source:'test'});
  assert.ok(expired.inventoryReservationReleasedAt);
  assert.equal((await repo.getCatalog()).products[0].stock,2);

  // Outro pedido consome o estoque que voltou.
  await repo.createOrder(orderBase('LATE-2',2));
  assert.equal((await repo.getCatalog()).products[0].stock,0);
  await assert.rejects(()=>repo.updateOrder('LATE-1',{status:'paid'},{source:'admin'}),error=>error?.code==='OUT_OF_STOCK');
  assert.equal((await repo.getOrder('LATE-1')).status,'payment_expired');
  assert.equal((await repo.getOrder('LATE-1')).inventoryCommittedAt,'');
  assert.equal((await repo.getCatalog()).products[0].stock,0);
});

test('pagamento tardio com estoque disponível baixa novamente e marca commit', async () => {
  const catalog={version:11,settings:{},commerce:{},products:[{id:'p1',name:'Produto',price:1000,stock:2,available:true,images:[],variants:[]}]};
  const repo=new Repository({databaseUrl:'',initialCatalog:catalog,production:false});await repo.init();
  await repo.createOrder(orderBase('LATE-OK',2));
  await repo.updateOrder('LATE-OK',{status:'payment_expired'},{source:'test'});
  assert.equal((await repo.getCatalog()).products[0].stock,2);
  const paid=await repo.updateOrder('LATE-OK',{status:'paid'},{source:'admin'});
  assert.ok(paid.inventoryCommittedAt);
  assert.equal((await repo.getCatalog()).products[0].stock,0);
});

test('pedido expirado não volta artificialmente para aguardando pagamento sem nova reserva', () => {
  assert.equal(canTransitionOrder('payment_expired','awaiting_payment'),false);
  assert.equal(canTransitionOrder('payment_expired','paid'),true); // permitido só com recompromisso estrito no repositório
});

test('frete automático nunca inventa dimensões e Jadlog rejeita peso real acima do limite', async () => {
  const correios=new CorreiosService({user:'u',accessCode:'a',postageCard:'p',contract:'c',originCep:'16770000'});
  const products=new Map([['p1',{id:'p1',weightGrams:500,lengthCm:null,widthCm:null,heightCm:null,variants:[],boxes:[]}]]);
  const pack=correios.packOrder([{productId:'p1',qty:1}],products);
  assert.equal(pack.missingData,true);
  await assert.rejects(()=>correios.quote('01001000',pack),/dimensões válidas/i);

  const jadlog=new JadlogService({token:'t',cnpj:'12345678000190',conta:'1',originCep:'16770000'});
  await assert.rejects(()=>jadlog.quote('01001000',{packages:[{weightGrams:30000,lengthCm:30,widthCm:30,heightCm:30,looseWeightRaw:35000}],missingData:false,overweight:true}),/peso real excede/i);
});

test('projeção pública preserva frete sob cotação como null, nunca R$ 0', () => {
  const order=toPublicOrder({id:'Q1',shippingCents:null,requiresShippingQuote:true});
  assert.equal(order.shippingCents,null);
  assert.equal(order.requiresShippingQuote,true);
});

test('metadados de promoções somam exatamente o desconto efetivo após teto', () => {
  const product={id:'p1',department:'cafes'};
  const lines=[{productId:'p1',variantId:'',qty:1,unitPriceCents:1000,lineTotalCents:1000}];
  const promotions=[
    {id:'a',name:'A',type:'category_percent',active:true,department:'cafes',value:80,stackable:true},
    {id:'b',name:'B',type:'category_percent',active:true,department:'cafes',value:80,stackable:true}
  ];
  const result=calculateAutomaticPromotions({lines,productsById:new Map([['p1',product]]),promotions});
  assert.equal(result.discountCents,900); // preserva R$1,00 mínimo
  assert.equal(result.applied.reduce((sum,item)=>sum+item.discountCents,0),900);
});

test('frete grátis elegível fica registrado mesmo com preço ainda zero e o recálculo manual respeita o snapshot', () => {
  const product={id:'p1',department:'cafes'};
  const promo={id:'free-1',name:'Frete grátis acima de 50',type:'free_shipping_threshold',active:true,minSubtotalCents:5000};
  const result=calculateAutomaticPromotions({lines:[{productId:'p1',variantId:'',qty:1,unitPriceCents:10000,lineTotalCents:10000}],productsById:new Map([['p1',product]]),promotions:[promo],shippingPriceCents:0});
  const snap=result.applied.find(item=>item.type==='free_shipping_threshold');
  assert.ok(snap,'promo elegível deve ficar registrada mesmo antes de conhecer o frete');
  assert.equal(snap.shippingDiscountCents,0);
  const order={subtotalCents:10000,promotionDiscountCents:0,couponDiscountCents:0,promotions:result.applied,coupon:null};
  const recalculated=applyQuotedShipping(order,{shippingCents:2500,label:'Cotação manual'});
  assert.equal(recalculated.patch.shippingCents,2500);
  assert.equal(recalculated.patch.promotionDiscountCents,2500);
  assert.equal(recalculated.patch.totalCents,10000);
  assert.equal(recalculated.patch.promotions.find(item=>item.type==='free_shipping_threshold').shippingDiscountCents,2500);
});

test('trava de checkout evita duas preferências simultâneas e reutiliza tentativa idempotente após falha', () => {
  const now=Date.parse('2026-09-03T12:00:00Z');
  const order={id:'PAY-1',status:'received',inventoryReservedAt:new Date(now-1000).toISOString(),inventoryReservationExpiresAt:new Date(now+600000).toISOString(),inventoryReservationReleasedAt:'',inventoryCommittedAt:'',payment:{attempt:0}};
  const first=claimCheckout(order,{claimId:'claim-a',now});
  assert.equal(first.attempt,1);
  const claimed={...order,payment:{...order.payment,...first.payment}};
  assert.throws(()=>claimCheckout(claimed,{claimId:'claim-b',now:now+1000}),error=>error?.code==='PAYMENT_CHECKOUT_IN_PROGRESS');
  const clearedPatch=clearCheckoutClaimPatch(claimed,'claim-a');
  const cleared={...claimed,payment:{...claimed.payment,...clearedPatch.payment}};
  const retry=claimCheckout(cleared,{claimId:'claim-c',now:now+2000});
  assert.equal(retry.attempt,1,'retry mantém a mesma chave idempotente pendente');
  const completedOrder={...cleared,payment:{...cleared.payment,...retry.payment}};
  const complete=completeCheckoutPatch(completedOrder,{claimId:'claim-c',checkout:{id:'PREF-1',url:'https://mp.example/PREF-1'},attempt:retry.attempt});
  assert.equal(complete.payment.checkoutUrl,'https://mp.example/PREF-1');
  const reusable=reusableCheckout({...completedOrder,status:'awaiting_payment',payment:{...completedOrder.payment,...complete.payment} },now+3000);
  assert.equal(reusable?.preferenceId,'PREF-1');
});

test('Mercado Pago recusa criar preferência quando a reserva explicitamente já expirou', async () => {
  const service=new MercadoPagoService({accessToken:'t',webhookSecret:'s'});
  service.clients=async()=>({preference:{create:async()=>{throw new Error('não deveria chamar provedor')}}});
  await assert.rejects(()=>service.createCheckout({id:'P',totalCents:1000,shippingCents:0,discountCents:0,inventoryReservationExpiresAt:new Date(Date.now()-1000).toISOString(),items:[{productId:'p1',name:'P',qty:1,unitPriceCents:1000}]},'https://loja.example',1),error=>error?.code==='PAYMENT_RESERVATION_EXPIRED');
});

test('sessões de cliente expiradas são limpas ao salvar uma nova sessão em memória', async () => {
  const repo=new Repository({databaseUrl:'',initialCatalog:{version:11,settings:{},commerce:{},products:[]},production:false});await repo.init();
  repo.memoryCustomerSessions.set('old',{tokenHash:'old',email:'old@x.com',csrfToken:'x',expiresAt:new Date(Date.now()-1000).toISOString()});
  await repo.saveCustomerSession({tokenHash:'new',email:'new@x.com',csrfToken:'y',expiresAt:new Date(Date.now()+60000).toISOString()});
  assert.equal(repo.memoryCustomerSessions.has('old'),false);
  assert.equal(repo.memoryCustomerSessions.has('new'),true);
});



test('catálogo recusa configuração impossível de quantidade mínima acima da máxima', () => {
  assert.throws(()=>normalizeCatalog({version:11,settings:{},commerce:{},products:[{id:'p1',name:'Impossível',price:1000,available:true,minPerOrder:5,maxPerOrder:2,variants:[],images:[]}]}),/mínima.*máxima/i);
});

test('verificação de compra não depende do limite de 200 pedidos recentes', async () => {
  const repo=new Repository({databaseUrl:'',initialCatalog:{version:11,settings:{},commerce:{},products:[]},production:false});await repo.init();
  const target={...orderBase('OLD-PURCHASE',1),status:'completed',customer:{name:'Cliente',email:'buyer@example.com'},createdAt:'2020-01-01T00:00:00.000Z'};
  target.items[0].productId='target-product';
  repo.memoryOrders.set(target.id,target);
  for(let i=0;i<205;i++){
    const recent={...orderBase(`RECENT-${i}`,1),status:'completed',customer:{name:'Cliente',email:'buyer@example.com'},createdAt:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()};
    recent.items[0].productId='other-product';repo.memoryOrders.set(recent.id,recent);
  }
  const found=await repo.findVerifiedPurchase('buyer@example.com','target-product');
  assert.equal(found?.id,'OLD-PURCHASE');
});


test('aviso de reposição só considera item realmente comprável e nunca herda estoque após remover variação', () => {
  const product={id:'p',name:'P',available:true,hidden:false,stock:10,variants:[{id:'v',name:'V',stock:0}]};
  assert.equal(isStockAlertPurchasable(product,'v'),false);
  assert.equal(isStockAlertPurchasable({...product,available:false},''),false);
  assert.equal(isStockAlertPurchasable({...product,hidden:true},''),false);
  assert.equal(isStockAlertPurchasable(product,'removed-variant'),false);
  assert.equal(isStockAlertPurchasable({...product,variants:[{id:'v',name:'V',stock:3}]},'v'),true);
  assert.equal(isStockAlertPurchasable({...product,stock:null,variants:[]},''),true);
});

test('idempotência de criação usa capability separada e nunca confia só no clientOrderId', () => {
  const key='a'.repeat(64);
  const hash=hashClientOrderKey(key);
  assert.equal(hash.length,64);
  const intentA=hashOrderIntent(orderBase('INTENT-A',1));
  const existing={clientOrderKeyHash:hash,clientOrderPayloadHash:intentA};
  assert.equal(idempotencyOwnership(existing,hash,intentA,safeEqual).ok,true);
  const wrong=hashClientOrderKey('b'.repeat(64));
  assert.deepEqual(idempotencyOwnership(existing,wrong,intentA,safeEqual),{ok:false,code:'IDEMPOTENCY_CONFLICT'});
  const intentB=hashOrderIntent(orderBase('INTENT-B',2));
  assert.deepEqual(idempotencyOwnership(existing,hash,intentB,safeEqual),{ok:false,code:'IDEMPOTENCY_PAYLOAD_MISMATCH'});
  assert.deepEqual(idempotencyOwnership({},hash,intentA,safeEqual),{ok:false,code:'IDEMPOTENCY_OWNERSHIP_REQUIRED'});
  assert.throws(()=>normalizeClientOrderKey('curta'),error=>error?.code==='CLIENT_ORDER_KEY_INVALID');
});

test('contratos críticos da v11.1.6 estão ligados às rotas reais', async () => {
  const [server,catalogJs,checkoutJs]=await Promise.all([readFile(new URL('../server.js',import.meta.url),'utf8'),readFile(new URL('../public/js/store/catalog.js',import.meta.url),'utf8'),readFile(new URL('../public/js/store/checkout.js',import.meta.url),'utf8')]);
  assert.match(server,/claimCheckout\(current/);
  assert.match(server,/assertOrderTransition\(current\.status, status\)/);
  assert.match(server,/applyQuotedShipping\(current/);
  assert.match(server,/reviewStats\(\)\)\[productId\]/);
  assert.match(server,/findVerifiedPurchase\(req\.customerSession\.email, productId\)/);
  assert.match(server,/idempotencyOwnership\(result\.order, clientOrderKeyHash, clientOrderRequestHash, safeEqual\)/);
  assert.match(server,/Cache-Control', 'no-store'/);
  assert.match(catalogJs,/function minimumOrder\(product\)/);
  assert.match(catalogJs,/Quantidade mínima de \$\{item\.product\.name\}/);
  assert.match(checkoutJs,/existing\?\.orderId && existing\?\.checkoutToken/);
  assert.match(checkoutJs,/clientOrderKey: newClientOrderKey\(\)/);
});


test('combo percentual respeita a quantidade real de cada variação e não duplica preço barato', () => {
  const productsById=new Map([['a',{id:'a'}],['b',{id:'b'}]]);
  const lines=[
    {productId:'a',variantId:'cheap',qty:1,unitPriceCents:1000,lineTotalCents:1000},
    {productId:'a',variantId:'expensive',qty:2,unitPriceCents:3000,lineTotalCents:6000},
    {productId:'b',variantId:'',qty:3,unitPriceCents:2000,lineTotalCents:6000}
  ];
  const result=calculateAutomaticPromotions({lines,productsById,promotions:[{id:'combo',name:'Combo',type:'bundle_percent',active:true,value:10,requiredProductIds:['a','b']} ]});
  // 3 bundles: A = 1*1000 + 2*3000; B = 3*2000 => base 13000, desconto 1300.
  assert.equal(result.discountCents,1300);
});

test('hash da tentativa é estável sem depender do estoque ou do catálogo atual', () => {
  const payload={clientOrderId:'retry-1',customer:{name:' Cliente ',email:'c@example.com',phone:'',note:' oi '},shipping:{choice:'pickup'},items:[{productId:'p1',variantId:'v1',qty:1,gift:true,giftMessage:' presente '}],couponCode:'abc',ageConfirmed:false};
  const normalized={...payload,customer:{...payload.customer,name:'Cliente',note:'oi'},couponCode:'ABC'};
  assert.equal(hashOrderRequestIntent(payload),hashOrderRequestIntent(normalized));
  assert.notEqual(hashOrderRequestIntent(payload),hashOrderRequestIntent({...payload,items:[{...payload.items[0],qty:2}]}));
});

test('modo memória serializa criações concorrentes do mesmo clientOrderId', async () => {
  const catalog={version:11,settings:{},commerce:{},products:[{id:'p1',name:'Produto',price:1000,stock:1,available:true,images:[],variants:[]}]};
  const repo=new Repository({databaseUrl:'',initialCatalog:catalog,production:false});await repo.init();
  const first=orderBase('MEM-RACE-A',1);first.clientOrderId='same-client';
  const second={...orderBase('MEM-RACE-B',1),clientOrderId:'same-client'};
  const [a,b]=await Promise.all([repo.createOrder(first),repo.createOrder(second)]);
  assert.equal([a,b].filter(item=>item.created).length,1);
  assert.equal((await repo.getCatalog()).products[0].stock,0);
  assert.equal(a.order.id,b.order.id);
});

test('revisão do catálogo detecta gravação administrativa obsoleta', () => {
  const a={version:11,products:[{id:'p',stock:5}]};
  const rev=catalogRevision(a);assert.equal(rev.length,64);assert.doesNotThrow(()=>assertCatalogRevision(rev,a));
  const b={version:11,products:[{id:'p',stock:4}]};
  assert.throws(()=>assertCatalogRevision(rev,b),error=>error?.code==='CATALOG_REVISION_CONFLICT');
});

test('frete grátis por limiar é sanitizado como regra global para não prometer escopo ignorado', () => {
  const catalog=normalizeCatalog({version:11,settings:{},commerce:{},products:[],promotions:[{id:'f',name:'F',type:'free_shipping_threshold',active:true,minSubtotalCents:10000,productId:'p',variantId:'v',department:'vinhos',category:'x'}]});
  const promo=catalog.promotions[0];
  assert.equal(promo.productId,'');assert.equal(promo.variantId,'');assert.equal(promo.department,'');assert.equal(promo.category,'');
});

test('rotas administrativas usam revisão otimista para importação e ordem por IDs', async () => {
  const [server,admin]=await Promise.all([readFile(new URL('../server.js',import.meta.url),'utf8'),readFile(new URL('../public/js/admin.js',import.meta.url),'utf8')]);
  assert.match(server,/app\.get\('\/api\/admin\/catalog'/);
  assert.match(server,/assertCatalogRevision\(req\.body\?\.revision, current\)/);
  assert.match(server,/productOrderIds/);
  assert.match(admin,/catalogRevision/);
  assert.match(admin,/productOrderIds:ordered\.map\(product=>product\.id\)/);
});


test('promoção não acumulável nunca é somada ao grupo acumulável', () => {
  const product={id:'p1',department:'cafes'};
  const lines=[{productId:'p1',variantId:'',qty:1,unitPriceCents:1000,lineTotalCents:1000}];
  const base=[
    {id:'s1',name:'S1',type:'category_percent',active:true,department:'cafes',value:20,stackable:true},
    {id:'s2',name:'S2',type:'category_percent',active:true,department:'cafes',value:20,stackable:true}
  ];
  const stronger=calculateAutomaticPromotions({lines,productsById:new Map([['p1',product]]),promotions:[...base,{id:'n',name:'N',type:'category_percent',active:true,department:'cafes',value:50,stackable:false}]});
  assert.equal(stronger.discountCents,500);
  assert.deepEqual(stronger.applied.filter(x=>x.discountCents).map(x=>x.id),['n']);
  const weaker=calculateAutomaticPromotions({lines,productsById:new Map([['p1',product]]),promotions:[...base,{id:'n2',name:'N2',type:'category_percent',active:true,department:'cafes',value:30,stackable:false}]});
  assert.equal(weaker.discountCents,400);
  assert.deepEqual(weaker.applied.filter(x=>x.discountCents).map(x=>x.id).sort(),['s1','s2']);
});

test('fuzz: descontos automáticos respeitam teto, metadados e não acumulabilidade', () => {
  let seed=0x1a2b3c4d;
  const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;};
  for(let i=0;i<800;i++){
    const subtotal=100+Math.floor(rnd()*200000);
    const product={id:'p',department:'cafes'};
    const lines=[{productId:'p',variantId:'',qty:1+Math.floor(rnd()*8),unitPriceCents:subtotal,lineTotalCents:subtotal}];
    const promotions=[];
    for(let j=0;j<6;j++) promotions.push({id:`p${j}`,name:`P${j}`,type:'category_percent',active:true,department:'cafes',value:1+Math.floor(rnd()*100),stackable:rnd()<.55});
    const result=calculateAutomaticPromotions({lines,productsById:new Map([['p',product]]),promotions,shippingPriceCents:Math.floor(rnd()*10000)});
    assert.ok(Number.isSafeInteger(result.discountCents));
    assert.ok(result.discountCents>=0 && result.discountCents<=Math.max(0,subtotal-100));
    assert.equal(result.applied.reduce((sum,x)=>sum+(x.discountCents||0),0),result.discountCents);
    const productApplied=result.applied.filter(x=>x.discountCents>0);
    const nonStackIds=new Set(promotions.filter(x=>!x.stackable).map(x=>x.id));
    if(productApplied.some(x=>nonStackIds.has(x.id))) assert.equal(productApplied.length,1,'não acumulável deve ser exclusiva');
  }
});

test('fuzz: reservar e liberar estoque preserva exatamente o inventário original', () => {
  let seed=0xdecafbad;
  const rnd=()=>{seed=(Math.imul(seed,1103515245)+12345)>>>0;return seed/0x100000000;};
  for(let i=0;i<500;i++){
    const stock=5+Math.floor(rnd()*95);
    const q1=1+Math.floor(rnd()*Math.max(1,Math.floor(stock/2)));
    const q2=Math.min(stock-q1,Math.floor(rnd()*Math.max(1,stock-q1+1)));
    const items=[{productId:'p',variantId:'',qty:q1},...(q2>0?[{productId:'p',variantId:'',qty:q2}]:[])];
    const catalog={version:11,products:[{id:'p',name:'P',stock,variants:[]}]};
    const order={id:`F${i}`,items};
    const reserved=reserveInventory(catalog,order,15,Date.UTC(2026,0,1));
    assert.equal(reserved.catalog.products[0].stock,stock-q1-q2);
    const released=releaseInventory(reserved.catalog,reserved.order);
    assert.equal(released.catalog.products[0].stock,stock);
  }
});

test('contratos expert adicionais: catálogo monotônico, checkout no-store e webhook usa estado sob lock', async () => {
  const [server,repoSource,clientCatalog]=await Promise.all([
    readFile(new URL('../server.js',import.meta.url),'utf8'),
    readFile(new URL('../src/repository.js',import.meta.url),'utf8'),
    readFile(new URL('../public/js/store/catalog.js',import.meta.url),'utf8')
  ]);
  assert.match(server,/app\.post\('\/api\/payments\/checkout'[\s\S]{0,220}Cache-Control', 'no-store'/);
  assert.match(server,/version:\s*Math\.max\(Number\(current\.version\) \|\| 1, Number\(req\.body\?\.version\) \|\| 0\)/);
  assert.match(server,/previousStatus\s*=\s*current\.status;[\s\S]*?previousStatus !== updated\.status/);
  assert.match(server,/notifiedStatuses\.delete\(notificationKey\)/);
  assert.match(server,/restockRunPromise/);
  assert.match(repoSource,/timingSafeEqual/);
  assert.match(clientCatalog,/stackableTotal=stackable\.reduce/);
});


test('lock de reposição impede envio concorrente e permite retry quando SMTP falha', async () => {
  const repo=new Repository({databaseUrl:'',initialCatalog:{version:11,settings:{},commerce:{},products:[]},production:false});await repo.init();
  const item={id:'restock-lock',productId:'p',variantId:'',email:'a@example.com',status:'active',createdAt:new Date().toISOString()};
  repo.memoryRestockSubscriptions.set(item.id,{...item});
  let calls=0;
  const first=repo.withRestockNotificationLock(item.id,async()=>{calls++;await new Promise(r=>setTimeout(r,25));return true;});
  await new Promise(r=>setTimeout(r,2));
  const second=repo.withRestockNotificationLock(item.id,async()=>{calls++;return true;});
  const [a,b]=await Promise.all([first,second]);
  assert.equal(calls,1);
  assert.equal(a.notified,true);
  assert.equal(b.claimed,false);
  assert.equal(repo.memoryRestockSubscriptions.get(item.id).status,'notified');

  const retry={...item,id:'restock-retry'};repo.memoryRestockSubscriptions.set(retry.id,{...retry});
  const failed=await repo.withRestockNotificationLock(retry.id,async()=>false);
  assert.equal(failed.notified,false);assert.equal(repo.memoryRestockSubscriptions.get(retry.id).status,'active');
  const ok=await repo.withRestockNotificationLock(retry.id,async()=>true);
  assert.equal(ok.notified,true);assert.equal(repo.memoryRestockSubscriptions.get(retry.id).status,'notified');
});


test('pedido legado sem reserva também não pode ser marcado pago sem estoque real', async () => {
  const repo=new Repository({databaseUrl:'',initialCatalog:{version:11,settings:{},commerce:{},products:[{id:'p1',name:'P',price:1000,stock:0,available:true,variants:[],images:[]}]},production:false});await repo.init();
  const legacy=orderBase('LEGACY-NO-STOCK',1);repo.memoryOrders.set(legacy.id,legacy);repo.clientIndex.set(legacy.clientOrderId,legacy.id);
  await assert.rejects(()=>repo.updateOrder(legacy.id,{status:'paid'},{source:'admin'}),error=>error?.code==='OUT_OF_STOCK');
  assert.equal((await repo.getOrder(legacy.id)).status,'received');
});


test('PUBLIC_URL de produção precisa ser origem HTTPS limpa', () => {
  assert.equal(isValidPublicUrl('https://loja.exemplo.com'),true);
  assert.equal(isValidPublicUrl('https://loja.exemplo.com/'),true);
  assert.equal(isValidPublicUrl('http://loja.exemplo.com'),false);
  assert.equal(isValidPublicUrl('https://loja.exemplo.com/subpasta'),false);
  assert.equal(isValidPublicUrl('https://loja.exemplo.com/?utm=x'),false);
  assert.equal(isValidPublicUrl('https://user:pass@loja.exemplo.com'),false);
});


test('SEO marca estoque com a mesma regra de comprabilidade e não anuncia preço zero', async () => {
  const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
  assert.match(server,/availability = isStockAlertPurchasable\(product, primaryVariantId\)/);
  assert.match(server,/offers: pricing\.unitPriceCents > 0 \?/);
});


test('slugs duplicados longos continuam únicos e roteáveis dentro do limite de 100 caracteres', () => {
  const long='produto-'+('muito-longo-'.repeat(12));
  const normalized=normalizeCatalog({version:11,settings:{},commerce:{},products:[
    {id:'id-primeiro-abcdefghijklmnop',name:'Primeiro',slug:long,price:1000,variants:[],images:[]},
    {id:'id-segundo-qrstuvwxyz123456',name:'Segundo',slug:long,price:1000,variants:[],images:[]},
    {id:'id-terceiro-qrstuvwxyz123456',name:'Terceiro',slug:long,price:1000,variants:[],images:[]}
  ]});
  const slugs=normalized.products.map(p=>p.slug);
  assert.equal(new Set(slugs).size,3);
  assert.ok(slugs.every(slug=>slug.length<=100));
  assert.ok(slugs.every(slug=>/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)));
});


test('conta do cliente faz merge atômico e não perde atualização concorrente de campo distinto', async () => {
  const repo=new Repository({databaseUrl:'',initialCatalog:{version:11,settings:{},commerce:{},products:[]},production:false});await repo.init();
  await repo.ensureCustomerAccount('cliente@example.com');
  const first=repo.updateCustomerAccount('cliente@example.com',async current=>{
    await new Promise(resolve=>setTimeout(resolve,15));
    return {...current,name:'Nome Atualizado'};
  });
  const second=repo.updateCustomerAccount('cliente@example.com',current=>({...current,favorites:['p1']}));
  await Promise.all([first,second]);
  const saved=await repo.getCustomerAccount('cliente@example.com');
  assert.equal(saved.name,'Nome Atualizado');
  assert.deepEqual(saved.favorites,['p1']);
});

test('cotação de frete rejeita antes da transportadora itens que o pedido rejeitaria', () => {
  const catalog={version:11,settings:{},commerce:{},promotions:[],products:[
    {id:'p1',name:'Mínimo 2',price:1000,stock:3,minPerOrder:2,maxPerOrder:3,available:true,hidden:false,variants:[]},
    {id:'p2',name:'Com variação',price:2000,stock:null,available:true,hidden:false,variants:[{id:'v1',name:'V1',price:2100,stock:1}]}
  ]};
  assert.throws(()=>validateShippingQuoteItems([{productId:'p1',qty:1}],catalog),/Quantidade mínima/i);
  assert.throws(()=>validateShippingQuoteItems([{productId:'p1',qty:4}],catalog),/Quantidade máxima/i);
  assert.throws(()=>validateShippingQuoteItems([{productId:'p2',variantId:'inexistente',qty:1}],catalog),/Opção inválida/i);
  assert.throws(()=>validateShippingQuoteItems([{productId:'p2',variantId:'v1',qty:2}],catalog),/Estoque insuficiente/i);
  assert.throws(()=>validateShippingQuoteItems([{productId:'nao-existe',qty:1}],catalog),/não está mais disponível/i);
  const ok=validateShippingQuoteItems([{productId:'p1',qty:2},{productId:'p2',variantId:'v1',qty:1}],catalog);
  assert.equal(ok.subtotalCents,4100);
  assert.equal(ok.unitCount,3);
  assert.deepEqual(ok.items,[{productId:'p1',variantId:'',qty:2},{productId:'p2',variantId:'v1',qty:1}]);
});

test('rota pública de frete usa validador estrito e conta não faz read-modify-write fora do lock', async () => {
  const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
  const shipping = await readFile(new URL('../src/shipping-checkout.js',import.meta.url),'utf8');
  assert.match(shipping,/validateShippingQuoteItems\(items, catalog\)/);
  assert.match(server,/shippingCheckout\.quote/);
  assert.match(server,/updateCustomerAccount\(req\.customerSession\.email/);
  assert.doesNotMatch(server,/app\.patch\('\/api\/account\/profile'[\s\S]{0,500}getCustomerAccount/);
});


test('colisão de clientOrderId sem capability é rejeitada no preflight antes de cotar frete', async () => {
  const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
  const preflight=server.slice(server.indexOf("app.post('/api/orders'"),server.indexOf("const resolved = await resolveCorreiosShipping"));
  assert.match(preflight,/if \(requestedClientOrderId\) \{/);
  assert.match(preflight,/getOrderByClientId\(requestedClientOrderId\)/);
  assert.match(preflight,/idempotencyOwnership\(existing, clientOrderKeyHash, clientOrderRequestHash, safeEqual\)/);
  assert.doesNotMatch(preflight,/requestedClientOrderId && clientOrderKeyHash/);
});


test('exclusão lógica preserva âncora de estoque para cancelar pedido reservado', async () => {
  const catalog={version:11,settings:{},commerce:{},products:[{id:'p1',name:'Produto',price:1000,stock:2,available:true,hidden:false,images:[],variants:[]}]};
  const repo=new Repository({databaseUrl:'',initialCatalog:catalog,production:false});await repo.init();
  await repo.createOrder(orderBase('DELETE-RESERVED',1));
  assert.equal((await repo.getCatalog()).products[0].stock,1);
  await repo.mutateCatalog(current=>normalizeCatalog({...current,products:current.products.map(product=>product.id==='p1'?{...product,hidden:true,available:false,deletedAt:new Date().toISOString()}:product)}));
  const tombstone=(await repo.getCatalog()).products[0];
  assert.equal(tombstone.hidden,true);assert.ok(tombstone.deletedAt);
  const cancelled=await repo.updateOrder('DELETE-RESERVED',{status:'cancelled'},{source:'admin'});
  assert.ok(cancelled.inventoryReservationReleasedAt);
  assert.equal((await repo.getCatalog()).products[0].stock,2,'estoque precisa voltar mesmo após exclusão da vitrine');
});

test('Admin usa tombstone em exclusão e importação/reordenação preserva arquivados', async () => {
  const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
  const deletion=server.slice(server.indexOf("app.delete('/api/admin/products/:id'"),server.indexOf("app.get('/api/admin/settings'"));
  assert.match(deletion,/hidden:\s*true,\s*available:\s*false,\s*deletedAt/);
  assert.doesNotMatch(deletion,/filter\(product => product\.id !== productId\)/);
  const catalogRoute=server.slice(server.indexOf("app.put('/api/admin/catalog'"),server.indexOf("app.get('/api/admin/audit'"));
  assert.match(catalogRoute,/const archived = current\.products\.filter\(product => product\.deletedAt\)/);
  assert.match(catalogRoute,/Omitidos viram tombstones/);
  assert.match(server,/\/api\/admin\/products[\s\S]{0,300}filter\(product => !product\.deletedAt\)/);
});

test('revisão por produto impede Admin de sobrescrever estoque alterado por venda concorrente', () => {
  const before={id:'p1',name:'Produto',stock:10,variants:[]};
  const rev=productRevision(before);
  assertProductRevision(rev,before);
  assert.throws(()=>assertProductRevision(rev,{...before,stock:8}),error=>error?.code==='PRODUCT_REVISION_CONFLICT');
});

test('variação arquivada some da loja mas continua como âncora para liberar reserva antiga', () => {
  const raw={version:11,settings:{},commerce:{},products:[{id:'p1',name:'Produto',price:1000,stock:null,available:true,hidden:false,images:[],variants:[{id:'v1',name:'Antiga',price:1000,stock:3,deletedAt:'2026-09-03T00:00:00.000Z'}]}]};
  const normalized=normalizeCatalog(raw);
  assert.ok(normalized.products[0].variants[0].deletedAt);
  const publicView=publicCatalog(normalized,{mercadoPagoAccessToken:'',mercadoPagoWebhookSecret:'',whatsappNumber:'',shippingMode:'',shippingFixedCents:null,freeShippingCents:null});
  assert.equal(publicView.products[0].variants.length,0);
  assert.throws(()=>productPrice(normalized.products[0],'v1',[]),/Opção inválida/);
  const released=releaseInventory(normalized,{items:[{productId:'p1',variantId:'v1',qty:2}]});
  assert.equal(released.catalog.products[0].variants[0].stock,5);
});

test('contrato do Admin exige revisão por produto e arquiva variações omitidas', async () => {
  const [server,admin]=await Promise.all([readFile(new URL('../server.js',import.meta.url),'utf8'),readFile(new URL('../public/js/admin.js',import.meta.url),'utf8')]);
  assert.match(server,/assertProductRevision\(expectedRevision, current\.products\[index\]\)/);
  assert.match(server,/deletedAt:\s*variant\.deletedAt\s*\|\|\s*new Date\(\)\.toISOString\(\)/);
  assert.match(admin,/expectedRevision:activeProduct\?\._revision\|\|''/);
});

test('promoções importadas perigosas são rejeitadas no backend e preço promocional é sempre preço-base acumulável', () => {
  assert.throws(()=>normalizeCatalog({version:11,settings:{},commerce:{},products:[],promotions:[{id:'sale-global',type:'sale_price',active:true,salePriceCents:100}]}),/exige produto/i);
  assert.throws(()=>normalizeCatalog({version:11,settings:{},commerce:{},products:[],promotions:[{id:'bundle-bad',type:'bundle_percent',active:true,value:10,requiredProductIds:['p1','p1']}]}),/pelo menos 2 produtos/i);
  assert.throws(()=>normalizeCatalog({version:11,settings:{},commerce:{},products:[],promotions:[{id:'date-bad',type:'free_shipping_threshold',active:true,minSubtotalCents:1000,startsAt:'2026-09-10T00:00:00Z',endsAt:'2026-09-09T00:00:00Z'}]}),/posterior ao início/i);
  const normalized=normalizeCatalog({version:11,settings:{},commerce:{},products:[],promotions:[{id:'sale-1',type:'sale_price',active:true,productId:'p1',salePriceCents:900,stackable:false}]});
  assert.equal(normalized.promotions[0].stackable,true);
});

test('tombstones nunca reaparecem no catálogo público, estoque, SEO ou sitemap', async () => {
  const raw={version:11,settings:{},commerce:{},products:[{id:'gone',name:'Arquivado',slug:'arquivado',price:1000,stock:5,available:true,hidden:false,deletedAt:'2026-09-03T00:00:00Z',variants:[]}]};
  const normalized=normalizeCatalog(raw);
  assert.equal(isStockAlertPurchasable(normalized.products[0],''),false);
  const publicView=publicCatalog(normalized,{mercadoPagoAccessToken:'',mercadoPagoWebhookSecret:'',whatsappNumber:'',shippingMode:'',shippingFixedCents:null,freeShippingCents:null});
  assert.equal(publicView.products.length,0);
  const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
  assert.match(server,/item\.slug === slug && !item\.deletedAt && item\.hidden !== true/);
  assert.match(server,/filter\(product => !product\.deletedAt && product\.hidden !== true && product\.available !== false && product\.slug\)/);
  assert.match(server,/integrall-hero-cover\.webp/);
});

test('PostgreSQL serializa clientOrderId antes de tocar no estoque', async () => {
  const repository=await readFile(new URL('../src/repository.js',import.meta.url),'utf8');
  const start=repository.indexOf('async createOrder(order)');
  const end=repository.indexOf('\n  async updateOrder',start);
  const block=repository.slice(start,end);
  const begin=block.indexOf("await client.query('BEGIN')");
  const dbBlock=block.slice(begin);
  const advisory=dbBlock.indexOf('pg_advisory_xact_lock(hashtext($1))');
  const catalogLock=dbBlock.indexOf('SELECT data FROM integrall_catalog WHERE id = 1 FOR UPDATE');
  assert.ok(advisory>=0,'advisory lock precisa existir');
  assert.ok(catalogLock>=0,'catalog lock precisa existir');
  assert.ok(advisory<catalogLock,'clientOrderId precisa ser serializado antes do catálogo/estoque');
});

test('empacotador não encolhe geometria impossível para obter cotação automática', () => {
  const service=new CorreiosService({mode:'mock'});
  const catalog={products:[{id:'p',name:'Volume alto',weightGrams:1000,lengthCm:50,widthCm:50,heightCm:60,variants:[]}]};
  const pack=service.packOrder([{productId:'p',qty:2}],new Map(catalog.products.map(product=>[product.id,product])));
  assert.equal(pack.missingData,true);
  assert.ok(pack.packages.every(pkg=>pkg.lengthCm<=100&&pkg.widthCm<=100&&pkg.heightCm<=100));
});

test('rotas públicas e alertas administrativos ignoram produtos arquivados', async () => {
  const server=await readFile(new URL('../server.js',import.meta.url),'utf8');
  assert.match(server,/some\(product => product\.id === productId && !product\.deletedAt && product\.hidden !== true\)/);
  assert.match(server,/find\(item => item\.id === productId && !item\.deletedAt && item\.hidden !== true\)/);
  assert.match(server,/for \(const product of catalog\?\.products \|\| \[\]\) \{\n    if \(product\.deletedAt\) continue;/);
});

test('Admin não oferece acumulação fictícia para preço-base/frete e ressincroniza controles após reset', async () => {
  const [admin,catalog]=await Promise.all([readFile(new URL('../public/js/admin.js',import.meta.url),'utf8'),readFile(new URL('../src/catalog.js',import.meta.url),'utf8')]);
  assert.match(admin,/forced=type==='sale_price'\|\|type==='free_shipping_threshold'/);
  assert.match(admin,/promotionForm'\)\.reset\(\);populatePromotionProductOptions\(\);updatePromotionScopeControls\(\)/);
  assert.match(catalog,/type === 'sale_price' \|\| type === 'free_shipping_threshold'/);
});

test('pedido não aceita contato telefônico evidentemente inválido', () => {
  const catalog=normalizeCatalog({version:11,settings:{shipMode:'fixed',fixed:0},commerce:{},products:[{id:'p',name:'Produto',price:1000,stock:2,available:true,hidden:false,variants:[],images:[]}]});
  assert.throws(()=>buildOrder({customer:{name:'Cliente',phone:'x'},items:[{productId:'p',qty:1}],shipping:{choice:'pickup'}},catalog,{shippingMode:'fixed'}),/Telefone inválido/);
});

test('revisões por seção impedem perda de edição sem conflitar com estoque alheio', async () => {
  const coupons=[{code:'A',type:'percent',value:10,active:true}];
  const revision=sectionRevision(coupons);
  assertSectionRevision(revision,coupons,'cupons');
  assert.throws(()=>assertSectionRevision(revision,[...coupons,{code:'B'}],'cupons'),error=>error?.code==='SECTION_REVISION_CONFLICT');
  const [server,admin]=await Promise.all([readFile(new URL('../server.js',import.meta.url),'utf8'),readFile(new URL('../public/js/admin.js',import.meta.url),'utf8')]);
  assert.match(server,/assertSectionRevision\(req\.body\?\.revision, current\.promotions/);
  assert.match(server,/assertSectionRevision\(req\.body\?\.revision, current\.coupons/);
  assert.match(server,/assertSectionRevision\(body\.revision, current\.settings/);
  assert.match(admin,/promotionsRevision/);assert.match(admin,/couponsRevision/);assert.match(admin,/themeRevision/);
});

test('catálogo rejeita produto/variação ativa sem preço ou sem nome', () => {
  assert.throws(()=>normalizeCatalog({version:11,settings:{},commerce:{},products:[{id:'p',name:'Ativo grátis',price:0,available:true,hidden:false,variants:[]}]}),/preço maior que zero/i);
  assert.doesNotThrow(()=>normalizeCatalog({version:11,settings:{},commerce:{},products:[{id:'p',name:'Rascunho',price:0,available:false,hidden:false,variants:[]}]}));
  assert.throws(()=>normalizeCatalog({version:11,settings:{},commerce:{},products:[{id:'p',name:'Produto',price:1000,available:true,hidden:false,variants:[{id:'v',name:'',price:1000}]}]}),/precisa de nome/i);
  assert.throws(()=>normalizeCatalog({version:11,settings:{},commerce:{},products:[{id:'p',name:'Produto',price:1000,available:true,hidden:false,variants:[{id:'v',name:'V',price:0}]}]}),/preço maior que zero/i);
});
