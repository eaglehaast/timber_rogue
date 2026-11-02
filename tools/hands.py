"""Готовит перчатку и рукав из комплекта ChatGPT: python3 tools/hands.py <папка комплекта>.

В папке — gloves/glove_01_front_back.png (тыл и ладонь правой перчатки, пальцы вверх) и
sleeves/sleeve_01_front_back.png (рукав спереди и сзади, плечо вверху).

Перчатка собирается в игре «подушкой» по силуэту тыла, как корпус пилы (saw.py): карта формы
glove-shape.png по клеткам CELL×CELL — как далеко край силуэта; по нему игра строит лицевой (+z,
тыл кисти) и тыльный (−z, ладонь) листы толщиной HALF. Пальцы на картинке нарисованы сомкнутыми —
щели между ними только прорисованы, поэтому силуэт режем по щелям (SLITS), чтобы каждый палец гнулся сам.
Картинку ладони отражаем и подтягиваем к силуэту тыла по общим точкам (MARKS: кончики, перепонки,
края), кусочно-аффинно: тогда лицевой и тыльный листы берут свои картинки в одних координатах.
Суставы (JOINTS) — в пикселях вида тыла: x — от большого пальца к мизинцу, y — от кончиков вниз.

Рукав в игре — труба от плеча до запястья. Её картинка sleeve.webp — развёртка: u — угол вокруг
рукава (середина — вид спереди, с планкой и пуговицами, края — вид сзади), v — от плеча к манжете.
Каждый столбец вида — точка на круге сечения: x = середина + полуширина · sin(угла).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.transform import PiecewiseAffineTransform, warp

CELL = 6           # пикселей вида тыла в клетке карты формы
CUT = 770          # ниже этой строки перчатка спрятана в рукаве: отрезаем
WRIST = (428, 680) # середина запястья — начало осей кисти
HAND = 0.195       # м — от запястья до кончика среднего пальца: отсюда масштаб
# Суставы правой перчатки на виде тыла: пястно-фаланговый, два межфаланговых и кончик;
# у большого — запястно-пястный, пястно-фаланговый, межфаланговый и кончик.
JOINTS = {
    'thumb': [(255, 630), (205, 470), (170, 370), (150, 290)],
    'index': [(298, 395), (299, 83)],
    'middle': [(410, 392), (405, 39)],
    'ring': [(522, 402), (505, 66)],
    'pinky': [(624, 428), (607, 133)],
}
PHALANGES = (0.47, 0.29)  # доли основной и средней фаланг от сустава до кончика, остальное — ногтевая
# Щели между пальцами: от перепонки вверх, туда, где пальцы на картинке уже разделены фоном.
SLITS = [[(247, 415), (241, 280)], [(360, 317), (350, 205)], [(474, 317), (466, 145)], [(590, 352), (575, 160)]]
SLIT_W = 2 * CELL
# Общие точки тыла и отражённой ладони: кончики пальцев, перепонки, верх щелей, края кисти и обшлага.
MARKS = [
    ((299, 83), (317, 80)), ((405, 39), (436, 47)), ((505, 66), (545, 70)), ((607, 133), (628, 150)),
    ((150, 290), (132, 322)),
    ((247, 415), (219, 420)), ((360, 317), (355, 347)), ((474, 317), (457, 355)), ((590, 352), (544, 383)),
    ((350, 205), (365, 215)), ((466, 145), (476, 230)), ((575, 160), (582, 268)),
    ((106, 340), (92, 380)), ((123, 420), (95, 450)), ((674, 300), (676, 300)), ((659, 420), (655, 420)),
    ((238, 680), (219, 680)), ((619, 680), (610, 680)), ((266, 760), (245, 760)), ((616, 760), (597, 760)),
    ((183, 600), (163, 600)), ((640, 600), (631, 600)),
]
# Половина толщины перчатки (м) по высоте вида тыла: пальцы почти круглые, ладонь толще к запястью.
# Края скругляются радиусом RADIUS (м), дальше перчатка ровной толщины. Толщину строит игра (arms.js).
HALF = ([0, 330, 420, 600, 680, CUT], [0.013, 0.0135, 0.017, 0.019, 0.021, 0.022])
RADIUS = 0.015
EDGE = 3        # пикселей: на краю картинок красноватый ореол — срезаем край силуэта

# Рукав: сверху срезаем видимую изнутри пройму, снизу — кромку манжеты (доли длины).
TRIM = (0.04, 0.02)
CUFF = 0.87  # с этой доли длины (от плеча) начинается манжета
SLEEVE = (1024, 1024)  # развёртка: по кругу и по длине
BLEND = np.radians(12)


def pad(rgba):
    """Красит прозрачные пиксели цветом ближайшего видимого, чтобы на краю не было тёмной каймы."""
    hidden = rgba[..., 3] < 128
    _, (iy, ix) = ndimage.distance_transform_edt(hidden, return_indices=True)
    rgba[..., :3] = rgba[iy, ix, :3]
    return rgba


def flatten(rgba, sigma, strength):
    """Гасит запечённый свет: делит яркость на её крупное пятно, мелкие детали остаются."""
    rgb = rgba[..., :3].astype(float)
    mask = (rgba[..., 3] > 128).astype(float)
    luma = rgb @ [0.299, 0.587, 0.114]
    blur = ndimage.gaussian_filter(luma * mask, sigma) / np.maximum(ndimage.gaussian_filter(mask, sigma), 1e-3)
    gain = (luma[mask > 0].mean() / np.maximum(blur, 1)) ** strength
    rgba[..., :3] = np.clip(rgb * gain[..., None], 0, 255).astype(np.uint8)
    return rgba


def figures(path):
    """Две фигуры картинки, слева направо, — RGBA на холстах картинки, край без ореола и залит цветом."""
    image = np.array(Image.open(path).convert('RGBA'))
    labels, n = ndimage.label(image[..., 3] > 128)
    sizes = ndimage.sum(np.ones(labels.shape), labels, range(1, n + 1))
    big = sorted(np.argsort(sizes)[-2:] + 1, key=lambda k: np.where(labels == k)[1].mean())
    out = []
    for k in big:
        part = image.copy()
        part[..., 3] = np.where(ndimage.binary_erosion(labels == k, iterations=EDGE), 255, 0)
        out.append(pad(part))
    return out


def glove(src, out):
    back_view, palm_view = figures(src / 'gloves' / 'glove_01_front_back.png')
    palm_view = palm_view[:, ::-1].copy()
    # Ладонь — в координаты тыла: warp ищет для каждой точки тыла точку ладони. Углы холста — неподвижные опоры.
    h, w = back_view.shape[:2]
    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    t = PiecewiseAffineTransform.from_estimate(np.array([b for b, _ in MARKS] + corners, float),
                                               np.array([p for _, p in MARKS] + corners, float))
    palm = warp(palm_view, t, output_shape=(h, w), order=1, preserve_range=True).astype(np.uint8)

    canvas = Image.fromarray(back_view[..., 3] > 128)
    draw = ImageDraw.Draw(canvas)
    for line in SLITS:
        draw.line(line, fill=0, width=SLIT_W)
    mask = np.array(canvas)
    mask[CUT:] = False
    labels, n = ndimage.label(mask)
    mask = labels == np.argmax(ndimage.sum(mask, labels, range(1, n + 1))) + 1

    ys, xs = np.where(mask)
    x0, y0 = xs.min() - 2 * CELL, ys.min() - 2 * CELL
    box = (x0, y0, x0 + (xs.max() + 2 * CELL - x0) // CELL * CELL, y0 + (CUT + 2 * CELL - y0) // CELL * CELL)
    m = HAND / (WRIST[1] - JOINTS['middle'][1][1])
    for name, image in (('front', back_view), ('back', palm)):
        image = image.copy()
        image[..., 3] = np.where(mask, 255, 0)
        crop = pad(image)[box[1]:box[3], box[0]:box[2]]
        Image.fromarray(crop).convert('RGB').save(out / f'glove-{name}.webp', quality=92)

    # Карта формы по клеткам, как у пилы: зелёный — расстояние от центра клетки до края силуэта в шестнадцатых
    # клетки (128 — край). Толщину по нему считает игра (arms.js: HALF и RADIUS): в красном и синем она шла бы
    # ступеньками по полмиллиметра, и на пологом тыле кисти были бы видны полосы. Красный и синий — ноль.
    region = mask[box[1]:box[3], box[0]:box[2]]
    rows, cols = region.shape
    cell = (slice(CELL // 2, rows, CELL), slice(CELL // 2, cols, CELL))
    signed = (ndimage.distance_transform_edt(region) - ndimage.distance_transform_edt(~region))[cell] / CELL
    flat = np.full(signed.shape, 128.0)
    shape = np.stack([flat, 128 + 16 * signed, flat], -1)
    Image.fromarray(np.clip(np.round(shape), 0, 255).astype(np.uint8)).save(out / 'glove-shape.png', optimize=True)

    def chain(points):
        if len(points) == 4:
            return points
        (bx, by), (ex, ey) = points
        at = lambda k: (round(bx + (ex - bx) * k, 1), round(by + (ey - by) * k, 1))
        return [points[0], at(PHALANGES[0]), at(sum(PHALANGES)), points[1]]
    shift = lambda p: [round(p[0] - box[0], 1), round(p[1] - box[1], 1)]
    return dict(size=[box[2] - box[0], box[3] - box[1]], m=m, cell=CELL, wrist=shift(WRIST),
                joints={k: [shift(p) for p in chain(v)] for k, v in JOINTS.items()},
                half=[[y - box[1] for y in HALF[0]], HALF[1]], radius=RADIUS)


def sleeve(src, out):
    """Развёртка рукава из видов спереди и сзади и его полуширина по длине (в долях полуширины манжеты)."""
    views = []
    for image in figures(src / 'sleeves' / 'sleeve_01_front_back.png'):
        image = flatten(image, 40, 0.6)
        shown = image[..., 3] > 128
        ys = np.where(shown.any(1))[0]
        top, bottom = ys[0] + TRIM[0] * (ys[-1] - ys[0]), ys[-1] - TRIM[1] * (ys[-1] - ys[0])
        rows = np.arange(int(top), int(bottom) + 1)
        left = np.array([np.argmax(shown[y]) for y in rows], float)
        right = np.array([shown.shape[1] - 1 - np.argmax(shown[y, ::-1]) for y in rows], float)
        views.append((image, rows, ndimage.gaussian_filter1d((left + right) / 2, 4), ndimage.gaussian_filter1d((right - left) / 2, 4)))

    w, h = SLEEVE
    u, v = np.meshgrid((np.arange(w) + 0.5) / w, (np.arange(h) + 0.5) / h)
    theta = 2 * np.pi * u - np.pi  # 0 — середина вида спереди
    color, total = np.zeros((h, w, 3)), np.zeros((h, w))
    for k, (image, rows, centre, half) in enumerate(views):
        delta = np.angle(np.exp(1j * (theta - np.pi * k)))  # угол от середины этого вида
        y = rows[0] + v * (rows[-1] - rows[0])
        at = np.clip(y - rows[0], 0, len(rows) - 1)
        x = np.interp(at, np.arange(len(rows)), centre) + np.interp(at, np.arange(len(rows)), half) * np.sin(np.clip(delta, -np.pi / 2, np.pi / 2))
        # Виды сходятся на боках рукава. Чтобы там не было шва, каждый вид заходит за свой край на BLEND
        # (берёт крайний столбец силуэта), и на стыке они плавно смешиваются.
        weight = np.clip((np.pi / 2 + BLEND - np.abs(delta)) / (2 * BLEND), 0, 1)
        weight = weight * weight * (3 - 2 * weight)
        for c in range(3):
            color[..., c] += weight * ndimage.map_coordinates(image[..., c].astype(float), [y, x], order=1)
        total += weight
    Image.fromarray(np.clip(color / total[..., None], 0, 255).astype(np.uint8)).save(out / 'sleeve.webp', quality=90)

    # Полуширина рукава по длине: средняя по двум видам, в долях её же на манжете (CUFF — где манжета по длине).
    samples = np.linspace(0, 1, 33)
    profile = np.mean([np.interp(samples * (len(r) - 1), np.arange(len(r)), hw) for _, r, _, hw in views], 0)
    cuff = profile[(samples > CUFF) & (samples < 0.97)].mean()
    return dict(profile=[round(p / cuff, 3) for p in profile], cuff=CUFF)


src = Path(sys.argv[1])
out = Path(__file__).resolve().parent.parent / 'assets' / 'textures'
info = dict(glove=glove(src, out), sleeve=sleeve(src, out))
(out / 'hands.json').write_text(json.dumps(info, default=float, indent=1) + '\n')
