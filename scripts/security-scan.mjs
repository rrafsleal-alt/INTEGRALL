import {access, readFile, readdir} from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const scanRoots = ['server.js', 'src', 'scripts', 'public', 'tests', 'migrations', '.env.example', 'render.yaml', 'render-free-test.yaml', 'docker-compose.yml'];
const failures = [];
const warnings = [];
const initialCredential = ['159213', 'Rafs'].join('');

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function walk(relative) {
  const full = path.join(root, relative);
  const extensionAllowed = /\.(?:js|mjs|html|css|json|svg|webmanifest|ya?ml|sql|txt|bat|env|example)$/i;
  const entry = await (async () => {
    try { return await readdir(full, {withFileTypes: true}); } catch { return null; }
  })();
  if (!entry) return extensionAllowed.test(relative) || !path.extname(relative) ? [relative] : [];
  const out = [];
  for (const item of entry) {
    if (['node_modules', '.git'].includes(item.name)) continue;
    const child = path.join(relative, item.name);
    if (item.isDirectory()) out.push(...await walk(child));
    else if (extensionAllowed.test(item.name)) out.push(child);
  }
  return out;
}

const files = [];
for (const item of scanRoots) files.push(...await walk(item));
for (const name of await readdir(root)) if (/\.bat$/i.test(name)) files.push(name);

const rules = [
  {name: 'execução dinâmica', re: /\beval\s*\(|new\s+Function\s*\(/},
  {name: 'SQL concatenado', re: /(?:query|execute)\s*\(\s*`[^`]*\$\{[^}]+\}/s},
  {name: 'chave privada', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/},
  {name: 'token de provedor hardcoded', re: /(?:access[_-]?token|api[_-]?key|client[_-]?secret)\s*[:=]\s*["'][A-Za-z0-9_\-./+=]{20,}["']/i},
  {name: 'algoritmo de hash fraco para senha', re: /createHash\(["'](?:md5|sha1)["']\)[^\n]*(?:password|senha)/i}
];

for (const file of [...new Set(files)].sort()) {
  const full = path.join(root, file);
  if (!await exists(full)) continue;
  const text = await readFile(full, 'utf8');
  for (const rule of rules) if (rule.re.test(text)) failures.push(`${file}: ${rule.name}`);
  if (/console\.log\s*\(/.test(text) && !file.startsWith('scripts/') && !file.startsWith('tests/')) warnings.push(`${file}: console.log presente; confirme que não registra PII/segredos`);
  if (/rejectUnauthorized\s*:\s*false/.test(text)) warnings.push(`${file}: TLS sem validação existe somente no modo DATABASE_SSL_MODE=require; produção deve preferir verify-full`);
  if (/target=["']_blank["']/i.test(text) && !/rel=["'][^"']*noopener/i.test(text) && !/window\.open\([^\n]*["']noopener(?:,noreferrer)?["']/i.test(text)) failures.push(`${file}: abertura de nova aba sem proteção noopener`);
}

const publicAndLaunchers = [...new Set(files)].filter(file => file.startsWith('public/') || /\.bat$/i.test(file));
for (const file of publicAndLaunchers) {
  const text = await readFile(path.join(root, file), 'utf8');
  if (text.includes(initialCredential)) failures.push(`${file}: credencial inicial exposta`);
  if (file.startsWith('public/') && /\b(?:ADMIN_PASSWORD_HASH|ADMIN_SESSION_SECRET|CUSTOMER_AUTH_SECRET|DATABASE_URL|MERCADO_PAGO_ACCESS_TOKEN|MERCADO_PAGO_WEBHOOK_SECRET|CORREIOS_ACCESS_CODE|CORREIOS_USER|CORREIOS_CONTRACT|CORREIOS_POSTAGE_CARD|SHIPPING_QUOTE_SECRET)\b/.test(text)) failures.push(`${file}: nome/valor de segredo de servidor exposto no frontend`);
}

if (await exists(path.join(root, '.env'))) failures.push('.env real encontrado no pacote');
const envExample = await readFile(path.join(root, '.env.example'), 'utf8');
for (const line of envExample.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|ACCESS_CODE|DATABASE_URL))=(.+)$/);
  if (match && match[2].trim()) failures.push(`.env.example: ${match[1]} deve permanecer sem segredo real`);
}

const serverSource = await readFile(path.join(root, 'server.js'), 'utf8');
if (!serverSource.includes("adminAuth.requirePermission('catalog:write')") ||
    !serverSource.includes("adminAuth.requirePermission('orders:write')") ||
    !serverSource.includes("adminAuth.requirePermission('media:write')")) {
  failures.push('server.js: proteção administrativa por permissão não foi detectada nas capacidades críticas');
}
if (/const\s+requireAdmin\s*=\s*\([^)]*\)\s*=>\s*[^;]*next\(\)/s.test(serverSource)) failures.push('server.js: middleware administrativo permissivo/bypass detectado');
if (!/await\s+mercadoPago\.validateWebhook/.test(serverSource)) failures.push('server.js: validação assíncrona do webhook do Mercado Pago não é aguardada');

const configSource = await readFile(path.join(root, 'src', 'config.js'), 'utf8');
if (!/const useBuiltInAdminPassword\s*=\s*defaultAdminLoginRequested/.test(configSource) || !/adminPasswordHash:\s*useBuiltInAdminPassword\s*\?\s*DEFAULT_ADMIN_PASSWORD_HASH\s*:\s*configuredAdminPasswordHash/.test(configSource)) failures.push('src/config.js: seleção exclusiva entre modo padrão e personalizado não detectada');
if (!/adminUsesBuiltInPasswordHash/.test(configSource) || !/adminUsesBuiltInSessionSecret/.test(configSource)) failures.push('src/config.js: marcadores de configuração inicial não detectados');
if (!/config\.adminUsesBuiltInPasswordHash\)[^\n]*ADMIN_PASSWORD_HASH/.test(configSource)) failures.push('src/config.js: produção não rejeita a credencial inicial');
if (!/config\.adminUsesBuiltInSessionSecret[^\n]*ADMIN_SESSION_SECRET/.test(configSource)) failures.push('src/config.js: produção não exige segredo administrativo persistente');
if (!/config\.customerAuthUsesBuiltInSecret[^\n]*CUSTOMER_AUTH_SECRET/.test(configSource)) failures.push('src/config.js: produção não exige segredo de autenticação do cliente');

const authSource = await readFile(path.join(root, 'src', 'auth.js'), 'utf8');
if (/fallbackPasswordHash|fallbackMatches|fallbackPromise/.test(authSource)) failures.push('src/auth.js: cadeia de senha administrativa fallback ainda existe');
if (!/scrypt/.test(authSource) || !/timingSafeEqual/.test(authSource)) failures.push('src/auth.js: hash scrypt e comparação em tempo constante são obrigatórios');
if (!/HttpOnly/.test(authSource) || !/sameSite\s*=\s*'Strict'/.test(authSource)) failures.push('src/auth.js: cookie administrativo não possui HttpOnly/SameSite=Strict');

const customerAuthSource = await readFile(path.join(root, 'src', 'customer-auth.js'), 'utf8');
if (!/createHmac\('sha256'/.test(customerAuthSource)) failures.push('src/customer-auth.js: códigos de login precisam de HMAC com segredo do servidor');
if (!/SameSite=Strict/.test(customerAuthSource) || !/HttpOnly/.test(customerAuthSource)) failures.push('src/customer-auth.js: cookie do cliente não possui HttpOnly/SameSite=Strict');
if (!/sameOrigin\(req\)/.test(customerAuthSource) || !/x-customer-csrf/.test(customerAuthSource)) failures.push('src/customer-auth.js: proteção de origem/CSRF não detectada');

for (const file of ['render.yaml', 'render-free-test.yaml']) {
  const yaml = await readFile(path.join(root, file), 'utf8');
  if (!/buildCommand:\s*npm ci --omit=dev --no-audit --no-fund/.test(yaml)) failures.push(`${file}: deploy não usa npm ci determinístico`);
  if (!/ADMIN_DEFAULT_LOGIN_ENABLED\s*\n\s*value:\s*["']false["']/.test(yaml)) failures.push(`${file}: credencial inicial deve ficar desativada em produção`);
  for (const key of ['ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET', 'CUSTOMER_AUTH_SECRET']) {
    if (!new RegExp(`- key: ${key}`).test(yaml)) failures.push(`${file}: variável obrigatória ausente: ${key}`);
  }
}

if (failures.length) {
  console.error('SECURITY SCAN FAIL');
  for (const item of [...new Set(failures)]) console.error(`- ${item}`);
  process.exit(1);
}
console.log(`SECURITY SCAN OK - ${new Set(files).size} arquivos inspecionados`);
for (const item of [...new Set(warnings)].slice(0, 20)) console.warn(`WARN: ${item}`);
