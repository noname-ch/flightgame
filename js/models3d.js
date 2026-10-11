// Loads the glTF aircraft models (models/*.glb, see models/README.md) for the 3D view and the hangar,
// painted in the airline livery. FG.data.models says which aircraft type uses which file.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { paintLivery } from './livery.js';

const MODELS = new URL('../models/', import.meta.url);
const loads = {};   // file -> Promise of the loaded scene

// The scene is shared: clone() it for every aircraft drawn.
export function loadModel(file) {
  if (!loads[file]) {
    loads[file] = new GLTFLoader().loadAsync(new URL(`${file}.glb`, MODELS).href).then((gltf) => paintLivery(gltf.scene, file));
    loads[file].catch((e) => console.warn(`3D model ${file} not loaded`, e));
  }
  return loads[file];
}
