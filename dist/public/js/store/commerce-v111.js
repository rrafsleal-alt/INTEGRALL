(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const app = globalThis.__integrallApp;
  const api = globalThis.IntegrallApi;
  if (!app || !api) return;

  const state = {authenticated:false, account:null, csrfToken:'', orders:[], pendingEmail:'', activeProductId:'', reviewRequest:0, accountOpener:null, pendingFavoriteId:'', sessionEpoch:0, sessionRead:0, accountView:0, authBusy:false, profileBusy:false, profileWrite:0, favoriteBusy:false, waitingForAuth:false};
  const sessionNoticeKey = 'integrall-customer-session-change';
  const create = (tag, cls='', text='') => { const node=document.createElement(tag); if(cls)node.className=cls; if(text!==undefined&&text!=='')node.textContent=text; return node; };
  const money = value => app.money(Number(value)||0);
  const statusLabels = {received:'Recebido',awaiting_payment:'Aguardando pagamento',paid:'Pago',payment_failed:'Falha no pagamento',payment_expired:'Pagamento expirado',payment_review:'Em revisão',preparing:'Preparando',ready:'Pronto',completed:'Concluído',refunded:'Reembolsado',chargeback:'Contestação',cancelled:'Cancelado'};

  async function request(path, options={}) {
    const headers={...(options.headers||{})};
    if(options.csrf && state.csrfToken) headers['x-customer-csrf']=state.csrfToken;
    return api.request(path,{...options,headers});
  }
  function setFeedback(selector,message,type=''){const node=$(selector);if(!node)return;node.textContent=message||'';node.className=`commerce-feedback${type?` ${type}`:''}`;}
  function accountFocusables(){const modal=$('#accountModal .account-panel');if(!modal)return[];return[...modal.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(node=>!node.hidden&&node.offsetParent!==null)}
  function accountOpen(open=true,{restoreFocus=true}={}) {
    const modal=$('#accountModal'); if(!modal)return;
    state.accountView++;state.waitingForAuth=false;
    if(open) {
      state.accountOpener=document.activeElement instanceof HTMLElement?document.activeElement:null;
      app.closeProductDetails?.({returnFocus:false,updateHistory:true});app.closeCart?.({returnFocus:false});
      modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.classList.add('lock');
      $('#openAccount')?.setAttribute('aria-expanded','true');
      setTimeout(()=>{if(modal.classList.contains('open'))accountFocusables()[0]?.focus({preventScroll:true})},30);
      return;
    }
    modal.classList.remove('open');modal.setAttribute('aria-hidden','true');
    if(!$('#cartDrawer')?.classList.contains('open')&&!$('#overlay')?.classList.contains('open'))document.body.classList.remove('lock');
    $('#openAccount')?.setAttribute('aria-expanded','false');state.pendingFavoriteId='';
    const previous=state.accountOpener;state.accountOpener=null;
    if(restoreFocus){const target=previous?.isConnected&&previous.offsetParent!==null?previous:$('#openAccount');
      setTimeout(()=>{if(!modal.classList.contains('open')&&!$('#cartDrawer')?.classList.contains('open'))target?.focus?.({preventScroll:true})},20)}
  }
  function accountButton(){const button=$('#openAccount');if(button){button.classList.toggle('has-session',state.authenticated);button.title=state.authenticated?`Minha conta — ${state.account?.email||''}`:'Entrar na minha conta';button.setAttribute('aria-expanded',String($('#accountModal')?.classList.contains('open')||false));}}
  function syncCheckoutFromAccount(){if(!state.authenticated||!state.account)return;const name=$('#customerName'),email=$('#customerEmail'),phone=$('#customerPhone');if(name&&!name.value&&state.account.name){name.value=state.account.name;name.dispatchEvent(new Event('input',{bubbles:true}))}if(email&&!email.value)email.value=state.account.email||'';if(phone&&!phone.value)phone.value=state.account.phone||'';const address=(state.account.addresses||[])[0];if(address&&app.getState().checkout.choice==='delivery'){const map={deliveryStreet:'street',deliveryNumber:'number',deliveryNeighborhood:'neighborhood',deliveryComplement:'complement',deliveryCity:'city',deliveryState:'state'};for(const[id,key]of Object.entries(map)){const input=$('#'+id);if(input&&!input.value)input.value=address[key]||''}const cep=$('#modalCep');if(cep&&!cep.value&&address.cep)cep.value=app.cepMask(address.cep)}}

  function syncAccountState(){accountButton();syncFavoriteButton();syncReviewForm();syncRestockBox()}
  function clearSession(){
    state.sessionEpoch++;state.sessionRead++;state.profileWrite++;state.profileBusy=false;
    state.authenticated=false;state.account=null;state.csrfToken='';state.orders=[];
    syncAccountState();
  }
  function settleAccountWait(){if(state.waitingForAuth&&!state.authBusy&&$('#accountModal')?.classList.contains('open')){state.waitingForAuth=false;void openAccount()}}
  function notifySessionChange(){
    // Cross-tab signal contains no email, password, session token or CSRF token.
    try{localStorage.setItem(sessionNoticeKey,`${Date.now()}-${Math.random()}`)}catch{}
  }
  async function loadSession(){
    if(state.authBusy)return false;
    const epoch=state.sessionEpoch,read=++state.sessionRead;
    try{
      const data=await request('/api/account/session');
      if(epoch!==state.sessionEpoch||read!==state.sessionRead||state.authBusy)return false;
      const authenticated=data.authenticated===true&&typeof data.account?.email==='string'&&Boolean(data.csrfToken);
      if(!authenticated){if(state.authenticated||state.account||state.csrfToken)clearSession();else syncAccountState();return true}
      if(!state.authenticated||state.account?.email!==data.account.email||state.csrfToken!==data.csrfToken){
        state.sessionEpoch++;state.profileWrite++;state.profileBusy=false;state.orders=[];
      }
      state.authenticated=true;state.account=data.account;state.csrfToken=data.csrfToken;
      syncCheckoutFromAccount();syncAccountState();return true;
    }catch{
      if(epoch!==state.sessionEpoch||read!==state.sessionRead||state.authBusy)return false;
      if(state.authenticated||state.account||state.csrfToken)clearSession();else syncAccountState();return true;
    }
  }

  function inputLabel(label,type='text',value='',attrs={}){const wrap=create('label');wrap.textContent=label;const input=create('input','field');input.type=type;input.value=value||'';Object.entries(attrs).forEach(([key,val])=>input.setAttribute(key,val));wrap.append(input);return{wrap,input};}

  function renderLogin(){
    const view=++state.accountView,root=$('#accountContent');root.replaceChildren();
    root.append(create('p','', 'Acesse sem senha. Enviaremos um código de 6 dígitos para o seu e-mail.'));
    const form=create('form','account-login-form');form.id='accountLoginForm';
    const email=inputLabel('E-mail','email',state.pendingEmail,{autocomplete:'email',maxlength:'254',required:''});email.input.id='accountLoginEmail';
    const button=create('button','btn primary','Enviar código');button.type='submit';
    const feedback=create('p','commerce-feedback');feedback.id='accountLoginFeedback';feedback.setAttribute('role','status');
    form.append(email.wrap,button,feedback);root.append(form);
    const current=()=>view===state.accountView&&form.isConnected;
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(button.disabled||!current())return;button.disabled=true;
      setFeedback('#accountLoginFeedback','Enviando…');const submittedEmail=email.input.value.trim();
      try{
        const data=await request('/api/account/login/request',{method:'POST',body:JSON.stringify({email:submittedEmail})});
        if(!current())return;state.pendingEmail=submittedEmail;renderCode(data.developmentCode||'');
      }catch(error){if(current())setFeedback('#accountLoginFeedback',error.message,'bad')}
      finally{if(current())button.disabled=false}
    });
  }

  async function applyPendingFavorite(){const id=state.pendingFavoriteId;if(!id||!state.authenticated||!state.account)return false;state.pendingFavoriteId='';const favorites=new Set(state.account.favorites||[]);if(favorites.has(id))return true;favorites.add(id);try{await saveProfile({favorites:[...favorites]});app.notify('Produto salvo nos favoritos.','ok');return true}catch(error){app.notify(error.message,'bad');return false}}

  function renderCode(developmentCode=''){
    const view=++state.accountView,email=state.pendingEmail,root=$('#accountContent');root.replaceChildren();
    root.append(create('p','',`Digite o código enviado para ${email}.`));
    const form=create('form','account-code-form');
    const code=inputLabel('Código de 6 dígitos','text','',{inputmode:'numeric',autocomplete:'one-time-code',maxlength:'6',pattern:'[0-9]{6}',required:''});code.input.id='accountCode';
    const button=create('button','btn primary','Entrar');button.type='submit';
    const back=create('button','btn ghost small','Usar outro e-mail');back.type='button';
    const feedback=create('p','commerce-feedback');feedback.id='accountCodeFeedback';feedback.setAttribute('role','status');
    form.append(code.wrap,button,back,feedback);root.append(form);
    if(developmentCode){root.append(create('p','reservation-notice',`Ambiente local: código ${developmentCode}`));code.input.value=developmentCode}
    const current=()=>view===state.accountView&&form.isConnected;
    back.addEventListener('click',()=>{if(!state.authBusy)renderLogin()});
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(button.disabled||state.authBusy||!current())return;
      if(!/^[0-9]{6}$/.test(code.input.value)){setFeedback('#accountCodeFeedback','Informe os 6 dígitos do código.','bad');return}
      button.disabled=true;back.disabled=true;state.authBusy=true;
      const epoch=++state.sessionEpoch;state.sessionRead++;
      try{
        const data=await request('/api/account/login/verify',{method:'POST',body:JSON.stringify({email,code:code.input.value})});
        if(epoch!==state.sessionEpoch||!current())return;
        if(data.authenticated!==true||typeof data.account?.email!=='string'||!data.csrfToken)throw new Error('Resposta de acesso inválida. Tente novamente.');
        state.authenticated=true;state.account=data.account;state.csrfToken=data.csrfToken;state.authBusy=false;
        syncAccountState();syncCheckoutFromAccount();notifySessionChange();await applyPendingFavorite();
        if(epoch===state.sessionEpoch&&current())renderAccount();
      }catch(error){if(epoch===state.sessionEpoch&&current())setFeedback('#accountCodeFeedback',error.message,'bad')}
      finally{if(epoch===state.sessionEpoch)state.authBusy=false;if(current()){button.disabled=false;back.disabled=false}settleAccountWait()}
    });
  }

  async function saveProfile(patch){
    if(!state.authenticated||state.authBusy)throw new Error('Entre na sua conta para continuar.');
    if(state.profileBusy)throw new Error('Aguarde a conclusão da alteração anterior.');
    const epoch=state.sessionEpoch,email=state.account.email,write=++state.profileWrite;
    state.profileBusy=true;
    try{
      const data=await request('/api/account/profile',{method:'PATCH',csrf:true,body:JSON.stringify(patch)});
      if(epoch!==state.sessionEpoch||!state.authenticated||write!==state.profileWrite)throw new Error('A sessão mudou. Reabra sua conta para conferir os dados.');
      if(data.account?.email!==email)throw new Error('Resposta de perfil inválida. Atualize sua conta.');
      state.account=data.account;accountButton();syncCheckoutFromAccount();return data.account;
    }catch(error){
      if(error.status===401&&epoch===state.sessionEpoch){clearSession();renderLogin()}
      throw error;
    }finally{if(write===state.profileWrite)state.profileBusy=false}
  }

  function appendAccountSection(root,title){const section=create('section','account-section');section.append(create('h3','',title));root.append(section);return section;}

  async function renderAccount(){
    if(!state.authenticated){renderLogin();return}
    const view=++state.accountView,epoch=state.sessionEpoch;
    const root=$('#accountContent');root.replaceChildren();const hello=create('p','',state.account?.name?`Olá, ${state.account.name}.`:`Conectado como ${state.account?.email||''}.`);root.append(hello);
    const profile=appendAccountSection(root,'Dados pessoais');const form=create('form','account-profile-form');const name=inputLabel('Nome','text',state.account?.name||'',{maxlength:'80',autocomplete:'name'});const phone=inputLabel('Telefone','tel',state.account?.phone||'',{maxlength:'30',autocomplete:'tel'});const email=create('p','reservation-notice',`E-mail: ${state.account?.email||''}`);const save=create('button','btn primary','Salvar dados');save.type='submit';const feedback=create('p','commerce-feedback');feedback.id='accountProfileFeedback';form.append(name.wrap,phone.wrap,email,save,feedback);profile.append(form);
    form.addEventListener('submit',async event=>{event.preventDefault();if(save.disabled)return;save.disabled=true;try{await saveProfile({name:name.input.value,phone:phone.input.value});if(view!==state.accountView||epoch!==state.sessionEpoch)return;setFeedback('#accountProfileFeedback','Dados salvos.','ok')}catch(error){if(view===state.accountView&&epoch===state.sessionEpoch)setFeedback('#accountProfileFeedback',error.message,'bad')}finally{save.disabled=false}});

    renderAddresses(root);
    void renderOrders(root,view,epoch);
    renderFavorites(root);
    const actions=appendAccountSection(root,'Sessão');const logout=create('button','btn ghost small','Sair desta conta');logout.type='button';actions.append(logout);
    logout.addEventListener('click',async()=>{
      if(logout.disabled||state.authBusy)return;logout.disabled=true;state.authBusy=true;
      const operation=++state.sessionEpoch;state.sessionRead++;
      try{
        await request('/api/account/logout',{method:'POST',csrf:true});
        if(operation!==state.sessionEpoch)return;
        clearSession();state.authBusy=false;renderLogin();notifySessionChange();
      }catch(error){
        if(operation!==state.sessionEpoch)return;
        if(error.status===401){clearSession();state.authBusy=false;renderLogin();notifySessionChange()}
        else {state.authBusy=false;app.notify('Não foi possível sair da conta. Verifique a conexão e tente novamente.','bad');if(view===state.accountView)renderAccount()}
      }finally{if(operation===state.sessionEpoch)state.authBusy=false;logout.disabled=false;settleAccountWait()}
    });
  }

  function renderAddresses(root){
    const section=appendAccountSection(root,'Endereços');const list=create('div');(state.account?.addresses||[]).forEach(address=>{const card=create('div','account-address');card.append(create('strong','',address.label||'Endereço'),create('p','',`${address.street}, ${address.number}${address.complement?` — ${address.complement}`:''}`),create('p','',`${address.neighborhood?`${address.neighborhood} — `:''}${address.city}/${address.state} · ${app.cepMask(address.cep||'')}`));const remove=create('button','btn ghost small','Remover');remove.type='button';remove.addEventListener('click',async()=>{const addresses=(state.account.addresses||[]).filter(item=>item.id!==address.id);try{await saveProfile({addresses});await renderAccount()}catch(error){app.notify(error.message,'bad')}});card.append(remove);list.append(card)});section.append(list);
    const details=create('details');const summary=create('summary','', 'Adicionar endereço');details.append(summary);const form=create('form','account-profile-form');const fields=[['Identificação','label','Casa'],['CEP','cep',''],['Rua / avenida','street',''],['Número','number',''],['Complemento','complement',''],['Bairro','neighborhood',''],['Cidade','city',''],['UF','state','']];const refs={};fields.forEach(([label,key,value])=>{const item=inputLabel(label,'text',value,{maxlength:key==='state'?'2':key==='cep'?'9':'180'});refs[key]=item.input;form.append(item.wrap)});const add=create('button','btn outline small','Adicionar endereço');add.type='submit';const feedback=create('p','commerce-feedback');form.append(add,feedback);details.append(form);section.append(details);form.addEventListener('submit',async event=>{event.preventDefault();const address=Object.fromEntries(Object.entries(refs).map(([key,input])=>[key,input.value.trim()]));address.id=`addr-${Date.now()}`;address.cep=app.digits(address.cep);address.state=address.state.toUpperCase();if(!/^[0-9]{8}$/.test(address.cep)||!address.street||!address.number||!address.city||!/^[A-Z]{2}$/.test(address.state)){feedback.textContent='Preencha CEP com 8 dígitos, rua, número, cidade e UF.';return}if((state.account.addresses||[]).length>=5){feedback.textContent='Você pode salvar até 5 endereços. Remova um antes de adicionar outro.';return}if(add.disabled)return;add.disabled=true;try{await saveProfile({addresses:[...(state.account.addresses||[]),address]});await renderAccount()}catch(error){feedback.textContent=error.message}finally{add.disabled=false}});
  }

  async function renderOrders(root,view,epoch){
    const section=appendAccountSection(root,'Meus pedidos');const current=()=>section.isConnected&&view===state.accountView&&epoch===state.sessionEpoch&&state.authenticated;const loading=create('p','reservation-notice','Carregando pedidos…');section.append(loading);try{const data=await request('/api/account/orders');if(!current())return;state.orders=Array.isArray(data.orders)?data.orders:[];loading.remove();if(!state.orders.length){section.append(create('p','reservation-notice','Você ainda não possui pedidos vinculados a este e-mail.'));return}state.orders.forEach(order=>{const card=create('article','account-order');const head=create('div','account-order-head');head.append(create('strong','',order.id),create('span','',statusLabels[order.status]||order.status));card.append(head,create('span','',`${new Date(order.createdAt).toLocaleDateString('pt-BR')} · ${money(order.totalCents)}`));const lines=create('div','account-order-lines',(order.items||[]).map(item=>`${item.qty}× ${item.name}${item.variant?` — ${item.variant}`:''}`).join(' · '));card.append(lines);if(order.canReorder){const again=create('button','btn outline small','Comprar novamente');again.type='button';again.addEventListener('click',async()=>{again.disabled=true;try{const result=await request('/api/account/reorder',{method:'POST',csrf:true,body:JSON.stringify({orderId:order.id})});if(!current())return;const added=app.addReorderItems(result.items);if(added.added)accountOpen(false,{restoreFocus:false})}catch(error){app.notify(error.message,'bad')}finally{again.disabled=false}});card.append(again)}section.append(card)})}catch(error){if(!current())return;if(error.status===401){clearSession();renderLogin()}else loading.textContent=error.message;}
  }

  function renderFavorites(root){
    const section=appendAccountSection(root,'Favoritos');const ids=state.account?.favorites||[];const products=ids.map(id=>app.getProduct(id)).filter(Boolean);if(!products.length){section.append(create('p','reservation-notice','Nenhum produto salvo ainda. Use ♡ nos detalhes de um produto.'));return}const grid=create('div','account-favorites');products.forEach(product=>{const button=create('button','account-favorite');button.type='button';button.append(create('strong','',product.name),create('div','',app.productPriceLabel(product)));button.addEventListener('click',()=>{accountOpen(false,{restoreFocus:false});app.openProduct(product.id,{updateHash:true})});grid.append(button)});section.append(grid);
  }

  async function toggleFavorite(){
    const product=app.getProduct(state.activeProductId||app.getState().activeId);if(!product)return;if(!state.authenticated){state.pendingFavoriteId=product.id;accountOpen(true);renderLogin();return}const favorites=new Set(state.account?.favorites||[]);favorites.has(product.id)?favorites.delete(product.id):favorites.add(product.id);try{await saveProfile({favorites:[...favorites]});syncFavoriteButton();app.notify(favorites.has(product.id)?'Produto salvo nos favoritos.':'Produto removido dos favoritos.','ok')}catch(error){app.notify(error.message,'bad')}
  }
  function syncFavoriteButton(){const button=$('#modalFavorite');if(!button)return;const id=state.activeProductId||app.getState().activeId;const saved=Boolean(state.authenticated&&state.account?.favorites?.includes(id));button.classList.toggle('is-favorite',saved);button.textContent=saved?'♥':'♡';button.setAttribute('aria-label',saved?'Remover dos favoritos':'Salvar nos favoritos')}

  function stars(rating){return '★'.repeat(Math.max(0,Math.min(5,Number(rating)||0)))+'☆'.repeat(Math.max(0,5-(Number(rating)||0)))}
  async function loadReviews(productId){
    const requestId=++state.reviewRequest;const list=$('#reviewsList'),summary=$('#reviewsSummary');if(!list||!summary||!productId)return;list.replaceChildren();summary.textContent='Carregando…';try{const data=await request(`/api/products/${encodeURIComponent(productId)}/reviews`);if(requestId!==state.reviewRequest||state.activeProductId!==productId)return;const count=Number(data.summary?.count)||0,average=Number(data.summary?.average)||0;summary.textContent=count?`★ ${average.toFixed(1).replace('.',',')} · ${count} avaliação(ões)`:'Sem avaliações ainda';(data.reviews||[]).forEach(review=>{const item=create('article','review-item');const head=create('div','review-item-head');const who=create('strong','',review.author||'Cliente INTEGRALL');const rating=create('span','review-stars',stars(review.rating));head.append(who,rating);item.append(head);if(review.title)item.append(create('strong','',review.title));if(review.body)item.append(create('p','',review.body));if(review.verified)item.append(create('small','', 'Compra verificada'));list.append(item)});if(!count)list.append(create('p','reservation-notice','Seja o primeiro cliente verificado a avaliar este produto.'));}
    catch(error){if(requestId!==state.reviewRequest||state.activeProductId!==productId)return;summary.textContent='Não foi possível carregar avaliações.';list.append(create('p','reservation-notice',error.message))}
    if(requestId===state.reviewRequest&&state.activeProductId===productId)syncReviewForm();
  }
  function syncReviewForm(){const form=$('#reviewForm'),note=$('#reviewLoginNote');if(!form||!note)return;form.hidden=!state.authenticated;note.hidden=state.authenticated;}
  async function submitReview(event) {
    event.preventDefault();
    if(!state.authenticated){accountOpen(true);renderLogin();return;}
    const productId=state.activeProductId||app.getState().activeId;if(!productId)return;
    const form=event.currentTarget,button=form.querySelector('button[type=submit]');
    if(button.disabled)return;
    const viewVersion=state.reviewRequest;
    const isCurrent=()=>state.activeProductId===productId&&state.reviewRequest===viewVersion;
    button.disabled=true;setFeedback('#reviewFeedback','Enviando…');
    try {
      const data=await request(`/api/products/${encodeURIComponent(productId)}/reviews`,{method:'POST',csrf:true,body:JSON.stringify({rating:Number($('#reviewRating').value),title:$('#reviewTitle').value,body:$('#reviewBody').value})});
      if(isCurrent()){setFeedback('#reviewFeedback',data.message||'Avaliação enviada.','ok');form.reset();}
    } catch(error){if(isCurrent())setFeedback('#reviewFeedback',error.message,'bad');}
    finally{if(isCurrent())button.disabled=false;}
  }

  function syncRestockBox(){
    const box=$('#restockAlertBox');if(!box)return;const product=app.getProduct(state.activeProductId||app.getState().activeId);if(!product){box.hidden=true;return}const variantId=$('#modalVariant')?.value||'';const stock=app.stockLimit(product,variantId);const controlled=Number.isFinite(stock);box.hidden=!(controlled&&stock===0);const email=$('#restockEmail');if(email&&!email.value&&state.account?.email)email.value=state.account.email;
  }
  async function submitRestock(event) {
    event.preventDefault();
    const product=app.getProduct(state.activeProductId||app.getState().activeId);if(!product)return;
    const button=event.currentTarget.querySelector('button');if(button.disabled)return;
    const variantId=$('#modalVariant')?.value||'',viewVersion=state.reviewRequest;
    const sameView=()=>state.activeProductId===product.id&&state.reviewRequest===viewVersion;
    const sameSelection=()=>sameView()&&($('#modalVariant')?.value||'')===variantId;
    button.disabled=true;setFeedback('#restockFeedback','Registrando…');
    try {
      await request('/api/stock-alerts',{method:'POST',body:JSON.stringify({email:$('#restockEmail').value,productId:product.id,variantId})});
      if(sameSelection())setFeedback('#restockFeedback','Pronto. Vamos avisar por e-mail quando voltar.','ok');
    }catch(error){if(sameSelection())setFeedback('#restockFeedback',error.message,'bad');}
    finally{if(sameView())button.disabled=false;}
  }

  async function openAccount(){
    state.pendingFavoriteId='';accountOpen(true);
    const view=state.accountView;
    $('#accountContent').replaceChildren(create('p','reservation-notice','Verificando sua conta…'));
    if(state.authBusy){state.waitingForAuth=true;return}
    const applied=await loadSession();
    if(applied&&view===state.accountView&&$('#accountModal')?.classList.contains('open'))renderAccount();
  }
  let lastRevalidation=0;
  async function revalidateAccount(){
    if(document.hidden||state.authBusy||Date.now()-lastRevalidation<750)return;
    lastRevalidation=Date.now();const epoch=state.sessionEpoch,view=state.accountView;
    const applied=await loadSession();
    if(applied&&epoch!==state.sessionEpoch&&view===state.accountView&&$('#accountModal')?.classList.contains('open'))renderAccount();
  }
  window.addEventListener('focus',revalidateAccount);
  window.addEventListener('pageshow',event=>{if(event.persisted)void revalidateAccount()});
  document.addEventListener('visibilitychange',revalidateAccount);
  window.addEventListener('storage',event=>{if(event.key===sessionNoticeKey){lastRevalidation=0;void revalidateAccount()}});
  $('#openAccount')?.addEventListener('click',openAccount);$('#closeAccount')?.addEventListener('click',()=>accountOpen(false));$('#accountBackdrop')?.addEventListener('click',()=>accountOpen(false));$('#modalFavorite')?.addEventListener('click',toggleFavorite);$('#reviewForm')?.addEventListener('submit',submitReview);$('#restockAlertForm')?.addEventListener('submit',submitRestock);
  document.addEventListener('integrall:close-account',event=>{if($('#accountModal')?.classList.contains('open'))accountOpen(false,{restoreFocus:event.detail?.restoreFocus!==false})});
  document.addEventListener('keydown',event=>{if(!$('#accountModal')?.classList.contains('open'))return;if(event.key==='Escape'){event.preventDefault();accountOpen(false);return}if(event.key!=='Tab')return;const items=accountFocusables();if(!items.length){event.preventDefault();return}const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}});
  document.addEventListener('integrall:product-opened',event=>{state.activeProductId=event.detail?.productId||'';syncFavoriteButton();syncRestockBox();loadReviews(state.activeProductId)});
  document.addEventListener('integrall:product-closed',()=>{state.activeProductId='';state.reviewRequest++;$('#reviewsList')?.replaceChildren();const summary=$('#reviewsSummary');if(summary)summary.textContent='';syncFavoriteButton();syncRestockBox()});
  document.addEventListener('integrall:variant-changed',()=>syncRestockBox());
  loadSession();
})();
