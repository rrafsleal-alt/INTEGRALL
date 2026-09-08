#!/usr/bin/env python3
"""Controlled browser regression with the shipped catalog and actual media bytes.
No backend, network performance or production CSP validation is claimed. The fixture
uses about:blank, embeds local assets and removes CSP only from the test document.
Product history is disabled only in calls explicitly made by this fixture.
"""
from __future__ import annotations
import argparse, base64, json, mimetypes, re
from pathlib import Path
from playwright.sync_api import sync_playwright

STYLE_FILES=['css/store.css','css/checkout.css','css/premium-v104.css','css/commerce-v111.css']
SCRIPTS=['age-gate.js','catalog.js','cart.js','shipping.js','api.js','checkout.js','app.js','commerce-v111.js','premium-v104.js']
WINE='product-1786125523055-ivln6v'
VARIANT='variant-1786125472992-y1279u'

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,default=Path.cwd());ap.add_argument('--out',type=Path,required=True);ap.add_argument('--case',default='')
    args=ap.parse_args();root=args.root.resolve();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    cache={}
    def data_url(url):
        if url not in cache:
            file=root/'public'/url.split('?')[0].lstrip('/')
            if not file.is_file(): raise FileNotFoundError(url)
            mime=mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
            cache[url]='data:'+mime+';base64,'+base64.b64encode(file.read_bytes()).decode()
        return cache[url]
    def embed(text):
        return re.sub(r'/assets/[\w./-]+(?:\?[\w.=+-]+)?',lambda m:data_url(m.group()),text)
    html=(root/'public/index.html').read_text()
    html=re.sub(r'<meta\b[^>]*http-equiv=["\']Content-Security-Policy["\'][^>]*>','',html,flags=re.I)
    html=re.sub(r'<link\b[^>]*>','',html,flags=re.I)
    html=re.sub(r'<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>','',html,flags=re.I)
    html=embed(html)
    styles=[embed((root/'public'/f).read_text()) for f in STYLE_FILES]
    scripts=[(root/'public/js/store'/f).read_text() for f in SCRIPTS if (root/'public/js/store'/f).exists()]
    rows=[];failures=[]
    with sync_playwright() as p:
        for width,motion in [(320,'no-preference'),(360,'no-preference'),(390,'no-preference'),(430,'no-preference'),(768,'no-preference'),(790,'no-preference'),(820,'no-preference'),(1024,'no-preference'),(1440,'no-preference'),(390,'reduce')]:
            if args.case and args.case != f'{width}:{motion}':continue
            print(f'[actual-media fixture] {width}px {motion}',flush=True)
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
            context=browser.new_context(viewport={'width':width,'height':900},reduced_motion=motion,bypass_csp=True)
            page=context.new_page();page.set_default_timeout(5000);errors=[];page.on('pageerror',lambda e,bucket=errors:bucket.append(str(e)))
            page.set_content(html,wait_until='domcontentloaded',timeout=30000)
            for css in styles:page.add_style_tag(content=css)
            for script in scripts:page.add_script_tag(content=script)
            if page.locator('#ageGateYes').count():page.locator('#ageGateYes').click()
            page.wait_for_timeout(600)
            row=page.evaluate('''() => {
                const rect=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),c=getComputedStyle(e);return {x:r.x,y:r.y,w:r.width,h:r.height,visible:c.display!=='none'&&c.visibility!=='hidden'&&r.width>0}};
                const video=document.querySelector('#heroVideo');
                return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,brand:rect('.premium-wordmark'),menu:rect('#menuBtn'),account:rect('#openAccount'),cart:rect('#openCart'),video:{paused:video.paused,speed:video.playbackRate,width:video.videoWidth,height:video.videoHeight,loaded:video.readyState},featurePrice:document.querySelector('[data-feature-price]').textContent,navVisibility:getComputedStyle(document.querySelector('#nav')).visibility,publicProducts:__integrallApp.getState().products.length};
            }''')
            row['motion']=motion
            (out/f'probe-{width}-{motion}.json').write_text(json.dumps(row,ensure_ascii=False,indent=2))
            print('  geometry/media ready',flush=True)
            def check(ok,message):
                if not ok:failures.append(f'{width}/{motion}: {message}')
            check(row['scrollWidth']<=width+1,'horizontal overflow')
            def overlaps(a,b):return a['visible'] and b['visible'] and min(a['x']+a['w'],b['x']+b['w'])>max(a['x'],b['x'])+.1 and min(a['y']+a['h'],b['y']+b['h'])>max(a['y'],b['y'])+.1
            for a,b in [('brand','menu'),('brand','account'),('brand','cart'),('menu','account'),('menu','cart'),('account','cart')]:check(not overlaps(row[a],row[b]),f'header overlap {a}/{b}')
            check(row['account']['visible'],'account control hidden')
            check(row['publicProducts']==227,'catalog products missing')
            check(abs(row['video']['speed']-1.35)<.001,'playback speed')
            if motion=='reduce':check(row['video']['paused'] and row['video']['loaded']==0,'reduced-motion downloaded/played video automatically')
            else:
                try:page.wait_for_function('!document.querySelector("#heroVideo").paused && document.querySelector("#heroVideo").readyState >= 2',timeout=8000)
                except Exception:check(False,'video did not play')
                page.locator('#heroVideoToggle').click();page.wait_for_timeout(100)
                check(page.locator('#heroVideo').evaluate('v=>v.paused'),'pause control')
            if width in [320,390,790,1440]:page.screenshot(path=str(out/f'hero-{width}-{motion}.png'))
            if width<=790:
                print('  mobile menu',flush=True)
                check(row['navVisibility']=='hidden','closed mobile nav focus visibility')
                page.locator('#menuBtn').click();print('    menu clicked',flush=True);page.wait_for_timeout(300)
                check(page.locator('#nav').evaluate('n=>getComputedStyle(n).visibility')=='visible','mobile menu not opening')
                page.locator('#menuBtn').click();print('    menu clicked',flush=True);page.wait_for_timeout(300)
            print('  account',flush=True)
            page.locator('#openAccount').click();page.wait_for_timeout(100)
            check(page.locator('#accountModal').get_attribute('aria-hidden')=='false','account modal did not open')
            check(page.locator('#accountLoginEmail').is_visible(),'account login missing')
            page.locator('#closeAccount').click();page.wait_for_timeout(100)
            check(page.evaluate('document.activeElement.id')=='openAccount','account focus not restored')
            # Changes are confined to the frontend's in-memory catalog, never disk.
            print('  catalog synchronization',flush=True)
            update=page.evaluate('''({wine,variant})=>{
                const app=__integrallApp,original=structuredClone(app.getState().products);
                const changed=structuredClone(original),product=changed.find(p=>p.id===wine);
                product.name='Vinho — atualização de teste';product.price=4990;
                product.variants.forEach(v=>v.price=4990);app.setProducts(changed);
                const price=document.querySelector('[data-feature-price]').textContent;
                const name=document.querySelector('[data-feature-name]').textContent;
                app.openProduct(wine,{updateHash:false,variantId:variant});
                const selected=document.querySelector('#modalVariant').value;
                app.closeProductDetails({updateHistory:false,returnFocus:false});
                product.available=false;app.setProducts(changed);
                const unavailableHidden=document.querySelector('[data-featured-product]').hidden;
                app.setProducts(changed.filter(p=>p.id!==wine));
                const deletedHidden=document.querySelector('[data-featured-product]').hidden;
                app.setProducts(original);
                return {price,name,selected,unavailableHidden,deletedHidden};
            }''',{'wine':WINE,'variant':VARIANT})
            row['catalogSync']=update
            check('49,90' in update['price'] and update['name']=='Vinho — atualização de teste','home not synchronized')
            check(update['selected']==VARIANT,'featured variation mismatch')
            check(update['unavailableHidden'] and update['deletedHidden'],'invalid offer remained visible')
            if width in [390,1440] and motion=='reduce':
                page.locator('.premium-collections').scroll_into_view_if_needed();page.wait_for_timeout(350);page.screenshot(path=str(out/f'categories-{width}.png'))
                page.locator('[data-featured-product]').scroll_into_view_if_needed();page.wait_for_timeout(350);page.screenshot(path=str(out/f'feature-{width}.png'))
            if motion=='no-preference' and width==390:
                page.evaluate('scrollTo(0,0)');page.wait_for_timeout(200)
                page.locator('#heroVideoToggle').click();page.wait_for_timeout(200)
                page.emulate_media(reduced_motion='reduce');page.wait_for_timeout(200)
                check(page.locator('#heroVideo').evaluate('v=>v.paused'),'dynamic reduced-motion ignored')
            identity=page.evaluate("""() => {
              const before=globalThis.__integrallPublicConfig;
              globalThis.__integrallPublicConfig={businessName:'Fornecedor de teste',taxId:'00000000000',businessAddress:'Endereço fictício',supportEmail:'teste@example.invalid'};
              __integrallCheckout.refreshConfig();
              const result={text:document.querySelector('#footerBusinessIdentity').textContent,email:document.querySelector('#emailText').textContent};
              globalThis.__integrallPublicConfig=before;__integrallCheckout.refreshConfig();return result;
            }""")
            row['businessIdentitySync']=identity
            check('CPF/CNPJ: 00000000000' in identity['text'] and identity['email']=='teste@example.invalid','public business identification not synchronized')
            row['errors']=errors;check(not errors,'page errors: '+str(errors));rows.append(row);(out/'partial.json').write_text(json.dumps({'results':rows,'failures':failures},ensure_ascii=False,indent=2));context.close();browser.close()
    report={'status':'passed' if not failures else 'failed','scope':'Controlled about:blank fixture; actual shipped media/catalog, CSP removed only in fixture; no network/backend validation','cases':len(rows),'results':rows,'failures':failures}
    (out/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'cases':len(rows),'failures':failures},ensure_ascii=False,indent=2))
    return bool(failures)
if __name__=='__main__':raise SystemExit(main())
