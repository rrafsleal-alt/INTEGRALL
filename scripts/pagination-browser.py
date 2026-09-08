#!/usr/bin/env python3
"""PAGINACAO-R1: actual catalog, HTML/CSS/JS and image bytes in isolated Chromium.
No Express, production cookies/CSP or external services are asserted by this test.
"""
from __future__ import annotations
import argparse,base64,json,mimetypes,re
from pathlib import Path
from playwright.sync_api import sync_playwright
STYLES=['store.css','checkout.css','premium-v104.css','commerce-v111.css']
SCRIPTS=['age-gate.js','catalog.js','cart.js','shipping.js','api.js','checkout.js','app.js','commerce-v111.js','premium-v104.js']
WIDTHS=[280,320,360,375,390,412,430,480,600,768,820,1024,1280,1366,1440,1600,1920,2560]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path.cwd());parser.add_argument('--out',type=Path,required=True);parser.add_argument('--baseline',action='store_true');parser.add_argument('--widths',default='');args=parser.parse_args()
    root,out=args.root.resolve(),args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    cache={}
    def asset(m):
        url=m[0];file=root/'public'/url.split('?')[0].lstrip('/')
        if file.suffix in ['.mp4','.webm']: return url
        if url not in cache:cache[url]='data:'+(mimetypes.guess_type(file.name)[0] or 'application/octet-stream')+';base64,'+base64.b64encode(file.read_bytes()).decode()
        return cache[url]
    def embed(s):return re.sub(r'/assets/[\w./-]+(?:\?[\w.=+-]+)?',asset,s)
    html=(root/'public/index.html').read_text();html=re.sub(r'<meta\b[^>]*http-equiv=["\']Content-Security-Policy["\'][^>]*>','',html,flags=re.I)
    html=re.sub(r'<link\b[^>]*>','',html,flags=re.I);html=re.sub(r'<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>','',html,flags=re.I);html=embed(html)
    styles=[embed((root/'public/css'/file).read_text()) for file in STYLES];scripts=[(root/'public/js/store'/file).read_text() for file in SCRIPTS]
    results=[];errors=[]
    def check(name,ok,details=None):
        row={'name':name,'status':'APROVADO' if ok else 'REPROVADO','details':details};results.append(row);print(row['status'],name,flush=True)
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        ctx=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce',bypass_csp=True)
        page=ctx.new_page();page.set_default_timeout(10000);page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html,wait_until='domcontentloaded')
        for css in styles:page.add_style_tag(content=css)
        for js in scripts:page.add_script_tag(content=js)
        page.locator('#ageGateYes').click();page.evaluate("__integrallApp.navigate('petit-four',{historyMode:'none'})")
        def metrics():
            return page.evaluate("""() => {
              const list=[...document.querySelectorAll('#productGrid .card')];
              return {cards:list.length,current:__integrallApp.state.catalogPage,count:document.querySelector('#resultCount').textContent,
                horizontal:document.documentElement.scrollWidth>innerWidth+1,
                frames:list.map(c=>{const f=c.querySelector('.card-image'),i=c.querySelector('.card-image-main'),b=c.getBoundingClientRect(),r=f.getBoundingClientRect();return {id:f.dataset.cardGalleryProduct,w:r.width,h:r.height,cardHeight:b.height,fit:getComputedStyle(i).objectFit,imageH:i.getBoundingClientRect().height,actionsVisible:c.querySelector('.card-actions').getBoundingClientRect().height>0}})};
            }""")
        def screenshot(name):
            page.evaluate("""() => {for(const i of document.querySelectorAll('#productGrid img'))i.loading='eager';const g=document.querySelector('#productGrid');window.scrollTo(0,g.getBoundingClientRect().top+scrollY-110);} """)
            page.wait_for_function("[...document.querySelectorAll('#productGrid img')].every(i=>i.complete&&i.naturalWidth>0)")
            page.screenshot(path=str(out/name))
        if args.baseline:
            before=metrics();(out/'baseline.json').write_text(json.dumps(before,ensure_ascii=False,indent=2));screenshot('antes-gourmet-1440.png');browser.close();print(json.dumps({'baseline':before['cards'],'count':before['count']}));return 0
        raw=page.evaluate("({total:__integrallApp.state.products.length,hidden:__integrallApp.state.products.filter(p=>p.hidden).length,quote:__integrallApp.state.products.filter(p=>p.price===0).length})")
        check('227 produtos preservados e nenhum oculto; 222 sem preço continuam sob consulta',raw=={'total':227,'hidden':0,'quote':222},raw)
        m=metrics();check('Gourmet: primeira página contém 12 de 82, com 7 páginas',m['cards']==12 and m['current']==1 and 'de 82' in m['count'] and 'de 7' in m['count'],m)
        check('Primeira página: Anterior desabilitado e número atual indicado',page.locator('#catalogPagination button').first.is_disabled() and page.locator('#catalogPagination [aria-current="page"]').inner_text()=='1')
        ids=[]
        for n in range(1,8):
            page.evaluate('(n)=>__integrallApp.changeCatalogPage(n,{focus:false,scroll:false,historyMode:"none"})',n)
            chunk=page.locator('#productGrid [data-card-gallery-product]').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.cardGalleryProduct)');ids.extend(chunk)
            check(f'Gourmet página {n}: '+('10' if n==7 else '12')+' itens',len(chunk)==(10 if n==7 else 12))
        check('82 produtos Gourmet alcançáveis sem duplicar ou omitir',len(ids)==82 and len(set(ids))==82)
        check('Última página: Próxima desabilitada',page.locator('#catalogPagination button').last.is_disabled())
        page.locator('#catalogPagination [data-catalog-page="2"]').click();check('Clique no número substitui a página e leva foco ao catálogo',metrics()['cards']==12 and metrics()['current']==2 and page.evaluate('document.activeElement.id')=='productGrid')
        page.locator('#catalogPagination button').last.click();check('Próxima avança para 3',metrics()['current']==3)
        page.go_back();page.wait_for_function('__integrallApp.state.catalogPage===2');check('Voltar restaura a página 2 e o departamento Gourmet',page.evaluate("__integrallApp.state.page==='petit-four'") and metrics()['cards']==12)
        back_position=page.evaluate("({top:document.querySelector('#productGrid').getBoundingClientRect().top,header:document.querySelector('#topo').getBoundingClientRect().height,height:innerHeight,restoration:history.scrollRestoration})");check('Voltar mantém os resultados abaixo do cabeçalho',back_position['top']>=back_position['header'] and back_position['top']<back_position['height']/2,back_position)
        page.go_forward();page.wait_for_function('__integrallApp.state.catalogPage===3');check('Avançar restaura a página 3',metrics()['current']==3)
        page.get_by_role('button', name='Ir para a página 4', exact=True).focus();page.keyboard.press('Enter');check('Paginação por teclado funciona e o foco inicia nos resultados',metrics()['current']==4 and page.evaluate('document.activeElement.id')=='productGrid')
        selected=page.locator('#productGrid [data-card-gallery-product]').first.get_attribute('data-card-gallery-product')
        page.evaluate('(id)=>__integrallApp.openProduct(id,{updateHash:false,focus:false,scroll:false})',selected)
        check('Produto sob consulta abre na página selecionada sem permitir compra',not page.locator('#productDetails').is_hidden() and page.locator('#modalAdd').is_disabled())
        page.evaluate('__integrallApp.closeProductDetails({returnFocus:false,updateHistory:false})');check('Fechar o produto mantém a página 4',metrics()['current']==4)
        page.locator('#search').fill('Rosca');check('Pesquisa volta à página 1 e filtra',metrics()['current']==1 and metrics()['cards']>0 and metrics()['cards']<=12)
        page.locator('#search').fill('zzzzzzzzinexistente');check('Busca vazia não deixa paginação nem cards antigos',page.locator('#productGrid').is_hidden() and page.locator('#catalogPagination').is_hidden() and page.locator('#productGrid .card').count()==0)
        page.locator('#clearFilters').click();check('Limpar filtros recupera os 82 produtos paginados',metrics()['cards']==12 and 'de 82' in metrics()['count'])
        page.evaluate('__integrallApp.changeCatalogPage(3,{focus:false,scroll:false,historyMode:"none"})')
        options=page.locator('#category option').evaluate_all('(a)=>a.map(o=>o.value)');page.locator('#category').select_option(options[1]);check('Alterar categoria volta à primeira página',metrics()['current']==1 and metrics()['cards']<=12)
        page.locator('#clearFilters').click();page.evaluate('__integrallApp.changeCatalogPage(3,{focus:false,scroll:false,historyMode:"none"})')
        options=page.locator('#sort option').evaluate_all('(a)=>a.map(o=>o.value)');page.locator('#sort').select_option(next(x for x in options if x not in ['featured','manual']));check('Alterar ordenação volta à primeira página',metrics()['current']==1)
        page.locator('#clearFilters').click();page.locator('.advanced-filter-box summary').click();page.evaluate('__integrallApp.changeCatalogPage(3,{focus:false,scroll:false,historyMode:"none"})');page.locator('#filterAvailability').select_option('available');check('Filtro avançado volta à primeira página e mantém compra protegida',metrics()['current']==1 and metrics()['cards']>0 and metrics()['cards']<=12);page.locator('#clearFilters').click()
        page.evaluate("__integrallApp.navigate('vitrine',{historyMode:'none'})")
        all_ids=[]
        for n in range(1,20):
            page.evaluate('(n)=>__integrallApp.changeCatalogPage(n,{focus:false,scroll:false,historyMode:"none"})',n);all_ids+=page.locator('#productGrid [data-card-gallery-product]').evaluate_all('(a)=>a.map(n=>n.dataset.cardGalleryProduct)')
        check('Vitrine: todas as 19 páginas cobrem exatamente 227 produtos',len(all_ids)==len(set(all_ids))==227 and metrics()['cards']==11)
        page.evaluate("__integrallApp.setProducts(__integrallApp.state.products)");check('Atualização do catálogo mantém a página atual',metrics()['current']==19 and metrics()['cards']==11)
        page.evaluate("__integrallApp.setPromotions(__integrallApp.state.promotions)");check('Atualização de promoções não reinicia a paginação',metrics()['current']==19)
        page.evaluate("__integrallApp.setSettings(__integrallApp.state.settings)");check('Atualização de configurações não reinicia a paginação',metrics()['current']==19)
        page.evaluate("globalThis.__savedProducts=__integrallApp.state.products;__integrallApp.setProducts(__savedProducts.slice(0,13))")
        check('Redução do catálogo limita a página antiga sem deixar tela vazia',metrics()['current']==2 and metrics()['cards']==1)
        page.evaluate('__integrallApp.setProducts(__savedProducts);delete globalThis.__savedProducts')
        for dep,total in [('vinhos',129),('cafes',7),('sucos',9)]:
            page.evaluate('(dep)=>__integrallApp.navigate(dep,{historyMode:"none"})',dep);m=metrics();check(f'{dep}: até 12 de {total}, primeira página',m['cards']==min(12,total) and m['current']==1)
            check(f'{dep}: garrafas/embalagens inteiras com contain',all(f['fit']=='contain' for f in m['frames']))
        page.evaluate("__integrallApp.navigate('petit-four',{historyMode:'none'})")
        widths=[int(w) for w in args.widths.split(',')] if args.widths else WIDTHS
        for width in widths:
            page.set_viewport_size({'width':width,'height':1000});page.mouse.move(0,0);page.wait_for_timeout(40);m=metrics();frames=m['frames']
            equal=all(abs(f['w']-frames[0]['w'])<1 and abs(f['h']-f['w'])<1 and abs(f['cardHeight']-frames[0]['cardHeight'])<1 and f['fit']=='cover' and abs(f['imageH']-f['h'])<1 and f['actionsVisible'] for f in frames)
            check(f'{width}px: 12 cards iguais, quadros quadrados, fotos preenchidas e sem overflow',m['cards']==12 and equal and not m['horizontal'],m)
            if width in [320,768,1440]:screenshot(f'gourmet-pagina-1-{width}.png')
        page.set_viewport_size({'width':1440,'height':1000});page.evaluate('__integrallApp.changeCatalogPage(7,{focus:false,scroll:false,historyMode:"none"})');page.locator('#catalogPagination').scroll_into_view_if_needed();page.screenshot(path=str(out/'paginacao-ultima-pagina-1440.png'))
        page.evaluate('__integrallApp.changeCatalogPage(1,{focus:false,scroll:false,historyMode:"none"})');screenshot('gourmet-pagina-1-1440.png');page.set_viewport_size({'width':1440,'height':2100});page.mouse.move(0,0);page.evaluate("window.scrollTo(0,document.querySelector('#resultCount').getBoundingClientRect().top+scrollY-100)");page.wait_for_timeout(60);page.screenshot(path=str(out/'grade-completa-12-produtos-1440.png'))
        check('Sem erros JavaScript no navegador',not errors,errors)
        browser_version=browser.version;browser.close()
    report={'status':'APROVADO' if all(x['status']=='APROVADO' for x in results) else 'REPROVADO','browser':browser_version,'scope':'Chromium about:blank; código real e imagens reais; sem Express/CSP/cookies de produção','results':results}
    (out/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':report['status'],'checks':len(results),'failures':[x['name'] for x in results if x['status']!='APROVADO']},ensure_ascii=False));return int(report['status']!='APROVADO')
if __name__=='__main__':raise SystemExit(main())
