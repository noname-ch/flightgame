#!/usr/bin/env python3
# faces.py CODE TERMINAL PREFIX [--sp 42] [--off 14] [--min 40] [--box VIEW x1 y1 x2 y2] [--dry]: stands along
# every straight face of a raw terminal ring (number from raw.sh, shots/CODE-raw.json), for satellites and piers
# with gates all round. The ring is simplified (4 m), each face at least MIN m long gets stands SP m apart, OFF m
# out from it (where the noses stop) and nose-in (heading at the face). --box keeps only faces whose middle lies
# in that pixel box of a shot (to leave the landside out). Stands that land inside the ring or within OFF-2 m of
# another face (inner corners) are left out. Run fixover.mjs afterwards (corners), after a RELOAD=1 shoot.
# --others also leaves out stands inside (or within OFF-2 m of) the other raw terminal rings: for terminals cut
# into pieces at map-tile edges, whose cut faces lie inside the building.
import json, math, os, subprocess, sys
D = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
def opt(name, default, n=1):
    if '--' + name not in args: return default
    i = args.index('--' + name)
    v = args[i + 1:i + 1 + n]
    del args[i:i + 1 + n]
    return v if n > 1 else v[0]
sp, off, mn = float(opt('sp', 42)), float(opt('off', 14)), float(opt('min', 40))
box = opt('box', None, 5)
dry = '--dry' in args
others = '--others' in args
args = [a for a in args if a not in ('--dry', '--others')]
code, ti, prefix = args[0].upper(), int(args[1]), args[2]
raw = json.load(open(f'{D}/shots/{code}-raw.json'))
ring = raw['terminals'][ti]
if ring[0] == ring[-1]: ring = ring[:-1]
M = 111320
o = ring[0]
kx = M * math.cos(math.radians(o[0]))
P = [((p[1] - o[1]) * kx, (p[0] - o[0]) * M) for p in ring]
ll = lambda q: (round(o[0] + q[1] / M, 6), round(o[1] + q[0] / kx, 6))
def dp(pts, tol):  # Douglas-Peucker on an open line
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
    d = [abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L for p in pts]
    i = max(range(len(pts)), key=lambda k: d[k])
    if d[i] <= tol: return [a, b]
    return dp(pts[:i + 1], tol)[:-1] + dp(pts[i:], tol)
# split the closed ring at its farthest point from the first, simplify both halves
far = max(range(len(P)), key=lambda k: math.hypot(P[k][0] - P[0][0], P[k][1] - P[0][1]))
S = dp(P[:far + 1], 4)[:-1] + dp(P[far:] + [P[0]], 4)[:-1]
area = sum(S[i][0] * S[(i + 1) % len(S)][1] - S[(i + 1) % len(S)][0] * S[i][1] for i in range(len(S))) / 2
def inside(q, R):
    c = False
    for i in range(len(R)):
        a, b = R[i], R[(i + 1) % len(R)]
        if (a[1] > q[1]) != (b[1] > q[1]) and q[0] < a[0] + (q[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]): c = not c
    return c
def segd(q, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / ((dx * dx + dy * dy) or 1)))
    return math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1])
if box:
    v = json.load(open(f'{D}/shots/{code}.json'))['views'][box[0]]
    bx1, by1, bx2, by2 = map(float, box[1:])
    scale = 256 * 2 ** v['zoom']
    def inbox(q):
        lat, lon = ll(q)
        x = (lon + 180) / 360 * scale - v['x']
        y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * scale - v['y']
        return bx1 <= x <= bx2 and by1 <= y <= by2
O = []
if others:
    for k, r in enumerate(raw['terminals']):
        if k != ti: O.append([((p[1] - o[1]) * kx, (p[0] - o[0]) * M) for p in r])
def nearother(q):
    for R in O:
        if inside(q, R) or any(segd(q, R[m], R[(m + 1) % len(R)]) < off - 2 for m in range(len(R))): return True
    return False
ops, n = [], 0
for i in range(len(S)):
    a, b = S[i], S[(i + 1) % len(S)]
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    if L < mn: continue
    if box and not inbox(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)): continue
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    nx, ny = (uy, -ux) if area > 0 else (-uy, ux)  # outward normal
    k = max(1, int((L - 20) / sp + 1e-6) + 1)
    step = (L - 20) / max(1, k - 1) if k > 1 else 0
    hdg = round((math.degrees(math.atan2(-nx, -ny)) + 360) % 360)
    for j in range(k):
        t = 10 + j * step if k > 1 else L / 2
        q = (a[0] + ux * t + nx * off, a[1] + uy * t + ny * off)
        if inside(q, P) or any(segd(q, S[m], S[(m + 1) % len(S)]) < off - 2 for m in range(len(S)) if m != i) or nearother(q): continue
        n += 1
        lat, lon = ll(q)
        ops.append(json.dumps({'op': 'add', 'kind': 'stand', 'geom': [lat, lon, hdg, f'{prefix}{n}', 1]}))
print(f'{len(S)} faces, {n} stands')
if not dry and ops: subprocess.run(['python3', os.path.join(D, 'fixop.py'), code, *ops], check=True)
