/**
 * Integração com a API de contrato dos Correios (CWS).
 *
 * Autenticação: POST /token/v1/autentica/cartaopostagem com Basic Auth
 * (usuário Meu Correios + código de acesso a APIs gerado no CWS).
 * Preço:  POST /preco/v1/nacional
 * Prazo:  POST /prazo/v1/nacional
 *
 * Manuais oficiais:
 * - https://www.correios.com.br/atendimento/developers/manuais/manual-api-preco-1
 * - https://www.correios.com.br/atendimento/developers/manuais/manual-api-prazo
 */

const PRODUCTION_BASE = 'https://api.correios.com.br';
const HOMOLOG_BASE = 'https://apihom.correios.com.br';

// Códigos de serviço mais comuns em contrato (podem variar conforme o contrato):
// 03220 = SEDEX CONTRATO AG, 03298 = PAC CONTRATO AG
const DEFAULT_SERVICES = [
  {code: '03298', label: 'PAC'},
  {code: '03220', label: 'SEDEX'}
];

const TOKEN_SAFETY_WINDOW_MS = 5 * 60 * 1000;
const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;
const QUOTE_CACHE_MAX = 500;

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

export class CorreiosService {
  constructor({user, accessCode, postageCard, contract, originCep, services, homolog = false, baseUrl, fetchImpl} = {}) {
    this.user = String(user || '').trim();
    this.accessCode = String(accessCode || '').trim();
    this.postageCard = digits(postageCard);
    this.contract = digits(contract);
    this.originCep = digits(originCep).slice(0, 8);
    this.homolog = Boolean(homolog);
    this.base = String(baseUrl || '').trim() || (this.homolog ? HOMOLOG_BASE : PRODUCTION_BASE);
    this.services = this.parseServices(services);
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.token = null;
    this.tokenExpiresAt = 0;
    this.tokenPromise = null;
    this.quoteCache = new Map();
  }

  parseServices(value) {
    if (!value) return DEFAULT_SERVICES;
    const parsed = String(value).split(',').map(entry => {
      const [code, label] = entry.split(':').map(part => String(part || '').trim());
      if (!/^\d{5}$/.test(code)) return null;
      return {code, label: label || code};
    }).filter(Boolean);
    return parsed.length ? parsed : DEFAULT_SERVICES;
  }

  get configured() {
    return Boolean(this.user && this.accessCode && this.postageCard && this.originCep.length === 8);
  }

  async authenticate() {
    if (this.token && Date.now() < this.tokenExpiresAt - TOKEN_SAFETY_WINDOW_MS) return this.token;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = this.requestToken().finally(() => { this.tokenPromise = null; });
    return this.tokenPromise;
  }

  async requestToken() {
    const basic = Buffer.from(`${this.user}:${this.accessCode}`).toString('base64');
    const body = {numero: this.postageCard};
    if (this.contract) body.contrato = this.contract;
    const response = await this.fetch(`${this.base}/token/v1/autentica/cartaopostagem`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Falha na autenticação Correios (HTTP ${response.status}). ${detail.slice(0, 300)}`);
    }
    const data = await response.json();
    if (!data?.token) throw new Error('Os Correios não retornaram um token de acesso.');
    this.token = data.token;
    const expires = Date.parse(data.expiraEm || '');
    this.tokenExpiresAt = Number.isFinite(expires) ? expires : Date.now() + 30 * 60 * 1000;
    return this.token;
  }

  async authorizedPost(path, payload) {
    let token = await this.authenticate();
    let response = await this.fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000)
    });
    if (response.status === 401) {
      this.token = null;
      token = await this.authenticate();
      response = await this.fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12_000)
      });
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Erro na API dos Correios (HTTP ${response.status}). ${detail.slice(0, 300)}`);
    }
    return response.json();
  }

  /**
   * Consolida os itens do pedido em um único pacote.
   * Estratégia: soma pesos; a caixa cresce na altura (empilhamento simples),
   * respeitando os mínimos dos Correios (16x11x2 cm, dims somadas <= 200cm; peso <= 30kg).
   */
  packOrder(items, productsById) {
    let totalWeight = 0;
    let maxLength = 16;
    let maxWidth = 11;
    let stackedHeight = 0;
    let missingData = false;

    for (const line of items || []) {
      const product = productsById.get(line.productId);
      if (!product) { missingData = true; continue; }
      const variant = line.variantId ? (product.variants || []).find(v => v.id === line.variantId) : null;
      const unitWeight = Number(variant?.weightGrams ?? product.weightGrams);
      const qty = Math.max(1, Number(line.qty) || 1);
      if (!Number.isFinite(unitWeight) || unitWeight <= 0) { missingData = true; continue; }
      totalWeight += unitWeight * qty;
      const length = Number(product.lengthCm) || 0;
      const width = Number(product.widthCm) || 0;
      const height = Number(product.heightCm) || 0;
      if (length > 0) maxLength = Math.max(maxLength, Math.min(100, length));
      if (width > 0) maxWidth = Math.max(maxWidth, Math.min(100, width));
      if (height > 0) stackedHeight += Math.min(100, height) * qty;
    }

    // Margem de embalagem: 10% do peso (caixa, proteção) com mínimo de 100g.
    totalWeight = Math.ceil(totalWeight * 1.1 + 100);
    const height = Math.max(2, Math.min(100, stackedHeight || 10));

    return {
      weightGrams: Math.min(totalWeight, 30_000),
      lengthCm: Math.max(16, maxLength),
      widthCm: Math.max(11, maxWidth),
      heightCm: height,
      missingData,
      overweight: totalWeight > 30_000
    };
  }

  cacheKey(cepDestino, pack) {
    return `${cepDestino}|${pack.weightGrams}|${pack.lengthCm}x${pack.widthCm}x${pack.heightCm}`;
  }

  /**
   * Cota preço e prazo para todos os serviços configurados.
   * Retorna a opção mais barata como principal e a lista completa.
   */
  async quote(cepDestino, pack) {
    const destination = digits(cepDestino).slice(0, 8);
    if (destination.length !== 8) throw new Error('CEP de destino inválido.');
    if (pack.missingData) throw new Error('Produtos sem peso cadastrado — configure peso/dimensões no catálogo.');
    if (pack.overweight) throw new Error('O pedido excede o limite de 30kg dos Correios; divida em mais de um pedido.');

    const key = this.cacheKey(destination, pack);
    const cached = this.quoteCache.get(key);
    if (cached && Date.now() - cached.at < QUOTE_CACHE_TTL_MS) return cached.value;

    const priceParams = this.services.map((service, index) => ({
      coProduto: service.code,
      nuRequisicao: String(index + 1),
      cepOrigem: this.originCep,
      cepDestino: destination,
      psObjeto: String(pack.weightGrams),
      tpObjeto: '2',
      comprimento: String(pack.lengthCm),
      largura: String(pack.widthCm),
      altura: String(pack.heightCm)
    }));

    const prazoParams = this.services.map((service, index) => ({
      coProduto: service.code,
      nuRequisicao: String(index + 1),
      cepOrigem: this.originCep,
      cepDestino: destination
    }));

    const [priceData, prazoData] = await Promise.all([
      this.authorizedPost('/preco/v1/nacional', {idLote: '1', parametrosProduto: priceParams}),
      this.authorizedPost('/prazo/v1/nacional', {idLote: '1', parametrosPrazo: prazoParams}).catch(() => null)
    ]);

    const prazoByService = new Map();
    for (const item of Array.isArray(prazoData) ? prazoData : []) {
      const days = Number(item?.prazoEntrega);
      if (item?.coProduto && Number.isFinite(days)) prazoByService.set(String(item.coProduto), days);
    }

    const options = [];
    for (const item of Array.isArray(priceData) ? priceData : []) {
      if (!item || item.txErro) continue;
      const raw = String(item.pcFinal ?? item.pcProduto ?? '').replace(/\./g, '').replace(',', '.');
      const price = Number(raw);
      if (!Number.isFinite(price) || price <= 0) continue;
      const service = this.services.find(entry => entry.code === String(item.coProduto));
      const days = prazoByService.get(String(item.coProduto));
      options.push({
        code: String(item.coProduto),
        label: service?.label || String(item.coProduto),
        priceCents: Math.round(price * 100),
        days: Number.isFinite(days) ? days : null
      });
    }

    if (!options.length) throw new Error('Os Correios não retornaram preço para este CEP.');
    options.sort((a, b) => a.priceCents - b.priceCents);
    const value = {options, cheapest: options[0]};
    if (this.quoteCache.size >= QUOTE_CACHE_MAX) {
      const oldest = this.quoteCache.keys().next().value;
      this.quoteCache.delete(oldest);
    }
    this.quoteCache.set(key, {at: Date.now(), value});
    return value;
  }
}
