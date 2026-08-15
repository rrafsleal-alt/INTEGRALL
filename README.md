# INTEGRALL Online v9.2

Loja da **INTEGRALL | Boutique Gourmet** com catálogo, carrinho, pedidos server-side, clientes, acompanhamento de pedido, painel administrativo, PostgreSQL e integração **Mercado Pago Checkout Pro pronta para receber credenciais**.

## Fluxo final

1. Cliente escolhe produtos, variações e quantidades.
2. Define retirada ou entrega.
3. Para entrega, informa CEP e endereço completo.
4. Informa nome + e-mail ou telefone.
5. O servidor recalcula preços, estoque e frete e cria o pedido.
6. O pedido aparece imediatamente no Admin.
7. Se Mercado Pago estiver configurado e o frete estiver definido, o cliente pode seguir para **PIX ou cartão** no Checkout Pro.
8. O webhook do Mercado Pago confirma o pagamento no backend.
9. O pedido muda automaticamente para `paid` e o estoque é baixado uma única vez.
10. O Admin avança o fluxo: `paid → preparing → ready → completed`.
11. O cliente pode acompanhar o último pedido na própria loja.

O WhatsApp **não participa automaticamente do checkout**. Se um número de atendimento for configurado, ele é usado apenas como opção manual de suporte.

## Novidades v9.3

- **Verificação de idade (18+)**: aviso bloqueante na entrada da loja (Lei nº 13.106/2015), lembrado por 30 dias; pedidos com bebida alcoólica exigem confirmação de maioridade também no checkout e são **rejeitados pelo servidor** sem ela; aviso legal fixo no rodapé.
- **Cupons de desconto**: porcentagem, valor fixo ou frete grátis, com pedido mínimo e validade; criados no Admin; validados e aplicados **exclusivamente no servidor**; códigos nunca aparecem no catálogo público; o desconto nunca zera o total.
- **Código de rastreio**: o Admin informa código/transportadora/link do envio; link dos Correios é gerado automaticamente; o cliente vê o rastreio no acompanhamento do pedido.

Novas rotas:

- `POST /api/coupons/validate` (pública, valida cupom antes do pedido)
- `GET /api/admin/coupons` / `PUT /api/admin/coupons`
- `PATCH /api/admin/orders/:id/tracking`

## Recursos v9.2

- pedidos com idempotência (`clientOrderId`);
- `checkoutToken` privado separado do número público do pedido;
- PostgreSQL obrigatório em produção;
- tabela persistente de catálogo, pedidos e clientes;
- endereço completo de entrega;
- frete fixo, zonas, retirada ou cotação;
- cotação de frete pelo Admin com recálculo do total no servidor;
- acompanhamento público autenticado pelo token da sessão;
- histórico de alterações do pedido;
- baixa de estoque idempotente na confirmação financeira/operacional;
- prevenção de baixa duplicada em webhooks repetidos;
- Admin com pedidos, clientes, catálogo, frete, histórico e exportação CSV;
- Checkout Pro preparado para PIX/cartão;
- nova tentativa de pagamento para falha/expiração;
- webhook assinado;
- confirmação de valor, moeda e preferência antes de aceitar pagamento;
- estados explícitos para falha, expiração, revisão, reembolso e chargeback.

## Rodar localmente

No Windows, use:

```text
INICIAR-INTEGRALL.bat
```

Ou pelo terminal:

```bash
npm install
npm run dev
```

Acesse:

- Loja: `http://localhost:3000/`
- Admin: `http://localhost:3000/admin`
- Health: `http://localhost:3000/api/health`

Se `DATABASE_URL` estiver vazio em desenvolvimento, o sistema usa memória. Os pedidos desaparecem ao reiniciar.

## PostgreSQL local opcional

Se tiver Docker Desktop:

```text
INICIAR-COM-POSTGRES-LOCAL.bat
```

Isso sobe PostgreSQL na porta `5433` e configura a `DATABASE_URL` local no `.env`.

Para parar o container:

```text
PARAR-POSTGRES-LOCAL.bat
```

Em produção, use PostgreSQL real. O `render.yaml` já referencia um banco e injeta `DATABASE_URL` no serviço web.

## Variáveis principais

```env
NODE_ENV=production
PORT=3000
PUBLIC_URL=https://seu-dominio.com.br
DATABASE_URL=postgresql://...
ADMIN_API_TOKEN=token-aleatorio-com-32-ou-mais-caracteres
TRUST_PROXY=true
```

### Mercado Pago — falta somente preencher

```env
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-...
MERCADO_PAGO_WEBHOOK_SECRET=...
MERCADO_PAGO_USE_SANDBOX=false
MERCADO_PAGO_PAYMENT_EXPIRATION_DAYS=3
```

Quando `MERCADO_PAGO_ACCESS_TOKEN` + `MERCADO_PAGO_WEBHOOK_SECRET` estiverem configurados, a loja habilita automaticamente:

```text
Pagar online — Mercado Pago
PIX ou cartão no ambiente seguro do Mercado Pago
```

O endpoint de webhook é:

```text
https://SEU-DOMINIO/api/webhooks/mercadopago
```

A aplicação valida `x-signature`/`x-request-id`, consulta o pagamento diretamente no Mercado Pago e somente então atualiza o pedido.

Referências oficiais utilizadas na preparação:

- https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/payment-notifications
- https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-settings/expiration-date
- https://github.com/mercadopago/sdk-nodejs

## Frete

```env
SHIPPING_MODE=quote
SHIPPING_FIXED_CENTS=1500
FREE_SHIPPING_CENTS=30000
ALLOW_PAYMENT_WITH_QUOTED_SHIPPING=false
```

Modos:

- `quote`: Admin define o frete depois que o pedido é criado;
- `fixed`: usa valor fixo em centavos;
- `zones`: usa zonas configuradas no catálogo;
- retirada sempre tem frete zero.

Enquanto um pedido de entrega estiver com frete sob cotação, o pagamento online permanece bloqueado. Depois que o Admin salva o frete, o total é atualizado e o cliente pode iniciar o pagamento pelo acompanhamento do pedido.

## Estoque

O pedido é validado contra o catálogo ao ser criado. A baixa efetiva ocorre uma única vez quando o pedido avança pela primeira vez para:

- `paid`;
- `preparing`;
- `ready`;
- `completed`.

O campo `inventoryCommittedAt` impede baixa repetida. Reembolso não repõe estoque automaticamente, porque a devolução física precisa ser validada operacionalmente.

## Status

- `received` — pedido recebido;
- `awaiting_payment` — aguardando Mercado Pago;
- `paid` — pago;
- `payment_failed` — pagamento recusado/cancelado;
- `payment_expired` — tentativa expirada;
- `payment_review` — mediação, divergência ou reembolso parcial;
- `preparing` — preparando;
- `ready` — pronto;
- `completed` — concluído;
- `refunded` — reembolsado;
- `chargeback` — contestado;
- `cancelled` — cancelado manualmente.

## API

### Pública

- `GET /api/health`
- `GET /api/catalog`
- `POST /api/orders`
- `POST /api/orders/status`
- `POST /api/payments/checkout`
- `POST /api/webhooks/mercadopago`

### Admin

Requer:

```http
Authorization: Bearer <ADMIN_API_TOKEN>
```

- `GET /api/admin/orders`
- `GET /api/admin/orders/:id`
- `PATCH /api/admin/orders/:id`
- `PATCH /api/admin/orders/:id/shipping`
- `GET /api/admin/customers`
- `PUT /api/admin/catalog`

## Segurança

O navegador não define preços finais. O backend usa IDs de produto/variante e recalcula os valores a partir do catálogo persistido. O `checkoutToken` é exigido para consultar o pedido na sessão e iniciar pagamento. O token do Admin fica somente em `sessionStorage` no navegador do administrador.

## Verificação

```bash
npm run verify
```

Executa:

1. sintaxe dos arquivos JavaScript;
2. testes automatizados;
3. auditoria de arquivos públicos, assets e padrões perigosos.

## Antes de produção

- [ ] PostgreSQL ativo;
- [ ] `NODE_ENV=production`;
- [ ] `PUBLIC_URL` HTTPS;
- [ ] `ADMIN_API_TOKEN` forte;
- [ ] catálogo, preços e estoques revisados;
- [ ] frete definido (`fixed`, `zones` ou processo de cotação);
- [ ] Access Token do Mercado Pago;
- [ ] segredo Webhook do Mercado Pago;
- [ ] URL do webhook configurada na aplicação Mercado Pago;
- [ ] pagamento de teste aprovado;
- [ ] webhook de pagamento aprovado testado;
- [ ] `npm run verify` aprovado.
