// The A350's flight deck around the cockpit camera when you fly it yourself (js/pilot.js, camera C): the six
// windows in their dark frames, the black glareshield with the FCU and the EFIS panels, the main panel with its six
// big landscape screens (information system outboard, PFD + ND in front of each pilot, the engine and warning display
// in the middle, the systems display on the pedestal), the pedestal with the thrust levers, keyboards and radio
// panels, the overhead panel, side consoles with the side-sticks, the seats and the wipers. The levers, sticks, gear
// lever and the screens move with the plane.
//
// It is drawn after the world by view3d.js planeLayer (`draw`) with its own camera in the cockpit's own frame
// (the cockpit moves with the camera, so it never needs the world's matrices), over a cleared depth buffer; the
// windows are holes, the world shows through them. Laid out after photos of the real deck: only the layout,
// proportions and colours are followed.
//
// Cockpit space: metres, x right, y ahead, z up, from the middle of the cockpit at the pilots' eye height and
// station; the captain's eye is at x = -EYE_X.
import * as THREE from 'three';

export const EYE_X = 0.53;
const FLOOR = -1.32, ROOF = 0.50, REAR = -1.75, HALF = 1.36;

// The windscreens' plane (one each side of the centre post): y at (x, z).
const frontY = (x, z) => 1.15 - 0.294 * Math.abs(x) - 0.767 * (z + 0.3);
// The side wall's front edge (where it meets the windscreen's plane) at height z.
const wallFrontY = (z) => frontY(HALF, z);

const COL = {
  lining: 0xc9ced3, // light grey walls and ceiling
  frame: 0x1d1f22, // window frames and posts
  shield: 0x0f1012, // the glareshield (matt black: no reflections in the windscreen)
  panel: 0x4b5058, // main panel, pedestal and overhead: Airbus's darker grey on the A350
  console: 0x575c64,
  floor: 0x2c2f35,
  seat: 0x3d434d,
  bezel: 0x101214,
  metal: 0x8a9099,
};

// ---------- canvas pictures of the panels ----------
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
// A panel's picture: its face (`base`) and what glows on it at night (`glow`: legends, lit buttons).
function panelArt(wPx, hPx, paint, bg = '#4b5058') {
  const base = canvas(wPx, hPx), glow = canvas(wPx, hPx);
  const b = base.getContext('2d'), g = glow.getContext('2d');
  b.fillStyle = bg; b.fillRect(0, 0, wPx, hPx);
  g.fillStyle = '#000'; g.fillRect(0, 0, wPx, hPx);
  paint(b, g, wPx, hPx);
  return { map: texture(base), glow: texture(glow) };
}
// The tools for painting panels: Airbus pushbuttons (square, dark, a lit legend), knobs, number windows, labels.
function tools(b, g) {
  const T = {
    label(x, y, text, size = 11, color = '#e9edf1') {
      for (const c of [b, g]) {
        c.font = `600 ${size}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = c === b ? color : '#cfd8e2';
        c.fillText(text, x, y);
      }
    },
    plate(x, y, w, h, color = '#3d4249') { // a sub-panel, with its screws
      b.fillStyle = color; b.fillRect(x, y, w, h);
      b.strokeStyle = 'rgba(0,0,0,0.55)'; b.lineWidth = 2; b.strokeRect(x + 1, y + 1, w - 2, h - 2);
      b.strokeStyle = 'rgba(255,255,255,0.08)'; b.beginPath(); b.moveTo(x + 2, y + h - 2); b.lineTo(x + 2, y + 2); b.lineTo(x + w - 2, y + 2); b.stroke();
      b.fillStyle = '#9aa1aa';
      for (const [sx, sy] of [[x + 5, y + 5], [x + w - 5, y + 5], [x + 5, y + h - 5], [x + w - 5, y + h - 5]]) { b.beginPath(); b.arc(sx, sy, 1.6, 0, 7); b.fill(); }
    },
    pb(x, y, s, top = '', bot = '', lit = null) { // pushbutton: legend top (amber FAULT…), bottom (blue/white ON…)
      b.fillStyle = '#16181b'; b.fillRect(x - s / 2, y - s / 2, s, s);
      b.strokeStyle = '#6c737c'; b.lineWidth = 1.2; b.strokeRect(x - s / 2 + 0.5, y - s / 2 + 0.5, s - 1, s - 1);
      b.fillStyle = '#0b0c0e'; b.fillRect(x - s / 2 + 3, y - s / 2 + 3, s - 6, s - 6);
      const f = Math.max(6, s * 0.24);
      for (const c of [b, g]) {
        c.font = `700 ${f}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        if (top) { c.fillStyle = c === b ? '#5a4a22' : '#4a3a10'; c.fillText(top, x, y - s * 0.18); }
        if (bot) { c.fillStyle = c === b ? (lit ? '#7fd0ff' : '#3a4048') : (lit ? '#6fc8ff' : '#1a1e24'); c.fillText(bot, x, y + s * 0.2); }
      }
    },
    knob(x, y, r, color = '#2a2d31') {
      b.fillStyle = '#0d0e10'; b.beginPath(); b.arc(x, y + 1.5, r + 1.5, 0, 7); b.fill();
      const grd = b.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      grd.addColorStop(0, '#5d636b'); grd.addColorStop(1, color);
      b.fillStyle = grd; b.beginPath(); b.arc(x, y, r, 0, 7); b.fill();
      b.strokeStyle = '#d9dee4'; b.lineWidth = 1.5; b.beginPath(); b.moveTo(x, y - r * 0.2); b.lineTo(x, y - r * 0.9); b.stroke();
    },
    window(x, y, w, h, text) { // a number window (orange-yellow LCD digits, as the FCU's)
      b.fillStyle = '#050505'; b.fillRect(x - w / 2, y - h / 2, w, h);
      for (const c of [b, g]) {
        c.font = `600 ${h * 0.72}px ui-monospace, monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = c === b ? '#f2b35a' : '#f0a640'; c.fillText(text, x, y + 1);
      }
    },
    toggle(x, y, s) { // a guarded toggle switch from above
      b.fillStyle = '#16181b'; b.fillRect(x - s * 0.35, y - s * 0.5, s * 0.7, s);
      b.fillStyle = '#b9c0c8'; b.beginPath(); b.arc(x, y - s * 0.15, s * 0.18, 0, 7); b.fill();
    },
    rows(x0, y0, cols, rows, dx, dy, s, legends) { // a grid of pushbuttons
      let i = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const L = legends[i++ % legends.length];
        T.pb(x0 + c * dx, y0 + r * dy, s, L[0], L[1], L[2]);
      }
    },
  };
  return T;
}

// The FCU in the middle of the glareshield and the EFIS control panels either side of it.
function glareshieldArt() {
  return panelArt(2048, 128, (b, g, W, H) => {
    const T = tools(b, g);
    // master warning / caution either side, before each pilot
    for (const cx of [W * 0.12, W * 0.88]) {
      T.plate(cx - 70, 14, 140, 100, '#202326');
      for (const [dx, txt, col] of [[-32, 'MASTER WARN', '#a12a1d'], [32, 'MASTER CAUT', '#a87412']]) {
        b.fillStyle = col; b.fillRect(cx + dx - 28, 30, 56, 56);
        g.fillStyle = col === '#a12a1d' ? '#3a0c08' : '#3a2804'; g.fillRect(cx + dx - 28, 30, 56, 56);
        T.label(cx + dx, 58, txt.split(' ')[0], 10, '#f5e6d8'); T.label(cx + dx, 72, txt.split(' ')[1], 10, '#f5e6d8');
      }
    }
    // EFIS control panels
    for (const cx of [W * 0.27, W * 0.73]) {
      T.plate(cx - 150, 8, 300, 112);
      T.knob(cx - 95, 64, 22); T.label(cx - 95, 24, 'BARO', 10);
      T.window(cx - 30, 40, 70, 22, '1013');
      T.rows(cx + 30, 40, 4, 2, 32, 46, 26, [['', 'CSTR'], ['', 'WPT'], ['', 'VOR'], ['', 'NDB'], ['', 'ARPT'], ['', 'TRAF'], ['', 'WX'], ['', 'TERR']]);
      T.knob(cx - 30, 88, 16); T.label(cx - 30, 112, 'ND RANGE', 9);
    }
    // FCU: SPD/MACH, HDG/TRK, ALT, V/S, with the AP / A/THR buttons
    T.plate(W * 0.39, 6, W * 0.22, 116, '#33373d');
    const x0 = W * 0.39;
    const units = [['SPD', '---', 0.1], ['HDG', '---', 0.33], ['ALT', '-----', 0.62], ['V/S', '-----', 0.86]];
    for (const [name, txt, f] of units) {
      const x = x0 + f * W * 0.22;
      T.label(x, 18, name, 10);
      T.window(x, 40, name === 'ALT' || name === 'V/S' ? 76 : 58, 22, txt);
      T.knob(x, 86, 17);
    }
    T.rows(x0 + W * 0.22 * 0.44, 92, 2, 1, 40, 0, 26, [['', 'AP1'], ['', 'AP2']]);
    T.pb(x0 + W * 0.22 * 0.505, 64, 24, '', 'A/THR');
    T.rows(x0 + W * 0.22 * 0.22, 92, 2, 1, 32, 0, 22, [['', 'LOC'], ['', 'APPR']]);
  }, '#16181b');
}

// The main panel's face round the screens: the lighting knobs, the clock, the autobrake buttons and the plates.
function mainPanelArt() {
  return panelArt(1024, 256, (b, g, W, H) => {
    const T = tools(b, g);
    b.fillStyle = 'rgba(255,255,255,0.04)';
    for (let x = 0; x < W; x += 64) b.fillRect(x, 0, 1, H); // panel seams
    // under the PFD/ND screens: brightness knobs and the loudspeaker grille
    for (const cx of [W * 0.27, W * 0.73]) {
      T.knob(cx - 60, H * 0.88, 9); T.knob(cx + 60, H * 0.88, 9);
      b.fillStyle = '#2f3339'; for (let i = 0; i < 9; i++) b.fillRect(cx - 30 + i * 7, H * 0.84, 3, 22);
    }
    // autobrake and the anti-skid in the middle under the engine display
    T.plate(W * 0.43, H * 0.80, W * 0.14, H * 0.18);
    T.rows(W * 0.455, H * 0.89, 4, 1, 30, 0, 22, [['', 'LO'], ['', '2'], ['', '3'], ['', 'HI']]);
  });
}

// The overhead panel: column after column of systems' pushbuttons.
function overheadArt() {
  return panelArt(1024, 1024, (b, g, W, H) => {
    const T = tools(b, g);
    const names = ['ELEC', 'HYD', 'FUEL', 'AIR', 'APU', 'ENG', 'ANTI ICE', 'LIGHTS', 'CABIN', 'FIRE', 'OXY', 'WIPER'];
    const leg = [['FAULT', 'OFF'], ['', 'ON', 1], ['FAULT', 'AUTO'], ['', 'OFF'], ['FAULT', ''], ['', 'ARM'], ['', 'ON', 1], ['FAULT', 'OFF']];
    let i = 0;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        const x = 20 + c * 330, y = 20 + r * 248;
        T.plate(x, y, 310, 230);
        T.label(x + 155, y + 16, names[i++ % names.length], 13, '#e9edf1');
        T.rows(x + 40, y + 60, 5, 3, 58, 62, 44, leg.slice(r + c).concat(leg));
        if ((r + c) % 2) { T.knob(x + 270, y + 200, 12); T.toggle(x + 200, y + 200, 22); }
      }
    }
  });
}

// The pedestal top: the two keyboards with track balls (KCCU), the radio and transponder panels, the engine masters.
function pedestalArt() {
  return panelArt(512, 1024, (b, g, W, H) => {
    const T = tools(b, g);
    // KCCUs (front part, ahead of the levers)
    for (const cx of [W * 0.24, W * 0.76]) {
      T.plate(cx - 110, 20, 220, 300, '#2c3035');
      b.fillStyle = '#1a1c1f';
      for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) b.fillRect(cx - 100 + c * 25, 40 + r * 26, 21, 21);
      g.fillStyle = '#20262c';
      for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) g.fillRect(cx - 96 + c * 25, 47 + r * 26, 12, 6);
      const grd = b.createRadialGradient(cx - 6, 250, 3, cx, 255, 30);
      grd.addColorStop(0, '#8d949c'); grd.addColorStop(1, '#25282c');
      b.fillStyle = grd; b.beginPath(); b.arc(cx, 255, 28, 0, 7); b.fill(); // track ball
    }
    // engine masters and start (behind the levers)
    T.plate(W * 0.18, 560, W * 0.64, 140, '#33373d');
    T.label(W * 0.5, 580, 'ENG', 13);
    for (const [k, x] of [['1', W * 0.36], ['2', W * 0.64]]) { T.toggle(x, 640, 40); T.label(x, 690, `MASTER ${k}`, 10); }
    // radios and the transponder
    for (let i = 0; i < 2; i++) {
      const y = 720 + i * 145;
      T.plate(14, y, W - 28, 135);
      T.window(W * 0.3, y + 40, 130, 28, i ? '7000' : '118.705');
      T.window(W * 0.7, y + 40, 130, 28, i ? 'AUTO' : '121.500');
      T.rows(W * 0.18, y + 95, 6, 1, 64, 0, 34, [['', 'VHF1', 1], ['', 'VHF2'], ['', 'VHF3'], ['', 'HF1'], ['', 'HF2'], ['', 'INT']]);
    }
  });
}

// The side console: the tiller, the nose-wheel and a tray table's outline.
function consoleArt(left) {
  return panelArt(256, 512, (b, g, W, H) => {
    const T = tools(b, g);
    T.plate(20, 40, W - 40, 150, '#3d4249');
    T.label(W / 2, 60, left ? 'CAPT' : 'F/O', 12);
    T.pb(W * 0.35, 120, 40, '', 'PRIO');
    T.knob(W * 0.7, 120, 16);
    b.strokeStyle = 'rgba(0,0,0,0.5)'; b.lineWidth = 2; b.strokeRect(24, 250, W - 48, 220); // tray table
  }, '#575c64');
}

// ---------- geometry ----------
// A flat polygon (cockpit space) from 2D points through `to(u, v) → [x, y, z]`, with holes.
function shapeMesh(outer, holes, to, mat) {
  const sh = new THREE.Shape(outer.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
  const geo = new THREE.ShapeGeometry(sh, 8);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = to(p.getX(i), p.getY(i));
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}
// A window's outline grown outwards by d (its frame's outer edge): each corner moved along the bisector.
function grow(poly, d) {
  const n = poly.length, out = [];
  let area = 0;
  for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1; // (counter-clockwise: the outside is to the right of each edge)
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
    const n1 = norm([(b[1] - a[1]) * sgn, -(b[0] - a[0]) * sgn]), n2 = norm([(c[1] - b[1]) * sgn, -(c[0] - b[0]) * sgn]);
    const m = norm([n1[0] + n2[0], n1[1] + n2[1]]);
    const k = d / Math.max(0.3, m[0] * n1[0] + m[1] * n1[1]);
    out.push([b[0] + m[0] * k, b[1] + m[1] * k]);
  }
  return out;
}
function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
// A box between two corners, turned by `rot` (Euler, radians) about its centre.
function box(w, d, h, mat, x, y, z, rot) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  return m;
}
// A rounded box (side-stick grips, lever knobs, cushions).
function rounded(w, d, h, r, mat) {
  const s = new THREE.Shape();
  const x0 = -w / 2, y0 = -d / 2;
  s.moveTo(x0 + r, y0); s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + d - r); s.quadraticCurveTo(x0 + w, y0 + d, x0 + w - r, y0 + d);
  s.lineTo(x0 + r, y0 + d); s.quadraticCurveTo(x0, y0 + d, x0, y0 + d - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: r * 0.6, bevelSize: r * 0.6, bevelSegments: 3, curveSegments: 4 });
  geo.translate(0, 0, -h / 2);
  return new THREE.Mesh(geo, mat);
}

// The windows (2D outlines): the windscreen in its plane (u = |x|, v = z), the side windows in the wall's (u = y, v = z).
const SCREEN = [[0.075, -0.25], [1.13, -0.25], [1.19, -0.19], [1.19, 0.17], [1.08, 0.27], [0.075, 0.27]];
const SIDE1 = [[wallFrontY(-0.17) - 0.09, -0.17], [-0.02, -0.17], [-0.02, 0.24], [wallFrontY(0.24) - 0.09, 0.24]];
const SIDE2 = [[-0.14, -0.15], [-0.74, -0.13], [-0.74, 0.18], [-0.14, 0.22]];

function build() {
  const root = new THREE.Group();
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide, ...extra });
  const M = {
    lining: std(COL.lining, { roughness: 0.9 }),
    frame: std(COL.frame, { roughness: 0.6 }),
    shield: std(COL.shield, { roughness: 1 }),
    panel: std(COL.panel),
    console: std(COL.console),
    floor: std(COL.floor, { roughness: 1 }),
    seat: std(COL.seat, { roughness: 0.95 }),
    leather: std(0x23262b, { roughness: 0.55 }),
    bezel: std(COL.bezel, { roughness: 0.4 }),
    metal: std(COL.metal, { roughness: 0.35, metalness: 0.7 }),
    knob: std(0x2a2d31, { roughness: 0.45 }),
    glass: new THREE.MeshBasicMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.045, depthWrite: false, side: THREE.DoubleSide }),
  };
  const lit = []; // materials with a glow map (night lighting)

  // windscreens and the walls round them, either side of the centre post
  for (const s of [-1, 1]) {
    const to = (u, v) => [s * u, frontY(u, v), v];
    const outer = [[0, -0.40], [HALF, -0.40], [HALF, ROOF], [0, ROOF]]; // (below the glareshield's top: hidden)
    const ring = grow(SCREEN, 0.045);
    root.add(shapeMesh(outer, [ring], to, M.lining));
    root.add(shapeMesh(ring, [SCREEN], (u, v) => { const p = to(u, v); p[1] -= 0.012; return p; }, M.frame));
    root.add(shapeMesh(SCREEN, [], (u, v) => { const p = to(u, v); p[1] += 0.01; return p; }, M.glass));
    // side wall with its two windows (u = y ahead, v = z), and their frames
    const toW = (u, v) => [s * (HALF - 0.004 * (v - FLOOR)), u, v];
    const wall = [[wallFrontY(FLOOR), FLOOR], [REAR, FLOOR], [REAR, ROOF], [wallFrontY(ROOF), ROOF]];
    const r1 = grow(SIDE1, 0.05), r2 = grow(SIDE2, 0.05);
    root.add(shapeMesh(wall, [r1, r2], toW, M.lining));
    for (const [r, w] of [[r1, SIDE1], [r2, SIDE2]]) {
      root.add(shapeMesh(r, [w], (u, v) => { const p = toW(u, v); p[0] -= s * 0.012; return p; }, M.frame));
      root.add(shapeMesh(w, [], (u, v) => { const p = toW(u, v); p[0] += s * 0.008; return p; }, M.glass));
    }
    // the corner post's inner trim, and a sun visor folded up against the frame
    const visor = box(0.55, 0.012, 0.16, std(0x2b2f35, { transparent: true, opacity: 0.8 }), s * 0.62, frontY(0.62, 0.3) - 0.08, 0.36, [-0.2, 0, 0]);
    root.add(visor);
    // the wiper resting at the bottom of the windscreen
    const wiper = box(0.46, 0.01, 0.01, M.frame, s * 0.42, frontY(0.42, -0.23) - 0.02, -0.232, [0, 0, s * 0.06]);
    root.add(wiper);
  }
  // the centre post
  root.add(shapeMesh([[-0.045, -0.25], [0.045, -0.25], [0.045, 0.30], [-0.045, 0.30]], [], (u, v) => [u, frontY(u, v) - 0.014, v], M.frame));

  // roof, floor, rear wall
  root.add(shapeMesh([[-HALF, REAR], [HALF, REAR], [HALF, wallFrontY(ROOF)], [0, frontY(0, ROOF)], [-HALF, wallFrontY(ROOF)]], [], (u, v) => [u, v, ROOF], M.lining));
  root.add(shapeMesh([[-HALF, REAR], [HALF, REAR], [HALF, 1.2], [-HALF, 1.2]], [], (u, v) => [u, v, FLOOR], M.floor));
  root.add(shapeMesh([[-HALF, FLOOR], [HALF, FLOOR], [HALF, ROOF], [-HALF, ROOF]], [[[-0.4, FLOOR + 0.02], [0.4, FLOOR + 0.02], [0.4, 0.38], [-0.4, 0.38]]], (u, v) => [u, REAR, v], M.lining));
  root.add(box(0.82, 0.05, 1.72, std(0x3a3e44), 0, REAR + 0.02, (FLOOR + 0.38) / 2)); // the door

  // the glareshield: its top from the windscreen's sill back to its lip, the face with the FCU and EFIS panels
  const lipY = (x) => 0.71 - 0.36 * Math.pow(Math.abs(x) / HALF, 2);
  const GT = -0.245, GF = 0.085; // top height, face height
  const pts = [];
  for (let i = 0; i <= 20; i++) { const x = -HALF + (2 * HALF * i) / 20; pts.push([x, lipY(x)]); }
  const topOutline = [...pts, ...pts.slice().reverse().map(([x]) => [x, frontY(x, GT) + 0.02])];
  root.add(shapeMesh(topOutline, [], (u, v) => [u, v, GT], M.shield));
  {
    const art = glareshieldArt();
    const n = 40, pos = [], uv = [], idx = [];
    const x0 = -1.05, x1 = 1.05;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = lipY(x) + 0.004;
      pos.push(x, y, GT, x, y + 0.03, GT - GF);
      uv.push(i / n, 1, i / n, 0);
      if (i < n) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mat = std(0xffffff, { map: art.map, emissiveMap: art.glow, emissive: 0x000000, roughness: 0.7 });
    lit.push(mat);
    root.add(new THREE.Mesh(geo, mat));
    // the face's ends out to the walls, plain
    for (const s of [-1, 1]) {
      const pos2 = [], idx2 = [];
      for (let i = 0; i <= 8; i++) {
        const x = s * (1.05 + (0.31 * i) / 8), y = lipY(x) + 0.004;
        pos2.push(x, y, GT, x, y + 0.03, GT - GF);
        if (i < 8) idx2.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
      }
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3));
      g2.setIndex(idx2); g2.computeVertexNormals();
      root.add(new THREE.Mesh(g2, M.shield));
    }
    // the underside of the lip (seen from below: shadows the top of the screens)
    const under = [...pts.map(([x, y]) => [x, y + 0.03]), ...pts.slice().reverse().map(([x, y]) => [x, y + 0.10])];
    root.add(shapeMesh(under, [], (u, v) => [u, v, GT - GF], M.shield));
  }

  // the main panel: the middle flat, the outer parts turned towards the pilots; the screens in it
  const P = { top: GT - GF - 0.005, bot: -0.86, y: 0.84, lean: 0.14, mid: 0.66, wing: 24 * Math.PI / 180, end: 1.10 };
  const panelArtTex = mainPanelArt();
  const panelMat = std(0xffffff, { map: panelArtTex.map, emissiveMap: panelArtTex.glow, emissive: 0x000000 });
  lit.push(panelMat);
  // (u across the panel's face from the middle, v down from its top: cockpit space)
  const panelAt = (u, v) => {
    const s = Math.sign(u) || 1, a = Math.abs(u);
    const z = P.top - v, y = P.y + P.lean * (z - P.bot) / (P.top - P.bot) - 0.06;
    if (a <= P.mid) return [u, y, z];
    const d = a - P.mid;
    return [s * (P.mid + d * Math.cos(P.wing)), y - d * Math.sin(P.wing), z];
  };
  const panelFaceNormal = (u) => {
    const a = Math.abs(u), s = Math.sign(u) || 1;
    const n = new THREE.Vector3(0, -1, P.lean / (P.top - P.bot)).normalize();
    if (a > P.mid) n.applyAxisAngle(new THREE.Vector3(0, 0, 1), -s * P.wing);
    return n;
  };
  {
    const n = 48, m = 6, pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
      const u = -P.end + (2 * P.end * i) / n, v = ((P.top - P.bot) * j) / m;
      pos.push(...panelAt(u, v)); uv.push(i / n, 1 - j / m);
      if (i < n && j < m) { const a = i * (m + 1) + j, b = a + m + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    root.add(new THREE.Mesh(geo, panelMat));
  }
  // the screens: bezel boxes standing out of the panel, each face a canvas the instruments are drawn on
  const screens = [];
  const W = 0.305, H = 0.229;
  const addScreen = (u, vTop, w, h, kind, canvasW = 1024) => {
    const at = new THREE.Vector3(...panelAt(u, vTop + h / 2));
    const nrm = panelFaceNormal(u);
    const g = new THREE.Group(); g.up.set(0, 0, 1);
    g.position.copy(at).addScaledVector(nrm, 0.012);
    g.lookAt(at.clone().addScaledVector(nrm, 1)); // (+z of the group towards the pilots)
    g.add(Object.assign(box(w + 0.03, h + 0.03, 0.024, M.bezel, 0, 0, -0.004), {}));
    const cv = canvas(canvasW, Math.round(canvasW * h / w));
    const tex = texture(cv);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    face.position.z = 0.0085;
    g.add(face);
    // a faint reflection layer over the glass
    const sheen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false }));
    sheen.position.z = 0.0095;
    g.add(sheen);
    root.add(g);
    screens.push({ kind, cv, ctx: cv.getContext('2d'), tex });
  };
  const vS = 0.012;
  addScreen(-0.86, vS, W * 0.92, H, 'ois-c', 768);
  addScreen(-0.475, vS, W, H, 'pfdnd-c');
  addScreen(0, vS, W * 0.98, H, 'ewd');
  addScreen(0.475, vS, W, H, 'pfdnd-f');
  addScreen(0.86, vS, W * 0.92, H, 'ois-f', 768);
  addScreen(0, vS + H + 0.035, W * 0.95, H * 0.95, 'sd');
  // the standby instrument (left of the engine display) and the gear lever (right of it)
  {
    const at = new THREE.Vector3(...panelAt(-0.235, 0.10)), nrm = panelFaceNormal(0);
    const g = new THREE.Group(); g.up.set(0, 0, 1); g.position.copy(at).addScaledVector(nrm, 0.01); g.lookAt(at.clone().addScaledVector(nrm, 1));
    g.add(box(0.095, 0.095, 0.02, M.bezel, 0, 0, 0));
    const cv = canvas(256, 256), tex = texture(cv);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    face.position.z = 0.0105; g.add(face);
    root.add(g);
    screens.push({ kind: 'isis', cv, ctx: cv.getContext('2d'), tex });
  }
  const gear = new THREE.Group();
  {
    const at = new THREE.Vector3(...panelAt(0.235, 0.12)), nrm = panelFaceNormal(0);
    gear.up.set(0, 0, 1);
    gear.position.copy(at).addScaledVector(nrm, 0.012); gear.lookAt(at.clone().addScaledVector(nrm, 1));
    gear.add(box(0.075, 0.2, 0.012, M.bezel, 0, 0, 0));
    const slot = box(0.016, 0.15, 0.004, std(0x000000), 0, 0, 0.007); gear.add(slot);
    const arm = new THREE.Group(); arm.position.set(0, 0, 0.008); gear.add(arm);
    arm.add(box(0.012, 0.012, 0.07, M.metal, 0, 0, 0.035));
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.018, 18), std(0xdadfe4, { roughness: 0.5 }));
    wheel.rotation.z = Math.PI / 2; wheel.position.set(0, 0, 0.075); arm.add(wheel);
    gear.userData.arm = arm;
    // the three green triangles above it
    const tri = new THREE.MeshBasicMaterial({ color: 0x1fd15a, toneMapped: false });
    gear.userData.tris = [];
    for (const [dx, dy] of [[0, 0.125], [-0.022, 0.108], [0.022, 0.108]]) {
      const t = new THREE.Mesh(new THREE.CircleGeometry(0.008, 3), tri.clone());
      t.position.set(dx, dy, 0.007); t.rotation.z = -Math.PI / 2; gear.add(t); gear.userData.tris.push(t);
    }
    root.add(gear);
  }

  // the pedestal: from under the panel back between the seats; the systems display in its front slope
  const ped = { w: 0.27, top: -0.76, front: 0.74, slope: 0.36, rear: -0.70 };
  {
    const art = pedestalArt();
    const mat = std(0xffffff, { map: art.map, emissiveMap: art.glow, emissive: 0x000000 });
    lit.push(mat);
    // its top: the slope then flat (u = x, v = along)
    const prof = [[ped.front, P.bot + 0.02], [ped.slope, ped.top], [ped.rear, ped.top]];
    const len = prof.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - prof[i - 1][0], p[1] - prof[i - 1][1]) : 0), 0);
    const pos = [], uv = [], idx = [];
    let acc = 0;
    prof.forEach((p, i) => {
      if (i) acc += Math.hypot(p[0] - prof[i - 1][0], p[1] - prof[i - 1][1]);
      pos.push(-ped.w, p[0], p[1], ped.w, p[0], p[1]);
      uv.push(0, 1 - acc / len, 1, 1 - acc / len);
      if (i < prof.length - 1) idx.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    root.add(new THREE.Mesh(geo, mat));
    for (const s of [-1, 1]) {
      const side = [[ped.front, P.bot + 0.02], [ped.slope, ped.top], [ped.rear, ped.top], [ped.rear, FLOOR], [ped.front + 0.1, FLOOR]];
      root.add(shapeMesh(side, [], (u, v) => [s * ped.w, u, v], M.console));
    }
  }
  // the levers on the pedestal: thrust (two), speed brake (left), flaps (right)
  const levers = {};
  {
    const base = new THREE.Group(); base.position.set(0, 0.08, ped.top + 0.005); root.add(base);
    base.add(box(0.20, 0.30, 0.03, std(0x24272b), 0, 0, 0.012));
    // the gate's detents: a printed arc
    levers.thrust = [];
    for (const x of [-0.04, 0.04]) {
      const arm = new THREE.Group(); arm.position.set(x, 0, 0.02); base.add(arm);
      arm.add(box(0.014, 0.014, 0.20, M.metal, 0, 0, 0.10));
      const grip = rounded(0.075, 0.035, 0.035, 0.012, std(0x1d1f22, { roughness: 0.5 }));
      grip.position.set(-x * 0.6, 0, 0.215); arm.add(grip);
      const trigger = box(0.05, 0.01, 0.015, std(0xb6bcc4), -x * 0.6, -0.022, 0.20); arm.add(trigger);
      levers.thrust.push(arm);
    }
    const sb = new THREE.Group(); sb.position.set(-0.19, 0.1, ped.top + 0.01); root.add(sb);
    sb.add(box(0.01, 0.01, 0.12, M.metal, 0, 0, 0.06));
    const sbg = rounded(0.03, 0.05, 0.02, 0.008, std(0x23262b)); sbg.position.set(0, 0, 0.125); sb.add(sbg);
    levers.sb = sb;
    const fl = new THREE.Group(); fl.position.set(0.19, 0.0, ped.top + 0.01); root.add(fl);
    fl.add(box(0.01, 0.01, 0.12, M.metal, 0, 0, 0.06));
    const flg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.022), std(0xdfe3e8, { roughness: 0.5 })); flg.position.set(0, 0, 0.125); fl.add(flg);
    levers.flaps = fl;
    // parking brake knob
    const pk = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 20), M.knob); pk.rotation.x = Math.PI / 2; pk.position.set(0, -0.15, ped.top + 0.02); root.add(pk);
  }

  // side consoles with the side-sticks and tillers
  const sticks = [];
  for (const s of [-1, 1]) {
    const art = consoleArt(s < 0);
    const mat = std(0xffffff, { map: art.map, emissiveMap: art.glow, emissive: 0x000000 });
    lit.push(mat);
    const x0 = s * 0.98, x1 = s * (HALF - 0.01), y0 = 0.62, y1 = -0.75, zt = -0.60;
    root.add(shapeMesh([[0, 0], [1, 0], [1, 1], [0, 1]], [], (u, v) => [Math.max(x0, x1) - Math.abs(x1 - x0) * u, y1 + (y0 - y1) * v, zt], mat));
    // (uv: ShapeGeometry's own, 0..1 here)
    root.add(shapeMesh([[y0, zt], [y1, zt], [y1, FLOOR], [y0, FLOOR]], [], (u, v) => [x0, u, v], M.console));
    root.add(shapeMesh([[x0, zt], [x1, zt], [x1, FLOOR], [x0, FLOOR]], [], (u, v) => [u, y0, v], M.console));
    // the side-stick: a boot, the grip leaning a little forward and outward
    const st = new THREE.Group(); st.position.set(s * 1.13, 0.30, zt + 0.004); root.add(st);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.03, 20), M.leather); boot.rotation.x = Math.PI / 2; boot.position.z = 0.015; st.add(boot);
    const grip = new THREE.Group(); grip.position.z = 0.03; st.add(grip);
    const g1 = rounded(0.038, 0.045, 0.11, 0.016, std(0x1c1e21, { roughness: 0.6 })); g1.position.z = 0.06; grip.add(g1);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 10), std(0x1c1e21, { roughness: 0.6 })); top.position.z = 0.12; grip.add(top);
    const trig = box(0.012, 0.012, 0.025, std(0xb33a2a), 0, 0.022, 0.09); grip.add(trig); // (the take-over button is red)
    sticks.push({ side: s, grip });
    // tiller wheel ahead of the stick
    const til = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.018, 24), M.knob); til.rotation.x = Math.PI / 2; til.position.set(s * 1.08, 0.50, zt + 0.012); root.add(til);
    // the rudder pedals under the panel
    for (const dx of [-0.09, 0.09]) root.add(box(0.07, 0.03, 0.14, M.metal, s * EYE_X + dx, 0.62, -1.05, [-0.5, 0, 0]));
  }

  // the overhead panel, under the ceiling from behind the windscreens back over the pilots' heads
  {
    const art = overheadArt();
    const mat = std(0xffffff, { map: art.map, emissiveMap: art.glow, emissive: 0x000000 });
    lit.push(mat);
    const w = 0.44, f = frontY(0, ROOF) - 0.04, b = -0.80, zf = 0.33, zb = 0.47;
    const pos = [-w, f, zf, w, f, zf, -w, b, zb, w, b, zb];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    geo.setIndex([0, 2, 1, 1, 2, 3]); geo.computeVertexNormals();
    root.add(new THREE.Mesh(geo, mat));
    for (const s of [-1, 1]) root.add(shapeMesh([[f, zf], [b, zb], [b, ROOF], [f, ROOF]], [], (u, v) => [s * w, u, v], M.panel));
    root.add(shapeMesh([[-w, zf], [w, zf], [w, ROOF], [-w, ROOF]], [], (u, v) => [u, f, v], M.panel));
  }

  // the seats (the captain's is behind the camera; the first officer's is seen looking right)
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * EYE_X, -0.42, 0); root.add(g);
    const cush = rounded(0.50, 0.50, 0.10, 0.05, M.seat); cush.position.set(0, 0.05, -0.80); g.add(cush);
    const back = rounded(0.50, 0.12, 0.70, 0.05, M.seat); back.position.set(0, -0.22, -0.40); back.rotation.x = -0.18; g.add(back);
    const head = rounded(0.30, 0.10, 0.16, 0.04, M.seat); head.position.set(0, -0.30, 0.06); head.rotation.x = -0.18; g.add(head);
    for (const dx of [-0.29, 0.29]) { const arm = rounded(0.06, 0.38, 0.05, 0.02, M.leather); arm.position.set(dx, -0.02, -0.62); g.add(arm); }
    g.add(box(0.12, 0.3, 0.45, M.metal, 0, 0, -1.08));
  }

  // lights: the sky through the windows, the sun, and the panels' own at night
  const hemi = new THREE.HemisphereLight(0xdfeaff, 0x3a3630, 1.2);
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
  const amb = new THREE.AmbientLight(0xffffff, 0.35);
  const dome = new THREE.PointLight(0xffe2b8, 0, 4, 1); dome.position.set(0, -0.2, 0.4);
  root.add(hemi, sun, sun.target, amb, dome);

  const scene = new THREE.Scene();
  scene.add(root);
  return { scene, screens, gear, levers, sticks, lit, hemi, sun, amb, dome };
}

// ---------- each frame ----------
let pit = null;
const camera = new THREE.PerspectiveCamera(55, 1, 0.02, 20);
camera.up.set(0, 0, 1);
let paintedAt = 0;

// The standby instrument (ISIS): attitude, speed and altitude in one small round-cornered picture.
function isis(c, W, H, st) {
  c.fillStyle = '#05070a'; c.fillRect(0, 0, W, H);
  c.save(); c.translate(W / 2, H / 2); c.rotate(-(st.phi || 0) * Math.PI / 180);
  const hy = (st.theta || 0) * 4;
  c.fillStyle = '#2f7dd1'; c.fillRect(-W, -2 * H + hy, 2 * W, 2 * H);
  c.fillStyle = '#7a4b22'; c.fillRect(-W, hy, 2 * W, 2 * H);
  c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(-W, hy); c.lineTo(W, hy); c.stroke();
  c.restore();
  c.strokeStyle = '#ffd60a'; c.lineWidth = 6; c.beginPath(); c.moveTo(W * 0.3, H / 2); c.lineTo(W * 0.43, H / 2); c.moveTo(W * 0.57, H / 2); c.lineTo(W * 0.7, H / 2); c.stroke();
  c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(0, 0, W * 0.22, H); c.fillRect(W * 0.78, 0, W * 0.22, H);
  c.fillStyle = '#e8eef8'; c.font = '600 26px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(String(Math.round((st.V || 0) / 0.514444)), W * 0.11, H / 2);
  c.font = '600 20px system-ui, sans-serif';
  c.fillText(String(Math.round((st.h || 0) / 0.3048 / 10) * 10), W * 0.89, H / 2);
}
// The information system: a page of the flight's papers (departure, runway, weights, the checklist).
function ois(c, W, H, st, side) {
  c.fillStyle = '#0b1016'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#16202b'; c.fillRect(0, 0, W, H * 0.11);
  c.fillStyle = '#9fc3e6'; c.font = `600 ${Math.round(H * 0.06)}px system-ui, sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText(side ? 'OIS · FLT OPS' : 'OIS · AVNCS', W * 0.04, H * 0.055);
  const tabs = ['T.O PERF', 'LDG PERF', 'W&B', 'CHARTS', 'CHECKLIST'];
  c.font = `${Math.round(H * 0.045)}px system-ui, sans-serif`;
  tabs.forEach((t, i) => {
    const on = i === (side ? 4 : (st.onGround ? 0 : 1));
    c.fillStyle = on ? '#2b4f74' : '#18222d'; c.fillRect(W * 0.03 + i * W * 0.19, H * 0.14, W * 0.18, H * 0.08);
    c.fillStyle = on ? '#fff' : '#8aa0b6'; c.textAlign = 'center'; c.fillText(t, W * 0.12 + i * W * 0.19, H * 0.18);
  });
  c.textAlign = 'left';
  const rows = side
    ? [['BEFORE START', '✓'], ['BEFORE TAKEOFF', st.onGround ? '…' : '✓'], ['AFTER TAKEOFF', st.onGround ? '' : '✓'], ['APPROACH', ''], ['LANDING', ''], ['PARKING', '']]
    : [['AIRCRAFT', st.name || 'A350'], ['WEIGHT', `${Math.round((st.mass || 0) / 1000)} t`], ['FLAPS', st.flaps || ''], ['V1 / VR / V2', st.vr ? `${st.vr - 4} / ${st.vr} / ${st.vr + 8}` : '—'], ['THR', st.thr || ''], ['ALT', `${Math.round((st.h || 0) / 0.3048)} ft`]];
  c.font = `${Math.round(H * 0.05)}px system-ui, sans-serif`;
  rows.forEach(([k, val], i) => {
    const y = H * (0.31 + i * 0.105);
    c.fillStyle = '#16202b'; c.fillRect(W * 0.03, y - H * 0.045, W * 0.94, H * 0.09);
    c.fillStyle = '#c9d6e2'; c.fillText(k, W * 0.06, y);
    c.fillStyle = val === '✓' ? '#30d158' : '#4fd6ff'; c.textAlign = 'right'; c.fillText(val, W * 0.94, y); c.textAlign = 'left';
  });
}

function paintScreens(now, P) {
  if (now - paintedAt < 80) return; // (about 12 times a second)
  paintedAt = now;
  const st = P.state;
  const info = { V: st.V, h: st.h, theta: st.theta, phi: st.phi, onGround: st.onGround, mass: st.mass,
    name: st.spec && st.spec.name, vr: st.spec && st.spec.vr, flaps: '', thr: '' };
  for (const sc of pit.screens) {
    const { ctx: c, cv } = sc;
    const W = cv.width, H = cv.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (sc.kind === 'pfdnd-c' || sc.kind === 'pfdnd-f') {
      // PFD outboard, ND inboard
      const pfdLeft = sc.kind === 'pfdnd-c';
      c.fillStyle = '#05070a'; c.fillRect(0, 0, W, H);
      c.save(); c.translate(pfdLeft ? 0 : W / 2, 0); P.panel(c, 'pfd', W / 2, H); c.restore();
      c.save(); c.translate(pfdLeft ? W / 2 : 0, 0); P.panel(c, 'nd', W / 2, H); c.restore();
      c.fillStyle = '#1a1d21'; c.fillRect(W / 2 - 2, 0, 4, H);
    } else if (sc.kind === 'ewd') P.panel(c, 'ecam', W, H);
    else if (sc.kind === 'sd') P.panel(c, 'sd', W, H);
    else if (sc.kind === 'isis') isis(c, W, H, info);
    else ois(c, W, H, info, sc.kind === 'ois-f');
    sc.tex.needsUpdate = true;
  }
}

const ease = (a, b, k) => a + (b - a) * k;
// Levers and sticks where the pilot has them.
function poseControls(st) {
  const L = pit.levers;
  const lev = st.lever ?? 0;
  const ang = lev < 0 ? 0.55 + 0.25 * Math.min(1, -lev) : 0.55 - 1.0 * lev; // (back = idle, forward = TOGA; reverse pulls it back further)
  for (const a of L.thrust) a.rotation.x = ease(a.rotation.x, -ang + 0.25, 0.3);
  L.sb.rotation.x = ease(L.sb.rotation.x, 0.5 - 0.9 * Math.max(st.sb || 0, st.gs || 0), 0.3);
  const confs = Math.max(1, (st.spec && st.spec.confs) || 4);
  L.flaps.rotation.x = ease(L.flaps.rotation.x, -0.5 + 1.0 * Math.min(1, (st.conf || 0) / confs), 0.3);
  for (const s of pit.sticks) {
    const pitch = st.stick || 0, roll = st.roll || 0;
    s.grip.rotation.x = ease(s.grip.rotation.x, -0.25 * pitch, 0.4); // (pulled back: nose up)
    s.grip.rotation.y = ease(s.grip.rotation.y, 0.25 * roll, 0.4);
  }
  const gArm = pit.gear.userData.arm;
  gArm.position.y = ease(gArm.position.y, st.gearDown ? -0.06 : 0.06, 0.25);
  const gr = st.gear ?? 1;
  for (const t of pit.gear.userData.tris) {
    t.material.color.set(gr > 0.99 ? 0x1fd15a : gr > 0.01 ? 0xff3b30 : 0x1a1c1f);
  }
}

// Draw the cockpit over the world (view3d.js planeLayer, after its own pass). `sunB`: the sun in cockpit space
// (x right, y ahead, z up; null under the horizon), `day` 0 … 1, `fov` the map's vertical field of view (°),
// `look` the head's turn { yaw, pitch } (°).
export function draw(renderer, gl, { sunB, day, fov, look, lookDown }) {
  const P = FG.pilot;
  if (!P || !P.active) return;
  if (!pit) pit = build();
  const now = performance.now();
  paintScreens(now, P);
  poseControls(P.state);
  // light
  const d = Math.max(0, Math.min(1, day));
  pit.hemi.intensity = 0.25 + 0.8 * d;
  pit.amb.intensity = 0.08 + 0.32 * d;
  if (sunB && d > 0.05) { pit.sun.intensity = 1.8 * d; pit.sun.position.set(sunB[0] * 10 - EYE_X, sunB[1] * 10, sunB[2] * 10); pit.sun.target.position.set(-EYE_X, 0, 0); }
  else pit.sun.intensity = 0;
  pit.dome.intensity = 2.5 * (1 - d);
  const glow = 0.15 + 0.85 * (1 - d);
  for (const m of pit.lit) m.emissive.setScalar(glow * 0.9);
  // camera: the captain's eye, looking a little down the nose, turned with the head
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  camera.fov = fov; camera.aspect = W / H; camera.updateProjectionMatrix();
  camera.position.set(-EYE_X, 0, 0);
  const yaw = (look.yaw || 0) * Math.PI / 180, pitch = (-(lookDown || 0) + (look.pitch || 0)) * Math.PI / 180;
  camera.lookAt(-EYE_X + Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch));
  renderer.clearDepth();
  renderer.render(pit.scene, camera);
}
export const has = (type) => /^A350/i.test(type || '');
// (for debugging: FG.cockpit3d.pit is the built deck)
FG.cockpit3d = { get pit() { return pit; } };
