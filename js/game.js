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
  const catchmentCache = {};
  function catchment(code) {
    if (catchmentCache[code] != null) return catchmentCache[code];
    const ap = airportByCode[code];
    let sum = 0;
    for (const t of D.towns) {
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
    return Math.round(C.demandFactor * Math.sqrt(catchment(from) * catchment(to)) * distanceFactor(d));
  }

  const ticketPrice = (d) => Math.round(C.ticket.base + C.ticket.perKm * d); // standard fare
  const routeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`); // same for both directions
  const blockMinutes = (type, d) => Math.round((d / D.aircraft[type].speedKmh) * 60 + C.taxiMin);
  const landingFee = (code) => C.landingFee.base + C.landingFee.perSize * airportByCode[code].size;
  const slotUpfront = (code) => C.slot.upfront[airportByCode[code].size];
  const slotWeekly = (code) => C.slot.weekly[airportByCode[code].size];

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
  const fitsAirport = (type, code) => airportByCode[code].size >= (D.aircraft[type].minAirport || 1);

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
    const homes = D.airports.filter((a) => fitsAirport(type, a.code));
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
    priceNew, fitsAirport, crewFor, factoryOf,
    fmtMoney, fmtTime, fmtClock, fmtDuration,

    newGame() {
      const home = airportByCode[C.startAirport];
      const crewT = D.crewTemplates[C.startCrew];
      this.state = {
        version: 1,
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
        gameOver: false,
      };
      this.refreshMarket();
      this.log(`Welcome to ${this.state.company}! You start with a slot at ${home.name}, ` +
        `the ${D.aircraft[C.startAircraft].name} ${C.startRegistration} and a base crew.`);
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

    weeklyCosts() {
      const s = this.state;
      const planes = s.planes.reduce((sum, p) =>
        sum + (p.ownership === 'owned' ? 0 : D.aircraft[p.type].leasePerWeek), 0);
      const crews = s.crews.reduce((sum, c) => sum + c.weeklySalary, 0);
      const slots = Object.keys(s.slots).reduce((sum, code) => sum + slotWeekly(code), 0);
      return { planes, crews, slots, total: planes + crews + slots };
    },

    // ---------- ticket prices ----------
    // Every route has its own price factor; dearer tickets sell fewer seats.
    fareFactor(a, b) { return this.state.fares[routeKey(a, b)] || 1; },
    fare(a, b) { return Math.round(ticketPrice(dist(a, b)) * this.fareFactor(a, b)); },
    demand(a, b) {
      return Math.round(dailyDemand(a, b) * Math.pow(this.fareFactor(a, b), -C.ticket.elasticity));
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
        this.refreshMarket();
      }
      if (s.money < C.bankruptcyLimit) {
        s.gameOver = true;
        this.log('Bankrupt! Your airline has run out of money. Start a new game.', 'bad');
      }
    },

    updatePlane(p) {
      const t = this.state.time;
      if (p.status === 'flying' && t >= p.flight.arr) this.land(p);
      if (p.status === 'turnaround' && t >= p.readyAt) {
        p.status = 'idle';
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
      if (!fitsAirport(p.type, leg.to)) {
        this.stopPlane(p, `${leg.to} is too small for ${p.id} – stopped.`);
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
        pax, revenue, cost: flightCost(p.type, d, leg.to, pax, this.costMult(p)),
      };
      p.status = 'flying';
      crew.dutyToday += block;
      this.dirty = true;
    },

    stopPlane(p, msg) {
      p.schedule.active = false;
      p.pendingFerry = null;
      this.log(msg, 'bad');
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
      if (!fitsAirport(p.type, code)) return `${code} is too small for the ${D.aircraft[p.type].name}.`;
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
        if (!fitsAirport(p.type, a)) return `${a} is too small for the ${ac.name}.`;
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
      if (!fitsAirport(type, code)) return `${code} is too small for the ${D.aircraft[type].name}.`;
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
