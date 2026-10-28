"""Готовит панораму дальнего плана из картинки ChatGPT: python3 tools/panorama.py <картинка> <имя> <горизонт>.

Картинка — круг на 360°, правый край продолжает левый, небо чистый чёрный #000. <горизонт> — где на ней
линия горизонта, доля высоты от верха: туда игра поставит уровень глаз.

Пишет assets/textures/<имя>.webp — без неба (прозрачность по яркости, как у пучков), шириной WIDTH:
шире многие видеокарты не берут — и <имя>.json с горизонтом и отношением ширины к высоте.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

WIDTH = 8192
DARK, SOFT = 0.05, 0.12  # ярче DARK — уже земля, полная непрозрачность через ещё SOFT


def main(path, name, horizon):
    rgb = np.asarray(Image.open(path).convert('RGB'), np.float32) / 255
    # ChatGPT повторяет первый столбец последним, чтобы показать бесшовность: в кольце он стал бы швом.
    if np.abs(rgb[:, 0] - rgb[:, -1]).mean() < 1e-3:
        rgb = rgb[:, :-1]
    alpha = np.clip((rgb.max(2) - DARK) / SOFT, 0, 1)
    rgb = np.clip(rgb / np.maximum(alpha, 1e-3)[..., None], 0, 1)
    # Небо берёт цвет ближайшего склона, а не чёрный: иначе вдали гребни обвело бы тёмной каймой.
    _, (iy, ix) = ndimage.distance_transform_edt(alpha < 0.5, return_indices=True)
    rgb = rgb[iy, ix]
    # Цвет и прозрачность уменьшаем порознь: RGBA PIL уменьшает с домножением на прозрачность
    # и обнулил бы цвет неба, который мы только что залили.
    size = (WIDTH, round(WIDTH * rgb.shape[0] / rgb.shape[1]))
    rgb, alpha = (Image.fromarray((x * 255).astype(np.uint8)).resize(size, Image.LANCZOS) for x in (rgb, alpha))
    img = Image.merge('RGBA', (*rgb.split(), alpha))
    out = Path('assets/textures') / name
    img.save(out.with_suffix('.webp'), lossless=True, exact=True, quality=100, method=6)
    out.with_suffix('.json').write_text(json.dumps({'horizon': float(horizon), 'aspect': round(img.width / img.height, 4)}) + '\n')


main(*sys.argv[1:])
