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

// Valor Declarado: o código do serviço adicional VARIA POR SERVIÇO na tabela
// dos Correios — 019 = VD Nacional Premium (SEDEX), 064 = VD Nacional Standard
// (PAC). Enviar 019 num PAC faz a API recusar o adicional (ou o lote).
// Serviços fora do mapa cotam SEM valor declarado (preço sai; seguro não).
const DECLARED_VALUE_CODES = {
  '03220': '019', // SEDEX CONTRATO AG
  '03158': '019', // SEDEX 10
  '03140': '019', // SEDEX 12
  '03204': '019', // SEDEX HOJE
  '03298': '064', // PAC CONTRATO AG
  '03328': '064'  // PAC PAGAMENTO NA ENTREGA
};

const TOKEN_SAFETY_WINDOW_MS = 5 * 60 * 1000;
const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;
const QUOTE_CACHE_MAX = 500;
// Manual V2.4 (seção API Preço): "precificação de até 5 simulações" por lote.
const MAX_PARAMS_PER_BATCH = 5;

// Converte preço da API em centavos, tolerando ambos os formatos:
// brasileiro "1.234,56" (ponto = milhar) e internacional "1234.56" (ponto = decimal).
// Sem isso, um "28.50" seria lido como R$ 2.850,00 — erro de 100x em código financeiro.
function parsePriceCents(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  let normalized;
  if (text.includes(',')) normalized = text.replace(/\./g, '').replace(',', '.');
  else normalized = text;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

export class CorreiosService {
  constructor({user, accessCode, postageCard, contract, originCep, services, homolog = false, baseUrl, apiVersion, fetchImpl} = {}) {
    this.user = String(user || '').trim();
    this.accessCode = String(accessCode || '').trim();
    this.postageCard = digits(postageCard);
    this.contract = digits(contract);
    this.originCep = digits(originCep).slice(0, 8);
    this.homolog = Boolean(homolog);
    this.base = String(baseUrl || '').trim() || (this.homolog ? HOMOLOG_BASE : PRODUCTION_BASE);
    // O manual oficial diverge internamente: os exemplos cURL usam /preco/v1,
    // mas a seção "Ambientes Disponíveis" cita /preco/v3. Default v1 (o dos
    // exemplos); ajustável por CORREIOS_API_VERSION sem mudança de código.
    this.apiVersion = /^v\d+$/.test(String(apiVersion || '').trim()) ? String(apiVersion).trim() : 'v1';
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
   * Consolida os itens do pedido em pacotes (volumes) de envio.
   *
   * 1. CAIXAS REAIS: se o produto tem caixas cadastradas (`boxes` no catálogo,
   *    ex.: caixa fechada de 6 ou 12 vinhos com medidas e peso reais), as
   *    quantidades são encaixadas nas maiores caixas possíveis — medidas e
   *    pesos exatos, frete mais fiel.
   * 2. AVULSOS: o restante é empacotado em grade quase quadrada com itens EM
   *    PÉ (obrigatório para garrafas; minimiza o peso cúbico (C×L×A)/6000).
   *
   * Mínimos dos Correios: 16x11x2 cm; máximos: 100cm/lado, 30kg por volume.
   * Retorna {packages:[{weightGrams,lengthCm,widthCm,heightCm}], missingData, overweight}.
   */
  packOrder(items, productsById) {
    const packages = [];
    const loose = [];
    let missingData = false;

    for (const line of items || []) {
      const product = productsById.get(line.productId);
      if (!product) { missingData = true; continue; }
      const variantId = String(line.variantId || '');
      const variant = variantId ? (product.variants || []).find(v => v.id === variantId) : null;
      const unitWeight = Number(variant?.weightGrams ?? product.weightGrams);
      let qty = Math.max(1, Number(line.qty) || 1);
      if (!Number.isFinite(unitWeight) || unitWeight <= 0) { missingData = true; continue; }

      // Caixas reais do produto aplicáveis a esta variante (ou genéricas).
      const boxes = (product.boxes || [])
        .filter(box => !box.variantId || box.variantId === variantId)
        .sort((a, b) => b.units - a.units);
      for (const box of boxes) {
        while (qty >= box.units) {
          packages.push({
            weightGrams: Math.min(box.weightGrams, 30_000),
            lengthCm: Math.min(100, box.lengthCm),
            widthCm: Math.min(100, box.widthCm),
            heightCm: Math.min(100, box.heightCm)
          });
          qty -= box.units;
        }
      }

      if (qty > 0) {
        loose.push({
          qty,
          weightGrams: unitWeight,
          lengthCm: Math.min(100, Number(product.lengthCm) || 10),
          widthCm: Math.min(100, Number(product.widthCm) || 10),
          heightCm: Math.min(100, Number(product.heightCm) || 10)
        });
      }
    }

    // Empacota os avulsos em uma grade quase quadrada, itens em pé.
    if (loose.length) {
      let totalWeight = 0;
      let unitCount = 0;
      let maxUnitLength = 0;
      let maxUnitWidth = 0;
      let maxUnitHeight = 0;
      for (const item of loose) {
        totalWeight += item.weightGrams * item.qty;
        unitCount += item.qty;
        maxUnitLength = Math.max(maxUnitLength, item.lengthCm);
        maxUnitWidth = Math.max(maxUnitWidth, item.widthCm);
        maxUnitHeight = Math.max(maxUnitHeight, item.heightCm);
      }
      // Margem de embalagem: 10% do peso (caixa, proteção) com mínimo de 100g.
      totalWeight = Math.ceil(totalWeight * 1.1 + 100);

      let columns = Math.max(1, Math.ceil(Math.sqrt(unitCount)));
      let rows = Math.max(1, Math.ceil(unitCount / columns));
      let layers = 1;
      while ((columns * maxUnitLength + 4 > 100 || rows * maxUnitWidth + 4 > 100) && layers < 10) {
        layers += 1;
        const perLayer = Math.ceil(unitCount / layers);
        columns = Math.max(1, Math.ceil(Math.sqrt(perLayer)));
        rows = Math.max(1, Math.ceil(perLayer / columns));
      }
      packages.push({
        weightGrams: Math.min(totalWeight, 30_000),
        lengthCm: Math.max(16, Math.round(Math.min(100, columns * maxUnitLength + 4))),
        widthCm: Math.max(11, Math.round(Math.min(100, rows * maxUnitWidth + 4))),
        heightCm: Math.max(2, Math.round(Math.min(100, layers * maxUnitHeight + 4))),
        loose: true,
        looseWeightRaw: totalWeight
      });
    }

    if (!packages.length) {
      packages.push({weightGrams: 300, lengthCm: 16, widthCm: 11, heightCm: 10});
    }

    const overweight = packages.some(pkg => (pkg.looseWeightRaw || pkg.weightGrams) > 30_000);
    return {packages, missingData, overweight};
  }

  cacheKey(cepDestino, pack, declaredCents) {
    const volumes = pack.packages
      .map(pkg => `${pkg.weightGrams}:${pkg.lengthCm}x${pkg.widthCm}x${pkg.heightCm}`)
      .join('+');
    return `${cepDestino}|${volumes}|${declaredCents || 0}`;
  }

  /**
   * Consulta os eventos de rastreamento de um objeto (API Rastro / SRO).
   * GET /srorastro/v1/objetos/{codigo}?resultado=T — manual V2.4, seção 14.
   * Retorna eventos normalizados: [{at, description, detail, location}] (mais recente primeiro).
   */
  async trackShipment(trackingCode) {
    const code = String(trackingCode || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code)) throw new Error('Código de rastreio inválido.');
    let token = await this.authenticate();
    let response = await this.fetch(`${this.base}/srorastro/v1/objetos/${encodeURIComponent(code)}?resultado=T`, {
      method: 'GET',
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/json'},
      signal: AbortSignal.timeout(10_000)
    });
    if (response.status === 401) {
      // Token expirado no meio da sessão: renova e tenta uma vez mais
      // (mesmo comportamento do authorizedPost usado na cotação).
      this.token = null;
      token = await this.authenticate();
      response = await this.fetch(`${this.base}/srorastro/v1/objetos/${encodeURIComponent(code)}?resultado=T`, {
        method: 'GET',
        headers: {Authorization: `Bearer ${token}`, Accept: 'application/json'},
        signal: AbortSignal.timeout(10_000)
      });
    }
    if (!response.ok) throw new Error(`Rastro Correios indisponível (HTTP ${response.status}).`);
    const data = await response.json();
    const object = Array.isArray(data?.objetos) ? data.objetos[0] : null;
    if (!object || object.mensagem) throw new Error(object?.mensagem || 'Objeto não encontrado nos Correios.');
    const events = (Array.isArray(object.eventos) ? object.eventos : []).map(event => ({
      at: event.dtHrCriado || '',
      description: String(event.descricao || '').slice(0, 200),
      detail: String(event.detalhe || '').slice(0, 300),
      location: [event.unidade?.endereco?.cidade, event.unidade?.endereco?.uf].filter(Boolean).join(' - ')
    }));
    return {carrier: 'Correios', code, expectedDelivery: object.dtPrevista || '', events};
  }

  /**
   * Cota preço e prazo para todos os serviços configurados.
   * Retorna a opção mais barata como principal e a lista completa.
   * `declaredCents` (opcional) ativa o serviço adicional Valor Declarado
   * (019 = VD Nacional Premium/Padrão), incluindo o seguro no preço final —
   * essencial para envio de garrafas de vidro.
   */
  async quote(cepDestino, pack, declaredCents = 0) {
    const destination = digits(cepDestino).slice(0, 8);
    if (destination.length !== 8) throw new Error('CEP de destino inválido.');
    if (pack.missingData) throw new Error('Produtos sem peso cadastrado — configure peso/dimensões no catálogo.');
    if (pack.overweight) throw new Error('O pedido excede o limite de 30kg dos Correios; divida em mais de um pedido.');

    const key = this.cacheKey(destination, pack, declaredCents);
    const cached = this.quoteCache.get(key);
    if (cached && Date.now() - cached.at < QUOTE_CACHE_TTL_MS) return cached.value;

    const declared = Number.isSafeInteger(declaredCents) && declaredCents > 0
      ? Math.min(declaredCents, 10_000_000) : 0;
    const volumes = pack.packages;
    // Valor declarado distribuído proporcionalmente ao peso de cada volume.
    const totalWeight = volumes.reduce((sum, pkg) => sum + pkg.weightGrams, 0) || 1;
    // Uma requisição por (serviço × volume); a API aceita lote de parâmetros.
    const priceParams = [];
    for (const [serviceIndex, service] of this.services.entries()) {
      // Código do Valor Declarado correto PARA ESTE serviço (019 SEDEX,
      // 064 PAC); serviço sem código mapeado cota sem o adicional.
      const declaredCode = DECLARED_VALUE_CODES[service.code] || '';
      for (const [volumeIndex, pkg] of volumes.entries()) {
        const declaredShare = declared > 0 && declaredCode
          ? Math.max(1, Math.round(declared * pkg.weightGrams / totalWeight)) : 0;
        priceParams.push({
          coProduto: service.code,
          nuRequisicao: String(serviceIndex * volumes.length + volumeIndex + 1),
          cepOrigem: this.originCep,
          cepDestino: destination,
          psObjeto: String(pkg.weightGrams),
          tpObjeto: '2',
          comprimento: String(pkg.lengthCm),
          largura: String(pkg.widthCm),
          altura: String(pkg.heightCm),
          ...(declaredShare > 0 ? {
            servicosAdicionais: [{coServAdicional: declaredCode}],
            vlDeclarado: (declaredShare / 100).toFixed(2)
          } : {})
        });
      }
    }

    const prazoParams = this.services.map((service, index) => ({
      coProduto: service.code,
      nuRequisicao: String(index + 1),
      cepOrigem: this.originCep,
      cepDestino: destination
    }));

    // Fatia em lotes de até 5 parâmetros (limite do manual): com 2 serviços e
    // 3+ volumes o total passa de 5 e a API recusaria o lote inteiro.
    const priceBatches = [];
    for (let start = 0; start < priceParams.length; start += MAX_PARAMS_PER_BATCH) {
      priceBatches.push(priceParams.slice(start, start + MAX_PARAMS_PER_BATCH));
    }
    const [priceChunks, prazoData] = await Promise.all([
      Promise.all(priceBatches.map((batch, index) =>
        this.authorizedPost(`/preco/${this.apiVersion}/nacional`, {idLote: String(index + 1), parametrosProduto: batch}))),
      this.authorizedPost(`/prazo/${this.apiVersion}/nacional`, {idLote: '1', parametrosPrazo: prazoParams}).catch(() => null)
    ]);
    const priceData = priceChunks.flatMap(chunk => Array.isArray(chunk) ? chunk : []);

    const prazoByService = new Map();
    for (const item of Array.isArray(prazoData) ? prazoData : []) {
      const days = Number(item?.prazoEntrega);
      if (item?.coProduto && Number.isFinite(days)) prazoByService.set(String(item.coProduto), days);
    }

    // Soma o preço de todos os volumes por serviço; o serviço só é oferecido
    // se TODOS os volumes tiverem preço válido.
    const totals = new Map();
    for (const item of Array.isArray(priceData) ? priceData : []) {
      if (!item) continue;
      const code = String(item.coProduto || '');
      const entry = totals.get(code) || {sumCents: 0, count: 0, failed: false};
      if (item.txErro) { entry.failed = true; totals.set(code, entry); continue; }
      const priceCents = parsePriceCents(item.pcFinal ?? item.pcProduto);
      if (priceCents == null) { entry.failed = true; totals.set(code, entry); continue; }
      entry.sumCents += priceCents;
      entry.count += 1;
      totals.set(code, entry);
    }

    const options = [];
    for (const service of this.services) {
      const entry = totals.get(service.code);
      if (!entry || entry.failed || entry.count !== volumes.length) continue;
      const days = prazoByService.get(service.code);
      options.push({
        code: service.code,
        label: service.label,
        priceCents: entry.sumCents,
        days: Number.isFinite(days) ? days : null,
        volumes: volumes.length
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
