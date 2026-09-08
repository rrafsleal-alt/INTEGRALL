#!/usr/bin/env python3
"""assemble + poda de arquivos nao usados + aplica em data/catalog.json + auditoria de assets."""
import json, os, subprocess, sys

from paths import PROJECT_ROOT

WORK = str(PROJECT_ROOT)


def main():
    subprocess.run([sys.executable, f"{WORK}/tools/assemble.py"], cwd=WORK, check=True,
                   stdout=subprocess.DEVNULL)
    cat = json.load(open(f"{WORK}/out/catalog-import.json"))
    used = {os.path.basename(i) for p in cat["products"] for i in p.get("images", [])}
    d = f"{WORK}/public/assets/products/pdf"
    removed = freed = 0
    for f in sorted(set(os.listdir(d)) - used):
        if not f.endswith((".webp", ".png", ".jpg")):
            continue
        freed += os.path.getsize(os.path.join(d, f))
        os.remove(os.path.join(d, f))
        removed += 1
    print(f"podados {removed} arquivos nao referenciados ({freed/1e6:.1f} MB)")
    json.dump(cat, open(f"{WORK}/data/catalog.json", "w"), ensure_ascii=False, indent=2)
    ls = f"{WORK}/data/local-state/catalog.json"
    if os.path.exists(ls):
        os.remove(ls)  # artefato de teste; senao ele tem prioridade sobre o seed
        print("local-state/catalog.json removido (artefato de teste)")
    print(f"assets: {len(os.listdir(d))} arquivos | {os.path.getsize(f'{WORK}/data/catalog.json')/1e6:.2f} MB de catálogo")
    # toda imagem referenciada precisa existir
    missing = [i for p in cat["products"] for i in p.get("images", [])
               if not os.path.exists(f"{WORK}/public{i}")]
    print("imagens faltando:", len(missing), missing[:3])


if __name__ == "__main__":
    main()
