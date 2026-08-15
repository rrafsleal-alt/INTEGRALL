import express from 'express';
import process from 'node:process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {config, assertProductionConfig} from './src/config.js';
import {normalizeCatalog, publicCatalog, buildOrder, ORDER_STATUSES, cleanText, findCoupon, validateCoupon, couponDiscount} from './src/catalog.js';
import {Repository} from './src/repository.js';
import {securityHeaders, adminAuth, rateLimit, safeEqual} from './src/security.js';
import {MercadoPagoService, InvalidWebhookSignatureError} from './src/payments.js';
import {evaluatePayment} from './src/payment-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const initialCatalog = normalizeCatalog(JSON.parse(await readFile(path.join(__dirname, 'data', 'catalog.json'), 'utf8')));
assertProductionConfig();

const repo = new Repository({databaseUrl: config.databaseUrl, initialCatalog, production: config.env === 'production'});
await repo.init();
const mercadoPago = new MercadoPagoService({
  accessToken: config.mercadoPagoAccessToken,
  webhookSecret: config.mercadoPagoWebhookSecret,
  sandbox: config.mercadoPagoUseSandbox,
  expirationDays: config.mercadoPagoExpirationDays
});

const app = express();
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
const publicJson = express.json({limit: '64kb', strict: true});
const adminCatalogJson = express.json({limit: '2mb', strict: true});

const orderLimiter = rateLimit({windowMs: 60_000, max: 20});
const statusLimiter = rateLimit({windowMs: 60_000, max: 60});
const paymentLimiter = rateLimit({windowMs: 60_000, max: 30});
const webhookLimiter = rateLimit({windowMs: 60_000, max: 180});
const adminLimiter = rateLimit({windowMs: 60_000, max: 90});
const admin = adminAuth(config.adminToken);

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function publicBaseUrl(req) {
  if (config.publicUrl) return config.publicUrl;
  if (config.renderExternalHostname) return `https://${config.renderExternalHostname}`;
  if (config.env === 'production') return '';
  return `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
}

function paymentCanStart(order) {
  return !['paid', 'preparing', 'ready', 'completed', 'refunded', 'chargeback', 'cancelled'].includes(order?.status);
}

function publicOrder(order) {
  return {
    id: order.id,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    discountCents: Number(order.discountCents) || 0,
    coupon: order.coupon?.code || '',
    trackingCode: order.trackingCode || '',
    trackingCarrier: order.trackingCarrier || '',
    trackingUrl: order.trackingUrl || '',
    totalCents: order.totalCents,
    requiresShippingQuote: Boolean(order.requiresShippingQuote),
    shipping: {
      choice: order.shipping?.choice || '',
      cep: order.shipping?.cep || '',
      label: order.shipping?.label || '',
      days: order.shipping?.days || ''
    },
    items: (order.items || []).map(item => ({
      name: item.name,
      variant: item.variant,
      qty: item.qty,
      lineTotalCents: item.lineTotalCents
    })),
    payment: {
      provider: order.payment?.provider || '',
      status: order.payment?.status || '',
      statusDetail: order.payment?.statusDetail || '',
      approvedAt: order.payment?.approvedAt || ''
    },
    history: (order.history || []).slice(-30).map(event => ({
      at: event.at,
      status: event.status,
      source: event.source,
      note: event.note || ''
    })),
    onlinePaymentAvailable: mercadoPago.configured && paymentCanStart(order) && !order.requiresShippingQuote
  };
}

function centsFromBody(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 100_000_000) return null;
  return number;
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const databaseHealth = await repo.health();
  res.json({
    ok: true,
    name: 'INTEGRALL API',
    version: '9.2.0',
    database: databaseHealth.mode,
    mercadoPago: mercadoPago.configured,
    adminConfigured: Boolean(config.adminToken),
    features: {
      persistentOrders: databaseHealth.mode === 'postgresql',
      orderTracking: true,
      inventoryOnPaid: true,
      shippingQuoteAdmin: true,
      customers: true
    },
    time: new Date().toISOString()
  });
}));

app.get('/api/catalog', asyncRoute(async (_req, res) => {
  const catalog = await repo.getCatalog();
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json(publicCatalog(catalog, config));
}));

app.post('/api/orders', orderLimiter, publicJson, asyncRoute(async (req, res) => {
  const catalog = await repo.getCatalog();
  let order;
  try {
    order = buildOrder(req.body, catalog, config);
  } catch (error) {
    return res.status(400).json({error: error?.message || 'Pedido inválido.'});
  }
  const result = await repo.createOrder(order);
  res.status(result.created ? 201 : 200).json({
    order: {
      id: result.order.id,
      status: result.order.status,
      subtotalCents: result.order.subtotalCents,
      shippingCents: result.order.shippingCents,
      discountCents: Number(result.order.discountCents) || 0,
      coupon: result.order.coupon?.code || '',
      totalCents: result.order.totalCents,
      requiresShippingQuote: result.order.requiresShippingQuote,
      checkoutToken: result.order.checkoutToken,
      onlinePaymentAvailable: mercadoPago.configured && !result.order.requiresShippingQuote
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
  if (!mercadoPago.configured) return res.status(503).json({error: 'Pagamento online ainda não está configurado.'});
  const orderId = cleanText(req.body?.orderId, 100);
  const checkoutToken = cleanText(req.body?.checkoutToken, 128);
  if (!orderId || !checkoutToken) return res.status(400).json({error: 'orderId e checkoutToken são obrigatórios.'});
  const order = await repo.getOrder(orderId);
  if (!order || !safeEqual(checkoutToken, order.checkoutToken)) return res.status(404).json({error: 'Pedido não encontrado.'});
  if (!paymentCanStart(order)) return res.status(409).json({error: 'Este pedido não aceita um novo pagamento.'});
  if (order.requiresShippingQuote && !config.allowPaymentWithQuotedShipping) {
    return res.status(409).json({error: 'O frete deste pedido ainda precisa ser definido antes do pagamento online.'});
  }
  const base = publicBaseUrl(req);
  if (!/^https:\/\//i.test(base)) return res.status(503).json({error: 'Configure PUBLIC_URL com HTTPS antes de habilitar o Mercado Pago.'});

  const attempt = Math.max(1, Math.min(99, Number(order.payment?.attempt || 0) + 1));
  const checkout = await mercadoPago.createCheckout(order, base, attempt);
  await repo.updateOrder(order.id, {
    status: 'awaiting_payment',
    payment: {provider: 'mercadopago', preferenceId: checkout.id, status: 'pending', statusDetail: '', attempt}
  }, {source: 'payment', note: `Pagamento Mercado Pago iniciado (tentativa ${attempt}).`});
  res.json({url: checkout.url, preferenceId: checkout.id, orderId: order.id});
}));

app.post('/api/webhooks/mercadopago', webhookLimiter, publicJson, asyncRoute(async (req, res) => {
  const dataId = req.query['data.id'] || req.body?.data?.id;
  const type = req.query.type || req.body?.type;
  if (type && type !== 'payment') return res.status(200).json({ok: true, ignored: true});
  if (!dataId) return res.status(400).json({error: 'data.id ausente.'});

  try {
    mercadoPago.validateWebhook({
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

  const evaluation = evaluatePayment(order, payment);
  if (!evaluation.shouldUpdate) {
    return res.status(200).json({ok: true, ignored: true, ...(evaluation.warning ? {warning: evaluation.warning} : {})});
  }

  await repo.updateOrder(order.id, {
    status: evaluation.nextStatus,
    payment: {
      provider: 'mercadopago',
      preferenceId: order.payment?.preferenceId || payment.preference_id || '',
      paymentId: String(payment.id),
      status: evaluation.paymentStatus,
      statusDetail: cleanText(payment.status_detail, 160),
      approvedAt: payment.date_approved || '',
      refundedCents: Math.round(Number(payment.transaction_amount_refunded || 0) * 100)
    }
  }, {
    source: 'mercadopago-webhook',
    note: `Pagamento atualizado para ${evaluation.paymentStatus || payment.status || 'desconhecido'}.`
  });
  res.status(200).json({ok: true});
}));

app.get('/api/admin/orders', adminLimiter, admin, asyncRoute(async (req, res) => {
  const status = cleanText(req.query.status, 30);
  const search = cleanText(req.query.search, 120);
  const orders = await repo.listOrders({status, search, limit: Number(req.query.limit) || 300});
  res.json({orders});
}));

app.get('/api/admin/orders/:id', adminLimiter, admin, asyncRoute(async (req, res) => {
  const order = await repo.getOrder(cleanText(req.params.id, 100));
  if (!order) return res.status(404).json({error: 'Pedido não encontrado.'});
  res.json({order});
}));

app.patch('/api/admin/orders/:id', adminLimiter, admin, publicJson, asyncRoute(async (req, res) => {
  const status = cleanText(req.body?.status, 30);
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({error: 'Status inválido.'});
  const order = await repo.updateOrder(cleanText(req.params.id, 100), {status}, {source: 'admin', note: cleanText(req.body?.note, 300) || 'Status alterado pelo painel administrativo.'});
  if (!order) return res.status(404).json({error: 'Pedido não encontrado.'});
  res.json({order});
}));

app.patch('/api/admin/orders/:id/shipping', adminLimiter, admin, publicJson, asyncRoute(async (req, res) => {
  const orderId = cleanText(req.params.id, 100);
  const order = await repo.getOrder(orderId);
  if (!order) return res.status(404).json({error: 'Pedido não encontrado.'});
  if (order.shipping?.choice !== 'delivery') return res.status(409).json({error: 'Este pedido é para retirada e não precisa de cotação de frete.'});
  if (['paid', 'preparing', 'ready', 'completed', 'refunded', 'chargeback'].includes(order.status)) {
    return res.status(409).json({error: 'O frete não pode ser alterado depois da confirmação financeira/operacional.'});
  }
  const shippingCents = centsFromBody(req.body?.shippingCents);
  if (shippingCents == null) return res.status(400).json({error: 'Informe o frete em centavos (zero ou valor positivo).'});
  const label = cleanText(req.body?.label, 160) || 'Frete confirmado pela loja';
  const totalCents = Number(order.subtotalCents || 0) + shippingCents - (Number(order.discountCents) || 0);
  if (totalCents <= 0) return res.status(400).json({error: 'O frete informado deixaria o total do pedido inválido.'});
  const updated = await repo.updateOrder(orderId, {
    shipping: {priceCents: shippingCents, quoted: false, label},
    shippingCents,
    totalCents,
    requiresShippingQuote: false
  }, {source: 'admin', note: `Frete definido em ${shippingCents} centavos.`});
  res.json({order: updated});
}));

app.patch('/api/admin/orders/:id/tracking', adminLimiter, admin, publicJson, asyncRoute(async (req, res) => {
  const orderId = cleanText(req.params.id, 100);
  const order = await repo.getOrder(orderId);
  if (!order) return res.status(404).json({error: 'Pedido não encontrado.'});
  if (order.shipping?.choice !== 'delivery') return res.status(409).json({error: 'Este pedido é para retirada e não possui envio.'});
  const trackingCode = cleanText(req.body?.trackingCode, 80).toUpperCase();
  const trackingCarrier = cleanText(req.body?.trackingCarrier, 80);
  let trackingUrl = cleanText(req.body?.trackingUrl, 500);
  if (trackingUrl && !/^https:\/\/[^\s]+$/i.test(trackingUrl)) return res.status(400).json({error: 'O link de rastreio precisa ser uma URL HTTPS.'});
  if (!trackingUrl && trackingCode) trackingUrl = `https://rastreamento.correios.com.br/app/index.php?objetos=${encodeURIComponent(trackingCode)}`;
  const note = trackingCode
    ? `Código de rastreio informado: ${trackingCode}${trackingCarrier ? ` (${trackingCarrier})` : ''}.`
    : 'Código de rastreio removido.';
  const updated = await repo.updateOrder(orderId, {
    trackingCode,
    trackingCarrier,
    trackingUrl: trackingCode ? trackingUrl : ''
  }, {source: 'admin', note});
  res.json({order: updated});
}));

app.get('/api/admin/customers', adminLimiter, admin, asyncRoute(async (req, res) => {
  const search = cleanText(req.query.search, 120);
  const customers = await repo.listCustomers({search, limit: Number(req.query.limit) || 300});
  res.json({customers});
}));

app.get('/api/admin/coupons', adminLimiter, admin, asyncRoute(async (_req, res) => {
  const catalog = await repo.getCatalog();
  res.json({coupons: catalog.coupons || []});
}));

app.put('/api/admin/coupons', adminLimiter, admin, publicJson, asyncRoute(async (req, res) => {
  if (!Array.isArray(req.body?.coupons)) return res.status(400).json({error: 'Envie um array coupons.'});
  const current = await repo.getCatalog();
  let next;
  try {
    next = normalizeCatalog({...current, coupons: req.body.coupons});
  } catch (error) {
    return res.status(400).json({error: error?.message || 'Cupons inválidos.'});
  }
  await repo.saveCatalog(next);
  res.json({ok: true, coupons: next.coupons});
}));

app.put('/api/admin/catalog', adminLimiter, admin, adminCatalogJson, asyncRoute(async (req, res) => {
  const current = await repo.getCatalog();
  let next;
  try {
    next = normalizeCatalog({
      version: 9,
      settings: req.body?.settings ?? current.settings,
      commerce: req.body?.commerce ?? req.body?.v8 ?? current.commerce,
      coupons: req.body?.coupons ?? current.coupons,
      products: req.body?.products ?? current.products
    });
  } catch (error) {
    return res.status(400).json({error: error?.message || 'Catálogo inválido.'});
  }
  await repo.saveCatalog(next);
  res.json({ok: true, products: next.products.length, catalog: publicCatalog(next, config)});
}));

app.get('/admin', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'admin.html'));
});

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
  if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.status(404).sendFile(path.join(publicDir, 'index.html'));
  res.status(404).json({error: 'Rota não encontrada.'});
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.type === 'entity.too.large') return res.status(413).json({error: 'Corpo da requisição muito grande.'});
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({error: 'JSON inválido.'});
  const message = config.env === 'production' ? 'Erro interno do servidor.' : (error?.message || 'Erro interno do servidor.');
  res.status(500).json({error: message});
});

const server = app.listen(config.port, () => {
  console.log(`INTEGRALL v9.2 em http://localhost:${config.port} (${repo.persistent ? 'PostgreSQL' : 'memória de desenvolvimento'})`);
});

async function shutdown(signal) {
  console.log(`Encerrando (${signal})…`);
  server.close(async () => {
    await repo.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
