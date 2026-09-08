#!/usr/bin/env python3
"""Extrai (nome, Cod., Caixa kg) do Catalogo de Biscoitos pareando por coordenada X.

Os PDFs de catalogo colocam os nomes numa faixa de y e os "Cod." em outra faixa
abaixo, na MESMA coluna. A ordem de leitura do texto nao preserva esse pareamento,
entao aqui agrupamos por centroide X e varredura vertical.
"""
import re
import sys
import json
import pymupdf

CODE_RE = re.compile(r"Cod\.?\s*([0-9]{2,4}(?:\s*/\s*[0-9]{2,4})?)\s*\|\s*Caixa:\s*([0-9]+(?:,[0-9]+)?)\s*kg", re.I)
X_TOL = 95.0      # tolerance horizontal para pertencer a mesma coluna
Y_WINDOW = 62.0   # o nome pode comecar no maximo isto acima do codigo


def spans(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for ln in b["lines"]:
            for sp in ln["spans"]:
                txt = sp["text"].strip()
                if not txt:
                    continue
                x0, y0, x1, y1 = sp["bbox"]
                out.append({"t": txt, "x0": x0, "x1": x1, "y0": y0, "y1": y1,
                            "xc": (x0 + x1) / 2.0, "size": round(sp["size"], 1)})
    return out


def parse_page(page):
    sp = spans(page)
    codes = []
    for s in sp:
        m = CODE_RE.search(s["t"])
        if m:
            codes.append({"xc": s["xc"], "y0": s["y0"],
                          "cod": re.sub(r"\s*", "", m.group(1)),
                          "kg": float(m.group(2).replace(",", ".")),
                          "t": s["t"]})
    names = [s for s in sp if not CODE_RE.search(s["t"]) and s["size"] > 13]

    # cabeçalho de seção (AMANTEIGADOS etc) é grande e repetido -> maior tamanho de fonte
    header = None
    for s in sorted(sp, key=lambda z: -z["size"]):
        if s["size"] > 18 and not CODE_RE.search(s["t"]):
            header = " ".join(w for w in s["t"].upper().split() if w.isalpha() or "/" in w)
            break

    buckets = {i: [] for i in range(len(codes))}
    for n in names:
        best, bestd = None, 1e9
        for i, c in enumerate(codes):
            dx = abs(n["xc"] - c["xc"])
            dy = c["y0"] - n["y0"]          # codigo abaixo do nome
            if dx > X_TOL or dy < -6 or dy > Y_WINDOW:
                continue
            score = dx + abs(dy) * 0.15
            if score < bestd:
                best, bestd = i, score
        if best is not None:
            buckets[best].append(n)

    items = []
    for i, c in enumerate(codes):
        parts = sorted(buckets[i], key=lambda z: (round(z["y0"], 1), z["x0"]))
        # junta linhas consecutivas da mesma coluna
        name = " ".join(p["t"] for p in parts)
        name = re.sub(r"\s+", " ", name).strip(" -")
        if not name:
            continue
        items.append({"name": name, "code": c["cod"], "boxKg": c["kg"],
                      "header": header, "page": page.number + 1,
                      "unmatched": len(parts) == 0})
    return items, names, codes


def main():
    pdf = sys.argv[1]
    doc = pymupdf.open(pdf)
    all_items, stats = [], []
    for p in doc:
        items, names, codes = parse_page(p)
        stats.append({"page": p.number + 1, "names": len(names), "codes": len(codes),
                      "paired": len(items),
                      "dangling": len(names) - sum(1 for i in items for _ in [0])})
        all_items.extend(items)

    # dedupe por codigo (uma linha de produto pode aparecer repetida no PDF)
    by_code = {}
    for it in all_items:
        key = it["code"]
        if key not in by_code:
            by_code[key] = it
        else:
            cur = by_code[key]
            if len(it["name"]) > len(cur["name"]):
                it["header"] = it["header"] or cur["header"]
                by_code[key] = it

    print(json.dumps({"stats": stats, "totalRaw": len(all_items),
                      "totalUnique": len(by_code),
                      "items": sorted(by_code.values(), key=lambda z: (z["page"], z["code"]))},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
