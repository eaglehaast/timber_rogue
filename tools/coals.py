"""Собрать игровые листы из папки с coal_long_*, coal_end_*, coal_bed_* и coal_ash_*.

python3 tools/coals.py <папка с рисунками> <папка текстур стенда>
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def cell(source, size, mode, repeat=False):
    # У обоих листов одинаковая доля полей, поэтому цвет и жар совпадают при любом размере.
    pad = size // 32
    inner = size - 2 * pad
    with Image.open(source) as image:
        pixels = np.asarray(image.convert(mode).resize((inner, inner), Image.Resampling.LANCZOS))
    margins = [(pad, pad), (pad, pad)] + [(0, 0)] * (pixels.ndim - 2)
    return Image.fromarray(np.pad(pixels, margins, mode='wrap' if repeat else 'edge'))


def pack(src, dst):
    # В порядке чтения листа идут 6 длинных граней, 4 торца, спокойное и горячее дно.
    faces = [f'coal_{kind}_{i:02d}' for kind, count in [('long', 6), ('end', 4), ('bed', 2)]
             for i in range(1, count + 1)]
    dst.mkdir(parents=True, exist_ok=True)
    for suffix, size, mode, filename in [('color', 512, 'RGB', 'coals-paint.webp'),
                                         ('heat', 256, 'L', 'coals-heat.png')]:
        sheet = Image.new(mode, (4 * size, 3 * size))
        for i, name in enumerate(faces):
            tile = cell(src / f'{name}_{suffix}.png', size, mode, repeat=name.startswith('coal_bed_'))
            sheet.paste(tile, (i % 4 * size, i // 4 * size))
        if mode == 'RGB':
            sheet.save(dst / filename, quality=88, method=6)
        else:
            sheet.save(dst / filename, optimize=True)

    size = 256
    ash = Image.new('RGBA', (2 * size, 2 * size))
    for i in range(4):
        tile = cell(src / f'coal_ash_{i+1:02d}.png', size, 'RGBA')
        ash.paste(tile, (i % 2 * size, i // 2 * size))
    ash.save(dst / 'coals-ash.webp', quality=90, alpha_quality=100, method=6)


if __name__ == '__main__':
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('source', type=Path)
    args.add_argument('destination', type=Path)
    options = args.parse_args()
    pack(options.source, options.destination)
