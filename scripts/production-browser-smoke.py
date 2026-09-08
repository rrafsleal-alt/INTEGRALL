#!/usr/bin/env python3
"""Serve e valida o build estático de produção da INTEGRALL v11.1.6.

O teste usa ``dist/public`` com fallback para ``/produto/<slug>`` e confirma
detalhes em fluxo: rota direta abre uma região única abaixo da galeria
com rolagem do documento, sem overflow horizontal, com carrinho, busca e assets funcionais. A API
é respondida com 503 de propósito para exercitar o catálogo embutido.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

WIDTHS = (320, 768, 1440)


class SpaHandler(SimpleHTTPRequestHandler):
    server_version = "IntegrallAudit/1.0"

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            payload = json.dumps({"error": "API indisponível neste teste estático"}).encode("utf-8")
            self.send_response(503)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        relative = unquote(parsed.path.lstrip("/"))
        candidate = (Path(self.directory) / relative).resolve()
        root = Path(self.directory).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            self.send_error(403)
            return

        if parsed.path == "/" or parsed.path.startswith("/produto/"):
            candidate = root / "index.html"

        if not candidate.is_file():
            self.send_error(404)
            return
        content = candidate.read_bytes()
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") else content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("dist/public"))
    parser.add_argument("--out", type=Path, default=Path("docs/evidencias-v11.1.6/build-http"))
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    args = parser.parse_args()

    root = args.root.resolve()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    if not (root / "index.html").is_file():
        raise SystemExit(f"ERRO: build público ausente em {root}; execute npm run build:production")

    handler = lambda *a, **kw: SpaHandler(*a, directory=str(root), **kw)  # noqa: E731
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"

    results: list[dict[str, Any]] = []
    failures: list[str] = []
    environment_error: str | None = None
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=args.chromium,
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
            )
            for width in WIDTHS:
                context = browser.new_context(viewport={"width": width, "height": 900}, device_scale_factor=1)
                context.add_init_script(
                    "localStorage.setItem('integrall_age_verified_v1', JSON.stringify({ok:true,at:new Date().toISOString()}));"
                )
                page = context.new_page()
                console_errors: list[str] = []
                bad_assets: list[str] = []
                page.on("console", lambda msg, bucket=console_errors: bucket.append(msg.text) if msg.type == "error" else None)
                page.on("pageerror", lambda error, bucket=console_errors: bucket.append(f"pageerror: {error}"))

                def response_seen(response: Any) -> None:
                    path = urlparse(response.url).path
                    if response.status >= 400 and not path.startswith("/api/"):
                        bad_assets.append(f"{response.status} {path}")

                page.on("response", response_seen)
                page.goto(f"{base}/produto/suco-integral-de-uva-bordo", wait_until="networkidle", timeout=20_000)
                page.wait_for_function("globalThis.__integrallApp && globalThis.__integrallApp.getState().products.length === 227")
                page.wait_for_function("document.querySelector('#productDetails') && !document.querySelector('#productDetails').hidden")

                initial = page.evaluate(
                    """() => {
                      const app=globalThis.__integrallApp;
                      const details=document.querySelector('#productDetails');
                      const rect=details.getBoundingClientRect();
                      return {
                        products:app.getState().products.length,
                        productName:document.querySelector('#modalName')?.textContent,
                        activeId:app.getState().activeId,
                        detailsCount:document.querySelectorAll('#productDetails').length,
                        legacyModalCount:document.querySelectorAll('#productModal').length,
                        detailsHidden:details.hidden,
                        detailsOpen:details.classList.contains('open'),
                        detailsPosition:getComputedStyle(details).position,
                        popupWithinViewport:rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1,
                        belowGallery: document.querySelector('.product-info').getBoundingClientRect().top >= document.querySelector('.product-gallery').getBoundingClientRect().bottom - 1,
                        columns: getComputedStyle(document.querySelector('.product-details-grid')).gridTemplateColumns.split(' ').length,
                        bodyLocked:document.body.classList.contains('lock'),
                        overlayOpen:document.querySelector('#overlay')?.classList.contains('open') || false,
                        horizontalOverflow:document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
                        canonical:document.querySelector('link[rel=canonical]')?.href || '',
                        title:document.title,
                        ageGate:Boolean(document.querySelector('#ageGate')),
                      };
                    }"""
                )

                page.locator("#productDetails").screenshot(path=str(out / f"build-detalhes-{width}.png"))
                variant_options = page.locator("#modalVariant option").count()
                if variant_options > 1:
                    page.select_option("#modalVariant", index=1)
                    page.locator("#modalVariant").dispatch_event("change")
                selected_variant = page.locator("#modalVariant").input_value()
                displayed_price = page.locator("#modalPrice").inner_text().strip()
                page.locator("#modalAdd").click()
                page.wait_for_function("document.querySelector('#cartCount')?.textContent === '1'")
                cart = page.evaluate(
                    """() => ({
                      count:document.querySelector('#cartCount')?.textContent,
                      lines:globalThis.__integrallApp.cartDetails().length,
                      quantity:globalThis.__integrallApp.cartDetails()[0]?.qty || 0,
                      variantId:globalThis.__integrallApp.cartDetails()[0]?.variant?.id || '',
                      drawerOpen:document.querySelector('#cartDrawer')?.classList.contains('open') || false
                    })"""
                )

                page.locator("#cartDrawer .close-ui").first.click()
                page.evaluate("() => globalThis.__integrallApp.closeProductDetails({returnFocus:false,updateHistory:false})")
                page.evaluate("() => globalThis.__integrallApp.navigate('catalogo',{historyMode:'replace'})")
                page.locator("#search").fill("uva até 30")
                page.locator("#search").dispatch_event("input")
                page.wait_for_timeout(80)
                search = page.evaluate(
                    """() => ({
                      resultCount:document.querySelectorAll('#productGrid [data-details]').length,
                      suggestionCount:document.querySelectorAll('#searchSuggestions [data-suggest-product]').length,
                      label:document.querySelector('#resultCount')?.textContent || ''
                    })"""
                )

                screenshot = out / f"build-producao-produto-real-{width}.png"
                page.locator("#catalogPage").screenshot(path=str(screenshot), full_page=True)

                checks = {
                    "allEmbeddedProducts": initial["products"] == 227,
                    "directProductRoute": initial["productName"] == "Suco Integral de Uva bordô" and bool(initial["activeId"]),
                    "singleDetails": initial["detailsCount"] == 1 and initial["legacyModalCount"] == 0,
                    "normalFlow": initial["detailsOpen"] and not initial["detailsHidden"] and initial["detailsPosition"] in ("relative", "static"),
                    "oneColumn": initial["columns"] == 1 and initial["belowGallery"],
                    "documentScrollUnlocked": not initial["bodyLocked"] and not initial["overlayOpen"],
                    "noHorizontalOverflow": not initial["horizontalOverflow"],
                    "noAgeGateAfterRemember": not initial["ageGate"],
                    "canonicalRoute": initial["canonical"].endswith("/produto/suco-integral-de-uva-bordo"),
                    "variantSelectable": variant_options <= 1 or bool(selected_variant),
                    "priceRendered": "R$" in displayed_price,
                    "cartAdd": cart["count"] == "1" and cart["lines"] == 1 and cart["quantity"] == 1,
                    "variantPreservedInCart": variant_options <= 1 or cart["variantId"] == selected_variant,
                    "semanticSearch": search["resultCount"] >= 1 and search["suggestionCount"] >= 1,
                    "assetsHealthy": not bad_assets,
                    "noConsoleErrors": not console_errors,
                }
                failed = [name for name, ok in checks.items() if not ok]
                if failed:
                    failures.append(f"{width}px: {', '.join(failed)}")
                results.append(
                    {
                        "width": width,
                        "checks": checks,
                        "initial": initial,
                        "variantOptions": variant_options,
                        "selectedVariant": selected_variant,
                        "displayedPrice": displayed_price,
                        "cart": cart,
                        "search": search,
                        "badAssets": bad_assets,
                        "consoleErrors": console_errors,
                        "screenshot": screenshot.name,
                    }
                )
                context.close()
            browser.close()
    except PlaywrightError as error:
        environment_error = str(error)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    if environment_error:
        report = {
            "status": "NÃO EXECUTADO",
            "scope": "build estático servido por HTTP em Chromium",
            "reason": environment_error,
            "risk": "A navegação HTTP local do build não pôde ser exercitada pelo navegador deste ambiente.",
            "howToRun": "npm run build:production && npm run test:browser:production",
            "widths": list(WIDTHS),
            "results": results,
        }
        (out / "production-browser-smoke.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("PRODUCTION BROWSER SMOKE NÃO EXECUTADO")
        print(f"- motivo: {environment_error.splitlines()[0]}")
        return 2

    report = {
        "status": "APROVADO" if not failures else "REPROVADO",
        "scope": "build estático servido por HTTP; API externa intencionalmente indisponível",
        "widths": list(WIDTHS),
        "results": results,
        "failures": failures,
    }
    (out / "production-browser-smoke.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if failures:
        print("PRODUCTION BROWSER SMOKE FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print(f"PRODUCTION BROWSER SMOKE OK - {len(WIDTHS)}/{len(WIDTHS)} larguras; build servido por HTTP")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
