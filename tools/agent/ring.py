#!/usr/bin/env python3
# ring.py CODE VIEW KIND x y x y ... [--arc cx cy r a0 a1 n] ... : add a ring (apron/terminal/...) from shot pixels.
# Tokens are read in order; "--arc cx cy r a0 a1 n" inserts n+1 points on a circle (screen angles in degrees).
# --print only prints the op. --set FROMJSON makes it a set op replacing that geometry.
import json, math, os, subprocess, sys
R = os.path.dirname(os.path.abspath(__file__))
a = sys.argv[1:]
code, view, kind = a[0].upper(), a[1], a[2]
a = a[3:]
pr = '--print' in a
if pr: a.remove('--print')
frm = None
if '--set' in a:
    i = a.index('--set'); frm = json.loads(a[i + 1]); del a[i:i + 2]
v = json.load(open(os.path.join(R, 'shots', code + '.json')))['views'][view]
scale = 256 * 2 ** v['zoom']
def ll(x, y):
    gx, gy = (x + v['x']) / scale, (y + v['y']) / scale
    return [round(math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy)))), 6), round(gx * 360 - 180, 6)]
pts = []
i = 0
while i < len(a):
    if a[i] == '--arc':
        cx, cy, r, a0, a1, n = map(float, a[i + 1:i + 7])
        for k in range(int(n) + 1):
            t = math.radians(a0 + (a1 - a0) * k / n)
            pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
        i += 7
    else:
        pts.append((float(a[i]), float(a[i + 1]))); i += 2
ring = [ll(x, y) for x, y in pts]
if kind != 'taxiway' and ring[0] != ring[-1]: ring.append(ring[0])
op = {'op': 'add', 'kind': kind, 'geom': ring} if frm is None else {'op': 'set', 'kind': kind, 'from': frm, 'geom': ring}
if pr: print(json.dumps(op)); sys.exit()
subprocess.run(['python3', os.path.join(R, 'fixop.py'), code, json.dumps(op)], check=True)
