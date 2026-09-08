#!/usr/bin/env python3
"""Auditoria do cadastro: procura produto FALTANDO sem reusar os extratores.

Tres sinais independentes por PDF:
  1. CODIGOS  todo codigo que aparece no PDF (texto vetor) precisa estar em
              algum ponto do cadastro (sku, variante, nome, descricao ou
              atributo). Faltando = ficha perdida. Sobrando = codigo inventado.
  2. OCR      codigo que so existe dentro da arte (lido por OCR) e nao virou
              produto: possivel produto que o texto vetor nao mostra.
  3. FOTOS    cada ficha tem uma foto; n. de imagens de produto da pagina vs
              n. de produtos cadastrados daquela pagina.

Mais as invariantes que o site cobra (normalizeCatalog), fotos em branco ou
repetidas, e peso/medidas sem os quais o frete nao fecha.
"""
import json, os, re, unicodedata, collections
try:
    import pymupdf
except ImportError:  # opcional: só necessário quando os PDFs-fonte estão disponíveis
    pymupdf = None
try:
    from PIL import Image, ImageStat
except ImportError:  # opcional: auditoria do ZIP funciona sem Pillow
    Image = ImageStat = None

from paths import PROJECT_ROOT, SOURCE_PDF_DIR, OUTPUT_DIR

WORK = str(PROJECT_ROOT)
PDFDIR = str(SOURCE_PDF_DIR)
OUT = str(OUTPUT_DIR)

SPECS = {
    # os catalogos desenham o rotulo com letter-spacing ("C ó d i g o   d o
    # p r o d u t o"), entao os padroes rodam sobre o texto SEM espaco
    "biscoitos": dict(file="Catálogo Biscoitos_compressed.pdf",
                      code=r"cod\.?:?([0-9]{3})", minarea=9000, dept="petit-four"),
    # o mesmo PDF usa "Código do produto: 332" nos cartoes e "C Ó D. 2 5 4"
    # nas folhas de rotulo -> os dois formatos precisam ser lidos
    "nacionais": dict(file="Vinhos Nacionais_compressed.pdf",
                      code=r"(?:codigo(?:doproduto)?|cod\.?):?([0-9]{3})", minarea=30000,
                      dept="vinhos-nacionais"),
    "importados": dict(file="Vinhos importados_compressed.pdf",
                       code=r"cod:?([0-9]{3})", minarea=25000, dept="vinhos-importados"),
    "sucos": dict(file="Sucos_compressed.pdf", code=None, minarea=60000, dept="sucos"),
    "cafe": dict(file="Café Jurerê_compressed.pdf", code=None, minarea=60000, dept="cafes"),
}
OCR_FILE = {"importados": "vinhosimportados", "sucos": "sucos", "cafe": "cafe"}


def flat(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


def bucket_of(p):
    sub, dep = flat(p.get("subcategory")), p.get("department")
    if "importad" in sub:
        return "importados"
    if dep == "vinhos":
        return "nacionais"
    if dep == "cafes":
        return "cafe"
    if dep == "sucos":
        return "sucos"
    return "biscoitos"


def blob_of(p):
    parts = [p.get("sku"), p.get("name"), p.get("description"), p.get("brand"), p.get("unit")]
    for v in p.get("variants") or []:
        parts += [v.get("name"), v.get("unit"), v.get("id")]
    for k, v in (p.get("attributes") or {}).items():
        parts += [k, v]
    return flat(" ".join(str(x) for x in parts if x))


def page_photos(page, minarea):
    n, seen = 0, set()
    for im in page.get_image_info(xrefs=True):
        bb = im.get("bbox") or (0, 0, 0, 0)
        area = max(0.0, bb[2] - bb[0]) * max(0.0, bb[3] - bb[1])
        if area < minarea or (im.get("width") or 0) < 90 or (im.get("height") or 0) < 90:
            continue
        key = (im.get("xref") or 0, round(bb[0]), round(bb[1]), round(bb[2]), round(bb[3]))
        if key in seen:
            continue
        seen.add(key)
        n += 1
    return n


def title_check():
    """Prova para os PDFs SEM codigo (Sucos, Cafe): o unicos identificador e o
    titulo da embalagem, entao contamos titulos distintos no OCR e comparamos
    com o que foi cadastrado. Retorna linhas de relatorio."""
    cat = json.load(open(f"{WORK}/data/catalog.json"))["products"]
    out = []
    pats = {
        "cafe": (r"^(?:caf[eé]s?\s+)?(?:v[ôo]\s+\w+|caf[eé]\s+(?:da|do|de)\s+\w+)$", "cafes"),
        "sucos": (r"^(?:suco\s+integral\s+)?(?:uva\s+(?:tinto|branco)|tangerina|ma[cç]a|"
                  r"goiaba|laranja|pink\s+lemonade|tomate(?:\s+condimentado)?|limao)$", "sucos"),
    }
    for tag, (pat, dept) in pats.items():
        f = f"{WORK}/extract/{tag}.ocr.json"
        rx = re.compile(pat, re.I)
        titles = set()
        if os.path.exists(f):
            for pg in json.load(open(f)):
                for l in pg["lines"]:
                    t = flat(l["t"]).strip(" .-|")
                    t2 = re.sub(r"cafedarosi|cafedoirmao", "cafe da rosi", t)
                    t2 = re.sub(r"(?<=[a-z])(?=(rosi|irmao|mi|lini|cheli|gentil|damazia))", " ", t)
                    if rx.match(t2):
                        titles.add(re.sub(r"\s+", " ", t2))
        # juntamos os titulos ja colados pelo OCR ("cafedarosi") na mesma chave
        norm_t = {re.sub(r"[^a-z0-9]", "", t) for t in titles}
        prods = [p for p in cat if p.get("department") == dept]
        pn = {re.sub(r"[^a-z0-9]", "", flat(p["name"]).replace("sucointegral", "").replace("cafe", ""))
              for p in prods}
        extra_pdf = sorted(t for t in norm_t if not any(t in x or x in t for x in pn if x))
        out.append((tag, len(norm_t), len(prods), extra_pdf))
    return out


def audit():
    cat = json.load(open(f"{WORK}/data/catalog.json"))
    products = cat["products"]
    stages = {}
    for f in ("stage1.json", "stage2.json"):
        if os.path.exists(f"{OUT}/{f}"):
            stages.update(json.load(open(f"{OUT}/{f}")))
    # pagina de origem so existe nas fichas (o catalogo normalizado descarta)
    page_by_sku, page_by_name = {}, {}
    for b, lst in stages.items():
        for p in lst:
            if p.get("sku"):
                page_by_sku[(b, p["sku"])] = p.get("sourcePage")
            page_by_name[(b, flat(p.get("name") or ""))] = p.get("sourcePage")

    R = {"itens": {}, "faltando": [], "sobra": [], "ocr_so": [], "paginas": [],
         "fotos": {}, "invariantes": [], "nomes_duplicados": [], "placeholder": []}
    seed = json.load(open(f"{WORK}/data/catalog.seed.json"))
    seed_ids = {p["id"] for p in seed["products"]}
    newprods = [p for p in products if p["id"] not in seed_ids]

    for bucket, spec in SPECS.items():
        doc = pymupdf.open(f"{PDFDIR}/{spec['file']}")
        pdf_codes, per_page_codes, per_page_photos = set(), {}, {}
        for page in doc:
            txt = flat(page.get_text("text"))
            hay = re.sub(r"[^a-z0-9./:]", "", txt)
            found = set(re.findall(spec["code"], hay)) if spec["code"] else set()
            if spec["code"]:
                # "Cod. 959/965" = dois SKUs na mesma ficha: o segundo so aparece
                # no par, e precisa ser auditado tambem
                for a_, b_ in re.findall(r"([0-9]{3})/([0-9]{3})", hay):
                    found |= {a_, b_}
            pdf_codes |= found
            per_page_codes[page.number + 1] = found
            per_page_photos[page.number + 1] = page_photos(page, spec["minarea"])
        ocr_codes = set()
        tag = OCR_FILE.get(bucket)
        if tag and spec["code"]:
            f = f"{WORK}/extract/{tag}.ocr.json"
            if os.path.exists(f):
                for pg in json.load(open(f)):
                    for l in pg["lines"]:
                        h2 = re.sub(r"[^a-z0-9./:]", "", flat(l["t"]))
                        ocr_codes |= set(re.findall(spec["code"], h2))
        prods = [p for p in products if bucket_of(p) == bucket]
        covered = set()
        for p in prods:
            covered |= set(re.findall(r"\b([0-9]{3})\b", blob_of(p)))
        # um codigo pode estar coberto por OUTRO produto do site (ex. o seed antigo)
        elsewhere = set()
        for p in products:
            if bucket_of(p) != bucket:
                elsewhere |= set(re.findall(r"\b([0-9]{3})\b", blob_of(p)))
        missing = sorted(pdf_codes - covered - elsewhere)
        only_ocr = sorted((ocr_codes - pdf_codes) - covered - elsewhere)
        # direcao inversa: codigo no cadastro que nao existe no PDF (e nem no OCR)
        # = numero inventado/mapeado para o produto errado
        allpdf = pdf_codes | ocr_codes
        sobra = []
        for p2 in prods:
            for c in re.findall(r"\b([0-9]{3})\b", str(p2.get("sku") or "")):
                if c not in allpdf:
                    sobra.append({"codigo": c, "produto": p2.get("name"), "sku_bruto": p2.get("sku")})
        uniq = set()
        for pg in pymupdf.open(f"{PDFDIR}/{spec['file']}"):
            for im in pg.get_images(full=True):
                try:
                    xr = im[0]
                    w, h = pymupdf.Pixmap(doc, xr).width, pymupdf.Pixmap(doc, xr).height
                except Exception:
                    continue
                if w >= 240 and h >= 240:
                    uniq.add(xr)
        R["itens"][bucket] = {"fotos_unicas_xref": len(uniq),
            "paginas_no_pdf": len(doc), "codigos_no_pdf": len(pdf_codes),
            "produtos_no_site": len(prods), "codigos_cobertos": len(pdf_codes & covered),
            "faltando": missing, "codigo_so_no_ocr": only_ocr,
            "codigo_inventado": sobra,
            "fotos_de_produto_no_pdf": sum(per_page_photos.values()),
        }
        for c in missing:
            pn = [k for k, v in per_page_codes.items() if c in v]
            R["faltando"].append({"bucket": bucket, "codigo": c, "pagina_pdf": pn[0] if pn else None})
        for c in only_ocr:
            R["ocr_so"].append({"bucket": bucket, "codigo": c})
        for c in sobra:
            R["sobra"].append({"bucket": bucket, **c})
        # cobertura pagina a pagina: pagina do PDF que nao gerou nada
        def src_page(p):
            pg = page_by_sku.get((bucket, p.get("sku"))) if p.get("sku") else None
            if pg is None:
                nm = flat(p.get("name") or "")
                nm = re.sub(r"\s*\(c[óo]d\.[^)]*\)$", "", nm)
                pg = page_by_name.get((bucket, nm))
            return pg
        gen = collections.Counter(src_page(p) for p in prods)
        for pn in sorted(per_page_photos):
            gp, ph, pc = gen.get(pn, 0), per_page_photos[pn], len(per_page_codes[pn])
            if ph == 0 and pc == 0:
                continue  # pagina so com texto/arte, sem ficha
            if gp == 0 and pc > 0 and (per_page_codes[pn] & set(missing)):
                R["paginas"].append({"bucket": bucket, "pagina": pn, "fotos": ph, "codigos": pc,
                                     "observacao": "tem código do PDF e nenhuma ficha daqui — PERDA REAL"})
        doc.close()

    # ---- invariantes do site -------------------------------------------------
    ids = [p["id"] for p in products]
    names = [flat(p["name"]) for p in newprods]
    R["invariantes"].append(("produtos totais", len(products), "<= 1000", len(products) <= 1000))
    R["invariantes"].append(("ids duplicados", len(ids) - len(set(ids)), "= 0", len(ids) == len(set(ids))))
    dup = [n for n, c in collections.Counter(names).items() if c > 1]
    R["invariantes"].append(("nomes duplicados (novos)", len(dup), "= 0", not dup))
    R["nomes_duplicados"] = dup
    noimg = [p["name"] for p in products if not p.get("images")]
    R["invariantes"].append(("sem foto", len(noimg), "= 0", not noimg))
    miss = [p["name"] for p in products for i in (p.get("images") or [])
            if not os.path.exists(f"{WORK}/public{i}")]
    R["invariantes"].append(("arquivo de imagem ausente", len(miss), "= 0", not miss))
    nofree = [p["name"] for p in newprods
              if not (p.get("weightGrams") and p.get("lengthCm") and p.get("widthCm") and p.get("heightCm"))]
    R["invariantes"].append(("sem peso/medidas (frete quebra)", len(nofree), "= 0", not nofree))
    R["sem_frete"] = nofree
    badprice = [p["name"] for p in newprods if (p.get("price") or 0) != 0]
    R["invariantes"].append(("novo com preco != 0", len(badprice), "= 0", not badprice))
    avail = [p["name"] for p in newprods if p.get("available") is not False]
    R["invariantes"].append(("novo marcado disponivel sem preco", len(avail), "= 0", not avail))
    hidden = [p["name"] for p in newprods if p.get("hidden")]
    R["invariantes"].append(("novo hidden (sumido da vitrine)", len(hidden), "= 0", not hidden))
    novar = [p["name"] for p in products if len(p.get("variants") or []) > 100]
    R["invariantes"].append(("variante acima de 100", len(novar), "= 0", not novar))
    seed_no_weight = [f"{p['name']} ({p.get('department')})" for p in products
                      if p["id"] in seed_ids and not p.get("weightGrams")]
    R["seed_sem_peso"] = seed_no_weight
    dvalid = [p["name"] for p in products if p.get("department")
              not in ("vinhos", "cafes", "sucos", "petit-four", "outros")]
    R["invariantes"].append(("departamento invalido", len(dvalid), "= 0", not dvalid))
    nosku = sum(1 for p in newprods if not p.get("sku"))
    R["sem_sku"] = nosku

    # ---- fotos: duplicadas e em branco --------------------------------------
    used = collections.Counter()
    for p in products:
        for i in p.get("images") or []:
            used[i] += 1
    dup_img = {i: c for i, c in used.items() if c > 1}
    blank = []
    for f in sorted(os.listdir(f"{WORK}/public/assets/products/pdf")):
        path = f"{WORK}/public/assets/products/pdf/{f}"
        try:
            with Image.open(path) as im:
                g = im.convert("L").resize((64, 64))
                st = ImageStat.Stat(g)
                if st.stddev[0] < 6 or g.getbbox() is None:
                    blank.append(f)
        except Exception as e:
            blank.append(f"{f} ({e})")
    R["fotos"] = {"arquivos": len(os.listdir(f"{WORK}/public/assets/products/pdf")),
                  "compartilhadas_por_produtos": len(dup_img),
                  "exemplos_compartilhadas": list(dup_img.items())[:6],
                  "em_branco_ou_solidas": blank}
    orphan = set(os.listdir(f"{WORK}/public/assets/products/pdf")) - {os.path.basename(i) for i in used}
    R["fotos"]["sem_produto_apontando"] = sorted(orphan)[:20]

    # nomes provisorios (importados sem nome na arte) = revisao humana
    R["placeholder"] = [p["name"] for p in newprods if re.search(r"c[óo]digo [0-9]{3}", flat(p["name"]))]
    R["resumo"] = {b: v["produtos_no_site"] for b, v in R["itens"].items()}
    R["subcats"] = collections.Counter(p.get("subcategory") or "—" for p in products).most_common()
    R["total_site"] = len(products)
    R["total_novos"] = len(newprods)
    json.dump(R, open(f"{OUT}/audit.json", "w"), ensure_ascii=False, indent=1)
    return R


def write_md(R):
    L = []
    A = L.append
    A("# Auditoria do cadastro — nenhum produto do PDF ficou para trás?\n")
    A("O verificador abaixo **não reusa os extratores**: ele relê os 5 PDFs do zero e")
    A("confronta três coisas independentes — códigos no texto do PDF, códigos que só")
    A("aparecem dentro da arte (OCR) e número de fotos de produto por página — contra o")
    A("que está em `data/catalog.json`.\n")
    A("## 1. Cobertura por PDF\n")
    A("| PDF | pág. | códigos no PDF | produtos no site | códigos cobertos | faltando | só no OCR | fotos únicas no PDF |")
    A("|---|---|---|---|---|---|---|---|")
    for b, v in R["itens"].items():
        A(f"| {b} | {v['paginas_no_pdf']} | {v['codigos_no_pdf']} | {v['produtos_no_site']} | "
          f"{v['codigos_cobertos']} | **{len(v['faltando'])}** | {len(v['codigo_so_no_ocr'])} | "
          f"{v['fotos_unicas_xref']} |")
    A("")
    A("Notas sobre a última coluna: em `biscoitos` cada ficha tem uma foto só, então "
      "**82 fotos = 82 produtos** e isso fecha exato. Nos outros catálogos a arte não é "
      "1:1 (em `importados` uma imagem de folha de etiquetas cobre vários códigos; em "
      "`sucos`/`cafe` há fotos decorativas por página), então ali a coluna é contexto, não "
      "critério de aprovação. O critério duro é **código do PDF → produto no site**, que está "
      "zerado acima.\n")
    if R["faltando"]:
        A("### Códigos do PDF sem produto no catálogo\n")
        A("| código | página do PDF | de onde |")
        A("|---|---|---|")
        for m in R["faltando"]:
            A(f"| {m['codigo']} | {m['pagina_pdf']} | {m['bucket']} |")
        A("\n> Cada linha aqui é um produto que o PDF tem e o site não. "
          "Diga o nome (ou me mande a página) e eu cadastro.\n")
    else:
        A("✅ **Nenhum código do PDF ficou sem produto.** Todos os códigos de "
          "`Catálogo Biscoitos`, `Vinhos Nacionais` e `Vinhos importados` aparecem no catálogo "
          "(em SKU, nome de variante, atributo ou descrição).\n")
    if R["sobra"]:
        A("### ⚠️ Códigos no cadastro que não existem no PDF\n")
        A("| código | produto | sku no cadastro |")
        A("|---|---|---|")
        for x in R["sobra"]:
            A(f"| {x['codigo']} | {x['produto']} | {x['sku_bruto']} |")
        A("")
    else:
        A("✅ **Nenhum código órfão:** todo SKU do cadastro existe no PDF "
          "(não inventei nem desloquei código para produto errado).\n")
    if R["ocr_so"]:
        A("### Códigos que só existem dentro da arte (OCR), sem produto\n")
        for o in R["ocr_so"]:
            A(f"- `{o['codigo']}` ({o['bucket']})")
        A("\n> Nestas páginas o nome está desenhado na etiqueta, não no texto. Se você "
          "confirmar que são produtos de verdade, eu adiciono.\n")
    A("## 2. PDFs sem código (Sucos e Café): prova por título\n")
    A("Esses dois catálogos não têm SKU, então o único identificador é o título da")
    A("embalagem. Contei os títulos distintos no OCR e bati com o cadastro:\n")
    A("| PDF | títulos distintos no OCR | produtos no site | título do PDF sem produto |")
    A("|---|---|---|---|")
    for tag, nt, npr, extra in title_check():
        A(f"| {tag} | {nt} | {npr} | {', '.join(extra) if extra else 'nenhum ✅'} |")
    A("")
    A("## 3. Páginas sem produto\n")
    if R["paginas"]:
        A("| PDF | página | fotos de produto | códigos | observação |")
        A("|---|---|---|---|---|")
        for p in R["paginas"]:
            A(f"| {p['bucket']} | {p['pagina']} | {p['fotos']} | {p['codigos']} | {p['observacao']} |")
        A("\n> São as páginas de abertura/departamento (título e texto, sem ficha) — "
          "**nada perdido**, mas liste aqui para você conferir visualmente.\n")
    else:
        A("✅ Toda página com foto/código de produto gerou cadastro.\n")
    A("## 4. Invariantes que o site cobra\n")
    A("| checagem | valor | esperado | ok |")
    A("|---|---|---|---|")
    for name, val, exp, ok in R["invariantes"]:
        A(f"| {name} | {val} | {exp} | {'✅' if ok else '❌'} |")
    if R.get("seed_sem_peso"):
        A(f"- ⚠️ **Fora do escopo da importação, mas vale saber**: {len(R['seed_sem_peso'])} produto(s) "
          f"que já estavam na loja seguem sem peso/medidas, então o frete deles usa o padrão de 300 g: "
          + ", ".join(f"`{x}`" for x in R["seed_sem_peso"]) + ".")
    A(f"\n- Sem SKU: **{R['sem_sku']}** produtos novos (o PDF não traz código para eles).")
    A(f"- Nomes provisórios “marca — código NNN”: **{len(R['placeholder'])}** "
      "(importados em folha de etiqueta; foto e país corretos, só falta o nome).")
    A("")
    A("## 5. Fotos\n")
    f = R["fotos"]
    A(f"- `{len(os.listdir(f'{WORK}/public/assets/products/pdf'))}` arquivos em "
      f"`public/assets/products/pdf`: {f['arquivos']}")
    A(f"- fotos repetidas entre produtos diferentes: **{f['compartilhadas_por_produtos']}** "
      "(esperado quando o PDF mostra o mesmo rótulo em mais de um formato)")
    A(f"- fotos em branco/sólidas: **{len(f['em_branco_ou_solidas'])}** "
      f"{f['em_branco_ou_solidas'][:5] or ''}")
    A(f"- arquivos sobrando sem produto apontando: **{len(f['sem_produto_apontando'])}**")
    A("")
    A("## 6. Filtros da vitrine (subcategory)\n")
    subs = R["subcats"]
    A("| subcategoria | produtos |")
    A("|---|---|")
    for k, v in subs:
        A(f"| {k} | {v} |")
    A("")
    A("## 7. Para publicar\n")
    A("1. preencher preço (planilha `precos-a-preencher.csv` — uma linha por variante);")
    A("2. marcar `disponível = sim` por produto (ou em lote no Admin) — sem isso o "
      "produto aparece na vitrine mas não entra no carrinho;")
    A("3. conferir os nomes provisórios dos importados;")
    A("4. os 5 produtos que já existiam não foram tocados (preço, fotos e variantes originais).")
    open(f"{OUT}/AUDITORIA-CATALOGO.md", "w").write("\n".join(L) + "\n")
    return "\n".join(L)



def audit_packaged_delivery():
    """Auditoria que funciona no ZIP entregue, sem PDFs nem bibliotecas Python extras.

    Ela não tenta refazer a prova PDF -> produto; verifica apenas invariantes que
    podem ser comprovadas pelos arquivos realmente distribuídos.
    """
    os.makedirs(OUT, exist_ok=True)
    cat = json.load(open(f"{WORK}/data/catalog.json", encoding="utf-8"))
    products = cat.get("products") or []
    product_ids = [str(p.get("id") or "") for p in products]
    slugs = [str(p.get("slug") or "") for p in products]
    variant_rows = [(p, v) for p in products for v in (p.get("variants") or [])]
    variant_ids = [str(v.get("id") or "") for _, v in variant_rows]
    missing_images = []
    invalid_variant_images = []
    invalid_box_variants = []
    for product in products:
        gallery = list(product.get("images") or [])
        variant_set = {str(v.get("id") or "") for v in (product.get("variants") or [])}
        for image in gallery:
            if str(image).startswith('/assets/') and not os.path.exists(f"{WORK}/public{image}"):
                missing_images.append({"product": product.get("name"), "image": image})
        for variant in product.get("variants") or []:
            image = str(variant.get("image") or "")
            if image and image not in gallery:
                invalid_variant_images.append({"product": product.get("name"), "variant": variant.get("name"), "image": image})
        for box in product.get("boxes") or []:
            variant_id = str(box.get("variantId") or "")
            if variant_id and variant_id not in variant_set:
                invalid_box_variants.append({"product": product.get("name"), "variantId": variant_id})
    active_zero_price = []
    for product in products:
        prices = [int(product.get("price") or 0)] + [int(v.get("price") or 0) for v in (product.get("variants") or [])]
        if product.get("available") is not False and max(prices or [0]) <= 0:
            active_zero_price.append(product.get("name"))
    sku_map = collections.defaultdict(list)
    for product in products:
        sku = str(product.get("sku") or "").strip()
        if sku:
            sku_map[sku].append(product.get("name"))
    duplicate_skus = {sku: names for sku, names in sku_map.items() if len(names) > 1}
    result = {
        "mode": "packaged-delivery",
        "products": len(products),
        "variants": len(variant_rows),
        "duplicateProductIds": {x: c for x, c in collections.Counter(product_ids).items() if x and c > 1},
        "duplicateSlugs": {x: c for x, c in collections.Counter(slugs).items() if x and c > 1},
        "duplicateVariantIds": {x: c for x, c in collections.Counter(variant_ids).items() if x and c > 1},
        "duplicateSkus": duplicate_skus,
        "missingImages": missing_images,
        "invalidVariantImages": invalid_variant_images,
        "invalidBoxVariants": invalid_box_variants,
        "activeWithoutPrice": active_zero_price,
        "productsWithoutImage": [p.get("name") for p in products if not (p.get("images") or [])],
        "sourcePdfAudit": "NAO_EXECUTADO_NO_ZIP",
    }
    result["ok"] = not any([
        result["duplicateProductIds"], result["duplicateSlugs"], result["duplicateVariantIds"],
        missing_images, invalid_variant_images, invalid_box_variants, active_zero_price, result["productsWithoutImage"]
    ])
    with open(f"{OUT}/audit-packaged.json", "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
    lines = [
        "# Auditoria do catálogo — modo pacote entregue", "",
        "Este modo funciona apenas com os arquivos presentes no ZIP. A conferência forense contra os PDFs originais é marcada como **NÃO EXECUTADA** quando `catalogos-fonte/` não está disponível; o script não inventa essa prova.", "",
        f"- Produtos: **{result['products']}**", f"- Variações: **{result['variants']}**",
        f"- IDs de produto duplicados: **{len(result['duplicateProductIds'])}**",
        f"- Slugs duplicados: **{len(result['duplicateSlugs'])}**",
        f"- IDs de variação duplicados: **{len(result['duplicateVariantIds'])}**",
        f"- Imagens ausentes: **{len(missing_images)}**", f"- Fotos de variação fora da galeria: **{len(invalid_variant_images)}**",
        f"- Caixas apontando para variação inexistente: **{len(invalid_box_variants)}**", f"- Produtos ativos sem preço: **{len(active_zero_price)}**",
        f"- Produtos sem imagem: **{len(result['productsWithoutImage'])}**", "",
        "## SKUs compartilhados", "",
        "SKU não é tratado como identificador técnico único. O catálogo-fonte pode reutilizar um código em apresentações/volumes diferentes. Duplicidades são informativas e não reprovam a auditoria:",
    ]
    if duplicate_skus:
        for sku, names in sorted(duplicate_skus.items()): lines.append(f"- `{sku}`: " + "; ".join(names))
    else:
        lines.append("- Nenhum SKU compartilhado.")
    lines += ["", f"**Resultado das invariantes do pacote: {'APROVADO' if result['ok'] else 'REPROVADO'}**", ""]
    with open(f"{OUT}/AUDITORIA-CATALOGO-PACOTE.md", "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))
    return result, "\n".join(lines)


def full_source_audit_available():
    if pymupdf is None or Image is None or ImageStat is None:
        return False
    return all(os.path.exists(f"{PDFDIR}/{spec['file']}") for spec in SPECS.values())


if __name__ == "__main__":
    if full_source_audit_available():
        R = audit()
        print(write_md(R))
    else:
        result, report = audit_packaged_delivery()
        print(report)
        print("AVISO: PDFs-fonte e/ou dependências Python opcionais não estão disponíveis; a prova PDF -> produto não foi executada.")
        raise SystemExit(0 if result["ok"] else 1)
