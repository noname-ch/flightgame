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

- Run the smoke test first: `node tools/smoke.mjs`. Push only when it ends with `✓ smoke test passed`.
  See "The smoke test" below.
- `index.html` loads every CSS/JS file with `?v=<timestamp>`. Bump all of them (sed the `?v=`) on
  every push, or browsers mix the new page with old cached files.
- When a ROADMAP.md item gets built, tick it and move it to the `## Done` section.
- Keep README.md current when gameplay or controls change.

## The smoke test

`node tools/smoke.mjs` (from the repo root) plays the game in headless Chrome for about 2 minutes:
- **Setup:** it serves the repo on a free port, starts a new airline and flies two planes on a timetable.
- **Sections and time:** it runs at full speed while opening every section, then plays 30 more game days.
- **Airport editor:** it adds a stand, then deletes part of a made-up layout and undoes it.
- **3D and saving:** it opens the 3D view and follows a plane, then saves and reloads.
- **What fails it:** any script error, `console.error` or missing game file. Map tiles or CDNs that are
  slow or down only print `⚠` warnings.

- Needs Node 22+ and Chrome or Chromium (`CHROME=/path/to/chrome` if it isn't found). Its ports are
  random and its Chrome is its own, so it never touches another session's server or browser.
- `✗ smoke test failed` lists each error with file and line. Fix them before you push. If the error
  comes from someone else's code, tell them (SendMessage, or the user) instead of pushing around it.
- A step that fails as `test stopped: …` is usually a test step that no longer fits the game (for
  example, a renamed button). Update `tools/smoke.mjs` in the same commit as the change that caused it.
- Adding a feature? Add a step for it in `tools/smoke.mjs`. Page code runs through `evaluate(fn, ...args)`,
  where `G` is `FG.game`. Use `waitFor(fn, ms, 'what')` to wait, `errors.push(...)` to fail and
  `step(...)` to log. Keep a run under the 6-minute limit.
- To test a change by hand, copy the script's server and CDP part to your scratchpad. Don't edit the
  shared test for one-off experiments.

## Code map and contracts

- `js/game.js` is the simulation and has no DOM. Its public object is `G`.
- `js/ui.js` holds the 2D map, sidebar, start screen and `FG.ui` hook. `js/planner.js` renders the
  Schedule, Slots and Airports sections.
- `js/view3d.js` is the 3D view (ES module, loaded `async`). It depends on
  `G.flightState(p, t)`, `G.flightTrack(p)`, `G.legTrack(type, from, to)`, `G.gateOf(code, planeId)` and
  `G.apronOf(code)`, so keep those signatures.
- Flight heights: `G.flightState` returns `altFt` above sea level, `fieldFt` (the runways' height there; the 3D
  view draws `altFt - fieldFt` above them) and `ground`. Tracks follow the ground from `js/ground.js`
  (`FG.ground`; `FG.terrain` is the 3D view's airport-site check) and the type's `G.perf(type)`; a flight takes
  as long as it really takes and waits at the gate (phase `boarding`) for the rest of its block time.
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
  (`js/data/fixes.js`). Saving goes through `tools/serve.py`, which `./play.sh` starts. Where too little is
  mapped, game.js `apronOf` makes a layout up. The editor lists those parts too (`madeUp(code)`): the first
  change turns them all into fix ops, so a made-up apron can be deleted. Never let an airport lose its last
  stand: the game would make it up again.
- Build mode (the player's airport building): `FG.airportEdit.build(code)` opens the same editor with
  `ed.player` set. Its ops go to `FG.fixes.player` (kept in `G.state.airportOps`, handed over by
  `G.registerBuilt` on every new or loaded game), never to `js/data/fixes.js`. `FG.fixes.ops(code)` is still
  the developer fixes only; `FG.fixes.all(code)` is both, and that is what the layouts get. No runway ops in
  build mode: runways come from construction (`placeRunway` in game.js picks the spot, `connectRunway` adds
  their taxiways as player ops where the airport has a layout of its own). Prices: `C.airports.build`,
  charged in `commit` through `G.payForBuilding`. The first change at a made-up airport adopts the whole
  made-up layout (else the airport would be left with only the new piece).
- Crossing runways: `G.runwayCover(r, others)` says where other runways lie on a runway; ui.js `drawRunway` and
  view3d.js `runwayPaint` leave their lines and paint out there.
- Taxiway widths: a taxiway fix op may carry `w` (metres). fixes.js puts it on the line (`line.w`), and
  `G.taxiwaysOf` / `G.drawnTaxiways` pass it on, so 2D and 3D draw that width (default 23 m at size ≥3, else
  15 m). `js/taxifit.js` (`FG.taxiFit.fit(line, { keep })`) reads the Esri satellite picture across the line,
  recentres it and measures the paved width. The editor runs it on every taxiway drawn there and with "Fit to
  satellite"; there is also a width field.
- Airport checklist (F8): `js/airportcheck.js`, marks in `js/data/checks.js`. When you check airports, take
  them from `node tools/checks.mjs next` and mark each with `node tools/checks.mjs mark CODE --note "what you
  checked or fixed"` (blue). Never mark an airport good (green): only a person approves.
  The tools for looking, fixing, tidying and pushing are in `tools/agent/` (see its README.md). Push after every
  2 airports (the user asked for that).
- Bug reports (F5): `js/bugreport.js` (loaded right after config.js, so it catches script errors from the start;
  `FG.bugs.details()` is the report's details block). Reports go to GitHub issues (`FG.fixes.github.createIssue`),
  to `BUGS.md` via `tools/serve.py` POST /__bugs, or to GitHub's new-issue page. Look in `BUGS.md` and the repo's
  issues for open bugs, and delete a `BUGS.md` entry once it is fixed.
- Planning uses timetables only (`p.schedule.legs`). Slots are shared, and one slot equals one stand.

## What the user wants

- Airports should look just as they do in real life, not the same everywhere.
- The exact-dimension 2D hangar drawings were stopped on purpose. Don't resume them unprompted. Real
  3D aircraft models will come later and will replace `planeModel()` in view3d.js. Unfinished work
  is kept in `~/dev/Flightgame-hangar-wip`.

## Testing

- The smoke test (above) is the minimum before every push.
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
