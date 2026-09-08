# INTEGRALL — Paginação numerada e cards uniformes

**Revisão PAGINACAO-R1 — 07/09/2026.** Base: VISIBILIDADE-R1, que já contém HTTP-R1 e a integração de cotação dos Correios. A versão interna permanece **11.1.8**, sem alteração de dependências.

## Resultado solicitado — opção B

O catálogo continua contendo **227 produtos, nenhum marcado como oculto**. A interface agora mostra **até 12 produtos por página**, com números, **Anterior** e **Próxima**, em vez de renderizar todos simultaneamente ou acrescentar mais itens à mesma página.

| Seção | Produtos | Páginas | Última página |
|---|---:|---:|---:|
| Vitrine completa | 227 | 19 | 11 produtos |
| Vinhos | 129 | 11 | 9 produtos |
| Gourmet / Petit Four | 82 | 7 | 10 produtos |
| Cafés | 7 | 1 | 7 produtos |
| Sucos | 9 | 1 | 9 produtos |

Nas seções com uma página não aparecem botões de navegação desnecessários. Para listas maiores, os números usam uma janela compacta com primeira/última página e reticências. O contador informa intervalo, total e página, por exemplo: **Mostrando 1–12 de 82 produtos • Página 1 de 7**.

Busca, categoria, ordenação e filtros avançados trabalham sobre o catálogo completo e retornam à página 1 quando o critério muda. Atualizações de produtos, promoções e configurações mantêm a página atual quando possível. Se o catálogo diminuir, a página é limitada à última existente, sem criar uma tela vazia. Fechar os detalhes não reinicia a paginação.

A navegação utiliza botões com rótulos acessíveis, marcação de página atual e alvos de pelo menos 44 pixels. Voltar/Avançar do navegador usam estados públicos de página/filtros. A aplicação controla a rolagem para evitar que o navegador restaure uma posição antiga sobre a nova lista. Nenhum dado de checkout ou credencial é acrescentado a esse estado. Os números não criam um novo formato de URL pública.

## Imagens e alinhamento

A causa visual era a combinação de fotos de proporções diferentes com `contain`, que deixava faixas nas imagens horizontais. Os cards agora têm quadros quadrados iguais e não permitem que o tamanho natural da imagem encolha o quadro. As alturas dos cards e os espaços dos títulos/preços são padronizados, sem cortar os nomes com reticências.

**No Gourmet**, a foto preenche o quadrado com recorte central de enquadramento (`cover`): pode haver recorte nas bordas da cena, mas não esticamento. **Para vinhos, sucos e cafés**, as artes de garrafas/embalagens continuam inteiras (`contain`), dentro do mesmo quadro quadrado, sem cortar rótulos para forçar um preenchimento. A galeria de detalhes continua mostrando a imagem inteira.

**Nenhum arquivo de imagem foi editado, gerado novamente ou substituído.** As fotos originais, preços, estoques, variações e embalagens permanecem preservados. Os 222 itens sem preço continuam como **Preço sob consulta**, com compra online bloqueada. Os botões dos cards também ficam disponíveis no celular.

## Atualizar uma instalação existente com segurança

1. Pare o servidor e faça backup completo da instalação e, quando utilizado, do banco de dados.
2. Extraia este ZIP em uma **pasta nova**. Preserve as configurações privadas (`.env` e variáveis do ambiente), o diretório operacional `data/local-state` inteiro, uploads e qualquer diretório personalizado indicado na configuração. Não substitua pedidos existentes pelo catálogo-base desta entrega. Quem usa PostgreSQL deve continuar apontando para o banco existente, com backup feito.
3. Na pasta que contém `package.json`, instale as dependências e execute a validação completa:

```sh
npm ci
npm run verify
```

Inicie pelo procedimento já usado na sua instalação. **Não use um `dist` antigo.** O comando de validação completa recria o build se as dependências e todos os testes estiverem aprovados. Credenciais dos Correios não precisam ser enviadas para aplicar esta revisão.

Para testar somente as regras de paginação, sem dependências HTTP:

```sh
npm run test:pagination
npm run test:dependency-free
```

Para os testes de navegador, em ambiente com Python, Playwright e Chromium:

```sh
npm run test:browser:pagination
```

O teste registra resultados e capturas em `docs/evidencias-paginacao`. Ele utiliza uma página isolada com o HTML, CSS, JavaScript e imagens reais, não o servidor Express completo.

**Não execute novamente `catalog:show-all` apenas para ativar a paginação.** Paginar não muda a visibilidade cadastrada. Esse comando continua disponível exclusivamente para desocultar um estado operacional antigo, conforme o guia de visibilidade.

As referências aos arquivos CSS/JS receberam `rev=paginacao-r1`. Depois da atualização, uma recarga forçada do navegador pode ajudar a descartar a aba antiga.

## Testes e limites desta entrega

A matriz está em `TESTES-PAGINACAO-R1.md`, e as capturas reais em `docs/evidencias-paginacao`. Nesta revisão não foram alterados os módulos de backend, autenticação, pagamento ou transportadoras.

O build disponibilizado permanece identificado como **offline**. A tentativa de instalação limpa não terminou com sucesso no ambiente de preparação: o registro npm não resolveu por DNS e o npm encerrou com erro interno. A validação completa falhou ao importar Express ausente/incompleto. Isso não é aprovação da operação em produção; execute `npm run verify` com as dependências instaladas e homologue o ambiente real antes da apresentação comercial.
