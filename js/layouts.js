// Real airport layouts: aprons, terminals, hangars, towers, taxiways and stands from OpenStreetMap.
// - The airports listed in FG.data.layouts have a file, js/data/layouts/<CODE>.json, made by
//   tools/build_layouts.html; it is loaded when the airport is first needed.
//   The tiles are read for them too (in each session): they add the buildings and stands the file lacks.
// - Every other airport is read off the map's vector tiles (js/osmairports.js, which registers itself with
//   setReader) the first time it is needed, and the result is kept in the browser. Where too little is
//   mapped (no apron), and until a layout is there, the game lays the airport out itself (game.js apronOf),
//   clear of the taxiways and buildings the tiles had (FG.obstacles).
// In every layout that arrives, stands that lie in a building are moved out in front of it (tidy). Then the
// airport fixes (js/fixes.js) are applied; with them an airport can have a
// layout where too little is mapped.
(function () {
  const have = new Set(FG.data.layouts || []);
  const loaded = {};   // code -> layout with its fixes, or null while it loads or when there is none
  const raw = {};      // code -> the layout as read (before the fixes; also when it is not usable on its own)
  FG.obstacles = FG.obstacles || {}; // code -> { lines, rings, reach }: what is in the way of a made-up apron

  // ---------- kept in the browser (IndexedDB: js/idb.js) ----------
  const KEY = 'flightgame.osm.';         // + code: { v, t, lay, obstacles } (lay null or without stands: too little is mapped)
  const FORMAT = 4;                      // bump when the reader changes, so old results are read again
  const KEEP = 300;                      // airports kept (the oldest read go first)
  const RETRY = 7 * 864e5;               // an airport without a usable layout is asked again after a week
  const usable = (lay) => !!(lay && lay.stands.length && (lay.aprons.length || lay.fixed));
  // A stand never lies in a building (a mapped gate sits on its terminal, and stands put in front of gates or
  // in rows can end up in the next wing): it is moved out onto the apron in front of the nearest wall, nose to
  // it, or dropped
  // where there is no room there clear of the buildings and the other stands. Before the fixes, which may still
  // move it elsewhere; the stands a fix already moves or deletes (`fixed`: their spots) are left to it.
  function tidy(lay, fixed = []) {
    if (!lay || !lay.stands || !lay.stands.length) return lay;
    const M = 111320;
    const DEG = Math.PI / 180;
    const buildings = [...(lay.terminals || []), ...(lay.hangars || []), ...(lay.others || [])].filter((r) => r.length > 2);
    if (!buildings.length) return lay;
    const boxes = buildings.map((r) => [Math.min(...r.map((p) => p[0])), Math.max(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[1]))]);
    const inRing = (p, r) => {
      let inside = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i], b = r[j];
        if ((a[0] > p[0]) !== (b[0] > p[0]) && p[1] < ((b[1] - a[1]) * (p[0] - a[0])) / (b[0] - a[0]) + a[1]) inside = !inside;
      }
      return inside;
    };
    const aprons = (lay.aprons || []).filter((r) => r.length > 2);
    const paved = (p) => !aprons.length || aprons.some((r) => inRing(p, r));
    const built = (p) => buildings.some((r, i) => p[0] >= boxes[i][0] && p[0] <= boxes[i][1] && p[1] >= boxes[i][2] && p[1] <= boxes[i][3] && inRing(p, r));
    const move = (p, hdg, m) => [p[0] + (m * Math.cos(hdg * DEG)) / M, p[1] + (m * Math.sin(hdg * DEG)) / (M * Math.cos(p[0] * DEG))];
    const apart = (p, q) => Math.hypot((q[1] - p[1]) * M * Math.cos(p[0] * DEG), (q[0] - p[0]) * M);
    const r5 = (n) => Math.round(n * 1e5) / 1e5;
    const at = lay.stands.map((s) => [s[0], s[1]]);
    const wrong = at.map((p) => built(p) && !fixed.some((f) => apart(p, f) < 6));
    if (!wrong.some(Boolean)) return lay;
    const stands = [];
    lay.stands.forEach((s, i) => {
      if (!wrong[i]) { stands.push(s); return; }
      // The nearest way out (looked for every 15 degrees) that ends on an apron, clear of the buildings and
      // the other stands: the stand point 18 m from the wall (the nose stops 14 m ahead of it), with open
      // ground behind it. Not out to the land side (a car park, a road).
      let out = null;
      for (let hdg = 0; hdg < 360; hdg += 15) {
        for (let m = 5; m <= 150 && (!out || m < out.m); m += 5) {
          if (built(move(at[i], hdg, m))) continue;
          const q = move(at[i], hdg, m + 18);
          if (!built(q) && !built(move(at[i], hdg, m + 40)) && paved(q) && at.every((o, j) => j === i || !o || apart(q, o) > 30)) out = { m, hdg, q };
          break;
        }
      }
      if (out) {
        at[i] = out.q;
        stands.push([r5(out.q[0]), r5(out.q[1]), (out.hdg + 180) % 360, ...s.slice(3)]);
      } else at[i] = null;
    });
    return Object.assign({}, lay, { stands });
  }
  // The layout the game uses: the one read, with the fixes (if there is enough for a layout).
  function settle(code, lay) {
    const ops = FG.fixes ? FG.fixes.all(code).filter((o) => o.kind === 'stand' && o.op !== 'add') : [];
    raw[code] = lay = tidy(lay, ops.map((o) => (o.op === 'set' ? o.from : o.geom)));
    const out = FG.fixes ? FG.fixes.layout(code, lay) : lay;
    loaded[code] = usable(out) ? out : null;
  }
  // All kept airports are read into `store` once at the start; until then an airport asked for waits in
  // `early` (it counts as pending, so the maps don't draw a made-up layout meanwhile).
  const store = {};          // code -> { v, t, lay, obstacles }
  const early = [];          // codes asked for before the store was read
  const forgot = new Set();  // codes reloaded before the store was read
  let ready = false;
  function kept(code) {
    const k = store[code];
    return k && k.v === FORMAT && (usable(k.lay) || Date.now() - k.t < RETRY) ? k : null;
  }
  function keep(code, lay, obstacles) {
    store[code] = { v: FORMAT, t: Date.now(), lay, obstacles };
    FG.idb.set(KEY + code, store[code]);
    const codes = Object.keys(store);
    if (codes.length <= KEEP) return;
    codes.sort((a, b) => store[a].t - store[b].t);
    for (const c of codes.slice(0, codes.length - KEEP)) {
      delete store[c];
      FG.idb.del(KEY + c);
    }
  }
  // Older versions kept the layouts in localStorage, where they could fill it up and stop the game from
  // being saved: move them over once.
  const oldIndex = `${KEY}index`;
  try { localStorage.removeItem(oldIndex); } catch (e) { /* no access */ }
  FG.idb.adopt(FG.idb.localKeys(KEY)).then(() => FG.idb.all(KEY)).then((entries) => {
    for (const [key, k] of Object.entries(entries)) {
      const code = key.slice(KEY.length);
      if (k && k.v && !forgot.has(code) && !store[code]) store[code] = k;
    }
    ready = true;
    for (const code of early.splice(0)) {
      waiting.delete(code);
      delete loaded[code];
      FG.layouts.get(code);
      if (!waiting.has(code)) { // it was kept
        changed();
        done(code);
      }
    }
  });

  // ---------- reading the tiles, newest wish first, two airports at a time ----------
  const queue = [];          // [code, layout file or undefined]
  const waiting = new Set(); // codes being looked up: their file is loading, or they are queued or being read
  let busy = 0;
  const changed = () => {
    FG.layouts.version++; // caches built without it are dropped
    if (FG.game) FG.game.dirty = true;
  };
  function arrive(code, lay) {
    settle(code, lay);
    if (loaded[code]) changed();
  }
  function pump() {
    const read = FG.layouts.reader;
    while (read && busy < 2 && queue.length) {
      const [code, base] = queue.pop();
      busy++;
      read(code, base).then((lay) => {
        if (base) { if (lay) arrive(code, lay); return; } // (a file's airport: read again next session)
        const ok = usable(lay);
        const obs = !ok && lay ? lay.obstacles : null;
        if (lay) delete lay.obstacles;
        // (kept also when too little is mapped: the fixes may make a layout of it)
        keep(code, lay, obs);
        if (obs) { FG.obstacles[code] = obs; changed(); }
        arrive(code, lay);
      }).catch(() => { /* offline or the tiles failed: the file or the game's own layout this time */ })
        .finally(() => { busy--; done(code); pump(); });
    }
  }
  // A lookup is over: the maps draw the airport now, real layout or not.
  function done(code) {
    waiting.delete(code);
    FG.layouts.looked++;
    if (FG.game) FG.game.dirty = true;
  }
  const lookUp = (code, base) => {
    queue.push([code, base]);
    waiting.add(code);
    pump();
  };
  const started = Date.now();

  FG.layouts = {
    version: 0,        // goes up whenever a layout arrives, so that caches built without it are dropped
    looked: 0,         // goes up whenever a lookup is over (the maps redraw: see pending)
    reader: null,
    // A real layout for this airport is there (now).
    has(code) { return !!loaded[code]; },
    get(code) {
      if (loaded[code] !== undefined) return loaded[code];
      loaded[code] = null;
      if (have.has(code)) {
        waiting.add(code);
        fetch(`js/data/layouts/${code}.json`).then((r) => (r.ok ? r.json() : null)).then((layout) => {
          arrive(code, layout);
          if (layout) lookUp(code, layout); else done(code);
        }).catch(() => { done(code); /* e.g. opened from file://: the airport keeps the layout the game makes */ });
        return null;
      }
      if (!ready) {
        waiting.add(code);
        early.push(code);
        return null;
      }
      const k = kept(code);
      if (k) {
        if (k.obstacles) FG.obstacles[code] = k.obstacles;
        settle(code, k.lay);
        return loaded[code];
      }
      lookUp(code);
      return null;
    },
    // The lookup for this airport is over (with or without a layout).
    settled(code) { return loaded[code] !== undefined && !waiting.has(code); },
    // Its real layout may still come (the maps leave out the one the game makes up meanwhile). Not when the
    // tile reader didn't load (offline): the made-up one is all there will be.
    pending(code) { return waiting.has(code) && (!!this.reader || Date.now() - started < 15000); },
    // js/osmairports.js: fn(code) -> Promise of a layout (or null) read off the vector tiles.
    setReader(fn) { this.reader = fn; pump(); },
    // The layout as read, before the fixes (undefined: not read yet).
    raw(code) { return raw[code]; },
    // The airport's fixes changed (js/fixes.js): its layout again from the one read.
    refix(code) {
      if (!(code in raw)) return;
      settle(code, raw[code]);
      changed();
    },
    // Read the airport again (its runways changed: the tiles are read round them, the runways are links).
    reload(code) {
      if (waiting.has(code)) return;
      delete store[code];
      if (!ready) forgot.add(code);
      FG.idb.del(KEY + code);
      delete loaded[code];
      delete raw[code];
      delete FG.obstacles[code];
      this.get(code);
      changed();
    },
  };
})();
