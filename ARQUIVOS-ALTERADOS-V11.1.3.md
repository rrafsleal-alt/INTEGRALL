# Arquivos alterados — INTEGRALL v11.1.3

Principais arquivos modificados em relação à v11.1.2:

- `package.json` / `package-lock.json` — versão e scripts de validação v11.1.3.
- `public/index.html`, `public/admin.html`, `public/404.html`, `public/500.html` — cache-busting da revisão atual.
- `public/css/store.css` — popup sem blur, rolagem única, smart-fill quadrado e controles de carrossel.
- `public/css/premium-v104.css` — compatibilidade do tema premium com cards quadrados/smart-fill.
- `public/css/admin.css` — remoção de rolagens aninhadas e preview sticky responsivo.
- `public/js/store/catalog.js` — carrossel em cards e popup, swipe, teclado, imagem inteligente, sincronização com variação e encaminhamento de roda no overlay.
- `public/js/admin.js` — defaults quadrados e handoff da roda do iframe para o Admin.
- `data/catalog.json` / `data/catalog.seed.json` — defaults visuais normalizados para imagem quadrada sem corte e overlay leve.
- `tests/v11.1.3-ux.test.js` — regressões específicas da revisão.
- `tests/v11.1.2-ux.test.js` — contratos herdados ajustados sem exigir arquitetura obsoleta.
- `scripts/browser-regression.py` — valida carrossel, smart-fill, rolagem no popup/overlay e 18 larguras.
- `scripts/admin-browser-regression.py` — valida rolagem natural e handoff do iframe.
- `scripts/gallery-browser-regression.py` — upload múltiplo e vínculo foto-variação.
- `scripts/audit.mjs` / `scripts/production-http-smoke.mjs` — versão e critérios atuais.
- `README.md`, `ALTERACOES-V11.1.3.md`, `MANIFESTO-V11.1.3.txt` — documentação da entrega.
- `docs/evidencias-v11.1.3/` — evidências de navegador da loja, Admin, galeria e build.
