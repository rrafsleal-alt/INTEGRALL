const __integrallData=JSON.parse(document.getElementById('buildData').textContent);globalThis.__integrallApp=(function createCatalogApp({embedded = {}, publicMode = false, onSecret = null} = {}) {

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const moneyFormatter = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'});
  const money = cents => { const value = Number(cents); return moneyFormatter.format(Number.isFinite(value) && value >= 0 && value <= 999999999999 ? value / 100 : 0); };
  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const digits = value => String(value || '').replace(/\D/g, '');
  const cepMask = value => { const d = digits(value).slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
  const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const el = (tag, className = '', text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const safeStore = {
    get(key, fallback) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
    del(key) { try { localStorage.removeItem(key); } catch {} }
  };
  const sessionStore = {
    get(key, fallback) { try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } },
    set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
    del(key) { try { sessionStorage.removeItem(key); } catch {} }
  };



  const VISUAL_FONT_STACKS = Object.freeze({
    modern: 'Arial, Helvetica, sans-serif',
    system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    humanist: '"Trebuchet MS", "Segoe UI", Arial, sans-serif',
    geometric: 'Avenir, "Avenir Next", Futura, Arial, sans-serif',
    editorial: 'Georgia, "Times New Roman", serif',
    classic: 'Garamond, Baskerville, Georgia, serif',
    slab: 'Rockwell, "Roboto Slab", Georgia, serif',
    mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
  });
  const VISUAL_DEFAULTS = {
    version: 1, preset: 'classic',
    assets: {headerLogo:'',footerLogo:'',favicon:'',heroBackground:'',headerBackground:'',footerBackground:'',pageBackground:''},
    colors: {
      page:'#ffffff',surface:'#ffffff',surfaceAlt:'#faf9f7',surfaceMuted:'#f4f1ec',primary:'#4a0a1a',primaryHover:'#681126',accent:'#aa8952',
      text:'#211e1c',muted:'#77716c',line:'#e9e4dd',danger:'#a02c35',success:'#276447',buttonText:'#ffffff',headerBackground:'#ffffff',
      footerBackground:'#ffffff',cardBackground:'#ffffff',inputBackground:'#ffffff',heroText:'#4a0a1a',heroOverlay:'rgba(0,0,0,.28)',
      headerText:'#4a0a1a',headerMuted:'#3d3835',footerText:'#77716c',footerMuted:'#746f6b',footerHeading:'#4a0a1a',footerAccent:'#aa8952',
      price:'#302c29',badgeBackground:'rgba(255,255,255,.94)',badgeText:'#4a0a1a',outOfStockBackground:'rgba(74,10,26,.9)',outOfStockText:'#ffffff',overlay:'rgba(31,25,23,.38)'
    },
    typography: {bodyFont:'modern',headingFont:'editorial',customBody:'',customHeading:'',baseSize:16,bodyWeight:400,headingWeight:400,lineHeight:1.55,headingScale:1,navSize:11,navSpacing:.15,brandSpacing:.25,navTransform:'uppercase'},
    layout: {
      maxWidth:1240,gutterDesktop:56,gutterMobile:28,headerLayout:'centered',headerSticky:false,headerPadding:48,navGap:40,
      headerOrder:['brand','nav','actions'],catalogAlign:'center',catalogTop:48,catalogBottom:78,introMaxWidth:710,blocks:['intro','filters','products'],
      toolbarLayout:'columns',gridColumnsDesktop:3,gridColumnsTablet:2,gridColumnsMobile:1,gridGapX:34,gridGapY:48,cardStyle:'minimal',cardAlign:'center',
      cardPadding:0,imageRatio:'portrait',imageFit:'cover',radius:0,buttonRadius:0,inputRadius:0,shadow:'none',footerAlign:'center',footerOrder:['logo','description','contact'],
      headerLogoMode:'text',footerLogoMode:'text',headerLogoWidth:220,footerLogoWidth:170,heroMode:'plain',heroPadding:0,heroRadius:0,animations:true
    },
    visibility: {category:true,unit:true,stock:true,quickAdd:true,search:true,filters:true,resultCount:true,footerDescription:true,footerContact:true},
    customCss:''
  };
  const visualClone = value => JSON.parse(JSON.stringify(value));
  const visualClamp = (value, min, max, fallback, integer = false) => { const number = Number(value); if (!Number.isFinite(number)) return fallback; const safe = Math.min(max, Math.max(min, number)); return integer ? Math.round(safe) : Math.round(safe * 1000) / 1000; };
  const safeVisualColor = (value, fallback) => {
    const text = String(value || '').trim().slice(0, 64);
    if (!text || /[;{}<>]/.test(text)) return fallback;
    try { return globalThis.CSS?.supports?.('color', text) ? text : fallback; } catch { return fallback; }
  };
  const VISUAL_ASSET_MAX_CHARS = 300 * 1024, VISUAL_ASSET_TOTAL_CHARS = 1550 * 1024;
  const safeVisualImage = value => typeof value === 'string' && value.length <= VISUAL_ASSET_MAX_CHARS && (/^data:image\/(?:png|jpeg|jpg|webp|gif|avif)(?:;[^,]*)?,/i.test(value) || /^https:\/\/[^\s]+$/i.test(value) || /^\/assets\/[A-Za-z0-9._\/-]+$/.test(value)) ? value : '';
  const safeVisualFont = value => { const text = String(value || '').trim().slice(0, 160); return text && /^[A-Za-zÀ-ÿ0-9 _,-]+$/.test(text) ? text : ''; };
  function safeVisualCss(value) {
    const text = String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, 20000);
    if (!text) return '';
    const blocked = /(?:<\/?style|<\/?script|@import|@font-face|@keyframes|@namespace|expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding|url\s*\(|!important|\\0|#catalogSurface\b|#admin\b|#authModal\b|\.admin(?:\b|[-_])|\[data-panel\b|position\s*:\s*fixed\b|z-index\s*:)/i;
    if (blocked.test(text) || text.includes('@')) return '';
    const opens = (text.match(/\{/g) || []).length, closes = (text.match(/\}/g) || []).length;
    if (!opens || opens !== closes) return '';
    let consumed = ''; const rule = /([^{}]+)\{([^{}]*)\}/g; let match;
    while ((match = rule.exec(text))) consumed += match[0];
    return consumed.replace(/\s+/g, '') === text.replace(/\s+/g, '') ? text : '';
  }
  const visualOrder = (value, allowed, fallback) => {
    const list = Array.isArray(value) ? value.filter(item => allowed.includes(item)) : [];
    return list.length === allowed.length && new Set(list).size === allowed.length ? list : [...fallback];
  };
  function normalizeVisual(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const v = visualClone(VISUAL_DEFAULTS); v.version = 1; v.preset = ['classic','editorial','modern','minimal','dark','nature'].includes(source.preset) ? source.preset : v.preset;
    const assets = source.assets && typeof source.assets === 'object' && !Array.isArray(source.assets) ? source.assets : {};
    let visualAssetTotal = 0;
    Object.keys(v.assets).forEach(key => { const candidate = safeVisualImage(assets[key]); const size = candidate.startsWith('data:') ? candidate.length : 0; v.assets[key] = candidate && visualAssetTotal + size <= VISUAL_ASSET_TOTAL_CHARS ? candidate : ''; visualAssetTotal += v.assets[key].startsWith('data:') ? v.assets[key].length : 0; });
    const colors = source.colors && typeof source.colors === 'object' && !Array.isArray(source.colors) ? source.colors : {};
    Object.keys(v.colors).forEach(key => v.colors[key] = safeVisualColor(colors[key], v.colors[key]));
    const type = source.typography && typeof source.typography === 'object' && !Array.isArray(source.typography) ? source.typography : {};
    v.typography.bodyFont = Object.hasOwn(VISUAL_FONT_STACKS, type.bodyFont) ? type.bodyFont : v.typography.bodyFont;
    v.typography.headingFont = Object.hasOwn(VISUAL_FONT_STACKS, type.headingFont) ? type.headingFont : v.typography.headingFont;
    v.typography.customBody = safeVisualFont(type.customBody); v.typography.customHeading = safeVisualFont(type.customHeading);
    v.typography.baseSize = visualClamp(type.baseSize, 12, 22, v.typography.baseSize, true); v.typography.bodyWeight = visualClamp(type.bodyWeight, 300, 800, v.typography.bodyWeight, true);
    v.typography.headingWeight = visualClamp(type.headingWeight, 300, 800, v.typography.headingWeight, true); v.typography.lineHeight = visualClamp(type.lineHeight, 1.1, 2.1, v.typography.lineHeight);
    v.typography.headingScale = visualClamp(type.headingScale, .75, 1.5, v.typography.headingScale); v.typography.navSize = visualClamp(type.navSize, 9, 18, v.typography.navSize, true);
    v.typography.navSpacing = visualClamp(type.navSpacing, 0, .45, v.typography.navSpacing); v.typography.brandSpacing = visualClamp(type.brandSpacing, 0, .5, v.typography.brandSpacing);
    v.typography.navTransform = ['none','uppercase','capitalize'].includes(type.navTransform) ? type.navTransform : v.typography.navTransform;
    const layout = source.layout && typeof source.layout === 'object' && !Array.isArray(source.layout) ? source.layout : {};
    for (const [key,min,max,integer] of [['maxWidth',760,1800,1],['gutterDesktop',20,120,1],['gutterMobile',12,60,1],['headerPadding',12,100,1],['navGap',8,80,1],['catalogTop',16,140,1],['catalogBottom',20,160,1],['introMaxWidth',420,1200,1],['gridColumnsDesktop',1,6,1],['gridColumnsTablet',1,4,1],['gridColumnsMobile',1,2,1],['gridGapX',0,80,1],['gridGapY',0,100,1],['cardPadding',0,40,1],['radius',0,40,1],['buttonRadius',0,40,1],['inputRadius',0,40,1],['headerLogoWidth',60,480,1],['footerLogoWidth',60,360,1],['heroPadding',0,120,1],['heroRadius',0,60,1]]) v.layout[key] = visualClamp(layout[key], min, max, v.layout[key], !!integer);
    v.layout.headerLayout = ['centered','split','compact'].includes(layout.headerLayout) ? layout.headerLayout : v.layout.headerLayout; v.layout.headerSticky = layout.headerSticky === true;
    v.layout.headerOrder = visualOrder(layout.headerOrder, ['brand','nav','actions'], v.layout.headerOrder); v.layout.catalogAlign = ['left','center','right'].includes(layout.catalogAlign) ? layout.catalogAlign : v.layout.catalogAlign;
    v.layout.blocks = visualOrder(layout.blocks, ['intro','filters','products'], v.layout.blocks); v.layout.toolbarLayout = ['columns','stacked','compact'].includes(layout.toolbarLayout) ? layout.toolbarLayout : v.layout.toolbarLayout;
    v.layout.cardStyle = ['minimal','boxed','elevated','outlined'].includes(layout.cardStyle) ? layout.cardStyle : v.layout.cardStyle; v.layout.cardAlign = ['left','center','right'].includes(layout.cardAlign) ? layout.cardAlign : v.layout.cardAlign;
    v.layout.imageRatio = ['square','portrait','landscape','auto'].includes(layout.imageRatio) ? layout.imageRatio : v.layout.imageRatio; v.layout.imageFit = ['cover','contain'].includes(layout.imageFit) ? layout.imageFit : v.layout.imageFit;
    v.layout.shadow = ['none','soft','medium','strong'].includes(layout.shadow) ? layout.shadow : v.layout.shadow; v.layout.footerAlign = ['left','center','right'].includes(layout.footerAlign) ? layout.footerAlign : v.layout.footerAlign;
    v.layout.footerOrder = visualOrder(layout.footerOrder, ['logo','description','contact'], v.layout.footerOrder); v.layout.headerLogoMode = ['text','image','both'].includes(layout.headerLogoMode) ? layout.headerLogoMode : v.layout.headerLogoMode;
    v.layout.footerLogoMode = ['text','image','both'].includes(layout.footerLogoMode) ? layout.footerLogoMode : v.layout.footerLogoMode; v.layout.heroMode = ['plain','panel','image'].includes(layout.heroMode) ? layout.heroMode : v.layout.heroMode;
    v.layout.animations = layout.animations !== false;
    const visibility = source.visibility && typeof source.visibility === 'object' && !Array.isArray(source.visibility) ? source.visibility : {};
    Object.keys(v.visibility).forEach(key => v.visibility[key] = visibility[key] !== false);
    v.customCss = safeVisualCss(source.customCss); return v;
  }
  function scopeVisualCss(value) {
    const css = safeVisualCss(value); if (!css) return '';
    return css.replace(/([^{}]+)\{([^{}]*)\}/g, (_, selectorText, declarations) => {
      const selectors = selectorText.split(',').map(selector => {
        let item = selector.trim();
        if (!item) return '';
        item = item.replace(/^(?:(?:html|:root)\s+)?body\b/i, '#catalogSurface').replace(/^(?:html|:root)\b/i, '#catalogSurface');
        return item.startsWith('#catalogSurface') ? item : `#catalogSurface ${item}`;
      }).filter(Boolean);
      return selectors.length ? `${selectors.join(',')} {${declarations}}` : '';
    });
  }
  function buildVisualCss(raw) {
    const v = normalizeVisual(raw), c = v.colors, t = v.typography, l = v.layout, show = v.visibility;
    const bodyFont = t.customBody || VISUAL_FONT_STACKS[t.bodyFont] || VISUAL_FONT_STACKS.modern; const headingFont = t.customHeading || VISUAL_FONT_STACKS[t.headingFont] || VISUAL_FONT_STACKS.editorial;
    const ratio = {square:'1 / 1',portrait:'1 / 1.12',landscape:'4 / 3',auto:'auto'}[l.imageRatio];
    const shadow = {none:'none',soft:'0 8px 24px rgba(30,22,18,.08)',medium:'0 16px 38px rgba(30,22,18,.13)',strong:'0 22px 55px rgba(20,12,10,.2)'}[l.shadow];
    const orders = Object.fromEntries(l.headerOrder.map((key,index)=>[key,index+1])); const blocks = Object.fromEntries(l.blocks.map((key,index)=>[key,index+1])); const footer = Object.fromEntries(l.footerOrder.map((key,index)=>[key,index+1]));
    const cardBorder = l.cardStyle === 'outlined' || l.cardStyle === 'boxed' || l.cardStyle === 'elevated' ? `1px solid ${c.line}` : '0';
    const cardBackground = l.cardStyle === 'minimal' ? 'transparent' : c.cardBackground; const cardShadow = l.cardStyle === 'elevated' ? shadow : 'none';
    const headerFlex = l.headerLayout === 'centered' ? 'column' : 'row'; const headerAlign = 'center';
    const toolbarColumns = l.toolbarLayout === 'stacked' ? '1fr' : l.toolbarLayout === 'compact' ? 'minmax(220px,1fr) 170px 160px' : 'minmax(280px,1fr) 205px 190px';
    return `
#catalogSurface{--wine:${c.primary};--wine-2:${c.primaryHover};--gold:${c.accent};--sand:${c.surfaceAlt};--sand-2:${c.surfaceMuted};--white:${c.surface};--ink:${c.text};--muted:${c.muted};--line:${c.line};--danger:${c.danger};--ok:${c.success};--serif:${headingFont};--sans:${bodyFont};--max:${l.maxWidth}px;background:${c.page};color:${c.text};font-family:${bodyFont};font-size:${t.baseSize}px;font-weight:${t.bodyWeight};line-height:${t.lineHeight}}
body{background:${c.page}}
#catalogSurface .wrap{width:min(calc(100% - ${l.gutterDesktop}px),var(--max))}
#catalogSurface .header{background-color:${c.headerBackground};${l.headerSticky?'position:sticky;top:0;':''}}
#catalogSurface .header-row{padding:${l.headerPadding}px 0 ${Math.max(12,Math.round(l.headerPadding*.52))}px;flex-direction:${headerFlex};align-items:${headerAlign};gap:${l.navGap}px}
#catalogSurface [data-header-slot="brand"]{order:${orders.brand}}
#catalogSurface [data-header-slot="nav"]{order:${orders.nav};gap:${l.navGap}px}
#catalogSurface [data-header-slot="actions"]{order:${orders.actions}}
#catalogSurface .brand b{font-family:${headingFont};font-weight:${t.headingWeight};letter-spacing:${t.brandSpacing}em}
#catalogSurface .nav button{font-size:${t.navSize}px;letter-spacing:${t.navSpacing}em;text-transform:${t.navTransform}}
#catalogSurface .site-page{padding:${l.catalogTop}px 0 ${l.catalogBottom}px;background-color:${c.surfaceAlt}}
#catalogSurface .section-head{max-width:${l.introMaxWidth}px;text-align:${l.catalogAlign};color:${c.heroText};${l.heroMode==='plain'?'':`padding:${l.heroPadding}px;border-radius:${l.heroRadius}px;`} ${l.heroMode==='panel'?`background-color:${c.surface};border:1px solid ${c.line};`:''}}
#catalogSurface .section-head h1{color:${c.heroText};font-family:${headingFont};font-weight:${t.headingWeight};font-size:calc(clamp(2.25rem,4vw,3.65rem) * ${t.headingScale})}
#catalogSurface .section-head p:last-child{${l.catalogAlign==='center'?'margin-left:auto;margin-right:auto;':''}}
#catalogSurface [data-layout-block="intro"]{order:${blocks.intro}}
#catalogSurface [data-layout-block="filters"]{order:${blocks.filters}}
#catalogSurface [data-layout-block="products"]{order:${blocks.products}}
#catalogSurface .toolbar{grid-template-columns:${toolbarColumns}}
#catalogSurface .field,#catalogSurface .select,#catalogSurface .textarea{background:${c.inputBackground};border-radius:${l.inputRadius}px}
#catalogSurface .product-grid{grid-template-columns:repeat(${l.gridColumnsDesktop},minmax(0,1fr));column-gap:${l.gridGapX}px;row-gap:${l.gridGapY}px}
#catalogSurface .card{padding:${l.cardPadding}px;background:${cardBackground};border:${cardBorder};border-radius:${l.radius}px;box-shadow:${cardShadow};text-align:${l.cardAlign};overflow:hidden}
#catalogSurface .card-image{aspect-ratio:${ratio};border-radius:${l.radius}px;background:${c.surfaceMuted}}
#catalogSurface .card-image img{object-fit:${l.imageFit}}
#catalogSurface .card-body{align-items:${l.cardAlign==='center'?'center':l.cardAlign==='right'?'flex-end':'flex-start'}}
#catalogSurface .card-actions{justify-content:${l.cardAlign==='center'?'center':l.cardAlign==='right'?'flex-end':'flex-start'}}
#catalogSurface .btn,#catalogSurface .icon-btn,#catalogSurface .close-btn{border-radius:${l.buttonRadius}px}
#catalogSurface .btn.primary,#catalogSurface .btn.gold{color:${c.buttonText}}
#catalogSurface .header .brand b,#catalogSurface .header .cart-btn,#catalogSurface .header .menu-btn{color:${c.headerText}}
#catalogSurface .header .nav button{color:${c.headerMuted}}
#catalogSurface .header .nav button:hover,#catalogSurface .header .nav button.active{color:${c.headerText}}
#catalogSurface .result-row{color:${c.muted}}
#catalogSurface .price,#catalogSurface .big-price{color:${c.price}}
#catalogSurface .unit{color:${c.muted}}
#catalogSurface .badge{background:${c.badgeBackground};color:${c.badgeText};border-color:${c.line}}
#catalogSurface .badge.out{background:${c.outOfStockBackground};color:${c.outOfStockText};border-color:transparent}
#catalogSurface .drawer,#catalogSurface .modal,#catalogSurface .panel-head,#catalogSurface .close-btn,#catalogSurface .gallery-thumb,#catalogSurface .shipping-choice,#catalogSurface .related-card,#catalogSurface .empty,#catalogSurface .cart-receipt{background-color:${c.surface};color:${c.text}}
#catalogSurface .drawer-foot,#catalogSurface .meta,#catalogSurface .gift-box,#catalogSurface .shipping-choice.selected{background-color:${c.surfaceAlt}}
#catalogSurface .field,#catalogSurface .select,#catalogSurface .textarea{color:${c.text};border-color:${c.line}}
#catalogSurface .card-image{border-color:${c.line}}
#catalogSurface .group label,#catalogSurface .group-title{color:${c.text}}
#catalogSurface .overlay{background:${c.overlay}}
#toasts .toast{background:${c.text};color:${c.surface}}
#toasts .toast.ok{background:${c.success};color:${c.buttonText}}
#toasts .toast.bad{background:${c.danger};color:${c.buttonText}}
#catalogSurface .footer{background-color:${c.footerBackground};color:${c.footerText};text-align:${l.footerAlign}}
#catalogSurface .footer-secret-brand b{color:${c.footerHeading}}
#catalogSurface .footer-secret-brand small{color:${c.footerAccent}}
#catalogSurface .footer-bottom [data-mode]{color:${c.footerMuted}}
#catalogSurface .footer-contact a:hover,#catalogSurface .footer-contact button:hover{color:${c.footerAccent}}
#catalogSurface .footer-brand{align-items:${l.footerAlign==='center'?'center':l.footerAlign==='right'?'flex-end':'flex-start'}}
#catalogSurface .footer-contact{justify-content:${l.footerAlign==='center'?'center':l.footerAlign==='right'?'flex-end':'flex-start'}}
#catalogSurface [data-footer-block="logo"]{order:${footer.logo}}
#catalogSurface [data-footer-block="description"]{order:${footer.description}}
#catalogSurface [data-footer-block="contact"]{order:${footer.contact}}
#catalogSurface .brand-logo-header{width:${l.headerLogoWidth}px}
#catalogSurface .brand-logo-footer{width:${l.footerLogoWidth}px}
${!show.category?'#catalogSurface .card .category{display:none!important}':''}
${!show.unit?'#catalogSurface .card .unit{display:none!important}':''}
${!show.stock?'#catalogSurface .card .stock-note{display:none!important}':''}
${!show.quickAdd?'#catalogSurface .card .icon-btn{display:none!important}':''}
${!show.search?'#catalogSurface #search{display:none!important}':''}
${!show.filters?'#catalogSurface #category,#catalogSurface #sort,#catalogSurface .catalog-subnav{display:none!important}':''}
${!show.resultCount?'#catalogSurface .result-row{display:none!important}':''}
${!show.footerDescription?'#catalogSurface [data-footer-block="description"]{display:none!important}':''}
${!show.footerContact?'#catalogSurface [data-footer-block="contact"]{display:none!important}':''}
${!l.animations?'#catalogSurface *,#catalogSurface *::before,#catalogSurface *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}':''}
${l.headerLayout!=='centered'?`#catalogSurface .header-row{justify-content:space-between}#catalogSurface .brand{flex:0 0 auto;text-align:left}#catalogSurface .nav{flex:1}#catalogSurface .header-actions{position:static;display:flex;margin-left:auto}`:''}
${l.headerLayout==='compact'?`#catalogSurface .header-row{padding:${Math.max(12,Math.round(l.headerPadding*.45))}px 0;gap:${Math.max(8,Math.round(l.navGap*.6))}px}#catalogSurface .brand b{font-size:2rem}#catalogSurface .brand span{margin-top:5px}`:''}
@media(max-width:900px){#catalogSurface .product-grid{grid-template-columns:repeat(${l.gridColumnsTablet},minmax(0,1fr))}}
@media(max-width:790px){#catalogSurface .header-row{flex-direction:column;align-items:center;padding:${Math.max(20,Math.round(l.headerPadding*.7))}px 0 20px}#catalogSurface .header-actions{display:contents}#catalogSurface .nav{width:100%}#catalogSurface .brand{text-align:center}}
@media(max-width:620px){#catalogSurface .wrap{width:calc(100% - ${l.gutterMobile}px)}#catalogSurface .product-grid{grid-template-columns:repeat(${l.gridColumnsMobile},minmax(0,1fr))}#catalogSurface .toolbar{grid-template-columns:1fr}}
${publicMode ? scopeVisualCss(v.customCss) : ''}`;
  }
  function applyVisualTheme(raw) {
    const v = normalizeVisual(raw); state.settings.visual = v;
    let style = $('#visualRuntimeStyles'); if (!style) { style = document.createElement('style'); style.id = 'visualRuntimeStyles'; document.head.append(style); }
    style.textContent = buildVisualCss(v);
    const setImage = (selector, value, alt) => { const node = $(selector); if (!node) return; if (value) { node.src = value; node.alt = alt || ''; node.hidden = false; } else { node.removeAttribute('src'); node.alt = ''; node.hidden = true; } };
    setImage('#headerLogo', v.assets.headerLogo, `${state.settings.brand || 'Marca'} — logo`); setImage('#footerLogo', v.assets.footerLogo, `${state.settings.brand || 'Marca'} — logo`);
    const headerHas = !!v.assets.headerLogo, footerHas = !!v.assets.footerLogo;
    const headerImageVisible = headerHas && v.layout.headerLogoMode !== 'text', footerImageVisible = footerHas && v.layout.footerLogoMode !== 'text';
    const headerLogo = $('#headerLogo'); if (headerLogo) headerLogo.hidden = !headerImageVisible; const footerLogo = $('#footerLogo'); if (footerLogo) footerLogo.hidden = !footerImageVisible;
    const copies = $$('[data-brand-copy]'); if (copies[0]) copies[0].hidden = v.layout.headerLogoMode === 'image' && headerHas; if (copies[1]) copies[1].hidden = v.layout.footerLogoMode === 'image' && footerHas;
    const surfaceImage = (selector, value, overlay = '') => {
      const node = $(selector); if (!node) return;
      node.style.backgroundImage = value ? `${overlay ? `linear-gradient(${overlay},${overlay}),` : ''}url("${value.replace(/["\\]/g,'\\$&')}")` : '';
      node.style.backgroundPosition = value ? 'center' : '';
      node.style.backgroundRepeat = value ? 'no-repeat' : '';
      node.style.backgroundSize = value ? 'cover' : '';
    };
    surfaceImage('.header', v.assets.headerBackground); surfaceImage('.footer', v.assets.footerBackground); surfaceImage('.site-page', v.assets.pageBackground);
    surfaceImage('.section-head', v.layout.heroMode === 'image' ? v.assets.heroBackground : '', v.colors.heroOverlay);
    const favicon = $('#siteFavicon');
    if (favicon) {
      if (!favicon.dataset.defaultHref) favicon.dataset.defaultHref = favicon.getAttribute('href') || '';
      favicon.href = v.assets.favicon || favicon.dataset.defaultHref;
    }
    const themeMeta = $('meta[name="theme-color"]'); if (themeMeta) themeMeta.content = v.colors.headerBackground;
    return v;
  }


  const DEFAULTS = {
    catalogId: 'integrall-default', brand: 'INTEGRALL', subtitle: 'Wine & Fine Selection', catalogTitle: 'Nossa seleção',
    catalogText: 'Explore todos os produtos disponíveis e monte seu pedido.',
    whatsapp: '', email: '', instagram: '', address: 'Retirada e entrega combinadas no atendimento.',
    shipMode: 'quote', fixed: 0, free: 0, zoneFallback: 'quote',
    pickup: 'Retirada disponível mediante confirmação no atendimento.', zones: [], visual: normalizeVisual({})
  };
  const scopeId = value => String(value || 'integrall-default').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 80) || 'integrall-default';
  const initialSettings = {...DEFAULTS, ...(embedded.settings || {}), visual: normalizeVisual(embedded.settings?.visual)};
  let storageScope = scopeId(initialSettings.catalogId);
  const scopedKeys = scope => ({cart: `integrall_cart_v9:${scope}:${publicMode ? 'public' : 'master'}`, checkout: `integrall_checkout_v9:${scope}:${publicMode ? 'public' : 'master'}`});
  const legacyScopedKeys = scope => ({cart: `integrall_cart_v6:${scope}:${publicMode ? 'public' : 'master'}`, checkout: `integrall_checkout_v6:${scope}:${publicMode ? 'public' : 'master'}`});
  let KEYS = scopedKeys(storageScope);
  let initialCart = safeStore.get(KEYS.cart, null);
  let initialCheckout = sessionStore.get(KEYS.checkout, null);
  if (!Array.isArray(initialCart)) {
    const legacyKeys = legacyScopedKeys(storageScope);
    const legacy = safeStore.get(legacyKeys.cart, safeStore.get('integrall_cart_v5', safeStore.get('integrall_cart_v4', [])));
    initialCart = Array.isArray(legacy) ? legacy : [];
    safeStore.set(KEYS.cart, initialCart); safeStore.del(legacyKeys.cart); safeStore.del('integrall_cart_v5'); safeStore.del('integrall_cart_v4');
  }
  if (!initialCheckout || typeof initialCheckout !== 'object' || Array.isArray(initialCheckout)) {
    const legacyKeys = legacyScopedKeys(storageScope);
    const legacy = safeStore.get(KEYS.checkout, safeStore.get(legacyKeys.checkout, safeStore.get('integrall_checkout_v5', {})));
    initialCheckout = legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy : {};
    sessionStore.set(KEYS.checkout, initialCheckout); safeStore.del(KEYS.checkout); safeStore.del(legacyKeys.checkout); safeStore.del('integrall_checkout_v5');
  }
  const VALID_PAGES = new Set(['vitrine', 'vinhos', 'vinhos-importados', 'cafes', 'sucos', 'petit-four']);
  const PAGE_INFO = {
    vitrine: ['Vitrine Integrall', null, null, 'Nenhum produto encontrado', 'Tente remover os filtros ou buscar por outro termo.'],
    vinhos: ['Seleção de vinhos', 'Vinhos', 'Explore vinhos e espumantes disponíveis na coleção Integrall.', 'Nenhum vinho encontrado', 'Cadastre um vinho ou ajuste os filtros.'],
    'vinhos-importados': ['Seleção internacional', 'Vinhos importados', 'Explore os vinhos importados disponíveis na coleção Integrall.', 'Nenhum vinho importado encontrado', 'Marque o produto como importado na gestão.'],
    cafes: ['Seleção de cafés', 'Cafés', 'Explore os cafés disponíveis na coleção Integrall.', 'Nenhum café encontrado', 'Cadastre um produto no departamento Cafés.'],
    sucos: ['Seleção de sucos', 'Sucos', 'Explore os sucos disponíveis na coleção Integrall.', 'Nenhum suco encontrado', 'Cadastre um produto no departamento Sucos.'],
    'petit-four': ['Seleção gourmet', 'Petit Four', 'Explore os Petit Four disponíveis na coleção Integrall.', 'Nenhum Petit Four encontrado', 'Cadastre um produto no departamento Petit Four.']
  };
  const DEPARTMENT_LABELS = {vinhos: 'Vinhos', cafes: 'Cafés', sucos: 'Sucos', 'petit-four': 'Petit Four', outros: 'Outros'};

  const state = {
    products: Array.isArray(embedded.products) ? clone(embedded.products) : [],
    settings: initialSettings,
    cart: initialCart,
    checkout: {...{cep: '', choice: '', name: '', note: ''}, ...initialCheckout},
    page: 'vitrine', search: '', category: 'all', sort: 'featured', activeId: '', activeImage: 0,
    lastFocused: null, pendingSharedProduct: '', catalogReady: publicMode
  };
  if (!Array.isArray(state.cart)) state.cart = [];
  if (!Array.isArray(state.settings.zones)) state.settings.zones = [];

  function notify(message, type = '', action = null) {
    const stack = $('#toasts'); if (!stack) return;
    const toast = el('div', `toast ${type}`, message);
    if (action && typeof action.fn === 'function') {
      const button = el('button', 'toast-action', action.label || 'Desfazer'); button.type = 'button';
      button.addEventListener('click', async () => { button.disabled = true; try { await action.fn(); toast.remove(); } catch (error) { button.disabled = false; notify(error?.message || 'Não foi possível concluir a ação.', 'bad'); } }); toast.append(button);
    }
    stack.append(toast); setTimeout(() => toast.remove(), 4800);
  }

  function productImages(product) {
    const safe = source => typeof source === 'string' && source.length <= 16 * 1024 * 1024 && (/^data:image\/(?:png|jpeg|jpg|webp|gif|avif|svg\+xml)(?:;[^,]*)?,/i.test(source) || /^https:\/\//i.test(source) || /^blob:/i.test(source) || /^\/assets\/[A-Za-z0-9._\/-]+$/.test(source));
    const images = Array.isArray(product?.images) ? product.images.filter(safe).slice(0, 4) : [];
    if (!images.length && safe(product?.image)) images.push(product.image);
    return images.length ? images : [placeholderImage(product?.department || 'outros', product?.name || 'Integrall')];
  }

  function placeholderImage(department, title) {
    const text = String(title || 'Integrall').replace(/[<>&]/g, '').slice(0, 34);
    const palette = department === 'vinhos' ? ['#24050e', '#6a1830'] : department === 'cafes' ? ['#3a2419', '#9b704f'] : department === 'sucos' ? ['#805213', '#e0b957'] : department === 'petit-four' ? ['#9f7657', '#ead7bd'] : ['#283b25', '#8b7c4c'];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1000"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[1]}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="700" cy="180" r="250" fill="#fff" opacity=".10"/><rect x="180" y="260" width="540" height="460" fill="#faf6ef" opacity=".93"/><text x="450" y="455" text-anchor="middle" font-size="34" fill="#4a0a1a" font-family="Georgia">INTEGRALL</text><text x="450" y="520" text-anchor="middle" font-size="30" fill="#4a0a1a" font-family="Georgia">${text}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function productVariants(product) {
    if (!Array.isArray(product?.variants)) return [];
    const seen = new Set();
    return product.variants.filter(variant => {
      const id = String(variant?.id || ''); const price = Number(variant?.price);
      if (!variant || !id || seen.has(id) || !String(variant.name || '').trim() || !Number.isSafeInteger(price) || price <= 0 || price > 999999999999) return false;
      seen.add(id); return true;
    });
  }

  function selectedVariant(product, variantId) {
    if (!variantId) return null;
    return productVariants(product).find(variant => variant.id === variantId) || null;
  }

  function basePrice(product) {
    const variants = productVariants(product);
    if (variants.length) return Math.min(...variants.map(variant => Number(variant.price)));
    const price = Number(product?.price); return Number.isSafeInteger(price) && price > 0 && price <= 999999999999 ? price : 0;
  }

  function linePrice(product, variantId) {
    const variants = productVariants(product);
    if (variants.length) return selectedVariant(product, variantId)?.price || 0;
    return basePrice(product);
  }

  function lineUnit(product, variantId) {
    const variants = productVariants(product);
    if (variants.length) return selectedVariant(product, variantId)?.unit || '';
    return product?.unit || 'Consulte a apresentação';
  }

  function stockLimit(product, variantId) {
    const variants = productVariants(product); const variant = variants.length ? selectedVariant(product, variantId) : null;
    if (variants.length && !variant) return 0;
    const rawStock = variant ? variant.stock : product?.stock;
    const stock = rawStock === null || rawStock === '' || rawStock === undefined ? Infinity : Number(rawStock);
    const rawMaximum = product?.maxPerOrder;
    const maximum = rawMaximum === null || rawMaximum === '' || rawMaximum === undefined ? Infinity : Number(rawMaximum);
    const safeStock = Number.isSafeInteger(stock) && stock >= 0 ? stock : (stock === Infinity ? Infinity : 0);
    const safeMaximum = Number.isSafeInteger(maximum) && maximum >= 1 ? maximum : (maximum === Infinity ? Infinity : 0);
    return Math.max(0, Math.min(safeStock, safeMaximum, 999));
  }

  function productAvailable(product, variantId = '') {
    if (!product || product.available === false || basePrice(product) <= 0) return false;
    const variants = productVariants(product);
    if (variants.length && !variantId) return variants.some(variant => stockLimit(product, variant.id) > 0);
    return stockLimit(product, variantId) > 0;
  }

  function getProduct(id) { return state.products.find(product => product.id === id); }

  function pageMatches(product, page = state.page) {
    if (page === 'vitrine') return true;
    if (page === 'vinhos') return product.department === 'vinhos';
    if (page === 'vinhos-importados') return product.department === 'vinhos' && product.imported === true;
    return product.department === page;
  }

  function applySettings() {
    const s = state.settings;
    applyVisualTheme(s.visual);
    $$('[data-brand]').forEach(node => node.textContent = s.brand || DEFAULTS.brand);
    $$('[data-subtitle]').forEach(node => node.textContent = s.subtitle || DEFAULTS.subtitle);
    $('[data-address]').textContent = s.address || DEFAULTS.address;
    const email = $('#emailLink');
    const emailText = $('#emailText');
    if (s.email) { email.href = `mailto:${s.email}`; emailText.textContent = s.email; email.dataset.disabled = '0'; }
    else { email.href = '#'; emailText.textContent = publicMode ? 'Contato não informado' : 'Configure na gestão'; email.dataset.disabled = '1'; }
    const instagram = $('#instagramLink');
    const instagramText = $('#instagramText');
    if (s.instagram) {
      const raw = String(s.instagram).trim();
      const handle = raw.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/$/, '');
      instagram.href = raw.startsWith('http') ? raw : `https://instagram.com/${handle}`;
      instagram.target = '_blank'; instagram.rel = 'noopener'; instagramText.textContent = raw.startsWith('@') ? raw : `@${handle}`; instagram.dataset.disabled = '0';
    } else { instagram.href = '#'; instagramText.textContent = publicMode ? 'Contato não informado' : 'Configure na gestão'; instagram.dataset.disabled = '1'; }
    $('#modalPickupOption').textContent = s.pickup || DEFAULTS.pickup;
    $('[data-mode]').textContent = publicMode ? 'Catálogo público' : 'Arquivo mestre local • pronto para gerar a versão pública';
    document.title = `${s.brand || 'Integrall'} | Boutique Gourmet`;
  }

  function currentPageCategories() {
    const values = state.products.filter(p => pageMatches(p)).map(p => p.subcategory || DEPARTMENT_LABELS[p.department] || 'Outros').filter(Boolean);
    return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function renderCategories() {
    const select = $('#category');
    const previous = state.category;
    select.replaceChildren();
    const all = el('option', '', 'Todas as categorias'); all.value = 'all'; select.append(all);
    currentPageCategories().forEach(name => { const option = el('option', '', name); option.value = norm(name); select.append(option); });
    const exists = [...select.options].some(option => option.value === previous);
    state.category = exists ? previous : 'all'; select.value = state.category;
  }

  function filteredProducts() {
    const search = norm(state.search);
    let items = state.products.filter(product => {
      if (!pageMatches(product)) return false;
      const category = product.subcategory || DEPARTMENT_LABELS[product.department] || 'Outros';
      if (state.category !== 'all' && norm(category) !== state.category) return false;
      if (search) {
        const haystack = norm([product.name, product.brand, product.sku, product.subcategory, product.description, product.country, product.region, product.attributes ? JSON.stringify(product.attributes) : ''].join(' '));
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    items.sort((a, b) => {
      if (state.sort === 'manual') return (Number(a.position) || 999999) - (Number(b.position) || 999999) || a.name.localeCompare(b.name, 'pt-BR');
      if (state.sort === 'name') return a.name.localeCompare(b.name, 'pt-BR');
      if (state.sort === 'price-up') return basePrice(a) - basePrice(b);
      if (state.sort === 'price-down') return basePrice(b) - basePrice(a);
      return Number(b.featured) - Number(a.featured) || (Number(a.position) || 999999) - (Number(b.position) || 999999) || (Number(b.updated) || 0) - (Number(a.updated) || 0);
    });
    return items;
  }

  function renderProducts() {
    const grid = $('#productGrid');
    const items = filteredProducts();
    grid.replaceChildren();
    $('#emptyProducts').hidden = items.length > 0;
    grid.hidden = items.length === 0;
    $('#resultCount').textContent = `${items.length} ${items.length === 1 ? 'produto encontrado' : 'produtos encontrados'}`;
    $('#clearFilters').hidden = !(state.search || state.category !== 'all' || !['featured', 'manual'].includes(state.sort));

    items.forEach(product => {
      const card = el('article', 'card');
      const imageButton = el('button', 'card-image');
      imageButton.type = 'button'; imageButton.dataset.details = product.id; imageButton.setAttribute('aria-label', `Ver detalhes de ${product.name}`);
      const image = document.createElement('img'); image.src = productImages(product)[0]; image.alt = product.name; image.loading = 'lazy'; image.decoding = 'async'; imageButton.append(image);
      if (product.featured || !productAvailable(product)) imageButton.append(el('span', `badge ${!productAvailable(product) ? 'out' : ''}`, !productAvailable(product) ? 'Indisponível' : 'Destaque'));
      const body = el('div', 'card-body');
      body.append(el('p', 'category', product.subcategory || DEPARTMENT_LABELS[product.department] || 'Seleção Integrall'), el('h2', '', product.name));
      const priceRow = el('div', 'price-row');
      const variants = productVariants(product);
      priceRow.append(el('div', 'price', variants.length ? `A partir de ${money(basePrice(product))}` : money(product.price)), el('div', 'unit', variants.length ? `${variants.length} opções` : (product.unit || 'Consulte a apresentação')));
      const limit = stockLimit(product, variants[0]?.id || '');
      if (Number.isFinite(limit) && limit > 0 && limit <= (Number(product.stockMin) || 3)) priceRow.append(el('div', 'stock-note', `Últimas ${limit} unidade(s)`));
      body.append(priceRow);
      const actions = el('div', 'card-actions');
      const detail = el('button', 'btn outline small', 'Conhecer'); detail.type = 'button'; detail.dataset.details = product.id;
      const add = el('button', 'icon-btn', '＋'); add.type = 'button'; add.dataset.details = product.id; add.disabled = !productAvailable(product); add.setAttribute('aria-label', `Escolher opções de ${product.name}`);
      actions.append(detail, add); body.append(actions); card.append(imageButton, body); grid.append(card);
    });
  }

  function pageInfo(page) {
    const info = PAGE_INFO[page] || PAGE_INFO.vitrine;
    return [info[0], info[1] || state.settings.catalogTitle || DEFAULTS.catalogTitle, info[2] || state.settings.catalogText || DEFAULTS.catalogText, info[3], info[4]];
  }

  function applyPage(page) {
    if (!VALID_PAGES.has(page)) page = 'vitrine';
    state.page = page;
    const info = pageInfo(page);
    $('#catalogEyebrow').textContent = info[0]; $('#catalogTitle').textContent = info[1]; $('#catalogIntro').textContent = info[2];
    const empty = $('#emptyProducts'); empty.querySelector('h2').textContent = info[3]; empty.querySelector('p').textContent = info[4];
    $('#wineSubnav').hidden = !(page === 'vinhos' || page === 'vinhos-importados');
    $$('#nav [data-page]').forEach(button => {
      const active = button.dataset.page === (page === 'vinhos-importados' ? 'vinhos' : page);
      button.classList.toggle('active', active); active ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current');
    });
    $$('#wineSubnav [data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
    $('#nav').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false');
    state.search = ''; state.category = 'all'; $('#search').value = '';
    renderCategories(); renderProducts();
    const titles = {vitrine: 'Vitrine', vinhos: 'Vinhos', 'vinhos-importados': 'Vinhos importados', cafes: 'Cafés', sucos: 'Sucos', 'petit-four': 'Petit Four'};
    document.title = `${titles[page]} | ${state.settings.brand || 'Integrall'}`;
    window.scrollTo({top: 0, left: 0, behavior: 'auto'});
  }

  function routeFromLocation() {
    const raw = location.hash.replace(/^#/, '');
    if (raw.startsWith('product=')) {
      let productId = ''; try { productId = decodeURIComponent(raw.slice(8)); } catch { productId = ''; }
      return {page: 'vitrine', productId};
    }
    let decoded = raw; try { decoded = decodeURIComponent(raw); } catch { decoded = ''; }
    const page = decoded.startsWith('page=') ? decoded.slice(5).toLowerCase() : decoded.toLowerCase();
    return {page: VALID_PAGES.has(page) ? page : 'vitrine', productId: ''};
  }

  function navigate(page, {historyMode = 'push'} = {}) {
    if (!VALID_PAGES.has(page)) page = 'vitrine';
    applyPage(page);
    const route = `#page=${page}`;
    if (historyMode === 'push' && location.hash !== route) history.pushState({page}, '', route);
    else if (historyMode === 'replace') history.replaceState({page}, '', route);
  }

  const layers = (() => {
    let active = null;
    let opener = null;
    const overlay = $('#overlay');
    function focusable(root) { return $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', root).filter(node => !node.hidden && node.offsetParent !== null); }
    function trap(event) {
      if (!active || event.key !== 'Tab') return;
      const items = focusable(active);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    function open(node) {
      if (!node) return;
      close(false);
      opener = document.activeElement;
      active = node;
      overlay.classList.add('open');
      node.classList.add('open'); node.setAttribute('aria-hidden', 'false');
      document.body.classList.add('lock'); document.addEventListener('keydown', trap);
      setTimeout(() => focusable(node)[0]?.focus(), 25);
    }
    function close(returnFocus = true) {
      if (active) { active.classList.remove('open'); active.setAttribute('aria-hidden', 'true'); }
      overlay.classList.remove('open'); document.body.classList.remove('lock'); document.removeEventListener('keydown', trap);
      const previous = opener; active = null; opener = null;
      if (returnFocus && previous instanceof HTMLElement) setTimeout(() => previous.focus(), 20);
    }
    function current() { return active; }
    return {open, close, current};
  })();

  function specsFor(product) {
    const attrs = product.attributes || {};
    const list = [];
    const add = (label, value) => { if (value !== undefined && value !== null && String(value).trim()) list.push([label, String(value).trim()]); };
    add('Marca', product.brand); add('Código', product.sku); add('Prazo de preparação', product.preparation);
    if (product.madeToOrder) add('Disponibilidade', 'Sob encomenda');
    if (product.seasonal) add('Produto', 'Sazonal');
    if (product.department === 'vinhos') {
      add('Origem', [product.country, product.region].filter(Boolean).join(' • ')); add('Tipo', attrs.wineType); add('Uva', attrs.grape); add('Safra', attrs.vintage); add('Teor alcoólico', attrs.alcohol); add('Volume', attrs.volume); add('Serviço', attrs.serving); add('Harmonização', attrs.pairing);
    } else if (product.department === 'cafes') {
      add('Origem', attrs.origin); add('Grão', attrs.bean); add('Torra', attrs.roast); add('Moagem', attrs.grind); add('Intensidade', attrs.intensity); add('Peso', attrs.weight); add('Método recomendado', attrs.method);
    } else if (product.department === 'sucos') {
      add('Sabor', attrs.flavor); add('Volume', attrs.volume); add('Tipo', attrs.kind); add('Açúcar', attrs.sugar); add('Ingredientes', attrs.ingredients); add('Conservação', attrs.storage);
    } else if (product.department === 'petit-four') {
      add('Peso', attrs.weight); add('Quantidade', attrs.quantity); add('Sabores', attrs.flavors); add('Ingredientes', attrs.ingredients); add('Alérgenos', attrs.allergens); add('Validade', attrs.shelfLife); add('Encomenda mínima', attrs.minOrder);
    }
    return list;
  }

  function renderSpecs(product) {
    const container = $('#modalSpecs'); container.replaceChildren();
    specsFor(product).forEach(([label, value]) => {
      const item = el('div', 'spec'); item.append(el('span', '', label), el('b', '', value)); container.append(item);
    });
    container.hidden = !container.children.length;
  }

  function renderGallery(product, index = 0) {
    const images = productImages(product); state.activeImage = Math.max(0, Math.min(index, images.length - 1));
    $('#modalImage').src = images[state.activeImage]; $('#modalImage').alt = `${product.name} — foto ${state.activeImage + 1}`;
    const thumbs = $('#modalThumbs'); thumbs.replaceChildren(); thumbs.hidden = images.length < 2;
    images.forEach((src, i) => {
      const button = el('button', `gallery-thumb ${i === state.activeImage ? 'active' : ''}`); button.type = 'button'; button.dataset.galleryIndex = String(i); button.setAttribute('aria-label', `Ver foto ${i + 1} de ${product.name}`);
      const image = document.createElement('img'); image.src = src; image.alt = ''; button.append(image); thumbs.append(button);
    });
  }

  function renderVariants(product) {
    const select = $('#modalVariant'); select.replaceChildren();
    const variants = productVariants(product);
    $('#variantGroup').hidden = !variants.length;
    if (!variants.length) { const option = el('option', '', product.unit || 'Padrão'); option.value = ''; select.append(option); }
    else variants.forEach(variant => {
      const option = el('option', '', `${variant.name} — ${money(variant.price)}${variant.unit ? ` • ${variant.unit}` : ''}`);
      option.value = variant.id; option.disabled = stockLimit(product, variant.id) <= 0; select.append(option);
    });
    const firstAvailable = [...select.options].find(option => !option.disabled);
    if (firstAvailable) select.value = firstAvailable.value;
    updateModalSelection();
  }

  function updateModalSelection() {
    const product = getProduct(state.activeId); if (!product) return;
    const variantId = $('#modalVariant').value;
    const price = linePrice(product, variantId); const unit = lineUnit(product, variantId); const limit = stockLimit(product, variantId);
    $('#modalPrice').textContent = money(price); $('#modalUnit').textContent = unit;
    $('#modalAvailability').textContent = !productAvailable(product, variantId) ? (product.restockDate ? `Reposição prevista: ${product.restockDate}` : 'Indisponível') : Number.isFinite(limit) ? `${limit} unidade(s)` : (product.madeToOrder ? 'Sob encomenda' : 'Disponível');
    const qty = $('#modalQty'); qty.max = Number.isFinite(limit) ? String(Math.max(1, limit)) : '999';
    if (Number(qty.value) > limit && Number.isFinite(limit)) qty.value = String(Math.max(1, limit));
    $('#modalAdd').disabled = !productAvailable(product, variantId);
    if (digits(state.checkout.cep).length === 8) updateModalDeliveryOptions();
  }

  function relatedProducts(product) {
    return state.products.filter(candidate => candidate.id !== product.id && candidate.department === product.department && productAvailable(candidate)).sort((a, b) => Number(b.featured) - Number(a.featured) || (Number(a.position) || 999999) - (Number(b.position) || 999999)).slice(0, 3);
  }

  function renderRelated(product) {
    const related = relatedProducts(product); const section = $('#relatedSection'); const grid = $('#relatedGrid'); grid.replaceChildren(); section.hidden = !related.length;
    related.forEach(item => {
      const button = el('button', 'related-card'); button.type = 'button'; button.dataset.relatedId = item.id;
      const image = document.createElement('img'); image.loading = 'lazy'; image.decoding = 'async'; image.src = productImages(item)[0]; image.alt = '';
      button.append(image, el('span', '', item.name)); grid.append(button);
    });
  }

  function openProduct(id, {updateHash = false} = {}) {
    const product = getProduct(id); if (!product) return;
    state.activeId = id; state.activeImage = 0;
    $('#modalCategory').textContent = product.subcategory || DEPARTMENT_LABELS[product.department] || 'Seleção Integrall';
    $('#modalName').textContent = product.name; $('#modalDescription').textContent = product.description || 'Consulte mais informações diretamente com a Integrall.';
    $('#modalQty').value = 1; $('#modalGift').checked = false; $('#modalGiftMessage').value = ''; $('#giftMessageWrap').hidden = true; $('.gift-box').hidden = product.giftEnabled === false;
    $('#modalCep').value = state.checkout.cep ? cepMask(state.checkout.cep) : '';
    $('#modalError').textContent = '';
    renderGallery(product); renderSpecs(product); renderVariants(product); renderRelated(product);
    updateModalDeliveryOptions();
    $$('input[name="shippingChoice"]').forEach(radio => radio.checked = radio.value === state.checkout.choice);
    updateShippingChoiceClasses();
    layers.open($('#productModal'));
    if (updateHash && publicMode) history.pushState({product: id}, '', `#product=${encodeURIComponent(id)}`);
  }

  function projectedSubtotal() {
    const product = getProduct(state.activeId); if (!product) return cartSubtotal();
    const raw = String($('#modalQty').value || ''); const qty = /^\d+$/.test(raw) ? Math.max(1, Math.min(999, Number(raw))) : 1;
    return cartSubtotal() + linePrice(product, $('#modalVariant').value) * qty;
  }

  function findZone(cep) {
    const clean = digits(cep);
    const number = Number(clean);
    if (!Number.isFinite(number)) return null;
    // Aceita AMBOS os formatos de zona: o legado do editor (cepStart/cepEnd)
    // e o sanitizado pelo servidor (startCep/endCep/prefix) — o catálogo
    // vindo de /api/catalog usa o segundo; sem isso a loja diria "CEP fora
    // das zonas" enquanto o servidor cobraria o valor da zona.
    return (state.settings.zones || []).find(zone => {
      if (zone.active === false) return false;
      const prefix = digits(zone.prefix ?? zone.cepPrefix ?? '');
      if (prefix && clean.startsWith(prefix)) return true;
      const start = digits(zone.startCep ?? zone.cepStart ?? '');
      const end = digits(zone.endCep ?? zone.cepEnd ?? '');
      return start.length === 8 && end.length === 8 && number >= Number(start) && number <= Number(end);
    }) || null;
  }

  function calculateShipping(subtotal, choice = state.checkout.choice, cep = state.checkout.cep) {
    if (choice === 'pickup') return {status: 'ready', choice, price: 0, label: state.settings.pickup || DEFAULTS.pickup, days: ''};
    if (choice !== 'delivery') return {status: 'missing', choice: '', price: null, label: 'Escolha entrega ou retirada.'};
    if (digits(cep).length !== 8) return {status: 'invalid', choice, price: null, label: 'Informe um CEP com 8 dígitos.'};
    let price = null, label = '', days = '', minimum = 0;
    if (state.settings.shipMode === 'fixed') { price = Number(state.settings.fixed) || 0; label = 'Frete fixo configurado'; }
    else if (state.settings.shipMode === 'zones') {
      const zone = findZone(cep);
      if (zone) { price = Number(zone.price) || 0; days = zone.days || zone.deadline || ''; minimum = Number(zone.minOrder) || 0; label = zone.label || zone.name || 'Zona de entrega'; }
      else if (state.settings.zoneFallback === 'unavailable') return {status: 'unavailable', choice, price: null, label: 'Entrega indisponível para este CEP.'};
      else return {status: 'quote', choice, price: null, label: 'CEP fora das zonas. Valor e prazo serão confirmados no atendimento.'};
    } else return {status: 'quote', choice, price: null, label: 'Valor e prazo serão confirmados no atendimento.'};
    if (minimum > 0 && subtotal < minimum) return {status: 'minimum', choice, price, label: `Pedido mínimo de ${money(minimum)} para ${label}.`, minimum, days};
    if (Number(state.settings.free) > 0 && subtotal >= Number(state.settings.free)) price = 0;
    return {status: 'ready', choice, price, label, days, minimum};
  }

  function shippingDescription(quote) {
    if (quote.status === 'ready') return `${quote.price === 0 ? 'Grátis' : money(quote.price)}${quote.days ? ` • ${quote.days}` : ''}${quote.label ? ` • ${quote.label}` : ''}`;
    return quote.label;
  }

  function updateShippingChoiceClasses() {
    $$('[data-shipping-label]').forEach(label => label.classList.toggle('selected', label.dataset.shippingLabel === state.checkout.choice));
  }

  function updateModalDeliveryOptions() {
    const product = getProduct(state.activeId); if (!product) return;
    const subtotal = projectedSubtotal();
    const deliveryQuote = calculateShipping(subtotal, 'delivery', state.checkout.cep);
    $('#modalDeliveryOption').textContent = shippingDescription(deliveryQuote);
    $('#modalPickupOption').textContent = state.settings.pickup || DEFAULTS.pickup;
    const result = $('#modalDeliveryResult');
    if (digits(state.checkout.cep).length === 8) result.textContent = `CEP ${cepMask(state.checkout.cep)} considerado para o pedido estimado de ${money(subtotal)}.`;
    else result.textContent = 'Informe o CEP para calcular a entrega. A retirada pode ser escolhida a qualquer momento.';
    updateShippingChoiceClasses();
  }

  function saveCheckout() {
    sessionStore.set(KEYS.checkout, state.checkout);
    $('#customerName').value = state.checkout.name || ''; $('#customerNote').value = state.checkout.note || '';
    renderCart();
  }

  function inventoryKey(item) { return `${item.productId}|${item.variantId || ''}`; }
  function lineKey(item) { return [inventoryKey(item), item.gift ? '1' : '0', String(item.giftMessage || '').trim()].join('|'); }
  function inventoryLimit(product, variantId) {
    const variants = productVariants(product); const variant = variants.length ? selectedVariant(product, variantId) : null;
    if (variants.length && !variant) return 0;
    const value = variant ? variant.stock : product?.stock;
    if (value === null || value === '' || value === undefined) return 999;
    const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? Math.min(999, number) : 0;
  }
  function orderLimit(product) {
    const value = product?.maxPerOrder;
    if (value === null || value === '' || value === undefined) return 999;
    const number = Number(value); return Number.isSafeInteger(number) && number >= 1 ? Math.min(999, number) : 0;
  }
  function remainingCapacity(product, variantId, excludeLineId = '') {
    const usedInventory = state.cart.reduce((sum, item) => item.lineId !== excludeLineId && item.productId === product.id && (item.variantId || '') === (variantId || '') ? sum + (Number.isInteger(item.qty) ? item.qty : 0) : sum, 0);
    const usedProduct = state.cart.reduce((sum, item) => item.lineId !== excludeLineId && item.productId === product.id ? sum + (Number.isInteger(item.qty) ? item.qty : 0) : sum, 0);
    return Math.max(0, Math.min(inventoryLimit(product, variantId) - usedInventory, orderLimit(product) - usedProduct, 999 - usedProduct));
  }

  function cleanCart() {
    if (!state.catalogReady) return;
    const next = []; const usedInventory = new Map(); const usedProduct = new Map(); const lineIds = new Set();
    for (const raw of Array.isArray(state.cart) ? state.cart : []) {
      const product = getProduct(raw?.productId || raw?.id); if (!product || !productAvailable(product)) continue;
      const variants = productVariants(product); const variantId = String(raw?.variantId || '');
      if (variants.length && !selectedVariant(product, variantId)) continue;
      if (!variants.length && variantId) continue;
      const quantity = Number(raw?.qty); if (!Number.isInteger(quantity) || quantity < 1) continue;
      const invKey = `${product.id}|${variantId}`; const invUsed = usedInventory.get(invKey) || 0; const productUsed = usedProduct.get(product.id) || 0;
      const capacity = Math.max(0, Math.min(inventoryLimit(product, variantId) - invUsed, orderLimit(product) - productUsed, 999 - productUsed));
      const qty = Math.min(quantity, capacity); if (qty < 1) continue;
      let lineId = typeof raw.lineId === 'string' && raw.lineId && !lineIds.has(raw.lineId) ? raw.lineId.slice(0, 160) : uid('line');
      while (lineIds.has(lineId)) lineId = uid('line'); lineIds.add(lineId);
      const gift = !!raw.gift && product.giftEnabled !== false;
      next.push({lineId, productId: product.id, variantId, qty, gift, giftMessage: gift ? String(raw.giftMessage || '').trim().slice(0, 240) : ''});
      usedInventory.set(invKey, invUsed + qty); usedProduct.set(product.id, productUsed + qty);
    }
    const changed = JSON.stringify(next) !== JSON.stringify(state.cart); state.cart = next;
    if (changed) safeStore.set(KEYS.cart, state.cart);
  }

  function cartDetails() {
    return state.cart.map(item => {
      const product = getProduct(item.productId); if (!product) return null;
      const variant = selectedVariant(product, item.variantId); const price = linePrice(product, item.variantId);
      if (productVariants(product).length && !variant || price <= 0 || !Number.isInteger(item.qty) || item.qty < 1) return null;
      return {...item, product, variant, price, total: price * item.qty};
    }).filter(Boolean);
  }

  function cartSubtotal() { return cartDetails().reduce((sum, item) => sum + item.total, 0); }

  function saveCart() {
    cleanCart();
    if (!safeStore.set(KEYS.cart, state.cart)) notify('Não foi possível salvar a sacola neste navegador. Verifique o espaço disponível.', 'bad');
    renderCart();
  }

  function addCartLine() {
    const product = getProduct(state.activeId); if (!product) return;
    const variantId = $('#modalVariant').value; const rawQty = String($('#modalQty').value || '').trim();
    if (!/^\d+$/.test(rawQty)) { $('#modalError').textContent = 'Informe uma quantidade inteira.'; return; }
    const qty = Number(rawQty); if (!Number.isSafeInteger(qty) || qty < 1 || qty > 999) { $('#modalError').textContent = 'Informe uma quantidade inteira entre 1 e 999.'; return; }
    if (productVariants(product).length && !selectedVariant(product, variantId)) { $('#modalError').textContent = 'Selecione uma opção válida.'; return; }
    if (!productAvailable(product, variantId)) { $('#modalError').textContent = 'Este produto ou opção está indisponível.'; return; }
    const capacity = remainingCapacity(product, variantId);
    if (qty > capacity) { $('#modalError').textContent = capacity > 0 ? `Você pode adicionar no máximo mais ${capacity} unidade(s) deste produto.` : 'O limite de estoque ou por pedido já foi atingido.'; return; }
    const gift = $('#modalGift').checked && product.giftEnabled !== false;
    const giftMessage = gift ? $('#modalGiftMessage').value.trim().slice(0, 240) : '';
    const candidate = {productId: product.id, variantId, qty, gift, giftMessage};
    const existing = state.cart.find(item => lineKey(item) === lineKey(candidate));
    if (existing) existing.qty += qty; else state.cart.push({lineId: uid('line'), ...candidate});
    saveCart();
    if (publicMode && location.hash.startsWith('#product=')) history.replaceState({page: state.page}, '', `#page=${state.page}`);
    layers.close(); notify(`${product.name} adicionado à sacola.`, 'ok'); openCart();
  }

  function changeQuantity(lineId, delta) {
    const item = state.cart.find(line => line.lineId === lineId); if (!item || !Number.isInteger(delta) || !delta) return;
    const product = getProduct(item.productId); if (!product) { removeLine(lineId); return; }
    if (delta > 0) {
      const capacity = remainingCapacity(product, item.variantId);
      if (capacity < delta) { notify('Limite de estoque ou por pedido atingido.', 'bad'); return; }
      item.qty += delta;
    } else item.qty += delta;
    if (item.qty <= 0) state.cart = state.cart.filter(line => line.lineId !== lineId);
    saveCart();
  }

  function removeLine(lineId) { state.cart = state.cart.filter(line => line.lineId !== lineId); saveCart(); }

  function renderCart() {
    cleanCart();
    const list = $('#cartList'); const items = cartDetails(); list.replaceChildren();
    $('#emptyCart').hidden = items.length > 0; $('#cartFoot').hidden = !items.length; $('#customerFields').hidden = !items.length;
    $('#cartCount').textContent = String(items.reduce((sum, item) => sum + item.qty, 0));
    items.forEach(item => {
      const row = el('article', 'cart-item'); const image = document.createElement('img'); image.loading = 'lazy'; image.decoding = 'async'; image.src = productImages(item.product)[0]; image.alt = '';
      const copy = el('div'); copy.append(el('h3', '', item.product.name));
      const details = [item.variant?.name || item.product.unit, `${money(item.price)} cada`].filter(Boolean).join(' • '); copy.append(el('p', '', details));
      if (item.gift) copy.append(el('p', '', item.giftMessage ? `Presente: “${item.giftMessage}”` : 'Embalagem para presente'));
      const qty = el('div', 'qty'); const minus = el('button', '', '−'); const number = el('span', '', String(item.qty)); const plus = el('button', '', '+');
      minus.type = plus.type = 'button'; minus.dataset.minus = item.lineId; plus.dataset.plus = item.lineId; minus.setAttribute('aria-label', `Diminuir quantidade de ${item.product.name}`); plus.setAttribute('aria-label', `Aumentar quantidade de ${item.product.name}`); qty.append(minus, number, plus); copy.append(qty);
      const side = el('div'); side.style.textAlign = 'right'; side.append(el('b', '', money(item.total)), document.createElement('br'));
      const remove = el('button', 'remove-link', 'Remover'); remove.type = 'button'; remove.dataset.remove = item.lineId; remove.setAttribute('aria-label', `Remover ${item.product.name} da sacola`); side.append(remove);
      row.append(image, copy, side); list.append(row);
    });
    const subtotal = cartSubtotal(); const quote = calculateShipping(subtotal);
    $('#cartSubtotal').textContent = money(subtotal);
    $('#cartShipping').textContent = state.checkout.choice === 'pickup' ? 'Retirada' : state.checkout.choice === 'delivery' ? (quote.price === null ? 'A confirmar' : quote.price === 0 ? 'Grátis' : money(quote.price)) : 'Não escolhido';
    $('#cartTotal').textContent = state.checkout.choice === 'delivery' && quote.price === null ? `${money(subtotal)} + entrega` : money(subtotal + (quote.price || 0));
    const receipt = $('#cartReceipt'); receipt.replaceChildren(); const strong = document.createElement('b'); const detail = document.createTextNode('');
    if (!state.checkout.choice) { strong.textContent = 'Recebimento pendente. '; detail.textContent = 'Abra qualquer produto e escolha entrega ou retirada.'; }
    else if (state.checkout.choice === 'pickup') { strong.textContent = 'Retirada. '; detail.textContent = String(state.settings.pickup || DEFAULTS.pickup); }
    else { strong.textContent = `Entrega para ${state.checkout.cep ? cepMask(state.checkout.cep) : 'CEP não informado'}. `; detail.textContent = shippingDescription(quote); }
    receipt.append(strong, detail);
    $('#customerName').value = String(state.checkout.name || '').slice(0, 80); $('#customerNote').value = String(state.checkout.note || '').slice(0, 500);
  }

  function openCart() { renderCart(); layers.open($('#cartDrawer')); }

  function whatsappUrl(message) {
    const phone = digits(state.settings.whatsapp); return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : '';
  }

  function openWhatsApp(message) {
    const url = whatsappUrl(message);
    if (!url) { notify(publicMode ? 'WhatsApp não informado neste catálogo.' : 'Configure o WhatsApp na gestão.', 'bad'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function productMessage(product) {
    const variant = selectedVariant(product, $('#modalVariant').value);
    return `Olá! Tenho interesse em “${product.name}”${variant ? ` — ${variant.name}` : ''} (${money(linePrice(product, variant?.id || ''))}). Poderia confirmar a disponibilidade?`;
  }

  function checkoutValidation() {
    const items = cartDetails(); if (!items.length) return 'Sua sacola está vazia.';
    if (!String(state.checkout.name || '').trim()) return 'Informe seu nome antes de enviar o pedido.';
    if (String(state.checkout.name || '').trim().length > 80) return 'O nome deve ter no máximo 80 caracteres.';
    if (String(state.checkout.note || '').length > 500) return 'As observações devem ter no máximo 500 caracteres.';
    if (!state.checkout.choice) return 'Escolha entrega ou retirada nos detalhes de um produto.';
    const quote = calculateShipping(cartSubtotal());
    if (state.checkout.choice === 'delivery') {
      if (digits(state.checkout.cep).length !== 8) return 'Informe um CEP válido para a entrega.';
      if (quote.status === 'unavailable' || quote.status === 'minimum') return quote.label;
    }
    return '';
  }

  function checkoutMessage() {
    const subtotal = cartSubtotal(); const quote = calculateShipping(subtotal); const lines = cartDetails().map((item, index) => {
      const variant = item.variant ? ` — ${item.variant.name}` : '';
      const gift = item.gift ? ` | Presente${item.giftMessage ? `: ${item.giftMessage}` : ''}` : '';
      return `${index + 1}. ${item.qty}x ${item.product.name}${variant} — ${money(item.total)}${gift}`;
    });
    const receiving = state.checkout.choice === 'pickup' ? `Retirada: ${state.settings.pickup || DEFAULTS.pickup}` : `Entrega para ${cepMask(state.checkout.cep)}: ${shippingDescription(quote)}`;
    return [`Olá! Gostaria de fazer um pedido na ${state.settings.brand}.`, '', ...lines, '', `Subtotal: ${money(subtotal)}`, receiving, quote.price !== null ? `Total estimado: ${money(subtotal + (quote.price || 0))}` : 'Total final: a confirmar', `Nome: ${state.checkout.name.trim()}`, state.checkout.note.trim() ? `Observações: ${state.checkout.note.trim()}` : '', '', 'Por favor, confirme a disponibilidade, o valor final e as condições de recebimento.'].filter(Boolean).join('\n');
  }

  async function shareProduct() {
    const product = getProduct(state.activeId); if (!product) return;
    const base = location.protocol === 'http:' || location.protocol === 'https:' ? `${location.origin}${location.pathname}` : location.href.split('#')[0];
    const url = `${base}#product=${encodeURIComponent(product.id)}`;
    const data = {title: product.name, text: `${product.name} — ${money(basePrice(product))}`, url};
    try {
      if (navigator.share) await navigator.share(data);
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); notify('Link do produto copiado.', 'ok'); }
      else { const input = document.createElement('textarea'); input.value = url; document.body.append(input); input.select(); document.execCommand('copy'); input.remove(); notify('Link do produto copiado.', 'ok'); }
    } catch (error) { if (error?.name !== 'AbortError') notify('Não foi possível compartilhar.', 'bad'); }
  }

  function bindPublicEvents() {
    $('#year').textContent = new Date().getFullYear();
    $('#menuBtn').addEventListener('click', () => { const open = $('#nav').classList.toggle('open'); $('#menuBtn').setAttribute('aria-expanded', String(open)); $('#menuBtn').setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu'); });
    $$('[data-page]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); navigate(button.dataset.page); }));
    window.addEventListener('popstate', () => { if (layers.current()) layers.close(false); const route = routeFromLocation(); applyPage(route.page); if (route.productId) setTimeout(() => openProduct(route.productId), 40); });
    $('#search').addEventListener('input', event => { state.search = event.target.value; renderProducts(); });
    $('#category').addEventListener('change', event => { state.category = event.target.value; renderProducts(); });
    $('#sort').addEventListener('change', event => { state.sort = event.target.value; renderProducts(); });
    $('#clearFilters').addEventListener('click', () => { state.search = ''; state.category = 'all'; state.sort = 'featured'; $('#search').value = ''; $('#category').value = 'all'; $('#sort').value = 'featured'; renderProducts(); });
    $('#openCart').addEventListener('click', openCart);
    const closeCurrentLayer = () => {
      if (publicMode && layers.current() === $('#productModal') && location.hash.startsWith('#product=')) history.replaceState({page: state.page}, '', `#page=${state.page}`);
      layers.close();
    };
    $('#overlay').addEventListener('click', closeCurrentLayer);
    $$('.close-ui').forEach(button => button.addEventListener('click', closeCurrentLayer));
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && layers.current()) closeCurrentLayer(); });
    document.addEventListener('click', event => {
      const detail = event.target.closest('[data-details]'); if (detail) openProduct(detail.dataset.details, {updateHash: publicMode});
      const gallery = event.target.closest('[data-gallery-index]'); if (gallery) { const product = getProduct(state.activeId); if (product) renderGallery(product, Number(gallery.dataset.galleryIndex)); }
      const related = event.target.closest('[data-related-id]'); if (related) openProduct(related.dataset.relatedId, {updateHash: publicMode});
      const plus = event.target.closest('[data-plus]'); if (plus) changeQuantity(plus.dataset.plus, 1);
      const minus = event.target.closest('[data-minus]'); if (minus) changeQuantity(minus.dataset.minus, -1);
      const remove = event.target.closest('[data-remove]'); if (remove) removeLine(remove.dataset.remove);
    });
    $('#modalVariant').addEventListener('change', updateModalSelection);
    $('#modalQty').addEventListener('input', event => { if (event.target.value && !/^\d+$/.test(event.target.value)) event.target.value = ''; updateModalSelection(); updateModalDeliveryOptions(); });
    $('#modalGift').addEventListener('change', event => { $('#giftMessageWrap').hidden = !event.target.checked; if (event.target.checked) $('#modalGiftMessage').focus(); });
    $('#modalCep').addEventListener('input', event => event.target.value = cepMask(event.target.value));
    $('#modalDeliveryForm').addEventListener('submit', event => {
      event.preventDefault(); const cep = digits($('#modalCep').value);
      if (cep.length !== 8) { $('#modalDeliveryResult').textContent = 'Informe um CEP com 8 dígitos.'; return; }
      state.checkout.cep = cep; if (!state.checkout.choice) state.checkout.choice = 'delivery'; saveCheckout(); updateModalDeliveryOptions();
      $$('input[name="shippingChoice"]').forEach(radio => radio.checked = radio.value === state.checkout.choice); updateShippingChoiceClasses();
    });
    $$('input[name="shippingChoice"]').forEach(radio => radio.addEventListener('change', event => {
      if (event.target.value === 'delivery' && digits($('#modalCep').value).length !== 8) { event.target.checked = false; $('#modalDeliveryResult').textContent = 'Informe o CEP antes de escolher entrega.'; return; }
      state.checkout.choice = event.target.value; if (state.checkout.choice === 'delivery') state.checkout.cep = digits($('#modalCep').value); saveCheckout(); updateModalDeliveryOptions();
    }));
    $('#modalAdd').addEventListener('click', addCartLine);
    $('#modalWa')?.addEventListener('click', () => { const product = getProduct(state.activeId); if (product) openWhatsApp(productMessage(product)); });
    $('#modalShare').addEventListener('click', shareProduct);
    $$('[data-wa]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); openWhatsApp(`Olá! Gostaria de conhecer melhor a seleção da ${state.settings.brand}.`); }));
    $('#customerName').addEventListener('input', event => { state.checkout.name = event.target.value.slice(0, 80); sessionStore.set(KEYS.checkout, state.checkout); });
    $('#customerNote').addEventListener('input', event => { state.checkout.note = event.target.value.slice(0, 500); sessionStore.set(KEYS.checkout, state.checkout); });
    $('#clearCart').addEventListener('click', () => { if (confirm('Limpar a sacola?')) { state.cart = []; saveCart(); } });
    $('#emailLink').addEventListener('click', event => { if (event.currentTarget.dataset.disabled === '1') { event.preventDefault(); notify('E-mail ainda não configurado.', 'bad'); } });
    $('#instagramLink').addEventListener('click', event => { if (event.currentTarget.dataset.disabled === '1') { event.preventDefault(); notify('Instagram ainda não configurado.', 'bad'); } });
    
  }

  function setProducts(products) {
    state.products = Array.isArray(products) ? clone(products) : [];
    state.catalogReady = true; cleanCart(); renderCategories(); renderProducts(); renderCart();
  }
  function setSettings(nextSettings) {
    const next = {...DEFAULTS, ...(nextSettings || {}), visual: normalizeVisual(nextSettings?.visual)}; if (!Array.isArray(next.zones)) next.zones = [];
    const nextScope = scopeId(next.catalogId); const scopeChanged = nextScope !== storageScope;
    state.settings = next; storageScope = nextScope; KEYS = scopedKeys(storageScope);
    if (scopeChanged) {
      const savedCart = safeStore.get(KEYS.cart, []); const savedCheckout = sessionStore.get(KEYS.checkout, {});
      state.cart = Array.isArray(savedCart) ? savedCart : [];
      state.checkout = {...{cep: '', choice: '', name: '', note: ''}, ...(savedCheckout && typeof savedCheckout === 'object' && !Array.isArray(savedCheckout) ? savedCheckout : {})};
    }
    applySettings(); applyPage(state.page); if (state.catalogReady) cleanCart(); renderCart();
  }
  function getState() { return state; }

  applySettings(); bindPublicEvents(); if (state.catalogReady) cleanCart();
  const initialRoute = routeFromLocation(); applyPage(initialRoute.page); renderCart();
  if (initialRoute.productId) setTimeout(() => openProduct(initialRoute.productId), 60);

  return {state, setProducts, setSettings, renderProducts, renderCart, renderCategories, openProduct, openCart, navigate, notify, calculateShipping, getState, productImages, basePrice, productVariants, productAvailable, stockLimit, money, norm, digits, cepMask, placeholderImage, normalizeVisual, buildVisualCss, scopeVisualCss, visualDefaults: visualClone(VISUAL_DEFAULTS), applyVisualTheme, checkoutValidation, checkoutMessage, cartDetails, cartSubtotal, openWhatsApp, whatsappUrl, saveCart, cleanCart};
})({embedded:__integrallData,publicMode:true});