/** TEST ONLY: core-HTTP transport for production session controllers/Auth/Repository.
 * Not an alternative application server. Dashboard ancillary responses are fixtures.
 * Does not validate Express, production TLS, browser cookies, or live integrations. */
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {AdminAuth} from '../../src/auth.js';
import {createAdminSessionHandlers} from '../../src/admin-session.js';
import {Repository} from '../../src/repository.js';
import {normalizeCatalog} from '../../src/catalog.js';
import {config} from '../../src/config.js';

export async function createAuditServer() {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const initialCatalog=normalizeCatalog(JSON.parse(await readFile(path.join(root,'data/catalog.json'),'utf8')));
  const dir=await mkdtemp(path.join(os.tmpdir(),'integrall-auth-audit-'));
  const repo=new Repository({databaseUrl:'',initialCatalog,localDataDir:dir});await repo.init();
  const auth=new AdminAuth({email:config.adminEmail,passwordHash:config.adminPasswordHash,sessionSecret:'only-for-isolated-tests-'.repeat(3),sessionStore:repo});
  const audit=[];const handlers=createAdminSessionHandlers({adminAuth:auth,auditAdmin:async(...args)=>audit.push({action:args[1],details:args[4]})});
  const state={failLogout:false,delaySession:0};
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
    res.status=code=>{res.statusCode=code;return res;};res.json=data=>{res.end(JSON.stringify(data));return res;};
    req.protocol='http';req.get=key=>req.headers[key.toLowerCase()]||'';
    try {
      let body='';for await(const chunk of req){body+=chunk;if(body.length>20000)return res.status(413).json({error:'Corpo grande demais.'});}
      req.body=body?JSON.parse(body):{};const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/api/admin/session' && req.method==='GET') {
        // Snapshot-before-delay deliberately exercises stale response protection.
        if(state.delaySession){const snapshot=await auth.readSession(req);await new Promise(r=>setTimeout(r,state.delaySession));return res.json({configured:true,authenticated:Boolean(snapshot),user:snapshot?{email:snapshot.sub,role:snapshot.role}:null,csrfToken:snapshot?.csrf||''});}
        return handlers.read(req,res);
      }
      if(url.pathname==='/api/admin/session/login' && req.method==='POST')return handlers.login(req,res);
      if(url.pathname==='/api/health')return res.json({ok:true,database:'isolated JSON repository',mercadoPago:false});
      const session=await auth.authorizeRequest(req,res);if(!session)return;
      req.admin={email:session.sub,role:session.role,jti:session.jti,csrf:session.csrf,exp:session.exp};
      if(url.pathname==='/api/admin/session/logout' && req.method==='POST') {
        if(state.failLogout)return res.status(503).json({error:'Falha de teste no armazenamento.'});
        return handlers.logout(req,res);
      }
      if(url.pathname==='/api/admin/audit-probe')return res.json({authorized:true});
      const catalog=await repo.getCatalog();
      const fixtures={
        '/api/admin/catalog':{catalog,revision:'fixture-1',products:catalog.products.length},
        '/api/admin/products':{products:catalog.products},
        '/api/admin/settings':{settings:catalog.settings},
        '/api/admin/orders':{orders:[]},'/api/admin/customers':{customers:[]},
        '/api/admin/coupons':{coupons:[]},'/api/admin/promotions':{promotions:[]},
        '/api/admin/inventory/alerts':{alerts:[],subscriptions:[]},'/api/admin/reviews':{reviews:[]}
      };
      if(req.method==='GET' && fixtures[url.pathname])return res.json(fixtures[url.pathname]);
      return res.status(404).json({error:'Rota não coberta por este adaptador de teste.'});
    } catch {if(!res.writableEnded)res.status(500).json({error:'Erro no adaptador de teste.'});}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,auth,repo,audit,state,url:`http://127.0.0.1:${server.address().port}`,async close(){await new Promise(resolve=>server.close(resolve));await repo.close();await rm(dir,{recursive:true,force:true});}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const fixture=await createAuditServer();
  process.stdout.write(JSON.stringify({url:fixture.url,mode:'test-adapter'})+'\n');
  process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{try{Object.assign(fixture.state,JSON.parse(chunk));}catch{}});
  process.on('SIGTERM',async()=>{await fixture.close();process.exit(0);});
}
