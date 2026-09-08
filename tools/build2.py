#!/usr/bin/env python3
"""Monta o catalogo importado dos 5 PDFs e faz merge com o catalog.json da loja.

Saida:
  out/catalog-import.json       -> pronto para "Importar catalog" no Admin
  out/relatorio.md              -> o que veio de cada PDF e o que ficou faltando
  public/assets/products/pdf/   -> fotos recortadas (webp)

Politicas:
  * os PDFs nao tem preco -> price 0 e available:false (nada vai ao ar de graca);
  * produto ja existente na loja com o mesmo nome nao e duplicado: e enriquecido
    apenas com sku/atributos e mantem preco, estoque e fotos;
  * nomes/atributos vindos de letter-spacing ou OCR sao marcados para revisao.
"""
import json, os, re, sys, glob, statistics, unicodedata
import pymupdf
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_catalog import (norm, clean, slug, titleize, raw_lines, page_images,
                           crop_save, match_image, parse_biscoitos, PDF, WORK,
                           IMG_DIR, EXTRACT, OUT)

os.makedirs(IMG_DIR, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

KEY_RE = re.compile(r"^\s*(Produtor|Volume|Vol|Regi[oã]o|Teor\s*alco[óo]lico|"
                    r"Gradua[çc][ãa]o\s*alco[óo]lica|Castas|Uvas|Safra|Varia[çc][õo]es|"
                    r"C[óo]digo(?:\s*do\s*produto)?|C[ÓO]D|Origem|Peso|C[óo]d)\s*[:.]?\s", re.I)


# ------------------------------------------------------------------ cartoes
def dedupe_lines(lines, yq=3, xq=6):
    """Os PDFs desenham cada texto 2-3x (sombra/efeito). Dedupe por posicao+texto."""
    seen, out = set(), []
    for l in sorted(lines, key=lambda z: (round(z["y0"] / yq), round(z["x0"] / xq))):
        k = (norm(l["t"]), round(l["x0"] / xq), round(l["y0"] / yq))
        if k in seen:
            continue
        seen.add(k)
        out.append(l)
    return out


def columns(lines, gap=100):
    """Agrupa linhas em colunas (cartoes) pela coordenada X."""
    if not lines:
        return [], []
    ordered = sorted(lines, key=lambda z: z["x0"])
    cols, cur, last = [], [ordered[0]], ordered[0]["x0"]
    for l in ordered[1:]:
        if l["x0"] - last > gap:
            cols.append(cur); cur = []
        cur.append(l); last = max(last, l["x0"])
    if cur:
        cols.append(cur)
    # linhas que se estendem por varias colunas (titulos) viram contexto comum
    wide = [c for c in cols if len(c) == 1 and (c[0]["x1"] - c[0]["x0"]) > 380]
    tight = [c for c in cols if c not in wide]
    return tight, [w[0] for w in wide]


def kv(lines):
    """Extrai pares 'Rotulo: valor' de um bloco de linhas."""
    out, raw = {}, []
    for l in lines:
        t = l["t"]
        m = KEY_RE.match(t)
        if not m:
            raw.append(t)
            continue
        key = m.group(1).lower()
        val = clean(re.sub(KEY_RE.pattern, "", t, flags=re.I))
        canon = {"produtor": "producer", "volume": "volume", "vol": "volume",
                 "região": "region", "regiao": "region", "teor alcoólico": "alcohol",
                 "graduação alcoólica": "alcohol", "castas": "grape", "uvas": "grape",
                 "safra": "vintage", "variações": "variations", "código": "code",
                 "código do produto": "code", "cód": "code", "origem": "origin",
                 "cod": "code", "peso": "weight"}.get(key, key)
        if val:
            out.setdefault(canon, []).append(val)
    return {k: " / ".join(v) for k, v in out.items()}, " ".join(raw)


def code_of(text):
    m = re.search(r"C[óÓdD]\.?\s*(?:do\s*produto\s*)?[:.]?\s*([0-9]{2,4}(?:\s*/\s*[0-9]{2,4})?)", text, re.I)
    return re.sub(r"\s*", "", m.group(1)) if m else ""


def volume_of(text):
    vs = re.findall(r"([0-9]+(?:[.,][0-9]+)?\s*(?:ml|L))\b", text, re.I)
    out, seen = [], set()
    for v in vs:
        v = clean(v).replace(" ", "")
        if v.lower() in seen:
            continue
        seen.add(v.lower()); out.append(v)
    return out


# ============================================ VINHOS (nacionais e importados)
WINE_NOISE = re.compile(r"^(VINHO|ESPECIFICA|C[OÓ]D\b)", re.I)
BRANDISH = re.compile(r"marques ?de ?mendonca|de ?mendonca|^marques$|integrall|@\w|casanarducci|www\.|\bSAC\b|excel", re.I)
CODE_LINE = re.compile(r"^\s*C[ÓO]D\.?\s*:?\s*([0-9]{2,4})\s*$")
CODE_ANY = re.compile(r"C[óÓ]digo(?:\s*do\s*produto)?\s*[:.]?\s*([0-9]{2,4})", re.I)
SPEC_ANY = re.compile(r"^(Volume|Vol|Teor\s*alco|Gradua[çc][ãa]o|Regi[ãa]o|Uvas|Castas|Safra|Produtor|Varia[çc][õo]es)\b", re.I)


def _code(line):
    m = CODE_LINE.match(line["t"]) or CODE_ANY.search(line["t"])
    return m.group(1) if m else ""


def _pick_name(card, allow_small):
    def usable(l):
        return (not KEY_RE.match(l["t"]) and not WINE_NOISE.match(l["t"])
                and not BRANDISH.search(l["t"]) and not CODE_LINE.match(l["t"])
                and not re.match(r"^[A-Za-zÀ-ÿ ]+\s*:\s*$", l["t"])
                and not re.search(r"%\s*v\s*/\s*v", l["t"], re.I))
    big = [l for l in card if l["size"] >= 13 and usable(l)]
    if not big and allow_small:
        big = [l for l in card if usable(l)]
    words, out = set(), []
    for l in sorted(big, key=lambda z: z["y0"]):
        if norm(l["t"]) in words:
            continue
        words.add(norm(l["t"]))
        out.append(clean(l["t"]))
        if len(out) == 3:
            break
    return " ".join(out)


def _fallback_name(kvv):
    """Nome quando o rotulo e so imagem: monta com uva/variacao/volume."""
    bits = []
    for k in ("variations", "grape"):
        v = kvv.get(k)
        if v:
            bits += re.findall(r"[A-Za-zÀ-ÿ]{3,}", v)[:2]
    for v in volume_of(kvv.get("volume", "")):
        bits.append(v)
    return clean(" ".join(titleize(b) for b in bits))


def parse_wine_pdf(path, sub_fallback, brand_fallback, source_tag, country=None, imported=False):
    doc = pymupdf.open(path)
    products = []
    for page in doc:
        pn = page.number + 1
        lines = dedupe_lines(raw_lines(page))
        if not lines:
            continue
        imgs = page_images(page)
        anchors = []
        for l in lines:
            c = _code(l)
            if c:
                anchors.append({"code": c, "x": (l["x0"] + l["x1"]) / 2, "y": l["y0"]})
        seen, uniq = set(), []
        for a in sorted(anchors, key=lambda z: z["x"]):
            if a["code"] in seen:
                continue
            seen.add(a["code"]); uniq.append(a)
        cards = []
        page_specs = [l for l in lines if SPEC_ANY.match(l["t"])]
        if len(uniq) > 1:
            for a in uniq:
                col = [l for l in lines if abs((l["x0"] + l["x1"]) / 2 - a["x"]) < 95
                       and a["y"] - 80 <= l["y0"] <= a["y"] + 45]
                cards.append({"code": a["code"], "lines": col + page_specs,
                              "x": a["x"], "y": a["y"], "multi": True})
        else:
            a = uniq[0] if uniq else {"code": "", "x": sum(l["x0"] for l in lines) / len(lines),
                                      "y": min(l["y0"] for l in lines)}
            cards.append({"code": a["code"], "lines": lines, "x": a["x"], "y": a["y"], "multi": False})

        for card in cards:
            body = [l for l in card["lines"]]
            if not body:
                continue
            if not card["code"] and not any(SPEC_ANY.match(l["t"]) for l in body):
                continue  # pagina de abertura / divisoria
            kvv, _ = kv(body)
            name = _pick_name(body, card["multi"])
            if not name:
                name = _fallback_name(kvv)
            if not name or BRANDISH.search(name):
                continue
            vol = volume_of(kvv.get("volume") or " ".join(l["t"] for l in body))
            attrs = {}
            for src, dst in (("grape", "grape"), ("alcohol", "alcohol"), ("vintage", "vintage"),
                             ("region", "origin"), ("volume", "volume")):
                if kvv.get(src):
                    attrs[dst] = clean(kvv[src])[:100]
            style = next((clean(l["t"]) for l in body if re.match(r"^VINHO\s", l["t"], re.I)), "")
            if style:
                attrs["wineType"] = titleize(style)[:80]
            prose = " ".join(l["t"] for l in body if 8.5 <= l["size"] < 13
                             and not KEY_RE.match(l["t"]) and not WINE_NOISE.match(l["t"]))
            desc = clean(re.sub(r"^\s*" + re.escape(name), "", prose, flags=re.I))[:1100]
            img = None
            im = match_image(page, imgs, card["x"], card["y"] + 60, band=100_000)
            if im:
                img = crop_save(page, im["bbox"], f"{source_tag}-{card['code'] or name}")
            prod = {
                "id": f"pdf-{source_tag}-{card['code'] or slug(name)}",
                "name": titleize(name)[:150],
                "department": "vinhos", "subcategory": sub_fallback,
                "brand": titleize(kvv.get("producer") or brand_fallback)[:110],
                "sku": card["code"], "imported": imported, "country": country,
                "price": 0, "unit": (vol[0] if vol else "Garrafa 750ml"),
                "description": desc or f"{titleize(name)} — catálogo {source_tag}.",
                "images": [img] if img else [], "attributes": attrs,
                "weightGrams": 1450 if any("750" in v for v in vol) else None,
                "lengthCm": 9, "widthCm": 9, "heightCm": 31,
                "stock": None, "stockMin": None,
                "available": False, "hidden": False, "featured": False,
                "madeToOrder": False, "seasonal": False, "giftEnabled": True,
                "source": f"pdf:{source_tag}", "sourcePage": pn,
                "_vols": vol, "_var": kvv.get("variations", ""),
            }
            products.append(prod)

    # mescla cartoes repetidos em paginas diferentes (mesmo vinho, volumes !=)
    merged = {}
    for p in products:
        key = (norm(re.sub(r"\b\d+(?:[.,]\d+)?\s*(?:ml|l)\b", "", p["name"], flags=re.I)), p["sku"])
        cur = merged.get(key)
        if not cur:
            merged[key] = p
            continue
        cur["_vols"] = list(dict.fromkeys(cur["_vols"] + p["_vols"]))
        for k in ("description", "unit"):
            if len(p.get(k) or "") > len(cur.get(k) or ""):
                cur[k] = p[k]
        for a, v in p["attributes"].items():
            cur["attributes"].setdefault(a, v)
        if not cur["images"] and p["images"]:
            cur["images"] = p["images"]
    out = []
    for p in merged.values():
        vols, var = p.pop("_vols"), p.pop("_var")
        variants = []
        for v in vols[:2]:
            variants.append({"id": f"{p['id']}-v{len(variants) + 1}", "name": v, "price": 0,
                             "stock": None, "unit": "", "weightGrams": None,
                             "position": len(variants) + 1})
        if re.search(r"Seco", var, re.I) and re.search(r"Suave", var, re.I):
            for v in ("Seco", "Suave"):
                variants.append({"id": f"{p['id']}-v{len(variants) + 1}", "name": v, "price": 0,
                                 "stock": None, "unit": "", "weightGrams": None,
                                 "position": len(variants) + 1})
        if variants:
            p["variants"] = variants
        out.append(p)
    return out


# ===================================================================== SUCOS
# Pagina par: rotulo (OCR) + pagina de beneficios (texto vetorial limpo).
SUCO_PAGES = {4: "Uva Tinto", 6: "Uva Branco", 8: "Tangerina", 10: "Maçã",
              12: "Pink Lemonade", 14: "Goiaba", 16: "Laranja", 18: "Tomate Condimentado"}


def parse_sucos():
    ocr = {p["page"]: p for p in json.load(open(f"{EXTRACT}/sucos.ocr.json"))}
    vec = {p["page"]: p["text"] for p in json.load(open(f"{EXTRACT}/sucos.json"))}
    doc = pymupdf.open(f"{PDF}/Sucos_compressed.pdf")
    products = []
    for pn, flavor in SUCO_PAGES.items():
        page = doc[pn - 1]
        lines = sorted(ocr.get(pn, {}).get("lines", []), key=lambda z: z["y0"])
        # nome do rotulo: linhas "SUCO DE" / "TOMATE" etc acima de y=210
        label = [l["t"] for l in lines if l["y0"] < 215 and not re.search(r"MARQUES|MENDONCA", l["t"], re.I)]
        label = [t for t in label if not re.fullmatch(r"[A-Za-zÀ-ÿ]{1,3}", t.strip())]
        ocr_name = clean(" ".join(label))
        desc_bits = []
        for extra in (pn + 1, pn + 2):
            t = clean(vec.get(extra, ""))
            if t and "ELABORADO" not in t.upper()[:12]:
                desc_bits.append(t)
        desc = clean(" ".join(desc_bits))[:1100]
        m = re.search(r"[O0]?\s*suco\s+d[ée]\s+([^.]{20,600})", desc, re.I)
        intro = clean(m.group(0)) if m else ""
        imgs = page_images(page)
        big = sorted(imgs, key=lambda i: -(i["bbox"][2] - i["bbox"][0]) * (i["bbox"][3] - i["bbox"][1]))
        img = crop_save(page, big[0]["bbox"], f"suco-{slug(flavor)}") if big else None
        attrs = {"flavor": titleize(flavor), "kind": "100% Integral",
                 "sugar": "Sem adição de açúcar"}
        m2 = re.search(r"ELABORADO COM ([^.(]{3,60})", " ".join(vec.values()), re.I)
        if flavor == "Uva Tinto" and m2:
            attrs["ingredients"] = clean(m2.group(1))[:80]
        products.append({
            "id": f"pdf-suco-{slug(flavor)}",
            "name": titleize(f"Suco Integral {flavor}")[:150],
            "department": "sucos",
            "subcategory": titleize(flavor)[:90],
            "brand": "Marqués de Mendonça",
            "sku": "", "imported": False,
            "price": 0,
            "unit": "Garrafa 1L e 300ml",
            "description": (intro or desc or f"Suco 100% integral de {titleize(flavor).lower()}.").replace("  ", " ")[:1200],
            "images": [img] if img else [],
            "attributes": attrs,
            "weightGrams": 1500, "lengthCm": 9, "widthCm": 9, "heightCm": 32,
            "stock": None, "stockMin": None,
            "available": False, "hidden": False, "featured": False,
            "madeToOrder": False, "seasonal": False, "giftEnabled": True,
            "source": "pdf:sucos", "sourcePage": pn,
            "_label": ocr_name,
        })
    return products


# ===================================================================== CAFES
CAFE_NAME = re.compile(r"^(CAF[ÉE]E?|VO|V[OÔ])\b", re.I)
CAFE_NOISE = re.compile(r"JURERE|CAF[EÉ]S?\s*ESPECIAIS|ABRA|SURPREENDA|INTENSO|NOTAS|VARIEDADE|ORIGEM|TORRA|CORPO|PESO|100%|AR[ÁA]BICA|\d+\s*(PTS|G)|DE$|UMA$|XAO|LIXAO|IKAO|\bDO$|^\W", re.I)


def parse_cafe():
    ocr = {p["page"]: p for p in json.load(open(f"{EXTRACT}/cafe.ocr.json"))}
    doc = pymupdf.open(f"{PDF}/Café Jurerê_compressed.pdf")
    products, ids = [], set()
    NOISE = re.compile(r"JURERE|ESPECIAIS|SURPREENDA|ABRA|\bpts\b|^\W+$|^[A-Za-z]{1,4}$|"
                       r"TORRADO|MO[IÍ]DO|EMOIDO|EMGRAOS|EM ?GRAOS|PESO|LIQUIDO|\d", re.I)
    for pg in sorted(ocr.values(), key=lambda z: z["page"]):
        pn = pg["page"]
        if pn == 1:
            continue
        lines = sorted(pg["lines"], key=lambda z: z["y0"])
        uniq = []
        seen = set()
        for l in lines:
            k = norm(l["t"])
            if k and k not in seen:
                seen.add(k); uniq.append(l)
        up = " ".join(l["t"].upper() for l in uniq)
        # nome = primeira linha util depois do cabecalho "CAFES ESPECIAIS"
        name = ""
        anchor = next((i for i, l in enumerate(uniq) if re.search(r"ESPECIAIS", l["t"], re.I)), None)
        if anchor is not None:
            for l in uniq[anchor + 1:anchor + 5]:
                t = clean(l["t"])
                if NOISE.search(t):
                    continue
                if re.match(r"^(CAF[EÉ]E?|VO|V[OÔ])[A-ZÀ-Ú\s'-]*$", t.upper()):
                    name = t
                    break
        elif pn == 9:  # folha da linha drip: varios nomes
            name = ""
        if not name:
            continue
        name = name.upper().replace("CAFEDA", "CAFE DA").replace("CAFEDO", "CAFE DO") \
                   .replace("CAFEDAROSI", "CAFE DA ROSI")
        m = re.match(r"^(CAF[EÉ]E?|VO|V[OÔ])\s*(.*)$", name, re.I)
        if m:
            head = {"CAFEE": "Café", "CAFE": "Café", "CAFÉ": "Café", "VO": "Vô", "VÔ": "Vô"} \
                .get(m.group(1).upper(), titleize(m.group(1)))
            name = clean(f"{head} {m.group(2)}")
        name = re.sub(r"(?i)^cafe\s*(da|do|das|dos)(?=[A-ZÀ-Ú])", r"cafe \1 ", name)
        name = re.sub(r"(?i)\bdarosi\b", "da Rosi", name)
        name = titleize(re.sub(r"\bDa\b", "da", re.sub(r"\bDo\b", "do", name), flags=re.I)) \
            .replace("Irmao", "Irmão")
        pid = f"pdf-cafe-{slug(name)}"
        if pid in ids or len(name) < 6:
            continue
        ids.add(pid)
        attrs = {}
        if m := re.search(r"\b(\d{2,4})\s*G\b", up):
            attrs["weight"] = f"{m.group(1)} g"
        if m := re.search(r"(\d{2,3})\s*PTS", up):
            attrs["intensity"] = f"{m.group(1)} pts"
        if m := re.search(r"TORRA\s*(M[ÉE]DIA\s*CLARA|CLARA|M[ÉE]DIA|ESCURA)", up):
            attrs["roast"] = titleize(m.group(1))
        if m := re.search(r"VARIEDADE\s*([A-ZÀ-Ú]{3,}(?:\s+[A-ZÀ-Ú]{3,})?)", up):
            attrs["bean"] = titleize(m.group(1))
        if m := re.search(r"ORIGEM\s*([A-ZÀ-Ú]{3,}(?:\s+[A-ZÀ-Ú]{3,}){0,2})", up):
            attrs["origin"] = titleize(m.group(1))
        if re.search(r"100%\s*ARA? ?BICA", up):
            attrs["kind"] = "100% Arábica"
        if re.search(r"EM ?GRAOS", up):
            attrs["method"] = "Em grãos"
        elif re.search(r"MO[IÍ]DO|EMOIDO", up):
            attrs["method"] = "Torrado e moído"
        notes = [l["t"] for l in uniq if re.search(
            r"CHOCOLATE|CARAMELO|FLORAIS|JASMIN|ROSA|LARANJEIRA|BAunilha|AMORA|FRAMBOESA|"
            r"BANANA|AVERLA|VELA|CITRICA|TANGERINA|LIMAO|MEL\b|ACIDEZ|CORPO", l["t"], re.I)
            and not NOISE.search(l["t"])]
        grams = int(re.search(r"(\d{2,4})\s*G\b", up).group(1)) if re.search(r"(\d{2,4})\s*G\b", up) else None
        page = doc[pn - 1]
        imgs = page_images(page)
        big = sorted(imgs, key=lambda i: -(i["bbox"][2] - i["bbox"][0]) * (i["bbox"][3] - i["bbox"][1]))
        img = crop_save(page, big[0]["bbox"], f"cafe-{slug(name)}") if big else None
        products.append({
            "id": pid, "name": name[:150], "department": "cafes",
            "subcategory": "Cafés Especiais", "brand": "Jurerê",
            "sku": "", "imported": False, "price": 0,
            "unit": (f"Pacote {grams} g" if grams else "Pacote 250 g"),
            "description": (f"Café especial Jurerê — {name.lower()}."
                            + (f" Notas: {titleize(' '.join(notes[:5]))}." if notes else "")
                            + " Características lidas por OCR da embalagem — conferir."),
            "images": [img] if img else [], "attributes": attrs,
            "weightGrams": grams, "lengthCm": 12, "widthCm": 8, "heightCm": 22,
            "stock": None, "stockMin": None,
            "available": False, "hidden": False, "featured": False,
            "madeToOrder": False, "seasonal": False, "giftEnabled": True,
            "source": "pdf:cafe (OCR)", "sourcePage": pn,
        })
    return products


# ============================================== IMPORTADOS (codigo na imagem)
IMP_SKIP = re.compile(r"PORTUGAL|FRAN[ÇC]A|CHILE|ESPANHA|ITALIA|ARGENTINA|AFRICADOSUL|"
                      r"LISBOA|VERDE|DOURO|\bDAO\b|BEIRA|ATLANTICO|CANTANHEDE|LEIRIA|"
                      r"ALENTEJO|BAIRRADA|LANGUEDOC|ROUSSILLON|RHONE|EXTREMADURA|WINES|"
                      r"VINICOLA|ADEGA|BODEGA|GLOBAL|CENTRAL|VALLE|\bDOC\b|D\.O\.|WESTERN|"
                      r"CAPE|MENDOZA|ABRUZZO|LOMBARDIA|VENETO|SICILIA|COLHEITA|SELECIONADA", re.I)
IMP_NOISE = re.compile(r"^\s*(C[ÓO]D|Volume|Vol|Teor|Castas|Uvas|Origem|Regi|Safra|Produtor|"
                       r"ESPEC|D\.O\.|Baixas|Vinicola|Adega|Bodega|CHILE|PORTUGAL|FRANCA|"
                       r"ESPANHA|ITALIA|ARGENTINA|AFRICA|WINE|VIN|PRODUTO|PREMIOS|AWARDS)", re.I)


STYLE_RE = re.compile(r"(?i)^\s*(tinto|branco|ros[eé]|rose|espumante|espalhante|demi|seco|suave|doce|dry|brut|extra\s*brut|tinto\s*seco|branco\s*seco|colheita)\s*\.?\s*$")
STYLE = STYLE_RE  # aceito tanto STYLE.match(x) quanto re.match(STYLE, x)


def _imp_readable(t, glued=False):
    """Arruma texto de rotulo: OCR cola as palavras ('Pescadabranco,docverde')."""
    t = clean(t)
    if glued:
        t = re.sub(r",", ", ", t)
        t = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", t)
        t = re.sub(r"(?i)\bdoc\b", "DOC", t)
        t = re.sub(r"(?i)\bdao\b", "Dão", t)
        t = re.sub(r"(?i)\b(doc ?verde|verde)\b", lambda m: "DOC Verde" if "doc" in m.group(1).lower() else m.group(1), t)
        t = re.sub(r"(?i)\bcolheita ?selecionada\b", "Colheita Selecionada", t)
        t = re.sub(r"(?i)\b(la ?vache)\b", "La Vache", t)
        t = re.sub(r"(?i)\bespagnole\b", "Espagnole", t)
        for _w in ("Espagnole", "Branco", "Rosé", "Rose", "Tinto", "Selecionada", "Touriga",
                   "Nacional", "Malbec", "Cabernet", "Sauvignon", "Chardonnay", "Syrah",
                   "Pinotage", "Moscatel", "Reserva", "Premium", "Colheita", "Verde", "Dão",
                   "Florista", "Artolas", "Intimista", "Rabbit", "Clássico", "Rubi", "Lalo"):
            t = re.sub(r"(?<=[a-zà-ÿ])" + re.escape(_w.lower()) + r"(?=$|[^A-ZÀ-Ý])",
                       " " + _w, t, flags=re.I)
        t = re.sub(r"(?i)\bpesca ?da\b", "Pesca Da", t)
        t = re.sub(r"(?i)\bcabriz\b", "Cabriz", t)
    t = re.sub(r"\s*\.\s*", ". ", t)
    t = re.sub(r"\s*\|\s*", " — ", t)
    t = re.sub(r"\s+", " ", t).strip(" .,")
    out = titleize(t)
    for sig in ("DOC", "D.O.", "I.G.P.", "BIO", "VDP", "IGP"):
        out = re.sub(r"(?i)\b" + re.escape(sig) + r"\b", sig, out)
    out = re.sub(r"(?i)\bdao\b", "Dão", out)
    return out[:120]


def _imp_code_lines(lines):
    out = []
    for i, l in enumerate(lines):
        m = re.fullmatch(r"C[ÓO]D\.?\s*:?\s*([0-9]{3})", clean(l["t"]).replace(" ", ""))
        if m:
            out.append((i, m.group(1)))
    return out


def _imp_label_like(t, page_top=1e9, y=0):
    t = clean(t)
    if not t or len(t) < 5 or len(t) > 70:
        return False
    if re.fullmatch(r"C[ÓO]D\.?\s*:?\s*[0-9]{3}", t, re.I):
        return False
    if IMP_NOISE.match(t) or IMP_SKIP.fullmatch(t.upper().strip()):
        return False
    # cabeçalho de seção ("PORTUGAL . BARRADA . ... . DA PIPA") nunca é nome de rótulo
    if y - page_top < 40 and re.search(r"\.|PORTUGAL|CHILE|ESPANHA|ITALIA|ARGENTINA|FRAN", t, re.I):
        return False
    return bool(re.search(r"[A-Za-zÀ-ÿ]{4}", t))


def parse_importados():
    """Catálogo de importados.

    O PDF tem dois tipos de página:
      * "folha de etiquetas": grade de rótulos desenhados, cada um com um
        "C[ÓO]D nnn" embaixo — o país/vinícola está na página de abertura da
        seção (às vezes só na imagem);
      * página de ficha: "NOME DO RÓTULO" na linha ao lado do "C[ÓO]D nnn",
        seguido de Teor alcoólico / Volume / Castas Uvas.

    Duas passadas: primeiro juntamos as fichas (fonte confiável de nome),
    depois varremos todos os códigos de todas as páginas — assim um código que
    aparece na etiqueta E na ficha vira UM produto, com nome da ficha e foto da
    etiqueta. A foto de cada garrafa é recortada entre os pontos médios dos
    códigos vizinhos, porque a grade inteira é uma imagem só.
    """
    doc = pymupdf.open(f"{PDF}/Vinhos importados_compressed.pdf")
    ocr = {}
    try:
        ocr = {x["page"]: x["lines"] for x in json.load(open(f"{EXTRACT}/vinhosimportados.ocr.json"))}
    except Exception:
        pass

    ocr_all = {}
    try:
        ocr_all = {x["page"]: x["lines"] for x in json.load(open(f"{EXTRACT}/vinhosimportados.ocr.json"))}
    except Exception:
        ocr_all = {}

    def as_lines(rows):
        out = []
        for l in rows:
            t = clean(l.get("t") or "")
            if not t or float(l.get("c") or 0) < 0.5:
                continue
            out.append({"t": t, "x0": l["x0"], "y0": l["y0"], "x1": l["x1"], "y1": l["y1"],
                        "size": max(6.0, (l["y1"] - l["y0"]) * 0.85)})
        return out

    # numero -> {"lines", "codes", "ctx"}; paginas cuja ficha esta DENTRO da
    # imagem (sem texto vetor) sao lidas pelo OCR, senao fichas inteiras como as
    # de Cabriz/Pesca Da/La Vache Espagnole ficavam sem produto
    pages = {}
    for page in doc:
        pn = page.number + 1
        vec = dedupe_lines(raw_lines(page))
        lines = sorted(vec, key=lambda z: (round(z["y0"] / 6), z["x0"]))
        codes = _imp_code_lines(lines)
        src = "vetor"
        if not codes and pn in ocr_all:
            lines = sorted(as_lines(ocr_all[pn]), key=lambda z: (round(z["y0"] / 6), z["x0"]))
            lines = dedupe_lines(lines)
            codes = _imp_code_lines(lines)
            src = "ocr"
            if len(codes) < 1:
                continue
        elif not vec:
            continue
        pages[pn] = {"lines": lines, "codes": codes, "src": src}

    # ---------- contexto por secao (pagina de abertura -> folhas seguintes) ----
    geo = re.compile(r"PORTUGAL|FRAN[ÇC]A|CHILE|ESPANHA|ITALIA|ARGENTINA|AFRICA|WESTERN|CAPE|"
                     r"LISBOA|VERDE|DOURO|\bDAO\b|BEIRA|ATLANTICO|CANTANHEDE|LEIRIA|ALENTEJO|"
                     r"BAIRRADA|LANGUEDOC|ROUSSILLON|RHONE|EXTREMADURA|WINES|VINICOLA|ADEGA|"
                     r"BODEGA|GLOBAL|CENTRAL|VALLE|\bDOC\b|D\.O|AZIENDA|CANTINE|CASTILLO|"
                     r"MENDOZA|ABRUZZO|LOMBARDIA|VENETO|SICILIA|COLHEITA|SELECIONADA", re.I)
    ctx = {"producer": "", "line": "", "country": "", "region": ""}
    for pn in sorted(pages):
        info = pages[pn]
        top = sorted(info["lines"], key=lambda z: z["y0"])
        head = clean(" ".join(l["t"] for l in top[:3]))
        ocr_lines = sorted(ocr_all.get(pn, []), key=lambda z: z["y0"])
        ocr_head = clean(" ".join(l.get("t", "") for l in ocr_lines[:3]))
        alltext = f"{head} {ocr_head} " + " ".join(l["t"] for l in info["lines"])
        if re.search(r"(?i)(PORTUGAL|FRAN[ÇC]A|CHILE|ESPANHA|ITALIA|ARGENTINA|AFRICA ?DO ?SUL)",
                     f"{head} {ocr_head}") and (head.strip() or ocr_head.strip()):
            # comeca uma secao nova: nada de herdar regiao do produtor anterior
            if not ctx.get("_sect") or ctx["_sect"] != clean(head)[:40]:
                ctx["region"] = ""
                ctx["_sect"] = clean(head)[:40]
        m = re.search(r"(VIN[ÍI]COLA [A-ZÀ-Ú][A-ZÀ-ÿ ]{2,25}|VINICOLA[A-ZÀ-Ú][A-ZÀ-ÿ ]{2,20}|"
                      r"ADEGA DE [A-ZÀ-Ú][A-ZÀ-ÿ ]{2,25}|BODEGA [A-ZÀ-Ú][A-ZÀ-ÿ ]{2,25}|"
                      r"AZIENDA [A-ZÀ-Ú][A-ZÀ-ÿ ]{2,25}|CASTILLO DE [A-ZÀ-Ú][A-ZÀ-ÿ ]{2,20}|"
                      r"CANTINA [A-ZÀ-Ú][A-ZÀ-ÿ ]{2,20}|[A-ZÀ-Ú][A-ZÀ-ÿ ]{3,20}WINES)",
                      f"{head} {ocr_head}".upper(), re.I)
        if m:
            ctx["producer"] = clean(m.group(1)).title()
        for l in top[:4] + ocr_lines[:3]:
            raw = clean(l["t"])
            if raw.count(".") < 2 and len(raw.split()) < 3:
                continue
            parts = [x.strip() for x in re.split(r"[.]+", raw.upper()) if x.strip()]
            tail = [x for x in parts if not geo.search(x)]
            if tail:
                ctx["line"] = clean(" ".join(tail[:2])).title()
                break
        for k, c in ((r"\bPORTUGAL\b", "Portugal"), (r"FRAN[ÇC]A|FRANCE", "França"),
                     (r"\bCHILE\b", "Chile"), (r"\bESPANHA\b", "Espanha"),
                     (r"\bITALIA\b", "Itália"), (r"\bARGENTINA\b", "Argentina"),
                     (r"AFRICA ?DO ?SUL", "África do Sul")):
            if re.search(k, alltext, re.I):
                ctx["country"] = c
                break
        info.setdefault("ctx", dict(ctx))
        m = re.search(r"(VALLE CENTRAL|BEIRA ATL[ÃA]NTICO|LANGUEDOC ?ROUSSILLON|COTES ?DU ?RHONE|"
                      r"EXTREMADURA|WESTERN CAPE|MENDOZA|ABRUZZO|LOMBARDIA|DOC ?VERDE|ALENTEJO|"
                      r"\bDOURO\b|LISBOA|BAIRRADA|CANTANHEDE|\bDAO\b)", alltext, re.I)
        if m:
            ctx["region"] = titleize(clean(m.group(1)))
        # o contexto vale daqui para frente; a pagina que traz o cabecalho usa o
        # cabecalho DELA (folhas de rotulo podem ser de outro pais)
        info["ctx"] = dict(ctx)

    # ------------------------------ passada 1: fichas -------------------------
    detail = {}
    for pn, info in pages.items():
        lines, codes = info["lines"], info["codes"]
        page_top = min(l["y0"] for l in lines) if lines else 0
        page_style = ""
        for k, (i, code) in enumerate(codes):
            ref = lines[i]
            cx = (ref["x0"] + ref["x1"]) / 2
            cy = ref["y0"]
            # as fichas ficam em colunas: o nome esta logo ACIMA (ou a esquerda)
            # do codigo DENTRO da mesma coluna, nao na linha anterior da pagina
            cand = [l for l in lines
                    if abs((l["x0"] + l["x1"]) / 2 - cx) < 120 and l is not ref
                    and -60 <= l["y0"] - cy <= 4 and _imp_label_like(l["t"], page_top, l["y0"])]
            style = ""
            if any(re.match(STYLE, clean(l["t"]).strip()) for l in cand):
                style = next(clean(l["t"]) for l in cand if re.match(STYLE, clean(l["t"]).strip()))
                cand = [l for l in cand if not re.match(STYLE, clean(l["t"]).strip())]
            cand.sort(key=lambda l: l["y0"])          # o rotulo e a linha mais acima
            prev, py = (cand[-1]["t"], cand[-1]["y0"]) if cand else ("", 0)
            page_style = style
            if not cand:
                below = [l for l in lines
                         if abs((l["x0"] + l["x1"]) / 2 - cx) < 120 and l is not ref
                         and 4 < l["y0"] - cy <= 26 and _imp_label_like(l["t"], page_top, l["y0"])]
                below.sort(key=lambda l: abs(l["y0"] - cy))
                prev, py = (below[0]["t"], below[0]["y0"]) if below else ("", 0)
            if not _imp_label_like(prev, page_top, py):
                continue
            col_codes = [l["y0"] for l in lines
                         if re.fullmatch(r"C[ÓO]D\.?\s*:?\s*[0-9]{3}", clean(l["t"]).replace(" ", ""))
                         and abs((l["x0"] + l["x1"]) / 2 - cx) < 120 and l["y0"] > cy + 2]
            bottom = (min(col_codes) - 2) if col_codes else (cy + 90)
            spec = [l for l in lines
                    if abs((l["x0"] + l["x1"]) / 2 - cx) < 120 and 2 <= l["y0"] - cy <= bottom - cy]
            attrs = {}
            for lab, rx, cap in (
                    ("grape", r"^Castas\s*Uvas\s*:?\s*(.+)$", 90),
                    ("alcohol", r"^Teor\s*alco[óo]lico\s*:?\s*([0-9]+(?:,[0-9]+)?\s*%[vVwW/]*)", 40),
                    ("volume", r"^Volume\s*:?\s*([0-9]{1,2}\s*[xX]\s*[0-9]{2,4}\s*ml|"
                              r"[0-9]{1,2}\s*[xX]\s*[0-9]{2,4}\s*[cC][lL]|[0-9]+(?:[.,][0-9]+)?\s*(?:ml|L))", 40),
                    ("origin", r"^(?:Origem|Regi[ãa]o|D\.O\.?)\s*:?\s*"
                              r"([A-ZÀ-Ú][A-Za-zÀ-ÿ ]{3,40}?)(?=\s+(?:Volume|Teor|Castas|C[ÓO]D|\bD\.O\b|$))", 60)):
                for l in spec:
                    m = re.match(rx, clean(l["t"]), re.I)
                    if m:
                        attrs.setdefault(lab, clean(m.group(1))[:cap])
                        break
            blob = " ".join(clean(l["t"]) for l in spec)
            m = re.search(r"Teor\s*alco[óo]lico\s*:?\s*([0-9]+(?:,[0-9]+)?\s*%)", blob, re.I)
            if m and "alcohol" not in attrs:
                attrs["alcohol"] = clean(m.group(1))
            m = re.search(r"Volume\s*:?\s*([0-9]{1,2}\s*[xX]\s*[0-9]{2,4}\s*ml)", blob, re.I)
            if m and "volume" not in attrs:
                attrs["volume"] = clean(m.group(1))
            if "grape" in attrs:
                attrs["grape"] = titleize(re.split(r"(?i)\bcastas\b", attrs["grape"])[0])
            for kk in ("origin", "volume"):
                if attrs.get(kk):
                    attrs[kk] = re.sub(r"(?i)\s+(volume|teor|castas|code)\s*$", "", attrs[kk]).strip()
            name = _imp_readable(prev, pages[pn].get("src") == "ocr")
            if page_style and not attrs.get("wineType"):
                attrs["wineType"] = titleize(clean(page_style))
            # um codigo aparece 2x na pagina (na grade de etiquetas e na ficha).
            # A ficha e a que tem Teor/Castas -> pontua mais que um texto solto
            # de marketing que por acaso fica em cima da etiqueta.
            score = len(attrs) * 3 + min(len(name), 40)
            if re.search(r"(?i)[a-z]{7,}", name) and " " not in name.strip():
                score -= 6          # uma palavra so, provavelmente lixo de OCR
            cur = detail.get(code)
            if not cur or score > cur["score"]:
                detail[code] = {"name": name, "attrs": attrs, "page": pn, "score": score,
                                "x": (lines[i]["x0"] + lines[i]["x1"]) / 2,
                                "trusted": True, "blk": blob}

    # --------------------- passada 2: todo codigo vira 1 produto ---------------
    products, ids, seen_code = [], set(), set()
    for pn, info in pages.items():
        lines, codes = info["lines"], info["codes"]
        if not codes:
            continue
        c = info["ctx"]
        anchors = []
        for i, code in codes:
            if code in seen_code:
                continue
            seen_code.add(code)
            anchors.append({"code": code, "i": i,
                            "x": (lines[i]["x0"] + lines[i]["x1"]) / 2, "y": lines[i]["y0"]})
        if not anchors:
            continue
        imgs = page_images(doc[pn - 1])
        ocr_lines = sorted(ocr.get(pn, []), key=lambda z: z["y0"])
        sheet = len(anchors) >= 2
        for a in anchors:
            code = a["code"]
            d = detail.get(code)
            own = (d or {}).get("blk", "")
            # janela em volta do codigo: ha paginas com rotulos de dois paises,
            # entao "a pagina inteira" daria pais errado para metade deles
            win = [l for l in pages[pn]["lines"]
                   if abs(l["x0"] - a["x"]) < 240 and -210 <= l["y0"] - a["y"] <= 250]
            own = (own + " " + " ".join(l["t"] for l in win)).strip()
            page_txt = " ".join(l["t"] for l in pages[pn]["lines"])
            trusted = bool(d and d.get("trusted"))
            if trusted:
                nm, attrs = d["name"], dict(d["attrs"])
            else:
                nm = ""
                attrs = {}
            KNOWN = ["Vidigal Wines", "Adega de Cantanhede", "Bodega Cono Sur", "Stormhoek",
                    "Global Wines", "Da Pipa", "Castillo de Andrade", "Martha's", "Bodega RPB",
                    "Newroads", "3 Autores", "Porta 6", "Julia Florista", "Artolas", "Capricho",
                    "Intimista"]  # so nomes que de fato aparecem no texto/OCR do PDF
            raw_brand = c["producer"] or c["line"] or ""
            _flat = re.sub(r"[^A-Z]", "", raw_brand.upper())
            for _k in KNOWN:
                if re.sub(r"[^A-Z]", "", _k.upper()) in _flat:
                    raw_brand = _k
                    break
            raw_brand = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", raw_brand)
            raw_brand = re.sub(r"(?i)[+,]? ?de ?[0-9]+[0-9 .]*", " ", raw_brand)
            raw_brand = titleize(re.sub(r"\s+", " ", raw_brand)).strip()
            fb = "" if len(raw_brand) < 4 or re.fullmatch(r"[0-9\W]*", raw_brand) else raw_brand[:110]
            ocr_guess = ""
            if not nm:
                near = [l for l in ocr_lines
                        if abs((l["x0"] + l["x1"]) / 2 - a["x"]) < 90 and a["y"] - 130 <= l["y0"] <= a["y"] + 40]
                lab = clean(" ".join(l["t"] for l in near))
                lab = re.sub(r"C[ÓO]D\.?\s*:?\s*[0-9]{3}", " ", lab, flags=re.I)
                lab = re.sub(r"(?i)\b(teor|volume|origem|castas|uvas|gradua|alco[o6ú]ol|produtor|"
                             r"regiao|safra|premio|award|medal)\w*.*$", " ", lab)
                lab = re.sub(r"\d{1,2}[.,]\d\s*%?", " ", lab)
                lab = re.sub(r"\d{1,2}\s*[xX]\s*\d{3}\s*ml", " ", lab, flags=re.I)
                lab = clean(re.sub(r"[^A-Za-zÀ-ÿ()'&./\- ]", " ", lab))
                if 6 <= len(lab) <= 55 and re.search(r"[A-Za-zÀ-ÿ]{4,}\s+\S", lab) \
                   and not re.search(r"(?i)(wine|blanc|rouge|produto|importad|portugu)", lab):
                    ocr_guess = lab
                if not nm:
                    near_lbl = [l for l in win if _imp_label_like(l["t"], 0, l["y0"] + 200)
                                and not re.match(STYLE_RE, clean(l["t"]).strip())
                                and abs((l["x0"] + l["x1"]) / 2 - a["x"]) < 150]
                    near_lbl.sort(key=lambda l: l["y0"])
                    if near_lbl:
                        nm = _imp_readable(near_lbl[-1]["t"], pages[pn].get("src") == "ocr")
                        trusted = False
                if not nm:
                    nm = f"{fb} — código {code}" if fb else f"Vinho importado — código {code}"
            pid = f"pdf-imp-{code}"
            if pid in ids:
                continue
            ids.add(pid)
            # ----- foto: na grade, recorta so a garrafa do codigo --------------
            img = None
            page = doc[pn - 1]
            if sheet and imgs:
                row = sorted([z for z in anchors if abs(z["y"] - a["y"]) < 60], key=lambda z: z["x"])
                col = sorted(anchors, key=lambda z: z["y"])
                bx = [min(i2["bbox"][0] for i2 in imgs), min(i2["bbox"][1] for i2 in imgs),
                      max(i2["bbox"][2] for i2 in imgs), max(i2["bbox"][3] for i2 in imgs)]
                k = row.index(a)
                left = bx[0] if k == 0 else (row[k - 1]["x"] + a["x"]) / 2
                right = bx[2] if k == len(row) - 1 else (a["x"] + row[k + 1]["x"]) / 2
                j = col.index(a)
                row_above = col[j - 1]["y"] + 6 if j else bx[1]
                # altura maxima da garrafa na grade: sem isso a primeira linha
                # arrasta o cabecalho/bandeira da secao para dentro da foto
                top = max(bx[1], row_above, a["y"] - 238)
                # limita a faixa a largura da garrafa: nas bordas da grade o vizinho
                # e a bandeira da secao entrariam no recorte
                half = min((right - left) / 2, 112.0)
                rect = pymupdf.Rect(max(bx[0], a["x"] - half), max(bx[1], top - 6),
                                    min(bx[2], a["x"] + half), min(bx[3], a["y"] + 14))
                if rect.width > 40 and rect.height > 40:
                    img = crop_save(page, tuple(rect), f"importado-{code}")
            if not img:
                im = match_image(page, imgs, a["x"], a["y"] - (120 if not sheet else 40), band=90_000)
                if im:
                    img = crop_save(page, im["bbox"], f"importado-{code}")
            unit = attrs.get("volume") or "750ml"
            if "x" in str(unit).lower():
                attrs["quantity"] = unit
                m = re.search(r"([0-9]{2,4})\s*ml", str(unit), re.I)
                unit = f"{m.group(1)}ml" if m else "750ml"
            # regiao/pais do PROPRIO bloco quando existirem (o contexto da secao
            # pode vazar de uma pagina para a seguinte)
            REG_GLUED = {"VALLECENTRAL": "Valle Central", "MENDOZA": "Mendoza", "WESTERNCAPE": "Western Cape",
                         "CANTANHEDE": "Cantanhede", "BAIRRADA": "Bairrada", "BEIRAATLANTICO": "Beira Atlântico",
                         "EXTREMADURA": "Extremadura", "LANGUEDOC": "Languedoc", "COTESDURHONE": "Côtes du Rhône",
                         "DOURO": "Douro", "DOCVERDE": "Vinho Verde", "VERDE": "Verde", "LISBOA": "Lisboa",
                         "ALENTEJO": "Alentejo", "ABRUZZO": "Abruzzo", "LOMBARDIA": "Lombardia",
                         "VENETO": "Veneto", "SICILIA": "Sicilia", "DAO": "Dão", "TORRESSVEDRAS": "Torres Vedras",
                         "SETUBAL": "Setúbal", "PENINSUDESETUBAL": "Península de Setúbal"}
            # 1) a ficha do produto ja pode trazer "Origem/D.O." -> e a melhor
            #    fonte, so uniformamos a grafia
            _glued = {k: v for k, v in REG_GLUED.items()}
            if attrs.get("origin"):
                _raw = re.sub(r"[^A-Z]", "", str(attrs["origin"]).upper())
                for _key, _val in _glued.items():
                    if _key in _raw:
                        attrs["origin"] = _val
                        break
            else:
                # 2) senao, o texto em volta do codigo
                _hay = re.sub(r"[^A-Z]", "", (own or "").upper())
                for _key, _val in _glued.items():
                    if _key in _hay:
                        attrs["origin"] = _val
                        break
                else:
                    # 3) por ultimo a pagina, e so quando ela nomeia UMA regiao
                    #    (ha pagina com mais de uma secao de pais diferente)
                    _ph = re.sub(r"[^A-Z]", "", page_txt.upper())
                    _regs = {v for k, v in _glued.items() if k in _ph}
                    if len(_regs) == 1:
                        attrs["origin"] = _regs.pop()
                    elif c["region"]:
                        attrs["origin"] = c["region"]
            desc = (f"{nm}. " if trusted else
                    f"Rótulo do catálogo de importados, código {code}"
                    + (f" (linha {fb})" if fb else "") + ". ")
            if trusted:
                bits = []
                for lab, key in (("Uva", "grape"), ("Teor alcoólico", "alcohol"),
                                 ("Volume", "volume"), ("Origem", "origin")):
                    if attrs.get(key):
                        bits.append(f"{lab}: {attrs[key]}")
                if c["country"]:
                    bits.append(f"País: {c['country']}")
                desc += "; ".join(bits) + "." if bits else "Especificações lidas do catálogo."
            else:
                desc += ("Nome não recuperado do PDF — a etiqueta é arte sem texto e vários "
                         "códigos dividem a mesma imagem.")
                if ocr_guess:
                    desc += f" Hipótese de leitura da etiqueta: “{ocr_guess}”."
                desc += " Ajuste o nome no Admin."
            _hay2 = re.sub(r"[^A-Z]", "", ((own or "") + " " + page_txt).upper())
            _pa = {"PORTUGAL": "Portugal", "FRANCA": "França", "CHILE": "Chile", "ESPANHA": "Espanha",
                   "ITALIA": "Itália", "ARGENTINA": "Argentina", "AFRICADOSUL": "África do Sul"}
            _best = None
            for _k, _v in _pa.items():
                i = _hay2.find(_k)
                if i >= 0 and (_best is None or i < _best[0]):
                    _best = (i, _v)
            _ct = _best
            # o bloco do rotulo pesa mais: se o pais aparece la, ele manda
            _own_hay = re.sub(r"[^A-Z]", "", (own or "").upper())
            _country = c["country"]
            for _k, _v in _pa.items():
                if _k in _own_hay:
                    _country = _v
                    break
            if _country not in _pa.values() and _best:
                _country = _best[1]
            products.append({
                "id": pid, "name": nm[:150], "department": "vinhos",
                "subcategory": "Vinhos Importados", "brand": fb[:110],
                "sku": code, "imported": True, "country": _country, "region": c["region"],
                "price": 0, "unit": f"Garrafa {unit}",
                "description": clean(desc)[:1200],
                "images": [img] if img else [], "attributes": attrs,
                "weightGrams": 1450, "lengthCm": 9, "widthCm": 9, "heightCm": 31,
                "stock": None, "stockMin": None,
                "available": False, "hidden": False, "featured": False,
                "madeToOrder": False, "seasonal": False, "giftEnabled": True,
                "source": f"pdf:importados ({'ficha do PDF' if trusted else 'marca da seção + código'})",
                "sourcePage": pn, "_needsReview": (not trusted),
            })
    return products


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    res = {}
    if which in ("all", "nacionais"):
        res["nacionais"] = parse_wine_pdf(f"{PDF}/Vinhos Nacionais_compressed.pdf",
                                          "Vinhos Nacionais", "Marqués de Mendonça", "vn")
    if which in ("all", "importados"):
        res["importados"] = parse_importados()
    if which in ("all", "sucos"):
        res["sucos"] = parse_sucos()
    if which in ("all", "cafe"):
        res["cafe"] = parse_cafe()
    for k, v in res.items():
        print(f"== {k}: {len(v)}")
        for p in v[:10]:
            print(f"   {p['sku'] or '-':5} | {p['name'][:40]:42} | {p['unit'][:16]:18} | {list(p['attributes'])}")
    out = f"{OUT}/stage2.json"
    prev = {}
    if os.path.exists(out):
        prev = json.load(open(out))
    prev.update(res)
    json.dump(prev, open(out, "w"), ensure_ascii=False, indent=1)
    print("->", out)
