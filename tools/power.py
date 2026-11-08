"""Атласы уличной электрики из набора ChatGPT timber_power_assets.zip (распакованного в папку).

python3 tools/power.py <папка с timber_power_*.png> <куда класть атласы>
  → power-concrete.jpg, power-concrete-butt.jpg, power-wood.jpg, power-wood-butt.jpg, power-wood-end.jpg —
    развёртки опор столбиком (у семейства общие края — их кладут вперемешку; у butt и end общий только правый край,
    левый — низ опоры);
    power-base.webp  — земля у основания 01–04 в ряд, с прозрачностью;
    power-sign.webp  — знак «молния» 01–03 в ряд, с прозрачностью;
    power-numbers.webp + power-numbers.json — три почерка цифр строками, где в строке каждый знак 0–9 и «/»;
    power-door.jpg   — дверцы щита 01–04 в ряд; power-side.jpg — бок щита 01–02 в ряд.
Развёртки 2048 × 512 (2,8 × 0,7 м) ужимаем вдвое: ~370 точек на метр, на опоре этого хватает.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
STRIP = (1024, 256)
load = lambda name, mode: Image.open(os.path.join(src, f'timber_power_{name}.png')).convert(mode)


def stack(images, out, across, **save):
    w, h = images[0].size
    atlas = Image.new(images[0].mode, (w * len(images), h) if across else (w, h * len(images)))
    for i, im in enumerate(images):
        atlas.paste(im, (i * w, 0) if across else (0, i * h))
    atlas.save(os.path.join(dst, out), **save)


def strips(names, out):
    stack([load(n, 'RGB').resize(STRIP, Image.LANCZOS) for n in names], out, False, quality=88)


strips([f'concrete_{i:02d}' for i in range(1, 7)], 'power-concrete.jpg')
strips([f'concrete_butt_{i:02d}' for i in range(1, 4)], 'power-concrete-butt.jpg')
strips([f'wood_{i:02d}' for i in range(1, 7)], 'power-wood.jpg')
strips([f'wood_butt_{i:02d}' for i in range(1, 4)], 'power-wood-butt.jpg')
strips([f'wood_end_{i:02d}' for i in range(1, 3)], 'power-wood-end.jpg')
stack([load(f'base_{i:02d}', 'RGBA').resize((512, 512), Image.LANCZOS) for i in range(1, 5)], 'power-base.webp', True, quality=90)
stack([load(f'sign_{i:02d}', 'RGBA').resize((256, 256), Image.LANCZOS) for i in range(1, 4)], 'power-sign.webp', True, quality=90)
stack([load(f'box_door_{i:02d}', 'RGB').resize((356, 512), Image.LANCZOS) for i in range(1, 5)], 'power-door.jpg', True, quality=88)
stack([load(f'box_side_{i:02d}', 'RGB').resize((512, 512), Image.LANCZOS) for i in range(1, 3)], 'power-side.jpg', True, quality=88)

# Цифры: 11 знаков на равных местах по строке. Трафарет рвёт знак перемычками на куски, поэтому края знака ищем
# по непрозрачным столбцам внутри его места, а не по разрывам. В json — края знаков (доля ширины строки) и общие
# верх и низ знаков (доля высоты строки, от верха).
rows, glyphs, top, bottom = [], [], 1, 0
for font in 'ABC':
    image = load(f'numbers_{font}', 'RGBA')
    alpha = np.asarray(image)[:, :, 3] > 20
    cell = image.width / 11
    marks = []
    for k in range(11):
        cols = np.nonzero(alpha[:, int(k * cell):int((k + 1) * cell)].any(0))[0] + int(k * cell)
        marks.append([round(cols.min() / image.width, 4), round((cols.max() + 1) / image.width, 4)])
    ys = np.nonzero(alpha.any(1))[0]
    top, bottom = min(top, ys.min() / image.height), max(bottom, (ys.max() + 1) / image.height)
    glyphs.append(marks)
    rows.append(image.resize((2048, 256), Image.LANCZOS))
stack(rows, 'power-numbers.webp', False, quality=90)
with open(os.path.join(dst, 'power-numbers.json'), 'w') as f:
    json.dump({'glyphs': glyphs, 'top': round(top, 4), 'bottom': round(bottom, 4)}, f)
