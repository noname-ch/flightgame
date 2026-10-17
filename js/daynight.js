// Day and night on the 2D map: where the sun has set the map darkens (dusk in between), drawn from game.js
// G.sunAt for the game time, so the night moves west over the map as the hours go by. Settings → On the map →
// "Day and night" turns it off, in 3D too (FG.daynight.enabled(); js/view3d.js draws its own night).
(function () {
  const G = FG.game;
  const st = { layer: null, drawnT: null };
  const CELL = 8; // pixels per sun reading: the night's edge is soft anyway

  // A Leaflet renderer as js/weather.js's clouds: placed, padded and zoom-animated by Leaflet, under the towns,
  // routes, airports and planes (pane 'night'), so the game stays easy to read at night.
  function layer2d() {
    const Night = L.Renderer.extend({
      options: { padding: 0.25, pane: 'night' },
      _initContainer() { this._container = L.DomUtil.create('canvas', 'fg-night'); },
      _destroyContainer() { L.DomUtil.remove(this._container); delete this._container; },
      _update() {
        if (this._map._animatingZoom && this._bounds) return;
        L.Renderer.prototype._update.call(this);
        const b = this._bounds;
        const size = b.getSize();
        const c = this._container;
        L.DomUtil.setPosition(c, b.min);
        c.width = Math.max(1, Math.ceil(size.x / CELL));
        c.height = Math.max(1, Math.ceil(size.y / CELL));
        c.style.width = `${size.x}px`;
        c.style.height = `${size.y}px`;
        draw(this);
      },
    });
    st.layer = new Night();
    return st.layer;
  }

  function draw(layer) {
    const map = layer._map;
    const c = layer._container;
    if (!map || !c || !layer._bounds || !G.state) return;
    const t = FG.ui && FG.ui.time != null ? FG.ui.time : G.state.time;
    st.drawnT = t;
    const g = c.getContext('2d');
    const img = g.createImageData(c.width, c.height);
    const d = img.data;
    const b = layer._bounds;
    const sp = G.sunPoint(t);
    const R = Math.PI / 180;
    const sinD = Math.sin(sp.lat * R), cosD = Math.cos(sp.lat * R);
    // (latitude by row and longitude by column: the map is Mercator, north up)
    const lats = [], lons = [];
    for (let y = 0; y < c.height; y++) lats.push(map.layerPointToLatLng([b.min.x, b.min.y + (y + 0.5) * CELL]).lat * R);
    for (let x = 0; x < c.width; x++) lons.push(map.layerPointToLatLng([b.min.x + (x + 0.5) * CELL, b.min.y]).lng);
    const cosH = lons.map((lon) => Math.cos((lon - sp.lon) * R));
    for (let y = 0, i = 0; y < c.height; y++) {
      const sf = Math.sin(lats[y]) * sinD, cf = Math.cos(lats[y]) * cosD;
      for (let x = 0; x < c.width; x++, i += 4) {
        const elev = Math.asin(Math.max(-1, Math.min(1, sf + cf * cosH[x]))) / R;
        // dark blue at night (a little sooner than full darkness), an orange glow along the edge at dusk
        const dark = Math.min(1, Math.max(0, (2 - elev) / 12));
        const dusk = Math.max(0, 1 - Math.abs(elev + 1) / 5);
        const a = dark * 0.62 + dusk * 0.07;
        d[i] = 6 + 220 * dusk * (1 - dark);
        d[i + 1] = 12 + 90 * dusk * (1 - dark);
        d[i + 2] = 40;
        d[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
  }

  function enabled() {
    return !!(st.layer && FG.ui && FG.ui.map && FG.ui.map.hasLayer(st.layer));
  }

  // Once a second: the night moves on with the game clock (a sun reading a game minute: a quarter degree).
  setInterval(() => {
    if (document.hidden || !G.state || !st.layer || !st.layer._map || (FG.view3d && FG.view3d.on)) return;
    const t = FG.ui && FG.ui.time != null ? FG.ui.time : G.state.time;
    if (st.drawnT == null || Math.abs(t - st.drawnT) >= 1) draw(st.layer);
  }, 1000);

  FG.daynight = { layer2d, enabled, redraw() { if (st.layer && st.layer._map) draw(st.layer); } };
})();
