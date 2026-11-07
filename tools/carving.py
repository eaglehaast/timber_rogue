"""Силуэты резьбы для объёма: по ним код даёт причелинам и фризу толщину, как наличникам.

python3 tools/carving.py
  читает атласы assets/textures/house-frieze.webp и house-prichelina.webp (сетка — из house-kit.json)
  → assets/textures/house-carving.json: { frieze: [...], prichelina: [...] } — для каждой картинки список
    замкнутых ломаных [x, y, x, y, ...] в пикселях клетки (от левого верхнего угла): внешний край доски и края
    сквозных прорезей. Обход у всех такой, что дерево справа по ходу (в координатах с y вниз).
"""
import json

import numpy as np
from PIL import Image
from scipy import ndimage

from nalichnik import trace, simplify

TRACE = 2      # силуэт ищем на картинке, уменьшенной во столько раз
EPSILON = 0.7  # допуск упрощения ломаной, в пикселях уменьшенной картинки
SPECK = 40     # пятна и дырочки меньше стольких пикселей (уменьшенной картинки) не в счёт


def contours(mask):
    """Внешние края кусков дерева и края прорезей, дерево справа по ходу."""
    out = []
    parts, n = ndimage.label(mask)
    for k in range(1, n + 1):
        part = parts == k
        if part.sum() >= SPECK: out.append(trace(part))
    # Прорези — прозрачные места, не связанные с краем картинки.
    holes, n = ndimage.label(np.pad(~mask, 1))
    outside = set(np.unique(np.concatenate([holes[0], holes[-1], holes[:, 0], holes[:, -1]])))
    for k in range(1, n + 1):
        hole = (holes == k)[1:-1, 1:-1]
        if k not in outside and hole.sum() >= SPECK: out.append(trace(hole))
    lines = []
    for line in out:
        line = simplify(line, EPSILON)
        # Дерево должно быть справа: щупаем у середины самого длинного отрезка.
        i = max(range(len(line)), key=lambda i: np.hypot(*np.subtract(line[(i + 1) % len(line)], line[i])))
        (x0, y0), (x1, y1) = line[i], line[(i + 1) % len(line)]
        length = np.hypot(x1 - x0, y1 - y0)
        px, py = (x0 + x1) / 2 - 1.5 * (y1 - y0) / length, (y0 + y1) / 2 + 1.5 * (x1 - x0) / length
        inside = mask[int(np.clip(round(py), 0, mask.shape[0] - 1)), int(np.clip(round(px), 0, mask.shape[1] - 1))]
        if not inside: line = line[::-1]
        lines.append([round(v * TRACE + TRACE / 2) for p in line for v in p])
    return lines


def main():
    kit = json.load(open('assets/textures/house-kit.json'))
    result = {}
    for name in ['frieze', 'prichelina']:
        atlas = np.asarray(Image.open(f'assets/textures/house-{name}.webp').convert('RGBA'))[..., 3]
        cols, rows = kit[name]['grid']
        h, w = atlas.shape[0] // rows, atlas.shape[1] // cols
        result[name] = {'px': [w, h], 'outlines': []}
        for i in range(kit[name]['count']):
            cell = atlas[(i // cols) * h:(i // cols + 1) * h, (i % cols) * w:(i % cols + 1) * w]
            small = np.asarray(Image.fromarray(cell).resize((w // TRACE, h // TRACE), Image.BOX)) > 128
            result[name]['outlines'].append(contours(small))
        print(name, [sum(len(l) // 2 for l in c) for c in result[name]['outlines']])
    with open('assets/textures/house-carving.json', 'w') as f:
        json.dump(result, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
