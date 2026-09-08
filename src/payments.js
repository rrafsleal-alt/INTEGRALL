import {PaymentProvider} from './providers.js';

let mercadoPagoModulePromise = null;

async function mercadoPagoModule() {
  if (!mercadoPagoModulePromise) {
    mercadoPagoModulePromise = import('mercadopago').catch(error => {
      mercadoPagoModulePromise = null;
      throw Object.assign(new Error('A dependência mercadopago é obrigatória para pagamentos online.'), {
        code: 'MERCADO_PAGO_DEPENDENCY_MISSING',
        cause: error
      });
    });
  }
  return mercadoPagoModulePromise;
}

export class InvalidWebhookSignatureError extends Error {
  constructor(message = 'Assinatura do webhook inválida.', options = {}) {
    super(message, options);
    this.name = 'InvalidWebhookSignatureError';
  }
}

export class MercadoPagoService extends PaymentProvider {
  constructor({accessToken, webhookSecret, sandbox = false, expirationDays = 3} = {}) {
    super({providerId: 'mercado-pago', capabilities: {charge: true, consultCharge: true, webhook: true}});
    this.accessToken = String(accessToken || '').trim();
    this.webhookSecret = String(webhookSecret || '').trim();
    this.sandbox = Boolean(sandbox);
    this.expirationDays = Math.max(3, Math.min(30, Number(expirationDays) || 3));
    this.clientsPromise = null;
  }

  get configured() { return Boolean(this.accessToken && this.webhookSecret); }

  async clients() {
    if (!this.accessToken) throw new Error('Mercado Pago não configurado.');
    if (!this.clientsPromise) {
      this.clientsPromise = mercadoPagoModule().then(({MercadoPagoConfig, Preference, Payment}) => {
        const config = new MercadoPagoConfig({accessToken: this.accessToken, options: {timeout: 8000}});
        return {preference: new Preference(config), payment: new Payment(config)};
      }).catch(error => {
        this.clientsPromise = null;
        throw error;
      });
    }
    return this.clientsPromise;
  }

  async validateWebhook({xSignature, xRequestId, dataId}) {
    if (!this.webhookSecret) throw new Error('MERCADO_PAGO_WEBHOOK_SECRET não configurado.');
    const {WebhookSignatureValidator, InvalidWebhookSignatureError: SdkInvalidSignatureError} = await mercadoPagoModule();
    try {
      WebhookSignatureValidator.validate({xSignature, xRequestId, dataId: String(dataId), secret: this.webhookSecret});
    } catch (error) {
      const isSdkSignatureError = typeof SdkInvalidSignatureError === 'function' && error instanceof SdkInvalidSignatureError;
      if (isSdkSignatureError || error?.name === 'InvalidWebhookSignatureError') {
        throw new InvalidWebhookSignatureError(undefined, {cause: error});
      }
      throw error;
    }
    return true;
  }

  async createCharge({order, publicUrl, attempt = 1}) {
    return this.createCheckout(order, publicUrl, attempt);
  }

  async getCharge(externalId) {
    return this.getPayment(externalId);
  }

  async createCheckout(order, publicUrl, attempt = 1) {
    const {preference} = await this.clients();
    if (!publicUrl || !/^https:\/\//i.test(publicUrl)) throw new Error('PUBLIC_URL HTTPS é obrigatória para criar o Checkout Pro.');

    const discountCents = Math.max(0, Number(order.discountCents) || 0);
    let items;
    if (discountCents > 0) {
      // O Mercado Pago não aceita itens com valor negativo; com desconto aplicado,
      // envia um item consolidado para que o valor cobrado bata com o total validado no webhook.
      const summary = order.items.map(line => `${line.qty}× ${line.name}`).join(', ').slice(0, 240);
      items = [{
        id: order.id,
        title: `Pedido INTEGRALL${order.coupon?.code ? ` (cupom ${order.coupon.code})` : ''} — ${summary}`.slice(0, 256),
        quantity: 1,
        currency_id: 'BRL',
        unit_price: order.totalCents / 100
      }];
    } else {
      items = order.items.map(line => ({
        id: line.productId,
        title: line.variant ? `${line.name} — ${line.variant}` : line.name,
        quantity: line.qty,
        currency_id: 'BRL',
        unit_price: line.unitPriceCents / 100
      }));
      if ((order.shippingCents || 0) > 0) {
        items.push({id: 'shipping', title: 'Frete', quantity: 1, currency_id: 'BRL', unit_price: order.shippingCents / 100});
      }
    }

    const encodedOrder = encodeURIComponent(order.id);
    const body = {
      items,
      external_reference: order.id,
      notification_url: `${publicUrl}/api/webhooks/mercadopago`,
      back_urls: {
        success: `${publicUrl}/?payment=success&order=${encodedOrder}`,
        pending: `${publicUrl}/?payment=pending&order=${encodedOrder}`,
        failure: `${publicUrl}/?payment=failure&order=${encodedOrder}`
      },
      auto_return: 'approved',
      metadata: {order_id: order.id},
      date_of_expiration: (() => {
        const reservation = Date.parse(order.inventoryReservationExpiresAt || '');
        const fallback = Date.now() + this.expirationDays * 86_400_000;
        // Uma preferência nunca pode sobreviver à reserva de estoque. O
        // endpoint bloqueia reservas com menos de 60 s; aqui preservamos o
        // mesmo limite exato mesmo que o relógio avance durante a chamada.
        if (order.inventoryReservationExpiresAt && (!Number.isFinite(reservation) || reservation <= Date.now())) {
          throw Object.assign(new Error('A reserva de estoque expirou antes da criação do pagamento. Recrie o pedido.'), {code: 'PAYMENT_RESERVATION_EXPIRED'});
        }
        const safe = Number.isFinite(reservation) ? Math.min(reservation, fallback) : fallback;
        return new Date(safe).toISOString();
      })(),
      payer: order.customer?.email ? {email: order.customer.email} : undefined
    };

    const safeAttempt = Math.max(1, Math.min(99, Number(attempt) || 1));
    const response = await preference.create({body, requestOptions: {idempotencyKey: `pref-${order.id}-${safeAttempt}`}});
    const url = this.sandbox ? (response.sandbox_init_point || response.init_point) : response.init_point;
    if (!url) throw new Error('O Mercado Pago não retornou a URL do Checkout Pro.');
    return {id: response.id, url};
  }

  async getPayment(id) {
    const {payment} = await this.clients();
    return payment.get({id: String(id)});
  }
}
