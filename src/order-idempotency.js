import {createHash} from 'node:crypto';
import {cleanText} from './catalog.js';

export const CLIENT_ORDER_KEY_MIN_LENGTH = 32;
export const CLIENT_ORDER_KEY_MAX_LENGTH = 160;

export function normalizeClientOrderKey(value) {
  const key = String(value ?? '').trim();
  if (!key) return '';
  if (key.length < CLIENT_ORDER_KEY_MIN_LENGTH || key.length > CLIENT_ORDER_KEY_MAX_LENGTH) {
    const error = new Error('A chave de idempotência do pedido é inválida. Atualize a página e tente novamente.');
    error.code = 'CLIENT_ORDER_KEY_INVALID';
    throw error;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(key)) {
    const error = new Error('A chave de idempotência do pedido é inválida. Atualize a página e tente novamente.');
    error.code = 'CLIENT_ORDER_KEY_INVALID';
    throw error;
  }
  return key;
}

export function hashClientOrderKey(value) {
  const key = normalizeClientOrderKey(value);
  return key ? createHash('sha256').update(key, 'utf8').digest('hex') : '';
}



function hashIntentObject(intent) {
  return createHash('sha256').update(JSON.stringify(intent), 'utf8').digest('hex');
}

export function hashOrderRequestIntent(payload) {
  const items = (Array.isArray(payload?.items) ? payload.items : []).slice(0, 100).map(item => ({
    productId: cleanText(item?.productId, 120),
    variantId: cleanText(item?.variantId, 120),
    qty: Number(item?.qty) || 0,
    gift: Boolean(item?.gift),
    giftMessage: Boolean(item?.gift) ? cleanText(item?.giftMessage, 240) : ''
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const choice = payload?.shipping?.choice === 'pickup' ? 'pickup' : payload?.shipping?.choice === 'delivery' ? 'delivery' : cleanText(payload?.shipping?.choice, 20);
  const intent = {
    customer: {
      name: cleanText(payload?.customer?.name, 80),
      email: cleanText(payload?.customer?.email, 254),
      phone: cleanText(payload?.customer?.phone, 30),
      note: cleanText(payload?.customer?.note, 500)
    },
    shipping: {
      choice,
      ...(choice === 'delivery' && payload?.shipping?.service ? {service: cleanText(payload.shipping.service, 20)} : {}),
      ...(choice === 'delivery' && payload?.shipping?.manualQuote === true ? {manualQuote: true} : {}),
      cep: choice === 'pickup' ? '' : cleanText(payload?.shipping?.cep, 30).replace(/\D/g, '').slice(0, 8),
      street: choice === 'delivery' ? cleanText(payload?.shipping?.street, 180) : '',
      number: choice === 'delivery' ? cleanText(payload?.shipping?.number, 40) : '',
      complement: choice === 'delivery' ? cleanText(payload?.shipping?.complement, 120) : '',
      neighborhood: choice === 'delivery' ? cleanText(payload?.shipping?.neighborhood, 120) : '',
      city: choice === 'delivery' ? cleanText(payload?.shipping?.city, 120) : '',
      state: choice === 'delivery' ? cleanText(payload?.shipping?.state, 2).toUpperCase() : ''
    },
    items,
    couponCode: cleanText(payload?.couponCode, 40).toUpperCase(),
    ageConfirmed: Boolean(payload?.ageConfirmed)
  };
  return hashIntentObject(intent);
}

export function hashOrderIntent(order) {
  const items = (Array.isArray(order?.items) ? order.items : []).map(item => ({
    productId: String(item?.productId || ''),
    variantId: String(item?.variantId || ''),
    qty: Number(item?.qty) || 0,
    gift: Boolean(item?.gift),
    giftMessage: String(item?.giftMessage || '')
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const intent = {
    customer: {
      name: String(order?.customer?.name || ''),
      email: String(order?.customer?.email || ''),
      phone: String(order?.customer?.phone || ''),
      note: String(order?.customer?.note || '')
    },
    shipping: {
      choice: String(order?.shipping?.choice || ''),
      ...(order?.shipping?.service ? {service: String(order.shipping.service)} : {}),
      cep: String(order?.shipping?.cep || ''),
      street: String(order?.shipping?.street || ''),
      number: String(order?.shipping?.number || ''),
      complement: String(order?.shipping?.complement || ''),
      neighborhood: String(order?.shipping?.neighborhood || ''),
      city: String(order?.shipping?.city || ''),
      state: String(order?.shipping?.state || '')
    },
    items,
    couponCode: String(order?.coupon?.code || ''),
    ageConfirmed: Boolean(order?.ageConfirmed)
  };
  return createHash('sha256').update(JSON.stringify(intent), 'utf8').digest('hex');
}

export function idempotencyOwnership(existingOrder, requestKeyHash, requestPayloadHash = '', safeCompare = (a, b) => a === b) {
  const storedHash = String(existingOrder?.clientOrderKeyHash || '');
  if (!storedHash) return {ok: false, code: 'IDEMPOTENCY_OWNERSHIP_REQUIRED'};
  if (!requestKeyHash || !safeCompare(requestKeyHash, storedHash)) return {ok: false, code: 'IDEMPOTENCY_CONFLICT'};
  const storedPayloadHash = String(existingOrder?.clientOrderRequestHash || existingOrder?.clientOrderPayloadHash || '');
  if (!storedPayloadHash || !requestPayloadHash || !safeCompare(requestPayloadHash, storedPayloadHash)) {
    return {ok: false, code: 'IDEMPOTENCY_PAYLOAD_MISMATCH'};
  }
  return {ok: true, code: ''};
}
