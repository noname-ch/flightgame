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
- Windows: `js/windows.js` (`FG.win.movable(el, handleSelector, key)` for a panel, `FG.win.open(key, opts)` for a
  new window); positions are kept in localStorage `flightgame.win.<key>`. `js/planewin.js` is the plane window
  (`FG.planeWin.open(id)`, from `ui.js selectPlane`) and the timetable window (planner's `editorHtml()`; clicks go
  to `FG.planner.action/change/input` as in the sidebar). Its camera is `FG.view3d.chase(container, id)` in
  view3d.js: a second small MapLibre map with its own plane layer (`chaseLayer`, models posed by `placeModel`).
- Plane stats (as OpenTTD's vehicle details): game.js keeps each plane's records in `p.stats` through `record(p, add, t)`
  (totals, `year`/`last`, 12 `weeks`, the 8 `recent` flights; `stats.profit` stays the sum of flight results).
  `G.planeStats(p)` is what the stats window shows (`FG.planeWin.openStats(id)` in planewin.js, drawn with
  `FG.ui.chart`). Anything new that earns or costs money for one plane should go through `record` too.
- `js/devtools.js` (F2) only uses public `G` methods (addPlane, crash, incident, infraOf,
  finishProjects, eventContext, refreshMarket). Keep those working.
- Leaflet is in the repo (`js/vendor/leaflet`, 1.9.4), not loaded from unpkg: when that CDN was slow or down the game
  hung on the loading screen for good. Only the optional 3D view and fonts come from CDNs. The inline script after
  `#loading` in index.html shows a Reload message when a game file fails or the screen is up for 30 s.
- Use `G.home()` and `G.bankruptcyLimit()`, not `C.startAirport` or `C.bankruptcyLimit`.
- For anything animated, use `FG.ui.time` (exact fractional game time), not `G.state.time`.
- The game ticks come from a worker's timer (ui.js `startTicks`), so the game runs on in a background tab.
  While `document.hidden`, `loop()` only advances the game: nothing is drawn and newspapers wait.
- 3D layers: over terrain, MapLibre paints each run of flat layers (fill, line, raster, hillshade, background) into a
  2048 px texture per terrain tile. `transformStyle` puts every flat layer first, so there is one run: a flat layer
  after a label, extrusion, circle or the planes costs another 22 MB per tile (six runs reached 2.6 GB low over the
  ground and iPhones reloaded the page; the smoke test checks the order). On touch devices `phoneDrapes` makes the
  textures 1024 px.
- Weather (looks only, flights never wait for it): game.js `weatherAt(lat, lon, t, lite)` (noise drifting east by
  `G.WX_DRIFT`, storm events with `weather: 'storm'` or a "Storm …" label), `G.windAt(lat, lon, t, altFt)`,
  `G.airportWeather(code)`. `G.flightState` returns `crab` (heading = track + crab: ui.js planePosition and view3d
  `attitude` add it), `windFrom`, `windKt`, `gusty`. js/weather.js draws it: `FG.weather.puffs(box, t, max)`, the 2D
  canvas (an `L.Renderer` in the 'clouds' pane, the "Clouds and weather" overlay = `FG.weather.enabled()`), the
  `#wx-fx` CSS overlay and chip; view3d.js draws the same puffs as one `THREE.Points` in planeLayer
  (`cloudPoints`/`updateClouds`) and greys the sky (`skyOf` through `daylight3d`, map.setSky, no layers). Developer tools → Wind
  places winds by hand: `state.winds` via `G.placeWind/setWind/removeWind/clearWinds`; `placedWind(lat, lon)` blends
  them into weatherAt, windAt and `surfaceFrom` (what pickRunway uses); `G.windRev` keys the route-line tracks.
- Time and the sun (game.js): the game clock (`G.state.time`) is the time at the home base. Every airport has its own
  local time from `js/data/timezones.js` (built by `tools/build_timezones.py` from GeoNames: UTC offsets in winter
  and summer and the days the clocks change; airports missing there take their nearest neighbour's): `G.utcOffset(code,
  t)`, `G.utcOf(t)`, `G.localTime(code, t)`, `G.fmtLocal`, `G.fmtZone`. `G.sunPoint(t)`, `G.sunAt(lat, lon, t, sp)`
  (elevation, azimuth), `G.daylight(lat, lon, t, sp)` (1 day … 0 night), `G.sunTimes(code, t)`. Timetables and
  `C.curfew` still run on home-base time. js/daynight.js (`FG.daynight`) draws the night on the 2D map (pane 'night',
  under the game's layers; the "Day and night" overlay, `FG.daynight.enabled()` also switches the 3D night).
  view3d.js `daylight3d(map, layer, lat, lon, t, now, weather)` lights the planes from the sun every frame and, on a
  change, sets the sky (`skyOf(w, sun)`), `fg-night` (a dark flat layer over the ground), `fg-runway-lights` /
  `fg-taxi-lights`, `terminalColors(night)` and every other extrusion's colour, and `map.setLight`. Aircraft lights
  are `navLights(type, model)` (points read off the model, `navSpotsOf`), switched by phase in `setNavLights`.
- Sound (js/sound.js, `FG.sound`, off until turned on; prefs in localStorage `flightgame.sound`): Web Audio voices
  made up as they play, plus `RECORDINGS` in `sounds/` (loops from ElevenLabs Sound Effects, 16 kHz mono WAV: an MP3's
  lead-in silence would stutter in a loop). The jets' rumble, roar and screech come from `BANKS` (several takes each,
  loaded when a voice first wants one: `takeBuf`; `takeOf(pr, M, bank)` is the mixer's pick, parts `PICKS`
  bassSound/roarSound/screechSound, or 'auto' by the type's name hash, old jets from the `for: 'old'` screeches; a
  new pick rebuilds the voices playing, `remix`/`again`; a screech take's `hz` is its pitch). The screech plays through
  the grain player `js/grains.js` (AudioWorklet 'fg-grains', loaded in `build` from `GRAINS_URL`; `screechPlayer`/
  `screechRate`, params pitch and speed, `GRAIN` options; `FG.sound.grains` says it loaded), so the mixer's
  screechPitch and screechSpeed act apart and at once; without a worklet the take loops at one rate (both together).
  Don't stretch takes by WSOLA again: slowed down it locked onto the steadiest tone and droned. Keep screech takes
  broadband (spectral flatness well above a steady tone's 0.03): the user hears tonal takes as drones. `far` (a distant
  airliner's wash) takes over from the made-up voice between `FAR` metres (`FAR_LEVEL`), `start` (not a loop) plays
  once over a jet's made-up start (`oneShot`, `START_LEVEL` × the style's whine). `load` brings each in after the
  first click and rebuilds the voices; made up until then or if it fails (`FG.sound.recorded` lists what loaded).
  ▶ Preview has a 'far' part (heard from 6 km, made louder); `preview({ d })` hears it all from d metres. `engines(p, t)` says
  what a plane's engines do from its `G.flightState` phase and the game clock (start over `START` game minutes from the pushback, the levers by phase, run-down after `land`
  from `p.readyAt - G.turnaroundMin`), smoothed in game time (`SPOOL`). `listener()` is where it is heard from: the
  3D camera (`cameraAt`: back from the centre by the tilt, up from `map.getCenterElevation()`; MapLibre 6 has no
  getFreeCameraOptions), the fly-by spot, or above the 2D map's centre (`mpp * 60`); the followed plane
  (`v3.follow`, `FG.ui.following`, `FG.planeWin.id`) is heard as from close by. `pick` gives the `VOICES` loudest
  planes a voice (4×/s), `play` sets them (20×/s). Roar and air are pink noise, rumble the recording (white noise filtered
  sounded like static to the user); whines stay within about an octave (high pitches while throttling bothered
  them); a low shelf adds bass. `FG.sound.spectrum()` measures centroid, flatness, hiss (hf) and bass (one reading of
  noise jumps about: compare `await FG.sound.spectrumOver(n)`, the median of n). The smoke test runs Chrome with
  `--autoplay-policy=no-user-gesture-required` and `--mute-audio` (measured, never heard on the speakers: test
  silently), reads `FG.sound.meter()` and fails on hiss.
  Styles (`STYLES`: standard, deep, open, soft; `FG.sound.set({ style })`) are the same voices with other numbers,
  read when a voice is made (`v.S`; a new style rebuilds the playing voices, `restyle`). ▶ Preview (`FG.sound.preview()`,
  `DEMO` segments, `demoTick`) plays a made-up flight on its own voice through the same `sound()` as the game's planes,
  paused or not; `FG.sound.preview({ kind, from, hold })` holds a segment to measure it (the smoke test does).
- 3D cameras (view3d.js): following, `v.cam` is 'chase' (`chaseTick`; a drag turns it round the plane through
  `v.orbit`, MapLibre's own dragging is off while following), 'flyby' (`flybyTick`, spot in `v.flyby`) or 'wing'
  (`wingTick`, spot in `WING_CAM`). Keys V/B/N and `camera(mode)`. Fly-by and wing place the camera with
  `map.calculateCameraOptionsFromTo` (pitch up to 175, roll), and draw the followed plane at real size, always posed.
- 3D ground: `setSatellite(on)` in view3d.js (🛰 button, and ui.js `setBasemap` through `FG.view3d.setSatellite`:
  Settings → Map style sets 2D and 3D) switches the satellite layer, the map layers under it (`v.underSatellite`) and
  the background (`LOADING_GROUND`, dark, where pictures are still loading) on the 3D map and the plane windows'
  cameras. The 3D buttons sit at the bottom centre: top left, the plane window covered them.
- 3D terrain at airports: js/flatground.js (`FG.flat`) levels it. view3d.js `demSource` points the terrain and
  hillshade sources at `fgdem://` (`FG.flat.protocol`): tiles from zoom 11 on with an airport in them come back with
  its area (runways + strips, taxiways, aprons, buildings, closed over 400 m gaps) set to a robust plane through the
  ground there, tilt capped (`MAX_TILT`), feathered back over 300 m. Mapterhorn's heights are partly older than the
  airports (Istanbul: open-pit mines, 120 m up and down under the runways) and partly surface models (buildings,
  trees). `REAL` lists the airports whose runway really slopes (only smoothed). Planes' heights in the air come from
  `FG.flat.heightsAt` (view3d `groundOf`), so they match the drawn ground. When an airport's runways/layout change,
  `relevel()` (from refreshGates) rebuilds it and reloads the terrain tiles (`setTiles` with a new `?r=`).
- Moving parts (looks only), in the livery's vertex shader (js/livery.js `VERT_BODY`): the wings bend by `livFlex` (tip
  rise in half spans); vertices with the attribute `livHub` (x, z of a hub, 1; `markEngines`: propellers are thin pieces
  in front of the engines, grouped, turning round the middle of their vertices; a jet's fan is `spinFans`: the widest
  round ring of flat parts inside each engine's cowlings) turn by `livSpin`; `livSurf` (kind 1 aileron, 2 flap, 3 elevator,
  4 rudder, hinge y, z; `markSurfaces`: wing and tailplane read in strips across the span from flat faces, split at the
  empty gap between them, hinge lines interpolated over strips without vertices; the tailplane (at the height of most
  flat area behind the gap) and the fin again as straight edges from their faces, `edgeLines`, and their faces cut
  along the hinge, `cutAlong`, since coarse models have no vertex there) turns by
  `livAil`/`livFlap`/`livElev`/`livRud`. Flaps are cut out of the wing's geometry (`cutFlaps`: two straight parts
  fitted to the strips, none behind nacelles that reach past the trailing edge, none on a delta; their vertices are
  their own, `livSurf.w` = flap chord, 0 for the old uncut kind) and slide back and down as they turn; FRAG_BODY
  paints them in the wing's livery with darker seams (`vLivFlap`, `livFlapSpan`). These `OWN_UNIFORMS` are per material: each drawn aircraft gets its own copies
  (view3d.js `ownMaterials`), set in `placeModel` from `wingFlex`, `propRate` and `surfaceAngles` (the elevators are
  pulled for the rotation, the climb-out, the flare and the nose wheel coming down, besides following the pitch rate). The fuselage width
  (`measure`) falls back to `FG.data.modelSize` where nacelles reach forward (DC-3, Ju 52, Twin Otter).
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
  `ed.player` set. It has no popups: `showPopup` and `banner` draw the panel instead (`playerPanel`, tools in
  `TOOLS`/`BUILD`, map clicks in `buildClick`, what is selected or going on in `buildContext`); building never
  calls the map-data lookup (`auto`), so it can't replace anything. Runways and terminals are placed whole
  (`ed.place`, `placeAt`/`placeHtml`/`terminalPlan`) and ordered as construction: `G.orderRunway(code, r)` (project
  kind 'runway' with `geo.runway`) and `G.orderBuild(code, ops, info)` (kind 'build': its ops join
  `FG.fixes.player` when done). New airports are sites (`a.site`): `layApron` gives them only what the player built
  (`emptyApron` before that, nothing made up), `G.siteChecklist(code)` and `G.openAirport(code)`. Its ops go to `FG.fixes.player` (kept in `G.state.airportOps`, handed over by
  `G.registerBuilt` on every new or loaded game), never to `js/data/fixes.js`. `FG.fixes.ops(code)` is still
  the developer fixes only; `FG.fixes.all(code)` is both, and that is what the layouts get. No runway ops in
  build mode: runways are construction placed by the player (`connectRunway` adds their taxiways as player ops
  where the airport has a layout of its own; `placeRunway` only serves old games' runway projects). Prices: `C.airports.build`,
  charged in `commit` through `G.payForBuilding`. The first change at a made-up airport adopts the whole
  made-up layout (else the airport would be left with only the new piece).
- 3D building looks: `js/facades.js` (`FG.facades.parts(b, roof, toward)`) splits each terminal, hangar, car park
  and other building into extruded parts in metres (walls, parapet, roof slab, window bands, mullions, glass
  fronts, landside doors, hangar doors facing the apron); view3d.js draws them in the `fg-terminals` layer with
  `col`. Roof colours are read off the Esri photo per airport (`roofsOf`, through `FG.taxiFit.photo(pts, pad, z)`
  at z17-15) and kept in IndexedDB (`flightgame.roofs2.<CODE>`). MapLibre extrusion patterns change size with the
  zoom, so they aren't used.
- Runway choice: `pickRunway(code, day, need, pick)` in game.js (auto: the shortest that fits within 45° of the
  wind). A plane's choices are `p.runways[code]` (a `runwayKey`, `G.setRunway`, `G.runwayChoices`); a flight copies
  them into `f.rw` when it starts (`G.legRunways(p, from, to)`), so changing them never moves a flight already under
  way; only one still boarding at the gate takes them at once (`G.runwayTakes(p, code)` says which). The flight track
  cache key includes `f.rw`. Route lines pass the choices to `G.legTrack(type, from, to, rw)` (rw optional).
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
- Parking: a stand's point is where the middle of the plane parks. `gateOf(code, planeId, type)` moves the plane back
  along the stand line (`parkBack`, kept per apron and type) until its nose is `NOSE_GAP` (4 m) short of the nearest
  wall ahead (terminal, hangar, other buildings on the ground; not jet bridges, roads, roofs), and shortens its
  pushback by as much (never under 15 m), so flights still start and end there. The smoke test checks Zurich.
- Planning uses timetables only (`p.schedule.legs`). Slots are shared, and one slot equals one stand.
- Ultra long-haul timetables: `p.schedule.days` > 1 (missing = 1, a daily one). Then `leg.dep` counts minutes from the
  start of a round (0 … days × 1440, rising leg by leg; a daily one keeps the time of day) and `schedule.offset` says
  where the plane's rounds start (`G.anchorRound`, on saving and starting). Every timetable call takes `days`
  (`checkTimetable`, `setTimetable`, `groundTimes`, `slotFit`, `timetableSlots`, `crewsFor`; slotUsage's `draft.days`);
  departures come from `legDue` (game.js), never from `nextAt(dep)` alone. Built by `G.buildLongTimetable`, round length
  `G.cycleDays(type, legs)`, offered only where `G.ultraCapable(type)` (the planner's 🌏 checkbox, `draft.ultra`).
  Show departures with `G.fmtLegDep(dep, days)` ("day 2 06:00") or `G.fmtDue(schedule.due)`.
- The home base parks your planes off the stands: `G.parksAtBase(q, code)` (at `G.home()`, no running timetable) keeps
  them out of `staysUntil`, `slotFreeAt`, `slotOccupants` and `slotUsage`, so a plane can always be sent home and a
  parked one never blocks the slot (a friend's 787 got stuck in Las Vegas when Zurich's one small slot was taken).
  Elsewhere a plane needs room: `G.roomReason(type, code, planeId)` (a slot of its class not filled by parked planes),
  used by sendPlane and the market's deliveries.
- Crews: a timetable with more than `C.crewMaxDutyMin` block time a day gets `C.crewsMax` crews (`crew.sets`,
  `G.crewsFor(type, legs)`, set in setTimetable/clearTimetable, paid through `G.crewWeekly`); a rested crew always
  flies one leg however long. One round of a timetable, turnarounds included, still has to fit into a day.
- Stand classes (game.js): `typeClass(type)` from `FG.data.looks[type].span`; `classifyStands` sets `st.cls`/`st.room`
  on every apron once (apronOf wraps layApron). Slots by class: `G.mySlotClasses(code)` (`state.slots[code].byClass`,
  guessed for old saves), `G.slotTable(code)` { cap, mine, held, free }, `G.leaseSlot(code, cls)`, `G.dropSlot(code, cls)`;
  checks go through `slotsFit(have, needs)`. `airportSize` is the derived size (demand, fees, map);
  `baseSize` is the data's (+ old terminal levels) and is what layouts are generated from: use it in apronOf and
  anything apronOf calls, or the size and the layout call each other.

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
