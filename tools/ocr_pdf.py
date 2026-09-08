#!/usr/bin/env python3
"""OCR de todas as paginas dos PDFs com pouco texto vetorial.

Guarda por pagina: linhas com bbox (x0,y0,x1,y1), texto e confianca.
O bbox e o que permite depois parear rotulo <-> product (mesma ideia do
pareamento por coordenada usado nos biscoitos).
"""
import sys, os, json, re
import pymupdf
from rapidocr_onnxruntime import RapidOCR

from paths import EXTRACT_DIR

DPI = 200
OUT = str(EXTRACT_DIR)

def main(pdf, tag):
    os.makedirs(OUT, exist_ok=True)
    doc = pymupdf.open(pdf)
    ocr = RapidOCR()
    pages = []
    for p in doc:
        pix = p.get_pixmap(dpi=DPI)
        tmp = f"{OUT}/.ocr_page.png"
        pix.save(tmp)
        res, _ = ocr(tmp)
        lines = []
        for box, text, conf in (res or []):
            xs = [q[0] for q in box]; ys = [q[1] for q in box]
            # bbox do OCR vem em px da imagem renderizada -> converte pt da pagina
            k = 72.0 / DPI
            lines.append({"x0": min(xs)*k, "y0": min(ys)*k, "x1": max(xs)*k,
                          "y1": max(ys)*k, "t": text.strip(), "c": round(float(conf), 3)})
        lines = [l for l in lines if l["t"]]
        pages.append({"page": p.number + 1, "pw": p.rect.width, "ph": p.rect.height,
                      "lines": lines})
        print(f"  p{p.number+1:3}: {len(lines):3} linhas", flush=True)
    out = f"{OUT}/{tag}.ocr.json"
    json.dump(pages, open(out, "w"), ensure_ascii=False, indent=1)
    print("=>", out, len(pages), "paginas")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
