import {
  MercadoPagoConfig,
  Preference,
  Payment,
  WebhookSignatureValidator,
  InvalidWebhookSignatureError
} from 'mercadopago';

export class MercadoPagoService {
  constructor({accessToken, webhookSecret, sandbox = false, expirationDays = 3}) {
    this.accessToken = accessToken;
    this.webhookSecret = webhookSecret;
    this.sandbox = sandbox;
    this.expirationDays = Math.max(3, Math.min(30, Number(expirationDays) || 3));
    this.preferenceClient = accessToken ? new MercadoPagoConfig({accessToken, options: {timeout: 8000}}) : null;
    this.paymentClient = accessToken ? new MercadoPagoConfig({accessToken, options: {timeout: 8000}}) : null;
    this.preference = this.preferenceClient ? new Preference(this.preferenceClient) : null;
    this.payment = this.paymentClient ? new Payment(this.paymentClient) : null;
  }

  get configured() { return Boolean(this.preference && this.payment && this.webhookSecret); }

  validateWebhook({xSignature, xRequestId, dataId}) {
    if (!this.webhookSecret) throw new Error('MERCADO_PAGO_WEBHOOK_SECRET não configurado.');
    WebhookSignatureValidator.validate({xSignature, xRequestId, dataId: String(dataId), secret: this.webhookSecret});
    return true;
  }

  async createCheckout(order, publicUrl, attempt = 1) {
    if (!this.preference) throw new Error('Mercado Pago não configurado.');
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
      date_of_expiration: new Date(Date.now() + this.expirationDays * 86_400_000).toISOString(),
      payer: order.customer?.email ? {email: order.customer.email} : undefined
    };

    const safeAttempt = Math.max(1, Math.min(99, Number(attempt) || 1));
    const response = await this.preference.create({body, requestOptions: {idempotencyKey: `pref-${order.id}-${safeAttempt}`}});
    const url = this.sandbox ? (response.sandbox_init_point || response.init_point) : response.init_point;
    if (!url) throw new Error('O Mercado Pago não retornou a URL do Checkout Pro.');
    return {id: response.id, url};
  }

  async getPayment(id) {
    if (!this.payment) throw new Error('Mercado Pago não configurado.');
    return this.payment.get({id: String(id)});
  }
}

export {InvalidWebhookSignatureError};
