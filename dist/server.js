import {sanitizeAccountPatch} from './src/customer-profile.js';
import express from 'express';
import process from 'node:process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {config, assertProductionConfig, configWarnings} from './src/config.js';
import {normalizeCatalog, publicCatalog, buildOrder, ORDER_STATUSES, cleanText, findCoupon, validateCoupon, couponDiscount, slugify, effectiveFreeShippingThreshold, productPrice, isStockAlertPurchasable} from './src/catalog.js';
import {ShippingCheckout} from './src/shipping-checkout.js';
import {validateShippingBoxes} from './src/shipping-packages.js';
import {Repository} from './src/repository.js';
import {securityHeaders, rateLimit, safeEqual} from './src/security.js';
import {MercadoPagoService, InvalidWebhookSignatureError} from './src/payments.js';
import {evaluatePayment, paymentCanStart} from './src/payment-state.js';
import {claimCheckout, clearCheckoutClaimPatch, completeCheckoutPatch, reusableCheckout} from './src/payment-checkout-guard.js';
import {CorreiosService} from './src/correios.js';
import {JadlogService} from './src/jadlog.js';
import {Mailer, orderEmail} from './src/mailer.js';
import {AdminAuth} from './src/auth.js';
import {createAdminSessionHandlers} from './src/admin-session.js';
import {decodeLegacyDataUrl, ImageUploadError, mediaIdFromUrl, parseMultipartBody, validateAndSanitizeImage} from './src/image-upload.js';
import {assertOrderTransition} from './src/order-state.js';
import {CustomerAuth} from './src/customer-auth.js';
import {toPublicOrder} from './src/public-order.js';
import {applyQuotedShipping, assertShippingEditable} from './src/order-financials.js';
import {hashClientOrderKey, hashOrderIntent, hashOrderRequestIntent, idempotencyOwnership} from './src/order-idempotency.js';
import {assertCatalogRevision, assertProductRevision, assertSectionRevision, catalogRevision, productRevision, sectionRevision} from './src/catalog-revision.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const packageMetadata = JSON.parse(await readFile(path.join(__dirname, 'package.json'), 'utf8'));
const appVersion = String(packageMetadata.version || '0.0.0');
const initialCatalog = normalizeCatalog(JSON.parse(await readFile(path.join(__dirname, 'data', 'catalog.json'), 'utf8')));
assertProductionConfig();

const repo = new Repository({
  databaseUrl: config.databaseUrl,
  initialCatalog,
  production: config.env === 'production',
  localDataDir: process.env.LOCAL_DATA_DIR ? path.resolve(process.env.LOCAL_DATA_DIR) :
    (config.env === 'test' ? '' : path.join(__dirname, 'data', 'local-state')),
  packagedMediaDir: path.join(__dirname, 'data', 'media-seed'),
  databaseSslMode: config.databaseSslMode,
  databaseCa: config.databaseCa,
  migrationsDir: path.join(__dirname, 'migrations'),
  inventoryReservationMinutes: config.inventoryReservationMinutes
});
await repo.init();
const adminAuth = new AdminAuth({
  email: config.adminEmail,
  passwordHash: config.adminPasswordHash,
  role: config.adminRole,
  sessionSecret: config.adminSessionSecret,
  sessionHours: config.adminSessionHours,
  secureCookies: config.env === 'production' || /^https:\/\//i.test(config.publicUrl),
  publicUrl: config.publicUrl,
  sessionStore: repo
});
const customerAuth = new CustomerAuth({
  repository: repo,
  secureCookies: config.env === 'production' || /^https:\/\//i.test(config.publicUrl),
  sessionDays: config.customerSessionDays,
  codeMinutes: config.customerLoginCodeMinutes,
  codeSecret: config.customerAuthSecret,
  publicUrl: config.publicUrl
});

const mercadoPago = new MercadoPagoService({
  accessToken: config.mercadoPagoAccessToken,
  webhookSecret: config.mercadoPagoWebhookSecret,
  sandbox: config.mercadoPagoUseSandbox,
  expirationDays: config.mercadoPagoExpirationDays
});
const correios = new CorreiosService({
  user: config.correiosUser,
  accessCode: config.correiosAccessCode,
  postageCard: config.correiosPostageCard,
  contract: config.correiosContract,
  authType: config.correiosAuthType,
  contractDr: config.correiosContractDr,
  declaredValueEnabled: config.correiosDeclaredValue,
  quoteMethod: config.correiosQuoteMethod,
  allowTestBase: config.env === 'test',
  originCep: config.correiosOriginCep,
  services: config.correiosServices,
  homolog: config.correiosHomolog,
  baseUrl: config.correiosBaseUrl,
  apiVersion: config.correiosApiVersion
});
const jadlog = new JadlogService({
  token: config.jadlogToken,
  cnpj: config.jadlogCnpj,
  conta: config.jadlogConta,
  contrato: config.jadlogContrato,
  originCep: config.correiosOriginCep, // CEP de origem da loja (compartilhado)
  modalidade: config.jadlogModalidade,
  tpEntrega: config.jadlogTpEntrega,
  tpSeguro: config.jadlogTpSeguro,
  baseUrl: config.jadlogBaseUrl
});
const mailer = new Mailer({
  host: config.smtpHost,
  port: config.smtpPort,
  user: config.smtpUser,
  password: config.smtpPassword,
  from: config.smtpFrom,
  fromName: config.smtpFromName,
  replyTo: config.smtpReplyTo,
  secure: config.smtpSecure
});

const EMAIL_STATUS_EVENTS = new Set(['paid', 'payment_failed', 'payment_expired', 'preparing', 'ready', 'completed', 'refunded', 'cancelled']);

// Deduplicação de e-mails de status: webhooks reenviados (retry do Mercado
// Pago) não devem disparar o mesmo aviso duas vezes. Chave: pedido+status.
const notifiedStatuses = new Map();
const NOTIFIED_MAX = 2000;

function sendOrderEmail(order, kind) {
  if (!mailer.configured || !order?.customer?.email) return;
  let notificationKey = '';
  if (kind === 'status') {
    notificationKey = `${order.id}|${order.status}${order.trackingCode ? `|${order.trackingCode}` : ''}`;
    if (notifiedStatuses.has(notificationKey)) return;
    if (notifiedStatuses.size >= NOTIFIED_MAX) notifiedStatuses.delete(notifiedStatuses.keys().next().value);
    // Reserva a chave ANTES do envio para impedir duplicação concorrente no
    // mesmo processo. Se SMTP falhar, a chave é removida e um webhook/retry
    // posterior pode tentar novamente — falha transitória não vira silêncio.
    notifiedStatuses.set(notificationKey, {state: 'sending', at: Date.now()});
  }
  const businessName = 'INTEGRALL';
  const message = orderEmail(order, {kind, publicUrl: config.publicUrl, businessName});
  mailer.send({to: order.customer.email, ...message}).then(result => {
    if (!result.ok) {
      if (notificationKey) notifiedStatuses.delete(notificationKey);
      console.error(`E-mail não enviado (pedido ${order.id}): ${result.error}`);
      return;
    }
    if (notificationKey) notifiedStatuses.set(notificationKey, {state: 'sent', at: Date.now()});
  }).catch(error => {
    if (notificationKey) notifiedStatuses.delete(notificationKey);
    console.error(`E-mail não enviado (pedido ${order.id}):`, error);
  });
}

const app = express();

function safeLogMessage(value) {
  return String(value || '')
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/(token|secret|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[REDACTED]')
    .slice(0, 800);
}

function logEvent(level, event, details = {}) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details
  });
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else process.stdout.write(`${payload}\n`);
}
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  const supplied = String(req.headers['x-request-id'] || '');
  req.id = /^[A-Za-z0-9._:-]{8,120}$/.test(supplied) ? supplied : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const json = res.json.bind(res);
  res.json = payload => {
    if (res.statusCode >= 400 && payload && typeof payload === 'object' && !Array.isArray(payload)) {
      payload.requestId ||= req.id;
      payload.code ||= `HTTP_${res.statusCode}`;
    }
    return json(payload);
  };
  next();
});
app.use(securityHeaders);
app.use('/api/admin', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});
const publicJson = express.json({limit: '64kb', strict: true});
const adminCatalogJson = express.json({limit: '2mb', strict: true});
const adminLegacyMediaJson = express.json({limit: '10mb', strict: true});
const adminMediaRaw = express.raw({type: 'multipart/form-data', limit: '10.25mb'});

const orderLimiter = rateLimit({windowMs: 60_000, max: 20});
const statusLimiter = rateLimit({windowMs: 60_000, max: 60});
const paymentLimiter = rateLimit({windowMs: 60_000, max: 30});
const webhookLimiter = rateLimit({windowMs: 60_000, max: 180});
const adminLimiter = rateLimit({windowMs: 60_000, max: 90});
const adminLoginLimiter = rateLimit({windowMs: 15 * 60_000, max: 10});
const readLimiter = rateLimit({windowMs: 60_000, max: 120});
const accountLoginLimiter = rateLimit({windowMs: 10 * 60_000, max: 8});
const customerWriteLimiter = rateLimit({windowMs: 60_000, max: 30});

const adminOrdersRead = adminAuth.requirePermission('orders:read');
const adminOrdersWrite = adminAuth.requirePermission('orders:write');
const adminCustomersRead = adminAuth.requirePermission('customers:read');
const adminCatalogRead = adminAuth.requirePermission('catalog:read');
const adminCatalogWrite = adminAuth.requirePermission('catalog:write');
const adminMediaWrite = adminAuth.requirePermission('media:write');
const adminAuditRead = adminAuth.requirePermission('audit:read');
const adminSession = adminAuth.requireSession();
const customerSession = customerAuth.requireSession();
const customerCsrf = customerAuth.requireCsrf();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function auditAdmin(req, action, entityType, entityId = '', metadata = {}) {
  try {
    await repo.recordAudit({
      requestId: req.id,
      actor: req.admin?.email || 'system',
      role: req.admin?.role || '',
      action,
      entityType,
      entityId,
      metadata
    });
  } catch (error) {
    console.error(JSON.stringify({level: 'error', event: 'audit_log_failed', requestId: req.id, message: error?.message || String(error)}));
  }
}

function catalogMediaReferences(catalog, mediaId) {
  const references = [];
  const expectedUrl = `/media/products/${mediaId}`;
  for (const product of catalog?.products || []) {
    if ((product.images || []).includes(expectedUrl)) references.push({type: 'product', id: product.id, name: product.name});
    for (const variant of product.variants || []) {
      if (variant?.image === expectedUrl) references.push({type: 'product_variant', id: variant.id, name: `${product.name} — ${variant.name || 'Variação'}`});
    }
  }
  const assets = catalog?.settings?.visual?.assets || {};
  for (const [key, value] of Object.entries(assets)) {
    if (value === expectedUrl) references.push({type: 'visual_asset', id: key, name: key});
  }
  return references;
}

function mediaResponse(item) {
  if (!item) return null;
  return {
    id: item.id,
    url: `/media/products/${item.id}`,
    mimeType: item.mimeType,
    size: item.size,
    width: item.width,
    height: item.height,
    altText: item.altText || '',
    checksum: item.checksum || '',
    originalName: item.originalName || '',
    uploadedBy: item.uploadedBy || '',
    purpose: item.purpose || 'product',
    processingStatus: item.processingStatus || 'ready',
    createdAt: item.createdAt || '',
    updatedAt: item.updatedAt || ''
  };
}

function publicBaseUrl(req) {
  if (config.publicUrl) return config.publicUrl;
  if (config.renderExternalHostname) return `https://${config.renderExternalHostname}`;
  if (config.env === 'production') return '';
  return `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
}

function htmlEscape(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function publicProductUrl(product, req = null) {
  const base = req ? publicBaseUrl(req) : (config.publicUrl || (config.renderExternalHostname ? `https://${config.renderExternalHostname}` : ''));
  return base && product?.slug ? `${base}/produto/${encodeURIComponent(product.slug)}` : '';
}

function currentStock(product, variantId = '') {
  const variant = variantId ? (product?.variants || []).find(item => item.id === variantId && !item.deletedAt) : null;
  const raw = variant?.stock != null ? variant.stock : product?.stock;
  return raw == null ? null : Math.max(0, Number(raw) || 0);
}

function inventoryAlerts(catalog) {
  const rows = [];
  for (const product of catalog?.products || []) {
    if (product.deletedAt) continue;
    const min = product.stockMin == null ? 3 : Math.max(0, Number(product.stockMin) || 0);
    const activeVariants = (product.variants || []).filter(variant => !variant.deletedAt);
    if (activeVariants.some(variant => variant.stock != null)) {
      for (const variant of activeVariants) {
        if (variant.stock == null) continue;
        const stock = Math.max(0, Number(variant.stock) || 0);
        if (stock <= min) rows.push({productId: product.id, productName: product.name, variantId: variant.id, variantName: variant.name, stock, stockMin: min, outOfStock: stock === 0, restockDate: product.restockDate || ''});
      }
    } else if (product.stock != null) {
      const stock = Math.max(0, Number(product.stock) || 0);
      if (stock <= min) rows.push({productId: product.id, productName: product.name, variantId: '', variantName: '', stock, stockMin: min, outOfStock: stock === 0, restockDate: product.restockDate || ''});
    }
  }
  return rows.sort((a,b) => a.stock - b.stock || a.productName.localeCompare(b.productName, 'pt-BR'));
}

async function processRestockAlertsRun(catalog = null) {
  if (!mailer.configured) return {notified: 0};
  const currentCatalog = catalog || await repo.getCatalog();
  const products = new Map((currentCatalog.products || []).map(product => [product.id, product]));
  const subscriptions = await repo.listRestockSubscriptions({status: 'active', limit: 1000});
  let notified = 0;
  for (const subscription of subscriptions) {
    const outcome = await repo.withRestockNotificationLock(subscription.id, async current => {
      const product = products.get(current.productId);
      if (!isStockAlertPurchasable(product, current.variantId)) return false;
      const variant = current.variantId ? (product.variants || []).find(item => item.id === current.variantId && !item.deletedAt) : null;
      const label = variant ? `${product.name} — ${variant.name}` : product.name;
      const url = publicProductUrl(product);
      const result = await mailer.send({
        to: current.email,
        subject: `${label} voltou ao estoque | INTEGRALL`,
        text: `${label} está disponível novamente.${url ? `\n\nComprar: ${url}` : ''}`,
        html: `<p><strong>${htmlEscape(label)}</strong> está disponível novamente.</p>${url ? `<p><a href="${htmlEscape(url)}">Ver produto</a></p>` : ''}<p>INTEGRALL</p>`
      });
      return Boolean(result.ok);
    });
    if (outcome.notified) notified += 1;
  }
  return {notified};
}

// Evita duas varreduras de reposição simultâneas no mesmo processo (por
// exemplo: atualização de produto + sweep de reserva no mesmo instante), o
// que poderia disparar e-mails duplicados antes de markRestockNotified().
let restockRunPromise = null;
async function processRestockAlerts(catalog = null) {
  if (restockRunPromise) return restockRunPromise;
  restockRunPromise = processRestockAlertsRun(catalog);
  try { return await restockRunPromise; }
  finally { restockRunPromise = null; }
}


function maskedReviewer(email) {
  const local = String(email || '').split('@')[0];
  return local ? `${local.slice(0, 2)}***` : 'Cliente INTEGRALL';
}

function publicOrder(order) {
  return toPublicOrder(order, {
    onlinePaymentAvailable: mercadoPago.configured && paymentCanStart(order) && !order.requiresShippingQuote
  });
}

function centsFromBody(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 100_000_000) return null;
  return number;
}

const adminSessionHandlers = createAdminSessionHandlers({adminAuth, auditAdmin});
app.get('/api/admin/session', adminLimiter, asyncRoute(adminSessionHandlers.read));
app.post('/api/admin/session/login', adminLoginLimiter, publicJson, asyncRoute(adminSessionHandlers.login));
app.post('/api/admin/session/logout', adminLimiter, adminSession, asyncRoute(adminSessionHandlers.logout));

app.get('/api/health', readLimiter, asyncRoute(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const databaseHealth = await repo.health();
  res.json({
    ok: true,
    name: 'INTEGRALL API',
    version: appVersion,
    database: databaseHealth.ok ? 'available' : 'unavailable',
    mercadoPago: mercadoPago.configured,
    adminConfigured: adminAuth.configured,
    features: {
      persistentOrders: ['postgresql', 'local-file-development-only'].includes(databaseHealth.mode),
      orderTracking: true,
      inventoryOnPaid: true,
      shippingQuoteAdmin: true,
      customers: true,
      correiosShipping: config.shippingMode === 'correios',
      shippingConfigured: carrierShippingEnabled(),
      shippingManualFallback: true,
      shippingEnvironment: config.correiosHomolog ? 'homologacao' : 'producao',
      carriers: [
        ...(config.shippingMode === 'correios' && correios.configured ? ['correios'] : []),
        ...(config.shippingMode === 'correios' && jadlog.configured ? ['jadlog'] : [])
      ],
      transactionalEmail: mailer.configured,
      orderAutoExpire: config.orderExpireDays > 0,
      inventoryReservation: true,
      customerAccounts: true,
      verifiedReviews: true,
      restockAlerts: true,
      automaticPromotions: true,
      productSeoPages: true
    },
    time: new Date().toISOString()
  });
}));

app.get('/api/catalog', readLimiter, asyncRoute(async (_req, res) => {
  const catalog = await repo.getCatalog();
  const stats = await repo.reviewStats();
  const output = publicCatalog(catalog, config);
  for (const product of output.products || []) product.review = stats[product.id] || {count: 0, average: 0};
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json(output);
}));


// ===== Conta do cliente (login sem senha por código) =====
app.use('/api/account', (_req, res, next) => {res.setHeader('Cache-Control', 'no-store');next();});
app.get('/api/account/session', readLimiter, asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const session = await customerAuth.readSession(req);
  if (!session) return res.json({authenticated: false});
  const account = await repo.getCustomerAccount(session.email) || await repo.ensureCustomerAccount(session.email);
  res.json({authenticated: true, account, csrfToken: session.csrfToken, expiresAt: session.expiresAt});
}));

app.post('/api/account/login/request', accountLoginLimiter, publicJson, asyncRoute(async (req, res) => {
  if (!mailer.configured && config.env === 'production') return res.status(503).json({code: 'ACCOUNT_EMAIL_UNAVAILABLE', error: 'O envio de código por e-mail ainda não está configurado.'});
  const login = await customerAuth.createLoginCode(req.body?.email);
  if (mailer.configured) {
    const result = await mailer.send({
      to: login.email,
      subject: 'Seu código de acesso | INTEGRALL',
      text: `Seu código de acesso à INTEGRALL é ${login.code}. Ele expira em ${config.customerLoginCodeMinutes} minutos.`,
      html: `<p>Seu código de acesso à INTEGRALL é:</p><p style="font-size:30px;font-weight:700;letter-spacing:6px">${htmlEscape(login.code)}</p><p>Ele expira em ${config.customerLoginCodeMinutes} minutos.</p>`
    });
    if (!result.ok) return res.status(502).json({code: 'ACCOUNT_EMAIL_FAILED', error: 'Não foi possível enviar o código agora.'});
  }
  res.json({ok: true, expiresAt: login.expiresAt, ...(config.env !== 'production' && !mailer.configured ? {developmentCode: login.code} : {})});
}));

app.post('/api/account/login/verify', accountLoginLimiter, publicJson, asyncRoute(async (req, res) => {
  const verified = await customerAuth.verifyLoginCode(req.body?.email, req.body?.code);
  if (!verified) return res.status(401).json({code: 'ACCOUNT_CODE_INVALID', error: 'Código inválido ou expirado.'});
  res.setHeader('Set-Cookie', customerAuth.cookie(verified.token, verified.expiresAt));
  res.setHeader('Cache-Control', 'no-store');
  res.json({authenticated: true, account: verified.account, csrfToken: verified.csrfToken, expiresAt: verified.expiresAt});
}));

app.post('/api/account/logout', customerWriteLimiter, customerSession, customerCsrf, asyncRoute(async (req, res) => {
  await repo.deleteCustomerSession(req.customerSession.tokenHash);
  res.setHeader('Set-Cookie', customerAuth.clearCookie());
  res.json({ok: true});
}));

app.patch('/api/account/profile', customerWriteLimiter, customerSession, customerCsrf, publicJson, asyncRoute(async (req, res) => {
  // Merge dentro do lock do repositório: duas abas atualizando campos distintos
  // não podem sobrescrever silenciosamente a versão mais recente da conta.
  const account = await repo.updateCustomerAccount(req.customerSession.email, current => sanitizeAccountPatch(req.body || {}, current || {}));
  res.json({account});
}));

app.get('/api/account/orders', customerSession, asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const orders = await repo.listOrdersByEmail(req.customerSession.email, {limit: 100});
  res.json({orders: orders.map(order => ({...publicOrder(order), canReorder: ['paid','preparing','ready','completed'].includes(order.status)}))});
}));

app.post('/api/account/reorder', customerWriteLimiter, customerSession, customerCsrf, publicJson, asyncRoute(async (req, res) => {
  const orderId = cleanText(req.body?.orderId, 100);
  const order = await repo.getOrder(orderId);
  if (!order || String(order.customer?.email || '').toLowerCase() !== req.customerSession.email) return res.status(404).json({error: 'Pedido não encontrado.'});
  const catalog = await repo.getCatalog();
  const products = new Map(catalog.products.map(product => [product.id, product]));
  const items = (order.items || []).map(line => {
    const product = products.get(line.productId);
    const variant = line.variantId ? (product?.variants || []).find(item => item.id === line.variantId && !item.deletedAt) : null;
    const stock = product ? currentStock(product, line.variantId) : 0;
    const minimum = Math.max(1, Number(product?.minPerOrder) || 1);
    const maximum = Math.max(1, Number(product?.maxPerOrder) || 999);
    const capacity = stock == null ? maximum : Math.min(maximum, Math.max(0, Number(stock) || 0));
    const baseAvailable = Boolean(product && !product.deletedAt && product.available !== false && product.hidden !== true && (!line.variantId || variant));
    const available = Boolean(baseAvailable && capacity >= minimum);
    const desired = Math.max(minimum, Number(line.qty) || minimum);
    return {
      productId: line.productId, variantId: line.variantId || '',
      qty: available ? Math.max(minimum, Math.min(desired, capacity, 999)) : 0,
      available,
      reason: available ? '' : baseAvailable && capacity > 0 ? `Estoque atual abaixo do mínimo de ${minimum} unidade(s)` : 'Produto ou variação indisponível'
    };
  });
  res.json({items, availableCount: items.filter(item => item.available).length});
}));

// ===== Avaliações verificadas =====
app.get('/api/products/:id/reviews', readLimiter, asyncRoute(async (req, res) => {
  const productId = cleanText(req.params.id, 120);
  const catalog = await repo.getCatalog();
  if (!(catalog.products || []).some(product => product.id === productId && !product.deletedAt && product.hidden !== true)) return res.status(404).json({error: 'Produto não encontrado.'});
  const reviews = await repo.listReviews({productId, status: 'published', limit: 100});
  // A lista é limitada por performance, mas o resumo precisa refletir TODAS
  // as avaliações publicadas; caso contrário produtos com >100 avaliações
  // exibiriam números diferentes no card e no modal.
  const summary = (await repo.reviewStats())[productId] || {count: 0, average: 0};
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json({summary, reviews: reviews.map(review => ({id: review.id, rating: review.rating, title: review.title, body: review.body, author: maskedReviewer(review.email), verified: Boolean(review.verifiedOrderId), createdAt: review.createdAt}))});
}));

app.post('/api/products/:id/reviews', customerWriteLimiter, customerSession, customerCsrf, publicJson, asyncRoute(async (req, res) => {
  const productId = cleanText(req.params.id, 120);
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({error: 'A nota precisa ser de 1 a 5.'});
  const catalog = await repo.getCatalog();
  const product = (catalog.products || []).find(item => item.id === productId && !item.deletedAt && item.hidden !== true);
  if (!product) return res.status(404).json({error: 'Produto não encontrado.'});
  const verifiedOrder = await repo.findVerifiedPurchase(req.customerSession.email, productId);
  if (!verifiedOrder) return res.status(403).json({code: 'REVIEW_PURCHASE_REQUIRED', error: 'Avaliações são liberadas para clientes que compraram este produto.'});
  const review = await repo.upsertReview({id: newId('review'), productId, email: req.customerSession.email, rating, title: cleanText(req.body?.title, 100), body: cleanText(req.body?.body, 1500), status: 'pending', verifiedOrderId: verifiedOrder.id});
  res.status(201).json({review: {...review, email: undefined}, message: 'Avaliação enviada para moderação.'});
}));

// ===== Avise-me quando voltar =====
app.post('/api/stock-alerts', customerWriteLimiter, publicJson, asyncRoute(async (req, res) => {
  const email = customerAuth.normalizeEmail(req.body?.email);
  const productId = cleanText(req.body?.productId, 120);
  const variantId = cleanText(req.body?.variantId, 120);
  if (!email) return res.status(400).json({error: 'Informe um e-mail válido.'});
  const catalog = await repo.getCatalog();
  const product = (catalog.products || []).find(item => item.id === productId && !item.deletedAt && item.hidden !== true);
  if (!product) return res.status(404).json({error: 'Produto não encontrado.'});
  if (variantId && !(product.variants || []).some(item => item.id === variantId && !item.deletedAt)) return res.status(400).json({error: 'Variação inválida.'});
  if (isStockAlertPurchasable(product, variantId)) return res.status(409).json({error: 'Este item já está disponível para compra.'});
  const subscription = await repo.addRestockSubscription({id: newId('restock'), productId, variantId, email, status: 'active', createdAt: new Date().toISOString()});
  res.status(201).json({ok: true, subscriptionId: subscription?.id || ''});
}));

// Subtotal server-side dos itens (preços do catálogo) para o Valor Declarado
// do seguro dos Correios — nunca confia em valores vindos do navegador.
const carrierShippingEnabled = () => config.shippingMode === 'correios' && (correios.configured || jadlog.configured);

/**
 * Consulta as transportadoras elegíveis em paralelo e retorna as opções
 * combinadas, ordenadas por preço.
 *
 * REGRA DE DIVISÃO (CARRIER_SPLIT_UNITS, padrão 12): pedidos de até N
 * unidades são enviados pelos Correios; acima de N unidades, pela Jadlog
 * (multi-volume nos Correios sai caro; a Jadlog ganha em carga maior).
 * Se a transportadora preferida não estiver configurada ou falhar, a outra
 * entra como reserva na PRÉVIA. No fechamento, o serviço escolhido precisa
 * continuar disponível; falha nunca autoriza trocar a escolha ou zerar o frete.
 */
async function quoteAllCarriers(cep, pack, declaredCents, totalUnits = 0, bypassCache = false) {
  const available = [];
  if (correios.configured) available.push({name: 'Correios', prefixLabel: label => `Correios ${label}`, service: correios});
  if (jadlog.configured) available.push({name: 'Jadlog', prefixLabel: label => label, service: jadlog});
  if (!available.length) throw new Error('Nenhuma transportadora configurada.');

  let carriers = available;
  const split = config.carrierSplitUnits;
  if (split > 0 && available.length > 1) {
    const preferredName = totalUnits > split ? 'Jadlog' : 'Correios';
    carriers = available.filter(carrier => carrier.name === preferredName);
    if (!carriers.length) carriers = available;
  }

  const attempt = async group => {
    const settled = await Promise.allSettled(group.map(carrier => carrier.service.quote(cep, pack, declaredCents, {bypassCache})));
    const options = [];
    const errors = [];
    let partial = false;
    for (const [index, result] of settled.entries()) {
      if (result.status === 'fulfilled') {
        partial ||= Boolean(result.value.partial);
        for (const option of result.value.options) {
          options.push({...option, label: group[index].prefixLabel(option.label)});
        }
      } else {
        errors.push(`${group[index].name}: ${result.reason?.code || 'SHIPPING_PROVIDER_ERROR'}`);
      }
    }
    return {options, errors, partial: partial || errors.length > 0};
  };

  let {options, errors, partial} = await attempt(carriers);

  // Fallback: se a transportadora preferida pela regra falhou, tenta as demais.
  if (!options.length && carriers.length < available.length) {
    const backup = available.filter(carrier => !carriers.includes(carrier));
    const retry = await attempt(backup);
    options = retry.options;
    partial = true;
    errors = errors.concat(retry.errors);
  }

  if (!options.length) throw Object.assign(new Error('Não foi possível obter preço e prazo de envio. Tente novamente ou solicite cotação à loja.'), {code: 'SHIPPING_UNAVAILABLE', status: 503});
  if (errors.length) console.error('Transportadora(s) indisponível(is) na cotação:', errors.join(' | '));
  options.sort((a, b) => a.priceCents - b.priceCents);
  return {options, cheapest: options[0], partial};
}

const shippingCheckout = new ShippingCheckout({
  config,
  enabled: carrierShippingEnabled,
  getRates: (context, bypassCache) => quoteAllCarriers(context.cep, context.pack, context.subtotalCents, context.unitCount, bypassCache)
});
async function resolveCorreiosShipping(body, catalog) {
  return shippingCheckout.resolve(body, catalog);
}
app.post('/api/shipping/quote', statusLimiter, publicJson, asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (config.shippingMode !== 'correios') return res.status(404).json({code: 'SHIPPING_DISABLED', error: 'Cotação automática não habilitada.'});
  try {
    const catalog = await repo.getCatalog();
    const result = await shippingCheckout.quote(req.body?.cep, req.body?.items, catalog);
    return res.json(result);
  } catch (error) {
    return res.status(error?.status || 400).json({code: error?.code || 'SHIPPING_ITEMS_INVALID', error: error?.message || 'Não foi possível cotar o envio.'});
  }
}));

app.post('/api/orders', orderLimiter, publicJson, asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const catalog = await repo.getCatalog();
  let order;
  let clientOrderKeyHash = '';
  let clientOrderPayloadHash = '';
  let clientOrderRequestHash = '';
  try {
    clientOrderKeyHash = hashClientOrderKey(req.body?.clientOrderKey);
    clientOrderRequestHash = hashOrderRequestIntent(req.body);
    const requestedClientOrderId = cleanText(req.body?.clientOrderId, 160);
    if (requestedClientOrderId) {
      const existing = await repo.getOrderByClientId(requestedClientOrderId);
      if (existing) {
        // Rejeita colisões ANTES de frete/estoque/provedores externos. Sem a
        // capability correta, clientOrderId nunca vira uma forma de provocar
        // trabalho caro ou descobrir detalhes de um pedido já existente.
        const ownership = idempotencyOwnership(existing, clientOrderKeyHash, clientOrderRequestHash, safeEqual);
        if (!ownership.ok) return res.status(409).json({code: ownership.code, error: 'Esta tentativa de pedido não corresponde ao pedido existente.'});
        return res.status(200).json({
          order: {
            id: existing.id,
            status: existing.status,
            subtotalCents: existing.subtotalCents,
            shippingCents: existing.shippingCents,
            shipping: toPublicOrder(existing).shipping,
            discountCents: Number(existing.discountCents) || 0,
            promotionDiscountCents: Number(existing.promotionDiscountCents) || 0,
            couponDiscountCents: Number(existing.couponDiscountCents) || 0,
            promotions: existing.promotions || [],
            coupon: existing.coupon?.code || '',
            totalCents: existing.totalCents,
            requiresShippingQuote: existing.requiresShippingQuote,
            checkoutToken: existing.checkoutToken,
            inventoryReservationExpiresAt: existing.inventoryReservationExpiresAt || '',
            onlinePaymentAvailable: mercadoPago.configured && paymentCanStart(existing) && !existing.requiresShippingQuote
          },
          idempotent: true
        });
      }
    }
    // Segurança: 'resolved' é sempre descartado do corpo recebido e só é
    // preenchido pela cotação server-side dos Correios.
    const cleanShipping = {...(req.body?.shipping || {})};
    delete cleanShipping.resolved;
    const cleanBody = {...req.body, shipping: cleanShipping};
    const resolved = await resolveCorreiosShipping(cleanBody, catalog);
    const payload = resolved ? {...cleanBody, shipping: {...cleanShipping, resolved}} : cleanBody;
    order = buildOrder(payload, catalog, config);
    // A chave de idempotência é uma capability separada do clientOrderId.
    // Guardamos apenas o hash para que o banco nunca contenha a chave reutilizável.
    if (clientOrderKeyHash) order.clientOrderKeyHash = clientOrderKeyHash;
    clientOrderPayloadHash = hashOrderIntent(order);
    if (clientOrderKeyHash) { order.clientOrderRequestHash = clientOrderRequestHash; order.clientOrderPayloadHash = clientOrderPayloadHash; }
  } catch (error) {
    return res.status(error?.status || 400).json({code: error?.code || 'ORDER_INVALID', error: error?.message || 'Pedido inválido.'});
  }
  let result;
  try { result = await repo.createOrder(order); }
  catch (error) {
    if (error?.code === 'OUT_OF_STOCK') return res.status(409).json({code: 'OUT_OF_STOCK', error: error.message});
    throw error;
  }
  if (!result.created) {
    const ownership = idempotencyOwnership(result.order, clientOrderKeyHash, clientOrderRequestHash, safeEqual);
    if (!ownership.ok) {
      // Nunca devolva checkoutToken, orderId ou dados do pedido em colisão sem prova
      // de posse. Isso transforma clientOrderId em identificador, não em segredo.
      return res.status(409).json({
        code: ownership.code,
        error: ownership.code === 'IDEMPOTENCY_OWNERSHIP_REQUIRED'
          ? 'Este identificador de pedido já foi utilizado por uma versão anterior. Gere uma nova tentativa de pedido.'
          : ownership.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH'
            ? 'Esta tentativa de pedido foi alterada. Gere uma nova tentativa antes de continuar.'
            : 'Este identificador de pedido já está associado a outra tentativa.'
      });
    }
  }
  if (result.created) sendOrderEmail(result.order, 'created');
  res.status(result.created ? 201 : 200).json({
    order: {
      id: result.order.id,
      status: result.order.status,
      subtotalCents: result.order.subtotalCents,
      shippingCents: result.order.shippingCents,
      shipping: toPublicOrder(result.order).shipping,
      discountCents: Number(result.order.discountCents) || 0,
      promotionDiscountCents: Number(result.order.promotionDiscountCents) || 0,
      couponDiscountCents: Number(result.order.couponDiscountCents) || 0,
      promotions: result.order.promotions || [],
      coupon: result.order.coupon?.code || '',
      totalCents: result.order.totalCents,
      requiresShippingQuote: result.order.requiresShippingQuote,
      checkoutToken: result.order.checkoutToken,
      inventoryReservationExpiresAt: result.order.inventoryReservationExpiresAt || '',
      // paymentCanStart cobre o replay idempotente: se o clientOrderId repetido
      // devolve um pedido já pago/cancelado, não podemos anunciar pagamento.
      onlinePaymentAvailable: mercadoPago.configured && paymentCanStart(result.order) && !result.order.requiresShippingQuote
    },
    idempotent: !result.created
  });
}));

app.post('/api/coupons/validate', statusLimiter, publicJson, asyncRoute(async (req, res) => {
  const code = cleanText(req.body?.code, 40).toUpperCase();
  if (!code) return res.status(400).json({error: 'Informe o código do cupom.'});
  const subtotalCents = Number(req.body?.subtotalCents);
  const safeSubtotal = Number.isSafeInteger(subtotalCents) && subtotalCents > 0 ? subtotalCents : 0;
  const shippingChoice = cleanText(req.body?.shippingChoice, 20);
  const catalog = await repo.getCatalog();
  const coupon = findCoupon(catalog, code);
  const check = validateCoupon(coupon, {subtotalCents: safeSubtotal, shippingChoice, shippingQuoted: Boolean(req.body?.shippingQuoted)});
  res.setHeader('Cache-Control', 'no-store');
  if (!check.ok) return res.status(404).json({error: check.error || 'Cupom inválido.'});
  res.json({
    coupon: {code: coupon.code, type: coupon.type, value: coupon.value, note: coupon.note || ''},
    discountCents: safeSubtotal ? couponDiscount(coupon, safeSubtotal, 0) : 0
  });
}));

// Cache de rastreio: os eventos mudam poucas vezes ao dia; 15 min evita
// abusar das APIs das transportadoras em recarregamentos do cliente.
const trackingCache = new Map();
const TRACKING_CACHE_TTL_MS = 15 * 60 * 1000;

app.post('/api/orders/tracking', statusLimiter, publicJson, asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const orderId = cleanText(req.body?.orderId, 100);
  const checkoutToken = cleanText(req.body?.checkoutToken, 128);
  if (!orderId || !checkoutToken) return res.status(400).json({error: 'Número do pedido e autorização são obrigatórios.'});
  const order = await repo.getOrder(orderId);
  if (!order || !safeEqual(checkoutToken, order.checkoutToken)) return res.status(404).json({error: 'Pedido não encontrado.'});
  if (!order.trackingCode) return res.status(404).json({error: 'Este pedido ainda não possui código de rastreio.'});

  const cacheKey = order.trackingCode;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TRACKING_CACHE_TTL_MS) return res.json(cached.value);

  // Detecta a transportadora: etiqueta Correios = AA123456789BR; Jadlog = numérica.
  const isCorreiosCode = /^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(order.trackingCode);
  const trackers = [];
  if (isCorreiosCode && correios.configured) trackers.push(correios);
  if (!isCorreiosCode && jadlog.configured) trackers.push(jadlog);
  // fallback: tenta qualquer transportadora configurada
  if (!trackers.length) {
    if (correios.configured) trackers.push(correios);
    if (jadlog.configured) trackers.push(jadlog);
  }
  if (!trackers.length) return res.status(503).json({error: 'Rastreamento automático não está configurado.', trackingUrl: order.trackingUrl || ''});

  let lastError = null;
  for (const tracker of trackers) {
    try {
      const result = await tracker.trackShipment(order.trackingCode);
      const value = {
        carrier: result.carrier,
        code: result.code,
        expectedDelivery: result.expectedDelivery || '',
        trackingUrl: order.trackingUrl || '',
        events: result.events.slice(0, 20)
      };
      if (trackingCache.size >= 500) trackingCache.delete(trackingCache.keys().next().value);
      trackingCache.set(cacheKey, {at: Date.now(), value});
      return res.json(value);
    } catch (error) {
      lastError = error;
    }
  }
  res.status(502).json({error: lastError?.message || 'Rastreamento indisponível no momento.', trackingUrl: order.trackingUrl || ''});
}));

app.post('/api/orders/status', statusLimiter, publicJson, asyncRoute(async (req, res) => {
  const orderId = cleanText(req.body?.orderId, 100);
  const checkoutToken = cleanText(req.body?.checkoutToken, 128);
  if (!orderId || !checkoutToken) return res.status(400).json({error: 'Número do pedido e autorização são obrigatórios.'});
  const order = await repo.getOrder(orderId);
  if (!order || !safeEqual(checkoutToken, order.checkoutToken)) return res.status(404).json({error: 'Pedido não encontrado.'});
  res.setHeader('Cache-Control', 'no-store');
  res.json({order: publicOrder(order)});
}));

app.post('/api/payments/checkout', paymentLimiter, publicJson, asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!mercadoPago.configured) return res.status(503).json({error: 'Pagamento online ainda não está configurado.'});
  const orderId = cleanText(req.body?.orderId, 100);
  const checkoutToken = cleanText(req.body?.checkoutToken, 128);
  if (!orderId || !checkoutToken) return res.status(400).json({error: 'orderId e checkoutToken são obrigatórios.'});
  const snapshot = await repo.getOrder(orderId);
  if (!snapshot || !safeEqual(checkoutToken, snapshot.checkoutToken)) return res.status(404).json({error: 'Pedido não encontrado.'});
  if (snapshot.requiresShippingQuote && (config.shippingMode === 'correios' || !config.allowPaymentWithQuotedShipping)) {
    return res.status(409).json({error: 'O frete deste pedido ainda precisa ser definido antes do pagamento online.'});
  }
  const reusable = reusableCheckout(snapshot);
  if (reusable) return res.json(reusable);
  if (snapshot.payment?.preferenceId && !snapshot.inventoryReservationReleasedAt) {
    return res.status(409).json({code: 'PAYMENT_CHECKOUT_ALREADY_CREATED', error: 'Este pedido já possui uma preferência de pagamento ativa. Atualize a página ou recrie o pedido se necessário.'});
  }
  const base = publicBaseUrl(req);
  if (!/^https:\/\//i.test(base)) return res.status(503).json({error: 'Configure PUBLIC_URL com HTTPS antes de habilitar o Mercado Pago.'});

  const claimId = randomUUID();
  let claimed;
  let attempt = 1;
  try {
    claimed = await repo.updateOrder(orderId, current => {
      if (!safeEqual(checkoutToken, current.checkoutToken)) throw Object.assign(new Error('Pedido não encontrado.'), {code: 'PAYMENT_ORDER_NOT_FOUND'});
      if (current.requiresShippingQuote && (config.shippingMode === 'correios' || !config.allowPaymentWithQuotedShipping)) throw Object.assign(new Error('O frete deste pedido ainda precisa ser definido antes do pagamento online.'), {code: 'PAYMENT_SHIPPING_PENDING'});
      const existing = reusableCheckout(current);
      if (existing) throw Object.assign(new Error('EXISTING_CHECKOUT'), {code: 'PAYMENT_CHECKOUT_REUSABLE', existing});
      if (!paymentCanStart(current)) throw Object.assign(new Error('Este pedido não aceita um novo pagamento.'), {code: 'PAYMENT_NOT_ALLOWED'});
      const claim = claimCheckout(current, {claimId}); attempt = claim.attempt;
      return {payment: claim.payment};
    }, {source: 'payment'});
  } catch (error) {
    if (error?.code === 'PAYMENT_CHECKOUT_REUSABLE') return res.json(error.existing);
    if (error?.code === 'PAYMENT_ORDER_NOT_FOUND') return res.status(404).json({error: 'Pedido não encontrado.'});
    if (['PAYMENT_NOT_ALLOWED','PAYMENT_SHIPPING_PENDING','PAYMENT_CHECKOUT_IN_PROGRESS'].includes(error?.code)) return res.status(409).json({code: error.code, error: error.message});
    throw error;
  }
  if (!claimed) return res.status(404).json({error: 'Pedido não encontrado.'});

  let checkout;
  try {
    checkout = await mercadoPago.createCheckout(claimed, base, attempt);
  } catch (error) {
    await repo.updateOrder(orderId, current => clearCheckoutClaimPatch(current, claimId), {source: 'payment'}).catch(() => {});
    if (error?.code === 'PAYMENT_RESERVATION_EXPIRED') return res.status(409).json({code: error.code, error: error.message});
    throw error;
  }

  try {
    const updated = await repo.updateOrder(orderId, current => {
      if (!paymentCanStart(current, {minimumRemainingMs: 0})) throw Object.assign(new Error('A reserva de estoque expirou durante a criação do pagamento. Recrie o pedido.'), {code: 'PAYMENT_RESERVATION_EXPIRED'});
      return completeCheckoutPatch(current, {claimId, checkout, attempt});
    }, {source: 'payment', note: `Pagamento Mercado Pago iniciado (tentativa ${attempt}).`});
    if (!updated) return res.status(404).json({error: 'Pedido não encontrado.'});
  } catch (error) {
    await repo.updateOrder(orderId, current => clearCheckoutClaimPatch(current, claimId), {source: 'payment'}).catch(() => {});
    if (['PAYMENT_RESERVATION_EXPIRED','PAYMENT_CHECKOUT_CLAIM_LOST'].includes(error?.code)) return res.status(409).json({code: error.code, error: error.message});
    throw error;
  }
  res.json({url: checkout.url, preferenceId: checkout.id, orderId});
}));

app.post('/api/webhooks/mercadopago', webhookLimiter, publicJson, asyncRoute(async (req, res) => {
  const dataId = req.query['data.id'] || req.body?.data?.id;
  const type = req.query.type || req.body?.type;
  if (type && type !== 'payment') return res.status(200).json({ok: true, ignored: true});
  if (!dataId) return res.status(400).json({error: 'data.id ausente.'});

  try {
    await mercadoPago.validateWebhook({
      xSignature: req.headers['x-signature'],
      xRequestId: req.headers['x-request-id'],
      dataId
    });
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) return res.status(401).json({error: 'Assinatura inválida.'});
    throw error;
  }

  const payment = await mercadoPago.getPayment(dataId);
  const orderId = cleanText(payment.external_reference || payment.metadata?.order_id, 100);
  if (!orderId) return res.status(200).json({ok: true, ignored: true});
  const order = await repo.getOrder(orderId);
  if (!order) return res.status(200).json({ok: true, ignored: true});

  // A avaliação roda DENTRO do lock do pedido (forma funcional do
  // updateOrder), sobre o estado mais recente. Sem isso haveria TOCTOU:
  // admin cancela entre a leitura e a gravação → 'approved' avaliado sobre o
  // estado antigo ressuscitaria o pedido cancelado como pago.
  let lastEvaluation = null;
  let previousStatus = order.status;
  const updated = await repo.updateOrder(order.id, current => {
    previousStatus = current.status;
    const evaluation = evaluatePayment(current, payment);
    lastEvaluation = evaluation;
    if (!evaluation.shouldUpdate) return null; // aborta sem gravar
    return {
      status: evaluation.nextStatus,
      payment: {
        provider: 'mercadopago',
        preferenceId: current.payment?.preferenceId || payment.preference_id || '',
        paymentId: String(payment.id),
        status: evaluation.paymentStatus,
        statusDetail: cleanText(payment.status_detail, 160),
        approvedAt: payment.date_approved || '',
        refundedCents: Math.round(Number(payment.transaction_amount_refunded || 0) * 100)
      }
    };
  }, current => ({
    source: 'mercadopago-webhook',
    note: `Pagamento atualizado para ${lastEvaluation?.paymentStatus || payment.status || 'desconhecido'}.`
  }));

  if (lastEvaluation && !lastEvaluation.shouldUpdate) {
    // Divergência ignorada (ex.: 2º pagamento com outra preferência num pedido
    // já pago) precisa ficar VISÍVEL no pedido: pode haver dinheiro do cliente
    // retido sem registro. Grava no histórico para o admin tratar/reembolsar.
    if (lastEvaluation.warning) {
      await repo.updateOrder(order.id, {}, {
        source: 'mercadopago-webhook',
        note: `ATENÇÃO: webhook ignorado (${lastEvaluation.warning}) — pagamento ${payment.id} status ${payment.status || '?'} valor ${payment.transaction_amount ?? '?'}. Verifique se há cobrança duplicada para reembolsar.`
      }).catch(error => console.error('Falha ao registrar warning de webhook:', error?.message || error));
    }
    return res.status(200).json({ok: true, ignored: true, ...(lastEvaluation.warning ? {warning: lastEvaluation.warning} : {})});
  }

  if (updated && previousStatus !== updated.status && EMAIL_STATUS_EVENTS.has(updated.status)) sendOrderEmail(updated, 'status');
  res.status(200).json({ok: true});
}));

app.get('/api/admin/orders', adminLimiter, adminOrdersRead, asyncRoute(async (req, res) => {
  const status = cleanText(req.query.status, 30);
  const search = cleanText(req.query.search, 120);
  const orders = await repo.listOrders({status, search, limit: Number(req.query.limit) || 300});
  res.json({orders});
}));

app.get('/api/admin/orders/:id', adminLimiter, adminOrdersRead, asyncRoute(async (req, res) => {
  const order = await repo.getOrder(cleanText(req.params.id, 100));
  if (!order) return res.status(404).json({error: 'Pedido não encontrado.'});
  res.json({order});
}));

app.patch('/api/admin/orders/:id', adminLimiter, adminOrdersWrite, publicJson, asyncRoute(async (req, res) => {
  const orderId = cleanText(req.params.id, 100);
  const status = cleanText(req.body?.status, 30);
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({code: 'ORDER_STATUS_INVALID', error: 'Status inválido.'});
  const note = cleanText(req.body?.note, 300) || 'Status alterado pelo painel administrativo.';
  let previousStatus = '';
  let order;
  try {
    // A transição é validada DENTRO do lock do pedido. Ler antes e gravar
    // depois permitiria TOCTOU entre dois admins/webhook concorrentes.
    order = await repo.updateOrder(orderId, current => {
      previousStatus = current.status;
      assertOrderTransition(current.status, status);
      return {status};
    }, {source: 'admin', note});
  } catch (error) {
    if (['ORDER_STATUS_INVALID','ORDER_TRANSITION_INVALID','OUT_OF_STOCK'].includes(error?.code)) {
      return res.status(409).json({code: error.code, error: error.message});
    }
    throw error;
  }
  if (!order) return res.status(404).json({error: 'Pedido não encontrado.'});
  if (previousStatus !== order.status && EMAIL_STATUS_EVENTS.has(order.status)) sendOrderEmail(order, 'status');
  await auditAdmin(req, 'order_status_updated', 'order', orderId, {from: previousStatus, to: order.status, note});
  res.json({order});
}));

app.patch('/api/admin/orders/:id/shipping', adminLimiter, adminOrdersWrite, publicJson, asyncRoute(async (req, res) => {
  const orderId = cleanText(req.params.id, 100);
  const shippingCents = centsFromBody(req.body?.shippingCents);
  if (shippingCents == null) return res.status(400).json({error: 'Informe o frete em centavos (zero ou valor positivo).'});
  const label = cleanText(req.body?.label, 160) || 'Frete confirmado pela loja';
  let financial = null;
  let updated;
  try {
    updated = await repo.updateOrder(orderId, current => {
      // Avaliado no mesmo lock que aplica o frete: bloqueia inclusive a janela
      // entre claimCheckout e o retorno do provedor, sem reduzir a proteção CSRF.
      assertShippingEditable(current);

      const recalculated = applyQuotedShipping(current, {shippingCents, label});
      financial = recalculated.financial;
      return recalculated.patch;
    }, {source:'admin', note:`Frete definido em ${shippingCents} centavos.`});
  } catch (error) {
    if (['ORDER_SHIPPING_NOT_DELIVERY','ORDER_SHIPPING_LOCKED','ORDER_PAYMENT_TOTAL_LOCKED'].includes(error?.code)) return res.status(409).json({code:error.code,error:error.message});
    if (error?.code === 'ORDER_TOTAL_INVALID') return res.status(400).json({code:error.code,error:error.message});
    throw error;
  }
  if (!updated) return res.status(404).json({error:'Pedido não encontrado.'});
  await auditAdmin(req, 'order_shipping_updated', 'order', orderId, financial || {shippingCents,label});
  res.json({order: updated});
}));

app.patch('/api/admin/orders/:id/tracking', adminLimiter, adminOrdersWrite, publicJson, asyncRoute(async (req, res) => {
  const orderId = cleanText(req.params.id, 100);
  const order = await repo.getOrder(orderId);
  if (!order) return res.status(404).json({error: 'Pedido não encontrado.'});
  if (order.shipping?.choice !== 'delivery') return res.status(409).json({error: 'Este pedido é para retirada e não possui envio.'});
  const trackingCode = cleanText(req.body?.trackingCode, 80).toUpperCase().replace(/\s+/g, '');
  const trackingCarrier = cleanText(req.body?.trackingCarrier, 80);
  let trackingUrl = cleanText(req.body?.trackingUrl, 500);
  if (trackingUrl && !/^https:\/\/[^\s]+$/i.test(trackingUrl)) return res.status(400).json({error: 'O link de rastreio precisa ser uma URL HTTPS.'});
  // Link automático correto por transportadora: etiqueta Correios (AA…BR)
  // ganha link dos Correios; código numérico (Jadlog) ganha o tracking Jadlog.
  if (!trackingUrl && trackingCode) {
    if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(trackingCode)) {
      trackingUrl = `https://rastreamento.correios.com.br/app/index.php?objetos=${encodeURIComponent(trackingCode)}`;
    } else if (/^\d{8,14}$/.test(trackingCode)) {
      trackingUrl = `https://www.jadlog.com.br/tracking?cte=${encodeURIComponent(trackingCode)}`;
    }
  }
  const note = trackingCode
    ? `Código de rastreio informado: ${trackingCode}${trackingCarrier ? ` (${trackingCarrier})` : ''}.`
    : 'Código de rastreio removido.';
  const updated = await repo.updateOrder(orderId, {
    trackingCode,
    trackingCarrier,
    trackingUrl: trackingCode ? trackingUrl : ''
  }, {source: 'admin', note});
  // Invalida o cache de rastreio dos códigos envolvidos (antigo e novo):
  // o cliente vê os eventos certos imediatamente após a troca.
  if (order.trackingCode) trackingCache.delete(order.trackingCode);
  if (trackingCode) trackingCache.delete(trackingCode);
  if (trackingCode && updated) sendOrderEmail(updated, 'status');
  await auditAdmin(req, 'order_tracking_updated', 'order', orderId, {trackingCode, trackingCarrier, trackingUrl: trackingUrl || ''});
  res.json({order: updated});
}));

app.get('/api/admin/customers', adminLimiter, adminCustomersRead, asyncRoute(async (req, res) => {
  const search = cleanText(req.query.search, 120);
  const customers = await repo.listCustomers({search, limit: Number(req.query.limit) || 300});
  res.json({customers});
}));


app.get('/api/admin/inventory/alerts', adminLimiter, adminCatalogRead, asyncRoute(async (_req, res) => {
  const catalog = await repo.getCatalog();
  const subscriptions = await repo.listRestockSubscriptions({status: 'active', limit: 1000});
  res.json({alerts: inventoryAlerts(catalog), subscriptions});
}));

app.get('/api/admin/reviews', adminLimiter, adminCustomersRead, asyncRoute(async (req, res) => {
  const status = cleanText(req.query.status, 20);
  const reviews = await repo.listReviews({status, limit: Number(req.query.limit) || 300});
  res.json({reviews});
}));

app.patch('/api/admin/reviews/:id', adminLimiter, adminCatalogWrite, publicJson, asyncRoute(async (req, res) => {
  const status = cleanText(req.body?.status, 20);
  if (!['pending','published','rejected'].includes(status)) return res.status(400).json({error: 'Status de avaliação inválido.'});
  const review = await repo.updateReviewStatus(cleanText(req.params.id, 140), status);
  if (!review) return res.status(404).json({error: 'Avaliação não encontrada.'});
  await auditAdmin(req, 'review_moderated', 'review', review.id, {status});
  res.json({review});
}));

app.get('/api/admin/promotions', adminLimiter, adminCatalogRead, asyncRoute(async (_req, res) => {
  const catalog = await repo.getCatalog();
  res.json({promotions: catalog.promotions || [], revision: sectionRevision(catalog.promotions || [])});
}));

app.put('/api/admin/promotions', adminLimiter, adminCatalogWrite, publicJson, asyncRoute(async (req, res) => {
  if (!Array.isArray(req.body?.promotions)) return res.status(400).json({error: 'Envie um array promotions.'});
  let next;
  try { next = await repo.mutateCatalog(current => { assertSectionRevision(req.body?.revision, current.promotions || [], 'promoções'); return normalizeCatalog({...current, promotions: req.body.promotions}); }); }
  catch (error) { if (error?.code === 'SECTION_REVISION_CONFLICT') return res.status(409).json({code:error.code,error:error.message,revision:error.actualRevision}); return res.status(400).json({error: error?.message || 'Promoções inválidas.'}); }
  await auditAdmin(req, 'promotions_updated', 'catalog_promotions', 'storefront', {count: next.promotions.length});
  res.json({ok: true, promotions: next.promotions, revision: sectionRevision(next.promotions || [])});
}));

app.get('/api/admin/products', adminLimiter, adminCatalogRead, asyncRoute(async (_req, res) => {
  const catalog = await repo.getCatalog();
  const products = (catalog.products || []).filter(product => !product.deletedAt).map(product => ({
    ...product,
    variants: (product.variants || []).filter(variant => !variant.deletedAt),
    _revision: productRevision(product)
  }));
  res.json({products});
}));

class HttpError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function newId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function parseAdminMedia(req, res, next) {
  if (String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data')) {
    return adminMediaRaw(req, res, next);
  }
  return adminLegacyMediaJson(req, res, next);
}

app.post(['/api/admin/media', '/api/admin/media/product-image'], adminLimiter, adminMediaWrite, parseAdminMedia, asyncRoute(async (req, res) => {
  try {
    const input = Buffer.isBuffer(req.body)
      ? parseMultipartBody(req.body, req.headers['content-type'])
      : decodeLegacyDataUrl(req.body?.dataUrl);
    const parsed = validateAndSanitizeImage(input);
    const now = new Date().toISOString();
    const id = newId('media');
    const stored = await repo.saveMedia({
      id,
      storageKey: id,
      mimeType: parsed.mimeType,
      data: parsed.data,
      size: parsed.size,
      width: parsed.width,
      height: parsed.height,
      checksum: parsed.checksum,
      originalName: parsed.originalName,
      altText: parsed.altText,
      purpose: parsed.purpose,
      uploadedBy: req.admin.email,
      processingStatus: 'ready',
      createdAt: now,
      updatedAt: now
    });
    await auditAdmin(req, 'media_uploaded', 'media', id, {
      mimeType: stored.mimeType,
      size: stored.size,
      width: stored.width,
      height: stored.height,
      checksum: stored.checksum
    });
    res.status(201).json({ok: true, media: mediaResponse(stored), ...mediaResponse(stored)});
  } catch (error) {
    if (error instanceof ImageUploadError) return res.status(error.status).json({code: error.code, error: error.message});
    throw error;
  }
}));

app.get('/api/admin/media', adminLimiter, adminCatalogRead, asyncRoute(async (req, res) => {
  const media = (await repo.listMedia({limit: Number(req.query.limit) || 100})).map(mediaResponse);
  const catalog = await repo.getCatalog();
  const withUsage = media.map(item => ({...item, references: catalogMediaReferences(catalog, item.id)}));
  res.json({media: withUsage});
}));

app.delete('/api/admin/media/:id', adminLimiter, adminMediaWrite, asyncRoute(async (req, res) => {
  const id = cleanText(req.params.id, 180);
  if (!/^(?:media|product-image)-[A-Za-z0-9-]{6,160}$/.test(id)) return res.status(404).json({error: 'Mídia não encontrada.'});
  const catalog = await repo.getCatalog();
  const references = catalogMediaReferences(catalog, id);
  if (references.length) {
    return res.status(409).json({code: 'MEDIA_IN_USE', error: 'A imagem ainda está em uso e não pode ser excluída.', references});
  }
  const deleted = await repo.deleteMedia(id);
  if (!deleted) return res.status(404).json({error: 'Mídia não encontrada.'});
  await auditAdmin(req, 'media_deleted', 'media', id);
  res.json({ok: true});
}));

app.get('/media/products/:id', readLimiter, asyncRoute(async (req, res) => {
  const id = cleanText(req.params.id, 180);
  if (!/^(?:media|product-image)-[A-Za-z0-9-]{6,160}$/.test(id)) return res.status(404).end();
  const media = await repo.getMedia(id);
  if (!media) return res.status(404).end();
  const etag = media.checksum ? `"sha256-${media.checksum}"` : `W/"${media.data.length}-${id}"`;
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.setHeader('Content-Type', media.mimeType);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('ETag', etag);
  res.setHeader('Content-Length', String(media.data.length));
  if (media.width) res.setHeader('X-Image-Width', String(media.width));
  if (media.height) res.setHeader('X-Image-Height', String(media.height));
  res.end(media.data);
}));

// Cria um produto novo. O corpo aceita os mesmos campos editáveis do PATCH
// e opcionalmente `variants` (subprodutos) sem id — os ids são gerados aqui.
app.post('/api/admin/products', adminLimiter, adminCatalogWrite, publicJson, asyncRoute(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const name = cleanText(body.name, 160);
  if (!name) return res.status(400).json({error: 'Informe o nome do produto.'});
  const productId = newId('product');
  const now = Date.now();
  if (Array.isArray(body.variants) && body.variants.some(variant => !cleanText(variant?.name, 120))) {
    return res.status(400).json({error: 'Toda variação precisa de um nome (ex.: 750ml).'});
  }
  const variants = (Array.isArray(body.variants) ? body.variants : []).slice(0, 100).map((variant, index) => ({
    id: cleanText(variant?.id, 120) || newId('variant'),
    name: cleanText(variant?.name, 120),
    price: variant?.price,
    stock: variant?.stock ?? null,
    unit: cleanText(variant?.unit, 120),
    weightGrams: variant?.weightGrams ?? null,
    image: variant?.image,
    position: index + 1
  }));
  try { validateShippingBoxes(body.boxes ?? [], variants); } catch (error) { return res.status(400).json({error: error.message}); }
  const product = {
    id: productId,
    name,
    slug: cleanText(body.slug, 120) || slugify(name),
    department: cleanText(body.department, 80),
    subcategory: cleanText(body.subcategory, 100),
    brand: cleanText(body.brand, 120),
    price: body.price ?? 0,
    unit: cleanText(body.unit, 120),
    description: cleanText(body.description, 3000),
    images: Array.isArray(body.images) ? body.images : [],
    variants,
    attributes: body.attributes,
    stock: body.stock ?? null,
    minPerOrder: body.minPerOrder ?? null,
    maxPerOrder: body.maxPerOrder ?? null,
    weightGrams: body.weightGrams ?? null,
    lengthCm: body.lengthCm ?? null,
    widthCm: body.widthCm ?? null,
    heightCm: body.heightCm ?? null,
    boxes: body.boxes ?? [],
    available: body.available !== false,
    hidden: body.hidden === true,
    featured: body.featured === true,
    giftEnabled: body.giftEnabled !== false,
    created: now,
    updated: now
  };
  let next;
  try {
    next = await repo.mutateCatalog(current => {
      const products = [...(current.products || []), {...product, position: (current.products || []).length + 1}];
      return normalizeCatalog({...current, products});
    });
  } catch (error) {
    return res.status(400).json({error: error?.message || 'Produto inválido.'});
  }
  const internalCreatedProduct = next.products.find(item => item.id === productId);
  const createdProduct = internalCreatedProduct ? {...internalCreatedProduct, variants:(internalCreatedProduct.variants||[]).filter(variant=>!variant.deletedAt), _revision:productRevision(internalCreatedProduct)} : null;
  await auditAdmin(req, 'product_created', 'product', productId, {name: createdProduct?.name || name});
  processRestockAlerts(next).catch(error => console.error('Falha ao processar avisos de reposição:', error?.message || error));
  res.status(201).json({ok: true, product: createdProduct});
}));

// Exclusão lógica: o produto sai imediatamente da loja/Admin, mas o registro
// físico permanece como tombstone. Pedidos já reservados ainda precisam do
// produto para devolver/recomprometer estoque com segurança.
app.delete('/api/admin/products/:id', adminLimiter, adminCatalogWrite, asyncRoute(async (req, res) => {
  const productId = cleanText(req.params.id, 120);
  const deletedAt = new Date().toISOString();
  try {
    await repo.mutateCatalog(current => {
      let found = false;
      const products = (current.products || []).map(product => {
        if (product.id !== productId) return product;
        found = true;
        if (product.deletedAt) return product;
        return {...product, hidden: true, available: false, deletedAt, updated: Date.now()};
      });
      if (!found) throw new HttpError(404, 'Produto não encontrado.');
      return normalizeCatalog({...current, products});
    });
  } catch (error) {
    if (error instanceof HttpError) return res.status(error.status).json({error: error.message});
    return res.status(400).json({error: error?.message || 'Não foi possível excluir.'});
  }
  await auditAdmin(req, 'product_deleted', 'product', productId, {mode: 'soft-delete'});
  res.json({ok: true});
}));

// Personalização da loja: lê e grava apenas o bloco `settings` do catálogo
// (marca, textos, contatos, visual completo). A sanitização acontece no
// normalizeCatalog — nada além do permitido entra.
app.get('/api/admin/settings', adminLimiter, adminCatalogRead, asyncRoute(async (_req, res) => {
  const catalog = await repo.getCatalog();
  res.json({settings: catalog.settings || {}, revision: sectionRevision(catalog.settings || {})});
}));

app.put('/api/admin/settings', adminLimiter, adminCatalogWrite, adminCatalogJson, asyncRoute(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
    return res.status(400).json({error: 'Envie um objeto settings.'});
  }
  let next;
  try {
    next = await repo.mutateCatalog(current => {
      assertSectionRevision(body.revision, current.settings || {}, 'personalização');
      return normalizeCatalog({
        ...current,
        settings: {...current.settings, ...body.settings, visual: body.settings.visual ?? current.settings?.visual}
      });
    });
  } catch (error) {
    if (error?.code === 'SECTION_REVISION_CONFLICT') return res.status(409).json({code:error.code,error:error.message,revision:error.actualRevision});
    return res.status(400).json({error: error?.message || 'Personalização inválida.'});
  }
  await auditAdmin(req, 'settings_updated', 'catalog_settings', 'storefront');
  res.json({ok: true, settings: next.settings, revision: sectionRevision(next.settings || {})});
}));

app.patch('/api/admin/products/:id', adminLimiter, adminCatalogWrite, publicJson, asyncRoute(async (req, res) => {
  const productId = cleanText(req.params.id, 120);
  const patch = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const expectedRevision = cleanText(patch.expectedRevision, 128);
  const allowed = ['name', 'slug', 'price', 'description', 'unit', 'stock', 'stockMin', 'maxPerOrder', 'minPerOrder',
    'weightGrams', 'lengthCm', 'widthCm', 'heightCm', 'available', 'hidden', 'featured', 'department', 'subcategory', 'brand',
    'position', 'images', 'attributes', 'giftEnabled', 'sku', 'country', 'region', 'imported', 'restockDate', 'preparation',
    'madeToOrder', 'seasonal', 'boxes'];
  let next;
  try {
    // Atômico: lê o catálogo com lock, aplica o patch sobre o estado mais
    // recente (nunca sobre um snapshot velho) e salva na mesma transação.
    next = await repo.mutateCatalog(current => {
      const index = (current.products || []).findIndex(product => product.id === productId);
      if (index < 0) throw new HttpError(404, 'Produto não encontrado.');
      assertProductRevision(expectedRevision, current.products[index]);
      const product = {...current.products[index]};
      for (const key of allowed) {
        if (key in patch) product[key] = patch[key];
      }
      // Tombstones não podem ser ressuscitados por PATCH direto/cliente antigo.
      if (current.products[index].deletedAt) {
        product.deletedAt = current.products[index].deletedAt;
        product.hidden = true;
        product.available = false;
      }
      if (Array.isArray(patch.variants)) {
        const beforeVariants = product.variants || [];
        const existing = new Map(beforeVariants.map(variant => [variant.id, variant]));
        const incoming = patch.variants.slice(0, 100).map((variant, variantIndex) => {
          const requestedId = cleanText(variant?.id, 120);
          const currentVariant = requestedId ? existing.get(requestedId) : null;
          if (currentVariant?.deletedAt) throw new HttpError(409, 'Uma variação arquivada não pode ser reutilizada. Recarregue o produto e crie uma nova variação.');
          return {
            ...(currentVariant || {}),
            id: currentVariant?.id || newId('variant'),
            name: cleanText(variant?.name, 120),
            price: variant?.price,
            stock: variant?.stock ?? null,
            unit: cleanText(variant?.unit, 120),
            weightGrams: variant?.weightGrams ?? null,
            image: variant?.image,
            position: variantIndex + 1,
            deletedAt: null
          };
        });
        const incomingIds = new Set(incoming.map(variant => variant.id));
        const archived = beforeVariants
          .filter(variant => !incomingIds.has(variant.id))
          .map((variant, index) => ({
            ...variant,
            deletedAt: variant.deletedAt || new Date().toISOString(),
            position: incoming.length + index + 1
          }));
        product.variants = [...incoming, ...archived];
      }
      if ('boxes' in patch) validateShippingBoxes(product.boxes, product.variants || []);
      const nextProducts = [...current.products];
      nextProducts[index] = product;
      return normalizeCatalog({...current, products: nextProducts});
    });
  } catch (error) {
    if (error?.code === 'PRODUCT_REVISION_CONFLICT') return res.status(409).json({code:error.code,error:error.message,revision:error.actualRevision});
    if (error instanceof HttpError) return res.status(error.status).json({error: error.message});
    return res.status(400).json({error: error?.message || 'Produto inválido.'});
  }
  const internalUpdatedProduct = next.products.find(item => item.id === productId);
  const updatedProduct = internalUpdatedProduct ? {...internalUpdatedProduct, variants:(internalUpdatedProduct.variants||[]).filter(variant=>!variant.deletedAt), _revision:productRevision(internalUpdatedProduct)} : null;
  await auditAdmin(req, 'product_updated', 'product', productId, {fields: Object.keys(patch).slice(0, 50)});
  processRestockAlerts(next).catch(error => console.error('Falha ao processar avisos de reposição:', error?.message || error));
  res.json({ok: true, product: updatedProduct});
}));

app.get('/api/admin/coupons', adminLimiter, adminCatalogRead, asyncRoute(async (_req, res) => {
  const catalog = await repo.getCatalog();
  res.json({coupons: catalog.coupons || [], revision: sectionRevision(catalog.coupons || [])});
}));

app.put('/api/admin/coupons', adminLimiter, adminCatalogWrite, publicJson, asyncRoute(async (req, res) => {
  if (!Array.isArray(req.body?.coupons)) return res.status(400).json({error: 'Envie um array coupons.'});
  let next;
  try {
    next = await repo.mutateCatalog(current => { assertSectionRevision(req.body?.revision, current.coupons || [], 'cupons'); return normalizeCatalog({...current, coupons: req.body.coupons}); });
  } catch (error) {
    if (error?.code === 'SECTION_REVISION_CONFLICT') return res.status(409).json({code:error.code,error:error.message,revision:error.actualRevision});
    return res.status(400).json({error: error?.message || 'Cupons inválidos.'});
  }
  await auditAdmin(req, 'coupons_updated', 'catalog_coupons', 'storefront', {count: next.coupons.length});
  res.json({ok: true, coupons: next.coupons, revision: sectionRevision(next.coupons || [])});
}));

app.get('/api/admin/catalog', adminLimiter, adminCatalogRead, asyncRoute(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const catalog = await repo.getCatalog();
  res.json({catalog, revision: catalogRevision(catalog), products: catalog.products.filter(product => !product.deletedAt).length, archivedProducts: catalog.products.filter(product => product.deletedAt).length});
}));

app.put('/api/admin/catalog', adminLimiter, adminCatalogWrite, adminCatalogJson, asyncRoute(async (req, res) => {
  let next;
  try {
    next = await repo.mutateCatalog(current => {
      assertCatalogRevision(req.body?.revision, current);
      if (Array.isArray(req.body?.productOrderIds)) {
        const order = req.body.productOrderIds.map(value => cleanText(value, 120)).filter(Boolean);
        const active = current.products.filter(product => !product.deletedAt);
        const archived = current.products.filter(product => product.deletedAt);
        if (order.length !== active.length || new Set(order).size !== active.length) throw new Error('A ordem enviada precisa conter todos os produtos ativos exatamente uma vez.');
        const byId = new Map(active.map(product => [product.id, product]));
        if (order.some(id => !byId.has(id))) throw new Error('A ordem enviada contém produto desconhecido ou já excluído.');
        const ordered = order.map((id, index) => ({...byId.get(id), position: index + 1}));
        const tombstones = archived.map((product, index) => ({...product, hidden: true, available: false, position: ordered.length + index + 1}));
        return normalizeCatalog({...current, products: [...ordered, ...tombstones]});
      }
      let products = req.body?.products ?? current.products;
      if (Array.isArray(req.body?.products)) {
        const currentById = new Map(current.products.map(product => [product.id, product]));
        const incomingIds = new Set(req.body.products.map(product => cleanText(product?.id, 120)).filter(Boolean));
        // Uma importação completa também não pode apagar a âncora de estoque de
        // pedidos antigos. Omitidos viram tombstones; tombstones existentes não
        // podem ser ressuscitados implicitamente por JSON antigo.
        const incoming = req.body.products.map(product => {
          if (product?.boxes != null) validateShippingBoxes(product.boxes, product.variants || []);
          const previous = currentById.get(cleanText(product?.id, 120));
          if (previous?.deletedAt) return {...product, deletedAt: previous.deletedAt, hidden: true, available: false};
          if (!previous) return product;
          const previousVariants = previous.variants || [];
          const incomingVariants = Array.isArray(product?.variants) ? product.variants : [];
          const incomingVariantIds = new Set(incomingVariants.map(variant => cleanText(variant?.id, 120)).filter(Boolean));
          const mergedIncoming = incomingVariants.map(variant => {
            const old = previousVariants.find(item => item.id === cleanText(variant?.id, 120));
            return old?.deletedAt ? {...variant, deletedAt: old.deletedAt} : variant;
          });
          const archivedVariants = previousVariants
            .filter(variant => !incomingVariantIds.has(variant.id))
            .map(variant => ({...variant, deletedAt: variant.deletedAt || new Date().toISOString()}));
          return {...product, variants:[...mergedIncoming, ...archivedVariants]};
        });
        const omitted = current.products
          .filter(product => !incomingIds.has(product.id))
          .map(product => ({...product, hidden: true, available: false, deletedAt: product.deletedAt || new Date().toISOString()}));
        products = [...incoming, ...omitted];
      }
      return normalizeCatalog({
        version: Math.max(Number(current.version) || 1, Number(req.body?.version) || 0),
        settings: req.body?.settings ?? current.settings,
        commerce: req.body?.commerce ?? req.body?.v8 ?? current.commerce,
        coupons: req.body?.coupons ?? current.coupons,
        promotions: req.body?.promotions ?? current.promotions,
        products
      });
    });
  } catch (error) {
    if (error?.code === 'CATALOG_REVISION_CONFLICT') return res.status(409).json({code:error.code,error:error.message,revision:error.actualRevision});
    return res.status(400).json({error: error?.message || 'Catálogo inválido.'});
  }
  const activeProductCount = next.products.filter(product => !product.deletedAt).length;
  await auditAdmin(req, Array.isArray(req.body?.productOrderIds) ? 'catalog_reordered' : 'catalog_replaced', 'catalog', 'storefront', {products: activeProductCount, archivedProducts: next.products.length - activeProductCount});
  res.json({ok: true, products: activeProductCount, archivedProducts: next.products.length - activeProductCount, catalog: next, revision: catalogRevision(next)});
}));

app.get('/api/admin/audit', adminLimiter, adminAuditRead, asyncRoute(async (req, res) => {
  const entries = await repo.listAudit({limit: Number(req.query.limit) || 100});
  res.json({entries});
}));

app.get(['/admin', '/admin.html'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// Serve o index.html com metadados absolutos em produção. Crawlers não
// executam JavaScript, portanto canonical, Open Graph e JSON-LD precisam estar
// corretos no HTML bruto retornado pelo servidor.
let indexHtmlCache = null;
async function serveIndexHtml(res, statusCode = 200) {
  const base = config.publicUrl || (config.renderExternalHostname ? `https://${config.renderExternalHostname}` : '');
  if (config.env !== 'production') res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (!base) return res.status(statusCode).sendFile(path.join(publicDir, 'index.html'));
  if (!indexHtmlCache) {
    const raw = await readFile(path.join(publicDir, 'index.html'), 'utf8');
    indexHtmlCache = raw
      .replace(/<meta property="og:url" content="\/"\/>/, `<meta property="og:url" content="${base}/"/>`)
      .replace(/<link rel="canonical" href="\/"\/>/, `<link rel="canonical" href="${base}/"/>`)
      .replace(/<meta (property="og:image"|name="twitter:image") content="(\/assets\/[^"]+)"\/>/g,
        (_match, attr, url) => `<meta ${attr} content="${base}${url}"/>`)
      .replace('"@id":"#organization"', `"@id":"${base}/#organization"`)
      .replace('"logo":"/assets/icons/apple-touch-icon.png"', `"url":"${base}/","logo":"${base}/assets/icons/apple-touch-icon.png"`)
      .replace('"@id":"#website"', `"@id":"${base}/#website"`)
      .replace('"name":"INTEGRALL","publisher"', `"name":"INTEGRALL","url":"${base}/","publisher"`)
      .replace('"publisher":{"@id":"#organization"}', `"publisher":{"@id":"${base}/#organization"}`);
  }
  res.status(statusCode).setHeader('Cache-Control', 'no-cache');
  res.type('html').send(indexHtmlCache);
}


async function serveProductHtml(req, res) {
  const slug = slugify(req.params.slug);
  const catalog = await repo.getCatalog();
  const product = (catalog.products || []).find(item => item.slug === slug && !item.deletedAt && item.hidden !== true);
  if (!product) return res.status(404).sendFile(path.join(publicDir, '404.html'));
  const base = publicBaseUrl(req);
  const canonical = base ? `${base}/produto/${encodeURIComponent(product.slug)}` : `/produto/${encodeURIComponent(product.slug)}`;
  const imagePath = product.images?.[0] || '/assets/brand/integrall-hero-cover.webp';
  const image = /^https:\/\//i.test(imagePath) ? imagePath : (base ? `${base}${imagePath}` : imagePath);
  const primaryVariantId = (product.variants || []).find(variant => !variant.deletedAt)?.id || '';
  const pricing = productPrice(product, primaryVariantId, catalog.promotions || []);
  const description = cleanText(product.description || `${product.name} na INTEGRALL.`, 220);
  const stats = (await repo.reviewStats())[product.id] || {count: 0, average: 0};
  const availability = isStockAlertPurchasable(product, primaryVariantId) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
  const schema = {
    '@context': 'https://schema.org', '@type': 'Product', name: product.name, description,
    sku: product.sku || undefined, brand: product.brand ? {'@type':'Brand', name: product.brand} : undefined,
    image: (product.images || []).map(src => /^https:\/\//i.test(src) ? src : (base ? `${base}${src}` : src)).slice(0, 12),
    offers: pricing.unitPriceCents > 0 ? {'@type':'Offer', url: canonical, priceCurrency:'BRL', price:(pricing.unitPriceCents/100).toFixed(2), availability} : undefined,
    aggregateRating: stats.count ? {'@type':'AggregateRating', ratingValue:Number(stats.average).toFixed(1), reviewCount:stats.count} : undefined
  };
  const raw = await readFile(path.join(publicDir, 'index.html'), 'utf8');
  const title = `${htmlEscape(product.name)} | INTEGRALL`;
  let html = raw
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<meta name="description" content="[^"]*"\/>/, `<meta name="description" content="${htmlEscape(description)}"/>`)
    .replace(/<meta property="og:type" content="[^"]*"\/>/, '<meta property="og:type" content="product"/>')
    .replace(/<meta property="og:url" content="[^"]*"\/>/, `<meta property="og:url" content="${htmlEscape(canonical)}"/>`)
    .replace(/<meta property="og:title" content="[^"]*"\/>/, `<meta property="og:title" content="${title}"/>`)
    .replace(/<meta property="og:description" content="[^"]*"\/>/, `<meta property="og:description" content="${htmlEscape(description)}"/>`)
    .replace(/<meta property="og:image" content="[^"]*"\/>/, `<meta property="og:image" content="${htmlEscape(image)}"/>`)
    .replace(/<meta name="twitter:title" content="[^"]*"\/>/, `<meta name="twitter:title" content="${title}"/>`)
    .replace(/<meta name="twitter:description" content="[^"]*"\/>/, `<meta name="twitter:description" content="${htmlEscape(description)}"/>`)
    .replace(/<meta name="twitter:image" content="[^"]*"\/>/, `<meta name="twitter:image" content="${htmlEscape(image)}"/>`)
    .replace(/<link rel="canonical" href="[^"]*"\/>/, `<link rel="canonical" href="${htmlEscape(canonical)}"/>`)
    .replace('</head>', `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script></head>`);
  if (config.env !== 'production') res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.status(200).type('html').setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.send(html);
}

app.get('/produto/:slug', readLimiter, asyncRoute(serveProductHtml));

app.get('/', asyncRoute(async (_req, res) => serveIndexHtml(res)));
app.get('/index.html', asyncRoute(async (_req, res) => serveIndexHtml(res)));

app.get('/robots.txt', (_req, res) => {
  const base = config.publicUrl || (config.renderExternalHostname ? `https://${config.renderExternalHostname}` : '');
  res.type('text/plain').setHeader('Cache-Control', 'public, max-age=3600');
  if (config.env !== 'production') return res.send('User-agent: *\nDisallow: /\n');
  const sitemap = base ? `Sitemap: ${base}/sitemap.xml\n` : '';
  res.send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n${sitemap}`);
});

app.get('/sitemap.xml', asyncRoute(async (_req, res) => {
  const base = config.publicUrl || (config.renderExternalHostname ? `https://${config.renderExternalHostname}` : '');
  if (!base || config.env !== 'production') {
    res.setHeader('X-Robots-Tag', 'noindex');
    return res.status(404).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><error>Sitemap indisponível fora de produção.</error>');
  }
  const catalog = await repo.getCatalog();
  const changed = catalog?.commerce?.lastUpdated || '';
  const lastmod = /^\d{4}-\d{2}-\d{2}/.test(changed) ? `<lastmod>${changed.slice(0, 10)}</lastmod>` : '';
  const productUrls = (catalog.products || [])
    .filter(product => !product.deletedAt && product.hidden !== true && product.available !== false && product.slug)
    .map(product => `<url><loc>${base}/produto/${encodeURIComponent(product.slug)}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`)
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc>${lastmod}<changefreq>weekly</changefreq><priority>1.0</priority></url>${productUrls}</urlset>`;
  res.type('application/xml').setHeader('Cache-Control', 'public, max-age=3600');
  res.send(xml);
}));

app.use(express.static(publicDir, {
  index: 'index.html',
  etag: true,
  maxAge: 0,
  setHeaders(res, filePath) {
    if (/\/assets\//.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800');
    else if (/\.(css|js)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=3600');
    else if (/admin\.html$/.test(filePath)) res.setHeader('Cache-Control', 'no-store');
    else if (/\.html$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.use((req, res) => {
  if ((req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/api/')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.status(404).sendFile(path.join(publicDir, '404.html'));
  }
  res.status(404).json({code: 'ROUTE_NOT_FOUND', error: 'Rota não encontrada.'});
});

app.use((error, req, res, _next) => {
  if (res.headersSent) return res.end();
  let status = Number.isInteger(error?.status) ? error.status : 500;
  let code = String(error?.code || 'INTERNAL_ERROR').slice(0, 80);
  let message = error?.message || 'Erro interno do servidor.';
  if (error?.type === 'entity.too.large') {
    status = 413;
    code = 'REQUEST_TOO_LARGE';
    message = 'Corpo da requisição muito grande.';
  } else if (error instanceof SyntaxError && 'body' in error) {
    status = 400;
    code = 'INVALID_JSON';
    message = 'JSON inválido.';
  }
  if (status >= 500 && config.env === 'production') message = 'Erro interno do servidor.';
  logEvent('error', 'request_failed', {
    requestId: req.id,
    method: req.method,
    path: req.path,
    status,
    code,
    errorName: String(error?.name || 'Error').slice(0, 80),
    message: safeLogMessage(error?.message || error)
  });
  if (config.env !== 'production' && error?.stack) console.error(error.stack);
  const wantsHtml = !req.path.startsWith('/api/') && req.accepts(['html', 'json']) === 'html';
  if (wantsHtml && status >= 500) return res.status(status).sendFile(path.join(publicDir, '500.html'));
  res.status(status).json({code, error: message});
});

let expireTimer = null;
if (config.orderExpireDays > 0) {
  const sweep = () => {
    repo.expireStaleOrders(config.orderExpireDays)
      .then(expired => {
        if (!expired.length) return;
        logEvent('info', 'orders_expired', {count: expired.length, orderIds: expired.map(order => order.id)});
        // Notifica o cliente: sem isso, o pedido dele sumiria em silêncio.
        for (const order of expired) sendOrderEmail(order, 'status');
      })
      .catch(error => console.error('Falha na expiração automática de pedidos:', error?.message || error));
  };
  expireTimer = setInterval(sweep, 6 * 60 * 60 * 1000);
  expireTimer.unref();
  setTimeout(sweep, 30_000).unref();
}

let reservationTimer = null;
{
  const sweepReservations = () => repo.releaseExpiredReservations().then(async expired => {
    if (!expired.length) return;
    logEvent('info', 'inventory_reservations_released', {count: expired.length, orderIds: expired.map(order => order.id)});
    for (const order of expired) sendOrderEmail(order, 'status');
    await processRestockAlerts().catch(() => {});
  }).catch(error => console.error('Falha ao liberar reservas de estoque:', error?.message || error));
  reservationTimer = setInterval(sweepReservations, 60_000);
  reservationTimer.unref();
  setTimeout(sweepReservations, 10_000).unref();
}

const server = app.listen(config.port, () => {
  logEvent('info', 'server_started', {version: appVersion, port: config.port, persistence: repo.persistent ? 'postgresql' : 'local'});
  for (const warning of configWarnings()) console.warn(`[config] AVISO: ${warning}`);
});

async function shutdown(signal) {
  logEvent('info', 'server_shutdown', {signal});
  if (expireTimer) clearInterval(expireTimer);
  if (reservationTimer) clearInterval(reservationTimer);
  server.close(async () => {
    await repo.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
