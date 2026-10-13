#!/usr/bin/env python3
# rekind.py CODE FROMKIND TOKIND i j ...: turn raw rings i, j, ... (numbers as raw.sh lists them, from
# shots/CODE-raw.json) from one kind into another, e.g. hangars mapped where the passenger terminal stands:
# a del of the old kind and an add of the same ring as the new kind. Kinds: terminal, hangar, building, apron, pad.
import json, os, subprocess, sys
D = os.path.dirname(os.path.abspath(__file__))
LIST = {'terminal': 'terminals', 'hangar': 'hangars', 'building': 'others', 'apron': 'aprons', 'pad': 'pads'}
code, a, b = sys.argv[1].upper(), sys.argv[2], sys.argv[3]
raw = json.load(open(os.path.join(D, 'shots', code + '-raw.json')))
ops = []
for i in sys.argv[4:]:
    g = raw[LIST[a]][int(i)]
    ops += [json.dumps({'op': 'del', 'kind': a, 'geom': g}), json.dumps({'op': 'add', 'kind': b, 'geom': g})]
subprocess.run(['python3', os.path.join(D, 'fixop.py'), code, *ops], check=True)
