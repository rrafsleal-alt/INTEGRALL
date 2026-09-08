# INTEGRALL — revisão visual premium — 08/09/2026

Base interna: **v11.1.8**.

## Alterações aplicadas

### Home / cabeçalho / hero
- Cabeçalho transparente sobre a mídia, com fundo vinho-preto translúcido ao rolar.
- Marca **INTEGRALL** centralizada de forma independente dos menus.
- Navegação distribuída em dois grupos: categorias à esquerda e institucional/loja à direita.
- Controles de conta, busca, sacola e menu preservados, com adaptação responsiva.
- Hero em tela cheia com linguagem editorial/cinematográfica.
- Slider com quatro destaques: Vinhos, Cafés, Sucos e Gourmet.
- Setas laterais, indicadores de posição, rotação automática e suporte a `prefers-reduced-motion`.
- CTA central inferior com destino contextual por slide.
- Vídeo original preservado no slide de Vinhos e imagens existentes do pacote reutilizadas nos demais slides.

### Detalhe de produtos de vinho
- Breadcrumb e título editorial centralizado.
- Galeria premium com miniaturas verticais no desktop e faixa horizontal no mobile.
- Ficha rápida lateral com Tipo, Varietal, Produtor, Terroir e País, conforme dados cadastrados.
- Bloco de compra refinado com preço em destaque, seletor de quantidade e botão **Comprar**.
- Selo de safra exibido somente quando houver safra cadastrada.
- Barra fixa de compra para vinhos, responsiva.
- Nova seção **Características** com ícones lineares e grade responsiva.
- Campos técnicos exibidos apenas quando houver dados reais no catálogo. Não são inventadas informações ausentes.
- Quando a descrição já contém informações estruturáveis, são aproveitados trechos pertinentes para Harmonização, Paladar e Olfato.

### Preservação funcional
- Catálogo preservado com **227 produtos visíveis**.
- Paginação preservada em **12 produtos por página**.
- Filtros, pesquisa, carrinho, conta, checkout, frete, promoções, variações e painel permanecem ligados às rotinas existentes.
- Produtos sem preço continuam sob consulta e não podem ser comprados como preço zero.
- `public/` e `dist/public/` foram sincronizados no build final.

## Validação executada
- `npm run check`: aprovado — 96 arquivos JavaScript.
- `npm run test:dependency-free`: aprovado — 345/345 testes.
- `npm run build:offline`: aprovado — lint, security scan, audit, media verify, 345/345 testes offline, build de produção e 452 hashes do build conferidos.
- Regressão de paginação em navegador: **56/56 verificações aprovadas**, incluindo 227 produtos, 12 por página e larguras de 280 a 2560 px.
- Regressão visual/controlada do cabeçalho e hero aprovada em 320 px, 390 px e 1440 px, sem erros JavaScript nos casos executados.
- Prévia específica do detalhe de vinho aprovada em desktop e mobile: 5 fatos rápidos, 10 características disponíveis, barra fixa de compra e 227 produtos carregados.

## Limite da validação deste pacote
O build final foi gerado no perfil **offline**, pois as dependências HTTP (`express`, `mercadopago`, `pg`) não estavam instaladas no ambiente de trabalho. Portanto, integrações externas e a suíte HTTP completa não foram re-homologadas nesta execução. As alterações desta revisão estão concentradas no frontend e o conjunto de testes offline/regressões de catálogo foi integralmente aprovado.
