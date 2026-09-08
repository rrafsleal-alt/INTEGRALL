# INTEGRALL — segunda auditoria, preparação para apresentação ao cliente

**Data:** 6 de setembro de 2026. **Revisão:** R2 sobre a entrega auditada anterior. **Base preservada:** 11.1.8. O nome externo 11.0.4 do ZIP segue o briefing e não indica retorno a uma versão antiga.

## Resultado executivo

Foram encontradas e corrigidas falhas adicionais de autenticação do cliente, sessão na interface, tratamento de respostas da API, endereços, biblioteca de mídia, validação WebP, navegação de produtos e responsividade da conta. As correções estão no código, não apenas neste relatório. Os testes novos reproduziram defeitos antes da alteração e passaram depois dela.

**Aprovado no escopo local testado; não homologado integralmente para produção.** O ambiente não concluiu a instalação npm por indisponibilidade do registro, e a suíte HTTP completa não consegue importar Express. O Chromium gerenciado também bloqueia a navegação HTTP nativa, inclusive loopback. As interfaces foram verificadas com código/DOM/CSS reais em páginas isoladas. Isso não equivale a validar o servidor Express, cookies nativos, HTTPS ou serviços externos.

O catálogo contém **227 cadastros e 52 variações**, mas **222 cadastros permanecem como rascunhos ocultos sem preço**. O fallback público contém os cinco itens vendáveis existentes. Não foram inventados preços nem publicados produtos sem decisão comercial. Também faltam CPF/CNPJ do fornecedor e endereço físico no cadastro comercial. Esses pontos precisam de preenchimento pelo responsável antes de uma apresentação que prometa operação comercial completa.

## Problemas e correções

| ID | Prioridade | Defeito confirmado e causa | Correção e evidência |
|---|---|---|---|
| CLI-01 | P2 | O servidor retirava caracteres e cortava o código de acesso nos primeiros seis dígitos. Um código conhecido continuava aceito com letras, separadores ou dígitos excedentes. Não foi demonstrado acesso sem conhecer o código. | Exatamente seis dígitos, aceitando apenas espaços externos. Entradas malformadas não consomem o código válido. E-mails acima do limite são recusados em vez de truncados. `client-readiness.test.js`. |
| CLI-02 | P2 | Datas de expiração inválidas resultavam em `NaN`, que não satisfazia a comparação de expiração. Havia o mesmo problema em códigos temporários do repositório local e valores inválidos de tentativas. | Datas finitas, contagem inteira válida, cookie no formato esperado e sessão com identidade/CSRF válidos. Registros de sessão inválidos são removidos. Testes diretos de autenticação e repositório; PostgreSQL real não executado. |
| CLI-03 | P1 | A API descartava `status` e `code` ao criar erros. Assim, o tratamento de logout expirado que dependia de `error.status === 401` não funcionava com o cliente HTTP real. HTML com status 200 virava `{}`, aparentando sucesso. | Erros preservam status/código/requestId. Resposta JSON inválida falha explicitamente. 204 continua aceito. Testes executam o arquivo real da API em VM, não uma reimplementação. |
| CLI-04 | P2 | O cliente HTTP substituía o AbortSignal do chamador; cancelamentos podiam continuar e ser confundidos com timeout. FormData recebia Content-Type de JSON. | Cancelamento antes, durante a requisição e durante leitura do corpo; remoção do listener ao terminar; timeout com código próprio; cabeçalho multipart delegado ao navegador. Testes positivos e negativos. |
| CLI-05 | P2 | Respostas antigas de sessão podiam fazer a interface parecer autenticada após sair. Uma gravação de perfil antiga podia substituir os dados visuais de uma nova conta. | Geração de sessão, ordenação das leituras e controle das gravações. Revalidação em foco/visibilidade e sinal entre abas sem dados pessoais ou tokens. Evidências com respostas atrasadas. A API protegida não foi demonstrada como burlada por essas falhas de interface. |
| CLI-06 | P2 | A tela aguardava os pedidos antes de criar o botão Sair. Respostas atrasadas podiam inserir ações privadas na tela de login ou reabrir a etapa de um código antigo. | Pedidos carregam sem bloquear os demais controles; operações vinculadas à tela e à sessão. Fechar/reabrir durante verificação não deixa carregamento permanente. Voltar da aba de e-mail preserva a etapa do código. |
| CLI-07 | P2 | Endereços inválidos eram filtrados e o sexto endereço era descartado silenciosamente. CEP ausente ou longo era aceito/truncado. Alterar outro campo podia modificar endereços legados sem intenção. | Validação explícita no servidor e na interface; erro 400 para dados inválidos, limite informado e CEP completo. Patch de nome/telefone não migra endereços antigos. Teste no lock do Repository comprova que falha não apaga o estado anterior. |
| CLI-08 | P2 | Comprar novamente abria a sacola e, depois, fechar a conta removia a trava de rolagem da sacola ainda aberta. | O fechamento só libera o body quando não resta outra camada bloqueadora ativa. Teste usa a função real de recompra/carrinho. |
| CLI-09 | P2 | E-mail ou nome comprido fazia o conteúdo da conta ultrapassar seu painel, mesmo quando a página não apresentava overflow global. | Quebra de palavras, dimensões mínimas fluidas e campos/botões limitados à área disponível, sem esconder conteúdo. Dezoito larguras verificadas com textos longos. |
| CLI-10 | P2 | A biblioteca local limitava a lista após ordenar nomes aleatórios de arquivos. Uma imagem recém-enviada podia ficar fora da primeira página. | Ordenação por data antes do limite, consistente com os outros provedores. Sidecar JSON nulo é ignorado com aviso em vez de derrubar a listagem. Gravações temporárias passam pelo mesmo bloco de limpeza. |
| CLI-11 | P2 | Um WebP contendo apenas o cabeçalho de canvas era aceito como imagem. Um canvas pequeno mascarava dimensões excessivas do conteúdo VP8. | Exigência de conteúdo de imagem, validação individual de dimensões e consistência com canvas/quadro. Mantido suporte a WebP com perda, sem perda, transparência, animação e remoção de EXIF/XMP. |
| CLI-12 | P2 | Um timer podia reabrir o produto anterior após mudar de categoria. A opção já utilizada `scroll:false` era ignorada e provocava salto de rolagem. | Abertura agendada cancelável e vinculada à localização atual; rolagem opcional respeitada; callbacks de foco/rolagem vinculados à versão do produto. Testes antes/depois reproduzem o salto de 4.615px e a reabertura indevida. |
| CLI-13 | P3 | O elemento que realmente tinha papel de diálogo não tinha nome acessível, e o primeiro foco da conta podia ir ao backdrop. | `aria-labelledby` no diálogo e foco dentro do painel, mantendo Escape, clique no fundo e botão Fechar. Teste de nome acessível e foco. |
| CLI-14 | P3 | Nem todas as respostas de conta tinham `no-store`; os arquivos públicos alterados reutilizavam URLs da revisão anterior. | Middleware de não-cache para toda a rota de conta e identificador `11.1.8-cliente-r2` nos assets modificados. Não houve desativação de CSP ou autenticação na aplicação. |

P1/P2 indicam impacto relevante no fluxo; não são uma classificação CVSS nem uma afirmação de exploração externa. As correções de limpeza de temporários e cabeçalhos receberam revisão de código; não foram convertidas em alegação de falha de disco injetada ou homologação Express.

## Testes e limites da evidência

- **260 testes locais aprovados**, zero falhas e zero pulados na suíte offline completa, incluindo **36 testes novos**. Os 19 testes iniciais de caracterização tiveram 17 falhas antes das correções; a etapa seguinte acrescentou testes de perfil e repositório, também com falhas reproduzidas antes de corrigir.
- **29 cenários da loja aprovados**, incluindo suas 18 larguras, galeria, variação, teclado, troca de produto, camadas e respostas atrasadas.
- **34 cenários adicionais de navegador aprovados:** 16 fluxos/semântica/navegação e 18 larguras da conta. O nome de cada caso, resultado e erros de página estão nos JSON.
- **304 arquivos de imagem operacionais + 5 fixtures** passaram pelo validador. **223 conteúdos sanitizados únicos** foram decodificados independentemente com Pillow sem falha. As cinco fixtures estão somente nos testes, nunca no catálogo.
- **445 arquivos protegidos de dados, assets e backups** comparados por SHA-256: nenhum alterado. Não foram apagados produtos, imagens, estoque, configurações nem backups recebidos nesta revisão.

As aprovações de navegador usam Chromium 144.0.7559.96, DOM/CSS/JS reais e respostas de API controladas. O relatório da administração distingue a ponte para controladores reais de uma implantação Express. Consulte `TESTES-CLIENTE-R2.md` e as evidências para o resultado final do build e os retestes.

## Integridade, arquitetura e compatibilidade

A arquitetura permanece JavaScript modular, HTML/CSS próprios, Express, Repository local/JSON ou PostgreSQL e as integrações já existentes. Nenhuma dependência foi adicionada/atualizada e o lockfile foi preservado. A função de validação do perfil foi extraída de `server.js` para `src/customer-profile.js` para permitir testar a regra real sem depender de Express. Esse módulo é incluído automaticamente na cópia de `src` para o build.

Os detalhes do produto continuam em fluxo normal, em uma coluna e abaixo da galeria. Não houve redesign, ocultação de funcionalidades ou duplicação de componentes. A versão base continua 11.1.8; os rótulos de revisão e os arquivos de evidência identificam a R2.

A validação WebP no servidor verifica estrutura e cabeçalhos, não toda a decodificação de entropia. A decodificação independente foi feita nos arquivos desta entrega, não é um serviço novo no backend e não comprova que todo arquivo futuro será válido. Referência técnica consultada: Google for Developers, *WebP Container Specification*, https://developers.google.com/speed/webp/docs/riff_container (6/9/2026).

## Antes de apresentar

Não anunciar pagamentos, e-mails, frete automático ou persistência em PostgreSQL como homologados. É necessário concluir uma instalação limpa com acesso ao registro, gerar o build completo e executar a navegação real no ambiente de demonstração. Para publicação, ainda se exigem credenciais próprias, HTTPS, dados comerciais e homologação das integrações.

Use `APRESENTACAO-AO-CLIENTE.md` como roteiro. Os relatórios de versões anteriores são históricos, não aprovações automáticas desta revisão. O arquivo de reteste entregue fora do ZIP vincula os resultados ao SHA-256 do pacote efetivamente extraído.
