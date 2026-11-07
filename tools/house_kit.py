"""Атласы для дома из наборов картинок Никиты (zip из инбокса, распакованные по папкам).

python3 tools/house_kit.py <папка с распакованными наборами> <куда класть атласы> [имена наборов]
  → house-<имя>.jpg (без прозрачности) или .webp (с ней): клетки cell × cell подряд, cols в ряд;
    в house-kit.json для каждого атласа — сетка, клетки, средний линейный цвет непрозрачных пикселей (по нему
    код перекрашивает белое и серое в нужный цвет), а для картинок разного размера — где в клетке картинка
    и её исходный размер в пикселях.
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

# имя: (маска файлов, клетка (ш, в), столбцов, вписывать ли с сохранением пропорций)
KITS = {
    'slate': ('slate_01_05/*.png', (768, 768), 5, False),
    'metal': ('roof_metal_01_10/*.png', (768, 768), 5, False),
    'felt': ('roofing_felt_01_05/*.png', (768, 768), 5, False),
    'ridge': ('roof_ridges/*.png', (1024, 128), 1, False),
    'brick': ('chimney_brick_01_05/*.png', (512, 512), 5, False),
    'soot': ('chimney_soot_01_05/*.png', (512, 512), 5, False),
    'chinking': ('chinking_01_05/*.png', (1024, 128), 1, False),
    'zavalinka': ('zavalinka_01_05/*.png', (1024, 256), 1, False),
    'door': ('doors_01_04*/*.png', (512, 1024), 4, False),
    'frieze': ('carved_trim_01_15/*frieze*.png', (1024, 256), 3, False),
    'prichelina': ('carved_trim_01_15/*prichelina*.png', (1024, 256), 3, False),
    'attic': ('attic_window_01_05/*.png', (512, 512), 5, True),
    'baluster': ('porch_balusters_01_05/*.png', (128, 512), 5, False),
}


def linear(a):
    a = a / 255.0
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def main(src, out, *names):
    path = os.path.join(out, 'house-kit.json')
    meta = json.load(open(path)) if os.path.exists(path) else {}
    for name in names or KITS:
        pattern, (cw, ch), cols, fit = KITS[name]
        files = sorted(glob.glob(os.path.join(src, 'timber_house_' + pattern)))
        rows = (len(files) + cols - 1) // cols
        atlas = Image.new('RGBA', (cw * cols, ch * rows), (0, 0, 0, 0))
        rects, pixels, alpha = [], [], False
        for i, f in enumerate(files):
            im = Image.open(f).convert('RGBA')
            a = np.asarray(im.resize((256, 256)))
            alpha |= bool(a[..., 3].min() < 250)
            pixels.append(a[a[..., 3] > 128][:, :3])
            if fit:  # картинка целиком в клетку, по центру, пропорции те же
                k = min(cw / im.width, ch / im.height)
                w, h = round(im.width * k), round(im.height * k)
                x, y = (cw - w) // 2, (ch - h) // 2
                atlas.paste(im.resize((w, h), Image.LANCZOS), ((i % cols) * cw + x, (i // cols) * ch + y))
                rects.append([x, y, w, h, im.width, im.height])
            else:
                atlas.paste(im.resize((cw, ch), Image.LANCZOS), ((i % cols) * cw, (i // cols) * ch))
        mean = linear(np.concatenate(pixels).astype(float)).mean(0)
        image = os.path.join(out, f'house-{name}.' + ('webp' if alpha else 'jpg'))
        if alpha:
            atlas.save(image, quality=90, method=6)
        else:
            atlas.convert('RGB').save(image, quality=88)
        meta[name] = {'grid': [cols, rows], 'count': len(files), 'mean': [round(v, 3) for v in mean]}
        if fit:
            meta[name]['rects'] = rects
        print(name, len(files), image, os.path.getsize(image) // 1024, 'KB')
    with open(path, 'w') as f:
        json.dump(meta, f, separators=(',', ':'))


if __name__ == '__main__':
    main(*sys.argv[1:])
