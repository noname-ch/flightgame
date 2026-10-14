// Map + sidebar rendering and input handling.
(function () {
  const G = FG.game;
  const C = FG.config;
  const D = FG.data;

  const TICK_MS = 100;
  // A tick moves the game on by the real time since the last one, but by no more than this: after a
  // longer stall (busy page, laptop asleep) the game slows down instead of jumping ahead.
  const MAX_STEP_MS = 250;
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
    areas: {}, // what was last drawn where, see drawnArea
    map: null,
    airportMarkers: {},
    planeMarkers: {},
    townMarkers: [], // { t, m }
    townLayer: null,
    runwayLayer: null,
    buildMode: false, // next map click picks the site of a new airport
    catchmentLayer: null,
    routeLayer: null,
    selectRing: null,
    shownAirport: null, // airport the catchment overlay is currently drawn for
    hoverAirport: null,
    tab: null, // open sidebar section, null = closed
    follow: null, // plane the 2D map follows
    hoverCard: null, // plane under the mouse in the bottom strip
    speed: 1, // multiple of real time
    paused: false,
    pendingMinutes: 0, // fractional game minutes carried between ticks
    lastTick: 0, // performance.now() of the last game tick
    selectedAirport: null,
    selectedPlane: null,
    newsPaused: false, // game paused because a newspaper is open
    wasPaused: false, // pause state before the newspaper opened
    confirmDispose: null, // planeId waiting for a second click on Sell/Return
    pointerDown: false,
    selectOpen: false,
    selectValues: {}, // dropdown id -> chosen value, survives re-renders
  };

  const $ = (id) => document.getElementById(id);
  const in3d = () => !!(FG.view3d && FG.view3d.on);
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
  // Esri's canvas tiles stop at zoom 16; beyond that Leaflet scales them up.
  const TILE_OPTS = {
    attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    maxZoom: C.map.maxZoom, maxNativeZoom: 16,
  };
  const tiles = (service, opts) => L.tileLayer(tileUrl(service), Object.assign({}, TILE_OPTS, opts));
  const BASEMAP_KEY = 'flightgame.basemap';
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

  // The aircraft type seen from above, pointing north, for a line of text: its own shape (models/icons/,
  // made by tools/hangar_shots.html from the 3D model) or the generic one. The shape is a mask that takes
  // the text colour. (The map markers are pictures of the 3D model, see js/icons3d.js.)
  function planeGlyph(type) {
    const file = D.models && D.models[type];
    if (!file) return PLANE_SVG;
    const url = `url(models/icons/${D.typeSlug(type)}.webp)`;
    return `<span class="plane-shape"><i style="-webkit-mask-image:${url};mask-image:${url}"></i></span>`;
  }

  const TOWN_STYLE = { color: '#fff', weight: 1, fillColor: COLORS.gray, fillOpacity: 0.75 };
  const TOWN_IN_CATCHMENT = { color: '#fff', weight: 1, fillColor: COLORS.orange, fillOpacity: 1 };

  const LEGEND = `<details class="map-legend leaflet-bar"><summary>Legend</summary>
    <div><i class="dot own"></i>Your slot (★ home base)</div>
    <div><i class="dot stake"></i>You own shares (no slot)</div>
    <div><i class="dot ap"></i>Airport · bigger = larger hub</div>
    <div><i class="dot town"></i>Town · bigger = more people</div>
    <div><i class="dot catch"></i>Town feeding the selected airport</div>
    <div><i class="line active"></i>Schedule running</div>
    <div><i class="line paused"></i>Schedule paused</div>
    <div><i class="line draft"></i>Schedule being edited</div>
    <div><i class="line ferry"></i>Ferry flight</div>
    <div><i class="alt-scale"></i>Selected flight's track: ground → FL400</div>
    <div><i class="rw"></i>Runway (zoom in) · <i class="rw build"></i>under construction</div>
  </details>`;

  // Markers shrink when zoomed out so Europe doesn't turn into one blob.
  const zoomScale = () => Math.min(1.5, Math.max(0.6, 0.6 + (ui.map.getZoom() - 3) * 0.2));
  const airportRadius = (a) => (a.extra ? 2 + G.airportSize(a.code) - (a.minor ? 1 : 0) : 4 + G.airportSize(a.code)) * zoomScale();
  const townRadius = (t) => Math.max(2.5, Math.sqrt(t.pop) / 450) * zoomScale();

  // With thousands of airports and towns only the ones that matter at this zoom are on the map.
  // Hand-made airports (airports.js) always show; generated ones appear as you zoom in, big hubs
  // earlier outside Europe, where there are no hand-made ones.
  const inEurope = (a) => a.lat >= 25 && a.lat <= 75 && a.lon >= -40 && a.lon <= 50;
  function airportMinZoom(a) {
    if (!a.extra) return 0;
    if (a.minor) return 9;
    return (inEurope(a) ? [9, 8, 7, 7, 6, 5] : [9, 8, 7, 6, 4, 2])[G.airportSize(a.code)];
  }
  const townMinPop = (z) => (z <= 3 ? 1000000 : z === 4 ? 400000 : z === 5 ? 150000 : z === 6 ? 60000 : z === 7 ? 30000 : 0);

  // Great-circle path between two airports as a list of [lat, lon]. Longitudes are unwrapped
  // so a Pacific crossing runs past ±180° instead of jumping across the whole map.
  // Track points [lat, lon] with longitudes unwrapped at ±180°.
  function unwrapped(pts) {
    const out = [];
    for (const q of pts) {
      const p = [q[0], q[1]];
      if (out.length) {
        const prev = out[out.length - 1][1];
        while (p[1] - prev > 180) p[1] -= 360;
        while (p[1] - prev < -180) p[1] += 360;
      }
      out.push(p);
    }
    return out;
  }

  function arc(a, b) {
    const n = Math.max(2, Math.ceil(G.distanceKm(a, b) / 150));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const p = G.interpolate(a, b, i / n);
      if (pts.length) {
        const prev = pts[pts.length - 1][1];
        while (p[1] - prev > 180) p[1] -= 360;
        while (p[1] - prev < -180) p[1] += 360;
      }
      pts.push(p);
    }
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

  // 2D follow: the map stays centred on the plane until you drag it.
  function setFollow2d(id) {
    if (ui.follow === id) return;
    ui.follow = id;
    const badge = $('follow-badge');
    if (badge) badge.remove();
    if (!id) return;
    const p = G.plane(id);
    const pos = planePosition(p);
    ui.map.setView(pos.latlng, Math.max(ui.map.getZoom(), pos.ground ? 14 : 8));
    const el = document.createElement('div');
    el.id = 'follow-badge';
    el.innerHTML = `🎥 Following <b>${id}</b> <button class="mini" title="Stop following">✕</button>`;
    el.querySelector('button').onclick = () => setFollow2d(null);
    $('map').appendChild(el);
  }

  // Follow a plane in whichever view is open.
  function follow(id) {
    ui.selectedPlane = id;
    G.dirty = true;
    if (FG.view3d && FG.view3d.on && FG.view3d.setFollow) { FG.view3d.setFollow(true); return; }
    setFollow2d(id);
  }

  function initMap() {
    const map = ui.map = L.map('map', {
      minZoom: C.map.minZoom,
      maxZoom: C.map.maxZoom,
      maxBounds: C.map.bounds,
      maxBoundsViscosity: 0.8,
    }).setView(C.map.center, C.map.zoom);

    // Stacking: tiles < towns + catchment < routes < airports < planes.
    map.createPane('towns').style.zIndex = 350;
    map.createPane('runways').style.zIndex = 370;
    map.createPane('gates').style.zIndex = 375;
    map.createPane('rivals').style.zIndex = 380;
    map.createPane('routes').style.zIndex = 390;

    const base = {
      Standard: new TintedTiles(tileUrl('Canvas/World_Light_Gray_Base'), TILE_OPTS),
      Dark: tiles('Canvas/World_Dark_Gray_Base'),
      Satellite: tiles('World_Imagery', { maxNativeZoom: 18 }),
    };
    // Satellite unless the player picked another base map before.
    let baseName = 'Satellite';
    try { baseName = localStorage.getItem(BASEMAP_KEY) || baseName; } catch (e) { /* private mode */ }
    if (!base[baseName]) baseName = 'Satellite';
    base[baseName].addTo(map);
    map.getContainer().classList.toggle('map-dark', baseName !== 'Standard');
    // City names; off by default because they collide with the airport dots.
    const names = tiles(NAME_TILES[baseName], { zIndex: 2 });
    map.on('baselayerchange', (e) => {
      names.setUrl(tileUrl(NAME_TILES[e.name]));
      map.getContainer().classList.toggle('map-dark', e.name !== 'Standard');
      try { localStorage.setItem(BASEMAP_KEY, e.name); } catch (err) { /* private mode */ }
    });

    ui.townLayer = L.layerGroup().addTo(map);
    ui.catchmentLayer = L.layerGroup().addTo(map);
    ui.routeLayer = L.layerGroup().addTo(map);

    ui.runwayLayer = L.layerGroup().addTo(map);
    ui.gateLayer = L.layerGroup().addTo(map);
    ui.rivalRenderer = L.canvas({ pane: 'rivals', padding: 0.2 });
    ui.rivalRoutes = L.layerGroup();
    ui.rivalPlanes = L.layerGroup();
    ui.rivalLayer = L.layerGroup([ui.rivalRoutes, ui.rivalPlanes]).addTo(map);
    ui.rivalDots = [];
    const townRenderer = L.canvas({ pane: 'towns' });
    for (const t of D.towns) {
      const m = L.circleMarker([t.lat, t.lon], Object.assign({ pane: 'towns', renderer: townRenderer }, TOWN_STYLE))
        .bindTooltip(`${t.name} · ${fmtPop(t.pop)}`);
      ui.townMarkers.push({ t, m });
    }

    for (const f of D.factories) {
      L.marker([f.lat, f.lon], {
        icon: L.divIcon({ className: 'factory-icon', html: '🏭', iconSize: [18, 18], iconAnchor: [9, 9] }),
      }).bindTooltip(`<b>${f.code}</b> · ${f.name}`)
        .addTo(map);
    }


    L.control.scale({ imperial: false }).addTo(map);
    // Base map and layers are switched in Settings (menu ⋯).
    ui.base = base;
    ui.baseName = baseName;
    ui.overlays = { Towns: ui.townLayer, Routes: ui.routeLayer, 'Rival airlines': ui.rivalLayer, 'Place names': names };
    ui.names = names;
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
      ui.legend = box.firstChild;
      return box.firstChild;
    });

    map.on('zoomend', () => { resizeMarkers(); drawRoutes(); });
    map.on('moveend', viewChanged);
    map.on('dragstart', () => setFollow2d(null));
    map.on('click', (e) => {
      if (FG.airportEdit && FG.airportEdit.on) return; // the airport editor has the clicks (js/airportedit.js)
      if (ui.buildMode) { buildAt(e.latlng); return; }
      if (!ui.selectedAirport && !ui.selectedPlane) return;
      ui.selectedAirport = null;
      ui.selectedPlane = null;
      G.dirty = true;
    });
    updateVisible();
    resizeMarkers();
  }

  // Airports, towns and runways for the new view; at most four times a second, as following a plane
  // moves the map every frame.
  function viewChanged() {
    if (ui.viewTimer) { ui.viewAgain = true; return; }
    updateVisible();
    drawRunways();
    ui.viewTimer = setTimeout(() => {
      ui.viewTimer = null;
      if (ui.viewAgain) { ui.viewAgain = false; viewChanged(); }
    }, 250);
  }

  function createAirportMarker(a) {
    const m = L.circleMarker([a.lat, a.lon], {
      color: '#fff', weight: 2, fillOpacity: 1, className: 'ap-dot', bubblingMouseEvents: false,
    });
    m.bindTooltip(`<b>${a.code}</b><span class="city"> · ${a.city}</span>`, {
      permanent: true, direction: 'right', className: 'ap-label',
    });
    m.on('click', () => {
      if (ui.buildMode) return;
      ui.selectedAirport = a.code;
      if (phone.matches) panIntoView(m.getLatLng()); // or the sheet that opens would cover it
      G.dirty = true;
    });
    m.on('mouseover', () => { ui.hoverAirport = a.code; m.setRadius(airportRadius(a) + 2); updateLabel(a); });
    m.on('mouseout', () => { ui.hoverAirport = null; m.setRadius(airportRadius(a)); updateLabel(a); });
    ui.airportMarkers[a.code] = m;
    return m;
  }

  // Add/remove airport and town markers for the current view.
  // The area last drawn for `key` (markers, runways, gates) still covers the view at the same zoom and
  // `sig`: then a small pan, or following a plane, needs nothing new. Else it becomes the view padded by `pad`.
  function drawnArea(key, sig, pad) {
    const bounds = ui.map.getBounds();
    const a = ui.areas[key];
    if (a && a.sig === sig && a.box.contains(bounds)) return null;
    const box = bounds.pad(pad);
    ui.areas[key] = { sig, box };
    return box;
  }

  function updateVisible() {
    const map = ui.map;
    const z = map.getZoom();
    const s = G.state;
    const important = new Set(Object.keys(s.slots));
    for (const [code, inf] of Object.entries(s.infra)) if (inf.stake > 0) important.add(code);
    if (ui.selectedAirport) important.add(ui.selectedAirport);
    const view = drawnArea('airports', `${z}|${[...important].join()}|${D.airports.length}|${s.projects.length}`, 0.3);
    if (!view) return;
    for (const code of Object.keys(ui.airportMarkers)) {
      if (!G.airportByCode[code]) { // gone after a new game
        ui.airportMarkers[code].remove();
        delete ui.airportMarkers[code];
      }
    }
    for (const a of D.airports) {
      const show = important.has(a.code) || a.built || (view.contains([a.lat, a.lon]) && z >= airportMinZoom(a));
      let m = ui.airportMarkers[a.code];
      if (show && !m) m = createAirportMarker(a);
      if (!m) continue;
      const on = map.hasLayer(m);
      if (show && !on) {
        m.addTo(map);
        styleAirport(a);
        sizeAirport(a);
      } else if (!show && on) m.remove();
    }
    const minPop = townMinPop(z);
    for (const { t, m } of ui.townMarkers) {
      const show = t.pop >= minPop && view.contains([t.lat, t.lon]);
      const on = ui.townLayer.hasLayer(m);
      if (show && !on) ui.townLayer.addLayer(m.setRadius(townRadius(t)));
      else if (!show && on) ui.townLayer.removeLayer(m);
    }
  }

  // ---------- runways ----------
  // The airports for the runways and gates in `view`, padded by ~8 km (as in 3D): zoomed in on a far corner of
  // a big airport, its reference point is off screen, but its runways and aprons must stay.
  function airportsNear(view) {
    const pad = 0.075;
    const s = view.getSouth() - pad, n = view.getNorth() + pad;
    const kLon = pad / Math.max(0.2, Math.cos((Math.max(Math.abs(s), Math.abs(n)) * Math.PI) / 180));
    const w = view.getWest() - kLon, e = view.getEast() + kLon;
    return D.airports.filter((a) => a.lat >= s && a.lat <= n && a.lon >= w && a.lon <= e);
  }

  // Metres per screen pixel at a latitude, so thin runways stay visible.
  const metresPerPixel = (lat) => (40075016 * Math.cos((lat * Math.PI) / 180)) / 2 ** (ui.map.getZoom() + 8);

  function runwayCorners(r, minPx) {
    const lat = (r[0] + r[2]) / 2;
    const half = Math.max(r[4], minPx * metresPerPixel(lat)) / 2;
    const h = G.bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] });
    const side = ((h + 90) * Math.PI) / 180;
    const dLat = (half * Math.cos(side)) / 111320;
    const dLon = (half * Math.sin(side)) / (111320 * Math.cos((lat * Math.PI) / 180));
    return [[r[0] + dLat, r[1] + dLon], [r[2] + dLat, r[3] + dLon], [r[2] - dLat, r[3] - dLon], [r[0] - dLat, r[1] - dLon]];
  }

  // Runway number seen when landing on heading h (e.g. 265° → "27").
  const designator = (h) => String(Math.round(((h % 360) + 360) % 360 / 10) || 36).padStart(2, '0');

  function drawRunway(code, r, building) {
    const z = ui.map.getZoom();
    const pick = () => { ui.selectedAirport = code; G.dirty = true; };
    const poly = L.polygon(runwayCorners(r, 3), building
      ? { pane: 'runways', color: COLORS.orange, weight: 2, dashArray: '6 5', fillColor: COLORS.orange, fillOpacity: 0.25, bubblingMouseEvents: false }
      : { pane: 'runways', color: '#fff', weight: z >= 14 ? 1.5 : 1, fillColor: r[5] ? '#4b5563' : '#7fae5f', fillOpacity: 1, bubblingMouseEvents: false });
    const len = Math.round(G.runwayLength(r));
    poly.bindTooltip(`${code} · ${len.toLocaleString('de-CH')} m ${r[5] ? 'paved' : 'grass'}${building ? ' · under construction' : ''}`, { sticky: true })
      .on('click', pick).addTo(ui.runwayLayer);
    if (z < 14 || building || G.runwayLength(r) < 800) return;
    if (r[5]) {
      L.polyline([[r[0], r[1]], [r[2], r[3]]], { pane: 'runways', interactive: false, color: '#fff', weight: 1, dashArray: '10 10' })
        .addTo(ui.runwayLayer);
    }
    const h = G.bearing({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] });
    const ends = [[0.06, designator(h)], [0.94, designator(h + 180)]];
    for (const [f, label] of ends) {
      L.marker([r[0] + (r[2] - r[0]) * f, r[1] + (r[3] - r[1]) * f], {
        pane: 'runways', interactive: false,
        icon: L.divIcon({ className: 'rw-num', html: label, iconSize: [22, 14], iconAnchor: [11, 7] }),
      }).addTo(ui.runwayLayer);
    }
  }

  // ---------- gates ----------
  // Holding positions (as in view3d.js): where the taxiway stretch p -> q comes up to runway r, two yellow bars
  // across it, `width` metres long, 40-90 m from the runway's centre line by its width.
  function holdBars(r, p, q, width) {
    const W = Math.max(18, r[4] || 30);
    const hold = W >= 45 ? 90 : W >= 30 ? 60 : 40;
    const kx = 111320 * Math.cos((r[0] * Math.PI) / 180);
    const dx = (r[3] - r[1]) * kx, dy = (r[2] - r[0]) * 111320;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const of = (pt) => { const x = (pt[1] - r[1]) * kx, y = (pt[0] - r[0]) * 111320; return [x * ux + y * uy, x * uy - y * ux]; };
    const c = of(p), d = of(q);
    const bars = [];
    for (const s of [-1, 1]) {
      if ((c[1] - s * hold) * (d[1] - s * hold) >= 0) continue; // does not cross the line
      const t = (s * hold - c[1]) / (d[1] - c[1]);
      const along = c[0] + t * (d[0] - c[0]);
      if (along < -30 || along > len + 30) continue;
      const m = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
      const away = c[1] * s > d[1] * s ? p : q; // the end of the stretch that is further from the runway
      const mx = 111320 * Math.cos((m[0] * Math.PI) / 180);
      const ax = (away[1] - m[1]) * mx, ay = (away[0] - m[0]) * 111320;
      const dist = Math.hypot(ax, ay) || 1;
      const vx = ax / dist, vy = ay / dist; // metres, east and north, away from the runway
      const at = (along2, across) => [m[0] + (vy * along2 + vx * across) / 111320, m[1] + (vx * along2 - vy * across) / mx];
      for (const [k0, k1] of [[0, 0.9], [2.2, 3.1]]) bars.push([at(k0, -width / 2), at(k1, -width / 2), at(k1, width / 2), at(k0, width / 2)]);
    }
    return bars;
  }

  // Aprons: terminal, jet bridges, stand lead-in lines and stop bars (planes park and push back here).
  const GATE_ZOOM = 14;
  function drawGates() {
    const z = ui.map.getZoom();
    if (z < GATE_ZOOM) {
      if (ui.gateSig) { ui.gateLayer.clearLayers(); ui.gateSig = ''; delete ui.areas.gates; }
      return;
    }
    // (padded a lot: an apron can lie up to 3 km from the airport's reference point)
    const view = drawnArea('gates', `${z}|${FG.layouts ? `${FG.layouts.version}.${FG.layouts.looked}` : 0}|${FG.devPreview ? ui.selectedAirport : ''}|${D.airports.length}|${G.state.projects.length}`, 1);
    if (!view) return;
    const list = airportsNear(view).filter((a) => !a.factory);
    const sig = `${z}|${FG.layouts ? `${FG.layouts.version}.${FG.layouts.looked}` : 0}|${FG.devPreview ? ui.selectedAirport : ''}|${list.map((a) => `${a.code}:${G.airportSize(a.code)}:${G.airportRunways(a.code).length}`).join(',')}`;
    if (sig === ui.gateSig) return; // redrawn only when the view or an airport changes
    ui.gateSig = sig;
    ui.gateLayer.clearLayers();
    const quiet = { pane: 'gates', interactive: false };
    for (const a of list) {
      const ap = G.apronOf(a.code);
      // Its real layout is on the way: not the one the game makes up meanwhile (it would stand somewhere else).
      if (FG.layouts && FG.layouts.pending(a.code)) continue;
      // taxiways, aprons and buildings (the real ones where the airport has a layout from OpenStreetMap)
      const taxiways = G.drawnTaxiways(a.code); // (not across the aprons and pads)
      for (const tw of taxiways) L.polyline(tw, { ...quiet, color: '#4a515c', weight: z >= 16 ? 9 : 4, opacity: 1 }).addTo(ui.gateLayer);
      // (solid: the satellite's own planes and paint must not show through)
      for (const r of ap.aprons || [ap.apron]) L.polygon(r, { ...quiet, stroke: false, fillColor: '#3a4049', fillOpacity: 1 }).addTo(ui.gateLayer);
      // pads (airport fixes): open concrete, planes go straight across them to their stands
      for (const r of ap.pads || []) L.polygon(r, { ...quiet, color: '#cbd5e1', weight: 1, dashArray: '5 4', fillColor: '#6b7280', fillOpacity: 1 }).addTo(ui.gateLayer);
      // yellow centre lines, and the holding positions where a taxiway comes up to a paved runway
      const paved = z >= 15 ? G.airportRunways(a.code).filter((r) => r[5]) : [];
      const holdWidth = (G.airportSize(a.code) >= 3 ? 23 : 15) * 0.85; // (as wide as the taxiway in 3D)
      for (const tw of taxiways) {
        L.polyline(tw, { ...quiet, color: '#e3b70f', weight: z >= 18 ? 2 : 1, opacity: 1 }).addTo(ui.gateLayer);
        for (const r of paved) {
          for (let i = 1; i < tw.length; i++) {
            for (const bar of holdBars(r, tw[i - 1], tw[i], holdWidth)) L.polygon(bar, { ...quiet, stroke: false, fillColor: '#f2c40f', fillOpacity: 1 }).addTo(ui.gateLayer);
          }
        }
      }
      for (const b of ap.buildings) {
        const fill = { terminal: '#64748b', hall: '#6b7a90', roof: '#94a3b8', tower: '#cbd5e1', bridge: '#cbd5e1', road: '#3b4048', carpark: '#57606c', hangar: '#57606c', other: '#5b6470' }[b.kind];
        if (!fill) continue; // glazing, roof plant, masts and the like are too small to show from above
        L.polygon(b.ring, { ...quiet, color: '#e2e8f0', weight: b.kind === 'road' ? 0 : 1, fillColor: fill, fillOpacity: 1 }).addTo(ui.gateLayer);
      }
      // developer tools: where construction at the selected airport would go
      if (FG.devPreview && ui.selectedAirport === a.code) {
        const pv = G.expansionPreview(a.code);
        const plan = { ...quiet, color: '#22d3ee', weight: 2, dashArray: '6 5', fillColor: '#22d3ee', fillOpacity: 0.2 };
        for (const { r } of pv.runways) L.polyline([[r[0], r[1]], [r[2], r[3]]], { ...plan, weight: 7, opacity: 0.75 }).addTo(ui.gateLayer);
        for (const tw of pv.taxiways) L.polyline(tw, { ...plan, weight: 3 }).addTo(ui.gateLayer);
        for (const r of pv.aprons) L.polygon(r, plan).addTo(ui.gateLayer);
        for (const b of pv.buildings) L.polygon(b.ring, plan).addTo(ui.gateLayer);
        for (const st of pv.stands) L.polyline(st.lead, { ...plan, weight: 1.5 }).addTo(ui.gateLayer);
      }
      // (a real layout without a terminal has none: not the square game.js puts in for it)
      if (!ap.real || ap.real.terminals.length) {
        L.polygon(ap.terminal, { pane: 'gates', color: '#e2e8f0', weight: 1, fillColor: '#64748b', fillOpacity: 1, bubblingMouseEvents: false })
          .bindTooltip(`${a.code} terminal · ${ap.gates.length} gates with jet bridges · ${ap.stands.length - ap.gates.length} remote stands`, { sticky: true })
          .addTo(ui.gateLayer);
      }
      for (const mk of ap.markings || []) {
        L.polyline(mk.line, { ...quiet, color: mk.kind === 'w' ? '#e5e7eb' : '#facc15', weight: 1, opacity: 0.8 }).addTo(ui.gateLayer);
      }
      for (const st of ap.stands) {
        L.polyline(st.lead, { ...quiet, color: '#facc15', weight: 1.2, opacity: 0.85 }).addTo(ui.gateLayer);
        L.polyline(st.stopBar, { ...quiet, color: '#facc15', weight: 2.5 }).addTo(ui.gateLayer);
        if (st.bridgePoly) {
          L.polygon(st.bridgePoly, { ...quiet, color: '#e2e8f0', weight: 1, fillColor: '#94a3b8', fillOpacity: 1 }).addTo(ui.gateLayer);
        }
        if (z >= 16) {
          L.marker(st.lead[0], {
            ...quiet, icon: L.divIcon({ className: 'gate-label', html: st.name, iconSize: [26, 12], iconAnchor: [13, 6] }),
          }).addTo(ui.gateLayer);
        }
      }
    }
  }

  // Real runways (OurAirports) plus whatever the player built, from C.map.runwayZoom on.
  function drawRunways() {
    drawGates();
    const z = ui.map.getZoom();
    const projects = G.state.projects.map((p) => p.code + p.kind).join();
    const view = drawnArea('runways', `${z}|${projects}|${D.airports.length}`, 0.4);
    if (!view) return;
    const list = z < C.map.runwayZoom ? [] : airportsNear(view);
    // Redrawn only when the zoom, the airports in view or a construction site changes.
    const sig = `${z}|${list.map((a) => `${a.code}:${G.airportRunways(a.code).length}`).join()}|${projects}`;
    if (sig === ui.runwaySig) return;
    ui.runwaySig = sig;
    ui.runwayLayer.clearLayers();
    if (z < C.map.runwayZoom) return;
    for (const a of list) {
      for (const r of G.airportRunways(a.code)) drawRunway(a.code, r, false);
    }
    for (const p of G.state.projects) {
      const a = G.airportByCode[p.code];
      if (!view.contains([a.lat, a.lon])) continue;
      const planned = p.kind === 'airport'
        ? G.plannedRunway({ code: p.code, kind: 'runway', len: C.airports.newAirportRunway })
        : G.plannedRunway(p);
      if (planned) drawRunway(p.code, planned.runway, true);
      if (p.kind === 'terminal' || p.kind === 'airport') {
        L.marker([a.lat, a.lon], {
          pane: 'runways', interactive: false,
          icon: L.divIcon({ className: 'build-icon', html: '🏗', iconSize: [20, 20], iconAnchor: [-6, 22] }),
        }).addTo(ui.runwayLayer);
      }
    }
  }

  function buildAt(latlng) {
    ui.buildMode = false;
    ui.map.getContainer().classList.remove('build-mode');
    $('view3d').classList.remove('build-mode');
    const build = () => {
      const res = G.buildAirport(latlng.lat, latlng.lng);
      if (res && res.length !== 3) { toast(res, true); G.dirty = true; return; }
      ui.selectedAirport = res;
      toast(`Construction of ${G.airportByCode[res].name} started.`);
      G.dirty = true;
    };
    // Only where the terrain is fit for an airport: level, dry, not built on (FG.terrain in js/view3d.js;
    // without that module, or if the terrain cannot be looked up, anywhere).
    if (!FG.terrain) { build(); return; }
    toast('Checking the terrain there…');
    FG.terrain.check(latlng.lat, latlng.lng).then((reason) => {
      if (reason) { toast(reason, true); G.dirty = true; } else build();
    }, build);
  }

  function setBuildMode(on) {
    ui.buildMode = on;
    ui.map.getContainer().classList.toggle('build-mode', on);
    $('view3d').classList.toggle('build-mode', on);
    if (on) toast('Click on the map where the new airport should go (Esc to cancel).');
    G.dirty = true;
  }

  function fitNetwork() {
    const pts = Object.keys(G.state.slots).map((c) => [G.airportByCode[c].lat, G.airportByCode[c].lon]);
    ui.map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 6 });
  }

  function resizeMarkers() {
    for (const { t, m } of ui.townMarkers) m.setRadius(townRadius(t));
    for (const code of Object.keys(ui.airportMarkers)) sizeAirport(G.airportByCode[code]);
    if (ui.selectRing) ui.selectRing.setRadius(airportRadius(G.airportByCode[ui.selectedAirport]) + 5);
  }

  function sizeAirport(a) {
    const m = ui.airportMarkers[a.code];
    const r = airportRadius(a);
    m.setRadius(r);
    const tip = m.getTooltip();
    tip.options.offset = L.point(r - 2, 0); // keep the label clear of the dot
    tip.update();
    updateLabel(a);
  }

  function styleAirport(a) {
    const color = G.ownsSlot(a.code) ? COLORS.green : G.stake(a.code) > 0 ? COLORS.purple
      : a.built && !a.open ? COLORS.orange : a.minor ? COLORS.gray : COLORS.blue;
    const m = ui.airportMarkers[a.code];
    if (m.options.fillColor !== color) m.setStyle({ fillColor: color });
    updateLabel(a);
  }

  // Codes of small airports only appear when zoomed in; own, selected and hovered ones always show.
  function updateLabel(a) {
    const el = ui.airportMarkers[a.code].getTooltip().getElement();
    if (!el) return;
    const owned = G.ownsSlot(a.code);
    const selected = ui.selectedAirport === a.code;
    const hover = ui.hoverAirport === a.code;
    el.classList.toggle('owned', owned);
    el.classList.toggle('home', a.code === G.home());
    el.classList.toggle('selected', selected);
    el.classList.toggle('hover', hover);
    el.classList.toggle('hidden', !(owned || selected || hover ||
      ui.map.getZoom() >= C.map.labelZoom - G.airportSize(a.code) + (a.minor ? 1 : 0)));
  }

  function refreshAirports() {
    updateVisible();
    for (const code of Object.keys(ui.airportMarkers)) {
      if (ui.map.hasLayer(ui.airportMarkers[code])) styleAirport(G.airportByCode[code]);
    }
    drawCatchment();
    drawRunways();
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
    // Redrawn only when something on it changes: a schedule, the selection, a ferry or delivery flight,
    // the day (today's runways), or near the runways the zoom and the taxiways.
    const z = ui.map.getZoom();
    const sig = `${z >= 13 ? `${FG.layouts ? FG.layouts.version : 0}` : 'far'}|${Math.floor(G.state.time / 1440)}|${ui.selectedPlane}|` +
      G.state.planes.map((p) => {
        const f = p.status === 'flying' && (p.id === ui.selectedPlane || p.flight.kind !== 'scheduled') ? p.flight : null;
        const draft = FG.planner.draftStops(p.id);
        return `${p.id}${p.type}:${(draft || p.schedule.stops).join('-')}${draft ? 'd' : ''}${p.schedule.active ? 1 : 0}` +
          `${f ? `${f.kind}${f.from}${f.to}${f.dep}` : ''}${p.pendingFerry ? p.pendingFerry + p.location : ''}`;
      }).join(',');
    if (sig === ui.routeSig) return;
    ui.routeSig = sig;
    ui.routeLayer.clearLayers();
    const ap = (c) => G.airportByCode[c];
    // Selected plane last so its route ends up on top.
    const planes = G.state.planes.slice().sort((p, q) => (p.id === ui.selectedPlane) - (q.id === ui.selectedPlane));
    for (const p of planes) {
      const draft = FG.planner.draftStops(p.id);
      const stops = draft || p.schedule.stops;
      const selected = ui.selectedPlane === p.id;
      if (stops.length >= 2) {
        const pts = [];
        // Each leg as today's real track: runway into the wind, climb, cruise, approach.
        stops.forEach((c, i) => {
          const to = stops[(i + 1) % stops.length];
          pts.push(...(c === to ? [] : unwrapped(G.legTrack(p.type, c, to).pts)));
        });
        const weight = (selected ? 5 : 3) * (ui.map.getZoom() >= 13 ? 0.5 : 1); // thin near runways
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
      if (selected && p.status === 'flying') drawTrack(p);
      if (p.flight && p.flight.kind === 'delivery') {
        L.polyline(unwrapped(G.flightTrack(p).pts), { pane: 'routes', interactive: false, color: '#16a34a', weight: 2.5, dashArray: '2 7' })
          .addTo(ui.routeLayer);
      }
      const ferryTo = p.pendingFerry || (p.flight && p.flight.kind === 'ferry' ? p.flight.to : null);
      if (ferryTo) {
        const ferryPts = p.flight && p.flight.kind === 'ferry' ? unwrapped(G.flightTrack(p).pts)
          : arc(ap(p.flight ? p.flight.from : p.location), ap(ferryTo));
        L.polyline(ferryPts, {
          pane: 'routes', bubblingMouseEvents: false,
          color: COLORS.purple, weight: selected ? 4 : 2.5, opacity: 1, dashArray: '7 7',
        }).bindTooltip(`${p.id}: ferry to ${ferryTo}`, { sticky: true })
          .on('click', () => selectPlane(p.id)).addTo(ui.routeLayer);
      }
    }
  }

  // Game time with the fraction since the last tick, so planes move smoothly even at real time
  // (where a whole game minute takes 600 ticks). The tick adds exactly this much (see loop), so the
  // time runs on evenly across ticks instead of stalling or jumping when a tick comes late or early.
  // Game time at the moment `at` (performance.now() scale; a frame's timestamp may lie just before the last tick).
  const nowMinutes = (at = performance.now()) => {
    const t = G.state.time + ui.pendingMinutes;
    if (ui.paused || st.open) return t;
    return t + Math.min(at - ui.lastTick, MAX_STEP_MS) * ui.speed / 60000;
  };

  // Flying planes follow their track (runway, climb, cruise, approach); parked ones sit at the airport.
  function planePosition(p, t = nowMinutes()) {
    if (p.status === 'flying') {
      const st = G.flightState(p, t);
      return { latlng: [st.lat, st.lon], heading: st.heading, alt: st.altFt, ground: st.altFt <= 0, st };
    }
    const g = G.gateOf(p.location, p.id);
    return { latlng: [g.lat, g.lon], heading: g.heading, alt: 0, ground: true, gate: g.name };
  }

  // Icon scale that draws a plane on the ground at its real length when zoomed in on an airport.
  // iconPx: length of the aircraft in the 28 px glyph (23 for the flat shape, less for a 3D picture).
  function groundScale(p, lat, iconPx = 23) {
    const len = (D.looks[p.type] && D.looks[p.type].len) || 35;
    return Math.max(0.3, Math.min(3.5, len / metresPerPixel(lat) / iconPx));
  }

  const PHASES = {
    pushback: 'pushing back', 'taxi-out': 'taxiing to runway', takeoff: 'taking off', climb: 'climbing', cruise: 'cruising',
    descent: 'descending', approach: 'on final', landing: 'landing', 'taxi-in': 'taxiing to the gate',
  };
  const fmtAlt = (ft) => (ft >= 10000 ? `FL${Math.round(ft / 100)}` : `${Math.round(ft / 100) * 100} ft`);

  // "FL370 · 830 km/h · cruising" for a flying plane.
  function flightText(p) {
    const st = G.flightState(p, nowMinutes());
    if (!st) return '';
    if (st.phase === 'pushback') return `pushing back · runway ${st.depRunway}`;
    if (st.phase === 'taxi-out') return `taxiing to runway ${st.depRunway}`;
    if (st.phase === 'taxi-in' || st.phase === 'landing') return `${PHASES[st.phase]} · runway ${st.arrRunway}`;
    if (st.phase === 'takeoff') return `taking off from runway ${st.depRunway} · ${st.speedKmh} km/h`;
    const where = st.phase === 'approach' ? ` runway ${st.arrRunway}` : '';
    return `${fmtAlt(st.altFt)} · ${st.speedKmh} km/h · ${PHASES[st.phase]}${where}`;
  }

  const planeTip = (p) => `<b>${p.id}</b> · ${planeStatus(p)}`;

  // Altitude colour for tracks: orange near the ground, green mid-level, teal/violet at cruise.
  const ALT_STOPS = [[0, [255, 149, 0]], [10000, [255, 204, 0]], [22000, [52, 199, 89]], [34000, [48, 176, 199]], [42000, [88, 86, 214]], [60000, [175, 82, 222]]];
  function altColor(ft) {
    let i = 1;
    while (i < ALT_STOPS.length - 1 && ft > ALT_STOPS[i][0]) i++;
    const [a0, c0] = ALT_STOPS[i - 1];
    const [a1, c1] = ALT_STOPS[i];
    const f = Math.min(1, Math.max(0, (ft - a0) / (a1 - a0)));
    return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * f)).join(',')})`;
  }

  // Full track of the selected plane's current flight, coloured by altitude.
  function drawTrack(p) {
    const tr = G.flightTrack(p);
    if (!tr) return;
    const band = (ft) => Math.round(ft / 2000);
    let run = [];
    let runBand = null;
    const flush = () => {
      if (run.length > 1) {
        L.polyline(run, { pane: 'routes', interactive: false, color: altColor(runBand * 2000), weight: ui.map.getZoom() >= 13 ? 2.5 : 3.5, opacity: 0.95 })
          .addTo(ui.routeLayer);
      }
    };
    const pts = unwrapped(tr.pts);
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      const b = band(tr.altAt(tr.cum[i]));
      if (runBand !== null && b !== runBand) {
        run.push(pt);
        flush();
        run = [run[run.length - 1]];
      } else run.push(pt);
      runBand = b;
    }
    flush();
  }

  function refreshPlanes() {
    for (const p of G.state.planes) {
      const m = ui.planeMarkers[p.id];
      if (m) m.setTooltipContent(planeTip(p));
    }
  }

  // Leaflet puts markers on whole pixels, so a plane that moves less than a pixel per frame stepped
  // instead of gliding. Plane markers go to the exact spot (z-index still a whole number).
  const PlaneMarker = L.Marker.extend({
    update() {
      if (this._icon && this._map) this._setPos(this._map.latLngToLayerPoint(this._latlng));
      return this;
    },
    _updateZIndex(offset) {
      if (this._icon) this._icon.style.zIndex = Math.round(this._zIndex + offset);
    },
  });

  // Plane markers. Every animation frame moves the flying ones (smooth at any game speed); a `tick`
  // (every 100 ms) also handles the parked ones, adds and removes markers, and updates tooltips.
  // Planes outside the view are taken off the map, so they cost nothing until they come back into it.
  function updatePlanes(tick) {
    const map = ui.map;
    if (tick) {
      for (const id of Object.keys(ui.planeMarkers)) {
        if (!G.plane(id)) {
          ui.planeMarkers[id].remove();
          delete ui.planeMarkers[id];
        }
      }
    }
    if (map._animatingZoom) return; // Leaflet places the markers itself during a zoom animation
    const t = nowMinutes(tick || ui.frameAt == null ? undefined : ui.frameAt); // (in a frame: at its timestamp)
    const z = map.getZoom();
    const view = map.getBounds().pad(0.15);
    const parked = {}; // airport code -> planes on the ground there so far
    for (const p of G.state.planes) {
      const flying = p.status === 'flying';
      if (!flying && !tick) continue;
      const pos = planePosition(p, t);
      if (ui.follow === p.id && !(map._panAnim && map._panAnim._inProgress)) map.panTo(pos.latlng, { animate: false });
      // Zoomed in on an airport, planes on the ground are drawn at their gate at real size;
      // further out, parked planes line up above their airport so it stays clickable.
      const close = pos.ground && z >= GATE_ZOOM;
      const n = flying || close ? 0 : (parked[p.location] = (parked[p.location] || 0) + 1) - 1;
      let m = ui.planeMarkers[p.id];
      if (!view.contains(pos.latlng)) {
        if (m && map.hasLayer(m)) m.remove();
        continue;
      }
      if (!m) {
        m = new PlaneMarker(pos.latlng, {
          icon: L.divIcon({ className: 'plane-icon', html: `<div class="plane">${PLANE_SVG}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
          zIndexOffset: 1000,
        }).bindTooltip(planeTip(p), { direction: 'top', offset: [0, -14] });
        m.on('click', () => selectPlane(p.id));
        ui.planeMarkers[p.id] = m;
      }
      if (!map.hasLayer(m)) m.setLatLng(pos.latlng).addTo(map);
      else if (flying || tick) m.setLatLng(pos.latlng);
      if (tick && flying && m.isTooltipOpen()) m.setTooltipContent(planeTip(p));
      const el = m.getElement();
      if (!el) continue;
      const glyph = el.firstElementChild; // a marker put back on the map gets a new element
      // The type's 3D model seen from above (js/icons3d.js) replaces the flat shape once it is rendered.
      const icon = FG.planeIcons && FG.planeIcons.get(p.type);
      if (icon && glyph.dataset.icon !== icon.url) {
        glyph.dataset.icon = icon.url;
        glyph.innerHTML = `<img src="${icon.url}" alt="" draggable="false">`;
      }
      // Higher planes look a little bigger and cast their shadow further away (in steps, as the
      // shadow filter is costly to change every frame).
      const h = Math.round(Math.min(1, pos.alt / 38000) * 20) / 20;
      const transform = close
        ? `rotate(${(pos.heading || 0).toFixed(1)}deg) scale(${groundScale(p, pos.latlng[0], icon ? 28 * icon.len : 23).toFixed(3)})`
        : flying
          ? `rotate(${(pos.heading || 0).toFixed(1)}deg) scale(${pos.ground ? 0.7 : 0.8 + 0.25 * h})`
          : `translate(${n * 13}px, -15px) scale(0.75)`;
      if (glyph.fgTransform !== transform) { glyph.fgTransform = transform; glyph.style.transform = transform; }
      const sh = flying && !pos.ground ? 1 + 7 * h : 1;
      const shadow = `drop-shadow(${sh * 0.7}px ${sh}px ${1 + sh * 0.4}px rgba(0, 0, 0, ${0.4 - 0.2 * h}))`;
      if (glyph.fgShadow !== shadow) { glyph.fgShadow = shadow; glyph.style.setProperty('--shadow', shadow); }
      glyph.classList.toggle('pushback', !!(pos.st && pos.st.phase === 'pushback'));
      glyph.classList.toggle('grounded', !flying || pos.ground);
      glyph.classList.toggle('selected', ui.selectedPlane === p.id);
    }
  }

  // ---------- header ----------
  function renderHeader() {
    const s = G.state;
    $('company').textContent = s.company;
    const badge = $('mode-badge');
    badge.textContent = `${G.mode().name} · ${G.difficulty().name}`;
    badge.className = s.mode;
    const money = $('money');
    money.textContent = G.fmtMoney(s.money);
    money.classList.toggle('negative', s.money < 0);
    const day = Math.floor(s.time / 1440);
    $('clock-time').textContent = G.fmtClock(s.time);
    $('clock-day').textContent = G.fmtTime(s.time).replace(/ \d\d:\d\d$/, '');
    $('pause').classList.toggle('active', ui.paused);
    $('speed-btn').classList.toggle('paused', ui.paused);
    $('speed-label').textContent = ui.paused ? 'Paused' : ui.speed === 1 ? 'Real time' : fmtSpeed(ui.speed);
    $('gameover').hidden = !s.gameOver;
    if (day !== ui.shownDay) { ui.shownDay = day; G.dirty = true; } // the day plan's "now" line
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
      h += `<tr><td>${a} ↔ ${b}</td><td>${G.paxDemand(a, b, PROBE_SEATS)}${rivalBadge(a, b)}</td>${fareCell(a, b)}</tr>`;
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
      <div class="muted">${a.city}, ${a.country} · size ${sizeDots(G.airportSize(code))}${a.minor ? ' · airfield' : ''}</div>
      <div>Catchment: <b>${fmtPop(G.catchment(code))}</b> people · landing fee ${G.fmtMoney(G.landingFee(code))}</div>
      <div>${runwayText(code)}</div>${rivalsAt(code)}`;
    if (a.built && !a.open) h += `<div class="warn">🏗 Under construction – opens ${openDate(code)}.</div>`;

    if (!a.built || a.open) h += `<h4>Slots</h4>${FG.planner.slotMarket(code)}`;

    if (owned) {
      for (const p of s.planes) {
        if ((p.location !== code || p.status === 'flying') && G.fitsAirport(p.type, code)) {
          h += ` <button data-action="sendPlane" data-plane="${p.id}" data-code="${code}">Send ${p.id} here</button>`;
        }
      }
      const ed = FG.planner.editing();
      if (ed) h += ` <button class="primary" data-action="planAdd" data-code="${code}">Add ${code} to ${ed}'s timetable</button>`;
    }

    const others = Object.keys(s.slots).filter((c) => c !== code);
    if (others.length) {
      h += `<table class="small"><tr><th>From your slot</th><th>km</th><th>pax/day</th><th>ticket</th></tr>`;
      for (const o of others) {
        const d = G.dist(o, code);
        h += `<tr><td>${o} → ${code}</td><td>${Math.round(d)}</td><td>${G.paxDemand(o, code, PROBE_SEATS)}${rivalBadge(o, code)}</td>
          ${fareCell(o, code)}</tr>`;
      }
      h += `</table>`;
    }
    return h + sharesSection(code) + constructionSection(code) + `</div>`;
  }

  function runwayText(code) {
    const rws = G.airportRunways(code).slice().sort((x, y) => G.runwayLength(y) - G.runwayLength(x));
    if (!rws.length) return '<span class="muted">No runway data</span>';
    const list = rws.slice(0, 4).map((r) => `${Math.round(G.runwayLength(r)).toLocaleString('de-CH')} m${r[5] ? '' : ' grass'}`);
    return `Runway${rws.length > 1 ? 's' : ''}: ${list.join(' · ')}${rws.length > 4 ? ` · +${rws.length - 4}` : ''}
      <a href="#" data-action="zoomRunways" data-code="${code}" class="muted">zoom in</a>`;
  }

  function openDate(code) {
    const p = G.state.projects.find((x) => x.code === code);
    return p ? G.fmtTime(p.done).replace(/ \d\d:\d\d$/, '') : 'soon';
  }

  // Buy/sell airport shares, with value and dividend estimate.
  function sharesSection(code) {
    const a = G.airportByCode[code];
    if (a.factory) return '';
    const A = C.airports;
    const st = G.stake(code);
    const value = G.airportValue(code);
    const weekly = G.airportProfit(code);
    const step = Math.min(A.shareStep, 100 - st);
    let h = `<h4>Shares</h4>
      <div>Value ${G.fmtMoney(value)} · profit ≈ ${G.fmtMoney(weekly)}/week · ${fmtPop(G.airportPaxYear(code))} pax/year</div>`;
    if (st) {
      h += `<div>You own <b>${st}%</b> (worth ${G.fmtMoney(G.shareSale(code, st))}) · dividend ≈
        <b class="pos">${G.fmtMoney(weekly * A.payout * st / 100)}</b>/week</div>`;
    }
    h += `<div class="row">`;
    if (step > 0) {
      const cost = G.sharePrice(code, step);
      h += `<button class="primary" data-action="buyShares" data-code="${code}" ${G.state.money < cost ? 'disabled' : ''}>
        Buy ${step}% · ${G.fmtMoney(cost)}</button>`;
    }
    if (st) h += `<button data-action="sellShares" data-code="${code}">Sell ${Math.min(A.shareStep, st)}% · ${G.fmtMoney(G.shareSale(code, Math.min(A.shareStep, st)))}</button>`;
    h += `</div><div class="hint">${A.boardStake}%: order runways and terminals · ${A.majorityStake}%: no weekly slot fee here.</div>`;
    return h;
  }

  function constructionSection(code) {
    const p = G.state.projects.find((x) => x.code === code);
    let h = `<h4>Construction</h4>`;
    if (p) {
      const frac = Math.min(1, (G.state.time - p.start) / (p.done - p.start));
      return h + `<div>🏗 ${p.label}</div><div class="progress"><i style="width:${Math.round(frac * 100)}%"></i></div>
        <div class="muted">${Math.round(frac * 100)}% · ready ${G.fmtTime(p.done)}</div>`;
    }
    const opts = G.projectOptions(code);
    if (!opts.length) return '';
    if (G.stake(code) < C.airports.boardStake) {
      return h + `<div class="muted">Own ${C.airports.boardStake}% of the airport to build runways and terminals.</div>`;
    }
    const share = G.stake(code) < 100 ? ` <span class="muted">(your ${G.stake(code)}% share of the cost)</span>` : '';
    const runways = opts.filter((o) => o.kind === 'runway');
    h += `<div class="row"><select id="rw-${code}">`;
    for (const o of runways) {
      h += `<option value="${o.len}:${o.orient}">${o.label} · ${G.fmtMoney(o.cost)} · ${o.weeks} wk</option>`;
    }
    h += `</select><button data-action="buildRunway" data-code="${code}">Build</button></div>`;
    for (const o of opts.filter((x) => x.kind !== 'runway')) {
      h += `<div class="row"><button data-action="project" data-kind="${o.kind}" data-code="${code}"
        ${o.err || G.state.money < o.cost ? 'disabled' : ''}>${o.label} · ${G.fmtMoney(o.cost)} · ${o.weeks} wk</button>
        ${o.err ? `<span class="muted">${o.err}</span>` : ''}</div>`;
    }
    return h + `<div class="hint">Costs${share}. Longer runways take bigger aircraft, terminals raise the size and draw more passengers.</div>`;
  }

  // ---------- airports tab: shares, construction, new airports ----------
  function airportsTab() {
    const s = G.state;
    const A = C.airports;
    const held = Object.keys(s.infra).filter((c) => G.stake(c) > 0);
    let h = `<div class="panel"><h3>Your airport shares</h3>`;
    if (held.length) {
      let total = 0;
      h += `<table class="small"><tr><th>Airport</th><th>stake</th><th>worth</th><th>div./wk</th></tr>`;
      for (const c of held) {
        const st = G.stake(c);
        const d = G.airportProfit(c) * A.payout * st / 100;
        total += d;
        h += `<tr class="click" data-action="selectAirport" data-code="${c}"><td>${c} · ${G.airportByCode[c].city}</td>
          <td>${st}%</td><td>${G.fmtMoney(G.shareSale(c, st))}</td><td class="pos">${G.fmtMoney(d)}</td></tr>`;
      }
      h += `</table><div class="muted">Dividends ≈ ${G.fmtMoney(total)} paid every Monday.</div>`;
    } else {
      h += `<div class="muted">None yet. Click an airport on the map to buy shares – they pay a weekly dividend.</div>`;
    }
    h += `</div><div class="panel"><h3>Construction</h3>`;
    if (s.projects.length) {
      for (const p of s.projects) {
        const frac = Math.min(1, (s.time - p.start) / (p.done - p.start));
        h += `<div class="click" data-action="selectAirport" data-code="${p.code}">🏗 <b>${p.code}</b> ${p.label}
          <div class="progress"><i style="width:${Math.round(frac * 100)}%"></i></div>
          <div class="muted">ready ${G.fmtTime(p.done)}</div></div>`;
      }
    } else h += `<div class="muted">Nothing under construction.</div>`;
    h += `</div><div class="panel"><h3>Build a new airport</h3>
      <div>A new airfield with a ${A.newAirportRunway} m runway, 100% yours: ${G.fmtMoney(A.newAirportCost)},
        opens after ${A.newAirportWeeks} weeks. At least ${A.newAirportMinKm} km from other airports.</div>
      <button class="primary" data-action="buildMode" ${s.money < A.newAirportCost && !ui.buildMode ? 'disabled' : ''}>
        ${ui.buildMode ? 'Cancel – pick a site on the map' : 'Pick a site on the map'}</button></div>`;

    h += `<div class="panel"><h3>Airports near your network</h3><div class="muted">Best value for money (dividend per franc).</div>
      <table class="small"><tr><th>Airport</th><th>5% costs</th><th>div./wk</th></tr>`;
    const near = D.airports.filter((a) => !a.minor && G.stake(a.code) < 100 &&
      Object.keys(s.slots).some((c) => G.dist(c, a.code) < 400));
    near.map((a) => ({ a, cost: G.sharePrice(a.code, 5), d: G.airportProfit(a.code) * A.payout * 0.05 }))
      .sort((x, y) => y.d / y.cost - x.d / x.cost).slice(0, 10).forEach(({ a, cost, d }) => {
        h += `<tr class="click" data-action="selectAirport" data-code="${a.code}"><td>${a.code} · ${a.city}</td>
          <td>${G.fmtMoney(cost)}</td><td>${G.fmtMoney(d)}</td></tr>`;
      });
    return h + `</table></div>`;
  }

  function planeStatus(p) {
    const f = p.flight;
    if (p.status === 'flying') {
      const verb = { ferry: 'Ferrying', delivery: 'Delivery flight' }[f.kind] || 'Flying';
      return `${verb} ${f.from} → ${f.to}, arrives ${G.fmtClock(f.arr)}` +
        (f.kind === 'scheduled' ? ` · ${f.pax} pax` : '') + ` · ${flightText(p)}`;
    }
    if (p.status === 'turnaround' && p.repair) return `🔧 Grounded for repairs at ${p.location} until ${G.fmtTime(p.readyAt)}`;
    const gate = `gate ${G.gateOf(p.location, p.id).name}`;
    if (p.status === 'turnaround') return `Turnaround at ${p.location} ${gate} until ${G.fmtClock(p.readyAt)}`;
    const crew = G.crewOf(p);
    const leg = p.pendingFerry || (p.schedule.active && p.schedule.stops.length >= 2);
    const sch = p.schedule;
    const nextTo = p.pendingFerry || (sch.legs ? sch.legs[sch.index % sch.legs.length].to : sch.stops[(sch.index + 1) % sch.stops.length]);
    const hold = leg && G.holdReason(p, nextTo);
    if (hold) return `At ${p.location} ${gate} · ⛔ ${hold}`;
    if (p.waitSlot) return `At ${p.location} ${gate} · ⏳ waiting for a free slot at ${p.waitSlot}`;
    if (leg && crew && crew.dutyToday >= C.crewMaxDutyMin - 60) return `At ${p.location} ${gate} · crew resting`;
    if (leg && sch.legs && !p.pendingFerry) {
      const l = sch.legs[sch.index % sch.legs.length];
      if (l.from === p.location) return `At ${p.location} ${gate} · next ${G.fmtClock(l.dep)} to ${l.to}`;
    }
    if (leg) return `At ${p.location} ${gate} · waiting (curfew / crew duty)`;
    return `Parked at ${p.location} ${gate}${sch.legs ? ' · timetable paused' : ' · no timetable'}`;
  }

  function fleetTab() {
    const s = G.state;
    const owned = Object.keys(s.slots);
    let h = '';
    const list = s.planes.slice().sort((p, q) => (q.id === ui.selectedPlane) - (p.id === ui.selectedPlane));
    for (const p of list) {
      const ac = D.aircraft[p.type];
      const crew = G.crewOf(p);
      const sch = p.schedule;
      h += `<div class="panel plane-card ${ui.selectedPlane === p.id ? 'selected' : ''}">
        <h3><span class="type-icon">${planeGlyph(p.type)}</span> ${p.id} <span class="muted">${ac.name}</span></h3>
        <div class="muted">${ac.seats} seats · range ${ac.rangeKm} km · ${ac.speedKmh} km/h · ${ownershipText(p)}</div>
        <div class="status">${planeStatus(p)}</div>`;
      if (crew) {
        h += `<div>👥 ${crew.name}: ${crew.pilots} pilots, ${crew.cabin} cabin crew ·
          duty today ${G.fmtDuration(crew.dutyToday)} / ${G.fmtDuration(C.crewMaxDutyMin)}</div>`;
      }
      h += `<div class="muted">Totals: ${p.stats.flights} flights · ${p.stats.pax} pax · ${G.fmtMoney(p.stats.profit)}</div>
        <div class="row"><button data-action="follow" data-plane="${p.id}">🎥 Follow</button></div>`;

      h += `<div class="row"><select id="send-${p.id}">`;
      for (const c of owned) h += `<option value="${c}">${c} · ${G.airportByCode[c].city}</option>`;
      h += `</select><button data-action="sendSelect" data-plane="${p.id}">Ferry there</button></div>`;

      if (sch.legs) {
        h += `<div class="label">Timetable ${sch.active ? '<span class="pos">● running</span>' : '<span class="muted">⏸ paused</span>'}</div>
          <div class="route">${sch.legs.map((l, i) => `<span class="${i === sch.index % sch.legs.length && p.status !== 'flying' ? 'here' : ''}">${G.fmtClock(l.dep)} ${l.from}→${l.to}</span>`).join(' ')}</div>`;
        h += fareTable(sch.stops);
        h += `<div class="row">${sch.active ? `<button data-action="pause" data-plane="${p.id}">⏸ Pause</button>`
            : `<button class="primary" data-action="start" data-plane="${p.id}">▶ Start timetable</button>`}
            <button data-action="planDay" data-plane="${p.id}">🗓 Edit timetable</button></div>`;
      } else {
        h += `<div class="label">Timetable</div><div class="muted">None yet: the plane stays parked.</div>
          <div class="row"><button class="primary" data-action="planDay" data-plane="${p.id}">🗓 Plan its day</button></div>`;
      }
      const confirm = ui.confirmDispose === p.id;
      const label = p.ownership === 'owned' ? `Sell for ${G.fmtMoney(G.saleValue(p))}` : `Return lease (fee ${G.fmtMoney(G.returnFee(p))})`;
      h += `<div class="row"><button class="mini dispose" data-action="dispose" data-plane="${p.id}"
        ${p.status === 'flying' || s.planes.length === 1 ? 'disabled' : ''}>${confirm ? 'Really? Click again' : label}</button></div>`;
      h += `</div>`;
    }
    h += `<div class="hint">Get more aircraft in the <a href="#" data-action="openMarket">Marketplace</a>.</div>`;
    return h;
  }

  function ownershipText(p) {
    const age = G.planeAge(p);
    const ageText = age >= 1 ? ` · ${Math.floor(age)} years old` : '';
    return p.ownership === 'owned'
      ? `owned${ageText}`
      : `leased ${G.fmtMoney(D.aircraft[p.type].leasePerWeek)}/week${ageText}`;
  }

  // ---------- market (hangar overlay) ----------
  const fmtM = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : `${Math.round(n / 1000)}k`);
  const sizeDots = (n) => `${'●'.repeat(n)}${'○'.repeat(5 - n)}`;
  const MARKET_SORTS = {
    price: ['Price', (a, b) => a.price - b.price],
    seats: ['Seats', (a, b) => D.aircraft[b.type].seats - D.aircraft[a.type].seats],
    range: ['Range', (a, b) => D.aircraft[b.type].rangeKm - D.aircraft[a.type].rangeKm],
    costSeat: ['Cost per seat-hour', (a, b) =>
      D.aircraft[a.type].costPerBlockHour / D.aircraft[a.type].seats - D.aircraft[b.type].costPerBlockHour / D.aircraft[b.type].seats],
    name: ['Name', (a, b) => D.aircraft[a.type].name.localeCompare(D.aircraft[b.type].name)],
  };
  const mk = { open: false, cond: 'new', cat: 'all', sort: 'price', at: null, sel: null, version: null };

  // Offers shown in the marketplace: every type built new this year (all of them outside story mode), or this
  // week's used planes.
  function mkOffers() {
    const list = mk.cond === 'new'
      ? Object.keys(D.aircraft).filter((type) => G.onSale(type)).map((type) => ({ key: `new:${type}`, type, price: G.priceNew(type) }))
      : G.state.market.listings.map((l) => ({ key: `used:${l.id}`, type: l.type, price: l.price, used: l }));
    return list.filter((o) => mk.cat === 'all' || D.aircraft[o.type].category === mk.cat).sort(MARKET_SORTS[mk.sort][1]);
  }

  function mkDeliverTo() {
    return G.ownsSlot(mk.at) ? mk.at : G.home();
  }

  function mkDelivery(o, at) {
    const from = o.used ? (o.used.at !== at ? o.used.at : null) : G.deliveryFrom(o.type, at);
    if (!from) return `Delivered straight to ${at}.`;
    const km = Math.round(G.dist(from, at));
    const t = G.fmtDuration(G.deliveryMinutes(o.type, from, at));
    if (o.used) return `Ferry flight ${from} → ${at} · ${km.toLocaleString('de-CH')} km · ${t}`;
    const f = G.factoryOf(o.type);
    return `Built at ${f.name}.<br>
      Delivery flight ${from} → ${at} · ${km.toLocaleString('de-CH')} km · ${t}`;
  }

  function mkShowcase(o, at) {
    const ac = D.aircraft[o.type];
    const look = D.looks[o.type] || {};
    const fits = G.fitsAirport(o.type, at);
    const inFleet = G.state.planes.filter((p) => p.type === o.type).length;
    const mult = o.used ? 1 + C.market.agingCostPerYear * o.used.age : 1;
    let h = `<section class="mk-show">
      <div class="mk-stage">${FG.hangar.svg(o.type, 'show')}</div>
      <div class="mk-info">
        <div class="mk-maker">${ac.maker} · ${D.aircraftCategories[ac.category]}</div>
        <h2>${ac.name}</h2>
        <div class="mk-badges">${o.used ? `<span class="b used">Pre-owned · ${o.used.age} years</span>` : '<span class="b new">Factory new</span>'}
          ${inFleet ? `<span class="b fleet">${inFleet} in your fleet</span>` : ''}</div>
        <dl class="mk-specs">
          <div><dt>Seats</dt><dd>${ac.seats}</dd></div>
          <div><dt>Range</dt><dd>${ac.rangeKm.toLocaleString('de-CH')} km</dd></div>
          <div><dt>Cruise</dt><dd>${ac.speedKmh} km/h</dd></div>
          <div><dt>Length</dt><dd>${look.len || '–'} m</dd></div>
          <div><dt>Operating</dt><dd>${G.fmtMoney(ac.costPerBlockHour * mult)}/h</dd></div>
          <div><dt>Crew</dt><dd>${G.fmtMoney(G.crewFor(o.type).weeklySalary)}/wk</dd></div>
          <div><dt>Airport</dt><dd>${sizeDots(ac.minAirport || 1)}</dd></div>
          <div><dt>Runway</dt><dd>${G.runwayNeed(o.type).m.toLocaleString('de-CH')} m${G.runwayNeed(o.type).paved ? '' : ' (grass ok)'}</dd></div>
          <div><dt>Lease rate</dt><dd>${G.fmtMoney(ac.leasePerWeek)}/wk</dd></div>
        </dl>
        <div class="mk-delivery">${fits ? mkDelivery(o, at) : `<span class="neg">${G.fitsReason(o.type, at)} Deliver to a larger airport.</span>`}</div>
        <div class="mk-buy">`;
    if (o.used) {
      h += `<button class="primary big" data-mk="buyUsed" data-id="${o.used.id}" data-cost="${o.price}" data-fits="${fits}">Buy ${G.fmtMoney(o.price)}</button>`;
    } else {
      h += `<button class="primary big" data-mk="buyNew" data-type="${o.type}" data-cost="${o.price}" data-fits="${fits}">Buy ${G.fmtMoney(o.price)}</button>
        <button class="big" data-mk="leaseNew" data-type="${o.type}" data-cost="${G.leaseDeposit(o.type)}" data-fits="${fits}">Lease ${G.fmtMoney(ac.leasePerWeek)}/wk
          <small>${G.fmtMoney(G.leaseDeposit(o.type))} deposit</small></button>`;
    }
    return h + `</div></div></section>`;
  }

  // Story mode: the year, and which new types come next.
  function mkYear() {
    const next = G.nextArrival();
    return `<div class="mk-year"><b>${G.year()}</b>${next ? `<span class="mk-next"> · next: ${next.types.map((t) => D.aircraft[t].name).join(', ')} in ${next.year}</span>` : ''}</div>`;
  }

  function renderMarket() {
    const s = G.state;
    const at = mkDeliverTo();
    const offers = mkOffers();
    if (!offers.some((o) => o.key === mk.sel)) mk.sel = offers.length ? offers[0].key : null;
    mk.version = s.market.nextId;

    let h = `<div class="mk-top">
      <h1>Aircraft Marketplace</h1>
      <div class="mk-money" id="mk-money"></div>
      ${G.isStory() ? mkYear() : ''}
      <div class="spacer"></div>
      <button class="mk-close" data-mk="close" title="Close (Esc)">×</button>
    </div>
    <div class="mk-bar">
      <div class="chips">
        <button class="${mk.cond === 'new' ? 'on' : ''}" data-mk="cond" data-v="new">New</button>
        <button class="${mk.cond === 'used' ? 'on' : ''}" data-mk="cond" data-v="used">Pre-owned <span class="n">${s.market.listings.length}</span></button>
      </div>
      <div class="chips">
        <button class="${mk.cat === 'all' ? 'on' : ''}" data-mk="cat" data-v="all">All</button>`;
    for (const [k, v] of Object.entries(D.aircraftCategories)) {
      h += `<button class="${mk.cat === k ? 'on' : ''}" data-mk="cat" data-v="${k}">${v}</button>`;
    }
    h += `</div>
      <label>Sort <select id="mk-sort">`;
    for (const [k, [v]] of Object.entries(MARKET_SORTS)) h += `<option value="${k}" ${mk.sort === k ? 'selected' : ''}>${v}</option>`;
    h += `</select></label>
      <label>Deliver to <select id="mk-at">`;
    for (const c of Object.keys(s.slots)) {
      const a = G.airportByCode[c];
      h += `<option value="${c}" ${c === at ? 'selected' : ''}>${c} · ${a.city} (size ${G.airportSize(c)}, ${G.longestRunway(c).toLocaleString('de-CH')} m)</option>`;
    }
    h += `</select></label></div><div class="mk-body">`;

    const sel = offers.find((o) => o.key === mk.sel);
    if (sel) h += mkShowcase(sel, at);
    else h += `<div class="mk-empty">No ${mk.cond === 'used' ? 'pre-owned offers' : 'aircraft'} in this category${mk.cond === 'used' ? ' this week – new offers arrive every Monday' : ''}.</div>`;

    h += `<div class="mk-grid">`;
    for (const o of offers) {
      const ac = D.aircraft[o.type];
      const fits = G.fitsAirport(o.type, at);
      h += `<button class="mk-tile ${o.key === mk.sel ? 'sel' : ''} ${fits ? '' : 'toobig'}" data-mk="select" data-key="${o.key}">
        ${FG.hangar.svg(o.type, 'tile')}
        <div class="t-name">${ac.name}</div>
        <div class="t-sub">${o.used ? `${o.used.age} yrs · ` : ''}${ac.seats} seats · ${ac.rangeKm.toLocaleString('de-CH')} km</div>
        <div class="t-price">${C.currency} ${fmtM(o.price)}${fits ? '' : ' <span class="neg">· too big</span>'}</div>
      </button>`;
    }
    h += `</div></div>`;
    $('market').innerHTML = h;
    refreshMarketButtons();
  }

  // Cheap per-tick update: money and which buy buttons are affordable.
  function refreshMarketButtons() {
    $('mk-money').textContent = G.fmtMoney(G.state.money);
    document.querySelectorAll('#market [data-cost]').forEach((b) => {
      b.disabled = b.dataset.fits !== 'true' || G.state.money < Number(b.dataset.cost);
    });
  }

  function openMarket() {
    mk.open = true;
    $('market').hidden = false;
    renderMarket();
  }

  function closeMarket() {
    mk.open = false;
    $('market').hidden = true;
  }

  function onMarketClick(e) {
    const el = e.target.closest('[data-mk]');
    if (!el) return;
    const a = el.dataset.mk;
    const at = mkDeliverTo();
    let err = null;
    let bought = false;
    if (a === 'close') { closeMarket(); return; }
    if (a === 'cond') { mk.cond = el.dataset.v; mk.sel = null; }
    if (a === 'cat') { mk.cat = el.dataset.v; mk.sel = null; }
    if (a === 'select') {
      mk.sel = el.dataset.key;
      $('market').querySelector('.mk-body').scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (a === 'buyNew') { err = G.buyNew(el.dataset.type, at); bought = true; }
    if (a === 'leaseNew') { err = G.leaseNew(el.dataset.type, at); bought = true; }
    if (a === 'buyUsed') { err = G.buyUsed(el.dataset.id, at); bought = true; }
    if (err) { toast(err, true); return; }
    if (bought) {
      const p = G.state.planes[G.state.planes.length - 1];
      toast(p.status === 'flying' ? `${p.id} is on its delivery flight ${p.flight.from} → ${p.flight.to}.` : `${p.id} is ready at ${p.location}.`);
      G.dirty = true;
    }
    renderMarket();
  }

  // ---------- rival airlines ----------
  const RIVAL_KIND = { flag: 'flag carrier', low: 'low-cost', regional: 'regional' };
  const rvDot = (r, big) => `<span class="rv-dot${big ? ' big' : ''}" style="background:${r.color}"></span>`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  // Routes the player doesn't fly yet are judged as if it flew them once a day with a typical plane.
  const PROBE_SEATS = 150;

  // Rivals flying a route: their colour dots and the player's share of the passengers.
  function rivalBadge(a, b) {
    const comp = G.rivalsOn(a, b);
    if (!comp.length) return '';
    const tip = comp.map((c) => `${c.r.name}: ${c.rt.perDay}× a day, fares ${pct(c.rt.fare)}`).join(' · ');
    return ` <span class="rv-badge" title="${tip}">${comp.map((c) => rvDot(c.r)).join('')}you ${pct(G.marketShare(a, b, PROBE_SEATS))}</span>`;
  }

  // Rival airlines with a hub or routes at an airport.
  function rivalsAt(code) {
    const list = (G.state.rivals || [])
      .map((r) => ({ r, n: r.routes.filter((rt) => rt.a === code || rt.b === code).length, hub: r.hubs.includes(code) }))
      .filter((x) => x.n || x.hub);
    if (!list.length) return '';
    return `<div class="muted">Rivals here: ${list.map((x) => `${rvDot(x.r)}${x.r.name}${x.hub ? ' (hub)' : ''} · ` +
      `${x.n} route${x.n === 1 ? '' : 's'}`).join(', ')}</div>`;
  }

  // Their routes as thin lines in their colour (redrawn when a network changes).
  function drawRivalRoutes() {
    const sig = (G.state.rivals || []).map((r) => r.id + r.routes.map((rt) => rt.a + rt.b + rt.perDay + rt.fare).join('')).join('|') +
      `|${ui.selectedRival || ''}`;
    if (sig === ui.rivalSig) return;
    ui.rivalSig = sig;
    ui.rivalRoutes.clearLayers();
    for (const r of G.state.rivals || []) {
      const sel = ui.selectedRival === r.id;
      const dim = ui.selectedRival && !sel;
      for (const rt of r.routes) {
        L.polyline(arc(G.airportByCode[rt.a], G.airportByCode[rt.b]), {
          pane: 'rivals', renderer: ui.rivalRenderer, color: r.color,
          weight: sel ? 2.5 : 1.2, opacity: dim ? 0.12 : sel ? 0.95 : 0.4,
        }).bindTooltip(`<b>${r.name}</b> · ${rt.a}–${rt.b} · ${rt.perDay}× a day · ${D.aircraft[rt.type].name} · fares ${pct(rt.fare)}`,
          { sticky: true })
          .on('click', () => { ui.tab = 'rivals'; ui.selectedRival = r.id; G.dirty = true; })
          .addTo(ui.rivalRoutes);
      }
    }
  }

  // Their planes in the air as dots, every third tick.
  function updateRivalPlanes() {
    if (!ui.map.hasLayer(ui.rivalLayer)) return;
    drawRivalRoutes();
    ui.rivalTick = (ui.rivalTick || 0) + 1;
    if (ui.rivalTick % 3) return;
    const view = ui.map.getBounds().pad(0.1);
    const flights = G.rivalFlights(nowMinutes())
      .filter((f) => view.contains([f.lat, f.lon]) && (!ui.selectedRival || f.r.id === ui.selectedRival));
    const pool = ui.rivalDots;
    flights.forEach((f, i) => {
      let m = pool[i];
      if (!m) {
        m = L.circleMarker([f.lat, f.lon], { pane: 'rivals', renderer: ui.rivalRenderer, radius: 3.5, weight: 1, color: '#fff', fillOpacity: 1 })
          .bindTooltip('', { direction: 'top', offset: [0, -4] }).addTo(ui.rivalPlanes);
        pool.push(m);
      }
      m.setLatLng([f.lat, f.lon]);
      if (m.options.fillColor !== f.r.color) m.setStyle({ fillColor: f.r.color });
      const tip = `<b>${f.r.name}</b> · ${f.from} → ${f.to} · ${D.aircraft[f.rt.type].name}`;
      if (m._tipText !== tip) { m._tipText = tip; m.setTooltipContent(tip); }
    });
    while (pool.length > flights.length) pool.pop().remove();
  }

  function rivalsTab() {
    const rivals = G.state.rivals || [];
    let h = `<div class="panel"><h3>Rival airlines</h3>
      <div class="muted">${rivals.length} airlines compete with you. On a route you share, passengers split by the seats each
      airline offers and its ticket price – add flights or cut your fare to win them. Every Monday they react: more flights
      on full routes, lower fares where you take their passengers, new routes (sometimes yours).</div>`;
    const mine = G.playerRoutes().filter((x) => G.rivalsOn(x.a, x.b).length);
    if (mine.length) {
      h += `<h4>Your routes with competition</h4><table class="small"><tr><th>Route</th><th>you</th><th>rivals</th><th>your ticket</th></tr>`;
      for (const x of mine) {
        const comp = G.rivalsOn(x.a, x.b);
        h += `<tr><td>${x.a}–${x.b}</td><td>${pct(G.marketShare(x.a, x.b))}</td>
          <td>${comp.map((c) => `<span title="${c.r.name}">${rvDot(c.r)}${c.rt.perDay}× ${pct(c.rt.fare)}</span>`).join(' ')}</td>
          ${fareCell(x.a, x.b)}</tr>`;
      }
      h += `</table>`;
    } else {
      h += `<div class="hint">None of your scheduled routes has competition yet.</div>`;
    }
    h += `</div>`;
    for (const r of rivals) {
      const sel = ui.selectedRival === r.id;
      const flights = r.routes.reduce((n, rt) => n + rt.perDay * 2, 0);
      const shared = r.routes.filter((rt) => G.playerSeats(rt.a, rt.b) + G.playerSeats(rt.b, rt.a) > 0).length;
      h += `<div class="panel rival${sel ? ' selected' : ''}" data-action="selectRival" data-id="${r.id}">
        <h3>${rvDot(r, true)}${r.name} <span class="muted">${RIVAL_KIND[r.kind]}</span></h3>
        <div class="muted">Hub${r.hubs.length > 1 ? 's' : ''} ${r.hubs.join(', ')} · ${r.routes.length} routes · ${flights} flights a day` +
        `${shared ? ` · <b class="neg">${shared} on your routes</b>` : ''}</div>`;
      if (sel) {
        h += `<table class="small"><tr><th>Route</th><th>a day</th><th>aircraft</th><th>fares</th></tr>`;
        for (const rt of r.routes.slice().sort((x, y) => y.perDay - x.perDay)) {
          h += `<tr class="click" data-action="selectAirport" data-code="${rt.b}"><td>${rt.a}–${rt.b}${rivalBadge(rt.a, rt.b) && G.playerSeats(rt.a, rt.b) ? ' ⚔' : ''}</td>
            <td>${rt.perDay}×</td><td>${D.aircraft[rt.type].name}</td><td>${pct(rt.fare)}</td></tr>`;
        }
        h += `</table><div class="hint">Click the panel again to show all airlines on the map.</div>`;
      }
      h += `</div>`;
    }
    return h;
  }

  // Where to go next: shown under the Slots section (js/planner.js).
  function bestRoutes() {
    let h = `<div class="panel"><h3>Best routes from ${G.home()}</h3><div class="hint">Click an airport on the map to see its demand and lease a slot.</div><table class="small">
      <tr><th>Airport</th><th>km</th><th>pax/day</th><th>slot</th></tr>`;
    const ranked = D.airports
      .filter((a) => a.code !== G.home() && !a.minor)
      .map((a) => ({ a, demand: G.paxDemand(G.home(), a.code, PROBE_SEATS) }))
      .sort((x, y) => y.demand - x.demand)
      .slice(0, 15);
    for (const { a, demand } of ranked) {
      h += `<tr class="click" data-action="selectAirport" data-code="${a.code}">
        <td>${G.ownsSlot(a.code) ? '✔ ' : ''}${a.code} · ${a.city}</td><td>${Math.round(G.dist(G.home(), a.code))}</td>
        <td>${demand}${rivalBadge(G.home(), a.code)}</td><td>${G.fmtMoney(G.slotPrice(a.code))}</td></tr>`;
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
      <div class="muted">Bankrupt below ${G.fmtMoney(G.bankruptcyLimit())}</div>
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
        [{ v: G.bankruptcyLimit(), label: 'Bankruptcy' }])}
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

  const TAB_TITLES = { fleet: 'Fleet', airports: 'Airports', slots: 'Slots', schedule: 'Schedule', finance: 'Finance', rivals: 'Rivals', log: 'Log' };

  function renderSidebar() {
    const open = !!(ui.tab || ui.selectedAirport);
    $('sidebar').hidden = !open;
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
    if (!open) return;
    const P = FG.planner;
    $('side-title').textContent = ui.tab ? TAB_TITLES[ui.tab] : 'Airport';
    $('details').innerHTML = ui.selectedAirport ? airportPanel(ui.selectedAirport) : '';
    renderEvents();
    const tabs = { fleet: fleetTab, slots: P.slotsTab, airports: P.airportsTab, schedule: P.scheduleTab, rivals: rivalsTab, finance: financeTab, log: logTab };
    const scroll = $('sidebar').scrollTop;
    $('tab-content').innerHTML = ui.tab ? tabs[ui.tab]() : '';
    $('sidebar').scrollTop = scroll;
    restoreSelects();
  }

  function setTab(tab) {
    if (tab === 'market') { openMarket(); return; }
    ui.tab = tab;
    G.dirty = true;
  }

  // ---------- bottom strip: one card per plane ----------
  const STATUS_DOT = { flying: 'fly', turnaround: 'turn', idle: 'idle' };
  function renderStrip() {
    const planes = G.state.planes;
    // (the picture in the airline's livery: the file in the first one, else rendered by js/shots3d.js)
    const shot = (type) => (FG.planeShots && FG.planeShots.get(type)) || `models/hangar/${D.typeSlug(type)}.webp`;
    const sig = planes.map((p) => `${p.id}:${p.type}:${shot(p.type)}`).join('|') + `|${ui.selectedPlane}|${ui.follow}`;
    if (sig === ui.stripSig) {
      // Same cards: only the status dots change (planes take off and land all the time).
      const dots = $('strip-list').querySelectorAll('.pcard[data-plane] .st');
      planes.forEach((p, i) => {
        const cls = `st ${STATUS_DOT[p.status] || 'idle'}${p.repair ? ' repair' : ''}`;
        if (dots[i] && dots[i].className !== cls) dots[i].className = cls;
      });
      return;
    }
    ui.stripSig = sig;
    $('strip-list').innerHTML = planes.map((p) => `<div class="pcard${p.id === ui.selectedPlane ? ' sel' : ''}${p.id === ui.follow ? ' follow' : ''}" data-plane="${p.id}">
        <img src="${shot(p.type)}" alt="" draggable="false" onerror="this.style.visibility='hidden'">
        <i class="st ${STATUS_DOT[p.status] || 'idle'}${p.repair ? ' repair' : ''}"></i>
        <div class="pc-type">${p.type}</div></div>`).join('') +
      `<button class="pcard add" data-action-strip="market" title="Marketplace">＋<div class="pc-type">Buy</div></button>`;
  }

  // Hover box: where it comes from, where it goes, time left and fuel.
  function stripTipHtml(p) {
    const t = nowMinutes();
    const f = p.flight;
    const fuel = Math.round(G.fuelLevel(p, t) * 100);
    const ac = D.aircraft[p.type];
    let h = `<div class="tt-head"><b>${p.id}</b> <span class="muted">${ac.name}</span></div>`;
    if (p.status === 'flying' && f) {
      const left = Math.max(0, f.arr - t);
      h += `<div class="tt-route"><span>${f.from}<small>${G.airportByCode[f.from].city}</small></span><span class="arrow">✈</span>
          <span>${f.to}<small>${G.airportByCode[f.to].city}</small></span></div>
        <div class="tt-prog"><i style="width:${Math.min(100, ((t - f.dep) / Math.max(1, f.arr - f.dep)) * 100)}%"></i></div>
        <div>⏱ <b>${G.fmtDuration(left)}</b> left · lands ${G.fmtClock(Math.round(f.arr))}</div>
        <div class="muted">${flightText(p)}${f.kind === 'scheduled' ? ` · ${f.pax} pax` : ` · ${f.kind}`}</div>`;
    } else {
      const sch = p.schedule;
      let next = '';
      if (sch.active && sch.legs) {
        const l = sch.legs[sch.index % sch.legs.length];
        next = `next ${l.from}→${l.to} at ${G.fmtClock(l.dep)}`;
      } else if (sch.active && sch.stops.length >= 2) next = `next to ${sch.stops[(sch.index + 1) % sch.stops.length]}`;
      h += `<div class="tt-route"><span>${p.location}<small>${G.airportByCode[p.location].city}</small></span></div>
        <div>${planeStatus(p)}</div>${next ? `<div class="muted">${next}</div>` : ''}`;
    }
    h += `<div class="tt-fuel">⛽ <span class="bar"><i class="${fuel < 25 ? 'low' : ''}" style="width:${fuel}%"></i></span> ${fuel}%</div>
      <div class="hint">Click: select · double-click: follow</div>`;
    return h;
  }

  function updateStripTip() {
    const tip = $('strip-tip');
    const p = ui.hoverCard && G.plane(ui.hoverCard);
    if (!p) { tip.hidden = true; return; }
    tip.innerHTML = stripTipHtml(p);
    tip.hidden = false;
    const card = document.querySelector(`.pcard[data-plane="${CSS.escape(p.id)}"]`);
    if (!card) { tip.hidden = true; return; }
    const r = card.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
    tip.style.top = `${r.top - tip.offsetHeight - 8}px`;
  }

  function bindStrip() {
    const list = $('strip-list');
    let last = { id: null, t: 0 };
    list.addEventListener('click', (e) => {
      if (e.target.closest('[data-action-strip="market"]')) { openMarket(); return; }
      const card = e.target.closest('.pcard[data-plane]');
      if (!card) return;
      const id = card.dataset.plane;
      const now = performance.now();
      if (last.id === id && now - last.t < 400) { follow(id); last = { id: null, t: 0 }; return; }
      last = { id, t: now };
      selectPlane(id);
      if (!(FG.view3d && FG.view3d.on)) {
        const pos = planePosition(G.plane(id));
        if (ui.follow && ui.follow !== id) setFollow2d(null);
        panIntoView(pos.latlng);
      }
    });
    // Mouse only: on a touch screen the tip would stay up after the tap, and the Fleet tab shows the same.
    list.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const card = e.target.closest('.pcard[data-plane]');
      ui.hoverCard = card ? card.dataset.plane : null;
      updateStripTip();
    });
    list.addEventListener('pointerleave', () => { ui.hoverCard = null; updateStripTip(); });
    // The mouse wheel scrolls the strip sideways.
    list.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { list.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
  }

  // ---------- phones: the sidebar is a sheet over the lower part of the map ----------
  const phone = window.matchMedia('(max-width: 640px)');
  const SHEET_TOP = 0.34; // default: the top third of the map stays visible
  ui.sheetTop = SHEET_TOP;
  function setSheetTop(f) {
    ui.sheetTop = f;
    $('sidebar').style.setProperty('--sheet-top', `${(f * 100).toFixed(1)}%`);
  }
  // Drag the sheet's head to resize it, pull it down to close it, tap it to switch full / normal height.
  function bindSheet() {
    const sheet = $('sidebar');
    const head = sheet.querySelector('.side-head');
    let drag = null;
    head.addEventListener('pointerdown', (e) => {
      if (!phone.matches || e.target.closest('button')) return;
      drag = { y: e.clientY, top: ui.sheetTop, h: sheet.parentElement.clientHeight, moved: false };
      head.setPointerCapture(e.pointerId);
      sheet.classList.add('dragging');
    });
    head.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      if (Math.abs(dy) > 6) drag.moved = true;
      if (drag.moved) setSheetTop(Math.min(0.9, Math.max(0, drag.top + dy / drag.h)));
    });
    const end = () => {
      if (!drag) return;
      sheet.classList.remove('dragging');
      if (!drag.moved) setSheetTop(ui.sheetTop > 0.05 ? 0 : SHEET_TOP);
      else if (ui.sheetTop > 0.72) { setSheetTop(SHEET_TOP); ui.tab = null; ui.selectedAirport = null; G.dirty = true; }
      else if (ui.sheetTop < 0.08) setSheetTop(0);
      drag = null;
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }
  // Centre the map on a selection; on phones in the part the sheet leaves free.
  function panIntoView(latlng) {
    const map = ui.map;
    if (!phone.matches || ui.sheetTop < 0.08) { map.panTo(latlng); return; }
    const h = map.getSize().y;
    map.panTo(map.unproject(map.project(latlng).add([0, (h - h * ui.sheetTop) / 2])));
  }

  // ---------- menu, speed and settings ----------
  const SETTINGS_KEY = 'flightgame.settings';
  const set = { legend: true, autosave: true, overlays: { Towns: true, Routes: true, 'Rival airlines': true, 'Place names': false } };
  function loadSettings() {
    try { Object.assign(set, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { /* private mode */ }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(set)); } catch (e) { /* private mode */ }
  }
  function applySettings() {
    for (const [name, layer] of Object.entries(ui.overlays)) {
      const on = set.overlays[name] !== false && (name !== 'Place names' || set.overlays[name]);
      if (on && !ui.map.hasLayer(layer)) layer.addTo(ui.map);
      if (!on && ui.map.hasLayer(layer)) ui.map.removeLayer(layer);
    }
    if (ui.legend) ui.legend.style.display = set.legend ? '' : 'none';
  }
  function setBasemap(name) {
    if (!ui.base[name] || name === ui.baseName) return;
    ui.map.removeLayer(ui.base[ui.baseName]);
    ui.base[name].addTo(ui.map);
    ui.baseName = name;
    ui.map.fire('baselayerchange', { name, layer: ui.base[name] });
  }

  function renderSettings() {
    const el = $('settings');
    el.innerHTML = `<div class="set-card"><div class="side-head"><h2>Settings</h2><button class="close" data-set="close">×</button></div>
      <h4>Map style</h4><div class="chips">${Object.keys(ui.base).map((n) =>
        `<button class="${n === ui.baseName ? 'on' : ''}" data-set="base" data-v="${n}">${{ Standard: '🗺', Dark: '🌑', Satellite: '🛰' }[n]} ${n}</button>`).join('')}</div>
      <h4>On the map</h4>${Object.keys(ui.overlays).map((n) =>
        `<label class="check"><input type="checkbox" data-set="overlay" data-v="${n}" ${ui.map.hasLayer(ui.overlays[n]) ? 'checked' : ''}> ${n}</label>`).join('')}
      <label class="check"><input type="checkbox" data-set="legend" ${set.legend ? 'checked' : ''}> Legend</label>
      <h4>Livery</h4><div class="chips">${FG.data.liveries.map((l) =>
        `<button class="${l.id === FG.livery().id ? 'on' : ''}" data-set="livery" data-v="${l.id}">${l.name}</button>`).join('')}</div>
      <h4>Game</h4>
      <label class="check"><input type="checkbox" data-set="autosave" ${set.autosave ? 'checked' : ''}> Save automatically every 30 s</label>
      <h4>3D view</h4><div class="row"><button data-set="3d">${FG.view3d && FG.view3d.on ? 'Back to 2D' : 'Open 3D view'} <span class="muted">V</span></button></div>
      <h4 class="keys-help">Keys</h4><div class="muted keys-help">Space pause · ← → speed · V 3D · F2 developer tools · F3 airport editor · F8 airport checklist · Esc menu</div></div>`;
  }
  function onSettings(e) {
    const t = e.target.closest('[data-set]');
    if (!t) { if (e.target === $('settings')) $('settings').hidden = true; return; }
    const k = t.dataset.set;
    if (k === 'close') { $('settings').hidden = true; return; }
    if (k === 'base') setBasemap(t.dataset.v);
    if (k === 'overlay') { set.overlays[t.dataset.v] = t.checked; applySettings(); }
    if (k === 'legend') { set.legend = t.checked; applySettings(); }
    if (k === 'autosave') set.autosave = t.checked;
    if (k === 'livery') { G.state.livery = t.dataset.v; G.dirty = true; } // every aircraft of the airline is repainted
    if (k === '3d') { $('view3d-toggle').click(); }
    saveSettings();
    renderSettings();
  }

  function closePops() {
    $('menu').hidden = true;
    $('speed-pop').hidden = true;
  }

  // After loading a save or starting over: forget what the UI showed of the old game.
  function resetView() {
    ui.selectedAirport = null;
    ui.selectedPlane = null;
    ui.shownAirport = undefined;
    ui.stripSig = null;
    setFollow2d(null);
    FG.planner.reset();
    Object.values(ui.planeMarkers).forEach((m) => m.remove());
    ui.planeMarkers = {};
    $('newspaper').hidden = true;
    if (ui.newsPaused) { ui.newsPaused = false; ui.paused = ui.wasPaused; }
    for (const code of Object.keys(ui.airportMarkers)) updateLabel(G.airportByCode[code]);
    G.dirty = true;
  }

  const SPEEDS = [1, 10, 60, 300, 1200, 3600, MAX_SPEED];
  function bindTopbar() {
    $('menu-btn').addEventListener('click', (e) => { e.stopPropagation(); const open = $('menu').hidden; closePops(); $('menu').hidden = !open; });
    $('speed-btn').addEventListener('click', (e) => { e.stopPropagation(); const open = $('speed-pop').hidden; closePops(); $('speed-pop').hidden = !open; });
    $('speed-pop').querySelector('.speed-presets').innerHTML = SPEEDS.map((x) =>
      `<button data-speed="${x}">${x === 1 ? 'Real' : fmtSpeed(x)}</button>`).join('');
    $('speed-pop').addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-speed]');
      if (!b) return;
      ui.speed = Number(b.dataset.speed);
      ui.paused = false;
      $('speed').value = speedToSlider(ui.speed);
    });
    $('menu').addEventListener('click', (e) => { if (e.target.closest('button')) closePops(); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.pop')) closePops(); });
    $('load').addEventListener('click', () => {
      if (!G.load()) { toast('No saved game.', true); return; }
      resetView();
      toast('Saved game loaded.');
    });
    $('exit').addEventListener('click', () => { G.save(); openStart(true); });
    $('settings-btn').addEventListener('click', () => { renderSettings(); $('settings').hidden = false; });
    $('settings').addEventListener('click', onSettings);
    $('side-close').addEventListener('click', () => { ui.tab = null; ui.selectedAirport = null; G.dirty = true; });
  }

  function renderAll() {
    renderStrip();
    renderSidebar();
    // The 2D map is hidden under the 3D view: it is brought up to date when it shows again (frame).
    if (in3d()) { ui.map2dStale = true; return; }
    refreshAirports();
    refreshPlanes();
    drawRoutes();
  }

  // Every animation frame: the planes on the 2D map move on (the 3D view draws its own).
  // Every frame, at the frame's own timestamp (evenly spaced: planes and a followed plane move smoothly).
  function frame(ts) {
    requestAnimationFrame(frame);
    if (in3d()) return;
    ui.frameAt = ts;
    if (ui.map2dStale) {
      ui.map2dStale = false;
      refreshAirports();
      refreshPlanes();
      drawRoutes();
      updatePlanes(true);
      updateRivalPlanes();
    }
    updatePlanes(false);
  }

  // ---------- events & newspaper ----------
  function renderEvents() {
    const list = G.activeEffects();
    $('events').innerHTML = list.length ? `<div class="panel events">${list.map((e) => {
      const left = e.until - G.state.time;
      const good = (e.demandMult || 1) > 1 || (e.costMult || 1) < 1;
      return `<div class="event ${good ? 'good' : 'bad'}">${e.noFlights ? '⛔' : good ? '▲' : '▼'} ${e.label}
        <span class="muted">· ${left >= 1440 ? `${Math.ceil(left / 1440)}d` : `${Math.ceil(left / 60)}h`} left</span></div>`;
    }).join('')}</div>` : '';
  }

  // Grayscale sketches for the newspaper photo (viewBox 0 0 160 110).
  const PICTURES = {
    crash: `<rect width="160" height="110" fill="#bbb"/><path d="M0 85 Q40 70 80 82 T160 76 V110 H0Z" fill="#777"/>
      <circle cx="98" cy="40" r="16" fill="#444"/><circle cx="112" cy="26" r="13" fill="#555"/><circle cx="84" cy="24" r="11" fill="#666"/><circle cx="104" cy="12" r="9" fill="#777"/>
      <path d="M40 86 L92 72 L96 80 L44 92Z" fill="#222"/><path d="M100 76 L130 70 L140 56 L144 58 L138 76 L104 84Z" fill="#333"/>
      <path d="M62 78 L70 62 L76 64 L72 80Z" fill="#111"/><path d="M92 74 l4 -6 l3 5 l4 -7 l2 9Z" fill="#999"/>`,
    incident: `<rect width="160" height="110" fill="#c4c4c4"/><rect y="80" width="160" height="30" fill="#666"/>
      <path d="M0 95 H160" stroke="#ddd" stroke-dasharray="12 8" stroke-width="2"/>
      <path d="M20 72 Q20 64 30 64 H120 L140 54 H146 L140 70 Q138 76 128 76 H28 Q20 76 20 72Z" fill="#333"/>
      <path d="M70 70 L52 88 L62 88 L88 70Z" fill="#222"/><circle cx="58" cy="50" r="8" fill="#888"/><circle cx="68" cy="42" r="10" fill="#999"/><circle cx="80" cy="36" r="8" fill="#aaa"/>
      <rect x="112" y="80" width="40" height="14" rx="2" fill="#222"/><rect x="104" y="76" width="16" height="10" fill="#444"/>`,
    strike: `<rect width="160" height="110" fill="#c8c8c8"/><rect y="88" width="160" height="22" fill="#888"/>
      ${[20, 60, 100, 140].map((x, i) => `<circle cx="${x}" cy="${62 + (i % 2) * 3}" r="7" fill="#333"/>
      <path d="M${x - 9} ${100} L${x - 8} ${72 + (i % 2) * 3} Q${x} ${68} ${x + 8} ${72 + (i % 2) * 3} L${x + 9} 100Z" fill="#333"/>
      <rect x="${x + 6}" y="${16 + (i % 2) * 6}" width="2" height="50" fill="#222"/>
      <rect x="${x - 12}" y="${12 + (i % 2) * 6}" width="38" height="22" fill="#eee" stroke="#222"/>
      <text x="${x + 7}" y="${27 + (i % 2) * 6}" font-size="9" font-weight="bold" text-anchor="middle" font-family="sans-serif">${['STRIKE', 'NO!', 'FAIR PAY', 'STRIKE'][i]}</text>`).join('')}`,
    storm: `<rect width="160" height="110" fill="#999"/><path d="M30 46 Q30 26 52 28 Q60 10 84 16 Q104 6 116 24 Q138 24 136 44 Z" fill="#444"/>
      <path d="M84 46 L72 70 H84 L74 96 L102 62 H88 L98 46Z" fill="#eee"/>
      ${Array.from({ length: 14 }, (_, i) => `<path d="M${16 + i * 10} 52 l-8 22" stroke="#555" stroke-width="2"/>`).join('')}
      <rect y="96" width="160" height="14" fill="#555"/>`,
    volcano: `<rect width="160" height="110" fill="#bbb"/><circle cx="80" cy="30" r="22" fill="#444"/><circle cx="104" cy="22" r="18" fill="#555"/>
      <circle cx="60" cy="18" r="14" fill="#666"/><circle cx="126" cy="14" r="12" fill="#777"/><circle cx="144" cy="10" r="9" fill="#888"/>
      <path d="M10 110 L66 52 H94 L150 110Z" fill="#333"/><path d="M66 52 l6 12 l6 -8 l6 10 l4 -10 l6 -4Z" fill="#999"/>`,
    fuel: `<rect width="160" height="110" fill="#ccc"/><rect x="34" y="24" width="44" height="76" rx="4" fill="#333"/>
      <rect x="42" y="32" width="28" height="18" fill="#ddd"/><path d="M78 40 h12 q8 0 8 8 v30 q0 6 6 6" stroke="#333" stroke-width="5" fill="none"/>
      <path d="M118 90 V30 M106 42 L118 26 L130 42" stroke="#111" stroke-width="7" fill="none"/>
      <text x="56" y="45" font-size="11" text-anchor="middle" font-family="monospace" font-weight="bold">$$$</text>`,
    chart: `<rect width="160" height="110" fill="#ddd"/>${[30, 50, 70, 90].map((y) => `<path d="M14 ${y} H150" stroke="#aaa"/>`).join('')}
      <path d="M14 20 V96 H150" stroke="#222" stroke-width="2" fill="none"/>
      <path d="M18 80 L40 70 L58 76 L80 52 L98 58 L120 34 L146 26" stroke="#111" stroke-width="4" fill="none"/>`,
    party: `<rect width="160" height="110" fill="#c8c8c8"/><rect y="78" width="160" height="32" fill="#555"/>
      <path d="M20 78 V40 H140 V78" fill="#888"/><path d="M14 40 L80 14 L146 40Z" fill="#444"/>
      ${Array.from({ length: 30 }, (_, i) => `<rect x="${(i * 37) % 156}" y="${(i * 23) % 70}" width="4" height="4" fill="#${i % 2 ? '222' : 'eee'}" transform="rotate(${i * 25} ${(i * 37) % 156} ${(i * 23) % 70})"/>`).join('')}
      ${Array.from({ length: 12 }, (_, i) => `<circle cx="${8 + i * 13}" cy="${86 + (i % 3) * 3}" r="6" fill="#222"/>`).join('')}`,
    plane: `<rect width="160" height="110" fill="#d4d4d4"/><rect y="84" width="160" height="26" fill="#777"/>
      <path d="M0 96 H160" stroke="#ddd" stroke-dasharray="12 8" stroke-width="2"/>
      <path d="M14 66 Q14 56 28 56 H120 L138 34 H148 L142 60 Q140 70 126 70 H26 Q14 70 14 66Z" fill="#333"/>
      <path d="M62 66 L44 80 H58 L86 66Z" fill="#222"/><path d="M118 58 L132 50 H140 L130 60Z" fill="#222"/>
      ${Array.from({ length: 12 }, (_, i) => `<circle cx="${36 + i * 7}" cy="61" r="1.6" fill="#ddd"/>`).join('')}
      <path d="M20 84 L20 76 M70 84 L70 76" stroke="#222" stroke-width="3"/><circle cx="20" cy="84" r="3" fill="#111"/><circle cx="70" cy="84" r="3" fill="#111"/>
      ${[16, 40, 128, 146].map((x) => `<path d="M${x} 84 l3 -12 l3 12" fill="#555"/>`).join('')}`,
    crowd: `<rect width="160" height="110" fill="#bbb"/><rect x="70" y="8" width="2" height="40" fill="#222"/><path d="M72 8 h30 l-6 8 l6 8 h-30Z" fill="#333"/>
      ${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i % 10) * 17 + (Math.floor(i / 10) % 2) * 8 + 4}" cy="${58 + Math.floor(i / 10) * 13}" r="7" fill="#${['222', '333', '444'][i % 3]}"/>`).join('')}`,
  };

  // Torn paper edge: a polygon with jagged top and bottom.
  function tornEdge() {
    const pts = [];
    for (let x = 0; x <= 100; x += 4) pts.push(`${x}% ${Math.random() * 1.6}%`);
    for (let x = 100; x >= 0; x -= 4) pts.push(`${x}% ${100 - Math.random() * 1.6}%`);
    return `polygon(${pts.join(',')})`;
  }

  function showNewspaper() {
    const n = G.state.news[0];
    const el = $('newspaper');
    if (!n || !el.hidden || mk.open) return;
    if (!ui.newsPaused) ui.wasPaused = ui.paused;
    ui.newsPaused = true;
    ui.paused = true;
    const tilt = (Math.random() * 4 - 2).toFixed(1);
    const more = G.state.news.length - 1;
    const price = (1.5 + Math.floor(G.state.time / 1440 / 60) * 0.1).toFixed(2);
    el.innerHTML = `<div class="paper ${n.kind}" style="transform: rotate(${tilt}deg); clip-path: ${tornEdge()}">
        <div class="masthead">${n.paper}</div>
        <div class="dateline"><span>${G.fmtTime(n.t).replace(/ \d\d:\d\d$/, '')}</span><span>${n.kind === 'good' ? 'Business' : 'Late edition'}</span><span>${C.currency} ${price}</span></div>
        <h1>${n.headline}</h1>
        <div class="sub">${n.sub}</div>
        <div class="cols">
          <figure><svg viewBox="0 0 160 110">${PICTURES[n.picture] || PICTURES.chart}</svg>
            <figcaption>${{ crash: 'The scene of the accident.', incident: 'The aircraft after landing.', strike: 'Picket line at the terminal.',
              storm: 'Dark skies over the region.', volcano: 'The ash plume seen from the coast.', fuel: 'Prices at the pump.',
              party: 'Celebrations in the city.', crowd: 'Fans gather ahead of the match.', plane: 'The new airliner on its first visit.' }[n.picture] || 'Markets react.'}</figcaption></figure>
          <p>${n.body}</p>
        </div>
      </div>
      <button class="primary" data-action="newsNext">${more ? `Next story (${more} more)` : 'Continue'}</button>`;
    el.hidden = false;
  }

  function closeNewspaper() {
    G.state.news.shift();
    $('newspaper').hidden = true;
    if (G.state.news.length) { showNewspaper(); return; }
    ui.newsPaused = false;
    ui.paused = ui.wasPaused;
  }

  // ---------- start screen ----------
  // Shown on every page load and by "New game": continue the saved airline or set up a new one.
  const st = { open: false, hasGame: false, mode: C.defaultMode, difficulty: C.defaultDifficulty,
    airport: C.startAirport, aircraft: C.startAircraft, quickOpen: true, story: '', year: String(C.story.defaultYear) };

  // Home airport choices, grouped by region (C.startAirports).
  function startAirportOptions() {
    return Object.entries(C.startAirports).map(([region, codes]) => `<optgroup label="${region}">${codes
      .filter((c) => G.airportByCode[c])
      .map((c) => { const a = G.airportByCode[c]; return `<option value="${c}"${c === st.airport ? ' selected' : ''}>${c} · ${a.city} – ${a.name}</option>`; })
      .join('')}</optgroup>`).join('');
  }

  function startChoices(group, entries, value) {
    return `<div class="st-choices">${Object.entries(entries).map(([id, m]) =>
      `<button class="st-choice${id === value ? ' on' : ''}${group === 'mode' && id === 'realistic' ? ' danger' : ''}" data-st="${group}" data-id="${id}">
        <b>${m.name}</b><span>${m.desc}</span></button>`).join('')}</div>`;
  }

  // Free play or story mode (and its start year).
  function startStory() {
    return `<div class="st-choices">
      <button class="st-choice${st.story ? '' : ' on'}" data-st="story" data-id=""><b>Free play</b><span>Today's world, every aircraft on sale.</span></button>
      <button class="st-choice${st.story ? ' on' : ''}" data-st="story" data-id="${st.year}"><b>Story mode</b>
        <span>Start in the past. Every year new airliners arrive, in the year they really first flew with airlines.</span></button></div>
      ${st.story ? `<label class="st-label" for="st-year">Start year</label><select id="st-year">${C.story.years.map((y) =>
        `<option value="${y}"${String(y) === st.year ? ' selected' : ''}>${y}</option>`).join('')}</select>` : ''}`;
  }

  const startTypes = () => G.starterTypes(st.story ? Number(st.story) : null);

  function startPlanes() {
    return startTypes().map((t) => {
      const ac = D.aircraft[t];
      const why = G.fitsReason(t, st.airport);
      return `<button class="st-plane${t === st.aircraft ? ' on' : ''}" data-st="aircraft" data-id="${t}"${why ? ` disabled title="${why}"` : ''}>
        <div class="st-art">${FG.hangar.svg(t, 'tile')}</div>
        <b>${ac.name}</b>
        <span>${ac.seats} seats · ${ac.rangeKm.toLocaleString('de-CH')} km · ${G.fmtMoney(ac.leasePerWeek)}/wk</span>
        ${why ? '<span class="neg">Runway too short here</span>' : ''}</button>`;
    }).join('');
  }

  // Quick start: ready-made airlines (D.presets), one click and they are flying.
  function startPresets() {
    return `<div class="st-choices st-presets">${Object.entries(D.presets || {}).map(([id, pr]) =>
      `<button class="st-choice" data-st="preset" data-id="${id}"><b>${pr.name}</b><span>${pr.desc}</span></button>`).join('')}</div>`;
  }

  function renderStart() {
    const s = G.state;
    // Keep the chosen plane valid for the chosen airport and year.
    const types = startTypes();
    if (!types.includes(st.aircraft) || G.fitsReason(st.aircraft, st.airport)) {
      const year = st.story ? Number(st.story) : undefined; // (rather one that is still built)
      st.aircraft = types.find((t) => G.onSale(t, year) && !G.fitsReason(t, st.airport))
        || types.find((t) => !G.fitsReason(t, st.airport)) || types[0];
    }
    const ap = G.airportByCode[st.airport];
    const el = $('start-screen');
    el.innerHTML = `<div class="st-card">
      <div class="st-hero"><div class="st-logo">✈</div><div><h1>Flightgame</h1>
        <p>Build an airline from a single plane.</p></div></div>
      ${st.hasGame ? `<div class="st-continue">
        <div><b>${s.company}</b><span>${G.mode().name} · ${G.difficulty().name} · ${G.fmtTime(s.time)} · ${G.fmtMoney(s.money)} · ${s.planes.length} plane${s.planes.length === 1 ? '' : 's'}</span></div>
        <button class="primary big" data-st="continue">Continue ▶</button></div>` : ''}
      <details class="st-quick"${st.quickOpen ? ' open' : ''}><summary>Quick start <span class="muted">ready-made airlines, already flying – good for testing</span></summary>
        ${startPresets()}</details>
      <h2>${st.hasGame ? 'Or start a new airline' : 'New airline'}</h2>
      <label class="st-label" for="st-name">Airline name</label>
      <input id="st-name" maxlength="40" value="${(st.name ?? C.companyName).replace(/"/g, '&quot;')}">
      <div class="st-label">Mode</div>${startChoices('mode', C.modes, st.mode)}
      <div class="st-label">Difficulty</div>${startChoices('difficulty', C.difficulties, st.difficulty)}
      <div class="st-label">Game</div>${startStory()}
      <label class="st-label" for="st-airport">Home airport <span class="muted">${ap.name}, ${ap.city} · size ${G.airportSize(ap.code)}</span></label>
      <select id="st-airport">${startAirportOptions()}</select>
      <div class="st-label">First aircraft <span class="muted">leased, with crew</span></div>
      <div class="st-planes">${startPlanes()}</div>
      <div class="st-actions">
        ${st.hasGame ? '<button data-st="cancel">Back to my airline</button>' : ''}
        <button class="primary big" data-st="start">${st.hasGame ? 'Start new airline' : 'Start airline'} ✈</button>
      </div>
      ${st.hasGame ? '<p class="muted st-warn">Starting a new airline replaces your saved game.</p>' : ''}
    </div>`;
  }

  function openStart(hasGame) {
    st.open = true;
    st.hasGame = hasGame;
    $('start-screen').hidden = false;
    renderStart();
  }

  function closeStart() {
    st.open = false;
    $('start-screen').hidden = true;
  }

  function onStartClick(e) {
    const b = e.target.closest('[data-st]');
    if (!b || b.disabled) return;
    const { st: what, id } = b.dataset;
    if (what === 'continue' || what === 'cancel') { closeStart(); return; }
    if (what === 'start') { startNewGame(); return; }
    if (what === 'preset') { startPreset(id); return; }
    st[what] = id; // mode, difficulty, aircraft or story ('' = free play, else the start year)
    renderStart();
  }

  function onStartInput(e) {
    const t = e.target;
    if (t.id === 'st-name') st.name = t.value;
    if (t.id === 'st-airport') { st.airport = t.value; refreshStartAirport(); }
    if (t.id === 'st-year') { st.year = st.story = t.value; renderStart(); $('st-year').focus(); }
  }

  // Re-render, keeping the focus on the airport list.
  function refreshStartAirport() {
    renderStart();
    $('st-airport').focus();
  }

  function startNewGame() {
    G.newGame({ mode: st.mode, difficulty: st.difficulty, airport: st.airport, aircraft: st.aircraft,
      company: st.name ?? C.companyName, story: st.story ? Number(st.story) : null });
    afterNewGame();
  }

  function startPreset(id) {
    const errors = G.applyPreset(id);
    if (errors.length) console.warn('Quick start:', errors);
    afterNewGame();
    toast(errors.length ? `Started with ${errors.length} problem(s) – see the log.` : `Quick start: ${G.state.company}`);
  }

  function afterNewGame() {
    closeStart();
    resetView();
    const home = G.airportByCode[G.home()];
    ui.map.setView([home.lat, home.lon], 6);
    G.save();
  }

  // ---------- input ----------
  function onAction(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, plane, code } = el.dataset;
    const i = Number(el.dataset.i);

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
      case 'buyShares': act(G.buyShares(code)); break;
      case 'sellShares': act(G.sellShares(code)); break;
      case 'project': act(G.startProject(code, el.dataset.kind)); break;
      case 'buildRunway': {
        const [len, orient] = $(`rw-${code}`).value.split(':');
        act(G.startProject(code, 'runway', len, orient));
        break;
      }
      case 'buildMode': setBuildMode(!ui.buildMode); break;
      case 'zoomRunways': {
        e.preventDefault();
        const a = G.airportByCode[code];
        ui.map.setView([a.lat, a.lon], 14);
        break;
      }
      case 'sendPlane': act(G.sendPlane(plane, code)); break;
      case 'sendSelect': act(G.sendPlane(plane, $(`send-${plane}`).value)); break;
      case 'fare': G.changeFare(el.dataset.from, el.dataset.to, Number(el.dataset.dir)); break;
      case 'selectRival': {
        const id = el.dataset.id;
        ui.selectedRival = ui.selectedRival === id ? null : id;
        const r = G.rival(id);
        if (ui.selectedRival && r && r.routes.length) {
          const pts = r.routes.flatMap((rt) => [rt.a, rt.b]).map((c) => [G.airportByCode[c].lat, G.airportByCode[c].lon]);
          ui.map.fitBounds(pts, { padding: [30, 30], maxZoom: 7 });
        }
        break;
      }
      case 'start': act(G.setScheduleActive(plane, true)); break;
      case 'follow': follow(plane); break;
      case 'planDay': FG.planner.openPlane(plane); ui.tab = 'schedule'; break;
      case 'planAdd': { const e2 = FG.planner.addStop(code); if (e2) { toast(e2, true); return; } ui.tab = 'schedule'; break; }
      case 'openMarket': e.preventDefault(); openMarket(); return;
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
        if (ui.selectedPlane === plane) ui.selectedPlane = null;
        break;
      }
      case 'pause': act(G.setScheduleActive(plane, false)); break;
      default: return;
    }
    G.dirty = true;
  }

  function bindControls() {
    $('sidebar').addEventListener('click', (e) => {
      const pl = e.target.closest('[data-pl]');
      if (pl && pl.tagName !== 'SELECT' && pl.tagName !== 'INPUT') { FG.planner.action(pl); return; }
      onAction(e);
    });
    $('sidebar').addEventListener('change', (e) => { if (FG.planner.change(e.target)) ui.selectOpen = false; });
    bindStrip();
    bindTopbar();
    bindSheet();
    $('sidebar').addEventListener('mousemove', chartHover);
    $('sidebar').addEventListener('mouseleave', () => { $('chart-tip').hidden = true; });
    // A tap on a chart leaves its tip up on touch screens; scrolling the panel takes it away.
    $('sidebar').addEventListener('scroll', () => { $('chart-tip').hidden = true; }, { passive: true });
    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      // A second click on the open section closes the sidebar.
      setTab(ui.tab === b.dataset.tab ? null : b.dataset.tab);
    }));
    $('pause').addEventListener('click', () => { ui.paused = !ui.paused; });
    $('speed').addEventListener('input', (e) => { ui.speed = sliderToSpeed(Number(e.target.value)); });
    // Click the speed label to go back to real time.
    $('speed-label').addEventListener('click', () => {
      ui.speed = 1;
      $('speed').value = speedToSlider(1);
    });
    $('market').addEventListener('click', onMarketClick);
    $('market').addEventListener('change', (e) => {
      if (e.target.id === 'mk-sort') mk.sort = e.target.value;
      if (e.target.id === 'mk-at') mk.at = e.target.value;
      renderMarket();
    });
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
    });
    // Typing a time or choosing from a list must not be interrupted by a re-render.
    $('sidebar').addEventListener('focusin', (e) => { if (e.target.matches('select, input')) ui.selectOpen = true; });
    $('sidebar').addEventListener('focusout', (e) => { if (e.target.matches('select, input')) { ui.selectOpen = false; G.dirty = true; } });
    $('newgame').addEventListener('click', () => openStart(true));
    $('start-screen').addEventListener('click', onStartClick);
    $('start-screen').addEventListener('input', onStartInput);
    $('start-screen').addEventListener('change', onStartInput);
    $('start-screen').addEventListener('toggle', (e) => { // 'toggle' doesn't bubble
      if (e.target.classList.contains('st-quick')) st.quickOpen = e.target.open;
    }, true);
    $('newspaper').addEventListener('click', (e) => {
      if (e.target.closest('[data-action="newsNext"]')) closeNewspaper();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mk.open) { closeMarket(); return; }
      if (e.key === 'Escape' && !$('settings').hidden) { $('settings').hidden = true; return; }
      if (e.key === 'Escape' && (!$('menu').hidden || !$('speed-pop').hidden)) { closePops(); return; }
      if (e.key === 'Escape' && ui.buildMode) { setBuildMode(false); return; }
      if (!$('newspaper').hidden && (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ')) {
        closeNewspaper();
        e.preventDefault();
        return;
      }
      if (st.open) {
        if (e.key === 'Escape' && st.hasGame) closeStart();
        if (e.key === 'Enter' && e.target.id === 'st-name') startNewGame();
        return;
      }
      if (e.target.matches('input, select, textarea')) return;
      if (e.key === ' ') { ui.paused = !ui.paused; e.preventDefault(); }
      if (e.key === 'Escape' && !ui.buildMode && $('newspaper').hidden) { $('menu').hidden = false; }
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
    const now = performance.now();
    const elapsed = Math.min(now - ui.lastTick, MAX_STEP_MS);
    ui.lastTick = now;
    if (!ui.paused && !st.open) {
      ui.pendingMinutes += (ui.speed * elapsed) / 60000;
      const whole = Math.floor(ui.pendingMinutes);
      ui.pendingMinutes -= whole;
      if (whole > 0) G.advance(whole);
    }
    showNewspaper();
    renderHeader();
    if (!in3d()) {
      updatePlanes(true);
      updateRivalPlanes();
    }
    if (ui.hoverCard) updateStripTip();
    if (mk.open) {
      if (mk.version !== G.state.market.nextId) renderMarket(); // new weekly offers
      else refreshMarketButtons();
    }
    if (G.dirty && !sidebarBusy()) {
      G.dirty = false;
      renderAll();
    }
  }

  function init() {
    const saved = G.load();
    if (!saved) G.newGame(); // placeholder game behind the start screen
    loadSettings();
    initMap();
    applySettings();
    FG.planner.init({ ui, toast, planeGlyph, setTab, bestRoutes, legacyAirports: airportsTab,
      selectAirport(code) { const a = G.airportByCode[code]; ui.selectedAirport = code; panIntoView([a.lat, a.lon]); G.dirty = true; } });
    bindControls();
    renderAll();
    openStart(saved && !G.state.gameOver);
    // index.html?preset=<id> starts that ready-made airline straight away (on every reload).
    const preset = new URLSearchParams(location.search).get('preset');
    if (preset && D.presets && D.presets[preset]) startPreset(preset);
    setInterval(loop, TICK_MS);
    requestAnimationFrame(frame);
    setInterval(() => { if (set.autosave) G.save(); }, 30000);
    // Hook for the 3D view (js/view3d.js).
    FG.ui = {
      get selectedPlane() { return ui.selectedPlane; },
      get selectedAirport() { return ui.selectedAirport; },
      get speed() { return ui.paused || st.open ? 0 : ui.speed; },
      get time() { return nowMinutes(); }, // fractional game minutes
      timeAt: (at) => nowMinutes(at), // ... at a moment (performance.now() scale), e.g. a frame's timestamp
      selectPlane,
      selectAirport(code) { ui.selectedAirport = code; G.dirty = true; },
      showAirport(code) { // select it and bring it into view, close enough for its gates
        const a = G.airportByCode[code];
        ui.selectedAirport = code;
        ui.map.setView([a.lat, a.lon], 13);
        if (FG.view3d && FG.view3d.map) FG.view3d.map.jumpTo({ center: [a.lon, a.lat], zoom: 12.6 });
        G.dirty = true;
      },
      clearSelection() { ui.selectedAirport = null; ui.selectedPlane = null; G.dirty = true; },
      follow,
      get buildMode() { return ui.buildMode; },
      buildAt(lat, lon) { buildAt({ lat, lng: lon }); },
      get map() { return ui.map; }, // the 2D map (the airport editor draws on it)
      // Airports, runways and gates drawn again (the airport editor changed some).
      redrawAirports() {
        ui.runwaySig = '';
        ui.gateSig = '';
        delete ui.areas.airports;
        delete ui.areas.runways;
        delete ui.areas.gates;
        updateVisible();
        drawRunways();
      },
    };
    window.dispatchEvent(new Event('fg-ui-ready'));
    window.addEventListener('beforeunload', () => G.save());
  }

  window.addEventListener('DOMContentLoaded', init);
})();
