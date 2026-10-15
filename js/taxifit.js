// Taxiways fitted to the satellite picture: a taxiway is drawn as its centre line, roughly along the middle of
// the real one; this looks across it in the aerial photo (Esri World Imagery, as the maps show it) every few
// metres, finds where the pavement ends on both sides, and gives back the line moved into the real middle and
// the real width. The airport editor (js/airportedit.js, F3) uses it for taxiways drawn there and with its
// "Fit to satellite" button; the result is a fix op with the width (`w`, js/fixes.js), and the maps draw the
// taxiway that wide with its yellow line down the middle.
(function () {
  const M = 111320;
  const DEG = Math.PI / 180;
  const Z = 18; // the photo's finest zoom everywhere (~0.6 m a pixel at 0°, less towards the poles)
  const URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const STEP = 4;      // m between the cross sections along the line
  const REACH = 45;    // m looked at on either side
  const RES = 0.5;     // m between the samples of a cross section
  const GAP = 2.5;     // m of something else in a row: the pavement has ended (paint, cracks and shadows are shorter)
  const MIN_W = 6, MAX_W = 70;

  const tileX = (lon, z = Z) => ((lon + 180) / 360) * 2 ** z;
  const tileY = (lat, z = Z) => ((1 - Math.log(Math.tan(lat * DEG) + 1 / Math.cos(lat * DEG)) / Math.PI) / 2) * 2 ** z;

  // The photo round the points (lat/lon), as one canvas: { at(lat, lon) -> [r, g, b] or null }. z: a coarser zoom
  // for big areas (js/facades.js reads roof colours at 16-17).
  function loadImage(img, src) {
    return new Promise((ok, fail) => {
      img.crossOrigin = 'anonymous';
      img.onload = () => ok(img);
      img.onerror = () => fail(new Error('satellite tile did not load'));
      img.src = src;
    });
  }
  async function photo(pts, pad, z = Z) {
    const lat0 = pts[0][0];
    const dLat = pad / M, dLon = pad / (M * Math.cos(lat0 * DEG));
    const s = Math.min(...pts.map((p) => p[0])) - dLat, n = Math.max(...pts.map((p) => p[0])) + dLat;
    const w = Math.min(...pts.map((p) => p[1])) - dLon, e = Math.max(...pts.map((p) => p[1])) + dLon;
    const x0 = Math.floor(tileX(w, z)), x1 = Math.floor(tileX(e, z));
    const y0 = Math.floor(tileY(n, z)), y1 = Math.floor(tileY(s, z));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 120) throw new Error('too long to fit in one go: split it');
    const cv = document.createElement('canvas');
    cv.width = (x1 - x0 + 1) * 256;
    cv.height = (y1 - y0 + 1) * 256;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const jobs = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        jobs.push(loadImage(new Image(), URL.replace('{z}', z).replace('{x}', x).replace('{y}', y))
          .then((img) => ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256)));
      }
    }
    await Promise.all(jobs);
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    return {
      at(lat, lon) {
        const px = Math.floor((tileX(lon, z) - x0) * 256), py = Math.floor((tileY(lat, z) - y0) * 256);
        if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) return null;
        const i = (py * cv.width + px) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      },
    };
  }

  const median = (xs) => { const a = xs.slice().sort((p, q) => p - q); return a.length ? a[a.length >> 1] : NaN; };
  const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const green = (c) => c[1] > c[0] + 12 && c[1] > c[2] + 6; // grass, trees

  // One cross section through p (metres east/north of the origin: `ll` turns them back), along the normal n.
  // How far the pavement reaches on the left (-) and right (+) side, or null.
  function section(img, ll, p, n) {
    const cols = [];
    for (let s = -REACH; s <= REACH + 1e-9; s += RES) cols.push(img.at(...ll([p[0] + n[0] * s, p[1] + n[1] * s])));
    if (cols.some((c) => !c)) return null;
    const mid = cols.length >> 1;
    const core = cols.slice(mid - 6, mid + 7); // ±3 m: the drawn line lies on the pavement
    const ref = [0, 1, 2].map((k) => median(core.map((c) => c[k])));
    if (green(ref)) return null;
    const spread = median(core.map((c) => cdist(c, ref)));
    const T = Math.max(26, Math.min(60, 16 + spread * 3.5));
    const run = Math.round(GAP / RES);
    const edge = (dir) => {
      let off = 0;
      for (let i = mid; i >= 0 && i < cols.length; i += dir) {
        const c = cols[i];
        const paved = cdist(c, ref) < T && !green(c);
        if (paved) { off = 0; continue; }
        if (++off >= run) return Math.abs(i - dir * (run - 1) - mid) * RES - RES / 2;
      }
      return null; // still pavement at the end: an apron or a runway alongside
    };
    const l = edge(-1), r = edge(1);
    return l == null || r == null ? null : { l, r };
  }

  // fit(line [[lat, lon]..], { keep(pt) -> true where an end must stay: it joins another taxiway })
  // -> Promise of { geom, w, sections, used, moved } or an Error with what went wrong.
  async function fit(line, opts = {}) {
    if (!line || line.length < 2) throw new Error('a taxiway needs two points');
    const o = line[0];
    const kx = M * Math.cos(o[0] * DEG);
    const xy = (p) => [(p[1] - o[1]) * kx, (p[0] - o[0]) * M];
    const ll = (q) => [o[0] + q[1] / M, o[1] + q[0] / kx];
    const P = line.map(xy);
    const segs = [];
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) continue;
      const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      segs.push({ i, a, b, len, t, n: [t[1], -t[0]] }); // n: to the right
    }
    if (!segs.length) throw new Error('the taxiway has no length');
    const img = await photo(line, REACH + 10);
    // where each segment starts along the line, and how sharp the bend at each point is
    let run = 0;
    for (const g of segs) { g.s0 = run; run += g.len; }
    const total = run;
    const sharp = (k) => {
      const gin = segs.find((g) => g.i === k), gout = segs.find((g) => g.i === k + 1);
      return gin && gout && gin.t[0] * gout.t[0] + gin.t[1] * gout.t[1] < Math.cos(20 * DEG);
    };
    // cross sections every STEP m along the whole line (not within 6 m of a sharp bend: it widens there)
    const secs = [];
    for (const g of segs) {
      const a0 = sharp(g.i - 1) ? Math.min(6, g.len / 2) : 0;
      const a1 = sharp(g.i) ? g.len - Math.min(6, g.len / 2) : g.len;
      for (let d = a0 + ((STEP - ((g.s0 + a0) % STEP)) % STEP); d <= a1 + 1e-9; d += STEP) {
        const p = [g.a[0] + g.t[0] * d, g.a[1] + g.t[1] * d];
        const s = section(img, ll, p, g.n);
        if (s) secs.push({ g, at: g.s0 + d, w: s.l + s.r, off: (s.r - s.l) / 2 });
      }
    }
    const ok = secs.filter((s) => s.w >= MIN_W && s.w <= MAX_W);
    if (ok.length < 3 || ok.length < secs.length * 0.25) {
      throw new Error('could not make out the taxiway in the satellite picture here (draw it along its middle, or set the width by hand)');
    }
    const w0 = median(ok.map((s) => s.w));
    // where it widens (junctions, an apron or a runway beside it) the middle is not the taxiway's: left out
    const good = ok.filter((s) => s.w <= w0 * 1.35 && s.w >= w0 * 0.65);
    const w = Math.round(median(good.map((s) => s.w)) * 2) / 2;
    // Each point moves by the middle of the cross sections within 15 m of it along the line (the whole line's
    // when there are too few), never more than half the width (the line was drawn on the taxiway), along the
    // bend's bisector.
    const all = median(good.map((s) => s.off));
    const cap = (x) => Math.max(-w / 2, Math.min(w / 2, x));
    const out = P.map((p, k) => {
      const gin = segs.find((g) => g.i === k), gout = segs.find((g) => g.i === k + 1);
      const at = gout ? gout.s0 : total;
      const near = good.filter((s) => Math.abs(s.at - at) <= 15);
      let off = cap(near.length >= 3 ? median(near.map((s) => s.off)) : all);
      const end = k === 0 || k === P.length - 1;
      if (end && opts.keep && opts.keep(line[k])) off = 0;
      const ns = [gin, gout].filter(Boolean).map((g) => g.n);
      let n = [ns.reduce((x, v) => x + v[0], 0), ns.reduce((x, v) => x + v[1], 0)];
      const nl = Math.hypot(n[0], n[1]) || 1;
      n = [n[0] / nl, n[1] / nl];
      const c = ns.length === 2 ? Math.max(0.5, n[0] * ns[0][0] + n[1] * ns[0][1]) : 1; // keep the offset lines parallel
      return [p[0] + (n[0] * off) / c, p[1] + (n[1] * off) / c];
    });
    // A taxiway kept at both ends (joined on to others) whose middle lies off: two points put in near them, so
    // the stretch between runs down the real middle.
    let geom = out;
    if (P.length === 2 && opts.keep && opts.keep(line[0]) && opts.keep(line[1]) && Math.abs(cap(all)) > 1 && segs[0].len > 80) {
      const g = segs[0];
      const at = (d) => [g.a[0] + g.t[0] * d + g.n[0] * cap(all), g.a[1] + g.t[1] * d + g.n[1] * cap(all)];
      geom = [P[0], at(25), at(g.len - 25), P[1]];
    }
    const moved = Math.max(0, ...geom.map((q) => Math.min(...P.map((p) => Math.hypot(q[0] - p[0], q[1] - p[1])))));
    const r5 = (x) => Math.round(x * 1e5) / 1e5;
    return { geom: geom.map(ll).map(([la, lo]) => [r5(la), r5(lo)]), w, sections: secs.length, used: good.length, moved };
  }

  FG.taxiFit = { fit, section, photo };
})();
