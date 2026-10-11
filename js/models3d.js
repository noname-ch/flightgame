// Loads the glTF aircraft models (models/*.glb, see models/README.md) for the 3D view and the hangar,
// painted in the airline livery. FG.data.models says which aircraft type uses which file.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { paintLivery } from './livery.js';

const MODELS = new URL('../models/', import.meta.url);
const loads = {};   // file -> Promise of the loaded scene

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

// The scene is shared: clone() it for every aircraft drawn.
export function loadModel(file) {
  if (!loads[file]) {
    loads[file] = new GLTFLoader().loadAsync(new URL(`${file}.glb`, MODELS).href)
      .then((gltf) => paintLivery(gltf.scene, file, patchFacing));
    loads[file].catch((e) => console.warn(`3D model ${file} not loaded`, e));
  }
  return loads[file];
}
