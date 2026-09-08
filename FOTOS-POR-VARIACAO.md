# Fotos por variação

Funcionalidade adicionada ao projeto INTEGRALL v11.0.4.

## Como usar no Admin

1. Abra um produto para editar.
2. Em **Galeria do produto**, adicione duas ou mais fotos (limite: 12).
3. Em **Variações**, cada variação possui o campo **Foto da variação**.
4. Escolha qual foto da galeria corresponde àquela variação.
5. Salve o produto.

A opção **Usar foto de capa** mantém a variação vinculada dinamicamente à primeira foto da galeria.

## Comportamento na loja

- Ao abrir um produto, a primeira variação disponível já mostra sua foto vinculada, quando configurada.
- Ao trocar a variação, a galeria muda automaticamente para a foto correspondente.
- O cliente continua podendo navegar manualmente por todas as miniaturas da galeria.
- O carrinho usa a foto da variação selecionada.

## Integridade

- A foto vinculada a uma variação precisa pertencer à galeria do próprio produto.
- Se uma foto for removida da galeria, vínculos inválidos são descartados na normalização do catálogo.
- Mídias ainda referenciadas por variações são reconhecidas pelo backend como em uso.
- URLs de imagem continuam passando pela sanitização existente do catálogo.

## Validação executada

- `npm run check`: aprovado (49 arquivos JavaScript).
- Testes de catálogo + fotos por variação: 32/32 aprovados.
