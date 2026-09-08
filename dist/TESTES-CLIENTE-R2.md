# INTEGRALL — testes da revisão R2 para apresentação ao cliente

**Data:** 6 de setembro de 2026. **Base:** entrega auditada anterior, versão interna 11.1.8. **Critério:** APROVADO vale somente para o escopo descrito; REPROVADO e NÃO EXECUTADO não se convertem em aprovação por testes de outro tipo.

## Ambiente

Linux, Node 22.16.0, npm 10.9.2, Python 3.13, Playwright Python, Chromium 144.0.7559.96 e Pillow. Sem instalação bem-sucedida de Express, pg e Mercado Pago. O projeto não usa TypeScript; a verificação sintática não é type-check. Lint e segurança locais são verificadores próprios, não ESLint completo nem pentest.

## Resultados consolidados desta revisão

| Ensaio | Resultado | Escopo e evidência |
|---|---|---|
| Testes offline completos | **APROVADO** | 260 testes, 0 falhas, 0 pulados. `logs/testes-finais.log`. |
| Testes novos de regressão | **APROVADO** | 36 testes em `tests/client-readiness.test.js`; estão incluídos nos 260, não são adicionais à contagem. `logs/final-new-tests.tap`. |
| Loja no navegador | **APROVADO** | 29 casos, incluindo 18 larguras. `loja-regressao/browser-regression.json`. |
| Conta e novos fluxos no navegador | **APROVADO** | 16 casos funcionais e 18 larguras, total 34; arquivos `conta-funcional/resultado.json` e `conta-responsiva/resultado.json`. |
| Administração | **APROVADO no adaptador** | 13 cenários, 63 requisições: UI real, controladores reais por ponte HTTP, cookie jar do executor, dados auxiliares simulados. `admin/results.json`. Não é E2E Express nativo. |
| Produto com imagens reais | **APROVADO** | 18 larguras; ordem do DOM, detalhes abaixo e medidas de overflow. `produtos-reais/results.json`. |
| Validador de imagens | **APROVADO para os arquivos examinados** | 304 arquivos operacionais + 5 fixtures de teste, 0 rejeições inesperadas. `midias/compatibilidade.json`. |
| Decodificação independente | **APROVADO** | Pillow decodificou todos os quadros de 223 conteúdos sanitizados únicos, sem falha. `midias/decodificacao.json`. Não é decodificador adicionado ao servidor. |
| Integridade de dados e assets | **APROVADO** | 445 arquivos protegidos idênticos à entrada por SHA-256. 227 produtos e 52 variações preservados. `integridade-dados.json`. |
| Instalação limpa npm | **REPROVADO** | Registro npm indisponível por DNS EAI_AGAIN; tentativa limitada interrompida sem concluir. `logs/clean-install-final.log`. |
| Consulta npm audit | **REPROVADO / consulta indisponível** | Sem acesso ao registro. Não há conclusão de ausência de vulnerabilidades. `logs/npm-audit-final.log`. |
| Build completo | **REPROVADO** | 260 testes passaram; o arquivo de testes HTTP falhou por Express ausente. Processo encerrou com código 1. `logs/build-completo.log`. |
| Build offline R2 | **APROVADO, perfil offline** | 260 testes e geração de dist concluídos; 435 hashes verificados. Não instala nem substitui Express. `logs/build-offline-r2.log`. |
| Pacote estático de produção por HTTP | **APROVADO, pacote estático** | 10 cenários e 435 hashes conferidos; API do servidor de teste responde 503 por definição. Não valida Express nem integrações. `logs/build-offline-r2.log`. |
| Navegação HTTP nativa Chromium | **NÃO EXECUTADO: tentativa bloqueada** | ERR_BLOCKED_BY_ADMINISTRATOR, inclusive loopback. `navegacao-nativa.json`. Não houve remoção da política. |
| Configuração comercial estrita | **REPROVADO** | Identificação fiscal e endereço físico do fornecedor não preenchidos. `logs/readiness-business.log`. Os 222 rascunhos ocultos sem preço não foram publicados artificialmente. |

Todos os caminhos de evidência da tabela são relativos a `docs/revisao-cliente/`. O ZIP contém também documentação histórica de versões anteriores; suas contagens não são revalidações automáticas da R2.

## Reprodução antes/depois

Os primeiros 19 testes de caracterização tiveram **17 falhas e 2 aprovações** antes das correções: `logs/client-readiness-before.tap`. Após as correções iniciais, os mesmos 19 passaram. A etapa de perfil teve 28 testes, sendo **8 falhas e 20 aprovações**, antes de corrigir a função extraída; `logs/client-profile-before.tap`. A suíte expandida final tem 36 aprovações.

A primeira bateria de oito testes de navegador teve **6 falhas e 2 aprovações** na base de entrada (`antes-browser/resultado.json`). Os dois cenários de rotas falharam antes (`rotas-antes/resultado.json`) e passaram depois: produto reabria fora da rota solicitada e atualização silenciosa deslocava a página em 4.615px. O nome/e-mail longo estourou o painel em 280px (`layout-antes/resultado.json`); as 18 larguras finais passaram sem esconder o texto.

Execuções intermediárias estão em `historico-execucoes/` quando existentes. Algumas execuções em primeiro plano foram interrompidas pelo limite da ferramenta: arquivos parciais não foram contados como aprovações completas. As execuções finais acima terminaram e possuem resultados completos. O arquivo `.done.json` correspondente registra o código real de encerramento do processo.

## Conteúdo dos 36 testes novos

Cobrem código de acesso com letras/dígitos excedentes, e-mail longo, sessão/código com expiração inválida, tentativas inválidas, biblioteca local ordenada antes do limite e metadados nulos; erros/status/JSON/204/cancelamento/timeout/FormData da API; perfil com estrutura inválida, CEP ausente/longo, mais de cinco endereços, duplicação de ID, preservação de endereços legados em patch não relacionado e rollback após erro; WebP sem imagem, dimensões excessivas/inconsistentes, fixtures positivas com e sem perda, transparência, animação e remoção de metadados.

Os testes de API executam o módulo real em VM com fetch controlado. Os de autenticação, perfil, repositório e armazenamento local executam seus módulos reais em diretórios temporários. Não usam os dados operacionais como base mutável de teste. Não comprovam todas as rotas, todos os provedores nem comportamento sob carga.

## Navegador e responsividade

Larguras examinadas: **280, 320, 360, 375, 390, 412, 430, 480, 600, 768, 820, 1024, 1280, 1366, 1440, 1600, 1920 e 2560px**. Há capturas selecionadas, não uma promessa de ensaio em dispositivos físicos.

As páginas são carregadas em contexto isolado com HTML, CSS e JS reais. CSP é retirada somente na fixture, não no código publicado; requisições externas são controladas. As imagens dos ensaios de produto usam bytes reais. Os testes adicionais verificam saída com pedidos lentos, 401 e 503, respostas antigas de sessão e perfil, login com fechamento/reabertura, retorno da aba de e-mail, endereço inválido/válido, troca de conta, recompra, foco/nome do diálogo, cancelamento de abertura agendada e preservação da rolagem.

Os sinais entre abas e eventos de foco são exercitados em contexto de teste; não são homologação de armazenamento, cookies e navegação nativos. A suíte administrativa usa adaptador Node HTTP para controladores reais, não o servidor Express. Não substitui o teste ponta a ponta da implantação.

## Testes não executados e risco residual

**Express/HTTPS/cookies nativos/rotas de produção:** bloqueados pelas dependências ausentes e pela política do navegador. Risco: falhas de middleware, cabeçalhos, cookie, redirect ou integração não detectadas. Repetir no ambiente de homologação, com instalação limpa, servidor real e navegador normal.

**PostgreSQL, SMTP, pagamentos e transportadoras reais:** sem ambiente/credenciais de homologação; nenhuma cobrança nem envio real foi realizado. Risco: divergências de configuração, persistência e fluxos externos. Usar base temporária e credenciais sandbox, confirmar retornos, webhook, idempotência e falhas antes de produção.

**Firefox, WebKit/Safari, Chrome/Edge independentes, dispositivos físicos, zoom nativo, leitor de tela e teclado virtual:** não executados. Chromium isolado não certifica compatibilidade universal ou WCAG. Repetir a matriz essencial com os equipamentos da apresentação.

**Falha de disco injetada, carga, Web Vitals e vazamentos prolongados:** não executados. A limpeza de temporários e o middleware no-store receberam revisão, não uma alegação de homologação desses cenários. O validador WebP estrutural não garante a decodificação integral de qualquer upload futuro.

## Comandos de reprodução

```sh
npm ci
npm run check
npm run lint
npm run security:scan
npm run audit
npm run test:client
npm run test:offline
npm run build
npm run build:offline
npm run release:verify
npm run test:production:http
node scripts/client-media-audit.mjs
python3 scripts/client-browser-regression.py --root . --out resultados-conta
python3 scripts/browser-regression.py --root . --out resultados-loja
python3 scripts/audit-admin-browser.py --root . --out resultados-admin
python3 scripts/audit-real-layout.py --root . --out resultados-produtos
```

Python/Playwright/Pillow e Chromium são ferramentas dos ensaios; não foram adicionados como dependências da aplicação. `npm run build:offline` é uma alternativa de diagnóstico, não aprovação do comando completo que falhou.

## Reteste do ZIP entregue

O comprovante externo `RETESTE-ZIP-CLIENTE-R2.txt` registra a validação efetivamente executada após empacotar e extrair a entrega, com SHA-256, comandos, códigos de saída e escopos. Não confundir os resultados da pasta de trabalho com esse reteste. O hash do próprio ZIP não é colocado dentro dele, evitando autorreferência impossível.
