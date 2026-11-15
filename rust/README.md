# Flightgame in Rust

A native desktop version of the browser airline game, written in Rust with
[egui](https://github.com/emilk/egui) and the [walkers](https://github.com/podusowski/walkers) map widget.

```
cd rust
cargo run --release
```

The first build takes a few minutes. The game saves to `%APPDATA%\Flightgame\save.json` (Windows) or the system's
data folder elsewhere: every minute, on Menu → Save and when the window closes. Map tiles are cached in the system's
cache folder.

## What it takes over from the browser game

- **The world**: it reads the browser game's own data files from `../js/data` when it is built (airports, towns and
  cities, runways, aircraft types and their wingspans, factories, rival airlines), with a small reader for their
  JavaScript literals (`src/jsdata.rs`). New airports or aircraft added there show up in the next build.
- **The economy** (`src/game.rs`, from `js/game.js`): catchments, demand by distance, fares and price elasticity,
  block times, turnarounds, landing and passenger fees, ageing costs, crews (a second crew past 12 h a day), weekly
  leases, crews and slots, bankruptcy and the difficulties and modes.
- **Local time**: every airport has its time zone (`js/data/timezones.js`, summer time included); the clock at the top
  is the home base's, times written out are local at each airport, and the night curfew (no departures 22:00–06:00)
  is in each airport's local time. The airport window shows the local time, the zone, sunrise and sunset.
- **Slots by stand class** (A–F by wingspan): one slot per stand, as many and of the classes the browser game counts
  (`data/stands.json` for the airports it knows the real layout of, taken from the online game; every other airport
  has the made-up apron of its size). A plane needs a slot of its class or bigger. Leasing and giving back by class,
  holders (rivals and other airlines), offers for someone else's slot by reputation, planes waiting at the gate when
  every slot is taken, the home base where parked planes need none.
- **Timetables**: built round a route like the planner (as many loops as fit into the day), ✨ for the best start
  time, shifted flight by flight, checked (local curfew, range, runway, stand class, turnarounds, crew duty), with a
  forecast and slot warnings; every plane's day as bars.
- **Quick start**: the browser game's ready-made airlines (`js/data/presets.js`).
- **Story mode**: start in 1955 … 2010; each type reaches the market in its real first year of airline service (with
  its newspaper story from `js/data/story.js`), is built until its last year and sold pre-owned for 25 years more;
  rivals fly the aircraft of their time and new airlines replace those that went bust.
- **Airports as investments**: shares (5 % at a time), weekly dividends from the airport's profit (its traffic and
  the fees your airline pays there), its value; from 25 % construction, from 50 % free slots. Projects: extending the
  main runway (as in the browser game), and, since the build mode isn't here, a terminal expansion (one size bigger:
  more passengers and stands) and new runways, with the browser game's prices and building times.
- **Ultra long-haul timetables** (🌏 in the timetable): for planes with the range for flights longer than half a
  day, repeating every few days, each flight after the turnaround, the next morning where it would land in the
  night curfew.
- **Fleet and market**: leasing and buying new aircraft (delivery flights from the factory), pre-owned ones every
  Monday, selling and returning, ferry flights, renaming, each plane's stats with its last 12 weeks, tickets per route
  on its card.
- **Rivals**: the same airlines and rules: routes from their hubs, sized for their target load, weekly growth,
  fare wars and attacks on your routes; their routes and planes on the map, your routes with competition.
- **Events and newspapers**: strikes, storms, volcanic ash, fuel prices, festivals, a rival going bust, incidents,
  in-flight emergencies (1 in 150 flights; 5 % of them end in a crash, the rest land and are grounded) and crashes,
  with their stories.
- **Sections**: Fleet, Airports (by category), Slots (per airport by class, today's plan per slot, arrivals and
  departures), Schedule, Market, Finance (cash with the bankruptcy line, revenue against costs, daily result,
  history), Rivals, Log.
- **Map**: Esri's satellite pictures (as the browser game), or its dark or light grey canvas; airports by size,
  your slots, timetable route lines, your planes, the rivals' routes and planes. Click a plane or an airport for its
  window. Day and night move over the map with the sun, clouds, rain and storms drift east (the browser game's
  weather model, storm events as real storms; the airport window shows the weather there). Zoomed in, airports show
  their runways, and the 118 with a real layout in `js/data/layouts` their aprons, terminals, hangars, taxiways and
  stands.
- **Sound** (🔇 / M, off until turned on; volume in the menu): the browser game's recordings mixed by what the planes
  near the map's centre do (taxiing, take-off, climb, cruise, approach, reverse thrust), the wash of planes a few
  kilometres off, and a jet whistling up when it starts at its gate. Above 300× it fades out, paused it is quiet.
- **Looks as the browser game**: the five styles (Night, Tycoon, Metropolis, Pixel, Departure board; the first start
  asks), each type's picture from `models/hangar` on the plane cards, the start screen and in the marketplace's
  hangar, its top view from `models/icons` on the map, the newspaper on paper with a picture and "Next story".
- **Windows as the browser game**: the Aircraft Marketplace (new and pre-owned, categories, sorting by price, seats,
  range, cost per seat-hour or name, delivery airport, everything about a type, its delivery flight), the plane
  window (what it does, stands, local times, weather, speed, height, the runway it takes at each airport: Auto or
  one you pick), the stats window (this year, last year, all time, weeks, last flights), the timetable editor, the
  airport panel (runways, landing fee, size, slots with the holders' bar, "Send … here", tickets, shares).
- **Flights as the browser game draws them**: pushed back from a real stand (where the layout is known), taxiing to
  the runway the wind gives (the shortest that fits within 45° of it) or the pilot picks, take-off run, climb, cruise
  at the type's height, descent, final, landing, taxi to the stand. 🎥 Follow on the map keeps a plane in the middle.
- **Map**: + − ⌂ (my network), towns and place names, the legend, the scale, the weather chip.
- **Saving and speed**: autosave every 30 s (can be turned off), Save to file / Load from file, speeds up to 36k×,
  ← → change the speed, Esc closes the windows.
- **Developer tools** (F2 or the menu): money, planes, slots, world events, an incident, emergency or crash on the
  selected plane, finishing construction, new market offers, time. Unlike the browser game they have a password:
  the first time you set one, after that they ask for it once per start. Only a SHA-256 hash of it is kept, in
  `settings.json` beside the save (with the style and other settings); remove its `dev_hash` to set a new one.
- **3D view** (V, or 🛩 3D in the plane window): the plane as its 3D model from `models/*.glb` (the browser game's
  files), painted in the livery you pick (🎨: SWISS, Lufthansa, KLM, Delta, Ryanair, Eurowings, easyJet, from
  `js/data/liveries.js`), with your other planes nearby, over Esri's satellite pictures (kept on disk once loaded),
  lit by the game's sun. Cameras as the browser game's keys: V chase (drag to turn round the plane, wheel to come
  closer; V again goes back to the map), B fly-by (a spot beside its path ahead), N on the wing (it banks with the
  plane); ◀ ▶ the next plane. The moving parts work as in the browser game, phase by phase: propellers and fans turn
  (still while the game is paused), flaps come out for take-off and further for landing, ailerons, elevators and
  rudder move as the plane banks, pitches, rotates, flares and steers, the wings droop on the ground and bend up in
  the air, the landing gear (built at real sizes from `FG.data.gear`: nose gear or tail wheel, main legs, bogies)
  folds away after take-off and comes out on the way down. Airports with a layout of their own show their terminals
  (with bands of windows, lit at night), hangars and other buildings. The game's weather is there too: clouds drifting
  with it, greyer with rain, towering in storms, a greyer and darker sky under them, haze that thickens in rain and fog.
- **Build mode** (🏗 Build mode in the airport panel, from 25% of an airport's shares): place aprons, stands (for a
  class A–F: one more slot of that class there), hangars, buildings and taxiways on the map, paid at once (your share,
  at the browser game's prices per m², per metre of taxiway and per stand); runways (both ends, width, paved or grass)
  and terminals are construction, ready after some weeks. Select something you built to pull it down (a tenth of its
  price). What you built is kept in the save and drawn on the map.
- **Airport editor** (F3, behind the developer tools' password): the same tools for the airports themselves, free and
  at once, plus pulling down anything and Undo. It writes fix ops in the browser game's format: yours are kept in
  `fixes.json` beside the save and replace the repo's for that airport, and "Write js/data/fixes.js" puts them into
  the repo's file (commit it to give everyone the fixes). The repo's fixes are applied here too, to the layouts and
  runways.
- **Airport checklist** (F8): every airport in checking order (start airports, the world's busiest, then by size) with
  its mark from `js/data/checks.js`, filters, counts and a search; click one to see it close up and mark it (your
  marks are kept in `checks.json` beside the save and can be written into `js/data/checks.js`).
- **Bug reports** (F5): a title, what happened and the game's details (version, game date, selection, map position,
  the last crash); then GitHub's new-issue page opens filled in (you send it there), or Copy, or Add to `BUGS.md`
  when it runs from the repo. A crash is written down, and the next start offers to report it.
- **Sound mixer** (F6): the level of each part (bass, roar, screech, far wash, start), which recording each takes and
  the screech's pitch, kept in the settings.

## What it leaves out (for now)

New airport sites (buying land and building an airport from nothing). In 3D the parts are simpler than the browser
game's (no shock absorbers, gear doors, reversers or spoilers; buildings as plain blocks, not its facades and photo
roof colours; no rain, snow or lightning), and the airports without a layout of their own have no buildings. The stands of airports the
browser game reads from OpenStreetMap while it runs are the made-up ones of their size here, and the sound is a mix
of recordings, not the browser game's engine voices made up as they play.

One difference: a plane more than half a day behind its timetable (after a strike, say) takes it up again from its
next departure instead of flying the missed flights late for good.

## Code

- `src/lib.rs`: the game without the window: `config.rs` (balance, from `js/config.js`), `data.rs`, `jsdata.rs`,
  `game.rs` (state and simulation, construction and build mode), `events.rs` (world events, emergencies, incidents,
  crashes), `weather.rs` (weather, day and night), `layouts.rs` (the real airport layouts, embedded by `build.rs`),
  `fixes.rs` (airport fixes: the repo's, the editor's and the player's, applied to layouts and runways), `track.rs`
  (runways and where a flight is), `dev.rs` (what the developer tools do).
- `src/main.rs`, `src/app.rs` (window, sections, plane and airport windows, newspaper, developer tools, bug reports),
  `src/mapview.rs` (map), `src/view3d.rs` (the 3D view: wgpu inside egui, models, liveries, moving parts and gear, buildings, clouds, satellite ground,
  cameras), `src/editor.rs` (build mode and the airport editor), `src/checklist.rs` (airport checklist),
  `src/sound.rs` (sound and mixer), `src/pictures.rs` (the aircraft pictures, embedded by `build.rs`), `src/style.rs`
  (styles, settings, the password hash).

`cargo test --release` loads the data and layouts, checks local times, stands, a quick start, story mode, shares and
construction, build mode, the airport fixes, an ultra long-haul timetable, the liveries and a 3D model, its moving parts and
landing gear, the buildings, the chase camera, the checklist and the sound recordings, and flies a month of a timetable. `FLIGHTGAME_SELFTEST=<folder>`
starts the app with the "European network" quick start, plays a few weeks by itself, saves sixteen screenshots (the
3D view's three cameras, a plane at the gate and build mode among them) and a report there and quits (it never touches the save).
