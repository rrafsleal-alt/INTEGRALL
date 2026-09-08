# INTEGRALL Online v11.1.6 — Auditoria expert de negócio, concorrência e produção

Loja virtual da **INTEGRALL | Boutique Gourmet** — vinhos, sucos, cafés e petit four — com catálogo, carrinho, pedidos server-side, clientes, acompanhamento de pedido, painel administrativo, PostgreSQL, **frete automático (Correios + Jadlog)**, **e-mail transacional**, cupons de desconto, verificação de idade 18+ e integração **Mercado Pago Checkout Pro** pronta para credenciais.

## Fluxo da loja

1. Cliente confirma ter 18+ (obrigatório — a loja vende bebida alcoólica).
2. Escolhe produtos, variações e quantidades (com mínimo/máximo por produto).
3. Define retirada ou entrega; para entrega, informa CEP e endereço completo.
4. **O frete é cotado automaticamente**: até 12 unidades pelos Correios (PAC/SEDEX), acima de 12 pela Jadlog (.Package) — preço + prazo na hora, com seguro (valor declarado) embutido.
5. Pode aplicar cupom de desconto (validado no servidor).
6. O servidor recalcula preços, estoque, frete e desconto e cria o pedido.
7. Cliente recebe **e-mail de confirmação** com resumo e link de acompanhamento.
8. Se o Mercado Pago estiver configurado, segue para PIX ou cartão no Checkout Pro.
9. O webhook confirma o pagamento; o pedido vira `paid` e o estoque baixa uma única vez.
10. Admin avança o fluxo (`paid → preparing → ready → completed`) e informa o **código de rastreio** — o cliente é avisado por e-mail e acompanha a entrega.
11. Pedidos sem pagamento expiram automaticamente após 7 dias.

## Rodar localmente

```bash
npm ci
npm run dev
```

- Loja: `http://localhost:3000/`
- Admin: `http://localhost:3000/admin` — login obrigatório; no primeiro acesso, use a senha padrão `[CREDENCIAL INICIAL REDIGIDA]` e deixe o e-mail em branco
- Editor visual: loja real à direita + propriedades à esquerda; clique no próprio site para editar/mover/ocultar/excluir
- Fotos: selecione do computador e ajuste enquadramento, zoom e formato antes de salvar
- Health: `http://localhost:3000/api/health`

No Windows: `INICIAR-INTEGRALL.bat`. O inicializador chama `PREPARAR-DEPENDENCIAS.bat`, verifica `express`, `mercadopago` e `pg` e executa `npm ci` quando a instalação está ausente ou incompleta. Para iniciar e abrir diretamente o painel, use `ABRIR-ADMIN.bat`. Com `DATABASE_URL` vazio em desenvolvimento, catálogo e fotos editados ficam em `data/local-state/`; pedidos de teste ficam em memória. PostgreSQL local: `INICIAR-COM-POSTGRES-LOCAL.bat` (Docker).

## Configuração (.env)

Veja `.env.example` com todos os comentários. Resumo dos blocos:

| Bloco | Variáveis-chave | Efeito quando preenchido |
|---|---|---|
| Servidor | `NODE_ENV`, `PORT`, `PUBLIC_URL`, `TRUST_PROXY` | produção exige PostgreSQL + HTTPS |
| Banco | `DATABASE_URL` | pedidos/clientes/catálogo persistentes |
| Mercado Pago | `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` | PIX/cartão no Checkout Pro |
| **Correios** | `CORREIOS_USER`, `CORREIOS_ACCESS_CODE`, `CORREIOS_POSTAGE_CARD`, `CORREIOS_ORIGIN_CEP` + `SHIPPING_MODE=correios` | frete PAC/SEDEX automático |
| **Jadlog** | `JADLOG_TOKEN`, `JADLOG_CNPJ`, `JADLOG_CONTA` | frete .Package automático |
| Divisão | `CARRIER_SPLIT_UNITS=12` | até 12 un → Correios; acima → Jadlog; `0` = todas cotam |
| E-mail | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | confirmação de pedido/status/rastreio |
| Operação | `ORDER_EXPIRE_DAYS=7` | expira pedidos sem pagamento |
| Frete manual | `SHIPPING_MODE=quote|fixed|zones`, `FREE_SHIPPING_CENTS` | modos sem API |

### Frete automático — Correios (contrato)

> **Pré-requisito do contrato** (manual oficial da API Preço): os serviços **38202 – API PREÇOS** e **38210 – API PRAZOS** precisam estar **vinculados ao contrato e aos cartões de postagem** (modalidade a faturar). Sem esse cadastro a API retorna "restrita" — peça a liberação ao representante comercial dos Correios antes de configurar.

1. No CWS (`https://cws.correios.com.br`), gere o **código de acesso a APIs** (Gestão de acesso a APIs).
2. Preencha `CORREIOS_USER` (usuário Meu Correios PJ), `CORREIOS_ACCESS_CODE`, `CORREIOS_POSTAGE_CARD` (cartão de postagem) e `CORREIOS_ORIGIN_CEP`.
3. `SHIPPING_MODE=correios` ativa a cotação automática. Serviços padrão: `03298` (PAC contrato) e `03220` (SEDEX contrato) — ajuste `CORREIOS_SERVICES` conforme sua ficha técnica.
4. `CORREIOS_HOMOLOG=true` usa o ambiente `apihom` para testes (exige conta no Meu Correios **Homologação** e senha de APIs no CWS Homologação).
5. O valor declarado (seguro) é enviado automaticamente com o subtotal do pedido, com o **código correto por serviço** (019 no SEDEX, 064 no PAC) — essencial para garrafas.
6. `CORREIOS_API_VERSION` (padrão `v1`): o manual cita `/preco/v1` nos exemplos e `/preco/v3` na seção Ambientes; se a homologação exigir v3, ajuste a variável sem mudar código.

### Frete automático — Jadlog

1. Peça o **token de integração** à franquia Jadlog que atende seu CNPJ.
2. Preencha `JADLOG_TOKEN`, `JADLOG_CNPJ` e, se correntista, `JADLOG_CONTA`/`JADLOG_CONTRATO`.
3. Modalidade padrão: `3` (.Package). O peso enviado é sempre o maior entre real e cubado (C×L×A÷6000), conforme manual v2.3.

**Regra de divisão** (`CARRIER_SPLIT_UNITS`, padrão 12): pedidos com até 12 unidades vão pelos Correios; acima, pela Jadlog. Imposta pelo servidor (o navegador não força a transportadora). Se a preferida falhar ou não tiver credenciais, a outra assume automaticamente.

### Empacotamento e caixas reais

O servidor monta os volumes do pedido antes de cotar:

- **Caixas reais cadastradas** (campo `boxes` do produto): caixa 6×750ml (30×25×17 cm, 7,25 kg), caixa 12×750ml (30×30×24 cm, 14 kg), caixa 12×300ml (23×18×19 cm, 6,2 kg), caixa 12×1L (37×27×29 cm, 18 kg). Quantidades que fecham caixa usam medidas e pesos exatos.
- **Avulsos**: empacotados em grade quase quadrada com garrafas **em pé** (exigência das transportadoras), minimizando o peso cúbico.
- Pedidos grandes geram múltiplos volumes; o frete é a soma de todos.
- Peso/dimensões de cada produto são editáveis no **Admin → Produtos**.

## Primeiro acesso administrativo

Abra `/admin` e informe apenas a senha padrão **[CREDENCIAL INICIAL REDIGIDA]**; o campo de e-mail pode ficar em branco. A conta interna usada nesse caso é `admin@integrall.local`.

Para cadastrar uma senha própria, gere um hash e configure o ambiente:

```bash
npm run admin:hash
```

Copie somente o hash para `ADMIN_PASSWORD_HASH`, defina `ADMIN_EMAIL` e gere um `ADMIN_SESSION_SECRET` exclusivo com pelo menos 32 caracteres. Quando `ADMIN_PASSWORD_HASH` é preenchido, ele **substitui integralmente** a credencial inicial; não existe uma segunda senha de recuperação concorrente. Em produção, mantenha `ADMIN_DEFAULT_LOGIN_ENABLED=false`. Para a conta do cliente, gere também um `CUSTOMER_AUTH_SECRET` separado, aleatório e persistente.

Papéis disponíveis: `admin` (acesso total), `editor` (catálogo/mídia) e `operator` (pedidos/clientes). As permissões continuam verificadas no backend; ocultar um botão no frontend não concede nem remove autorização.

## Painel administrativo

- **Editor visual**: prévia editável da loja lado a lado; clique em cabeçalho, apresentação, filtros, produtos ou rodapé para alterar sem abrir janelas sobre a prévia. Permite mover seções/produtos, ocultar/restaurar elementos e excluir produtos. Visualização em desktop, tablet e celular.
- **Fotos de produto**: upload do computador com recorte visual, arrastar para reposicionar, zoom e formatos da loja/quadrado/retrato/paisagem/original.
- **Pedidos**: busca, filtro por status, detalhes completos, mudança de status, cotação manual de frete, **código de rastreio** (link Correios automático), histórico, exportação CSV.
- **Produtos**: edição de preço, estoque, descrição, mín/máx por pedido, peso e dimensões — sem JSON.
- **Cupons**: porcentagem, valor fixo ou frete grátis; pedido mínimo e validade; ativar/desativar/excluir.
- **Clientes**: consolidados automaticamente por e-mail/telefone.
- **Catálogo**: exportação/importação JSON completa (backup).

## API

### Pública

- `GET /api/health` — status e recursos ativos
- `GET /api/catalog` — catálogo sanitizado (sem cupons, sem segredos)
- `POST /api/shipping/quote` — cotação de frete `{cep, items}` → opções com preço/prazo
- `POST /api/coupons/validate` — pré-validação de cupom
- `POST /api/orders` — criação de pedido (preços/frete/desconto recalculados no servidor)
- `POST /api/orders/status` — acompanhamento (`orderId` + `checkoutToken`)
- `POST /api/payments/checkout` — inicia Checkout Pro
- `POST /api/webhooks/mercadopago` — webhook assinado

### Admin (sessão autenticada + CSRF + RBAC)

- `GET/PATCH /api/admin/orders[/:id]` — listagem e status
- `PATCH /api/admin/orders/:id/shipping` — cotação manual de frete
- `PATCH /api/admin/orders/:id/tracking` — código de rastreio
- `GET/PATCH /api/admin/products[/:id]` — editor de produtos
- `GET/PUT /api/admin/coupons` — cupons
- `GET /api/admin/customers` — clientes
- `PUT /api/admin/catalog` — catálogo completo

## Status do pedido

`received` → `awaiting_payment` → `paid` → `preparing` → `ready` → `completed`, com estados de exceção: `payment_failed`, `payment_expired`, `payment_review`, `refunded`, `chargeback`, `cancelled` (manual ou expiração automática).

## Segurança

- O navegador **nunca define preços, frete ou desconto** — o servidor recalcula tudo do catálogo persistido; campos injetados (ex.: `shipping.resolved`) são descartados.
- `checkoutToken` de 192 bits por pedido, comparado em tempo constante; criação idempotente por `clientOrderId`; baixa de estoque idempotente (`inventoryCommittedAt`).
- Webhook Mercado Pago: valida assinatura, consulta o pagamento na API e confere valor/moeda/preferência antes de qualquer mudança.
- Pedido com bebida alcoólica exige confirmação de maioridade **no servidor** (Lei nº 13.106/2015).
- CSP estrita, rate limiting por rota, headers de segurança, credenciais só em variáveis de ambiente.
- Detalhes em `SECURITY.md`.

## Conformidade

- Verificação de idade 18+ na entrada + aviso legal no rodapé (Lei 13.106/2015).
- Política de privacidade (LGPD), termos de uso e trocas/devoluções (CDC art. 49) publicados na loja.
- Cadastre o CNPJ no campo `taxId` do catálogo (Decreto 7.962/2013).

## Verificação

```bash
npm run admin:check-default    # valida a credencial inicial sem imprimi-la
npm run verify:v11.1.6         # suíte independente + sintaxe + segurança + auditoria do pacote
npm test                       # suíte total; HTTP exige dependências instaladas
npm run test:browser           # loja em Chromium, 18 larguras
npm run test:browser:admin     # login/Admin em Chromium, 18 larguras
npm run test:production        # build + smoke HTTP + navegador sobre o dist
```

## Banco e migrations

As migrations versionadas estão em `migrations/`. Antes de alterar um banco real, faça backup. Para aplicar:

```bash
npm run db:migrate
```

O runner usa advisory lock e checksum: uma migration já aplicada não pode ser alterada silenciosamente.

## Validação técnica

```bash
npm run admin:check-default      # confirma a credencial inicial local sem imprimi-la
npm run verify:v11.1.6          # sintaxe + suíte expert/independente + segurança + auditoria do pacote
npm test                        # suíte total; exige dependências para os testes HTTP
npm run test:browser            # loja em Chromium, 18 larguras
npm run test:browser:admin      # Admin/login/logout em Chromium, 18 larguras
npm run build:production        # staging determinístico em dist/ + manifesto SHA-256
npm run test:production:http    # serve os assets de dist/ e verifica rotas/hashes por HTTP
```

O gate `npm run verify` permanece como atalho amplo. Em CI com dependências instaladas, execute também `npm run test:http`, `npm run test:smoke` e, quando a política do navegador permitir loopback, `npm run test:browser:production:http`.

A revisão atual está documentada em `ALTERACOES-V11.1.6.md`, `AUDITORIA-EXPERT-V11.1.6.md` e nas evidências em `docs/evidencias-v11.1.6/`. Os relatórios anteriores permanecem no pacote como histórico técnico.

## Deploy (Render)

`render.yaml` provisiona web service + PostgreSQL. Preencha no painel: `PUBLIC_URL`, credenciais do Mercado Pago, dos Correios, da Jadlog e do SMTP. Blueprint de teste gratuito: `render-free-test.yaml`.

## Antes de vender de verdade (checklist)

- [ ] PostgreSQL ativo e `NODE_ENV=production`
- [ ] `PUBLIC_URL` HTTPS configurada
- [ ] Credenciais Correios preenchidas e cotação testada com CEPs reais
- [ ] (Opcional) Token Jadlog para pedidos acima de 12 unidades
- [ ] SMTP configurado e e-mail de confirmação testado
- [ ] Access Token + Webhook Secret do Mercado Pago; webhook configurado; compra de teste aprovada
- [ ] CNPJ no catálogo; preços, estoques e descrições revisados
- [ ] Caixas com colmeia divisória para garrafas (exigência das transportadoras)
- [ ] `npm run verify:v11.1.6`, `npm test` e `npm run build:production` aprovados no CI/deploy

## Documentação de referência

- `docs/correios-manual-integracao-v2.4.pdf` — manual oficial Correios API (token, preço, prazo, rastro)
- `docs/correios-api-busca-cep.txt` — manual da API Busca CEP
- `docs/correios-api-locker.pdf` — API Locker (não utilizada; referência futura)
- `docs/ANALISE-TECNICA.md` — análise técnica do projeto
- Manual Jadlog: https://www.jadlog.com.br/jadlog/arquivos/api_integracao.pdf
- Mercado Pago: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/payment-notifications

## Novidades v11.1.6

A v11.1.6 é uma auditoria expert de pré-produção. Ela endurece fluxos que não aparecem em um teste visual comum: confirmação de pagamento depois de reserva expirada, idempotência concorrente do mesmo pedido, sobrescrita de estoque por edição administrativa obsoleta, tombstones de produtos/variações, frete com peso ou geometria incompatíveis e validação server-side de promoções.

O estoque passa a ser recomprometido transacionalmente quando um pagamento tardio precisa ser aceito; se não houver unidades reais, a transição financeira é recusada. No PostgreSQL, retries do mesmo `clientOrderId` são serializados por advisory lock antes de tocar no catálogo. O Admin usa revisões SHA-256 do catálogo/produto para rejeitar gravações obsoletas em vez de restaurar estoque antigo silenciosamente.

O frete automático agora falha de forma segura quando faltam dimensões reais, o peso excede o limite ou a geometria dos avulsos não cabe fisicamente no volume permitido. Promoções importadas são validadas no backend: preço promocional exige produto, combos exigem pelo menos dois produtos distintos, datas inválidas/invertidas são recusadas e controles do Admin refletem apenas regras efetivamente suportadas pelo motor.

Produtos/variações arquivados continuam preservados internamente quando necessários para liberar/confirmar reservas antigas, mas não reaparecem na vitrine, avaliações, alertas, SEO ou sitemap. A suíte `tests/v11.1.6-expert.test.js` cobre concorrência, estoque, frete, promoções, idempotência, SEO e contratos de segurança adicionais.

## Novidades v11.1.5

A v11.1.5 é uma nova revisão de coerência sobre a v11.1.4. Os modais de **Privacidade/Termos/Trocas** e de **acompanhamento do pedido** agora usam o mesmo modelo de exclusividade das demais camadas da loja: backdrop próprio, foco controlado e bloqueio de rolagem sincronizado. Isso evita combinações em que uma camada era fechada e o `body` voltava a rolar enquanto outro diálogo ainda estava ativo.

Os textos legais passaram a usar sanitização multilinha. Antes, a normalização removia também `\n`, fazendo política de privacidade, termos e regras de troca perderem parágrafos no catálogo público/fallback embutido. A nova sanitização preserva quebras de linha legítimas e continua removendo controles invisíveis perigosos.

Os gates de manutenção também foram fortalecidos: o smoke HTTP deriva o marcador de build diretamente do `package.json`, scripts de evidência apontam para a revisão corrente e os testes de regressão verificam o comportamento das camadas sem duplicar diagnósticos.

## Novidades v11.1.4

A v11.1.4 é uma revisão de coerência e estabilidade sobre a v11.1.3. As camadas da loja agora são coordenadas: produto, sacola, conta do cliente e acompanhamento de pedido não permanecem empilhados de forma concorrente. O bloqueio de rolagem e a restauração de foco acompanham a camada realmente ativa, evitando tela aparentemente travada ou foco preso atrás de outro modal.

O fluxo de **Favoritos** também foi corrigido para visitantes: se o cliente tocar no coração sem estar autenticado, o produto pretendido é lembrado e salvo automaticamente depois que o código de acesso for validado. Antes, o login podia abrir por cima do produto e a intenção do favorito era perdida.

A busca ganhou comportamento completo por teclado e semântica de combobox: `↑`/`↓` percorrem sugestões, `Esc` fecha e devolve o foco, clique fora fecha a lista e `aria-activedescendant` acompanha a opção ativa. Isso elimina sugestões visuais que antes não tinham navegação equivalente por teclado.

A ferramenta `tools/audit_products.py` agora funciona também **no ZIP entregue**, mesmo sem os PDFs-fonte opcionais. Nesse modo ela audita IDs, slugs, imagens, vínculos de variação, caixas, disponibilidade/preço e registra códigos comerciais compartilhados sem tratá-los incorretamente como IDs técnicos duplicados. A auditoria completa contra PDFs continua disponível quando as fontes e dependências Python opcionais forem fornecidas.

Por fim, scripts de validação e documentação foram sincronizados com a arquitetura atual em popup. O smoke de produção não exige mais o layout antigo de detalhes abaixo do catálogo, que era uma regra histórica da v11.1.1 e gerava falso negativo em uma versão correta.

## Novidades v11.1.3

A v11.1.3 refina a experiência de navegação sem retirar nenhuma função da v11.1.2. O popup do produto não usa mais desfoque no fundo, ganhou escurecimento muito leve e se tornou o próprio contêiner de rolagem. A roda do mouse sobre a área externa do popup também é encaminhada para o produto, evitando a sensação de tela travada.

As imagens dos cards passaram para quadro **quadrado e sem borda**. Para não cortar a foto original, a imagem principal usa `object-fit: contain`; o espaço restante é preenchido por uma segunda camada da própria foto com `cover` e baixa opacidade. Assim o quadro fica completo sem recortar o produto principal.

Produtos com duas ou mais fotos agora possuem **carrossel direto no card**, sem precisar abrir o produto, com setas, teclado e gesto horizontal. O mesmo carrossel existe no popup e continua sincronizado com a foto vinculada à variação.

No Admin, foram removidas rolagens internas desnecessárias do editor visual. A prévia permanece fixa quando útil, e a roda do mouse sobre o `iframe` continua rolando naturalmente o painel administrativo; `Shift + roda` preserva a rolagem dentro da prévia. A seleção de múltiplas fotos e o vínculo foto-variação permanecem validados.

## Novidades v11.1.2

A v11.1.2 altera a experiência de produto conforme o uso real da loja: ao selecionar um card, o produto abre em **popup central** sem deslocar a página. O popup usa fundo protegido, foco acessível, fechamento por botão/clique fora/Escape, rolagem interna e layout responsivo.

O Admin corrige a seleção de **duas ou mais fotos de uma vez**: o `FileList` agora é copiado antes da limpeza do campo, evitando que a seleção desapareça em alguns navegadores. A galeria continua com até 12 fotos e cada variação pode apontar para sua imagem correspondente.

O catálogo deixou de despejar todos os produtos na tela: são exibidos **12 por vez** e os próximos só aparecem após ação explícita em **Ver mais produtos**. Busca, filtros, ordenação e troca de departamento voltam a mostrar a primeira janela de 12 itens.

## Novidades v11.1.1

A v11.1.1 é a revisão auditada da v11.1.0. Ela troca o modal legado por um único bloco de detalhes no fluxo normal abaixo do catálogo, elimina overflow em telas estreitas, torna IDs de variação globalmente únicos, endurece autenticação/CSRF/cache, normaliza dados persistidos antigos, corrige resposta assíncrona residual ao fechar produto, otimiza o fundo principal e adiciona build e regressões de navegador reproduzíveis.

A v11.1.0 continua sendo a versão funcional que introduziu URLs/SEO individuais por produto, busca e filtros avançados, promoções automáticas, barra de frete grátis, conta do cliente sem senha, histórico com recompra, avaliações verificadas, reserva de estoque durante o pagamento e alertas de reposição. Consulte `RECURSOS-V11.1.0.md` para as regras desses recursos e `AUDITORIA-FORENSE-V11.1.1.md` para o estado validado atual.
