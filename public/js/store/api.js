(() => {
  'use strict';

  const TIMEOUT_MS = 10000;

  function apiBase() {
    if (!/^https?:$/.test(location.protocol)) return '';
    return location.origin;
  }

  function apiError(message, {status = 0, code = '', requestId = ''} = {}) {
    return Object.assign(new Error(message), {status, code, requestId});
  }

  async function request(path, options = {}) {
    const base = apiBase();
    if (!base) throw apiError('API indisponível fora de HTTP/HTTPS.', {code: 'API_ORIGIN_INVALID'});
    const controller = new AbortController();
    const externalSignal = options.signal;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1000,Math.min(45000,options.timeoutMs)) : TIMEOUT_MS;
    const {timeoutMs: ignoredTimeout, ...fetchOptions} = options;
    // A caller cancelling navigation must not be converted into a timeout.
    const abortFromCaller = () => controller.abort();
    if (externalSignal?.aborted) throw new DOMException('Requisição cancelada.', 'AbortError');
    externalSignal?.addEventListener('abort', abortFromCaller, {once: true});
    let timedOut = false;
    const timer = setTimeout(() => {timedOut = true; controller.abort();}, timeoutMs);
    try {
      const headers = new Headers(options.headers || {});
      headers.set('Accept', 'application/json');
      const multipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
      if (options.body && !multipart && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      const response = await fetch(`${base}${path}`, {...fetchOptions, headers, signal: controller.signal});
      let data = {};
      let invalidJson = false;
      if (response.status !== 204) {
        try {data = await response.json();} catch (error) {if(controller.signal.aborted)throw error;invalidJson = true;}
      }
      if(controller.signal.aborted)throw new DOMException('Requisição cancelada.', 'AbortError');
      const requestId = String(data?.requestId || response.headers?.get('x-request-id') || '');
      if (!response.ok) {
        throw apiError(typeof data?.error === 'string' ? data.error : `Falha na API (HTTP ${response.status}).`, {
          status: response.status, code: String(data?.code || 'API_HTTP_ERROR'), requestId
        });
      }
      if (invalidJson || !data || typeof data !== 'object') {
        throw apiError('O servidor enviou uma resposta inválida. Tente novamente.', {
          status: response.status, code: 'API_RESPONSE_INVALID', requestId
        });
      }
      return data;
    } catch (error) {
      if (timedOut) throw apiError('A API demorou demais para responder.', {code: 'API_TIMEOUT'});
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  globalThis.IntegrallApi = Object.freeze({
    request,
    getCatalog: () => request('/api/catalog'),
    createOrder: payload => request('/api/orders', {method: 'POST', timeoutMs: 35000, body: JSON.stringify(payload)}),
    orderStatus: (orderId, checkoutToken) => request('/api/orders/status', {method: 'POST', body: JSON.stringify({orderId, checkoutToken})}),
    createCheckout: (orderId, checkoutToken) => request('/api/payments/checkout', {method: 'POST', body: JSON.stringify({orderId, checkoutToken})})
  });
})();
