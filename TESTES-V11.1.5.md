# INTEGRALL v11.1.5 — TESTES EXECUTADOS

## Ambiente

- Node.js: v22.16.0
- npm: 10.9.2
- Python: 3.13.5
- Chromium headless: disponível no ambiente de auditoria

## Resultado

| Validação | Resultado |
|---|---|
| Manifesto da base v11.1.4 antes das alterações | APROVADO — 849 hashes |
| Sintaxe JS (`npm run check`) | APROVADO — 62 arquivos |
| Suíte independente | APROVADO — 147/147 após inclusão do teste multilinha final |
| Suíte completa (`npm test`) | APROVADO nos executáveis — 162 cenários, 147 aprovados + 15 SKIP, 0 falhas |
| Scanner de segurança | APROVADO — 93 arquivos |
| Auditoria estrutural | APROVADO — 227 produtos / 52 variações |
| Auditoria de catálogo no modo pacote | APROVADO nas invariantes do ZIP |
| Loja Chromium | APROVADO — 18/18 larguras (280–2560 px) |
| Admin Chromium | APROVADO — 18/18, overflow=0, console errors=0 |
| Galeria Admin | APROVADO — seleção simultânea de 2 arquivos, 2 uploads, 3 fotos no payload e foto de variação vinculada |
| Build de produção | APROVADO — 292 arquivos |
| Smoke HTTP do `dist` | APROVADO — 8/8 cenários, 291 hashes |
| Browser regression no `dist` | APROVADO — 18/18 larguras |
| `npm audit --offline --omit=dev` | APROVADO — 0 vulnerabilidades registradas |
| `npm ci` online | NÃO EXECUTADO/CONCLUÍDO — timeout de acesso ao registry |
| `npm ci --offline` | NÃO EXECUTADO/CONCLUÍDO — cache ausente (`ENOTCACHED`, `xtend-4.0.2.tgz`) |
| Conferência contra PDFs originais | NÃO EXECUTADO — fontes não presentes no ZIP |

> A contagem final será repetida a partir do ZIP gerado; este documento deve ser lido junto ao reteste final.
