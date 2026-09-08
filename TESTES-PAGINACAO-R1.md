# Testes — PAGINACAO-R1

Revisão de 07/09/2026. Node v22.16.0, npm 10.9.2, Chromium 144.0.7559.96, Linux.

## Resultados efetivamente observados

| Verificação | Resultado | Evidência |
|---|---|---|
| Baseline da entrega VISIBILIDADE-R1 | 336 testes locais aprovados; Gourmet renderizava 82 cards de uma vez | logs/baseline-tests.log e browser-baseline/baseline.json |
| Regras locais após a alteração | **345 aprovados**, sem falha, skip ou cancelamento; nove novos testes de paginação | logs/build-offline.log; tests/catalog-pagination.test.js |
| Interface de paginação e imagens reais | **56 verificações aprovadas**, incluindo 18 larguras | docs/evidencias-paginacao/results.json |
| Regressão de visibilidade | **16 verificações aprovadas**; abertura dos 227 produtos, 52 variações e proteção dos itens sem preço | logs/visibility-regression/results.json |
| Regressão de loja | **14 cenários aprovados**, com três larguras: 320, 768 e 1440 px | logs/store-regression-short/browser-regression.json |
| Regressão de cotação/checkout Correios com provedor simulado | **25 cenários aprovados**, sem consultar os Correios reais | logs/shipping-regression/results.json |
| Build offline | **APROVADO**; 449 arquivos, 448 hashes verificados | dist/BUILD-INFO.json e logs/build-offline.log |
| HTTP do pacote estático | **10 cenários aprovados** | logs/static-http.log |
| Instalação limpa | **NÃO CONCLUÍDA**; DNS do registro npm indisponível e npm encerrou com “Exit handler never called!” | logs/npm-ci.log |
| Build completo (`npm run verify`) | **REPROVADO por dependência ausente/incompleta**: Express não pôde ser importado na suíte HTTP. Os outros 345 testes passaram | logs/full-verify.log |
| Navegação HTTP nativa no Chromium deste ambiente | **BLOQUEADA**: ERR_BLOCKED_BY_ADMINISTRATOR, inclusive em servidor HTTP local | tentativa registrada no relatório de preparação |

As capturas são screenshots reais do projeto executado em uma página Chromium isolada (`about:blank`), com HTML, CSS, JavaScript e bytes das imagens do pacote. A política CSP de produção não está em vigor nessa página. Não representam homologação do servidor Express, cookies/HTTPS nativos, pagamentos ou transportadoras em produção.

## Cobertura nova

Foram verificadas a paginação de todos os 82 itens Gourmet e dos 227 itens da vitrine, ausência de duplicados, página final parcial, anterior/próxima, teclado, foco, Voltar/Avançar, reposicionamento após voltar, pesquisa, resultado vazio, filtros, ordenação, restauração após fechar produto, atualizações do catálogo/promoções/configurações e limitação da página quando o catálogo diminui.

As larguras verificadas para igualdade dos cards, quadros quadrados e ausência de overflow são: **280, 320, 360, 375, 390, 412, 430, 480, 600, 768, 820, 1024, 1280, 1366, 1440, 1600, 1920 e 2560 px**. No Gourmet, o enquadramento usa `cover`; artes de garrafas/embalagens seguem com `contain`. Isso foi verificado no CSS computado.

## Preservação

**476 arquivos originais de backend, dados, backups e assets comerciais foram conferidos por SHA-256 e permaneceram idênticos.** O `package-lock.json` também permaneceu idêntico. Não foram alterados preços, estoques, imagens, disponibilidade comercial, embalagens, credenciais ou transportadoras. As alterações de `package.json` acrescentam comandos de teste, sem adicionar dependências.

## Ocorrências durante a verificação

O primeiro ensaio de interface foi interrompido por um seletor de teste ambíguo (o número 4 e Próxima apontavam ambos para a página 4). O seletor foi corrigido para usar o rótulo acessível. Outro ensaio detectou escala de hover durante a medição; o cursor passou a ser movido para fora dos cards antes de medir, mantendo o efeito visual da loja.

Foi também reproduzida uma disputa real de rolagem entre o navegador e a aplicação ao voltar uma página. A aplicação passou a controlar `history.scrollRestoration`, e a medição de posição voltou a passar. O ensaio geral em 18 larguras foi interrompido pelo limite do executor após percorrê-las, antes de emitir seu resultado global; não é contado como aprovado. A repetição completa desse ensaio em 320/768/1440 px passou. Separadamente, o novo ensaio de paginação concluiu as 18 larguras e as 56 verificações.

## Repetir

```sh
npm run test:pagination
npm run test:dependency-free
npm run test:browser:pagination
npm run test:browser:visibility
npm run build:offline
npm run test:production:http
```

Com as dependências instaladas, execute **npm run verify** antes da apresentação. Este build offline não substitui essa etapa. Firefox, Safari/WebKit, aparelhos físicos, zoom nativo, APIs reais, e a operação do banco de produção não foram homologados nesta revisão.

O comprovante externo `RETESTE-PAGINACAO-R1.txt` identifica o ZIP final e os resultados obtidos depois de descompactá-lo. O manifesto interno verifica os bytes da entrega antes de alterações operacionais posteriores.
