# Segurança — INTEGRALL

## Segredos

Nunca coloque `ADMIN_API_TOKEN`, `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` ou `DATABASE_URL` em HTML, JavaScript público, catálogo ou Git.

O painel administrativo mantém o token somente em `sessionStorage`; dados pessoais preenchidos no checkout também usam `sessionStorage`, enquanto a sacola de produtos pode persistir em `localStorage`; fechar a sessão remove o token. Em produção, gere um `ADMIN_API_TOKEN` aleatório com pelo menos 32 caracteres.

## Pedidos e preços

O navegador envia somente IDs, quantidades, variante, presente e dados do cliente/entrega. O servidor consulta o catálogo persistido e recalcula preço unitário, subtotal, frete e total. Campos de preço enviados pelo navegador são ignorados.

`clientOrderId` possui unicidade no banco para tornar a criação do pedido idempotente. A resposta pública de criação não devolve PII do cliente. Cada pedido recebe ainda um `checkoutToken` aleatório de 192 bits; as rotas de acompanhamento e criação de pagamento exigem o par `orderId` + `checkoutToken`, comparado em tempo constante.

## Mercado Pago

Quando `MERCADO_PAGO_ACCESS_TOKEN` estiver configurado em produção, `MERCADO_PAGO_WEBHOOK_SECRET` também é obrigatório. O webhook valida `x-signature`, `x-request-id` e `data.id` antes de consultar o pagamento na API do Mercado Pago. O pedido só é marcado como pago quando valor, moeda e preferência retornados pelo provedor coincidem com os dados calculados/salvos no servidor. Webhooks fora de ordem não rebaixam pagamentos já confirmados; mediação, expiração, reembolso e chargeback são sinalizados para operação. A baixa de estoque usa um marcador idempotente (`inventoryCommittedAt`) para não repetir a movimentação.

## Frontend

A Content Security Policy bloqueia scripts externos e código inline. Conteúdo dinâmico de cliente/pedidos no painel é inserido com `textContent`/DOM APIs, não por concatenação de HTML. O snapshot antigo fica em `archive/`, fora do diretório servido ao público.

## Operação

- Use HTTPS em produção.
- Restrinja o acesso ao PostgreSQL; o Blueprint deixa `ipAllowList: []`.
- Revogue imediatamente qualquer segredo que tenha sido compartilhado publicamente.
- Teste o webhook no painel do Mercado Pago antes de aceitar pagamentos reais.
- Faça backups do PostgreSQL conforme sua política operacional.
