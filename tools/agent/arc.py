#!/usr/bin/env python3
# arc.py CODE VIEW cx cy r a0 a1 n PREFIX [START]: add n stands on a circle round pixel (cx, cy) of a shot, radius r
# pixels, from screen angle a0 to a1 (degrees, 0 = east, 90 = south), each facing the centre (nose-in), named
# PREFIX+number from START. For round satellites with gates all round.
import json, math, os, subprocess, sys
D = os.path.dirname(os.path.abspath(__file__))
code, view = sys.argv[1].upper(), sys.argv[2]
cx, cy, r, a0, a1 = map(float, sys.argv[3:8])
n = int(sys.argv[8]); prefix = sys.argv[9]
start = int(sys.argv[10]) if len(sys.argv) > 10 else 1
v = json.load(open(os.path.join(D, 'shots', code + '.json')))['views'][view]
scale = 256 * 2 ** v['zoom']
def ll(x, y):
    gx, gy = (x + v['x']) / scale, (y + v['y']) / scale
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy)))), gx * 360 - 180
ops = []
for i in range(n):
    a = math.radians(a0 + (a1 - a0) * (i / (n - 1) if n > 1 else 0.5))
    lat, lon = ll(cx + r * math.cos(a), cy + r * math.sin(a))
    hdg = round((math.degrees(a) + 90 + 180) % 360)  # screen angle -> compass bearing, then towards the centre
    ops.append(json.dumps({'op': 'add', 'kind': 'stand', 'geom': [round(lat, 6), round(lon, 6), hdg, f'{prefix}{start + i}', 1]}))
subprocess.run(['python3', os.path.join(D, 'fixop.py'), code, *ops], check=True)
