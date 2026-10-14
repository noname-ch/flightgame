// Real layouts for every airport, read off the vector tiles of the 3D map (OpenFreeMap, OpenMapTiles schema,
// data © OpenStreetMap contributors) when an airport without a layout file is first needed (js/layouts.js).
// From the tiles: aprons, taxiways and gates (layer aeroway) and the buildings with their heights. Made of
// them, in the same form as js/data/layouts/<CODE>.json:
// - terminals: buildings at a gate or with shops, restaurants or passport control inside, or else the
//   biggest building beside an apron; other big buildings beside an apron are hangars, small ones `others`
//   (the game draws every building at its aprons, and the 3D map leaves out its own copies of them);
// - stands: in front of the mapped gates, and where there are fewer than the airport could use, in rows on
//   the real aprons (clear of the taxi lanes across them), nose to the terminal, nearest to it first;
// - taxiways as mapped, plus `links` the game may taxi along but doesn't draw: the runway centre lines (small
//   fields have no parallel taxiway: planes backtrack on the runway) and, where no taxiway reaches the
//   apron, a way from the apron to the nearest runway.
// An airport with a layout file (js/data/layouts/<CODE>.json) is read too: the file's aprons, taxiways,
// terminals, hangars and stands stay, and the tiles add the buildings, heights and stands it lacks.
// Where too little is mapped for a layout, the taxiways and buildings found are returned as `obstacles`, for
// the game to keep the apron it lays out itself clear of them.
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const G = FG.game;
const Z = 14;
const SPACING = [42, 45, 55, 65, 75, 80]; // m between stands by airport size (as game.js GATE_SPACING)
const M = 111320;
const DEG = Math.PI / 180;
const r5 = (n) => Math.round(n * 1e5) / 1e5;
// Places (poi layer) found inside terminals: shops, food and drink, banks, passport control. The tiles don't
// say which building is a terminal, but one beside an apron with some of these inside is one.
const TERMINAL_POI = new Set(['shop', 'clothing_store', 'grocery', 'bakery', 'alcohol_shop', 'pharmacy', 'restaurant',
  'fast_food', 'cafe', 'bar', 'beer', 'ice_cream', 'bank', 'atm', 'border_control']);

let template = null; // tile URL of the current OpenFreeMap planet build
// A fetch that gives up after `ms`: one tile that never answers would hold up the lookups of every airport
// after it (two run at a time), and those count as pending, so the maps and the editor would leave them out.
function fetchT(url, ms = 20000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(timer));
}
// (asked again after a failure: not offline for the rest of the session after one bad answer)
const tileUrl = () => (template = template || fetchT('https://tiles.openfreemap.org/planet').then((r) => r.json()).then((j) => j.tiles[0])
  .catch((e) => { template = null; throw e; }));

const lon2tx = (lon) => ((lon + 180) / 360) * 2 ** Z;
const lat2ty = (lat) => ((1 - Math.log(Math.tan(lat * DEG) + 1 / Math.cos(lat * DEG)) / Math.PI) / 2) * 2 ** Z;
const tx2lon = (x) => (x / 2 ** Z) * 360 - 180;
const ty2lat = (y) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** Z))) / DEG;

// A polygon ring cut to the tile's square (Sutherland-Hodgman), so that pieces of one polygon from
// neighbouring tiles meet edge to edge instead of overlapping in the tiles' buffers.
function clipRing(ring, ext) {
  let out = ring;
  for (const [axis, lim, keepBelow] of [[0, 0, false], [0, ext, true], [1, 0, false], [1, ext, true]]) {
    const src = out;
    out = [];
    const inside = (p) => (keepBelow ? p[axis] <= lim : p[axis] >= lim);
    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      const b = src[(i + 1) % src.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) {
        const t = (lim - a[axis]) / (b[axis] - a[axis]);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    if (!out.length) break;
  }
  return out;
}

const emptyTile = () => ({ aprons: [], taxiways: [], gates: [], buildings: [], pois: [], runways: [] });

// Everything of interest in one tile: { aprons, taxiways, gates, buildings, pois, runways } in [lat, lon]
// (runways for the airport editor: { line } or { ring }, and `ref`, e.g. '14/32').
function readTile(buf, x, y) {
  const tile = new VectorTile(new Pbf(buf));
  const out = emptyTile();
  const conv = (ext) => (p) => [r5(ty2lat(y + p[1] / ext)), r5(tx2lon(x + p[0] / ext))];
  // outer rings only (clockwise in tile coordinates, y down: positive shoelace area)
  const outers = (f) => f.loadGeometry().map((r) => r.map((p) => [p.x, p.y])).filter((r) => {
    let s = 0;
    for (let i = 0; i < r.length; i++) { const a = r[i]; const b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return s > 0;
  });
  const aero = tile.layers.aeroway;
  if (aero) {
    const ll = conv(aero.extent);
    for (let i = 0; i < aero.length; i++) {
      const f = aero.feature(i);
      const cls = f.properties.class;
      if (cls === 'apron' && f.type === 3) {
        for (const r of outers(f)) { const c = clipRing(r, aero.extent); if (c.length >= 3) out.aprons.push(c.map(ll)); }
      } else if (cls === 'taxiway' && f.type === 2) {
        for (const l of f.loadGeometry()) out.taxiways.push(l.map((p) => ll([p.x, p.y])));
      } else if (cls === 'runway' && f.type === 2) {
        for (const l of f.loadGeometry()) out.runways.push({ line: l.map((p) => ll([p.x, p.y])), ref: f.properties.ref || '' });
      } else if (cls === 'runway' && f.type === 3) {
        for (const r of outers(f)) { const c = clipRing(r, aero.extent); if (c.length >= 3) out.runways.push({ ring: c.map(ll), ref: f.properties.ref || '' }); }
      } else if (cls === 'gate' && f.type === 1) {
        const p = f.loadGeometry()[0][0];
        if (p.x >= 0 && p.y >= 0 && p.x <= aero.extent && p.y <= aero.extent) out.gates.push([ll([p.x, p.y]), f.properties.ref || '']);
      }
    }
  }
  const bld = tile.layers.building;
  if (bld) {
    const ll = conv(bld.extent);
    for (let i = 0; i < bld.length; i++) {
      const f = bld.feature(i);
      if (f.type !== 3) continue;
      for (const r of outers(f)) {
        const c = clipRing(r, bld.extent);
        if (c.length >= 3) out.buildings.push({ ring: c.map(ll), h: f.properties.render_height || 0 });
      }
    }
  }
  const poi = tile.layers.poi;
  if (poi) {
    const ll = conv(poi.extent);
    for (let i = 0; i < poi.length; i++) {
      const f = poi.feature(i);
      if (f.type !== 1 || !TERMINAL_POI.has(f.properties.class)) continue;
      const p = f.loadGeometry()[0][0];
      if (p.x >= 0 && p.y >= 0 && p.x <= poi.extent && p.y <= poi.extent) out.pois.push(ll([p.x, p.y]));
    }
  }
  return out;
}

// ---------- geometry in metres round a point ----------
function frame(lat0, lon0) {
  const kx = M * Math.cos(lat0 * DEG);
  return {
    xy: (p) => [(p[1] - lon0) * kx, (p[0] - lat0) * M],
    ll: (q) => [r5(lat0 + q[1] / M), r5(lon0 + q[0] / kx)],
  };
}
const area = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i]; const b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
const centre = (r) => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
function inRing(p, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i];
    const b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function segDist(p, a, b) {
  const bx = b[0] - a[0], by = b[1] - a[1], px = p[0] - a[0], py = p[1] - a[1];
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by || 1)));
  return { d: Math.hypot(px - t * bx, py - t * by), q: [a[0] + t * bx, a[1] + t * by] };
}
// (just the distance, without making objects: it runs millions of times at big airports)
function segD(p, a, b) {
  const bx = b[0] - a[0], by = b[1] - a[1], px = p[0] - a[0], py = p[1] - a[1];
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by || 1)));
  return Math.hypot(px - t * bx, py - t * by);
}
function ringDist(p, r) {
  let d = Infinity;
  for (let i = 0; i < r.length; i++) d = Math.min(d, segD(p, r[i], r[(i + 1) % r.length]));
  return d;
}
// [minX, minY, maxX, maxY], and whether two boxes lie within d of each other
function box(r) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of r) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); }
  return b;
}
const boxesNear = (a, b, d) => a[0] <= b[2] + d && b[0] <= a[2] + d && a[1] <= b[3] + d && b[1] <= a[3] + d;
const linesDist = (p, lines) => {
  let best = { d: Infinity, q: null };
  for (const l of lines) for (let i = 1; i < l.length; i++) { const s = segDist(p, l[i - 1], l[i]); if (s.d < best.d) best = s; }
  return best;
};
const bearingXY = (a, b) => ((Math.atan2(b[0] - a[0], b[1] - a[1]) / DEG) + 360) % 360; // 0 = north, clockwise
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const move = (p, hdg, m) => [p[0] + m * Math.sin(hdg * DEG), p[1] + m * Math.cos(hdg * DEG)];

// `base`: the airport's layout file, if it has one (see the top).
function build(code, parts, base) {
  const a = G.airportByCode[code];
  const size = Math.max(0, Math.min(5, G.airportSize(code)));
  const F = frame(a.lat, a.lon);
  const rws = G.airportRunways(code).map((r) => [F.xy([r[0], r[1]]), F.xy([r[2], r[3]])]);
  // Only what belongs to this airport: aprons and taxiways near its runways (or its point, without runways).
  const nearAirport = (p) => (rws.length ? rws.some(([u, w]) => segDist(p, u, w).d < 1600) : Math.hypot(p[0], p[1]) < 1500);
  const aprons = base ? base.aprons.map((r) => r.map(F.xy))
    : parts.flatMap((t) => t.aprons).map((r) => r.map(F.xy)).filter((r) => area(r) > 400 && nearAirport(centre(r)));
  // taxiways: cut at the tile edges, snapped together where they meet again (~3 m)
  const snap = (q) => [Math.round(q[0] / 3) * 3, Math.round(q[1] / 3) * 3];
  const taxiways = base ? base.taxiways.map((l) => l.map(F.xy)) : parts.flatMap((t) => t.taxiways).map((l) => l.map(F.xy).map(snap))
    .map((l) => l.filter((p, i) => !i || p[0] !== l[i - 1][0] || p[1] !== l[i - 1][1]))
    .filter((l) => l.length > 1 && l.some((p) => nearAirport(p)));
  const gates = parts.flatMap((t) => t.gates).map(([p, ref]) => [F.xy(p), ref]).filter(([p]) => nearAirport(p));
  const pois = parts.flatMap((t) => t.pois).map(F.xy).filter(nearAirport);
  const apronBoxes = aprons.map(box);
  const near = (r, d) => {
    const b = box(r);
    return aprons.some((ap, i) => boxesNear(b, apronBoxes[i], d) && r.some((p) => inRing(p, ap) || ringDist(p, ap) < d));
  };
  let buildings = parts.flatMap((t) => t.buildings).map((b) => ({ ring: b.ring.map(F.xy), h: b.h }))
    .filter((b) => area(b.ring) > 60 && near(b.ring, 45));

  // terminals, hangars and the other buildings at the aprons
  const terminals = [];
  const hangars = [];
  const others = [];
  if (base) {
    // The file's own come first (in its order: js/data/terminals.js counts its terminals) and take the
    // heights of the buildings in the tiles that are the same, unless the file gives a greater one; the tiles
    // add the ones it lacks.
    const own = (rings, heights) => rings.map((r, i) => ({ ring: r.map(F.xy), ll: r, h: (heights && heights[i]) || 0 }));
    terminals.push(...own(base.terminals, base.heights && base.heights.terminals));
    hangars.push(...own(base.hangars, base.heights && base.heights.hangars));
    const have = [...terminals, ...hangars];
    const same = (x, y) => inRing(centre(x), y) || inRing(centre(y), x) || x.some((p) => inRing(p, y));
    buildings = buildings.filter((b) => {
      const it = have.filter((k) => same(b.ring, k.ring));
      for (const k of it) k.h = Math.max(k.h, b.h);
      return !it.length;
    });
  }
  const inside = (r) => pois.reduce((n, p) => n + (inRing(p, r) ? 1 : 0), 0);
  for (const b of buildings) {
    if (gates.some(([g]) => ringDist(g, b.ring) < 45) || (area(b.ring) >= 1500 && inside(b.ring) >= 2)) terminals.push(b);
  }
  const rest = buildings.filter((b) => !terminals.includes(b));
  // None found: the biggest building beside an apron.
  if (!terminals.length && aprons.length && rest.length) {
    const cand = rest.filter((b) => area(b.ring) >= 150);
    if (cand.length) terminals.push(cand.reduce((x, y) => (area(y.ring) > area(x.ring) ? y : x)));
  }
  for (const b of rest) if (!terminals.includes(b)) (area(b.ring) >= 400 ? hangars : others).push(b);

  // stands in front of the gates: some 30 m out towards the nearest taxiway, nose to the gate (and, from a
  // layout file, the stands mapped there, which the game turns the right way round itself)
  const sp = SPACING[size];
  const stands = base ? base.stands.map((s) => ({ p: F.xy(s), hdg: s[2], name: s[3] || '', mapped: true })) : [];
  const free = (p, d = sp * 0.85) => stands.every((s) => Math.hypot(s.p[0] - p[0], s.p[1] - p[1]) >= d);
  for (const [g, ref] of gates) {
    const t = linesDist(g, taxiways);
    if (!t.q || t.d < 25 || t.d > 160) continue;
    const hdg = bearingXY(t.q, g);
    const p = move(g, hdg + 180, Math.min(32, t.d - 12));
    if (free(p, 25)) stands.push({ p, hdg, name: ref });
  }

  // More stands on the aprons, where a plane fits and no taxi lane runs, as real ones are laid out: rows
  // along the terminal's apron side, nose to it, the first row at the building and the middle first; on
  // aprons without a terminal, rows along the apron's longest side, nose to the nearest building (or away
  // from the runway).
  // (the first row along every terminal before the second: all of them get stands)
  const target = 2 * [2, 3, 6, 12, 20, 32][size] + 4;
  const termRings = terminals.map((b) => b.ring);
  const mainTerm = termRings.length ? termRings.reduce((x, y) => (area(y) > area(x) ? y : x)) : null;
  const focus = mainTerm ? centre(mainTerm) : aprons.length ? centre(aprons.reduce((x, y) => (area(y) > area(x) ? y : x))) : [0, 0];
  const onApron = (p) => aprons.some((r) => inRing(p, r));
  const fits = (p, rad) => onApron(p) && [0, 45, 90, 135, 180, 225, 270, 315].every((h) => onApron(move(p, h, rad)));
  let step = Math.min(sp, 60);    // mid-size airliners
  let rad = step * 0.32;          // room a plane needs round its stand point on the apron
  const clear = (p) => linesDist(p, taxiways).d > rad * 0.9;
  const otherBuildings = hangars.map((b) => b.ring);
  const noseTo = (p) => {
    const bld = [...termRings, ...otherBuildings].map((r) => [r, ringDist(p, r)]).filter(([, d]) => d < 220).sort((x, y) => x[1] - y[1])[0];
    if (bld) {
      let foot = null;
      let best = Infinity;
      for (let i = 0; i < bld[0].length; i++) { const q = segDist(p, bld[0][i], bld[0][(i + 1) % bld[0].length]); if (q.d < best) { best = q.d; foot = q.q; } }
      return bearingXY(p, foot);
    }
    if (rws.length) return bearingXY(rws.map(([u, w]) => segDist(p, u, w)).sort((x, y) => x.d - y.d)[0].q, p);
    return bearingXY(focus, p);
  };
  // Where no airliner fits (the narrow aprons of small airfields), stands for smaller planes: a real apron
  // with a stand is a layout of its own, else the game would make one up beside it.
  for (const scale of [1, 0.7, 0.5]) {
    if (scale < 1 && (stands.length || !aprons.length)) break;
    step = Math.min(sp, 60) * scale;
    rad = step * 0.32;
    const cands = [];
    if (stands.length < target) {
      // along each terminal's sides that face an apron
      for (const t of termRings) {
        for (let i = 0; i < t.length; i++) {
          const u = t[i];
          const w = t[(i + 1) % t.length];
          const len = Math.hypot(w[0] - u[0], w[1] - u[1]);
          if (len < 12) continue;
          const along = bearingXY(u, w);
          const mid = [(u[0] + w[0]) / 2, (u[1] + w[1]) / 2];
          const c = centre(t);
          const right = (bearingXY(c, mid) - along + 360) % 360 < 180; // the side lies right of the way round
          const out = (along + (right ? 90 : -90) + 360) % 360;         // away from the building
          // the first row where a plane fits in front of this side (there may be a strip between them)
          let d0 = rad + 8;
          while (d0 < rad + 80 && !fits(move(mid, out, d0), rad)) d0 += 4;
          if (d0 >= rad + 80) continue; // this side doesn't face an apron
          for (let k = 0; k < 4; k++) {
            const row = move(mid, out, d0 + k * step * 1.3);
            for (let j = 0; ; j++) {
              const x = (j % 2 ? 1 : -1) * Math.ceil(j / 2) * step;
              if (Math.abs(x) > len / 2 + step * 2) break;
              const p = move(row, along, x);
              if (fits(p, rad) && clear(p)) cands.push({ p, hdg: (out + 180) % 360, rank: k * 1e4 + Math.abs(x) });
            }
          }
        }
      }
      // beside the taxi lanes that cross the aprons, nose away from the lane
      const off = step * 0.8;
      for (const l of taxiways) {
        for (let i = 1; i < l.length; i++) {
          const u = l[i - 1];
          const w = l[i];
          const len = Math.hypot(w[0] - u[0], w[1] - u[1]);
          const hdg = bearingXY(u, w);
          for (let t = step / 2; t < len; t += step) {
            const q = move(u, hdg, t);
            for (const sd of [-90, 90]) {
              const p = move(q, hdg + sd, off);
              if (fits(p, rad) && linesDist(p, taxiways).d > off * 0.85) {
                cands.push({ p, hdg: (hdg + sd + 360) % 360, rank: 5e5 + Math.hypot(p[0] - focus[0], p[1] - focus[1]) });
              }
            }
          }
        }
      }
      // rows on every apron
      for (const ap of aprons) {
        let axis = 0;
        let longest = 0;
        for (let i = 0; i < ap.length; i++) {
          const u = ap[i];
          const w = ap[(i + 1) % ap.length];
          const l = Math.hypot(w[0] - u[0], w[1] - u[1]);
          if (l > longest) { longest = l; axis = bearingXY(u, w); }
        }
        // the apron measured along and across that side; rows centred in it
        const o = ap[0];
        const U = (p) => (p[0] - o[0]) * Math.sin(axis * DEG) + (p[1] - o[1]) * Math.cos(axis * DEG);
        const V = (p) => (p[0] - o[0]) * Math.sin((axis + 90) * DEG) + (p[1] - o[1]) * Math.cos((axis + 90) * DEG);
        const u0 = Math.min(...ap.map(U)), u1 = Math.max(...ap.map(U));
        const v0 = Math.min(...ap.map(V)), v1 = Math.max(...ap.map(V));
        const at = (u, v) => move(move(o, axis, u), axis + 90, v);
        const rowsN = Math.floor((v1 - v0 - 2 * rad) / (step * 1.3)) + 1;
        const colsN = Math.floor((u1 - u0 - 2 * rad) / step) + 1;
        const vs = (v0 + v1) / 2 - ((rowsN - 1) * step * 1.3) / 2;
        const us = (u0 + u1) / 2 - ((colsN - 1) * step) / 2;
        for (let i = 0; i < rowsN; i++) {
          for (let j = 0; j < colsN; j++) {
            const p = at(us + j * step, vs + i * step * 1.3);
            if (fits(p, rad) && clear(p)) cands.push({ p, hdg: null, rank: 1e6 + Math.hypot(p[0] - focus[0], p[1] - focus[1]) });
          }
        }
      }
      cands.sort((x, y) => x.rank - y.rank);
      for (const c of cands) {
        if (stands.length >= target) break;
        if (!free(c.p, step * 0.9)) continue;
        stands.push({ p: c.p, hdg: c.hdg != null ? c.hdg : noseTo(c.p), name: '' });
      }
    }
  }
  // Still none: one stand on the spot of the biggest apron furthest from its edges.
  if (!stands.length && aprons.length) {
    const ap = aprons.reduce((x, y) => (area(y) > area(x) ? y : x));
    const xs = ap.map((p) => p[0]), ys = ap.map((p) => p[1]);
    let best = null;
    let bestD = 0;
    for (let i = 1; i < 20; i++) {
      for (let j = 1; j < 20; j++) {
        const p = [Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * i) / 20, Math.min(...ys) + ((Math.max(...ys) - Math.min(...ys)) * j) / 20];
        const d = inRing(p, ap) ? ringDist(p, ap) : 0;
        if (d > bestD) { bestD = d; best = p; }
      }
    }
    if (best) stands.push({ p: best, hdg: noseTo(best), name: '' });
  }
  stands.sort((x, y) => Math.hypot(x.p[0] - focus[0], x.p[1] - focus[1]) - Math.hypot(y.p[0] - focus[0], y.p[1] - focus[1]));

  // ways the game may taxi along without drawing them: the runways, and from the apron to a runway where no
  // taxiway reaches the apron
  const links = rws.map(([u, w]) => {
    const n = Math.max(1, Math.round(Math.hypot(w[0] - u[0], w[1] - u[1]) / 100));
    return Array.from({ length: n + 1 }, (_, i) => [u[0] + ((w[0] - u[0]) * i) / n, u[1] + ((w[1] - u[1]) * i) / n]);
  });
  const lines = taxiways.slice();
  if (aprons.length && rws.length && !taxiways.some((l) => l.some((p) => onApron(p) || aprons.some((r) => ringDist(p, r) < 15)))) {
    let best = { d: Infinity };
    for (const ap of aprons) for (const p of ap) for (const [u, w] of rws) { const s = segDist(p, u, w); if (s.d < best.d) best = { d: s.d, from: p, to: s.q }; }
    if (best.from) lines.push([best.from, best.to]);
  }

  const ringLL = (r) => r.map(F.ll);
  const rings = (list) => list.map((b) => b.ll || ringLL(b.ring));
  return {
    ...base,
    source: base ? 'file+tiles' : 'tiles',
    // jet bridges only where gates are mapped at a bigger airport (a file: where its stands are at a terminal)
    bridges: base ? base.bridges : gates.length > 0 && size >= 2,
    aprons: base ? base.aprons : aprons.map(ringLL),
    terminals: rings(terminals),
    hangars: rings(hangars),
    others: rings(others),
    heights: { terminals: terminals.map((b) => Math.round(b.h)), hangars: hangars.map((b) => Math.round(b.h)), others: others.map((b) => Math.round(b.h)) },
    towers: base ? base.towers : [],
    taxiways: base ? base.taxiways : lines.map(ringLL),
    links: base ? base.links : links.map(ringLL),
    // [lat, lon, heading, name, 1 if the heading is known to be right]
    stands: stands.map((s) => { const q = F.ll(s.p); return [q[0], q[1], Math.round(s.hdg), s.name, s.mapped ? 0 : 1]; }),
  };
}

// What was found where no layout can be made: the taxiways (as segments) and the buildings (every third point
// of each is enough to tell whether one lies in the way), and how far round the airport they are known.
function obstacles(code, parts, reach) {
  const lines = [];
  for (const l of parts.flatMap((t) => t.taxiways)) for (let i = 1; i < l.length; i++) lines.push([l[i - 1], l[i]]);
  const rings = parts.flatMap((t) => t.buildings).map((b) => b.ring.filter((p, i) => i % 3 === 0));
  return { lines, rings, reach: Math.round(reach) };
}
// One tile (kept for the session: the airport editor asks for the same ones again and again).
const tiles = new Map();
function tileAt(x, y) {
  const k = `${x}/${y}`;
  if (!tiles.has(k)) {
    tiles.set(k, tileUrl().then((url) => fetchT(url.replace('{z}', Z).replace('{x}', x).replace('{y}', y))).then(async (r) => {
      if (r.status === 204 || r.status === 404) return emptyTile();
      if (!r.ok) throw new Error(`tile ${x}/${y}: ${r.status}`);
      return readTile(new Uint8Array(await r.arrayBuffer()), x, y);
    }).catch((e) => { tiles.delete(k); throw e; }));
  }
  return tiles.get(k);
}

// What is mapped within `m` metres of a point, as pieces cut at the tile edges ([lat, lon]):
// { runways: [{ line | ring, ref }], taxiways: [line], aprons: [ring], buildings: [{ ring, h }] }.
async function around(lat, lon, m) {
  const mLat = m / M;
  const mLon = m / (M * Math.cos(lat * DEG));
  const x0 = Math.floor(lon2tx(lon - mLon)), x1 = Math.floor(lon2tx(lon + mLon));
  const y0 = Math.floor(lat2ty(lat + mLat)), y1 = Math.floor(lat2ty(lat - mLat));
  const list = [];
  for (let x = x0; x <= x1 && list.length < 16; x++) for (let y = y0; y <= y1 && list.length < 16; y++) list.push(tileAt(x, y));
  const parts = await Promise.all(list);
  return {
    runways: parts.flatMap((t) => t.runways),
    taxiways: parts.flatMap((t) => t.taxiways),
    aprons: parts.flatMap((t) => t.aprons),
    buildings: parts.flatMap((t) => t.buildings),
  };
}

async function read(code, base) {
  const a = G.airportByCode[code];
  if (!a || a.built) return null;
  // The tiles round the airport's runways (or its point), with a margin for the aprons and buildings.
  let s = a.lat, n = a.lat, w = a.lon, e = a.lon;
  for (const r of G.airportRunways(code)) {
    s = Math.min(s, r[0], r[2]); n = Math.max(n, r[0], r[2]);
    w = Math.min(w, r[1], r[3]); e = Math.max(e, r[1], r[3]);
  }
  const mLat = 1300 / M;
  const mLon = 1300 / (M * Math.cos(a.lat * DEG));
  const x0 = Math.floor(lon2tx(w - mLon)), x1 = Math.floor(lon2tx(e + mLon));
  const y0 = Math.floor(lat2ty(n + mLat)), y1 = Math.floor(lat2ty(s - mLat));
  const cx = lon2tx(a.lon), cy = lat2ty(a.lat);
  const tiles = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
  tiles.sort((p, q) => Math.hypot(p[0] + 0.5 - cx, p[1] + 0.5 - cy) - Math.hypot(q[0] + 0.5 - cx, q[1] + 0.5 - cy));
  const url = await tileUrl();
  const used = tiles.slice(0, 16);
  const parts = await Promise.all(used.map(async ([x, y]) => {
    const r = await fetchT(url.replace('{z}', Z).replace('{x}', x).replace('{y}', y));
    if (r.status === 204 || r.status === 404) return emptyTile();
    if (!r.ok) throw new Error(`tile ${x}/${y}: ${r.status}`);
    return readTile(new Uint8Array(await r.arrayBuffer()), x, y);
  }));
  const lay = build(code, parts, base);
  if (base || (lay.aprons.length && lay.stands.length)) return lay;
  // Too little mapped: what is in the way, known as far as the edge of the tiles read nearest the airport.
  const tx = used.map((t) => t[0]);
  const ty = used.map((t) => t[1]);
  const kx = M * Math.cos(a.lat * DEG);
  const reach = Math.min((a.lon - tx2lon(Math.min(...tx))) * kx, (tx2lon(Math.max(...tx) + 1) - a.lon) * kx,
    (ty2lat(Math.min(...ty)) - a.lat) * M, (a.lat - ty2lat(Math.max(...ty) + 1)) * M);
  return { ...lay, obstacles: obstacles(code, parts, Math.max(0, reach)) };
}

FG.layouts.setReader(read);
FG.osmAirports = { read, around }; // for the developer tools (js/airportedit.js) and tests
