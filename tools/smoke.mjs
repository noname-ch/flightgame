#!/usr/bin/env node
// Smoke test: serves the game, loads it in headless Chrome, starts a new airline, flies a timetable
// for a few game days at full speed, opens every section, the airport editor and the 3D view, and fails on any script
// error, console.error or missing file of our own. Map tiles and CDNs that fail are only warnings.
//
//   node tools/smoke.mjs            (needs Node 22+ and Chrome or Chromium; CHROME=/path overrides)
//
// Runs on every push (.github/workflows/smoke.yml).

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MAX_RUN_MS = 6 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const warnings = [];

// ---------- static server on a free port ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (file.endsWith('/')) file += 'index.html';
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ---------- headless Chrome ----------
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try { return execFileSync('which', [name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* next */ }
  }
  throw new Error('No Chrome or Chromium found (set CHROME=/path/to/chrome)');
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-smoke-'));
const chrome = spawn(findChrome(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
  '--no-sandbox', '--window-size=1400,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on('exit', (code) => reject(new Error(`Chrome exited (${code}) before it was ready`)));
});

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  chrome.kill('SIGKILL');
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* Chrome still writing: left for the OS */ }
  process.exit(code);
}
setTimeout(() => { console.error(`✗ smoke test took longer than ${MAX_RUN_MS / 60000} min`); finish(1); }, MAX_RUN_MS).unref();

// ---------- DevTools protocol ----------
const browser = new WebSocket(wsUrl);
await new Promise((r) => browser.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map();
const handlers = [];
browser.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
  } else if (msg.method) for (const h of handlers) h(msg);
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  browser.send(JSON.stringify({ id, method, params, sessionId }));
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const cmd = (method, params) => send(method, params, sessionId);

const ours = (url) => url && url.startsWith(ORIGIN);
const where = (st) => {
  const f = st && st.callFrames && st.callFrames[0];
  return f ? ` (${f.url.replace(ORIGIN, '')}:${f.lineNumber + 1})` : '';
};
const requests = new Map();
handlers.push((msg) => {
  if (msg.sessionId !== sessionId) return;
  const p = msg.params;
  switch (msg.method) {
    case 'Runtime.exceptionThrown': {
      const d = p.exceptionDetails;
      const text = (d.exception && d.exception.description) || d.text;
      const url = d.url || (d.stackTrace && d.stackTrace.callFrames[0] && d.stackTrace.callFrames[0].url) || '';
      // A script from a CDN failing is the network's fault; ours failing is a bug.
      if (url && !ours(url) && !text.includes(ORIGIN)) warnings.push(`script error in ${url}: ${text.split('\n')[0]}`);
      else errors.push(`exception: ${text}`);
      break;
    }
    case 'Runtime.consoleAPICalled':
      if (p.type === 'error' || p.type === 'assert') {
        const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
        errors.push(`console.${p.type}: ${text}${where(p.stackTrace)}`);
      }
      break;
    case 'Network.requestWillBeSent': requests.set(p.requestId, p.request.url); break;
    case 'Network.responseReceived':
      // (the airport editor asks whether ./play.sh's server is there: not on a plain server)
      if (ours(p.response.url) && p.response.status >= 400 && !/\/__(fixes|checks|bugs)\b/.test(p.response.url)) errors.push(`HTTP ${p.response.status}: ${p.response.url.replace(ORIGIN, '')}`);
      break;
    case 'Network.loadingFailed': {
      const url = requests.get(p.requestId) || '?';
      if (p.canceled) break;
      if (ours(url)) errors.push(`failed to load ${url.replace(ORIGIN, '')}: ${p.errorText}`);
      else if (p.type === 'Script') warnings.push(`could not load ${url}: ${p.errorText}`);
      break;
    }
  }
});
await cmd('Runtime.enable');
await cmd('Network.enable');
await cmd('Page.enable');

async function evaluate(fn, ...args) {
  const r = await cmd('Runtime.evaluate', {
    expression: `(() => { const G = window.FG && FG.game; return (${fn})(...${JSON.stringify(args)}); })()`, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(`in page: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}`);
  return r.result.value;
}
async function waitFor(fn, ms, what, ...args) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(fn, ...args).catch(() => false)) return true;
    await sleep(250);
  }
  if (what) throw new Error(`timed out waiting for ${what}`);
  return false;
}
const key = (k) => evaluate((k) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })), k);
const step = (s) => console.log(`· ${s}`);

// ---------- the test ----------
try {
  step(`loading ${ORIGIN}/`);
  await cmd('Page.navigate', { url: `${ORIGIN}/` });
  await waitFor(() => window.FG && FG.ui && FG.game && !document.getElementById('start-screen').hidden, 60000, 'the start screen');

  step('first start: pick a style, main menu → New game → Start, the loading screen until the map is in');
  await evaluate(() => {
    const first = document.querySelector('[data-st=styleDone]');
    if (!first) throw new Error('no style picker on the first start');
    first.click();
    document.querySelector('[data-st=page][data-id=new]').click();
    document.querySelector('[data-st=start]').click();
  });
  await waitFor(() => document.getElementById('start-screen').hidden && document.getElementById('loading').hidden, 30000, 'the loading screen to finish');
  const home = await evaluate(() => G.home());

  step(`lease a slot, plan a timetable from ${home}, add a second plane`);
  const plan = await evaluate((home) => {
    G.state.money += 50e6; // like the developer panel: enough for any slot
    const p = G.state.planes[0];
    const near = Object.values(G.airportByCode)
      .filter((a) => a.code !== home && a.size >= 3)
      .map((a) => ({ a, d: Math.hypot(a.lat - G.airportByCode[home].lat, a.lon - G.airportByCode[home].lon) }))
      .sort((x, y) => x.d - y.d).map((x) => x.a.code);
    for (const code of near) {
      if (G.leaseSlot(code) !== null) continue;
      const err = G.setSchedule(p.id, [home, code]);
      if (!err) {
        G.setScheduleActive(p.id, true); // what Save & fly does
        const p2 = G.addPlane(p.type, home, 'leased', 0);
        const err2 = G.setSchedule(p2, [home, code]) || G.setScheduleActive(p2, true);
        return { route: `${home}–${code}`, plane: p.id, err: err2 };
      }
    }
    return { err: 'no airport near home could be scheduled' };
  }, home);
  if (!plan.route) throw new Error(plan.err);
  if (plan.err) warnings.push(`second plane: ${plan.err}`);
  step(`flying ${plan.route}`);

  step('planner: the second plane\'s row in Schedule opens its timetable window; drag the start time, then ✨ find a time that fits the slots');
  const fit = await evaluate(async () => {
    const p2 = G.state.planes[G.state.planes.length - 1];
    document.querySelector('#rail [data-tab="schedule"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const row = document.querySelector(`[data-pl="edit"][data-plane="${p2.id}"]`);
    if (!row) return { err: 'no row for the plane in Schedule' };
    row.click();
    await new Promise((r) => setTimeout(r, 300));
    const win = document.getElementById('win-timetable');
    if (!win || win.hidden) return { err: 'the timetable window did not open' };
    const range = win.querySelector('#pl-first-range');
    if (!range) return { err: 'no start-time slider in the planner' };
    range.value = Number(range.min) + 120;
    range.dispatchEvent(new Event('input', { bubbles: true }));
    const bars = document.querySelectorAll('#pl-fit .tl-bar.fit').length;
    const fitBtn = document.querySelector('[data-pl="fit"]');
    if (!fitBtn) return { err: 'no ✨ fit button' };
    fitBtn.click();
    await new Promise((r) => setTimeout(r, 300));
    const ok = !!document.querySelector('#pl-fit');
    document.querySelector('#win-timetable [data-pl="close"]').click();
    await new Promise((r) => setTimeout(r, 100));
    if (!win.hidden) return { err: 'Close did not close the timetable window' };
    return { bars, ok };
  });
  if (fit.err || !fit.bars || !fit.ok) errors.push(`planner fit: ${fit.err || `${fit.bars} slot bars`}`);
  else step(`fit: ${fit.bars} airport slot bars`);

  step('Fleet: rename the first plane (✏️, type a name, Enter)');
  const named = await evaluate(async () => {
    document.querySelector('#rail [data-tab="fleet"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const btn = document.querySelector('[data-action="rename"]');
    if (!btn) return 'no ✏️ button on the plane card';
    btn.click();
    await new Promise((r) => setTimeout(r, 300));
    const i = document.getElementById('rename-input');
    if (!i) return 'no name field';
    i.value = 'Smoke Test One';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const p = G.plane(i.dataset.plane);
    return p.name === 'Smoke Test One' && document.querySelector('.plane-card h3').textContent.includes('Smoke Test One') ? null : `name not shown (${p.name})`;
  });
  if (named) errors.push(`rename: ${named}`);

  step('full speed for 20 s with the 2D map, every section opened');
  await evaluate(() => document.querySelector('#speed-pop [data-speed]:last-child').click());
  const t0 = await evaluate(() => G.state.time);
  const tabs = await evaluate(() => [...document.querySelectorAll('#rail [data-tab]')].map((b) => b.dataset.tab));
  for (let i = 0; i < 20; i++) {
    const tab = tabs[i % tabs.length];
    await evaluate((tab) => document.querySelector(`#rail [data-tab="${tab}"]`).click(), tab);
    if (i === 5) await evaluate((home) => FG.ui.showAirport(home), home); // gates and stands at zoom 13
    if (i === 10) await evaluate(() => FG.ui.selectPlane(G.state.planes[0].id));
    await sleep(1000);
  }
  const t1 = await evaluate(() => G.state.time);
  if (t1 - t0 < 60) errors.push(`game time hardly moved at full speed (${t1 - t0} min in 20 s)`);

  step('the plane clicked has its window (camera, phase, route), then it is closed');
  const pw = await evaluate(() => {
    const w = document.getElementById('win-plane');
    if (!w || w.hidden) return { err: 'no plane window after clicking a plane' };
    const stats = w.querySelector('.pw-stats').innerText;
    // its runway choice: Auto, or one of the runways (from its next flight on)
    const sel = w.querySelector('.pw-rw select');
    if (!sel) return { err: 'no runway choice in the plane window' };
    const pick = [...sel.options].find((o) => o.value !== 'auto' && !o.disabled);
    if (pick) {
      sel.value = pick.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const p0 = G.state.planes[0];
      if (!p0.runways || p0.runways[sel.dataset.pwRw] !== pick.value) return { err: 'choosing a runway did not stick' };
      G.setRunway(p0.id, sel.dataset.pwRw, 'auto');
    }
    w.querySelector('.fg-win-close').click();
    return { stats: stats.split('\n')[0], closed: w.hidden };
  });
  if (pw.err) errors.push(`plane window: ${pw.err}`);
  else if (!pw.stats || !pw.closed) errors.push(`plane window: ${pw.stats ? 'its ✕ did not close it' : 'no phase shown'}`);
  else step(`plane window: ${pw.stats}`);

  step('30 more game days');
  await evaluate(() => { for (let d = 0; d < 30; d++) G.advance(24 * 60); G.dirty = true; });
  for (const tab of tabs) {
    await evaluate((tab) => document.querySelector(`#rail [data-tab="${tab}"]`).click(), tab);
    await sleep(300);
  }
  const result = await evaluate(() => ({
    day: Math.floor(G.state.time / 1440), money: Math.round(G.state.money), gameOver: !!G.state.gameOver,
    flights: G.state.planes.reduce((n, p) => n + p.stats.flights, 0),
  }));
  step(`day ${result.day}: ${result.flights} flights, money ${result.money.toLocaleString('en')}`);
  if (!result.flights) errors.push('no flight landed in 30 game days');
  if (result.gameOver) warnings.push('the airline went bankrupt during the test');

  step('Fleet: Ferry there (to the other slot airport) says when the plane leaves');
  const ferry = await evaluate(async () => {
    const p = G.state.planes[0];
    // paused, or at full speed a short turnaround and the whole ferry can be over before we look
    const pause = document.getElementById('pause');
    const running = FG.ui.speed > 0;
    if (running) pause.click();
    document.querySelector('#rail [data-tab="fleet"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const sel = document.getElementById(`send-${p.id}`);
    const btn = document.querySelector(`[data-action="sendSelect"][data-plane="${p.id}"]`);
    if (!sel || !btn) { if (running) pause.click(); return { err: 'no ferry select or button on the plane card' }; }
    const at = p.status === 'flying' && p.flight ? p.flight.to : p.location;
    const to = [...sel.options].map((o) => o.value).find((c) => c !== at);
    sel.value = to;
    btn.click();
    await new Promise((r) => setTimeout(r, 200));
    const text = document.getElementById('toast').textContent;
    const ok = p.pendingFerry === to && text.includes(`ferries to ${to}`);
    G.setScheduleActive(p.id, true); // back on its timetable for the rest of the test
    if (running) pause.click();
    return ok ? { text } : { err: `no ferry (${p.pendingFerry}, toast "${text}")` };
  });
  if (ferry.err) errors.push(`ferry: ${ferry.err}`);
  else step(`ferry: "${ferry.text}"`);

  step(`airport editor (F3): add a stand at ${home}, then drop it`);
  await waitFor((h) => FG.layouts.settled(h), 60000, null, home);
  const ed = await evaluate(async (code) => {
    FG.ui.showAirport(code);
    await new Promise((r) => setTimeout(r, 500));
    FG.airportEdit.toggle(true);
    if (!FG.airportEdit.on) return { err: 'the editor did not open' };
    const lay = FG.layouts.get(code);
    const a = G.airportByCode[code];
    // the middle of the biggest apron, or the airport itself where the game made its layout up
    const ring = lay && lay.aprons.slice().sort((x, y) => y.length - x.length)[0];
    const p = ring ? [ring.reduce((s, q) => s + q[0], 0) / ring.length, ring.reduce((s, q) => s + q[1], 0) / ring.length] : [a.lat, a.lon];
    const n0 = lay ? lay.stands.length : 0;
    FG.airportEdit.click(p[0], p[1]);
    const b = document.querySelector('[data-ae="add"][data-kind="stand"]');
    if (!b) return { err: 'no "Add stand" button in the editor popup' };
    b.click();
    await new Promise((r) => setTimeout(r, 300));
    const lay2 = FG.layouts.get(code);
    const out = { real: !!lay, n0, n1: lay2 ? lay2.stands.length : 0, unsaved: FG.fixes.unsaved().includes(code) };
    G.apronOf(code); // the game lays the airport out with the fix
    FG.fixes.discard(code);
    FG.airportEdit.toggle(false);
    return out;
  }, home);
  if (ed.err) errors.push(`airport editor: ${ed.err}`);
  else {
    step(`editor: stands ${ed.n0} → ${ed.n1}${ed.real ? '' : ' (made-up layout)'}`);
    if (!ed.unsaved) errors.push('airport editor: the new stand is not an unsaved fix');
    if (ed.real && ed.n1 !== ed.n0 + 1) errors.push(`airport editor: the new stand did not reach the layout (${ed.n0} → ${ed.n1})`);
  }

  step(`build mode at ${home} (own it, 🏗 Build at the airport → Stand tool, click → it costs, undo gives it back)`);
  const bm = await evaluate(async (code) => {
    G.infraOf(code).stake = 100;
    FG.ui.showAirport(code);
    G.dirty = true;
    await new Promise((r) => setTimeout(r, 800));
    const btn = document.querySelector(`[data-action="airportBuild"][data-code="${code}"]`);
    if (!btn) return { err: 'no "Build at the airport" button in the airport panel' };
    btn.click();
    if (FG.airportEdit.building !== code) return { err: 'build mode did not open' };
    const lay = FG.layouts.get(code);
    const a = G.airportByCode[code];
    const ring = lay && lay.aprons.slice().sort((x, y) => y.length - x.length)[0];
    const p = ring ? [ring.reduce((s, q) => s + q[0], 0) / ring.length, ring.reduce((s, q) => s + q[1], 0) / ring.length] : [a.lat, a.lon];
    const stands0 = G.apronOf(code).stands.length;
    // (what it charges: the money itself moves with the flights meanwhile)
    const charged = [];
    const pay = G.payForBuilding;
    G.payForBuilding = function (c, full, what) { const err = pay.call(this, c, full, what); if (!err) charged.push(full); return err; };
    // the Runway tool: a click places one, the panel shows its price; not built (Cancel)
    const rt = document.querySelector('#apedit [data-ae="tool"][data-tool="runway"]');
    if (!rt) return { err: 'no Runway tool in the build panel' };
    rt.click();
    FG.airportEdit.click(a.lat - 0.01, a.lon + 0.01);
    const rinfo = document.getElementById('ae-pl-info');
    if (!rinfo || !/CHF/.test(rinfo.textContent)) return { err: 'placing a runway shows no price' };
    document.querySelector('#apedit [data-ae="cancel"]').click();
    if (FG.airportEdit.state.place) return { err: 'Cancel did not drop the runway being placed' };
    const b = document.querySelector('#apedit [data-ae="tool"][data-tool="stand"]');
    if (!b) return { err: 'no "Stand" tool in the build panel' };
    b.click();
    FG.airportEdit.click(p[0], p[1]);
    if (document.querySelector('.ae-popup')) return { err: 'build mode opened a window on the map' };
    await new Promise((r) => setTimeout(r, 300));
    const out = { paid: charged[0] || 0, ops: FG.fixes.player.ops(code).length, stands0, stands1: G.apronOf(code).stands.length, devUnsaved: FG.fixes.unsaved().length };
    document.querySelector('#apedit [data-ae="undo"]').click();
    out.back = -(charged[1] || 0);
    out.left = FG.fixes.player.ops(code).length;
    G.payForBuilding = pay;
    FG.airportEdit.toggle(false);
    return out;
  }, home);
  if (bm.err) errors.push(`build mode: ${bm.err}`);
  else {
    step(`build mode: stands ${bm.stands0} → ${bm.stands1}, paid ${bm.paid}, back ${bm.back}`);
    if (!(bm.paid > 0)) errors.push('build mode: the stand cost nothing');
    if (!bm.ops) errors.push('build mode: the stand is not in the save game (FG.fixes.player)');
    if (bm.devUnsaved) errors.push('build mode: it made an airport fix (it must stay in the save game)');
    if (bm.stands1 < bm.stands0) errors.push(`build mode: the airport lost stands (${bm.stands0} → ${bm.stands1})`);
    if (bm.back !== bm.paid || bm.left) errors.push(`build mode: undo did not take it back (${bm.back} of ${bm.paid} back, ${bm.left} changes left)`);
  }

  step(`airport editor: a new taxiway as a curve at ${home} (Add here → Curve, two points, 60°, Apply)`);
  const cu = await evaluate(async (code) => {
    FG.airportEdit.toggle(true);
    const a = G.airportByCode[code];
    const p = [a.lat + 0.004, a.lon + 0.004];
    FG.airportEdit.click(p[0], p[1]);
    const b = document.querySelector('[data-ae="add"][data-kind="curve"]');
    if (!b) return { err: 'no "Add Curve" button in the editor popup' };
    b.click();
    FG.airportEdit.click(p[0], p[1]);
    FG.airportEdit.click(p[0] + 0.0015, p[1] + 0.002);
    const st = FG.airportEdit.state;
    if (!st.curve) return { err: 'two clicks did not start a curve' };
    document.querySelector('[data-ae="curveAngle"][data-v="60"]').click();
    document.querySelector('[data-ae="applyCurve"]').click();
    const op = FG.fixes.ops(code).slice(-1)[0];
    const g = op && op.geom;
    const dir = (q, r) => Math.atan2(r[0] - q[0], (r[1] - q[1]) * Math.cos(q[0] * Math.PI / 180));
    const turn = g ? Math.abs((((dir(g[g.length - 2], g[g.length - 1]) - dir(g[0], g[1])) * 180) / Math.PI + 540) % 360 - 180) : 0;
    const out = { kind: op && op.op + ' ' + op.kind, points: g ? g.length : 0, turn: Math.round(turn), left: !!st.curve };
    // its width (as "Fit to satellite" sets it, without the satellite): the maps draw it that wide
    const wIn = document.getElementById('ae-twwidth');
    if (!wIn) out.width = 'no width field for the taxiway';
    else {
      wIn.value = '19';
      document.querySelector('[data-ae="setWidth"]').click();
      const last = FG.fixes.ops(code).slice(-1)[0];
      out.width = last && last.w === 19 && G.drawnTaxiways(code).some((l) => l.w === 19) ? 19 : `not drawn 19 m wide (${JSON.stringify(last && last.w)})`;
    }
    FG.fixes.discard(code);
    FG.airportEdit.toggle(false);
    return out;
  }, home);
  if (cu.err) errors.push(`airport editor, curve: ${cu.err}`);
  else {
    step(`curve: ${cu.kind}, ${cu.points} points, turns ${cu.turn}°, width ${cu.width}`);
    if (cu.width !== 19) errors.push(`airport editor: taxiway width: ${cu.width}`);
    if (cu.kind !== 'add taxiway' || cu.points < 10 || Math.abs(cu.turn - 60) > 1 || cu.left) errors.push(`airport editor: the curve went wrong (${JSON.stringify(cu)})`);
  }

  step('airport editor: delete part of a made-up layout (test airport ZZT on the sea, nothing mapped there)');
  const mu = await evaluate(async () => {
    const code = 'ZZT';
    const lat = 43.2;
    const lon = 7.6;
    FG.fixes.edit(code, [
      { op: 'add', kind: 'airport', geom: { code, name: 'Smoke test field', city: 'Test', country: 'FR', lat, lon, size: 2, minor: false } },
      { op: 'add', kind: 'runway', geom: [lat - 0.009, lon, lat + 0.009, lon, 30, 1] },
    ]);
    FG.layouts.get(code);
    const t0 = performance.now();
    while (FG.layouts.pending(code) && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 200));
    const made = FG.airportEdit.madeUp(code);
    const stands = made.filter((e) => e.kind === 'stand').length;
    const apron = made.find((e) => e.kind === 'apron');
    if (!apron || !stands) return { err: `no made-up layout to edit (${made.length} parts)` };
    FG.airportEdit.toggle(true);
    FG.ui.showAirport(code);
    const r = apron.geom;
    // a point on the apron, a third of the way in from its runway-side edge (clear of the stands)
    const at = [0, 1].map((k) => ((r[0][k] + r[1][k]) / 2) * 0.67 + ((r[2][k] + r[3][k]) / 2) * 0.33);
    FG.airportEdit.click(at[0], at[1]);
    const st = FG.airportEdit.state;
    const i = st.hits.findIndex((h) => h.kind === 'apron' && h.madeUp);
    if (i < 0) return { err: `the made-up apron can't be picked (hits: ${st.hits.map((h) => h.kind).join(', ') || 'none'})` };
    st.sel = st.hits[i]; // (as picked under "Also here")
    document.querySelector('[data-ae="del"]').click();
    const lay = FG.layouts.get(code);
    const out = {
      parts: made.length, stands, own: FG.layouts.has(code),
      apronGone: !!lay && !lay.aprons.some((g) => JSON.stringify(g) === JSON.stringify(apron.geom)),
      kept: lay ? lay.stands.length : 0, madeUpLeft: FG.airportEdit.madeUp(code).length,
    };
    G.apronOf(code); // the game lays it out from the fixes now
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    out.undone = !FG.layouts.has(code) && FG.airportEdit.madeUp(code).length === made.length;
    FG.fixes.discard(code);
    FG.airportEdit.toggle(false);
    out.unsaved = FG.fixes.unsaved();
    return out;
  });
  if (mu.err) errors.push(`airport editor, made-up layout: ${mu.err}`);
  else {
    step(`made up: ${mu.parts} parts, ${mu.stands} stands; after deleting its apron: own layout ${mu.own}, ${mu.kept} stands kept`);
    if (!mu.own || !mu.apronGone || mu.kept !== mu.stands || mu.madeUpLeft) errors.push(`airport editor: deleting a made-up apron went wrong (${JSON.stringify(mu)})`);
    if (!mu.undone) errors.push('airport editor: Ctrl+Z did not bring the made-up layout back');
    if (mu.unsaved.length) errors.push(`airport editor: unsaved fixes left (${mu.unsaved.join(', ')})`);
  }

  step('3D view (V), following a plane');
  await evaluate(() => { document.querySelector('#speed-pop [data-speed="60"]').click(); });
  const has3d = await waitFor(() => window.FG && FG.view3d, 90000);
  if (!has3d) warnings.push('3D module did not load in 90 s (CDN?): 3D not tested');
  else {
    await key('v');
    // (the first time: the warning that 3D is for strong devices)
    const warned = await waitFor(() => !!document.querySelector('#warn3d [data-w3=yes]'), 5000);
    if (!warned) errors.push('3D view: no warning before it opened the first time');
    else await evaluate(() => document.querySelector('#warn3d [data-w3=yes]').click());
    const loaded = await waitFor(() => FG.view3d.map && FG.view3d.map.loaded(), 60000);
    if (!loaded) warnings.push('3D map did not finish loading in 60 s (tiles?)');
    await evaluate(() => FG.ui.follow && FG.ui.follow(G.state.planes[0].id));
    await sleep(8000);
    await key('v');
    await sleep(1000);
  }

  step('bug report (F5): the panel opens instead of a reload, with the game details');
  for (const type of ['rawKeyDown', 'keyUp']) await cmd('Input.dispatchKeyEvent', { type, key: 'F5', code: 'F5', windowsVirtualKeyCode: 116 });
  await sleep(500);
  const bug = await evaluate(() => {
    const el = document.getElementById('bugreport');
    const out = { open: !el.hidden, form: !!document.getElementById('br-title'), details: FG.bugs.details() };
    document.querySelector('#bugreport [data-br="kind"][data-k="idea"]').click();
    out.kind = FG.bugs.state.kind;
    out.stillForm = !!document.getElementById('br-text');
    FG.bugs.toggle(false);
    return out;
  });
  if (!bug.open || !bug.form || !bug.stillForm || bug.kind !== 'idea') errors.push(`bug report panel: ${JSON.stringify({ ...bug, details: undefined })}`);
  if (!/Version: \d+/.test(bug.details) || !/Game: /.test(bug.details)) errors.push(`bug report details incomplete:\n${bug.details}`);

  step('background tab: another tab in front, the game runs on (at 60×: 4 s are 4 game minutes)');
  await evaluate(() => { // (a newspaper pauses the game: read them all first)
    for (let i = 0; i < 50 && !document.getElementById('newspaper').hidden; i++) document.querySelector('[data-action=newsNext]').click();
    if (FG.ui.speed === 0) document.getElementById('pause').click();
  });
  const front = await send('Target.createTarget', { url: 'about:blank' });
  await sleep(500);
  const bg = { t0: await evaluate(() => FG.ui.time), hidden: await evaluate(() => document.hidden) };
  await sleep(4000);
  bg.t1 = await evaluate(() => FG.ui.time);
  await send('Target.closeTarget', { targetId: front.targetId });
  await send('Target.activateTarget', { targetId });
  step(`background tab: ${(bg.t1 - bg.t0).toFixed(1)} game minutes in 4 s${bg.hidden ? '' : ' (the page was not hidden)'}`);
  if (bg.hidden && bg.t1 - bg.t0 < 3) errors.push(`background tab: the game slowed down (${(bg.t1 - bg.t0).toFixed(1)} game minutes in 4 s at 60×)`);

  step('save and reload');
  await evaluate(() => G.save());
  await cmd('Page.reload');
  await waitFor(() => window.FG && FG.ui && FG.game && G.state.planes.length >= 1, 60000, 'the game after a reload');
  await evaluate(() => document.querySelector('[data-st=continue]') && document.querySelector('[data-st=continue]').click());
  await sleep(2000);

  step('styles: each one picked in Settings, the section bar still there');
  for (const id of await evaluate(() => FG.themes.list.map((t) => t.id))) {
    const bar = await evaluate((id) => {
      if (document.getElementById('settings').hidden) document.getElementById('settings-btn').click();
      document.querySelector(`[data-set="theme"][data-v="${id}"]`).click();
      const r = document.getElementById('rail').getBoundingClientRect();
      return { on: document.documentElement.dataset.theme, w: r.width, h: r.height };
    }, id);
    if (bar.on !== id || !bar.w || !bar.h) errors.push(`style ${id}: not applied or no section bar (${JSON.stringify(bar)})`);
    await sleep(400);
  }
  await evaluate(() => { document.querySelector('[data-set="theme"][data-v="night"]').click(); document.getElementById('settings').hidden = true; });

  step('story mode from 1955: the market, then New Year 1958 (Comet 4 and Boeing 707)');
  await evaluate(() => document.getElementById('newgame').click());
  await evaluate(() => {
    document.querySelector('[data-st=story][data-id="1955"]').click();
    document.querySelector('[data-st=start]').click();
  });
  // (the airline is founded behind the loading screen)
  await waitFor(() => !!G.state.story && document.getElementById('loading').hidden, 30000, 'the story game to start');
  const story = await evaluate(() => {
    const out = { date: G.fmtTime(G.state.time), early: G.onSale('A320'), sale: G.onSale('DC-6B') };
    G.state.money = 1e9;
    while (G.dateOf(G.state.time).getUTCFullYear() < 1958) G.advance(24 * 60);
    out.jets = G.onSale('B707-120') && G.onSale('COMET4');
    out.news = G.state.news.filter((n) => n.picture === 'plane').length;
    G.dirty = true;
    return out;
  });
  step(`story: ${story.date}, ${story.news} newspaper stories about new aircraft by 1958`);
  if (!/1955/.test(story.date)) errors.push(`story mode: the date should be in 1955, it is ${story.date}`);
  if (story.early || !story.sale) errors.push('story mode: the 1955 market sells the wrong types');
  if (!story.jets || !story.news) errors.push('story mode: no new types arrived by 1958');
  await evaluate(() => document.querySelector('#rail [data-tab="market"]').click());
  await sleep(1000);
} catch (e) {
  errors.push(`test stopped: ${e.message}`);
}

for (const w of [...new Set(warnings)]) console.log(`⚠ ${w}`);
const unique = [...new Set(errors)];
if (unique.length) {
  console.error(`\n✗ smoke test failed with ${unique.length} error(s):`);
  for (const e of unique) console.error(`  ${e}`);
  finish(1);
} else {
  console.log('\n✓ smoke test passed');
  finish(0);
}
