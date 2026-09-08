# Índice de evidências da revisão
`inventario/`: árvore/hashes da entrada e comparação de configuração original.
`antes/`: captura original real em 1440 px, em fixture de navegador.
`produtos-reais/`: 18 larguras, imagens reais sem alterar bytes, JSON e screenshots.
`fixture/`: 29 cenários de loja, dados controlados e estados extremos.
`admin-controladores/`: 13 cenários; UI real + ponte HTTP para controladores reais.
`admin-fixture/`: 18 larguras do editor, API de dados simulada.
`galeria/`: seleção múltipla, previews e conteúdo salvo; XHR/API simulados.
`hero/`: 10 casos da home, vídeo e conta, com mídias reais.
`experimento-css-zoom/`: resultados REPROVADOS preservados do experimento não nativo.
`execucoes/`: saídas de comandos, redigindo somente caminhos privados do ambiente.

Capturas não são edição artística nem representação de um deploy validado. A rede
HTTP do Chromium estava bloqueada; HTML/CSS/JS foram carregados em about:blank.
O relatório principal define o alcance exato de cada grupo. O cookie jar da ponte
não é o mecanismo de cookies do Chromium. Os dados de teste não foram gravados no
catálogo operacional. Consulte o relatório externo de reteste pelo hash do ZIP.
