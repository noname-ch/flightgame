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
// A type with sharklets (FG.data.looks `sharklets`) gets them built onto a copy of its model of its own (addSharklets).
const shapedRaws = {};   // type -> Promise of the reshaped unpainted scene
function rawOf(type, size) {
  const look = FG.data.looks[type];
  const cut = look.plugs && FG.data.plugs && FG.data.plugs[size.file];
  if (!cut && !look.sharklets) return raw(size.file);
  if (!shapedRaws[type]) {
    // (sharklets on geometry of their own: js/livery.js marks each geometry once, and the plain model's are shared
    // with the types without them)
    const base = look.sharklets
      ? new GLTFLoader().loadAsync(new URL(`${size.file}.glb`, MODELS).href).then((gltf) => addSharklets(gltf.scene, size))
      : raw(size.file);
    shapedRaws[type] = cut ? base.then((scene) => reshape(scene, cut, size.stretch - 1, look.engines || 1, type)) : base;
  }
  return shapedRaws[type];
}

// Airbus's sharklets, the A320neo family's wing tips: blended up out of the wing in a curve and on as a tall blade,
// leaning out a little, its leading edge swept far back and its chord narrowing to the top. The models are the older
// A320s', whose wings end flat. Metres: 2.43 m tall (Airbus), `cant` from upright, `r` the radius of the curve, the
// leading edge `le` and the trailing edge `te` further back at the top than at the foot (photographs); the span comes
// out 0.85 m longer each side, as Airbus's 35.80 m instead of 34.10 m. `in`: the foot starts this far inboard of the
// model's wing tip, round the wing there (a little bigger, so the wing never shows through), and covers its rounded end.
const SHARKLET = { h: 2.43, cant: 12, r: 0.45, le: 1.7, te: 0.6, in: 0.8 };
const SHARK_C = Array.from({ length: 11 }, (_, k) => (1 - Math.cos(Math.PI * k / 10)) / 2);  // chord stations, LE 0 .. TE 1

// Where the plane x = `x` cuts the model's wing: leading and trailing edge [y, z], chord, and the skin above and below
// the chord line at each SHARK_C station (as shares of the chord).
function wingSection(meshes, x) {
  const pts = [];
  const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const o of meshes) {
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      for (let k = 0; k < 3; k++) tri[k].fromBufferAttribute(pos, idx ? idx.getX(t + k) : t + k).applyMatrix4(o.matrixWorld);
      for (let k = 0; k < 3; k++) {
        const p = tri[k], q = tri[(k + 1) % 3];
        if ((p.x - x) * (q.x - x) >= 0) continue;
        const f = (x - p.x) / (q.x - p.x);
        pts.push([p.y + (q.y - p.y) * f, p.z + (q.z - p.z) * f]);
      }
    }
  }
  if (pts.length < 4) return null;
  let le = pts[0], te = pts[0];
  for (const p of pts) { if (p[0] > le[0]) le = p; if (p[0] < te[0]) te = p; }
  const chord = le[0] - te[0];
  if (!(chord > 0)) return null;
  const sides = [[[0, 0], [1, 0]], [[0, 0], [1, 0]]];   // [c, offset / chord] above, below
  for (const [y, z] of pts) {
    const c = (le[0] - y) / chord;
    const off = (z - (le[1] + (te[1] - le[1]) * c)) / chord;
    sides[off >= 0 ? 0 : 1].push([c, Math.abs(off)]);
  }
  // (each side as a line through its points, the highest where several are at the same place along the chord)
  const [up, lo] = sides.map((s) => {
    s.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const line = s.filter((p, i) => i === 0 || p[0] - s[i - 1][0] > 1e-4);
    return SHARK_C.map((c) => {
      const i = line.findIndex((p) => p[0] >= c);
      if (i < 0) return line[line.length - 1][1];
      if (i === 0) return line[0][1];
      const a = line[i - 1], b = line[i];
      return a[1] + (b[1] - a[1]) * (c - a[0]) / (b[0] - a[0]);
    });
  });
  return { le, te, chord, up, lo };
}

// Builds sharklets onto both wing tips of an unpainted model (1 unit long, x = right wing, y = nose, z = up): one mesh
// 'sharklets' of its own, white (js/livery.js paints it: in the wing tips' colour where it stands upright, and it
// bends with the wing, livFlex). `size`: modelSize, for the metres. Its userData.nav are the spots of the wing tip
// lights (at the foot of each sharklet's leading edge: js/view3d.js navSpotsOf).
function addSharklets(scene, size) {
  scene.updateMatrixWorld(true);
  const meshes = [];
  let wingMat = null, tip = 0;
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.position || o.material.transparent) return;
    meshes.push(o);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.x > tip) { tip = v.x; wingMat = o.material; }
    }
  });
  const S = SHARKLET;
  const ux = 1 / size.wide, uy = 1 / size.len;   // model units per metre: across and up, along
  const x0 = tip - S.in * ux, xb = x0 - 0.6 * ux;
  const root = wingSection(meshes, x0);
  if (!root || !wingMat) return scene;
  const back = wingSection(meshes, xb);
  // the wing's lines out to the tip: leading and trailing edge, and the chord line's height (dihedral) at 30 % chord
  const mid = (s) => s.le[1] + (s.te[1] - s.le[1]) * 0.3;
  const slope = (f, lo, hi) => (back ? Math.max(lo, Math.min(hi, (f(root) - f(back)) / (x0 - xb))) : 0);
  const sL = slope((s) => s.le[0], -1.5, 0.5), sT = slope((s) => s.te[0], -1.5, 0.5), k = slope(mid, -0.3, 0.3);
  // (a little bigger than the wing all round)
  const grow = 0.012 * root.chord;
  const yL0 = root.le[0] + grow, yT0 = root.te[0] - grow, chord0 = yL0 - yT0;
  const dL0 = root.le[1] - mid(root), dT0 = root.te[1] - mid(root);
  const up0 = root.up.map((u) => u * root.chord / chord0 * 1.06 + 0.004), lo0 = root.lo.map((u) => u * root.chord / chord0 * 1.06 + 0.004);
  const naca = (c) => 0.45 * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4) + 0.001;   // 9 % thick
  // the path of the chord line's middle across x, z: along the wing to its tip, round the curve, up the blade
  const phi0 = Math.atan(k), phi1 = (90 - S.cant) * Math.PI / 180, r = S.r * ux;
  const A = [tip, mid(root) + k * (tip - x0)];
  const C = [A[0] - r * Math.sin(phi0), A[1] + r * Math.cos(phi0)];   // the curve's centre
  const arc = r * (phi1 - phi0);
  const rise = r * (Math.cos(phi0) - Math.cos(phi1));
  const blade = Math.max(0.2 * S.h * ux, (S.h * ux - rise) / Math.sin(phi1));
  const total = arc + blade, cap = 0.15 * ux;
  const tipChord = chord0 + sL * (tip - x0) - sT * (tip - x0);
  // the sections: path distance from the wing tip (below 0: along the wing, from the foot at x0)
  const along = (tip - x0) * Math.hypot(1, k);
  const ss = [-along, -along / 2, 0];
  for (let i = 1; i <= 10; i++) ss.push(arc * i / 10);
  for (let i = 1; i <= 8; i++) ss.push(arc + (blade - cap) * i / 8);
  for (let i = 1; i <= 4; i++) ss.push(total - cap + cap * Math.sin(Math.PI / 2 * i / 4));
  const ring = 2 * SHARK_C.length - 1;   // points round each section: above LE .. TE, below TE .. after the LE
  const posR = [];
  let nav = null;
  for (const s of ss) {
    let ox, oz, phi, yL, yT;
    let up = up0, lo = lo0, dL = dL0, dT = dT0, thick = 1;
    if (s <= 0) {
      const x = tip + s / Math.hypot(1, k);
      ox = x; oz = A[1] + k * (x - tip); phi = phi0;
      yL = yL0 + sL * (x - x0); yT = yT0 + sT * (x - x0);
    } else {
      if (s <= arc) {
        phi = phi0 + s / r;
        ox = C[0] + r * Math.sin(phi); oz = C[1] - r * Math.cos(phi);
      } else {
        phi = phi1;
        const e = [C[0] + r * Math.sin(phi1), C[1] - r * Math.cos(phi1)];
        ox = e[0] + (s - arc) * Math.cos(phi1); oz = e[1] + (s - arc) * Math.sin(phi1);
      }
      const u = s / total;
      const yLt = yL0 + sL * (tip - x0);
      yL = yLt - S.le * uy * u ** 1.15;
      yT = yLt - tipChord - S.te * uy * u ** 1.6;
      // (the wing's own section turns into a plain thin one in the curve; rounded off at the top)
      const f = Math.min(1, u / 0.35), blend = f * f * (3 - 2 * f);
      const ch = (yL - yT) / uy * ux;   // the chord in model units across
      up = up0.map((a, i) => a + (naca(SHARK_C[i]) * ch / (yL - yT) - a) * blend);
      lo = lo0.map((a, i) => a + (naca(SHARK_C[i]) * ch / (yL - yT) - a) * blend);
      dL = dL0 * (1 - blend); dT = dT0 * (1 - blend);
      const w = (s - (total - cap)) / cap;
      if (w > 0) { thick = Math.sqrt(Math.max(0, 1 - w * w)); yL -= 0.3 * (yL - yT) * w * w; }
    }
    const n = [-Math.sin(phi), Math.cos(phi)];   // across the section (up at the foot, inboard on the blade)
    const chord = yL - yT;
    const point = (c, off) => {
      const d = dL + (dT - dL) * c + off * chord * thick;
      posR.push(ox + n[0] * d, yL - chord * c, oz + n[1] * d);
    };
    SHARK_C.forEach((c, i) => point(c, up[i]));
    for (let i = SHARK_C.length - 1; i >= 1; i--) point(SHARK_C[i], -lo[i]);
    if (s === 0) nav = [ox + n[0] * dL, yL + 0.05 * uy, oz + n[1] * dL];
  }
  // faces between the sections, and a lid on the foot (inside the wing)
  const idx = [];
  for (let j = 0; j + 1 < ss.length; j++) {
    for (let i = 0; i < ring; i++) {
      const a = j * ring + i, b = j * ring + (i + 1) % ring, c = a + ring, d = b + ring;
      idx.push(a, c, b, b, c, d);
    }
  }
  const lid = posR.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < ring; i++) { cx += posR[3 * i]; cy += posR[3 * i + 1]; cz += posR[3 * i + 2]; }
  posR.push(cx / ring, cy / ring, cz / ring);
  for (let i = 0; i < ring; i++) idx.push(lid, i, (i + 1) % ring);
  // both sides: the left one mirrored (and its faces turned, to face out as well)
  const count = posR.length / 3;
  const pos = new Float32Array(posR.length * 2);
  pos.set(posR);
  for (let i = 0; i < count; i++) pos.set([-posR[3 * i], posR[3 * i + 1], posR[3 * i + 2]], (count + i) * 3);
  const all = idx.concat(idx.map((_, i) => count + idx[i - (i % 3) + [0, 2, 1][i % 3]]));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(all);
  g.computeVertexNormals();
  // (no engine, propeller or control surface in it: js/livery.js leaves it unsearched)
  g.setAttribute('livPart', new THREE.BufferAttribute(new Float32Array(pos.length / 3), 1));
  g.setAttribute('livSurf', new THREE.BufferAttribute(new Float32Array(pos.length / 3 * 4), 4));
  g.userData.livSearched = true;
  g.userData.livSurfaced = true;
  // (facing out: the skin above the foot's middle faces up)
  if (g.attributes.normal.getZ(5) < 0) {
    for (let i = 0; i < all.length; i += 3) [all[i + 1], all[i + 2]] = [all[i + 2], all[i + 1]];
    g.setIndex(all);
    g.computeVertexNormals();
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: wingMat.roughness ?? 0.65, metalness: wingMat.metalness ?? 0, side: wingMat.side });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'sharklets';
  mesh.userData.addOn = true;   // (not the model's own: js/livery.js measures the wing without it)
  mesh.userData.nav = [nav, [-nav[0], nav[1], nav[2]]];
  scene.add(mesh);
  scene.userData.wingletX = tip;   // (the wing tips' colour on them only: js/livery.js)
  return scene;
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
    (FG.data.looks[type].plugs || FG.data.looks[type].sharklets ? `|${type}` : '');
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
