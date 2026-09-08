#!/usr/bin/env python3
"""Valida em Chromium a seleção múltipla da galeria no Admin e persistência no payload."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, re, sys, base64

ROOT=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
OUT=Path(sys.argv[2] if len(sys.argv)>2 else 'docs/evidencias-v11.1.6/galeria').resolve(); OUT.mkdir(parents=True,exist_ok=True)
html=(ROOT/'public/admin.html').read_text('utf-8')
css=(ROOT/'public/css/admin.css').read_text('utf-8')
html=re.sub(r'<link rel="stylesheet" href="[^"]+">',f'<style>{css}</style>',html,count=1)
html=html.replace('src="/?adminPreview=1"','src="about:blank"')
cat=json.loads((ROOT/'data/catalog.json').read_text('utf-8'))
product=cat['products'][0]; settings=cat.get('settings',{})
fixture=json.dumps({'product':product,'settings':settings},ensure_ascii=False,separators=(',',':'))
mock=f'''<script>
(() => {{
  const fixture={fixture};
  const state={{authenticated:false,product:structuredClone(fixture.product)}};
  window.__uploadCount=0; window.__savedProductPayload=null;
  const jsonResponse=(status,data)=>new Response(JSON.stringify(data),{{status,headers:{{'Content-Type':'application/json'}}}});
  window.fetch=async(input,options={{}})=>{{
    const raw=typeof input==='string'?input:input.url; const url=new URL(raw,'https://admin-audit.invalid'); const path=url.pathname; const method=String(options.method||'GET').toUpperCase();
    if(path==='/api/health')return jsonResponse(200,{{ok:true,database:'memória',mercadoPago:false}});
    if(path==='/api/admin/session'&&method==='GET')return jsonResponse(200,{{configured:true,authenticated:state.authenticated,user:state.authenticated?{{email:'audit@example.invalid',role:'admin'}}:null,csrfToken:state.authenticated?'csrf-audit':''}});
    if(path==='/api/admin/session/login'&&method==='POST'){{state.authenticated=true;return jsonResponse(200,{{configured:true,authenticated:true,user:{{email:'audit@example.invalid',role:'admin'}},csrfToken:'csrf-audit'}})}}
    if(path==='/api/admin/session/logout'&&method==='POST'){{state.authenticated=false;return jsonResponse(200,{{ok:true}})}}
    if(!state.authenticated&&path.startsWith('/api/admin/'))return jsonResponse(401,{{error:'Faça login para continuar.'}});
    if(path==='/api/admin/products'&&method==='GET')return jsonResponse(200,{{products:[state.product]}});
    if(path==='/api/catalog')return jsonResponse(200,{{products:[state.product],settings:fixture.settings,commerce:{{}},promotions:[]}});
    if(path.startsWith('/api/admin/products/')&&method==='PATCH'){{const body=JSON.parse(options.body||'{{}}');window.__savedProductPayload=body;state.product={{...state.product,...body}};return jsonResponse(200,{{ok:true,product:state.product}})}}
    if(path.startsWith('/api/admin/media/')&&method==='DELETE')return jsonResponse(200,{{ok:true}});
    if(path==='/api/admin/orders')return jsonResponse(200,{{orders:[]}}); if(path==='/api/admin/customers')return jsonResponse(200,{{customers:[]}}); if(path==='/api/admin/coupons')return jsonResponse(200,{{coupons:[]}}); if(path==='/api/admin/settings')return jsonResponse(200,{{settings:fixture.settings}}); if(path==='/api/admin/promotions')return jsonResponse(200,{{promotions:[]}}); if(path==='/api/admin/inventory/alerts')return jsonResponse(200,{{alerts:[],subscriptions:[]}}); if(path==='/api/admin/reviews')return jsonResponse(200,{{reviews:[]}});
    return jsonResponse(200,{{}});
  }};
  class FakeXHR {{
    constructor(){{this.upload={{}};this.status=0;this.response=null;this.headers={{}};}}
    open(method,url){{this.method=method;this.url=url;}}
    setRequestHeader(k,v){{this.headers[k]=v;}}
    abort(){{this.onabort?.();this.onloadend?.();}}
    send(form){{
      const id='media-browser-'+(++window.__uploadCount); const file=form.get('file');
      setTimeout(()=>{{
        this.upload.onprogress?.({{lengthComputable:true,loaded:file?.size||1,total:file?.size||1}});
        this.status=201;this.response={{ok:true,url:'/media/products/'+id,media:{{id}}}};this.onload?.();this.onloadend?.();
      }},10);
    }}
  }}
  window.XMLHttpRequest=FakeXHR;
}})();
</script>'''
html=html.replace('</head>',mock+'</head>')
js=(ROOT/'public/js/admin.js').read_text('utf-8').replace('</script>','<\\/script>')
html=re.sub(r'<script src="[^"]+" defer></script>',lambda _m:f'<script defer>{js}</script>',html,count=1)
# valid 1x1 PNG
png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5l8AAAAASUVORK5CYII=')

with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':1280,'height':900}); errors=[]
  page.on('console',lambda msg: errors.append(msg.text) if msg.type=='error' else None)
  page.set_content(html,wait_until='load',timeout=30000)
  page.fill('#loginPassword','Browser-Test-Admin!'); page.click('#loginButton'); page.wait_for_selector('#dashboard:not([hidden])')
  page.locator('[data-product-id]').first.click(); page.wait_for_selector('#productDialog:not([hidden])')
  initial=page.locator('#pfGalleryList .gallery-admin-item').count()
  assert initial==len(product.get('images') or []),(initial,product.get('images'))
  page.locator('#pfGalleryFiles').set_input_files([
    {'name':'segunda-foto.png','mimeType':'image/png','buffer':png},
    {'name':'terceira-foto.png','mimeType':'image/png','buffer':png},
  ])
  page.wait_for_function("document.querySelectorAll('#pfGalleryList .gallery-admin-item').length === 3",timeout=10000)
  assert page.evaluate('window.__uploadCount')==2
  status=page.locator('#pfImageStatus').text_content() or ''
  assert '2 foto(s) adicionada(s)' in status,status
  selectors=page.locator('#pfVariants [data-variant-field="image"]')
  if selectors.count():
    opts=selectors.first.locator('option').count(); assert opts>=4,opts
    selectors.first.evaluate("el=>{el.value='/media/products/media-browser-2';el.dispatchEvent(new Event('change',{bubbles:true}))}")
  page.screenshot(path=str(OUT/'admin-galeria-3-fotos.png'),full_page=True)
  page.locator('#productForm button[type="submit"]').click(); page.wait_for_function('window.__savedProductPayload !== null',timeout=10000)
  payload=page.evaluate('window.__savedProductPayload')
  assert len(payload['images'])==3,payload['images']
  assert payload['images'][-2:]==['/media/products/media-browser-1','/media/products/media-browser-2'],payload['images']
  if payload.get('variants'):
    assert payload['variants'][0].get('image')=='/media/products/media-browser-2',payload['variants'][0]
  assert not errors,errors
  (OUT/'gallery-browser-regression.json').write_text(json.dumps({'status':'APROVADO','initialImages':initial,'finalImages':payload['images'],'uploads':2,'variantImage':payload.get('variants',[{}])[0].get('image','') if payload.get('variants') else '','consoleErrors':errors},ensure_ascii=False,indent=2),'utf-8')
  browser.close()
print('GALLERY BROWSER AUDIT OK: 2 arquivos selecionados juntos, 2 uploads, 3 fotos persistidas no payload e foto de variação vinculada.')
