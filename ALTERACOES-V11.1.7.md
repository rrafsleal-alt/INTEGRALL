# INTEGRALL v11.1.7 — Correção do modal de produto

## Corrigido
- O modal `#productDetails` foi removido de dentro de `#catalogPage` e colocado no nível de camadas do `#catalogSurface`, eliminando interferência de `transform`/animações da página no `position: fixed`.
- O modal agora permanece geometricamente centralizado na viewport durante toda a animação de abertura.
- O foco automático do gerenciador de camadas usa `preventScroll: true` e o foco duplicado do modal foi removido.
- A restauração de foco ao fechar também preserva a posição de rolagem.
- O overlay só fecha a camada quando o gesto realmente começa no backdrop (ou em clique sintético explícito), evitando fechamento acidental após interação com `select`, especialmente em touch/mobile.
- Regressão de navegador ampliada para verificar centralização real e permanência do modal após troca de variação.

## Resultado esperado
O produto abre sempre no centro da tela independentemente da posição de rolagem. Alterar variação, quantidade ou demais controles internos não fecha o modal. O fechamento continua disponível pelo botão Fechar, tecla Esc e clique real no backdrop.
