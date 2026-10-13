#!/usr/bin/env python3
# delbox.py CODE VIEW x1 y1 x2 y2 [--dry]: delete every stand inside that pixel box of a shot view: raw stands
# (shots/CODE-raw.json, from raw.sh; their set ops go too) and stands the fixes added.
import json, math, os, sys
D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(D, '..'))
import serve
code, view = sys.argv[1].upper(), sys.argv[2]
x1, y1, x2, y2 = map(float, sys.argv[3:7])
dry = '--dry' in sys.argv
raw = json.load(open(os.path.join(D, 'shots', code + '-raw.json')))
v = json.load(open(os.path.join(D, 'shots', code + '.json')))['views'][view]
sc = 256 * 2 ** v['zoom']
def inside(lat, lon):
    x = (lon + 180) / 360 * sc - v['x']
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * sc - v['y']
    return min(x1, x2) <= x <= max(x1, x2) and min(y1, y2) <= y <= max(y1, y2)
fixes = serve.read_fixes()
ops = fixes.setdefault(code, [])
gone = []
for s in raw.get('stands') or []:
    if inside(s[0], s[1]):
        ops[:] = [o for o in ops if not (o['op'] == 'set' and o['kind'] == 'stand' and o['from'] == s)]
        if not any(o['op'] == 'del' and o['kind'] == 'stand' and o['geom'] == s for o in ops):
            ops.append({'op': 'del', 'kind': 'stand', 'geom': s})
        gone.append(str(s[3]))
for o in list(ops):
    if o['op'] == 'add' and o['kind'] == 'stand' and inside(o['geom'][0], o['geom'][1]):
        ops.remove(o); gone.append(str(o['geom'][3]))
print(code, len(gone), 'stands deleted:', ' '.join(gone))
if not dry: serve.write_fixes(fixes)
