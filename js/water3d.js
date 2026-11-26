// Water in the 3D view: made by itself from OpenStreetMap's water areas (the map's own vector tiles, source
// 'openmaptiles', layer 'water'), drawn over the satellite picture as moving water lit by the sun: waves, the sun's
// glint, the sky mirrored in it (more the flatter it is looked at) and the colour of the water body, each kind its
// own look (the sea's long swell and chop, a lake's small ripples, a river's choppy ripples, a swimming pool's
// turquoise calm). The Rust app draws the same water (lianhirter-arch/flightgame-rust: src/water.rs, src/shaders/ground.wesl).
//
// Per vector tile in view (zoom 10 to 14, the nearest TILES_MAX): a mask picture of its water (red the sea, green
// lakes, blue rivers, green and blue a swimming pool; nonzero fill, so holes are islands), and a grid over the tile
// at the ground's height (`heightsAt`: the heights the terrain is drawn with), the sea at 0 m. The shader shows
// water where the mask says so. Made by view3d.js: `waterLayer(id, deps)`, a MapLibre custom layer drawn with the
// planes' three.js renderer, before the runway lights.
import * as THREE from 'three';

const TILES_MAX = 24;
const MIN_ZOOM = 10;   // (further out the satellite picture's own water is enough)
const GRID = 24;       // cells a side of a tile's grid
const PERIOD = 4096;   // the waves repeat every so many metres (their wave numbers are multiples of 2π / PERIOD)
const EARTH_CIRC = 40075016.686;
const DEG = Math.PI / 180;
const STILL = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; // (phones: still water, no 60 fps)

const VS = `
attribute vec3 aUp; attribute vec3 aEast; attribute vec2 aM;
uniform float uM; uniform vec3 uCam;
varying vec2 vUv; varying vec2 vM; varying vec3 vUp; varying vec3 vEast; varying vec3 vView; varying float vDist;
void main() {
  vec3 toCam = uCam - position;
  float dist = length(toCam) / uM;
  // (lifted a little off the ground, more far off, so the terrain under it never shows through in stripes)
  vec3 p = position + aUp * uM * (0.6 + dist * 0.0012);
  vUv = uv; vM = aM; vUp = aUp; vEast = aEast; vView = toCam; vDist = dist;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FS = `
uniform sampler2D uMask;
uniform float uTime; uniform vec2 uOff; uniform float uWind; uniform float uWindDir;
uniform vec2 uSun; uniform vec3 uSunCol; uniform float uLight;
uniform vec3 uSkyTop; uniform vec3 uSkyHz; uniform vec3 uFog;
varying vec2 vUv; varying vec2 vM; varying vec3 vUp; varying vec3 vEast; varying vec3 vView; varying float vDist;
const float PERIOD = ${PERIOD.toFixed(1)};
const float TAU = 6.2831853;
vec2 wave(vec2 p, float ang, float len, float amp, float t, float fw) {
  float fade = 1.0 - smoothstep(0.12, 0.5, fw / len);
  if (fade <= 0.0) return vec2(0.0);
  vec2 k = floor(vec2(cos(ang), sin(ang)) * (PERIOD / len) + 0.5) * (TAU / PERIOD);
  float kl = length(k);
  float ph = dot(p, k) - t * sqrt(9.81 * kl);
  return (k / kl) * (amp * cos(ph) * fade);
}
// how strong the waves are here (0.35..1.65): two slow swells of strength crossing (else they lie in even stripes)
float group(vec2 p, float ang, float len, float t) {
  vec2 k1 = floor(vec2(cos(ang), sin(ang)) * (PERIOD / len) + 0.5) * (TAU / PERIOD);
  vec2 k2 = floor(vec2(cos(ang + 1.9), sin(ang + 1.9)) * (PERIOD / (len * 0.77)) + 0.5) * (TAU / PERIOD);
  return 1.0 + 0.4 * sin(dot(p, k1) - t * 0.11) + 0.25 * sin(dot(p, k2) + t * 0.07);
}
vec2 sea(vec2 p, float t, float fw, float wd, float a, float g1, float g2) {
  return wave(p, wd, 96.0, 0.05 * a * g1, t, fw) + wave(p, wd + 0.45, 41.0, 0.05 * a * g2, t, fw) + wave(p, wd - 0.6, 19.0, 0.05 * a * g1, t, fw)
    + wave(p, wd + 1.05, 8.3, 0.045 * a * g2, t, fw) + wave(p, wd - 0.95, 3.7, 0.04 * a * g1, t, fw) + wave(p, wd + 1.7, 2.6, 0.03 * a * g2, t, fw)
    + wave(p, wd + 0.3, 1.7, 0.035 * a, t, fw) + wave(p, wd - 1.5, 1.2, 0.03 * a * g1, t, fw) + wave(p, wd - 0.25, 0.8, 0.03 * a * g2, t, fw);
}
vec2 lake(vec2 p, float t, float fw, float wd, float a, float g1, float g2) {
  return wave(p, wd, 9.0, 0.03 * a * g1, t, fw) + wave(p, wd + 0.7, 4.3, 0.03 * a * g2, t, fw) + wave(p, wd - 0.8, 2.1, 0.028 * a * g1, t, fw)
    + wave(p, wd + 1.9, 1.5, 0.022 * a * g2, t, fw) + wave(p, wd + 1.4, 1.03, 0.025 * a, t, fw) + wave(p, wd - 0.35, 0.52, 0.02 * a * g1, t, fw);
}
vec2 river(vec2 p, float t, float fw, float wd) {
  return wave(p, wd, 5.1, 0.035, t * 1.6, fw) + wave(p, wd + 2.1, 2.3, 0.035, t * 1.8, fw) + wave(p, wd - 1.9, 1.1, 0.03, t * 2.0, fw)
    + wave(p, wd + 3.6, 0.55, 0.025, t * 2.0, fw);
}
vec2 pool(vec2 p, float t, float fw, float wd) {
  return wave(p, wd, 1.6, 0.012, t, fw) + wave(p, wd + 2.4, 0.7, 0.01, t, fw) + wave(p, wd - 2.0, 0.33, 0.008, t, fw);
}
void main() {
  vec4 m = texture2D(uMask, vUv);
  float pl = min(m.g, m.b);
  vec4 sh = vec4(m.r, m.g - pl, m.b - pl, pl);
  float sum = sh.x + sh.y + sh.z + sh.w;
  float wet = clamp(sum, 0.0, 1.0);
  if (wet < 0.02) discard;
  sh /= max(sum, 1e-4);
  vec2 p = vM + uOff;
  float fw = max(length(fwidth(vM)), 1e-3);
  float t = uTime;
  vec2 s = vec2(0.0);
  float g1 = group(p, uWindDir + 0.3, 610.0, t), g2 = group(p, uWindDir - 1.2, 370.0, t);
  if (sh.x > 0.01) s += sh.x * sea(p, t, fw, uWindDir, 0.6 + 0.8 * uWind, g1, g2);
  if (sh.y > 0.01) s += sh.y * lake(p, t, fw, uWindDir, 0.5 + 0.7 * uWind, g1, g2);
  if (sh.z > 0.01) s += sh.z * river(p, t, fw, uWindDir);
  if (sh.w > 0.01) s += sh.w * pool(p, t, fw, uWindDir);
  vec3 up = normalize(vUp);
  vec3 east = normalize(vEast - up * dot(vEast, up));
  vec3 north = cross(up, east);
  vec3 N = normalize(up - s.x * east - s.y * north);
  vec3 V = normalize(vView);
  // the water body: deep blue sea, green lakes, murky rivers, a pool's turquoise (display colours)
  vec3 body = sh.x * vec3(0.03, 0.12, 0.19) + sh.y * vec3(0.05, 0.15, 0.15) + sh.z * vec3(0.12, 0.16, 0.12) + sh.w * vec3(0.18, 0.55, 0.62);
  vec3 L = up * sin(uSun.x) + east * sin(uSun.y) * cos(uSun.x) + north * cos(uSun.y) * cos(uSun.x);
  float sunUp = smoothstep(-0.02, 0.06, sin(uSun.x));
  float lit = 0.25 + 0.75 * uLight;
  vec3 col = body * (0.35 + 0.65 * max(dot(N, L), 0.0) * sunUp) * lit;
  // the sky in it (Schlick's Fresnel; no sky below the horizon: the next wave's water instead)
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  float ru = dot(R, up);
  vec3 sky = mix(uSkyHz, uSkyTop, sqrt(clamp(ru, 0.0, 1.0)));
  sky = mix(sky, body * 0.6, smoothstep(0.0, -0.05, ru));
  col = mix(col, sky, fres);
  // the sun's glint: sharp close by, a wide glitter path far off or from high up (the waves too small to see)
  float far = smoothstep(0.3, 25.0, fw);
  float rough = mix(0.07, sh.x * (0.22 + 0.1 * uWind) + sh.y * 0.16 + sh.z * 0.2 + sh.w * 0.08, far);
  float a2 = rough * rough * rough * rough;
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float ggx = a2 / (3.14159 * d * d);
  float fh = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  col += uSunCol * min(ggx * fh * 0.25 * max(dot(N, L), 0.0), 12.0) * sunUp;
  // haze far off, as the map's own
  col = mix(col, uFog, 1.0 - exp(-vDist / 70000.0));
  float alpha = wet * mix(0.78, 0.97, fres) * (sh.w > 0.5 ? 0.85 : 1.0);
  gl_FragColor = vec4(col, alpha);
}`;

// The tile x, y of zoom z (fractions allowed) as lat, lon.
function corner(z, x, y) {
  const n = 2 ** z;
  return [Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) / DEG, x / n * 360 - 180];
}
// A water area's kind: 0 sea, 1 lake, 2 river, 3 swimming pool (OpenMapTiles' classes).
function kindOf(f) {
  const c = f.properties && f.properties.class;
  return c === 'ocean' || c === 'dock' ? 0 : c === 'river' ? 2 : c === 'swimming_pool' ? 3 : 1;
}
const FILL = ['rgb(255,0,0)', 'rgb(0,255,0)', 'rgb(0,0,255)', 'rgb(0,255,255)'];

// A tile's water mask: its features' rings filled into a canvas (the tile's square, rows from the north).
function maskOf(feats, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  let any = false;
  for (const f of feats) {
    const vt = f._vectorTileFeature;
    if (!vt || vt.type !== 3) continue;
    const k = size / (vt.extent || 4096);
    g.beginPath();
    for (const ring of vt.loadGeometry()) {
      ring.forEach((pt, i) => (i ? g.lineTo(pt.x * k, pt.y * k) : g.moveTo(pt.x * k, pt.y * k)));
      g.closePath();
    }
    g.fillStyle = FILL[kindOf(f)];
    g.fill('nonzero');
    any = true;
  }
  return any ? c : null;
}

export function waterLayer(id, o) {
  const st = { tiles: new Map(), at: 0, busy: 0 };
  return {
    id,
    type: 'custom',
    renderingMode: '3d',
    st, // (for debugging and the smoke test: FG.view3d.water.st)
    onAdd(map) {
      this.map = map;
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();
      this.world = new THREE.Group();
      this.scene.add(this.world);
      this.matrix = new THREE.Matrix4();
      this.inv = new THREE.Matrix4();
      this.shift = new THREE.Matrix4();
      this.v4 = new THREE.Vector4();
      this.cam = new THREE.Vector3();
      this.mat = new THREE.ShaderMaterial({
        uniforms: {
          uM: { value: 1 }, uCam: { value: new THREE.Vector3() }, uMask: { value: null }, uTime: { value: 0 }, uOff: { value: new THREE.Vector2() },
          uWind: { value: 0.3 }, uWindDir: { value: 0 }, uSun: { value: new THREE.Vector2(0.8, 3.5) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
          uLight: { value: 1 }, uSkyTop: { value: new THREE.Color() }, uSkyHz: { value: new THREE.Color() }, uFog: { value: new THREE.Color() },
        },
        vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: true,
        extensions: { derivatives: true },
      });
    },
    onRemove() {
      for (const e of st.tiles.values()) this.drop(e);
      st.tiles.clear();
      if (this.mat) this.mat.dispose();
    },
    drop(e) {
      if (e.mesh) { this.world.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); }
      if (e.tex) e.tex.dispose();
    },
    render(gl, args) {
      const map = this.map;
      const renderer = o.rendererOf();
      if (!renderer || !o.isOn(map)) return;
      const now = performance.now();
      const zoom = map.getZoom();
      if (now - st.at > 700) { st.at = now; this.pick(map, zoom); }
      if (zoom < MIN_ZOOM - 0.5 || !st.tiles.size) return;
      const pd = args.defaultProjectionData;
      const globe = map.getProjection().type === 'globe' && pd.projectionTransition >= 0.5;
      this.matrix.fromArray(globe ? pd.mainMatrix : pd.fallbackMatrix);
      this.camera.projectionMatrix.copy(this.matrix);
      this.v4.set(0, 0, 1, 0).applyMatrix4(this.inv.copy(this.matrix).invert());
      this.cam.set(this.v4.x / this.v4.w, this.v4.y / this.v4.w, this.v4.z / this.v4.w);
      const center = map.getCenter();
      o.setLonRef(center.lng);
      o.frameAt(center.lat, center.lng, 0, globe);
      this.world.position.copy(o.tmp.pos).negate();
      this.camera.projectionMatrix.multiply(this.shift.makeTranslation(o.tmp.pos.x, o.tmp.pos.y, o.tmp.pos.z));
      // the light, sky and wind at the view centre (a few times a second)
      if (now - (st.skyAt || 0) > 400) {
        st.skyAt = now;
        const t = o.time();
        const sun = o.lightAt(center.lat, center.lng, t);
        const wx = o.weatherOn() ? o.weatherAt(center.lat, center.lng, t) : null;
        const sky = o.skyOf(wx, sun);
        st.sky = { sun, top: sky['sky-color'], hz: sky['horizon-color'], fog: sky['fog-color'],
          wind: wx ? Math.min(1, (wx.windKt || 0) / 35) : 0.3, windFrom: wx && wx.windFrom != null ? wx.windFrom : 250 };
      }
      const sk = st.sky;
      let shown = 0;
      for (const e of st.tiles.values()) {
        if (!e.ready) continue;
        if (!e.mesh || e.globe !== globe || Math.abs(e.lon - center.lng) > 180) this.build(e, globe);
        shown++;
        const u = e.mesh.material.uniforms;
        u.uCam.value.copy(this.cam).sub(e.origin);
        u.uTime.value = STILL ? 0 : (now / 1000) % 3600;
        u.uSun.value.set(sk.sun.elev * DEG, sk.sun.az * DEG);
        u.uSunCol.value.set(sk.sun.elev < 15 ? '#ffc27a' : '#fff6e8');
        u.uLight.value = sk.sun.light;
        u.uSkyTop.value.set(sk.top);
        u.uSkyHz.value.set(sk.hz);
        u.uFog.value.set(sk.fog);
        u.uWind.value = sk.wind;
        // (where it blows to, as an angle from east towards north)
        const to = (sk.windFrom + 180) * DEG;
        u.uWindDir.value = Math.atan2(Math.cos(to), Math.sin(to));
      }
      if (!shown) return;
      renderer.resetState();
      renderer.render(this.scene, this.camera);
      o.restoreGl(renderer, map);
      if (!STILL) map.triggerRepaint(); // (the waves move)
    },
    // The tiles in view with water: masks made at once, the heights asked for a few tiles at a time.
    pick(map, zoom) {
      const want = new Map();
      if (zoom >= MIN_ZOOM - 0.5 && map.getSource('openmaptiles')) {
        let feats = [];
        try { feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'water' }); } catch (err) { feats = []; }
        for (const f of feats) {
          if (f._z == null || f._z < MIN_ZOOM) continue;
          const key = `${f._z}/${f._x}/${f._y}`;
          let w = want.get(key);
          if (!w) want.set(key, (w = { z: f._z, x: f._x, y: f._y, feats: [] }));
          w.feats.push(f);
        }
      }
      // the nearest to the view centre
      const c = map.getCenter();
      const near = [...want.entries()].map(([key, w]) => {
        const [lat, lon] = corner(w.z, w.x + 0.5, w.y + 0.5);
        return { key, w, d: Math.hypot(lat - c.lat, (((lon - c.lng + 540) % 360) - 180) * Math.cos(c.lat * DEG)) };
      }).sort((a, b) => a.d - b.d).slice(0, TILES_MAX);
      const keep = new Set(near.map((n) => n.key));
      for (const [key, e] of st.tiles) {
        if (!keep.has(key)) { this.drop(e); st.tiles.delete(key); }
      }
      for (const { key, w } of near) {
        let e = st.tiles.get(key);
        if (!e) {
          const mask = maskOf(w.feats, w.z >= 13 ? 1024 : 512);
          e = { key, z: w.z, x: w.x, y: w.y, mask, ready: false };
          st.tiles.set(key, e);
          if (!mask) continue;
        }
        if (!e.mask || e.ready || e.asked || st.busy >= 2) continue;
        e.asked = true;
        st.busy++;
        this.heights(e).then(() => { e.ready = true; map.triggerRepaint(); }, () => { e.asked = false; }).finally(() => { st.busy--; });
      }
    },
    // The grid's heights (m above the sea): the ground as drawn; the sea at 0; a shore vertex on land takes its
    // water neighbour's height (else the water would climb a cliff between them).
    async heights(e) {
      const n = GRID + 1;
      const pts = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push(corner(e.z, e.x + i / GRID, e.y + j / GRID));
      const h = await o.heightsAt(pts);
      const size = e.mask.width;
      const px = e.mask.getContext('2d').getImageData(0, 0, size, size).data;
      const at = (i, j) => {
        const k = (Math.min(size - 1, Math.round(j / GRID * (size - 1))) * size + Math.min(size - 1, Math.round(i / GRID * (size - 1)))) * 4;
        return [px[k], px[k + 1], px[k + 2]];
      };
      const water = new Array(n * n);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const [r, g, b] = at(i, j);
          const q = j * n + i;
          if (r > 128) h[q] = 0;
          water[q] = r > 128 || g > 128 || b > 128;
        }
      }
      const out = h.slice();
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const q = j * n + i;
          if (water[q]) continue;
          let lo = Infinity;
          for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
            const a = i + di, b = j + dj;
            if (a < 0 || b < 0 || a >= n || b >= n || !water[b * n + a]) continue;
            lo = Math.min(lo, h[b * n + a]);
          }
          if (lo < Infinity) out[q] = Math.min(out[q], lo);
        }
      }
      e.h = out;
    },
    // The tile's mesh: its grid in the world's frame (flat or the globe), relative to the tile's middle.
    build(e, globe) {
      if (e.mesh) { this.world.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); }
      const n = GRID + 1;
      const [clat, clon] = corner(e.z, e.x + 0.5, e.y + 0.5);
      const unit = o.frameAt(clat, clon, 0, globe);
      const origin = o.tmp.pos.clone();
      const pos = new Float32Array(n * n * 3), up = new Float32Array(n * n * 3), east = new Float32Array(n * n * 3);
      const uv = new Float32Array(n * n * 2), m = new Float32Array(n * n * 2);
      // the waves' metres: web mercator metres from the tile's north-west corner (y north), and that corner's
      // place modulo PERIOD (so neighbouring tiles' waves meet)
      const tileM = EARTH_CIRC / 2 ** e.z;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const q = j * n + i;
          const [lat, lon] = corner(e.z, e.x + i / GRID, e.y + j / GRID);
          o.frameAt(lat, lon, e.h[q] * o.exag, globe);
          pos[q * 3] = o.tmp.pos.x - origin.x; pos[q * 3 + 1] = o.tmp.pos.y - origin.y; pos[q * 3 + 2] = o.tmp.pos.z - origin.z;
          up.set([o.tmp.up.x, o.tmp.up.y, o.tmp.up.z], q * 3);
          east.set([o.tmp.east.x, o.tmp.east.y, o.tmp.east.z], q * 3);
          uv[q * 2] = i / GRID; uv[q * 2 + 1] = j / GRID;
          m[q * 2] = i / GRID * tileM; m[q * 2 + 1] = -j / GRID * tileM;
        }
      }
      const idx = [];
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aUp', new THREE.BufferAttribute(up, 3));
      g.setAttribute('aEast', new THREE.BufferAttribute(east, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('aM', new THREE.BufferAttribute(m, 2));
      g.setIndex(idx);
      if (!e.tex) {
        e.tex = new THREE.CanvasTexture(e.mask);
        e.tex.flipY = false;
        e.tex.colorSpace = THREE.NoColorSpace;
        e.tex.anisotropy = 4;
        e.tex.minFilter = THREE.LinearMipmapLinearFilter;
      }
      const mat = this.mat.clone();
      mat.uniforms.uMask.value = e.tex;
      mat.uniforms.uM.value = unit;
      const nwX = e.x * tileM, nwY = e.y * tileM;
      mat.uniforms.uOff.value.set(((nwX % PERIOD) + PERIOD) % PERIOD, ((-nwY % PERIOD) + PERIOD) % PERIOD);
      e.mesh = new THREE.Mesh(g, mat);
      e.mesh.position.copy(origin);
      e.mesh.frustumCulled = false;
      e.mesh.renderOrder = -1;
      e.origin = origin;
      e.globe = globe;
      e.lon = clon;
      this.world.add(e.mesh);
    },
  };
}
