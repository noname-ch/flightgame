// Live 3D aircraft in the marketplace showcase: the selected type's model stands on a turntable in front of
// the hangar drawing (js/hangar.js) and can be turned with the mouse. Types without a model keep the drawing.
import * as THREE from 'three';
import { loadModel, modelSize } from './models3d.js';

const { W, H, GROUND } = FG.hangar;
const START = { yaw: 18 * Math.PI / 180, tilt: 6 * Math.PI / 180 };   // the view of the hangar pictures
const TILT = [0.02, 0.24];
const SPIN = 0.2;                 // rad/s until the player turns the aircraft

const v = { renderer: null, scene: null, camera: null, table: null, type: null, stage: null, frame: 0, last: 0,
  yaw: START.yaw, tilt: START.tilt, spin: true, drag: null };

function setup() {
  const canvas = document.createElement('canvas');
  canvas.className = 'hangar3d';
  canvas.title = 'Drag to turn, double-click to reset';
  v.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  v.renderer.setClearColor(0x000000, 0);
  // The scene is in the units of the hangar drawing: x to the right, y up (0 at its top edge), z towards the viewer.
  v.camera = new THREE.OrthographicCamera(0, W, 0, -H, -2000, 2000);
  v.scene = new THREE.Scene();
  v.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 2.2));
  const key = new THREE.DirectionalLight(0xfff4dc, 2.4);
  key.position.set(-0.8, 1.5, 0.6);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.9);
  fill.position.set(0.6, 0.3, 1);
  v.scene.add(key, fill);
  v.table = new THREE.Group();
  v.scene.add(v.table);

  canvas.addEventListener('pointerdown', (e) => {
    v.drag = { x: e.clientX, y: e.clientY };
    v.spin = false;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!v.drag) return;
    v.yaw += (e.clientX - v.drag.x) * 0.01;
    v.tilt = Math.min(TILT[1], Math.max(TILT[0], v.tilt + (e.clientY - v.drag.y) * 0.004));
    v.drag = { x: e.clientX, y: e.clientY };
  });
  for (const t of ['pointerup', 'pointercancel']) canvas.addEventListener(t, () => { v.drag = null; });
  canvas.addEventListener('dblclick', () => { v.yaw = START.yaw; v.tilt = START.tilt; v.spin = true; });
}

// Puts the model of a type on the turntable: on the floor line of the drawing, or just above it without gear.
function show(type, scene) {
  const m = FG.hangar.model(type);
  const k = m.len * m.scale;
  const box = new THREE.Box3().setFromObject(scene);
  const plane = scene.clone();
  plane.position.z = -box.min.z;
  // Model axes (x = right wing, y = nose, z = up) to the scene: nose to the left, left wing towards the viewer.
  const holder = new THREE.Group();
  holder.matrixAutoUpdate = false;
  // The fuselage axis (y) gets the type's length, the others the model's width (js/models3d.js modelSize).
  const size = modelSize(type);
  holder.matrix.makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0))
    .scale(new THREE.Vector3(size.wide * m.scale, k, size.wide * m.scale));
  holder.add(plane);
  v.table.clear();
  v.table.add(holder);
  v.table.position.set(W / 2, -(GROUND - m.lift * k), 0);
}

function frame(now) {
  v.frame = 0;
  const stage = v.stage;
  if (!stage || !stage.isConnected || document.getElementById('market').hidden) return;
  const dt = Math.min(0.1, (now - v.last) / 1000);
  v.last = now;
  if (v.spin) v.yaw += SPIN * dt;
  v.table.rotation.set(v.tilt, v.yaw, 0);
  const canvas = v.renderer.domElement;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    v.renderer.setPixelRatio(ratio);
    v.renderer.setSize(w, h, false);
  }
  v.renderer.render(v.scene, v.camera);
  v.frame = requestAnimationFrame(frame);
}

// Called whenever the marketplace changes: attach to the showcase of the selected type.
function sync() {
  const svg = document.querySelector('#market .mk-stage .hangar-svg');
  const stage = svg && svg.parentElement;
  const type = svg && svg.dataset.type;
  if (!stage || !FG.hangar.model(type) || document.getElementById('market').hidden) { v.stage = null; return; }
  if (!v.renderer) setup();
  const canvas = v.renderer.domElement;
  if (v.stage === stage && v.type === type && canvas.parentElement === stage) return;
  if (v.type !== type) { v.table.clear(); v.spin = true; v.yaw = START.yaw; v.tilt = START.tilt; }
  v.stage = stage;
  v.type = type;
  stage.appendChild(canvas);
  const ready = () => {
    if (v.stage !== stage || v.type !== type) return;
    stage.classList.add('live3d');
    v.last = performance.now();
    if (!v.frame) v.frame = requestAnimationFrame(frame);
  };
  if (v.table.children.length) { ready(); return; }
  loadModel(type).then((scene) => {
    if (v.stage !== stage || v.type !== type) return;
    show(type, scene);
    ready();
  }, () => {});
}

const market = document.getElementById('market');
new MutationObserver(sync).observe(market, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
sync();
