// Building looks for the 3D view: every terminal, hangar and other building is split into parts that
// js/view3d.js extrudes (fill-extrusion) - walls, a roof slab, window bands per floor, glass fronts, entrance
// doors, hangar doors and open car park decks - built in metres, so they keep their size at every zoom (MapLibre's
// extrusion patterns change size with the zoom). The roof takes its colour from the satellite photo (Esri World
// Imagery, as the maps show it) where the airport's layout is real, and the walls are picked to go with it; a
// style per building (from its position) keeps neighbours from all looking the same.
(function () {
  const M = 111320;
  const DEG = Math.PI / 180;
  const KEY = 'flightgame.roofs2.';

  // ---------- colours ----------
  const hex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const PAL = {
    concrete: ['#dcd9d2', '#cfcac0', '#e8e6e1', '#c3c7cb', '#d8cfbf', '#b9bcbf'],
    metal: ['#a3acb6', '#bcc3ca', '#86919d', '#cfd2d5', '#6c7d8f', '#c4c0b6', '#b5a58c', '#8796a8'],
    brick: ['#9c6b53', '#b07e60', '#8a5d4a', '#c09a7a'],
    glass: ['#2e4a63', '#33586d', '#3a4c5c', '#2b5958', '#4b4a3f', '#27405b', '#456273'],
    frame: ['#e9ebee', '#c8ccd2', '#5b636d', '#2f3540'],
  };
  const DEFAULT_ROOF = { terminal: [196, 200, 204], hangar: [170, 176, 182], other: [160, 156, 150], carpark: [120, 124, 128] };

  // A number 0..1 that stays the same for a building (from where it is).
  function seed(ring, k = 0) {
    let h = 2166136261 ^ k;
    for (const [la, lo] of ring.slice(0, 4)) {
      h = Math.imul(h ^ Math.round(la * 1e5), 16777619);
      h = Math.imul(h ^ Math.round(lo * 1e5), 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
  }
  const pick = (list, r) => list[Math.floor(r * list.length) % list.length];

  // ---------- geometry in metres round the building ----------
  function local(ring) {
    const lat0 = ring[0][0], lon0 = ring[0][1];
    const k = Math.cos(lat0 * DEG);
    let pts = ring.map(([la, lo]) => [(lo - lon0) * M * k, (la - lat0) * M]);
    const last = pts[pts.length - 1];
    if (pts.length > 3 && Math.hypot(last[0] - pts[0][0], last[1] - pts[0][1]) < 0.01) pts = pts.slice(0, -1);
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area < 0) pts.reverse(); // counter-clockwise: the outside is on the right of each edge
    return { pts, area: Math.abs(area) / 2, back: ([x, y]) => [lat0 + y / M, lon0 + x / (M * k)] };
  }
  const outward = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
  // The outline moved out by d metres (mitred corners, kept short at sharp ones).
  function grow(pts, d) {
    const n = pts.length;
    return pts.map((p, i) => {
      const n0 = outward(pts[(i - 1 + n) % n], p), n1 = outward(p, pts[(i + 1) % n]);
      let mx = n0[0] + n1[0], my = n0[1] + n1[1];
      const l = Math.hypot(mx, my);
      if (l < 1e-6) return [p[0] + n1[0] * d, p[1] + n1[1] * d];
      mx /= l; my /= l;
      const c = Math.max(0.35, mx * n1[0] + my * n1[1]);
      return [p[0] + (mx * d) / c, p[1] + (my * d) / c];
    });
  }
  // A slab standing on edge a-b, from u0 to u1 metres along it, d metres deep out of the wall.
  function onEdge(a, b, u0, u1, d) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const o = outward(a, b);
    const p = (u, w) => [a[0] + t[0] * u + o[0] * w, a[1] + t[1] * u + o[1] * w];
    return [p(u0, -0.05), p(u1, -0.05), p(u1, d), p(u0, d)];
  }
  // Edges by length, with which way they face (unit normal).
  function edges(pts) {
    return pts.map((a, i) => { const b = pts[(i + 1) % pts.length]; return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]), n: outward(a, b) }; });
  }

  // ---------- styles ----------
  // terminals: 'curtain' (all glass, light floor slabs), 'ribbon' (concrete with dark window bands),
  // 'ribbon-glass' (glass ground floor, window bands above); hangars: metal with a big door towards the
  // apron; others: small offices and sheds with window bands and a door; car parks: open decks.
  function styleOf(b, r) {
    if (b.kind === 'hangar') return 'hangar';
    if (b.kind === 'carpark') return 'carpark';
    if (b.kind === 'terminal' || b.kind === 'hall') return r < 0.34 ? 'curtain' : r < 0.67 ? 'ribbon-glass' : 'ribbon';
    if (b.kind === 'other') return r < 0.5 ? 'office' : r < 0.8 ? 'shed' : 'brick';
    return null; // towers, roofs, plant, canopies, glass, roads: as they are
  }

  // The parts of one building: [{ ring (lat/lon), base, h, color }]. b = { ring, base, h, kind }; roof = [r, g, b]
  // from the photo or null; toward = [lat, lon] of the airport (where the apron is).
  function parts(b, roof, toward) {
    const r = seed(b.ring);
    const style = styleOf(b, r);
    const base = b.base || 0;
    if (!style || base > 0.5 || b.h - base < 2.5 || b.ring.length < 3) return null;
    const L = local(b.ring);
    if (L.area < 25) return null;
    const out = [];
    const add = (pts, b0, h, c) => { if (h - b0 > 0.05) out.push({ ring: pts.map(L.back), base: b0, h, color: typeof c === 'string' ? c : hex(c) }); };
    const h = b.h;
    const roofC = roof || DEFAULT_ROOF[b.kind] || DEFAULT_ROOF.other;
    // Walls go with the roof seen from above: a light roof, light walls; a dark one, darker; a reddish one, brick.
    const reddish = roofC[0] > roofC[2] + 28 && roofC[0] > roofC[1] + 8;
    let wall = rgb(pick(style === 'hangar' || style === 'shed' ? PAL.metal : style === 'brick' || (reddish && style === 'office') ? PAL.brick : PAL.concrete, seed(b.ring, 1)));
    wall = mix(wall, roofC, 0.22);
    if (lum(roofC) < 90) wall = mix(wall, [70, 76, 84], 0.3);
    const glass = rgb(pick(PAL.glass, seed(b.ring, 2)));
    const frame = rgb(pick(PAL.frame, seed(b.ring, 3)));
    const E = edges(L.pts);
    // Which way the apron is: edges facing it get hangar doors, the others the terminal's entrances.
    const c = L.pts.reduce((s, p) => [s[0] + p[0] / L.pts.length, s[1] + p[1] / L.pts.length], [0, 0]);
    const tw = toward ? [(toward[1] - b.ring[0][1]) * M * Math.cos(b.ring[0][0] * DEG) - c[0], (toward[0] - b.ring[0][0]) * M - c[1]] : [0, 1];
    const tl = Math.hypot(tw[0], tw[1]) || 1;
    const facing = (e) => (e.n[0] * tw[0] + e.n[1] * tw[1]) / tl;
    const longest = (list) => list.reduce((x, e) => (!x || e.len > x.len ? e : x), null);

    const top = Math.max(2, h - 0.6);
    add(L.pts, 0, top, style === 'curtain' ? glass : wall);
    add(grow(L.pts, 0.25), top, h, style === 'curtain' ? frame : mix(wall, [255, 255, 255], 0.15)); // parapet
    add(L.pts, top, h - 0.05, roofC); // roof as seen from above
    const ring = (d) => grow(L.pts, d);
    if (style === 'curtain') {
      // floor slabs across the glass every 4.5 m, and a light frame at the foot
      add(ring(0.18), 0, 0.6, frame);
      for (let z = 4.5; z < top - 1; z += 4.5) add(ring(0.18), z - 0.35, z, frame);
    } else if (style === 'ribbon' || style === 'ribbon-glass' || style === 'office' || style === 'brick') {
      const floor = style === 'ribbon' || style === 'ribbon-glass' ? 4.5 : 3.4;
      let z0 = 0;
      if (style === 'ribbon-glass') { add(ring(0.12), 0.4, Math.min(top - 0.5, 4.2), glass); z0 = 4.5; }
      const win = floor * (style === 'ribbon' ? 0.42 : 0.36);
      for (let z = z0 + floor * 0.35; z + win < top - 0.4; z += floor) add(ring(0.12), z, z + win, glass);
    } else if (style === 'shed') {
      add(ring(0.12), Math.min(top - 1.2, 2.6), Math.min(top - 0.4, 3.4), glass); // a row of high windows
    } else if (style === 'carpark') {
      for (let z = 1; z < top - 0.6; z += 3) add(ring(0.12), z, Math.min(z + 1.6, top - 0.3), [44, 48, 54]);
    }
    // Mullions: thin frames up the windows every few metres, on the long sides (at most ~150 a building).
    if (style === 'curtain' || style === 'ribbon' || style === 'ribbon-glass' || style === 'office') {
      const long = E.filter((e) => e.len >= 8);
      const total = long.reduce((n, e) => n + e.len, 0);
      const step = Math.max(style === 'curtain' ? 2.5 : 3, total / 150);
      const z0 = style === 'ribbon-glass' ? 0.4 : style === 'curtain' ? 0.6 : 0.9;
      const fc = style === 'curtain' ? frame : mix(wall, [0, 0, 0], 0.15);
      for (const e of long) {
        for (let u = step / 2 + ((e.len % step) / 2); u < e.len - 0.5; u += step) add(onEdge(e.a, e.b, u - 0.12, u + 0.12, 0.22), z0, top - 0.4, fc);
      }
    }
    if (style === 'hangar') {
      // the big door on the longest side facing the apron, framed, with a band above it
      const e = longest(E.filter((x) => facing(x) > 0.2)) || longest(E);
      if (e.len > 12) {
        const doorH = Math.min(top - 1.5, Math.max(6, h * 0.78));
        add(onEdge(e.a, e.b, e.len * 0.08, e.len * 0.92, 0.5), 0, doorH + 0.6, frame);
        add(onEdge(e.a, e.b, e.len * 0.1, e.len * 0.9, 0.7), 0, doorH, mix(wall, [255, 255, 255], 0.25));
        for (let u = e.len * 0.1 + 6; u < e.len * 0.9 - 2; u += 6) add(onEdge(e.a, e.b, u - 0.15, u + 0.15, 0.8), 0, doorH, mix(wall, [0, 0, 0], 0.25));
      }
      add(ring(0.15), top - 1.2, top - 0.4, mix(wall, [0, 0, 0], 0.2)); // fascia
    } else if (style !== 'carpark') {
      // entrances on the side away from the apron (landside): glass doors with a canopy over the middle ones
      const land = longest(E.filter((x) => facing(x) < -0.2)) || longest(E);
      if (land && land.len > 6) {
        const big = style === 'curtain' || style === 'ribbon' || style === 'ribbon-glass';
        const n = big ? Math.max(1, Math.min(10, Math.floor(land.len / 30))) : 1;
        const w = big ? 4 : 1.6;
        const dh = Math.min(top - 0.6, big ? 3.2 : 2.3);
        for (let i = 0; i < n; i++) {
          const u = land.len * (n === 1 ? 0.5 : 0.2 + (0.6 * i) / (n - 1));
          add(onEdge(land.a, land.b, u - w / 2 - 0.3, u + w / 2 + 0.3, 0.35), 0, dh + 0.3, frame);
          add(onEdge(land.a, land.b, u - w / 2, u + w / 2, 0.45), 0, dh, [36, 52, 66]);
        }
        if (big && land.len > 40) add(onEdge(land.a, land.b, land.len * 0.2 - 5, land.len * 0.8 + 5, 7), dh + 0.6, dh + 1.1, frame);
      }
    }
    return out;
  }

  // ---------- roof colours from the satellite photo ----------
  const roofs = {};    // code -> { sig, list: [[r, g, b] | null] }
  const busy = {};
  let version = 0;
  let onChange = () => {};
  const sigOf = (list) => `${list.length}:${list.slice(0, 3).map((b) => b.ring[0].map((v) => v.toFixed(5)).join(',')).join(';')}`;

  // Points spread over the inside of a ring (lat/lon), for reading its colour.
  function inside(ring, n = 6) {
    const L = local(ring);
    const xs = L.pts.map((p) => p[0]), ys = L.pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const ins = (x, y) => {
      let c = false;
      for (let i = 0, j = L.pts.length - 1; i < L.pts.length; j = i++) {
        const a = L.pts[i], b = L.pts[j];
        if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
      }
      return c;
    };
    const out = [];
    for (let i = 1; i <= n; i++) for (let j = 1; j <= n; j++) {
      const x = x0 + ((x1 - x0) * i) / (n + 1), y = y0 + ((y1 - y0) * j) / (n + 1);
      if (ins(x, y)) out.push(L.back([x, y]));
    }
    return out;
  }

  async function read(code, list) {
    const sig = sigOf(list);
    let kept;
    try { kept = FG.idb && await FG.idb.get(KEY + code); } catch (e) { kept = null; }
    if (kept && kept.sig === sig) return kept;
    const pts = list.flatMap((b) => b.ring);
    let shot = null;
    for (const z of [17, 16, 15]) { // the finest that isn't too many tiles
      try { shot = await FG.taxiFit.photo(pts, 20, z); break; } catch (e) { if (!/too long/.test(e.message)) return null; }
    }
    if (!shot) return null;
    const res = list.map((b) => {
      const cs = inside(b.ring).map((p) => shot.at(p[0], p[1])).filter(Boolean);
      if (cs.length < 3) return null;
      const med = [0, 1, 2].map((k) => cs.map((c) => c[k]).sort((x, y) => x - y)[cs.length >> 1]);
      // (a bit lighter and less saturated than the photo, which is darker than roofs look from the side)
      const g = lum(med);
      // green or brown-green is mostly grass or trees beside the roof (the outlines are a few metres off): greyer
      const grassy = med[1] > med[0] + 6 && med[1] > med[2] + 6;
      return mix(mix(med, [g, g, g], grassy ? 0.8 : 0.3), [235, 235, 235], 0.12).map(Math.round);
    });
    const out = { sig, list: res };
    if (FG.idb) FG.idb.set(KEY + code, out);
    return out;
  }

  // Roof colours of an airport's real buildings, or null while they are read (onChange is called then).
  function roofsOf(code, list) {
    if (!list.length || !FG.taxiFit || !FG.taxiFit.photo) return null;
    const sig = sigOf(list);
    const r = roofs[code];
    if (r && r.sig === sig) return r.list;
    if (!busy[code]) {
      busy[code] = true;
      read(code, list).then((res) => {
        busy[code] = false;
        roofs[code] = res || { sig, list: [] }; // (no photo: default roofs, not asked again this session)
        version++;
        onChange(code);
      }, () => { busy[code] = false; roofs[code] = { sig, list: [] }; });
    }
    return null;
  }

  FG.facades = {
    parts, roofsOf, styleOf,
    get version() { return version; },
    set onChange(fn) { onChange = fn; },
  };
})();
