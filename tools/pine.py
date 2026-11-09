"""Собирает кору, лапы и хвойную подстилку сосны в атласы: python3 tools/pine.py <папка>

В папке картинки ChatGPT (timber_pine_3d.zip, тот же формат, что у берёзы — tools/birch.py):
- timber_pine_bark_01…20.png — плитки коры 1024 × 1024 = 40 × 40 см, ствол вертикально, края общие у всего набора.
  01–12 тонкая рыже-медная кора верха ствола, 13–20 толстая серо-бурая кора низа, в пластинах и бороздах.
  Атлас 5 × 4 по TILE, группы [12, 8].
- timber_pine_spray_01…16.png — лапы 1024 × 2048 на прозрачном фоне: 01–10 длинные веточки с кистями хвои
  (крепятся сверху), 11–14 короткие кисти (в верхней половине кадра), 15–16 побеги вверх (крепятся снизу).
  Атлас 8 × 2 по CELL × 2·CELL, прозрачный фон закрашен цветом ближайшей хвоинки (иначе край темнеет в мипах).
- timber_pine_litter_01…05.png — подстилка из опавшей хвои, 2048 × 2048, края общие у всего набора.
  Атлас 5 × 1 по TILE (сетку знает grass.js).
У картинок ChatGPT последний столбец и строка повторяют первые — их срезаем, иначе на стыке плиток шов.

Пишет assets/textures/pine-bark.jpg и .json (cells, groups), pine-spray.webp и .json (grid, aspect, kind, length),
pine-litter.jpg.
"""
import json
import sys
from pathlib import Path

from PIL import Image
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from birch import bleed  # noqa: E402

TILE, CELL = 512, 512
BARK = ([5, 4], [12, 8])
LITTER = [5, 1]
SPRAYS = [8, 2]
KIND = [0] * 10 + [1] * 4 + [2] * 2
LENGTH = [0.9, 0.5, 0.6]  # м на высоту клетки: веточка с кистями, короткая кисть, побег
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'textures'


def tile(path):
    image = Image.open(path).convert('RGB')
    return image.crop((0, 0, image.width - 1, image.height - 1)).resize((TILE, TILE), Image.LANCZOS)


def atlas(folder, name, cells):
    cols, rows = cells
    out = Image.new('RGB', (cols * TILE, rows * TILE))
    for n in range(cols * rows):
        out.paste(tile(folder / f'timber_pine_{name}_{n + 1:02d}.png'), ((n % cols) * TILE, (n // cols) * TILE))
    out.save(OUT / f'pine-{name}.jpg', quality=88)


def main(folder):
    folder = Path(folder)
    atlas(folder, 'bark', BARK[0])
    (OUT / 'pine-bark.json').write_text(json.dumps({'cells': BARK[0], 'groups': BARK[1]}))
    atlas(folder, 'litter', LITTER)

    cols, rows = SPRAYS
    sprays = np.zeros((rows * 2 * CELL, cols * CELL, 4), np.uint8)
    for n in range(cols * rows):
        image = Image.open(folder / f'timber_pine_spray_{n + 1:02d}.png').convert('RGBA')
        r, c = divmod(n, cols)
        sprays[r * 2 * CELL:(r + 1) * 2 * CELL, c * CELL:(c + 1) * CELL] = bleed(np.asarray(image.resize((CELL, 2 * CELL), Image.LANCZOS)))
    Image.fromarray(sprays).save(OUT / 'pine-spray.webp', quality=90, method=6)
    (OUT / 'pine-spray.json').write_text(json.dumps({
        'grid': SPRAYS, 'aspect': 0.5, 'kind': KIND, 'length': [LENGTH[k] for k in KIND]}))


if __name__ == '__main__':
    main(sys.argv[1])
