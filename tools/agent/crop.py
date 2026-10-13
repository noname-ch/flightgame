#!/usr/bin/env python3
# crop.py CODE VIEW x1 y1 x2 y2 [SCALE]: cuts the box out of a shot and its satellite twin (apron + apronsat,
# detail + detailsat, game + sat), scales it up (default 2x, at most 1600 px wide) and puts the two side by side
# (or one above the other when the box is wide) with a pixel grid every 50 px of the shot: shots/CODE-crop.png.
import os, sys
from PIL import Image, ImageDraw
code, view = sys.argv[1].upper(), sys.argv[2]
x1, y1, x2, y2 = map(int, sys.argv[3:7])
sc = float(sys.argv[7]) if len(sys.argv) > 7 else 2
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
twin = {'game': 'sat', 'apron': 'apronsat', 'detail': 'detailsat'}[view]
w, h = x2 - x1, y2 - y1
side = w <= h * 1.3
sc = min(sc, (800 if side else 1600) / w)
W, H = int(w * sc), int(h * sc)
out = Image.new('RGB', (W * 2 + 8, H) if side else (W, H * 2 + 8), 'white')
for k, name in enumerate((view, twin)):
    im = Image.open(f'{D}/{code}-{name}.png').convert('RGB').crop((x1, y1, x2, y2)).resize((W, H), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    for gx in range((x1 // 50 + 1) * 50, x2, 50):
        X = (gx - x1) * sc
        d.line([(X, 0), (X, H)], fill=(255, 255, 0) if gx % 100 == 0 else (120, 120, 0), width=1)
        d.text((X + 2, 2), str(gx), fill=(255, 255, 0))
    for gy in range((y1 // 50 + 1) * 50, y2, 50):
        Y = (gy - y1) * sc
        d.line([(0, Y), (W, Y)], fill=(255, 255, 0) if gy % 100 == 0 else (120, 120, 0), width=1)
        d.text((2, Y + 2), str(gy), fill=(255, 255, 0))
    out.paste(im, (k * (W + 8), 0) if side else (0, k * (H + 8)))
out.save(f'{D}/{code}-crop.png')
print(f'{D}/{code}-crop.png')
