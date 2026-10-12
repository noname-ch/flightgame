// Runs in the game page: tidy(code) -> { ops, stats } with the airport editor's own tools.
// - a wobbly taxiway (3+ points, all within 3 m of the line between its ends) becomes straight (ends kept, so
//   junctions stay joined);
// - a taxiway that turns about 90 degrees once (legs 25 m+) becomes the editor's "90° turn" when that stays
//   within 8 m of it;
// - aprons and buildings get square corners (editor "Straighten") when that moves no point more than 2.5 m
//   (aprons 4 m).
window.tidy = async function (code) {
  FG.layouts.get(code);
  for (let i = 0; i < 80 && !(FG.layouts.settled(code) && !FG.layouts.pending(code)); i++) await new Promise((r) => setTimeout(r, 500));
  const lay = FG.layouts.get(code);
  if (!lay) return { ops: [], stats: { none: 1 } };
  const E = FG.airportEdit;
  const gap = FG.fixes.gap;
  const M = 111320, DEG = Math.PI / 180;
  const xy = (o) => { const kx = M * Math.cos(o[0] * DEG); return (p) => [(p[1] - o[1]) * kx, (p[0] - o[0]) * M]; };
  const ops = [];
  const stats = { straight: 0, turn: 0, square: 0 };
  for (const l of lay.taxiways) {
    if (l.length < 3) continue;
    const F = xy(l[0]);
    const p = l.map(F);
    const a = p[0], b = p[p.length - 1];
    const ch = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (ch < 10) continue;
    let far = 0;
    for (const q of p) far = Math.max(far, Math.abs((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) / ch);
    if (far <= 3) {
      if (far > 0.3) { ops.push({ op: 'set', kind: 'taxiway', from: l, geom: [l[0], l[l.length - 1]] }); stats.straight++; }
      continue;
    }
    // one turn of about 90 degrees: the first and the last stretch (15 m+ each way from the ends)
    const along = (from, step) => { let i = from, d = 0; while (i + step >= 0 && i + step < p.length && d < 15) { d += Math.hypot(p[i + step][0] - p[i][0], p[i + step][1] - p[i][1]); i += step; } return p[i]; };
    const s = along(0, 1), e = along(p.length - 1, -1);
    const t1 = Math.atan2(s[1] - a[1], s[0] - a[0]), t2 = Math.atan2(b[1] - e[1], b[0] - e[0]);
    let turn = Math.abs(((t2 - t1) / DEG + 540) % 360 - 180);
    if (turn < 70 || turn > 110) continue;
    const g = E.rightTurn(l);
    if (!g) continue;
    const gp = g.map(F);
    const legA = Math.hypot(gp[1][0] - a[0], gp[1][1] - a[1]), legB = Math.hypot(b[0] - gp[gp.length - 2][0], b[1] - gp[gp.length - 2][1]);
    if (legA < 10 || legB < 10) continue;
    const d = gap('taxiway', g, l);
    if (d <= 8 && d > 0.5) { ops.push({ op: 'set', kind: 'taxiway', from: l, geom: g }); stats.turn++; }
  }
  for (const [list, kind, max] of [[lay.aprons, 'apron', 4], [lay.terminals, 'terminal', 2.5], [lay.hangars, 'hangar', 2.5], [lay.others || [], 'building', 2.5]]) {
    for (const r of list) {
      if (r.length < 4) continue;
      let g;
      try { g = E.squareRing(r); } catch (err) { continue; }
      if (!g || g.length < 4) continue;
      const d = gap(kind, g, r);
      if (d <= max && d > 0.4) { ops.push({ op: 'set', kind, from: r, geom: g }); stats.square++; }
    }
  }
  return { ops, stats };
};
