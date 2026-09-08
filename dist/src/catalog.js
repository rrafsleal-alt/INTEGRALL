import {randomBytes} from 'node:crypto';
import {normalizeShippingCep} from './shipping-packages.js';
import {applyRecoveredCatalogRepairs} from './recovered-catalog.js';

const clone = value => JSON.parse(JSON.stringify(value));
const controlChars = /[\u0000-\u001F\u007F]/g;
const multilineControlChars = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const VISUAL_ASSET_KEYS = ['headerLogo','footerLogo','favicon','heroBackground','headerBackground','footerBackground','pageBackground'];
const VISUAL_COLOR_KEYS = ['page','surface','surfaceAlt','surfaceMuted','primary','primaryHover','accent','text','muted','line','danger','success','buttonText','headerBackground','footerBackground','cardBackground','inputBackground','heroText','heroOverlay','headerText','headerMuted','footerText','footerMuted','footerHeading','footerAccent','price','badgeBackground','badgeText','outOfStockBackground','outOfStockText','overlay'];
const VISUAL_TYPOGRAPHY_KEYS = ['bodyFont','headingFont','customBody','customHeading','baseSize','bodyWeight','headingWeight','lineHeight','headingScale','navSize','navSpacing','brandSpacing','navTransform'];
const VISUAL_LAYOUT_KEYS = ['maxWidth','gutterDesktop','gutterMobile','headerLayout','headerSticky','headerPadding','navGap','headerOrder','catalogAlign','catalogTop','catalogBottom','introMaxWidth','blocks','toolbarLayout','gridColumnsDesktop','gridColumnsTablet','gridColumnsMobile','gridGapX','gridGapY','cardStyle','cardAlign','cardPadding','imageRatio','imageFit','radius','buttonRadius','inputRadius','shadow','footerAlign','footerOrder','headerLogoMode','footerLogoMode','headerLogoWidth','footerLogoWidth','heroMode','heroPadding','heroRadius','animations'];
const VISUAL_VISIBILITY_KEYS = ['category','unit','stock','quickAdd','search','filters','resultCount','footerDescription','footerContact','headerBrand','headerNav','headerActions','intro','filterBlock','products','footerLogo'];
const PRODUCT_ATTRIBUTE_KEYS = ['wineType','grape','vintage','alcohol','volume','serving','pairing','origin','bean','roast','grind','intensity','weight','method','flavor','kind','sugar','ingredients','storage','quantity','flavors','allergens','shelfLife','minOrder'];

// Caracteres invisíveis/bidirecionais Unicode: zero-width (200B-200D, FEFF),
// overrides bidi (202A-202E, 2066-2069) e word joiner (2060). Permitiriam
// spoofing visual de nomes no Admin, e-mails e CSV — removidos na entrada.
const invisibleChars = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;

export function cleanText(value, max = 500) {
  return String(value ?? '').replace(controlChars, '').replace(invisibleChars, '').trim().slice(0, max);
}

export function cleanMultilineText(value, max = 10_000) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(multilineControlChars, '')
    .replace(invisibleChars, '')
    .trim()
    .slice(0, max);
}

export function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'produto';
}

function cents(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function priceCents(value, fallback = -1) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
}

function integer(value, fallback = 0, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function finite(value, fallback = 0, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function safeImageUrl(value) {
  const url = cleanText(value, 2048);
  return url.startsWith('/assets/') || url.startsWith('/media/products/') || /^https:\/\/[^\s]+$/i.test(url) ? url : '';
}

function safeHttpsUrl(value) {
  const url = cleanText(value, 2048);
  return /^https:\/\/[^\s]+$/i.test(url) ? url : '';
}

function safeVisualColor(value) {
  const text = cleanText(value, 64);
  if (!text || /[;{}<>]/.test(text)) return '';
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  if (/^rgba?\(\s*[0-9.%+\-\s,]+\)$/i.test(text)) return text;
  if (/^hsla?\(\s*[0-9.%+\-\s,]+(?:deg|rad|turn)?[0-9.%+\-\s,]*\)$/i.test(text)) return text;
  if (/^(?:transparent|currentcolor|black|white|maroon|red|purple|fuchsia|green|lime|olive|yellow|navy|blue|teal|aqua|gray|grey|silver)$/i.test(text)) return text;
  return '';
}

function safeVisualCss(value) {
  const text = cleanText(value, 20_000).replace(/\r\n?/g, '\n');
  if (!text) return '';
  const blocked = /(?:<\/?style|<\/?script|@import|@font-face|@keyframes|@namespace|expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding|url\s*\(|!important|\\0|#catalogSurface\b|#admin\b|#authModal\b|\.admin(?:\b|[-_])|\[data-panel\b|position\s*:\s*fixed\b|z-index\s*:)/i;
  if (blocked.test(text) || text.includes('@')) return '';
  const opens = (text.match(/\{/g) || []).length;
  const closes = (text.match(/\}/g) || []).length;
  if (!opens || opens !== closes) return '';
  let consumed = '';
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rule.exec(text))) consumed += match[0];
  return consumed.replace(/\s+/g, '') === text.replace(/\s+/g, '') ? text : '';
}

function pickTextObject(value, keys, max = 160) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const output = {};
  for (const key of keys) output[key] = cleanText(source[key], max);
  return output;
}

function sanitizeVisual(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const assets = source.assets && typeof source.assets === 'object' && !Array.isArray(source.assets) ? source.assets : {};
  const colors = source.colors && typeof source.colors === 'object' && !Array.isArray(source.colors) ? source.colors : {};
  const typography = source.typography && typeof source.typography === 'object' && !Array.isArray(source.typography) ? source.typography : {};
  const layout = source.layout && typeof source.layout === 'object' && !Array.isArray(source.layout) ? source.layout : {};
  const visibility = source.visibility && typeof source.visibility === 'object' && !Array.isArray(source.visibility) ? source.visibility : {};

  const output = {
    version: integer(source.version, 1, 1, 99),
    preset: cleanText(source.preset, 40),
    assets: {},
    colors: {},
    typography: {},
    layout: {},
    visibility: {},
    customCss: safeVisualCss(source.customCss)
  };

  for (const key of VISUAL_ASSET_KEYS) output.assets[key] = safeImageUrl(assets[key]);
  for (const key of VISUAL_COLOR_KEYS) output.colors[key] = safeVisualColor(colors[key]);
  for (const key of VISUAL_TYPOGRAPHY_KEYS) {
    const raw = typography[key];
    output.typography[key] = typeof raw === 'number' ? finite(raw, 0, -10_000, 10_000) : cleanText(raw, 160);
  }
  for (const key of VISUAL_LAYOUT_KEYS) {
    const raw = layout[key];
    if (Array.isArray(raw)) output.layout[key] = raw.slice(0, 20).map(item => cleanText(item, 40)).filter(Boolean);
    else if (typeof raw === 'boolean') output.layout[key] = raw;
    else if (typeof raw === 'number') output.layout[key] = finite(raw, 0, -100_000, 100_000);
    else output.layout[key] = cleanText(raw, 80);
  }
  for (const key of VISUAL_VISIBILITY_KEYS) output.visibility[key] = visibility[key] !== false;
  return output;
}

function sanitizeSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const zones = (Array.isArray(source.zones) ? source.zones : []).slice(0, 200).map(zone => ({
    prefix: digits(zone?.prefix ?? zone?.cepPrefix).slice(0, 8),
    startCep: digits(zone?.startCep ?? zone?.cepStart ?? zone?.from ?? zone?.start).slice(0, 8),
    endCep: digits(zone?.endCep ?? zone?.cepEnd ?? zone?.to ?? zone?.end).slice(0, 8),
    price: cents(zone?.price ?? zone?.cents ?? zone?.value, 0),
    label: cleanText(zone?.label ?? zone?.name, 160),
    days: cleanText(zone?.days ?? zone?.deadline, 80)
  }));
  return {
    catalogId: cleanText(source.catalogId, 120),
    brand: cleanText(source.brand, 120),
    subtitle: cleanText(source.subtitle, 120),
    catalogTitle: cleanText(source.catalogTitle, 180),
    catalogText: cleanText(source.catalogText, 1000),
    whatsapp: cleanText(source.whatsapp, 40),
    email: cleanText(source.email, 254),
    instagram: cleanText(source.instagram, 120),
    address: cleanText(source.address, 500),
    footerDescription: cleanText(source.footerDescription, 600),
    shipMode: cleanText(source.shipMode, 20).toLowerCase(),
    fixed: cents(source.fixed, 0),
    free: cents(source.free, 0),
    zoneFallback: cleanText(source.zoneFallback, 20).toLowerCase(),
    pickup: cleanText(source.pickup, 300),
    zones,
    visual: sanitizeVisual(source.visual)
  };
}

function sanitizeCommerce(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const paymentMethods = source.paymentMethods && typeof source.paymentMethods === 'object' && !Array.isArray(source.paymentMethods) ? source.paymentMethods : {};
  return {
    businessName: cleanText(source.businessName, 160),
    siteUrl: safeHttpsUrl(source.siteUrl),
    taxId: cleanText(source.taxId, 40),
    businessAddress: cleanText(source.businessAddress, 500),
    supportEmail: cleanText(source.supportEmail, 254),
    supportPhone: cleanText(source.supportPhone, 40),
    privacyText: cleanMultilineText(source.privacyText, 10_000),
    termsText: cleanMultilineText(source.termsText, 10_000),
    returnsText: cleanMultilineText(source.returnsText, 10_000),
    retentionDays: integer(source.retentionDays, 90, 1, 3650),
    pixKey: cleanText(source.pixKey, 180),
    paymentLink: safeHttpsUrl(source.paymentLink),
    paymentMethods: {
      whatsapp: paymentMethods.whatsapp !== false,
      pix: paymentMethods.pix === true,
      card: paymentMethods.card === true
    },
    apiBaseUrl: '',
    apiMode: ['required', 'optional'].includes(source.apiMode) ? source.apiMode : 'required',
    lastUpdated: cleanText(source.lastUpdated, 60)
  };
}

const COUPON_TYPES = new Set(['percent', 'fixed', 'free_shipping']);
const ALCOHOL_DEPARTMENTS = new Set(['vinhos', 'vinho', 'espumantes', 'cervejas', 'cerveja', 'destilados', 'licores', 'bebidas-alcoolicas']);

function reais(cents) {
  return `R$ ${(Math.max(0, Number(cents) || 0) / 100).toFixed(2).replace('.', ',')}`;
}

export function isAlcoholicProduct(product) {
  if (!product || typeof product !== 'object') return false;
  if (ALCOHOL_DEPARTMENTS.has(String(product.department || '').toLowerCase())) return true;
  return Boolean(product.attributes?.alcohol);
}

function sanitizeCoupons(value) {
  const source = Array.isArray(value) ? value.slice(0, 200) : [];
  const codes = new Set();
  const output = [];
  for (const item of source) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const code = cleanText(item.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (code.length < 3 || codes.has(code)) continue;
    const type = COUPON_TYPES.has(item.type) ? item.type : '';
    if (!type) continue;
    let couponValue = 0;
    if (type === 'percent') {
      couponValue = integer(item.value, 0, 1, 100);
      if (couponValue < 1) continue;
    } else if (type === 'fixed') {
      couponValue = integer(item.value, 0, 1, 100_000_000);
      if (couponValue < 1) continue;
    }
    const expiresAt = cleanText(item.expiresAt, 40);
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) continue;
    codes.add(code);
    output.push({
      code,
      type,
      value: couponValue,
      minSubtotalCents: integer(item.minSubtotalCents, 0, 0, 100_000_000),
      expiresAt,
      active: item.active !== false,
      note: cleanText(item.note, 200)
    });
  }
  return output;
}

const PROMOTION_TYPES = new Set(['sale_price','category_percent','quantity_percent','buy_x_pay_y','nth_unit_percent','bundle_percent','free_shipping_threshold']);

function sanitizePromotions(value) {
  const source = Array.isArray(value) ? value.slice(0, 300) : [];
  const ids = new Set();
  const output = [];
  for (const item of source) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const id = cleanText(item.id, 120);
    const type = PROMOTION_TYPES.has(item.type) ? item.type : '';
    if (!id || !type) continue;
    if (ids.has(id)) throw new Error(`Promoção duplicada: ${id}.`);

    const startsAt = cleanText(item.startsAt, 40);
    const endsAt = cleanText(item.endsAt, 40);
    if (startsAt && Number.isNaN(Date.parse(startsAt))) throw new Error(`Data inicial inválida na promoção ${id}.`);
    if (endsAt && Number.isNaN(Date.parse(endsAt))) throw new Error(`Data final inválida na promoção ${id}.`);
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new Error(`O fim da promoção ${id} precisa ser posterior ao início.`);
    }

    const globalOnly = type === 'free_shipping_threshold' || type === 'bundle_percent';
    const requiredProductIds = [...new Set(
      (Array.isArray(item.requiredProductIds) ? item.requiredProductIds : [])
        .slice(0, 30)
        .map(v => cleanText(v, 120))
        .filter(Boolean)
    )];
    const promo = {
      id,
      name: cleanText(item.name, 160) || 'Promoção automática',
      type,
      active: item.active !== false,
      startsAt,
      endsAt,
      productId: globalOnly ? '' : cleanText(item.productId, 120),
      variantId: globalOnly ? '' : cleanText(item.variantId, 120),
      department: globalOnly ? '' : cleanText(item.department, 80),
      category: globalOnly ? '' : cleanText(item.category, 100),
      value: integer(item.value, 0, 0, 100),
      salePriceCents: integer(item.salePriceCents, 0, 0, 100_000_000),
      minQty: integer(item.minQty, 0, 0, 9999),
      buyQty: integer(item.buyQty, 0, 0, 9999),
      payQty: integer(item.payQty, 0, 0, 9999),
      nthQty: integer(item.nthQty, 0, 0, 9999),
      minSubtotalCents: integer(item.minSubtotalCents, 0, 0, 100_000_000),
      requiredProductIds,
      // Preço promocional é o preço-base efetivo; portanto ele sempre pode
      // coexistir com promoções de carrinho. Não exponha uma opção que o
      // motor financeiro não consegue respeitar.
      stackable: (type === 'sale_price' || type === 'free_shipping_threshold') ? true : item.stackable === true,
      badge: cleanText(item.badge, 60),
      note: cleanText(item.note, 240)
    };

    if (type === 'sale_price' && (!promo.productId || promo.salePriceCents < 1)) {
      throw new Error(`Preço promocional ${id} exige produto e preço maior que zero.`);
    }
    if (type === 'category_percent' && promo.value < 1) {
      throw new Error(`Desconto percentual ${id} precisa ser maior que zero.`);
    }
    if (type === 'quantity_percent' && (promo.value < 1 || promo.minQty < 2)) {
      throw new Error(`Promoção por quantidade ${id} exige desconto e mínimo de 2 unidades.`);
    }
    if (type === 'buy_x_pay_y' && (promo.buyQty < 2 || promo.payQty < 1 || promo.payQty >= promo.buyQty)) {
      throw new Error(`Promoção leve/pague ${id} possui quantidades inválidas.`);
    }
    if (type === 'nth_unit_percent' && (promo.value < 1 || promo.nthQty < 2)) {
      throw new Error(`Promoção na Nª unidade ${id} possui regra inválida.`);
    }
    if (type === 'bundle_percent' && (promo.value < 1 || requiredProductIds.length < 2)) {
      throw new Error(`Combo ${id} exige desconto e pelo menos 2 produtos distintos.`);
    }
    if (type === 'free_shipping_threshold' && promo.minSubtotalCents < 1) {
      throw new Error(`Promoção de frete grátis ${id} exige subtotal mínimo maior que zero.`);
    }

    ids.add(id);
    output.push(promo);
  }
  return output;
}

export function isPromotionActive(promotion, now = Date.now()) {
  if (!promotion || promotion.active === false) return false;
  if (promotion.startsAt && Date.parse(promotion.startsAt) > now) return false;
  if (promotion.endsAt && Date.parse(promotion.endsAt) < now) return false;
  return true;
}

export function promotionMatchesProduct(promotion, product, variantId = '') {
  if (!promotion || !product) return false;
  if (promotion.productId && promotion.productId !== product.id) return false;
  if (promotion.variantId && promotion.variantId !== variantId) return false;
  if (promotion.department && String(promotion.department).toLowerCase() !== String(product.department || '').toLowerCase()) return false;
  if (promotion.category && String(promotion.category).toLowerCase() !== String(product.subcategory || '').toLowerCase()) return false;
  return true;
}

export function effectiveFreeShippingThreshold(catalog) {
  let threshold = cents(catalog?.settings?.free, 0);
  for (const promo of catalog?.promotions || []) {
    if (promo.type !== 'free_shipping_threshold' || !isPromotionActive(promo) || promo.minSubtotalCents <= 0) continue;
    threshold = threshold > 0 ? Math.min(threshold, promo.minSubtotalCents) : promo.minSubtotalCents;
  }
  return threshold;
}

export function promotionSalePrice(product, variantId = '', promotions = []) {
  let best = null;
  for (const promo of promotions || []) {
    if (promo.type !== 'sale_price' || !isPromotionActive(promo) || !promotionMatchesProduct(promo, product, variantId) || promo.salePriceCents <= 0) continue;
    if (best == null || promo.salePriceCents < best) best = promo.salePriceCents;
  }
  return best;
}

function cheapestUnitsDiscount(lines, freeUnits, percent = 100) {
  let remaining = Math.max(0, freeUnits);
  let discount = 0;
  const sorted = [...lines].sort((a, b) => a.unitPriceCents - b.unitPriceCents);
  for (const line of sorted) {
    if (remaining <= 0) break;
    const count = Math.min(remaining, line.qty);
    discount += Math.floor(line.unitPriceCents * count * percent / 100);
    remaining -= count;
  }
  return discount;
}

function promotionCandidate(promo, lines, productsById, shippingPriceCents = 0) {
  if (!isPromotionActive(promo) || promo.type === 'sale_price') return {discount: 0, shippingDiscount: 0};
  const matches = lines.filter(line => promotionMatchesProduct(promo, productsById.get(line.productId), line.variantId || ''));
  const qty = matches.reduce((sum, line) => sum + Number(line.qty || 0), 0);
  const subtotal = matches.reduce((sum, line) => sum + Number(line.lineTotalCents || 0), 0);
  if (promo.type === 'category_percent') return {discount: Math.floor(subtotal * promo.value / 100), shippingDiscount: 0};
  if (promo.type === 'quantity_percent') return {discount: promo.minQty > 0 && qty >= promo.minQty ? Math.floor(subtotal * promo.value / 100) : 0, shippingDiscount: 0};
  if (promo.type === 'buy_x_pay_y') {
    if (promo.buyQty < 2 || promo.payQty < 1 || promo.payQty >= promo.buyQty || qty < promo.buyQty) return {discount: 0, shippingDiscount: 0};
    const freeUnits = Math.floor(qty / promo.buyQty) * (promo.buyQty - promo.payQty);
    return {discount: cheapestUnitsDiscount(matches, freeUnits, 100), shippingDiscount: 0};
  }
  if (promo.type === 'nth_unit_percent') {
    if (promo.nthQty < 2 || promo.value <= 0 || qty < promo.nthQty) return {discount: 0, shippingDiscount: 0};
    return {discount: cheapestUnitsDiscount(matches, Math.floor(qty / promo.nthQty), promo.value), shippingDiscount: 0};
  }
  if (promo.type === 'bundle_percent') {
    const required = [...new Set(promo.requiredProductIds || [])];
    if (!required.length || promo.value <= 0) return {discount: 0, shippingDiscount: 0};
    const byProduct = new Map(lines.map(line => [line.productId, (lines.filter(other => other.productId === line.productId).reduce((sum, other) => sum + other.qty, 0))]));
    if (required.some(id => !byProduct.get(id))) return {discount: 0, shippingDiscount: 0};
    const bundles = Math.min(...required.map(id => byProduct.get(id)));
    let bundleBase = 0;
    for (const id of required) {
      const relevant = lines.filter(line => line.productId === id);
      // Cada bundle consome unidades reais. Não multiplica a variação mais
      // barata além da quantidade que existe naquela linha.
      bundleBase += cheapestUnitsDiscount(relevant, bundles, 100);
    }
    return {discount: Math.floor(bundleBase * promo.value / 100), shippingDiscount: 0};
  }
  if (promo.type === 'free_shipping_threshold') {
    const fullSubtotal = lines.reduce((sum, line) => sum + Number(line.lineTotalCents || 0), 0);
    return {discount: 0, shippingDiscount: promo.minSubtotalCents > 0 && fullSubtotal >= promo.minSubtotalCents ? Math.max(0, Number(shippingPriceCents) || 0) : 0};
  }
  return {discount: 0, shippingDiscount: 0};
}

export function calculateAutomaticPromotions({lines = [], productsById = new Map(), promotions = [], shippingPriceCents = 0} = {}) {
  const applied = [];
  const stackable = [];
  const nonStackable = [];
  const subtotal = lines.reduce((sum, line) => sum + Number(line.lineTotalCents || 0), 0);
  let bestShipping = null;
  for (const promo of promotions || []) {
    const candidate = promotionCandidate(promo, lines, productsById, shippingPriceCents);
    const shippingEligible = promo.type === 'free_shipping_threshold' && isPromotionActive(promo) && promo.minSubtotalCents > 0 && subtotal >= promo.minSubtotalCents;
    if (shippingEligible) {
      const actual = Math.min(Math.max(0, Number(candidate.shippingDiscount) || 0), Math.max(0, Number(shippingPriceCents) || 0));
      if (!bestShipping || actual > bestShipping.actual || (actual === bestShipping.actual && promo.minSubtotalCents < bestShipping.promo.minSubtotalCents)) bestShipping = {promo, actual};
    }
    if (candidate.discount > 0) (promo.stackable ? stackable : nonStackable).push({promo, discount: candidate.discount});
  }
  const best = nonStackable.sort((a,b) => b.discount - a.discount)[0];
  // "Pode acumular" significa exatamente isso: promoções marcadas como
  // acumuláveis formam um grupo entre si; uma promoção NÃO acumulável concorre
  // com esse grupo e nunca é somada a ele. Escolhemos o cenário de maior
  // benefício para o cliente sem violar a regra comercial configurada.
  const stackableTotal = stackable.reduce((sum, item) => sum + item.discount, 0);
  const selected = best && best.discount > stackableTotal ? [best] : stackable;
  const maxProductDiscount = Math.max(0, subtotal - 100);
  const discountCents = Math.max(0, Math.min(selected.reduce((sum, item) => sum + item.discount, 0), maxProductDiscount));
  let remaining = discountCents;
  for (const item of selected) {
    const actual = Math.min(Math.max(0, item.discount), remaining);
    remaining -= actual;
    if (actual > 0) applied.push({id:item.promo.id,name:item.promo.name,type:item.promo.type,discountCents:actual,shippingDiscountCents:0});
  }
  const shippingDiscountCents = bestShipping ? bestShipping.actual : 0;
  if (bestShipping) applied.push({id:bestShipping.promo.id,name:bestShipping.promo.name,type:bestShipping.promo.type,discountCents:0,shippingDiscountCents});
  return {discountCents, shippingDiscountCents, applied};
}

export function findCoupon(catalog, code) {
  const target = cleanText(code, 40).toUpperCase();
  if (!target) return null;
  return (catalog?.coupons || []).find(item => item.code === target) || null;
}

export function validateCoupon(coupon, {subtotalCents = 0, shippingChoice = '', shippingQuoted = false} = {}) {
  if (!coupon || coupon.active === false) return {ok: false, error: 'Cupom inválido ou inativo.'};
  if (coupon.expiresAt && Date.parse(coupon.expiresAt) < Date.now()) return {ok: false, error: 'Este cupom expirou.'};
  if (coupon.minSubtotalCents > 0 && subtotalCents < coupon.minSubtotalCents) {
    return {ok: false, error: `Este cupom exige pedido mínimo de ${reais(coupon.minSubtotalCents)}.`};
  }
  if (coupon.type === 'free_shipping') {
    if (shippingChoice !== 'delivery') return {ok: false, error: 'Este cupom vale apenas para pedidos com entrega.'};
    if (shippingQuoted) return {ok: false, error: 'Este cupom não se aplica a frete sob cotação.'};
  }
  return {ok: true, error: ''};
}

export function couponDiscount(coupon, subtotalCents, shippingPriceCents = 0) {
  if (!coupon) return 0;
  if (coupon.type === 'free_shipping') return Math.max(0, Math.min(Number(shippingPriceCents) || 0, 100_000_000));
  let discount = 0;
  if (coupon.type === 'percent') discount = Math.floor(subtotalCents * coupon.value / 100);
  else if (coupon.type === 'fixed') discount = coupon.value;
  return Math.max(0, Math.min(discount, Math.max(0, subtotalCents - 100)));
}

function sanitizeAttributes(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const output = {};
  for (const key of PRODUCT_ATTRIBUTE_KEYS) {
    const text = cleanText(source[key], 1000);
    if (text) output[key] = text;
  }
  return output;
}

export function normalizeCatalog(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? clone(input) : {};
  applyRecoveredCatalogRepairs(raw);
  const products = Array.isArray(raw.products) ? raw.products : [];
  if (products.length > 1000) throw new Error('O catálogo excede o limite de 1000 produtos.');

  const ids = new Set();
  const slugs = new Set();
  const globalVariantIds = new Set();
  const normalizedProducts = products.map((product, index) => {
    if (!product || typeof product !== 'object' || Array.isArray(product)) throw new Error(`Produto ${index + 1} inválido.`);
    const id = cleanText(product.id, 120);
    const name = cleanText(product.name, 160);
    if (!id || !name) throw new Error(`Produto ${index + 1} precisa de id e nome.`);
    if (ids.has(id)) throw new Error(`ID de produto duplicado: ${id}`);
    ids.add(id);
    const baseSlug = slugify(product.slug || name);
    let slug = baseSlug;
    if (slugs.has(slug)) {
      const stableSuffix = slugify(id).slice(-16) || String(index + 1);
      let attempt = 0;
      do {
        const tail = attempt ? `${stableSuffix}-${attempt}` : stableSuffix;
        const room = Math.max(1, 100 - tail.length - 1);
        const head = baseSlug.slice(0, room).replace(/-+$/g, '') || 'produto';
        slug = `${head}-${tail}`.slice(0, 100).replace(/-+$/g, '');
        attempt += 1;
      } while (slugs.has(slug) && attempt < 1000);
      if (slugs.has(slug)) throw new Error(`Não foi possível gerar URL única para ${name}.`);
    }
    slugs.add(slug);

    const price = priceCents(product.price, -1);
    if (price < 0) throw new Error(`Preço inválido no produto ${name}.`);
    const normalizedImages = (Array.isArray(product.images) ? product.images : [])
      .map(safeImageUrl)
      .filter(Boolean)
      .filter((url, imageIndex, list) => list.indexOf(url) === imageIndex)
      .slice(0, 12);
    const variantIds = new Set();
    const variants = Array.isArray(product.variants) ? product.variants.slice(0, 200).map((variant, variantIndex) => {
      const variantId = cleanText(variant?.id, 120);
      if (!variantId) throw new Error(`Variante ${variantIndex + 1} de ${name} sem id.`);
      if (variantIds.has(variantId)) throw new Error(`ID de variante duplicado em ${name}: ${variantId}`);
      if (globalVariantIds.has(variantId)) throw new Error(`ID de variante duplicado no catálogo: ${variantId}`);
      variantIds.add(variantId);
      globalVariantIds.add(variantId);
      const variantName = cleanText(variant?.name, 120);
      const variantDeletedAt = variant?.deletedAt == null ? null : cleanText(variant.deletedAt, 60);
      if (!variantName && !variantDeletedAt) throw new Error(`Variante ativa ${variantId} de ${name} precisa de nome.`);
      return {
        id: variantId,
        name: variantName,
        price: (() => { const value = priceCents(variant?.price, price); if (value < 0) throw new Error(`Preço inválido na variante ${variantId} de ${name}.`); return value; })(),
        stock: variant?.stock == null ? null : cents(variant.stock, 0),
        unit: cleanText(variant?.unit, 120),
        weightGrams: variant?.weightGrams == null ? null : integer(variant.weightGrams, 0, 1, 100_000),
        image: (() => {
          const image = safeImageUrl(variant?.image);
          return image && normalizedImages.includes(image) ? image : '';
        })(),
        position: integer(variant?.position, variantIndex + 1, 0, 100_000),
        deletedAt: variantDeletedAt
      };
    }) : [];
    const normalizedMinPerOrder = product.minPerOrder == null ? null : integer(product.minPerOrder, 1, 1, 999);
    const normalizedMaxPerOrder = product.maxPerOrder == null ? null : integer(product.maxPerOrder, 1, 1, 999);
    if (normalizedMinPerOrder != null && normalizedMaxPerOrder != null && normalizedMinPerOrder > normalizedMaxPerOrder) {
      throw new Error(`Quantidade mínima por pedido não pode exceder a máxima em ${name}.`);
    }
    const deletedAt = product.deletedAt == null ? null : cleanText(product.deletedAt, 60);
    const available = product.available !== false;
    const hidden = product.hidden === true;
    if (available && !hidden && !deletedAt) {
      const activeVariants = variants.filter(variant => !variant.deletedAt);
      if (activeVariants.length ? activeVariants.some(variant => variant.price <= 0) : price <= 0) {
        throw new Error(`Produto disponível precisa ter preço maior que zero: ${name}.`);
      }
    }

    return {
      id,
      name,
      slug,
      department: cleanText(product.department, 80),
      subcategory: cleanText(product.subcategory, 100),
      brand: cleanText(product.brand, 120),
      sku: cleanText(product.sku, 120),
      imported: product.imported === true,
      country: cleanText(product.country, 120),
      region: cleanText(product.region, 160),
      price,
      unit: cleanText(product.unit, 120),
      description: cleanText(product.description, 3000),
      images: normalizedImages,
      variants,
      attributes: sanitizeAttributes(product.attributes),
      stock: product.stock == null ? null : cents(product.stock, 0),
      stockMin: product.stockMin == null ? null : cents(product.stockMin, 0),
      maxPerOrder: normalizedMaxPerOrder,
      minPerOrder: normalizedMinPerOrder,
      weightGrams: product.weightGrams == null ? null : integer(product.weightGrams, 0, 1, 100_000),
      lengthCm: product.lengthCm == null ? null : integer(product.lengthCm, 0, 1, 100),
      widthCm: product.widthCm == null ? null : integer(product.widthCm, 0, 1, 100),
      heightCm: product.heightCm == null ? null : integer(product.heightCm, 0, 1, 100),
      boxes: (Array.isArray(product.boxes) ? product.boxes : []).slice(0, 10).map(box => ({
        variantId: cleanText(box?.variantId, 120),
        units: Number.isSafeInteger(Number(box?.units)) ? Number(box.units) : 0,
        lengthCm: Number.isSafeInteger(Number(box?.lengthCm)) ? Number(box.lengthCm) : 0,
        widthCm: Number.isSafeInteger(Number(box?.widthCm)) ? Number(box.widthCm) : 0,
        heightCm: Number.isSafeInteger(Number(box?.heightCm)) ? Number(box.heightCm) : 0,
        weightGrams: Number.isSafeInteger(Number(box?.weightGrams)) ? Number(box.weightGrams) : 0
      })).filter(box => box.units > 0 && box.weightGrams > 0 && box.lengthCm > 0 && box.widthCm > 0 && box.heightCm > 0),
      restockDate: cleanText(product.restockDate, 40),
      preparation: cleanText(product.preparation, 500),
      available,
      hidden,
      featured: product.featured === true,
      madeToOrder: product.madeToOrder === true,
      seasonal: product.seasonal === true,
      giftEnabled: product.giftEnabled !== false,
      position: integer(product.position, index + 1, 0, 100_000),
      created: product.created == null ? null : finite(product.created, 0, 0, Number.MAX_SAFE_INTEGER),
      updated: product.updated == null ? null : finite(product.updated, 0, 0, Number.MAX_SAFE_INTEGER),
      deletedAt
    };
  });

  return {
    version: integer(raw.version, 9, 1, 999),
    settings: sanitizeSettings(raw.settings),
    commerce: sanitizeCommerce(raw.commerce ?? raw.v8),
    coupons: sanitizeCoupons(raw.coupons),
    promotions: sanitizePromotions(raw.promotions),
    products: normalizedProducts
  };
}

export function isStockAlertPurchasable(product, variantId = '') {
  if (!product || product.deletedAt || product.hidden === true || product.available === false) return false;
  const variant = variantId ? (product.variants || []).find(item => item.id === variantId && !item.deletedAt) : null;
  if (variantId && !variant) return false;
  const raw = variant?.stock != null ? variant.stock : product.stock;
  return raw == null || Math.max(0, Number(raw) || 0) > 0;
}

export function publicCatalog(catalog, serverConfig) {
  const result = normalizeCatalog(catalog);
  delete result.coupons;
  // Fonte única de verdade: o front usa esta flag em vez de manter uma
  // lista própria de departamentos alcoólicos (que poderia divergir).
  result.products = result.products.filter(product => !product.deletedAt && product.hidden !== true);
  for (const product of result.products) {
    product.variants = (product.variants || []).filter(variant => !variant.deletedAt);
    const activeVariantIds = new Set(product.variants.map(variant => variant.id));
    product.boxes = (product.boxes || []).filter(box => !box.variantId || activeVariantIds.has(box.variantId));
    product.isAlcoholic = isAlcoholicProduct(product);
  }
  result.hasAlcohol = result.products.some(product => product.available !== false && product.isAlcoholic);
  result.commerce.apiBaseUrl = '';
  result.commerce.apiMode = 'required';
  result.commerce.paymentMethods = {
    whatsapp: false,
    pix: Boolean(result.commerce.paymentMethods?.pix && result.commerce.pixKey),
    card: Boolean(serverConfig.mercadoPagoAccessToken && serverConfig.mercadoPagoWebhookSecret)
  };
  result.settings.whatsapp = cleanText(serverConfig.whatsappNumber || result.settings.whatsapp, 40);
  // Sincroniza a configuração de frete efetiva do SERVIDOR no catálogo
  // público: o cálculo local do front (modo fixed/zones/frete grátis) passa a
  // usar os mesmos números que o backend cobrará — sem estimativa divergente.
  const serverShipMode = cleanText(serverConfig.shippingMode, 20).toLowerCase();
  if (serverShipMode) {
    // O checkout usa o modo público como fallback quando /api/health está indisponível.
    result.settings.shipMode = serverShipMode;
  }
  if (serverConfig.shippingFixedCents != null) result.settings.fixed = cents(serverConfig.shippingFixedCents, result.settings.fixed);
  if (serverConfig.freeShippingCents != null) result.settings.free = cents(serverConfig.freeShippingCents, result.settings.free);
  return result;
}

export function productPrice(product, variantId, promotions = []) {
  const activeVariants = (product.variants || []).filter(item => !item.deletedAt);
  if (variantId) {
    const variant = activeVariants.find(item => item.id === variantId);
    if (!variant) throw new Error(`Opção inválida para ${product.name}.`);
    const regular = cents(variant.price, product.price);
    const sale = promotionSalePrice(product, variant.id, promotions);
    return {variant, regularPriceCents: regular, unitPriceCents: sale != null ? Math.min(regular, sale) : regular};
  }
  if (activeVariants.length) {
    const first = activeVariants[0];
    const regular = cents(first.price, product.price);
    const sale = promotionSalePrice(product, first.id, promotions);
    return {variant: first, regularPriceCents: regular, unitPriceCents: sale != null ? Math.min(regular, sale) : regular};
  }
  const regular = cents(product.price);
  const sale = promotionSalePrice(product, '', promotions);
  return {variant: null, regularPriceCents: regular, unitPriceCents: sale != null ? Math.min(regular, sale) : regular};
}

function availableStock(product, variant) {
  if (variant?.stock != null) return cents(variant.stock, 0);
  if (product.stock != null) return cents(product.stock, 0);
  return null;
}

function findZone(zones, cep) {
  const numeric = Number(cep);
  for (const zone of Array.isArray(zones) ? zones : []) {
    const prefix = digits(zone.prefix ?? zone.cepPrefix ?? '');
    if (prefix && cep.startsWith(prefix)) return zone;
    const start = digits(zone.startCep ?? zone.cepStart ?? zone.from ?? zone.start ?? '');
    const end = digits(zone.endCep ?? zone.cepEnd ?? zone.to ?? zone.end ?? '');
    if (start.length === 8 && end.length === 8 && numeric >= Number(start) && numeric <= Number(end)) return zone;
  }
  return null;
}

export function calculateShipping({choice, cep, resolved}, subtotalCents, settings, serverConfig) {
  const normalizedChoice = choice === 'pickup' ? 'pickup' : choice === 'delivery' ? 'delivery' : '';
  if (!normalizedChoice) throw new Error('Escolha entrega ou retirada.');
  if (normalizedChoice === 'pickup') {
    return {choice: 'pickup', cep: '', priceCents: 0, quoted: false, label: cleanText(settings.pickup, 200) || 'Retirada no local'};
  }

  const normalizedCep = normalizeShippingCep(cep);
  if (normalizedCep.length !== 8) throw new Error('Informe um CEP válido com 8 dígitos.');
  const mode = cleanText(serverConfig.shippingMode || settings.shipMode || 'quote', 20).toLowerCase();
  const freeThreshold = cents(serverConfig.freeShippingCents ?? settings.free, 0);
  // No modo automático o servidor precisa confirmar a opção, mesmo quando
  // a loja subsidia o frete. Falha da API NUNCA é convertida em frete grátis.
  if (mode === 'correios' && resolved && Number.isSafeInteger(resolved.priceCents) && resolved.priceCents >= 0) {
    return {choice: 'delivery', cep: normalizedCep, priceCents: freeThreshold > 0 && subtotalCents >= freeThreshold ? 0 : resolved.priceCents, quoted: false,
      label: freeThreshold > 0 && subtotalCents >= freeThreshold ? 'Frete grátis' : cleanText(resolved.label, 160) || 'Correios', days: cleanText(resolved.days, 100), service: cleanText(resolved.service, 20),
      deadline: resolved.deadline || '', homeDelivery: resolved.homeDelivery ?? null,
      saturdayDelivery: resolved.saturdayDelivery ?? null, sundayDelivery: resolved.sundayDelivery ?? null,
      volumes: resolved.volumes, packages: resolved.packages, originCep: resolved.originCep,
      quotedAt: resolved.quotedAt, carrierPriceCents: resolved.carrierPriceCents,
      declaredValueIncluded: resolved.declaredValueIncluded, environment: resolved.environment};
  }
  if (mode === 'correios') return {choice: 'delivery', cep: normalizedCep, priceCents: null, quoted: true, label: 'Frete sob cotação'};
  if (freeThreshold > 0 && subtotalCents >= freeThreshold) {
    return {choice: 'delivery', cep: normalizedCep, priceCents: 0, quoted: false, label: 'Frete grátis'};
  }

  if (mode === 'fixed') {
    const value = cents(serverConfig.shippingFixedCents ?? settings.fixed, 0);
    return {choice: 'delivery', cep: normalizedCep, priceCents: value, quoted: false, label: value ? 'Frete fixo' : 'Entrega sem custo'};
  }

  if (mode === 'zones' || mode === 'zone') {
    const zone = findZone(settings.zones, normalizedCep);
    if (zone) {
      const value = cents(zone.price ?? zone.cents ?? zone.value, 0);
      return {choice: 'delivery', cep: normalizedCep, priceCents: value, quoted: false, label: cleanText(zone.label ?? zone.name, 160) || 'Frete por região', days: cleanText(zone.days ?? zone.deadline, 80)};
    }
    const fallback = cleanText(settings.zoneFallback || 'quote', 20).toLowerCase();
    if (fallback === 'fixed') {
      const value = cents(serverConfig.shippingFixedCents ?? settings.fixed, 0);
      return {choice: 'delivery', cep: normalizedCep, priceCents: value, quoted: false, label: 'Frete fixo'};
    }
  }

  return {choice: 'delivery', cep: normalizedCep, priceCents: null, quoted: true, label: 'Frete sob cotação'};
}

function makeOrderId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `INT-${date}-${randomBytes(8).toString('hex').toUpperCase()}`;
}

export function buildOrder(payload, catalog, serverConfig) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Pedido inválido.');
  const requestedItems = Array.isArray(payload.items) ? payload.items : [];
  if (!requestedItems.length || requestedItems.length > 100) throw new Error('O pedido deve conter entre 1 e 100 itens.');

  const productsById = new Map(catalog.products.map(product => [product.id, product]));
  const lines = [];
  const productQuantities = new Map();
  const stockQuantities = new Map();
  const minimums = new Map();
  let subtotalCents = 0;

  for (const item of requestedItems) {
    const productId = cleanText(item?.productId, 120);
    const product = productsById.get(productId);
    if (!product || product.deletedAt || product.available === false || product.hidden === true) throw new Error('Um dos produtos não está mais disponível.');
    const variantId = cleanText(item?.variantId, 120);
    const {variant, unitPriceCents, regularPriceCents} = productPrice(product, variantId, catalog.promotions || []);
    const qty = Number(item?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw new Error(`Quantidade inválida para ${product.name}.`);
    const maxPerOrder = product.maxPerOrder == null ? 999 : product.maxPerOrder;
    const productQuantity = (productQuantities.get(product.id) || 0) + qty;
    if (productQuantity > maxPerOrder) throw new Error(`Quantidade máxima de ${product.name}: ${maxPerOrder}.`);
    productQuantities.set(product.id, productQuantity);
    minimums.set(product.id, {name: product.name, min: product.minPerOrder == null ? 1 : product.minPerOrder});

    const stock = availableStock(product, variant);
    if (stock != null) {
      const stockKey = variant?.stock != null ? `${product.id}::${variant.id}` : product.id;
      const stockQuantity = (stockQuantities.get(stockKey) || 0) + qty;
      if (stockQuantity > stock) throw new Error(`Estoque insuficiente para ${product.name}.`);
      stockQuantities.set(stockKey, stockQuantity);
    }
    const lineTotalCents = unitPriceCents * qty;
    if (!Number.isSafeInteger(lineTotalCents)) throw new Error('Valor do pedido fora do limite permitido.');
    subtotalCents += lineTotalCents;
    const gift = Boolean(item?.gift && product.giftEnabled !== false);
    lines.push({
      productId: product.id,
      variantId: variant?.id || '',
      name: product.name,
      variant: variant?.name || '',
      sku: product.sku || '',
      qty,
      unitPriceCents,
      regularPriceCents,
      lineTotalCents,
      gift,
      giftMessage: gift ? cleanText(item?.giftMessage, 240) : ''
    });
  }

  if (!Number.isSafeInteger(subtotalCents) || subtotalCents <= 0) throw new Error('Total do pedido inválido.');

  for (const [productId, rule] of minimums) {
    if (rule.min > 1 && (productQuantities.get(productId) || 0) < rule.min) {
      throw new Error(`Quantidade mínima de ${rule.name}: ${rule.min} unidade(s).`);
    }
  }

  const containsAlcohol = lines.some(line => isAlcoholicProduct(productsById.get(line.productId)));
  if (containsAlcohol && payload.ageConfirmed !== true) {
    throw new Error('Este pedido contém bebida alcoólica. É necessário confirmar que o comprador tem 18 anos ou mais.');
  }

  const shippingSettings = {...(catalog.settings || {}), free: effectiveFreeShippingThreshold(catalog)};
  const shipping = calculateShipping(payload.shipping || {}, subtotalCents, shippingSettings, serverConfig);

  const autoPromotions = calculateAutomaticPromotions({lines, productsById, promotions: catalog.promotions || [], shippingPriceCents: shipping.priceCents ?? 0});
  let coupon = null;
  let couponDiscountCents = 0;
  const couponBaseCents = Math.max(100, subtotalCents - autoPromotions.discountCents);
  const couponCode = cleanText(payload.couponCode, 40).toUpperCase();
  if (couponCode) {
    coupon = findCoupon(catalog, couponCode);
    const check = validateCoupon(coupon, {subtotalCents: couponBaseCents, shippingChoice: shipping.choice, shippingQuoted: shipping.quoted});
    if (!check.ok) throw new Error(check.error || 'Cupom inválido.');
    couponDiscountCents = couponDiscount(coupon, couponBaseCents, Math.max(0, (shipping.priceCents ?? 0) - autoPromotions.shippingDiscountCents));
  }
  const promotionDiscountCents = autoPromotions.discountCents + autoPromotions.shippingDiscountCents;
  const discountCents = promotionDiscountCents + couponDiscountCents;
  const totalCents = subtotalCents + (shipping.priceCents ?? 0) - discountCents;
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new Error('Total do pedido inválido.');
  const email = cleanText(payload.customer?.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');

  const phone = cleanText(payload.customer?.phone, 30);
  const phoneDigits = digits(phone);
  if (!email && !phone) throw new Error('Informe um e-mail ou telefone para contato.');
  if (phone && (phoneDigits.length < 8 || phoneDigits.length > 15)) throw new Error('Telefone inválido.');
  const name = cleanText(payload.customer?.name, 80);
  if (!name) throw new Error('Informe o nome do cliente.');

  const address = {
    street: cleanText(payload.shipping?.street, 180),
    number: cleanText(payload.shipping?.number, 40),
    complement: cleanText(payload.shipping?.complement, 120),
    neighborhood: cleanText(payload.shipping?.neighborhood, 120),
    city: cleanText(payload.shipping?.city, 120),
    state: cleanText(payload.shipping?.state, 2).toUpperCase()
  };
  if (shipping.choice === 'delivery') {
    if (!address.street || !address.number || !address.neighborhood || !address.city || !/^[A-Z]{2}$/.test(address.state)) {
      throw new Error('Preencha o endereço completo para entrega.');
    }
    Object.assign(shipping, address);
  }

  const createdAt = new Date().toISOString();
  return {
    id: makeOrderId(),
    clientOrderId: cleanText(payload.clientOrderId, 160) || `anonymous-${Date.now()}-${randomBytes(8).toString('hex')}`,
    checkoutToken: randomBytes(24).toString('hex'),
    createdAt,
    updatedAt: createdAt,
    status: 'received',
    channel: 'web',
    customer: {
      name,
      email,
      phone,
      note: cleanText(payload.customer?.note, 500)
    },
    shipping,
    items: lines,
    subtotalCents,
    shippingCents: shipping.priceCents,
    discountCents,
    promotionDiscountCents,
    couponDiscountCents,
    promotions: autoPromotions.applied,
    coupon: coupon ? {code: coupon.code, type: coupon.type, value: coupon.value} : null,
    containsAlcohol,
    ageConfirmed: containsAlcohol ? true : Boolean(payload.ageConfirmed),
    totalCents,
    requiresShippingQuote: shipping.quoted,
    payment: {provider: '', preferenceId: '', paymentId: '', status: '', statusDetail: '', attempt: 0},
    history: [{at: createdAt, status: 'received', source: 'web', note: 'Pedido criado pelo cliente.'}],
    inventoryCommittedAt: '',
    inventoryWarnings: []
  };
}

export const ORDER_STATUSES = Object.freeze(['received','awaiting_payment','paid','payment_failed','payment_expired','payment_review','preparing','ready','completed','refunded','chargeback','cancelled']);
