// Landing gear for the 3D aircraft models (js/models3d.js adds it to every model that has none of its own):
// a nose gear, the main legs and, on the big ones, legs under the fuselage, at real sizes (FG.data.gear).
// Each leg has its tyres (grooved, squashed a little under the weight) on wheels with brakes, its axles or
// bogie with pitch trimmer, a chromed piston in the shock absorber's cylinder, the torque link, hydraulic hoses,
// folding stays, on the nose leg the steering collar and taxi lights, and the gear doors. Where the legs go is
// read from the model: the wing root for the main legs, the underside for where each leg is fixed, the model's
// lowest point for the ground. The gear is the object named 'gear'; js/view3d.js folds it away in flight
// (setGear) and works the shock absorbers (setOleo): the piston with the wheels slides out of its cylinder in the
// air and back in as the plane settles onto it. Model axes: x = right wing, y = nose, z = up, 1 unit long.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const layouts = {};   // gear (gearKey) -> where the legs go (from the unpainted model, once)
const built = {};     // gear|stretch -> the gear group, cloned for every livery

// The gear a type gets: its own entry in FG.data.gear (a type with other gear than its model's), else its model's.
export const gearKey = (type, file) => (type && FG.data.gear[type] ? type : file);

let material = null;   // the gear's parts are painted with vertex colours (PAINT)
function gearMaterial(patchFacing) {
  if (!material) {
    material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide });
    material.onBeforeCompile = patchFacing;
    material.customProgramCacheKey = () => 'facing';
  }
  return material;
}

// The first surface a ray meets, or null.
function hit(scene, from, dir) {
  const ray = new THREE.Raycaster(from, dir);
  const h = ray.intersectObject(scene, true);
  return h.length ? h[0].point : null;
}

// Where the legs go, in model units, read from the model once. `unit`: metres per model unit across it.
function layout(scene, gear, unit, len) {
  if (layouts[gear]) return layouts[gear];
  scene.updateMatrixWorld(true);
  const spec = FG.data.gear[gear] || {};
  const box = new THREE.Box3().setFromObject(scene);
  const up = new THREE.Vector3(0, 0, 1);
  // Fuselage between the cockpit and the wing: its top, its bottom and its half width.
  const top = hit(scene, new THREE.Vector3(0, 0.25, 2), new THREE.Vector3(0, 0, -1));
  const bottom = hit(scene, new THREE.Vector3(0, 0.25, -2), up);
  const zc = top && bottom ? (top.z + bottom.z) / 2 : 0;
  const side = hit(scene, new THREE.Vector3(2, 0.25, zc), new THREE.Vector3(-1, 0, 0));
  const hw = side ? side.x : 0.05;
  // The wing root: what the plane x = 1.35 half widths cuts, as runs along y; the one nearest the middle.
  const x0 = hw * 1.35;
  const spans = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld);
      const xs = v.map((p) => p.x);
      if (Math.min(...xs) > x0 || Math.max(...xs) < x0) continue;
      const ys = v.map((p) => p.y);
      if (Math.max(...ys) < -0.32 || Math.min(...ys) > 0.36) continue;
      spans.push([Math.min(...ys), Math.max(...ys)]);
    }
  });
  spans.sort((a, b) => a[0] - b[0]);
  const runs = [];
  for (const s of spans) {
    const r = runs[runs.length - 1];
    if (r && s[0] <= r[1] + 0.004) r[1] = Math.max(r[1], s[1]);
    else runs.push([s[0], s[1]]);
  }
  const wing = runs.filter((r) => r[1] - r[0] > 0.03)
    .sort((a, b) => Math.abs((a[0] + a[1]) / 2) - Math.abs((b[0] + b[1]) / 2))[0] || [-0.1, 0.1];
  const chord = wing[1] - wing[0];
  // (where the data says, as a share of the length from the nose, else behind the middle of the wing root)
  const mainY = spec.mainAt != null ? 0.5 - spec.mainAt : wing[1] - (spec.main === 'wing' ? 0.65 : 0.55) * chord;
  // Main legs apart: in the engine nacelles where the nacelle hangs lowest, else so many fuselage widths.
  let track = (spec.track || 0.9) * 2 * hw;
  let low = null;   // (the lowest point of the nacelles)
  if (spec.main === 'nacelle') {
    low = { z: Infinity, x: track };
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      const p = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (Math.abs(p.x) > 1.4 * hw && Math.abs(p.x) < 0.3 && p.y > wing[0] && p.y < wing[1] && p.z < low.z) low = { z: p.z, x: Math.abs(p.x) };
      }
    });
    track = low.x;
  }
  // The ground: below the lowest point of the model by the usual clearance (in metres). A tail-wheel
  // aircraft stands on legs of `leg` metres below its nacelles and sits nose up on its tail wheel: `sit`
  // (radians) is how far, and the ground under the tail is that much higher.
  const ground = spec.tail && low ? low.z - spec.leg / unit : box.min.z - Math.max(0.45, 0.012 * len) / unit;
  // Where a leg is fixed: the underside above it (on the fuselage side for 'body' legs).
  const under = (x, y) => {
    const p = hit(scene, new THREE.Vector3(x, y, -2), up);
    return p ? p.z : zc;
  };
  const legs = [];
  const tyre = (spec.tyre || 1.1) / unit;
  const noseY = 0.5 - (spec.nose || 0.11);
  let sit = 0;
  if (spec.tail) {
    const y = -0.43;
    const top = under(0, y);
    const d = tyre * 0.45;
    const floor = top - 0.35 / unit - d;   // the tail wheel's lowest point, on a short leg
    sit = Math.atan2(floor - ground, mainY - y);
    legs.push({ kind: 'tail', x: 0, y, top, at: 0, side: 0, tyre: d, wheels: '1x1', ground: floor });
  } else legs.push({ kind: 'nose', x: 0, y: noseY, top: under(0, noseY), at: 0, side: 0, tyre: spec.noseTyre ? spec.noseTyre / unit : tyre * 0.68, wheels: '1x2' });
  for (const s of [-1, 1]) {
    const x = s * track;
    // 'body' legs are fixed in the fairing (pannier) on the fuselage side and hang straight down from its
    // underside; where the model has no fairing out there, from just above the belly
    const belly = bottom ? bottom.z : zc;
    const pannier = Math.min(under(x, mainY), belly + 0.3 * (zc - belly));
    const fixed = spec.main === 'body' ? { at: x, top: pannier } : { at: x, top: under(x, mainY) };
    legs.push({ kind: spec.main || 'wing', x, y: mainY, top: fixed.top, at: fixed.at, side: s, tyre, wheels: spec.wheels || '1x2', tilt: spec.tilt });
  }
  if (spec.body) {
    const y = mainY - spec.body.aft;
    for (const s of spec.body.track ? [-1, 1] : [0]) {
      const x = s * spec.body.track * 2 * hw;
      legs.push({ kind: 'centre', x, y, top: under(x, y), at: x, side: s, tyre, wheels: spec.body.wheels, tilt: spec.tilt });
    }
  }
  return (layouts[gear] = { ground, legs, sit, mainY });
}

// ---------- parts ----------
// Every part is painted with its colour (a vertex colour), so a leg is one mesh.
const PAINT = {
  tyre: 0x17181b,    // rubber
  leg: 0xc6cad0,     // the legs' grey paint
  chrome: 0xeef1f4,  // the shock absorber's piston, pins
  wheel: 0xc2c7cd,   // the wheels' bare metal
  dark: 0x2a2c30,    // brakes, hoses, the open gear bays
  door: 0xeceef1,    // gear doors, painted like the fuselage underside
};
const tint = new THREE.Color();
function paint(g, hex) {
  tint.setHex(hex);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([tint.r, tint.g, tint.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
// A rod (cylinder) of radius r from a to b.
function rod(a, b, r, seg = 10) {
  const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}
// A box of these sizes, centred at p.
const box = (p, sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz).translate(p.x, p.y, p.z);
const ball = (p, r) => new THREE.SphereGeometry(r, 8, 6).translate(p.x, p.y, p.z);
// A lathe round the x axis at p: the profile is [radius, along x] pairs (along x: + is towards +x).
function lathe(prof, p, seg) {
  return new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), seg).rotateZ(-Math.PI / 2).translate(p.x, p.y, p.z);
}
// A tyre of radius r and width w round the x axis at p: rounded shoulders, three grooves in the tread, and
// flattened where it stands on the ground (z = floor) under the weight.
function tyreAt(p, r, w, floor) {
  const prof = [[0.55, -0.5], [0.84, -0.5], [0.95, -0.42], [0.99, -0.3], [1, -0.25], [0.975, -0.21], [1, -0.17],
    [1, -0.04], [0.975, 0], [1, 0.04], [1, 0.17], [0.975, 0.21], [1, 0.25], [0.99, 0.3], [0.95, 0.42], [0.84, 0.5], [0.55, 0.5]];
  const g = lathe(prof.map(([a, b]) => [a * r, b * w]), p, 32);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < floor) pos.setZ(i, floor);
  return g;
}
// A wheel in its tyre: a dished rim with the hub on the outer side (`out`: +1 or -1 along x), its circle of
// wheel bolts and the axle nut, a plain face inside, and on main wheels the brake pack showing inside.
function wheelAt(p, r, w, out, brake, parts) {
  const face = [[0, 0.5], [0.24, 0.5], [0.27, 0.44], [0.44, 0.38], [0.57, 0.44], [0.6, 0.5], [0.6, 0]];
  parts.push(paint(lathe(face.map(([a, b]) => [a * r, out * b * w]), p, 24), PAINT.wheel));
  parts.push(paint(lathe([[0.6 * r, 0], [0.6 * r, -out * 0.48 * w], [0.3 * r, -out * 0.42 * w], [0, -out * 0.44 * w]], p, 20), PAINT.wheel));
  const x = (f) => p.x + out * f * w;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const b = p.clone().add(new THREE.Vector3(0, Math.cos(a) * r * 0.18, Math.sin(a) * r * 0.18));
    parts.push(paint(rod(b.clone().setX(x(0.48)), b.clone().setX(x(0.56)), r * 0.025, 6), PAINT.chrome));
  }
  parts.push(paint(rod(p.clone().setX(x(0.48)), p.clone().setX(x(0.62)), r * 0.08, 6), PAINT.chrome));
  if (brake) parts.push(paint(rod(p.clone().setX(p.x - out * 0.42 * w), p.clone().setX(p.x - out * 0.68 * w), r * 0.46, 16), PAINT.dark));
}

let light = null;   // the taxi lights' material
function lightMaterial(patchFacing) {
  if (!light) {
    light = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff0c8, emissiveIntensity: 1.1, roughness: 0.3 });
    light.onBeforeCompile = patchFacing;
    light.customProgramCacheKey = () => 'facing';
  }
  return light;
}

// How each leg folds away, about where it is fixed: main legs under the wing inwards (about the y axis), the
// nose gear and legs in nacelles or on the fuselage sides forwards, the legs under the fuselage of the big
// ones backwards (about the x axis). Radians; a main leg's sign follows its side. The tail wheel stays.
const FOLD = { wing: ['y', 1.53], nose: ['x', 1.62], nacelle: ['x', 1.5], body: ['x', 1.4], centre: ['x', -1.5] };

// One leg: a group fixed where the leg is (so it can fold about there) with its parts as one mesh, plus the
// open bay and the bay doors beside it. Built round y = 0 and moved to the leg's y, made `stretch` times
// shorter along y, as the model is drawn that much longer than wide (the tyres stay round).
function leg(l, ground, stretch, mats, out) {
  const r = l.tyre / 2;
  const w = r * 0.62;
  const [rows, across] = l.wheels.split('x').map(Number);
  const floor = l.ground ?? ground;
  const axle = floor + r * 0.95;      // (the tyres are a little squashed under the weight)
  const pitch = r * 2.2;              // between the axles of a bogie
  const gap = w * 1.2 + r * 0.22;     // between the tyres on an axle
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const parts = [];   // the cylinder and what is fixed to it
  const slide = [];   // what slides with the piston: the piston, the axles and the wheels (not on a tail wheel)
  const lights = [];
  const main = l.kind !== 'nose' && l.kind !== 'tail';
  const oleo = l.kind !== 'tail';
  const low = oleo ? slide : parts;
  // A bogie that tilts in flight (l.tilt) is a mesh of its own, turning about its pivot below the piston.
  const tilts = rows > 1 && l.tilt;
  const wheels = tilts ? [] : low;
  // tyres on their wheels, the axles, the bogie beam with its pivot
  for (let i = 0; i < rows; i++) {
    const dy = rows > 1 ? (i - (rows - 1) / 2) * pitch : 0;
    for (let k = 0; k < across; k++) {
      const dx = across > 1 ? (k - (across - 1) / 2) * gap : 0;
      const p = V(l.x + dx, dy, axle);
      wheels.push(paint(tyreAt(p, r, w, floor), PAINT.tyre));
      wheelAt(p, r, w, dx ? Math.sign(dx) : l.side || 1, main, wheels);
    }
    if (across > 1) wheels.push(paint(rod(V(l.x - gap / 2, dy, axle), V(l.x + gap / 2, dy, axle), r * 0.14, 10), PAINT.leg));
  }
  const foot = V(l.x, 0, axle + (rows > 1 ? r * 0.22 : r * 0.05));
  const head = V(l.at, 0, Math.max(l.top, axle + r * 1.25));
  const at = (f) => foot.clone().lerp(head, f);
  const thick = r * (main ? 0.25 : 0.2);
  if (rows > 1) {
    wheels.push(paint(rod(V(l.x, -((rows - 1) * pitch) / 2 - r * 0.3, axle + r * 0.08), V(l.x, ((rows - 1) * pitch) / 2 + r * 0.3, axle + r * 0.08), r * 0.17, 10), PAINT.leg));
    wheels.push(paint(rod(V(l.x - thick * 1.4, 0, foot.z), V(l.x + thick * 1.4, 0, foot.z), r * 0.13, 10), PAINT.chrome));
    // the pitch trimmer: from the leg to the front of the bogie
    low.push(paint(rod(at(0.38).add(V(0, thick * 1.1, 0)), V(l.x, ((rows - 1) * pitch) / 2, axle + r * 0.3), r * 0.06, 6), PAINT.leg));
  } else {
    low.push(paint(box(foot, thick * 1.7, thick * 1.7, thick * 1.5), PAINT.leg));   // the axle fitting
  }
  // the shock absorber: a chromed piston sliding in the cylinder (long enough to stay in it pulled out), a collar
  // at the top
  low.push(paint(rod(foot, at(0.75), thick * 0.62, 12), PAINT.chrome));
  parts.push(paint(rod(at(0.42), head, thick, 14), PAINT.leg));
  parts.push(paint(rod(at(0.88), head, thick * 1.22, 14), PAINT.leg));
  // a main leg turns on a trunnion across the top
  if (main && l.kind !== 'body') parts.push(paint(rod(head.clone().setY(-r * 0.9), head.clone().setY(r * 0.9), thick * 0.8, 10), PAINT.leg));
  // the torque link: a V where piston and cylinder meet, in front of a main leg, behind the nose leg
  // (as two arms of their own, opening as the piston slides out: setOleo)
  const f = l.kind === 'nose' ? -1 : 1;
  const apex = at(0.3).add(V(0, f * r * 0.55, 0));
  const linkLow = at(0.1).add(V(0, f * thick, 0));
  const linkUp = at(0.48).add(V(0, f * thick, 0));
  if (!oleo) {
    parts.push(paint(rod(linkLow, apex, r * 0.06, 6), PAINT.leg), paint(rod(apex, linkUp, r * 0.06, 6), PAINT.leg));
    parts.push(paint(ball(apex, r * 0.08), PAINT.chrome));
  }
  // a hydraulic hose from the airframe, in an arc round the back of the leg, down to the brakes
  const arc = (from, to, bulge) => new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(from, from.clone().lerp(to, 0.5).add(bulge), to), 12, r * 0.028, 5);
  if (main) for (const s of [-1, 1]) parts.push(paint(arc(head.clone().add(V(s * thick * 0.8, -thick * 1.4, r * 0.1)), at(0.06).add(V(s * thick * 0.95, -thick, 0)), V(s * r * 0.15, -r * 0.45, 0)), PAINT.dark));
  // A folding brace from the leg to the airframe: two arms meeting at a knee, kept straight by a lock link
  // with its springs up to the leg.
  const brace = (from, to, thickness, out) => {
    const knee = from.clone().lerp(to, 0.45).add(out);
    parts.push(paint(rod(from, knee, thickness, 8), PAINT.leg), paint(rod(knee, to, thickness * 1.1, 8), PAINT.leg));
    parts.push(paint(ball(knee, thickness * 1.35), PAINT.chrome), paint(ball(to, thickness * 1.2), PAINT.leg));
    const lock = at(0.82);
    parts.push(paint(rod(knee, lock, thickness * 0.45, 6), PAINT.leg));
    parts.push(paint(rod(knee.clone().lerp(lock, 0.3), knee.clone().lerp(lock, 0.75), thickness * 0.75, 6), PAINT.dark));   // the springs
  };
  // the retraction actuator: a hydraulic cylinder with its chromed rod, from the airframe to the leg
  const actuator = (from, to) => {
    const mid = from.clone().lerp(to, 0.55);
    parts.push(paint(rod(from, mid, r * 0.09, 10), PAINT.leg), paint(rod(mid, to, r * 0.05, 8), PAINT.chrome));
  };
  if (l.kind === 'wing' || l.kind === 'nacelle' || l.kind === 'centre') {
    // the folding side brace inwards up to the wing, the drag brace forwards up to the airframe
    if (l.side) brace(at(0.5), V(l.at - l.side * r * 3, 0, head.z + r * 0.15), r * 0.1, V(0, 0, -r * 0.3));
    brace(at(0.55), V(l.at, r * 3, head.z + r * 0.1), r * 0.09, V(0, 0, -r * 0.25));
    actuator(V(l.at + (l.side || 1) * thick * 0.5, r * 2.2, head.z + r * 0.2), at(0.8).add(V(0, thick, 0)));
  } else if (l.kind === 'nose') {
    // the folding drag brace forwards, the steering collar, the tow lug down at the axle fitting
    brace(at(0.6), V(l.x, r * 2.8, head.z), r * 0.09, V(0, 0, -r * 0.25));
    parts.push(paint(rod(at(0.7), at(0.8), thick * 1.4, 14), PAINT.leg));
    slide.push(paint(box(foot.clone().add(V(0, thick * 1.6, r * 0.1)), thick * 0.5, thick * 1.6, thick * 0.4), PAINT.leg));
    slide.push(paint(rod(foot.clone().add(V(-thick * 0.3, thick * 2.3, r * 0.1)), foot.clone().add(V(thick * 0.3, thick * 2.3, r * 0.1)), thick * 0.35, 8), PAINT.leg));
    // the taxi and turn-off lights: a lamp on each side of the leg, its glass facing forwards
    for (const s of [-1, 1]) {
      const p = at(0.86).add(V(s * thick * 1.1, thick * 0.6, 0));
      const lamp = new THREE.CylinderGeometry(r * 0.13, r * 0.06, r * 0.22, 12, 1, true)
        .applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2)).translate(p.x, p.y + r * 0.04, p.z);
      parts.push(paint(lamp, PAINT.leg), paint(rod(p.clone().add(V(-s * thick * 0.5, 0, 0)), p, r * 0.04, 6), PAINT.leg));
      lights.push(rod(p.clone().add(V(0, r * 0.13, 0)), p.clone().add(V(0, r * 0.15, 0)), r * 0.12, 12));
    }
  } else if (l.kind === 'body') {
    brace(at(0.55), V(l.at, r * 2.4, head.z), r * 0.09, V(0, 0, -r * 0.2));
  }
  // a jet's main leg carries a door on its outer side, narrower at the bottom
  const len = foot.distanceTo(head);
  if (l.kind === 'wing' && l.side) {
    const d = box(at(0.7).add(V(l.side * (thick * 1.25 + r * 0.05), 0, 0)), r * 0.04, r * 1.3, len * 0.5);
    const c = at(0.7).z;
    const pos = d.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < c) pos.setY(i, pos.getY(i) * 0.65);
    parts.push(paint(d, PAINT.door));
  }
  // as one mesh in a group fixed where the leg is: moved there, squashed along y
  const fit = new THREE.Matrix4().makeTranslation(0, l.y, 0).multiply(new THREE.Matrix4().makeScale(1, 1 / stretch, 1));
  const pivot = new THREE.Vector3(head.x, l.y, head.z);
  const local = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z).multiply(fit);
  const group = new THREE.Group();
  group.position.copy(pivot);
  group.add(new THREE.Mesh(mergeGeometries(parts.map((g) => g.applyMatrix4(local))), mats.body));
  if (lights.length) group.add(new THREE.Mesh(mergeGeometries(lights.map((g) => g.applyMatrix4(local))), mats.light));
  // The piston and the wheels in a group sliding along the leg: `dir` from the top of the leg to its foot (no y, so
  // the squash doesn't change it), `ext` how far it pulls out in the air (units), at most half as much further in.
  // The torque link's two arms are posed by setOleo from its pins (in the leg's own coordinates, squashed by `sq`).
  const slider = new THREE.Group();
  if (oleo) {
    const dir = foot.clone().sub(head).normalize();
    const ext = Math.min(r * (main ? 0.85 : 0.9), len * 0.25);
    slider.name = 'slider';
    slider.userData = { dir: [dir.x, dir.z], ext, main };
    if (slide.length) slider.add(new THREE.Mesh(mergeGeometries(slide.map((g) => g.applyMatrix4(local))), mats.body));
    group.add(slider);
    const sq = new THREE.Group();
    sq.position.set(-pivot.x, l.y - pivot.y, -pivot.z);
    sq.scale.set(1, 1 / stretch, 1);
    const arm = () => new THREE.Mesh(paint(new THREE.CylinderGeometry(r * 0.06, r * 0.06, 1, 6).translate(0, 0.5, 0), PAINT.leg), mats.body);
    const knuckle = new THREE.Mesh(paint(ball(V(0, 0, 0), r * 0.08), PAINT.chrome), mats.body);
    sq.add(arm(), arm(), knuckle);
    sq.name = 'link';
    sq.userData = { low: linkLow.toArray(), up: linkUp.toArray(), apex: apex.toArray(), dir: [dir.x, dir.z] };
    poseLink(sq, 0);
    group.add(sq);
  }
  if (tilts) {
    // the bogie in a frame as long as it is wide (undoing the squash, so it turns true), about its pivot pin;
    // `half`: from the pin to the end axles along the bogie
    const pin = V(l.x, 0, foot.z);
    const frame = new THREE.Group();
    frame.position.set(pin.x - pivot.x, l.y - pivot.y, pin.z - pivot.z);
    frame.scale.set(1, 1 / stretch, 1);
    const bogie = new THREE.Group();
    bogie.name = 'bogie';
    bogie.userData = { tilt: l.tilt, half: ((rows - 1) * pitch) / 2 };
    bogie.add(new THREE.Mesh(mergeGeometries(wheels.map((g) => g.translate(-pin.x, -pin.y, -pin.z))), mats.body));
    frame.add(bogie);
    (oleo ? slider : group).add(frame);
  }
  const fold = FOLD[l.kind];
  group.userData = fold ? { axis: fold[0], angle: fold[1] * (fold[0] === 'y' ? l.side : 1) } : { fixed: true };
  out.push(group);
  // the bay of every leg but a jet's main leg (which carries its door) and the tail wheel: open, dark inside,
  // with a door hanging down on each side
  if (l.kind !== 'wing' && l.kind !== 'tail') {
    const half = (across > 1 ? gap / 2 : 0) + w * 0.6 + r * 0.25;
    const long = (rows - 1) * pitch + r * 2.6;   // (a bogie's bay is longer)
    const bay = new THREE.Group();
    bay.add(new THREE.Mesh(paint(box(V(0, 0, -r * 0.02), half * 2, long - r * 0.1, r * 0.02), PAINT.dark).applyMatrix4(new THREE.Matrix4().makeScale(1, 1 / stretch, 1)), mats.body));
    bay.position.set(l.x, l.y + r * 0.15 / stretch, head.z);
    bay.userData = { bay: true };
    out.push(bay);
    for (const s of [-1, 1]) {
      const door = new THREE.Group();
      door.add(new THREE.Mesh(paint(box(V(0, 0, -r * 0.55), r * 0.05, long, r * 1.1), PAINT.door).applyMatrix4(new THREE.Matrix4().makeScale(1, 1 / stretch, 1)), mats.body));
      door.position.set(l.x + s * half, l.y + r * 0.2 / stretch, head.z);
      door.rotation.y = -s * 0.12;   // (open: tilted out a little)
      door.userData = { door: true, open: -s * 0.12, shut: s * Math.PI / 2 };
      out.push(door);
    }
  }
}

// Adds the landing gear to a painted model (`scene`; `size` from js/models3d.js modelSize: drawn `stretch`
// times longer than wide, `wide` metres across); `raw` is the unpainted model it was copied from. Models with
// gear of their own (FG.data.modelsOnGear) get none.
export function addGear(scene, raw, file, size, patchFacing, type) {
  const gear = gearKey(type, file);
  if ((FG.data.modelsOnGear || []).includes(file) || !FG.data.gear[gear]) return scene;
  const key = `${gear}|${size.stretch}`;
  if (!built[key]) {
    const lay = layout(raw, gear, size.wide, size.len);
    const mats = { body: gearMaterial(patchFacing), light: lightMaterial(patchFacing) };
    const group = new THREE.Group();
    group.name = 'gear';
    const parts = [];
    for (const l of lay.legs) leg(l, lay.ground, size.stretch, mats, parts);
    group.add(...parts);
    built[key] = group;
  }
  scene.add(built[key].clone());
  // a tail-wheel aircraft sits nose up (js/view3d.js levels it in flight)
  const lay = layouts[gear];
  scene.rotation.x = scene.userData.sit = lay.sit;
  scene.userData.mainY = lay.mainY;   // (the main legs' y: the plane rotates about them on the ground)
  // The shock absorbers, in metres (js/view3d.js oleo): how far the main legs and the nose leg pull out in the air,
  // a tilted bogie's half length and tilt (degrees), the nose leg from the main legs, and where the main wheels meet
  // the runway (x, y: tyre smoke at touchdown).
  const o = { main: Infinity, nose: 0, half: 0, tilt: 0, arm: 0, mains: [] };
  built[key].traverse((c) => {
    const u = c.userData;
    if (c.name === 'slider') { if (u.main) o.main = Math.min(o.main, u.ext * size.wide); else o.nose = u.ext * size.wide; }
    if (c.name === 'bogie' && u.half * size.wide > o.half) { o.half = u.half * size.wide; o.tilt = u.tilt; }
  });
  for (const l of lay.legs) {
    if (l.kind === 'nose') o.arm = (l.y - lay.mainY) * size.len;
    else if (l.kind !== 'tail') o.mains.push([l.x * size.wide, l.y * size.len]);
  }
  if (o.main < Infinity && !lay.sit) scene.userData.oleo = o;
  return scene;
}

// Puts the gear `f` of the way down (1: down and locked, 0: up and its doors shut). Going up the legs fold
// first and the doors shut after them; coming down the doors open first.
export function setGear(gear, f) {
  if (gear.userData.f === f) return;
  gear.userData.f = f;
  const legs = Math.min(1, (1 - f) * 1.33);
  const doors = Math.max(0, Math.min(1, (0.4 - f) / 0.4));
  for (const o of gear.children) {
    const u = o.userData;
    if (u.fixed) continue;
    if (u.door) o.rotation.y = u.open + (u.shut - u.open) * doors;
    else if (u.axis) o.rotation[u.axis] = u.angle * legs;
    o.visible = f > 0.01;
  }
}

// Tilts the bogies of the types whose bogies are tilted in flight (FG.data.gear tilt, degrees: + front axle up,
// rear wheels hanging lowest; - front axle down). `h`: how high the main wheels are above the ground (in the gear's
// units, as wide as the model is: metres / modelSize wide), `pitch`: the plane's (degrees, nose up +). On the
// ground a bogie lies flat on it however the plane is pitched; coming down for a landing its lowest wheels touch
// first and it is pushed flat as the plane settles onto it, and after lift-off it hangs at its angle again.
const bogies = new WeakMap();   // gear -> its bogies
export function setBogies(gear, h, pitch) {
  if (!bogies.has(gear)) {
    const list = [];
    gear.traverse((o) => { if (o.name === 'bogie') list.push(o); });
    bogies.set(gear, list);
  }
  for (const b of bogies.get(gear)) {
    const { tilt, half } = b.userData;
    // its angle to the ground: what it hangs at, but no lower than the ground lets its end wheels go
    const want = tilt + pitch;
    const most = Math.asin(Math.min(1, Math.max(0, h) / half)) * 180 / Math.PI;
    const toGround = Math.sign(want) * Math.min(Math.abs(want), most);
    b.rotation.x = (toGround - pitch) * Math.PI / 180;
  }
}

// Slides the shock absorbers' pistons out (+) or in (-) from where they stand on the ground: `main` and `nose` in
// metres (as wide as the model is: metres / modelSize wide = `wide`), each kept within what its leg allows. The torque
// links open and close with them.
const sliders = new WeakMap();   // gear -> its sliders with their torque links
export function setOleo(gear, main, nose, wide) {
  if (!sliders.has(gear)) {
    const list = [];
    gear.traverse((o) => { if (o.name === 'slider') list.push([o, o.parent.getObjectByName('link')]); });
    sliders.set(gear, list);
  }
  const key = `${main.toFixed(3)}|${nose.toFixed(3)}`;
  if (gear.userData.oleo === key) return;
  gear.userData.oleo = key;
  for (const [o, link] of sliders.get(gear)) {
    const u = o.userData;
    const s = Math.max(-0.5 * u.ext, Math.min(u.ext, (u.main ? main : nose) / wide));
    o.position.set(u.dir[0] * s, 0, u.dir[1] * s);
    poseLink(link, s);
  }
}
// The torque link with the piston `s` units out: its lower pin moves with the piston, the arms keep their lengths
// and meet further out.
const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const Y = new THREE.Vector3(0, 1, 0);
function poseLink(link, s) {
  const k = link.userData;
  const [low, up, knee, axis, out] = P;
  knee.fromArray(k.apex);
  low.fromArray(k.low);
  up.fromArray(k.up);
  const a = knee.distanceTo(low);
  const b = knee.distanceTo(up);
  out.copy(knee).sub(low);
  low.x += k.dir[0] * s;
  low.z += k.dir[1] * s;
  const d = axis.copy(up).sub(low).length();
  axis.divideScalar(d);
  out.addScaledVector(axis, -out.dot(axis)).normalize();
  const along = (a * a - b * b + d * d) / (2 * d);
  knee.copy(low).addScaledVector(axis, along).addScaledVector(out, Math.sqrt(Math.max(0, a * a - along * along)));
  const [lower, upper, ball] = link.children;
  for (const [m, from, to] of [[lower, low, knee], [upper, knee, up]]) {
    const dv = to.clone().sub(from);
    m.position.copy(from);
    m.scale.set(1, dv.length(), 1);
    m.quaternion.setFromUnitVectors(Y, dv.normalize());
  }
  ball.position.copy(knee);
}
