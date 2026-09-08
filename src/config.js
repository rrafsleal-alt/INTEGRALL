import process from 'node:process';
import {randomBytes} from 'node:crypto';

// Credencial padrão solicitada para garantir o primeiro acesso ao editor.
// A senha nunca fica em texto puro no código: somente o hash scrypt é armazenado.
const DEFAULT_ADMIN_EMAIL = 'admin@integrall.local';
const DEFAULT_ADMIN_PASSWORD_HASH = 'scrypt$32768$8$1$kl5XPhtAyxTz2pU0MBydlg$3LcI-tTNygXiOaULs-bPEXuEyYF4X5DTuuWfVv8oX6H1mXF1e_E7tK7_aO7CIvskjY_tKnA3LDw_3GRzbBa-ng';
const DEFAULT_ADMIN_SESSION_SECRET = randomBytes(48).toString('base64url');

function bool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function int(name, fallback = null) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function text(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

export function isValidPublicUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && (url.pathname === '/' || url.pathname === '');
  } catch { return false; }
}

function base64Text(name) {
  const value = text(name);
  if (!value) return '';
  try { return Buffer.from(value, 'base64').toString('utf8'); }
  catch { return ''; }
}

const configuredAdminEmail = text('ADMIN_EMAIL').toLowerCase();
const configuredAdminPasswordHash = text('ADMIN_PASSWORD_HASH');
const configuredAdminSessionSecret = text('ADMIN_SESSION_SECRET');
const configuredCustomerAuthSecret = text('CUSTOMER_AUTH_SECRET');
const defaultAdminLoginRequested = bool('ADMIN_DEFAULT_LOGIN_ENABLED', true);
const useBuiltInAdminPassword = defaultAdminLoginRequested;

export const config = Object.freeze({
  env: text('NODE_ENV', 'development'),
  port: int('PORT', 3000) ?? 3000,
  databaseUrl: text('DATABASE_URL'),
  databaseSslMode: text('DATABASE_SSL_MODE', text('NODE_ENV', 'development') === 'production' ? 'verify-full' : 'disable').toLowerCase(),
  databaseCa: base64Text('DATABASE_CA_BASE64'),
  publicUrl: text('PUBLIC_URL').replace(/\/$/, ''),
  renderExternalHostname: text('RENDER_EXTERNAL_HOSTNAME'),
  whatsappNumber: text('WHATSAPP_NUMBER').replace(/\D/g, ''),
  mercadoPagoAccessToken: text('MERCADO_PAGO_ACCESS_TOKEN'),
  mercadoPagoWebhookSecret: text('MERCADO_PAGO_WEBHOOK_SECRET'),
  mercadoPagoUseSandbox: bool('MERCADO_PAGO_USE_SANDBOX', false),
  mercadoPagoExpirationDays: Math.max(1, Math.min(30, int('MERCADO_PAGO_PAYMENT_EXPIRATION_DAYS', 3) ?? 3)),
  allowPaymentWithQuotedShipping: bool('ALLOW_PAYMENT_WITH_QUOTED_SHIPPING', false),
  shippingMode: text('SHIPPING_MODE'),
  shippingFixedCents: int('SHIPPING_FIXED_CENTS', null),
  freeShippingCents: int('FREE_SHIPPING_CENTS', null),
  trustProxy: bool('TRUST_PROXY', false),

  // Um único modo de autenticação é ativo. No modo padrão, hashes legados
  // não substituem nem coexistem com a credencial inicial. Para usar um hash
  // próprio, desative explicitamente ADMIN_DEFAULT_LOGIN_ENABLED. Produção
  // continua recusando o modo padrão, independentemente do hash no ambiente.
  adminEmail: configuredAdminEmail || DEFAULT_ADMIN_EMAIL,
  adminPasswordHash: useBuiltInAdminPassword ? DEFAULT_ADMIN_PASSWORD_HASH : configuredAdminPasswordHash,
  adminDefaultLoginEnabled: useBuiltInAdminPassword,
  adminUsesBuiltInPasswordHash: useBuiltInAdminPassword,
  adminUsesBuiltInSessionSecret: !configuredAdminSessionSecret,
  adminRole: text('ADMIN_ROLE', 'admin').toLowerCase(),
  adminSessionSecret: configuredAdminSessionSecret || DEFAULT_ADMIN_SESSION_SECRET,
  adminSessionHours: Math.max(1, Math.min(24, int('ADMIN_SESSION_HOURS', 8) ?? 8)),

  // Correios (API de contrato / CWS)
  correiosUser: text('CORREIOS_USER'),
  correiosAccessCode: text('CORREIOS_ACCESS_CODE'),
  correiosPostageCard: text('CORREIOS_POSTAGE_CARD'),
  correiosContract: text('CORREIOS_CONTRACT'),
  correiosAuthType: text('CORREIOS_AUTH_TYPE', 'auto').toLowerCase(),
  correiosContractDr: int('CORREIOS_DR', null),
  correiosDeclaredValue: bool('CORREIOS_DECLARED_VALUE', false),
  correiosQuoteMethod: text('CORREIOS_QUOTE_METHOD', 'GET').toUpperCase(),
  shippingQuoteSecret: text('SHIPPING_QUOTE_SECRET') || configuredAdminSessionSecret || DEFAULT_ADMIN_SESSION_SECRET,
  correiosOriginCep: text('CORREIOS_ORIGIN_CEP').replace('-', ''),
  correiosServices: text('CORREIOS_SERVICES'),
  correiosHomolog: bool('CORREIOS_HOMOLOG', false) || text('CORREIOS_BASE_URL').replace(/\/$/, '') === 'https://apihom.correios.com.br',
  correiosBaseUrl: text('CORREIOS_BASE_URL'),
  correiosApiVersion: text('CORREIOS_API_VERSION'),

  // Jadlog (API Embarcador)
  jadlogToken: text('JADLOG_TOKEN'),
  jadlogCnpj: text('JADLOG_CNPJ').replace(/\D/g, ''),
  jadlogConta: text('JADLOG_CONTA'),
  jadlogContrato: text('JADLOG_CONTRATO'),
  jadlogModalidade: int('JADLOG_MODALIDADE', 3) ?? 3,
  jadlogTpEntrega: text('JADLOG_TP_ENTREGA', 'D').toUpperCase() === 'R' ? 'R' : 'D',
  jadlogTpSeguro: text('JADLOG_TP_SEGURO', 'N').toUpperCase() === 'A' ? 'A' : 'N',
  jadlogBaseUrl: text('JADLOG_BASE_URL'),

  // Regra de divisão entre transportadoras: até N unidades → Correios;
  // acima de N unidades → Jadlog. 0 desativa (todas cotam sempre).
  carrierSplitUnits: Math.max(0, Math.min(999, int('CARRIER_SPLIT_UNITS', 12) ?? 12)),

  // E-mail transacional (SMTP)
  smtpHost: text('SMTP_HOST'),
  smtpPort: int('SMTP_PORT', 587) ?? 587,
  smtpUser: text('SMTP_USER'),
  smtpPassword: text('SMTP_PASSWORD'),
  smtpFrom: text('SMTP_FROM'),
  smtpFromName: text('SMTP_FROM_NAME', 'INTEGRALL'),
  smtpReplyTo: text('SMTP_REPLY_TO'),
  smtpSecure: bool('SMTP_SECURE', false),

  // Expiração automática de pedidos não pagos (0 desativa)
  orderExpireDays: Math.max(0, Math.min(90, int('ORDER_EXPIRE_DAYS', 7) ?? 7)),

  // Reserva transacional de estoque e conta do cliente.
  inventoryReservationMinutes: Math.max(5, Math.min(120, int('INVENTORY_RESERVATION_MINUTES', 15) ?? 15)),
  customerLoginCodeMinutes: Math.max(5, Math.min(30, int('CUSTOMER_LOGIN_CODE_MINUTES', 10) ?? 10)),
  customerSessionDays: Math.max(1, Math.min(90, int('CUSTOMER_SESSION_DAYS', 30) ?? 30)),
  customerAuthSecret: configuredCustomerAuthSecret || configuredAdminSessionSecret || DEFAULT_ADMIN_SESSION_SECRET,
  customerAuthUsesSharedSecret: !configuredCustomerAuthSecret && Boolean(configuredAdminSessionSecret),
  customerAuthUsesBuiltInSecret: !configuredCustomerAuthSecret && !configuredAdminSessionSecret
});

export function assertProductionConfig() {
  if (config.env !== 'production') return;
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!['disable', 'require', 'verify-full'].includes(config.databaseSslMode)) missing.push('DATABASE_SSL_MODE (disable, require ou verify-full)');
  if (config.databaseSslMode === 'disable') missing.push('DATABASE_SSL_MODE seguro em produção (verify-full recomendado)');
  if (!isValidPublicUrl(config.publicUrl)) missing.push('PUBLIC_URL (origem HTTPS, sem caminho/query/hash)');
  if (!config.adminEmail) missing.push('ADMIN_EMAIL');
  if (!config.adminPasswordHash || config.adminUsesBuiltInPasswordHash) missing.push('ADMIN_PASSWORD_HASH (credencial inicial permitida somente fora de produção)');
  if (config.adminUsesBuiltInSessionSecret || config.adminSessionSecret.length < 32) missing.push('ADMIN_SESSION_SECRET (mínimo 32 caracteres aleatórios e persistentes)');
  if (config.customerAuthUsesBuiltInSecret || config.customerAuthSecret.length < 32) missing.push('CUSTOMER_AUTH_SECRET (mínimo 32 caracteres aleatórios e persistentes)');
  if (!['admin', 'editor', 'operator'].includes(config.adminRole)) missing.push('ADMIN_ROLE (admin, editor ou operator)');
  if (config.mercadoPagoAccessToken && !config.mercadoPagoWebhookSecret) missing.push('MERCADO_PAGO_WEBHOOK_SECRET (obrigatório quando o Mercado Pago está ativo)');
  if (config.shippingMode === 'correios' && config.correiosBaseUrl && !['https://api.correios.com.br', 'https://apihom.correios.com.br'].includes(config.correiosBaseUrl.replace(/\/$/, ''))) missing.push('CORREIOS_BASE_URL (somente hosts oficiais HTTPS)');
  if (config.shippingMode === 'correios' && config.shippingQuoteSecret.length < 32) missing.push('SHIPPING_QUOTE_SECRET (mínimo 32 caracteres, ou herdar ADMIN_SESSION_SECRET)');
  if (config.shippingMode === 'correios' && config.correiosHomolog) missing.push('CORREIOS_HOMOLOG=false (não publicar tarifas de teste em produção)');
  if (missing.length) throw new Error(`Configuração de produção incompleta: ${missing.join(', ')}`);
}

/**
 * Avisos de coerência entre configurações (não bloqueiam o boot, mas
 * denunciam combinações que degradam a operação silenciosamente).
 */
export function configWarnings() {
  const warnings = [];
  if (!['disable', 'require', 'verify-full'].includes(config.databaseSslMode)) {
    warnings.push('DATABASE_SSL_MODE inválido; use disable, require ou verify-full.');
  } else if (config.env === 'production' && config.databaseSslMode === 'require') {
    warnings.push('DATABASE_SSL_MODE=require cifra a conexão, mas não valida o certificado; prefira verify-full.');
  }
  if (!config.adminEmail || !config.adminPasswordHash || config.adminSessionSecret.length < 32) {
    warnings.push('Administração desativada: configure ADMIN_EMAIL, ADMIN_PASSWORD_HASH e ADMIN_SESSION_SECRET.');
  } else {
    if (config.adminUsesBuiltInPasswordHash) warnings.push('Credencial administrativa inicial ativa; configure ADMIN_PASSWORD_HASH e desative o acesso inicial após o primeiro uso.');
    if (config.adminUsesBuiltInPasswordHash && configuredAdminPasswordHash) warnings.push('Modo padrão ativo: o hash personalizado está inativo. Para utilizá-lo, defina ADMIN_DEFAULT_LOGIN_ENABLED=false.');
    if (config.adminUsesBuiltInSessionSecret) warnings.push('ADMIN_SESSION_SECRET temporário em uso; defina um segredo exclusivo e persistente. Em produção, a aplicação recusará iniciar sem ele.');
  }
  if (config.customerAuthUsesBuiltInSecret) warnings.push('CUSTOMER_AUTH_SECRET temporário em uso; códigos de acesso pendentes serão invalidados ao reiniciar.');
  else if (config.customerAuthUsesSharedSecret) warnings.push('CUSTOMER_AUTH_SECRET não definido; a conta do cliente compartilha ADMIN_SESSION_SECRET. Funciona, mas um segredo separado reduz o impacto de uma eventual rotação.');
  if (config.publicUrl && !isValidPublicUrl(config.publicUrl)) {
    warnings.push(config.env === 'production'
      ? 'PUBLIC_URL inválida: use somente a origem HTTPS, por exemplo https://loja.exemplo.com.'
      : 'PUBLIC_URL não é uma origem HTTPS limpa; fora de produção isso é permitido, mas URLs/callbacks podem ficar incoerentes.');
  }
  if (config.shippingMode === 'correios') {
    const correiosReady = config.correiosUser && config.correiosAccessCode && (config.correiosAuthType === 'contrato' ? config.correiosContract : config.correiosAuthType === 'cartaopostagem' ? config.correiosPostageCard : config.correiosContract || config.correiosPostageCard) && /^\d{8}$/.test(config.correiosOriginCep);
    const jadlogReady = config.jadlogToken && config.jadlogCnpj.length === 14 && config.correiosOriginCep.length === 8;
    if (!correiosReady && !jadlogReady) {
      warnings.push('SHIPPING_MODE=correios sem credenciais completas de Correios nem Jadlog: a cotação automática será bloqueada; o cliente poderá solicitar frete a confirmar explicitamente.');
    }
  }
  if (config.orderExpireDays > 0 && config.mercadoPagoAccessToken && config.orderExpireDays < config.mercadoPagoExpirationDays) {
    warnings.push(`ORDER_EXPIRE_DAYS (${config.orderExpireDays}) é menor que a expiração da preferência do Mercado Pago (${config.mercadoPagoExpirationDays} dias): pedidos podem ser cancelados com link de pagamento ainda ativo (a proteção approved_after_cancel cobre, mas gera revisão manual).`);
  }
  if (config.smtpHost && (!config.smtpUser || !config.smtpPassword || !config.smtpFrom)) {
    warnings.push('SMTP_HOST definido mas SMTP_USER/SMTP_PASSWORD/SMTP_FROM incompletos: nenhum e-mail será enviado.');
  }
  return warnings;
}
