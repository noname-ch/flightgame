#!/usr/bin/env python3
# draw.py CODE VIEW KINDS [OUT]: draws the raw layout's elements (shots/CODE-raw.json, from raw.sh) with their
# numbers over the VIEW's satellite shot, to see which number is which ring. KINDS: comma list of aprons,
# terminals, hangars, others, taxiways, stands, pads. Writes shots/CODE-draw.png (needs Pillow).
import json, math, os, sys
from PIL import Image, ImageDraw
B = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots') + '/'
code, view, kinds = sys.argv[1].upper(), sys.argv[2], sys.argv[3].split(',')
out = sys.argv[4] if len(sys.argv) > 4 else B + code + '-draw.png'
r = json.load(open(B + code + '-raw.json'))
v = json.load(open(B + code + '.json'))['views'][view]
sat = {'game': 'sat', 'sat': 'sat', 'apron': 'apronsat', 'apronsat': 'apronsat', 'detail': 'detailsat'}[view]
img = Image.open(B + code + '-' + sat + '.png').convert('RGB')
d = ImageDraw.Draw(img)
scale = 256 * 2 ** v['zoom']
def px(lat, lon):
    x = (lon + 180) / 360 * scale - v['x']
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * scale - v['y']
    return (x, y)
col = {'aprons': (255, 0, 255), 'terminals': (0, 200, 255), 'hangars': (255, 140, 0), 'others': (255, 255, 0),
       'taxiways': (255, 0, 0), 'stands': (0, 255, 0), 'pads': (255, 255, 255)}
for k in kinds:
    for i, l in enumerate(r.get(k) or []):
        if k == 'stands':
            x, y = px(l[0], l[1]); h = math.radians(l[2])
            d.line([(x, y), (x + 12 * math.sin(h), y - 12 * math.cos(h))], fill=col[k], width=2)
            d.text((x + 3, y + 3), str(l[3]), fill=col[k])
            continue
        pts = [px(*p) for p in l]
        if k == 'taxiways': d.line(pts, fill=col[k], width=2)
        else: d.polygon(pts, outline=col[k], width=2)
        cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        d.text((cx, cy), f'{k[0]}{i}', fill=col[k])
img.save(out)
print(out)
