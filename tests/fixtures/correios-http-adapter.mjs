/** TEST ONLY. HTTP local com serviços/repositório reais e provedor Correios
 * SIMULADO. Não substitui Express, cookies, TLS ou homologação externa. */
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {CorreiosService} from '../../src/correios.js';
import {ShippingCheckout} from '../../src/shipping-checkout.js';
import {normalizeCatalog,buildOrder} from '../../src/catalog.js';
import {toPublicOrder} from '../../src/public-order.js';
import {Repository} from '../../src/repository.js';
import {hashClientOrderKey,hashOrderRequestIntent,idempotencyOwnership} from '../../src/order-idempotency.js';

export async function createShippingFixture() {
 const initialCatalog=normalizeCatalog({settings:{brand:'INTEGRALL',free:0,shipMode:'correios',min:0},products:[{id:'shipping-fixture',name:'Produto de teste — cotação de envio',department:'outros',price:5000,stock:100,available:true,boxes:[{units:1,weightGrams:3000,lengthCm:16,widthCm:26,heightCm:29}],variants:[]}]});
 const dir=await mkdtemp(path.join(os.tmpdir(),'integrall-shipping-fixture-'));
 const repo=new Repository({databaseUrl:'',initialCatalog,localDataDir:dir});await repo.init();
 const state={failProvider:false,unavailableSedex:false,rateDelta:0,daysDelta:0,expirePreview:false};
 const stats={providerRequests:[],orders:[],quoteRequests:[],paymentRequests:0};
 const config={shippingMode:'correios',correiosOriginCep:'07074000',correiosServices:'03298:PAC,03220:SEDEX',shippingQuoteSecret:'FIXTURE-ONLY-SHIPPING-SECRET-'.repeat(3),freeShippingCents:0};
 let correios,flow;
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  const send=(data,status=200)=>{res.statusCode=status;res.end(JSON.stringify(data));};
  try{
   const u=new URL(req.url,'http://localhost');let raw='';for await(const c of req){raw+=c;if(raw.length>100000)return send({error:'too-large'},413);}const body=raw?JSON.parse(raw):{};
   if(u.pathname==='/__fixture/state'){Object.assign(state,body);correios.quoteCache.clear();correios.cooldownUntil=0;return send({ok:true});}
   if(u.pathname==='/__fixture/stats')return send(stats);
   if(u.pathname.startsWith('/token/')){stats.providerRequests.push({path:u.pathname});return send({token:'ONLY_FOR_TEST_HTTP_CREDENTIAL',expiraEm:new Date(Date.now()+3600000).toISOString()});}
   if(u.pathname.startsWith('/preco/')||u.pathname.startsWith('/prazo/')){
    const code=u.pathname.split('/').at(-1);stats.providerRequests.push({path:u.pathname,params:Object.fromEntries(u.searchParams)});
    if(state.failProvider)return send({error:'Falha intencional do provedor simulado'},503);
    if(code==='03220'&&state.unavailableSedex)return send({coProduto:code,txErro:'Indisponível na fixture'});
    return send(u.pathname.startsWith('/preco/')?{coProduto:code,pcFinal:(((code==='03298'?2317:2646)+state.rateDelta)/100).toFixed(2).replace('.',',')}:{coProduto:code,prazoEntrega:(code==='03298'?8:4)+state.daysDelta,dataMaxima:'2026-09-18T23:59:59',entregaDomiciliar:'S',entregaSabado:'N',entregaDomingo:'N'});
   }
   if(u.pathname==='/api/health')return send({ok:true,features:{correiosShipping:true,shippingConfigured:true,shippingEnvironment:'producao'}});
   if(u.pathname==='/api/catalog')return send({catalog:await repo.getCatalog()});
   if(u.pathname==='/api/shipping/quote'){
    stats.quoteRequests.push(body);const result=await flow.quote(body.cep,body.items,await repo.getCatalog());if(state.expirePreview)result.expiresAt=new Date(Date.now()+700).toISOString();return send(result);
   }
   if(u.pathname==='/api/orders'&&req.method==='POST'){
    stats.orders.push(body);
    const key=hashClientOrderKey(body.clientOrderKey);const hash=hashOrderRequestIntent(body);const existing=await repo.getOrderByClientId(body.clientOrderId);
    if(existing){const ownership=idempotencyOwnership(existing,key,hash);if(!ownership.ok)return send({code:ownership.code,error:'Pedido alterado'},409);return send({order:{...toPublicOrder(existing),checkoutToken:existing.checkoutToken,requiresShippingQuote:existing.requiresShippingQuote},idempotent:true});}
    const clean={...body,shipping:{...body.shipping}};delete clean.shipping.resolved;
    const cat=await repo.getCatalog();const resolved=await flow.resolve(clean,cat);const order=buildOrder({...clean,shipping:{...clean.shipping,...(resolved?{resolved}:{})}},cat,config);
    order.clientOrderKeyHash=key;order.clientOrderRequestHash=hash;
    const saved=await repo.createOrder(order);return send({order:{...toPublicOrder(saved.order),checkoutToken:saved.order.checkoutToken,requiresShippingQuote:saved.order.requiresShippingQuote,onlinePaymentAvailable:false}},201);
   }
   if(u.pathname==='/api/orders/status'){const order=await repo.getOrder(body.orderId);if(!order||order.checkoutToken!==body.checkoutToken)return send({error:'not-found'},404);return send({order:toPublicOrder(order)});}
   if(u.pathname==='/api/payments/checkout'){stats.paymentRequests++;return send({error:'Pagamento real não participa deste teste.'},503);}
   return send({error:'Rota ausente na fixture'},404);
  }catch(error){send({code:error.code||'FIXTURE_ERROR',error:error.message},error.status||400);}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
 correios=new CorreiosService({user:'fixture-user',accessCode:'FIXTURE-ONLY-ACCESS',contract:'1234567890',originCep:config.correiosOriginCep,baseUrl:url,allowTestBase:true});
 flow=new ShippingCheckout({config,enabled:()=>correios.configured,getRates:(context,bypassCache)=>correios.quote(context.cep,context.pack,context.subtotalCents,{bypassCache})});
 return {url,repo,server,state,stats,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await repo.close();await rm(dir,{recursive:true,force:true});}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const fixture=await createShippingFixture();process.stdout.write(JSON.stringify({url:fixture.url})+'\n');process.on('SIGTERM',async()=>{await fixture.close();process.exit(0);});
}
