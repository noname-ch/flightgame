#!/usr/bin/env node
// The airport checklist (F8 in the game) from the command line, for agents going through the airports.
// It loads the game's own data and js/airportcheck.js, so the order is the same as in the game.
//
//   node tools/checks.mjs status                     how many airports are in each state
//   node tools/checks.mjs next [n] [state]           the next n airports to do (state: open, checked, bad, ok; default open)
//   node tools/checks.mjs show CODE...               an airport's place in the list and its mark
//   node tools/checks.mjs mark CODE... [--note "…"] [--by name] [--state checked|bad|ok]
//                                                     mark airports (agents: checked, the default; ok is for people)
//   node tools/checks.mjs clear CODE...              remove the marks
//
// It writes js/data/checks.js. Commit that file to give everyone the marks.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILE = path.join(ROOT, 'js/data/checks.js');
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['js/config.js', 'js/data/airports.js', 'js/data/airports-more.js', 'js/data/busiest.js', 'js/data/checks.js', 'js/airportcheck.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const FG = ctx.FG;
const K = FG.checks;
const checks = Object.assign({}, FG.data.checks);
const byCode = new Map(FG.data.airports.map((a) => [a.code, a]));
const order = K.order();
const place = new Map(order.map((o, i) => [o.code, i]));

const args = process.argv.slice(2);
const cmd = args.shift();
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const stateOf = (code) => (checks[code] ? checks[code].s : 'open');
const why = (o) => (o.why === 'start' ? 'start airport' : o.why === 'busy' ? `busiest #${o.rank}` : `size ${byCode.get(o.code).size}`);
function line(code) {
  const o = order[place.get(code)];
  const a = byCode.get(code);
  const m = checks[code];
  const dot = m ? K.STATES[m.s].dot : K.OPEN.dot;
  return `${dot} ${String(place.get(code) + 1).padStart(5)}  ${code.padEnd(4)}  ${a.name}, ${a.city} ${a.country}  (${why(o)}; ${a.lat}, ${a.lon})` +
    (m ? `\n${' '.repeat(16)}${m.s} by ${m.by || '?'} ${m.at || ''}${m.note ? `: ${m.note}` : ''}` : '');
}
function codes() {
  const out = args.filter((a) => !a.startsWith('--')).map((c) => c.toUpperCase());
  const bad = out.filter((c) => !byCode.has(c));
  if (bad.length) { console.error(`No such airport: ${bad.join(', ')}`); process.exit(1); }
  if (!out.length) { console.error('Which airports? Give their codes.'); process.exit(1); }
  return out;
}
function save() {
  fs.writeFileSync(`${FILE}.tmp`, K.fileText(checks));
  fs.renameSync(`${FILE}.tmp`, FILE);
}

switch (cmd) {
  case 'status': {
    const n = { open: 0, checked: 0, ok: 0, bad: 0 };
    order.forEach((o) => n[stateOf(o.code)]++);
    const top = order.filter((o) => o.why !== 'size');
    const t = { open: 0, checked: 0, ok: 0, bad: 0 };
    top.forEach((o) => t[stateOf(o.code)]++);
    console.log(`Start + busiest (${top.length}): 🟢 ${t.ok} good · 🔵 ${t.checked} checked · 🔴 ${t.bad} needs work · ⬜ ${t.open} open`);
    console.log(`All airports (${order.length}): 🟢 ${n.ok} · 🔵 ${n.checked} · 🔴 ${n.bad} · ⬜ ${n.open}`);
    break;
  }
  case 'next': {
    const n = Number(args.find((a) => /^\d+$/.test(a))) || 10;
    const s = args.find((a) => ['open', 'checked', 'bad', 'ok'].includes(a)) || 'open';
    order.filter((o) => stateOf(o.code) === s).slice(0, n).forEach((o) => console.log(line(o.code)));
    break;
  }
  case 'show':
    codes().forEach((c) => console.log(line(c)));
    break;
  case 'mark': {
    const s = opt('state', 'checked');
    if (!K.STATES[s]) { console.error('--state is checked, bad or ok'); process.exit(1); }
    const note = opt('note');
    const by = opt('by', 'agent');
    const at = new Date().toISOString().slice(0, 10);
    for (const c of codes()) {
      checks[c] = K.clean({ s, by, at, note: note != null ? note : checks[c] && checks[c].note });
      console.log(line(c));
    }
    save();
    break;
  }
  case 'clear':
    for (const c of codes()) { delete checks[c]; console.log(line(c)); }
    save();
    break;
  default:
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}
