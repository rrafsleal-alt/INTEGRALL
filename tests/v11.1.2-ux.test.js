import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const credential = ['159213', 'Rafs'].join('');
const text = relative => readFile(path.join(root, relative), 'utf8');

async function filesUnder(relative) {
  const dir = path.join(root, relative);
  const out = [];
  async function walk(current) {
    for (const entry of await readdir(current, {withFileTypes: true})) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

test('contratos herdados da v11.1.2 permanecem coerentes na versão atual', async () => {
  const pkg = JSON.parse(await text('package.json'));
  const server = await text('server.js');
  const html = await text('public/index.html');
  assert.match(pkg.version, /^11\.1\.(?:[2-9]|\d{2,})$/);
  assert.match(server, /const appVersion = String\(packageMetadata\.version/);
  assert.match(server, /version:\s*appVersion/);
  assert.match(html, new RegExp(`integrall-build\" content=\"public-v${pkg.version.replaceAll('.', '\\.')}[-]`));
});

test('detalhes do produto têm região única, ordem semântica e fluxo em coluna', async () => {
  const html = await text('public/index.html');
  const css = await text('public/css/store.css');
  const js = await text('public/js/store/catalog.js');
  assert.equal((html.match(/id="productDetails"/g) || []).length, 1);
  const region=html.match(/<section[^>]*id="productDetails"[^>]*>/i)?.[0];
  assert.match(region, /role="region"/);
  assert.doesNotMatch(region, /aria-modal/);
  assert.ok(html.indexOf('id="productGrid"') < html.indexOf('id="productDetails"'));
  assert.ok(html.indexOf('id="productDetails"') < html.indexOf('</main>'));
  assert.match(css, /\.product-details-inline\{[^}]*position:relative[^}]*overflow:visible/s);
  assert.match(css, /\.product-details-grid\{[^}]*grid-template-columns:minmax\(0,1fr\)/s);
  assert.match(css, /\.product-details-body\{[^}]*overflow:visible/s);
  assert.doesNotMatch(css, /\.product-details-inline[^}]*max-height:[^;}]*[dv]?vh/);
  assert.doesNotMatch(js, /layers\.open\(details/);
  assert.match(js, /details\.scrollIntoView/);
});

test('catálogo mantém todos os produtos acessíveis em páginas numeradas de 12 com imagens lazy', async () => {
  const html = await text('public/index.html');
  const js = await text('public/js/store/catalog.js');
  assert.doesNotMatch(html, /id="loadMoreProducts"/);
  assert.match(html, /id="catalogPagination"/);
  assert.match(js, /const PAGE_SIZE = 12/);
  assert.match(js, /items\.slice\(paging\.start, paging\.end\)/);
  assert.match(js, /const items = filteredProducts\(\)/);
  assert.match(js, /image.loading = 'lazy'/);
});

test('seleção múltipla da galeria é copiada antes de limpar o input', async () => {
  const html = await text('public/admin.html');
  const js = await text('public/js/admin.js');
  assert.match(html, /id="pfGalleryFiles"[^>]*multiple/i);
  const snapshot = js.indexOf("const files=[...(galleryFiles.files||[])]");
  const clear = js.indexOf("galleryFiles.value=''", snapshot);
  assert.ok(snapshot >= 0 && clear > snapshot, 'FileList deve ser convertido em Array antes de limpar o input');
  assert.match(js, /for\(let index=0;index<files\.length;index\+=1\)/);
  assert.match(js, /productImages\.push\(uploaded\.url\)/);
});


test('autenticação administrativa não possui cadeia de senha fallback', async () => {
  const source = await text('src/auth.js');
  const config = await text('src/config.js');
  const server = await text('server.js');
  assert.doesNotMatch(source, /fallbackPasswordHash|fallbackMatches|fallbackPromise/);
  assert.doesNotMatch(config, /adminFallbackPasswordHash/);
  assert.doesNotMatch(server, /fallbackPasswordHash/);
});

test('credencial inicial não aparece nos assets públicos nem nos atalhos Windows', async () => {
  const publicFiles = (await filesUnder('public')).filter(file => /\.(?:html|css|js|json|svg|webmanifest)$/i.test(file));
  const launchers = (await readdir(root)).filter(name => /\.bat$/i.test(name)).map(name => path.join(root, name));
  const leaks = [];
  for (const file of [...publicFiles, ...launchers]) {
    const value = await readFile(file, 'utf8');
    if (value.includes(credential)) leaks.push(path.relative(root, file));
  }
  assert.deepEqual(leaks, []);
});

test('catálogo entregue não contém IDs globais de variação repetidos', async () => {
  const catalog = JSON.parse(await text('data/catalog.json'));
  const ids = (catalog.products || []).flatMap(product => (product.variants || []).map(variant => variant.id));
  assert.equal(ids.length, new Set(ids).size);
});

test('deploy usa lockfile e desativa credencial inicial compartilhada', async () => {
  for (const file of ['render.yaml', 'render-free-test.yaml']) {
    const yaml = await text(file);
    assert.match(yaml, /buildCommand:\s*npm ci --omit=dev --no-audit --no-fund/);
    assert.match(yaml, /ADMIN_DEFAULT_LOGIN_ENABLED\s*\n\s*value:\s*"false"/);
  }
});


test('fallback embutido corresponde aos produtos visíveis e não habilita pagamento offline', async () => {
  const html = await text('public/index.html');
  const raw = JSON.parse(await text('data/catalog.json'));
  const pkg = JSON.parse(await text('package.json'));
  const match = html.match(/<script\s+id=["']buildData["']\s+type=["']application\/json["']>([\s\S]*?)<\/script>/i);
  assert.ok(match, '#buildData deve existir');
  const embedded = JSON.parse(match[1]);
  assert.equal(embedded.appVersion, pkg.version);
  const expectedIds = raw.products.filter(product => !product.deletedAt && product.hidden !== true).map(product => product.id);
  assert.deepEqual(embedded.products.map(product => product.id), expectedIds);
  assert.deepEqual(embedded.promotions, []);
  assert.deepEqual(embedded.commerce.paymentMethods, {whatsapp:false,pix:false,card:false});
  assert.match(embedded.settings.visual.assets.heroBackground, /\.webp$/);
});

test('imagem de fundo otimizada existe e é significativamente menor que o PNG social', async () => {
  const {stat} = await import('node:fs/promises');
  const png = await stat(path.join(root,'public/assets/brand/integrall-hero-cover.png'));
  const webp = await stat(path.join(root,'public/assets/brand/integrall-hero-cover.webp'));
  assert.ok(webp.size < png.size * 0.25, `WebP deveria ter menos de 25% do PNG (${webp.size}/${png.size})`);
});

test('CSS e JavaScript referenciados pelo HTML usam chave de versão para invalidar cache antigo', async () => {
  const pkg = JSON.parse(await text('package.json'));
  for (const relative of ['public/index.html', 'public/admin.html', 'public/404.html', 'public/500.html']) {
    const html = await text(relative);
    const refs = [...html.matchAll(/(?:src|href)=["'](\/(?:css|js)\/[^"']+)["']/g)].map(match => match[1]);
    const stale = refs.filter(value => !value.includes(`?v=${pkg.version}`));
    assert.deepEqual(stale, [], `${relative} contém assets sem versionamento: ${stale.join(', ')}`);
  }
});
