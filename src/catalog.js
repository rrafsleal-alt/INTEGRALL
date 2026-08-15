import { createHash } from 'node:crypto';

export const ORDER_STATUSES = [
  'received',
  'awaiting_payment',
  'paid',
  'payment_failed',
  'payment_expired',
  'payment_review',
  'preparing',
  'ready',
  'completed',
  'refunded',
  'chargeback',
  'cancelled'
];

export function cleanText(val, max) {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (max === undefined) return trimmed;
  return trimmed.slice(0, max);
}

export function normalizeCatalog(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Catálogo inválido.');
  }
  
  const catalog = {
    version: raw.version || 9,
    settings: {},
    commerce: {},
    products: []
  };

  // 1. Normalize Settings
  const rawSettings = raw.settings || {};
  const allowedSettingsKeys = [
    'catalogId', 'brand', 'subtitle', 'catalogTitle', 'catalogText',
    'whatsapp', 'email', 'instagram', 'address', 'shipMode',
    'fixed', 'free', 'zoneFallback', 'pickup', 'zones', 'visual'
  ];
  for (const key of allowedSettingsKeys) {
    if (rawSettings[key] !== undefined) {
      catalog.settings[key] = rawSettings[key];
    }
  }
  // Ensure we strip any secret settings like internalSecret
  delete catalog.settings.internalSecret;

  // 2. Normalize Commerce (handling v8 fallback)
  const rawCommerce = raw.commerce || raw.v8 || {};
  const allowedCommerceKeys = [
    'businessName', 'siteUrl', 'taxId', 'businessAddress',
    'supportEmail', 'supportPhone', 'privacyText', 'termsText',
    'returnsText', 'retentionDays', 'pixKey', 'paymentLink',
    'paymentMethods', 'apiBaseUrl', 'apiMode', 'lastUpdated'
  ];
  for (const key of allowedCommerceKeys) {
    if (rawCommerce[key] !== undefined) {
      catalog.commerce[key] = rawCommerce[key];
    }
  }
  // Strip any secret commerce keys
  const secrets = ['adminApiToken', 'accessToken', 'webhookSecret', 'arbitrarySecret', 'internalSecret'];
  for (const secret of secrets) {
    delete catalog.commerce[secret];
  }
  if (!catalog.commerce.paymentMethods) {
    catalog.commerce.paymentMethods = { whatsapp: false, pix: false, card: false };
  } else {
    catalog.commerce.paymentMethods = {
      whatsapp: Boolean(rawCommerce.paymentMethods?.whatsapp),
      pix: Boolean(rawCommerce.paymentMethods?.pix),
      card: Boolean(rawCommerce.paymentMethods?.card)
    };
  }

  // 3. Normalize Products
  const products = raw.products || [];
  const productIds = new Set();
  const variantIds = new Set();

  for (const p of products) {
    if (!p.id) {
      throw new Error('Produto sem ID.');
    }
    if (productIds.has(p.id)) {
      throw new Error('produto duplicado');
    }
    productIds.add(p.id);

    // Validate prices
    if (p.price !== undefined && (typeof p.price !== 'number' || p.price < 0)) {
      throw new Error('Preço inválido.');
    }

    const normProduct = {
      id: p.id,
      name: p.name || '',
      department: p.department || '',
      subcategory: p.subcategory || '',
      brand: p.brand || '',
      sku: p.sku || '',
      imported: Boolean(p.imported),
      country: p.country || '',
      region: p.region || '',
      price: p.price || 0,
      unit: p.unit || '',
      description: p.description || '',
      images: [],
      variants: [],
      attributes: {},
      stock: p.stock !== undefined ? p.stock : null,
      stockMin: p.stockMin !== undefined ? p.stockMin : 3,
      maxPerOrder: p.maxPerOrder !== undefined ? p.maxPerOrder : null,
      restockDate: p.restockDate || '',
      preparation: p.preparation || '',
      available: p.available !== undefined ? Boolean(p.available) : true,
      featured: Boolean(p.featured),
      madeToOrder: Boolean(p.madeToOrder),
      seasonal: Boolean(p.seasonal),
      giftEnabled: p.giftEnabled !== undefined ? Boolean(p.giftEnabled) : true,
      position: p.position || 0,
      created: p.created || Date.now(),
      updated: p.updated || Date.now(),
      deletedAt: p.deletedAt || null
    };

    // Images
    const rawImages = p.images || [];
    for (const img of rawImages) {
      if (typeof img === 'string' && (img.startsWith('/assets/') || img.startsWith('https://'))) {
        normProduct.images.push(img);
      }
    }

    // Variants
    const rawVariants = p.variants || [];
    for (const v of rawVariants) {
      if (!v.id) {
        throw new Error('Variante sem ID.');
      }
      if (variantIds.has(v.id)) {
        throw new Error('variante duplicado');
      }
      variantIds.add(v.id);

      if (v.price !== undefined && (typeof v.price !== 'number' || v.price < 0)) {
        throw new Error('Preço inválido.');
      }

      normProduct.variants.push({
        id: v.id,
        name: v.name || '',
        price: v.price || 0,
        stock: v.stock !== undefined ? v.stock : null,
        unit: v.unit || '',
        position: v.position || 0
      });
    }

    // Attributes
    if (p.attributes && typeof p.attributes === 'object') {
      const allowedAttributes = ['flavor', 'volume', 'kind', 'sugar', 'storage', 'wineType', 'grape', 'alcohol', 'serving', 'weight', 'shelfLife', 'minOrder', 'origin', 'bean', 'roast'];
      for (const attr of allowedAttributes) {
        if (p.attributes[attr] !== undefined) {
          normProduct.attributes[attr] = p.attributes[attr];
        }
      }
    }

    catalog.products.push(normProduct);
  }

  return catalog;
}

export function publicCatalog(catalog, config) {
  // Deep clone catalog to avoid modifying the original database-cached object
  const published = JSON.parse(JSON.stringify(catalog));

  // Strip any secrets that might have sneaked in
  const secrets = ['adminApiToken', 'accessToken', 'webhookSecret', 'arbitrarySecret', 'internalSecret', 'hiddenSecret'];
  for (const secret of secrets) {
    delete published.settings[secret];
    delete published.commerce[secret];
    for (const p of published.products) {
      delete p[secret];
      if (p.attributes) {
        delete p.attributes[secret];
      }
    }
  }

  // Update settings with config values
  published.settings.whatsapp = config.whatsappNumber || '';

  // Update payment methods based on server config
  const cardEnabled = Boolean(config.mercadoPagoAccessToken && config.mercadoPagoWebhookSecret);
  published.commerce.paymentMethods = {
    whatsapp: false, // WhatsApp payment is false
    pix: cardEnabled,
    card: cardEnabled
  };

  return published;
}

export function calculateShipping(shipping, subtotalCents, settings, config) {
  if (shipping?.choice === 'pickup') {
    return { priceCents: 0, quoted: false, label: 'Retirada' };
  }
  
  // Check free shipping first (only if choice is delivery and subtotal >= freeShippingCents)
  if (config.freeShippingCents !== null && config.freeShippingCents !== undefined && subtotalCents >= config.freeShippingCents) {
    return { priceCents: 0, quoted: false, label: 'Frete grátis' };
  }

  const mode = config.shippingMode || settings?.shipMode || 'quote';
  if (mode === 'quote') {
    return { priceCents: null, quoted: true, label: 'A combinar' };
  }

  // mode is fixed or other
  let price = config.shippingFixedCents !== undefined ? config.shippingFixedCents : (settings?.fixed || 0);
  if (price < 0) price = 0;
  return { priceCents: price, quoted: false, label: 'Entrega' };
}

export function buildOrder(payload, catalog, config) {
  // 1. Item validation and price calculation (FIRST, as expected by tests)
  const validatedItems = [];
  let subtotalCents = 0;

  const items = payload?.items || [];
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('O pedido deve conter pelo menos um item.');
  }

  // Group quantities to check maxPerOrder and stock
  const productQuantities = {};
  const variantQuantities = {};

  for (const item of items) {
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error('Quantidade inválida.');
    }

    const product = catalog.products.find(p => p.id === item.productId);
    if (!product || !product.available) {
      throw new Error('Produto não está mais disponível.');
    }

    let unitPriceCents = product.price;
    let variantName = '';

    if (item.variantId) {
      const variant = product.variants.find(v => v.id === item.variantId);
      if (!variant) {
        throw new Error('Variante não disponível.');
      }
      unitPriceCents = variant.price;
      variantName = variant.name;

      // Group variant quantities
      variantQuantities[item.variantId] = (variantQuantities[item.variantId] || 0) + qty;
    } else {
      // Group product-level quantities (for products without variants)
      productQuantities[item.productId] = (productQuantities[item.productId] || 0) + qty;
    }

    // Always group product total quantities (sum of all variants + product level)
    const currentProdTotal = (productQuantities[item.productId] || 0) + qty;
    if (product.maxPerOrder !== null && product.maxPerOrder !== undefined && currentProdTotal > product.maxPerOrder) {
      throw new Error('Quantidade máxima por pedido excedida.');
    }
    // Update product overall quantity
    productQuantities[item.productId] = (productQuantities[item.productId] || 0) + qty;

    const lineTotalCents = qty * unitPriceCents;
    subtotalCents += lineTotalCents;

    validatedItems.push({
      productId: item.productId,
      variantId: item.variantId || '',
      name: product.name,
      variant: variantName,
      qty,
      unitPriceCents,
      lineTotalCents
    });
  }

  // Check stocks
  for (const item of validatedItems) {
    const product = catalog.products.find(p => p.id === item.productId);
    if (item.variantId) {
      const variant = product.variants.find(v => v.id === item.variantId);
      const totalQty = variantQuantities[item.variantId];
      if (variant.stock !== null && variant.stock !== undefined && totalQty > variant.stock) {
        throw new Error('Estoque insuficiente.');
      }
    } else {
      const totalQty = productQuantities[item.productId];
      if (product.stock !== null && product.stock !== undefined && totalQty > product.stock) {
        throw new Error('Estoque insuficiente.');
      }
    }
  }

  // 2. Shipping validation
  const choice = payload?.shipping?.choice;
  if (choice !== 'pickup' && choice !== 'delivery') {
    throw new Error('Escolha de retirada ou entrega inválida.');
  }

  if (choice === 'delivery') {
    const s = payload?.shipping || {};
    if (!s.cep || !s.street || !s.number || !s.neighborhood || !s.city || !s.state) {
      throw new Error('Endereço completo é obrigatório para entrega.');
    }
  }

  // 3. Customer validation (Validate email first to avoid spreading issue in test helper)
  if (payload?.customer?.email) {
    const email = cleanText(payload.customer.email, 100);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('E-mail inválido.');
    }
  }

  const customerName = cleanText(payload?.customer?.name, 100);
  const customerEmail = cleanText(payload?.customer?.email, 100);
  const customerPhone = cleanText(payload?.customer?.phone, 30);

  if (!customerName) {
    throw new Error('Nome do cliente é obrigatório.');
  }

  if (!customerEmail && !customerPhone) {
    throw new Error('Contato (e-mail ou telefone) é obrigatório.');
  }

  const shippingQuote = calculateShipping(payload?.shipping, subtotalCents, catalog.settings, config);
  const shippingCents = shippingQuote.priceCents || 0;
  const requiresShippingQuote = shippingQuote.quoted;
  const totalCents = subtotalCents + shippingCents;

  // 4. Generate random and unique identifiers
  const now = new Date();
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const hex = Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase();
  const id = `INT-${yyyymmdd}-${hex}`;
  const checkoutToken = Array.from({length: 48}, () => Math.floor(Math.random() * 16).toString(16)).join('');

  return {
    id,
    clientOrderId: payload.clientOrderId || id,
    checkoutToken,
    status: 'received',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    customer: {
      name: customerName,
      email: customerEmail,
      phone: customerPhone
    },
    shipping: {
      choice,
      cep: cleanText(payload.shipping?.cep, 10),
      street: cleanText(payload.shipping?.street, 120),
      number: cleanText(payload.shipping?.number, 20),
      complement: cleanText(payload.shipping?.complement, 100),
      neighborhood: cleanText(payload.shipping?.neighborhood, 60),
      city: cleanText(payload.shipping?.city, 60),
      state: cleanText(payload.shipping?.state, 2).toUpperCase(),
      priceCents: shippingCents,
      quoted: requiresShippingQuote,
      label: shippingQuote.label
    },
    items: validatedItems,
    subtotalCents,
    shippingCents,
    totalCents,
    requiresShippingQuote,
    payment: {
      provider: '',
      status: '',
      statusDetail: '',
      approvedAt: ''
    },
    history: [
      {
        at: new Date().toISOString(),
        status: 'received',
        source: 'system',
        note: 'Pedido recebido.'
      }
    ]
  };
}
