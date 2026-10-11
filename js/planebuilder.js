// Builds a 3D model for the aircraft types that have no glTF model, from their looks (js/data/looks.js) and
// wingspan (FG.data.builtModels): fuselage, wings, tail, propeller engines or Concorde's delta, fixed gear.
// The result is like the glTF models: x = right wing, y = nose, z = up, centred, 1 unit long. The white parts
// are painted by the livery (js/livery.js); the dark ones (windows, propellers, tyres) stay.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const RAD = Math.PI / 180;

// Closed skin through rings of points (the same number in each), with flat caps on both ends.
function loft(rings) {
  const n = rings[0].length;
  const pos = [];
  const quad = (a, b, c, d) => { for (const p of [a, b, c, a, c, d]) pos.push(p.x, p.y, p.z); };
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < n; j++) quad(rings[i][j], rings[i][(j + 1) % n], rings[i + 1][(j + 1) % n], rings[i + 1][j]);
  }
  for (const [ring, flip] of [[rings[0], true], [rings[rings.length - 1], false]]) {
    const mid = ring.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(n);
    for (let j = 0; j < n; j++) {
      const a = ring[j], b = ring[(j + 1) % n];
      for (const p of flip ? [mid, b, a] : [mid, a, b]) pos.push(p.x, p.y, p.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A flat surface (wing, tailplane, fin) from stations: { at: Vector3 of the leading edge, chord, thick }.
// `span` is the direction the thickness is measured across: 'z' for wings, 'x' for the fin.
function surface(stations, across) {
  const rings = stations.map(({ at, chord, thick }) => {
    const ring = [];
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * 2 * Math.PI;
      const along = -chord / 2 + chord / 2 * Math.cos(a);   // 0 at the leading edge, -chord at the trailing edge
      const t = thick / 2 * Math.sin(a) * (0.6 + 0.4 * Math.cos(a / 2) ** 2);
      ring.push(across === 'z' ? new THREE.Vector3(at.x, at.y + along, at.z + t) : new THREE.Vector3(at.x + t, at.y + along, at.z));
    }
    return ring;
  });
  return loft(rings);
}

// Body of revolution about the nose axis: radius(s) for s = 0 (front) .. len, `lift(s)` raises it.
function body(len, radius, lift = () => 0, steps = 40, front = 0) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const s = len * i / steps;
    pts.push(new THREE.Vector2(Math.max(0.001, radius(s)), -s));
  }
  const g = new THREE.LatheGeometry(pts, 20).toNonIndexed();
  // The lathe turns about y with z = r cos(phi): top is +z already. Shift each ring up or down.
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i), p.getY(i) + front, p.getZ(i) + lift(-p.getY(i)));
  g.deleteAttribute('uv');
  return g;
}

const plain = (g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; };
const box = (w, l, h, x, y, z) => plain(new THREE.BoxGeometry(w, l, h)).translate(x, y, z);

// Propeller engine: nacelle from `front` backwards, spinner and blades. Returns [white parts, dark parts].
function propEngine(x, front, z, r, len, propR, radial, blades) {
  const white = [];
  const dark = [];
  const shape = radial
    ? (s) => r * (s < 0.45 * len ? 1 : 1 - 0.8 * ((s - 0.45 * len) / (0.55 * len)) ** 1.4)
    : (s) => r * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.15 + s / len * 0.85)) ** 0.7);
  white.push(body(len, shape, () => 0, 14).translate(x, front, z));
  white.push(plain(new THREE.ConeGeometry(r * (radial ? 0.3 : 0.5), r * 1.3, 12)).translate(x, front + r * 0.6, z));
  if (radial) dark.push(plain(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.06, 16)).translate(x, front + 0.02, z));
  for (let k = 0; k < blades; k++) {
    dark.push(plain(new THREE.BoxGeometry(0.2 * r + 0.08, 0.05, propR)).translate(0, 0, propR / 2)
      .rotateY(k / blades * 2 * Math.PI + 0.4).translate(x, front + r * 0.35, z));
  }
  return [white, dark];
}

export function buildPlane(file) {
  const spec = FG.data.builtModels[file];
  const look = FG.data.looks[spec.type];
  const L = look.len;
  const d = look.dia;
  const R = d / 2;
  const half = spec.span / 2;
  const concorde = look.eng === 'concorde';
  const radial = look.eng === 'radial2' || look.eng === 'prop3';
  const high = look.wing === 'high';
  const white = [];
  const dark = [];
  const Y = (s) => L / 2 - s;   // s = distance from the nose

  // ---------- fuselage ----------
  const nl = concorde ? 4.2 * d : look.eng === 'prop3' ? 0.9 * d : 1.5 * d;
  const ts = concorde ? 0.86 * L : L - Math.max(2.3 * d, 0.24 * L);
  const radius = (s) => {
    if (s < nl) return R * Math.sin(Math.PI / 2 * s / nl) ** (concorde ? 1.25 : 0.62);
    if (s > ts) return R * (1 - 0.85 * ((s - ts) / (L - ts)) ** 1.5);
    return R;
  };
  // The nose droops a little, the tail cone sweeps up so the top line stays level.
  const lift = (s) => (s < nl ? -0.25 * R * (1 - s / nl) ** 2 : s > ts ? 0.75 * R * ((s - ts) / (L - ts)) ** 1.6 : 0);
  white.push(body(L, radius, lift, 48, L / 2));
  // windscreen: a dark band over the top of the nose
  const w0 = (concorde ? 0.5 : 0.4) * nl;
  const w1 = (concorde ? 0.62 : 0.8) * nl;
  const glass = new THREE.LatheGeometry(Array.from({ length: 7 }, (_, i) => {
    const s = w0 + (w1 - w0) * i / 6;
    return new THREE.Vector2(radius(s) * 1.012 + 0.01, -s);
  }), 12, -1.1, 2.2).toNonIndexed();
  glass.deleteAttribute('uv');
  const gp = glass.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setXYZ(i, gp.getX(i), gp.getY(i) + L / 2, gp.getZ(i) + lift(-gp.getY(i)));
  dark.push(glass);
  // cabin windows
  const winZ = 0.22 * R;
  const winX = Math.sqrt(R * R - winZ * winZ);
  const pitch = Math.max(0.75, 0.3 * d);
  for (let s = nl + 0.5 * d; s < ts - 0.2 * d; s += pitch) {
    for (const side of [1, -1]) dark.push(box(0.06, 0.32, Math.min(0.42, 0.2 * d), side * winX, Y(s), winZ));
  }

  // ---------- wing ----------
  const wingZ = high ? 0.9 * R : -0.62 * R;
  const dihedral = (concorde ? 0 : high ? 1.5 : 5) * RAD;
  let rootLE;    // distance of the wing root's leading edge from the nose
  let rootChord;
  if (concorde) {
    // Ogival delta: the leading edge curves out from the nose section to the tip near the tail.
    rootLE = 0.2 * L;
    rootChord = 0.73 * L;
    const stations = [];
    for (let i = 0; i <= 8; i++) {
      const f = i / 8;
      const le = rootLE + 0.68 * L * (1 - (1 - f) ** 1.5) ** 0.9;
      stations.push({ f, le, chord: rootLE + rootChord - le + 0.01 * L * f });
    }
    for (const side of [1, -1]) {
      white.push(surface(stations.map(({ f, le, chord }) => ({
        at: new THREE.Vector3(side * (0.2 * R + f * (half - 0.2 * R)), Y(le), wingZ - 0.1 * R * f), chord, thick: 0.03 * chord + 0.05,
      })), 'z'));
    }
  } else {
    rootLE = (radial ? 0.3 : 0.38) * L;
    rootChord = spec.chord * spec.span;
    const tipChord = rootChord * spec.taper;
    const sweep = spec.sweep * (rootChord - tipChord);
    for (const side of [1, -1]) {
      white.push(surface([
        { at: new THREE.Vector3(side * 0.2 * R, Y(rootLE), wingZ), chord: rootChord, thick: 0.15 * rootChord },
        { at: new THREE.Vector3(side * half, Y(rootLE + sweep), wingZ + Math.tan(dihedral) * half), chord: tipChord, thick: 0.11 * tipChord },
      ], 'z'));
    }
  }

  // ---------- tail ----------
  const ttail = !!look.ttail;
  const finBase = (concorde ? 0.19 : 0.21) * L;
  const finH = (concorde ? 1.35 : ttail ? 1.2 : 1.65) * d;
  const finSweep = finH * (concorde ? 1.25 : 0.6);
  const finTop = R + finH;
  const finS = L - finBase - 0.01 * L;
  white.push(surface([
    { at: new THREE.Vector3(0, Y(finS), 0.55 * R), chord: finBase, thick: 0.07 * finBase },
    { at: new THREE.Vector3(0, Y(finS + finSweep), finTop), chord: finBase * (ttail ? 0.5 : concorde ? 0.14 : 0.38), thick: 0.05 * finBase },
  ], 'x'));
  if (!concorde) {
    const stabHalf = 0.19 * spec.span;
    const stabChord = 0.62 * rootChord;
    const stabS = ttail ? finS + finSweep - 0.1 * stabChord : L - 0.19 * L;
    const stabZ = ttail ? finTop - 0.03 * d : 0.75 * R;
    for (const side of [1, -1]) {
      white.push(surface([
        { at: new THREE.Vector3(0, Y(stabS), stabZ), chord: stabChord, thick: 0.1 * stabChord },
        { at: new THREE.Vector3(side * stabHalf, Y(stabS + 0.35 * stabChord), stabZ + (ttail ? 0 : 0.03 * stabHalf)), chord: 0.5 * stabChord, thick: 0.07 * stabChord },
      ], 'z'));
    }
  }

  // ---------- engines ----------
  const add = ([w, k]) => { white.push(...w); dark.push(...k); };
  if (concorde) {
    for (const side of [1, -1]) {
      white.push(box(0.2 * half, 0.28 * L, 0.5 * d, side * 0.34 * half, Y(0.76 * L), wingZ - 0.42 * d));
      dark.push(box(0.19 * half, 0.05, 0.42 * d, side * 0.34 * half, Y(0.62 * L) + 0.01, wingZ - 0.42 * d));
    }
  } else {
    const er = (radial ? 0.27 : 0.19) * d;
    const elen = (radial ? 0.17 : 0.24) * L;
    const propR = (radial ? 0.62 : 0.72) * d;
    const ex = 0.3 * half;
    const ez = wingZ + Math.tan(dihedral) * ex + (high ? -0.5 * er : 0.35 * er);
    const front = Y(rootLE + spec.sweep * (rootChord - rootChord * spec.taper) * 0.3 - (radial ? 0.55 : 0.4) * elen);
    for (const side of [1, -1]) add(propEngine(side * ex, front, ez, er, elen, propR, radial, radial ? 3 : 4));
    if (look.eng === 'prop3') add(propEngine(0, L / 2 + 0.05 * L, -0.1 * R, 0.31 * d, 0.14 * L, propR, true, 3));
  }

  // ---------- fixed landing gear ----------
  if (look.fixed) {
    const wr = 0.11 * d + 0.24;
    const floor = -R - (look.tailwheel ? 0.75 : 0.55) * d;      // where the tyres touch
    const wheel = (x, s, r) => {
      dark.push(plain(new THREE.CylinderGeometry(r, r, r * 0.6, 14)).rotateZ(Math.PI / 2).translate(x, Y(s), floor + r));
    };
    // strut from the wheel at (x, s) up to (topX, topZ)
    const leg = (x, s, r, topX, topZ) => {
      const a = new THREE.Vector3(x, Y(s), floor + r);
      const b = new THREE.Vector3(topX, Y(s), topZ);
      const g = plain(new THREE.CylinderGeometry(0.07, 0.07, a.distanceTo(b), 6));
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
      white.push(g.translate((a.x + b.x) / 2, a.y, (a.z + b.z) / 2));
    };
    const track = look.tailwheel ? 0.3 * half : 1.05 * d;
    const mainS = rootLE + (look.tailwheel ? 0.2 : 0.75) * rootChord;
    for (const side of [1, -1]) {
      wheel(side * track, mainS, wr);
      leg(side * track, mainS, wr, side * (high ? 0.85 * R : track), high ? -0.45 * R : wingZ);
    }
    if (look.tailwheel) { wheel(0, 0.93 * L, wr * 0.45); leg(0, 0.93 * L, wr * 0.45, 0, 0); }
    else { wheel(0, 0.14 * L, wr * 0.8); leg(0, 0.14 * L, wr * 0.8, 0, -0.6 * R); }
  }

  // ---------- one mesh per material, in the units of the glTF models ----------
  const scene = new THREE.Group();
  const whiteMesh = new THREE.Mesh(mergeGeometries(white), new THREE.MeshStandardMaterial({ color: 0xe8eaee, metalness: 0, roughness: 0.65, side: THREE.DoubleSide }));
  const darkMesh = new THREE.Mesh(mergeGeometries(dark), new THREE.MeshStandardMaterial({ color: 0x15181c, metalness: 0, roughness: 0.5, side: THREE.DoubleSide }));
  scene.add(whiteMesh, darkMesh);
  const bounds = new THREE.Box3().setFromObject(scene);
  const mid = bounds.getCenter(new THREE.Vector3());
  const k = 1 / (bounds.max.y - bounds.min.y);
  for (const m of [whiteMesh, darkMesh]) m.geometry.translate(-mid.x, -mid.y, -mid.z).scale(k, k, k);
  // For the livery: where the fuselage is (half width, top line), as it cannot be read off a model with
  // engines beside the nose.
  scene.userData.fuselage = { halfWidth: R * k, top: (R - mid.z) * k };
  return scene;
}
