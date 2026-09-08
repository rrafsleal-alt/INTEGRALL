# ALTERAÇÕES — INTEGRALL v11.1.4

Data: 02/09/2026

## Objetivo

Revisão de coerência sobre a v11.1.3, procurando comportamentos que tecnicamente existiam, mas não funcionavam de forma natural, artefatos de validação obsoletos e ferramentas que não conseguiam ser executadas no próprio pacote entregue.

## Correções aplicadas

### 1. Coordenação das camadas da loja

Produto, sacola, conta do cliente e acompanhamento de pedido não permanecem mais abertos uns sobre os outros de forma concorrente. Ao abrir uma camada de primeiro plano, a incompatível anterior é fechada de forma controlada.

Impactos:
- evita foco preso em modal que ficou atrás de outro;
- evita `body` destravado enquanto ainda existe uma camada aberta;
- evita sensação de tela travada depois de fechar conta/status;
- restaura o foco ao controle apropriado ao fechar a camada.

### 2. Favorito solicitado antes do login

Quando um visitante tenta favoritar um produto, o ID pretendido é preservado durante o login por código. Depois da autenticação o favorito é aplicado automaticamente, em vez de a ação simplesmente desaparecer.

### 3. Busca inteligente por teclado

A busca passou a se comportar como combobox acessível:
- `ArrowDown` e `ArrowUp` percorrem sugestões;
- `Escape` fecha a lista e devolve foco à busca;
- clique fora fecha sugestões;
- `aria-expanded`, `aria-selected` e `aria-activedescendant` acompanham o estado real.

### 4. Auditoria de catálogo utilizável no ZIP

`tools/audit_products.py` antes exigia PDFs em `catalogos-fonte/`, ausentes no pacote distribuído. Agora possui dois modos:
- modo pacote: funciona apenas com `data/catalog.json` e assets entregues;
- modo fonte: mantém a conferência completa com PDFs quando fontes e dependências opcionais existem.

O modo pacote verifica IDs, slugs, imagens, fotos por variação, referências de caixas, disponibilidade e preço sem inventar uma prova contra PDFs ausentes.

### 5. Smoke de produção sincronizado com o produto atual

O smoke antigo ainda exigia a arquitetura histórica da v11.1.1, em que detalhes ficavam abaixo do catálogo. Ele foi atualizado para validar o popup atual: posição fixa, viewport, overlay, bloqueio do fundo e ausência de duplicação.

### 6. Testes históricos sem versão rígida

Testes introduzidos nas v11.1.2 e v11.1.3 validavam literalmente `11.1.3` no HTML/cache-busting. Na primeira execução da v11.1.4 isso gerou quatro falsos negativos. Agora eles validam a versão corrente do `package.json`, preservando a finalidade do teste sem impedir upgrades legítimos.

### 7. Documentação e cache-busting

`README.md`, `LEIA-ME-PRIMEIRO.txt`, páginas públicas, scripts e comandos de verificação foram sincronizados com a v11.1.4.

## Dados deliberadamente não alterados

Os SKUs `331`, `332` e `333` aparecem em mais de um produto. A investigação no texto extraído do catálogo-fonte confirmou reutilização dos mesmos códigos em apresentações/volumes diferentes. Esses SKUs foram mantidos; os identificadores técnicos únicos continuam sendo `product.id`, `product.slug` e `variant.id`.

## Observação sobre fotos por variação

A função permanece validada, inclusive upload múltiplo no Admin e troca de imagem na loja. O catálogo entregue, porém, ainda possui zero variações com foto específica preenchida. Isso é estado dos dados, não falha da funcionalidade: as fotos precisam ser cadastradas e vinculadas aos produtos reais pelo Admin.
