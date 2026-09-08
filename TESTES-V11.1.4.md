# TESTES — INTEGRALL v11.1.4

Data: 02/09/2026

## Resultado na pasta de trabalho

| Verificação | Resultado |
|---|---|
| `npm run check` | APROVADO — 61 arquivos JavaScript |
| `npm run test:dependency-free` | APROVADO — 143/143 |
| `npm test` | 158 cenários: 143 APROVADOS, 15 SKIP, 0 FALHAS |
| `npm run security:scan` | APROVADO |
| `npm audit --offline --omit=dev` | APROVADO — 0 vulnerabilidades registradas |
| `npm run audit` | APROVADO — 227 produtos, 52 variações |
| `python3 tools/audit_products.py` | APROVADO no modo pacote |
| Loja Chromium | APROVADO — 18/18 larguras, 280 a 2560 px |
| Admin Chromium | APROVADO — 18/18; login/logout; scroll/iframe; 0 overflow; 0 erros de console |
| Galeria Admin Chromium | APROVADO — 2 arquivos selecionados juntos, 2 uploads, 3 fotos no payload, foto da variação vinculada |
| `npm run build:production` | APROVADO — 292 arquivos; manifesto do build verificado |
| `npm run test:production:http` | APROVADO — 8/8; 291 hashes verificados |
| Browser regression sobre `dist` | APROVADO — 18/18 larguras |
| Browser HTTP sobre loopback | NÃO EXECUTADO — `ERR_BLOCKED_BY_ADMINISTRATOR` para `127.0.0.1` |
| `npm ci` limpo | NÃO EXECUTADO integralmente — registry/npm indisponível/intermitente |

## Cenários adicionados nesta revisão

- conta não empilha sobre popup do produto;
- foco permanece dentro da conta quando aberta;
- fechamento da conta restaura lock/foco corretamente;
- favorito solicitado antes do login é aplicado após autenticação;
- sugestões de busca aceitam setas e Escape;
- auditoria de catálogo funciona sem PDFs-fonte;
- smoke de produção valida o popup atual e não o layout obsoleto;
- testes de cache-busting acompanham a versão corrente.

## SKIPs da suíte completa

Os 15 SKIPs correspondem a testes HTTP/dependentes de pacotes externos que não estavam instalados de forma válida no ambiente. Isso foi mantido explicitamente como SKIP; nenhum cenário não executado foi promovido a APROVADO.
