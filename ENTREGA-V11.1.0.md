# Entrega INTEGRALL v11.1.0

## Recursos entregues

1. **Páginas individuais por produto e SEO**: rota `/produto/<slug>`, canonical, Open Graph, Twitter Cards, JSON-LD Product e sitemap com produtos publicados.
2. **Filtros avançados**: país, tipo, uva, origem, sabor, disponibilidade, importado e faixa de preço, alimentados pelo catálogo.
3. **Busca inteligente**: sugestões com imagem/preço e interpretação de termos como `até 80`, `entre 50 e 100`, país e atributos.
4. **Promoções automáticas**: preço promocional, percentual por categoria/produto, desconto por quantidade, leve X pague Y, desconto na Nª unidade, combos e frete grátis por limiar. O servidor recalcula o pedido e não confia no navegador.
5. **Barra de frete grátis**: progresso no carrinho/checkout usando o mesmo limiar efetivo das promoções.
6. **Comprar novamente**: pedidos elegíveis podem ser recompostos com preço, estoque e variações atuais.
7. **Conta do cliente**: login por código de 6 dígitos via e-mail, sessão HttpOnly, perfil, endereços, favoritos e histórico.
8. **Avaliações verificadas**: só quem possui pedido pago/em processamento/pronto/concluído com o produto pode avaliar; publicação depende de moderação no Admin.
9. **Reserva de estoque**: estoque é reservado atomicamente por 15 minutos na criação do pedido, liberado se expirar/cancelar e confirmado quando o pagamento avança. Uma reserva vencida não pode iniciar pagamento antigo.
10. **Alertas de estoque**: painel de estoque crítico, estoque mínimo e data de reposição, além de “Avise-me quando voltar” com envio por e-mail após reposição.

## Operação de produção

- Execute `npm ci`.
- Configure PostgreSQL e rode `npm run db:migrate` (ou deixe a inicialização segura aplicar migrations conforme a configuração atual do repositório).
- Configure SMTP para login sem senha e notificações de reposição.
- Configure Mercado Pago e transportadoras somente com credenciais reais/sandbox apropriadas.
- Configure `PUBLIC_URL` em produção para URLs canônicas e sitemap.
- A reserva padrão é `INVENTORY_RESERVATION_MINUTES=15`.

## Validação desta entrega

- `npm run verify:v11.1.0`: aprovado.
- Checagem de sintaxe: 53 arquivos JavaScript aprovados.
- Verificador integrado v11.1: 45 testes aprovados, 0 falhas.
- Suíte local que não depende de pacotes/serviços externos: 93 testes aprovados, 0 falhas.
- Scanner de segurança: aprovado.
- Auditoria do catálogo: aprovada, 227 produtos e assets referenciados presentes.

A suíte HTTP/provedores/PostgreSQL que exige dependências instaladas não pôde ser reinstalada neste ambiente de empacotamento porque o registry do npm apresentou falha de DNS (`EAI_AGAIN`). O ZIP não inclui `node_modules`, como deve ser; `package-lock.json` permanece travado para instalação reprodutível com `npm ci` em um ambiente com acesso ao registry.
