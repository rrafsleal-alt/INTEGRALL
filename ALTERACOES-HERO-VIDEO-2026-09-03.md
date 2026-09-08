# Alterações entregues — Hero + vídeo (2026-09-03)

## O que foi alterado

1. **Vídeo em looping no hero da home**
   - O hero principal agora usa o arquivo `integrall-hero-loop.mp4`.
   - Reprodução automática com `autoplay`, `muted`, `loop` e `playsinline`.
   - Mantida imagem de fallback `integrall-hero-cover.webp` via `poster`/background.

2. **Correção do recorte amador entre hero e próxima seção**
   - Adicionado fade de transição do hero para a seção seguinte.
   - Reposicionado o indicador "Descubra".
   - Criada uma separação visual mais elegante antes de "Nosso propósito".
   - Ajustado o enquadramento da imagem da seção seguinte para evitar o corte brusco no topo.

3. **Arquivos atualizados**
   - `public/index.html`
   - `public/css/premium-v104.css`
   - `public/assets/brand/integrall-hero-loop.mp4`
   - `dist/public/index.html`
   - `dist/public/css/premium-v104.css`
   - `dist/public/assets/brand/integrall-hero-loop.mp4`

## Observação

A implementação foi feita já com o vídeo enviado incorporado no projeto.
Se desejar, em uma próxima etapa posso adaptar também o **painel admin** para permitir trocar esse vídeo diretamente pelo painel.

## Ajuste adicional — transição e velocidade
- Removido o filete/ornamento horizontal que marcava a divisão entre o hero e a seção "Nosso propósito".
- A transição agora é feita somente por um fade escuro progressivo, sem linha visível.
- O início da imagem da seção seguinte também recebe um fade para eliminar qualquer corte reto.
- Vídeo do hero configurado para reprodução em **1,35x**.
