"""Собирает атлас пучков травы из папки ChatGPT: python3 tools/tufts.py <папка> <имя>.

В папке — отдельные пучки PNG на чёрном фоне (#000), каждый в кадре 2048 × 2048: основание
по центру в BASE пикселей от нижнего края, верх около 100 пикселей от верхнего. Класс высоты
стоит в конце имени файла: orchard_01_tall.png. Все пучки нарисованы в один рост кадра,
настоящую высоту в метрах задаёт класс.

Пишет assets/textures/<имя>.png (атлас, клетки по CELL пикселей в ширину) и <имя>.json:
сетку атласа, отношение ширины клетки к высоте и диапазон высот каждой клетки.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HEIGHTS = {'tall': [0.7, 0.9], 'mid': [0.45, 0.65], 'low': [0.25, 0.4]}  # метров
BASE = 64  # пустая полоса под основанием в исходном кадре
CELL = 512
DARK, SOFT = 0.05, 0.12  # ярче DARK — уже трава, полная непрозрачность через ещё SOFT


def tuft(path):
    """Пучок без фона: прозрачность по самому яркому каналу, цвет освобождён от чёрной подложки."""
    rgb = np.asarray(Image.open(path).convert('RGB'), np.float32) / 255
    rgb = rgb[BASE:-BASE]  # снизу пустая полоса, сверху срезаем столько же — кадр ровно по траве
    alpha = np.clip((rgb.max(2) - DARK) / SOFT, 0, 1)
    rgb = np.clip(rgb / np.maximum(alpha, 1e-3)[..., None], 0, 1)
    # Прозрачные пиксели берут цвет ближайшей травинки, а не чёрный: иначе уменьшенные копии
    # текстуры (вдали) смешали бы край с чёрным и обвели пучок тёмной каймой.
    _, (iy, ix) = ndimage.distance_transform_edt(alpha < 0.5, return_indices=True)
    rgb = rgb[iy, ix]
    return np.dstack([rgb, alpha])


def main(folder, name):
    files = sorted(Path(folder).glob('*.png'))
    cols = math.ceil(math.sqrt(len(files)))
    rows = math.ceil(len(files) / cols)
    cells = []
    for f in files:
        size = f.stem.rsplit('_', 1)[1]
        img = Image.fromarray((tuft(f) * 255).astype(np.uint8), 'RGBA')
        cells.append((img.resize((CELL, round(CELL * img.height / img.width)), Image.LANCZOS), HEIGHTS[size]))
    h = cells[0][0].height
    atlas = Image.new('RGBA', (cols * CELL, rows * h))
    for n, (img, _) in enumerate(cells):
        atlas.paste(img, (n % cols * CELL, n // cols * h))
    out = Path('assets/textures') / name
    atlas.save(out.with_suffix('.png'), optimize=True)
    out.with_suffix('.json').write_text(json.dumps({
        'grid': [cols, rows], 'aspect': round(CELL / h, 4), 'heights': [hs for _, hs in cells],
    }) + '\n')


main(*sys.argv[1:])
