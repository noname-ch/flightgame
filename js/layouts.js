// Real airport layouts: aprons, terminals, hangars, towers, taxiways and stands from OpenStreetMap.
// - The airports listed in FG.data.layouts have a file, js/data/layouts/<CODE>.json, made by
//   tools/build_layouts.html; it is loaded when the airport is first needed.
//   The tiles are read for them too (in each session): they add the buildings and stands the file lacks.
// - Every other airport is read off the map's vector tiles (js/osmairports.js, which registers itself with
//   setReader) the first time it is needed, and the result is kept in the browser. Where too little is
//   mapped (no apron), and until a layout is there, the game lays the airport out itself (game.js apronOf),
//   clear of the taxiways and buildings the tiles had (FG.obstacles).
// The airport fixes (js/fixes.js) are applied to every layout that arrives; with them an airport can have a
// layout where too little is mapped.
(function () {
  const have = new Set(FG.data.layouts || []);
  const loaded = {};   // code -> layout with its fixes, or null while it loads or when there is none
  const raw = {};      // code -> the layout as read (before the fixes; also when it is not usable on its own)
  FG.obstacles = FG.obstacles || {}; // code -> { lines, rings, reach }: what is in the way of a made-up apron

  // ---------- kept in the browser ----------
  const KEY = 'flightgame.osm.';         // + code: { v, t, lay } (lay null or without stands: too little is mapped)
  const INDEX = 'flightgame.osm.index';  // codes, oldest first
  const FORMAT = 3;                      // bump when the reader changes, so old results are read again
  const KEEP = 120;                      // airports kept
  const RETRY = 7 * 864e5;               // an airport without a usable layout is asked again after a week
  const usable = (lay) => !!(lay && lay.stands.length && (lay.aprons.length || lay.fixed));
  // The layout the game uses: the one read, with the fixes (if there is enough for a layout).
  function settle(code, lay) {
    raw[code] = lay;
    const out = FG.fixes ? FG.fixes.layout(code, lay) : lay;
    loaded[code] = usable(out) ? out : null;
  }
  const index = () => { try { return JSON.parse(localStorage.getItem(INDEX)) || []; } catch (e) { return []; } };
  function kept(code) {
    try {
      const k = JSON.parse(localStorage.getItem(KEY + code));
      if (k && k.v === FORMAT && (usable(k.lay) || Date.now() - k.t < RETRY)) return k;
    } catch (e) { /* not there or not readable */ }
    return null;
  }
  function keep(code, lay, obstacles) {
    const text = JSON.stringify({ v: FORMAT, t: Date.now(), lay, obstacles });
    const list = index().filter((c) => c !== code);
    list.push(code);
    for (let tries = 0; tries < 6; tries++) {
      try {
        while (list.length > KEEP) localStorage.removeItem(KEY + list.shift());
        localStorage.setItem(KEY + code, text);
        localStorage.setItem(INDEX, JSON.stringify(list));
        return;
      } catch (e) { // full: drop the oldest few and try again
        for (const c of list.splice(0, Math.min(10, list.length - 1))) localStorage.removeItem(KEY + c);
      }
    }
  }

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
      try { localStorage.removeItem(KEY + code); } catch (e) { /* not kept */ }
      delete loaded[code];
      delete raw[code];
      delete FG.obstacles[code];
      this.get(code);
      changed();
    },
  };
})();
