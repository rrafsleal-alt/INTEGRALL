REVISÃO POSTERIOR — CORREIOS PAC/SEDEX: consulte CONFIGURAR-CORREIOS.md e TESTES-CORREIOS.md. O conteúdo abaixo é histórico.

# INTEGRALL — preparação da demonstração ao cliente

## O que a versão contém

O projeto completo, não um protótipo substituto. A revisão R2 corrige novos defeitos da conta, mídia, navegação e validações, mantendo a identidade visual e os dados. A documentação técnica atual é `REVISAO-CLIENTE-R2.md`; os documentos antigos permanecem como histórico.

**Não apresentar esta versão como loja comercial integralmente homologada enquanto instalação, servidor e integrações não forem validados no ambiente da apresentação.** O build offline não substitui o servidor. Abrir o HTML com duplo clique não habilita administração, conta, pedidos ou pagamento.

## Preparar uma cópia isolada

Descompacte o novo ZIP em outra pasta. Não sobrescreva uma loja que já recebeu pedidos. Confira a entrega antes de alterar configurações:

```sh
npm run source:verify
npm ci
cp .env.example .env
```

Os comandos acima pressupõem terminal com Node/npm. No Windows, copie `.env.example` para `.env` pelo Explorador ou comando equivalente. Use um runtime aceito por `engines` e pelo provedor; o ensaio desta revisão foi feito com Node 22.16.0, não é uma recomendação para manter uma versão antiga sem atualizações de segurança.

Na cópia local da demonstração, configure `LOCAL_DATA_DIR=.demo-state` para não reutilizar o estado operacional recebido. Mantenha `NODE_ENV=development` somente em ambiente local privado. Não exponha esse modo à internet: ele permite código de acesso de desenvolvimento quando SMTP não está configurado e pode usar a credencial administrativa inicial do briefing. Não grave credenciais reais no Git, no ZIP ou em capturas.

A credencial administrativa inicial continua a do briefing, respeitando maiúsculas e minúsculas. Para configurar uma credencial própria, use `npm run admin:hash`, salve o hash em `ADMIN_PASSWORD_HASH` e ajuste `ADMIN_DEFAULT_LOGIN_ENABLED=false`. Segredos de sessão persistentes devem ser gerados e guardados localmente pelo responsável. Não há segredos novos prontos para produção nesta entrega.

Depois de instalar e configurar:

```sh
npm run build
npm run dev
```

Acesse a loja e a administração no endereço local indicado pelo servidor, normalmente `http://localhost:3000/` e `http://localhost:3000/admin`. `npm run dev` carrega o arquivo `.env`. `npm start` não equivale a carregar automaticamente o arquivo de ambiente; na implantação, o provedor deve fornecer as variáveis.

## Roteiro de aceitação no computador da apresentação

Faça uma passada contínua: abrir a home, navegar nas categorias, buscar, abrir produto, mudar variação, adicionar à sacola e voltar. Repetir em celular ou viewport estreita. Os detalhes devem permanecer abaixo da galeria, sem salto indevido durante atualização e sem produto antigo reaparecendo.

Na administração, testar senha errada e correta, atualização da página, edição de um produto na cópia de demonstração, salvar/reabrir, upload de imagem real e logout. Reabrir uma rota protegida para confirmar a recusa após sair. Confirmar que a imagem enviada aparece entre as mais recentes e persiste após recarregar.

Na conta, testar código inválido e válido, e-mail em outra aba, perfil, endereço completo, histórico e saída. Repetir com a rede lenta: o botão Sair deve permanecer alcançável; uma resposta antiga não deve substituir a conta nova. Recompra deve abrir a sacola mantendo a rolagem do fundo bloqueada.

Use somente dados fictícios na cópia de demonstração, identificando-os como teste. Não mostrar códigos locais, senhas, tokens, dados de clientes reais ou painéis de configuração com segredos durante gravações/apresentações.

## Decisões comerciais necessárias

Há 227 cadastros, mas 222 estão ocultos e sem preço. Não foram publicados artificialmente. Defina quais itens realmente devem estar à venda, seus preços, variantes e estoque. Os cinco itens atualmente vendáveis já existentes podem demonstrar os fluxos visuais, sem simular uma curadoria maior que a efetivamente configurada.

Preencha identificação do fornecedor e endereço físico no administrador. Revise informações comerciais, condições e textos institucionais com o responsável. A auditoria de software não aprova textos jurídicos nem substitui a homologação fiscal/comercial.

## Integrações e publicação

Pagamento: usar a conta e o ambiente de teste do provedor, confirmar o retorno, webhook, valor, idempotência, status, cancelamento e restituição pertinentes. Não testar cobrança de cliente real durante uma demonstração técnica.

E-mail: configurar SMTP de homologação e conferir entrega do código, expiração e mensagens; o código mostrado pelo modo local não comprova envio de e-mail.

Frete: validar contrato, CEP, peso, dimensões e preço/prazo com o provedor escolhido. PostgreSQL: aplicar migrações em base temporária e exercitar persistência/concorrência antes de apontar para dados reais.

Publicação exige configuração de produção, HTTPS, credencial própria, segredos persistentes, backup e verificação de cookies/cabeçalhos no navegador real. Nunca substituir o banco publicado pelo catálogo inicial do ZIP para “corrigir” uma divergência.

## Comandos úteis

```sh
npm run test:client
npm run test:offline
npm run test:browser:client
npm run deployment:check -- --strict
npm run build
npm run release:verify
```

Os testes de navegador adicionais exigem Python/Playwright e um Chromium instalado; esses componentes não foram adicionados como dependências da aplicação. A variante offline continua disponível para diagnóstico, mas seu relatório deve ser apresentado como **validação parcial**, nunca como produção homologada.
