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
// (1 = engine). The models are made of many separate pieces; an engine's cowling is a round piece beside
// the fuselage, about as wide as it is high and longer than half its width, and with it go the pieces in it.
function markEngines(scene, hw) {
  const d = 2 * hw;
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.position && !o.geometry.attributes.livPart) meshes.push(o); });
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
  const engine = new Set();
  for (const p of pieces) {
    const b = p.box;
    const c = [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2];
    if (cowlings.some(({ box: e }) => c[0] > e[0] && c[0] < e[1] && c[1] > e[2] - 0.1 * (e[3] - e[2]) && c[1] < e[3] + 0.1 * (e[3] - e[2]) && c[2] > e[4] && c[2] < e[5])) engine.add(p);
  }
  scene.userData.engines = cowlings.length;
  const marked = new Map(meshes.map((m) => [m, new Set()]));
  for (const p of engine) marked.get(p.mesh).add(p.root);
  for (const m of meshes) {
    const root = roots.get(m);
    const part = new Float32Array(root.length);
    const set = marked.get(m);
    if (set.size) for (let i = 0; i < root.length; i++) part[i] = set.has(root[i]) ? 1 : 0;
    m.geometry.setAttribute('livPart', new THREE.BufferAttribute(part, 1));
  }
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
  // Forward fuselage, between the cockpit and the wing: half width and top. A built model says so itself.
  const known = scene.userData.fuselage;
  let hw = known ? known.halfWidth : 0;
  let top = known ? known.top : -Infinity;
  let span = 0;
  eachVertex((p) => {
    span = Math.max(span, Math.abs(p.x));
    if (known || p.y < 0.27 || p.y > 0.36) return;
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
  const titleY = 0.5 - (TITLE_FROM[file] || (known && known.title) || 1.4 * d);
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

const VERT_HEAD = 'attribute float livPart;\nvarying vec3 vLivPos;\nvarying vec3 vLivNor;\nvarying float vLivPart;';
const VERT_BODY = 'vLivPos = position;\nvLivNor = normal;\nvLivPart = livPart;';
const FRAG_HEAD = `
uniform vec3 livBody;
uniform vec3 livWing;
uniform vec3 livEngine;
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
  if (vLivPart > 0.5) paint = livEngine;
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
  markEngines(scene, m.halfWidth);
  const belly = livery.belly;
  const color = (c) => new THREE.Color(c);
  const wing = livery.wing == null ? livery.body : livery.wing;
  const cross = m.cross.clone();
  cross.z *= mark.kind === 'text' || mark.kind === 'logo' ? 1 : mark.size || 1;
  const uniforms = {
    livBody: { value: color(livery.body) },
    livWing: { value: color(wing) },
    livEngine: { value: color(livery.engine == null ? wing : livery.engine) },
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
  };
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || seen.has(o.material) || o.material.transparent) return;
    seen.add(o.material);
    o.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      if (extra) extra(shader);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_BODY}`);
    };
    o.material.customProgramCacheKey = () => 'livery';
    o.material.needsUpdate = true;
  });
  return scene;
}
