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
  const blockMinutes = (type, d) => Math.round((d / D.aircraft[type].speedKmh) * 60 + C.taxiMin);
  const landingFee = (code) => C.landingFee.base + C.landingFee.perSize * airportSize(code);
  const slotUpfront = (code) => C.slot.upfront[airportSize(code)];
  const slotWeekly = (code) => C.slot.weekly[airportSize(code)];

  function flightCost(type, d, to, pax, costMult = 1) {
    const block = blockMinutes(type, d);
    return Math.round((block / 60) * D.aircraft[type].costPerBlockHour * costMult + landingFee(to) + pax * C.paxFee);
  }

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
    fmtMoney, fmtTime, fmtClock, fmtDuration,

    newGame(mode = C.defaultMode) {
      const home = airportByCode[C.startAirport];
      const crewT = D.crewTemplates[C.startCrew];
      this.state = {
        version: 1,
        mode: C.modes[mode] ? mode : C.defaultMode,
        company: C.companyName,
        time: C.curfew.start,
        money: C.startMoney,
        slots: { [C.startAirport]: { since: 0 } },
        planes: [{
          id: C.startRegistration,
          type: C.startAircraft,
          location: C.startAirport,
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
          base: C.startAirport,
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
        gameOver: false,
      };
      this.registerBuilt();
      this.refreshMarket();
      this.log(`Welcome to ${this.state.company}! You start with a slot at ${home.name}, ` +
        `the ${D.aircraft[C.startAircraft].name} ${C.startRegistration} and a base crew. ` +
        `Mode: ${C.modes[this.state.mode].name} – ${C.modes[this.state.mode].desc}`);
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
      if (!s.effects) s.effects = [];
      if (!s.news) s.news = [];
      if (!s.infra) s.infra = {};
      if (!s.projects) s.projects = [];
      if (!s.built) s.built = [];
      if (!s.fees) s.fees = {};
      this.registerBuilt();
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
    // Weekly slot fee; nothing at airports you control.
    slotFee(code) { return this.stake(code) >= A.majorityStake ? 0 : slotWeekly(code); },

    weeklyCosts() {
      const s = this.state;
      const planes = s.planes.reduce((sum, p) =>
        sum + (p.ownership === 'owned' ? 0 : D.aircraft[p.type].leasePerWeek), 0);
      const crews = s.crews.reduce((sum, c) => sum + c.weeklySalary, 0);
      const slots = Object.keys(s.slots).reduce((sum, code) => sum + this.slotFee(code), 0);
      return { planes, crews, slots, total: planes + crews + slots };
    },

    // ---------- ticket prices ----------
    // Every route has its own price factor; dearer tickets sell fewer seats.
    fareFactor(a, b) { return this.state.fares[routeKey(a, b)] || 1; },
    fare(a, b) { return Math.round(ticketPrice(dist(a, b)) * this.fareFactor(a, b)); },
    demand(a, b) {
      return Math.round(dailyDemand(a, b) * Math.pow(this.fareFactor(a, b), -C.ticket.elasticity) * this.eventDemandMult(a, b));
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

      if (day % 7 === 0) {
        const w = this.weeklyCosts();
        s.money -= w.total;
        s.today.fixed += w.total;
        this.log(`Weekly costs paid: ${fmtMoney(w.total)} (aircraft ${fmtMoney(w.planes)}, ` +
          `crew ${fmtMoney(w.crews)}, slots ${fmtMoney(w.slots)}).`, 'cost');
        this.payDividends();
        this.refreshMarket();
      }
      this.rollWorldEvent();
      this.finishProjects();
      if (s.money < C.bankruptcyLimit) {
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
      if (!leg) return;

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

      let pax = 0;
      let revenue = 0;
      if (leg.kind === 'scheduled') {
        const key = `${p.location}-${leg.to}`;
        const left = Math.max(0, this.demand(p.location, leg.to) - (s.carriedToday[key] || 0));
        const luck = 0.85 + Math.random() * 0.3;
        pax = Math.min(ac.seats, left, Math.round(left * luck));
        s.carriedToday[key] = (s.carriedToday[key] || 0) + pax;
        revenue = pax * this.fare(p.location, leg.to);
        p.schedule.index = leg.nextIndex;
      } else if (p.pendingFerry === leg.to) {
        p.pendingFerry = null;
      }

      p.flight = {
        from: p.location, to: leg.to, kind: leg.kind,
        dep: t, arr: t + block, distance: Math.round(d),
        pax, revenue, cost: flightCost(p.type, d, leg.to, pax, this.costMult(p) * this.fuelMult()),
      };
      this.rollFlightEvents(p);
      p.status = 'flying';
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
      const ac = D.aircraft[p.type];
      this.news(inc.story({
        id: p.id, company: s.company, type: ac.name, from: f.from, to: f.to,
        airport: airportByCode[f.to].name, repair: fmtMoney(inc.repair),
      }));
    },

    // ---------- player actions (return an error string or null) ----------
    leaseSlot(code) {
      const s = this.state;
      if (s.slots[code]) return 'You already have a slot there.';
      const cost = slotUpfront(code);
      if (s.money < cost) return `Not enough money (${fmtMoney(cost)} needed).`;
      s.money -= cost;
      s.slots[code] = { since: s.time };
      this.log(`Leased a slot at ${airportByCode[code].name} for ${fmtMoney(cost)} ` +
        `(+${fmtMoney(slotWeekly(code))}/week).`, 'cost');
      return null;
    },

    releaseSlot(code) {
      const s = this.state;
      if (code === C.startAirport) return 'You cannot give up your home base.';
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
      const here = stops.indexOf(p.location);
      p.schedule = { stops: stops.slice(), index: here >= 0 ? here : 0, active: p.schedule.active };
      this.log(`${p.id} schedule set: ${stops.join(' → ')} → ${stops[0]}.`);
      return null;
    },

    setScheduleActive(planeId, active) {
      const p = this.plane(planeId);
      if (active && p.schedule.stops.length < 2) return 'Create a schedule first.';
      p.schedule.active = active;
      if (active) p.pendingFerry = null;
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
          distance: Math.round(d), pax: 0, revenue: 0, cost: 0 };
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

    // Rough forecast for a schedule loop (first flight of the day, no randomness).
    estimateSchedule(type, stops, costMult = 1) {
      const ac = D.aircraft[type];
      const legs = [];
      if (stops.length < 2) return { legs, loopMin: 0, profit: 0 };
      for (let i = 0; i < stops.length; i++) {
        const from = stops[i];
        const to = stops[(i + 1) % stops.length];
        const d = dist(from, to);
        const demand = this.demand(from, to);
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
