# Roadmap

What we could add next, and what would be great. Nothing here is promised: it is a list to pick from.
Tick a box when it is done and move it to **Done** at the bottom. Effort: **S** = an evening, **M** = a few
days, **L** = a big project.

Where we are (October 2026): a world map with ~16,000 airports, 55 aircraft types in 3D, timetables and
shared slots, a slot market with reputation, airport shares and construction, real airport layouts,
realistic flight tracks in 2D and 3D, AI rival airlines, random events and a developer panel.

## Next up: small steps on what is already there

- [ ] **Rival planes in 3D** (S). `G.rivalFlights(t)` already gives the airborne rival planes and the 2D map
  draws them; `js/view3d.js` only draws ours. Same models, painted in the rival's colour.
- [ ] **A profit table per route** (S). Planes keep totals (`p.stats`), but there is no list of routes with
  load factor, revenue, cost and profit per week, sortable. It would show at a glance what to cut.
- [ ] **Curfews per airport** (S/M). `C.curfew` is the same 06:00–22:00 everywhere, in home-base time (every airport
  has its own local time now, `G.localTime`: curfews could follow it). Real airports differ:
  Zurich closes at 23:30, Frankfurt and London have night quotas, many hubs are open all night. Hand-written
  for the main airports, a default by size for the rest.
- [ ] **Loans** (S). Today there is only the bankruptcy limit. A bank loan with interest and a credit
  rating from reputation and fleet value would let a player grow faster, at a risk.
- [ ] **Several save games and save files** (S). One autosave in localStorage now. Save slots, plus export
  and import as a `.json` file, so a game moves between browsers and can be sent to someone.
- [ ] **A first-game tutorial** (S/M). A short guided start: lease a slot, build a timetable,
  Save & fly, watch the first flight land and the money come in. Skippable, shown once.
- [ ] **Bump the `?v=` tags automatically** (S). They are bumped by hand on every push today. A git
  pre-commit hook or a GitHub Action could do it.

## Bigger features

### Running an airline

- [ ] **Delays that ripple** (M). Reputation already counts on-time and late flights. Real delays from
  weather, ATC, technical faults and tight turnarounds that carry through the day's timetable would make
  buffer time in the plan a real choice.
- [ ] **Maintenance checks** (M). Ageing now only raises costs (`agingCostPerYear`). A, C and D checks would
  take a plane out of service for hours to weeks, cost less at your own hangar (a building at your airports)
  and, when skipped, raise the incident rate in `js/data/events.js`.
- [ ] **Cabin layout and classes** (M). Seats are fixed per type. Let the player pick a layout (dense
  low-cost, two classes, premium); business travellers come from big cities and pay more but want early
  and late flights.
- [ ] **Cargo** (M/L). Belly cargo on passenger flights first (small extra revenue by route), then freighters
  (747F, 777F, ATR 72F) and cargo hubs.
- [ ] **Crew as people** (M). Pilots rated per type family, hiring, training to a new type, crew bases,
  salaries; underpaid crews strike (the strike event already exists).
- [ ] **Marketing** (S/M). Campaigns per region or route that lift demand for a while, and a brand value
  that grows with reputation.
- [ ] **Fuel price over time and hedging** (M). `fuelMult()` already swings with events. A fuel price chart
  in Finance and contracts that fix the price for some months.

### Passengers and demand

- [ ] **Demand by time of day and weekday** (M). Morning and evening peaks for business routes, weekends for
  leisure, so the departure time in the timetable matters.
- [ ] **Seasons** (M). Ski airports full in winter, Mediterranean islands in summer, a quieter November.
  Needs a calendar (game days mapped to months) and a season profile per airport or region.
- [ ] **Transfer passengers and hubs** (L). Today every route is point to point. Passengers who change planes
  at your hub (Bern → Zurich → New York) are what makes a hub-and-spoke network pay. Probably the biggest
  change to how the game plays.
- [ ] **Long haul** (M). Range is checked, but long flights need more: tech stops for short-range types,
  ETOPS rules for twins over the ocean, crew rest on flights over 12 hours.

### Competition

- [ ] **Alliances and codeshares** (M). Join a rival in an alliance: shared passengers on each other's
  routes, no fare war between you.
- [ ] **Buy a rival** (M). Take over a weak rival (its fleet, slots and routes) instead of only watching it
  go bust.
- [ ] **Your own share price** (M). Go public (IPO): money for growth, but shareholders want profit every
  quarter.

### Goals and scenarios

- [ ] **Scenarios** (M). Start conditions with a goal and a deadline: "connect 10 capitals from Bern in two
  years", "save a bankrupt regional airline", "the jet age in 1958" (only the types of that time: the
  catalogue already has the Ju 52 and the Concorde).
- [ ] **Achievements and a score** (S). First long-haul flight, 1 million passengers, a year without an
  incident, ten airports owned. A score to compare games.

## The world and the views

- [ ] **Your own livery** (M). `LIVERY` in `js/livery.js` is fixed (after SWISS). Pick colours and the title
  at New game; the hangar pictures and map icons would then have to be rendered in the browser instead of
  being the prepared `.webp` files.
- [ ] **Real weather** (M). Made-up weather is drawn now (clouds, rain, snow, fog, wind, crosswind crab:
  `G.weatherAt`, js/weather.js). Still to do: real wind, rain and fog from a free weather service; low visibility
  and storms close runways, strong crosswinds rule out short ones.
- [ ] **Cockpit and tower cameras in 3D** (S/M). Next to the 🎥 follow camera: a view from the cockpit and
  one from the control tower of the airport.
- [ ] **More sound** (S). The engines are in (js/sound.js). Still to do: a quiet airport ambience (vehicles,
  announcements), a radio call on take-off, rain and thunder from the weather.

## Polish, tech and infrastructure

- [ ] **Split the big files** (M). `js/game.js` (~3,100 lines) and `js/ui.js` (~2,300 lines) are getting hard
  to work on together; split by topic (flights, slots, rivals, airports, finance) into ES modules.
- [ ] **Languages** (M). German and French next to English. Needs the UI texts in one place first.
- [ ] **Play offline** (M). A service worker that keeps the game, the models and the tiles you have seen, so
  it starts without internet (an installable web app).
- [ ] **Balance pass** (S, again and again). Play a full year on each difficulty and tune fares, demand,
  costs and event rates in `js/config.js`.

## Someday

- [ ] **Play together** (L). A shared world on a small server: several players' airlines compete for the
  same slots and passengers, at a slow pace (one game day per real hour).
- [ ] **Real traffic layer** (M). Live aircraft from OpenSky (or from an own ADS-B receiver) as background
  traffic on the map, to compare your network with the real one.
- [ ] **Airport manager mode** (L). Run an airport instead of an airline: build, set fees, attract airlines.
  The construction and share system is already half of it.

## Done

Recent milestones, newest first (see `git log` for the rest):

- Thrust reversers on every type, each its own kind: in 3D the sleeves of big fans slide back over the cascade vanes,
  the A320ceo's four doors swing out, the old jets' buckets close behind the exhaust (on the A380 and A340-600 only the
  inner engines, on the Il-62, VC10 and Comet the outer ones); the reverse roar as loud as the engines that have them,
  propellers to reverse pitch or ground fine, Concorde's eyelids behind its four nozzles; they shorten the landing run
  (an earlier exit; brakes alone roll further); named in the market and the plane window
- Local time and day and night: every airport keeps its own clock (time zones with summer time), the sun rises
  and sets where it really does, the night moves over the 2D map, and in 3D the sky, ground and buildings darken
  with lit runways, taxiways and windows and the planes' position lights, beacons, strobes and landing lights
- Aircraft sounds (off until turned on, M): engine start, idle, take-off power, climb, cruise, approach, reverse
  thrust and run-down for jets, turboprops and piston radials, heard from where you look (Web Audio; the jets'
  deep rumble, screech, engine start and planes far away are recordings made with ElevenLabs)
- Weather: clouds in 2D and 3D, rain, snow, fog and lightning up close, a grey sky under cloud, storms from the
  newspaper drawn as storms, and planes crabbing into crosswinds (straightened before touchdown)
- Plane stats as in OpenTTD: every plane keeps its records (this year, last year, all time, the last 12 weeks,
  its last flights) in a stats window, opened from its window, its Fleet card or its card clicked again
- Story mode: start in 1955 (or a later year); 65 more airliners from the 1940s to the 2000s reach the market
  in their real first year of service, announced in the newspaper. Rivals fly the types of their time
- Storage: the airport layout cache moved from localStorage to IndexedDB, so it can never push the save out
- A smoke test on every push: `tools/smoke.mjs` plays the game in headless Chrome (GitHub Action)
- Phones and tablets: bottom tab bar, the sidebar as a draggable sheet, installable as an app
- Airport editor: fix runways, taxiways, aprons, buildings and stands on the satellite map, for every game
- Slot market by airport and reputation
- Real layouts at every airport, read off the map's vector tiles
- One planning system: timetables and shared slots
- New UI: top bar, side rail, plane cards
- AI rival airlines
- 3D airports, all 55 aircraft as 3D models, realistic flight heights and speeds
- Gates and stands at every airport, pushback and nose-in docking
- Start screen, game modes and difficulties
- Random events as newspaper stories, developer panel
- The whole world: ~16,000 airports, runways, airport shares and construction
- Hangar marketplace with 55 types, delivery flights from the factories
