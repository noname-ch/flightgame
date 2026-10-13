// Runs in the game page: tidy(code) -> { ops, stats } with the airport editor's own tools.
// - a wobbly taxiway (3+ points, all within 3 m of the line between its ends) becomes straight (ends kept, so
//   junctions stay joined);
// - a taxiway that turns about 90 degrees once (legs 25 m+) becomes the editor's "90° turn" when that stays
//   within 8 m of it;
// - one that turns once by another angle (15-165 degrees: exits, angled links) becomes the editor's Curve
//   (fitCurve + curvePts: straight legs along its two ends, a round corner) with the radius that follows it
//   best, when that stays within 6 m of it;
// - aprons and buildings get square corners (editor "Straighten") when that moves no point more than 2.5 m
//   (aprons 4 m).
// No turn or curve where the taxiway has a point on a runway (half its width + 10 m) or one of its legs runs along
// a runway (within 20 degrees, 350 m of it): those are lead-ins and fillets on the runway or the parallel
// taxiway, and a curve there lies over the runway. They are only straightened when they are just wobbly.
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
  const stats = { straight: 0, turn: 0, curve: 0, square: 0 };
  const RADII = [15, 20, 30, 45, 60, 80, 110, 150, 200, 300, 450, 700, 1000];
  // The Curve tool's curve from the taxiway's first point to its last, leaving and arriving along its ends.
  function curveOf(l, F, t1, t2) {
    const o = l[0], kx = M * Math.cos(o[0] * DEG);
    const ll = (q) => [Math.round((o[0] + q[1] / M) * 1e6) / 1e6, Math.round((o[1] + q[0] / kx) * 1e6) / 1e6];
    const a = F(l[0]), b = F(l[l.length - 1]);
    const fit = E.fitCurve(a, b, t1, t2);
    if (!fit) return null;
    let best = null;
    for (const R of RADII) {
      const c = E.curvePts(a, b, fit.angle, fit.side, fit.bend, R);
      if (c.radius < R * 0.5 && best) break; // (no room for bigger ones)
      const g = [l[0], ...c.pts.slice(1, -1).map(ll), l[l.length - 1]];
      const d = gap('taxiway', g, l);
      if (!best || d < best.d) best = { g, d };
    }
    return best;
  }
  const rws = FG.game.airportRunways(code) || [];
  const segM = (q, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1]); };
  // true when the line l (points p in F's frame, legs leaving at angles t1 and t2) lies on or along a runway
  function byRunway(F, p, t1, t2) {
    for (const r of rws) {
      const A = F([r[0], r[1]]), B = F([r[2], r[3]]);
      if (p.some((q) => segM(q, A, B) < r[4] / 2 + 10)) return true;
      const tr = Math.atan2(B[1] - A[1], B[0] - A[0]);
      const par = (t) => { const d = Math.abs(((t - tr) / DEG + 360) % 180); return Math.min(d, 180 - d) < 20; };
      if ((par(t1) && segM(p[0], A, B) < 350) || (par(t2) && segM(p[p.length - 1], A, B) < 350)) return true;
    }
    return false;
  }
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
    if (byRunway(F, p, t1, t2)) { stats.byRunway = (stats.byRunway || 0) + 1; continue; }
    if (turn < 70 || turn > 110) {
      if (turn < 15 || turn > 165) continue;
      const c = curveOf(l, F, t1, t2);
      if (c && c.d <= 6 && c.d > 0.5) { ops.push({ op: 'set', kind: 'taxiway', from: l, geom: c.g }); stats.curve++; }
      continue;
    }
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
