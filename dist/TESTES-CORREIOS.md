# Testes — integração Correios PAC/SEDEX

Revisão de 07/09/2026. Base interna 11.1.8, sem downgrade e sem dependências novas.

## Resultado e limites

**APROVADO nos testes locais de código, páginas isoladas, módulos de backend e build offline. NÃO HOMOLOGADO em produção.** Não há credenciais reais no pacote. Nenhuma cotação desta automação foi enviada à conta do usuário nos Correios.

O acesso externo ao registro npm falhou neste ambiente; a instalação limpa não foi concluída. O build completo foi tentado e interrompido pela falta de Express. A suíte HTTP de aplicação, PostgreSQL, cookies nativos e HTTPS não estão aprovados. Não se deve apresentar a aprovação do build offline como substituta dessa etapa.

## Ambiente

Linux, Node 22.16.0, npm 10.9.2, Python 3.13.5, Chromium 144.0.7559.96. Banco dos testes em repositório local temporário e separado do catálogo operacional. Não houve instalação de dependências novas no lockfile.

Chromium gerenciado bloqueia navegação HTTP nativa com `ERR_BLOCKED_BY_ADMINISTRATOR`. Sua política não foi alterada. Os testes visuais usam `about:blank`, HTML/CSS/JavaScript do projeto e funções de ponte para dados de teste. Isso não verifica os controles de rede/cookies/CORS/TLS do navegador ou a inicialização do Express.

## Matriz desta revisão

| Verificação | Resultado | Evidência/limite |
|---|---|---|
| Baseline sem dependências antes de alterar | APROVADO — 260 testes | Suíte da base recebida |
| Suíte sem dependências após alterações | APROVADO — 301 testes, zero falhas e zero pulados | Inclui 41 novos testes de Correios |
| Novos testes de Correios | APROVADO — 41 | Autenticação por contrato/cartão, hosts, token, GET/POST legado, preços, prazo, falhas, caixas, recibo, pedido e configuração |
| Dois testes de transporte com fetch nativo | APROVADO | Servidor Node HTTP local, provedor simulado; inclui timeout real |
| Interface dedicada de frete/checkout | APROVADO — 25 cenários | Oito larguras; backend e repositório reais por ponte; respostas Correios simuladas |
| Cadastro de caixas no administrador | APROVADO — quatro larguras | Formulário e payload reais; persistência/reabertura de UI com API simulada |
| Administração com controladores reais | APROVADO — 13 cenários, 63 requisições | Cookies gerenciados pelo executor; não Express ou cookies nativos |
| Regressão da loja | APROVADO — 29 cenários | Inclui 18 larguras; fixture da loja |
| Sintaxe JavaScript | APROVADO | Script `check` do projeto |
| Lint do projeto | APROVADO | Regras de sintaxe/estrutura; não é TypeScript |
| Scanner local de segurança | APROVADO nas regras verificadas | Não é auditoria de vulnerabilidades de dependências ou pentest |
| Auditoria e mídias | APROVADO | Scripts próprios do projeto |
| Integridade dos dados/assets/backups | APROVADO — 445 arquivos idênticos | SHA-256 contra a base original; catálogo e mídias preservados |
| Integridade do lockfile | APROVADO — idêntico | Total de 446 arquivos conferidos junto aos dados |
| Instalação limpa com npm | NÃO CONCLUÍDA | Falha de acesso ao registro e erro de instalação; tentativa offline sem pacote em cache |
| Build completo | REPROVADO nesta execução | Falta do Express; não equivale a uma falha reproduzida da lógica de frete |
| Build offline | APROVADO | Perfil identificado em `dist/BUILD-INFO.json`, sem homologação HTTP/Express |
| Verificação e teste HTTP do pacote estático | APROVADO — 10 verificações | Servidor de arquivos estáticos; não servidor Express da loja |
| Homologação real Correios, Jadlog, SMTP, PostgreSQL e pagamentos | NÃO EXECUTADA | Sem uso de credenciais reais; exige aceitação no ambiente de publicação |
| Firefox, Safari/WebKit, dispositivos físicos e zoom nativo | NÃO EXECUTADOS | Não certificados pela emulação de largura |
| Pré-postagem e etiquetas | NÃO APLICÁVEL a esta alteração | Etapa posterior; nenhuma contratação de postagem foi feita |

Os 41 casos novos também estão incluídos nos 301; não some esses números como execuções distintas de funcionalidades. O runner do build completo inclui uma entrada de falha ao importar o arquivo HTTP sem Express; isso não significa que os casos HTTP de aplicação tenham sido executados.

## Cenários novos e revisados

Autenticação: contrato sem cartão obrigatório, cartão explícito com contrato/DR, recusa de host não oficial, coordenação de renovações, validade explícita, recuperação limitada de 401, permissões 403, 429/5xx e respostas malformadas. Homologação também é detectada pelo host configurado e bloqueada em modo de produção.

Cotação: endpoints nacionais GET, fixtures POST antigas mantidas, números monetários convertidos rigorosamente em centavos, peso e medidas cadastrados, somatório de volumes, serviço com preço sem prazo recusado, nenhum preço zero criado por falha e opções parcialmente disponíveis.

Embalagens: quantidades exatas, caixas específicas por variação, combinação 4+4 para oito unidades, agrupamento de linhas duplicadas, falta de configuração, limites, validação administrativa e ausência de truncamento de uma caixa excedente.

Fechamento: recibo HMAC válido, adulteração, expiração, alteração de CEP/quantidade/preço/cadastro, serviço escolhido indisponível, preço/prazo/entrega domiciliar diferentes, reconsulta sem cache, frete subsidiado legítimo, pedido manual pendente, armazenamento de metadados, projeção pública e idempotência. A guarda de pagamento antes do reaproveitamento de checkout é também verificada estaticamente; a rota real de pagamento não foi homologada.

Interface: duas opções, troca para SEDEX, total, quantidade, retirada, resposta atrasada de outro CEP, erro/retentativa, frete manual explícito, expiração e pedido com reconsulta. Inclui falha do endpoint de saúde sem esconder as opções quando o catálogo já informa modo Correios.

## Larguras

Frete dedicado: 280, 320, 375, 430, 768, 1024, 1440 e 1920 pixels. Em cada largura, verificaram-se as opções, total, seleção e ausência de transbordamento horizontal do painel/página da fixture.

Caixas administrativas: 280, 320, 768 e 1440 pixels. Formulário, validação, payload salvo e reabertura, com backend de teste simulado.

Regressão da loja: 280, 320, 360, 375, 390, 412, 430, 480, 600, 768, 820, 1024, 1280, 1366, 1440, 1600, 1920 e 2560 pixels. Não equivale à certificação de todo o site em todos os navegadores.

## Como reproduzir

```sh
npm ci
npm run test:dependency-free
npm run test:correios
npm run check
npm run lint
npm run security:scan
npm run audit
npm run build
npm run release:verify
npm run test:production:http
```

Com Python, Playwright e Chromium disponíveis:

```sh
npm run test:browser:correios
python scripts/audit-admin-browser.py --root . --out docs/evidencias-correios/admin-controladores
```

O script de caixas pode ser executado com `INTEGRALL_TEST_SHIPPING_EDITOR=1` e `INTEGRALL_BROWSER_WIDTHS=280,320,768,1440`, usando `scripts/admin-browser-regression.py . docs/evidencias-correios/admin-caixas`. Essas variáveis são apenas do executor de testes, não da loja.

Em ambiente restrito, `npm run build:offline` executa o perfil explicitamente offline. Não o renomeie ou divulgue como aprovação completa.

## Evidências e reteste da entrega

Os resultados e capturas desta revisão estão em `docs/evidencias-correios`. Logs completos e o comprovante vinculado ao hash do ZIP acompanham a entrega separadamente. O comprovante externo `RETESTE-CORREIOS.txt` registra os comandos realmente repetidos após descompactar o ZIP final. Ele evita um hash circular do ZIP dentro dele mesmo.

Os documentos R2 e anteriores são históricos; seus números não são resultados automaticamente reexecutados nesta revisão. Os JSONs que o usuário obteve no CWS foram somente referência para fixtures. Não fixamos os valores, os prazos ou as datas de setembro/2026 na loja.

## Aceitação necessária antes de demonstrar operação real

Configure credenciais privadas, origem, serviços e embalagens reais. Faça uma compra de teste sem cobrança real na cópia isolada, conferindo preço e prazo entre loja/CWS para as mesmas condições. Verifique também carrinho com mais de um produto e variação, mudança de CEP, retirada e indisponibilidade. Publique somente após instalação limpa, build completo e validação do servidor real, sessão administrativa, persistência e política de pagamento.
