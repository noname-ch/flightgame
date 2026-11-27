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
  b752: { y: [-1, 1], z: [-1, 9] },   // dark stripes and numbers all over the fuselage and fin
  a359: { y: [0.08, 0.36], z: [-0.7, -0.42] },   // the Airbus house livery's grey "A350 XWB" below the windows
};

// The A350's cockpit glass, outlined (the outline of the old A350 model's glass, whose nose is the same shape): the
// model's own glass is a few big faces in a ragged bluish patch of its texture. Seen from the side (y, z) and from the
// front (x, z), model units; `panes`: its side windows seen from the side, which show through the mask.
const A350_COCKPIT = {
  side: [[
    [0.45182, -0.03265], [0.45464, -0.03271], [0.45914, -0.03323], [0.46323, -0.03398], [0.46461, -0.03438],
    [0.46542, -0.03478], [0.46934, -0.03824], [0.46957, -0.03813], [0.47591, -0.0447], [0.47539, -0.04545],
    [0.47516, -0.04533], [0.47545, -0.04475], [0.47228, -0.04147], [0.47239, -0.04199], [0.47504, -0.04481],
    [0.47032, -0.04406], [0.46565, -0.04314], [0.46432, -0.04354], [0.46265, -0.04435], [0.45844, -0.04527],
    [0.45504, -0.04585], [0.45159, -0.04579], [0.44893, -0.0451], [0.44651, -0.04337], [0.44617, -0.04297],
    [0.44611, -0.04262], [0.44565, -0.04182], [0.4453, -0.0398], [0.44571, -0.0372], [0.44646, -0.03536],
    [0.44778, -0.03398], [0.44957, -0.03294],
  ]],
  panes: [[
    [0.45153, -0.03357], [0.45239, -0.03375], [0.45268, -0.03403], [0.45291, -0.03461], [0.45314, -0.03818],
    [0.45314, -0.04164], [0.45303, -0.04314], [0.45274, -0.04412], [0.45234, -0.04441], [0.45141, -0.04447],
    [0.45026, -0.04429], [0.44963, -0.04412], [0.44842, -0.04349], [0.44715, -0.04251], [0.44663, -0.04164],
    [0.4464, -0.04084], [0.4464, -0.03928], [0.4468, -0.03761], [0.44726, -0.0364], [0.44767, -0.03571],
    [0.44842, -0.03496], [0.44911, -0.0345], [0.45038, -0.03392]
  ], [
    [0.45527, -0.03386], [0.45793, -0.03392], [0.45896, -0.03415], [0.4596, -0.0345], [0.46017, -0.03507],
    [0.46087, -0.03611], [0.46311, -0.0402], [0.46363, -0.04135], [0.46369, -0.04176], [0.4634, -0.04274],
    [0.46317, -0.04297], [0.46265, -0.04314], [0.46017, -0.04377], [0.45718, -0.04435], [0.45527, -0.04429],
    [0.4551, -0.04424], [0.45481, -0.04389], [0.4547, -0.04279], [0.45476, -0.0383], [0.45458, -0.03432],
    [0.45476, -0.03403]
  ], [
    [0.46144, -0.03444], [0.46236, -0.0345], [0.46392, -0.03484], [0.46536, -0.0353], [0.46611, -0.03576],
    [0.46623, -0.03588], [0.46617, -0.03599], [0.4683, -0.03801], [0.47308, -0.04337], [0.47314, -0.0436],
    [0.47216, -0.04349], [0.46778, -0.04279], [0.46663, -0.04228], [0.46571, -0.04158], [0.46496, -0.0406],
    [0.46294, -0.0372], [0.46127, -0.03478], [0.46121, -0.03455],
  ]],
  front: [[
    [-0.01759, -0.03261], [-0.0175, -0.03288], [-0.01732, -0.0327], [-0.01473, -0.03288], [-0.00058, -0.03512],
    [0.00121, -0.03503], [0.01464, -0.03288], [0.01768, -0.0327], [0.01902, -0.03386], [0.01902, -0.03413],
    [0.01795, -0.03306], [0.01777, -0.03315], [0.01911, -0.03449], [0.02233, -0.0395], [0.02493, -0.04559],
    [0.02412, -0.04586], [0.01652, -0.04326], [0.01571, -0.04317], [0.01195, -0.04398], [0.00774, -0.04452],
    [0.00345, -0.04469], [0.00318, -0.04541], [0.00291, -0.04541], [0.003, -0.04505], [0.00255, -0.04478],
    [-0.00255, -0.04478], [-0.003, -0.04505], [-0.00291, -0.04541], [-0.00327, -0.04541], [-0.00318, -0.04514],
    [-0.00345, -0.04469], [-0.00774, -0.04452], [-0.01643, -0.04317], [-0.02225, -0.04532], [-0.02412, -0.04586],
    [-0.02475, -0.04577], [-0.02493, -0.04559], [-0.02242, -0.03968], [-0.01911, -0.03449], [-0.01759, -0.03297],
    [-0.01777, -0.03288], [-0.01902, -0.03413], [-0.01902, -0.03386],
  ]],
};

// The black mask round the cockpit windows of the newer Airbuses (the A350's "raccoon mask"). As on the real jet the
// black is a band of the same width all round the glass, seen from any side (photos of real A350s on Wikimedia Commons:
// "Airbus A350 cockpit windows (14274972354).jpg" from the side, "Airbus A350 Front View.jpg" from the front). It is
// made from the model's own cockpit glass (cockpitMask): every triangle in `region` (from y on, between these z) that
// is glass: see-through, or of a part without a texture (the A320's frames) unless its vertices' colours say it is
// light, or textured dark (the A350's windows,
// which are triangles of their own on a black patch of its texture). That glass is drawn seen from the side (y, z) and,
// where it faces forward (the windscreen: `front` and more of its normal along y), seen from the front (x, z), each
// with what its frames enclose filled in and grown by `border` of the windows' height with round
// corners and rounded `round` of it. The shader takes the side's picture where the skin faces sideways and the front's
// where it faces forward, so the band is as wide from the front as from the side.
// `types`: only these types of a model shared with older ones (the A320neo family, not the A320ceo).
// `outline`: the glass given as outlines { side: [[[y, z], ...]], front: [[[x, z], ...]], panes } instead of read off the
// model; `panes` (y, z) are left out of the side's picture, each less the border (the old A350 model's mask's look).
// `clear`: the model's own bluish window colour round the mask is painted over in the livery (the A350's ragged patch).
const MASK_STYLE = { border: 0.07, round: 0.12 };
const MASKS = {
  a359: { region: { y: 0.44, z: [-0.05, -0.03] }, front: 0.4, outline: A350_COCKPIT, clear: true },
  a20n: { region: { y: 0.405, z: [-0.055, -0.033] }, front: 0.4 },
  a321: { types: ['A321neo', 'A321XLR'], region: { y: 0.42, z: [-0.049, -0.033] }, front: 0.4 },
};
// Whether a type flies with the mask (its model's, unless the model's mask is only for some of its types).
export const maskOf = (file, type) => { const k = MASKS[file]; return k && (!k.types || k.types.includes(type)) ? k : null; };

// Models whose cabin windows are deep pockets in the fuselage skin, which look like dents: flushWindows moves
// the pockets' floors out level with the skin, and they are painted as glass.
const POCKET_WINDOWS = { atr42: true };

// Models whose window glass (cabin and cockpit) is a see-through light grey part with the light inside of the skin
// behind it, so the windows looked like grey dents: from outside, real ones look dark, with the sky's highlights
// on them. Its colour, how glossy.
const DARK_GLASS = { a320: { color: 0x0b0e12, roughness: 0.14, metalness: 0.35 }, a321: { color: 0x0b0e12, roughness: 0.14, metalness: 0.35 } };

// The doors and emergency exits of a model, painted as thin dark seams on the fuselage's sides (FRAG_BODY): each its
// middle [y, z] (model units, read off the model: the A320's beside its window row, whose windows are 0.533 m apart),
// width and height (m) and side (0 both, 1 right only: the cargo doors). The A320: the front and rear passenger doors
// (0.81 x 1.85 m), the two overwing exits round their windows (0.51 x 1.0 m), the forward and aft cargo doors and the
// bulk cargo door on the right, low down.
const CABIN_DOORS = {
  a320: [
    [0.368, -0.055, 0.81, 1.85, 0], [0.1229, -0.0525, 0.51, 1.0, 0], [0.1008, -0.0525, 0.51, 1.0, 0], [-0.2506, -0.055, 0.81, 1.85, 0],
    [0.262, -0.094, 1.81, 1.24, 1], [-0.168, -0.094, 1.81, 1.24, 1], [-0.215, -0.096, 0.95, 0.95, 1],
  ],
};
const CABIN_DOORS_MAX = 8;

// Inside a jet's inlet, by model: the grey of its bare inner wall (instead of the cowl's livery colour), from the lip
// back to the fan.
const INLETS = { a320: 0xb3b8be };
// Engines by type, as photographs show them: `fan` darkens the fan (the newer engines' dark blades, × the model's
// colour), `ring` the colour of the fan case's lining round the blade tips (the A320neo's: green).
const FANS = {
  'A320neo': { fan: 0.38, ring: 0x7cc4a4 },
  'A321neo': { fan: 0.38, ring: 0x7cc4a4 },
  'A321XLR': { fan: 0.38, ring: 0x7cc4a4 },
};

// The window glass of most models is a see-through part (a light grey or tinted material, often a third to four
// fifths opaque) with the inside of the skin or nothing behind it: the windows looked like grey dents or holes you saw
// through, and as the livery shader skipped see-through parts they did not break with the fuselage (in a crash the
// glass hung in the air, or was hidden). Real windows look dark from outside, with the sky's highlights on them: such
// glass is made solid and glossy and drawn by the livery shader as panes (livPart 6, livGlass), so it is cut where
// the fuselage breaks. Glass = a see-through part nearly all on the fuselage and not coloured (not a red beacon's or a
// green light's lens); once per geometry.
function solidGlass(scene, hw) {
  const cabin = { panes: false, strip: null };
  scene.traverse((o) => {
    if (!o.isMesh || !o.material.transparent || !o.geometry.attributes.position) return;
    const g = o.geometry, pos = g.attributes.position;
    if (g.userData.livGlass == null) {
      const c = o.material.color, sat = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
      let on = 0;
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i)) < 1.2 * hw) on++;
      g.userData.livGlass = pos.count > 8 && on >= 0.85 * pos.count && sat < 0.3;
      if (g.userData.livGlass) {
        // (along the cabin: its windows, or a strip of glass all along it in a few faces, the 737s')
        let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i), z = pos.getZ(i);
          if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
        g.userData.livCabin = y1 - y0 > 0.2 ? (pos.count < 120 ? (z0 + z1) / 2 : true) : false;
        const part = g.attributes.livPart || new THREE.BufferAttribute(new Float32Array(pos.count), 1);
        part.array.fill(6);
        part.needsUpdate = true;
        g.setAttribute('livPart', part);
      }
    }
    if (!g.userData.livGlass) return;
    const strip = typeof g.userData.livCabin === 'number';
    if (strip) cabin.strip = g.userData.livCabin; else if (g.userData.livCabin) cabin.panes = true;
    const mat = o.material;
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthWrite = true;
    mat.alphaMap = null;
    // (a strip is painted the fuselage's colour between its windows: less glossy)
    if (mat.roughness != null) { mat.roughness = strip ? 0.3 : 0.12; mat.metalness = strip ? 0.15 : 0.45; }
    mat.needsUpdate = true;
  });
  return cabin;
}

// The cabin windows the shader draws (FRAG_BODY, livWin): a row of rounded panes of the real size [width, height,
// pitch] in metres along each side, on models whose windows are only painted in their texture (light grey and a
// few pixels: under the livery they were gone, or showed as faint rings), and between them a strip of glass is
// painted over (the 737s'). Not on models with panes of their own (the A320's glass), dark windows kept from their
// texture (DETAIL) or flushed pockets (POCKET_WINDOWS). The 787's are the biggest of any airliner.
const WINDOWS = { b788: [0.28, 0.47, 0.61], b789: [0.28, 0.47, 0.61] };
const WINDOW = [0.25, 0.36, 0.53];

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

const MARKS = { cross: 1, disc: 2, ring: 3, chevron: 4, triangle: 5, text: 6, logo: 6, split: 7, flag: 8, stripes: 9 };
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

// The cockpit glass of a model (MASKS): its triangles, [[x, y, z] x 3], once per model.
const glassOf = {};
function cockpitGlass(scene, file) {
  const shape = scene.userData.shape;   // (a model lengthened by plugs: js/models3d.js reshape)
  const key = shape ? `${file}|${shape.key}` : file;
  if (glassOf[key]) return glassOf[key];
  const region = shape ? { ...MASKS[file].region, y: shapedY(shape, MASKS[file].region.y) } : MASKS[file].region;
  const tris = [];
  const pixels = new Map();   // a texture's pixels, to tell its dark parts
  const texel = (tex) => {
    if (!pixels.has(tex)) {
      const img = tex.image;
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      pixels.set(tex, { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data });
    }
    return pixels.get(tex);
  };
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.position) return;
    const g = o.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index, col = g.attributes.color;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const tex = mat.map && uv ? texel(mat.map) : null;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const j = [0, 1, 2].map((k) => (idx ? idx.getX(i + k) : i + k));
      j.forEach((v, k) => p[k].fromBufferAttribute(pos, v));
      if (p.some((v) => v.y < region.y || v.z < region.z[0] || v.z > region.z[1])) continue;
      if (!tex && col) {
        // colours in the vertices (a model of plain-coloured parts, baked into one material): glass where they are dark
        if (j.reduce((s, v) => s + col.getX(v) + col.getY(v) + col.getZ(v), 0) / 9 > 0.05) continue;
      } else if (tex && !mat.transparent) {
        // textured: glass where it is dark (the middle of the triangle in the texture)
        let u = (uv.getX(j[0]) + uv.getX(j[1]) + uv.getX(j[2])) / 3 % 1, v = (uv.getY(j[0]) + uv.getY(j[1]) + uv.getY(j[2])) / 3 % 1;
        if (u < 0) u += 1;
        if (v < 0) v += 1;
        const q = (Math.min(tex.h - 1, Math.floor(v * tex.h)) * tex.w + Math.min(tex.w - 1, Math.floor(u * tex.w))) * 4;
        if (0.2126 * tex.d[q] + 0.7152 * tex.d[q + 1] + 0.0722 * tex.d[q + 2] > 45) continue;
      }
      tris.push(p.map((v) => [v.x, v.y, v.z]));
    }
  });
  return (glassOf[key] = tris);
}

// Where a spot of a model (y in its own 1 unit length) is once it was lengthened by plugs (js/models3d.js reshape).
const shapedY = (s, y) => ((y >= s.front ? y + s.add[1] : y <= s.back ? y - s.add[0] : y) - s.c) * s.k;

// The cockpit mask of a model as two pictures, its glass grown by the border: seen from the side (y, z) and seen from
// the front (x, z, the windscreen), with where they lie: box y0, z0, 1 / length, 1 / height (front: x0, z0, ...).
function cockpitMask(scene, file) {
  const k = { ...MASK_STYLE, ...MASKS[file] };
  const shape = scene.userData.shape;
  // (outlines given: as polygons [x, y, z], the side's y where plugs moved it)
  const glass = k.outline ? k.outline.side.map((p) => p.map(([y, z]) => [0, shape ? shapedY(shape, y) : y, z])) : cockpitGlass(scene, file);
  if (!glass.length) return null;
  const zs = glass.flat().map((v) => v[2]);
  const h = Math.max(...zs) - Math.min(...zs);
  const border = k.border * h, round = k.round * h;
  const picture = (key, tris, a, b, panes = []) => {
    const pad = border + 2 * round + 0.05 * h;
    const as = tris.flat().map((v) => v[a]), bs = tris.flat().map((v) => v[b]);
    const a0 = Math.min(...as) - pad, a1 = Math.max(...as) + pad, b0 = Math.min(...bs) - pad, b1 = Math.max(...bs) + pad;
    const PX = 1024;
    const s = PX / Math.max(a1 - a0, b1 - b0);
    const w = Math.ceil((a1 - a0) * s), ht = Math.ceil((b1 - b0) * s);
    return {
      box: new THREE.Vector4(a0, b0, 1 / (w / s), 1 / (ht / s)),
      texture: mask(`cockpit|${file}|${key}`, w, ht, (ctx) => {
        // the glass, and round it a border `border` wide with round corners (each triangle drawn round thick)
        ctx.lineWidth = 2 * border * s;
        for (const t of tris) {
          ctx.beginPath();
          t.forEach((v, i) => (i ? ctx.lineTo((v[a] - a0) * s, (b1 - v[b]) * s) : ctx.moveTo((v[a] - a0) * s, (b1 - v[b]) * s)));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        const img = ctx.getImageData(0, 0, w, ht);
        const al = new Float32Array(w * ht);
        for (let i = 0; i < al.length; i++) al[i] = img.data[4 * i + 3];
        // ... with what the frames enclose (the panes: on the A350 only its frames are dark) filled in: everything the
        // outside can't reach
        const out = new Uint8Array(w * ht);
        const todo = [];
        for (let x = 0; x < w; x++) todo.push(x, (ht - 1) * w + x);
        for (let y = 0; y < ht; y++) todo.push(y * w, y * w + w - 1);
        while (todo.length) {
          const i = todo.pop();
          if (out[i] || al[i] > 127) continue;
          out[i] = 1;
          const x = i % w;
          if (x > 0) todo.push(i - 1);
          if (x < w - 1) todo.push(i + 1);
          if (i >= w) todo.push(i - w);
          if (i < (ht - 1) * w) todo.push(i + w);
        }
        for (let i = 0; i < al.length; i++) if (!out[i]) al[i] = 255;
        // ... less the panes given (outline.panes), each shrunk by the border
        if (panes.length) {
          const pc = document.createElement('canvas');
          pc.width = w;
          pc.height = ht;
          const px = pc.getContext('2d');
          px.lineWidth = 2 * border * s;
          px.lineJoin = 'round';
          const path = (t) => {
            px.beginPath();
            t.forEach((v, i) => (i ? px.lineTo((v[a] - a0) * s, (b1 - v[b]) * s) : px.moveTo((v[a] - a0) * s, (b1 - v[b]) * s)));
            px.closePath();
          };
          for (const t of panes) { path(t); px.fill(); }
          px.globalCompositeOperation = 'destination-out';
          for (const t of panes) { path(t); px.stroke(); }
          const pd = px.getImageData(0, 0, w, ht).data;
          for (let i = 0; i < al.length; i++) if (pd[4 * i + 3] > 127) al[i] = 0;
        }
        // ... blurred `round` wide (the shader cuts it at half): every corner rounded. (By hand: not every browser has
        // ctx.filter.)
        const r = Math.max(1, Math.round(round * s));
        const pass = (n, stride, step, count) => {   // a running box average along lines
          const line = new Float32Array(count);
          for (let l = 0; l < n; l++) {
            const o = l * stride;
            for (let i = 0; i < count; i++) line[i] = al[o + i * step];
            let sum = 0;
            for (let i = -r; i <= r; i++) sum += line[Math.min(count - 1, Math.max(0, i))];
            for (let i = 0; i < count; i++) {
              al[o + i * step] = sum / (2 * r + 1);
              sum += line[Math.min(count - 1, i + r + 1)] - line[Math.max(0, i - r)];
            }
          }
        };
        for (let k2 = 0; k2 < 2; k2++) { pass(ht, w, 1, w); pass(w, 1, w, ht); }
        for (let i = 0; i < al.length; i++) { img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = 255; img.data[4 * i + 3] = al[i]; }
        ctx.putImageData(img, 0, 0);
      }).texture,
    };
  };
  const sideY = (y) => (shape ? shapedY(shape, y) : y);
  const side = picture('side', glass, 1, 2, k.outline && k.outline.panes ? k.outline.panes.map((p) => p.map(([y, z]) => [0, sideY(y), z])) : []);
  // (the windscreen: the glass facing forward, `front` and more of its normal along y)
  const windscreen = k.outline ? [] : glass.filter(([a, b, c]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return Math.abs(n[1]) / (Math.hypot(...n) || 1) > k.front;
  });
  const front = k.outline ? picture('front', k.outline.front.map((p) => p.map(([x, z]) => [x, 0, z])), 0, 2)
    : picture('front', windscreen.length ? windscreen : glass, 0, 2);
  return { box: side.box, texture: side.texture, frontBox: front.box, frontTexture: front.texture };
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

// A plane's registration (its id, as "HB-JCA") as an alpha mask of a fixed shape, REG_ASPECT wide for its height, the
// letters centred (so every plane's fits the same box on the fuselage: regBox). Blank for an id that isn't one.
const REG_ASPECT = 6;
const REG_RE = /^[A-Z0-9]{1,2}-?[A-Z0-9]{2,5}$/;
let blankReg = null;
export function regTexture(id) {
  if (!id || !REG_RE.test(id)) {
    if (!blankReg) { blankReg = new THREE.DataTexture(new Uint8Array(4), 1, 1); blankReg.needsUpdate = true; }
    return blankReg;
  }
  const H = 96;
  return mask(`reg|${id}`, H * REG_ASPECT, H, (ctx) => {
    ctx.font = `600 ${Math.round(H * 0.78 / 0.716)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(id, H * REG_ASPECT / 2, H * 0.89, H * REG_ASPECT * 0.96);
  }).texture;
}

// Simple logos for the fin, drawn in one colour.
export const LOGOS = {
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
  // a five-pointed star
  star: () => mask('logo|star', 256, 256, (ctx) => {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 50 : 122;
      const a = -Math.PI / 2 + i * Math.PI / 5;
      ctx.lineTo(128 + r * Math.cos(a), 134 + r * Math.sin(a));
    }
    ctx.closePath(); ctx.fill();
  }),
  // a maple leaf
  maple: () => mask('logo|maple', 256, 256, (ctx) => {
    const pts = [[128, 12], [148, 52], [168, 42], [160, 98], [196, 62], [204, 82], [240, 76], [222, 112], [236, 120],
      [176, 166], [186, 186], [136, 178], [136, 244], [120, 244], [120, 178], [70, 186], [80, 166], [20, 120], [34, 112],
      [16, 76], [52, 82], [60, 62], [96, 98], [88, 42], [108, 52]];
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
  }),
  // a sun: a disc in a ring of rays
  sun: () => mask('logo|sun', 256, 256, (ctx) => {
    ctx.beginPath(); ctx.arc(128, 128, 58, 0, 2 * Math.PI); ctx.fill();
    ctx.lineWidth = 16;
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      ctx.beginPath(); ctx.moveTo(128 + 80 * Math.cos(a), 128 + 80 * Math.sin(a)); ctx.lineTo(128 + 118 * Math.cos(a), 128 + 118 * Math.sin(a)); ctx.stroke();
    }
  }),
  // a bird in flight, two swept wings
  bird: () => mask('logo|bird', 256, 256, (ctx) => {
    ctx.beginPath();
    ctx.moveTo(14, 96); ctx.quadraticCurveTo(80, 70, 128, 150); ctx.quadraticCurveTo(176, 70, 242, 96);
    ctx.quadraticCurveTo(180, 100, 128, 200); ctx.quadraticCurveTo(76, 100, 14, 96);
    ctx.closePath(); ctx.fill();
  }),
  // three waves
  wave: () => mask('logo|wave', 256, 256, (ctx) => {
    ctx.lineWidth = 22;
    for (const y of [70, 128, 186]) {
      ctx.beginPath(); ctx.moveTo(20, y);
      ctx.bezierCurveTo(70, y - 40, 90, y + 40, 128, y); ctx.bezierCurveTo(166, y - 40, 186, y + 40, 236, y); ctx.stroke();
    }
  }),
  // a globe: a ring with a meridian and parallels
  globe: () => mask('logo|globe', 256, 256, (ctx) => {
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(128, 128, 112, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(128, 128, 48, 112, 0, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16, 128); ctx.lineTo(240, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(36, 74); ctx.lineTo(220, 74); ctx.moveTo(36, 182); ctx.lineTo(220, 182); ctx.stroke();
  }),
  // a paper plane
  plane: () => mask('logo|plane', 256, 256, (ctx) => {
    ctx.beginPath(); ctx.moveTo(240, 30); ctx.lineTo(16, 120); ctx.lineTo(96, 150); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(240, 30); ctx.lineTo(110, 160); ctx.lineTo(150, 236); ctx.closePath(); ctx.fill();
  }),
  // a tulip
  tulip: () => mask('logo|tulip', 220, 256, (ctx) => {
    ctx.beginPath();
    ctx.moveTo(40, 40); ctx.lineTo(75, 80); ctx.lineTo(110, 24); ctx.lineTo(145, 80); ctx.lineTo(180, 40);
    ctx.quadraticCurveTo(190, 150, 110, 160); ctx.quadraticCurveTo(30, 150, 40, 40); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(110, 160); ctx.lineTo(110, 244); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(110, 220); ctx.quadraticCurveTo(70, 220, 50, 180); ctx.quadraticCurveTo(90, 190, 110, 215); ctx.fill();
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
    // (flat pieces: the blades; where there are none, as on a model whose fan is a picture on a cone, a deeper one, even
    // one round enough to pass for a cowling if it lies wholly inside a bigger cowling of the engine)
    const nested = (p) => e.cowls.some((c) => c !== p && c.box[0] <= p.box[0] && c.box[1] >= p.box[1] && c.box[4] <= p.box[4] && c.box[5] >= p.box[5]);
    const innerOf = (deep) => pieces.filter((p) => {
      const b = p.box, wide = Math.max(b[1] - b[0], b[5] - b[4]);
      return engine.has(p) && e.cowls.some((c) => c.box === engine.get(p)) && (!cowlings.includes(p) || (deep > 0.5 && nested(p))) &&
        b[3] - b[2] < deep * wide && wide > 0.08 * dia;
    }).sort((p, q) => p.box[2] - q.box[2]);
    const best = fanRing(innerOf(0.3), dia) || fanRing(innerOf(0.8), dia);
    if (best) { spin(best.parts, best.box); fans++; }
  }
  return fans;

  function fanRing(inner, dia) {
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
    return best;
  }
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
    const cowl = cowlings.find(({ box: e }) => c[0] > e[0] && c[0] < e[1] && c[1] > e[2] - 0.1 * (e[3] - e[2]) && c[1] < e[3] + 0.1 * (e[3] - e[2]) && c[2] > e[4] && c[2] < e[5]) ||
      // (or wholly within its width and height just behind it: the exhaust cone sticking out of the back)
      cowlings.find(({ box: e }) => p.box !== e && c[1] < e[2] && c[1] > e[2] - 0.6 * (e[3] - e[2]) && b[0] >= e[0] && b[1] <= e[1] && b[4] >= e[4] && b[5] <= e[5]);
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
  // Thrust reversers (the shader moves them: livRev): an engine's cowlings together make one engine, round its
  // axis. The radius is the box's narrower side: a pylon makes it taller (under a wing) or wider (on the tail), so
  // the axis is that far from the side away from the pylon.
  const revs = [];
  if (jet) {
    for (const c of cowlings) {
      const e = revs.find((e) => e.cowls.some((d) => d.box[0] < c.box[1] && c.box[0] < d.box[1] && d.box[2] < c.box[3] && c.box[2] < d.box[3] && d.box[4] < c.box[5] && c.box[4] < d.box[5]));
      if (e) { e.cowls.push(c); for (let k = 0; k < 6; k += 2) { e.box[k] = Math.min(e.box[k], c.box[k]); e.box[k + 1] = Math.max(e.box[k + 1], c.box[k + 1]); } }
      else revs.push({ cowls: [c], box: [...c.box] });
    }
    const axis = (e) => {
      const b = e.box, dx = b[1] - b[0], dz = b[5] - b[4], side = Math.sign(b[0] + b[1]);
      e.r = Math.min(dx, dz) / 2;
      e.x = dz > dx ? (b[0] + b[1]) / 2 : side > 0 ? b[1] - e.r : b[0] + e.r;
      e.z = dx > dz ? (b[4] + b[5]) / 2 : b[4] + e.r;
      e.len = b[3] - b[2];
    };
    revs.forEach(axis);
    // (a nacelle in pieces one behind the other, the CRJ's intake and its rear, is one engine)
    const inLine = (list) => {
      for (let i = 0; i < list.length; i++) for (let j = list.length - 1; j > i; j--) {
        const a = list[i], c = list[j], r = Math.max(a.r, c.r);
        if (Math.abs(a.x - c.x) > 0.5 * r || Math.abs(a.z - c.z) > 0.5 * r || Math.max(a.box[2], c.box[2]) - Math.min(a.box[3], c.box[3]) > 2 * r) continue;
        a.cowls.push(...c.cowls);
        for (let k = 0; k < 6; k += 2) { a.box[k] = Math.min(a.box[k], c.box[k]); a.box[k + 1] = Math.max(a.box[k + 1], c.box[k + 1]); }
        axis(a);
        list.splice(j, 1);
      }
      return list;
    };
    inLine(revs);
    // Only round nacelles with something in them, a fan or a core (not the A350's wing tip). A nacelle with two
    // engines side by side (Concorde's) has a round nozzle for each at its back: those are the engines.
    const inside = new Set([...engine].filter(([p]) => !cowlings.includes(p)).map(([, box]) => box));
    const round = (b) => { const q = (b[1] - b[0]) / (b[5] - b[4]); return q >= 0.8 && q <= 1.25; };
    for (let i = revs.length - 1; i >= 0; i--) {
      const e = revs[i];
      if (!e.cowls.some((c) => inside.has(c.box))) { revs.splice(i, 1); continue; }
      if (round(e.box)) continue;
      const twin = inLine(e.cowls.filter((c) => round(c.box)).map((c) => { const n = { cowls: [c], box: [...c.box] }; axis(n); return n; }));
      revs.splice(i, 1, ...(twin.length >= 2 ? twin : []));
    }
    // (an airliner's engines are all alike: something much smaller is not one)
    const big = Math.max(0, ...revs.map((e) => e.r));
    for (let i = revs.length - 1; i >= 0; i--) if (revs[i].r < 0.75 * big) revs.splice(i, 1);
  }
  scene.userData.revX = revs.map((e) => Math.abs(e.x)).sort((a, b) => a - b);
  scene.userData.revEngines = revs.map((e) => ({ x: e.x, y: (e.box[2] + e.box[3]) / 2, z: e.z, r: e.r, len: e.len, ratio: (e.box[1] - e.box[0]) / (e.box[5] - e.box[4]), n: e.cowls.length }));
  const revOf = new Map(revs.flatMap((e) => e.cowls.map((c) => [c.box, e])));
  // (where the fan turns, along y: the middle of the widest piece that turns, the blades; kept with the geometry, which
  // is searched once: fanOf)
  // (all the pieces turning round one hub together: a model may have each blade as a piece of its own)
  const fans = new Map();   // hub -> box
  for (const p of pieces) {
    const at = hubs.get(p.mesh).get(p.root);
    if (!at) continue;
    const k = `${at[0]},${at[1]}`;
    const b = fans.get(k) || [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < 6; i += 2) { b[i] = Math.min(b[i], p.box[i]); b[i + 1] = Math.max(b[i + 1], p.box[i + 1]); }
    fans.set(k, b);
  }
  let fanW = 0, fanY = null;
  for (const b of fans.values()) {
    const w = Math.max(b[1] - b[0], b[5] - b[4]);
    if (w > fanW) { fanW = w; fanY = (b[2] + b[3]) / 2; }
  }
  const fanR = fanW / 2;
  if (fanY != null) for (const m of meshes) { m.geometry.userData.livFanY = fanY; m.geometry.userData.livFanR = fanR; }
  for (const [p, cowl] of engine) {
    // (what turns is painted as a fan, even a piece round enough to have been taken for a cowling)
    marked.get(p.mesh).set(p.root, { box: cowl, own: p.box, inner: !cowlings.some((c) => c === p) || hubs.get(p.mesh).has(p.root) });
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
        else if (e.inner) {
          // (what does not turn: in the back half of its cowl the exhaust cone and the core's nozzle, 5.2; ahead of
          // that, out by the fan's tips, the wall of the inlet and the fan's case, 5.4)
          const turns = hubs.get(m).has(root[i]);
          const ax = revOf.get(e.box);
          if (!turns && e.own[2] + e.own[3] < e.box[2] + e.box[3]) part[i] = 5.2;
          else if (!turns && ax && fanR && Math.hypot(pos.getX(i) - ax.x, pos.getZ(i) - ax.z) > 0.8 * fanR) part[i] = 5.4;
          else part[i] = 5;
        }
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
    // a jet's cowlings: livEng (the engine's axis x, z, its radius, how far back: 0 at the inlet lip, 1 at the
    // exhaust) and livEngL (its length)
    const eng = new Float32Array(root.length * 4), engL = new Float32Array(root.length);
    if (cowls.size) for (let i = 0; i < root.length; i++) {
      const c = cowls.get(root[i]), e = c && !c.inner && (revOf.get(c.own) || revOf.get(c.box));
      if (!e) continue;
      eng.set([e.x, e.z, e.r, Math.min(1, Math.max(0, (e.box[3] - pos.getY(i)) / e.len))], i * 4);
      engL[i] = e.len;
    }
    m.geometry.setAttribute('livEng', new THREE.BufferAttribute(eng, 4));
    m.geometry.setAttribute('livEngL', new THREE.BufferAttribute(engL, 1));
  }
  cutSleeves(meshes);
  // (a model in one piece has no propellers to turn)
  scene.userData.props = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.geometry.attributes.livHub) {
      o.geometry.setAttribute('livHub', new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count * 3), 3));
    }
    if (!o.geometry.attributes.livEng) {
      o.geometry.setAttribute('livEng', new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count * 4), 4));
      o.geometry.setAttribute('livEngL', new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count), 1));
    }
    for (const k of ['livSleeve', 'livDoor']) if (!o.geometry.attributes[k]) o.geometry.setAttribute(k, new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count), 1));
    scene.userData.props += o.geometry.userData.livProps || 0;
  });
}

// Thrust reversers cut into the cowls. Translating sleeves (the cascade kind): each jet engine's outer skin is cut
// round SLEEVE_AT of the way back along its fan cowl (the skin's length), and the vertices on the cut are doubled:
// those in front stay, those behind get livSleeve (how far the sleeve slides back, SLEEVE_SLIDE of the skin's length)
// and a band of faces between the two, no wider than a line while stowed, opens as the cascade vanes. Pivoting doors:
// the part behind that cut is cut again along the sides of DOORS doors (their middles at 45° + k·90° round the axis,
// DOOR_HALF either side), doubled the same way; the doors' vertices get livDoor 1 and swing out about the front edge.
// (Without the cuts a coarse cowl has no vertices there: its faces stretched from near the intake and the opening
// covered most of the engine.)
const SLEEVE_AT = 0.55, SLEEVE_SLIDE = 0.16, DOORS = 4, DOOR_HALF = 0.42;
function cutSleeves(meshes) {
  for (const o of meshes) {
    const g = o.geometry;
    if (g.attributes.livSleeve) continue; // (a geometry shared by two meshes is cut once)
    const n0 = g.attributes.position.count;
    const pos = g.attributes.position, eng = g.attributes.livEng;
    const zeros = () => new THREE.BufferAttribute(new Float32Array(n0), 1);
    const key = (x, z) => `${x.toFixed(5)},${z.toFixed(5)}`;
    const skin = [];
    const ends = new Map(); // engine (its axis) -> the furthest back its skin reaches
    for (let i = 0; i < n0; i++) {
      const r = eng.getZ(i);
      skin.push(r > 0 && Math.hypot(pos.getX(i) - eng.getX(i), pos.getZ(i) - eng.getY(i)) > 0.75 * r ? 1 : 0);
      if (!skin[i]) continue;
      const k = key(eng.getX(i), eng.getY(i));
      ends.set(k, Math.max(ends.get(k) || 0, eng.getW(i)));
    }
    if (!ends.size) { g.setAttribute('livSleeve', zeros()); g.setAttribute('livDoor', zeros()); continue; }
    const names = Object.keys(g.attributes);
    const vals = names.map((k) => { const at = g.attributes[k], v = []; for (let i = 0; i < at.count; i++) for (let c = 0; c < at.itemSize; c++) v.push(at.getComponent(i, c)); return v; });
    const E = vals[names.indexOf('livEng')], L = vals[names.indexOf('livEngL')], P = vals[names.indexOf('position')];
    const engOf = (i) => key(E[4 * i], E[4 * i + 1]);
    const end = (i) => ends.get(engOf(i)) || 0;
    const angle = (i) => Math.atan2(P[3 * i + 2] - E[4 * i + 1], P[3 * i] - E[4 * i]);
    const slide = [], door = []; // (door -1: by its angle, at the end)
    const behind = (i) => E[4 * i + 3] - SLEEVE_AT * end(i);
    for (let i = 0; i < n0; i++) { slide.push(skin[i] && behind(i) > 0 ? SLEEVE_SLIDE * end(i) * L[i] : 0); door.push(-1); }
    let count = n0;
    const copy = (a, b, t, sl, dr) => {
      names.forEach((name, n) => {
        const size = g.attributes[name].itemSize, v = vals[n];
        for (let c = 0; c < size; c++) v.push(v[a * size + c] + (v[b * size + c] - v[a * size + c]) * t);
      });
      skin.push(1); slide.push(sl); door.push(dr);
      return count++;
    };
    const idx = g.index ? Array.from(g.index.array) : Array.from({ length: n0 }, (_, i) => i);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
    const tris = groups.map((gr) => idx.slice(gr.start, gr.start + gr.count));
    // Cuts the triangles pick() takes where side() changes sign. made(a, b, t) makes the two copies of a point on the
    // cut [on the minus side, on the plus side]; a band of faces between them joins the two sides, seen from both.
    const split = (pick, side, made) => {
      const memo = new Map();
      const point = (a, b) => {
        if (a > b) [a, b] = [b, a];
        const k = a + ',' + b;
        if (!memo.has(k)) { const sa = side(a); memo.set(k, made(a, b, sa / (sa - side(b)))); }
        return memo.get(k);
      };
      tris.forEach((src, gi) => {
        const out = [];
        for (let t = 0; t + 2 < src.length; t += 3) {
          const tri = [src[t], src[t + 1], src[t + 2]];
          const s3 = tri.map(side);
          if (!pick(tri) || !(Math.min(...s3) < 0 && Math.max(...s3) > 0)) { out.push(...tri); continue; }
          // (the vertex alone on its side first, keeping the winding: it keeps a triangle, the other two a quad)
          const plus = s3.map((v) => v > 0);
          const j = [0, 1, 2].find((e) => plus[e] !== plus[(e + 1) % 3] && plus[e] !== plus[(e + 2) % 3]);
          const a = tri[j], b = tri[(j + 1) % 3], c = tri[(j + 2) % 3];
          const p = point(a, b), q = point(a, c), A = plus[j] ? 1 : 0, B = 1 - A;
          out.push(a, p[A], q[A], p[B], b, c, p[B], c, q[B]);
          out.push(p[0], q[0], q[1], p[0], q[1], p[1], p[0], q[1], q[0], p[0], p[1], q[1]);
        }
        tris[gi] = out;
      });
    };
    const oneEngine = (tri) => engOf(tri[1]) === engOf(tri[0]) && engOf(tri[2]) === engOf(tri[0]);
    // the sleeve's front edge
    split((tri) => tri.every((i) => skin[i]) && oneEngine(tri), behind,
      (a, b, t) => [copy(a, b, t, 0, 0), copy(a, b, t, SLEEVE_SLIDE * end(a) * L[a], -1)]);
    // the doors' sides, behind it
    const rear = (tri) => tri.every((i) => slide[i] > 0) && oneEngine(tri);
    for (let k = 0; k < DOORS; k++) {
      const mid = Math.PI / 4 + k * 2 * Math.PI / DOORS;
      for (const [edge, inside] of [[mid - DOOR_HALF, 1], [mid + DOOR_HALF, 0]]) {
        split((tri) => rear(tri) && tri.every((i) => Math.cos(angle(i) - edge) > 0.3), (i) => Math.sin(angle(i) - edge),
          (a, b, t) => [copy(a, b, t, slide[a], 1 - inside), copy(a, b, t, slide[a], inside)]);
      }
    }
    for (let i = 0; i < count; i++) {
      if (door[i] !== -1) continue;
      const off = Math.abs(((angle(i) - Math.PI / 4) % (2 * Math.PI / DOORS) + 2 * Math.PI / DOORS) % (2 * Math.PI / DOORS));
      door[i] = slide[i] > 0 && Math.min(off, 2 * Math.PI / DOORS - off) < DOOR_HALF ? 1 : 0;
    }
    names.forEach((name, n) => g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(vals[n]), g.attributes[name].itemSize)));
    g.setAttribute('livSleeve', new THREE.BufferAttribute(new Float32Array(slide), 1));
    g.setAttribute('livDoor', new THREE.BufferAttribute(new Float32Array(door), 1));
    const out = tris.flat();
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(out, 1) : new THREE.Uint16BufferAttribute(out, 1));
    if (g.groups.length) {
      g.clearGroups();
      let at = 0;
      tris.forEach((t, gi) => { g.addGroup(at, t.length, groups[gi].materialIndex); at += t.length; });
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
}

// The control surfaces of a model, so that the shader can move them: every vertex gets the attribute livSurf
// (kind: 1 aileron, 2 flap, 3 elevator, 4 rudder; then the hinge's y and z, for the rudder its y). They are read
// off the geometry: across the span in strips, the flat vertices (not engines or propellers) make the wing and,
// behind a gap, the tailplane; the rear of their chord moves (ailerons on the outer third, flaps inboard). The
// tailplane and the fin are then read again from their faces as straight edges (edgeLines) and cut along their
// hinges (cutAlong): elevators from beside the tail cone to the tips, the rudder from a little above the fuselage.
const STRIPS = 32;
const SURF_CHORD = { 1: 0.27, 3: 0.32, 4: 0.32 }; // share of the chord that moves (wing, tailplane, fin)
function markSurfaces(scene, m, file) {
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.position && !o.geometry.userData.livSurfaced) meshes.push(o); });
  if (meshes.length) findSurfaces(meshes, m, file);
  scene.userData.surfaces = { 1: 0, 2: 0, 3: 0, 4: 0 };
  scene.userData.flapFaces = 0; // faces of the flaps cut out of the wing
  scene.userData.breaks = null; // where the fuselage breaks (bodyBreaks)
  const seen = new Set();
  scene.traverse((o) => {
    const c = o.isMesh && o.geometry.userData.livSurfaces;
    if (c) for (const k in c) scene.userData.surfaces[k] += c[k];
    if (o.isMesh && !seen.has(o.geometry)) scene.userData.flapFaces += o.geometry.userData.livFlapFaces || 0;
    if (o.isMesh && o.geometry.userData.livBreak && !scene.userData.breaks) scene.userData.breaks = o.geometry.userData.livBreak;
    if (o.isMesh) seen.add(o.geometry);
  });
}
function findSurfaces(meshes, m, file) {
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
  let engZ0 = Infinity, engZ1 = -Infinity, engY1 = -Infinity; // height of engines on the rear fuselage (not to be taken for the tailplane;
  // beside it: the A350's wing engines reach back behind -0.1 too, and their height is the tailplane's)
  for (const o of meshes) {
    const pos = o.geometry.attributes.position, part = o.geometry.attributes.livPart;
    if (part) for (let i = 0; i < pos.count; i++) if (part.getX(i) > 0.5 && pos.getY(i) < -0.1 && Math.abs(pos.getX(i)) < 2.5 * hw) { engZ0 = Math.min(engZ0, pos.getZ(i)); engZ1 = Math.max(engZ1, pos.getZ(i)); engY1 = Math.max(engY1, pos.getY(i)); }
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
  const slatIn = SLATS[file] && chords.length && !delta ? cutSlats(meshes, wingE, x0, xw, SLAT_END * span) : null;
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
  const brk = bodyBreaks(wingE, tail, tipX, x0, xw, span, delta, engY1);
  for (const o of meshes) o.geometry.userData.livBreak = brk;
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
      if (slatIn && slatIn.get(o).has(i)) h = slatIn.get(o).get(i);
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

// Where the fuselage breaks in a crash (PARTS body; the shader: livBreak): across it a little ahead of the wing's
// root (the nose section: inside 1.25 half widths, so the engines stay on the wing), and between the wing's trailing
// edge and the tailplane, swept back with them out to the tailplane's tips (the tail section, with a tail's engines).
// [nose y, tail y at 1.25 half widths, how far back the tail line runs per unit out, the tail section's reach in |x|,
// cockpit y, tail cone y]; y is along the model (its length 1). Two more cracks split those sections again, as real
// fuselages break in a hard crash (at the forward doors and in front of the tailplanes): across the nose section
// behind the cockpit (the cockpit y; ahead of it the cockpit section), and across the tail section ahead of the
// tailplanes (the tail cone y, inside 1.25 half widths; behind it the tail cone with the tailplanes and the fin). A
// delta (Concorde) has no tail section, an aircraft with its engines on the tail no tail cone; no wing found: no breaks.
function bodyBreaks(wingE, tail, tipX, x0, xw, span, delta, engY1) {
  const strip = (ax) => Math.max(0, Math.min(wingE.length - 1, Math.floor((ax - x0) / xw)));
  const wingAt = (ax) => {
    const s = strip(ax);
    for (let d = 0; d < wingE.length; d++) for (const k of [s - d, s + d]) if (wingE[k]) return wingE[k];
    return null;
  };
  const root = wingAt(x0);
  if (!root) return [9, -9, 0, 0, 9, -9];
  const nose = Math.min(0.42, root.le + 0.05);
  const cockpit = nose < 0.4 ? nose + 0.55 * (0.5 - nose) : 9;
  if (delta) return [nose, -9, 0, 0, cockpit, -9];
  let y0, k = 0.3, reach = 0.42 * span, cone = -9;
  if (tail && tipX > x0) {
    const a = Math.min(x0, 0.5 * tipX), te0 = root.te, le0 = tail.le(a);
    const teT = (wingAt(tipX) || root).te, leT = tail.le(0.95 * tipX);
    y0 = te0 - 0.4 * Math.max(0.02, te0 - le0);
    const yT = teT - 0.4 * Math.max(0.02, teT - leT);
    k = Math.max(0, Math.min(1.2, (y0 - yT) / Math.max(1e-3, 0.95 * tipX - x0)));
    reach = 1.08 * tipX;
    // (three quarters of the way from the wing's trailing edge to the tailplane's leading edge at its root)
    const le = tail.le(Math.min(x0, 0.5 * tipX));
    if (te0 - le0 > 0.04 && le < y0 - 0.04) cone = Math.max(le + 0.02, y0 - 0.35 * (te0 - le0));
  } else y0 = root.te - 0.1;
  // (engines on the tail go with it: the line ahead of them, but behind the wing)
  if (engY1 > -1) { y0 = Math.min(Math.max(y0, engY1 + 0.01), root.te - 0.005); cone = -9; }
  return [nose, y0, k, reach, cockpit, cone];
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

// The slats (SLATS: the A320's, along each wing's leading edge from beside the fuselage to near the tip, none where
// the engine's pylon meets the wing): the wing's faces are cut along a line SLAT_CHORD of the chord behind its leading
// edge (fitted straight over the strips, as the real one is) and at the slats' ends, and what lies ahead of it within
// the wing's thickness gets vertices of its own (detach). Returns per mesh the slats' vertices -> { kind: 2, y, z,
// chord }: a flap's kind with a negative chord (they belong to the wing as its flaps do; the shader moves them forward
// and down, VERT_BODY).
const SLATS = { a20n: true, a320: true }, SLAT_END = 0.95, SLAT_CHORD = 0.15;
function cutSlats(meshes, wingE, x0, xw, x1) {
  const med = (v) => { v.sort((p, q) => p - q); return v[v.length >> 1]; };
  const strips = wingE.map((e, i) => {
    if (!e) return null;
    const x = x0 + (i + 0.5) * xw, c = e.le - e.te;
    if (x > x1 + xw) return null;
    const zs = [];
    for (let k = 0; k < e.zs.length; k += 2) if (e.zs[k] > e.le - 0.25 * c) zs.push(e.zs[k + 1]);
    return zs.length ? { x, le: e.le, te: e.te, z: med(zs) } : null;
  }).filter((p) => p);
  if (strips.length < 4) return null;
  // (straight lines, Theil-Sen: a nacelle or a fairing in a few strips does not tip them)
  const fit = (k) => {
    const sl = [];
    for (let i = 0; i < strips.length; i++) for (let j = i + 1; j < strips.length; j++) sl.push((strips[j][k] - strips[i][k]) / (strips[j].x - strips[i].x));
    const m = med(sl), c = med(strips.map((p) => p[k] - m * p.x));
    return (x) => c + m * x;
  };
  const le = fit('le'), te = fit('te'), zl = fit('z');
  const chord = (ax) => Math.max(0.001, le(ax) - te(ax));
  const line = (ax) => le(ax) - SLAT_CHORD * chord(ax);
  // (where something reaches forward of the leading edge near the wing, the pylon and the engine: no slat)
  const BINS = 64, ahead = new Uint8Array(BINS), bw = (x1 - x0) / BINS;
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ax = Math.abs(pos.getX(i)), y = pos.getY(i), z = pos.getZ(i);
      if (ax <= x0 || ax >= x1) continue;
      const c = chord(ax);
      if (y > le(ax) + 0.03 * c && z < zl(ax) + 0.1 * c && z > zl(ax) - 0.9 * c) ahead[Math.min(BINS - 1, Math.floor((ax - x0) / bw))] = 1;
    }
  }
  const blocked = [];
  for (let i = 0; i < BINS;) {
    if (!ahead[i]) { i++; continue; }
    let j = i;
    while (j < BINS && ahead[j]) j++;
    blocked.push([x0 + Math.max(0, i - 1) * bw, x0 + Math.min(BINS, j + 1) * bw]);
    i = j;
  }
  const band = (p) => Math.abs(p[2] - zl(Math.abs(p[0]))) < 0.12 * chord(Math.abs(p[0])) + 0.002;
  const near = (ps) => (ps.every((p) => p[0] > 0) || ps.every((p) => p[0] < 0)) && ps.every(band) &&
    ps.some((p) => Math.abs(p[0]) > x0 && Math.abs(p[0]) < x1) && ps.every((p) => p[1] > line(Math.abs(p[0])) - 0.5 * chord(Math.abs(p[0])));
  cutAlong(meshes, near, (p) => p[1] - line(Math.abs(p[0])));
  for (const x of [x0, x1, ...blocked.flat()]) cutAlong(meshes, near, (p) => Math.abs(p[0]) - x);
  const isSlat = (q) => { const ax = Math.abs(q[0]); return ax > x0 && ax < x1 && q[1] > line(ax) && !blocked.some(([p, b]) => ax > p && ax < b); };
  const parts = detach(meshes, (ps) => near(ps) && isSlat([0, 1, 2].map((k) => (ps[0][k] + ps[1][k] + ps[2][k]) / 3)));
  const out = new Map();
  let any = 0;
  for (const o of meshes) {
    const pos = o.geometry.attributes.position, mine = new Map();
    for (const i of parts.get(o.geometry) || []) {
      const ax = Math.abs(pos.getX(i));
      mine.set(i, { kind: 2, y: line(ax), z: zl(ax), chord: -SLAT_CHORD * chord(ax) });
    }
    any += mine.size;
    out.set(o, mine);
  }
  return any ? out : null;
}

// Gives the faces `pick(ps)` takes vertices of their own where they share one with other faces, so that they can
// move apart. Returns per geometry the set of their vertices.
function detach(meshes, pick) {
  const out = new Map();
  for (const o of meshes) {
    const g = o.geometry;
    if (out.has(g) || g.groups.length > 1) continue;
    const pos = g.attributes.position;
    const idx = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i);
    const P = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const inPart = new Uint8Array(idx.length / 3);
    for (let t = 0; t < idx.length; t += 3) if (pick([P(idx[t]), P(idx[t + 1]), P(idx[t + 2])])) inPart[t / 3] = 1;
    const other = new Set();
    for (let t = 0; t < idx.length; t += 3) if (!inPart[t / 3]) for (let e = 0; e < 3; e++) other.add(idx[t + e]);
    const names = Object.keys(g.attributes);
    const vals = names.map((k) => Array.from(g.attributes[k].array));
    let count = pos.count;
    const copy = new Map(), mine = new Set();
    for (let t = 0; t < idx.length; t += 3) {
      if (!inPart[t / 3]) continue;
      for (let e = 0; e < 3; e++) {
        let v = idx[t + e];
        if (other.has(v)) {
          if (!copy.has(v)) {
            names.forEach((name, n) => { const size = g.attributes[name].itemSize, a = vals[n]; for (let c = 0; c < size; c++) a.push(a[v * size + c]); });
            copy.set(v, count++);
          }
          v = idx[t + e] = copy.get(v);
        }
        mine.add(v);
      }
    }
    if (!mine.size) continue;
    if (copy.size) {
      names.forEach((name, n) => g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(vals[n]), g.attributes[name].itemSize)));
      g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
    out.set(g, mine);
  }
  return out;
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
  // (spots of the model's own length; one lengthened by plugs has them elsewhere: shapedY)
  const shape = scene.userData.shape;
  const Y = shape ? (y) => shapedY(shape, y) : (y) => y;
  const meshes = [];
  // (not what was built onto the model: sharklets and wing tip fences, js/models3d.js addWingTips)
  scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.position && !o.userData.addOn) meshes.push(o); });
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
    if (p.y < Y(0.27) || p.y > Y(0.36)) return;
    hw = Math.max(hw, Math.abs(p.x));
    top = Math.max(top, p.z);
  });
  // (where the engine nacelles or propellers reach that far forward, as on a DC-3, the widest point there is
  // one of them: then only what is near the fuselage's real width counts, FG.data.modelSize)
  const real = FG.data.modelSize && FG.data.modelSize[file];
  const expect = real ? real[1] / real[0] / 2 : 0;
  if (expect && hw > 1.6 * expect) {
    hw = 0;
    eachVertex((p) => { if (p.y >= Y(0.27) && p.y <= Y(0.36) && Math.abs(p.x) < 1.4 * expect) hw = Math.max(hw, Math.abs(p.x)); });
  }
  const d = 2 * hw;
  // Crown of the rear fuselage, ahead of the fin.
  let crown = -Infinity;
  eachVertex((p) => {
    if (p.y > Y(0.05) || p.y < Y(-0.3) || Math.abs(p.x) > 0.35 * hw) return;
    crown = Math.max(crown, p.z);
  });
  // Usually the same height as in front (a 747's hump is higher); coarse models may have no vertex there.
  crown = crown < top - 0.5 * d ? top : Math.min(top, crown);
  // The fin: everything upright above the crown near the centre line of the rear fuselage. Its foot stays
  // in the fuselage's colour, the fin's colour starts a little higher with a level lower edge.
  const fin = { y: Y(-0.15), z: crown + 0.015 * d, x: 0.3 * hw };
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
  const titleY = Y(0.5 - (TITLE_FROM[file] || 1.4 * d));
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
    // the cabin's window row (WINDOWS): its middle a little below half the height of the rear fuselage (a 747's hump
    // is above it), from behind the cockpit to ahead of the tail
    windows: [crown - 0.43 * d, Y(0.365), Y(-0.34)],
    titleBox: new THREE.Vector4(titleY, titleH * title.aspect / stretch, top - below * d - titleH / 2, titleH),
    // the registration: letters a tenth of the fuselage high, above the windows, ending a little ahead of where the
    // fin's colour comes down the rear fuselage
    regBox: (() => {
      const h = 0.1 * d, len = h * REG_ASPECT / stretch;
      const zc = top - 0.24 * d;
      // (the fin's colour on the rear fuselage ends at this y at that height: livTail)
      const edge = found ? y1 + (crossZ - zc) * slope : Y(-0.33);
      const end = Math.max(Y(-0.4), edge + 0.015);
      return new THREE.Vector4(end + len, len, zc - h / 2, h);
    })(),
    clean: box ? new THREE.Vector4(box.y[0], box.y[1], top + box.z[0] * d, top + box.z[1] * d) : new THREE.Vector4(),
  };
}

const VERT_HEAD = `attribute float livPart;
attribute vec3 livHub;     // of a propeller: its hub (x, z), 1 (else 0, 0, 0)
attribute vec4 livSurf;    // of a control surface: kind (1 aileron, 2 flap, 3 elevator, 4 rudder), hinge y, z; a flap's chord (0: not cut out; below 0: a slat's)
uniform float livSpin;     // how far the propellers have turned (radians)
uniform float livAil;      // aileron (radians, rolling right: the right one up)
uniform float livFlap;     // flaps (radians, down)
uniform float livElev;     // elevators (radians, trailing edge down)
uniform float livRud;      // rudder (radians, trailing edge to the right)
attribute vec4 livEng;     // of a jet's cowling: the engine's axis x, z, its radius (0: not one), 0 at the inlet lip .. 1 at the exhaust
attribute float livEngL;   // ... and its length
attribute float livSleeve; // how far back it slides with the sleeve of a cascade reverser (cutSleeves; 0: it stays)
attribute float livDoor;   // 1: on a pivoting reverser door (cutSleeves)
uniform float livRev;      // thrust reversers: 0 stowed .. 1 deployed
uniform float livRevKind;  // 0 none, 1 translating sleeve (cascade), 2 pivoting doors, 3 target buckets
uniform float livRevX;     // on which engines: 0 all, above 0 those nearer than it (|axis x|), below 0 those further out than -it
varying float vLivRev;     // 1 on a moved part of a reverser (faces between it and the fixed cowl are the opening)
uniform float livBlur;     // 1: turning too fast to see the blades (js/view3d.js shows the disc instead)
varying vec3 vLivPos;
varying vec3 vLivNor;
varying float vLivPart;
varying vec2 vLivFlap;     // on a flap: 1, how far back across its chord (0 at its leading edge, 1 at the trailing edge)
uniform float livFlex;     // how far the wing tips are bent up (down: below 0), in half spans
uniform float livSpan;     // half span
uniform float livHalfW;    // half width of the fuselage
// The parts that can break off (PARTS): the wing beyond a break across the span (left x < 0, right x > 0), the
// elevators and the rudder (livSurf kinds 3 and 4).
uniform vec4 livCut;       // broken off and not drawn: wing beyond livCut.x (left) / .y (right) half spans (0: whole),
                           // elevators .z (1 left, 2 right, 3 both), .w the rudder and fuselage sections
                           // (bits: 1 rudder, 2 nose section, 4 tail section, 8 cockpit, 16 tail cone: bodyBreaks)
uniform vec4 livKeep;      // a broken-off part drawn on its own: kind (0 none, 1 wing, 2 elevators, 3 rudder, 4 a
                           // fuselage section), side (-1 left, 1 right, 0 both; a section: 1 nose, -1 tail,
                           // 2 cockpit, -2 tail cone), the break (half spans) for a wing; .w a wing's tip broken
                           // before, a section's parts gone before it broke off (bits: 1 elevators, 2 rudder, 4 the
                           // cockpit or the tail cone beyond it, a section of its own)
uniform vec4 livBreak;     // where the fuselage breaks (bodyBreaks): nose y, tail y, its sweep back, its reach in |x|
uniform vec2 livBreak2;    // ... and the cracks behind the cockpit (y; 9: none) and ahead of the tail cone (y; -9: none)
varying float vLivBody;    // into a broken-off fuselage section (> 0: not drawn), in model units
varying float vLivBodyK;   // a fuselage section drawn on its own: outside it (> 0: not drawn)
varying float vLivWing;    // past the break (> 0: not drawn), in model units
varying float vLivGone;    // 1 on a part that is not drawn, -1 on one that is
varying float vLivOut;     // a broken-off wing part whose tip had broken off before (livKeep.w): past that (> 0) not drawn`;
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
  if (livBlur > 0.98) transformed.xz = livHub.xy;   // (the blades go: the disc shows them)
}
vLivRev = 0.0;
if (livEng.z > 0.0 && livRev > 0.001 && livRevKind > 0.5 &&
    (livRevX == 0.0 || (livRevX > 0.0 ? abs(livEng.x) < livRevX : abs(livEng.x) > -livRevX))) {
  vec2 livD = transformed.xz - livEng.xy;   // out from the engine's axis
  float livR = length(livD);
  float livT = livEng.w;
  if (livRevKind < 1.5) {
    // translating sleeve: the outer skin of the rear of the fan cowl slides back, opening a band of cascade vanes
    if (livSleeve > 0.0) { transformed.y -= livSleeve * livRev; vLivRev = 1.0; }
  } else if (livRevKind < 2.5) {
    // pivoting doors (cut out of the rear of the fan cowl: cutSleeves) swing out about their front edge
    if (livDoor > 0.5) {
      float livA = 0.45 * livRev;
      float livHy = transformed.y + livT * livEngL - ${(SLEEVE_AT / SLEEVE_SLIDE).toFixed(4)} * livSleeve;
      vec2 livP = vec2(transformed.y - livHy, livR - livEng.z);
      vec2 livN = vec2(livP.x * cos(livA) + livP.y * sin(livA), livP.y * cos(livA) - livP.x * sin(livA));
      transformed.y = livHy + livN.x;
      transformed.xz = livEng.xy + livD / max(livR, 1e-6) * (livEng.z + livN.y);
      vLivRev = 1.0;
    }
  } else if (livT > 0.8) {
    // target buckets: the rear of the exhaust in two halves, upper and lower, swings back and shut behind it
    float livHy = transformed.y + (livT - 0.8) * livEngL;
    float livB = (livD.y >= 0.0 ? 1.0 : -1.0) * min(1.1, atan(livEng.z, 0.2 * livEngL)) * livRev;
    float livC = cos(livB);
    float livS = sin(livB);
    vec2 livP = vec2(transformed.y - livHy, livD.y);
    transformed.y = livHy + livC * livP.x - livS * livP.y;
    transformed.z = livEng.y + livS * livP.x + livC * livP.y;
    vLivRev = 1.0;
    #if !defined(FLAT_SHADED) && (defined(STANDARD) || defined(PHONG) || defined(LAMBERT) || defined(TOON))
    vNormal = normalize(normalMatrix * vec3(objectNormal.x, livC * objectNormal.y - livS * objectNormal.z, livS * objectNormal.y + livC * objectNormal.z));
    #endif
  }
}
vLivFlap = vec2(0.0);
if (livSurf.x > 0.5) {
  float livA = livSurf.x < 1.5 ? -livAil * sign(position.x) : livSurf.x < 2.5 ? livFlap : livSurf.x < 3.5 ? livElev : -livRud;
  // (a slat: out as soon as the flaps are, 18° for take-off and on to 27° with them for landing, as the A320's; nose down)
  float livSlat = livSurf.x > 1.5 && livSurf.x < 2.5 && livSurf.w < 0.0 ? smoothstep(0.0, 0.1, livFlap) : 0.0;
  if (livSlat > 0.0) livA = -livSlat * (0.31 + 0.16 * clamp(livFlap / 0.61, 0.0, 1.0));
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
    // ... and a slat runs forward and down on its tracks, a slot opening behind it
    if (livSurf.w < 0.0) livH += vec2(0.45, -0.2) * livSlat * -livSurf.w;
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
}
{
  // broken-off parts (livCut, livKeep): the fragment shader drops what isn't drawn, so a wing ends at a clean (then
  // torn: FRAG_BODY) line wherever the break runs through its triangles
  float livSideX = position.x < 0.0 ? -1.0 : 1.0;
  bool livEl = livSurf.x > 2.5 && livSurf.x < 3.5;
  bool livRu = livSurf.x > 3.5;
  vLivWing = -1e4;
  vLivGone = -1.0;
  vLivOut = -1e4;
  vLivBody = -1e4;
  vLivBodyK = -1e4;
  // (how far into the nose section, the cockpit, the tail section and the tail cone: > 0 in it)
  float livAX = abs(position.x), livX0 = 1.25 * livHalfW;
  float livNoseD = livAX < livX0 ? position.y - livBreak.x : -1.0;
  float livCockD = livAX < livX0 ? position.y - livBreak2.x : -1.0;
  float livTailD = livAX < livBreak.w ? livBreak.y - livBreak.z * max(livAX - livX0, 0.0) - position.y : -1.0;
  float livConeD = livAX < livX0 ? livBreak2.y - position.y : livTailD;
  if (livKeep.x > 0.5) {
    bool livMine = livKeep.y == 0.0 || livKeep.y == livSideX;
    if (livKeep.x < 1.5) {
      vLivWing = livMine ? livKeep.z * livSpan - abs(position.x) : 1e4;
      if (livKeep.w > 0.0) vLivOut = abs(position.x) - livKeep.w * livSpan; // (its own tip came off before)
    } else if (livKeep.x < 3.5) vLivGone = livMine && (livKeep.x < 2.5 ? livEl : livRu) ? -1.0 : 1.0;
    else {
      // (a section: outside its own line not drawn; with the cockpit or the tail cone beyond it a piece of its own, not
      // past that line either)
      bool livEnd = mod(floor(livKeep.w / 4.0), 2.0) > 0.5;
      if (livKeep.y > 1.5) vLivBodyK = -livCockD;
      else if (livKeep.y > 0.0) { vLivBodyK = -livNoseD; if (livEnd) vLivBody = livCockD; }
      else if (livKeep.y > -1.5) { vLivBodyK = -livTailD; if (livEnd) vLivBody = livConeD; }
      else vLivBodyK = -livConeD;
      if ((livEl && mod(livKeep.w, 2.0) > 0.5) || (livRu && mod(floor(livKeep.w / 2.0), 2.0) > 0.5)) vLivGone = 1.0;
    }
  } else {
    float livAt = livSideX < 0.0 ? livCut.x : livCut.y;
    if (livAt > 0.0) vLivWing = abs(position.x) - livAt * livSpan;
    float livE = livCut.z;
    if (livEl && (livE > 2.5 || (livSideX < 0.0 ? (livE > 0.5 && livE < 1.5) : (livE > 1.5 && livE < 2.5)))) vLivGone = 1.0;
    float livB = livCut.w;
    if (livRu && mod(livB, 2.0) > 0.5) vLivGone = 1.0;
    vLivBody = max(max(mod(floor(livB / 2.0), 2.0) > 0.5 ? livNoseD : -1e4, mod(floor(livB / 4.0), 2.0) > 0.5 ? livTailD : -1e4),
      max(mod(floor(livB / 8.0), 2.0) > 0.5 ? livCockD : -1e4, mod(floor(livB / 16.0), 2.0) > 0.5 ? livConeD : -1e4));
  }
}`;
const FRAG_HEAD = `
uniform float livLight;   // how light it is where the aircraft is (OWN_UNIFORMS)
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
uniform sampler2D livMaskTex; // the cockpit windows' mask seen from the side (cockpitMask)
uniform vec4 livMaskBox;  // ... where it lies: y0, z0, 1 / length, 1 / height (length 0: none)
uniform sampler2D livMaskTexF; // ... and seen from the front
uniform vec4 livMaskBoxF; // ... where that lies: x0, z0, 1 / width, 1 / height
uniform vec3 livMaskColor;
uniform float livMaskClear; // 1: the model's own bluish window colour round the mask goes (MASKS clear)
uniform vec3 livLine;
uniform float livLineW;  // half width of the stripe along the belly's edge
uniform vec3 livStripe;    // the cheatline along the fuselage: its middle z, half width, and 1 where there is one
uniform vec3 livStripeColor;
uniform vec3 livColor;    // of the title
uniform sampler2D livTitle;
uniform vec4 livTitleBox; // nose-side y, length, bottom z, height
uniform sampler2D livReg;  // the plane's registration (OWN_UNIFORMS: each plane its own; regTexture)
uniform vec4 livRegBox;   // where it goes on the rear fuselage: nose-side y, length, bottom z, height
uniform vec3 livRegColor;
uniform vec3 livFin;      // the fin is behind this y, above this z, within this |x|
uniform vec3 livFinColor;
uniform vec2 livTail;     // the fin's colour on the rear fuselage: behind this y at the fin's foot, slope of the edge
uniform vec3 livCross;    // the mark on the fin: centre y, centre z, half size
uniform float livMark;    // 1 cross, 2 disc, 3 ring, 4 chevron, 5 triangle, 6 text or logo, 7 split
uniform vec3 livMarkA;
uniform vec3 livMarkB;
uniform vec3 livMarkC;    // a flag's lowest band
uniform sampler2D livFinText;
uniform vec4 livFinBox;   // the text or logo on the fin: centre y, centre z, length, height
uniform float livFinAngle; // it rises by this angle towards the top of the fin
uniform vec3 livWinglet;
uniform float livWingletX; // wing tips are beyond this |x|
uniform vec4 livInlet;     // inside a jet's inlet: its colour, 1 (0: the cowl's paint)
uniform vec4 livFanCase;   // the fan case's lining round the blade tips: colour, 1 (0: none)
uniform vec3 livFan;       // where the fan turns (y), × its colour, its radius
uniform vec4 livDoors[${CABIN_DOORS_MAX}];    // doors and exits (CABIN_DOORS): middle y, z, half width, half height
uniform float livDoorSide[${CABIN_DOORS_MAX}]; // ... 0 on both sides, 1 on the right only
uniform vec3 livDoorShape; // how many, the corners' radius, half the seam's width
uniform float livStretch; // the model is drawn this much longer than it is
uniform vec4 livWin;      // the cabin windows drawn (WINDOWS): 0 none, 1 on the fuselage, 2 on its strip of glass; their
                          // middle z, half height, half width
uniform vec3 livWinY;     // ... from this y back to this y, this far apart
uniform float livNoisy;   // its texture has noisy dark shading (NOISY)
uniform vec4 livDetail;   // what of its own texture stays: darker than .x .. .y, less coloured than .z .. .w (DETAIL)
uniform float livHalfWidth; // of the fuselage
uniform vec4 livClean;    // own details are dropped between these y and between these z
varying vec3 vLivPos;
varying vec3 vLivNor;
varying float vLivPart;
varying vec2 vLivFlap;
varying float vLivRev;
uniform float livRevKind;
uniform vec4 livKeep;      // (VERT_HEAD)
uniform float livSpan;
varying float vLivWing;
varying float vLivGone;
varying float vLivOut;
varying float vLivBody;
varying float vLivBodyK;
// A break across the fuselage is torn round it, the same on both sides of it.
float livTearB(vec3 p) {
  float a = sin(p.x * 53.0 / livSpan + p.z * 71.0 / livSpan + 0.4) * 0.5 + sin(p.z * 167.0 / livSpan + 0.7) * 0.3 + sin(p.x * 389.0 / livSpan - p.z * 211.0 / livSpan) * 0.2;
  return a * 0.02 * livSpan;
}
// A break across the wing is torn, not cut: a jagged line along the chord and up through the skin, the same on the
// wing and on the part that came off, so they would fit together.
float livTear(vec3 p) {
  float a = sin(p.y * 61.0 / livSpan + 1.3) * 0.5 + sin(p.y * 157.0 / livSpan + p.z * 90.0 / livSpan) * 0.35 + sin(p.y * 409.0 / livSpan + 2.1) * 0.15;
  return a * 0.018 * livSpan;
}
// How much of a cabin window (livWin) is here: 1 in the glass, 0 outside, smooth over about a pixel.
float livWindow(vec3 p) {
  if (p.y > livWinY.x || p.y < livWinY.y) return 0.0;
  float c = livWinY.x - (floor((livWinY.x - p.y) / livWinY.z) + 0.5) * livWinY.z;
  vec2 h = vec2(livWin.w, livWin.z);
  float r = 0.9 * min(h.x, h.y);
  vec2 q = abs(vec2(p.y - c, p.z - livWin.y)) - (h - r);
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  float fw = max(fwidth(sd), 1e-7);
  return 1.0 - smoothstep(-0.5 * fw, 0.5 * fw, sd);
}
uniform vec3 livFlapSpan; // the flaps are between these |x|, in two parts split FLAP_BREAK of the way out
`;
const FRAG_BODY = `
// (broken-off parts: VERT_BODY)
float livTorn = vLivWing + (livKeep.x > 0.5 ? -1.0 : 1.0) * livTear(vLivPos);
if (livTorn > 0.0 || vLivOut + livTear(vLivPos) > 0.0) discard;
if (livKeep.x > 1.5 ? vLivGone > 0.98 : vLivGone > -0.98) discard;
float livTornB = max(vLivBody + livTearB(vLivPos), vLivBodyK - livTearB(vLivPos));
if (livTornB > 0.0) discard;
{
  vec3 own = diffuseColor.rgb;
  float lum = dot(own, vec3(0.2126, 0.7152, 0.0722));
  float sat = max(own.r, max(own.g, own.b)) - min(own.r, min(own.g, own.b));
  // dark, colourless parts of the model's own texture stay: windows, tyres, engine intakes
  // (only very dark colourless parts keep their own colour: intakes, glass, tyres. Dark panels and vertex shading
  // that were kept as "detail" showed as black boxes and stripes on wing roots and belly, e.g. ATR42, A220)
  float detail = (1.0 - smoothstep(livDetail.x, livDetail.y, lum)) * (1.0 - smoothstep(livDetail.z, livDetail.w, sat));
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
  if (fuselage > 0.5 && livStripe.z > 0.5 && abs(vLivPos.z - livStripe.x) < livStripe.y) paint = livStripeColor;
  if (fuselage > 0.5 && livMaskBox.z > 0.0) {
    // the mask round the cockpit windows: the glass grown by the border seen from the side where the skin faces
    // sideways, seen from the front where it faces forward (a band as wide from either side; sharp edges)
    vec2 mUv = (vLivPos.yz - livMaskBox.xy) * livMaskBox.zw;
    vec2 fUv = (vLivPos.xz - livMaskBoxF.xy) * livMaskBoxF.zw;
    float sideA = mUv.x > 0.0 && mUv.x < 1.0 && mUv.y > 0.0 && mUv.y < 1.0 ? texture2D(livMaskTex, mUv).a : 0.0;
    float frontA = fUv.x > 0.0 && fUv.x < 1.0 && fUv.y > 0.0 && fUv.y < 1.0 ? texture2D(livMaskTexF, fUv).a : 0.0;
    float facing = smoothstep(0.35, 0.75, normalize(vLivNor).y);
    float mA = mix(sideA, frontA, facing) - 0.5;
    // (the model's own ragged bluish patch round its windows: painted over in the livery, the mask is drawn instead)
    if (livMaskClear > 0.5 && own.b > 1.25 * own.r + 0.01 && lum < 0.55 && mUv.x > -0.3 && mUv.x < 1.3 && mUv.y > -0.3 && mUv.y < 1.3) detail = 0.0;
    if (sideA > 0.0 || frontA > 0.0) {
      float mC = clamp(mA / (fwidth(mA) + 1e-4) + 0.5, 0.0, 1.0);
      paint = mix(paint, livMaskColor, mC);
      own = mix(own, own * 0.06, mC);   // the windows in it really dark (their frames still just show)
    }
  }
  paint = mix(paint, livWinglet, step(livWingletX, abs(vLivPos.x)) * upright);
  if (vLivFlap.x > 0.5) {
    // a flap (js/livery.js cutFlaps): in the wing's livery, with a darker seal along its leading edge, darker ends
    // and a split between its inner and outer part
    float ax = abs(vLivPos.x);
    float edge = 0.008 * (livFlapSpan.y - livFlapSpan.x);
    float seam = step(vLivFlap.y, 0.05) + step(ax, livFlapSpan.x + edge) + step(livFlapSpan.y - edge, ax) + step(abs(ax - livFlapSpan.z), edge);
    paint = mix(paint, paint * 0.45 + 0.03, min(seam, 1.0));
  }
  if (vLivPart > 5.5) {
    // a window pane: glass, over any title (a strip of glass along the cabin: only its windows, livWin)
    own = livGlass;
    detail = 1.0;
    if (livWin.x > 1.5 && vLivPos.y < livWinY.x + livWinY.z && vLivPos.y > livWinY.y - livWinY.z) detail = livWindow(vLivPos);
  } else if (vLivPart > 5.3) {
    // the inlet's wall inside the cowl and the fan's case round the blade tips: the model's own colours (as the fan),
    // or bare grey (livInlet) with the case's lining round the tips (livFanCase)
    paint = vec3(lum);
    detail = 1.0 - smoothstep(0.08, 0.16, sat);
    if (livInlet.w > 0.5) { paint = livInlet.rgb; detail = 0.0; }
    if (livFanCase.w > 0.5 && vLivPos.y > livFan.x - 0.3 * livFan.z && vLivPos.y < livFan.x + 0.75 * livFan.z) { paint = livFanCase.rgb; detail = 0.0; }
  } else if (vLivPart > 5.1) {
    // the exhaust cone and the core's nozzle behind the fan: dull grey metal, lighter where the model's is
    paint = vec3(0.17, 0.175, 0.185) + 0.12 * lum;
    detail = 0.0;
  } else if (vLivPart > 4.5) {
    // inside a jet engine (fan, spinner): the model's own colours, but grey metal where they are the colours of
    // its own livery (the newer engines' fans darker: livFan.y)
    paint = vec3(lum) * livFan.y;
    own *= livFan.y;
    detail = 1.0 - smoothstep(0.08, 0.16, sat);
  }
  else if (vLivPart > 0.5) {
    paint = livEngine;
    // a jet engine (js/livery.js markEngines): its inlet lip bare metal, its exhaust grey metal
    float back = vLivPart - 1.01;
    if (back > -0.005 && back < 0.06) paint = livLip;
    else if (back > 0.86) paint = livNozzle;
    // a thrust reverser's opening (between its moved part and the fixed cowl): dark, ribbed by the vanes of a cascade
    if (vLivRev > 0.02 && vLivRev < 0.98) {
      paint = livRevKind < 1.5 ? mix(vec3(0.07, 0.075, 0.08), vec3(0.2, 0.21, 0.22), step(0.6, fract(vLivRev * 7.0))) : vec3(0.09, 0.095, 0.1);
      detail = 0.0;
    }
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
    } else if (livMark < 7.5) mark = step(0.1, p.y + 0.9 * p.x);
    else if (livMark < 8.5) {
      // a flag over the fin (the UAE's on Emirates): a bar along the front, three bands behind it, the fin's colour
      // in the middle one
      mark = 1.0;
      markColor = p.x > 0.85 ? livMarkA : p.y > 0.7 ? livMarkB : p.y < -0.7 ? livMarkC : livFinColor;
    } else {
      // thin stripes swept back along the fin's leading edge (Air France's): three in .A, then a wider one in .B
      float u = p.x + 0.9 * p.y;
      float a = step(1.2, u) * step(u, 1.42) + step(0.86, u) * step(u, 1.02) + step(0.56, u) * step(u, 0.69);
      float b = step(0.18, u) * step(u, 0.42);
      mark = max(a, b);
      markColor = b > 0.5 ? livMarkB : livMarkA;
    }
    paint = mix(paint, mix(livFinColor, markColor, mark), upright);
  }
  // the title reads from the nose on the left side and towards the nose on the right side
  vec2 t = vec2((vLivPos.x < 0.0 ? livTitleBox.x - vLivPos.y : vLivPos.y - livTitleBox.x + livTitleBox.y) / livTitleBox.y,
    (vLivPos.z - livTitleBox.z) / livTitleBox.w);
  float ink = texture2D(livTitle, clamp(t, 0.0, 1.0)).a * step(0.0, t.x) * step(t.x, 1.0) * step(0.0, t.y) * step(t.y, 1.0) * fuselage;
  paint = mix(paint, livColor, ink * upright);
  // the registration on the rear fuselage above the windows, reading the same way as the title
  vec2 rg = vec2((vLivPos.x < 0.0 ? livRegBox.x - vLivPos.y : vLivPos.y - livRegBox.x + livRegBox.y) / livRegBox.y,
    (vLivPos.z - livRegBox.z) / livRegBox.w);
  float regInk = texture2D(livReg, clamp(rg, 0.0, 1.0)).a * step(0.0, rg.x) * step(rg.x, 1.0) * step(0.0, rg.y) * step(rg.y, 1.0) * fuselage;
  paint = mix(paint, livRegColor, regInk * upright);
  // doors and exits (CABIN_DOORS): thin dark seams round rounded rectangles on the fuselage's sides, over the paint and title (no
  // thinner than about a pixel, and fainter where they would be thinner)
  if (fuselage > 0.5 && livDoorShape.x > 0.5 && abs(normalize(vLivNor).x) > 0.25) {
    float seam = 0.0;
    for (int i = 0; i < ${CABIN_DOORS_MAX}; i++) {
      if (float(i) >= livDoorShape.x) break;
      vec4 d = livDoors[i];
      if (livDoorSide[i] > 0.5 && vLivPos.x < 0.0) continue;
      vec2 q = abs(vec2(vLivPos.y - d.x, vLivPos.z - d.y)) - (d.zw - livDoorShape.y);
      float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - livDoorShape.y;
      float fw = max(fwidth(sd), 1e-7);
      float w = max(livDoorShape.z, 0.5 * fw);
      seam = max(seam, (1.0 - smoothstep(w, w + fw, abs(sd))) * clamp(2.0 * livDoorShape.z / fw, 0.3, 1.0));
    }
    paint = mix(paint, paint * 0.5, seam);
  }
  // the cabin windows, where the model has none of its own that show (WINDOWS), over the paint and the title; its own
  // faint ones round them go
  if (livWin.x > 0.5 && livWin.x < 1.5 && fuselage > 0.5 && vLivPart < 0.5 && abs(normalize(vLivNor).x) > 0.4) {
    float win = livWindow(vLivPos);
    paint = mix(paint, livGlass, win);
    if (abs(vLivPos.z - livWin.y) < 2.0 * livWin.z && vLivPos.y < livWinY.x + livWinY.z && vLivPos.y > livWinY.y - livWinY.z) detail = 0.0;
  }
  // windows painted in the model's own texture (kept as its dark detail on the fuselage's sides): darker, as glass looks
  // from outside, not dark grey
  if (fuselage > 0.5 && vLivPart < 0.5 && abs(vLivPos.z - livWin.y) < 3.0 * livWin.z) own *= mix(1.0, 0.4, upright);
  // lettering of the model's own livery goes
  if (vLivPos.y > livClean.x && vLivPos.y < livClean.y && vLivPos.z > livClean.z && vLivPos.z < livClean.w) detail = 0.0;
  diffuseColor.rgb = mix(paint, own, detail);
  // along a tear: bare torn metal and soot, the inside of the wing dark
  float livEdge = 1.0 - smoothstep(0.0, 0.03 * livSpan, -max(livTorn, livTornB));
  if (livEdge > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.05, 0.045, 0.04), vec3(0.42, 0.42, 0.4), step(0.6, fract(vLivPos.z * 300.0 / livSpan + vLivPos.y * 40.0 / livSpan))), livEdge);
  if (!gl_FrontFacing && (vLivWing > -1e3 || vLivBody > -1e3 || vLivBodyK > -1e3)) diffuseColor.rgb *= 0.25;
  diffuseColor.rgb *= livLight;
}`;

// Models whose texture has dark noise baked into its shading (see FRAG_BODY).
const NOISY = { cs100: 1, cs300: 1 };

// Models whose windows, doors and panel lines in their texture are dark grey rather than black (the A350's are dark
// petrol grey): what stays of the texture, by brightness and colourfulness (each a smooth step from .. to). Others:
// only near black, colourless parts.
const DETAIL = { a359: [0.1, 0.16, 0.1, 0.16], a380: [0.12, 0.2, 0.02, 0.05] };

// Uniforms each material has its own of (in its userData), for the aircraft drawn with it.
// livLight: how light it is where the aircraft is (1 day … dark at night, js/view3d.js placeModel).
// livCut, livKeep: the parts broken off it, or the part it is (PARTS).
export const OWN_UNIFORMS = ['livFlex', 'livSpin', 'livBlur', 'livAil', 'livFlap', 'livElev', 'livRud', 'livRev', 'livRevKind', 'livRevX', 'livLight', 'livCut', 'livKeep', 'livReg'];
const OWN_VEC4 = { livCut: 1, livKeep: 1 };

// The parts of every model that can break off in a crash, read off the same geometry as the control surfaces
// (markSurfaces): the shader draws the aircraft without them (livCut) or one of them on its own (livKeep).
// `cut`: where across the half span a wing breaks (the tip beyond it goes: past the ailerons' outer half; the
// outer wing: outboard of the inner engines, always outside the tailplanes, which reach at most 0.42 half spans).
export const PARTS = {
  tip: { cut: 0.8 },
  wing: { cut: 0.5 },
  body: { nose: 1, tail: -1, cockpit: 2, cone: -2 }, // (the fuselage: across it ahead of the wing and behind it, behind
                                                      // the cockpit and ahead of the tailplanes: bodyBreaks)
};
// Which vertices a part has, as the shader decides (for the part's middle, which it turns about as it falls):
// part { kind: 'wing' | 'elev' | 'rud' | 'body', side: -1 | 1 | 0 (a body section: 1 nose, -1 tail, 2 cockpit, -2 tail
// cone), cut, out (a wing part: where its tip broke off before, 0: none; a body section: livKeep.w bits) }; x, the vertex's livSurf kind, the model's half span; y, where the
// fuselage breaks (bodyBreaks) and its half width, for a body section.
export function inPart(part, x, kind, span, y = 0, brk = null, hw = 0) {
  if (part.kind === 'body') {
    if (!brk) return false;
    const ax = Math.abs(x), x0 = 1.25 * hw, end = ((part.out || 0) & 4) > 0;
    const nose = ax < x0 && y > brk[0], cockpit = ax < x0 && y > (brk[4] ?? 9);
    const tail = ax < brk[3] && y < brk[1] - brk[2] * Math.max(ax - x0, 0), cone = ax < x0 ? y < (brk[5] ?? -9) : tail;
    if (part.side > 1.5) return cockpit;
    if (part.side < -1.5) return cone;
    return part.side > 0 ? nose && !(end && cockpit) : tail && !(end && cone);
  }
  const mine = !part.side || Math.sign(x || 1) === part.side;
  if (!mine) return false;
  if (part.kind === 'wing') return Math.abs(x) > part.cut * span && !(part.out > 0 && Math.abs(x) > part.out * span);
  return part.kind === 'elev' ? kind > 2.5 && kind < 3.5 : kind > 3.5;
}

// Where a jet model's fans turn (y) and their radius (markEngines), or null.
function fanOf(scene) {
  let f = null;
  scene.traverse((o) => { if (o.isMesh && o.geometry.userData.livFanY != null) f = { y: o.geometry.userData.livFanY, r: o.geometry.userData.livFanR }; });
  return f;
}

// The CABIN_DOORS of a model as uniforms (metres into model units by the model's own length, FG.data.modelSize).
function doorUniforms(file) {
  const list = (CABIN_DOORS[file] || []).slice(0, CABIN_DOORS_MAX);
  const real = FG.data.modelSize && FG.data.modelSize[file];
  const per = real ? 1 / real[0] : 0;   // model units per metre
  const doors = Array.from({ length: CABIN_DOORS_MAX }, (_, i) => {
    const d = list[i];
    return d ? new THREE.Vector4(d[0], d[1], d[2] / 2 * per, d[3] / 2 * per) : new THREE.Vector4();
  });
  return {
    livDoors: { value: doors },
    livDoorSide: { value: Array.from({ length: CABIN_DOORS_MAX }, (_, i) => (list[i] ? list[i][4] : 0)) },
    livDoorShape: { value: new THREE.Vector3(per ? list.length : 0, 0.15 * per, 0.012 * per) },
  };
}

// Paints a loaded model in a livery (its materials are changed in place; clones of the model share them).
// `extra(shader)` can patch the shader further.
export function paintLivery(scene, file, extra, stretch = 1, livery = FG.livery(), type = null) {
  const title = textMask(livery.title, livery.titleStyle);
  const mark = livery.mark || {};
  const finText = mark.kind === 'text' ? textMask(mark.text, mark.style) : mark.kind === 'logo' ? (LOGOS[mark.logo] || LOGOS.star)() : title;
  const m = measure(scene, file, stretch,
    { aspect: title.aspect, at: livery.titleAt, height: livery.titleHeight, length: livery.titleLength },
    { aspect: finText.aspect, angle: mark.angle, size: mark.size });
  if (POCKET_WINDOWS[file]) flushWindows(scene, m.halfWidth);
  markEngines(scene, m.halfWidth, file);
  markSurfaces(scene, m, file);
  const prop = FG.data.props && FG.data.props[file];   // its propellers, if it has any
  const belly = livery.belly;
  const color = (c) => new THREE.Color(c);
  const glass = DARK_GLASS[file];
  if (glass) {
    scene.traverse((o) => {
      if (!o.isMesh || !o.material.transparent) return;
      o.material.color.setHex(glass.color);
      o.material.opacity = 1;
      o.material.roughness = glass.roughness;
      o.material.metalness = glass.metalness;
    });
  }
  // (a livery can leave the mask off with `mask: false`, or paint it in its own colour)
  const cockpit = livery.mask === false || !maskOf(file, type) ? null : cockpitMask(scene, file);
  if (cockpit) {
    // cockpit glass of its own (the A320's: see-through, light): dark, as the mask round it
    const [y0, z0] = [cockpit.box.x, cockpit.box.y];
    const [y1, z1] = [y0 + 1 / cockpit.box.z, z0 + 1 / cockpit.box.w];
    // (one glass part holds the cabin windows too: only its vertices round the cockpit go dark and nearly opaque,
    // through vertex colours with alpha; the geometry is shared, its other materials don't use them)
    scene.traverse((o) => {
      if (!o.isMesh || !o.material.transparent || !o.geometry.attributes.position) return;
      const pos = o.geometry.attributes.position;
      const col = new Float32Array(pos.count * 4).fill(1);
      let any = false;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i), z = pos.getZ(i);
        if (y < y0 || y > y1 || z < z0 || z > z1) continue;
        col.set([0.004, 0.0045, 0.006, 0.97 / Math.max(0.05, o.material.opacity)], 4 * i);   // (linear: about #0c0d10)
        any = true;
      }
      if (!any) return;
      o.geometry.setAttribute('color', new THREE.BufferAttribute(col, 4));
      o.material.vertexColors = true;
      o.material.needsUpdate = true;
    });
  }
  const cabin = solidGlass(scene, m.halfWidth);
  const winMode = cabin.strip != null ? 2 : cabin.panes || DETAIL[file] || POCKET_WINDOWS[file] ? 0 : 1;
  const [winW, winH, winP] = WINDOWS[file] || WINDOW;
  const perM = FG.data.modelSize && FG.data.modelSize[file] ? 1 / FG.data.modelSize[file][0] : 0;
  // (wings and tailplanes are painted grey on nearly every airliner; engines in the fuselage's colour)
  const wing = livery.wing == null ? FG.data.wingGrey ?? livery.body : livery.wing;
  const cross = m.cross.clone();
  cross.z *= mark.kind === 'text' || mark.kind === 'logo' ? 1 : mark.size || 1;
  const fan = fanOf(scene);
  const uniforms = {
    livBody: { value: color(livery.body) },
    livWing: { value: color(wing) },
    livEngine: { value: color(livery.engine == null ? livery.body : livery.engine) },
    livLip: { value: color(0xc8cdd3) },
    livNozzle: { value: color(0x6b7078) },
    livGlass: { value: color(0x080a0d) },   // (window glass from outside: nearly black)
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
    livMaskTex: { value: cockpit ? cockpit.texture : title.texture },
    livMaskBox: { value: cockpit ? cockpit.box : new THREE.Vector4() },
    livMaskTexF: { value: cockpit ? cockpit.frontTexture : title.texture },
    livMaskBoxF: { value: cockpit ? cockpit.frontBox : new THREE.Vector4() },
    livMaskClear: { value: cockpit && MASKS[file].clear ? 1 : 0 },
    livMaskColor: { value: color(typeof livery.mask === 'string' || typeof livery.mask === 'number' ? livery.mask : 0x16191d) },
    livLine: { value: color(belly && belly.line != null ? belly.line : 0) },
    livLineW: { value: belly && belly.line != null ? (belly.lineWidth || 0.04) * m.width / 2 : 0 },
    livStripe: { value: livery.stripe ? new THREE.Vector3(m.top - (livery.stripe.at ?? 0.62) * m.width, (livery.stripe.width || 0.08) * m.width / 2, 1) : new THREE.Vector3() },
    livStripeColor: { value: color(livery.stripe ? livery.stripe.color : 0) },
    livColor: { value: color(livery.titleColor) },
    livTitle: { value: title.texture },
    livTitleBox: { value: m.titleBox },
    livRegBox: { value: m.regBox },
    // (dark grey, white on a dark fuselage)
    livRegColor: { value: color(color(livery.body).getHSL({}).l < 0.4 ? 0xf2f3f5 : 0x30343a) },
    livFin: { value: m.fin },
    livFinColor: { value: color(livery.fin) },
    livTail: { value: livery.tail ? m.tail : new THREE.Vector2(-99, 0) },
    livCross: { value: cross },
    livMark: { value: MARKS[mark.kind] || 0 },
    livMarkA: { value: color(mark.color == null ? livery.fin : mark.color) },
    livMarkB: { value: color(mark.color2 == null ? (mark.color == null ? livery.fin : mark.color) : mark.color2) },
    livMarkC: { value: color(mark.color3 == null ? livery.fin : mark.color3) },
    livFinText: { value: finText.texture },
    livFinBox: { value: m.finBox },
    livFinAngle: { value: m.finAngle },
    livWinglet: { value: color(livery.winglet == null ? livery.body : livery.winglet) },
    // (sharklets and fences: on them only, js/models3d.js addWingTips)
    livWingletX: { value: livery.winglet == null ? 99 : scene.userData.wingletX || 0.955 * m.span },
    livClean: { value: m.clean },
    ...doorUniforms(file),
    livInlet: { value: INLETS[file] != null ? new THREE.Vector4(...color(INLETS[file]).toArray(), 1) : new THREE.Vector4() },
    livFanCase: { value: FANS[type] && FANS[type].ring != null && fan ? new THREE.Vector4(...color(FANS[type].ring).toArray(), 1) : new THREE.Vector4() },
    livFan: { value: new THREE.Vector3(fan ? fan.y : 99, FANS[type] && FANS[type].fan || 1, fan ? fan.r : 0) },
    livStretch: { value: stretch },
    livWin: { value: new THREE.Vector4(perM ? winMode : 0, winMode === 2 ? cabin.strip : m.windows[0], winH / 2 * perM, winW / 2 * perM / stretch) },
    livWinY: { value: new THREE.Vector3(m.windows[1], m.windows[2], winP * perM / stretch) },
    livNoisy: { value: NOISY[file] ? 1 : 0 },
    livDetail: { value: new THREE.Vector4(...(DETAIL[file] || [0.02, 0.05, 0.02, 0.06])) },
    livHalfWidth: { value: m.halfWidth },
    livHalfW: { value: m.halfWidth },
    livBreak: { value: new THREE.Vector4(...(scene.userData.breaks || [9, -9, 0, 0]).slice(0, 4)) },
    livBreak2: { value: new THREE.Vector2(...(scene.userData.breaks || [0, 0, 0, 0, 9, -9]).slice(4, 6)) },
    livSpan: { value: m.span },
    livFlapSpan: { value: new THREE.Vector3(1.25 * m.halfWidth, FLAP_END * m.span, 1.25 * m.halfWidth + FLAP_BREAK * (FLAP_END * m.span - 1.25 * m.halfWidth)) },
  };
  // (kept for the Rust app's model export, tools/export_models.mjs in lianhirter-arch/flightgame-rust: the uniforms the models are painted with)
  scene.userData.liv = uniforms;
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || seen.has(o.material) || o.material.transparent) return;
    seen.add(o.material);
    // (each material has its own OWN_UNIFORMS, so an aircraft drawn with copies of them bends, turns its
    // propellers and moves its control surfaces on its own:
    // js/view3d.js ownMaterials)
    for (const k of OWN_UNIFORMS) o.material.userData[k] = { value: OWN_VEC4[k] ? new THREE.Vector4(0, 0, 0, 0) : k === 'livLight' ? 1 : k === 'livReg' ? regTexture(null) : 0 };
    o.material.userData.livSpanOf = m.span; // (the half span the shader breaks parts off at: js/view3d.js partMiddle)
    o.material.userData.livBreakOf = scene.userData.breaks; // (and where the fuselage breaks, with its half width)
    o.material.userData.livHalfOf = m.halfWidth;
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
