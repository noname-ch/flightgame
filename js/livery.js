// Airline liveries for the 3D aircraft models (FG.data.liveries, js/data/liveries.js), simplified after
// photographs of the real ones: the fuselage in one or two colours, coloured engines and wing tips, a
// coloured fin with a mark or a simple logo on it, and the title on the forward fuselage. The first was the
// one after SWISS: white aircraft, red fin with a white cross, red title.
// Of its own texture a model keeps only the dark details (windows, tyres, engine intakes).
// A livery is painted in the shader from the position on the aircraft (model axes: x = right wing, y = nose,
// z = up, length 1), so the same livery fits every model without touching its texture.
import * as THREE from 'three';

// Dark lettering of a model's own livery that would show through: y range, and z range in fuselage widths
// below the top of the fuselage.
// Where the title starts on a model whose nose is not of the usual length, as a share of the length.
const TITLE_FROM = { concorde: 0.17 };

const CLEAN = {
  a380: { y: [-0.3, 0], z: [-0.62, -0.22] },
  b752: { y: [-1, 1], z: [-1, 9] },   // dark stripes and numbers all over the fuselage and fin
};

// Models whose cabin windows are deep pockets in the fuselage skin, which look like dents: flushWindows moves
// the pockets' floors out level with the skin, and they are painted as glass.
const POCKET_WINDOWS = { atr42: true };

// The window pockets of a model: patches of the skin inside sharp edges, on the fuselage sides, facing sideways,
// as big as each other and in a row of at least five at one height. Their floors are moved out to the skin
// around them; markEngines then marks them as glass (livPart 6). Once per geometry.
function flushWindows(scene, hw) {
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.position && !o.geometry.userData.windows) meshes.push(o); });
  const tris = [];   // [mesh, a, b, c] by vertex index
  const ids = new Map();
  const corner = [];
  const v = new THREE.Vector3();
  const at = (m, i) => v.fromBufferAttribute(m.geometry.attributes.position, i).clone();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    const idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const t = [m];
      for (let k = 0; k < 3; k++) {
        const j = idx ? idx.getX(i + k) : i + k;
        t.push(j);
        const key = `${Math.round(pos.getX(j) * 2e5)},${Math.round(pos.getY(j) * 2e5)},${Math.round(pos.getZ(j) * 2e5)}`;
        let id = ids.get(key);
        if (id === undefined) { id = ids.size; ids.set(key, id); }
        corner.push(id);
      }
      tris.push(t);
    }
  }
  const n = tris.length;
  const normal = [];
  const area = new Float32Array(n);
  tris.forEach(([m, a, b, c], i) => {
    const p = at(m, a);
    const q = new THREE.Vector3().subVectors(at(m, b), p).cross(new THREE.Vector3().subVectors(at(m, c), p));
    area[i] = q.length() / 2;
    normal.push(q.normalize());
  });
  const group = Int32Array.from({ length: n }, (_, i) => i);
  const root = (a) => { while (group[a] !== a) { group[a] = group[group[a]]; a = group[a]; } return a; };
  const edges = new Map();
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const a = corner[i * 3 + k], b = corner[i * 3 + (k + 1) % 3];
      if (a === b) continue;
      const key = a < b ? a * ids.size + b : b * ids.size + a;
      const o = edges.get(key);
      if (o === undefined) edges.set(key, i);
      else if (normal[i].dot(normal[o]) > 0.82 && root(i) !== root(o)) group[root(i)] = root(o);
    }
  }
  const patches = new Map();
  for (let i = 0; i < n; i++) {
    let p = patches.get(root(i));
    if (!p) { p = { area: 0, c: new THREE.Vector3(), n: new THREE.Vector3(), tris: [] }; patches.set(root(i), p); }
    const [m, a, b, c] = tris[i];
    p.area += area[i];
    p.c.addScaledVector(at(m, a).add(at(m, b)).add(at(m, c)), area[i] / 3);
    p.n.addScaledVector(normal[i], area[i]);
    p.tris.push(i);
  }
  const sides = [...patches.values()].filter((p) => {
    p.c.divideScalar(p.area);
    p.n.normalize();
    return Math.abs(p.c.x) > 0.6 * hw && Math.abs(p.c.x) < 1.15 * hw && Math.abs(p.n.x) > 0.9 && p.area > 4e-5 && p.area < 1e-3;
  });
  // (a row: the same size at the same height, on the same side)
  const rows = new Map();
  for (const p of sides) {
    const key = `${Math.sign(p.c.x)}|${Math.round(p.c.z / 0.004)}|${Math.round(Math.log(p.area) / 0.15)}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(p);
  }
  const windows = [].concat(...[...rows.values()].filter((r) => r.length >= 5));
  // every vertex of the skin, to find how deep each pocket is
  const skin = [];
  for (const m of meshes) for (let i = 0; i < m.geometry.attributes.position.count; i++) skin.push(at(m, i));
  const moved = new Map(meshes.map((m) => [m, new Set()]));
  for (const p of windows) {
    const reach = Math.sqrt(p.area) * 1.1;
    let depth = 0;
    for (const s of skin) if (s.distanceTo(p.c) < reach) depth = Math.max(depth, s.clone().sub(p.c).dot(p.n));
    depth = Math.min(depth, 0.4 * Math.sqrt(p.area));
    for (const i of p.tris) {
      const [m, ...corners] = tris[i];
      const pos = m.geometry.attributes.position;
      for (const j of corners) {
        if (moved.get(m).has(j)) continue;
        moved.get(m).add(j);
        pos.setXYZ(j, pos.getX(j) + p.n.x * depth, pos.getY(j) + p.n.y * depth, pos.getZ(j) + p.n.z * depth);
      }
    }
  }
  for (const m of meshes) {
    m.geometry.userData.windows = moved.get(m);
    m.geometry.attributes.position.needsUpdate = true;
    m.geometry.computeBoundingSphere();
  }
}

const MARKS = { cross: 1, disc: 2, ring: 3, chevron: 4, triangle: 5, text: 6, logo: 6, split: 7 };
// Where a title goes: its middle below the top of the fuselage and its greatest height, in fuselage widths.
const TITLE_AT = { window: [0.42, 0.46], above: [0.25, 0.22], low: [0.76, 0.3] };

// Alpha masks (white on transparent) with their width / height: texts and simple logos.
const masks = {};
function mask(key, width, height, draw) {
  if (masks[key]) return masks[key];
  const c = document.createElement('canvas');
  c.width = Math.ceil(width);
  c.height = Math.ceil(height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  ctx.lineCap = ctx.lineJoin = 'round';
  draw(ctx, c.width, c.height);
  const texture = new THREE.CanvasTexture(c);
  texture.anisotropy = 4;
  return (masks[key] = { texture, aspect: c.width / c.height });
}

// A text; the capital letters fill the height of the picture (more is added below for descenders).
function textMask(text, style = '700') {
  const H = 128;
  const PAD = 8;
  const px = Math.round((H - 2 * PAD) / 0.716); // cap height = 0.716 em
  const font = `${style} ${px}px Arial, Helvetica, sans-serif`;
  const below = /[gjpqy]/.test(text) ? Math.round(0.2 * px) : 0;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  return mask(`text|${style}|${text}`, probe.measureText(text).width + 2 * PAD, H + below, (ctx) => {
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, PAD, H - PAD);
  });
}

// Simple logos for the fin, drawn in one colour.
const LOGOS = {
  // a crown over the letters
  klm: () => mask('logo|klm', 300, 256, (ctx) => {
    ctx.font = '700 118px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KLM', 150, 244);
    ctx.fillRect(98, 112, 104, 13);
    for (const x of [108, 136, 164, 192]) { ctx.beginPath(); ctx.arc(x, 92, 9.5, 0, 2 * Math.PI); ctx.fill(); }
    ctx.fillRect(145, 30, 10, 46);
    ctx.fillRect(134, 42, 32, 10);
  }),
  // a flying crane in a ring
  crane: () => mask('logo|crane', 256, 256, (ctx) => {
    ctx.lineWidth = 13;
    ctx.beginPath(); ctx.arc(128, 128, 114, 0, 2 * Math.PI); ctx.stroke();
    const shape = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); };
    shape([[52, 190], [118, 150], [150, 132], [226, 82], [232, 90], [160, 146], [128, 166], [58, 198]]); // legs, body, neck, bill
    shape([[112, 152], [128, 44], [170, 70], [156, 138]]);  // the raised wing
    shape([[104, 158], [86, 86], [118, 98], [132, 150]]);   // the wing behind it
  }),
  // a harp
  harp: () => mask('logo|harp', 200, 256, (ctx) => {
    ctx.lineWidth = 17;
    ctx.beginPath(); ctx.moveTo(56, 236); ctx.quadraticCurveTo(30, 130, 52, 30); ctx.stroke();           // pillar
    ctx.beginPath(); ctx.moveTo(52, 30); ctx.bezierCurveTo(110, 4, 120, 92, 172, 62); ctx.stroke();      // neck
    ctx.beginPath(); ctx.moveTo(172, 62); ctx.quadraticCurveTo(150, 180, 56, 236); ctx.stroke();         // body
    ctx.lineWidth = 6;
    for (const [x, y0, y1] of [[78, 44, 216], [100, 48, 198], [122, 66, 176], [144, 76, 146]]) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); }
  }),
};

// The engines of a model, so that a livery can colour them: every vertex gets the attribute livPart
// (1 = engine, 6 = a window pane). The models are made of many separate pieces; an engine's cowling is a round
// piece beside the fuselage, about as wide as it is high and longer than half its width, and with it go the
// pieces in it.
// A model in one piece says so itself: the attribute _LIVPART of its file (tools/convert_model.html).
function markEngines(scene, hw, file) {
  const d = 2 * hw;
  const meshes = [];
  scene.traverse((o) => {
    const own = o.isMesh && o.geometry.attributes._livpart;
    if (own && !o.geometry.attributes.livPart) o.geometry.setAttribute('livPart', own);
  });
  // (a model that marks its engines itself keeps its marks, but is searched for propellers too)
  const ownMarks = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.position || o.geometry.userData.livSearched) return;
    if (o.geometry.attributes.livPart) ownMarks.add(o);
    meshes.push(o);
  });
  const pieces = []; // { box: [x0, x1, y0, y1, z0, z1], mesh, root }
  const roots = new Map();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    const idx = m.geometry.index;
    const parent = new Int32Array(pos.count).map((_, i) => i);
    // (vertices at the same place belong together: many models have every face on its own vertices)
    const place = new Map();
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (let i = 0; i < pos.count; i++) {
      const k = `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`;
      const first = place.get(k);
      if (first === undefined) place.set(k, i); else parent[find(i)] = find(first);
    }
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const a = find(idx ? idx.getX(i) : i);
      parent[find(idx ? idx.getX(i + 1) : i + 1)] = a;
      parent[find(idx ? idx.getX(i + 2) : i + 2)] = a;
    }
    const byRoot = new Map();
    const root = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const r = (root[i] = find(i));
      let p = byRoot.get(r);
      if (!p) { p = { box: [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity], mesh: m, root: r }; byRoot.set(r, p); pieces.push(p); }
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const b = p.box;
      if (x < b[0]) b[0] = x;
      if (x > b[1]) b[1] = x;
      if (y < b[2]) b[2] = y;
      if (y > b[3]) b[3] = y;
      if (z < b[4]) b[4] = z;
      if (z > b[5]) b[5] = z;
    }
    roots.set(m, root);
  }
  const cowlings = pieces.filter(({ box: b }) => {
    const dx = b[1] - b[0], dy = b[3] - b[2], dz = b[5] - b[4];
    const wide = Math.max(dx, dz);
    return Math.abs(b[0] + b[1]) / 2 > 1.3 * hw && Math.min(dx, dz) > 0.3 * d && wide < 1.4 * d && dx / dz > 0.6 && dx / dz < 1.6 &&
      dy > 0.5 * wide && dy < 6 * wide;
  });
  const engine = new Map();   // piece -> the cowling it is in
  for (const p of pieces) {
    const b = p.box;
    const c = [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2];
    const cowl = cowlings.find(({ box: e }) => c[0] > e[0] && c[0] < e[1] && c[1] > e[2] - 0.1 * (e[3] - e[2]) && c[1] < e[3] + 0.1 * (e[3] - e[2]) && c[2] > e[4] && c[2] < e[5]);
    if (cowl) engine.set(p, cowl.box);
  }
  scene.userData.engines = cowlings.length;
  // Propellers: blades are pieces thin along the nose, off the fuselage. Touching ones (or one alone) make a
  // propeller when together they are about as wide as high; its middle is the hub. Their vertices
  // get the hub in livHub (x, z, 1), so the shader can turn them (livSpin).
  const thin = pieces.filter(({ box: b }) => {
    const wide = Math.max(b[1] - b[0], b[5] - b[4]);
    return b[3] - b[2] < 0.3 * wide && wide > 0.15 * d && Math.abs(b[0] + b[1]) / 2 > 1.2 * hw;
  });
  const group = thin.map((_, i) => i);
  const top = (i) => { while (group[i] !== i) { group[i] = group[group[i]]; i = group[i]; } return i; };
  const gap = 0.15 * d;
  for (let i = 0; i < thin.length; i++) for (let j = i + 1; j < thin.length; j++) {
    const p = thin[i].box, q = thin[j].box;
    if (p[0] < q[1] + gap && q[0] < p[1] + gap && p[2] < q[3] + gap && q[2] < p[3] + gap && p[4] < q[5] + gap && q[4] < p[5] + gap) group[top(i)] = top(j);
  }
  const groups = new Map();
  thin.forEach((p, i) => {
    const g = groups.get(top(i)) || { box: [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity], parts: [] };
    for (let k = 0; k < 6; k += 2) { g.box[k] = Math.min(g.box[k], p.box[k]); g.box[k + 1] = Math.max(g.box[k + 1], p.box[k + 1]); }
    g.parts.push(p);
    groups.set(top(i), g);
  });
  const hubs = new Map(meshes.map((m) => [m, new Map()])); // mesh -> root -> [x, z]
  let props = 0;
  for (const { box: b, parts } of groups.values()) {
    const dx = b[1] - b[0], dz = b[5] - b[4];
    if (dx / dz < 0.6 || dx / dz > 1.6 || b[3] - b[2] > 0.3 * Math.max(dx, dz)) continue;
    for (const p of parts) hubs.get(p.mesh).set(p.root, [(b[0] + b[1]) / 2, (b[4] + b[5]) / 2]);
    props++;
  }
  scene.userData.props = props;
  // A jet's cowling says how far back along it each vertex is: 1.01 at the inlet lip to 1.98 at the exhaust
  // (the shader paints the lip bare metal and the exhaust grey); what is inside it (fan, spinner) is 5 and keeps
  // the model's own colours. A turboprop's nacelle is plain 1.
  const jet = !(FG.data.props && FG.data.props[file]);
  const marked = new Map(meshes.map((m) => [m, new Map()]));
  for (const [p, cowl] of engine) {
    marked.get(p.mesh).set(p.root, { box: cowl, inner: !cowlings.some((c) => c === p) });
  }
  for (const m of meshes) {
    const root = roots.get(m);
    const pos = m.geometry.attributes.position;
    const part = new Float32Array(root.length);
    const cowls = marked.get(m);
    if (cowls.size) {
      for (let i = 0; i < root.length; i++) {
        const e = cowls.get(root[i]);
        if (!e) continue;
        if (!jet) part[i] = 1;
        else if (e.inner) part[i] = 5;
        else part[i] = 1.01 + 0.97 * Math.min(1, Math.max(0, (e.box[3] - pos.getY(i)) / (e.box[3] - e.box[2])));
      }
    }
    for (const i of m.geometry.userData.windows || []) part[i] = 6;   // window panes (flushWindows): glass
    if (!ownMarks.has(m)) m.geometry.setAttribute('livPart', new THREE.BufferAttribute(part, 1));
    m.geometry.userData.livSearched = true;
    const hub = new Float32Array(root.length * 3);
    const at = hubs.get(m);
    if (at.size) for (let i = 0; i < root.length; i++) {
      const h = at.get(root[i]);
      if (h) hub.set([h[0], h[1], 1], i * 3);
    }
    m.geometry.setAttribute('livHub', new THREE.BufferAttribute(hub, 3));
  }
  // (a model in one piece has no propellers to turn)
  scene.traverse((o) => {
    if (o.isMesh && !o.geometry.attributes.livHub) {
      o.geometry.setAttribute('livHub', new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count * 3), 3));
    }
  });
}

// Where the fuselage and the fin of this model are, and where the title ({ aspect, at, height, length }) and
// a text or logo on the fin ({ aspect, angle, size }) go. Positions are read straight from the geometry, as
// the shader sees them (the models have no node transforms).
export function measure(scene, file, stretch = 1, title = { aspect: 4.3 }, finMark = { aspect: 3 }) {
  const box = CLEAN[file];
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.position) meshes.push(o); });
  const v = new THREE.Vector3();
  const eachVertex = (fn) => {
    for (const m of meshes) {
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) fn(v.fromBufferAttribute(pos, i));
    }
  };
  // Forward fuselage, between the cockpit and the wing: half width and top.
  let hw = 0;
  let top = -Infinity;
  let span = 0;
  eachVertex((p) => {
    span = Math.max(span, Math.abs(p.x));
    if (p.y < 0.27 || p.y > 0.36) return;
    hw = Math.max(hw, Math.abs(p.x));
    top = Math.max(top, p.z);
  });
  const d = 2 * hw;
  // Crown of the rear fuselage, ahead of the fin.
  let crown = -Infinity;
  eachVertex((p) => {
    if (p.y > 0.05 || p.y < -0.3 || Math.abs(p.x) > 0.35 * hw) return;
    crown = Math.max(crown, p.z);
  });
  // Usually the same height as in front (a 747's hump is higher); coarse models may have no vertex there.
  crown = crown < top - 0.5 * d ? top : Math.min(top, crown);
  // The fin: everything upright above the crown near the centre line of the rear fuselage. Its foot stays
  // in the fuselage's colour, the fin's colour starts a little higher with a level lower edge.
  const fin = { y: -0.15, z: crown + 0.015 * d, x: 0.3 * hw };
  let finTop = fin.z;
  eachVertex((p) => { if (p.y < fin.y && p.z > fin.z && Math.abs(p.x) < fin.x) finTop = Math.max(finTop, p.z); });
  fin.z += 0.15 * (finTop - fin.z);
  // The mark sits at half the height of the colour, in the middle of the fin's chord there.
  const height = finTop - fin.z;
  const crossZ = fin.z + 0.5 * height;
  const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let y0 = Infinity, y1 = -Infinity;
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    const idx = m.geometry.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k++) tri[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k);
      if (!tri.every((p) => p.y < fin.y && Math.abs(p.x) < fin.x)) continue;
      for (let k = 0; k < 3; k++) { // where the triangle's edges cross the height of the mark
        const p = tri[k], q = tri[(k + 1) % 3];
        if ((p.z - crossZ) * (q.z - crossZ) >= 0) continue;
        const y = p.y + (q.y - p.y) * (crossZ - p.z) / (q.z - p.z);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  const found = y1 > y0;
  // Title: from behind the first door, usually large across the window row and at most a third of the
  // aircraft's length; a livery can have it smaller above the windows, low on the belly, or longer.
  const [below, high] = TITLE_AT[title.at] || TITLE_AT.window;
  const titleY = 0.5 - (TITLE_FROM[file] || 1.4 * d);
  const titleLen = Math.max(0.6 * d, Math.min((title.length || 1.8) * d, titleY - (title.length ? 0.04 : 0.18)));
  const titleH = Math.min((title.height || high) * d, titleLen / title.aspect);
  // A text or logo on the fin: across the middle of its chord at the height of the mark, or up along the fin.
  const chord = found ? (y1 - y0) * stretch : 0;
  const angle = (finMark.angle || 0) * Math.PI / 180;
  let finLen = angle ? 0.82 * height / Math.sin(angle) : 0.8 * chord * (finMark.size || 1);
  let finH = finLen / finMark.aspect;
  const room = angle ? 0.5 * chord * Math.sin(angle) : 0.6 * height * (finMark.size || 1);
  if (finH > room) { finH = room; finLen = finH * finMark.aspect; }
  // The fin's leading edge runs on down across the rear fuselage: where a tail colour ends.
  const slope = 0.8 / stretch;
  return {
    fin: found ? new THREE.Vector3(fin.y, fin.z, fin.x) : new THREE.Vector3(0, 99, 0),
    cross: found ? new THREE.Vector3((y0 + y1) / 2, crossZ, Math.min(0.22 * height, 0.27 * chord)) : new THREE.Vector3(0, 99, 1),
    finBox: new THREE.Vector4((y0 + y1) / 2, crossZ, finLen || 1, finH || 1),
    finAngle: angle,
    tail: found ? new THREE.Vector2(y1 + (crossZ - fin.z) * slope, slope) : new THREE.Vector2(-99, 0),
    halfWidth: hw,
    top,
    width: d,
    span,
    titleBox: new THREE.Vector4(titleY, titleH * title.aspect / stretch, top - below * d - titleH / 2, titleH),
    clean: box ? new THREE.Vector4(box.y[0], box.y[1], top + box.z[0] * d, top + box.z[1] * d) : new THREE.Vector4(),
  };
}

const VERT_HEAD = `attribute float livPart;
attribute vec3 livHub;     // of a propeller: its hub (x, z), 1 (else 0, 0, 0)
uniform float livSpin;     // how far the propellers have turned (radians)
varying vec3 vLivPos;
varying vec3 vLivNor;
varying float vLivPart;
uniform float livFlex;     // how far the wing tips are bent up (down: below 0), in half spans
uniform float livSpan;     // half span
uniform float livHalfW;    // half width of the fuselage`;
// The propellers turn about their hubs, and the wings bend from the fuselage side out, most at the tips (the
// paint stays where it was: vLivPos). The tailplanes bend too, but being short hardly at all.
const VERT_BODY = `vLivPos = position;
vLivNor = normal;
vLivPart = livPart;
if (livHub.z > 0.5) {
  vec2 livR = transformed.xz - livHub.xy;
  float livC = cos(livSpin);
  float livS = sin(livSpin);
  transformed.xz = livHub.xy + vec2(livC * livR.x - livS * livR.y, livS * livR.x + livC * livR.y);
}
{
  float livOut = max(abs(position.x) - 1.1 * livHalfW, 0.0) / max(livSpan - 1.1 * livHalfW, 0.001);
  transformed.z += livFlex * livSpan * livOut * livOut;
}`;
const FRAG_HEAD = `
uniform vec3 livBody;
uniform vec3 livWing;
uniform vec3 livEngine;
uniform vec3 livLip;       // a jet engine's inlet lip and exhaust (bare metal)
uniform vec3 livNozzle;
uniform vec3 livGlass;     // window panes (livPart 6)
uniform vec4 livProp;      // propellers: hub x (either side), hub z, y of the blades, blade radius (0: none)
uniform vec3 livPropShape; // half the blades' thickness along y, y of the spinner's tip, spinner radius at its base
uniform vec3 livPropColor;
uniform vec3 livPropTip;
uniform vec3 livSpinColor;
uniform vec3 livBelly;
uniform float livBellyZ;  // the fuselage below this z has the belly colour (far below: none)
uniform vec2 livBellyNose; // ahead of this y the belly's edge rises by this much per unit
uniform float livBellyAft; // the belly colour is only behind this y
uniform vec3 livLine;
uniform float livLineW;   // half width of the stripe along the belly's edge
uniform vec3 livColor;    // of the title
uniform sampler2D livTitle;
uniform vec4 livTitleBox; // nose-side y, length, bottom z, height
uniform vec3 livFin;      // the fin is behind this y, above this z, within this |x|
uniform vec3 livFinColor;
uniform vec2 livTail;     // the fin's colour on the rear fuselage: behind this y at the fin's foot, slope of the edge
uniform vec3 livCross;    // the mark on the fin: centre y, centre z, half size
uniform float livMark;    // 1 cross, 2 disc, 3 ring, 4 chevron, 5 triangle, 6 text or logo, 7 split
uniform vec3 livMarkA;
uniform vec3 livMarkB;
uniform sampler2D livFinText;
uniform vec4 livFinBox;   // the text or logo on the fin: centre y, centre z, length, height
uniform float livFinAngle; // it rises by this angle towards the top of the fin
uniform vec3 livWinglet;
uniform float livWingletX; // wing tips are beyond this |x|
uniform float livStretch; // the model is drawn this much longer than it is
uniform float livHalfWidth; // of the fuselage
uniform vec4 livClean;    // own details are dropped between these y and between these z
varying vec3 vLivPos;
varying vec3 vLivNor;
varying float vLivPart;`;
const FRAG_BODY = `
{
  vec3 own = diffuseColor.rgb;
  float lum = dot(own, vec3(0.2126, 0.7152, 0.0722));
  float sat = max(own.r, max(own.g, own.b)) - min(own.r, min(own.g, own.b));
  // dark, colourless parts of the model's own texture stay: windows, tyres, engine intakes
  float detail = (1.0 - smoothstep(0.06, 0.16, lum)) * (1.0 - smoothstep(0.04, 0.12, sat));
  // wings and tailplanes stay plain
  float upright = 1.0 - smoothstep(0.7, 0.85, abs(normalize(vLivNor).z));
  // the fuselage (not a propeller or an engine beside it)
  float fuselage = step(abs(vLivPos.x), 1.15 * livHalfWidth);
  vec3 paint = mix(livWing, livBody, fuselage);
  float bellyZ = livBellyZ + max(0.0, vLivPos.y - livBellyNose.x) * livBellyNose.y;
  if (fuselage > 0.5 && vLivPos.y < livBellyAft && vLivPos.z < bellyZ + livLineW) paint = vLivPos.z > bellyZ - livLineW && livLineW > 0.0 ? livLine : livBelly;
  paint = mix(paint, livWinglet, step(livWingletX, abs(vLivPos.x)) * upright);
  if (vLivPart > 5.5) {
    // a window pane: glass, over any title
    own = livGlass;
    detail = 1.0;
  } else if (vLivPart > 4.5) {
    // inside a jet engine (fan, spinner): the model's own colours, but grey metal where they are the colours of
    // its own livery
    paint = vec3(lum);
    detail = 1.0 - smoothstep(0.08, 0.16, sat);
  }
  else if (vLivPart > 0.5) {
    paint = livEngine;
    // a jet engine (js/livery.js markEngines): its inlet lip bare metal, its exhaust grey metal
    float back = vLivPart - 1.01;
    if (back > -0.005 && back < 0.06) paint = livLip;
    else if (back > 0.86) paint = livNozzle;
  }
  // propellers: the blades in their thin disc, yellow at the tips, and the spinner in front, over the
  // model's own colours
  if (livProp.w > 0.0 && fuselage < 0.5) {
    float rr = length(vec2(abs(vLivPos.x) - livProp.x, vLivPos.z - livProp.y));
    float ahead = vLivPos.y - livProp.z;
    if (abs(ahead) < livPropShape.x && rr > 0.9 * livPropShape.z && rr < livProp.w * 1.03) {
      paint = rr > livProp.w * 0.86 ? livPropTip : livPropColor;
      detail = 0.0;
    } else if (ahead > -livPropShape.x && vLivPos.y < livPropShape.y + 0.001 &&
        rr < livPropShape.z * clamp((livPropShape.y - vLivPos.y) / max(0.001, livPropShape.y - livProp.z), 0.0, 1.0) + 0.0015) {
      paint = livSpinColor;
      detail = 0.0;
    }
  }
  if (fuselage > 0.5 && livTail.y > 0.0 && vLivPos.z <= livFin.y && vLivPos.y < livTail.x + (livFin.y - vLivPos.z) * livTail.y) paint = livFinColor;
  if (vLivPos.y < livFin.x && vLivPos.z > livFin.y && abs(vLivPos.x) < livFin.z) {
    vec2 p = vec2((vLivPos.y - livCross.x) * livStretch, vLivPos.z - livCross.y) / livCross.z;
    vec2 d = abs(p);
    float mark = 0.0;
    vec3 markColor = livMarkA;
    if (livMark < 0.5) mark = 0.0;
    else if (livMark < 1.5) mark = step(max(d.x, d.y), 1.0) * step(min(d.x, d.y), 0.3);
    else if (livMark < 2.5) mark = step(length(p), 1.1);
    else if (livMark < 3.5) mark = step(length(p), 1.15) * step(0.8, length(p));
    else if (livMark < 4.5) mark = step(abs(p.y + 0.9 * p.x), 0.5);
    else if (livMark < 5.5) {
      mark = step(-0.95, p.y) * step(abs(p.x), (0.95 - p.y) * 0.62) * (1.0 - step(-0.5, p.y) * step(abs(p.x), (0.1 - p.y) * 0.62) * step(p.y, 0.1));
      markColor = p.y < -0.5 ? livMarkB : livMarkA;
    } else if (livMark < 6.5) {
      // reads from the nose on the left side and towards the nose on the right side, as the title
      float side = vLivPos.x < 0.0 ? -1.0 : 1.0;
      vec2 q = vec2(side * (vLivPos.y - livFinBox.x) * livStretch, vLivPos.z - livFinBox.y);
      float cs = cos(livFinAngle);
      float sn = sin(livFinAngle);
      vec2 f = vec2(dot(q, vec2(cs, -side * sn)) / livFinBox.z, dot(q, vec2(side * sn, cs)) / livFinBox.w) + 0.5;
      mark = texture2D(livFinText, clamp(f, 0.0, 1.0)).a * step(0.0, f.x) * step(f.x, 1.0) * step(0.0, f.y) * step(f.y, 1.0);
    } else mark = step(0.1, p.y + 0.9 * p.x);
    paint = mix(paint, mix(livFinColor, markColor, mark), upright);
  }
  // the title reads from the nose on the left side and towards the nose on the right side
  vec2 t = vec2((vLivPos.x < 0.0 ? livTitleBox.x - vLivPos.y : vLivPos.y - livTitleBox.x + livTitleBox.y) / livTitleBox.y,
    (vLivPos.z - livTitleBox.z) / livTitleBox.w);
  float ink = texture2D(livTitle, clamp(t, 0.0, 1.0)).a * step(0.0, t.x) * step(t.x, 1.0) * step(0.0, t.y) * step(t.y, 1.0) * fuselage;
  paint = mix(paint, livColor, ink * upright);
  // lettering of the model's own livery goes
  if (vLivPos.y > livClean.x && vLivPos.y < livClean.y && vLivPos.z > livClean.z && vLivPos.z < livClean.w) detail = 0.0;
  diffuseColor.rgb = mix(paint, own, detail);
}`;

// Paints a loaded model in a livery (its materials are changed in place; clones of the model share them).
// `extra(shader)` can patch the shader further.
export function paintLivery(scene, file, extra, stretch = 1, livery = FG.livery()) {
  const title = textMask(livery.title, livery.titleStyle);
  const mark = livery.mark || {};
  const finText = mark.kind === 'text' ? textMask(mark.text, mark.style) : mark.kind === 'logo' ? LOGOS[mark.logo]() : title;
  const m = measure(scene, file, stretch,
    { aspect: title.aspect, at: livery.titleAt, height: livery.titleHeight, length: livery.titleLength },
    { aspect: finText.aspect, angle: mark.angle, size: mark.size });
  if (POCKET_WINDOWS[file]) flushWindows(scene, m.halfWidth);
  markEngines(scene, m.halfWidth, file);
  const prop = FG.data.props && FG.data.props[file];   // its propellers, if it has any
  const belly = livery.belly;
  const color = (c) => new THREE.Color(c);
  const wing = livery.wing == null ? livery.body : livery.wing;
  const cross = m.cross.clone();
  cross.z *= mark.kind === 'text' || mark.kind === 'logo' ? 1 : mark.size || 1;
  const uniforms = {
    livBody: { value: color(livery.body) },
    livWing: { value: color(wing) },
    livEngine: { value: color(livery.engine == null ? wing : livery.engine) },
    livLip: { value: color(0xc8cdd3) },
    livNozzle: { value: color(0x6b7078) },
    livGlass: { value: color(0x1b2128) },
    livProp: { value: prop ? new THREE.Vector4(prop.x, prop.z, prop.y, prop.r) : new THREE.Vector4() },
    livPropShape: { value: prop ? new THREE.Vector3(prop.t, prop.tip, prop.r * 0.25) : new THREE.Vector3() },
    livPropColor: { value: color(prop && prop.blade || 0x1c1d20) },
    livPropTip: { value: color(0xf2b600) },
    livSpinColor: { value: color(prop && prop.spinner || 0x1c1d20) },
    livBelly: { value: color(belly ? belly.color : livery.body) },
    livBellyZ: { value: belly ? m.top - belly.from * m.width : -99 },
    // (to the nose the edge climbs to the cockpit windows)
    livBellyNose: { value: belly && belly.nose ? new THREE.Vector2(0.5 - 1.9 * m.width / stretch, belly.nose * stretch / 1.9) : new THREE.Vector2(99, 0) },
    livBellyAft: { value: belly && belly.aft != null ? belly.aft : 99 },
    livLine: { value: color(belly && belly.line != null ? belly.line : 0) },
    livLineW: { value: belly && belly.line != null ? (belly.lineWidth || 0.04) * m.width / 2 : 0 },
    livColor: { value: color(livery.titleColor) },
    livTitle: { value: title.texture },
    livTitleBox: { value: m.titleBox },
    livFin: { value: m.fin },
    livFinColor: { value: color(livery.fin) },
    livTail: { value: livery.tail ? m.tail : new THREE.Vector2(-99, 0) },
    livCross: { value: cross },
    livMark: { value: MARKS[mark.kind] || 0 },
    livMarkA: { value: color(mark.color == null ? livery.fin : mark.color) },
    livMarkB: { value: color(mark.color2 == null ? (mark.color == null ? livery.fin : mark.color) : mark.color2) },
    livFinText: { value: finText.texture },
    livFinBox: { value: m.finBox },
    livFinAngle: { value: m.finAngle },
    livWinglet: { value: color(livery.winglet == null ? livery.body : livery.winglet) },
    livWingletX: { value: livery.winglet == null ? 99 : 0.955 * m.span },
    livClean: { value: m.clean },
    livStretch: { value: stretch },
    livHalfWidth: { value: m.halfWidth },
    livHalfW: { value: m.halfWidth },
    livSpan: { value: m.span },
  };
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || seen.has(o.material) || o.material.transparent) return;
    seen.add(o.material);
    // (each material has its own livFlex and livSpin, so an aircraft drawn with copies of them bends and turns
    // its propellers on its own:
    // js/view3d.js ownMaterials)
    o.material.userData.livFlex = { value: 0 };
    o.material.userData.livSpin = { value: 0 };
    o.material.onBeforeCompile = function (shader) {
      Object.assign(shader.uniforms, uniforms);
      shader.uniforms.livFlex = this.userData.livFlex;
      shader.uniforms.livSpin = this.userData.livSpin;
      if (extra) extra(shader);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
        // (after the vertex colours: the converted models keep their dark parts in them)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_BODY}`);
    };
    o.material.customProgramCacheKey = () => 'livery';
    o.material.needsUpdate = true;
  });
  return scene;
}
