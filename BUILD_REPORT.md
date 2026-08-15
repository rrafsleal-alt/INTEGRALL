# Relatório de build — INTEGRALL v9.2

Data: 14 de agosto de 2026.

## Resultado

A versão v9.2 foi preparada para operar como loja online com pedidos persistentes e integração financeira desacoplada. O código do Mercado Pago está pronto, mas nenhuma credencial real foi incluída.

### Implementado

- pedido criado no servidor antes do pagamento;
- validação server-side de produto, variante, quantidade, estoque, preço e frete;
- nome + contato obrigatório;
- endereço completo obrigatório para entrega;
- PostgreSQL com catálogo, pedidos e clientes;
- fallback de memória somente para desenvolvimento;
- acompanhamento de pedido autenticado por `checkoutToken` da sessão;
- histórico de status;
- frete sob cotação editável no Admin;
- recálculo server-side do total após cotação;
- baixa automática e idempotente de estoque na primeira confirmação `paid/preparing/ready/completed`;
- painel de clientes;
- status financeiro de falha, expiração, revisão, reembolso e chargeback;
- Checkout Pro preparado para PIX/cartão;
- tentativa de pagamento com preferência independente;
- webhook assinado + consulta do pagamento + validação de valor/moeda/preferência;
- retorno do Mercado Pago integrado ao acompanhamento do pedido;
- WhatsApp removido do fluxo automático e mantido somente como suporte opcional.

## Validações executadas

`npm run verify` aprovado:

- sintaxe JavaScript: OK;
- testes automatizados: **20/20 aprovados**;
- auditoria estática pública: OK;
- 5 produtos e assets referenciados presentes;
- nenhum segredo de servidor adicionado aos arquivos públicos.

Também foi iniciado um servidor Express real no ambiente de validação e testado:

- `GET /api/health`;
- criação de pedido;
- acompanhamento autenticado do pedido;
- listagem Admin;
- consolidação de cliente;
- alteração de status;
- baixa de estoque uma única vez;
- criação de pedido com entrega/endereço;
- frete sob cotação;
- definição do frete pelo Admin;
- recálculo do total;
- acompanhamento do novo total pelo cliente.

## Não testado com dinheiro real

A chamada real ao Mercado Pago não foi executada porque o pacote não contém Access Token nem Webhook Secret do usuário. A implementação foi mantida atrás dessas variáveis e só fica habilitada quando ambas estiverem configuradas.

## Próxima homologação

1. publicar com PostgreSQL e HTTPS;
2. informar `PUBLIC_URL`;
3. informar Access Token e Webhook Secret;
4. configurar o webhook no Mercado Pago;
5. executar compra de teste PIX/cartão;
6. confirmar `awaiting_payment → paid` por webhook;
7. confirmar baixa de estoque;
8. testar pagamento recusado/expirado e nova tentativa.
