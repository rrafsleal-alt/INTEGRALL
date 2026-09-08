# ARQUIVOS ALTERADOS — v11.1.5

- `src/catalog.js` — sanitização multilinha segura para textos legais.
- `public/js/store/checkout.js` — coordenador de camadas legais/status, backdrops, foco e lock de scroll; sanitização multilinha no frontend.
- `public/js/store/commerce-v111.js` — fechamento coordenado da conta por evento interno.
- `public/css/checkout.css` — backdrop autônomo sem blur e largura adequada do modal legal.
- `scripts/browser-regression.py` — novo cenário legal/multilinha, versão atual e remoção de diagnóstico duplicado.
- `scripts/production-http-smoke.mjs` — marcador de versão derivado do `package.json`.
- `scripts/production-browser-smoke.py` — caminho/default de evidências v11.1.5.
- `scripts/gallery-browser-regression.py` — caminho/default de evidências v11.1.5.
- `tests/v11.1.4-ux.test.js` — teste histórico desacoplado de implementação antiga.
- `tests/v11.1.5-ux.test.js` — regressões dos novos achados.
- `package.json`, `package-lock.json` — versão 11.1.5 e gates atualizados.
- `public/index.html`, `public/admin.html`, `public/404.html`, `public/500.html` — cache-busting v11.1.5; `index.html` com fallback regenerado.
- `README.md`, `LEIA-ME-PRIMEIRO.txt`, `CHANGELOG_AUDIT.md` — documentação corrente.
- `ALTERACOES-V11.1.5.md`, `AUDITORIA-V11.1.5.md`, `TESTES-V11.1.5.md`, `ARQUIVOS-ALTERADOS-V11.1.5.md`, `PATCH-V11.1.5.diff`, `MANIFESTO-V11.1.5.txt` — rastreabilidade da entrega.
- `dist/` — regenerado integralmente pelo build de produção.
