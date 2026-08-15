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

  function saveLastOrder(value) {
    try { sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(value)); } catch {}
  }

  function loadLastOrder() {
    try {
      const value = JSON.parse(sessionStorage.getItem(LAST_ORDER_KEY) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch { return null; }
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
    const selected = root.querySelector('input:checked')?.value;
    const methods = [['order', 'Registrar pedido', 'Criar o pedido agora e realizar o pagamento depois, quando necessário']];
    if (cfg.paymentMethods?.card === true) methods.unshift(['card', 'Pagar online — Mercado Pago', 'PIX ou cartão no ambiente seguro do Mercado Pago']);
    const button = $('#checkout');
    root.replaceChildren(...methods.map((method, index) => createPaymentOption(method[0], method[1], method[2], selected ? selected === method[0] : index === 0)));
    if (button) button.disabled = false;
    const syncLabel = () => {
      if (!button) return;
      button.textContent = root.querySelector('input:checked')?.value === 'card' ? 'Criar pedido e pagar' : 'Registrar pedido';
    };
    root.onchange = syncLabel;
    syncLabel();
    const note = $('#paymentAvailabilityNote');
    if (note) note.textContent = cfg.paymentMethods?.card === true
      ? 'Pagamento online ativo: após criar o pedido, você será levado ao Mercado Pago para escolher PIX ou cartão.'
      : 'Pagamento online ainda não está ativo. O pedido será registrado normalmente e o Mercado Pago aparecerá automaticamente quando as credenciais forem configuradas.';
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
      }))
    };
  }

  function validateDraft(draft) {
    if (!draft.customer.name) return 'Informe seu nome.';
    if (!draft.customer.email && !draft.customer.phone) return 'Informe um e-mail ou telefone para contato.';
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
      ['Frete', order.shippingCents == null ? 'A confirmar' : formatMoney(order.shippingCents)],
      ['Total', order.shippingCents == null ? `${formatMoney(order.totalCents)} + frete` : formatMoney(order.totalCents)],
      ['Recebimento', order.shipping?.choice === 'pickup' ? 'Retirada' : 'Entrega'],
      ['Pagamento', order.payment?.status || (order.onlinePaymentAvailable ? 'Disponível' : 'Não iniciado')],
      ['Atualizado', formatDate(order.updatedAt)]
    ];
    for (const [label, value] of rows) {
      const cell = document.createElement('div');
      const small = document.createElement('span'); small.textContent = label;
      const strong = document.createElement('b'); strong.textContent = value;
      cell.append(small, strong); summary.append(cell);
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
      globalThis.IntegrallCart?.clear?.();
      showOrderCreated(order, app);
      notify(`Pedido ${order.id} registrado com sucesso.`, 'ok');
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

  function init() {
    injectAccessibility();
    bindLegalLinks();
    hydrateCustomerFields();
    renderPaymentMethods();
    syncAddressVisibility();
    document.addEventListener('click', handleCheckout, true);
    $('#trackLastOrder')?.addEventListener('click', async () => {
      try { await fetchOrderStatus(); }
      catch (error) { notify(error?.message || 'Nenhum pedido desta sessão para acompanhar.', 'bad'); }
    });
    document.addEventListener('change', event => { if (event.target?.name === 'shippingChoice') setTimeout(syncAddressVisibility, 0); });
  }

  globalThis.__integrallCheckout = Object.freeze({refreshConfig, config, handlePaymentReturn, showLastOrder: () => fetchOrderStatus()});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
