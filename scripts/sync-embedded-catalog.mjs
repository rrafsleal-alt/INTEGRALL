import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeCatalog} from '../src/catalog.js';
import {visibleCatalogProducts} from '../src/catalog-visibility.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'public', 'index.html');
const catalogPath = path.join(root, 'data', 'catalog.json');
const packagePath = path.join(root, 'package.json');

const [html, rawCatalogText, packageText] = await Promise.all([
  readFile(indexPath, 'utf8'),
  readFile(catalogPath, 'utf8'),
  readFile(packagePath, 'utf8')
]);
const catalog = normalizeCatalog(JSON.parse(rawCatalogText));
const pkg = JSON.parse(packageText);

// O catálogo embutido é apenas um fallback visual quando a API não responde.
// Visibilidade é independente da venda: itens sem preço continuam visíveis.
// Não inclui arquivados, cupons ou promoções; pagamentos exigem a API.
const products = visibleCatalogProducts(catalog);
const commerce = {
  ...catalog.commerce,
  apiBaseUrl: '',
  apiMode: 'required',
  paymentMethods: {whatsapp: false, pix: false, card: false}
};
const embedded = {
  publicBuild: true,
  appVersion: String(pkg.version || ''),
  version: catalog.version,
  settings: catalog.settings,
  products,
  promotions: [],
  commerce
};
const payload = JSON.stringify(embedded).replaceAll('<', '\\u003c');
const marker = /(<script\s+id=["']buildData["']\s+type=["']application\/json["']>)[\s\S]*?(<\/script>)/i;
if (!marker.test(html)) throw new Error('public/index.html não contém #buildData no formato esperado.');
const next = html.replace(marker, `$1${payload}$2`);
if (next !== html) await writeFile(indexPath, next, 'utf8');
console.log(`EMBEDDED CATALOG OK - v${embedded.appVersion}; ${products.length} produtos visíveis sincronizados`);
