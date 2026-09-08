# INTEGRALL v11.1.5 — ALTERAÇÕES

## Resumo

Nova varredura sobre a v11.1.4, sem redesign e sem remoção de funcionalidades. O foco foi encontrar comportamentos que funcionavam apenas parcialmente ou que poderiam ficar inconsistentes em combinações menos comuns de navegação.

## Correções aplicadas

1. **Camadas legais e acompanhamento de pedido**
   - Privacidade, Termos, Trocas/Devoluções e acompanhamento agora usam backdrop próprio.
   - A abertura fecha de forma coordenada produto, sacola e conta antes de exibir a nova camada.
   - O bloqueio de rolagem do `body` é recalculado conforme a camada realmente ativa.
   - Fechamento por botão, backdrop e `Esc` mantém foco e scroll coerentes.

2. **Textos legais multilinha**
   - A sanitização anterior removia também quebras de linha por tratar `\n` como caractere de controle proibido.
   - Foi criada sanitização específica que preserva `\n`/tabulações úteis, normaliza CRLF e continua removendo controles invisíveis/bidirecionais inseguros.
   - Backend, fallback público e frontend usam a mesma intenção de normalização.

3. **Coerência de build/testes**
   - Smoke HTTP passa a derivar o marcador `public-v<versão>-` do `package.json`.
   - Scripts de evidência foram atualizados para v11.1.5.
   - Teste histórico v11.1.4 foi desacoplado de uma implementação interna antiga.
   - Regressão Chromium ganhou cenário real de produto aberto → Privacidade → fechamento correto, incluindo preservação de parágrafos.
   - Removida duplicação de uma mesma mensagem de falha no relatório de camadas da conta.

## Preservado

- Popup do produto sem deslocar a página.
- Galeria em cards e popup.
- Até 12 fotos por produto e foto por variação.
- Catálogo progressivo de 12 itens.
- Admin/editor visual, carrinho, checkout, conta, promoções, avaliações, reserva de estoque, frete e integrações existentes.
