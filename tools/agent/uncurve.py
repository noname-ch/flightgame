#!/usr/bin/env python3
# uncurve.py CODE i j ...: straightens the airport's taxiway ops i, j, ... (op numbers from onrw.mjs or
# fixop.py --show): their new line becomes the straight line between its ends. With --del the ops are removed
# instead, so the original lines come back. For curves the tidy step laid on or along a runway.
import json, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import serve
args = sys.argv[1:]
drop = '--del' in args
args = [a for a in args if a != '--del']
code = args[0].upper()
idx = sorted({int(a) for a in args[1:]}, reverse=True)
fixes = serve.read_fixes()
ops = fixes[code]
for i in idx:
    o = ops[i]
    assert o['kind'] == 'taxiway' and o['op'] in ('add', 'set'), o
    if drop:
        ops.pop(i)
        print('removed', i, json.dumps(o)[:120])
    else:
        o['geom'] = [o['geom'][0], o['geom'][-1]]
        print('straight', i, json.dumps(o['geom']))
serve.write_fixes(fixes)
