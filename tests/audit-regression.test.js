import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {AdminAuth, hasPermission, hashPassword, verifyPassword} from '../src/auth.js';
import {config} from '../src/config.js';
const DEFAULT_ADMIN_PASSWORD_HASH=config.adminPasswordHash;

const credential=['159213','Rafs'].join('');
const options={email:'audit@example.invalid',passwordHash:DEFAULT_ADMIN_PASSWORD_HASH,sessionSecret:'test-only-session-signing-material-'.repeat(2)};
const tokenOf=session=>session.cookie.split(';')[0].split('=')[1];

test('AUDIT-AUTH-01: permissões inválidas falham fechadas, inclusive protótipo',()=>{
  for(const role of ['',null,undefined,'owner','__proto__','constructor','toString']) {
    assert.equal(hasPermission(role,'catalog:write'),false);
    if(role!==undefined)assert.equal(new AdminAuth({...options,role}).configured,false);
  }
});
test('AUDIT-AUTH-02: credencial exata e variantes negativas sem normalização',async()=>{
  const auth=new AdminAuth(options);
  assert.ok(await auth.authenticate('',credential));
  for(const password of ['',credential.toLowerCase(),credential.toUpperCase(),credential.slice(0,-1),' '+credential,credential+' ',credential+'\u200b','senha-antiga','0'.repeat(257)]) {
    assert.equal(await auth.authenticate('',password),null);
  }
});
test('AUDIT-AUTH-03: alteração do hash invalida sessões antigas mesmo com o mesmo segredo',async()=>{
  const old=new AdminAuth(options);const session=await old.createSession(await old.authenticate('',credential));
  const hash=await hashPassword('Senha-de-teste-alternativa!',{cost:4096,salt:Buffer.alloc(16,3)});
  const changed=new AdminAuth({...options,passwordHash:hash});
  assert.equal(changed.verifyToken(tokenOf(session)),null);
  assert.ok(old.verifyToken(tokenOf(session)));
});
test('AUDIT-AUTH-04: redução do papel invalida sessão que concedia mais permissões',async()=>{
  const auth=new AdminAuth(options);const session=await auth.createSession(await auth.authenticate('',credential));
  assert.equal(new AdminAuth({...options,role:'editor'}).verifyToken(tokenOf(session)),null);
});
test('AUDIT-AUTH-05: sessão antiga, corrompida, expirada ou malformada é recusada',async()=>{
  const auth=new AdminAuth(options);const session=await auth.createSession(await auth.authenticate('',credential));
  const malformed=[{v:1},{iat:'ontem'},{iat:Math.floor(Date.now()/1000)+3600},{jti:''},{role:'unknown'}, {credentialVersion:'wrong'},{exp:1},{exp:session.payload.iat+90000}];
  for(const patch of malformed)assert.equal(auth.verifyToken(auth.signPayload({...session.payload,...patch})),null);
  for(const value of ['invalid',tokenOf(session)+'X','{broken',null])assert.equal(auth.verifyToken(value),null);
});
test('AUDIT-AUTH-06: fábrica de sessão não emite tokens para usuário ou papel divergente',async()=>{
  const auth=new AdminAuth(options);
  await assert.rejects(auth.createSession({email:options.email,role:'unknown'}));
  await assert.rejects(auth.createSession({email:'other@example.invalid',role:'admin'}));
});
test('AUDIT-AUTH-07: cookie seguro, revogação e proteção CSRF/origem usam autenticação real',async()=>{
  const sessions=new Map();
  const sessionStore={async saveAdminSession(s){sessions.set(s.jti,s);},async getAdminSession(id){return sessions.get(id)||null;},async deleteAdminSession(id){return sessions.delete(id);}};
  const auth=new AdminAuth({...options,secureCookies:true,publicUrl:'https://store.example.invalid',sessionStore});
  const session=await auth.createSession(await auth.authenticate('',credential));
  assert.match(session.cookie,/HttpOnly/);assert.match(session.cookie,/Secure/);assert.match(session.cookie,/SameSite=Strict/);
  const req={headers:{cookie:session.cookie.split(';')[0],'x-csrf-token':session.payload.csrf,origin:'https://store.example.invalid'},method:'POST',protocol:'https',get(){return 'store.example.invalid';}};
  const res={statusCode:200,setHeader(){},status(s){this.statusCode=s;return this;},json(){return this;}};
  assert.ok(await auth.authorizeRequest(req,res));
  req.headers['x-csrf-token']='incorrect';assert.equal(await auth.authorizeRequest(req,res),null);assert.equal(res.statusCode,403);
  req.headers['x-csrf-token']=session.payload.csrf;req.headers.origin='https://other.example.invalid';assert.equal(await auth.authorizeRequest(req,res),null);
  assert.ok(await auth.readSession({headers:{cookie:session.cookie.split(';')[0]}}));
  await auth.revokeSession(session.payload);assert.equal(await auth.readSession(req),null);
  assert.match(auth.clearCookie(),/Max-Age=0/);
});
test('AUDIT-AUTH-08: falha na revogação do repositório não é silenciada',async()=>{
  const auth=new AdminAuth({...options,sessionStore:{async deleteAdminSession(){throw new Error('storage-unavailable');}}});
  await assert.rejects(auth.revokeSession({jti:'test-session'}),/storage-unavailable/);
});
test('AUDIT-HASH-01: ferramenta de hash conserva espaços finais e não imprime a senha',async()=>{
  const password='Senha-para-teste-com-espaco  ';
  const result=spawnSync(process.execPath,['scripts/hash-admin-password.mjs'],{input:password+'\n',encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.ok(!result.stdout.includes(password));
  const encoded=result.stdout.match(/ADMIN_PASSWORD_HASH=(\S+)/)?.[1];
  assert.ok(encoded);assert.ok(await verifyPassword(password,encoded));assert.equal(await verifyPassword(password.trimEnd(),encoded),false);
});
test('AUDIT-UI-01: logout exige confirmação; atualização entre abas não transporta segredos',async()=>{
  const js=await readFile('public/js/admin.js','utf8');
  assert.match(js,/bindSessionLifecycle/);assert.match(js,/BroadcastChannel/);assert.match(js,/generation!==sessionGeneration/);
  assert.doesNotMatch(js,/finally\{[^}]*showLogin\('Sessão encerrada/);
  assert.match(js,/const notice=\{action,at:Date\.now\(\)\}/);
  assert.match(js,/Verifique sua conexão e clique em Sair novamente/);
});

test('AUDIT-HTTP-01: controladores reais, cookie, CSRF e logout por HTTP (sem Express)',async()=>{
  const {createAuditServer}=await import('./fixtures/admin-http-adapter.mjs');
  const adapter=await createAuditServer();
  try{
    const api=async(path,options={})=>{const response=await fetch(adapter.url+path,options);return{status:response.status,headers:response.headers,data:await response.json()};};
    const post=password=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
    assert.equal((await api('/api/admin/audit-probe')).status,401);
    for(const value of ['',credential.toLowerCase(),credential.toUpperCase(),credential+' ','old-password'])assert.equal((await api('/api/admin/session/login',post(value))).status,401);
    const cross=post(credential);cross.headers.origin='https://attacker.example.invalid';assert.equal((await api('/api/admin/session/login',cross)).status,403);
    const login=await api('/api/admin/session/login',post(credential));assert.equal(login.status,200);assert.ok(login.data.authenticated);
    const cookie=login.headers.get('set-cookie').split(';')[0];const headers={Cookie:cookie,'X-CSRF-Token':login.data.csrfToken};
    assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
    for(let n=0;n<3;n++)assert.ok((await api('/api/admin/session',{headers})).data.authenticated);
    assert.equal((await api('/api/admin/audit-probe',{headers})).status,200);
    assert.equal((await api('/api/admin/session/logout',{method:'POST',headers:{Cookie:cookie}})).status,403);
    adapter.state.failLogout=true;assert.equal((await api('/api/admin/session/logout',{method:'POST',headers})).status,503);
    assert.ok((await api('/api/admin/session',{headers})).data.authenticated);
    adapter.state.failLogout=false;const logout=await api('/api/admin/session/logout',{method:'POST',headers});
    assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
    assert.equal((await api('/api/admin/audit-probe',{headers})).status,401);
    assert.equal((await api('/api/admin/session',{headers})).data.authenticated,false);
    assert.ok(!JSON.stringify(adapter.audit).includes(credential));
  } finally{await adapter.close();}
});
