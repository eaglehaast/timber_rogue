"""Собирает кору и веточки кустов заречья (облепиха, шиповник) в атласы: python3 tools/shrubs.py <папка>

В папке картинки ChatGPT по промпту design/world/hills-prompt.md (timber_hills_shrubs.zip). Мел, сухую дернину,
пшеницу и стог оттуда не берём: жёлтый склон, поле и стог Никита отверг (2026-11-14), склон зелёный.
- timber_seabuckthorn_bark_01…10.png (01–06 старые стволики, 07–10 молодые ветви, 30 × 30 см) и
  timber_rosehip_bark_01…06.png (20 × 20 см) — кора 1024 × 1024, края общие внутри набора;
- timber_seabuckthorn_spray_01…12.png (01–08 с ягодами), timber_rosehip_spray_01…08.png (01–05 с плодами,
  06–08 с цветками) — веточки 1024 × 2048 на прозрачном, крепятся в середине нижнего края.
Последний столбец и строка у плиток ChatGPT повторяют первые — срезаем, как в river.py.
Пучки (ковыль, чабрец) собирает tools/tufts.py.

Пишет assets/textures/seabuckthorn-bark.jpg и rosehip-bark.jpg с json (cells, groups); seabuckthorn-spray.webp
и rosehip-spray.webp с json как у берёзы (grid, aspect, kind, length): kind 0 — с ягодами (плодами), 1 — без них
(у шиповника — с цветками); length — длина клетки в метрах.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from birch import bleed  # noqa: E402
from river import OUT, TILE, tile  # noqa: E402

CELL = 512
# Кусты: сетка плиток коры и группы в ней; сетка веточек (не шире 4096 точек), сколько первых — с ягодами, длина клетки, м.
SHRUBS = {
    'seabuckthorn': {'bark': ([5, 2], [6, 4]), 'sprays': [6, 2], 'fruit': 8, 'length': 0.6},
    'rosehip': {'bark': ([3, 2], [6]), 'sprays': [8, 1], 'fruit': 5, 'length': 0.85},
}


def atlas(rows, name):
    cols = max(len(row) for row in rows)
    out = Image.new('RGB', (cols * TILE, len(rows) * TILE))
    for r, row in enumerate(rows):
        for c, path in enumerate(row):
            out.paste(tile(path), (c * TILE, r * TILE))
    out.save(OUT / f'{name}.jpg', quality=88)


def shrub(folder, name, bark, sprays, fruit, length):
    (cols, rows), groups = bark
    barks = [folder / f'timber_{name}_bark_{k + 1:02d}.png' for k in range(cols * rows)]
    atlas([barks[r * cols:(r + 1) * cols] for r in range(rows)], f'{name}-bark')
    (OUT / f'{name}-bark.json').write_text(json.dumps({'cells': [cols, rows], 'groups': groups}))
    (cols, rows), count = sprays, sprays[0] * sprays[1]
    out = np.zeros((rows * 2 * CELL, cols * CELL, 4), np.uint8)
    for n in range(count):
        image = Image.open(folder / f'timber_{name}_spray_{n + 1:02d}.png').convert('RGBA')
        r, c = divmod(n, cols)
        out[r * 2 * CELL:(r + 1) * 2 * CELL, c * CELL:(c + 1) * CELL] = bleed(np.asarray(image.resize((CELL, 2 * CELL), Image.LANCZOS)))
    Image.fromarray(out).save(OUT / f'{name}-spray.webp', quality=90, method=6)
    (OUT / f'{name}-spray.json').write_text(json.dumps({
        'grid': sprays, 'aspect': 0.5, 'kind': [0 if n < fruit else 1 for n in range(count)], 'length': [length] * count}))


def main(folder):
    for name, kit in SHRUBS.items():
        shrub(Path(folder), name, **kit)


if __name__ == '__main__':
    main(sys.argv[1])
