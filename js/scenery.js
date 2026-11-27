// Prepared scenery (FG.scenery): an area picked on a map whose 3D ground is fetched ahead, so it is sharp and there
// at once when flown over (and works offline). Its satellite pictures at every zoom up to the detail picked (the
// airports in it finer still) and its heights go into the browser's Cache Storage (CACHE); the 3D view reads the
// pictures through the protocol fgsat:// (FG.scenery.protocol, view3d.js) and the heights through FG.scenery.fetch
// (flatground.js), both from that cache first. The areas are listed in localStorage (KEY).
// FG.scenery.open({ code }) shows the picker: click two corners on the map, pick the detail, Prepare.
// (Same tiles and rules as the Rust app's src/scenery.rs.)
(function () {
  const CACHE = 'flightgame-scenery-1';
  const KEY = 'flightgame.scenery';
  const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const DEM = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
  const ZMIN = 6, ZMAX = 18;
  const DEM_Z = 13;        // the heights' finest zoom the 3D map loads (its hillshade; the terrain stops at 12)
  const DETAILS = [[15, 'Good · about 3 m a pixel'], [16, 'Sharp · about 1.5 m a pixel'], [17, 'Very sharp · under 1 m a pixel']];
  const AIRPORT_M = 2500;  // the airports in an area: their ground at zoom 17 this far round them,
  const AIRPORT_FINE_M = 1200; // and at 18 this far round those of size 2 and up
  const MAX_FILES = 150000;
  const WORKERS = 16;      // downloads at once (Esri takes ~5 s over a picture it has not served lately)
  const AVG = { sat: 16300, dem: 60000 }; // bytes a file, about
  const ok = typeof caches !== 'undefined' && window.isSecureContext;

  // ---------- tiles ----------
  const n2 = (z) => 2 ** z;
  function tileXY(z, lat, lon) {
    const n = n2(z), lr = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
    return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n];
  }
  function tileBox(z, x, y) { // [s, w, n, e]
    const n = n2(z);
    const lat = (t) => Math.atan(Math.sinh(Math.PI * (1 - 2 * t / n))) * 180 / Math.PI;
    return [lat(y + 1), x / n * 360 - 180, lat(y), (x + 1) / n * 360 - 180];
  }
  function tilesIn(z, s, w, n, e, out) {
    const [x0, y0] = tileXY(z, n, w), [x1, y1] = tileXY(z, s, e);
    const max = n2(z) - 1;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(max, Math.floor(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(max, Math.floor(x1)); x++) out.push([z, x, y]);
    }
    return out;
  }
  const countIn = (z, s, w, n, e) => {
    const [x0, y0] = tileXY(z, n, w), [x1, y1] = tileXY(z, s, e);
    return (Math.floor(x1) - Math.floor(x0) + 1) * (Math.floor(y1) - Math.floor(y0) + 1);
  };
  const satUrl = (z, x, y) => SAT.replace('{z}', z).replace('{y}', y).replace('{x}', x);
  const demUrl = (z, x, y) => DEM.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  function airportsIn(a) {
    const out = [];
    for (const r of (FG.data && FG.data.airports) || []) {
      const p = Array.isArray(r) ? { lat: r[4], lon: r[5], size: r[6] } : r;
      if (p.lat >= a.s && p.lat <= a.n && p.lon >= a.w && p.lon <= a.e) out.push(p);
    }
    return out;
  }
  const reach = (z, size) => (z <= 17 ? AIRPORT_M : (size || 0) >= 2 ? AIRPORT_FINE_M : 0);
  function satTiles(a) {
    const out = [];
    for (let z = ZMIN; z <= Math.min(a.zmax, ZMAX); z++) tilesIn(z, a.s, a.w, a.n, a.e, out);
    const seen = new Set();
    for (const p of airportsIn(a)) {
      for (let z = a.zmax + 1; z <= ZMAX; z++) {
        const r = reach(z, p.size);
        if (!r) continue;
        const dl = r / 111320, dn = dl / Math.max(0.05, Math.cos(p.lat * Math.PI / 180));
        for (const t of tilesIn(z, p.lat - dl, p.lon - dn, p.lat + dl, p.lon + dn, [])) {
          const k = t.join('/');
          if (!seen.has(k)) { seen.add(k); out.push(t); }
        }
      }
    }
    return out.sort((p, q) => p[0] - q[0]);
  }
  // Everything an area needs, coarse first (a part done is of use all over it): [url, kind].
  function plan(a) {
    const out = [];
    for (let z = ZMIN; z <= DEM_Z; z++) for (const [tz, x, y] of tilesIn(z, a.s, a.w, a.n, a.e, [])) out.push([demUrl(tz, x, y), 'dem']);
    for (const [z, x, y] of satTiles(a)) out.push([satUrl(z, x, y), 'sat']);
    return out;
  }
  function estimate(a) {
    let dem = 0, sat = 0;
    for (let z = ZMIN; z <= DEM_Z; z++) dem += countIn(z, a.s, a.w, a.n, a.e);
    for (let z = ZMIN; z <= Math.min(a.zmax, ZMAX); z++) sat += countIn(z, a.s, a.w, a.n, a.e);
    const ports = airportsIn(a);
    for (let z = a.zmax + 1; z <= ZMAX; z++) {
      const side = 40075016 * Math.cos((a.s + a.n) / 2 * Math.PI / 180) / n2(z);
      for (const p of ports) { const r = reach(z, p.size); if (r) sat += (Math.ceil(2 * r / side) + 1) ** 2; }
    }
    return { files: dem + sat, bytes: sat * AVG.sat + dem * AVG.dem };
  }

  // ---------- the areas ----------
  let areas = [];
  try { areas = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { areas = []; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(areas)); } catch (e) { /* (full) */ } };
  const hits = (s, w, n, e) => areas.some((a) => a.s < n && a.n > s && a.w < e && a.e > w);

  // ---------- reading: the cache first ----------
  let cacheP = null;
  const cache = () => cacheP || (cacheP = caches.open(CACHE));
  // fetch(url) from the cache when it is there (only where an area lies: elsewhere straight to the network)
  const stats = { cache: 0, net: 0 }; // tiles read from the cache and from the network (the smoke test looks)
  async function cachedFetch(url, opts, box) {
    if (ok && areas.length && (!box || hits(...box))) {
      try { const r = await (await cache()).match(url); if (r) { stats.cache++; return r; } } catch (e) { /* (no cache: the network) */ }
    }
    stats.net++;
    return fetch(url, opts);
  }
  // FG.scenery.fetch(url, opts, z, x, y): a heights tile (flatground.js)
  function fetchTile(url, opts, z, x, y) { return cachedFetch(url, opts, z == null ? null : tileBox(z, x, y)); }
  // MapLibre protocol fgsat://z/y/x: the satellite picture
  async function protocol(params, abort) {
    const [z, y, x] = params.url.replace(/^fgsat:\/\//, '').split(/[/?]/).map(Number);
    const r = await cachedFetch(satUrl(z, x, y), { signal: abort && abort.signal }, tileBox(z, x, y));
    if (r.ok) return { data: await r.arrayBuffer() };
    throw Object.assign(new Error(`satellite tile ${r.status}`), { status: r.status });
  }

  // ---------- fetching an area ----------
  let job = null; // { area, list, next, done, failed, bytes, stop, listeners }
  function start(area) {
    if (!ok || job) return;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const list = plan(area);
    job = { area, list, next: 0, done: 0, failed: 0, bytes: 0, stop: false };
    const j = job;
    const one = async () => {
      const c = await cache();
      while (!j.stop && j.next < j.list.length) {
        const [url] = j.list[j.next++];
        try {
          let r = await c.match(url);
          if (!r) {
            r = await fetch(url);
            if (r.ok) await c.put(url, r.clone());
            else if (r.status !== 404) throw new Error(String(r.status)); // (404: no picture or height there, the sea)
          }
          j.bytes += Number(r.headers.get('content-length')) || (r.ok ? AVG.sat : 0);
        } catch (e) { j.failed++; }
        j.done++;
      }
    };
    Promise.all(Array.from({ length: WORKERS }, one)).then(() => {
      const a = { ...j.area, files: j.done - j.failed, bytes: j.bytes, complete: !j.stop && j.done >= j.list.length && j.failed * 50 <= j.list.length };
      areas = areas.filter((b) => !(b.s === a.s && b.w === a.w && b.n === a.n && b.e === a.e));
      areas.push(a);
      save();
      job = null;
      render();
    });
    render();
  }
  async function remove(i) {
    const a = areas[i];
    if (!a) return;
    areas.splice(i, 1);
    save();
    if (ok) {
      const keep = new Set(areas.flatMap((b) => satTiles(b).map((t) => satUrl(...t))));
      const c = await cache();
      for (const t of satTiles(a)) { const u = satUrl(...t); if (!keep.has(u)) c.delete(u); }
    }
    render();
  }

  // ---------- the picker ----------
  const mb = (b) => (b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 2 ** 20))} MB`);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function around(lat, lon, km) {
    const dl = km * 500 / 111320, dn = dl / Math.max(0.05, Math.cos(lat * Math.PI / 180));
    return { s: lat - dl, w: lon - dn, n: lat + dl, e: lon + dn };
  }
  const sizeKm = (r) => [(r.e - r.w) * 111.32 * Math.cos((r.s + r.n) / 2 * Math.PI / 180), (r.n - r.s) * 111.32];
  let ui = null; // { el, map, rect, corner, zmax, name, code, layers }
  function css() {
    if (document.getElementById('scenery-css')) return;
    const st = document.createElement('style');
    st.id = 'scenery-css';
    st.textContent = `
#scenery { position: fixed; inset: 0; z-index: 4000; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; }
#scenery .sc-card { width: min(1100px, 96vw); height: min(720px, 92vh); display: flex; background: var(--panel, #161b22); color: var(--text, #e6edf3);
  border: 1px solid var(--border, #30363d); border-radius: 10px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,.5); }
#scenery .sc-map { flex: 1; min-width: 0; cursor: crosshair; }
#scenery .sc-side { width: 330px; padding: 14px 16px; overflow: auto; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
#scenery h2 { margin: 0; font-size: 17px; }
#scenery .sc-muted { color: var(--muted, #8b949e); font-size: 12px; margin: 0; }
#scenery .sc-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
#scenery button { padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border, #30363d); background: transparent; color: inherit; cursor: pointer; }
#scenery button.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; font-weight: 600; }
#scenery button:disabled { opacity: .45; cursor: default; }
#scenery input, #scenery select { background: transparent; color: inherit; border: 1px solid var(--border, #30363d); border-radius: 6px; padding: 4px 6px; }
#scenery select option { background: var(--panel, #161b22); }
#scenery .sc-bar { height: 8px; border-radius: 4px; background: rgba(127,127,127,.25); overflow: hidden; }
#scenery .sc-bar i { display: block; height: 100%; background: #2ea043; }
#scenery .sc-list div { display: flex; gap: 6px; align-items: center; padding: 3px 0; border-top: 1px solid var(--border, #30363d); }
#scenery .sc-list span { flex: 1; }
#scenery .sc-bad { color: #f85149; }`;
    document.head.appendChild(st);
  }
  function open(opts = {}) {
    if (!window.L) return;
    css();
    close();
    const ap = opts.code && FG.data && (FG.data.airports || []).find((a) => (Array.isArray(a) ? a[0] : a.code) === opts.code);
    const a0 = ap && (Array.isArray(ap) ? { code: ap[0], lat: ap[4], lon: ap[5] } : ap);
    const el = document.createElement('div');
    el.id = 'scenery';
    el.innerHTML = `<div class="sc-card" role="dialog" aria-modal="true" aria-label="Prepare scenery"><div class="sc-map"></div><div class="sc-side"></div></div>`;
    document.body.appendChild(el);
    const map = L.map(el.querySelector('.sc-map'), { zoomControl: true, attributionControl: true, doubleClickZoom: false });
    L.tileLayer(SAT, { maxZoom: 18, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }).addTo(map);
    ui = { el, map, rect: a0 ? around(a0.lat, a0.lon, 40) : null, corner: null, zmax: 16, name: a0 ? a0.code : '', code: a0 && a0.code, a0, layers: L.layerGroup().addTo(map), live: null };
    if (ui.rect) fit(ui.rect); else map.setView([47, 8], 6);
    map.on('click', (e) => {
      const p = [e.latlng.lat, e.latlng.lng];
      if (!ui.corner) { ui.corner = p; ui.rect = null; }
      else {
        const c = ui.corner;
        ui.corner = null;
        const r = { s: Math.min(c[0], p[0]), w: Math.min(c[1], p[1]), n: Math.max(c[0], p[0]), e: Math.max(c[1], p[1]) };
        ui.rect = sizeKm(r)[0] < 0.5 ? around(p[0], p[1], 20) : r; // (a click without moving: 20 km round it)
      }
      render();
    });
    map.on('mousemove', (e) => {
      if (!ui.corner) return;
      const c = ui.corner, p = [e.latlng.lat, e.latlng.lng];
      const b = [[Math.min(c[0], p[0]), Math.min(c[1], p[1])], [Math.max(c[0], p[0]), Math.max(c[1], p[1])]];
      if (ui.live) ui.live.setBounds(b); else ui.live = L.rectangle(b, { color: '#00c8ff', weight: 2, fillOpacity: 0.12, interactive: false }).addTo(map);
    });
    el.addEventListener('click', (e) => {
      if (e.target === el) { close(); return; }
      const b = e.target.closest('button[data-sc]');
      if (!b) return;
      const k = b.dataset.sc;
      if (k === 'close') close();
      else if (k === 'km' && ui.a0) { ui.corner = null; ui.rect = around(ui.a0.lat, ui.a0.lon, Number(b.dataset.km)); fit(ui.rect); render(); }
      else if (k === 'go' && ui.rect) start({ ...ui.rect, zmax: ui.zmax, name: (ui.name || '').trim() || `${((ui.rect.s + ui.rect.n) / 2).toFixed(2)}, ${((ui.rect.w + ui.rect.e) / 2).toFixed(2)}` });
      else if (k === 'stop' && job) job.stop = true;
      else if (k === 'show') { const a = areas[Number(b.dataset.i)]; if (a) { ui.rect = { s: a.s, w: a.w, n: a.n, e: a.e }; ui.zmax = a.zmax; ui.name = a.name; fit(ui.rect); render(); } }
      else if (k === 'del') remove(Number(b.dataset.i));
    });
    el.addEventListener('change', (e) => { if (e.target.id === 'sc-detail') { ui.zmax = Number(e.target.value); render(); } });
    el.addEventListener('input', (e) => { if (e.target.id === 'sc-name') ui.name = e.target.value; });
    el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    render();
    setTimeout(() => { if (ui && ui.map === map) map.invalidateSize(); }, 50); // (not if closed already)
  }
  function fit(r) { if (ui) ui.map.fitBounds([[r.s, r.w], [r.n, r.e]], { padding: [30, 30] }); }
  function close() {
    if (!ui) return;
    ui.map.remove();
    ui.el.remove();
    ui = null;
  }
  let tick = null;
  function render() {
    if (job && !tick) tick = setInterval(() => { if (!job) { clearInterval(tick); tick = null; } render(); }, 400);
    if (typeof FG.scenery.onchange === 'function') FG.scenery.onchange();
    if (!ui) return;
    ui.layers.clearLayers();
    if (ui.live && !ui.corner) { ui.live.remove(); ui.live = null; }
    for (const a of areas) L.rectangle([[a.s, a.w], [a.n, a.e]], { color: a.complete ? '#3fb950' : '#d29922', weight: 1.5, fill: false, interactive: false }).addTo(ui.layers);
    if (ui.rect) L.rectangle([[ui.rect.s, ui.rect.w], [ui.rect.n, ui.rect.e]], { color: '#00c8ff', weight: 2, fillOpacity: 0.12, interactive: false }).addTo(ui.layers);
    const side = ui.el.querySelector('.sc-side');
    const focus = document.activeElement && document.activeElement.id; // (typing a name: keep the box)
    let h = `<div class="sc-row" style="justify-content:space-between"><h2>🗺 Prepare scenery</h2><button data-sc="close" title="Close (Esc)">✕</button></div>
      <p class="sc-muted">Pick an area and its 3D ground is fetched ahead: sharp and there at once when you fly over it, even offline.</p>
      <p class="sc-muted">${ui.corner ? 'Click the other corner.' : 'Click two corners on the map (or one spot: 20 km round it).'}</p>`;
    if (!ok) h += '<p class="sc-bad">This browser can\'t keep scenery here (it needs https or localhost).</p>';
    if (ui.a0) h += `<div class="sc-row">Round ${esc(ui.a0.code)}: ${[20, 40, 80].map((km) => `<button data-sc="km" data-km="${km}">${km} km</button>`).join('')}</div>`;
    if (ui.rect) {
      const [w, hk] = sizeKm(ui.rect);
      const est = estimate({ ...ui.rect, zmax: ui.zmax });
      h += `<p>Area: ${Math.round(w)} × ${Math.round(hk)} km</p>
        <label class="sc-row">Name <input id="sc-name" value="${esc(ui.name || '')}" style="flex:1"></label>
        <label class="sc-row">Detail <select id="sc-detail">${DETAILS.map(([z, n]) => `<option value="${z}"${z === ui.zmax ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <p class="sc-muted">${est.files.toLocaleString()} files, about ${mb(est.bytes)} (what is already kept isn't fetched again). Airports in it get the finest pictures.</p>
        ${est.files > MAX_FILES ? '<p class="sc-bad">Too big for that detail: pick a smaller area or less detail.</p>' : ''}
        <div class="sc-row"><button class="primary" data-sc="go"${!ok || job || est.files > MAX_FILES ? ' disabled' : ''}>⬇ Prepare</button></div>`;
    }
    if (job) {
      const f = job.done / Math.max(1, job.list.length);
      h += `<p>Preparing ${esc(job.area.name)}</p><div class="sc-bar"><i style="width:${(f * 100).toFixed(1)}%"></i></div>
        <div class="sc-row"><span class="sc-muted" style="flex:1">${job.done.toLocaleString()} / ${job.list.length.toLocaleString()} files · ${mb(job.bytes)}${job.failed ? ` · ${job.failed} failed` : ''}</span><button data-sc="stop">Stop</button></div>`;
    }
    if (areas.length) {
      h += `<h3 style="margin:6px 0 0;font-size:14px">Prepared</h3><div class="sc-list">${areas.map((a, i) => {
        const [w, hk] = sizeKm(a);
        const det = ['good', 'sharp', 'very sharp'][DETAILS.findIndex((d) => d[0] === a.zmax)] || '';
        return `<div><span title="${a.complete ? 'All fetched' : 'Stopped part way: Prepare it again to finish'}">${a.complete ? '✔' : '◐'} ${esc(a.name)} · ${Math.round(w)}×${Math.round(hk)} km · ${det} · ${mb(a.bytes || 0)}</span>
          <button data-sc="show" data-i="${i}">Show</button><button data-sc="del" data-i="${i}" title="Delete it (its pictures out of the browser)">🗑</button></div>`;
      }).join('')}</div>`;
    }
    side.innerHTML = h;
    if (focus === 'sc-name') { const i = side.querySelector('#sc-name'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }
  // a line for others' pages (the fly start screen): what is prepared and what is being fetched
  function status() {
    if (job) return `Preparing ${job.area.name}: ${Math.round(job.done / Math.max(1, job.list.length) * 100)} %`;
    return areas.length ? `${areas.length} area${areas.length > 1 ? 's' : ''} prepared` : '';
  }

  FG.scenery = { ok, protocol, fetch: fetchTile, open, close, status, onchange: null, get areas() { return areas.slice(); }, get busy() { return !!job; }, stats, _start: start, _remove: remove, _plan: plan, _estimate: estimate };
})();
