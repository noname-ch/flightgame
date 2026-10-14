#!/usr/bin/env python3
# curvelist.py CODE FROM [NEAR_M]: lists the taxiway ops from op FROM on with 3+ points (tidy's curves and turns)
# with their length and their least distance to a runway centre line (runways from shots/CODE.json, so shoot first);
# those within NEAR_M (default 250) of a runway are marked "near": look at them with curves.py --ops. Curves with an
# end leg within 20° of a runway's heading and within 2×NEAR_M of it are marked "along" (they bend a taxiway that
# runs along the runway: undo them too).
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import serve
D = os.path.dirname(os.path.abspath(__file__))
code, start = sys.argv[1].upper(), int(sys.argv[2])
near = float(sys.argv[3]) if len(sys.argv) > 3 else 250
info = json.load(open(f'{D}/shots/{code}.json'))
o = (info['lat'], info['lon'])
kx = 111320 * math.cos(math.radians(o[0]))
P = lambda p: ((p[1] - o[1]) * kx, (p[0] - o[0]) * 111320)
def segd(q, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / ((dx * dx + dy * dy) or 1)))
    return math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1])
rws = [(P(r[0:2]), P(r[2:4])) for r in info['runways']]
ops = serve.read_fixes()[code]
for i, op in enumerate(ops):
    if i < start or op['kind'] != 'taxiway' or len(op['geom']) < 3: continue
    g = [P(p) for p in op['geom']]
    L = sum(math.hypot(g[k + 1][0] - g[k][0], g[k + 1][1] - g[k][1]) for k in range(len(g) - 1))
    d = min(segd(q, a, b) for q in g for a, b in rws)
    def brg(a, b): return math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) % 180
    legs = [brg(g[0], g[1]), brg(g[-2], g[-1])]
    par = any(min(abs(l - brg(a, b)), 180 - abs(l - brg(a, b))) < 20 and min(segd(q, a, b) for q in g) < 2 * near
              for l in legs for a, b in rws)
    print(i, op['op'], f'{L:.0f} m long', f'{d:.0f} m from a runway', 'near' if d < near else 'along' if par else '')
