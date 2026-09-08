(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const statuses = ['received','awaiting_payment','paid','payment_failed','payment_expired','payment_review','preparing','ready','completed','refunded','chargeback','cancelled'];
  const statusLabels = {
    received:'Recebido',awaiting_payment:'Aguardando pagamento',paid:'Pago',payment_failed:'Falha no pagamento',payment_expired:'Pagamento expirado',payment_review:'Revisar pagamento',preparing:'Preparando',ready:'Pronto',completed:'Concluído',refunded:'Reembolsado',chargeback:'Chargeback',cancelled:'Cancelado'
  };
  let orders = [];
  let customers = [];
  let catalog = null;
  let catalogRevision = '';
  let businessDirty = false;
  let businessRevision = '';
  let activeOrder = null;
  let coupons = [];
  let couponsRevision = '';
  let promotions = [];
  let promotionsRevision = '';
  let themeRevision = '';
  let inventoryAlerts = [];
  let restockSubscriptions = [];
  let reviews = [];
  let products = [];
  let activeProduct = null;
  let pendingImageFile = null;
  let productImages = [];
  let productDirty = false;
  let activeUploadRequest = null;
  const pendingUploadedMediaIds = new Set();
  const removedMediaIds = new Set();
  let adminSession = {configured:false, authenticated:false, user:null, csrfToken:''};
  let sessionGeneration = 0;
  let sessionActionPending = false;
  let sessionRecheckPending = false;
  const sessionNoticeKey = 'integrall_admin_session_event_v2';
  let sessionChannel = null;
  try { if ('BroadcastChannel' in window) sessionChannel = new BroadcastChannel(sessionNoticeKey); } catch { /* Storage-restricted browsers use focus revalidation. */ }
  let cropState = {image:null, objectUrl:'', zoom:1, panX:0, panY:0, dragging:false, pointerX:0, pointerY:0};
  let visualSelection = null;
  let previewUpdateTimer = null;

  const money = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(cents)||0)/100);
  const dateTime = value => { try { return value ? new Date(value).toLocaleString('pt-BR') : '—'; } catch { return '—'; } };
  function setFeedback(node, text, type='') { if (!node) return; node.textContent=text; node.className=`feedback${type?` ${type}`:''}`; }

  async function request(path, options={}) {
    const generation = sessionGeneration;
    const headers = new Headers(options.headers || {});
    headers.set('Accept','application/json');
    const isFormData=options.body instanceof FormData;
    if (options.body && !isFormData && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
    const method=String(options.method||'GET').toUpperCase();
    if (!['GET','HEAD','OPTIONS'].includes(method) && adminSession.csrfToken) headers.set('X-CSRF-Token',adminSession.csrfToken);
    const response = await fetch(path,{...options,headers,credentials:'same-origin'});
    const data = await response.json().catch(()=>({}));
    if (path.startsWith('/api/admin/') && !path.startsWith('/api/admin/session') && generation !== sessionGeneration) {
      const error = new Error('A sessão mudou. Entre novamente antes de continuar.'); error.code = 'SESSION_CHANGED'; throw error;
    }
    if (!response.ok) {
      if(response.status===401 && !path.endsWith('/session/login'))showLogin('Sua sessão expirou. Entre novamente.');
      const error=new Error(data.error || `HTTP ${response.status}`);error.code=data.code||'';error.requestId=data.requestId||'';error.status=response.status;throw error;
    }
    return data;
  }

  function showLogin(message='', type='bad') {
    sessionGeneration += 1;
    delete document.body.dataset.adminRole;
    adminSession={configured:adminSession.configured,authenticated:false,user:null,csrfToken:''};
    const login=$('#loginView'),dashboard=$('#dashboard'),identity=$('#adminIdentity'),logout=$('#logoutButton');
    if(login)login.hidden=false;if(dashboard)dashboard.hidden=true;if(identity)identity.hidden=true;if(logout)logout.hidden=true;
    setFeedback($('#loginFeedback'),message,type);
    const sessionFeedback=$('#adminSessionFeedback'); if(sessionFeedback){sessionFeedback.hidden=true;sessionFeedback.textContent='';}
    ['productDialog','orderDialog'].forEach(id=>{const panel=$('#'+id);if(panel)panel.hidden=true;});
    if(activeUploadRequest)activeUploadRequest.abort();
    setTimeout(()=>$('#loginPassword')?.focus(),0);
  }

  function showDashboard(session) {
    adminSession={configured:true,authenticated:true,user:session.user,csrfToken:session.csrfToken||''};
    const login=$('#loginView'),dashboard=$('#dashboard'),identity=$('#adminIdentity'),logout=$('#logoutButton');
    if(login)login.hidden=true;if(dashboard)dashboard.hidden=false;
    if(identity){identity.hidden=false;identity.textContent=`${session.user?.email||'Administrador'} • ${session.user?.role||'admin'}`}
    if(logout)logout.hidden=false;
    document.body.dataset.adminRole=session.user?.role||'';
  }

  async function authenticateAdmin(event) {
    event?.preventDefault();
    if(sessionActionPending)return;
    sessionActionPending=true;
    const generation=++sessionGeneration;
    const button=$('#loginButton');if(button)button.disabled=true;
    setFeedback($('#loginFeedback'),'Validando credenciais…');
    try{
      const data=await request('/api/admin/session/login',{method:'POST',body:JSON.stringify({email:$('#loginEmail').value.trim(),password:$('#loginPassword').value})});
      $('#loginPassword').value='';
      if(generation!==sessionGeneration)return;
      showDashboard(data);setFeedback($('#loginFeedback'),'');notifySessionChange('login');await loadAll();
    }catch(error){setFeedback($('#loginFeedback'),error.message,'bad');$('#loginPassword')?.focus()}finally{sessionActionPending=false;if(button)button.disabled=false}
  }

  async function bootstrapAdminSession() {
    const generation=sessionGeneration;
    try{
      const data=await request('/api/admin/session');
      if(generation!==sessionGeneration)return false;
      adminSession.configured=data.configured===true;
      if(!data.configured){showLogin('O acesso administrativo não pôde ser inicializado. Verifique as configurações ADMIN_* do servidor.');return false}
      if(!data.authenticated){showLogin();return false}
      showDashboard(data);return true;
    }catch(error){if(generation===sessionGeneration)showLogin(error.message);return false}
  }

  function notifySessionChange(action) {
    // Only a notification, never a token, password, or authorization decision.
    const notice={action,at:Date.now()};
    try { sessionChannel?.postMessage(notice); } catch { /* Focus also revalidates. */ }
    try { localStorage.setItem(sessionNoticeKey,JSON.stringify(notice)); } catch { /* Private/storage-restricted mode. */ }
  }

  async function revalidateSession() {
    if(sessionActionPending || sessionRecheckPending)return;
    sessionRecheckPending=true;
    const wasAuthenticated=adminSession.authenticated;
    const oldUser=JSON.stringify(adminSession.user);
    const generation=sessionGeneration;
    try {
      const data=await request('/api/admin/session');
      if(generation!==sessionGeneration)return;
      if(!data.authenticated){
        if(wasAuthenticated)showLogin('Sua sessão foi encerrada ou expirou. Entre novamente.');
        return;
      }
      if(!wasAuthenticated || oldUser!==JSON.stringify(data.user)) {
        sessionGeneration+=1;showDashboard(data);await loadAll();
      } else {
        // Do not overwrite unsaved product/theme forms on a normal tab focus.
        adminSession.csrfToken=data.csrfToken||'';
      }
    } catch {
      if(wasAuthenticated && generation===sessionGeneration) {
        const feedback=$('#adminSessionFeedback');if(feedback){feedback.hidden=false;setFeedback(feedback,'Não foi possível verificar a sessão. Verifique sua conexão antes de salvar.','bad');}
      }
    } finally {sessionRecheckPending=false;}
  }

  function bindSessionLifecycle() {
    const changed=()=>revalidateSession();
    if(sessionChannel)sessionChannel.addEventListener('message',changed);
    window.addEventListener('storage',event=>{if(event.key===sessionNoticeKey)changed();});
    window.addEventListener('focus',changed);
    window.addEventListener('pageshow',event=>{if(event.persisted)changed();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')changed();});
  }

  async function logoutAdmin() {
    if(sessionActionPending)return;
    sessionActionPending=true;sessionGeneration+=1;
    const button=$('#logoutButton');if(button)button.disabled=true;
    try {
      await request('/api/admin/session/logout',{method:'POST'});
      showLogin('Sessão encerrada.','ok');notifySessionChange('logout');
    } catch(error) {
      if(error.status===401){showLogin('Sessão encerrada.','ok');notifySessionChange('logout');}
      else {
        const feedback=$('#adminSessionFeedback');
        if(feedback){feedback.hidden=false;setFeedback(feedback,'Não foi possível encerrar a sessão no servidor. Verifique sua conexão e clique em Sair novamente.','bad');}
      }
    } finally {sessionActionPending=false;if(button)button.disabled=false;}
  }

  async function checkHealth() {
    try {
      const response=await fetch('/api/health',{headers:{Accept:'application/json'}});
      const data=await response.json();
      $('#healthStatus').textContent=data.ok?`API online • ${data.database}${data.mercadoPago?' • Mercado Pago ativo':' • Mercado Pago pendente'}`:'API indisponível';
    } catch { $('#healthStatus').textContent='API indisponível'; }
  }

  function makeCell(text='') { const td=document.createElement('td'); td.textContent=text; return td; }

  function renderMetrics() {
    $('#metricTotal').textContent=orders.length;
    $('#metricPending').textContent=orders.filter(o=>['received','awaiting_payment','payment_review'].includes(o.status)).length;
    $('#metricPaid').textContent=orders.filter(o=>['paid','preparing','ready'].includes(o.status)).length;
    $('#metricDone').textContent=orders.filter(o=>o.status==='completed').length;
    $('#metricCustomers').textContent=customers.length;
  }

  function renderOrders() {
    const body=$('#ordersBody'); body.replaceChildren(); $('#ordersEmpty').hidden=orders.length>0;
    for (const order of orders) {
      const tr=document.createElement('tr');
      const id=makeCell(); const strong=document.createElement('strong'); strong.textContent=order.id; id.append(strong);
      tr.append(id,makeCell(order.customer?.name || 'Cliente'));
      const status=makeCell(); const badge=document.createElement('span'); badge.className=`status ${order.status||''}`; badge.textContent=statusLabels[order.status]||order.status||'—'; status.append(badge); tr.append(status);
      tr.append(makeCell(order.shippingCents==null?`${money(order.totalCents)} + frete`:money(order.totalCents)));
      tr.append(makeCell(order.payment?.status || order.payment?.provider || 'Não iniciado'));
      tr.append(makeCell(dateTime(order.createdAt)));
      const action=makeCell(); const button=document.createElement('button'); button.type='button'; button.className='row-button'; button.textContent='Detalhes'; button.dataset.orderId=order.id; action.append(button); tr.append(action);
      body.append(tr);
    }
    renderMetrics();
  }

  function renderCustomers() {
    const body=$('#customersBody'); body.replaceChildren(); $('#customersEmpty').hidden=customers.length>0;
    for (const customer of customers) {
      const tr=document.createElement('tr');
      tr.append(makeCell(customer.name || 'Cliente'), makeCell(customer.email || '—'), makeCell(customer.phone || '—'), makeCell(customer.lastOrderId || '—'), makeCell(dateTime(customer.lastOrderAt)));
      body.append(tr);
    }
    renderMetrics();
  }

  async function loadOrders() {
    setFeedback($('#ordersFeedback'),'Carregando…');
    const params=new URLSearchParams(); const search=$('#orderSearch').value.trim(); const status=$('#orderStatus').value;
    if(search)params.set('search',search); if(status)params.set('status',status); params.set('limit','300');
    try { const data=await request(`/api/admin/orders?${params}`); orders=Array.isArray(data.orders)?data.orders:[]; renderOrders(); setFeedback($('#ordersFeedback'),`${orders.length} pedido(s).`,'ok'); }
    catch(error) { setFeedback($('#ordersFeedback'),error.message,'bad'); }
  }

  async function loadCustomers() {
    setFeedback($('#customersFeedback'),'Carregando…');
    const params=new URLSearchParams(); const search=$('#customerSearch')?.value.trim(); if(search)params.set('search',search); params.set('limit','300');
    try { const data=await request(`/api/admin/customers?${params}`); customers=Array.isArray(data.customers)?data.customers:[]; renderCustomers(); setFeedback($('#customersFeedback'),`${customers.length} cliente(s).`,'ok'); }
    catch(error) { setFeedback($('#customersFeedback'),error.message,'bad'); }
  }

  async function loadCatalog() {
    try { const data=await request('/api/admin/catalog');catalog=data.catalog;catalogRevision=data.revision||'';fillBusinessForm();$('#catalogCount').textContent=Array.isArray(catalog.products)?catalog.products.length:0; setFeedback($('#catalogFeedback'),'Catálogo administrativo sincronizado com o servidor.','ok'); }
    catch(error){setFeedback($('#catalogFeedback'),error.message,'bad')}
  }

  const businessFields = {businessName:'businessName',taxId:'businessTaxId',supportEmail:'businessEmail',supportPhone:'businessPhone',businessAddress:'businessAddress',privacyText:'businessPrivacy',termsText:'businessTerms',returnsText:'businessReturns'};
  function fillBusinessForm() {
    if (businessDirty || !catalog) return;
    const commerce = catalog.commerce || {};
    businessRevision = catalogRevision;
    for (const [key,id] of Object.entries(businessFields)) if ($('#'+id)) $('#'+id).value = commerce[key] || '';
  }
  async function saveBusiness(event) {
    event.preventDefault();
    if (!catalog || !businessRevision) return setFeedback($('#businessFeedback'),'Atualize o catálogo antes de salvar.','bad');
    const button=$('#businessSave');button.disabled=true;
    const commerce={...(catalog.commerce || {})};
    for (const [key,id] of Object.entries(businessFields)) commerce[key]=$('#'+id).value.trim();
    try {
      // Only commerce is sent. Product media, inventory and prices stay on the server.
      const data=await request('/api/admin/catalog',{method:'PUT',body:JSON.stringify({revision:businessRevision,commerce})});
      catalog=data.catalog;catalogRevision=data.revision;businessDirty=false;fillBusinessForm();
      setFeedback($('#businessFeedback'),'Dados públicos e políticas salvos. Produtos, preços e estoque preservados.','ok');
      reloadSitePreview({keepSelection:true});
    } catch(error) {
      setFeedback($('#businessFeedback'),error.status===409?'O catálogo mudou. Copie seus textos antes de atualizar a página e tente novamente, conferindo os dados mais recentes.':error.message,'bad');
    } finally {button.disabled=false;}
  }

  function detailRow(label,value) { const div=document.createElement('div'); const span=document.createElement('span'); span.textContent=label; const b=document.createElement('b'); b.textContent=value||'—'; div.append(span,b); return div; }
  function section(title) { const root=document.createElement('section');root.className='detail-section';const h=document.createElement('h3');h.textContent=title;root.append(h);return root; }
  function fullAddress(shipping={}) { return [shipping.street,shipping.number,shipping.complement,shipping.neighborhood,shipping.city,shipping.state].filter(Boolean).join(' • '); }

  function renderOrderDialog(order) {
    activeOrder=order;
    $('#dialogTitle').textContent=`Pedido ${order.id}`;
    const details=$('#orderDetails'); details.replaceChildren();
    const summary=section('Resumo'); const grid=document.createElement('div'); grid.className='detail-grid';
    grid.append(
      detailRow('Cliente',order.customer?.name),detailRow('Data',dateTime(order.createdAt)),detailRow('E-mail',order.customer?.email),detailRow('Telefone',order.customer?.phone),
      detailRow('Recebimento',order.shipping?.choice==='pickup'?'Retirada':'Entrega'),detailRow('CEP',order.shipping?.cep),detailRow('Endereço',fullAddress(order.shipping)),
      detailRow('Subtotal',money(order.subtotalCents)),detailRow('Frete',order.shippingCents==null?'Sob cotação':money(order.shippingCents)),
      detailRow('Desconto',Number(order.discountCents)>0?`− ${money(order.discountCents)}${order.coupon?.code?` (${order.coupon.code})`:''}`:'—'),
      detailRow('Total',order.shippingCents==null?`${money(order.totalCents)} + frete`:money(order.totalCents)),
      detailRow('Pagamento',order.payment?.status||'Não iniciado'),detailRow('Provedor',order.payment?.provider||'—'),detailRow('ID pagamento',order.payment?.paymentId||'—'),detailRow('Estoque baixado',order.inventoryCommittedAt?dateTime(order.inventoryCommittedAt):'Ainda não'),
      detailRow('Rastreio',order.trackingCode?`${order.trackingCode}${order.trackingCarrier?` (${order.trackingCarrier})`:''}`:'—'),
      detailRow('Maior de 18 confirmado',order.containsAlcohol?(order.ageConfirmed?'Sim':'NÃO'):'Não se aplica')
    ); summary.append(grid); details.append(summary);

    const items=section('Itens');
    for(const item of order.items||[]){
      const row=document.createElement('div');row.className='item-row';
      const left=document.createElement('span');
      left.textContent=`${item.qty}× ${item.name}${item.variant?` — ${item.variant}`:''}${item.gift?' 🎁 PRESENTE':''}`;
      const right=document.createElement('b');right.textContent=money(item.lineTotalCents);
      row.append(left,right);items.append(row);
      if(item.gift&&item.giftMessage){const msg=document.createElement('div');msg.className='gift-message';msg.textContent=`Mensagem do presente: “${item.giftMessage}”`;items.append(msg)}
    } details.append(items);
    if(order.customer?.note){const notes=section('Observações');const p=document.createElement('p');p.textContent=order.customer.note;notes.append(p);details.append(notes)}
    if(Array.isArray(order.inventoryWarnings)&&order.inventoryWarnings.length){const warning=section('Aviso de estoque');const box=document.createElement('div');box.className='warning-box';box.textContent=order.inventoryWarnings.join(' • ');warning.append(box);details.append(warning)}

    const history=section('Histórico');
    for(const event of [...(order.history||[])].reverse()) { const row=document.createElement('div');row.className='history-row';const time=document.createElement('time');time.textContent=dateTime(event.at);const copy=document.createElement('div');const b=document.createElement('b');b.textContent=statusLabels[event.status]||event.status||'Atualização';const p=document.createElement('div');p.textContent=event.note||event.source||'';copy.append(b,p);row.append(time,copy);history.append(row); }
    if((order.history||[]).length) details.append(history);

    const select=$('#dialogStatus'); select.replaceChildren(...statuses.map(status=>{const option=document.createElement('option');option.value=status;option.textContent=statusLabels[status];option.selected=status===order.status;return option}));
    const quotePanel=$('#shippingQuotePanel');
    const canEditShipping=order.shipping?.choice==='delivery' && !['paid','preparing','ready','completed','refunded','chargeback'].includes(order.status);
    quotePanel.hidden=!canEditShipping;
    $('#shippingQuoteValue').value=order.shippingCents==null?'':(Number(order.shippingCents)/100).toFixed(2).replace('.',',');
    $('#shippingQuoteLabel').value=order.shipping?.label || 'Frete confirmado pela loja';
    const trackingPanel=$('#trackingPanel');
    trackingPanel.hidden=order.shipping?.choice!=='delivery';
    $('#trackingCodeInput').value=order.trackingCode||'';
    $('#trackingCarrierInput').value=order.trackingCarrier||'';
    $('#trackingUrlInput').value=order.trackingUrl||'';
    setFeedback($('#dialogFeedback'),''); const orderPanel=$('#orderDialog'); orderPanel.hidden=false; orderPanel.scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function openOrder(id) {
    try { const data=await request(`/api/admin/orders/${encodeURIComponent(id)}`); renderOrderDialog(data.order); }
    catch(error){setFeedback($('#ordersFeedback'),error.message,'bad')}
  }

  async function saveStatus() {
    if(!activeOrder?.id)return;
    const nextStatus=$('#dialogStatus').value;
    // Aviso operacional: cancelar/reembolsar pedido com estoque já baixado NÃO repõe o estoque automaticamente.
    if(['cancelled','refunded','chargeback'].includes(nextStatus)&&activeOrder.inventoryCommittedAt){
      if(!confirm('Este pedido já teve baixa de estoque. Mudar para este status NÃO repõe o estoque automaticamente — ajuste manualmente no painel Produtos se a mercadoria voltou. Continuar?'))return;
    }
    const button=$('#saveStatusButton');button.disabled=true;
    try { const data=await request(`/api/admin/orders/${encodeURIComponent(activeOrder.id)}`,{method:'PATCH',body:JSON.stringify({status:nextStatus})}); setFeedback($('#dialogFeedback'),'Status atualizado.','ok'); renderOrderDialog(data.order); await Promise.all([loadOrders(),loadCatalog()]); }
    catch(error){setFeedback($('#dialogFeedback'),error.message,'bad')} finally{button.disabled=false}
  }

  function parseReais(value) {
    // Aceita "21,50" (BR), "21.50" (internacional), "1.250,00" e "R$ 10,00".
    // Regra igual à do backend (parsePriceCents): SE tem vírgula, pontos são
    // milhar; SENÃO o ponto é decimal. Evita o erro de 100x ("28.50" → 2850,00).
    const text=String(value||'').trim().replace(/^R\$\s*/i,'');
    if(!text)return null;
    const normalized=text.includes(',')?text.replace(/\./g,'').replace(',','.'):text;
    const number=Number(normalized);
    if(!Number.isFinite(number)||number<0)return null;
    return Math.round(number*100);
  }

  async function saveShipping() {
    if(!activeOrder?.id)return; const button=$('#saveShippingButton');button.disabled=true;
    try {
      const shippingCents=parseReais($('#shippingQuoteValue').value); if(shippingCents==null)throw new Error('Informe um valor de frete válido, por exemplo 15,00.');
      const data=await request(`/api/admin/orders/${encodeURIComponent(activeOrder.id)}/shipping`,{method:'PATCH',body:JSON.stringify({shippingCents,label:$('#shippingQuoteLabel').value.trim()})});
      setFeedback($('#dialogFeedback'),'Frete salvo e total do pedido atualizado.','ok'); renderOrderDialog(data.order); await loadOrders();
    } catch(error){setFeedback($('#dialogFeedback'),error.message,'bad')} finally{button.disabled=false}
  }

  async function saveTracking() {
    if(!activeOrder?.id)return; const button=$('#saveTrackingButton');button.disabled=true;
    try {
      const trackingCode=$('#trackingCodeInput').value.trim().toUpperCase();
      const trackingCarrier=$('#trackingCarrierInput').value.trim();
      const trackingUrl=$('#trackingUrlInput').value.trim();
      if(trackingUrl && !/^https:\/\//i.test(trackingUrl))throw new Error('O link de rastreio precisa começar com https://');
      const data=await request(`/api/admin/orders/${encodeURIComponent(activeOrder.id)}/tracking`,{method:'PATCH',body:JSON.stringify({trackingCode,trackingCarrier,trackingUrl})});
      setFeedback($('#dialogFeedback'),trackingCode?'Código de rastreio salvo. O cliente já pode acompanhar a entrega.':'Rastreio removido.','ok');
      renderOrderDialog(data.order); await loadOrders();
    } catch(error){setFeedback($('#dialogFeedback'),error.message,'bad')} finally{button.disabled=false}
  }

  function renderProducts() {
    const body=$('#productsBody'); if(!body)return; body.replaceChildren();
    for (const product of products) {
      const tr=document.createElement('tr');
      const nameCell=makeCell(); const strong=document.createElement('strong'); strong.textContent=product.name; nameCell.append(strong);
      if(!product.weightGrams && !(product.variants||[]).some(v=>v.weightGrams)){const warn=document.createElement('div');warn.className='pf-missing';warn.textContent='sem peso p/ frete';nameCell.append(warn)}
      tr.append(nameCell);
      const priceLabel=(product.variants||[]).length
        ? (()=>{const prices=product.variants.map(v=>Number(v.price)||0);const min=Math.min(...prices);const max=Math.max(...prices);return min===max?money(min):`${money(min)} – ${money(max)}`})()
        : money(product.price);
      tr.append(makeCell(priceLabel));
      const stockLabel=(product.variants||[]).length
        ? product.variants.map(v=>`${v.name}: ${v.stock==null?'—':v.stock}`).join(' • ')
        : (product.stock==null?'Sem controle':String(product.stock));
      tr.append(makeCell(stockLabel));
      const weightLabel=(product.variants||[]).some(v=>v.weightGrams)
        ? product.variants.map(v=>`${v.name}: ${v.weightGrams?`${v.weightGrams}g`:'—'}`).join(' • ')
        : (product.weightGrams?`${product.weightGrams}g`:'—');
      tr.append(makeCell(weightLabel));
      tr.append(makeCell(product.hidden===true?'Oculto':product.available===false?'Não':'Sim'));
      const action=makeCell(); const button=document.createElement('button'); button.type='button'; button.className='row-button'; button.textContent='Editar'; button.dataset.productId=product.id; action.append(button); tr.append(action);
      body.append(tr);
    }
  }

  async function loadProducts() {
    try { const data=await request('/api/admin/products'); products=Array.isArray(data.products)?data.products:[]; renderProducts(); populatePromotionProductOptions(); renderHiddenElements(); const app=previewApp(); if(app)app.setProducts(products); }
    catch(error){setFeedback($('#productsFeedback'),error.message,'bad')}
  }

  function intOrNull(value){const t=String(value||'').trim();if(!t)return null;const n=Number(t);return Number.isFinite(n)&&n>=0?Math.round(n):null}

  function updateVariantImagePreview(select) {
    const box=select?.closest('.pf-variant');const preview=box?.querySelector('.pf-variant-image-preview');if(!preview)return;
    const src=select.value||productImages[0]||'';preview.replaceChildren();
    if(!src){const empty=document.createElement('span');empty.textContent='Sem foto';preview.append(empty);return}
    const image=document.createElement('img');image.src=src;image.alt='Prévia da foto vinculada à variação';image.loading='lazy';preview.append(image);
  }

  function fillVariantImageSelect(select, selectedValue='') {
    if(!select)return;
    const current=selectedValue||select.value||'';select.replaceChildren();
    const cover=document.createElement('option');cover.value='';cover.textContent=productImages.length?'Usar foto de capa':'Usar foto de capa (adicione uma foto)';select.append(cover);
    productImages.forEach((url,index)=>{const option=document.createElement('option');option.value=url;option.textContent=index===0?'Foto 1 — capa':`Foto ${index+1}`;select.append(option)});
    select.value=productImages.includes(current)?current:'';updateVariantImagePreview(select);
  }

  function refreshVariantImageSelectors() {
    document.querySelectorAll('#pfVariants [data-variant-field="image"]').forEach(select=>fillVariantImageSelect(select,select.value));
  }

  function appendVariantBox(variantsRoot, variant) {
    const box=document.createElement('div'); box.className='pf-variant';
    if(variant?.id)box.dataset.variantId=variant.id; else box.dataset.newVariant='1';
    const head=document.createElement('div'); head.className='pf-variant-title-row';
    const title=document.createElement('div'); title.className='pf-variant-title'; title.textContent=variant?.id?`Variação: ${variant.name||''}`:'Nova variação'; head.append(title);
    const removeButton=document.createElement('button'); removeButton.type='button'; removeButton.className='row-button pf-variant-remove'; removeButton.textContent='Remover';
    removeButton.addEventListener('click',()=>{box.remove();productDirty=true;previewProductDraft()}); head.append(removeButton); box.append(head);
    const fields=[
      ['Nome','name',variant?.name||''],
      ['Preço (R$)','price',variant?(Number(variant.price||0)/100).toFixed(2).replace('.',','):''],
      ['Estoque','stock',variant?.stock==null?'':variant.stock],
      ['Peso (g)','weightGrams',variant?.weightGrams==null?'':variant.weightGrams]
    ];
    for (const [labelText,key,value] of fields) {
      const label=document.createElement('label'); label.textContent=labelText;
      const input=document.createElement('input'); input.dataset.variantField=key; input.value=value;
      label.append(input); box.append(label);
    }
    const imageLabel=document.createElement('label');imageLabel.className='pf-variant-image-field';imageLabel.append(document.createTextNode('Foto da variação'));
    const imageControl=document.createElement('div');imageControl.className='pf-variant-image-control';
    const imageSelect=document.createElement('select');imageSelect.dataset.variantField='image';imageSelect.setAttribute('aria-label',`Foto da variação ${variant?.name||'nova'}`);
    const imagePreview=document.createElement('div');imagePreview.className='pf-variant-image-preview';
    imageControl.append(imageSelect,imagePreview);imageLabel.append(imageControl);box.append(imageLabel);
    fillVariantImageSelect(imageSelect,variant?.image||'');
    imageSelect.addEventListener('change',()=>updateVariantImagePreview(imageSelect));
    variantsRoot.append(box);
  }

  function openProductDialog(product) {
    activeProduct=product; // null = criação
    const creating=!product;
    $('#productDialogTitle').textContent=creating?'Novo produto':product.name;
    $('#pfName').value=product?.name||'';
    if($('#pfSlug'))$('#pfSlug').value=product?.slug||'';
    // Departamento: se o produto usa um departamento fora da lista fixa
    // (ex.: "mercearia"), adiciona a opção dinamicamente — sem isso o select
    // cairia em "" e o PATCH apagaria o departamento silenciosamente.
    const departmentSelect=$('#pfDepartment');
    departmentSelect.querySelectorAll('option[data-dynamic]').forEach(option=>option.remove());
    const departmentValue=product?.department??'vinhos';
    if(![...departmentSelect.options].some(option=>option.value===departmentValue)){
      const option=document.createElement('option');
      option.value=departmentValue; option.textContent=`${departmentValue} (personalizado)`; option.dataset.dynamic='1';
      departmentSelect.append(option);
    }
    departmentSelect.value=departmentValue;
    $('#pfSubcategory').value=product?.subcategory||'';
    $('#pfBrand').value=product?.brand||'';
    $('#pfPrice').value=product?(Number(product.price)/100).toFixed(2).replace('.',','):'';
    $('#pfUnit').value=product?.unit||'';
    $('#pfStock').value=product?.stock==null?'':product.stock;
    $('#pfMinPerOrder').value=product?.minPerOrder==null?'':product.minPerOrder;
    if($('#pfStockMin'))$('#pfStockMin').value=product?.stockMin==null?'':product.stockMin;
    if($('#pfRestockDate'))$('#pfRestockDate').value=String(product?.restockDate||'').slice(0,10);
    $('#pfMaxPerOrder').value=product?.maxPerOrder==null?'':product.maxPerOrder;
    $('#pfWeight').value=product?.weightGrams==null?'':product.weightGrams;
    $('#pfLength').value=product?.lengthCm==null?'':product.lengthCm;
    $('#pfWidth').value=product?.widthCm==null?'':product.widthCm;
    $('#pfHeight').value=product?.heightCm==null?'':product.heightCm;
    $('#pfShippingBoxes')?.replaceChildren();
    for (const box of product?.boxes || []) appendShippingBox(box);
    $('#pfAvailable').checked=product?product.available!==false:true;
    $('#pfFeatured').checked=product?.featured===true;
    productImages=Array.isArray(product?.images)?[...product.images]:[];
    removedMediaIds.clear();pendingUploadedMediaIds.clear();productDirty=false;
    $('#pfImage').value=productImages[0]||'';
    $('#pfImageAlt').value=product?.name||'';
    pendingImageFile=null;
    resetCropEditor();
    const imageFile=$('#pfImageFile'); if(imageFile)imageFile.value='';
    renderProductImagePreview(productImages[0]||'');renderProductGallery();
    const editCurrent=$('#pfEditCurrentImage'); if(editCurrent)editCurrent.hidden=!productImages[0];
    setProductImageStatus('');
    $('#pfDescription').value=product?.description||'';
    $('#deleteProductButton').hidden=creating;
    const variantsRoot=$('#pfVariants'); variantsRoot.replaceChildren();
    for (const variant of product?.variants||[]) appendVariantBox(variantsRoot, variant);
    setFeedback($('#productDialogFeedback'),'');
    showVisualEditor();
    const dialog=$('#productDialog');
    if(dialog)dialog.hidden=false;
    if(creating||visualSelection?.kind!=='product')$('#visualSelectionEditor')?.setAttribute('hidden','');
    $('#visualSelectionEmpty')?.setAttribute('hidden','');
    setVisualEditorStatus(creating?'Novo produto em edição.':'Produto selecionado na prévia.');
    setTimeout(()=>dialog?.scrollIntoView({block:'nearest'}),0);
  }

  function appendShippingBox(value = {}) {
    const root = $('#pfShippingBoxes'); if (!root) return;
    if (root.children.length >= 10) {setFeedback($('#productDialogFeedback'), 'O limite é de 10 embalagens por produto.', 'bad');return;}
    const box = document.createElement('fieldset'); box.className = 'shipping-box-editor';
    const legend = document.createElement('legend'); legend.textContent = 'Embalagem de envio'; box.append(legend);
    const variantLabel = document.createElement('label'); variantLabel.textContent = 'Variação';
    const select = document.createElement('select'); select.dataset.boxField = 'variantId';
    const all = document.createElement('option'); all.value = ''; all.textContent = 'Todas (mesmas medidas e peso)'; select.append(all);
    for (const variant of activeProduct?.variants || []) {if(variant.deletedAt)continue;const o=document.createElement('option');o.value=variant.id;o.textContent=variant.name;select.append(o);}
    select.value = value.variantId || ''; variantLabel.append(select); box.append(variantLabel);
    for (const [key,title,min,max] of [['units','Unidades nesta caixa',1,999],['weightGrams','Peso bruto (g)',1,30000],['lengthCm','Comprimento externo (cm)',16,100],['widthCm','Largura externa (cm)',11,100],['heightCm','Altura externa (cm)',2,100]]) {
      const label = document.createElement('label'); label.textContent = title;
      const input = document.createElement('input'); input.type='number'; input.inputMode='numeric'; input.min=String(min);input.max=String(max);input.step='1';input.required=true;input.dataset.boxField=key;input.value=value[key] ?? '';label.append(input);box.append(label);
    }
    const remove=document.createElement('button');remove.type='button';remove.className='button secondary';remove.textContent='Remover embalagem';
    remove.addEventListener('click',()=>{box.remove();productDirty=true;previewProductDraft();});box.append(remove);root.append(box);
  }
  function collectShippingBoxes() {
    return [...document.querySelectorAll('#pfShippingBoxes .shipping-box-editor')].map(box => {
      const result = {variantId:box.querySelector('[data-box-field="variantId"]').value};
      for(const key of ['units','weightGrams','lengthCm','widthCm','heightCm']) {
        const input=box.querySelector(`[data-box-field="${key}"]`);const value=Number(input.value);
        if(!input.value || !Number.isSafeInteger(value) || value<Number(input.min) || value>Number(input.max))throw new Error('Preencha unidades, peso bruto e medidas externas de cada embalagem com números inteiros válidos.');
        result[key]=value;
      }
      if(result.lengthCm+result.widthCm+result.heightCm>200)throw new Error('A soma das três medidas externas da embalagem não pode ultrapassar 200 cm.');
      return result;
    });
  }

  function collectVariants() {
    return [...document.querySelectorAll('#pfVariants .pf-variant')].map(box=>{
      const get=key=>box.querySelector(`[data-variant-field="${key}"]`)?.value ?? '';
      const name=get('name').trim();
      if(!name)throw new Error('Toda variação precisa de um nome (ex.: 750ml).');
      const variantPrice=parseReais(get('price'));
      if(variantPrice==null)throw new Error(`Preço inválido na variação ${name}.`);
      const image=get('image').trim();
      const entry={name,price:variantPrice,stock:intOrNull(get('stock')),weightGrams:intOrNull(get('weightGrams')),image:productImages.includes(image)?image:''};
      if(box.dataset.variantId)entry.id=box.dataset.variantId;
      return entry;
    });
  }

  function collectProductForm() {
    const price=parseReais($('#pfPrice').value);
    if(price==null)throw new Error('Informe um preço válido, por exemplo 21,50.');
    const images=productImages.filter(image=>/^https:\/\//i.test(image)||image.startsWith('/assets/')||image.startsWith('/media/products/')).slice(0,12);
    return {
      expectedRevision:activeProduct?._revision||'',
      name:$('#pfName').value.trim(),
      slug:$('#pfSlug')?.value.trim()||'',
      department:$('#pfDepartment').value,
      subcategory:$('#pfSubcategory').value.trim(),
      brand:$('#pfBrand').value.trim(),
      price,
      unit:$('#pfUnit').value.trim(),
      description:$('#pfDescription').value.trim(),
      images,
      stock:intOrNull($('#pfStock').value),
      minPerOrder:intOrNull($('#pfMinPerOrder').value),
      stockMin:intOrNull($('#pfStockMin')?.value),
      restockDate:$('#pfRestockDate')?.value||'',
      maxPerOrder:intOrNull($('#pfMaxPerOrder').value),
      weightGrams:intOrNull($('#pfWeight').value),
      lengthCm:intOrNull($('#pfLength').value),
      widthCm:intOrNull($('#pfWidth').value),
      heightCm:intOrNull($('#pfHeight').value),
      boxes:collectShippingBoxes(),
      available:$('#pfAvailable').checked,
      hidden:activeProduct?.hidden===true,
      featured:$('#pfFeatured').checked
    };
  }

  function mediaIdFromProductUrl(url){const match=/^\/media\/products\/(media-[A-Za-z0-9-]+)$/.exec(String(url||''));return match?.[1]||''}

  function markRemovedMedia(url){const id=mediaIdFromProductUrl(url);if(id&&!pendingUploadedMediaIds.has(id))removedMediaIds.add(id)}

  async function cleanupMediaIds(ids){
    for(const id of ids){
      try{await request(`/api/admin/media/${encodeURIComponent(id)}`,{method:'DELETE'})}
      catch(error){if(error.status!==404&&error.code!=='MEDIA_IN_USE')console.warn('Falha ao limpar mídia órfã',id,error.message)}
    }
  }

  async function saveProduct(event) {
    event.preventDefault();
    const button=$('#productForm button[type="submit"]'); button.disabled=true;
    try {
      if(pendingImageFile){
        setProductImageStatus('Preparando e enviando foto…');
        const cropped=await exportCroppedProductImage();
        const uploaded=await uploadProductImage(cropped||pendingImageFile);
        const previous=productImages[0]||'';if(previous&&previous!==uploaded.url)markRemovedMedia(previous);
        if(productImages.length)productImages[0]=uploaded.url;else productImages.push(uploaded.url);
        $('#pfImage').value=uploaded.url;pendingImageFile=null;renderProductImagePreview(uploaded.url);renderProductGallery();
        setProductImageStatus('Foto enviada e pronta para salvar.','ok');
      }
      const payload=collectProductForm();
      const variants=collectVariants();
      payload.variants=variants;
      let saved;
      if(activeProduct?.id){
        const data=await request(`/api/admin/products/${encodeURIComponent(activeProduct.id)}`,{method:'PATCH',body:JSON.stringify(payload)});saved=data.product;
        setFeedback($('#productDialogFeedback'),'Produto salvo.','ok');
      }else{
        const data=await request('/api/admin/products',{method:'POST',body:JSON.stringify(payload)});saved=data.product;
        setFeedback($('#productDialogFeedback'),'Produto criado! Ele já aparece na loja.','ok');
      }
      productDirty=false;
      const linkedMediaIds=new Set(payload.images.map(mediaIdFromProductUrl).filter(Boolean));
      const pendingOrphans=[...pendingUploadedMediaIds].filter(id=>!linkedMediaIds.has(id));
      pendingUploadedMediaIds.clear();
      const orphanCandidates=[...new Set([...removedMediaIds,...pendingOrphans])];removedMediaIds.clear();
      await cleanupMediaIds(orphanCandidates);
      activeProduct=saved||activeProduct;
      const savedId=activeProduct?.id;
      await Promise.all([loadProducts(),loadCatalog()]);
      const fresh=products.find(p=>p.id===savedId);if(fresh){openProductDialog(fresh);setFeedback($('#productDialogFeedback'),'Produto salvo.','ok')}
      reloadSitePreview({keepSelection:true});
      return true;
    } catch(error){setFeedback($('#productDialogFeedback'),error.message,'bad');return false} finally{button.disabled=false}
  }

  async function deleteProduct() {
    if(!activeProduct?.id)return;
    if(!confirm(`Excluir "${activeProduct.name}" da loja? Esta ação não pode ser desfeita.`))return;
    const button=$('#deleteProductButton'); button.disabled=true;
    try {
      await request(`/api/admin/products/${encodeURIComponent(activeProduct.id)}`,{method:'DELETE'});
      closeProductEditor({force:true});
      setFeedback($('#productsFeedback'),'Produto excluído.','ok');
      await Promise.all([loadProducts(),loadCatalog()]);
      reloadSitePreview();
    } catch(error){setFeedback($('#productDialogFeedback'),error.message,'bad')} finally{button.disabled=false}
  }

  // ── Personalização da loja ────────────────────────────────────────────
  let themeSettings=null;
  let themeDirty=false;
  const themePendingMediaIds=new Set();
  const themeRemovedMediaIds=new Set();
  const themeUploadRequests=new Map();
  const THEME_ASSET_IDS=['thHeaderLogo','thFooterLogo','thFavicon','thHeroBackground','thHeaderBackground','thFooterBackgroundImg','thPageBackground'];
  const THEME_COLOR_LABELS={
    page:'Fundo da página',surface:'Fundo dos painéis',surfaceAlt:'Fundo alternativo',surfaceMuted:'Fundo suave',
    primary:'Cor principal (vinho)',primaryHover:'Cor principal — hover',accent:'Cor de destaque (dourado)',
    text:'Texto',muted:'Texto secundário',line:'Linhas e bordas',danger:'Avisos de erro',success:'Confirmações',
    buttonText:'Texto dos botões',headerBackground:'Fundo do cabeçalho',footerBackground:'Fundo do rodapé',
    cardBackground:'Fundo dos cartões',inputBackground:'Fundo dos campos',heroText:'Título do topo',heroOverlay:'Véu sobre imagem do topo',
    headerText:'Texto do cabeçalho',headerMuted:'Texto secundário do cabeçalho',footerText:'Texto do rodapé',footerMuted:'Texto secundário do rodapé',
    footerHeading:'Títulos do rodapé',footerAccent:'Destaques do rodapé',price:'Preços',badgeBackground:'Fundo das etiquetas',badgeText:'Texto das etiquetas',
    outOfStockBackground:'Etiqueta esgotado — fundo',outOfStockText:'Etiqueta esgotado — texto',overlay:'Véu dos modais'
  };
  function hexish(value){const text=String(value||'').trim();return /^#[0-9a-fA-F]{6}$/.test(text)?text:null}
  function renderThemeColors(colors) {
    const grid=$('#themeColorsGrid'); if(!grid)return; grid.replaceChildren();
    for (const [key,label] of Object.entries(THEME_COLOR_LABELS)) {
      const wrapper=document.createElement('label'); wrapper.className='theme-color-item'; wrapper.textContent=label;
      const row=document.createElement('div'); row.className='theme-color-row';
      const picker=document.createElement('input'); picker.type='color'; picker.dataset.colorPicker=key;
      const text=document.createElement('input'); text.dataset.colorKey=key; text.value=colors?.[key]||''; text.placeholder='#4a0a1a ou rgba(…)'; text.spellcheck=false;
      const hx=hexish(text.value); if(hx)picker.value=hx; else picker.classList.add('theme-color-nohex');
      picker.addEventListener('input',()=>{text.value=picker.value});
      text.addEventListener('input',()=>{const h=hexish(text.value);if(h)picker.value=h});
      row.append(picker,text); wrapper.append(row); grid.append(wrapper);
    }
  }
  function setThemeAssetStatus(inputId,text='',type='') {
    const node=document.querySelector(`[data-theme-status="${inputId}"]`);if(!node)return;
    node.textContent=text;node.className=`upload-status${type?` ${type}`:''}`;
  }

  function renderThemeAsset(inputId) {
    const input=$(`#${inputId}`),preview=document.querySelector(`[data-theme-preview="${inputId}"]`),remove=document.querySelector(`[data-theme-remove="${inputId}"]`);
    if(!input||!preview)return;const src=input.value.trim();preview.replaceChildren();
    if(!src){const empty=document.createElement('span');empty.textContent='Nenhuma imagem enviada';preview.append(empty);if(remove)remove.disabled=true;return}
    const img=document.createElement('img');img.src=src;img.alt='Prévia do ativo visual';img.loading='lazy';
    img.addEventListener('error',()=>{preview.replaceChildren();const message=document.createElement('span');message.textContent='A imagem atual não pôde ser carregada';preview.append(message)});
    preview.append(img);if(remove)remove.disabled=false;
  }

  function markThemeAssetRemoved(url) {
    const id=mediaIdFromProductUrl(url);if(id&&!themePendingMediaIds.has(id))themeRemovedMediaIds.add(id);
  }

  function assignThemeAsset(inputId,url) {
    const input=$(`#${inputId}`);if(!input)return;const previous=input.value.trim();
    if(previous&&previous!==url)markThemeAssetRemoved(previous);
    input.value=url||'';themeDirty=true;renderThemeAsset(inputId);scheduleDraftThemePreview();
  }

  async function uploadThemeAsset(inputId,file,purpose='site-asset') {
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Use uma imagem JPG, PNG ou WebP.');
    if(file.size>10*1024*1024)throw new Error('A imagem excede o limite de 10 MB.');
    const optimized=await optimizeProductImage(file);
    if(optimized.size>10*1024*1024)throw new Error('A imagem processada excede o limite de 10 MB.');
    const form=new FormData();const extension=optimized.type==='image/png'?'png':optimized.type==='image/jpeg'?'jpg':'webp';
    form.append('file',optimized,optimized.name||`${purpose}-${Date.now()}.${extension}`);form.append('alt',document.querySelector(`[data-theme-drop="${inputId}"] .theme-asset-copy strong`)?.textContent||'Imagem INTEGRALL');form.append('purpose',purpose);
    const progress=document.querySelector(`[data-theme-progress="${inputId}"]`),cancel=document.querySelector(`[data-theme-cancel="${inputId}"]`);
    if(progress){progress.hidden=false;progress.value=0}if(cancel)cancel.hidden=false;setThemeAssetStatus(inputId,'Enviando imagem…');
    await new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();themeUploadRequests.set(inputId,xhr);xhr.open('POST','/api/admin/media');xhr.responseType='json';xhr.withCredentials=true;
      xhr.setRequestHeader('Accept','application/json');if(adminSession.csrfToken)xhr.setRequestHeader('X-CSRF-Token',adminSession.csrfToken);
      xhr.upload.onprogress=event=>{if(event.lengthComputable&&progress)progress.value=Math.round(event.loaded/event.total*100)};
      xhr.onerror=()=>reject(new Error('Falha de rede durante o upload.'));xhr.onabort=()=>reject(new Error('Upload cancelado.'));
      xhr.onload=()=>{const data=xhr.response&&typeof xhr.response==='object'?xhr.response:{};if(xhr.status<200||xhr.status>=300){const error=new Error(data.error||`Falha no upload (HTTP ${xhr.status}).`);error.code=data.code||'';error.status=xhr.status;reject(error);return}const media=data.media||data;const id=media.id||mediaIdFromProductUrl(media.url);if(id)themePendingMediaIds.add(id);assignThemeAsset(inputId,media.url);setThemeAssetStatus(inputId,'Imagem enviada. Salve a personalização para publicar.','ok');resolve()};
      xhr.onloadend=()=>{themeUploadRequests.delete(inputId);if(progress)progress.hidden=true;if(cancel)cancel.hidden=true};xhr.send(form);
    });
  }

  function bindThemeAssetUploads() {
    document.querySelectorAll('[data-theme-file]').forEach(input=>input.addEventListener('change',async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;try{await uploadThemeAsset(input.dataset.themeFile,file,input.dataset.purpose)}catch(error){setThemeAssetStatus(input.dataset.themeFile,error.message,'bad')}}));
    document.querySelectorAll('[data-theme-remove]').forEach(button=>button.addEventListener('click',()=>{assignThemeAsset(button.dataset.themeRemove,'');setThemeAssetStatus(button.dataset.themeRemove,'Imagem removida. Salve para confirmar.','ok')}));
    document.querySelectorAll('[data-theme-cancel]').forEach(button=>button.addEventListener('click',()=>themeUploadRequests.get(button.dataset.themeCancel)?.abort()));
    document.querySelectorAll('[data-theme-drop]').forEach(zone=>{
      const id=zone.dataset.themeDrop;
      zone.addEventListener('dragover',event=>{event.preventDefault();zone.classList.add('is-dragover')});
      zone.addEventListener('dragleave',()=>zone.classList.remove('is-dragover'));
      zone.addEventListener('drop',async event=>{event.preventDefault();zone.classList.remove('is-dragover');const file=event.dataTransfer?.files?.[0];if(!file)return;const fileInput=document.querySelector(`[data-theme-file="${id}"]`);try{await uploadThemeAsset(id,file,fileInput?.dataset.purpose)}catch(error){setThemeAssetStatus(id,error.message,'bad')}});
    });
  }

  async function discardThemeChanges() {
    const pending=[...themePendingMediaIds];themePendingMediaIds.clear();themeRemovedMediaIds.clear();
    if(pending.length)await cleanupMediaIds(pending);
    if(themeSettings)fillThemeForm(themeSettings);applyDraftThemeToPreview(themeSettings);renderHiddenElements();themeDirty=false;
    setFeedback($('#themeFeedback'),'Mudanças não salvas foram descartadas.','ok');
  }

  function fillThemeForm(settings) {
    const s=settings||{}; const v=s.visual||{}; const t=v.typography||{}; const l=v.layout||{}; const a=v.assets||{}; const show=v.visibility||{};
    $('#thBrand').value=s.brand||''; $('#thSubtitle').value=s.subtitle||'';
    $('#thCatalogTitle').value=s.catalogTitle||''; $('#thCatalogText').value=s.catalogText||'';
    $('#thEmail').value=s.email||''; $('#thInstagram').value=s.instagram||''; $('#thWhatsapp').value=s.whatsapp||'';
    $('#thAddress').value=s.address||''; $('#thPickup').value=s.pickup||'';
    renderThemeColors(v.colors||{});
    $('#thHeadingFont').value=t.headingFont||'editorial'; $('#thBodyFont').value=t.bodyFont||'modern';
    $('#thCustomHeading').value=t.customHeading||''; $('#thCustomBody').value=t.customBody||'';
    $('#thBaseSize').value=t.baseSize??16; $('#thBodyWeight').value=t.bodyWeight??400; $('#thHeadingWeight').value=t.headingWeight??400;
    $('#thLineHeight').value=t.lineHeight??1.55; $('#thHeadingScale').value=t.headingScale??1;
    $('#thNavSize').value=t.navSize??11; $('#thNavSpacing').value=t.navSpacing??0.15; $('#thNavTransform').value=t.navTransform||'uppercase';
    $('#thHeaderLogo').value=a.headerLogo||''; $('#thFooterLogo').value=a.footerLogo||''; $('#thFavicon').value=a.favicon||'';
    $('#thHeroBackground').value=a.heroBackground||''; $('#thHeaderBackground').value=a.headerBackground||'';
    $('#thFooterBackgroundImg').value=a.footerBackground||''; $('#thPageBackground').value=a.pageBackground||'';
    for(const inputId of THEME_ASSET_IDS){renderThemeAsset(inputId);setThemeAssetStatus(inputId,'')}
    $('#thHeaderLogoMode').value=l.headerLogoMode||'text'; $('#thFooterLogoMode').value=l.footerLogoMode||'text';
    $('#thHeaderLogoWidth').value=l.headerLogoWidth??220; $('#thFooterLogoWidth').value=l.footerLogoWidth??170;
    $('#thHeroMode').value=l.heroMode||'plain';
    $('#thMaxWidth').value=l.maxWidth??1240; $('#thHeaderLayout').value=l.headerLayout||'centered'; $('#thHeaderSticky').checked=l.headerSticky===true;
    $('#thBlocks').value=Array.isArray(l.blocks)&&l.blocks.length===3?l.blocks.join(','):'intro,filters,products';
    $('#thCatalogAlign').value=l.catalogAlign||'center';
    $('#thGridDesktop').value=l.gridColumnsDesktop??3; $('#thGridTablet').value=l.gridColumnsTablet??2; $('#thGridMobile').value=l.gridColumnsMobile??1;
    $('#thCardStyle').value=l.cardStyle||'minimal'; $('#thCardAlign').value=l.cardAlign||'center';
    $('#thImageRatio').value=l.imageRatio||'square'; $('#thImageFit').value=l.imageFit||'contain';
    $('#thRadius').value=l.radius??0; $('#thButtonRadius').value=l.buttonRadius??0; $('#thShadow').value=l.shadow||'none';
    $('#thFooterAlign').value=l.footerAlign||'center';
    $('#thFooterOrder').value=Array.isArray(l.footerOrder)&&l.footerOrder.length===3?l.footerOrder.join(','):'logo,description,contact';
    $('#thAnimations').checked=l.animations!==false;
    $('#thShowSearch').checked=show.search!==false; $('#thShowFilters').checked=show.filters!==false; $('#thShowResultCount').checked=show.resultCount!==false;
    $('#thShowCategory').checked=show.category!==false; $('#thShowUnit').checked=show.unit!==false; $('#thShowStock').checked=show.stock!==false;
    $('#thShowQuickAdd').checked=show.quickAdd!==false; $('#thShowFooterDescription').checked=show.footerDescription!==false; $('#thShowFooterContact').checked=show.footerContact!==false;
    themeDirty=false;
  }
  function num(id,fallback){const raw=String($(id).value??'').trim();if(!raw)return fallback;const value=Number(raw.replace(',','.'));return Number.isFinite(value)?value:fallback}
  function collectThemeForm() {
    const colors={};
    document.querySelectorAll('#themeColorsGrid [data-color-key]').forEach(input=>{const value=input.value.trim();if(value)colors[input.dataset.colorKey]=value});
    const base=themeSettings||{};
    return {
      ...base,
      brand:$('#thBrand').value.trim(),
      subtitle:$('#thSubtitle').value.trim(),
      catalogTitle:$('#thCatalogTitle').value.trim(),
      catalogText:$('#thCatalogText').value.trim(),
      email:$('#thEmail').value.trim(),
      instagram:$('#thInstagram').value.trim(),
      whatsapp:$('#thWhatsapp').value.trim(),
      address:$('#thAddress').value.trim(),
      pickup:$('#thPickup').value.trim(),
      visual:{
        ...(base.visual||{}),
        colors,
        typography:{
          ...(base.visual?.typography||{}),
          headingFont:$('#thHeadingFont').value,bodyFont:$('#thBodyFont').value,
          customHeading:$('#thCustomHeading').value.trim(),customBody:$('#thCustomBody').value.trim(),
          baseSize:num('#thBaseSize',16),bodyWeight:num('#thBodyWeight',400),headingWeight:num('#thHeadingWeight',400),
          lineHeight:num('#thLineHeight',1.55),headingScale:num('#thHeadingScale',1),
          navSize:num('#thNavSize',11),navSpacing:num('#thNavSpacing',.15),navTransform:$('#thNavTransform').value
        },
        assets:{
          ...(base.visual?.assets||{}),
          headerLogo:$('#thHeaderLogo').value.trim(),footerLogo:$('#thFooterLogo').value.trim(),favicon:$('#thFavicon').value.trim(),
          heroBackground:$('#thHeroBackground').value.trim(),headerBackground:$('#thHeaderBackground').value.trim(),
          footerBackground:$('#thFooterBackgroundImg').value.trim(),pageBackground:$('#thPageBackground').value.trim()
        },
        layout:{
          ...(base.visual?.layout||{}),
          headerLogoMode:$('#thHeaderLogoMode').value,footerLogoMode:$('#thFooterLogoMode').value,
          headerLogoWidth:num('#thHeaderLogoWidth',220),footerLogoWidth:num('#thFooterLogoWidth',170),heroMode:$('#thHeroMode').value,
          maxWidth:num('#thMaxWidth',1240),headerLayout:$('#thHeaderLayout').value,headerSticky:$('#thHeaderSticky').checked,
          blocks:$('#thBlocks').value.split(','),catalogAlign:$('#thCatalogAlign').value,
          gridColumnsDesktop:num('#thGridDesktop',3),gridColumnsTablet:num('#thGridTablet',2),gridColumnsMobile:num('#thGridMobile',1),
          cardStyle:$('#thCardStyle').value,cardAlign:$('#thCardAlign').value,
          imageRatio:$('#thImageRatio').value,imageFit:$('#thImageFit').value,
          radius:num('#thRadius',0),buttonRadius:num('#thButtonRadius',0),shadow:$('#thShadow').value,
          footerAlign:$('#thFooterAlign').value,footerOrder:$('#thFooterOrder').value.split(','),
          animations:$('#thAnimations').checked
        },
        visibility:{
          ...(base.visual?.visibility||{}),
          search:$('#thShowSearch').checked,filters:$('#thShowFilters').checked,resultCount:$('#thShowResultCount').checked,
          category:$('#thShowCategory').checked,unit:$('#thShowUnit').checked,stock:$('#thShowStock').checked,
          quickAdd:$('#thShowQuickAdd').checked,footerDescription:$('#thShowFooterDescription').checked,footerContact:$('#thShowFooterContact').checked
        }
      }
    };
  }
  async function loadTheme() {
    try {
      const data=await request('/api/admin/settings');
      themeSettings=data.settings||{};themeRevision=data.revision||'';
      fillThemeForm(themeSettings);
      renderHiddenElements();
      applyDraftThemeToPreview();
      setFeedback($('#themeFeedback'),'');
    } catch(error){setFeedback($('#themeFeedback'),error.message,'bad')}
  }
  async function saveTheme() {
    // Guarda-corpo: sem os dados carregados do servidor, salvar enviaria um
    // formulário vazio e apagaria textos da loja. Recarrega antes.
    if(!themeSettings){
      setFeedback($('#themeFeedback'),'Os dados ainda não foram carregados. Clique em "Atualizar dados" e tente novamente.','bad');
      return;
    }
    const button=$('#themeSaveButton'); button.disabled=true;
    setFeedback($('#themeFeedback'),'Salvando…');
    try {
      const settings=collectThemeForm();
      const data=await request('/api/admin/settings',{method:'PUT',body:JSON.stringify({settings,revision:themeRevision})});
      themeSettings=data.settings||settings;themeRevision=data.revision||themeRevision;
      const linkedMediaIds=new Set(Object.values(themeSettings?.visual?.assets||{}).map(mediaIdFromProductUrl).filter(Boolean));
      const pendingOrphans=[...themePendingMediaIds].filter(id=>!linkedMediaIds.has(id));
      const cleanup=[...new Set([...themeRemovedMediaIds,...pendingOrphans])].filter(id=>!linkedMediaIds.has(id));
      themePendingMediaIds.clear();themeRemovedMediaIds.clear();
      await cleanupMediaIds(cleanup);
      fillThemeForm(themeSettings);themeDirty=false;
      setFeedback($('#themeFeedback'),'Personalização salva. A prévia já está atualizada.','ok');
      applyDraftThemeToPreview();
      renderHiddenElements();
      setVisualEditorStatus('Alterações salvas.','ok');
      return true;
    } catch(error){setFeedback($('#themeFeedback'),error.message,'bad');return false} finally{button.disabled=false}
  }
  function setProductImageStatus(text, type='') {
    const node=$('#pfImageStatus'); if(!node)return; node.textContent=text; node.className=`upload-status${type?` ${type}`:''}`;
  }

  function renderProductImagePreview(src) {
    const box=$('#pfImagePreview'); if(!box)return; box.replaceChildren();
    if(!src){const span=document.createElement('span');span.textContent='Sem foto';box.append(span);return;}
    const img=document.createElement('img'); img.alt='Prévia da foto do produto'; img.src=src;
    img.addEventListener('error',()=>{box.replaceChildren();const span=document.createElement('span');span.textContent='Não foi possível carregar a foto';box.append(span)});
    box.append(img);
  }

  function syncProductCover(){
    const cover=productImages[0]||'';$('#pfImage').value=cover;renderProductImagePreview(cover);
    const edit=$('#pfEditCurrentImage');if(edit)edit.hidden=!cover;
  }

  function moveProductImage(from,to){
    if(from===to||from<0||to<0||from>=productImages.length||to>=productImages.length)return;
    const [image]=productImages.splice(from,1);productImages.splice(to,0,image);productDirty=true;syncProductCover();renderProductGallery();previewProductDraft();
  }

  function removeProductImage(index){
    const [removed]=productImages.splice(index,1);if(removed)markRemovedMedia(removed);productDirty=true;syncProductCover();renderProductGallery();previewProductDraft();
  }

  function renderProductGallery(){
    const root=$('#pfGalleryList');if(!root)return;root.replaceChildren();
    if(!productImages.length){const empty=document.createElement('p');empty.className='empty-mini';empty.textContent='Nenhuma foto adicionada.';root.append(empty);refreshVariantImageSelectors();return}
    productImages.forEach((url,index)=>{
      const card=document.createElement('article');card.className='gallery-admin-item';card.draggable=true;card.dataset.imageIndex=String(index);
      const image=document.createElement('img');image.src=url;image.alt=index===0?'Imagem de capa do produto':`Imagem ${index+1} da galeria`;image.loading='lazy';
      const meta=document.createElement('div');meta.className='gallery-admin-meta';const label=document.createElement('strong');label.textContent=index===0?'Capa':`Foto ${index+1}`;meta.append(label);
      const actions=document.createElement('div');actions.className='gallery-admin-actions';
      const make=(text,title,handler)=>{const b=document.createElement('button');b.type='button';b.className='row-button';b.textContent=text;b.title=title;b.addEventListener('click',handler);return b};
      if(index>0)actions.append(make('Capa','Definir como imagem principal',()=>moveProductImage(index,0)));
      actions.append(make('←','Mover para antes',()=>moveProductImage(index,index-1)),make('→','Mover para depois',()=>moveProductImage(index,index+1)),make('Remover','Remover da galeria',()=>removeProductImage(index)));
      card.addEventListener('dragstart',event=>{event.dataTransfer?.setData('text/plain',String(index));card.classList.add('dragging')});
      card.addEventListener('dragend',()=>card.classList.remove('dragging'));
      card.addEventListener('dragover',event=>event.preventDefault());
      card.addEventListener('drop',event=>{event.preventDefault();const from=Number(event.dataTransfer?.getData('text/plain'));moveProductImage(from,index)});
      meta.append(actions);card.append(image,meta);root.append(card);
    });
    refreshVariantImageSelectors();
  }

  async function addGalleryFiles(fileList){
    const available=Math.max(0,12-productImages.length);const files=[...fileList].slice(0,available);
    if(!files.length){setProductImageStatus('A galeria aceita no máximo 12 imagens.','bad');return}
    for(let index=0;index<files.length;index+=1){
      setProductImageStatus(`Enviando foto ${index+1} de ${files.length}…`);
      const uploaded=await uploadProductImage(files[index]);productImages.push(uploaded.url);productDirty=true;renderProductGallery();syncProductCover();
    }
    setProductImageStatus(`${files.length} foto(s) adicionada(s) à galeria.`,'ok');
  }

  async function optimizeProductImage(file) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Escolha uma imagem JPG, PNG ou WebP.');
    if(file.size>10*1024*1024)throw new Error('A foto original é muito grande. Escolha uma imagem de até 10 MB.');
    if(typeof createImageBitmap!=='function')return file;
    let bitmap;
    try{bitmap=await createImageBitmap(file)}catch{return file}
    const maxSide=1600;
    const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
    if(scale===1 && file.size<=2*1024*1024){bitmap.close?.();return file}
    const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(bitmap.width*scale)); canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d'); ctx.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close?.();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.88));
    return blob||file;
  }

  async function uploadProductImage(file) {
    const optimized=await optimizeProductImage(file);
    const form=new FormData();
    const extension=optimized.type==='image/png'?'png':optimized.type==='image/jpeg'?'jpg':'webp';
    form.append('file',optimized,optimized.name||`produto-${Date.now()}.${extension}`);
    form.append('alt',$('#pfImageAlt')?.value.trim()||$('#pfName')?.value.trim()||'Produto INTEGRALL');
    form.append('purpose','product');
    const progress=$('#pfImageProgress'),cancel=$('#pfImageCancel');
    if(progress){progress.hidden=false;progress.value=0}if(cancel)cancel.hidden=false;
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();activeUploadRequest=xhr;
      xhr.open('POST','/api/admin/media/product-image');xhr.responseType='json';xhr.withCredentials=true;
      xhr.setRequestHeader('Accept','application/json');if(adminSession.csrfToken)xhr.setRequestHeader('X-CSRF-Token',adminSession.csrfToken);
      xhr.upload.onprogress=event=>{if(event.lengthComputable&&progress)progress.value=Math.round(event.loaded/event.total*100)};
      xhr.onerror=()=>reject(new Error('Falha de rede durante o upload.'));
      xhr.onabort=()=>reject(new Error('Upload cancelado.'));
      xhr.onload=()=>{
        const data=xhr.response&&typeof xhr.response==='object'?xhr.response:{};
        if(xhr.status<200||xhr.status>=300){const error=new Error(data.error||`Falha no upload (HTTP ${xhr.status}).`);error.code=data.code||'';error.status=xhr.status;reject(error);return}
        const id=data.media?.id||mediaIdFromProductUrl(data.url);if(id)pendingUploadedMediaIds.add(id);resolve(data);
      };
      xhr.onloadend=()=>{activeUploadRequest=null;if(progress)progress.hidden=true;if(cancel)cancel.hidden=true};
      xhr.send(form);
    });
  }

  function siteImageRatio() {
    const value=themeSettings?.visual?.layout?.imageRatio||$('#thImageRatio')?.value||'square';
    return ['square','portrait','landscape','auto'].includes(value)?value:'portrait';
  }

  function cropRatioDimensions(mode) {
    const resolved=mode==='site'?siteImageRatio():mode;
    if(resolved==='square')return [1000,1000];
    if(resolved==='landscape')return [1200,900];
    if(resolved==='auto'||resolved==='original'){
      const image=cropState.image;
      if(image){const scale=Math.min(1,1600/Math.max(image.naturalWidth||1,image.naturalHeight||1));return [Math.max(1,Math.round(image.naturalWidth*scale)),Math.max(1,Math.round(image.naturalHeight*scale))]}
    }
    return [1000,1120];
  }

  function resetCropEditor() {
    if(cropState.objectUrl){URL.revokeObjectURL(cropState.objectUrl);}
    cropState={image:null,objectUrl:'',zoom:1,panX:0,panY:0,dragging:false,pointerX:0,pointerY:0};
    const cropper=$('#pfCropper'); if(cropper)cropper.hidden=true;
    $('#pfImagePreview')?.removeAttribute('hidden');
    const zoom=$('#pfCropZoom'); if(zoom)zoom.value='1';
  }

  function resizeCropCanvas() {
    const canvas=$('#pfCropCanvas'); if(!canvas)return;
    const mode=$('#pfCropRatio')?.value||'site';
    const [w,h]=cropRatioDimensions(mode);
    const max=1000; const scale=Math.min(1,max/Math.max(w,h));
    canvas.width=Math.max(1,Math.round(w*scale)); canvas.height=Math.max(1,Math.round(h*scale));
  }

  function clampCropPan() {
    const canvas=$('#pfCropCanvas'), img=cropState.image; if(!canvas||!img)return;
    const base=Math.max(canvas.width/img.naturalWidth,canvas.height/img.naturalHeight);
    const scale=base*cropState.zoom;
    const dw=img.naturalWidth*scale, dh=img.naturalHeight*scale;
    const maxX=Math.max(0,(dw-canvas.width)/2), maxY=Math.max(0,(dh-canvas.height)/2);
    cropState.panX=Math.max(-maxX,Math.min(maxX,cropState.panX));
    cropState.panY=Math.max(-maxY,Math.min(maxY,cropState.panY));
  }

  function drawCropCanvas() {
    const canvas=$('#pfCropCanvas'), img=cropState.image; if(!canvas||!img)return;
    const ctx=canvas.getContext('2d'); if(!ctx)return;
    clampCropPan();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#f4f1ec'; ctx.fillRect(0,0,canvas.width,canvas.height);
    const base=Math.max(canvas.width/img.naturalWidth,canvas.height/img.naturalHeight);
    const scale=base*cropState.zoom;
    const dw=img.naturalWidth*scale, dh=img.naturalHeight*scale;
    const dx=(canvas.width-dw)/2+cropState.panX, dy=(canvas.height-dh)/2+cropState.panY;
    ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
    ctx.drawImage(img,dx,dy,dw,dh);
  }

  async function loadImageIntoCropper(blob) {
    if(!blob)return;
    if(cropState.objectUrl)URL.revokeObjectURL(cropState.objectUrl);
    const url=URL.createObjectURL(blob); cropState.objectUrl=url;
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Não foi possível abrir a foto para enquadrar.'));img.src=url});
    cropState.image=img; cropState.zoom=1; cropState.panX=0; cropState.panY=0;
    const zoom=$('#pfCropZoom'); if(zoom)zoom.value='1';
    const cropper=$('#pfCropper'); if(cropper)cropper.hidden=false;
    $('#pfImagePreview')?.setAttribute('hidden','');
    resizeCropCanvas(); drawCropCanvas();
  }

  async function exportCroppedProductImage() {
    const img=cropState.image; if(!img)return null;
    const mode=$('#pfCropRatio')?.value||'site';
    const [w,h]=cropRatioDimensions(mode);
    const out=document.createElement('canvas');out.width=w;out.height=h;
    const ctx=out.getContext('2d'); if(!ctx)return null;
    const preview=$('#pfCropCanvas');
    // Recalcula com a mesma posição relativa usada na prévia, agora na resolução final.
    const scaleX=w/(preview?.width||w), scaleY=h/(preview?.height||h);
    const base=Math.max(w/img.naturalWidth,h/img.naturalHeight);
    const scale=base*cropState.zoom;
    const panX=cropState.panX*scaleX, panY=cropState.panY*scaleY;
    const dw=img.naturalWidth*scale, dh=img.naturalHeight*scale;
    const dx=(w-dw)/2+panX, dy=(h-dh)/2+panY;
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(img,dx,dy,dw,dh);
    return new Promise(resolve=>out.toBlob(resolve,'image/webp',0.9));
  }

  async function startCropFromFile(file) {
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Use JPG, PNG ou WebP.');
    if(file.size>10*1024*1024)throw new Error('A foto original é muito grande. Escolha uma imagem de até 10 MB.');
    pendingImageFile=file;productDirty=true;
    await loadImageIntoCropper(file);
    setProductImageStatus('Ajuste o enquadramento e salve o produto.','ok');
    previewProductDraft();
  }

  function closeProductEditor({force=false}={}){
    if(!force&&productDirty&&!confirm('Descartar as alterações não salvas deste produto?'))return false;
    const pending=[...pendingUploadedMediaIds];pendingUploadedMediaIds.clear();if(pending.length)cleanupMediaIds(pending);
    const panel=$('#productDialog'); if(panel)panel.hidden=true;
    resetCropEditor(); pendingImageFile=null; activeProduct=null;productImages=[];productDirty=false;removedMediaIds.clear();
    if(visualSelection?.kind==='product')visualSelection=null;
    const selectionEditor=$('#visualSelectionEditor');if(selectionEditor)selectionEditor.hidden=true;
    const empty=$('#visualSelectionEmpty'); if(empty)empty.hidden=false;
    highlightPreviewSelection();
    setVisualEditorStatus('Clique em um elemento da prévia para editar.');return true;
  }

  function bindProductImageEditor(){
    const file=$('#pfImageFile'); const input=$('#pfImage'); const remove=$('#pfRemoveImage'); const current=$('#pfEditCurrentImage');const galleryFiles=$('#pfGalleryFiles');
    if(!file||!input)return;
    file.addEventListener('change',async()=>{
      const chosen=file.files?.[0]; if(!chosen)return;
      try{await startCropFromFile(chosen)}catch(error){file.value='';setProductImageStatus(error.message,'bad')}
    });
    current?.addEventListener('click',async()=>{
      const url=input.value.trim(); if(!url)return;
      current.disabled=true;setProductImageStatus('Abrindo foto atual…');
      try{const response=await fetch(url);if(!response.ok)throw new Error('Não foi possível carregar a foto atual.');const blob=await response.blob();const type=['image/jpeg','image/png','image/webp'].includes(blob.type)?blob.type:'image/webp';const fileBlob=new File([blob],'produto-atual.'+(type==='image/png'?'png':type==='image/jpeg'?'jpg':'webp'),{type});await startCropFromFile(fileBlob)}catch(error){setProductImageStatus(error.message,'bad')}finally{current.disabled=false}
    });
    remove?.addEventListener('click',()=>{pendingImageFile=null;file.value='';if(productImages.length)removeProductImage(0);else{input.value='';resetCropEditor();renderProductImagePreview('')}setProductImageStatus('Foto de capa removida. Salve para confirmar.');previewProductDraft()});
    galleryFiles?.addEventListener('change',async()=>{const files=[...(galleryFiles.files||[])];galleryFiles.value='';if(!files.length)return;try{setProductImageStatus(`Preparando ${files.length} foto(s)…`);await addGalleryFiles(files)}catch(error){setProductImageStatus(error.message,'bad')}});
    $('#pfImageCancel')?.addEventListener('click',()=>activeUploadRequest?.abort());
    $('#pfCropZoom')?.addEventListener('input',event=>{cropState.zoom=Number(event.target.value)||1;drawCropCanvas();previewProductDraft()});
    $('#pfCropRatio')?.addEventListener('change',()=>{cropState.panX=0;cropState.panY=0;resizeCropCanvas();drawCropCanvas();previewProductDraft()});
    $('#pfCropReset')?.addEventListener('click',()=>{cropState.zoom=1;cropState.panX=0;cropState.panY=0;const zoom=$('#pfCropZoom');if(zoom)zoom.value='1';drawCropCanvas();previewProductDraft()});
    const canvas=$('#pfCropCanvas');
    canvas?.addEventListener('pointerdown',event=>{if(!cropState.image)return;cropState.dragging=true;cropState.pointerX=event.clientX;cropState.pointerY=event.clientY;canvas.setPointerCapture?.(event.pointerId)});
    canvas?.addEventListener('pointermove',event=>{if(!cropState.dragging||!cropState.image)return;const rect=canvas.getBoundingClientRect();const scaleX=canvas.width/Math.max(1,rect.width),scaleY=canvas.height/Math.max(1,rect.height);cropState.panX+=(event.clientX-cropState.pointerX)*scaleX;cropState.panY+=(event.clientY-cropState.pointerY)*scaleY;cropState.pointerX=event.clientX;cropState.pointerY=event.clientY;drawCropCanvas()});
    const finishDrag=()=>{if(!cropState.dragging)return;cropState.dragging=false;previewProductDraft()};
    canvas?.addEventListener('pointerup',finishDrag);canvas?.addEventListener('pointercancel',finishDrag);canvas?.addEventListener('lostpointercapture',finishDrag);
  }

  function bindThemeTabs() {
    document.querySelectorAll('.theme-tab').forEach(tab=>{
      tab.addEventListener('click',()=>{
        document.querySelectorAll('.theme-tab').forEach(item=>item.classList.toggle('active',item===tab));
        document.querySelectorAll('.theme-pane').forEach(pane=>{pane.hidden=pane.dataset.themePane!==tab.dataset.themeTab});
      });
    });
  }


  // ── Editor visual lado a lado ─────────────────────────────────────────
  function setVisualEditorStatus(text,type=''){
    const node=$('#visualEditorStatus');if(!node)return;node.textContent=text;node.className=`visual-editor-status${type?` ${type}`:''}`;
  }

  function showVisualEditor(){
    const panel=$('#visualEditorPanel');if(panel&&!panel.matches(':focus-within'))panel.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function previewFrame(){return $('#sitePreview')}
  function previewApp(){try{return previewFrame()?.contentWindow?.__integrallApp||null}catch{return null}}
  function previewDocument(){try{return previewFrame()?.contentDocument||null}catch{return null}}

  function applyDraftThemeToPreview(explicitSettings=null){
    const app=previewApp();if(!app||!themeSettings)return;
    try{
      const win=previewFrame()?.contentWindow;
      const scrollX=win?.scrollX||0;
      const scrollY=win?.scrollY||0;
      const settings=explicitSettings||collectThemeForm();
      app.setSettings(settings);
      requestAnimationFrame(()=>{
        if(win)win.scrollTo(scrollX,scrollY)
        highlightPreviewSelection();
      });
    }catch(error){console.warn('Prévia de tema indisponível.',error)}
  }

  function scheduleDraftThemePreview(){
    clearTimeout(previewUpdateTimer);
    previewUpdateTimer=setTimeout(()=>{applyDraftThemeToPreview();setVisualEditorStatus('Prévia atualizada • ainda não salvo');},90);
  }

  function cropPreviewDataUrl(){
    const canvas=$('#pfCropCanvas');if(!canvas||!cropState.image||$('#pfCropper')?.hidden)return '';
    try{return canvas.toDataURL('image/webp',0.82)}catch{return ''}
  }

  function previewProductDraft(){
    const app=previewApp();if(!app||!activeProduct?.id)return;
    const state=app.getState?.();if(!state)return;
    const current=(state.products||[]).find(p=>p.id===activeProduct.id)||activeProduct;
    const parsedPrice=parseReais($('#pfPrice')?.value||'');
    const cropData=cropPreviewDataUrl();
    const imageValue=cropData||productImages[0]||current.images?.[0]||'';
    let draftVariants=current.variants||[];
    try{draftVariants=collectVariants()}catch{}
    const draft={
      ...current,
      name:$('#pfName')?.value.trim()||current.name,
      department:$('#pfDepartment')?.value??current.department,
      subcategory:$('#pfSubcategory')?.value.trim()??current.subcategory,
      brand:$('#pfBrand')?.value.trim()??current.brand,
      price:parsedPrice==null?current.price:parsedPrice,
      unit:$('#pfUnit')?.value.trim()??current.unit,
      description:$('#pfDescription')?.value.trim()??current.description,
      stock:intOrNull($('#pfStock')?.value),
      available:$('#pfAvailable')?.checked!==false,
      featured:$('#pfFeatured')?.checked===true,
      hidden:false,
      images:imageValue?[imageValue,...productImages.slice(1)]:[],
      variants:draftVariants
    };
    const next=(state.products||[]).map(product=>product.id===draft.id?draft:product);
    app.setProducts(next);
    setTimeout(highlightPreviewSelection,0);
  }

  function installPreviewBridge(){
    const doc=previewDocument();if(!doc)return;
    let style=doc.getElementById('integrallEditorBridgeStyle');
    if(!style){
      style=doc.createElement('style');style.id='integrallEditorBridgeStyle';style.textContent=`
        [data-header-slot],[data-layout-block],[data-footer-block],.card,[data-visual-region]{cursor:pointer!important;}
        .integrall-editor-hover{outline:2px dashed rgba(74,10,26,.55)!important;outline-offset:3px!important;}
        .integrall-editor-selected{outline:3px solid #4a0a1a!important;outline-offset:4px!important;position:relative!important;}
        .integrall-editor-selected::after{content:'EDITANDO';position:absolute;top:6px;left:6px;z-index:20;background:#4a0a1a;color:white;font:600 10px Arial,sans-serif;letter-spacing:.08em;padding:5px 7px;border-radius:999px;pointer-events:none;}
      `;doc.head.append(style)
    }
    if(doc.documentElement.dataset.integrallEditorBound==='1')return;
    doc.documentElement.dataset.integrallEditorBound='1';
    let hovered=null;
    doc.addEventListener('mouseover',event=>{
      const candidate=previewEditableNode(event.target);if(candidate===hovered)return;
      hovered?.classList.remove('integrall-editor-hover');hovered=candidate;hovered?.classList.add('integrall-editor-hover');
    },true);
    doc.addEventListener('mouseout',event=>{if(hovered&&!hovered.contains(event.relatedTarget)){hovered.classList.remove('integrall-editor-hover');hovered=null}},true);
    doc.addEventListener('click',event=>{
      const selection=selectionFromPreviewTarget(event.target);
      if(!selection)return;
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
      selectVisualElement(selection);
    },true);
    doc.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation()},true);
    // Rolagem inteligente: a roda do mouse sobre a prévia continua rolando o Admin
    // enquanto o editor visual ainda ocupa a viewport. Segurar Shift mantém a
    // rolagem somente dentro da prévia, útil para alcançar seções inferiores.
    doc.addEventListener('wheel',event=>{
      if(event.ctrlKey||event.shiftKey||!event.deltaY)return;
      const panel=$('#visualEditorPanel');if(!panel)return;
      const rect=panel.getBoundingClientRect(),direction=Math.sign(event.deltaY);
      const shouldScrollAdmin=direction>0?rect.bottom>window.innerHeight-8:rect.top<8;
      if(!shouldScrollAdmin)return;
      event.preventDefault();
      window.scrollBy({top:event.deltaY,left:0,behavior:'auto'});
    },{capture:true,passive:false});
    highlightPreviewSelection();
  }

  function previewEditableNode(target){
    if(!(target instanceof previewFrame().contentWindow.Element))return null;
    return target.closest('.card,[data-header-slot],[data-layout-block],[data-footer-block]')||target.closest('[data-visual-region]');
  }

  function selectionFromPreviewTarget(target){
    const card=target.closest?.('.card');
    if(card){const productId=card.querySelector('[data-details]')?.dataset.details;const product=products.find(p=>p.id===productId);if(product)return{kind:'product',key:productId,label:product.name}}
    const header=target.closest?.('[data-header-slot]');if(header)return{kind:'header',key:header.dataset.headerSlot,label:{brand:'Marca do cabeçalho',nav:'Menu principal',actions:'Ações do cabeçalho'}[header.dataset.headerSlot]||'Cabeçalho'};
    const block=target.closest?.('[data-layout-block]');if(block)return{kind:'block',key:block.dataset.layoutBlock,label:{intro:'Apresentação',filterBlock:'Busca e filtros',products:'Grade de produtos'}[block.dataset.layoutBlock]||'Seção'};
    const footer=target.closest?.('[data-footer-block]');if(footer&&['logo','description','contact'].includes(footer.dataset.footerBlock))return{kind:'footer',key:footer.dataset.footerBlock,label:{logo:'Marca do rodapé',description:'Descrição do rodapé',contact:'Contato do rodapé'}[footer.dataset.footerBlock]};
    const region=target.closest?.('[data-visual-region]');if(region)return{kind:'region',key:region.dataset.visualRegion,label:region.dataset.visualRegion==='header'?'Cabeçalho':region.dataset.visualRegion==='footer'?'Rodapé':'Área da loja'};
    return null;
  }

  function previewNodeForSelection(selection=visualSelection){
    const doc=previewDocument();if(!doc||!selection)return null;
    if(selection.kind==='product')return [...doc.querySelectorAll('.card')].find(card=>card.querySelector('[data-details]')?.dataset.details===selection.key)||null;
    if(selection.kind==='header')return doc.querySelector(`[data-header-slot="${selection.key}"]`);
    if(selection.kind==='block')return doc.querySelector(`[data-layout-block="${selection.key}"]`);
    if(selection.kind==='footer')return doc.querySelector(`[data-footer-block="${selection.key}"]`);
    if(selection.kind==='region')return doc.querySelector(`[data-visual-region="${selection.key}"]`);
    return null;
  }

  function highlightPreviewSelection(){
    const doc=previewDocument();if(!doc)return;
    doc.querySelectorAll('.integrall-editor-selected').forEach(node=>node.classList.remove('integrall-editor-selected'));
    const node=previewNodeForSelection();if(node){node.classList.add('integrall-editor-selected');node.scrollIntoView({block:'nearest',inline:'nearest'})}
  }

  function addProxyControl(root,labelText,sourceSelector,options={}){
    const source=$(sourceSelector);if(!source)return null;
    const label=document.createElement('label');label.className=options.wide?'quick-field quick-wide':'quick-field';
    const title=document.createElement('span');title.textContent=labelText;label.append(title);
    const proxy=source.cloneNode(true);proxy.removeAttribute('id');proxy.removeAttribute('name');proxy.classList.add('quick-proxy');
    if(source.type==='checkbox')proxy.checked=source.checked;else proxy.value=source.value;
    const sync=()=>{
      if(source.type==='checkbox')source.checked=proxy.checked;else source.value=proxy.value;
      source.dispatchEvent(new Event('input',{bubbles:true}));source.dispatchEvent(new Event('change',{bubbles:true}));
      scheduleDraftThemePreview();
    };
    proxy.addEventListener(source.type==='range'?'input':'input',sync);if(proxy.tagName==='SELECT'||source.type==='checkbox')proxy.addEventListener('change',sync);
    label.append(proxy);root.append(label);return proxy;
  }

  function addColorProxy(root,labelText,colorKey){
    const source=document.querySelector(`#themeColorsGrid [data-color-key="${colorKey}"]`);if(!source)return;
    const label=document.createElement('label');label.className='quick-field';const span=document.createElement('span');span.textContent=labelText;label.append(span);
    const input=document.createElement('input');input.type='color';input.value=hexish(source.value)||'#ffffff';
    input.addEventListener('input',()=>{source.value=input.value;const picker=document.querySelector(`#themeColorsGrid [data-color-picker="${colorKey}"]`);if(picker)picker.value=input.value;scheduleDraftThemePreview()});
    label.append(input);root.append(label);
  }

  function addDirectTextField(root,labelText,value,onInput,{textarea=false}={}){
    const label=document.createElement('label');label.className='quick-field quick-wide';const span=document.createElement('span');span.textContent=labelText;label.append(span);
    const input=document.createElement(textarea?'textarea':'input');if(textarea)input.rows=3;else input.type='text';input.value=value||'';
    input.addEventListener('input',()=>{onInput(input.value);scheduleDraftThemePreview()});label.append(input);root.append(label);
  }

  function configureVisualActions(selection){
    const moveable=['product','header','block','footer'].includes(selection.kind)&&!(selection.kind==='footer'&&!['logo','description','contact'].includes(selection.key));
    $('#visualMoveUp').hidden=!moveable;$('#visualMoveDown').hidden=!moveable;
    const hideable=selection.kind==='product'||selection.kind==='header'||selection.kind==='block'||selection.kind==='footer';
    $('#visualHideElement').hidden=!hideable;$('#visualDeleteElement').hidden=selection.kind!=='product';
  }

  function renderSelectionQuickFields(selection){
    const root=$('#visualQuickFields');if(!root)return;root.replaceChildren();
    if(selection.kind==='header'&&selection.key==='brand'){
      addProxyControl(root,'Nome da marca','#thBrand');addProxyControl(root,'Subtítulo','#thSubtitle');addProxyControl(root,'Exibir logo / texto','#thHeaderLogoMode');addProxyControl(root,'Tamanho do logo','#thHeaderLogoWidth');
    }else if(selection.kind==='header'&&selection.key==='nav'){
      addProxyControl(root,'Layout do cabeçalho','#thHeaderLayout');addProxyControl(root,'Tamanho do menu','#thNavSize');addProxyControl(root,'Espaçamento do menu','#thNavSpacing');
    }else if(selection.kind==='header'){
      addProxyControl(root,'Layout do cabeçalho','#thHeaderLayout');addColorProxy(root,'Texto do cabeçalho','headerText');
    }else if(selection.kind==='block'&&selection.key==='intro'){
      addProxyControl(root,'Título','#thCatalogTitle',{wide:true});addProxyControl(root,'Texto de apresentação','#thCatalogText',{wide:true});addProxyControl(root,'Alinhamento','#thCatalogAlign');addProxyControl(root,'Estilo do topo','#thHeroMode');
    }else if(selection.kind==='block'&&selection.key==='filters'){
      addProxyControl(root,'Mostrar busca','#thShowSearch');addProxyControl(root,'Mostrar filtros','#thShowFilters');addProxyControl(root,'Mostrar quantidade','#thShowResultCount');
    }else if(selection.kind==='block'&&selection.key==='products'){
      addProxyControl(root,'Colunas no computador','#thGridDesktop');addProxyControl(root,'Estilo dos cartões','#thCardStyle');addProxyControl(root,'Alinhamento','#thCardAlign');addProxyControl(root,'Formato da foto','#thImageRatio');addProxyControl(root,'Ajuste da foto','#thImageFit');
    }else if(selection.kind==='footer'&&selection.key==='logo'){
      addProxyControl(root,'Nome da marca','#thBrand');addProxyControl(root,'Subtítulo','#thSubtitle');addProxyControl(root,'Exibir logo / texto','#thFooterLogoMode');addProxyControl(root,'Tamanho do logo','#thFooterLogoWidth');
    }else if(selection.kind==='footer'&&selection.key==='description'){
      addDirectTextField(root,'Descrição do rodapé',themeSettings?.footerDescription||'Vinhos, cafés, sucos, Petit Four e produtos gourmet selecionados com cuidado.',value=>{themeSettings={...(themeSettings||{}),footerDescription:value}}, {textarea:true});
    }else if(selection.kind==='footer'&&selection.key==='contact'){
      addProxyControl(root,'E-mail','#thEmail',{wide:true});addProxyControl(root,'Instagram','#thInstagram');addProxyControl(root,'WhatsApp','#thWhatsapp');addProxyControl(root,'Endereço / informação','#thAddress',{wide:true});
    }else if(selection.kind==='region'&&selection.key==='header'){
      addColorProxy(root,'Fundo do cabeçalho','headerBackground');addColorProxy(root,'Texto do cabeçalho','headerText');addProxyControl(root,'Layout','#thHeaderLayout');
    }else if(selection.kind==='region'&&selection.key==='footer'){
      addColorProxy(root,'Fundo do rodapé','footerBackground');addColorProxy(root,'Texto do rodapé','footerText');addProxyControl(root,'Alinhamento','#thFooterAlign');
    }
  }

  function showSelectionEditor(selection){
    const section=$('#visualSelectionEditor'),empty=$('#visualSelectionEmpty');if(!section)return;
    if(empty)empty.hidden=true;section.hidden=false;
    $('#visualSelectionTitle').textContent=selection.label||'Elemento';
    $('#visualSelectionHint').textContent=selection.kind==='product'?'Edite os dados abaixo ou use os botões para mover, ocultar ou excluir.':'As mudanças aparecem imediatamente na prévia. Salve quando terminar.';
    setFeedback($('#visualSelectionFeedback'),'');configureVisualActions(selection);renderSelectionQuickFields(selection);
  }

  function selectVisualElement(selection){
    visualSelection=selection;showSelectionEditor(selection);highlightPreviewSelection();
    if(selection.kind==='product'){
      const product=products.find(p=>p.id===selection.key);if(product)openProductDialog(product);
      $('#visualSelectionEditor').hidden=false;
    }else{
      const productPanel=$('#productDialog');if(productPanel)productPanel.hidden=true;activeProduct=null;resetCropEditor();
    }
    setVisualEditorStatus(`${selection.label} selecionado.`);
  }

  function clearVisualSelection(){
    visualSelection=null;const section=$('#visualSelectionEditor');if(section)section.hidden=true;const product=$('#productDialog');if(product)product.hidden=true;activeProduct=null;resetCropEditor();const empty=$('#visualSelectionEmpty');if(empty)empty.hidden=false;highlightPreviewSelection();setVisualEditorStatus('Clique em um elemento da prévia para editar.');
  }

  function swapItem(list,key,direction){
    const next=[...list],index=next.indexOf(key),target=index+(direction<0?-1:1);if(index<0||target<0||target>=next.length)return null;[next[index],next[target]]=[next[target],next[index]];return next;
  }

  async function reorderProduct(productId,direction){
    const ordered=[...products].sort((a,b)=>(Number(a.position)||999999)-(Number(b.position)||999999)||a.name.localeCompare(b.name,'pt-BR'));
    const index=ordered.findIndex(p=>p.id===productId),target=index+(direction<0?-1:1);if(index<0||target<0||target>=ordered.length)return false;
    [ordered[index],ordered[target]]=[ordered[target],ordered[index]];ordered.forEach((product,i)=>product.position=i+1);
    const data=await request('/api/admin/catalog',{method:'PUT',body:JSON.stringify({revision:catalogRevision,productOrderIds:ordered.map(product=>product.id)})});catalogRevision=data.revision||catalogRevision;await Promise.all([loadProducts(),loadCatalog()]);reloadSitePreview({keepSelection:true});return true;
  }

  async function moveVisualSelection(direction){
    const selection=visualSelection;if(!selection)return;
    try{
      if(selection.kind==='product'){
        const moved=await reorderProduct(selection.key,direction);setFeedback($('#visualSelectionFeedback'),moved?'Produto movido.':'Ele já está no limite.','ok');return;
      }
      const draft=collectThemeForm();const layout=draft.visual?.layout||{};let key='';
      if(selection.kind==='header')key='headerOrder';else if(selection.kind==='block')key='blocks';else if(selection.kind==='footer')key='footerOrder';
      if(!key)return;const next=swapItem(layout[key]||[],selection.key,direction);if(!next){setFeedback($('#visualSelectionFeedback'),'Este elemento já está no limite.','ok');return}
      layout[key]=next;themeSettings=draft;
      if(key==='blocks'&&$('#thBlocks'))$('#thBlocks').value=next.join(',');if(key==='footerOrder'&&$('#thFooterOrder'))$('#thFooterOrder').value=next.join(',');
      applyDraftThemeToPreview(draft);highlightPreviewSelection();setFeedback($('#visualSelectionFeedback'),'Posição alterada • ainda não salvo.','ok');setVisualEditorStatus('Posição alterada • ainda não salvo');
    }catch(error){setFeedback($('#visualSelectionFeedback'),error.message,'bad')}
  }

  const VISIBILITY_MAP={
    'header:brand':'headerBrand','header:nav':'headerNav','header:actions':'headerActions',
    'block:intro':'intro','block:filters':'filterBlock','block:products':'products',
    'footer:logo':'footerLogo','footer:description':'footerDescription','footer:contact':'footerContact'
  };
  const VISIBILITY_LABELS={headerBrand:'Marca do cabeçalho',headerNav:'Menu principal',headerActions:'Ações do cabeçalho',intro:'Apresentação',filterBlock:'Busca e filtros',products:'Grade de produtos',footerLogo:'Marca do rodapé',footerDescription:'Descrição do rodapé',footerContact:'Contato do rodapé'};

  async function hideVisualSelection(){
    const selection=visualSelection;if(!selection)return;
    try{
      if(selection.kind==='product'){
        await request(`/api/admin/products/${encodeURIComponent(selection.key)}`,{method:'PATCH',body:JSON.stringify({hidden:true})});await loadProducts();clearVisualSelection();reloadSitePreview();renderHiddenElements();setVisualEditorStatus('Produto ocultado.','ok');return;
      }
      const visibilityKey=VISIBILITY_MAP[`${selection.kind}:${selection.key}`];if(!visibilityKey)return;
      const draft=collectThemeForm();draft.visual.visibility={...(draft.visual.visibility||{}),[visibilityKey]:false};themeSettings=draft;applyDraftThemeToPreview(draft);clearVisualSelection();renderHiddenElements();setVisualEditorStatus('Elemento ocultado • salve para confirmar.');
    }catch(error){setFeedback($('#visualSelectionFeedback'),error.message,'bad')}
  }

  async function deleteVisualSelection(){
    if(visualSelection?.kind!=='product')return;
    const product=products.find(p=>p.id===visualSelection.key);if(!product)return;
    if(!confirm(`Excluir "${product.name}" da loja? Esta ação não pode ser desfeita.`))return;
    try{await request(`/api/admin/products/${encodeURIComponent(product.id)}`,{method:'DELETE'});await Promise.all([loadProducts(),loadCatalog()]);clearVisualSelection();reloadSitePreview();setVisualEditorStatus('Produto excluído.','ok')}catch(error){setFeedback($('#visualSelectionFeedback'),error.message,'bad')}
  }

  function renderHiddenElements(){
    const root=$('#visualHiddenList');if(!root)return;root.replaceChildren();
    const draft=themeSettings?collectThemeForm():null;const visibility=draft?.visual?.visibility||{};
    for(const [key,label] of Object.entries(VISIBILITY_LABELS)){
      if(visibility[key]!==false)continue;const button=document.createElement('button');button.type='button';button.className='restore-chip';button.dataset.restoreVisibility=key;button.textContent=`↩ ${label}`;root.append(button)
    }
    for(const product of products.filter(p=>p.hidden===true)){
      const button=document.createElement('button');button.type='button';button.className='restore-chip';button.dataset.restoreProduct=product.id;button.textContent=`↩ Produto: ${product.name}`;root.append(button)
    }
    if(!root.children.length){const span=document.createElement('span');span.className='empty-mini';span.textContent='Nenhum elemento oculto.';root.append(span)}
  }

  async function restoreHiddenItem(button){
    try{
      if(button.dataset.restoreProduct){await request(`/api/admin/products/${encodeURIComponent(button.dataset.restoreProduct)}`,{method:'PATCH',body:JSON.stringify({hidden:false})});await loadProducts();reloadSitePreview();renderHiddenElements();setVisualEditorStatus('Produto restaurado.','ok');return}
      const key=button.dataset.restoreVisibility;if(!key)return;const draft=collectThemeForm();draft.visual.visibility={...(draft.visual.visibility||{}),[key]:true};themeSettings=draft;applyDraftThemeToPreview(draft);renderHiddenElements();setVisualEditorStatus('Elemento restaurado • ainda não salvo.');
    }catch(error){setVisualEditorStatus(error.message,'bad')}
  }

  function reloadSitePreview({keepSelection=false}={}){
    const frame=previewFrame();if(!frame)return;if(!keepSelection)visualSelection=null;setVisualEditorStatus('Recarregando a loja…');frame.src=`/?adminPreview=1&_=${Date.now()}`;
  }

  function onPreviewLoaded(){
    installPreviewBridge();
    const sync=()=>{const app=previewApp();if(!app)return;try{if(themeSettings)app.setSettings(collectThemeForm());if(products.length)app.setProducts(products);if(activeProduct)previewProductDraft();installPreviewBridge();highlightPreviewSelection();setVisualEditorStatus('Prévia pronta • clique para editar','ok')}catch(error){setVisualEditorStatus('Não foi possível sincronizar a prévia.','bad')}};
    setTimeout(sync,120);setTimeout(sync,700);
  }

  async function saveVisualChanges(){
    const button=$('#visualSaveButton');if(button)button.disabled=true;
    try{
      const productPanel=$('#productDialog');
      if(productPanel&&!productPanel.hidden){
        const productSaved=await saveProduct({preventDefault(){}});
        if(productSaved===false){setVisualEditorStatus('Revise os campos do produto antes de salvar.','bad');return}
      }
      const layoutSaved=await saveTheme();
      if(layoutSaved!==false)setVisualEditorStatus('Tudo salvo.','ok');
    }finally{if(button)button.disabled=false}
  }

  function bindVisualEditor(){
    const frame=previewFrame();frame?.addEventListener('load',onPreviewLoaded);
    $('#visualReloadPreview')?.addEventListener('click',()=>reloadSitePreview({keepSelection:true}));
    $('#visualSaveButton')?.addEventListener('click',saveVisualChanges);
    $('#visualClearSelection')?.addEventListener('click',clearVisualSelection);
    $('#visualMoveUp')?.addEventListener('click',()=>moveVisualSelection(-1));$('#visualMoveDown')?.addEventListener('click',()=>moveVisualSelection(1));
    $('#visualHideElement')?.addEventListener('click',hideVisualSelection);$('#visualDeleteElement')?.addEventListener('click',deleteVisualSelection);
    document.querySelectorAll('[data-preview-device]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-preview-device]').forEach(item=>item.classList.toggle('active',item===button));const stage=$('#visualPreviewFrame');if(stage)stage.dataset.device=button.dataset.previewDevice}));
    $('#visualHiddenList')?.addEventListener('click',event=>{const button=event.target.closest('[data-restore-product],[data-restore-visibility]');if(button)restoreHiddenItem(button)});
    $('#openAdvancedSettings')?.addEventListener('click',()=>$('#themeTitle')?.scrollIntoView({behavior:'smooth',block:'start'}));
    const themePanel=$('#themeTitle')?.closest('.panel');
    const markThemeDirty=()=>{themeDirty=true;scheduleDraftThemePreview()};
    themePanel?.addEventListener('input',markThemeDirty);themePanel?.addEventListener('change',markThemeDirty);
    onPreviewLoaded();
  }

  function replaceSelectOptions(select, items, {blankLabel='', selected=''}={}) {
    if(!select)return; select.replaceChildren();
    if(blankLabel){const option=document.createElement('option');option.value='';option.textContent=blankLabel;select.append(option)}
    for(const item of items){const option=document.createElement('option');option.value=item.value;option.textContent=item.label;select.append(option)}
    if([...select.options].some(option=>option.value===selected))select.value=selected;
  }

  function populatePromotionProductOptions() {
    const list=products.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR')).map(product=>({value:product.id,label:product.name}));
    const productSelect=$('#promotionProduct');const selected=productSelect?.value||'';replaceSelectOptions(productSelect,list,{blankLabel:'Todos os produtos',selected});
    const bundle=$('#promotionRequiredProducts');if(bundle){const selectedIds=new Set([...bundle.selectedOptions].map(option=>option.value));replaceSelectOptions(bundle,list);[...bundle.options].forEach(option=>{option.selected=selectedIds.has(option.value)})}
    updatePromotionVariantOptions();
  }

  function updatePromotionVariantOptions() {
    const productId=$('#promotionProduct')?.value||'';const select=$('#promotionVariant');if(!select)return;
    const selected=select.value;const product=products.find(item=>item.id===productId);
    const variants=(product?.variants||[]).map(variant=>({value:variant.id,label:variant.name}));
    replaceSelectOptions(select,variants,{blankLabel:variants.length?'Todas as variações':'Sem variação específica',selected});
    select.disabled=!variants.length;
  }

  function updatePromotionScopeControls(){
    const type=$('#promotionType')?.value||'';const globalOnly=type==='free_shipping_threshold'||type==='bundle_percent';
    for(const selector of ['#promotionProduct','#promotionVariant','#promotionDepartment','#promotionCategory']){const field=$(selector);if(field){field.disabled=globalOnly;if(globalOnly)field.value=''}}
    const stackable=$('#promotionStackable');if(stackable){const forced=type==='sale_price'||type==='free_shipping_threshold';if(forced)stackable.checked=true;stackable.disabled=forced;stackable.title=type==='sale_price'?'Preço promocional define o preço-base e pode coexistir com promoções de carrinho.':type==='free_shipping_threshold'?'Frete grátis é um benefício de envio e pode coexistir com promoções de produtos.':''}
    if(globalOnly)updatePromotionVariantOptions();
  }

  function promotionTypeLabel(type){
    return ({sale_price:'Preço promocional',category_percent:'Desconto por categoria',quantity_percent:'Desconto por quantidade',buy_x_pay_y:'Leve X, pague Y',nth_unit_percent:'Desconto na Nª unidade',bundle_percent:'Combo / compre junto',free_shipping_threshold:'Frete grátis acima de'})[type]||type;
  }

  function promotionRuleSummary(promo){
    if(promo.type==='sale_price')return `Preço: ${money(promo.salePriceCents)}`;
    if(promo.type==='category_percent')return `${promo.value}% de desconto`;
    if(promo.type==='quantity_percent')return `${promo.value}% com ${promo.minQty}+ unidades`;
    if(promo.type==='buy_x_pay_y')return `Leve ${promo.buyQty}, pague ${promo.payQty}`;
    if(promo.type==='nth_unit_percent')return `${promo.value}% na ${promo.nthQty}ª unidade`;
    if(promo.type==='bundle_percent')return `${promo.value}% no combo de ${(promo.requiredProductIds||[]).length} produtos`;
    if(promo.type==='free_shipping_threshold')return `Frete grátis acima de ${money(promo.minSubtotalCents)}`;
    return '—';
  }

  function promotionScopeLabel(promo){
    const bits=[];const product=products.find(item=>item.id===promo.productId);const variant=product?.variants?.find(item=>item.id===promo.variantId);
    if(product)bits.push(product.name);if(variant)bits.push(variant.name);if(promo.department)bits.push(`Depto.: ${promo.department}`);if(promo.category)bits.push(`Categoria: ${promo.category}`);
    if(promo.type==='bundle_percent'){const names=(promo.requiredProductIds||[]).map(id=>products.find(item=>item.id===id)?.name||id);if(names.length)bits.push(names.join(' + '))}
    return bits.length?bits.join(' • '):'Toda a loja';
  }

  function promotionPeriod(promo){
    if(!promo.startsAt&&!promo.endsAt)return 'Sempre';
    if(promo.startsAt&&promo.endsAt)return `${dateTime(promo.startsAt)} → ${dateTime(promo.endsAt)}`;
    if(promo.startsAt)return `A partir de ${dateTime(promo.startsAt)}`;
    return `Até ${dateTime(promo.endsAt)}`;
  }

  function promotionIsCurrentlyActive(promo){const now=Date.now();return promo.active!==false&&(!promo.startsAt||Date.parse(promo.startsAt)<=now)&&(!promo.endsAt||Date.parse(promo.endsAt)>=now)}

  function renderPromotions(){
    const body=$('#promotionsBody');if(!body)return;body.replaceChildren();$('#promotionsEmpty').hidden=promotions.length>0;
    for(const promo of promotions){
      const tr=document.createElement('tr');const nameCell=makeCell();const strong=document.createElement('strong');strong.textContent=promo.name;nameCell.append(strong);if(promo.badge){const badge=document.createElement('span');badge.className='promotion-badge-admin';badge.textContent=promo.badge;nameCell.append(document.createElement('br'),badge)}tr.append(nameCell);
      const rule=makeCell();rule.className='promotion-rule-summary';rule.textContent=`${promotionTypeLabel(promo.type)} — ${promotionRuleSummary(promo)}`;tr.append(rule);
      const scope=makeCell(promotionScopeLabel(promo));scope.className='promotion-scope';tr.append(scope,makeCell(promotionPeriod(promo)));
      const status=makeCell();const statusBadge=document.createElement('span');const scheduled=promo.active!==false&&!promotionIsCurrentlyActive(promo);statusBadge.className=promotionIsCurrentlyActive(promo)?'coupon-active':'coupon-inactive';statusBadge.textContent=promo.active===false?'Inativa':scheduled?'Agendada/encerrada':'Ativa';status.append(statusBadge);tr.append(status);
      const actions=makeCell();actions.className='table-actions';const toggle=document.createElement('button');toggle.type='button';toggle.className='row-button';toggle.dataset.promotionToggle=promo.id;toggle.textContent=promo.active===false?'Ativar':'Desativar';const remove=document.createElement('button');remove.type='button';remove.className='row-button';remove.dataset.promotionRemove=promo.id;remove.textContent='Excluir';actions.append(toggle,remove);tr.append(actions);body.append(tr);
    }
    const app=previewApp();if(app?.setPromotions)app.setPromotions(promotions);
  }

  async function loadPromotions(){
    try{const data=await request('/api/admin/promotions');promotions=Array.isArray(data.promotions)?data.promotions:[];promotionsRevision=data.revision||'';renderPromotions()}
    catch(error){setFeedback($('#promotionsFeedback'),error.message,'bad')}
  }

  async function savePromotions(next,message){
    try{const data=await request('/api/admin/promotions',{method:'PUT',body:JSON.stringify({promotions:next,revision:promotionsRevision})});promotions=Array.isArray(data.promotions)?data.promotions:[];promotionsRevision=data.revision||promotionsRevision;renderPromotions();await loadCatalog();setFeedback($('#promotionsFeedback'),message,'ok')}
    catch(error){setFeedback($('#promotionsFeedback'),error.message,'bad')}
  }

  function localDateTimeIso(value){if(!value)return '';const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toISOString()}
  function fieldInt(selector){const value=intOrNull($(selector)?.value);return value==null?0:value}

  async function addPromotion(event){
    event.preventDefault();const type=$('#promotionType').value;const name=$('#promotionName').value.trim();if(!name)return setFeedback($('#promotionsFeedback'),'Informe um nome para a promoção.','bad');
    const globalOnly=type==='free_shipping_threshold'||type==='bundle_percent';const promo={id:`promo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,name,type,active:true,startsAt:localDateTimeIso($('#promotionStarts').value),endsAt:localDateTimeIso($('#promotionEnds').value),productId:globalOnly?'':$('#promotionProduct').value,variantId:globalOnly?'':$('#promotionVariant').value,department:globalOnly?'':$('#promotionDepartment').value,category:globalOnly?'':$('#promotionCategory').value.trim(),value:fieldInt('#promotionValue'),salePriceCents:parseReais($('#promotionSalePrice').value)||0,minQty:fieldInt('#promotionMinQty'),buyQty:fieldInt('#promotionBuyQty'),payQty:fieldInt('#promotionPayQty'),nthQty:fieldInt('#promotionNthQty'),minSubtotalCents:parseReais($('#promotionMinSubtotal').value)||0,requiredProductIds:[...$('#promotionRequiredProducts').selectedOptions].map(option=>option.value),stackable:(type==='sale_price'||type==='free_shipping_threshold')?true:$('#promotionStackable').checked,badge:$('#promotionBadge').value.trim()};
    if(promo.startsAt&&promo.endsAt&&Date.parse(promo.endsAt)<=Date.parse(promo.startsAt))return setFeedback($('#promotionsFeedback'),'O fim da promoção precisa ser posterior ao início.','bad');
    if(type==='sale_price'&&(promo.salePriceCents<1||!promo.productId))return setFeedback($('#promotionsFeedback'),'Preço promocional exige um produto e um preço maior que zero.','bad');
    if(['category_percent','quantity_percent','nth_unit_percent','bundle_percent'].includes(type)&&(promo.value<1||promo.value>100))return setFeedback($('#promotionsFeedback'),'Informe um desconto entre 1% e 100%.','bad');
    if(type==='quantity_percent'&&promo.minQty<2)return setFeedback($('#promotionsFeedback'),'Informe uma quantidade mínima de pelo menos 2 unidades.','bad');
    if(type==='buy_x_pay_y'&&(promo.buyQty<2||promo.payQty<1||promo.payQty>=promo.buyQty))return setFeedback($('#promotionsFeedback'),'Em “Leve X, pague Y”, X deve ser pelo menos 2 e Y menor que X.','bad');
    if(type==='nth_unit_percent'&&promo.nthQty<2)return setFeedback($('#promotionsFeedback'),'Informe qual unidade recebe o desconto (2 ou mais).','bad');
    if(type==='bundle_percent'&&promo.requiredProductIds.length<2)return setFeedback($('#promotionsFeedback'),'Selecione pelo menos 2 produtos para o combo.','bad');
    if(type==='free_shipping_threshold'&&promo.minSubtotalCents<1)return setFeedback($('#promotionsFeedback'),'Informe o valor mínimo para o frete grátis.','bad');
    await savePromotions([...promotions,promo],`Promoção “${name}” criada.`);$('#promotionForm').reset();populatePromotionProductOptions();updatePromotionScopeControls();
  }

  function watchersForAlert(alert){return restockSubscriptions.filter(item=>item.productId===alert.productId&&(item.variantId||'')===(alert.variantId||'')).length}
  function renderInventoryAlerts(){
    const body=$('#inventoryAlertsBody');if(!body)return;body.replaceChildren();$('#inventoryAlertsEmpty').hidden=inventoryAlerts.length>0;$('#inventoryCriticalCount').textContent=inventoryAlerts.length;$('#inventoryOutCount').textContent=inventoryAlerts.filter(item=>item.outOfStock).length;$('#restockWaitingCount').textContent=restockSubscriptions.length;
    for(const alert of inventoryAlerts){const tr=document.createElement('tr');const productCell=makeCell();const strong=document.createElement('strong');strong.textContent=alert.productName;productCell.append(strong);if(alert.variantName){const small=document.createElement('div');small.textContent=alert.variantName;small.className='pf-missing';productCell.append(small)}tr.append(productCell);const stock=makeCell(String(alert.stock));stock.className=alert.outOfStock?'stock-danger':'stock-warning';tr.append(stock,makeCell(String(alert.stockMin)),makeCell(alert.restockDate?dateTime(`${String(alert.restockDate).slice(0,10)}T12:00:00`):'Não informada'),makeCell(String(watchersForAlert(alert))));const actions=makeCell();const button=document.createElement('button');button.type='button';button.className='row-button';button.dataset.inventoryEdit=alert.productId;button.textContent='Editar produto';actions.append(button);tr.append(actions);body.append(tr)}
  }

  async function loadInventoryAlerts(){
    try{const data=await request('/api/admin/inventory/alerts');inventoryAlerts=Array.isArray(data.alerts)?data.alerts:[];restockSubscriptions=Array.isArray(data.subscriptions)?data.subscriptions:[];renderInventoryAlerts();setFeedback($('#inventoryAlertsFeedback'),inventoryAlerts.length?`${inventoryAlerts.length} item(ns) exigem atenção.`:'Estoque sem alertas críticos.','ok')}
    catch(error){setFeedback($('#inventoryAlertsFeedback'),error.message,'bad')}
  }

  function reviewStatusLabel(status){return status==='published'?'Publicada':status==='rejected'?'Rejeitada':'Pendente'}
  function renderReviews(){
    const body=$('#reviewsBody');if(!body)return;body.replaceChildren();$('#reviewsEmpty').hidden=reviews.length>0;
    for(const review of reviews){const product=products.find(item=>item.id===review.productId);const tr=document.createElement('tr');tr.append(makeCell(product?.name||review.productId),makeCell(review.email||'—'));const rating=makeCell(`${'★'.repeat(Math.max(0,Math.min(5,Number(review.rating)||0)))}${'☆'.repeat(Math.max(0,5-(Number(review.rating)||0)))}`);rating.className='review-stars';tr.append(rating);const copy=makeCell();copy.className='admin-review-copy';if(review.title){const strong=document.createElement('strong');strong.textContent=review.title;copy.append(strong)}const paragraph=document.createElement('p');paragraph.textContent=review.body||'Sem comentário.';copy.append(paragraph);tr.append(copy,makeCell(dateTime(review.createdAt)));const status=makeCell(reviewStatusLabel(review.status));status.className=`review-status-${review.status||'pending'}`;tr.append(status);const actions=makeCell();actions.className='table-actions';if(review.status!=='published'){const approve=document.createElement('button');approve.type='button';approve.className='row-button';approve.dataset.reviewStatus='published';approve.dataset.reviewId=review.id;approve.textContent='Publicar';actions.append(approve)}if(review.status!=='rejected'){const reject=document.createElement('button');reject.type='button';reject.className='row-button';reject.dataset.reviewStatus='rejected';reject.dataset.reviewId=review.id;reject.textContent='Rejeitar';actions.append(reject)}if(review.status!=='pending'){const pending=document.createElement('button');pending.type='button';pending.className='row-button';pending.dataset.reviewStatus='pending';pending.dataset.reviewId=review.id;pending.textContent='Pendente';actions.append(pending)}tr.append(actions);body.append(tr)}
  }

  async function loadReviews(){
    try{const status=$('#reviewStatusFilter')?.value||'';const data=await request(`/api/admin/reviews?status=${encodeURIComponent(status)}&limit=300`);reviews=Array.isArray(data.reviews)?data.reviews:[];renderReviews()}
    catch(error){setFeedback($('#reviewsAdminFeedback'),error.message,'bad')}
  }

  async function moderateReview(id,status){
    try{await request(`/api/admin/reviews/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status})});setFeedback($('#reviewsAdminFeedback'),`Avaliação marcada como ${reviewStatusLabel(status).toLowerCase()}.`,'ok');await Promise.all([loadReviews(),loadCatalog()])}
    catch(error){setFeedback($('#reviewsAdminFeedback'),error.message,'bad')}
  }

  function couponTypeLabel(type){return type==='percent'?'Porcentagem':type==='fixed'?'Valor fixo':'Frete grátis'}
  function couponValueLabel(coupon){
    if(coupon.type==='percent')return `${coupon.value}%`;
    if(coupon.type==='fixed')return money(coupon.value);
    return '—';
  }

  function renderCoupons() {
    const body=$('#couponsBody'); if(!body)return; body.replaceChildren(); $('#couponsEmpty').hidden=coupons.length>0;
    for (const coupon of coupons) {
      const tr=document.createElement('tr');
      const codeCell=makeCell(); const strong=document.createElement('strong'); strong.textContent=coupon.code; codeCell.append(strong); tr.append(codeCell);
      tr.append(makeCell(couponTypeLabel(coupon.type)),makeCell(couponValueLabel(coupon)),makeCell(coupon.minSubtotalCents>0?money(coupon.minSubtotalCents):'—'),makeCell(coupon.expiresAt?dateTime(coupon.expiresAt):'Sem validade'));
      const statusCell=makeCell(); const badge=document.createElement('span'); const expired=coupon.expiresAt&&Date.parse(coupon.expiresAt)<Date.now();
      badge.className=coupon.active&&!expired?'coupon-active':'coupon-inactive'; badge.textContent=expired?'Expirado':coupon.active?'Ativo':'Inativo'; statusCell.append(badge); tr.append(statusCell);
      const actions=makeCell();
      const toggle=document.createElement('button'); toggle.type='button'; toggle.className='row-button'; toggle.textContent=coupon.active?'Desativar':'Ativar'; toggle.dataset.couponToggle=coupon.code;
      const remove=document.createElement('button'); remove.type='button'; remove.className='row-button'; remove.textContent='Excluir'; remove.dataset.couponRemove=coupon.code;
      actions.append(toggle,document.createTextNode(' '),remove); tr.append(actions);
      body.append(tr);
    }
  }

  async function loadCoupons() {
    try { const data=await request('/api/admin/coupons'); coupons=Array.isArray(data.coupons)?data.coupons:[]; couponsRevision=data.revision||''; renderCoupons(); }
    catch(error){setFeedback($('#couponsFeedback'),error.message,'bad')}
  }

  async function saveCoupons(next,message) {
    try {
      const data=await request('/api/admin/coupons',{method:'PUT',body:JSON.stringify({coupons:next,revision:couponsRevision})});
      coupons=Array.isArray(data.coupons)?data.coupons:[]; couponsRevision=data.revision||couponsRevision; renderCoupons(); setFeedback($('#couponsFeedback'),message,'ok');
    } catch(error){setFeedback($('#couponsFeedback'),error.message,'bad')}
  }

  async function addCoupon(event) {
    event.preventDefault();
    const code=$('#couponCode').value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'');
    const type=$('#couponType').value;
    if(code.length<3)return setFeedback($('#couponsFeedback'),'O código precisa de pelo menos 3 caracteres.','bad');
    if(coupons.some(c=>c.code===code))return setFeedback($('#couponsFeedback'),`O cupom ${code} já existe.`,'bad');
    let value=0;
    if(type==='percent'){value=Number($('#couponValue').value.replace(',','.'));if(!Number.isFinite(value)||value<1||value>100)return setFeedback($('#couponsFeedback'),'Informe uma porcentagem entre 1 e 100.','bad');value=Math.round(value)}
    else if(type==='fixed'){value=parseReais($('#couponValue').value);if(value==null||value<1)return setFeedback($('#couponsFeedback'),'Informe o valor do desconto em reais, por exemplo 10,00.','bad')}
    const minSubtotalCents=parseReais($('#couponMin').value)||0;
    const expiresRaw=$('#couponExpires').value;
    const expiresAt=expiresRaw?`${expiresRaw}T23:59:59-03:00`:'';
    const next=[...coupons,{code,type,value,minSubtotalCents,expiresAt,active:true,note:$('#couponNote').value.trim()}];
    await saveCoupons(next,`Cupom ${code} criado.`);
    $('#couponForm').reset();
  }

  function download(filename,text,type) { const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  function exportOrders() {
    const rows=[['id','data','cliente','email','telefone','status','subtotal_centavos','frete_centavos','desconto_centavos','cupom','total_centavos','pagamento','pagamento_id','rastreio'],...orders.map(o=>[o.id,o.createdAt,o.customer?.name||'',o.customer?.email||'',o.customer?.phone||'',o.status,o.subtotalCents,o.shippingCents??'',o.discountCents||0,o.coupon?.code||'',o.totalCents,o.payment?.status||'',o.payment?.paymentId||'',o.trackingCode||''])];
    // Proteção contra injeção de fórmula no Excel/LibreOffice: valores que
    // começam com = + - @ ganham apóstrofo. BOM UTF-8 para acentos no Excel PT-BR.
    const safeCell=value=>{let text=String(value??'');if(/^[=+\-@]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`};
    const csv='\uFEFF'+rows.map(row=>row.map(safeCell).join(',')).join('\n'); download(`integrall-pedidos-${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv;charset=utf-8');
  }
  function downloadCatalog() { if(!catalog)return;download(`integrall-catalogo-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(catalog,null,2),'application/json'); }

  async function importCatalog(file) {
    setFeedback($('#catalogFeedback'),'Validando catálogo…');
    try {
      if(file.size>2_000_000)throw new Error('O arquivo JSON excede 2 MB.');
      const parsed=JSON.parse(await file.text()); if(!Array.isArray(parsed.products))throw new Error('O JSON precisa conter o array products.');
      if(!confirm(`Substituir o catálogo do servidor por ${parsed.products.length} produto(s)?`))return;
      const data=await request('/api/admin/catalog',{method:'PUT',body:JSON.stringify({revision:catalogRevision,settings:parsed.settings,commerce:parsed.commerce ?? parsed.v8,coupons:parsed.coupons,promotions:parsed.promotions,products:parsed.products})}); catalog=data.catalog;catalogRevision=data.revision||catalogRevision;$('#catalogCount').textContent=data.products;setFeedback($('#catalogFeedback'),`Catálogo atualizado: ${data.products} produto(s).`,'ok');
    } catch(error){setFeedback($('#catalogFeedback'),error.message,'bad')}
  }

  async function loadAll() { await Promise.all([loadOrders(),loadCustomers(),loadCatalog(),loadCoupons(),loadProducts(),loadTheme(),checkHealth()]); await Promise.all([loadPromotions(),loadInventoryAlerts(),loadReviews()]); }

  function bind() {
    $('#loginForm')?.addEventListener('submit',authenticateAdmin);$('#logoutButton')?.addEventListener('click',logoutAdmin);
    $('#refreshButton').addEventListener('click',loadAll);
    let searchTimer; $('#orderSearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadOrders,300)}); $('#orderStatus').addEventListener('change',loadOrders);
    let customerTimer; $('#customerSearch')?.addEventListener('input',()=>{clearTimeout(customerTimer);customerTimer=setTimeout(loadCustomers,300)});
    $('#ordersBody').addEventListener('click',event=>{const button=event.target.closest('[data-order-id]');if(button)openOrder(button.dataset.orderId)});
    $('#closeDialog').addEventListener('click',()=>{const panel=$('#orderDialog');panel.hidden=true;activeOrder=null}); $('#saveStatusButton').addEventListener('click',saveStatus); $('#saveShippingButton').addEventListener('click',saveShipping); $('#saveTrackingButton').addEventListener('click',saveTracking);
    $('#productsBody')?.addEventListener('click',event=>{const button=event.target.closest('[data-product-id]');if(!button)return;const product=products.find(p=>p.id===button.dataset.productId);if(product)openProductDialog(product)});
    $('#businessForm')?.addEventListener('input',()=>{businessDirty=true});
    $('#businessForm')?.addEventListener('submit',saveBusiness);
    $('#productForm')?.addEventListener('submit',saveProduct);
    $('#productForm')?.addEventListener('input',()=>{if(!$('#productDialog')?.hidden){productDirty=true;previewProductDraft()}});
    $('#productForm')?.addEventListener('change',()=>{if(!$('#productDialog')?.hidden){productDirty=true;previewProductDraft()}});
    $('#closeProductDialog')?.addEventListener('click',closeProductEditor);
    $('#newProductButton')?.addEventListener('click',()=>openProductDialog(null));
    $('#addShippingBoxButton')?.addEventListener('click',()=>{appendShippingBox();productDirty=true;});
    $('#addVariantButton')?.addEventListener('click',()=>{appendVariantBox($('#pfVariants'),null);productDirty=true;previewProductDraft()});
    $('#deleteProductButton')?.addEventListener('click',deleteProduct);
    $('#themeSaveButton')?.addEventListener('click',saveTheme);
    $('#themeReloadButton')?.addEventListener('click',discardThemeChanges);
    bindThemeTabs();
    bindThemeAssetUploads();
    bindProductImageEditor();
    bindVisualEditor();
    $('#couponForm')?.addEventListener('submit',addCoupon);
    $('#couponType')?.addEventListener('change',()=>{const type=$('#couponType').value;const label=$('#couponValueLabel');const input=$('#couponValue');if(type==='free_shipping'){label.style.opacity='.45';input.disabled=true;input.value=''}else{label.style.opacity='';input.disabled=false;input.placeholder=type==='percent'?'10':'10,00'}});
    $('#couponsBody')?.addEventListener('click',event=>{
      const toggle=event.target.closest('[data-coupon-toggle]');
      if(toggle){const code=toggle.dataset.couponToggle;const next=coupons.map(c=>c.code===code?{...c,active:!c.active}:c);saveCoupons(next,`Cupom ${code} atualizado.`);return}
      const remove=event.target.closest('[data-coupon-remove]');
      if(remove){const code=remove.dataset.couponRemove;if(!confirm(`Excluir o cupom ${code}?`))return;saveCoupons(coupons.filter(c=>c.code!==code),`Cupom ${code} excluído.`)}
    });
    $('#promotionForm')?.addEventListener('submit',addPromotion);
    $('#promotionProduct')?.addEventListener('change',updatePromotionVariantOptions);$('#promotionType')?.addEventListener('change',updatePromotionScopeControls);updatePromotionScopeControls();
    $('#promotionsBody')?.addEventListener('click',event=>{
      const toggle=event.target.closest('[data-promotion-toggle]');if(toggle){const id=toggle.dataset.promotionToggle;savePromotions(promotions.map(item=>item.id===id?{...item,active:item.active===false}:item),'Promoção atualizada.');return}
      const remove=event.target.closest('[data-promotion-remove]');if(remove){const id=remove.dataset.promotionRemove;const promo=promotions.find(item=>item.id===id);if(!confirm(`Excluir a promoção “${promo?.name||id}”?`))return;savePromotions(promotions.filter(item=>item.id!==id),'Promoção excluída.')}
    });
    $('#refreshInventoryAlerts')?.addEventListener('click',loadInventoryAlerts);
    $('#inventoryAlertsBody')?.addEventListener('click',event=>{const button=event.target.closest('[data-inventory-edit]');if(!button)return;const product=products.find(item=>item.id===button.dataset.inventoryEdit);if(product)openProductDialog(product)});
    $('#reviewStatusFilter')?.addEventListener('change',loadReviews);
    $('#reviewsBody')?.addEventListener('click',event=>{const button=event.target.closest('[data-review-id][data-review-status]');if(button)moderateReview(button.dataset.reviewId,button.dataset.reviewStatus)});
    $('#exportOrdersButton').addEventListener('click',exportOrders); $('#downloadCatalogButton').addEventListener('click',downloadCatalog);
    $('#catalogFile').addEventListener('change',event=>{const file=event.target.files?.[0];if(file)importCatalog(file);event.target.value=''});
  }

  async function init(){bind();bindSessionLifecycle();checkHealth();if(await bootstrapAdminSession())await loadAll();}
  window.addEventListener('beforeunload',event=>{if(productDirty||themeDirty||themePendingMediaIds.size){event.preventDefault();event.returnValue=''}});
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
