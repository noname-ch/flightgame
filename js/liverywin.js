// The Liveries window (F7, ⋯ menu, Settings, or 🎨 in a plane's window): what the airline's aircraft are painted in.
//   Choose     every livery as a picture on the type picked above: make one the airline's (every plane without a
//              livery of its own flies it) or give it to one plane
//   Fleet      each plane with its livery: the airline's, or one of its own
//   Designer   make a livery: colours, the title, the cheatline, the belly, the mark on the fin, with a live 3D preview
//              (drag to turn it); saved into this browser's library (FG.liveries, js/data/liveries.js)
//   Community  liveries others made (community/liveries.json in the repo, read from GitHub), share codes to pass
//              a livery on, files, and publishing to the community list for the game's contributors
// The liveries themselves are painted by js/livery.js; js/data/liveries.js keeps the list and the choice.
import * as THREE from 'three';
import { paintFresh, modelSize } from './models3d.js';

const G = FG.game;
const D = FG.data;
const L = FG.liveries;
const COMMUNITY_RAW = 'https://raw.githubusercontent.com/noname-ch/flightgame/main/community/liveries.json';
const COMMUNITY_FILE = 'community/liveries.json';
const CODE = 'FGLIV1:';
const LOGO_NAMES = { klm: 'Crown', crane: 'Crane', harp: 'Harp', star: 'Star', maple: 'Maple leaf', sun: 'Sun', bird: 'Bird',
  wave: 'Waves', globe: 'Globe', plane: 'Paper plane', tulip: 'Tulip' };
const MARK_NAMES = { '': 'None', cross: 'Cross', disc: 'Disc', ring: 'Ring', chevron: 'Band', triangle: 'Triangle',
  split: 'Split (two colours)', logo: 'Logo', text: 'Text' };

const lw = { win: null, tab: 'choose', type: null, plane: null, draft: null, community: null, communityErr: '', note: '' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const hex = (n) => `#${(Number(n) >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`;
const num = (h) => parseInt(String(h).replace('#', ''), 16) || 0;

// ---------- which type the pictures show ----------
function fleetTypes() {
  const seen = new Set();
  for (const p of (G.state && G.state.planes) || []) if (D.models[p.type] && D.looks[p.type]) seen.add(p.type);
  return [...seen];
}
function previewType() {
  const types = fleetTypes();
  if (lw.type && D.models[lw.type]) return lw.type;
  const p = lw.plane && G.plane(lw.plane);
  return (p && D.models[p.type] && p.type) || types[0] || 'A320';
}
function typeChoice() {
  const types = fleetTypes();
  for (const t of ['A320', 'B737-800', 'A350-900', 'B777-300ER', 'ATR72-600', 'E190']) if (!types.includes(t)) types.push(t);
  const now = previewType();
  return `<label class="lw-type">Show on <select data-lw-type>${types.map((t) =>
    `<option value="${esc(t)}"${t === now ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
}

// ---------- the window ----------
function open(tab, planeId) {
  if (tab) lw.tab = tab;
  if (planeId !== undefined) lw.plane = planeId;
  if (!lw.win || !lw.win.shown) {
    lw.win = FG.win.open('liveries', { className: 'liv-win', width: 620, at: [90, 60], onClose: closed });
    lw.win.body.onclick = onClick;
    lw.win.body.onchange = onChange;
    lw.win.body.oninput = onInput;
  }
  lw.win.el.hidden = false;
  render();
}
function closed() {
  stopPreview();
}
function toggle() {
  if (lw.win && lw.win.shown) lw.win.close(); else open();
}

let seenVersion = -1;
let seenPlanes = '';
function render() {
  if (!lw.win || !lw.win.shown) return;
  seenVersion = L.version;
  seenPlanes = planesSig();
  const p = lw.plane && G.plane(lw.plane);
  lw.win.title(`🎨 Liveries${p ? ` <span class="muted">· ${esc(G.planeLabel(p))}</span>` : ''}`);
  const tabs = [['choose', 'Choose'], ['fleet', 'Fleet'], ['design', 'Designer'], ['community', 'Community']];
  let h = `<div class="chips lw-tabs">${tabs.map(([k, n]) => `<button class="${lw.tab === k ? 'on' : ''}" data-lw="tab" data-v="${k}">${n}</button>`).join('')}</div>`;
  if (lw.note) h += `<p class="lw-note">${lw.note}</p>`;
  if (lw.tab === 'choose') h += renderChoose(p);
  else if (lw.tab === 'fleet') h += renderFleet();
  else if (lw.tab === 'design') h += renderDesign();
  else h += renderCommunity();
  if (lw.tab !== 'design') stopPreview();
  lw.win.body.innerHTML = h;
  if (lw.tab === 'design') startPreview();
}
const planesSig = () => ((G.state && G.state.planes) || []).map((p) => `${p.id}:${p.type}:${p.livery || ''}:${p.name || ''}`).join('|') + `|${G.state && G.state.livery}`;

// Pictures arrive one by one (js/shots3d.js): put them into the cards that wait for them.
function fillPictures() {
  if (!lw.win || !lw.win.shown) return;
  if (L.version !== seenVersion || (lw.tab === 'fleet' && planesSig() !== seenPlanes)) {
    const active = document.activeElement;
    if (!(active && lw.win.body.contains(active) && active.matches('input, select, textarea'))) render();
  }
  for (const img of lw.win.body.querySelectorAll('img[data-shot]')) {
    const [type, id] = img.dataset.shot.split('|');
    const liv = L.find(id) || cache[id];
    const url = liv && FG.planeShots && FG.planeShots.preview(type, liv);
    if (url && img.getAttribute('src') !== url) { img.src = url; img.classList.remove('wait'); }
  }
}
setInterval(fillPictures, 500);

const shotImg = (type, l) => {
  const url = FG.planeShots && FG.planeShots.preview(type, l);
  return `<img data-shot="${esc(type)}|${esc(l.id)}" ${url ? `src="${url}"` : 'class="wait"'} alt="" draggable="false">`;
};

function groupsOf(list) {
  const groups = {};
  for (const l of list) {
    const g = L.builtIn(l.id) ? (l.group || 'Airlines') : l.source === 'community' ? 'Downloaded' : 'My designs';
    (groups[g] = groups[g] || []).push(l);
  }
  return ['My designs', 'Downloaded', 'Airlines', 'Classic', 'Basic'].filter((g) => groups[g]).map((g) => [g, groups[g]]);
}

function renderChoose(p) {
  const type = previewType();
  const def = FG.livery();
  const mine = p && p.livery;
  let h = `<div class="row lw-bar">${typeChoice()}
    <span class="muted">Airline: <b>${esc(def.name)}</b>${p ? ` · ${esc(G.planeLabel(p))}: <b>${esc(mine ? FG.livery(p).name : 'the airline’s')}</b>` : ''}</span>
    <button data-lw="new" title="Start a new design from the airline's livery">＋ New design</button></div>`;
  if (!p) h += '<p class="muted lw-hint">Pick a plane (or 🎨 in its window) to give it a livery of its own; the others fly the airline’s.</p>';
  for (const [g, list] of groupsOf(L.all())) {
    h += `<h4 class="lw-group">${g}</h4><div class="lw-grid">`;
    for (const l of list) {
      const isDef = l.id === def.id;
      const isMine = p && mine === l.id;
      const own = !L.builtIn(l.id);
      h += `<div class="lw-card${isDef ? ' def' : ''}${isMine ? ' mine' : ''}">${shotImg(type, l)}
        <div class="lw-name">${esc(l.name)}${l.author ? ` <span class="muted">by ${esc(l.author)}</span>` : ''}</div>
        <div class="lw-btns">
          <button data-lw="default" data-v="${esc(l.id)}" class="${isDef ? 'on' : ''}" title="Every plane without a livery of its own">${isDef ? '✓ Airline' : 'Airline'}</button>
          ${p ? `<button data-lw="plane" data-v="${esc(l.id)}" class="${isMine ? 'on' : ''}" title="Only ${esc(G.planeLabel(p))}">${isMine ? '✓ This plane' : 'This plane'}</button>` : ''}
          <button data-lw="copy" data-v="${esc(l.id)}" title="${own ? 'Change it' : 'Make your own from it'}">${own ? '✏️' : '⧉'}</button>
          ${own ? `<button data-lw="share" data-v="${esc(l.id)}" title="Copy a share code">📋</button><button data-lw="drop" data-v="${esc(l.id)}" title="Remove from this browser">🗑</button>` : ''}
        </div></div>`;
    }
    h += '</div>';
  }
  return h;
}

function renderFleet() {
  const planes = (G.state && G.state.planes) || [];
  if (!planes.length) return '<p class="muted">No planes yet.</p>';
  const all = L.all();
  const def = FG.livery();
  const opts = (sel) => `<option value="">Airline’s (${esc(def.name)})</option>` +
    all.map((l) => `<option value="${esc(l.id)}"${l.id === sel ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
  let h = `<div class="row lw-bar"><span class="muted">${planes.length} planes · airline: <b>${esc(def.name)}</b></span>
    <button data-lw="resetall" title="Every plane flies the airline's livery again">All the airline’s</button></div>
    <p class="muted lw-hint">The same livery for a whole type: choose it on one plane, then “all ${'<i>type</i>'}”.</p><div class="lw-fleet">`;
  for (const p of planes) {
    const l = FG.livery(p);
    h += `<div class="lw-row">${D.models[p.type] ? shotImg(p.type, l) : '<span class="lw-noimg"></span>'}
      <div class="lw-who"><b>${esc(G.planeLabel(p))}</b><span class="muted">${esc(p.type)}</span></div>
      <select data-lw-plane="${esc(p.id)}">${opts(p.livery)}</select>
      <button class="mini" data-lw="sametype" data-v="${esc(p.id)}" title="Every ${esc(p.type)} gets this plane's livery">all ${esc(p.type)}</button>
      <button class="mini" data-lw="pick" data-v="${esc(p.id)}" title="Choose with pictures">🖼</button></div>`;
  }
  return h + '</div>';
}

// ---------- designer ----------
function newDraft(from) {
  const base = JSON.parse(JSON.stringify(from || FG.livery()));
  const own = from && !L.builtIn(from.id) && from.source !== 'community';
  if (!own) {
    base.id = `my-${Date.now().toString(36)}`;
    base.name = from ? `${from.name} (mine)` : 'My livery';
    if (!from) base.title = (G.state && G.state.company) || base.title;
    delete base.author;
    delete base.source;
    delete base.group;
  }
  return base;
}
function field(label, html) { return `<label class="lw-f"><span>${label}</span>${html}</label>`; }
const color = (k, v) => `<input type="color" data-lw-d="${k}" value="${hex(v)}">`;
const check = (k, on, text) => `<label class="check"><input type="checkbox" data-lw-d="${k}" ${on ? 'checked' : ''}> ${text}</label>`;
const range = (k, v, min, max, step) => `<input type="range" data-lw-d="${k}" min="${min}" max="${max}" step="${step}" value="${v}">`;
const select = (k, v, opts) => `<select data-lw-d="${k}">${Object.entries(opts).map(([o, n]) => `<option value="${o}"${o === (v || '') ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;

function renderDesign() {
  if (!lw.draft) lw.draft = newDraft();
  const d = lw.draft;
  const m = d.mark || {};
  const b = d.belly;
  const s = d.stripe;
  return `<div class="row lw-bar">${typeChoice()}<span class="muted">Drag the picture to turn it.</span></div>
    <div class="lw-stage"><canvas class="lw-canvas"></canvas><div class="lw-stage-note muted"></div></div>
    <div class="lw-form">
      <fieldset><legend>Name</legend>
        ${field('Livery', `<input type="text" data-lw-d="name" maxlength="40" value="${esc(d.name)}">`)}
        ${field('Title', `<input type="text" data-lw-d="title" maxlength="24" value="${esc(d.title)}">`)}
        ${field('Title colour', color('titleColor', d.titleColor))}
        ${field('Title at', select('titleAt', d.titleAt || 'window', { window: 'Across the windows', above: 'Above the windows', low: 'Low (belly)' }))}
        ${field('Letters', select('titleStyle', d.titleStyle || '700', { 700: 'Bold', 400: 'Plain', '700 italic': 'Bold italic', '900': 'Black' }))}
        ${field('Size', range('titleHeight', d.titleHeight || 0, 0, 0.6, 0.02))}
      </fieldset>
      <fieldset><legend>Colours</legend>
        ${field('Fuselage', color('body', d.body))}
        ${field('Wings', color('wing', d.wing == null ? FG.data.wingGrey ?? d.body : d.wing))}
        ${field('Engines', color('engine', d.engine == null ? d.body : d.engine))}
        ${field('Wing tips', color('winglet', d.winglet == null ? d.body : d.winglet))}
        ${field('Fin', color('fin', d.fin))}
        ${check('tail', d.tail, 'Fin colour round the rear fuselage')}
      </fieldset>
      <fieldset><legend>Belly</legend>
        ${check('bellyOn', !!b, 'Belly in another colour')}
        ${b ? `${field('Colour', color('bellyColor', b.color))}
        ${field('Height', range('bellyFrom', b.from, 0.4, 0.95, 0.01))}
        ${field('Climbs to the nose', range('bellyNose', b.nose || 0, 0, 0.6, 0.02))}
        ${check('lineOn', b.line != null, 'Stripe along its edge')}
        ${b.line != null ? `${field('Stripe', color('lineColor', b.line))}${field('Stripe width', range('lineWidth', b.lineWidth || 0.04, 0.02, 0.2, 0.01))}` : ''}` : ''}
      </fieldset>
      <fieldset><legend>Cheatline</legend>
        ${check('stripeOn', !!s, 'A line along the windows')}
        ${s ? `${field('Colour', color('stripeColor', s.color))}
        ${field('Height', range('stripeAt', s.at ?? 0.62, 0.2, 0.9, 0.01))}
        ${field('Width', range('stripeWidth', s.width || 0.08, 0.02, 0.3, 0.01))}` : ''}
      </fieldset>
      <fieldset><legend>On the fin</legend>
        ${field('Mark', select('markKind', m.kind || '', MARK_NAMES))}
        ${m.kind === 'logo' ? field('Logo', select('markLogo', m.logo || 'star', LOGO_NAMES)) : ''}
        ${m.kind === 'text' ? field('Text', `<input type="text" data-lw-d="markText" maxlength="12" value="${esc(m.text || '')}">`) +
          field('Angle', range('markAngle', m.angle || 0, 0, 80, 1)) : ''}
        ${m.kind ? field('Colour', color('markColor', m.color == null ? 0xffffff : m.color)) : ''}
        ${m.kind === 'triangle' || m.kind === 'split' ? field('Second colour', color('markColor2', m.color2 == null ? (m.color == null ? 0xffffff : m.color) : m.color2)) : ''}
        ${m.kind && m.kind !== 'text' && m.kind !== 'logo' ? field('Size', range('markSize', m.size || 1, 0.4, 2.2, 0.05)) : ''}
      </fieldset>
    </div>
    <div class="row lw-actions">
      <button data-lw="save" class="primary">💾 Save design</button>
      <button data-lw="saveuse" title="Save it and make it the airline's livery">Save & fly it</button>
      ${lw.plane && G.plane(lw.plane) ? `<button data-lw="saveplane">Save & give it to ${esc(G.planeLabel(G.plane(lw.plane)))}</button>` : ''}
      <button data-lw="new">Start again</button>
    </div>`;
}

function setDraft(k, el) {
  const d = lw.draft;
  const v = el.type === 'checkbox' ? el.checked : el.type === 'color' ? num(el.value) : el.type === 'range' ? Number(el.value) : el.value;
  const mark = d.mark = d.mark || {};
  switch (k) {
    case 'name': case 'title': case 'titleColor': case 'body': case 'fin': case 'winglet': case 'wing': case 'engine': d[k] = v; break;
    case 'titleAt': d.titleAt = v === 'window' ? undefined : v; break;
    case 'titleStyle': d.titleStyle = v; break;
    case 'titleHeight': d.titleHeight = v || undefined; break;
    case 'tail': d.tail = v || undefined; break;
    case 'bellyOn': d.belly = v ? { color: 0x1b2a5c, from: 0.75 } : undefined; return true;
    case 'bellyColor': d.belly.color = v; break;
    case 'bellyFrom': d.belly.from = v; break;
    case 'bellyNose': d.belly.nose = v || undefined; break;
    case 'lineOn': if (v) { d.belly.line = 0xd2232a; d.belly.lineWidth = 0.06; } else { delete d.belly.line; delete d.belly.lineWidth; } return true;
    case 'lineColor': d.belly.line = v; break;
    case 'lineWidth': d.belly.lineWidth = v; break;
    case 'stripeOn': d.stripe = v ? { color: 0x14306b, at: 0.6, width: 0.1 } : undefined; return true;
    case 'stripeColor': d.stripe.color = v; break;
    case 'stripeAt': d.stripe.at = v; break;
    case 'stripeWidth': d.stripe.width = v; break;
    case 'markKind':
      if (!v) delete d.mark;
      else {
        mark.kind = v;
        if (v === 'logo' && !mark.logo) mark.logo = 'star';
        if (v === 'text' && !mark.text) mark.text = (d.title || 'AIR').slice(0, 6);
        if (mark.color == null) mark.color = 0xffffff;
      }
      return true;
    case 'markLogo': mark.logo = v; break;
    case 'markText': mark.text = v; break;
    case 'markAngle': mark.angle = v; break;
    case 'markColor': mark.color = v; break;
    case 'markColor2': mark.color2 = v; break;
    case 'markSize': mark.size = v; break;
    default: return false;
  }
  return false;
}

// The live 3D picture of the draft: its own little renderer, painted afresh a moment after each change.
const pv = { renderer: null, scene: null, camera: null, holder: null, yaw: -0.6, pitch: 0.18, frame: 0, timer: 0, token: 0, drag: null };
function startPreview() {
  const canvas = lw.win.body.querySelector('.lw-canvas');
  if (!canvas) return;
  if (!pv.renderer) {
    pv.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    pv.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    pv.scene = new THREE.Scene();
    pv.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 2.2));
    const key = new THREE.DirectionalLight(0xfff4dc, 2.4);
    key.position.set(-0.6, 0.8, 1.5);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.9);
    fill.position.set(1, -0.6, 0.3);
    pv.scene.add(key, fill);
    pv.holder = new THREE.Group();
    pv.scene.add(pv.holder);
    pv.camera = new THREE.PerspectiveCamera(28, 2.4, 0.05, 20);
    pv.camera.up.set(0, 0, 1);
  }
  const old = pv.renderer.domElement;
  old.className = 'lw-canvas';
  canvas.replaceWith(old);
  const w = old.parentElement.clientWidth || 560;
  pv.renderer.setSize(w, Math.round(w / 2.4));
  old.onpointerdown = (e) => { pv.drag = [e.clientX, e.clientY, pv.yaw, pv.pitch]; old.setPointerCapture(e.pointerId); };
  old.onpointermove = (e) => {
    if (!pv.drag) return;
    pv.yaw = pv.drag[2] - (e.clientX - pv.drag[0]) * 0.01;
    pv.pitch = Math.max(-1.2, Math.min(1.4, pv.drag[3] + (e.clientY - pv.drag[1]) * 0.01));
    draw();
  };
  old.onpointerup = () => { pv.drag = null; };
  repaint(0);
}
function stopPreview() {
  clearTimeout(pv.timer);
  pv.token++;
}
function repaint(wait = 250) {
  clearTimeout(pv.timer);
  const token = ++pv.token;
  pv.timer = setTimeout(() => {
    const type = previewType();
    const note = lw.win && lw.win.body.querySelector('.lw-stage-note');
    if (!modelSize(type)) { if (note) note.textContent = `${type} has no 3D model.`; return; }
    paintFresh(type, Object.assign({}, lw.draft, { id: 'draft' })).then((scene) => {
      if (token !== pv.token) return;
      const size = modelSize(type);
      const model = scene.clone();
      model.scale.set(size.wide / size.len, 1, size.wide / size.len);
      pv.holder.clear();
      pv.holder.add(model);
      if (note) note.textContent = '';
      draw();
    }, (e) => { if (note) note.textContent = `Could not paint it: ${e.message}`; });
  }, wait);
}
function draw() {
  if (!pv.renderer || !lw.win || !lw.win.shown) return;
  const r = 1.25;
  pv.camera.position.set(Math.sin(pv.yaw) * Math.cos(pv.pitch) * r, Math.cos(pv.yaw) * Math.cos(pv.pitch) * r, Math.sin(pv.pitch) * r);
  pv.camera.lookAt(0, 0, 0);
  pv.renderer.render(pv.scene, pv.camera);
}

// ---------- community and sharing ----------
function shareCode(l) {
  const clean = JSON.parse(JSON.stringify(l));
  delete clean.rev;
  delete clean.source;
  return CODE + btoa(unescape(encodeURIComponent(JSON.stringify(clean))));
}
function fromCode(text) {
  text = String(text || '').trim();
  let obj;
  if (text.startsWith(CODE)) obj = JSON.parse(decodeURIComponent(escape(atob(text.slice(CODE.length).replace(/\s/g, '')))));
  else obj = JSON.parse(text);
  const list = Array.isArray(obj) ? obj : obj.liveries || [obj];
  return list.map(clean).filter(Boolean);
}
// Only what a livery may hold, with numbers where colours go: a shared livery is someone else's text.
function clean(l) {
  if (!l || typeof l !== 'object') return null;
  const col = (v) => (v == null ? undefined : Number(v) >>> 0 & 0xffffff);
  const n = (v, lo, hi) => (v == null || Number.isNaN(Number(v)) ? undefined : Math.max(lo, Math.min(hi, Number(v))));
  const str = (v, max) => (v == null ? undefined : String(v).slice(0, max));
  const out = {
    id: str(l.id, 60) || `x-${Date.now().toString(36)}`,
    name: str(l.name, 40) || 'Livery',
    title: str(l.title, 24) || '',
    titleColor: col(l.titleColor) ?? 0,
    titleAt: ['above', 'low'].includes(l.titleAt) ? l.titleAt : undefined,
    titleStyle: ['400', '700', '900', '700 italic'].includes(String(l.titleStyle)) ? String(l.titleStyle) : undefined,
    titleHeight: n(l.titleHeight, 0.05, 0.6),
    titleLength: n(l.titleLength, 0.5, 4),
    body: col(l.body) ?? 0xf4f5f7,
    wing: col(l.wing),
    engine: col(l.engine),
    fin: col(l.fin) ?? 0xf4f5f7,
    tail: l.tail ? true : undefined,
    winglet: col(l.winglet),
    author: str(l.author, 40),
  };
  if (l.belly && typeof l.belly === 'object') {
    out.belly = { color: col(l.belly.color) ?? 0, from: n(l.belly.from, 0.3, 1) ?? 0.75, nose: n(l.belly.nose, 0, 1), aft: n(l.belly.aft, -0.5, 0.5),
      line: col(l.belly.line), lineWidth: n(l.belly.lineWidth, 0.01, 0.3) };
  }
  if (l.stripe && typeof l.stripe === 'object') out.stripe = { color: col(l.stripe.color) ?? 0, at: n(l.stripe.at, 0.1, 1) ?? 0.6, width: n(l.stripe.width, 0.01, 0.4) ?? 0.08 };
  if (l.mark && typeof l.mark === 'object' && MARK_NAMES[l.mark.kind]) {
    out.mark = { kind: l.mark.kind, color: col(l.mark.color), color2: col(l.mark.color2), size: n(l.mark.size, 0.3, 2.5),
      angle: n(l.mark.angle, 0, 85), text: str(l.mark.text, 12), logo: LOGO_NAMES[l.mark.logo] ? l.mark.logo : undefined };
    if (out.mark.kind === 'logo' && !out.mark.logo) out.mark.logo = 'star';
  }
  return JSON.parse(JSON.stringify(out)); // (drops the undefined ones)
}

function loadCommunity() {
  lw.community = 'loading';
  const get = (url) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))));
  get(COMMUNITY_RAW).catch(() => get(COMMUNITY_FILE)).then((j) => {
    lw.community = (Array.isArray(j) ? j : j.liveries || []).map(clean).filter(Boolean);
    lw.communityErr = '';
  }, (e) => { lw.community = []; lw.communityErr = `The community list could not be loaded (${e.message}).`; }).finally(render);
}

function renderCommunity() {
  if (lw.community == null) loadCommunity();
  const type = previewType();
  const have = new Set(L.library.map((l) => l.id));
  let h = `<div class="row lw-bar">${typeChoice()}<button data-lw="reload" title="Load the list again">↻</button></div>`;
  h += '<h4 class="lw-group">From the community</h4>';
  if (lw.community === 'loading') h += '<p class="muted">Loading…</p>';
  else if (lw.communityErr) h += `<p class="muted">${esc(lw.communityErr)}</p>`;
  else if (!lw.community.length) h += '<p class="muted">Nothing shared yet: be the first!</p>';
  else {
    h += '<div class="lw-grid">';
    for (const c of lw.community) {
      const id = `c-${c.id}`;
      const got = have.has(id);
      const l = Object.assign({}, c, { id });
      h += `<div class="lw-card">${shotImg(type, got ? L.find(id) : (cache[id] = cache[id] || l))}
        <div class="lw-name">${esc(c.name)}${c.author ? ` <span class="muted">by ${esc(c.author)}</span>` : ''}</div>
        <div class="lw-btns">${got ? '<button disabled>✓ In your liveries</button>' : `<button data-lw="get" data-v="${esc(c.id)}">⬇ Get</button>`}</div></div>`;
    }
    h += '</div>';
  }
  const mine = L.library.filter((l) => l.source !== 'community');
  const gh = FG.fixes && FG.fixes.github && FG.fixes.github.user;
  h += `<h4 class="lw-group">Share yours</h4>
    ${mine.length ? `<div class="lw-share">${mine.map((l) => `<div class="row"><b>${esc(l.name)}</b>
      <button class="mini" data-lw="share" data-v="${esc(l.id)}">📋 Copy code</button>
      <button class="mini" data-lw="export" data-v="${esc(l.id)}">⬇ File</button>
      ${gh ? `<button class="mini" data-lw="publish" data-v="${esc(l.id)}" title="Add it to community/liveries.json on GitHub as ${esc(gh.login)}">🌍 Publish</button>` : ''}</div>`).join('')}</div>` :
    '<p class="muted">Make one in the Designer first.</p>'}
    <p class="muted lw-hint">${gh ? `Signed in to GitHub as ${esc(gh.login)}: 🌍 Publish puts a design on the community list for everyone.` :
      'Send the code to a friend, or post it in a GitHub issue so it gets on the community list. (Contributors signed in to GitHub in the airport editor can publish directly.)'}</p>
    <h4 class="lw-group">Add one</h4>
    <textarea class="lw-code" rows="3" placeholder="Paste a share code (FGLIV1:…) or livery JSON"></textarea>
    <div class="row"><button data-lw="import">Add from code</button>
      <label class="lw-file"><input type="file" accept=".json,application/json,text/plain" data-lw-file hidden><span class="btn-like">📂 From a file…</span></label></div>`;
  return h;
}
const cache = {}; // community liveries not in the library yet, by id: the pictures need the same object each time

function addToLibrary(list, source) {
  const added = [];
  for (const l of list) {
    const copy = Object.assign({}, l);
    if (source === 'community') { copy.id = `c-${l.id}`; copy.source = 'community'; }
    else if (L.builtIn(copy.id) || L.library.some((x) => x.id === copy.id && x.source === 'community')) copy.id = `my-${Date.now().toString(36)}${added.length}`;
    added.push(L.keep(copy));
  }
  return added;
}

async function publish(l) {
  const entry = JSON.parse(JSON.stringify(l));
  delete entry.rev;
  delete entry.source;
  entry.author = entry.author || FG.fixes.github.user.login;
  entry.id = entry.id.replace(/^my-/, `${entry.author.toLowerCase().replace(/[^a-z0-9]+/g, '')}-`);
  await FG.fixes.github.commitFile(COMMUNITY_FILE, (text) => {
    let j = { liveries: [] };
    try { if (text) j = JSON.parse(text); } catch (e) { /* start the file again */ }
    if (!Array.isArray(j.liveries)) j.liveries = [];
    const i = j.liveries.findIndex((x) => x.id === entry.id);
    if (i >= 0) j.liveries[i] = entry; else j.liveries.push(entry);
    return `${JSON.stringify(j, null, 1)}\n`;
  }, `Community livery: ${entry.name}`);
}

function note(html) {
  lw.note = html;
  render();
  clearTimeout(note.t);
  note.t = setTimeout(() => { lw.note = ''; render(); }, 5000);
}

// ---------- events ----------
function setDefault(id) {
  const l = L.find(id);
  if (!l || !G.state) return;
  L.use(l);
  G.state.livery = id;
  L.changed();
}
function setPlane(pid, id) {
  const p = G.plane(pid);
  if (!p) return;
  if (!id) delete p.livery;
  else { const l = L.find(id); if (!l) return; L.use(l); p.livery = id; }
  L.changed();
}

function onClick(e) {
  const b = e.target.closest('[data-lw]');
  if (!b) return;
  const k = b.dataset.lw;
  const v = b.dataset.v;
  if (k === 'tab') { lw.tab = v; render(); return; }
  if (k === 'default') { setDefault(v); render(); return; }
  if (k === 'plane') { setPlane(lw.plane, FG.livery(G.plane(lw.plane)).id === v && G.plane(lw.plane).livery ? null : v); render(); return; }
  if (k === 'pick') { lw.plane = v; lw.tab = 'choose'; render(); return; }
  if (k === 'sametype') {
    const p = G.plane(v);
    if (!p) return;
    for (const q of G.state.planes) if (q.type === p.type) { if (p.livery) q.livery = p.livery; else delete q.livery; }
    L.changed();
    note(`Every ${esc(p.type)} now flies ${esc(FG.livery(p).name)}.`);
    return;
  }
  if (k === 'resetall') { for (const q of G.state.planes) delete q.livery; L.changed(); render(); return; }
  if (k === 'new') { lw.draft = newDraft(); lw.tab = 'design'; render(); return; }
  if (k === 'copy') { lw.draft = newDraft(L.find(v)); lw.tab = 'design'; render(); return; }
  if (k === 'drop') {
    const used = G.state && (G.state.livery === v || G.state.planes.some((q) => q.livery === v));
    L.drop(v);
    if (used) note('Removed from this browser. This game keeps it, as it flies it.');
    else render();
    return;
  }
  if (k === 'save' || k === 'saveuse' || k === 'saveplane') {
    const saved = L.keep(Object.assign({}, lw.draft, { name: (lw.draft.name || '').trim() || 'My livery' }));
    lw.draft = JSON.parse(JSON.stringify(saved));
    if (k === 'saveuse') setDefault(saved.id);
    if (k === 'saveplane') setPlane(lw.plane, saved.id);
    note(`Saved “${esc(saved.name)}”${k === 'saveuse' ? ': the airline flies it now' : k === 'saveplane' ? ': that plane flies it now' : ''}.`);
    return;
  }
  if (k === 'share') {
    const l = L.find(v);
    const code = shareCode(l);
    (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(
      () => note(`The code for “${esc(l.name)}” is copied: paste it anywhere.`),
      () => note(`Copy this code: <code class="lw-codeout">${esc(code)}</code>`));
    return;
  }
  if (k === 'export') {
    const l = L.find(v);
    const blob = new Blob([JSON.stringify({ liveries: [JSON.parse(JSON.stringify(l))] }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `livery-${l.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return;
  }
  if (k === 'import') {
    const box = lw.win.body.querySelector('.lw-code');
    try {
      const got = fromCode(box.value);
      if (!got.length) throw new Error('no livery in it');
      const added = addToLibrary(got, 'code');
      note(`Added ${added.map((l) => `“${esc(l.name)}”`).join(', ')}: find it under My designs in Choose.`);
    } catch (err) { note(`That code doesn't work: ${esc(err.message)}`); }
    return;
  }
  if (k === 'get') {
    const c = (lw.community || []).find((x) => x.id === v);
    if (c) { addToLibrary([c], 'community'); note(`“${esc(c.name)}” is in your liveries now (Choose → Downloaded).`); }
    return;
  }
  if (k === 'reload') { lw.community = null; render(); return; }
  if (k === 'publish') {
    const l = L.find(v);
    b.disabled = true;
    b.textContent = 'Publishing…';
    publish(l).then(() => { lw.community = null; note(`“${esc(l.name)}” is on the community list (GitHub Pages shows it in a minute or two).`); },
      (err) => note(`Not published: ${esc(err.message)}`));
  }
}
function onChange(e) {
  const t = e.target;
  if (t.matches('[data-lw-type]')) { lw.type = t.value; render(); return; }
  if (t.matches('[data-lw-plane]')) { setPlane(t.dataset.lwPlane, t.value || null); render(); return; }
  if (t.matches('[data-lw-file]')) {
    const f = t.files && t.files[0];
    if (!f) return;
    f.text().then((text) => {
      const added = addToLibrary(fromCode(text), 'file');
      note(`Added ${added.map((l) => `“${esc(l.name)}”`).join(', ') || 'nothing'}.`);
    }).catch((err) => note(`That file doesn't work: ${esc(err.message)}`));
    return;
  }
  if (t.matches('[data-lw-d]')) {
    if (setDraft(t.dataset.lwD, t)) render(); else repaint();
  }
}
function onInput(e) {
  const t = e.target;
  if (t.matches('[data-lw-d]') && t.type !== 'checkbox' && t.tagName !== 'SELECT') {
    setDraft(t.dataset.lwD, t);
    repaint();
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'F7' || e.ctrlKey || e.altKey || e.metaKey) return;
  toggle();
  e.preventDefault();
});
const btn = document.getElementById('liveries-toggle');
if (btn) btn.addEventListener('click', () => { document.getElementById('menu').hidden = true; open(); });

FG.liveryWin = { open, toggle, clean, fromCode, shareCode };
