# Evidências — INTEGRALL v11.1.1

## `baseline/`

Capturas e métricas da v11.1.0 antes da correção. O produto era aberto como modal `position: fixed`, com `aria-modal`, overlay e bloqueio de rolagem do `body`, inclusive no desktop.

## `pos-correcao/`

Regressão reproduzível da loja e do Admin em Chromium usando o HTML, CSS e JavaScript reais, com dados/API controlados. Foram exercitadas 18 larguras: 280, 320, 360, 375, 390, 412, 430, 480, 600, 768, 820, 1024, 1280, 1366, 1440, 1600, 1920 e 2560 px.

Os JSON registram layout, overflow, troca de produto, foto por variação, foco, Escape, fallback de imagem, login incorreto/correto e logout. As capturas são geradas apenas nas larguras representativas para limitar o tamanho do pacote.

## `conteudo-real/`

Capturas adicionais do catálogo real entregue, em larguras móveis e desktop, mostrando o produto no fluxo da página.

## `build-producao/`

Regressão de navegador executada sobre os arquivos reais gerados em `dist/`, carregados diretamente no Chromium. Não é uma substituição do smoke HTTP do servidor; serve para confirmar que o staging contém HTML/CSS/JS funcionais.

## `build-http/`

Registro do smoke de navegador via loopback HTTP. A política do ambiente bloqueou `127.0.0.1` com `ERR_BLOCKED_BY_ADMINISTRATOR`; portanto, esse cenário está corretamente marcado como **NÃO EXECUTADO**. O smoke HTTP sem navegador foi aprovado separadamente por `npm run test:production:http`.

Nenhuma captura contém a senha administrativa.
