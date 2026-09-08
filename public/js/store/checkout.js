(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const digits = value => String(value || '').replace(/\D/g, '');
  const cleanText = (value, max = 1000) => String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
  const cleanMultilineText = (value, max = 10000) => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  const CUSTOMER_KEY = 'integrall_customer_profile_v9';
  const ORDER_ATTEMPT_KEY = 'integrall_order_attempt_v9';
  const LAST_ORDER_KEY = 'integrall_last_order_v9';
  let memoryAttempt = null;
  let activeTrackedOrder = null;
  let orderModalOpener = null;
  let legalModalOpener = null;
  let appliedCoupon = null;
  let correiosOptions = [];
  let correiosSelected = '';
  let correiosEnvironment = '';
  let correiosQuoteTimer = null;
  let correiosLastKey = '';
  let correiosAttemptKey = '';
  let correiosSequence = 0;
  let correiosController = null;
  let correiosExpiresAt = 0;
  let correiosExpiryTimer = null;
  let correiosManual = false;
  let correiosLoading = false;

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
    taxId: '',
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
    merged.privacyText = cleanMultilineText(merged.privacyText, 10000) || DEFAULT_CONFIG.privacyText;
    merged.termsText = cleanMultilineText(merged.termsText, 10000) || DEFAULT_CONFIG.termsText;
    merged.returnsText = cleanMultilineText(merged.returnsText, 10000) || DEFAULT_CONFIG.returnsText;
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
    } catch {
      return false;
    }
    return true;
  }

  // A referência do último pedido (número + autorização de consulta) persiste
  // em localStorage para que o cliente possa voltar depois — inclusive pelo
  // link do e-mail de confirmação. A consulta pública não expõe dados
  // pessoais (ver publicOrder no servidor), apenas status/valores/rastreio.
  function saveLastOrder(value) {
    try { localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(value)); } catch { /* o sessionStorage ainda pode preservar a referência */ }
    try { sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(value)); } catch { return false; }
    return true;
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

  function blockingLayerOpen() {
    return Boolean(
      $('#overlay')?.classList.contains('open') ||
      $('#accountModal')?.classList.contains('open') ||
      $('#legalModal')?.classList.contains('open') ||
      $('#orderStatusModal')?.classList.contains('open')
    );
  }

  function syncBodyLock() {
    document.body.classList.toggle('lock', blockingLayerOpen());
  }

  function closeAccountLayer() {
    document.dispatchEvent(new CustomEvent('integrall:close-account', {detail: {restoreFocus: false}}));
  }

  function closeStoreLayers({keep = ''} = {}) {
    const app = globalThis.__integrallApp;
    app?.closeProductDetails?.({returnFocus: false, updateHistory: true});
    app?.closeCart?.({returnFocus: false});
    closeAccountLayer();
    if (keep !== 'legal') closeLegal({restoreFocus: false});
    if (keep !== 'order') closeOrderStatusModal({restoreFocus: false});
    syncBodyLock();
  }

  function ensureStandaloneBackdrop(id, close) {
    let backdrop = $(`#${id}`);
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = id;
    backdrop.className = 'standalone-modal-backdrop';
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.addEventListener('click', close);
    document.body.append(backdrop);
    return backdrop;
  }

  function setStandaloneModalState(modal, backdrop, open) {
    modal?.classList.toggle('open', open);
    modal?.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (backdrop) {
      backdrop.hidden = !open;
      backdrop.classList.toggle('open', open);
    }
    syncBodyLock();
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

  function closeLegal({restoreFocus = true} = {}) {
    const modal = $('#legalModal');
    if (!modal?.classList.contains('open')) return false;
    const previous = legalModalOpener;
    legalModalOpener = null;
    setStandaloneModalState(modal, $('#legalModalBackdrop'), false);
    if (restoreFocus) setTimeout(() => {
      const target = previous?.isConnected && previous.offsetParent !== null ? previous : $('[data-legal="privacy"]');
      target?.focus?.({preventScroll: true});
    }, 20);
    return true;
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
    ensureStandaloneBackdrop('legalModalBackdrop', () => closeLegal());
    modal.querySelector('.close-btn').addEventListener('click', () => closeLegal());
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal.classList.contains('open')) closeLegal(); });
    trapFocus(modal);
    return modal;
  }

  function openLegal(kind, opener = document.activeElement) {
    const cfg = config();
    const content = {
      privacy: ['Privacidade', cfg.privacyText],
      terms: ['Termos de uso', cfg.termsText],
      returns: ['Trocas, devoluções e cancelamentos', cfg.returnsText]
    }[kind] || ['Termos de uso', cfg.termsText];
    legalModalOpener = opener instanceof HTMLElement ? opener : null;
    closeStoreLayers({keep: 'legal'});
    const modal = ensureLegalModal();
    $('#legalTitle').textContent = content[0];
    $('#legalCopy').textContent = cleanMultilineText(content[1], 10000) || 'Informação ainda não configurada.';
    const details = [cfg.businessName, cfg.taxId ? `CPF/CNPJ: ${cfg.taxId}` : '', cfg.businessAddress, cfg.supportEmail, cfg.supportPhone].map(v => cleanText(v, 500)).filter(Boolean);
    $('#legalMeta').textContent = details.join(' • ');
    setStandaloneModalState(modal, $('#legalModalBackdrop'), true);
    modal.querySelector('.close-btn')?.focus({preventScroll: true});
  }

  function bindLegalLinks() {
    ensureLegalModal();
    document.addEventListener('click', event => {
      const trigger = event.target.closest?.('[data-legal]');
      if (!trigger) return;
      event.preventDefault();
      openLegal(trigger.dataset.legal, trigger);
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
    // MESMA regra do servidor (couponDiscount): o desconto nunca deixa o
    // subtotal abaixo de R$ 1,00 — sem isso um cupom de 100% mostraria total
    // R$ 0,00 aqui e o servidor cobraria R$ 1,00 (divergência no fechamento).
    let discount = 0;
    if (appliedCoupon.type === 'percent') discount = Math.floor(subtotalCents * appliedCoupon.value / 100);
    else if (appliedCoupon.type === 'fixed') discount = appliedCoupon.value;
    else return 0;
    return Math.max(0, Math.min(discount, Math.max(0, subtotalCents - 100)));
  }

  /** Frete atualmente selecionado nas opções de transportadora (centavos) ou null. */
  function selectedCarrierShipping() {
    if (!correiosEnabled() || correiosManual || correiosLoading || correiosLastKey !== shippingContext().key || Date.now() >= correiosExpiresAt) return null;
    return correiosOptions.find(item => item.service === correiosSelected) || null;
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
      } else if (!correiosEnabled()) {
        const quote = app?.calculateShipping?.(subtotal);
        if (quote && quote.price != null) shippingCents = quote.price;
      }
    }
    if (shippingNode && shippingLabel && shippingCents != null) {
      const text = `${shippingLabel} — ${formatMoney(shippingCents)}`;
      if (shippingNode.textContent !== text) shippingNode.textContent = text;
    }

    if (shippingNode && correiosEnabled() && choice === 'delivery' && shippingCents == null) {
      const pending = correiosLoading ? 'Calculando frete…' : 'Frete a confirmar';
      if (shippingNode.textContent !== pending) shippingNode.textContent = pending;
    }

    if (correiosEnabled() && choice === 'delivery') {
      const selected = selectedCarrierShipping();
      const cep = shippingContext().cep.replace(/^(\d{5})(\d{3})$/, '$1-$2');
      const detail = selected ? `${selected.label}: até ${selected.days} ${selected.days === 1 ? 'dia útil' : 'dias úteis'} após a postagem. Reconfirmado ao concluir.`
        : correiosLoading ? 'Consultando preço e prazo de envio…' : correiosManual ? 'Frete a confirmar com a loja; pagamento online bloqueado.' : 'Calcule uma opção de frete abaixo.';
      const text = `Entrega para ${cep || 'CEP não informado'}. ${detail}`;
      const receipt = $('#cartReceipt');
      if (receipt && receipt.textContent !== text) receipt.textContent = text;
      const freeText = $('#freeShippingText');
      const threshold = Number(app?.effectiveFreeShippingThreshold?.() || 0);
      if (freeText && threshold > 0 && subtotal >= threshold && !selected) {
        const pendingFree = 'Condição de frete grátis atingida; confirme a disponibilidade do envio.';
        if (freeText.textContent !== pendingFree) freeText.textContent = pendingFree;
      }
    }

    // 2) Promoções automáticas do catálogo + cupom, na mesma ordem do servidor.
    const automatic = app?.automaticPromotionPreview?.(shippingCents || 0) || {discountCents:0,shippingDiscountCents:0,applied:[]};
    const promoDiscount = Math.max(0, Number(automatic.discountCents)||0);
    const promoShipping = Math.max(0, Number(automatic.shippingDiscountCents)||0);
    const couponBase = Math.max(100, subtotal - promoDiscount);
    let couponDiscount = 0;
    if (appliedCoupon && subtotal > 0) {
      if (appliedCoupon.type === 'free_shipping') couponDiscount = Math.max(0, (shippingCents || 0) - promoShipping);
      else couponDiscount = couponDiscountCents(couponBase);
    }
    const discount = promoDiscount + promoShipping + couponDiscount;
    if (discount > 0) {
      row.hidden = false;
      const sources=[]; if(promoDiscount+promoShipping>0)sources.push('promoções'); if(couponDiscount>0||appliedCoupon?.type==='free_shipping')sources.push(appliedCoupon?.code?`cupom ${appliedCoupon.code}`:'cupom');
      valueNode.textContent = `− ${formatMoney(discount)}${sources.length?` · ${sources.join(' + ')}`:''}`;
    } else if (appliedCoupon && appliedCoupon.type === 'free_shipping' && subtotal > 0) {
      row.hidden = false; valueNode.textContent = 'Frete grátis com cupom';
    } else row.hidden = true;

    // 3) Total real estimado, incluindo promoções automáticas.
    if (totalNode && subtotal > 0) {
      const nonShippingDiscount = promoDiscount + (appliedCoupon?.type === 'free_shipping' ? 0 : couponDiscount);
      const next = choice === 'delivery' && shippingCents == null
        ? `${formatMoney(Math.max(0, subtotal - nonShippingDiscount))} + entrega`
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
      const auto = app?.automaticPromotionPreview?.(quote?.price || 0) || {discountCents:0};
      const couponBase = Math.max(100, subtotal - Math.max(0, Number(auto.discountCents)||0));
      const response = await globalThis.IntegrallApi.request('/api/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({
          code,
          subtotalCents: couponBase,
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
    return Boolean(globalThis.__integrallPublicHealth?.features?.correiosShipping
      || globalThis.__integrallApp?.getState?.()?.settings?.shipMode === 'correios');
  }

  function shippingContext() {
    const app = globalThis.__integrallApp;
    const state = app?.getState?.();
    const cep = String(state?.checkout?.cep || '').trim().replace('-', '');
    const details = app?.cartDetails?.() || [];
    const items = details.map(item => ({productId:item.product.id,variantId:item.variantId || '',qty:Number(item.qty)}));
    const catalogStamp = details.map(item => [item.product.updated,item.product.price,item.product.boxes,item.variant?.price]);
    return {cep,items,key:JSON.stringify([state?.checkout?.choice,cep,items,catalogStamp]),delivery:state?.checkout?.choice === 'delivery'};
  }
  function clearCorreiosQuote() {
    correiosSequence += 1;correiosController?.abort();correiosController=null;
    clearTimeout(correiosQuoteTimer);clearTimeout(correiosExpiryTimer);
    correiosOptions=[];correiosSelected='';correiosLastKey='';correiosExpiresAt=0;correiosManual=false;correiosLoading=false;
  }
  function correiosBox() {
    let box=$('#correiosOptions');if(box)return box;
    const anchor=$('#cartReceipt');if(!anchor)return null;
    box=document.createElement('div');box.id='correiosOptions';box.className='correios-options';box.hidden=true;anchor.after(box);
    box.addEventListener('change',event=>{if(event.target?.name==='correiosService'){correiosSelected=event.target.value;correiosManual=false;syncDiscountRow();}});
    return box;
  }
  function renderCorreiosOptions(message = '', allowActions = false) {
    const box=correiosBox();if(!box)return;box.replaceChildren();
    const context=shippingContext();if(!correiosEnabled() || !context.delivery){box.hidden=true;return;}box.hidden=false;
    box.setAttribute('aria-busy',String(correiosLoading));
    const title=document.createElement('strong');title.textContent='Opções de frete';box.append(title);
    if((correiosEnvironment || globalThis.__integrallPublicHealth?.features?.shippingEnvironment)==='homologacao'){
      const flag=document.createElement('p');flag.className='correios-note';flag.textContent='AMBIENTE DE TESTES — não utilize esta cotação em vendas reais.';box.append(flag);
    }
    if(message){const note=document.createElement('p');note.className='correios-note';note.setAttribute('role','status');note.textContent=message;box.append(note);}
    if(!message && !correiosManual) {
      for(const option of correiosOptions){
        const label=document.createElement('label');label.className='correios-option';
        const input=document.createElement('input');input.type='radio';input.name='correiosService';input.value=option.service;input.checked=option.service===correiosSelected;
        const copy=document.createElement('span');const name=document.createElement('b');name.textContent=`${option.label} — ${formatMoney(option.priceCents)}`;copy.append(name);
        const small=document.createElement('small');small.textContent=`Até ${option.days} ${option.days === 1 ? 'dia útil' : 'dias úteis'} após a postagem • ${option.volumes} ${option.volumes === 1 ? 'volume' : 'volumes'}`;copy.append(small);
        if(option.homeDelivery===false){const warning=document.createElement('small');warning.textContent='Sem entrega domiciliar neste trecho; pode exigir retirada em unidade dos Correios.';copy.append(warning);}
        label.append(input,copy);box.append(label);
      }
      const note=document.createElement('p');note.className='correios-note';note.textContent='Prazo do transporte após a postagem; não inclui o tempo de preparação da loja. Cotação válida por até 5 minutos e reconfirmada ao concluir.';box.append(note);
    }
    if(allowActions || correiosManual){
      const actions=document.createElement('div');actions.className='correios-actions';
      const retry=document.createElement('button');retry.type='button';retry.className='btn secondary';retry.textContent='Calcular novamente';retry.addEventListener('click',()=>scheduleCorreiosQuote(true));actions.append(retry);
      if(!correiosManual && /^\d{8}$/.test(context.cep) && context.items.length){
        const manual=document.createElement('button');manual.type='button';manual.className='btn secondary';manual.textContent='Solicitar frete a confirmar';
        manual.addEventListener('click',()=>{clearCorreiosQuote();correiosManual=true;correiosAttemptKey=shippingContext().key;renderCorreiosOptions('Frete será confirmado pela loja. O pagamento online ficará bloqueado até a confirmação.');syncDiscountRow();});actions.append(manual);
      }
      box.append(actions);
    }
  }
  async function refreshCorreiosQuote() {
    if(!correiosEnabled())return;
    const context=shippingContext();if(!context.delivery){renderCorreiosOptions();return;}
    if(!/^\d{8}$/.test(context.cep) || !context.items.length){renderCorreiosOptions('Informe o CEP e adicione produtos para calcular o frete.');return;}
    const sequence=++correiosSequence;correiosController?.abort();correiosController=new AbortController();
    correiosLoading=true;correiosAttemptKey=context.key;renderCorreiosOptions('Calculando frete…');syncDiscountRow();
    try{
      const response=await globalThis.IntegrallApi.request('/api/shipping/quote',{method:'POST',body:JSON.stringify({cep:context.cep,items:context.items}),signal:correiosController.signal,timeoutMs:30000});
      if(sequence!==correiosSequence || context.key!==shippingContext().key)return;
      const options=Array.isArray(response.options)?response.options:[];
      const expires=Date.parse(response.expiresAt || '');
      if(!options.length || !Number.isFinite(expires) || expires<=Date.now() || options.some(o=>!o.service || !Number.isSafeInteger(o.priceCents) || o.priceCents<0 || typeof o.quoteToken!=='string' || !o.quoteToken))throw new Error('Não foi possível obter opções de frete válidas.');
      correiosEnvironment=response.environment || '';correiosOptions=options;correiosExpiresAt=expires;correiosLastKey=context.key;correiosSelected=options[0].service;correiosLoading=false;
      renderCorreiosOptions();syncDiscountRow();
      clearTimeout(correiosExpiryTimer);correiosExpiryTimer=setTimeout(()=>{
        clearCorreiosQuote();renderCorreiosOptions('A cotação expirou. Calcule novamente antes de concluir.',true);syncDiscountRow();
      },Math.max(1,Math.min(300000,expires-Date.now())));
    }catch(error){
      if(sequence!==correiosSequence || context.key!==shippingContext().key)return;
      correiosLoading=false;correiosOptions=[];correiosLastKey='';correiosSelected='';
      renderCorreiosOptions(error?.message || 'Não foi possível calcular o frete.',true);syncDiscountRow();
    }finally{if(sequence===correiosSequence){correiosController=null;correiosLoading=false;}}
  }
  function scheduleCorreiosQuote(force = false) {
    if(!correiosEnabled())return;
    const context=shippingContext();
    if(!force && context.key===correiosAttemptKey && (correiosManual || correiosLoading || correiosLastKey || !correiosOptions.length))return;
    clearCorreiosQuote();correiosAttemptKey=context.key;syncDiscountRow();
    if(!context.delivery){renderCorreiosOptions();return;}
    renderCorreiosOptions('Preparando cálculo de frete…');
    correiosQuoteTimer=setTimeout(refreshCorreiosQuote,force?0:400);
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
        service: correiosEnabled() && !correiosManual ? cleanText(selectedCarrierShipping()?.service, 20) : '',
        quoteToken: correiosEnabled() ? selectedCarrierShipping()?.quoteToken || '' : '',
        manualQuote: correiosEnabled() && correiosManual && correiosAttemptKey === shippingContext().key,
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
      if (correiosEnabled() && !draft.shipping.manualQuote && !selectedCarrierShipping()) return 'Calcule e selecione o frete ou solicite frete a confirmar antes de concluir.';
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

  function newClientOrderKey() {
    if (globalThis.crypto?.getRandomValues) {
      const bytes = new Uint8Array(32);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    if (globalThis.crypto?.randomUUID) {
      return `${globalThis.crypto.randomUUID()}${globalThis.crypto.randomUUID()}`.replaceAll('-', '');
    }
    // Fail-safe: sem CSPRNG, o pedido ainda pode ser criado pelo servidor, mas
    // não fingimos que Math.random é uma capability segura de idempotência.
    return '';
  }

  function readAttempt() {
    try {
      const value = JSON.parse(sessionStorage.getItem(ORDER_ATTEMPT_KEY) || 'null');
      return value && typeof value === 'object' ? value : memoryAttempt;
    } catch { return memoryAttempt; }
  }

  function writeAttempt(value) {
    memoryAttempt = value;
    try { sessionStorage.setItem(ORDER_ATTEMPT_KEY, JSON.stringify(value)); return true; } catch { return false; }
  }

  function clearAttempt() {
    memoryAttempt = null;
    try { sessionStorage.removeItem(ORDER_ATTEMPT_KEY); return true; } catch { return false; }
  }

  function checkoutAttempt(app) {
    const draft = orderDraft(app);
    const draftFingerprint = fingerprint({...draft,shipping:{...draft.shipping,quoteToken:undefined}});
    const existing = readAttempt();
    const sameDraft = existing?.fingerprint === draftFingerprint && existing?.clientOrderId;
    // Migração v11.1.5 → v11.1.6: uma tentativa antiga que JÁ recebeu
    // orderId+checkoutToken pode continuar usando esse pedido sem chamar
    // /api/orders novamente. Tentativas antigas ainda não criadas são
    // descartadas e renascem com a capability forte clientOrderKey.
    if (sameDraft && (existing?.clientOrderKey || (existing?.orderId && existing?.checkoutToken))) return {draft, attempt: existing};
    const attempt = {fingerprint: draftFingerprint, clientOrderId: newClientOrderId(), clientOrderKey: newClientOrderKey(), orderId: '', checkoutToken: ''};
    writeAttempt(attempt);
    return {draft, attempt};
  }

  function orderPayload(draft, clientOrderId, clientOrderKey) { return {clientOrderId, clientOrderKey, ...draft}; }

  function closeOrderStatusModal({restoreFocus = true} = {}) {
    const modal = $('#orderStatusModal');
    if (!modal?.classList.contains('open')) return false;
    const previous = orderModalOpener;
    orderModalOpener = null;
    setStandaloneModalState(modal, $('#orderStatusModalBackdrop'), false);
    if (restoreFocus) setTimeout(() => {
      const target = previous?.isConnected && previous.offsetParent !== null ? previous : $('#openCart');
      target?.focus?.({preventScroll: true});
    }, 20);
    return true;
  }

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
    ensureStandaloneBackdrop('orderStatusModalBackdrop', () => closeOrderStatusModal());
    modal.querySelector('.close-btn').addEventListener('click', () => closeOrderStatusModal());
    $('#orderCloseButton').addEventListener('click', () => closeOrderStatusModal());
    $('#orderRefreshButton').addEventListener('click', () => refreshTrackedOrder());
    $('#orderPayButton').addEventListener('click', () => startPaymentForTrackedOrder());
    $('#orderSupportButton').addEventListener('click', () => openSupport());
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal.classList.contains('open')) closeOrderStatusModal(); });
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
    orderModalOpener = document.activeElement instanceof HTMLElement ? document.activeElement : $('#openCart');
    closeStoreLayers({keep: 'order'});
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
    if (Number(order.discountCents) > 0) {
      const labels=[]; if(Number(order.promotionDiscountCents)>0)labels.push('promoções'); if(order.coupon)labels.push(`cupom ${order.coupon}`);
      rows.push([`Desconto${labels.length?` (${labels.join(' + ')})`:''}`, `− ${formatMoney(order.discountCents)}`]);
    }
    if (order.inventoryReservationExpiresAt && !['paid','preparing','ready','completed','cancelled','payment_expired'].includes(order.status)) rows.push(['Estoque reservado até', formatDate(order.inventoryReservationExpiresAt)]);
    rows.push(
      ['Total', order.shippingCents == null ? `${formatMoney(order.totalCents)} + frete` : formatMoney(order.totalCents)],
      ['Recebimento', order.shipping?.choice === 'pickup' ? 'Retirada' : order.shipping?.label || 'Entrega'],
      ...(order.shipping?.days ? [['Prazo do transporte',order.shipping.days]] : []),
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
    setStandaloneModalState(modal, $('#orderStatusModalBackdrop'), true);
    modal.querySelector('.close-btn')?.focus({preventScroll: true});
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
      promotionDiscountCents: order.promotionDiscountCents,
      couponDiscountCents: order.couponDiscountCents,
      promotions: order.promotions,
      coupon: order.coupon,
      inventoryReservationExpiresAt: order.inventoryReservationExpiresAt,
      totalCents: order.totalCents,
      requiresShippingQuote: order.requiresShippingQuote,
      shipping: order.shipping || {choice: app.getState()?.checkout?.choice || ''},
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
        const response = await api.createOrder(orderPayload(draft, attempt.clientOrderId, attempt.clientOrderKey));
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
      if(String(error?.code || '').startsWith('SHIPPING_')){clearCorreiosQuote();renderCorreiosOptions(error.message,true);syncDiscountRow();}
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

  function renderBusinessIdentity() {
    const app=globalThis.__integrallApp;
    const node=$('#footerBusinessIdentity');if(!node)return;
    const cfg=config();
    const fields=[cfg.businessName,cfg.taxId ? `CPF/CNPJ: ${cfg.taxId}` : '',cfg.businessAddress,cfg.supportEmail,cfg.supportPhone].map(value=>cleanText(value,500)).filter(Boolean);
    node.textContent=fields.join(' • ');node.hidden=!fields.length;
    const email=cleanText(cfg.supportEmail || app?.getState?.().settings?.email,254);
    if (email) {
      for (const link of document.querySelectorAll('#emailLink,.premium-footer-contact-btn,.premium-socials a[aria-label="E-mail"]')) { link.href=`mailto:${encodeURIComponent(email)}`;link.dataset.disabled='0'; }
      if ($('#emailText')) $('#emailText').textContent=email;
    }
    if (cfg.businessAddress && $('#addressText')) $('#addressText').textContent=cleanText(cfg.businessAddress,500);
  }
  function refreshConfig() { renderPaymentMethods(); renderBusinessIdentity(); }

  async function loadPublicHealth() {
    try {
      const health = await globalThis.IntegrallApi.request('/api/health');
      globalThis.__integrallPublicHealth = health;
      if (correiosEnabled()) scheduleCorreiosQuote();
    } catch {
      globalThis.__integrallPublicHealth = {ok: false};
      // O catálogo público também informa o modo; uma falha no health não esconde o frete.
      if (correiosEnabled()) scheduleCorreiosQuote();
    }
  }

  function init() {
    injectAccessibility();
    bindLegalLinks();
    hydrateCustomerFields();
    refreshConfig();
    syncAddressVisibility();
    syncAgeConfirm();
    loadPublicHealth();
    document.addEventListener('click', handleCheckout, true);
    $('#trackLastOrder')?.addEventListener('click', async () => {
      try { await fetchOrderStatus(); }
      catch (error) { notify(error?.message || 'Nenhum pedido desta sessão para acompanhar.', 'bad'); }
    });
    document.addEventListener('change', event => { if (event.target?.name === 'shippingChoice') setTimeout(() => { syncAddressVisibility(); syncDiscountRow(); scheduleCorreiosQuote(); }, 0); });
    document.addEventListener('input', event => { if (event.target?.id === 'modalCep') {clearCorreiosQuote();syncDiscountRow();setTimeout(()=>scheduleCorreiosQuote(true),0);} });
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
      try { await fetchOrderStatus(reference); return; }
      catch (error) { console.warn('A consulta automática do pedido falhou.', error?.message || error); }
    }
    notify(`Para acompanhar o pedido ${requested}, abra este link no mesmo navegador em que a compra foi feita — ou fale com a INTEGRALL informando o número.`, 'bad');
  }

  globalThis.__integrallCheckout = Object.freeze({refreshConfig, config, handlePaymentReturn, refreshShipping: () => scheduleCorreiosQuote(true), showLastOrder: () => fetchOrderStatus()});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
