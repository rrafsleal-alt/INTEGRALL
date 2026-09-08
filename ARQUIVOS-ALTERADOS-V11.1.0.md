# Arquivos alterados — INTEGRALL v11.1.0

Esta versão integra os itens 3, 4, 5, 8, 9, 11, 12, 13, 14 e 15 do plano de evolução comercial.

## Backend e regras comerciais

- `server.js` — conta do cliente, avaliações, avise-me, promoções, alertas de estoque, páginas SEO, sitemap e reserva expirada.
- `src/catalog.js` — slugs, preços promocionais, promoções automáticas e cálculo server-side.
- `src/repository.js` — persistência de conta, sessões, avaliações, avisos e reserva/baixa/liberação de estoque.
- `src/inventory-reservation.js` — motor isolado e testável de reserva de estoque.
- `src/customer-auth.js` — autenticação sem senha por código e sessão HttpOnly.
- `src/config.js` — parâmetros de reserva e sessões.
- `src/payments.js` — expiração do checkout alinhada à reserva.
- `src/payment-state.js` — proteção dos estados de pagamento com reserva.

## Banco

- `migrations/003_customer_commerce.up.sql`
- `migrations/003_customer_commerce.down.sql`

Inclui contas de clientes, códigos de acesso, sessões, avaliações, inscrições de reposição e índice de pedidos por e-mail.

## Loja

- `public/index.html` — conta, filtros avançados, avaliações, avise-me e barra de frete grátis.
- `public/css/commerce-v111.css` — estilos dos recursos v11.1.
- `public/js/store/catalog.js` — busca inteligente, filtros, promoções, URLs de produto e integração de recompra.
- `public/js/store/checkout.js` — prévia de promoções, frete grátis e reserva.
- `public/js/store/app.js` — carregamento de promoções.
- `public/js/store/commerce-v111.js` — conta, favoritos da conta, histórico, recompra, avaliações e avise-me.

## Admin

- `public/admin.html` — painéis de promoções, estoque crítico e moderação de avaliações.
- `public/js/admin.js` — CRUD de promoções, alertas, moderação e novos campos de produto.
- `public/css/admin.css` — estilos dos novos painéis.

## Configuração, testes e documentação

- `.env.example`
- `package.json`
- `package-lock.json`
- `README.md`
- `LEIA-ME-PRIMEIRO.txt`
- `DEPLOYMENT_RUNBOOK.md`
- `CHANGELOG_AUDIT.md`
- `RECURSOS-V11.1.0.md`
- `tests/v11.1-commerce.test.js`
- `scripts/verify-v11.0.4.mjs` — ajuste de compatibilidade do scanner.
