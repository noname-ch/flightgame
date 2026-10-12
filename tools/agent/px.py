#!/usr/bin/env python3
# px.py CODE VIEW x y [x y ...]: screenshot pixels -> lat lon (VIEW: game, sat, apron, apronsat)
# px.py CODE VIEW --ll lat lon ...: lat lon -> pixels
import json, math, sys, os
d = json.load(open(os.path.join(os.path.dirname(__file__), 'shots', sys.argv[1].upper() + '.json')))
v = d['views'][sys.argv[2]]
scale = 256 * 2 ** v['zoom']
a = sys.argv[3:]
if a and a[0] == '--ll':
    n = list(map(float, a[1:]))
    for lat, lon in zip(n[::2], n[1::2]):
        x = (lon + 180) / 360 * scale - v['x']
        y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * scale - v['y']
        print(round(x), round(y))
else:
    n = list(map(float, a))
    for x, y in zip(n[::2], n[1::2]):
        gx, gy = (x + v['x']) / scale, (y + v['y']) / scale
        print(round(math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy)))), 5), round(gx * 360 - 180, 5))
