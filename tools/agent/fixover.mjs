// node fixover.mjs CODE...: delete stands that block others (fixover.js), via fixop.py; prints why
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const dir = new URL('.', import.meta.url).pathname;
const codes = process.argv.slice(2).map((c) => c.toUpperCase());
const tabs = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9447}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
setTimeout(() => process.exit(2), 60000 + codes.length * 30000);
let n = 0; const waits = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } });
const ev = (expression) => new Promise((r) => { const id = ++n; waits.set(id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); })
  .then((m) => { if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 600)); return m.result.result.value; });
await ev(fs.readFileSync(dir + 'fixover.js', 'utf8'));
for (const code of codes) {
  await ev(`(async()=>{FG.layouts.get('${code}'); for(let i=0;i<80&&!(FG.layouts.settled('${code}')&&!FG.layouts.pending('${code}'));i++) await new Promise(r=>setTimeout(r,500)); return 1})()`);
  const { ops, why } = await ev(`fixOverlaps('${code}')`);
  console.log(code, why.join('; ') || 'no overlaps');
  if (ops.length) execFileSync('python3', [dir + 'fixop.py', code, ...ops.map((o) => JSON.stringify(o))], { stdio: 'inherit' });
}
process.exit(0);
