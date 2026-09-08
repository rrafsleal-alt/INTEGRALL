# ARQUIVOS ALTERADOS — v11.1.4

## Runtime / interface

- `public/index.html` — semântica da busca, acessibilidade e versão/cache-busting.
- `public/js/store/catalog.js` — navegação da busca, fechamento de sugestões e coordenação da sacola/camadas.
- `public/js/store/commerce-v111.js` — coordenação de conta/produto/sacola, foco, lock e favorito pendente.
- `public/js/store/checkout.js` — acompanhamento de pedido sem empilhamento de camada e restauração de foco.
- `public/admin.html`, `public/404.html`, `public/500.html` — sincronização de versão/cache-busting.

## Testes e auditoria

- `tests/v11.1.4-ux.test.js` — regressões novas da revisão.
- `tests/v11.1.2-ux.test.js` — remove dependência rígida da versão histórica.
- `tests/v11.1.3-ux.test.js` — remove dependência rígida da versão histórica.
- `scripts/browser-regression.py` — cenários de camadas e busca por teclado; evidências v11.1.4.
- `scripts/production-browser-smoke.py` — valida popup atual, removendo requisito obsoleto de layout inline.
- `scripts/gallery-browser-regression.py` — saída/evidência sincronizada com v11.1.4.
- `scripts/production-http-smoke.mjs` — versão corrente da entrega.
- `tools/audit_products.py` — modo de auditoria funcional no pacote sem PDFs.
- `tools/README.md` — documentação do modo pacote e do modo fonte.

## Metadados e documentação

- `package.json`, `package-lock.json` — versão 11.1.4 e novos gates.
- `README.md`, `LEIA-ME-PRIMEIRO.txt` — versão/comandos/arquitetura atualizados.
- `ALTERACOES-V11.1.4.md` — resumo das correções.
- `AUDITORIA-V11.1.4.md` — achados e riscos residuais.
- `TESTES-V11.1.4.md` — matriz de validação.
- `ARQUIVOS-ALTERADOS-V11.1.4.md` — este documento.
- `PATCH-V11.1.4.diff` — diferenças relevantes em relação à v11.1.3.
- `MANIFESTO-V11.1.4.txt` e `MANIFEST.sha256` — integridade da entrega.

`dist/` foi regenerado integralmente a partir das fontes v11.1.4.
