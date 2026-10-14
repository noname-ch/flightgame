// Ground heights for the flight planner (js/game.js): flights climb over the mountains instead of through them.
// Heights come from the same terrain tiles the 3D view draws (Mapterhorn, terrarium encoding), read at a
// medium zoom (~200 m a pixel in the Alps) and kept as metres in an Int16Array per tile.
// FG.ground.at(lat, lon) answers at once: metres, or null while the tile is still loading (it then asks for
// it, and FG.ground.onChange listeners are told when it has arrived). Tiles that can't be loaded count as sea
// level, so an offline game still flies.
(function () {
  const URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
  const Z = 8;
  const SIZE = 512;
  const KEEP = 120;              // tiles kept (0.5 MB each)
  const tiles = new Map();       // "x/y" -> Int16Array, or null while loading
  const listeners = [];
  let notify = null;

  function load(x, y) {
    const key = `${x}/${y}`;
    tiles.set(key, null);
    fetch(URL.replace('{z}', Z).replace('{x}', x).replace('{y}', y))
      .then((r) => { if (!r.ok) throw new Error(`terrain tile ${r.status}`); return r.blob(); })
      .then((blob) => createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
      .then((img) => {
        const c = document.createElement('canvas');
        c.width = c.height = SIZE;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
        const h = new Int16Array(SIZE * SIZE);
        for (let i = 0; i < h.length; i++) h[i] = Math.max(-500, Math.round(d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768));
        return h;
      })
      .catch(() => new Int16Array(SIZE * SIZE)) // (no tile: sea level)
      .then((h) => {
        tiles.delete(key); // (to the end: most recently used)
        tiles.set(key, h);
        while (tiles.size > KEEP) tiles.delete(tiles.keys().next().value);
        // Several tiles usually arrive together: tell the listeners once.
        if (!notify) notify = setTimeout(() => { notify = null; for (const f of listeners) f(); }, 200);
      });
  }

  // Tile and pixel of a point.
  function where(lat, lon) {
    const n = 2 ** Z;
    const x = ((lon + 180) / 360) * n;
    const s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    const tx = ((Math.floor(x) % n) + n) % n;
    const ty = Math.max(0, Math.min(n - 1, Math.floor(y)));
    return { tx, ty, px: Math.min(SIZE - 1, Math.floor((x - Math.floor(x)) * SIZE)), py: Math.min(SIZE - 1, Math.floor((y - Math.floor(y)) * SIZE)) };
  }

  function at(lat, lon) {
    const w = where(lat, lon);
    const key = `${w.tx}/${w.ty}`;
    if (!tiles.has(key)) load(w.tx, w.ty);
    const h = tiles.get(key);
    return h ? h[w.py * SIZE + w.px] : null;
  }

  // Highest ground within about `m` metres of a point (the pixel and its neighbours), or null while loading.
  function maxNear(lat, lon, m = 300) {
    const dLat = m / 111320;
    const dLon = m / (111320 * Math.max(0.05, Math.cos(lat * Math.PI / 180)));
    let top = -Infinity;
    for (const [a, b] of [[0, 0], [dLat, 0], [-dLat, 0], [0, dLon], [0, -dLon]]) {
      const h = at(lat + a, lon + b);
      if (h === null) return null;
      top = Math.max(top, h);
    }
    return top;
  }

  FG.ground = {
    at, maxNear,
    onChange(f) { listeners.push(f); },
  };
})();
