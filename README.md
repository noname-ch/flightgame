# Flightgame

A small airline management game in the browser. You start at **Bern-Belp (BRN)** with one
**Airbus A220-300**, a base crew and CHF 1.5M.

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

Rules: departures only 06:00–22:00, crew max 12h block time per day, each route has a limited
daily demand shared by all your flights on it that day.

Controls: Space = pause, 1/2/3 = speed. The game autosaves to the browser (localStorage).

## Extending

All content is plain data:

- `js/data/airports.js` – add airports (`size` 1–5 sets slot price and fees)
- `js/data/towns.js` – add towns; they generate demand for airports within 150 km
- `js/data/aircraft.js` – aircraft types and crew templates
- `js/config.js` – starting conditions, map bounds, economy balance

`js/game.js` is the simulation (no DOM), `js/ui.js` the map and sidebar.
