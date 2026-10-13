// node tools/agent/onrw.mjs CODE: lists the airport's taxiway add/set ops in js/data/fixes.js whose new line has
// points on a runway (within half its width + 8 m; runways from shots/CODE.json, so shoot first). A taxiway op
// with 3+ points there is usually a curve the tidy step laid over the runway: check each one and undo it.
import fs from 'node:fs';
// --near M: points within M m of a runway centreline count instead; --from N: only ops from number N on.
const code = (process.argv[2] || '').toUpperCase();
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? Number(process.argv[i + 1]) : null; };
const near = arg('near');
const from = arg('from') || 0;
const root = new URL('../..', import.meta.url).pathname;
globalThis.FG = { data: {} };
eval(fs.readFileSync(root + 'js/data/fixes.js', 'utf8'));
const ops = FG.data.fixes[code] || [];
const rws = JSON.parse(fs.readFileSync(root + `tools/agent/shots/${code}.json`, 'utf8')).runways || [];
const M = 111320, DEG = Math.PI / 180;
function segM(p, a, b) {
  const kx = M * Math.cos(p[0] * DEG);
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * M, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * M;
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx, ay + t * dy);
}
let n = 0;
ops.forEach((o, i) => {
  if (i < from || o.kind !== 'taxiway' || o.op === 'del') return;
  const g = o.geom;
  let on = 0;
  for (const p of g) for (const r of rws) if (segM(p, [r[0], r[1]], [r[2], r[3]]) < (near ?? r[4] / 2 + 8)) { on++; break; }
  if (!on) return;
  n++;
  console.log(`op ${i} ${o.op} ${g.length} points, ${on} on a runway${g.length > 2 ? ' (curve)' : ''}`);
  console.log('  geom', JSON.stringify(g));
  if (o.from) console.log('  from', JSON.stringify(o.from));
});
if (!n) console.log(code, 'no taxiway op on a runway');
