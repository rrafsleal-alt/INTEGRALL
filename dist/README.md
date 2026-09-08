> **Revisão PAGINACAO-R1 (07/09/2026): opção B aplicada.** 12 produtos por página, navegação numerada e cards uniformes. Todos os produtos continuam disponíveis. Leia [PAGINACAO-E-CARDS.md](PAGINACAO-E-CARDS.md) antes de atualizar uma instalação configurada.

> **Revisão VISIBILIDADE-R1 (07/09/2026): todos os 227 produtos visíveis.** Os 222 sem preço são apresentados como “Preço sob consulta”, sem venda gratuita. Leia [TODOS-PRODUTOS-VISIVEIS.md](TODOS-PRODUTOS-VISIVEIS.md), especialmente ao preservar um estado operacional existente. Não sobrescreva seus dados com o catálogo-base.

> **Revisão HTTP-R1 (07/09/2026):** correção da suíte HTTP e bloqueio de alteração do frete durante tentativa de pagamento. Consulte [CORRECAO-HTTP-R1.md](CORRECAO-HTTP-R1.md) e [TESTES-HTTP-R1.md](TESTES-HTTP-R1.md). As dependências e a versão 11.1.8 foram preservadas. O build incluso é offline; a aprovação do perfil completo continua exigindo Express e todos os testes HTTP.

> **Integração Correios desta entrega:** leia `CONFIGURAR-CORREIOS.md` antes de ativar o frete e `INTEGRACAO-CORREIOS.md` para o escopo e limitações. As novas orientações de contrato/cartão, caixas reais e revalidação substituem instruções antigas de frete neste histórico.

# INTEGRALL 11.1.8 — revisão de autenticação e produto
Revisão de 6 de setembro de 2026. O arquivo de entrega usa o nome V11.0.4 solicitado, mas o projeto continua na base 11.1.8, com seus dados, imagens, vídeos e funcionalidades.

**Leia primeiro:** `CORRECOES-V11.0.4.md` e `TESTES-V11.0.4.md`. O build entregue é **offline**, não uma homologação completa de produção. Os relatórios de outras versões são históricos.

## Executar
```sh
npm ci
cp .env.example .env
npm run dev
```
Use Node compatível com `package.json`. Loja: `http://localhost:3000/`; administração: `http://localhost:3000/admin`. Não use duplo clique no HTML para operar vendas. Inicializadores Windows foram preservados.

Com `ADMIN_DEFAULT_LOGIN_ENABLED=true`, a senha inicial é a especificada no briefing e hashes antigos do ambiente ficam inativos. O e-mail pode ficar em branco. Para usar senha própria, execute `npm run admin:hash`, preencha o hash no arquivo privado e selecione `ADMIN_DEFAULT_LOGIN_ENABLED=false`. Há somente um modo ativo, nunca duas senhas simultâneas.

Produção exige modo personalizado, HTTPS, PostgreSQL e segredos persistentes exclusivos. Gere os segredos no seu ambiente; não os publique nem coloque senhas na linha de comando. Consulte `.env.example`, `DEPLOYMENT_RUNBOOK.md` e `SECURITY.md`.

## Validar
```sh
npm run source:verify
npm run build:offline
npm run test:production:http
```
O primeiro comando verifica os bytes recebidos; depois de editar dados ou regenerar build, o manifesto da entrega naturalmente deixa de corresponder. O build offline conserva o perfil limitado em `dist/BUILD-INFO.json`. Antes de publicar, execute **npm ci e npm run build completos** e homologue os fluxos reais. Eles não foram aprovados neste ambiente.

As ferramentas opcionais de navegador exigem Python/Playwright/Chromium; não são dependências da aplicação. Os comandos `test:browser:audit`, `test:browser:audit:real` e `test:browser:audit:admin` registram o escopo isolado e não substituem o teste no servidor Express real.

## Preservar dados na atualização
Não substitua dados já operados pelo catálogo inicial deste ZIP. Preserve banco, `data/local-state`, uploads, configuração privada e segredos antes de atualizar. Todos os arquivos operacionais recebidos foram conservados. A omissão do vídeo antigo de backup não altera os vídeos ativos; o original permanece no ZIP de entrada.

O projeto mantém os 227 produtos, inclusive os previamente ocultos/sem preço. Não foram inventados preços nem estoques. Antes de vender, confira os dados públicos de identificação/atendimento, políticas, estoque e credenciais das integrações no seu ambiente.
