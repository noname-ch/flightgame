// fixOverlaps(code): stands to delete so none blocks another (greedy), as raw layout geoms -> del ops
window.fixOverlaps = function (code) {
  const st = FG.game.apronOf(code).stands;
  const raw = FG.layouts.get(code).stands;
  const M = 111320, k = M * Math.cos(st[0].lat * Math.PI / 180);
  const xy = (p) => [p[1] * k, p[0] * M];
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const cross = (a, b, c, d) => o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
  const seg = (p, a, b) => { const bx = b[0] - a[0], by = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * bx + (p[1] - a[1]) * by) / (bx * bx + by * by || 1))); return Math.hypot(p[0] - a[0] - t * bx, p[1] - a[1] - t * by); };
  const P = st.map((s) => xy([s.lat, s.lon])), L = st.map((s) => s.lead.map(xy));
  const gone = new Set();
  const why = [];
  for (;;) {
    let hit = null;
    for (let i = 0; i < st.length && !hit; i++) for (let j = 0; j < st.length && !hit; j++) {
      if (i === j || gone.has(i) || gone.has(j)) continue;
      const d = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
      if (i < j && d < 24) hit = [j, `${st[j].name} only ${Math.round(d)} m from ${st[i].name}`];
      else if (i < j && cross(L[i][0], L[i][1], L[j][0], L[j][1])) hit = [j, `${st[j].name}'s lead-in crossed ${st[i].name}'s`];
      else if (seg(P[j], L[i][0], L[i][1]) < 18) hit = [j, `${st[j].name} stood in ${st[i].name}'s way`];
    }
    if (!hit) break;
    gone.add(hit[0]);
    why.push(hit[1]);
  }
  const ops = [...gone].map((i) => {
    const s = st[i];
    const r = raw.reduce((best, g) => { const d = Math.hypot((g[0] - s.lat) * M, (g[1] - s.lon) * k); return d < best.d ? { d, g } : best; }, { d: Infinity });
    return r.d < 3 ? { op: 'del', kind: 'stand', geom: r.g } : null;
  }).filter(Boolean);
  return { ops, why };
};
