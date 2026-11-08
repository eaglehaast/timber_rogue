"""Атласы газовой трубы из набора ChatGPT timber_gas_strips.zip (распакованного в папку).

python3 tools/gas.py <папка с timber_gas_*.png> <куда класть атласы>
  → gas-yellow.jpg  — жёлтые 01–08 и сварные стыки 01–03 столбиком (у всех общие края — их кладут вперемешку);
    gas-turn.jpg    — переходы жёлтого в рыжий 01–02; gas-oxide.jpg — рыжая арка 01–06; gas-post.jpg — стойки 01–04;
    gas-footing.webp — цемент под стойкой 01–05 в ряд, с прозрачностью.
Развёртки 2048 × 512 (длина × окружность) ужимаем вдвое: на трубе Ø 95 мм это ~850 точек на метр.
"""
import os
import sys

from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
STRIP = (1024, 256)


def column(names, out):
    images = [Image.open(os.path.join(src, f'timber_gas_{n}.png')).convert('RGB').resize(STRIP, Image.LANCZOS) for n in names]
    atlas = Image.new('RGB', (STRIP[0], STRIP[1] * len(images)))
    for i, im in enumerate(images):
        atlas.paste(im, (0, i * STRIP[1]))
    atlas.save(os.path.join(dst, out), quality=88)


column([f'yellow_{i:02d}' for i in range(1, 9)] + [f'weld_{i:02d}' for i in range(1, 4)], 'gas-yellow.jpg')
column([f'turn_{i:02d}' for i in range(1, 3)], 'gas-turn.jpg')
column([f'oxide_{i:02d}' for i in range(1, 7)], 'gas-oxide.jpg')
column([f'post_{i:02d}' for i in range(1, 5)], 'gas-post.jpg')
feet = [Image.open(os.path.join(src, f'timber_gas_footing_{i:02d}.png')).convert('RGBA').resize((512, 512), Image.LANCZOS) for i in range(1, 6)]
row = Image.new('RGBA', (512 * len(feet), 512))
for i, im in enumerate(feet):
    row.paste(im, (i * 512, 0))
row.save(os.path.join(dst, 'gas-footing.webp'), quality=90)
