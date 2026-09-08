# INTEGRALL — correção HTTP-R1

Data: 07/09/2026. Versão interna preservada: 11.1.8.
Base: última entrega com a integração Correios Preço/Prazo, não a versão anterior sem essa integração.

## Problema recebido

O log do usuário executou o perfil completo (`npm run verify` → `npm run build`) e registrou 316 testes: 309 aprovados e 7 reprovados em `tests/http.test.js`. Sintaxe, lint, auditoria e mídia chegaram a passar naquele log. Os avisos de `console.log` e de TLS não eram as sete asserções que interromperam o build.

O log é uma execução na máquina do usuário. Os resultados deste pacote são discriminados em `TESTES-HTTP-R1.md`; não se confunde a execução do usuário com a validação realizada nesta revisão.

## Diagnóstico e correção por falha

| Falha do log | Causa confirmada na fonte | Alteração |
| --- | --- | --- |
| Fluxo de pedido: estoque 45 em vez de 46 | O teste criava o pedido principal de duas unidades e outro pedido de uma unidade, usado para provar que o navegador não altera o preço. As três unidades estavam reservadas, mas a expectativa considerava só duas. | Verifica a reserva imediatamente, mantém a validação de preço adulterado, cancela o segundo pedido e prova restituição/idempotência antes de confirmar o primeiro pagamento. O algoritmo de estoque não foi relaxado. |
| Salvar cupons: 409 em vez de 200 | O PUT não enviava `revision`, exigida pelo controle de concorrência por seção. | Lê a revisão na rota administrativa e a envia. Também testa 409 para revisão ausente e antiga e confirma que não houve sobrescrita. |
| Cupom de frete: `discountCents` de undefined | A gravação de cupom anterior retornava 409 e o teste prosseguia sem conferir o resultado; a criação de pedido falhava e não existia `order`. | Corrige a revisão e verifica o status de cada etapa antes de acessar o pedido. Continua exigindo desconto e total exatos após a cotação manual. |
| Preço de produto: 409 em vez de 400 | O PATCH não enviava `expectedRevision`; o conflito vinha antes da validação do preço. | Obtém `_revision` no catálogo administrativo. Preço inválido com revisão válida continua exigindo 400; ausência/revisão antiga continua exigindo 409; ID inexistente continua exigindo 404. |
| Frete durante pagamento: 200 em vez de 409 | O teste só mudava o status para `awaiting_payment`; não criava uma preferência, apesar do nome antigo. A rota bloqueava preferência conhecida, mas não esse estado nem a janela de criação do checkout. | Corrige a rota e descreve o teste com precisão. A validação financeira ocorre dentro do lock do pedido e cobre pagamento em andamento/análise, tentativa no provedor e resultado incerto após timeout. |
| Excluir novamente: 200 em vez de 404 | O backend usa exclusão lógica idempotente. Preserva o registro para liberar reservas de pedidos já existentes. | Mantém esse contrato. O teste prova ausência nas listagens, preservação da âncora de estoque, 200 na repetição e 404 para ID realmente inexistente. Não troca exclusão lógica por exclusão física. |
| Personalização: 409 em vez de 200 | Os PUTs de configurações não enviavam a revisão da seção, inclusive no salvamento posterior e na restauração. | Envia a revisão mais recente em cada escrita, testa conflitos e mantém a verificação do reflexo no catálogo público. |

## Proteção financeira acrescentada

`assertShippingEditable` em `src/order-financials.js` é chamada dentro de `repo.updateOrder` na rota de cotação administrativa, imediatamente antes do recálculo. A operação é recusada quando:

- o pedido aguarda pagamento ou está em análise;
- já há preferência, claim de checkout ou tentativa pendente/registrada;
- a reserva já foi liberada, o estoque já foi comprometido ou o estado foi encerrado;
- o pedido é de retirada, e não de entrega.

O status `received` ou `payment_failed`, sem tentativa e sem reserva encerrada, continua permitindo ajuste. Uma falha de rede na criação do checkout não prova que o provedor deixou de criar a preferência. Por isso o total permanece protegido mesmo após limpar o claim quando existe uma tentativa pendente; o retry preserva seu total. Não remova marcadores de pagamento manualmente. Se o valor precisar mudar após uma tentativa, reconcilie o pagamento no fluxo operacional e crie outro pedido.

Foram comparados os callbacks literais da rota anterior e da corrigida, usando repositório real em diretório temporário. Em quatro cenários inseguros o original alterava o total sintético de 2.500 para 10.999 centavos; o corrigido retornou 409 e preservou 2.500. Quando já existia preferência, ambos bloquearam corretamente. Esse ensaio é de handler; não é um teste do Express nem do Mercado Pago real.

## Isolamento da suíte HTTP

Cada caso da suíte Express agora cria seu próprio processo de servidor e diretório temporário. O filho herda apenas variáveis operacionais do sistema, sem credenciais, `NODE_OPTIONS`, banco de dados, SMTP, transportadoras ou configuração de frete do ambiente principal. Os testes encerram o processo e removem apenas o diretório temporário que criaram.

A suíte continua importando Express obrigatoriamente. Não foram introduzidos `skip`, modo de aprovação automática ou desvio de `npm run verify` para o build offline.

## Como atualizar a cópia que já está configurada

Use o pacote pequeno de correção HTTP-R1 quando sua base for a entrega anterior com Correios. Ele contém só arquivos de código, testes, scripts e documentação; não contém nem substitui dados, imagens, credenciais ou dependências instaladas.

1. Pare o servidor local e faça backup da pasta do projeto, inclusive do estado local e das configurações privadas.
2. Extraia o pacote pequeno em uma pasta separada. No Windows, abra `APLICAR-CORRECAO.cmd` e informe a pasta do projeto que contém `package.json` e `server.js` (por exemplo, a pasta interna `INTEGRALL-v11.1.8`).
3. O aplicador confere os hashes esperados antes de escrever. Se detectar edição local em um arquivo que precisa corrigir, interrompe sem sobrescrever essa edição. Não force a aplicação nem restaure o catálogo para contornar o aviso.
4. Os arquivos de código substituídos são preservados em um backup dentro do projeto. O aplicador não executa instalação, não inicia servidor e não faz chamadas aos Correios ou a pagamentos.
5. No terminal da pasta do projeto, execute `npm run test:http` e, depois, `npm run verify`. Não use `build:offline` para considerar resolvida uma falha da suíte HTTP.
6. Se os dois comandos concluírem sem falhas, inicie sua configuração local com `npm run start:local`. Não sirva uma pasta `dist` antiga antes de um novo build completo bem-sucedido.

As dependências não mudaram; não há necessidade de reinstalar somente por causa deste patch. Para uma cópia nova do ZIP completo, use `npm ci` antes dos testes. O log anterior do usuário já mostra que Express estava disponível naquela execução.

Os manifestos de uma entrega descrevem os bytes daquele pacote. Um novo build altera os arquivos gerados. A revisão deve ser validada pelos testes, pelo manifesto do patch e pelo backup, e não pela restauração de dados antigos para tentar fazer um hash coincidir.

## Preservação e limites

O catálogo, preços, estoques, mídias, identidade visual e configuração Correios da entrega foram preservados. Nenhum token compartilhado na conversa foi usado ou incluído. `package-lock.json` e as versões das dependências não mudaram.

Esta revisão não acrescenta pré-postagem, etiquetas nem altera o cálculo de preço/prazo dos Correios. O foco é o build relatado e a integridade financeira da cotação administrativa. As condições de ativação de credenciais e embalagens reais continuam descritas em `CONFIGURAR-CORREIOS.md`.

Consulte `TESTES-HTTP-R1.md` para os testes realmente executados e as limitações. Os relatórios antigos permanecem como histórico; suas contagens não são o resultado desta revisão.
