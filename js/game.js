// Game state + simulation. No DOM code in here.
(function () {
  const C = FG.config;
  const D = FG.data;
  const SAVE_KEY = 'flightgame.save.v1';
  const DAY = 1440;
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const airportByCode = {};
  D.airports.forEach((a) => { airportByCode[a.code] = a; });

  // Factories are map points new planes are delivered from (not airports you can use).
  const factoryOfType = {};
  for (const f of D.factories || []) {
    if (!airportByCode[f.code]) {
      airportByCode[f.code] = { code: f.code, name: f.name, city: f.name, country: f.country, lat: f.lat, lon: f.lon, size: 0, factory: true };
    }
    for (const t of f.types) factoryOfType[t] = f;
  }
  const factoryOf = (type) => factoryOfType[type] || null;

  // ---------- geo helpers ----------
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;

  function distanceKm(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function bearing(a, b) {
    const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
    const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
      Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // Point at fraction f along the great circle from a to b.
  function interpolate(a, b, f) {
    const delta = distanceKm(a, b) / 6371;
    if (delta < 1e-6) return [a.lat, a.lon];
    const wa = Math.sin((1 - f) * delta) / Math.sin(delta);
    const wb = Math.sin(f * delta) / Math.sin(delta);
    const x = wa * Math.cos(toRad(a.lat)) * Math.cos(toRad(a.lon)) + wb * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon));
    const y = wa * Math.cos(toRad(a.lat)) * Math.sin(toRad(a.lon)) + wb * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon));
    const z = wa * Math.sin(toRad(a.lat)) + wb * Math.sin(toRad(b.lat));
    return [toDeg(Math.atan2(z, Math.hypot(x, y))), toDeg(Math.atan2(y, x))];
  }

  function dist(codeA, codeB) {
    return distanceKm(airportByCode[codeA], airportByCode[codeB]);
  }

  // ---------- economy model ----------
  // Towns bucketed by whole degrees, so a catchment only looks at nearby cells (30k+ towns).
  const townGrid = {};
  for (const t of D.towns) {
    const k = `${Math.floor(t.lat)},${Math.floor(t.lon)}`;
    (townGrid[k] = townGrid[k] || []).push(t);
  }
  function townsNear(p, km) {
    const dLat = Math.ceil(km / 111);
    const dLon = Math.min(180, Math.ceil(km / (111 * Math.max(0.05, Math.cos(toRad(Math.min(89, Math.abs(p.lat) + dLat)))))));
    const out = [];
    const la = Math.floor(p.lat);
    const lo = Math.floor(p.lon);
    for (let i = la - dLat; i <= la + dLat; i++) {
      for (let j = lo - dLon; j <= lo + dLon; j++) {
        const cell = townGrid[`${i},${((j + 180) % 360 + 360) % 360 - 180}`];
        if (cell) out.push(...cell);
      }
    }
    return out;
  }

  const catchmentCache = {};
  function catchment(code) {
    if (catchmentCache[code] != null) return catchmentCache[code];
    const ap = airportByCode[code];
    let sum = 0;
    for (const t of townsNear(ap, C.catchmentRadiusKm)) {
      const d = distanceKm(ap, t);
      if (d < C.catchmentRadiusKm) sum += t.pop * (1 - d / C.catchmentRadiusKm);
    }
    catchmentCache[code] = Math.round(sum);
    return catchmentCache[code];
  }

  // Short hops lose to trains/cars, very long ones get less demand.
  function distanceFactor(d) {
    let f = Math.min(1, Math.max(0.1, (d - 100) / 500));
    if (d > 2500) f *= 2500 / d;
    return f;
  }

  function dailyDemand(from, to) {
    const d = dist(from, to);
    return Math.round(C.demandFactor * Math.sqrt(catchment(from) * catchment(to)) * distanceFactor(d) *
      attraction(from) * attraction(to));
  }

  // ---------- airport infrastructure ----------
  // The player's changes (state.infra[code]) sit on top of the static data.
  const A = C.airports;
  const infra = (code) => (Game.state && Game.state.infra[code]) || {};
  const airportSize = (code) => Math.min(5, airportByCode[code].size + (infra(code).terminal || 0));
  // Small airfields without an IATA code get fewer passengers until they grow a terminal.
  // Every terminal expansion the player builds draws more passengers.
  const attraction = (code) => (airportByCode[code].minor && airportSize(code) < 2 ? A.minorFactor : 1) *
    (1 + A.terminalDemand * (infra(code).terminal || 0));
  const airportRunways = (code) => infra(code).runways || D.runways[code] || [];
  // Point m metres from lat/lon along a bearing (flat earth is fine at airport scale).
  function offsetPoint(lat, lon, bearingDeg, m) {
    const b = toRad(bearingDeg);
    return [lat + (m * Math.cos(b)) / 111320, lon + (m * Math.sin(b)) / (111320 * Math.cos(toRad(lat)))];
  }
  const runwayLength = (r) => distanceKm({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] }) * 1000;
  // Airports without runway data get a typical length for their size.
  const RUNWAY_BY_SIZE = [0, 900, 1800, 2500, 3200, 3800];
  function longestRunway(code, pavedOnly) {
    const rws = airportRunways(code);
    if (!rws.length) return RUNWAY_BY_SIZE[airportSize(code)];
    return Math.round(Math.max(0, ...rws.filter((r) => !pavedOnly || r[5]).map(runwayLength)));
  }
  // Runway an aircraft type needs (m) and whether it needs a paved one.
  function runwayNeed(type) {
    const ac = D.aircraft[type];
    if (ac.runwayM) return { m: ac.runwayM, paved: ac.category !== 'turboprop' && ac.category !== 'classic' };
    const min = ac.minAirport || 1;
    const m = {
      turboprop: ac.seats <= 19 ? 500 : ac.seats <= 50 ? 1000 : 1200,
      regional: 1400,
      narrowbody: 1600 + (min - 1) * 200,
      widebody: 2100 + (min - 1) * 200,
    }[ac.category] || 1500;
    return { m, paved: ac.category !== 'turboprop' };
  }

  const ticketPrice = (d) => Math.round(C.ticket.base + C.ticket.perKm * d); // standard fare
  const routeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`); // same for both directions
  // First moment at or after `after` (absolute minutes) that is `tod` minutes past midnight.
  const nextAt = (tod, after) => after + ((((tod - (after % DAY)) % DAY) + DAY) % DAY);
  const blockMinutes = (type, d) => Math.round((d / D.aircraft[type].speedKmh) * 60 + C.taxiMin);
  const landingFee = (code) => C.landingFee.base + C.landingFee.perSize * airportSize(code);
  const slotUpfront = (code) => C.slot.upfront[airportSize(code)];
  const slotWeekly = (code) => C.slot.weekly[airportSize(code)];

  function flightCost(type, d, to, pax, costMult = 1) {
    const block = blockMinutes(type, d);
    return Math.round((block / 60) * D.aircraft[type].costPerBlockHour * costMult + landingFee(to) + pax * C.paxFee);
  }

  // ---------- flight tracks: runways, turns, climb and descent ----------
  // Only for showing flights: planes take off into the wind, turn onto the great circle, cruise
  // at a typical flight level for their type and join a straight-in final to the landing runway.
  // The simulation itself still only uses the departure and arrival times.
  const TAXI_OUT = 10;   // minutes of the block time spent taxiing to the runway
  const TAXI_IN = 5;
  const PUSHBACK = 2;    // of TAXI_OUT: pushed back from the gate, tail first
  const DOCK = 1.5;      // of TAXI_IN: turning onto the stand and pulling up to the gate
  const ROLL_OUT = 0.7;  // takeoff roll, minutes
  const ROLL_IN = 0.9;   // landing roll
  const FINAL_KM = 15;   // final approach fix before the threshold (~2700 ft on a 3° glide)
  const DESCENT_KM_PER_KFT = 5.6; // 3° descent path
  const CRUISE_FT = { JU52: 6000, 'DC-3': 9000, CONCORDE: 58000, 'DHC6-400': 10000, DO228NG: 12000 };

  function cruiseFt(type) {
    const ac = D.aircraft[type];
    return ac.cruiseFt || CRUISE_FT[type] ||
      { turboprop: ac.seats <= 19 ? 14000 : 25000, regional: 36000, narrowbody: 37000, widebody: 39000 }[ac.category] || 30000;
  }

  // Small deterministic hash -> [0, 1).
  function hash01(...xs) {
    let h = 2166136261;
    for (const x of xs) h = Math.imul(h ^ (x | 0), 16777619) ^ (h >>> 13);
    return ((h >>> 0) % 100000) / 100000;
  }

  // Wind direction (where it blows from) for a region and day: mostly westerly, sometimes east.
  // Neighbouring airports share it, so they use the same runway direction.
  function windFrom(lat, lon, day) {
    const cell = [Math.floor(lat / 4), Math.floor(lon / 4), day];
    const r = hash01(...cell, 1);
    const easterly = hash01(...cell, 2) < 0.2;
    return ((easterly ? 70 : 250) + (r - 0.5) * 120 + 360) % 360;
  }

  // Runway end to use at an airport: into the wind, long enough for the type if possible.
  function pickRunway(code, day, needM) {
    const a = airportByCode[code];
    const wind = windFrom(a.lat, a.lon, day);
    const ends = [];
    for (const r of airportRunways(code)) {
      const len = runwayLength(r);
      const h = bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] });
      ends.push({ thr: [r[0], r[1]], end: [r[2], r[3]], hdg: h, len });
      ends.push({ thr: [r[2], r[3]], end: [r[0], r[1]], hdg: (h + 180) % 360, len });
    }
    if (!ends.length) { // no data: an imaginary 2.5 km runway into the wind
      const t = offsetPoint(a.lat, a.lon, wind + 180, 1250);
      const e = offsetPoint(a.lat, a.lon, wind, 1250);
      return { thr: t, end: e, hdg: wind, len: 2500 };
    }
    const long = ends.filter((e) => e.len >= needM);
    const pool = long.length ? long : ends;
    const off = (e) => Math.abs(((e.hdg - wind + 540) % 360) - 180);
    // Within 20° the longer runway wins.
    return pool.reduce((best, e) => (off(e) < off(best) - 20 || (off(e) < off(best) + 20 && e.len > best.len) ? e : best));
  }

  // Turn from pos/heading with radius r (m) towards target until pointing at it. Returns arc points.
  function turnToward(pos, hdg, target, r) {
    const pts = [];
    let p = pos;
    let h = hdg;
    for (let i = 0; i < 40; i++) {
      const diff = ((bearing({ lat: p[0], lon: p[1] }, target) - h + 540) % 360) - 180;
      if (Math.abs(diff) < 4) break;
      const step = Math.sign(diff) * Math.min(10, Math.abs(diff));
      p = offsetPoint(p[0], p[1], h + step / 2, 2 * r * Math.sin(toRad(Math.abs(step)) / 2));
      h += step;
      pts.push(p);
    }
    return pts;
  }

  // ---------- taxiways ----------
  // Every runway has a parallel taxiway on the apron's side, joined to it at both ends and (long runways by
  // fast exits at 30°) where landing planes leave it, and to the apron taxi lane at the apron's exits. Planes
  // taxi along these, and the maps draw them (taxiwaysOf).
  // A point relative to a runway { thr, hdg }: metres along it from the threshold and across (+ = right).
  function rwyCoords(rwy, p) {
    const kx = 111320 * Math.cos(toRad(rwy.thr[0]));
    const ux = Math.sin(toRad(rwy.hdg));
    const uy = Math.cos(toRad(rwy.hdg));
    const vx = (p[1] - rwy.thr[1]) * kx;
    const vy = (p[0] - rwy.thr[0]) * 111320;
    return { along: vx * ux + vy * uy, across: vx * uy - vy * ux };
  }
  function rwyPoint(rwy, along, across) {
    const kx = 111320 * Math.cos(toRad(rwy.thr[0]));
    const ux = Math.sin(toRad(rwy.hdg));
    const uy = Math.cos(toRad(rwy.hdg));
    return [rwy.thr[0] + (along * uy - across * ux) / 111320, rwy.thr[1] + (along * ux + across * uy) / kx];
  }
  // How far along a runway its fast exit runs before it meets the parallel taxiway `off` metres away: runways
  // from 1800 m have exits at 30° to them where landing planes leave, shorter ones are left at a right angle.
  const exitRun = (len, off) => (len >= 1800 ? Math.abs(off) / Math.tan(toRad(30)) : 0);
  // Signed distance of a runway's parallel taxiway from its centre line.
  function taxiwayOffset(rwy, ref) {
    const across = rwyCoords(rwy, ref).across;
    return (across < 0 ? -1 : 1) * Math.min(180, Math.max(120, Math.abs(across) * 0.6));
  }
  // The way between a point on the apron taxi lane and the runway point `alongM` metres from the threshold:
  // [(the way along the apron's lanes to) the apron exit, foot of its link on the parallel taxiway, point on
  // the taxiway abeam the runway point].
  function taxiPath(code, rwy, lanePt, alongM) {
    const ap = apronOf(code);
    if (ap.real) return realTaxiPath(code, ap.real, lanePt, rwyPoint(rwy, alongM, 0));
    const far = (e) => distanceKm({ lat: e[0], lon: e[1] }, { lat: lanePt[0], lon: lanePt[1] });
    const inside = (ap.way && ap.way(lanePt)) || [ap.exits.reduce((b, e) => (far(e) < far(b) ? e : b))];
    const exit = inside[inside.length - 1];
    const off = taxiwayOffset(rwy, ap.ref);
    const a = Math.min(rwy.len, Math.max(0, rwyCoords(rwy, exit).along));
    // (a landing plane leaves a long runway by its fast exit, which meets the taxiway further on)
    const run = alongM > 0 ? exitRun(rwy.len, off) : 0;
    return [...inside, rwyPoint(rwy, a, off), rwyPoint(rwy, Math.min(rwy.len, alongM + run), off)];
  }
  // All taxiway centre lines of an airport, for drawing: [[lat, lon], [lat, lon]] each.
  function taxiwaysOf(code) {
    const ap = apronOf(code);
    if (ap.real) return ap.real.taxiways.flatMap((l) => l.slice(1).map((p, i) => [l[i], p]));
    const lines = [...(ap.lanes || [ap.lane])];
    for (const r of airportRunways(code)) {
      const len = runwayLength(r);
      const rwy = { thr: [r[0], r[1]], hdg: bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] }), len };
      const off = taxiwayOffset(rwy, ap.ref);
      lines.push([rwyPoint(rwy, 0, off), rwyPoint(rwy, len, off)]);
      const leave = Math.min(len * 0.65, 2200); // where a landing plane leaves the runway, from either end
      const run = exitRun(len, off);
      for (const a of [0, len]) lines.push([rwyPoint(rwy, a, off), rwyPoint(rwy, a, 0)]);
      lines.push([rwyPoint(rwy, leave, 0), rwyPoint(rwy, Math.min(len, leave + run), off)], [rwyPoint(rwy, len - leave, 0), rwyPoint(rwy, Math.max(0, len - leave - run), off)]);
      for (const e of ap.exits) {
        lines.push([e, rwyPoint(rwy, Math.min(len, Math.max(0, rwyCoords(rwy, e).along)), off)]);
      }
    }
    return lines;
  }

  // ---------- gates ----------
  // Every airport has an apron beside its longest runway, on the side of the airport reference point if
  // nothing is in the way there (apronPlace looks for a place clear of the other runways and, where they
  // are known, of real taxiways and buildings). Up to size 2 it is one row (linear terminal): contact gates
  // with jet bridges in front of the terminal, remote stands beyond both ends. From size 3 the gates stand
  // on both sides of piers, with rows of remote stands beside them, so the apron stays about a kilometre
  // wide. An airport can also be given a satellite terminal, and a terminal the player builds is the copy
  // of a real one (copiedApron). Bigger airports (including the player's terminal expansions) have more and
  // wider gates. Planes park nose-in and are pushed back tail first onto the apron taxi lane.
  const GATE_COUNT = [2, 3, 6, 12, 20, 32];      // contact gates by airport size 0..5
  const GATE_SPACING = [42, 45, 55, 65, 75, 80]; // m between stands by size
  const TAXI_LANE = 70;  // m from a stand back to the apron taxi lane (= pushback distance)
  const apronCache = new Map();

  // Where to put an apron: beside the main runway on the airport reference point's side if nothing is in the
  // way there, else further along, further out or on the other side. In the way are the other runways and,
  // where they are known (FG.obstacles: read off the 3D map), real taxiways and buildings. The apron reaches
  // `reach` metres along the runway to both sides and `depth` metres away from it. Returns the runway, the
  // side (+1 = right of it), and where the apron's runway-side edge begins: metres along and from the runway.
  function apronPlace(code, rws, reach, depth) {
    const a = airportByCode[code];
    const r = rws.reduce((x, y) => (runwayLength(y) > runwayLength(x) ? y : x));
    const main = { thr: [r[0], r[1]], hdg: bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] }), len: runwayLength(r) };
    const refC = rwyCoords(main, [a.lat, a.lon]);
    const known = (FG.obstacles && FG.obstacles[code]) || { lines: [], rings: [] };
    const C = (p) => rwyCoords(main, p);
    const segs = [
      ...rws.filter((x) => x !== r).map((x) => [C([x[0], x[1]]), C([x[2], x[3]]), 110]),
      ...neighbours(code, 8).flatMap((b) => airportRunways(b.code)).map((x) => [C([x[0], x[1]]), C([x[2], x[3]]), 110]),
      ...known.lines.map(([p, q]) => [C(p), C(q), 18]),
    ];
    const pts = known.rings.flat().map(C);
    // Does the segment p-q (runway coordinates) come within `m` of the rectangle?
    const hits = (p, q, m, x0, x1, y0, y1) => {
      let t0 = 0;
      let t1 = 1;
      const dx = q.along - p.along;
      const dy = q.across - p.across;
      for (const [d, lo, hi, v] of [[dx, x0 - m, x1 + m, p.along], [dy, y0 - m, y1 + m, p.across]]) {
        if (Math.abs(d) < 1e-9) { if (v < lo || v > hi) return false; continue; }
        const ta = (lo - v) / d;
        const tb = (hi - v) / d;
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
        if (t0 > t1) return false;
      }
      return true;
    };
    let best = null;
    const side0 = refC.across < 0 ? -1 : 1;
    search:
    for (const sd of [side0, -side0]) {
      for (const edge of [155, 325, 525, 785]) {
        for (const shift of [0, 250, -250, 500, -500, 800, -800, 1200, -1200, 1700, -1700]) {
          const along = Math.min(main.len + 300, Math.max(-300, refC.along)) + shift;
          // the apron's rectangle in runway coordinates
          const x0 = along - reach;
          const x1 = along + reach;
          const ya = sd * edge;
          const yb = sd * (edge + depth);
          const y0 = Math.min(ya, yb);
          const y1 = Math.max(ya, yb);
          let bad = 0;
          for (const [p, q, m] of segs) if (hits(p, q, m, x0, x1, y0, y1)) bad++;
          for (const p of pts) if (p.along > x0 && p.along < x1 && p.across > y0 && p.across < y1) bad++;
          if (known.reach) { // not where the surroundings are not known
            const far = Math.max(Math.abs(x0 - refC.along), Math.abs(x1 - refC.along), Math.abs(y0 - refC.across), Math.abs(y1 - refC.across));
            if (far > known.reach) bad++;
          }
          if (!best || bad < best.bad) best = { bad, side: sd, edge, along };
          if (!bad) break search;
        }
      }
    }
    return { main, side: best.side, along: best.along, edge: best.edge };
  }

  // The other airports within `km` (an airfield next to a big airport must keep its apron off the other's runways).
  const nearGrid = { n: -1, cells: new Map() };
  function neighbours(code, km) {
    const all = D.airports;
    if (nearGrid.n !== all.length) { // (again when the player builds an airport)
      nearGrid.n = all.length;
      nearGrid.cells.clear();
      for (const x of all) {
        const k = `${Math.floor(x.lat * 10)}|${Math.floor(x.lon * 10)}`;
        if (!nearGrid.cells.has(k)) nearGrid.cells.set(k, []);
        nearGrid.cells.get(k).push(x);
      }
    }
    const a = airportByCode[code];
    const out = [];
    const dj = Math.ceil(km / (11.1 * Math.max(0.1, Math.cos(toRad(a.lat)))));
    const di = Math.ceil(km / 11.1);
    for (let i = -di; i <= di; i++) {
      for (let j = -dj; j <= dj; j++) {
        for (const b of nearGrid.cells.get(`${Math.floor(a.lat * 10) + i}|${Math.floor(a.lon * 10) + j}`) || []) {
          if (b.code !== code && !b.factory && distanceKm(a, b) < km) out.push(b);
        }
      }
    }
    return out;
  }

  // `sizeAs`: lay the airport out as if it had this size (for the expansion preview).
  function apronOf(code, sizeAs) {
    const size = Math.max(0, Math.min(5, sizeAs == null ? airportSize(code) : sizeAs));
    const rws = airportRunways(code);
    const real = FG.layouts ? FG.layouts.get(code) : null;
    // A terminal the player built is the copy of a real one, once that one's layout is there.
    const tpl = real || !rws.length ? null : copyTemplate(code, size);
    const from = tpl && FG.layouts ? FG.layouts.get(tpl[0]) : null;
    // (an airport fix changes its layout and runways: js/fixes.js)
    const key = `${code}|${size}|${rws.length}|${real ? 1 : 0}${FG.obstacles && FG.obstacles[code] ? 2 : 0}${infra(code).style || ''}${from ? tpl : ''}|${FG.fixes ? FG.fixes.rev(code) : 0}`;
    let ap = apronCache.get(key);
    if (ap) return ap;
    if (real || from) ap = real ? realApron(code, size, real) : copiedApron(code, size, tpl, from, rws);
    if (ap) {
      apronCache.set(key, ap);
      return ap;
    }
    const a = airportByCode[code];
    const n = GATE_COUNT[size];
    const sp = GATE_SPACING[size];
    const stop = Math.round(sp * 0.4); // nose stop bar ahead of the stand point
    const front = stop + 12;           // terminal face ahead of the stand point
    // The three common terminal concepts. 'linear': the gates in one row along a concourse (small airports).
    // 'pier': on both sides of piers that point away from the runway, with as many rows of remote stands
    // beside them: that keeps even a hub's apron about a kilometre wide instead of several (from size 3).
    // 'satellite': most gates round a building that stands free on the apron, taxi lanes all round it; only
    // where an airport is given this concept (infra.style, which can also ask for one of the other two).
    let style = infra(code).style;
    if (style !== 'linear' && style !== 'pier' && style !== 'satellite') style = size >= 3 ? 'pier' : 'linear';
    if (style === 'satellite' && n < 6) style = 'linear'; // too few gates for a building of their own
    if (style === 'linear' && n > 20) style = 'pier';     // one row would be more than 2.5 km long
    const piers = style !== 'pier' ? 0 : size >= 4 ? 2 : 1;
    const perSide = piers ? Math.ceil(n / (2 * piers)) : 0;
    const pierHalf = 11;
    const pitch = 2 * (pierHalf + front + TAXI_LANE);     // from one pier to the next
    const o0 = -TAXI_LANE + 40;                           // the first stand of a pier starts here
    const root = o0 + sp * perSide + 12;                  // landside end of the piers
    const centres = piers === 1 ? [0, pitch] : [-1.5 * pitch, -0.5 * pitch, 0.5 * pitch, 1.5 * pitch];
    const withGates = piers === 1 ? [true, false] : [false, true, true, false];
    // Satellites: rows of stands along the runway, one on each side of every satellite and one at the main
    // terminal, each with its gates in the middle and remote stands beyond them.
    const sats = style !== 'satellite' ? 0 : size >= 5 ? 2 : 1;
    const rows = 2 * sats + 1;
    const mainN = sats ? Math.max(2, Math.round(n / (rows + 1))) : n; // gates at the main terminal
    const satN = sats ? Math.ceil((n - mainN) / (2 * sats)) : 0;      // gates on each side of a satellite
    const perRow = Math.ceil((2 * n) / rows);                         // stands in a row
    const satD = 26;                                                  // depth of a satellite
    const period = 2 * (front + TAXI_LANE) + satD;                    // from one row's taxi lane to the next
    const m = sats * period;                              // the main terminal's stands are this far out
    const cross = (sp * (perRow + 1)) / 2 + 40;           // the lanes round the ends of the satellites
    const half = (mainN * sp) / 2;                        // (one row) half length of the terminal's gates
    // A long linear terminal has its remote stands across the taxi lane, facing it, with gaps for the exits.
    const opposite = style === 'linear' && n > 6;
    const gap = Math.round(0.6 * half);
    const across = [];
    if (opposite) {
      for (let x = 25 + sp / 2; across.length < Math.ceil(n / 2); x += sp) {
        if (Math.abs(x - gap) < sp / 2 + 25) x = gap + sp / 2 + 25;
        across.push(x);
      }
    }
    const reach = piers ? Math.max(...centres.map(Math.abs)) + pitch / 2 + 20
      : sats ? cross + 40
        : opposite ? Math.max(half, across[across.length - 1] + sp / 2) + 15 : half + sp * Math.ceil(n / 2) + 10;
    const W = piers ? (piers - 1) * pitch + 2 * pierHalf + 70 : 2 * half + 10;   // width of the terminal
    const concD = 14 + 2 * size;          // depth of the one-row concourse
    const concH = 7 + size;
    const face = m + front;               // (one row, satellite) airside face of the main terminal
    const near = opposite ? -2 * TAXI_LANE - front - 12 : -TAXI_LANE - 25; // runway-side edge of the apron
    const back = piers ? root + 8 : face + concD;         // where the hall begins
    const deepest = back + (22 + 8 * size) * 2 + 80;      // landside end of everything

    // Where it goes (apronPlace); the stands' frame starts `-near` metres behind the apron's runway-side edge.
    let hdg = 0;
    let side = 1;
    let base = [a.lat, a.lon];
    if (rws.length) {
      // (the hangars and the cargo shed stand beyond the apron's ends: they must be clear of the runways too)
      const ends = size >= 3 ? 45 + 75 * Math.ceil((size - 1) / 2) + 75 : size >= 2 ? 75 : 0;
      const place = apronPlace(code, rws, reach + ends, deepest - near);
      hdg = place.main.hdg;
      side = place.side;
      base = rwyPoint(place.main, place.along, place.side * (place.edge - near));
    }
    const nose = (hdg + 90 * side + 360) % 360;
    // metres along the runway direction / out away from the runway -> [lat, lon]
    const at = (along, out) => {
      const p = offsetPoint(base[0], base[1], hdg, along);
      return offsetPoint(p[0], p[1], nose, out);
    };
    const box = (a0, a1, o0b, o1, h, kind, baseH = 0) => ({ ring: [at(a0, o0b), at(a1, o0b), at(a1, o1), at(a0, o1)], base: baseH, h, kind });
    const bridgeParts = []; // jet bridge pieces above the apron, as buildings
    const markings = [];    // paint on the apron: { line, kind: 'y' yellow or 'w' white }
    // A stand at (along, out) in the frame; dir: 0 = nose away from the runway, 2 = towards it,
    // +1 / -1 = nose along it.
    const stand = (along, out, dir, name, bridge) => {
      const [lat, lon] = at(along, out);
      const heading = dir === 0 ? nose : dir === 2 ? (nose + 180) % 360 : (hdg + (dir > 0 ? 0 : 180)) % 360;
      // f metres ahead of the stand point, l metres to the aircraft's left
      const L = (f, l) => { const q = offsetPoint(lat, lon, heading, f); return offsetPoint(q[0], q[1], heading - 90, l); };
      const s = { lat, lon, heading, name, bridge, along, lead: [L(-TAXI_LANE, 0), L(stop, 0)], stopBar: [L(stop, -4), L(stop, 4)] };
      // lead-in curves from the taxi lane onto the stand centre line, the limits of the stand, the road
      const turn = Math.min(30, sp * 0.42);
      for (const d of [-1, 1]) {
        const arc = [];
        for (let i = 0; i <= 12; i++) { const t = (i / 12) * Math.PI / 2; arc.push(L(-TAXI_LANE + turn * (1 - Math.cos(t)), d * turn * (1 - Math.sin(t)))); }
        markings.push({ line: arc, kind: 'y' }, { line: [L(-TAXI_LANE + 28, d * sp / 2), L(stop + 3, d * sp / 2)], kind: 'w' });
      }
      markings.push({ line: [L(stop + 4, -sp / 2), L(stop + 4, sp / 2)], kind: 'w' });
      if (bridge) {
        // Jet bridge to the front left door: a short link out of the terminal to a rotunda, from there the
        // tunnel runs at an angle to the cab at the door; a wheeled support carries it.
        const r = [front - 3, 13];
        const c = [stop - 6, 4.6];
        const len = Math.hypot(c[0] - r[0], c[1] - r[1]);
        const nf = -(c[1] - r[1]) / len * 1.3;
        const nl = (c[0] - r[0]) / len * 1.3;
        s.bridgePoly = [L(r[0] + nf, r[1] + nl), L(c[0] + nf, c[1] + nl), L(c[0] - nf, c[1] - nl), L(r[0] - nf, r[1] - nl)];
        const round = [];
        for (let i = 0; i < 8; i++) round.push(L(r[0] + 2.6 * Math.cos(i * Math.PI / 4), r[1] + 2.6 * Math.sin(i * Math.PI / 4)));
        const sq = (p, h) => [L(p[0] - h, p[1] - h), L(p[0] + h, p[1] - h), L(p[0] + h, p[1] + h), L(p[0] - h, p[1] + h)];
        const leg = [r[0] + (c[0] - r[0]) * 0.7, r[1] + (c[1] - r[1]) * 0.7];
        bridgeParts.push(
          { ring: [L(front - 3, 11.6), L(front - 3, 14.4), L(front, 14.4), L(front, 11.6)], base: 3.5, h: 6.5, kind: 'bridge' },
          { ring: round, base: 0, h: 7, kind: 'bridge' },
          { ring: sq(c, 1.9), base: 3.3, h: 6.8, kind: 'bridge' },
          { ring: sq(leg, 0.9), base: 0, h: 3.5, kind: 'bridge' },
        );
      }
      return s;
    };
    const contact = [];
    const remote = [];
    const lanes = [];      // apron taxi lanes, as lines
    const exits = [];      // where taxiways leave the apron
    const buildings = [];
    const layout = size >= 2 ? Math.floor(hash01(code.charCodeAt(0), code.charCodeAt(1) || 0, code.charCodeAt(2) || 0, 7) * 5) : 0;
    let terminal;
    let way = null;        // (satellite) the way along the taxi lanes from a point on one to an exit
    if (!piers) {
      for (let i = 0; i < mainN; i++) contact.push(stand((i - (mainN - 1) / 2) * sp, m, 0, `A${i + 1}`, true));
      // remote stands beyond both ends of a row of `have` gates
      const beside = (have, count, out, dir) => {
        for (let j = 0; j < count && remote.length < n; j++) {
          remote.push(stand((j % 2 ? 1 : -1) * ((have * sp) / 2 + sp * (Math.floor(j / 2) + 0.5)), out, dir, `R${remote.length + 1}`, false));
        }
      };
      if (sats) {
        beside(mainN, perRow - mainN, m, 0);
        const sh = (satN * sp) / 2 + 6; // half length of a satellite
        const cut = 8;
        for (let j = sats - 1; j >= 0; j--) { // the satellite nearest the terminal first
          const a0 = j * period + front;
          const a1 = a0 + satD;
          [[a1 + front, 2], [a0 - front, 0]].forEach(([out, dir], k) => {
            for (let i = 0; i < satN; i++) { // a gate too many for the airport's size is a stand without a bridge
              const x = (i - (satN - 1) / 2) * sp;
              if (contact.length < n) contact.push(stand(x, out, dir, `${'BCDE'[2 * (sats - 1 - j) + k]}${i + 1}`, true));
              else if (remote.length < n) remote.push(stand(x, out, dir, `R${remote.length + 1}`, false));
            }
            beside(satN, perRow - satN, out, dir);
          });
          buildings.push(
            { ring: [at(-sh + cut, a0), at(sh - cut, a0), at(sh, a0 + cut), at(sh, a1 - cut), at(sh - cut, a1), at(-sh + cut, a1), at(-sh, a1 - cut), at(-sh, a0 + cut)], base: 0, h: concH, kind: 'terminal' },
            box(-sh + cut, sh - cut, a0 - 0.6, a0, concH - 1.5, 'glass', 2), box(-sh + cut, sh - cut, a1, a1 + 0.6, concH - 1.5, 'glass', 2),
            // the middle, above the station of the train from the terminal, is a storey higher
            box(-20, 20, a0 + 3, a1 - 3, concH + 4.5, 'roof', concH), box(-14, 14, a0 + 7, a1 - 7, concH + 6, 'roof', concH + 4.5),
          );
          for (let x = 55; x < sh - 20; x += 70) for (const s of [-1, 1]) buildings.push(box(s * x - 4, s * x + 4, a0 + 8, a1 - 8, concH + 2, 'plant', concH));
        }
        for (const x of [-cross, cross]) lanes.push([at(x, -TAXI_LANE), at(x, m - TAXI_LANE)]);
        for (let j = sats; j >= 0; j--) lanes.push([at(-cross, j * period - TAXI_LANE), at(cross, j * period - TAXI_LANE)]);
        exits.push(at(-cross, -TAXI_LANE), at(0, -TAXI_LANE), at(cross, -TAXI_LANE));
        // From a lane behind a satellite: along it to the nearer end, round the satellite to the runway side.
        way = (pt) => {
          const c = rwyCoords({ thr: base, hdg }, pt);
          const out = c.across * side;
          if (out < -TAXI_LANE + 30) return null;
          const x = c.along < 0 ? -cross : cross;
          return [at(x, out), at(x, -TAXI_LANE)];
        };
      } else if (opposite) {
        for (const x of across) for (const s of [-1, 1]) if (remote.length < n) remote.push(stand(s * x, -2 * TAXI_LANE, 2, `R${remote.length + 1}`, false));
        lanes.push([at(-reach + 15, -TAXI_LANE), at(reach - 15, -TAXI_LANE)]);
        exits.push(at(-gap, -TAXI_LANE), at(0, -TAXI_LANE), at(gap, -TAXI_LANE));
      } else {
        beside(n, n, 0, 0);
        lanes.push([at(-reach + 15, -TAXI_LANE), at(reach - 15, -TAXI_LANE)]);
        exits.push(at(0, -TAXI_LANE));
      }
      contact.sort((x, y) => Math.abs(x.along) - Math.abs(y.along)); // used from the middle outwards
      const cut = Math.min(6, W / 8); // the concourse's airside corners are cut off
      terminal = [at(-W / 2, face), at(W / 2, face), at(W / 2, back), at(-W / 2, back)];
      buildings.push(
        { ring: [at(-W / 2 + cut, face), at(W / 2 - cut, face), at(W / 2, face + cut), at(W / 2, back), at(-W / 2, back), at(-W / 2, face + cut)], base: 0, h: concH, kind: 'terminal' },
        box(-W / 2 + cut, W / 2 - cut, face - 0.6, face, concH - 1.5, 'glass', 2),
      );
      for (let x = -W / 2 + 30; x < W / 2 - 20; x += 60) buildings.push(box(x - 4, x + 4, face + concD * 0.4, face + concD * 0.7, concH + 2, 'plant', concH));
    } else {
      centres.forEach((c, i) => {
        for (let k = perSide - 1; k >= 0; k--) { // used from the hall outwards
          for (const s of [-1, 1]) {
            const list = withGates[i] ? contact : remote;
            if (list.length >= n) continue;
            list.push(stand(c + s * (pierHalf + front), o0 + sp * (k + 0.5), -s, `${withGates[i] ? 'A' : 'R'}${list.length + 1}`, withGates[i]));
          }
        }
        if (!withGates[i]) return;
        buildings.push(box(c - pierHalf, c + pierHalf, o0 - 14, root, concH, 'terminal'),
          box(c - pierHalf - 0.6, c - pierHalf, o0 - 8, root, concH - 1.5, 'glass', 2), box(c + pierHalf, c + pierHalf + 0.6, o0 - 8, root, concH - 1.5, 'glass', 2));
        for (let o = o0 + 30; o < root - 20; o += 70) buildings.push(box(c - 4, c + 4, o, o + 9, concH + 2, 'plant', concH));
        if (!terminal) terminal = [at(c - pierHalf, o0 - 14), at(c + pierHalf, o0 - 14), at(c + pierHalf, root), at(c - pierHalf, root)];
      });
      const mouths = [...new Set(centres.flatMap((c) => [c - pitch / 2, c + pitch / 2]).map((x) => Math.round(x)))].sort((x, y) => x - y);
      for (const x of mouths) { lanes.push([at(x, -TAXI_LANE), at(x, root - 20)]); exits.push(at(x, -TAXI_LANE)); }
      lanes.push([at(mouths[0] - 20, -TAXI_LANE), at(mouths[mouths.length - 1] + 20, -TAXI_LANE)]);
      buildings.push(box(-W / 2, W / 2, root, root + 8, concH + 2, 'terminal')); // joins the piers to the hall
    }
    const stands = [...contact, ...remote];
    // A hall with a roof that rises in two steps towards its ridge, a canopy and the road in front of it.
    const hallD = 22 + 8 * size;
    const hallH = 12 + 3 * size;
    const hall = (a0, a1, deep = hallD, h = hallH) => {
      const o1 = back + deep;
      buildings.push(box(a0, a1, back, o1, h, 'hall'));
      buildings.push(box(a0 + 2, a1 - 2, back + deep * 0.15, back + deep * 0.85, h + 2.2, 'roof', h));
      buildings.push(box(a0 + 4, a1 - 4, back + deep * 0.32, back + deep * 0.68, h + 3.8, 'roof', h + 2.2));
      buildings.push(box(a0, a1, o1 - 0.6, o1, h - 2, 'glass', 2));
      if (size >= 2) {
        buildings.push(box(a0 + 3, a1 - 3, o1, o1 + 9, 6, 'canopy', 5.2));
        buildings.push(box(a0 - 25, a1 + 25, o1 + 1, o1 + 10, 0.15, 'road'));
      }
      return o1;
    };
    let landside = back;
    if (size === 0) landside = back;
    else if (layout === 0) landside = hall(-0.32 * W, 0.32 * W);
    else if (layout === 1) landside = hall(-0.48 * W, 0.08 * W);
    else if (layout === 2) { // two halls with a lower link between them
      landside = Math.max(hall(-0.46 * W, -0.1 * W), hall(0.1 * W, 0.46 * W));
      buildings.push(box(-0.1 * W, 0.1 * W, back, back + hallD * 0.45, hallH - 4, 'terminal'));
    } else if (layout === 3) landside = hall(-0.14 * W, 0.14 * W, hallD * 1.9); // deep and narrow
    else { // the hall bulges out landside in a curve
      const curve = [];
      for (let i = 0; i <= 8; i++) { const t = -1 + i / 4; curve.push(at(t * 0.36 * W, back + hallD * (0.55 + 0.6 * Math.sqrt(1 - t * t)))); }
      buildings.push({ ring: [at(-0.36 * W, back), at(0.36 * W, back), ...curve.reverse()], base: 0, h: hallH, kind: 'hall' });
      const top = [];
      for (let i = 0; i <= 8; i++) { const t = -1 + i / 4; top.push(at(t * 0.3 * W, back + hallD * (0.5 + 0.45 * Math.sqrt(1 - t * t)))); }
      buildings.push({ ring: [at(-0.3 * W, back + 4), at(0.3 * W, back + 4), ...top.reverse()], base: hallH, h: hallH + 3, kind: 'roof' });
      landside = back + hallD * 1.15;
      if (size >= 2) buildings.push(box(-0.36 * W - 25, 0.36 * W + 25, landside + 2, landside + 11, 0.15, 'road'));
    }
    if (size >= 3) { // multi-storey car park across the road: its decks show as stripes
      const p0 = landside + 22;
      const px = layout % 2 ? -0.3 * W : 0.05 * W;
      const decks = 2 + size;
      for (let d = 0; d < decks; d++) buildings.push(box(px, px + Math.min(0.3 * W, 110), p0, p0 + 42, d * 3 + 1.2, 'carpark', d * 3));
    }
    if (size >= 1) { // control tower beside one end of the terminal: taller and wider with every tier
      const tw = 5 + size;
      const th = [0, 14, 20, 30, 42, 55][size];
      const tx = -(W / 2 + 30);
      const ty = back + 15 + tw / 2;
      const sq = (halfW, h, kind, base) => box(tx - halfW, tx + halfW, ty - halfW, ty + halfW, h, kind, base);
      buildings.push(sq(tw / 2 + 2.5, th * 0.22, 'tower', 0), sq(tw / 2, th, 'tower', th * 0.22), sq(tw / 2 + 2.2, th + 4.5, 'cab', th),
        sq(tw / 2 + 1.2, th + 5.3, 'roof', th + 4.5), sq(0.4, th + 11, 'mast', th + 5.3));
    }
    for (let k = 0; k < size - 1; k++) { // hangars beyond the remote stands, with a ridge and a low annex
      const x = (k % 2 ? 1 : -1) * (reach + 45 + 75 * Math.floor(k / 2));
      buildings.push(box(x - 30, x + 30, face + 5, face + 50, 13, 'hangar'), box(x - 30, x + 30, face + 20, face + 35, 16, 'roof', 13),
        box(x - 30, x + 30, face + 50, face + 62, 6, 'hangar'));
    }
    if (size >= 3) { // cargo shed behind the hangars on one side
      const x = -(reach + 45 + 75 * Math.ceil((size - 1) / 2) + 20);
      buildings.push(box(x - 55, x + 35, face + 8, face + 44, 9, 'hangar'), box(x - 55, x + 35, face + 8, face + 44, 9.6, 'roof', 9));
    }
    buildings.push(...bridgeParts);
    // The apron taxi lanes the lead-in curves branch off from.
    for (const l of lanes) markings.push({ line: l, kind: 'y' });
    ap = {
      code, hdg, side, nose, spacing: sp, gates: contact, stands, buildings, markings, terminal,
      apron: [at(-reach, near), at(reach, near), at(reach, piers ? root : face), at(-reach, piers ? root : face)],
      // The apron taxi lanes (last the one along the runway side), its middle, and where taxiways leave it.
      lane: lanes[lanes.length - 1], lanes,
      ref: at(0, near + 25), exits, way, style,
    };
    if (apronCache.size > 500) apronCache.clear();
    apronCache.set(key, ap);
    return ap;
  }

  // ---------- real airport layouts ----------
  // At airports with a layout from OpenStreetMap (js/layouts.js) the stands, buildings and taxiways are the
  // real ones: planes use the stands nearest the main terminal, as many as the airport's size gives gates,
  // and taxi along the real taxiways (shortest way through them).
  const metres = (p, q) => distanceKm({ lat: p[0], lon: p[1] }, { lat: q[0], lon: q[1] }) * 1000;
  // Metres from p to the segment a-b ([lat, lon] each) and the nearest point on it, on a local flat projection.
  function segMetres(p, a, b) {
    const kx = 111320 * Math.cos(toRad(p[0]));
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * 111320;
    const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * 111320;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const x = ax + t * dx, y = ay + t * dy;
    return { d: Math.hypot(x, y), pt: [p[0] + y / 111320, p[1] + x / kx] };
  }
  const middle = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  function realApron(code, size, lay) {
    const a = airportByCode[code];
    const spread = (ring) => { const m = middle(ring); return ring.reduce((s, p) => s + metres(p, m), 0); };
    const biggest = (rings) => rings.reduce((b, r) => (!b || spread(r) > spread(b) ? r : b), null);
    const square = (p, half) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => { const q = offsetPoint(p[0], p[1], 0, i * half); return offsetPoint(q[0], q[1], 90, j * half); });
    const mainTerminal = biggest(lay.terminals);
    const main = mainTerminal ? middle(mainTerminal) : [a.lat, a.lon];
    const walls = lay.terminals.flatMap((r) => r.map((q, i) => [q, r[(i + 1) % r.length]]));
    const toTerminal = (p) => walls.reduce((d, [w0, w1]) => Math.min(d, segMetres(p, w0, w1).d), Infinity); // to the nearest wall
    const stop = 14; // nose stop bar ahead of the stand point
    // Buildings the nose points at, and the taxiways the plane is pushed back onto.
    const bldPts = [...lay.terminals, ...lay.hangars].flat();
    const toBuilding = (p) => bldPts.reduce((d, q) => Math.min(d, metres(p, q)), Infinity);
    const toTaxiway = (p) => lay.taxiways.reduce((d, line) => {
      for (let k = 1; k < line.length; k++) d = Math.min(d, segMetres(p, line[k - 1], line[k]).d);
      return d;
    }, Infinity);
    // Nearest point on any taxiway centreline.
    const footOnTaxiway = (p) => {
      let best = { d: Infinity, pt: null };
      for (const line of lay.taxiways) {
        for (let k = 1; k < line.length; k++) { const r = segMetres(p, line[k - 1], line[k]); if (r.d < best.d) best = r; }
      }
      return best;
    };
    const angleDiff = (x, y) => Math.abs((((x - y) % 360) + 540) % 360 - 180);
    // As many stands as the airport's size gives gates, shared out among the terminals: each terminal's
    // stands nearest it first, taken in turn from each, the biggest terminal first (else planes parked at
    // the main terminal only and the others stood empty). Stands at no terminal come last.
    const wallsOf = lay.terminals.map((r) => r.map((q, i) => [q, r[(i + 1) % r.length]]));
    const byTerminal = lay.terminals.map((r, i) => ({ i, spread: spread(r), list: [] }));
    const loose = [];
    for (const s of lay.stands) {
      let best = null;
      wallsOf.forEach((ws, i) => {
        const d = ws.reduce((m, [w0, w1]) => Math.min(m, segMetres(s, w0, w1).d), Infinity);
        if (d < 120 && (!best || d < best.d)) best = { i, d };
      });
      if (best) byTerminal[best.i].list.push([s, best.d]); else loose.push([s, metres(s, main)]);
    }
    const order = [];
    const groups = byTerminal.filter((g) => g.list.length).sort((x, y) => y.spread - x.spread);
    for (const g of groups) g.list.sort((x, y) => x[1] - y[1]);
    for (let k = 0; groups.some((g) => k < g.list.length); k++) for (const g of groups) if (k < g.list.length) order.push(g.list[k][0]);
    order.push(...loose.sort((x, y) => x[1] - y[1]).map(([s]) => s));
    // Stands an airport fix added or moved (js/fixes.js: lay.pinned) are always used, on top of those.
    let room = 2 * GATE_COUNT[size];
    const stands = order.filter((st) => (lay.pinned && lay.pinned.has(st)) || room-- > 0)
      .map(([lat, lon, mapped, name, right, length], i) => {
        const aheadOf = (h) => (m, across = 0) => { const p = offsetPoint(lat, lon, h, m); return offsetPoint(p[0], p[1], h + 90, across); };
        // The mapped direction is often the wrong way round or missing. A plane is pushed back onto the
        // nearest taxiway, so its nose points away from it: keep the mapped line (either way round) when it
        // roughly agrees, else park straight out from the taxiway.
        let heading = mapped;
        const foot = footOnTaxiway([lat, lon]);
        if (right || (lay.source === 'tiles' && right == null)) { /* the reader already turned it the right way */ } else if (foot.pt && foot.d > 3) {
          const away = bearing({ lat: foot.pt[0], lon: foot.pt[1] }, { lat, lon });
          const flip = (mapped + 180) % 360;
          heading = angleDiff(mapped, away) <= angleDiff(flip, away) ? mapped : flip;
          if (angleDiff(heading, away) > 50) heading = Math.round(away);
        } else if (bldPts.length) {
          const f = aheadOf(mapped);
          if (toBuilding(f(30)) > toBuilding(f(-30))) heading = (mapped + 180) % 360;
        }
        const ahead = aheadOf(heading);
        // Pushed back straight out until the tail is on the nearest taxiway centreline (20-90 m).
        let push = TAXI_LANE;
        if (length > 0) push = length; // (set with the airport editor)
        else if (lay.taxiways.length) {
          let best = Infinity;
          for (let m = 20; m <= 90; m += 2.5) {
            const d = toTaxiway(ahead(-m));
            if (d < best - 0.5) { best = d; push = m; }
          }
          if (best > 40) push = TAXI_LANE; // no taxiway behind the stand
        }
        const bridge = lay.bridges !== false && toTerminal(ahead(stop + 10)) < 45; // (read off the tiles: only where gates are mapped)
        const st = { lat, lon, heading, push, name: name || `S${i + 1}`, bridge, lead: [ahead(-push), ahead(stop)], stopBar: [ahead(stop, -4), ahead(stop, 4)] };
        if (bridge) st.bridgePoly = [ahead(stop - 7, -6.3), ahead(stop - 7, -2.7), ahead(stop + 22, -2.7), ahead(stop + 22, -6.3)];
        return st;
      });
    const ref = middle(stands.map((st) => st.lead[0]));
    // Where no tower is mapped, one stands behind the main terminal, away from the stands (unless the layout
    // says the airfield has none).
    const towers = lay.towers.length || lay.tower === false ? lay.towers : [offsetPoint(main[0], main[1], bearing({ lat: ref[0], lon: ref[1] }, { lat: main[0], lon: main[1] }), 80)];
    const tw = 5 + size;
    const th = [10, 14, 20, 30, 42, 55][size];
    const buildings = [
      // the mapped height where the tiles give one
      // (5 m is what the tiles give a building without a known height)
      ...lay.terminals.map((ring, i) => ({ ring, base: 0, h: (lay.heights && lay.heights.terminals[i] > 5 && lay.heights.terminals[i]) || 10 + 3 * size, kind: 'terminal' })),
      ...lay.hangars.map((ring, i) => ({ ring, base: 0, h: (lay.heights && lay.heights.hangars[i] > 5 && lay.heights.hangars[i]) || 14, kind: 'hangar' })),
      ...(lay.others || []).map((ring, i) => ({ ring, base: 0, h: (lay.heights && lay.heights.others && lay.heights.others[i]) || 6, kind: 'other' })),
      ...towers.flatMap((p) => [{ ring: square(p, tw / 2), base: 0, h: th, kind: 'tower' }, { ring: square(p, tw / 2 + 2), base: th, h: th + 5, kind: 'cab' }]),
    ];
    return {
      code, real: lay, hdg: 0, side: 1, nose: stands[0].heading, spacing: 60, gates: stands.filter((st) => st.bridge), stands, buildings,
      terminal: mainTerminal || square(main, 20), apron: biggest(lay.aprons) || square(ref, 60), aprons: lay.aprons,
      lane: [ref, ref], ref, exits: [ref],
    };
  }

  // ---------- copies of real terminals ----------
  // A terminal the player builds takes its layout from a real one at one of the big airports
  // (FG.data.terminals: [airport, number of the terminal in its layout, stands], fewest stands first): the
  // terminal's outline, the stands at it and the taxi lanes and apron round them, turned to lie beside the
  // main runway here. Only the layout: the tower, the taxiways along the runways and the links to them are
  // the game's. Which terminal: by the airport's code, among those with about as many stands as its size has.
  function copyTemplate(code, size) {
    const style = infra(code).style;
    const list = D.terminals || [];
    if (!list.length || (style ? style !== 'copy' : !(infra(code).terminal > 0))) return null;
    const need = 2 * GATE_COUNT[size];
    let fits = list.filter((t) => t[2] >= 0.8 * need).slice(0, 10);
    if (fits.length < 3) fits = list.slice(-3); // none as big: one of the biggest
    return fits[Math.floor(hash01(code.charCodeAt(0), code.charCodeAt(1) || 0, code.charCodeAt(2) || 0, 11) * fits.length)];
  }

  // The piece of airport `from`'s layout round its terminal number `ti`, in metres: [u, v] with u along the
  // runway nearest that terminal and v away from it (0 = the piece's runway-side edge, u = 0 its middle),
  // headings relative to the runway. { w, d, rings, stands: { p, h, name, d } nearest first, taxiways, aprons }.
  const pieces = new Map();
  function terminalPiece(from, ti, lay) {
    const key = `${from}|${ti}`;
    if (pieces.has(key)) return pieces.get(key);
    const mid = middle(lay.terminals[ti]);
    let rwy = { thr: mid, hdg: 0, len: 0 };
    let nearest = Infinity;
    for (const r of D.runways[from] || []) {
      const cand = { thr: [r[0], r[1]], hdg: bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] }), len: runwayLength(r) };
      const c = rwyCoords(cand, mid);
      const d = Math.hypot(c.across, c.along < 0 ? c.along : Math.max(0, c.along - cand.len));
      if (d < nearest) { nearest = d; rwy = cand; }
    }
    // Seen from the runway's other end if the terminal is on its left, so that v grows away from the runway.
    const turn = rwyCoords(rwy, mid).across < 0 ? -1 : 1;
    const F = (p) => { const c = rwyCoords(rwy, p); return [turn * c.along, turn * c.across]; };
    const ring = lay.terminals[ti].map(F);
    const toRing = (q) => { // metres from q to the terminal's outline
      let best = Infinity;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const bx = b[0] - a[0], by = b[1] - a[1], px = q[0] - a[0], py = q[1] - a[1];
        const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by || 1)));
        best = Math.min(best, Math.hypot(px - t * bx, py - t * by));
      }
      return best;
    };
    const ahead = (s, m) => [s.p[0] + m * Math.cos(toRad(s.h)), s.p[1] + m * Math.sin(toRad(s.h))];
    const stands = lay.stands.map(([lat, lon, heading, name]) => ({ p: F([lat, lon]), h: (heading - rwy.hdg + (turn < 0 ? 180 : 0) + 720) % 360, name }));
    for (const s of stands) s.d = Math.min(toRing(s.p), toRing(ahead(s, 24)));
    const mine = stands.filter((s) => s.d < 110).sort((x, y) => x.d - y.d);
    const all = [...ring, ...mine.flatMap((s) => [s.p, ahead(s, -TAXI_LANE)])];
    const u0 = Math.min(...all.map((p) => p[0])) - 25;
    const u1 = Math.max(...all.map((p) => p[0])) + 25;
    const v0 = Math.min(...all.map((p) => p[1])) - 25;
    const v1 = Math.max(...all.map((p) => p[1])) + 25;
    const inside = (p, m = 0) => p[0] >= u0 - m && p[0] <= u1 + m && p[1] >= v0 - m && p[1] <= v1 + m;
    const local = (p) => [p[0] - (u0 + u1) / 2, p[1] - v0];
    // A polygon cut to the piece's rectangle, one edge of the rectangle after the other.
    const clip = (poly) => {
      let out = poly;
      for (const [i, lim, below] of [[0, u0, false], [0, u1, true], [1, v0, false], [1, v1, true]]) {
        const src = out;
        out = [];
        const ok = (p) => (below ? p[i] <= lim : p[i] >= lim);
        src.forEach((p, k) => {
          const q = src[(k + 1) % src.length];
          if (ok(p)) out.push(p);
          if (ok(p) !== ok(q)) { const t = (lim - p[i]) / (q[i] - p[i]); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
        });
      }
      return out;
    };
    const taxiways = [];
    for (const line of lay.taxiways) { // the stretches of the taxiways within 40 m of the rectangle
      let run = [];
      for (const p of [...line.map(F), null]) {
        if (p && inside(p, 40)) { run.push(local(p)); continue; }
        if (run.length > 1) taxiways.push(run);
        run = [];
      }
    }
    // One apron under it all (many airports are mapped stand by stand): the hull of the stands and taxi lanes.
    const hullOf = (pts) => {
      const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const turnsLeft = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]) > 0;
      const chain = (list) => {
        const h = [];
        for (const p of list) {
          while (h.length > 1 && !turnsLeft(h[h.length - 2], h[h.length - 1], p)) h.pop();
          h.push(p);
        }
        return h.slice(0, -1);
      };
      return [...chain(s), ...chain(s.reverse())];
    };
    const hull = hullOf([...mine.flatMap((s) => [ahead(s, -TAXI_LANE - 20), ahead(s, 30)]).map(local), ...taxiways.flat()]);
    const also = lay.terminals.map((t, i) => i).filter((i) => i !== ti && inside(F(middle(lay.terminals[i]))));
    const piece = {
      w: u1 - u0, d: v1 - v0,
      rings: [ring, ...also.map((i) => lay.terminals[i].map(F))].map((r) => r.map(local)),
      also, // the other terminals (parts of this one, mostly) that lie in the piece
      stands: mine.map((s) => ({ p: local(s.p), h: s.h, name: s.name, d: s.d })),
      taxiways,
      aprons: [hull, ...lay.aprons.map((r) => clip(r.map(F))).filter((r) => r.length > 2).map((r) => r.map(local))],
    };
    pieces.set(key, piece);
    return piece;
  }

  // The apron of airport `code` as a copy of the terminal `tpl` = [airport, terminal] in the layout `lay`: a
  // layout like the real ones (realApron), with the taxiways of the piece joined to taxiways along the runways.
  function copiedApron(code, size, tpl, lay, rws) {
    const piece = terminalPiece(tpl[0], tpl[1], lay);
    if (!piece.stands.length) return null;
    const { main, side, along, edge } = apronPlace(code, rws, piece.w / 2 + 20, piece.d);
    // The piece is turned half round where it lies on the runway's left.
    const P = ([u, v]) => rwyPoint(main, along + side * u, side * (edge + v));
    const ref = rwyPoint(main, along, side * edge);
    // Links from the taxi lanes to the runways: from the lane points nearest the runway in each third.
    const lanePts = piece.taxiways.flat();
    const links = [];
    for (let k = 0; k < 3; k++) {
      const lo = -piece.w / 2 - 40 + (k * (piece.w + 80)) / 3;
      const best = lanePts.filter((p) => p[0] >= lo && p[0] <= lo + (piece.w + 80) / 3).reduce((b, p) => (!b || p[1] < b[1] ? p : b), null);
      if (best) links.push(P(best));
    }
    if (!links.length) links.push(ref);
    const taxiways = piece.taxiways.map((l) => l.map(P));
    for (const r of rws) { // as taxiwaysOf: a parallel taxiway, joined to the runway and to the links
      const len = runwayLength(r);
      const rwy = { thr: [r[0], r[1]], hdg: bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] }), len };
      const off = taxiwayOffset(rwy, ref);
      const leave = Math.min(len * 0.65, 2200);
      const feet = links.map((e) => Math.min(len, Math.max(0, rwyCoords(rwy, e).along)));
      const outs = [Math.min(len, leave + exitRun(len, off)), Math.max(0, len - leave - exitRun(len, off))]; // where the exits meet it
      taxiways.push([...new Set([0, len, ...outs, ...feet])].sort((x, y) => x - y).map((x) => rwyPoint(rwy, x, off)));
      for (const x of [0, len]) taxiways.push([rwyPoint(rwy, x, off), rwyPoint(rwy, x, 0)]);
      taxiways.push([rwyPoint(rwy, leave, 0), rwyPoint(rwy, outs[0], off)], [rwyPoint(rwy, len - leave, 0), rwyPoint(rwy, outs[1], off)]);
      links.forEach((e, i) => taxiways.push([e, rwyPoint(rwy, feet[i], off)]));
    }
    const ap = realApron(code, size, {
      copy: tpl[0], key: `${code}|${tpl[0]}|${tpl[1]}|${size}|${side}|${Math.round(along)}|${edge}|${rws.length}`,
      terminals: piece.rings.map((r) => r.map(P)), hangars: [], towers: [P([-piece.w / 2 - 15, piece.d / 2])],
      aprons: piece.aprons.map((r) => r.map(P)), taxiways,
      stands: piece.stands.slice(0, 2 * GATE_COUNT[size]).map((s) => [...P(s.p), (main.hdg + s.h + (side < 0 ? 180 : 0)) % 360, s.name]),
    });
    ap.hdg = main.hdg;
    ap.side = side;
    return ap;
  }

  // The taxiways of a layout as a graph: points, and for each point its neighbours with the distance.
  const taxiGraphs = new Map();
  function taxiGraph(code, lay) {
    const key = lay.key || code; // a copied terminal's layout changes with the airport
    let g = taxiGraphs.get(key);
    if (g) return g;
    g = { pts: [], adj: [] };
    const index = new Map();
    const node = (p) => {
      const k = `${p[0]},${p[1]}`;
      if (!index.has(k)) { index.set(k, g.pts.length); g.pts.push(p); g.adj.push([]); }
      return index.get(k);
    };
    // `links` (layouts read off the tiles): the runways and a way from the apron, taken only where needed
    for (const [line, cost] of [...lay.taxiways.map((l) => [l, 1]), ...(lay.links || []).map((l) => [l, 3])]) {
      for (let i = 1; i < line.length; i++) {
        const u = node(line[i - 1]);
        const v = node(line[i]);
        const d = metres(line[i - 1], line[i]) * cost;
        g.adj[u].push([v, d]);
        g.adj[v].push([u, d]);
      }
    }
    // Join loose ends: a line that ends on another line (within 8 m) without sharing a point with it, as
    // happens where the data was cut into map tiles. The end is linked to both ends of that stretch.
    const segs = [];
    for (let u = 0; u < g.adj.length; u++) for (const [w] of g.adj[u]) if (u < w) segs.push([u, w]);
    const toSegment = (p, a, b) => {
      const kx = 111320 * Math.cos(toRad(a[0]));
      const bx = (b[1] - a[1]) * kx, by = (b[0] - a[0]) * 111320, px = (p[1] - a[1]) * kx, py = (p[0] - a[0]) * 111320;
      const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by || 1)));
      return Math.hypot(px - t * bx, py - t * by);
    };
    for (let u = 0; u < g.pts.length; u++) {
      if (g.adj[u].length !== 1) continue;
      const p = g.pts[u];
      let best = null;
      let near = 8;
      for (const s of segs) {
        const a = g.pts[s[0]];
        if (s[0] === u || s[1] === u || Math.abs(a[0] - p[0]) > 0.02 || Math.abs(a[1] - p[1]) > 0.03) continue;
        const d = toSegment(p, a, g.pts[s[1]]);
        if (d < near) { near = d; best = s; }
      }
      if (best) for (const w of best) { const d = metres(p, g.pts[w]); g.adj[u].push([w, d]); g.adj[w].push([u, d]); }
    }
    // Which points belong to the biggest connected piece of the taxiways.
    const piece = new Int32Array(g.pts.length).fill(-1);
    const sizes = [];
    for (let i = 0; i < g.pts.length; i++) {
      if (piece[i] >= 0) continue;
      const stack = [i];
      piece[i] = sizes.length;
      let n = 0;
      while (stack.length) {
        const u = stack.pop();
        n++;
        for (const [w] of g.adj[u]) if (piece[w] < 0) { piece[w] = sizes.length; stack.push(w); }
      }
      sizes.push(n);
    }
    const biggest = sizes.indexOf(Math.max(...sizes));
    g.main = Array.from(piece, (c) => c === biggest);
    if (taxiGraphs.size > 300) taxiGraphs.clear();
    taxiGraphs.set(key, g);
    return g;
  }
  // Shortest way along the real taxiways from near `from` to near `to`: the points on the way, or [] if
  // the taxiways do not connect them.
  function realTaxiPath(code, lay, from, to) {
    const g = taxiGraph(code, lay);
    // (only among the points of the biggest connected piece: stubs that join nothing lead nowhere)
    const nearest = (p) => g.pts.reduce((b, q, i) => { const d = g.main[i] ? metres(p, q) : Infinity; return d < b[1] ? [i, d] : b; }, [-1, Infinity])[0];
    const s = nearest(from);
    const t = nearest(to);
    if (s < 0 || t < 0) return [];
    const best = new Float64Array(g.pts.length).fill(Infinity);
    const prev = new Int32Array(g.pts.length).fill(-1);
    const heap = [[0, s]]; // binary heap of [distance, point]
    best[s] = 0;
    while (heap.length) {
      const [d, u] = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          let m = i;
          const l = 2 * i + 1, r = l + 1;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]];
          i = m;
        }
      }
      if (u === t) break;
      if (d > best[u]) continue;
      for (const [w, len] of g.adj[u]) {
        const nd = d + len;
        if (nd >= best[w]) continue;
        best[w] = nd;
        prev[w] = u;
        heap.push([nd, w]);
        for (let i = heap.length - 1; i > 0;) {
          const up = (i - 1) >> 1;
          if (heap[up][0] <= heap[i][0]) break;
          [heap[i], heap[up]] = [heap[up], heap[i]];
          i = up;
        }
      }
    }
    if (best[t] === Infinity) return [];
    const path = [];
    for (let u = t; u >= 0; u = prev[u]) path.push(g.pts[u]);
    return path.reverse();
  }

  // ---------- expansion preview (developer tools) ----------
  // What the possible construction at an airport would add: each kind of runway where it would be built
  // (with its taxiway), and the apron, stands and buildings of the next terminal size.
  function expansionPreview(code) {
    const out = { runways: [], taxiways: [], stands: [], buildings: [], aprons: [] };
    const ap = apronOf(code);
    const seen = new Set();
    for (const o of Game.projectOptions(code)) {
      const kind = o.kind + (o.orient || '');
      if ((o.kind !== 'runway' && o.kind !== 'extend') || seen.has(kind)) continue; // one length of each kind
      seen.add(kind);
      const geo = Game.plannedRunway({ code, kind: o.kind, len: o.len, orient: o.orient });
      if (!geo) continue;
      const r = geo.runway;
      out.runways.push({ r, label: o.label });
      if (ap.real) continue; // its taxiway would have to join the real ones
      const len = runwayLength(r);
      const rwy = { thr: [r[0], r[1]], hdg: bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] }), len };
      const off = taxiwayOffset(rwy, ap.ref);
      out.taxiways.push([rwyPoint(rwy, 0, off), rwyPoint(rwy, len, off)]);
      for (const a of [0, len]) out.taxiways.push([rwyPoint(rwy, a, off), rwyPoint(rwy, a, 0)]);
      for (const e of ap.exits) out.taxiways.push([e, rwyPoint(rwy, Math.min(len, Math.max(0, rwyCoords(rwy, e).along)), off)]);
    }
    const size = airportSize(code);
    if (size < 5 && !airportByCode[code].factory) {
      const next = apronOf(code, size + 1);
      const have = new Set(ap.stands.map((s) => `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`));
      out.stands = next.stands.filter((s) => !have.has(`${s.lat.toFixed(5)},${s.lon.toFixed(5)}`));
      out.buildings = next.buildings;
      out.aprons = next.aprons || [next.apron];
    }
    return out;
  }

  // Which stand a plane uses at an airport: the one it holds (parked, or reserved by its flight),
  // else (route previews, old saves) one by fleet order.
  function standIndex(code, planeId) {
    const s = Game.state;
    const p = s && s.planes.find((q) => q.id === planeId);
    if (p) {
      const f = p.flight;
      if (f && f.to === code && f.standTo != null) return f.standTo;
      if (f && f.from === code && f.standFrom != null) return f.standFrom;
      if (p.stand && p.stand.code === code) return p.stand.k;
    }
    const ids = s ? s.planes.map((q) => q.id).sort() : [];
    return Math.max(0, ids.indexOf(planeId)) % apronOf(code).stands.length;
  }

  // A plane's stand at an airport: where it parks nose-in (heading = towards the terminal).
  function gateOf(code, planeId) {
    const ap = apronOf(code);
    const st = ap.stands[Math.min(standIndex(code, planeId), ap.stands.length - 1)];
    return { lat: st.lat, lon: st.lon, heading: st.heading, name: st.name, bridge: st.bridge, push: st.push || TAXI_LANE };
  }

  function buildTrack(type, f, planeId) {
    const day = Math.floor(f.dep / DAY);
    const A0 = airportByCode[f.from];
    const B0 = airportByCode[f.to];
    const ac = D.aircraft[type];
    const need = runwayNeed(type).m;
    const dep = pickRunway(f.from, day, need);
    const arr = pickRunway(f.to, day, need);
    const radius = ac.speedKmh < 450 ? 1800 : 3500; // turn radius at climb/approach speed
    const P = (ll) => ({ lat: ll[0], lon: ll[1] });

    const lift = offsetPoint(dep.thr[0], dep.thr[1], dep.hdg, Math.min(dep.len * 0.6, 2500));
    const climbOut = offsetPoint(dep.end[0], dep.end[1], dep.hdg, ac.speedKmh < 450 ? 2500 : 5000);
    const faf = offsetPoint(arr.thr[0], arr.thr[1], arr.hdg + 180, FINAL_KM * 1000);
    const touch = offsetPoint(arr.thr[0], arr.thr[1], arr.hdg, 400);
    const stop = offsetPoint(arr.thr[0], arr.thr[1], arr.hdg, Math.min(arr.len * 0.65, 2200)); // where it leaves the runway

    const outTurn = turnToward(climbOut, dep.hdg, P(faf), radius);
    const turnEnd = outTurn.length ? outTurn[outTurn.length - 1] : climbOut;
    // The arrival turn is built backwards from the final approach fix.
    const inTurn = turnToward(faf, arr.hdg + 180, P(turnEnd), radius).reverse();
    const turnStart = inTurn.length ? inTurn[0] : faf;

    // Gates: pushed back out of the stand at the start, nose-in onto the stand at the end.
    const gA = gateOf(f.from, planeId);
    const gB = gateOf(f.to, planeId);
    const standA = [gA.lat, gA.lon];
    const standB = [gB.lat, gB.lon];
    const pushA = offsetPoint(gA.lat, gA.lon, gA.heading + 180, gA.push);
    const leadB = offsetPoint(gB.lat, gB.lon, gB.heading + 180, gB.push);
    // Taxi out along the taxiways to the threshold, and in from where the plane leaves the runway.
    const outPath = taxiPath(f.from, dep, pushA, 0);
    const stopM = Math.min(arr.len * 0.65, 2200);
    const inPath = taxiPath(f.to, arr, leadB, stopM).reverse();
    const pts = [standA, pushA, ...outPath, dep.thr, lift, dep.end, climbOut, ...outTurn];
    const iThr = 2 + outPath.length;
    const cruise = distanceKm(P(turnEnd), P(turnStart));
    const n = Math.max(1, Math.ceil(cruise / 25));
    for (let i = 1; i < n; i++) pts.push(interpolate(P(turnEnd), P(turnStart), i / n));
    pts.push(...inTurn, faf, arr.thr, touch, stop, ...inPath, leadB, standB);
    const idx = { push: 1, thr: iThr, lift: iThr + 1, touch: pts.length - 4 - inPath.length, stop: pts.length - 3 - inPath.length, lead: pts.length - 2 };

    // Cumulative distance (km).
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distanceKm(P(pts[i - 1]), P(pts[i])));
    const sLift = cum[idx.lift];
    const sTouch = cum[idx.touch];
    const airborne = sTouch - sLift;

    // Cruise level: type typical, lower on short hops; odd thousands eastbound, even westbound.
    const climbRate = ac.category === 'turboprop' || ac.category === 'classic' ? 4.5 : 4; // km per 1000 ft
    let cruiseAlt = cruiseFt(type);
    const fit = airborne / ((climbRate + DESCENT_KM_PER_KFT) * cruiseAlt / 1000);
    if (fit < 1) cruiseAlt *= fit;
    let fl = Math.floor(cruiseAlt / 1000);
    if (fl >= 5) {
      const east = bearing(A0, B0) < 180;
      if (fl % 2 !== (east ? 1 : 0)) fl -= 1;
    }
    cruiseAlt = Math.max(1000, fl * 1000);
    const climbKm = climbRate * cruiseAlt / 1000;

    const altAt = (sv) => {
      const x = sv - sLift;
      const y = sTouch - sv;
      if (x <= 0 || y <= 0) return 0;
      const climb = cruiseAlt * (1 - Math.pow(1 - Math.min(1, x / climbKm), 1.7));
      return Math.max(0, Math.min(cruiseAlt, climb, (y / DESCENT_KM_PER_KFT) * 1000));
    };

    // Time table: taxi, roll, airborne (slow low, fast high), roll, taxi; scaled to the block time.
    const total = f.arr - f.dep;
    const ground = Math.min(total * 0.5, TAXI_OUT + TAXI_IN + ROLL_OUT + ROLL_IN);
    const k = ground / (TAXI_OUT + TAXI_IN + ROLL_OUT + ROLL_IN);
    const air = total - ground;
    // Speed: lift-off at about the approach speed, 250 kt (463 km/h) below 10,000 ft, cruise speed above.
    // Coming in, the plane slows down to its approach speed by the final approach fix and holds it on the
    // glide path, touching down a little slower.
    const vCruise = ac.speedKmh;
    const vApp = Math.min(vCruise * 0.6, ac.speedKmh < 450 ? 210 : ac.speedKmh < 700 ? 230 : 260);
    const v250 = Math.min(vCruise, 463);
    const speedAt = (sm) => {
      const alt = altAt(sm);
      let v = alt < 10000
        ? vApp * 1.05 + (v250 - vApp * 1.05) * Math.sqrt(alt / 10000)
        : v250 + (vCruise - v250) * Math.min(1, (alt - 10000) / 20000); // full cruise speed from FL300
      const toTouch = sTouch - sm;
      if (toTouch < FINAL_KM) v = vApp * (0.93 + 0.07 * toTouch / FINAL_KM); // on final
      else if (toTouch < FINAL_KM + 25) v = Math.min(v, vApp + (v250 - vApp) * (toTouch - FINAL_KM) / 25); // slowing down
      return Math.max(vApp * 0.9, v);
    };
    const steps = 200;
    const raw = [0];
    for (let i = 1; i <= steps; i++) {
      const sm = sLift + airborne * (i - 0.5) / steps;
      raw.push(raw[i - 1] + (airborne / steps) / speedAt(sm));
    }
    const scale = air / raw[steps];
    const segs = [ // [t0, t1, s0, s1, ease]; 'both' starts and ends at standstill
      [0, PUSHBACK * k, 0, cum[idx.push], 'both'],
      [PUSHBACK * k, TAXI_OUT * k, cum[idx.push], cum[idx.thr], 'both'],
      [TAXI_OUT * k, (TAXI_OUT + ROLL_OUT) * k, cum[idx.thr], sLift, 'in'],
    ];
    const t0 = (TAXI_OUT + ROLL_OUT) * k;
    const t1 = t0 + air;
    segs.push([t1, t1 + ROLL_IN * k, sTouch, cum[idx.stop], 'out']);
    segs.push([t1 + ROLL_IN * k, total - DOCK * k, cum[idx.stop], cum[idx.lead], 'both']);
    segs.push([total - DOCK * k, total, cum[idx.lead], cum[cum.length - 1], 'both']);

    return {
      pts, cum, idx, cruiseAlt, depRunway: dep, arrRunway: arr, total,
      altAt,
      // Distance along the track (km) at minutes since departure.
      sAt(t) {
        if (t >= t0 && t <= t1) {
          const u = (t - t0) / scale; // unscaled time
          let lo = 0;
          let hi = steps;
          while (hi - lo > 1) { const m = (lo + hi) >> 1; if (raw[m] <= u) lo = m; else hi = m; }
          const fr = (u - raw[lo]) / (raw[hi] - raw[lo] || 1);
          return sLift + airborne * (lo + Math.min(1, Math.max(0, fr))) / steps;
        }
        for (const [a, b, s0, s1, ease] of segs) {
          if (t < a || t > b) continue;
          let u = b > a ? (t - a) / (b - a) : 1;
          if (ease === 'in') u *= u;
          if (ease === 'out') u = 1 - (1 - u) * (1 - u);
          if (ease === 'both') u = u * u * (3 - 2 * u);
          return s0 + (s1 - s0) * u;
        }
        return t < 0 ? 0 : cum[cum.length - 1];
      },
      // Position and heading at distance sv.
      at(sv) {
        // first point at or beyond sv (binary search: called for every plane in every frame)
        let i = 1;
        let hi = cum.length - 1;
        while (i < hi) { const m = (i + hi) >> 1; if (cum[m] < sv) i = m + 1; else hi = m; }
        const a = pts[i - 1];
        const b = pts[i];
        const fr = cum[i] > cum[i - 1] ? Math.min(1, Math.max(0, (sv - cum[i - 1]) / (cum[i] - cum[i - 1]))) : 1;
        const lat = a[0] + (b[0] - a[0]) * fr;
        let dLon = b[1] - a[1];
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        // Pushback: the plane moves tail first.
        return { lat, lon: a[1] + dLon * fr, heading: (bearing(P(a), P(b)) + (i === idx.push ? 180 : 0)) % 360 };
      },
    };
  }

  const trackCache = new Map();
  function flightTrack(p) {
    const f = p.flight;
    if (!f) return null;
    const key = `${p.id}|${f.dep}|${f.from}|${f.to}`;
    const version = FG.layouts ? FG.layouts.version : 0;
    let t = trackCache.get(key);
    // A layout that arrives changes the taxi ways, but only at its own airport: a track whose two
    // airports still have the same apron is kept (rebuilding them all made the planes hitch).
    if (t && t.version !== version) {
      if (apronOf(f.from) === t.aprons[0] && apronOf(f.to) === t.aprons[1]) t.version = version;
      else t = null;
    }
    if (!t) {
      t = buildTrack(p.type, f, p.id);
      t.version = version;
      t.aprons = [apronOf(f.from), apronOf(f.to)];
      // Least recently used ones go (clearing them all made every flying plane rebuild its track at once).
      if (trackCache.size >= 300) trackCache.delete(trackCache.keys().next().value);
    } else trackCache.delete(key);
    trackCache.set(key, t); // (to the end: most recently used)
    return t;
  }

  // Today's planned track for a schedule leg (for drawing routes).
  function legTrack(type, from, to) {
    const day = Game.state ? Math.floor(Game.state.time / DAY) : 0;
    const dep = day * DAY + 12 * 60;
    return flightTrack({ id: `leg:${type}`, type, flight: { from, to, dep, arr: dep + blockMinutes(type, dist(from, to)) } });
  }

  // Where a flying plane is at time t (fractional minutes allowed), how high and how fast.
  function flightState(p, t) {
    const tr = flightTrack(p);
    if (!tr) return null;
    const f = p.flight;
    const m = Math.min(tr.total, Math.max(0, t - f.dep));
    const sv = tr.sAt(m);
    const pos = tr.at(sv);
    const alt = Math.round(tr.altAt(sv));
    const speed = Math.round(Math.max(0, tr.sAt(Math.min(tr.total, m + 0.25)) - tr.sAt(Math.max(0, m - 0.25))) * 120);
    const sLift = tr.cum[tr.idx.lift];
    const sTouch = tr.cum[tr.idx.touch];
    let phase;
    if (sv < tr.cum[tr.idx.push]) phase = 'pushback';
    else if (sv < tr.cum[tr.idx.thr]) phase = 'taxi-out';
    else if (sv < sLift) phase = 'takeoff';
    else if (sv >= tr.cum[tr.idx.stop]) phase = 'taxi-in';
    else if (sv >= sTouch) phase = 'landing';
    else if (sTouch - sv < FINAL_KM + 1) phase = 'approach';
    else if (alt >= tr.cruiseAlt - 50) phase = 'cruise';
    else phase = sv - sLift < (sTouch - sLift) / 2 ? 'climb' : 'descent';
    // airFrac: how far between lift-off (0) and touchdown (1) the plane is, for blending the two field elevations.
    const airFrac = Math.min(1, Math.max(0, (sv - sLift) / Math.max(0.001, sTouch - sLift)));
    return { lat: pos.lat, lon: pos.lon, heading: pos.heading, altFt: alt, speedKmh: speed, phase, airFrac,
      cruiseFt: tr.cruiseAlt, depRunway: designatorOf(tr.depRunway.hdg), arrRunway: designatorOf(tr.arrRunway.hdg) };
  }
  const designatorOf = (h) => String(Math.round((((h % 360) + 360) % 360) / 10) || 36).padStart(2, '0');

  // ---------- aircraft market ----------
  const M = C.market;
  const priceNew = (type) => D.aircraft[type].price || D.aircraft[type].leasePerWeek * M.priceWeeks;
  const usedPrice = (type, age) => Math.round(priceNew(type) * Math.pow(1 - M.depreciationPerYear, age) / 1000) * 1000;
  const agingMult = (age) => 1 + M.agingCostPerYear * age;
  // Can this type operate at this airport (runway / gates)?
  function fitsAirport(type, code) {
    return fitsReason(type, code) === null;
  }
  // Why a type can't use an airport, or null.
  function fitsReason(type, code) {
    const ac = D.aircraft[type];
    if (airportByCode[code].factory) return null;
    if (airportByCode[code].built && !airportByCode[code].open) return `${code} is still under construction.`;
    if (airportSize(code) < (ac.minAirport || 1)) return `${code} is too small for the ${ac.name} (size ${airportSize(code)}, needs ${ac.minAirport}).`;
    const need = runwayNeed(type);
    const have = longestRunway(code, need.paved);
    if (have < need.m) return `The ${ac.name} needs ${need.m} m of ${need.paved ? 'paved ' : ''}runway, ${code} has ${have} m.`;
    return null;
  }

  function crewFor(type) {
    const seats = D.aircraft[type].seats;
    const pilots = D.aircraft[type].category === 'widebody' ? 3 : 2;
    const cabin = seats < 20 ? 0 : Math.ceil(seats / 50);
    return { pilots, cabin, weeklySalary: pilots * M.pilotSalary + cabin * M.cabinSalary };
  }

  function randomUsedListing(n) {
    const types = Object.keys(D.aircraft).filter((t) => D.aircraft[t].category !== 'classic' || Math.random() < 0.3);
    const type = types[Math.floor(Math.random() * types.length)];
    const age = M.usedAge[0] + Math.floor(Math.random() * (M.usedAge[1] - M.usedAge[0] + 1));
    const homes = D.airports.filter((a) => !a.minor && fitsAirport(type, a.code));
    const at = homes[Math.floor(Math.random() * homes.length)].code; // seller's base
    return { id: `U${n}`, type, age, price: usedPrice(type, age), at };
  }

  // ---------- formatting ----------
  function fmtMoney(n) {
    const v = Math.round(n);
    return `${v < 0 ? '-' : ''}${C.currency} ${Math.abs(v).toLocaleString('de-CH')}`;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const fmtClock = (t) => `${pad(Math.floor((t % DAY) / 60))}:${pad(t % 60)}`;
  function fmtTime(t) {
    const day = Math.floor(t / DAY);
    return `Day ${day + 1} (${WEEKDAYS[day % 7]}) ${fmtClock(t)}`;
  }
  const fmtDuration = (m) => `${Math.floor(m / 60)}h${pad(Math.round(m % 60))}`;

  // ---------- game ----------
  const Game = {
    state: null,
    dirty: true, // UI needs a full re-render

    airportByCode, distanceKm, dist, bearing, interpolate, catchment, dailyDemand,
    ticketPrice, routeKey, blockMinutes, landingFee, slotUpfront, slotWeekly,
    priceNew, fitsAirport, fitsReason, crewFor, factoryOf,
    airportSize, airportRunways, runwayLength, longestRunway, runwayNeed, attraction,
    flightTrack, flightState, legTrack, cruiseFt, windFrom, gateOf, apronOf, taxiwaysOf, expansionPreview, terminalPiece,
    fmtMoney, fmtTime, fmtClock, fmtDuration,

    // opts: { mode, difficulty, airport, aircraft, company } from the start screen; all optional.
    newGame(opts = {}) {
      if (typeof opts === 'string') opts = { mode: opts };
      const mode = C.modes[opts.mode] ? opts.mode : C.defaultMode;
      const difficulty = C.difficulties[opts.difficulty] ? opts.difficulty : C.defaultDifficulty;
      const homeCode = airportByCode[opts.airport] ? opts.airport : C.startAirport;
      const type = D.aircraft[opts.aircraft] ? opts.aircraft : C.startAircraft;
      const home = airportByCode[homeCode];
      const crewT = crewFor(type);
      this.state = {
        version: 1,
        mode,
        difficulty,
        home: homeCode,
        company: (opts.company || '').trim().slice(0, 40) || C.companyName,
        time: C.curfew.start,
        money: C.difficulties[difficulty].startMoney,
        slots: { [homeCode]: { since: 0, count: 1 } },
        planes: [{
          id: C.startRegistration,
          type,
          location: homeCode,
          status: 'idle', // idle | flying | turnaround
          ownership: 'leased', // leased | owned
          age: 0, // years when acquired
          acquiredAt: 0,
          readyAt: 0,
          flight: null,
          pendingFerry: null,
          crewId: 'crew-1',
          schedule: { stops: [], index: 0, active: false },
          stats: { flights: 0, pax: 0, profit: 0 },
        }],
        crews: [{
          id: 'crew-1',
          name: `Base Crew ${home.city}`,
          base: homeCode,
          pilots: crewT.pilots,
          cabin: crewT.cabin,
          weeklySalary: crewT.weeklySalary,
          dutyToday: 0,
        }],
        fares: {}, // routeKey -> price factor on the standard fare (missing = 1)
        carriedToday: {},
        today: { revenue: 0, cost: 0, fixed: 0, flights: 0, pax: 0 },
        history: [],
        log: [],
        market: { listings: [], nextId: 1 },
        effects: [], // active events: { label, until, where, demandMult, costMult, noFlights }
        news: [], // newspaper stories waiting to be shown
        infra: {},    // code -> { stake %, terminal levels added, runways (replaces the data), invested }
        projects: [], // construction under way
        built: [],    // airports the player built
        fees: {},     // code -> landing and passenger fees paid there this week (for dividends)
        rep: { flown: 0, onTime: 0, late: 0, crashes: [], incidents: [] }, // what the reputation is made of
        slotBuys: {}, // code -> { holder id -> slots bought from it }
        offers: {},   // 'code|holder' -> time a slot offer was turned down (no new one for a day)
        gameOver: false,
      };
      this.registerBuilt();
      this.assignStands();
      this.setupRivals(homeCode);
      this.refreshMarket();
      this.log(`Welcome to ${this.state.company}! You start with a slot at ${home.name}, ` +
        `the ${D.aircraft[type].name} ${C.startRegistration} and a base crew. ` +
        `Mode: ${C.modes[mode].name} – ${C.modes[mode].desc} Difficulty: ${C.difficulties[difficulty].name}.`);
      this.dirty = true;
    },

    load() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false;
        this.state = JSON.parse(raw);
        this.migrate();
        this.dirty = true;
        return true;
      } catch (e) {
        return false;
      }
    },

    // Bring older save games up to date.
    migrate() {
      const s = this.state;
      s.planes = s.planes.filter((p) => D.aircraft[p.type]);
      for (const p of s.planes) {
        if (!p.ownership) p.ownership = 'leased';
        if (p.age == null) p.age = 0;
        if (p.acquiredAt == null) p.acquiredAt = 0;
      }
      if (!s.market) {
        s.market = { listings: [], nextId: 1 };
        this.refreshMarket();
      }
      if (!s.fares) s.fares = {};
      if (!s.mode) s.mode = C.defaultMode;
      if (!s.difficulty) s.difficulty = C.defaultDifficulty;
      if (!s.home) s.home = C.startAirport;
      if (!s.effects) s.effects = [];
      if (!s.news) s.news = [];
      if (!s.infra) s.infra = {};
      if (!s.projects) s.projects = [];
      if (!s.built) s.built = [];
      if (!s.fees) s.fees = {};
      if (!s.rep) s.rep = { flown: s.planes.reduce((n, p) => n + p.stats.flights, 0), onTime: 0, late: 0, crashes: [], incidents: [] };
      if (!s.slotBuys) s.slotBuys = {};
      if (!s.offers) s.offers = {};
      for (const code of Object.keys(s.slots)) {
        if (!s.slots[code].count) {
          const here = s.planes.filter((p) => (p.status === 'flying' && p.flight ? p.flight.to : p.location) === code).length;
          s.slots[code].count = Math.max(1, here);
        }
      }
      this.registerBuilt();
      // Old "fly when ready" routes become timetables (there is one planning system now).
      for (const p of s.planes) {
        const sch = p.schedule;
        if (sch.legs || sch.stops.length < 2) continue;
        const legs = this.buildTimetable(p.type, sch.stops, C.curfew.start + 60);
        if (legs.length < 2) { p.schedule = { stops: [], index: 0, active: false }; continue; }
        p.schedule = { stops: legs.map((l) => l.from), legs, index: 0, active: sch.active, due: 0 };
        this.syncTimetable(p);
      }
      this.assignStands();
      if (!s.rivals) this.setupRivals(s.home);
      this.indexRivals();
    },

    // ---------- gates ----------
    // Lowest free stand at an airport (contact gates from the middle of the terminal outwards, then
    // remote stands). Planes parked there and planes on their way there hold theirs.
    freeStand(code, planeId) {
      const used = new Set();
      for (const q of this.state.planes) {
        if (q.id === planeId) continue;
        if (q.status !== 'flying' && q.location === code && q.stand && q.stand.code === code) used.add(q.stand.k);
        if (q.status === 'flying' && q.flight && q.flight.to === code && q.flight.standTo != null) used.add(q.flight.standTo);
      }
      const n = apronOf(code).stands.length;
      for (let k = 0; k < n; k++) if (!used.has(k)) return k;
      return n - 1; // all taken: share the last remote stand
    },

    // The stand a plane on the ground holds at its airport.
    standAt(p) {
      if (!p.stand || p.stand.code !== p.location) p.stand = { code: p.location, k: this.freeStand(p.location, p.id) };
      return p.stand.k;
    },

    // Stands for planes on the ground and reserved stands for flights (new games, old saves).
    assignStands() {
      for (const p of this.state.planes) {
        if (p.status === 'flying' && p.flight) {
          if (p.flight.standTo == null) p.flight.standTo = this.freeStand(p.flight.to, p.id);
        } else {
          this.standAt(p);
        }
      }
    },

    // Airports the player built become normal airports (map, demand, schedules).
    registerBuilt() {
      for (let i = D.airports.length - 1; i >= 0; i--) {
        if (D.airports[i].built) {
          delete airportByCode[D.airports[i].code];
          D.airports.splice(i, 1);
        }
      }
      for (const a of this.state.built) {
        D.airports.push(a);
        airportByCode[a.code] = a;
        delete catchmentCache[a.code];
      }
    },

    save() {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
        return true;
      } catch (e) {
        return false;
      }
    },

    log(msg, kind = 'info') {
      const s = this.state;
      s.log.unshift({ t: s.time, msg, kind });
      if (s.log.length > 300) s.log.length = 300;
      this.dirty = true;
    },

    plane(id) { return this.state.planes.find((p) => p.id === id); },
    crewOf(p) { return this.state.crews.find((c) => c.id === p.crewId); },
    ownsSlot(code) { return !!this.state.slots[code]; },
    // How many slots you hold at an airport: each one takes one plane on the ground at a time.
    slotCount(code) { const sl = this.state.slots[code]; return sl ? sl.count || 1 : 0; },
    // Weekly slot fee; nothing at airports you control.
    slotFee(code) { return this.stake(code) >= A.majorityStake ? 0 : slotWeekly(code); },

    weeklyCosts() {
      const s = this.state;
      const planes = s.planes.reduce((sum, p) =>
        sum + (p.ownership === 'owned' ? 0 : D.aircraft[p.type].leasePerWeek), 0);
      const crews = s.crews.reduce((sum, c) => sum + c.weeklySalary, 0);
      const slots = Object.keys(s.slots).reduce((sum, code) => sum + this.slotFee(code) * this.slotCount(code), 0);
      return { planes, crews, slots, total: planes + crews + slots };
    },

    // ---------- ticket prices ----------
    // Every route has its own price factor; dearer tickets sell fewer seats.
    fareFactor(a, b) { return this.state.fares[routeKey(a, b)] || 1; },
    fare(a, b) { return Math.round(ticketPrice(dist(a, b)) * this.fareFactor(a, b)); },
    demand(a, b) {
      return Math.round(dailyDemand(a, b) * Math.pow(this.fareFactor(a, b), -C.ticket.elasticity) * this.eventDemandMult(a, b) * this.difficulty().demandMult);
    },

    // ---------- competitors ----------
    // Rival airlines (state.rivals) fly routes from their hubs. Where they fly the player's route,
    // passengers split by seats offered and price (C.rivals); every Monday they react (rivalsWeek).
    setupRivals(homeCode) {
      const s = this.state;
      const R = C.rivals;
      const home = airportByCode[homeCode] || airportByCode[C.startAirport];
      const usable = D.rivalTemplates.filter((t) => t.hubs.every((h) => airportByCode[h]));
      const byDist = usable.map((t) => ({ t, d: Math.min(...t.hubs.map((h) => distanceKm(home, airportByCode[h]))) }))
        .sort((x, y) => x.d - y.d);
      const chosen = byDist.slice(0, R.near).map((x) => x.t);
      const rest = byDist.slice(R.near).map((x) => x.t);
      for (let i = 0; i < R.far && rest.length; i++) { // elsewhere in the world, mostly flag carriers
        const flags = rest.filter((t) => t.kind === 'flag');
        const pool = flags.length && Math.random() < 0.8 ? flags : rest;
        const t = pool[Math.floor(Math.random() * pool.length)];
        rest.splice(rest.indexOf(t), 1);
        chosen.push(t);
      }
      s.rivals = chosen.map((t, i) => ({
        id: `r${i + 1}`, name: t.name, kind: t.kind, hubs: t.hubs.slice(),
        color: D.rivalColors[i % D.rivalColors.length], routes: [], since: s.time,
      }));
      for (const r of s.rivals) {
        for (const plan of this.rivalCandidates(r)) {
          if (r.routes.length >= R.routes[r.kind]) break;
          r.routes.push(plan);
        }
      }
      this.indexRivals();
    },

    // How a rival would fly a–b: aircraft, flights per day for its target load, fare; null if not worth it.
    rivalPlan(r, a, b) {
      const R = C.rivals;
      const d = dist(a, b);
      let type = R.fleet[r.kind];
      if (r.kind === 'flag' && d > R.longHaul.km) type = R.longHaul.type;
      if (r.kind === 'regional' && d < R.shortProp.km) type = R.shortProp.type;
      const ac = D.aircraft[type];
      if (!ac || d > ac.rangeKm || !fitsAirport(type, a) || !fitsAirport(type, b)) return null;
      const fare = R.fare[r.kind];
      const pax = dailyDemand(a, b) * Math.pow(fare, -C.ticket.elasticity);
      const perDay = Math.min(R.maxPerDay, Math.floor(pax / (ac.seats * R.targetLoad)));
      if (perDay < 1) return null;
      return { a, b, type, seats: ac.seats, perDay, fare, since: this.state.time, weak: 0,
        value: Math.round(perDay * ac.seats * ticketPrice(d) * fare) };
    },

    // A rival's best routes from its hubs that it doesn't fly yet, best first.
    rivalCandidates(r, perHub = 40) {
      const range = C.rivals.rangeKm[r.kind];
      const minSize = r.kind === 'regional' ? 1 : 2;
      const have = new Set(r.routes.map((x) => routeKey(x.a, x.b)));
      const out = [];
      for (const h of r.hubs) {
        const hub = airportByCode[h];
        const pre = [];
        for (const a of D.airports) {
          if (a.code === h || a.minor || a.factory || (a.built && !a.open)) continue;
          const size = airportSize(a.code);
          if (size < minSize || have.has(routeKey(h, a.code))) continue;
          const d = distanceKm(hub, a);
          if (d < 200 || d > range) continue;
          pre.push({ code: a.code, score: size * size * distanceFactor(d) }); // cheap pre-ranking
        }
        pre.sort((x, y) => y.score - x.score);
        for (const x of pre.slice(0, perHub)) {
          const key = routeKey(h, x.code); // hub-to-hub routes come up from both ends
          if (out.some((o) => routeKey(o.a, o.b) === key)) continue;
          const plan = this.rivalPlan(r, h, x.code);
          if (plan) out.push(plan);
        }
      }
      return out.sort((x, y) => y.value - x.value);
    },

    // routeKey -> [{ r: rival, rt: its route }]
    indexRivals() {
      const idx = new Map();
      for (const r of this.state.rivals || []) {
        for (const rt of r.routes) {
          const k = routeKey(rt.a, rt.b);
          if (!idx.has(k)) idx.set(k, []);
          idx.get(k).push({ r, rt });
        }
      }
      this.rivalIdx = idx;
    },
    rivalsOn(a, b) { return (this.rivalIdx && this.rivalIdx.get(routeKey(a, b))) || []; },
    rival(id) { return this.state.rivals.find((r) => r.id === id); },

    // Seats per day the player's active schedules offer from a to b (a rough daily plan).
    playerSeats(a, b) {
      const s = this.state;
      const sig = s.planes.map((p) => `${p.id}${p.type}${p.schedule.active ? 1 : 0}${p.schedule.stops.join('')}`).join('|');
      if (sig !== this.seatSig || !this.seatMap) {
        this.seatSig = sig;
        const m = new Map();
        const span = C.curfew.end - C.curfew.start;
        for (const p of s.planes) {
          const st = p.schedule.stops;
          if (!p.schedule.active || st.length < 2) continue;
          let loop = 0;
          let block = 0;
          for (let i = 0; i < st.length; i++) {
            const bm = blockMinutes(p.type, dist(st[i], st[(i + 1) % st.length]));
            loop += bm + C.turnaroundMin;
            block += bm;
          }
          const loops = Math.max(1, Math.min(span / loop, C.crewMaxDutyMin / block));
          for (let i = 0; i < st.length; i++) {
            const k = `${st[i]}>${st[(i + 1) % st.length]}`;
            m.set(k, (m.get(k) || 0) + loops * D.aircraft[p.type].seats);
          }
        }
        this.seatMap = m;
      }
      return this.seatMap.get(`${a}>${b}`) || 0;
    },

    // Routes the player's schedules fly (both directions together), busiest first.
    playerRoutes() {
      this.playerSeats('', '');
      const seen = new Map();
      for (const [k, seats] of this.seatMap) {
        const [a, b] = k.split('>');
        const key = routeKey(a, b);
        if (!seen.has(key)) seen.set(key, { a, b, seats: 0 });
        seen.get(key).seats += seats;
      }
      return [...seen.values()].map((x) => ({ ...x, pax: this.paxDemand(x.a, x.b) })).sort((x, y) => y.pax - x.pax);
    },

    // Attractiveness of an offer on a route: seats per day ^ capacityExp × fare ^ -elasticity.
    pull(seats, fare) { return Math.pow(Math.max(1, seats), C.rivals.capacityExp) * Math.pow(fare, -C.ticket.elasticity); },

    // The player's share of the passengers on a–b against the rivals flying it (1 = no competition).
    // minSeats: count at least this many seats for the player (a plane about to fly it).
    marketShare(a, b, minSeats = 0) {
      const comp = this.rivalsOn(a, b);
      if (!comp.length) return 1;
      const mine = this.pull(Math.max(minSeats, this.playerSeats(a, b)), this.fareFactor(a, b));
      const theirs = comp.reduce((sum, c) => sum + this.pull(c.rt.perDay * c.rt.seats, c.rt.fare), 0);
      return mine / (mine + theirs);
    },

    // Passengers a day the player can expect from a to b: demand at its fare × its market share.
    paxDemand(a, b, minSeats = 0) {
      return Math.round(this.demand(a, b) * this.marketShare(a, b, minSeats));
    },

    // How a rival route is doing: its load factor and the player's share there.
    rivalLoad(rt) {
      const comp = this.rivalsOn(rt.a, rt.b);
      let total = comp.reduce((sum, c) => sum + this.pull(c.rt.perDay * c.rt.seats, c.rt.fare), 0);
      const mySeats = (this.playerSeats(rt.a, rt.b) + this.playerSeats(rt.b, rt.a)) / 2;
      const mine = mySeats > 0 ? this.pull(mySeats, this.fareFactor(rt.a, rt.b)) : 0;
      total += mine;
      const share = this.pull(rt.perDay * rt.seats, rt.fare) / total;
      const pax = dailyDemand(rt.a, rt.b) * Math.pow(rt.fare, -C.ticket.elasticity) * share * this.eventDemandMult(rt.a, rt.b);
      return { load: pax / (rt.perDay * rt.seats), share, playerShare: mine / total };
    },

    // Every Monday: rivals add flights on full routes, cut them on empty ones, fight the player on
    // shared routes with lower fares, and sometimes open a new route (now and then one of the player's).
    rivalsWeek() {
      const R = C.rivals;
      let story = null;
      for (const r of this.state.rivals) {
        for (const rt of r.routes.slice()) {
          const { load, playerShare } = this.rivalLoad(rt);
          const route = `${rt.a}–${rt.b}`;
          const you = playerShare > 0;
          if (you && playerShare >= R.fareWar.share && rt.fare > R.fareWar.minFactor) {
            rt.fare = Math.max(R.fareWar.minFactor, Math.round((rt.fare - R.fareWar.cut) * 100) / 100);
            this.log(`⚔ ${r.name} cuts its fares on ${route} to ${Math.round(rt.fare * 100)}% to win passengers back from you.`, 'bad');
            if (!story) story = this.rivalStory('fares', r, rt);
          } else if (!you && rt.fare < R.fare[r.kind]) {
            rt.fare = Math.min(R.fare[r.kind], Math.round((rt.fare + R.fareWar.cut) * 100) / 100);
          }
          if (load > 0.95 && rt.perDay < R.maxPerDay) {
            rt.perDay++;
            rt.weak = 0;
            if (you) this.log(`${r.name} adds a flight on ${route} (now ${rt.perDay}× a day).`, 'bad');
          } else if (load < 0.45) {
            rt.weak = (rt.weak || 0) + 1;
            if (rt.weak >= 2) {
              rt.weak = 0;
              rt.perDay--;
              if (rt.perDay <= 0) {
                r.routes.splice(r.routes.indexOf(rt), 1);
                if (you) this.log(`🏳 ${r.name} gives up ${route} – the route is yours.`, 'good');
              } else if (you) {
                this.log(`${r.name} drops a flight on ${route} (now ${rt.perDay}× a day).`, 'good');
              }
            }
          } else {
            rt.weak = 0;
          }
        }
        this.indexRivals();
        if (Math.random() < R.growth) {
          const added = this.rivalExpand(r);
          if (added && added.attack && !story) story = this.rivalStory('enter', r, added.rt);
          this.indexRivals();
        }
      }
      if (story) this.news(story);
      this.dirty = true;
    },

    // A rival opens a route: sometimes one the player flies (from its hub, or for a low-cost
    // carrier from a new base at the bigger end), otherwise its best one not flown yet.
    rivalExpand(r) {
      const R = C.rivals;
      if (Math.random() < R.attack) {
        for (const x of this.playerRoutes()) {
          if (this.rivalsOn(x.a, x.b).some((c) => c.r === r)) continue;
          let base = r.hubs.includes(x.a) ? x.a : r.hubs.includes(x.b) ? x.b : null;
          if (!base && r.kind === 'low') {
            const big = airportSize(x.a) >= airportSize(x.b) ? x.a : x.b;
            const near = distanceKm(airportByCode[r.hubs[0]], airportByCode[big]) < 3000;
            if (airportSize(big) >= 3 && near) base = big;
          }
          if (!base) continue;
          const plan = this.rivalPlan(r, base, base === x.a ? x.b : x.a);
          if (!plan) continue;
          if (!r.hubs.includes(base)) r.hubs.push(base);
          r.routes.push(plan);
          this.log(`⚔ ${r.name} starts flying ${plan.a}–${plan.b} (${plan.perDay}× a day, fares ` +
            `${Math.round(plan.fare * 100)}%) – one of your routes.`, 'bad');
          return { rt: plan, attack: true };
        }
      }
      const best = this.rivalCandidates(r, 15)[0];
      if (!best) return null;
      r.routes.push(best);
      return { rt: best, attack: false };
    },

    rivalStory(kind, r, rt) {
      const A = airportByCode[rt.a];
      const B = airportByCode[rt.b];
      const company = this.state.company;
      if (kind === 'enter') {
        return {
          kind: 'bad', picture: 'chart',
          headline: `${r.name.toUpperCase()} MUSCLES IN ON ${A.city.toUpperCase()}–${B.city.toUpperCase()}`,
          sub: `New competition for ${company}`,
          body: `${r.name} will fly between ${A.city} and ${B.city} ${rt.perDay} times a day, with tickets at ` +
            `${Math.round(rt.fare * 100)}% of the usual price. Analysts expect ${company} to lose passengers on the route ` +
            'unless it adds flights or cuts its own fares.',
        };
      }
      return {
        kind: 'bad', picture: 'chart',
        headline: `FARE WAR ON ${A.city.toUpperCase()}–${B.city.toUpperCase()}`,
        sub: `${r.name} slashes ticket prices`,
        body: `Stung by ${company}'s success between ${A.city} and ${B.city}, ${r.name} has cut its fares to ` +
          `${Math.round(rt.fare * 100)}% of the usual price. Travellers rejoice; airline shareholders less so.`,
      };
    },

    // A rival goes out of business (newspaper event); returns it, or null if none is left.
    bustRival() {
      const s = this.state;
      if (!s.rivals || !s.rivals.length) return null;
      const small = s.rivals.filter((r) => r.kind !== 'flag');
      const pool = small.length ? small : s.rivals;
      const r = pool[Math.floor(Math.random() * pool.length)];
      s.rivals.splice(s.rivals.indexOf(r), 1);
      this.indexRivals();
      this.dirty = true;
      return r;
    },

    // Rival planes in the air at time t (fractional minutes): departures spread evenly between the
    // start and end of the curfew window on every route, both ways, along the great circle.
    rivalFlights(t) {
      const out = [];
      const day = Math.floor(t / DAY);
      const tod = t - day * DAY;
      const span = C.curfew.end - C.curfew.start;
      for (const r of this.state.rivals || []) {
        for (const rt of r.routes) {
          const A = airportByCode[rt.a];
          const B = airportByCode[rt.b];
          if (!A || !B) continue;
          const block = blockMinutes(rt.type, distanceKm(A, B));
          for (let dir = 0; dir < 2; dir++) {
            const [f, g] = dir ? [B, A] : [A, B];
            const phase = hash01(r.id.charCodeAt(1), rt.a.charCodeAt(0) * 131 + rt.b.charCodeAt(2), dir);
            for (let i = 0; i < rt.perDay; i++) {
              const dep = C.curfew.start + ((i + phase) * span) / rt.perDay;
              for (const back of [0, DAY]) { // long flights from yesterday may still be airborne
                const x = (tod + back - dep) / block;
                if (x < 0 || x >= 1) continue;
                const [lat, lon] = interpolate(f, g, x);
                const ahead = interpolate(f, g, Math.min(1, x + 0.01));
                out.push({ r, rt, from: f.code, to: g.code, frac: x, lat, lon,
                  heading: bearing({ lat, lon }, { lat: ahead[0], lon: ahead[1] }) });
              }
            }
          }
        }
      }
      return out;
    },

    changeFare(a, b, steps) {
      const T = C.ticket;
      const f = Math.round((this.fareFactor(a, b) + steps * T.step) * 100) / 100;
      this.state.fares[routeKey(a, b)] = Math.min(T.maxFactor, Math.max(T.minFactor, f));
      this.dirty = true;
    },

    // ---------- simulation ----------
    advance(minutes) {
      for (let i = 0; i < minutes && !this.state.gameOver; i++) {
        this.state.time++;
        if (this.state.time % DAY === 0) this.newDay();
        for (const p of this.state.planes) this.updatePlane(p);
      }
    },

    newDay() {
      const s = this.state;
      const day = s.time / DAY;
      const t = s.today;
      s.history.unshift({ day: day - 1, ...t, cash: s.money });
      if (s.history.length > 60) s.history.length = 60;
      this.log(`Day ${day} closed: ${t.flights} flights, ${t.pax} pax, ` +
        `operating result ${fmtMoney(t.revenue - t.cost)}.`, 'summary');
      s.today = { revenue: 0, cost: 0, fixed: 0, flights: 0, pax: 0 };
      s.carriedToday = {};
      s.crews.forEach((c) => { c.dutyToday = 0; });
      // punctuality counts the last few weeks most
      s.rep.onTime *= 0.93;
      s.rep.late *= 0.93;

      if (day % 7 === 0) {
        const w = this.weeklyCosts();
        s.money -= w.total;
        s.today.fixed += w.total;
        this.log(`Weekly costs paid: ${fmtMoney(w.total)} (aircraft ${fmtMoney(w.planes)}, ` +
          `crew ${fmtMoney(w.crews)}, slots ${fmtMoney(w.slots)}).`, 'cost');
        this.payDividends();
        this.refreshMarket();
        this.rivalsWeek();
      }
      this.rollWorldEvent();
      this.finishProjects();
      if (s.money < this.bankruptcyLimit()) {
        s.gameOver = true;
        this.log('Bankrupt! Your airline has run out of money. Start a new game.', 'bad');
      }
    },

    updatePlane(p) {
      const t = this.state.time;
      if (p.status === 'flying' && p.flight.crashAt && t >= p.flight.crashAt) { this.crash(p); return; }
      if (p.status === 'flying' && t >= p.flight.arr) this.land(p);
      if (p.status === 'turnaround' && t >= p.readyAt) {
        p.status = 'idle';
        p.repair = null;
        this.dirty = true;
      }
      if (p.status === 'idle') this.tryDepart(p);
    },

    land(p) {
      const s = this.state;
      const f = p.flight;
      const result = f.revenue - f.cost;
      p.location = f.to;
      p.stand = { code: f.to, k: f.standTo != null ? f.standTo : this.freeStand(f.to, p.id) };
      p.status = 'turnaround';
      p.readyAt = s.time + C.turnaroundMin;
      p.flight = null;
      s.money += result;
      if (f.kind === 'scheduled' || f.kind === 'ferry') {
        s.fees[f.to] = (s.fees[f.to] || 0) + landingFee(f.to) + f.pax * C.paxFee;
      }
      s.today.revenue += f.revenue;
      s.today.cost += f.cost;
      p.stats.profit += result;
      if (f.kind === 'scheduled') {
        s.today.flights++;
        s.rep.flown++;
        s.today.pax += f.pax;
        p.stats.flights++;
        p.stats.pax += f.pax;
        const seats = D.aircraft[p.type].seats;
        this.log(`${p.id} ${f.from}→${f.to}: ${f.pax}/${seats} pax, revenue ${fmtMoney(f.revenue)}, ` +
          `cost ${fmtMoney(f.cost)} → ${fmtMoney(result)}`, result >= 0 ? 'good' : 'bad');
      } else if (f.kind === 'delivery') {
        this.log(`${p.id} (${D.aircraft[p.type].name}) delivered to ${f.to} from ${airportByCode[f.from].name}.`, 'good');
      } else {
        this.log(`${p.id} ferried ${f.from}→${f.to} (cost ${fmtMoney(f.cost)}).`, 'cost');
      }
      if (f.incident) this.incident(p, f);
    },

    // Decide where an idle plane goes next, if anywhere.
    nextLeg(p) {
      if (p.pendingFerry) {
        if (p.pendingFerry === p.location) {
          p.pendingFerry = null;
          this.dirty = true;
          return null;
        }
        return { to: p.pendingFerry, kind: 'ferry' };
      }
      const sch = p.schedule;
      if (!sch.active || sch.stops.length < 2) return null;
      if (sch.legs && sch.legs.length) {
        // Timetable: the next leg leaves at its time of day (late if the plane is late).
        const leg = sch.legs[sch.index % sch.legs.length];
        if (p.location !== leg.from) return { to: leg.from, kind: 'ferry' };
        if (this.state.time < sch.due) return null;
        return { to: leg.to, kind: 'scheduled', nextIndex: (sch.index + 1) % sch.legs.length, timed: true };
      }
      if (p.location !== sch.stops[sch.index]) {
        return { to: sch.stops[sch.index], kind: 'ferry' }; // reposition to schedule start
      }
      const next = (sch.index + 1) % sch.stops.length;
      return { to: sch.stops[next], kind: 'scheduled', nextIndex: next };
    },

    tryDepart(p) {
      const s = this.state;
      const t = s.time;
      const crew = this.crewOf(p);
      if (!crew) return;
      const leg = this.nextLeg(p);
      if (!leg) {
        if (p.waitSlot) { p.waitSlot = null; this.dirty = true; }
        return;
      }

      if (!this.ownsSlot(leg.to)) {
        this.stopPlane(p, `${p.id} has no slot at ${leg.to} – stopped.`);
        return;
      }
      const unfit = fitsReason(p.type, leg.to);
      if (unfit) {
        this.stopPlane(p, `${p.id} stopped: ${unfit}`);
        return;
      }
      const ac = D.aircraft[p.type];
      const d = dist(p.location, leg.to);
      if (d > ac.rangeKm) {
        this.stopPlane(p, `${leg.to} is out of range for ${p.id} – stopped.`);
        return;
      }
      const tod = t % DAY;
      if (tod < C.curfew.start || tod > C.curfew.end) return; // night curfew
      if (this.holdReason(p, leg.to)) return; // strike, weather, repairs
      const block = blockMinutes(p.type, d);
      if (crew.dutyToday + block > C.crewMaxDutyMin) return; // crew rests until tomorrow
      // Every slot at the destination taken when we would land: wait at the gate until one frees up.
      const full = !this.slotFreeAt(leg.to, t + block, p.id);
      if (full !== (p.waitSlot === leg.to)) { p.waitSlot = full ? leg.to : null; this.dirty = true; }
      if (full) return;

      let pax = 0;
      let revenue = 0;
      if (leg.kind === 'scheduled') {
        const key = `${p.location}-${leg.to}`;
        const left = Math.max(0, this.paxDemand(p.location, leg.to, ac.seats) - (s.carriedToday[key] || 0));
        const luck = 0.85 + Math.random() * 0.3;
        pax = Math.min(ac.seats, left, Math.round(left * luck));
        s.carriedToday[key] = (s.carriedToday[key] || 0) + pax;
        revenue = pax * this.fare(p.location, leg.to);
        p.schedule.index = leg.nextIndex;
        if (leg.timed) {
          // punctual: within 15 minutes of the timetable
          if (t - p.schedule.due > 15) s.rep.late++;
          else s.rep.onTime++;
          p.schedule.due = nextAt(p.schedule.legs[leg.nextIndex].dep, p.schedule.due + 1);
        }
      } else if (p.pendingFerry === leg.to) {
        p.pendingFerry = null;
      }

      p.flight = {
        from: p.location, to: leg.to, kind: leg.kind,
        dep: t, arr: t + block, distance: Math.round(d),
        pax, revenue, cost: flightCost(p.type, d, leg.to, pax, this.costMult(p) * this.fuelMult() * this.difficulty().costMult),
        standFrom: this.standAt(p), standTo: this.freeStand(leg.to, p.id),
      };
      this.rollFlightEvents(p);
      p.status = 'flying';
      p.waitSlot = null;
      crew.dutyToday += block;
      this.dirty = true;
    },

    stopPlane(p, msg) {
      p.schedule.active = false;
      p.pendingFerry = null;
      this.log(msg, 'bad');
    },

    // ---------- random events ----------
    mode() { return C.modes[this.state.mode] || C.modes[C.defaultMode]; },
    difficulty() { return C.difficulties[this.state.difficulty] || C.difficulties[C.defaultDifficulty]; },
    bankruptcyLimit() { return this.difficulty().bankruptcyLimit; },
    home() { return this.state.home || C.startAirport; },
    makerMult(type) { return this.mode().makerCrashMult[D.aircraft[type].maker] || 1; },
    crashChance(type) { return C.events.crashPerFlight * this.makerMult(type); },

    activeEffects() {
      const s = this.state;
      return s.effects.filter((e) => e.until > s.time);
    },

    effectHits(e, code) {
      const w = e.where;
      const ap = airportByCode[code];
      return !!(w.all || w.airport === code || (w.country && w.country === ap.country) ||
        (w.near && distanceKm(ap, w.near) <= w.radiusKm));
    },

    eventDemandMult(a, b) {
      let m = 1;
      for (const e of this.activeEffects()) {
        if (e.demandMult && (this.effectHits(e, a) || this.effectHits(e, b))) m *= e.demandMult;
      }
      return m;
    },

    fuelMult() {
      return this.activeEffects().reduce((m, e) => m * (e.costMult || 1), 1);
    },

    // ---------- slots ----------
    // A slot is room for one of your planes on the ground. It is only taken while a plane stands in it
    // (or is on its way to land there): when it is empty, any of your planes can use it.

    // Will plane q still stand at `code` at time t? Planes that fly on (a running timetable due before
    // t, or a ferry) let their slot go; parked and paused planes keep it.
    staysUntil(q, code, t) {
      if (q.status === 'flying' || q.location !== code) return false;
      if (q.pendingFerry && q.pendingFerry !== code) return q.status === 'turnaround' && q.readyAt > t;
      const sch = q.schedule;
      if (!sch.active || sch.stops.length < 2) return true;
      if (sch.legs && sch.legs.length) {
        const leg = sch.legs[sch.index % sch.legs.length];
        if (leg.from !== code) return (q.readyAt || 0) > t; // ferries to its next departure airport
        return Math.max(sch.due || 0, q.readyAt || 0) > t;
      }
      return (q.readyAt || 0) > t;
    },

    // Your planes in or heading for a slot at an airport: [{ p, how: 'parked' | 'turnaround' | 'leaving' | 'inbound' }].
    slotOccupants(code) {
      const out = [];
      const t = this.state.time;
      for (const q of this.state.planes) {
        if (q.status === 'flying' && q.flight && q.flight.to === code) out.push({ p: q, how: 'inbound' });
        else if (q.status !== 'flying' && q.location === code) {
          out.push({ p: q, how: !this.staysUntil(q, code, t + 30) ? 'leaving' : q.status === 'turnaround' ? 'turnaround' : 'parked' });
        }
      }
      return out;
    },

    // Is one of your slots at `code` free for a plane landing at time t (not counting plane `planeId`)?
    slotFreeAt(code, t, planeId) {
      let used = 0;
      for (const q of this.state.planes) {
        if (q.id === planeId) continue;
        if (q.status === 'flying' && q.flight && q.flight.to === code) {
          // Lands before us but flies on (its timetable) before we arrive: it doesn't need the slot then.
          const sch = q.schedule;
          const leg = sch.active && sch.legs && sch.legs.length && sch.legs[sch.index % sch.legs.length];
          const gone = leg && leg.from === code && Math.max(sch.due || 0, q.flight.arr + C.turnaroundMin) < t;
          if (!gone) used++;
        } else if (this.staysUntil(q, code, t)) used++;
      }
      return used < this.slotCount(code);
    },

    // ---------- the slots of an airport ----------
    // An airport has one slot per aircraft stand (apronOf: the real stands where there is a real layout).
    // You hold some, rivals hold those for their flights there (a few more at their hubs), other airlines a
    // share that grows with the airport's size; the rest are free to lease. When none is free you can make
    // a holder an offer for one of theirs: the airport agrees depending on the offer and your reputation.
    slotCapacity(code) {
      return Math.max(this.slotCount(code), 2, apronOf(code).stands.length);
    },
    // Who holds the slots: [{ id, name, color, n, hub }] (rivals, then 'others'), at most what is left.
    slotHolders(code) {
      const a = airportByCode[code];
      const bought = this.state.slotBuys[code] || {};
      const cap = this.slotCapacity(code);
      let left = cap - this.slotCount(code);
      const out = [];
      for (const r of this.state.rivals || []) {
        const hub = r.hubs.includes(code);
        const n = Math.min(left, Math.max(0, this.rivalSlotNeed(r, code) - (bought[r.id] || 0)));
        if (n <= 0) continue;
        left -= n;
        out.push({ id: r.id, name: r.name, color: r.color, n, hub });
      }
      if (a && !a.built) {
        const n = Math.min(left, Math.max(0, Math.round(cap * A.otherAirlines[airportSize(code)]) - (bought.others || 0)));
        if (n > 0) out.push({ id: 'others', name: 'Other airlines', color: '#64748b', n, hub: false });
      }
      return out;
    },
    // Slots a rival's flights need at an airport: one per 4 daily flights on each route, 2 more at a hub.
    rivalSlotNeed(r, code) {
      let n = r.hubs.includes(code) ? 2 : 0;
      for (const rt of r.routes) if (rt.a === code || rt.b === code) n += Math.ceil(rt.perDay / 4);
      return n;
    },
    freeSlots(code) {
      return Math.max(0, this.slotCapacity(code) - this.slotCount(code) - this.slotHolders(code).reduce((n, h) => n + h.n, 0));
    },
    // What leasing a free slot costs upfront: nothing at an airport you control.
    slotPrice(code) { return this.stake(code) >= A.majorityStake ? 0 : slotUpfront(code); },

    // Reputation 0-100: { value, parts: [[label, points]] }. With `code`: as that airport sees you (your
    // shares there count, and your home base knows you).
    reputation(code) {
      const s = this.state;
      const R = A.reputation;
      const parts = [['Base', R.base]];
      parts.push(['Flights flown', Math.min(R.experienceMax, s.rep.flown / R.flightsPerPoint)]);
      const n = s.rep.onTime + s.rep.late;
      if (n >= 5) parts.push(['Punctuality', Math.max(-R.punctuality, Math.min(R.punctuality * 0.6, (s.rep.onTime / n - 0.85) * R.punctuality * 6))]);
      const fade = (list, pts, days) => list.reduce((sum, t) => sum + pts * Math.max(0, 1 - (s.time - t) / (days * DAY)), 0);
      const crash = fade(s.rep.crashes, R.crash, R.crashDays);
      if (crash) parts.push(['Crashes', -crash]);
      const inc = fade(s.rep.incidents, R.incident, R.incidentDays);
      if (inc) parts.push(['Incidents', -inc]);
      if (code) {
        if (this.stake(code)) parts.push([`Your ${this.stake(code)}% of ${code}`, this.stake(code) * R.perStake]);
        if (code === this.home()) parts.push(['Home base', R.home]);
      }
      const value = Math.round(Math.max(0, Math.min(100, parts.reduce((sum, x) => sum + x[1], 0))));
      return { value, parts: parts.map(([l, v]) => [l, Math.round(v)]) };
    },

    // A fair price for taking over a slot someone holds (more at a rival's hub).
    slotOfferPrice(code, holder) {
      const r = this.rival(holder);
      return slotUpfront(code) * A.offer.fairUpfronts * (r && r.hubs.includes(code) ? A.offer.hubFactor : 1);
    },
    // Chance (0..0.95) that the airport agrees to move one of `holder`'s slots to you for `amount`.
    slotOfferChance(code, holder, amount) {
      const O = A.offer;
      const rep = this.reputation(code).value;
      const v = (amount / this.slotOfferPrice(code, holder)) * (O.repLow + (rep / 100) * (O.repHigh - O.repLow));
      return Math.max(0, Math.min(O.maxChance, (v - O.from) / O.span));
    },
    // Make an offer; the airport decides at once. Error string, or { accepted, text }.
    makeSlotOffer(code, holder, amount) {
      const s = this.state;
      const a = airportByCode[code];
      const h = this.slotHolders(code).find((x) => x.id === holder);
      if (!h) return 'They hold no slot there any more.';
      if (this.freeSlots(code)) return 'A slot is free there: lease that one.';
      amount = Math.round(amount);
      if (amount <= 0) return 'Offer something.';
      if (s.money < amount) return `Not enough money (${fmtMoney(amount)}).`;
      const key = `${code}|${holder}`;
      if (s.offers[key] && s.time - s.offers[key] < DAY) return `${a.name} won't look at another offer for ${h.name}'s slots before tomorrow.`;
      if (Math.random() >= this.slotOfferChance(code, holder, amount)) {
        s.offers[key] = s.time;
        this.log(`${a.name} turned down your offer of ${fmtMoney(amount)} for one of ${h.name}'s slots.`, 'bad');
        return { accepted: false, text: `${a.name} turned your offer down. Try again tomorrow, with more money or a better reputation.` };
      }
      s.money -= amount;
      s.today.cost += amount;
      delete s.offers[key];
      if (s.slots[code]) s.slots[code].count = this.slotCount(code) + 1;
      else s.slots[code] = { since: s.time, count: 1 };
      // The rival gives up a daily flight there (its busiest route through the airport). It holds exactly
      // one slot less: what the dropped flight frees is counted against what you bought.
      const r = this.rival(holder);
      const need = r ? this.rivalSlotNeed(r, code) : 0;
      let dropped = '';
      if (r) {
        const rt = r.routes.filter((x) => x.a === code || x.b === code).sort((x, y) => y.perDay - x.perDay)[0];
        if (rt) {
          rt.perDay--;
          dropped = rt.perDay > 0 ? ` and flies ${rt.a}–${rt.b} once a day less` : ` and stops flying ${rt.a}–${rt.b}`;
          if (rt.perDay <= 0) r.routes.splice(r.routes.indexOf(rt), 1);
          this.indexRivals();
        }
      }
      s.slotBuys[code] = s.slotBuys[code] || {};
      s.slotBuys[code][holder] = (s.slotBuys[code][holder] || 0) + 1 - (r ? need - this.rivalSlotNeed(r, code) : 0);
      this.log(`${a.name} moved one of ${h.name}'s slots to you for ${fmtMoney(amount)}${dropped}.`, 'good');
      this.dirty = true;
      return { accepted: true, text: `Accepted! You now hold ${this.slotCount(code)} slot${this.slotCount(code) === 1 ? '' : 's'} at ${code}.` };
    },

    // Why this plane can't leave for `to` right now (strike, weather), or null.
    holdReason(p, to) {
      for (const e of this.activeEffects()) {
        if (e.noFlights && (this.effectHits(e, p.location) || (to && this.effectHits(e, to)))) return e.label;
      }
      return null;
    },

    news(story) {
      const s = this.state;
      const papers = D.newspapers;
      s.news.push({ ...story, t: s.time, paper: papers[Math.floor(Math.random() * papers.length)] });
      this.log(`📰 ${story.headline[0]}${story.headline.slice(1).toLowerCase()} – ${story.sub}`, story.kind);
    },

    // Helpers handed to the event catalogue in js/data/events.js.
    eventContext() {
      const s = this.state;
      const pick = (list) => list[Math.floor(Math.random() * list.length)];
      return {
        state: s,
        pick,
        rand: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
        fmtMoney,
        slotAirport: (filter = () => true) => {
          const list = Object.keys(s.slots).map((c) => airportByCode[c]).filter(filter);
          return list.length ? pick(list) : null;
        },
        effect: ({ hours, where, ...rest }) => {
          const w = where.near ? { near: { lat: where.near.lat, lon: where.near.lon }, radiusKm: where.radiusKm } : where;
          s.effects.push({ ...rest, where: w, until: s.time + Math.round(hours * 60) });
          this.dirty = true;
        },
        bustRival: () => this.bustRival(),
        money: (amount, text) => {
          s.money += amount;
          if (amount < 0) s.today.fixed -= amount;
          if (text) this.log(text, amount < 0 ? 'cost' : 'good');
        },
      };
    },

    rollWorldEvent() {
      const s = this.state;
      s.effects = this.activeEffects();
      if (Math.random() >= C.events.perDay) return;
      const list = D.worldEvents;
      let r = Math.random() * list.reduce((sum, e) => sum + e.weight, 0);
      const ev = list.find((e) => (r -= e.weight) < 0) || list[0];
      const story = ev.make(this.eventContext());
      if (story) this.news(story);
    },

    // At take-off: will this flight crash, or have an incident?
    rollFlightEvents(p) {
      const f = p.flight;
      const r = Math.random();
      if (r < this.crashChance(p.type)) {
        f.crashAt = f.dep + Math.max(1, Math.round((f.arr - f.dep) * (0.1 + Math.random() * 0.8)));
      } else if (r < this.crashChance(p.type) + C.events.incidentPerFlight) {
        f.incident = true;
      }
    },

    nearestPlace(lat, lon) {
      let best = null;
      let bestD = Infinity;
      for (const t of D.towns) {
        const d = distanceKm({ lat, lon }, t);
        if (d < bestD) { best = t; bestD = d; }
      }
      return best ? best.name : 'the coast';
    },

    crash(p) {
      const s = this.state;
      const f = p.flight;
      const ac = D.aircraft[p.type];
      const E = C.events;
      const frac = (s.time - f.dep) / (f.arr - f.dep);
      const [lat, lon] = interpolate(airportByCode[f.from], airportByCode[f.to], frac);
      const crew = this.crewOf(p);
      const onBoard = f.pax + (crew ? crew.pilots + crew.cabin : 2);
      const r = Math.random();
      const survivors = r < 0.35 ? onBoard : r < 0.7 ? Math.floor(onBoard * Math.random()) : 0;

      const compensation = f.pax * E.crashPaxCompensation + E.crashInvestigation;
      let hull;
      let cash;
      if (p.ownership === 'owned') {
        const value = this.saleValue(p);
        const insurance = Math.round(value * E.crashInsuranceShare);
        hull = value - insurance;
        cash = insurance - compensation;
      } else {
        hull = ac.leasePerWeek * E.crashLeasePenaltyWeeks;
        cash = -hull - compensation;
      }
      s.money += cash;
      if (cash < 0) s.today.cost += -cash;
      else s.today.revenue += cash;
      s.planes = s.planes.filter((x) => x !== p);
      s.crews = s.crews.filter((c) => c.id !== p.crewId);
      s.rep.crashes.push(s.time);
      const rep = E.crashReputation;
      s.effects.push({ label: `Bookings slump after the ${p.id} crash`, where: { all: true },
        demandMult: rep.demandMult, until: s.time + rep.days * DAY });

      const place = this.nearestPlace(lat, lon);
      this.log(`✖ ${p.id} (${ac.name}) crashed near ${place} on ${f.from}→${f.to}. ` +
        `${survivors}/${onBoard} survived. Cash effect ${fmtMoney(cash)}.`, 'bad');
      this.news(D.crashStory({
        id: p.id, company: s.company, type: ac.name, maker: ac.maker, from: f.from, to: f.to,
        place, pax: onBoard, survivors, cost: fmtMoney(compensation + hull),
      }));
      this.dirty = true;
    },

    incident(p, f) {
      const s = this.state;
      const maker = D.aircraft[p.type].maker;
      const list = D.incidents.filter((i) => !i.maker || i.maker === maker)
        .map((i) => ({ i, w: i.weight * (i.maker ? this.makerMult(p.type) : 1) }));
      let r = Math.random() * list.reduce((sum, x) => sum + x.w, 0);
      const inc = (list.find((x) => (r -= x.w) < 0) || list[0]).i;
      s.money -= inc.repair;
      s.today.cost += inc.repair;
      p.readyAt = Math.max(p.readyAt, s.time + inc.groundedHours * 60);
      p.repair = inc.id;
      s.rep.incidents.push(s.time);
      const ac = D.aircraft[p.type];
      this.news(inc.story({
        id: p.id, company: s.company, type: ac.name, from: f.from, to: f.to,
        airport: airportByCode[f.to].name, repair: fmtMoney(inc.repair),
      }));
    },

    // ---------- player actions (return an error string or null) ----------
    // Lease one of the free slots at an airport (the first, or one more).
    leaseSlot(code) {
      const s = this.state;
      const a = airportByCode[code];
      if (a.built && !a.open) return `${a.name} isn't open yet.`;
      if (!this.freeSlots(code)) return `All ${this.slotCapacity(code)} slots at ${code} are taken – make one of the holders an offer.`;
      const cost = this.slotPrice(code);
      if (s.money < cost) return `Not enough money (${fmtMoney(cost)} needed).`;
      s.money -= cost;
      if (s.slots[code]) s.slots[code].count = this.slotCount(code) + 1;
      else s.slots[code] = { since: s.time, count: 1 };
      const fee = this.slotFee(code);
      this.log(`Leased slot ${this.slotCount(code)} at ${a.name}${cost ? ` for ${fmtMoney(cost)}` : ' (yours: no charge)'}` +
        `${fee ? ` (+${fmtMoney(fee)}/week)` : ''}.`, 'cost');
      this.dirty = true;
      return null;
    },

    releaseSlot(code) {
      const s = this.state;
      if (code === this.home()) return 'You cannot give up your home base.';
      if (!s.slots[code]) return 'You have no slot there.';
      const used = s.planes.some((p) =>
        p.location === code || p.pendingFerry === code ||
        (p.flight && p.flight.to === code) || p.schedule.stops.includes(code));
      if (used) return 'A plane is there, heading there or scheduled there.';
      delete s.slots[code];
      for (const key of Object.keys(s.fares)) if (key.split('-').includes(code)) delete s.fares[key];
      this.log(`Released slot at ${airportByCode[code].name}.`);
      return null;
    },

    sendPlane(planeId, code) {
      const p = this.plane(planeId);
      if (!this.ownsSlot(code)) return `You need a slot at ${code} first.`;
      if (p.location === code && p.status !== 'flying') return `${p.id} is already at ${code}.`;
      if (!fitsAirport(p.type, code)) return fitsReason(p.type, code);
      if (dist(p.location, code) > D.aircraft[p.type].rangeKm) return 'Out of range.';
      p.schedule.active = false;
      p.pendingFerry = code;
      this.log(`${p.id} will ferry to ${code}${p.status === 'idle' ? '' : ' when ready'}.`);
      return null;
    },

    setSchedule(planeId, stops) {
      const p = this.plane(planeId);
      const ac = D.aircraft[p.type];
      if (stops.length < 2) return 'A schedule needs at least 2 stops.';
      for (let i = 0; i < stops.length; i++) {
        const a = stops[i];
        const b = stops[(i + 1) % stops.length];
        if (!this.ownsSlot(a)) return `No slot at ${a}.`;
        if (a === b) return `${a} follows itself – remove the duplicate.`;
        if (!fitsAirport(p.type, a)) return fitsReason(p.type, a);
        if (dist(a, b) > ac.rangeKm) return `${a}→${b} is out of range.`;
      }
      const legs = this.buildTimetable(p.type, stops, C.curfew.start + 60);
      if (legs.length < 2) return 'That route does not fit into one day.';
      return this.setTimetable(planeId, legs);
    },

    setScheduleActive(planeId, active) {
      const p = this.plane(planeId);
      if (active && p.schedule.stops.length < 2) return 'Create a schedule first.';
      p.schedule.active = active;
      p.waitSlot = null;
      if (active) p.pendingFerry = null;
      if (active && p.schedule.legs) this.syncTimetable(p);
      this.log(`${p.id} schedule ${active ? 'started' : 'paused'}.`);
      return null;
    },

    // ---------- fleet & market ----------
    planeAge(p) { return p.age + (this.state.time - p.acquiredAt) / DAY / 365; },
    costMult(p) { return agingMult(this.planeAge(p)); },
    // What you get for selling an owned plane today.
    saleValue(p) { return Math.round(usedPrice(p.type, this.planeAge(p)) * M.resaleFactor); },
    returnFee(p) { return D.aircraft[p.type].leasePerWeek * M.returnFeeWeeks; },
    leaseDeposit(type) { return D.aircraft[type].leasePerWeek * M.leaseDepositWeeks; },

    refreshMarket() {
      const m = this.state.market;
      m.listings = [];
      for (let i = 0; i < M.usedListings; i++) m.listings.push(randomUsedListing(m.nextId++));
      m.listings.sort((a, b) => a.price - b.price);
      this.dirty = true;
    },

    nextRegistration() {
      const used = new Set(this.state.planes.map((p) => p.id));
      const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      for (let i = 0; i < L.length ** 3; i++) {
        const id = M.registrationPrefix + L[Math.floor(i / 676) % 26] + L[Math.floor(i / 26) % 26] + L[i % 26];
        if (!used.has(id)) return id;
      }
      return `${M.registrationPrefix}${Date.now()}`;
    },

    // Shared checks for a delivery; returns an error string or null.
    checkDelivery(type, code, cost) {
      if (!this.ownsSlot(code)) return `You need a slot at ${code} for the delivery.`;
      if (!fitsAirport(type, code)) return fitsReason(type, code);
      if (this.state.money < cost) return `Not enough money (${fmtMoney(cost)} needed).`;
      return null;
    },

    // How a new plane gets to `code`: from its factory (new) or the seller's airport (used).
    deliveryFrom(type, code, used) {
      if (used) return used;
      const f = factoryOf(type);
      return f && f.code !== code ? f.code : null;
    },
    deliveryMinutes(type, from, code) {
      return from ? blockMinutes(type, dist(from, code)) : 0;
    },

    addPlane(type, code, ownership, age, from = null) {
      const s = this.state;
      const id = this.nextRegistration();
      const crewT = crewFor(type);
      const crewId = `crew-${id}`;
      s.crews.push({
        id: crewId, name: `Crew ${id}`, base: code,
        pilots: crewT.pilots, cabin: crewT.cabin, weeklySalary: crewT.weeklySalary, dutyToday: 0,
      });
      const p = {
        id, type, location: code, status: 'idle', readyAt: 0, flight: null, pendingFerry: null,
        ownership, age, acquiredAt: s.time, crewId,
        schedule: { stops: [], index: 0, active: false },
        stats: { flights: 0, pax: 0, profit: 0 },
      };
      if (from) {
        // Delivery flight, paid by the seller; ignores curfew and crew duty.
        const d = dist(from, code);
        p.location = from;
        p.status = 'flying';
        p.flight = { from, to: code, kind: 'delivery', dep: s.time, arr: s.time + blockMinutes(type, d),
          distance: Math.round(d), pax: 0, revenue: 0, cost: 0, standTo: this.freeStand(code, id) };
      } else {
        p.stand = { code, k: this.freeStand(code, id) };
      }
      s.planes.push(p);
      this.dirty = true;
      return id;
    },

    buyNew(type, code) {
      const cost = priceNew(type);
      const err = this.checkDelivery(type, code, cost);
      if (err) return err;
      this.state.money -= cost;
      const from = this.deliveryFrom(type, code);
      const id = this.addPlane(type, code, 'owned', 0, from);
      this.log(`Bought a new ${D.aircraft[type].name} (${id}) for ${fmtMoney(cost)}` +
        (from ? ` – delivery flight ${from} → ${code}.` : `, delivered to ${code}.`), 'cost');
      return null;
    },

    leaseNew(type, code) {
      const cost = this.leaseDeposit(type);
      const err = this.checkDelivery(type, code, cost);
      if (err) return err;
      this.state.money -= cost;
      const from = this.deliveryFrom(type, code);
      const id = this.addPlane(type, code, 'leased', 0, from);
      this.log(`Leased a ${D.aircraft[type].name} (${id}) – deposit ${fmtMoney(cost)}, ` +
        `${fmtMoney(D.aircraft[type].leasePerWeek)}/week` +
        (from ? ` – delivery flight ${from} → ${code}.` : `. Delivered to ${code}.`), 'cost');
      return null;
    },

    buyUsed(listingId, code) {
      const m = this.state.market;
      const l = m.listings.find((x) => x.id === listingId);
      if (!l) return 'That aircraft has already been sold.';
      const err = this.checkDelivery(l.type, code, l.price);
      if (err) return err;
      this.state.money -= l.price;
      m.listings = m.listings.filter((x) => x !== l);
      const from = l.at && l.at !== code ? l.at : null;
      const id = this.addPlane(l.type, code, 'owned', l.age, from);
      this.log(`Bought a used ${D.aircraft[l.type].name} (${id}, ${l.age} years) for ${fmtMoney(l.price)}` +
        (from ? ` – ferried in from ${from}.` : `, delivered to ${code}.`), 'cost');
      return null;
    },

    // Sell an owned plane or hand a leased one back.
    disposePlane(planeId) {
      const s = this.state;
      const p = this.plane(planeId);
      if (!p) return 'No such plane.';
      if (s.planes.length === 1) return 'You cannot give up your last plane.';
      if (p.status === 'flying') return `${p.id} is in the air – wait until it lands.`;
      const name = D.aircraft[p.type].name;
      if (p.ownership === 'owned') {
        const v = this.saleValue(p);
        s.money += v;
        this.log(`Sold ${p.id} (${name}) for ${fmtMoney(v)}.`, 'good');
      } else {
        const fee = this.returnFee(p);
        s.money -= fee;
        this.log(`Returned leased ${p.id} (${name}), return fee ${fmtMoney(fee)}.`, 'cost');
      }
      s.planes = s.planes.filter((x) => x !== p);
      s.crews = s.crews.filter((c) => c.id !== p.crewId);
      return null;
    },

    // ---------- airports: shares, dividends, construction ----------
    stake(code) { return infra(code).stake || 0; },
    infraOf(code) {
      const s = this.state;
      if (!s.infra[code]) s.infra[code] = {};
      return s.infra[code];
    },
    airportPaxYear(code) {
      return Math.round(catchment(code) * A.paxPerHead[airportSize(code)] * attraction(code));
    },
    // Weekly operating profit: base traffic plus what your airline paid there this week.
    airportProfit(code) {
      return Math.round(this.airportPaxYear(code) / 52 * A.profitPerPax + (this.state.fees[code] || 0));
    },
    airportValue(code) {
      const base = this.airportPaxYear(code) / 52 * A.profitPerPax;
      return Math.round((base * 52 * A.peRatio + (infra(code).invested || 0) * A.investedValue) / 1000) * 1000;
    },
    sharePrice(code, pct) { return Math.round(this.airportValue(code) * pct / 100 * A.buyPremium); },
    shareSale(code, pct) { return Math.round(this.airportValue(code) * pct / 100 * A.sellDiscount); },

    buyShares(code, pct = A.shareStep) {
      const s = this.state;
      const a = airportByCode[code];
      if (a.factory) return 'Factories are not for sale.';
      pct = Math.min(pct, 100 - this.stake(code));
      if (pct <= 0) return `You already own all of ${a.name}.`;
      const cost = this.sharePrice(code, pct);
      if (s.money < cost) return `Not enough money (${fmtMoney(cost)} needed).`;
      s.money -= cost;
      const inf = this.infraOf(code);
      inf.stake = (inf.stake || 0) + pct;
      this.log(`Bought ${pct}% of ${a.name} for ${fmtMoney(cost)} – you now own ${inf.stake}%.`, 'cost');
      this.dirty = true;
      return null;
    },

    sellShares(code, pct = A.shareStep) {
      const s = this.state;
      const a = airportByCode[code];
      pct = Math.min(pct, this.stake(code));
      if (pct <= 0) return 'You own no shares there.';
      if (a.built && this.stake(code) - pct < A.majorityStake) return 'You must keep the majority of an airport you built.';
      const value = this.shareSale(code, pct);
      s.money += value;
      const inf = this.infraOf(code);
      inf.stake -= pct;
      this.log(`Sold ${pct}% of ${a.name} for ${fmtMoney(value)} – you now own ${inf.stake}%.`, 'good');
      this.dirty = true;
      return null;
    },

    // Mondays: shareholders get their part of last week's profit.
    payDividends() {
      const s = this.state;
      let total = 0;
      const parts = [];
      for (const code of Object.keys(s.infra)) {
        const st = this.stake(code);
        if (!st) continue;
        const d = Math.round(this.airportProfit(code) * A.payout * st / 100);
        total += d;
        parts.push(`${code} ${fmtMoney(d)}`);
      }
      s.fees = {};
      if (!total) return;
      s.money += total;
      s.today.revenue += total;
      this.log(`Airport dividends: ${fmtMoney(total)} (${parts.join(', ')}).`, 'good');
    },

    // What can be built at an airport right now, with cost (your share) and an error if not possible.
    projectOptions(code) {
      const a = airportByCode[code];
      const st = this.stake(code);
      const share = st / 100;
      const busy = this.state.projects.some((p) => p.code === code);
      const base = busy ? 'Construction already under way here.'
        : st < A.boardStake ? `You need ${A.boardStake}% of the shares to order construction.` : null;
      const opts = [];
      const longest = longestRunway(code, true);
      const hasRunways = airportRunways(code).length > 0;
      for (const len of A.runwayLengths) {
        for (const orient of hasRunways ? ['parallel', 'cross'] : ['new']) {
          const full = A.runwayCost.base + A.runwayCost.perM * len;
          opts.push({
            kind: 'runway', len, orient, full, cost: Math.round(full * share),
            weeks: Math.round(A.runwayWeeks.base + A.runwayWeeks.perKm * len / 1000),
            label: `${orient === 'cross' ? 'Crosswind' : orient === 'parallel' ? 'Parallel' : 'New'} runway ${len} m`,
            err: base,
          });
        }
      }
      if (hasRunways) {
        opts.push({
          kind: 'extend', full: A.extendCost, cost: Math.round(A.extendCost * share), weeks: A.extendWeeks,
          label: `Extend main runway +${A.extendBy} m (to ${longestRunway(code) + A.extendBy} m)`,
          err: base || (longestRunway(code) + A.extendBy > A.maxRunwayM ? 'The main runway is as long as it gets.' : null),
        });
      }
      const next = airportSize(code) + 1;
      if (next <= 5 && !a.factory) {
        const full = A.terminalCost[next];
        opts.push({
          kind: 'terminal', full, cost: Math.round(full * share), weeks: A.terminalWeeks[next],
          label: `Terminal & gates → size ${next}`,
          err: base || (longest < A.terminalRunway[next] ? `Needs a ${A.terminalRunway[next]} m paved runway first.` : null),
        });
      }
      return opts;
    },

    startProject(code, kind, len, orient) {
      const s = this.state;
      const o = this.projectOptions(code).find((x) => x.kind === kind &&
        (kind !== 'runway' || (x.len === Number(len) && x.orient === orient)));
      if (!o) return 'That project is not available.';
      if (o.err) return o.err;
      if (s.money < o.cost) return `Not enough money (${fmtMoney(o.cost)} needed).`;
      s.money -= o.cost;
      s.projects.push({ code, kind, len: o.len, orient: o.orient, label: o.label, cost: o.cost, full: o.full,
        start: s.time, done: s.time + o.weeks * 7 * DAY });
      this.log(`Construction started at ${airportByCode[code].name}: ${o.label} – your share ${fmtMoney(o.cost)}, ` +
        `ready in ${o.weeks} weeks.`, 'cost');
      this.dirty = true;
      return null;
    },

    // Geometry of a runway that a project will add (also drawn while it is being built).
    plannedRunway(p) {
      const a = airportByCode[p.code];
      const rws = airportRunways(p.code);
      if (p.kind === 'extend') {
        const r = rws.reduce((m, x) => (runwayLength(x) > runwayLength(m) ? x : m), rws[0]);
        const h = bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] });
        const e1 = offsetPoint(r[0], r[1], h + 180, A.extendBy / 2);
        const e2 = offsetPoint(r[2], r[3], h, A.extendBy / 2);
        return { replace: r, runway: [e1[0], e1[1], e2[0], e2[1], r[4], 1] };
      }
      if (p.kind !== 'runway') return null;
      let center = [a.lat, a.lon];
      let h = 70; // prevailing westerlies
      const main = rws.length ? rws.reduce((m, x) => (runwayLength(x) > runwayLength(m) ? x : m), rws[0]) : null;
      if (main) {
        h = bearing({ lat: main[0], lon: main[1] }, { lat: main[2], lon: main[3] });
        center = [(main[0] + main[2]) / 2, (main[1] + main[3]) / 2];
        if (p.orient === 'cross') h += 90;
        else {
          const k = rws.length;
          center = offsetPoint(center[0], center[1], h + 90, 400 * Math.ceil(k / 2) * (k % 2 ? 1 : -1));
        }
      }
      const e1 = offsetPoint(center[0], center[1], h + 180, p.len / 2);
      const e2 = offsetPoint(center[0], center[1], h, p.len / 2);
      return { runway: [e1[0], e1[1], e2[0], e2[1], p.len >= 2500 ? 45 : 30, 1] };
    },

    finishProjects() {
      const s = this.state;
      for (const p of s.projects.filter((x) => s.time >= x.done)) {
        const inf = this.infraOf(p.code);
        const geo = this.plannedRunway(p);
        if (geo) {
          const rws = airportRunways(p.code).filter((r) => r !== geo.replace);
          inf.runways = [geo.runway, ...rws].map((r) => r.map((v, i) => (i < 4 ? Math.round(v * 1e5) / 1e5 : v)));
        }
        if (p.kind === 'terminal') inf.terminal = (inf.terminal || 0) + 1;
        if (p.kind === 'airport') inf.runways = [this.plannedRunway({ code: p.code, kind: 'runway', len: A.newAirportRunway }).runway];
        if (p.kind === 'airport') airportByCode[p.code].open = true;
        inf.invested = (inf.invested || 0) + p.full;
        delete catchmentCache[p.code];
        this.log(`${airportByCode[p.code].name}: ${p.label} completed.`, 'good');
      }
      s.projects = s.projects.filter((x) => s.time < x.done);
      this.dirty = true;
    },

    // Build a brand-new airfield; it opens after construction and is 100% yours.
    buildAirport(lat, lon) {
      const s = this.state;
      const near = D.airports.find((a) => !a.factory && distanceKm(a, { lat, lon }) < A.newAirportMinKm);
      if (near) return `Too close to ${near.name} (${near.code}) – keep ${A.newAirportMinKm} km away.`;
      if (s.money < A.newAirportCost) return `Not enough money (${fmtMoney(A.newAirportCost)} needed).`;
      let town = null;
      for (const t of townsNear({ lat, lon }, 200)) {
        if (!town || distanceKm(t, { lat, lon }) < distanceKm(town, { lat, lon })) town = t;
      }
      const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let code;
      do code = 'X' + L[Math.floor(Math.random() * 26)] + L[Math.floor(Math.random() * 26)];
      while (airportByCode[code]);
      const name = `${town ? town.name : s.company} ${s.company.split(' ')[0]} Field`;
      const a = { code, name, city: town ? town.name : name, country: town ? town.country : '',
        lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, size: 1, built: true, open: false };
      s.money -= A.newAirportCost;
      s.built.push(a);
      this.registerBuilt();
      this.infraOf(code).stake = 100;
      s.projects.push({ code, kind: 'airport', label: 'New airfield with a 1200 m runway', cost: A.newAirportCost,
        full: A.newAirportCost, start: s.time, done: s.time + A.newAirportWeeks * 7 * DAY });
      this.log(`Construction of ${name} (${code}) started for ${fmtMoney(A.newAirportCost)} – opens in ` +
        `${A.newAirportWeeks} weeks.`, 'cost');
      this.dirty = true;
      return code;
    },

    // ---------- timetables ----------
    // A timetable is a plane's day: legs { from, to, dep } with dep in minutes after midnight, each leg
    // starting where the one before ended and the last ending where the first starts, so it repeats
    // every day. Between two legs the plane stands at the airport and takes one of your slots there.
    legBlock(type, from, to) { return blockMinutes(type, dist(from, to)); },

    // Legs for a loop of stops, from a first departure, with the shortest turnarounds: the loop is
    // flown `rounds` times (0 = as often as fits into the day and the crew's duty).
    buildTimetable(type, stops, firstDep, rounds = 0) {
      const legs = [];
      if (stops.length < 2) return legs;
      let t = firstDep;
      let duty = 0;
      for (let r = 0; rounds ? r < rounds : true; r++) {
        const loop = [];
        let tt = t;
        let dd = duty;
        let ok = true;
        stops.forEach((from, i) => {
          const to = stops[(i + 1) % stops.length];
          const block = this.legBlock(type, from, to);
          if (tt < C.curfew.start || tt > C.curfew.end || dd + block > C.crewMaxDutyMin) ok = false;
          loop.push({ from, to, dep: tt % DAY });
          tt += block + C.turnaroundMin;
          dd += block;
        });
        // The day must end where it started, in time for the first departure tomorrow.
        if (!ok || tt - C.turnaroundMin > firstDep + DAY - C.turnaroundMin) break;
        legs.push(...loop);
        t = tt;
        duty = dd;
        if (r > 30) break;
      }
      return legs;
    },

    // Where a plane stands during the day with these legs: [{ code, from, to }] in minutes after
    // midnight, to > from; a stay over midnight is split in two.
    groundTimes(type, legs) {
      const out = [];
      const n = legs.length;
      if (!n) return out;
      for (let i = 0; i < n; i++) {
        const leg = legs[i];
        const next = legs[(i + 1) % n];
        const arr = leg.dep + this.legBlock(type, leg.from, leg.to);
        let dep = next.dep;
        while (dep < arr) dep += DAY;
        const a = arr % DAY;
        const len = dep - arr;
        if (a + len <= DAY) out.push({ code: leg.to, from: a, to: a + len, arr: a, dep: dep % DAY });
        else {
          out.push({ code: leg.to, from: a, to: DAY, arr: a, dep: dep % DAY });
          out.push({ code: leg.to, from: 0, to: a + len - DAY, arr: a, dep: dep % DAY });
        }
      }
      return out;
    },

    // What fills an airport's slots today: timetabled planes standing there, and planes without a
    // timetable that sit there (all day). `draft` = { planeId, type, legs } replaces that plane's legs.
    slotUsage(code, draft) {
      const uses = [];
      for (const p of this.state.planes) {
        const legs = draft && draft.planeId === p.id ? draft.legs : p.schedule.legs && p.schedule.active !== false ? p.schedule.legs : null;
        if (legs && legs.length) {
          for (const g of this.groundTimes(p.type, legs)) if (g.code === code) uses.push({ planeId: p.id, ...g });
        } else if (!(draft && draft.planeId === p.id) && !(p.schedule.active && p.schedule.stops.length >= 2 && !p.schedule.legs)) {
          const at = p.status === 'flying' && p.flight ? p.flight.to : p.location;
          if (at === code) uses.push({ planeId: p.id, code, from: 0, to: DAY, idle: true });
        }
      }
      // Lanes: each slot is a row; a stay goes into the first row that is free for its whole time.
      uses.sort((x, y) => !!x.idle - !!y.idle || x.from - y.from || y.to - x.to); // timetables first
      const lanes = [];
      for (const u of uses) {
        let k = lanes.findIndex((end) => end <= u.from);
        if (k < 0) { k = lanes.length; lanes.push(0); }
        lanes[k] = u.to;
        u.lane = k;
      }
      return { uses, need: lanes.length, have: this.slotCount(code) };
    },

    // Problems with a timetable for a plane: errors block saving.
    checkTimetable(planeId, legs) {
      const p = this.plane(planeId);
      const ac = D.aircraft[p.type];
      const errors = [];
      if (legs.length < 2) return ['A timetable needs at least two flights.'];
      let duty = 0;
      legs.forEach((leg, i) => {
        const next = legs[(i + 1) % legs.length];
        const block = this.legBlock(p.type, leg.from, leg.to);
        duty += block;
        const name = `${fmtClock(leg.dep)} ${leg.from}→${leg.to}`;
        if (leg.to !== next.from) errors.push(`${name} ends at ${leg.to}, but the next flight leaves from ${next.from}.`);
        if (!this.ownsSlot(leg.from)) errors.push(`No slot at ${leg.from}.`);
        if (leg.from === leg.to) errors.push(`${name} goes nowhere.`);
        if (leg.dep < C.curfew.start || leg.dep > C.curfew.end) errors.push(`${name}: departures only ${fmtClock(C.curfew.start)}–${fmtClock(C.curfew.end)} (night curfew).`);
        if (dist(leg.from, leg.to) > ac.rangeKm) errors.push(`${name} is out of range.`);
        const unfit = fitsReason(p.type, leg.to);
        if (unfit) errors.push(unfit);
      });
      // The legs must fit into one day, each with a turnaround.
      let t = legs[0].dep;
      legs.forEach((leg, i) => {
        if (i > 0) {
          let dep = leg.dep;
          while (dep < t) dep += DAY;
          if (dep - t < 0) errors.push('Flights overlap.');
          t = dep;
        }
        const ready = t + this.legBlock(p.type, leg.from, leg.to) + C.turnaroundMin;
        const nextDep = i + 1 < legs.length ? (() => { let d = legs[i + 1].dep; while (d < t) d += DAY; return d; })() : legs[0].dep + DAY;
        if (nextDep < ready) errors.push(`After ${fmtClock(leg.dep)} ${leg.from}→${leg.to} the plane is ready at ${fmtClock(ready % DAY)} – too late for the next flight at ${fmtClock(nextDep % DAY)}.`);
      });
      if (duty > C.crewMaxDutyMin) errors.push(`${fmtDuration(duty)} in the air a day – the crew may fly ${fmtDuration(C.crewMaxDutyMin)}.`);
      return [...new Set(errors)];
    },

    // Slot check for a timetable, per airport it stands at: [{ code, have, need, clash: [{ from, to, planes }] }].
    // A clash doesn't block the timetable: the plane that would find every slot taken waits at its gate
    // until a slot is free (a delay), so the player can share slots tightly or lease another one.
    timetableSlots(planeId, legs) {
      const p = this.plane(planeId);
      const out = [];
      for (const code of new Set(legs.map((l) => l.from))) {
        const u = this.slotUsage(code, { planeId, type: p.type, legs });
        const clash = [];
        for (const x of u.uses) {
          if (x.planeId !== planeId || x.lane < u.have) continue;
          const others = u.uses.filter((y) => y.planeId !== planeId && y.from < x.to && y.to > x.from).map((y) => y.planeId);
          clash.push({ from: x.from, to: x.to, planes: [...new Set(others)] });
        }
        out.push({ code, have: u.have, need: u.need, clash });
      }
      return out;
    },

    // Take a plane off its timetable: it stays where it is.
    clearTimetable(planeId) {
      const p = this.plane(planeId);
      p.schedule = { stops: [], index: 0, active: false };
      p.waitSlot = null;
      this.log(`${p.id} has no timetable any more and stays at ${p.status === 'flying' && p.flight ? p.flight.to : p.location}.`);
      this.dirty = true;
      return null;
    },

    // Put a plane on a timetable (and keep it running if it was).
    setTimetable(planeId, legs) {
      const p = this.plane(planeId);
      const errors = this.checkTimetable(planeId, legs);
      if (errors.length) return errors[0];
      const sorted = legs.slice();
      p.schedule = { stops: sorted.map((l) => l.from), legs: sorted, index: 0, active: p.schedule.active, due: 0 };
      this.syncTimetable(p);
      this.log(`${p.id} timetable: ${sorted.map((l) => `${fmtClock(l.dep)} ${l.from}→${l.to}`).join(', ')}.`);
      this.dirty = true;
      return null;
    },

    // Next leg to fly: the one leaving soonest from where the plane is (or will be).
    syncTimetable(p) {
      const sch = p.schedule;
      if (!sch.legs || !sch.legs.length) return;
      const at = p.status === 'flying' && p.flight ? p.flight.to : p.location;
      const from = Math.max(this.state.time, p.status === 'flying' && p.flight ? p.flight.arr + C.turnaroundMin : 0);
      let best = 0;
      let bestDue = Infinity;
      sch.legs.forEach((l, i) => {
        const due = nextAt(l.dep, from) + (l.from === at ? 0 : DAY / 2); // prefer legs from here
        if (due < bestDue) { bestDue = due; best = i; }
      });
      sch.index = best;
      sch.due = nextAt(sch.legs[best].dep, from);
    },

    // Rough forecast for a whole timetable day.
    estimateTimetable(type, legs, costMult = 1) {
      const ac = D.aircraft[type];
      const used = {};
      let profit = 0;
      let pax = 0;
      let block = 0;
      const rows = legs.map((l) => {
        const d = dist(l.from, l.to);
        const key = `${l.from}-${l.to}`;
        const left = Math.max(0, this.paxDemand(l.from, l.to, ac.seats) - (used[key] || 0));
        const p = Math.min(ac.seats, left);
        used[key] = (used[key] || 0) + p;
        const revenue = p * this.fare(l.from, l.to);
        const cost = flightCost(type, d, l.to, p, costMult);
        const b = blockMinutes(type, d);
        profit += revenue - cost;
        pax += p;
        block += b;
        return { ...l, block: b, arr: (l.dep + b) % DAY, pax: p, seats: ac.seats, result: revenue - cost };
      });
      return { rows, profit, pax, block };
    },

    // Lease one more slot at an airport where you already have one.
    addSlot(code) { return this.leaseSlot(code); },

    // Give one slot back; the last one goes with releaseSlot.
    dropSlot(code) {
      const n = this.slotCount(code);
      if (n <= 1) return this.releaseSlot(code);
      const busy = this.slotOccupants(code).filter((o) => o.how !== 'leaving').length;
      if (busy >= n) return `All ${n} slots at ${code} have a plane in them right now.`;
      this.state.slots[code].count = n - 1;
      this.log(`Gave back a slot at ${airportByCode[code].name} (${n - 1} left).`);
      this.dirty = true;
      return null;
    },

    // Rough fuel on board as a share of the tank: full at the gate, burnt down along the flight
    // (trip fuel scales with distance over range), refuelled during the turnaround.
    fuelLevel(p, t) {
      const ac = D.aircraft[p.type];
      if (p.status === 'flying' && p.flight) {
        const f = p.flight;
        const trip = Math.min(0.88, (f.distance / ac.rangeKm) * 0.88);
        const start = Math.min(1, trip + 0.12);
        const prog = Math.min(1, Math.max(0, (t - f.dep) / Math.max(1, f.arr - f.dep)));
        return start - trip * prog;
      }
      if (p.status === 'turnaround' && !p.repair) {
        const left = Math.max(0, p.readyAt - t);
        return Math.max(0.12, 1 - left / C.turnaroundMin);
      }
      return 1;
    },

    // Rough forecast for a schedule loop (first flight of the day, no randomness).
    estimateSchedule(type, stops, costMult = 1) {
      const ac = D.aircraft[type];
      const legs = [];
      if (stops.length < 2) return { legs, loopMin: 0, profit: 0 };
      for (let i = 0; i < stops.length; i++) {
        const from = stops[i];
        const to = stops[(i + 1) % stops.length];
        const d = dist(from, to);
        const demand = this.paxDemand(from, to, ac.seats);
        const pax = Math.min(ac.seats, demand);
        const revenue = pax * this.fare(from, to);
        const cost = flightCost(type, d, to, pax, costMult);
        legs.push({ from, to, d: Math.round(d), block: blockMinutes(type, d), demand, pax, revenue, cost });
      }
      const loopMin = legs.reduce((s, l) => s + l.block + C.turnaroundMin, 0);
      const profit = legs.reduce((s, l) => s + l.revenue - l.cost, 0);
      return { legs, loopMin, profit };
    },
  };

  FG.game = Game;
})();
