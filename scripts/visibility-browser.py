#!/usr/bin/env python3
"""Catalog visibility regression using actual packaged HTML, scripts and image bytes.
Isolated about:blank; no backend, production CSP, native HTTP or provider assertion.
"""
from __future__ import annotations
import argparse, base64, json, mimetypes, re
from pathlib import Path
from playwright.sync_api import sync_playwright

STYLES = ['store.css', 'checkout.css', 'premium-v104.css', 'commerce-v111.css']
SCRIPTS = ['age-gate.js', 'catalog.js', 'cart.js', 'shipping.js', 'api.js', 'checkout.js', 'app.js', 'commerce-v111.js', 'premium-v104.js']

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    root, out = args.root.resolve(), args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    cache = {}
    def asset(match):
        url = match[0]
        file = root / 'public' / url.split('?')[0].lstrip('/')
        if file.suffix in ['.mp4', '.webm']:
            return url  # reduced-motion: videos are not downloaded/played by this fixture
        if url not in cache:
            cache[url] = 'data:' + (mimetypes.guess_type(file.name)[0] or 'application/octet-stream') + ';base64,' + base64.b64encode(file.read_bytes()).decode()
        return cache[url]
    def embed(text):
        return re.sub(r'/assets/[\w./-]+(?:\?[\w.=+-]+)?', asset, text)
    html = (root / 'public/index.html').read_text()
    html = re.sub(r'<meta\b[^>]*http-equiv=["\']Content-Security-Policy["\'][^>]*>', '', html, flags=re.I)
    html = re.sub(r'<link\b[^>]*>', '', html, flags=re.I)
    html = re.sub(r'<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>', '', html, flags=re.I)
    html = embed(html)
    styles = [embed((root / 'public/css' / file).read_text()) for file in STYLES]
    scripts = [(root / 'public/js/store' / file).read_text() for file in SCRIPTS]
    results, errors = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context(viewport={'width': 1440, 'height': 960}, reduced_motion='reduce', bypass_csp=True)
        page = context.new_page()
        page.set_default_timeout(10000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content(html, wait_until='domcontentloaded')
        for css in styles: page.add_style_tag(content=css)
        for js in scripts: page.add_script_tag(content=js)
        if page.locator('#ageGateYes').count(): page.locator('#ageGateYes').click()
        page.wait_for_timeout(100)
        def check(name, condition, details=None):
            results.append({'name': name, 'status': 'APROVADO' if condition else 'REPROVADO', 'details': details})
        initial = page.evaluate("""() => {
          const app=__integrallApp; app.navigate('vitrine',{historyMode:'none'});
          const cards=[];
          for(let n=1;n<=Math.ceil(app.state.products.length/12);n++){
            app.changeCatalogPage(n,{focus:false,scroll:false,historyMode:'none'});
            cards.push(...document.querySelectorAll('#productGrid .card'));
          }
          app.changeCatalogPage(1,{focus:false,scroll:false,historyMode:'none'});
          return {products:app.getState().products.length,cards:cards.length,hidden:app.getState().products.filter(p=>p.hidden).length,
            zero:cards.filter(c=>/R\\$\\s*0,00/.test(c.textContent)).length,
            quote:cards.filter(c=>c.querySelector('.price').textContent==='Preço sob consulta').length,
            disabled:cards.filter(c=>c.querySelector('.icon-btn').disabled).length,
            lazy:cards.every(c=>c.querySelector('.card-image-main').loading==='lazy'),
            more:!!document.querySelector('#loadMoreProducts')};
        }""")
        check('227 produtos alcançáveis por páginas, sem botão Ver mais', initial['products']==227 and initial['cards']==227 and initial['hidden']==0 and not initial['more'], initial)
        check('222 itens sob consulta, sem preço zero nem botão de compra ativo', initial['quote']==222 and initial['disabled']==222 and initial['zero']==0 and initial['lazy'])
        all_products = page.evaluate("""() => {
          const app=__integrallApp; const failures=[];let variations=0,unpricedOptions=0;
          for(const product of app.getState().products){
            app.openProduct(product.id,{updateHash:false,focus:false,scroll:false});
            const options=app.productVariants(product); variations+=options.length;
            unpricedOptions+=options.filter(v=>v.price===0).length;
            if(document.querySelector('#productDetails').hidden||document.querySelector('#modalName').textContent!==product.name)failures.push(product.id+': detalhes');
            if(options.length!==document.querySelector('#modalVariant').options.length&&options.length)failures.push(product.id+': variações');
            if(product.price===0){
              if(document.querySelector('#modalPrice').textContent!=='Preço sob consulta'||!document.querySelector('#modalAdd').disabled)failures.push(product.id+': compra');
              if(options.some(v=>!document.querySelector('#modalVariant').textContent.includes(v.name)))failures.push(product.id+': opção oculta');
            }
          }
          app.closeProductDetails({returnFocus:false,updateHistory:false});
          return {failures,variations,unpricedOptions};
        }""")
        check('Detalhes dos 227 produtos e das 52 variações (48 sem preço)', not all_products['failures'] and all_products['variations']==52 and all_products['unpricedOptions']==48, all_products)
        departments = page.evaluate("""() => {
          const app=__integrallApp,counts=[];
          for(const department of ['vinhos','cafes','sucos','petit-four']){
            app.navigate(department,{historyMode:'none'});
            const expected=app.getState().products.filter(p=>p.department===department).length;let rendered=0;
            for(let n=1;n<=Math.ceil(expected/12);n++){app.changeCatalogPage(n,{focus:false,scroll:false,historyMode:'none'});rendered+=document.querySelectorAll('#productGrid .card').length;}
            counts.push({department,expected,rendered});
          }
          app.navigate('vitrine',{historyMode:'none'});return counts;
        }""")
        check('Categorias mostram todos os seus produtos', all(row['expected']==row['rendered'] for row in departments), departments)
        page.locator('#search').fill('Rosca de Coco')
        page.wait_for_timeout(80)
        search = page.evaluate("""() => ({cards:document.querySelectorAll('#productGrid .card').length, card:document.querySelector('#productGrid .card')?.textContent, suggestions:document.querySelector('#searchSuggestions').textContent})""")
        check('Busca encontra produto antes oculto e não anuncia preço zero', search['cards']>=1 and 'Rosca de Coco' in search['card'] and 'Preço sob consulta' in search['card'] and 'R$ 0,00' not in search['suggestions'], search)
        page.locator('#search').fill('')
        page.locator('#advancedFilterBox summary').click()
        page.locator('#filterMaxPrice').fill('100')
        check('Filtro de preço não classifica produtos sem preço como ofertas de R$ 0', page.locator('#productGrid .card').count()==5)
        page.locator('#filterMaxPrice').fill('')
        check('Limpar o filtro restaura a primeira página dos 227 produtos', page.locator('#productGrid .card').count()==12 and 'de 227' in page.locator('#resultCount').inner_text())
        for width in [320,768,1440]:
            page.set_viewport_size({'width':width,'height':960})
            page.evaluate("() => __integrallApp.navigate('petit-four',{historyMode:'none'})")
            page.locator('#advancedFilterBox').evaluate('(element) => element.open = false')
            page.evaluate("() => window.scrollTo(0, document.querySelector('#resultCount').getBoundingClientRect().top + scrollY - 105)")
            page.wait_for_timeout(120)
            page.screenshot(path=str(out/f'catalogo-todos-{width}.png'))
            geometry = page.evaluate("() => ({width:innerWidth,doc:document.documentElement.scrollWidth,count:document.querySelectorAll('#productGrid .card').length})")
            check(f'Catálogo sem transbordamento em {width}px', geometry['doc']<=width+1, geometry)
            page.evaluate("() => __integrallApp.openProduct('pdf-bis-972',{updateHash:false,focus:false,scroll:true})")
            page.wait_for_timeout(160)
            detail = page.evaluate("""() => {
              const gallery=document.querySelector('.product-gallery').getBoundingClientRect(), info=document.querySelector('.product-info').getBoundingClientRect();
              return {width:innerWidth,doc:document.documentElement.scrollWidth,below:info.top>=gallery.bottom-1,loaded:document.querySelector('#modalImage').naturalWidth>0,name:document.querySelector('#modalName').textContent,price:document.querySelector('#modalPrice').textContent,disabled:document.querySelector('#modalAdd').disabled};
            }""")
            page.locator('#productDetails').screenshot(path=str(out/f'produto-sob-consulta-{width}.png'))
            check(f'Produto restaurado: foto original, detalhes e compra protegida em {width}px', detail['doc']<=width+1 and detail['below'] and detail['loaded'] and detail['disabled'] and detail['price']=='Preço sob consulta', detail)
        # Bypass a disabled control in this isolated page: the click handler must still refuse.
        tamper = page.evaluate("""() => {
          const app=__integrallApp,before=app.cartDetails().length;
          const button=document.querySelector('#modalAdd');button.disabled=false;button.click();
          const after=app.cartDetails().length,error=document.querySelector('#modalError').textContent;
          return {before,after,error};
        }""")
        check('Reativar botão pelo DOM não adiciona item sem preço à sacola', tamper['before']==tamper['after'] and bool(tamper['error']), tamper)
        # A priced product still offers its real price and adds to the cart.
        priced = page.evaluate("""() => {
          const app=__integrallApp; const product=app.getState().products.find(p=>p.available&&p.price>0);
          app.openProduct(product.id,{updateHash:false,focus:false,scroll:false});
          const price=document.querySelector('#modalPrice').textContent, enabled=!document.querySelector('#modalAdd').disabled;
          document.querySelector('#modalAdd').click();
          const lines=app.cartDetails();return {price,enabled,lines:lines.length,total:app.cartSubtotal()};
        }""")
        check('Oferta já existente continua adicionando à sacola por valor positivo', priced['enabled'] and priced['lines']>0 and priced['total']>0, priced)
        check('Sem exceções JavaScript', not errors, errors)
        browser.close()
    status = 'APROVADO' if all(row['status']=='APROVADO' for row in results) else 'REPROVADO'
    report = {'status':status, 'scope':'Chromium / about:blank / HTML, CSS, JS e bytes reais de imagens; sem servidor Express ou CSP de produção', 'results':results}
    (out/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':status,'checks':len(results),'failures':[row for row in results if row['status']!='APROVADO']},ensure_ascii=False,indent=2))
    return 0 if status=='APROVADO' else 1
if __name__=='__main__': raise SystemExit(main())
