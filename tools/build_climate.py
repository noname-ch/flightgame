#!/usr/bin/env python3
"""Builds js/data/climate.js: the real climate on a 5° grid, month by month, for the made-up weather (js/game.js
weatherAt) to follow. Source: NASA POWER climatology (long-term monthly means, https://power.larc.nasa.gov),
one point per 5° cell centre (36 × 72 = 2592 points, about an hour: POWER allows about one a second).

    python3 tools/build_climate.py [cache_dir]

Per cell and month it keeps 5 numbers, each one byte (0-255) in a string of printable characters:
  temperature at sea level (°C: T2M + 6.5 °C per km of the cell's height), its day/night range (°C),
  rain (mm a day), cloud cover (%) and humidity (%). Cells are row by row from the north (lat 87.5) and west
  (lon −177.5); each cell is 12 months × 5 bytes.
"""
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/.cache/flightgame-climate')
os.makedirs(CACHE, exist_ok=True)
PARAMS = 'T2M,T2M_RANGE,PRECTOTCORR,CLOUD_AMT,RH2M'
MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
LATS = [87.5 - 5 * i for i in range(36)]
LONS = [-177.5 + 5 * j for j in range(72)]


def fetch(lat, lon):
    path = os.path.join(CACHE, f'{lat:+.1f}_{lon:+.1f}.json')
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    url = ('https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=' + PARAMS +
           f'&community=AG&latitude={lat}&longitude={lon}&format=JSON')
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                d = json.load(r)
            if 'properties' not in d:
                raise RuntimeError(d.get('messages'))
            with open(path, 'w') as f:
                json.dump(d, f)
            time.sleep(0.6)  # (POWER answers 429 to more than about one a second)
            return d
        except Exception as e:  # (busy server: wait and try again)
            print('retry', lat, lon, e, file=sys.stderr)
            time.sleep(15 * (attempt + 1))
    raise RuntimeError(f'no data for {lat} {lon}')


def main():
    cells = [(la, lo) for la in LATS for lo in LONS]
    with ThreadPoolExecutor(1) as ex:
        data = list(ex.map(lambda c: fetch(*c), cells))
    out = []
    for d in data:
        p = d['properties']['parameter']
        h = max(0.0, d['geometry']['coordinates'][2] or 0) / 1000
        for m in MONTHS:
            v = lambda k: p[k][m] if p[k][m] is not None and p[k][m] > -900 else 0
            t = v('T2M') + 6.5 * h
            vals = [round(t + 80), round(v('T2M_RANGE') * 4), round(v('PRECTOTCORR') * 10),
                    round(v('CLOUD_AMT') * 2.5), round(v('RH2M') * 2.5)]
            out.append(bytes(min(255, max(0, x)) for x in vals))
    raw = b''.join(out)
    # bytes as latin-1 text would need escapes: store them as hex-free base64
    import base64
    b64 = base64.b64encode(raw).decode()
    js = ('// Made by tools/build_climate.py from NASA POWER climatology (long-term monthly means). See that file.\n'
          'window.FG = window.FG || {};\nFG.data = FG.data || {};\n'
          f'FG.data.climate = {{ step: 5, rows: 36, cols: 72, b64: "{b64}" }};\n')
    with open(os.path.join(ROOT, 'js', 'data', 'climate.js'), 'w') as f:
        f.write(js)
    print('climate.js', len(js), 'bytes')


if __name__ == '__main__':
    main()
