"""Готовит текстуры пилы из комплекта ChatGPT: python3 tools/saw.py <папка комплекта>.

Корпус собирается в игре «подушкой» по силуэту вида сбоку: толщину каждой точки задаёт карта
saw-shape.png. Её рисуем здесь из толщин деталей (ширина детали при взгляде сверху) и скругляем
к краю силуэта. Вид сверху из комплекта спорит с видом сбоку (аккумулятор стоит за рукоятью,
а не под ней; передняя рукоять сверху — обруч, сбоку — дуга), поэтому толщины сняты с него
на глаз, а раскладка деталей — по виду сбоку.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

src = Path(sys.argv[1])
out = Path(__file__).resolve().parent.parent / 'assets' / 'textures'
BODY_M = 0.36 / 1484  # метров в пикселе вида сбоку: корпус от аккумулятора до шпильки — 36 см
CELL = 8              # пикселей вида сбоку в клетке карты толщин


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


# Корпус: цвет.
side = np.array(Image.open(src / 'timber_saw_body_side_01.png').convert('RGBA'))
color = pad(flatten(side.copy(), 60, 0.5))
Image.fromarray(color).resize((1024, 683), Image.LANCZOS).save(out / 'saw-body.png', optimize=True)

# Корпус: толщины деталей, метры. Позже правило перекрывает раннее.
h, w = side.shape[:2]
y, x = np.mgrid[0:h, 0:w]
width = np.full((h, w), 0.085)                                           # мотор
width[(x < 600) & (y >= 540)] = 0.075                                    # аккумулятор
width[(x >= 530) & (x < 610) & (y >= 600)] = 0.07                        # шейка
width[((x < 720) & (y < 540)) | ((x < 800) & (y < 380))] = 0.036         # задняя рукоять
width[(x >= 720) & (x < 1260) & (y >= 380) & (y < 490)] = 0.06           # рёбра над мотором
width[((y < 380) & (x >= 800) & (x < 1240))
      | ((y >= 380) & (y < 490) & (x >= 790) & (x < 935))
      | ((y >= 380) & (y < 450) & (x >= 1125) & (x < 1225))] = 0.03       # передняя дуга
width[(x >= 1220) & (x < 1360) & (y < 470)] = 0.11                       # щиток
width[x >= 1340] = 0.025                                                 # крепление шины
width[x >= 1490] = 0.012                                                 # шпилька
width = ndimage.gaussian_filter(width, 6)

# Скругление: у края силуэта толщина сходит на нет по четверти круга радиусом до 1.5 см.
inside = side[..., 3] > 128
edge = ndimage.distance_transform_edt(inside) * BODY_M
r = np.minimum(width / 2, 0.015)
t = np.minimum(edge / r, 1)
half = width / 2 * np.sqrt(1 - (1 - t) ** 2)

# Карта формы, по клетке CELL×CELL: в красном — полутолщина в четвертях миллиметра, в зелёном —
# расстояние от центра клетки до края силуэта в шестнадцатых клетки (128 — край, больше — внутри).
# По зелёному игра проводит край точно между клетками, без лесенки.
centre = (slice(CELL // 2, h // CELL * CELL, CELL), slice(CELL // 2, w // CELL * CELL, CELL))
signed = (ndimage.distance_transform_edt(inside) - ndimage.distance_transform_edt(~inside))[centre] / CELL
thick = np.where(signed > 0, np.maximum(half[centre] * 4000, 1), 0)
shape = np.stack([thick, 128 + 16 * signed, np.zeros_like(thick)], -1)
Image.fromarray(np.clip(np.round(shape), 0, 255).astype(np.uint8)).save(out / 'saw-shape.png', optimize=True)

# Шина: только полотно, цепь кладётся отдельной лентой. Полотно — связная серая (и жёлтая)
# область вокруг центра, отделённая от цепи тёмным кантом.
bar = np.array(Image.open(src / 'timber_saw_bar_01.png').convert('RGBA'))
rgb = bar[..., :3].astype(float)
luma = rgb @ [0.299, 0.587, 0.114]
spread = rgb.max(-1) - rgb.min(-1)
plate = (bar[..., 3] > 128) & (((luma > 60) & (spread < 40)) | (spread > 80))
labels, _ = ndimage.label(plate)
plate = ndimage.binary_fill_holes(labels == labels[392, 1000]) & (bar[..., 3] > 128)
plate = ndimage.binary_dilation(plate, iterations=3) & (bar[..., 3] > 128)
bar[..., 3] = np.where(plate, 255, 0)
crop = pad(bar)[280 - 8:505 + 8, 99 - 8:1975 + 8]
Image.fromarray(crop).resize((1024, 128), Image.LANCZOS).save(out / 'saw-bar.png', optimize=True)

chain = np.array(Image.open(src / 'timber_saw_chain_strip_01.png').convert('RGBA'))
Image.fromarray(pad(chain)).resize((1096, 100), Image.LANCZOS).save(out / 'saw-chain.png', optimize=True)
