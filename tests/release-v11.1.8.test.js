import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Repository} from '../src/repository.js';
import {normalizeCatalog, publicCatalog} from '../src/catalog.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalog=()=>normalizeCatalog({version:9,settings:{},commerce:{},products:[{id:'P1',name:'Produto teste',price:1000,available:true,stock:10,images:[],variants:[],attributes:{}}]});
const order=(id='o1')=>({id,clientOrderId:'client-'+id,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'received',customer:{name:'Teste',email:'teste@example.com',phone:'11999999999'},items:[{productId:'P1',variantId:'',qty:2,name:'Produto teste',lineTotalCents:2000}],subtotalCents:2000,shippingCents:0,totalCents:2000,payment:{},history:[]});
const make=dir=>new Repository({databaseUrl:'',initialCatalog:catalog(),localDataDir:dir});
async function isolated(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'integrall-release-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}

test('v11.1.8: pedido, estoque, índice e cliente sobrevivem ao reinício',async()=>isolated(async dir=>{
 let repo=make(dir);await repo.init();await repo.createOrder(order());await repo.close();
 repo=make(dir);await repo.init();assert.equal((await repo.getCatalog()).products[0].stock,8);assert.equal((await repo.getOrder('o1')).id,'o1');assert.equal((await repo.getOrderByClientId('client-o1')).id,'o1');assert.equal((await repo.listCustomers()).length,1);
 const retry=await repo.createOrder(order());assert.equal(retry.created,false);assert.equal((await repo.getCatalog()).products[0].stock,8);await repo.close();
}));

test('v11.1.8: cancelamento libera estoque uma vez, inclusive depois de reiniciar',async()=>isolated(async dir=>{
 let repo=make(dir);await repo.init();await repo.createOrder(order());await repo.close();repo=make(dir);await repo.init();await repo.updateOrder('o1',{status:'cancelled'});assert.equal((await repo.getCatalog()).products[0].stock,10);await repo.close();repo=make(dir);await repo.init();await repo.updateOrder('o1',{status:'cancelled'});assert.equal((await repo.getCatalog()).products[0].stock,10);assert.ok((await repo.getOrder('o1')).inventoryReservationReleasedAt);await repo.close();
}));

test('v11.1.8: pagamento confirmado persiste e não repõe estoque após reiniciar',async()=>isolated(async dir=>{
 let repo=make(dir);await repo.init();await repo.createOrder(order());await repo.updateOrder('o1',{status:'paid'});await repo.close();repo=make(dir);await repo.init();assert.ok((await repo.getOrder('o1')).inventoryCommittedAt);await repo.expireStaleOrders(1);assert.equal((await repo.getCatalog()).products[0].stock,8);assert.equal((await repo.getOrder('o1')).status,'paid');await repo.close();
}));

test('v11.1.8: expiração recupera reserva depois de reiniciar e é idempotente',async()=>isolated(async dir=>{
 let repo=make(dir);await repo.init();await repo.createOrder(order());await repo.updateOrder('o1',{inventoryReservationExpiresAt:new Date(Date.now()-60000).toISOString()});await repo.close();repo=make(dir);await repo.init();await repo.releaseExpiredReservations();assert.equal((await repo.getCatalog()).products[0].stock,10);await repo.releaseExpiredReservations();assert.equal((await repo.getCatalog()).products[0].stock,10);await repo.close();
}));

test('v11.1.8: falha no commit não deixa estoque ou pedido apenas na memória',async()=>isolated(async dir=>{
 const repo=make(dir);await repo.init();const persist=repo.persistLocalState;repo.persistLocalState=async()=>{throw new Error('disk full simulation');};await assert.rejects(repo.createOrder(order()),/disk full/);assert.equal((await repo.getCatalog()).products[0].stock,10);assert.equal(await repo.getOrder('o1'),null);repo.persistLocalState=persist;await repo.createOrder(order());assert.equal((await repo.getCatalog()).products[0].stock,8);await repo.close();
}));

test('v11.1.8: state.json é autoritativo sobre exportação antiga do catálogo',async()=>isolated(async dir=>{
 const repo=make(dir);await repo.init();await repo.createOrder(order());await repo.close();await writeFile(path.join(dir,'catalog.json'),JSON.stringify(catalog()));const reloaded=make(dir);await reloaded.init();assert.equal((await reloaded.getCatalog()).products[0].stock,8);assert.ok(await reloaded.getOrder('o1'));await reloaded.close();
}));

test('v11.1.8: JSON danificado impede inicialização, sem apagar dados silenciosamente',async()=>isolated(async dir=>{
 await writeFile(path.join(dir,'state.json'),'{arquivo interrompido');await assert.rejects(make(dir).init());assert.equal(await readFile(path.join(dir,'state.json'),'utf8'),'{arquivo interrompido');
}));

test('v11.1.8: perfil, favoritos, avaliações, alertas e auditoria persistem',async()=>isolated(async dir=>{
 let repo=make(dir);await repo.init();await repo.saveCustomerAccount('teste@example.com',{favorites:['P1'],addresses:[]});await repo.upsertReview({id:'r1',productId:'P1',email:'teste@example.com',rating:5,status:'pending'});await repo.updateReviewStatus('r1','published');await repo.addRestockSubscription({id:'s1',productId:'P1',variantId:'',email:'teste@example.com',status:'active'});await repo.markRestockNotified(['s1']);await repo.recordAudit({action:'test',entityType:'release'});await repo.close();repo=make(dir);await repo.init();assert.deepEqual((await repo.getCustomerAccount('teste@example.com')).favorites,['P1']);assert.equal((await repo.listReviews())[0].status,'published');assert.equal((await repo.listRestockSubscriptions())[0].status,'notified');assert.equal((await repo.listAudit())[0].action,'test');await repo.close();
}));

test('v11.1.8: 43 IDs recuperados têm mídia em uma instalação nova sem pasta local',async()=>{
 const map=JSON.parse(await readFile(path.join(root,'data/recovery-map.json'),'utf8'));
 const repo=new Repository({databaseUrl:'',initialCatalog:catalog(),packagedMediaDir:path.join(root,'data/media-seed')});await repo.init();
 for(const entry of map.entries){const media=await repo.getMedia(entry.id);assert.ok(media,entry.id);assert.equal(createHash('sha256').update(media.data).digest('hex'),entry.optimizedSha256);assert.equal(media.mimeType,'image/webp');}
 assert.equal(map.entries.length,43);await repo.close();
});

test('v11.1.8: migração de fotografia é específica, repetível e preserva novas edições',async()=>{
 const map=JSON.parse(await readFile(path.join(root,'data/recovery-map.json'),'utf8'));const input=catalog();input.products[0].images=[map.entries[0].legacyUrl,map.entries[0].legacyUrl,'/assets/products/new-photo.webp'];input.products[0].price=7311;input.products[0].stock=7;const before=JSON.stringify(input);const next=normalizeCatalog(input);assert.equal(JSON.stringify(input),before);assert.deepEqual(next.products[0].images,[map.entries[0].publicUrl,'/assets/products/new-photo.webp']);assert.equal(next.products[0].price,7311);assert.equal(next.products[0].stock,7);assert.deepEqual(normalizeCatalog(next),next);
});

test('v11.1.8: 227 cadastros visíveis, com cinco ofertas de compra e 222 itens sob consulta',async()=>{
 const data=JSON.parse(await readFile(path.join(root,'data/catalog.json'),'utf8'));assert.equal(data.products.length,227);assert.equal(data.products.filter(p=>p.hidden===true).length,0);const exposed=publicCatalog(data,{});assert.equal(exposed.products.length,227);assert.equal(exposed.products.filter(p=>p.available&&p.price>0).length,5);assert.equal(exposed.products.filter(p=>p.price===0&&p.available===false).length,222);assert.equal(exposed.commerce.supportEmail,'integrallwine@gmail.com');
});

test('v11.1.8: fallback usa imagens recuperadas e pagamentos continuam dependentes da API',async()=>{
 const html=await readFile(path.join(root,'public/index.html'),'utf8');const embedded=JSON.parse(html.match(/<script id="buildData" type="application\/json">([\s\S]*?)<\/script>/)[1]);assert.equal(embedded.products.length,227);const biscuit=embedded.products.find(p=>p.name==='Mentirinha');assert.ok(biscuit.images[0].startsWith('/assets/recovered/'));assert.equal(biscuit.images.length,1);assert.ok(Object.values(embedded.commerce.paymentMethods).every(value=>value===false));assert.ok(!html.includes('R$ 26,99'));assert.ok(!/<video[^>]*\bautoplay\b/.test(html));assert.ok(html.includes('heroVideoToggle'));
});

test('v11.1.8: suíte HTTP exige dependências e usa dados privados temporários',async()=>{
 const source=await readFile(path.join(root,'tests/http.test.js'),'utf8');assert.ok(source.includes('LOCAL_DATA_DIR: testDataDir'));assert.ok(source.includes('mkdtemp('));assert.ok(!source.includes('HTTP_SKIP_REASON'));const server=await readFile(path.join(root,'server.js'),'utf8');assert.ok(server.includes("config.env === 'test' ? ''"));
});

test('v11.1.8: nenhum preço ou estoque original foi inventado durante a recuperação',async()=>{
 const before=JSON.parse(await readFile(path.join(root,'backups/originais-v11.1.7/catalog.json'),'utf8'));const after=JSON.parse(await readFile(path.join(root,'data/catalog.json'),'utf8'));for(const p of before.products){const q=after.products.find(x=>x.id===p.id);assert.ok(q);assert.equal(q.price,p.price,p.id);assert.equal(q.stock,p.stock,p.id);assert.equal(q.available,p.available,p.id);}
});

test('v11.1.8: estado nulo não reinicializa estoque silenciosamente',async()=>isolated(async dir=>{
 await writeFile(path.join(dir,'state.json'),'null');const repo=make(dir);await assert.rejects(repo.init(),/Estado local inválido/);assert.equal(await readFile(path.join(dir,'state.json'),'utf8'),'null');
}));

test('v11.1.8: identificação pública editável sem enviar preços e produtos',async()=>{
 const html=await readFile(path.join(root,'public/admin.html'),'utf8');const admin=await readFile(path.join(root,'public/js/admin.js'),'utf8');const checkout=await readFile(path.join(root,'public/js/store/checkout.js'),'utf8');
 for(const id of ['businessForm','businessTaxId','businessAddress','businessEmail','businessReturns'])assert.ok(html.includes(`id="${id}"`));
 assert.ok(admin.includes('JSON.stringify({revision:businessRevision,commerce})'));
 assert.ok(checkout.includes('function renderBusinessIdentity()'));assert.ok(checkout.includes('CPF/CNPJ: ${cfg.taxId}'));
});
