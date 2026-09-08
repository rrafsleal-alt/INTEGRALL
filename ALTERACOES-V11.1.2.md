# INTEGRALL v11.1.2 — Popup de produto, galeria e catálogo progressivo

## O que mudou

- O detalhe do produto deixou de ocupar espaço abaixo do catálogo e agora abre em um popup central, com fundo bloqueado, foco controlado e fechamento por botão, clique no fundo ou tecla Escape.
- Abrir um produto não executa `scrollIntoView` e não altera a posição vertical do catálogo.
- Em desktop, o popup usa galeria + informações lado a lado; em telas menores passa para uma coluna com rolagem interna.
- A galeria administrativa agora copia a seleção múltipla antes de limpar o `<input type=file>`, corrigindo o caso em que duas ou mais fotos desapareciam da seleção em alguns navegadores.
- A galeria continua aceitando até 12 fotos por produto e as variações podem apontar para qualquer uma dessas fotos.
- O catálogo mostra inicialmente 12 produtos. Mais itens só aparecem quando o visitante clicar em **Ver mais produtos**. Busca, filtros, ordenação e troca de departamento reiniciam a janela para 12 itens.

## Compatibilidade

Os dados existentes, URLs `/produto/<slug>`, carrinho, promoções, avaliações, conta, estoque e fotos por variação foram preservados.
