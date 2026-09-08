(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const header = $('#topo');
  const catalog = $('#catalogPage');
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = motionPreference.matches;
  let heroSlideIndex = 0;
  let heroAutoTimer = null;

  function scrollToId(id, offset = 0) {
    const node = document.getElementById(id);
    if (!node) return;
    const top = node.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({top, behavior: reduceMotion ? 'auto' : 'smooth'});
  }

  function openCatalogPage(page = 'vitrine') {
    const app = globalThis.__integrallApp;
    if (app?.navigate) app.navigate(page, {historyMode: 'push'});
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!catalog) return;
      const top = catalog.getBoundingClientRect().top + window.scrollY - 82;
      window.scrollTo({top, behavior: reduceMotion ? 'auto' : 'smooth'});
    }));
  }

  function bindPremiumActions() {
    $$('[data-scroll-to]').forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      $('#nav')?.classList.remove('open');
      $('#menuBtn')?.setAttribute('aria-expanded', 'false');
      scrollToId(button.dataset.scrollTo, 70);
    }));
    $$('[data-premium-page]').forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      openCatalogPage(button.dataset.premiumPage || 'vitrine');
    }));
    $$('[data-open-product]').forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      const id = button.dataset.openProduct;
      if (id && globalThis.__integrallApp?.openProduct) globalThis.__integrallApp.openProduct(id, {updateHash: true, variantId: button.dataset.openVariant || ''});
    }));
    $('#heroExplore')?.addEventListener('click', event => openCatalogPage(event.currentTarget.dataset.heroPage || 'vinhos'));
    $('#showAllProducts')?.addEventListener('click', () => openCatalogPage('vitrine'));
    $('#closingExplore')?.addEventListener('click', () => openCatalogPage('vitrine'));
    $('#premiumSearchBtn')?.addEventListener('click', () => {
      openCatalogPage('vitrine');
      setTimeout(() => $('#search')?.focus(), reduceMotion ? 0 : 650);
    });
  }

  function bindHeroVideo() {
    const video = $('.premium-hero-video');
    const toggle = $('#heroVideoToggle');
    const hero = $('.premium-hero');
    if (!video || !toggle) return;
    let userPaused = reduceMotion;
    let inView = true;
    let loadStarted = false;
    const applySpeed = () => { video.playbackRate = 1.35; video.defaultPlaybackRate = 1.35; };
    const updateButton = () => {
      const paused = video.paused;
      toggle.textContent = paused ? '▶' : 'Ⅱ';
      toggle.setAttribute('aria-label', paused ? 'Reproduzir vídeo de fundo' : 'Pausar vídeo de fundo');
      toggle.title = paused ? 'Reproduzir vídeo de fundo' : 'Pausar vídeo de fundo';
      hero?.classList.toggle('is-video-paused', paused);
    };
    const play = () => {
      if (!loadStarted) {
        const source = video.querySelector('source');
        if (!source) return;
        source.src = matchMedia('(max-width:790px)').matches ? source.dataset.mobileSrc : source.dataset.src;
        video.load();
        loadStarted = true;
      }
      applySpeed();
      video.play().then(updateButton).catch(updateButton);
    };
    const reconcile = () => {
      const activeSlide = video.closest('[data-hero-page]')?.classList.contains('is-active') !== false;
      if (!userPaused && inView && activeSlide && !document.hidden) play();
      else { video.pause(); updateButton(); }
    };
    toggle.addEventListener('click', () => {
      userPaused = !video.paused;
      reconcile();
    });
    video.addEventListener('play', updateButton);
    video.addEventListener('pause', updateButton);
    video.addEventListener('loadedmetadata', applySpeed);
    video.addEventListener('error', () => { userPaused = true; updateButton(); });
    motionPreference.addEventListener('change', event => {
      reduceMotion = event.matches;
      if (reduceMotion) {
        userPaused = true;
        const media = $('.premium-hero-slide.is-active .premium-hero-media') || $('.premium-hero-media');
        if (media) media.style.translate = '';
        $$('.reveal').forEach(node => node.classList.add('is-visible'));
      }
      reconcile();
    });
    document.addEventListener('visibilitychange', reconcile);
    document.addEventListener('integrall:hero-slide', reconcile);
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        inView = entries[0]?.isIntersecting === true;
        reconcile();
      }, {threshold: 0.05});
      observer.observe(hero);
    }
    applySpeed();
    reconcile();
  }

  function bindHeroSlider() {
    const hero = $('#heroSlider');
    if (!hero) return;
    const slides = $$('[data-hero-page]', hero);
    const dots = $$('[data-hero-go]', hero);
    const cta = $('#heroExplore');
    const videoToggle = $('#heroVideoToggle');
    if (slides.length < 2) return;

    const clearAuto = () => { if (heroAutoTimer) { clearTimeout(heroAutoTimer); heroAutoTimer = null; } };
    const scheduleAuto = () => {
      clearAuto();
      if (reduceMotion || document.hidden) return;
      heroAutoTimer = setTimeout(() => goTo(heroSlideIndex + 1, {manual: false}), 7600);
    };
    const goTo = (index, {manual = true} = {}) => {
      const next = ((Number(index) % slides.length) + slides.length) % slides.length;
      heroSlideIndex = next;
      slides.forEach((slide, i) => {
        const active = i === next;
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', String(!active));
      });
      dots.forEach((dot, i) => {
        const active = i === next;
        dot.classList.toggle('is-active', active);
        if (active) dot.setAttribute('aria-current', 'true'); else dot.removeAttribute('aria-current');
      });
      const current = slides[next];
      const page = current.dataset.heroPage || 'vitrine';
      const label = current.dataset.heroLabel || 'seleção';
      if (cta) {
        cta.dataset.heroPage = page;
        cta.setAttribute('aria-label', `Comprar ${label.toLocaleLowerCase('pt-BR')}`);
      }
      if (videoToggle) videoToggle.hidden = next !== 0;
      document.dispatchEvent(new CustomEvent('integrall:hero-slide', {detail: {index: next, page, manual}}));
      scheduleAuto();
    };

    $('#heroPrev')?.addEventListener('click', () => goTo(heroSlideIndex - 1));
    $('#heroNext')?.addEventListener('click', () => goTo(heroSlideIndex + 1));
    dots.forEach(dot => dot.addEventListener('click', () => goTo(Number(dot.dataset.heroGo))));
    hero.addEventListener('pointerenter', clearAuto);
    hero.addEventListener('pointerleave', scheduleAuto);
    hero.addEventListener('focusin', clearAuto);
    hero.addEventListener('focusout', event => { if (!hero.contains(event.relatedTarget)) scheduleAuto(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearAuto(); else scheduleAuto(); });
    motionPreference.addEventListener('change', event => { reduceMotion = event.matches; if (reduceMotion) clearAuto(); else scheduleAuto(); });
    goTo(0, {manual: false});
  }

  function syncHome() {
    const app = globalThis.__integrallApp;
    if (!app) return;
    const products = app.getState().products || [];
    const visible = product => product && !product.deletedAt && product.hidden !== true;
    $$('.premium-category-card[data-category-product]').forEach(card => {
      const category = card.dataset.premiumPage;
      const matches = product => visible(product) && (category === 'vinhos-importados'
        ? product.department === 'vinhos' && product.imported : product.department === category);
      const preferred = products.find(product => product.id === card.dataset.categoryProduct && matches(product));
      const product = preferred || products.find(product => matches(product) && app.productAvailable(product)) || products.find(matches);
      const image = $('img', card);
      if (image) {
        image.src = product ? app.productImages(product)[0] || app.placeholderImage(product.department, product.name) : app.placeholderImage(category, 'Seleção INTEGRALL');
        image.alt = product?.name || 'Seleção INTEGRALL';
      }
    });
    const feature = $('[data-featured-product]');
    if (!feature) return;
    const product = products.find(item => item.id === feature.dataset.featuredProduct);
    const variantId = feature.dataset.featuredVariant || '';
    const variants = product ? app.productVariants(product) : [];
    const variant = variants.find(item => item.id === variantId);
    const usable = visible(product) && (!variants.length || Boolean(variant)) && app.productAvailable(product, variants.length ? variantId : '');
    feature.hidden = !usable;
    if (!usable) return;
    const chosenId = variants.length ? variantId : '';
    const set = (name, value) => { const node = $(`[data-feature-${name}]`, feature); if (node) node.textContent = value || ''; };
    set('name', product.name);
    set('brand', product.brand);
    set('description', product.description);
    set('type', product.attributes?.wineType || product.subcategory);
    set('meta', [product.attributes?.grape, product.region || product.attributes?.origin, variant?.name || product.unit].filter(Boolean).join(' · '));
    set('price', app.priceLabel(app.linePrice(product, chosenId)));
    set('origin', product.region || product.attributes?.origin || product.country || 'Consulte');
    set('grape', product.attributes?.grape || 'Consulte');
    set('serving', product.attributes?.serving || 'Consulte');
    const image = $('.premium-feature-image img', feature);
    if (image) { image.src = app.variantDisplayImage(product, chosenId) || app.productImages(product)[0] || app.placeholderImage(product.department, product.name); image.alt = product.name; }
    $$('[data-open-product]', feature).forEach(button => { button.dataset.openProduct = product.id; button.dataset.openVariant = chosenId; });
  }

  function bindHeader() {
    if (!header) return;
    let ticking = false;
    const update = () => {
      header.classList.toggle('is-scrolled', window.scrollY > 30);
      if (!reduceMotion && !$('.premium-hero')?.classList.contains('is-video-paused')) {
        const media = $('.premium-hero-slide.is-active .premium-hero-media') || $('.premium-hero-media');
        if (media && window.scrollY < window.innerHeight * 1.15) {
          const y = Math.min(window.scrollY * .12, 80);
          media.style.translate = `0 ${y}px`;
        }
      }
      ticking = false;
    };
    update();
    addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(update); ticking = true; } }, {passive: true});
  }

  function bindReveal() {
    const nodes = $$('.reveal');
    if (!nodes.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      nodes.forEach(node => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, {threshold: .12, rootMargin: '0px 0px -5% 0px'});
    nodes.forEach(node => observer.observe(node));
  }

  function improveNativeNavigation() {
    // Existing data-page navigation remains untouched. We only move the viewport
    // to the real collection after category navigation to make the premium home useful.
    $$('#nav [data-page]').forEach(button => {
      button.addEventListener('click', () => {
        const page = button.dataset.page;
        $('#nav')?.classList.remove('open');
        $('#menuBtn')?.setAttribute('aria-expanded', 'false');
        if (page !== 'vitrine' || button.id === 'navStore') setTimeout(() => {
          if (!catalog) return;
          window.scrollTo({top: catalog.getBoundingClientRect().top + window.scrollY - 82, behavior: reduceMotion ? 'auto' : 'smooth'});
        }, 20);
      });
    });
  }

  function start() {
    bindHeroSlider();
    bindHeroVideo();
    syncHome();
    document.addEventListener('integrall:catalog-updated', syncHome);
    bindPremiumActions();
    bindHeader();
    bindReveal();
    improveNativeNavigation();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
})();
