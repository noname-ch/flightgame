// overlaps(code): pairs of stands too close (< 28 m apart) or whose lead-in lines cross: [[i, j, name, name, why]]
window.overlaps = function (code) {
  const st = FG.game.apronOf(code).stands;
  const M = 111320, k = M * Math.cos(st[0].lat * Math.PI / 180);
  const xy = (p) => [p[1] * k, p[0] * M];
  const cross = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
  };
  const seg = (p, a, b) => { const bx = b[0] - a[0], by = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * bx + (p[1] - a[1]) * by) / (bx * bx + by * by || 1))); return Math.hypot(p[0] - a[0] - t * bx, p[1] - a[1] - t * by); };
  const out = [];
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
    const a = xy([st[i].lat, st[i].lon]), b = xy([st[j].lat, st[j].lon]);
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const la = st[i].lead.map(xy), lb = st[j].lead.map(xy);
    if (d < 28) out.push([i, j, st[i].name, st[j].name, `${Math.round(d)} m`]);
    else if (cross(la[0], la[1], lb[0], lb[1])) out.push([i, j, st[i].name, st[j].name, 'leads cross']);
    else if (seg(b, la[0], la[1]) < 12) out.push([i, j, st[i].name, st[j].name, `${st[j].name} stands in ${st[i].name}'s way`]);
    else if (seg(a, lb[0], lb[1]) < 12) out.push([j, i, st[j].name, st[i].name, `${st[i].name} stands in ${st[j].name}'s way`]);
  }
  return out;
};
