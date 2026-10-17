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
// A jet's fan: in each engine (cowlings that overlap), the parts inside it that are flat across the nose (blades,
// discs, stators) are taken in rings along it; the widest round ring is the fan, and turns round its own middle.
// (Blades one by one are too small to pass for a propeller, so the A320's fan stood still and only a hidden disc
// behind it turned; small parts beside the axis turned round their own middles and poked out of the A350's
// nacelle; discs in the noses of the A330 and 747 turned too: GitHub issues #8, #9.) A ring that does not reach in
// to its middle is part of the cowling (the 737's inlet lip, as wide as its flattened nacelle, turned as its fan).
function spinFans(pieces, cowlings, engine, roots, spin) {
  const over = (a, b) => a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3] && a[4] < b[5] && b[4] < a[5];
  // (vertices of each piece, found when first asked for)
  const byRoot = new Map();
  const vertsOf = (p) => {
    let m = byRoot.get(p.mesh);
    if (!m) {
      m = new Map();
      roots.get(p.mesh).forEach((r, i) => { if (!m.has(r)) m.set(r, []); m.get(r).push(i); });
      byRoot.set(p.mesh, m);
    }
    return m.get(p.root);
  };
  const hollow = (ring) => {
    const b = ring.box, cx = (b[0] + b[1]) / 2, cz = (b[4] + b[5]) / 2;
    let near = Infinity;
    for (const p of ring.parts) {
      const pos = p.mesh.geometry.attributes.position;
      for (const i of vertsOf(p)) near = Math.min(near, Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz));
    }
    return near > 0.25 * ring.wide;
  };
  const engines = [];
  let fans = 0;
  for (const c of cowlings) {
    const e = engines.find((e) => e.cowls.some((d) => over(d.box, c.box)));
    if (e) { e.cowls.push(c); for (let k = 0; k < 6; k += 2) { e.box[k] = Math.min(e.box[k], c.box[k]); e.box[k + 1] = Math.max(e.box[k + 1], c.box[k + 1]); } }
    else engines.push({ cowls: [c], box: [...c.box] });
  }
  for (const e of engines) {
    const dia = Math.min(e.box[1] - e.box[0], e.box[5] - e.box[4]);
    const inner = pieces.filter((p) => {
      const b = p.box, wide = Math.max(b[1] - b[0], b[5] - b[4]);
      return engine.has(p) && e.cowls.some((c) => c.box === engine.get(p)) && !cowlings.includes(p) &&
        b[3] - b[2] < 0.3 * wide && wide > 0.08 * dia;
    }).sort((p, q) => p.box[2] - q.box[2]);
    let best = null;
    for (let i = 0; i < inner.length;) {
      const ring = { parts: [], box: [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity] };
      do {
        const b = inner[i].box;
        ring.parts.push(inner[i]);
        for (let k = 0; k < 6; k += 2) { ring.box[k] = Math.min(ring.box[k], b[k]); ring.box[k + 1] = Math.max(ring.box[k + 1], b[k + 1]); }
        i++;
      } while (i < inner.length && inner[i].box[2] < ring.box[3] + 0.1 * dia);
      const dx = ring.box[1] - ring.box[0], dz = ring.box[5] - ring.box[4];
      ring.wide = Math.max(dx, dz);
      if (dx / dz < 0.75 || dx / dz > 1.33 || ring.wide < 0.4 * dia || hollow(ring)) continue;
      if (!best || ring.wide > best.wide * 1.05 || (ring.wide > best.wide * 0.95 && ring.box[3] > best.box[3])) best = ring;
    }
    if (best) { spin(best.parts, best.box); fans++; }
  }
  return fans;
}

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
      if (!p) { p = { box: [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity], mesh: m, root: r, sx: 0, sz: 0, n: 0 }; byRoot.set(r, p); pieces.push(p); }
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      p.sx += x; p.sz += z; p.n++;
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
  const jet = !(FG.data.props && FG.data.props[file]);
  const hubs = new Map(meshes.map((m) => [m, new Map()])); // mesh -> root -> [x, z]
  // (a propeller turns round the middle of its vertices: the middle of its box is off to one side where it has
  // three blades, and a DC-3's or Twin Otter's propellers wobbled)
  const spin = (parts, b, prop) => {
    let at = [(b[0] + b[1]) / 2, (b[4] + b[5]) / 2];
    if (prop) {
      const n = parts.reduce((s, p) => s + p.n, 0);
      at = [parts.reduce((s, p) => s + p.sx, 0) / n, parts.reduce((s, p) => s + p.sz, 0) / n];
    }
    for (const p of parts) hubs.get(p.mesh).set(p.root, at);
    parts[0].mesh.geometry.userData.livProps = (parts[0].mesh.geometry.userData.livProps || 0) + 1;
  };
  // (the Ju 52 has no propeller drawing of its own, FG.data.props: no fan in it, its propellers are found as below)
  if (!jet || !spinFans(pieces, cowlings, engine, roots, spin)) {
    // Propellers: blades are pieces thin along the nose, off the fuselage or in front of it (a Ju 52's nose
    // engine). Touching ones (or one alone) make a
    // propeller when together they are about as wide as high; its middle is the hub. Their vertices
    // get the hub in livHub (x, z, 1), so the shader can turn them (livSpin).
    const thin = pieces.filter(({ box: b }) => {
      const wide = Math.max(b[1] - b[0], b[5] - b[4]);
      return b[3] - b[2] < 0.3 * wide && wide > 0.15 * d && (Math.abs(b[0] + b[1]) / 2 > 1.2 * hw || b[2] > 0.43);
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
    for (const { box: b, parts } of groups.values()) {
      const dx = b[1] - b[0], dz = b[5] - b[4];
      if (dx / dz < 0.6 || dx / dz > 1.6 || b[3] - b[2] > 0.3 * Math.max(dx, dz)) continue;
      spin(parts, b, true);
    }
  }
  // A jet's cowling says how far back along it each vertex is: 1.01 at the inlet lip to 1.98 at the exhaust
  // (the shader paints the lip bare metal and the exhaust grey); what is inside it (fan, spinner) is 5 and keeps
  // the model's own colours. A turboprop's nacelle is plain 1.
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
  scene.userData.props = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.geometry.attributes.livHub) {
      o.geometry.setAttribute('livHub', new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count * 3), 3));
    }
    scene.userData.props += o.geometry.userData.livProps || 0;
  });
}

// The control surfaces of a model, so that the shader can move them: every vertex gets the attribute livSurf
// (kind: 1 aileron, 2 flap, 3 elevator, 4 rudder; then the hinge's y and z, for the rudder its y). They are read
// off the geometry: across the span in strips, the flat vertices (not engines or propellers) make the wing and,
// behind a gap, the tailplane; the rear of their chord moves (ailerons on the outer third, flaps inboard). The
// tailplane and the fin are then read again from their faces as straight edges (edgeLines) and cut along their
// hinges (cutAlong): elevators from beside the tail cone to the tips, the rudder from a little above the fuselage.
const STRIPS = 32;
const SURF_CHORD = { 1: 0.27, 3: 0.32, 4: 0.32 }; // share of the chord that moves (wing, tailplane, fin)
function markSurfaces(scene, m) {
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.position && !o.geometry.userData.livSurfaced) meshes.push(o); });
  if (meshes.length) findSurfaces(meshes, m);
  scene.userData.surfaces = { 1: 0, 2: 0, 3: 0, 4: 0 };
  scene.userData.flapFaces = 0; // faces of the flaps cut out of the wing
  const seen = new Set();
  scene.traverse((o) => {
    const c = o.isMesh && o.geometry.userData.livSurfaces;
    if (c) for (const k in c) scene.userData.surfaces[k] += c[k];
    if (o.isMesh && !seen.has(o.geometry)) scene.userData.flapFaces += o.geometry.userData.livFlapFaces || 0;
    if (o.isMesh) seen.add(o.geometry);
  });
}
function findSurfaces(meshes, m) {
  const hw = m.halfWidth, span = m.span;
  const x0 = 1.25 * hw, xw = (span - x0) / STRIPS;
  const finOn = m.finTop != null;
  const finX = 1.5 * m.fin.z, finZ0 = m.fin.y, finZ1 = finOn ? m.finTop : 0, zw = (finZ1 - finZ0) / STRIPS;
  const wing = Array.from({ length: STRIPS }, () => []); // [y, z] of flat vertices in each strip
  const fin = Array.from({ length: STRIPS }, () => []);  // y of upright vertices of the fin at each height
  const each = (fn) => {
    for (const o of meshes) {
      const g = o.geometry;
      const pos = g.attributes.position, part = g.attributes.livPart, hub = g.attributes.livHub;
      for (let i = 0; i < pos.count; i++) {
        if ((part && part.getX(i) > 0.5) || (hub && hub.getZ(i) > 0.5)) continue;
        fn(o, i, pos.getX(i), pos.getY(i), pos.getZ(i));
      }
    }
  };
  // (by the faces: on a coarse model most vertices are on the leading and trailing edges, where they face
  // forwards or backwards, but the faces between them are flat)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const faces = new Map(); // mesh -> per vertex: 1 on a flat face, 2 on an upright one (both: 3)
  let engZ0 = Infinity, engZ1 = -Infinity; // height of engines on the rear fuselage (not to be taken for the tailplane;
  // beside it: the A350's wing engines reach back behind -0.1 too, and their height is the tailplane's)
  for (const o of meshes) {
    const pos = o.geometry.attributes.position, part = o.geometry.attributes.livPart;
    if (part) for (let i = 0; i < pos.count; i++) if (part.getX(i) > 0.5 && pos.getY(i) < -0.1 && Math.abs(pos.getX(i)) < 2.5 * hw) { engZ0 = Math.min(engZ0, pos.getZ(i)); engZ1 = Math.max(engZ1, pos.getZ(i)); }
  }
  // (`strips`: also gather the wing's and the fin's vertices; again after the flaps are cut out, only the faces)
  const readFaces = (strips) => {
    for (const o of meshes) {
      const g = o.geometry;
      const pos = g.attributes.position, idx = g.index, part = g.attributes.livPart, hub = g.attributes.livHub;
      const count = idx ? idx.count : pos.count;
      const skip = (i) => (part && part.getX(i) > 0.5) || (hub && hub.getZ(i) > 0.5);
      const face = new Uint8Array(pos.count);
      faces.set(o, face);
      for (let t = 0; t < count; t += 3) {
        const ia = idx ? idx.getX(t) : t, ib = idx ? idx.getX(t + 1) : t + 1, ic = idx ? idx.getX(t + 2) : t + 2;
        if (skip(ia) || skip(ib) || skip(ic)) continue;
        a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
        n.subVectors(b, a).cross(c.clone().sub(a));
        const len = n.length();
        if (len < 1e-12) continue;
        const nx = Math.abs(n.x) / len, nz = Math.abs(n.z) / len;
        for (const i of [ia, ib, ic]) face[i] |= (nz > 0.6 ? 1 : 0) | (nx > 0.5 ? 2 : 0);
        if (!strips) continue;
        // (a big face across several strips, as a coarse inner wing: where its edges cross from strip to strip too)
        const on = [a, b, c];
        if (nz > 0.6) for (const [p, q] of [[a, b], [b, c], [c, a]]) {
          if (p.x * q.x <= 0) continue;
          const sp = (Math.abs(p.x) - x0) / xw, sq = (Math.abs(q.x) - x0) / xw;
          for (let k = Math.max(1, Math.ceil(Math.min(sp, sq))); k < Math.min(STRIPS, Math.max(sp, sq)); k++) {
            const t = (k - sp) / (sq - sp);
            on.push(new THREE.Vector3().lerpVectors(p, q, t).setX(Math.sign(p.x) * (x0 + (k + (sq > sp ? 0.001 : -0.001)) * xw)));
          }
        }
        for (const p of on) {
          const ax = Math.abs(p.x);
          if (nz > 0.6 && ax >= x0 && ax < span && !(p.y < -0.1 && p.z > engZ0 - 0.01 && p.z < engZ1 + 0.01)) wing[Math.min(STRIPS - 1, Math.floor((ax - x0) / xw))].push(p.y, p.z);
          if (nx > 0.5 && finOn && ax < finX && p.y < -0.15 && p.z > finZ0 && p.z < finZ1) fin[Math.min(STRIPS - 1, Math.floor((p.z - finZ0) / zw))].push(p.y);
        }
      }
    }
  };
  readFaces(true);
  // Wing and tailplane: split where, over the whole span, no flat vertex lies between them (the widest empty
  // stretch behind the middle; none on a delta wing).
  const BINS = 200, occupied = new Uint8Array(BINS);
  for (const pts of wing) for (let i = 0; i < pts.length; i += 2) occupied[Math.max(0, Math.min(BINS - 1, Math.floor((pts[i] + 0.5) * BINS)))] = 1;
  let split = -Infinity, best = 0;
  for (let i = 0; i < BINS / 2; i++) {
    if (occupied[i]) continue;
    let j = i;
    while (j < BINS && !occupied[j]) j++;
    const before = occupied.slice(0, i).some((v) => v), after = j < BINS;
    if (before && after && j - i > best && (i + j) / 2 / BINS - 0.5 < 0 && j - i >= 0.04 * BINS) { best = j - i; split = (i + j) / 2 / BINS - 0.5; }
    i = j;
  }
  // (a nacelle or a fairing in a few strips would bend the line: each edge is the median of five strips)
  const median = (vals) => vals.map((_, i) => {
    const v = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(STRIPS - 1, i + 2); j++) if (vals[j] != null) v.push(vals[j]);
    v.sort((x, y) => x - y);
    return v.length ? v[v.length >> 1] : null;
  });
  const edges = (keep) => {
    const sets = wing.map((pts) => {
      const out = [];
      for (let i = 0; i < pts.length; i += 2) if (keep(pts[i])) out.push(pts[i], pts[i + 1]);
      return out;
    });
    const ext = (fn) => sets.map((pts) => { let v = null; for (let i = 0; i < pts.length; i += 2) v = v == null ? pts[i] : fn(v, pts[i]); return v; });
    const le = median(ext(Math.max)), te = median(ext(Math.min));
    return sets.map((zs, i) => (le[i] != null && te[i] != null && le[i] - te[i] > 0.01 && zs.length ? { le: le[i], te: te[i], zs } : null));
  };
  const wingE = edges((y) => y > split);
  const tailE = split > -Infinity ? edges((y) => y < split) : wing.map(() => null);
  // The hinge: at its share of the chord from the trailing edge, at the middle height of the wing there; what
  // moves is within a thin airfoil's thickness of it (not a nacelle or the landing gear above or below).
  const hinge = (e, kind) => {
    const c = e.le - e.te, y = e.te + SURF_CHORD[kind] * c;
    const zs = [];
    for (let i = 0; i < e.zs.length; i += 2) if (Math.abs(e.zs[i] - y) < 0.15 * c) zs.push(e.zs[i + 1]);
    if (!zs.length) for (let i = 0; i < e.zs.length; i += 2) zs.push(e.zs[i + 1]); // (coarse: only its edges)
    zs.sort((p, q) => p - q);
    return { y, z: zs[zs.length >> 1], half: 0.05 * c + 0.003, te: e.te };
  };
  const wingH = wingE.map((e) => { const h = e && hinge(e, 1); return h ? { kind: 1, ...h } : null; });
  const tailH = tailE.map((e) => { const h = e && hinge(e, 3); return h ? { kind: 3, ...h } : null; });
  // (strips without a vertex of their own, between two that have: the hinge runs straight from one to the other)
  const fill = (hs) => {
    let last = -1;
    hs.forEach((h, i) => {
      if (!h) return;
      if (last >= 0 && i - last > 1 && hs[last].kind === h.kind) {
        for (let j = last + 1; j < i; j++) {
          const f = (j - last) / (i - last), p = hs[last];
          hs[j] = { kind: h.kind, y: p.y + (h.y - p.y) * f, z: p.z + (h.z - p.z) * f, half: p.half + (h.half - p.half) * f, te: p.te + (h.te - p.te) * f };
        }
      }
      last = i;
    });
    return hs;
  };
  fill(wingH);
  fill(tailH);
  // The flaps are cut out of the wing (not on a delta wing, as the Concorde's: none), so that they slide back and down
  // on their own, apart from it, and are painted apart (FRAG_BODY). Their vertices are theirs alone. (Without a
  // tailplane among the flat faces, as on the A350, what is behind the wing's trailing edge is not wing.)
  const chords = wingE.filter((e) => e).map((e) => e.le - e.te);
  const delta = split === -Infinity && span < 3 * chords.reduce((a, c) => a + c, 0) / chords.length; // (short and deep)
  const flapSplit = split > -Infinity ? split : Math.min(...wingE.filter((e) => e).map((e) => e.te)) - 0.03;
  const flapIn = chords.length && !delta ? cutFlaps(meshes, wingH, x0, xw, FLAP_END * span, flapSplit) : null;
  if (flapIn) readFaces(false);
  const finH = fill(fin.map((ys) => {
    if (ys.length < 2) return null;
    const le = Math.max(...ys), te = Math.min(...ys);
    return le - te > 0.01 ? { kind: 4, y: te + SURF_CHORD[4] * (le - te), z: 0, half: 0, te } : null;
  }));
  // The tailplane and the fin once more, by their faces: coarse models draw a tailplane as a few long triangles
  // from inside the fuselage out to its tip, with vertices only there, so the strips above found it at the tip at
  // most and the elevators hardly moved (the A320's rudder had 4 vertices). Where their faces cross stations across
  // the span (up the fin) are their edges, fitted with straight lines; the faces are then cut along the hinge, so
  // the elevators and the rudder turn on a hinge of their own.
  const engine = (p) => p[1] < -0.1 && p[2] > engZ0 - 0.01 && p[2] < engZ1 + 0.01;
  let tipX = 0, tailZ = null;
  const flatBehind = (ps, n) => n[2] > 0.6 && ps.every((p) => p[1] < split && !engine(p) && Math.abs(p[0]) < span) &&
    (ps.every((p) => p[0] >= 0) || ps.every((p) => p[0] <= 0));
  // (at the height where most of that flat area is: the Beech 1900's T-tail, not the small fins on its tail cone)
  const tailPlane = (ps, n) => flatBehind(ps, n) && ps.every((p) => Math.abs(p[2] - tailZ) < 0.035);
  if (split > -Infinity) {
    const area = new Map();
    eachFace(meshes, (ps, n, ids, o, a) => {
      if (!flatBehind(ps, n)) return;
      const k = Math.round((ps[0][2] + ps[1][2] + ps[2][2]) / 3 / 0.01);
      area.set(k, (area.get(k) || 0) + a);
    });
    let most = 0;
    for (const [k, a] of area) {
      const near = a + (area.get(k - 1) || 0) + (area.get(k + 1) || 0);
      if (near > most) { most = near; tailZ = k * 0.01; }
    }
    if (tailZ != null) eachFace(meshes, (ps, n) => { if (tailPlane(ps, n)) for (const p of ps) tipX = Math.max(tipX, Math.abs(p[0])); });
  }
  // (faces of the tail cone, near the middle, are not the tailplane's)
  const tailFace = (ps, n) => tailPlane(ps, n) && Math.max(...ps.map((p) => Math.abs(p[0]))) > 0.25 * tipX;
  const tail = tipX > hw ? edgeLines(meshes, tailFace, (p) => Math.abs(p[0]), 0, tipX, 0.45, 0.95) : null;
  // (a coarse fin's long faces reach down into the fuselage)
  const finFace = (ps, n) => n[0] > 0.5 && ps.every((p) => Math.abs(p[0]) < finX && p[1] < -0.15) && Math.max(...ps.map((p) => p[2])) > finZ0;
  const finL = finOn ? edgeLines(meshes, finFace, (p) => p[2], finZ0, finZ1, 0.3, 0.85) : null;
  // (the elevators start a little out from the middle, beside the tail cone)
  const elevX0 = 0.6 * hw;
  const elevAt = (ax, y, z) => {
    const le = tail.le(ax), te = tail.te(ax), c = le - te, hy = te + SURF_CHORD[3] * c, hz = tail.z(ax);
    return c > 0.005 && ax > elevX0 - 1e-5 && ax < 1.02 * tipX && y < hy && y > te - 0.01 && Math.abs(z - hz) < 0.06 * c + 0.003 ? { kind: 3, y: hy, z: hz } : null;
  };
  // (the rudder starts a little above the fuselage: the ATR's fin fillet stays put)
  const rudZ0 = finZ0 + 0.08 * (finZ1 - finZ0);
  const rudAt = (y, z) => {
    const le = finL.le(z), te = finL.te(z), c = le - te, hy = te + SURF_CHORD[4] * c;
    return c > 0.005 && z > rudZ0 - 1e-5 && z < finZ1 && y < hy && y > te - 0.01 ? { kind: 4, y: hy, z: 0 } : null;
  };
  if (tail) {
    const half = (ax) => 0.06 * (tail.le(ax) - tail.te(ax)) + 0.003;
    // (every face within its thickness: the narrow ones closing its edges too, or they would stretch)
    const inTail = (ps) => ps.every((p) => p[1] < split && !engine(p) && Math.abs(p[2] - tail.z(Math.abs(p[0]))) < 2 * half(Math.abs(p[0]))) &&
      (ps.every((p) => p[0] >= 0) || ps.every((p) => p[0] <= 0)) && Math.max(...ps.map((p) => Math.abs(p[0]))) > 0.25 * tipX;
    cutAlong(meshes, inTail,
      (p) => { const ax = Math.abs(p[0]), te = tail.te(ax); return p[1] - te - SURF_CHORD[3] * (tail.le(ax) - te); });
    cutAlong(meshes, inTail, (p) => Math.abs(p[0]) - elevX0);
    tailH.fill(null);
  }
  if (finL) {
    cutAlong(meshes, finFace, (p) => { const te = finL.te(p[2]); return p[1] - te - SURF_CHORD[4] * (finL.le(p[2]) - te); });
    cutAlong(meshes, finFace, (p) => p[2] - rudZ0);
    finH.fill(null);
  }
  if (tail || finL) readFaces(false);
  const surf = new Map(meshes.map((o) => [o, new Float32Array(o.geometry.attributes.position.count * 4)]));
  for (const o of meshes) o.geometry.userData.livSurfaces = { 1: 0, 2: 0, 3: 0, 4: 0 };
  each((o, i, x, y, z) => {
    const ax = Math.abs(x);
    let h = null;
    if (ax >= x0 && ax < span) {
      const s = Math.min(STRIPS - 1, Math.floor((ax - x0) / xw));
      if (faces.get(o)[i] & 1) for (const c of [wingH[s], tailH[s]]) if (c && y < c.y && y > c.te - 0.01 && Math.abs(z - c.z) < c.half) h = c;
      // (on the wing: ailerons on the outer third, out to the tip; flaps inboard of them)
      if (h && h.kind === 1) h = ax > 0.66 * span ? h : ax < FLAP_END * span && !flapIn && !delta ? { ...h, kind: 2 } : null;
      if (flapIn && flapIn.get(o).has(i)) h = flapIn.get(o).get(i);
    } else if (finOn && ax < finX && z > finZ0 && z < finZ1) {
      const c = finH[Math.min(STRIPS - 1, Math.floor((z - finZ0) / zw))];
      if (c && faces.get(o)[i] & 2 && y < c.y && y > c.te - 0.01) h = c;
    }
    if (!h && tail && y < split && !engine([x, y, z])) h = elevAt(ax, y, z);
    if (!h && finL && ax < finX) h = rudAt(y, z);
    if (!h) return;
    surf.get(o).set([h.kind, h.y, h.kind === 4 ? 0 : h.z, h.chord || 0], i * 4);
    o.geometry.userData.livSurfaces[h.kind]++;
  });
  for (const [o, a] of surf) {
    o.geometry.setAttribute('livSurf', new THREE.BufferAttribute(a, 4));
    o.geometry.userData.livSurfaced = true;
  }
}

// Every face of these meshes but engines' and propellers': fn([a, b, c] as [x, y, z], unit normal [x, y, z]
// with its signs dropped, the vertices' indices, mesh, area).
function eachFace(meshes, fn) {
  for (const o of meshes) {
    const g = o.geometry;
    const pos = g.attributes.position, idx = g.index, part = g.attributes.livPart, hub = g.attributes.livHub;
    const count = idx ? idx.count : pos.count;
    const skip = (i) => (part && part.getX(i) > 0.5) || (hub && hub.getZ(i) > 0.5);
    for (let t = 0; t < count; t += 3) {
      const ids = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
      if (ids.some(skip)) continue;
      const ps = ids.map((i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]);
      const u = [0, 1, 2].map((k) => ps[1][k] - ps[0][k]), v = [0, 1, 2].map((k) => ps[2][k] - ps[0][k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(...n);
      if (len < 1e-12) continue;
      fn(ps, n.map((c) => Math.abs(c) / len), ids, o, len / 2);
    }
  }
}

// Straight edges of a tailplane (or a fin) from its faces (those `pick(ps, n)` takes): at stations along it
// (`along(p)`: |x| across the span, z up the fin) from t0 to t1, where its faces cross a station their frontmost
// and rearmost points are its leading and trailing edge there; least-squares lines through the stations between
// `from` and `to` (shares of t0..t1: nearer the fuselage, its fairings would be taken for the tailplane).
// Returns { le(t), te(t), z(t) } (y of the edges, the middle height), or null.
const STATIONS = 24;
function edgeLines(meshes, pick, along, t0, t1, from, to) {
  const st = Array.from({ length: STATIONS }, (_, i) => ({ t: t0 + (i + 0.5) * (t1 - t0) / STATIONS, ys: [], zs: [] }));
  eachFace(meshes, (ps, n) => {
    if (!pick(ps, n)) return;
    const ts = ps.map(along);
    for (const s of st) {
      if (s.t < Math.min(...ts) || s.t > Math.max(...ts)) continue;
      for (let e = 0; e < 3; e++) {
        const p = ps[e], q = ps[(e + 1) % 3], tp = ts[e], tq = ts[(e + 1) % 3];
        if ((tp - s.t) * (tq - s.t) > 0 || tp === tq) continue;
        const f = (s.t - tp) / (tq - tp);
        s.ys.push(p[1] + (q[1] - p[1]) * f);
        s.zs.push(p[2] + (q[2] - p[2]) * f);
      }
    }
  });
  const use = st.filter((s) => s.ys.length >= 2 && s.t >= t0 + from * (t1 - t0) && s.t <= t0 + to * (t1 - t0));
  if (use.length < 3) return null;
  const line = (val) => {
    const n = use.length, mt = use.reduce((a, s) => a + s.t, 0) / n, mv = use.reduce((a, s) => a + val(s), 0) / n;
    let num = 0, den = 0;
    for (const s of use) { num += (s.t - mt) * (val(s) - mv); den += (s.t - mt) ** 2; }
    const k = den ? num / den : 0;
    return (t) => mv + k * (t - mt);
  };
  const le = line((s) => Math.max(...s.ys)), te = line((s) => Math.min(...s.ys));
  const z = line((s) => { const zs = [...s.zs].sort((a, b) => a - b); return zs[zs.length >> 1]; });
  return le(t1) - te(t1) > 0.003 && le(t0) - te(t0) > 0.003 ? { le, te, z } : null;
}

// Cuts the faces `pick(ps, n)` takes along the line where `side(p)` is 0 (a hinge), so that what lies behind it can
// turn about it where the model had no vertices. A cut point on an edge is the same for both faces on it.
function cutAlong(meshes, pick, side) {
  const cuts = new Map(); // geometry -> faces to cut, by their vertices (a geometry two meshes share is cut once)
  eachFace(meshes, (ps, n, ids, o) => {
    if (o.geometry.groups.length > 1 || !pick(ps, n)) return;
    const s = ps.map(side);
    if (Math.min(...s) < 0 && Math.max(...s) > 0) {
      if (!cuts.has(o.geometry)) cuts.set(o.geometry, []);
      cuts.get(o.geometry).push(ids);
    }
  });
  for (const [g, faces] of cuts) {
    const names = Object.keys(g.attributes);
    const vals = names.map((k) => { const at = g.attributes[k], v = []; for (let i = 0; i < at.count; i++) for (let c = 0; c < at.itemSize; c++) v.push(at.getComponent(i, c)); return v; });
    const xyz = vals[names.indexOf('position')];
    const P = (i) => [xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]];
    let count = g.attributes.position.count;
    const idx = g.index ? Array.from(g.index.array) : Array.from({ length: count }, (_, i) => i);
    const made = new Map(); // "a,b" -> new vertex
    const point = (a, b) => {
      if (a > b) [a, b] = [b, a];
      const key = a + ',' + b;
      if (!made.has(key)) {
        const sa = side(P(a)), t = sa / (sa - side(P(b)));
        names.forEach((name, n) => {
          const size = g.attributes[name].itemSize, v = vals[n];
          for (let c = 0; c < size; c++) v.push(v[a * size + c] + (v[b * size + c] - v[a * size + c]) * t);
        });
        made.set(key, count++);
      }
      return made.get(key);
    };
    const cut = new Set(faces.map((f) => f.join(',')));
    const out = [];
    for (let t = 0; t < idx.length; t += 3) {
      const tri = [idx[t], idx[t + 1], idx[t + 2]];
      if (!cut.has(tri.join(','))) { out.push(...tri); continue; }
      // (the vertex alone on its side first, keeping the winding: it keeps a triangle, the other two a quad)
      const neg = tri.map((i) => side(P(i)) < 0);
      const k = [0, 1, 2].find((e) => neg[e] !== neg[(e + 1) % 3] && neg[e] !== neg[(e + 2) % 3]);
      const a = tri[k], b = tri[(k + 1) % 3], c = tri[(k + 2) % 3];
      const p = point(a, b), q = point(a, c);
      out.push(a, p, q, p, b, c, p, c, q);
    }
    names.forEach((name, n) => g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(vals[n]), g.attributes[name].itemSize)));
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(out, 1) : new THREE.Uint16BufferAttribute(out, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
}

// The flaps: the wing's faces are cut along the hinge line and at the flap's ends (beside the fuselage and at FLAP_END
// of the span), and what lies behind the hinge, within a thin airfoil of it and ahead of the tailplane (`split`),
// becomes the flap, with vertices of its own (a vertex it shares with the wing is copied). Cut points on an edge are
// the same for both faces on it, so the wing stays closed while the flaps are in. Like on most airliners the flap is
// in two parts, each straight: its hinge line, height and trailing edge are fitted to the strips' (robustly: a
// nacelle or a fairing in a strip does not bend them). Where something wide reaches far back behind the trailing
// edge (a turboprop's nacelle, a wing root fairing) there is no flap. Returns per mesh the flap's vertices ->
// { kind: 2, y, z, chord }: its hinge there and its chord (the shader slides it back by part of it).
const FLAP_END = 0.63, FLAP_BREAK = 0.45; // (the split between the inner and outer part, from x0 to FLAP_END)
function cutFlaps(meshes, wingH, x0, xw, x1, split) {
  const xb = x0 + FLAP_BREAK * (x1 - x0);
  // straight lines through the strips' hinges, heights and trailing edges: of the lines through two strips the one
  // most strips lie on (the least median: a nacelle in nearly half of them does not tip it), then through those
  // strips the median slope and offset (Theil-Sen)
  const strips = wingH.map((h, i) => h && { x: x0 + (i + 0.5) * xw, h }).filter((s) => s && s.x > x0 - xw && s.x < x1 + xw);
  const med = (v) => { v.sort((p, q) => p - q); return v[v.length >> 1]; };
  const KEYS = ['y', 'z', 'te'];
  const fitPart = (from, to) => {
    const pts = strips.filter((s) => s.x >= from && s.x <= to);
    if (pts.length < 2) return null;
    let best = null, bestErr = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const p = pts[i], q = pts[j], dx = q.x - p.x;
      const err = med(pts.map((r) => Math.max(...KEYS.map((k) => Math.abs(p.h[k] + (q.h[k] - p.h[k]) * (r.x - p.x) / dx - r.h[k])))));
      if (err < bestErr) { bestErr = err; best = [p, q]; }
    }
    const [p, q] = best;
    const res = (r) => Math.max(...KEYS.map((k) => Math.abs(p.h[k] + (q.h[k] - p.h[k]) * (r.x - p.x) / (q.x - p.x) - r.h[k])));
    const good = pts.filter((r) => res(r) <= 3 * bestErr + 0.002);
    const f = {};
    for (const k of KEYS) {
      const slopes = [];
      for (let i = 0; i < good.length; i++) for (let j = i + 1; j < good.length; j++) slopes.push((good[j].h[k] - good[i].h[k]) / (good[j].x - good[i].x));
      const m = med(slopes), c = med(good.map((r) => r.h[k] - m * r.x));
      f[k] = (x) => c + m * x;
    }
    return f;
  };
  const whole = fitPart(-Infinity, Infinity);
  if (!whole) return null;
  const parts = [fitPart(x0 - xw, xb + xw) || whole, fitPart(xb - xw, x1 + xw) || whole];
  const halves = strips.map((s) => s.h.half).sort((p, q) => p - q);
  const half = halves[halves.length >> 1];
  const at = (ax, key) => {
    if (key === 'half') return half;
    const f = parts[ax < xb ? 0 : 1];
    return key === 'te' ? Math.min(f.te(ax), f.y(ax) - 0.002) : f[key](ax);
  };
  // where something reaches far behind the trailing edge, across more than a fairing's width: no flap
  const BINS = 64, behind = new Uint8Array(BINS), bw = (x1 - x0) / BINS;
  for (const o of meshes) {
    const pos = o.geometry.attributes.position, part = o.geometry.attributes.livPart, hub = o.geometry.attributes.livHub;
    for (let i = 0; i < pos.count; i++) {
      if ((part && part.getX(i) > 0.5) || (hub && hub.getZ(i) > 0.5)) continue;
      const ax = Math.abs(pos.getX(i)), y = pos.getY(i);
      if (ax <= x0 || ax >= x1 || y < split) continue;
      const h = at(ax, 'y'), te = at(ax, 'te'), chord = (h - te) / SURF_CHORD[1];
      if (y < te - 0.3 * (h - te) && Math.abs(pos.getZ(i) - at(ax, 'z')) < 0.4 * chord) behind[Math.min(BINS - 1, Math.floor((ax - x0) / bw))] = 1;
    }
  }
  const blocked = [];
  for (let i = 0; i < BINS;) {
    if (!behind[i]) { i++; continue; }
    let j = i;
    while (j < BINS && behind[j]) j++;
    if ((j - i) * bw > 0.04 * x1 / FLAP_END) blocked.push([x0 + Math.max(0, i - 1) * bw, x0 + Math.min(BINS, j + 1) * bw]);
    i = j;
  }
  const out = new Map();
  let cut = 0;
  const done = new Set();
  for (const o of meshes) o.geometry.userData.livFlapFaces = 0;
  for (const o of meshes) {
    const g = o.geometry;
    out.set(o, new Map());
    if (done.has(g)) continue; // (a geometry shared by two meshes is cut once)
    done.add(g);
    const pos = g.attributes.position, part = g.attributes.livPart, hub = g.attributes.livHub;
    const idx = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i);
    const names = Object.keys(g.attributes);
    const vals = names.map((k) => { const at = g.attributes[k], v = []; for (let i = 0; i < at.count; i++) for (let c = 0; c < at.itemSize; c++) v.push(at.getComponent(i, c)); return v; });
    let count = pos.count;
    const xyz = vals[names.indexOf('position')];
    const P = (i) => [xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]];
    const skip = (i) => i < pos.count && ((part && part.getX(i) > 0.5) || (hub && hub.getZ(i) > 0.5));
    // (the inner and outer end, the split between the parts, the ends of where there is none and, last, the hinge,
    // behind which is below 0)
    const cuts = [x0, x1, xb, ...blocked.flat()].map((x) => (p) => Math.abs(p[0]) - x);
    cuts.push((p) => p[1] - at(Math.abs(p[0]), 'y'));
    const hingeCut = cuts.length - 1;
    const made = new Map(); // "a,b,cut" -> new vertex
    const point = (a, b, k) => {
      if (a > b) [a, b] = [b, a];
      const key = a + ',' + b + ',' + k;
      if (made.has(key)) return made.get(key);
      const ga = cuts[k](P(a)), gb = cuts[k](P(b)), t = ga / (ga - gb);
      names.forEach((name, n) => {
        const size = g.attributes[name].itemSize, v = vals[n];
        for (let c = 0; c < size; c++) v.push(v[a * size + c] + (v[b * size + c] - v[a * size + c]) * t);
      });
      made.set(key, count);
      return count++;
    };
    const inBand = (p) => {
      const ax = Math.abs(p[0]), z = at(ax, 'z'), half = at(ax, 'half');
      return Math.abs(p[2] - z) < 4 * half;
    };
    // (each face keeps its material group: the A350's wing has several)
    const groups = g.groups.length ? g.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
    const groupOf = new Uint16Array(idx.length / 3);
    groups.forEach((gr, n) => groupOf.fill(n, gr.start / 3, (gr.start + gr.count) / 3));
    const tris = []; // [a, b, c, flap, group]
    const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    for (let t = 0; t < idx.length; t += 3) {
      const tri = [idx[t], idx[t + 1], idx[t + 2]];
      const ps = tri.map(P);
      const axs = ps.map((p) => Math.abs(p[0]));
      // the wing's own faces: flat ones, or (its trailing edge, a flap's end) small ones all within its thickness
      v1.set(ps[1][0] - ps[0][0], ps[1][1] - ps[0][1], ps[1][2] - ps[0][2]);
      v2.set(ps[2][0] - ps[0][0], ps[2][1] - ps[0][1], ps[2][2] - ps[0][2]);
      v1.cross(v2);
      const flat = v1.length() > 1e-12 && Math.abs(v1.z) / v1.length() > 0.6;
      const wing = !tri.some(skip) && Math.max(...axs) > x0 && Math.min(...axs) < x1 &&
        (ps.every((p) => p[0] > 0) || ps.every((p) => p[0] < 0)) && ps.some((p) => cuts[hingeCut](p) < 0) && (flat || ps.every(inBand));
      if (!wing) { tris.push([...tri, false, groupOf[t / 3]]); continue; }
      let polys = [tri];
      for (let k = 0; k < cuts.length; k++) {
        const next = [];
        for (const poly of polys) {
          const neg = [], posi = [];
          for (let e = 0; e < poly.length; e++) {
            const p = poly[e], q = poly[(e + 1) % poly.length];
            const gp = cuts[k](P(p)), gq = cuts[k](P(q));
            (gp < 0 ? neg : posi).push(p);
            if ((gp < 0) !== (gq < 0)) { const v = point(p, q, k); neg.push(v); posi.push(v); }
          }
          for (const s of [neg, posi]) if (s.length >= 3) next.push(s);
        }
        polys = next;
      }
      for (const poly of polys) {
        const ps2 = poly.map(P);
        const m = [0, 1, 2].map((c) => ps2.reduce((s, p) => s + p[c], 0) / ps2.length);
        const ax = Math.abs(m[0]);
        const flap = cuts[hingeCut](m) < 0 && ax > x0 && ax < x1 && !blocked.some(([p, q]) => ax > p && ax < q) &&
          m[1] > split && inBand(m);
        if (flap) { cut++; g.userData.livFlapFaces++; }
        for (let e = 1; e + 1 < poly.length; e++) tris.push([poly[0], poly[e], poly[e + 1], flap, groupOf[t / 3]]);
      }
    }
    // (a vertex on both the wing and a flap: the flap gets a copy)
    const onWing = new Set();
    for (const t of tris) if (!t[3]) for (let e = 0; e < 3; e++) onWing.add(t[e]);
    const copy = new Map();
    const flapV = out.get(o);
    for (const t of tris) {
      if (!t[3]) continue;
      for (let e = 0; e < 3; e++) {
        let v = t[e];
        if (onWing.has(v)) {
          if (!copy.has(v)) {
            names.forEach((name, n) => { const size = g.attributes[name].itemSize, a = vals[n]; for (let c = 0; c < size; c++) a.push(a[v * size + c]); });
            copy.set(v, count++);
          }
          v = t[e] = copy.get(v);
        }
        const ax = Math.abs(P(v)[0]);
        flapV.set(v, { kind: 2, y: at(ax, 'y'), z: at(ax, 'z'), chord: Math.max(0.001, at(ax, 'y') - at(ax, 'te')) });
      }
    }
    if (!flapV.size) continue;
    names.forEach((name, n) => {
      const old = g.attributes[name];
      g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(vals[n]), old.itemSize));
    });
    const index = [];
    const hadGroups = g.groups.length > 0;
    g.clearGroups();
    groups.forEach((gr, n) => {
      const start = index.length;
      for (const t of tris) if (t[4] === n) index.push(t[0], t[1], t[2]);
      if (hadGroups) g.addGroup(start, index.length - start, gr.materialIndex);
    });
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  // (a mesh whose geometry an earlier one shares has the same flaps)
  for (const o of meshes) {
    const first = meshes.find((p) => p.geometry === o.geometry);
    if (first !== o) out.set(o, out.get(first));
  }
  return cut ? out : null;
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
  // (where the engine nacelles or propellers reach that far forward, as on a DC-3, the widest point there is
  // one of them: then only what is near the fuselage's real width counts, FG.data.modelSize)
  const real = FG.data.modelSize && FG.data.modelSize[file];
  const expect = real ? real[1] / real[0] / 2 : 0;
  if (expect && hw > 1.6 * expect) {
    hw = 0;
    eachVertex((p) => { if (p.y >= 0.27 && p.y <= 0.36 && Math.abs(p.x) < 1.4 * expect) hw = Math.max(hw, Math.abs(p.x)); });
  }
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
    finTop: found ? finTop : null,
    top,
    width: d,
    span,
    titleBox: new THREE.Vector4(titleY, titleH * title.aspect / stretch, top - below * d - titleH / 2, titleH),
    clean: box ? new THREE.Vector4(box.y[0], box.y[1], top + box.z[0] * d, top + box.z[1] * d) : new THREE.Vector4(),
  };
}

const VERT_HEAD = `attribute float livPart;
attribute vec3 livHub;     // of a propeller: its hub (x, z), 1 (else 0, 0, 0)
attribute vec4 livSurf;    // of a control surface: kind (1 aileron, 2 flap, 3 elevator, 4 rudder), hinge y, z; a flap's chord (0: not cut out)
uniform float livSpin;     // how far the propellers have turned (radians)
uniform float livAil;      // aileron (radians, rolling right: the right one up)
uniform float livFlap;     // flaps (radians, down)
uniform float livElev;     // elevators (radians, trailing edge down)
uniform float livRud;      // rudder (radians, trailing edge to the right)
varying vec3 vLivPos;
varying vec3 vLivNor;
varying float vLivPart;
varying vec2 vLivFlap;     // on a flap: 1, how far back across its chord (0 at its leading edge, 1 at the trailing edge)
uniform float livFlex;     // how far the wing tips are bent up (down: below 0), in half spans
uniform float livSpan;     // half span
uniform float livHalfW;    // half width of the fuselage`;
// The propellers turn about their hubs, the control surfaces about their hinges, and the wings bend from the fuselage side out, most at the tips (the
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
vLivFlap = vec2(0.0);
if (livSurf.x > 0.5) {
  float livA = livSurf.x < 1.5 ? -livAil * sign(position.x) : livSurf.x < 2.5 ? livFlap : livSurf.x < 3.5 ? livElev : -livRud;
  float livC = cos(livA);
  float livS = sin(livA);
  if (livSurf.x < 3.5) {
    vec2 livR = transformed.yz - livSurf.yz;
    vec2 livH = livSurf.yz;
    if (livSurf.x > 1.5 && livSurf.x < 2.5 && livSurf.w > 0.0) {
      // a flap (cut out of the wing: livSurf.w is its chord) slides back and a little down as it goes out
      // (Fowler flaps): a narrow slot opens between it and the wing (a fifth of its chord back: the wing has no
      // shroud over it, so more would leave it hanging behind the wing, metres off on a wide-body)
      float livOut = clamp(livFlap / 0.61, 0.0, 1.2);
      livH += vec2(-0.18, -0.08) * livOut * livSurf.w;
      vLivFlap = vec2(1.0, clamp((livSurf.y - position.y) / livSurf.w, 0.0, 1.0));
    }
    transformed.yz = livH + vec2(livC * livR.x - livS * livR.y, livS * livR.x + livC * livR.y);
    #if !defined(FLAT_SHADED) && (defined(STANDARD) || defined(PHONG) || defined(LAMBERT) || defined(TOON))
    // (lit as it lies now)
    vec3 livN = vec3(objectNormal.x, livC * objectNormal.y - livS * objectNormal.z, livS * objectNormal.y + livC * objectNormal.z);
    vNormal = normalize(normalMatrix * livN);
    #endif
  } else {
    vec2 livR = vec2(transformed.y - livSurf.y, transformed.x);
    vec2 livQ = vec2(livC * livR.x - livS * livR.y, livS * livR.x + livC * livR.y);
    transformed.xy = vec2(livQ.y, livSurf.y + livQ.x);
  }
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
uniform float livNoisy;   // its texture has noisy dark shading (NOISY)
uniform float livHalfWidth; // of the fuselage
uniform vec4 livClean;    // own details are dropped between these y and between these z
varying vec3 vLivPos;
varying vec3 vLivNor;
varying float vLivPart;
varying vec2 vLivFlap;
uniform vec3 livFlapColor;
uniform vec3 livFlapSpan; // the flaps are between these |x|, in two parts split FLAP_BREAK of the way out
`;
const FRAG_BODY = `
{
  vec3 own = diffuseColor.rgb;
  float lum = dot(own, vec3(0.2126, 0.7152, 0.0722));
  float sat = max(own.r, max(own.g, own.b)) - min(own.r, min(own.g, own.b));
  // dark, colourless parts of the model's own texture stay: windows, tyres, engine intakes
  float detail = (1.0 - smoothstep(0.06, 0.16, lum)) * (1.0 - smoothstep(0.04, 0.12, sat));
#ifdef USE_MAP
  // ... in a noisy texture only where it is dark round about too: lone dark texels in the A220's baked shading
  // speckled its wing root black (GitHub issue #7). (Not in every model: small windows would go.)
  if (livNoisy > 0.5) detail *= 1.0 - smoothstep(0.04, 0.09, dot(texture2D(map, vMapUv, 2.0).rgb * diffuse, vec3(0.2126, 0.7152, 0.0722)));
#endif
  // wings and tailplanes stay plain
  float upright = 1.0 - smoothstep(0.7, 0.85, abs(normalize(vLivNor).z));
  // the fuselage (not a propeller or an engine beside it)
  float fuselage = step(abs(vLivPos.x), 1.15 * livHalfWidth);
  vec3 paint = mix(livWing, livBody, fuselage);
  float bellyZ = livBellyZ + max(0.0, vLivPos.y - livBellyNose.x) * livBellyNose.y;
  if (fuselage > 0.5 && vLivPos.y < livBellyAft && vLivPos.z < bellyZ + livLineW) paint = vLivPos.z > bellyZ - livLineW && livLineW > 0.0 ? livLine : livBelly;
  paint = mix(paint, livWinglet, step(livWingletX, abs(vLivPos.x)) * upright);
  if (vLivFlap.x > 0.5) {
    // a flap (js/livery.js cutFlaps): grey metal, not the wing's colour, with a dark seal along its leading edge and
    // dark ends and a split between its inner and outer part
    float ax = abs(vLivPos.x);
    float edge = 0.012 * (livFlapSpan.y - livFlapSpan.x);
    float seam = step(vLivFlap.y, 0.1) + step(ax, livFlapSpan.x + edge) + step(livFlapSpan.y - edge, ax) + step(abs(ax - livFlapSpan.z), edge);
    paint = mix(livFlapColor, vec3(0.16, 0.17, 0.19), min(seam, 1.0));
  }
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

// Models whose texture has dark noise baked into its shading (see FRAG_BODY).
const NOISY = { cs100: 1, cs300: 1 };

// Uniforms each material has its own of (in its userData), for the aircraft drawn with it.
export const OWN_UNIFORMS = ['livFlex', 'livSpin', 'livAil', 'livFlap', 'livElev', 'livRud'];

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
  markSurfaces(scene, m);
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
    livNoisy: { value: NOISY[file] ? 1 : 0 },
    livHalfWidth: { value: m.halfWidth },
    livHalfW: { value: m.halfWidth },
    livSpan: { value: m.span },
    livFlapColor: { value: color(0x9aa1aa) },
    livFlapSpan: { value: new THREE.Vector3(1.25 * m.halfWidth, FLAP_END * m.span, 1.25 * m.halfWidth + FLAP_BREAK * (FLAP_END * m.span - 1.25 * m.halfWidth)) },
  };
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || seen.has(o.material) || o.material.transparent) return;
    seen.add(o.material);
    // (each material has its own OWN_UNIFORMS, so an aircraft drawn with copies of them bends, turns its
    // propellers and moves its control surfaces on its own:
    // js/view3d.js ownMaterials)
    for (const k of OWN_UNIFORMS) o.material.userData[k] = { value: 0 };
    o.material.onBeforeCompile = function (shader) {
      Object.assign(shader.uniforms, uniforms);
      for (const k of OWN_UNIFORMS) shader.uniforms[k] = this.userData[k];
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
