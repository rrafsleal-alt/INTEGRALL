(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const TOKEN_KEY = 'integrall_admin_token_session_v9';
  const statuses = ['received','awaiting_payment','paid','payment_failed','payment_expired','payment_review','preparing','ready','completed','refunded','chargeback','cancelled'];
  const statusLabels = {
    received:'Recebido',awaiting_payment:'Aguardando pagamento',paid:'Pago',payment_failed:'Falha no pagamento',payment_expired:'Pagamento expirado',payment_review:'Revisar pagamento',preparing:'Preparando',ready:'Pronto',completed:'Concluído',refunded:'Reembolsado',chargeback:'Chargeback',cancelled:'Cancelado'
  };
  let orders = [];
  let customers = [];
  let catalog = null;
  let activeOrder = null;
  let coupons = [];
  let products = [];
  let activeProduct = null;

  const money = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(cents)||0)/100);
  const dateTime = value => { try { return value ? new Date(value).toLocaleString('pt-BR') : '—'; } catch { return '—'; } };
  function token() { return sessionStorage.getItem(TOKEN_KEY) || ''; }
  function setFeedback(node, text, type='') { if (!node) return; node.textContent=text; node.className=`feedback${type?` ${type}`:''}`; }

  async function request(path, options={}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept','application/json');
    if (options.body) headers.set('Content-Type','application/json');
    if (token()) headers.set('Authorization',`Bearer ${token()}`);
    const response = await fetch(path,{...options,headers});
    const data = await response.json().catch(()=>({}));
    if (response.status===401) {
      sessionStorage.removeItem(TOKEN_KEY);
      showLogin('Token inválido ou sessão expirada.');
      throw new Error(data.error || 'Não autorizado.');
    }
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  async function checkHealth() {
    try {
      const response=await fetch('/api/health',{headers:{Accept:'application/json'}});
      const data=await response.json();
      $('#healthStatus').textContent=data.ok?`API online • ${data.database}${data.mercadoPago?' • Mercado Pago ativo':' • Mercado Pago pendente'}`:'API indisponível';
    } catch { $('#healthStatus').textContent='API indisponível'; }
  }

  function showLogin(message='') {
    $('#loginPanel').hidden=false; $('#dashboard').hidden=true; $('#logoutButton').hidden=true;
    if (message) setFeedback($('#loginFeedback'),message,'bad');
    $('#adminToken').focus();
  }
  function showDashboard() { $('#loginPanel').hidden=true; $('#dashboard').hidden=false; $('#logoutButton').hidden=false; }
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
    try { catalog=await request('/api/catalog'); $('#catalogCount').textContent=Array.isArray(catalog.products)?catalog.products.length:0; setFeedback($('#catalogFeedback'),'Catálogo sincronizado com o servidor.','ok'); }
    catch(error){setFeedback($('#catalogFeedback'),error.message,'bad')}
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
    setFeedback($('#dialogFeedback'),''); $('#orderDialog').showModal();
  }

  async function openOrder(id) {
    try { const data=await request(`/api/admin/orders/${encodeURIComponent(id)}`); renderOrderDialog(data.order); }
    catch(error){setFeedback($('#ordersFeedback'),error.message,'bad')}
  }

  async function saveStatus() {
    if(!activeOrder?.id)return; const button=$('#saveStatusButton');button.disabled=true;
    try { const data=await request(`/api/admin/orders/${encodeURIComponent(activeOrder.id)}`,{method:'PATCH',body:JSON.stringify({status:$('#dialogStatus').value})}); setFeedback($('#dialogFeedback'),'Status atualizado.','ok'); renderOrderDialog(data.order); await Promise.all([loadOrders(),loadCatalog()]); }
    catch(error){setFeedback($('#dialogFeedback'),error.message,'bad')} finally{button.disabled=false}
  }

  function parseReais(value) {
    const text=String(value||'').trim().replace(/\./g,'').replace(',','.'); const number=Number(text); if(!Number.isFinite(number)||number<0)return null; return Math.round(number*100);
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
      tr.append(makeCell(product.available===false?'Não':'Sim'));
      const action=makeCell(); const button=document.createElement('button'); button.type='button'; button.className='row-button'; button.textContent='Editar'; button.dataset.productId=product.id; action.append(button); tr.append(action);
      body.append(tr);
    }
  }

  async function loadProducts() {
    try { const data=await request('/api/admin/products'); products=Array.isArray(data.products)?data.products:[]; renderProducts(); }
    catch(error){setFeedback($('#productsFeedback'),error.message,'bad')}
  }

  function intOrNull(value){const t=String(value||'').trim();if(!t)return null;const n=Number(t);return Number.isFinite(n)&&n>=0?Math.round(n):null}

  function openProductDialog(product) {
    activeProduct=product;
    $('#productDialogTitle').textContent=product.name;
    $('#pfName').value=product.name||'';
    $('#pfPrice').value=(Number(product.price)/100).toFixed(2).replace('.',',');
    $('#pfUnit').value=product.unit||'';
    $('#pfStock').value=product.stock==null?'':product.stock;
    $('#pfMinPerOrder').value=product.minPerOrder==null?'':product.minPerOrder;
    $('#pfMaxPerOrder').value=product.maxPerOrder==null?'':product.maxPerOrder;
    $('#pfWeight').value=product.weightGrams==null?'':product.weightGrams;
    $('#pfLength').value=product.lengthCm==null?'':product.lengthCm;
    $('#pfWidth').value=product.widthCm==null?'':product.widthCm;
    $('#pfHeight').value=product.heightCm==null?'':product.heightCm;
    $('#pfAvailable').checked=product.available!==false;
    $('#pfFeatured').checked=product.featured===true;
    $('#pfDescription').value=product.description||'';
    const variantsRoot=$('#pfVariants'); variantsRoot.replaceChildren();
    for (const variant of product.variants||[]) {
      const box=document.createElement('div'); box.className='pf-variant'; box.dataset.variantId=variant.id;
      const title=document.createElement('div'); title.className='pf-variant-title'; title.textContent=`Variante: ${variant.name}`; box.append(title);
      const fields=[['Nome','name',variant.name||''],['Preço (R$)','price',(Number(variant.price)/100).toFixed(2).replace('.',',')],['Estoque','stock',variant.stock==null?'':variant.stock],['Peso (g)','weightGrams',variant.weightGrams==null?'':variant.weightGrams]];
      for (const [labelText,key,value] of fields) {
        const label=document.createElement('label'); label.textContent=labelText;
        const input=document.createElement('input'); input.dataset.variantField=key; input.value=value;
        label.append(input); box.append(label);
      }
      variantsRoot.append(box);
    }
    setFeedback($('#productDialogFeedback'),'');
    $('#productDialog').showModal();
  }

  async function saveProduct(event) {
    event.preventDefault();
    if(!activeProduct?.id)return;
    const button=$('#productForm button[type="submit"]'); button.disabled=true;
    try {
      const price=parseReais($('#pfPrice').value);
      if(price==null)throw new Error('Informe um preço válido, por exemplo 21,50.');
      const patch={
        name:$('#pfName').value.trim(),
        price,
        unit:$('#pfUnit').value.trim(),
        description:$('#pfDescription').value.trim(),
        stock:intOrNull($('#pfStock').value),
        minPerOrder:intOrNull($('#pfMinPerOrder').value),
        maxPerOrder:intOrNull($('#pfMaxPerOrder').value),
        weightGrams:intOrNull($('#pfWeight').value),
        lengthCm:intOrNull($('#pfLength').value),
        widthCm:intOrNull($('#pfWidth').value),
        heightCm:intOrNull($('#pfHeight').value),
        available:$('#pfAvailable').checked,
        featured:$('#pfFeatured').checked
      };
      const variants=[...document.querySelectorAll('#pfVariants .pf-variant')].map(box=>{
        const get=key=>box.querySelector(`[data-variant-field="${key}"]`)?.value ?? '';
        const variantPrice=parseReais(get('price'));
        if(variantPrice==null)throw new Error(`Preço inválido na variante ${get('name')||box.dataset.variantId}.`);
        return {id:box.dataset.variantId,name:get('name').trim(),price:variantPrice,stock:intOrNull(get('stock')),weightGrams:intOrNull(get('weightGrams'))};
      });
      if(variants.length)patch.variants=variants;
      await request(`/api/admin/products/${encodeURIComponent(activeProduct.id)}`,{method:'PATCH',body:JSON.stringify(patch)});
      setFeedback($('#productDialogFeedback'),'Produto salvo.','ok');
      await Promise.all([loadProducts(),loadCatalog()]);
    } catch(error){setFeedback($('#productDialogFeedback'),error.message,'bad')} finally{button.disabled=false}
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
    try { const data=await request('/api/admin/coupons'); coupons=Array.isArray(data.coupons)?data.coupons:[]; renderCoupons(); }
    catch(error){setFeedback($('#couponsFeedback'),error.message,'bad')}
  }

  async function saveCoupons(next,message) {
    try {
      const data=await request('/api/admin/coupons',{method:'PUT',body:JSON.stringify({coupons:next})});
      coupons=Array.isArray(data.coupons)?data.coupons:[]; renderCoupons(); setFeedback($('#couponsFeedback'),message,'ok');
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
    const csv=rows.map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(',')).join('\n'); download(`integrall-pedidos-${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv;charset=utf-8');
  }
  function downloadCatalog() { if(!catalog)return;download(`integrall-catalogo-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(catalog,null,2),'application/json'); }

  async function importCatalog(file) {
    setFeedback($('#catalogFeedback'),'Validando catálogo…');
    try {
      if(file.size>2_000_000)throw new Error('O arquivo JSON excede 2 MB.');
      const parsed=JSON.parse(await file.text()); if(!Array.isArray(parsed.products))throw new Error('O JSON precisa conter o array products.');
      if(!confirm(`Substituir o catálogo do servidor por ${parsed.products.length} produto(s)?`))return;
      const data=await request('/api/admin/catalog',{method:'PUT',body:JSON.stringify({settings:parsed.settings,commerce:parsed.commerce ?? parsed.v8,coupons:parsed.coupons,products:parsed.products})}); catalog=data.catalog;$('#catalogCount').textContent=data.products;setFeedback($('#catalogFeedback'),`Catálogo atualizado: ${data.products} produto(s).`,'ok');
    } catch(error){setFeedback($('#catalogFeedback'),error.message,'bad')}
  }

  async function login(event) {
    event.preventDefault(); const value=$('#adminToken').value.trim(); if(!value)return;
    sessionStorage.setItem(TOKEN_KEY,value); setFeedback($('#loginFeedback'),'Validando…');
    try { await request('/api/admin/orders?limit=1'); showDashboard(); $('#adminToken').value=''; await loadAll(); }
    catch(error){sessionStorage.removeItem(TOKEN_KEY);setFeedback($('#loginFeedback'),error.message,'bad')}
  }

  async function loadAll() { await Promise.all([loadOrders(),loadCustomers(),loadCatalog(),loadCoupons(),loadProducts(),checkHealth()]); }

  function bind() {
    $('#loginForm').addEventListener('submit',login);
    $('#logoutButton').addEventListener('click',()=>{sessionStorage.removeItem(TOKEN_KEY);orders=[];customers=[];catalog=null;showLogin('Sessão encerrada.');});
    $('#refreshButton').addEventListener('click',loadAll);
    let searchTimer; $('#orderSearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadOrders,300)}); $('#orderStatus').addEventListener('change',loadOrders);
    let customerTimer; $('#customerSearch')?.addEventListener('input',()=>{clearTimeout(customerTimer);customerTimer=setTimeout(loadCustomers,300)});
    $('#ordersBody').addEventListener('click',event=>{const button=event.target.closest('[data-order-id]');if(button)openOrder(button.dataset.orderId)});
    $('#closeDialog').addEventListener('click',()=>$('#orderDialog').close()); $('#saveStatusButton').addEventListener('click',saveStatus); $('#saveShippingButton').addEventListener('click',saveShipping); $('#saveTrackingButton').addEventListener('click',saveTracking);
    $('#productsBody')?.addEventListener('click',event=>{const button=event.target.closest('[data-product-id]');if(!button)return;const product=products.find(p=>p.id===button.dataset.productId);if(product)openProductDialog(product)});
    $('#productForm')?.addEventListener('submit',saveProduct);
    $('#closeProductDialog')?.addEventListener('click',()=>$('#productDialog').close());
    $('#couponForm')?.addEventListener('submit',addCoupon);
    $('#couponType')?.addEventListener('change',()=>{const type=$('#couponType').value;const label=$('#couponValueLabel');const input=$('#couponValue');if(type==='free_shipping'){label.style.opacity='.45';input.disabled=true;input.value=''}else{label.style.opacity='';input.disabled=false;input.placeholder=type==='percent'?'10':'10,00'}});
    $('#couponsBody')?.addEventListener('click',event=>{
      const toggle=event.target.closest('[data-coupon-toggle]');
      if(toggle){const code=toggle.dataset.couponToggle;const next=coupons.map(c=>c.code===code?{...c,active:!c.active}:c);saveCoupons(next,`Cupom ${code} atualizado.`);return}
      const remove=event.target.closest('[data-coupon-remove]');
      if(remove){const code=remove.dataset.couponRemove;if(!confirm(`Excluir o cupom ${code}?`))return;saveCoupons(coupons.filter(c=>c.code!==code),`Cupom ${code} excluído.`)}
    });
    $('#exportOrdersButton').addEventListener('click',exportOrders); $('#downloadCatalogButton').addEventListener('click',downloadCatalog);
    $('#catalogFile').addEventListener('change',event=>{const file=event.target.files?.[0];if(file)importCatalog(file);event.target.value=''});
  }

  async function init(){bind();checkHealth();if(token()){showDashboard();try{await loadAll()}catch{}}else showLogin()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
