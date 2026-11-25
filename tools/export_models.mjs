// Writes what the browser builds for each aircraft type (the painted model with its gear, moving parts and
// livery uniforms) as JSON, for the Rust app (rust/src). Open tools/export_models.html through the game's
// server, with ?types=A320,B737-800 (default: every type) and &to=<collector url>, which takes a POST of
// each type's JSON (a small local server that saves them). Not part of the game.
import * as THREE from 'three';
import { loadModel, modelSize } from '../js/models3d.js';

const q = new URLSearchParams(location.search);
const to = q.get('to') || 'http://127.0.0.1:8797/save';
const status = document.getElementById('status');
const types = q.get('types') ? q.get('types').split(',') : Object.keys(FG.data.models);
const renderer = new THREE.WebGLRenderer();   // (a GL context first: the painting needs one)

const OWN = ['livFlex', 'livSpin', 'livAil', 'livFlap', 'livElev', 'livRud', 'livRev', 'livRevKind', 'livRevX', 'livLight'];

// Typed arrays as base64 (the bytes as they are in memory, little endian).
function b64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function colorHex(c) { return c.getHex(); }

// A uniform's value as JSON: numbers, vectors, colours (hex), textures (their canvas as a PNG data URL).
function uniformJson(v) {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v.isColor) return { color: colorHex(v) };
  if (v.isVector2 || v.isVector3 || v.isVector4) return { vec: v.toArray() };
  if (v.isTexture) {
    const img = v.image;
    if (img && img.getContext) return { png: img.toDataURL('image/png') };
    if (img && img.width) {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      return { png: c.toDataURL('image/png') };
    }
    return null;
  }
  return null;
}

// The models' own textures (a material's map): each once per run, as a PNG named by a hash of its pixels, POSTed to
// the collector's /map (it writes maps/<key>.png beside the types' files). The materials name them by key.
const mapKeys = new Map();   // texture -> Promise of its key
const sentMaps = new Set();
function mapKey(tex) {
  if (!mapKeys.has(tex)) {
    mapKeys.set(tex, (async () => {
      const img = tex.image;
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      const url = c.toDataURL('image/png');
      const bytes = new TextEncoder().encode(url);
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const key = [...hash.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (!sentMaps.has(key)) {
        sentMaps.add(key);
        const r = await fetch(`${to.replace(/\/save$/, '/map')}?key=${key}`, { method: 'POST', body: url });
        if (!r.ok) throw new Error(`collector ${r.status}`);
      }
      return key;
    })());
  }
  return mapKeys.get(tex);
}

function exportType(type) {
  return loadModel(type).then((scene) => {
    const size = modelSize(type);
    const meshes = [];        // unique geometry+material records
    const meshIndex = new Map();
    const mats = new Map();
    const pending = [];
    function matJson(m) {
      if (mats.has(m)) return mats.get(m);
      const own = {};
      for (const k of OWN) if (m.userData[k]) own[k] = m.userData[k].value;
      const j = {
        name: m.name || '', type: m.type,
        color: m.color ? colorHex(m.color) : null,
        vertexColors: !!m.vertexColors, transparent: !!m.transparent, opacity: m.opacity ?? 1,
        doubleSided: m.side === THREE.DoubleSide, own,
        roughness: m.roughness ?? null, metalness: m.metalness ?? null,
        emissive: m.emissive ? colorHex(m.emissive) : null, emissiveIntensity: m.emissiveIntensity ?? null,
      };
      // (the texture's key is filled in once its PNG is written: see mapKey)
      if (m.map && m.map.image) {
        j.map = null;
        pending.push(mapKey(m.map).then((key) => {
          j.map = { key, flipY: !!m.map.flipY, wrapS: m.map.wrapS, wrapT: m.map.wrapT, magFilter: m.map.magFilter, minFilter: m.map.minFilter, colorSpace: m.map.colorSpace };
        }));
      }
      mats.set(m, j);
      return j;
    }
    function geomJson(o) {
      const g = o.geometry;
      const attrs = {};
      for (const k of Object.keys(g.attributes)) {
        const a = g.attributes[k];
        attrs[k] = { itemSize: a.itemSize, count: a.count, type: a.array.constructor.name, b64: b64(a.array) };
      }
      const idx = g.index ? { type: g.index.array.constructor.name, b64: b64(g.index.array) } : null;
      return { attrs, index: idx };
    }
    function node(o) {
      const j = {
        name: o.name || '', type: o.type,
        pos: o.position.toArray(), quat: o.quaternion.toArray(), scale: o.scale.toArray(),
        visible: o.visible,
      };
      const ud = {};
      for (const [k, v] of Object.entries(o.userData || {})) {
        if (v == null) continue;
        if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') ud[k] = v;
        else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) ud[k] = v;
        else if (typeof v === 'object') { try { JSON.stringify(v); ud[k] = v; } catch (e) { /* skip */ } }
      }
      if (Object.keys(ud).length) j.ud = ud;
      if (o.isMesh) {
        const gm = { g: geomJson(o), m: matJson(o.material) };
        // (the same geometry + material may sit on several meshes: keep one record each)
        const key = o;
        if (!meshIndex.has(key)) { meshIndex.set(key, meshes.length); meshes.push(gm); }
        j.mesh = meshIndex.get(key);
      }
      if (o.children && o.children.length) j.ch = o.children.map(node);
      return j;
    }
    const tree = node(scene);
    const liv = {};
    for (const [k, v] of Object.entries(scene.userData.liv || {})) liv[k] = uniformJson(v.value !== undefined ? v.value : v);
    return Promise.all(pending).then(() => ({
      type, file: size.file, stretch: size.stretch, len: size.len, wide: size.wide,
      tree, meshes, liv,
    }));
  });
}

async function run() {
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    status.textContent = `${i + 1}/${types.length} ${type}`;
    try {
      const data = await exportType(type);
      const r = await fetch(`${to}?type=${encodeURIComponent(type)}`, { method: 'POST', body: JSON.stringify(data) });
      if (!r.ok) throw new Error(`collector ${r.status}`);
    } catch (e) {
      console.error(type, e);
      status.textContent += ` ! ${type}: ${e.message}`;
    }
  }
  status.textContent = `done ${types.length}`;
  document.title = 'exported';
}
run();
