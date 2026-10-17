// Level ground at the airports in the 3D view (FG.flat). The terrain tiles (Mapterhorn) are partly older than
// the airports and partly surface models: Istanbul lies on the open-pit mines that were there before it was
// built (30-170 m under its runways), elsewhere buildings and trees stand in the heights. Runways and
// taxiways went up and down over every bump, and the planes with them.
// The 3D view loads its terrain through the protocol fgdem:// (FG.flat.protocol): the tiles round an airport
// come back with the airport levelled. Its area (runways with their strips, taxiways, aprons, buildings, and
// what lies between them) becomes one tilted plane fitted to the ground there, so the airport keeps its real
// slope, and the ground round it slopes back to the hills over FEATHER metres. A few airports really are steep
// or humped (REAL): there the ground is only smoothed, not made flat.
// FG.flat.heightsAt(pts, z) gives the same heights as the drawn terrain (the planes' heights come from it).
(function () {
  const URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
  const SIZE = 512;
  const MZ = 12;            // zoom the airports' surfaces are worked out at (the finest the 3D map draws)
  const MIN_BUILD = 11;     // tiles from this zoom on make the airports in them levelled
  const MIN_APPLY = 10;     // and from this one on show those that are levelled already
  const CLOSE = 400;        // m: gaps between the airport's parts up to twice this are levelled with them
  const FEATHER = 300;      // m: from the levelled area back to the real ground
  const STRIP = 75;         // m: runway strip beside the runway (each side), and 2× that past its ends
  const TAXI = 30;          // m: beside a taxiway's centre line
  // Airports whose runway really slopes or humps (altiports, Lukla): the ground there is only smoothed.
  const REAL = new Set(['CVF', 'LUA', 'MVV', 'AHZ', 'MFX']);
  const MAX_TILT = [0.006, 0.015]; // slope of the levelled ground at most, with a runway of 1800 m or more / without
  const LAYOUT_WAIT = 8000; // ms waited for an airport's real layout before it is levelled without one

  // ---------- raw tiles ----------
  const raw = new Map(); // "z/x/y" -> promise of Float32Array heights (m)
  function rawTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let p = raw.get(key);
    if (p) { raw.delete(key); raw.set(key, p); return p; } // (to the end: most recently used)
    p = fetch(URL.replace('{z}', z).replace('{x}', x).replace('{y}', y))
      .then((r) => { if (r.status === 404) return null; if (!r.ok) throw new Error(`terrain tile ${r.status}`); return r.blob(); })
      .then((blob) => blob && createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
      .then((img) => {
        if (!img) return Object.assign(new Float32Array(SIZE * SIZE), { missing: true }); // (no tile there: sea level)
        const c = document.createElement('canvas');
        c.width = c.height = SIZE;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
        const h = new Float32Array(SIZE * SIZE);
        for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        return h;
      });
    p.catch(() => raw.delete(key));
    raw.set(key, p);
    while (raw.size > 48) raw.delete(raw.keys().next().value);
    return p;
  }

  // Web Mercator: world pixel coordinates at zoom z (tiles of SIZE px), and back.
  const DEG = Math.PI / 180;
  function toPx(lat, lon, z) {
    const n = SIZE * 2 ** z;
    const s = Math.sin(Math.max(-85, Math.min(85, lat)) * DEG);
    return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  }
  const mPerPx = (lat, z) => (40075016.7 * Math.cos(lat * DEG)) / (SIZE * 2 ** z);

  // ---------- an airport's area ----------
  function geometry(code) {
    const G = FG.game;
    const rws = G.airportRunways(code);
    const ap = G.apronOf(code);
    const polys = [...(ap.aprons || [ap.apron]), ...(ap.pads || []), ...ap.buildings.map((b) => b.ring)].filter((r) => r && r.length > 2);
    const lines = [];
    for (const r of rws) lines.push({ pts: [[r[0], r[1]], [r[2], r[3]]], hw: Math.max(9, (r[4] || 30) / 2) + STRIP, ext: 2 * STRIP, runway: true });
    for (const tw of G.taxiwaysOf(code) || []) if (tw.length > 1) lines.push({ pts: tw, hw: Math.max(TAXI, (tw.w || 0) / 2 + 10), ext: 0 });
    return { rws, polys, lines };
  }
  // What the levelled ground depends on: when it changes, the airport is levelled again.
  function signature(code) {
    const G = FG.game;
    const inf = (G.state && G.state.infra && G.state.infra[code]) || {};
    return `${JSON.stringify(G.airportRunways(code))}|${FG.layouts && FG.layouts.has(code) ? 1 : 0}|${FG.fixes ? FG.fixes.rev(code) : 0}|${inf.terminal || 0}`;
  }

  // Rough extent (world px at MZ) of an airport's levelled ground with its slopes, before it is worked out.
  const reach = new Map(); // code -> [x0, y0, x1, y1]
  function extentOf(code) {
    if (reach.has(code)) return reach.get(code);
    const a = FG.game.airportByCode[code];
    const pts = [[a.lat, a.lon]];
    for (const r of FG.game.airportRunways(code)) pts.push([r[0], r[1]], [r[2], r[3]]);
    const xy = pts.map(([lat, lon]) => toPx(lat, lon, MZ));
    const pad = (2500 + FEATHER) / mPerPx(a.lat, MZ); // (aprons and terminals a way off the runways)
    const box = [Math.min(...xy.map((p) => p[0])) - pad, Math.min(...xy.map((p) => p[1])) - pad, Math.max(...xy.map((p) => p[0])) + pad, Math.max(...xy.map((p) => p[1])) + pad];
    reach.set(code, box);
    return box;
  }
  // Airports with runways whose levelled ground may reach into the box (world px at MZ).
  let grid = null;
  function airportsIn(box) {
    const G = FG.game;
    const all = Object.values(G.airportByCode);
    if (!grid || grid.n !== all.length) { // (again when the player builds an airport)
      grid = { n: all.length, cells: new Map() };
      for (const a of all) {
        const [x, y] = toPx(a.lat, a.lon, MZ);
        const k = `${Math.floor(x / SIZE)}|${Math.floor(y / SIZE)}`;
        if (!grid.cells.has(k)) grid.cells.set(k, []);
        grid.cells.get(k).push(a);
      }
    }
    const out = [];
    for (let tx = Math.floor(box[0] / SIZE) - 1; tx <= Math.floor(box[2] / SIZE) + 1; tx++) {
      for (let ty = Math.floor(box[1] / SIZE) - 1; ty <= Math.floor(box[3] / SIZE) + 1; ty++) {
        for (const a of grid.cells.get(`${tx}|${ty}`) || []) {
          if (!G.airportRunways(a.code).length) continue;
          const e = extentOf(a.code);
          if (e[0] < box[2] && e[2] > box[0] && e[1] < box[3] && e[3] > box[1]) out.push(a.code);
        }
      }
    }
    return out;
  }

  // ---------- working out the levelled ground ----------
  // 8-neighbour chamfer distance (px) to the cells where `inside` is 1.
  function distance(inside, w, h) {
    const D = new Float32Array(w * h);
    const S = Math.SQRT2;
    for (let i = 0; i < D.length; i++) D[i] = inside[i] ? 0 : 1e9;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let d = D[i];
        if (!d) continue;
        if (x > 0) d = Math.min(d, D[i - 1] + 1);
        if (y > 0) {
          d = Math.min(d, D[i - w] + 1);
          if (x > 0) d = Math.min(d, D[i - w - 1] + S);
          if (x < w - 1) d = Math.min(d, D[i - w + 1] + S);
        }
        D[i] = d;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        let d = D[i];
        if (!d) continue;
        if (x < w - 1) d = Math.min(d, D[i + 1] + 1);
        if (y < h - 1) {
          d = Math.min(d, D[i + w] + 1);
          if (x < w - 1) d = Math.min(d, D[i + w + 1] + S);
          if (x > 0) d = Math.min(d, D[i + w - 1] + S);
        }
        D[i] = d;
      }
    }
    return D;
  }
  // Box blur (radius r px) along rows and columns, three times: about a Gaussian.
  function blur(src, w, h, r) {
    let a = Float32Array.from(src);
    let b = new Float32Array(a.length);
    for (let pass = 0; pass < 6; pass++) {
      const rows = pass % 2 === 0;
      const n = rows ? w : h, m = rows ? h : w;
      for (let j = 0; j < m; j++) {
        const at = (k) => (rows ? j * w + k : k * w + j);
        let sum = 0, cnt = 0;
        for (let k = 0; k <= Math.min(r, n - 1); k++) { sum += a[at(k)]; cnt++; }
        for (let k = 0; k < n; k++) {
          b[at(k)] = sum / cnt;
          if (k + r + 1 < n) { sum += a[at(k + r + 1)]; cnt++; }
          if (k - r >= 0) { sum -= a[at(k - r)]; cnt--; }
        }
      }
      [a, b] = [b, a];
    }
    return a;
  }

  async function build(code) {
    const a = FG.game.airportByCode[code];
    const { polys, lines } = geometry(code);
    const mpp = mPerPx(a.lat, MZ);
    // the raster: the airport's parts, plus room for the closing and the slopes round it
    const px = (p) => toPx(p[0], p[1], MZ);
    const shapes = [...polys.map((r) => r.map(px)), ...lines.map((l) => l.pts.map(px))];
    const allPts = shapes.flat();
    const pad = Math.ceil((CLOSE + FEATHER + STRIP * 2) / mpp) + 4;
    const gx0 = Math.floor(Math.min(...allPts.map((p) => p[0]))) - pad;
    const gy0 = Math.floor(Math.min(...allPts.map((p) => p[1]))) - pad;
    const w = Math.ceil(Math.max(...allPts.map((p) => p[0]))) + pad - gx0;
    const h = Math.ceil(Math.max(...allPts.map((p) => p[1]))) + pad - gy0;
    // its heights from the tiles
    const R = new Float32Array(w * h);
    const tiles = [];
    for (let ty = Math.floor(gy0 / SIZE); ty <= Math.floor((gy0 + h - 1) / SIZE); ty++) {
      for (let tx = Math.floor(gx0 / SIZE); tx <= Math.floor((gx0 + w - 1) / SIZE); tx++) tiles.push([tx, ty]);
    }
    const n = 2 ** MZ;
    const got = await Promise.all(tiles.map(([tx, ty]) => rawTile(MZ, ((tx % n) + n) % n, ty).catch(() => null)));
    tiles.forEach(([tx, ty], k) => {
      const t = got[k];
      for (let y = Math.max(0, ty * SIZE - gy0); y < Math.min(h, (ty + 1) * SIZE - gy0); y++) {
        for (let x = Math.max(0, tx * SIZE - gx0); x < Math.min(w, (tx + 1) * SIZE - gx0); x++) {
          R[y * w + x] = t ? t[(y + gy0 - ty * SIZE) * SIZE + (x + gx0 - tx * SIZE)] : 0;
        }
      }
    });
    // the airport's parts on the raster (1), runways 2
    const Z = new Uint8Array(w * h);
    for (const l of lines) {
      const q = l.pts.map(px).map(([x, y]) => [x - gx0 - 0.5, y - gy0 - 0.5]);
      const hw = l.hw / mpp, ext = l.ext / mpp;
      for (let s = 1; s < q.length; s++) {
        const [x0, y0] = q[s - 1], [x1, y1] = q[s];
        const len = Math.hypot(x1 - x0, y1 - y0) || 1e-6;
        const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
        const r = hw + ext;
        for (let y = Math.max(0, Math.floor(Math.min(y0, y1) - r)); y <= Math.min(h - 1, Math.ceil(Math.max(y0, y1) + r)); y++) {
          for (let x = Math.max(0, Math.floor(Math.min(x0, x1) - r)); x <= Math.min(w - 1, Math.ceil(Math.max(x0, x1) + r)); x++) {
            const along = (x - x0) * ux + (y - y0) * uy;
            const across = Math.abs(-(x - x0) * uy + (y - y0) * ux);
            if (across <= hw && along >= -ext && along <= len + ext) Z[y * w + x] = Math.max(Z[y * w + x], l.runway ? 2 : 1);
          }
        }
      }
    }
    for (const ring of polys) {
      const q = ring.map(px).map(([x, y]) => [x - gx0 - 0.5, y - gy0 - 0.5]);
      const ys = q.map((p) => p[1]);
      for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(h - 1, Math.ceil(Math.max(...ys))); y++) {
        const xs = [];
        for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
          const [ax, ay] = q[i], [bx, by] = q[j];
          if ((ay > y) !== (by > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
        }
        xs.sort((u, v) => u - v);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(w - 1, Math.floor(xs[k + 1])); x++) if (!Z[y * w + x]) Z[y * w + x] = 1;
        }
      }
    }
    // closing: what lies between the parts (the grass between the runways) is airport too
    const rc = CLOSE / mpp;
    const D1 = distance(Z, w, h);
    const outside = new Uint8Array(w * h);
    for (let i = 0; i < outside.length; i++) outside[i] = D1[i] > rc ? 1 : 0;
    const D2 = distance(outside, w, h);
    const area = new Uint8Array(w * h);
    for (let i = 0; i < area.length; i++) area[i] = D2[i] > rc || Z[i] ? 1 : 0;
    // the levelled ground
    let T;
    if (REAL.has(code)) {
      T = blur(R, w, h, Math.max(1, Math.round(25 / mpp)));
    } else {
      // a plane through the airport's ground, the runways counting most; least absolute differences
      // (reweighted), so pits, hills, buildings and trees in the old heights don't tilt it
      const S = [];
      const step = Math.max(1, Math.floor(Math.sqrt(w * h / 40000)));
      for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (area[y * w + x]) S.push([x - w / 2, y - h / 2, R[y * w + x], Z[y * w + x] === 2 ? 3 : 1]);
      const hs = S.map((s) => s[2]).sort((u, v) => u - v);
      let c = [hs[Math.floor(hs.length / 2)] || 0, 0, 0];
      for (let it = 0; it < 25; it++) {
        // weighted least squares for h = c0 + c1 x + c2 y
        const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
        for (const [x, y, z, k] of S) {
          const wt = k / Math.max(0.5, Math.abs(z - (c[0] + c[1] * x + c[2] * y)));
          const f = [1, x, y];
          for (let i = 0; i < 3; i++) { v[i] += wt * f[i] * z; for (let j = 0; j < 3; j++) M[i][j] += wt * f[i] * f[j]; }
        }
        const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
        const d = det(M);
        if (!d) break;
        c = [0, 1, 2].map((i) => det(M.map((row, r) => row.map((x, j) => (j === i ? v[r] : x)))) / d);
      }
      // Real airports are graded nearly level (ICAO: 1 % at most along a long runway): an old landscape that
      // falls away under the airport (Istanbul's mines) mustn't tilt it more than MAX_TILT.
      const longest = Math.max(0, ...FG.game.airportRunways(code).map((r) => FG.game.distanceKm({ lat: r[0], lon: r[1] }, { lat: r[2], lon: r[3] }) * 1000));
      const most = (longest >= 1800 ? MAX_TILT[0] : MAX_TILT[1]) * mpp; // (per raster px)
      const tilt = Math.hypot(c[1], c[2]);
      if (tilt > most) {
        c[1] *= most / tilt;
        c[2] *= most / tilt;
        const rest = S.map(([x, y, z]) => z - c[1] * x - c[2] * y).sort((u, v) => u - v);
        c[0] = rest[Math.floor(rest.length / 2)];
      }
      T = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) T[y * w + x] = Math.max(-8, c[0] + c[1] * (x - w / 2) + c[2] * (y - h / 2));
    }
    // how much of it shows: all inside the area, then back to the real ground
    const D3 = distance(area, w, h);
    const m = new Float32Array(w * h);
    const fp = FEATHER / mpp;
    for (let i = 0; i < m.length; i++) {
      const u = Math.min(1, D3[i] / fp);
      m[i] = 1 - u * u * (3 - 2 * u);
    }
    return { code, gx0, gy0, w, h, T, m, sig: signature(code) };
  }

  // ---------- the models ----------
  const models = new Map(); // code -> promise of the model
  const shown = new Set();  // airports whose levelled ground is in tiles the map has
  function settledLayout(code) {
    if (!FG.layouts) return Promise.resolve();
    FG.layouts.get(code);
    const t0 = Date.now();
    return new Promise((done) => {
      const look = () => (FG.layouts.settled(code) || Date.now() - t0 > LAYOUT_WAIT ? done() : setTimeout(look, 250));
      look();
    });
  }
  function model(code) {
    if (!models.has(code)) {
      const p = settledLayout(code).then(() => build(code));
      p.catch(() => models.delete(code));
      models.set(code, p);
      while (models.size > 30) models.delete(models.keys().next().value);
    }
    return models.get(code);
  }
  // Models done already (no waiting), for the zoomed-out tiles.
  const ready = new Map(); // code -> model
  function track(code, p) { return p.then((md) => { ready.set(code, md); if (ready.size > 30) ready.delete(ready.keys().next().value); return md; }); }

  // Height at world px (fractional, MZ) from a model: { m, T } bilinear, or null outside it.
  function sample(md, gx, gy) {
    const fx = gx - 0.5 - md.gx0, fy = gy - 0.5 - md.gy0;
    if (fx < 0 || fy < 0 || fx >= md.w - 1 || fy >= md.h - 1) return null;
    const x = Math.floor(fx), y = Math.floor(fy), ax = fx - x, ay = fy - y;
    const i = y * md.w + x;
    const bl = (A) => (A[i] * (1 - ax) + A[i + 1] * ax) * (1 - ay) + (A[i + md.w] * (1 - ax) + A[i + md.w + 1] * ax) * ay;
    const m = bl(md.m);
    return m > 0.001 ? { m, T: bl(md.T) } : null;
  }

  // Models for the tile z/x/y (whose levelled ground reaches into it).
  async function modelsFor(z, x, y) {
    if (!FG.game || z < MIN_APPLY) return [];
    const k = 2 ** (MZ - z) * SIZE;
    const box = [x * k, y * k, (x + 1) * k, (y + 1) * k];
    const codes = airportsIn(box);
    if (z < MIN_BUILD) return codes.map((c) => ready.get(c)).filter(Boolean);
    const got = await Promise.all(codes.map((c) => track(c, model(c)).catch(() => null)));
    return got.filter((md) => md && md.gx0 < box[2] && md.gx0 + md.w > box[0] && md.gy0 < box[3] && md.gy0 + md.h > box[1]);
  }

  // MapLibre protocol: fgdem://z/x/y -> the terrain tile with the airports in it levelled (terrarium PNG).
  async function protocol(params, abort) {
    const [z, x, y] = params.url.replace(/^fgdem:\/\//, '').split(/[/?]/).map(Number);
    const mds = await modelsFor(z, x, y).catch(() => []);
    if (!mds.length) {
      const r = await fetch(URL.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal: abort && abort.signal });
      if (r.ok) return { data: await r.arrayBuffer() };
      throw Object.assign(new Error(`terrain tile ${r.status}`), { status: r.status }); // (MapLibre takes a 404 quietly: the coarser tile shows)
    }
    const got = await rawTile(z, x, y);
    if (got.missing) throw Object.assign(new Error('terrain tile 404'), { status: 404 });
    const H = Float32Array.from(got);
    const s = 2 ** (MZ - z);
    for (const md of mds) {
      for (let py = 0; py < SIZE; py++) {
        const gy = (y * SIZE + py + 0.5) * s;
        if (gy < md.gy0 || gy > md.gy0 + md.h) continue;
        for (let px = 0; px < SIZE; px++) {
          const gx = (x * SIZE + px + 0.5) * s;
          if (gx < md.gx0 || gx > md.gx0 + md.w) continue;
          const q = sample(md, gx, gy);
          if (q) H[py * SIZE + px] += q.m * (q.T - H[py * SIZE + px]);
        }
      }
      shown.add(md.code);
    }
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(SIZE, SIZE);
    const d = img.data;
    for (let i = 0; i < H.length; i++) {
      const v = Math.max(0, Math.min(65535.99, H[i] + 32768));
      d[i * 4] = Math.floor(v / 256);
      d[i * 4 + 1] = Math.floor(v) % 256;
      d[i * 4 + 2] = Math.floor((v % 1) * 256);
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((done) => c.toBlob(done, 'image/png'));
    return { data: await blob.arrayBuffer() };
  }

  // Heights (m) at [lat, lon] points as the 3D map draws them, from the tiles of zoom z.
  async function heightsAt(pts, z = MZ) {
    const n = 2 ** z;
    const at = pts.map(([lat, lon]) => {
      const [gx, gy] = toPx(lat, lon, z);
      return { tx: ((Math.floor(gx / SIZE) % n) + n) % n, ty: Math.floor(gy / SIZE), px: Math.floor(gx) % SIZE, py: Math.floor(gy) % SIZE, lat, lon };
    });
    const keys = [...new Set(at.map((p) => `${p.tx}/${p.ty}`))];
    const tiles = {}, mds = {};
    await Promise.all(keys.map(async (k) => {
      const [tx, ty] = k.split('/').map(Number);
      [tiles[k], mds[k]] = await Promise.all([rawTile(z, tx, ty), modelsFor(z, tx, ty).catch(() => [])]);
    }));
    return at.map((p) => {
      const k = `${p.tx}/${p.ty}`;
      let h = tiles[k][p.py * SIZE + p.px];
      const [gx, gy] = toPx(p.lat, p.lon, MZ);
      for (const md of mds[k]) {
        const q = sample(md, gx, gy);
        if (q) h += q.m * (q.T - h);
      }
      return h;
    });
  }

  // An airport's runways, layout or buildings changed: level it again. True when tiles the map has are
  // out of date (the 3D view then loads its terrain again).
  function check() {
    let stale = false;
    for (const code of [...models.keys()]) {
      const md = ready.get(code);
      if (!md || md.sig === signature(code)) continue;
      models.delete(code);
      ready.delete(code);
      reach.delete(code);
      if (shown.delete(code)) stale = true;
    }
    return stale;
  }

  FG.flat = { protocol, heightsAt, check, REAL, models: ready };
})();
