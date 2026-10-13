#!/usr/bin/env python3
# row.py CODE VIEW x1 y1 x2 y2 SPACING_M PREFIX [START]: add stands evenly along the line between two pixels of a
# shot (as the editor's "Stand row": one at each end, SPACING_M or a bit less apart), named PREFIX+number from
# START (default 1). Headings are 0 (run nosein.mjs afterwards to turn them nose-in to the terminal), or HEADING if given
# (row.py ... PREFIX START HEADING), for stands too far from a mapped terminal for nosein.
import json, math, os, subprocess, sys
code, view = sys.argv[1].upper(), sys.argv[2]
x1, y1, x2, y2, sp = map(float, sys.argv[3:8])
prefix = sys.argv[8]
start = int(sys.argv[9]) if len(sys.argv) > 9 else 1
hdg = int(sys.argv[10]) if len(sys.argv) > 10 else 0
D = os.path.dirname(os.path.abspath(__file__))
v = json.load(open(os.path.join(D, 'shots', code + '.json')))['views'][view]
scale = 256 * 2 ** v['zoom']
def ll(x, y):
    gx, gy = (x + v['x']) / scale, (y + v['y']) / scale
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy)))), gx * 360 - 180
a, b = ll(x1, y1), ll(x2, y2)
m = math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * math.cos(math.radians(a[0])))
n = max(1, int(m / sp + 1e-6) + 1)
ops = []
for i in range(n):
    f = 0.5 if n == 1 else i / (n - 1)
    lat, lon = a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])
    ops.append(json.dumps({'op': 'add', 'kind': 'stand', 'geom': [round(lat, 6), round(lon, 6), hdg, f'{prefix}{start + i}', 1]}))
print(f'{n} stands, {m:.0f} m')
subprocess.run(['python3', os.path.join(D, 'fixop.py'), code, *ops], check=True)
