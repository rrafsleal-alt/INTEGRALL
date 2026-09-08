#!/usr/bin/env python3
"""UI real em Chromium, ponte HTTP de teste, módulos reais do backend e Correios simulado.
NÃO testa Express, transporte/cookies nativos do navegador ou API externa."""
from pathlib import Path
import argparse,importlib.util,json,re,subprocess,urllib.request,urllib.error,sys
from playwright.sync_api import sync_playwright


def main():
 parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path.cwd());parser.add_argument('--out',type=Path,required=True);args=parser.parse_args()
 root=args.root.resolve();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
 spec=importlib.util.spec_from_file_location('regression',root/'scripts/browser-regression.py');helpers=importlib.util.module_from_spec(spec);spec.loader.exec_module(helpers)
 proc=subprocess.Popen(['node','tests/fixtures/correios-http-adapter.mjs'],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 line=proc.stdout.readline();url=json.loads(line)['url'];results=[];failures=[]
 def request(path,body=None):
  req=urllib.request.Request(url+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'})
  try:
   with urllib.request.urlopen(req,timeout=35) as response:return {'status':response.status,'data':json.loads(response.read())}
  except urllib.error.HTTPError as error:return {'status':error.code,'data':json.loads(error.read())}
 def record(name,callback):
  try:details=callback();results.append({'scenario':name,'status':'APROVADO','details':details})
  except Exception as error:failures.append(name);results.append({'scenario':name,'status':'REPROVADO','error':str(error)[:1800]})
 try:
  cat=request('/api/catalog')['data']['catalog'];product=cat['products'][0]
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   def prepare(width=1440,health_unavailable=False):
    context=browser.new_context(viewport={'width':width,'height':1000},bypass_csp=True);page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.route('https://integrall.test/**',lambda route:route.fulfill(status=200,content_type='image/png',body=bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082')))
    page.expose_function('fixtureRequest',lambda path,body:request(path,body))
    page.set_content(helpers.prepare_html(root),wait_until='domcontentloaded')
    for rel in helpers.STYLE_FILES:page.add_style_tag(content=(root/'public'/rel).read_text())
    page.add_script_tag(content=(root/'public/js/store/catalog.js').read_text())
    page.evaluate('p=>{__integrallApp.setProducts([p]);__integrallApp.setSettings({free:0,shipMode:"correios",min:0});const s=__integrallApp.getState();s.cart=[{lineId:"fixture-line",productId:p.id,variantId:"",qty:1,gift:false,giftMessage:""}];s.checkout.choice="delivery";s.checkout.cep="16503018";s.checkout.name="Cliente Teste";__integrallApp.openCart();}',product)
    page.evaluate('''() => {globalThis.__quoteDelay=0;globalThis.__requests=[];globalThis.IntegrallApi={request:async(path,opts={})=>{const data=opts.body?JSON.parse(opts.body):null;__requests.push({path,data});const result=await fixtureRequest(path,data);if(path==='/api/shipping/quote'&&__quoteDelay)await new Promise(r=>setTimeout(r,__quoteDelay));if(result.status>=400)throw Object.assign(new Error(result.data.error),{status:result.status,code:result.data.code});return result.data;},createOrder:body=>IntegrallApi.request('/api/orders',{body:JSON.stringify(body)}),orderStatus:(orderId,checkoutToken)=>IntegrallApi.request('/api/orders/status',{body:JSON.stringify({orderId,checkoutToken})}),createCheckout:()=>{throw new Error('Pagamento não autorizado nesta fixture')}};}''')
    if health_unavailable:page.evaluate("() => {const original=IntegrallApi.request;IntegrallApi.request=(path,opts)=>path==='/api/health'?Promise.reject(new Error('Health indisponível na fixture')):original(path,opts);}")
    page.add_script_tag(content=(root/'public/js/store/checkout.js').read_text());page.wait_for_selector('input[name=correiosService]',timeout=15000)
    return context,page,errors
   def checked(page,expr):
    result=page.evaluate(expr)
    if not result:raise AssertionError(expr)
    return result
   for width in [280,320,375,430,768,1024,1440,1920]:
    context,page,errors=prepare(width)
    def layout():
     page.wait_for_timeout(100);m=page.evaluate('''()=>{const n=document.querySelector('#correiosOptions'),r=n.getBoundingClientRect();return {options:n.querySelectorAll('input[type=radio]').length,text:n.textContent,total:document.querySelector('#cartTotal').textContent,viewport:innerWidth,left:r.left,right:r.right,scroll:document.documentElement.scrollWidth}}''')
     assert m['options']==2 and '23,17' in m['text'] and '26,46' in m['text'],m
     assert m['left']>=-1 and m['right']<=width+1 and m['scroll']<=width+1,m
     assert '73,17' in m['total'],m
     assert not errors,errors
     assert 'Valor e prazo serão confirmados no atendimento' not in page.locator('#cartReceipt').inner_text()
     if width in [320,768,1440]:page.screenshot(path=str(out/f'cotacao-{width}.png'),full_page=False)
     return m
    record(f'cotacao-e-layout-{width}px',layout)
    def select_sedex():
     page.locator('input[name=correiosService][value="03220"]').check();page.wait_for_timeout(40);return checked(page,'()=>document.querySelector("#cartTotal").textContent.includes("76,46")')
    record(f'escolha-SEDEX-{width}px',select_sedex);context.close()
   context,page,errors=prepare(health_unavailable=True)
   record('cotacao-disponivel-com-health-indisponivel',lambda:checked(page,'()=>__integrallPublicHealth.ok===false&&document.querySelectorAll("input[name=correiosService]").length===2'))
   context.close()
   context,page,errors=prepare()
   def qty_change():
    page.evaluate('()=>{__integrallApp.getState().cart[0].qty=2;__integrallApp.renderCart()}');page.wait_for_timeout(20)
    checked(page,'()=>!document.querySelector("#correiosOptions input[name=correiosService]")')
    page.wait_for_selector('input[name=correiosService]',timeout=15000)
    return checked(page,'()=>document.querySelector("#cartTotal").textContent.includes("146,34")')
   record('quantidade-invalida-cotacao-e-soma-volumes',qty_change)
   def pickup():
    page.evaluate('()=>{__integrallApp.getState().checkout.choice="pickup";__integrallApp.renderCart();__integrallCheckout.refreshShipping()}');page.wait_for_timeout(40)
    return checked(page,'()=>document.querySelector("#correiosOptions").hidden&&document.querySelector("#cartTotal").textContent.includes("100,00")')
   record('retirada-remove-cotacao-sem-credenciais',pickup);context.close()
   context,page,errors=prepare()
   def stale_response():
    page.evaluate('()=>{__quoteDelay=700;__integrallApp.getState().checkout.cep="07074000";__integrallCheckout.refreshShipping()}');page.wait_for_timeout(150)
    page.evaluate('()=>{__quoteDelay=0;__integrallApp.getState().checkout.cep="16503018";__integrallCheckout.refreshShipping()}');page.wait_for_selector('input[name=correiosService]');page.locator('input[value="03220"][name=correiosService]').check();page.wait_for_timeout(950)
    return checked(page,'()=>document.querySelector("input[name=correiosService]:checked").value==="03220"')
   record('resposta-antiga-CEP-nao-sobrescreve-escolha-nova',stale_response);context.close()
   context,page,errors=prepare()
   def failure_manual():
    request('/__fixture/state',{'failProvider':True});page.evaluate('()=>__integrallCheckout.refreshShipping()');page.wait_for_selector('#correiosOptions button',timeout=15000)
    checked(page,'()=>document.querySelector("#cartTotal").textContent.includes("entrega")&&!document.querySelector("#correiosOptions input[name=correiosService]")')
    page.get_by_role('button',name='Solicitar frete a confirmar',exact=True).click();page.wait_for_timeout(40)
    return checked(page,'()=>document.querySelector("#correiosOptions").textContent.includes("bloqueado")')
   record('falha-provedor-nao-vira-frete-gratis-e-permite-manual',failure_manual)
   def retry():
    request('/__fixture/state',{'failProvider':False});page.get_by_role('button',name='Calcular novamente',exact=True).click();page.wait_for_selector('input[name=correiosService]',timeout=15000);return checked(page,'()=>document.querySelector("#cartTotal").textContent.includes("73,17")')
   record('repetir-cotacao-apos-recuperacao',retry);context.close()
   context,page,errors=prepare()
   def expiration():
    request('/__fixture/state',{'expirePreview':True});page.evaluate('()=>__integrallCheckout.refreshShipping()');page.wait_for_selector('input[name=correiosService]');page.wait_for_timeout(900)
    return checked(page,'()=>document.querySelector("#correiosOptions").textContent.includes("expirou")&&!document.querySelector("input[name=correiosService]")')
   record('expiracao-visual-remove-opcao-antiga',expiration);request('/__fixture/state',{'expirePreview':False});context.close()
   context,page,errors=prepare()
   def fill_customer():
    # Campos reais de checkout; não há preenchimento de dados reais.
    for selector,value in [('#customerName','Cliente Teste'),('#customerEmail','fixture@example.test'),('#customerPhone','11999999999'),('#deliveryStreet','Rua de Teste'),('#deliveryNumber','1'),('#deliveryNeighborhood','Centro'),('#deliveryCity','Teste'),('#deliveryState','SP')]:
     field=page.locator(selector)
     if field.count():field.fill(value)
    age=page.locator('#ageConfirmCheckbox');
    if age.count() and age.is_visible():age.check()
   def changed_at_checkout():
    fill_customer();request('/__fixture/state',{'rateDelta':100});page.locator('#checkout').click();page.wait_for_timeout(450)
    return checked(page,'()=>document.querySelector("#correiosOptions").textContent.includes("mudaram")')
   record('checkout-recusa-preco-alterado-e-pede-reconfirmacao',changed_at_checkout)
   def complete():
    request('/__fixture/state',{'rateDelta':0});page.evaluate('()=>__integrallCheckout.refreshShipping()');page.wait_for_selector('input[name=correiosService]');page.locator('input[name=correiosService][value="03220"]').check();fill_customer();page.locator('#checkout').click();page.wait_for_timeout(500)
    data=request('/__fixture/stats')['data'];body=data['orders'][-1]
    assert body['shipping']['service']=='03220' and body['shipping']['quoteToken'],body
    assert 'resolved' not in body['shipping'] and 'priceCents' not in body['shipping'],body
    assert '76,46' in page.locator('#orderStatusModal').inner_text(),page.locator('#orderStatusModal').inner_text()
    assert not errors,errors
    page.screenshot(path=str(out/'pedido-SEDEX.png'));return {'service':body['shipping']['service'],'receiptIncluded':True,'total':'76,46','providerRechecked':True}
   record('checkout-SEDEX-persistencia-metadata-recibo-e-total',complete);context.close()
   browser.close()
  (out/'results.json').write_text(json.dumps({'mode':'Chromium isolado + ponte HTTP local + módulos reais + Correios simulado; NÃO Express/API externa','results':results,'failures':failures},ensure_ascii=False,indent=2))
  print(json.dumps({'passed':len(results)-len(failures),'failed':len(failures),'failures':failures}));return 1 if failures else 0
 finally:proc.terminate();proc.wait(timeout=10)
if __name__=='__main__':raise SystemExit(main())
