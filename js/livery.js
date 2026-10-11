// Airline livery for the 3D aircraft models, after the livery of SWISS: white aircraft, red fin with a white
// cross, large red title on the forward fuselage. Of its own texture a model keeps only the dark details
// (windows, tyres, engine intakes).
// The livery is painted in the shader from the position on the aircraft (model axes: x = right wing, y = nose,
// z = up, length 1), so the same livery fits every model without touching its texture.
import * as THREE from 'three';

export const LIVERY = { title: 'SWISS', color: 0xe60005, body: 0xf1f2f4 };

// Dark lettering of a model's own livery that would show through: y range, and z range in fuselage widths
// below the top of the fuselage.
const CLEAN = {
  a380: { y: [-0.3, 0], z: [-0.62, -0.22] },
  b752: { y: [-1, 1], z: [-1, 9] },   // dark stripes and numbers all over the fuselage and fin
};

let titleTexture = null;
let titleAspect = 1;

// The title as an alpha mask; the letters fill the height of the picture.
function title() {
  if (titleTexture) return titleTexture;
  const H = 128;
  const PAD = 8;
  const font = `700 ${Math.round((H - 2 * PAD) / 0.716)}px Arial, Helvetica, sans-serif`; // cap height = 0.716 em
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d');
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(LIVERY.title).width) + 2 * PAD;
  c.height = H;
  ctx = c.getContext('2d');
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(LIVERY.title, PAD, H - PAD);
  titleAspect = c.width / c.height;
  titleTexture = new THREE.CanvasTexture(c);
  titleTexture.anisotropy = 4;
  return titleTexture;
}

// Where the fuselage and the fin of this model are. Positions are read straight from the geometry, as the
// shader sees them (the models have no node transforms).
function measure(scene, file) {
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
  eachVertex((p) => {
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
  // white, the red starts a little higher with a level lower edge.
  const fin = { y: -0.15, z: crown + 0.015 * d, x: 0.3 * hw };
  let finTop = fin.z;
  eachVertex((p) => { if (p.y < fin.y && p.z > fin.z && Math.abs(p.x) < fin.x) finTop = Math.max(finTop, p.z); });
  fin.z += 0.15 * (finTop - fin.z);
  // The cross sits at half the height of the red, in the middle of the fin's chord there.
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
      for (let k = 0; k < 3; k++) { // where the triangle's edges cross the height of the cross
        const p = tri[k], q = tri[(k + 1) % 3];
        if ((p.z - crossZ) * (q.z - crossZ) >= 0) continue;
        const y = p.y + (q.y - p.y) * (crossZ - p.z) / (q.z - p.z);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  const found = y1 > y0;
  // Title: large, across the window row, from behind the first door to at most a third of the length.
  const titleY = 0.5 - 1.4 * d;
  const titleLen = Math.max(0.6 * d, Math.min(1.8 * d, titleY - 0.18));
  const titleH = titleLen / titleAspect;
  return {
    fin: found ? new THREE.Vector3(fin.y, fin.z, fin.x) : new THREE.Vector3(0, 99, 0),
    cross: found ? new THREE.Vector3((y0 + y1) / 2, crossZ, Math.min(0.22 * height, 0.27 * (y1 - y0))) : new THREE.Vector3(0, 99, 1),
    titleBox: new THREE.Vector4(titleY, titleLen, top - 0.42 * d - titleH / 2, titleH),
    clean: box ? new THREE.Vector4(box.y[0], box.y[1], top + box.z[0] * d, top + box.z[1] * d) : new THREE.Vector4(),
  };
}

const VERT_HEAD = 'varying vec3 vLivPos;\nvarying vec3 vLivNor;';
const VERT_BODY = 'vLivPos = position;\nvLivNor = normal;';
const FRAG_HEAD = `
uniform vec3 livBody;
uniform vec3 livColor;
uniform sampler2D livTitle;
uniform vec4 livTitleBox; // nose-side y, length, bottom z, height
uniform vec3 livFin;      // the fin is behind this y, above this z, within this |x|
uniform vec3 livCross;    // centre y, centre z, half size
uniform vec4 livClean;    // own details are dropped between these y and between these z
varying vec3 vLivPos;
varying vec3 vLivNor;`;
const FRAG_BODY = `
{
  vec3 own = diffuseColor.rgb;
  float lum = dot(own, vec3(0.2126, 0.7152, 0.0722));
  float sat = max(own.r, max(own.g, own.b)) - min(own.r, min(own.g, own.b));
  // dark, colourless parts of the model's own texture stay: windows, tyres, engine intakes
  float detail = (1.0 - smoothstep(0.06, 0.16, lum)) * (1.0 - smoothstep(0.04, 0.12, sat));
  // wings and tailplanes stay plain
  float upright = 1.0 - smoothstep(0.7, 0.85, abs(normalize(vLivNor).z));
  vec3 paint = livBody;
  if (vLivPos.y < livFin.x && vLivPos.z > livFin.y && abs(vLivPos.x) < livFin.z) {
    vec2 d = abs(vLivPos.yz - livCross.xy) / livCross.z;
    float cross = step(max(d.x, d.y), 1.0) * step(min(d.x, d.y), 0.3);
    paint = mix(paint, mix(livColor, vec3(1.0), cross), upright);
  }
  // the title reads from the nose on the left side and towards the nose on the right side
  vec2 t = vec2((vLivPos.x < 0.0 ? livTitleBox.x - vLivPos.y : vLivPos.y - livTitleBox.x + livTitleBox.y) / livTitleBox.y,
    (vLivPos.z - livTitleBox.z) / livTitleBox.w);
  float ink = texture2D(livTitle, clamp(t, 0.0, 1.0)).a * step(0.0, t.x) * step(t.x, 1.0) * step(0.0, t.y) * step(t.y, 1.0);
  paint = mix(paint, livColor, ink * upright);
  // lettering of the model's own livery goes
  if (vLivPos.y > livClean.x && vLivPos.y < livClean.y && vLivPos.z > livClean.z && vLivPos.z < livClean.w) detail = 0.0;
  diffuseColor.rgb = mix(paint, own, detail);
}`;

// Paints a loaded model (its materials are changed in place; clones of the model share them).
// `extra(shader)` can patch the shader further.
export function paintLivery(scene, file, extra) {
  const tex = title();
  const m = measure(scene, file);
  const uniforms = {
    livBody: { value: new THREE.Color(LIVERY.body) },
    livColor: { value: new THREE.Color(LIVERY.color) },
    livTitle: { value: tex },
    livTitleBox: { value: m.titleBox },
    livFin: { value: m.fin },
    livCross: { value: m.cross },
    livClean: { value: m.clean },
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
