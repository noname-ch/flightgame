#!/usr/bin/env python3
# hull.py CODE i j k ...: add one apron covering the raw aprons i, j, k... (their convex hull; numbers as raw.sh
# lists them, from shots/CODE-raw.json). For aprons mapped as jagged pieces cut round each gate, which leave
# holes where the satellite shows through.
import json, os, subprocess, sys
code = sys.argv[1].upper()
D = os.path.dirname(os.path.abspath(__file__))
raw = json.load(open(os.path.join(D, 'shots', code + '-raw.json')))
pts = sorted({(p[0], p[1]) for i in sys.argv[2:] for p in raw['aprons'][int(i)]}, key=lambda p: (p[1], p[0]))
def cross(o, a, b): return (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1])
lo, hi = [], []
for p in pts:
    while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
    lo.append(p)
for p in reversed(pts):
    while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0: hi.pop()
    hi.append(p)
ring = [[round(a, 6), round(b, 6)] for a, b in lo[:-1] + hi[:-1]]
ring.append(ring[0])
print(len(ring), 'points')
subprocess.run(['python3', os.path.join(D, 'fixop.py'), code, json.dumps({'op': 'add', 'kind': 'apron', 'geom': ring})], check=True)
