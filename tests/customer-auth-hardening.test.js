import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CustomerAuth} from '../src/customer-auth.js';

function repositoryFixture() {
  const codes = new Map();
  const accounts = new Map();
  const sessions = new Map();
  return {
    codes,
    sessions,
    repository: {
      async saveCustomerLoginCode(record) { codes.set(record.email, {...record, attempts: 0}); },
      async getCustomerLoginCode(email) { return codes.get(email) || null; },
      async incrementCustomerLoginAttempts(email) { const record=codes.get(email); if(record) record.attempts=(record.attempts||0)+1; },
      async deleteCustomerLoginCode(email) { codes.delete(email); },
      async consumeCustomerLoginCode(email, candidateHash) {
        const record=codes.get(email);
        if(!record || Date.parse(record.expiresAt)<=Date.now() || Number(record.attempts)>=5) return false;
        if(record.codeHash!==candidateHash){record.attempts=Number(record.attempts||0)+1;return false;}
        codes.delete(email);
        return true;
      },
      async ensureCustomerAccount(email) { if(!accounts.has(email)) accounts.set(email,{email,name:'',phone:'',addresses:[],favorites:[]}); return structuredClone(accounts.get(email)); },
      async saveCustomerSession(session) { sessions.set(session.tokenHash, session); },
      async getCustomerSession(tokenHash) { return sessions.get(tokenHash) || null; },
      async deleteCustomerSession(tokenHash) { sessions.delete(tokenHash); }
    }
  };
}

function responseFixture() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()]=String(value); return this; },
    status(code) { this.statusCode=code; return this; },
    json(value) { this.body=value; return this; }
  };
}

const secret = 'customer-auth-test-secret-that-is-long-enough-2026';

test('CustomerAuth exige segredo persistente com pelo menos 32 caracteres', () => {
  const {repository}=repositoryFixture();
  assert.throws(() => new CustomerAuth({repository,codeSecret:'curto'}), /pelo menos 32/);
  assert.doesNotThrow(() => new CustomerAuth({repository,codeSecret:secret}));
});

test('código temporário é armazenado como HMAC vinculado ao e-mail', async () => {
  const {repository,codes}=repositoryFixture();
  const auth=new CustomerAuth({repository,codeSecret:secret,codeMinutes:10});
  const login=await auth.createLoginCode('Cliente@Example.com');
  const record=codes.get('cliente@example.com');
  assert.ok(record);
  assert.match(record.codeHash,/^hmac-sha256\$[a-f0-9]{64}$/);
  const plain=createHash('sha256').update(login.code).digest('hex');
  assert.notEqual(record.codeHash,plain);
  assert.equal(record.codeHash.includes(login.code),false);
});

test('mesmo código não autentica outro e-mail', async () => {
  const fixture=repositoryFixture();
  const auth=new CustomerAuth({repository:fixture.repository,codeSecret:secret,codeMinutes:10});
  const login=await auth.createLoginCode('primeiro@example.com');
  fixture.codes.set('segundo@example.com',{...fixture.codes.get('primeiro@example.com'),email:'segundo@example.com',attempts:0});
  assert.equal(await auth.verifyLoginCode('segundo@example.com',login.code),null);
  assert.equal(fixture.codes.get('segundo@example.com').attempts,1);
});

test('código de login é consumido atomicamente e só cria uma sessão', async () => {
  const fixture=repositoryFixture();
  const auth=new CustomerAuth({repository:fixture.repository,codeSecret:secret,codeMinutes:10});
  const login=await auth.createLoginCode('concorrencia@example.com');
  const results=await Promise.all([
    auth.verifyLoginCode(login.email,login.code),
    auth.verifyLoginCode(login.email,login.code)
  ]);
  assert.equal(results.filter(Boolean).length,1);
  assert.equal(fixture.sessions.size,1);
  assert.equal(fixture.codes.has(login.email),false);
});

test('cookie do cliente é HttpOnly, SameSite Strict e pode ser limpo de forma explícita', async () => {
  const fixture=repositoryFixture();
  const auth=new CustomerAuth({repository:fixture.repository,codeSecret:secret,secureCookies:true});
  const login=await auth.createLoginCode('cliente@example.com');
  const verified=await auth.verifyLoginCode(login.email,login.code);
  const cookie=auth.cookie(verified.token,verified.expiresAt);
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/SameSite=Strict/);
  assert.match(cookie,/; Secure/);
  assert.match(auth.clearCookie(),/Max-Age=0/);
  assert.match(auth.clearCookie(),/Expires=Thu, 01 Jan 1970/);
});

test('middleware CSRF recusa requisição cross-site mesmo com token correto', async () => {
  const fixture=repositoryFixture();
  const auth=new CustomerAuth({repository:fixture.repository,codeSecret:secret,publicUrl:'https://loja.example.com'});
  const login=await auth.createLoginCode('cliente@example.com');
  const verified=await auth.verifyLoginCode(login.email,login.code);
  const req={
    protocol:'https',
    headers:{
      cookie:auth.cookie(verified.token,verified.expiresAt).split(';')[0],
      host:'loja.example.com',
      origin:'https://malicioso.example',
      'sec-fetch-site':'cross-site',
      'x-customer-csrf':verified.csrfToken
    },
    get(name){return this.headers[String(name).toLowerCase()]||'';}
  };
  const res=responseFixture();
  let called=false;
  await auth.requireCsrf()(req,res,()=>{called=true;});
  assert.equal(called,false);
  assert.equal(res.statusCode,403);
  assert.equal(res.body.code,'ACCOUNT_CSRF_INVALID');
});

test('middleware CSRF aceita mesma origem e token válido', async () => {
  const fixture=repositoryFixture();
  const auth=new CustomerAuth({repository:fixture.repository,codeSecret:secret,publicUrl:'https://loja.example.com'});
  const login=await auth.createLoginCode('cliente@example.com');
  const verified=await auth.verifyLoginCode(login.email,login.code);
  const req={
    protocol:'https',
    headers:{
      cookie:auth.cookie(verified.token,verified.expiresAt).split(';')[0],
      host:'loja.example.com',
      origin:'https://loja.example.com',
      'sec-fetch-site':'same-origin',
      'x-customer-csrf':verified.csrfToken
    },
    get(name){return this.headers[String(name).toLowerCase()]||'';}
  };
  const res=responseFixture();
  let called=false;
  await auth.requireCsrf()(req,res,()=>{called=true;});
  assert.equal(called,true);
  assert.equal(req.customerSession.email,'cliente@example.com');
});


test('cookie malformado não causa exceção nem derruba a autenticação', async () => {
  const fixture=repositoryFixture();
  const auth=new CustomerAuth({repository:fixture.repository,codeSecret:secret});
  const req={headers:{cookie:'integrall_customer_session=%ZZ; outro=valor'}};
  await assert.doesNotReject(() => auth.readSession(req));
  assert.equal(await auth.readSession(req),null);
});

test('middlewares autenticados impedem cache de dados privados', async () => {
  const fixture=repositoryFixture();
  const auth=new CustomerAuth({repository:fixture.repository,codeSecret:secret,publicUrl:'https://loja.example.com'});
  const login=await auth.createLoginCode('privado@example.com');
  const verified=await auth.verifyLoginCode(login.email,login.code);
  const baseHeaders={
    cookie:auth.cookie(verified.token,verified.expiresAt).split(';')[0],
    host:'loja.example.com',
    origin:'https://loja.example.com',
    'sec-fetch-site':'same-origin'
  };
  const reqSession={protocol:'https',headers:{...baseHeaders},get(name){return this.headers[String(name).toLowerCase()]||'';}};
  const resSession=responseFixture();
  let sessionCalled=false;
  await auth.requireSession()(reqSession,resSession,()=>{sessionCalled=true;});
  assert.equal(sessionCalled,true);
  assert.equal(resSession.headers['cache-control'],'no-store');

  const reqCsrf={protocol:'https',headers:{...baseHeaders,'x-customer-csrf':verified.csrfToken},get(name){return this.headers[String(name).toLowerCase()]||'';}};
  const resCsrf=responseFixture();
  let csrfCalled=false;
  await auth.requireCsrf()(reqCsrf,resCsrf,()=>{csrfCalled=true;});
  assert.equal(csrfCalled,true);
  assert.equal(resCsrf.headers['cache-control'],'no-store');
});
