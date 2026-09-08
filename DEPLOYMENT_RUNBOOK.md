> **Integração Correios desta entrega:** leia `CONFIGURAR-CORREIOS.md` antes de ativar o frete e `INTEGRACAO-CORREIOS.md` para o escopo e limitações. As novas orientações de contrato/cartão, caixas reais e revalidação substituem instruções antigas de frete neste histórico.

# Publicação e atualização — INTEGRALL v11.1.8

## Estado desta entrega

O `dist` está completo como conjunto de arquivos de implantação, com mídias e manifestos. Foi gerado por `npm run build:offline`, pois as dependências não puderam ser instaladas no ambiente de preparação. **Não o trate como homologação de serviços externos ou como integração HTTP já aprovada.**

## Preservar antes de atualizar

Pare a instância local antes de copiar seus dados. Faça backup do código em uso, PostgreSQL (quando existente), uploads, catálogo exportado e diretório local completo. Mantenha as variáveis privadas na plataforma. Não sobreponha a pasta operacional por `data/local-state` deste pacote: ela contém o catálogo inicial e as fotos recebidas, não suas vendas posteriores.

Em PostgreSQL, o catálogo existente é preservado. Somente referências conhecidas das fotos recuperadas, nomes malformados exatos e o texto antigo exato de devolução recebem reparo idempotente. Preços, estoque, pedidos e uploads desconhecidos não são substituídos pelo seed. Em um banco novo, o catálogo inicial desta versão é utilizado. Confira o conjunto de produtos após cada cenário; em banco antigo, revise explicitamente os rascunhos que deseja ocultar.

No desenvolvimento, utilize `LOCAL_DATA_DIR` com caminho privado fora da pasta do código quando possível. O novo `state.json` reúne estoque e pedidos em um commit. Uma restauração deve recuperar o estado inteiro correspondente, não misturar o estoque de um dia com os pedidos de outro. O diretório local não admite múltiplos processos escrevendo simultaneamente. PostgreSQL continua obrigatório em produção.

## Preparação da versão completa

Na fonte, não dentro de um dist antigo:

```bash
npm ci
npm run build
npm run release:verify
```

`build` deve concluir sem testes de integração pulados. Depois rode as regressões de navegador disponíveis. Se qualquer etapa falhar, corrija antes de promover a versão. O scanner local verifica padrões; não substitui análise atualizada da árvore de dependências.

O exportador só é chamado pelo orquestrador de build. O atalho `build:production` não ignora gates. O modo explicitamente offline mantém auditoria, sintaxe, lint, mídia e testes offline, mas registra que a integração HTTP não foi executada.

## Instalação do dist

Faça a implantação em um diretório novo e aponte o gerenciador de processo para ele; não mescle um dist novo com arquivos residuais de outro. Dentro do pacote de implantação:

```bash
npm ci --omit=dev
npm run release:verify
npm run media:verify
npm run db:migrate
npm start
```

Antes da migração/inicialização, configure as variáveis na plataforma: `NODE_ENV=production`, `PUBLIC_URL` HTTPS, `DATABASE_URL`, TLS adequado ao banco, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` próprio, `ADMIN_DEFAULT_LOGIN_ENABLED=false`, `ADMIN_SESSION_SECRET` e `CUSTOMER_AUTH_SECRET` distintos e persistentes. O comando `npm start` recebe essas variáveis do ambiente: ele não carrega automaticamente um arquivo privado. Localmente, `npm run dev` é que carrega o arquivo de desenvolvimento.

Confirme as credenciais e ambientes de pagamento, SMTP e transportadora. Não suponha que campos vazios estejam contratados/ativos. Não habilite pagamento real antes de um fluxo completo em homologação. Não coloque tokens no catálogo, HTML ou formulários públicos.

## Cadastro público e conferência

No administrador, abra **Identificação e atendimento da loja**. Preencha CPF/CNPJ, razão/nome do fornecedor, endereço físico e atendimento; confira as políticas. O salvamento só envia a configuração comercial e exige a revisão do catálogo para evitar sobrescrever uma alteração concorrente. Ao receber conflito, preserve seus textos, atualize os dados e confira antes de salvar.

`npm run deployment:check -- --strict` verifica o catálogo inicial do pacote. Para validar o banco operado, exporte o catálogo atual pelo administrador e use `--catalog=arquivo-exportado.json --strict`. Essa rotina não acessa o banco remoto.

Os 43 IDs de mídia antiga continuam legíveis por fallback de pacote, inclusive com PostgreSQL. URLs novas do catálogo usam `public/assets/recovered` e não dependem de copiar os dados locais ignorados pelo Git. Não remova `data/media-seed` nem `public/assets/recovered` do deploy.

## Homologação mínima antes de liberar clientes

Confirme saúde e versão 11.1.8; acesso administrativo autenticado e permissões; carregamento das fotos e ausência de erros de recursos; home/destaques com preço e variação corretos; acesso direto a produtos; menu, conta, sacola e pausa do vídeo em celular; menor movimento ativado e desativado.

Faça um pedido com dados de teste, repita a mesma tentativa e confira idempotência. Confira reserva/expiração/cancelamento, pagamento com retorno e confirmação no servidor, estoque final e reabertura do pedido após reinício. Teste entrega e retirada, frete contratado, cupom, login por e-mail, confirmação e status. Simule falhas de provedor de forma controlada em homologação, sem transações reais não autorizadas. Confira logs e mensagens sem divulgação de dados pessoais.

## Rollback

Volte primeiro ao código anterior somente depois de avaliar a compatibilidade dos dados. Uma versão anterior não entende o novo estado local como autoridade e pode voltar a perder pedidos: não reutilize o diretório recém-operado em código antigo sem restauração consistente e conferência. Não faça downgrade destrutivo automático de banco nem edite migrations já aplicadas. Preserve todas as fotos e alterações comerciais ao restaurar.

## Evidências e limites

Resultados desta preparação: 212 testes offline; regressão da loja em 18 larguras; 10 cenários adicionais com mídias reais em fixture isolada. A integração HTTP/Express não foi executada, pela impossibilidade de instalar as dependências. PostgreSQL externo, Mercado Pago, SMTP e transportadoras não foram acessados. Não há medição de desempenho em rede real nem certificação jurídica, de acessibilidade ou de segurança. Use as evidências como regressão do escopo executado, não garantia de ausência de outros problemas.

## Conferência adicional desta entrega

O administrador passou nos quatro tamanhos avaliados (320, 390, 768 e 1440 pixels), com API simulada: acesso, saída, rolagem e ausência de transbordamento. O novo formulário comercial foi exercitado em 390 e 1440, enviando apenas configuração comercial e revisão, sem produtos. A atualização da identificação no rodapé foi testada em memória.

Antes de iniciar ou editar a fonte entregue, `npm run source:verify` confere seu manifesto. Depois de operar, diferenças nos dados são esperadas; não restaure o catálogo inicial para fazê-las desaparecer.
