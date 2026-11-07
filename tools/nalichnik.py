"""Наличники для дома: атлас картинок и их мерки.

python3 tools/nalichnik.py <png...>
  → assets/textures/house-nalichnik.webp (картинки в ряд, каждая 512 × 1024)
  → assets/textures/house-nalichnik.json: px — размер исходной картинки; frame и opening — рама и проём
    (x0, x1, y0, y1 в пикселях, от левого верхнего угла, общие для всех); outlines — внешний силуэт
    каждой рамы ломаной [x, y, x, y, ...] в тех же пикселях, по нему код даёт раме толщину.
"""
import json
import sys

import numpy as np
from PIL import Image

OUT = 'assets/textures/house-nalichnik'
CELL = (512, 1024)
TRACE = 4      # силуэт ищем на картинке, уменьшенной во столько раз
EPSILON = 1.0  # допуск упрощения ломаной, в пикселях уменьшенной картинки


def bbox(mask):
    ys, xs = np.where(mask)
    return [int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1]


def opening(mask):
    """Прозрачный проём посреди рамы: идём от середины картинки до краёв рамы."""
    h, w = mask.shape
    cx, cy = w // 2, h // 2
    x0 = cx
    while not mask[cy, x0 - 1]: x0 -= 1
    x1 = cx
    while not mask[cy, x1]: x1 += 1
    y0 = cy
    while not mask[y0 - 1, cx]: y0 -= 1
    y1 = cy
    while not mask[y1, cx]: y1 += 1
    return [x0, x1, y0, y1]


def trace(mask):
    """Внешний контур (обход соседей по Муру) от самой верхней левой точки рамы, по часовой стрелке."""
    m = np.pad(mask, 1)
    steps = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]  # (dy, dx) по часовой
    ys, xs = np.where(m)
    start = (int(ys[0]), int(xs[0]))
    path, p, back = [start], start, 6  # пришли слева
    while True:
        for k in range(8):
            d = (back + 1 + k) % 8
            q = (p[0] + steps[d][0], p[1] + steps[d][1])
            if m[q]:
                back = (d + 4) % 8
                p = q
                break
        if p == start: break
        path.append(p)
    return [(x - 1, y - 1) for y, x in path]


def simplify(points, eps):
    """Рамер — Дуглас — Пекер для замкнутой ломаной."""
    def rdp(pts):
        if len(pts) < 3: return pts
        a, b = np.array(pts[0], float), np.array(pts[-1], float)
        ab = b - a
        norm = np.hypot(*ab) or 1.0
        d = [abs(ab[0] * (p[1] - a[1]) - ab[1] * (p[0] - a[0])) / norm for p in pts[1:-1]]
        i = int(np.argmax(d)) + 1
        if d[i - 1] <= eps: return [pts[0], pts[-1]]
        return rdp(pts[:i + 1])[:-1] + rdp(pts[i:])
    half = len(points) // 2
    return rdp(points[:half + 1])[:-1] + rdp(points[half:] + points[:1])[:-1]


def main(files):
    atlas = Image.new('RGBA', (CELL[0] * len(files), CELL[1]))
    frames, openings, outlines = [], [], []
    for i, f in enumerate(files):
        im = Image.open(f).convert('RGBA')
        mask = np.asarray(im)[..., 3] > 128
        frames.append(bbox(mask))
        openings.append(opening(mask))
        small = np.asarray(im.resize((im.width // TRACE, im.height // TRACE), Image.BOX))[..., 3] > 128
        line = simplify(trace(small), EPSILON)
        outlines.append([round(v * TRACE + TRACE / 2) for p in line for v in p])
        atlas.paste(im.resize(CELL, Image.LANCZOS), (i * CELL[0], 0))
    # Рамы и проёмы у набора общие (одинаковый контур): берём самые широкие.
    frame = [min(f[0] for f in frames), max(f[1] for f in frames), min(f[2] for f in frames), max(f[3] for f in frames)]
    hole = [max(o[0] for o in openings), min(o[1] for o in openings), max(o[2] for o in openings), min(o[3] for o in openings)]
    atlas.save(OUT + '.webp', quality=90, method=6)
    with open(OUT + '.json', 'w') as out:
        json.dump({'px': list(im.size), 'frame': frame, 'opening': hole, 'outlines': outlines}, out, separators=(',', ':'))
    print(frame, hole, [len(o) // 2 for o in outlines])


if __name__ == '__main__':
    main(sys.argv[1:])
