import process from 'node:process';

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

export const config = Object.freeze({
  env: text('NODE_ENV', 'development'),
  port: int('PORT', 3000) ?? 3000,
  databaseUrl: text('DATABASE_URL'),
  publicUrl: text('PUBLIC_URL').replace(/\/$/, ''),
  renderExternalHostname: text('RENDER_EXTERNAL_HOSTNAME'),
  adminToken: text('ADMIN_API_TOKEN'),
  whatsappNumber: text('WHATSAPP_NUMBER').replace(/\D/g, ''),
  mercadoPagoAccessToken: text('MERCADO_PAGO_ACCESS_TOKEN'),
  mercadoPagoWebhookSecret: text('MERCADO_PAGO_WEBHOOK_SECRET'),
  mercadoPagoUseSandbox: bool('MERCADO_PAGO_USE_SANDBOX', false),
  mercadoPagoExpirationDays: Math.max(3, Math.min(30, int('MERCADO_PAGO_PAYMENT_EXPIRATION_DAYS', 3) ?? 3)),
  allowPaymentWithQuotedShipping: bool('ALLOW_PAYMENT_WITH_QUOTED_SHIPPING', false),
  shippingMode: text('SHIPPING_MODE'),
  shippingFixedCents: int('SHIPPING_FIXED_CENTS', null),
  freeShippingCents: int('FREE_SHIPPING_CENTS', null),
  trustProxy: bool('TRUST_PROXY', false)
});

export function assertProductionConfig() {
  if (config.env !== 'production') return;
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.adminToken || config.adminToken.length < 32) missing.push('ADMIN_API_TOKEN (mínimo: 32 caracteres)');
  if (config.mercadoPagoAccessToken && !config.mercadoPagoWebhookSecret) missing.push('MERCADO_PAGO_WEBHOOK_SECRET (obrigatório quando o Mercado Pago está ativo)');
  if (missing.length) throw new Error(`Configuração de produção incompleta: ${missing.join(', ')}`);
}
