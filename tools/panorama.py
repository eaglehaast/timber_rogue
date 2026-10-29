"""Готовит панораму-кольцо из картинок ChatGPT: python3 tools/panorama.py <имя> <горизонт> <картинка>...

Картинки идут по кругу слева направо, небо на них чистый чёрный #000. Одна картинка — сразу весь круг,
её правый край продолжает левый. Если картинок несколько, каждая следующая начинается с OVERLAP
ширины предыдущей (так её дорисовывают по заготовке), а последняя ещё и кончается OVERLAP
начала первой: эти повторы вырезаем. <горизонт> — где на картинках линия горизонта, доля высоты
от верха: туда игра поставит уровень глаз.

Пишет assets/textures/<имя>-<n>.webp — кольцо без неба (прозрачность по яркости, как у пучков)
в исходном разрешении, нарезанное на куски не шире MAX_TILE: шире многие видеокарты не берут, —
и <имя>.json с горизонтом, отношением ширины кольца к высоте и шириной каждого куска.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

MAX_TILE = 8192
OVERLAP = 0.15
DARK, SOFT = 0.05, 0.12  # ярче DARK — уже земля, полная непрозрачность через ещё SOFT


def ring(paths):
    pieces = [np.asarray(Image.open(p).convert('RGB'), np.float32) / 255 for p in paths]
    if len(pieces) == 1:
        # ChatGPT повторяет первый столбец последним, чтобы показать бесшовность: в кольце он стал бы швом.
        rgb = pieces[0]
        return rgb[:, :-1] if np.abs(rgb[:, 0] - rgb[:, -1]).mean() < 1e-3 else rgb
    cut = [round(OVERLAP * p.shape[1]) for p in pieces]
    rest = [p[:, c:] for p, c in zip(pieces[1:], cut[1:])]
    rest[-1] = rest[-1][:, :-cut[-1]]
    return np.concatenate([pieces[0], *rest], 1)


def main(name, horizon, *paths):
    rgb = ring(paths)
    alpha = np.clip((rgb.max(2) - DARK) / SOFT, 0, 1)
    rgb = np.clip(rgb / np.maximum(alpha, 1e-3)[..., None], 0, 1)
    # Небо берёт цвет ближайшего склона, а не чёрный: иначе вдали гребни обвело бы тёмной каймой.
    _, (iy, ix) = ndimage.distance_transform_edt(alpha < 0.5, return_indices=True)
    rgb = rgb[iy, ix]
    img = np.dstack([rgb, alpha[..., None]])
    width = img.shape[1]
    n = math.ceil(width / MAX_TILE)
    edges = [round(width * i / n) for i in range(n + 1)]
    out = Path('assets/textures')
    for i in range(n):
        tile = Image.fromarray((img[:, edges[i]:edges[i + 1]] * 255).round().astype(np.uint8), 'RGBA')
        tile.save(out / f'{name}-{i}.webp', lossless=True, exact=True, quality=100, method=6)
    meta = {'horizon': float(horizon), 'aspect': round(width / img.shape[0], 4), 'tiles': np.diff(edges).tolist()}
    (out / f'{name}.json').write_text(json.dumps(meta) + '\n')


main(*sys.argv[1:])
