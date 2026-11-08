"""Атлас деревьев одного вида из картинок ChatGPT: python3 tools/trees.py <папка> <вид>.

В папке — timber_<вид>_NN.png: одно дерево на прозрачном фоне (RGBA), комель по центру нижнего края.
Пишет assets/textures/<вид>-trees.webp (клетки в ряд, без потерь: цвет под прозрачным сохраняется)
и <вид>-trees.json: сетку, отношение ширины клетки к высоте и рост каждого дерева в метрах (картинка —
во весь рост дерева, ведь макушка у всех на одной высоте листа, а настоящий рост задаёт HEIGHTS).
"""
import json
import sys
from pathlib import Path

from PIL import Image

# Рост в метрах по номерам картинок (как заказано у ChatGPT): взрослые, средние, молодые, сухие.
HEIGHTS = {
    'birch': [[18, 20]] * 3 + [[12, 15]] * 3 + [[6, 8], [12, 16]],
    'pine': [[22, 28]] * 4 + [[16, 20]] * 2 + [[5, 7], [18, 24]],
    'willow': [[3, 5]] * 4,
}
CELL = 512  # ширина клетки атласа

src, kind = Path(sys.argv[1]), sys.argv[2]
files = sorted(src.glob(f'timber_{kind}_[0-9][0-9].png'))
images = [Image.open(f).convert('RGBA') for f in files]
w, h = images[0].size
cell = (CELL, round(CELL * h / w))
atlas = Image.new('RGBA', (cell[0] * len(images), cell[1]))
for i, im in enumerate(images):
    atlas.paste(im.resize(cell, Image.LANCZOS), (i * cell[0], 0))
out = Path('assets/textures')
atlas.save(out / f'{kind}-trees.webp', lossless=True, exact=True)
heights = HEIGHTS[kind][:len(images)]
(out / f'{kind}-trees.json').write_text(json.dumps({'grid': [len(images), 1], 'aspect': round(w / h, 4), 'heights': heights}))
print(kind, len(images), 'деревьев', atlas.size)
