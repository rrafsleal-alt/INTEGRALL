import {readFile, readdir, stat, access} from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const failures = [];
const notes = [];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

async function auditHtml(file) {
  const html = await readFile(file, 'utf8');
  const rel = path.relative(root, file);
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map(match => match[1]);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length) failures.push(`${rel}: IDs HTML duplicados: ${[...new Set(duplicates)].join(', ')}`);
  if (/\son[a-z]+\s*=/i.test(html)) failures.push(`${rel}: handler JavaScript inline encontrado`);

  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] || '';
    const body = (match[2] || '').trim();
    if (/\bsrc\s*=/.test(attrs) || !body) continue;
    const type = (attrs.match(/\btype=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    if (!['application/json', 'application/ld+json'].includes(type)) failures.push(`${rel}: script executável inline encontrado`);
  }

  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["'](\/[^"']+)["']/gi)) {
    const ref = match[1].split(/[?#]/)[0];
    if (!/\.(?:js|css|svg|png|jpe?g|webp|avif)$/i.test(ref)) continue;
    try { await access(path.join(publicDir, ref.replace(/^\//, ''))); }
    catch { failures.push(`${rel}: referência local ausente: ${ref}`); }
  }
}

const indexPath = path.join(publicDir, 'index.html');
const indexStat = await stat(indexPath);
if (indexStat.size > 100_000) failures.push(`public/index.html ainda está grande: ${indexStat.size} bytes`);
else notes.push(`index.html: ${indexStat.size} bytes`);

const textFiles = (await walk(publicDir)).filter(file => /\.(html|js|css|json|svg)$/i.test(file));
for (const file of textFiles) {
  const text = await readFile(file, 'utf8');
  const rel = path.relative(root, file);
  if (/data:image\/(?:png|jpe?g|webp|avif);base64/i.test(text)) failures.push(`${rel}: imagem raster Base64 embutida`);
  if (/\badminApiToken\b/.test(text)) failures.push(`${rel}: adminApiToken exposto no diretório público`);
  if (/\b(?:MERCADO_PAGO_ACCESS_TOKEN|MERCADO_PAGO_WEBHOOK_SECRET|DATABASE_URL|ADMIN_API_TOKEN)\b/.test(text)) failures.push(`${rel}: nome de segredo de servidor exposto no diretório público`);
  if (/\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(/.test(text)) failures.push(`${rel}: padrão de execução dinâmica perigoso`);
  if (/localStorage[^\n]*(?:admin|token|customer|email|phone)|(?:admin|token|customer|email|phone)[^\n]*localStorage/i.test(text)) failures.push(`${rel}: dado sensível associado a localStorage`);
}

for (const html of ['index.html', 'admin.html']) await auditHtml(path.join(publicDir, html));

const apiClient = await readFile(path.join(publicDir, 'js', 'store', 'api.js'), 'utf8');
const serverSource = await readFile(path.join(root, 'server.js'), 'utf8');
if (!apiClient.includes('JSON.stringify({orderId, checkoutToken})')) failures.push('api.js: checkoutToken não é enviado ao backend');
if (!serverSource.includes('safeEqual(checkoutToken, order.checkoutToken)')) failures.push('server.js: checkoutToken não é validado em tempo constante');

const catalog = JSON.parse(await readFile(path.join(root, 'data', 'catalog.json'), 'utf8'));
for (const product of catalog.products || []) {
  for (const image of product.images || []) {
    if (!image.startsWith('/assets/')) continue;
    const target = path.join(publicDir, image.replace(/^\//, ''));
    try { await access(target); }
    catch { failures.push(`asset ausente para ${product.id}: ${image}`); }
  }
}

if (failures.length) {
  console.error('AUDIT FAIL');
  for (const item of failures) console.error(`- ${item}`);
  process.exit(1);
}
console.log('AUDIT OK');
for (const item of notes) console.log(`- ${item}`);
console.log(`- ${catalog.products?.length || 0} produtos; assets referenciados presentes`);
console.log(`- ${textFiles.length} arquivos públicos de texto auditados`);
