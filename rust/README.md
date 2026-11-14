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
- **Slots**: leasing and giving back, holders (rivals and other airlines), offers for someone else's slot by
  reputation, planes waiting at the gate when every slot is taken, the home base where parked planes need none.
- **Timetables**: built round a route like the planner (as many loops as fit into the day), shifted flight by
  flight, checked (curfew, range, runway, stand class, turnarounds, crew duty), with a forecast and slot warnings.
- **Fleet and market**: leasing and buying new aircraft (delivery flights from the factory), pre-owned ones every
  Monday, selling and returning, ferry flights, renaming, each plane's stats with its last 12 weeks.
- **Rivals**: the same airlines and rules: routes from their hubs, sized for their target load, weekly growth,
  fare wars and attacks on your routes; their planes fly on the map.
- **Events and newspapers**: strikes, storms, volcanic ash, fuel prices, festivals, a rival going bust, incidents and
  crashes, with their stories.
- **Map**: Esri's dark or light grey canvas, airports by size, your slots, timetable route lines, your planes and the
  rivals'. Click a plane or an airport for its window.

## What it leaves out (for now)

The 3D view, sound, weather, airport layouts (stands, taxiways, the airport editor and building), airport shares and
construction, story mode, quick-start presets and ultra long-haul timetables. Without layouts an airport's stands
(and so its slots) and its biggest stand class go by its size (`SLOT_CAPACITY` in `src/config.rs`).

One difference: a plane more than half a day behind its timetable (after a strike, say) takes it up again from its
next departure instead of flying the missed flights late for good.

## Code

- `src/lib.rs`: the game without the window: `config.rs` (balance, from `js/config.js`), `data.rs`, `jsdata.rs`,
  `game.rs` (state and simulation), `events.rs` (world events, incidents, crashes).
- `src/main.rs`, `src/app.rs` (window, sections, plane and airport windows, newspaper), `src/mapview.rs` (map).

`cargo test --release` loads the data and flies a month of a timetable. `FLIGHTGAME_SELFTEST=<folder>` starts the
app, plays about 50 days by itself, saves four screenshots and a report there and quits (it never touches the save).
