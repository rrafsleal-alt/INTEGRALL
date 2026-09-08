# Arquivos alterados — INTEGRALL v11.1.1

A lista abaixo resume alterações funcionais relevantes em relação ao baseline v11.1.0. O patch completo está em `PATCH-V11.1.1.diff`.

| Arquivo/área | Motivo | Risco | Validação |
|---|---|---|---|
| `public/index.html` | substituir modal de produto por detalhes inline abaixo da grade; corrigir IDs/labels/semântica | alto | Chromium 18 larguras + testes estáticos |
| `public/css/store.css`, `public/css/premium-v104.css` | remover layout fixo/lateral, `min-width:320px` e overflow | alto | Chromium 18 larguras |
| `public/admin.html`, `public/css/admin.css` | remover IDs duplicados e overflow em 280 px | médio | Admin Chromium 18 larguras |
| `public/js/store/catalog.js`, `commerce-v111.js` | estado de detalhes inline, navegação, variação, busca e cache autenticado | alto | navegador + unitários |
| `src/config.js`, `src/auth.js` | hardening da credencial inicial, produção e sessão | alto | testes auth/default-admin/security |
| `src/customer-auth.js` | `no-store`, same-origin + CSRF e hardening de código/sessão | alto | `customer-auth-hardening.test.js` |
| `src/public-order.js` | minimizar resposta pública de acompanhamento e remover PII/dados internos | alto | `public-order.test.js` |
| `src/payments.js`, `tests/payments-checkout.test.js` | alinhar expiração do Checkout Pro à reserva de estoque | alto | teste de checkout + payment-state |
| `src/repository.js` | import dinâmico de PG; normalização de catálogo persistido; integridade de dados | alto | repository tests + audit |
| `src/payments.js` | import dinâmico do SDK Mercado Pago e erros claros | médio | testes dependency-free/contratos |
| `src/catalog.js`, `data/catalog*.json` | normalização, IDs de variação únicos e sincronização do catálogo embutido | alto | audit + catalog tests |
| `server.js` | adequações de rotas, cache e integração com detalhes/conta | alto | testes + browser |
| `render.yaml`, `render-free-test.yaml`, `docker-compose.yml`, `.env.example` | produção não usa credencial inicial; variáveis coerentes | médio | security scan/default-admin |
| `INICIAR-INTEGRALL.bat`, `ABRIR-ADMIN.bat` | remover senha exposta no console | baixo | scanner + teste estático |
| `scripts/audit.mjs`, `security-scan.mjs` | auditoria reproduzível e segurança estática | baixo | execução bem-sucedida |
| `scripts/browser-regression.py` | regressão visual/funcional da loja em 18 larguras | baixo | execução bem-sucedida |
| `scripts/admin-browser-regression.py` | regressão do Admin/login em 18 larguras | baixo | execução bem-sucedida |
| `scripts/build-production.mjs` | build/staging determinístico com manifesto SHA-256 | médio | build aprovado |
| `scripts/production-browser-smoke.py` | smoke do `dist` servido por HTTP | baixo | script criado; execução bloqueada pelo ambiente |
| `scripts/sync-embedded-catalog.mjs` | manter catálogo embutido do fallback sincronizado | médio | build/audit |
| `tests/*` | cobrir autenticação, integridade, catálogo, repositório e regressões v11.1.1 | baixo | 121/121 independentes |
| `tools/*` | caminhos robustos e limpeza de scripts temporários de patch | baixo | audit/tools |
| `pdftext/*` | corrigir nomes Unicode corrompidos | baixo | auditoria estrutural |
| `README.md` e documentação v11.1.1 | refletir estado auditado e limitações reais | baixo | revisão final |
