#!/usr/bin/env python3
"""Actual shipped HTML/styles/scripts/media rendered in an isolated about:blank.
No HTTP, native browser zoom, network performance, or production CSP claim.
Assets are embedded from their unchanged bytes. Mutations below affect only memory.
"""
import argparse,base64,json,mimetypes,re
from pathlib import Path
from playwright.sync_api import sync_playwright
WIDTHS=[280,320,360,375,390,412,430,480,600,768,820,1024,1280,1366,1440,1600,1920,2560]
STYLES=['store.css','checkout.css','premium-v104.css','commerce-v111.css']
SCRIPTS=['age-gate.js','catalog.js','cart.js','shipping.js','api.js','checkout.js','app.js','commerce-v111.js','premium-v104.js']
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,default=Path.cwd());ap.add_argument('--out',type=Path,required=True);ap.add_argument('--widths',default='');args=ap.parse_args()
 root=args.root.resolve();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True);cache={}
 def asset(url):
  if url not in cache:
   file=root/'public'/url.split('?')[0].lstrip('/');mime=mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
   cache[url]='data:'+mime+';base64,'+base64.b64encode(file.read_bytes()).decode()
  return cache[url]
 def embed(s):return re.sub(r'/assets/[\w./-]+(?:\?[\w.=+-]+)?',lambda m:asset(m.group()),s)
 html=(root/'public/index.html').read_text()
 html=re.sub(r'<meta\b[^>]*http-equiv=["\']Content-Security-Policy["\'][^>]*>','',html,flags=re.I)
 html=re.sub(r'<link\b[^>]*>','',html,flags=re.I)
 html=re.sub(r'<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>','',html,flags=re.I)
 html=embed(html);styles=[embed((root/'public/css'/x).read_text()) for x in STYLES];scripts=[(root/'public/js/store'/x).read_text() for x in SCRIPTS]
 widths=[int(w) for w in args.widths.split(',')] if args.widths else WIDTHS
 results=[];failures=[]
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for width in widths:
   print('actual-media',width,flush=True)
   context=browser.new_context(viewport={'width':width,'height':900},reduced_motion='reduce',bypass_csp=True)
   page=context.new_page();page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda e,b=errors:b.append(str(e)))
   page.set_content(html,wait_until='domcontentloaded')
   for css in styles:page.add_style_tag(content=css)
   for js in scripts:page.add_script_tag(content=js)
   if page.locator('#ageGateYes').count():page.locator('#ageGateYes').click()
   page.wait_for_timeout(200)
   header=page.evaluate("""() => ['.premium-wordmark','#menuBtn','#openAccount','#openCart'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),c=getComputedStyle(e);return {selector:s,x:r.x,y:r.y,w:r.width,h:r.height,visible:r.width>0&&c.display!=='none'&&c.visibility!=='hidden'};})""")
   overlaps=[]
   for i,a in enumerate(header):
    for b in header[i+1:]:
     if a['visible'] and b['visible'] and min(a['x']+a['w'],b['x']+b['w'])>max(a['x'],b['x'])+.5 and min(a['y']+a['h'],b['y']+b['h'])>max(a['y'],b['y'])+.5:overlaps.append([a['selector'],b['selector']])
   page.evaluate("() => {const app=__integrallApp;app.openProduct(app.getState().products[0].id,{updateHash:false,focus:true});}")
   page.wait_for_timeout(200)
   metrics=page.evaluate("""() => {
    const region=document.querySelector('#productDetails'),gal=document.querySelector('.product-gallery'),info=document.querySelector('.product-info');
    const rr=region.getBoundingClientRect(),gr=gal.getBoundingClientRect(),ir=info.getBoundingClientRect(),s=getComputedStyle(region);
    const bad=[...region.querySelectorAll('input,textarea,select,button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(r.left<-.5||r.right>innerWidth+.5);}).map(e=>e.id||e.className);
    return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,position:s.position,overflowY:s.overflowY,columns:getComputedStyle(document.querySelector('.product-details-grid')).gridTemplateColumns.split(' ').length,regionCount:document.querySelectorAll('#productDetails').length,below:ir.top>=gr.bottom-1,mainContains:document.querySelector('main').contains(region),footerBelow:document.querySelector('#footer').getBoundingClientRect().top>=rr.bottom-1,bodyLocked:document.body.classList.contains('lock'),overlay:document.querySelector('#overlay').classList.contains('open'),outsideControls:bad,imageLoaded:document.querySelector('#modalImage').naturalWidth>0,imageFit:getComputedStyle(document.querySelector('#modalImage')).objectFit,name:document.querySelector('#modalName').textContent,price:document.querySelector('#modalPrice').textContent};
   }""")
   if width in {280,320,375,430,768,1024,1280,1440,1920,2560}:
    page.locator('#productDetails').screenshot(path=str(out/f'detalhes-reais-{width}.png'))
    if width in {320,1440}:page.screenshot(path=str(out/f'viewport-produto-{width}.png'))
   # Edge states are isolated in memory; no production catalog files are changed.
   edge=page.evaluate("""() => {
    const app=__integrallApp,original=structuredClone(app.getState().products),first=original[0];
    document.querySelector('#modalGift').checked=true;document.querySelector('#modalGiftMessage').value='draft';document.querySelector('#modalQty').value='9';
    app.openProduct(original[1].id,{updateHash:false,focus:false});
    const clean=document.querySelector('#modalGiftMessage').value===''&&!document.querySelector('#modalGift').checked&&document.querySelector('#modalQty').value==='1';
    const changed=structuredClone(original);changed[0].name='Nome-muito-longo'.repeat(25);changed[0].description='Descrição extensa com acentos e informação. '.repeat(100);changed[0].images=[];changed[0].image='';changed[0].variants=[];
    app.setProducts(changed);app.openProduct(first.id,{updateHash:false,focus:false});
    return {clean,missingImage:document.querySelector('#modalImage').src.startsWith('data:image/svg+xml'),changedName:document.querySelector('#modalName').textContent===changed[0].name,original};
   }""")
   page.wait_for_timeout(100)
   edge_overflow=page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
   page.evaluate("products=>{__integrallApp.closeProductDetails({updateHistory:false,returnFocus:false});__integrallApp.setProducts(products);}",edge.pop('original'))
   checks={'singleNormalFlow':metrics['regionCount']==1 and metrics['position'] in ['static','relative'],'galleryAboveDetails':metrics['below'] and metrics['columns']==1,'semanticMain':metrics['mainContains'] and metrics['footerBelow'],'noGlobalOverflow':metrics['documentWidth']<=width+1,'unlockedPage':not metrics['bodyLocked'] and not metrics['overlay'],'controlsWithinWidth':not metrics['outsideControls'],'originalImageLoaded':metrics['imageLoaded'] and metrics['imageFit']=='contain','headerNoOverlaps':not overlaps,'productSwitchClean':edge['clean'],'longTextReflow':not edge_overflow and edge['changedName'],'missingImageFallback':edge['missingImage'],'noPageExceptions':not errors}
   failed=[k for k,v in checks.items() if not v]
   if failed:failures.append({'width':width,'failed':failed,'overlaps':overlaps})
   results.append({'width':width,'status':'APROVADO' if not failed else 'REPROVADO','checks':checks,'metrics':metrics,'pageErrors':errors})
   context.close()
  browser.close()
 report={'status':'APROVADO' if not failures else 'REPROVADO','scope':'about:blank, actual media bytes and application assets, reduced motion, production CSP excluded, no HTTP network','results':results,'failures':failures}
 (out/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':report['status'],'cases':len(results),'failures':failures},ensure_ascii=False))
 return bool(failures)
if __name__=='__main__':raise SystemExit(main())
