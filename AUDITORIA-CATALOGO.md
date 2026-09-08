# Auditoria do cadastro — nenhum produto do PDF ficou para trás?

O verificador abaixo **não reusa os extratores**: ele relê os 5 PDFs do zero e
confronta três coisas independentes — códigos no texto do PDF, códigos que só
aparecem dentro da arte (OCR) e número de fotos de produto por página — contra o
que está em `data/catalog.json`.

## 1. Cobertura por PDF

| PDF | pág. | códigos no PDF | produtos no site | códigos cobertos | faltando | só no OCR | fotos únicas no PDF |
|---|---|---|---|---|---|---|---|
| biscoitos | 8 | 85 | 82 | 85 | **0** | 0 | 82 |
| nacionais | 34 | 16 | 35 | 16 | **0** | 0 | 39 |
| importados | 46 | 83 | 94 | 83 | **0** | 0 | 49 |
| sucos | 21 | 0 | 9 | 0 | **0** | 0 | 25 |
| cafe | 20 | 0 | 7 | 0 | **0** | 0 | 33 |

Notas sobre a última coluna: em `biscoitos` cada ficha tem uma foto só, então **82 fotos = 82 produtos** e isso fecha exato. Nos outros catálogos a arte não é 1:1 (em `importados` uma imagem de folha de etiquetas cobre vários códigos; em `sucos`/`cafe` há fotos decorativas por página), então ali a coluna é contexto, não critério de aprovação. O critério duro é **código do PDF → produto no site**, que está zerado acima.

✅ **Nenhum código do PDF ficou sem produto.** Todos os códigos de `Catálogo Biscoitos`, `Vinhos Nacionais` e `Vinhos importados` aparecem no catálogo (em SKU, nome de variante, atributo ou descrição).

✅ **Nenhum código órfão:** todo SKU do cadastro existe no PDF (não inventei nem desloquei código para produto errado).

## 2. PDFs sem código (Sucos e Café): prova por título

Esses dois catálogos não têm SKU, então o único identificador é o título da
embalagem. Contei os títulos distintos no OCR e bati com o cadastro:

| PDF | títulos distintos no OCR | produtos no site | título do PDF sem produto |
|---|---|---|---|
| cafe | 7 | 7 | nenhum ✅ |
| sucos | 6 | 9 | nenhum ✅ |

## 3. Páginas sem produto

✅ Toda página com foto/código de produto gerou cadastro.

## 4. Invariantes que o site cobra

| checagem | valor | esperado | ok |
|---|---|---|---|
| produtos totais | 227 | <= 1000 | ✅ |
| ids duplicados | 0 | = 0 | ✅ |
| nomes duplicados (novos) | 0 | = 0 | ✅ |
| sem foto | 0 | = 0 | ✅ |
| arquivo de imagem ausente | 0 | = 0 | ✅ |
| sem peso/medidas (frete quebra) | 0 | = 0 | ✅ |
| novo com preco != 0 | 0 | = 0 | ✅ |
| novo marcado disponivel sem preco | 0 | = 0 | ✅ |
| novo hidden (sumido da vitrine) | 0 | = 0 | ✅ |
| variante acima de 100 | 0 | = 0 | ✅ |
| departamento invalido | 0 | = 0 | ✅ |
- ⚠️ **Fora do escopo da importação, mas vale saber**: 2 produto(s) que já estavam na loja seguem sem peso/medidas, então o frete deles usa o padrão de 300 g: `Suco Integral de Uva bordô (sucos)`, `Vinho Tinto Seco (vinhos)`.

- Sem SKU: **29** produtos novos (o PDF não traz código para eles).
- Nomes provisórios “marca — código NNN”: **70** (importados em folha de etiqueta; foto e país corretos, só falta o nome).

## 5. Fotos

- `220` arquivos em `public/assets/products/pdf`: 220
- fotos repetidas entre produtos diferentes: **2** (esperado quando o PDF mostra o mesmo rótulo em mais de um formato)
- fotos em branco/sólidas: **0** 
- arquivos sobrando sem produto apontando: **0**

## 6. Filtros da vitrine (subcategory)

| subcategoria | produtos |
|---|---|
| Vinhos Importados | 94 |
| Vinhos Nacionais | 33 |
| Linha Especial | 22 |
| Amanteigados | 14 |
| Salgados | 12 |
| Cobertos de | 12 |
| Snacks | 11 |
| Amanteigados Recheados | 10 |
| Cafés Especiais | 6 |
| Uva Bordô | 1 |
| Vinho Tinto Seco | 1 |
| Biscoito Folheado | 1 |
| Café Gerações | 1 |
| Vinho Verde | 1 |
| Uva Tinto | 1 |
| Uva Branco | 1 |
| Tangerina | 1 |
| Maçã | 1 |
| Pink Lemonade | 1 |
| Goiaba | 1 |
| Laranja | 1 |
| Tomate Condimentado | 1 |

## 7. Para publicar

1. preencher preço (planilha `precos-a-preencher.csv` — uma linha por variante);
2. marcar `disponível = sim` por produto (ou em lote no Admin) — sem isso o produto aparece na vitrine mas não entra no carrinho;
3. conferir os nomes provisórios dos importados;
4. os 5 produtos que já existiam não foram tocados (preço, fotos e variantes originais).
