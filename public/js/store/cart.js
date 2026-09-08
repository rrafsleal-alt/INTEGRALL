(() => {
  'use strict';

  function app() {
    return globalThis.__integrallApp || null;
  }

  function details() {
    return app()?.cartDetails?.() || [];
  }

  function subtotal() {
    return Number(app()?.cartSubtotal?.() || 0);
  }

  function message() {
    return app()?.checkoutMessage?.() || '';
  }

  function clear() {
    const current = app();
    if (!current) return;
    const state = current.getState();
    state.cart = [];
    current.saveCart();
    current.renderCart();
  }

  globalThis.IntegrallCart = Object.freeze({details, subtotal, message, clear});
})();
