// Loads the 3D aircraft models for the 3D view and the hangar, painted in the airline livery: glTF files
// (models/*.glb, see models/README.md), with landing gear (js/gear3d.js).
// FG.data.models says which aircraft type uses which model.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { paintLivery, maskOf } from './livery.js';
import { addGear, gearKey } from './gear3d.js';

const MODELS = new URL('../models/', import.meta.url);
const raws = {};    // file -> Promise of the unpainted scene
const loads = {};   // file + stretch + livery -> Promise of the painted scene

// The 3D map draws with MapLibre's projection, which is mirrored on the flat map compared to an ordinary
// camera. three.js then takes the front of each face for its back and lights double-sided materials from
// the wrong side. While it draws in that case the map sets facing.value to -1 (see js/view3d.js).
export const facing = { value: 1 };

// Shader patch for a double-sided material (onBeforeCompile) that makes it follow `facing`.
export function patchFacing(shader) {
  shader.uniforms.mapFacing = facing;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float mapFacing;')
    .replace('#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\nnormal *= mapFacing;\nnonPerturbedNormal = normal;\n#endif');
}

// How to draw a type with its model, which is 1 unit long: `len` (m) along the fuselage and `wide` (m)
// across it. A type with its own model gets the same for both. A type that borrows a relative's model keeps
// that model's wing, at a fuselage as thick as its own, and is stretched to its own length: `stretch`.
export function modelSize(type) {
  const file = FG.data.models[type];
  const look = FG.data.looks[type];
  if (!file || !look) return null;
  const own = FG.data.modelSize[file];
  let wide = own ? own[0] * look.dia / own[1] : look.len;
  if (Math.abs(look.len / wide - 1) < 0.04) wide = look.len;
  return { file, len: look.len, wide, stretch: Math.round(look.len / wide * 50) / 50 };
}

function raw(file) {
  if (!raws[file]) {
    raws[file] = new GLTFLoader().loadAsync(new URL(`${file}.glb`, MODELS).href).then((gltf) => gltf.scene);
  }
  return raws[file];
}

// A type drawn with plugs (FG.data.looks `plugs`, cut where FG.data.plugs says for its model) is stretched the way
// real ones are: barrel sections of its fuselage, windows and all, are repeated ahead of and behind the wing, while
// the nose, the wing, the tail and the engines keep their shape (a type without plugs is stretched all over, wing
// chord too). `engines` (× the model's) makes the engines bigger, grown forward and down from where they hang. The
// unpainted scene, 1 unit long and centred like every model.
const shapedRaws = {};   // type -> Promise of the reshaped unpainted scene
function rawOf(type, size) {
  const look = FG.data.looks[type];
  const cut = FG.data.plugs && FG.data.plugs[size.file];
  if (!look.plugs || !cut) return raw(size.file);
  if (!shapedRaws[type]) shapedRaws[type] = raw(size.file).then((scene) => reshape(scene, cut, size.stretch - 1, look.engines || 1, type));
  return shapedRaws[type];
}

// How many barrel sections go in ahead of and behind the wing to add `extra` (model lengths): as near as can be,
// with about `ahead` of it ahead.
function plugCount(cut, extra) {
  const wF = cut.front[1] - cut.front[0], wB = cut.back[1] - cut.back[0];
  let best = null;
  for (let f = 0; f * wF <= extra + wF; f++) {
    for (let b = 0; b * wB <= extra + wB; b++) {
      const got = f * wF + b * wB;
      const miss = Math.abs(got - extra) + 0.05 * Math.abs((got ? f * wF / got : cut.ahead) - cut.ahead);
      if (!best || miss < best.miss) best = { f, b, miss };
    }
  }
  return { f: best.f, b: best.b, wF, wB };
}

function reshape(src, cut, extra, grow, key) {
  const scene = src.clone();
  const n = plugCount(cut, extra);
  const add = [n.b * n.wB, n.f * n.wF];   // behind the rear sections, ahead of the front ones
  const c = (add[1] - add[0]) / 2;        // (back to the middle)
  const k = 1 / (1 + add[0] + add[1]);    // (and to 1 unit long)
  const e = cut.engine;
  const EPS = 2e-4;
  const inside = (y, [y0, y1]) => y >= y0 - EPS && y <= y1 + EPS;
  // A section is seldom quite a cylinder (the A350's rear one already sweeps up to the tail): its copies are bent
  // to the shape of the ring away from the wing at both ends, so they meet each other and the nose or tail part
  // without a step. Each ring as its radius round the inner ring's middle, by angle.
  const ringAt = (y) => {
    const pts = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i) - y) < EPS && Math.abs(pos.getX(i)) < cut.body) pts.push([pos.getX(i), pos.getZ(i)]);
      }
    });
    return pts;
  };
  const bend = (sec, inner, outer) => {
    const a = ringAt(inner), b = ringAt(outer);
    if (a.length < 8 || b.length < 8) return null;
    const zs = a.map((p) => p[1]);
    const zc = (Math.min(...zs) + Math.max(...zs)) / 2;
    const polar = (pts) => pts.map(([x, z]) => [Math.atan2(z - zc, x), Math.hypot(x, z - zc)]).sort((p, q) => p[0] - q[0]);
    const radius = (ring, t) => {
      let i = ring.findIndex((p) => p[0] >= t);
      if (i < 0) i = ring.length;
      const [t0, r0] = i === 0 ? [ring[ring.length - 1][0] - 2 * Math.PI, ring[ring.length - 1][1]] : ring[i - 1];
      const [t1, r1] = i === ring.length ? [ring[0][0] + 2 * Math.PI, ring[0][1]] : ring[i];
      return t1 - t0 < 1e-9 ? r0 : r0 + (r1 - r0) * (t - t0) / (t1 - t0);
    };
    const A = polar(a), B = polar(b);
    // (x, z) of a vertex at y in a copy: moved out by the difference between the rings, all of it at the inner ring
    return (x, y, z) => {
      const u = Math.max(0, Math.min(1, (y - outer) / (inner - outer)));
      const t = Math.atan2(z - zc, x);
      const d = u * (radius(B, t) - radius(A, t));
      const r = Math.hypot(x, z - zc) || 1;
      return [x + d * x / r, z + d * (z - zc) / r];
    };
  };
  const bends = { front: n.f ? bend(cut.front, cut.front[0], cut.front[1]) : null, back: n.b ? bend(cut.back, cut.back[1], cut.back[0]) : null };
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const pos = g.attributes.position;
    // the engines first, in the model's own shape
    if (grow !== 1) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (Math.abs(x) < e.x[0] || Math.abs(x) > e.x[1] || y < e.y[0] || y > e.y[1] || z < e.z[0] || z > e.z[1]) continue;
        const ax = Math.sign(x) * e.at[0];
        pos.setXYZ(i, ax + (x - ax) * grow, e.at[1] + (y - e.at[1]) * grow, e.at[2] + (z - e.at[2]) * grow);
      }
    }
    // each triangle: a fuselage one in a barrel section stays and is copied once per plug; the rest move with the
    // nose or the tail (a long one across a cut, which the A350 has only along its belly, stretches)
    const attrs = Object.keys(g.attributes);
    const out = Object.fromEntries(attrs.map((a) => [a, []]));
    const put = (i, dy, bent) => {
      for (const a of attrs) {
        const at = g.attributes[a];
        if (a === 'position') {
          let x = at.getX(i), z = at.getZ(i);
          if (bent) [x, z] = bent(x, at.getY(i), z);
          out[a].push(x, at.getY(i) + dy, z);
        } else for (let j = 0; j < at.itemSize; j++) out[a].push(at.array[i * at.itemSize + j]);
      }
    };
    const moved = (y) => (y >= cut.front[1] - EPS ? add[1] : y <= cut.back[0] + EPS ? -add[0] : 0);
    for (let t = 0; t < pos.count; t += 3) {
      const ys = [0, 1, 2].map((j) => pos.getY(t + j));
      const body = [0, 1, 2].every((j) => Math.abs(pos.getX(t + j)) < cut.body);
      const plug = !body ? null : ys.every((y) => inside(y, cut.front)) ? [n.f, n.wF, bends.front] : ys.every((y) => inside(y, cut.back)) ? [n.b, -n.wB, bends.back] : null;
      if (plug) {
        for (let r = 0; r <= plug[0]; r++) for (let j = 0; j < 3; j++) put(t + j, r * plug[1], r ? plug[2] : null);
      } else {
        for (let j = 0; j < 3; j++) put(t + j, moved(ys[j]));
      }
    }
    const shaped = new THREE.BufferGeometry();
    for (const a of attrs) {
      const at = g.attributes[a];
      shaped.setAttribute(a, new THREE.BufferAttribute(new at.array.constructor(out[a]), at.itemSize, at.normalized));
    }
    const P = shaped.attributes.position, N = shaped.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      P.setY(i, (P.getY(i) - c) * k);
      // (squashed to 1 unit long and drawn stretched to the type's length, the normals squash the other way)
      if (N) {
        const nx = N.getX(i), ny = N.getY(i) / k, nz = N.getZ(i);
        const l = Math.hypot(nx, ny, nz) || 1;
        N.setXYZ(i, nx / l, ny / l, nz / l);
      }
    }
    shaped.computeBoundingBox();
    shaped.computeBoundingSphere();
    o.geometry = shaped;
  });
  // (what js/livery.js needs to find the model's own spots, given in the unstretched model's y: shapedY)
  scene.userData.shape = { key, front: cut.front[1], back: cut.back[0], add, c, k };
  return scene;
}

// The disc a propeller turning fast makes (FG.data.props): see-through dark grey with the yellow ring of the
// blade tips. Hidden here; js/view3d.js fades it in as the propellers spin up (and the shader hides the blades).
let discMaterial = null;
function propDiscs(scene, file) {
  const prop = FG.data.props && FG.data.props[file];
  // (only where the propellers turn: js/livery.js marks their blades with their hub, livHub)
  let turns = false;
  scene.traverse((o) => {
    const hub = o.isMesh && o.geometry.attributes.livHub;
    if (hub && !turns) for (let i = 2; i < hub.array.length; i += 3) if (hub.array[i] > 0.5) { turns = true; break; }
  });
  if (!prop || !turns) return scene;
  if (!discMaterial) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [at, col] of [[0, 'rgba(32,34,38,0)'], [0.22, 'rgba(32,34,38,0.12)'], [0.5, 'rgba(32,34,38,0.22)'],
      [0.86, 'rgba(32,34,38,0.24)'], [0.89, 'rgba(242,182,0,0.42)'], [0.96, 'rgba(242,182,0,0.34)'], [1, 'rgba(242,182,0,0)']]) grad.addColorStop(at, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    discMaterial = new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  }
  const discs = new THREE.Group();
  discs.name = 'propDiscs';
  discs.visible = false;
  for (const s of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(prop.r * 1.03, 48).rotateX(Math.PI / 2), discMaterial);
    d.position.set(s * prop.x, prop.y + prop.t * 0.5, prop.z);
    discs.add(d);
  }
  scene.add(discs);
  return scene;
}

// The model of a type painted in a livery (the airline's, FG.livery(), unless another is asked for), 1 unit
// long: scale it with modelSize(type). The scene is shared, clone() it
// for every aircraft drawn. Stretched types get their own materials, so the livery can keep its proportions.
export function loadModel(type, livery = FG.livery()) {
  const size = modelSize(type);
  const { file, stretch } = size;
  const key = `${file}|${stretch}|${FG.liveries ? FG.liveries.key(livery) : livery.id}|${gearKey(type, file)}|${maskOf(file, type) ? 'mask' : ''}` +
    (FG.data.looks[type].plugs ? `|${type}` : '');
  if (!loads[key]) {
    loads[key] = rawOf(type, size).then((scene) => {
      const copy = scene.clone();
      copy.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
      return propDiscs(addGear(paintLivery(copy, file, patchFacing, stretch, livery, type), scene, file, size, patchFacing, type), file);
    });
    loads[key].catch((e) => console.warn(`3D model ${file} not loaded`, e));
  }
  return loads[key];
}

// A type painted in a livery afresh, not kept: the livery designer (js/liverywin.js) paints its draft again on
// every change, and the cache would keep each one.
export function paintFresh(type, livery) {
  const size = modelSize(type);
  if (!size) return Promise.reject(new Error(`no model for ${type}`));
  return rawOf(type, size).then((scene) => {
    const copy = scene.clone();
    copy.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
    return addGear(paintLivery(copy, size.file, patchFacing, size.stretch, livery, type), scene, size.file, size, patchFacing, type);
  });
}
