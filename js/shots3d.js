// Pictures of the aircraft for the hangar tiles in a livery other than the first one: the first livery has
// its pictures in models/hangar/ (made by tools/hangar_shots.html), the others are rendered here in the same
// view when they are first needed. FG.planeShots.get(type) returns the picture's URL, or null for the first
// livery, for a type without a model, and while the picture is being made (the tiles then show the file).
import * as THREE from 'three';
import { loadModel, modelSize } from './models3d.js';

const SHOT = FG.data.modelShot;
const PX = 900;                  // pixels per aircraft length
const AZ = 18 * Math.PI / 180;   // camera: this far round towards the nose ...
const EL = 6 * Math.PI / 180;    // ... and this far above the horizon
const shots = {};                // type + livery -> URL, or null while rendering
const queue = [];
let renderer = null;
let busy = false;

// Model axes: x = right wing, y = nose, z = up. The camera stands on the left of the aircraft.
const back = new THREE.Vector3(-Math.cos(AZ) * Math.cos(EL), Math.sin(AZ) * Math.cos(EL), Math.sin(EL));
const right = new THREE.Vector3(0, 0, 1).cross(back).normalize();
const up = back.clone().cross(right);

function render(type, scene0) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(Math.round(SHOT.w * PX), Math.round(SHOT.h * PX));
  }
  // the model is 1 unit long: a stretched type is narrower in proportion
  const model = scene0.clone();
  const size = modelSize(type);
  model.scale.set(size.wide / size.len, 1, size.wide / size.len);
  const scene = new THREE.Scene();
  scene.add(model);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 2.2));
  const key = new THREE.DirectionalLight(0xfff4dc, 2.4);
  key.position.set(-0.6, 0.8, 1.5);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.9);
  fill.position.set(-1, -0.6, 0.3);
  scene.add(key, fill);
  // Extent of the model on the picture plane: centred, standing on the picture's ground line.
  let r0 = Infinity, r1 = -Infinity, u0 = Infinity;
  const p = new THREE.Vector3();
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const r = p.dot(right), u = p.dot(up);
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
      if (u < u0) u0 = u;
    }
  });
  const cam = new THREE.OrthographicCamera(-SHOT.w / 2, SHOT.w / 2, SHOT.h / 2, -SHOT.h / 2, 0.1, 10);
  cam.up.copy(up);
  const target = right.clone().multiplyScalar((r0 + r1) / 2).addScaledVector(up, u0 - SHOT.ground + SHOT.h / 2);
  cam.position.copy(target).addScaledVector(back, 4);
  cam.lookAt(target);
  renderer.render(scene, cam);
  // (a short object URL: the picture is named in every tile that shows the type)
  return new Promise((done) => renderer.domElement.toBlob((blob) => done(blob ? URL.createObjectURL(blob) : null), 'image/webp', 0.9));
}

function next() {
  if (busy || !queue.length) return;
  busy = true;
  const { key, type, livery } = queue.shift();
  loadModel(type, livery).then((scene) => render(type, scene)).then((url) => {
    shots[key] = url;
    if (FG.game) FG.game.dirty = true; // the tiles are drawn again with the picture
  }, () => {}).finally(() => { busy = false; setTimeout(next, 0); });
}

FG.planeShots = {
  get(type) {
    const livery = FG.livery();
    if (livery === FG.data.liveries[0] || !FG.data.models[type] || !FG.data.looks[type]) return null;
    const key = `${type}|${livery.id}`;
    if (shots[key] === undefined) {
      shots[key] = null;
      queue.push({ key, type, livery });
      next();
    }
    return shots[key];
  },
};
