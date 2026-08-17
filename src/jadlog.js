/**
 * Integração com a API Embarcador da Jadlog (Simulador de Frete).
 *
 * Endpoint: POST https://www.jadlog.com.br/embarcador/api/frete/valor
 * Autenticação: token fixo fornecido pela franquia Jadlog, enviado no
 * header Authorization de todas as requisições.
 *
 * Campos por item de "frete": cepori, cepdes, frap, peso (KG — sempre o MAIOR
 * entre o peso real e o cubado), cnpj, conta, contrato, modalidade,
 * tpentrega (D/R), tpseguro (N/A), vldeclarado, vlcoleta.
 * Resposta: frete[i].vltotal (R$) e frete[i].prazo (dias úteis).
 *
 * Manual: https://www.jadlog.com.br/jadlog/arquivos/api_integracao.pdf (v2.3, ago/2025)
 */

const PRODUCTION_BASE = 'https://www.jadlog.com.br';
const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;
const QUOTE_CACHE_MAX = 500;
const MAX_ITEMS_PER_REQUEST = 3;

// Cubagem rodoviária Jadlog: 166,67 kg/m³ (equivale a C×L×A em cm ÷ 6000).
const CUBIC_DIVISOR = 6000;

const MODALIDADE_LABELS = {
  0: 'Expresso',
  3: '.Package',
  4: 'Rodoviário',
  5: 'Econômico',
  6: 'Doc',
  7: 'Corporate',
  9: '.Com',
  10: 'Internet',
  12: 'Cargo',
  14: 'Emergencial'
};

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

export class JadlogService {
  constructor({token, cnpj, conta, contrato, originCep, modalidade = 3, tpEntrega = 'D', baseUrl, fetchImpl} = {}) {
    this.token = String(token || '').trim();
    this.cnpj = digits(cnpj);
    this.conta = String(conta || '').trim();
    this.contrato = String(contrato || '').trim();
    this.originCep = digits(originCep).slice(0, 8);
    this.modalidade = Number.isInteger(Number(modalidade)) ? Number(modalidade) : 3;
    this.tpEntrega = tpEntrega === 'R' ? 'R' : 'D';
    this.base = String(baseUrl || '').trim() || PRODUCTION_BASE;
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.quoteCache = new Map();
  }

  get configured() {
    return Boolean(this.token && this.cnpj.length === 14 && this.originCep.length === 8);
  }

  get label() {
    return `Jadlog ${MODALIDADE_LABELS[this.modalidade] || `mod. ${this.modalidade}`}`;
  }

  /** Peso a informar: o maior entre real e cubado, por volume (exigência do manual). */
  chargeableKg(pkg) {
    const realKg = pkg.weightGrams / 1000;
    const cubicKg = (pkg.lengthCm * pkg.widthCm * pkg.heightCm) / CUBIC_DIVISOR;
    return Math.max(realKg, cubicKg);
  }

  cacheKey(cepDestino, pack, declaredCents) {
    const volumes = pack.packages
      .map(pkg => `${pkg.weightGrams}:${pkg.lengthCm}x${pkg.widthCm}x${pkg.heightCm}`)
      .join('+');
    return `${cepDestino}|${volumes}|${declaredCents || 0}`;
  }

  /**
   * Consulta o rastreamento de uma remessa (Consulta do Tracking, manual v2.3).
   * POST /embarcador/api/tracking/consultar com {consulta:[{shipmentId}]} ou codigo.
   * Retorna eventos normalizados (mais recente primeiro).
   */
  async trackShipment(trackingCode) {
    const code = String(trackingCode || '').trim();
    if (!code) throw new Error('Código de rastreio inválido.');
    const query = /^\d{8,14}$/.test(code) ? {shipmentId: code} : {codigo: code};
    const response = await this.fetch(`${this.base}/embarcador/api/tracking/consultar`, {
      method: 'POST',
      headers: {Authorization: this.token, 'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({consulta: [query]}),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Rastro Jadlog indisponível (HTTP ${response.status}).`);
    const data = await response.json();
    const entry = Array.isArray(data?.consulta) ? data.consulta[0] : null;
    const tracking = entry?.tracking;
    if (!tracking) throw new Error(entry?.erro?.descricao || 'Remessa não encontrada na Jadlog.');
    const events = (Array.isArray(tracking.eventos) ? tracking.eventos : []).map(event => ({
      at: event.data || '',
      description: String(event.status || '').slice(0, 200),
      detail: '',
      location: String(event.unidade || '').slice(0, 120)
    })).reverse();
    return {carrier: 'Jadlog', code, expectedDelivery: entry.previsaoEntrega || '', events};
  }

  /**
   * Cota o frete para os volumes do pedido. Retorna a mesma forma dos demais
   * transportadores: {options: [{code, label, priceCents, days, volumes}], cheapest}.
   */
  async quote(cepDestino, pack, declaredCents = 0) {
    const destination = digits(cepDestino).slice(0, 8);
    if (destination.length !== 8) throw new Error('CEP de destino inválido.');
    if (pack.missingData) throw new Error('Produtos sem peso cadastrado — configure peso/dimensões no catálogo.');

    const key = this.cacheKey(destination, pack, declaredCents);
    const cached = this.quoteCache.get(key);
    if (cached && Date.now() - cached.at < QUOTE_CACHE_TTL_MS) return cached.value;

    const declared = Number.isSafeInteger(declaredCents) && declaredCents > 0
      ? Math.min(declaredCents, 10_000_000) : 0;
    const totalWeight = pack.packages.reduce((sum, pkg) => sum + pkg.weightGrams, 0) || 1;

    const items = pack.packages.map(pkg => {
      const declaredShare = declared > 0
        ? Math.max(1, Math.round(declared * pkg.weightGrams / totalWeight)) : 0;
      return {
        cepori: this.originCep,
        cepdes: destination,
        frap: 'N',
        peso: Math.round(this.chargeableKg(pkg) * 100) / 100,
        cnpj: this.cnpj,
        conta: this.conta || undefined,
        contrato: this.contrato || null,
        modalidade: this.modalidade,
        tpentrega: this.tpEntrega,
        tpseguro: 'N',
        vldeclarado: declaredShare > 0 ? Math.round(declaredShare) / 100 : 0,
        vlcoleta: 0
      };
    });

    // A API aceita 1-3 itens por chamada; fatia em lotes quando houver mais volumes.
    let totalCents = 0;
    let maxDays = null;
    for (let start = 0; start < items.length; start += MAX_ITEMS_PER_REQUEST) {
      const slice = items.slice(start, start + MAX_ITEMS_PER_REQUEST);
      const response = await this.fetch(`${this.base}/embarcador/api/frete/valor`, {
        method: 'POST',
        headers: {
          Authorization: this.token,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({frete: slice}),
        signal: AbortSignal.timeout(12_000)
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Erro na API da Jadlog (HTTP ${response.status}). ${detail.slice(0, 300)}`);
      }
      const data = await response.json();
      if (data?.error?.descricao || data?.erro?.descricao) {
        throw new Error(`Jadlog: ${data.error?.descricao || data.erro?.descricao}`);
      }
      const results = Array.isArray(data?.frete) ? data.frete : [];
      if (results.length !== slice.length) throw new Error('A Jadlog não retornou preço para todos os volumes.');
      for (const item of results) {
        if (item?.erro?.descricao || item?.error?.descricao) {
          throw new Error(`Jadlog: ${item.erro?.descricao || item.error?.descricao}`);
        }
        const price = Number(item?.vltotal);
        if (!Number.isFinite(price) || price <= 0) throw new Error('A Jadlog retornou um valor de frete inválido.');
        totalCents += Math.round(price * 100);
        const days = Number(item?.prazo);
        if (Number.isFinite(days) && days > 0) maxDays = Math.max(maxDays ?? 0, days);
      }
    }

    const option = {
      code: `J${this.modalidade}`,
      label: this.label,
      priceCents: totalCents,
      days: maxDays,
      volumes: pack.packages.length
    };
    const value = {options: [option], cheapest: option};
    if (this.quoteCache.size >= QUOTE_CACHE_MAX) {
      const oldest = this.quoteCache.keys().next().value;
      this.quoteCache.delete(oldest);
    }
    this.quoteCache.set(key, {at: Date.now(), value});
    return value;
  }
}
