// node nosein.mjs CODE... [--dry] [--box VIEW x1 y1 x2 y2]: run nosein.js in the game page (stands near a terminal
// face it) and add its ops (fixop.py). --box keeps only ops on stands inside that pixel box of a shot (shots/CODE.json),
// e.g. to leave stands a person has set alone.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const dir = new URL('.', import.meta.url).pathname;
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const bi = args.indexOf('--box');
const box = bi >= 0 ? args.splice(bi, 6).slice(1) : null;
const codes = args.filter((a) => !a.startsWith('--')).map((c) => c.toUpperCase());
const inBox = (code, ll) => {
  if (!box) return true;
  const v = JSON.parse(fs.readFileSync(`${dir}shots/${code}.json`, 'utf8')).views[box[0]];
  const s = 256 * 2 ** v.zoom, r = Math.PI / 180;
  const x = (ll[1] + 180) / 360 * s - v.x;
  const y = (1 - Math.log(Math.tan(ll[0] * r) + 1 / Math.cos(ll[0] * r)) / Math.PI) / 2 * s - v.y;
  const [x1, y1, x2, y2] = box.slice(1).map(Number);
  return x >= x1 && x <= x2 && y >= y1 && y <= y2;
};
const tabs = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9447}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
setTimeout(() => { console.error('timeout'); process.exit(2); }, 60000 + codes.length * 60000);
let n = 0;
const waits = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } });
const ev = (expression) => new Promise((r) => { const id = ++n; waits.set(id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); })
  .then((m) => { if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 600)); return m.result.result.value; });
await ev(fs.readFileSync(dir + 'nosein.js', 'utf8'));
for (const code of codes) {
  let { ops, stats } = await ev(`nosein(${JSON.stringify(code)})`);
  ops = ops.filter((o) => inBox(code, o.from || o.geom));
  console.log(code, JSON.stringify(stats), ops.length, 'ops');
  if (!dry && ops.length) execFileSync('python3', [dir + 'fixop.py', code, ...ops.map((o) => JSON.stringify(o))], { stdio: 'inherit' });
}
process.exit(0);
