# Cadastro dos 5 catálogos em PDF — INTEGRALL Online

**Catálogo da loja agora: 227 produtos** — 222 cadastrados a partir dos PDFs + 5 que já existiam e foram preservados.

Sobre os PDFs: **225 fichas lidas**, das quais 3 eram o mesmo produto que já estava na loja (mesmo nome) e por isso **não duplicaram** — receberam apenas o SKU/campos que faltavam.

## O que entrou

| origem | qtd | departamento no site |
|---|---|---|
| Catálogo Biscoitos.pdf | 82 lidas → 81 cadastradas | petit-four |
| Vinhos Nacionais.pdf | 34 lidas → 33 cadastradas | vinhos-nacionais |
| Vinhos importados.pdf | 94 lidas → 94 cadastradas | vinhos-importados |
| Sucos.pdf | 8 lidas → 8 cadastradas | sucos |
| Café Jurerê.pdf | 7 lidas → 6 cadastradas | cafes |

Campos preenchidos por produto: **nome, departamento/subcategoria, descrição, variantes (quando o PDF traz mais de um formato), SKU = código do PDF, marca/produtor, unidade (embalagem), peso e dimensões para frete, atributos (uva, safra, teor alcoólico, origem, torra, vol. etc.) e 1 foto recortada do próprio PDF.**

## Fotos

- 222 produtos com imagem; 0 sem imagem.
- cada foto é o recorte em alta do rótulo/embalagem na página do PDF (`public/assets/products/pdf/*.webp`: 220 arquivos, 13.7 MB) — nada de foto genérica. Alguns produtos compartilham a arte quando o PDF mostra o mesmo rótulo em duas páginas.

## O que ficou faltando (é só preencher isso)

1. **Preço**: 222/222 produtos estão com preço 0 — os 5 PDFs não trazem nenhum valor (busca por `R$`/`preço`/`valor` = 0 ocorrências). Use a planilha `precos-a-preencher.csv` (uma linha por variante).
2. **Disponibilidade**: todos os novos entraram `disponível = não` para nada ir ao ar sem preço. No Admin, marque disponibilidade ao confirmar preço/estoque.
3. **Estoque**: ficou vazio (`—`) porque não há dado nos PDFs.
4. **Variantes**: 187 produtos entraram sem variante (o PDF não separa formatos para eles).
5. **Caixa/dimensões logísticas**: o peso saiu do PDF quando o PDF dizia (ex.: “Caixa: 2 kg” nos biscoitos); onde não dizia, derivei do formato — vinhos por volume (187 ml → 450 g / 6×6×18; 375 ml → 800 g; 750 ml → 1,45 kg / 9×9×31; 1 L → 1,75 kg; bag-in-box ≥ 3 L → 22×18×30), suco 1 L → 1,05 kg, café 250 g. Está tudo editável no Admin se sua transportadora exigir outro padrão; verifiquei que nenhum produto novo cai no fallback de 300 g do `correios.js`.

## Casos que merecem sua conferência

- **70 rótulos de importados sem nome legível**: no PDF de importados a maioria das páginas é *folha de etiquetas* — o nome existe só dentro da arte, e vários códigos dividem a mesma imagem. Nesses casos cadastrei como **“Marca/linha — código NNN”** (ex.: “Vidigal Wines — código 435”), com o recorte da etiqueta, o país e a região corretos, e a hipótese de leitura da etiqueta escrita na descrição. Onde o PDF tinha a ficha pronta (páginas do Stormhoek, Relatos de Valpa, Da pipa) o nome veio limpo do texto.
- **Descrições transcritas literalmente do PDF**, inclusive quando o PDF tem erro de digrafia (ex.: “Carbenet Sauvignon” na página Cave). Não corrigi para não inventar dado.
- **Sucos e cafés**: volume/torra/notas saíram de OCR (essas páginas são imagem). Confira a unidade dos sucos — o PDF diz “Garrafa 1 L e 300 ml” sem dizer por sabor.
- **Biscoitos**: onde o PDF traz dois códigos na mesma ficha (ex.: 959/965), gerei **um** produto com **duas variantes** (tradicional / queijo), que é como o site funciona.

## Atributos mais comuns capturados

`origin` (112), `quantity` (99), `weight` (87), `volume` (51), `alcohol` (41), `grape` (33), `kind` (13), `wineType` (11), `flavor` (8), `sugar` (8), `vintage` (7), `method` (6), `roast` (5), `bean` (4), `intensity` (2), `ingredients` (1)

SKU/código preenchido em **195/227** produtos (os sem SKU são os que já estavam na loja sem código).

## Como aplicar

**Já aplicado** neste projeto (`data/catalog.json`) — rode `npm run dev` e veja a loja. Na auditoria v11.1.1, `normalizeCatalog` aceita os 227 produtos, os IDs de produto/slug/variação são únicos e todas as imagens referenciadas existem. As contagens atuais de testes estão em `TESTES-V11.1.1.md`; a antiga contagem 103/103 não deve ser usada como evidência vigente.

Na sua base de produção, o caminho é o Admin → **Importar catálogo** com `data/catalog.json` (atenção: a importação *substitui* o catálogo atual — por isso o arquivo já vem com os seus 5 produtos mesclados) **ou** rode `node scripts/migrate.mjs` com o JSON. Se preferir manter os preços no banco, importe e depois ajuste por produto.

## Arquivos desta entrega

| arquivo | o que é |
|---|---|
| pacote v11.1.1 corrigido/auditado | projeto completo, com catálogo e fotos preservados |
| `data/catalog.json` | só o catálogo (para importar no Admin sem trocar o resto) |
| `precos-a-preencher.csv` | planilha: uma linha por variante, coluna de preço em branco |
| `RELATORIO-CADASTRO.md` | este relatório |
| `tools/` + `extract/` | extratores (rode de novo quando os PDFs mudarem) |

## Auditoria de completude (relida dos PDFs, sem reusar os extratores)

Verificador independente: `tools/audit_products.py` (rodar `python tools/audit_products.py`).
Resultado completo em `AUDITORIA-CATALOGO.md`.

| checagem | resultado |
|---|---|
| códigos de produto no PDF sem cadastro | **0** em biscoitos (85/85), nacionais (16/16), importados (83/83) |
| SKU no cadastro que não existe no PDF | **0** (nada inventado nem deslocado) |
| código que só existe dentro da arte (OCR) e ficou de fora | **0** — os 11 rótulos rasterizados (Cabriz Dão, Pesca Da, La Vache Espagnole, Tango) entraram com ficha e foto próprias |
| páginas do PDF com ficha e sem produto | **0** |
| PDFs sem código — prova por título de embalagem | café: 7 títulos no OCR = 7 produtos · sucos: 8 sabores (páginas pares 4-18) |
| fotos | 220 arquivos, 0 em branco, 0 sobrando, 2 compartilhadas (mesmo rótulo em 2 formatos) |
| peso/medidas para frete | 100% dos produtos com caixa válida — `packOrder` devolve `missingData=false` (antes, 90 produtos cairiam no padrão de 300 g da carta) |
| invariantes do site | 227 produtos ≤ 1000, 0 id duplicado, 0 nome duplicado, 0 sem foto, 0 preço divergente, 0 hidden |
| suíte do projeto | consulte `TESTES-V11.1.1.md`; auditoria atual sem falhas nos gates executados |

Correções que a auditoria motivou (antes dela havia perda real de produto):
1. **cód. 423** (Relatos de Valpa Cab Sauv 187 ml) estava sendo descartado por ter o mesmo nome do 420 (750 ml) → merge agora só funde quando embalagem também bate;
2. **cód. 961/960** (Biscoito de Polvilho Argola) eram engolidos pelo produto homônimo da loja → o código passou a ser gravado no cadastro existente;
3. **11 fichas rasterizadas** dos importados não eram lidas porque a página não tinha texto vetor → hoje o OCR alimenta a ficha (nome, uva, teor, volume, região);
4. **país/região** vazavam entre seções (Tango Malbec aparecia como Itália/Abruzzo) → cada rótulo usa o texto do próprio bloco;
5. **peso e medidas** faltavam em 90 produtos → preenchidos por formato, com origem do PDF quando ela existe.
