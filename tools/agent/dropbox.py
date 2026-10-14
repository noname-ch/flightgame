#!/usr/bin/env python3
# dropbox.py CODE VIEW x1 y1 x2 y2 [--from N] [--dry]: removes the airport's stand ops from op N on (default 0) whose
# stand lies in a pixel box of a shot (for a set or del: the stand it changes). For taking back this session's
# pins, nose-ins or deletes in a part of the airport a person has already fixed by hand: start N past their ops.
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import serve
D = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
dry = '--dry' in args
args = [a for a in args if a != '--dry']
start = 0
if '--from' in args:
    i = args.index('--from'); start = int(args[i + 1]); del args[i:i + 2]
code, view = args[0].upper(), args[1]
x1, y1, x2, y2 = map(float, args[2:6])
v = json.load(open(f'{D}/shots/{code}.json'))['views'][view]
s = 256 * 2 ** v['zoom']
def inbox(lat, lon):
    x = (lon + 180) / 360 * s - v['x']
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * s - v['y']
    return x1 <= x <= x2 and y1 <= y <= y2
fixes = serve.read_fixes()
ops = fixes.get(code, [])
keep, n = [], 0
for i, o in enumerate(ops):
    g = o.get('from') or o['geom']
    if i >= start and o['kind'] == 'stand' and inbox(g[0], g[1]):
        n += 1
        if dry: print(i, json.dumps(o))
        continue
    keep.append(o)
if not dry:
    fixes[code] = keep
    serve.write_fixes(fixes)
print(code, n, 'stand ops', 'found' if dry else 'removed')
