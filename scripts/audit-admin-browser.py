#!/usr/bin/env python3
"""Real admin UI + production auth controllers via a test-driver HTTP bridge.
Chromium's managed URL policy is NOT changed. about:blank hosts the HTML/CSS/JS.
Cookies are held by the test driver, not the browser; TLS/Express/browser cookie
policy and native navigation are not certified by this integration test.
"""
import argparse,json,re,subprocess,time,urllib.request,urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path.cwd());p.add_argument('--out',type=Path,required=True);args=p.parse_args()
root=args.root.resolve();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
server=subprocess.Popen(['node','tests/fixtures/admin-http-adapter.mjs'],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
info=json.loads(server.stdout.readline());base=info['url'];cookie='';calls=[];results=[]
credential='159213'+'Rafs'
def http(payload):
 global cookie
 path=payload['path'];assert path.startswith('/api/')
 headers=dict(payload.get('headers') or {});headers['Origin']=base
 if cookie:headers['Cookie']=cookie
 body=payload.get('body');request=urllib.request.Request(base+path,data=body.encode() if body else None,headers=headers,method=payload.get('method','GET'))
 try:response=urllib.request.urlopen(request,timeout=10)
 except urllib.error.HTTPError as error:response=error
 set_cookie=response.headers.get('Set-Cookie')
 if set_cookie:cookie=set_cookie.split(';')[0]
 data=json.loads(response.read());calls.append({'method':request.method,'path':path,'status':response.status})
 return {'status':response.status,'data':data}
def state(**values):
 server.stdin.write(json.dumps(values)+'\n');server.stdin.flush();time.sleep(.05)
html=(root/'public/admin.html').read_text()
html=re.sub(r'<link\b[^>]*>','',html,flags=re.I)
html=re.sub(r'<script\b[^>]*src=[^>]*></script>','',html,flags=re.I)
html=html.replace('src="/?adminPreview=1"','src="about:blank"')
css=(root/'public/css/admin.css').read_text();js=(root/'public/js/admin.js').read_text()
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  context=browser.new_context(viewport={'width':1440,'height':950},reduced_motion='reduce')
  pages=[];errors=[]
  def open_ui():
   page=context.new_page();pages.append(page);page.set_default_timeout(10000)
   page.on('pageerror',lambda error:errors.append(str(error)))
   page.expose_function('auditHttp',http)
   page.set_content(html,wait_until='domcontentloaded');page.add_style_tag(content=css)
   page.evaluate("""() => { window.fetch=async (url,options={})=>{ const result=await window.auditHttp({path:String(url),method:options.method||'GET',headers:Object.fromEntries(new Headers(options.headers||{})),body:typeof options.body==='string'?options.body:undefined});return new Response(JSON.stringify(result.data),{status:result.status,headers:{'Content-Type':'application/json'}}); }; }""")
   page.add_script_tag(content=js);return page
  page=open_ui();page.wait_for_selector('#loginView:not([hidden])')
  for value,label in [('', 'empty'),(credential.lower(),'lowercase'),(credential.upper(),'uppercase'),(credential[:-1],'partial'),(credential+' ','trailing-space'),('senha-anterior','different')]:
   page.fill('#loginPassword',value);page.click('#loginButton');page.wait_for_function("document.querySelector('#loginFeedback').textContent.includes('inválidos')")
   assert page.locator('#dashboard').is_hidden();results.append({'test':'negative-'+label,'status':'APROVADO'})
  page.screenshot(path=str(out/'senha-incorreta-recusada.png'))
  page.fill('#loginPassword',credential);page.locator('#loginPassword').press('Enter');page.wait_for_selector('#dashboard:not([hidden])');page.wait_for_timeout(150)
  assert page.locator('#loginPassword').input_value()==''
  assert credential not in page.locator('body').inner_text()
  page.screenshot(path=str(out/'login-correto.png'));results.append({'test':'exact-credential-enter-controller-real','status':'APROVADO'})
  # New document starts without password, retaining the driver's cookie jar.
  page2=open_ui();page2.wait_for_selector('#dashboard:not([hidden])');page2.wait_for_timeout(100)
  page2.screenshot(path=str(out/'painel-rebootstrap.png'));results.append({'test':'new-document-session-restore','status':'APROVADO'})
  page2.close();pages.remove(page2)
  state(failLogout=True);page.click('#logoutButton');page.wait_for_selector('#adminSessionFeedback:not([hidden])')
  assert 'clique em Sair novamente' in page.locator('#adminSessionFeedback').inner_text()
  assert page.locator('#dashboard').is_visible()
  assert http({'path':'/api/admin/session'})['data']['authenticated']
  page.screenshot(path=str(out/'logout-falha-nao-mascarada.png'));results.append({'test':'logout-503-retains-session-and-retry','status':'APROVADO'})
  # An old session response must not reopen a dashboard after successful logout.
  state(failLogout=False,delaySession=300)
  page.evaluate("window.dispatchEvent(new Event('focus'))")
  page.wait_for_timeout(30);page.click('#logoutButton');page.wait_for_selector('#loginView:not([hidden])');page.wait_for_timeout(500)
  assert page.locator('#dashboard').is_hidden();assert not http({'path':'/api/admin/session'})['data']['authenticated']
  page.screenshot(path=str(out/'logout-confirmado.png'));results.append({'test':'logout-and-stale-response-generation','status':'APROVADO'})
  state(delaySession=0)
  page.fill('#loginPassword',credential);page.click('#loginButton');page.wait_for_selector('#dashboard:not([hidden])')
  page2=open_ui();page2.wait_for_selector('#dashboard:not([hidden])')
  page.click('#logoutButton');page.wait_for_selector('#loginView:not([hidden])')
  page2.evaluate("window.dispatchEvent(new Event('focus'))");page2.wait_for_selector('#loginView:not([hidden])')
  results.append({'test':'second-client-focus-rechecks-server-revocation','status':'APROVADO'})
  cookie='integrall_admin_session=corrupted'
  page3=open_ui();page3.wait_for_selector('#loginView:not([hidden])');assert page3.locator('#dashboard').is_hidden()
  results.append({'test':'corrupted-cookie-refused','status':'APROVADO'})
  assert not errors,errors
  results.append({'test':'uncaught-page-errors','status':'APROVADO','errors':errors})
  browser.close()
finally:
 server.terminate()
 try:server.wait(timeout=5)
 except subprocess.TimeoutExpired:server.kill()
report={'status':'APROVADO','scope':'about:blank actual admin UI; test-driver cookie jar and HTTP bridge; production session controllers/Auth/Repository; ancillary dashboard data fixtures; NOT Express/TLS/browser-cookie-policy/native navigation','results':results,'requests':calls}
(out/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':report['status'],'tests':len(results),'requests':len(calls)},ensure_ascii=False))
