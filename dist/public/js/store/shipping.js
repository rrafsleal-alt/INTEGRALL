(() => {
  'use strict';

  function app() {
    return globalThis.__integrallApp || null;
  }

  function current() {
    const currentApp = app();
    const state = currentApp?.getState?.();
    if (!currentApp || !state) return null;
    const subtotal = globalThis.IntegrallCart?.subtotal?.() ?? currentApp.cartSubtotal?.() ?? 0;
    return currentApp.calculateShipping(subtotal, state.checkout?.choice, state.checkout?.cep);
  }

  function quote(subtotalCents, choice, cep) {
    return app()?.calculateShipping?.(subtotalCents, choice, cep) ?? null;
  }

  globalThis.IntegrallShipping = Object.freeze({current, quote});
})();
