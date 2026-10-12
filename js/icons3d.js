// Aircraft icons for the 2D map: each type's 3D model (js/models3d.js, in the airline livery) rendered once
// straight from above, lit like a sunny day, and used as the plane marker in js/ui.js. Types without a model
// keep the flat glyph. FG.planeIcons.get(type) returns the picture's URL, or null while it is being made.
import * as THREE from 'three';
import { loadModel, modelSize } from './models3d.js';

const PX = 192;             // picture size; the marker is 28 px and grows to ~100 px at the gates
const icons = {};           // type + livery -> { url, len }, or null while rendering
let r = null;

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PX;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  // Looking down the model's z axis with the nose (y) at the top of the picture, as the map glyph.
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -5, 5);
  camera.position.set(0, 0, 2);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 2.0));
  const sun = new THREE.DirectionalLight(0xfff4dc, 2.6);
  sun.position.set(-0.6, 0.8, 1.2);   // from the upper left, so the fuselage and engines look round
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.6);
  fill.position.set(0.7, -0.4, 0.8);
  scene.add(sun, fill);
  const holder = new THREE.Group();
  scene.add(holder);
  r = { renderer, camera, scene, holder };
}

function render(key, type, model) {
  if (!r) setup();
  const plane = model.clone();
  // Models are 1 long (a stretched type is narrower in proportion, see modelSize); frame the larger of
  // length and span so wide wings fit, nose up.
  const size3d = modelSize(type);
  plane.scale.set(size3d.wide / size3d.len, 1, size3d.wide / size3d.len);
  const box = new THREE.Box3().setFromObject(plane);
  const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) * 1.04;
  plane.position.set(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -(box.min.z + box.max.z) / 2);
  r.holder.clear();
  r.holder.scale.setScalar(1 / size);
  r.holder.add(plane);
  r.renderer.render(r.scene, r.camera);
  icons[key] = { url: r.renderer.domElement.toDataURL('image/png'), len: 1 / size };
  r.holder.clear();
}

FG.planeIcons = {
  // { url, len } for the type (len = aircraft length as a share of the picture), or null.
  get(type) {
    if (!FG.data.models || !FG.data.models[type] || !FG.data.looks[type]) return null;
    const key = `${type}|${FG.livery().id}`;
    if (icons[key] === undefined) {
      icons[key] = null;
      loadModel(type).then((model) => render(key, type, model), () => {});
    }
    return icons[key];
  },
};
