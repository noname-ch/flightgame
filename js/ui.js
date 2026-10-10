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
    charts: {}, // chart id -> data for hover tooltips
    map: null,
    airportMarkers: {},
    planeMarkers: {},
    townMarkers: [], // { t, m }
    townLayer: null,
    catchmentLayer: null,
    routeLayer: null,
    selectRing: null,
    shownAirport: null, // airport the catchment overlay is currently drawn for
    hoverAirport: null,
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
  // Apple-Maps-like look: recoloured Esri canvas tiles plus the iOS system colours (mirrored in style.css).
  const COLORS = {
    blue: '#007aff', blueDark: '#0058d0', green: '#34c759', orange: '#ff9500',
    purple: '#af52de', gray: '#8e8e93', grayDark: '#6d6d72',
  };
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
  const tileUrl = (service) => `${ESRI}/${service}/MapServer/tile/{z}/{y}/{x}`;
  const TILE_OPTS = {
    attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    maxZoom: 10,
  };
  const tiles = (service, opts) => L.tileLayer(tileUrl(service), Object.assign({}, TILE_OPTS, opts));
  const NAME_TILES = {
    Standard: 'Canvas/World_Light_Gray_Reference',
    Dark: 'Canvas/World_Dark_Gray_Reference',
    Satellite: 'Canvas/World_Dark_Gray_Reference',
  };

  // Esri's light grey tiles, repainted once per tile: the neutral greys (land = 239) become warm
  // land with darker borders and labels, the faintly bluish water (208, B > G) becomes flat blue.
  const LAND = [246, 243, 236];
  const SEA = [166, 208, 245];
  function tint(px) {
    for (let i = 0; i < px.length; i += 4) {
      const g = px[i + 1];
      const water = Math.min(1, Math.max(0, (px[i + 2] - g) / 4));
      const land = (g - 239) * 1.5; // contrast for borders and labels
      const sea = (g - 208) * 1.2;
      for (let c = 0; c < 3; c++) px[i + c] = (LAND[c] + land) * (1 - water) + (SEA[c] + sea) * water;
    }
  }
  const TintedTiles = L.TileLayer.extend({
    createTile(coords, done) {
      const canvas = document.createElement('canvas');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        tint(data.data);
        ctx.putImageData(data, 0, 0);
        canvas.complete = true; // Leaflet drops tiles it thinks are still loading
        done(null, canvas);
      };
      img.onerror = () => done(new Error('Tile failed to load'), canvas);
      img.src = this.getTileUrl(coords);
      return canvas;
    },
  });

  // Top-down aircraft pointing north (Material Icons "flight").
  const PLANE_SVG = '<svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>';

  const TOWN_STYLE = { color: '#fff', weight: 1, fillColor: COLORS.gray, fillOpacity: 0.75 };
  const TOWN_IN_CATCHMENT = { color: '#fff', weight: 1, fillColor: COLORS.orange, fillOpacity: 1 };

  const LEGEND = `<details class="map-legend leaflet-bar"><summary>Legend</summary>
    <div><i class="dot own"></i>Your slot (★ home base)</div>
    <div><i class="dot ap"></i>Airport · bigger = larger hub</div>
    <div><i class="dot town"></i>Town · bigger = more people</div>
    <div><i class="dot catch"></i>Town feeding the selected airport</div>
    <div><i class="line active"></i>Schedule running</div>
    <div><i class="line paused"></i>Schedule paused</div>
    <div><i class="line draft"></i>Schedule being edited</div>
    <div><i class="line ferry"></i>Ferry flight</div>
  </details>`;

  // Markers shrink when zoomed out so Europe doesn't turn into one blob.
  const zoomScale = () => Math.min(1.5, Math.max(0.6, 0.6 + (ui.map.getZoom() - 3) * 0.2));
  const airportRadius = (a) => (4 + a.size) * zoomScale();
  const townRadius = (t) => Math.max(2.5, Math.sqrt(t.pop) / 450) * zoomScale();

  // Great-circle path between two airports as a list of [lat, lon].
  function arc(a, b) {
    const n = Math.max(2, Math.ceil(G.distanceKm(a, b) / 150));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(G.interpolate(a, b, i / n));
    return pts;
  }

  function addControl(position, build) {
    const c = L.control({ position });
    c.onAdd = () => {
      const el = build();
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      return el;
    };
    c.addTo(ui.map);
  }

  function selectPlane(id) {
    ui.selectedPlane = id;
    ui.tab = 'fleet';
    G.dirty = true;
  }

  function initMap() {
    const map = ui.map = L.map('map', {
      minZoom: C.map.minZoom,
      maxZoom: 10,
      maxBounds: C.map.bounds,
      maxBoundsViscosity: 0.8,
    }).setView(C.map.center, C.map.zoom);

    // Stacking: tiles < towns + catchment < routes < airports < planes.
    map.createPane('towns').style.zIndex = 350;
    map.createPane('routes').style.zIndex = 390;

    const base = {
      Standard: new TintedTiles(tileUrl('Canvas/World_Light_Gray_Base'), TILE_OPTS).addTo(map),
      Dark: tiles('Canvas/World_Dark_Gray_Base'),
      Satellite: tiles('World_Imagery'),
    };
    // City names; off by default because they collide with the airport dots.
    const names = tiles(NAME_TILES.Standard, { zIndex: 2 });
    map.on('baselayerchange', (e) => {
      names.setUrl(tileUrl(NAME_TILES[e.name]));
      map.getContainer().classList.toggle('map-dark', e.name !== 'Standard');
    });

    ui.townLayer = L.layerGroup().addTo(map);
    ui.catchmentLayer = L.layerGroup().addTo(map);
    ui.routeLayer = L.layerGroup().addTo(map);

    for (const t of D.towns) {
      const m = L.circleMarker([t.lat, t.lon], Object.assign({ pane: 'towns' }, TOWN_STYLE))
        .bindTooltip(`${t.name} · ${fmtPop(t.pop)}`).addTo(ui.townLayer);
      ui.townMarkers.push({ t, m });
    }

    for (const a of D.airports) {
      const m = L.circleMarker([a.lat, a.lon], {
        color: '#fff', weight: 2, fillOpacity: 1, className: 'ap-dot', bubblingMouseEvents: false,
      });
      m.bindTooltip(`<b>${a.code}</b><span class="city"> · ${a.city}</span>`, {
        permanent: true, direction: 'right', className: `ap-label${a.code === C.startAirport ? ' home' : ''}`,
      });
      m.on('click', () => {
        ui.selectedAirport = a.code;
        G.dirty = true;
      });
      m.on('mouseover', () => { ui.hoverAirport = a.code; m.setRadius(airportRadius(a) + 2); updateLabel(a); });
      m.on('mouseout', () => { ui.hoverAirport = null; m.setRadius(airportRadius(a)); updateLabel(a); });
      m.addTo(map);
      ui.airportMarkers[a.code] = m;
    }

    L.control.scale({ imperial: false }).addTo(map);
    L.control.layers(base, { Towns: ui.townLayer, Routes: ui.routeLayer, 'Place names': names }).addTo(map);
    addControl('topleft', () => {
      const bar = L.DomUtil.create('div', 'leaflet-bar');
      const btn = L.DomUtil.create('a', 'fit-network', bar);
      btn.href = '#';
      btn.title = 'Show my network';
      btn.textContent = '⌂';
      L.DomEvent.on(btn, 'click', (e) => { L.DomEvent.preventDefault(e); fitNetwork(); });
      return bar;
    });
    addControl('bottomleft', () => {
      const box = L.DomUtil.create('div');
      box.innerHTML = LEGEND;
      return box.firstChild;
    });

    map.on('zoomend', resizeMarkers);
    map.on('click', () => {
      if (!ui.selectedAirport && !ui.selectedPlane) return;
      ui.selectedAirport = null;
      ui.selectedPlane = null;
      G.dirty = true;
    });
    resizeMarkers();
  }

  function fitNetwork() {
    const pts = Object.keys(G.state.slots).map((c) => [G.airportByCode[c].lat, G.airportByCode[c].lon]);
    ui.map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 6 });
  }

  function resizeMarkers() {
    for (const { t, m } of ui.townMarkers) m.setRadius(townRadius(t));
    for (const a of D.airports) {
      const m = ui.airportMarkers[a.code];
      const r = airportRadius(a);
      m.setRadius(r);
      const tip = m.getTooltip();
      tip.options.offset = L.point(r - 2, 0); // keep the label clear of the dot
      tip.update();
      updateLabel(a);
    }
    if (ui.selectRing) ui.selectRing.setRadius(airportRadius(G.airportByCode[ui.selectedAirport]) + 5);
  }

  // Codes of small airports only appear when zoomed in; own, selected and hovered ones always show.
  function updateLabel(a) {
    const el = ui.airportMarkers[a.code].getTooltip().getElement();
    if (!el) return;
    const owned = G.ownsSlot(a.code);
    const selected = ui.selectedAirport === a.code;
    const hover = ui.hoverAirport === a.code;
    el.classList.toggle('owned', owned);
    el.classList.toggle('selected', selected);
    el.classList.toggle('hover', hover);
    el.classList.toggle('hidden', !(owned || selected || hover || ui.map.getZoom() >= C.map.labelZoom - a.size));
  }

  function refreshAirports() {
    for (const a of D.airports) {
      ui.airportMarkers[a.code].setStyle({ fillColor: G.ownsSlot(a.code) ? COLORS.green : COLORS.blue });
      updateLabel(a);
    }
    drawCatchment();
  }

  // Ring around the selected airport plus the towns that feed it.
  function drawCatchment() {
    if (ui.shownAirport === ui.selectedAirport) return;
    ui.shownAirport = ui.selectedAirport;
    ui.catchmentLayer.clearLayers();
    ui.selectRing = null;
    const a = G.airportByCode[ui.selectedAirport];
    for (const { t, m } of ui.townMarkers) {
      m.setStyle(a && G.distanceKm(a, t) < C.catchmentRadiusKm ? TOWN_IN_CATCHMENT : TOWN_STYLE);
    }
    if (!a) return;
    L.circle([a.lat, a.lon], {
      radius: C.catchmentRadiusKm * 1000, pane: 'towns', interactive: false,
      color: COLORS.blue, weight: 1, opacity: 0.5, fillOpacity: 0.12,
    }).addTo(ui.catchmentLayer).bringToBack();
    ui.selectRing = L.circleMarker([a.lat, a.lon], {
      radius: airportRadius(a) + 5, interactive: false, color: COLORS.blue, weight: 3, fill: false,
    }).addTo(ui.catchmentLayer);
  }

  function drawRoutes() {
    ui.routeLayer.clearLayers();
    const ap = (c) => G.airportByCode[c];
    // Selected plane last so its route ends up on top.
    const planes = G.state.planes.slice().sort((p, q) => (p.id === ui.selectedPlane) - (q.id === ui.selectedPlane));
    for (const p of planes) {
      const draft = ui.drafts[p.id];
      const stops = draft || p.schedule.stops;
      const selected = ui.selectedPlane === p.id;
      if (stops.length >= 2) {
        const pts = [];
        stops.forEach((c, i) => pts.push(...arc(ap(c), ap(stops[(i + 1) % stops.length]))));
        const weight = selected ? 5 : 3;
        const active = p.schedule.active;
        // Solid routes get a darker casing, drafts are a row of dots.
        if (!draft) {
          L.polyline(pts, {
            pane: 'routes', interactive: false,
            color: active ? COLORS.blueDark : COLORS.grayDark, weight: weight + 2,
          }).addTo(ui.routeLayer);
        }
        L.polyline(pts, {
          pane: 'routes', bubblingMouseEvents: false,
          color: draft ? COLORS.orange : active ? COLORS.blue : COLORS.gray,
          weight: draft ? weight + 1 : weight, opacity: 1,
          dashArray: draft ? '0.1 9' : null,
        }).bindTooltip(`${p.id}: ${stops.join(' → ')} ↺`, { sticky: true })
          .on('click', () => selectPlane(p.id)).addTo(ui.routeLayer);
      }
      const ferryTo = p.pendingFerry || (p.flight && p.flight.kind === 'ferry' ? p.flight.to : null);
      if (ferryTo) {
        L.polyline(arc(ap(p.flight ? p.flight.from : p.location), ap(ferryTo)), {
          pane: 'routes', bubblingMouseEvents: false,
          color: COLORS.purple, weight: selected ? 4 : 2.5, opacity: 1, dashArray: '7 7',
        }).bindTooltip(`${p.id}: ferry to ${ferryTo}`, { sticky: true })
          .on('click', () => selectPlane(p.id)).addTo(ui.routeLayer);
      }
    }
  }

  function planePosition(p) {
    if (p.status === 'flying') {
      const f = p.flight;
      const a = G.airportByCode[f.from];
      const b = G.airportByCode[f.to];
      const frac = Math.min(1, Math.max(0, (G.state.time - f.dep) / (f.arr - f.dep)));
      const at = G.interpolate(a, b, Math.min(frac, 0.99)); // no heading at the destination itself
      return { latlng: G.interpolate(a, b, frac), heading: G.bearing({ lat: at[0], lon: at[1] }, b) };
    }
    const ap = G.airportByCode[p.location];
    return { latlng: [ap.lat, ap.lon], heading: 0 };
  }

  const planeTip = (p) => `<b>${p.id}</b> · ${planeStatus(p)}`;

  function refreshPlanes() {
    for (const p of G.state.planes) {
      const m = ui.planeMarkers[p.id];
      if (m) m.setTooltipContent(planeTip(p));
    }
  }

  function updatePlanes() {
    const parked = {}; // airport code -> planes on the ground there so far
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
          icon: L.divIcon({ className: 'plane-icon', html: `<div class="plane">${PLANE_SVG}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
          zIndexOffset: 1000,
        }).bindTooltip(planeTip(p), { direction: 'top', offset: [0, -14] }).addTo(ui.map);
        m.on('click', () => selectPlane(p.id));
        ui.planeMarkers[p.id] = m;
      }
      m.setLatLng(pos.latlng);
      const el = m.getElement();
      if (el) {
        const glyph = el.querySelector('.plane');
        const flying = p.status === 'flying';
        // Parked planes line up above their airport so it stays clickable.
        const n = flying ? 0 : (parked[p.location] = (parked[p.location] || 0) + 1) - 1;
        glyph.style.transform = flying ? `rotate(${pos.heading}deg)` : `translate(${n * 13}px, -15px) scale(0.75)`;
        glyph.classList.toggle('grounded', !flying);
        glyph.classList.toggle('selected', ui.selectedPlane === p.id);
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
  // Ticket price of a route with − / + to change it (applies to both directions).
  function fareCell(a, b) {
    const f = G.fareFactor(a, b);
    const btn = (dir, label, off) => `<button class="mini" data-action="fare" data-from="${a}" data-to="${b}"
      data-dir="${dir}" ${off ? 'disabled' : ''}>${label}</button>`;
    return `<td class="fare">${btn(-1, '−', f <= C.ticket.minFactor)} ${G.fmtMoney(G.fare(a, b))}
      ${btn(1, '+', f >= C.ticket.maxFactor)} <span class="muted">${Math.round(f * 100)}%</span></td>`;
  }

  // Prices for every route a schedule flies.
  function fareTable(stops) {
    const seen = new Set();
    let h = `<table class="small"><tr><th>Route</th><th>pax/day</th><th>ticket</th></tr>`;
    stops.forEach((a, i) => {
      const b = stops[(i + 1) % stops.length];
      if (a === b || seen.has(G.routeKey(a, b))) return;
      seen.add(G.routeKey(a, b));
      h += `<tr><td>${a} ↔ ${b}</td><td>${G.demand(a, b)}</td>${fareCell(a, b)}</tr>`;
    });
    return h + `</table>`;
  }

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
        h += `<tr><td>${o} → ${code}</td><td>${Math.round(d)}</td><td>${G.demand(o, code)}</td>
          ${fareCell(o, code)}</tr>`;
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
      const flown = ui.drafts[p.id] || sch.stops;
      if (flown.length >= 2) h += fareTable(flown);

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
      .map((a) => ({ a, demand: G.demand(C.startAirport, a.code) }))
      .sort((x, y) => y.demand - x.demand)
      .slice(0, 15);
    for (const { a, demand } of ranked) {
      h += `<tr class="click" data-action="selectAirport" data-code="${a.code}">
        <td>${G.ownsSlot(a.code) ? '✔ ' : ''}${a.code} · ${a.city}</td><td>${Math.round(G.dist(C.startAirport, a.code))}</td>
        <td>${demand}</td><td>${G.fmtMoney(G.slotUpfront(a.code))}</td></tr>`;
    }
    return h + `</table></div>`;
  }

  // ---------- finance charts ----------
  const CHART_W = 360;
  const CHART_H = 130;
  const PAD = { l: 44, r: 8, t: 8, b: 18 };
  const CHART_DAYS = 30;

  // Oldest first, ending with today so far.
  function financeRows() {
    const s = G.state;
    const day = Math.floor(s.time / 1440);
    const rows = s.history.slice(0, CHART_DAYS - 1).reverse().map((d) => ({
      label: `Day ${d.day + 1}`,
      revenue: d.revenue,
      costs: d.cost + (d.fixed || 0),
      cash: d.cash,
    }));
    const t = s.today;
    rows.push({ label: `Day ${day + 1} (so far)`, revenue: t.revenue, costs: t.cost + (t.fixed || 0), cash: s.money });
    for (const r of rows) r.net = r.revenue - r.costs;
    return rows;
  }

  // Short money labels for axes: 1.2M, 350k.
  function fmtShort(v) {
    const a = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
    if (a >= 1e3) return `${sign}${Math.round(a / 1e3)}k`;
    return `${sign}${Math.round(a)}`;
  }

  function niceTicks(min, max) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / 3;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw);
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    return { lo, hi, ticks };
  }

  // series: [{ key, label, cls }]; kind: 'line' | 'bar'. Hover data lives in ui.charts[id].
  function chart(id, rows, series, kind, refs = []) {
    const vals = rows.flatMap((r) => series.map((s) => r[s.key])).filter((v) => v != null);
    if (!vals.length) return '<div class="muted">No data yet.</div>';
    const { lo, hi, ticks } = niceTicks(Math.min(0, ...vals, ...refs.map((r) => r.v)), Math.max(0, ...vals));
    const iw = CHART_W - PAD.l - PAD.r;
    const ih = CHART_H - PAD.t - PAD.b;
    const n = rows.length;
    const slot = iw / n;
    const x = (i) => PAD.l + slot * (i + 0.5);
    const y = (v) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;

    let g = '';
    for (const v of ticks) {
      g += `<line class="grid${v === 0 ? ' zero' : ''}" x1="${PAD.l}" x2="${CHART_W - PAD.r}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="tick" x="${PAD.l - 4}" y="${y(v) + 3}" text-anchor="end">${fmtShort(v)}</text>`;
    }
    for (const r of refs) {
      g += `<line class="ref" x1="${PAD.l}" x2="${CHART_W - PAD.r}" y1="${y(r.v)}" y2="${y(r.v)}"/>
        <text class="tick" x="${CHART_W - PAD.r}" y="${y(r.v) - 3}" text-anchor="end">${r.label}</text>`;
    }
    g += `<text class="tick" x="${x(0)}" y="${CHART_H - 4}" text-anchor="start">${rows[0].label}</text>`;
    if (n > 1) g += `<text class="tick" x="${x(n - 1)}" y="${CHART_H - 4}" text-anchor="end">Today</text>`;

    if (kind === 'bar') {
      const key = series[0].key;
      const bw = Math.max(2, Math.min(18, slot - 2));
      rows.forEach((r, i) => {
        const v = r[key];
        if (!v) return;
        const top = y(Math.max(0, v));
        const h = Math.max(1, Math.abs(y(v) - y(0)));
        g += `<rect class="bar ${v >= 0 ? 'gain' : 'loss'}" x="${x(i) - bw / 2}" y="${top}" width="${bw}" height="${h}" rx="2"/>`;
      });
    } else {
      for (const s of series) {
        const pts = rows.map((r, i) => (r[s.key] == null ? null : `${x(i)},${y(r[s.key])}`)).filter(Boolean);
        if (pts.length > 1) g += `<polyline class="line ${s.cls}" points="${pts.join(' ')}"/>`;
        const last = rows.length - 1;
        if (rows[last][s.key] != null) g += `<circle class="dot ${s.cls}" cx="${x(last)}" cy="${y(rows[last][s.key])}" r="3.5"/>`;
      }
    }
    g += `<line class="crosshair" y1="${PAD.t}" y2="${PAD.t + ih}" x1="-10" x2="-10"/>`;

    ui.charts[id] = { rows, series, n, slot };
    const legend = series.length > 1
      ? `<div class="legend">${series.map((s) => `<span><i class="${s.cls}"></i>${s.label}</span>`).join('')}</div>`
      : '';
    return `${legend}<svg class="chart" data-chart="${id}" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img"
      aria-label="${series.map((s) => s.label).join(', ')} over the last ${n} days">${g}</svg>`;
  }

  function chartHover(e) {
    const svg = e.target.closest && e.target.closest('svg.chart');
    const tip = $('chart-tip');
    if (!svg) { tip.hidden = true; return; }
    const c = ui.charts[svg.dataset.chart];
    if (!c) return;
    const box = svg.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * CHART_W;
    const i = Math.min(c.n - 1, Math.max(0, Math.floor((sx - PAD.l) / c.slot)));
    const r = c.rows[i];
    const cx = PAD.l + c.slot * (i + 0.5);
    const line = svg.querySelector('.crosshair');
    line.setAttribute('x1', cx);
    line.setAttribute('x2', cx);
    line.style.opacity = 1;
    tip.innerHTML = `<b>${r.label}</b>${c.series.map((s) => `<div><i class="${s.cls}"></i>${s.label}
      <span>${r[s.key] == null ? '–' : G.fmtMoney(r[s.key])}</span></div>`).join('')}`;
    tip.hidden = false;
    const tx = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 12);
    tip.style.left = `${tx}px`;
    tip.style.top = `${e.clientY + 12}px`;
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

    const rows = financeRows();
    h += `<div class="panel"><h3>Cash balance (CHF)</h3>
      ${chart('cash', rows, [{ key: 'cash', label: 'Cash', cls: 's-cash' }], 'line',
        [{ v: C.bankruptcyLimit, label: 'Bankruptcy' }])}
      <h4>Revenue vs costs per day</h4>
      ${chart('flow', rows, [{ key: 'revenue', label: 'Revenue', cls: 's-rev' }, { key: 'costs', label: 'Costs', cls: 's-cost' }], 'line')}
      <h4>Daily result</h4>
      ${chart('net', rows, [{ key: 'net', label: 'Result', cls: 's-net' }], 'bar')}
      <div class="muted">Costs include weekly fixed charges. Hover a chart for exact values.</div></div>`;

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
    refreshPlanes();
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
      case 'fare': G.changeFare(el.dataset.from, el.dataset.to, Number(el.dataset.dir)); break;
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
    $('sidebar').addEventListener('mousemove', chartHover);
    $('sidebar').addEventListener('mouseleave', () => { $('chart-tip').hidden = true; });
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
