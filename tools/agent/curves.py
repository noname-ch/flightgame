#!/usr/bin/env python3
# curves.py CODE VIEW [--from N]: draws the airport's taxiway ops that make curves or turns (3+ points; ops from
# number N on, e.g. the ones tidy just added) over a shot's satellite picture, the new line red and the old one
# blue, each with its op number: shots/CODE-curves.png. Look for curves on a runway or along it, then undo
# them with uncurve.py. --ops i,j,... draws just those ops.
import json, math, os, sys
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import serve
args = sys.argv[1:]
start = 0
if '--from' in args:
    i = args.index('--from'); start = int(args[i + 1]); del args[i:i + 2]
only = None  # --ops i,j,...: just these ops
if '--ops' in args:
    i = args.index('--ops'); only = {int(x) for x in args[i + 1].split(',')}; del args[i:i + 2]
code, view = args[0].upper(), args[1]
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
twin = {'game': 'sat', 'apron': 'apronsat', 'detail': 'detailsat'}.get(view, view)
v = json.load(open(f'{D}/{code}.json'))['views'][view]
scale = 256 * 2 ** v['zoom']
def px(p):
    lat, lon = p[0], p[1]
    x = (lon + 180) / 360 * scale - v['x']
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * scale - v['y']
    return (x, y)
im = Image.open(f'{D}/{code}-{twin}.png').convert('RGB')
d = ImageDraw.Draw(im)
n = 0
for i, o in enumerate(serve.read_fixes().get(code, [])):
    if i < start or (only and i not in only) or o['kind'] != 'taxiway' or o['op'] == 'del' or len(o['geom']) < 3: continue
    if o.get('from'): d.line([px(p) for p in o['from']], fill=(60, 140, 255), width=2)
    d.line([px(p) for p in o['geom']], fill=(255, 40, 40), width=2)
    x, y = px(o['geom'][len(o['geom']) // 2])
    d.text((x + 4, y - 4), str(i), fill=(255, 255, 0))
    n += 1
im.save(f'{D}/{code}-curves.png')
print(n, 'curves', f'{D}/{code}-curves.png')
