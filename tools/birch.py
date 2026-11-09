"""Собирает кору и пряди берёзы в атласы: python3 tools/birch.py <папка>

В папке картинки ChatGPT (промпты design/world/birch-3d-prompt.md и birch-bark-v2-prompt.md в файлах проекта):
- timber_birch_bark_01…24.png (timber_birch_bark_v2.zip) — плитки коры 1024 × 1024 = 40 × 40 см, ствол вертикально.
  01–10 береста в чёрную крапину, 11–18 переходная (белое и чёрное поровну), 19–24 тёмный комель; внутри группы
  края общие. Атлас 6 × 4 по TILE, группы [10, 8, 6] — игра кладёт плитки группы вперемешку и переходит
  от комля к бересте по высоте.
- timber_birch_spray_01…16.png — пряди 1024 × 2048 на прозрачном фоне. 01–10 длинные свисающие, 11–14 короткие
  пучки (в верхней половине кадра), 15–16 побеги макушки вверх (крепятся снизу). Атлас 8 × 2 по CELL × 2·CELL.
  Прозрачный фон закрашиваем цветом ближайшего листа: иначе при уменьшении (мипы) край темнеет.

Пишет assets/textures/birch-bark.jpg и .json (cells, groups), birch-spray.webp и .json:
grid — столбцов и строк, aspect — ширина клетки к высоте, kind — вид пряди (0 длинная, 1 пучок, 2 побег вверх),
length — длина клетки в метрах. Прядь крепится в середине верхнего края клетки, побег — нижнего.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

TILE, CELL = 512, 512
BARK = ([6, 4], [10, 8, 6])
SPRAYS = [8, 2]
KIND = [0] * 10 + [1] * 4 + [2] * 2
LENGTH = [1.3, 1.0, 0.8]  # м на высоту клетки: прядь 1–1,5 м во весь кадр, пучок 40–60 см в полкадра, побег 0,6–0,8 м
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'textures'


def bleed(rgba):
    """Прозрачным точкам — цвет ближайшей непрозрачной."""
    solid = rgba[:, :, 3] > 0
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    out = rgba.copy()
    out[:, :, :3] = rgba[iy, ix, :3]
    return out


def main(folder):
    folder = Path(folder)
    (cols, rows), groups = BARK
    bark = Image.new('RGB', (cols * TILE, rows * TILE))
    for n in range(cols * rows):
        tile = Image.open(folder / f'timber_birch_bark_{n + 1:02d}.png').convert('RGB').resize((TILE, TILE), Image.LANCZOS)
        bark.paste(tile, ((n % cols) * TILE, (n // cols) * TILE))
    bark.save(OUT / 'birch-bark.jpg', quality=88)
    (OUT / 'birch-bark.json').write_text(json.dumps({'cells': [cols, rows], 'groups': groups}))

    cols, rows = SPRAYS
    atlas = np.zeros((rows * 2 * CELL, cols * CELL, 4), np.uint8)
    for n in range(cols * rows):
        image = Image.open(folder / f'timber_birch_spray_{n + 1:02d}.png').convert('RGBA')
        r, c = divmod(n, cols)
        atlas[r * 2 * CELL:(r + 1) * 2 * CELL, c * CELL:(c + 1) * CELL] = bleed(np.asarray(image.resize((CELL, 2 * CELL), Image.LANCZOS)))
    Image.fromarray(atlas).save(OUT / 'birch-spray.webp', quality=90, method=6)
    (OUT / 'birch-spray.json').write_text(json.dumps({
        'grid': SPRAYS, 'aspect': 0.5, 'kind': KIND, 'length': [LENGTH[k] for k in KIND]}))


if __name__ == '__main__':
    main(sys.argv[1])
