# Ativar os Correios no INTEGRALL

**Entrega: integração de cotação PAC/SEDEX — base interna 11.1.8.**

O código já está ligado à sacola e ao fechamento do pedido. A ativação depende de duas configurações da sua operação: credenciais privadas no servidor e embalagens reais cadastradas. Nenhum token enviado na conversa foi colocado no projeto. Os valores de R$ 23,17 e R$ 26,46 não são tarifas fixadas na loja.

## 1. Guardar o projeto e configurar o servidor

Descompacte em uma nova pasta e preserve o projeto anterior. Não substitua o banco, o diretório de estado local ou as mídias de uma loja já publicada pelo catálogo de exemplo do pacote.

Na pasta que contém `package.json`, use Node.js compatível com `engines` (o ambiente de teste desta entrega utilizou Node 22.16.0). Execute `npm ci`. A instalação exige acesso ao registro npm.

Para execução **local**, copie `.env.example` para um arquivo chamado `.env`, na mesma pasta de `server.js`. No Windows, confirme que o editor não acrescentou `.txt`. Edite esse arquivo somente no seu computador/servidor; não o envie por chat, não o coloque no Git e não o inclua em ZIPs de entrega.

Configure estes campos:

```dotenv
SHIPPING_MODE=correios
CORREIOS_AUTH_TYPE=contrato
CORREIOS_USER=
CORREIOS_ACCESS_CODE=
CORREIOS_CONTRACT=
CORREIOS_POSTAGE_CARD=
CORREIOS_DR=
CORREIOS_ORIGIN_CEP=07074000
CORREIOS_SERVICES=03298:PAC,03220:SEDEX
CORREIOS_API_VERSION=v1
CORREIOS_QUOTE_METHOD=GET
CORREIOS_HOMOLOG=false
CORREIOS_DECLARED_VALUE=false
ALLOW_PAYMENT_WITH_QUOTED_SHIPPING=false
FREE_SHIPPING_CENTS=
SHIPPING_QUOTE_SECRET=
```

Preencha `CORREIOS_USER` com o usuário usado no Meu Correios, `CORREIOS_ACCESS_CODE` com o **código de acesso às APIs** e `CORREIOS_CONTRACT` com o número do contrato. Não coloque a senha principal do portal nem um Bearer token nesses campos.

No modo `contrato`, o cartão não é obrigatório. `CORREIOS_DR` é opcional: só preencha se necessário para o seu contrato. O modo alternativo `cartaopostagem` exige cartão; `auto` prioriza contrato quando preenchido. Não use os números fictícios dos testes.

O CEP `07074000` foi o que você utilizou no teste manual. **Confirme que é o local real de postagem.** Altere-o se os pedidos saírem de outro endereço.

`CORREIOS_API_VERSION=v1` corresponde aos endpoints que você consultou. O nome “Preço v3”/“Prazo v3” no catálogo CWS não significa, por si só, trocar o caminho da requisição para `/v3/nacional`.

O código obtém o token no backend e o renova perto da expiração. Não existe campo para deixar um Bearer fixo na loja. Gerar outro token **não é prova de revogação imediata** do token anterior: para o token compartilhado anteriormente, confirme a invalidação/expiração no CWS ou com o suporte dos Correios. Não regenere o código de acesso sem avaliar outras integrações que o utilizam.

### Segredos da aplicação

Use um `ADMIN_SESSION_SECRET` aleatório, exclusivo e persistente. `SHIPPING_QUOTE_SECRET` vazio herda esse segredo; também pode receber um segredo próprio com pelo menos 32 caracteres. Este é um segredo **da loja**, usado para assinar a prévia de frete; não é credencial dos Correios. Mantenha o mesmo valor em todas as instâncias do backend. Trocar esse segredo invalida as prévias existentes.

Um segredo pode ser gerado localmente com:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Não publique a saída. Em produção, mantenha também as proteções administrativas, PostgreSQL, HTTPS, `ADMIN_DEFAULT_LOGIN_ENABLED=false`, hash administrativo e demais segredos exigidos pelo projeto. A integração não desativa essas verificações.

### Executar

```sh
npm run correios:check:local
npm run start:local
```

O primeiro comando verifica a configuração e o catálogo de arquivo **sem consultar APIs nem imprimir credenciais**. O segundo carrega o arquivo de ambiente e inicia o servidor. `npm start` continua indicado para hospedagens que já injetam as variáveis no processo; ele não carrega automaticamente o arquivo local.

Em hospedagem como Render, preencha as variáveis no painel de ambiente e reinicie/republique o serviço. Os blueprints preservam os serviços existentes e incluem as novas opções. Não coloque credenciais no frontend nem em campos públicos do administrador. O blueprint de teste mantém o sandbox do pagamento separado dos Correios: ambos os blueprints publicados usam cotações de produção. Para homologação dos Correios, use um ambiente local isolado com as credenciais próprias de homologação e CORREIOS_HOMOLOG=true. A aplicação bloqueia essa combinação em NODE_ENV=production para não publicar tarifas de teste.

## 2. Cadastrar embalagens de envio reais

Abra o administrador, vá à lista **Produtos** e edite o produto. Abra **Embalagens de envio** e clique em **Adicionar embalagem**. Informe a variação aplicável, quantas unidades efetivamente estão dentro da caixa, peso bruto do pacote fechado em gramas e três medidas externas em centímetros. Salve o produto.

**Peso bruto inclui produto, garrafa/recipiente, caixa e proteção.** Não use o volume do líquido como peso. “Todas” só deve ser usado quando aquela caixa e aquele peso se aplicam de fato a todas as variações.

Para cadastrar embalagem de uma variação nova, salve primeiro a variação e reabra o produto, depois selecione-a na embalagem. É possível editar, remover e salvar até dez configurações por produto. A interface e o backend validam os campos; um pacote excedente não é convertido silenciosamente em um pacote menor.

### O que falta no catálogo recebido

Foram comparados por SHA-256 445 arquivos de dados, assets e backups: todos permanecem idênticos. O lockfile também foi preservado. O arquivo contém 227 produtos e 52 variações. Cinco produtos estão vendáveis, e três deles já possuem embalagens cadastradas, principalmente para **6 ou 12 unidades**. Essas caixas foram preservadas. Não há cobertura cadastrada para a quantidade mínima de compra de todas as sete combinações vendáveis de produto/variação:

| Produto/variação | Quantidade mínima no catálogo | Situação para essa quantidade |
|---|---:|---|
| Suco Integral de Uva bordô / 300 ml | 1 | Embalagem a cadastrar |
| Suco Integral de Uva bordô / 1 L | 1 | Embalagem a cadastrar |
| Vinho Tinto Seco / 750 ml | 1 | Embalagem a cadastrar |
| Vinho Tinto Seco / 375 ml | 1 | Embalagem a cadastrar |
| Mentirinha | 2 | Embalagem a cadastrar |
| Vó Damazia | 1 | Embalagem a cadastrar |
| Vinho verde Pescada | 1 | Embalagem a cadastrar |

Não preenchi esses dados com o pacote de 3 kg usado no CWS: ele não foi identificado como a embalagem real de cada um desses produtos.

Cadastre as quantidades que a loja deseja vender. Uma caixa de 12 **não prova** peso e dimensões de uma caixa de 1. Sem uma combinação exata para a quantidade escolhida, a loja oferece a solicitação de frete a confirmar, sem liberar pagamento online com frete indefinido.

### Como os volumes são formados

A integração combina caixas **cadastradas**, com quantidade exata, procurando o menor número de volumes. Por exemplo, duas caixas cadastradas para 4 unidades atendem 8 unidades mesmo que também exista uma caixa para 6. A regra não inventa uma caixa para a sobra.

Produtos diferentes e variações diferentes são separados: não há mistura automática de SKUs em uma caixa maior inventada. A cotação soma cada volume por serviço e só oferece o serviço quando há preço válido para todos os volumes e prazo válido para o destino. Essa estratégia é conservadora; não promete a solução logística de menor tarifa entre todas as possibilidades físicas de acondicionamento.

Limites conservadores desta implementação: até 30 volumes por cotação, até 30 kg por volume, medidas inteiras, pelo menos 16 × 11 × 2 cm, até 100 cm por lado e soma até 200 cm. São limites do software desta entrega, não uma declaração de que todos os contratos/serviços aceitam todas essas combinações. A API ainda pode recusar trechos ou características de envio.

## 3. Fazer o primeiro teste dentro da loja

Após configurar o servidor e cadastrar uma embalagem real, abra a loja por HTTP/HTTPS, selecione o produto/variação e quantidade compatíveis, escolha entrega e informe o CEP. Abra a sacola.

A área **Opções de frete** apresenta PAC e/ou SEDEX conforme disponibilidade. Troque a opção e confira o total. O prazo informado é de transporte após a postagem, não uma promessa de que a preparação interna está incluída. Em destinos sem entrega domiciliar, a interface avisa a possibilidade de retirada.

Altere a quantidade e o CEP para confirmar que a opção anterior é descartada e recalculada. A prévia dura até cinco minutos; ao concluir, o servidor consulta novamente os preços e prazos, valida o serviço selecionado e recalcula o pedido. Se preço ou condições mudarem, é preciso confirmar uma nova cotação. O navegador não decide o valor do frete.

Teste também retirada na loja, falha temporária de cotação e “Solicitar frete a confirmar”. Um erro dos Correios não deve aparecer como frete zero. Pedidos com frete indefinido devem bloquear o pagamento online até o valor ser definido pela loja.

### Promoções e valor declarado

`FREE_SHIPPING_CENTS` vazio preserva as condições e promoções cadastradas. Um valor positivo substitui o limite geral; `0` desativa esse limite geral, mas **não remove cupons ou outras promoções explicitamente cadastradas**. Frete subsidiado pela loja continua dependendo de cotação válida. O custo da transportadora permanece registrado no pedido.

`CORREIOS_DECLARED_VALUE=false` reproduz a chamada manual sem solicitar o adicional de valor declarado. Não é uma avaliação de cobertura/indenização para o conteúdo enviado. Revise com a operação e o contrato antes de vender. O modo `true` usa o subtotal servidor e os códigos adicionais já mapeados no projeto; distribui o valor pelos volumes, deve ser homologado com seu contrato e não foi testado ao vivo nesta entrega.

## Diagnóstico e publicação

`npm run correios:check` lê variáveis já fornecidas pelo ambiente e o catálogo de arquivo. Use `-- --catalog=caminho/do/catalogo.json` para outro arquivo. Ele **não consulta o catálogo de uma instância PostgreSQL publicada**. Não exporte dados pessoais de clientes para essa verificação.

Testes locais de código: `npm run test:correios` ou `npm run test:dependency-free`. Build completo: `npm run build`. Existe `npm run build:offline`, explicitamente sem aprovação da camada Express/HTTP completa; ele não substitui o build completo.

A entrega foi testada com provedor simulado e respostas baseadas nos JSONs enviados por você. **Configuração real do contrato, API externa, PostgreSQL publicado, HTTPS e pagamentos precisam de aceitação no ambiente da apresentação.** Pré-postagem, impressão de etiquetas e contratação de postagem não foram acrescentadas nesta etapa. O recurso de rastreamento que já existia foi preservado, sem homologação externa nova.

Referências técnicas consultadas: manuais oficiais dos Correios de Token, Preço e Prazo; referências completas em `INTEGRACAO-CORREIOS.md`.
