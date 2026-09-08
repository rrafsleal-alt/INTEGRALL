# IMAGE_MIGRATION

## Estado encontrado

O projeto antigo aceitava imagens como Data URL/base64 e também continha referências externas/locais. A nova experiência administrativa utiliza upload de arquivo.

## Estratégia implementada

- Novos uploads usam `multipart/form-data`.
- Toda imagem passa pela mesma validação binária, independentemente da origem.
- O campo administrativo de imagem passa a receber a URL interna retornada pelo storage, não uma URL digitada pelo usuário.
- URLs antigas seguras continuam legíveis temporariamente para não quebrar catálogo existente.
- Data URL legada permanece aceita apenas no endpoint de compatibilidade/migração e é validada como se fosse upload normal.

## Metadados persistidos

- `storage_key`;
- MIME;
- tamanho;
- largura/altura;
- alt text;
- checksum SHA-256;
- usuário que enviou;
- finalidade;
- estado de processamento;
- timestamps.

## Limpeza

A API impede remover uma mídia ainda referenciada por produto ou asset visual. A interface marca uploads não utilizados e tenta limpá-los quando uma edição é cancelada/substituída.

## Próxima evolução recomendada

Após definição do provedor de produção, implementar `S3MediaStorage`/`R2MediaStorage` sobre o contrato existente e um job de migração que copie os binários do provider atual para object storage, atualizando apenas `storage_key`/provider de forma transacional e auditável.
