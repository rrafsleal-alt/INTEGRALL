#!/usr/bin/env python3
"""Integra os 5 catalogos em PDF do repo no catalog.json da loja INTEGRALL.

Regras de seguranca (importantes):
  * nenhum preco existe nos PDFs -> price: 0 e available: false, para nada
    ir ao ar como "gratuito";
  * produtos ja cadastrados na loja (mesmo nome normalizado) sao PRESERVADOS
    (preco, estoque, fotos, variantes) e apenas enriquecidos com sku/atributos;
  * fotos sao recortadas do proprio PDF (por coordenada, nao por ordem) e
    gravadas como webp em public/assets/products/pdf/.
"""
import json, os, re, sys, unicodedata
import pymupdf

from paths import PROJECT_ROOT, SOURCE_PDF_DIR, PRODUCT_ASSET_DIR, EXTRACT_DIR

REPO_PDF = str(SOURCE_PDF_DIR)
WORK = str(PROJECT_ROOT)
IMG_DIR = str(PRODUCT_ASSET_DIR)
EXTRACT = str(EXTRACT_DIR)
os.makedirs(IMG_DIR, exist_ok=True)

DEPARTMENTS = {"biscoitos": "petit-four", "vinhos": "vinhos", "sucos": "sucos",
               "cafe": "cafes", "importados": "vinhos"}


def norm(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def titleize(s):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    if not s:
        return s
    small = {"de", "da", "do", "com", "e", "a", "o", "em", "for", "d"}
    words = s.split(" ")
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        if "." in w or lw.upper() == w and len(w) <= 3 and lw not in ("ml", "kg", "mg"):
            out.append(w)
        elif lw in small and i:
            out.append(lw)
        else:
            out.append(lw[:1].upper() + lw[1:])
    return " ".join(out)


def slug(s):
    s = re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")
    return s[:60] or "produto"


def money(v):
    try:
        return float(str(v).replace(",", "."))
    except Exception:
        return None


# ----------------------------------------------------------------- imagens
def save_tile(page, bbox, name, want_w=1000):
    """Recorta a regiao da pagina (bbox em pontos) e salva como webp."""
    rect = pymupdf.Rect(*bbox)
    if rect.width <= 2 or rect.height <= 2:
        return None
    zoom = max(1.0, min(4.0, want_w / max(1.0, rect.width)))
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=rect, alpha=False)
    fn = f"{slug(name)}.webp"
    path = os.path.join(IMG_DIR, fn)
    n = 2
    while os.path.exists(path) and fn not in saved_files:
        fn = f"{slug(name)}-{n}.webp"; path = os.path.join(IMG_DIR, fn); n += 1
    pix.save(path, output="webp", quality=84)
    saved_files.add(fn)
    return f"/assets/products/pdf/{fn}"

saved_files = set()


def page_images(page):
    out = []
    for im in page.get_image_info():
        bb = im["bbox"]
        out.append({"bbox": bb, "xref": im.get("xref"), "w": im["width"], "h": im["height"]})
    return [i for i in out if (i["bbox"][2] - i["bbox"][0]) > 20 and (i["bbox"][3] - i["bbox"][1]) > 20]


def best_image_for(page, imgs, cx, cy, band=280):
    """Imagem da pagina cujo centro-x mais bate com cx e que fica acima de cy."""
    cand = [i for i in imgs if i["bbox"][3] <= cy + 10 and i["bbox"][3] > cy - band]
    if not cand:
        cand = list(imgs)
    if not cand:
        return None
    def score(i):
        icx = (i["bbox"][0] + i["bbox"][2]) / 2.0
        return abs(icx - cx)
    return sorted(cand, key=score)[0]


def load_ocr(tag):
    p = f"{EXTRACT}/{tag}.ocr.json"
    return json.load(open(p)) if os.path.exists(p) else None
