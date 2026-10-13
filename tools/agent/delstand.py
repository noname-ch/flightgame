#!/usr/bin/env python3
# delstand.py CODE NAME ...: delete stands by name (as the game shows them), via fixop.py. Looks the names up in
# the raw layout (shots/CODE-raw.json, from raw.sh) and in the stands this session added (fix ops); a name that
# several stands share deletes them all.
import json, os, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import serve
D = os.path.dirname(os.path.abspath(__file__))
code, names = sys.argv[1].upper(), set(sys.argv[2:])
raw = json.load(open(os.path.join(D, 'shots', code + '-raw.json')))
fixes = serve.read_fixes()
ops = fixes.setdefault(code, [])
n = 0
for s in raw.get('stands') or []:
    if str(s[3]) in names:
        set_op = next((o for o in ops if o['op'] == 'set' and o['kind'] == 'stand' and o['from'] == s), None)
        if set_op: ops.remove(set_op)
        ops.append({'op': 'del', 'kind': 'stand', 'geom': s}); n += 1
for o in list(ops):
    if o['op'] == 'add' and o['kind'] == 'stand' and str(o['geom'][3]) in names:
        ops.remove(o); n += 1
serve.write_fixes(fixes)
print(code, n, 'stands deleted')
