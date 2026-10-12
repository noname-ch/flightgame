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
   - `node tools/agent/nosein.mjs CODE` turns every stand within 70 m of a terminal nose-in to its nearest face
     (mapped stands often have odd headings, which shows as lead-in lines fanning out at angles).
5. Tidy: `node tools/agent/tidy.mjs CODE` straightens wobbly taxiways (ends kept, so junctions stay joined),
   makes one clean ~90° bend a "90° turn", one bend of another angle (exits, angled links) a Curve-tool curve
   with the radius that follows it best, and squares aprons and buildings, each only when that moves things
   a few metres (`--dry` only counts).
6. Stands in each other's way: `node tools/agent/fixover.mjs CODE` deletes stands closer than 24 m, with crossing
   lead-in lines, or standing in another's lead-in. Deleting one can bring in another (the game uses at most
   2×GATE_COUNT), so check again.
7. `RELOAD=1 node tools/agent/shoot.mjs CODE` again and look. `node tools/agent/ev.mjs "FG.fixes.missed('CODE')"`
   must be `[]` (every op found its element).
8. `node tools/checks.mjs mark CODE --note "what was checked and fixed"` (blue). Never mark green: only a person approves.
9. After every 2 airports: `tools/agent/push.sh "Airport check: AAA (...), BBB (...)"` bumps `?v=`, commits
   `js/data/fixes.js`, `checks.js` and `layouts/`, rebases on origin/main and pushes.

`ev.mjs "<js>"` runs any expression in the game page; `shotnow.mjs out.png` screenshots it as it is;
`clearcache.mjs` clears the browser cache and reloads.
