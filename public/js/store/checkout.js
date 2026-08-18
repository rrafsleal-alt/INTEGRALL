(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const digits = value => String(value || '').replace(/\D/g, '');
  const cleanText = (value, max = 1000) => String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
  const CUSTOMER_KEY = 'integrall_customer_profile_v9';
  const ORDER_ATTEMPT_KEY = 'integrall_order_attempt_v9';
  const LAST_ORDER_KEY = 'integrall_last_order_v9';
  let memoryAttempt = null;
  let activeTrackedOrder = null;
  let appliedCoupon = null;
  let correiosOptions = [];
  let correiosSelected = '';
  let correiosQuoteTimer = null;
  let correiosLastKey = '';

  const STATUS_LABELS = Object.freeze({
    received: 'Pedido recebido',
    awaiting_payment: 'Aguardando pagamento',
    paid: 'Pagamento confirmado',
    payment_failed: 'Pagamento não aprovado',
    payment_expired: 'Pagamento expirado',
    payment_review: 'Pagamento em revisão',
    preparing: 'Preparando pedido',
    ready: 'Pedido pronto',
    completed: 'Pedido concluído',
    refunded: 'Pagamento reembolsado',
    chargeback: 'Pagamento contestado',
    cancelled: 'Pedido cancelado'
  });

  const DEFAULT_CONFIG = Object.freeze({
    businessName: 'INTEGRALL',
    supportEmail: '',
    supportPhone: '',
    businessAddress: '',
    privacyText: 'Utilizamos apenas os dados necessários para atender seu pedido e prestar suporte.',
    termsText: 'Produtos, preços, disponibilidade, frete e prazos devem ser confirmados antes da conclusão do pedido.',
    returnsText: 'Solicitações de troca, devolução ou cancelamento devem ser feitas pelo canal de atendimento com o número do pedido.',
    paymentMethods: {whatsapp: false, pix: false, card: false},
    apiMode: 'required'
  });

  function embeddedConfig() {
    try {
      const data = JSON.parse($('#buildData')?.textContent || '{}');
      const commerce = data?.commerce || data?.v8;
      return commerce && typeof commerce === 'object' ? commerce : {};
    } catch {
      return {};
    }
  }

  function config() {
    const remote = globalThis.__integrallPublicConfig;
    const merged = {...DEFAULT_CONFIG, ...embeddedConfig(), ...(remote && typeof remote === 'object' ? remote : {})};
    merged.privacyText = cleanText(merged.privacyText, 10000) || DEFAULT_CONFIG.privacyText;
    merged.termsText = cleanText(merged.termsText, 10000) || DEFAULT_CONFIG.termsText;
    merged.returnsText = cleanText(merged.returnsText, 10000) || DEFAULT_CONFIG.returnsText;
    return merged;
  }

  function notify(message, type = '') {
    const app = globalThis.__integrallApp;
    if (app?.notify) app.notify(message, type);
    else console[type === 'bad' ? 'error' : 'log'](message);
  }

  function loadProfile() {
    try {
      const profile = JSON.parse(sessionStorage.getItem(CUSTOMER_KEY) || '{}');
      return profile && typeof profile === 'object' ? profile : {};
    } catch {
      return {};
    }
  }

  function saveProfile() {
    try {
      sessionStorage.setItem(CUSTOMER_KEY, JSON.stringify({
        email: cleanText($('#customerEmail')?.value, 254),
        phone: cleanText($('#customerPhone')?.value, 30),
        street: cleanText($('#deliveryStreet')?.value, 180),
        number: cleanText($('#deliveryNumber')?.value, 40),
        complement: cleanText($('#deliveryComplement')?.value, 120),
        neighborhood: cleanText($('#deliveryNeighborhood')?.value, 120),
        city: cleanText($('#deliveryCity')?.value, 120),
        state: cleanText($('#deliveryState')?.value, 2).toUpperCase()
      }));
    } catch {}
  }

  // A referência do último pedido (número + autorização de consulta) persiste
  // em localStorage para que o cliente possa voltar depois — inclusive pelo
  // link do e-mail de confirmação. A consulta pública não expõe dados
  // pessoais (ver publicOrder no servidor), apenas status/valores/rastreio.
  function saveLastOrder(value) {
    try { localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(value)); } catch {}
    try { sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(value)); } catch {}
  }

  function loadLastOrder() {
    try {
      const raw = localStorage.getItem(LAST_ORDER_KEY) || sessionStorage.getItem(LAST_ORDER_KEY) || 'null';
      const value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : null;
    } catch { return null; }
  }

  /**
   * Focus trap: mantém o Tab circulando dentro do modal aberto (WCAG 2.4.3).
   * Aplica uma única vez por elemento; ativo apenas enquanto o modal está aberto.
   */
  function trapFocus(modal) {
    if (!modal || modal.dataset.focusTrapped) return;
    modal.dataset.focusTrapped = '1';
    modal.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || !modal.classList.contains('open')) return;
      const focusables = [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.disabled && !el.hidden && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

  function injectAccessibility() {
    if (!$('.integrall-skip-link')) {
      const link = document.createElement('a');
      link.className = 'integrall-skip-link';
      link.href = '#siteMain';
      link.textContent = 'Ir para o conteúdo principal';
      document.body.prepend(link);
    }
    $('#siteMain')?.setAttribute('tabindex', '-1');
    $('#productGrid')?.setAttribute('role', 'list');
    $('#resultCount')?.setAttribute('aria-live', 'polite');
    $('#search')?.setAttribute('enterkeyhint', 'search');
  }

  function ensureLegalModal() {
    if ($('#legalModal')) return $('#legalModal');
    const modal = document.createElement('section');
    modal.id = 'legalModal';
    modal.className = 'modal auth-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('aria-labelledby', 'legalTitle');
    modal.innerHTML = '<div class="panel-head"><h2 id="legalTitle"></h2><button class="close-btn" type="button" aria-label="Fechar">✕</button></div><div class="modal-body"><div class="legal-meta" id="legalMeta"></div><div class="legal-copy" id="legalCopy"></div></div>';
    document.body.append(modal);
    const close = () => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('lock');
    };
    modal.querySelector('.close-btn').addEventListener('click', close);
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal.classList.contains('open')) close(); });
    trapFocus(modal);
    return modal;
  }

  function openLegal(kind) {
    const cfg = config();
    const content = {
      privacy: ['Privacidade', cfg.privacyText],
      terms: ['Termos de uso', cfg.termsText],
      returns: ['Trocas, devoluções e cancelamentos', cfg.returnsText]
    }[kind] || ['Termos de uso', cfg.termsText];
    const modal = ensureLegalModal();
    $('#legalTitle').textContent = content[0];
    $('#legalCopy').textContent = cleanText(content[1], 10000) || 'Informação ainda não configurada.';
    const details = [cfg.businessName, cfg.businessAddress, cfg.supportEmail, cfg.supportPhone].map(v => cleanText(v, 500)).filter(Boolean);
    $('#legalMeta').textContent = details.join(' • ');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lock');
    modal.querySelector('.close-btn')?.focus();
  }

  function bindLegalLinks() {
    ensureLegalModal();
    document.addEventListener('click', event => {
      const trigger = event.target.closest?.('[data-legal]');
      if (!trigger) return;
      event.preventDefault();
      openLegal(trigger.dataset.legal);
    });
  }

  function createPaymentOption(value, title, description, checked) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'paymentMethod';
    input.value = value;
    input.checked = checked;
    const text = document.createElement('span');
    const strong = document.createElement('b');
    strong.textContent = title;
    const br = document.createElement('br');
    const small = document.createElement('small');
    small.textContent = description;
    text.append(strong, br, small);
    label.append(input, text);
    return label;
  }

  function renderPaymentMethods() {
    const root = $('#paymentMethods');
    if (!root) return;
    const cfg = config();
    const onlineActive = cfg.paymentMethods?.card === true;
    const selected = root.querySelector('input:checked')?.value;
    const methods = [];
    if (onlineActive) {
      methods.push(['card', 'PIX ou cartão', 'Pagamento imediato no ambiente seguro do Mercado Pago']);
      methods.push(['order', 'Combinar com a loja', 'Finalize o pedido agora e acerte o pagamento diretamente com a INTEGRALL']);
    } else {
      methods.push(['order', 'Finalizar pedido', 'Seu pedido é enviado à INTEGRALL, que confirma o pagamento e a entrega com você']);
    }
    const button = $('#checkout');
    root.replaceChildren(...methods.map((method, index) => createPaymentOption(method[0], method[1], method[2], selected ? selected === method[0] : index === 0)));
    if (button) button.disabled = false;
    const syncLabel = () => {
      if (!button) return;
      button.textContent = root.querySelector('input:checked')?.value === 'card' ? 'Ir para o pagamento' : 'Finalizar pedido';
    };
    root.onchange = syncLabel;
    syncLabel();
    const note = $('#paymentAvailabilityNote');
    if (note) note.textContent = onlineActive
      ? 'Você será levado ao ambiente seguro do Mercado Pago para concluir o pagamento. O pedido é confirmado automaticamente.'
      : 'Após finalizar, você recebe o número do pedido e a INTEGRALL combina o pagamento e a entrega com você.';
  }

  function hydrateCustomerFields() {
    const profile = loadProfile();
    const fields = {
      customerEmail: ['email', 254], customerPhone: ['phone', 30], deliveryStreet: ['street', 180], deliveryNumber: ['number', 40],
      deliveryComplement: ['complement', 120], deliveryNeighborhood: ['neighborhood', 120], deliveryCity: ['city', 120], deliveryState: ['state', 2]
    };
    for (const [id, [key, max]] of Object.entries(fields)) {
      const node = $(`#${id}`);
      if (node && !node.value) node.value = cleanText(profile[key], max);
      node?.addEventListener('input', saveProfile);
    }
  }

  function cartHasAlcohol() {
    const app = globalThis.__integrallApp;
    const items = app?.cartDetails?.() || [];
    return items.some(item => {
      const product = item.product || {};
      // Flag calculada pelo servidor (publicCatalog) — fonte única de verdade.
      if (typeof product.isAlcoholic === 'boolean') return product.isAlcoholic;
      // Fallback para catálogo embutido antigo (sem a flag).
      const department = String(product.department || '').toLowerCase();
      return ['vinhos', 'vinho', 'espumantes', 'cervejas', 'cerveja', 'destilados', 'licores', 'bebidas-alcoolicas'].includes(department) || Boolean(product.attributes?.alcohol);
    });
  }

  function syncAgeConfirm() {
    const row = $('#ageConfirmRow');
    if (!row) return;
    row.hidden = !cartHasAlcohol();
  }

  function couponFeedback(message, type = '') {
    const node = $('#couponFeedback');
    if (!node) return;
    node.textContent = message;
    node.className = `coupon-feedback${type ? ` ${type}` : ''}`;
  }

  function clearCoupon(silent = false) {
    appliedCoupon = null;
    if (!silent) couponFeedback('');
    syncDiscountRow();
  }

  function couponDiscountCents(subtotalCents) {
    if (!appliedCoupon) return 0;
    if (appliedCoupon.type === 'percent') return Math.floor(subtotalCents * appliedCoupon.value / 100);
    if (appliedCoupon.type === 'fixed') return Math.min(appliedCoupon.value, Math.max(0, subtotalCents - 100));
    return 0;
  }

  /** Frete atualmente selecionado nas opções de transportadora (centavos) ou null. */
  function selectedCarrierShipping() {
    if (!correiosEnabled() || !correiosOptions.length) return null;
    const option = correiosOptions.find(item => item.service === correiosSelected) || correiosOptions[0];
    return option ? {priceCents: option.priceCents, label: option.label} : null;
  }

  /**
   * Resumo unificado do carrinho: subtotal + frete escolhido (Correios/Jadlog,
   * fixo ou zonas) − desconto do cupom. Mantém o total do carrinho IGUAL ao
   * que o servidor cobrará — nada de surpresa no fechamento.
   */
  function syncDiscountRow() {
    const row = $('#cartDiscountRow');
    const valueNode = $('#cartDiscount');
    const totalNode = $('#cartTotal');
    const shippingNode = $('#cartShipping');
    if (!row || !valueNode) return;
    const app = globalThis.__integrallApp;
    const subtotal = Number(app?.cartSubtotal?.() || 0);
    const choice = app?.getState?.()?.checkout?.choice;

    // 1) Frete efetivo: transportadora escolhida > cálculo local (fixo/zonas) > pendente
    let shippingCents = null;
    let shippingLabel = '';
    if (choice === 'pickup') {
      shippingCents = 0;
    } else if (choice === 'delivery') {
      const carrier = selectedCarrierShipping();
      if (carrier) {
        shippingCents = carrier.priceCents;
        shippingLabel = carrier.label;
      } else {
        const quote = app?.calculateShipping?.(subtotal);
        if (quote && quote.price != null) shippingCents = quote.price;
      }
    }
    if (shippingNode && shippingLabel && shippingCents != null) {
      const text = `${shippingLabel} — ${formatMoney(shippingCents)}`;
      if (shippingNode.textContent !== text) shippingNode.textContent = text;
    }

    // 2) Desconto do cupom (free_shipping desconta o frete cotado)
    let discount = 0;
    if (appliedCoupon && subtotal > 0) {
      if (appliedCoupon.type === 'free_shipping') discount = Math.max(0, shippingCents || 0);
      else discount = couponDiscountCents(subtotal);
    }
    if (discount > 0) {
      row.hidden = false;
      valueNode.textContent = appliedCoupon.type === 'free_shipping'
        ? `Frete grátis (− ${formatMoney(discount)})`
        : `− ${formatMoney(discount)}`;
    } else if (appliedCoupon && appliedCoupon.type === 'free_shipping' && subtotal > 0) {
      row.hidden = false;
      valueNode.textContent = 'Frete grátis com cupom';
    } else {
      row.hidden = true;
    }

    // 3) Total real
    if (totalNode && subtotal > 0) {
      const next = choice === 'delivery' && shippingCents == null
        ? `${formatMoney(Math.max(0, subtotal - (appliedCoupon && appliedCoupon.type !== 'free_shipping' ? discount : 0)))} + entrega`
        : formatMoney(Math.max(0, subtotal + (shippingCents || 0) - discount));
      if (totalNode.textContent !== next) totalNode.textContent = next;
    }
  }

  async function applyCoupon() {
    const input = $('#couponInput');
    const button = $('#couponApply');
    const code = cleanText(input?.value, 40).toUpperCase();
    if (!code) { clearCoupon(); couponFeedback('Informe o código do cupom.', 'bad'); return; }
    const app = globalThis.__integrallApp;
    const subtotal = Number(app?.cartSubtotal?.() || 0);
    if (subtotal <= 0) { couponFeedback('Adicione produtos à sacola antes de aplicar o cupom.', 'bad'); return; }
    if (button) button.disabled = true;
    try {
      const state = app?.getState?.();
      const quote = app?.calculateShipping?.(subtotal);
      const response = await globalThis.IntegrallApi.request('/api/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({
          code,
          subtotalCents: subtotal,
          shippingChoice: state?.checkout?.choice || '',
          shippingQuoted: Boolean(quote && quote.price === null && state?.checkout?.choice === 'delivery')
        })
      });
      appliedCoupon = response.coupon;
      if (input) input.value = appliedCoupon.code;
      const label = appliedCoupon.type === 'percent'
        ? `${appliedCoupon.value}% de desconto`
        : appliedCoupon.type === 'fixed'
          ? `${formatMoney(appliedCoupon.value)} de desconto`
          : 'frete grátis';
      couponFeedback(`Cupom ${appliedCoupon.code} aplicado: ${label}. O valor final é confirmado pelo servidor.`, 'ok');
      syncDiscountRow();
    } catch (error) {
      clearCoupon(true);
      couponFeedback(error?.message || 'Cupom inválido.', 'bad');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function correiosEnabled() {
    return Boolean(globalThis.__integrallPublicHealth?.features?.correiosShipping);
  }

  function correiosBox() {
    let box = $('#correiosOptions');
    if (box) return box;
    const anchor = $('#deliveryAddressFields');
    if (!anchor) return null;
    box = document.createElement('div');
    box.id = 'correiosOptions';
    box.className = 'correios-options';
    box.hidden = true;
    anchor.after(box);
    box.addEventListener('change', event => {
      if (event.target?.name === 'correiosService') {
        correiosSelected = event.target.value;
        syncDiscountRow();
      }
    });
    return box;
  }

  function renderCorreiosOptions(message) {
    const box = correiosBox();
    if (!box) return;
    box.replaceChildren();
    const app = globalThis.__integrallApp;
    const delivery = app?.getState?.()?.checkout?.choice === 'delivery';
    if (!correiosEnabled() || !delivery) { box.hidden = true; return; }
    box.hidden = false;
    const title = document.createElement('strong');
    title.textContent = 'Opções de frete';
    box.append(title);
    if (message) {
      const note = document.createElement('p');
      note.className = 'correios-note';
      note.textContent = message;
      box.append(note);
      return;
    }
    for (const option of correiosOptions) {
      const label = document.createElement('label');
      label.className = 'correios-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'correiosService';
      input.value = option.service;
      input.checked = option.service === correiosSelected;
      const copy = document.createElement('span');
      const name = document.createElement('b');
      name.textContent = `${option.label} — ${formatMoney(option.priceCents)}`;
      copy.append(name);
      if (option.days != null) {
        const small = document.createElement('small');
        small.textContent = ` até ${option.days} dia(s) útil(eis)`;
        copy.append(small);
      }
      label.append(input, copy);
      box.append(label);
    }
  }

  async function refreshCorreiosQuote() {
    if (!correiosEnabled()) return;
    const app = globalThis.__integrallApp;
    const state = app?.getState?.();
    if (state?.checkout?.choice !== 'delivery') { renderCorreiosOptions(); return; }
    const cep = digits(state?.checkout?.cep).slice(0, 8);
    const items = (app?.cartDetails?.() || []).map(item => ({
      productId: item.product.id,
      variantId: item.variantId || '',
      qty: Math.max(1, Number(item.qty) || 1)
    }));
    if (cep.length !== 8 || !items.length) { renderCorreiosOptions('Informe o CEP para calcular o frete.'); return; }
    const key = `${cep}|${JSON.stringify(items)}`;
    if (key === correiosLastKey && correiosOptions.length) { renderCorreiosOptions(); return; }
    renderCorreiosOptions('Calculando frete…');
    try {
      const response = await globalThis.IntegrallApi.request('/api/shipping/quote', {
        method: 'POST',
        body: JSON.stringify({cep, items})
      });
      correiosOptions = Array.isArray(response.options) ? response.options : [];
      correiosLastKey = key;
      if (!correiosOptions.some(option => option.service === correiosSelected)) {
        correiosSelected = correiosOptions[0]?.service || '';
      }
      renderCorreiosOptions(correiosOptions.length ? '' : 'Nenhuma opção de frete disponível para este CEP.');
      syncDiscountRow();
    } catch (error) {
      correiosOptions = [];
      correiosLastKey = '';
      renderCorreiosOptions(error?.message || 'Não foi possível calcular o frete agora. O pedido pode ser registrado com frete a confirmar.');
    }
  }

  function scheduleCorreiosQuote() {
    if (!correiosEnabled()) return;
    clearTimeout(correiosQuoteTimer);
    correiosQuoteTimer = setTimeout(refreshCorreiosQuote, 400);
  }

  function syncAddressVisibility() {
    const app = globalThis.__integrallApp;
    const box = $('#deliveryAddressFields');
    if (!app || !box) return;
    const delivery = app.getState()?.checkout?.choice === 'delivery';
    box.hidden = !delivery;
    box.querySelectorAll('input[data-delivery-required]').forEach(input => input.required = delivery);
  }

  function orderDraft(app) {
    const state = app.getState();
    const items = globalThis.IntegrallCart?.details?.() || app.cartDetails();
    return {
      customer: {
        name: cleanText(state.checkout?.name, 80),
        email: cleanText($('#customerEmail')?.value, 254),
        phone: cleanText($('#customerPhone')?.value, 30),
        note: cleanText(state.checkout?.note, 500)
      },
      shipping: {
        choice: state.checkout?.choice || '',
        cep: digits(state.checkout?.cep).slice(0, 8),
        service: correiosEnabled() ? cleanText(correiosSelected, 20) : '',
        street: cleanText($('#deliveryStreet')?.value, 180),
        number: cleanText($('#deliveryNumber')?.value, 40),
        complement: cleanText($('#deliveryComplement')?.value, 120),
        neighborhood: cleanText($('#deliveryNeighborhood')?.value, 120),
        city: cleanText($('#deliveryCity')?.value, 120),
        state: cleanText($('#deliveryState')?.value, 2).toUpperCase()
      },
      items: items.map(item => ({
        productId: cleanText(item.product.id, 120),
        variantId: cleanText(item.variantId, 120),
        qty: Math.max(1, Math.min(999, Number(item.qty) || 1)),
        gift: Boolean(item.gift),
        giftMessage: cleanText(item.giftMessage, 240)
      })),
      couponCode: appliedCoupon ? cleanText(appliedCoupon.code, 40) : '',
      ageConfirmed: Boolean($('#ageConfirmCheckbox')?.checked)
    };
  }

  function validateDraft(draft) {
    if (!draft.customer.name) return 'Informe seu nome.';
    if (!draft.customer.email && !draft.customer.phone) return 'Informe um e-mail ou telefone para contato.';
    if (cartHasAlcohol() && !draft.ageConfirmed) return 'Confirme que você tem 18 anos ou mais para comprar bebidas alcoólicas.';
    if (draft.shipping.choice === 'delivery') {
      if (draft.shipping.cep.length !== 8) return 'Informe um CEP válido.';
      if (!draft.shipping.street || !draft.shipping.number || !draft.shipping.neighborhood || !draft.shipping.city || !/^[A-Z]{2}$/.test(draft.shipping.state)) {
        return 'Preencha rua, número, bairro, cidade e UF para a entrega.';
      }
    }
    return '';
  }

  function fingerprint(value) {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }

  function newClientOrderId() {
    return globalThis.crypto?.randomUUID ? `WEB-${crypto.randomUUID()}` : `WEB-${Date.now()}-${Math.random().toString(36).slice(2, 18)}`;
  }

  function readAttempt() {
    try {
      const value = JSON.parse(sessionStorage.getItem(ORDER_ATTEMPT_KEY) || 'null');
      return value && typeof value === 'object' ? value : memoryAttempt;
    } catch { return memoryAttempt; }
  }

  function writeAttempt(value) {
    memoryAttempt = value;
    try { sessionStorage.setItem(ORDER_ATTEMPT_KEY, JSON.stringify(value)); } catch {}
  }

  function clearAttempt() {
    memoryAttempt = null;
    try { sessionStorage.removeItem(ORDER_ATTEMPT_KEY); } catch {}
  }

  function checkoutAttempt(app) {
    const draft = orderDraft(app);
    const draftFingerprint = fingerprint(draft);
    const existing = readAttempt();
    if (existing?.fingerprint === draftFingerprint && existing?.clientOrderId) return {draft, attempt: existing};
    const attempt = {fingerprint: draftFingerprint, clientOrderId: newClientOrderId(), orderId: '', checkoutToken: ''};
    writeAttempt(attempt);
    return {draft, attempt};
  }

  function orderPayload(draft, clientOrderId) { return {clientOrderId, ...draft}; }

  function ensureOrderModal() {
    if ($('#orderStatusModal')) return $('#orderStatusModal');
    const modal = document.createElement('section');
    modal.id = 'orderStatusModal';
    modal.className = 'modal auth-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('aria-labelledby', 'orderStatusTitle');
    modal.innerHTML = `
      <div class="panel-head"><h2 id="orderStatusTitle">Seu pedido</h2><button class="close-btn" type="button" aria-label="Fechar">✕</button></div>
      <div class="modal-body">
        <div class="order-status-hero"><span id="orderStatusBadge"></span><strong id="orderStatusId"></strong><p id="orderStatusMessage"></p></div>
        <div class="detail-order-grid" id="orderStatusSummary"></div>
        <div class="order-tracking-box" hidden id="orderTrackingBox"></div>
        <div class="order-timeline" id="orderTimeline"></div>
        <div class="checkout-action-row">
          <button class="btn primary" type="button" id="orderPayButton" hidden>Pagar agora</button>
          <button class="btn outline" type="button" id="orderRefreshButton">Atualizar status</button>
          <button class="btn outline" type="button" id="orderSupportButton" hidden>Falar com a INTEGRALL</button>
          <button class="btn ghost" type="button" id="orderCloseButton">Fechar</button>
        </div>
      </div>`;
    document.body.append(modal);
    const close = () => { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); document.body.classList.remove('lock'); };
    modal.querySelector('.close-btn').addEventListener('click', close);
    $('#orderCloseButton').addEventListener('click', close);
    $('#orderRefreshButton').addEventListener('click', () => refreshTrackedOrder());
    $('#orderPayButton').addEventListener('click', () => startPaymentForTrackedOrder());
    $('#orderSupportButton').addEventListener('click', () => openSupport());
    trapFocus(modal);
    return modal;
  }

  function openSupport() {
    const app = globalThis.__integrallApp;
    const cfg = config();
    const phone = digits(app?.getState?.()?.settings?.whatsapp || cfg.supportPhone);
    if (phone) {
      const order = activeTrackedOrder?.id ? ` sobre o pedido ${activeTrackedOrder.id}` : '';
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(`Olá! Preciso de ajuda${order}.`)}`, '_blank', 'noopener,noreferrer');
      return;
    }
    if (cfg.supportEmail) location.href = `mailto:${cfg.supportEmail}`;
    else notify('Canal de atendimento ainda não configurado.', 'bad');
  }

  function formatMoney(cents) {
    const app = globalThis.__integrallApp;
    return app?.money ? app.money(cents) : new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'}).format((Number(cents)||0)/100);
  }

  function formatDate(value) {
    try { return new Date(value).toLocaleString('pt-BR'); } catch { return ''; }
  }

  function statusMessage(order) {
    if (order.requiresShippingQuote) return 'A loja ainda precisa definir o valor do frete. Assim que a cotação for registrada, o total será atualizado e o pagamento online poderá ser iniciado.';
    if (order.status === 'received') return 'Seu pedido foi registrado e está aguardando a próxima etapa.';
    if (order.status === 'awaiting_payment') return 'O pagamento foi iniciado e ainda aguarda confirmação.';
    if (order.status === 'paid') return 'Pagamento confirmado. O pedido pode seguir para preparação.';
    if (order.status === 'payment_failed') return 'O pagamento não foi aprovado. Você pode tentar novamente.';
    if (order.status === 'payment_expired') return 'A tentativa de pagamento expirou. Você pode iniciar uma nova tentativa.';
    if (order.status === 'payment_review') return 'O pagamento precisa de revisão antes de continuar.';
    if (order.status === 'preparing') return 'A INTEGRALL está preparando seu pedido.';
    if (order.status === 'ready') return order.shipping?.choice === 'pickup' ? 'Seu pedido está pronto para retirada.' : 'Seu pedido está pronto para a etapa de entrega.';
    if (order.status === 'completed') return 'Pedido concluído. Obrigado por comprar com a INTEGRALL.';
    if (order.status === 'refunded') return 'O pagamento deste pedido foi reembolsado.';
    if (order.status === 'chargeback') return 'O pagamento está registrado como contestado.';
    if (order.status === 'cancelled') return 'Este pedido foi cancelado.';
    return 'Status atualizado.';
  }

  function renderTrackedOrder(order) {
    activeTrackedOrder = order;
    const modal = ensureOrderModal();
    $('#orderStatusBadge').textContent = STATUS_LABELS[order.status] || order.status || 'Pedido';
    $('#orderStatusBadge').className = `order-status-badge ${order.status || ''}`;
    $('#orderStatusId').textContent = order.id;
    $('#orderStatusMessage').textContent = statusMessage(order);
    const summary = $('#orderStatusSummary');
    summary.replaceChildren();
    const rows = [
      ['Subtotal', formatMoney(order.subtotalCents)],
      ['Frete', order.shippingCents == null ? 'A confirmar' : formatMoney(order.shippingCents)]
    ];
    if (Number(order.discountCents) > 0) rows.push([`Desconto${order.coupon ? ` (${order.coupon})` : ''}`, `− ${formatMoney(order.discountCents)}`]);
    rows.push(
      ['Total', order.shippingCents == null ? `${formatMoney(order.totalCents)} + frete` : formatMoney(order.totalCents)],
      ['Recebimento', order.shipping?.choice === 'pickup' ? 'Retirada' : 'Entrega'],
      ['Pagamento', order.payment?.status || (order.onlinePaymentAvailable ? 'Disponível' : 'Não iniciado')],
      ['Atualizado', formatDate(order.updatedAt)]
    );
    for (const [label, value] of rows) {
      const cell = document.createElement('div');
      const small = document.createElement('span'); small.textContent = label;
      const strong = document.createElement('b'); strong.textContent = value;
      cell.append(small, strong); summary.append(cell);
    }
    const trackingBox = $('#orderTrackingBox');
    if (trackingBox) {
      trackingBox.replaceChildren();
      if (order.trackingCode) {
        const label = document.createElement('span');
        label.textContent = `Rastreamento do envio${order.trackingCarrier ? ` — ${order.trackingCarrier}` : ''}`;
        const code = document.createElement('b');
        code.textContent = order.trackingCode;
        trackingBox.append(label, code);
        const events = document.createElement('div');
        events.className = 'tracking-events';
        events.id = 'trackingEvents';
        events.textContent = 'Consultando a transportadora…';
        trackingBox.append(events);
        if (order.trackingUrl && /^https:\/\//i.test(order.trackingUrl)) {
          const link = document.createElement('a');
          link.href = order.trackingUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Ver no site da transportadora';
          trackingBox.append(link);
        }
        trackingBox.hidden = false;
        loadTrackingEvents(order);
      } else {
        trackingBox.hidden = true;
      }
    }
    const timeline = $('#orderTimeline'); timeline.replaceChildren();
    const events = Array.isArray(order.history) ? order.history : [];
    if (events.length) {
      const title = document.createElement('h3'); title.textContent = 'Histórico'; timeline.append(title);
      for (const event of [...events].reverse().slice(0, 10)) {
        const row = document.createElement('div'); row.className = 'timeline-row';
        const dot = document.createElement('span'); dot.className = 'timeline-dot';
        const copy = document.createElement('div');
        const strong = document.createElement('b'); strong.textContent = STATUS_LABELS[event.status] || event.status || 'Atualização';
        const small = document.createElement('small'); small.textContent = `${formatDate(event.at)}${event.note ? ` • ${event.note}` : ''}`;
        copy.append(strong, small); row.append(dot, copy); timeline.append(row);
      }
    }
    const pay = $('#orderPayButton');
    pay.hidden = !order.onlinePaymentAvailable;
    const cfg = config();
    const app = globalThis.__integrallApp;
    $('#orderSupportButton').hidden = !(digits(app?.getState?.()?.settings?.whatsapp || cfg.supportPhone) || cfg.supportEmail);
    modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); document.body.classList.add('lock');
  }

  async function loadTrackingEvents(order) {
    const container = $('#trackingEvents');
    if (!container) return;
    const reference = loadLastOrder();
    if (!reference?.id || !reference?.checkoutToken) { container.textContent = ''; return; }
    try {
      const data = await globalThis.IntegrallApi.request('/api/orders/tracking', {
        method: 'POST',
        body: JSON.stringify({orderId: reference.id, checkoutToken: reference.checkoutToken})
      });
      container.replaceChildren();
      if (data.expectedDelivery) {
        const eta = document.createElement('div');
        eta.className = 'tracking-eta';
        try {
          eta.textContent = `Previsão de entrega: ${new Date(data.expectedDelivery).toLocaleDateString('pt-BR')}`;
        } catch { eta.textContent = `Previsão de entrega: ${data.expectedDelivery}`; }
        container.append(eta);
      }
      const events = Array.isArray(data.events) ? data.events.slice(0, 8) : [];
      if (!events.length) {
        container.append(Object.assign(document.createElement('div'), {className: 'tracking-note', textContent: 'A transportadora ainda não registrou movimentações. Volte mais tarde.'}));
        return;
      }
      for (const [index, event] of events.entries()) {
        const row = document.createElement('div');
        row.className = `tracking-event${index === 0 ? ' latest' : ''}`;
        const dot = document.createElement('span');
        dot.className = 'tracking-dot';
        const copy = document.createElement('div');
        const title = document.createElement('b');
        title.textContent = event.description || 'Atualização';
        const meta = document.createElement('small');
        const when = event.at ? formatDate(event.at) : '';
        meta.textContent = [when, event.location].filter(Boolean).join(' • ');
        copy.append(title, meta);
        row.append(dot, copy);
        container.append(row);
      }
    } catch (error) {
      container.textContent = '';
      const note = document.createElement('div');
      note.className = 'tracking-note';
      note.textContent = error?.message?.includes('não está configurado')
        ? 'Acompanhe pelo link da transportadora abaixo.'
        : (error?.message || 'Rastreamento indisponível no momento — tente novamente mais tarde.');
      container.append(note);
    }
  }

  async function fetchOrderStatus(reference = loadLastOrder()) {
    if (!reference?.id || !reference?.checkoutToken) throw new Error('Não há autorização de acompanhamento nesta sessão.');
    const response = await globalThis.IntegrallApi.orderStatus(reference.id, reference.checkoutToken);
    renderTrackedOrder(response.order);
    return response.order;
  }

  async function refreshTrackedOrder() {
    const button = $('#orderRefreshButton'); if (button) button.disabled = true;
    try { await fetchOrderStatus(); notify('Status atualizado.', 'ok'); }
    catch (error) { notify(error?.message || 'Não foi possível consultar o pedido.', 'bad'); }
    finally { if (button) button.disabled = false; }
  }

  async function startPaymentForTrackedOrder() {
    const reference = loadLastOrder();
    if (!reference?.id || !reference?.checkoutToken) return notify('A autorização deste pedido não está mais disponível nesta sessão.', 'bad');
    const button = $('#orderPayButton'); button.disabled = true;
    try {
      const payment = await globalThis.IntegrallApi.createCheckout(reference.id, reference.checkoutToken);
      if (!payment?.url) throw new Error('O Mercado Pago não retornou uma URL de pagamento.');
      location.assign(payment.url);
    } catch (error) { notify(error?.message || 'Não foi possível iniciar o pagamento.', 'bad'); button.disabled = false; }
  }

  function showOrderCreated(order, app) {
    renderTrackedOrder({
      id: order.id,
      status: order.status || 'received',
      subtotalCents: order.subtotalCents,
      shippingCents: order.shippingCents,
      discountCents: order.discountCents,
      coupon: order.coupon,
      totalCents: order.totalCents,
      requiresShippingQuote: order.requiresShippingQuote,
      shipping: {choice: app.getState()?.checkout?.choice || ''},
      payment: {status: ''},
      history: [{at: new Date().toISOString(), status: 'received', note: 'Pedido criado pelo cliente.'}],
      onlinePaymentAvailable: Boolean(order.onlinePaymentAvailable && !order.requiresShippingQuote),
      updatedAt: new Date().toISOString()
    });
  }

  async function handleCheckout(event) {
    const button = event.target.closest?.('#checkout');
    if (!button) return;
    const app = globalThis.__integrallApp;
    const api = globalThis.IntegrallApi;
    if (!app || !api) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const state = app.getState();
    state.checkout.name = cleanText($('#customerName')?.value, 80);
    state.checkout.note = cleanText($('#customerNote')?.value, 500);
    const appValidation = app.checkoutValidation();
    if (appValidation) return notify(appValidation, 'bad');

    syncAddressVisibility();
    const {draft, attempt} = checkoutAttempt(app);
    const validation = validateDraft(draft);
    if (validation) return notify(validation, 'bad');
    saveProfile();

    const method = $('input[name="paymentMethod"]:checked')?.value || 'order';
    button.disabled = true;
    try {
      let order = attempt.orderId && attempt.checkoutToken ? {id: attempt.orderId, checkoutToken: attempt.checkoutToken} : null;
      if (!order) {
        const response = await api.createOrder(orderPayload(draft, attempt.clientOrderId));
        order = response?.order;
        if (!order?.id) throw new Error('O servidor não retornou um número de pedido válido.');
        if (!order.checkoutToken) throw new Error('O servidor não retornou a autorização segura do pedido.');
        attempt.orderId = order.id; attempt.checkoutToken = order.checkoutToken; writeAttempt(attempt);
      }
      saveLastOrder({id: order.id, checkoutToken: attempt.checkoutToken || order.checkoutToken});

      if (method === 'card') {
        if (order.requiresShippingQuote) {
          clearAttempt();
          globalThis.IntegrallCart?.clear?.();
          showOrderCreated(order, app);
          notify('Pedido registrado. O pagamento online ficará disponível assim que a loja definir o frete.', 'ok');
          return;
        }
        const payment = await api.createCheckout(order.id, attempt.checkoutToken || order.checkoutToken);
        if (!payment?.url) throw new Error('O Mercado Pago não retornou uma URL de pagamento.');
        globalThis.IntegrallCart?.clear?.();
        location.assign(payment.url);
        return;
      }

      clearAttempt();
      clearCoupon();
      const couponField = $('#couponInput');
      if (couponField) couponField.value = '';
      globalThis.IntegrallCart?.clear?.();
      showOrderCreated(order, app);
      notify(`Pedido ${order.id} confirmado! Guarde o número para acompanhar.`, 'ok');
    } catch (error) {
      notify(error?.message || 'Não foi possível concluir o pedido.', 'bad');
    } finally {
      button.disabled = false;
    }
  }

  async function handlePaymentReturn() {
    const query = new URLSearchParams(location.search);
    const payment = query.get('payment');
    if (!payment) return false;
    const orderId = cleanText(query.get('order') || query.get('external_reference'), 120);
    const stored = loadLastOrder() || readAttempt();
    if (stored?.checkoutToken && orderId) saveLastOrder({id: orderId, checkoutToken: stored.checkoutToken});
    globalThis.IntegrallCart?.clear?.();

    query.delete('payment'); query.delete('order'); query.delete('external_reference');
    const clean = location.pathname + (query.toString() ? `?${query}` : '') + location.hash;
    history.replaceState(null, '', clean);

    const reference = loadLastOrder();
    if (!reference?.id || !reference?.checkoutToken) {
      notify('Retorno do pagamento recebido. Consulte o número do pedido com a loja.', payment === 'failure' ? 'bad' : 'ok');
      return true;
    }

    let last = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try { last = await fetchOrderStatus(reference); } catch (error) { if (attempt === 0) notify(error.message, 'bad'); break; }
      if (!['received', 'awaiting_payment'].includes(last.status)) break;
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 1800));
    }
    if (payment === 'failure' && last && ['received', 'awaiting_payment'].includes(last.status)) notify('O pagamento não foi concluído. Você pode tentar novamente.', 'bad');
    else if (payment === 'pending') notify('Pagamento em processamento. O status será atualizado quando o Mercado Pago confirmar.', '');
    else if (payment === 'success') notify('Retorno recebido. A confirmação financeira é feita pelo servidor.', 'ok');
    return true;
  }

  function refreshConfig() { renderPaymentMethods(); }

  async function loadPublicHealth() {
    try {
      const health = await globalThis.IntegrallApi.request('/api/health');
      globalThis.__integrallPublicHealth = health;
      if (health?.features?.correiosShipping) scheduleCorreiosQuote();
    } catch {}
  }

  function init() {
    injectAccessibility();
    bindLegalLinks();
    hydrateCustomerFields();
    renderPaymentMethods();
    syncAddressVisibility();
    syncAgeConfirm();
    loadPublicHealth();
    document.addEventListener('click', handleCheckout, true);
    $('#trackLastOrder')?.addEventListener('click', async () => {
      try { await fetchOrderStatus(); }
      catch (error) { notify(error?.message || 'Nenhum pedido desta sessão para acompanhar.', 'bad'); }
    });
    document.addEventListener('change', event => { if (event.target?.name === 'shippingChoice') setTimeout(() => { syncAddressVisibility(); syncDiscountRow(); scheduleCorreiosQuote(); }, 0); });
    document.addEventListener('input', event => { if (event.target?.id === 'modalCep') scheduleCorreiosQuote(); });
    $('#couponApply')?.addEventListener('click', applyCoupon);
    $('#couponInput')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyCoupon(); } });
    $('#couponInput')?.addEventListener('input', () => { if (appliedCoupon) { clearCoupon(true); couponFeedback('Cupom alterado — clique em Aplicar para validar.', ''); } });
    const cartObserver = new MutationObserver(() => { syncAgeConfirm(); syncDiscountRow(); scheduleCorreiosQuote(); });
    const cartList = $('#cartList');
    if (cartList) cartObserver.observe(cartList, {childList: true, subtree: true});
    const totals = $('#cartTotal');
    if (totals) new MutationObserver(() => syncDiscountRow()).observe(totals, {characterData: true, childList: true, subtree: true});
    // Reaplica o rótulo do frete da transportadora quando o app re-renderiza o carrinho
    const shippingNode = $('#cartShipping');
    if (shippingNode) new MutationObserver(() => {
      if (correiosEnabled() && correiosOptions.length && !shippingNode.dataset.syncing) {
        shippingNode.dataset.syncing = '1';
        syncDiscountRow();
        delete shippingNode.dataset.syncing;
      }
    }).observe(shippingNode, {characterData: true, childList: true, subtree: true});
    handleOrderDeepLink();
  }

  /**
   * Link do e-mail de confirmação (?pedido=INT-...): abre o acompanhamento
   * automaticamente. A autorização (checkoutToken) vem do armazenamento local
   * do cliente; se ele abrir em outro dispositivo, orienta usar o mesmo
   * navegador da compra ou falar com a loja.
   */
  async function handleOrderDeepLink() {
    const query = new URLSearchParams(location.search);
    const requested = cleanText(query.get('pedido'), 120);
    if (!requested) return;
    query.delete('pedido');
    history.replaceState(null, '', location.pathname + (query.toString() ? `?${query}` : '') + location.hash);
    const reference = loadLastOrder();
    if (reference?.id === requested && reference?.checkoutToken) {
      try { await fetchOrderStatus(reference); return; } catch {}
    }
    notify(`Para acompanhar o pedido ${requested}, abra este link no mesmo navegador em que a compra foi feita — ou fale com a INTEGRALL informando o número.`, 'bad');
  }

  globalThis.__integrallCheckout = Object.freeze({refreshConfig, config, handlePaymentReturn, showLastOrder: () => fetchOrderStatus()});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
