"""Готовит облака из картинок ChatGPT: python3 tools/clouds.py <картинка>...

Облако нарисовано на чистом чёрном #000, а по краю ChatGPT смешивает его с фоном: серая кайма и тёмные
клочья. Поэтому прозрачность берём по яркости: точка тем прозрачнее, чем она темнее белого WHITE,
а цвет восстанавливаем делением на прозрачность — кайма и клочья становятся полупрозрачным облаком,
сквозь которое светит небо. Сплошным оставляем только тело облака — светлое (ярче CORE), чуть отступив от его края:
там лёгкие тени — собственный цвет облака, а не просвет. Тёмное, даже окружённое телом, — это дыры
до чёрного фона, их не закрашиваем.
Картинку обрезаем по облаку с небольшим полем и ужимаем до WIDTH по ширине.

Пишет assets/textures/cloud-<n>.webp (n с единицы по порядку картинок) и clouds.json —
отношение ширины к высоте каждого облака: по нему игра задаёт размер на небе.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

WIDTH = 1024
DARK, WHITE = 0.04, 0.8
CORE = 0.6
REACH = 6    # точек исходной картинки: за столько от края тела облако становится сплошным
MARGIN = 8   # точек поля вокруг облака


def main(*paths):
    out = Path('assets/textures')
    aspects = []
    for n, path in enumerate(paths, 1):
        rgb = np.asarray(Image.open(path).convert('RGB'), np.float32) / 255
        bright = rgb.max(2)
        solid = np.clip(ndimage.distance_transform_edt(bright > CORE) / REACH, 0, 1)
        alpha = np.clip((bright - DARK) / (WHITE - DARK), 0, 1)
        alpha = alpha + (1 - alpha) * solid
        ys, xs = np.nonzero(alpha)
        y0, y1 = max(ys.min() - MARGIN, 0), ys.max() + MARGIN + 1
        x0, x1 = max(xs.min() - MARGIN, 0), xs.max() + MARGIN + 1
        rgb, alpha = rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1]
        rgb = np.clip(rgb / np.maximum(alpha, 1e-3)[..., None], 0, 1)
        # Вокруг облака — цвет его края, а не чёрный: иначе при уменьшении вылезла бы тёмная кайма.
        _, (iy, ix) = ndimage.distance_transform_edt(alpha < 0.5, return_indices=True)
        rgb = rgb[iy, ix]
        img = Image.fromarray((np.dstack([rgb, alpha[..., None]]) * 255).round().astype(np.uint8), 'RGBA')
        img = img.resize((WIDTH, round(WIDTH * img.height / img.width)), Image.LANCZOS)
        img.save(out / f'cloud-{n}.webp', quality=90, alpha_quality=100, method=6)
        aspects.append(round(img.width / img.height, 3))
    (out / 'clouds.json').write_text(json.dumps(aspects) + '\n')


main(*sys.argv[1:])
