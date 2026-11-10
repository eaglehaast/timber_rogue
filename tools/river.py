"""Собирает дно, берег и камни речки в атласы: python3 tools/river.py <папка>

В папке картинки ChatGPT (timber_river_assets.zip, промпт — design/river/river-assets-prompt.md):
- timber_river_bed_gravel_01…05.png, timber_river_bed_clay_01…05.png, timber_river_bank_clay_01…05.png —
  плитки 2048 × 2048 = 1 × 1 м, края общие внутри каждой пятёрки. Галька переката и отмели, глина и ил дна,
  глина подмытого откоса. У картинок ChatGPT последний столбец и строка повторяют первые — их срезаем.
  Дно — один атлас 5 × 2 (ряд гальки, ряд глины: группы [5, 5] для blend в surface.js), откос — 5 × 1.
- timber_river_stone_01…08.png — камни сверху на прозрачном фоне, 1024 × 1024: 01–05 плоские плитняки,
  06–08 окатыши. Каждый обрезаем по краям камня и кладём в квадратную клетку атласа 4 × 2;
  отношение ширины к длине камня — в json (aspect), камень в игре — выпуклая шапка по этому овалу.
Осока (timber_river_sedge_*_<класс>.png) — пучки на чёрном: python3 tools/tufts.py <папка> river-sedge-tufts 'timber_river_sedge_*.png'.

Пишет assets/textures/river-bed.jpg, river-bank.jpg, river-stones.webp и river-stones.json (grid, aspect).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from birch import bleed  # noqa: E402

TILE, STONE = 512, 256
STONES = [4, 2]
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'textures'


def tile(path):
    image = Image.open(path).convert('RGB')
    return image.crop((0, 0, image.width - 1, image.height - 1)).resize((TILE, TILE), Image.LANCZOS)


def atlas(folder, rows, name):
    out = Image.new('RGB', (5 * TILE, len(rows) * TILE))
    for r, row in enumerate(rows):
        for c in range(5):
            out.paste(tile(folder / f'timber_river_{row}_{c + 1:02d}.png'), (c * TILE, r * TILE))
    out.save(OUT / f'river-{name}.jpg', quality=88)


def main(folder):
    folder = Path(folder)
    atlas(folder, ['bed_gravel', 'bed_clay'], 'bed')
    atlas(folder, ['bank_clay'], 'bank')

    cols, rows = STONES
    stones, aspect = np.zeros((rows * STONE, cols * STONE, 4), np.uint8), []
    for n in range(cols * rows):
        image = np.asarray(Image.open(folder / f'timber_river_stone_{n + 1:02d}.png').convert('RGBA'))
        ys, xs = np.nonzero(image[:, :, 3] > 8)
        stone = image[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        aspect.append(round(stone.shape[1] / stone.shape[0], 3))
        r, c = divmod(n, cols)
        stones[r * STONE:(r + 1) * STONE, c * STONE:(c + 1) * STONE] = bleed(np.asarray(Image.fromarray(stone).resize((STONE, STONE), Image.LANCZOS)))
    Image.fromarray(stones).save(OUT / 'river-stones.webp', lossless=True, exact=True, method=6)
    (OUT / 'river-stones.json').write_text(json.dumps({'grid': STONES, 'aspect': aspect}) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
