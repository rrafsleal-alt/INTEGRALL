import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('v11.1.4 coordena camadas em vez de empilhar conta, produto e sacola', async () => {
  const [catalog, commerce, checkout] = await Promise.all([
    read('public/js/store/catalog.js'), read('public/js/store/commerce-v111.js'), read('public/js/store/checkout.js')
  ]);
  assert.match(catalog, /function closeCart\(/);
  assert.match(catalog, /openCart, closeCart,/);
  assert.match(commerce, /app\.closeProductDetails\?\.\(\{returnFocus:false,updateHistory:true\}\)/);
  assert.match(commerce, /app\.closeCart\?\.\(\{returnFocus:false\}\)/);
  assert.match(commerce, /accountFocusables\(\)/);
  assert.match(checkout, /const app = globalThis\.__integrallApp/);
  assert.match(checkout, /app\?\.closeCart\?\.\(\{returnFocus: false\}\)/);
});

test('favorito solicitado antes do login é preservado e aplicado após autenticar', async () => {
  const commerce = await read('public/js/store/commerce-v111.js');
  assert.match(commerce, /pendingFavoriteId/);
  assert.match(commerce, /async function applyPendingFavorite\(/);
  assert.match(commerce, /await applyPendingFavorite\(\)/);
});

test('busca inteligente expõe combobox e navegação por setas/Escape', async () => {
  const [html, catalog] = await Promise.all([read('public/index.html'), read('public/js/store/catalog.js')]);
  assert.match(html, /id="search"[^>]*role="combobox"|role="combobox"[^>]*id="search"/);
  assert.match(catalog, /function moveSearchSuggestion\(/);
  assert.match(catalog, /aria-activedescendant/);
  assert.match(catalog, /event\.key==='ArrowDown'/);
  assert.match(catalog, /closeSearchSuggestions\(\{focusInput:true\}\)/);
});

test('auditoria de catálogo do ZIP não depende obrigatoriamente dos PDFs-fonte', async () => {
  const tool = await read('tools/audit_products.py');
  assert.match(tool, /def audit_packaged_delivery\(\):/);
  assert.match(tool, /NAO_EXECUTADO_NO_ZIP/);
  assert.match(tool, /full_source_audit_available/);
});

test('smoke de produção valida detalhes em fluxo e uma coluna', async () => {
  const smoke = await read('scripts/production-browser-smoke.py');
  assert.match(smoke, /normalFlow/);
  assert.match(smoke, /singleDetails/);
  assert.match(smoke, /"normalFlow"/);
  assert.match(smoke, /"oneColumn"/);
});
