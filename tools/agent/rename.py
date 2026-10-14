#!/usr/bin/env python3
# rename.py CODE OLD=NEW ...: renames the stands this session added (add ops) whose names start with prefix OLD to
# NEW plus a fresh number (1, 2, ... per NEW, in op order). Several OLD prefixes may share one NEW. For stands
# added under a wrong or clashing prefix (faces.py, row.py, arc.py).
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import serve
code = sys.argv[1].upper()
pairs = [a.split('=', 1) for a in sys.argv[2:]]
fixes = serve.read_fixes()
count, n = {}, 0
for o in fixes.get(code, []):
    if o['op'] != 'add' or o['kind'] != 'stand': continue
    name = str(o['geom'][3])
    # longest matching prefix wins, and the rest of the name must be the number
    hit = max((p for p in pairs if name.startswith(p[0]) and name[len(p[0]):].isdigit()), key=lambda p: len(p[0]), default=None)
    if not hit: continue
    count[hit[1]] = count.get(hit[1], 0) + 1
    o['geom'][3] = f'{hit[1]}{count[hit[1]]}'
    n += 1
serve.write_fixes(fixes)
print(code, n, 'stands renamed', count)
