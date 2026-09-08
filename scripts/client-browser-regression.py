#!/usr/bin/env python3
"""Account regression against real DOM/CSS/JS with explicitly simulated API.
Uses about:blank: does not certify native navigation, cookies, TLS or Express.
"""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright
import importlib.util
spec = importlib.util.spec_from_file_location('integrall_browser_fixture', Path(__file__).with_name('browser-regression.py'))
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
prepare_html, build_products, STYLE_FILES = fixture.prepare_html, fixture.build_products, fixture.STYLE_FILES

MOCK = r'''() => {
 window.__queue = {}; window.__held = {}; window.__calls=[];
 window.__account = {email:'cliente@example.com',name:'Cliente de teste',phone:'',addresses:[],favorites:[]};
 window.__auth = true;
 window.__session = () => ({authenticated:window.__auth,account:window.__auth?window.__account:null,csrfToken:window.__auth?'fixture-csrf':''});
 window.__hold = (path,id) => {(__queue[path] ||= []).push({id});};
 window.__respond = (id,value) => {const pending=__held[id]; if(!pending)throw Error('Resposta não pendente: '+id); delete __held[id]; pending.resolve(value);};
 window.IntegrallApi={request:async(path,options={})=>{
   __calls.push({path,method:options.method||'GET'});
   const item=__queue[path]?.shift();
   if(item?.id)return new Promise((resolve,reject)=>{__held[item.id]={resolve,reject};});
   if(path==='/api/account/session')return __session();
   if(path==='/api/account/logout'){__auth=false;return {ok:true};}
   if(path==='/api/account/login/request')return {ok:true,developmentCode:'123456'};
   if(path==='/api/account/login/verify'){__auth=true;__account={...__account,email:JSON.parse(options.body).email};return __session();}
   if(path==='/api/account/profile')return {account:{...__account,...JSON.parse(options.body)}};
   if(path==='/api/account/orders')return {orders:window.__orders||[]};
   if(path==='/api/account/reorder')return {items:[{productId:'audit-product-b',variantId:'',qty:1}]};
   if(path.includes('/reviews'))return {reviews:[],summary:{count:0,average:0}};
   return {};
 }};
}'''

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--root',type=Path,default=Path.cwd());parser.add_argument('--out',type=Path,required=True);parser.add_argument('--only',default='');parser.add_argument('--group',choices=['all','functional','responsive'],default='all')
    args=parser.parse_args();root=args.root.resolve();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
    results=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        contexts=[]
        def setup(initial=''):
            context=browser.new_context(viewport={'width':1280,'height':900},reduced_motion='reduce',bypass_csp=True);contexts.append(context)
            page=context.new_page(); page.set_default_timeout(3000)
            page.audit_page_errors=[];page.on('pageerror',lambda error:page.audit_page_errors.append(str(error)))
            page.route('https://integrall.test/**',lambda route:route.abort())
            page.set_content(prepare_html(root),wait_until='domcontentloaded')
            for css in STYLE_FILES:page.add_style_tag(content=(root/'public'/css).read_text())
            page.add_script_tag(content=(root/'public/js/store/catalog.js').read_text())
            page.evaluate('p=>__integrallApp.setProducts(p)',build_products()[0]);page.wait_for_timeout(80)
            page.evaluate(MOCK)
            if initial:page.evaluate(initial)
            page.add_script_tag(content=(root/'public/js/store/commerce-v111.js').read_text()); page.wait_for_timeout(50)
            return page
        def check(label,fn):
            if args.only and args.only not in label:return
            is_responsive=label.startswith('Conta com textos')
            if args.group=='functional' and is_responsive:return
            if args.group=='responsive' and not is_responsive:return
            page=None
            try:
                page,detail=fn();detail['pageErrors']=page.audit_page_errors;detail['ok']=detail['ok'] and not page.audit_page_errors;results.append({'test':label,'status':'APROVADO' if detail['ok'] else 'REPROVADO','observed':detail})
            except Exception as exc:results.append({'test':label,'status':'REPROVADO','error':str(exc)})
            finally:
                for context in contexts:context.close()
                contexts.clear()
            print(label,results[-1]['status'],results[-1].get('observed',results[-1].get('error')),flush=True)
            (out/'parcial.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
        def slow_orders():
            p=setup();p.evaluate("__hold('/api/account/orders','orders')");p.locator('#openAccount').click();p.wait_for_timeout(120)
            visible=p.get_by_role('button',name='Sair desta conta',exact=True).count()==1
            p.locator('#accountModal').screenshot(path=str(out/'conta-pedidos-lentos.png'))
            return p,{'ok':visible,'logoutWhileOrdersPending':visible}
        check('Logout disponível com pedidos ainda carregando',slow_orders)
        def stale_session():
            p=setup("__hold('/api/account/session','initial')")
            p.locator('#openAccount').click();p.get_by_role('button',name='Sair desta conta',exact=True).click();p.wait_for_timeout(50)
            p.evaluate("__respond('initial',{authenticated:true,account:__account,csrfToken:'old-token'})");p.wait_for_timeout(60)
            has=p.locator('#openAccount').evaluate("n=>n.classList.contains('has-session')")
            return p,{'ok':not has and p.locator('#accountLoginEmail').count()==1,'resurrectedSession':has}
        check('Resposta de sessão anterior não desfaz logout',stale_session)
        def stale_orders():
            p=setup();p.evaluate("__hold('/api/account/orders','oldOrders')");p.locator('#openAccount').click();p.wait_for_timeout(80);p.locator('#closeAccount').click();p.evaluate('__auth=false');p.locator('#openAccount').click();p.wait_for_timeout(80)
            p.evaluate("__respond('oldOrders',{orders:[{id:'PEDIDO-ANTIGO',status:'paid',totalCents:100,items:[],createdAt:'2026-01-01'}]})");p.wait_for_timeout(80)
            stale=p.get_by_role('button',name='Sair desta conta',exact=True).count()
            return p,{'ok':p.locator('#accountLoginEmail').count()==1 and stale==0,'privateActionsOnLogin':stale}
        check('Pedidos atrasados não acrescentam ações privadas na tela de login',stale_orders)
        def stale_code():
            p=setup('__auth=false');p.locator('#openAccount').click();p.locator('#accountLoginEmail').fill('primeiro@example.com');p.evaluate("__hold('/api/account/login/request','oldCode')");p.get_by_role('button',name='Enviar código',exact=True).click();p.wait_for_timeout(50);p.locator('#closeAccount').click();p.locator('#openAccount').click();p.wait_for_timeout(60)
            p.evaluate("__respond('oldCode',{ok:true,developmentCode:'123456'})");p.wait_for_timeout(80)
            return p,{'ok':p.locator('#accountLoginEmail').count()==1,'oldCodeViewReappeared':p.locator('#accountCode').count()==1}
        check('Solicitação antiga de código não substitui tela reaberta',stale_code)
        def reorder():
            p=setup("__orders=[{id:'PEDIDO-TESTE',status:'paid',totalCents:4590,items:[],createdAt:'2026-01-01',canReorder:true}]")
            p.locator('#openAccount').click();p.get_by_role('button',name='Comprar novamente',exact=True).click();p.wait_for_timeout(80)
            detail=p.evaluate("() => ({locked:document.body.classList.contains('lock'),cartOpen:document.querySelector('#cartDrawer')?.classList.contains('open'),accountOpen:document.querySelector('#accountModal').classList.contains('open')})")
            detail['ok']=detail['locked'] and detail['cartOpen'] and not detail['accountOpen'];return p,detail
        check('Comprar novamente preserva trava de rolagem da sacola',reorder)
        def expired_logout():
            p=setup();p.locator('#openAccount').click();p.evaluate("__hold('/api/account/logout','logout')");p.get_by_role('button',name='Sair desta conta',exact=True).click();p.wait_for_timeout(40)
            p.evaluate("__held.logout.reject(Object.assign(new Error('Sessão expirada'),{status:401,code:'ACCOUNT_AUTH_REQUIRED'}))");p.wait_for_timeout(60)
            return p,{'ok':p.locator('#accountLoginEmail').count()==1,'loginVisible':p.locator('#accountLoginEmail').count()==1}
        check('Logout com sessão expirada volta ao login',expired_logout)
        def failed_logout():
            p=setup();p.locator('#openAccount').click();p.evaluate("__hold('/api/account/logout','logout')");p.get_by_role('button',name='Sair desta conta',exact=True).click();p.wait_for_timeout(40)
            p.evaluate("__held.logout.reject(Object.assign(new Error('Indisponível'),{status:503}))");p.wait_for_timeout(60)
            kept=p.locator('#openAccount').evaluate("n=>n.classList.contains('has-session')")
            p.get_by_role('button',name='Sair desta conta',exact=True).click();p.wait_for_timeout(60)
            return p,{'ok':kept and p.locator('#accountLoginEmail').count()==1,'keptOnFailure':kept,'retryWorks':p.locator('#accountLoginEmail').count()==1}
        check('Falha de logout não simula sucesso; nova tentativa funciona',failed_logout)
        def bad_cep():
            p=setup();p.locator('#openAccount').click();p.locator('#accountContent summary').click();
            for name,value in [('Rua / avenida','Rua teste'),('Número','10'),('Cidade','Campinas'),('UF','SP')]:p.get_by_label(name,exact=True).fill(value)
            p.get_by_role('button',name='Adicionar endereço',exact=True).click();p.wait_for_timeout(60)
            count=p.evaluate("__calls.filter(x=>x.path==='/api/account/profile').length")
            return p,{'ok':count==0,'invalidAddressSubmitted':count>0}
        check('Endereço incompleto não é enviado como cadastro válido',bad_cep)
        def code_focus():
            p=setup('__auth=false');p.locator('#openAccount').click();p.locator('#accountLoginEmail').fill('cliente@example.com');p.get_by_role('button',name='Enviar código',exact=True).click();p.locator('#accountCode').wait_for()
            p.evaluate("window.dispatchEvent(new StorageEvent('storage',{key:'integrall-customer-session-change'}))");p.wait_for_timeout(100)
            return p,{'ok':p.locator('#accountCode').count()==1,'codeViewPreserved':p.locator('#accountCode').count()==1}
        check('Consultar o e-mail em outra aba não apaga a etapa do código',code_focus)
        def reopen_verify():
            p=setup('__auth=false');p.locator('#openAccount').click();p.locator('#accountLoginEmail').fill('cliente@example.com');p.get_by_role('button',name='Enviar código',exact=True).click();p.locator('#accountCode').wait_for()
            p.evaluate("__hold('/api/account/login/verify','verify')");p.get_by_role('button',name='Entrar',exact=True).click();p.wait_for_timeout(40);p.locator('#closeAccount').click();p.locator('#openAccount').click();p.wait_for_timeout(40)
            p.evaluate("__auth=true;__respond('verify',__session())");p.wait_for_timeout(150)
            return p,{'ok':p.get_by_role('button',name='Sair desta conta',exact=True).count()==1,'stillChecking':'Verificando sua conta' in p.locator('#accountContent').inner_text()}
        check('Fechar e reabrir durante login não prende a conta em carregamento',reopen_verify)
        def stale_profile():
            p=setup();p.locator('#openAccount').click();p.evaluate("__hold('/api/account/profile','profile')");p.get_by_role('button',name='Salvar dados',exact=True).click();p.wait_for_timeout(40)
            p.get_by_role('button',name='Sair desta conta',exact=True).click();p.locator('#accountLoginEmail').fill('nova@example.com');p.get_by_role('button',name='Enviar código',exact=True).click();p.get_by_role('button',name='Entrar',exact=True).click();p.wait_for_timeout(60)
            p.evaluate("__respond('profile',{account:{email:'cliente@example.com',name:'ANTERIOR',addresses:[],favorites:[]}})");p.wait_for_timeout(80)
            title=p.locator('#openAccount').get_attribute('title')
            return p,{'ok':'nova@example.com' in title,'currentAccountTitle':title}
        check('Gravação antiga de perfil não substitui a nova conta',stale_profile)
        def revoked_session():
            p=setup();p.locator('#openAccount').click();p.wait_for_timeout(50)
            p.evaluate("__auth=false;window.dispatchEvent(new StorageEvent('storage',{key:'integrall-customer-session-change'}))");p.wait_for_timeout(100)
            return p,{'ok':p.locator('#accountLoginEmail').count()==1,'privateActions':p.get_by_role('button',name='Sair desta conta',exact=True).count()}
        check('Notificação de outra aba revalida sessão revogada',revoked_session)
        def valid_address():
            p=setup();p.locator('#openAccount').click();p.locator('#accountContent summary').click()
            for name,value in [('CEP','13000-000'),('Rua / avenida','Rua teste'),('Número','10'),('Cidade','Campinas'),('UF','SP')]:p.get_by_label(name,exact=True).fill(value)
            p.get_by_role('button',name='Adicionar endereço',exact=True).click();p.wait_for_timeout(80)
            count=p.evaluate("__calls.filter(x=>x.path==='/api/account/profile').length")
            return p,{'ok':count==1 and p.locator('.account-address').count()==1,'submitted':count}
        check('Endereço completo continua sendo enviado e exibido',valid_address)
        def product_no_scroll():
            p=setup();p.evaluate("window.scrollTo(0,0);__integrallApp.openProduct('audit-product-a',{focus:false,scroll:false})");p.wait_for_timeout(100)
            y=p.evaluate('window.scrollY');return p,{'ok':y<=1,'scrollY':y}
        check('Produto: atualização silenciosa respeita scroll false',product_no_scroll)
        def stale_product_route():
            p=setup();p.evaluate("location.hash='product=audit-product-a';__integrallApp.setProducts(__integrallApp.getState().products);location.hash='page=cafes'");p.wait_for_timeout(140)
            opened=p.locator('#productDetails').evaluate('n=>!n.hidden');return p,{'ok':not opened,'oldProductReopened':opened}
        check('Produto: abertura agendada é descartada ao mudar de rota',stale_product_route)
        def accessible_account():
            p=setup();p.locator('#openAccount').click();p.wait_for_timeout(80)
            count=p.get_by_role('dialog',name='Minha conta',exact=True).count();focused=p.evaluate('document.activeElement.id')
            return p,{'ok':count==1 and focused!='accountBackdrop','namedDialog':count,'focusedId':focused}
        check('Conta: diálogo nomeado e foco inicial em controle útil',accessible_account)
        for width in [280,320,360,375,390,412,430,480,600,768,820,1024,1280,1366,1440,1600,1920,2560]:
            def responsive(width=width):
                p=setup("__account.email='a'.repeat(230)+'@example.com';__account.name='NomeMuitoLongoSemEspacos'.repeat(4)")
                p.set_viewport_size({'width':width,'height':800});p.locator('#openAccount').click();p.wait_for_timeout(80)
                detail=p.evaluate("""() => {const root=document.querySelector('.account-panel');const content=document.querySelector('#accountContent');const r=root?.getBoundingClientRect();return {globalOverflow:document.documentElement.scrollWidth>innerWidth+1,contentOverflow:content.scrollWidth>content.clientWidth+1,panelWidth:r?.width,viewport:innerWidth}}""")
                detail['ok']=not detail['globalOverflow'] and not detail['contentOverflow']
                if width in [320,768,1440]:p.screenshot(path=str(out/f'conta-{width}.png'),timeout=5000)
                return p,detail
            check(f'Conta com textos longos em {width}px',responsive)
        browser.close()
    report={'scope':'Chromium com DOM/CSS/JS reais e API simulada; about:blank, sem certificação HTTP/cookies/Express','results':results}
    (out/'resultado.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    return int(any(x['status']!='APROVADO' for x in results))
if __name__=='__main__':raise SystemExit(main())
