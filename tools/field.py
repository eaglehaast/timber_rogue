"""Собирает плитки пшеничного поля в атлас: python3 tools/field.py <папка>

В папке картинки ChatGPT из timber_wheat_assets.zip (промпт design/world/hills-prompt.md):
timber_wheat_field_01…04.png — спелое поле сверху, плитки 2048 × 2048 = 4 × 4 м, края общие у всех четырёх.
Последний столбец и строка у плиток ChatGPT повторяют первые — срезаем, как в river.py.
Пучки пшеницы с колосьями сбоку (timber_wheat_01…08_tall.png) собирает tools/tufts.py:
python3 tools/tufts.py <папка> wheat-tufts 'timber_wheat_0*_tall.png'

Пишет assets/textures/wheat-field.jpg (4 × 1). Потом python3 tools/half.py.
"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from river import OUT, TILE, tile  # noqa: E402


def main(folder):
    out = Image.new('RGB', (4 * TILE, TILE))
    for c in range(4):
        out.paste(tile(Path(folder) / f'timber_wheat_field_{c + 1:02d}.png'), (c * TILE, 0))
    out.save(OUT / 'wheat-field.jpg', quality=88)


if __name__ == '__main__':
    main(sys.argv[1])
