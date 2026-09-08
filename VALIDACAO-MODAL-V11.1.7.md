# Validação do modal — INTEGRALL v11.1.7

Correção validada em 03/09/2026.

- 196/196 testes offline aprovados.
- Regressão de navegador aprovada em 18 larguras, de 280 px a 2560 px.
- Build de produção aprovado e manifesto SHA-256 verificado.
- Smoke HTTP de produção aprovado em 8 cenários.
- Regressão de navegador do build de produção aprovada em 18 larguras.
- Teste adicional com rolagem no topo, meio e fim da página confirmou que o modal permanece centralizado e não altera `window.scrollY` ao abrir, trocar a variação ou fechar.
- Troca de variação mantém `#productDetails` e `#overlay` abertos e preserva o produto ativo.

Comportamento esperado: produto sempre no centro da viewport; interações internas não fecham a janela; fechamento apenas por botão Fechar, Esc ou clique real no backdrop.
