import {ShippingProvider} from './providers.js';
import {MAX_SHIPPING_PACKAGES, normalizeShippingCep, packRegisteredOrder, validPackage} from './shipping-packages.js';

// Documentação consultada: manuais oficiais Preço, Prazo e Token (CWS).
// A versão do catálogo "v3" NÃO altera as rotas /v1 que o usuário validou.
const BASES = ['https://api.correios.com.br', 'https://apihom.correios.com.br'];
const DEFAULT_SERVICES = [{code: '03298', label: 'PAC'}, {code: '03220', label: 'SEDEX'}];
const DECLARED_VALUE_CODES = {'03298': '064', '03220': '019', '03158': '019', '03140': '019', '03204': '019', '03328': '064'};
const CACHE_TTL = 5 * 60_000;
const MAX_PARAMS_PER_BATCH = 5; // Conservador; compatível também com o manual V2.4.

export class CorreiosApiError extends Error {
  constructor(code, message, status = 502) { super(message); this.name = 'CorreiosApiError'; this.code = code; this.status = status; }
}
const apiError = (code, message, status) => new CorreiosApiError(code, message, status);

export function parsePriceCents(raw) {
  // Só formatos monetários explícitos: recusa exponenciais, NaN, negativos e
  // casas decimais extras em vez de arredondar silenciosamente dinheiro.
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let text = String(raw).trim();
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(text) || /^\d+,\d{2}$/.test(text)) text = text.replaceAll('.', '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) && result > 0 && result <= 100_000_000 ? result : null;
}

export function correiosTokenExpiry(data) {
  const values = [];
  if (typeof data?.expiraEm === 'string') {
    let text = data.expiraEm;
    // O CWS retorna horário de Brasília sem offset em parte dos ambientes.
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(text)) text += '-03:00';
    const date = Date.parse(text); if (Number.isFinite(date)) values.push(date);
  }
  // Apenas informação de validade de token recebido diretamente por HTTPS;
  // não é validação de assinatura nem autorização de uma entrada do usuário.
  try {
    const parts = data.token.split('.');
    if (parts.length === 3) {
      const exp = JSON.parse(Buffer.from(parts[1], 'base64url').toString()).exp;
      if (Number.isSafeInteger(exp) && exp > 0) values.push(exp * 1000);
    }
  } catch { /* expiraEm continua obrigatório quando não há exp reconhecível. */ }
  return values.length ? Math.min(...values) : 0;
}

async function parallelMap(items, fn, workers = 4) {
  const results = Array(items.length); let index = 0;
  await Promise.all(Array.from({length: Math.min(workers, items.length)}, async () => {
    while (index < items.length) { const i = index++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

export class CorreiosService extends ShippingProvider {
  constructor({user, accessCode, postageCard, contract, contractDr, authType = 'auto', originCep, services,
    homolog = false, baseUrl, apiVersion, quoteMethod = 'GET', declaredValueEnabled = false,
    fetchImpl, now = Date.now, timeoutMs = 8000, allowTestBase = false} = {}) {
    super({providerId: 'correios', capabilities: {quote: true, tracking: true}});
    this.user = String(user || '').trim();
    this.accessCode = String(accessCode || '').trim();
    this.postageCard = String(postageCard || '').trim();
    this.contract = String(contract || '').trim();
    this.contractDr = contractDr == null || contractDr === '' ? null : Number(contractDr);
    this.authType = authType === 'auto' || !authType ? (this.contract ? 'contrato' : 'cartaopostagem') : authType;
    this.originCep = normalizeShippingCep(originCep);
    this.homolog = Boolean(homolog);
    this.base = String(baseUrl || BASES[this.homolog ? 1 : 0]).replace(/\/$/, '');
    // Credenciais nunca são enviadas a domínio arbitrário nem a redirecionamento.
    let localTest = false;
    try { const u = new URL(this.base); localTest = allowTestBase && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname) && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash; } catch { /* configuração inválida */ }
    this.safeBase = BASES.includes(this.base) || localTest;
    this.apiVersion = /^v\d+$/.test(String(apiVersion || '')) ? apiVersion : 'v1';
    this.quoteMethod = quoteMethod === 'POST' ? 'POST' : 'GET';
    this.declaredValueEnabled = declaredValueEnabled === true;
    this.services = this.parseServices(services);
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.now = now;
    this.timeoutMs = Math.max(50, Math.min(12_000, Number(timeoutMs) || 8000));
    this.token = null; this.tokenExpiresAt = 0; this.tokenRefreshAt = 0; this.tokenPromise = null;
    this.cooldownUntil = 0; this.quoteCache = new Map(); this.quoteFlights = new Map();
  }
  parseServices(value) {
    if (!value) return DEFAULT_SERVICES.map(s => ({...s}));
    const list = String(value).split(',').map(entry => {
      const [code, ...label] = entry.split(':').map(s => s.trim());
      return /^\d{5}$/.test(code) ? {code, label: (label.join(':') || code).slice(0, 60)} : null;
    });
    return list.length <= 4 && list.every(Boolean) && new Set(list.map(s => s.code)).size === list.length ? list : [];
  }
  get configured() {
    const identity = this.authType === 'contrato' ? /^\d{8,15}$/.test(this.contract)
      : this.authType === 'cartaopostagem' && /^\d{8,15}$/.test(this.postageCard) && (!this.contract || /^\d{8,15}$/.test(this.contract));
    return Boolean(this.safeBase && this.user && !/[\r\n:]/.test(this.user) && this.accessCode && !/[\r\n]/.test(this.accessCode)
      && identity && this.originCep && this.services.length && (this.contractDr == null || Number.isInteger(this.contractDr) && this.contractDr >= 0 && this.contractDr <= 99));
  }
  async requestJson(path, options, outerSignal) {
    if (!this.configured) throw apiError('CORREIOS_NOT_CONFIGURED', 'Integração dos Correios não configurada no servidor.', 503);
    if (this.now() < this.cooldownUntil) throw apiError('CORREIOS_RETRY_LATER', 'Os Correios estão temporariamente indisponíveis. Tente novamente em instantes.', 503);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout;
    try {
      const response = await this.fetch(`${this.base}${path}`, {...options, redirect: 'error', signal});
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) this.cooldownUntil = this.now() + 10_000;
        // Não copia body/cURL/Authorization retornados por terceiros para logs.
        try { await response.body?.cancel(); } catch { /* nada a expor */ }
        throw apiError(response.status === 401 ? 'CORREIOS_UNAUTHORIZED' : response.status === 403 ? 'CORREIOS_FORBIDDEN' : 'CORREIOS_HTTP_ERROR',
          response.status === 403 ? 'Os Correios não autorizaram esta consulta. Verifique as permissões do contrato.'
          : `Não foi possível consultar os Correios (HTTP ${response.status}).`, response.status === 401 || response.status === 403 ? 503 : 502);
      }
      let data;
      if (response.body?.getReader) {
        const reader = response.body.getReader(); const chunks = []; let size = 0;
        try {
          while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length;
            if (size > 262144) { await reader.cancel(); throw new Error('response-too-large'); } chunks.push(Buffer.from(value)); }
          data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } finally { reader.releaseLock(); }
      } else { data = await response.json(); }
      if (!data || typeof data !== 'object') throw new Error('invalid-json');
      return data;
    } catch (error) {
      if (error instanceof CorreiosApiError) throw error;
      if (signal.aborted) throw apiError('CORREIOS_TIMEOUT', 'Os Correios demoraram para responder. Tente calcular novamente.', 504);
      throw apiError('CORREIOS_RESPONSE_INVALID', 'Falha de comunicação ou resposta inválida dos Correios.', 502);
    }
  }
  async authenticate() {
    if (this.token && this.now() < this.tokenRefreshAt) return this.token;
    if (!this.tokenPromise) this.tokenPromise = this.requestToken().finally(() => { this.tokenPromise = null; });
    return this.tokenPromise;
  }
  async requestToken() {
    const body = {numero: this.authType === 'contrato' ? this.contract : this.postageCard};
    if (this.authType === 'cartaopostagem' && this.contract) body.contrato = this.contract;
    if (this.contractDr != null) body.dr = this.contractDr;
    const data = await this.requestJson(`/token/v1/autentica/${this.authType}`, {
      method: 'POST', headers: {Authorization: `Basic ${Buffer.from(`${this.user}:${this.accessCode}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(body)
    });
    const expires = correiosTokenExpiry(data);
    if (typeof data.token !== 'string' || !data.token || /\s/.test(data.token) || expires <= this.now() + 5000) {
      throw apiError('CORREIOS_TOKEN_INVALID', 'Os Correios não retornaram um token com validade utilizável.', 503);
    }
    this.token = data.token; this.tokenExpiresAt = expires;
    this.tokenRefreshAt = expires - Math.min(60_000, Math.floor((expires - this.now()) / 10));
    return this.token;
  }
  async authorizedRequest(path, options = {}, signal) {
    let token = await this.authenticate();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await this.requestJson(path, {...options, headers: {Accept: 'application/json', ...options.headers, Authorization: `Bearer ${token}`}}, signal); }
      catch (error) {
        if (error.code !== 'CORREIOS_UNAUTHORIZED' || attempt) throw error;
        // Um 401 atrasado do token antigo não invalida um token recém-renovado.
        if (this.token === token) { this.token = null; this.tokenRefreshAt = 0; }
        token = await this.authenticate();
      }
    }
  }
  async authorizedPost(path, payload, signal) {
    return this.authorizedRequest(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)}, signal);
  }
  packOrder(items, productsById) { return packRegisteredOrder(items, productsById); }
  cacheKey(destination, pack, declaredCents) {
    const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo'}).format(new Date(this.now()));
    return JSON.stringify([this.base, this.originCep, this.services, this.apiVersion, this.quoteMethod, destination, pack.packages, this.declaredValueEnabled ? declaredCents : 0, day]);
  }
  async quote(cepDestino, pack, declaredCents = 0, {bypassCache = false} = {}) {
    const destination = normalizeShippingCep(cepDestino);
    if (!destination) throw apiError('SHIPPING_CEP_INVALID', 'CEP de destino inválido.', 400);
    if (pack?.overweight) throw apiError('SHIPPING_PACKAGE_OVERWEIGHT', 'Uma caixa excede 30kg. Cadastre volumes menores ou solicite cotação manual.', 422);
    if (pack?.missingData || !Array.isArray(pack?.packages) || !pack.packages.length || pack.packages.length > MAX_SHIPPING_PACKAGES || !pack.packages.every(validPackage)) {
      throw apiError('SHIPPING_PACKAGING_REQUIRED', 'Faltam embalagens reais com peso válido e dimensões válidas para esta quantidade. Solicite cotação à loja.', 422);
    }
    const key = this.cacheKey(destination, pack, declaredCents);
    const cached = this.quoteCache.get(key);
    if (!bypassCache && cached && this.now() < cached.expiresAt) return structuredClone(cached.value);
    const flightKey = `${bypassCache ? 'fresh' : 'cache'}|${key}`;
    if (!this.quoteFlights.has(flightKey)) {
      if (this.quoteFlights.size >= 12) throw apiError('SHIPPING_BUSY', 'Muitas cotações em andamento. Tente novamente em instantes.', 503);
      this.quoteFlights.set(flightKey, this.quoteUncached(destination, pack, declaredCents).then(value => {
        if (this.quoteCache.size >= 500) this.quoteCache.delete(this.quoteCache.keys().next().value);
        this.quoteCache.set(key, {value, expiresAt: this.now() + CACHE_TTL}); return value;
      }).finally(() => this.quoteFlights.delete(flightKey)));
    }
    return structuredClone(await this.quoteFlights.get(flightKey));
  }
  async quoteUncached(destination, pack, declaredCents) {
    const deadline = AbortSignal.timeout(22_000);
    const volumes = pack.packages;
    const declared = this.declaredValueEnabled && Number.isSafeInteger(declaredCents) && declaredCents > 0 ? declaredCents : 0;
    const weight = volumes.reduce((sum, p) => sum + p.weightGrams, 0);
    const jobs = [];
    for (const [si, service] of this.services.entries()) {
      let distributed = 0;
      for (const [vi, pkg] of volumes.entries()) {
        const share = vi === volumes.length - 1 ? declared - distributed : Math.floor(declared * pkg.weightGrams / weight); distributed += share;
        const params = {coProduto: service.code, nuRequisicao: String(si * volumes.length + vi + 1), cepOrigem: this.originCep, cepDestino: destination, psObjeto: String(pkg.weightGrams), tpObjeto: '2', comprimento: String(pkg.lengthCm), largura: String(pkg.widthCm), altura: String(pkg.heightCm)};
        if (declared > 0) {
          const code = DECLARED_VALUE_CODES[service.code];
          if (!code) throw apiError('SHIPPING_DECLARED_VALUE_UNSUPPORTED', 'Valor declarado não configurado para um dos serviços de envio.', 503);
          if (share > 0) { params.servicosAdicionais = [{coServAdicional: code}]; params.vlDeclarado = (share / 100).toFixed(2); }
        }
        jobs.push(params);
      }
    }
    const prices = new Map(); const terms = new Map(); const failures = [];
    const capture = async fn => { try { return await fn(); } catch (e) { failures.push(e); return null; } };
    if (this.quoteMethod === 'POST') {
      const batches = []; for (let i = 0; i < jobs.length; i += MAX_PARAMS_PER_BATCH) batches.push(jobs.slice(i, i + MAX_PARAMS_PER_BATCH));
      await Promise.all([
        parallelMap(batches, async batch => {
          const result = await capture(() => this.authorizedPost(`/preco/${this.apiVersion}/nacional`, {idLote: batch[0].nuRequisicao, parametrosProduto: batch}, deadline));
          if (!Array.isArray(result)) return;
          for (const job of batch) {
            const matched = result.filter(r => String(r.coProduto) === job.coProduto && (String(r.nuRequisicao) === job.nuRequisicao || r.nuRequisicao == null && batch.filter(j => j.coProduto === job.coProduto).length === 1));
            if (matched.length === 1) prices.set(job.nuRequisicao, matched[0]);
          }
        }),
        capture(async () => {
          const result = await this.authorizedPost(`/prazo/${this.apiVersion}/nacional`, {idLote: 'prazo', parametrosPrazo: this.services.map((s, i) => ({coProduto: s.code, nuRequisicao: String(i+1), cepOrigem: this.originCep, cepDestino: destination}))}, deadline);
          if (Array.isArray(result)) for (const s of this.services) { const found = result.filter(r => String(r.coProduto) === s.code); if (found.length === 1) terms.set(s.code, found[0]); }
        })
      ]);
    } else {
      const tasks = [
        ...jobs.map(job => async () => {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(job)) if (!['coProduto', 'nuRequisicao', 'servicosAdicionais'].includes(key)) params.set(key, value);
          for (const extra of job.servicosAdicionais || []) params.append('servicosAdicionais', extra.coServAdicional);
          const result = await this.authorizedRequest(`/preco/${this.apiVersion}/nacional/${job.coProduto}?${params}`, {method: 'GET'}, deadline);
          if (String(result.coProduto) === job.coProduto) prices.set(job.nuRequisicao, result);
        }),
        ...this.services.map(service => async () => {
          const params = new URLSearchParams({cepOrigem: this.originCep, cepDestino: destination});
          const result = await this.authorizedRequest(`/prazo/${this.apiVersion}/nacional/${service.code}?${params}`, {method: 'GET'}, deadline);
          if (String(result.coProduto) === service.code) terms.set(service.code, result);
        })
      ];
      await parallelMap(tasks, task => capture(task));
    }
    const options = [];
    for (const service of this.services) {
      const term = terms.get(service.code);
      const days = term?.prazoEntrega == null || term.prazoEntrega === '' ? NaN : Number(term.prazoEntrega);
      if (!term || term.txErro || !Number.isSafeInteger(days) || days < 0 || days > 365) continue;
      let sum = 0; let valid = true;
      for (const job of jobs.filter(j => j.coProduto === service.code)) {
        const response = prices.get(job.nuRequisicao);
        const cents = parsePriceCents(response?.pcFinal);
        if (!response || response.txErro || cents == null) { valid = false; break; }
        sum += cents;
      }
      if (!valid || !Number.isSafeInteger(sum) || sum <= 0) continue;
      options.push({code: service.code, label: service.label, priceCents: sum, days, volumes: volumes.length,
        deadline: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(term.dataMaxima || '') ? term.dataMaxima : '',
        homeDelivery: ['S','N'].includes(term.entregaDomiciliar) ? term.entregaDomiciliar === 'S' : null,
        saturdayDelivery: ['S','N'].includes(term.entregaSabado) ? term.entregaSabado === 'S' : null,
        sundayDelivery: ['S','N'].includes(term.entregaDomingo) ? term.entregaDomingo === 'S' : null,
        declaredValueIncluded: declared > 0});
    }
    if (!options.length) throw failures[0] || apiError('SHIPPING_UNAVAILABLE', 'Não há opção com preço e prazo válidos para este envio. Solicite cotação à loja.', 422);
    options.sort((a,b) => a.priceCents - b.priceCents || a.code.localeCompare(b.code));
    return {options, cheapest: options[0], quotedAt: new Date(this.now()).toISOString(), partial: options.length !== this.services.length};
  }
  async trackShipment(trackingCode) {
    const code = String(trackingCode || '').trim().toUpperCase();
    if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code)) throw new Error('Código de rastreio inválido.');
    const data = await this.authorizedRequest(`/srorastro/v1/objetos/${code}?resultado=T`, {method:'GET'});
    const object = Array.isArray(data?.objetos) ? data.objetos[0] : null;
    if (!object || object.mensagem) throw apiError('CORREIOS_TRACKING_NOT_FOUND', 'Objeto não encontrado nos Correios.');
    const events = (Array.isArray(object.eventos) ? object.eventos : []).map(event => ({at: event.dtHrCriado || '', description: String(event.descricao || '').slice(0,200), detail: String(event.detalhe || '').slice(0,300), location: [event.unidade?.endereco?.cidade,event.unidade?.endereco?.uf].filter(Boolean).join(' - ')}));
    return {carrier:'Correios',code,expectedDelivery:object.dtPrevista || '',events};
  }
}
