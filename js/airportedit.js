// Airport editor (developer tools, F3): fix airports where the map data is wrong or missing. Click the
// satellite picture where something is off; a window there offers what can be done at that spot:
// - on a runway, taxiway, apron, building, stand or tower: redraw it, straighten it (a taxiway becomes one
//   straight line, an apron or building gets square corners; "90° turn" makes a bent taxiway two straight
//   legs at a right angle with a round corner), move its points, or delete it;
// - anywhere: add a runway, taxiway, stand, apron, terminal, hangar, other building or tower, and where no
//   airport is near, a whole airport.
// Adding and redrawing first look for the thing in the map data (OpenStreetMap vector tiles, read by
// js/osmairports.js) and show what they found; where nothing (or something wrong) is found, draw it yourself
// by clicking its points. Changes show at once; Save keeps them (js/fixes.js): in js/data/fixes.js when the
// game runs from ./play.sh; on the website as a commit to the repo, for contributors signed in to GitHub;
// else in this browser. Every game loads them, new or saved.
(function () {
  const G = FG.game;
  const D = FG.data;
  const M = 111320;
  const DEG = Math.PI / 180;
  const r5 = (n) => Math.round(n * 1e5) / 1e5;
  const NAMES = { row: 'stand row', runway: 'runway', taxiway: 'taxiway', apron: 'apron', pad: 'pad', terminal: 'terminal', hangar: 'hangar', building: 'building', stand: 'stand', tower: 'tower', airport: 'airport' };
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const RINGS = new Set(['apron', 'pad', 'terminal', 'hangar', 'building']);
  const BUILDINGS = ['terminal', 'hangar', 'building'];
  const ADD = ['runway', 'taxiway', 'stand', 'row', 'apron', 'pad', 'terminal', 'hangar', 'building', 'tower'];
  const ORDER = { stand: 0, tower: 1, terminal: 2, hangar: 2, building: 2, taxiway: 3, runway: 4, apron: 5, pad: 5 }; // on top first
  const MAX_ZOOM = 19; // closer than the game's map goes (the satellite tiles end at 18)
  const STYLE = {
    sel: { color: '#facc15', weight: 3, fillColor: '#facc15', fillOpacity: 0.15 },
    add: { color: '#4ade80', weight: 2, fillColor: '#4ade80', fillOpacity: 0.12 },
    del: { color: '#f87171', weight: 2, dashArray: '5 5', fill: false },
    found: { color: '#22d3ee', weight: 3, dashArray: '8 5', fillColor: '#22d3ee', fillOpacity: 0.2 },
    draw: { color: '#f472b6', weight: 2.5, fillColor: '#f472b6', fillOpacity: 0.15 },
    stand: { color: '#e2e8f0', weight: 1, fillColor: '#e2e8f0', fillOpacity: 0.5 },
  };

  const ed = {
    on: false,
    code: null,   // airport being fixed
    at: null,     // last click [lat, lon]
    hits: [],     // what lies there: { code, kind, geom, d }, the top one first
    sel: null,    // selected element
    form: null,   // 'airport': the new-airport form is open in the window
    draw: null,   // drawing: { kind, pts, replace, mouse }
    edit: null,   // moving points: { e, pts }
    found: null,  // from the map data, shown before it is used: { kind, geoms, replace, text }
    row: null,    // a row of stands being placed: { a, b, spacing, flip, prefix }
    busy: false,  // looking in the map data, saving or signing in
    target: null, // where Save puts the fixes: 'server', 'github' or 'browser' (FG.fixes.target)
    signin: false, // the GitHub sign-in form is open
    undo: [],     // [{ code, ops }] before each change
    msg: '',
    bad: false,
  };
  let map;
  let layer;       // fixes, selection, what was found
  let draftLayer;  // what is being drawn or moved
  let handleLayer; // draggable points
  let renderer;
  let pop;         // Leaflet popup and its content element
  let popEl;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------- geometry ([lat, lon], metres round a point) ----------
  function frame(o) {
    const kx = M * Math.cos(o[0] * DEG);
    return { xy: (p) => [(p[1] - o[1]) * kx, (p[0] - o[0]) * M], ll: (q) => [r5(o[0] + q[1] / M), r5(o[1] + q[0] / kx)] };
  }
  const dist = (p, q) => Math.hypot((q[1] - p[1]) * M * Math.cos(p[0] * DEG), (q[0] - p[0]) * M);
  // Nearest point of segment a-b to p (metres frame): { d, q, t }.
  function foot(p, a, b) {
    const bx = b[0] - a[0], by = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * bx + (p[1] - a[1]) * by) / (bx * bx + by * by || 1)));
    const q = [a[0] + t * bx, a[1] + t * by];
    return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q, t };
  }
  // Nearest point of a line or ring ([lat, lon]) to p: { d (m), q ([lat, lon]), i (segment) }.
  function nearest(p, line, closed) {
    const F = frame(p);
    const pts = line.map(F.xy);
    let best = { d: Infinity, q: null, i: -1 };
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const f = foot([0, 0], pts[i], pts[(i + 1) % pts.length]);
      if (f.d < best.d) best = { d: f.d, q: F.ll(f.q), i };
    }
    if (pts.length === 1) best = { d: dist(p, line[0]), q: line[0], i: 0 };
    return best;
  }
  function inRing(p, r) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i];
      const b = r[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  const lengthOf = (l) => l.slice(1).reduce((s, p, i) => s + dist(l[i], p), 0);
  function areaOf(r) {
    const F = frame(r[0]);
    const q = r.map(F.xy);
    let s = 0;
    for (let i = 0; i < q.length; i++) { const a = q[i]; const b = q[(i + 1) % q.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(s) / 2;
  }
  const bearing = (a, b) => G.bearing({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });
  function offset(p, hdg, m) {
    return [p[0] + (m * Math.cos(hdg * DEG)) / M, p[1] + (m * Math.sin(hdg * DEG)) / (M * Math.cos(p[0] * DEG))];
  }
  const designator = (h) => String(Math.round((((h % 360) + 360) % 360) / 10) || 36).padStart(2, '0');
  const runwayName = (g) => { const h = bearing([g[0], g[1]], [g[2], g[3]]); return `${designator(h)}/${designator(h + 180)}`; };
  function runwayCorners(g) {
    const h = bearing([g[0], g[1]], [g[2], g[3]]);
    const half = Math.max(2, g[4] / 2);
    return [offset([g[0], g[1]], h - 90, half), offset([g[2], g[3]], h - 90, half), offset([g[2], g[3]], h + 90, half), offset([g[0], g[1]], h + 90, half)];
  }
  function shape(kind, g) {
    if (kind === 'runway') return [[g[0], g[1]], [g[2], g[3]]];
    if (kind === 'stand' || kind === 'tower') return [[g[0], g[1]]];
    return g;
  }
  // Metres per screen pixel at a latitude.
  const mpp = (lat) => (40075016 * Math.cos(lat * DEG)) / 2 ** (map.getZoom() + 8);
  const px = (a, b) => map.latLngToContainerPoint(a).distanceTo(map.latLngToContainerPoint(b));

  // Convex hull (metres frame).
  function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    const up = [];
    for (const q of p.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  // Smallest rectangle round the points (metres frame): middle, unit direction of its long side, length, width.
  function rectOf(pts) {
    const h = hull(pts);
    let best = null;
    for (let i = 0; i < h.length; i++) {
      const a = h[i];
      const b = h[(i + 1) % h.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 1e-6) continue;
      const u = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const q of h) {
        const s = q[0] * u[0] + q[1] * u[1];
        const t = -q[0] * u[1] + q[1] * u[0];
        u0 = Math.min(u0, s); u1 = Math.max(u1, s); v0 = Math.min(v0, t); v1 = Math.max(v1, t);
      }
      const area = (u1 - u0) * (v1 - v0);
      if (!best || area < best.area) best = { area, u, u0, u1, v0, v1 };
    }
    if (!best) return null;
    let { u, u0, u1, v0, v1 } = best;
    if (v1 - v0 > u1 - u0) { u = [-u[1], u[0]]; [u0, u1, v0, v1] = [v0, v1, -u1, -u0]; } // long side first
    const su = (u0 + u1) / 2, sv = (v0 + v1) / 2;
    const at = (s, t) => [s * u[0] - t * u[1], s * u[1] + t * u[0]];
    return { c: at(su, sv), u, len: u1 - u0, wid: v1 - v0, corners: [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)] };
  }

  // ---------- straightening ----------
  // A taxiway: one straight line through its points, from its first to its last.
  function straightLine(line) {
    const F = frame(line[0]);
    const p = line.map(F.xy);
    const n = p.length;
    const c = [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n];
    let sxx = 0, syy = 0, sxy = 0;
    for (const q of p) { const x = q[0] - c[0], y = q[1] - c[1]; sxx += x * x; syy += y * y; sxy += x * y; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); // main direction (least squares across it)
    const u = [Math.cos(th), Math.sin(th)];
    const on = (q) => { const s = (q[0] - c[0]) * u[0] + (q[1] - c[1]) * u[1]; return [c[0] + s * u[0], c[1] + s * u[1]]; };
    return [F.ll(on(p[0])), F.ll(on(p[n - 1]))];
  }
  // A taxiway that turns: two straight legs at a right angle, joined by a round corner. The legs keep the
  // taxiway's ends and the mean direction of its two halves (split where it is farthest from its chord);
  // the corner's radius is RADIUS m, less where a leg is short. Null where it doesn't turn.
  const RADIUS = 45;
  function rightTurn(line) {
    const F = frame(line[0]);
    const p = line.map(F.xy);
    const n = p.length;
    const a = p[0], b = p[n - 1];
    const ch = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (n < 3 || ch < 5) return null;
    let k = 0, far = 0;
    for (let i = 1; i < n - 1; i++) {
      const d = Math.abs((b[0] - a[0]) * (p[i][1] - a[1]) - (b[1] - a[1]) * (p[i][0] - a[0])) / ch;
      if (d > far) { far = d; k = i; }
    }
    if (far < 3) return null; // (straight: Straighten does that)
    const dir = (from, to) => Math.atan2(to[1] - from[1], to[0] - from[0]);
    const tA = dir(a, p[k]);
    const tB = dir(p[k], b);
    const s = Math.sin(tB - tA) >= 0 ? 1 : -1; // turning left (1) or right
    // leg A's direction: between its own and leg B's turned back by 90 degrees
    const tB0 = tB - s * Math.PI / 2;
    const t = Math.atan2(Math.sin(tA) + Math.sin(tB0), Math.cos(tA) + Math.cos(tB0));
    const u = [Math.cos(t), Math.sin(t)];
    const w = [-s * u[1], s * u[0]];
    const lA = (b[0] - a[0]) * u[0] + (b[1] - a[1]) * u[1]; // the corner lies this far along leg A
    const c = [a[0] + lA * u[0], a[1] + lA * u[1]];
    const lB = (b[0] - c[0]) * w[0] + (b[1] - c[1]) * w[1];
    if (lA < 5 || lB < 5) return null;
    const R = Math.min(RADIUS, lA * 0.8, lB * 0.8);
    const o = [c[0] - u[0] * R + w[0] * R, c[1] - u[1] * R + w[1] * R]; // the corner's centre
    const arc = [];
    for (let i = 0; i <= 8; i++) {
      const f = (i / 8) * Math.PI / 2;
      arc.push([o[0] + R * (-w[0] * Math.cos(f) + u[0] * Math.sin(f)), o[1] + R * (-w[1] * Math.cos(f) + u[1] * Math.sin(f))]);
    }
    return [a, ...arc, b].map(F.ll);
  }
  // An apron or building: square corners. Its sides are turned to the main direction (or across it) and
  // where two sides meet is the corner; with fewer than four sides, the smallest rectangle round it.
  function squareRing(ring) {
    const F = frame(ring[0]);
    let p = ring.map(F.xy);
    p = p.filter((q, i) => Math.hypot(q[0] - p[(i + 1) % p.length][0], q[1] - p[(i + 1) % p.length][1]) > 0.5);
    let sx = 0, sy = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = Math.atan2(b[1] - a[1], b[0] - a[0]);
      sx += l * Math.cos(4 * t); sy += l * Math.sin(4 * t);
    }
    const th = Math.atan2(sy, sx) / 4;
    const rot = (q, a) => [q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a)];
    const r = p.map((q) => rot(q, -th));
    const n = r.length;
    const cls = r.map((a, i) => { const b = r[(i + 1) % n]; return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'h' : 'v'; });
    const start = cls.findIndex((c, i) => c !== cls[(i + n - 1) % n]);
    const rect = () => { const R = rectOf(p); return R.corners.map(F.ll); };
    if (start < 0) return rect();
    const sides = [];
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      const a = r[i];
      const b = r[(i + 1) % n];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const v = cls[i] === 'h' ? (a[1] + b[1]) / 2 : (a[0] + b[0]) / 2;
      const last = sides[sides.length - 1];
      if (last && last.c === cls[i]) { last.s += v * l; last.l += l; } else sides.push({ c: cls[i], s: v * l, l });
    }
    if (sides.length < 4 || sides.length % 2) return rect();
    const val = (s) => s.s / (s.l || 1);
    const out = sides.map((s, k) => {
      const t = sides[(k + 1) % sides.length];
      const h = s.c === 'h' ? s : t;
      const v = s.c === 'h' ? t : s;
      return rot([val(v), val(h)], th);
    });
    return out.map(F.ll);
  }

  // ---------- what is where ----------
  // The airport's layout as the editor sees it: with its fixes, also where that is too little for the game yet.
  function layoutOf(code) {
    const lay = FG.layouts.get(code);
    if (lay) return lay;
    const raw = FG.layouts.raw(code);
    return FG.fixes.layout(code, raw || null) || null;
  }
  function elements(code) {
    const out = G.airportRunways(code).map((g) => ({ code, kind: 'runway', geom: g }));
    const lay = layoutOf(code);
    if (lay) for (const [kind, list] of Object.entries(FG.fixes.LISTS)) for (const g of lay[list] || []) out.push({ code, kind, geom: g });
    return out.concat(madeUp(code));
  }
  // Where too little is mapped, the game lays the airport out itself (game.js apronOf). Its apron, terminal
  // buildings, hangars, taxiways and stands can be picked like the rest (`madeUp: true`). The first change to
  // one of them turns them all into fixes, added as they are (see commit), so the airport has a layout of its
  // own from then on and the change applies to that: the game stops making it up.
  function madeUp(code) {
    if (!code || FG.layouts.has(code) || FG.layouts.pending(code)) return [];
    const ap = G.apronOf(code);
    if (!ap || ap.real) return [];
    const pt = ([lat, lon]) => [r5(lat), r5(lon)];
    const out = [];
    const seen = new Set();
    const put = (kind, geom) => {
      const k = `${kind}|${keyOf(geom)}`;
      if (!seen.has(k)) { seen.add(k); out.push({ code, kind, geom, madeUp: true }); }
    };
    put('apron', ap.apron.map(pt));
    put('terminal', ap.terminal.map(pt));
    for (const b of ap.buildings) {
      if (b.kind === 'terminal' || b.kind === 'hall') put('terminal', b.ring.map(pt));
      else if (b.kind === 'hangar') put('hangar', b.ring.map(pt));
    }
    for (const l of G.taxiwaysOf(code)) put('taxiway', l.map(pt));
    for (const st of ap.stands) put('stand', [r5(st.lat), r5(st.lon), Math.round(st.heading), st.name || '', 1]);
    return out;
  }
  function airportsNear(p, km) {
    const dLat = km / 111;
    const dLon = km / (111 * Math.max(0.05, Math.cos(p[0] * DEG)));
    return D.airports.filter((a) => !a.factory && Math.abs(a.lat - p[0]) < dLat && Math.abs(a.lon - p[1]) < dLon)
      .map((a) => [a, dist(p, [a.lat, a.lon])]).sort((x, y) => x[1] - y[1]).map(([a]) => a);
  }
  // Which airport a spot belongs to: the one whose runways (or point) are nearest, within 8 km.
  function owner(p) {
    let best = null;
    for (const a of airportsNear(p, 8)) {
      let d = dist(p, [a.lat, a.lon]);
      for (const r of G.airportRunways(a.code)) d = Math.min(d, nearest(p, [[r[0], r[1]], [r[2], r[3]]]).d);
      if (a.code === ed.code) d -= 300; // the airport being fixed, if it is about as near
      if (d < 8000 && (!best || d < best.d)) best = { a, d };
    }
    return best ? best.a : null;
  }
  function distTo(e, p) {
    if (e.kind === 'runway') { const g = e.geom; return Math.max(0, nearest(p, [[g[0], g[1]], [g[2], g[3]]]).d - g[4] / 2); }
    if (e.kind === 'stand' || e.kind === 'tower') return dist(p, e.geom);
    if (RINGS.has(e.kind)) return inRing(p, e.geom) ? 0 : nearest(p, e.geom, true).d;
    return nearest(p, e.geom).d;
  }
  function hitsAt(p) {
    const k = mpp(p[0]);
    const tol = { stand: Math.max(18, 9 * k), tower: Math.max(10, 8 * k), taxiway: Math.max(8, 7 * k), runway: 6 * k };
    const out = [];
    for (const a of airportsNear(p, 8)) {
      for (const e of elements(a.code)) {
        const d = distTo(e, p);
        if (d <= (tol[e.kind] != null ? tol[e.kind] : 5 * k)) out.push(Object.assign(e, { d }));
      }
    }
    return out.sort((x, y) => ORDER[x.kind] - ORDER[y.kind] || x.d - y.d);
  }
  function describe(kind, g) {
    if (kind === 'runway') return `Runway ${runwayName(g)} · ${Math.round(dist([g[0], g[1]], [g[2], g[3]])).toLocaleString('de-CH')} m × ${g[4]} m${g[5] ? '' : ' grass'}`;
    if (kind === 'taxiway') return `Taxiway · ${Math.round(lengthOf(g)).toLocaleString('de-CH')} m`;
    if (kind === 'stand') return `Stand ${g[3] || '(no name)'}`;
    if (kind === 'tower') return 'Tower';
    if (kind === 'airport') return `Airport ${g.code} · ${g.name}`;
    if (kind === 'bridges') return `Jet bridges ${g ? 'on' : 'off'}`;
    const a = areaOf(g);
    return `${cap(NAMES[kind])} · ${a >= 10000 ? `${(a / 10000).toFixed(1)} ha` : `${Math.round(a)} m²`}`;
  }
  // A new runway is as wide as the airport's longest (else as is usual for its size).
  const defaultWidth = (code) => {
    const rws = code ? G.airportRunways(code) : [];
    if (rws.length) return rws.reduce((a, b) => (G.runwayLength(b) > G.runwayLength(a) ? b : a))[4];
    return [18, 23, 30, 45, 45, 60][code ? G.airportSize(code) : 1] || 30;
  };

  // ---------- looking in the map data ----------
  const keyOf = (x) => JSON.stringify(x);
  async function mapData(p, m) {
    if (!FG.osmAirports || !FG.osmAirports.around) throw new Error('the map data reader has not loaded (offline?)');
    return FG.osmAirports.around(p[0], p[1], m);
  }
  // A runway at p: the mapped runway line or area nearest it, with the pieces of it in the next tiles.
  async function findRunway(p) {
    let data = await mapData(p, 400);
    const seen = new Set(data.runways.map(keyOf));
    let found = null;
    for (let round = 0; round < 8; round++) {
      found = runwayFrom(p, data.runways);
      if (!found) return [];
      // its ends may lie in tiles not read yet
      let more = false;
      for (const end of [[found[0], found[1]], [found[2], found[3]]]) {
        const d = await mapData(end, 300);
        for (const r of d.runways) { const k = keyOf(r); if (!seen.has(k)) { seen.add(k); data.runways.push(r); more = true; } }
      }
      if (!more) break;
      data = { runways: data.runways };
    }
    return found ? [found] : [];
  }
  function runwayFrom(p, pieces) {
    const F = frame(p);
    const items = pieces.map((r) => ({ pts: (r.line || r.ring).map(F.xy), ring: !!r.ring, ref: r.ref }));
    const near = (it) => {
      let d = Infinity;
      const n = it.ring ? it.pts.length : it.pts.length - 1;
      for (let i = 0; i < n; i++) d = Math.min(d, foot([0, 0], it.pts[i], it.pts[(i + 1) % it.pts.length]).d);
      if (it.ring && inRing([0, 0], it.pts)) d = 0;
      return d;
    };
    const first = items.map((it) => [it, near(it)]).filter(([, d]) => d < 70).sort((a, b) => a[1] - b[1])[0];
    if (!first) return null;
    const it = first[0];
    let base;
    let u;
    if (it.ring) {
      const R = rectOf(it.pts);
      base = R.c; u = R.u;
    } else {
      let best = null;
      for (let i = 1; i < it.pts.length; i++) { const f = foot([0, 0], it.pts[i - 1], it.pts[i]); if (!best || f.d < best.f.d) best = { f, i }; }
      const a = it.pts[best.i - 1];
      const b = it.pts[best.i];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      base = best.f.q; u = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    }
    // Every piece along that axis: the line's (its centre line) or else the areas' ends, the areas' mean width
    // (area / length: a turning pad at one end barely widens it) and middle.
    const ext = { line: [Infinity, -Infinity], ring: [Infinity, -Infinity] };
    let lines = 0, acrossSum = 0, area = 0, areaAcross = 0;
    for (const x of items) {
      const along = x.pts.map((q) => (q[0] - base[0]) * u[0] + (q[1] - base[1]) * u[1]);
      const across = x.pts.map((q) => -(q[0] - base[0]) * u[1] + (q[1] - base[1]) * u[0]);
      if (across.some((v) => Math.abs(v) > 50)) continue; // another runway, crossing this one
      const e = ext[x.ring ? 'ring' : 'line'];
      e[0] = Math.min(e[0], ...along); e[1] = Math.max(e[1], ...along);
      if (x.ring) {
        let s2 = 0, c = 0;
        for (let i = 0; i < x.pts.length; i++) {
          const j = (i + 1) % x.pts.length;
          const cr = along[i] * across[j] - along[j] * across[i];
          s2 += cr; c += (across[i] + across[j]) * cr;
        }
        if (Math.abs(s2) > 1e-6) { area += Math.abs(s2) / 2; areaAcross += (c / (3 * s2)) * Math.abs(s2) / 2; }
      } else { lines += across.length; acrossSum += across.reduce((sum, v) => sum + v, 0); }
    }
    const [lo, hi] = lines ? ext.line : ext.ring;
    if (!(hi - lo >= 150)) return null;
    const mid = lines ? acrossSum / lines : area ? areaAcross / area : 0;
    // (only a centre line mapped: as wide as the runway it replaces, or the usual width)
    const width = area && ext.ring[1] > ext.ring[0] ? Math.max(10, Math.round(area / (ext.ring[1] - ext.ring[0]))) : null;
    const at = (s) => F.ll([base[0] + s * u[0] - mid * u[1], base[1] + s * u[1] + mid * u[0]]);
    const a = at(lo);
    const b = at(hi);
    return [a[0], a[1], b[0], b[1], width, 1];
  }
  // A taxiway at p: the mapped one nearest it, joined to the pieces that carry on straight from its ends
  // (it is cut at the tile edges, and often where another one meets it).
  async function findTaxiway(p) {
    const data = await mapData(p, 500);
    const F = frame(p);
    const lines = data.taxiways.map((l) => l.map(F.xy));
    const near = lines.map((l, i) => {
      let d = Infinity;
      for (let k = 1; k < l.length; k++) d = Math.min(d, foot([0, 0], l[k - 1], l[k]).d);
      return [i, d];
    }).filter(([, d]) => d < 30).sort((a, b) => a[1] - b[1])[0];
    if (!near) return [];
    let chain = lines[near[0]].slice();
    const used = new Set([near[0]]);
    const dir = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
    const turn = (x, y) => Math.abs(((x - y + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    for (let grew = true; grew;) {
      grew = false;
      for (let i = 0; i < lines.length; i++) {
        if (used.has(i)) continue;
        const l = lines[i];
        const end = chain[chain.length - 1];
        const endDir = dir(chain[chain.length - 2], end);
        const start = chain[0];
        const startDir = dir(start, chain[1]);
        const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 4;
        const tryJoin = (seq) => {
          if (close(seq[0], end) && turn(dir(seq[0], seq[1]), endDir) < 0.5) { chain = chain.concat(seq.slice(1)); return true; }
          const last = seq[seq.length - 1];
          if (close(last, start) && turn(dir(seq[seq.length - 2], last), startDir) < 0.5) { chain = seq.slice(0, -1).concat(chain); return true; }
          return false;
        };
        if (tryJoin(l) || tryJoin(l.slice().reverse())) { used.add(i); grew = true; }
      }
    }
    const out = chain.map(F.ll).filter((q, i, a) => !i || q[0] !== a[i - 1][0] || q[1] !== a[i - 1][1]);
    return out.length > 1 ? [out] : [];
  }
  // An apron or building at p: the mapped one p lies in, and its pieces in the next tiles.
  async function findRing(p, kind) {
    const data = await mapData(p, 300);
    const rings = kind === 'apron' ? data.aprons : data.buildings.map((b) => b.ring);
    const inside = rings.filter((r) => inRing(p, r)).sort((a, b) => areaOf(a) - areaOf(b));
    if (!inside.length) return [];
    const out = [inside[0]];
    // pieces of the same one in the next tiles meet it along the tile edge (two points in common)
    const common = (a, b) => a.filter((q) => b.some((w) => dist(q, w) < 0.6)).length;
    for (let grew = true; grew && kind === 'apron';) {
      grew = false;
      for (const r of rings) if (!out.includes(r) && out.some((o) => common(r, o) >= 2)) { out.push(r); grew = true; }
    }
    return out;
  }
  async function lookup(kind, p) {
    if (kind === 'runway') return findRunway(p);
    if (kind === 'taxiway') return findTaxiway(p);
    if (kind === 'pad') return findRing(p, 'apron'); // (the asphalt mapped there)
    if (RINGS.has(kind)) return findRing(p, kind);
    return [];
  }

  // ---------- changing the fixes ----------
  function setOps(code, ops) {
    if (JSON.stringify(ops) === JSON.stringify(FG.fixes.saved(code))) FG.fixes.discard(code);
    else FG.fixes.edit(code, ops);
  }
  // A change to something a fix added or changed changes that fix instead of adding another.
  function fold(ops, op) {
    if (op.op !== 'add') {
      const target = JSON.stringify(op.op === 'del' ? op.geom : op.from);
      let i = -1;
      ops.forEach((o, k) => { if (o.kind === op.kind && o.op !== 'del' && JSON.stringify(o.geom) === target) i = k; });
      if (i >= 0) {
        const o = ops[i];
        if (op.op === 'set') ops[i] = Object.assign({}, o, { geom: op.geom });
        else if (o.op === 'add') ops.splice(i, 1);
        else ops[i] = { op: 'del', kind: o.kind, geom: o.from };
        return;
      }
    }
    ops.push(op);
  }
  // Changes that are undone together.
  function record(code, list) {
    const ops = FG.fixes.ops(code).slice();
    ed.undo.push({ code, ops: ops.slice() });
    if (ed.undo.length > 100) ed.undo.shift();
    for (const op of list) fold(ops, op);
    setOps(code, ops);
  }
  // Show the change everywhere.
  function refresh() {
    FG.layouts.version++;
    if (FG.view3d) FG.view3d.gatesDirty = true;
    G.dirty = true;
    if (FG.ui && FG.ui.redrawAirports) FG.ui.redrawAirports();
    drawLayer();
    renderPanel();
  }
  // `op`: one change, or several undone together (the last one is selected).
  function commit(code, op, msg) {
    let list = [].concat(op);
    const last = list[list.length - 1];
    // A change to something the game made up: all it made up becomes fixes first (see madeUp).
    const made = madeUp(code);
    const isMade = new Set(made.map((e) => `${e.kind}|${keyOf(e.geom)}`));
    if (list.some((o) => o.op !== 'add' && isMade.has(`${o.kind}|${keyOf(o.op === 'del' ? o.geom : o.from)}`))) {
      list = made.map((e) => ({ op: 'add', kind: e.kind, geom: e.geom })).concat(list);
      msg = `${msg} The rest the game made up here is this airport's own now: change or delete it piece by piece.`;
    }
    record(code, list);
    ed.code = code;
    ed.sel = last.op === 'del' || last.kind === 'airport' ? null : { code, kind: last.kind, geom: last.geom };
    ed.hits = [];
    ed.found = null;
    refresh();
    note(msg);
    if (ed.sel && ed.at) showPopup(); else closePopup();
  }
  function undo() {
    const u = ed.undo.pop();
    if (!u) { note('Nothing to undo.'); return; }
    setOps(u.code, u.ops);
    ed.code = u.code;
    ed.sel = null;
    closePopup();
    refresh();
    note('Undone.');
  }
  function removeOp(code, i) {
    const ops = FG.fixes.ops(code).slice();
    ed.undo.push({ code, ops: ops.slice() });
    ops.splice(i, 1);
    setOps(code, ops);
    ed.sel = null;
    closePopup();
    refresh();
    note('Fix removed.');
  }
  async function save() {
    const codes = FG.fixes.unsaved();
    const before = {};
    for (const c of codes) before[c] = JSON.stringify(FG.fixes.saved(c).filter((o) => o.kind === 'runway'));
    ed.busy = true;
    renderPanel();
    const r = await FG.fixes.save();
    ed.busy = false;
    // new runways: the airport is read off the map again round them
    for (const c of codes) if (JSON.stringify(FG.fixes.ops(c).filter((o) => o.kind === 'runway')) !== before[c]) FG.layouts.reload(c);
    ed.undo = [];
    refresh();
    ed.target = r.where;
    const list = codes.join(', ');
    if (r.error) note(`Not saved ${r.where === 'github' ? 'to GitHub' : 'into js/data/fixes.js'}: ${r.error}. Kept in this browser.`, true);
    else if (!codes.length && !r.saved.length) note('Nothing to save.');
    else if (r.where === 'server') note(`Saved ${r.saved.join(', ')} into js/data/fixes.js. Commit that file to give everyone the fix.`);
    else if (r.where === 'github') note(`Saved ${r.saved.join(', ')} to GitHub. The website has it in a few minutes (this browser has it already).`);
    else note(`Saved ${list || 'it'} in this browser only. Contributors: sign in to GitHub below to save fixes into the game.`);
    renderPanel();
  }
  async function signIn() {
    const input = $('ae-token');
    ed.busy = true;
    note('Asking GitHub…');
    try {
      const login = await FG.fixes.github.signIn(input ? input.value : '');
      ed.signin = false;
      ed.target = await FG.fixes.target();
      note(`Signed in as ${login}: Save commits the fixes to ${FG.fixes.github.repo}.`);
    } catch (e) {
      note(e.message, true);
    }
    ed.busy = false;
    renderPanel();
  }
  async function signOut() {
    FG.fixes.github.signOut();
    ed.target = await FG.fixes.target();
    note('Signed out: the token is gone from this device.');
    renderPanel();
  }
  function download() {
    const blob = new Blob([FG.fixes.fileText()], { type: 'text/javascript' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fixes.js';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    note('Downloaded fixes.js: put it into js/data/ and commit it.');
  }

  // ---------- actions ----------
  function selection() {
    if (!ed.sel) { note('Click on something first.', true); return null; }
    return ed.sel;
  }
  async function redraw() {
    const e = selection();
    if (!e) return;
    if (e.kind === 'stand' || e.kind === 'tower') { startEdit(); return; }
    // the map data first; where it has nothing else, draw it yourself
    await auto(e.kind, ed.at, e);
  }
  async function auto(kind, p, replace) {
    ed.busy = true;
    ed.found = null;
    showPopup();
    let geoms = [];
    let why = '';
    try {
      geoms = await lookup(kind, p);
    } catch (err) {
      why = ` (${err.message})`;
    }
    ed.busy = false;
    if (kind === 'runway') for (const g of geoms) if (g[4] == null) g[4] = replace ? replace.geom[4] : defaultWidth(ed.code);
    if (replace) geoms = geoms.filter((g) => FG.fixes.gap(kind, g, replace.geom) > 3);
    if (!geoms.length) {
      note(`${replace ? 'The map data has no other' : 'Nothing like that in the map data here'}${why}: draw it yourself.`);
      startDraw(kind, replace);
      return;
    }
    const text = geoms.length > 1 ? `${describe(kind, geoms[0])} and ${geoms.length - 1} more piece${geoms.length > 2 ? 's' : ''}` : describe(kind, geoms[0]);
    ed.found = { kind, geoms, replace, text };
    drawLayer();
    showPopup();
  }
  function useFound() {
    const f = ed.found;
    if (!f) return;
    const code = ed.code;
    const ops = f.geoms.map((g, i) => (i === 0 && f.replace ? { op: 'set', kind: f.kind, from: f.replace.geom, geom: g } : { op: 'add', kind: f.kind, geom: g }));
    ed.found = null;
    commit(code, ops, `${cap(NAMES[f.kind])} ${f.replace ? 'redrawn' : 'added'} from the map data.`);
  }
  function straighten() {
    const e = selection();
    if (!e) return;
    let geom;
    if (e.kind === 'taxiway') geom = straightLine(e.geom);
    else if (RINGS.has(e.kind)) geom = squareRing(e.geom);
    else return;
    if (FG.fixes.gap(e.kind, geom, e.geom) < 0.5) { note('It is straight already.'); return; }
    commit(e.code, { op: 'set', kind: e.kind, from: e.geom, geom }, `${cap(NAMES[e.kind])} straightened (Ctrl+Z to undo).`);
  }
  function rightAngle() {
    const e = selection();
    if (!e || e.kind !== 'taxiway') return;
    const geom = rightTurn(e.geom);
    if (!geom) { note('This taxiway doesn\u2019t turn: draw it with a bend (or use Straighten).'); return; }
    if (FG.fixes.gap(e.kind, geom, e.geom) < 0.5) { note('It is a 90\u00b0 turn already.'); return; }
    commit(e.code, { op: 'set', kind: e.kind, from: e.geom, geom }, 'Taxiway made a 90\u00b0 turn (Ctrl+Z to undo).');
  }
  function del() {
    const e = selection();
    if (!e) return;
    // Without a stand the game makes the airport up again (and what was deleted would be back).
    if (e.kind === 'stand') {
      const left = e.madeUp ? madeUp(e.code).filter((x) => x.kind === 'stand').length
        : FG.layouts.has(e.code) ? FG.layouts.get(e.code).stands.length : Infinity;
      if (left <= 1) { note('Planes need a stand here: add the real one first (Add here → Stand), then delete this one.', true); return; }
    }
    commit(e.code, { op: 'del', kind: e.kind, geom: e.geom }, `${cap(NAMES[e.kind])} deleted (Ctrl+Z to undo).`);
  }
  function setRunway() {
    const e = selection();
    if (!e || e.kind !== 'runway') return;
    const w = Math.round(Number($('ae-width').value));
    if (!(w >= 5 && w <= 120)) { note('Width: 5 to 120 m.', true); return; }
    const geom = e.geom.slice(0, 4).concat(w, $('ae-paved').checked ? 1 : 0);
    if (JSON.stringify(geom) === JSON.stringify(e.geom)) return;
    commit(e.code, { op: 'set', kind: 'runway', from: e.geom, geom }, `Runway ${runwayName(geom)}: ${w} m, ${geom[5] ? 'paved' : 'grass'}.`);
  }
  // A stand's name and length (of its lead-in line and the pushback; empty: the game finds it).
  function rename() {
    const e = selection();
    if (!e || e.kind !== 'stand') return;
    const name = $('ae-name').value.trim().slice(0, 12);
    const len = Math.round(Number($('ae-len').value));
    if ($('ae-len').value && !(len >= 10 && len <= 150)) { note('Length: 10 to 150 m (or empty: automatic).', true); return; }
    const geom = e.geom.slice(0, 3).concat(name, 1);
    if ($('ae-len').value) geom.push(len);
    if (JSON.stringify(geom) === JSON.stringify(e.geom)) return;
    commit(e.code, { op: 'set', kind: 'stand', from: e.geom, geom }, `Stand ${name || '(no name)'}${len ? `, ${len} m long` : ''}.`);
  }
  // ---------- a row of stands along a line ----------
  const SPACING = [42, 45, 55, 65, 75, 80]; // m between stands by airport size (as game.js)
  function rowStands(r) {
    const len = dist(r.a, r.b);
    const n = Math.max(1, Math.floor(len / r.spacing + 1e-6) + 1);
    const h = bearing(r.a, r.b);
    const nose = Math.round((h + (r.flip ? -90 : 90) + 360) % 360);
    return Array.from({ length: n }, (_, i) => {
      const p = offset(r.a, h, n === 1 ? len / 2 : (i * len) / (n - 1));
      return [r5(p[0]), r5(p[1]), nose, r.prefix ? `${r.prefix}${i + 1}` : '', 1];
    });
  }
  function startRow(a, b) {
    const code = ed.code;
    const lay = layoutOf(code);
    // noses to the nearest building, on whichever side of the line it is
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let near = { d: Infinity };
    for (const r of lay ? [...lay.terminals, ...lay.hangars] : []) { const n = nearest(mid, r, true); if (n.d < near.d) near = n; }
    const h = bearing(a, b);
    const right = near.q ? Math.sin((bearing(mid, near.q) - h) * DEG) > 0 : true;
    ed.row = { a, b, spacing: SPACING[G.airportSize(code)] || 45, flip: !right, prefix: '' };
    ed.at = mid;
    drawLayer();
    showPopup();
  }
  function placeRow() {
    const r = ed.row;
    const ops = rowStands(r).map((geom) => ({ op: 'add', kind: 'stand', geom }));
    ed.row = null;
    commit(ed.code, ops, `${ops.length} stands placed in a row (Ctrl+Z takes them all back).`);
    ed.sel = null;
    closePopup();
    drawLayer();
  }
  function rowInput() {
    const r = ed.row;
    if (!r) return;
    const sp = Number($('ae-spacing').value);
    if (sp >= 20 && sp <= 150) r.spacing = sp;
    r.prefix = $('ae-prefix').value.trim().slice(0, 6);
    drawLayer();
    const n = rowStands(r).length;
    const b = popEl.querySelector('[data-ae="placeRow"]');
    if (b) b.textContent = `Place ${n} stand${n > 1 ? 's' : ''}`;
  }
  function becomes(kind) {
    const e = selection();
    if (!e || e.kind === kind) return;
    commit(e.code, [{ op: 'del', kind: e.kind, geom: e.geom }, { op: 'add', kind, geom: e.geom }], `It is a ${NAMES[kind]} now.`);
  }
  // A new stand at the click: nose to the nearest building, else away from the nearest taxiway or runway.
  function addStand() {
    const code = ed.code;
    const p = ed.at;
    const lay = layoutOf(code);
    let hdg = null;
    let best = 150;
    for (const r of lay ? [...lay.terminals, ...lay.hangars] : []) {
      const n = nearest(p, r, true);
      if (n.d < best) { best = n.d; hdg = bearing(p, n.q); }
    }
    if (hdg == null) {
      let near = { d: Infinity };
      for (const l of lay ? lay.taxiways : []) { const n = nearest(p, l); if (n.d < near.d) near = n; }
      for (const r of G.airportRunways(code)) { const n = nearest(p, [[r[0], r[1]], [r[2], r[3]]]); if (n.d < near.d) near = n; }
      hdg = near.q && near.d > 1 ? bearing(near.q, p) : 0;
    }
    commit(code, { op: 'add', kind: 'stand', geom: [r5(p[0]), r5(p[1]), Math.round(hdg), '', 1] }, 'Stand added, nose to the nearest building. Turn it if that is wrong.');
  }
  async function add(kind) {
    if (!ed.code) { note('No airport within 8 km: add an airport first.', true); return; }
    if (kind === 'stand') { addStand(); return; }
    if (kind === 'row') { ed.sel = null; startDraw('row', null); return; }
    if (kind === 'tower') { commit(ed.code, { op: 'add', kind, geom: [r5(ed.at[0]), r5(ed.at[1])] }, 'Tower added.'); return; }
    ed.sel = null;
    await auto(kind, ed.at, null);
  }
  function addAirport() {
    const code = $('ae-code').value.trim().toUpperCase();
    const name = $('ae-aname').value.trim();
    const size = Number($('ae-size').value);
    if (!/^[A-Z0-9]{3,4}$/.test(code)) { note('Code: 3 or 4 letters or digits (IATA or ICAO).', true); return; }
    if (G.airportByCode[code]) { note(`${code} is taken (${G.airportByCode[code].name}).`, true); return; }
    if (!name) { note('Give it a name.', true); return; }
    const p = ed.at;
    const town = D.towns.filter((t) => Math.abs(t.lat - p[0]) < 0.5 && Math.abs(t.lon - p[1]) < 0.7)
      .map((t) => [t, dist(p, [t.lat, t.lon])]).sort((a, b) => a[1] - b[1])[0];
    const near = airportsNear(p, 300)[0];
    const geom = { code, name, city: town && town[1] < 40000 ? town[0].name : name, country: near ? near.country : '', lat: r5(p[0]), lon: r5(p[1]), size, minor: false };
    ed.form = null;
    commit(code, { op: 'add', kind: 'airport', geom }, `Airport ${code} added. Now give it a runway: click on it and pick Runway.`);
    ed.sel = null;
    closePopup();
  }

  // ---------- drawing ----------
  const HINT = {
    runway: 'click one end of the runway on its centre line, then the other end',
    row: 'click where the row of stands starts, then where it ends (along the terminal or apron edge)',
    taxiway: 'click points along its centre line; click the last point again (or Enter) when done',
    ring: 'click its corners; click the first corner again (or Enter) when done',
    turn: 'click where the nose of the plane points',
  };
  function startDraw(kind, replace) {
    ed.draw = { kind, pts: [], replace: replace || null, mouse: null };
    ed.found = null;
    closePopup();
    map.doubleClickZoom.disable();
    drawLayer();
    banner();
  }
  function stopDraw() {
    ed.draw = null;
    map.doubleClickZoom.enable();
    draftLayer.clearLayers();
    banner();
  }
  // Snap to the points and lines already there (taxiways join only where they meet); Shift: no snapping.
  function snap(p, kind, skip) {
    const code = ed.code;
    if (!code) return p;
    const k = mpp(p[0]);
    const els = elements(code).filter((e) => !skip || e.kind !== skip.kind || e.geom !== skip.geom);
    const verts = [];
    const lines = [];
    for (const e of els) {
      if (kind === 'taxiway' || kind === 'runway') {
        if (e.kind === 'taxiway') { verts.push(...e.geom); lines.push(e.geom); }
        if (e.kind === 'runway') { const s = shape('runway', e.geom); verts.push(...s); lines.push(s); }
      } else if (RINGS.has(kind) && RINGS.has(e.kind)) {
        verts.push(...e.geom);
        lines.push(e.geom.concat([e.geom[0]]));
      }
    }
    let best = null;
    let bd = 12 * k;
    for (const v of verts) { const d = dist(p, v); if (d < bd) { bd = d; best = v; } }
    if (best) return best.slice(0, 2);
    bd = 7 * k;
    for (const l of lines) { const n = nearest(p, l); if (n.d < bd) { bd = n.d; best = n.q; } }
    return best ? [r5(best[0]), r5(best[1])] : [r5(p[0]), r5(p[1])];
  }
  function drawClick(p, ev) {
    const d = ed.draw;
    if (d.kind === 'turn') {
      const e = d.replace;
      const geom = e.geom.slice();
      geom[2] = Math.round(bearing([e.geom[0], e.geom[1]], p));
      geom[4] = 1;
      stopDraw();
      commit(e.code, { op: 'set', kind: 'stand', from: e.geom, geom }, `Stand turned to ${geom[2]}°.`);
      return;
    }
    const ring = RINGS.has(d.kind);
    const q = ev && ev.originalEvent && ev.originalEvent.shiftKey ? [r5(p[0]), r5(p[1])] : snap(p, d.kind, d.replace);
    if (ring && d.pts.length >= 3 && px(q, d.pts[0]) < 10) { finishDraw(); return; }
    if (!ring && d.pts.length >= 2 && px(q, d.pts[d.pts.length - 1]) < 8) { finishDraw(); return; }
    d.pts.push(q);
    if ((d.kind === 'runway' || d.kind === 'row') && d.pts.length === 2) { finishDraw(); return; }
    drawDraft();
    banner();
  }
  function finishDraw() {
    const d = ed.draw;
    if (!d) return;
    const need = RINGS.has(d.kind) ? 3 : 2;
    if (d.pts.length < need) { note(`A ${NAMES[d.kind]} needs at least ${need} points.`, true); return; }
    let geom = d.pts.map((q) => [r5(q[0]), r5(q[1])]);
    if (d.kind === 'row') {
      if (dist(geom[0], geom[1]) < 10) { note('Click where the row starts and, a bit away, where it ends.', true); d.pts = []; drawDraft(); return; }
      stopDraw();
      startRow(geom[0], geom[1]);
      return;
    }
    if (d.kind === 'runway') {
      const old = d.replace && d.replace.geom;
      if (dist(geom[0], geom[1]) < 100) { note('A runway is at least 100 m long: click its two ends.', true); d.pts = []; drawDraft(); return; }
      geom = [...geom[0], ...geom[1], old ? old[4] : defaultWidth(ed.code), old ? old[5] : 1];
    }
    const code = d.replace ? d.replace.code : ed.code;
    const op = d.replace ? { op: 'set', kind: d.kind, from: d.replace.geom, geom } : { op: 'add', kind: d.kind, geom };
    ed.at = d.kind === 'runway' ? [(geom[0] + geom[2]) / 2, (geom[1] + geom[3]) / 2] : geom[geom.length - 1];
    stopDraw();
    commit(code, op, `${cap(NAMES[d.kind])} ${d.replace ? 'redrawn' : 'added'}.`);
  }
  function cancel() {
    if (ed.draw) { stopDraw(); note('Drawing cancelled.'); drawLayer(); return true; }
    if (ed.edit) { stopEdit(); note('Not moved.'); return true; }
    if (ed.found) { ed.found = null; drawLayer(); showPopup(); return true; }
    if (ed.row) { ed.row = null; closePopup(); drawLayer(); return true; }
    if (pop && map.hasLayer(pop)) { closePopup(); ed.sel = null; drawLayer(); return true; }
    return false;
  }

  // ---------- moving points ----------
  function startEdit() {
    const e = selection();
    if (!e) return;
    ed.edit = { e, pts: shape(e.kind, e.geom).map((q) => q.slice(0, 2)) };
    closePopup();
    handles();
    drawDraft();
    banner();
  }
  function editedGeom() {
    const { e, pts } = ed.edit;
    if (e.kind === 'runway') return [r5(pts[0][0]), r5(pts[0][1]), r5(pts[1][0]), r5(pts[1][1]), e.geom[4], e.geom[5]];
    if (e.kind === 'stand') return [r5(pts[0][0]), r5(pts[0][1]), e.geom[2], e.geom[3], 1, ...e.geom.slice(5)];
    if (e.kind === 'tower') return [r5(pts[0][0]), r5(pts[0][1])];
    return pts.map((q) => [r5(q[0]), r5(q[1])]);
  }
  function finishEdit() {
    const e = ed.edit.e;
    const geom = editedGeom();
    stopEdit();
    if (JSON.stringify(geom) === JSON.stringify(e.geom)) { note('Nothing moved.'); return; }
    commit(e.code, { op: 'set', kind: e.kind, from: e.geom, geom }, `${cap(NAMES[e.kind])} moved.`);
  }
  function stopEdit() {
    ed.edit = null;
    handleLayer.clearLayers();
    draftLayer.clearLayers();
    banner();
  }
  function handles() {
    handleLayer.clearLayers();
    const { e, pts } = ed.edit;
    const ring = RINGS.has(e.kind);
    const icon = (cls) => L.divIcon({ className: `ae-handle ${cls}`, iconSize: cls ? [10, 10] : [14, 14] });
    pts.forEach((q, i) => {
      const m = L.marker(q, { pane: 'apedit', draggable: true, icon: icon(''), keyboard: false }).addTo(handleLayer);
      m.on('drag', () => { const ll = m.getLatLng(); pts[i] = [ll.lat, ll.lng]; drawDraft(); });
      m.on('dragend', handles);
      m.on('contextmenu', (ev) => { // right-click: away with this point
        L.DomEvent.preventDefault(ev.originalEvent);
        if (pts.length > (ring ? 3 : 2) && e.kind !== 'runway') { pts.splice(i, 1); handles(); drawDraft(); }
      });
    });
    if (e.kind === 'taxiway' || ring) { // a + between two points adds one there
      const n = ring ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const m = L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { pane: 'apedit', icon: icon('ae-mid'), keyboard: false }).addTo(handleLayer);
        m.on('click', () => { pts.splice(i + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); handles(); drawDraft(); });
      }
    }
  }

  // ---------- drawing on the map ----------
  function drawShape(group, kind, g, style) {
    const o = Object.assign({ pane: 'apedit', interactive: false, renderer }, style);
    if (kind === 'runway') L.polygon(runwayCorners(g), o).addTo(group);
    else if (kind === 'stand') {
      L.circle([g[0], g[1]], Object.assign({}, o, { radius: 6 })).addTo(group);
      L.polyline([[g[0], g[1]], offset([g[0], g[1]], g[2], 22)], o).addTo(group);
    } else if (kind === 'tower') L.circle(g, Object.assign({}, o, { radius: 5 })).addTo(group);
    else if (RINGS.has(kind)) L.polygon(g, o).addTo(group);
    else L.polyline(g, Object.assign({}, o, { weight: (o.weight || 2) + 1 })).addTo(group);
  }
  function drawLayer() {
    if (!layer) return;
    layer.clearLayers();
    const code = ed.code;
    if (code && map.getZoom() >= 13) {
      // every stand of the layout (the game draws only those it uses), from close up
      const lay = layoutOf(code);
      if (map.getZoom() >= 15) {
        for (const s of lay ? lay.stands : []) drawShape(layer, 'stand', s, STYLE.stand);
        for (const e of madeUp(code)) if (e.kind === 'stand') drawShape(layer, 'stand', e.geom, STYLE.stand);
      }
      for (const op of FG.fixes.ops(code)) {
        if (op.kind === 'airport' || op.kind === 'bridges') continue; // (no shape)
        if (op.op !== 'add') drawShape(layer, op.kind, op.op === 'del' ? op.geom : op.from, STYLE.del);
        if (op.op !== 'del') drawShape(layer, op.kind, op.geom, STYLE.add);
      }
    }
    if (ed.sel && !ed.edit) drawShape(layer, ed.sel.kind, ed.sel.geom, STYLE.sel);
    if (ed.found) for (const g of ed.found.geoms) drawShape(layer, ed.found.kind, g, STYLE.found);
    if (ed.row) {
      L.polyline([ed.row.a, ed.row.b], Object.assign({ pane: 'apedit', interactive: false, renderer }, STYLE.draw)).addTo(layer);
      for (const g of rowStands(ed.row)) drawShape(layer, 'stand', g, STYLE.found);
    }
    drawDraft();
  }
  function drawDraft() {
    draftLayer.clearLayers();
    if (ed.edit) {
      drawShape(draftLayer, ed.edit.e.kind, editedGeom(), STYLE.draw);
      return;
    }
    const d = ed.draw;
    if (!d) return;
    if (d.replace) drawShape(draftLayer, d.replace.kind, d.replace.geom, STYLE.del);
    const pts = d.mouse && d.kind !== 'turn' ? d.pts.concat([d.mouse]) : d.pts;
    const o = Object.assign({ pane: 'apedit', interactive: false, renderer }, STYLE.draw);
    if (d.kind === 'turn' && d.mouse) {
      L.polyline([[d.replace.geom[0], d.replace.geom[1]], d.mouse], o).addTo(draftLayer);
    } else if (d.kind === 'runway' && pts.length === 2) {
      drawShape(draftLayer, 'runway', [...pts[0], ...pts[1], defaultWidth(ed.code), 1], STYLE.draw);
    } else if (RINGS.has(d.kind) && pts.length >= 3) L.polygon(pts, o).addTo(draftLayer);
    else if (pts.length >= 2) L.polyline(pts, o).addTo(draftLayer);
    for (const q of d.pts) L.circleMarker(q, Object.assign({}, o, { radius: 4, fillOpacity: 1 })).addTo(draftLayer);
  }

  // ---------- the window at the click ----------
  function closePopup() {
    if (!pop || !map.hasLayer(pop)) return;
    pop.getElement().style.pointerEvents = 'none'; // (it fades out: no clicks on it meanwhile)
    map.closePopup(pop);
  }
  function popupHtml() {
    const code = ed.code;
    const a = code && G.airportByCode[code];
    const e = ed.sel;
    const parts = [];
    parts.push(`<div class="ae-title">${a ? `${esc(code)} · ${esc(a.name)}` : 'No airport within 8 km'}</div>`);
    if (ed.busy) parts.push('<div class="ae-busy">Looking in the map data…</div>');
    if (ed.row) {
      const n = rowStands(ed.row).length;
      parts.push(`<div class="ae-sel"><b>Stand row</b> · ${Math.round(dist(ed.row.a, ed.row.b))} m (cyan: where they go)</div>
        <div class="ae-row ae-form">Every <input id="ae-spacing" type="number" min="20" max="150" value="${ed.row.spacing}"> m · names <input id="ae-prefix" placeholder="e.g. A" maxlength="6" value="${esc(ed.row.prefix)}"></div>
        <div class="ae-row"><button data-ae="flipRow" title="The noses point to the other side of the line">⇅ Turn them round</button></div>
        <div class="ae-row"><button class="primary" data-ae="placeRow">Place ${n} stand${n > 1 ? 's' : ''}</button><button data-ae="cancel">Cancel</button></div>`);
      return parts.join('');
    }
    if (ed.found) {
      parts.push(`<div class="ae-found">Found in the map data: <b>${esc(ed.found.text)}</b> (dashed, cyan)</div>
        <div class="ae-row"><button class="primary" data-ae="use">Use it</button><button data-ae="drawSelf">Draw it myself</button><button data-ae="cancel">Cancel</button></div>`);
      return parts.join('');
    }
    if (e) {
      parts.push(`<div class="ae-sel"><b>${esc(describe(e.kind, e.geom))}</b>${e.code !== code ? ` (${esc(e.code)})` : ''}</div>`);
      if (e.madeUp) parts.push('<div class="ae-also">Made up by the game (too little is mapped here). Change or delete it, and what the game made up here becomes this airport\'s own, to fix piece by piece.</div>');
      const others = ed.hits.filter((h) => h !== e);
      if (others.length) {
        // (an apron lies under everything else on it: always offered)
        const offer = others.filter((h, i) => i < 4 || h.kind === 'apron' || h.kind === 'pad');
        parts.push(`<div class="ae-also">Also here: ${offer.map((h) => `<button class="mini" data-ae="pick" data-i="${ed.hits.indexOf(h)}">${esc(describe(h.kind, h.geom).split(' · ')[0])}</button>`).join(' ')}</div>`);
      }
      const point = e.kind === 'stand' || e.kind === 'tower';
      parts.push(`<div class="ae-row">
        ${point ? '' : '<button data-ae="redraw" title="From the map data if it has it right, else draw it yourself">Redraw</button>'}
        ${e.kind === 'taxiway' || RINGS.has(e.kind) ? `<button data-ae="straighten" title="${e.kind === 'taxiway' ? 'One straight line from its first to its last point' : 'Square corners'}">Straighten</button>` : ''}
        ${e.kind === 'taxiway' ? '<button data-ae="corner" title="Two straight legs at a right angle, with a round corner">90\u00b0 turn</button>' : ''}
        <button data-ae="points">${point ? 'Move' : 'Move points'}</button>
        ${e.kind === 'stand' ? '<button data-ae="turn">Turn</button>' : ''}
        <button class="danger" data-ae="del">Delete</button></div>`);
      if (e.kind === 'runway') {
        parts.push(`<div class="ae-row ae-form">Width <input id="ae-width" type="number" min="5" max="120" value="${e.geom[4]}"> m
          <label><input id="ae-paved" type="checkbox"${e.geom[5] ? ' checked' : ''}> paved</label><button data-ae="setRunway">Apply</button></div>`);
      }
      if (e.kind === 'stand' && !G.apronOf(e.code).stands.some((st) => st.lat === e.geom[0] && st.lon === e.geom[1])) {
        parts.push(`<div class="ae-warn">The game does not use this stand: it uses the ${G.apronOf(e.code).stands.length} nearest the terminals. Move, turn or rename it and it is used too.</div>`);
      }
      if (e.kind === 'stand') {
        const used = G.apronOf(e.code).stands.find((st) => st.lat === e.geom[0] && st.lon === e.geom[1]);
        parts.push(`<div class="ae-row ae-form">Name <input id="ae-name" value="${esc(e.geom[3] || '')}" maxlength="12">
          Length <input id="ae-len" type="number" min="10" max="150" value="${e.geom[5] || ''}" placeholder="${used ? Math.round(used.push) : 'auto'}" title="Of its lead-in line, and how far planes are pushed back; empty: the game finds it"> m
          <button data-ae="rename">Apply</button></div>`);
      }
      if (e.kind === 'apron' || e.kind === 'pad') {
        parts.push(`<div class="ae-row">It is ${['apron', 'pad'].map((k) => `<button class="mini${k === e.kind ? ' on' : ''}" data-ae="becomes" data-kind="${k}" title="${k === 'pad' ? 'Open concrete: planes go straight across it to their stands' : 'Planes taxi along the taxiways on it'}">${k === 'pad' ? 'a pad (free taxiing)' : 'an apron'}</button>`).join(' ')}</div>`);
      }
      if (BUILDINGS.includes(e.kind)) {
        parts.push(`<div class="ae-row">It is a ${BUILDINGS.map((k) => `<button class="mini${k === e.kind ? ' on' : ''}" data-ae="becomes" data-kind="${k}">${k}</button>`).join(' ')}</div>`);
      }
    } else if (code) {
      parts.push('<div class="ae-sel muted">Nothing of the airport here.</div>');
    }
    if (ed.form === 'airport') {
      parts.push(`<div class="ae-sub">New airport here</div>
        <div class="ae-row ae-form"><input id="ae-code" placeholder="Code" maxlength="4" style="width:64px"><input id="ae-aname" placeholder="Name"></div>
        <div class="ae-row ae-form"><select id="ae-size">${['airstrip', 'small', 'regional', 'big', 'major', 'hub'].map((s, i) => `<option value="${i}"${i === 1 ? ' selected' : ''}>Size ${i} – ${s}</option>`).join('')}</select>
          <button class="primary" data-ae="addAirport">Add airport</button><button data-ae="cancelForm">Cancel</button></div>`);
      return parts.join('');
    }
    const near = airportsNear(ed.at, 4).length > 0;
    parts.push(`<div class="ae-sub">Add here</div><div class="ae-row">${code ? ADD.map((k) => `<button class="mini" data-ae="add" data-kind="${k}">${cap(NAMES[k])}</button>`).join(' ') : ''}
      ${near ? '' : '<button class="mini" data-ae="airportForm">Airport</button>'}</div>`);
    return parts.join('');
  }
  function showPopup() {
    if (!ed.at) return;
    if (!pop) {
      popEl = document.createElement('div');
      popEl.className = 'ae-pop';
      // (the window is redrawn while its button is clicked: the map would take that click for its own)
      popEl.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(ev); });
      popEl.addEventListener('input', rowInput);
      popEl.addEventListener('keydown', (ev) => {
        ev.stopPropagation(); // typing here must not pause the game or move the speed slider
        if (ev.key === 'Enter') {
          if (ev.target.id === 'ae-width') setRunway();
          if (ev.target.id === 'ae-name' || ev.target.id === 'ae-len') rename();
          if (ev.target.id === 'ae-spacing' || ev.target.id === 'ae-prefix') rowInput();
          if (ev.target.id === 'ae-aname' || ev.target.id === 'ae-code') addAirport();
        }
        if (ev.key === 'Escape') { ev.target.blur(); cancel(); }
      });
      pop = L.popup({ className: 'ae-popup', maxWidth: 340, minWidth: 250, closeOnClick: false, autoPanPadding: [40, 40] });
      pop.on('remove', () => { if (!ed.draw && !ed.edit) { ed.found = null; } });
    }
    popEl.innerHTML = popupHtml();
    pop.setLatLng(ed.at).setContent(popEl);
    if (!map.hasLayer(pop)) pop.openOn(map);
    else pop.update();
    pop.getElement().style.pointerEvents = '';
  }

  // ---------- the panel ----------
  function banner() {
    const el = $('ae-banner');
    if (!el) return;
    const d = ed.draw;
    let html = '';
    if (d) {
      const name = d.kind === 'turn' ? 'Turning the stand' : `${d.replace ? 'Redrawing' : 'Drawing'} the ${NAMES[d.kind]}`;
      const hint = d.kind === 'turn' ? HINT.turn : RINGS.has(d.kind) ? HINT.ring : HINT[d.kind];
      html = `<b>${name}:</b> ${hint}. <span class="muted">Shift: no snapping.</span>
        ${d.kind !== 'turn' && d.kind !== 'runway' ? '<button class="primary" data-ae="finish">Done</button>' : ''}
        ${d.pts.length ? '<button data-ae="back">Remove last point</button>' : ''}<button data-ae="cancel">Cancel</button>`;
    } else if (ed.edit) {
      const k = ed.edit.e.kind;
      html = `<b>Moving the ${NAMES[k]}:</b> drag the points${k === 'taxiway' || RINGS.has(k) ? ', click a small dot between two to add one, right-click a point to remove it' : ''}.
        <button class="primary" data-ae="done">Done</button><button data-ae="cancel">Cancel</button>`;
    }
    el.innerHTML = html;
    el.hidden = !html;
  }
  function renderPanel() {
    const el = $('apedit');
    if (!el || !ed.on) return;
    const code = ed.code;
    const a = code && G.airportByCode[code];
    const ops = code ? FG.fixes.ops(code) : [];
    const unsaved = FG.fixes.unsaved();
    const missed = code ? FG.fixes.missed(code) : [];
    const localOnly = FG.fixes.localOnly();
    let state = '';
    if (a) {
      const lay = FG.layouts.get(code);
      if (FG.layouts.pending(code)) state = 'reading the map data…';
      else if (lay && lay.source === 'fixes') state = 'layout: drawn with fixes';
      else if (lay) state = `layout: ${(D.layouts || []).includes(code) ? 'layout file + map data' : 'map data'}${lay.fixed ? ' + fixes' : ''}`;
      else state = 'layout: made up by the game (too little mapped). Click its apron, buildings, taxiways or stands to move or delete them, or draw the real apron and stands.';
    }
    const fixed = FG.fixes.codes().filter((c) => c !== code);
    const user = FG.fixes.github.user;
    const token = $('ae-token') ? $('ae-token').value : ''; // (kept while the panel is drawn again)
    const where = {
      server: '<div class="muted small">Save writes js/data/fixes.js here (dev server). Commit it to give everyone the fix.</div>',
      github: `<div class="muted small">Save commits to ${esc(FG.fixes.github.repo)} as <b>${esc(user ? user.login : '')}</b>. <button class="mini" data-ae="signOut">Sign out</button></div>`,
      browser: ed.signin
        ? `<div class="ae-signin small">Contributors only: a GitHub token of yours (<a href="https://github.com/settings/tokens/new?scopes=public_repo&description=Flightgame%20airport%20editor" target="_blank" rel="noopener">make one</a>: classic, the <i>public_repo</i> box ticked). It stays on this device.
          <div class="dev-row"><input id="ae-token" type="password" placeholder="ghp_…" autocomplete="off"><button class="primary" data-ae="signIn"${ed.busy ? ' disabled' : ''}>Sign in</button><button data-ae="signinClose">Cancel</button></div></div>`
        : '<div class="muted small">Save keeps the fixes in this browser. <button class="mini" data-ae="signinOpen">Sign in to GitHub</button> (contributors) to save them into the game for everyone.</div>',
    }[ed.target] || '';
    el.innerHTML = `
      <div class="dev-head"><b>✏️ Airport editor</b><button class="mini" data-ae="close" title="Close (F3)">✕</button></div>
      <div class="muted small">Click the satellite picture where an airport is wrong or something is missing.</div>
      ${a ? `<section><h4>${esc(code)} – ${esc(a.name)}</h4>
        <div class="muted small">${esc(state)}</div>
        ${ops.length ? `<ul class="ae-ops">${ops.map((op, i) => `<li${missed.includes(op) ? ' class="missed" title="Finds nothing to change any more: the map data changed"' : ''}>
          <span>${{ add: '＋', del: '−', set: '✎' }[op.op]} ${esc(describe(op.kind, op.geom))}${missed.includes(op) ? ' ⚠' : ''}</span>
          <button class="mini" data-ae="goOp" data-i="${i}" title="Show it">⌖</button><button class="mini" data-ae="removeOp" data-i="${i}" title="Remove this fix">✕</button></li>`).join('')}</ul>`
          : '<div class="muted small">No fixes here yet.</div>'}
        ${missed.length ? `<div class="ae-warn">${missed.length} fix${missed.length > 1 ? 'es find' : ' finds'} nothing to change any more (⚠): check ${missed.length > 1 ? 'them' : 'it'}.</div>` : ''}
      </section>` : '<section><div class="muted small">No airport selected yet.</div></section>'}
      <section>
        <div class="dev-row">
          <button data-ae="undo"${ed.undo.length ? '' : ' disabled'}>↶ Undo</button>
          <button data-ae="discard"${unsaved.length ? '' : ' disabled'}>Discard changes</button>
          <button class="primary" data-ae="save"${(unsaved.length || localOnly.length) && !ed.busy ? '' : ' disabled'}>💾 Save${unsaved.length ? ` (${unsaved.join(', ')})` : ''}</button>
        </div>
        ${where}
        ${localOnly.length ? `<div class="ae-warn">Only in this browser: ${localOnly.map(esc).join(', ')}. <button class="mini" data-ae="download">⬇ fixes.js</button></div>` : ''}
        ${fixed.length ? `<div class="muted small">Fixed airports: ${fixed.map((c) => `<button class="mini" data-ae="goto" data-code="${esc(c)}">${esc(c)}</button>`).join(' ')}</div>` : ''}
      </section>
      <div class="muted small">Esc cancels · Enter finishes · Backspace removes the last point · Ctrl+Z undoes · Del deletes</div>
      <div id="ae-msg" class="${ed.bad ? 'bad' : ''}">${esc(ed.msg)}</div>`;
    if (token && $('ae-token')) $('ae-token').value = token;
  }
  function note(msg, bad) {
    ed.msg = msg;
    ed.bad = !!bad;
    const el = $('ae-msg');
    if (el) { el.textContent = msg; el.className = bad ? 'bad' : ''; }
  }
  function goTo(code, op) {
    const a = G.airportByCode[code];
    if (!a) return;
    ed.code = code;
    if (op && op.kind !== 'airport' && op.kind !== 'bridges') {
      const pts = shape(op.kind, op.geom);
      map.fitBounds(L.latLngBounds(pts).pad(0.6), { maxZoom: 17 });
      ed.sel = op.op === 'del' ? null : { code, kind: op.kind, geom: op.geom };
    } else map.setView([a.lat, a.lon], 14);
    drawLayer();
    renderPanel();
  }

  function onClick(e) {
    const b = e.target.closest('[data-ae]');
    if (!b || b.disabled) return;
    const d = b.dataset;
    switch (d.ae) {
      case 'close': toggle(false); break;
      case 'pick': ed.sel = ed.hits[Number(d.i)]; ed.code = ed.sel.code; drawLayer(); showPopup(); renderPanel(); break;
      case 'redraw': redraw(); break;
      case 'straighten': straighten(); break;
      case 'corner': rightAngle(); break;
      case 'points': startEdit(); break;
      case 'turn': if (selection()) startDraw('turn', ed.sel); break;
      case 'del': del(); break;
      case 'setRunway': setRunway(); break;
      case 'rename': rename(); break;
      case 'flipRow': if (ed.row) { ed.row.flip = !ed.row.flip; drawLayer(); } break;
      case 'placeRow': if (ed.row) placeRow(); break;
      case 'becomes': becomes(d.kind); break;
      case 'add': add(d.kind); break;
      case 'airportForm': ed.form = 'airport'; showPopup(); break;
      case 'cancelForm': ed.form = null; showPopup(); break;
      case 'addAirport': addAirport(); break;
      case 'use': useFound(); break;
      case 'drawSelf': { const f = ed.found; ed.found = null; startDraw(f.kind, f.replace); break; }
      case 'cancel': cancel(); break;
      case 'finish': finishDraw(); break;
      case 'back': if (ed.draw) { ed.draw.pts.pop(); drawDraft(); banner(); } break;
      case 'done': finishEdit(); break;
      case 'undo': undo(); break;
      case 'discard':
        for (const c of FG.fixes.unsaved()) FG.fixes.discard(c);
        ed.undo = [];
        ed.sel = null;
        closePopup();
        refresh();
        note('Changes discarded.');
        break;
      case 'save': save(); break;
      case 'download': download(); break;
      case 'signinOpen': ed.signin = true; renderPanel(); if ($('ae-token')) $('ae-token').focus(); break;
      case 'signinClose': ed.signin = false; renderPanel(); break;
      case 'signIn': signIn(); break;
      case 'signOut': signOut(); break;
      case 'goto': goTo(d.code); break;
      case 'goOp': goTo(ed.code, FG.fixes.ops(ed.code)[Number(d.i)]); break;
      case 'removeOp': removeOp(ed.code, Number(d.i)); break;
      default:
    }
  }

  // ---------- the map ----------
  function onMapClick(e) {
    const p = [e.latlng.lat, e.latlng.lng];
    if (ed.draw) { drawClick(p, e); return; }
    if (ed.edit) return;
    ed.at = p;
    ed.form = null;
    ed.found = null;
    ed.row = null;
    ed.hits = hitsAt(p);
    ed.sel = ed.hits[0] || null;
    const o = ed.sel ? null : owner(p);
    ed.code = ed.sel ? ed.sel.code : o ? o.code : null;
    drawLayer();
    showPopup();
    renderPanel();
  }
  function onMove(e) {
    if (!ed.draw) return;
    const p = [e.latlng.lat, e.latlng.lng];
    ed.draw.mouse = ed.draw.kind === 'turn' || (e.originalEvent && e.originalEvent.shiftKey) ? p : snap(p, ed.draw.kind, ed.draw.replace);
    drawDraft();
  }
  function onKey(e) {
    if (e.key === 'F3') { toggle(); e.preventDefault(); e.stopPropagation(); return; }
    if (!ed.on || (e.target instanceof Element && e.target.matches('input, select, textarea'))) return;
    let used = true;
    if (e.key === 'Escape') { if (!cancel()) toggle(false); } else if (e.key === 'Enter') {
      if (ed.draw) finishDraw(); else if (ed.edit) finishEdit(); else if (ed.found) useFound(); else used = false;
    } else if (e.key === 'Backspace' && ed.draw) { ed.draw.pts.pop(); drawDraft(); banner(); } else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) undo();
    else if (e.key === 'Delete' && ed.sel && !ed.draw && !ed.edit) del();
    else if (e.key === 'v' || e.key === 'V') note('The editor works on the 2D map: close it (F3) for the 3D view.');
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }

  function toggle(on = !ed.on) {
    if (on === ed.on) return;
    if (!FG.ui || !FG.ui.map) return;
    map = FG.ui.map;
    if (!layer) {
      map.createPane('apedit').style.zIndex = 620; // above the planes, below tooltips and popups
      renderer = L.svg({ pane: 'apedit', padding: 0.3 });
      layer = L.layerGroup().addTo(map);
      draftLayer = L.layerGroup().addTo(map);
      handleLayer = L.layerGroup().addTo(map);
    }
    ed.on = on;
    $('apedit').hidden = !on;
    $('ae-banner').hidden = true;
    map.getContainer().classList.toggle('ap-edit', on);
    if (on) {
      if (FG.view3d && FG.view3d.on) FG.view3d.setOn(false);
      map.on('click', onMapClick);
      map.on('mousemove', onMove);
      map.on('zoomend', drawLayer);
      map.eachLayer((l) => { if (l instanceof L.TileLayer) l.options.maxZoom = MAX_ZOOM; });
      map.setMaxZoom(MAX_ZOOM);
      if (!ed.code && FG.ui.selectedAirport) ed.code = FG.ui.selectedAirport;
      note(map.getZoom() < 14 ? 'Zoom in on an airport (taxiways and stands show from zoom 14).' : '');
      drawLayer();
      renderPanel();
      FG.fixes.target().then((t) => { ed.target = t; renderPanel(); });
    } else {
      if (ed.draw) stopDraw();
      if (ed.edit) stopEdit();
      ed.found = null;
      ed.row = null;
      ed.sel = null;
      closePopup();
      layer.clearLayers();
      map.off('click', onMapClick);
      map.off('mousemove', onMove);
      map.off('zoomend', drawLayer);
      const max = FG.config.map.maxZoom;
      map.eachLayer((l) => { if (l instanceof L.TileLayer) l.options.maxZoom = max; });
      if (map.getZoom() > max) map.setZoom(max);
      map.setMaxZoom(max);
    }
  }

  function init() {
    const el = $('apedit');
    el.addEventListener('click', onClick);
    // (also from the menu: some browsers keep the function keys for themselves)
    if ($('apedit-toggle')) $('apedit-toggle').addEventListener('click', () => toggle());
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && e.target.id === 'ae-token') signIn();
    });
    $('ae-banner').addEventListener('click', onClick);
    window.addEventListener('keydown', onKey, true); // before the game's own keys (Esc opens its menu)
    window.addEventListener('beforeunload', (e) => {
      if (FG.fixes.unsaved().length) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  FG.airportEdit = {
    get on() { return ed.on; },
    toggle,
    unsaved: () => FG.fixes.unsaved(),
    // for tests: what the editor would find or make
    straightLine, rightTurn, squareRing, lookup, hitsAt: (lat, lon) => hitsAt([lat, lon]), madeUp,
    click(lat, lon) { onMapClick({ latlng: L.latLng(lat, lon) }); },
    state: ed,
  };
  window.addEventListener('DOMContentLoaded', init);
})();
