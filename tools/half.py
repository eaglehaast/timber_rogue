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


def shrink(image, size):
    """Уменьшает картинку. С прозрачностью цвет и прозрачность уменьшаются порознь: иначе Pillow умножает цвет на
    прозрачность и делит обратно, и под совсем прозрачными точками вместо цвета травинки остаётся чёрный — вдали
    (на уменьшенных копиях текстуры) он темнит край."""
    if image.mode != 'RGBA':
        return image.resize(size, Image.LANCZOS)
    return Image.merge('RGBA', [band.resize(size, Image.LANCZOS) for band in image.split()])


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
            image = shrink(image, (image.width // 2, image.height // 2))
        alpha = image.mode in ('RGBA', 'LA', 'P')
        if source.suffix.lower() == '.webp':
            # С прозрачностью — без потерь: края листьев и травинок по альфе, артефакты сжатия там видны;
            # exact — цвет под прозрачными точками не обнуляется.
            image.save(target, lossless=alpha, exact=alpha, quality=90, method=6)
        elif source.suffix.lower() == '.png':
            image.save(target, optimize=True)
        else:
            image.convert('RGB').save(target, quality=88)


if __name__ == '__main__':
    main()
