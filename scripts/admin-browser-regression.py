#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, re, sys, os

ROOT=Path(sys.argv[1]).resolve()
OUT=Path(sys.argv[2]).resolve(); OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.glob('admin-*.png'): old.unlink()
for old in OUT.glob('admin-browser-audit-results.json'): old.unlink()
WIDTHS=[280,320,360,375,390,412,430,480,600,768,820,1024,1280,1366,1440,1600,1920,2560]
WIDTHS=[int(x) for x in os.environ['INTEGRALL_BROWSER_WIDTHS'].split(',')] if os.environ.get('INTEGRALL_BROWSER_WIDTHS') else WIDTHS
SHOTS={280,320,768,1440,1920}
html=(ROOT/'public/admin.html').read_text('utf-8')
html=re.sub(r'<link rel="icon"[^>]*>','',html,flags=re.I)
css=(ROOT/'public/css/admin.css').read_text('utf-8')
html=re.sub(r'<link rel="stylesheet" href="[^"]+">',f'<style>{css}</style>',html,count=1)
html=html.replace('src="/?adminPreview=1"','src="about:blank"')
cat=json.loads((ROOT/'data/catalog.json').read_text('utf-8'))
product=cat['products'][0]
settings=cat.get('settings',{})
fixture=json.dumps({'product':product,'settings':settings,'commerce':cat.get('commerce',{})},ensure_ascii=False,separators=(',',':'))
mock=f'''<script>
(() => {{
  const fixture={fixture};
  const state={{authenticated:false,revision:1,catalog:{{products:[fixture.product],settings:fixture.settings,commerce:fixture.commerce}}}};
  const json=(status,data)=>new Response(JSON.stringify(data),{{status,headers:{{'Content-Type':'application/json'}}}});
  window.fetch=async(input,options={{}})=>{{
    const raw=typeof input==='string'?input:input.url;
    const url=new URL(raw,'https://admin-audit.invalid');
    const path=url.pathname;
    const method=String(options.method||'GET').toUpperCase();
    if(path==='/api/health')return json(200,{{ok:true,database:'memória',mercadoPago:false}});
    if(path==='/api/admin/session'&&method==='GET')return json(200,{{configured:true,authenticated:state.authenticated,user:state.authenticated?{{email:'audit@example.invalid',role:'admin'}}:null,csrfToken:state.authenticated?'csrf-audit':''}});
    if(path==='/api/admin/session/login'&&method==='POST'){{
      const body=JSON.parse(options.body||'{{}}');
      if(body.password!=='Browser-Test-Admin!')return json(401,{{code:'ADMIN_LOGIN_INVALID',error:'Credenciais inválidas.'}});
      state.authenticated=true;return json(200,{{configured:true,authenticated:true,user:{{email:'audit@example.invalid',role:'admin'}},csrfToken:'csrf-audit'}});
    }}
    if(path==='/api/admin/session/logout'&&method==='POST'){{state.authenticated=false;return json(200,{{ok:true}})}}
    if(!state.authenticated && path.startsWith('/api/admin/'))return json(401,{{error:'Faça login para continuar.'}});
    if(path==='/api/admin/catalog'){{
      if(method==='PUT'){{const body=JSON.parse(options.body);window.__businessPayload=body;if(body.revision!==String(state.revision))return json(409,{{error:'Conflito'}});state.catalog.commerce=body.commerce;state.revision++;}}
      return json(200,{{catalog:state.catalog,revision:String(state.revision),products:1}});
    }}
    if(path==='/api/admin/orders')return json(200,{{orders:[]}});
    if(path==='/api/admin/customers')return json(200,{{customers:[]}});
    if(path==='/api/catalog')return json(200,{{products:[fixture.product],settings:fixture.settings,commerce:{{}},promotions:[]}});
    if(path==='/api/admin/coupons')return json(200,{{coupons:[]}});
    if(path==='/api/admin/products')return json(200,{{products:[fixture.product]}});
    if(path.startsWith('/api/admin/products/')&&method==='PATCH'){{const body=JSON.parse(options.body);window.__shippingProductPayload=body;fixture.product={{...fixture.product,...body}};state.catalog.products=[fixture.product];return json(200,{{product:fixture.product}});}}
    if(path==='/api/admin/settings')return json(200,{{settings:fixture.settings}});
    if(path==='/api/admin/promotions')return json(200,{{promotions:[]}});
    if(path==='/api/admin/inventory/alerts')return json(200,{{alerts:[],subscriptions:[]}});
    if(path==='/api/admin/reviews')return json(200,{{reviews:[]}});
    return json(200,{{}});
  }};
}})();
</script>'''
html=html.replace('</head>',mock+'</head>')
js=(ROOT/'public/js/admin.js').read_text('utf-8').replace('</script>','<\\/script>')
html=re.sub(r'<script src="[^"]+" defer></script>',lambda _m:f'<script defer>{js}</script>',html,count=1)

results=[]
with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for width in WIDTHS:
    context=browser.new_context(viewport={'width':width,'height':900},reduced_motion='reduce')
    page=context.new_page(); messages=[]
    page.on('console',lambda msg,b=messages:b.append({'type':msg.type,'text':msg.text}) if msg.type in ('warning','error') else None)
    page.set_content(html,wait_until='load',timeout=30000)
    page.wait_for_selector('#loginView:not([hidden])')
    def layout():
      return page.evaluate("""() => ({scrollWidth:Math.max(document.body.scrollWidth,document.documentElement.scrollWidth),clientWidth:document.documentElement.clientWidth,overflow:Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)-document.documentElement.clientWidth})""")
    before=layout(); assert before['overflow']==0,(width,'login',before)
    if width in SHOTS: page.screenshot(path=str(OUT/f'admin-login-{width}px.png'),full_page=True)
    page.fill('#loginPassword','Wrong-Test-Admin!'); page.click('#loginButton')
    page.wait_for_function("document.querySelector('#loginFeedback').textContent.includes('Credenciais inválidas')")
    assert page.locator('#loginView:not([hidden])').count()==1
    page.fill('#loginPassword','Browser-Test-Admin!'); page.click('#loginButton')
    page.wait_for_selector('#dashboard:not([hidden])',timeout=30000)
    page.wait_for_timeout(100)
    after=layout()
    if after['overflow']>0:
      debug=page.evaluate("""() => [...document.querySelectorAll('body *')].map(el => { const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); return {tag:el.tagName,id:el.id,cls:el.className,left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),display:cs.display,position:cs.position,overflowX:cs.overflowX}; }).filter(x => x.right > document.documentElement.clientWidth + 1 || x.left < -1).sort((a,b)=>b.right-a.right).slice(0,30)""")
      near=page.evaluate("""() => [...document.querySelectorAll('body *')].map(el => { const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); return {tag:el.tagName,id:el.id,cls:String(el.className||''),left:+r.left.toFixed(1),right:+r.right.toFixed(1),width:+r.width.toFixed(1),clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,display:cs.display,overflowX:cs.overflowX,minWidth:cs.minWidth,maxWidth:cs.maxWidth,paddingLeft:cs.paddingLeft,paddingRight:cs.paddingRight}; }).filter(x => (x.right > document.documentElement.clientWidth + 1 && x.right < document.documentElement.clientWidth + 150) || x.left < -1).sort((a,b)=>b.right-a.right).slice(0,100)""")
      tops=page.evaluate("""() => [...document.body.children].map(el=>{const r=el.getBoundingClientRect();const cs=getComputedStyle(el);return {tag:el.tagName,id:el.id,cls:String(el.className||''),left:r.left,right:r.right,width:r.width,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,overflowX:cs.overflowX,display:cs.display}})""")
      page.screenshot(path=str(OUT/f'admin-overflow-{width}px.png'),full_page=True)
      print('OVERFLOW DEBUG',width,after,'NEAR=',json.dumps(near,ensure_ascii=False,indent=2),'TOPS=',json.dumps(tops,ensure_ascii=False,indent=2))
    assert after['overflow']==0,(width,'dashboard',after)
    assert page.locator('#productDialog').evaluate("el=>el.tagName==='SECTION' && !el.matches('[role=dialog]')")
    scroll_styles=page.evaluate("() => ({inspector:getComputedStyle(document.querySelector('.visual-inspector-scroll')).overflowY,preview:getComputedStyle(document.querySelector('.visual-preview-column')).overflowY,workspaceHeight:getComputedStyle(document.querySelector('.visual-editor-workspace')).height})")
    assert scroll_styles['inspector']=='visible',(width,'inspector-scroll',scroll_styles)
    assert scroll_styles['preview']=='visible',(width,'preview-scroll',scroll_styles)
    admin_scroll_handoff=True
    if width>=1024:
      page.locator('#visualEditorPanel').scroll_into_view_if_needed(); page.wait_for_timeout(30)
      page.evaluate("window.scrollTo(0, Math.max(0, document.querySelector('#visualEditorPanel').offsetTop - 10))")
      before_wheel=page.evaluate('window.scrollY')
      page.locator('#sitePreview').hover(position={'x':20,'y':20}); page.mouse.wheel(0,420); page.wait_for_timeout(40)
      after_wheel=page.evaluate('window.scrollY')
      admin_scroll_handoff=after_wheel>before_wheel
      assert admin_scroll_handoff,(width,'preview-wheel-handoff',before_wheel,after_wheel)
    business_save=False
    if width in [390,1440]:
      page.fill('#businessName','Fornecedor de teste');page.fill('#businessTaxId','00000000000');page.fill('#businessAddress','Endereço fictício para o teste');page.fill('#businessEmail','teste@example.invalid')
      page.click('#businessSave');page.wait_for_function("document.querySelector('#businessFeedback').textContent.includes('Dados públicos e políticas salvos')")
      payload=page.evaluate('window.__businessPayload');assert set(payload)=={'revision','commerce'};assert payload['commerce']['supportEmail']=='teste@example.invalid';business_save=True
    shipping_saved=False
    if os.environ.get('INTEGRALL_TEST_SHIPPING_EDITOR')=='1':
      page.locator('#productsBody [data-product-id]').first.click()
      page.wait_for_selector('#productDialog:not([hidden])')
      page.locator('#shippingBoxesSection summary').click()
      previous=page.locator('#pfShippingBoxes .shipping-box-editor').count()
      page.locator('#addShippingBoxButton').click()
      row=page.locator('#pfShippingBoxes .shipping-box-editor').last
      for key,value in {'units':'1','weightGrams':'3000','lengthCm':'16','widthCm':'26','heightCm':'29'}.items():row.locator(f'[data-box-field="{key}"]').fill(value)
      rect=row.bounding_box();assert rect and rect['x']>=-1 and rect['x']+rect['width']<=width+1,(width,rect)
      page.locator('#productForm button[type=submit]').click()
      page.wait_for_function("document.querySelector('#productDialogFeedback').textContent.includes('Produto salvo')")
      saved=page.evaluate('window.__shippingProductPayload.boxes');assert len(saved)==previous+1
      assert saved[-1]=={'variantId':'','units':1,'weightGrams':3000,'lengthCm':16,'widthCm':26,'heightCm':29},saved
      assert page.locator('#pfShippingBoxes .shipping-box-editor').count()==previous+1
      if width in [320,1440]:
        page.locator('#shippingBoxesSection').scroll_into_view_if_needed();page.screenshot(path=str(OUT/f'admin-embalagens-{width}px.png'))
      shipping_saved=True
    assert page.locator('#logoutButton:not([hidden])').count()==1
    if width in SHOTS: page.screenshot(path=str(OUT/f'admin-dashboard-{width}px.png'),full_page=True)
    page.click('#logoutButton'); page.wait_for_selector('#loginView:not([hidden])')
    assert page.locator('#dashboard[hidden]').count()==1
    errors=[m for m in messages if m['type']=='error']; assert not errors,(width,errors)
    results.append({'width':width,'status':'APROVADO','loginLayout':before,'dashboardLayout':after,'scrollStyles':scroll_styles,'adminScrollHandoff':admin_scroll_handoff,'businessFormSavedInMock':business_save,'shippingBoxesSavedAndReloadedInMock':shipping_saved,'console':messages})
    context.close()
  browser.close()
(OUT/'admin-browser-audit-results.json').write_text(json.dumps({'engine':'Chromium','mode':'about:blank com HTML/CSS/JS reais e API simulada','results':results},ensure_ascii=False,indent=2),'utf-8')
print(f'ADMIN BROWSER AUDIT OK: {len(results)}/{len(WIDTHS)} larguras; login incorreto/correto/logout; rolagem natural/iframe handoff; overflow global=0; console errors=0')
