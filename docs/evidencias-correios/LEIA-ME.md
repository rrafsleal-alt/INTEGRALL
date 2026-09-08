# Evidências desta revisão

Leia TESTES-CORREIOS.md na raiz. As imagens são capturas do HTML/CSS/JS reais em páginas isoladas, com dados de teste identificados. As cotações usam provedor simulado; não são resposta ao vivo de um contrato real. A ponte de backend usa módulos reais e repositório temporário; não comprova Express, cookies nativos ou TLS.

`checkout`: 25 cenários, oito larguras e fechamento do pedido.
`admin-caixas`: quatro larguras, cadastro/reabertura com API simulada.
`admin-controladores`: 13 cenários, 63 requisições em controladores reais por ponte.
`loja`: 29 cenários, 18 larguras.
`integridade-dados.json`: 445 arquivos de dados/assets/backups mais lockfile idênticos à entrada (446 no total).

Capturas não contêm código de acesso ou token real. Valores da fixture não são preços comerciais permanentes.
