import test from 'node:test';
import assert from 'node:assert/strict';
import {Mailer, orderEmail} from '../src/mailer.js';

const ORDER = {
  id: 'INT-20260815-TESTE',
  status: 'received',
  customer: {name: 'Maria', email: 'maria@example.com'},
  items: [
    {qty: 2, name: 'Vinho Tinto Seco', variant: '750ml', lineTotalCents: 5398},
    {qty: 1, name: 'Vó Damazia', variant: '', lineTotalCents: 3990}
  ],
  subtotalCents: 9388,
  shippingCents: 2850,
  discountCents: 939,
  coupon: {code: 'BEMVINDO10'},
  totalCents: 11299,
  shipping: {choice: 'delivery'},
  trackingCode: 'AA123456789BR',
  trackingUrl: 'https://rastreamento.correios.com.br/app/index.php?objetos=AA123456789BR'
};

test('mailer só fica configurado com todos os dados SMTP', () => {
  assert.equal(new Mailer({}).configured, false);
  assert.equal(new Mailer({host: 'smtp.example.com', user: 'u', password: 'p', from: 'loja@example.com'}).configured, true);
});

test('envio sem configuração falha graciosamente sem lançar', async () => {
  const result = await new Mailer({}).send({to: 'x@example.com', subject: 'Oi', text: 'Olá'});
  assert.equal(result.ok, false);
  assert.match(result.error, /SMTP/);
});

test('destinatário inválido é rejeitado antes de conectar', async () => {
  const mailer = new Mailer({host: 'smtp.example.com', user: 'u', password: 'p', from: 'loja@example.com'});
  const result = await mailer.send({to: 'invalido', subject: 'Oi', text: 'Olá'});
  assert.equal(result.ok, false);
  assert.match(result.error, /inválido/i);
});

test('e-mail de pedido criado contém itens, total, desconto, rastreio e link', () => {
  const {subject, text, html} = orderEmail(ORDER, {kind: 'created', publicUrl: 'https://loja.example.com', businessName: 'INTEGRALL'});
  assert.match(subject, /INT-20260815-TESTE/);
  assert.match(text, /2× Vinho Tinto Seco/);
  assert.match(text, /R\$\s?93,88/);
  assert.match(text, /BEMVINDO10/);
  assert.match(text, /AA123456789BR/);
  assert.match(text, /https:\/\/loja\.example\.com\/\?pedido=INT-20260815-TESTE/);
  assert.match(html, /Pedido recebido/);
  assert.match(html, /BEMVINDO10/);
  // Sanitização: nada de HTML cru vindo dos dados
  const malicious = orderEmail({...ORDER, customer: {name: '<script>alert(1)</script>', email: 'x@x.com'}}, {kind: 'created'});
  assert.ok(!malicious.html.includes('<script>alert(1)</script>'));
  assert.ok(malicious.html.includes('&lt;script&gt;'));
});

test('e-mail de atualização usa o status como assunto', () => {
  const {subject} = orderEmail({...ORDER, status: 'paid'}, {kind: 'status', businessName: 'INTEGRALL'});
  assert.match(subject, /Pagamento confirmado/);
});

test('frete sob cotação aparece como "a confirmar"', () => {
  const {text} = orderEmail({...ORDER, shippingCents: null, trackingCode: '', trackingUrl: ''}, {kind: 'created'});
  assert.match(text, /frete a confirmar/i);
  assert.match(text, /\+ frete/);
});
