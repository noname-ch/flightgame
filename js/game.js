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
  // The size the game lays an airport out by (where it makes the layout up, game.js apronOf): from the data, and
  // the terminal expansions of older games.
  const baseSize = (code) => Math.min(5, airportByCode[code].size + (infra(code).terminal || 0));

  // ---------- stand size classes ----------
  // Aircraft and stands come in the ICAO classes A–F by wingspan (below 15, 24, 36, 52, 65 and 80 m). A plane
  // needs a stand of its class or a bigger one, and so a slot of that class. A stand's class is the biggest
  // whose widest wings fit into the room it has, with headroom on both sides: 3 m for A and B, 4.5 m for C and
  // 7.5 m from D on (ICAO's wingtip clearance). Its room: how far the stands beside it are, and twice how far a
  // building beside it is (classifyStands).
  const CLASSES = ['A', 'B', 'C', 'D', 'E', 'F'];
  const CLASS_SPAN = [15, 24, 36, 52, 65, 80];
  const CLASS_CLEAR = [3, 3, 4.5, 7.5, 7.5, 7.5];
  // (the room a stand of each class needs: the widest span plus the clearance)
  const CLASS_ROOM = CLASS_SPAN.map((m, i) => m + CLASS_CLEAR[i]);
  function typeClass(type) {
    const span = (D.looks && D.looks[type] && D.looks[type].span) || 35;
    const i = CLASS_SPAN.findIndex((m) => span < m);
    return i < 0 ? 5 : i;
  }
  const wrap180 = (d) => ((((d % 360) + 540) % 360) - 180);
  function classForRoom(room) {
    let c = 0;
    for (let i = 0; i < 6; i++) if (CLASS_ROOM[i] <= room + 1e-6) c = i;
    return c;
  }
  // Do planes of these classes (a list) fit into slots `have` (by class)? Each needs one of its class or bigger:
  // they fit when, for every class, no more of them need that class or a bigger one than there are such slots.
  function slotsFit(have, needs) {
    let h = 0;
    let n = 0;
    for (let c = 5; c >= 0; c--) {
      h += have[c];
      n += needs.filter((x) => x === c).length;
      if (n > h) return false;
    }
    return true;
  }
  // What a real airport's biggest stands take at least, by its size: the data's stands are not always where the
  // planes stand, so the roomiest third of them are given this class at least (the size the data has it at).
  const CLASS_BY_SIZE = [2, 2, 3, 4, 4, 5];

  // ---------- airport size ----------
  // The size passengers, fees and the map go by. An airport you built is as big as what is built there: its
  // stands by class (CLASS_SCORE each) and its longest paved runway (sizeFor). A real airport keeps the size the
  // data gives it, and what you build there can make it bigger: the stands you add count on top of what its size
  // stands for.
  const SIZE_SCORE = [0, 1, 8, 20, 45, 90];
  const SIZE_RUNWAY = [0, 500, 1200, 1800, 2400, 3000];
  const CLASS_SCORE = [0.25, 0.5, 1, 2, 3, 4];
  function sizeFor(score, runway) {
    let size = 0;
    for (let i = 1; i < 6; i++) if (score >= SIZE_SCORE[i] && runway >= SIZE_RUNWAY[i]) size = i;
    return size;
  }
  const sizeCache = new Map();
  function airportSize(code) {
    const a = airportByCode[code];
    const base = baseSize(code);
    const own = FG.fixes && FG.fixes.player ? FG.fixes.player.ops(code) : [];
    if (a.factory || (a.built ? !a.open : !own.length && !infra(code).runways)) return base;
    const key = `${FG.fixes ? FG.fixes.rev(code) : 0}|${FG.layouts ? FG.layouts.version : 0}|${airportRunways(code).length}|${base}`;
    const hit = sizeCache.get(code);
    if (hit && hit.key === key) return hit.size;
    const ap = apronOf(code);
    const runway = longestRunway(code, true);
    let size;
    if (a.built) size = Math.max(1, sizeFor(ap.stands.reduce((n, st) => n + CLASS_SCORE[st.cls], 0), runway));
    else {
      // the stands the player added (by their spot) on top of what the data's size stands for
      const added = own.filter((o) => o.kind === 'stand' && o.op === 'add').map((o) => o.geom);
      let score = SIZE_SCORE[base];
      for (const st of ap.stands) if (added.some((g) => Math.abs(g[0] - st.lat) < 3e-5 && Math.abs(g[1] - st.lon) < 4e-5)) score += CLASS_SCORE[st.cls];
      size = Math.max(base, sizeFor(score, runway));
    }
    sizeCache.set(code, { key, size });
    return size;
  }
  // Which of the four categories (C.airports.categories) an airport is in, by its size.
  const airportCategory = (code) => A.categories.find((c) => airportSize(code) <= c.upTo) || A.categories[A.categories.length - 1];
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
    if (!rws.length) return RUNWAY_BY_SIZE[baseSize(code)];
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
  // First moment at or after `after` (absolute minutes) that is `tod` minutes past midnight, or (period: an ultra
  // long-haul timetable's days × DAY) `tod` minutes into one of its rounds, which start at multiples of the period.
  const nextAt = (tod, after, period = DAY) => after + ((((tod - (after % period)) % period) + period) % period);
  // The minutes a timetable takes to repeat: a day, or several (an ultra long-haul one, schedule.days).
  const periodOf = (sch) => (sch.days || 1) * DAY;
  // When a timetable's leg leaves next, at or after `after`. (An ultra long-haul plane's rounds start on its own
  // day, schedule.offset minutes into the period: Game.anchorRound.)
  const legDue = (sch, leg, after) => nextAt((leg.dep + (sch.offset || 0)) % periodOf(sch), after, periodOf(sch));
  const blockMinutes = (type, d) => Math.round((d / D.aircraft[type].speedKmh) * 60 + C.taxiMin);
  // Minutes a plane stands at the gate after landing before it can leave again: longer for bigger planes.
  function turnaroundMin(type) {
    const T = C.turnaround;
    return Math.min(T.max, Math.max(T.min, Math.round((T.base + T.perSeat * D.aircraft[type].seats) / 5) * 5));
  }
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
  const PUSHBACK = 2;    // minutes: pushed back from the gate, tail first
  const DOCK = 1.5;      // minutes: turning onto the stand and pulling up to the gate
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

  // ---------- winds placed with the developer tools ----------
  // state.winds: [{ id, lat, lon, km, from, kt }]. Within km of its spot it blows from `from` at `kt` knots, at every
  // height, fading back into the weather's own wind over the outer 30%. The runways in use turn into it too.
  let windRev = 0; // (bumped on every change: route lines are drawn again with the new runways)
  function placedWind(lat, lon) {
    const list = Game.state && Game.state.winds;
    if (!list || !list.length) return null;
    let best = null;
    for (const w of list) {
      const d = distanceKm({ lat, lon }, w);
      if (d >= w.km) continue;
      const k = Math.min(1, (1 - d / w.km) / 0.3);
      if (!best || k > best.k) best = { from: w.from, kt: w.kt, k };
    }
    return best;
  }
  const blendDir = (a, b, k) => (a + k * (((b - a + 540) % 360) - 180) + 360) % 360;
  // Surface wind direction, what the runways in use face: a placed wind there, else windFrom.
  function surfaceFrom(lat, lon, day) {
    const pw = placedWind(lat, lon);
    return pw ? blendDir(windFrom(lat, lon, day), pw.from, pw.k) : windFrom(lat, lon, day);
  }

  // ---------- weather: clouds, rain, snow, thunderstorms, fog and wind ----------
  // Made up but steady, the same for everyone at the same game time: smooth noise over the globe that drifts
  // east (WX_DRIFT degrees of longitude a minute, ~30 km/h in the mid-latitudes) and changes shape over a day
  // or two, drier in the subtropics, wetter at the equator, colder towards the poles, in winter and at night.
  // It is for looks (js/weather.js draws it) and for the planes' crab angle: flights never wait for it. Storm
  // events (js/data/events.js) still close airports, and are drawn as storms. Surface wind blows from windFrom
  // (so the runways in use stay the same); its speed and the winds aloft come from the noise.
  const WX_DRIFT = 0.0064;
  const WX_MORPH = 2160; // minutes for the pattern to change shape (1.5 days)
  // Integer lattice hash -> [0, 1), no allocations (the cloud layers call this thousands of times).
  function wxHash(x, y, z, s) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(s, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // Smooth value noise in [0, 1).
  function wxNoise(x, y, z, s) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy), q = fz * fz * (3 - 2 * fz);
    const a0 = wxHash(xi, yi, zi, s), b0 = wxHash(xi + 1, yi, zi, s), c0 = wxHash(xi, yi + 1, zi, s), d0 = wxHash(xi + 1, yi + 1, zi, s);
    const a1 = wxHash(xi, yi, zi + 1, s), b1 = wxHash(xi + 1, yi, zi + 1, s), c1 = wxHash(xi, yi + 1, zi + 1, s), d1 = wxHash(xi + 1, yi + 1, zi + 1, s);
    const lo = a0 + (b0 - a0) * u + (c0 + (d0 - c0) * u - a0 - (b0 - a0) * u) * w;
    const hi = a1 + (b1 - a1) * u + (c1 + (d1 - c1) * u - a1 - (b1 - a1) * u) * w;
    return lo + (hi - lo) * q;
  }
  const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  // Day of the year (0 = 1 January): the calendar in a story game, else day 0 is 1 January.
  function dayOfYear(t) {
    const d = dateOf(t);
    if (!d) return Math.floor(t / DAY) % 365;
    return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000);
  }
  // ---------- local time, the sun, day and night ----------
  // The game clock is the time at the home airport. Every airport has its own local time (js/data/timezones.js:
  // its zone's UTC offsets in winter and summer and the days the clocks change), so the sun rises and sets
  // there at the right hour: UTC = game time - the home offset.
  let tzByCode = null;
  function tzTable() {
    if (tzByCode) return tzByCode;
    tzByCode = new Map();
    for (const [key, codes] of Object.entries(D.timezones || {})) {
      const z = key.split(',').map(Number);
      for (const c of codes.split(' ')) tzByCode.set(c, z);
    }
    return tzByCode;
  }
  // The zone of an airport; one the data has none for (a new one the player built) takes its nearest neighbour's,
  // or the sun's (15° of longitude an hour) far from any.
  function zoneOf(code) {
    const tab = tzTable();
    let z = tab.get(code);
    if (z) return z;
    const a = airportByCode[code];
    if (!a) return [0];
    let best = null;
    let bd = 4; // (degrees: about 400 km)
    for (const b of Object.values(airportByCode)) {
      if (Math.abs(b.lat - a.lat) > bd || Math.abs(b.lon - a.lon) > bd || !tab.has(b.code)) continue;
      const d = Math.hypot(b.lat - a.lat, (b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180));
      if (d < bd) { bd = d; best = b.code; }
    }
    z = best ? tab.get(best) : [Math.round(a.lon / 15) * 4];
    tab.set(code, z);
    return z;
  }
  // Minutes ahead of UTC at an airport on game day t (summer time included).
  function utcOffset(code, t) {
    const z = zoneOf(code);
    if (z.length < 4) return z[0] * 15;
    const doy = dayOfYear(t);
    const summer = z[2] < z[3] ? doy >= z[2] && doy < z[3] : doy >= z[2] || doy < z[3]; // (south: across New Year)
    return (summer === (z[2] < z[3]) ? z[1] : z[0]) * 15;
  }
  const homeCode = () => (Game.state && Game.state.home) || C.startAirport;
  const utcOf = (t) => t - utcOffset(homeCode(), t);
  // Local time at an airport for game time t (minutes, as game time: fmtClock shows it).
  const localTime = (code, t) => utcOf(t) + utcOffset(code, t);
  const fmtLocal = (code, t) => fmtClock(Math.floor(((localTime(code, t) % DAY) + DAY) % DAY));
  // "UTC+2", "UTC−4", "UTC+5:45"
  function fmtZone(code, t) {
    const m = utcOffset(code, t);
    const h = Math.floor(Math.abs(m) / 60);
    return `UTC${m < 0 ? '−' : '+'}${h}${Math.abs(m) % 60 ? `:${pad(Math.abs(m) % 60)}` : ''}`;
  }
  // Where the sun is: its declination and the longitude it is overhead at, for game time t.
  function sunPoint(t) {
    const u = utcOf(t);
    const doy = dayOfYear(t) + ((u % DAY) + DAY) % DAY / DAY;
    const g = 2 * Math.PI * (doy - 1) / 365;
    const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
      0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g); // (radians)
    const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g)); // minutes
    const utcMin = ((u % DAY) + DAY) % DAY;
    const lon = (((720 - utcMin - eot) / 4 + 540) % 360) - 180;
    return { lat: dec * 180 / Math.PI, lon, eot };
  }
  // The sun seen from a place: elevation above the horizon and azimuth (degrees, from north, clockwise).
  function sunAt(lat, lon, t, sp = sunPoint(t)) {
    const R = Math.PI / 180;
    const f = lat * R, d = sp.lat * R, H = (lon - sp.lon) * R;
    const sinE = Math.sin(f) * Math.sin(d) + Math.cos(f) * Math.cos(d) * Math.cos(H);
    const elev = Math.asin(Math.max(-1, Math.min(1, sinE))) / R;
    const az = (Math.atan2(-Math.sin(H), Math.tan(d) * Math.cos(f) - Math.sin(f) * Math.cos(H)) / R + 360) % 360;
    return { elev, az };
  }
  // How light it is: 1 in daylight, 0 at night (the sun more than 9° under the horizon), dusk in between.
  const daylight = (lat, lon, t, sp) => smooth(-9, 4, sunAt(lat, lon, t, sp).elev);
  // Sunrise and sunset at an airport on game day t, as local clock times ("06:42"), or { polar: 'day'|'night' }.
  function sunTimes(code, t) {
    const a = airportByCode[code];
    if (!a) return null;
    const noon = Math.floor(t / DAY) * DAY + 720;
    const sp = sunPoint(noon);
    const R = Math.PI / 180;
    const c = (Math.sin(-0.833 * R) - Math.sin(a.lat * R) * Math.sin(sp.lat * R)) / (Math.cos(a.lat * R) * Math.cos(sp.lat * R));
    if (c < -1) return { polar: 'day' };
    if (c > 1) return { polar: 'night' };
    const h0 = Math.acos(c) / R / 15 * 60; // minutes either side of the sun's highest
    const transit = 720 - 4 * a.lon - sp.eot; // UTC minutes of the day
    const off = utcOffset(code, t);
    const clock = (utcMin) => fmtClock(Math.round(((utcMin + off) % DAY + DAY) % DAY));
    return { rise: clock(transit - h0), set: clock(transit + h0) };
  }
  // Storm events under way, as { lat, lon, km } (old saves: their label starts with "Storm").
  let wxStormKey = '';
  let wxStorms = [];
  function stormsNow() {
    const s = Game.state;
    if (!s) return [];
    const key = `${s.effects.length}|${s.time}`;
    if (key === wxStormKey) return wxStorms;
    wxStormKey = key;
    wxStorms = s.effects.filter((e) => e.until > s.time && e.where && e.where.near && (e.weather === 'storm' || /^Storm /.test(e.label || '')))
      .map((e) => ({ lat: e.where.near.lat, lon: e.where.near.lon, km: e.where.radiusKm || 400 }));
    return wxStorms;
  }
  // The weather at a place and time: cover (0 clear … 1 overcast), rain (0 … 1, snow when cold), storm
  // (a thunderstorm or a storm event), fog, tempC, surface wind (windFrom °, windKt), name and icon.
  // `lite`: only cover, rain and storm (the cloud layers draw thousands of these).
  function weatherAt(lat, lon, t, lite) {
    const x = lon - WX_DRIFT * t;
    const z = t / WX_MORPH;
    const n = 0.62 * wxNoise(x / 9, lat / 7, z, 1) + 0.38 * wxNoise(x / 2.6, lat / 2.2, z * 1.7, 2);
    const a = Math.abs(lat);
    const climate = (a < 9 ? 0.07 : 0) - 0.13 * smooth(14, 22, a) * (1 - smooth(30, 38, a)) + (a > 40 ? 0.03 : 0);
    const wet = n + climate;
    let cover = smooth(0.36, 0.64, wet);
    let rain = smooth(0.6, 0.76, wet);
    let storm = rain > 0.4 && wxNoise(x / 1.1, lat / 1.1, z * 3, 3) > 0.74 && a < 55;
    let stormKm = 0;
    for (const st of stormsNow()) {
      const d = distanceKm({ lat, lon }, st);
      if (d >= st.km) continue;
      const k = 1 - d / st.km;
      cover = Math.max(cover, Math.min(1, 0.4 + 1.2 * k));
      rain = Math.max(rain, Math.min(1, 1.4 * k));
      if (k > 0.2) { storm = true; stormKm = Math.max(stormKm, k); }
    }
    if (lite) return { cover, rain, storm };
    // temperature: latitude, season (opposite in the south), time of day; storms cool it down
    const doy = dayOfYear(t);
    const season = Math.cos((2 * Math.PI * (doy - 200)) / 365) * (lat >= 0 ? 1 : -1);
    const hour = ((t % DAY) + DAY) % DAY / 60;
    const tempC = Math.round(29 - 0.007 * a * a - 0.1 * a + season * 0.25 * Math.min(a, 60) +
      4 * Math.cos((2 * Math.PI * (hour - 15)) / 24) - 3 * rain);
    const snow = rain > 0.15 && tempC <= 1;
    const day = Math.floor(t / DAY);
    let windKt = Math.round(4 + 16 * wxNoise(x / 5, lat / 5, z * 1.5, 4) + 10 * rain + (storm ? 12 : 0));
    if (stormKm) windKt = Math.max(windKt, Math.round(30 + 25 * stormKm));
    const pw = placedWind(lat, lon);
    if (pw) windKt = Math.round(windKt + (pw.kt - windKt) * pw.k);
    const gustKt = windKt >= 15 ? Math.round(windKt * 1.45) : 0;
    const fog = !rain && !storm && windKt < 7 && cover > 0.55 && hour > 3 && hour < 10 && tempC < 14;
    let name;
    let icon;
    if (storm && snow) [name, icon] = ['Blizzard', '🌨'];
    else if (storm) [name, icon] = ['Thunderstorm', '⛈'];
    else if (snow) [name, icon] = ['Snow', '🌨'];
    else if (fog) [name, icon] = ['Fog', '🌫'];
    else if (rain > 0.55) [name, icon] = ['Rain', '🌧'];
    else if (rain > 0.15) [name, icon] = ['Showers', '🌦'];
    else if (cover > 0.85) [name, icon] = ['Overcast', '☁️'];
    else if (cover > 0.55) [name, icon] = ['Cloudy', '🌥'];
    else if (cover > 0.2) [name, icon] = ['Some clouds', '⛅'];
    else [name, icon] = ['Clear', hour > 6 && hour < 20 ? '☀️' : '🌙'];
    const from = pw ? blendDir(windFrom(lat, lon, day), pw.from, pw.k) : windFrom(lat, lon, day);
    return { cover, rain, storm, snow, fog, tempC, windFrom: Math.round(from) % 360, windKt, gustKt, name, icon };
  }
  // Wind at a height (ft above sea level): the surface wind (from windFrom) near the ground, turning to the
  // westerly winds aloft and getting stronger with height. The jet stream of the mid-latitudes only blows up high
  // (from FL150, all of it by FL330): with all of it from 12,000 ft, planes descending through FL100 met 120 kt
  // and crabbed 20-25° (GitHub issue #2, "Planes too much wind angle").
  function windAt(lat, lon, t, altFt = 0) {
    const w = weatherAt(lat, lon, t);
    const x = lon - WX_DRIFT * t;
    const z = t / WX_MORPH;
    const aloft = (lat >= -25 && lat <= 25 ? 90 : 270) + (wxNoise(x / 12, lat / 10, z, 5) - 0.5) * 100;
    const k = smooth(2000, 12000, altFt);
    const kJet = smooth(15000, 33000, altFt);
    const jet = 60 * Math.exp(-(((Math.abs(lat) - 40) / 12) ** 2)) * (0.6 + 0.8 * wxNoise(x / 8, lat / 8, z, 6));
    let from = (w.windFrom + k * (((aloft - w.windFrom + 540) % 360) - 180) + 360) % 360;
    let kt = w.windKt * (1 + 0.6 * k) + kJet * jet;
    const pw = placedWind(lat, lon); // (a placed wind blows at every height)
    if (pw) { from = blendDir(from, pw.from, pw.k); kt += (pw.kt - kt) * pw.k; }
    return { from: Math.round(from) % 360, kt: Math.round(kt), gusty: w.gustKt > 0 || w.storm, storm: w.storm };
  }

  // A runway's key (its ends): what a plane's runway choice at an airport remembers (Game.setRunway).
  const runwayKey = (r) => r.slice(0, 4).map((v) => Number(v).toFixed(4)).join(',');
  // Runway end to use at an airport, into the day's wind. `need`: the type's { m, paved } (runwayNeed). `pick`:
  // the runway the player chose for this plane there (runwayKey): that one, from whichever end is into the wind,
  // while it is there and long enough. Else (auto) the shortest one the type can use (a paved one where there is)
  // whose end is within 45° of the wind: the long runways stay free for the big planes. With none that close,
  // the one most into the wind (the shorter within 20°).
  function pickRunway(code, day, need, pick) {
    const a = airportByCode[code];
    const wind = surfaceFrom(a.lat, a.lon, day);
    const ends = [];
    for (const r of airportRunways(code)) {
      const len = runwayLength(r);
      const h = bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] });
      const key = runwayKey(r);
      ends.push({ thr: [r[0], r[1]], end: [r[2], r[3]], hdg: h, len, paved: !!r[5], key });
      ends.push({ thr: [r[2], r[3]], end: [r[0], r[1]], hdg: (h + 180) % 360, len, paved: !!r[5], key });
    }
    if (!ends.length) { // no data: an imaginary 2.5 km runway into the wind
      const t = offsetPoint(a.lat, a.lon, wind + 180, 1250);
      const e = offsetPoint(a.lat, a.lon, wind, 1250);
      return { thr: t, end: e, hdg: wind, len: 2500 };
    }
    const off = (e) => Math.abs(((e.hdg - wind + 540) % 360) - 180);
    const intoWind = (list) => list.reduce((best, e) => (off(e) < off(best) - 20 || (off(e) < off(best) + 20 && e.len < best.len) ? e : best));
    const fits = (e) => e.len >= need.m && (e.paved || !need.paved);
    if (pick) {
      const mine = ends.filter((e) => e.key === pick && fits(e));
      if (mine.length) return mine.reduce((b, e) => (off(e) < off(b) ? e : b));
    }
    const ok = ends.filter(fits);
    const paved = ok.filter((e) => e.paved);
    const pool = paved.length ? paved : ok.length ? ok : ends.filter((e) => e.len >= need.m).length ? ends.filter((e) => e.len >= need.m) : ends;
    const calm = pool.filter((e) => off(e) <= 45);
    if (calm.length) return calm.reduce((b, e) => (e.len < b.len - 1 || (Math.abs(e.len - b.len) <= 1 && off(e) < off(b)) ? e : b));
    return intoWind(pool);
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
  // The way between the stand side (`lanePt`) and a runway, in the order it is driven: { x, path }. Landing
  // (`alongM`: where the plane has slowed down, metres past the threshold): from where it turns off the runway,
  // x, to lanePt. Takeoff: from lanePt to where it lines up, x metres past the threshold (up to `xMax` in).
  function runwayWay(code, rwy, lanePt, landing, alongM, xMax = 0) {
    const ap = apronOf(code);
    if (!ap.real) {
      const path = taxiPath(code, rwy, lanePt, landing ? alongM : 0);
      return { x: landing ? alongM : 0, path: landing ? path.reverse() : path };
    }
    const way = realRunwayWay(code, ap.real, rwy, lanePt, landing, landing ? alongM - 100 : 0, landing ? rwy.len : xMax);
    if (way) return way;
    // No exit or entry from the side: along the runway (backtracking), turning round on it where the way
    // goes back the way the plane came.
    const r = airportRunways(code).find((q) => (q[0] === rwy.thr[0] && q[1] === rwy.thr[1]) || (q[2] === rwy.thr[0] && q[3] === rwy.thr[1]));
    const w = (r && r[4]) || 45;
    const at = rwyPoint(rwy, landing ? alongM : 0, 0);
    const path = realTaxiPath(code, ap.real, lanePt, at);
    if (landing) path.reverse();
    const x = landing ? alongM : 0;
    // (backwards: the way driven on the runway, in its first or last 500 m, goes more than 10 m against the
    // way the plane rolls; `seq` runs from the runway out)
    const seq = landing ? path : path.slice().reverse();
    const on = (q) => Math.abs(q.across) < w / 2 + 3;
    let moved = 0;
    let off = null;
    for (let i = 1, m = 0; i < seq.length && m < 500; i++) {
      const a = rwyCoords(rwy, seq[i - 1]), b = rwyCoords(rwy, seq[i]);
      if (on(a) && on(b)) moved += (landing ? 1 : -1) * (b.along - a.along);
      if (!off && metres(seq[i], at) >= 30) off = rwyCoords(rwy, seq[i]);
      m += metres(seq[i - 1], seq[i]);
    }
    if (!off) return { x, path };
    const back = moved < -10 || (off.along - x) * (landing ? 1 : -1) < -0.5 * Math.hypot(off.along - x, off.across);
    if (!back) return { x, path };
    const side = off.across < 0 ? -1 : 1; // (round on the side away from where it goes)
    const r4 = 4 * Math.max(6, Math.min(20, w * 0.27));
    if (landing) return { x, path: [...turnAround(rwy, Math.min(alongM + r4, rwy.len - 25), -1, w, side).slice(1), ...path] };
    const keep = path.filter((p, i) => i === 0 || metres(p, at) > r4 + 10);
    return { x: 0, path: [...keep, ...turnAround(rwy, 0, 1, w, side)] };
  }
  // All taxiway centre lines of an airport, for drawing: [[lat, lon], [lat, lon]] each.
  function taxiwaysOf(code) {
    const ap = apronOf(code);
    if (ap.empty) return [];
    // (each stretch keeps its taxiway's width, where the fixes give one: `w`, m)
    if (ap.real) return ap.real.taxiways.flatMap((l) => l.slice(1).map((p, i) => Object.assign([l[i], p], l.w ? { w: l.w } : {})));
    const lines = [...(ap.lanes || [ap.lane])];
    for (const r of airportRunways(code)) {
      const len = runwayLength(r);
      const rwy = { thr: [r[0], r[1]], hdg: bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] }), len };
      const off = taxiwayOffset(rwy, ap.ref);
      // the parallel taxiway and its exits at the runway ends, round at the corners
      lines.push(roundLine([rwyPoint(rwy, 0, 0), rwyPoint(rwy, 0, off), rwyPoint(rwy, len, off), rwyPoint(rwy, len, 0)], 35));
      const leave = Math.min(len * 0.65, 2200); // where a landing plane leaves the runway, from either end
      const run = exitRun(len, off);
      lines.push([rwyPoint(rwy, leave, 0), rwyPoint(rwy, Math.min(len, leave + run), off)], [rwyPoint(rwy, len - leave, 0), rwyPoint(rwy, Math.max(0, len - leave - run), off)]);
      for (const e of ap.exits) {
        lines.push([e, rwyPoint(rwy, Math.min(len, Math.max(0, rwyCoords(rwy, e).along)), off)]);
      }
    }
    return lines;
  }
  // The taxiways as the maps draw them: without the parts on the concrete (aprons and pads), where planes go
  // across the open slab. Planes still taxi along the whole lines (taxiwaysOf).
  const drawnCache = new WeakMap(); // apronOf result -> lines
  function drawnTaxiways(code) {
    const ap = apronOf(code);
    if (drawnCache.has(ap)) return drawnCache.get(ap);
    const lines = taxiwaysOf(code);
    const rings = [...(ap.aprons || [ap.apron]), ...(ap.pads || [])].filter((r) => r && r.length > 2);
    const boxes = rings.map((r) => [Math.min(...r.map((p) => p[0])), Math.max(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[1]))]);
    const inRing = (p, r) => {
      let inside = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i], b = r[j];
        if ((a[0] > p[0]) !== (b[0] > p[0]) && p[1] < ((b[1] - a[1]) * (p[0] - a[0])) / (b[0] - a[0]) + a[1]) inside = !inside;
      }
      return inside;
    };
    const onConcrete = (p) => rings.some((r, i) => p[0] >= boxes[i][0] && p[0] <= boxes[i][1] && p[1] >= boxes[i][2] && p[1] <= boxes[i][3] && inRing(p, r));
    const out = [];
    for (const line of lines) {
      let cur = [];
      const end = () => { if (cur.length > 1) { if (line.w) cur.w = line.w; out.push(cur); } cur = []; };
      for (let i = 0; i < line.length; i++) {
        if (i === 0) { if (!onConcrete(line[0])) cur.push(line[0]); continue; }
        const a = line[i - 1], b = line[i];
        // looked at every ~4 m, so a line is cut where it reaches the concrete's edge
        const n = Math.max(1, Math.ceil(distanceKm({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }) * 250));
        let was = !onConcrete(a);
        for (let k = 1; k <= n; k++) {
          const p = k === n ? b : [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
          const off = !onConcrete(p);
          if (off && !was) cur.push(p);         // back off the concrete
          else if (!off && was) { cur.push(p); end(); } // onto it: the line ends here
          else if (off && k === n) cur.push(p); // a bend
          was = off;
        }
      }
      end();
    }
    drawnCache.set(ap, out);
    return out;
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
  // A number for each layout object: an airport's layout can arrive twice (its file, then read fresh from the
  // map tiles), and the apron must be made again from the new one.
  const layoutIds = new WeakMap();
  let layoutCount = 0;
  const layoutId = (lay) => {
    if (!lay) return 0;
    if (!layoutIds.has(lay)) layoutIds.set(lay, ++layoutCount);
    return layoutIds.get(lay);
  };

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
  // A site with nothing built on it yet.
  function emptyApron(code) {
    const a = airportByCode[code];
    return { code, empty: true, stands: [], gates: [], buildings: [], markings: [], terminal: [], apron: [], aprons: [], pads: [],
      lanes: [], lane: null, exits: [], ref: [a.lat, a.lon], hdg: 0, side: 1, nose: 0, spacing: 45, style: 'linear' };
  }
  // The apron with its stands' classes (classifyStands, once per apron).
  function apronOf(code, sizeAs) {
    const ap = layApron(code, sizeAs);
    if (!ap.classed) classifyStands(code, ap);
    return ap;
  }
  function layApron(code, sizeAs) {
    const size = Math.max(0, Math.min(5, sizeAs == null ? baseSize(code) : sizeAs));
    const rws = airportRunways(code);
    const real = FG.layouts ? FG.layouts.get(code) : null;
    // A terminal the player built is the copy of a real one, once that one's layout is there.
    const tpl = real || !rws.length ? null : copyTemplate(code, size);
    const from = tpl && FG.layouts ? FG.layouts.get(tpl[0]) : null;
    // (an airport fix changes its layout and runways: js/fixes.js)
    const key = `${code}|${size}|${rws.length}|${layoutId(real)}.${layoutId(from)}|${FG.obstacles && FG.obstacles[code] ? 2 : 0}${infra(code).style || ''}${from ? tpl : ''}|${FG.fixes ? FG.fixes.rev(code) : 0}`;
    let ap = apronCache.get(key);
    if (ap) return ap;
    // A new airport site (bought to build an airport on, Game.buildAirport): only what you built there, even
    // before it is enough for planes (no stand yet); nothing at all at first. The game makes nothing up there.
    if (!real && airportByCode[code].site) {
      const own = FG.fixes ? FG.fixes.layout(code, (FG.layouts && FG.layouts.raw(code)) || null) : null;
      try { ap = own ? realApron(code, size, own) : null; } catch (e) { ap = null; }
      ap = ap || emptyApron(code);
      apronCache.set(key, ap);
      return ap;
    }
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
    // Every taxiway segment with its box. The pushback search below asks for the distance ~30 times per stand,
    // so it only looks at the segments within NEAR m of the stand (farther ones can't change its result).
    const NEAR = 200;
    const taxiSegs = [];
    for (const line of lay.taxiways) {
      for (let k = 1; k < line.length; k++) {
        const a0 = line[k - 1], a1 = line[k];
        taxiSegs.push([a0, a1, Math.min(a0[0], a1[0]), Math.max(a0[0], a1[0]), Math.min(a0[1], a1[1]), Math.max(a0[1], a1[1])]);
      }
    }
    const segsNear = (p) => {
      const dLat = NEAR / 111320, dLon = NEAR / (111320 * Math.cos(toRad(p[0])));
      return taxiSegs.filter((s) => s[2] <= p[0] + dLat && s[3] >= p[0] - dLat && s[4] <= p[1] + dLon && s[5] >= p[1] - dLon);
    };
    const toTaxiway = (p, segs = taxiSegs) => {
      const kx = 111320 * Math.cos(toRad(p[0]));
      let d = Infinity;
      for (const [a0, a1] of segs) { // (segMetres without the objects)
        const ax = (a0[1] - p[1]) * kx, ay = (a0[0] - p[0]) * 111320;
        const dx = (a1[1] - p[1]) * kx - ax, dy = (a1[0] - p[0]) * 111320 - ay;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
        d = Math.min(d, Math.hypot(ax + t * dx, ay + t * dy));
      }
      return d;
    };
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
          const segs = segsNear([lat, lon]);
          for (let m = 20; m <= 90; m += 2.5) {
            const d = toTaxiway(ahead(-m), segs);
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
      terminal: mainTerminal || square(main, 20), apron: biggest(lay.aprons) || square(ref, 60), aprons: lay.aprons, pads: lay.pads || [],
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
  const RUNWAY_TAXI_COST = 3; // taxiing along a runway counts this many times its length: only where nothing else goes
  function taxiGraph(code, lay) {
    // (a copied terminal's layout changes with the airport; built runways change the graph too)
    const rws = airportRunways(code);
    const key = `${lay.key || code}|${rws.map((r) => r.slice(0, 4).map((v) => v.toFixed(5)).join(',')).join(';')}`;
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
    // (each with its box grown by a bit more than the 8 m, so only segments that can be that near get measured)
    const GROW = 0.0001; // degrees of latitude, ~11 m
    for (let u = 0; u < g.adj.length; u++) {
      for (const [w] of g.adj[u]) {
        if (u >= w) continue;
        const a = g.pts[u], b = g.pts[w];
        const gl = GROW / Math.max(0.05, Math.cos(toRad(a[0])));
        segs.push([u, w, Math.min(a[0], b[0]) - GROW, Math.max(a[0], b[0]) + GROW, Math.min(a[1], b[1]) - gl, Math.max(a[1], b[1]) + gl]);
      }
    }
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
        if (p[0] < s[2] || p[0] > s[3] || p[1] < s[4] || p[1] > s[5]) continue;
        if (s[0] === u || s[1] === u || Math.abs(a[0] - p[0]) > 0.02 || Math.abs(a[1] - p[1]) > 0.03) continue;
        const d = toSegment(p, a, g.pts[s[1]]);
        if (d < near) { near = d; best = s; }
      }
      if (best) for (const w of [best[0], best[1]]) { const d = metres(p, g.pts[w]); g.adj[u].push([w, d]); g.adj[w].push([u, d]); }
    }
    // The runways themselves: their centre line from end to end, joined to every taxiway point on or beside
    // them. A plane taxis onto the runway where a taxiway meets it and, where no taxiway reaches the threshold,
    // along the runway to it (backtracking, as on small fields); a landing plane rolls to the next taxiway. Before,
    // it went straight from the nearest taxiway point to the threshold, across the grass.
    const before = g.pts.length;
    g.rwys = []; // each runway's centre-line points, from its first end (r[0], r[1]): ids and metres along
    for (const r of rws) {
      const rwy = { thr: [r[0], r[1]], hdg: bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] }), len: runwayLength(r) };
      const reach = Math.max(18, r[4] || 30) / 2 + 25;
      const at = [0, rwy.len];
      for (let x = 100; x < rwy.len; x += 100) at.push(x);
      const touch = [];
      for (let i = 0; i < before; i++) {
        const c = rwyCoords(rwy, g.pts[i]);
        if (c.along < -reach || c.along > rwy.len + reach || Math.abs(c.across) > reach) continue;
        const x = Math.min(rwy.len, Math.max(0, c.along));
        touch.push([i, x]);
        at.push(x);
      }
      const xs = [...new Set(at.map((x) => Math.round(x)))].sort((p, q) => p - q);
      const ids = xs.map((x) => node(rwyPoint(rwy, x, 0)));
      g.rwys.push({ a: rwy.thr, b: [r[2], r[3]], len: rwy.len, w: r[4] || 45, xs, ids, on: new Set(ids) });
      for (let k = 1; k < ids.length; k++) {
        const d = (xs[k] - xs[k - 1]) * RUNWAY_TAXI_COST;
        g.adj[ids[k - 1]].push([ids[k], d]);
        g.adj[ids[k]].push([ids[k - 1], d]);
      }
      for (const [i, x] of touch) {
        const w = ids[xs.indexOf(Math.round(x))];
        if (w === i) continue;
        const d = metres(g.pts[i], g.pts[w]);
        g.adj[i].push([w, d]);
        g.adj[w].push([i, d]);
      }
    }
    // Pads (airport fixes): open concrete where planes go straight from where they come onto it to their
    // stand. Every point on a pad (taxiway points, where the stands' lead-in lines start) is joined to every
    // other one that a straight way across the pad reaches; a pad no taxiway reaches is joined to the nearest one.
    const ap = lay.pads && lay.pads.length ? apronOf(code) : null;
    for (const pad of ap && ap.real === lay ? lay.pads : []) {
      const edge = (p) => pad.reduce((d, q, i) => Math.min(d, segMetres(p, q, pad[(i + 1) % pad.length]).d), Infinity);
      const inside = (p) => {
        let ins = false;
        for (let i = 0, j = pad.length - 1; i < pad.length; j = i++) {
          const a = pad[i];
          const b = pad[j];
          if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins;
        }
        return ins;
      };
      const onPad = (p) => inside(p) || edge(p) < 20;
      const ways = [];
      for (let i = 0; i < g.pts.length; i++) if (onPad(g.pts[i])) ways.push(i);
      const stands = ap.stands.filter((st) => onPad([st.lat, st.lon])).map((st) => node(st.lead[0]));
      const all = [...new Set([...ways, ...stands])];
      const link = (u, w) => { const d = metres(g.pts[u], g.pts[w]); g.adj[u].push([w, d]); g.adj[w].push([u, d]); };
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = g.pts[all[i]];
          const b = g.pts[all[j]];
          if ([0.25, 0.5, 0.75].every((f) => onPad([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]))) link(all[i], all[j]);
        }
      }
      if (!ways.length && stands.length) { // the nearest taxiway (or runway) point to the pad
        let best = -1;
        let bd = Infinity;
        for (let i = 0; i < g.pts.length; i++) {
          if (all.includes(i)) continue;
          const d = metres(g.pts[i], g.pts[stands[0]]);
          if (d < bd) { bd = d; best = i; }
        }
        if (best >= 0) for (const s of stands) link(s, best);
      }
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
  // Planes join and leave the taxiways at the nearest point along a line (not at its nearest corner point,
  // which could be far down a long straight: they went across the grass to it), among the lines of the
  // biggest connected piece (stubs that join nothing lead nowhere).
  function ontoTaxiway(g, p) {
    if (!g.segs) {
      g.segs = [];
      for (let u = 0; u < g.adj.length; u++) for (const [w] of g.adj[u]) if (u < w && g.main[u]) g.segs.push([u, w]);
    }
    let best = null;
    for (const [u, w] of g.segs) {
      const a = g.pts[u], b = g.pts[w];
      if (Math.abs(a[0] - p[0]) > 0.05 && Math.abs(b[0] - p[0]) > 0.05) continue;
      const r = segMetres(p, a, b);
      if (!best || r.d < best.d) best = { d: r.d, pt: r.pt, u, w };
    }
    return best;
  }
  function realTaxiPath(code, lay, from, to) {
    const g = taxiGraph(code, lay);
    const onto = (p) => ontoTaxiway(g, p);
    const S = onto(from);
    const T = onto(to);
    if (!S || !T) return [];
    // (Dijkstra from both ends of the line it joins, to both ends of the line it leaves by)
    const best = new Float64Array(g.pts.length).fill(Infinity);
    const prev = new Int32Array(g.pts.length).fill(-1);
    const heap = [];
    const push = (d, u) => {
      heap.push([d, u]);
      for (let i = heap.length - 1; i > 0;) {
        const up = (i - 1) >> 1;
        if (heap[up][0] <= heap[i][0]) break;
        [heap[i], heap[up]] = [heap[up], heap[i]];
        i = up;
      }
    };
    for (const u of [S.u, S.w]) { const d = metres(S.pt, g.pts[u]); if (d < best[u]) { best[u] = d; push(d, u); } }
    const done = new Set();
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
      if (d > best[u]) continue;
      if (u === T.u || u === T.w) done.add(u);
      if (done.size === 2 || (done.size && T.u === T.w)) break;
      for (const [w, len] of g.adj[u]) {
        const nd = d + len;
        if (nd >= best[w]) continue;
        best[w] = nd;
        prev[w] = u;
        push(nd, w);
      }
    }
    // Both on the same line: straight along it.
    const same = (S.u === T.u && S.w === T.w) || (S.u === T.w && S.w === T.u);
    const viaU = best[T.u] + metres(g.pts[T.u], T.pt);
    const viaW = best[T.w] + metres(g.pts[T.w], T.pt);
    if (same && metres(S.pt, T.pt) <= Math.min(viaU, viaW)) return [S.pt, T.pt];
    const end = viaU <= viaW ? T.u : T.w;
    if (best[end] === Infinity) return [];
    const path = [];
    for (let u = end; u >= 0; u = prev[u]) path.push(g.pts[u]);
    path.reverse();
    return [S.pt, ...path, T.pt];
  }

  // Shortest ways from the point near `p` to every taxiway point, without the centre line of runway `R` (a
  // g.rwys entry; crossing it is still allowed): { best, prev } (prev leads back towards p). Kept per graph.
  function taxiDistances(g, p, R) {
    const T = ontoTaxiway(g, p);
    if (!T) return null;
    if (!g.dist) g.dist = new Map();
    const key = `${T.u},${T.w},${T.pt},${g.rwys.indexOf(R)}`;
    if (g.dist.has(key)) return g.dist.get(key);
    const best = new Float64Array(g.pts.length).fill(Infinity);
    const prev = new Int32Array(g.pts.length).fill(-1);
    const heap = [];
    const push = (d, u) => {
      heap.push([d, u]);
      for (let i = heap.length - 1; i > 0;) {
        const up = (i - 1) >> 1;
        if (heap[up][0] <= heap[i][0]) break;
        [heap[i], heap[up]] = [heap[up], heap[i]];
        i = up;
      }
    };
    for (const u of [T.u, T.w]) { const d = metres(T.pt, g.pts[u]); if (d < best[u]) { best[u] = d; push(d, u); } }
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
      if (d > best[u]) continue;
      const along = R && R.on.has(u);
      for (const [w, len] of g.adj[u]) {
        if (along && R.on.has(w)) continue;
        const nd = d + len;
        if (nd >= best[w]) continue;
        best[w] = nd;
        prev[w] = u;
        push(nd, w);
      }
    }
    const out = { best, prev, end: T.pt };
    if (g.dist.size > 40) g.dist.clear();
    g.dist.set(key, out);
    return out;
  }

  // A 180° turn on a runway, as at its end or on a turn pad: from the centre line `4r` metres before `x0`
  // (coming the other way), out to one side and round, ending on the centre line at x0 facing `dir` (+1 the
  // runway's heading, -1 the other way). Before, planes turned round on the spot.
  function turnAround(rwy, x0, dir, w, side = 1) {
    const r = Math.max(6, Math.min(20, w * 0.27));
    const pts = [rwyPoint(rwy, x0 + dir * 4 * r, 0)];
    for (let a = -90; a >= -270; a -= 15) pts.push(rwyPoint(rwy, x0 + dir * r * Math.cos(toRad(a)), side * r * (Math.sin(toRad(a)) - 1)));
    return pts;
  }

  // The way between the stand side (`lanePt`) and runway `rwy` at a real layout: where on the runway the plane
  // turns off after landing (`landing`: the first good exit from `xMin` metres past the threshold on) or comes
  // onto it to take off (an entry from the side at most `xMax` in, as near the threshold as it can). An exit
  // that bends back more than 120° doesn't count: the plane would turn round on the spot. Returns { x, path }
  // in the order it is driven (the landing's starts on the runway, the takeoff's ends there), or null if no
  // exit or entry fits (then the plane backtracks along the runway).
  function realRunwayWay(code, lay, rwy, lanePt, landing, xMin, xMax) {
    const g = taxiGraph(code, lay);
    const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(p[1] - q[1]) < 1e-7;
    const R = g.rwys.find((q) => same(q.a, rwy.thr) || same(q.b, rwy.thr));
    if (!R) return null;
    const D = taxiDistances(g, lanePt, R);
    if (!D) return null;
    let pick = null;
    for (let k = 0; k < R.ids.length; k++) {
      const x = rwyCoords(rwy, g.pts[R.ids[k]]).along; // (measured from this end: not R.xs, from the first)
      if (x < xMin || x > xMax) continue;
      const id = R.ids[k];
      for (const [n, len] of g.adj[id]) {
        if (R.on.has(n) || D.best[n] === Infinity) continue;
        // The first 800 m of the way: while on the runway it must keep going the way the plane rolls (landing)
        // or will roll (takeoff), and every turn sharper than 135° (a fast exit taken towards gates behind it)
        // counts as 3 km more.
        let u = n;
        let p = g.pts[id];
        let h0 = landing ? rwy.hdg : rwy.hdg + 180; // (the way along the chain: from the runway out)
        let walked = 0;
        let sharp = 0;
        let wrong = false;
        while (u >= 0 && walked < 800) {
          const q = g.pts[u];
          const m = metres(p, q);
          if (m >= 3) {
            const a = rwyCoords(rwy, p), b = rwyCoords(rwy, q);
            const go = (landing ? 1 : -1) * (b.along - a.along) / m; // cos of the way driven with the runway heading
            if (Math.abs(a.across) < R.w / 2 + 3 && a.along > -60 && a.along < rwy.len + 60 && go < -0.5) { wrong = true; break; }
            const h = bearing({ lat: p[0], lon: p[1] }, { lat: q[0], lon: q[1] });
            if (Math.abs(((h - h0 + 540) % 360) - 180) > 135) sharp++;
            h0 = h;
            walked += m;
            p = q;
          }
          u = D.prev[u];
        }
        if (wrong) continue;
        // (a landing plane rolls on to an exit at half the cost; a departing one starts as near the threshold
        // as it can: runway behind it is wasted)
        const cost = len + D.best[n] + sharp * 3000 + (landing ? (x - xMin) * 0.5 : x * 3);
        if (!pick || cost < pick.cost) pick = { cost, x, id, n };
      }
    }
    if (!pick) return null;
    const path = [g.pts[pick.id]];
    for (let u = pick.n; u >= 0; u = D.prev[u]) path.push(g.pts[u]);
    path.push(D.end);
    // A taxiway that ends on the runway a few metres from its point: the plane turns on or off right there,
    // not with a jog back or sideways.
    const c = rwyCoords(rwy, g.pts[pick.n]);
    let x = pick.x;
    if (Math.abs(c.across) < Math.min(10, R.w / 2) && Math.abs(c.along - x) < 60) {
      x = c.along;
      path[0] = rwyPoint(rwy, x, 0);
      path.splice(1, 1);
    }
    return { x, path: landing ? path : path.reverse() };
  }

  // ---------- expansion preview (developer tools) ----------
  // What the possible construction at an airport would add: each kind of runway where it would be built
  // (with its taxiway), and the apron, stands and buildings of the next terminal size.
  // ---------- smooth taxiways ----------
  // A line [[lat, lon], ..] with its corners rounded: each bend becomes an arc of `radius` m (less where its
  // legs are short: two arcs never take more than half of a leg between them, and never the end legs whole).
  function roundLine(line, radius = 45) {
    if (line.length < 3) return line.map((p) => p.slice());
    const o = line[0];
    const kx = 111320 * Math.cos(toRad(o[0]));
    const p = line.map((q) => [(q[1] - o[1]) * kx, (q[0] - o[0]) * 111320]);
    const ll = (q) => [Math.round((o[0] + q[1] / 111320) * 1e6) / 1e6, Math.round((o[1] + q[0] / kx) * 1e6) / 1e6];
    const out = [p[0]];
    for (let i = 1; i < p.length - 1; i++) {
      const a = p[i - 1], b = p[i], c = p[i + 1];
      const lu = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const lv = Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (lu < 0.5 || lv < 0.5) { out.push(b); continue; }
      const u = [(b[0] - a[0]) / lu, (b[1] - a[1]) / lu];
      const v = [(c[0] - b[0]) / lv, (c[1] - b[1]) / lv];
      const th = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))); // how far it turns
      if (th < toRad(2) || th > toRad(175)) { out.push(b); continue; }
      const side = u[0] * v[1] - u[1] * v[0] > 0 ? 1 : -1; // left (1) or right
      const tan = Math.tan(th / 2);
      const T = Math.min(radius * tan, 0.95 * (i === 1 ? lu : lu / 2), 0.95 * (i === p.length - 2 ? lv : lv / 2));
      const r = T / tan;
      const p1 = [b[0] - u[0] * T, b[1] - u[1] * T];
      const n = [-side * u[1], side * u[0]]; // towards the arc's centre
      const cen = [p1[0] + n[0] * r, p1[1] + n[1] * r];
      const w = [p1[0] - cen[0], p1[1] - cen[1]];
      const steps = Math.max(2, Math.ceil(th / toRad(5))); // a point every 5 degrees
      for (let k = 0; k <= steps; k++) {
        const x = (side * th * k) / steps;
        out.push([cen[0] + w[0] * Math.cos(x) - w[1] * Math.sin(x), cen[1] + w[0] * Math.sin(x) + w[1] * Math.cos(x)]);
      }
    }
    out.push(p[p.length - 1]);
    return out.map(ll);
  }

  // ---------- stand classes ----------
  // Each stand's room (see the stand size classes above): the nearest stand beside it (one pointing about the same
  // way whose plane would stand next to its plane: less than 30 m before or behind it and at least 8 m to the
  // side, at a real airport 20 m: nearer, it is the same stand for another type), and twice the
  // nearest building beside its plane (5 to 40 m behind its nose; the building its nose points at is ahead of
  // it). Sets st.room (m) and st.cls.
  function classifyStands(code, ap) {
    ap.classed = true;
    const stands = ap.stands;
    if (!stands.length) return;
    const o = [stands[0].lat, stands[0].lon];
    const kx = 111320 * Math.cos(toRad(o[0]));
    const xy = (p) => [(p[1] - o[1]) * kx, (p[0] - o[0]) * 111320];
    const P = stands.map((st) => xy([st.lat, st.lon]));
    const dir = stands.map((st) => [Math.sin(toRad(st.heading)), Math.cos(toRad(st.heading))]);
    // building walls as points every 6 m (not the jet bridges, which reach to the plane's door, nor roads and car
    // parks). Only at an airport you built (and where a stand is being placed): the map data's stands often point
    // the wrong way round, and would have their own terminal beside them.
    const a = airportByCode[code];
    // (the map data's stands come with variants beside them, left and right of the middle one, for two smaller
    // planes instead of a big one: nearer than 20 m to the side they don't count there; your own stands do from 8 m)
    const sideBy = a && !a.built ? 20 : 8;
    const wall = [];
    const walls = a && !a.built ? [] : ap.buildings.filter((b) => b.kind === 'terminal' || b.kind === 'hall' || b.kind === 'hangar' || b.kind === 'other');
    for (const ring of a && !a.built ? [] : [ap.terminal, ...walls.map((b) => b.ring)]) {
      if (!ring || ring.length < 2) continue;
      const q = ring.map(xy);
      for (let i = 0; i < q.length; i++) {
        const a = q[i], b = q[(i + 1) % q.length];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6));
        for (let k = 0; k < n; k++) wall.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
    }
    stands.forEach((st, i) => {
      let room = 200;
      const [ux, uy] = dir[i];
      const near = (q) => {
        const dx = q[0] - P[i][0], dy = q[1] - P[i][1];
        return [dx * ux + dy * uy, Math.abs(dx * uy - dy * ux)]; // [ahead, beside]
      };
      for (let j = 0; j < stands.length; j++) {
        if (j === i) continue;
        // (one the other way round is across a pier or a lane; closer than 12 m, the same stand for another type,
        // as the map data often has them: neither stands beside it)
        if (Math.abs(wrap180(stands[j].heading - st.heading)) > 60) continue;
        const [ahead, beside] = near(P[j]);
        if (Math.abs(ahead) < 30 && beside >= sideBy) room = Math.min(room, beside);
      }
      for (const q of wall) {
        const [ahead, beside] = near(q);
        if (ahead < -5 && ahead > -40) room = Math.min(room, 2 * beside);
      }
      st.room = Math.round(room * 10) / 10;
      st.cls = classForRoom(room);
    });
    // A real airport's stands take at least class C (B at size 1: the map data's stands are seldom exactly where
    // the planes stand), and its roomiest third what its size stands for (CLASS_BY_SIZE).
    if (a && !a.built) {
      const least = [0, 1, 2, 2, 2, 2][baseSize(code)];
      for (const st of stands) st.cls = Math.max(st.cls, least);
      const floor = CLASS_BY_SIZE[baseSize(code)];
      const order = stands.map((st, i) => i).sort((x, y) => stands[y].room - stands[x].room);
      for (const i of order.slice(0, Math.ceil(stands.length / 3))) stands[i].cls = Math.max(stands[i].cls, floor);
    }
  }
  // The class a stand at p (nose heading `hdg`) would have at an airport, as it is now (build mode shows it).
  // `skip`: [lat, lon] of a stand that is not counted (the one being moved).
  function standClassAt(code, p, hdg, skip) {
    const ap = apronOf(code);
    const others = ap.stands.filter((st) => !skip || Math.abs(st.lat - skip[0]) > 3e-5 || Math.abs(st.lon - skip[1]) > 4e-5);
    const probe = { lat: p[0], lon: p[1], heading: hdg };
    const tmp = { stands: [probe, ...others], terminal: ap.terminal, buildings: ap.buildings };
    classifyStands('', tmp); // (no airport: no floor)
    return { cls: probe.cls, room: probe.room };
  }
  // The biggest class an airport takes: from its stands where the layout is there (or it is yours), else what
  // its size stands for (so that looking at the map doesn't make every airport load its layout).
  function maxClass(code) {
    const a = airportByCode[code];
    if (a.factory) return 5;
    if (a.built || (FG.layouts && FG.layouts.has(code))) return Math.max(...apronOf(code).stands.map((st) => st.cls), 0);
    return CLASS_BY_SIZE[baseSize(code)];
  }

  // ---------- crossing runways ----------
  // Where other runways cover a runway: the maps leave the paint of both out there (side stripes, centre line,
  // markings), so that where two runways cross neither is painted over the other. Returns cover(lo, hi): the
  // stretches [from, to] (metres from the runway's first end) where its band `lo`..`hi` metres right of the centre
  // line lies on another runway, and at(along, across): that point [lat, lon].
  function runwayCover(r, others) {
    const len = runwayLength(r);
    const rwy = { thr: [r[0], r[1]], hdg: bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] }), len };
    const quads = [];
    for (const o of others) {
      if (o === r || [0, 1, 2, 3].every((i) => o[i] === r[i])) continue;
      const olen = runwayLength(o);
      const orw = { thr: [o[0], o[1]], hdg: bearing({ lat: o[0], lon: o[1] }, { lat: o[2], lon: o[3] }), len: olen };
      const half = Math.max(18, o[4] || 30) / 2;
      const q = [[0, -half], [olen, -half], [olen, half], [0, half]].map(([al, ac]) => rwyCoords(rwy, rwyPoint(orw, al, ac)));
      // (only those that come near it)
      if (q.every((p) => p.along < -50) || q.every((p) => p.along > len + 50) || q.every((p) => p.across > 200) || q.every((p) => p.across < -200)) continue;
      quads.push(q);
    }
    // the stretch of the line `across` that lies in quad q, or null
    const span = (q, across) => {
      const xs = [];
      for (let i = 0; i < 4; i++) {
        const a = q[i], b = q[(i + 1) % 4];
        if ((a.across - across) * (b.across - across) > 0 || a.across === b.across) continue;
        xs.push(a.along + ((across - a.across) / (b.across - a.across)) * (b.along - a.along));
      }
      return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
    };
    return {
      len,
      cover(lo, hi = lo) {
        const out = [];
        for (const q of quads) {
          let s = null;
          for (const c of lo === hi ? [lo] : [lo, (lo + hi) / 2, hi]) {
            const x = span(q, c);
            if (x) s = s ? [Math.min(s[0], x[0]), Math.max(s[1], x[1])] : x;
          }
          if (s) out.push(s);
        }
        out.sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const s of out) {
          const last = merged[merged.length - 1];
          if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push(s.slice());
        }
        return merged;
      },
      // the parts of [a0, a1] that are not covered
      open(a0, a1, lo, hi = lo) {
        const parts = [];
        let at = a0;
        for (const [c0, c1] of this.cover(lo, hi)) {
          if (c1 <= at) continue;
          if (c0 >= a1) break;
          if (c0 > at) parts.push([at, c0]);
          at = Math.max(at, c1);
        }
        if (at < a1) parts.push([at, a1]);
        return parts;
      },
      at: (along, across) => rwyPoint(rwy, along, across),
    };
  }

  // ---------- where new runways go ----------
  // A new runway is put where it is clear of the airport: its aprons and buildings (150 m: the runway strip and
  // the clearance round it), the other runways (a parallel one at least 400 m from them; a crosswind runway may
  // cross them, js/ui.js and view3d.js then paint neither over the other) and the runways of airports nearby.
  // Of the places that are clear, the first of a list in the order a planner would take them.
  function siteObstacles(code) {
    const ap = apronOf(code);
    const rings = [];
    const add = (r, m, w) => { if (r && r.length > 2) rings.push({ r, m, w }); };
    for (const r of ap.aprons || [ap.apron]) add(r, 90, 3);
    for (const r of ap.pads || []) add(r, 90, 3);
    add(ap.terminal, 150, 4);
    for (const b of ap.buildings) add(b.ring, 150, 2);
    const known = FG.obstacles && FG.obstacles[code];
    if (known) for (const r of known.rings) add(r, 120, 1);
    return { rings, lines: known ? known.lines : [] };
  }
  // How badly a runway from `thr` on heading `hdg` (len, width m) hits what is in the way (0: not at all).
  // `runways`: [[lat, lon, lat, lon], margin] the runways it must keep off.
  function runwayHits(thr, hdg, len, width, obst, runways) {
    const rwy = { thr, hdg, len };
    const C = (p) => rwyCoords(rwy, p);
    const x0 = -60, x1 = len + 60, y0 = -width / 2, y1 = width / 2;
    // Does the segment p-q (runway coordinates) come within `m` of the runway's rectangle?
    const hits = (p, q, m) => {
      let t0 = 0;
      let t1 = 1;
      for (const [d, lo, hi, v] of [[q.along - p.along, x0 - m, x1 + m, p.along], [q.across - p.across, y0 - m, y1 + m, p.across]]) {
        if (Math.abs(d) < 1e-9) { if (v < lo || v > hi) return false; continue; }
        const ta = (lo - v) / d;
        const tb = (hi - v) / d;
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
        if (t0 > t1) return false;
      }
      return true;
    };
    let bad = 0;
    for (const { r, m, w } of obst.rings) {
      const q = r.map(C);
      if (q.every((p) => p.along < x0 - m || p.along > x1 + m || Math.abs(p.across) > width / 2 + m + 2000)) continue;
      if (q.some((p, i) => hits(p, q[(i + 1) % q.length], m))) bad += w;
    }
    for (const [p, q] of obst.lines) if (hits(C(p), C(q), 25)) bad += 0.2; // (a taxiway can be moved; a runway is better off it)
    for (const [r, m] of runways) if (hits(C([r[0], r[1]]), C([r[2], r[3]]), m)) bad += 5;
    return bad;
  }
  // The runway [lat, lon, lat, lon, width, paved] for a project: `orient` 'parallel', 'cross' or 'new'.
  function placeRunway(code, len, orient) {
    const a = airportByCode[code];
    const rws = airportRunways(code);
    const width = len >= 2500 ? 45 : 30;
    const obst = siteObstacles(code);
    const nearby = neighbours(code, 15).flatMap((b) => airportRunways(b.code)).map((r) => [r, 300]);
    const make = (mid, hdg) => {
      const e1 = offsetPoint(mid[0], mid[1], hdg + 180, len / 2);
      const e2 = offsetPoint(mid[0], mid[1], hdg, len / 2);
      return [e1[0], e1[1], e2[0], e2[1], width, 1];
    };
    const cands = []; // [mid, hdg, extra runways to keep off]
    const main = rws.length ? rws.reduce((m, x) => (runwayLength(x) > runwayLength(m) ? x : m), rws[0]) : null;
    if (!main) {
      for (const h of [70, 50, 90, 30, 110, 10, 130, 150]) {
        for (const shift of [0, 600, -600, 1200, -1200]) cands.push([offsetPoint(a.lat, a.lon, h + 90, shift), h, []]);
      }
    } else {
      const h = bearing({ lat: main[0], lon: main[1] }, { lat: main[2], lon: main[3] });
      const mlen = runwayLength(main);
      const mid = [(main[0] + main[2]) / 2, (main[1] + main[3]) / 2];
      const ap = apronOf(code);
      // the apron's side of the main runway: a parallel runway goes to the other side first
      const apSide = rwyCoords({ thr: [main[0], main[1]], hdg: h }, ap.ref || [a.lat, a.lon]).across < 0 ? -1 : 1;
      if (orient === 'cross') {
        // across the main runway, from right angles down to 45 degrees off it, where it crosses near an end or
        // in the middle; or where it only meets it with its end (a V)
        for (const turn of [90, -90, 60, -60, 120, -120, 45, -45, 135, -135]) {
          for (const at of [0.2, 0.8, 0.5, 0.35, 0.65, 0.05, 0.95]) {
            for (const own of [0.5, 0.25, 0.75, 0.05, 0.95]) {
              const x = offsetPoint(main[0], main[1], h, mlen * at);
              cands.push([offsetPoint(x[0], x[1], h + turn, len * (0.5 - own)), h + turn, rws.filter((r) => r !== main).map((r) => [r, 0])]);
            }
          }
        }
      } else {
        for (const sep of [400, 550, 760, 1035, 1300, 1600, 2000]) {
          for (const side of [-apSide, apSide]) {
            for (const shift of [0, (mlen - len) / 2, -(mlen - len) / 2, 400, -400]) {
              const c = offsetPoint(mid[0], mid[1], h + 90 * side, sep);
              cands.push([offsetPoint(c[0], c[1], h, shift), h, rws.map((r) => [r, 300])]);
            }
          }
        }
      }
    }
    let best = null;
    for (const [mid, hdg, keepOff] of cands) {
      const r = make(mid, hdg);
      const bad = runwayHits([r[0], r[1]], (hdg + 360) % 360, len, width, obst, [...keepOff, ...nearby]);
      if (!best || bad < best.bad) best = { bad, r };
      if (!bad) break;
    }
    return best.r.map((v, i) => (i < 4 ? Math.round(v * 1e5) / 1e5 : v));
  }

  // Taxiways for a new runway at an airport with a layout of its own (real, or built by the player; a layout
  // the game makes up has them already, taxiwaysOf): a parallel taxiway on the apron's side where none runs yet,
  // exits at right angles at both ends (and at the thirds of a long runway) where there is none, and a link from
  // the new parallel taxiway into the taxiways there are. Lines [[lat, lon], ..].
  function runwayTaxiways(code, r) {
    const ap = apronOf(code);
    const len = runwayLength(r);
    const rwy = { thr: [r[0], r[1]], hdg: bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] }), len };
    const W = r[4] || 30;
    const ref = ap.ref || ap.terminal[0];
    const off = (rwyCoords(rwy, ref).across < 0 ? -1 : 1) * (W >= 45 ? 180 : W >= 30 ? 150 : 100);
    const segs = taxiwaysOf(code);
    // the nearest point of the taxiways there are: { d (m), q }
    const nearest = (p) => {
      const kx = 111320 * Math.cos(toRad(p[0]));
      let best = { d: Infinity, q: null };
      for (const [a, b] of segs) {
        const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * 111320;
        const dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * 111320;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d < best.d) best = { d, q: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] };
      }
      return best;
    };
    const lines = [];
    // the parallel taxiway, in pieces where no taxiway runs along there yet
    const STEP = 25;
    const n = Math.max(1, Math.round(len / STEP));
    const at = Array.from({ length: n + 1 }, (_, i) => rwyPoint(rwy, (len * i) / n, off));
    const there = at.map((p) => nearest(p).d < 40);
    let fresh = 0;
    for (let i = 0; i <= n;) {
      if (there[i]) { i++; continue; }
      let j = i;
      while (j < n && !there[j + 1]) j++;
      if ((j - i) * STEP >= 100 || i === 0 || j === n) {
        const a = Math.max(0, i - 1), b = Math.min(n, j + 1);
        const line = [at[a], at[b]];
        // (a piece that ends beside a taxiway joins it)
        for (const k of [a, b]) {
          if (!there[k]) continue;
          const f = nearest(at[k]);
          if (f.d > 3) lines.push([at[k], f.q]);
        }
        lines.push(line);
        fresh += (b - a) * STEP;
      }
      i = j + 1;
    }
    // exits; where all of the parallel taxiway is new, it and its end exits are one line, round at the corners
    const whole = fresh >= len - 1 && lines.length === 1;
    if (whole) lines[0] = roundLine([rwyPoint(rwy, 0, 0), rwyPoint(rwy, 0, off), rwyPoint(rwy, len, off), rwyPoint(rwy, len, 0)], Math.min(60, Math.abs(off) * 0.6));
    const exits = whole ? [] : [0, len];
    if (len >= 1500) exits.push(len / 3, (2 * len) / 3);
    for (const x of exits) {
      if (nearest(rwyPoint(rwy, x, off / 2)).d < 30) continue;
      lines.push([rwyPoint(rwy, x, 0), rwyPoint(rwy, x, off)]);
    }
    // all of the parallel taxiway is new: a way from it to the nearest taxiway (or the apron)
    if (fresh >= len - 1) {
      let best = { d: Infinity };
      for (const p of at.slice(1, -1)) { // (from the straight part: the ends are round now)
        const f = nearest(p);
        if (f.d < best.d) best = { d: f.d, p, q: f.q };
      }
      if (!best.q) { // no taxiways at all: to the apron
        for (const p of at) for (const q of ap.aprons ? ap.aprons.flat() : ap.apron) { const d = metres(p, q); if (d < best.d) best = { d, p, q }; }
      }
      if (best.q && best.d < 5000) lines.push([best.p, best.q]);
    }
    const r6 = (v) => Math.round(v * 1e6) / 1e6; // (to 0.1 m: a curve rounded to 1 m wobbles)
    return lines.map((l) => l.map((p) => [r6(p[0]), r6(p[1])])).filter((l) => metres(l[0], l[l.length - 1]) > 2);
  }

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
      if (ap.real) { out.taxiways.push(...runwayTaxiways(code, r).flatMap((l) => l.slice(1).map((p, i) => [l[i], p]))); continue; }
      const len = runwayLength(r);
      const rwy = { thr: [r[0], r[1]], hdg: bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] }), len };
      const off = taxiwayOffset(rwy, ap.ref);
      out.taxiways.push([rwyPoint(rwy, 0, off), rwyPoint(rwy, len, off)]);
      for (const a of [0, len]) out.taxiways.push([rwyPoint(rwy, a, off), rwyPoint(rwy, a, 0)]);
      for (const e of ap.exits) out.taxiways.push([e, rwyPoint(rwy, Math.min(len, Math.max(0, rwyCoords(rwy, e).along)), off)]);
    }
    const size = baseSize(code);
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

  // A plane's stand at an airport: where it parks nose-in (heading = towards the terminal). `type`: the plane's,
  // where planeId is no plane of the fleet (route lines).
  function gateOf(code, planeId, type) {
    const p = !type && Game.state && Game.state.planes.find((q) => q.id === planeId);
    return standSpot(code, standIndex(code, planeId), type || (p && p.type));
  }
  // Where a plane of that type parks on stand k (see parkBack), and how far it is pushed back from there.
  function standSpot(code, k, type) {
    const ap = apronOf(code);
    const a = airportByCode[code];
    if (!ap.stands.length) return { lat: a.lat, lon: a.lon, heading: 0, name: '', push: TAXI_LANE };
    const st = ap.stands[Math.min(k, ap.stands.length - 1)];
    const push = st.push || TAXI_LANE;
    const back = parkBack(ap, st, type, push);
    const [lat, lon] = back ? offsetPoint(st.lat, st.lon, st.heading + 180, back) : [st.lat, st.lon];
    return { lat, lon, heading: st.heading, name: st.name, bridge: st.bridge, push: push - back };
  }

  // Planes stop short of buildings. A stand's point is where the middle of the plane parks, so a long plane's nose
  // reached into the terminal or a hangar where the stand lies close to it. The plane parks further back along the
  // stand's line until its nose is NOSE_GAP m short of the nearest wall ahead (looked for along its nose, a little
  // either side); its pushback is that much shorter, so it still ends where it did. Kept per apron and type.
  const NOSE_GAP = 4;
  const WALLS = { terminal: 1, hangar: 1, other: 1, hall: 1, tower: 1, glass: 1, plant: 1 }; // (standing on the ground)
  const parkCache = new WeakMap();
  function parkBack(ap, st, type, push) {
    const look = type && D.looks && D.looks[type];
    if (!look || !ap.buildings) return 0;
    let byStand = parkCache.get(ap);
    if (!byStand) parkCache.set(ap, (byStand = new Map()));
    const key = `${st.lat},${st.lon},${st.heading}|${type}`;
    if (byStand.has(key)) return byStand.get(key);
    // Metres east and north of the stand point; d = along the nose, r = to its right.
    const kx = 111320 * Math.cos(st.lat * Math.PI / 180);
    const loc = (q) => [(q[1] - st.lon) * kx, (q[0] - st.lat) * 111320];
    const h = st.heading * Math.PI / 180;
    const d = [Math.sin(h), Math.cos(h)];
    const r = [Math.cos(h), -Math.sin(h)];
    const reach = look.len / 2 + NOSE_GAP;
    const near = (ring) => { // (its box within reach, whatever the corners: a long wall can pass close by)
      const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
      const dx = Math.max(Math.min(...xs), 0, -Math.max(...xs)), dy = Math.max(Math.min(...ys), 0, -Math.max(...ys));
      return Math.hypot(dx, dy) < reach + push;
    };
    const rings = ap.buildings.filter((b) => WALLS[b.kind] && (b.base || 0) <= 3).map((b) => b.ring.map(loc)).filter(near);
    // Free metres ahead of the plane parked `back` m behind the stand point.
    const clearAt = (back) => {
      let clear = Infinity;
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const [px, py] = ring[i];
          const [qx, qy] = ring[(i + 1) % ring.length];
          const ex = qx - px, ey = qy - py;
          const den = d[0] * ey - d[1] * ex;
          if (Math.abs(den) < 1e-9) continue; // (a wall along the nose)
          for (const o of [-(look.dia || 3) / 2, 0, (look.dia || 3) / 2]) {
            const ox = r[0] * o - d[0] * back - px, oy = r[1] * o - d[1] * back - py; // ray start from the wall's corner
            const t = (ex * oy - ey * ox) / den;      // along the nose
            const u = (d[0] * oy - d[1] * ox) / den;  // along the wall
            if (t > 0 && u >= 0 && u <= 1 && t < clear) clear = t;
          }
        }
      }
      return clear;
    };
    // (again from there: further back, another wall may come in the way; never so far back that the pushback would
    // be shorter than 15 m)
    const most = Math.max(0, push - 15);
    let back = 0;
    // (a stand point the map data has inside a building: out of it backwards first, the nose short of its wall)
    const within = (ring) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * -yi) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    for (const ring of rings.filter(within)) {
      for (let i = 0; i < ring.length; i++) {
        const [px, py] = ring[i];
        const [qx, qy] = ring[(i + 1) % ring.length];
        const ex = qx - px, ey = qy - py;
        const den = -d[0] * ey + d[1] * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = (ex * -py - ey * -px) / den;       // backwards along the stand line
        const u = (-d[0] * -py + d[1] * -px) / den;
        if (t > 0 && u >= 0 && u <= 1) back = Math.max(back, Math.min(most, t + reach));
      }
    }
    for (let k = 0; k < 4 && back < most; k++) {
      const clear = clearAt(back);
      if (clear >= reach) break;
      back = Math.min(most, back + reach - clear);
    }
    byStand.set(key, back);
    return back;
  }

  // Flight performance of a type: climb rate near the ground (ft/min), lift-off and approach speeds (km/h) and
  // the bank angle in turns. By category, unless the type has its own (climbFpm, vLofKmh, vAppKmh, bankDeg).
  const PERF = {
    turboprop: { climbFpm: 1800, vLof: 200, vApp: 210, bank: 25 },
    regional: { climbFpm: 3000, vLof: 265, vApp: 245, bank: 25 },
    narrowbody: { climbFpm: 2600, vLof: 285, vApp: 255, bank: 25 },
    widebody: { climbFpm: 2300, vLof: 315, vApp: 275, bank: 25 },
    classic: { climbFpm: 1000, vLof: 180, vApp: 195, bank: 20 },
  };
  const perfCache = {};
  function perf(type) {
    if (perfCache[type]) return perfCache[type];
    const ac = D.aircraft[type];
    const base = PERF[ac.category] || PERF.narrowbody;
    const small = ac.category === 'turboprop' && ac.seats <= 20; // (commuters: slower and steeper)
    return (perfCache[type] = {
      climbFpm: ac.climbFpm || (small ? 1600 : base.climbFpm),
      vLof: ac.vLofKmh || (small ? 160 : base.vLof),
      vApp: ac.vAppKmh || (small ? 170 : base.vApp),
      bank: ac.bankDeg || base.bank,
    });
  }

  // Ground under a flight (FG.ground, js/ground.js): metres, or null while it is loading.
  const groundAt = (lat, lon) => (FG.ground ? FG.ground.at(lat, lon) : 0);
  const groundMax = (lat, lon) => (FG.ground ? FG.ground.maxNear(lat, lon, 300) : 0);
  const TERRAIN_CLEAR_FT = 1500;  // en route: at least this high above the ground within 300 m of the track
  const TERRAIN_SKIP_FT = 26000;  // where the plane would fly higher than this, the ground isn't looked at
  const TAXI_KMH = 25;
  const HOLD_KM = 0.25;           // planes wait for their departure this far before the runway threshold

  // n full circles (side 1 = right turns, -1 = left) starting and ending at p, flying heading hdg there.
  function circles(p, hdg, r, n, side) {
    const c = offsetPoint(p[0], p[1], hdg + 90 * side, r);
    const a0 = hdg - 90 * side;
    const pts = [];
    for (let k = 1; k <= 36 * n; k++) pts.push(offsetPoint(c[0], c[1], a0 + side * 10 * k, r));
    return pts;
  }

  // A flight's track: pushback, taxi, takeoff roll, climb, cruise, descent, landing roll, taxi in, all with the
  // type's own performance (perf). Heights are feet above sea level: the plane climbs from its runway, stays
  // well clear of the ground on the way (circling over the airport first where mountains are too close to
  // outclimb, and before the final approach where they are too close to descend after) and comes down a 3°
  // glide path. The flight takes as long as such a flight takes; what is left of the game's block time it
  // waits at the gate (boarding) before pushback.
  function buildTrack(type, f, planeId) {
    const day = Math.floor(f.dep / DAY);
    const A0 = airportByCode[f.from];
    const B0 = airportByCode[f.to];
    const ac = D.aircraft[type];
    const pf = perf(type);
    const need = runwayNeed(type);
    // (the runways the player chose for this plane, as they were when the flight began: Game.setRunway)
    const rw = f.rw || {};
    const dep = pickRunway(f.from, day, need, rw.from);
    const arr = pickRunway(f.to, day, need, rw.to);
    // Turn radius from the bank angle at about 1.35 × the approach speed: r = v² / (g tan φ).
    const vTurn = pf.vApp * 1.35 / 3.6;
    const radius = vTurn * vTurn / (9.81 * Math.tan(toRad(pf.bank)));
    const P = (ll) => ({ lat: ll[0], lon: ll[1] });

    // Takeoff run to lift-off at ~2.2 m/s² (an A320 in about 36 s and 1400 m), landing run within the runway at
    // brakeDecel (its reversers help), so the plane turns off at an earlier exit with them.
    const vLofMs = pf.vLof / 3.6;
    const vAppMs = pf.vApp / 3.6;
    const stopM = Math.min(arr.len * 0.85, Math.max(400 + 300, 400 + vAppMs * vAppMs / (2 * brakeDecel(type))));

    // Gates: pushed back out of the stand at the start, nose-in onto the stand at the end.
    const gA = gateOf(f.from, planeId, type);
    const gB = gateOf(f.to, planeId, type);
    const standA = [gA.lat, gA.lon];
    const standB = [gB.lat, gB.lon];
    const pushA = offsetPoint(gA.lat, gA.lon, gA.heading + 180, gA.push);
    const leadB = offsetPoint(gB.lat, gB.lon, gB.heading + 180, gB.push);
    // Taxi out along the taxiways onto the runway (from the side, near the threshold: an entry up to 400 m in
    // where the runway is long enough), and in from the first exit after the plane has slowed down. Before,
    // planes stopped on the runway and turned round on the spot for an exit behind them.
    const out = runwayWay(f.from, dep, pushA, false, 0, Math.max(60, Math.min(400, dep.len - need.m)));
    const inn = runwayWay(f.to, arr, leadB, true, stopM);
    const lineUp = out.x > 1 ? rwyPoint(dep, out.x, 0) : dep.thr; // where the takeoff run starts
    const stop = inn.x !== stopM ? rwyPoint(arr, inn.x, 0) : offsetPoint(arr.thr[0], arr.thr[1], arr.hdg, stopM); // where it leaves the runway
    const near = (p, q) => p && metres(p, q) < 5;
    const outPath = near(out.path[out.path.length - 1], lineUp) ? out.path.slice(0, -1) : out.path;
    const inPath = near(inn.path[0], stop) ? inn.path.slice(1) : inn.path;
    const rollM = Math.min((dep.len - out.x) * 0.85, Math.max(250, vLofMs * vLofMs / 4.4));
    const lift = offsetPoint(lineUp[0], lineUp[1], dep.hdg, rollM);
    const climbOut = offsetPoint(dep.end[0], dep.end[1], dep.hdg, ac.speedKmh < 450 ? 2500 : 5000);
    const faf = offsetPoint(arr.thr[0], arr.thr[1], arr.hdg + 180, FINAL_KM * 1000);
    const touch = offsetPoint(arr.thr[0], arr.thr[1], arr.hdg, 400);

    const outTurn = turnToward(climbOut, dep.hdg, P(faf), radius);
    const turnEnd = outTurn.length ? outTurn[outTurn.length - 1] : climbOut;
    // The arrival turn is built backwards from the final approach fix.
    const inTurn = turnToward(faf, arr.hdg + 180, P(turnEnd), radius).reverse();
    const turnStart = inTurn.length ? inTurn[0] : faf;

    const cruisePts = [];
    const cruise = distanceKm(P(turnEnd), P(turnStart));
    const n = Math.max(1, Math.ceil(cruise / 25));
    for (let i = 1; i < n; i++) cruisePts.push(interpolate(P(turnEnd), P(turnStart), i / n));

    // Circles to the side with the lower ground (where it is known).
    const lowSide = (p, hdg) => {
      const top = (side) => Math.max(...circles(p, hdg, radius, 1, side).filter((_, k) => k % 3 === 0)
        .map((q) => groundMax(q[0], q[1]) ?? 0));
      return top(-1) < top(1) ? -1 : 1;
    };
    const sideOut = lowSide(climbOut, dep.hdg);
    const sideIn = lowSide(faf, arr.hdg);

    // The track with `orbits` = [circles climbing after takeoff, circles descending before the final].
    function geometry(orbits) {
      const up = orbits[0] ? circles(climbOut, dep.hdg, radius, orbits[0], sideOut) : [];
      const down = orbits[1] ? [faf, ...circles(faf, arr.hdg, radius, orbits[1], sideIn).slice(0, -1)] : [];
      const pts = [standA, pushA, ...outPath, lineUp, lift, dep.end, climbOut, ...up, ...outTurn, ...cruisePts,
        ...inTurn, ...down, faf, arr.thr, touch, stop, ...inPath, leadB, standB];
      const iThr = 2 + outPath.length;
      const iClimb = iThr + 3; // climbOut
      const idx = { push: 1, thr: iThr, lift: iThr + 1, touch: pts.length - 4 - inPath.length, stop: pts.length - 3 - inPath.length, lead: pts.length - 2 };
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distanceKm(P(pts[i - 1]), P(pts[i])));
      // Where the circles are (the procedure keeps them clear of the ground, so the ground isn't asked there).
      const iFaf = idx.touch - 2;
      const skip = [[cum[iClimb], cum[iClimb + up.length]], [cum[iFaf - down.length], cum[iFaf]]];
      return { pts, cum, idx, skip };
    }

    // Position at distance s along the track.
    const posOn = (g, s) => {
      let i = 1;
      let hi = g.cum.length - 1;
      while (i < hi) { const m = (i + hi) >> 1; if (g.cum[m] < s) i = m + 1; else hi = m; }
      const a = g.pts[i - 1];
      const b = g.pts[i];
      const fr = g.cum[i] > g.cum[i - 1] ? Math.min(1, Math.max(0, (s - g.cum[i - 1]) / (g.cum[i] - g.cum[i - 1]))) : 1;
      return [a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr];
    };

    const FT = 3.28084;
    let e0 = groundAt(dep.thr[0], dep.thr[1]);
    let e1 = groundAt(arr.thr[0], arr.thr[1]);
    let terrainMissing = e0 === null || e1 === null;
    e0 = (e0 || 0) * FT;
    e1 = (e1 || 0) * FT;
    const typeCruise = cruiseFt(type);
    const vCruise = ac.speedKmh;
    const vApp = pf.vApp;
    const v250 = Math.min(vCruise, 463);
    const climbRate = (alt) => pf.climbFpm * Math.max(0.3, 1 - 0.65 * alt / typeCruise); // ft/min
    const gradLow = pf.climbFpm * 0.8 / (Math.min(v250, pf.vLof * 1.5) / 60); // ft per km, low down

    // Heights along the track (feet above sea level) on a grid between lift-off and touchdown.
    function profile(g) {
      const sLift = g.cum[g.idx.lift];
      const sTouch = g.cum[g.idx.touch];
      const airborne = sTouch - sLift;
      const N = Math.min(4000, Math.max(200, Math.ceil(airborne / 0.4)));
      const ds = airborne / N;
      const S = (i) => sLift + i * ds;
      const fieldAt = (s) => e0 + (e1 - e0) * Math.min(1, Math.max(0, (s - sLift) / airborne));
      // Speed (km/h) at a height: from lift-off speed to 250 kt by 3000 ft above the field, to cruise speed
      // above 10,000 ft, slowing to the approach speed for the last 25 km before the final approach fix.
      const speedAt = (s, alt, cruiseAlt) => {
        const h = alt - fieldAt(s);
        let v = h < 3000 ? pf.vLof * 1.15 + (v250 - pf.vLof * 1.15) * Math.sqrt(Math.max(0, h) / 3000)
          : alt < 10000 ? v250 : v250 + (vCruise - v250) * Math.min(1, (alt - 10000) / Math.max(5000, cruiseAlt - 10000));
        const toTouch = sTouch - s;
        if (toTouch < FINAL_KM) v = vApp * (0.93 + 0.07 * toTouch / FINAL_KM); // on final
        else if (toTouch < FINAL_KM + 25) v = Math.min(v, vApp + (v250 - vApp) * (toTouch - FINAL_KM) / 25);
        return Math.max(Math.min(pf.vLof, vApp) * 0.9, v);
      };
      // Highest the plane can be: climbing at its rate from the runway (C), and still able to come down a 3°
      // glide path to the other runway (Dn).
      const Cl = new Float64Array(N + 1);
      const Dn = new Float64Array(N + 1);
      Cl[0] = e0;
      for (let i = 0; i < N; i++) {
        const v = speedAt(S(i), Cl[i], typeCruise) / 60; // km/min
        Cl[i + 1] = Math.min(typeCruise, Cl[i] + climbRate(Cl[i]) * ds / v);
      }
      // Glide path: 3°, steeper (up to 7°, as at Lugano or London City) where the ground on the final needs it.
      const sFaf = sTouch - FINAL_KM;
      let glide = 1000 / DESCENT_KM_PER_KFT; // ft per km
      for (let k = 0; k < 60; k++) {
        const s = sFaf + (FINAL_KM - 0.6) * k / 60;
        const h = groundMax(...posOn(g, s));
        if (h === null) { terrainMissing = true; continue; }
        const dKm = sTouch - s;
        glide = Math.max(glide, (h * FT + Math.min(500, 50 + dKm * 30) - e1) / dKm);
      }
      glide = Math.min(glide, Math.tan(toRad(7)) * 3280.84);
      for (let i = 0; i <= N; i++) {
        const d = sTouch - S(i);
        Dn[i] = e1 + Math.min(d, FINAL_KM) * glide + Math.max(0, d - FINAL_KM) / DESCENT_KM_PER_KFT * 1000;
      }
      // Cruise level: the type's, lower on short hops; odd thousands eastbound, even westbound.
      let peak = 0;
      for (let i = 0; i <= N; i++) peak = Math.max(peak, Math.min(Cl[i], Dn[i]));
      // The ground: what the plane must clear (R), with less margin close to the runways.
      const R = new Float64Array(N + 1).fill(-Infinity);
      let maxR = -Infinity;
      for (let i = 0; i <= N; i++) {
        const s = S(i);
        if (Math.min(Cl[i], Dn[i]) > TERRAIN_SKIP_FT) continue;
        if (s > sTouch - FINAL_KM || g.skip.some(([a, b]) => s >= a && s <= b)) continue; // (the final: see glide)
        const [lat, lon] = posOn(g, s);
        const h = groundMax(lat, lon);
        if (h === null) { terrainMissing = true; continue; }
        const near = Math.min(s - sLift, sTouch - s) * 1000; // metres from lift-off or touchdown
        R[i] = h * FT + Math.min(TERRAIN_CLEAR_FT, 50 + near * 0.12);
        maxR = Math.max(maxR, R[i]);
      }
      let cruiseAlt = Math.min(typeCruise, peak);
      let fl = Math.floor(cruiseAlt / 1000);
      const east = bearing(A0, B0) < 180;
      const parity = (x) => x >= 5 && x % 2 !== (east ? 1 : 0);
      if (parity(fl)) fl -= 1;
      // (never below the ground on the way)
      if (fl * 1000 < maxR) { fl = Math.ceil(maxR / 1000); if (parity(fl)) fl += 1; }
      cruiseAlt = Math.max(1000 + Math.max(e0, e1), fl * 1000);
      // Envelope over the ground: climb early enough for the hills ahead, don't descend too soon after them.
      const E = Float64Array.from(R);
      for (let i = N - 1; i >= 0; i--) E[i] = Math.max(E[i], E[i + 1] - gradLow * ds);
      const gDown = 1000 / DESCENT_KM_PER_KFT;
      for (let i = 1; i <= N; i++) E[i] = Math.max(E[i], E[i - 1] - gDown * ds);
      const A = new Float64Array(N + 1);
      let shortOut = 0;
      let shortIn = 0;
      for (let i = 0; i <= N; i++) {
        A[i] = Math.max(Math.min(Cl[i], Dn[i], cruiseAlt), Math.min(E[i], cruiseAlt));
        // can't climb that fast / can't descend that fast afterwards
        if (Cl[i] < typeCruise && E[i] > Cl[i]) shortOut = Math.max(shortOut, E[i] - Cl[i]);
        if (E[i] > Dn[i]) shortIn = Math.max(shortIn, E[i] - Dn[i]);
      }
      A[0] = e0;
      A[N] = e1;
      const lap = 2 * Math.PI * radius / 1000; // km per circle
      return {
        sLift, sTouch, airborne, N, ds, A, cruiseAlt, fieldAt, glide,
        speedAt: (s, alt) => speedAt(s, alt, cruiseAlt),
        needOut: shortOut > 200 ? Math.min(8, Math.ceil(shortOut / (gradLow * 0.8 * lap))) : 0,
        needIn: shortIn > 200 ? Math.min(8, Math.ceil(shortIn / (gDown * lap))) : 0,
      };
    }

    let orbits = [0, 0];
    let g = geometry(orbits);
    let pr = profile(g);
    for (let pass = 0; pass < 3 && (pr.needOut || pr.needIn); pass++) {
      orbits = [orbits[0] + pr.needOut, orbits[1] + pr.needIn];
      g = geometry(orbits);
      pr = profile(g);
    }
    const { pts, cum, idx } = g;
    const { sLift, sTouch, airborne, N, ds, A, cruiseAlt } = pr;
    const altAt = (sv) => {
      if (sv <= sLift) return e0;
      if (sv >= sTouch) return e1;
      const x = (sv - sLift) / ds;
      const i = Math.min(N - 1, Math.floor(x));
      return A[i] + (A[i + 1] - A[i]) * (x - i);
    };

    // Times: every part as long as it takes; the rest of the block time the plane waits at the gate, boarding
    // (it used to wait at the holding point, which looked like it stood on the runway for ages).
    const steps = Math.min(N, 600);
    const raw = [0];
    for (let i = 1; i <= steps; i++) {
      const sm = sLift + airborne * (i - 0.5) / steps;
      raw.push(raw[i - 1] + (airborne / steps) / (pr.speedAt(sm, altAt(sm)) / 60));
    }
    const sHold = Math.max(cum[idx.push], cum[idx.thr] - HOLD_KM);
    const taxi = (km) => km / TAXI_KMH * 60;
    const tPush = PUSHBACK;
    const tTaxiOut = taxi(sHold - cum[idx.push]);
    const tLineUp = taxi(cum[idx.thr] - sHold) + 0.5;
    const tRoll = 2 * (rollM / 1000) / (pf.vLof / 60);
    // (braking evenly from the touchdown speed to taxi speed at the exit, and taxiing on at that speed:
    // before, the plane stopped dead on the runway and then pulled away again)
    const vTouch = vApp * 0.93;
    const vExit = TAXI_KMH * 1.2;
    const tLand = 2 * ((cum[idx.stop] - sTouch)) / ((vTouch + vExit) / 60);
    const tTaxiIn = taxi(cum[idx.lead] - cum[idx.stop]);
    const natural = tPush + tTaxiOut + tLineUp + tRoll + raw[steps] + tLand + tTaxiIn + DOCK;
    const total = f.arr - f.dep;
    // Too little time (a long way round): everything goes a little faster.
    const k = Math.min(1, total / natural);
    const wait = Math.max(0, total - natural);
    // [t0, t1, s0, s1, ease]; 'both' starts and ends at standstill, [m0, m1] starts and ends at m0 and m1 times
    // the segment's average speed
    const segs = [];
    let t = 0;
    const seg = (dt, s0, s1, ease) => { segs.push([t, t + dt, s0, s1, ease]); t += dt; };
    seg(wait, 0, 0, 'both');
    seg(tPush * k, 0, cum[idx.push], 'both');
    seg(tTaxiOut * k, cum[idx.push], sHold, 'both');
    seg(tLineUp * k, sHold, cum[idx.thr], 'both');
    seg(tRoll * k, cum[idx.thr], sLift, 'in');
    const t0 = t;
    const t1 = t0 + raw[steps] * k;
    const scale = (raw[steps] * k) / raw[steps];
    t = t1;
    const landEase = [2 * vTouch / (vTouch + vExit), 2 * vExit / (vTouch + vExit)];
    seg(tLand * k, sTouch, cum[idx.stop], landEase);
    // (and on onto the stand at the speed it turns in with, slowing to a stop at the gate)
    const vDock = (cum[cum.length - 1] - cum[idx.lead]) / DOCK * 60;
    seg(tTaxiIn * k, cum[idx.stop], cum[idx.lead], [vExit / TAXI_KMH, vDock / TAXI_KMH]);
    seg(Math.max(0, total - t), cum[idx.lead], cum[cum.length - 1], [1, 0]);

    return {
      pts, cum, idx, cruiseAlt, depRunway: dep, arrRunway: arr, total, orbits, terrainMissing, boarding: wait, landEase,
      glideDeg: Math.round(Math.atan(pr.glide / 3280.84) / Math.PI * 1800) / 10,
      altAt,
      // Ground height (ft) the heights are measured from in the 3D view: between the two runways.
      fieldAt: pr.fieldAt,
      // Distance along the track (km) at minutes since departure.
      sAt(tm) {
        if (tm >= t0 && tm <= t1) {
          const u = (tm - t0) / scale; // unscaled time
          let lo = 0;
          let hi = steps;
          while (hi - lo > 1) { const m = (lo + hi) >> 1; if (raw[m] <= u) lo = m; else hi = m; }
          const fr = (u - raw[lo]) / (raw[hi] - raw[lo] || 1);
          return sLift + airborne * (lo + Math.min(1, Math.max(0, fr))) / steps;
        }
        for (const [a, b, s0, s1, ease] of segs) {
          if (tm < a || tm > b) continue;
          let u = b > a ? (tm - a) / (b - a) : 1;
          if (ease === 'in') u *= u;
          if (ease === 'out') u = 1 - (1 - u) * (1 - u);
          if (ease === 'both') u = u * u * (3 - 2 * u);
          if (Array.isArray(ease)) { // (cubic Hermite: exact for even braking)
            const [m0, m1] = ease;
            u = (u * u * u - 2 * u * u + u) * m0 + (3 * u * u - 2 * u * u * u) + (u * u * u - u * u) * m1;
          }
          return s0 + (s1 - s0) * u;
        }
        return tm < 0 ? 0 : cum[cum.length - 1];
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
  // Tracks planned before the ground under them had loaded are planned again when it arrives.
  if (FG.ground) {
    FG.ground.onChange(() => {
      for (const [key, t] of trackCache) if (t.terrainMissing) trackCache.delete(key);
    });
  }
  function flightTrack(p) {
    const f = p.flight;
    if (!f) return null;
    // (route lines also by the placed winds: they show today's runways; a flight keeps the ones it started with)
    const key = `${p.id}|${f.dep}|${f.from}|${f.to}|${f.rw ? `${f.rw.from || ''}~${f.rw.to || ''}` : ''}${p.id.startsWith('leg:') ? `|w${windRev}` : ''}`;
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

  // How hard a type slows down after touchdown (m/s²): wheel brakes alone 1.25, with all its thrust reversed 1.6
  // (as every type did before reversers came: js/data/reversers.js), propellers to ground fine pitch in between.
  function brakeDecel(type) {
    const flat = D.reverserOf && D.reverserOf(type).kind === 'flat';
    return 1.25 + 0.35 * (D.reverseShare ? D.reverseShare(type) : 1) + (flat ? 0.15 : 0);
  }

  // Today's planned track for a schedule leg (for drawing routes). rw: the plane's runway choices for it
  // ({ from, to } runway keys, Game.legRunways), else the runways it would take on its own.
  function legTrack(type, from, to, rw) {
    const day = Game.state ? Math.floor(Game.state.time / DAY) : 0;
    const dep = day * DAY + 12 * 60;
    const flight = { from, to, dep, arr: dep + blockMinutes(type, dist(from, to)) };
    if (rw && (rw.from || rw.to)) flight.rw = rw;
    return flightTrack({ id: `leg:${type}`, type, flight });
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
    if (m < tr.boarding) phase = 'boarding';
    else if (sv < tr.cum[tr.idx.push]) phase = 'pushback';
    else if (sv < tr.cum[tr.idx.thr]) phase = 'taxi-out';
    else if (sv < sLift) phase = 'takeoff';
    else if (sv >= tr.cum[tr.idx.stop]) phase = 'taxi-in';
    else if (sv >= sTouch) phase = 'landing';
    else if (sTouch - sv < FINAL_KM + 1) phase = 'approach';
    else if (alt >= tr.cruiseAlt - 50) phase = 'cruise';
    else phase = tr.altAt(sv + 0.5) >= alt ? 'climb' : 'descent';
    // airFrac: how far between lift-off (0) and touchdown (1) the plane is, for blending the two field elevations.
    const airFrac = Math.min(1, Math.max(0, (sv - sLift) / Math.max(0.001, sTouch - sLift)));
    // Crab: in a crosswind the nose points partly into the wind so the plane still tracks its path (heading =
    // track + crab). It builds up slowly after lift-off (over the first 1000 ft: it used to be all there 3 s off the
    // runway, GitHub issue #5 "planes fly turned even when starting") and is kicked out with the rudder just before
    // touchdown, so on the runway the nose is straight. At most MAX_CRAB (a placed 120 kt wind would turn them 37° sideways).
    const fieldFt = Math.round(tr.fieldAt(sv));
    const ground = sv <= sLift || sv >= sTouch;
    // rollT: how far through its takeoff run the plane is in time (0 brakes off, 1 lift-off); with an even push the
    // speed grows with it (the 3D view rotates the plane over the last part).
    const sThr = tr.cum[tr.idx.thr];
    const rollT = phase === 'takeoff' ? Math.sqrt(Math.min(1, Math.max(0, (sv - sThr) / Math.max(1e-6, sLift - sThr)))) : null;
    // landT: the same through the landing run (0 touchdown, 1 where it leaves the runway), braking evenly to
    // taxi speed: distance d = a t + (1 - a) t² (a = tr.landEase[0])
    const sStop = tr.cum[tr.idx.stop];
    let landT = null;
    if (phase === 'landing') {
      const d = Math.min(1, Math.max(0, (sv - sTouch) / Math.max(1e-6, sStop - sTouch)));
      const a = tr.landEase[0];
      landT = Math.abs(1 - a) < 1e-6 ? d : (-a + Math.sqrt(a * a + 4 * (1 - a) * d)) / (2 * (1 - a));
    }
    const wind = windAt(pos.lat, pos.lon, t, alt);
    let crab = 0;
    if (!ground) {
      const kt = Math.max(60, speed / 1.852);
      crab = Math.asin(Math.max(-1, Math.min(1, (wind.kt / kt) * Math.sin((wind.from - pos.heading) * Math.PI / 180)))) * 180 / Math.PI;
      crab = Math.max(-MAX_CRAB, Math.min(MAX_CRAB, crab));
      const agl = alt - fieldFt;
      crab *= phase === 'takeoff' || phase === 'climb' ? smooth(0, 1000, agl) : Math.min(1, Math.max(0, agl / 40));
      crab = Math.round(crab * 10) / 10;
    }
    // altFt: above sea level; fieldFt: the runways' height at this point (altFt - fieldFt = height above them,
    // aglM the same in metres, not rounded: for the last metres before touchdown).
    return { lat: pos.lat, lon: pos.lon, heading: pos.heading, altFt: alt, fieldFt, aglM: ground ? 0 : Math.max(0, (tr.altAt(sv) - tr.fieldAt(sv)) * 0.3048),
      ground, speedKmh: speed, phase, airFrac, rollT, landT, crab, windFrom: wind.from, windKt: wind.kt, gusty: wind.gusty,
      cruiseFt: tr.cruiseAlt, depRunway: designatorOf(tr.depRunway.hdg), arrRunway: designatorOf(tr.arrRunway.hdg) };
  }
  const MAX_CRAB = 15; // degrees: about the most an airliner crabs (35 kt across a 135 kt approach)
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
    const pc = typeClass(type);
    if (maxClass(code) < pc) return `${code} has no stand big enough for the ${ac.name} (class ${CLASSES[pc]}: ${D.looks[type].span} m wingspan).`;
    const need = runwayNeed(type);
    const have = longestRunway(code, need.paved);
    if (have < need.m) return `The ${ac.name} needs ${need.m} m of ${need.paved ? 'paved ' : ''}runway, ${code} has ${have} m.`;
    return null;
  }

  function crewFor(type) {
    const seats = D.aircraft[type].seats;
    const pilots = D.aircraft[type].pilots || (D.aircraft[type].category === 'widebody' ? 3 : 2);
    const cabin = seats < 20 ? 0 : Math.ceil(seats / 50);
    return { pilots, cabin, weeklySalary: pilots * M.pilotSalary + cabin * M.cabinSalary };
  }
  // A plane has one crew, or two (crew.sets) when its timetable flies it more than one crew's day
  // (C.crewMaxDutyMin): the second one is paid too. weeklySalary is one crew's.
  const crewSets = (c) => c.sets || 1;
  const crewDutyMax = (c) => C.crewMaxDutyMin * crewSets(c);
  const crewWeekly = (c) => c.weeklySalary * crewSets(c);
  // Crews a timetable day needs: one, or C.crewsMax when it has more block time than one crew may fly. Over several
  // days (an ultra long-haul timetable, `days`), the busiest of them counts: flights by the day they leave.
  function crewsFor(type, legs, days = 1) {
    const duty = new Array(days).fill(0);
    for (const l of legs) duty[days > 1 ? Math.floor(l.dep / DAY) % days : 0] += blockMinutes(type, dist(l.from, l.to));
    return Math.max(...duty) > C.crewMaxDutyMin ? C.crewsMax : 1;
  }

  function randomUsedListing(n) {
    // (in story mode: types that have flown for at least a year and are still around, no older than the type)
    const y = yearNow();
    const types = Object.keys(D.aircraft).filter((t) => (y === null
      ? D.aircraft[t].category !== 'classic' || Math.random() < 0.3
      : D.aircraft[t].year < y && inService(t, y)));
    const type = types[Math.floor(Math.random() * types.length)];
    const maxAge = y === null ? M.usedAge[1] : Math.min(M.usedAge[1], y - D.aircraft[type].year);
    const minAge = Math.min(M.usedAge[0], maxAge);
    const age = minAge + Math.floor(Math.random() * (maxAge - minAge + 1));
    const homes = D.airports.filter((a) => !a.minor && fitsAirport(type, a.code));
    const at = homes[Math.floor(Math.random() * homes.length)].code; // seller's base
    return { id: `U${n}`, type, age, price: usedPrice(type, age), at };
  }

  // ---------- story mode: the calendar and which aircraft exist ----------
  // A story game starts in a past year (state.story.start). Day 0 is that year's first Monday, so weeks still
  // start on Mondays (day % 7 === 0). Without a story there is no calendar and every type is on sale.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function firstMonday(year) {
    const jan1 = new Date(Date.UTC(year, 0, 1));
    return Date.UTC(year, 0, 1 + ((8 - jan1.getUTCDay()) % 7));
  }
  // Calendar date (a UTC Date) of game time t, or null without a story.
  function dateOf(t) {
    const st = Game.state && Game.state.story;
    return st ? new Date(firstMonday(st.start) + Math.floor(t / DAY) * 86400000) : null;
  }
  const yearNow = () => (Game.state && Game.state.story ? dateOf(Game.state.time).getUTCFullYear() : null);
  // Built new in year y (default: now)?
  function onSale(type, y = yearNow()) {
    const ac = D.aircraft[type];
    return y === null || (ac.year <= y && y <= (ac.endYear || Infinity));
  }
  // Still flying with airlines in year y (pre-owned ones for sale)?
  const inService = (type, y) => D.aircraft[type].year <= y && y <= (D.aircraft[type].endYear || Infinity) + C.story.serviceYears;

  // ---------- a plane's records (its stats window, as OpenTTD's vehicle details) ----------
  // p.stats: totals since it joined the fleet (flights, pax and profit = flight results, as before; rev, cost, km,
  // mins, seats flown, fixed = its lease and crew, repair, onTime/late, incidents, ferries), the year so far and
  // the year before (`year`, `last`), the last weeks (`weeks`, for the profit graph) and its last flights
  // (`recent`). A year is the calendar year in a story game, else 365 game days (Year 1 starts at day 0).
  const TALLY = ['rev', 'cost', 'fixed', 'repair', 'flights', 'pax', 'seats', 'km'];
  const STATS_WEEKS = 12;
  const STATS_RECENT = 8;
  const tally0 = (key) => Object.assign(Object.fromEntries(TALLY.map((k) => [k, 0])), key);
  const yearOf = (t) => (Game.state && Game.state.story ? dateOf(t).getUTCFullYear() : Math.floor(t / DAY / 365) + 1);
  const weekOf = (t) => Math.floor(t / DAY / 7);
  const newStats = () => ({
    flights: 0, pax: 0, profit: 0, rev: 0, cost: 0, fixed: 0, repair: 0, seats: 0, km: 0, mins: 0,
    onTime: 0, late: 0, incidents: 0, ferries: 0, year: null, last: null, weeks: [], recent: [],
  });
  // (old saves only had flights, pax and profit: `old` marks totals that started later)
  function statsOf(p) {
    if (!p.stats || p.stats.rev == null) p.stats = Object.assign(newStats(), p.stats, p.stats && p.stats.flights ? { old: true } : {});
    return p.stats;
  }
  // Adds to its totals and to the year and week of time t.
  function record(p, add, t = Game.state.time) {
    const s = statsOf(p);
    for (const k in add) s[k] += add[k];
    const y = yearOf(t);
    if (!s.year || s.year.y < y) {
      s.last = s.year && s.year.y === y - 1 ? s.year : null;
      s.year = tally0({ y });
    }
    const w = weekOf(t);
    let wk = s.weeks.find((x) => x.w === w);
    if (!wk && !s.weeks.some((x) => x.w > w)) {
      wk = tally0({ w });
      s.weeks.push(wk);
      if (s.weeks.length > STATS_WEEKS) s.weeks.shift();
    }
    for (const k of TALLY) {
      if (!add[k]) continue;
      if (s.year.y === y) s.year[k] += add[k];
      if (wk) wk[k] += add[k];
    }
  }

  // ---------- formatting ----------
  // Type names as a list: 'A, B and C'.
  const nameList = (types) => {
    const n = types.map((t) => D.aircraft[t].name);
    return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  };
  function fmtMoney(n) {
    const v = Math.round(n);
    return `${v < 0 ? '-' : ''}${C.currency} ${Math.abs(v).toLocaleString('de-CH')}`;
  }
  const pad = (n) => String(n).padStart(2, '0');
  // A plane in messages: its own name with the registration, or just the registration.
  const nameOf = (p) => (p.name ? `${p.name} (${p.id})` : p.id);
  const fmtClock = (t) => `${pad(Math.floor((t % DAY) / 60))}:${pad(t % 60)}`;
  function fmtTime(t) {
    const day = Math.floor(t / DAY);
    const d = dateOf(t);
    if (d) return `${WEEKDAYS[day % 7]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${fmtClock(t)}`;
    return `Day ${day + 1} (${WEEKDAYS[day % 7]}) ${fmtClock(t)}`;
  }
  const fmtDuration = (m) => `${Math.floor(m / 60)}h${pad(Math.round(m % 60))}`;
  // A timetable departure: its time, with the day of the round on an ultra long-haul timetable (days > 1).
  const fmtLegDep = (dep, days = 1) => (days > 1 ? `day ${Math.floor(dep / DAY) + 1} ${fmtClock(dep)}` : fmtClock(dep));
  // A moment soon (absolute minutes): its time, "tomorrow" or the weekday in front when it isn't today.
  function fmtDue(t) {
    const day = Math.floor(t / DAY);
    const today = Math.floor(((Game.state && Game.state.time) || 0) / DAY);
    return day === today ? fmtClock(t) : day === today + 1 ? `tomorrow ${fmtClock(t)}` : `${WEEKDAYS[day % 7]} ${fmtClock(t)}`;
  }

  // ---------- game ----------
  const Game = {
    state: null,
    dirty: true, // UI needs a full re-render

    airportByCode, distanceKm, dist, bearing, interpolate, catchment, dailyDemand,
    ticketPrice, routeKey, blockMinutes, turnaroundMin, landingFee, slotUpfront, slotWeekly,
    priceNew, fitsAirport, fitsReason, crewFor, factoryOf, onSale, dateOf,
    airportSize, baseSize, airportCategory, airportRunways, runwayLength, runwayTaxiways, runwayCover, roundLine,
    CLASSES, CLASS_ROOM, typeClass, standClassAt, maxClass, slotsFit, longestRunway, runwayNeed, attraction,
    flightTrack, flightState, legTrack, brakeDecel, cruiseFt, perf, windFrom, weatherAt, windAt, WX_DRIFT, gateOf, standSpot, apronOf, taxiwaysOf, drawnTaxiways, expansionPreview, terminalPiece,
    fmtMoney, fmtTime, fmtClock, fmtDuration, fmtLegDep, fmtDue,
    utcOffset, utcOf, localTime, fmtLocal, fmtZone, sunPoint, sunAt, daylight, sunTimes,

    // opts: { mode, difficulty, airport, aircraft, company, story } from the start screen; all optional.
    // story = the year a story game starts in (C.story.years); without it the game plays today.
    newGame(opts = {}) {
      if (typeof opts === 'string') opts = { mode: opts };
      const mode = C.modes[opts.mode] ? opts.mode : C.defaultMode;
      const difficulty = C.difficulties[opts.difficulty] ? opts.difficulty : C.defaultDifficulty;
      const homeCode = airportByCode[opts.airport] ? opts.airport : C.startAirport;
      const type = D.aircraft[opts.aircraft] ? opts.aircraft : C.startAircraft;
      const home = airportByCode[homeCode];
      const crewT = crewFor(type);
      const story = opts.story ? { start: Number(opts.story), year: Number(opts.story) } : null;
      windRev++; // (no placed winds in the new game)
      this.state = {
        version: 1,
        mode,
        difficulty,
        story,
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
          stats: newStats(),
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
        winds: [],    // winds placed with the developer tools
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
      if (story) {
        const next = this.nextArrival();
        this.log(`Story mode: it is ${story.start}. New aircraft reach the market in the year they first flew with ` +
          `airlines${next ? ` – next: the ${nameList(next.types)} in ${next.year}` : ''}.`, 'good');
      }
      this.dirty = true;
    },

    // ---------- story mode ----------
    year: () => yearNow(),
    isStory() { return !!(this.state && this.state.story); },
    // Types a story game starting in `year` can begin with: leased ones that were flying then, smallest first.
    starterTypes(year) {
      if (!year) return C.starterAircraft.filter((t) => D.aircraft[t]);
      const all = Object.keys(D.aircraft).filter((t) => inService(t, year) && year - D.aircraft[t].year <= C.story.starterAge
        && D.aircraft[t].seats <= C.story.starterSeats)
        .sort((a, b) => D.aircraft[a].seats - D.aircraft[b].seats);
      const n = Math.min(8, all.length); // (spread over the sizes)
      return [...new Set(Array.from({ length: n }, (_, i) => all[Math.round(i * (all.length - 1) / Math.max(1, n - 1))]))];
    },
    // The next year that brings new types, and those types (null if none comes any more).
    nextArrival() {
      const y = yearNow();
      if (y === null) return null;
      const later = Object.keys(D.aircraft).filter((t) => D.aircraft[t].year > y);
      if (!later.length) return null;
      const year = Math.min(...later.map((t) => D.aircraft[t].year));
      return { year, types: later.filter((t) => D.aircraft[t].year === year) };
    },
    // A new rival airline (story mode, when one went bust): one of the templates not flying yet, near home if
    // possible, with its first routes. Returns it, or null when none can start.
    foundRival() {
      const s = this.state;
      const home = airportByCode[this.home()];
      const flying = new Set(s.rivals.map((r) => r.name));
      const free = D.rivalTemplates.filter((t) => !flying.has(t.name) && t.hubs.every((h) => airportByCode[h]))
        .map((t) => ({ t, d: Math.min(...t.hubs.map((h) => distanceKm(home, airportByCode[h]))) }))
        .sort((x, y) => x.d - y.d).slice(0, 8);
      if (!free.length) return null;
      const t = free[Math.floor(Math.random() * free.length)].t;
      const r = { id: `r${s.time}`, name: t.name, kind: t.kind, hubs: t.hubs.slice(),
        color: D.rivalColors[s.rivals.length % D.rivalColors.length], routes: [], since: s.time };
      for (const plan of this.rivalCandidates(r)) {
        if (r.routes.length >= C.rivals.routes[r.kind]) break;
        r.routes.push(plan);
      }
      if (!r.routes.length) return null;
      s.rivals.push(r);
      this.indexRivals();
      this.log(`${r.name} starts flying from ${r.hubs.join(', ')} (${r.routes.length} routes).`, 'bad');
      return r;
    },

    // Rival airlines' aircraft (C.rivals; in story mode the ones of the time, D.story.rivalFleets).
    rivalFleet() {
      const R = C.rivals;
      const y = yearNow();
      const era = y === null ? null : D.story.rivalFleets.filter((e) => e.from <= y).pop();
      if (era && era.flag) return era;
      return { ...R.fleet, longHaul: R.longHaul.type, shortProp: R.shortProp.type };
    },
    // New Year in a story game: this year's new types make the newspaper, types no longer built leave the
    // new-aircraft market, and rivals move their routes to the aircraft of the time.
    newYear(y) {
      const arrivals = Object.keys(D.aircraft).filter((t) => D.aircraft[t].year === y);
      const ended = Object.keys(D.aircraft).filter((t) => D.aircraft[t].endYear === y - 1);
      if (arrivals.length) {
        const names = arrivals.map((t) => D.aircraft[t].name);
        const lines = arrivals.map((t) => {
          const ac = D.aircraft[t];
          return `<b>${ac.name}</b> (${ac.maker}, ${ac.seats} seats, ${ac.rangeKm.toLocaleString('de-CH')} km). ` +
            `${D.story.news[t] || ''} New ${fmtMoney(priceNew(t))}, or leased for ${fmtMoney(ac.leasePerWeek)} a week.`;
        });
        this.news({
          kind: 'good', picture: 'plane',
          headline: (arrivals.length === 1 ? `The ${names[0]} enters service` : `${arrivals.length} new airliners for ${y}`).toUpperCase(),
          sub: arrivals.length === 1 ? `${D.aircraft[arrivals[0]].maker} delivers the first aircraft to the airlines`
            : `The ${nameList(arrivals)} reach the airlines`,
          body: `${lines.join('<br><br>')}<br><br>Now in the Aircraft Marketplace.`,
        });
      }
      for (const t of ended) {
        this.log(`The last ${D.aircraft[t].name} has left the factory – from now on it is only sold pre-owned.`);
      }
      // Rivals fly the types of the new year where they can.
      for (const r of this.state.rivals || []) {
        for (const rt of r.routes) {
          const plan = this.rivalPlan(r, rt.a, rt.b);
          if (!plan || plan.type === rt.type) continue;
          rt.perDay = Math.max(1, Math.min(C.rivals.maxPerDay, Math.round(rt.perDay * rt.seats / plan.seats)));
          rt.type = plan.type;
          rt.seats = plan.seats;
        }
      }
      this.indexRivals();
      // Decades go by: airlines that went bust make room for new ones.
      const founded = [];
      while (this.state.rivals && this.state.rivals.length < C.rivals.near + C.rivals.far) {
        const r = this.foundRival();
        if (!r) break;
        founded.push(r);
      }
      if (founded.length) {
        const kinds = { flag: 'flag carrier', low: 'low-fare airline', regional: 'regional airline' };
        this.news({ kind: 'bad', picture: 'plane',
          headline: (founded.length === 1 ? `New airline ${founded[0].name} takes off` : `${founded.length} new airlines take off`).toUpperCase(),
          sub: 'Competition for the passengers of the airlines that went bust',
          body: founded.map((r) => `<b>${r.name}</b>, a new ${kinds[r.kind]} at ${r.hubs.map((h) => airportByCode[h].city).join(' and ')}, ` +
            `starts ${r.routes.length} routes with the ${nameList([...new Set(r.routes.map((x) => x.type))])}.`).join('<br><br>') });
      }
      const next = this.nextArrival();
      this.log(`Happy New Year ${y}!${next ? ` Next new aircraft: the ${nameList(next.types)} in ${next.year}.` : ''}`, 'summary');
      this.dirty = true;
    },

    // Start a ready-made airline from D.presets (start screen Quick start, ?preset=<id>): a new
    // game plus the preset's planes, free slots and running timetables. Returns the problems
    // (planes that could not get their timetable), an empty list if all went well.
    applyPreset(id) {
      const pr = D.presets[id];
      if (!pr) return [`No preset "${id}".`];
      const home = airportByCode[pr.home] ? pr.home : C.startAirport;
      const planes = pr.planes.filter(([type]) => D.aircraft[type]);
      this.newGame({ mode: pr.mode, difficulty: pr.difficulty, airport: home,
        aircraft: planes.length ? planes[0][0] : undefined, company: pr.company });
      const s = this.state;
      const errors = [];
      // One slot per plane at home and per plane that stops there elsewhere, all free.
      const need = { [home]: Math.max(1, planes.length) };
      for (const [, stops] of planes) for (const c of stops) need[c] = (need[c] || 0) + 1;
      for (const [code, n] of Object.entries(need)) {
        if (airportByCode[code]) s.slots[code] = { since: 0, count: n };
        else errors.push(`Unknown airport ${code}.`);
      }
      const ids = [s.planes[0].id, ...planes.slice(1).map(([type]) => this.addPlane(type, home, 'leased', 0))];
      planes.forEach(([type, stops], i) => {
        if (!stops.length) return;
        // Departures 10 minutes apart, so a busy hub doesn't send everything off at once.
        const legs = this.buildTimetable(type, [home, ...stops], C.curfew.start + 60 + (i % 12) * 10);
        const err = legs.length < 2 ? `${home}→${stops.join('→')} does not fit into one day.`
          : this.setTimetable(ids[i], legs) || this.setScheduleActive(ids[i], true);
        if (err) errors.push(`${ids[i]} (${D.aircraft[type].name}): ${err}`);
      });
      if (pr.money != null) s.money = pr.money;
      this.log(`Quick start "${pr.name}": ${planes.length} plane${planes.length === 1 ? '' : 's'} at ${home}.` +
        (errors.length ? ` Problems: ${errors.join(' ')}` : ''));
      this.dirty = true;
      return errors;
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

    // The saved game in this browser, without loading it: { company, time, money, planes } or null.
    savedSummary() {
      try {
        const s = JSON.parse(localStorage.getItem(SAVE_KEY));
        return s && s.planes ? { company: s.company, time: s.time, money: s.money, planes: s.planes.length, story: s.story } : null;
      } catch (e) {
        return null;
      }
    },

    // A game from a save file (its text); returns an error, or null when it is loaded (and saved).
    loadFile(text) {
      let s;
      try { s = JSON.parse(text); } catch (e) { return 'That is not a Flightgame save file.'; }
      if (!s || !Array.isArray(s.planes) || !s.slots || typeof s.time !== 'number') return 'That is not a Flightgame save file.';
      const old = this.state;
      try {
        this.state = s;
        this.migrate();
      } catch (e) {
        this.state = old;
        return `The save file could not be read (${e.message}).`;
      }
      this.dirty = true;
      this.save();
      return null;
    },
    // The game as the text of a save file.
    saveFile() { return JSON.stringify(this.state); },

    // Bring older save games up to date.
    migrate() {
      const s = this.state;
      s.planes = s.planes.filter((p) => D.aircraft[p.type]);
      for (const p of s.planes) {
        if (!p.ownership) p.ownership = 'leased';
        if (p.age == null) p.age = 0;
        if (p.acquiredAt == null) p.acquiredAt = 0;
        statsOf(p);
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
      if (!s.winds) s.winds = [];
      windRev++;
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
      // the free stand of the smallest class it fits (the bigger ones stay free for bigger planes), the first
      // of those (contact gates first); none: the biggest free one; all taken: share the last remote stand
      const stands = apronOf(code).stands;
      const q = this.plane(planeId);
      const pc = q ? typeClass(q.type) : 0;
      let best = -1;
      for (let k = 0; k < stands.length; k++) {
        if (used.has(k)) continue;
        const c = stands[k].cls;
        if (best < 0) { best = k; continue; }
        const b = stands[best].cls;
        if (c >= pc ? b < pc || c < b : b < pc && c > b) best = k;
      }
      return best >= 0 ? best : stands.length - 1;
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
      // What the player built at airports (the airport editor's build mode): this game's own airport fixes.
      if (!this.state.airportOps) this.state.airportOps = {};
      if (FG.fixes && FG.fixes.useSave) FG.fixes.useSave(this.state.airportOps);
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
    // A plane's own name (or its registration when it has none), and the name with the registration.
    planeName(p) { return p.name || p.id; },
    planeLabel: nameOf,
    // Give a plane its own name (at most 24 characters); an empty name takes it away again.
    renamePlane(id, name) {
      const p = this.plane(id);
      if (!p) return 'No such plane.';
      const clean = String(name || '').replace(/[<>&"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
      if (clean === (p.name || '')) return null;
      const old = nameOf(p);
      if (clean) p.name = clean; else delete p.name;
      this.log(clean ? `${old} is now called ${clean}.` : `${p.id} has no name any more.`);
      this.dirty = true;
      return null;
    },
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
      const crews = s.crews.reduce((sum, c) => sum + crewWeekly(c), 0);
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
      const fleet = this.rivalFleet();
      let type = fleet[r.kind];
      if (r.kind === 'flag' && d > R.longHaul.km) type = fleet.longHaul;
      if (r.kind === 'regional' && d < R.shortProp.km) type = fleet.shortProp;
      const ac = D.aircraft[type];
      if (!ac || d > ac.rangeKm || !fitsAirport(type, a) || !fitsAirport(type, b)) return null;
      const fare = R.fare[r.kind];
      const pax = dailyDemand(a, b) * Math.pow(fare, -C.ticket.elasticity);
      // As many flights a day as it expects to fill to targetLoad with its share of the passengers, against the
      // player and the other rivals already on the route (it used to plan as if it would get every passenger).
      const mySeats = (this.playerSeats(a, b) + this.playerSeats(b, a)) / 2;
      const others = this.rivalsOn(a, b).filter((c) => c.r !== r)
        .reduce((sum, c) => sum + this.pull(c.rt.perDay * c.rt.seats, c.rt.fare), mySeats > 0 ? this.pull(mySeats, this.fareFactor(a, b)) : 0);
      let perDay = 0;
      for (let n = 1; n <= R.maxPerDay; n++) {
        const own = this.pull(n * ac.seats, fare);
        if (pax * own / (own + others) < n * ac.seats * R.targetLoad) break;
        perDay = n;
      }
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
            loop += bm + turnaroundMin(p.type);
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
        // each plane's own share (its lease and its crew), counted in the week just ended
        for (const p of s.planes) {
          const crew = this.crewOf(p);
          const fixed = (p.ownership === 'owned' ? 0 : D.aircraft[p.type].leasePerWeek) + (crew ? crewWeekly(crew) : 0);
          if (fixed) record(p, { fixed }, s.time - 1);
        }
        this.payDividends();
        this.refreshMarket();
        this.rivalsWeek();
      }
      if (s.story && this.year() !== s.story.year) {
        s.story.year = this.year();
        this.newYear(s.story.year);
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
      p.readyAt = s.time + turnaroundMin(p.type);
      p.flight = null;
      s.money += result;
      if (f.kind === 'scheduled' || f.kind === 'ferry') {
        s.fees[f.to] = (s.fees[f.to] || 0) + landingFee(f.to) + f.pax * C.paxFee;
      }
      s.today.revenue += f.revenue;
      s.today.cost += f.cost;
      const seats = D.aircraft[p.type].seats;
      record(p, { profit: result, rev: f.revenue, cost: f.cost, km: f.distance, mins: f.arr - f.dep,
        ...(f.kind === 'scheduled' ? { flights: 1, pax: f.pax, seats } : f.kind === 'ferry' ? { ferries: 1 } : {}) });
      p.stats.recent.unshift({ t: s.time, from: f.from, to: f.to, kind: f.kind, pax: f.pax, seats, result });
      if (p.stats.recent.length > STATS_RECENT) p.stats.recent.length = STATS_RECENT;
      if (f.kind === 'scheduled') {
        s.today.flights++;
        s.rep.flown++;
        s.today.pax += f.pax;
        this.log(`${nameOf(p)} ${f.from}→${f.to}: ${f.pax}/${seats} pax, revenue ${fmtMoney(f.revenue)}, ` +
          `cost ${fmtMoney(f.cost)} → ${fmtMoney(result)}`, result >= 0 ? 'good' : 'bad');
      } else if (f.kind === 'delivery') {
        this.log(`${nameOf(p)} (${D.aircraft[p.type].name}) delivered to ${f.to} from ${airportByCode[f.from].name}.`, 'good');
      } else {
        this.log(`${nameOf(p)} ferried ${f.from}→${f.to} (cost ${fmtMoney(f.cost)}).`, 'cost');
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
        this.stopPlane(p, `${nameOf(p)} has no slot at ${leg.to} – stopped.`);
        return;
      }
      const unfit = fitsReason(p.type, leg.to);
      if (unfit) {
        this.stopPlane(p, `${nameOf(p)} stopped: ${unfit}`);
        return;
      }
      const ac = D.aircraft[p.type];
      const d = dist(p.location, leg.to);
      if (d > ac.rangeKm) {
        this.stopPlane(p, `${leg.to} is out of range for ${nameOf(p)} – stopped.`);
        return;
      }
      const tod = t % DAY;
      if (tod < C.curfew.start || tod > C.curfew.end) return; // night curfew
      if (this.holdReason(p, leg.to)) return; // strike, weather, repairs
      const block = blockMinutes(p.type, d);
      // The crew rests until tomorrow. A rested crew can always fly one leg, however long (relief pilots come
      // along), or a ferry longer than a crew's day would wait for ever.
      if (crew.dutyToday && crew.dutyToday + block > crewDutyMax(crew)) return;
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
          if (t - p.schedule.due > 15) { s.rep.late++; record(p, { late: 1 }); } else { s.rep.onTime++; record(p, { onTime: 1 }); }
          p.schedule.due = legDue(p.schedule, p.schedule.legs[leg.nextIndex], p.schedule.due + 1);
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
      const rw = this.legRunways(p, p.flight.from, p.flight.to);
      if (rw) p.flight.rw = rw;
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

    // Developer tools: winds placed by hand (state.winds; see placedWind). Each returns an error string or null.
    get windRev() { return windRev; },
    placeWind(lat, lon, from, kt, km = 200) {
      const s = this.state;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'Where?';
      const id = s.winds.reduce((m, w) => Math.max(m, w.id), 0) + 1;
      s.winds.push({ id, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, km: 200, from: 0, kt: 0 });
      return this.setWind(id, { from, kt, km });
    },
    setWind(id, { from, kt, km } = {}) {
      const w = this.state.winds.find((x) => x.id === id);
      if (!w) return 'No such wind.';
      if (Number.isFinite(from)) w.from = ((Math.round(from) % 360) + 360) % 360;
      if (Number.isFinite(kt)) w.kt = Math.max(0, Math.min(150, Math.round(kt)));
      if (Number.isFinite(km)) w.km = Math.max(10, Math.min(2000, Math.round(km)));
      windRev++;
      this.dirty = true;
      return null;
    },
    removeWind(id) {
      const s = this.state;
      s.winds = s.winds.filter((w) => w.id !== id);
      windRev++;
      this.dirty = true;
    },
    clearWinds() {
      this.state.winds = [];
      windRev++;
      this.dirty = true;
    },

    // The weather at an airport (weatherAt), now or at game time t.
    airportWeather(code, t = this.state.time) {
      const a = airportByCode[code];
      return a ? weatherAt(a.lat, a.lon, t) : null;
    },

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
      if (q.status === 'flying' || q.location !== code || this.parksAtBase(q, code)) return false;
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

    // Your home base has room for your own planes off the stands (hangars, the maintenance apron): a plane there
    // without a running timetable parks without a slot. So a plane can always be sent home, and one parked there
    // never keeps the planes that fly from there out of their slots.
    parksAtBase(q, code) { return code === this.home() && !(q.schedule.active && q.schedule.stops.length >= 2); },
    // Your planes parked at your base off the stands (see parksAtBase).
    parkedAtBase(code) {
      return this.state.planes.filter((q) => q.status !== 'flying' && q.location === code && this.parksAtBase(q, code));
    },

    // Your planes in or heading for a slot at an airport: [{ p, how: 'parked' | 'turnaround' | 'leaving' | 'inbound' }].
    slotOccupants(code) {
      const out = [];
      const t = this.state.time;
      for (const q of this.state.planes) {
        if (this.parksAtBase(q, code)) continue;
        if (q.status === 'flying' && q.flight && q.flight.to === code) out.push({ p: q, how: 'inbound' });
        else if (q.status !== 'flying' && q.location === code) {
          out.push({ p: q, how: !this.staysUntil(q, code, t + 30) ? 'leaving' : q.status === 'turnaround' ? 'turnaround' : 'parked' });
        }
      }
      return out;
    },

    // Is one of your slots at `code` free for a plane landing at time t (not counting plane `planeId`)?
    slotFreeAt(code, t, planeId) {
      const used = [];
      const me = this.plane(planeId);
      if (me && this.parksAtBase(me, code)) return true;
      for (const q of this.state.planes) {
        if (q.id === planeId || this.parksAtBase(q, code)) continue;
        if (q.status === 'flying' && q.flight && q.flight.to === code) {
          // Lands before us but flies on (its timetable) before we arrive: it doesn't need the slot then.
          const sch = q.schedule;
          const leg = sch.active && sch.legs && sch.legs.length && sch.legs[sch.index % sch.legs.length];
          const gone = leg && leg.from === code && Math.max(sch.due || 0, q.flight.arr + turnaroundMin(q.type)) < t;
          if (!gone) used.push(typeClass(q.type));
        } else if (this.staysUntil(q, code, t)) used.push(typeClass(q.type));
      }
      used.push(me ? typeClass(me.type) : 0);
      return slotsFit(this.mySlotClasses(code), used);
    },

    // ---------- the slots of an airport ----------
    // An airport has one slot per aircraft stand (apronOf: the real stands where there is a real layout).
    // You hold some, rivals hold those for their flights there (a few more at their hubs), other airlines a
    // share that grows with the airport's size; the rest are free to lease. When none is free you can make
    // a holder an offer for one of theirs: the airport agrees depending on the offer and your reputation.
    slotCapacity(code) {
      return Math.max(this.slotCount(code), 2, apronOf(code).stands.length);
    },
    // ---------- slot classes ----------
    // Every slot is a stand of a class (A–F, see the stand size classes): a plane needs a slot of its class or
    // a bigger one. Yours at an airport by class: [A, B, C, D, E, F].
    mySlotClasses(code) {
      const sl = this.state.slots[code];
      if (!sl) return [0, 0, 0, 0, 0, 0];
      const n = this.slotCount(code);
      if (!sl.byClass || sl.byClass.reduce((x, y) => x + y, 0) !== n) sl.byClass = this.guessSlotClasses(code, n);
      return sl.byClass;
    },
    // Classes for `n` slots held from before slot classes: those your planes there need (the biggest first),
    // then the class most of the stands there have.
    guessSlotClasses(code, n) {
      const out = [0, 0, 0, 0, 0, 0];
      const stands = this.standClasses(code);
      const common = stands.indexOf(Math.max(...stands));
      const need = this.state.planes.filter((p) => p.location === code || (p.flight && p.flight.to === code) || p.schedule.stops.includes(code))
        .map((p) => typeClass(p.type)).sort((x, y) => y - x);
      for (let k = 0; k < n; k++) out[k < need.length ? need[k] : common]++;
      return out;
    },
    // An airport's stands by class.
    standClasses(code) {
      const out = [0, 0, 0, 0, 0, 0];
      for (const st of apronOf(code).stands) out[st.cls]++;
      return out;
    },
    // The slots of an airport by class: { cap, mine, held, free } (arrays by class). The holders' slots are
    // spread over the classes as the stands are (what is left of each after yours).
    slotTable(code) {
      const mine = this.mySlotClasses(code).slice();
      const cap = this.standClasses(code).map((n, c) => Math.max(n, mine[c]));
      const total = cap.reduce((x, y) => x + y, 0);
      if (total < this.slotCapacity(code)) cap[2] += this.slotCapacity(code) - total; // (at least two: class C)
      const rest = cap.map((n, c) => n - mine[c]);
      const restN = rest.reduce((x, y) => x + y, 0);
      const heldN = Math.min(restN, this.slotHolders(code).reduce((n, h) => n + h.n, 0));
      const share = rest.map((r) => (restN ? (heldN * r) / restN : 0));
      const held = share.map(Math.floor);
      let left = heldN - held.reduce((x, y) => x + y, 0);
      for (const c of share.map((x, c) => c).sort((x, y) => (share[y] - held[y]) - (share[x] - held[x]))) {
        if (left <= 0) break;
        if (held[c] < rest[c]) { held[c]++; left--; }
      }
      return { cap, mine, held, free: rest.map((r, c) => Math.max(0, r - held[c])) };
    },
    // The class a new slot at an airport should have: the smallest free one your biggest plane fits, else the
    // biggest free one (-1: none free).
    leaseClassFor(code) {
      const free = this.slotTable(code).free;
      const big = Math.max(0, ...this.state.planes.map((p) => typeClass(p.type)));
      for (let c = big; c < 6; c++) if (free[c]) return c;
      for (let c = big - 1; c >= 0; c--) if (free[c]) return c;
      return -1;
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
    // Free slots at an airport (of class `cls`, or all).
    freeSlots(code, cls) {
      if (cls != null) return this.slotTable(code).free[cls];
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
      s.effects.push({ label: `Bookings slump after the ${nameOf(p)} crash`, where: { all: true },
        demandMult: rep.demandMult, until: s.time + rep.days * DAY });

      const place = this.nearestPlace(lat, lon);
      this.log(`✖ ${nameOf(p)} (${ac.name}) crashed near ${place} on ${f.from}→${f.to}. ` +
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
      record(p, { repair: inc.repair, incidents: 1 });
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
    // `cls`: the slot's class (0–5 = A–F); without it the one leaseClassFor picks.
    leaseSlot(code, cls) {
      const s = this.state;
      const a = airportByCode[code];
      if (a.built && !a.open) return `${a.name} isn't open yet.`;
      if (!this.freeSlots(code)) return `All ${this.slotCapacity(code)} slots at ${code} are taken – make one of the holders an offer.`;
      if (cls == null || cls === '') cls = this.leaseClassFor(code);
      cls = typeof cls === 'string' && CLASSES.includes(cls) ? CLASSES.indexOf(cls) : Number(cls);
      if (!(cls >= 0 && cls < 6) || !this.freeSlots(code, cls)) return `No class ${CLASSES[cls] || '?'} slot is free at ${code}.`;
      const cost = this.slotPrice(code);
      if (s.money < cost) return `Not enough money (${fmtMoney(cost)} needed).`;
      s.money -= cost;
      const byClass = this.mySlotClasses(code).slice();
      byClass[cls]++;
      if (s.slots[code]) s.slots[code].count = this.slotCount(code) + 1;
      else s.slots[code] = { since: s.time, count: 1 };
      s.slots[code].byClass = byClass;
      const fee = this.slotFee(code);
      this.log(`Leased a class ${CLASSES[cls]} slot at ${a.name} (${this.slotCount(code)} there)${cost ? ` for ${fmtMoney(cost)}` : ' (yours: no charge)'}` +
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
      if (p.location === code && p.status !== 'flying') return `${nameOf(p)} is already at ${code}.`;
      if (!fitsAirport(p.type, code)) return fitsReason(p.type, code);
      if (dist(p.location, code) > D.aircraft[p.type].rangeKm) return 'Out of range.';
      const room = this.roomReason(p.type, code, p.id);
      if (room) return room;
      p.schedule.active = false;
      p.pendingFerry = code;
      this.log(`${nameOf(p)} will ferry to ${code}${p.status === 'idle' ? '' : ' when ready'}.`);
      return null;
    },

    // Why a plane of this type couldn't stand at `code` (else null): it needs one of your slots there of its class or
    // bigger that isn't filled by planes parked there for good, or it would wait at its gate for ever. Your home
    // base always has room (parksAtBase). planeId: the plane itself (not counted among the others).
    roomReason(type, code, planeId = null) {
      if (code === this.home()) return null;
      const need = typeClass(type);
      const mine = this.mySlotClasses(code);
      if (!slotsFit(mine, [need])) {
        const have = mine.map((n, c) => (n ? `${n}× class ${CLASSES[c]}` : '')).filter(Boolean).join(', ');
        return `Your slot at ${code} is too small (${have}): the ${D.aircraft[type].name} needs a class ${CLASSES[need]} ` +
          'stand or bigger. Lease one there first.';
      }
      const stay = this.state.planes.filter((q) => q.id !== planeId && (q.status === 'flying' && q.flight && q.flight.to === code
        ? !(q.schedule.active && q.schedule.legs && q.schedule.legs.length) && (!q.pendingFerry || q.pendingFerry === code)
        : this.staysUntil(q, code, Infinity)));
      if (!slotsFit(mine, [...stay.map((q) => typeClass(q.type)), need])) {
        return `Every slot at ${code} it fits in is taken by ${stay.map(nameOf).join(', ')}, parked there with no running ` +
          'timetable. Move one of them away or lease another slot first.';
      }
      return null;
    },

    // Why a plane that has somewhere to go (a ferry or its timetable) isn't leaving right now, in a few words
    // ("at 06:00 (night curfew)"), or null when nothing holds it.
    departNote(p) {
      const t = this.state.time;
      if (p.status === 'flying' && p.flight) return `after it lands at ${p.flight.to}`;
      if (p.status === 'turnaround') return p.repair ? 'after its repairs' : `after its turnaround (${fmtClock(Math.ceil(p.readyAt % DAY))})`;
      const leg = this.nextLeg(p);
      if (!leg) return null;
      const hold = this.holdReason(p, leg.to);
      if (hold) return `when this ends: ${hold}`;
      const tod = t % DAY;
      if (tod < C.curfew.start || tod > C.curfew.end) return `at ${fmtClock(C.curfew.start)} (night curfew)`;
      const crew = this.crewOf(p);
      if (!crew) return 'once it has a crew';
      if (crew.dutyToday && crew.dutyToday + blockMinutes(p.type, dist(p.location, leg.to)) > crewDutyMax(crew)) return 'tomorrow (the crew has flown its hours today)';
      if (!this.slotFreeAt(leg.to, t + blockMinutes(p.type, dist(p.location, leg.to)), p.id)) return `as soon as a slot at ${leg.to} is free`;
      if (leg.kind === 'scheduled' && t < p.schedule.due) return `at ${fmtDue(p.schedule.due)}`;
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
      if (active && p.schedule.legs) { this.anchorRound(p); this.syncTimetable(p); }
      this.log(`${nameOf(p)} schedule ${active ? 'started' : 'paused'}.`);
      return null;
    },

    // ---------- fleet & market ----------
    planeAge(p) { return p.age + (this.state.time - p.acquiredAt) / DAY / 365; },
    // A plane's records as of now, for its stats window: totals (p.stats), this year and last year (all zero when it
    // didn't fly then), and the last weeks oldest first, ending with this one. Profit = rev - cost - fixed - repair.
    planeStats(p) {
      const s = statsOf(p);
      const t = this.state.time;
      const y = yearOf(t);
      const name = (yy) => (this.state.story ? String(yy) : `Year ${yy}`);
      const year = s.year && s.year.y === y ? s.year : tally0({ y });
      const last = s.year && s.year.y === y - 1 ? s.year : s.last && s.last.y === y - 1 ? s.last : tally0({ y: y - 1 });
      const w = weekOf(t);
      const weeks = [];
      for (let i = Math.min(STATS_WEEKS - 1, w); i >= 0; i--) { // (none before the game started)
        const wk = s.weeks.find((x) => x.w === w - i) || tally0({ w: w - i });
        const d = dateOf((w - i) * 7 * DAY);
        weeks.push({ ...wk, label: d ? `Week of ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : `Week ${w - i + 1}`,
          profit: wk.rev - wk.cost - wk.fixed - wk.repair });
      }
      const net = (x) => x.rev - x.cost - x.fixed - x.repair;
      return {
        total: s, year, last, weeks,
        yearName: name(y), lastName: y > 1 || this.state.story ? name(y - 1) : null,
        profit: { year: net(year), last: net(last), total: s.profit - s.fixed - s.repair },
      };
    },
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

    // Why a type can't be ordered new now (story mode), or null.
    notOnSale(type) {
      if (onSale(type)) return null;
      const ac = D.aircraft[type];
      return ac.year > this.year() ? `The ${ac.name} won't reach the airlines before ${ac.year}.`
        : `The ${ac.name} is no longer built – look for a pre-owned one.`;
    },

    // Shared checks for a delivery; returns an error string or null.
    checkDelivery(type, code, cost) {
      if (!this.ownsSlot(code)) return `You need a slot at ${code} for the delivery.`;
      if (!fitsAirport(type, code)) return fitsReason(type, code);
      const room = this.roomReason(type, code);
      if (room) return room.replace(/^Your slot/, 'For the delivery: your slot');
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
        stats: newStats(),
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
      const err = this.notOnSale(type) || this.checkDelivery(type, code, cost);
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
      const err = this.notOnSale(type) || this.checkDelivery(type, code, cost);
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
      if (p.status === 'flying') return `${nameOf(p)} is in the air – wait until it lands.`;
      const name = D.aircraft[p.type].name;
      if (p.ownership === 'owned') {
        const v = this.saleValue(p);
        s.money += v;
        this.log(`Sold ${nameOf(p)} (${name}) for ${fmtMoney(v)}.`, 'good');
      } else {
        const fee = this.returnFee(p);
        s.money -= fee;
        this.log(`Returned leased ${nameOf(p)} (${name}), return fee ${fmtMoney(fee)}.`, 'cost');
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
    // What can be ordered from the airport panel: extending the main runway. New runways and terminals are placed
    // in build mode (runwayProject / orderRunway, orderBuild).
    projectOptions(code) {
      const st = this.stake(code);
      const share = st / 100;
      const busy = this.state.projects.some((p) => p.code === code && p.kind === 'extend');
      const base = busy ? 'The main runway is being extended already.'
        : st < A.boardStake ? `You need ${A.boardStake}% of the shares to order construction.` : null;
      const opts = [];
      if (airportRunways(code).length) {
        opts.push({
          kind: 'extend', full: A.extendCost, cost: Math.round(A.extendCost * share), weeks: A.extendWeeks,
          label: `Extend main runway +${A.extendBy} m (to ${longestRunway(code) + A.extendBy} m)`,
          err: base || (longestRunway(code) + A.extendBy > A.maxRunwayM ? 'The main runway is as long as it gets.' : null),
        });
      }
      return opts;
    },

    // ---------- runways and terminals placed in build mode ----------
    // What a runway r ([lat, lon, lat, lon, width m, paved 0/1]) costs and takes: { len, full, cost (your
    // share), weeks, err }. Wider runways cost more, grass ones about a third.
    runwayProject(code, r) {
      const a = airportByCode[code];
      const len = Math.round(runwayLength(r));
      const full = Math.round(((A.runwayCost.base + A.runwayCost.perM * len * Math.max(0.5, (r[4] || 30) / 45)) * (r[5] ? 1 : 0.35)) / 1000) * 1000;
      const weeks = Math.max(2, Math.round(A.runwayWeeks.base + (A.runwayWeeks.perKm * len) / 1000));
      let err = this.buildDenied(code);
      if (!err && len < 300) err = 'A runway is at least 300 m long.';
      if (!err && len > A.maxRunwayM) err = `A runway is at most ${A.maxRunwayM} m long.`;
      if (!err && [[r[0], r[1]], [r[2], r[3]]].some((q) => distanceKm(a, { lat: q[0], lon: q[1] }) > 8)) err = `That is too far from ${a.name} (8 km at most).`;
      return { len, full, cost: Math.round((full * this.stake(code)) / 100), weeks, err };
    },
    // What lies in a placed runway's way: { runways: crossed, aprons, buildings } (how many of each).
    runwayCheck(code, r) {
      const ap = apronOf(code);
      const hdg = bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] });
      const len = runwayLength(r);
      const W = Math.max(18, r[4] || 30);
      const hit = (rings, m) => rings.filter((ring) => ring && ring.length > 2 && runwayHits([r[0], r[1]], hdg, len, W, { rings: [{ r: ring, m, w: 1 }], lines: [] }, []) > 0).length;
      const others = airportRunways(code).filter((x) => [0, 1, 2, 3].some((i) => Math.abs(x[i] - r[i]) > 1e-6));
      return {
        runways: others.filter((x) => runwayHits([r[0], r[1]], hdg, len, W, { rings: [], lines: [] }, [[x, 0]]) > 0).length,
        aprons: hit([...(ap.aprons || [ap.apron]), ...(ap.pads || [])], 0),
        buildings: hit([ap.terminal, ...ap.buildings.filter((b) => b.kind !== 'road' && b.kind !== 'carpark').map((b) => b.ring)], 10),
      };
    },
    orderRunway(code, r) {
      const s = this.state;
      const o = this.runwayProject(code, r);
      if (o.err) return o.err;
      if (s.money < o.cost) return `Not enough money (${fmtMoney(o.cost)} needed).`;
      s.money -= o.cost;
      const h = bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] });
      const name = (x) => String(Math.round((((x % 360) + 360) % 360) / 10) || 36).padStart(2, '0');
      const runway = r.map((v, i) => (i < 4 ? Math.round(v * 1e5) / 1e5 : v));
      const label = `Runway ${name(h)}/${name(h + 180)} · ${o.len} m${r[5] ? '' : ' grass'}`;
      s.projects.push({ code, kind: 'runway', len: o.len, label, cost: o.cost, full: o.full, start: s.time, done: s.time + o.weeks * 7 * DAY, geo: { runway } });
      this.log(`Construction started at ${airportByCode[code].name}: ${label} – your share ${fmtMoney(o.cost)}, ready in ${o.weeks} weeks.`, 'cost');
      this.dirty = true;
      return null;
    },
    // Building placed in build mode that is built over weeks (a terminal with its apron, stands and taxi lane):
    // the airport fix ops it adds when it is done. info: { label, full, weeks }.
    orderBuild(code, ops, info) {
      const s = this.state;
      const err = this.buildDenied(code);
      if (err) return err;
      const cost = Math.round((info.full * this.stake(code)) / 100);
      if (s.money < cost) return `Not enough money (${fmtMoney(cost)} needed).`;
      s.money -= cost;
      s.projects.push({ code, kind: 'build', label: info.label, cost, full: info.full, start: s.time, done: s.time + info.weeks * 7 * DAY, geo: { ops } });
      this.log(`Construction started at ${airportByCode[code].name}: ${info.label} – your share ${fmtMoney(cost)}, ready in ${info.weeks} weeks.`, 'cost');
      this.dirty = true;
      return null;
    },
    // ---------- which runway a plane takes ----------
    // The runways at an airport for a type: [{ key, name ('14/32'), len, paved, ok, why }] (why: why it can't).
    runwayChoices(type, code) {
      const need = runwayNeed(type);
      return airportRunways(code).map((r) => {
        const h = bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] });
        const num = (x) => String(Math.round((((x % 360) + 360) % 360) / 10) || 36).padStart(2, '0');
        const len = Math.round(runwayLength(r));
        const why = len < need.m ? `too short (needs ${need.m} m)` : need.paved && !r[5] ? 'needs a paved one' : '';
        return { key: runwayKey(r), name: `${num(h)}/${num(h + 180)}`, len, paved: !!r[5], ok: !why, why };
      }).sort((x, y) => x.len - y.len);
    },
    // The runways a plane chose for a flight from `from` to `to`: { from, to } runway keys, or null (auto at both).
    legRunways(p, from, to) {
      const mine = p.runways || {};
      return mine[from] || mine[to] ? { from: mine[from], to: mine[to] } : null;
    },
    // Have a plane take this runway at an airport (from whichever end is into the wind); null or 'auto': the
    // shortest that fits (pickRunway). A flight still boarding at the gate takes it at once, one under way keeps its
    // runways and the next flight there takes it. Error, or null.
    setRunway(planeId, code, key) {
      const p = this.plane(planeId);
      if (!p) return 'No such plane.';
      if (!key || key === 'auto') {
        if (p.runways) delete p.runways[code];
      } else {
        const c = this.runwayChoices(p.type, code).find((x) => x.key === key);
        if (!c) return `That runway is not at ${code}.`;
        if (!c.ok) return `Runway ${c.name} is ${c.why}.`;
        p.runways = p.runways || {};
        p.runways[code] = key;
      }
      const f = p.status === 'flying' && p.flight;
      if (f && (f.from === code || f.to === code)) {
        // (only while it boards, and only if the new way out still leaves it at the gate now: no jump)
        const at = this.state.time - f.dep + 1;
        if (at < flightTrack(p).boarding) {
          const was = f.rw;
          const rw = this.legRunways(p, f.from, f.to);
          if (rw) f.rw = rw; else delete f.rw;
          if (at >= flightTrack(p).boarding) { if (was) f.rw = was; else delete f.rw; }
        }
      }
      this.dirty = true;
      return null;
    },
    // Whether the plane's flight now (from or to that airport) takes its runway choice there: 'now', 'next' (it is
    // under way on the runway it had: the choice counts from its next flight there), or null (no flight there now).
    runwayTakes(p, code) {
      const f = p.status === 'flying' && p.flight;
      if (!f || (f.from !== code && f.to !== code)) return null;
      const want = (p.runways || {})[code] || null;
      const has = (f.rw && (f.from === code ? f.rw.from : f.rw.to)) || null;
      return want === has ? 'now' : 'next';
    },

    // Close a runway (build mode): pulling it down costs part of what building it would.
    removeRunway(code, r) {
      const err = this.buildDenied(code);
      if (err) return err;
      const rws = airportRunways(code);
      const same = (x) => [0, 1, 2, 3].every((i) => Math.abs(x[i] - r[i]) < 1e-5);
      if (!rws.some(same)) return 'That runway is not there.';
      const o = this.runwayProject(code, r);
      const paid = this.payForBuilding(code, Math.round(o.full * A.build.demolish), `runway of ${o.len} m closed`);
      if (paid) return paid;
      this.infraOf(code).runways = rws.filter((x) => !same(x)).map((x) => x.slice());
      delete catchmentCache[code];
      if (FG.layouts) FG.layouts.refix(code);
      this.dirty = true;
      return null;
    },

    startProject(code, kind, len, orient) {
      const s = this.state;
      const o = this.projectOptions(code).find((x) => x.kind === kind &&
        (kind !== 'runway' || (x.len === Number(len) && x.orient === orient)));
      if (!o) return 'That project is not available.';
      if (o.err) return o.err;
      if (s.money < o.cost) return `Not enough money (${fmtMoney(o.cost)} needed).`;
      s.money -= o.cost;
      const project = { code, kind, len: o.len, orient: o.orient, label: o.label, cost: o.cost, full: o.full,
        start: s.time, done: s.time + o.weeks * 7 * DAY };
      const geo = this.plannedRunway(project);
      if (geo) project.geo = geo;
      s.projects.push(project);
      this.log(`Construction started at ${airportByCode[code].name}: ${o.label} – your share ${fmtMoney(o.cost)}, ` +
        `ready in ${o.weeks} weeks.`, 'cost');
      this.dirty = true;
      return null;
    },

    // Geometry of a runway that a project will add (also drawn while it is being built).
    plannedRunway(p) {
      if (p.geo) return p.geo.runway ? p.geo : null; // (worked out when it was ordered: it stays where it was shown)
      const rws = airportRunways(p.code);
      if (p.kind === 'extend') {
        const r = rws.reduce((m, x) => (runwayLength(x) > runwayLength(m) ? x : m), rws[0]);
        const h = bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] });
        const e1 = offsetPoint(r[0], r[1], h + 180, A.extendBy / 2);
        const e2 = offsetPoint(r[2], r[3], h, A.extendBy / 2);
        return { replace: r, runway: [e1[0], e1[1], e2[0], e2[1], r[4], 1] };
      }
      if (p.kind !== 'runway') return null;
      return { runway: placeRunway(p.code, p.len, rws.length ? p.orient || 'parallel' : 'new') };
    },

    finishProjects() {
      const s = this.state;
      for (const p of s.projects.filter((x) => s.time >= x.done)) {
        const inf = this.infraOf(p.code);
        const geo = this.plannedRunway(p);
        if (geo) {
          // (the runway an extension replaces: by its ends, as the project kept a copy of it)
          const same = (r) => geo.replace && [0, 1, 2, 3].every((i) => Math.abs(r[i] - geo.replace[i]) < 1e-5);
          const rws = airportRunways(p.code).filter((r) => !same(r));
          inf.runways = [geo.runway, ...rws].map((r) => r.map((v, i) => (i < 4 ? Math.round(v * 1e5) / 1e5 : v)));
          this.connectRunway(p.code, inf.runways[0]);
        }
        if (p.kind === 'terminal') inf.terminal = (inf.terminal || 0) + 1;
        // building placed in build mode: what it adds becomes part of what you built there
        if (p.kind === 'build' && FG.fixes && FG.fixes.player) FG.fixes.player.set(p.code, FG.fixes.player.ops(p.code).concat(p.geo.ops));
        if (p.kind === 'airport') inf.runways = [this.plannedRunway({ code: p.code, kind: 'runway', len: A.newAirportRunway }).runway];
        if (p.kind === 'airport') airportByCode[p.code].open = true;
        inf.invested = (inf.invested || 0) + p.full;
        delete catchmentCache[p.code];
        this.log(`${airportByCode[p.code].name}: ${p.label} completed.`, 'good');
      }
      s.projects = s.projects.filter((x) => s.time < x.done);
      this.dirty = true;
    },

    // Building by hand at an airport (the airport editor's build mode, js/airportedit.js): at an airport you
    // built, once it is open, or where you have the board's stake. Null when you may, else why not.
    buildDenied(code) {
      const a = airportByCode[code];
      if (!a || a.factory) return 'Not at a factory.';
      if (a.built) return null; // (yours: also while it is being built, see the checklist)
      return this.stake(code) >= A.boardStake ? null : `Own ${A.boardStake}% of ${a.name} to build there.`;
    },
    // Pay your share of building work worth `full` there (negative: money back, as when it is undone). Null when
    // paid, else why not.
    payForBuilding(code, full, what) {
      const s = this.state;
      const cost = Math.round((full * this.stake(code)) / 100);
      if (cost > 0 && s.money < cost) return `Not enough money (${fmtMoney(cost)} needed).`;
      s.money -= cost;
      const inf = this.infraOf(code);
      inf.invested = Math.max(0, (inf.invested || 0) + full);
      if (cost) this.log(`${airportByCode[code].name}: ${what} – ${cost > 0 ? `your share ${fmtMoney(cost)}` : `${fmtMoney(-cost)} back`}.`, cost > 0 ? 'cost' : 'good');
      this.dirty = true;
      return null;
    },

    // A new runway joins the taxiways (runwayTaxiways): they become part of what the player built there (the
    // airport editor's build mode can move them). Where the game makes the layout up, it lays them out itself.
    connectRunway(code, r) {
      delete catchmentCache[code];
      const ap = apronOf(code);
      if ((ap.real || ap.empty || airportByCode[code].site) && FG.fixes && FG.fixes.player) {
        const lines = runwayTaxiways(code, r);
        if (lines.length) {
          FG.fixes.player.set(code, FG.fixes.player.ops(code).concat(lines.map((geom) => ({ op: 'add', kind: 'taxiway', geom }))));
          return lines.length;
        }
      }
      if (FG.layouts) FG.layouts.refix(code); // (its runways are links again)
      return 0;
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
      // (a site: empty until you build on it, siteChecklist; it opens when that is done, openAirport)
      const a = { code, name, city: town ? town.name : name, country: town ? town.country : '',
        lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, size: 1, built: true, open: false, site: true };
      s.money -= A.newAirportCost;
      s.built.push(a);
      this.registerBuilt();
      this.infraOf(code).stake = 100;
      this.log(`Bought the site of ${name} (${code}) for ${fmtMoney(A.newAirportCost)}: build a runway, an apron with stands, ` +
        'a terminal and the taxiways between them, then open it.', 'cost');
      this.dirty = true;
      return code;
    },

    // What a new airport site still needs before it can open: [{ id, label, done, note }].
    siteChecklist(code) {
      const lay = (FG.fixes && FG.fixes.layout(code, (FG.layouts && FG.layouts.raw(code)) || null)) || { aprons: [], pads: [], terminals: [], stands: [], taxiways: [], links: [] };
      const rws = airportRunways(code);
      const building = this.state.projects.filter((p) => p.code === code);
      const runway = rws.some((r) => runwayLength(r) >= 800);
      const out = [
        { id: 'runway', label: 'A runway of 800 m or more', done: runway,
          note: !runway && building.some((p) => p.kind === 'runway') ? 'being built' : runway ? `${Math.round(Math.max(...rws.map(runwayLength))).toLocaleString('de-CH')} m` : '' },
        { id: 'apron', label: 'An apron', done: lay.aprons.length + (lay.pads || []).length > 0 },
        { id: 'stand', label: 'A stand on it', done: lay.stands.length > 0, note: lay.stands.length ? `${lay.stands.length}` : '' },
        { id: 'terminal', label: 'A terminal', done: lay.terminals.length > 0,
          note: !lay.terminals.length && building.some((p) => p.kind === 'build') ? 'being built' : '' },
      ];
      // a way along the taxiways from a stand to a runway
      let joined = false;
      if (runway && lay.stands.length && lay.taxiways.length) {
        const g = taxiGraph(code, lay);
        const onRunway = (q) => rws.some((r) => segMetres(q, [r[0], r[1]], [r[2], r[3]]).d < 30);
        for (const st of lay.stands) {
          let start = -1;
          let bd = 200;
          g.pts.forEach((q, i) => { const d = metres(q, st); if (d < bd) { bd = d; start = i; } });
          if (start < 0) continue;
          const seen = new Set([start]);
          const stack = [start];
          while (stack.length && !joined) {
            const u = stack.pop();
            if (onRunway(g.pts[u])) joined = true;
            for (const [w] of g.adj[u]) if (!seen.has(w)) { seen.add(w); stack.push(w); }
          }
          if (joined) break;
        }
      }
      out.push({ id: 'taxiway', label: 'Taxiways from the stands to the runway', done: joined });
      return out;
    },
    // Open a new airport whose checklist is done: planes may fly there from now on.
    openAirport(code) {
      const a = airportByCode[code];
      if (!a || !a.built) return 'Not one of your sites.';
      if (a.open) return `${a.name} is open already.`;
      const left = this.siteChecklist(code).filter((x) => !x.done);
      if (left.length) return `Still missing: ${left.map((x) => x.label.toLowerCase()).join(', ')}.`;
      a.open = true;
      delete catchmentCache[code];
      this.log(`${a.name} (${code}) is open!`, 'good');
      this.dirty = true;
      return null;
    },

    // ---------- timetables ----------
    // A timetable is a plane's day: legs { from, to, dep } with dep in minutes after midnight, each leg
    // starting where the one before ended and the last ending where the first starts, so it repeats
    // every day. Between two legs the plane stands at the airport and takes one of your slots there.
    // Ultra long-haul (schedule.days > 1, for planes that can fly a round trip longer than a day: ultraCapable): the
    // timetable repeats every `days` days instead, and dep counts the minutes from the start of such a round
    // (0 … days × DAY, rising leg by leg). Rounds start on the days that are multiples of `days`.
    legBlock(type, from, to) { return blockMinutes(type, dist(from, to)); },

    // Can this type fly a route whose round trip doesn't fit into a day (two flights as long as its range, with
    // the turnarounds)? Only those get ultra long-haul timetables.
    ultraCapable(type) {
      return 2 * (blockMinutes(type, D.aircraft[type].rangeKm) + turnaroundMin(type)) > DAY;
    },
    // Days an ultra long-haul timetable takes before it starts again: its last flight's turnaround done by the
    // time of the first departure.
    cycleDays(type, legs) {
      if (!legs.length) return 1;
      const last = legs[legs.length - 1];
      const ready = last.dep + this.legBlock(type, last.from, last.to) + turnaroundMin(type);
      return Math.max(1, Math.ceil((ready - legs[0].dep) / DAY));
    },
    // An ultra long-haul timetable: the loop of stops flown `rounds` times from a first departure, each flight
    // after the turnaround, the next morning where that would fall into the night curfew, or the next day where the
    // crews have flown their hours (a rested crew always flies one flight, however long). Times as in cycleDays.
    buildLongTimetable(type, stops, firstDep, rounds = 1) {
      const legs = [];
      if (stops.length < 2) return legs;
      const maxDuty = C.crewMaxDutyMin * C.crewsMax;
      let t = firstDep;
      let day = -1;
      let duty = 0;
      for (let r = 0; r < Math.max(1, rounds); r++) {
        stops.forEach((from, i) => {
          const to = stops[(i + 1) % stops.length];
          const block = this.legBlock(type, from, to);
          for (let k = 0; k < 3; k++) {
            const tod = t % DAY;
            if (tod < C.curfew.start) t += C.curfew.start - tod;
            else if (tod > C.curfew.end) t += DAY - tod + C.curfew.start;
            if (Math.floor(t / DAY) !== day) { day = Math.floor(t / DAY); duty = 0; }
            if (!duty || duty + block <= maxDuty) break;
            t = (day + 1) * DAY + C.curfew.start; // the crews rest until tomorrow
          }
          legs.push({ from, to, dep: t });
          duty += block;
          t += block + turnaroundMin(type);
        });
      }
      return legs;
    },

    // Legs for a loop of stops, from a first departure, with the shortest turnarounds: the loop is
    // flown `rounds` times (0 = as often as fits into the day and the crew's duty).
    buildTimetable(type, stops, firstDep, rounds = 0) {
      const legs = [];
      if (stops.length < 2) return legs;
      let t = firstDep;
      let duty = 0;
      // As many loops as one crew may fly; with a second crew (crewsFor) when even one loop is longer (long haul)
      // or the loops are chosen.
      const loopDuty = stops.reduce((n, from, i) => n + this.legBlock(type, from, stops[(i + 1) % stops.length]), 0);
      const maxDuty = C.crewMaxDutyMin * (rounds || loopDuty > C.crewMaxDutyMin ? C.crewsMax : 1);
      for (let r = 0; rounds ? r < rounds : true; r++) {
        const loop = [];
        let tt = t;
        let dd = duty;
        let ok = true;
        stops.forEach((from, i) => {
          const to = stops[(i + 1) % stops.length];
          const block = this.legBlock(type, from, to);
          if (tt < C.curfew.start || tt > C.curfew.end || dd + block > maxDuty) ok = false;
          loop.push({ from, to, dep: tt % DAY });
          tt += block + turnaroundMin(type);
          dd += block;
        });
        // The day must end where it started, in time for the first departure tomorrow.
        if (!ok || tt - turnaroundMin(type) > firstDep + DAY - turnaroundMin(type)) break;
        legs.push(...loop);
        t = tt;
        duty = dd;
        if (r > 30) break;
      }
      return legs;
    },

    // Where a plane stands during the day with these legs: [{ code, from, to }] in minutes after
    // midnight, to > from; a stay over midnight is split in two. An ultra long-haul timetable (days > 1) is laid
    // over one day as if the plane stood there at those times every day (its slots are planned by the day), and a
    // stay of a whole day or more takes the slot all day.
    groundTimes(type, legs, days = 1) {
      const out = [];
      const n = legs.length;
      if (!n) return out;
      if (days > 1) {
        for (let i = 0; i < n; i++) {
          const leg = legs[i];
          const arr = leg.dep + this.legBlock(type, leg.from, leg.to);
          const dep = i + 1 < n ? legs[i + 1].dep : legs[0].dep + days * DAY;
          const base = { code: leg.to, arr: arr % DAY, dep: dep % DAY, day: Math.floor(arr / DAY) };
          if (dep - arr >= DAY) { out.push({ ...base, from: 0, to: DAY, long: dep - arr }); continue; }
          const a = arr % DAY;
          if (a + dep - arr <= DAY) out.push({ ...base, from: a, to: a + dep - arr });
          else out.push({ ...base, from: a, to: DAY }, { ...base, from: 0, to: a + dep - arr - DAY });
        }
        return out;
      }
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
    // timetable that sit there (all day). `draft` = { planeId, type, legs, days } replaces that plane's legs.
    slotUsage(code, draft) {
      const uses = [];
      for (const p of this.state.planes) {
        const mine = draft && draft.planeId === p.id;
        const legs = mine ? draft.legs : p.schedule.legs && p.schedule.active !== false ? p.schedule.legs : null;
        if (legs && legs.length) {
          const days = mine ? draft.days || 1 : p.schedule.days || 1;
          for (const g of this.groundTimes(p.type, legs, days)) if (g.code === code) uses.push({ planeId: p.id, ...g });
        } else if (!(draft && draft.planeId === p.id) && !(p.schedule.active && p.schedule.stops.length >= 2 && !p.schedule.legs)) {
          const at = p.status === 'flying' && p.flight ? p.flight.to : p.location;
          if (at === code && !this.parksAtBase(p, code)) uses.push({ planeId: p.id, code, from: 0, to: DAY, idle: true });
        }
      }
      // Lanes: each of your slots is a row (the biggest class first); a stay goes into the smallest one free for
      // its whole time that its plane fits. Stays that find none go into rows beyond yours (not enough slots).
      uses.sort((x, y) => !!x.idle - !!y.idle || x.from - y.from || y.to - x.to); // timetables first
      const have = this.mySlotClasses(code);
      const cls = [];
      for (let c = 5; c >= 0; c--) for (let k = 0; k < have[c]; k++) cls.push(c);
      const ends = cls.map(() => 0);
      const extra = [];
      let used = 0;
      for (const u of uses) {
        const q = draft && draft.planeId === u.planeId ? { type: draft.type } : this.plane(u.planeId);
        const pc = typeClass(q.type);
        u.cls = pc;
        let k = -1;
        for (let i = 0; i < cls.length; i++) if (cls[i] >= pc && ends[i] <= u.from && (k < 0 || cls[i] <= cls[k])) k = i;
        if (k >= 0) { ends[k] = u.to; u.lane = k; used = Math.max(used, k + 1); continue; }
        let e = extra.findIndex((end) => end <= u.from);
        if (e < 0) { e = extra.length; extra.push(0); }
        extra[e] = u.to;
        u.lane = cls.length + e;
      }
      return { uses, need: used + extra.length, have: this.slotCount(code), classes: cls };
    },

    // Problems with a timetable for a plane: errors block saving. days > 1: an ultra long-haul one.
    checkTimetable(planeId, legs, days = 1) {
      const p = this.plane(planeId);
      const ac = D.aircraft[p.type];
      const errors = [];
      if (legs.length < 2) return ['A timetable needs at least two flights.'];
      if (days > 1 && !this.ultraCapable(p.type)) {
        errors.push(`The ${ac.name} can't fly ultra long-haul timetables: a timetable over several days is for planes with the range for flights longer than half a day.`);
      }
      let duty = 0;
      legs.forEach((leg, i) => {
        const next = legs[(i + 1) % legs.length];
        const block = this.legBlock(p.type, leg.from, leg.to);
        duty += block;
        const name = `${fmtLegDep(leg.dep, days)} ${leg.from}→${leg.to}`;
        if (leg.to !== next.from) errors.push(`${name} ends at ${leg.to}, but the next flight leaves from ${next.from}.`);
        if (!this.ownsSlot(leg.from)) errors.push(`No slot at ${leg.from}.`);
        else if (!this.mySlotClasses(leg.from).some((n, c) => n && c >= typeClass(p.type))) {
          errors.push(`No slot at ${leg.from} big enough for the ${ac.name}: it needs class ${CLASSES[typeClass(p.type)]} or bigger.`);
        }
        if (leg.from === leg.to) errors.push(`${name} goes nowhere.`);
        if (leg.dep % DAY < C.curfew.start || leg.dep % DAY > C.curfew.end) errors.push(`${name}: departures only ${fmtClock(C.curfew.start)}–${fmtClock(C.curfew.end)} (night curfew).`);
        if (dist(leg.from, leg.to) > ac.rangeKm) errors.push(`${name} is out of range.`);
        const unfit = fitsReason(p.type, leg.to);
        if (unfit) errors.push(unfit);
      });
      if (days > 1) {
        // The legs, one after the other with their turnarounds, must fit into the days of the round.
        legs.forEach((leg, i) => {
          const ready = leg.dep + this.legBlock(p.type, leg.from, leg.to) + turnaroundMin(p.type);
          const nextDep = i + 1 < legs.length ? legs[i + 1].dep : legs[0].dep + days * DAY;
          if (nextDep < ready) {
            errors.push(i + 1 < legs.length
              ? `After ${fmtLegDep(leg.dep, days)} ${leg.from}→${leg.to} the plane is ready at ${fmtLegDep(ready, days)} – too late for the next flight at ${fmtLegDep(nextDep, days)}.`
              : `The last flight is back too late to start again after ${days} days.`);
          }
        });
        const dutyDay = new Array(days).fill(0);
        const flights = new Array(days).fill(0);
        for (const l of legs) { const k = Math.floor(l.dep / DAY) % days; dutyDay[k] += this.legBlock(p.type, l.from, l.to); flights[k]++; }
        dutyDay.forEach((m, k) => {
          if (flights[k] > 1 && m > C.crewMaxDutyMin * C.crewsMax) errors.push(`Day ${k + 1}: ${fmtDuration(m)} in the air – ${C.crewsMax} crews may fly ${fmtDuration(C.crewMaxDutyMin * C.crewsMax)}.`);
        });
        return [...new Set(errors)];
      }
      // The legs must fit into one day, each with a turnaround.
      let t = legs[0].dep;
      legs.forEach((leg, i) => {
        if (i > 0) {
          let dep = leg.dep;
          while (dep < t) dep += DAY;
          if (dep - t < 0) errors.push('Flights overlap.');
          t = dep;
        }
        const ready = t + this.legBlock(p.type, leg.from, leg.to) + turnaroundMin(p.type);
        const nextDep = i + 1 < legs.length ? (() => { let d = legs[i + 1].dep; while (d < t) d += DAY; return d; })() : legs[0].dep + DAY;
        if (nextDep < ready) errors.push(`After ${fmtClock(leg.dep)} ${leg.from}→${leg.to} the plane is ready at ${fmtClock(ready % DAY)} – too late for the next flight at ${fmtClock(nextDep % DAY)}.`);
      });
      if (duty > C.crewMaxDutyMin * C.crewsMax) errors.push(`${fmtDuration(duty)} in the air a day – ${C.crewsMax} crews may fly ${fmtDuration(C.crewMaxDutyMin * C.crewsMax)}.`);
      return [...new Set(errors)];
    },

    // Slot check for a timetable, per airport it stands at: [{ code, have, need, clash: [{ from, to, planes }] }].
    // A clash doesn't block the timetable: the plane that would find every slot taken waits at its gate
    // until a slot is free (a delay), so the player can share slots tightly or lease another one.
    timetableSlots(planeId, legs, days = 1) {
      const p = this.plane(planeId);
      const out = [];
      for (const code of new Set(legs.map((l) => l.from))) {
        const u = this.slotUsage(code, { planeId, type: p.type, legs, days });
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

    // How a timetable fits into the slots, airport by airport: when this plane stands there (mine), when your
    // other planes do (others) and when they need more slots than you have (over: the red parts). over is
    // only counted while this plane is there.
    slotFit(planeId, legs, days = 1) {
      const p = this.plane(planeId);
      const mine = this.groundTimes(p.type, legs, days);
      const out = [];
      let total = 0;
      for (const code of new Set(legs.map((l) => l.from))) {
        const { busy, uses: others } = this.slotBusy(code, planeId);
        const have = this.slotCount(code);
        const at = mine.filter((g) => g.code === code);
        const over = this.overSpans(busy, at, this.mySlotClasses(code), typeClass(p.type));
        const minutes = over.reduce((n, x) => n + x.to - x.from, 0);
        total += minutes;
        out.push({ code, have, mine: at, others, over, minutes });
      }
      return { airports: out, minutes: total };
    },
    // Your other planes on the ground at an airport: { uses (slotUsage), busy: how many, minute by minute }.
    // (busy[c][m]: how many of them need a slot of class c or bigger in minute m)
    slotBusy(code, planeId) {
      const busy = CLASSES.map(() => new Uint8Array(DAY));
      const p = this.plane(planeId);
      const uses = this.slotUsage(code, { planeId, type: p.type, legs: [] }).uses;
      for (const u of uses) {
        for (let m = Math.floor(u.from); m < Math.min(DAY, Math.ceil(u.to)); m++) for (let c = 0; c <= u.cls; c++) busy[c][m]++;
      }
      return { busy, uses };
    },
    // Spans of the stays `at` (of a plane of class `cls`) where the other planes already fill the slots `have`
    // (by class) it could use.
    overSpans(busy, at, have, cls) {
      const atLeast = have.map((n, c) => have.slice(c).reduce((x, y) => x + y, 0));
      const over = [];
      for (const g of at) {
        let start = -1;
        for (let m = Math.floor(g.from); m <= Math.min(DAY, Math.ceil(g.to)); m++) {
          let full = false;
          if (m < Math.min(DAY, Math.ceil(g.to))) for (let c = 0; c <= cls && !full; c++) full = busy[c][m] + 1 > atLeast[c];
          if (full && start < 0) start = m;
          if (!full && start >= 0) { over.push({ from: start, to: m }); start = -1; }
        }
      }
      return over;
    },

    // The best day for a plane on a loop of stops: tries every first departure (5-minute steps), every
    // airport of the loop as the place it spends the night and (rounds 0 = as many as fit) fewer loops, and
    // keeps the one with the fewest minutes without a free slot, then the most flights, then the one closest
    // to `around`. Returns { stops, first, rounds, legs, over } or null. `ultra`: an ultra long-haul timetable
    // (buildLongTimetable, `rounds` loops, at least one): the fewest days first, then the fewest minutes without a slot.
    fitTimetable(planeId, stops, rounds, around, ultra) {
      const p = this.plane(planeId);
      const busy = {};
      for (const c of new Set(stops)) busy[c] = this.slotBusy(c, planeId).busy;
      let best = null;
      if (ultra) {
        for (let r = 0; r < stops.length; r++) {
          const rot = stops.slice(r).concat(stops.slice(0, r));
          for (let first = C.curfew.start; first <= C.curfew.end; first += 5) {
            const legs = this.buildLongTimetable(p.type, rot, first, rounds || 1);
            const days = this.cycleDays(p.type, legs);
            let over = 0;
            for (const g of this.groundTimes(p.type, legs, days)) {
              for (const x of this.overSpans(busy[g.code], [g], this.mySlotClasses(g.code), typeClass(p.type))) over += x.to - x.from;
            }
            const away = Math.abs(first - around) + (r ? 1 : 0);
            if (!best || days < best.days || (days === best.days && (over < best.over || (over === best.over && away < best.away)))) {
              best = { stops: rot, first, rounds: rounds || 1, legs, over, away, days };
            }
          }
        }
        return best;
      }
      for (let r = 0; r < stops.length; r++) {
        const rot = stops.slice(r).concat(stops.slice(0, r));
        for (let first = C.curfew.start; first <= C.curfew.end; first += 5) {
          const full = this.buildTimetable(p.type, rot, first, rounds);
          const loops = full.length / rot.length;
          for (let n = rounds ? loops : 1; n <= loops; n++) {
            const legs = full.slice(0, n * rot.length);
            if (!legs.length) continue;
            let over = 0;
            for (const g of this.groundTimes(p.type, legs)) {
              for (const x of this.overSpans(busy[g.code], [g], this.mySlotClasses(g.code), typeClass(p.type))) over += x.to - x.from;
            }
            const away = Math.abs(first - around) + (r ? 1 : 0);
            if (!best || over < best.over || (over === best.over && (legs.length > best.legs.length ||
              (legs.length === best.legs.length && away < best.away)))) {
              best = { stops: rot, first, rounds: rounds || (n < loops ? n : 0), legs, over, away };
            }
          }
        }
      }
      return best;
    },

    // Take a plane off its timetable: it stays where it is.
    clearTimetable(planeId) {
      const p = this.plane(planeId);
      p.schedule = { stops: [], index: 0, active: false };
      p.waitSlot = null;
      this.log(`${nameOf(p)} has no timetable any more and stays at ${p.status === 'flying' && p.flight ? p.flight.to : p.location}.`);
      this.setCrews(p, 1);
      this.dirty = true;
      return null;
    },

    // Put a plane on a timetable (and keep it running if it was). days > 1: an ultra long-haul one, repeating every
    // `days` days (dep counted from the start of a round).
    setTimetable(planeId, legs, days = 1) {
      const p = this.plane(planeId);
      const errors = this.checkTimetable(planeId, legs, days);
      if (errors.length) return errors[0];
      const sorted = legs.map((l) => ({ ...l, dep: days > 1 ? l.dep : l.dep % DAY }));
      p.schedule = { stops: sorted.map((l) => l.from), legs: sorted, index: 0, active: p.schedule.active, due: 0 };
      if (days > 1) p.schedule.days = days;
      this.anchorRound(p);
      this.syncTimetable(p);
      this.log(`${nameOf(p)} timetable${days > 1 ? ` (ultra long-haul, every ${days} days)` : ''}: ${sorted.map((l) => `${fmtLegDep(l.dep, days)} ${l.from}→${l.to}`).join(', ')}.`);
      this.setCrews(p, crewsFor(p.type, sorted, days));
      this.dirty = true;
      return null;
    },

    // One or two crews for a plane (a long-haul day); the second one is paid from now on.
    setCrews(p, n) {
      const crew = this.crewOf(p);
      if (!crew || crewSets(crew) === n) return;
      crew.sets = n;
      this.log(n > 1 ? `${nameOf(p)} flies more than ${fmtDuration(C.crewMaxDutyMin)} a day: a second crew joins it ` +
        `(+${fmtMoney(crew.weeklySalary * (n - 1))}/week).` : `${nameOf(p)} needs only one crew again.`, n > 1 ? 'cost' : undefined);
    },
    crewsFor,
    crewDutyMax,
    crewWeekly,

    // An ultra long-haul timetable's rounds start on the plane's own day: so that its first flight from where it is
    // (or lands) leaves as soon as the plane is ready, instead of days later.
    anchorRound(p) {
      const sch = p.schedule;
      if (!sch.legs || !sch.legs.length || (sch.days || 1) < 2) return;
      const at = p.status === 'flying' && p.flight ? p.flight.to : p.location;
      const from = Math.max(this.state.time, p.status === 'flying' && p.flight ? p.flight.arr + turnaroundMin(p.type) : 0);
      const leg = sch.legs.find((l) => l.from === at) || sch.legs[0];
      const start = Math.ceil((from - leg.dep) / DAY) * DAY; // (a midnight)
      sch.offset = ((start % periodOf(sch)) + periodOf(sch)) % periodOf(sch);
    },

    // Next leg to fly: the one leaving soonest from where the plane is (or will be).
    syncTimetable(p) {
      const sch = p.schedule;
      if (!sch.legs || !sch.legs.length) return;
      const at = p.status === 'flying' && p.flight ? p.flight.to : p.location;
      const from = Math.max(this.state.time, p.status === 'flying' && p.flight ? p.flight.arr + turnaroundMin(p.type) : 0);
      let best = 0;
      let bestDue = Infinity;
      sch.legs.forEach((l, i) => {
        const due = legDue(sch, l, from) + (l.from === at ? 0 : periodOf(sch) / 2); // prefer legs from here
        if (due < bestDue) { bestDue = due; best = i; }
      });
      sch.index = best;
      sch.due = legDue(sch, sch.legs[best], from);
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
        return { ...l, block: b, arr: l.dep + b, pax: p, seats: ac.seats, result: revenue - cost };
      });
      return { rows, profit, pax, block };
    },

    // Lease one more slot at an airport where you already have one.
    addSlot(code, cls) { return this.leaseSlot(code, cls); },

    // Give one slot back; the last one goes with releaseSlot.
    // `cls`: which class (default: the smallest you hold).
    dropSlot(code, cls) {
      const n = this.slotCount(code);
      if (n <= 1) return this.releaseSlot(code);
      const byClass = this.mySlotClasses(code).slice();
      if (cls == null || cls === '') cls = byClass.findIndex((x) => x > 0);
      cls = Number(cls);
      if (!byClass[cls]) return `You hold no class ${CLASSES[cls]} slot at ${code}.`;
      byClass[cls]--;
      const busy = this.slotOccupants(code).filter((o) => o.how !== 'leaving').map((o) => typeClass(o.p.type));
      if (!slotsFit(byClass, busy)) return `Your planes at ${code} need that slot right now.`;
      this.state.slots[code].count = n - 1;
      this.state.slots[code].byClass = byClass;
      this.log(`Gave back a class ${CLASSES[cls]} slot at ${airportByCode[code].name} (${n - 1} left).`);
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
        return Math.max(0.12, 1 - left / turnaroundMin(p.type));
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
      const loopMin = legs.reduce((s, l) => s + l.block + turnaroundMin(type), 0);
      const profit = legs.reduce((s, l) => s + l.revenue - l.cost, 0);
      return { legs, loopMin, profit };
    },
  };

  FG.game = Game;
})();
