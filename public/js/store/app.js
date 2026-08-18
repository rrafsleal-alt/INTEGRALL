(() => {
  'use strict';

  function injectSeo(app, remote) {
    if (location.protocol === 'https:') {
      let canonical = document.querySelector('link[rel="canonical"]');
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.append(canonical);
      }
      canonical.href = location.origin + location.pathname;
      // og:image/twitter:image precisam de URL ABSOLUTA para funcionar no
      // WhatsApp/Facebook; o HTML estático só conhece o caminho relativo.
      for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
        const meta = document.querySelector(selector);
        if (meta && meta.content.startsWith('/')) meta.content = location.origin + meta.content;
      }
      let ogUrl = document.querySelector('meta[property="og:url"]');
      if (!ogUrl) {
        ogUrl = document.createElement('meta');
        ogUrl.setAttribute('property', 'og:url');
        document.head.append(ogUrl);
      }
      ogUrl.content = location.origin + location.pathname;
    }

    const state = app.getState();
    let structured = document.querySelector('#integrallRuntimeStructuredData');
    if (!structured) {
      structured = document.createElement('script');
      structured.id = 'integrallRuntimeStructuredData';
      structured.type = 'application/ld+json';
      document.head.append(structured);
    }
    const cfg = remote?.commerce || remote?.v8 || {};
    const products = (state.products || []).filter(product => product.available !== false && app.basePrice(product) > 0).slice(0, 100);
    structured.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          name: cfg.businessName || state.settings.brand || 'INTEGRALL',
          url: location.protocol === 'https:' ? location.origin : undefined,
          email: cfg.supportEmail || state.settings.email || undefined,
          telephone: cfg.supportPhone || undefined
        },
        {
          '@type': 'ItemList',
          name: `${state.settings.brand || 'INTEGRALL'} — catálogo`,
          itemListElement: products.map((product, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            item: {
              '@type': 'Product',
              name: product.name,
              description: product.description || undefined,
              sku: product.sku || undefined,
              brand: product.brand ? {'@type': 'Brand', name: product.brand} : undefined,
              offers: {
                '@type': 'Offer',
                priceCurrency: 'BRL',
                price: (app.basePrice(product) / 100).toFixed(2),
                availability: app.productAvailable(product) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
              }
            }
          }))
        }
      ]
    });
  }

  async function boot() {
    const app = globalThis.__integrallApp;
    if (!app) return;
    let remote = null;
    if (/^https?:$/.test(location.protocol) && globalThis.IntegrallApi) {
      try {
        remote = await globalThis.IntegrallApi.getCatalog();
        const current = app.getState();
        if (remote.settings) app.setSettings({...current.settings, ...remote.settings, visual: remote.settings.visual || current.settings.visual});
        if (Array.isArray(remote.products)) app.setProducts(remote.products);
        const commerce = remote.commerce || remote.v8;
        if (commerce && typeof commerce === 'object') {
          globalThis.__integrallPublicConfig = commerce;
          globalThis.__integrallCheckout?.refreshConfig?.();
        }
      } catch (error) {
        console.warn('Catálogo remoto indisponível; usando catálogo embutido.', error);
      }
    }
    injectSeo(app, remote);
    await globalThis.__integrallCheckout?.handlePaymentReturn?.();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true});
  else boot();
})();
