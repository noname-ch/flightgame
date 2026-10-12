#!/usr/bin/env python3
# fixop.py CODE '<op json>' ...: append airport fix ops to js/data/fixes.js (same writer as tools/serve.py)
# fixop.py CODE --show: print the airport's ops
import json, sys
sys.path.insert(0, __import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..'))
import serve
fixes = serve.read_fixes()
code = sys.argv[1].upper()
if sys.argv[2:] == ['--show']:
    for o in fixes.get(code, []): print(json.dumps(o))
    sys.exit()
ops = fixes.setdefault(code, [])
for a in sys.argv[2:]:
    o = json.loads(a)
    assert o['op'] in ('add', 'del', 'set') and o['kind'] and 'geom' in o and (o['op'] != 'set' or 'from' in o or o['kind'] == 'bridges'), a
    ops.append(o)
serve.write_fixes(fixes)
print(code, len(ops), 'ops')
