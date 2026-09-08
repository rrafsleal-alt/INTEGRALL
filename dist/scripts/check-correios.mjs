/** Diagnóstico somente leitura. Nunca imprime credenciais nem cria postagens. */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {config} from '../src/config.js';
import {CorreiosService} from '../src/correios.js';
import {normalizeCatalog} from '../src/catalog.js';
import {validateShippingBoxes,packRegisteredOrder} from '../src/shipping-packages.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);const allowed=['--strict'];
if(args.some(a=>!allowed.includes(a)&&!a.startsWith('--catalog=')))throw new Error('Use --strict e/ou --catalog=arquivo.json. Este comando NÃO faz consultas externas.');
const source=args.find(a=>a.startsWith('--catalog='))?.slice(10)||path.join(root,'data/catalog.json');
const catalog=normalizeCatalog(JSON.parse(await readFile(source,'utf8')));
const service=new CorreiosService({user:config.correiosUser,accessCode:config.correiosAccessCode,contract:config.correiosContract,postageCard:config.correiosPostageCard,contractDr:config.correiosContractDr,authType:config.correiosAuthType,originCep:config.correiosOriginCep,services:config.correiosServices,homolog:config.correiosHomolog,baseUrl:config.correiosBaseUrl,apiVersion:config.correiosApiVersion,quoteMethod:config.correiosQuoteMethod});
const sale=catalog.products.filter(p=>!p.deletedAt&&!p.hidden&&p.available!==false&&(p.price>0||p.variants?.some(v=>!v.deletedAt&&v.price>0)));
const missing=[];let covered=0,invalid=0;
for(const p of sale){
 try{validateShippingBoxes(p.boxes||[],p.variants||[]);}catch{invalid++;}
 const variants=(p.variants||[]).filter(v=>!v.deletedAt);const entries=variants.length?variants:[{id:''}];
 for(const variant of entries){const quantity=Math.max(1,Number(p.minPerOrder)||1);const pack=packRegisteredOrder([{productId:p.id,variantId:variant.id,qty:quantity}],new Map([[p.id,p]]));
  if(pack.missingData)missing.push({produto:p.name,variacao:variant.name||'sem variação',quantidadeMinima:quantity});else covered++;
 }
}
console.log(JSON.stringify({diagnostico:'somente leitura; credenciais não são exibidas',modoAutomatico:config.shippingMode==='correios',configuracaoCompleta:service.configured,autenticacao:service.authType,ambiente:config.correiosHomolog?'homologacao':'producao',servicos:service.services.map(s=>s.code),catalogo:'arquivo selecionado, NÃO banco/estado operacional',produtos:catalog.products.length,vendaveis:sale.length,vendaveisComCaixas:sale.filter(p=>p.boxes.length).length,variacoesAtendidasNaQuantidadeMinima:covered,cadastrosComCaixaInvalida:invalid,semEmbalagemNaQuantidadeMinima:missing,consultaReal:'NÃO EXECUTADA'},null,2));
if(args.includes('--strict')&&(!service.configured||config.shippingMode!=='correios'||invalid||missing.length))process.exitCode=1;
