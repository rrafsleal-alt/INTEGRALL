#!/usr/bin/env python3
"""Gera o relatório de cadastro a partir dos artefatos opcionais de extração.

Este utilitário não faz parte do runtime da loja. Ele exige que a etapa de
extração dos PDFs tenha produzido ``out/stage1.json``, ``out/stage2.json`` e
``out/summary.json``. Quando esses arquivos não existem, o script termina com
uma mensagem objetiva em vez de gerar um traceback ou declarar validações que
não foram executadas.
"""
from __future__ import annotations

import collections
import json
import os
import sys
from pathlib import Path

from paths import OUTPUT_DIR, PRODUCT_ASSET_DIR, PROJECT_ROOT


def fail(message: str) -> "NoReturn":
    print(f"ERRO: {message}", file=sys.stderr)
    raise SystemExit(2)


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(
            f"artefato obrigatório ausente: {path.relative_to(PROJECT_ROOT)}. "
            "Execute primeiro a extração documentada em tools/README.md, "
            "com os PDFs de origem em catalogos-fonte/."
        )
    except json.JSONDecodeError as error:
        fail(f"JSON inválido em {path.relative_to(PROJECT_ROOT)}: {error}")


catalog_path = PROJECT_ROOT / "data" / "catalog.json"
seed_path = PROJECT_ROOT / "data" / "catalog.seed.json"
package_path = PROJECT_ROOT / "package.json"

catalog = load_json(catalog_path)
seed = load_json(seed_path)
package = load_json(package_path)
products = catalog.get("products", [])
seed_products = seed.get("products", [])
if not isinstance(products, list) or not isinstance(seed_products, list):
    fail("catalog.json e catalog.seed.json precisam conter uma lista products")

stages: dict[str, object] = {}
for filename in ("stage1.json", "stage2.json"):
    stages.update(load_json(OUTPUT_DIR / filename))
summary = load_json(OUTPUT_DIR / "summary.json")

version = str(package.get("version") or "desconhecida")
seed_ids = {product.get("id") for product in seed_products}
new_products = [product for product in products if product.get("id") not in seed_ids]
parsed = {
    "biscoitos": len(stages.get("biscoitos", [])),
    "nacionais": len(stages.get("nacionais", [])),
    "importados": len(stages.get("importados", [])),
    "sucos": len(stages.get("sucos", [])),
    "cafe": len(stages.get("cafe", [])),
}


def department(product: dict) -> str:
    if product.get("department") == "vinhos":
        return "vinhos-importados" if product.get("imported") else "vinhos-nacionais"
    return str(product.get("department") or "sem-departamento")


by_department = collections.Counter(department(product) for product in new_products)
without_images = [product.get("name", product.get("id", "?")) for product in new_products if not product.get("images")]
total_sku = sum(1 for product in products if product.get("sku"))
without_variants = [product.get("name", product.get("id", "?")) for product in new_products if not product.get("variants")]
needs_review = [
    product for product in new_products
    if "código" in str(product.get("name", "")).lower() or "OCR" in str(product.get("source") or "")
]
without_price = sum(1 for product in new_products if (product.get("price") or 0) == 0)
attributes = collections.Counter(
    key for product in new_products for key in (product.get("attributes") or {})
)

asset_files = [path for path in PRODUCT_ASSET_DIR.iterdir() if path.is_file()] if PRODUCT_ASSET_DIR.exists() else []
asset_size_mb = sum(path.stat().st_size for path in asset_files) / 1_000_000

lines: list[str] = []
append = lines.append
append("# Cadastro dos 5 catálogos em PDF — INTEGRALL Online\n")
append(
    f"**Catálogo da loja: {len(products)} produtos** — {len(new_products)} cadastrados a partir dos PDFs "
    f"+ {len(seed_products)} que já existiam e foram preservados.\n"
)
append(
    f"Sobre os PDFs: **{sum(parsed.values())} fichas lidas**, das quais "
    f"{len(summary.get('enriquecidos', []))} correspondiam a produtos já existentes e, por isso, "
    "não foram duplicadas.\n"
)
append("## O que entrou\n")
append("| origem | qtd | departamento no site |")
append("|---|---:|---|")
labels = {
    "Catálogo Biscoitos": ("biscoitos", "petit-four"),
    "Vinhos Nacionais": ("nacionais", "vinhos-nacionais"),
    "Vinhos importados": ("importados", "vinhos-importados"),
    "Sucos": ("sucos", "sucos"),
    "Café Jurerê": ("cafe", "cafes"),
}
for label, (bucket, target_department) in labels.items():
    append(f"| {label}.pdf | {parsed[bucket]} lidas → {by_department.get(target_department, 0)} cadastradas | {target_department} |")
append("")
append(
    "Campos preenchidos por produto: **nome, departamento/subcategoria, descrição, variantes "
    "(quando o PDF traz mais de um formato), SKU/código, marca/produtor, unidade, peso e dimensões "
    "para frete, atributos e uma foto recortada do PDF, quando disponível.**\n"
)
append("## Fotos\n")
append(f"- {len([product for product in new_products if product.get('images')])} produtos com imagem; {len(without_images)} sem imagem.")
append(
    f"- `public/assets/products/pdf/`: {len(asset_files)} arquivos, {asset_size_mb:.1f} MB. "
    "As imagens são recortes dos materiais de origem; alguns produtos podem compartilhar a mesma arte."
)
append("")
append("## O que ficou faltando\n")
append(
    f"1. **Preço**: {without_price}/{len(new_products)} novos produtos estão com preço zero porque os PDFs "
    "não fornecem valores. Preencha `precos-a-preencher.csv`; nenhum preço deve ser inventado."
)
append("2. **Disponibilidade**: os produtos sem preço permanecem indisponíveis para evitar venda incorreta.")
append("3. **Estoque**: não foi inferido quando ausente na fonte.")
append(f"4. **Variantes**: {len(without_variants)} produtos não têm variante porque a fonte não separa formatos.")
append(
    "5. **Peso e dimensões**: os padrões logísticos devem ser conferidos antes de ativar frete real, "
    "principalmente para caixas de bebidas."
)
append("")
append("## Casos para conferência humana\n")
append(
    f"- **{len(needs_review)} rótulos importados sem nome totalmente legível** permanecem identificados por "
    "marca/linha e código; revise-os contra a fonte antes da publicação."
)
append("- Descrições e atributos derivados de OCR devem ser conferidos; o relatório não corrige a fonte silenciosamente.")
if without_images:
    append(f"- Sem foto: {', '.join(map(str, without_images[:8]))}")
append("")
append("## Atributos mais comuns capturados\n")
append(", ".join(f"`{key}` ({count})" for key, count in attributes.most_common(16)) or "Nenhum atributo adicional.")
append(f"\nSKU/código preenchido em **{total_sku}/{len(products)}** produtos.")
append("")
append("## Como validar esta geração\n")
append(
    "O catálogo está em `data/catalog.json`. Após gerar os artefatos, execute os gates atuais do projeto: "
    f"`npm run verify:v{version}`, `npm run test:browser` e `npm run build:production`. "
    "Este utilitário não marca esses testes como aprovados; os resultados precisam vir da execução real.\n"
)
append("## Arquivos desta geração\n")
append("| arquivo | finalidade |")
append("|---|---|")
append("| `data/catalog.json` | catálogo completo para a aplicação |")
append("| `precos-a-preencher.csv` | preços pendentes por produto/variante |")
append("| `out/RELATORIO-CADASTRO.md` | este relatório regenerado |")
append("| `tools/` + `extract/` | utilitários opcionais de extração e conferência |")

output = OUTPUT_DIR / "RELATORIO-CADASTRO.md"
output.parent.mkdir(parents=True, exist_ok=True)
content = "\n".join(lines) + "\n"
output.write_text(content, encoding="utf-8")
print(content, end="")
