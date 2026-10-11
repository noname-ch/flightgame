// 3D view: MapLibre globe with terrain and 3D buildings, aircraft drawn with three.js.
// Toggled with the "3D" button (or V). Reads the game state directly; selection goes through FG.ui.
// The aircraft are glTF models from models/ (see js/data/models.js); types without one use the placeholder.
import * as maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const G = FG.game;
const D = FG.data;

const PREF_KEY = 'flightgame.view3d';
const EARTH_R = 6371008.8;
const EARTH_CIRC = 40075016.686;
const PLANE_PX = 48;            // on-screen length of an aircraft when zoomed out
const COLORS = { own: '#007aff', other: '#8e8e93', home: '#34c759', selected: '#ff9500', route: '#007aff', ferry: '#af52de' };

const v = {
  on: false,
  map: null,
  ready: false,
  follow: false,
  satellite: false,
  planes: {},          // id -> { obj, world: Vector3, lngLat }
  sig: { airports: '', routes: '' },
  clock: { time: -1, at: 0 },
};

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { return {}; }
}
function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ on: v.on, satellite: v.satellite })); } catch (e) { /* private mode */ }
}

// ---------- flight position ----------
// Game time with a fraction, so planes move smoothly between the 100 ms game ticks.
function smoothTime() {
  const s = G.state;
  const now = performance.now();
  if (s.time !== v.clock.time) { v.clock = { time: s.time, at: now }; }
  const speed = FG.ui ? FG.ui.speed : 0;
  return s.time + Math.min(now - v.clock.at, 150) * speed / 60000;
}

const CRUISE_M = { turboprop: 7000, regional: 10000, narrowbody: 11000, widebody: 11500, classic: 9000 };

// { lat, lon, altM, heading, pitch } of a plane. Uses G.flightState when the game provides it.
function planePose(p, t) {
  if (p.status === 'flying' && G.flightState) {
    const st = G.flightState(p, t);
    const climb = { takeoff: 1, climb: 1, descent: -1, approach: -0.5 }[st && st.phase] || 0;
    if (st) return { lat: st.lat, lon: st.lon, altM: (st.altFt || 0) * 0.3048, heading: st.heading || 0, flying: true, climb };
  }
  if (p.status === 'flying' && p.flight) {
    const f = p.flight;
    const a = G.airportByCode[f.from];
    const b = G.airportByCode[f.to];
    const frac = Math.min(1, Math.max(0, (t - f.dep) / (f.arr - f.dep)));
    const [lat, lon] = G.interpolate(a, b, frac);
    const ahead = G.interpolate(a, b, Math.min(frac + 0.01, 1));
    const heading = frac < 0.99 ? G.bearing({ lat, lon }, { lat: ahead[0], lon: ahead[1] }) : G.bearing(a, b);
    // Climb over the first 15%, descend over the last 20%.
    const up = Math.min(1, frac / 0.15, (1 - frac) / 0.2);
    const ease = up * up * (3 - 2 * up);
    const cruise = CRUISE_M[D.aircraft[p.type].category] || 10000;
    return { lat, lon, altM: cruise * ease, heading, flying: true, climb: frac < 0.15 ? 1 : frac > 0.8 ? -1 : 0 };
  }
  const ap = G.airportByCode[p.location];
  return { lat: ap.lat, lon: ap.lon, altM: 0, heading: 0, flying: false };
}

// ---------- aircraft models ----------
// glTF models in models/ (see models/README.md); FG.data.models says which type uses which file. Local axes:
// x = right wing, y = nose, z = up; each file is centred and 1 unit long, and is scaled to the type's real
// length (FG.data.looks). Types without a model keep the placeholder.
const modelLoads = {};   // file -> Promise of the loaded scene

function loadModel(file) {
  if (!modelLoads[file]) {
    modelLoads[file] = new GLTFLoader().loadAsync(`models/${file}.glb`).then((gltf) => gltf.scene);
    modelLoads[file].catch((e) => console.warn(`3D model ${file} not loaded, keeping the placeholder`, e));
  }
  return modelLoads[file];
}

// The aircraft to draw for a type: the placeholder at first, replaced by the glTF model once it has loaded.
function planeModel(type) {
  const g = placeholderModel(type);
  const file = D.models[type];
  const look = D.looks && D.looks[type];
  if (!file || !look) return g;
  // Placeholder at the type's real length while the model loads.
  const fit = look.len / g.userData.len;
  for (const part of g.children) { part.position.multiplyScalar(fit); part.scale.multiplyScalar(fit); }
  g.userData.len = look.len;
  loadModel(file).then((scene) => {
    const model = scene.clone();
    model.scale.setScalar(look.len);
    g.clear();
    g.add(model);
  }, () => {});
  return g;
}

// Placeholder low-poly aircraft, about real size in metres. Local axes: x = right wing, y = nose, z = up.
const MODEL_SHAPES = {
  turboprop: { len: 27, span: 27, fuselage: 1.4, engines: 2, highWing: true, prop: true },
  regional: { len: 32, span: 28, fuselage: 1.5, engines: 2, rearEngines: true },
  narrowbody: { len: 38, span: 35, fuselage: 2.0, engines: 2 },
  widebody: { len: 64, span: 62, fuselage: 3.0, engines: 2 },
  classic: { len: 45, span: 40, fuselage: 2.1, engines: 4 },
};
const modelCache = {};

function placeholderModel(type) {
  const cat = D.aircraft[type].category;
  const sh = MODEL_SHAPES[cat] || MODEL_SHAPES.narrowbody;
  if (!modelCache[cat]) {
    const white = new THREE.MeshLambertMaterial({ color: 0xf4f4f6, side: THREE.DoubleSide });
    const tail = new THREE.MeshLambertMaterial({ color: 0xdc2626, side: THREE.DoubleSide });
    const grey = new THREE.MeshLambertMaterial({ color: 0x9aa0a6, side: THREE.DoubleSide });
    const parts = [];
    const add = (geo, mat, fn) => { const m = new THREE.Mesh(geo, mat); fn(m); parts.push(m); };
    const r = sh.fuselage;
    const L = sh.len;
    // Fuselage along y, nose cone and tail cone.
    add(new THREE.CylinderGeometry(r, r, L * 0.7, 14), white, (m) => { m.position.y = L * 0.02; });
    add(new THREE.ConeGeometry(r, L * 0.13, 14), white, (m) => { m.position.y = L * 0.435; });
    add(new THREE.ConeGeometry(r, L * 0.22, 14), white, (m) => { m.position.y = -L * 0.44; m.rotation.z = Math.PI; m.position.z = r * 0.3; });
    // Wings: swept trapezoid.
    const wingZ = sh.highWing ? r * 0.9 : -r * 0.4;
    const wing = new THREE.Shape();
    const half = sh.span / 2;
    const root = L * 0.18;
    const sweep = sh.prop ? 0.5 : L * 0.12;
    wing.moveTo(-half, -sweep - root * 0.25);
    wing.lineTo(0, root * 0.5);
    wing.lineTo(half, -sweep - root * 0.25);
    wing.lineTo(half, -sweep - root * 0.45);
    wing.lineTo(0, -root * 0.5);
    wing.lineTo(-half, -sweep - root * 0.45);
    wing.closePath();
    add(new THREE.ExtrudeGeometry(wing, { depth: 0.4, bevelEnabled: false }), white, (m) => { m.position.set(0, L * 0.02, wingZ); });
    // Horizontal stabiliser.
    const stab = new THREE.Shape();
    const sh2 = sh.span * 0.18;
    stab.moveTo(-sh2, -L * 0.47);
    stab.lineTo(0, -L * 0.36);
    stab.lineTo(sh2, -L * 0.47);
    stab.lineTo(sh2, -L * 0.5);
    stab.lineTo(-sh2, -L * 0.5);
    stab.closePath();
    add(new THREE.ExtrudeGeometry(stab, { depth: 0.3, bevelEnabled: false }), white, (m) => { m.position.z = sh.rearEngines ? r * 3 : r * 0.6; });
    // Fin (airline colour).
    const fin = new THREE.Shape();
    fin.moveTo(-L * 0.35, 0);
    fin.lineTo(-L * 0.5, r * 3.2);
    fin.lineTo(-L * 0.42, r * 3.2);
    fin.lineTo(-L * 0.25, 0);
    fin.closePath();
    add(new THREE.ExtrudeGeometry(fin, { depth: 0.4, bevelEnabled: false }), tail, (m) => {
      // Shape x -> nose axis, shape y -> up, extrusion -> sideways.
      m.rotation.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
        new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
      m.position.set(-0.2, 0, r * 0.6);
    });
    // Engines (or propellers).
    const eng = (x, y, z) => add(new THREE.CylinderGeometry(r * 0.45, r * 0.4, L * 0.12, 10), grey, (m) => { m.position.set(x, y, z); });
    if (sh.rearEngines) {
      eng(r * 1.5, -L * 0.3, r * 0.7);
      eng(-r * 1.5, -L * 0.3, r * 0.7);
    } else {
      const xs = sh.engines === 4 ? [half * 0.35, half * 0.62] : [half * 0.35];
      for (const x of xs) for (const sx of [1, -1]) {
        eng(sx * x, L * 0.1 - (x / half) * sweep, wingZ - r * (sh.highWing ? -0.1 : 0.55));
        if (sh.prop) add(new THREE.BoxGeometry(r * 2.6, 0.1, 0.25), grey, (m) => { m.position.set(sx * x, L * 0.18, wingZ); });
      }
    }
    modelCache[cat] = parts;
  }
  const g = new THREE.Group();
  for (const part of modelCache[cat]) g.add(part.clone());
  g.userData.len = sh.len;
  g.matrixAutoUpdate = false;
  return g;
}

// ---------- map data ----------
const AP_MINZOOM = [99, 7, 5.5, 4, 2.5, 0]; // index = airport size

function airportFeatures() {
  const s = G.state;
  const sel = FG.ui && FG.ui.selectedAirport;
  const feats = [];
  for (const a of D.airports) {
    if (a.factory) continue;
    const own = !!s.slots[a.code];
    const size = G.airportSize ? G.airportSize(a.code) : a.size;
    feats.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: {
        code: a.code, size, own: own ? 1 : 0,
        minz: own || a.code === sel ? 0 : AP_MINZOOM[Math.max(1, Math.min(5, size))] + (a.minor ? 1.5 : 0),
        color: a.code === sel ? COLORS.selected : a.code === FG.config.startAirport && own ? COLORS.home : own ? COLORS.own : COLORS.other,
        label: own || a.code === sel ? `${a.code} · ${a.city}` : a.code,
      },
    });
  }
  return { type: 'FeatureCollection', features: feats };
}

// Great-circle polyline.
function arc(a, b, n = 48) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(G.interpolate(a, b, i / n));
  return unwrap(pts);
}

// [lat, lon] points -> [lon, lat] with longitudes unwrapped across the antimeridian.
function unwrap(pts) {
  const out = [];
  let prev = null;
  for (const [lat, lon0] of pts) {
    let lon = lon0;
    if (prev !== null) while (lon - prev > 180) lon -= 360;
    if (prev !== null) while (prev - lon > 180) lon += 360;
    out.push([lon, lat]);
    prev = lon;
  }
  return out;
}

function routeFeatures() {
  const feats = [];
  const seen = new Set();
  const sel = FG.ui && FG.ui.selectedPlane;
  for (const p of G.state.planes) {
    const stops = p.schedule.stops;
    if (stops.length >= 2) {
      for (let i = 0; i < stops.length; i++) {
        const a = stops[i];
        const b = stops[(i + 1) % stops.length];
        const key = `${a}-${b}${p.id === sel ? '*' : ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // The planned runway-to-runway track when the game provides it, else a great circle.
        const tr = G.legTrack && G.legTrack(p.type, a, b);
        const coords = tr ? unwrap(tr.pts) : arc(G.airportByCode[a], G.airportByCode[b]);
        feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords },
          properties: { kind: 'route', selected: p.id === sel ? 1 : 0 } });
      }
    }
    if (p.status === 'flying' && p.flight.kind !== 'scheduled') {
      const tr = G.flightTrack && G.flightTrack(p);
      const coords = tr ? unwrap(tr.pts) : arc(G.airportByCode[p.flight.from], G.airportByCode[p.flight.to]);
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords },
        properties: { kind: 'ferry', selected: p.id === sel ? 1 : 0 } });
    }
  }
  return { type: 'FeatureCollection', features: feats };
}

function refreshData() {
  const map = v.map;
  const sel = FG.ui ? `${FG.ui.selectedAirport}|${FG.ui.selectedPlane}` : '';
  const aSig = `${Object.keys(G.state.slots).join(',')}|${D.airports.length}|${sel}`;
  if (aSig !== v.sig.airports) {
    v.sig.airports = aSig;
    map.getSource('fg-airports').setData(airportFeatures());
  }
  const rSig = `${G.state.planes.map((p) => `${p.id}:${p.schedule.stops.join('-')}:${p.status === 'flying' && p.flight.kind !== 'scheduled' ? p.flight.to : ''}`).join(',')}|${sel}`;
  if (rSig !== v.sig.routes) {
    v.sig.routes = rSig;
    map.getSource('fg-routes').setData(routeFeatures());
  }
}

// ---------- style ----------
function transformStyle(_prev, style) {
  style.projection = { type: 'globe' };
  style.sources.terrain = { type: 'raster-dem', url: 'https://tiles.mapterhorn.com/tilejson.json' };
  style.sources.hillshade = { type: 'raster-dem', url: 'https://tiles.mapterhorn.com/tilejson.json' };
  style.sources.satellite = {
    type: 'raster', tileSize: 256, maxzoom: 14,
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'],
    attribution: 'Sentinel-2 cloudless by EOX',
  };
  style.terrain = { source: 'terrain', exaggeration: 1.5 };
  style.sky = {
    'sky-color': '#7fb4ec', 'horizon-color': '#dbe9f7', 'fog-color': '#e6eef7',
    'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 8, 0],
  };
  const firstSymbol = style.layers.findIndex((l) => l.type === 'symbol');
  style.layers.splice(firstSymbol, 0,
    { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: v.satellite ? 'visible' : 'none' } },
    { id: 'hills', type: 'hillshade', source: 'hillshade', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#47402f' } });
  style.sources['fg-airports'] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  style.sources['fg-routes'] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  const visible = ['>=', ['zoom'], ['get', 'minz']];
  style.layers.push(
    {
      id: 'fg-routes', type: 'line', source: 'fg-routes',
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': ['match', ['get', 'kind'], 'ferry', COLORS.ferry, COLORS.route],
        'line-width': ['case', ['==', ['get', 'selected'], 1], 4, 2.2],
        'line-opacity': 0.85,
      },
    },
    {
      id: 'fg-airports', type: 'circle', source: 'fg-airports', filter: visible,
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, ['+', 1.5, ['*', 0.8, ['get', 'size']]], 10, ['+', 4, ['*', 1.6, ['get', 'size']]]],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
      },
    },
    {
      id: 'fg-airport-labels', type: 'symbol', source: 'fg-airports', filter: visible,
      layout: {
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12,
        'text-anchor': 'left', 'text-offset': [0.8, 0], 'symbol-sort-key': ['-', 10, ['+', ['get', 'size'], ['*', 10, ['get', 'own']]]],
      },
      paint: { 'text-color': '#1f2328', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
    });
  return style;
}

// ---------- three.js layer ----------
// Shown height: the real height, but stretched when zoomed out so planes stay clearly above the ground.
function shownAlt(altM, len, exag) {
  return Math.max(altM, (altM / 11000) * len * exag * 1.2) + len * exag * 0.12;
}

const tmp = { up: new THREE.Vector3(), east: new THREE.Vector3(), north: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), pos: new THREE.Vector3() };

// World frame for a point: sphere (radius 1) on the globe, mercator 0..1 otherwise.
function frameAt(lat, lon, altM, globe) {
  const { up, east, north, pos } = tmp;
  if (globe) {
    const la = lat * Math.PI / 180;
    const lo = lon * Math.PI / 180;
    up.set(Math.sin(lo) * Math.cos(la), Math.sin(la), Math.cos(lo) * Math.cos(la));
    east.set(Math.cos(lo), 0, -Math.sin(lo));
    north.crossVectors(up, east);
    pos.copy(up).multiplyScalar(1 + altM / EARTH_R);
    return 1 / EARTH_R; // world units per metre
  }
  const mc = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], altM);
  pos.set(mc.x, mc.y, mc.z);
  east.set(1, 0, 0);
  north.set(0, -1, 0);
  up.set(0, 0, 1);
  return mc.meterInMercatorCoordinateUnits();
}

const planeLayer = {
  id: 'fg-planes',
  type: 'custom',
  renderingMode: '3d',
  onAdd(map, gl) {
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.scene.add(this.sun, this.sun.target);
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.matrix = new THREE.Matrix4();
  },
  render(gl, args) {
    if (!v.on) return;
    const map = v.map;
    const pd = args.defaultProjectionData;
    const globe = map.getProjection().type === 'globe' && pd.projectionTransition >= 0.5;
    this.matrix.fromArray(globe ? pd.mainMatrix : pd.fallbackMatrix);
    this.camera.projectionMatrix.copy(this.matrix);
    v.globe = globe;
    v.clip = globe ? pd.clippingPlane : null;

    const t = smoothTime();
    const zoom = map.getZoom();
    const center = map.getCenter();
    const mpp = EARTH_CIRC * Math.cos(center.lat * Math.PI / 180) / (512 * 2 ** zoom); // metres per pixel
    const px = PLANE_PX * 2 ** (-Math.max(0, zoom - 11) * 0.5); // shrink towards real size when close
    const sel = FG.ui && FG.ui.selectedPlane;

    // Light from above-left of the view centre.
    frameAt(center.lat, center.lng, 0, globe);
    this.sun.position.copy(tmp.pos).addScaledVector(tmp.up, 1).addScaledVector(tmp.east, -0.6).addScaledVector(tmp.north, 0.4);
    this.sun.target.position.copy(tmp.pos);

    const alive = new Set();
    for (const p of G.state.planes) {
      alive.add(p.id);
      let e = v.planes[p.id];
      if (!e || e.type !== p.type) {
        if (e) this.scene.remove(e.obj);
        e = v.planes[p.id] = { obj: planeModel(p.type), type: p.type, world: new THREE.Vector3() };
        this.scene.add(e.obj);
      }
      const pose = planePose(p, t);
      const len = e.obj.userData.len;
      const exag = Math.max(1, px * mpp / len) * (p.id === sel ? 1.35 : 1);
      // Shown height: real cruise height, but always clearly above the ground when zoomed out.
      const ground = pose.altM < 300 ? (map.queryTerrainElevation([pose.lon, pose.lat]) || 0) : 0;
      const altM = ground + shownAlt(pose.altM, len, exag);
      if (p.id === sel) this.drawTrack(p, len, exag, globe);
      const unit = frameAt(pose.lat, pose.lon, altM, globe);
      const h = pose.heading * Math.PI / 180;
      const { fwd, right, up, east, north, pos } = tmp;
      fwd.copy(north).multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
      right.copy(east).multiplyScalar(Math.cos(h)).addScaledVector(north, -Math.sin(h));
      // Nose up while climbing, down while descending.
      const pitch = (pose.climb || 0) * 0.12;
      const nose = fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
      const top = up.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(fwd, -Math.sin(pitch));
      // Parked planes line up beside each other.
      if (!pose.flying) {
        const n = G.state.planes.filter((q) => q.status !== 'flying' && q.location === p.location).indexOf(p);
        pos.addScaledVector(east, n * len * exag * 1.1 * unit).addScaledVector(north, len * exag * 0.9 * unit);
      }
      const s = unit * exag;
      e.obj.matrix.makeBasis(right.multiplyScalar(s), nose.multiplyScalar(s), top.multiplyScalar(s)).setPosition(pos);
      e.obj.matrixWorldNeedsUpdate = true;
      e.world.copy(pos);
      e.lngLat = [pose.lon, pose.lat];
      e.heading = pose.heading;
      e.altM = altM;
      // Hide planes behind the globe.
      e.obj.visible = !v.clip || pos.x * v.clip[0] + pos.y * v.clip[1] + pos.z * v.clip[2] + v.clip[3] > -0.002;
    }
    for (const id of Object.keys(v.planes)) {
      if (!alive.has(id)) { this.scene.remove(v.planes[id].obj); delete v.planes[id]; }
    }
    if (this.track && !(sel && v.planes[sel] && G.plane(sel) && G.plane(sel).status === 'flying')) this.track.visible = false;

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    map.triggerRepaint();
  },
};

// The selected plane's whole flight path as a line in the air (needs G.flightTrack).
planeLayer.drawTrack = function (p, len, exag, globe) {
  const tr = p.status === 'flying' && G.flightTrack ? G.flightTrack(p) : null;
  if (!this.track) {
    this.track = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff9500 }));
    this.track.frustumCulled = false;
    this.scene.add(this.track);
  }
  if (!tr) { this.track.visible = false; return; }
  const key = `${p.id}|${p.flight.dep}|${Math.round(Math.log2(exag) * 4)}|${globe}`;
  this.track.visible = true;
  if (this.track.userData.key === key) return;
  this.track.userData.key = key;
  const pts = [];
  for (let i = 0; i < tr.pts.length; i++) {
    const [lat, lon] = tr.pts[i];
    frameAt(lat, lon, shownAlt(tr.altAt(tr.cum[i]) * 0.3048, len, exag), globe);
    pts.push(tmp.pos.clone());
  }
  this.track.geometry.dispose();
  this.track.geometry = new THREE.BufferGeometry().setFromPoints(pts);
};

// Screen position of a plane (for clicks), or null when hidden.
function planeScreen(e) {
  if (!e.obj.visible) return null;
  const c = new THREE.Vector4(e.world.x, e.world.y, e.world.z, 1).applyMatrix4(planeLayer.matrix);
  if (c.w <= 0) return null;
  const canvas = v.map.getCanvas();
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  return { x: (c.x / c.w + 1) / 2 * w, y: (1 - c.y / c.w) / 2 * h };
}

function onClick(e) {
  let best = null;
  let bestD = 22;
  for (const [id, pe] of Object.entries(v.planes)) {
    const sp = planeScreen(pe);
    if (!sp) continue;
    const d = Math.hypot(sp.x - e.point.x, sp.y - e.point.y);
    if (d < bestD) { best = id; bestD = d; }
  }
  if (best) { FG.ui.selectPlane(best); return; }
  const hits = v.map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['fg-airports'] });
  if (hits.length) { FG.ui.selectAirport(hits[0].properties.code); return; }
  FG.ui.clearSelection();
  setFollow(false);
}

// ---------- camera ----------
function networkBounds() {
  const pts = Object.keys(G.state.slots).map((c) => G.airportByCode[c]).filter(Boolean);
  if (!pts.length) return null;
  const b = new maplibregl.LngLatBounds();
  for (const a of pts) b.extend([a.lon, a.lat]);
  return b;
}

function fitNetwork() {
  const b = networkBounds();
  if (!b) return;
  v.map.fitBounds(b, { padding: 80, maxZoom: 7, pitch: 45, duration: 1200 });
}

function setFollow(on) {
  v.follow = on && !!(FG.ui && FG.ui.selectedPlane);
  document.querySelector('#view3d .follow')?.classList.toggle('active', v.follow);
}

function followTick() {
  if (!v.follow) return;
  const e = v.planes[FG.ui.selectedPlane];
  if (!e || !e.lngLat) { setFollow(false); return; }
  const map = v.map;
  const target = map.getBearing() + ((((e.heading - map.getBearing()) % 360) + 540) % 360 - 180) * 0.06;
  map.jumpTo({ center: e.lngLat, bearing: target, pitch: Math.max(map.getPitch(), 62), zoom: Math.max(map.getZoom(), 6.5) });
}

// ---------- setup ----------
function controls() {
  const box = document.createElement('div');
  box.className = 'view3d-controls';
  box.innerHTML = `<button class="home" title="Show my network">⌂</button>
    <button class="follow" title="Follow the selected plane">🎥 Follow</button>
    <button class="sat" title="Satellite imagery">🛰 Satellite</button>`;
  box.querySelector('.home').onclick = () => { setFollow(false); fitNetwork(); };
  box.querySelector('.follow').onclick = () => {
    if (!FG.ui.selectedPlane) { FG.ui.selectPlane(G.state.planes[0] && G.state.planes[0].id); }
    setFollow(!v.follow);
  };
  box.querySelector('.sat').onclick = (ev) => {
    v.satellite = !v.satellite;
    ev.currentTarget.classList.toggle('active', v.satellite);
    if (v.map.getLayer('satellite')) v.map.setLayoutProperty('satellite', 'visibility', v.satellite ? 'visible' : 'none');
    savePrefs();
  };
  box.querySelector('.sat').classList.toggle('active', v.satellite);
  return box;
}

function createMap() {
  const el = document.getElementById('view3d');
  const home = G.airportByCode[FG.config.startAirport];
  const map = v.map = new maplibregl.Map({
    container: el,
    center: [home.lon, home.lat],
    zoom: 4.5,
    pitch: 45,
    maxPitch: 80,
    canvasContextAttributes: { antialias: true },
    attributionControl: { compact: true },
  });
  map.setStyle('https://tiles.openfreemap.org/styles/liberty', { transformStyle });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
  map.addControl(new maplibregl.GlobeControl(), 'top-left');
  map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
  el.appendChild(controls());
  map.once('style.load', () => {
    map.addLayer(planeLayer, 'fg-airport-labels');
    v.ready = true;
    refreshData();
    fitNetwork();
  });
  map.on('click', onClick);
  map.on('mouseenter', 'fg-airports', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'fg-airports', () => { map.getCanvas().style.cursor = ''; });
  map.on('dragstart', () => setFollow(false));
  map.on('render', () => { if (v.ready && v.on) { refreshData(); followTick(); } });
  // Keep mouse events away from the Leaflet map underneath.
  for (const t of ['mousedown', 'click', 'dblclick', 'wheel', 'touchstart', 'pointerdown', 'contextmenu']) {
    el.addEventListener(t, (ev) => ev.stopPropagation());
  }
}

function setOn(on) {
  v.on = on;
  document.getElementById('view3d').hidden = !on;
  document.getElementById('view3d-toggle').classList.toggle('active', on);
  document.body.classList.toggle('in-3d', on);
  if (on) {
    if (!v.map) createMap();
    else { v.map.resize(); v.map.triggerRepaint(); }
  } else {
    setFollow(false);
  }
  savePrefs();
}

function init() {
  const prefs = loadPrefs();
  v.satellite = !!prefs.satellite;
  document.getElementById('view3d-toggle').addEventListener('click', () => setOn(!v.on));
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'v' || e.key === 'V') setOn(!v.on);
  });
  if (prefs.on) setOn(true);
}

if (FG.ui) init();
else window.addEventListener('fg-ui-ready', init, { once: true });

FG.view3d = v; // for debugging
