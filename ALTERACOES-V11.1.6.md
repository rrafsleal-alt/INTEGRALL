# ALTERAÇÕES — INTEGRALL v11.1.6

## Objetivo
Endurecimento expert pré-produção sobre a v11.1.5, sem redesign e sem remoção de funcionalidades existentes.

## Principais mudanças
- estoque e pagamento tardio transacionais;
- idempotência forte de criação de pedido, inclusive sob concorrência PostgreSQL;
- locks/revisões otimistas contra sobrescrita por Admin em múltiplas abas;
- exclusão lógica de produtos/variações com preservação de reservas históricas;
- frete fail-safe sem dimensões fictícias, peso truncado ou geometria impossível;
- correção do rateio de promoções de combo por quantidade/variação real;
- validação server-side rígida de promoções importadas;
- proteção de catálogo contra produto/variação ativa sem preço/nome válido;
- quantidade mínima alinhada entre popup, carrinho e backend;
- endurecimento de e-mail, conta do cliente, alerta de reposição e URLs de produção;
- exclusão consistente de tombstones de SEO/sitemap/reviews/alertas/reorder;
- testes expert, fuzz e concorrência adicionados;
- versão/cache-busting/documentação atualizados para 11.1.6.

Consulte `AUDITORIA-EXPERT-V11.1.6.md` e `TESTES-V11.1.6.md` para causas, evidências e limitações.
