// node pin.mjs CODE [--within M] [--dry]: the game uses only 2×GATE_COUNT of an airport's mapped stands, plus every
// stand a fix added or moved. This pins the mapped stands within M m (default 70) of a terminal, which no fix op
// touches yet, with a `set` op that keeps them as they are, so the game uses them all. Run it after nosein.mjs,
// and fixover.mjs after it (more stands in use can mean more in each other's way).
import { execFileSync } from 'node:child_process';
const dir = new URL('.', import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const within = Number(opt('within', 70));
const dry = args.includes('--dry');
const code = args.filter((a) => !a.startsWith('--'))[0].toUpperCase();
const tabs = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9447}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
setTimeout(() => { console.error('timeout'); process.exit(2); }, 90000);
let n = 0;
const waits = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } });
const ev = (expression) => new Promise((r) => { const id = ++n; waits.set(id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); })
  .then((m) => { if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 600)); return m.result.result.value; });
const ops = await ev(`(async () => {
  const code = ${JSON.stringify(code)}, within = ${within};
  FG.layouts.get(code);
  for (let i = 0; i < 80 && !(FG.layouts.settled(code) && !FG.layouts.pending(code)); i++) await new Promise((r) => setTimeout(r, 500));
  const lay = FG.layouts.get(code);
  if (!lay) return [];
  const M = 111320, DEG = Math.PI / 180;
  const ops = [];
  for (const s of lay.stands) {
    if (lay.pinned && lay.pinned.has(s)) continue;
    const kx = M * Math.cos(s[0] * DEG);
    const xy = (p) => [(p[1] - s[1]) * kx, (p[0] - s[0]) * M];
    let best = Infinity;
    for (const r of lay.terminals) for (let i = 0; i < r.length; i++) {
      const a = xy(r[i]), b = xy(r[(i + 1) % r.length]);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(a[0] + t * dx, a[1] + t * dy));
    }
    if (best <= within) ops.push({ op: 'set', kind: 'stand', from: s, geom: s });
  }
  return ops;
})()`);
console.log(code, ops.length, 'stands pinned');
if (!dry && ops.length) execFileSync('python3', [dir + 'fixop.py', code, ...ops.map((o) => JSON.stringify(o))], { stdio: 'inherit' });
process.exit(0);
