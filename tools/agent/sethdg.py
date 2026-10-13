#!/usr/bin/env python3
# sethdg.py CODE HEADING NAME ...: give stands that fix ops added (row.py, arc.py) a fixed heading, and drop the
# set/del ops later tools made on them (nosein.mjs can aim a stand beside a jet-bridge stub along the pier, and
# fixover.mjs then deletes it). Run fixover.mjs again afterwards. A name no added stand has is looked up in the
# raw layout (shots/CODE-raw.json, from raw.sh) and that mapped stand gets a set op with the heading.
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import serve
code, hdg, names = sys.argv[1].upper(), int(sys.argv[2]), set(sys.argv[3:])
fixes = serve.read_fixes()
ops = fixes[code]
keep, n = [], 0
for o in ops:
    if o['kind'] == 'stand' and o['op'] in ('set', 'del') and str((o.get('from') or o['geom'])[3]) in names:
        continue
    if o['kind'] == 'stand' and o['op'] == 'add' and str(o['geom'][3]) in names:
        o['geom'][2] = hdg; n += 1
    keep.append(o)
found = {str(o['geom'][3]) for o in keep if o['kind'] == 'stand' and o['op'] == 'add'}
rawf = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots', code + '-raw.json')
for s in (json.load(open(rawf)).get('stands') or []) if os.path.exists(rawf) else []:
    if str(s[3]) in names and str(s[3]) not in found:
        g = list(s); g[2] = hdg
        keep.append({'op': 'set', 'kind': 'stand', 'from': s, 'geom': g}); n += 1
fixes[code] = keep
serve.write_fixes(fixes)
print(code, n, 'stands set to', hdg)
