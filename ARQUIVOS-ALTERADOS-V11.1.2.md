# Arquivos alterados — INTEGRALL v11.1.2

## Loja
- `public/index.html` — produto passou a abrir como dialog/popup; adicionado controle “Ver mais produtos”; cache-busting v11.1.2.
- `public/css/store.css` — popup central responsivo com rolagem interna; catálogo progressivo; estabilidade do scroll.
- `public/js/store/catalog.js` — remoção do scroll automático ao abrir produto, integração do popup com overlay/foco/Escape e limite inicial de 12 produtos.

## Administração
- `public/admin.html` — texto da galeria deixa explícita a seleção múltipla; cache-busting v11.1.2.
- `public/js/admin.js` — `FileList` é copiado antes da limpeza do input, corrigindo upload de 2+ fotos em alguns navegadores.

## Testes e auditoria
- `tests/v11.1.2-ux.test.js` — contratos do popup, catálogo progressivo e seleção múltipla.
- `scripts/browser-regression.py` — 18 larguras; popup sem deslocamento; variante/foto; catálogo 12 + ver mais.
- `scripts/gallery-browser-regression.py` — teste real de duas imagens selecionadas juntas e persistência de três fotos no payload.
- `scripts/audit.mjs` — auditoria atualizada para o novo contrato de popup e catálogo progressivo.
- `scripts/production-http-smoke.mjs` — smoke de produção atualizado para v11.1.2.
- `package.json` / `package-lock.json` — versão 11.1.2 e comandos de verificação atualizados.

## Documentação
- `ALTERACOES-V11.1.2.md`
- `MANIFESTO-V11.1.2.txt`
- `README.md`
- `LEIA-ME-PRIMEIRO.txt`
- `ARQUIVOS-ALTERADOS-V11.1.2.md`
