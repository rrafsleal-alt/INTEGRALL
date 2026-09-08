import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {CustomerAuth} from '../src/customer-auth.js';
import {LocalMediaStorage} from '../src/media-storage.js';
import {validateAndSanitizeImage} from '../src/image-upload.js';

function authFixture() {
  const codes = new Map(), sessions = new Map();
  const repository = {
    async saveCustomerLoginCode(record) { codes.set(record.email, record); },
    async consumeCustomerLoginCode(email, candidate) {
      if (codes.get(email)?.codeHash !== candidate) return false;
      codes.delete(email); return true;
    },
    async ensureCustomerAccount(email) { return {email, addresses: [], favorites: []}; },
    async saveCustomerSession(record) { sessions.set(record.tokenHash, record); },
    async getCustomerSession(key) { return sessions.get(key) || null; },
    async deleteCustomerSession(key) { sessions.delete(key); }
  };
  return {auth: new CustomerAuth({repository, codeSecret: 'isolated-customer-regression-secret-not-for-deployment'}), sessions};
}

for (const [label, alter] of [
  ['letras', code => `abc${code}`],
  ['dígitos excedentes', code => `${code}99`],
  ['separadores internos', code => `${code.slice(0,3)}-${code.slice(3)}`]
]) test(`cliente: código com ${label} é recusado sem consumir o código válido`, async () => {
  const {auth} = authFixture();
  const issued = await auth.createLoginCode('cliente@example.com');
  assert.equal(Boolean(await auth.verifyLoginCode(issued.email, alter(issued.code))), false);
  assert.ok(await auth.verifyLoginCode(issued.email, issued.code));
  assert.equal(await auth.verifyLoginCode(issued.email, issued.code), null);
});

test('cliente: e-mail acima de 254 caracteres não vira outro identificador truncado', () => {
  const {auth} = authFixture();
  assert.equal(auth.normalizeEmail(`${'a'.repeat(240)}@example.com.zz`), '');
  assert.equal(auth.normalizeEmail(' Cliente@Example.com '), 'cliente@example.com');
});

for (const expiresAt of ['inválido', '', undefined]) test(`cliente: sessão com expiração ${String(expiresAt)} é revogada`, async () => {
  const {auth, sessions} = authFixture();
  const issued = await auth.createLoginCode('cliente@example.com');
  const verified = await auth.verifyLoginCode(issued.email, issued.code);
  const saved = [...sessions.values()][0]; saved.expiresAt = expiresAt;
  assert.equal(Boolean(await auth.readSession({headers: {cookie: auth.cookie(verified.token, verified.expiresAt)}})), false);
  assert.equal(sessions.size, 0);
});

test('cliente: sessão válida continua aceita e cookie malformado é recusado', async () => {
  const {auth} = authFixture();
  const issued = await auth.createLoginCode('cliente@example.com');
  const verified = await auth.verifyLoginCode(issued.email, issued.code);
  assert.equal((await auth.readSession({headers: {cookie: auth.cookie(verified.token, verified.expiresAt)}})).email, issued.email);
  assert.equal(await auth.readSession({headers: {cookie: 'integrall_customer_session=%GG'}}), null);
});

async function loadApi(fetchFn, timers = {}) {
  const source = await readFile(new URL('../public/js/store/api.js', import.meta.url), 'utf8');
  const context = vm.createContext({location: {protocol: 'https:', origin: 'https://loja.test'}, fetch: fetchFn, Headers, FormData, AbortController, DOMException, setTimeout, clearTimeout, ...timers});
  vm.runInContext(source, context);
  return context.IntegrallApi;
}

test('API: erro HTTP preserva status, código e requestId para expiração da sessão', async () => {
  const api = await loadApi(async () => new Response(JSON.stringify({error: 'Entre novamente.', code: 'ACCOUNT_AUTH_REQUIRED', requestId: 'req-fixture'}), {status: 401}));
  await assert.rejects(api.request('/api/account/logout', {method: 'POST'}), error => error.status === 401 && error.code === 'ACCOUNT_AUTH_REQUIRED' && error.requestId === 'req-fixture');
});

test('API: resposta 200 contendo HTML não é apresentada como sucesso vazio', async () => {
  const api = await loadApi(async () => new Response('<html>Erro do proxy</html>', {status: 200}));
  await assert.rejects(api.request('/api/account/profile'), error => error.code === 'API_RESPONSE_INVALID');
});

test('API: resposta HTTP 503 sem JSON preserva o status', async () => {
  const api = await loadApi(async () => new Response('Temporariamente indisponível', {status: 503}));
  await assert.rejects(api.request('/api/catalog'), error => error.status === 503);
});

test('API: HTTP 204 sem corpo continua compatível', async () => {
  const api = await loadApi(async () => new Response(null, {status: 204}));
  assert.equal(JSON.stringify(await api.request('/api/account/logout')), '{}');
});

test('API: requisição já cancelada não inicia acesso à rede', async () => {
  let called = 0;
  const api = await loadApi(async () => {called++; return new Response('{}');});
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.request('/api/catalog', {signal: controller.signal}), error => error.name === 'AbortError');
  assert.equal(called, 0);
});

test('API: cancelamento externo durante a resposta é propagado', async () => {
  let started;
  const ready = new Promise(resolve => {started = resolve;});
  const api = await loadApi((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')), {once: true}); started();
  }));
  const controller = new AbortController();
  const result = api.request('/api/catalog', {signal: controller.signal});
  const rejection = assert.rejects(result, error => error.name === 'AbortError');
  await ready; controller.abort(); await rejection;
});

test('API: FormData mantém cabeçalho multipart gerado pelo navegador', async () => {
  let headers;
  const api = await loadApi(async (_url, options) => {headers = options.headers; return new Response('{}');});
  const form = new FormData(); form.append('label', 'imagem');
  await api.request('/api/upload', {method: 'POST', body: form});
  assert.equal(headers.has('Content-Type'), false);
});

test('mídia local: ordena por data antes de limitar, não pelo nome aleatório', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'integrall-media-order-'));
  try {
    const store = new LocalMediaStorage(dir); await store.init();
    for (const [id, date] of [['zzzzzzzzzz-old', '2025-01-01T00:00:00.000Z'], ['aaaaaaaaaa-new', '2026-01-01T00:00:00.000Z']]) {
      await store.save({id, mimeType: 'image/png', createdAt: date, data: Buffer.from('isolated-test')});
    }
    assert.equal((await store.list({limit: 1}))[0].id, 'aaaaaaaaaa-new');
  } finally {await rm(dir, {recursive: true, force: true});}
});

function webpChunk(type, payload) {
  const head = Buffer.alloc(8); head.write(type); head.writeUInt32LE(payload.length, 4);
  return Buffer.concat([head, payload, ...(payload.length % 2 ? [Buffer.alloc(1)] : [])]);
}
function webp(chunks) {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const head = Buffer.alloc(8); head.write('RIFF'); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
function vp8x(w=1, h=1, flags=0) {
  const payload = Buffer.alloc(10); payload[0] = flags;
  payload.writeUIntLE(w-1, 4, 3); payload.writeUIntLE(h-1, 7, 3); return payload;
}

test('upload: WebP apenas com cabeçalho de canvas, sem imagem, é recusado', () => {
  assert.throws(() => validateAndSanitizeImage({data: webp([webpChunk('VP8X', vp8x())])}), error => error.code === 'IMAGE_CORRUPTED');
});

test('upload: dimensões de VP8 ocultas por um VP8X pequeno não burlam o limite', () => {
  const fake = Buffer.alloc(11); fake[3]=0x9d; fake[4]=0x01; fake[5]=0x2a;
  fake.writeUInt16LE(9000, 6); fake.writeUInt16LE(2, 8);
  assert.throws(() => validateAndSanitizeImage({data: webp([webpChunk('VP8X', vp8x()), webpChunk('VP8 ', fake)])}), error => error.status === 413 || error.code === 'IMAGE_CORRUPTED');
});

test('upload: cabeçalho VP8L sem dados de pixels é recusado', () => {
  assert.throws(() => validateAndSanitizeImage({data: webp([webpChunk('VP8L', Buffer.from([0x2f,0,0,0,0]))])}), error => error.code === 'IMAGE_CORRUPTED');
});

import {sanitizeAccountPatch} from '../src/customer-profile.js';
import {Repository} from '../src/repository.js';
const address = {id: 'endereco-1',label:'Casa',cep:'13000-000',street:'Rua teste',number:'10',city:'Campinas',state:'sp'};
for(const [label, patch] of [
  ['CEP ausente', {addresses:[{...address,cep:''}]}],
  ['CEP excedente', {addresses:[{...address,cep:'130000000'}]}],
  ['sexto endereço', {addresses:Array.from({length:6},(_,i)=>({...address,id:`endereco-${i}`}))}],
  ['endereço incompleto', {addresses:[{...address,street:''}]}],
  ['tipo incorreto', {addresses:'apagar-sem-querer'}]
]) test(`perfil: ${label} retorna erro em vez de descartar ou truncar dados`, () => {
  assert.throws(()=>sanitizeAccountPatch(patch, {email:'cliente@example.com',addresses:[address]}), error=>error.status===400);
});

test('perfil: editar nome preserva endereços legados, sem migração destrutiva', () => {
  const current={email:'cliente@example.com',addresses:[{...address,cep:''}],favorites:['produto-1']};
  const edited=sanitizeAccountPatch({name:' Novo nome '},current);
  assert.equal(edited.name,'Novo nome');assert.deepEqual(edited.addresses,current.addresses);assert.deepEqual(edited.favorites,current.favorites);
});

test('perfil: endereço completo normaliza CEP e UF, exclusão explícita funciona', () => {
  const edited=sanitizeAccountPatch({addresses:[address]},{});
  assert.equal(edited.addresses[0].cep,'13000000');assert.equal(edited.addresses[0].state,'SP');
  assert.deepEqual(sanitizeAccountPatch({addresses:[]},edited).addresses,[]);
});

test('perfil: validação falha dentro do lock sem apagar os dados anteriores', async()=>{
  const repo=new Repository({databaseUrl:'',initialCatalog:{version:9,settings:{},commerce:{},products:[]},production:false});
  await repo.init();await repo.ensureCustomerAccount('cliente@example.com');
  await repo.updateCustomerAccount('cliente@example.com',current=>sanitizeAccountPatch({addresses:[address]},current));
  const before=await repo.getCustomerAccount('cliente@example.com');
  await assert.rejects(repo.updateCustomerAccount('cliente@example.com',current=>sanitizeAccountPatch({addresses:[{...address,city:''}]},current)));
  assert.deepEqual(await repo.getCustomerAccount('cliente@example.com'),before);
});

test('repositório: expiração ou tentativas inválidas não validam código temporário',async()=>{
  const repo=new Repository({databaseUrl:'',initialCatalog:{version:9,settings:{},commerce:{},products:[]},production:false});await repo.init();
  for(const values of [{expiresAt:'inválido',attempts:0},{expiresAt:new Date(Date.now()+600000).toISOString(),attempts:NaN}]){
    repo.memoryLoginCodes.set('cliente@example.com',{email:'cliente@example.com',codeHash:'fixture-hash',...values});
    assert.equal(await repo.consumeCustomerLoginCode('cliente@example.com','fixture-hash'),false);
  }
});

for (const file of ['lossy.webp','lossless.webp','alpha.webp','animated.webp','metadata.webp']) test(`upload: WebP válido ${file} permanece aceito`,async()=>{
  const data=await readFile(new URL(`./fixtures/client-images/${file}`,import.meta.url));
  const result=validateAndSanitizeImage({data,declaredMime:'image/webp',filename:file});
  assert.equal(result.width,32);assert.equal(result.height,24);
  assert.equal(result.mimeType,'image/webp');
  if(file==='metadata.webp')assert.equal(result.data.includes(Buffer.from('TEST-METADATA')),false);
});

test('API: cancelamento durante leitura do JSON não vira erro de formato',async()=>{
  const controller=new AbortController();let ready;
  const started=new Promise(resolve=>{ready=resolve;});
  const api=await loadApi(async(_url,options)=>({ok:true,status:200,headers:new Headers(),json:()=>new Promise((_resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelado','AbortError')),{once:true});ready();
  })}));
  const pending=api.request('/api/catalog',{signal:controller.signal});
  const rejected=assert.rejects(pending,error=>error.name==='AbortError');await started;controller.abort();await rejected;
});

test('API: timeout tem código próprio, distinto de cancelamento do usuário',async()=>{
  const api=await loadApi((_url,options)=>new Promise((_resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(new DOMException('Abortado','AbortError')),{once:true});
  }),{setTimeout:fn=>setTimeout(fn,5)});
  await assert.rejects(api.request('/api/catalog'),error=>error.code==='API_TIMEOUT'&&error.status===0);
});

test('mídia local: sidecar nulo não derruba a listagem de arquivos válidos',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'integrall-media-invalid-'));
  try{
    const store=new LocalMediaStorage(dir);await store.init();
    await store.save({id:'valid-image-0001',mimeType:'image/png',createdAt:'2026-01-01T00:00:00Z',data:Buffer.from('fixture')});
    await writeFile(path.join(dir,'invalid-file-0001.json'),'null');
    assert.equal((await store.list()).length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
