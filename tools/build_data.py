#!/usr/bin/env python3
"""Builds the generated map data in js/data/ from open datasets.

  airports-more.js  every airport/airfield in the map bounds that is not in airports.js
  runways.js        runway geometry for all airports (drawn when zoomed in)
  cities.js         towns with 15k+ people that are not already in towns.js

Sources (download into tools/cache/ first, see README):
  https://davidmegginson.github.io/ourairports-data/airports.csv
  https://davidmegginson.github.io/ourairports-data/runways.csv
  https://download.geonames.org/export/dump/cities15000.zip  (unzipped: cities15000.txt)

Usage: python3 tools/build_data.py [cache dir]
"""
import csv
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', 'cache')
DATA = os.path.join(ROOT, 'js', 'data')

# The whole world. In the Europe box every airfield with MIN_SMALL_RUNWAY_M of runway is included;
# elsewhere small airports need an IATA code or a paved runway (skips ~11k private grass strips).
BOUNDS = ((-90, -180), (90, 180))
EUROPE = ((25, -40), (75, 50))
MIN_SMALL_RUNWAY_M = 500
TOWN_MERGE_KM = 12         # cities this close to a hand-made town are already in its metro population
PAVED = ('ASP', 'CON', 'PEM', 'BIT', 'TAR', 'PAV', 'MAC')


def inside(lat, lon, box=BOUNDS):
    (s, w), (n, e) = box
    return s <= lat <= n and w <= lon <= e


def km(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    h = math.sin((lat2 - lat1) * p / 2) ** 2 + \
        math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def offset(lat, lon, bearing_deg, dist_m):
    """Point dist_m from (lat, lon) along bearing (flat-earth, fine for a few km)."""
    b = math.radians(bearing_deg)
    dlat = dist_m * math.cos(b) / 111320
    dlon = dist_m * math.sin(b) / (111320 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def hand_entries(path, keys):
    """Reads `{ code: 'BRN', ... lat: 1, lon: 2 }` style objects out of a hand-written data file."""
    out = []
    for line in open(path, encoding='utf-8'):
        m = re.search(r"\{(.*)\}", line)
        if not m:
            continue
        row = {}
        for k in keys:
            v = re.search(k + r": ('(?:[^'\\]|\\.)*'|[-\d.]+)", m.group(1))
            if v:
                s = v.group(1)
                row[k] = s[1:-1].replace("\\'", "'") if s.startswith("'") else float(s)
        out.append(row)
    return out


def runway_geometry(r, ap):
    """[lat1, lon1, lat2, lon2, width_m, paved] or None."""
    length = float(r['length_ft'] or 0) * 0.3048
    if length < 100:
        return None
    width = float(r['width_ft'] or 0) * 0.3048 or (45 if length > 2400 else 30)
    paved = 1 if r['surface'].upper()[:3] in PAVED else 0
    try:
        return [float(r['le_latitude_deg']), float(r['le_longitude_deg']),
                float(r['he_latitude_deg']), float(r['he_longitude_deg']), round(width), paved]
    except ValueError:
        pass
    # No coordinates: centre it on the airport, heading from the runway number (e.g. "09L").
    hdg = r['le_heading_degT']
    if hdg:
        hdg = float(hdg)
    else:
        m = re.match(r'(\d{1,2})', r['le_ident'] or '')
        if not m:
            return None
        hdg = int(m.group(1)) * 10
    a = offset(ap['lat'], ap['lon'], hdg + 180, length / 2)
    b = offset(ap['lat'], ap['lon'], hdg, length / 2)
    return [a[0], a[1], b[0], b[1], round(width), paved]


def spread(rws, ap):
    """Runways placed on the airport centre would overlap; shift extra parallel ones sideways."""
    for i, g in enumerate(rws[1:], 1):
        if g[-1] != 'guess':
            continue
        hdg = math.degrees(math.atan2((g[3] - g[1]) * math.cos(math.radians(g[0])), g[2] - g[0]))
        a = offset(g[0], g[1], hdg + 90, 300 * i)
        b = offset(g[2], g[3], hdg + 90, 300 * i)
        g[0], g[1], g[2], g[3] = a[0], a[1], b[0], b[1]
    return [g[:6] for g in rws]


def main():
    hand_airports = hand_entries(os.path.join(DATA, 'airports.js'), ['code', 'lat', 'lon'])
    hand_codes = {a['code'] for a in hand_airports}
    hand_towns = hand_entries(os.path.join(DATA, 'towns.js'), ['name', 'lat', 'lon', 'pop'])

    runways = {}
    for r in csv.DictReader(open(os.path.join(CACHE, 'runways.csv'), encoding='utf-8')):
        if r['closed'] != '1':
            runways.setdefault(r['airport_ident'], []).append(r)

    more = []
    geo = {}
    taken = set(hand_codes)
    candidates = []
    for a in csv.DictReader(open(os.path.join(CACHE, 'airports.csv'), encoding='utf-8')):
        lat, lon = float(a['latitude_deg']), float(a['longitude_deg'])
        if a['type'] not in ('small_airport', 'medium_airport', 'large_airport') or not inside(lat, lon):
            continue
        ap = {'lat': lat, 'lon': lon}
        rws = []
        for r in runways.get(a['ident'], []):
            g = runway_geometry(r, ap)
            if g:
                rws.append(g + (['guess'] if not r['le_latitude_deg'] else []))
        rws.sort(key=lambda g: -km(g[0], g[1], g[2], g[3]))
        longest = max([km(g[0], g[1], g[2], g[3]) * 1000 for g in rws] or [0])
        iata = a['iata_code'].strip()
        if a['type'] == 'small_airport' and not iata:
            paved = max([km(g[0], g[1], g[2], g[3]) * 1000 for g in rws if g[5]] or [0])
            if (longest if inside(lat, lon, EUROPE) else paved) < MIN_SMALL_RUNWAY_M:
                continue
        candidates.append((a, iata, spread(rws, ap), longest))

    # IATA codes first so a small field's ICAO ident never steals a real code.
    candidates.sort(key=lambda c: (not c[1], c[0]['ident']))
    for a, iata, rws, longest in candidates:
        lat, lon = round(float(a['latitude_deg']), 4), round(float(a['longitude_deg']), 4)
        if iata in hand_codes:
            geo[iata] = rws
            continue
        code = iata if iata and iata not in taken else a['ident']
        if code in taken:
            continue
        taken.add(code)
        sched = a['scheduled_service'] == 'yes'
        if a['type'] == 'large_airport':
            size = 5 if longest >= 3800 and sched else 4
        elif a['type'] == 'medium_airport':
            size = 3 if sched and longest >= 2400 else 2
        else:
            size = 1
        name = a['name'].replace(' Airport', '').replace(' International', '').strip() or code
        city = a['municipality'] or name
        minor = 0 if iata else 1  # airfields without an IATA code draw fewer passengers
        more.append([code, name, city, a['iso_country'], lat, lon, size, minor])
        geo[code] = rws

    def r4(g):
        return [round(g[0], 4), round(g[1], 4), round(g[2], 4), round(g[3], 4), g[4], g[5]]

    with open(os.path.join(DATA, 'airports-more.js'), 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/build_data.py from OurAirports (public domain). Do not edit by hand –\n')
        f.write('// hand-made airports belong in airports.js, which takes precedence.\n')
        f.write('// [code, name, city, country, lat, lon, size, minor (no IATA code: fewer passengers)]; extra = not hand-made\n')
        f.write('FG.data.airports.push(...[\n')
        for row in more:
            f.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + ',\n')
        f.write('].map(([code, name, city, country, lat, lon, size, minor]) =>\n')
        f.write('  ({ code, name, city, country, lat, lon, size, minor: !!minor, extra: true })));\n')

    with open(os.path.join(DATA, 'runways.js'), 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/build_data.py from OurAirports (public domain).\n')
        f.write('// code -> runways as [lat1, lon1, lat2, lon2, width m, paved 0/1]\n')
        f.write('FG.data.runways = {\n')
        for code, rws in geo.items():
            if rws:
                f.write(json.dumps(code) + ':' + json.dumps([r4(g) for g in rws], separators=(',', ':')) + ',\n')
        f.write('};\n')

    towns = []
    names = {t['name'] for t in hand_towns}
    for line in open(os.path.join(CACHE, 'cities15000.txt'), encoding='utf-8'):
        c = line.rstrip('\n').split('\t')
        lat, lon, pop = float(c[4]), float(c[5]), int(c[14] or 0)
        if not inside(lat, lon) or pop < 15000 or c[1] in names:
            continue
        if any(abs(t['lat'] - lat) < 0.2 and km(t['lat'], t['lon'], lat, lon) < TOWN_MERGE_KM for t in hand_towns):
            continue
        towns.append([c[1], c[8], round(lat, 3), round(lon, 3), pop])
    towns.sort(key=lambda t: -t[4])
    with open(os.path.join(DATA, 'cities.js'), 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/build_data.py from GeoNames cities15000 (CC BY 4.0, geonames.org).\n')
        f.write('// Towns with 15k+ people that are not already part of a hand-made town in towns.js.\n')
        f.write('FG.data.towns.push(...[\n')
        for t in towns:
            f.write(json.dumps(t, ensure_ascii=False, separators=(',', ':')) + ',\n')
        f.write('].map(([name, country, lat, lon, pop]) => ({ name, country, lat, lon, pop })));\n')

    missing = sorted(hand_codes - set(geo))
    print(f'{len(more)} extra airports, {sum(1 for v in geo.values() if v)} with runways, {len(towns)} cities')
    if missing:
        print('hand airports without runway data:', ', '.join(missing))


if __name__ == '__main__':
    main()
