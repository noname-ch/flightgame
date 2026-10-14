#!/usr/bin/env python3
# plotops.py CODE VIEW OPSFILE: draws stand ops (one JSON op per line, e.g. from faces.py --dry -v) over a shot's
# satellite picture, each as a red circle (the nose) with a yellow line back along the plane and its name:
# shots/CODE-plot.png. For checking stands before adding them. --game draws over the game shot instead.
import json, math, os, sys
from PIL import Image, ImageDraw
D = os.path.dirname(os.path.abspath(__file__))
game = '--game' in sys.argv
argv = [a for a in sys.argv if a != '--game']
code, view, opsf = argv[1].upper(), argv[2], argv[3]
v = json.load(open(f'{D}/shots/{code}.json'))['views'][view]
s = 256 * 2 ** v['zoom']
sat = view if game else {'detail': 'detailsat', 'apron': 'apronsat', 'game': 'sat'}.get(view, view)
im = Image.open(f'{D}/shots/{code}-{sat}.png').convert('RGB')
d = ImageDraw.Draw(im)
def px(lat, lon):
    x = (lon + 180) / 360 * s - v['x']
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * s - v['y']
    return x, y
for l in open(opsf):
    l = l.strip()
    if not l.startswith('{'): continue
    g = json.loads(l)['geom']
    x, y = px(g[0], g[1])
    mpp = 156543.03 * math.cos(math.radians(g[0])) / 2 ** v['zoom']
    h, L = math.radians(g[2]), 30 / mpp
    d.line((x, y, x - math.sin(h) * L, y + math.cos(h) * L), fill=(255, 255, 0), width=2)
    d.ellipse((x - 4, y - 4, x + 4, y + 4), outline=(255, 0, 0), width=2)
    d.text((x + 5, y - 5), str(g[3]), fill=(255, 0, 255))
out = f'{D}/shots/{code}-plot.png'
im.save(out)
print(out)
