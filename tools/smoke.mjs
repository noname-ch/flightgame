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
  fs.rmSync(profile, { recursive: true, force: true });
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
      if (ours(p.response.url) && p.response.status >= 400 && !p.response.url.includes('/__fixes')) errors.push(`HTTP ${p.response.status}: ${p.response.url.replace(ORIGIN, '')}`);
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

  step('new game from the start screen');
  await evaluate(() => document.querySelector('[data-st=start]').click());
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

  step('3D view (V), following a plane');
  await evaluate(() => { document.querySelector('#speed-pop [data-speed="60"]').click(); });
  const has3d = await waitFor(() => window.FG && FG.view3d, 90000);
  if (!has3d) warnings.push('3D module did not load in 90 s (CDN?): 3D not tested');
  else {
    await key('v');
    const loaded = await waitFor(() => FG.view3d.map && FG.view3d.map.loaded(), 60000);
    if (!loaded) warnings.push('3D map did not finish loading in 60 s (tiles?)');
    await evaluate(() => FG.ui.follow && FG.ui.follow(G.state.planes[0].id));
    await sleep(8000);
    await key('v');
    await sleep(1000);
  }

  step('save and reload');
  await evaluate(() => G.save());
  await cmd('Page.reload');
  await waitFor(() => window.FG && FG.ui && FG.game && G.state.planes.length >= 1, 60000, 'the game after a reload');
  await evaluate(() => document.querySelector('[data-st=continue]') && document.querySelector('[data-st=continue]').click());
  await sleep(2000);
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
