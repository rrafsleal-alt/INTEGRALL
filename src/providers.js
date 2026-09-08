/**
 * Contratos estáveis para integrações externas.
 *
 * As implementações declaram capacidades em vez de simular operações que o
 * provedor/contrato comercial ainda não habilitou. Isso permite que a camada de
 * aplicação degrade com segurança sem apresentar mocks como pagamentos ou
 * etiquetas reais.
 */
export class ProviderError extends Error {
  constructor(message, {code = 'PROVIDER_ERROR', provider = '', retryable = false, cause} = {}) {
    super(message, {cause});
    this.name = 'ProviderError';
    this.code = code;
    this.provider = provider;
    this.retryable = Boolean(retryable);
  }
}

export class ProviderCapabilityError extends ProviderError {
  constructor(provider, capability) {
    super(`O provedor ${provider || 'selecionado'} não oferece a capacidade "${capability}" nesta configuração.`, {
      code: 'PROVIDER_CAPABILITY_UNAVAILABLE',
      provider,
      retryable: false
    });
    this.name = 'ProviderCapabilityError';
    this.capability = capability;
  }
}

function capabilityMap(value = {}) {
  return Object.freeze({
    quote: Boolean(value.quote),
    postalCode: Boolean(value.postalCode),
    tracking: Boolean(value.tracking),
    label: Boolean(value.label),
    cancelLabel: Boolean(value.cancelLabel),
    charge: Boolean(value.charge),
    consultCharge: Boolean(value.consultCharge),
    cancelCharge: Boolean(value.cancelCharge),
    refund: Boolean(value.refund),
    webhook: Boolean(value.webhook)
  });
}

export class ShippingProvider {
  constructor({providerId = 'shipping', capabilities = {}} = {}) {
    this.providerId = providerId;
    this.capabilities = capabilityMap(capabilities);
  }

  supports(capability) {
    return Boolean(this.capabilities[capability]);
  }

  requireCapability(capability) {
    if (!this.supports(capability)) throw new ProviderCapabilityError(this.providerId, capability);
  }

  async quote(_postalCode, _pack, _declaredCents = 0) {
    throw new ProviderCapabilityError(this.providerId, 'quote');
  }

  async validatePostalCode(_postalCode) {
    throw new ProviderCapabilityError(this.providerId, 'postalCode');
  }

  async trackShipment(_trackingCode) {
    throw new ProviderCapabilityError(this.providerId, 'tracking');
  }

  async createLabel(_shipment) {
    throw new ProviderCapabilityError(this.providerId, 'label');
  }

  async cancelLabel(_labelId) {
    throw new ProviderCapabilityError(this.providerId, 'cancelLabel');
  }

  normalizeError(error) {
    if (error instanceof ProviderError) return error;
    const message = String(error?.message || 'O provedor de frete está indisponível.').slice(0, 500);
    const retryable = error?.name === 'AbortError' || error?.name === 'TimeoutError' || /timeout|temporar|indispon/i.test(message);
    return new ProviderError(message, {provider: this.providerId, retryable, cause: error});
  }
}

export class PaymentProvider {
  constructor({providerId = 'payment', capabilities = {}} = {}) {
    this.providerId = providerId;
    this.capabilities = capabilityMap(capabilities);
  }

  supports(capability) {
    return Boolean(this.capabilities[capability]);
  }

  requireCapability(capability) {
    if (!this.supports(capability)) throw new ProviderCapabilityError(this.providerId, capability);
  }

  async createCharge(_request) {
    throw new ProviderCapabilityError(this.providerId, 'charge');
  }

  async getCharge(_externalId) {
    throw new ProviderCapabilityError(this.providerId, 'consultCharge');
  }

  async cancelCharge(_externalId) {
    throw new ProviderCapabilityError(this.providerId, 'cancelCharge');
  }

  async refund(_externalId, _amountCents) {
    throw new ProviderCapabilityError(this.providerId, 'refund');
  }

  validateWebhook(_request) {
    throw new ProviderCapabilityError(this.providerId, 'webhook');
  }

  normalizeError(error) {
    if (error instanceof ProviderError) return error;
    const message = String(error?.message || 'O provedor de pagamento está indisponível.').slice(0, 500);
    const retryable = error?.name === 'AbortError' || error?.name === 'TimeoutError' || /timeout|temporar|indispon/i.test(message);
    return new ProviderError(message, {provider: this.providerId, retryable, cause: error});
  }
}

export function assertShippingProvider(provider) {
  if (!provider || typeof provider.quote !== 'function' || typeof provider.trackShipment !== 'function') {
    throw new TypeError('ShippingProvider inválido: quote() e trackShipment() são obrigatórios.');
  }
  return provider;
}

export function assertPaymentProvider(provider) {
  if (!provider || typeof provider.createCharge !== 'function' || typeof provider.getCharge !== 'function' || typeof provider.validateWebhook !== 'function') {
    throw new TypeError('PaymentProvider inválido: createCharge(), getCharge() e validateWebhook() são obrigatórios.');
  }
  return provider;
}
