# Notes for Claude sessions

Flightgame is a static browser airline game: plain JS, Leaflet for 2D, MapLibre + three.js for 3D,
no build step. Start with README.md (how to play, `## Extending` = where data lives) and ROADMAP.md.
Play online: https://noname-ch.github.io/flightgame/ (GitHub Pages, deployed from `main`).

## Working alongside others

- The repo is github.com/noname-ch/flightgame. Lian also pushes to it: always `git fetch` and rebase
  before pushing.
- Several Claude sessions often work on the game at the same time. Run ListAgents first. If another
  session is active, SendMessage it before you edit shared files and again when you are done.
- If another session has uncommitted changes in `~/dev/Flightgame`, don't work or pull there. Use a
  worktree (`git worktree add -b <topic> ../Flightgame-<topic>`) and push from it.
- Commit and push only when the user asks.

## Every push

- `index.html` loads every CSS/JS file with `?v=<timestamp>`. Bump all of them (sed the `?v=`) on
  every push, or browsers mix the new page with old cached files.
- When a ROADMAP.md item gets built, tick it and move it to the `## Done` section.
- Keep README.md current when gameplay or controls change.

## Code map and contracts

- `js/game.js` is the simulation and has no DOM. Its public object is `G`.
- `js/ui.js` holds the 2D map, sidebar, start screen and `FG.ui` hook. `js/planner.js` renders the
  Schedule, Slots and Airports sections.
- `js/view3d.js` is the 3D view (ES module, loaded `async`). It depends on
  `G.flightState(p, t)`, `G.flightTrack(p)`, `G.legTrack(type, from, to)`, `G.gateOf(code, planeId)` and
  `G.apronOf(code)`, so keep those signatures.
- `js/devtools.js` (F2) only uses public `G` methods (addPlane, crash, incident, infraOf,
  finishProjects, eventContext, refreshMarket). Keep those working.
- Use `G.home()` and `G.bankruptcyLimit()`, not `C.startAirport` or `C.bankruptcyLimit`.
- For anything animated, use `FG.ui.time` (exact fractional game time), not `G.state.time`.
- 3D only repaints while something moves. Anything new that animates in 3D must trigger a repaint
  itself.
- Airport layouts: 116 airports have files in `js/data/layouts`. Every other airport is read from the
  OpenFreeMap vector tiles by `js/osmairports.js` and cached in IndexedDB (`js/idb.js`, loaded once at
  start so `FG.layouts.get` stays synchronous). Bump `FORMAT` in `js/layouts.js` when the reader changes.
  localStorage is for the save game and settings only: don't put big caches there. Don't depend on the Overpass API at runtime, because it
  was unreliable.
- Airport editor (F3): `js/airportedit.js` edits airports and `js/fixes.js` applies the saved fixes
  (`js/data/fixes.js`). Saving goes through `tools/serve.py`, which `./play.sh` starts.
- Airport checklist (F4): `js/airportcheck.js`, marks in `js/data/checks.js`. When you check airports, take
  them from `node tools/checks.mjs next` and mark each with `node tools/checks.mjs mark CODE --note "what you
  checked or fixed"` (blue). Never mark an airport good (green): only a person approves.
- Planning uses timetables only (`p.schedule.legs`). Slots are shared, and one slot equals one stand.

## What the user wants

- Airports should look just as they do in real life, not the same everywhere.
- The exact-dimension 2D hangar drawings were stopped on purpose. Don't resume them unprompted. Real
  3D aircraft models will come later and will replace `planeModel()` in view3d.js. Unfinished work
  is kept in `~/dev/Flightgame-hangar-wip`.

## Testing

- Run `node tools/smoke.mjs` before every push (about 1.5 min, headless Chrome). It plays a month, opens
  every section, the airport editor and 3D, and fails on any script error. GitHub Actions runs it too.
- `node --check` misses runtime errors such as undefined variables after a merge. Load the page.
- Copy the project to your scratchpad and inject a test script. Replace the full `<script src=...>`
  tag, because a loose sed on `t.js` also matches `aircraft.js`. Serve it with `python3 -m http.server`.
- Other sessions use test ports 8790–8793. Pick a free high port (`ss -ltn`) and start the server with
  `run_in_background`, because a server in a subshell dies. Don't `pkill -f "http.server ..."`: it
  matches its own shell.
- Headless 3D with the real GPU (60 fps):
  `chromium --headless=new --enable-gpu --use-angle=gl-egl --ignore-gpu-blocklist`.
  Swiftshader only reaches about 1 fps.
- For timing, drive chromium with `--remote-debugging-port` from a Node script (Node has a built-in
  WebSocket). `--dump-dom` with a virtual-time budget hides CPU cost. Give every headless run a kill
  timer.
- For phone layout tests, use CDP `Emulation.setDeviceMetricsOverride` (mobile) +
  `setTouchEmulationEnabled` + `Input.dispatchTouchEvent`. The phone layout applies at ≤640 px wide.
- The Chrome extension's tab can sit in a hidden window, where rAF and timers pause. Use it to check
  how 3D looks, not for timing.
