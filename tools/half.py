"""Копии картинок вдвое меньше по стороне для телефона: python3 tools/half.py

Читает assets/textures/*.{jpg,png,webp}, пишет assets/textures/half/ с теми же именами и форматами (src/device.js
берёт их на телефоне). Картинки до 256 точек по стороне не уменьшает. Запускать после каждой новой картинки:
пропускает те, чья копия новее оригинала.
"""
from pathlib import Path

from PIL import Image

TEXTURES = Path(__file__).resolve().parent.parent / 'assets' / 'textures'
HALF = TEXTURES / 'half'
SMALL = 256


def main():
    HALF.mkdir(exist_ok=True)
    for source in sorted(TEXTURES.iterdir()):
        if source.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
            continue
        target = HALF / source.name
        if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
            continue
        image = Image.open(source)
        if min(image.size) > SMALL:
            image = image.resize((image.width // 2, image.height // 2), Image.LANCZOS)
        alpha = image.mode in ('RGBA', 'LA', 'P')
        if source.suffix.lower() == '.webp':
            # С прозрачностью — без потерь: края листьев и травинок по альфе, артефакты сжатия там видны.
            image.save(target, lossless=alpha, quality=90, method=6)
        elif source.suffix.lower() == '.png':
            image.save(target, optimize=True)
        else:
            image.convert('RGB').save(target, quality=88)


if __name__ == '__main__':
    main()
