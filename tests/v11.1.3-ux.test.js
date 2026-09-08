import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const text = relative => readFile(path.join(root, relative), 'utf8');

test('detalhes usam rolagem do documento; outras camadas preservam fundo sem desfoque', async () => {
  const pkg = JSON.parse(await text('package.json'));
  const html = await text('public/index.html');
  const css = await text('public/css/store.css');
  const js = await text('public/js/store/catalog.js');
  assert.match(pkg.version, /^11\.1\.(?:[3-9]|\d{2,})$/);
  assert.match(html, new RegExp(`integrall-build\" content=\"public-v${pkg.version.replaceAll('.', '\\.')}[-]`));
  assert.match(css, /\.overlay\{[^}]*backdrop-filter:none[^}]*-webkit-backdrop-filter:none/s);
  assert.match(css, /\.product-details-inline\{[^}]*overflow:visible/s);
  assert.match(css, /\.product-details-body\{[^}]*overflow:visible/s);
  assert.doesNotMatch(js, /details\.scrollTop\s*=\s*0/);
  assert.doesNotMatch(js, /overlay\?\.addEventListener\('wheel'/);
  assert.doesNotMatch(js, /active\?\.id !== 'productDetails'/);
  assert.doesNotMatch(css, /\.overlay\{[^}]*backdrop-filter:blur/s);
});

test('cards usam quadro quadrado sem borda e preservam a imagem inteira com preenchimento visual', async () => {
  const css = await text('public/css/store.css');
  const premium = await text('public/css/premium-v104.css');
  const js = await text('public/js/store/catalog.js');
  const catalog = JSON.parse(await text('data/catalog.json'));
  assert.equal(catalog.settings.visual.layout.imageRatio, 'square');
  assert.equal(catalog.settings.visual.layout.imageFit, 'contain');
  assert.match(css, /\.card-image\{[^}]*border:0[^}]*aspect-ratio:1\/1/s);
  assert.match(css, /\.card-image-fill\{[^}]*object-fit:cover/s);
  assert.match(css, /\.card-image-main\{[^}]*object-fit:contain/s);
  assert.match(premium, /\.premium-catalog \.card-image\{aspect-ratio:1\/1!important;border:0!important/s);
  assert.match(js, /setSmartProductImage/);
});

test('carrossel funciona nos cards e no popup por controles, teclado e gesto horizontal', async () => {
  const html = await text('public/index.html');
  const js = await text('public/js/store/catalog.js');
  assert.match(html, /data-gallery-step="-1"[^>]*id="modalGalleryPrev"/);
  assert.match(html, /data-gallery-step="1"[^>]*id="modalGalleryNext"/);
  assert.match(js, /cardGallery\.dataset\.cardGalleryStep/);
  assert.match(js, /changeCardGallery/);
  assert.match(js, /changeModalGallery/);
  assert.match(js, /pointerdown/);
  assert.match(js, /pointerup/);
  assert.match(js, /Math\.abs\(dx\) < 38/);
  assert.match(js, /event\.key === 'ArrowLeft'/);
  assert.match(js, /event\.key === 'ArrowRight'/);
});

test('Admin evita rolagens aninhadas desnecessárias e encaminha roda da prévia ao painel', async () => {
  const css = await text('public/css/admin.css');
  const js = await text('public/js/admin.js');
  assert.match(css, /\.visual-editor-workspace\{[^}]*height:auto/s);
  assert.match(css, /\.visual-inspector-scroll\{[^}]*overflow:visible/s);
  assert.match(css, /\.visual-preview-column\{[^}]*overflow:visible/s);
  assert.doesNotMatch(css, /\.visual-inspector-scroll\{[^}]*overscroll-behavior:contain/s);
  assert.match(js, /doc\.addEventListener\('wheel'/);
  assert.match(js, /window\.scrollBy\(\{top:event\.deltaY/);
  assert.match(js, /event\.shiftKey/);
  assert.match(js, /imageRatio\|\|'square'/);
  assert.match(js, /imageFit\|\|'contain'/);
});

test('todas as referências públicas usam cache-busting da versão atual', async () => {
  const pkg = JSON.parse(await text('package.json'));
  for (const relative of ['public/index.html','public/admin.html','public/404.html','public/500.html']) {
    const html = await text(relative);
    const refs = [...html.matchAll(/(?:src|href)=["'](\/(?:css|js)\/[^"']+)["']/g)].map(match => match[1]);
    assert.deepEqual(refs.filter(value => !value.includes(`?v=${pkg.version}`)), [], relative);
  }
});
