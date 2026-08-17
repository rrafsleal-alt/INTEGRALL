import {randomBytes} from 'node:crypto';

const clone = value => JSON.parse(JSON.stringify(value));
const controlChars = /[\u0000-\u001F\u007F]/g;

const VISUAL_ASSET_KEYS = ['headerLogo','footerLogo','favicon','heroBackground','headerBackground','footerBackground','pageBackground'];
const VISUAL_COLOR_KEYS = ['page','surface','surfaceAlt','surfaceMuted','primary','primaryHover','accent','text','muted','line','danger','success','buttonText','headerBackground','footerBackground','cardBackground','inputBackground','heroText','heroOverlay','headerText','headerMuted','footerText','footerMuted','footerHeading','footerAccent','price','badgeBackground','badgeText','outOfStockBackground','outOfStockText','overlay'];
const VISUAL_TYPOGRAPHY_KEYS = ['bodyFont','headingFont','customBody','customHeading','baseSize','bodyWeight','headingWeight','lineHeight','headingScale','navSize','navSpacing','brandSpacing','navTransform'];
const VISUAL_LAYOUT_KEYS = ['maxWidth','gutterDesktop','gutterMobile','headerLayout','headerSticky','headerPadding','navGap','headerOrder','catalogAlign','catalogTop','catalogBottom','introMaxWidth','blocks','toolbarLayout','gridColumnsDesktop','gridColumnsTablet','gridColumnsMobile','gridGapX','gridGapY','cardStyle','cardAlign','cardPadding','imageRatio','imageFit','radius','buttonRadius','inputRadius','shadow','footerAlign','footerOrder','headerLogoMode','footerLogoMode','headerLogoWidth','footerLogoWidth','heroMode','heroPadding','heroRadius','animations'];
const VISUAL_VISIBILITY_KEYS = ['category','unit','stock','quickAdd','search','filters','resultCount','footerDescription','footerContact'];
const PRODUCT_ATTRIBUTE_KEYS = ['wineType','grape','vintage','alcohol','volume','serving','pairing','origin','bean','roast','grind','intensity','weight','method','flavor','kind','sugar','ingredients','storage','quantity','flavors','allergens','shelfLife','minOrder'];

export function cleanText(value, max = 500) {
  return String(value ?? '').replace(controlChars, '').trim().slice(0, max);
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
  return url.startsWith('/assets/') || /^https:\/\/[^\s]+$/i.test(url) ? url : '';
}

function safeHttpsUrl(value) {
  const url = cleanText(value, 2048);
  return /^https:\/\/[^\s]+$/i.test(url) ? url : '';
}

function safeVisualColor(value) {
  const text = cleanText(value, 64);
  return text && !/[;{}<>]/.test(text) ? text : '';
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
    privacyText: cleanText(source.privacyText, 10_000),
    termsText: cleanText(source.termsText, 10_000),
    returnsText: cleanText(source.returnsText, 10_000),
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
  const products = Array.isArray(raw.products) ? raw.products : [];
  if (products.length > 1000) throw new Error('O catálogo excede o limite de 1000 produtos.');

  const ids = new Set();
  const normalizedProducts = products.map((product, index) => {
    if (!product || typeof product !== 'object' || Array.isArray(product)) throw new Error(`Produto ${index + 1} inválido.`);
    const id = cleanText(product.id, 120);
    const name = cleanText(product.name, 160);
    if (!id || !name) throw new Error(`Produto ${index + 1} precisa de id e nome.`);
    if (ids.has(id)) throw new Error(`ID de produto duplicado: ${id}`);
    ids.add(id);

    const price = priceCents(product.price, -1);
    if (price < 0) throw new Error(`Preço inválido no produto ${name}.`);
    const variantIds = new Set();
    const variants = Array.isArray(product.variants) ? product.variants.slice(0, 100).map((variant, variantIndex) => {
      const variantId = cleanText(variant?.id, 120);
      if (!variantId) throw new Error(`Variante ${variantIndex + 1} de ${name} sem id.`);
      if (variantIds.has(variantId)) throw new Error(`ID de variante duplicado em ${name}: ${variantId}`);
      variantIds.add(variantId);
      return {
        id: variantId,
        name: cleanText(variant?.name, 120),
        price: (() => { const value = priceCents(variant?.price, price); if (value < 0) throw new Error(`Preço inválido na variante ${variantId} de ${name}.`); return value; })(),
        stock: variant?.stock == null ? null : cents(variant.stock, 0),
        unit: cleanText(variant?.unit, 120),
        weightGrams: variant?.weightGrams == null ? null : integer(variant.weightGrams, 0, 1, 100_000),
        position: integer(variant?.position, variantIndex + 1, 0, 100_000)
      };
    }) : [];

    return {
      id,
      name,
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
      images: (Array.isArray(product.images) ? product.images : []).map(safeImageUrl).filter(Boolean).slice(0, 12),
      variants,
      attributes: sanitizeAttributes(product.attributes),
      stock: product.stock == null ? null : cents(product.stock, 0),
      stockMin: product.stockMin == null ? null : cents(product.stockMin, 0),
      maxPerOrder: product.maxPerOrder == null ? null : integer(product.maxPerOrder, 1, 1, 999),
      minPerOrder: product.minPerOrder == null ? null : integer(product.minPerOrder, 1, 1, 999),
      weightGrams: product.weightGrams == null ? null : integer(product.weightGrams, 0, 1, 100_000),
      lengthCm: product.lengthCm == null ? null : integer(product.lengthCm, 0, 1, 100),
      widthCm: product.widthCm == null ? null : integer(product.widthCm, 0, 1, 100),
      heightCm: product.heightCm == null ? null : integer(product.heightCm, 0, 1, 100),
      boxes: (Array.isArray(product.boxes) ? product.boxes : []).slice(0, 10).map(box => ({
        variantId: cleanText(box?.variantId, 120),
        units: integer(box?.units, 0, 1, 1000),
        lengthCm: integer(box?.lengthCm, 0, 1, 100),
        widthCm: integer(box?.widthCm, 0, 1, 100),
        heightCm: integer(box?.heightCm, 0, 1, 100),
        weightGrams: integer(box?.weightGrams, 0, 1, 100_000)
      })).filter(box => box.units > 0 && box.weightGrams > 0 && box.lengthCm > 0 && box.widthCm > 0 && box.heightCm > 0),
      restockDate: cleanText(product.restockDate, 40),
      preparation: cleanText(product.preparation, 500),
      available: product.available !== false,
      featured: product.featured === true,
      madeToOrder: product.madeToOrder === true,
      seasonal: product.seasonal === true,
      giftEnabled: product.giftEnabled !== false,
      position: integer(product.position, index + 1, 0, 100_000),
      created: product.created == null ? null : finite(product.created, 0, 0, Number.MAX_SAFE_INTEGER),
      updated: product.updated == null ? null : finite(product.updated, 0, 0, Number.MAX_SAFE_INTEGER),
      deletedAt: product.deletedAt == null ? null : cleanText(product.deletedAt, 60)
    };
  });

  return {
    version: integer(raw.version, 9, 1, 999),
    settings: sanitizeSettings(raw.settings),
    commerce: sanitizeCommerce(raw.commerce ?? raw.v8),
    coupons: sanitizeCoupons(raw.coupons),
    products: normalizedProducts
  };
}

export function publicCatalog(catalog, serverConfig) {
  const result = normalizeCatalog(catalog);
  delete result.coupons;
  result.hasAlcohol = result.products.some(product => product.available !== false && isAlcoholicProduct(product));
  result.commerce.apiBaseUrl = '';
  result.commerce.apiMode = 'required';
  result.commerce.paymentMethods = {
    whatsapp: false,
    pix: Boolean(result.commerce.paymentMethods?.pix && result.commerce.pixKey),
    card: Boolean(serverConfig.mercadoPagoAccessToken && serverConfig.mercadoPagoWebhookSecret)
  };
  result.settings.whatsapp = cleanText(serverConfig.whatsappNumber || result.settings.whatsapp, 40);
  return result;
}

function productPrice(product, variantId) {
  if (variantId) {
    const variant = (product.variants || []).find(item => item.id === variantId);
    if (!variant) throw new Error(`Opção inválida para ${product.name}.`);
    return {variant, unitPriceCents: cents(variant.price, product.price)};
  }
  if ((product.variants || []).length) {
    const first = product.variants[0];
    return {variant: first, unitPriceCents: cents(first.price, product.price)};
  }
  return {variant: null, unitPriceCents: cents(product.price)};
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

  const normalizedCep = digits(cep).slice(0, 8);
  if (normalizedCep.length !== 8) throw new Error('Informe um CEP válido com 8 dígitos.');
  const mode = cleanText(serverConfig.shippingMode || settings.shipMode || 'quote', 20).toLowerCase();
  const freeThreshold = cents(serverConfig.freeShippingCents ?? settings.free, 0);
  if (freeThreshold > 0 && subtotalCents >= freeThreshold) {
    return {choice: 'delivery', cep: normalizedCep, priceCents: 0, quoted: false, label: 'Frete grátis'};
  }

  // Frete já cotado pelo servidor via API (Correios): valor confiável injetado
  // pela própria rota, nunca pelo navegador.
  if (mode === 'correios' && resolved && Number.isSafeInteger(resolved.priceCents) && resolved.priceCents >= 0) {
    return {
      choice: 'delivery',
      cep: normalizedCep,
      priceCents: resolved.priceCents,
      quoted: false,
      label: cleanText(resolved.label, 160) || 'Correios',
      days: resolved.days != null ? String(resolved.days) : '',
      service: cleanText(resolved.service, 20)
    };
  }
  if (mode === 'correios') {
    // API indisponível ou dados de peso ausentes: cai para cotação manual.
    return {choice: 'delivery', cep: normalizedCep, priceCents: null, quoted: true, label: 'Frete sob cotação'};
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
    if (!product || product.available === false) throw new Error('Um dos produtos não está mais disponível.');
    const variantId = cleanText(item?.variantId, 120);
    const {variant, unitPriceCents} = productPrice(product, variantId);
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

  const shipping = calculateShipping(payload.shipping || {}, subtotalCents, catalog.settings || {}, serverConfig);

  let coupon = null;
  let discountCents = 0;
  const couponCode = cleanText(payload.couponCode, 40).toUpperCase();
  if (couponCode) {
    coupon = findCoupon(catalog, couponCode);
    const check = validateCoupon(coupon, {subtotalCents, shippingChoice: shipping.choice, shippingQuoted: shipping.quoted});
    if (!check.ok) throw new Error(check.error || 'Cupom inválido.');
    discountCents = couponDiscount(coupon, subtotalCents, shipping.priceCents ?? 0);
  }

  const totalCents = subtotalCents + (shipping.priceCents ?? 0) - discountCents;
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new Error('Total do pedido inválido.');
  const email = cleanText(payload.customer?.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');

  const phone = cleanText(payload.customer?.phone, 30);
  if (!email && !phone) throw new Error('Informe um e-mail ou telefone para contato.');
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
