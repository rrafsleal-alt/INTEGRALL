#!/usr/bin/env python3
"""Monta o catalogo final: PDFs -> products, com merge no que ja existe na loja.

Regras:
  * produto existente com o mesmo nome normalizado NAO e duplicado; recebe
    sku/atributos novos e mantém preço, estoque, fotos e variantes;
  * tudo que vem dos PDFs entra com price 0 e available:false;
  * IDs sao unicos e estaveis (pdf-<origem>-<sku|slug>);
  * `source`/`sourcePage`/`_needsReview` sao removidos no fim (o validador do
    projeto descarta campos desconhecidos de qualquer forma).
"""
import json, os, re, sys, unicodedata, csv

from paths import PROJECT_ROOT

WORK = str(PROJECT_ROOT)
sys.path.insert(0, str(PROJECT_ROOT / 'tools'))


def norm(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    return re.sub(r"\b(cafe|vinho|suco|integral|de|da|do)\b", "", s).strip()


def apply_shipping_defaults(p):
    """Peso e dimensoes minimos para o calculo de frete bater com a realidade.

    O site descarta a `box` se peso/medidas forem zero (src/catalog.js) e ai
    `src/correios.js` cai no padrao de 300 g / 16x11x10 — para uma caixa de
    biscoito de 2 kg ou garrafa de vinho isso cotaria frete de carta. Os PDFs
    trazem o PESO (ex.: "Caixa: 2 kg"), entao ele e copiado de la; o que nao
    existe no PDF (as medidas da caixa) vira estimativa por formato, marcada no
    relatorio para voce ajustar se a transportadora exigir.
    """
    filled = []
    dept = p.get("department") or ""
    unit = f"{p.get('unit') or ''} {p.get('name') or ''}"
    ml = re.search(r"([0-9]{2,4})\s*ml", unit, re.I)
    vol = int(ml.group(1)) if ml else None
    kg = re.search(r"([0-9]+(?:[.,][0-9]+)?)\s*kg", unit, re.I)
    box_kg = float(kg.group(1).replace(",", ".")) if kg else None

    if not p.get("weightGrams"):
        if dept == "petit-four":
            w = int(round((box_kg or 1.0) * 1000))
        elif dept == "cafes":
            w = 250
        elif dept == "sucos":
            w = max(320, int((vol or 1000) * 1.05))
        else:  # vinhos e espumantes: garrafa cheia + capsula
            w = {187: 450, 200: 470, 375: 800, 660: 1000, 750: 1450}.get(vol, 1450)
            if vol and vol >= 1000:
                w = int(vol * 1.3)
        if w:
            p["weightGrams"] = w
            filled.append("weightGrams")
    if not (p.get("lengthCm") and p.get("widthCm") and p.get("heightCm")):
        w = p.get("weightGrams") or 1000
        if dept == "petit-four":
            if w <= 1200:
                l, wd, h = 30, 22, 10
            elif w <= 1800:
                l, wd, h = 32, 24, 11
            elif w <= 2600:
                l, wd, h = 33, 24, 11
            else:
                l, wd, h = 38, 28, 16
        elif dept == "cafes":
            l, wd, h = 12, 8, 22
        elif dept == "sucos":
            l, wd, h = (10, 10, 23) if (vol or 1000) >= 900 else (8, 8, 17)
        else:
            if w >= 5000:                      # bag in box / galao
                l, wd, h = 22, 18, 30
            elif vol in (187, 200, 375):        # meia-garrafa
                l, wd, h = 7, 7, 21
            elif vol == 660:
                l, wd, h = 8, 8, 26
            elif vol and vol >= 1000:            # garrafa de 1 L
                l, wd, h = 9, 9, 32
            else:
                l, wd, h = 9, 9, 31
        p["lengthCm"], p["widthCm"], p["heightCm"] = l, wd, h
        filled += ["lengthCm", "widthCm", "heightCm"]
    return filled


def fix_wine_weights(p):
    """Vinho: peso e caixa precisam sair do VOLUME do produto, nao de um padrao.

    O extrator de importados vinha com 1450 g fixo (garrafa de 750 ml), o que
    superestimava a mini 187 ml e subestimava o bag-in-box de 4,5 L. Aqui o
    volume do `unit`/`attributes.volume` manda, e os campos deixam de ser
    "default" para serem derivados do PDF.
    """
    if (p.get("department") or "") != "vinhos":
        return False
    txt = f"{p.get('unit') or ''} {(p.get('attributes') or {}).get('volume') or ''} {p.get('name') or ''}"
    ml = None
    m = re.search(r"([0-9]{1,2}(?:[.,][0-9])?)\s*[lL]\b", txt)
    if m and "ml" not in m.group(0):
        ml = int(float(m.group(1).replace(",", ".")) * 1000)
    else:
        m = re.search(r"([0-9]{3,4})\s*ml", txt, re.I)
        if m:
            ml = int(m.group(1))
    if not ml:
        return False
    # peso = liquido + vidro/fecho/rotulo. O vidro NAO escala com o volume (a
    # mini de 187 ml pesa ~2,4x o liquido), entao usamos tabela por formato —
    # valores tipicos de garrafa bordalesa/borgonhesa cheia, com capsula.
    BY_ML = {187: 450, 200: 470, 250: 520, 375: 800, 500: 950, 660: 1050,
             750: 1450, 1000: 1750, 1500: 2300, 2000: 2900, 3000: 4300, 4500: 5200}
    w = BY_ML.get(ml)
    if w is None:
        w = min(5200, int(round(ml * 1.15)) + 120) if ml >= 1400 else int(round(ml * 1.55)) + 60
    before = (p.get("weightGrams"), p.get("lengthCm"), p.get("widthCm"), p.get("heightCm"))
    p["weightGrams"] = w
    if ml <= 200:
        p["lengthCm"], p["widthCm"], p["heightCm"] = 6, 6, 18
    elif ml <= 400:
        p["lengthCm"], p["widthCm"], p["heightCm"] = 7, 7, 21
    elif ml <= 700:
        p["lengthCm"], p["widthCm"], p["heightCm"] = 8, 8, 26
    elif ml <= 800:
        p["lengthCm"], p["widthCm"], p["heightCm"] = 9, 9, 31
    elif ml <= 1100:
        p["lengthCm"], p["widthCm"], p["heightCm"] = 9, 9, 33
    elif ml <= 1600:
        p["lengthCm"], p["widthCm"], p["heightCm"] = 11, 11, 33
    else:
        p["lengthCm"], p["widthCm"], p["heightCm"] = 22, 18, 30
    p["weight_source"] = "volume do PDF"
    return before != (p.get("weightGrams"), p.get("lengthCm"), p.get("widthCm"), p.get("heightCm"))


def main():
    # sempre parte do seed original: remontar sobre um catalogo ja mesclado duplicaria tudo
    cat_path = f"{WORK}/data/catalog.seed.json"
    catalog = json.load(open(cat_path))
    existing = catalog["products"]
    seed_ids = {p0["id"] for p0 in existing}
    by_name = {}
    for p in existing:
        by_name.setdefault(norm(p["name"]), p)

    stages = {}
    for f in ("stage1.json", "stage2.json"):
        path = f"{WORK}/out/{f}"
        if os.path.exists(path):
            stages.update(json.load(open(path)))

    new_products, enriched, skipped, collisions = [], [], [], []
    seen_ids = {p["id"] for p in existing}
    seen_names = dict(by_name)

    order = ["biscoitos", "nacionais", "importados", "sucos", "cafe"]
    buckets = {k: stages.get(k, []) for k in order}
    for bucket in order:
        for src in buckets[bucket]:
            p = {k: v for k, v in src.items() if not k.startswith("_")}
            review = bool(src.get("_needsReview")) or "OCR" in str(src.get("source", ""))
            p.pop("source", None); p.pop("sourcePage", None)
            key = norm(p["name"])
            hit = seen_names.get(key)
            codes = re.findall(r"\b[0-9]{3}\b", str(p.get("sku") or ""))
            hit_codes = set(re.findall(r"\b[0-9]{3}\b", " ".join(
                str(x) for x in [hit.get("sku"), hit.get("name"),
                                 json.dumps(hit.get("variants") or [])] if x))) if hit else set()
            # Colisao com produto DA LOJA (seed): e o mesmo produto — funde, mas
            # nunca sem registrar o codigo do PDF (antes o "Biscoito de Polvilho"
            # do site engoliu a ficha 961/960 e o SKU sumiu do cadastro).
            if hit and hit.get("id") in seed_ids:
                changed = []
                pdf_codes = re.findall(r"[0-9]{3}", str(p.get("sku") or ""))
                have = re.findall(r"[0-9]{3}", str(hit.get("sku") or ""))
                lost = [c for c in pdf_codes if c not in have]
                if lost:
                    hit["sku"] = ", ".join(have + lost)[:120]
                    changed.append("sku+" + "/".join(lost))
                    d0 = str(hit.get("description") or "")
                    if "códigos do catálogo" not in d0.lower():
                        hit["description"] = (d0 + f" Códigos do catálogo PDF: "
                                               f"{'/'.join(pdf_codes)}. "
                                               f"Formatos: {p.get('unit') or '—'}.").strip()[:1200]
                for k in ("country", "region", "unit", "brand"):
                    if p.get(k) and not hit.get(k):
                        hit[k] = p[k]; changed.append(k)
                for k, v in (p.get("attributes") or {}).items():
                    if v and not (hit.get("attributes") or {}).get(k):
                        hit.setdefault("attributes", {})[k] = v
                        changed.append(f"attributes.{k}")
                if not hit.get("images") and p.get("images"):
                    hit["images"] = p["images"]; changed.append("images")
                enriched.append((hit["name"], p["name"], ", ".join(changed) or "nada"))
                continue
            if hit:
                # produto diferente com o mesmo nome: mantem os dois, mas o nome
                # do site precisa ser unico (o validador exige), entao marcamos o
                # codigo e avisamos no relatorio para voce fundir no Admin se quiser
                tag = f" (cód. {'/'.join(codes)})" if codes else ""
                p["name"] = (p["name"] + tag)[:150]
                p["description"] = ((p.get("description") or "") +
                    f" Atenção: existe “{hit['name']}” no catálogo; se for o mesmo "
                    "produto, funda os dois no Admin.").strip()[:1200]
                collisions.append((hit["name"], p["name"]))
                key = norm(p["name"])
            if review:
                p["description"] = (p.get("description") or "") \
                    .replace("conferir antes de publicar", "conferir no Admin")
            n, base = 2, p["id"]
            while p["id"] in seen_ids:
                p["id"] = f"{base}-{n}"; n += 1
            seen_ids.add(p["id"])
            seen_names.setdefault(key, p)
            new_products.append(p)

    ship = 0
    rewine = sum(1 for p in new_products if fix_wine_weights(p))
    for p in new_products:
        if apply_shipping_defaults(p):
            ship += 1

    next_pos = max([int(p.get("position") or 0) for p in existing] or [0])
    for p in new_products:
        next_pos += 1
        p.pop("weight_source", None)
        p["position"] = next_pos
        p.setdefault("created", None)
        p.setdefault("updated", None)

    catalog["products"] = existing + new_products
    out = f"{WORK}/out/catalog-import.json"
    json.dump(catalog, open(out, "w"), ensure_ascii=False, indent=2)

    # planilha de precos a preencher
    with open(f"{WORK}/out/precos-a-preencher.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter=";")
        w.writerow(["produto", "departamento", "variante", "sku", "caixa/peso",
                    "origem do dado", "preco (R$)"])
        for p in new_products:
            vs = p.get("variants") or [None]
            for v in vs:
                w.writerow([p["name"], p.get("department", ""),
                            (v or {}).get("name", "") if v else "",
                            (p.get("sku") or ""),
                            p.get("unit", ""), p.get("subcategory", ""), ""])

    rep = {
        "novos": len(new_products), "já_existente_enriquecido": len(enriched),
        "total_final": len(catalog["products"]),
        "por_bucket": {k: len(v) for k, v in buckets.items()},
        "por_departamento": {}, "com_foto": 0, "sem_foto": 0,
        "indisponiveis": 0, "enriquecidos": enriched,
    }
    for p in catalog["products"]:
        d = p.get("department", "?")
        rep["por_departamento"][d] = rep["por_departamento"].get(d, 0) + 1
    rep["com_foto"] = sum(1 for p in new_products if p.get("images"))
    rep["sem_foto"] = sum(1 for p in new_products if not p.get("images"))
    rep["indisponiveis"] = sum(1 for p in new_products if p.get("available") is False)
    rep["nomes_colidiram"] = collisions
    rep["completados_para_frete"] = ship
    rep["vinhos_repesados"] = rewine
    json.dump(rep, open(f"{WORK}/out/summary.json", "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k != "enriquecidos"}, ensure_ascii=False, indent=1))
    print("colisoes de nome mantidas como produtos separados:", len(collisions))
    for c in collisions[:12]:
        print("   ", c[0], "≠", c[1])
    print("enriquecidos:", len(enriched))
    for e in enriched[:8]:
        print("   ", e)
    print("->", out, f"({os.path.getsize(out)/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
