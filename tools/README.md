# Utilitários opcionais de catálogo

Os scripts desta pasta servem para reconstruir ou auditar o catálogo a partir dos PDFs de origem. Eles **não fazem parte do runtime da loja** e não são necessários para `npm start`.

## Caminhos portáveis

Por padrão, o projeto é localizado automaticamente a partir de `tools/`. Os PDFs devem ser colocados em `catalogos-fonte/` na raiz. Também é possível definir:

```bash
export INTEGRALL_PROJECT_ROOT=/caminho/para/o/projeto
export INTEGRALL_SOURCE_PDF_DIR=/caminho/para/os/pdfs
```

## Dependências Python opcionais

Conforme o script utilizado: Python 3.10+, PyMuPDF (`pymupdf`), Pillow e, apenas para OCR, `rapidocr-onnxruntime`. Essas dependências não são instaladas pelo npm e os PDFs de origem não estão incluídos no pacote de produção.

Os scripts devem ser executados a partir de uma cópia versionada e com backup do catálogo. Alguns deles regeneram `data/catalog.json` e removem imagens de produto não referenciadas.

## Modo de auditoria no pacote entregue

`python3 tools/audit_products.py` detecta automaticamente se os PDFs-fonte e as dependências Python opcionais estão disponíveis.

- **Pacote padrão/ZIP entregue:** executa uma auditoria sem dependências externas sobre `data/catalog.json` e os assets públicos. Verifica IDs e slugs técnicos, referências de imagens, imagem por variação, referências de caixas, produtos ativos sem preço e produtos sem imagem. Os resultados são gravados em `out/audit-packaged.json` e `out/AUDITORIA-CATALOGO-PACOTE.md`.
- **Ambiente de reconstrução com PDFs:** quando todas as fontes e bibliotecas opcionais estão presentes, mantém a auditoria completa contra os PDFs.

Códigos comerciais/SKUs podem ser compartilhados no material de origem por apresentações diferentes. Por isso o modo de pacote os reporta como informação e não os usa como identificador técnico único; os identificadores que precisam ser únicos são `product.id`, `product.slug` e `variant.id`.
