# INTEGRALL v11.1.0 — Comércio, conta e estoque

> Documento funcional da v11.1.0. O hardening e os resultados vigentes estão em `AUDITORIA-FORENSE-V11.1.1.md`; em caso de divergência operacional ou de segurança, prevalece a v11.1.1.

Esta versão integra os recursos solicitados sobre a base v11.0.4, preservando a galeria com múltiplas fotos e foto vinculada por variação.

## 1. URLs próprias e SEO por produto

- Todo produto normalizado recebe `slug` único.
- A loja aceita `/produto/<slug>` e mantém navegação SPA via History API.
- O servidor retorna HTML específico para a URL do produto com `title`, descrição, canonical, Open Graph, Twitter Card e JSON-LD `Product`.
- O JSON-LD informa preço efetivo, disponibilidade e `AggregateRating` quando houver avaliações publicadas.
- `sitemap.xml` inclui produtos ativos/disponíveis em produção.
- O Admin permite editar o slug; vazio = gerado pelo nome.

## 2. Filtros avançados

Na vitrine há filtros combináveis por:

- país;
- tipo;
- uva/variedade;
- origem/região;
- sabor;
- disponibilidade;
- faixa mínima/máxima de preço;
- apenas importados.

As opções são montadas dinamicamente a partir dos produtos visíveis da seção atual.

## 3. Busca inteligente

A busca ganhou:

- sugestões instantâneas com imagem, nome e preço;
- interpretação de faixa de preço (`até 80`, `entre 50 e 100`, `acima de 200`);
- aliases semânticos comuns, como `argentino` → `argentina` e `chileno` → `chile`;
- busca nos principais atributos do produto.

## 4. Promoções automáticas

As regras são salvas no catálogo e recalculadas no servidor. O navegador não define o total final.

Tipos implementados:

- preço promocional agendado;
- desconto percentual por departamento/categoria/produto;
- desconto por quantidade mínima;
- leve X, pague Y;
- desconto na Nª unidade;
- combo/compre junto por conjunto de produtos;
- frete grátis acima de um valor.

Regras podem ter início/fim, selo, escopo por produto/variação e opção de acumular. Entre promoções não acumuláveis, o servidor escolhe a de maior desconto; promoções marcadas como acumuláveis são somadas, sempre com limite de segurança para impedir total inválido.

O Admin possui uma seção **Promoções automáticas** para criar, ativar/desativar e excluir regras.

## 5. Barra para frete grátis

A sacola mostra quanto falta para atingir o menor limite efetivo de frete grátis. O mesmo limiar é calculado pelo backend ao fechar o pedido.

## 6. Comprar novamente

Na área **Minha conta**, pedidos pagos/em preparação/prontos/concluídos exibem **Comprar novamente**. O servidor verifica o catálogo atual antes de devolver os itens:

- produto ainda existe;
- variação ainda existe;
- produto está disponível;
- quantidade é limitada ao estoque atual.

Preços antigos nunca são reaproveitados; o carrinho usa o preço vigente.

## 7. Conta do cliente sem senha

Login por código de 6 dígitos enviado por e-mail:

- código armazenado como HMAC-SHA-256 com `CUSTOMER_AUTH_SECRET`, e não como hash simples;
- expiração configurável;
- máximo de 5 tentativas por código;
- rate limit nas rotas;
- sessão por token aleatório em cookie `HttpOnly`, `SameSite=Strict` e `Secure` em produção;
- CSRF próprio para operações autenticadas.

A conta oferece:

- nome e telefone;
- até 5 endereços;
- favoritos;
- histórico de pedidos;
- recompra.

Em produção, SMTP precisa estar configurado para o login por código funcionar.

## 8. Avaliações de compra verificada

- Só uma conta autenticada que tenha pedido pago/preparando/pronto/concluído contendo o produto pode avaliá-lo.
- Nota de 1 a 5, título e comentário.
- Nova avaliação entra como `pending`.
- O Admin pode publicar, rejeitar ou devolver para pendente.
- Somente avaliações publicadas aparecem na loja e no SEO.
- O e-mail não é exposto publicamente; o autor é mascarado.

## 9. Reserva de estoque durante pagamento

A criação do pedido reserva o estoque atomicamente no repositório:

1. o catálogo é bloqueado/serializado no PostgreSQL;
2. as unidades são verificadas novamente;
3. o estoque é decrementado como reserva;
4. o pedido recebe `inventoryReservedAt` e `inventoryReservationExpiresAt`;
5. pagamento aprovado confirma a reserva sem nova baixa;
6. cancelamento ou expiração devolve as unidades;
7. um segundo pedido que tente reservar a última unidade recebe `OUT_OF_STOCK`.

O Checkout Mercado Pago recebe data de expiração limitada pela validade da reserva. Depois de uma reserva expirada/liberada, não é possível iniciar pagamento naquele pedido antigo: é necessário criar um pedido novo para reservar novamente.

Configuração:

```env
INVENTORY_RESERVATION_MINUTES=15
```

Permitido: 5 a 120 minutos.

## 10. Alertas de estoque e “Avise-me”

Cada produto pode definir:

- `stockMin` — limite de estoque crítico;
- `restockDate` — previsão de reposição.

O Admin mostra:

- itens críticos;
- itens esgotados;
- quantidade de clientes aguardando reposição;
- atalho para editar o produto.

Quando um item controlado chega a zero, a ficha do produto exibe **Avise-me quando voltar**. A inscrição é deduplicada por produto/variação/e-mail. Ao salvar um produto com estoque reposto, o servidor tenta enviar os avisos por SMTP e marca inscrições notificadas somente quando o envio é aceito.

## Banco de dados

A migration `003_customer_commerce.up.sql` cria:

- `integrall_customer_accounts`;
- `integrall_customer_login_codes`;
- `integrall_customer_sessions`;
- `integrall_reviews`;
- `integrall_restock_subscriptions`.

As migrations são aplicadas automaticamente na inicialização quando PostgreSQL está configurado e também podem ser executadas com:

```bash
npm run db:migrate
```

## Novas variáveis de ambiente

```env
INVENTORY_RESERVATION_MINUTES=15
CUSTOMER_LOGIN_CODE_MINUTES=10
CUSTOMER_SESSION_DAYS=30
CUSTOMER_AUTH_SECRET=gere_um_segredo_aleatorio_de_32_ou_mais_caracteres
```

Para conta e avisos por e-mail em produção, configure também as variáveis SMTP já existentes no projeto.

## Validação

Comandos recomendados:

```bash
npm ci
npm run verify:v11.1.1
```

O pacote não inclui `node_modules`; as dependências são instaladas a partir do `package-lock.json` no ambiente de deploy.
