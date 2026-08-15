(() => {
  'use strict';

  const TIMEOUT_MS = 10000;

  function apiBase() {
    if (!/^https?:$/.test(location.protocol)) return '';
    return location.origin;
  }

  async function request(path, options = {}) {
    const base = apiBase();
    if (!base) throw new Error('API indisponível fora de HTTP/HTTPS.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers = new Headers(options.headers || {});
      headers.set('Accept', 'application/json');
      if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      const response = await fetch(`${base}${path}`, {...options, headers, signal: controller.signal});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Falha na API (HTTP ${response.status}).`);
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('A API demorou demais para responder.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  globalThis.IntegrallApi = Object.freeze({
    request,
    getCatalog: () => request('/api/catalog'),
    createOrder: payload => request('/api/orders', {method: 'POST', body: JSON.stringify(payload)}),
    orderStatus: (orderId, checkoutToken) => request('/api/orders/status', {method: 'POST', body: JSON.stringify({orderId, checkoutToken})}),
    createCheckout: (orderId, checkoutToken) => request('/api/payments/checkout', {method: 'POST', body: JSON.stringify({orderId, checkoutToken})})
  });
})();
