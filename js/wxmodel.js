// The weather of the whole world, as in real life (looks only, flights never wait for it). No DOM, no game state:
// game.js weatherAt/windAt call FG.wxModel.sample(lat, lon, t, ctx). The Rust app has the same model, number for
// number (github.com/lianhirter-arch/flightgame-rust, src/weather.rs): change both together.
//
// Two ways to get it, Settings → Weather (FG.wxModel.mode):
// - 'sim' (made up, the default): the real climate (js/data/climate.js: NASA's long-term monthly means of
//   temperature, its day/night range, rain, cloud and humidity on a 5° grid) for the place and the game's day of the
//   year, so seasons, monsoons, deserts, rainforests and foggy coasts are where and when they really are. Weather
//   systems move over it: lows with their warm and cold fronts form where they really do (Gulf of Alaska, lee of the
//   Rockies, Cape Hatteras, Iceland, Gulf of Genoa, off Japan, the Southern Ocean …), more in winter, and travel
//   east with the westerlies; tropical cyclones form in their basins and seasons (Atlantic June–November, typhoons,
//   cyclones in the south from November to April), go west, turn north-east and die over land or cold water.
//   Showers and thunderstorms build in the afternoon over warm land, fog forms on calm humid mornings. Winds: the
//   trades, the westerlies and polar easterlies shifting with the seasons, the Asian monsoon, the winds round each
//   low and cyclone, and the jet streams aloft (further south and stronger in winter). The same for everyone at the
//   same game time.
// - 'live' (real weather now): js/weather.js fetches the real weather (Open-Meteo: a 7.5° grid over the world for
//   the next 24 hours, and a 1.5° patch where the player looks) and hands it over with setLive(); it is read for the
//   real time now (game time ahead of now looks into the forecast). Clouds keep the made-up texture inside a cell.
//   Until it has arrived, or offline, it is 'sim'.
(function () {
  const DEG = Math.PI / 180;
  const DAY = 1440;
  const TAU = 2 * Math.PI;
  const WX_DRIFT = 0.0064; // degrees of longitude a minute the cloud texture drifts east
  const WX_MORPH = 2160;   // minutes for the texture to change shape
  const SLOT = 360;        // weather systems may form once per region every 6 game hours
  const BUCKET = 10;       // their positions are worked out every 10 game minutes

  // ---------- noise ----------
  function hash(x, y, z, s) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(s, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // Smooth value noise in [0, 1).
  function noise(x, y, z, s) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy), q = fz * fz * (3 - 2 * fz);
    const a0 = hash(xi, yi, zi, s), b0 = hash(xi + 1, yi, zi, s), c0 = hash(xi, yi + 1, zi, s), d0 = hash(xi + 1, yi + 1, zi, s);
    const a1 = hash(xi, yi, zi + 1, s), b1 = hash(xi + 1, yi, zi + 1, s), c1 = hash(xi, yi + 1, zi + 1, s), d1 = hash(xi + 1, yi + 1, zi + 1, s);
    const lo = a0 + (b0 - a0) * u + (c0 + (d0 - c0) * u - a0 - (b0 - a0) * u) * w;
    const hi = a1 + (b1 - a1) * u + (c1 + (d1 - c1) * u - a1 - (b1 - a1) * u) * w;
    return lo + (hi - lo) * q;
  }
  const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  // Where a share p of a logistic spread (about a normal one, sd 1) lies above: the anomaly over which that share is.
  const zAbove = (p) => Math.log((1 - p) / p) / 1.702;
  const wrapLon = (d) => ((d + 540) % 360) - 180;

  // ---------- the climate ----------
  let climBytes = null;
  function bytes() {
    if (climBytes) return climBytes;
    const c = FG.data && FG.data.climate;
    if (!c) return null;
    const s = atob(c.b64);
    climBytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) climBytes[i] = s.charCodeAt(i);
    return climBytes;
  }
  const CL = { t: 15, dtr: 8, p: 2, cc: 0.5, rh: 0.7 };
  // The climate at a place on a day of the year (0 = 1 January, fractional), between the grid's cells and months:
  // t (°C at sea level), dtr (°C day/night range), p (mm of rain a day), cc (cloud cover 0-1), rh (humidity 0-1).
  function climate(lat, lon, doy) {
    const b = bytes();
    if (!b) { CL.t = 28 - 0.4 * Math.abs(lat); CL.dtr = 8; CL.p = 2; CL.cc = 0.5; CL.rh = 0.7; return CL; }
    const fr = clamp((87.5 - lat) / 5, 0, 35);
    const r0 = Math.min(34, Math.floor(fr)), kr = fr - r0;
    const fc = (((lon + 177.5) / 5) % 72 + 72) % 72;
    const c0 = Math.floor(fc) % 72, kc = fc - Math.floor(fc), c1 = (c0 + 1) % 72;
    const fm = ((((doy - 15.2) / 30.44) % 12) + 12) % 12;
    const m0 = Math.floor(fm) % 12, km = fm - Math.floor(fm), m1 = (m0 + 1) % 12;
    let t = 0, dtr = 0, p = 0, cc = 0, rh = 0;
    for (let i = 0; i < 8; i++) {
      const r = r0 + (i & 1), c = i & 2 ? c1 : c0, m = i & 4 ? m1 : m0;
      const w = (i & 1 ? kr : 1 - kr) * (i & 2 ? kc : 1 - kc) * (i & 4 ? km : 1 - km);
      const o = ((r * 72 + c) * 12 + m) * 5;
      t += w * b[o]; dtr += w * b[o + 1]; p += w * b[o + 2]; cc += w * b[o + 3]; rh += w * b[o + 4];
    }
    CL.t = t - 80; CL.dtr = dtr / 4; CL.p = p / 10; CL.cc = cc / 250; CL.rh = rh / 250;
    return CL;
  }

  // ---------- weather systems ----------
  // Where lows form: [lat, lon, ± lat, ± lon, how many a year, kind (0 low, 1 tropical cyclone), peak day of the
  // year, east km/h, poleward km/h, shortest and longest life (days), (cyclones) latitude they turn north-east at].
  const REGIONS = [
    // lows of the northern mid-latitudes (most in winter)
    [47, -160, 6, 15, 110, 0, 15, 45, 10, 3, 6],   // Gulf of Alaska
    [48, 160, 6, 10, 90, 0, 15, 40, 12, 3, 6],     // Kamchatka, Aleutians
    [34, 128, 4, 8, 100, 0, 40, 50, 12, 3, 5],     // off Japan, East China Sea
    [45, 110, 5, 10, 50, 0, 100, 40, 8, 2, 4],     // Mongolia, north China
    [58, 70, 6, 15, 50, 0, 200, 35, 5, 3, 5],      // western Siberia
    [52, -115, 4, 6, 60, 0, 15, 50, -10, 2, 4],    // Alberta clipper
    [38, -104, 4, 4, 70, 0, 90, 40, 14, 3, 5],     // Colorado low
    [28, -92, 3, 6, 40, 0, 30, 45, 25, 2, 4],      // Gulf of Mexico
    [36, -73, 4, 4, 90, 0, 30, 45, 18, 3, 6],      // Cape Hatteras
    [45, -45, 6, 12, 110, 0, 15, 50, 15, 3, 6],    // mid Atlantic
    [58, -30, 5, 12, 80, 0, 15, 40, 8, 3, 6],      // Iceland
    [42, 8, 3, 6, 50, 0, 40, 25, -3, 2, 4],        // Gulf of Genoa
    [35, 30, 3, 6, 35, 0, 30, 25, 3, 2, 4],        // eastern Mediterranean
    [45, 45, 4, 8, 30, 0, 100, 30, 5, 2, 4],       // Black Sea, Caspian
    // southern mid-latitudes (all year, most in July)
    [-42, -55, 5, 10, 90, 0, 196, 50, 12, 3, 6],   // off Argentina
    [-45, 15, 5, 15, 100, 0, 196, 50, 10, 3, 6],   // south of Africa
    [-48, 70, 5, 20, 100, 0, 196, 55, 8, 3, 6],    // southern Indian Ocean
    [-42, 130, 5, 15, 90, 0, 196, 50, 10, 3, 6],   // south of Australia
    [-38, 160, 4, 8, 55, 0, 196, 40, 8, 2, 5],     // Tasman Sea
    [-50, -140, 6, 25, 100, 0, 196, 50, 8, 3, 6],  // South Pacific
    [-45, -95, 5, 10, 70, 0, 196, 45, 10, 3, 5],   // off Chile
    // tropical cyclones (in their seasons only)
    [14, -45, 4, 20, 14, 1, 253, -20, 7, 6, 12, 30],  // North Atlantic
    [19, -80, 3, 8, 4, 1, 260, -15, 10, 3, 7, 27],    // Caribbean, Gulf
    [14, -102, 3, 10, 16, 1, 230, -20, 5, 4, 9, 40],  // eastern Pacific
    [13, 140, 5, 15, 22, 1, 240, -20, 8, 5, 11, 27],  // typhoons
    [12, 135, 4, 12, 5, 1, 130, -18, 8, 4, 8, 22],    // typhoons out of season
    [16, 115, 3, 4, 4, 1, 240, -15, 8, 3, 6, 40],     // South China Sea
    [14, 88, 3, 4, 3, 1, 300, -10, 12, 3, 6, 40],     // Bay of Bengal (autumn)
    [13, 88, 3, 4, 2, 1, 140, -5, 14, 3, 5, 40],      // Bay of Bengal (May)
    [14, 66, 3, 4, 2, 1, 150, -8, 8, 3, 6, 40],       // Arabian Sea
    [-12, 70, 3, 15, 10, 1, 40, -18, 8, 5, 10, 22],   // southern Indian Ocean
    [-14, 120, 3, 8, 6, 1, 40, -15, 8, 4, 8, 22],     // north-west Australia
    [-14, 165, 3, 15, 8, 1, 50, -12, 9, 4, 9, 20],    // Coral Sea, South Pacific
  ];
  const MAX_LIFE = 12; // days
  // How often a region makes a system on a day of the year (1 = its mean): lows ±55 % over the year, cyclones only
  // in the three months either side of their peak.
  function seasonOf(kind, peak, doy) {
    const c = Math.cos(TAU * (doy - peak) / 365);
    return kind ? 4 * Math.max(0, c) ** 2 : 1 + 0.55 * c;
  }
  const sysCache = new Map();
  // The systems under way at game time t: [{ kind, lat, lon, hemi, I (0 … 1), R (km), rm (km, strongest winds),
  // dp (hPa), vmax (kt) }], worked out every BUCKET minutes. ctx.doy(t) is the day of the year.
  function systems(t, ctx) {
    const bucket = Math.floor(t / BUCKET);
    const key = `${bucket}|${ctx.key || ''}`;
    let list = sysCache.get(key);
    if (list) return list;
    const tb = bucket * BUCKET;
    list = [];
    const k1 = Math.floor(tb / SLOT);
    const k0 = k1 - Math.ceil(MAX_LIFE * DAY / SLOT);
    for (let j = k0; j <= k1; j++) {
      const doy = ctx.doy(j * SLOT);
      for (let i = 0; i < REGIONS.length; i++) {
        const R = REGIONS[i];
        const kind = R[5];
        const p = R[4] * seasonOf(kind, R[6], doy) * SLOT / 525600;
        if (hash(j, i, 0, 31) >= p) continue;
        const ts = (j + hash(j, i, 1, 31)) * SLOT;
        const lifeH = (R[9] + (R[10] - R[9]) * hash(j, i, 2, 31)) * 24;
        const age = (tb - ts) / 60;
        if (age < 0 || age > lifeH) continue;
        const g = age / lifeH;
        const hemi = R[0] >= 0 ? 1 : -1;
        const lat0 = R[0] + (hash(j, i, 3, 31) * 2 - 1) * R[2];
        const lon0 = R[1] + (hash(j, i, 4, 31) * 2 - 1) * R[3];
        const h5 = hash(j, i, 5, 31), h6 = hash(j, i, 6, 31), h7 = hash(j, i, 7, 31);
        const sp = 0.8 + 0.4 * h7; // (some faster, some slower)
        let lat, lon, I;
        if (kind === 0) {
          lat = lat0 + hemi * R[8] * sp * age / 111;
          lon = lon0 + R[7] * sp * age / (111 * Math.cos(lat0 * DEG));
          I = Math.sin(Math.PI * g) ** 0.8;
          lat = clamp(lat, -78, 78);
          list.push({ kind, lat, lon: wrapLon(lon), hemi, I, R: 800 + 700 * h5, rm: 0, dp: 10 + 28 * h6, vmax: 16 + 24 * h6 });
        } else {
          const turn = R[11] + 5 * (h7 - 0.5);
          const aTurn = Math.max(0, (turn - Math.abs(lat0)) * 111 / (R[8] * sp));
          if (age <= aTurn) {
            lat = lat0 + hemi * R[8] * sp * age / 111;
            lon = lon0 + R[7] * sp * age / (111 * Math.cos(lat0 * DEG));
          } else {
            const lonT = lon0 + R[7] * sp * aTurn / (111 * Math.cos(lat0 * DEG));
            lat = hemi * turn + hemi * 22 * sp * (age - aTurn) / 111;
            lon = lonT + 32 * sp * (age - aTurn) / (111 * Math.cos(turn * DEG));
          }
          lat = clamp(lat, -60, 60);
          lon = wrapLon(lon);
          // stronger over warm sea, dying over land (big day/night range) and cold water
          const c = climate(lat, lon, ctx.doy(tb));
          I = smooth(0, 0.3, g) * (1 - smooth(0.65, 1, g)) * smooth(22, 27.5, c.t) * (1 - 0.75 * smooth(6, 10, c.dtr));
          if (I < 0.05) continue;
          const vmax = 40 + 105 * h5 ** 1.5;
          list.push({ kind, lat, lon, hemi, I, R: 380 + 260 * h6, rm: 25 + 35 * hash(j, i, 8, 31), dp: (vmax * I / 14.8) ** 2, vmax });
        }
      }
    }
    if (sysCache.size > 24) sysCache.delete(sysCache.keys().next().value);
    sysCache.set(key, list);
    return list;
  }

  // ---------- the prevailing winds ----------
  // The latitude of the thermal equator (the ITCZ) on a day of the year.
  const itczOf = (doy) => 5 + 6 * Math.cos(TAU * (doy - 200) / 365);
  // Surface wind (u east, v north, kt) of the trades, westerlies, polar easterlies and the Asian monsoon.
  function prevailing(lat, lon, doy, out) {
    const y = lat - itczOf(doy);
    let u = 0, v = 0;
    const tn = smooth(1, 6, y) * (1 - smooth(24, 34, y)); // north-east trades
    const ts = smooth(1, 6, -y) * (1 - smooth(24, 34, -y)); // south-east trades
    u -= 13 * (tn + ts); v += 6 * (ts - tn);
    const a = Math.abs(lat);
    const west = Math.exp(-(((a - 48) / 11) ** 2));
    u += 14 * west;
    u -= 6 * smooth(62, 72, a);
    // the summer monsoon: south-west over India and South-East Asia from June to September
    const mon = smooth(-0.2, 0.5, Math.cos(TAU * (doy - 205) / 365)) * smooth(55, 65, lon) * (1 - smooth(110, 125, lon)) *
      smooth(-2, 4, lat) * (1 - smooth(24, 30, lat));
    u = u * (1 - mon) + 10 * mon; v = v * (1 - mon) + 8 * mon;
    out.u = u; out.v = v;
    return out;
  }

  // ---------- live weather ----------
  // Grids handed over by js/weather.js: { t0 (ms, first hour), hours, lat0, lon0 (south-west cell), step (°), rows, cols,
  // wrap (true for the world grid), v: { name: Float32Array[hours × rows × cols] } } with cc (0-1), mm (rain an hour),
  // code (WMO), t (°C at sea level), dew (°C), u, v (kt), gust (kt), qnh, vis (m), u7/v7 (700 hPa), u25/v25 (250 hPa).
  const live = { world: null, patch: null };
  function gridAt(g, lat, lon, ms, out, names) {
    let fh = (ms - g.t0) / 3600000;
    fh = clamp(fh, 0, g.hours - 1);
    const h0 = Math.min(g.hours - 2, Math.floor(fh)), kh = fh - h0;
    const fr = (lat - g.lat0) / g.step;
    if (fr < 0 || fr > g.rows - 1) { if (!g.wrap) return false; }
    const r0 = clamp(Math.floor(fr), 0, g.rows - 2), kr = clamp(fr - r0, 0, 1);
    let fc = (lon - g.lon0) / g.step;
    if (g.wrap) fc = ((fc % g.cols) + g.cols) % g.cols;
    else if (fc < 0 || fc > g.cols - 1) return false;
    const c0 = Math.min(g.wrap ? g.cols - 1 : g.cols - 2, Math.floor(fc)), kc = fc - c0;
    const c1 = g.wrap ? (c0 + 1) % g.cols : c0 + 1;
    const n = g.rows * g.cols;
    for (const name of names) {
      const a = g.v[name];
      let s = 0;
      for (let i = 0; i < 8; i++) {
        const r = r0 + (i & 1), c = i & 2 ? c1 : c0, h = h0 + (i & 4 ? 1 : 0);
        const w = (i & 1 ? kr : 1 - kr) * (i & 2 ? kc : 1 - kc) * (i & 4 ? kh : 1 - kh);
        s += w * a[h * n + r * g.cols + c];
      }
      out[name] = s;
    }
    // (codes are not averaged: the nearest cell's)
    const rn = kr < 0.5 ? r0 : r0 + 1, cn = kc < 0.5 ? c0 : c1, hn = kh < 0.5 ? h0 : h0 + 1;
    out.code = g.v.code[hn * n + rn * g.cols + cn];
    return true;
  }
  const LIVE_NAMES = ['cc', 'mm', 't', 'dew', 'u', 'v', 'gust', 'qnh', 'vis', 'u7', 'v7', 'u25', 'v25'];
  const LV = {};
  const LP = {};
  // Live weather at a place and real time ms, or null: the patch where it has the place (faded into the world grid
  // over its edge), else the world grid.
  function liveAt(lat, lon, ms) {
    if (!live.world) return null;
    if (!gridAt(live.world, lat, lon, ms, LV, LIVE_NAMES)) return null;
    const p = live.patch;
    if (p && gridAt(p, lat, lon, ms, LP, LIVE_NAMES)) {
      const er = Math.min(lat - p.lat0, p.lat0 + (p.rows - 1) * p.step - lat);
      const ec = Math.min(wrapLon(lon - p.lon0), wrapLon(p.lon0 + (p.cols - 1) * p.step - lon));
      const k = smooth(0, 2 * p.step, Math.min(er, ec));
      for (const n of LIVE_NAMES) LV[n] += (LP[n] - LV[n]) * k;
      if (k > 0.5) LV.code = LP.code;
    }
    return LV;
  }

  // ---------- the weather at a place ----------
  // ctx: { doy(t) (day of the year, 0 = 1 January), utc(t) (UTC minutes), storms ([{ lat, lon, km }], the newspaper's
  // storm events), key (what tells games apart: the systems are cached by it), now (game time), nowMs (real time
  // then) }. elevM: the ground's height there (temperature), or 0.
  // Returns { cover, rain, storm } with lite, else also snow, fog, tempC, dewC, qnh, visKm, baseFt, windFrom, windKt,
  // gustKt, u, v (surface wind, kt), cold (0-1, behind a front), name, icon, live (true when real).
  const PW = { u: 0, v: 0 };
  function sample(lat, lon, t, ctx, lite, elevM = 0) {
    const doyI = ctx.doy(t);
    const doy = doyI + (((t % DAY) + DAY) % DAY) / DAY;
    const utc = ctx.utc(t);
    const hour = ((((utc / 60 + lon / 15) % 24) + 24) % 24); // local solar time
    const x = lon - WX_DRIFT * t;
    const z = t / WX_MORPH;
    // texture: an anomaly with a spread of about 1 (0 on average)
    const n = 0.62 * noise(x / 9, lat / 7, z, 1) + 0.38 * noise(x / 2.6, lat / 2.2, z * 1.7, 2);
    let an = (n - 0.5) / 0.132;
    const lv = FG.wxModel.mode === 'live' && ctx.nowMs ? liveAt(lat, lon, ctx.nowMs + (t - ctx.now) * 60000) : null;
    const sys = lv ? null : systems(t, ctx); // (first: it uses climate()'s scratch object too)
    const c = climate(lat, lon, doy);
    let cc, rf, wetSys = 0, rainSys = 0, tSys = 0, pSys = 0, cold = 0, stormSys = 0;
    let su = 0, sv = 0; // the systems' winds
    if (lv) {
      cc = clamp(lv.cc, 0.02, 0.98);
      // a cell's rain an hour, as the share of it where it rains
      rf = lv.mm > 0.05 ? clamp(0.25 + 0.25 * Math.min(4, lv.mm), 0.1, 0.9) : 0.004;
      an *= 0.8;
    } else {
      cc = clamp(c.cc, 0.03, 0.97);
      rf = clamp(0.05 * c.p ** 0.75, 0.003, 0.45);
      for (const s of sys) {
        const dy = (lat - s.lat) * 111;
        if (Math.abs(dy) > 2.2 * s.R) continue;
        const dx = wrapLon(lon - s.lon) * 111 * Math.cos((lat + s.lat) * 0.5 * DEG);
        if (Math.abs(dx) > 2.2 * s.R) continue;
        const r = Math.hypot(dx, dy) + 1;
        if (r > 2.2 * s.R) continue;
        const R = s.R;
        const yy = dy * s.hemi; // (towards the pole)
        let vt;
        if (s.kind === 0) {
          // the comma head and warm front north-east of the centre, the cold front trailing towards the equator
          const head = Math.exp(-(((dx - 0.25 * R) / (0.6 * R)) ** 2) - (((yy - 0.1 * R) / (0.45 * R)) ** 2));
          const xf = 0.3 * R + 0.25 * yy;
          const d = dx - xf;
          const along = smooth(-1.9 * R, -1.2 * R, yy) * (1 - smooth(-0.05 * R, 0.2 * R, yy));
          const front = Math.exp(-((d / (0.12 * R)) ** 2)) * along;
          const near = Math.exp(-((r / (1.3 * R)) ** 2));
          const behind = smooth(0.1 * R, 0.4 * R, -d) * near * smooth(-1.6 * R, -0.6 * R, yy + 0.3 * R);
          const warm = smooth(0, 0.2 * R, d) * (1 - smooth(-0.1 * R, 0.3 * R, yy)) * near;
          const ring = Math.exp(-(((r - 1.7 * R) / (0.45 * R)) ** 2));
          wetSys += s.I * (1.6 * head + 1.9 * front + 0.25 * warm - 0.45 * behind - 0.15 * ring);
          rainSys += s.I * (0.9 * head + 1.5 * front);
          stormSys = Math.max(stormSys, s.I * front);
          tSys += s.I * (3 * warm - 5 * behind);
          cold = Math.max(cold, s.I * behind);
          pSys -= s.dp * s.I * Math.exp(-((r / (0.7 * R)) ** 2));
          const rm = 0.4 * R;
          vt = s.vmax * s.I * (r / rm) * Math.exp(0.5 * (1 - (r / rm) ** 2)) * (1 - smooth(1.6 * R, 2.2 * R, r));
        } else {
          // a tropical cyclone: the eyewall, spiral rain bands and the cloud shield, a clear eye when strong
          const th = Math.atan2(dy, dx);
          const band = 0.5 + 0.5 * Math.cos(2 * (th - s.hemi * 1.3 * Math.log(r / s.rm)));
          const shield = Math.exp(-((r / (0.6 * R)) ** 2));
          const wall = Math.exp(-(((r - s.rm) / (0.6 * s.rm)) ** 2));
          const eye = s.I > 0.6 ? Math.exp(-((r / (0.45 * s.rm)) ** 2)) : 0;
          wetSys += s.I * (2.2 * shield + 1.2 * band * Math.exp(-((r / R) ** 2)) + 2 * wall) - 4 * eye;
          rainSys += s.I * (1.2 * shield + 1.4 * band * Math.exp(-((r / R) ** 2)) + 3 * wall) - 4 * eye;
          stormSys = Math.max(stormSys, s.I * Math.max(wall, 0.7 * band * Math.exp(-((r / (0.8 * R)) ** 2))));
          pSys -= s.dp * (1 - Math.exp(-s.rm / r)) * (1 - smooth(1.5 * R, 2.2 * R, r));
          vt = s.vmax * s.I * (r < s.rm ? r / s.rm : (s.rm / r) ** 0.55) * (1 - smooth(1.4 * R, 2.2 * R, r));
        }
        // anticlockwise round a low in the north, clockwise in the south, turned 25° in towards the centre
        const tx = -dy / r * s.hemi, ty = dx / r * s.hemi;
        const ca = 0.906, sa = 0.423; // cos, sin 25°
        su += vt * (tx * ca - dx / r * sa);
        sv += vt * (ty * ca - dy / r * sa);
      }
    }
    // afternoon showers and thunderstorms over warm land (a big day/night range), clearer mornings
    const tNow0 = lv ? lv.t : c.t;
    // (over land in the afternoon; over the sea a little all day)
    const land = smooth(4, 9, c.dtr);
    const conv = smooth(20, 28, tNow0) * smooth(1.5, 7, lv ? 4 : c.p) * (0.35 + 0.65 * land);
    const aft = land * Math.max(0, Math.cos(TAU * (hour - 16) / 24)) ** 2 + (1 - land) * 0.4;
    const a = an + 1.6 * wetSys + 0.6 * conv * (aft - 0.3) * land;
    let cover = smooth(-1.25, 1.25, a + 1.25 * zAbove(1 - cc));
    const zr = zAbove(rf);
    let rain = smooth(zr, zr + 1.1, a + 0.9 * rainSys);
    if (lv && lv.mm < 0.05) rain *= 0.15;
    let storm = false;
    if (rain > 0.2 && Math.abs(lat) < 62) {
      const ns = noise(x / 1.1, lat / 1.1, z * 3, 3);
      if (lv) storm = lv.code >= 95 ? ns > 0.35 : false;
      else storm = ns > 0.95 - 1.6 * conv * aft - 0.45 * stormSys * smooth(8, 20, c.t);
    }
    let stormKm = 0;
    for (const st of ctx.storms || []) {
      const dy = (lat - st.lat) * 111;
      const dx = wrapLon(lon - st.lon) * 111 * Math.cos(lat * DEG);
      const d = Math.hypot(dx, dy);
      if (d >= st.km) continue;
      const k = 1 - d / st.km;
      cover = Math.max(cover, Math.min(1, 0.4 + 1.2 * k));
      rain = Math.max(rain, Math.min(1, 1.4 * k));
      if (k > 0.2) { storm = true; stormKm = Math.max(stormKm, k); }
    }
    if (lite) return { cover, rain, storm };

    // temperature: the climate's (or the real one) for the time of day, the fronts, the height of the ground
    let tempC, dewC, qnh, u, v, gustKt, visKm;
    const nt = noise(x / 6, lat / 6, z * 0.7, 7) - 0.5;
    if (lv) {
      tempC = lv.t - 0.0065 * elevM;
      dewC = Math.min(tempC, lv.dew - 0.002 * elevM);
      qnh = lv.qnh;
      u = lv.u + 3 * (noise(x / 3, lat / 3, z, 4) - 0.5);
      v = lv.v + 3 * (noise(x / 3, lat / 3, z, 9) - 0.5);
      gustKt = lv.gust;
      visKm = lv.vis / 1000;
    } else {
      const day = c.dtr / 2 * Math.cos(TAU * (hour - 15) / 24) * (1 - 0.5 * cover);
      tempC = c.t - 0.0065 * elevM + day + tSys + 6 * nt - 2.5 * rain;
      const rh = clamp(c.rh + 0.25 * (cover - cc) + 0.2 * rain - 0.2 * (day / Math.max(1, c.dtr)), 0.1, 1);
      dewC = tempC - (1 - rh) * 20;
      const a2 = Math.abs(lat);
      const winterN = Math.cos(TAU * (doy - 15) / 365);
      qnh = 1013 + 7 * Math.exp(-(((a2 - 33) / 10) ** 2)) - 9 * Math.exp(-(((a2 - 62) / 9) ** 2)) -
        3 * Math.exp(-(((lat - itczOf(doy)) / 8) ** 2)) +
        12 * Math.max(0, winterN) * Math.exp(-(((lat - 50) / 12) ** 2) - ((wrapLon(lon - 100) / 25) ** 2)) +
        pSys + 8 * (noise(x / 10, lat / 10, z * 0.8, 10) - 0.5);
      prevailing(lat, lon, doy, PW);
      u = PW.u + su + 14 * (noise(x / 5, lat / 5, z * 1.5, 4) - 0.5);
      v = PW.v + sv + 14 * (noise(x / 5, lat / 5, z * 1.5, 9) - 0.5);
      gustKt = 0;
      visKm = 0;
    }
    let windKt = Math.hypot(u, v);
    if (stormKm) windKt = Math.max(windKt, 30 + 25 * stormKm);
    if (!lv) {
      windKt += 6 * rain + (storm ? 10 : 0);
      gustKt = windKt >= 15 || storm ? windKt * (1.35 + 0.2 * stormSys) : 0;
    } else if (gustKt < windKt + 8) gustKt = 0;
    const snow = rain > 0.15 && tempC <= 1;
    // fog on calm, humid mornings (radiation and sea fog); real fog codes when live
    const nf = noise(x / 1.5, lat / 1.5, z * 2, 8);
    let fog;
    if (lv) fog = (lv.code === 45 || lv.code === 48 || lv.vis < 1200) && rain < 0.15 && nf < 0.75;
    else {
      const pot = smooth(0.72, 0.95, c.rh) * (1 - smooth(14, 24, tempC));
      fog = rain === 0 && !storm && windKt < 8 && hour > 2 && hour < 10 && nf < 0.16 + 0.22 * pot;
    }
    if (!lv || !visKm) visKm = 10 + 30 * (1 - c.rh);
    if (fog) visKm = Math.min(visKm, 0.2 + 0.8 * nf);
    else if (snow) visKm = Math.min(visKm, 6 - 5 * rain);
    else if (storm) visKm = Math.min(visKm, 3 + 3 * nf);
    else if (rain > 0) visKm = Math.min(visKm, 10 - 6 * rain);
    const baseFt = fog ? 0 : Math.max(200, Math.round((tempC - dewC) * 400 / 100) * 100 + (cover > 0.9 && rain > 0.3 ? -500 : 0));
    const from = (Math.atan2(-u, -v) / DEG + 360) % 360;
    let name, icon;
    if (storm && snow) [name, icon] = ['Blizzard', '🌨'];
    else if (storm) [name, icon] = ['Thunderstorm', '⛈'];
    else if (snow) [name, icon] = ['Snow', '🌨'];
    else if (fog) [name, icon] = ['Fog', '🌫'];
    else if (rain > 0.55) [name, icon] = ['Rain', '🌧'];
    else if (rain > 0.15) [name, icon] = ['Showers', '🌦'];
    else if (cover > 0.85) [name, icon] = ['Overcast', '☁️'];
    else if (cover > 0.55) [name, icon] = ['Cloudy', '🌥'];
    else if (cover > 0.2) [name, icon] = ['Some clouds', '⛅'];
    else [name, icon] = ['Clear', hour > 6 && hour < 19 ? '☀️' : '🌙'];
    return {
      cover, rain, storm, snow, fog, tempC: Math.round(tempC), dewC: Math.round(dewC), qnh: Math.round(qnh),
      visKm: Math.round(visKm * 10) / 10, baseFt, windFrom: Math.round(from) % 360, windKt: Math.round(windKt),
      gustKt: Math.round(gustKt), u, v, cold, name, icon, live: !!lv,
    };
  }

  // Wind at a height (ft above sea level) from the surface wind w (sample's u, v): turning to the winds aloft and
  // stronger with height, the subtropical and polar jet streams up high (from FL150, all of it by FL330).
  function aloft(lat, lon, t, ctx, altFt, w) {
    const doy = ctx.doy(t);
    const x = lon - WX_DRIFT * t;
    const z = t / WX_MORPH;
    const k = smooth(2000, 12000, altFt);
    const kJet = smooth(15000, 33000, altFt);
    let u, v;
    const lv = w.live ? liveAt(lat, lon, ctx.nowMs + (t - ctx.now) * 60000) : null;
    if (lv) {
      const k7 = smooth(1500, 10000, altFt);
      u = w.u + (lv.u7 - w.u) * k7 + (lv.u25 - lv.u7) * kJet;
      v = w.v + (lv.v7 - w.v) * k7 + (lv.v25 - lv.v7) * kJet;
    } else {
      const c = Math.cos(TAU * (doy - 200) / 365); // 1 in July
      const hemi = lat >= 0 ? 1 : -1;
      const a = Math.abs(lat);
      // the westerlies aloft (easterlies in the tropics) and the jet: polar front jet meandering, subtropical jet
      const jLat = hemi > 0 ? 40 + 8 * c : 45 - 8 * c;
      const jKt = hemi > 0 ? 95 - 40 * c : 85 + 25 * c;
      const meander = 7 * (noise(x / 14, lat / 10, z * 0.6, 6) - 0.5) * 2;
      const polar = jKt * Math.exp(-(((a - jLat - meander) / 6.5) ** 2)) * (0.65 + 0.7 * noise(x / 8, lat / 8, z, 6));
      const sub = (hemi > 0 ? 55 - 30 * c : 45 + 20 * c) * Math.exp(-(((a - 28) / 4) ** 2));
      const west = 25 * smooth(20, 32, a) - 12 * (1 - smooth(10, 22, a));
      const wave = (noise(x / 12, lat / 10, z, 5) - 0.5) * 2; // north/south swings of the flow
      const ua = west * k + kJet * (polar + sub);
      const va = (Math.abs(ua) * 0.35 + 6) * wave * k;
      u = w.u * (1 - k) + ua + w.u * 0.6 * k * (1 - kJet);
      v = w.v * (1 - k) + va;
    }
    return { from: Math.round((Math.atan2(-u, -v) / DEG + 360) % 360) % 360, kt: Math.round(Math.hypot(u, v)) };
  }

  FG.wxModel = {
    mode: 'sim', WX_DRIFT, WX_MORPH, hash, noise, smooth, climate, systems, sample, aloft, prevailing,
    // live: { world, patch } grids (see above); null takes it off
    setLive(which, grid) { live[which] = grid; FG.wxModel.liveRev = (FG.wxModel.liveRev || 0) + 1; },
    get live() { return live; },
    liveRev: 0,
  };
})();
