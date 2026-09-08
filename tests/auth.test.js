import test from 'node:test';
import assert from 'node:assert/strict';
import {AdminAuth, hashPassword, verifyPassword, hasPermission} from '../src/auth.js';

const PASSWORD = 'Senha-Forte-Para-Testes-2026!';

test('scrypt cria hash verificável e rejeita senha incorreta', async () => {
  const hash = await hashPassword(PASSWORD, {cost: 4096, salt: Buffer.alloc(16, 7)});
  assert.match(hash, /^scrypt\$4096\$8\$1\$/);
  assert.equal(await verifyPassword(PASSWORD, hash), true);
  assert.equal(await verifyPassword('senha-incorreta', hash), false);
  assert.equal(await verifyPassword(PASSWORD, 'inválido'), false);
});

test('sessão administrativa é assinada, expira e carrega CSRF', async () => {
  const passwordHash = await hashPassword(PASSWORD, {cost: 4096, salt: Buffer.alloc(16, 8)});
  const auth = new AdminAuth({
    email: 'Admin@Example.com', passwordHash, role: 'editor', sessionSecret: 'x'.repeat(64), sessionHours: 1
  });
  const user = await auth.authenticate('admin@example.com', PASSWORD);
  assert.deepEqual(user, {email: 'admin@example.com', role: 'editor'});
  assert.equal(await auth.authenticate('admin@example.com', 'errada'), null);
  const session = await auth.createSession(user);
  assert.match(session.cookie, /^integrall_admin_session=/);
  assert.match(session.cookie, /HttpOnly/);
  assert.match(session.cookie, /SameSite=Strict/);
  const token = session.cookie.match(/^integrall_admin_session=([^;]+)/)[1];
  const payload = auth.verifyToken(token);
  assert.equal(payload.sub, 'admin@example.com');
  assert.equal(payload.role, 'editor');
  assert.ok(payload.csrf.length >= 20);
  assert.equal(auth.verifyToken(`${token}tamper`), null);
});

test('login aceita e-mail em branco e valida somente o hash configurado', async () => {
  const configuredPassword = 'Senha-Principal-2026!';
  const configuredHash = await hashPassword(configuredPassword, {cost: 4096, salt: Buffer.alloc(16, 9)});
  const auth = new AdminAuth({
    email: 'admin@integrall.local',
    passwordHash: configuredHash,
    sessionSecret: 'z'.repeat(64)
  });
  assert.deepEqual(await auth.authenticate('', configuredPassword), {email: 'admin@integrall.local', role: 'admin'});
  assert.equal(await auth.authenticate('', ['159213', 'Rafs'].join('')), null);
  assert.equal(await auth.authenticate('outro@example.com', configuredPassword), null);
});

test('papéis aplicam menor privilégio', () => {
  assert.equal(hasPermission('admin', 'catalog:write'), true);
  assert.equal(hasPermission('editor', 'catalog:write'), true);
  assert.equal(hasPermission('editor', 'orders:write'), false);
  assert.equal(hasPermission('operator', 'orders:write'), true);
  assert.equal(hasPermission('operator', 'catalog:write'), false);
});


test('middleware administrativo aplica no-store também em sessão autenticada', async () => {
  const passwordHash = await hashPassword(PASSWORD, {cost: 4096, salt: Buffer.alloc(16, 11)});
  const auth = new AdminAuth({email:'admin@example.com',passwordHash,sessionSecret:'n'.repeat(64)});
  const user = await auth.authenticate('admin@example.com',PASSWORD);
  const session = await auth.createSession(user);
  const req={method:'GET',protocol:'https',headers:{cookie:session.cookie.split(';')[0]},get(name){return name.toLowerCase()==='host'?'loja.example.com':'';}};
  const headers={};
  const res={setHeader(name,value){headers[String(name).toLowerCase()]=String(value);},status(){return this;},json(){return this;}};
  let called=false;
  await auth.requireSession()(req,res,()=>{called=true;});
  assert.equal(called,true);
  assert.equal(headers['cache-control'],'no-store');
});

test('logout revoga a sessão administrativa no armazenamento compartilhado', async () => {
  const active = new Map();
  const store = {
    async saveAdminSession(session) { active.set(session.jti, session); },
    async getAdminSession(jti) { return active.get(jti) || null; },
    async deleteAdminSession(jti) { return active.delete(jti); }
  };
  const passwordHash = await hashPassword(PASSWORD, {cost: 4096, salt: Buffer.alloc(16, 13)});
  const auth = new AdminAuth({email:'admin@example.com',passwordHash,sessionSecret:'r'.repeat(64),sessionStore:store});
  const user = await auth.authenticate('', PASSWORD);
  const session = await auth.createSession(user);
  const cookie = session.cookie.split(';')[0];
  const req = {headers:{cookie}};
  const before = await auth.readSession(req);
  assert.equal(before.jti, session.payload.jti);
  assert.equal(await auth.revokeSession(before), true);
  assert.equal(await auth.readSession(req), null);
});
