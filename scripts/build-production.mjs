import {createHash} from 'node:crypto';
import {cp, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const profile = process.env.INTEGRALL_BUILD_PROFILE;
if (!['full', 'offline'].includes(profile)) throw new Error('Use npm run build (completo) ou npm run build:offline (sem integração HTTP, explicitamente identificado).');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const dist = path.join(root, 'dist');
const skipNames = new Set(['.git', 'node_modules', 'local-state', '.DS_Store', 'backups']);
const textExtensions = new Set(['.js', '.mjs', '.json', '.html', '.css', '.svg', '.webmanifest', '.yaml', '.yml', '.sql', '.bat', '.csv', '.md', '.txt', '.example']);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function exists(target) {
  try { await stat(target); return true; } catch { return false; }
}

async function copyRequired(relative) {
  const source = path.join(root, relative);
  const target = path.join(dist, relative);
  if (!await exists(source)) throw new Error(`Arquivo obrigatório ausente: ${relative}`);
  await mkdir(path.dirname(target), {recursive: true});
  await cp(source, target, {
    recursive: true,
    dereference: false,
    filter: sourcePath => {
      const name = path.basename(sourcePath);
      return !skipNames.has(name) && name !== '.env' && !/^\.env\.(?!example$)/i.test(name);
    }
  });
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (skipNames.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Link simbólico não permitido no build: ${path.relative(dist, full)}`);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function validateTextFiles(files) {
  const forbidden = [
    {label: 'caminho absoluto Linux', pattern: /(?:^|[\s"'`=])\/(?:home|Users|mnt\/data)\//m},
    {label: 'chave privada', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/},
    {label: 'arquivo .env real referenciado', pattern: /(?:^|[\\/])\.env(?:$|[\s"'])/m}
  ];
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (!textExtensions.has(extension) && path.basename(file) !== '.env.example') continue;
    const text = await readFile(file, 'utf8');
    for (const rule of forbidden) {
      if (rule.pattern.test(text) && path.basename(file) !== '.env.example') {
        throw new Error(`${path.relative(dist, file)} contém ${rule.label}`);
      }
    }
  }
}

const sourcePackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const sourceLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const version = String(sourcePackage.version || '');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Versão inválida em package.json');
if (sourceLock.version !== version || sourceLock.packages?.['']?.version !== version) {
  throw new Error('package-lock.json não corresponde à versão do package.json');
}

await rm(dist, {recursive: true, force: true});
await mkdir(dist, {recursive: true});

for (const item of [
  'server.js',
  'src',
  'public',
  'data/catalog.json',
  'data/catalog.seed.json',
  'data/media-seed',
  'data/recovery-map.json',
  'data/recovery-products.json',
  'data/catalog-repairs.json',
  'scripts/verify-media.mjs',
  'scripts/deployment-check.mjs',
  'scripts/check-correios.mjs',
  'scripts/show-all-products.mjs',
  'TODOS-PRODUTOS-VISIVEIS.md',
  'PAGINACAO-E-CARDS.md',
  'CONFIGURAR-CORREIOS.md',
  'INTEGRACAO-CORREIOS.md',
  'TESTES-CORREIOS.md',
  'CORRECAO-HTTP-R1.md',
  'TESTES-HTTP-R1.md',
  'scripts/verify-release.mjs',
  'migrations',
  'scripts/migrate.mjs',
  'package-lock.json',
  '.env.example',
  'render.yaml',
  'render-free-test.yaml',
  'docker-compose.yml',
  'README.md',
  'REVISAO-CLIENTE-R2.md',
  'TESTES-CLIENTE-R2.md',
  'APRESENTACAO-AO-CLIENTE.md',
  'CORRECOES-V11.1.8.md',
  'CORRECOES-V11.0.4.md',
  'TESTES-V11.0.4.md',
  'MANIFESTO-V11.0.4.txt',
  'LEIA-ME-PRIMEIRO.txt',
  'DEPLOYMENT_RUNBOOK.md',
  'SECURITY.md'
]) await copyRequired(item);

const productionPackage = {
  name: sourcePackage.name,
  version,
  private: true,
  type: sourcePackage.type || 'module',
  description: sourcePackage.description,
  engines: sourcePackage.engines,
  scripts: {
    start: 'node server.js',
    'start:local': 'node --env-file=.env server.js',
    'correios:check': 'node scripts/check-correios.mjs',
    'catalog:show-all': 'node scripts/show-all-products.mjs',
    'correios:check:local': 'node --env-file=.env scripts/check-correios.mjs',
    'db:migrate': 'node scripts/migrate.mjs',
    'media:verify': 'node scripts/verify-media.mjs',
    'deployment:check': 'node scripts/deployment-check.mjs',
    'release:verify': 'node scripts/verify-release.mjs .' 
  },
  dependencies: sourcePackage.dependencies
};
await writeFile(path.join(dist, 'package.json'), `${JSON.stringify(productionPackage, null, 2)}\n`, 'utf8');

const revision = await (async () => {
  try {
    const head = (await readFile(path.join(root, '.git', 'HEAD'), 'utf8')).trim();
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5);
      return (await readFile(path.join(root, '.git', ref), 'utf8')).trim();
    }
    return head;
  } catch { return null; }
})();

const info = {
  project: sourcePackage.name,
  version,
  generatedAt: new Date().toISOString(),
  node: process.version,
  sourceRevision: revision,
  model: 'Node.js/Express com arquivos estáticos; pacote de implantação',
  validation: {profile, integrationTests: profile === 'full' ? 'passed' : 'not-run', externalServices: 'not-validated', note: profile === 'offline' ? 'Pacote verificado com testes offline. Execute npm ci e npm run build na fonte para homologar também a integração HTTP.' : 'Integração HTTP local aprovada; serviços externos requerem homologação separada.'}
};
await writeFile(path.join(dist, 'BUILD-INFO.json'), `${JSON.stringify(info, null, 2)}\n`, 'utf8');

let files = (await walk(dist)).sort((a, b) => a.localeCompare(b, 'en'));
await validateTextFiles(files);

const requiredOutput = [
  'server.js', 'package.json', 'package-lock.json', '.env.example',
  'src/config.js', 'src/repository.js', 'public/index.html', 'public/admin.html',
  'data/catalog.json', 'data/recovery-map.json', 'data/media-seed', 'migrations/003_customer_commerce.up.sql'
];
for (const relative of requiredOutput) {
  if (!await exists(path.join(dist, relative))) throw new Error(`Build incompleto: ${relative}`);
}

const manifestLines = [];
for (const file of files) {
  const relative = path.relative(dist, file).split(path.sep).join('/');
  const buffer = await readFile(file);
  manifestLines.push(`${sha256(buffer)}  ${relative}`);
}
await writeFile(path.join(dist, 'BUILD-MANIFEST.sha256'), `${manifestLines.join('\n')}\n`, 'utf8');

// Verificação independente dos bytes escritos.
for (const line of manifestLines) {
  const expected = line.slice(0, 64);
  const relative = line.slice(66);
  const actual = sha256(await readFile(path.join(dist, ...relative.split('/'))));
  if (actual !== expected) throw new Error(`Hash divergente no build: ${relative}`);
}

files = await walk(dist);
const totalBytes = (await Promise.all(files.map(file => stat(file)))).reduce((sum, item) => sum + item.size, 0);
console.log(`PRODUCTION BUILD OK - v${version}; ${files.length} arquivos; ${totalBytes} bytes; manifesto verificado`);
console.log(`Saída: ${path.relative(root, dist)}`);
