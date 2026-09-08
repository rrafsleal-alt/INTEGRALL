# Testes — INTEGRALL v11.1.1

## Ambiente

- Data: 02/09/2026
- Node.js: v22.16.0
- npm: 10.9.2
- Python: 3.13.5
- Navegador executado: Chromium headless disponível no ambiente

## Matriz resumida

| Grupo | Resultado | Evidência |
|---|---|---|
| Verificação v11.1.1 independente | APROVADO — 132/132 | `npm run verify:v11.1.1` |
| Suíte total sem dependências instaladas | APROVADO COM SKIPS — 132 aprovados, 15 SKIP, 0 falhas | `npm test` |
| Scanner de segurança | APROVADO | `npm run security:scan` |
| Auditoria de dependências offline | APROVADO — 0 vulnerabilidades | `npm audit --omit=dev --offline --json` |
| Auditoria estrutural/catálogo | APROVADO | `npm run audit` |
| Loja em Chromium | APROVADO — 18/18 larguras | `npm run test:browser` |
| Admin em Chromium | APROVADO — 18/18 larguras; login errado/correto/logout; 0 overflow; 0 console errors | `npm run test:browser:admin` |
| Build de produção | APROVADO — 292 arquivos / 16.689.955 bytes | `npm run build:production` |
| Smoke HTTP do build | APROVADO — 8 cenários; 291 hashes revalidados | `npm run test:production:http` |
| Build em Chromium | APROVADO — 18/18 larguras | `npm run test:browser:production` |
| Instalação limpa `npm ci` | NÃO EXECUTADO com sucesso | registry/npm indisponível/timeout no ambiente |
| Integrações externas reais | NÃO EXECUTADO | sem PostgreSQL/credenciais/serviços externos |
| Firefox/WebKit/Safari | NÃO EXECUTADO | mecanismos não disponíveis |

## Responsividade efetivamente executada

280, 320, 360, 375, 390, 412, 430, 480, 600, 768, 820, 1024, 1280, 1366, 1440, 1600, 1920 e 2560 px.

A loja teve 18/18 larguras aprovadas, sem falhas. O Admin teve 18/18 larguras aprovadas, com overflow global igual a zero e sem erros de console.

## Autenticação administrativa exercitada

- credencial correta: aprovada;
- diferenças de maiúsculas/minúsculas: recusadas;
- senha incorreta: recusada;
- credencial customizada por `ADMIN_PASSWORD_HASH`: substitui a inicial;
- produção sem hash próprio: recusada por configuração;
- logout: aprovado no navegador;
- sessão/reload: cobertos pelos testes automatizados;
- credencial não aparece nos assets públicos nem nos atalhos Windows.

## Produto exercitado

- detalhes em fluxo normal abaixo da grade;
- ausência de `#productModal` legado;
- grid de detalhes com uma coluna em todas as larguras testadas;
- troca de produto sem resíduo de estado;
- variação selecionável;
- carrinho preserva a variação;
- busca/filtros semânticos;
- ausência de overflow horizontal;
- foto por variação coberta por teste automatizado;
- imagens locais sem 404 na auditoria de referências.

## Evidências

- Baseline: `docs/evidencias-v11.1.1/baseline/`
- Pós-correção: `docs/evidencias-v11.1.1/pos-correcao/`

## Testes não executados e risco residual

### `npm ci`
O ambiente não conseguiu concluir a comunicação com o registry npm. O lockfile foi mantido e o projeto continua configurado para `npm ci`. Risco residual: incompatibilidade de instalação não observável neste ambiente. Mitigação: CI/deploy deve executar `npm ci --omit=dev --no-audit --no-fund`.

### Testes HTTP/integrações
Os 15 testes dependentes de módulos externos foram corretamente reportados como SKIP. Devem ser reexecutados em CI após `npm ci` e com PostgreSQL disponível.

