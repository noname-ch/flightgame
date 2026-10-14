# Airport checking tools (for agents)

How a Claude session goes through the airport checklist (F8, `js/airportcheck.js`): it looks at each airport
in the game next to the satellite picture, fixes what is wrong with fix ops (the same ones the airport editor
F3 writes into `js/data/fixes.js`), tidies it with the editor's own functions, and marks it blue.

## Setup

    tools/agent/start.sh            # game on :8848 and headless Chrome on :9447 (GAME_PORT, CDP_PORT, CHROME)

Screenshots and logs go to `tools/agent/shots/` (not committed).

## Per airport

1. `node tools/checks.mjs next 2`: the next airports to do.
2. `node tools/agent/shoot.mjs CODE CODE` writes `shots/CODE-game.png` (game over satellite), `-sat.png`
   (satellite only), `-apron.png` / `-apronsat.png` (close-up of the stands) and `CODE.json` (runways, stands,
   the view of each shot). `RELOAD=1` reloads the page first (needed after changing `js/data/fixes.js`).
   `--at lat,lon,zoom` takes `-detail.png` / `-detailsat.png` there instead.
   The map goes no closer than zoom 17; `python3 tools/agent/crop.py CODE VIEW x1 y1 x2 y2 [SCALE]` cuts a box out
   of a shot and its satellite twin, scaled up side by side with a grid in the shot's pixels (`shots/CODE-crop.png`).
   The map draws a layout only when the airport's reference point lies within about one screen of the view, so a
   zoom 17 `--at` shot far (2 km+) from it shows the satellite alone: use zoom 16 there.
   Stands added with fix ops show (and nosein.mjs sees them) only after a `RELOAD=1` shoot.
3. Compare the game and the satellite shots. Usual faults: grass mapped as apron, taxiway or stands; terminal,
   hangar and car park mixed up; runway ends off; jet bridges at small airports that have none; too few stands;
   concrete with stands on it not mapped as apron.
4. Fix it:
   - `tools/agent/raw.sh CODE apron` lists the layout's elements (as read, before the fixes) with their pixel
     positions in a shot, and writes them to `shots/CODE-raw.json`.
   - `python3 tools/agent/px.py CODE apron x y ...` turns pixels of a shot into lat/lon (`--ll lat lon` the other way).
   - `python3 tools/agent/fixop.py CODE '<op json>' ...` adds fix ops (see the top of `js/fixes.js`), e.g.
     `{"op":"del","kind":"apron","geom":<ring from CODE-raw.json>}`, `{"op":"set","kind":"bridges","geom":false}`,
     `{"op":"set","kind":"runway","from":[...],"geom":[...]}`, `{"op":"add","kind":"stand","geom":[lat,lon,hdg,"name",1,45]}`.
   - `python3 tools/agent/row.py CODE VIEW x1 y1 x2 y2 SPACING_M PREFIX [START]` adds stands evenly along a line
     between two pixels of a shot (like the editor's "Stand row"): put the line ~12 m off a pier face, where the
     noses stop. Then run nosein.mjs to aim them.
   - `python3 tools/agent/hull.py CODE i j ...` replaces raw aprons i, j, ... (numbers from raw.sh) by one solid
     apron over them (their convex hull): for aprons mapped as jagged pieces cut round every gate.
   - `python3 tools/agent/ring.py CODE VIEW KIND x y x y ... [--arc cx cy r a0 a1 n] [--set FROMJSON]` adds a ring
     (apron, terminal...) drawn in a shot's pixels, or replaces the ring FROMJSON with it.
   - `python3 tools/agent/delbox.py CODE VIEW x1 y1 x2 y2` deletes every stand in a pixel box of a shot;
     `delstand.py CODE NAME...` deletes stands by name (needs `raw.sh` first for both).
   - `python3 tools/agent/sethdg.py CODE HEADING NAME...` gives added stands a fixed heading and drops later ops on
     them: where nosein.mjs aims a stand beside a jet-bridge stub along the pier instead of at it.
   - `python3 tools/agent/faces.py CODE TERMINAL PREFIX [--sp 42] [--off 14] [--min 40] [--box VIEW x1 y1 x2 y2]`
     puts stands along every straight face (MIN m+) of raw terminal ring TERMINAL, OFF m out and nose-in: for
     satellites and piers with gates all round (`--box` keeps faces whose middle lies in a pixel box, to leave the
     landside out). RELOAD=1 shoot, then fixover.mjs (twice) clears the corners.
     `--others` leaves out stands inside or next to the other raw terminal rings (terminals cut at map-tile edges);
     `--dry -v` prints the ops, and `python3 tools/agent/plotops.py CODE VIEW FILE` draws such ops over a shot's
     satellite picture (`shots/CODE-plot.png`) to check them before adding. Rings mapped with every jet bridge in
     their outline break into short faces: use row.py there.
   - `python3 tools/agent/rename.py CODE OLD=NEW ...` renames added stands with prefix OLD to NEW1, NEW2, ... (for
     prefixes that turned out wrong or clash).
   - `python3 tools/agent/arc.py CODE VIEW cx cy r a0 a1 n PREFIX` puts n stands round a circle (round satellites).
   - `python3 tools/agent/rekind.py CODE hangar terminal i j ...` turns raw rings into another kind (e.g. a
     passenger terminal mapped as hangars). `row.py ... PREFIX START HEADING` gives a row a fixed heading.
   - `python3 tools/agent/draw.py CODE VIEW aprons,terminals,...` draws the raw elements with their numbers over a
     shot's satellite picture (`shots/CODE-draw.png`, after raw.sh), to see which number is which ring.
   - `node tools/agent/pin.mjs CODE`: the game uses only 2×GATE_COUNT of the mapped stands (plus every stand a fix
     added or moved). Where the mapped stands are already right, this pins all within 70 m of a terminal (a `set`
     op that keeps them as they are), so the game uses them all. Reload, then run fixover.mjs.
   - `sethdg.py` also takes names of mapped stands (from raw.sh): they get a `set` op with the heading.
   - `node tools/agent/nosein.mjs CODE` turns every stand within 70 m of a terminal nose-in to its nearest face
     (mapped stands often have odd headings, which shows as lead-in lines fanning out at angles).
5. Tidy: `node tools/agent/tidy.mjs CODE` straightens wobbly taxiways (ends kept, so junctions stay joined),
   makes one clean ~90° bend a "90° turn", one bend of another angle (exits, angled links) a Curve-tool curve
   with the radius that follows it best, and squares aprons and buildings, each only when that moves things
   a few metres (`--dry` only counts).
   tidy.js makes no turn or curve where a taxiway has a point on a runway or a leg along one. Still LOOK at every
   curve it made: a curve must never lie on a runway or turn a taxiway that runs along the runway.
   `python3 tools/agent/curves.py CODE game --from N` draws the taxiway ops with 3+ points from op N on (the ones
   tidy just added) over the satellite shot with their numbers; `node tools/agent/onrw.mjs CODE` lists the airport's taxiway ops with points on a runway (after a shoot; `--near M` within M m of one, `--from N`);
   `python3 tools/agent/curvelist.py CODE N [M]` lists tidy's curves from op N on with their length and distance to a
   runway, marking those within M m (default 250) "near" (likely on a parallel taxiway or an exit: look, or undo them);
   `python3 tools/agent/uncurve.py CODE i j ...` straightens ops i, j (`--del` removes them: the original lines
   come back).
6. Stands in each other's way: `node tools/agent/fixover.mjs CODE` deletes stands closer than 24 m, with crossing
   lead-in lines, or standing in another's lead-in. Deleting one can bring in another (the game uses at most
   2×GATE_COUNT), so check again.
7. `RELOAD=1 node tools/agent/shoot.mjs CODE` again and look. `node tools/agent/ev.mjs "FG.fixes.missed('CODE')"`
   must be `[]` (every op found its element). When the map data has moved since an op was made,
   `python3 tools/agent/missed.py CODE` (after `raw.sh`) shows the nearest element for each missed op, and
   `--fix [M]` points ops whose element is now 6-M m off (default 20) at it again. Ops whose element is gone
   (far off) do nothing (a del) or add their shape anyway (a set): look, then remove or redo them.
8. `node tools/checks.mjs mark CODE --note "what was checked and fixed"` (blue). Never mark green: only a person approves.
9. After every 2 airports: `tools/agent/push.sh "Airport check: AAA (...), BBB (...)"` bumps `?v=`, commits
   `js/data/fixes.js`, `checks.js` and `layouts/`, rebases on origin/main and pushes.

`ev.mjs "<js>"` runs any expression in the game page; `shotnow.mjs out.png` screenshots it as it is;
`clearcache.mjs` clears the browser cache and reloads.
