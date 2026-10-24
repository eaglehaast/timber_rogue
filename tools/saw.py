"""Готовит пилу из комплекта ChatGPT: python3 tools/saw.py <номер> <папка комплекта>.

Корпус собирается в игре «подушкой» по силуэту вида сбоку. Форму задаёт карта saw-N-shape.png:
по клетке CELL×CELL — где лицевой (+z) и тыльный (−z) листы и как далеко край силуэта.
Её рисуем здесь из толщин деталей (ширина детали при взгляде сверху) и скругляем к краю.
Виды сверху в комплектах нарисованы без промеров, поэтому толщины сняты с них на глаз,
а раскладка деталей — по виду сбоку.

Оси картинки корпуса: крепление шины справа, рукояти сверху. Это вид с +z, лицевая сторона.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

CELL = 8  # пикселей вида сбоку в клетке карты формы


def rect(x0, x1, y0, y1):
    return lambda x, y: (x >= x0) & (x < x1) & (y >= y0) & (y < y1)


def polygon(points, size):
    mask = Image.new('L', size)
    ImageDraw.Draw(mask).polygon(points, fill=1)
    return lambda x, y: np.array(mask, bool)


# Детали: (зона, толщина в метрах); позже перекрывает раньше, по умолчанию — мотор.
# Толщина 'hoop' — деталь только тыльной стороны: обруч, который сбоку лежит поверх корпуса.
# Раскладка корпуса у обоих комплектов одна: аккумулятор — короткий блок под передней частью
# задней рукояти, под задней частью рукояти пусто.
PARTS = [
    (lambda x, y: rect(0, 720, 0, 640)(x, y) | rect(0, 800, 0, 380)(x, y), 0.038),  # задняя рукоять
    (rect(290, 610, 630, 1024), 0.068),                                 # аккумулятор
    (rect(720, 1230, 380, 490), 0.06),                                  # рёбра над мотором
    (lambda x, y: rect(830, 1230, 0, 380)(x, y) | rect(800, 950, 380, 490)(x, y)
     | rect(1120, 1220, 380, 420)(x, y), 0.03),                          # передняя дуга
    (rect(1180, 1440, 0, 520), 0.11),                                   # щиток
    (rect(1350, 2000, 0, 1024), 0.025),                                 # крепление шины
    (rect(1490, 2000, 0, 1024), 0.012),                                 # шпилька
    # Обруч передней рукояти спускается по тыльной стороне: торчит на −z.
    (polygon([(920, 150), (1045, 165), (1050, 290), (1140, 500), (1148, 1005), (1012, 1005),
              (1005, 560), (915, 330), (905, 200)], (1536, 1024)), 'hoop'),
]
PACKS = {
    # Мягкая объёмная прорисовка со своей цепью.
    '1': dict(
        side='timber_saw_painted_body_side_01_v02.png', back='timber_saw_painted_body_safety_side_01_v02.png',
        bar='timber_saw_painted_bar_01.png', chain='timber_saw_chain_strip_01.png', length=1445,
        mount=[1490, 745], slot=1395, hands=[[350, 290], [1070, 110]], lamp=[790, 362], light=0.5, parts=PARTS),
    # Плоский цвет: цепь вырезается из картинки шины.
    '2': dict(
        side='timber_saw_body_side_01_v04.png', back='timber_saw_body_safety_side_01_v04.png',
        bar='timber_saw_bar_01_v02.png', length=1448,
        mount=[1485, 745], slot=1395, hands=[[350, 290], [1070, 110]], lamp=[790, 362], light=0, parts=PARTS),
}
HOOP = (-0.03, -0.06)  # z лица и тыла обруча там, где он не лежит поверх корпуса


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


def over(top, bottom):
    out = bottom.copy()
    shown = top[..., 3] > 128
    out[shown] = top[shown]
    return out


def body(pack, src, out, name):
    front = np.array(Image.open(src / pack['side']).convert('RGBA'))
    if pack['light']:
        front = flatten(front, 60, pack['light'])
    # Тыльная сторона нарисована зеркально (крепление слева): отражаем её в оси лицевой.
    back = np.array(Image.open(src / pack['back']).convert('RGBA'))[:, ::-1] if 'back' in pack else front
    h, w = front.shape[:2]
    m = 0.36 / pack['length']  # корпус от аккумулятора до шпильки — 36 см
    for side, image in (('front', over(front, back)), ('back', over(back, front))):
        if side == 'back' and back is front:
            continue
        Image.fromarray(pad(image)).resize((1024, 683), Image.LANCZOS).save(out / f'{name}-{side}.png', optimize=True)

    y, x = np.mgrid[0:h, 0:w]
    zf, zb = np.full((h, w), 0.085 / 2), np.full((h, w), -0.085 / 2)
    front_shown = front[..., 3] > 128
    for zone, width in pack['parts']:
        inside = zone(x, y)
        if width == 'hoop':
            zf[inside & ~front_shown] = HOOP[0]
            zb[inside] = HOOP[1]
        else:
            zf[inside], zb[inside] = width / 2, -width / 2
    zf, zb = ndimage.gaussian_filter(zf, 4), ndimage.gaussian_filter(zb, 4)

    # Скругление: у края силуэта оба листа сходятся к середине по четверти круга радиусом до 1.5 см.
    inside = (front[..., 3] > 128) | (back[..., 3] > 128)
    edge = ndimage.distance_transform_edt(inside) * m
    centre, half = (zf + zb) / 2, (zf - zb) / 2
    t = np.minimum(edge / np.minimum(half, 0.015), 1)
    bulge = half * np.sqrt(1 - (1 - t) ** 2)

    # Карта формы по клеткам: красный — z лица, синий — z тыла (128 + полмиллиметра на единицу),
    # зелёный — расстояние от центра клетки до края силуэта в шестнадцатых клетки (128 — край).
    # Снаружи силуэта лицо и тыл сходятся в середине ближайшей клетки внутри.
    cell = (slice(CELL // 2, h // CELL * CELL, CELL), slice(CELL // 2, w // CELL * CELL, CELL))
    signed = (ndimage.distance_transform_edt(inside) - ndimage.distance_transform_edt(~inside))[cell] / CELL
    cf, cb, cc = (centre + bulge)[cell], (centre - bulge)[cell], centre[cell]
    _, (iy, ix) = ndimage.distance_transform_edt(signed <= 0, return_indices=True)
    cf, cb = np.where(signed > 0, cf, cc[iy, ix]), np.where(signed > 0, cb, cc[iy, ix])
    shape = np.stack([128 + cf * 2000, 128 + 16 * signed, 128 + cb * 2000], -1)
    Image.fromarray(np.clip(np.round(shape), 0, 255).astype(np.uint8)).save(out / f'{name}-shape.png', optimize=True)
    return dict(size=[w, h], m=m, cell=CELL, mount=pack['mount'], slot=pack['slot'], hands=pack['hands'], lamp=pack['lamp'],
                back='back' in pack)


def bar(pack, src, out, name):
    """Полотно шины без цепи: связная область полотна вокруг центра, отделённая от цепи тёмным кантом."""
    image = np.array(Image.open(src / pack['bar']).convert('RGBA'))
    visible = image[..., 3] > 128
    rgb = image[..., :3].astype(float)
    luma = rgb @ [0.299, 0.587, 0.114]
    spread = rgb.max(-1) - rgb.min(-1)
    plate = visible & (((luma > 60) & (spread < 40)) | (spread > 80))
    labels, _ = ndimage.label(plate)
    cy = (np.where(visible.any(1))[0][[0, -1]].mean()).astype(int)
    plate = ndimage.binary_fill_holes(labels == labels[cy, image.shape[1] // 2])
    ys, xs = np.where(plate)
    column = plate[:, image.shape[1] // 2]
    top, bottom = np.where(column)[0][[0, -1]]
    left, tip = xs.min(), xs.max()
    holes, n = ndimage.label(plate & ~visible)
    slot = max(range(1, n + 1), key=lambda i: (holes == i).sum())  # паз — самая большая дыра
    sy, sx = np.where(holes == slot)
    m = 0.3 / (np.where(visible.any(0))[0][[0, -1]] @ [-1, 1])  # шина с цепью — 30 см
    plate = ndimage.binary_dilation(plate & visible, iterations=3) & visible
    clipped = image.copy()
    clipped[..., 3] = np.where(plate, 255, 0)
    box = [left - 8, tip + 8, top - 8, bottom + 8]
    crop = pad(clipped)[box[2]:box[3], box[0]:box[1]]
    Image.fromarray(crop).resize((1024, 128), Image.LANCZOS).save(out / f'{name}-bar.png', optimize=True)

    if 'chain' in pack:
        strip = np.array(Image.open(src / pack['chain']).convert('RGBA'))
        chain = dict(tile=0.164, height=0.015, inset=0.003)
    else:
        # Цепь вырезаем из прямого участка над полотном: ищем шаг зубьев и берём целое число шагов,
        # чтобы лента сходилась без шва.
        rows = slice(top - 85, top + 5)
        band = image[rows].astype(float)
        a, b = int(left + 0.2 * (tip - left)), int(left + 0.85 * (tip - left))
        diff = lambda x0, x1: np.abs(band[:, x0] - band[:, x1]).mean()
        period = min(range(120, 260), key=lambda p: np.mean([diff(x, x + p) for x in range(a, a + 400, 7)]))
        count = (b - a) // period
        start = min(range(a, a + period), key=lambda x: diff(x, x + count * period))
        strip = image[rows, start:start + count * period]
        chain = dict(tile=count * period * m, height=(rows.stop - rows.start) * m, inset=5 * m)
    width = round(strip.shape[1] / strip.shape[0] * 100)
    Image.fromarray(pad(strip)).resize((width, 100), Image.LANCZOS).save(out / f'{name}-chain.png', optimize=True)
    return dict(px=box, m=m, slot=[int(sx.mean()), int(sy.mean())], tip=int(tip),
                radius=(bottom - top) / 2 * m, stretch=[int(left + 0.33 * (tip - left)), int(left + 0.88 * (tip - left))]), chain


number, src = sys.argv[1], Path(sys.argv[2])
out = Path(__file__).resolve().parent.parent / 'assets' / 'textures'
name = f'saw-{number}'
pack = PACKS[number]
info = dict(body=body(pack, src, out, name))
info['bar'], info['chain'] = bar(pack, src, out, name)
(out / f'{name}.json').write_text(json.dumps(info, default=float, indent=1) + '\n')
