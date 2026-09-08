> HISTÓRICO DA PRIMEIRA AUDITORIA. A revisão vigente desta entrega é R2; consulte REVISAO-CLIENTE-R2.md e TESTES-CLIENTE-R2.md. Resultados antigos abaixo não certificam a revisão atual.

# INTEGRALL — correções e auditoria de 6 de setembro de 2026

## Resultado executivo
O projeto entregue parte do arquivo **INTEGRALL-v11.1.8-COMPLETO-CORRIGIDO(1).zip**. O nome solicitado para a entrega é `INTEGRALL-v11.0.4-corrigido-auditado.zip`; esse nome **não representa downgrade**. `package.json`, lockfile, catálogo, URLs e versão de aplicação continuam em 11.1.8. A documentação com sufixo V11.0.4 registra esta intervenção, substituindo o relatório antigo de mesmo nome.

Foram corrigidos o modo de acesso administrativo padrão, a disposição lateral/modal dos detalhes e defeitos adicionais de sessão, autorização e estado assíncrono. O catálogo e as mídias operacionais foram conservados byte a byte. Há testes automatizados e capturas reais do Chromium, com o escopo de isolamento identificado.

**Resultado global: correções implementadas e validação local parcial. Não é uma certificação completa de produção.** O build offline passa; a instalação npm e o build completo permanecem bloqueados neste ambiente. A execução real Express, os cookies sob navegação nativa e os serviços externos não foram homologados. Consulte `TESTES-V11.0.4.md` antes de publicar.

## Preservação e rastreabilidade
A entrada foi verificada contra caminhos absolutos, travessia de diretórios, links simbólicos e nomes duplicados, e extraída em referência separada. Não havia histórico Git. O ZIP original permaneceu intacto; o diff foi calculado contra seus bytes originais, e não contra uma cópia que passou por build.

SHA-256 do ZIP recebido: `0a99fb33e2000f9eb3b55f6013e304693d85ece0c6d67a8962dc5e7644e94a32`.

A árvore e os hashes de entrada estão em `docs/evidencias-v11.0.4/inventario/`. O catálogo principal mantém 227 produtos e 52 variações; produtos previamente ocultos ou sem preço não foram excluídos nem ganharam preços fictícios. Os arquivos de `public/assets`, `data/local-state`, catálogos e sementes de mídia foram comparados com o ZIP original. Os 43 identificadores de mídia recuperada correspondem a 33 imagens únicas no conjunto verificado.

Foi omitido do pacote final somente o vídeo de backup antigo de aproximadamente 33,4 MB em `backups/originais-v11.1.7/integrall-hero-loop.mp4`. Ele continua no ZIP de entrada; não é o vídeo em uso. Os pequenos backups JSON e a capa foram conservados, inclusive o catálogo usado pelos testes históricos. Nenhum banco ou upload operacional foi removido. Dependências instaladas parcialmente e caches não integram a entrega.

## Inventário técnico e fluxo de dados
| Camada | Implementação encontrada |
|---|---|
| Aplicação | JavaScript, módulos ES, Node.js; sem React/Vue/Angular/TypeScript |
| Servidor | Express 5.1.0; entrada `server.js`; rotas públicas, administração, clientes, pedidos e integrações |
| Dependências | npm e `package-lock.json`; Express 5.1.0, pg 8.16.3, mercadopago 3.4.0; versões preservadas |
| Frontend | HTML estático, CSS próprio, JavaScript modular organizado em arquivos; DOM e estado em memória |
| Estilos | `store.css`, `checkout.css`, `premium-v104.css`, `commerce-v111.css`; sem biblioteca de componentes |
| Persistência | `Repository`; PostgreSQL no modo de produção; JSON local com gravação atômica no modo local |
| Catálogo | `data/catalog.json`, estado operacional local e API; fallback embutido gerado pelo build |
| Mídias | Assets públicos, sementes e identificadores de uploads; nenhum upload foi substituído por recurso externo |
| Administração | `public/admin.html`, `public/js/admin.js`; API protegida no servidor |
| Autenticação | scrypt no servidor; token assinado e registro de sessão; cookie HttpOnly/SameSite, Secure em HTTPS; CSRF e origem |
| Cliente | Sacola/preferências locais; conta, avaliações e alertas via API; sem senha administrativa em storage |
| Integrações | Mercado Pago, SMTP, Correios e Jadlog; não acionados contra contas reais |
| Build | Scripts próprios de verificação e cópia para `dist`; perfis completo e offline já existentes |
| Qualidade | Node test runner; lint próprio limitado; varredura de padrões; Playwright/Python nos testes de navegador |
| Deploy | Docker Compose, configurações Render, migrações SQL e runbook preservados |
| PWA/cache | Manifesto web presente; não foi encontrado service worker executável registrado no projeto |

O frontend obtém produtos pela API ou pelo catálogo embutido sem pagamentos ativos. A seleção e a galeria usam `public/js/store/catalog.js`; variação, quantidade e formulários são reinicializados antes de outro produto. O painel administrativo carrega e grava catálogo/configuração pela API com CSRF. O repositório é responsável pela persistência e concorrência; os testes de gravação usam diretórios temporários, nunca o catálogo operacional recebido. `commerce-v111.js` associa avaliações e alertas ao produto/variação ativo.

## Diagnóstico e correções
| ID / prioridade | Evidência, causa e correção | Verificação |
|---|---|---|
| AUTH-BASE / P1 | Sem configuração antiga, a senha inicial já funcionava na entrada. Porém, com modo padrão habilitado e um hash legado configurado, `configuredHash || defaultHash` fazia o hash antigo prevalecer. Agora o seletor de modo é exclusivo: padrão usa somente o hash inicial; personalizado exige a opção false e usa somente o hash configurado. Nenhum segredo é exposto no aviso de conflito. | Baseline JSON do conflito; testes `default-admin.test.js`, incluindo hash legado simulado |
| PROD-FLOW / P1 | O produto estava depois de `main`, com `role=dialog`, `aria-modal`, posição fixa, galeria e informações em duas colunas. Foi colocado depois do catálogo dentro de `main`, como região nomeada, com uma coluna e altura livre. Não há painel invisível alternativo. | Antes/depois real; 18 larguras; ordem DOM e medidas geométricas |
| SESSION-LOGOUT / P2 | O frontend encerrava visualmente a sessão mesmo se a requisição de logout falhasse. Agora espera confirmação ou resposta de sessão já inválida; falhas mantêm a sessão visível e permitem repetir. A mesma falha existia no logout de cliente e foi corrigida. | Falha 503 e nova tentativa no controlador real/ponte; cliente com API simulada |
| SESSION-RACE / P2 | Respostas tardias e documentos já abertos podiam reaplicar estado autenticado. Foi acrescentada geração de sessão, descarte de respostas obsoletas, revalidação no foco/visibilidade/pageshow e notificação entre abas sem credenciais. | Resposta atrasada após logout; segundo documento revalida revogação; revisão de fontes |
| AUTH-ROLE / P2 | Papel desconhecido caía em permissão de administrador; token antigo não vinculava a configuração atual de papel/hash. Papéis inválidos agora falham fechados. Token v2 vincula usuário, papel e impressão HMAC da credencial vigente e valida tempos/identificador. | Testes de papel inválido/protótipo, redução de privilégio, rotação, expiração e token corrompido |
| PROD-STATE / P2 | Abertura com variante explícita podia manter a primeira foto; setas em campos de texto alteravam a galeria; campos temporários reapareciam. Agora seleção sincroniza foto, teclas de edição são preservadas e o estado é limpo entre produtos. | Variação com foto em fixture, edição de mensagem, fechar/reabrir/trocar |
| FORM-ASYNC / P2 | `event.currentTarget` era acessado depois de `await`; respostas antigas podiam preencher feedback do produto atual. O formulário é capturado antes da espera e o retorno é vinculado à geração/produto/variação. | Envio de avaliação, limpeza, resposta atrasada após trocar e reabrir o mesmo produto |
| HASH-INPUT / P3 | A ferramenta de hash descartava espaços finais e não tratava corretamente texto colado em lote no terminal. Preserva os caracteres da senha; remove apenas o terminador do pipe e processa colagem/backspace sem eco. | Pipe com espaços finais; comparação do hash; colagem física no terminal não homologada |
| QA-CONTRACT / P2 | Testes antigos e o auditor exigiam exatamente o popup lateral, e o servidor estático de teste devolvia HTML200 para recursos inexistentes. Foram substituídas as condições incompatíveis por ordem DOM/uma coluna/sem overlay; o smoke agora exige 404 real para arquivos ausentes. | Testes históricos atualizados, auditoria e smoke estático |

Não houve troca de framework, upgrade de dependências, redesign da home, alteração de preço, estoque, rótulo, arquivo de imagem ou vídeo ativo. Os controladores de sessão foram extraídos de `server.js` para `src/admin-session.js`, mantendo os middlewares Express, limites de tentativas e contratos. Isso também permite testar os controladores reais sem simular o resultado da senha.

## Autenticação, migração e acesso
A loja exige o servidor; não abra `public/index.html` por duplo clique para operar vendas. Administração local: `http://localhost:3000/admin`. O e-mail pode ficar vazio no login inicial; o servidor usa a conta configurada. A senha inicial é a indicada no briefing, comparada sem trim e com diferenciação de maiúsculas. Não é repetida aqui nem inserida no frontend.

**Modo padrão:** `ADMIN_DEFAULT_LOGIN_ENABLED=true`. Somente a credencial inicial é aceita; um `ADMIN_PASSWORD_HASH` antigo não a sobrescreve e não é aceito em paralelo. **Modo personalizado:** configure o hash produzido por `npm run admin:hash` e use `ADMIN_DEFAULT_LOGIN_ENABLED=false`. Esta seleção explícita é necessária ao migrar um ambiente que antes mantinha hash próprio junto com a opção true.

Produção continua recusando a credencial embutida, segredo temporário e configuração incompleta. Para usar a senha desejada numa implantação, gere seu hash no servidor, configure-o como credencial própria e desative o modo inicial. Não existe autorização administrativa apenas visual: as APIs permanecem protegidas. O HTML de login é público; dados e operações administrativas são verificados no servidor.

Sessões v1 e sessões ligadas a outro hash/papel deixam de ser aceitas e exigem novo login. Isso **não apaga produtos, uploads, sacola ou banco**. A rotação de credencial não mantém tokens antigos válidos. Sem segredo persistente no desenvolvimento, reiniciar o processo invalida sessões por projeto; isso não se confunde com atualizar a página. O tempo normal de sessão é configurável entre 1 e 24 horas.

## Execução e build
Na pasta do projeto, instale com `npm ci`. Para desenvolvimento, copie o arquivo de exemplo para seu arquivo privado, configure as variáveis e execute `npm run dev`. O lockfile deve ser mantido. Para autenticação personalizada use `npm run admin:hash`, sem passar senha na linha de comando.

```sh
npm run check
npm run lint
npm run security:scan
npm run audit
npm run media:verify
npm run test:offline
npm run test:audit
npm run build:offline
npm run test:production:http
```

O build completo continua obrigatório antes de publicar:

```sh
npm ci
npm run build
npm run release:verify
```

O perfil offline **não instala nem substitui Express**. Ele gera o pacote e valida código, dados e testes independentes das dependências externas. `dist/BUILD-INFO.json` declara `profile=offline` e integração Express `not-run`.

Testes de interface adicionais usam Python, Playwright e Chromium, ferramentas já disponíveis no ambiente desta auditoria. Não são dependências da aplicação nem foram acrescentadas ao lock npm. Com essas ferramentas instaladas, execute `npm run test:browser:audit`, `npm run test:browser:audit:real` e `npm run test:browser:audit:admin`. O adaptador em `tests/fixtures` é exclusivamente de teste e não é servidor de implantação.

## Limitações e riscos residuais
O ambiente não conseguiu resolver o registro npm. Uma tentativa de `npm ci` também terminou com erro interno “Exit handler never called”; a evidência foi preservada, não reclassificada como sucesso. O build completo falhou na importação de Express; portanto a inicialização e integração completa de `server.js` não estão homologadas aqui. `npm audit` também falhou por DNS; a varredura local de padrões não equivale a consulta de vulnerabilidades.

O Chromium é gerenciado e bloqueou navegação HTTP, inclusive loopback. As páginas visuais foram carregadas em `about:blank`, com HTML/CSS/JS reais e CSP retirada apenas na fixture. Imagens reais foram incorporadas com seus bytes originais. O teste administrativo liga a UI aos controladores reais por ponte HTTP e cookie jar do driver, com respostas auxiliares de dashboard simuladas. **Isso não testa automaticamente CSP, SameSite/Secure, navegação nativa, cookies do navegador, redirects ou Express.** Os testes unitários verificam a serialização desses atributos, não sua aplicação por um navegador real.

O zoom nativo, leitores de tela, teclado virtual, Firefox/WebKit/Safari/Edge/Chrome e dispositivos físicos não tiveram validação concluída. Um experimento separado com CSS `body.zoom` produziu transbordamento da home/cabeçalho em 125%, 150% e 200%; os detalhes continuaram abaixo. Como CSS zoom não muda as media queries como o zoom nativo, não foi usado como aprovação desse requisito nem omitido: relatório e comando opt-in estão preservados.

Não foram realizadas compras, envios SMTP, cotações contratadas ou gravações no PostgreSQL real. Não há certificação de WCAG, carga, vazamentos de memória ou Web Vitals. Antes da produção, complete instalação/build/E2E nativo e a homologação das integrações descrita no runbook. Não substitua dados de uma loja já operada pelo catálogo inicial deste ZIP.

## Localização das entregas
`ARQUIVOS-ALTERADOS-V11.0.4.md` relaciona alterações e riscos. `PATCH-V11.0.4.diff` contém o diff de fontes e testes; saídas geradas e binários não são reproduzidos no patch. `MANIFEST.sha256` permite verificar a cópia recebida antes de qualquer alteração operacional. `TESTES-V11.0.4.md` e os JSON/capturas em `docs/evidencias-v11.0.4/` registram a cobertura real. Relatórios de outras versões são históricos, não aprovações automáticas desta intervenção.
