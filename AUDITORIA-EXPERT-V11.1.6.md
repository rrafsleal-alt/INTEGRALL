# AUDITORIA EXPERT — INTEGRALL v11.1.6

Data: 03/09/2026
Base auditada: INTEGRALL v11.1.5
Objetivo: revisão pré-go-live, com ênfase em falhas silenciosas de dinheiro, estoque, concorrência, frete, segurança e integridade de dados.

## Resumo executivo

A v11.1.5 já passava nos testes funcionais e visuais, mas a auditoria expert encontrou condições de corrida e incoerências de negócio que podiam aparecer somente sob retries, pagamentos tardios, duas abas do Admin, reservas expiradas, promoções com variações de preços ou dados incompletos de frete. Esses casos foram tratados na origem e receberam testes de regressão.

Resultado final do código-fonte antes do empacotamento:
- 48/48 testes exclusivos da auditoria expert: APROVADO.
- 196/196 testes dependency-free/offline: APROVADO.
- suíte total: 211 cenários; 196 APROVADOS; 15 NÃO EXECUTADOS/SKIP; 0 falhas.
- loja Chromium: 18/18 larguras, 280–2560 px.
- Admin Chromium: 18/18 larguras; overflow global 0; erros de console 0.
- galeria: 2 arquivos selecionados juntos -> 2 uploads -> 3 imagens persistidas -> foto de variação vinculada.
- build de produção: 297 arquivos; smoke HTTP 8/8; Chromium do dist 18/18.
- npm audit --offline: 0 vulnerabilidades registradas.

## Achados críticos corrigidos

### EXP-P1-001 — pagamento tardio podia deixar pedido pago sem recomprometer estoque
Uma reserva expirada devolve estoque ao catálogo. Em cenários administrativos/legados, uma confirmação posterior de pagamento podia avançar o pedido sem recomprar esse estoque. A transição agora recompromete estoque atomicamente; se não houver unidade disponível, a transição é recusada. Aprovações tardias do provedor após liberação ficam em `payment_review`, preservando o fato financeiro sem fingir estoque disponível.

### EXP-P1-002 — retry idempotente podia falhar como “sem estoque”
O servidor validava estoque antes de reconhecer que um `clientOrderId` já pertencia à mesma tentativa. Como a primeira tentativa já havia reservado a última unidade, um retry legítimo podia falhar. O preflight idempotente foi antecipado e ganhou uma capability separada (`clientOrderKey`). No PostgreSQL, requisições com o mesmo identificador agora são serializadas por advisory lock transacional antes de tocar no catálogo.

### EXP-P1-003 — concorrência do Admin podia sobrescrever estoque/preço atualizado
Salvar uma cópia antiga do catálogo/produto em outra aba podia regravar valores que haviam mudado por venda ou por outro operador. Foram adicionadas revisões SHA-256 otimistas para catálogo, produto e seções administrativas. Gravações obsoletas recebem conflito em vez de sobrescrever silenciosamente dados novos. A reordenação envia apenas IDs e é aplicada sobre o estado fresco.

### EXP-P1-004 — remoção de produto/variação podia destruir âncora de reserva histórica
Exclusões agora são lógicas (tombstones). Produto/variação arquivada desaparece da loja, SEO, sitemap, avaliações e alertas, mas continua disponível internamente para liberar/confirmar reservas antigas de maneira correta.

### EXP-P1-005 — frete automático podia ser subcotado
O empacotador tinha caminhos que usavam dimensão fictícia ou truncavam geometria/peso para caber no limite do provedor. Agora, falta de dimensões, peso real acima do limite ou geometria impossível fazem a cotação automática falhar de forma segura e cair para cotação manual. Nenhum pacote é “encolhido” matematicamente para obter preço.

### EXP-P1-006 — combo percentual podia descontar unidades caras como se fossem baratas
Quando o mesmo produto aparecia em variações com preços diferentes, o rateio podia reutilizar o menor preço além da quantidade real daquela linha. O desconto agora consome quantidades reais por linha/variação e mantém o teto financeiro exato.

### EXP-P1-007 — promoção `sale_price` malformada podia virar preço promocional global
O formulário do Admin já restringia esse caso, mas importações/requests diretos não tinham a mesma garantia. O backend agora exige produto-alvo e preço positivo; combos exigem dois produtos distintos; datas precisam ser válidas/coerentes; IDs duplicados são rejeitados; controles do Admin refletem apenas opções que o motor realmente respeita.

### EXP-P1-008 — frete “a confirmar” podia aparecer publicamente como R$ 0,00
A projeção pública agora preserva `shippingCents: null` para cotação manual, em vez de converter ausência de preço em zero.

## Achados importantes corrigidos

- Quantidade mínima por pedido é refletida já no popup/carrinho, não apenas descoberta no servidor no fim do checkout.
- Cotação pública valida produto, variação, mínimo, máximo e estoque antes de consultar transportadoras.
- Produto/variação ativa sem nome ou com preço comercial inválido é rejeitado na normalização do catálogo; itens indisponíveis/arquivados podem manter preço zero.
- `PUBLIC_URL` de produção exige origem HTTPS limpa.
- Sessões/merge de conta ganharam atualização atômica para evitar perda de alteração concorrente.
- Avisos de reposição usam lock e permitem retry quando SMTP falha.
- Mailboxes/cabeçalhos de e-mail são sanitizados contra injeção por CR/LF.
- Rota SEO `/produto/:slug` escolhe apenas variação ativa e ignora tombstones.
- Rotas secundárias (reviews, avise-me, alertas administrativos, reorder, sitemap) também ignoram produtos arquivados.
- Contato telefônico fornecido no pedido é validado por quantidade razoável de dígitos.
- Revisões por seção protegem personalização, cupons e promoções contra “última aba vence” sem conflitar com alteração de estoque alheia.
- Fallback embutido foi ressincronizado com a versão 11.1.6 e contém somente os produtos atualmente vendáveis; a fonte completa continua em `data/catalog.json` com 227 produtos.

## Segurança

Verificado no pacote de trabalho:
- senha administrativa padrão não aparece em texto puro no runtime, patch ou documentação nova;
- sem `.env`, chave privada ou token real incluído;
- CSRF e autorização de servidor permanecem nos writes administrativos/de cliente;
- cookies administrativos/de cliente continuam HttpOnly e com políticas de SameSite/Secure conforme ambiente;
- CSP, HSTS em HTTPS, no-sniff, referrer-policy e framing protection preservados;
- upload aceita JPEG/PNG/WebP por assinatura e dimensões, remove metadados relevantes e rejeita conteúdo inconsistente;
- CSV mantém proteção contra formula injection;
- respostas públicas de pedido permanecem projetadas sem PII interna.

`DATABASE_SSL_MODE=require` continua suportado por compatibilidade com provedores, mas cifra sem validar certificado; produção deve preferir `verify-full`. O scanner registra esse aviso deliberadamente.

## Dados e catálogo

- Produtos: 227
- Variações: 52
- IDs de produto duplicados: 0
- Slugs duplicados: 0
- IDs de variação duplicados: 0
- Imagens ausentes: 0
- Produtos ativos sem preço: 0
- SKUs 331/332/333 são códigos compartilhados no material-fonte entre apresentações diferentes e não são IDs técnicos únicos; não foram adulterados.
- O catálogo entregue ainda possui 0 vínculos reais “variação -> foto” configurados nos dados. A funcionalidade foi validada em navegador e funciona; o conteúdo precisa ser alimentado no Admin quando houver fotos adicionais por variação.

## Riscos residuais / não executado

1. Instalação limpa online (`npm ci`) — NÃO EXECUTADA com sucesso: acesso ao registry ficou preso/indisponível no ambiente.
2. Instalação limpa offline — NÃO EXECUTADA: cache local não contém `xtend-4.0.2.tgz` (`ENOTCACHED`).
3. 15 testes HTTP que precisam das dependências npm — NÃO EXECUTADOS/SKIP por `ERR_MODULE_NOT_FOUND`; a lista está em `TESTES-V11.1.6.md`.
4. PostgreSQL real, Mercado Pago real, Correios, Jadlog e SMTP — NÃO EXECUTADOS por ausência de credenciais/serviços externos neste ambiente. Regras puras, adapters e contratos possuem testes locais.
5. Firefox, WebKit/Safari, Chrome/Edge nativos — NÃO EXECUTADOS. O motor executado foi Chromium. Não são marcados como aprovados.
6. Rate limiting e deduplicação de e-mail são por processo em alguns pontos; múltiplas instâncias devem usar limitação/dedupe compartilhados na infraestrutura se o tráfego justificar.
7. “Avise-me” é rate-limited e one-shot, mas não possui double opt-in/unsubscribe persistente; recomendável evoluir antes de campanhas em escala.
8. Conferência forense PDF -> catálogo não foi executada porque os PDFs-fonte não fazem parte desta entrega; a auditoria do pacote não inventa essa prova.

## Conclusão

Nenhuma falha P0/P1 conhecida permanece nos cenários reproduzidos localmente. A versão está pronta para o reteste do ZIP final. Limitações externas continuam explicitamente classificadas como NÃO EXECUTADAS.
