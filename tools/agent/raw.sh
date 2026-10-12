#!/bin/bash
# raw.sh CODE VIEW: the airport's raw layout elements (before fixes) with pixel positions in that shot view
D=$(dirname "$0")
node $D/ev.mjs "(async()=>{FG.layouts.get('$1'); for(let i=0;i<60&&!(FG.layouts.settled('$1')&&!FG.layouts.pending('$1'));i++) await new Promise(r=>setTimeout(r,500)); return JSON.stringify(FG.layouts.raw('$1'))})()" > $D/shots/$1-raw.json
D=$D python3 - "$1" "$2" <<'PY'
import json, math, sys, os
code, view = sys.argv[1], sys.argv[2]
D = os.path.dirname(os.path.abspath(__file__)) if '__file__' in dir() else '.'
base = os.path.join(os.environ['D'], 'shots') + '/'
r = json.load(open(base + code + '-raw.json'))
v = json.load(open(base + code + '.json'))['views'][view]
scale = 256 * 2 ** v['zoom']
def px(lat, lon):
    x = (lon + 180) / 360 * scale - v['x']
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * scale - v['y']
    return f"({round(x)},{round(y)})"
for k in ['stands', 'towers']:
    for i, s in enumerate(r.get(k) or []):
        print(k, i, px(s[0], s[1]), json.dumps(s))
for k in ['taxiways', 'aprons', 'terminals', 'hangars', 'others', 'pads']:
    for i, l in enumerate(r.get(k) or []):
        print(k, i, ' '.join(px(*p) for p in l[:6]) + (' …' if len(l) > 6 else ''), f'[{len(l)} pts]')
PY
