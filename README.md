# Flightgame

**Play online: https://noname-ch.github.io/flightgame/** (updates automatically with every push to `main`)

What we could build next: see [ROADMAP.md](ROADMAP.md).

A small airline management game in the browser, in a dark theme. The start screen lets you
continue your saved airline or found a new one: pick its name, the mode, the difficulty, your home
airport (30 small airports across the world with cheap slots, `startAirports` in `config.js`) and your first
leased aircraft (ATR 72, Dash 8-400, E190, A220-300, A320neo or 737-800). The default is
**Bern-Belp (BRN)** with an **Airbus A220-300**.

**Quick start** (top of the start screen) skips the setup for testing: one click starts a ready-made
airline whose planes already fly daily timetables (Swiss regional, European network, Widebodies,
Busy hub with 20 planes, Sandbox with CHF 1 billion, Hard start). `index.html?preset=<id>` (for
example `?preset=europe`) starts one straight away, on every reload. The presets are in
`js/data/presets.js`.

## Run

Open `index.html` in a browser (needs internet for the map tiles and Leaflet).
Or run it locally: `./play.sh` starts a small server (`tools/serve.py`) and opens http://localhost:8000 in
the browser; the airport editor saves its fixes through it.
Double-clicking `index.html` (a `file://` page) is not enough: browsers block the 3D view's modules there.

**Smoke test**: `node tools/smoke.mjs` (Node 22+, Chrome or Chromium) loads the game headless, starts an airline,
flies a timetable for a month of game time, opens every section, the airport editor and the 3D view, and fails
on any script error.
Run it before you push.

## How to play

**Screen**: top left ⋯ opens the menu (save, load, new game, settings with map style and layers,
developer tools, exit) and the ✈ button next to it sets the game speed. The tabs in the middle of the
top bar open the sections (Fleet, Airports, Slots, Schedule, Marketplace, Finance, Rivals, Log; icons only on
narrower screens), and the airline, money, time and day are on its right. Every plane has a card at the bottom: hover it for
where it comes from and goes to, the time left and its fuel; click to select, double-click to
follow it (2D or 3D).

**Plane window**: clicking a plane (on the map, in 3D or its card) opens its window, as in OpenTTD: a live 3D
camera behind it (the wheel zooms), what it is doing, its speed and height, where it comes from and goes to, the
time and distance left, the passengers on board and the runways it takes off from and lands on. **Runways**: for
every airport of its day you choose which runway it takes, or *Auto*: the shortest runway it can use (long enough,
paved where it needs that) whose end is within 45° of the day's wind, so the long runways stay free for the big
planes; it takes off and lands into the wind. A choice counts from its next flight there on. 🗓 *Timetable* opens its timetable in a window of its own
(also from a plane's row in Schedule). Every window can be moved by its title bar (also the developer tools,
the airport editor and build panel, the bug report, the airport checklist and settings) and opens where it was
left last time. On a phone a click shows the plane's card in Fleet instead.

**Main menu**: the very first start asks for a style, then the main menu offers *Continue*, *New game*,
*Load game* (the last save in this browser, or a `.json` save file; ⋯ → *Save to file* makes one) and
*Quick start*. A loading screen stays up until the map has its tiles. The 3D view asks once whether the device
is strong enough (it needs a fast graphics chip) and names the graphics chip the browser reports.

**Styles** (⋯ → Settings → Style, or on the start screen): *Night* (the classic dark look), *Tycoon*
(bevelled grey windows with a toolbar along the top, like a 90s transport tycoon), *Metropolis* (light
frosted panels with a round dock at the bottom, like a modern city builder), *Pixel* (pixel art with a tool
palette, like a sprite editor) and *Departure board* (black and airport-sign yellow with a sign column and
flip-board numbers). Each style has its own section bar and icons; the choice is kept in the browser.

**On a phone**: the sections are a tab bar at the bottom and open as a sheet over the map. Drag the
sheet's top edge to make it taller or shorter, pull it down to close it, or tap it to switch to full
height. Pinch to zoom the map; tap a plane card to select it, tap it twice to follow it. In the
browser menu, *Add to Home screen* installs the game as an app without the address bar.

**Story mode** (start screen → Game → Story mode): the airline starts in a past year (1955 by default,
up to 2010) with a date in the top bar. Each New Year the newspaper announces the airliners that first flew
with airlines that year, from the Super Constellation and the first jets (Tu-104, Comet 4, Boeing 707) to the
747, Concorde, the A320 and the Dreamliner; they are then sold new in the Marketplace. A type stays on sale
new until its real end of production and is offered pre-owned for 25 years more. Rival airlines fly the
aircraft of their time, and new airlines take the place of those that went bust. At top speed a year takes
about a quarter of an hour. Free play is today's world with every type on sale.

**Timetables** (Schedule section): each plane gets a day plan that repeats every day. Pick the route,
the first departure and how many loops, then move single flights with − / + or type a time. Each
slot holds one plane on the ground at a time, from landing until departure; when it is empty any of
your planes can use it, and a plane that would find every slot at its destination taken waits at its
gate (a timetable that plans that is only warned about). The Slots section shows every slot of an
airport over the day, what stands in them right now and the arrivals and departures.

**Slots of an airport**: an airport has one slot per aircraft stand. The Slots section and the airport
panel show who holds them: you, the rivals that fly there (one slot per 4 daily flights on a route, 2
more at their hub) and other airlines (a share by airport size); the rest are free to lease (upfront +
weekly fee; nothing at all where you own 50 %). When none is free you can offer a holder money for one
of theirs: the airport decides by your offer and your **reputation** (0–100: flights flown,
punctuality, crashes and incidents, your shares in that airport, your home base). A rejected offer can
be made again the next day; a rival that gives up a slot flies one daily flight less there.

**Stand classes**: aircraft and stands come in the ICAO classes A–F by wingspan (below 15, 24, 36, 52, 65 and
80 m: a Twin Otter is B, an A320 C, a 757 D, an A330 or 747-400 E, an A380 F; the market shows each type's).
A stand's class is the biggest whose widest wings fit into the room it has, with headroom on both sides (3 m
for A and B, 4.5 m for C, 7.5 m from D on): the room is how far the stands beside it are (and at your own
airports twice how far a building beside it is). Every slot is a stand of a class, and a plane needs a slot of
its class or a bigger one: a 747 does not fit into a Cessna's slot. The airport panel lists its slots by class,
and you lease the class you need (a plain Lease picks the smallest free one your biggest plane fits). At real
airports the map data's stands are taken as at least class C (B at small airfields), and their roomiest third as
big as the airport's size stands for. In build mode the Stand tool shows the class a stand would get where the
mouse is, and a stand row the class its spacing gives.

**Airport size** comes from what is there: at your own airports from the stands (by class) and the longest paved
runway; real airports keep their size, and the stands you build there can raise it. There are no terminal
upgrades any more: you build terminals and stands yourself.

1. Click an airport on the map to see its catchment, demand from your slots and its slots.
2. **Lease one** of its free slots (upfront fee + weekly fee), or make an offer when none is free.
3. In the **Schedule** tab: click the plane, pick its airports (e.g. `BRN → BCN → BRN → LHR`),
   drag the **start time** and **Save & fly**. Below the slider, one bar per airport shows when this plane
   stands there (orange), when your other planes do (grey) and where all your slots there are taken (red).
   Planes share a slot as long as they aren't on the ground at the same time. **✨ Find a time that fits**
   tries every start time and every stop as the place the plane spends the night.
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
   leased ones from the **Fleet** tab, and give a plane its own name with ✏️ next to its registration.

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
   order construction and pay your share of the cost: a new parallel or crosswind runway or a runway
   extension; stands and terminals you build yourself (build mode), and they make the airport bigger.
   With **50%** your slots there are free (no upfront, no weekly fee). The **Airports** tab lists your stakes and building sites,
   and **builds new airports**: pick a site on the map (CHF 3M, 100% yours) and build it in build mode: a runway,
   an apron with stands, a terminal and the taxiways between them. A checklist (build panel and airport panel)
   shows what it still needs; **✈ Open the airport** when it is all there.
   Only where the terrain is fit for one: level ground (heights from the terrain tiles of the 3D view), no
   water, glacier or built-up area (from the map data); `FG.terrain.check(lat, lon)` in `js/view3d.js`.
   New runways and terminals are placed by you in build mode (below) and built over weeks; a new runway gets
   taxiways (a parallel taxiway round into its ends, exits and a link into the taxiways there are). Where two
   runways cross, neither is painted over the other, and where a taxiway meets a runway the runway and its
   paint lie on top. Taxiways are round at their bends: those the game lays out, and those drawn in the editor
   (unless "Sharp corners" is ticked while drawing; `G.roundLine`).
   **🏗 Build at the airport** (in its Construction section, at an airport you built or where you have 25%) opens
   the build mode: a tool panel beside the satellite map. Pick a tool, then click the map:
   **Select** (change what you click in the panel), **Move** (drag the ✥), **Points**, **Remove** (a runway: close
   it), or one of the things to build. **Runway**: click where its middle goes (again to move it), then set its
   length, width and paved in the panel and turn it (buttons, a heading, Q / E, or "like" a runway that is there);
   the panel shows its price, weeks and what is in its way. **Terminal**: click where it goes and turn it the same
   way; set its gates, their class (which sets how far apart they are), its depth and gates on both sides: it comes
   with an apron, its stands and a taxi lane joined to the nearest taxiway. Both are ordered with **Build it** and
   built over weeks (dashed in orange meanwhile). The rest is built at once: stands (also in rows), taxiways and
   curves, aprons, pads, hangars, other buildings and towers. Building only ever adds. It costs your share (stand CHF 1.5M, apron CHF 150/m², terminal CHF 2'500/m²,
   …; `C.airports.build`), Undo gives the money back, and it is kept in that save game only
   (`G.state.airportOps`, applied by `js/fixes.js` after the airport fixes).

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
daily demand shared by all your flights on it that day. After landing a plane turns around at the gate
for 15–60 minutes by its size (Twin Otter 15, ATR 72 20, A320 30, A330 40, A380 60; `turnaround` in config.js).

Map: the selected airport shows its catchment ring and the towns feeding it. Click a plane or a
route to select that aircraft, click empty map to deselect. ⌂ zooms to your network, the layer
button (top right) switches the base map (satellite by default, remembered) and toggles towns, routes and place names.

Rival airlines: about ten AI competitors (fictional, `js/data/rivals.js`) – flag carriers, low-cost and regional
airlines, half of them based near your home airport, the rest elsewhere in the world – fly their own route networks
(thin coloured lines and dots on the map, layer "Rival airlines"). On a route you share, passengers split by the seats
each airline offers per day and its ticket price (`C.rivals`): add flights or cut your fare to win them. Every Monday
they react: more flights on full routes, fewer on empty ones, lower fares where you take their passengers, and new
routes – sometimes one of yours (low-cost carriers even open a base for it). The **Rivals** tab shows your contested
routes with your share and every rival's network; route tables show competitors as coloured dots and your share.
A rival can also go bust (newspaper), and its routes are gone.

Buildings in 3D have windows, glass fronts, entrance doors on the landside, hangar doors facing the apron and
open car park decks, in a few styles that differ from building to building; their roofs take the colour of the
satellite photo, and the walls are picked to go with it (js/facades.js).

Gates: every airport has an apron beside its longest runway, where nothing is in the way: it keeps clear of
the other runways and of the real taxiways and buildings there (read off the 3D map the first time the
airport is looked at in 3D from zoom 13, kept in the browser). Up to size 2 the gates are one row; from size 3
they stand on both sides of piers, so even a hub's apron is about 1 km wide. It has a terminal, gates with jet bridges
(A1, A2, …) and remote stands without bridges (R1, …): from 2 gates at small airfields to 32 at hubs, and
terminal expansions add more. Zoom in on an airport to see them (2D from zoom 14, 3D from zoom 12). A plane
gets a free stand when it leaves for an airport, taxis nose-in onto it, parks there (the fleet card shows
the gate) and is pushed back from it tail first by a tug. `G.apronOf(code)` has the layout, `G.gateOf`
the stand of a plane. The stands the game lays out itself have lead-in curves from the taxi lane, white limits
between them, a service road in front of the noses and jet bridges with a rotunda at the terminal, an angled
tunnel and a cab at the front left door (`ap.markings`, bridge parts in `ap.buildings`).

Airports in 3D: the 3D view also draws the runways (from zoom 10), a taxiway parallel to each runway with
links to the runway ends, the runway exits and the apron, and the buildings: the terminal in one of five
layouts per airport, a control tower and hangars that grow with the airport's size, so a terminal expansion
shows. Planes taxi along these taxiways (`G.taxiwaysOf(code)` has the lines, `ap.buildings` the buildings).
Paved runways carry their paint from zoom 14: side stripes, centre line, threshold stripes, the two numbers,
aiming points and touchdown zone bars (fewer on short and narrow runways). Taxiways have shoulders, a yellow
centre line and holding bars before each runway; runways from 1800 m have fast exits at 30° where landing
planes leave them.

Real layouts: the airports listed in `js/data/layouts.js` have their real aprons, terminals, hangars, towers,
taxiways and stands (`js/data/layouts/<CODE>.json`, loaded when the airport is first needed, see
`js/layouts.js`). There planes park on the real stands nearest the main terminal and taxi the shortest way
along the real taxiways. The data is © OpenStreetMap contributors (ODbL); `tools/build_layouts.html` makes the
files, from Overpass API downloads where there are any and else from the vector tiles of the 3D map
(OpenFreeMap): there the stands are placed in front of the mapped gates. Lukla (LUA) has a file made by hand
too: its real apron, taxi loops and buildings with four stands in the bays. Reichenbach (LSGR) has a file made
by hand: its real taxiway and hangars, and a small apron with three stands beside the taxiway, as none is mapped
(a layout file may also say `"tower": false` and `"bridges": false`). Every other airport is read off
those vector tiles in the browser the first time it is needed (zoomed in on, or flown to), by
`js/osmairports.js`, and kept in the browser (IndexedDB, the last 300 airports): its real aprons, taxiways
and buildings with their mapped heights. The terminal is the building at the mapped gates, or else the
biggest one beside an apron; the others beside an apron are hangars. Stands are put in front of the mapped
gates and, where there are fewer than the airport could use, in rows along the terminal's apron side (nose to
it), beside the taxi lanes and in rows on the other aprons. Planes may also taxi along the runway (small
fields have no parallel taxiway). Only where no apron is mapped at all does the game lay the airport out
itself as described above.

Terminal concepts: the game lays terminals out in the three common ways. Linear: the gates in one row along
the building (up to size 2; a longer one has its remote stands across the taxi lane). Pier: on both sides of
piers (from size 3). Satellite: most gates round a building that stands free on the apron, taxi lanes all
round it, planes taxi round its ends (only where chosen). A terminal you build yourself (a terminal
expansion) is the copy of a real one instead: the outline, stands, taxi lanes and apron of a terminal at one
of the big airports (`js/data/terminals.js`, 76 terminals at 40 airports, made by `tools/build_terminals.html`
from the OpenStreetMap layouts), with about as many stands as the airport's size has, turned to lie beside
the runway; the tower and the taxiways to the runway are the game's. In the developer tools the terminal of
the selected airport can be set to any of these (`infra.style`), and "Build desert examples" puts four
airports into the Sahara (Gilf Kebir) that differ only in the terminal: XLI linear, XPI pier, XSA satellite,
XRE copy of a real one; the same button removes them again.

Expansion preview: in the developer tools (F2), "Show expansion preview" draws in cyan where construction
at the selected airport would go, in 2D and 3D: each kind of new runway with its taxiway, the runway
extension, and the apron, stands and buildings of the next terminal size (`G.expansionPreview(code)`).

3D view: the **3D** button (or V) switches the map to a 3D globe with terrain, hill shading and 3D
buildings (MapLibre). Aircraft are drawn as 3D models at their real altitude, stretched when zoomed out
so you can see them. Planes really fly: they push back from their gate tail first, taxi
(speeding up and slowing down), accelerate down the runway, rotate and lift off, bank into turns, pitch up
to climb and down to descend, flare, brake after touchdown and taxi nose-in onto their stand. Hover a
plane for its status, click it to select it. Drag with the right mouse button (or Ctrl + drag) to tilt and rotate. 🎥 Follow puts the camera
behind the selected plane, 🛰 Satellite toggles the satellite imagery (on by default). The aircraft are glTF models from
`models/` (Flightradar24's GPLv2 models, see `models/README.md`); `js/data/models.js` says which type uses
which file; six more come from FlightGear aircraft, and the Saab 340 and Saab 2000 from 3D-print models on Thingiverse.
The hangar marketplace shows the same models: the selected type as a live 3D
model that you can turn by dragging (double-click to reset), the tiles as pictures.

Developer tools: the 🛠 button (or F2) opens a cheat panel for testing: add or set money, add any
aircraft for free (delivered instantly to the chosen or selected airport, slot included), crash /
damage / repair / remove the selected plane, free slots and 100% airport ownership, finish all
construction, trigger or clear any world event, and skip an hour, day or week. Every cheat is noted
in the log (`js/devtools.js`).

Stands in buildings: in every layout that loads, a stand that lies in a building (a mapped gate sits on its
terminal) is moved out in front of the nearest wall, nose to it, or dropped where there is no room
(`js/layouts.js` tidy; only onto an apron, never out to the land side); stands a fix already moves or deletes
are left to the fix. The runways of the big
airports were checked against the map (and each change against the satellite picture): 27 that lay 20 to 60 m
beside the real runway at one end are moved onto it in
`js/data/fixes.js` (their lengths are kept), and Bern's grass runway, which was there twice, is there once.

Airport editor: in the developer tools (✏️ "Fix airports on the map", or F3) you fix airports where the
map data is wrong or missing. Click the satellite picture where something is off; a window opens there:
on a runway, taxiway, apron, building, stand or tower you can **Redraw** it, **Straighten** it (a taxiway
becomes one straight line, an apron or building gets square corners), make part of a taxiway a **Curve** (click
two points on it: what lies between becomes two straight legs joined by a round curve; set its angle, radius and
where the corner sits, or drag the corner; it starts as the taxiway runs there), **Move points** (drag them; a click on
the small dot between two points adds one, a right-click removes one), turn a stand or set its name and
length (of its lead-in line and the pushback), change a runway's width and surface, make a building a
terminal or hangar, or **Delete** it. Anywhere you can add a runway, taxiway (also as a curve between two points), stand, apron, terminal, hangar,
building or tower, and away from other airports a whole new airport. A **pad** is open concrete or asphalt
where planes need no taxiways: they go straight across it from where they come onto it to their stand
(from the nearest taxiway or runway if none reaches it). It is taken from the mapped apron there or
drawn; any apron can be turned into a pad and back. **Stand row** places stands evenly
along a line you click (start, end): set the spacing and a name prefix, and turn them round if the noses
point the wrong way. Stands added or moved with the editor are always used by the game (one slot each), on
top of the ones an airport of its size uses. Where too little is mapped, the game lays an airport out itself
(apron, terminal, hangars, taxiways and stands beside the runway); those can be picked too ("made up by the
game"). Change or delete one and everything the game made up there becomes that airport's own fixes, to change
or delete piece by piece, and the game stops making it up. The last stand stays: without one the game would
make the airport up again. Adding and redrawing first look in the map data (OpenStreetMap vector tiles) and show what they
found in cyan: **Use it**, or **Draw it myself** by clicking its points (snapped to the taxiways and corners
already there; Shift = no snapping). Changes show at once (green = new or changed, red dashed = removed);
↶ Undo (Ctrl+Z) takes them back. **Save** puts them into `js/data/fixes.js`, which every player loads:
- on the website (GitHub Pages): sign in once with "Sign in to GitHub" and a GitHub token of yours (a classic
  token with the *public_repo* box ticked; it stays on that device). Save then commits the fixes to the repo,
  and the website has them a few minutes later. GitHub takes the commit only from the repo's contributors;
  everyone else's fixes stay in their own browser (and "⬇ fixes.js" downloads the file);
- when the game runs from `./play.sh`, Save writes the file in your checkout: commit and push it. The fixes are applied whenever an airport's
data loads, so every game has them, new or saved (`js/fixes.js`; each fix finds its element again by its
shape, and a fix whose element the map data no longer has is marked ⚠).

Airport checklist: F8 (or ✅ "Check airports" in the developer tools, or the ⋯ menu, where the airport editor is
too: some browsers keep function keys for themselves) lists every airport in the order to
check them: the start airports first, then the world's busiest airports by flights (`js/data/busiest.js`),
then all others by size. Click one to fly there and see its mark and note. An agent that has looked at an
airport marks it 🔵 **Checked**; a person then looks again and marks it 🟢 **Good**, or 🔴 **Needs work** (with a
note saying what is wrong) to send it back. **Fix in the editor** opens the airport editor beside it; **Next ▶**
goes on down the list, and the filters show what is left to check or to approve. The marks are in
`js/data/checks.js` and are saved like the fixes: straight into the file under `./play.sh`, as a commit on the
website when signed in to GitHub (in the airport editor), else only in that browser. Agents use
`node tools/checks.mjs` (`next`, `mark CODE --note "…"`, `status`; same order as the game).

Bug reports: F5 (or 🐞 "Report a bug" in the ⋯ menu) opens a short form: bug, idea or other, a title and what
happened. The game's details (version, browser, game date, selected plane or airport, map position and the last
script errors) go with it unless you untick them. Signed in to GitHub (airport editor, F3), it becomes an issue of
the repo; from `./play.sh` it is written into `BUGS.md`; otherwise GitHub's new-issue page opens filled in (you
need a GitHub account), or Copy puts it on the clipboard.

Controls: Space = pause, 1/2/3 = speed. The game autosaves to the browser (localStorage; the airport layouts read off the map are kept apart, in IndexedDB).

## Extending

All content is plain data:

- `js/data/airports.js` – add airports (`size` 1–5 sets slot price and fees)
- `js/data/towns.js` – add towns; they generate demand for airports within 150 km
- `js/data/airports-more.js`, `runways.js`, `cities.js` – generated by `tools/build_data.py`
  from [OurAirports](https://ourairports.com/data/) (public domain) and
  [GeoNames](https://www.geonames.org/) cities15000 (CC BY 4.0). To rebuild, download
  `airports.csv`, `runways.csv` and `cities15000.txt` into `tools/cache/` and run
  `python3 tools/build_data.py`.
- `js/data/aircraft.js` – aircraft types (market catalogue) and crew templates; `year`/`endYear` = first
  year in airline service and last year built (story mode)
  and optionally its flight performance (`climbFpm`, `vLofKmh`, `vAppKmh`, `bankDeg`; otherwise its
  category's): every type climbs, turns and approaches at its own rates
- `js/ground.js` – ground heights along a flight (the 3D view's terrain tiles): flights climb over the
  mountains, circling over a valley airport such as Lugano when the ridges are too close to outclimb, and
  fly a steeper glide path (up to 7°) where the final approach needs it
- `js/data/story.js` – story mode: a newspaper line for each new type, and the rival airlines' aircraft by era
- `js/data/factories.js` – where each type is built (delivery flights start there)
- `js/data/looks.js` – side-view shape of each type, drawn by `js/hangar.js`
- `js/data/models.js` – 3D model of each type (a file, `models/*.glb`)
  and the real size of each model (`modelSize`), so that a type flying a relative's model is
  stretched to its own length. Each type's hangar picture (`models/hangar/*.webp`) and map icon
  (`models/icons/*.webp`) are made with `tools/hangar_shots.html`
- `js/data/events.js` – random events, incidents and their newspaper stories
- `css/themes.css`, `js/themes.js` – the interface styles: colours, fonts, the section bar's place and icons
  (pixel art and pictograms). A new style is a block of `:root[data-theme=<id>]` rules plus an entry in
  `js/themes.js`
- `js/data/presets.js` – the Quick start airlines (home, money, planes and their routes)
- `js/config.js` – starting conditions, map bounds, economy balance, game modes, event rates
- `js/data/fixes.js` – airport fixes drawn with the airport editor (F3), written by `tools/serve.py`
- `js/data/checks.js` – the airport checklist marks (F8), `js/data/busiest.js` – the busiest airports, in checking order

`js/game.js` is the simulation (no DOM), `js/ui.js` the map and sidebar, `js/view3d.js` the 3D view,
`js/hangar3d.js` the turnable 3D aircraft in the marketplace. `js/models3d.js` loads the 3D models and
`js/livery.js` paints them in the airline's livery, chosen in the settings (⚙ → Livery, kept in the saved game):
SWISS, Lufthansa, KLM, Delta, Ryanair, Eurowings and easyJet (`js/data/liveries.js`), simplified after photographs of the real
ones: the fuselage in one or two colours, coloured engines (found as the round pieces beside the fuselage), a
coloured fin with a mark or a simple logo (crown, crane, harp), the title on the
forward fuselage, coloured wing tips. The first livery has its hangar pictures in `models/hangar/`; in the
others `js/shots3d.js` renders them in the browser. `tools/liveries.html` shows all of them on a few types.
