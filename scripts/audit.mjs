import {access, lstat, readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {normalizeCatalog} from '../src/catalog.js';
import {visibleCatalogProducts} from '../src/catalog-visibility.js';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const failures = [];
const notes = [];

async function walk(dir, {skip = new Set(['.git', 'node_modules'])} = {}) {
  const out = [];
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      failures.push(`${path.relative(root, full)}: link simbólico não permitido no pacote auditado`);
      continue;
    }
    if (entry.isDirectory()) out.push(...await walk(full, {skip}));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function auditCatalogAsset(reference, label) {
  const value = String(reference || '').trim();
  if (!value) return;
  if (/^https:\/\//i.test(value)) return;
  if (value.startsWith('/media/products/')) {
    const id = value.slice('/media/products/'.length);
    if (!/^(?:media|product-image)-[A-Za-z0-9-]{6,160}$/.test(id) || !await exists(path.join(root, 'data', 'media-seed', `${id}.json`))) failures.push(`${label}: mídia sem cópia de publicação: ${value}`);
    return;
  }
  if (!value.startsWith('/assets/')) {
    failures.push(`${label}: referência de imagem não permitida: ${value}`);
    return;
  }
  const target = path.join(publicDir, value.replace(/^\//, ''));
  if (!await exists(target)) failures.push(`${label}: asset local ausente: ${value}`);
  else if ((await stat(target)).size === 0) failures.push(`${label}: asset local vazio: ${value}`);
}

async function auditHtml(file) {
  const html = await readFile(file, 'utf8');
  const rel = path.relative(root, file);
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) failures.push(`${rel}: IDs HTML duplicados: ${[...new Set(duplicates)].join(', ')}`);
  if (/\son[a-z]+\s*=/i.test(html)) failures.push(`${rel}: handler JavaScript inline encontrado`);

  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] || '';
    const body = (match[2] || '').trim();
    if (/\bsrc\s*=/.test(attrs) || !body) continue;
    const type = (attrs.match(/\btype=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    if (!['application/json', 'application/ld+json'].includes(type)) failures.push(`${rel}: script executável inline encontrado`);
    if (type === 'application/json') {
      try { JSON.parse(body); } catch { failures.push(`${rel}: JSON embutido inválido`); }
    }
  }

  for (const match of html.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)=["'](\/[^"']+)["']/gi)) {
    const ref = match[1].split(/[?#]/)[0];
    if (!/\.(?:js|css|svg|png|jpe?g|webp|avif|webmanifest)$/i.test(ref)) continue;
    if (!await exists(path.join(publicDir, ref.replace(/^\//, '')))) failures.push(`${rel}: referência local ausente: ${ref}`);
  }

  for (const match of html.matchAll(/<a\b([^>]*target=["']_blank["'][^>]*)>/gi)) {
    const attrs = match[1];
    if (!/\brel=["'][^"']*\bnoopener\b/i.test(attrs)) failures.push(`${rel}: link target=_blank sem rel=noopener`);
  }
  return html;
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const version = String(packageJson.version || '');
if (!/^\d+\.\d+\.\d+$/.test(version)) failures.push('package.json: versão semântica inválida');
if (packageLock.version !== version || packageLock.packages?.['']?.version !== version) failures.push('package-lock.json: versão raiz não corresponde ao package.json');

const indexPath = path.join(publicDir, 'index.html');
const indexStat = await stat(indexPath);
notes.push(`index.html: ${indexStat.size} bytes (inclui o catálogo visual completo)`);

const indexHtml = await auditHtml(indexPath);
const markupOnly = indexHtml.replace(/(<script\s+id=["']buildData["']\s+type=["']application\/json["']>)[\s\S]*?(<\/script>)/i, '$1$2');
if (Buffer.byteLength(markupOnly) > 100_000) failures.push('public/index.html: marcação sem catálogo excede 100 KB');
if (indexStat.size > 5_000_000) failures.push('public/index.html: catálogo visual excede 5 MB');
await auditHtml(path.join(publicDir, 'admin.html'));
if (!indexHtml.includes(`public-v${version}-`)) failures.push(`public/index.html: integrall-build não corresponde à versão ${version}`);
const detailCount = (indexHtml.match(/\bid=["']productDetails["']/g) || []).length;
if (detailCount !== 1) failures.push(`public/index.html: esperado exatamente um #productDetails; encontrado ${detailCount}`);
if (/\bid=["']productModal["']/.test(indexHtml)) failures.push('public/index.html: modal lateral legado #productModal ainda existe');
const gridPosition = indexHtml.indexOf('id="productGrid"');
const detailsPosition = indexHtml.indexOf('id="productDetails"');
const footerPosition = indexHtml.indexOf('<footer');
const mainEnd = indexHtml.indexOf('</main>');
if (!(gridPosition >= 0 && gridPosition < detailsPosition && detailsPosition < mainEnd && mainEnd < footerPosition)) failures.push('public/index.html: detalhes devem seguir o catálogo dentro de main, antes do rodapé');
const detailTag = indexHtml.match(/<section\b[^>]*\bid=["']productDetails["'][^>]*>/i)?.[0] || '';
if (!/role=["']region["']/i.test(detailTag) || !/aria-labelledby=["']modalName["']/i.test(detailTag) || /aria-modal/i.test(detailTag)) failures.push('public/index.html: #productDetails deve ser uma região nomeada, não um diálogo modal');
if (/\bid=["']loadMoreProducts["']/.test(indexHtml)) failures.push('public/index.html: o catálogo deve exibir todos os resultados sem carregar mais');

const css = await readFile(path.join(publicDir, 'css', 'store.css'), 'utf8');
const detailRules = [...css.matchAll(/\.product-details-inline\s*\{([^}]*)\}/g)].map(match => match[1]);
if (!detailRules.some(rule => /position\s*:\s*(?:relative|static)/.test(rule) && /overflow\s*:\s*visible/.test(rule))) failures.push('store.css: detalhes devem permanecer no fluxo normal, com altura livre');
if (detailRules.some(rule => /position\s*:\s*(?:fixed|absolute|sticky)|(?:max-)?height\s*:\s*[^;}]*(?:vh|dvh)|transform\s*:\s*(?!none)/.test(rule))) failures.push('store.css: posicionamento modal ou limite de altura reapareceu nos detalhes');
const gridRules = [...css.matchAll(/\.product-details-grid\s*\{([^}]*)\}/g)].map(match => match[1]);
if (!gridRules.length || gridRules.some(rule => !/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/.test(rule))) failures.push('store.css: todas as regras de detalhes devem manter uma única coluna');
if (/(?:^|\})\s*body\s*\{[^}]*min-width\s*:\s*(?:3[2-9][0-9]|[4-9][0-9]{2,}|[1-9][0-9]{3,})px/s.test(css)) failures.push('store.css: body possui largura mínima incompatível com telas pequenas');
if (/(?:^|\})\s*body\s*\{[^}]*overflow-x\s*:\s*hidden/s.test(css)) failures.push('store.css: overflow-x:hidden global mascara problemas de layout');
const catalogSource = await readFile(path.join(publicDir, 'js', 'store', 'catalog.js'), 'utf8');
if (/layers\.open\(details|forwardProductPopupWheel/.test(catalogSource)) failures.push('catalog.js: detalhes não devem bloquear o fundo como um modal');
if (!/prefers-reduced-motion/.test(catalogSource) || !/clearProductDetailsState/.test(catalogSource)) failures.push('catalog.js: preferência de movimento e limpeza entre produtos devem ser preservadas');
if (!/const items = filteredProducts\(\)/.test(catalogSource) || /CATALOG_PAGE_SIZE|allItems\.slice\(0, visible\)/.test(catalogSource)) failures.push('catalog.js: todos os resultados devem aparecer, sem limite inicial ocultando produtos');

const serverSource = await readFile(path.join(root, 'server.js'), 'utf8');
if (!/packageMetadata[\s\S]*appVersion/.test(serverSource) || !/version:\s*appVersion/.test(serverSource)) failures.push('server.js: versão da API não deriva do package.json');
const apiClient = await readFile(path.join(publicDir, 'js', 'store', 'api.js'), 'utf8');
if (!apiClient.includes('JSON.stringify({orderId, checkoutToken})')) failures.push('api.js: checkoutToken não é enviado ao backend');
if (!serverSource.includes('safeEqual(checkoutToken, order.checkoutToken)')) failures.push('server.js: checkoutToken não é validado em tempo constante');

const textFiles = (await walk(publicDir)).filter(file => /\.(?:html|js|css|json|svg|webmanifest)$/i.test(file));
for (const file of textFiles) {
  const text = await readFile(file, 'utf8');
  const rel = path.relative(root, file);
  if (/data:image\/(?:png|jpe?g|webp|avif);base64/i.test(text)) failures.push(`${rel}: imagem raster Base64 embutida`);
  if (/\badminApiToken\b/.test(text)) failures.push(`${rel}: adminApiToken exposto no diretório público`);
  if (/\b(?:MERCADO_PAGO_ACCESS_TOKEN|MERCADO_PAGO_WEBHOOK_SECRET|DATABASE_URL|ADMIN_API_TOKEN|ADMIN_PASSWORD_HASH|ADMIN_SESSION_SECRET)\b/.test(text)) failures.push(`${rel}: nome de segredo de servidor exposto no diretório público`);
  if (/\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(/.test(text)) failures.push(`${rel}: padrão de execução dinâmica perigoso`);
  if (/localStorage[^\n]*(?:admin|token|customer|email|phone)|(?:admin|token|customer|email|phone)[^\n]*localStorage/i.test(text)) failures.push(`${rel}: dado sensível associado a localStorage`);
  for (const match of text.matchAll(/url\((['"]?)(\/[^)'"?#]+)\1\)/gi)) {
    const ref = match[2];
    if (!await exists(path.join(publicDir, ref.replace(/^\//, '')))) failures.push(`${rel}: asset CSS ausente: ${ref}`);
  }
}

const rawCatalog = JSON.parse(await readFile(path.join(root, 'data', 'catalog.json'), 'utf8'));
let embeddedCatalog = null;
try {
  const embeddedText = indexHtml.match(/<script\s+id=["']buildData["']\s+type=["']application\/json["']>([\s\S]*?)<\/script>/i)?.[1] || '';
  embeddedCatalog = JSON.parse(embeddedText);
} catch (error) {
  failures.push(`public/index.html: #buildData inválido: ${error.message}`);
}
let catalog;
try { catalog = normalizeCatalog(rawCatalog); }
catch (error) { failures.push(`data/catalog.json: ${error.message}`); catalog = {products: []}; }
if (embeddedCatalog) {
  if (embeddedCatalog.appVersion !== version) failures.push(`public/index.html: #buildData appVersion não corresponde a ${version}`);
  if (embeddedCatalog.version !== catalog.version) failures.push('public/index.html: #buildData usa versão de schema divergente do catálogo');
  const expectedFallback = visibleCatalogProducts(catalog);
  const actualFallback = Array.isArray(embeddedCatalog.products) ? embeddedCatalog.products : [];
  if (JSON.stringify(actualFallback) !== JSON.stringify(expectedFallback)) failures.push('public/index.html: catálogo embutido está desatualizado em relação aos produtos visíveis');
  if ((embeddedCatalog.promotions || []).length) failures.push('public/index.html: fallback não deve embutir promoções potencialmente desatualizadas');
  if (Object.values(embeddedCatalog.commerce?.paymentMethods || {}).some(Boolean)) failures.push('public/index.html: fallback não deve habilitar pagamentos sem a API');
}
const productIds = new Set();
const productSlugs = new Set();
const variantIds = new Set();
let variantCount = 0;
let galleryCount = 0;
let variantImageAssignments = 0;
for (const [key, image] of Object.entries(catalog.settings?.visual?.assets || {})) {
  await auditCatalogAsset(image, `catálogo visual.${key}`);
}
for (const [productIndex, product] of (catalog.products || []).entries()) {
  const label = product.id || `produto ${productIndex + 1}`;
  if (!product.id || productIds.has(product.id)) failures.push(`catálogo: ID de produto ausente/duplicado: ${label}`);
  productIds.add(product.id);
  if (!product.slug || productSlugs.has(product.slug)) failures.push(`catálogo: slug ausente/duplicado: ${product.slug || label}`);
  productSlugs.add(product.slug);
  const images = Array.isArray(product.images) ? product.images : [];
  if (images.length > 12) failures.push(`catálogo: ${label} excede 12 imagens`);
  galleryCount += images.length;
  for (const image of images) {
    await auditCatalogAsset(image, `catálogo produto ${label}`);
  }
  for (const variant of product.variants || []) {
    variantCount += 1;
    if (!variant.id || variantIds.has(variant.id)) failures.push(`catálogo: ID global de variante ausente/duplicado: ${variant.id || label}`);
    variantIds.add(variant.id);
    if (variant.image) {
      variantImageAssignments += 1;
      if (!images.includes(variant.image)) failures.push(`catálogo: foto da variação ${variant.id} não pertence à galeria de ${label}`);
    }
  }
}

const projectFiles = await walk(root);
for (const file of projectFiles) {
  const info = await lstat(file);
  if (info.size === 0 && !/\.gitkeep$/i.test(file)) failures.push(`${path.relative(root, file)}: arquivo vazio inesperado`);
}
if (await exists(path.join(root, '.env'))) failures.push('.env real não pode estar no pacote');

if (failures.length) {
  console.error('AUDIT FAIL');
  for (const item of [...new Set(failures)]) console.error(`- ${item}`);
  process.exit(1);
}
console.log('AUDIT OK');
for (const item of notes) console.log(`- ${item}`);
console.log(`- versão ${version}; ${catalog.products?.length || 0} produtos; ${variantCount} variações; ${galleryCount} referências de imagem`);
console.log(`- ${variantImageAssignments} variações possuem foto específica no catálogo entregue`);
console.log(`- ${textFiles.length} arquivos públicos de texto e ${projectFiles.length} arquivos do pacote auditados`);
