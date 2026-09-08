#!/usr/bin/env python3
"""Regressão visual/funcional da loja INTEGRALL v11.1.7 sem backend.

Valida detalhes em fluxo normal abaixo da galeria, galeria/foto por variação,
fechamento e foco, fallback de imagem, paginação numerada (12 itens por página),
responsividade e ausência de erros de console em Chromium.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote

from playwright.sync_api import sync_playwright

WIDTHS = [280, 320, 360, 375, 390, 412, 430, 480, 600, 768, 820, 1024, 1280, 1366, 1440, 1600, 1920, 2560]
SCREENSHOT_WIDTHS = {320, 375, 430, 768, 1024, 1280, 1440, 1920}
STYLE_FILES = ["css/store.css", "css/checkout.css", "css/premium-v104.css", "css/commerce-v111.css"]


def svg_data(label: str, color: str) -> str:
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1000">'
        f'<rect width="900" height="1000" fill="{color}"/>'
        f'<text x="450" y="500" text-anchor="middle" fill="white" font-size="64">{label}</text>'
        '</svg>'
    )
    return "data:image/svg+xml;charset=UTF-8," + quote(svg)


def prepare_html(root: Path) -> str:
    html = (root / "public/index.html").read_text("utf-8")
    html = re.sub(r'<meta\b[^>]*http-equiv=["\']Content-Security-Policy["\'][^>]*>', "", html, flags=re.I)
    html = re.sub(r'<link\b[^>]*rel=["\']stylesheet["\'][^>]*>', "", html, flags=re.I)
    html = re.sub(r'<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>', "", html, flags=re.I)
    html = html.replace('<head>', '<head><base href="https://integrall.test/">', 1)
    return html


def build_products() -> tuple[list[dict[str, Any]], str, str]:
    first = svg_data("VARIACAO A", "#5b101a")
    second = svg_data("VARIACAO B", "#1d4b6e")
    other = svg_data("OUTRO PRODUTO", "#5a4a2d")
    broken = "data:image/png;base64,arquivo-corrompido"
    products: list[dict[str, Any]] = [
        {
            "id": "audit-product-a", "slug": "produto-auditoria-a",
            "name": "Produto de auditoria com nome suficientemente longo para validar quebra responsiva",
            "department": "vinhos", "subcategory": "Auditoria", "brand": "INTEGRALL", "price": 7990, "unit": "750 ml",
            "description": "Descrição longa para validar reflow, legibilidade e ausência de cortes. " * 5,
            "images": [first, second],
            "variants": [
                {"id": "audit-a-v1", "name": "Variação A", "price": 7990, "stock": 8, "image": first, "position": 1},
                {"id": "audit-a-v2", "name": "Variação B", "price": 8990, "stock": 4, "image": second, "position": 2},
            ],
            "attributes": {"wineType": "Tinto", "grape": "Auditoria", "volume": "750 ml"},
            "available": True, "giftEnabled": True, "position": 1,
        },
        {
            "id": "audit-product-b", "slug": "produto-auditoria-b", "name": "Segundo produto",
            "department": "vinhos", "subcategory": "Auditoria", "price": 4590, "unit": "375 ml",
            "description": "Segundo produto sem variações.", "images": [other], "variants": [],
            "available": True, "giftEnabled": True, "position": 2,
        },
        {
            "id": "audit-product-broken", "slug": "produto-imagem-corrompida", "name": "Produto com imagem corrompida",
            "department": "cafes", "price": 3990, "unit": "250 g", "description": "Validação de fallback.",
            "images": [broken], "variants": [], "available": True, "position": 3,
        },
    ]
    for index in range(4, 19):
        products.append({
            "id": f"audit-extra-{index}", "slug": f"audit-extra-{index}", "name": f"Produto extra {index}",
            "department": "vinhos", "subcategory": "Auditoria", "price": 3000 + index, "unit": "un",
            "description": "Produto adicional para validar paginação numerada.", "images": [other], "variants": [],
            "available": True, "position": index,
        })
    return products, first, second


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    parser.add_argument("--widths", default="", help="Subconjunto explícito para reteste, ex.: 320,768,1440. O padrão mantém as 18 larguras.")
    parser.add_argument("--experimental-css-zoom", action="store_true", help="Experimento de CSS zoom; não equivale ao zoom nativo do navegador.")
    args = parser.parse_args()
    widths = [int(x.strip()) for x in args.widths.split(",")] if args.widths else WIDTHS
    if not widths or any(w < 200 or w > 4096 for w in widths):parser.error("Larguras devem estar entre 200 e 4096px.")

    root = args.root.resolve(); out = args.out.resolve(); out.mkdir(parents=True, exist_ok=True)
    html = prepare_html(root)
    styles = [(root / "public" / rel).read_text("utf-8") for rel in STYLE_FILES]
    catalog_js = (root / "public/js/store/catalog.js").read_text("utf-8")
    commerce_js = (root / "public/js/store/commerce-v111.js").read_text("utf-8")
    checkout_js = (root / "public/js/store/checkout.js").read_text("utf-8")
    products, first, second = build_products()

    results: list[dict[str, Any]] = []
    failures: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])
        context = browser.new_context(viewport={"width": WIDTHS[0], "height": 900}, device_scale_factor=1, bypass_csp=True, reduced_motion="reduce")
        transparent_png = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082')

        for width in widths:
            print(f"[browser] {width}px", flush=True)
            page = context.new_page(); page.set_viewport_size({"width": width, "height": 900})
            page.route('https://integrall.test/**', lambda route: route.fulfill(status=200, content_type='image/png', body=transparent_png))
            console_errors: list[str] = []
            page.on("console", lambda msg, bucket=console_errors: bucket.append(f"{msg.type}: {msg.text}") if msg.type == "error" and "Failed to load resource" not in msg.text else None)
            page.on("pageerror", lambda err, bucket=console_errors: bucket.append(f"pageerror: {err}"))
            page.set_content(html, wait_until="domcontentloaded", timeout=10_000)
            for css in styles: page.add_style_tag(content=css)
            page.add_style_tag(content="html{scroll-behavior:auto!important}*,*::before,*::after{animation:none!important;transition:none!important}")
            page.add_script_tag(content=catalog_js)
            page.evaluate("products => globalThis.__integrallApp.setProducts(products)", products)
            page.wait_for_timeout(80)

            initial_cards = page.locator('#productGrid .card').count()
            pagination_before = page.evaluate("() => ({hidden:document.querySelector('#catalogPagination')?.hidden,text:document.querySelector('#resultCount')?.textContent})")

            # A galeria do card deve trocar foto sem abrir o produto.
            card_stage = page.locator('[data-card-gallery-product="audit-product-a"]').first
            card_initial_src = card_stage.locator('.card-image-main').get_attribute('src')
            card_stage.locator('[data-card-gallery-step="1"]').click(); page.wait_for_timeout(20)
            card_next_src = card_stage.locator('.card-image-main').get_attribute('src')
            card_still_closed = page.locator('#productDetails').evaluate('node => node.hidden')
            page.evaluate("""() => {
              const stage=document.querySelector('[data-card-gallery-product="audit-product-a"]');
              const r=stage.getBoundingClientRect(),y=r.top+r.height/2;
              stage.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:77,pointerType:'touch',clientX:r.left+20,clientY:y}));
              stage.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:77,pointerType:'touch',clientX:r.right-20,clientY:y}));
            }"""); page.wait_for_timeout(20)
            card_swipe_src = card_stage.locator('.card-image-main').get_attribute('src')
            card_media_metrics = page.evaluate("""() => {
              const stage=document.querySelector('[data-card-gallery-product="audit-product-a"]');
              const r=stage.getBoundingClientRect(),cs=getComputedStyle(stage);
              return {w:r.width,h:r.height,borderTop:cs.borderTopWidth,borderLeft:cs.borderLeftWidth,mainFit:getComputedStyle(stage.querySelector('.card-image-main')).objectFit,fillFit:getComputedStyle(stage.querySelector('.card-image-fill')).objectFit};
            }""")
            page.evaluate("__integrallApp.changeCatalogPage(2,{focus:false,scroll:false,historyMode:'none'})")
            after_more_cards = page.locator('#productGrid .card').count()
            # A busca filtra o catálogo inteiro e retorna à primeira página de 12.
            page.locator('#search').fill('produto'); page.locator('#search').dispatch_event('input'); page.wait_for_timeout(20)
            after_search_cards = page.locator('#productGrid .card').count()
            page.locator('#search').fill(''); page.locator('#search').dispatch_event('input'); page.wait_for_timeout(20)

            opener = page.locator('[data-details="audit-product-a"]').first
            opener.scroll_into_view_if_needed(); opener.focus()
            before_scroll = page.evaluate("() => window.scrollY")
            page.evaluate("() => globalThis.__integrallApp.openProduct('audit-product-a',{updateHash:false,focus:true})")
            page.wait_for_timeout(80)
            after_scroll = page.evaluate("() => window.scrollY")

            initial_src = page.locator("#modalImage").get_attribute("src")
            page.locator('#modalGalleryNext').click(); page.wait_for_timeout(20)
            modal_next_src = page.locator('#modalImage').get_attribute('src')
            page.keyboard.press('ArrowLeft'); page.wait_for_timeout(20)
            modal_keyboard_src = page.locator('#modalImage').get_attribute('src')
            page.locator('#modalGalleryStage').hover(); page.mouse.wheel(0, 650); page.wait_for_timeout(35)
            document_scroll_top = page.evaluate('window.scrollY')
            page.locator('#productDetails').scroll_into_view_if_needed()
            page.select_option("#modalVariant", "audit-a-v2"); page.locator("#modalVariant").dispatch_event("change"); page.wait_for_timeout(40)
            variant_src = page.locator("#modalImage").get_attribute("src")
            variant_modal_state = page.evaluate("() => ({open:!document.querySelector('#productDetails').hidden && document.querySelector('#productDetails').classList.contains('open'), overlay:document.querySelector('#overlay').classList.contains('open'), activeId:globalThis.__integrallApp.getState().activeId})")

            page.locator("#modalQty").fill("7")
            page.evaluate("() => globalThis.__integrallApp.openProduct('audit-product-b',{updateHash:false,focus:false})"); page.wait_for_timeout(40)
            switched = page.evaluate("""() => ({name:document.querySelector('#modalName')?.textContent,qty:document.querySelector('#modalQty')?.value,variantHidden:document.querySelector('#variantGroup')?.hidden,activeId:globalThis.__integrallApp.getState().activeId})""")
            page.evaluate("() => globalThis.__integrallApp.openProduct('audit-product-a',{updateHash:false,focus:false})"); page.wait_for_timeout(30)

            metrics = page.evaluate("""() => {
              const details=document.querySelector('#productDetails'); const rect=details?.getBoundingClientRect(); const style=details?getComputedStyle(details):null;
              const gridStyle=getComputedStyle(document.querySelector('.product-details-grid'));
              return {belowGallery:document.querySelector('.product-info').getBoundingClientRect().top>=document.querySelector('.product-gallery').getBoundingClientRect().bottom-1,detailsExists:!!details,detailsCount:document.querySelectorAll('#productDetails').length,hidden:details?.hidden,ariaHidden:details?.getAttribute('aria-hidden'),ariaModal:details?.getAttribute('aria-modal'),role:details?.getAttribute('role'),position:style?.position,display:style?.display,gridColumns:gridStyle.gridTemplateColumns,top:rect?.top,bottom:rect?.bottom,left:rect?.left,right:rect?.right,centerX:rect?(rect.left+rect.right)/2:null,centerY:rect?(rect.top+rect.bottom)/2:null,viewportW:innerWidth,viewportH:innerHeight,parentId:details?.parentElement?.id||'',bodyLocked:document.body.classList.contains('lock'),overlayOpen:document.querySelector('#overlay')?.classList.contains('open'),horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,activeName:document.querySelector('#modalName')?.textContent,activeId:globalThis.__integrallApp.getState().activeId,imgObjectFit:getComputedStyle(document.querySelector('#modalImage')).objectFit,overlayBackdrop:getComputedStyle(document.querySelector('#overlay')).backdropFilter||getComputedStyle(document.querySelector('#overlay')).webkitBackdropFilter||'none',popupOverflowY:style?.overflowY};
            }""")

            if width in SCREENSHOT_WIDTHS:
                page.locator("#productDetails").screenshot(path=str(out / f"produto-detalhes-{width}.png"))

            page.locator("#closeProductDetails").click(); page.wait_for_timeout(50)
            closed = page.evaluate("""() => ({hidden:document.querySelector('#productDetails')?.hidden,ariaHidden:document.querySelector('#productDetails')?.getAttribute('aria-hidden'),activeId:globalThis.__integrallApp.getState().activeId,focusedDetails:document.activeElement?.dataset?.details||'',bodyLocked:document.body.classList.contains('lock'),overlayOpen:document.querySelector('#overlay')?.classList.contains('open')})""")

            page.evaluate("() => globalThis.__integrallApp.openProduct('audit-product-a',{updateHash:false,focus:false})"); page.keyboard.press("Escape"); page.wait_for_timeout(40)
            escape_closed = page.locator("#productDetails").evaluate("node => node.hidden")

            page.evaluate("() => globalThis.__integrallApp.openProduct('audit-product-broken',{updateHash:false,focus:false})"); page.wait_for_timeout(150)
            fallback = page.locator("#modalImage").get_attribute("src") or ""
            page.evaluate("() => globalThis.__integrallApp.closeProductDetails({returnFocus:false,updateHistory:false})")

            columns = len([x for x in metrics["gridColumns"].split() if x])
            checks = {
                "opening_scrolls_to_details": after_scroll > before_scroll,
                "single_region": metrics["detailsExists"] and metrics["detailsCount"] == 1 and metrics["ariaModal"] is None and metrics["role"] == "region",
                "normal_flow": metrics["position"] in ("static","relative") and not metrics["bodyLocked"] and not metrics["overlayOpen"],
                "inside_viewport_width": metrics["left"] >= -1 and metrics["right"] <= metrics["viewportW"] + 1,
                "semantic_main_below_gallery": metrics["parentId"] == "siteMain" and metrics["belowGallery"],
                "one_column_all_widths": columns == 1,
                "no_global_overflow": not metrics["horizontalOverflow"],
                "card_gallery_without_open": card_initial_src == first and card_next_src == second and card_swipe_src == first and card_still_closed is True,
                "card_square_smart_fill": abs(card_media_metrics["w"] - card_media_metrics["h"]) <= 2 and card_media_metrics["borderTop"] == "0px" and card_media_metrics["borderLeft"] == "0px" and card_media_metrics["mainFit"] == "contain" and card_media_metrics["fillFit"] == "cover",
                "modal_gallery_controls": initial_src == first and modal_next_src == second and modal_keyboard_src == first,
                "document_scroll": document_scroll_top > after_scroll,
                "no_backdrop_blur": metrics["overlayBackdrop"] in ("none", ""),
                "no_nested_scroll": metrics["popupOverflowY"] == "visible",
                "variant_image_switch": initial_src == first and variant_src == second,
                "variant_keeps_modal_open": variant_modal_state["open"] and not variant_modal_state["overlay"] and variant_modal_state["activeId"] == "audit-product-a",
                "switch_clears_state": switched["name"] == "Segundo produto" and switched["qty"] == "1" and switched["variantHidden"] is True and switched["activeId"] == "audit-product-b",
                "close_clears_and_restores_focus": closed["hidden"] is True and closed["ariaHidden"] == "true" and closed["activeId"] == "" and closed["focusedDetails"] == "audit-product-a" and not closed["bodyLocked"] and not closed["overlayOpen"],
                "escape_closes": escape_closed is True,
                "broken_image_fallback": fallback.startswith("data:image/svg+xml"),
                "details_image_contains": metrics["imgObjectFit"] == "contain",
                "catalog_initial_12": initial_cards == 12 and pagination_before.get("hidden") is False,
                "catalog_second_page_replaces_first": after_more_cards == len(products)-12,
                "search_resets_to_first_12": after_search_cards == 12,
                "no_console_errors": not console_errors,
            }
            failed = [name for name, ok in checks.items() if not ok]
            if failed: failures.append(f"{width}px: {', '.join(failed)}")
            results.append({"width": width, "status": "APROVADO" if not failed else "REPROVADO", "checks": checks, "metrics": metrics, "consoleErrors": console_errors})
            page.close()

        context.close()

        # Resposta assíncrona antiga de avaliação não pode reaparecer depois de fechar o popup.
        context = browser.new_context(viewport={"width": 1024, "height": 900}, bypass_csp=True)
        page = context.new_page(); page.route('https://integrall.test/**', lambda route: route.fulfill(status=200, content_type='image/png', body=transparent_png))
        page.set_content(html, wait_until="domcontentloaded", timeout=10_000)
        for css in styles: page.add_style_tag(content=css)
        page.add_script_tag(content=catalog_js); page.evaluate("products => globalThis.__integrallApp.setProducts(products)", products)
        page.evaluate("""() => {globalThis.IntegrallApi={request:async path=>{if(path==='/api/account/session')return{authenticated:false};if(path.includes('/reviews')){await new Promise(resolve=>setTimeout(resolve,120));return{summary:{count:1,average:5},reviews:[{author:'Resposta antiga',rating:5,body:'Não deve reaparecer'}]};}return{};}};}""")
        page.add_script_tag(content=commerce_js)
        page.evaluate("() => globalThis.__integrallApp.openProduct('audit-product-a',{updateHash:false,focus:false})"); page.wait_for_timeout(20)
        page.evaluate("() => globalThis.__integrallApp.closeProductDetails({returnFocus:false,updateHistory:false})"); page.wait_for_timeout(180)
        stale = page.evaluate("() => ({count:document.querySelector('#reviewsList')?.children.length||0,summary:document.querySelector('#reviewsSummary')?.textContent||''})")
        async_ok = stale["count"] == 0 and stale["summary"] == ""
        if not async_ok: failures.append("async-reviews: resposta antiga reapareceu após fechamento")
        results.append({"scenario":"async-reviews-after-close","status":"APROVADO" if async_ok else "REPROVADO","state":stale})
        context.close()

        # Conta não pode ficar empilhada sobre o popup do produto; Tab deve permanecer na conta.
        context = browser.new_context(viewport={"width": 1024, "height": 900}, bypass_csp=True)
        page = context.new_page(); page.route('https://integrall.test/**', lambda route: route.fulfill(status=200, content_type='image/png', body=transparent_png))
        page.set_content(html, wait_until="domcontentloaded", timeout=10_000)
        for css in styles: page.add_style_tag(content=css)
        page.add_script_tag(content=catalog_js); page.evaluate("products => globalThis.__integrallApp.setProducts(products)", products)
        page.evaluate("""() => {globalThis.IntegrallApi={request:async path=>path==='/api/account/session'?{authenticated:false}:({})};}""")
        page.add_script_tag(content=commerce_js)
        page.evaluate("() => globalThis.__integrallApp.openProduct('audit-product-a',{updateHash:false,focus:false})"); page.wait_for_timeout(30)
        page.locator('#modalFavorite').dispatch_event('click'); page.wait_for_timeout(60)
        account_open = page.evaluate("""() => ({productHidden:document.querySelector('#productDetails').hidden,accountOpen:document.querySelector('#accountModal').classList.contains('open'),overlayOpen:document.querySelector('#overlay').classList.contains('open'),bodyLocked:document.body.classList.contains('lock')})""")
        tab_inside = True
        for _ in range(6):
            page.keyboard.press('Tab'); page.wait_for_timeout(5)
            if not page.evaluate("() => Boolean(document.activeElement?.closest?.('#accountModal'))"):
                tab_inside = False; break
        page.locator('#closeAccount').dispatch_event('click'); page.wait_for_timeout(30)
        account_closed = page.evaluate("""() => ({accountOpen:document.querySelector('#accountModal').classList.contains('open'),bodyLocked:document.body.classList.contains('lock')})""")
        account_ok = account_open["productHidden"] and account_open["accountOpen"] and not account_open["overlayOpen"] and account_open["bodyLocked"] and tab_inside and not account_closed["accountOpen"] and not account_closed["bodyLocked"]
        if not account_ok: failures.append("account-layering: conta empilhou camada ou foco escapou")
        results.append({"scenario":"account-layering","status":"APROVADO" if account_ok else "REPROVADO","open":account_open,"tabInside":tab_inside,"closed":account_closed})

        # Sugestões da busca precisam funcionar por teclado e fechar com Escape.
        page.locator('#search').fill('produto'); page.locator('#search').dispatch_event('input'); page.wait_for_timeout(30)
        page.locator('#search').focus(); page.keyboard.press('ArrowDown'); page.wait_for_timeout(10)
        search_focus = page.evaluate("() => ({option:Boolean(document.activeElement?.matches?.('[data-suggest-product]')),activeDesc:document.querySelector('#search')?.getAttribute('aria-activedescendant')||''})")
        page.keyboard.press('Escape'); page.wait_for_timeout(10)
        search_closed = page.evaluate("() => ({hidden:document.querySelector('#searchSuggestions').hidden,focused:document.activeElement?.id==='search',expanded:document.querySelector('#search')?.getAttribute('aria-expanded')})")
        search_ok = search_focus["option"] and bool(search_focus["activeDesc"]) and search_closed["hidden"] and search_closed["focused"] and search_closed["expanded"] == 'false'
        if not search_ok: failures.append("search-keyboard: navegação de sugestões inconsistente")
        results.append({"scenario":"search-keyboard","status":"APROVADO" if search_ok else "REPROVADO","focus":search_focus,"closed":search_closed})

        # Termos/Privacidade usam camada exclusiva: não podem ficar empilhados
        # sobre produto/sacola/conta nem liberar o scroll enquanto outra camada
        # bloqueadora estiver ativa. O texto também deve preservar parágrafos.
        page.evaluate("(cfg) => { globalThis.__integrallPublicConfig = cfg; }", {
            "privacyText": "PRIVACIDADE\n\nLinha 1\nLinha 2",
            "termsText": "TERMOS\n\nItem A\nItem B",
            "returnsText": "TROCAS\n\nPrazo\nCondição",
        })
        page.add_script_tag(content=checkout_js); page.wait_for_timeout(80)
        page.evaluate("() => globalThis.__integrallApp.openProduct('audit-product-a',{updateHash:false,focus:false})"); page.wait_for_timeout(30)
        page.evaluate("() => document.querySelector('[data-legal=\"privacy\"]')?.click()"); page.wait_for_timeout(40)
        legal_open = page.evaluate("""() => {
          const modal=document.querySelector('#legalModal'),backdrop=document.querySelector('#legalModalBackdrop');
          return {
            productHidden:document.querySelector('#productDetails')?.hidden,
            legalOpen:modal?.classList.contains('open'),
            backdropOpen:backdrop?.classList.contains('open'),
            backdropHidden:backdrop?.hidden,
            backdropFilter:backdrop?getComputedStyle(backdrop).backdropFilter:'',
            overlayOpen:document.querySelector('#overlay')?.classList.contains('open'),
            bodyLocked:document.body.classList.contains('lock'),
            copy:document.querySelector('#legalCopy')?.textContent||''
          };
        }""")
        page.screenshot(path=str(out / "legal-modal-1024.png"), full_page=True)
        page.locator('#legalModalBackdrop').dispatch_event('click'); page.wait_for_timeout(30)
        legal_closed = page.evaluate("() => ({open:document.querySelector('#legalModal')?.classList.contains('open'),bodyLocked:document.body.classList.contains('lock'),backdropHidden:document.querySelector('#legalModalBackdrop')?.hidden})")
        legal_ok = legal_open["productHidden"] and legal_open["legalOpen"] and legal_open["backdropOpen"] and not legal_open["backdropHidden"] and legal_open["backdropFilter"] in ('none','') and not legal_open["overlayOpen"] and legal_open["bodyLocked"] and '\n\n' in legal_open["copy"] and not legal_closed["open"] and not legal_closed["bodyLocked"] and legal_closed["backdropHidden"]
        if not legal_ok: failures.append("legal-layering: termos/privacidade empilharam camada, perderam parágrafos ou deixaram scroll incoerente")
        results.append({"scenario":"legal-layering-and-multiline","status":"APROVADO" if legal_ok else "REPROVADO","open":legal_open,"closed":legal_closed})

        context.close()
        context=browser.new_context(viewport={"width":1440,"height":900},bypass_csp=True,reduced_motion="reduce")
        page=context.new_page(); page.route('https://integrall.test/**', lambda route: route.fulfill(status=200,content_type='image/png',body=transparent_png))
        page.set_content(html,wait_until="domcontentloaded")
        for css in styles:page.add_style_tag(content=css)
        page.add_script_tag(content=catalog_js);page.evaluate("products=>__integrallApp.setProducts(products)",products)
        page.evaluate("""() => {window.__postCount=0;window.__failCustomerLogout=true;window.IntegrallApi={request:async(path,options={})=>{
          if(path==='/api/account/session')return{authenticated:true,account:{email:'test@example.invalid',favorites:[],addresses:[]},csrfToken:'test-only-csrf'};
          if(path==='/api/account/orders')return{orders:[]};
          if(path==='/api/account/logout'){if(window.__failCustomerLogout)throw new Error('fixture network failure');return{ok:true};}
          if(path.includes('/reviews')&&options.method==='POST'){window.__postCount++;await new Promise(r=>setTimeout(r,120));return{message:'Avaliação recebida.'};}
          if(path.includes('/reviews'))return{summary:{count:0},reviews:[]};
          return{};
        }};}""")
        page.add_script_tag(content=commerce_js);page.wait_for_timeout(60)
        page.evaluate("() => __integrallApp.openProduct('audit-product-a',{updateHash:false,focus:false,variantId:'audit-a-v2'})")
        page.wait_for_timeout(40)
        direct_variant=page.locator('#modalVariant').input_value()=='audit-a-v2' and page.locator('#modalImage').get_attribute('src')==second
        page.locator('#modalGift').check();page.fill('#modalGiftMessage','Mensagem de presente');page.locator('#modalGiftMessage').press('ArrowLeft')
        text_arrows=page.locator('#modalImage').get_attribute('src')==second
        page.fill('#reviewTitle','Título do teste');page.fill('#reviewBody','Texto da avaliação')
        page.locator('#reviewForm').dispatch_event('submit');page.wait_for_timeout(180)
        review_success=page.locator('#reviewFeedback').inner_text()=='Avaliação recebida.' and page.locator('#reviewTitle').input_value()==''
        page.fill('#reviewTitle','Resposta de produto anterior');page.locator('#reviewForm').dispatch_event('submit')
        page.evaluate("() => {__integrallApp.openProduct('audit-product-b',{updateHash:false,focus:false});__integrallApp.openProduct('audit-product-a',{updateHash:false,focus:false});}")
        page.wait_for_timeout(180)
        stale_post=page.locator('#reviewFeedback').inner_text()=='' and not page.locator('#reviewForm button[type=submit]').is_disabled()
        for name,ok in [('direct-variant-image',direct_variant),('arrows-in-text-do-not-change-gallery',text_arrows),('review-async-form-reset',review_success),('review-stale-post-reopen',stale_post)]:
          results.append({'scenario':name,'status':'APROVADO' if ok else 'REPROVADO'})
          if not ok:failures.append(name)
        # Landscape, text-size and CSS zoom are simulations, not browser-native zoom.
        simulations = [(812,375,1),(1024,400,1)]
        if args.experimental_css_zoom:
          simulations += [(1440,900,1.25),(1440,900,1.5),(1440,900,2)]
        for width,height,zoom in simulations:
          page.set_viewport_size({'width':width,'height':height});page.evaluate('zoom=>document.body.style.zoom=String(zoom)',zoom);page.wait_for_timeout(40)
          reflow=page.evaluate("""() => ({overflow:document.documentElement.scrollWidth>innerWidth+1,below:document.querySelector('.product-info').getBoundingClientRect().top>=document.querySelector('.product-gallery').getBoundingClientRect().bottom-1})""")
          ok=not reflow['overflow'] and reflow['below'];name=f'layout-simulation-{width}x{height}-csszoom-{zoom}'
          results.append({'scenario':name,'status':'APROVADO' if ok else 'REPROVADO','metrics':reflow})
          if not ok:failures.append(name)
        page.evaluate('document.body.style.zoom=""');page.set_viewport_size({'width':1440,'height':900})
        page.locator('#openAccount').dispatch_event('click');page.wait_for_timeout(80)
        logout=page.get_by_role('button',name='Sair desta conta');logout.click();page.wait_for_timeout(30)
        customer_failure=page.locator('#accountLoginForm').count()==0 and logout.is_visible()
        page.evaluate('window.__failCustomerLogout=false');logout.click();page.wait_for_selector('#accountLoginForm')
        customer_success=page.locator('#accountLoginForm').is_visible()
        ok=customer_failure and customer_success
        results.append({'scenario':'customer-logout-failure-and-retry','status':'APROVADO' if ok else 'REPROVADO'})
        if not ok:failures.append('customer-logout-failure-and-retry')
        context.close(); browser.close()

    (out / "browser-regression.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {"status": "APROVADO" if not failures else "REPROVADO", "widths": len(widths), "testedWidths": widths, "failures": failures}
    (out / "browser-regression-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
