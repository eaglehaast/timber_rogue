"""Собирает листья клёна в атласы: python3 tools/leaves.py <папка>

В папке листья от ChatGPT: timber_maple_leaf_NN.png (лицо) и timber_maple_leaf_NN_back.png (изнанка того же листа),
2048 × 2048 на прозрачном фоне, черешок внизу. Силуэты лица и изнанки совпадают, поэтому у обоих атласов
одна раскладка: игра берёт клетку лица или изнанки по тому, какой стороной лист повёрнут к глазу.

Каждый лист ужимаем в клетку CELL (кадр целиком, чтобы масштаб листьев одного вида был общий) и раскладываем 5 × 4.
Прозрачный фон закрашиваем цветом ближайшего листа: иначе при уменьшении (мипы) край темнеет к чёрному.

Пишет assets/textures/maple-leaf.webp, maple-leaf-back.webp и maple-leaf.json:
grid — столбцов и строк, base — где в клетке кончик черешка (доли клетки, v снизу), kind — вид листа:
0 — отдельный листочек, 1 — тройчатый, 2 — из пяти листочков (по номеру: 1–2, 3–4, 5 в каждой пятёрке).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

CELL = 512
COLS, ROWS = 5, 4
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'textures'


def bleed(rgba):
    """Прозрачным точкам — цвет ближайшей непрозрачной."""
    solid = rgba[:, :, 3] > 0
    _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
    out = rgba.copy()
    out[:, :, :3] = rgba[iy, ix, :3]
    return out


def main(folder):
    folder = Path(folder)
    count = COLS * ROWS
    atlases = {side: np.zeros((ROWS * CELL, COLS * CELL, 4), np.uint8) for side in ('', '_back')}
    base, kind = [], []
    for n in range(count):
        for side, atlas in atlases.items():
            image = Image.open(folder / f'timber_maple_leaf_{n + 1:02d}{side}.png').convert('RGBA')
            if side == '':
                alpha = np.asarray(image)[:, :, 3] > 128
                ys, xs = np.nonzero(alpha)
                bottom = ys.max()
                size = image.width
                base.append([round(float(xs[ys >= bottom - 4].mean()) / size, 4), round(1 - bottom / size, 4)])
                kind.append([0, 0, 1, 1, 2][n % 5])
            cell = bleed(np.asarray(image.resize((CELL, CELL), Image.LANCZOS)))
            r, c = divmod(n, COLS)
            atlas[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = cell
    for side, atlas in atlases.items():
        Image.fromarray(atlas).save(OUT / f'maple-leaf{side.replace("_", "-")}.webp', quality=90, method=6)
    (OUT / 'maple-leaf.json').write_text(json.dumps({'grid': [COLS, ROWS], 'base': base, 'kind': kind}))


if __name__ == '__main__':
    main(sys.argv[1])
