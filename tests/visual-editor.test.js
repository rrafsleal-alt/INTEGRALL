import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const adminHtml = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
const adminJs = await readFile(new URL('../public/js/admin.js', import.meta.url), 'utf8');
const adminCss = await readFile(new URL('../public/css/admin.css', import.meta.url), 'utf8');
const storeHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const storeJs = await readFile(new URL('../public/js/store/catalog.js', import.meta.url), 'utf8');
const ageGateJs = await readFile(new URL('../public/js/store/age-gate.js', import.meta.url), 'utf8');
const securityJs = await readFile(new URL('../src/security.js', import.meta.url), 'utf8');

test('Admin usa editor visual lado a lado e produto não abre em dialog/modal', () => {
  assert.match(adminHtml, /id="sitePreview"[^>]+adminPreview=1/);
  assert.match(adminHtml, /class="visual-editor-workspace"/);
  assert.match(adminHtml, /id="productDialog" class="product-editor-inline"/);
  assert.doesNotMatch(adminHtml, /<dialog\b/i);
  assert.match(adminHtml, /id="orderDialog" class="panel order-detail-inline" hidden/);
  assert.match(adminCss, /grid-template-columns:minmax\(330px,400px\) minmax\(0,1fr\)/);
});

test('prévia pode ser clicada para selecionar e editar elementos reais da loja', () => {
  assert.match(adminJs, /function installPreviewBridge\(/);
  assert.match(adminJs, /function selectionFromPreviewTarget\(/);
  assert.match(adminJs, /selectVisualElement\(selection\)/);
  assert.match(adminJs, /visualMoveUp/);
  assert.match(adminJs, /visualHideElement/);
  assert.match(adminJs, /visualDeleteElement/);
});

test('editor de foto oferece recorte, arrastar, zoom, formato e exportação antes do upload', () => {
  for (const id of ['pfCropCanvas','pfCropRatio','pfCropZoom','pfCropReset','pfEditCurrentImage']) {
    assert.match(adminHtml, new RegExp(`id="${id}"`));
  }
  assert.match(adminJs, /pointermove/);
  assert.match(adminJs, /exportCroppedProductImage/);
  assert.match(adminJs, /canvas\.toBlob/);
});

test('preview same-origin é permitida sem liberar enquadramento por sites externos', () => {
  assert.match(securityJs, /X-Frame-Options', 'SAMEORIGIN'/);
  assert.match(securityJs, /frame-ancestors 'self'/);
  assert.match(storeHtml, /frame-ancestors 'self'/);
  assert.doesNotMatch(securityJs, /frame-ancestors \*/);
});

test('modo de preview ignora age gate e mantém produtos ocultos fora da grade', () => {
  assert.match(ageGateJs, /adminPreview/);
  assert.match(storeJs, /product\.hidden === true/);
  assert.match(storeJs, /filterBlock/);
});
