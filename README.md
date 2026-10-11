# Flightgame

**Play online: https://noname-ch.github.io/flightgame/** (updates automatically with every push to `main`)

A small airline management game in the browser, in a dark theme. The start screen lets you
continue your saved airline or found a new one: pick its name, the mode, the difficulty, your home
airport (30 small airports across the world with cheap slots, `startAirports` in `config.js`) and your first
leased aircraft (ATR 72, Dash 8-400, E190, A220-300, A320neo or 737-800). The default is
**Bern-Belp (BRN)** with an **Airbus A220-300**.

## Run

Open `index.html` in a browser (needs internet for the map tiles and Leaflet).
Or serve it locally: `python3 -m http.server` and open http://localhost:8000.

## How to play

1. Click an airport on the map to see its catchment, demand from your slots and slot price.
2. **Lease a slot** there (upfront fee + weekly fee).
3. In the **Fleet** tab: *Ferry there* to move the plane, or **Edit schedule** to build a loop
   (e.g. `BRN → BCN → BRN → LHR`) and press **Start schedule**.
4. Watch revenue in the **Log** and **Finance** tabs. Weekly costs (aircraft lease, crew, slots)
   are charged every Monday 00:00. Below CHF -500k you're bankrupt.
5. Set the **ticket price** of each route with − / + (in the plane's card or the airport panel),
   from 50% to 200% of the standard fare. Cheaper tickets fill more seats, dearer ones fewer –
   lower the price while seats stay empty, raise it once the plane is full.

6. More aircraft: the **Market** tab opens the hangar marketplace with 55 types, from the Ju 52 and
   Twin Otter to the A380 and Concorde, each shown in the hangar. Buy new, lease (deposit + weekly
   rate) or buy pre-owned (new offers every Monday; older planes are cheaper but cost more to run).
   New planes fly a delivery flight from their factory (🏭 on the map) to your airport, e.g. Boeings from Everett or Renton in the US.
   Each plane gets its own crew. Big jets need a big enough airport. Sell owned planes or return
   leased ones from the **Fleet** tab.

7. **Events**: strikes, storms, volcanic ash, fuel price swings, festivals, bird strikes and
   crashes happen at random. Each one appears as a newspaper cutout (the game pauses until you
   press Continue) and active events are listed above the tabs. Strikes and bad weather ground
   flights, festivals boost demand, and a crash costs you the plane, compensation and weeks of
   bookings.

8. **The whole world**: besides the ~50 main European airports, about 16,000 more airports and
   airfields worldwide (US, Canada, Latin America, Asia, Africa, Oceania) appear as you zoom in
   (grey = small airfield without an IATA code, fewer passengers), and about 33,000 cities with
   15k+ people feed them. In Europe every airfield with 500 m of runway is included, elsewhere
   every airport with an IATA code or a paved runway. Zoom in all the way (level 17) to see every runway, with runway
   numbers from zoom 14. Every aircraft needs a long enough runway, and jets need a paved one.
9. **Airport shares**: click an airport to buy or sell shares in 5% steps. Shareholders get a
   weekly dividend from its traffic (plus the fees your airline pays there). With **25%** you can
   order construction and pay your share of the cost: a new parallel or crosswind runway, a runway
   extension, or a terminal expansion that raises the airport size (bigger planes, more passengers).
   With **50%** your slot there is free. The **Airports** tab lists your stakes and building sites,
   and **builds new airports**: pick a site on the map, it opens after 12 weeks and is 100% yours.

10. **Realistic flights**: planes taxi to the runway, take off into the day's wind (neighbouring
    airports share it, mostly westerly), climb out, turn onto the great circle and cruise at a
    typical level for their type (FL360–390 for jets, ~FL250 for turboprops, FL580 for Concorde;
    lower on short hops, odd levels eastbound and even westbound). They then descend on a 3°
    path and fly a 15 km straight-in final to the landing runway. Select a plane to see its
    track coloured by altitude; its tooltip and card show flight level, speed and phase.

Modes (chosen on the start screen, also via **New game**): **Arcade** uses normal accident rates for every maker;
**Realistic** gives Boeing aircraft a 1000% higher crash and door-panel rate.
Difficulty: **Easy** (CHF 5M, +25% passengers, −15% flight costs, bankrupt below −2M), **Normal**
(CHF 1.5M, bankrupt below −500k) or **Hard** (CHF 750k, −15% passengers, +15% flight costs,
bankrupt below −250k). Both are set in `config.js` (`modes`, `difficulties`, `starterAircraft`).

Rules: departures only 06:00–22:00, crew max 12h block time per day, each route has a limited
daily demand shared by all your flights on it that day.

Map: the selected airport shows its catchment ring and the towns feeding it. Click a plane or a
route to select that aircraft, click empty map to deselect. ⌂ zooms to your network, the layer
button (top right) switches the base map (satellite by default, remembered) and toggles towns, routes and place names.

3D view: the **3D** button (or V) switches the map to a 3D globe with terrain, hill shading and 3D
buildings (MapLibre). Aircraft are drawn as 3D models at their real altitude, stretched when zoomed out
so you can see them. Drag with the right mouse button (or Ctrl + drag) to tilt and rotate. 🎥 Follow puts the camera
behind the selected plane, 🛰 Satellite toggles the satellite imagery (on by default). The aircraft are glTF models from
`models/` (Flightradar24's GPLv2 models, see `models/README.md`); `js/data/models.js` says which type uses
which file. Types without a model (small turboprops, Ju 52, DC-3, Concorde) keep the simple placeholder
built in `placeholderModel()`. The hangar marketplace shows a picture of the same model.

Developer tools: the 🛠 button (or F2) opens a cheat panel for testing: add or set money, add any
aircraft for free (delivered instantly to the chosen or selected airport, slot included), crash /
damage / repair / remove the selected plane, free slots and 100% airport ownership, finish all
construction, trigger or clear any world event, and skip an hour, day or week. Every cheat is noted
in the log (`js/devtools.js`).

Controls: Space = pause, 1/2/3 = speed. The game autosaves to the browser (localStorage).

## Extending

All content is plain data:

- `js/data/airports.js` – add airports (`size` 1–5 sets slot price and fees)
- `js/data/towns.js` – add towns; they generate demand for airports within 150 km
- `js/data/airports-more.js`, `runways.js`, `cities.js` – generated by `tools/build_data.py`
  from [OurAirports](https://ourairports.com/data/) (public domain) and
  [GeoNames](https://www.geonames.org/) cities15000 (CC BY 4.0). To rebuild, download
  `airports.csv`, `runways.csv` and `cities15000.txt` into `tools/cache/` and run
  `python3 tools/build_data.py`.
- `js/data/aircraft.js` – aircraft types (market catalogue) and crew templates
- `js/data/factories.js` – where each type is built (delivery flights start there)
- `js/data/looks.js` – side-view shape of each type, drawn by `js/hangar.js`
- `js/data/models.js` – 3D model of each type (`models/*.glb`) and its hangar picture (`models/hangar/*.webp`,
  made with `tools/hangar_shots.html`)
- `js/data/events.js` – random events, incidents and their newspaper stories
- `js/config.js` – starting conditions, map bounds, economy balance, game modes, event rates

`js/game.js` is the simulation (no DOM), `js/ui.js` the map and sidebar, `js/view3d.js` the 3D view.
