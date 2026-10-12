// node nosein.mjs CODE... [--dry]: run nosein.js in the game page (stands near a terminal face it) and add its ops (fixop.py)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const dir = new URL('.', import.meta.url).pathname;
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const codes = args.filter((a) => !a.startsWith('--')).map((c) => c.toUpperCase());
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
  const { ops, stats } = await ev(`nosein(${JSON.stringify(code)})`);
  console.log(code, JSON.stringify(stats), ops.length, 'ops');
  if (!dry && ops.length) execFileSync('python3', [dir + 'fixop.py', code, ...ops.map((o) => JSON.stringify(o))], { stdio: 'inherit' });
}
process.exit(0);
