// Clouds and weather on the maps. The weather itself is js/wxmodel.js (through game.js weatherAt); this
// draws it, and is made to be light on the computer:
// - 2D: one canvas at half resolution in its own pane under the airports and planes, drawn again when the map
//   moves and about once a second while the clouds drift; it fades out when zoomed in on an airport.
// - 3D: the same puffs as one batch of sprites in the planes' layer (view3d.js cloudPoints), one draw call.
// - Zoomed in, rain, snow, fog and lightning are a CSS overlay (#wx-fx) over both maps, and a chip says the
//   weather at the map's centre.
// Settings → On the map → "Clouds and weather" turns all of it off (FG.weather.enabled()).
(function () {
  const G = FG.game;
  const DEG = Math.PI / 180;
  const EARTH_CIRC = 40075016.686;
  const LOD = [0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24]; // cell sizes in degrees
  const MAX_2D = 1400;
  const st = { layer: null, drawnT: -1, n2d: 0, n3d: 0, fxClass: '', chip: '', flashAt: 0 };

  function hash(x, y, z, s) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(s, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Cloud puffs over a box { s, w, n, e } at game time t: one per cell where the weather has cloud there,
  // the cells sized so there are at most `max` of them (bigger, fewer puffs zoomed out). They drift with the
  // weather. Each { lat, lon, r (m), alt (m), shade (0 white … 1 dark), a (0 … 1), storm, v (look 0-2), rot }.
  // `towers`: thunderstorms get two more puffs above (3D).
  function puffs(box, t, max, towers) {
    const out = [];
    if (!G.state) return out;
    const n = Math.min(85, box.n);
    const s = Math.max(-85, box.s);
    const span = Math.min(360, box.e - box.w);
    const area = Math.max(1e-6, (n - s) * span);
    let lv = LOD.findIndex((c) => area / (c * c) <= max);
    if (lv < 0) lv = LOD.length - 1;
    const size = LOD[lv];
    const drift = G.WX_DRIFT * t;
    const x0 = Math.floor((box.w - drift) / size) - 1;
    const x1 = Math.floor((box.w + span - drift) / size) + 1;
    const y0 = Math.floor(s / size) - 1;
    const y1 = Math.floor(n / size) + 1;
    for (let yi = y0; yi <= y1; yi++) {
      for (let xi = x0; xi <= x1; xi++) {
        const h1 = hash(xi, yi, lv, 11);
        const lat = (yi + h1) * size;
        if (lat > 85 || lat < -85) continue;
        const lon = (xi + hash(xi, yi, lv, 12)) * size + drift;
        const wx = G.weatherAt(lat, ((lon + 540) % 360) - 180, t, true);
        if (hash(xi, yi, lv, 13) > wx.cover * 1.1 - 0.06) continue;
        const k = hash(xi, yi, lv, 14);
        const r = size * 111000 * (0.7 + 0.45 * k) * (0.7 + 0.3 * wx.cover);
        const shade = Math.min(1, wx.rain * 0.8 + (wx.storm ? 0.3 : 0));
        const p = { lat, lon, r, alt: 1100 + 1900 * k, shade, a: 0.45 + 0.55 * wx.cover, storm: wx.storm, v: Math.floor(h1 * 3) % 3, rot: k * 6.283 };
        out.push(p);
        if (towers && wx.storm) {
          out.push({ ...p, alt: 4200 + 800 * k, r: r * 0.8, shade: shade * 0.8 });
          out.push({ ...p, alt: 7500 + 1200 * k, r: r * 0.65, shade: shade * 0.5, rot: p.rot + 2 });
        }
      }
    }
    return out;
  }

  // ---------- sprites ----------
  // A soft cumulus blob (several radial gradients), white or tinted grey for rain clouds.
  function blob(seed, tint) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    let r = seed * 7919 + 17;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 10; i++) {
      const a = rnd() * 6.283;
      const d = i ? 10 + rnd() * 18 : 0;
      const x = 64 + Math.cos(a) * d;
      const y = 64 + Math.sin(a) * d * 0.75;
      const rad = i ? 14 + rnd() * 12 : 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.85)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.5)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, rad, 0, 6.283);
      g.fill();
    }
    if (tint) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = tint;
      g.fillRect(0, 0, 128, 128);
    }
    return c;
  }
  const TINTS = [null, 'rgba(150,158,170,0.55)', 'rgba(108,116,128,0.75)', 'rgba(72,78,90,0.85)'];
  let sprites = null; // [look][shade level]
  const spritesOf = () => sprites || (sprites = [0, 1, 2].map((v) => TINTS.map((t) => blob(v + 1, t))));

  // ---------- 2D ----------
  // A Leaflet renderer: it is placed, padded and zoom-animated as Leaflet's own canvas; it only draws puffs.
  function layer2d() {
    const Clouds = L.Renderer.extend({
      options: { padding: 0.25, pane: 'clouds' },
      _initContainer() { this._container = L.DomUtil.create('canvas', 'fg-clouds'); },
      _destroyContainer() { L.DomUtil.remove(this._container); delete this._container; },
      _update() {
        if (this._map._animatingZoom && this._bounds) return;
        L.Renderer.prototype._update.call(this);
        const b = this._bounds;
        const size = b.getSize();
        const c = this._container;
        L.DomUtil.setPosition(c, b.min);
        c.width = Math.max(1, Math.round(size.x / 2)); // half resolution: soft anyway, and a quarter of the pixels
        c.height = Math.max(1, Math.round(size.y / 2));
        c.style.width = `${size.x}px`;
        c.style.height = `${size.y}px`;
        draw2d(this);
      },
    });
    st.layer = new Clouds();
    return st.layer;
  }
  function draw2d(layer) {
    const map = layer._map;
    const c = layer._container;
    if (!map || !c || !layer._bounds) return;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    st.drawnT = G.state ? G.state.time : 0;
    st.n2d = 0;
    if (FG.view3d && FG.view3d.on) return; // (the 3D view draws its own)
    const zoom = map.getZoom();
    const fade = zoom <= 9 ? 1 : Math.max(0, (12 - zoom) / 3); // close to an airport the clouds give way
    if (!fade || !G.state) return;
    const b = layer._bounds;
    const nw = map.layerPointToLatLng(b.min);
    const se = map.layerPointToLatLng(b.max);
    const list = puffs({ n: nw.lat, s: se.lat, w: nw.lng, e: se.lng }, G.state.time, MAX_2D, false);
    const q = c.width / b.getSize().x;
    const spr = spritesOf();
    const world = 256 * 2 ** zoom;
    // (at night, js/daynight.js: the clouds dark and faint)
    const sp = FG.daynight && FG.daynight.enabled() ? G.sunPoint(G.state.time) : null;
    for (const p of list) {
      const lit = sp ? G.daylight(p.lat, p.lon, 0, sp) : 1;
      const rpx = (p.r / (EARTH_CIRC * Math.cos(p.lat * DEG) / world)) * q;
      if (rpx < 0.6) continue;
      const pt = map.latLngToLayerPoint([p.lat, p.lon]);
      const x = (pt.x - b.min.x) * q;
      const y = (pt.y - b.min.y) * q;
      const half = rpx * 1.2; // (the blob fills about 85% of its sprite)
      if (x + half < 0 || y + half < 0 || x - half > c.width || y - half > c.height) continue;
      g.globalAlpha = Math.min(1, p.a * 0.62 * fade) * (0.3 + 0.7 * lit);
      g.drawImage(spr[p.v][Math.min(3, Math.round(p.shade * 3 + (1 - lit) * 3))], x - half, y - half, half * 2, half * 2);
      st.n2d++;
    }
    g.globalAlpha = 1;
  }

  // ---------- overlay and chip (both maps) ----------
  function fxEl() {
    let el = document.getElementById('wx-fx');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wx-fx';
      el.innerHTML = '<i class="wx-a"></i><i class="wx-b"></i><i class="wx-flash"></i><div class="wx-chip" hidden></div>';
      document.getElementById('map').appendChild(el);
      el.querySelector('.wx-flash').addEventListener('animationend', (e) => e.target.classList.remove('on'));
    }
    return el;
  }
  const pad3 = (n) => String(n).padStart(3, '0');
  // One line about the weather: "🌧 Rain · 12 °C · wind 250° 18 kt, gusts 26".
  function text(w) {
    if (!w) return '';
    const vis = w.visKm != null && w.visKm < 8 ? ` · visibility ${w.visKm < 1 ? `${Math.round(w.visKm * 1000)} m` : `${w.visKm} km`}` : '';
    return `${w.icon} ${w.name} · ${w.tempC} °C · wind ${w.windKt < 3 ? 'calm' : `${pad3(w.windFrom)}° ${w.windKt} kt${w.gustKt ? `, gusts ${w.gustKt}` : ''}`}${vis}` +
      `${w.qnh ? ` · QNH ${w.qnh}` : ''}${w.live ? ' · real' : ''}`;
  }
  function enabled() {
    return !!(st.layer && FG.ui && FG.ui.map && FG.ui.map.hasLayer(st.layer));
  }
  // ---------- winds placed with the developer tools (G.placeWind) ----------
  // 2D: a dashed circle and an arrow badge (pointing where it blows to); 3D: the same badge over the canvas.
  const winds = { sig: null, group: null, els: [], m3: null };
  const badge = (w) => `<div class="wx-wind-in"><span class="wx-wind-arrow" style="transform: rotate(${w.from + 90}deg)">➜</span>${pad3(w.from)}° ${w.kt} kt</div>`;
  function syncWinds() {
    const map2 = FG.ui && FG.ui.map;
    if (!map2 || !G.state) return;
    const list = G.state.winds || [];
    const sig = list.map((w) => `${w.id}:${w.lat}:${w.lon}:${w.from}:${w.kt}:${w.km}`).join(',');
    if (sig !== winds.sig) {
      winds.sig = sig;
      if (!winds.group) winds.group = L.layerGroup().addTo(map2);
      winds.group.clearLayers();
      for (const w of list) {
        L.circle([w.lat, w.lon], { radius: w.km * 1000, pane: 'clouds', color: '#7dd3fc', weight: 1.5, dashArray: '6 6', fill: false, interactive: false }).addTo(winds.group);
        L.marker([w.lat, w.lon], { interactive: false, icon: L.divIcon({ className: 'wx-wind', html: badge(w), iconSize: null }) }).addTo(winds.group);
      }
      const fx = fxEl();
      for (const { e } of winds.els) e.remove();
      winds.els = list.map((w) => {
        const e = document.createElement('div');
        e.className = 'wx-wind wx-wind-3d';
        e.innerHTML = badge(w);
        fx.appendChild(e);
        return { e, w };
      });
    }
    const m3 = FG.view3d && FG.view3d.on && FG.view3d.map;
    if (m3 && winds.m3 !== m3) { winds.m3 = m3; m3.on('move', place3d); }
    place3d();
  }
  function place3d() {
    const m3 = FG.view3d && FG.view3d.on && FG.view3d.map;
    for (const { e, w } of winds.els) {
      e.hidden = !m3;
      if (!m3) continue;
      const p = m3.project([w.lon, w.lat]);
      e.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    }
  }

  // Once a second: the 2D clouds drift on, the overlay and the chip follow the map's centre.
  function tick() {
    if (document.hidden || !G.state || !FG.ui || !FG.ui.map) return;
    syncWinds();
    const on = enabled();
    const m3 = FG.view3d && FG.view3d.on && FG.view3d.map;
    const map2 = FG.ui.map;
    if (on && !m3 && st.layer._map) {
      const dt = Math.abs(G.state.time - st.drawnT);
      const pxPerDeg = (256 * 2 ** map2.getZoom()) / 360;
      if (dt * G.WX_DRIFT * pxPerDeg > 0.7 || dt > 20) draw2d(st.layer);
    }
    const el = fxEl();
    const c = m3 ? m3.getCenter() : map2.getCenter();
    const zoom = m3 ? m3.getZoom() + 1 : map2.getZoom(); // (MapLibre's zoom is one less for the same scale)
    const w = on && zoom >= 8 ? G.weatherAt(c.lat, c.lng, FG.ui.time) : null;
    let cls = '';
    if (w && zoom >= 10) {
      if (w.snow) cls = 'snow';
      else if (w.rain > 0.15) cls = w.rain > 0.6 ? 'rain heavy' : 'rain';
      if (w.fog) cls = 'fog';
      if (w.storm) cls += ' storm';
    }
    // (paused: the rain stands still)
    const full = `${cls}${cls && FG.ui.speed === 0 ? ' still' : ''}`;
    if (full !== st.fxClass) {
      st.fxClass = full;
      el.className = full;
    }
    // lightning: now and then while a thunderstorm is overhead (and the game runs)
    const flash = el.querySelector('.wx-flash');
    if (w && w.storm && zoom >= 7 && FG.ui.speed > 0 && Math.random() < 0.3) flash.classList.add('on');
    const chip = el.querySelector('.wx-chip');
    const line = w ? text(w) : '';
    if (line !== st.chip) {
      st.chip = line;
      chip.textContent = line;
      chip.hidden = !line;
    }
  }
  setInterval(tick, 1000);

  // ---------- live weather (Settings → Weather → Live) ----------
  // The real weather from Open-Meteo (free, no key; https://open-meteo.com): a 7.5° grid over the world for the next
  // day, again every 6 hours, and a 1.5° patch round where the player looks (zoomed in to 5 and closer, at most every
  // 2 minutes, again after an hour). Handed to the model (FG.wxModel.setLive); kept in IndexedDB so a reload doesn't
  // fetch it again. About 4,000 of Open-Meteo's 10,000 free calls a day when played all day.
  const LIVE_KEY = 'flightgame.weather';
  const LIVE_URL = 'https://api.open-meteo.com/v1/forecast';
  const LIVE_VARS = 'cloud_cover,precipitation,weather_code,temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,' +
    'wind_gusts_10m,pressure_msl,visibility,wind_speed_700hPa,wind_direction_700hPa,wind_speed_250hPa,wind_direction_250hPa';
  const WORLD = { lat0: -82.5, lon0: -180, step: 7.5, rows: 23, cols: 48, wrap: true, every: 6 * 3600000 };
  const PATCH = { step: 1.5, rows: 13, cols: 13, every: 3600000, gap: 120000 };
  const lv = { mode: 'sim', status: '', busy: false, worldAt: 0, patchAt: 0, patchTry: 0, patchC: null, first: true };
  try { lv.mode = JSON.parse(localStorage.getItem(LIVE_KEY) || '{}').mode === 'live' ? 'live' : 'sim'; } catch (e) { /* private mode */ }
  FG.wxModel.mode = lv.mode;

  async function fetchGrid(g) {
    const pts = [];
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) pts.push([g.lat0 + r * g.step, ((g.lon0 + c * g.step + 540) % 360) - 180]);
    const hours = 27;
    const n = g.rows * g.cols;
    const v = {};
    for (const k of ['cc', 'mm', 'code', 't', 'dew', 'u', 'v', 'gust', 'qnh', 'vis', 'u7', 'v7', 'u25', 'v25']) v[k] = new Float32Array(hours * n);
    let t0 = 0;
    for (let i = 0; i < pts.length; i += 160) {
      const part = pts.slice(i, i + 160);
      const url = `${LIVE_URL}?latitude=${part.map((p) => p[0].toFixed(2)).join(',')}&longitude=${part.map((p) => p[1].toFixed(2)).join(',')}` +
        `&hourly=${LIVE_VARS}&wind_speed_unit=kn&past_hours=2&forecast_hours=25&timeformat=unixtime`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`weather ${res.status}`);
      let js = await res.json();
      if (!Array.isArray(js)) js = [js];
      js.forEach((d, j) => {
        const h = d.hourly;
        const cell = i + j;
        const el = Math.max(0, d.elevation || 0);
        t0 = h.time[0] * 1000;
        const uv = (spd, dir) => [-(spd || 0) * Math.sin((dir || 0) * DEG), -(spd || 0) * Math.cos((dir || 0) * DEG)];
        for (let k = 0; k < hours; k++) {
          const o = k * n + cell;
          const q = Math.min(k, h.time.length - 1);
          v.cc[o] = (h.cloud_cover[q] ?? 50) / 100;
          v.mm[o] = h.precipitation[q] ?? 0;
          v.code[o] = h.weather_code[q] ?? 0;
          v.t[o] = (h.temperature_2m[q] ?? 15) + 0.0065 * el; // (at sea level: the model takes the height off again)
          v.dew[o] = (h.dew_point_2m[q] ?? 10) + 0.002 * el;
          [v.u[o], v.v[o]] = uv(h.wind_speed_10m[q], h.wind_direction_10m[q]);
          v.gust[o] = h.wind_gusts_10m[q] ?? 0;
          v.qnh[o] = h.pressure_msl[q] ?? 1013;
          v.vis[o] = h.visibility[q] ?? 20000;
          [v.u7[o], v.v7[o]] = uv(h.wind_speed_700hPa[q], h.wind_direction_700hPa[q]);
          [v.u25[o], v.v25[o]] = uv(h.wind_speed_250hPa[q], h.wind_direction_250hPa[q]);
        }
      });
    }
    return { t0, hours, lat0: g.lat0, lon0: g.lon0, step: g.step, rows: g.rows, cols: g.cols, wrap: !!g.wrap, v, at: Date.now() };
  }
  // A grid kept in IndexedDB (Float32Arrays survive the structured clone).
  const idbGet = (k) => (FG.idb ? FG.idb.get(k).catch(() => null) : Promise.resolve(null));
  const idbSet = (k, g) => { if (FG.idb) FG.idb.set(k, g).catch(() => {}); };
  function arrived(which, grid) {
    FG.wxModel.setLive(which, grid);
    if (which === 'world' && lv.first) { lv.first = false; if (G.liveArrived) G.liveArrived(); }
    lv.status = `real weather from ${new Date(grid.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (FG.weather) FG.weather.redraw();
  }
  async function liveTick() {
    if (lv.mode !== 'live' || lv.busy || document.hidden || !navigator.onLine) return;
    lv.busy = true;
    try {
      const now = Date.now();
      if (!FG.wxModel.live.world) {
        const kept = await idbGet('flightgame.wx.world');
        if (kept && now - kept.at < WORLD.every) { lv.worldAt = kept.at; arrived('world', kept); }
      }
      if (now - lv.worldAt > WORLD.every) {
        lv.status = 'fetching the real weather…';
        const g = await fetchGrid(WORLD);
        lv.worldAt = now;
        idbSet('flightgame.wx.world', g);
        arrived('world', g);
      }
      // the patch where the player looks
      const m3 = FG.view3d && FG.view3d.on && FG.view3d.map;
      const map2 = FG.ui && FG.ui.map;
      const c = m3 ? m3.getCenter() : map2 && map2.getCenter();
      const zoom = m3 ? m3.getZoom() + 1 : map2 ? map2.getZoom() : 0;
      if (c && zoom >= 5 && now - lv.patchTry > PATCH.gap) {
        const far = !lv.patchC || Math.abs(c.lat - lv.patchC[0]) > 4.5 || Math.abs(((c.lng - lv.patchC[1] + 540) % 360) - 180) > 4.5;
        if (far || now - lv.patchAt > PATCH.every) {
          lv.patchTry = now;
          const la = Math.max(-80, Math.min(80, Math.round(c.lat / 1.5) * 1.5));
          const lo = Math.round(c.lng / 1.5) * 1.5;
          const g = await fetchGrid({ ...PATCH, lat0: la - 9, lon0: lo - 9 });
          lv.patchAt = now;
          lv.patchC = [la, lo];
          arrived('patch', g);
        }
      }
    } catch (e) {
      lv.status = `no real weather (${e.message || e}): made up until it comes`;
    } finally {
      lv.busy = false;
    }
  }
  setInterval(liveTick, 5000);
  // Settings → Weather: 'sim' (made up from the real climate) or 'live'.
  function setMode(mode) {
    lv.mode = mode === 'live' ? 'live' : 'sim';
    FG.wxModel.mode = lv.mode;
    try { localStorage.setItem(LIVE_KEY, JSON.stringify({ mode: lv.mode })); } catch (e) { /* private mode */ }
    if (lv.mode === 'live') liveTick();
    if (G.liveArrived && FG.wxModel.live.world) G.liveArrived(); // (the runways follow the other weather)
    if (lv.mode === 'sim') lv.status = '';
    FG.weather.redraw();
  }

  FG.weather = {
    puffs,
    layer2d,
    enabled,
    text,
    // the white blob for the 3D sprites (one look: they are turned at random)
    sprite: () => spritesOf()[0][0],
    redraw() { if (st.layer && st.layer._map) draw2d(st.layer); },
    syncWinds,
    setMode,
    get mode() { return lv.mode; },
    get liveStatus() { return lv.status; },
    get stats() { return { puffs2d: st.n2d, puffs3d: st.n3d, overlay: st.fxClass, chip: st.chip }; },
    set n3d(n) { st.n3d = n; },
  };
})();
