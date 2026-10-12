// Airport screenshots for checking: node apshot.mjs CODE... [--zoom z] [--size WxH]
// Needs chromium running with tools/agent/start.sh running (chromium on CDP_PORT, the game on GAME_PORT).
// For each airport: <code>-game.png (game layout over satellite) and <code>-sat.png (satellite only),
// plus <code>.json (the game's layout: runways, taxiways, aprons, buildings, stands).
import fs from 'node:fs';
const OUT = new URL('./shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const zoomOpt = opt('zoom', null);
const atOpt = opt('at', null); // lat,lon,zoom: only a detail shot there (CODE-detail.png, CODE-detailsat.png)
const [W, H] = opt('size', '1600x1200').split('x').map(Number);
const codes = args.map((c) => c.toUpperCase());

const tabs = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9447}/json`)).json();
const page = tabs.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const waits = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const killer = setTimeout(() => { console.error('timeout'); process.exit(2); }, 60000 + codes.length * 45000);

await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const ready = await ev(`!!(window.FG && FG.ui && FG.ui.map)`);
if (!ready || process.env.RELOAD) {
  await send('Network.enable'); await send('Network.clearBrowserCache');
  const cur = await ev('location.href').catch(() => '');
  if (cur.startsWith(`http://127.0.0.1:${process.env.GAME_PORT || 8848}/`)) await send('Page.reload', { ignoreCache: true }); else await send('Page.navigate', { url: `http://127.0.0.1:${process.env.GAME_PORT || 8848}/index.html` });
  await sleep(1500);
  for (let i = 0; i < 120 && !(await ev(`!!(window.FG && FG.ui && FG.ui.map)`).catch(() => false)); i++) await sleep(500);
}
await ev(`(() => {
  document.getElementById('start-screen').hidden = true;
  for (const id of ['topbar','rail','strip','sidebar','toast','newspaper']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
  const s = document.createElement('style'); s.textContent = '.leaflet-control-container{display:none}'; document.head.appendChild(s);
  if (!document.getElementById('view3d').hidden) document.getElementById('view3d-toggle').click();
  if (FG.airportEdit && FG.airportEdit.on) FG.airportEdit.toggle();
  window.dispatchEvent(new Event('resize')); FG.ui.map.invalidateSize();
})()`);

for (const code of codes) {
  // Load its layout and wait until the lookup is over.
  await ev(`(FG.layouts.get(${JSON.stringify(code)}), FG.game.apronOf(${JSON.stringify(code)}), 1)`);
  for (let i = 0; i < 60 && !(await ev(`FG.layouts.settled(${JSON.stringify(code)}) && !FG.layouts.pending(${JSON.stringify(code)})`)); i++) await sleep(500);
  const info = await ev(`(() => {
    const code = ${JSON.stringify(code)};
    const G = FG.game, a = G.airportByCode[code];
    const lay = FG.layouts.get(code);
    const ap = G.apronOf(code);
    const rws = G.airportRunways(code);
    const pts = [[a.lat, a.lon]];
    for (const r of rws) pts.push([r[0], r[1]], [r[2], r[3]]);
    if (lay) for (const k of ['aprons','terminals','hangars','buildings']) for (const p of lay[k] || []) for (const q of (p.ring || p)) if (Array.isArray(q)) pts.push(q);
    return { name: a.name, city: a.city, size: G.airportSize(code), real: !!lay, lat: a.lat, lon: a.lon,
      runways: rws, layoutKeys: lay ? Object.fromEntries(Object.entries(lay).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v])) : null,
      stands: ap && ap.stands ? ap.stands.map((s) => [+s.lat.toFixed(5), +s.lon.toFixed(5), Math.round(s.heading), s.name, s.bridge ? 'bridge' : '']) : null,
      bridgesFlag: lay ? lay.bridges : null, source: lay ? lay.source : 'made-up', file: FG.layouts.has(code) && !!(lay && lay.fixed !== undefined),
      apronPts: (ap && ap.stands || []).map((s) => [s.lat, s.lon]).concat(...((lay && lay.terminals) || [])), pts };
  })()`);
  if (atOpt) {
    const [la, lo, z] = atOpt.split(',').map(Number);
    await ev(`(FG.ui.selectAirport(${JSON.stringify(code)}), FG.ui.map.setView([${la}, ${lo}], ${z}, { animate: false }), FG.game.dirty = true)`);
    await sleep(2000);
    for (let i = 0; i < 30 && (await ev(`document.querySelectorAll('.leaflet-tile-container img:not(.leaflet-tile-loaded)').length`)) > 0; i++) await sleep(500);
    await sleep(800);
    const prev = fs.existsSync(`${OUT}${code}.json`) ? JSON.parse(fs.readFileSync(`${OUT}${code}.json`)) : {};
    prev.views = prev.views || {};
    for (const name of ['detail', 'detailsat']) {
      if (name === 'detailsat') { await ev(`document.querySelectorAll('.leaflet-pane:not(.leaflet-tile-pane):not(.leaflet-map-pane)').forEach((p) => p.style.visibility = 'hidden')`); await sleep(300); }
      prev.views[name] = await ev(`(() => { const b = FG.ui.map.getPixelBounds(); return { zoom: FG.ui.map.getZoom(), x: b.min.x, y: b.min.y }; })()`);
      fs.writeFileSync(`${OUT}${code}-${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
    }
    await ev(`document.querySelectorAll('.leaflet-pane').forEach((p) => p.style.visibility = '')`);
    fs.writeFileSync(`${OUT}${code}.json`, JSON.stringify(prev, null, 1));
    console.log(code, 'detail', atOpt);
    continue;
  }
  const lats = info.pts.map((p) => p[0]), lons = info.pts.map((p) => p[1]);
  const b = [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]];
  await ev(`(() => { FG.ui.selectAirport(${JSON.stringify(code)});
    FG.ui.map.fitBounds(${JSON.stringify(b)}, { padding: [30, 30], animate: false, maxZoom: 17 });
    ${zoomOpt ? `FG.ui.map.setZoom(${zoomOpt}, { animate: false });` : ''}
    FG.game.dirty = true; return FG.ui.map.getZoom(); })()`);
  await sleep(2500);
  // Wait for the satellite tiles.
  for (let i = 0; i < 30 && (await ev(`document.querySelectorAll('.leaflet-tile-container img:not(.leaflet-tile-loaded)').length`)) > 0; i++) await sleep(500);
  await sleep(800);
  const zoom = await ev(`FG.ui.map.getZoom()`);
  info.views = info.views || {};
  const shot = async (name) => {
    info.views[name] = await ev(`(() => { const b = FG.ui.map.getPixelBounds(); return { zoom: FG.ui.map.getZoom(), x: b.min.x, y: b.min.y }; })()`);
    fs.writeFileSync(`${OUT}${code}-${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  };
  await shot('game');
  await ev(`document.querySelectorAll('.leaflet-pane:not(.leaflet-tile-pane):not(.leaflet-map-pane)').forEach((p) => p.style.visibility = 'hidden')`);
  await sleep(300);
  await shot('sat');
  await ev(`document.querySelectorAll('.leaflet-pane').forEach((p) => p.style.visibility = '')`);
  // Close-up of the stands and terminals.
  if (info.apronPts.length && !zoomOpt) {
    const la = info.apronPts.map((p) => p[0]), lo = info.apronPts.map((p) => p[1]);
    await ev(`(FG.ui.map.fitBounds(${JSON.stringify([[Math.min(...la), Math.min(...lo)], [Math.max(...la), Math.max(...lo)]])}, { padding: [60, 60], animate: false, maxZoom: 18 }), FG.game.dirty = true)`);
    await sleep(2000);
    for (let i = 0; i < 30 && (await ev(`document.querySelectorAll('.leaflet-tile-container img:not(.leaflet-tile-loaded)').length`)) > 0; i++) await sleep(500);
    await sleep(800);
    info.apronZoom = await ev(`FG.ui.map.getZoom()`);
    await shot('apron');
    await ev(`document.querySelectorAll('.leaflet-pane:not(.leaflet-tile-pane):not(.leaflet-map-pane)').forEach((p) => p.style.visibility = 'hidden')`);
    await sleep(300);
    await shot('apronsat');
    await ev(`document.querySelectorAll('.leaflet-pane').forEach((p) => p.style.visibility = '')`);
  }
  delete info.pts; delete info.apronPts;
  info.zoom = zoom;
  fs.writeFileSync(`${OUT}${code}.json`, JSON.stringify(info, null, 1));
  console.log(code, JSON.stringify({ ...info, stands: info.stands && info.stands.length }));
}
clearTimeout(killer);
ws.close();
