"""產生 PWA 圖示（深藍底、一座藍塔對一座紅塔）。改圖示就改這裡再跑一次：python tools/make_icons.py"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
os.makedirs(ROOT, exist_ok=True)


def draw(size, pad):
    im = Image.new('RGBA', (size, size), '#0d1420')
    d = ImageDraw.Draw(im)
    s = size
    # 河
    d.rectangle([0, s * 0.47, s, s * 0.53], fill='#1b3a5c')
    # 兩條路
    for x in (0.3, 0.7):
        d.rectangle([s * (x - 0.08), 0, s * (x + 0.08), s], fill='#17202e')
    d.rectangle([0, s * 0.47, s, s * 0.53], fill='#1b3a5c')
    for x in (0.3, 0.7):
        d.rectangle([s * (x - 0.07), s * 0.45, s * (x + 0.07), s * 0.55], fill='#3b3326')
    # 上紅塔、下藍塔（六角主堡）
    def hexagon(cx, cy, r, fill, outline):
        import math
        pts = [(cx + r * math.cos(math.pi / 3 * i + math.pi / 6), cy + r * math.sin(math.pi / 3 * i + math.pi / 6)) for i in range(6)]
        d.polygon(pts, fill=fill, outline=outline, width=max(2, s // 48))
    hexagon(s * 0.5, s * (0.17 + pad), s * 0.13, '#8a1d1d', '#ff5a5a')
    hexagon(s * 0.5, s * (0.83 - pad), s * 0.13, '#1d4f8a', '#4da3ff')
    # 幾個小兵
    for i, x in enumerate((0.3, 0.7)):
        d.ellipse([s * (x - 0.05), s * 0.30, s * (x + 0.05), s * 0.40], fill='#8a1d1d', outline='#ff5a5a', width=max(2, s // 64))
        d.ellipse([s * (x - 0.05), s * 0.60, s * (x + 0.05), s * 0.70], fill='#1d4f8a', outline='#4da3ff', width=max(2, s // 64))
    return im


draw(192, 0).save(os.path.join(ROOT, 'icon-192.png'))
draw(512, 0).save(os.path.join(ROOT, 'icon-512.png'))
draw(512, 0.06).save(os.path.join(ROOT, 'icon-maskable-512.png'))
print('ok')
