#!/usr/bin/env python3
# rawops.py CODE [KIND]: prints the raw layout's stands (or another point kind) from shots/CODE-raw.json (raw.sh)
# as add ops, one per line, for plotops.py: shows every mapped stand, also those the game leaves out (it uses
# only 2×GATE_COUNT of them unless pin.mjs pins them).
import json, os, sys
D = os.path.dirname(os.path.abspath(__file__))
code = sys.argv[1].upper()
kind = sys.argv[2] if len(sys.argv) > 2 else 'stands'
raw = json.load(open(f'{D}/shots/{code}-raw.json'))
for s in raw.get(kind) or []:
    print(json.dumps({'op': 'add', 'kind': 'stand', 'geom': s}))
