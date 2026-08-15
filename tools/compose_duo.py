"""Compoe uma foto de estudio com as duas garrafas, recortando-as das fotos solo.

Os pixels do rotulo nao sao alterados: o recorte usa mascara por diferenca
em relacao ao fundo estimado linha a linha.
"""
import numpy as np
from PIL import Image, ImageFilter

SRC = {
    "cab": "assets/estudio/cabernet-sauvignon-estudio.png",
    "mer": "assets/estudio/merlot-estudio.png",
}
OUT = "assets/estudio/duo-cave-estudio.png"

W, H = 2048, 1365          # canvas final (3:2)
TABLE_Y = 0.80             # linha da mesa no canvas


def cutout(path, grad_thr=6.0):
    """Recorta a garrafa: o fundo do estudio e liso, entao regioes de
    gradiente baixo conectadas as bordas sao consideradas fundo."""
    from scipy import ndimage

    img = Image.open(path).convert("RGB")
    a = np.asarray(img).astype(np.float32)
    h, w, _ = a.shape

    gray = a.mean(axis=2)
    gy, gx = np.gradient(ndimage.gaussian_filter(gray, 1.2))
    grad = np.hypot(gx, gy)

    smooth = grad < grad_thr
    lbl, n = ndimage.label(smooth)

    border = set(lbl[0, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
    border.discard(0)

    bg = np.isin(lbl, list(border))
    obj = ~bg

    obj = ndimage.binary_closing(obj, np.ones((7, 7)))
    obj = ndimage.binary_fill_holes(obj)

    # linha da mesa: transicao parede->tampo, visivel nas colunas de borda
    edge_cols = np.concatenate([gray[:, :40], gray[:, -40:]], axis=1).mean(axis=1)
    d = np.abs(np.diff(ndimage.gaussian_filter1d(edge_cols, 3)))
    lo = int(h * 0.55)
    table = lo + int(np.argmax(d[lo:])) - 6
    obj[table:] = False

    # remove linhas espurias (faixa do tampo) mais largas que o corpo
    widths = obj.sum(axis=1)
    body = np.median(widths[widths > 0])
    obj[widths > body * 1.4] = False

    # fica apenas o componente principal (a garrafa)
    obj = ndimage.binary_opening(obj, np.ones((3, 3)))
    lbl2, n2 = ndimage.label(obj)
    if n2 > 1:
        sizes = ndimage.sum(obj, lbl2, range(1, n2 + 1))
        obj = lbl2 == int(np.argmax(sizes)) + 1
    obj = ndimage.binary_fill_holes(obj)

    m = Image.fromarray((obj * 255).astype(np.uint8))
    m = m.filter(ImageFilter.GaussianBlur(0.7))
    marr = np.asarray(m)

    ys, xs = np.where(marr > 40)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1

    rgba = np.dstack([np.asarray(img), marr])[y0:y1, x0:x1]
    return Image.fromarray(rgba, "RGBA")


def background():
    y = np.linspace(0, 1, H)[:, None]
    x = np.linspace(0, 1, W)[None, :]
    # vinheta radial suave num cinza claro neutro
    r = np.sqrt((x - 0.5) ** 2 * 1.15 + (y - 0.42) ** 2)
    v = np.clip(1.0 - 0.85 * r, 0.28, 1.0)
    wall = 168 + 74 * (v - 0.55)
    ty = int(H * TABLE_Y)
    canvas = np.repeat(wall[:, :, None], 3, axis=2)
    # tampo escuro reflexivo
    depth = np.linspace(0, 1, H - ty)[:, None]
    top = 46 - 22 * depth
    top = np.repeat(top, W, axis=1)
    top = top * (0.55 + 0.45 * v[ty:])
    canvas[ty:] = np.repeat(top[:, :, None], 3, axis=2)
    return Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), "RGB"), ty


def shadow(canvas, cx, base_y, width):
    """sombra suave projetada na base da garrafa"""
    layer = Image.new("L", canvas.size, 0)
    arr = np.zeros(canvas.size[::-1], dtype=np.float32)
    yy, xx = np.mgrid[0:canvas.size[1], 0:canvas.size[0]]
    e = ((xx - cx) / (width * 1.5)) ** 2 + ((yy - base_y) / (width * 0.30)) ** 2
    arr = np.clip(1 - e, 0, 1) ** 1.5 * 150
    layer = Image.fromarray(arr.astype(np.uint8)).filter(ImageFilter.GaussianBlur(28))
    canvas.paste(Image.new("RGB", canvas.size, (0, 0, 0)), (0, 0), layer)


def reflection(canvas, bottle, x, base_y):
    ref = bottle.transpose(Image.FLIP_TOP_BOTTOM)
    ref = ref.crop((0, 0, ref.width, int(ref.height * 0.30)))
    a = np.asarray(ref).astype(np.float32)
    fade = np.linspace(0.30, 0.0, a.shape[0])[:, None]
    a[..., 3] *= fade
    a[..., :3] *= 0.75
    ref = Image.fromarray(a.astype(np.uint8), "RGBA").filter(ImageFilter.GaussianBlur(2.5))
    canvas.paste(ref, (x, base_y), ref)


def main():
    canvas, ty = background()

    bottles = {k: cutout(p) for k, p in SRC.items()}

    target_h = int(H * 0.78)
    placed = []
    for key, scale, cx in (("cab", 1.0, 0.355), ("mer", 0.965, 0.645)):
        b = bottles[key]
        h = int(target_h * scale)
        w = int(b.width * h / b.height)
        b = b.resize((w, h), Image.LANCZOS)
        x = int(W * cx - w / 2)
        y = ty - h + int(H * 0.012)
        placed.append((b, x, y, w, h))

    for b, x, y, w, h in placed:
        shadow(canvas, x + w // 2, y + h, w)
    for b, x, y, w, h in placed:
        reflection(canvas, b, x, y + h)
    for b, x, y, w, h in placed:
        canvas.paste(b, (x, y), b)

    canvas.save(OUT)
    print("ok", OUT, canvas.size)


if __name__ == "__main__":
    main()
