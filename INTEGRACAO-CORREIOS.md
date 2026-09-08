# Integração Correios — relatório técnico

Base: projeto entregue pelo usuário, versão interna 11.1.8. Esta revisão implementa cotação automática de preço e prazo PAC/SEDEX, cadastramento de embalagens, seleção na sacola e confirmação no servidor. Não é uma emissão de etiquetas ou uma contratação de postagem.

## Diagnóstico da base recebida

Havia um serviço parcial de Correios e uma estrutura preliminar de cotações. A autenticação exigia cartão de postagem, mesmo no fluxo de contrato utilizado pelo usuário. O empacotamento aceitava estimativas de itens soltos. A lógica de fechamento podia escolher outra opção, mais barata, quando o serviço solicitado não estivesse disponível, ou seguir para frete manual silenciosamente. A prévia no navegador não tinha uma confirmação assinada, nem invalidação completa de respostas antigas. As caixas já existiam no schema do catálogo, mas não eram editáveis/persistíveis pelo formulário administrativo completo.

## Implementação

`src/correios.js` autentica por contrato ou cartão, usando o código de acesso somente no servidor. Mantém token em memória, compartilha autenticação concorrente, observa a expiração e tenta renovação uma vez após 401. Uma base de homologação é reconhecida mesmo que a flag de homologação tenha sido configurada incorretamente; tarifas desse ambiente são bloqueadas em NODE_ENV=production. Os hosts são restritos aos Correios em HTTPS; redirecionamentos não recebem credenciais. A exceção de loopback é exclusiva dos testes. Respostas de erro externas não são copiadas com tokens/cURL para os clientes ou logs.

O padrão usa GET `/preco/v1/nacional/{coProduto}` e GET `/prazo/v1/nacional/{coProduto}`, conforme as consultas que o usuário realizou. O modo POST legado continua coberto por testes. A versão de endpoint não é inferida do título “v3” do catálogo CWS. Os serviços são configuráveis; os padrões são PAC 03298 e SEDEX 03220.

Os preços são convertidos rigorosamente em centavos. `pcFinal` é obrigatório e positivo; não há fallback para preço-base ou conversão de falha em zero. Exige-se prazo válido além do preço. A disponibilidade pode ser parcial: um serviço inválido não elimina outro serviço válido. Todos os volumes de um serviço precisam ter sido cotados. Informações de prazo, entrega domiciliar, fins de semana e número de volumes são mantidas.

Há limite de tamanho de resposta, timeout por chamada, orçamento de tempo para cotação, concorrência limitada, pausa curta após 429/5xx, cache com limite de entradas e compartilhamento de prévias simultâneas. O fechamento solicita nova consulta sem utilizar o cache de preço da prévia. A autenticação ainda pode reutilizar o token válido; isso não equivale a reutilizar uma cotação antiga.

`src/shipping-packages.js` valida CEP e caixas reais, agrega linhas do mesmo produto/variação, combina quantidades exatas com programação dinâmica e limita volumes. Não mistura produtos ou variantes distintos. Caixas específicas da variação prevalecem sobre genéricas para a mesma capacidade. Sem dados suficientes, a cotação automática é recusada com mensagem de orientação. Valores inválidos não são reduzidos silenciosamente na normalização.

`src/shipping-receipt.js` assina uma prévia de cinco minutos com HMAC-SHA256. Ela vincula CEP, itens/variações/quantidades, embalagem, subtotal servidor, origem, política de serviços/gratuidade, serviço escolhido e condições apresentadas. O recibo é legível e não criptografado: contém hashes e dados da cotação, **não credenciais dos Correios nem dados pessoais**. Compartilha o segredo entre instâncias; reinício/rotação de segredo pode invalidar prévias, que devem ser refeitas.

`src/shipping-checkout.js` centraliza a mesma validação para prévia e fechamento. Reconsulta o serviço selecionado; mudança de preço, prazo, entrega domiciliar ou volumes exige nova confirmação. Nunca substitui silenciosamente a opção. O corpo enviado pelo navegador tem `resolved` descartado antes de `buildOrder`; preços e caixas são recuperados do catálogo servidor, não do cliente. Os dados confirmados ficam gravados no pedido.

`manualQuote:true` registra explicitamente pedido com frete pendente. No modo Correios, a rota de pagamento bloqueia esse pedido mesmo que uma configuração legada permita pagamentos com frete a confirmar em outros modos. Retirada e políticas prévias de outras modalidades foram preservadas.

`public/js/store/checkout.js` inclui opções antes do resumo financeiro, muda o total pela seleção, cancela/ignora respostas antigas, invalida em mudanças do pedido e expiração e apresenta reconsulta ou frete a confirmar em caso de falha. A mensagem do resumo não continua dizendo “valor e prazo serão confirmados no atendimento” quando já há cotação selecionada. O prazo de transporte é distinguido do preparo da loja. O modo informado pelo catálogo mantém a cotação disponível quando o endpoint de saúde falha. A resposta da cotação também sinaliza homologação, independentemente do health.

O administrador edita caixas por produto/variação, com peso bruto e medidas externas. PATCH, criação e importação de produtos são validados no backend. A idempotência inclui a escolha do serviço e ignora apenas a renovação do recibo, evitando pedido duplicado por troca de um recibo expirado. A projeção pública do pedido não divulga custo interno, endereço de origem nem planejamento de caixas.

## Integrações e dados existentes

Nenhuma dependência nova foi adicionada e o lockfile foi mantido. Nenhum preço de venda, estoque, produto, variação, caixa existente, imagem ou vídeo foi alterado para simular funcionamento. A autenticação administrativa e a identidade visual foram preservadas.

Jadlog e a regra preexistente de divisão de transportadoras continuam no projeto. Sua reserva pode oferecer alternativas na prévia; não pode trocar a opção durante o fechamento sem nova escolha. Nenhuma chamada à Jadlog foi homologada ao vivo. O rastreamento existente continua separado da cotação.

O catálogo recebido tem 227 produtos, 52 variações e cinco produtos vendáveis. Três produtos possuem caixas de 6/12 unidades. É preciso cadastrar caixas para quantidades menores e produtos restantes: a integração não pode determinar peso bruto e medidas reais por conta própria. Veja a tabela do guia de ativação.

## Testes e escopo da evidência

Os 260 testes sem dependências da base passaram antes das mudanças. Foram acrescentados 41 testes para autenticação, token, GET, tratamento de erros, dinheiro, cache, volumes, caixas, CEP, recibos, revalidação, gratuidade legítima, pedido manual, projeção pública, idempotência e transporte HTTP local. A suíte sem dependências passou com 301 testes, sem skip. Os testes legados de empacotamento foram atualizados para a regra explícita de caixas registradas; não foram simplesmente removidos. Os testes de POST legados continuam ativos.

Dois testes usam fetch nativo contra um servidor Node HTTP local, incluindo timeout real. O provedor local é simulado e não usa credencial ou contrato real.

O teste de interface dedicado passou com 25 cenários e cobre oito larguras, de 280 a 1920 px, seleção de SEDEX, recálculo por quantidade, retirada, resposta antiga, falha/retentativa, expiração e fechamento com reconsulta. Usa HTML/CSS/JS da loja, ponte para módulos reais de backend e repositório isolado, com Correios simulado. O teste administrativo salva/reabre caixas com API simulada em quatro larguras. A regressão administrativa com controladores reais por ponte passou 13 cenários e 63 requisições. A regressão da loja passou 29 cenários, incluindo 18 larguras. Os arquivos de resultados registram o escopo de cada evidência.

A configuração dos testes HTTP Express foi corrigida para desativar explicitamente o login administrativo padrão quando o teste exige senha personalizada. Isso ajusta a fixture, não enfraquece a autenticação da aplicação.

**Limitações:** o ambiente não resolveu o host do registro npm; a instalação limpa não concluiu. Express/pg/mercadopago não ficaram disponíveis. O navegador gerenciado bloqueou navegação HTTP nativa com `ERR_BLOCKED_BY_ADMINISTRATOR`. Portanto os testes de UI usam páginas isoladas e ponte de teste, não são validação do servidor Express, dos cookies nativos ou de TLS. Não foram homologados API externa Correios, PostgreSQL de produção, pagamentos, SMTP, dispositivos físicos ou Safari/Firefox. O build offline é identificado como tal; a validação completa de produção permanece necessária.

Os JSONs manuais que o usuário enviou demonstram respostas do contrato naquele momento e foram usados como **fixtures**. A automação não reproduziu essas chamadas na conta real. Valores e datas não foram fixados na loja.

A matriz final, logs e reteste do ZIP estão em `TESTES-CORREIOS.md` e na evidência fornecida com a entrega. Documentos anteriores de auditoria permanecem como histórico e não significam reexecução de todos os seus cenários nesta revisão.

## Operação segura

Cadastre as credenciais no ambiente privado. O código de acesso não é a senha principal do portal; tokens são temporários. Não imprima cabeçalhos Authorization em evidências. Um token novo não garante revogação imediata do anterior: confirme invalidação/expiração com CWS/suporte. A entrega não usou o token exposto e não precisa que senhas sejam enviadas por chat.

Configure origem, caixas e promoções reais. O valor declarado adicional fica desligado por padrão para reproduzir a chamada sem adicionais. Habilitação, códigos adicionais e cobertura devem ser confirmados no contrato antes de ligar esse modo. No modo simulado dos testes nenhum resultado tem valor comercial.

A cotação não constitui contratação de postagem, reserva de prazo ou etiqueta. O cálculo de múltiplos volumes soma tarifas separadas, não aplica supostos descontos por consolidação física. Pré-postagem/rótulos ficam para etapa própria, com requisitos e testes próprios.

## Referências oficiais consultadas

- Correios — Manual Uso da API Token: https://www.correios.com.br/atendimento/developers/manuais/manual-uso-da-api-token
- Correios — Manual API Preço: https://www.correios.com.br/atendimento/developers/manuais/manual-api-preco-1
- Correios — Manual API Prazo: https://www.correios.com.br/atendimento/developers/manuais/manual-api-prazo
- Catálogo contratual: https://cws.correios.com.br/

A documentação oficial fundamenta autenticação, endpoints e campos. Limites conservadores de empacotamento, recibo HMAC, política de erro, cache e UX são decisões desta implementação, não requisitos atribuídos aos Correios.
