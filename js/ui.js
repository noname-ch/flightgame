// Map + sidebar rendering and input handling.
(function () {
  const G = FG.game;
  const C = FG.config;
  const D = FG.data;

  const TICK_MS = 100;
  // Speed is a multiple of real time: 1 = one game minute per real minute.
  // The slider is logarithmic, from real time up to twice the old top speed
  // (30 game minutes per tick).
  const MAX_SPEED = 2 * 30 * (60000 / TICK_MS);
  const SLIDER_MAX = 1000;
  const sliderToSpeed = (v) => Math.round(Math.pow(MAX_SPEED, v / SLIDER_MAX));
  const speedToSlider = (x) => Math.round((Math.log(x) / Math.log(MAX_SPEED)) * SLIDER_MAX);
  const fmtSpeed = (x) => (x >= 1000 ? `${(x / 1000).toFixed(x >= 10000 ? 0 : 1)}k×` : `${x}×`);

  const ui = {
    map: null,
    airportMarkers: {},
    planeMarkers: {},
    routeLayer: null,
    tab: 'fleet',
    speed: 1, // multiple of real time
    paused: false,
    pendingMinutes: 0, // fractional game minutes carried between ticks
    selectedAirport: null,
    selectedPlane: null,
    drafts: {}, // planeId -> stops being edited
    confirmNew: false,
    confirmDispose: null, // planeId waiting for a second click on Sell/Return
    pointerDown: false,
    selectOpen: false,
    selectValues: {}, // dropdown id -> chosen value, survives re-renders
  };

  const $ = (id) => document.getElementById(id);
  const fmtPop = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

  function toast(msg, bad) {
    const el = $('toast');
    el.textContent = msg;
    el.className = `show${bad ? ' bad' : ''}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.className = ''; }, 3000);
  }

  function act(err) {
    if (err) toast(err, true);
    G.dirty = true;
  }

  // ---------- map ----------
  function initMap() {
    ui.map = L.map('map', {
      minZoom: C.map.minZoom,
      maxBounds: C.map.bounds,
      maxBoundsViscosity: 0.8,
    }).setView(C.map.center, C.map.zoom);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
      maxZoom: 10,
    }).addTo(ui.map);

    for (const t of D.towns) {
      L.circleMarker([t.lat, t.lon], {
        radius: Math.max(2.5, Math.sqrt(t.pop) / 450),
        color: '#6b7280', weight: 1, fillColor: '#9ca3af', fillOpacity: 0.7,
      }).bindTooltip(`${t.name} · ${fmtPop(t.pop)}`).addTo(ui.map);
    }

    ui.routeLayer = L.layerGroup().addTo(ui.map);

    for (const a of D.airports) {
      const m = L.circleMarker([a.lat, a.lon], { radius: 4 + a.size, weight: 2 });
      m.on('click', () => {
        ui.selectedAirport = a.code;
        G.dirty = true;
      });
      m.addTo(ui.map);
      ui.airportMarkers[a.code] = m;
    }
  }

  function refreshAirports() {
    for (const a of D.airports) {
      const m = ui.airportMarkers[a.code];
      const owned = G.ownsSlot(a.code);
      const selected = ui.selectedAirport === a.code;
      m.setStyle({
        color: selected ? '#111' : owned ? '#0d7a3a' : '#1f5fbf',
        fillColor: owned ? '#22c55e' : '#60a5fa',
        fillOpacity: owned ? 0.95 : 0.7,
      });
      m.unbindTooltip();
      m.bindTooltip(owned ? a.code : `${a.code} · ${a.city}`, {
        permanent: owned, direction: 'right', className: owned ? 'owned-label' : '',
      });
    }
  }

  function drawRoutes() {
    ui.routeLayer.clearLayers();
    for (const p of G.state.planes) {
      const stops = ui.drafts[p.id] || p.schedule.stops;
      if (stops.length >= 2) {
        const pts = stops.concat(stops[0]).map((c) => [G.airportByCode[c].lat, G.airportByCode[c].lon]);
        L.polyline(pts, {
          color: ui.drafts[p.id] ? '#f59e0b' : p.schedule.active ? '#dc2626' : '#9ca3af',
          weight: 2.5, opacity: 0.85,
        }).addTo(ui.routeLayer);
      }
      const ferryTo = p.pendingFerry || (p.flight && p.flight.kind === 'ferry' ? p.flight.to : null);
      if (ferryTo) {
        const from = G.airportByCode[p.flight ? p.flight.from : p.location];
        const to = G.airportByCode[ferryTo];
        L.polyline([[from.lat, from.lon], [to.lat, to.lon]], {
          color: '#7c3aed', weight: 2, dashArray: '6 6',
        }).addTo(ui.routeLayer);
      }
    }
  }

  function planePosition(p) {
    if (p.status === 'flying') {
      const f = p.flight;
      const a = G.airportByCode[f.from];
      const b = G.airportByCode[f.to];
      const frac = Math.min(1, Math.max(0, (G.state.time - f.dep) / (f.arr - f.dep)));
      return { latlng: G.interpolate(a, b, frac), heading: G.bearing(a, b) };
    }
    const ap = G.airportByCode[p.location];
    return { latlng: [ap.lat, ap.lon], heading: 0 };
  }

  function updatePlanes() {
    for (const id of Object.keys(ui.planeMarkers)) {
      if (!G.plane(id)) {
        ui.planeMarkers[id].remove();
        delete ui.planeMarkers[id];
      }
    }
    for (const p of G.state.planes) {
      const pos = planePosition(p);
      let m = ui.planeMarkers[p.id];
      if (!m) {
        m = L.marker(pos.latlng, {
          icon: L.divIcon({ className: 'plane-icon', html: '<div class="plane">✈</div>', iconSize: [26, 26], iconAnchor: [13, 13] }),
          zIndexOffset: 1000,
        }).bindTooltip(p.id, { direction: 'top', offset: [0, -10] }).addTo(ui.map);
        m.on('click', () => {
          ui.selectedPlane = p.id;
          ui.tab = 'fleet';
          G.dirty = true;
        });
        ui.planeMarkers[p.id] = m;
      }
      m.setLatLng(pos.latlng);
      const el = m.getElement();
      if (el) {
        const glyph = el.querySelector('.plane');
        glyph.style.transform = `rotate(${pos.heading - 90}deg)`; // ✈ glyph points east
        glyph.classList.toggle('grounded', p.status !== 'flying');
      }
    }
  }

  // ---------- header ----------
  function renderHeader() {
    const s = G.state;
    $('company').textContent = s.company;
    const money = $('money');
    money.textContent = G.fmtMoney(s.money);
    money.classList.toggle('negative', s.money < 0);
    $('clock').textContent = G.fmtTime(s.time);
    $('pause').classList.toggle('active', ui.paused);
    $('speed-label').textContent = ui.speed === 1 ? 'Real time' : fmtSpeed(ui.speed);
    $('newgame').textContent = ui.confirmNew ? 'Really restart?' : 'New game';
    $('gameover').hidden = !s.gameOver;
  }

  // ---------- sidebar ----------
  function airportPanel(code) {
    const a = G.airportByCode[code];
    const s = G.state;
    const owned = G.ownsSlot(code);
    let h = `<div class="panel airport">
      <button class="close" data-action="closeAirport" title="Close">×</button>
      <h3>${a.code} · ${a.name}</h3>
      <div class="muted">${a.city}, ${a.country} · size ${'●'.repeat(a.size)}${'○'.repeat(5 - a.size)}</div>
      <div>Catchment: <b>${fmtPop(G.catchment(code))}</b> people · landing fee ${G.fmtMoney(G.landingFee(code))}</div>`;

    if (owned) {
      h += `<div class="ok">✔ You hold a slot here (${G.fmtMoney(G.slotWeekly(code))}/week)</div>`;
      if (code !== C.startAirport) h += `<button data-action="releaseSlot" data-code="${code}">Release slot</button>`;
    } else {
      const up = G.slotUpfront(code);
      h += `<div>Slot lease: <b>${G.fmtMoney(up)}</b> upfront + ${G.fmtMoney(G.slotWeekly(code))}/week</div>
        <button class="primary" data-action="leaseSlot" data-code="${code}" ${s.money < up ? 'disabled' : ''}>Lease slot</button>`;
    }

    if (owned) {
      for (const p of s.planes) {
        if ((p.location !== code || p.status === 'flying') && G.fitsAirport(p.type, code)) {
          h += ` <button data-action="sendPlane" data-plane="${p.id}" data-code="${code}">Send ${p.id} here</button>`;
        }
        if (ui.drafts[p.id]) {
          h += ` <button data-action="draftAdd" data-plane="${p.id}" data-code="${code}">Add to ${p.id} schedule</button>`;
        }
      }
    }

    const others = Object.keys(s.slots).filter((c) => c !== code);
    if (others.length) {
      h += `<table class="small"><tr><th>From your slot</th><th>km</th><th>pax/day</th><th>ticket</th></tr>`;
      for (const o of others) {
        const d = G.dist(o, code);
        h += `<tr><td>${o} → ${code}</td><td>${Math.round(d)}</td><td>${G.dailyDemand(o, code)}</td>
          <td>${G.fmtMoney(G.ticketPrice(d))}</td></tr>`;
      }
      h += `</table>`;
    }
    return h + `</div>`;
  }

  function planeStatus(p) {
    const f = p.flight;
    if (p.status === 'flying') {
      return `${f.kind === 'ferry' ? 'Ferrying' : 'Flying'} ${f.from} → ${f.to}, arrives ${G.fmtClock(f.arr)}` +
        (f.kind === 'scheduled' ? ` · ${f.pax} pax` : '');
    }
    if (p.status === 'turnaround') return `Turnaround at ${p.location} until ${G.fmtClock(p.readyAt)}`;
    const crew = G.crewOf(p);
    const leg = p.pendingFerry || (p.schedule.active && p.schedule.stops.length >= 2);
    if (leg && crew && crew.dutyToday >= C.crewMaxDutyMin - 60) return `At ${p.location} · crew resting`;
    if (leg) return `At ${p.location} · waiting (curfew / crew duty)`;
    return `Idle at ${p.location}`;
  }

  function scheduleEditor(p) {
    const stops = ui.drafts[p.id];
    const owned = Object.keys(G.state.slots);
    let h = `<div class="editor"><div class="label">Edit schedule (loops back to the first stop)</div><ol class="stops">`;
    stops.forEach((c, i) => {
      h += `<li>${c} <span class="muted">${G.airportByCode[c].city}</span>
        <button class="mini" data-action="draftUp" data-plane="${p.id}" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="mini" data-action="draftRemove" data-plane="${p.id}" data-i="${i}">✕</button></li>`;
    });
    h += `</ol><div class="row"><select id="add-${p.id}">`;
    for (const c of owned) h += `<option value="${c}">${c} · ${G.airportByCode[c].city}</option>`;
    h += `</select><button data-action="draftAddSelect" data-plane="${p.id}">Add stop</button></div>`;
    if (owned.length < 2) h += `<div class="hint">Lease a slot at another airport (click it on the map) to build a route.</div>`;

    const est = G.estimateSchedule(p.type, stops, G.costMult(p));
    if (est.legs.length) {
      h += `<table class="small"><tr><th>Leg</th><th>km</th><th>time</th><th>pax</th><th>result</th></tr>`;
      for (const l of est.legs) {
        const r = l.revenue - l.cost;
        h += `<tr><td>${l.from}→${l.to}</td><td>${l.d}</td><td>${G.fmtDuration(l.block)}</td>
          <td>${l.pax}/${l.demand}</td><td class="${r >= 0 ? 'pos' : 'neg'}">${G.fmtMoney(r)}</td></tr>`;
      }
      h += `</table><div class="muted">One loop ≈ ${G.fmtDuration(est.loopMin)} incl. turnarounds ·
        est. ${G.fmtMoney(est.profit)} per loop (first flight of the day; later flights on the same route share the daily demand)</div>`;
    }
    h += `<div class="row"><button class="primary" data-action="draftSave" data-plane="${p.id}">Save schedule</button>
      <button data-action="draftCancel" data-plane="${p.id}">Cancel</button></div></div>`;
    return h;
  }

  function fleetTab() {
    const s = G.state;
    const owned = Object.keys(s.slots);
    let h = '';
    for (const p of s.planes) {
      const ac = D.aircraft[p.type];
      const crew = G.crewOf(p);
      const sch = p.schedule;
      h += `<div class="panel plane-card ${ui.selectedPlane === p.id ? 'selected' : ''}">
        <h3>✈ ${p.id} <span class="muted">${ac.name}</span></h3>
        <div class="muted">${ac.seats} seats · range ${ac.rangeKm} km · ${ac.speedKmh} km/h · ${ownershipText(p)}</div>
        <div class="status">${planeStatus(p)}</div>`;
      if (crew) {
        h += `<div>👥 ${crew.name}: ${crew.pilots} pilots, ${crew.cabin} cabin crew ·
          duty today ${G.fmtDuration(crew.dutyToday)} / ${G.fmtDuration(C.crewMaxDutyMin)}</div>`;
      }
      h += `<div class="muted">Totals: ${p.stats.flights} flights · ${p.stats.pax} pax · ${G.fmtMoney(p.stats.profit)}</div>`;

      h += `<div class="row"><select id="send-${p.id}">`;
      for (const c of owned) h += `<option value="${c}">${c} · ${G.airportByCode[c].city}</option>`;
      h += `</select><button data-action="sendSelect" data-plane="${p.id}">Ferry there</button></div>`;

      h += `<div class="label">Schedule ${sch.stops.length >= 2 ? (sch.active ? '<span class="pos">● running</span>' : '<span class="muted">⏸ paused</span>') : ''}</div>`;
      if (sch.stops.length >= 2) {
        h += `<div class="route">${sch.stops.map((c, i) =>
          `<span class="${i === sch.index && p.status !== 'flying' ? 'here' : ''}">${c}</span>`).join(' → ')} ↺</div>`;
      } else {
        h += `<div class="muted">No schedule yet.</div>`;
      }

      if (ui.drafts[p.id]) {
        h += scheduleEditor(p);
      } else {
        h += `<div class="row"><button data-action="editSchedule" data-plane="${p.id}">Edit schedule</button>`;
        if (sch.stops.length >= 2) {
          h += sch.active
            ? `<button data-action="pause" data-plane="${p.id}">Pause</button>`
            : `<button class="primary" data-action="start" data-plane="${p.id}">Start schedule</button>`;
        }
        h += `</div>`;
      }
      const confirm = ui.confirmDispose === p.id;
      const label = p.ownership === 'owned' ? `Sell for ${G.fmtMoney(G.saleValue(p))}` : `Return lease (fee ${G.fmtMoney(G.returnFee(p))})`;
      h += `<div class="row"><button class="mini dispose" data-action="dispose" data-plane="${p.id}"
        ${p.status === 'flying' || s.planes.length === 1 ? 'disabled' : ''}>${confirm ? 'Really? Click again' : label}</button></div>`;
      h += `</div>`;
    }
    h += `<div class="hint">Get more aircraft in the <a href="#" data-action="tab" data-tab-to="market">Market</a> tab.</div>`;
    return h;
  }

  function ownershipText(p) {
    const age = G.planeAge(p);
    const ageText = age >= 1 ? ` · ${Math.floor(age)} years old` : '';
    return p.ownership === 'owned'
      ? `owned${ageText}`
      : `leased ${G.fmtMoney(D.aircraft[p.type].leasePerWeek)}/week${ageText}`;
  }

  // ---------- market ----------
  const fmtM = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : `${Math.round(n / 1000)}k`);
  const sizeDots = (n) => `${'●'.repeat(n)}${'○'.repeat(5 - n)}`;
  const MARKET_SORTS = {
    price: ['Price', (a, b) => G.priceNew(a) - G.priceNew(b)],
    seats: ['Seats', (a, b) => D.aircraft[b].seats - D.aircraft[a].seats],
    range: ['Range', (a, b) => D.aircraft[b].rangeKm - D.aircraft[a].rangeKm],
    costSeat: ['Cost per seat-hour', (a, b) =>
      D.aircraft[a].costPerBlockHour / D.aircraft[a].seats - D.aircraft[b].costPerBlockHour / D.aircraft[b].seats],
    name: ['Name', (a, b) => D.aircraft[a].name.localeCompare(D.aircraft[b].name)],
  };

  function marketTab() {
    const s = G.state;
    const slots = Object.keys(s.slots);
    const cat = ui.selectValues['mkt-cat'] || 'all';
    const sort = ui.selectValues['mkt-sort'] || 'price';
    const at = slots.includes(ui.selectValues['mkt-at']) ? ui.selectValues['mkt-at'] : C.startAirport;
    const atSize = G.airportByCode[at].size;

    let h = `<div class="panel market-controls"><h3>Aircraft market</h3>
      <div class="row">
        <label>Type <select id="mkt-cat"><option value="all">All</option>`;
    for (const [k, v] of Object.entries(D.aircraftCategories)) h += `<option value="${k}">${v}</option>`;
    h += `</select></label><label>Sort <select id="mkt-sort">`;
    for (const [k, [v]] of Object.entries(MARKET_SORTS)) h += `<option value="${k}">${v}</option>`;
    h += `</select></label></div>
      <div class="row"><label>Deliver to <select id="mkt-at">`;
    for (const c of slots) h += `<option value="${c}">${c} · ${G.airportByCode[c].city} (size ${G.airportByCode[c].size})</option>`;
    h += `</select></label></div>
      <div class="muted">Buy: pay once, no weekly lease, sell any time. Lease: ${C.market.leaseDepositWeeks} weeks deposit,
        then the weekly rate. Every plane comes with its own crew. Airport size ${sizeDots(atSize)} at ${at}.</div></div>`;

    // Used planes
    h += `<div class="panel"><h3>Used aircraft <span class="muted">· new offers every Monday</span></h3>`;
    const used = s.market.listings.filter((l) => cat === 'all' || D.aircraft[l.type].category === cat);
    if (!used.length) h += `<div class="muted">No offers in this category this week.</div>`;
    for (const l of used) {
      const ac = D.aircraft[l.type];
      const fits = G.fitsAirport(l.type, at);
      h += `<div class="mkt-item ${fits ? '' : 'too-big'}">
        <div class="mkt-head"><b>${ac.name}</b> <span class="muted">${l.age} years · ${ac.seats} seats · ${ac.rangeKm} km</span></div>
        ${fits ? '' : `<div class="neg small-text">Too big for ${at} – needs airport size ${ac.minAirport}+.</div>`}
        <div class="row"><span class="muted">+${Math.round(C.market.agingCostPerYear * l.age * 100)}% operating cost</span>
          <span class="spacer"></span>
          <button class="primary" data-action="buyUsed" data-id="${l.id}" data-code="${at}"
            ${!fits || s.money < l.price ? 'disabled' : ''}>Buy ${G.fmtMoney(l.price)}</button></div></div>`;
    }
    h += `</div>`;

    // New planes
    const types = Object.keys(D.aircraft)
      .filter((t) => cat === 'all' || D.aircraft[t].category === cat)
      .sort(MARKET_SORTS[sort][1]);
    h += `<div class="panel"><h3>New aircraft <span class="muted">· ${types.length} types</span></h3>`;
    for (const t of types) {
      const ac = D.aircraft[t];
      const fleet = s.planes.filter((p) => p.type === t).length;
      const price = G.priceNew(t);
      const deposit = G.leaseDeposit(t);
      const fits = G.fitsAirport(t, at);
      h += `<div class="mkt-item ${fits ? '' : 'too-big'}">
        <div class="mkt-head"><b>${ac.name}</b> <span class="muted">${ac.maker} · ${D.aircraftCategories[ac.category]}</span>
          ${fleet ? `<span class="tag">${fleet} in fleet</span>` : ''}</div>
        <div class="muted">${ac.seats} seats · ${ac.rangeKm.toLocaleString('de-CH')} km · ${ac.speedKmh} km/h ·
          ${G.fmtMoney(ac.costPerBlockHour)}/h · crew ${G.fmtMoney(G.crewFor(t).weeklySalary)}/wk ·
          airport ${sizeDots(ac.minAirport || 1)}</div>
        ${fits ? '' : `<div class="neg small-text">Too big for ${at} – pick a larger delivery airport.</div>`}
        <div class="row">
          <button class="primary" data-action="buyNew" data-type="${t}" data-code="${at}"
            ${!fits || s.money < price ? 'disabled' : ''}>Buy ${fmtM(price)}</button>
          <button data-action="leaseNew" data-type="${t}" data-code="${at}"
            ${!fits || s.money < deposit ? 'disabled' : ''}>Lease ${fmtM(ac.leasePerWeek)}/wk</button>
        </div></div>`;
    }
    return h + `</div>`;
  }

  function slotsTab() {
    const s = G.state;
    let h = `<div class="panel"><h3>Your slots</h3><table class="small"><tr><th>Airport</th><th>catchment</th><th>/week</th></tr>`;
    for (const code of Object.keys(s.slots)) {
      const a = G.airportByCode[code];
      h += `<tr class="click" data-action="selectAirport" data-code="${code}"><td>${code} · ${a.city}</td>
        <td>${fmtPop(G.catchment(code))}</td><td>${G.fmtMoney(G.slotWeekly(code))}</td></tr>`;
    }
    h += `</table><div class="hint">Click an airport on the map to see its demand and lease a slot.</div></div>`;

    h += `<div class="panel"><h3>Best routes from ${C.startAirport}</h3><table class="small">
      <tr><th>Airport</th><th>km</th><th>pax/day</th><th>slot</th></tr>`;
    const ranked = D.airports
      .filter((a) => a.code !== C.startAirport)
      .map((a) => ({ a, demand: G.dailyDemand(C.startAirport, a.code) }))
      .sort((x, y) => y.demand - x.demand)
      .slice(0, 15);
    for (const { a, demand } of ranked) {
      h += `<tr class="click" data-action="selectAirport" data-code="${a.code}">
        <td>${G.ownsSlot(a.code) ? '✔ ' : ''}${a.code} · ${a.city}</td><td>${Math.round(G.dist(C.startAirport, a.code))}</td>
        <td>${demand}</td><td>${G.fmtMoney(G.slotUpfront(a.code))}</td></tr>`;
    }
    return h + `</table></div>`;
  }

  function financeTab() {
    const s = G.state;
    const w = G.weeklyCosts();
    const t = s.today;
    const day = Math.floor(s.time / 1440);
    const nextCharge = (Math.floor(day / 7) + 1) * 7;
    let h = `<div class="panel"><h3>Balance: ${G.fmtMoney(s.money)}</h3>
      <div class="muted">Bankrupt below ${G.fmtMoney(C.bankruptcyLimit)}</div>
      <h4>Weekly fixed costs (next charge Day ${nextCharge + 1} 00:00)</h4>
      <table class="small">
        <tr><td>Aircraft leases</td><td>${G.fmtMoney(w.planes)}</td></tr>
        <tr><td>Crew salaries</td><td>${G.fmtMoney(w.crews)}</td></tr>
        <tr><td>Slot fees</td><td>${G.fmtMoney(w.slots)}</td></tr>
        <tr><th>Total</th><th>${G.fmtMoney(w.total)}</th></tr>
      </table>
      <h4>Today so far</h4>
      <div>${t.flights} flights · ${t.pax} pax · revenue ${G.fmtMoney(t.revenue)} · costs ${G.fmtMoney(t.cost)}
        → <b class="${t.revenue - t.cost >= 0 ? 'pos' : 'neg'}">${G.fmtMoney(t.revenue - t.cost)}</b></div></div>`;

    h += `<div class="panel"><h3>History</h3><table class="small">
      <tr><th>Day</th><th>flights</th><th>pax</th><th>operating</th><th>fixed</th></tr>`;
    for (const d of s.history.slice(0, 14)) {
      const r = d.revenue - d.cost;
      h += `<tr><td>${d.day + 1}</td><td>${d.flights}</td><td>${d.pax}</td>
        <td class="${r >= 0 ? 'pos' : 'neg'}">${G.fmtMoney(r)}</td><td>${d.fixed ? G.fmtMoney(-d.fixed) : ''}</td></tr>`;
    }
    return h + `</table></div>`;
  }

  function logTab() {
    return `<div class="panel log">${G.state.log.slice(0, 120).map((e) =>
      `<div class="entry ${e.kind}"><span class="muted">${G.fmtTime(e.t)}</span> ${e.msg}</div>`).join('')}</div>`;
  }

  function renderSidebar() {
    $('details').innerHTML = ui.selectedAirport ? airportPanel(ui.selectedAirport) : '';
    const tabs = { fleet: fleetTab, market: marketTab, slots: slotsTab, finance: financeTab, log: logTab };
    $('tab-content').innerHTML = tabs[ui.tab]();
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
    restoreSelects();
  }

  function renderAll() {
    renderSidebar();
    refreshAirports();
    drawRoutes();
  }

  // ---------- input ----------
  function onAction(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, plane, code } = el.dataset;
    const i = Number(el.dataset.i);
    const draft = ui.drafts[plane];

    switch (action) {
      case 'closeAirport': ui.selectedAirport = null; break;
      case 'selectAirport': {
        ui.selectedAirport = code;
        const a = G.airportByCode[code];
        ui.map.panTo([a.lat, a.lon]);
        break;
      }
      case 'leaseSlot': act(G.leaseSlot(code)); break;
      case 'releaseSlot': act(G.releaseSlot(code)); break;
      case 'sendPlane': act(G.sendPlane(plane, code)); break;
      case 'sendSelect': act(G.sendPlane(plane, $(`send-${plane}`).value)); break;
      case 'start': act(G.setScheduleActive(plane, true)); break;
      case 'tab': e.preventDefault(); ui.tab = el.dataset.tabTo; break;
      case 'buyNew': act(G.buyNew(el.dataset.type, code)); break;
      case 'leaseNew': act(G.leaseNew(el.dataset.type, code)); break;
      case 'buyUsed': act(G.buyUsed(el.dataset.id, code)); break;
      case 'dispose': {
        if (ui.confirmDispose !== plane) {
          ui.confirmDispose = plane;
          clearTimeout(ui.disposeTimer);
          ui.disposeTimer = setTimeout(() => { ui.confirmDispose = null; G.dirty = true; }, 3000);
          break;
        }
        ui.confirmDispose = null;
        const err = G.disposePlane(plane);
        if (err) { toast(err, true); return; }
        delete ui.drafts[plane];
        if (ui.selectedPlane === plane) ui.selectedPlane = null;
        break;
      }
      case 'pause': act(G.setScheduleActive(plane, false)); break;
      case 'editSchedule': {
        const p = G.plane(plane);
        ui.drafts[plane] = p.schedule.stops.length ? p.schedule.stops.slice() : [p.location];
        break;
      }
      case 'draftAdd': draft.push(code); break;
      case 'draftAddSelect': draft.push($(`add-${plane}`).value); break;
      case 'draftRemove': draft.splice(i, 1); break;
      case 'draftUp': [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; break;
      case 'draftCancel': delete ui.drafts[plane]; break;
      case 'draftSave': {
        const err = G.setSchedule(plane, draft);
        if (err) { toast(err, true); return; }
        delete ui.drafts[plane];
        toast('Schedule saved – press "Start schedule" to fly it.');
        break;
      }
      default: return;
    }
    G.dirty = true;
  }

  function bindControls() {
    $('sidebar').addEventListener('click', onAction);
    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      ui.tab = b.dataset.tab;
      G.dirty = true;
    }));
    $('pause').addEventListener('click', () => { ui.paused = !ui.paused; });
    $('speed').addEventListener('input', (e) => { ui.speed = sliderToSpeed(Number(e.target.value)); });
    $('save').addEventListener('click', () => {
      const ok = G.save();
      toast(ok ? 'Game saved.' : 'Could not save.', !ok);
    });
    // Keep the sidebar stable while a click is in progress.
    $('sidebar').addEventListener('mousedown', () => { ui.pointerDown = true; });
    document.addEventListener('mouseup', () => setTimeout(() => { ui.pointerDown = false; }, 0));
    $('sidebar').addEventListener('change', (e) => {
      if (e.target.tagName !== 'SELECT') return;
      ui.selectValues[e.target.id] = e.target.value;
      ui.selectOpen = false;
      if (e.target.id.startsWith('mkt-')) G.dirty = true; // market filters re-render the list
    });
    $('sidebar').addEventListener('focusin', (e) => { if (e.target.tagName === 'SELECT') ui.selectOpen = true; });
    $('sidebar').addEventListener('focusout', (e) => { if (e.target.tagName === 'SELECT') ui.selectOpen = false; });
    $('newgame').addEventListener('click', () => {
      if (!ui.confirmNew) {
        ui.confirmNew = true;
        setTimeout(() => { ui.confirmNew = false; }, 3000);
        return;
      }
      ui.confirmNew = false;
      G.newGame();
      ui.drafts = {};
      ui.selectedAirport = null;
      Object.values(ui.planeMarkers).forEach((m) => m.remove());
      ui.planeMarkers = {};
      G.save();
    });
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, select, textarea')) return;
      if (e.key === ' ') { ui.paused = !ui.paused; e.preventDefault(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const step = e.key === 'ArrowRight' ? 50 : -50;
        const v = Math.min(SLIDER_MAX, Math.max(0, speedToSlider(ui.speed) + step));
        $('speed').value = v;
        ui.speed = sliderToSpeed(v);
        e.preventDefault();
      }
    });
  }

  // Don't rebuild the sidebar mid-click or while a dropdown is open.
  function sidebarBusy() {
    return ui.pointerDown || ui.selectOpen;
  }

  // Restore dropdown choices after a re-render.
  function restoreSelects() {
    for (const [id, value] of Object.entries(ui.selectValues)) {
      const el = $(id);
      if (el && [...el.options].some((o) => o.value === value)) el.value = value;
    }
  }

  function loop() {
    if (!ui.paused) {
      ui.pendingMinutes += (ui.speed * TICK_MS) / 60000;
      const whole = Math.floor(ui.pendingMinutes);
      ui.pendingMinutes -= whole;
      if (whole > 0) G.advance(whole);
    }
    renderHeader();
    updatePlanes();
    if (G.dirty && !sidebarBusy()) {
      G.dirty = false;
      renderAll();
    }
  }

  function init() {
    if (!G.load()) G.newGame();
    initMap();
    bindControls();
    renderAll();
    setInterval(loop, TICK_MS);
    setInterval(() => G.save(), 30000);
    window.addEventListener('beforeunload', () => G.save());
  }

  window.addEventListener('DOMContentLoaded', init);
})();
