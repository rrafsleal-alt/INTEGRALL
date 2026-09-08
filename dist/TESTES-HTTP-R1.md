# INTEGRALL — testes da correção HTTP-R1

Data: 07/09/2026. Ambiente de execução desta revisão: Linux x86_64, Node.js 22.16.0, npm 10.9.2. Não houve execução em Windows nesta revisão.

## Matriz efetivamente executada

| Ensaio/comando | Resultado | Escopo |
| --- | --- | --- |
| `node --check server.js` e `node --check tests/http.test.js` | APROVADO | Sintaxe dos arquivos modificados. |
| `npm run test:http:fix` | APROVADO — 21 testes | Módulos reais e callbacks literais de rotas, com repositório real temporário; sem Express. |
| `npm run build:offline` | APROVADO — 322 testes, zero falhas e zero pulados | Inclui os 301 testes anteriores sem dependências externas e os 21 novos, além de sintaxe, lint, auditoria, mídia, empacotamento e manifesto. |
| Comparação de handler anterior/corrigido | APROVADO — 5 cenários comparados | Reproduz quatro alterações financeiras inseguras no handler original, bloqueadas na correção, e preserva o bloqueio de preferência já existente. Sem middleware/HTTP Express. |
| `npm run test:production:http` | APROVADO — 10 verificações | Servidor HTTP estático sobre os arquivos de `dist/public`; não é o servidor Express. |
| Aplicador do patch HTTP-R1 | APROVADO — 10 testes | Caminhos com espaços, preflight sem escrita, preservação de dados/configuração, backup, idempotência, recusa de edições locais/links/payload inválido e rollback após falha de escrita simulada. Aplicador Node em Linux; wrapper CMD não executado. |
| `npm ci` | NÃO CONCLUÍDO | O ambiente não resolveu/acessou registry.npmjs.org; ocorreram falhas EAI_AGAIN e timeout. O lockfile não foi apagado nem atualizado. |
| `npm run test:http` | REPROVADO NA CARGA DA DEPENDÊNCIA | Express não instalado neste ambiente; ERR_MODULE_NOT_FOUND antes de executar os 15 casos HTTP. |
| `npm run verify` (perfil completo) | NÃO APROVADO | A suíte HTTP obrigatória não pode carregar Express neste ambiente. Não declarar os 337 testes previstos para a suíte completa como aprovados. |
| Windows, navegador ligado ao servidor Express, HTTPS real, PostgreSQL e serviços externos | NÃO EXECUTADO | Necessitam ambiente com dependências e, quando aplicável, credenciais privadas/configuração de homologação. |

Os testes locais sem dependências externas não significam ausência de HTTP em todos os testes antigos: algumas fixtures usam Node HTTP e transportadoras simuladas. Significam que não dependem dos pacotes externos da aplicação. O arquivo novo `tests/http-fix-regression.test.js` extrai e invoca os callbacks reais de `server.js`; ele não cria um Express substituto e não está qualificado como aprovação de roteamento, middleware, cookie, parser ou TLS.

## Os 21 testes novos

O arquivo `tests/http-fix-regression.test.js` cobre: reserva, cancelamento e pagamento sem dupla baixa; revisão de cupons; frete grátis após confirmação manual; validação de preço de produto com revisão; estoque concorrente invalidando revisão; personalização com revisão; duas escritas simultâneas; exclusão lógica repetida com restituição de reserva; estados aguardando pagamento e em análise; preferência conhecida; claim antes da preferência; timeout; claim antigo; tentativa malformada; ciclo claim/timeout/retry; falha de persistência; valor inválido/retirada/ID ausente; estados finais; isolamento das variáveis do subprocesso; e presença das proteções na suíte Express obrigatória.

## Alteração dos testes HTTP existentes

Os 15 casos existentes foram mantidos, com expectativas alinhadas às regras já implementadas e verificações negativas adicionais. Não se mudou um resultado esperado apenas para aceitar o comportamento observado: o estoque é verificado em cada etapa, a rejeição de revisões ausentes/antigas continua obrigatória, o preço inválido continua rejeitado, a exclusão é verificada como lógica e o bloqueio financeiro foi corrigido no backend.

O caso antes chamado de “preferência MP ativa” apenas mudava o status administrativamente. Seu nome agora expressa isso. As situações com preferência e claim efetivos no estado do pedido são cobertas adicionalmente no repositório e handler, sem cobrança real.

## O que permanece para aprovação na máquina do usuário

Na pasta que contém `package.json` e `server.js`, com as dependências já instaladas, execute:

```sh
npm run test:http
npm run verify
```

Em instalação nova, execute antes `npm ci`. A documentação oficial do npm confirma que esse comando usa o lockfile e não o reescreve: https://docs.npmjs.com/cli/v10/commands/npm-ci/ . A documentação do runner Node descreve os hooks por teste: https://nodejs.org/api/test.html . Essas referências apoiam o procedimento; os resultados acima vêm de execução local, não das documentações.

Critério: os comandos precisam terminar com exit code 0 e sem falhas/pulados. A suíte completa é composta pelos 322 testes sem dependências externas e 15 HTTP, totalizando 337; essa quantidade é um inventário, não uma alegação de execução completa aqui.

Depois, confirme manualmente criação de pedido, reserva/cancelamento, cupons, edição administrativa com conflito entre abas, cotação PAC/SEDEX com suas credenciais e impossibilidade de alterar o total quando existe tentativa de pagamento. Não use tokens já compartilhados na conversa. Não altere banco, catálogo ou stock para forçar aprovação de asserção.

Os logs desta revisão e o comprovante do reteste do ZIP são entregues separadamente. O build incluído no ZIP está identificado como `offline` em `dist/BUILD-INFO.json`, sem declaração de homologação completa de produção.
