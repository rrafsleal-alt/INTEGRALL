#!/usr/bin/env python3
"""Construe o catalogo importado dos 5 PDFs + extrai as fotos, e faz o merge
com o catalog.json existente da loja.

Saida:
  out/catalog-import.json      -> pronto para "Importar catalogo" no Admin
  out/relatorio.md             -> o que veio, o que ficou faltando
  public/assets/products/pdf/  -> fotos recortadas (webp)

Regras: preco 0 + available:false sempre (os PDFs nao tem preco), nada da loja
existente e perdido nem sobrescrito alem de sku/atributos quando o nome bate.
"""
import json, os, re, sys, unicodedata, statistics
import pymupdf
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import PROJECT_ROOT, SOURCE_PDF_DIR, PRODUCT_ASSET_DIR, EXTRACT_DIR, OUTPUT_DIR

PDF = str(SOURCE_PDF_DIR)
WORK = str(PROJECT_ROOT)
IMG_DIR = str(PRODUCT_ASSET_DIR)
EXTRACT = str(EXTRACT_DIR)
OUT = str(OUTPUT_DIR)
os.makedirs(IMG_DIR, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

ATTR_KEYS = {"wineType","grape","vintage","alcohol","volume","serving","pairing","origin",
             "bean","roast","grind","intensity","weight","method","flavor","kind","sugar",
             "ingredients","storage","quantity","flavors","allergens","shelfLife","minOrder"}


def norm(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def clean(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def slug(s):
    s = re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")
    return s[:55] or "produto"


# ---------------------------------------------------------------- layout utils
def raw_lines(page):
    """Linhas da pagina com bbox e palavras reconstruidas.

    Coexistem dois tipos de texto nesses PDFs:
      * texto corrido normal, em que o PDF emite o caractere de espaco;
      * folhas de rotulo com letter-spacing ("L O R E N A   S E C O"), em que o
        espaco grafica e menor que o espaco real entre palavras, entao a unica
        forma de recuperar as palavras e medir a distancia entre caracteres.

    Para linha letter-spaced descartamos os espacos e quebramos por gap; para as
    demais usamos os espacos do proprio PDF.
    """
    out = []
    for b in page.get_text("rawdict")["blocks"]:
        if b["type"] != 0:
            continue
        for ln in b["lines"]:
            chars = []
            for sp in ln["spans"]:
                for ch in sp.get("chars", []):
                    chars.append((ch["bbox"][0], ch["bbox"][2], ch["c"]))
            if not any(c[2].strip() for c in chars):
                continue
            size = max((sp["size"] for sp in ln["spans"]), default=0)
            bb = ln["bbox"]
            joined = "".join(c[2] for c in chars)
            toks = [t for t in joined.split() if t]
            single = sum(1 for t in toks if len(t) == 1)
            ls = len(toks) >= 4 and single / len(toks) > 0.55
            if ls:
                kept = [c for c in chars if c[2].strip()]
                gaps = [kept[i + 1][0] - kept[i][1] for i in range(len(kept) - 1)]
                pos = [g for g in gaps if g >= 0] or [0]
                med = statistics.median(pos)
                cut = max(med * 1.9, 1.0)
                words = [kept[0][2]]
                for i, g in enumerate(gaps):
                    if g > cut:
                        words.append(kept[i + 1][2])
                    else:
                        words[-1] += kept[i + 1][2]
                text = " ".join(words)
                text = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", text)
                text = re.sub(r"\s*", "", text).replace(":", ": ") if False else text
            else:
                text = re.sub(r"\s+", " ", joined).strip()
            text = clean(text)
            if text:
                out.append({"x0": bb[0], "x1": bb[2], "y0": bb[1], "y1": bb[3],
                            "size": size, "t": text})
    return out


def page_images(page):
    return [{"bbox": i["bbox"], "xref": i.get("xref")} for i in page.get_image_info()
            if i["bbox"][2] - i["bbox"][0] > 18 and i["bbox"][3] - i["bbox"][1] > 18]


def crop_save(page, bbox, key, want_w=900, quality=84):
    """Recorta a regiao da pagina (pt) em alta resolucao e salva webp."""
    r = pymupdf.Rect(*bbox)
    if r.width < 6 or r.height < 6:
        return None
    zoom = max(1.0, min(6.0, want_w / r.width))
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=r, alpha=False)
    # nome deterministico so pela chave -> reprocessar sobrescreve (antes o
    # "while os.path.exists" criava -2/-3/-4 a cada rodada e o catalogo passava
    # a apontar para arquivos que nao existiam mais)
    fn = slug(key) + ".webp"
    path = f"{IMG_DIR}/{fn}"
    tmp = f"{OUT}/.tmp_{os.getpid()}.png"
    pix.save(tmp)
    with Image.open(tmp) as im2:
        img = im2.convert("RGB")
        if img.width > want_w:
            img = img.resize((want_w, max(1, round(img.height * want_w / img.width))), Image.LANCZOS)
        img.save(path, "WEBP", quality=quality, method=4)
    os.remove(tmp)
    try:
        os.chmod(path, 0o644)
    except OSError:
        pass
    return f"/assets/products/pdf/{fn}"


def match_image(page, imgs, cx, cy, band=320):
    cand = [i for i in imgs if i["bbox"][3] <= cy + 14 and i["bbox"][3] > cy - band]
    if not cand:
        cand = imgs
    if not cand:
        return None
    return min(cand, key=lambda i: abs((i["bbox"][0] + i["bbox"][2]) / 2.0 - cx))


def titleize(s, small=("de","da","do","das","dos","e","a","o","em","com","for","d","l")):
    words = clean(s).split(" ")
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        bare = re.sub(r"[^A-Za-zÀ-ÿ]", "", lw)
        if len(w) <= 4 and bare and bare.upper() == w.upper().rstrip(".") and \
           len(bare) <= 4 and lw.rstrip(".") in {"doc","dop","igt","brut","rose","xls"}:
            out.append(w.upper()); continue
        if lw in small and i:
            out.append(lw); continue
        out.append(lw[:1].upper() + lw[1:])
    return " ".join(out)


# =============================================================== BISCOITOS
def parse_biscoitos():
    doc = pymupdf.open(f"{PDF}/Catálogo Biscoitos_compressed.pdf")
    CODE = re.compile(r"C[óo]d\.?\s*([0-9]{2,4}(?:\s*/\s*[0-9]{2,4})?)\s*\|\s*Caixa:\s*([0-9]+(?:,[0-9]+)?)\s*kg", re.I)
    products, seen = [], set()
    for page in doc:
        lines = raw_lines(page)
        codes = []
        for l in lines:
            m = CODE.search(l["t"])
            if m:
                codes.append({**l, "codes": re.split(r"\s*/\s*", m.group(1)),
                              "kg": float(m.group(2).replace(",", "."))})
        names = [l for l in lines if not CODE.search(l["t"]) and l["size"] >= 12]
        subs = [l for l in lines if not CODE.search(l["t"]) and 9.6 <= l["size"] < 12]
        heads = [l for l in lines if l["size"] > 40]
        header = clean(" ".join(h["t"] for h in sorted(heads, key=lambda z: z["y0"])[:1])) if heads else ""
        imgs = page_images(page)

        for c in codes:
            def bucket(rows):
                pick = [n for n in rows if abs((n["x0"] + n["x1"]) / 2 - c["x0"]) < 175
                        and -20 <= c["y0"] - n["y0"] <= 78]
                return " ".join(p["t"] for p in sorted(pick, key=lambda z: z["y0"]))
            name = bucket(names)
            sub = bucket(subs)
            if not name:
                continue
            key = "/".join(c["codes"])
            if key in seen:
                continue
            seen.add(key)
            im = match_image(page, imgs, c["x0"] + 45, c["y0"] - (len(name) // 25) * 10)
            img = crop_save(page, im["bbox"], f"biscoito-{key}-{name}") if im else None
            boxkg = c["kg"]
            variants, vskus = [], c["codes"]
            subnames = [clean(x) for x in re.split(r"(?<=[a-zà-ÿ])\s(?=[A-ZÀ-Ú])", sub) if clean(x)] \
                if sub else []
            if len(vskus) > 1 and len(subnames) == len(vskus):
                for sku, vn in zip(vskus, subnames):
                    variants.append({"id": f"pdf-bis-{sku}", "name": titleize(vn), "price": 0,
                                     "stock": None, "unit": "", "weightGrams": int(boxkg * 1000),
                                     "position": len(variants) + 1})
            prod = {
                "id": f"pdf-bis-{key.replace('/', '-')}",
                "name": titleize(name if not sub or len(vskus) > 1 else name),
                "department": "petit-four",
                "subcategory": titleize(header) or "Biscoitos",
                "brand": "Jurerê",
                "sku": ", ".join(vskus),
                "price": 0,
                "unit": f"Caixa {boxkg:g} kg",
                "description": (f"{titleize(name)}" + (f" — {titleize(sub)}" if sub and len(vskus) <= 1 else "")
                                + f". Caixa de {boxkg:g} kg. Linha {titleize(header)} do catálogo de biscoitos."),
                "images": [img] if img else [],
                "attributes": {"weight": f"{boxkg:g} kg", "quantity": f"caixa {boxkg:g} kg"},
                "weightGrams": int(boxkg * 1000),
                "stock": None, "stockMin": None,
                "available": False, "hidden": False, "featured": False,
                "madeToOrder": False, "seasonal": False, "giftEnabled": True,
                "source": "pdf:Catálogo Biscoitos",
            }
            if variants:
                prod["variants"] = variants
                prod["unit"] = f"Caixa {boxkg:g} kg (por variante)"
                prod["description"] += " O catálogo lista " + " e ".join(titleize(x) for x in subnames) + \
                    f" na mesma caixa, com um código por variante ({', '.join(vskus)})."
            prod["sourcePage"] = page.number + 1
            products.append(prod)
    return products


# =============================================================== VINHOS NACIONAIS
LABEL_WORDS = r"(?:Seco|Suave|Demi[\s-]*Sec|Meio[\s-]*Doce|Doce|Brut|Bruto|Moscatel|Branco|Ros[ée]|Tinto|Bord[ôo]|Ni[áa]gara|Lorena|Isabel|Cabernet|Merlot|Tannat|Chardonnay|Sauvignon|Malbec|Syrah|Pinot|Gamay|Concord|Trebbiano)"


def parse_vinhos_nacionais():
    doc = pymupdf.open(f"{PDF}/Vinhos Nacionais_compressed.pdf")
    products = []
    for page in doc:
        lines = raw_lines(page)
        imgs = page_images(page)
        joined = " ".join(l["t"] for l in lines)
        if not joined.strip():
            continue
        blocks = {}
        for l in lines:
            blocks.setdefault(round(l["y0"] / 9), []).append(l)

        def spec(label):
            m = re.search(label + r"\s*:?\s*([^\n]+?)(?=\s+(?:Produtor|Volume|Regi[ãa]o|Gradua[çc][ãa]o|Teor|C[óo]digo|Castas|Uvas|Safra|Varia[çc][õo]es|C[óo]d|ESPEC|Vin[ho])\b|$)", joined, re.I)
            return clean(m.group(1)) if m else ""

        # --- ficha por pagina (linhas 2-8) ---
        codem = re.search(r"C[óo]digo\s*do\s*produto\s*:?\s*([0-9]{2,4})", joined, re.I)
        codem2 = re.search(r"C[ÓO]D\.?\s*:?\s*([0-9]{3})", joined)
        code = (codem.group(1) if codem else (codem2.group(1) if codem2 else ""))
        big = [l for l in lines if l["size"] >= 16]
        heads = [l for l in lines if l["size"] > 40]
        head = clean(" ".join(h["t"] for h in sorted(heads, key=lambda z: z["y0"])))
        cand = [l["t"] for l in sorted(big, key=lambda z: z["y0"])[:3]]
        name_bits = [t for t in cand if not re.search(r"VINHO|ESPECIFICA|Volume|Produtor|Regi", t, re.I)]
        name = " ".join(name_bits[:2]) or head or titleize(joined.split(" ")[0])

        # paginas de abertura/divisoria viram "produto": so aceita ficha (codigo)
        # ou bloco ESPECIFICACOES com Volume/Teor
        has_spec = bool(re.search(r"Volume\s*:|Teor\s*alco|Gradua", joined, re.I))
        if not code and not has_spec:
            continue
        if not name_bits and not head:
            continue
        if re.fullmatch(r"[^A-Za-zà-ÿ]*", name or ""):
            continue
        if norm(name) in {"marques de mendonca", "marques", "marques de mendonca marques de mendonca"}:
            continue

        desc_m = re.search(r"(?:De corpo|Um [A-ZÀ-Ú]|Leve e|Cl[áa]ssico| Harmon)[^.]*\.[^.]*\.?", joined)
        vol = spec("Volume")
        alc = spec("Gradua[çc][ãa]o alco[óo]lica|Teor alco[óo]lico")
        reg = spec("Regi[ãa]o")
        castas = spec("Castas|Uvas")
        vintage = spec("Safra")
        prod = spec("Produtor")
        variations = spec("Varia[çc][õo]es")

        attrs = {}
        if vol: attrs["volume"] = vol
        if alc: attrs["alcohol"] = alc
        if castas: attrs["grape"] = castas
        if vintage: attrs["vintage"] = vintage
        if reg: attrs["origin"] = reg
        if head: attrs["wineType"] = titleize(head)

        im = match_image(page, imgs, (page.rect.width) / 2, page.rect.height)
        img = crop_save(page, im["bbox"], f"vinho-nac-{code or name}") if im else None

        variants = []
        vols = re.findall(r"([0-9]+(?:,[0-9]+)?\s*(?:ml|L))", vol, re.I) if vol else []
        if not vols and "4,5L" in joined:
            vols = ["4,5L"]
        for v in dict.fromkeys(vols):
            variants.append({"id": f"pdf-vn-{code or slug(name)}-{slug(v)}", "name": v.replace(" ", ""),
                             "price": 0, "stock": None, "unit": "", "weightGrams": None,
                             "position": len(variants) + 1})
        if variations and re.search(r"Seco", variations, re.I) and re.search(r"Suave", variations, re.I):
            for v in ("Seco", "Suave"):
                variants.append({"id": f"pdf-vn-{code or slug(name)}-{v.lower()}", "name": v,
                                 "price": 0, "stock": None, "unit": "", "weightGrams": None,
                                 "position": len(variants) + 1})

        out = {
            "id": f"pdf-vn-{code or slug(name)}",
            "name": titleize(re.sub(r"^(CAVE|CL[Áa]SSICO)\s+", "", clean(name)) or head),
            "department": "vinhos",
            "subcategory": titleize(head) if head and len(head) < 40 else "Vinhos Finos",
            "brand": titleize(prod) if prod else "Marqués de Mendonça",
            "sku": code,
            "imported": False,
            "country": "Brasil",
            "region": clean(reg) or "Serra Gaúcha - RS",
            "price": 0,
            "unit": (vol or "Garrafa 750ml"),
            "description": clean((desc_m.group(0) if desc_m else "") +
                                 (f" {titleize(head)}." if head else "")) or
                            f"{titleize(name)} — Vinhos Nacionais, catálogo Marqués de Mendonça.",
            "images": [img] if img else [],
            "attributes": attrs,
            "weightGrams": 1450 if "750" in (vol or "") else None,
            "lengthCm": 9, "widthCm": 9, "heightCm": 31,
            "stock": None, "stockMin": None,
            "available": False, "hidden": False, "featured": False,
            "madeToOrder": False, "seasonal": False, "giftEnabled": True,
            "source": "pdf:Vinhos Nacionais", "sourcePage": page.number + 1,
        }
        if variants:
            out["variants"] = variants
        if out["name"] and len(out["name"]) > 2:
            products.append(out)

    # --- folhas de rotulo: mesmo produto repetido 3x, agrupar por coluna ---
    return products, doc


def parse_label_sheets():
    """Paginas 12,13,15,16 e 17-33: labels repetidos em grade + espumantes."""
    doc = pymupdf.open(f"{PDF}/Vinhos Nacionais_compressed.pdf")
    found, seen = [], set()
    for page in doc:
        pn = page.number + 1
        if pn < 12 or pn > 33:
            continue
        lines = raw_lines(page)
        imgs = page_images(page)
        if not lines:
            continue
        groups = {}
        for l in lines:
            cx = round((l["x0"] + l["x1"]) / 2 / 150)
            key = (cx,)
            groups.setdefault(key, []).append(l)
        for key, rows in groups.items():
            rows = sorted(rows, key=lambda z: z["y0"])
            text = " ".join(r["t"] for r in rows)
            name_m = re.match(r"^\s*((?:[A-ZÀ-Ú][A-Za-zà-ÿ'&.]+\s*){1,5}?"
                              r"(?:Seco|Suave|Demi[\s-]*Sec|Brut|Bruto|Moscatel|Branco|Ros[ée]"
                              r"|Tinto(?:\s+Gal[ãa]o)?|Gal[ãa]o|Frisante(?:\s+\w+)?|"
                              r"Espumante(?:\s+\w+)*|Lambrusco|Zero[^\s]*|Touriga\w*|Colheita[\s-]*Selecionada))",
                              text, re.I)
            code_m = re.search(r"(?:C[ÓO]D\.?\s*:?\s*|C[óo]digo\s*[:\s])([0-9]{2,4})", text)
            vol_m = re.search(r"Vol(?:ume)?\s*:?\s*([0-9]+(?:,[0-9]+)?\s*(?:ml|L))", text, re.I)
            alc_m = re.search(r"(?:Teor|Gradua[çc][ãa]o)\s*alco[óo]lico\s*:?\s*([0-9]+(?:,[0-9]+)?\s*%[^\s]*)", text, re.I)
            grape_m = re.search(r"(?:Uvas|Castas)\s*:?\s*([^A-Z]{2,60}?)(?=\s+(?:Volume|Vol|Teor|Grad|C[ÓO]D)|$)", text, re.I)
            if not name_m:
                continue
            nm = clean(name_m.group(1))
            code = code_m.group(1) if code_m else ""
            sig = f"{norm(nm)}|{code}"
            if sig in seen:
                continue
            seen.add(sig)
            attrs = {}
            if vol_m: attrs["volume"] = clean(vol_m.group(1))
            if alc_m: attrs["alcohol"] = clean(alc_m.group(1))
            if grape_m: attrs["grape"] = titleize(grape_m.group(1))
            top = rows[0]
            im = match_image(page, imgs, (top["x0"] + top["x1"]) / 2, top["y0"])
            img = crop_save(page, im["bbox"], f"vinho-nac-{code or nm}") if im else None
            found.append({
                "id": f"pdf-vn-{code or slug(nm)}",
                "name": titleize(nm),
                "department": "vinhos",
                "subcategory": "Rótulos / Varietais de Mesa",
                "brand": "Marqués de Mendonça",
                "sku": code,
                "imported": False, "country": "Brasil", "region": "Serra Gaúcha - RS",
                "price": 0,
                "unit": attrs.get("volume", "750ml"),
                "description": f"{titleize(nm)} — rótulo do catálogo Vinhos Nacionais "
                               f"(pág. {pn})" + (f", código {code}" if code else "") + ".",
                "images": [img] if img else [],
                "attributes": attrs,
                "weightGrams": None, "stock": None, "stockMin": None,
                "available": False, "hidden": False, "featured": False,
                "madeToOrder": False, "seasonal": False, "giftEnabled": True,
                "source": "pdf:Vinhos Nacionais (folha de rótulos)", "sourcePage": pn,
            })
    return found


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    result = {}
    if which in ("all", "biscoitos"):
        result["biscoitos"] = parse_biscoitos()
    if which in ("all", "nacionais"):
        a, _ = parse_vinhos_nacionais()
        b = parse_label_sheets()
        seen = {p["id"] for p in a}
        result["nacionais"] = a + [p for p in b if p["id"] not in seen]
    for k, v in result.items():
        print(f"== {k}: {len(v)} produtos")
        for p in v[:6]:
            print("   ", p["sku"], "|", p["name"], "|", p.get("unit"), "|", p.get("variants") and [x["name"] for x in p["variants"]])
    json.dump(result, open(f"{OUT}/stage1.json", "w"), ensure_ascii=False, indent=1)
    print("->", f"{OUT}/stage1.json")
