"""Атласы грунтовой улицы из набора ChatGPT timber_road_assets.zip (распакованного в папку).

python3 tools/road.py <папка с timber_road_*.png|jpg> <куда класть атласы>
  → road-base.jpg — плитки чернозёма 01–08 (по 4 × 4 м, общие края) сеткой 4 × 2: их кладут вперемешку по клеткам;
    road-edge.png — маски края 01–04 в ряд: у них общие левый и правый края, поэтому ряд — одна маска на 16 м;
    road-rut.png  — маски колеи 01–03 в ряд, так же — одна колея на 12 м.
Плитки грунта 2048 точек на 4 м ужимаем вдвое: 256 точек на метр, на дороге под ногами этого хватает.
"""
import glob
import os
import sys

from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
TILE = 1024
load = lambda name, mode: Image.open(glob.glob(os.path.join(src, f'timber_road_{name}.*'))[0]).convert(mode)


def atlas(images, cols, out, **save):
    w, h = images[0].size
    sheet = Image.new(images[0].mode, (w * cols, h * ((len(images) + cols - 1) // cols)))
    for i, im in enumerate(images):
        sheet.paste(im, ((i % cols) * w, (i // cols) * h))
    sheet.save(os.path.join(dst, out), **save)


atlas([load(f'base_{i:02d}', 'RGB').resize((TILE, TILE), Image.LANCZOS) for i in range(1, 9)], 4, 'road-base.jpg', quality=88)
atlas([load(f'edge_{i:02d}', 'L') for i in range(1, 5)], 4, 'road-edge.png', optimize=True)
atlas([load(f'rut_{i:02d}', 'L') for i in range(1, 4)], 3, 'road-rut.png', optimize=True)
