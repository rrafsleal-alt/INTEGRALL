import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
export const SHIPPING_QUOTE_TTL_MS = 5 * 60 * 1000;
export function shippingError(code, message, status = 409) {
  return Object.assign(new Error(message), {code, status});
}
export function shippingFingerprint({cep, items, pack, subtotalCents, originCep, freeThreshold, services, declaredValue}) {
  const normalized = items.map(i => [i.productId, i.variantId || '', i.qty]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash('sha256').update(JSON.stringify({cep, items: normalized, pack: pack.packages, subtotalCents, originCep, freeThreshold, services, declaredValue})).digest('hex');
}
export function signShippingQuote(claims, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({...claims, issuedAt: now, expiresAt: now + SHIPPING_QUOTE_TTL_MS})).toString('base64url');
  const signature = createHmac('sha256', secret).update(`integrall-shipping-v1.${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}
export function verifyShippingQuote(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw shippingError('SHIPPING_QUOTE_REQUIRED', 'Calcule e selecione uma opção de frete antes de concluir.');
  }
  const [payload, sig] = token.split('.');
  const expected = createHmac('sha256', secret).update(`integrall-shipping-v1.${payload}`).digest();
  const supplied = Buffer.from(sig, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) throw shippingError('SHIPPING_QUOTE_INVALID', 'A cotação de frete é inválida. Calcule novamente.');
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw shippingError('SHIPPING_QUOTE_INVALID', 'A cotação de frete é inválida.'); }
  if (!Number.isSafeInteger(data.expiresAt) || !Number.isSafeInteger(data.issuedAt) || now >= data.expiresAt
    || data.issuedAt > now + 30_000 || data.expiresAt - data.issuedAt !== SHIPPING_QUOTE_TTL_MS) {
    throw shippingError('SHIPPING_QUOTE_EXPIRED', 'A cotação expirou. Calcule novamente antes de concluir.');
  }
  return data;
}
