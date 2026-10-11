// Real airport layouts (js/data/layouts/<CODE>.json: aprons, terminals, hangars, towers, taxiways and stands
// from OpenStreetMap, made by tools/build_layouts.html) for the airports listed in FG.data.layouts.
// A layout is loaded when its airport is first needed. Until it is there, and at every other airport, the
// game lays the airport out itself (game.js apronOf).
(function () {
  const have = new Set(FG.data.layouts || []);
  const loaded = {};   // code -> layout, or null while it loads or when it could not be loaded

  FG.layouts = {
    version: 0,        // goes up whenever a layout arrives, so that caches built without it are dropped
    get(code) {
      if (!have.has(code)) return null;
      if (loaded[code] === undefined) {
        loaded[code] = null;
        fetch(`js/data/layouts/${code}.json`).then((r) => (r.ok ? r.json() : null)).then((layout) => {
          if (!layout) return;
          loaded[code] = layout;
          FG.layouts.version++;
        }).catch(() => { /* e.g. opened from file://: the airport keeps the layout the game makes */ });
      }
      return loaded[code];
    },
  };
})();
