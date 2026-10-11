// Loads the 3D aircraft models for the 3D view and the hangar, painted in the airline livery: glTF files
// (models/*.glb, see models/README.md) or, for the types in FG.data.builtModels, built by js/planebuilder.js.
// FG.data.models says which aircraft type uses which model.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { paintLivery } from './livery.js';
import { buildPlane } from './planebuilder.js';

const MODELS = new URL('../models/', import.meta.url);
const raws = {};    // file -> Promise of the unpainted scene
const loads = {};   // file + stretch -> Promise of the painted scene

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
    raws[file] = FG.data.builtModels && FG.data.builtModels[file]
      ? Promise.resolve().then(() => buildPlane(file))
      : new GLTFLoader().loadAsync(new URL(`${file}.glb`, MODELS).href).then((gltf) => gltf.scene);
  }
  return raws[file];
}

// The painted model of a type, 1 unit long: scale it with modelSize(type). The scene is shared, clone() it
// for every aircraft drawn. Stretched types get their own materials, so the livery can keep its proportions.
export function loadModel(type) {
  const { file, stretch } = modelSize(type);
  const key = `${file}|${stretch}`;
  if (!loads[key]) {
    loads[key] = raw(file).then((scene) => {
      const copy = scene.clone();
      copy.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
      return paintLivery(copy, file, patchFacing, stretch);
    });
    loads[key].catch((e) => console.warn(`3D model ${file} not loaded`, e));
  }
  return loads[key];
}
