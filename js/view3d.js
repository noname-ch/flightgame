// 3D view: MapLibre globe with terrain and 3D buildings, aircraft drawn with three.js.
// Toggled with the "3D" button (or V). Reads the game state directly; selection goes through FG.ui.
// The aircraft are glTF models from models/ (see js/data/models.js); types without one use the placeholder.
import * as maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import { loadModel, modelSize, facing, patchFacing } from './models3d.js';

const G = FG.game;
const D = FG.data;

const PREF_KEY = 'flightgame.view3d';
const EARTH_R = 6371008.8;
const EARTH_CIRC = 40075016.686;
const PLANE_PX = 30;            // on-screen length of an aircraft when zoomed out
const COLORS = { own: '#007aff', other: '#8e8e93', home: '#34c759', selected: '#ff9500', route: '#007aff', ferry: '#af52de' };

const v = {
  on: false,
  map: null,
  ready: false,
  follow: false,
  cam: 'chase',        // while following: 'chase' (V, turn round it by dragging), 'flyby' (B) or 'wing' (N)
  orbit: { yaw: 0, pitch: null, base: null }, // chase camera: angle to the plane's heading, tilt, eased heading
  flyby: null,         // fly-by camera spot { id, lat, lon, alt, min }
  wingSide: -1,        // wing camera: -1 left wing, 1 right
  satellite: false,
  planes: {},          // id -> { obj, world: Vector3, lngLat }
  sig: { airports: '', routes: '', gates: '' },
  gatesDirty: true,    // map moved: rebuild the aprons in view
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
// The time this frame is shown at: the frame's own timestamp (the same for everything drawn in it, and
// evenly spaced with the screen's refresh), not the moment the code happens to run.
const frameNow = () => (document.timeline && document.timeline.currentTime != null ? document.timeline.currentTime : performance.now());
function smoothTime(at) {
  if (at != null && FG.ui && FG.ui.timeAt) return FG.ui.timeAt(at); // game time at that moment, from ui.js
  if (FG.ui && FG.ui.time != null) return FG.ui.time; // exact fractional game time from ui.js
  const s = G.state;
  const now = performance.now();
  if (s.time !== v.clock.time) { v.clock = { time: s.time, at: now }; }
  const speed = FG.ui ? FG.ui.speed : 0;
  return s.time + Math.min(now - v.clock.at, 150) * speed / 60000;
}

const CRUISE_M = { turboprop: 7000, regional: 10000, narrowbody: 11000, widebody: 11500, classic: 9000 };

const DEG = Math.PI / 180;
const wrap180 = (d) => ((((d % 360) + 540) % 360) - 180);
const AIRBORNE = { climb: 1, cruise: 1, descent: 1, approach: 1 };

// Flight attitude from the track around time t: heading along the actual motion (so corners are
// flown as curves), bank from the turn rate, pitch from the climb or descent angle, plus the
// rotation at lift-off and the flare before touchdown. Angles in degrees.
function attitude(p, st, t) {
  const dt = 0.12; // game minutes either side
  const a = G.flightState(p, t - dt);
  const b = G.flightState(p, t + dt);
  const moved = G.distanceKm(a, b) * 1000;
  let heading = st.heading || 0;
  if (st.phase !== 'pushback' && moved > 3) heading = G.bearing(a, b);
  heading += st.crab || 0; // crabbing into a crosswind (G.flightState; straightened out before touchdown)
  const vMs = st.speedKmh / 3.6;
  const pf = G.perf(p.type);
  const vLift = pf.vLof; // the type's lift-off speed
  const agl = (st.altFt || 0) - (st.fieldFt || 0); // above the runways
  let bank = 0;
  let pitch = 0;
  if (AIRBORNE[st.phase] || (st.phase === 'takeoff' && !st.ground)) {
    if (G.distanceKm(a, st) * 1000 > 3 && G.distanceKm(st, b) * 1000 > 3) {
      const turn = wrap180(G.bearing(st, b) - G.bearing(a, st)) * DEG / (dt * 60); // rad/s
      const most = pf.bank + 5;
      bank = Math.max(-most, Math.min(most, Math.atan(vMs * turn / 9.81) / DEG));
    }
    const climbM = ((b.altFt || 0) - (a.altFt || 0)) * 0.3048;
    pitch = Math.atan2(climbM, Math.max(1, moved)) / DEG + 2.5;
    if (st.phase === 'approach' && agl < 150) pitch += 4 * (1 - agl / 150); // flare
    // Gusty wind or a thunderstorm low down: the plane bumps about a little (looks only; js/weather.js wind).
    if (st.gusty && agl < 10000) {
      const k = Math.min(1, Math.max(0.15, (st.windKt - 12) / 25)) * (agl < 3000 ? 1 : 0.5);
      const ph = p.id.charCodeAt(p.id.length - 1) * 0.7;
      const s = performance.now() / 1000;
      bank += k * 4 * (0.6 * Math.sin(s * 1.9 + ph) + 0.4 * Math.sin(s * 4.3 + ph * 2));
      pitch += k * 1.2 * Math.sin(s * 2.7 + ph);
    }
  } else if (st.phase === 'takeoff') {
    pitch = 9 * Math.max(0, Math.min(1, (st.speedKmh - vLift * 0.75) / (vLift * 0.25))); // rotation
  } else if (st.phase === 'landing') {
    pitch = 4 * Math.max(0, Math.min(1, (st.speedKmh - vLift * 0.5) / (vLift * 0.5))); // nose wheel down
  }
  return { heading, bank, pitch };
}

// { lat, lon, altM, heading, bank, pitch } of a plane. Uses G.flightState when the game provides it
// (`st`: its result for time t, when already at hand).
function planePose(p, t, st0) {
  if (p.status === 'flying' && G.flightState) {
    const st = st0 || G.flightState(p, t);
    if (st) {
      const att = attitude(p, st, t);
      // (altM: above the runways, as the 3D heights are drawn from their ground)
      return { lat: st.lat, lon: st.lon, altM: Math.max(0, (st.altFt || 0) - (st.fieldFt || 0)) * 0.3048, flying: true, st, ...att };
    }
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
    return { lat, lon, altM: cruise * ease, heading, flying: true, pitch: frac < 0.15 ? 7 : frac > 0.8 ? -3 : 0 };
  }
  // Parked at its gate.
  if (G.gateOf) {
    const g = G.gateOf(p.location, p.id);
    return { lat: g.lat, lon: g.lon, altM: 0, heading: g.heading, flying: false, gate: true };
  }
  const ap = G.airportByCode[p.location];
  return { lat: ap.lat, lon: ap.lon, altM: 0, heading: 0, flying: false };
}

// ---------- aircraft models ----------
// glTF models in models/ (see models/README.md); FG.data.models says which type uses which file. Local axes:
// x = right wing, y = nose, z = up; each file is centred and 1 unit long, and is scaled to the type's real
// length (FG.data.looks). Types without a model keep the placeholder. js/models3d.js loads and paints them.

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
  loadModel(type).then((scene) => {
    const model = scene.clone();
    const size = modelSize(type);
    model.scale.set(size.wide, size.len, size.wide);
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
    for (const m of [white, tail, grey]) { m.onBeforeCompile = patchFacing; m.customProgramCacheKey = () => 'facing'; }
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
        color: a.code === sel ? COLORS.selected : a.code === G.home() && own ? COLORS.home : own ? COLORS.own : COLORS.other,
        label: own || a.code === sel ? `${a.code} · ${a.city}` : a.code,
      },
    });
  }
  return { type: 'FeatureCollection', features: feats };
}

// Runways, taxiways, aprons, buildings, jet bridges and stand markings of the airports in view when zoomed
// in (G.airportRunways, G.taxiwaysOf, G.apronOf). Parked planes stand on these stands (G.gateOf), push back
// from them and taxi along the taxiways.
const GATE_MINZOOM = 12;
const RUNWAY_MINZOOM = 10;
// A strip `width` metres wide along the line a -> b ([lat, lon]), `ext` metres longer at both ends.
function strip(a, b, width, ext = 0) {
  const kx = 111320 * Math.cos(a[0] * DEG);
  const dx = (b[1] - a[1]) * kx;
  const dy = (b[0] - a[0]) * 111320;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const at = (p, along, across) => [p[0] + (uy * along - ux * across) / 111320, p[1] + (ux * along + uy * across) / kx];
  const w = width / 2;
  return [at(a, -ext, -w), at(b, ext, -w), at(b, ext, w), at(a, -ext, w)];
}
// Line width in pixels for `m` metres on the ground at latitude `lat`, at zoom 10 and zoom 22 (the layer
// interpolates exponentially between them, so the line keeps its real width at every zoom).
function metresWidth(m, lat) {
  const perPx = 78271.517 * Math.cos(lat * DEG); // metres per pixel at zoom 0 (512 px tiles)
  return { w10: (m * 2 ** 10) / perPx, w22: (m * 2 ** 22) / perPx };
}

// A paved runway r = [lat, lon, lat, lon, width] in metres: its length and width, a point `along` it from its
// first end and `across` to the right, and the other way round.
function runwayFrame(r) {
  const kx = 111320 * Math.cos(r[0] * DEG);
  const dx = (r[3] - r[1]) * kx;
  const dy = (r[2] - r[0]) * 111320;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  return {
    len, width: Math.max(18, r[4] || 30), hdg: (Math.atan2(dx, dy) / DEG + 360) % 360,
    at: (along, across) => [r[0] + (uy * along - ux * across) / 111320, r[1] + (ux * along + uy * across) / kx],
    of: (p) => { const x = (p[1] - r[1]) * kx, y = (p[0] - r[0]) * 111320; return [x * ux + y * uy, x * uy - y * ux]; },
  };
}

// The white paint of a paved runway, as rectangles: side stripes, the dashed centre line and, from both ends,
// the threshold stripes, the aiming point and the touchdown zone bars (fewer on short and narrow runways).
// And its two numbers, each read from its own end. `cover` (G.runwayCover): where another runway crosses it,
// none of it is painted, so that neither runway is painted over the other.
function runwayPaint(f, cover) {
  const { len, width: W } = f;
  const polys = [];
  const rect = (a0, a1, c, w) => {
    for (const [b0, b1] of cover ? cover.open(Math.min(a0, a1), Math.max(a0, a1), c - w / 2, c + w / 2) : [[a0, a1]]) {
      polys.push([f.at(b0, c - w / 2), f.at(b1, c - w / 2), f.at(b1, c + w / 2), f.at(b0, c + w / 2)]);
    }
  };
  for (const s of [-1, 1]) rect(0, len, s * (W / 2 - 1), 1);
  for (let x = 80; x + 30 <= len - 80; x += 50) rect(x, x + 30, 0, 1.2);
  const n = W >= 45 ? 12 : W >= 30 ? 8 : W >= 23 ? 6 : 4; // threshold stripes
  const sw = (W / 2 - 0.9) / n;
  const aim = len >= 2400 ? 400 : 300;
  const inner = W * 0.2; // the aiming point and the touchdown bars begin this far from the centre line
  for (const end of [0, 1]) {
    const X = (x) => (end ? len - x : x);
    for (let i = 0; i < n / 2; i++) for (const s of [-1, 1]) rect(X(6), X(36), s * sw * (1.5 + 2 * i), sw);
    if (len >= 1200) {
      const aw = W >= 45 ? 9 : W * 0.18;
      for (const s of [-1, 1]) rect(X(aim), X(aim + (len >= 2400 ? 60 : 45)), s * (inner + aw / 2), aw);
    }
    if (len < 1800 || W < 30) continue;
    for (const [x, bars] of [[150, 3], [300, 3], [450, 2], [600, 2], [750, 1], [900, 1]]) {
      if (Math.abs(x - aim) < 80) continue;
      for (let i = 0; i < bars; i++) for (const s of [-1, 1]) rect(X(x), X(x + 22.5), s * (inner + 0.9 + i * 3.3), 1.8);
    }
  }
  const num = (h) => String(Math.round(h / 10) % 36 || 36).padStart(2, '0');
  // (a number that would lie on the other runway is left out)
  const free = (x) => {
    if (!cover) return true;
    const o = cover.open(x - 20, x + 20, -W / 4, W / 4);
    return o.length === 1 && o[0][1] - o[0][0] >= 40;
  };
  return {
    polys,
    numbers: len < 400 ? [] : [{ at: f.at(50, 0), text: num(f.hdg), rot: f.hdg, x: 50 }, { at: f.at(len - 50, 0), text: num(f.hdg + 180), rot: (f.hdg + 180) % 360, x: len - 50 }].filter((n) => free(n.x)),
  };
}

// Holding positions: where the taxiway stretch p -> q comes up to the runway, two yellow bars across it,
// `width` metres long (as rectangles).
function holdBars(f, p, q, width) {
  const hold = f.width >= 45 ? 90 : f.width >= 30 ? 60 : 40; // metres from the runway centre line
  const c = f.of(p);
  const d = f.of(q);
  const bars = [];
  for (const s of [-1, 1]) {
    if ((c[1] - s * hold) * (d[1] - s * hold) >= 0) continue; // does not cross the line
    const t = (s * hold - c[1]) / (d[1] - c[1]);
    const along = c[0] + t * (d[0] - c[0]);
    if (along < -30 || along > f.len + 30) continue;
    const m = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    const away = c[1] * s > d[1] * s ? p : q; // the end of the stretch that is further from the runway
    const kx = 111320 * Math.cos(m[0] * DEG);
    const dist = Math.hypot((away[1] - m[1]) * kx, (away[0] - m[0]) * 111320) || 1;
    const step = (k) => [m[0] + ((away[0] - m[0]) * k) / dist, m[1] + ((away[1] - m[1]) * k) / dist];
    bars.push(strip(step(0), step(0.9), width), strip(step(2.2), step(3.1), width));
  }
  return bars;
}

// `hide` gets the outlines the map's own buildings must stay out of (hideMapBuildings).
function gateFeatures(list, gates, hide = []) {
  const feats = [];
  const ring = (pts) => { const r = pts.map(([lat, lon]) => [lon, lat]); r.push(r[0]); return [r]; };
  const line = (pts) => pts.map(([lat, lon]) => [lon, lat]);
  const poly = (pts, properties) => feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: ring(pts) }, properties });
  const path = (pts, properties) => feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line(pts) }, properties });
  for (const a of list) {
    const paved = []; // frames of the paved runways
    const rws = G.airportRunways(a.code);
    // (grass under paved, where they cross)
    for (const r of rws.slice().sort((x, y) => (x[5] ? 1 : 0) - (y[5] ? 1 : 0))) {
      const ends = [[r[0], r[1]], [r[2], r[3]]];
      const rw = strip(ends[0], ends[1], Math.max(18, r[4] || 30));
      poly(rw, { kind: 'runway', paved: r[5] ? 1 : 0 });
      if (!r[5] || !gates) continue;
      const cover = G.runwayCover(r, rws);
      for (const [a0, a1] of cover.open(0, cover.len, -2, 2)) path([cover.at(a0, 0), cover.at(a1, 0)], { kind: 'rwline' }); // from afar; close up the paint itself
      const f = runwayFrame(r);
      paved.push(f);
      const paint = runwayPaint(f, cover);
      for (const p of paint.polys) poly(p, { kind: 'rwpaint' });
      const size = metresWidth(f.width >= 45 ? 15 : f.width / 3, a.lat); // height of the numbers
      for (const n of paint.numbers) {
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [n.at[1], n.at[0]] }, properties: { kind: 'rwnum', name: n.text, rot: n.rot, s13: size.w10 * 8, s19: size.w10 * 512 } });
      }
    }
    // Developer tools: where construction at the selected airport would go (G.expansionPreview).
    if (FG.devPreview && FG.ui && FG.ui.selectedAirport === a.code) {
      const pv = G.expansionPreview(a.code);
      for (const { r, label } of pv.runways) {
        poly(strip([r[0], r[1]], [r[2], r[3]], Math.max(18, r[4] || 30)), { kind: 'preview' });
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [(r[1] + r[3]) / 2, (r[0] + r[2]) / 2] }, properties: { kind: 'pvlabel', name: label } });
      }
      for (const tw of pv.taxiways) poly(strip(tw[0], tw[1], 18, 9), { kind: 'preview' });
      for (const r of pv.aprons) poly(r, { kind: 'preview' });
      for (const b of pv.buildings) poly(b.ring, { kind: 'preview' });
      for (const st of pv.stands) path(st.lead, { kind: 'pvline' });
    }
    if (!gates) continue;
    // Its real layout is on the way: not the one the game makes up meanwhile (it would stand somewhere else).
    if (FG.layouts && FG.layouts.pending(a.code)) continue;
    const big = G.airportSize(a.code) >= 3;
    // Taxiways as wide lines along every bend, with round joints (not one box per line, whose corners stuck out).
    const width = big ? 23 : 15;
    const tww = metresWidth(width, a.lat);
    const edge = metresWidth(width + (big ? 14 : 7), a.lat); // with its shoulders
    for (const tw of G.drawnTaxiways(a.code)) { // (not across the aprons and pads: planes cross the open slab)
      // fitted to the satellite picture (`w`): that is the whole paved width, without shoulders round it
      const own = tw.w && metresWidth(tw.w, a.lat);
      path(tw, own ? { kind: 'taxiway', ...own, e10: own.w10, e22: own.w22 } : { kind: 'taxiway', ...tww, e10: edge.w10, e22: edge.w22 });
      path(tw, { kind: 'twline' });
      for (const f of paved) {
        for (let i = 1; i < tw.length; i++) for (const bar of holdBars(f, tw[i - 1], tw[i], (tw.w || width) * 0.85)) poly(bar, { kind: 'hold' });
      }
    }
    const ap = G.apronOf(a.code);
    for (const r of ap.aprons || [ap.apron]) poly(r, { kind: 'apron' });
    for (const r of ap.pads || []) poly(r, { kind: 'pad' }); // (airport fixes: open concrete)
    // Buildings with windows, doors and a roof coloured like the satellite photo (js/facades.js), where the
    // layout is real; made-up ones get the same looks with default roofs.
    const F = FG.facades;
    const roofs = F && ap.real ? F.roofsOf(a.code, ap.buildings) : null;
    ap.buildings.forEach((b, i) => {
      const ps = F && F.parts(b, roofs && roofs[i], [a.lat, a.lon]);
      if (ps) for (const q of ps) poly(q.ring, { kind: 'building', part: 'fac', base: q.base, h: q.h, col: q.color });
      else poly(b.ring, { kind: 'building', part: b.kind, base: b.base, h: b.h });
    });
    for (const b of ap.buildings) if (HIDES.has(b.kind)) hide.push(b.ring);
    if (!ap.real) hide.push(...(ap.aprons || [ap.apron])); // (a made-up apron may lie over real buildings)
    for (const m of ap.markings || []) path(m.line, { kind: m.kind === 'w' ? 'paint' : 'lead' });
    for (const st of ap.stands) {
      path(st.lead, { kind: 'lead' });
      path(st.stopBar, { kind: 'stop' });
      if (st.bridgePoly) poly(st.bridgePoly, { kind: 'bridge' });
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [st.lead[0][1], st.lead[0][0]] }, properties: { kind: 'label', name: st.name } });
    }
  }
  return { type: 'FeatureCollection', features: feats };
}

// The map's own buildings (OpenFreeMap) where the game draws one, or a made-up apron: else two stood in the
// same place, the map's in another colour and a bit off, and a terminal seemed to be on the map but not in
// the game. Every outline is drawn in by 1.5 m first, so that a building that only shares a wall with one of
// the game's stays. (MapLibre's 'within' doesn't take polygons; 'distance' does.)
const HIDES = new Set(['terminal', 'hall', 'hangar', 'other', 'tower', 'carpark']);
function inset(ring, d) {
  const lat0 = ring[0][0];
  const kx = 111320 * Math.cos(lat0 * DEG);
  const P = ring.map(([lat, lon]) => [(lon - ring[0][1]) * kx, (lat - lat0) * 111320]);
  let a2 = 0;
  for (let i = 0; i < P.length; i++) { const p = P[i]; const q = P[(i + 1) % P.length]; a2 += p[0] * q[1] - q[0] * p[1]; }
  if (Math.abs(a2) / 2 < 8 * d * d) return null; // too small to draw in
  const s = a2 > 0 ? 1 : -1; // counter-clockwise: the inside is on the left of each edge
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[(i + P.length - 1) % P.length];
    const c = P[i];
    const n = P[(i + 1) % P.length];
    const e1 = [c[0] - p[0], c[1] - p[1]];
    const e2 = [n[0] - c[0], n[1] - c[1]];
    const l1 = Math.hypot(...e1) || 1;
    const l2 = Math.hypot(...e2) || 1;
    const n1 = [(-e1[1] / l1) * s, (e1[0] / l1) * s]; // inward normals
    const n2 = [(-e2[1] / l2) * s, (e2[0] / l2) * s];
    const b = [n1[0] + n2[0], n1[1] + n2[1]];
    const cos = (b[0] * n1[0] + b[1] * n1[1]) / (Math.hypot(...b) || 1);
    const m = Math.min(3 * d, d / Math.max(0.2, cos)); // the corner moves this far along the bisector
    const bl = Math.hypot(...b) || 1;
    out.push([c[0] + (b[0] / bl) * m, c[1] + (b[1] / bl) * m]);
  }
  return out.map(([x, y]) => [ring[0][1] + x / kx, lat0 + y / 111320]); // [lon, lat]
}
function hideMapBuildings(rings) {
  const polys = [];
  for (const r of rings) {
    const q = inset(r, 1.5);
    if (q) polys.push([[...q, q[0]]]);
  }
  const filter = polys.length ? ['>', ['distance', { type: 'MultiPolygon', coordinates: polys }], 0] : null;
  const sig = JSON.stringify(filter);
  if (sig === v.sig.hidden) return;
  v.sig.hidden = sig;
  for (const id of ['building', 'building-3d']) if (v.map.getLayer(id)) v.map.setFilter(id, filter);
}

// Real taxiways and buildings around the airports the game lays out itself, so that it keeps its own apron
// clear of them (game.js apronOf looks at FG.obstacles[code]). When such an airport comes into view from
// zoom 13, a hidden map of 2000 px at zoom 14 (about 3 km each way) is opened over it once and its vector
// tiles are read. The result is kept in the browser (IndexedDB: js/idb.js) for the airports seen last.
const OBSTACLE_KEY = 'flightgame.obstacles';
const OBSTACLES_KEPT = 60;
FG.obstacles = FG.obstacles || {};
FG.idb.adopt([OBSTACLE_KEY]).then(() => FG.idb.get(OBSTACLE_KEY)).then((kept) => {
  if (!kept) return;
  // (read in this session already: the newer one stays)
  for (const [code, o] of Object.entries(kept)) if (!FG.obstacles[code]) FG.obstacles[code] = o;
  if (FG.layouts) FG.layouts.version++;
  v.gatesDirty = true;
});
let obstacleBusy = false;
function readObstacles() {
  const map = v.map;
  if (obstacleBusy || map.getZoom() < 13) return;
  const b = map.getBounds();
  const real = new Set(D.layouts || []);
  // (only where no real layout came off the tiles either: js/osmairports.js)
  const a = D.airports.find((x) => !x.factory && !real.has(x.code) && !FG.obstacles[x.code] && b.contains([x.lon, x.lat])
    && FG.layouts.settled(x.code) && !FG.layouts.has(x.code));
  if (!a) return;
  obstacleBusy = true;
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;width:2000px;height:2000px';
  document.body.appendChild(box);
  const side = new maplibregl.Map({ container: box, style: 'https://tiles.openfreemap.org/styles/liberty', center: [a.lon, a.lat], zoom: 14,
    interactive: false, pixelRatio: 1, attributionControl: false });
  const finish = () => {
    if (!box.isConnected) return;
    const r5 = (n) => Math.round(n * 1e5) / 1e5;
    const lines = [];
    const rings = [];
    for (const f of side.querySourceFeatures('openmaptiles', { sourceLayer: 'aeroway' })) {
      if (f.properties.class !== 'taxiway') continue;
      const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
      for (const l of parts) for (let i = 1; i < l.length; i++) lines.push([[r5(l[i - 1][1]), r5(l[i - 1][0])], [r5(l[i][1]), r5(l[i][0])]]);
    }
    for (const f of side.querySourceFeatures('openmaptiles', { sourceLayer: 'building' })) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
      // one point in three is enough to tell whether the building lies in a rectangle
      for (const p of polys) rings.push(p[0].filter((c, i) => i % 3 === 0).map((c) => [r5(c[1]), r5(c[0])]));
    }
    const sb = side.getBounds();
    side.remove();
    box.remove();
    // `reach`: how far from the airport the surroundings are known, in metres
    FG.obstacles[a.code] = { lines, rings, reach: Math.round((sb.getNorth() - sb.getSouth()) * 111320 / 2) };
    const keep = Object.keys(FG.obstacles).slice(-OBSTACLES_KEPT);
    FG.idb.set(OBSTACLE_KEY, Object.fromEntries(keep.map((k) => [k, FG.obstacles[k]])));
    if (FG.layouts) FG.layouts.version++; // layouts and taxi ways made without them are dropped
    v.gatesDirty = true;
    obstacleBusy = false;
  };
  side.once('idle', finish);
  setTimeout(finish, 45000);
}

function refreshGates() {
  const map = v.map;
  readObstacles();
  const infra = (FG.layouts ? `${FG.layouts.version}.${FG.layouts.looked}` : 0) + (FG.facades ? `f${FG.facades.version}` : '') + (FG.devPreview ? `pv${FG.ui && FG.ui.selectedAirport}` : '') + Object.entries(G.state.infra).map(([c, i]) => `${c}${i.terminal || 0}${i.runways ? i.runways.length : ''}`).join();
  if (!v.gatesDirty && infra === v.gatesInfra) return;
  v.gatesDirty = false;
  v.gatesInfra = infra;
  let list = [];
  const gates = map.getZoom() >= GATE_MINZOOM;
  if (G.apronOf && map.getZoom() >= RUNWAY_MINZOOM) {
    // Bounds padded by ~8 km: zoomed in on a far corner of a big airport, its centre point is off screen,
    // but its runways and gates must stay.
    const b = map.getBounds();
    const pad = 0.075;
    const s = b.getSouth() - pad, n = b.getNorth() + pad;
    const kLon = pad / Math.max(0.2, Math.cos(Math.max(Math.abs(s), Math.abs(n)) * DEG));
    const w = b.getWest() - kLon, e = b.getEast() + kLon;
    list = D.airports.filter((a) => !a.factory && a.lat >= s && a.lat <= n
      && (w <= e ? a.lon >= w && a.lon <= e : a.lon >= w || a.lon <= e));
  }
  const sig = gates + infra + list.map((a) => `${a.code}:${G.airportSize(a.code)}:${G.airportRunways(a.code).length}`).join(',');
  if (sig === v.sig.gates) return;
  v.sig.gates = sig;
  const hide = [];
  map.getSource('fg-gates').setData(gateFeatures(list, gates, hide));
  hideMapBuildings(hide);
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
        const rw = G.legRunways ? G.legRunways(p, a, b) : null;
        const key = `${a}-${b}${rw ? `${rw.from}~${rw.to}` : ''}${p.id === sel ? '*' : ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // The planned runway-to-runway track when the game provides it (with the runways chosen for the plane), else
        // a great circle.
        const tr = G.legTrack && G.legTrack(p.type, a, b, rw);
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
  // Four times a second is enough (this runs after every frame), unless the selection or the view changed.
  const now = performance.now();
  if (sel === v.dataSel && !v.gatesDirty && now - v.dataAt < 250) return;
  v.dataSel = sel;
  v.dataAt = now;
  const aSig = `${Object.keys(G.state.slots).join(',')}|${D.airports.length}|${sel}`;
  if (aSig !== v.sig.airports) {
    v.sig.airports = aSig;
    map.getSource('fg-airports').setData(airportFeatures());
  }
  const rSig = `${G.state.planes.map((p) => `${p.id}:${p.schedule.stops.join('-')}:${p.status === 'flying' && p.flight.kind !== 'scheduled' ? p.flight.to : ''}${p.runways ? JSON.stringify(p.runways) : ''}`).join(',')}|${sel}|${G.windRev}`;
  if (rSig !== v.sig.routes) {
    v.sig.routes = rSig;
    map.getSource('fg-routes').setData(routeFeatures());
  }
  refreshGates();
}

// ---------- style ----------
const LOD = { zoomLevels: 13, tileRatio: 2 }; // see map.setSourceTileLodParams in createMap
// The flat layers are painted onto the terrain through a texture per terrain tile, 2048 px square (22 MB).
// On phones half that (5.6 MB): a little softer, and iPhones close the page when it uses too much memory.
// (MapLibre 6.13 has no option for it: the size is fixed when the terrain is set up, so it is set after that.)
function phoneDrapes(map) {
  const rtt = map.painter && map.painter.renderToTexture;
  if (!window.matchMedia('(pointer: coarse)').matches || !map.terrain || !rtt || typeof rtt.rttSize !== 'number') return;
  map.terrain.qualityFactor = 1;
  rtt.rttSize = map.terrain.tileManager.tileSize;
}
function transformStyle(_prev, style) {
  style.projection = { type: 'globe' };
  // Terrain heights from zoom 12 on are only made larger, not loaded finer: runways are flat, and the
  // finer tiles cost a lot of downloads and memory when zoomed in on an airport.
  style.sources.terrain = { type: 'raster-dem', url: 'https://tiles.mapterhorn.com/tilejson.json', maxzoom: 12 };
  style.sources.hillshade = { type: 'raster-dem', url: 'https://tiles.mapterhorn.com/tilejson.json', maxzoom: 13 };
  // Esri's aerial imagery, the same as the 2D map: sharp down to single aircraft (Sentinel-2 stopped at 10 m).
  style.sources.satellite = {
    type: 'raster', tileSize: 256, maxzoom: 18,
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
  };
  style.terrain = { source: 'terrain', exaggeration: TERRAIN_EXAG };
  style.sky = {
    'sky-color': '#7fb4ec', 'horizon-color': '#dbe9f7', 'fog-color': '#e6eef7',
    'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 8, 0],
  };
  const firstSymbol = style.layers.findIndex((l) => l.type === 'symbol');
  // The map's own land, water and roads lie under the satellite picture: not drawn (nor their tiles
  // read) while it shows. The background stays for where an aerial tile is still loading.
  v.underSatellite = style.layers.slice(0, firstSymbol).filter((l) => l.type !== 'background').map((l) => l.id);
  for (const l of style.layers.slice(0, firstSymbol)) {
    if (v.underSatellite.includes(l.id)) l.layout = { ...l.layout, visibility: v.satellite ? 'none' : (l.layout && l.layout.visibility) || 'visible' };
  }
  style.layers.splice(firstSymbol, 0,
    { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: v.satellite ? 'visible' : 'none' } },
    { id: 'hills', type: 'hillshade', source: 'hillshade', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#47402f' } });
  style.sources['fg-airports'] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  style.sources['fg-routes'] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  style.sources['fg-gates'] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  const visible = ['>=', ['zoom'], ['get', 'minz']];
  const kind = (k) => ['==', ['get', 'kind'], k];
  style.layers.push(
    { id: 'fg-taxiway-shoulders', type: 'line', source: 'fg-gates', minzoom: 13, filter: kind('taxiway'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#5f6670', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 10, ['get', 'e10'], 22, ['get', 'e22']] } },
    { id: 'fg-taxiways', type: 'line', source: 'fg-gates', minzoom: GATE_MINZOOM, filter: kind('taxiway'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#4a515c', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 10, ['get', 'w10'], 22, ['get', 'w22']] } },
    { id: 'fg-taxi-lines', type: 'line', source: 'fg-gates', minzoom: 14, filter: kind('twline'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#e3b70f', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 17, 1.6, 19, 3] } },
    { id: 'fg-runways', type: 'fill', source: 'fg-gates', minzoom: RUNWAY_MINZOOM, filter: kind('runway'),
      paint: { 'fill-color': ['case', ['==', ['get', 'paved'], 1], '#2b2f36', '#6f9a55'] } },
    { id: 'fg-apron', type: 'fill', source: 'fg-gates', minzoom: GATE_MINZOOM, filter: kind('apron'),
      paint: { 'fill-color': '#3a4049', 'fill-opacity': 1 } }, // (solid: the satellite's planes must not show through)
    { id: 'fg-pad', type: 'fill', source: 'fg-gates', minzoom: GATE_MINZOOM, filter: kind('pad'),
      paint: { 'fill-color': '#6b7280', 'fill-opacity': 1, 'fill-outline-color': '#cbd5e1' } },
    { id: 'fg-runway-lines', type: 'line', source: 'fg-gates', minzoom: 12, maxzoom: 14, filter: kind('rwline'),
      paint: { 'line-color': '#f3f4f6', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 2], 'line-dasharray': [6, 5] } },
    { id: 'fg-runway-paint', type: 'fill', source: 'fg-gates', minzoom: 14, filter: kind('rwpaint'),
      paint: { 'fill-color': '#eef0f3', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.75, 16, 0.95] } },
    { id: 'fg-holds', type: 'fill', source: 'fg-gates', minzoom: 15, filter: kind('hold'), paint: { 'fill-color': '#f2c40f' } },
    { id: 'fg-paint', type: 'line', source: 'fg-gates', minzoom: 15, filter: kind('paint'),
      paint: { 'line-color': '#e5e7eb', 'line-width': 1, 'line-opacity': 0.8 } },
    { id: 'fg-stands', type: 'line', source: 'fg-gates', minzoom: 14, filter: ['in', ['get', 'kind'], ['literal', ['lead', 'stop']]],
      layout: { 'line-cap': 'butt' },
      paint: { 'line-color': '#facc15', 'line-width': ['case', ['==', ['get', 'kind'], 'stop'], 3, 1.2] } },
    { id: 'fg-terminals', type: 'fill-extrusion', source: 'fg-gates', minzoom: GATE_MINZOOM, filter: kind('building'),
      paint: {
        'fill-extrusion-color': ['case', ['has', 'col'], ['get', 'col'], ['match', ['get', 'part'], 'tower', '#aab4c2', 'cab', '#27313f', 'hangar', '#7b8590', 'carpark', '#6b7280', 'hall', '#9aa7b8', 'bridge', '#c3ccd8', 'glass', '#35506a', 'roof', '#e3e7ed', 'plant', '#6d7682', 'canopy', '#dfe5ec', 'road', '#3b4048', 'mast', '#d1d5db', '#8a96a8']],
        'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.95,
      } },
    { id: 'fg-bridges', type: 'fill-extrusion', source: 'fg-gates', minzoom: 14, filter: kind('bridge'),
      paint: { 'fill-extrusion-color': '#b8c2cf', 'fill-extrusion-base': 3, 'fill-extrusion-height': 6.5 } },
    { id: 'fg-preview', type: 'fill', source: 'fg-gates', minzoom: RUNWAY_MINZOOM, filter: kind('preview'),
      paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.28, 'fill-outline-color': '#67e8f9' } },
    { id: 'fg-preview-lines', type: 'line', source: 'fg-gates', minzoom: 13, filter: kind('pvline'),
      paint: { 'line-color': '#22d3ee', 'line-width': 1.5, 'line-dasharray': [2, 2] } },
    { id: 'fg-preview-labels', type: 'symbol', source: 'fg-gates', minzoom: RUNWAY_MINZOOM, filter: kind('pvlabel'),
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-allow-overlap': true },
      paint: { 'text-color': '#a5f3fc', 'text-halo-color': '#083344', 'text-halo-width': 1.4 } },
    { id: 'fg-runway-numbers', type: 'symbol', source: 'fg-gates', minzoom: 14, filter: kind('rwnum'),
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-rotate': ['get', 'rot'], 'text-rotation-alignment': 'map', 'text-pitch-alignment': 'map',
        'text-size': ['interpolate', ['exponential', 2], ['zoom'], 13, ['get', 's13'], 19, ['get', 's19']], 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': '#eef0f3' } },
    { id: 'fg-gate-labels', type: 'symbol', source: 'fg-gates', minzoom: 16, filter: kind('label'),
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-allow-overlap': true },
      paint: { 'text-color': '#facc15', 'text-halo-color': '#000', 'text-halo-width': 1.2 } },
  );
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
  // Over terrain, MapLibre paints each run of flat layers (one not broken by labels, 3D buildings or
  // circles) into a texture of its own per terrain tile, 2048 px square (22 MB). Mixed in style order there
  // were six runs: low and tilted, 18 tiles × 6 = 2.4 GB, and iPhones closed the page. All flat layers come
  // first now (in their order), so there is one run; what stands on them is drawn over them anyway.
  const DRAPED = ['background', 'fill', 'line', 'raster', 'hillshade', 'color-relief'];
  style.layers = [...style.layers.filter((l) => DRAPED.includes(l.type)), ...style.layers.filter((l) => !DRAPED.includes(l.type))];
  return style;
}

// ---------- three.js layer ----------
const TERRAIN_EXAG = 1; // real hill heights (1.5 made the mountains look far too high); flight heights are stretched the same

// Shown ground height (already exaggerated) at an airport, remembered once the terrain there has loaded.
function fieldElevation(map, code) {
  v.elev = v.elev || {};
  if (v.elev[code] != null) return v.elev[code];
  const a = G.airportByCode[code];
  const e = a ? map.queryTerrainElevation([a.lon, a.lat]) : null;
  if (e != null && e !== 0) v.elev[code] = e;
  return e || 0;
}
// Shown height: the real height, but stretched when zoomed out so planes stay clearly above the ground.
// Height a plane is drawn at: heights in the game are above the airports, from the departure field's ground
// to the arrival field's, stretched like the hills, and never below the terrain under the plane; always
// clearly above the ground when zoomed out (shownAlt).
function drawnAlt(map, p, pose, len, exag) {
  const under = map.queryTerrainElevation([pose.lon, pose.lat]) || 0;
  let base = under;
  if (pose.st && pose.altM > 0) {
    const f = pose.st.airFrac;
    base = fieldElevation(map, p.flight.from) * (1 - f) + fieldElevation(map, p.flight.to) * f;
  }
  const rise = shownAlt(pose.altM * TERRAIN_EXAG, len, exag);
  return Math.max(base + rise, under + Math.min(rise, 150 * TERRAIN_EXAG) + (pose.altM > 0 ? len * exag * 0.12 : 0));
}
function shownAlt(altM, len, exag) {
  return Math.max(altM, (altM / 11000) * len * exag * 1.2) + len * exag * 0.12;
}

const tmp = { up: new THREE.Vector3(), east: new THREE.Vector3(), north: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), pos: new THREE.Vector3() };

// The longitude of the view being drawn (set by each layer's render before it places anything): flat, points are
// put in the copy of the world nearest it, so a plane over the Pacific beyond ±180° isn't drawn a world away.
let lonRef = 0;
// World frame for a point: sphere (radius 1) on the globe, mercator 0..1 otherwise (`keep`: the longitude as it is,
// for a line already unwrapped).
function frameAt(lat, lon, altM, globe, keep) {
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
  if (!keep) lon += 360 * Math.round((lonRef - lon) / 360);
  const mc = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], altM);
  pos.set(mc.x, mc.y, mc.z);
  east.set(1, 0, 0);
  north.set(0, -1, 0);
  up.set(0, 0, 1);
  return mc.meterInMercatorCoordinateUnits();
}

// three.js and MapLibre share the WebGL context: reset it and make MapLibre re-apply its own state.
function restoreGl(renderer, map) {
  renderer.resetState();
  if (map.painter && map.painter.context && map.painter.context.setDirty) map.painter.context.setDirty();
}

// Pose a plane's model (planeLayer and the chase camera): at the pose, `altM` up, `exag` times its real size,
// heading, bank and pitch eased towards the pose's (frame-rate independent). `lineUp`: parked planes (index
// at their airport) are lined up beside each other where they are drawn too big to stand at their gates.
function placeModel(e, pose, altM, exag, globe, now, lineUp) {
  const len = e.obj.userData.len;
  const unit = frameAt(pose.lat, pose.lon, altM, globe);
  // Ease heading, bank and pitch towards the target, so the plane turns, rolls and pitches
  // smoothly instead of snapping (frame-rate independent).
  const k = e.att ? 1 - Math.exp(-Math.min(0.25, (now - e.lastFrame) / 1000) / 0.35) : 1;
  if (!e.att) e.att = { heading: pose.heading, bank: 0, pitch: 0 };
  e.att.heading = (e.att.heading + wrap180(pose.heading - e.att.heading) * k + 360) % 360;
  e.att.bank += ((pose.bank || 0) - e.att.bank) * k;
  e.att.pitch += ((pose.pitch || 0) - e.att.pitch) * k;
  e.lastFrame = now;
  const h = e.att.heading * DEG;
  const pitch = e.att.pitch * DEG;
  const bank = e.att.bank * DEG;
  const { fwd, right, up, east, north, pos } = tmp;
  fwd.copy(north).multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
  right.copy(east).multiplyScalar(Math.cos(h)).addScaledVector(north, -Math.sin(h));
  // Pitch about the wing axis, then bank about the nose (right turn = right wing down).
  const nose = fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
  const lift = up.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(fwd, -Math.sin(pitch));
  const wing = right.clone().multiplyScalar(Math.cos(bank)).addScaledVector(lift, -Math.sin(bank));
  const top = lift.clone().multiplyScalar(Math.cos(bank)).addScaledVector(right, Math.sin(bank));
  right.copy(wing);
  // Zoomed out, enlarged parked planes would overlap at their gates: line them up instead.
  if (lineUp != null && !pose.flying && (!pose.gate || exag > 2.5)) {
    pos.addScaledVector(east, lineUp * len * exag * 1.1 * unit).addScaledVector(north, len * exag * 0.9 * unit);
  }
  const s = unit * exag;
  e.obj.matrix.makeBasis(right.multiplyScalar(s), nose.multiplyScalar(s), top.multiplyScalar(s)).setPosition(pos);
  e.obj.matrixWorldNeedsUpdate = true;
}

// ---------- clouds (js/weather.js puffs) ----------
// One batch of sprites in the planes' layer: one draw call however many clouds there are. Each puff is a point
// with its size in metres; the vertex shader turns that into pixels from how far it is (clip w) compared with the
// view centre, so they shrink with distance. Puffs the camera is right in fade out (and save the GPU the fill).
const CLOUD_MAX = 2600;
const CLOUD_VS = `
uniform float uScale; uniform vec4 uClip; uniform float uClipOn; uniform float uMaxPx; uniform float uAlpha;
attribute float size; attribute float shade; attribute float alpha; attribute float rot;
varying float vShade; varying float vAlpha; varying float vRot;
void main() {
  vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = c;
  float px = c.w > 0.0 ? size * uScale / c.w : 0.0;
  float a = alpha * uAlpha * clamp((uMaxPx - px) / (uMaxPx * 0.5), 0.0, 1.0);
  if (uClipOn > 0.5 && dot(uClip.xyz, position) + uClip.w < -0.002) a = 0.0; // behind the globe
  gl_PointSize = a > 0.0 ? px : 0.0;
  vShade = shade; vAlpha = a; vRot = rot;
}`;
const CLOUD_FS = `
uniform sampler2D uTex;
varying float vShade; varying float vAlpha; varying float vRot;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float cs = cos(vRot), sn = sin(vRot);
  vec4 t = texture2D(uTex, vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y) + 0.5);
  float a = t.a * vAlpha;
  if (a < 0.01) discard;
  vec3 col = mix(vec3(1.0), vec3(0.36, 0.4, 0.46), vShade) * (0.8 + 0.25 * (1.0 - gl_PointCoord.y)); // lit from above
  gl_FragColor = vec4(col, a);
}`;
function cloudPoints() {
  const g = new THREE.BufferGeometry();
  const attr = (n) => new THREE.BufferAttribute(new Float32Array(CLOUD_MAX * n), n).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', attr(3));
  for (const a of ['size', 'shade', 'alpha', 'rot']) g.setAttribute(a, attr(1));
  g.setDrawRange(0, 0);
  const tex = new THREE.CanvasTexture(FG.weather.sprite());
  const m = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uScale: { value: 1 }, uClip: { value: new THREE.Vector4() }, uClipOn: { value: 0 }, uMaxPx: { value: 700 }, uAlpha: { value: 1 } },
    vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false, depthTest: true,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 10;
  return pts;
}
// The puffs round the view centre (about three screens wide), again when the view or the game time changed,
// at most four times a second; the size uniform every frame.
function updateClouds(layer, map, globe, mpp, centerW, now) {
  const pts = layer.clouds;
  const on = !!(pts && FG.weather && FG.weather.enabled());
  if (!pts) return;
  pts.visible = on;
  if (!on) { FG.weather.n3d = 0; return; }
  const u = pts.material.uniforms;
  u.uScale.value = (centerW / mpp) * (window.devicePixelRatio || 1);
  u.uClipOn.value = v.clip ? 1 : 0;
  if (v.clip) u.uClip.value.set(v.clip[0], v.clip[1], v.clip[2], v.clip[3]);
  u.uMaxPx.value = 700 * (window.devicePixelRatio || 1);
  // close to an airport the clouds thin out, so it stays in view
  u.uAlpha.value = Math.max(0.3, Math.min(1, 1 - (map.getZoom() - 9) * 0.25));
  const c = map.getCenter();
  const halfKm = Math.min(9000, (map.getCanvas().clientWidth * mpp / 1000) * 1.6);
  const dLat = Math.min(85, halfKm / 111.32);
  const dLon = Math.min(180, dLat / Math.max(0.2, Math.cos(c.lat * DEG)));
  const t = G.state.time;
  const key = `${c.lat.toFixed(2)},${c.lng.toFixed(2)},${dLat.toFixed(3)},${globe},${t}`;
  if (key === v.cloudKey || now - (v.cloudAt || 0) < 250) return;
  v.cloudKey = key;
  v.cloudAt = now;
  const list = FG.weather.puffs({ s: c.lat - dLat, n: c.lat + dLat, w: c.lng - dLon, e: c.lng + dLon }, t, 1800, true);
  const g = pts.geometry;
  const P = g.attributes.position.array;
  const S = g.attributes.size.array;
  const H = g.attributes.shade.array;
  const A = g.attributes.alpha.array;
  const R = g.attributes.rot.array;
  const n = Math.min(CLOUD_MAX, list.length);
  for (let i = 0; i < n; i++) {
    const p = list[i];
    frameAt(p.lat, p.lon, p.alt * TERRAIN_EXAG, globe);
    P[i * 3] = tmp.pos.x; P[i * 3 + 1] = tmp.pos.y; P[i * 3 + 2] = tmp.pos.z;
    S[i] = p.r * 2.4; // (the blob fills about 85% of its sprite)
    H[i] = p.shade;
    A[i] = Math.min(1, p.a * 0.75);
    R[i] = p.rot;
  }
  for (const a of ['position', 'size', 'shade', 'alpha', 'rot']) g.attributes[a].needsUpdate = true;
  g.setDrawRange(0, n);
  FG.weather.n3d = n;
}
// The sky greys over under cloud and rain, and the haze comes closer in fog (map.setSky, only when it changes).
const SKY = { sky: '#7fb4ec', horizon: '#dbe9f7', fog: '#e6eef7' };
const GREY = { sky: '#8d99a6', horizon: '#c3cad2', fog: '#c9d0d7' };
const STORMY = { sky: '#56606b', horizon: '#848d97', fog: '#8f979f' };
function mixHex(a, b, k) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
function skyOf(w) {
  const grey = w ? Math.min(1, w.cover * 0.7 + w.rain * 0.4) : 0;
  const storm = w && w.storm ? 0.8 : 0;
  const col = (k) => mixHex(mixHex(SKY[k], GREY[k], grey), STORMY[k], storm);
  return {
    'sky-color': col('sky'), 'horizon-color': col('horizon'), 'fog-color': col('fog'),
    'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': w && w.fog ? 0.35 : w && w.rain > 0.5 ? 0.7 : 0.85,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 8, 0],
  };
}
function weatherSky(map, now) {
  if (now - (v.skyAt || 0) < 2000) return;
  v.skyAt = now;
  const on = FG.weather && FG.weather.enabled() && map.getZoom() >= 6;
  const c = map.getCenter();
  const w = on ? G.weatherAt(c.lat, c.lng, G.state.time) : null;
  const sky = skyOf(w);
  const key = JSON.stringify([sky['sky-color'], sky['fog-color'], sky['fog-ground-blend']]);
  if (key === v.skyKey) return;
  v.skyKey = key;
  setTimeout(() => { if (v.map === map) map.setSky(sky); }, 0); // (not inside the layer's render)
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
    // Everything is drawn relative to the view centre (see render): the aircraft and the track live in here.
    this.world = new THREE.Group();
    this.scene.add(this.world);
    if (FG.weather) { this.clouds = cloudPoints(); this.world.add(this.clouds); }
    this.v4 = new THREE.Vector4();
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.matrix = new THREE.Matrix4();
    this.shift = new THREE.Matrix4();
    // Creating the renderer changes the shared GL state too: hand it back to MapLibre clean, or the
    // first terrain tiles are drawn blank and stay cached that way (an empty map until a restyle).
    restoreGl(this.renderer, map);
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

    const now = performance.now();
    // The follow camera was put where the plane is at v.nextT (followTick): draw it there too.
    const t = v.nextT != null && now - v.nextAt < 1000 ? v.nextT : smoothTime(frameNow());
    v.nextT = null;
    const zoom = map.getZoom();
    const center = map.getCenter();
    const mpp = EARTH_CIRC * Math.cos(center.lat * Math.PI / 180) / (512 * 2 ** zoom); // metres per pixel
    const px = PLANE_PX * 2 ** (-Math.max(0, zoom - 8) * 0.5); // shrink towards real size when close
    const sel = FG.ui && FG.ui.selectedPlane;
    // Fly-by and wing cameras: the plane at its real size, always posed (the camera needs it), no flight path line.
    const cine = v.follow && v.cam !== 'chase' ? sel : null;

    // Light from above-left of the view centre.
    lonRef = center.lng;
    frameAt(center.lat, center.lng, 0, globe);
    const centerW = this.v4.set(tmp.pos.x, tmp.pos.y, tmp.pos.z, 1).applyMatrix4(this.matrix).w; // (cloud sizes)
    this.sun.position.copy(tmp.pos).addScaledVector(tmp.up, 1).addScaledVector(tmp.east, -0.6).addScaledVector(tmp.north, 0.4);
    this.sun.target.position.copy(tmp.pos);
    // Draw relative to the view centre: world coordinates (mercator 0..1, or a sphere of radius 1) are
    // too coarse as 32-bit floats, an aircraft's vertices would snap to a grid of about a metre.
    this.world.position.copy(tmp.pos).negate();
    this.camera.projectionMatrix.multiply(this.shift.makeTranslation(tmp.pos.x, tmp.pos.y, tmp.pos.z));

    // Planes outside the view are not posed or drawn at all (zoomed out, half the globe is in view anyway).
    const view = zoom >= 5 ? viewBox(map) : null;
    const parked = {}; // airport code -> planes on the ground there so far
    let moving = 0; // fastest plane in view, in pixels per second
    const alive = new Set();
    const livery = FG.livery().id;
    for (const p of G.state.planes) {
      alive.add(p.id);
      let e = v.planes[p.id];
      if (!e || e.type !== p.type || e.livery !== livery) { // (a new plane, or the airline changed its livery)
        if (e) this.world.remove(e.obj);
        e = v.planes[p.id] = { obj: planeModel(p.type), type: p.type, livery, world: new THREE.Vector3() };
        this.world.add(e.obj);
      }
      const flying = p.status === 'flying';
      const n = flying ? 0 : (parked[p.location] = (parked[p.location] || 0) + 1) - 1;
      const st = flying && G.flightState ? G.flightState(p, t) : null;
      if (view && p.id !== cine) {
        const at = st || (G.gateOf ? G.gateOf(p.location, p.id) : G.airportByCode[p.location]);
        if (at && !inBox(view, at.lat, at.lon)) {
          e.obj.visible = false;
          e.att = null; // eased afresh when it comes back
          continue;
        }
      }
      const pose = planePose(p, t, st);
      if (st && st.speedKmh) moving = Math.max(moving, (st.speedKmh / 3.6) * (FG.ui ? FG.ui.speed : 0) / mpp);
      const len = e.obj.userData.len;
      const exag = p.id === cine ? 1 : Math.max(1, px * mpp / len) * (p.id === sel ? 1.35 : 1);
      // Shown height: real cruise height, but always clearly above the ground when zoomed out.
      const altM = drawnAlt(map, p, pose, len, exag);
      if (p.id === sel && !cine) this.drawTrack(p, len, exag, globe);
      placeModel(e, pose, altM, exag, globe, now, n);
      const { pos } = tmp;
      e.world.copy(pos);
      e.lngLat = [pose.lon, pose.lat];
      e.heading = e.att.heading;
      e.altM = altM;
      e.exag = exag;
      e.pose = pose;
      e.pxLen = len * exag / mpp; // on-screen length, for clicking
      // Hide planes behind the globe.
      e.obj.visible = !v.clip || pos.x * v.clip[0] + pos.y * v.clip[1] + pos.z * v.clip[2] + v.clip[3] > -0.002;
    }
    for (const id of Object.keys(v.planes)) {
      if (!alive.has(id)) { this.world.remove(v.planes[id].obj); delete v.planes[id]; }
    }
    if (this.track && (cine || !(sel && v.planes[sel] && G.plane(sel) && G.plane(sel).status === 'flying'))) this.track.visible = false;
    updateClouds(this, map, globe, mpp, centerW, now);
    weatherSky(map, now);

    this.renderer.resetState();
    // Own depth buffer for the planes: sharing MapLibre's lets the (exaggerated) terrain and the
    // coarse depth precision cut holes into the models. Planes are then drawn over the terrain.
    this.renderer.clearDepth();
    // The flat map's projection is mirrored: tell the double-sided materials (see js/models3d.js).
    facing.value = this.camera.projectionMatrix.determinant() < 0 ? 1 : -1;
    this.renderer.render(this.scene, this.camera);
    facing.value = 1;
    // three.js and MapLibre share the WebGL context: put the GL state back and make MapLibre
    // re-apply its own, or real GPUs draw an empty map (texture uploads, framebuffer bindings).
    restoreGl(this.renderer, map);
    // Next frame: right away while a plane in view visibly moves or the camera follows one; planes that
    // crawl across the screen less often; when nothing in view moves (paused), once a second for the
    // planes that come into view.
    if (v.follow || moving > 30) map.triggerRepaint();
    else repaintIn(moving > 0 ? Math.min(250, 1000 / moving) : 1000);
  },
};

// Draw again in `ms`, or sooner when a plane or airport is selected or the camera starts following one.
function repaintIn(ms) {
  clearTimeout(v.repaintTimer);
  const due = performance.now() + ms;
  const check = () => {
    if (!v.on) return;
    const sel = FG.ui ? `${FG.ui.selectedAirport}|${FG.ui.selectedPlane}` : '';
    if (v.follow || sel !== v.dataSel || performance.now() >= due) v.map.triggerRepaint();
    else v.repaintTimer = setTimeout(check, Math.min(100, due - performance.now()));
  };
  v.repaintTimer = setTimeout(check, Math.min(100, ms));
}

// The part of the globe in view (padded so planes at the edge, drawn larger than life, don't pop),
// and whether a point lies in it (also across the antimeridian).
function viewBox(map) {
  const b = map.getBounds();
  const padLat = (b.getNorth() - b.getSouth()) * 0.25;
  const padLon = (b.getEast() - b.getWest()) * 0.25;
  return { s: b.getSouth() - padLat, n: b.getNorth() + padLat, w: b.getWest() - padLon, e: b.getEast() + padLon };
}
function inBox(box, lat, lon) {
  if (lat < box.s || lat > box.n) return false;
  if (box.e - box.w >= 360) return true;
  return [lon, lon - 360, lon + 360].some((x) => x >= box.w && x <= box.e);
}

// The selected plane's whole flight path as a line in the air (needs G.flightTrack).
const trackLons = new WeakMap(); // track -> its longitudes unwrapped
planeLayer.drawTrack = function (p, len, exag, globe) {
  const tr = p.status === 'flying' && G.flightTrack ? G.flightTrack(p) : null;
  if (!this.track) {
    this.track = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff9500 }));
    this.track.frustumCulled = false;
    this.world.add(this.track);
  }
  if (!tr) { this.track.visible = false; return; }
  const map = v.map;
  const e0 = fieldElevation(map, p.flight.from);
  const e1 = fieldElevation(map, p.flight.to);
  // (flat: unwrapped at ±180°, and as a whole in the copy of the world nearest the view, like the plane)
  if (!trackLons.has(tr)) trackLons.set(tr, unwrap(tr.pts).map((c) => c[0]));
  const lons = trackLons.get(tr);
  const mid = lons[lons.length >> 1];
  const shift = globe ? 0 : 360 * Math.round((lonRef - mid) / 360);
  const key = `${p.id}|${p.flight.dep}|${Math.round(Math.log2(exag) * 4)}|${globe}|${shift}|${Math.round(e0)}|${Math.round(e1)}|${tr.pts.length}|${tr.cruiseAlt}`;
  this.track.visible = true;
  if (this.track.userData.key === key) return;
  this.track.userData.key = key;
  // Same heights as the plane: between the two field elevations, stretched like the hills, above the terrain.
  const sLift = tr.cum[tr.idx.lift];
  const sTouch = tr.cum[tr.idx.touch];
  const pts = [];
  for (let i = 0; i < tr.pts.length; i++) {
    const lat = tr.pts[i][0];
    const lon = lons[i] + shift;
    const air = tr.cum[i] > sLift && tr.cum[i] < sTouch;
    const altM = air ? Math.max(0, tr.altAt(tr.cum[i]) - (tr.fieldAt ? tr.fieldAt(tr.cum[i]) : 0)) * 0.3048 : 0;
    const under = map.queryTerrainElevation([wrap180(lon), lat]) || 0;
    const f = Math.min(1, Math.max(0, (tr.cum[i] - sLift) / Math.max(0.001, sTouch - sLift)));
    const rise = shownAlt(altM * TERRAIN_EXAG, len, exag);
    const base = air ? e0 * (1 - f) + e1 * f : under;
    frameAt(lat, lon, Math.max(base + rise, under + Math.min(rise, 150 * TERRAIN_EXAG)), globe, true);
    pts.push(tmp.pos.clone());
  }
  this.track.geometry.dispose();
  // Points relative to the first one: 32-bit positions are too coarse for world coordinates.
  const base = pts[0].clone();
  this.track.geometry = new THREE.BufferGeometry().setFromPoints(pts.map((q) => q.sub(base)));
  this.track.position.copy(base);
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

// The plane under a screen point: within its drawn size, but never less than 18 px.
function planeAt(point) {
  let best = null;
  let bestD = Infinity;
  for (const [id, pe] of Object.entries(v.planes)) {
    const sp = planeScreen(pe);
    if (!sp) continue;
    const d = Math.hypot(sp.x - point.x, sp.y - point.y);
    const reach = Math.max(18, Math.min(80, (pe.pxLen || 0) * 0.6));
    if (d < reach && d < bestD) { best = id; bestD = d; }
  }
  return best;
}

const PHASE_TEXT = {
  boarding: 'Boarding', pushback: 'Pushing back', 'taxi-out': 'Taxiing to the runway', takeoff: 'Taking off', climb: 'Climbing',
  cruise: 'Cruising', descent: 'Descending', approach: 'On final', landing: 'Landing', 'taxi-in': 'Taxiing to the gate',
};

function hoverText(id) {
  const p = G.plane(id);
  const e = v.planes[id];
  if (!p || !e) return '';
  const ac = D.aircraft[p.type];
  let line;
  const st = e.pose && e.pose.st;
  if (p.status === 'flying' && st) {
    const f = p.flight;
    line = `${PHASE_TEXT[st.phase] || 'Flying'} · ${f.from} → ${f.to}<br>` +
      `${st.ground ? '' : `${Math.round(st.altFt / 100) * 100} ft · `}${st.speedKmh} km/h`;
  } else {
    line = `${p.status === 'turnaround' ? 'Turnaround' : 'At the gate'} · ${p.location}`;
  }
  return `<b>${G.planeLabel ? G.planeLabel(p) : p.id}</b> · ${ac.name}<br>${line}`;
}

function onMove(e) {
  v.hoverId = planeAt(e.point);
  v.map.getCanvas().style.cursor = v.hoverId ? 'pointer' : '';
  updateHover();
}

// Info box above the plane under the mouse; follows the plane while it moves.
function updateHover() {
  const e = v.hoverId && v.planes[v.hoverId];
  const sp = e && planeScreen(e);
  if (!sp) {
    if (v.hover) { v.hover.remove(); v.hover = null; }
    return;
  }
  if (!v.hover) {
    v.hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 18, className: 'plane-hover' })
      .addTo(v.map);
  }
  const html = hoverText(v.hoverId);
  if (html !== v.hoverHtml) { v.hover.setHTML(html); v.hoverHtml = html; }
  v.hover.setLngLat(v.map.unproject([sp.x, sp.y]));
}

function onClick(e) {
  if (performance.now() - (v.dragEnd || 0) < 400) return; // (the end of turning the camera round a plane)
  // "Build a new airport": the click picks the site, as on the 2D map.
  if (FG.ui.buildMode) { FG.ui.buildAt(e.lngLat.lat, e.lngLat.lng); return; }
  const best = planeAt(e.point);
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

function setFollow(on, cam) {
  const wasCine = v.follow && v.cam !== 'chase';
  v.follow = on && !!(FG.ui && FG.ui.selectedPlane);
  v.cam = v.follow ? cam || 'chase' : 'chase';
  v.followStart = v.follow;
  v.flyby = null;
  // (back from the fly-by or wing camera: the chase camera's usual tilt, not their view along the ground)
  v.orbit = { yaw: 0, pitch: wasCine ? 62 : null, base: null };
  camButtons();
  const map = v.map;
  if (!map) return;
  // While following, the camera centre floats at the plane's height instead of sitting on the ground.
  if (map.setCenterClampedToGround) map.setCenterClampedToGround(!v.follow);
  // ... and a drag turns the camera round the plane (see createMap) instead of moving the map.
  for (const h of [map.dragPan, map.dragRotate, map.touchPitch]) if (h) { if (v.follow) h.disable(); else h.enable(); }
  if (map.touchZoomRotate) { if (v.follow) map.touchZoomRotate.disableRotation(); else map.touchZoomRotate.enableRotation(); }
  // The fly-by camera looks up at planes passing over it and the wing camera rolls with the plane.
  const cine = v.follow && v.cam !== 'chase';
  map.setMaxPitch(cine ? 175 : 80);
  if (!cine && map.getRoll && map.getRoll()) map.jumpTo({ roll: 0 });
}
function camButtons() {
  for (const [cls, cam] of [['follow', 'chase'], ['flyby', 'flyby'], ['wing', 'wing']]) {
    document.querySelector(`#view3d .${cls}`)?.classList.toggle('active', v.follow && v.cam === cam);
  }
}

// The cameras of DCS: V the chase camera (F2 there), B the fly-by (F3), N the wing camera (F4). They follow the
// selected plane (the first one in the air if none is), and open the 3D view first. Pressed again, the fly-by
// moves on ahead and the wing camera changes wings.
function camera(mode) {
  if (!FG.ui || !G.state.planes.length) return;
  if (!G.plane(FG.ui.selectedPlane)) FG.ui.selectPlane((G.state.planes.find((p) => p.status === 'flying') || G.state.planes[0]).id);
  const go = () => {
    if (v.follow && v.cam === mode) {
      if (mode === 'flyby') v.flyby = null;
      if (mode === 'wing') v.wingSide = -v.wingSide;
    } else setFollow(true, mode);
    if (v.map) v.map.triggerRepaint();
  };
  if (v.on) go(); else confirm3d(() => { setOn(true); go(); });
}

// Following: the camera is put where the plane will be in the next frame, and the plane is drawn there (render
// uses v.nextT): centring on the last frame's position left the plane running ahead of the camera. The next frame is
// shown one frame interval after this one's timestamp: taking the clock whenever this code ran instead
// made the steps uneven (one short, the next long), which shows as stutter.
function followTick() {
  if (!v.follow) return;
  const p = G.plane(FG.ui.selectedPlane);
  const e = v.planes[FG.ui.selectedPlane];
  if (!p || !e) { setFollow(false); return; }
  const map = v.map;
  const at = frameNow();
  if (v.lastFrameAt != null) v.frameMs = 0.9 * (v.frameMs || 16.7) + 0.1 * Math.min(100, Math.max(4, at - v.lastFrameAt));
  v.lastFrameAt = at;
  v.nextT = smoothTime(at + (v.frameMs || 16.7));
  v.nextAt = performance.now();
  const pose = planePose(p, v.nextT);
  if (v.cam === 'flyby') flybyTick(map, p, e, pose);
  else if (v.cam === 'wing') wingTick(map, p, e, pose);
  else chaseTick(map, p, e, pose);
}

// Chase camera: behind the selected plane, turning with it; dragging turns it round the plane (it keeps that
// angle to the plane as the plane turns). Starts close in; the wheel still zooms.
function chaseTick(map, p, e, pose) {
  // (a plane that was out of view has no drawn heading and height yet)
  const drawn = e.obj.visible && e.altM != null;
  const heading = drawn ? e.heading : pose.heading;
  const o = v.orbit;
  if (o.base == null) o.base = drawn ? map.getBearing() : heading;
  o.base += wrap180(heading - o.base) * (drawn ? 0.06 : 1);
  const opts = { center: [pose.lon, pose.lat], bearing: o.base + o.yaw, pitch: o.pitch != null ? o.pitch : Math.max(map.getPitch(), 62) };
  if (v.followStart) {
    opts.zoom = pose.altM > 300 ? 12 : 17; // (on the ground close enough to see the plane itself)
    v.followStart = false;
  } else {
    opts.zoom = Math.max(map.getZoom(), 6.5);
  }
  // (at the height it is drawn at in that frame, not the last one: else a climbing plane bobs up and down)
  if (map.setCenterClampedToGround) opts.elevation = drawn ? drawnAlt(map, p, pose, e.obj.userData.len, e.exag) : pose.altM * TERRAIN_EXAG;
  map.jumpTo(opts);
}

// Where along its way the plane will be about a kilometre on (game minutes ahead, searched in growing steps);
// null when it won't get that far (parked, or at the end of its flight).
function poseAhead(p, t, km) {
  const now = planePose(p, t);
  for (let dt = 0.05; dt <= 30; dt *= 1.15) {
    const q = planePose(p, t + dt);
    if (G.distanceKm(now, q) >= km) return q;
  }
  return null;
}
const offsetLL = (lat, lon, east, north) => [lat + north / 111320, lon + east / (111320 * Math.cos(lat * DEG))];

// Fly-by camera (B): it waits about a kilometre ahead on the plane's way, a little to the side (on the ground: at
// eye height beside the taxiway or runway; in the air: just under its path), and turns to keep the plane in view
// as it passes. Once the plane is well past, it moves on ahead again. Planes are drawn at their real size.
function flybyTick(map, p, e, pose) {
  const len = e.obj.userData.len;
  const alt = drawnAlt(map, p, pose, len, 1);
  let c = v.flyby;
  const d = c && c.id === p.id ? G.distanceKm(pose, c) : Infinity;
  if (c && d < c.min) c.min = d;
  if (!c || c.id !== p.id || d > 3 || d > c.min + 0.6) {
    const ahead = poseAhead(p, v.nextT, 1);
    const q = ahead || pose;
    const side = ahead ? 50 + len : 2 * len + 30; // metres to the right of its way (or of a parked plane)
    const [lat, lon] = offsetLL(q.lat, q.lon, Math.cos(q.heading * DEG) * side, -Math.sin(q.heading * DEG) * side);
    const ground = map.queryTerrainElevation([lon, lat]) || 0;
    const qAlt = drawnAlt(map, p, q, len, 1);
    c = v.flyby = { id: p.id, lat, lon, alt: Math.max(ground + 4, q.altM > 30 ? qAlt - 12 : ground + 4), min: Infinity };
    c.min = G.distanceKm(pose, c);
  }
  // (the same point: nothing to look along)
  if (G.distanceKm(pose, c) * 1000 < 1 && Math.abs(alt - c.alt) < 1) return;
  const o = map.calculateCameraOptionsFromTo(new maplibregl.LngLat(c.lon, c.lat), c.alt, new maplibregl.LngLat(pose.lon, pose.lat), alt);
  map.jumpTo({ ...o, roll: 0 });
}

// Wing camera (N): fixed on the plane above the wing, out towards the tip and behind it, looking ahead along the
// plane; it turns, pitches and rolls with it (as drawn: the eased attitude of the last frame).
function wingTick(map, p, e, pose) {
  const len = e.obj.userData.len;
  const look = D.looks && D.looks[p.type];
  const span = (look && look.span) || len;
  const att = e.att || pose;
  const h = att.heading * DEG, th = (att.pitch || 0) * DEG, ph = (att.bank || 0) * DEG;
  // Body axes in metres east, north, up (as placeModel turns the model).
  const fwd = [Math.sin(h), Math.cos(h), 0], right = [Math.cos(h), -Math.sin(h), 0], up = [0, 0, 1];
  const comb = (a, ka, b, kb) => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
  const nose = comb(fwd, Math.cos(th), up, Math.sin(th));
  const lift = comb(up, Math.cos(th), fwd, -Math.sin(th));
  const wing = comb(right, Math.cos(ph), lift, -Math.sin(ph));
  const top = comb(lift, Math.cos(ph), right, Math.sin(ph));
  const at = (side, ahead, above) => [0, 1, 2].map((i) => wing[i] * side + nose[i] * ahead + top[i] * above);
  const s = v.wingSide;
  const cam = at(s * WING_CAM.out * span, -WING_CAM.back * len, WING_CAM.up * span + 1);
  const aim = at(s * WING_CAM.aimOut * span, WING_CAM.aimAhead * len, -WING_CAM.aimDown * len);
  const alt = drawnAlt(map, p, pose, len, 1);
  const [cLat, cLon] = offsetLL(pose.lat, pose.lon, cam[0], cam[1]);
  const [aLat, aLon] = offsetLL(pose.lat, pose.lon, aim[0], aim[1]);
  const o = map.calculateCameraOptionsFromTo(new maplibregl.LngLat(cLon, cLat), alt + cam[2], new maplibregl.LngLat(aLon, aLat), alt + aim[2]);
  map.jumpTo({ ...o, roll: att.bank || 0 });
}
// Wing camera spot (fractions of the span or length): out along the wing, behind the plane's centre, above the wing;
// it looks at a point ahead of the nose and below it.
const WING_CAM = { out: 0.3, back: 0.32, up: 0.08, aimOut: 0.12, aimAhead: 2.2, aimDown: 0.12 };

// ---------- terrain for new airports ----------
// FG.terrain.check(lat, lon): can an airport be built there? Resolves to null where the ground is fit for
// one, else to the reason. Fit is ground level enough for runways (heights from the terrain tiles the 3D view
// uses) that is neither water, ice nor a built-up area (from the map's vector tiles, read through a hidden
// map as for the obstacles). What cannot be found out (offline, a slow network) does not stand in the way.
const DEM = { url: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp', z: 11, size: 512 }; // terrarium heights
const demTiles = new Map(); // "x/y" -> promise of the tile's pixels
function demTile(x, y) {
  const key = `${x}/${y}`;
  if (!demTiles.has(key)) {
    if (demTiles.size > 40) demTiles.clear();
    demTiles.set(key, fetch(DEM.url.replace('{z}', DEM.z).replace('{x}', x).replace('{y}', y))
      .then((r) => { if (!r.ok) throw new Error(`terrain tile ${r.status}`); return r.blob(); })
      .then((blob) => createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
      .then((img) => {
        const c = document.createElement('canvas');
        c.width = c.height = DEM.size;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, DEM.size, DEM.size);
        return ctx.getImageData(0, 0, DEM.size, DEM.size).data;
      }));
  }
  return demTiles.get(key);
}
// Heights in metres at [lat, lon] points.
async function heightsAt(pts) {
  const n = 2 ** DEM.z;
  const where = pts.map(([lat, lon]) => {
    const x = ((lon + 180) / 360) * n;
    const s = Math.sin(Math.max(-85, Math.min(85, lat)) * DEG);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    return [((Math.floor(x) % n) + n) % n, Math.floor(y), Math.min(DEM.size - 1, Math.floor((x - Math.floor(x)) * DEM.size)), Math.min(DEM.size - 1, Math.floor((y - Math.floor(y)) * DEM.size))];
  });
  const tiles = {};
  await Promise.all([...new Set(where.map((w) => `${w[0]}/${w[1]}`))].map(async (k) => { tiles[k] = await demTile(...k.split('/').map(Number)); }));
  return where.map(([tx, ty, px, py]) => {
    const d = tiles[`${tx}/${ty}`];
    const i = (py * DEM.size + px) * 4;
    return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
  });
}
const around = (lat, lon, east, north) => [lat + north / 111320, lon + east / (111320 * Math.cos(lat * DEG))];

// Too steep? The ground under the first runways (800 m round the site) must be level within 70 m (the rest
// is earthworks), and the surroundings (2 km) must not be mountains.
async function slopeReason(lat, lon) {
  const inner = [];
  const outer = [];
  for (let e = -2000; e <= 2000; e += 200) {
    for (let n = -2000; n <= 2000; n += 200) {
      const r = Math.hypot(e, n);
      if (r <= 2000) (r <= 800 ? inner : outer).push(around(lat, lon, e, n));
    }
  }
  const h = await heightsAt([...inner, ...outer]);
  const spread = (list, lo, hi) => { const s = [...list].sort((a, b) => a - b); return s[Math.floor(hi * (s.length - 1))] - s[Math.floor(lo * (s.length - 1))]; };
  const near = spread(h.slice(0, inner.length), 0.1, 0.9);
  if (near > 70) return `Too steep here: the ground differs by ${Math.round(near)} m within 800 m. A runway needs level ground.`;
  const wide = spread(h, 0.25, 0.75);
  if (wide > 150) return `Too mountainous here: the ground differs by ${Math.round(wide)} m within 2 km.`;
  return null;
}

// Water, ice or a town? Looks at the site and at 16 points up to 1 km round it.
function coverReason(lat, lon) {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:-9999px;top:0;width:512px;height:512px';
    document.body.appendChild(box);
    const side = new maplibregl.Map({ container: box, style: 'https://tiles.openfreemap.org/styles/liberty', center: [lon, lat], zoom: 12,
      interactive: false, pixelRatio: 1, attributionControl: false });
    const pts = [[lat, lon]];
    for (const r of [500, 1000]) for (let i = 0; i < 8; i++) pts.push(around(lat, lon, r * Math.sin(i * Math.PI / 4), r * Math.cos(i * Math.PI / 4)));
    const inRing = (p, ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > p[0]) !== (b[1] > p[0]) && p[1] < ((b[0] - a[0]) * (p[0] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      return inside;
    };
    // How many of the points lie in the features of a layer (that `pick` lets through), and is the site one?
    const covered = (sourceLayer, pick) => {
      const polys = [];
      for (const f of side.querySourceFeatures('openmaptiles', { sourceLayer })) {
        if (!pick(f.properties)) continue;
        if (f.geometry.type === 'Polygon') polys.push(f.geometry.coordinates);
        else if (f.geometry.type === 'MultiPolygon') polys.push(...f.geometry.coordinates);
      }
      const hit = pts.map((p) => polys.some((poly) => poly.reduce((odd, ring) => odd !== inRing(p, ring), false)));
      return { site: hit[0], share: hit.filter(Boolean).length / pts.length };
    };
    let done = false;
    const finish = (known) => {
      if (done) return;
      done = true;
      let reason = null;
      if (known) {
        const water = covered('water', () => true);
        const ice = covered('landcover', (p) => p.class === 'ice');
        const town = covered('landuse', (p) => ['residential', 'commercial', 'industrial', 'retail'].includes(p.class));
        if (water.site || water.share > 0.3) reason = 'That is water: an airport needs dry ground.';
        else if (ice.site || ice.share > 0.3) reason = 'That is a glacier: no place for an airport.';
        else if (town.site || town.share > 0.3) reason = 'That is a built-up area: pick open land outside the town.';
      }
      side.remove();
      box.remove();
      resolve(reason);
    };
    side.once('idle', () => finish(true));
    side.on('error', () => {}); // (a tile that fails to load: what is there counts)
    setTimeout(() => finish(false), 12000);
  });
}

FG.terrain = {
  check(lat, lon) {
    return Promise.all([slopeReason(lat, lon).catch(() => null), coverReason(lat, lon).catch(() => null)]).then(([slope, cover]) => cover || slope);
  },
};

// ---------- setup ----------
function controls() {
  const box = document.createElement('div');
  box.className = 'view3d-controls';
  box.innerHTML = `<button class="home" title="Show my network">⌂</button>
    <button class="follow" title="Follow the selected plane; drag to look round it (V)">🎥<span> Follow</span></button>
    <button class="flyby" title="Fly-by: the camera waits ahead and watches the plane pass (B)">🎬<span> Fly-by</span></button>
    <button class="wing" title="Wing camera, on the plane's wing; again for the other wing (N)">🪽<span> Wing</span></button>
    <button class="sat" title="Satellite imagery">🛰<span> Satellite</span></button>`;
  box.querySelector('.home').onclick = () => { setFollow(false); fitNetwork(); };
  box.querySelector('.follow').onclick = () => {
    if (!FG.ui.selectedPlane) { FG.ui.selectPlane(G.state.planes[0] && G.state.planes[0].id); }
    setFollow(!v.follow || v.cam !== 'chase');
  };
  box.querySelector('.flyby').onclick = () => camera('flyby');
  box.querySelector('.wing').onclick = () => camera('wing');
  box.querySelector('.sat').onclick = (ev) => {
    v.satellite = !v.satellite;
    ev.currentTarget.classList.toggle('active', v.satellite);
    if (v.map.getLayer('satellite')) {
      v.map.setLayoutProperty('satellite', 'visibility', v.satellite ? 'visible' : 'none');
      for (const id of v.underSatellite || []) v.map.setLayoutProperty(id, 'visibility', v.satellite ? 'none' : 'visible');
    }
    savePrefs();
  };
  box.querySelector('.sat').classList.toggle('active', v.satellite);
  return box;
}

function createMap(fit) {
  const el = document.getElementById('view3d');
  const home = G.airportByCode[G.home()];
  // Roof colours read off the satellite photo: draw the airport's buildings again.
  if (FG.facades) FG.facades.onChange = () => { v.gatesDirty = true; if (v.on && v.map) v.map.triggerRepaint(); };
  // (where the 2D map is; back in 3D right at the page load, the whole network instead)
  const at = fit ? null : view2d();
  const map = v.map = new maplibregl.Map({
    container: el,
    center: at ? at.center : [home.lon, home.lat],
    zoom: at ? at.zoom : 4.5,
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
    // Tilted towards the horizon, far away tiles are loaded much coarser (and fewer of them) than
    // MapLibre's default (9.3 zoom levels on screen, 3× the tiles of a flat view): the distance shows
    // early as a rough picture, the detail only comes close to the camera.
    map.setSourceTileLodParams(LOD.zoomLevels, LOD.tileRatio);
    map.setSourceTileLodParams(LOD.zoomLevels + 2, 1.5, 'terrain');
    map.setSourceTileLodParams(LOD.zoomLevels + 2, 1.5, 'hillshade');
    phoneDrapes(map);
    map.addLayer(planeLayer, 'fg-airport-labels');
    v.ready = true;
    refreshData();
    if (!at) fitNetwork();
  });
  map.on('click', onClick);
  map.on('mousemove', onMove);
  map.on('mouseout', () => { v.hoverId = null; updateHover(); });
  map.on('mouseenter', 'fg-airports', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'fg-airports', () => { map.getCanvas().style.cursor = ''; });
  map.on('dragstart', () => setFollow(false));
  // Following, a drag (mouse, or one finger) turns the camera round the plane and tilts it, as in DCS's F2 view;
  // from the fly-by or wing camera it goes back to that one. (MapLibre's own dragging is off while following.)
  const touches = new Set();
  let drag = null;
  map.getCanvasContainer().addEventListener('pointerdown', (ev) => {
    touches.add(ev.pointerId);
    drag = v.follow && touches.size === 1 ? { x: ev.clientX, y: ev.clientY, moved: false } : null;
  });
  window.addEventListener('pointermove', (ev) => {
    if (!drag || !v.follow || touches.size !== 1) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    if (v.cam !== 'chase') setFollow(true, 'chase');
    v.orbit.yaw = wrap180(v.orbit.yaw + dx * 0.35);
    v.orbit.pitch = Math.max(5, Math.min(80, (v.orbit.pitch != null ? v.orbit.pitch : map.getPitch()) - dy * 0.25));
    map.triggerRepaint();
  });
  const up = (ev) => {
    touches.delete(ev.pointerId);
    if (drag && drag.moved) v.dragEnd = performance.now();
    if (!touches.size) drag = null;
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  map.on('moveend', () => { v.gatesDirty = true; });
  map.on('render', () => { if (v.ready && v.on) { refreshData(); followTick(); if (v.hoverId) updateHover(); } });
  // Keep mouse events away from the Leaflet map underneath.
  for (const t of ['mousedown', 'click', 'dblclick', 'wheel', 'touchstart', 'pointerdown', 'contextmenu']) {
    el.addEventListener(t, (ev) => ev.stopPropagation());
  }
}

// ---------- chase camera (the plane window, js/planewin.js) ----------
// A small 3D view of its own behind and above one plane, turning with it, as in OpenTTD's vehicle windows:
// v.chase(container, id) -> { setPlane(id), resize(), destroy() }. The planes near it are drawn at their real
// size, the airports round it with their runways, taxiways and gates. The wheel zooms; the rest follows.
const CHASE_KM = 25; // planes and airports drawn round the camera
function chaseLayer(cam) {
  return {
    id: 'fg-chase-planes',
    type: 'custom',
    renderingMode: '3d',
    onAdd(map, gl) {
      this.map = map;
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
      this.scene.add(this.sun, this.sun.target);
      this.world = new THREE.Group();
      this.scene.add(this.world);
      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
      this.matrix = new THREE.Matrix4();
      this.shift = new THREE.Matrix4();
      restoreGl(this.renderer, map);
    },
    render(gl, args) {
      const map = this.map;
      const pd = args.defaultProjectionData;
      const globe = map.getProjection().type === 'globe' && pd.projectionTransition >= 0.5;
      this.matrix.fromArray(globe ? pd.mainMatrix : pd.fallbackMatrix);
      this.camera.projectionMatrix.copy(this.matrix);
      const now = performance.now();
      const t = cam.t != null ? cam.t : smoothTime(frameNow());
      const center = map.getCenter();
      lonRef = center.lng;
      frameAt(center.lat, center.lng, 0, globe);
      this.sun.position.copy(tmp.pos).addScaledVector(tmp.up, 1).addScaledVector(tmp.east, -0.6).addScaledVector(tmp.north, 0.4);
      this.sun.target.position.copy(tmp.pos);
      this.world.position.copy(tmp.pos).negate();
      this.camera.projectionMatrix.multiply(this.shift.makeTranslation(tmp.pos.x, tmp.pos.y, tmp.pos.z));
      const dLat = CHASE_KM / 111;
      const dLon = dLat / Math.max(0.05, Math.cos(center.lat * DEG));
      const alive = new Set();
      const livery = FG.livery().id;
      for (const p of G.state.planes) {
        const st = p.status === 'flying' && G.flightState ? G.flightState(p, t) : null;
        const pose = planePose(p, t, st);
        if (Math.abs(pose.lat - center.lat) > dLat || Math.abs(wrap180(pose.lon - center.lng)) > dLon) continue;
        alive.add(p.id);
        let e = cam.planes[p.id];
        if (!e || e.type !== p.type || e.livery !== livery) {
          if (e) this.world.remove(e.obj);
          e = cam.planes[p.id] = { obj: planeModel(p.type), type: p.type, livery };
          this.world.add(e.obj);
        }
        e.obj.visible = true;
        e.altM = drawnAlt(map, p, pose, e.obj.userData.len, 1);
        placeModel(e, pose, e.altM, 1, globe, now, null);
      }
      for (const id of Object.keys(cam.planes)) {
        if (!alive.has(id)) { this.world.remove(cam.planes[id].obj); delete cam.planes[id]; }
      }
      this.renderer.resetState();
      this.renderer.clearDepth();
      facing.value = this.camera.projectionMatrix.determinant() < 0 ? 1 : -1;
      this.renderer.render(this.scene, this.camera);
      facing.value = 1;
      restoreGl(this.renderer, map);
    },
  };
}
function chase(container, id) {
  const cam = { id, t: null, bearing: null, zoom: null, userZoom: false, planes: {}, ready: false, dead: false, gatesSig: '', gatesAt: 0 };
  const map = new maplibregl.Map({
    container, center: [0, 0], zoom: 15, pitch: 72, maxPitch: 85,
    canvasContextAttributes: { antialias: true }, attributionControl: false,
    dragPan: false, dragRotate: false, keyboard: false, doubleClickZoom: false, touchZoomRotate: false, boxZoom: false,
  });
  map.setStyle('https://tiles.openfreemap.org/styles/liberty', { transformStyle });
  if (map.setCenterClampedToGround) map.setCenterClampedToGround(false);
  map.once('style.load', () => {
    map.setSourceTileLodParams(LOD.zoomLevels, LOD.tileRatio);
    phoneDrapes(map);
    map.addLayer(chaseLayer(cam), 'fg-airport-labels');
    map.getSource('fg-airports').setData(airportFeatures());
    cam.ready = true;
  });
  // (the wheel zooms the camera in and out; it keeps that distance from then on)
  map.on('zoomend', (e) => { if (e.originalEvent) { cam.zoom = map.getZoom(); cam.userZoom = true; } });
  for (const t of ['mousedown', 'click', 'dblclick', 'wheel', 'touchstart', 'pointerdown', 'contextmenu']) {
    container.addEventListener(t, (ev) => ev.stopPropagation());
  }
  const tick = () => {
    if (cam.dead) return;
    cam.raf = requestAnimationFrame(tick);
    const p = G.plane(cam.id);
    if (!p || !cam.ready) return;
    cam.t = smoothTime(frameNow() + 16.7);
    const pose = planePose(p, cam.t);
    const e = cam.planes[p.id];
    const heading = e && e.att ? e.att.heading : pose.heading;
    cam.bearing = cam.bearing == null ? heading : (cam.bearing + wrap180(heading - cam.bearing) * 0.06 + 360) % 360;
    // (as close in the air as on the ground: the plane stays as big; the wheel takes the camera further out)
    if (!cam.userZoom) cam.zoom = 17.2;
    const opts = { center: [pose.lon, pose.lat], bearing: cam.bearing, pitch: 72, zoom: cam.zoom };
    if (map.setCenterClampedToGround) opts.elevation = e && e.altM != null ? e.altM : drawnAlt(map, p, pose, 40, 1);
    map.jumpTo(opts);
    // the airports round it, every two seconds
    const now = performance.now();
    if (now - cam.gatesAt > 2000) {
      cam.gatesAt = now;
      const list = D.airports.filter((a) => !a.factory && Math.abs(a.lat - pose.lat) < CHASE_KM / 111 && Math.abs(a.lon - pose.lon) < CHASE_KM / 111 / Math.max(0.05, Math.cos(pose.lat * DEG)));
      const sig = (FG.layouts ? `${FG.layouts.version}.${FG.layouts.looked}` : '') + list.map((a) => `${a.code}:${G.airportRunways(a.code).length}`).join(',');
      if (sig !== cam.gatesSig) { cam.gatesSig = sig; map.getSource('fg-gates').setData(gateFeatures(list, true)); }
    }
    map.triggerRepaint();
  };
  cam.raf = requestAnimationFrame(tick);
  return {
    setPlane(n) { if (n !== cam.id) { cam.id = n; cam.bearing = null; cam.zoom = null; cam.userZoom = false; } },
    resize() { map.resize(); },
    destroy() { cam.dead = true; cancelAnimationFrame(cam.raf); map.remove(); },
  };
}
v.chase = chase;

// 2D and 3D show the same place: switching keeps the centre and the scale (tilt and turn stay the 3D
// view's own). Leaflet counts zoom in 256 px tiles, MapLibre in 512 px ones: the same scale is one level apart.
function view2d() {
  const m2 = FG.ui && FG.ui.map;
  if (!m2) return null;
  const c = m2.getCenter();
  return { center: [c.lng, c.lat], zoom: m2.getZoom() - 1 };
}
function from2d() {
  const at = view2d();
  if (!at || !v.map) return;
  setFollow(false);
  v.map.jumpTo(at);
}
function to2d() {
  const m2 = FG.ui && FG.ui.map;
  if (!m2 || !v.map) return;
  const c = v.map.getCenter();
  m2.setView([c.lat, c.lng], Math.round(v.map.getZoom() + 1), { animate: false });
}

function setOn(on, atLoad) {
  v.on = on;
  document.getElementById('view3d').hidden = !on;
  document.getElementById('view3d-toggle').classList.toggle('active', on);
  document.body.classList.toggle('in-3d', on);
  if (on) {
    if (!v.map) createMap(atLoad);
    else { from2d(); v.map.resize(); v.map.triggerRepaint(); }
  } else {
    to2d();
    setFollow(false);
  }
  savePrefs();
}

// The 3D view is made for strong devices: the first time it opens (in every session, until "don't ask again")
// a warning says so, with the graphics chip the browser reports.
const OK3D_KEY = 'flightgame.3d-ok';
let ok3dSession = false;
const ok3d = () => { try { return ok3dSession || !!localStorage.getItem(OK3D_KEY); } catch (e) { return ok3dSession; } };
function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return name;
  } catch (e) {
    return null;
  }
}
function confirm3d(then) {
  if (ok3d()) { then(); return; }
  if (document.getElementById('warn3d')) return;
  const gpu = gpuName();
  const soft = !gpu || /swiftshader|llvmpipe|software|basic render/i.test(gpu);
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const el = document.createElement('div');
  el.id = 'warn3d';
  el.innerHTML = `<div class="w3-card" role="dialog" aria-modal="true" aria-labelledby="w3-title">
    <h2 id="w3-title"><span>⚠</span>3D view: for strong devices</h2>
    <p>The 3D view draws the terrain, satellite pictures, airports and every aircraft in 3D. It needs a fast graphics
      chip – a gaming PC, or a recent laptop or Mac.</p>
    <p>On phones, tablets and older computers it can be slow, make the device hot and drain the battery. The 2D map
      shows everything too.</p>
    <div class="w3-gpu${soft ? ' slow' : ''}">${!gpu ? 'Your browser has no 3D graphics (WebGL): the 3D view will not work here.'
      : soft ? `Your browser draws 3D without a graphics chip (${gpu}): the 3D view will be very slow.`
        : `Graphics chip: ${gpu}`}${touch ? '<br>This looks like a phone or tablet.' : ''}</div>
    <label class="check"><input type="checkbox" id="w3-again"> Don't ask again on this device</label>
    <div class="row"><button data-w3="no">Stay in 2D</button><button class="primary" data-w3="yes">Open 3D view</button></div>
  </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-w3]');
    if (!b && e.target !== el) return;
    const yes = !!b && b.dataset.w3 === 'yes';
    if (yes) {
      ok3dSession = true;
      try { if (el.querySelector('#w3-again').checked) localStorage.setItem(OK3D_KEY, '1'); } catch (err) { /* private mode */ }
    }
    el.remove();
    if (yes) then();
  });
}
const toggle3d = () => (v.on ? setOn(false) : confirm3d(() => setOn(true)));

function init() {
  const prefs = loadPrefs();
  v.satellite = prefs.satellite !== false; // satellite imagery unless switched off
  document.getElementById('view3d-toggle').addEventListener('click', toggle3d);
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!document.getElementById('start-screen').hidden) return;
    // V: back to the chase camera from the fly-by or wing camera, else 2D ⇄ 3D. B: fly-by, N: wing camera.
    if (e.key === 'v' || e.key === 'V') { if (v.on && v.follow && v.cam !== 'chase') setFollow(true, 'chase'); else toggle3d(); }
    if (e.key === 'b' || e.key === 'B') camera('flyby');
    if (e.key === 'n' || e.key === 'N') camera('wing');
    if (e.key === 'Escape' && document.getElementById('warn3d')) document.getElementById('warn3d').remove();
  });
  // (back in 3D as last time only on a device where the warning was answered for good)
  if (prefs.on && ok3d()) setOn(true, true);
}

if (FG.ui) init();
else window.addEventListener('fg-ui-ready', init, { once: true });

// Used by the plane strip in ui.js: double-click a plane to follow it.
v.setFollow = (on) => setFollow(on);
v.setOn = (on) => setOn(on);
v.from2d = () => from2d(); // the 2D map moved while 3D is open (a new game, a loaded save)
FG.view3d = v; // for debugging
