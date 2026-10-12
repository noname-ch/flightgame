// Runs in the game page: nosein(code) -> { ops, stats }. A stand within 70 m of a terminal faces it: its heading
// becomes the bearing to the nearest point of the nearest terminal (nose-in, as at a gate), where it is more
// than 8 degrees off. Remote stands (no terminal that close) keep theirs.
window.nosein = async function (code) {
  FG.layouts.get(code);
  for (let i = 0; i < 80 && !(FG.layouts.settled(code) && !FG.layouts.pending(code)); i++) await new Promise((r) => setTimeout(r, 500));
  const lay = FG.layouts.get(code);
  if (!lay) return { ops: [], stats: { none: 1 } };
  const M = 111320, DEG = Math.PI / 180;
  const ops = [];
  const stats = { turned: 0, kept: 0, remote: 0 };
  for (const s of lay.stands) {
    const kx = M * Math.cos(s[0] * DEG);
    const xy = (p) => [(p[1] - s[1]) * kx, (p[0] - s[0]) * M]; // metres from the stand, x east, y north
    let best = null;
    for (const r of lay.terminals) {
      for (let i = 0; i < r.length; i++) {
        const a = xy(r[i]), b = xy(r[(i + 1) % r.length]);
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy || 1)));
        const q = [a[0] + t * dx, a[1] + t * dy];
        const d = Math.hypot(q[0], q[1]);
        if (!best || d < best.d) best = { d, q };
      }
    }
    if (!best || best.d > 70 || best.d < 1) { stats.remote++; continue; }
    const hdg = Math.round((Math.atan2(best.q[0], best.q[1]) / DEG + 360) % 360);
    const off = Math.abs(((hdg - s[2]) % 360 + 540) % 360 - 180);
    if (off <= 8) { stats.kept++; continue; }
    const g = s.slice();
    g[2] = hdg;
    ops.push({ op: 'set', kind: 'stand', from: s, geom: g });
    stats.turned++;
  }
  return { ops, stats };
};
