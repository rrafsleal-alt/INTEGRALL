# INTEGRALL Online v9.5

Loja virtual da **INTEGRALL | Boutique Gourmet** — vinhos, sucos, cafés e petit four — com catálogo, carrinho, pedidos server-side, clientes, acompanhamento de pedido, painel administrativo, PostgreSQL, **frete automático (Correios + Jadlog)**, **e-mail transacional**, cupons de desconto, verificação de idade 18+ e integração **Mercado Pago Checkout Pro** pronta para credenciais.

## Fluxo da loja

1. Cliente confirma ter 18+ (obrigatório — a loja vende bebida alcoólica).
2. Escolhe produtos, variações e quantidades (com mínimo/máximo por produto).
3. Define retirada ou entrega; para entrega, informa CEP e endereço completo.
4. **O frete é cotado automaticamente**: até 12 unidades pelos Correios (PAC/SEDEX), acima de 12 pela Jadlog (.Package) — preço + prazo na hora, com seguro (valor declarado) embutido.
5. Pode aplicar cupom de desconto (validado no servidor).
6. O servidor recalcula preços, estoque, frete e desconto e cria o pedido.
7. Cliente recebe **e-mail de confirmação** com resumo e link de acompanhamento.
8. Se o Mercado Pago estiver configurado, segue para PIX ou cartão no Checkout Pro.
9. O webhook confirma o pagamento; o pedido vira `paid` e o estoque baixa uma única vez.
10. Admin avança o fluxo (`paid → preparing → ready → completed`) e informa o **código de rastreio** — o cliente é avisado por e-mail e acompanha a entrega.
11. Pedidos sem pagamento expiram automaticamente após 7 dias.

## Rodar localmente

```bash
npm install
npm run dev
```

- Loja: `http://localhost:3000/`
- Admin: `http://localhost:3000/admin` (token em `ADMIN_API_TOKEN` no `.env`)
- Health: `http://localhost:3000/api/health`

No Windows: `INICIAR-INTEGRALL.bat`. Com `DATABASE_URL` vazio em desenvolvimento, usa memória (pedidos somem ao reiniciar). PostgreSQL local: `INICIAR-COM-POSTGRES-LOCAL.bat` (Docker).

## Configuração (.env)

Veja `.env.example` com todos os comentários. Resumo dos blocos:

| Bloco | Variáveis-chave | Efeito quando preenchido |
|---|---|---|
| Servidor | `NODE_ENV`, `PORT`, `PUBLIC_URL`, `TRUST_PROXY` | produção exige PostgreSQL + HTTPS |
| Banco | `DATABASE_URL` | pedidos/clientes/catálogo persistentes |
| Admin | `ADMIN_API_TOKEN` (≥32 chars em produção) | acesso ao painel |
| Mercado Pago | `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` | PIX/cartão no Checkout Pro |
| **Correios** | `CORREIOS_USER`, `CORREIOS_ACCESS_CODE`, `CORREIOS_POSTAGE_CARD`, `CORREIOS_ORIGIN_CEP` + `SHIPPING_MODE=correios` | frete PAC/SEDEX automático |
| **Jadlog** | `JADLOG_TOKEN`, `JADLOG_CNPJ`, `JADLOG_CONTA` | frete .Package automático |
| Divisão | `CARRIER_SPLIT_UNITS=12` | até 12 un → Correios; acima → Jadlog; `0` = todas cotam |
| E-mail | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | confirmação de pedido/status/rastreio |
| Operação | `ORDER_EXPIRE_DAYS=7` | expira pedidos sem pagamento |
| Frete manual | `SHIPPING_MODE=quote|fixed|zones`, `FREE_SHIPPING_CENTS` | modos sem API |

### Frete automático — Correios (contrato)

> **Pré-requisito do contrato** (manual oficial da API Preço): os serviços **38202 – API PREÇOS** e **38210 – API PRAZOS** precisam estar **vinculados ao contrato e aos cartões de postagem** (modalidade a faturar). Sem esse cadastro a API retorna "restrita" — peça a liberação ao representante comercial dos Correios antes de configurar.

1. No CWS (`https://cws.correios.com.br`), gere o **código de acesso a APIs** (Gestão de acesso a APIs).
2. Preencha `CORREIOS_USER` (usuário Meu Correios PJ), `CORREIOS_ACCESS_CODE`, `CORREIOS_POSTAGE_CARD` (cartão de postagem) e `CORREIOS_ORIGIN_CEP`.
3. `SHIPPING_MODE=correios` ativa a cotação automática. Serviços padrão: `03298` (PAC contrato) e `03220` (SEDEX contrato) — ajuste `CORREIOS_SERVICES` conforme sua ficha técnica.
4. `CORREIOS_HOMOLOG=true` usa o ambiente `apihom` para testes (exige conta no Meu Correios **Homologação** e senha de APIs no CWS Homologação).
5. O valor declarado (seguro) é enviado automaticamente com o subtotal do pedido, com o **código correto por serviço** (019 no SEDEX, 064 no PAC) — essencial para garrafas.
6. `CORREIOS_API_VERSION` (padrão `v1`): o manual cita `/preco/v1` nos exemplos e `/preco/v3` na seção Ambientes; se a homologação exigir v3, ajuste a variável sem mudar código.

### Frete automático — Jadlog

1. Peça o **token de integração** à franquia Jadlog que atende seu CNPJ.
2. Preencha `JADLOG_TOKEN`, `JADLOG_CNPJ` e, se correntista, `JADLOG_CONTA`/`JADLOG_CONTRATO`.
3. Modalidade padrão: `3` (.Package). O peso enviado é sempre o maior entre real e cubado (C×L×A÷6000), conforme manual v2.3.

**Regra de divisão** (`CARRIER_SPLIT_UNITS`, padrão 12): pedidos com até 12 unidades vão pelos Correios; acima, pela Jadlog. Imposta pelo servidor (o navegador não força a transportadora). Se a preferida falhar ou não tiver credenciais, a outra assume automaticamente.

### Empacotamento e caixas reais

O servidor monta os volumes do pedido antes de cotar:

- **Caixas reais cadastradas** (campo `boxes` do produto): caixa 6×750ml (30×25×17 cm, 7,25 kg), caixa 12×750ml (30×30×24 cm, 14 kg), caixa 12×300ml (23×18×19 cm, 6,2 kg), caixa 12×1L (37×27×29 cm, 18 kg). Quantidades que fecham caixa usam medidas e pesos exatos.
- **Avulsos**: empacotados em grade quase quadrada com garrafas **em pé** (exigência das transportadoras), minimizando o peso cúbico.
- Pedidos grandes geram múltiplos volumes; o frete é a soma de todos.
- Peso/dimensões de cada produto são editáveis no **Admin → Produtos**.

## Painel administrativo

- **Pedidos**: busca, filtro por status, detalhes completos, mudança de status, cotação manual de frete, **código de rastreio** (link Correios automático), histórico, exportação CSV.
- **Produtos**: edição de preço, estoque, descrição, mín/máx por pedido, peso e dimensões — sem JSON.
- **Cupons**: porcentagem, valor fixo ou frete grátis; pedido mínimo e validade; ativar/desativar/excluir.
- **Clientes**: consolidados automaticamente por e-mail/telefone.
- **Catálogo**: exportação/importação JSON completa (backup).

## API

### Pública

- `GET /api/health` — status e recursos ativos
- `GET /api/catalog` — catálogo sanitizado (sem cupons, sem segredos)
- `POST /api/shipping/quote` — cotação de frete `{cep, items}` → opções com preço/prazo
- `POST /api/coupons/validate` — pré-validação de cupom
- `POST /api/orders` — criação de pedido (preços/frete/desconto recalculados no servidor)
- `POST /api/orders/status` — acompanhamento (`orderId` + `checkoutToken`)
- `POST /api/payments/checkout` — inicia Checkout Pro
- `POST /api/webhooks/mercadopago` — webhook assinado

### Admin (`Authorization: Bearer <ADMIN_API_TOKEN>`)

- `GET/PATCH /api/admin/orders[/:id]` — listagem e status
- `PATCH /api/admin/orders/:id/shipping` — cotação manual de frete
- `PATCH /api/admin/orders/:id/tracking` — código de rastreio
- `GET/PATCH /api/admin/products[/:id]` — editor de produtos
- `GET/PUT /api/admin/coupons` — cupons
- `GET /api/admin/customers` — clientes
- `PUT /api/admin/catalog` — catálogo completo

## Status do pedido

`received` → `awaiting_payment` → `paid` → `preparing` → `ready` → `completed`, com estados de exceção: `payment_failed`, `payment_expired`, `payment_review`, `refunded`, `chargeback`, `cancelled` (manual ou expiração automática).

## Segurança

- O navegador **nunca define preços, frete ou desconto** — o servidor recalcula tudo do catálogo persistido; campos injetados (ex.: `shipping.resolved`) são descartados.
- `checkoutToken` de 192 bits por pedido, comparado em tempo constante; criação idempotente por `clientOrderId`; baixa de estoque idempotente (`inventoryCommittedAt`).
- Webhook Mercado Pago: valida assinatura, consulta o pagamento na API e confere valor/moeda/preferência antes de qualquer mudança.
- Pedido com bebida alcoólica exige confirmação de maioridade **no servidor** (Lei nº 13.106/2015).
- CSP estrita, rate limiting por rota, headers de segurança, credenciais só em variáveis de ambiente.
- Detalhes em `SECURITY.md`.

## Conformidade

- Verificação de idade 18+ na entrada + aviso legal no rodapé (Lei 13.106/2015).
- Política de privacidade (LGPD), termos de uso e trocas/devoluções (CDC art. 49) publicados na loja.
- Cadastre o CNPJ no campo `taxId` do catálogo (Decreto 7.962/2013).

## Verificação

```bash
npm run verify   # sintaxe + 51 testes + auditoria de arquivos públicos
```

## Deploy (Render)

`render.yaml` provisiona web service + PostgreSQL. Preencha no painel: `PUBLIC_URL`, `ADMIN_API_TOKEN`, credenciais do Mercado Pago, dos Correios, da Jadlog e do SMTP (todos `sync: false`). Blueprint de teste gratuito: `render-free-test.yaml`.

## Antes de vender de verdade (checklist)

- [ ] PostgreSQL ativo e `NODE_ENV=production`
- [ ] `PUBLIC_URL` HTTPS e `ADMIN_API_TOKEN` forte (≥32 chars aleatórios)
- [ ] Credenciais Correios preenchidas e cotação testada com CEPs reais
- [ ] (Opcional) Token Jadlog para pedidos acima de 12 unidades
- [ ] SMTP configurado e e-mail de confirmação testado
- [ ] Access Token + Webhook Secret do Mercado Pago; webhook configurado; compra de teste aprovada
- [ ] CNPJ no catálogo; preços, estoques e descrições revisados
- [ ] Caixas com colmeia divisória para garrafas (exigência das transportadoras)
- [ ] `npm run verify` aprovado

## Documentação de referência

- `docs/correios-manual-integracao-v2.4.pdf` — manual oficial Correios API (token, preço, prazo, rastro)
- `docs/correios-api-busca-cep.txt` — manual da API Busca CEP
- `docs/correios-api-locker.pdf` — API Locker (não utilizada; referência futura)
- `docs/ANALISE-TECNICA.md` — análise técnica do projeto
- Manual Jadlog: https://www.jadlog.com.br/jadlog/arquivos/api_integracao.pdf
- Mercado Pago: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/payment-notifications
