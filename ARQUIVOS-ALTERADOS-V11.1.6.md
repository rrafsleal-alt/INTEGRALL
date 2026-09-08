# ARQUIVOS ALTERADOS — INTEGRALL v11.1.6

Comparação contra a base v11.1.5. Risco = risco da alteração, não severidade do bug original.

| Arquivo | Motivo / alteração | Risco | Validação principal |
|---|---|---:|---|
| `server.js` | idempotência preflight, revisões otimistas, tombstones, rotas públicas/SEO, promoção/frete/conta hardening | alto | expert + suíte completa |
| `src/repository.js` | locks transacionais/memória, estoque tardio, advisory lock PostgreSQL, merge/alertas | alto | expert/fuzz/repository |
| `src/inventory-reservation.js` | commit/release estritos e anchors históricos | alto | expert/fuzz |
| `src/order-idempotency.js` | capability/hash estável de tentativa | médio | expert |
| `src/payment-checkout-guard.js` | serialização/idempotência de checkout | médio | expert/payments |
| `src/order-financials.js` | regras financeiras compartilhadas | alto | expert |
| `src/order-state.js` | estados coerentes após reserva expirada/review | alto | expert/order-state |
| `src/payments.js` | guardas de preferência/pagamento | alto | expert/payments |
| `src/public-order.js` | projeção pública preserva frete `null` e minimiza dados | médio | expert/public-order |
| `src/shipping-quote.js` | validação comum antes de transportadora | alto | expert |
| `src/correios.js` | fail-safe de peso/dimensões/geometria | alto | expert/correios |
| `src/jadlog.js` | limite pelo peso real, sem truncamento inseguro | alto | expert/jadlog |
| `src/catalog-revision.js` | revisão SHA-256 de catálogo/produto/seção | médio | expert |
| `src/catalog.js` | tombstones, promoções, preços/nomes ativos, normalização | alto | expert/catalog |
| `src/config.js` | validações de produção/URL e coerência | médio | expert/config |
| `src/mailer.js` | sanitização de mailbox/header e retry seguro | médio | mailer/expert |
| `src/security.js` | hardening de rate-limit/headers já existentes | médio | security scan/tests |
| `public/js/store/catalog.js` | mínimo por pedido, UX/estado e filtros de tombstone | médio | Chromium 18/18 |
| `public/js/store/checkout.js` | checkout/idempotência/financeiro/frete e estados públicos | alto | expert + Chromium |
| `public/js/store/age-gate.js` | coerência de versão/estado | baixo | regressão Chromium |
| `public/js/admin.js` | revisões otimistas, tombstones, promoções e conflitos multiaba | alto | Admin 18/18 + expert |
| `public/index.html` | versão/cache-busting/fallback sincronizado | médio | audit + Chromium |
| `public/admin.html` | versão/cache-busting/controles coerentes | baixo | Admin 18/18 |
| `public/404.html`, `public/500.html` | cache-busting 11.1.6 | baixo | build/smoke |
| `scripts/browser-regression.py` | evidências e casos expert atualizados | baixo | execução 18/18 |
| `scripts/gallery-browser-regression.py` | evidência v11.1.6 e galeria múltipla | baixo | execução real |
| `scripts/production-browser-smoke.py` | versão/saída atualizadas | baixo | build |
| `tests/v11.1.6-expert.test.js` | 48 regressões expert, concorrência e fuzz | baixo | 48/48 |
| `tests/http.test.js` | contratos HTTP adicionais (quando deps disponíveis) | baixo | sintaxe; HTTP SKIP local |
| `tests/mailer.test.js` | casos de sanitização de e-mail | baixo | suíte offline |
| `package.json`, `package-lock.json` | versão 11.1.6 e gates atuais | baixo | verify/build |
| `README.md`, `LEIA-ME-PRIMEIRO.txt` | documentação atual | baixo | revisão manual |
| `dist/` | build de produção regenerado | baixo | smoke + Chromium |
| `docs/evidencias-v11.1.6/` | evidências de navegador | baixo | arquivos gerados pelos testes |
| documentação v11.1.6 e `PATCH-V11.1.6.diff` | rastreabilidade | baixo | revisão/manifesto |

Nenhuma mídia de produto foi alterada durante a auditoria.
