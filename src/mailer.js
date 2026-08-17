/**
 * E-mail transacional via SMTP com STARTTLS ou TLS implícito.
 * Sem dependências externas — implementação mínima do protocolo SMTP
 * (EHLO, STARTTLS, AUTH LOGIN, MAIL FROM, RCPT TO, DATA).
 * Compatível com Gmail (senha de app), Brevo, Mailgun, SES SMTP etc.
 */

import net from 'node:net';
import tls from 'node:tls';

const CRLF = '\r\n';

function b64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
}

function encodeHeaderWord(value) {
  const text = String(value ?? '');
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${b64(text)}?=`;
}

class SmtpConnection {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.buffer = '';
    this.waiters = [];
    this.timeoutMs = timeoutMs;
    socket.setEncoding('utf8');
    socket.on('data', chunk => this.onData(chunk));
  }

  onData(chunk) {
    this.buffer += chunk;
    // Resposta SMTP completa: última linha "NNN texto" (espaço após o código).
    const lines = this.buffer.split(CRLF).filter(Boolean);
    const last = lines[lines.length - 1] || '';
    if (/^\d{3} /.test(last)) {
      const payload = this.buffer;
      this.buffer = '';
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(payload);
    }
  }

  read() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex(w => w.resolve === wrapped);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('Tempo esgotado aguardando resposta SMTP.'));
      }, this.timeoutMs);
      const wrapped = value => { clearTimeout(timer); resolve(value); };
      this.waiters.push({resolve: wrapped});
    });
  }

  async command(text, expectCodes) {
    if (text != null) this.socket.write(text + CRLF);
    const response = await this.read();
    const code = Number(response.slice(0, 3));
    if (expectCodes && !expectCodes.includes(code)) {
      throw new Error(`SMTP inesperado (${code}): ${response.split(CRLF)[0]?.slice(0, 200)}`);
    }
    return response;
  }
}

export class Mailer {
  constructor({host, port, user, password, from, fromName, secure, timeoutMs = 15_000} = {}) {
    this.host = String(host || '').trim();
    this.port = Number(port) || 587;
    this.user = String(user || '').trim();
    this.password = String(password || '');
    this.from = String(from || this.user).trim();
    this.fromName = String(fromName || 'INTEGRALL').trim();
    this.secure = secure == null ? this.port === 465 : Boolean(secure);
    this.timeoutMs = timeoutMs;
  }

  get configured() {
    return Boolean(this.host && this.user && this.password && this.from);
  }

  async connect() {
    const socket = await new Promise((resolve, reject) => {
      const options = {host: this.host, port: this.port};
      const raw = this.secure
        ? tls.connect({...options, servername: this.host}, () => resolve(raw))
        : net.connect(options, () => resolve(raw));
      raw.setTimeout(this.timeoutMs, () => { raw.destroy(); reject(new Error('Tempo esgotado conectando ao servidor SMTP.')); });
      raw.once('error', reject);
    });
    return socket;
  }

  async upgradeTls(socket) {
    return new Promise((resolve, reject) => {
      const secured = tls.connect({socket, servername: this.host}, () => resolve(secured));
      secured.once('error', reject);
    });
  }

  /**
   * Envia um e-mail multipart (texto + HTML). Nunca lança para o chamador
   * de rotas — quem chama decide se await/ignora. Retorna {ok, error}.
   */
  async send({to, subject, text, html}) {
    if (!this.configured) return {ok: false, error: 'SMTP não configurado.'};
    const recipient = String(to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return {ok: false, error: 'Destinatário inválido.'};

    let socket = null;
    try {
      socket = await this.connect();
      let conn = new SmtpConnection(socket, this.timeoutMs);
      await conn.command(null, [220]);
      let ehlo = await conn.command(`EHLO integrall.local`, [250]);

      if (!this.secure && /STARTTLS/i.test(ehlo)) {
        await conn.command('STARTTLS', [220]);
        socket = await this.upgradeTls(socket);
        conn = new SmtpConnection(socket, this.timeoutMs);
        await conn.command(`EHLO integrall.local`, [250]);
      } else if (!this.secure) {
        throw new Error('O servidor SMTP não oferece STARTTLS; use porta 465 com SMTP_SECURE=true.');
      }

      await conn.command('AUTH LOGIN', [334]);
      await conn.command(b64(this.user), [334]);
      await conn.command(b64(this.password), [235]);
      await conn.command(`MAIL FROM:<${this.from}>`, [250]);
      await conn.command(`RCPT TO:<${recipient}>`, [250, 251]);
      await conn.command('DATA', [354]);

      const boundary = `integrall-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const message = [
        `From: ${encodeHeaderWord(this.fromName)} <${this.from}>`,
        `To: <${recipient}>`,
        `Subject: ${encodeHeaderWord(subject)}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@integrall>`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64(text || ''),
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64(html || `<pre>${escapeHtml(text || '')}</pre>`),
        `--${boundary}--`,
        ''
      ].join(CRLF);

      // Dot-stuffing conforme RFC 5321.
      const stuffed = message.replace(/(^|\r\n)\./g, '$1..');
      await conn.command(stuffed + CRLF + '.', [250]);
      await conn.command('QUIT', [221]).catch(() => {});
      return {ok: true, error: ''};
    } catch (error) {
      return {ok: false, error: error?.message || 'Falha no envio de e-mail.'};
    } finally {
      try { socket?.destroy(); } catch {}
    }
  }
}

const STATUS_LABELS = {
  received: 'Pedido recebido',
  awaiting_payment: 'Aguardando pagamento',
  paid: 'Pagamento confirmado',
  payment_failed: 'Pagamento não aprovado',
  payment_expired: 'Pagamento expirado',
  payment_review: 'Pagamento em revisão',
  preparing: 'Preparando pedido',
  ready: 'Pedido pronto',
  completed: 'Pedido concluído',
  refunded: 'Pagamento reembolsado',
  chargeback: 'Pagamento contestado',
  cancelled: 'Pedido cancelado'
};

function money(cents) {
  return new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format((Number(cents) || 0) / 100);
}

/**
 * Monta o e-mail de pedido (criação ou atualização de status).
 */
export function orderEmail(order, {kind = 'created', publicUrl = '', businessName = 'INTEGRALL'} = {}) {
  const status = STATUS_LABELS[order.status] || order.status;
  const subject = kind === 'created'
    ? `${businessName} — Pedido ${order.id} recebido`
    : `${businessName} — Pedido ${order.id}: ${status}`;

  const itemsText = (order.items || [])
    .map(item => `  ${item.qty}× ${item.name}${item.variant ? ` (${item.variant})` : ''}${item.gift ? ' [PRESENTE]' : ''} — ${money(item.lineTotalCents)}${item.gift && item.giftMessage ? `\n    Mensagem: “${item.giftMessage}”` : ''}`)
    .join('\n');

  const shippingLine = order.shipping?.choice === 'pickup'
    ? 'Retirada no local'
    : order.shippingCents == null
      ? 'Entrega — frete a confirmar pela loja'
      : `Entrega — frete ${money(order.shippingCents)}`;

  const discountLine = Number(order.discountCents) > 0
    ? `Desconto${order.coupon?.code ? ` (${order.coupon.code})` : ''}: −${money(order.discountCents)}\n`
    : '';

  const trackingLine = order.trackingCode
    ? `\nRastreamento: ${order.trackingCode}${order.trackingUrl ? `\n${order.trackingUrl}` : ''}\n`
    : '';

  const trackUrl = publicUrl ? `${publicUrl}/?pedido=${encodeURIComponent(order.id)}` : '';

  const text = [
    `Olá, ${order.customer?.name || 'cliente'}!`,
    '',
    kind === 'created'
      ? `Recebemos o seu pedido ${order.id}. Guarde este e-mail — ele é o seu comprovante.`
      : `O seu pedido ${order.id} foi atualizado: ${status}.`,
    '',
    'Itens:',
    itemsText,
    '',
    `Subtotal: ${money(order.subtotalCents)}`,
    `${shippingLine}`,
    discountLine + `Total: ${order.shippingCents == null ? `${money(order.totalCents)} + frete` : money(order.totalCents)}`,
    trackingLine,
    trackUrl ? `Acompanhe seu pedido: ${trackUrl}` : '',
    '',
    `${businessName} — obrigado pela preferência!`
  ].filter(line => line !== null).join('\n');

  const itemsHtml = (order.items || [])
    .map(item => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${item.qty}× ${escapeHtml(item.name)}${item.variant ? ` <small>(${escapeHtml(item.variant)})</small>` : ''}${item.gift ? ' 🎁' : ''}${item.gift && item.giftMessage ? `<br><small style="color:#aa8952;font-style:italic">Mensagem: “${escapeHtml(item.giftMessage)}”</small>` : ''}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;vertical-align:top">${money(item.lineTotalCents)}</td></tr>`)
    .join('');

  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#faf9f7;font-family:Arial,Helvetica,sans-serif;color:#211e1c">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px">
    <div style="background:#fff;border:1px solid #e9e4dd;padding:28px">
      <p style="margin:0 0 4px;color:#aa8952;font-size:11px;letter-spacing:3px;text-transform:uppercase">${escapeHtml(businessName)}</p>
      <h1 style="margin:0 0 16px;color:#4a0a1a;font-size:22px;font-weight:normal">${kind === 'created' ? 'Pedido recebido' : escapeHtml(status)}</h1>
      <p style="margin:0 0 6px">Olá, <b>${escapeHtml(order.customer?.name || 'cliente')}</b>!</p>
      <p style="margin:0 0 18px;color:#77716c;font-size:14px">${kind === 'created' ? `Recebemos o seu pedido <b>${escapeHtml(order.id)}</b>. Guarde este e-mail — ele é o seu comprovante.` : `O seu pedido <b>${escapeHtml(order.id)}</b> foi atualizado.`}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${itemsHtml}</table>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">
        <tr><td style="padding:3px 10px;color:#77716c">Subtotal</td><td style="padding:3px 10px;text-align:right">${money(order.subtotalCents)}</td></tr>
        <tr><td style="padding:3px 10px;color:#77716c">${escapeHtml(shippingLine)}</td><td></td></tr>
        ${Number(order.discountCents) > 0 ? `<tr><td style="padding:3px 10px;color:#276447">Desconto${order.coupon?.code ? ` (${escapeHtml(order.coupon.code)})` : ''}</td><td style="padding:3px 10px;text-align:right;color:#276447">−${money(order.discountCents)}</td></tr>` : ''}
        <tr><td style="padding:8px 10px;border-top:1px solid #e9e4dd;color:#4a0a1a"><b>Total</b></td><td style="padding:8px 10px;border-top:1px solid #e9e4dd;text-align:right;color:#4a0a1a"><b>${order.shippingCents == null ? `${money(order.totalCents)} + frete` : money(order.totalCents)}</b></td></tr>
      </table>
      ${order.trackingCode ? `<div style="margin-top:16px;padding:12px;background:#faf9f7;border:1px solid #e9e4dd;font-size:14px">Rastreamento: <b>${escapeHtml(order.trackingCode)}</b>${order.trackingUrl ? ` — <a href="${escapeHtml(order.trackingUrl)}" style="color:#4a0a1a">acompanhar entrega</a>` : ''}</div>` : ''}
      ${trackUrl ? `<p style="margin:20px 0 0;text-align:center"><a href="${escapeHtml(trackUrl)}" style="display:inline-block;background:#4a0a1a;color:#fff;text-decoration:none;padding:12px 26px;font-size:13px;letter-spacing:1px">ACOMPANHAR PEDIDO</a></p>` : ''}
    </div>
    <p style="text-align:center;color:#77716c;font-size:11px;margin:14px 0 0">Venda de bebidas alcoólicas proibida para menores de 18 anos. Aprecie com moderação.</p>
  </div>
</body></html>`;

  return {subject, text, html};
}
