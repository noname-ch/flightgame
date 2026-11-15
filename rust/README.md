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

## What it leaves out (for now)

The 3D view (with its cameras, aircraft models and plane window camera), the airport editor and the build mode
(placing runways, aprons, stands and terminals by hand, new airports), the developer tools, the styles (Tycoon,
Metropolis, Pixel, Departure board) and the bug reports. The stands of airports the browser game reads from
OpenStreetMap while it runs are the made-up ones of their size here, and the sound is a mix of recordings, not the
browser game's engine voices made up as they play.

One difference: a plane more than half a day behind its timetable (after a strike, say) takes it up again from its
next departure instead of flying the missed flights late for good.

## Code

- `src/lib.rs`: the game without the window: `config.rs` (balance, from `js/config.js`), `data.rs`, `jsdata.rs`,
  `game.rs` (state and simulation), `events.rs` (world events, emergencies, incidents, crashes), `weather.rs` (weather,
  day and night), `layouts.rs` (the real airport layouts, embedded by `build.rs`).
- `src/main.rs`, `src/app.rs` (window, sections, plane and airport windows, newspaper), `src/mapview.rs` (map),
  `src/sound.rs` (sound).

`cargo test --release` loads the data and layouts, checks local times, stands, a quick start, story mode, shares and
construction, an ultra long-haul timetable and the sound recordings, and flies a month of a timetable.
`FLIGHTGAME_SELFTEST=<folder>` starts the
app with the "European network" quick start, plays a few weeks by itself, saves six screenshots and a report there
and quits (it never touches the save).
