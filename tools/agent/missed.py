#!/usr/bin/env python3
# missed.py CODE [--fix M]: the airport's fix ops that found no element (FG.fixes.missed), each with the nearest raw
# element of its kind and how far (m) it lies from the shape the op remembers. Where the map data moved a little
# (an element now 6-M m off, default M 20), --fix points the op at the element as it is now (`from` of a set, the
# shape of a del), so the fix holds again. Needs raw.sh CODE <view> first (shots/CODE-raw.json).
import json, math, os, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import serve
D = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
fix = None
if '--fix' in args:
    i = args.index('--fix')
    fix = float(args[i + 1]) if i + 1 < len(args) and not args[i + 1].startswith('-') else 20.0
    del args[i:i + 2 if i + 1 < len(args) and not args[i + 1].startswith('-') else i + 1]
code = args[0].upper()
out = subprocess.run(['node', D + '/ev.mjs', f"JSON.stringify(FG.fixes.missed('{code}'))"], capture_output=True, text=True).stdout.strip()
missed = json.loads(out or '[]')
raw = json.load(open(f'{D}/shots/{code}-raw.json'))
LISTS = {'taxiway': 'taxiways', 'apron': 'aprons', 'pad': 'pads', 'terminal': 'terminals', 'hangar': 'hangars', 'building': 'others', 'stand': 'stands', 'tower': 'towers'}
M = 111320
def ptm(p, q): return math.hypot((q[1] - p[1]) * M * math.cos(math.radians(p[0])), (q[0] - p[0]) * M)
def pts(k, g): return [g] if k in ('stand', 'tower') else g
def segm(p, a, b):
    kx = M * math.cos(math.radians(p[0]))
    ax, ay, bx, by = (a[1] - p[1]) * kx, (a[0] - p[0]) * M, (b[1] - p[1]) * kx, (b[0] - p[0]) * M
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, -(ax * dx + ay * dy) / ((dx * dx + dy * dy) or 1)))
    return math.hypot(ax + t * dx, ay + t * dy)
def reach(P, Q):  # farthest point of P from the line Q
    if len(Q) == 1: return max(ptm(p, Q[0]) for p in P)
    return max(min(segm(p, Q[i], Q[i + 1]) for i in range(len(Q) - 1)) for p in P)
def gap(k, a, b):
    A, B = pts(k, a), pts(k, b)
    return max(reach(A, B), reach(B, A))
fixes = serve.read_fixes()
ops = fixes.get(code, [])
changed = 0
for o in missed:
    if o['kind'] not in LISTS:
        print(o['op'], o['kind'], 'not a layout element'); continue
    shape = o['from'] if o['op'] == 'set' else o['geom']
    best = None
    for i, e in enumerate(raw.get(LISTS[o['kind']]) or []):
        d = gap(o['kind'], shape, e)
        if best is None or d < best[0]: best = (d, i, e)
    on = min(((reach(pts(o['kind'], shape), pts(o['kind'], e)), i) for i, e in enumerate(raw.get(LISTS[o['kind']]) or [])), default=None)
    print(o['op'], o['kind'], f'nearest raw #{best[1]} {best[0]:.1f} m' if best else 'no raw element',
          f'(its shape lies within {on[0]:.1f} m of raw #{on[1]})' if on else '', json.dumps(shape)[:90])
    if fix is not None and best and best[0] <= fix:
        for op in ops:
            if op == o:
                if o['op'] == 'set': op['from'] = best[2]
                else: op['geom'] = best[2]
                changed += 1
                break
if not missed: print(code, 'missed: none')
if changed:
    serve.write_fixes(fixes)
    print(changed, 'ops pointed at the elements as they are now')
