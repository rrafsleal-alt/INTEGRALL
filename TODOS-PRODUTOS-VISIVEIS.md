# INTEGRALL — Todos os produtos visíveis

Revisão **VISIBILIDADE-R1**, de 07/09/2026. Base: entrega HTTP-R1 com Correios; versão interna **11.1.8** preservada.

Este documento substitui, apenas quanto à visibilidade do catálogo, os relatórios históricos que descrevem cinco produtos públicos e 222 ocultos. As demais instruções de segurança, frete, autenticação e produção continuam válidas.

## Resultado no arquivo entregue

O catálogo contém **227 produtos**, todos públicos e **nenhum marcado como oculto**. Foram desocultados 222 cadastros no catálogo principal e na cópia local entregue. As 52 variações também estão presentes na interface, inclusive as 48 que ainda não têm preço.

Atualização PAGINACAO-R1: a vitrine mantém todos os produtos disponíveis, agora distribuídos em páginas numeradas de 12 itens, conforme a opção B solicitada. Não há botão “Ver mais”. Leia PAGINACAO-E-CARDS.md para os ajustes de apresentação. As categorias e filtros continuam funcionando: filtrar intencionalmente por categoria, disponibilidade ou faixa de preço não elimina cadastros. As imagens continuam com carregamento progressivo (`loading="lazy"`) para não baixar todas antecipadamente.

Os 222 produtos sem preço aparecem com **“Preço sob consulta”**, em vez de “R$ 0,00”. Eles podem ser encontrados na busca e abertos para visualizar fotos, descrição e variações. A compra online desses itens permanece desabilitada. Os cinco produtos que já tinham preço mantêm seus valores, estoques e regras comerciais originais.

**Mostrar não é liberar a venda sem preço.** Não foram inventados preços, estoques, medidas ou embalagens. Para vender um item sob consulta, preencha os preços reais do produto e de suas variações e ative sua disponibilidade no administrador. Complete também as embalagens reais quando desejar cotação automática dos Correios.

A proteção que impede mostrar produtos excluídos logicamente continua funcionando. Não há produtos excluídos no catálogo-base desta entrega. Não foram alterados os estados “hidden” de janelas, formulários, autenticação ou componentes técnicos da interface. O administrador continua podendo ocultar um produto posteriormente por decisão explícita; não há rotina que desfaça edições futuras automaticamente.

## Usar esta cópia como instalação nova

Extraia o ZIP em uma **pasta nova**, separada da instalação existente. O catálogo entregue já está visível. Instale as dependências e configure o ambiente conforme README.md e CONFIGURAR-CORREIOS.md. Não use uma cópia offline do HTML para operar vendas.

Nenhuma credencial privada foi adicionada. A autenticação, a integração Correios e as correções financeiras HTTP-R1 foram preservadas.

## Preservar uma instalação que já tem configurações, pedidos e alterações

**Não sobrescreva seu estado operacional com os arquivos de demonstração do ZIP.** Faça backup completo da instalação atual antes de qualquer atualização.

1. Pare o servidor. Extraia a entrega em outra pasta e transfira para ela suas configurações privadas e todo o diretório de dados operacional que já utiliza. Na configuração local padrão, isso inclui o diretório `data/local-state` inteiro, não apenas `catalog.json`. Preserve também uploads que estejam em outro diretório configurado.
2. Mantenha o catálogo-base `data/catalog.json` desta nova entrega. O estado operacional preservado tem prioridade sobre ele. Se utiliza `LOCAL_DATA_DIR`, confirme que a nova instalação aponta para o diretório correto, sem executar as duas versões simultaneamente. Se utiliza PostgreSQL, preserve a configuração do banco existente e faça backup do banco antes da atualização.
3. Abra o terminal na pasta que contém o novo `package.json`. Com o servidor ainda parado, execute:

```sh
npm run catalog:show-all -- --apply --server-stopped
```

O comando usa a configuração privada da instalação e o repositório operacional, não substitui pedidos pelo catálogo-base. Faz backup antes da alteração, desoculta os produtos não excluídos e preserva preços, estoque e histórico. Em cadastros antigos que estejam marcados para venda mas sem preço válido, mantém a exibição e pausa a compra para evitar oferta gratuita. A resposta mostra as contagens e o caminho do backup.

`--server-stopped` é a confirmação de que você parou a aplicação; não é uma detecção automática de processos. Não execute com o servidor ativo.

4. Gere e valide a nova instalação, com as dependências instaladas:

```sh
npm run test:http
npm run verify
```

5. Reinicie a aplicação e atualize a página sem usar os arquivos estáticos de um build antigo. Os recursos públicos desta revisão têm a chave de cache `rev=visibilidade-r1`.

Em uma instalação já modificada por você, o número de produtos pode ser diferente de 227. O comando atua sobre o seu catálogo atual e não recupera itens excluídos.

## O que foi testado nesta revisão

- **336 testes automatizados locais aprovados**, incluindo 14 novos testes de visibilidade e preservação de estado. Nenhuma falha ou teste pulado nessa suíte.
- **16 verificações no Chromium 144** com HTML, CSS, JavaScript e imagens reais do pacote: todos os cards; abertura dos 227 produtos; 52 variações; busca; categorias; filtros; proteção contra compra sem preço; produto já vendável; larguras de 320, 768 e 1440 px.
- Suíte adicional de regressão da loja aprovada nas mesmas três larguras.
- Catálogo público, catálogo local e catálogo embutido comparados. Primeiro início e reinício do repositório local mantêm os 227 produtos públicos.
- Build offline aprovado, com 447 hashes de arquivos verificados; teste HTTP estático com 10 cenários aprovado.
- Comparação com HTTP-R1: 443 dos 445 arquivos de dados, mídias e backups estão idênticos. Os dois catálogos alterados só tiveram 222 marcações `hidden` modificadas de `true` para `false` em cada cópia. O arquivo de dependências, o servidor e os módulos de Correios, pagamento, autenticação e repositório permanecem idênticos.
- Atualização do estado operacional testada com dados temporários: backup exato, preservação de pedido/conta, reaplicação e recusa sem confirmação de parada.

Os testes de navegador são executados em página isolada `about:blank`, com recursos reais inseridos pelo executor. Não representam navegação HTTP nativa, CSP, cookies ou HTTPS do servidor publicado. Não foram utilizados tokens reais de transportadora.

## Limitações

A tentativa de instalação limpa falhou neste ambiente com erro interno do npm (“Exit handler never called!”); a dependência Express não ficou disponível. Por isso, a suíte HTTP com Express e o build completo não são declarados aprovados. O build incluído é o perfil **offline** e não substitui a validação completa na máquina/servidor de destino.

A suíte adicional de interface dos Correios não concluiu dentro do limite da execução desta revisão. Os testes automatizados locais de frete e de proteção financeira estão incluídos nos 336 aprovados, mas não houve nova homologação de transportadoras ou pagamentos reais.

O comando de desocultação foi testado com repositório local em Linux. O caminho PostgreSQL e a execução nativa no Windows não foram homologados nesta revisão. Não há alegação de funcionamento completo de produção baseada apenas em simulação.

## Arquivos principais alterados

- `data/catalog.json` e `data/local-state/catalog.json`: somente as 222 marcações de ocultação em cada arquivo.
- `public/js/store/catalog.js`: exibição completa, variações com preço pendente, rótulos de consulta e proteções de compra.
- `public/js/store/commerce-v111.js` e `premium-v104.js`: rótulos de preço consistentes.
- `public/index.html` e chave de cache dos demais HTML públicos: catálogo embutido completo e ausência de paginação restritiva.
- `src/catalog-visibility.js` e `scripts/show-all-products.mjs`: atualização explícita e protegida do catálogo operacional.
- `scripts/sync-embedded-catalog.mjs`, auditoria e build: inclusão de todos os produtos visíveis, mesmo indisponíveis para compra.
- Testes existentes adaptados à mudança solicitada e novos testes de regressão. Nenhuma validação de preços ou estoque no backend foi removida.

Consulte `docs/evidencias-visibilidade` para os resultados e a conferência de integridade. Os demais relatórios do pacote permanecem como histórico das revisões anteriores.
