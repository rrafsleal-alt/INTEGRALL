import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'public'));
const dist = path.dirname(root);
const packageInfo = JSON.parse(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
const expectedBuildMarker = `public-v${String(packageInfo.version || '')}-`;
const types = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.webp', 'image/webp'], ['.png', 'image/png'], ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8']
]);

function safeFile(urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const candidate = path.resolve(root, decoded);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://local.test');
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(503, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify({error: 'API desativada no smoke estático'}));
      return;
    }
    let file = safeFile(url.pathname);
    if (!file) { res.writeHead(403); res.end('forbidden'); return; }
    let isFile = false;
    try { isFile = (await stat(file)).isFile(); } catch {}
    if (url.pathname === '/' || url.pathname.startsWith('/produto/')) file = path.join(root, 'index.html');
    else if (url.pathname === '/admin') file = path.join(root, 'admin.html');
    else if (!isFile) {res.writeHead(404);res.end('not found');return;}
    const info = await stat(file);
    res.writeHead(200, {'Content-Type': types.get(path.extname(file).toLowerCase()) || 'application/octet-stream', 'Content-Length': info.size});
    createReadStream(file).pipe(res);
  } catch (error) {
    res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end(String(error?.message || error));
  }
});

function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function ensure(condition, message) { if (!condition) throw new Error(message); }

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;

try {
  const checks = [
    ['/', text => text.includes(expectedBuildMarker) && text.includes('id="productDetails"')],
    ['/produto/suco-integral-de-uva-bordo', text => text.includes('id="buildData"') && text.includes('suco-integral-de-uva-bordo')],
    ['/admin.html', text => text.includes('id="loginForm"') && text.includes('Administração INTEGRALL')],
    ['/css/store.css', text => text.includes('.product-details-inline') && text.includes('.product-details-grid{display:grid;grid-template-columns:minmax(0,1fr)') && text.includes('.catalog-pagination')],
    ['/js/store/catalog.js', text => text.includes('function openProduct') && text.includes('integrall:product-closed') && text.includes('const items = filteredProducts()') && !text.includes('CATALOG_PAGE_SIZE')],
  ];
  for (const [route, validate] of checks) {
    const response = await fetch(`${base}${route}`);
    ensure(response.status === 200, `${route}: HTTP ${response.status}`);
    const body = await response.text();
    ensure(validate(body), `${route}: conteúdo esperado não encontrado`);
  }

  const image = await fetch(`${base}/assets/products/01-suco-integral-de-uva-bord.webp`);
  ensure(image.status === 200, `imagem real: HTTP ${image.status}`);
  ensure((image.headers.get('content-type') || '').startsWith('image/webp'), 'imagem real: MIME incorreto');
  ensure((await image.arrayBuffer()).byteLength > 1_000, 'imagem real: arquivo vazio ou truncado');

  const api = await fetch(`${base}/api/catalog`);
  ensure(api.status === 503, `API isolada deveria responder 503, recebeu ${api.status}`);
  ensure((api.headers.get('cache-control') || '') === 'no-store', 'API isolada sem Cache-Control no-store');

  for (const route of ['/assets/missing-audit-file.webp','/missing-audit-route']) {
    ensure((await fetch(`${base}${route}`)).status===404, `${route}: recurso ausente não pode retornar HTML200`);
  }

  const manifest = (await readFile(path.join(dist, 'BUILD-MANIFEST.sha256'), 'utf8')).trim().split(/\r?\n/);
  ensure(manifest.length > 200, 'manifesto de build incompleto');
  for (const line of manifest) {
    const expected = line.slice(0, 64);
    const relative = line.slice(66);
    const actual = sha256(await readFile(path.join(dist, ...relative.split('/'))));
    ensure(actual === expected, `hash divergente: ${relative}`);
  }

  console.log(`PRODUCTION HTTP SMOKE OK - ${checks.length + 5} cenários; ${manifest.length} hashes verificados`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
