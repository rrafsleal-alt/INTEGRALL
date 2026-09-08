import {effectiveFreeShippingThreshold} from './catalog.js';
import {validateShippingQuoteItems} from './shipping-quote.js';
import {normalizeShippingCep, packRegisteredOrder, validPackage, MAX_SHIPPING_PACKAGES} from './shipping-packages.js';
import {shippingError, shippingFingerprint, signShippingQuote, verifyShippingQuote, SHIPPING_QUOTE_TTL_MS} from './shipping-receipt.js';

/** Cotação/fechamento compartilham validação e usam somente o catálogo servidor. */
export class ShippingCheckout {
  constructor({config, getRates, enabled, now = Date.now}) {
    this.config = config; this.getRates = getRates; this.enabled = enabled; this.now = now;
    this.secret = config.shippingQuoteSecret || config.adminSessionSecret;
  }
  context(cep, items, catalog) {
    const destination = normalizeShippingCep(cep);
    if (!destination) throw shippingError('SHIPPING_CEP_INVALID', 'Informe um CEP válido com 8 dígitos.', 400);
    const input = validateShippingQuoteItems(items, catalog);
    const pack = packRegisteredOrder(input.items, input.productsById);
    if (pack.missingData || pack.overweight || !pack.packages.length || pack.packages.length > MAX_SHIPPING_PACKAGES || !pack.packages.every(validPackage)) {
      throw shippingError('SHIPPING_PACKAGING_REQUIRED', 'Esta quantidade ainda não tem embalagens de envio cadastradas. Solicite cotação à loja.', 422);
    }
    const freeThreshold = Number(this.config.freeShippingCents ?? effectiveFreeShippingThreshold(catalog)) || 0;
    const fingerprint = shippingFingerprint({cep: destination, items: input.items, pack, subtotalCents: input.subtotalCents,
      originCep: this.config.correiosOriginCep, freeThreshold,
      services: [this.config.correiosServices || '03298:PAC,03220:SEDEX', this.config.carrierSplitUnits, this.config.correiosHomolog, this.config.correiosAuthType],
      declaredValue: Boolean(this.config.correiosDeclaredValue)});
    return {...input, cep: destination, pack, fingerprint, free: freeThreshold > 0 && input.subtotalCents >= freeThreshold};
  }
  async quote(cep, items, catalog) {
    if (!this.enabled()) throw shippingError('SHIPPING_NOT_CONFIGURED', 'Cotação automática indisponível. A loja precisa configurar as credenciais de envio.', 503);
    const context = this.context(cep, items, catalog);
    const result = await this.getRates(context, false);
    const now = this.now();
    const options = result.options.map(rate => {
      const priceCents = context.free ? 0 : rate.priceCents;
      const quoteToken = signShippingQuote({fingerprint: context.fingerprint, service: rate.code, priceCents,
        carrierPriceCents: rate.priceCents, days: rate.days, homeDelivery: rate.homeDelivery ?? null, volumes: rate.volumes || context.pack.packages.length}, this.secret, now);
      return {service: rate.code, label: context.free ? `${rate.label} — frete grátis` : rate.label, priceCents,
        days: rate.days, deadline: rate.deadline || '', homeDelivery: rate.homeDelivery ?? null,
        saturdayDelivery: rate.saturdayDelivery ?? null, sundayDelivery: rate.sundayDelivery ?? null,
        volumes: rate.volumes || context.pack.packages.length, quoteToken};
    });
    return {options, quotedAt: new Date(now).toISOString(), expiresAt: new Date(now + SHIPPING_QUOTE_TTL_MS).toISOString(),
      partial: Boolean(result.partial), environment: this.config.correiosHomolog ? 'homologacao' : 'producao'};
  }
  async resolve(body, catalog) {
    if (this.config.shippingMode !== 'correios' || body?.shipping?.choice !== 'delivery') return null;
    if (body.shipping.manualQuote === true) return null; // pedido registrado SEM pagamento, nunca frete zero.
    if (!this.enabled()) throw shippingError('SHIPPING_NOT_CONFIGURED', 'Cotação automática indisponível. Solicite frete a confirmar ou tente novamente.', 503);
    const claims = verifyShippingQuote(body.shipping.quoteToken, this.secret, this.now());
    const context = this.context(body.shipping.cep, body.items, catalog);
    if (context.fingerprint !== claims.fingerprint || claims.service !== body.shipping.service) {
      throw shippingError('SHIPPING_QUOTE_STALE', 'O pedido ou o serviço mudou. Calcule e selecione o frete novamente.');
    }
    // Reconsulta REAL, sem usar cache da prévia, antes de aceitar o pedido.
    const result = await this.getRates(context, true);
    const chosen = result.options.find(rate => rate.code === claims.service);
    if (!chosen) throw shippingError('SHIPPING_SERVICE_UNAVAILABLE', 'O serviço escolhido não está mais disponível. Escolha outra opção de frete.');
    const priceCents = context.free ? 0 : chosen.priceCents;
    if (priceCents !== claims.priceCents || chosen.days !== claims.days || (chosen.homeDelivery ?? null) !== claims.homeDelivery
      || (chosen.volumes || context.pack.packages.length) !== claims.volumes) {
      throw shippingError('SHIPPING_QUOTE_CHANGED', 'O preço ou as condições do frete mudaram. Calcule novamente e confirme a opção atualizada.');
    }
    return {priceCents, carrierPriceCents: chosen.priceCents, label: context.free ? `${chosen.label} — frete grátis` : chosen.label,
      days: `${chosen.days} ${chosen.days === 1 ? 'dia útil' : 'dias úteis'} após a postagem`, service: chosen.code, deadline: chosen.deadline || '',
      homeDelivery: chosen.homeDelivery ?? null, saturdayDelivery: chosen.saturdayDelivery ?? null, sundayDelivery: chosen.sundayDelivery ?? null,
      volumes: context.pack.packages.length, packages: context.pack.packages, originCep: this.config.correiosOriginCep,
      quotedAt: new Date(this.now()).toISOString(), declaredValueIncluded: Boolean(chosen.declaredValueIncluded), environment: this.config.correiosHomolog ? 'homologacao' : 'producao'};
  }
}
