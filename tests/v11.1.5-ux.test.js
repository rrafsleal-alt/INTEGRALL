import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cleanMultilineText, normalizeCatalog} from '../src/catalog.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('textos legais preservam quebras de linha sem aceitar controles perigosos', () => {
  assert.equal(cleanMultilineText('Título\r\n\r\nLinha 1\u0000\nLinha 2'), 'Título\n\nLinha 1\nLinha 2');
  const catalog = normalizeCatalog({commerce:{
    privacyText:'PRIVACIDADE\n\nLinha 1\nLinha 2',
    termsText:'TERMOS\n\nItem A\nItem B',
    returnsText:'TROCAS\n\nPrazo\nCondição'
  }});
  assert.equal(catalog.commerce.privacyText, 'PRIVACIDADE\n\nLinha 1\nLinha 2');
  assert.equal(catalog.commerce.termsText, 'TERMOS\n\nItem A\nItem B');
  assert.equal(catalog.commerce.returnsText, 'TROCAS\n\nPrazo\nCondição');
});

test('modais legais e de pedido usam backdrop próprio e coordenador único de camadas', async () => {
  const [checkout, css, commerce] = await Promise.all([
    read('public/js/store/checkout.js'), read('public/css/checkout.css'), read('public/js/store/commerce-v111.js')
  ]);
  assert.match(checkout, /function closeStoreLayers\(/);
  assert.match(checkout, /function ensureStandaloneBackdrop\(/);
  assert.match(checkout, /function setStandaloneModalState\(/);
  assert.match(checkout, /ensureStandaloneBackdrop\('legalModalBackdrop'/);
  assert.match(checkout, /ensureStandaloneBackdrop\('orderStatusModalBackdrop'/);
  assert.match(checkout, /closeStoreLayers\(\{keep: 'legal'\}\)/);
  assert.match(checkout, /closeStoreLayers\(\{keep: 'order'\}\)/);
  assert.match(checkout, /cleanMultilineText\(merged\.privacyText/);
  assert.match(commerce, /integrall:close-account/);
  assert.match(css, /\.standalone-modal-backdrop\{/);
  assert.match(css, /backdrop-filter:none/);
});

test('fechar uma camada autônoma não remove o lock se outra camada bloqueadora continuar aberta', async () => {
  const checkout = await read('public/js/store/checkout.js');
  assert.match(checkout, /function blockingLayerOpen\(\)/);
  assert.match(checkout, /document\.body\.classList\.toggle\('lock', blockingLayerOpen\(\)\)/);
  assert.doesNotMatch(checkout, /legalModal[\s\S]{0,1200}document\.body\.classList\.remove\('lock'\)/);
  assert.doesNotMatch(checkout, /orderStatusModal[\s\S]{0,1600}document\.body\.classList\.remove\('lock'\)/);
});

test('fallback público embutido mantém os parágrafos dos textos legais', async () => {
  const html = await read('public/index.html');
  const match = html.match(/<script id="buildData" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, '#buildData ausente');
  const embedded = JSON.parse(match[1]);
  assert.match(embedded.commerce.privacyText, /POLÍTICA DE PRIVACIDADE\n\n/);
  assert.ok((embedded.commerce.termsText.match(/\n/g) || []).length >= 2);
  assert.ok((embedded.commerce.returnsText.match(/\n/g) || []).length >= 2);
});
