// Fly it yourself: an A350 flown by hand in the 3D view (P, or ✈ Fly among the 3D view's buttons).
// The physics are a point-mass model with Airbus-like fly-by-wire (normal law): the stick asks for a pitch rate and
// holds the flight path when let go, the roll keys ask for a roll rate and the bank stays where it is left (up to 33°),
// the angle of attack is limited so the wing never stalls (alpha protection, alpha floor gives TOGA). The engines spool
// up slowly from idle; flaps and gear take seconds to move and add drag; wheel brakes, ground spoilers and reversers
// stop it on the runway. Touchdowns are rated by their sink rate; too hard, gear up or a wing tip down is a crash.
// The plane is the player's alone (not part of the airline): it runs in real time, whatever the game speed.
// view3d.js draws it (FG.pilot.pose()), points the cameras at it and calls FG.pilot.step() every frame.
(function () {
  'use strict';
  const G = FG.game;
  const KT = 0.514444, FT = 0.3048, DEG = Math.PI / 180, R_E = 6371008.8, G0 = 9.80665;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const wrap360 = (d) => ((d % 360) + 360) % 360;
  const wrap180 = (d) => ((((d % 360) + 540) % 360) - 180);

  // Masses in kg, wing area m², take-off thrust per engine N (Trent XWB-84 / -97), wheelbase m, tail strike pitch °.
  const TYPES = {
    'A350-900': { toMass: 250000, landMass: 200000, S: 442, thrust: 374000, wheelbase: 28.7, tail: 11.5 },
    'A350-1000': { toMass: 290000, landMass: 225000, S: 464, thrust: 431000, wheelbase: 32.5, tail: 9.6 },
  };
  // Flap lever positions: flap angle drawn (°), extra lift at 0° alpha, max lift, extra drag, max speed (VFE, kt).
  const CONF = [
    { name: '0', flap: 0, cl0: 0, clmax: 1.30, cd: 0, vfe: 999 },
    { name: '1', flap: 0, cl0: 0.05, clmax: 1.65, cd: 0.004, vfe: 255 },
    { name: '1+F', flap: 8, cl0: 0.28, clmax: 1.92, cd: 0.012, vfe: 220 },
    { name: '2', flap: 15, cl0: 0.42, clmax: 2.10, cd: 0.022, vfe: 212 },
    { name: '3', flap: 22, cl0: 0.52, clmax: 2.25, cd: 0.032, vfe: 195 },
    { name: 'FULL', flap: 35, cl0: 0.70, clmax: 2.50, cd: 0.055, vfe: 186 },
  ];
  // Thrust lever detents (Airbus): idle, climb, flex/max continuous, take-off/go-around. Below 0: reverse.
  const DETENTS = [{ at: 0, name: 'IDLE' }, { at: 0.86, name: 'CL' }, { at: 0.93, name: 'FLX/MCT' }, { at: 1, name: 'TOGA' }];
  const VMO = 340, MMO = 0.89, VLE = 250;
  const CL_A = 0.085, CL_BASE = 0.22, CD0 = 0.017, K_IND = 0.0394; // lift slope /°, wing lift at 0°, drag
  const IDLE_N1 = 21, LOOK_DOWN = 4; // cockpit camera: looks this far below the nose (°)
  const CAMS = ['chase', 'cockpit', 'wing', 'flyby'];

  const s = { active: false, keys: new Set(), cam: 'chase', msgs: [], help: false };

  function atmo(h) {
    h = Math.max(-500, h);
    const T = h < 11000 ? 288.15 - 0.0065 * h : 216.65;
    const p = h < 11000 ? 101325 * Math.pow(T / 288.15, 5.2559) : 22632 * Math.exp(-(h - 11000) / 6341.6);
    return { rho: p / (287.05 * T), a: Math.sqrt(1.4 * 287.05 * T) };
  }
  function confAt(f) {
    const i = clamp(Math.floor(f), 0, CONF.length - 2), u = clamp(f - i, 0, 1);
    const a = CONF[i], b = CONF[i + 1];
    const mix = (k) => a[k] + (b[k] - a[k]) * u;
    return { flap: mix('flap'), cl0: mix('cl0'), clmax: mix('clmax'), cd: mix('cd') };
  }
  const thrustFrac = (n1) => 0.04 + 0.96 * Math.pow(clamp((n1 - IDLE_N1) / (100 - IDLE_N1), 0, 1), 1.8);
  const ias = () => s.V * Math.sqrt(atmo(s.h).rho / 1.225) / KT;
  const detentName = (l) => (l < 0 ? (l < -0.9 ? 'MAX REV' : 'REV') : (DETENTS.find((d) => Math.abs(l - d.at) < 0.005) || { name: 'MAN THR' }).name);
  const agl = () => (s.h - s.groundH) / FT;
  const vsFpm = () => (s.V * Math.sin(s.gamma)) / FT * 60;
  // the lowest selectable speed for a flap setting at this weight (1.23 × the 1 g stall speed), kt
  const vls = (conf) => (1.23 * Math.sqrt((2 * s.mass * G0) / (1.225 * s.spec.S * CONF[conf].clmax))) / KT;
  // The speed the autothrust flies (kt, indicated): picked with [ ] (cyan), or managed (magenta): 250 kt below
  // 10,000 ft, then 300 kt up to M 0.85; with flaps out a speed between the flaps' lowest and highest, on the
  // approach (FULL, or 3 with the gear down) VLS + 5.
  function spdTarget() {
    const top = Math.min(VMO - 10, s.conf ? CONF[s.conf].vfe - 5 : 999, s.gear > 0.05 ? VLE - 5 : 999);
    if (s.spdSel != null) return { kt: Math.min(s.spdSel, top + 5), sel: true };
    let kt;
    if (!s.conf) {
      const at = atmo(s.h);
      kt = s.h / FT < 10000 ? 250 : Math.min(300, (0.85 * at.a * Math.sqrt(at.rho / 1.225)) / KT);
    } else if (s.conf >= 5 || (s.conf === 4 && s.gearDown)) kt = vls(s.conf) + 5;
    else kt = vls(s.conf) + 25;
    return { kt: Math.round(Math.min(kt, top)), sel: false };
  }
  // the autothrust works with the levers in CL (or between idle and CL: then that is the most it gives), in the air
  const athrOn = () => s.athr && !s.onGround && !s.afloor && s.lever > 0.01 && s.lever < 0.87;
  function say(text, level = 'info', ms = 3500) {
    s.msgs = s.msgs.filter((m) => m.text !== text);
    s.msgs.push({ text, level, until: performance.now() + ms });
  }
  function speak(text) {
    if (!FG.sound || !FG.sound.on || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.25; u.lang = 'en-US'; u.volume = Math.min(1, (FG.sound.volume ?? 0.8) + 0.2);
      speechSynthesis.speak(u);
    } catch (e) { /* no speech */ }
  }

  // ---------- runways ----------
  const airportList = () => (s.apList || (s.apList = Object.values(G.airportByCode)));
  const designator = (hdg) => String(Math.round(wrap360(hdg) / 10) || 36).padStart(2, '0');
  // Both ends of every runway at an airport: { code, lat, lon (threshold), course, len, far: [lat, lon], name }.
  const endsCache = new Map();
  function runwayEnds(code) {
    const rws = G.airportRunways(code) || [];
    const key = `${code}:${rws.length}`;
    if (endsCache.has(key)) return endsCache.get(key);
    const out = [];
    for (const r of rws) {
      const len = G.runwayLength(r);
      if (!(len > 0)) continue;
      for (const [a, b] of [[[r[0], r[1]], [r[2], r[3]]], [[r[2], r[3]], [r[0], r[1]]]]) {
        const course = G.bearing({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });
        out.push({ code, lat: a[0], lon: a[1], far: b, course, len, width: r[4] || 45, name: designator(course) });
      }
    }
    endsCache.set(key, out);
    return out;
  }
  const offset = (lat, lon, brg, m) => [lat + (m * Math.cos(brg * DEG)) / 111320, lon + (m * Math.sin(brg * DEG)) / (111320 * Math.cos(lat * DEG))];
  // Runways near the plane, refreshed every few seconds (for the ILS and the off-runway warning).
  function nearbyEnds() {
    const now = performance.now();
    if (s.near && now - s.near.at < 3000) return s.near.ends;
    const here = { lat: s.lat, lon: s.lon };
    const ends = [];
    for (const a of airportList()) {
      if (Math.abs(a.lat - s.lat) > 0.6 || G.distanceKm(here, a) > 60) continue;
      for (const e of runwayEnds(a.code)) if (e.len > 1200) ends.push(e);
    }
    s.near = { at: now, ends };
    return ends;
  }
  // The ILS the plane is lined up with: the runway end ahead within 35 km whose centre line it is nearest to.
  function ils() {
    if (s.onGround && !s.landed) return null;
    let best = null;
    for (const e of nearbyEnds()) {
      const d = G.distanceKm({ lat: s.lat, lon: s.lon }, e) * 1000;
      if (d > 35000 || d < 30) continue;
      const toThr = G.bearing({ lat: s.lat, lon: s.lon }, e);
      const loc = wrap180(toThr - e.course); // + : the plane is left of the centre line (the runway is to its right)
      if (Math.abs(loc) > 12 || Math.abs(wrap180(s.psi - e.course)) > 70) continue;
      if (!best || Math.abs(loc) < Math.abs(best.loc)) best = { e, d, loc };
    }
    if (!best) return null;
    const e = best.e;
    if (e.h == null && !e.asked && FG.flat) { e.asked = true; FG.flat.heightsAt([[e.lat, e.lon]], 12).then(([h]) => { e.h = h; }, () => { e.asked = false; }); }
    const thrH = e.h;
    const gsAngle = thrH == null ? null : Math.atan2(s.h - thrH - 15, best.d) / DEG;
    return { ...best, gs: gsAngle == null ? null : gsAngle - 3 };
  }
  function onRunway() {
    for (const e of nearbyEnds()) {
      const d = G.distanceKm(e, { lat: s.lat, lon: s.lon }) * 1000;
      if (d > e.len + 100) continue;
      const a = (G.bearing(e, { lat: s.lat, lon: s.lon }) - e.course) * DEG;
      const along = d * Math.cos(a), across = Math.abs(d * Math.sin(a));
      if (along > -80 && along < e.len + 80 && across < e.width / 2 + 12) return true;
    }
    return false;
  }

  // ---------- ground ----------
  function groundAt(lat, lon) {
    const v = FG.view3d;
    if (!v || !v.map || !v.map.queryTerrainElevation) return null;
    const h = v.map.queryTerrainElevation([lon, lat]);
    return h == null || !isFinite(h) ? null : h;
  }
  const heightsAt = (pts) => (FG.flat ? FG.flat.heightsAt(pts, 12) : Promise.resolve(pts.map(() => null)));

  // ---------- start ----------
  // opts: { type, mode: 'runway' | 'final' | 'takeover', end (a runwayEnds() entry), plane (takeover) }
  function start(opts) {
    const v = FG.view3d;
    if (!v) { toast('The 3D view is not available here.'); return; }
    const type = TYPES[opts.type] ? opts.type : 'A350-900';
    Object.assign(s, {
      active: true, loading: true, startOpts: opts, type, spec: TYPES[type], startAt: performance.now(),
      lat: 0, lon: 0, h: 0, groundH: 0, V: 0, gamma: 0, psi: 0, theta: 0, phi: 0, alpha: 0,
      onGround: true, landed: false, n1: [IDLE_N1, IDLE_N1], lever: 0, rev: 0, gearDown: true, gear: 1,
      conf: 2, flapPos: 2, sb: 0, gs: 0, armed: true, brake: 0, parking: false, afloor: false,
      stick: 0, roll: 0, rud: 0, crashed: null, touch: null, tail: false, paused: false, calls: {}, near: null,
      hideId: opts.plane ? opts.plane.id : null, mass: TYPES[type].toMass, prevAgl: null, ghReal: null, ghAt: 0,
      gref: null, athr: true, spdSel: null, athrN1: null, iasPrev: null, iasAcc: 0, menu: false, lvrClb: false, sway: { p: 0, pv: 0, r: 0, rv: 0 }, vPrev: null,
    });
    s.msgs = [];
    const e = opts.end;
    let pts;
    if (opts.mode === 'takeover' && opts.state) {
      const st = opts.state;
      s.mode = 'air';
      s.lat = st.lat; s.lon = st.lon; s.psi = st.heading; s.h = st.altFt * FT;
      s.V = Math.max(75, st.speedKmh / 3.6); s.onGround = false; s.mass = (s.spec.toMass + s.spec.landMass) / 2;
      const a = (st.altFt || 0) - (st.fieldFt || 0);
      const ph = st.phase;
      s.conf = ph === 'approach' ? (a < 2000 ? 4 : 2) : ph === 'climb' && a < 3000 ? 2 : 0;
      s.flapPos = s.conf;
      s.gearDown = ph === 'approach' && a < 2500; s.gear = s.gearDown ? 1 : 0;
      s.lever = 0.86; // (CL: the autothrust holds the speed)
      s.gamma = ph === 'climb' ? 4 * DEG : ph === 'cruise' ? 0 : -3 * DEG;
      s.n1 = ph === 'climb' ? [86, 86] : ph === 'cruise' ? [70, 70] : [45, 45];
      s.groundH = (st.fieldFt || 0) * FT;
      pts = [[s.lat, s.lon]];
    } else if (opts.mode === 'final') {
      s.mode = 'final';
      const [lat, lon] = offset(e.lat, e.lon, e.course + 180, 18520); // 10 NM out on the centre line
      Object.assign(s, { lat, lon, psi: e.course, V: 165 * KT, onGround: false, conf: 3, flapPos: 3, gearDown: false, gear: 0,
        lever: 0.86, gamma: -3 * DEG, mass: s.spec.landMass });
      s.n1 = [60, 60];
      pts = [[e.lat, e.lon], [lat, lon]];
    } else {
      s.mode = 'runway';
      const [lat, lon] = offset(e.lat, e.lon, e.course, 60);
      Object.assign(s, { lat, lon, psi: e.course });
      pts = [[lat, lon]];
    }
    s.alpha = s.onGround ? 0 : 3;
    s.theta = s.alpha + s.gamma / DEG;
    s.gref = s.onGround ? null : s.gamma; // (in the air: fly on along the path it has)
    // heights where it starts (the 3D map's own tiles may not be there yet)
    heightsAt(pts).then((h) => {
      if (!s.active || s.startOpts !== opts) return;
      if (s.mode === 'final') {
        const thr = h[0] ?? 0;
        e.h = thr;
        s.h = thr + 15 + Math.tan(3 * DEG) * 18520;
        s.groundH = h[1] ?? thr;
      } else if (s.mode === 'runway') {
        s.h = s.groundH = h[0] ?? 0;
      } else if (h[0] != null) s.groundH = h[0];
      s.loading = false;
      s.last = null;
    }, () => { s.loading = false; });
    if (s.mode === 'air') s.loading = false;
    bindKeys(true);
    showHud(true);
    const go = () => { v.pilotCam(s.cam = 'chase'); };
    if (!v.on) v.setOn(true);
    go();
    say(s.mode === 'runway' ? `Lined up on runway ${e.name} at ${e.code}. Flaps 1+F. Throttle up (4 = TOGA), pull ↓ at 150 kt.`
      : s.mode === 'final' ? `10 NM final for runway ${e.code} ${e.name}. Gear (G), flaps (F), follow the ILS.` : 'You have control.', 'info', 7000);
    if (s.mode === 'air') speak('You have control');
  }
  function stop() {
    if (!s.active) return;
    showMenu(false);
    s.active = false;
    bindKeys(false);
    showHud(false);
    if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) { /* */ }
    if (FG.view3d) FG.view3d.pilotCam(null);
  }
  function restart() { showMenu(false); if (s.startOpts) start(s.startOpts); }
  const toast = (t) => (FG.ui && FG.ui.toast ? FG.ui.toast(t) : alert(t));

  // ---------- keys ----------
  const held = (...k) => k.some((x) => s.keys.has(x));
  function onKey(e) {
    if (!s.active) return;
    if (e.target.matches && e.target.matches('input, select, textarea')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const down = e.type === 'keydown';
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // the sound key, the F keys (bug report, dev tools) and Tab stay the browser's and the game's
    if (k === 'm' || /^F\d+$/.test(k) || k === 'Tab') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!down) { s.keys.delete(k); s.keys.delete(e.code); return; }
    s.keys.add(k); s.keys.add(e.code);
    if (e.repeat) return;
    // the Esc menu: resume, start again or leave (nothing else while it is open)
    if (s.menu) {
      s.keys.clear();
      if (k === 'Escape') showMenu(false);
      else if (k === 'Enter' || k === 'r') restart();
      else if (k === 'q' || k === 'l') stop();
      return;
    }
    switch (k) {
      case 'Escape': showMenu(true); break;
      case 'Enter': if (s.crashed) restart(); break;
      case 'p': s.paused = !s.paused; say(s.paused ? 'Paused (P)' : 'Resumed', 'info', 1500); break;
      case 'h': s.help = !s.help; break;
      case 'g':
        if (s.onGround && !s.gearDown) break;
        if (s.onGround) { say('The gear cannot come up on the ground', 'amber'); break; }
        s.gearDown = !s.gearDown; break;
      case 'f':
        s.conf = clamp(s.conf + (e.shiftKey ? -1 : 1), 0, CONF.length - 1); break;
      case 'x':
        if (e.shiftKey) { s.armed = !s.armed; say(s.armed ? 'Ground spoilers armed' : 'Ground spoilers disarmed', 'info', 1500); }
        else s.sb = s.sb >= 1 ? 0 : s.sb + 0.5;
        break;
      case 'r':
        if (!s.onGround) { say('Reversers only on the ground', 'amber'); break; }
        s.lever = s.lever < 0 ? 0 : -1; break;
      case '1': s.lever = 0; s.afloor = false; break;
      case '2': s.lever = 0.86; s.afloor = false; break;
      case '3': s.lever = 0.93; s.afloor = false; break;
      case '4': s.lever = 1; s.afloor = false; break;
      case 'c': FG.view3d.pilotCam(s.cam = CAMS[(CAMS.indexOf(s.cam) + 1) % CAMS.length]); break;
      case 'v': FG.view3d.pilotCam(s.cam = 'chase'); break;
      case 'n': FG.view3d.pilotCam(s.cam === 'wing' ? 'wing2' : 'wing'); s.cam = 'wing'; break;
      case 'k': s.parking = !s.parking; break;
      case 't':
        s.athr = !s.athr; s.athrN1 = null;
        say(s.athr ? 'A/THR on: levers in CL, it holds the speed' : 'A/THR off: the levers set the thrust', s.athr ? 'info' : 'amber', 2500);
        break;
      case '[': case ']': {
        const now = Math.round(spdTarget().kt);
        s.spdSel = clamp(Math.round((now + (k === ']' ? 5 : -5)) / 5) * 5, 120, VMO - 10);
        break;
      }
      case '\\': s.spdSel = null; say('Managed speed', 'info', 1500); break;
      default:
    }
  }
  function bindKeys(on) {
    s.keys.clear();
    for (const t of ['keydown', 'keyup']) {
      if (on) window.addEventListener(t, onKey, true); else window.removeEventListener(t, onKey, true);
    }
    if (on) window.addEventListener('blur', clearKeys); else window.removeEventListener('blur', clearKeys);
  }
  const clearKeys = () => s.keys.clear();
  function inputs(dt) {
    const ease = (cur, to, tau) => cur + (to - cur) * (1 - Math.exp(-dt / tau));
    const pitch = (held('ArrowDown', 's') ? 1 : 0) - (held('ArrowUp', 'w') ? 1 : 0); // ↓ pulls the nose up (a stick)
    const roll = (held('ArrowRight', 'd') ? 1 : 0) - (held('ArrowLeft', 'a') ? 1 : 0);
    const rud = (held('e') ? 1 : 0) - (held('q') ? 1 : 0);
    s.stick = ease(s.stick, pitch, 0.25);
    s.roll = ease(s.roll, roll, 0.15);
    s.rud = ease(s.rud, rud, 0.3);
    const thr = (held('PageUp', '+', '=', 'NumpadAdd') ? 1 : 0) - (held('PageDown', '-', 'NumpadSubtract') ? 1 : 0);
    if (thr) {
      s.afloor = false;
      // into reverse only on the ground, and only from idle on a fresh press (it stops at idle first)
      const min = s.onGround && (s.lever < 0 || s.revOk) ? -1 : 0;
      s.lever = clamp(s.lever + thr * 0.45 * dt, min, 1);
      if (thr > 0 || s.lever > 0) s.revOk = false;
    } else s.revOk = s.lever <= 0 && s.onGround;
    s.brake = ease(s.brake, held(' ', 'b', '.') || s.parking ? 1 : 0, 0.3);
  }

  // ---------- physics ----------
  function physics(dt) {
    const sp = s.spec, m = s.mass, W = m * G0;
    const at = atmo(s.h);
    const V = Math.max(0, s.V);
    const q = 0.5 * at.rho * V * V;
    const M = V / at.a;
    s.flapPos += clamp(s.conf - s.flapPos, -dt / 7, dt / 7); // about 7 s a notch
    const c = confAt(s.flapPos);
    s.gear += clamp((s.gearDown ? 1 : 0) - s.gear, -dt / 10, dt / 10);
    // engines: spool up slowly from idle, faster once turning; reverse once the sleeves are open
    s.rev += clamp((s.lever < 0 && s.onGround ? 1 : 0) - s.rev, -dt / 2.5, dt / 2);
    let target = s.lever < 0 ? (s.rev > 0.95 ? IDLE_N1 + (75 - IDLE_N1) * -s.lever : IDLE_N1) : IDLE_N1 + (100 - IDLE_N1) * s.lever;
    // autothrust: N1 asked for from the speed error and how fast the speed changes
    const spdNow = V * Math.sqrt(at.rho / 1.225) / KT;
    if (s.iasPrev != null && dt > 0) s.iasAcc += ((spdNow - s.iasPrev) / dt - s.iasAcc) * (1 - Math.exp(-dt / 0.6));
    s.iasPrev = spdNow;
    if (athrOn()) {
      const most = IDLE_N1 + (100 - IDLE_N1) * s.lever;
      if (s.athrN1 == null) s.athrN1 = clamp((s.n1[0] + s.n1[1]) / 2, IDLE_N1, most);
      const want = clamp((spdTarget().kt - spdNow) * 0.25, -1.5, 1.5); // kt/s
      s.athrN1 = clamp(s.athrN1 + clamp((want - s.iasAcc) * 5, -6, 6) * dt, IDLE_N1, most);
      target = s.athrN1;
    } else s.athrN1 = null;
    if (s.afloor) target = 100;
    for (let i = 0; i < 2; i++) {
      const n = s.n1[i];
      const diff = target - n;
      const up = n < 45 ? 3 + (n - IDLE_N1) * 0.35 : 12;
      s.n1[i] = clamp(n + clamp(diff * (diff > 0 ? 0.9 : 1.2), -15, up) * dt, IDLE_N1 - 1, 101);
    }
    const lapse = Math.pow(at.rho / 1.225, 0.75) * (1 - 0.35 * M + 0.1 * M * M);
    let T = sp.thrust * lapse * (thrustFrac(s.n1[0]) + thrustFrac(s.n1[1]));
    T *= 1 - 1.45 * s.rev; // (reversed: up to 45% of it backwards)
    // ground spoilers: up on the ground with the thrust levers at idle (armed, or in reverse) after touchdown, and
    // for a rejected take-off above 72 kt
    const gsUp = s.onGround && s.lever <= 0.02 && (s.armed || s.lever < 0) && (s.landed ? V > 40 * KT : V > 72 * KT);
    s.gs += clamp((gsUp ? 1 : 0) - s.gs, -dt, dt * 2);
    const spoil = Math.max(s.gs, s.sb * (s.onGround ? 1 : 0.5));
    // aerodynamics
    const clBase = CL_BASE + c.cl0;
    const aStall = (c.clmax - clBase) / CL_A;
    s.aProt = aStall - 2;
    let CL = clBase + CL_A * s.alpha;
    if (s.alpha > aStall) CL = c.clmax - 0.05 * Math.pow(s.alpha - aStall, 1.5);
    CL -= 0.45 * spoil;
    const wave = M > 0.84 ? 12 * Math.pow(M - 0.84, 2) : 0;
    const CD = CD0 + c.cd + 0.02 * s.gear + 0.05 * spoil + K_IND * Math.pow(CL - 0.1, 2) + wave;
    const L = q * sp.S * CL, D = q * sp.S * CD;
    s.load = L / W;
    let psiRate = 0; // °/s
    if (!s.onGround) {
      const Vs = Math.max(30, V);
      const cg = Math.cos(s.gamma), cphi = Math.cos(s.phi * DEG);
      // normal law. The stick moves the flight path the aircraft is asked to fly (gref), up to 3°/s at full; the
      // angle of attack asked for is the one for 1 g along the path plus what it takes to bend the path onto gref
      // at the wing's own pace. So the nose turns smoothly at the stick's rate and the path follows a moment later,
      // without the nose jumping as the stick is pressed or let go (it used to snap up or down a few degrees and
      // come back). Let go, gref stays: the path is held. Pitch 30° up, 15° down at most.
      const cphiL = Math.max(0.5, cphi);
      const Ty = T * Math.sin(s.alpha * DEG);
      const alphaFor = (nz) => ((nz * W - Ty) / Math.max(1, q * sp.S) + 0.45 * spoil - clBase) / CL_A;
      const aHold = alphaFor(cg / cphiL);
      if (s.gref == null) s.gref = s.gamma + (s.alpha - aHold) * cphiL * DEG;
      let rate = s.stick * 3; // °/s
      if (s.theta > 25 && rate > 0) rate *= clamp((30 - s.theta) / 5, 0, 1);
      if (s.theta < -10 && rate < 0) rate *= clamp((s.theta + 15) / 5, 0, 1);
      // high speed protection: the nose comes up by itself above VMO / MMO
      const over = Math.max(ias() - VMO - 6, (M - MMO - 0.01) * 600);
      if (over > 0 && s.stick <= 0) rate += Math.min(2, over * 0.15);
      s.gref += rate * DEG * dt;
      const flaps = s.flapPos > 0.5;
      const aMin = Math.max(-6, alphaFor(flaps ? 0 : -1)), aMax = Math.min(s.aProt, alphaFor(flaps ? 2 : 2.5));
      // (the path asked for can't run away from the one flown while the angle of attack is at a limit)
      s.gref = clamp(s.gref, s.gamma + (aMin - aHold) * cphiL * DEG, s.gamma + (aMax - aHold) * cphiL * DEG);
      const aCmd = clamp(aHold + (s.gref - s.gamma) / DEG / cphiL, aMin, aMax);
      s.alpha += (aCmd - s.alpha) * (1 - Math.exp(-dt / 0.3));
      s.V += ((T * Math.cos(s.alpha * DEG) - D) / m - G0 * Math.sin(s.gamma)) * dt;
      s.gamma += (((L + Ty) * cphi) / (m * Vs) - (G0 * cg) / Vs) * dt;
      s.gamma = clamp(s.gamma, -80 * DEG, 80 * DEG);
      psiRate = (((L + Ty) * Math.sin(s.phi * DEG)) / (m * Vs * Math.max(0.2, cg))) / DEG + s.rud * 1.5;
      // roll: 15°/s at full; let go the bank stays (up to 33°, beyond that it comes back to 33°); 67° at most
      if (Math.abs(s.roll) > 0.02) s.phi += s.roll * 15 * dt;
      else if (Math.abs(s.phi) > 33) s.phi -= Math.sign(s.phi) * Math.min(5 * dt, Math.abs(s.phi) - 33);
      s.phi += s.rud * 2 * dt;
      s.phi = clamp(s.phi, -67, 67);
      // the nose is alpha above the path in the aircraft's own up direction: banked, part of it is sideways
      s.theta = s.gamma / DEG + s.alpha * Math.cos(s.phi * DEG);
      // alpha floor: TOGA by itself near the stall (away from the ground)
      if (!s.afloor && s.alpha > s.aProt - 0.3 && agl() > 100) { s.afloor = true; say('A.FLOOR — TOGA', 'amber', 4000); }
    } else {
      s.gamma = 0;
      s.gref = null;
      s.phi *= Math.exp(-dt / 0.3);
      // rotation: the elevator lifts the nose once there is speed; let go, the nose wheel comes back down
      const auth = clamp(q / (0.5 * 1.225 * 72 * 72), 0, 1);
      const liftFrac = clamp(L / W, 0, 1);
      let rate = s.stick > 0 ? s.stick * 3.5 * auth : s.stick * 2 * auth;
      rate -= (1 + 2 * (1 - liftFrac)) * (1 - clamp(s.stick, 0, 1));
      s.theta = clamp(s.theta + rate * dt, 0, 16);
      s.alpha = s.theta;
      if (s.theta > sp.tail && !s.tail) { s.tail = true; say('TAIL STRIKE', 'red', 5000); speak('tail strike'); }
      if (s.theta < sp.tail - 2) s.tail = false;
      const N = Math.max(0, W - L);
      const fric = (0.015 + 0.4 * s.brake) * N;
      let a = (T - D) / m;
      if (V > 0.05) a -= fric / m;
      else if (Math.abs(T - D) < fric) a = 0;
      s.V = Math.max(0, V + a * dt);
      // nose wheel steering: up to 60° when slow, a few degrees at speed (the rudder pedals)
      const steerIn = Math.abs(s.rud) > Math.abs(s.roll) ? s.rud : s.roll;
      const most = 60 + (6 - 60) * clamp((V - 5) / 30, 0, 1);
      psiRate = ((s.V / sp.wheelbase) * Math.tan(steerIn * most * DEG)) / DEG;
      if (L > W && s.V > 50) {
        s.onGround = false; s.landed = false; s.gamma = 0.002; s.liftAt = performance.now();
      }
    }
    s.psi = wrap360(s.psi + psiRate * dt);
    sway(dt, psiRate);
    s.h += s.V * Math.sin(s.gamma) * dt;
    const run = s.V * Math.cos(s.gamma) * dt;
    s.lat += (run * Math.cos(s.psi * DEG)) / R_E / DEG;
    s.lon += (run * Math.sin(s.psi * DEG)) / (R_E * Math.cos(s.lat * DEG)) / DEG;
    if (!s.onGround && s.h <= s.groundH) touchdown();
    if (s.onGround) s.h = s.groundH;
  }

  // On its legs the aircraft sways on the shock absorbers (drawn only: the physics keep the wheels on the runway):
  // braking (or reversing) it tips forward and the nose leg is pushed in (view3d oleo()), accelerating it sits back, turning it leans to the
  // outside; damped springs, so it rocks back once it stops or the brakes come off. Degrees.
  function sway(dt, psiRate) {
    const w = s.sway;
    const acc = s.vPrev == null || dt <= 0 ? 0 : (s.V - s.vPrev) / dt;
    s.vPrev = s.V;
    w.acc = (w.acc || 0) + (acc - (w.acc || 0)) * (1 - Math.exp(-dt / 0.15));
    const lat = s.V * psiRate * DEG; // m/s² towards the inside of the turn
    const pT = s.onGround ? clamp(w.acc * 0.2, -0.8, 0.5) : 0; // (nose up while it speeds up)
    const rT = s.onGround ? clamp(-lat * 0.3, -1, 1) : 0;
    const k = (2 * Math.PI * 0.7) ** 2, c = 2 * 0.3 * 2 * Math.PI * 0.7;
    w.pv += (k * (pT - w.p) - c * w.pv) * dt; w.p += w.pv * dt;
    w.rv += (k * (rT - w.r) - c * w.rv) * dt; w.r += w.rv * dt;
  }

  function touchdown() {
    const vs = s.V * Math.sin(s.gamma);
    const fpm = vs / FT * 60;
    s.h = s.groundH;
    s.onGround = true;
    s.gamma = 0;
    let crash = null;
    if (s.gear < 0.99) crash = s.gear < 0.1 ? 'Gear-up landing' : 'The gear was not down and locked';
    else if (fpm < -1100) crash = `Hit the ground at ${Math.round(-fpm)} ft/min`;
    else if (Math.abs(s.phi) > 11) crash = 'A wing tip and an engine hit the ground';
    else if (s.theta < -2.5) crash = 'Nose wheel first: the nose gear collapsed';
    else if (s.V > 230 * KT) crash = 'Far too fast for the tyres';
    if (crash) {
      s.crashed = crash; s.V = 0; s.lever = 0; s.n1 = [IDLE_N1, IDLE_N1];
      speak('crash');
      return;
    }
    s.landed = true;
    const r = -fpm;
    const rating = r < 120 ? 'butter' : r < 300 ? 'smooth' : r < 600 ? 'firm' : 'HARD landing';
    s.touch = { fpm: Math.round(fpm), rating, at: performance.now(), on: onRunway(), kt: Math.round(ias()) };
    if (s.theta > s.spec.tail) { s.tail = true; say('TAIL STRIKE', 'red', 5000); }
  }

  // ---------- warnings and callouts ----------
  function warnings() {
    const w = [];
    const a = agl(), vs = vsFpm(), spd = ias();
    const M = s.V / atmo(s.h).a;
    if (s.onGround) {
      if (s.lever >= 0.86 && !s.landed && s.V < 80 * KT) {
        if (s.conf === 0) w.push(['CONFIG: FLAPS NOT IN T.O. CONFIG', 'red']);
        if (s.sb > 0) w.push(['CONFIG: SPEED BRAKES NOT RETRACTED', 'red']);
        if (s.parking) w.push(['CONFIG: PARK BRAKE ON', 'red']);
      }
      if (s.V > 40 * KT && !onRunway()) w.push(['OFF THE RUNWAY', 'red']);
    } else {
      if (spd > VMO + 4 || M > MMO + 0.006) w.push([s.lever > 0.87 ? 'OVERSPEED: thrust back to CL (2)' : 'OVERSPEED', 'red']);
      // after take-off: the levers come back to CL, where the autothrust takes over
      if (s.lever > 0.87 && !s.afloor && s.athr && a > 1200 && !s.landed) {
        w.push(['LVR CLB: thrust levers to CL (2)', 'amber']);
        if (!s.lvrClb) { s.lvrClb = true; speak('thrust levers climb'); }
      } else if (s.lever <= 0.87) s.lvrClb = false;
      if (spd > CONF[s.conf].vfe + 4 && s.conf > 0) w.push([`FLAP SPEED (VFE ${CONF[s.conf].vfe} kt)`, 'red']);
      if (s.gear > 0.05 && spd > VLE + 4) w.push(['GEAR SPEED (VLE 250 kt)', 'red']);
      if (s.alpha > s.aProt - 0.5) w.push(['ALPHA PROT', 'amber']);
      if (s.afloor) w.push(['A.FLOOR — TOGA LOCK (any throttle key)', 'amber']);
      const sinking = vs < 0 ? a / (-vs / 60) : Infinity; // seconds to the ground
      const landing = s.gear > 0.99 && s.conf >= 3;
      if (a < 2500 && sinking < 9 && !landing) w.push(['PULL UP', 'red']);
      else if (a < 2500 && vs < -Math.max(1500, 1000 + a * 1.2)) w.push(['SINK RATE', 'red']);
      if (a < 500 && s.gear < 0.99 && vs < 0) w.push(['TOO LOW — GEAR', 'red']);
      else if (a < 245 && s.conf < 3 && vs < 0) w.push(['TOO LOW — FLAPS', 'red']);
      if (s.gearDown !== (s.gear > 0.99) && s.gear > 0 && s.gear < 1) w.push(['GEAR IN TRANSIT', 'amber']);
    }
    // radio altitude callouts on the way down
    if (!s.onGround && FG.sound && FG.sound.on) {
      const prev = s.prevAgl;
      if (prev != null && vs < -100) {
        for (const h of [2500, 1000, 500, 100, 50, 40, 30, 20, 10]) {
          if (prev > h && a <= h && !s.calls[h]) {
            s.calls[h] = true;
            if (h === 20 && s.lever > 0.02) speak('retard');
            else speak(h === 2500 ? 'twenty five hundred' : h === 1000 ? 'one thousand' : h === 500 ? 'five hundred' : h === 100 ? 'one hundred' : String(h));
          }
        }
      }
      for (const h of Object.keys(s.calls)) if (a > Number(h) + 150) delete s.calls[h];
    }
    s.prevAgl = s.onGround ? 0 : a;
    return w;
  }

  // ---------- each frame (view3d calls it from its render loop) ----------
  function step(dtAll) {
    if (!s.active) return;
    const now = performance.now();
    if (s.loading) {
      if (now - s.startAt > 10000) s.loading = false;
      draw([]);
      return;
    }
    // the ground under the plane, as the 3D map draws it (FG.flat.heightsAt, asked a few times a second: the map's
    // own terrain reads 0 m where its tiles haven't come yet), smoothed
    if (FG.flat && !s.ghBusy && now - (s.ghAt || 0) > 150) {
      s.ghBusy = true; s.ghAt = now;
      const at = [s.lat, s.lon];
      FG.flat.heightsAt([at], 12).then(([h]) => { if (h != null && isFinite(h)) { s.ghReal = h; s.ghReal0 = at; } }, () => {}).finally(() => { s.ghBusy = false; });
    }
    const gh = s.ghReal != null ? s.ghReal : groundAt(s.lat, s.lon);
    if (gh != null) {
      if (Math.abs(gh - s.groundH) > 60 && !s.onGround) s.groundH = gh;
      else s.groundH += (gh - s.groundH) * (1 - Math.exp(-dtAll / 0.25));
    }
    if (!s.paused && !s.menu && !s.crashed) {
      inputs(dtAll);
      let left = Math.min(dtAll, 0.25);
      while (left > 1e-6) { const dt = Math.min(0.02, left); physics(dt); left -= dt; if (s.crashed) break; }
    }
    draw(s.crashed ? [] : warnings());
  }

  // The pose view3d draws: degrees, metres; altM: the wheels' height above the ground; st: as G.flightState gives,
  // for the parts of the 3D view that read it (lights, wing bending, tyre smoke).
  function pose() {
    const a = Math.max(0, s.h - s.groundH);
    const vs = s.V * Math.sin(s.gamma);
    const phase = s.onGround ? (s.V < 30 * KT ? 'taxi-out' : s.landed ? 'landing' : 'takeoff')
      : a < 900 && vs < -1 ? 'approach' : vs > 2 ? 'climb' : vs < -2 ? 'descent' : 'cruise';
    const kmh = s.V * 3.6;
    return {
      lat: s.lat, lon: s.lon, altM: a, altMSL: s.h, heading: wrap360(s.psi + (s.onGround ? 0 : s.alpha * Math.sin(s.phi * DEG))), bank: s.phi + s.sway.r, pitch: s.theta + s.sway.p, flying: true,
      st: { phase, speedKmh: kmh, altFt: s.h / FT, fieldFt: s.groundH / FT, ground: s.onGround, windKt: 0, windFrom: 0, gusty: false, airFrac: 0 },
      pilot: { gear: s.gear, flap: confAt(s.flapPos).flap, ail: s.roll, elev: s.onGround ? s.stick : s.stick * 0.7, rud: s.onGround ? s.rud : s.rud, rev: s.rev, n1: (s.n1[0] + s.n1[1]) / 2, gamma: s.gamma / DEG, vs },
    };
  }

  // ---------- instruments ----------
  let hud, cv, ctx;
  function showHud(on) {
    if (on && !hud) {
      hud = document.createElement('div');
      hud.id = 'pilot-hud';
      hud.innerHTML = `<canvas></canvas>
        <div class="pl-bar"><button data-pl="cam" title="Camera (C)">🎥 Camera</button><button data-pl="help" title="Keys (H)">⌨ Keys</button><button data-pl="exit" title="Menu (Esc)">☰ Menu</button></div>`;
      document.body.appendChild(hud);
      cv = hud.querySelector('canvas');
      ctx = cv.getContext('2d');
      hud.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pl]');
        if (!b) return;
        if (b.dataset.pl === 'exit') showMenu(!s.menu);
        if (b.dataset.pl === 'help') s.help = !s.help;
        if (b.dataset.pl === 'cam') FG.view3d.pilotCam(s.cam = CAMS[(CAMS.indexOf(s.cam) + 1) % CAMS.length]);
        b.blur();
      });
    }
    if (hud) hud.hidden = !on;
    document.body.classList.toggle('piloting', on);
  }

  const HELP = [
    ['↑ ↓  /  W S', 'nose down / up (stick: pitch rate, holds the path)'],
    ['← →  /  A D', 'roll (bank holds); steer on the ground'],
    ['Q E', 'rudder / nose wheel'],
    ['PgUp PgDn  + −', 'thrust levers (on the ground, − past idle = reverse)'],
    ['1 2 3 4', 'IDLE · CL · FLX/MCT · TOGA'],
    ['2 = CL', 'autothrust: holds the speed (magenta, or [ ] to pick one, \\ managed)'],
    ['T', 'autothrust off / on (off: the levers set the thrust)'],
    ['R', 'full reverse / stow (on the ground)'],
    ['G', 'landing gear'],
    ['F  /  Shift+F', 'flaps one notch down / up'],
    ['X  /  Shift+X', 'speed brakes · arm ground spoilers'],
    ['Space  B', 'wheel brakes (hold)    K: parking brake'],
    ['C  V  N', 'camera: next · chase · wing'],
    ['P   Esc', 'pause · menu (resume, start again, leave)'],
  ];

  function draw(warn) {
    if (!hud || hud.hidden) return;
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth, H = window.innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (s.loading) { banner(W / 2, H / 2, 'Loading the ground…', '#fff', 22); return; }
    const k = Math.min(1, W / 900, H / 620);
    if (s.cam === 'cockpit') headUp(W, H);
    // PFD bottom left, engines and config bottom right
    ctx.save(); ctx.translate(12, H - 12 - 270 * k); ctx.scale(k, k); pfd(); ctx.restore();
    ctx.save(); ctx.translate(W - 12 - 250 * k, H - 12 - 270 * k); ctx.scale(k, k); ecam(); ctx.restore();
    // warnings, messages
    const now = performance.now();
    s.msgs = s.msgs.filter((m) => m.until > now);
    let y = 70;
    const flash = Math.floor(now / 400) % 2 === 0;
    for (const [t, lvl] of warn) {
      if (lvl === 'red' && !flash && /PULL UP|SINK|TOO LOW|OVERSPEED/.test(t)) { y += 30; continue; }
      banner(W / 2, y, t, lvl === 'red' ? '#ff3b30' : '#ffb000', 20); y += 30;
    }
    for (const m of s.msgs) { banner(W / 2, y, m.text, m.level === 'red' ? '#ff3b30' : m.level === 'amber' ? '#ffb000' : '#e8f0ff', 15); y += 26; }
    if (s.touch && now - s.touch.at < 9000) {
      const t = s.touch;
      const col = t.rating === 'butter' || t.rating === 'smooth' ? '#30d158' : t.rating === 'firm' ? '#ffd60a' : '#ff453a';
      banner(W / 2, H * 0.32, `Touchdown ${t.fpm} ft/min · ${t.kt} kt · ${t.rating}${t.on ? '' : ' · not on a runway!'}`, col, 22);
    }
    if (s.crashed) {
      banner(W / 2, H * 0.4, `💥 CRASH — ${s.crashed}`, '#ff3b30', 28);
      banner(W / 2, H * 0.4 + 44, 'Enter: try again · Esc: leave', '#fff', 16);
    }
    if (s.paused) banner(W / 2, H * 0.45, 'PAUSED (P)', '#fff', 26);
    if (s.help) helpBox(W, H);
  }
  function banner(x, y, text, color, size) {
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + size * 1.2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(x - w / 2, y - size * 0.95, w, size * 1.6, 6); ctx.fill();
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y - size * 0.15);
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function helpBox(W, H) {
    const w = 470, h = 26 + HELP.length * 22;
    const x = W / 2 - w / 2, y = Math.max(110, H / 2 - h / 2);
    ctx.fillStyle = 'rgba(10,14,22,0.85)'; roundRect(x, y, w, h, 10); ctx.fill();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    HELP.forEach(([key, what], i) => {
      ctx.font = '600 13px ui-monospace, monospace'; ctx.fillStyle = '#7fd4ff'; ctx.fillText(key, x + 16, y + 22 + i * 22);
      ctx.font = '13px system-ui, sans-serif'; ctx.fillStyle = '#e8eef8'; ctx.fillText(what, x + 160, y + 22 + i * 22);
    });
  }

  // Primary flight display: attitude, speed tape, altitude tape, vertical speed, heading, ILS.
  function pfd() {
    const c = ctx;
    c.fillStyle = 'rgba(8,10,14,0.82)'; roundRect(0, 0, 400, 270, 10); c.fill();
    c.textBaseline = 'middle';
    // mode line (thrust)
    c.font = '600 13px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillStyle = s.afloor ? '#ffb000' : '#30d158';
    const dn = detentName(s.lever);
    if (athrOn()) c.fillText(s.spdSel != null ? 'SPEED SEL' : 'SPEED', 100, 16);
    else c.fillText(s.afloor ? 'A.FLOOR' : s.lever < 0 ? 'REV' : dn === 'MAN THR' ? dn : `MAN ${dn}`, 100, 16);
    if (!s.onGround && s.lever > 0.87 && s.athr && !s.afloor && Math.floor(performance.now() / 500) % 2) { c.fillStyle = '#ffb000'; c.font = '600 11px system-ui, sans-serif'; c.fillText('LVR CLB', 100, 30); c.font = '600 13px system-ui, sans-serif'; }
    c.fillStyle = s.athr ? '#e8eef8' : '#ffb000'; c.font = '600 10px system-ui, sans-serif'; c.fillText(s.athr ? (athrOn() ? 'A/THR' : 'A/THR ARM') : 'A/THR OFF', 300, 30); c.font = '600 13px system-ui, sans-serif';
    c.fillStyle = '#e8eef8'; c.fillText(`CONF ${CONF[s.conf].name}`, 200, 16);
    c.fillStyle = '#30d158'; c.fillText('NORMAL LAW', 300, 16);
    // attitude
    const ax = 200, ay = 128, r = 82, ppd = 4;
    c.save();
    c.beginPath(); c.rect(ax - r, ay - r, 2 * r, 2 * r); c.clip();
    c.translate(ax, ay); c.rotate(-s.phi * DEG);
    const hy = s.theta * ppd;
    c.fillStyle = '#2f7dd1'; c.fillRect(-300, -600 + hy, 600, 600);
    c.fillStyle = '#8a5a2b'; c.fillRect(-300, hy, 600, 600);
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(-300, hy); c.lineTo(300, hy); c.stroke();
    c.lineWidth = 1.2; c.font = '10px system-ui'; c.fillStyle = '#fff'; c.textAlign = 'left';
    for (let p = -30; p <= 30; p += 2.5) {
      if (!p) continue;
      const y = hy - p * ppd; const w = p % 10 === 0 ? 34 : p % 5 === 0 ? 20 : 8;
      c.beginPath(); c.moveTo(-w, y); c.lineTo(w, y); c.stroke();
      if (p % 10 === 0) c.fillText(String(Math.abs(p)), w + 4, y);
    }
    c.restore();
    // bank scale and pointer
    c.strokeStyle = '#fff'; c.lineWidth = 1.2;
    for (const b of [-45, -30, -20, -10, 0, 10, 20, 30, 45]) {
      const a = (b - 90) * DEG; const l = b % 30 === 0 ? 10 : 6;
      c.beginPath(); c.moveTo(ax + Math.cos(a) * (r - 2), ay + Math.sin(a) * (r - 2)); c.lineTo(ax + Math.cos(a) * (r - 2 - l), ay + Math.sin(a) * (r - 2 - l)); c.stroke();
    }
    const pa = (-s.phi - 90) * DEG;
    c.fillStyle = Math.abs(s.phi) > 33 ? '#ffb000' : '#ffd60a';
    c.beginPath(); c.moveTo(ax + Math.cos(pa) * (r - 14), ay + Math.sin(pa) * (r - 14));
    c.lineTo(ax + Math.cos(pa + 0.06) * (r - 24), ay + Math.sin(pa + 0.06) * (r - 24));
    c.lineTo(ax + Math.cos(pa - 0.06) * (r - 24), ay + Math.sin(pa - 0.06) * (r - 24)); c.fill();
    // aircraft symbol
    c.strokeStyle = '#000'; c.fillStyle = '#ffd60a'; c.lineWidth = 1;
    c.fillRect(ax - 52, ay - 2, 30, 5); c.fillRect(ax + 22, ay - 2, 30, 5); c.fillRect(ax - 3, ay - 3, 6, 6);
    // flight path vector (bird)
    const fy = ay + s.alpha * ppd; // (straight below the aircraft symbol: no sideslip)
    if (!s.onGround) { c.strokeStyle = '#30d158'; c.lineWidth = 2; c.beginPath(); c.arc(ax, fy, 5, 0, 7); c.moveTo(ax - 13, fy); c.lineTo(ax - 5, fy); c.moveTo(ax + 5, fy); c.lineTo(ax + 13, fy); c.moveTo(ax, fy - 5); c.lineTo(ax, fy - 10); c.stroke(); }
    // ILS
    const l = ils();
    if (l) {
      c.fillStyle = '#ff6ef2'; c.strokeStyle = '#fff';
      for (const d of [-2, -1, 1, 2]) { c.beginPath(); c.arc(ax + d * 30, ay + r + 10, 3, 0, 7); c.stroke(); }
      const lx = ax + clamp(-l.loc / 0.8, -2.3, 2.3) * 30;
      c.beginPath(); c.moveTo(lx - 7, ay + r + 10); c.lineTo(lx, ay + r + 4); c.lineTo(lx + 7, ay + r + 10); c.lineTo(lx, ay + r + 16); c.fill();
      if (l.gs != null) {
        for (const d of [-2, -1, 1, 2]) { c.beginPath(); c.arc(ax + r + 10, ay + d * 30, 3, 0, 7); c.stroke(); }
        const gy = ay + clamp(l.gs / 0.35, -2.3, 2.3) * 30;
        c.beginPath(); c.moveTo(ax + r + 10, gy - 7); c.lineTo(ax + r + 4, gy); c.lineTo(ax + r + 10, gy + 7); c.lineTo(ax + r + 16, gy); c.fill();
      }
      c.font = '11px system-ui'; c.textAlign = 'left'; c.fillStyle = '#ff6ef2';
      c.textAlign = 'center';
      c.fillText(`ILS ${l.e.code} ${l.e.name}  ${(l.d / 1852).toFixed(1)} NM`, ax, 33);
    }
    // radio altitude
    const a = agl();
    if (!s.onGround && a < 2500) { c.font = '600 15px system-ui'; c.textAlign = 'center'; c.fillStyle = a < 400 ? '#ffb000' : '#30d158'; c.fillText(String(Math.round(a / (a < 50 ? 1 : 10)) * (a < 50 ? 1 : 10)), ax, ay + 60); }
    // speed tape
    const spd = ias();
    tape(10, 40, 62, 176, spd, 3, 10, 20, (vv) => String(vv), '#fff');
    const top = Math.min(VMO, CONF[s.conf].vfe, s.gear > 0.05 ? VLE : 999);
    // red band above the max speed
    const yTop = 128 - (top - spd) * 3;
    if (yTop > 40) { c.fillStyle = '#ff3b30'; c.fillRect(64, 40, 6, Math.min(176, yTop - 40)); }
    // the alpha protection band (amber) from the speed it would take at that angle
    if (!s.onGround) {
      const vProt = spd * Math.sqrt(Math.max(0.05, (CL_BASE + confAt(s.flapPos).cl0 + CL_A * s.alpha)) / Math.max(0.05, CL_BASE + confAt(s.flapPos).cl0 + CL_A * s.aProt));
      const yP = 128 + (spd - vProt) * 3;
      if (yP < 216) { c.fillStyle = '#ffb000'; c.fillRect(64, Math.max(40, yP), 6, 216 - Math.max(40, yP)); }
    }
    // speed trend
    if (s.trend != null) {
      const ty = 128 - s.trend * 10 * 3;
      c.strokeStyle = '#ffd60a'; c.lineWidth = 2; c.beginPath(); c.moveTo(74, 128); c.lineTo(74, clamp(ty, 40, 216)); c.stroke();
    }
    // the speed the autothrust flies: magenta managed, cyan picked ([ ])
    { const tg = spdTarget(); const y = clamp(128 - (tg.kt - spd) * 3, 40, 216);
      c.fillStyle = tg.sel ? '#5ac8fa' : '#ff6ef2'; c.beginPath(); c.moveTo(64, y); c.lineTo(76, y - 6); c.lineTo(76, y + 6); c.fill();
      if (Math.abs(tg.kt - spd) > 26) { c.font = '600 11px system-ui'; c.textAlign = 'center'; c.fillText(String(tg.kt), 41, tg.kt > spd ? 33 : 223); } }
    box(10, 128, 62, String(Math.round(spd)), '#ffd60a');
    c.font = '11px system-ui'; c.fillStyle = '#9ab'; c.textAlign = 'center';
    const M = s.V / atmo(s.h).a;
    c.fillText(M > 0.45 ? `M ${M.toFixed(2).slice(1)}` : `GS ${Math.round(s.V / KT)}`, 41, 230);
    // altitude tape
    const alt = s.h / FT;
    tape(306, 40, 62, 176, alt, 0.18, 100, 500, (vv) => String(Math.round(vv / 100)).padStart(3, '0'), '#fff');
    // the ground on the altitude tape
    const yG = 128 + (alt - s.groundH / FT) * 0.18;
    if (yG < 216) { c.fillStyle = 'rgba(255,59,48,0.8)'; c.fillRect(306, Math.max(40, yG), 62, 216 - Math.max(40, yG)); }
    box(306, 128, 62, String(Math.round(alt / 10) * 10), '#30d158');
    // vertical speed
    const vs = vsFpm();
    c.strokeStyle = '#555'; c.lineWidth = 1; c.beginPath(); c.moveTo(380, 50); c.lineTo(380, 206); c.stroke();
    const vy = 128 - clamp(Math.sign(vs) * Math.sqrt(Math.abs(vs) / 6000), -1, 1) * 78;
    c.strokeStyle = Math.abs(vs) > 6000 ? '#ffb000' : '#30d158'; c.lineWidth = 3; c.beginPath(); c.moveTo(372, 128); c.lineTo(390, vy); c.stroke();
    c.font = '11px system-ui'; c.fillStyle = '#30d158'; c.textAlign = 'center';
    if (Math.abs(vs) > 200) c.fillText(String(Math.round(Math.abs(vs) / 100)), 384, vs > 0 ? 42 : 216);
    // heading
    c.save(); c.beginPath(); c.rect(100, 232, 200, 32); c.clip();
    c.strokeStyle = '#fff'; c.fillStyle = '#fff'; c.font = '11px system-ui'; c.lineWidth = 1;
    for (let d = Math.floor(s.psi / 5) * 5 - 30; d <= s.psi + 30; d += 5) {
      const x = 200 + (d - s.psi) * 3.3;
      c.beginPath(); c.moveTo(x, 236); c.lineTo(x, d % 10 === 0 ? 244 : 240); c.stroke();
      if (d % 10 === 0) c.fillText(String(wrap360(d) / 10 | 0), x, 254);
    }
    c.restore();
    c.fillStyle = '#ffd60a'; c.fillRect(199, 230, 2, 16);
    c.font = '11px system-ui'; c.fillStyle = '#9ab'; c.fillText(`HDG ${String(Math.round(s.psi) % 360).padStart(3, '0')}`, 350, 250);
  }
  function tape(x, y, w, h, val, ppu, tick, label, fmt, color) {
    const c = ctx;
    c.save(); c.fillStyle = 'rgba(60,64,72,0.7)'; c.fillRect(x, y, w, h);
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1; c.font = '11px system-ui'; c.textAlign = 'center';
    const span = h / 2 / ppu;
    for (let u = Math.ceil((val - span) / tick) * tick; u <= val + span; u += tick) {
      if (u < 0 && ppu > 1) continue;
      const yy = y + h / 2 - (u - val) * ppu;
      c.beginPath(); c.moveTo(x + w - 8, yy); c.lineTo(x + w, yy); c.stroke();
      if (Math.abs(u % label) < 1e-6) c.fillText(fmt(u), x + w / 2 - 4, yy);
    }
    c.restore();
  }
  function box(x, y, w, text, color) {
    const c = ctx;
    c.fillStyle = '#000'; c.fillRect(x + 2, y - 11, w - 4, 22);
    c.strokeStyle = color; c.lineWidth = 1.5; c.strokeRect(x + 2, y - 11, w - 4, 22);
    c.fillStyle = color; c.font = '600 14px ui-monospace, monospace'; c.textAlign = 'center'; c.fillText(text, x + w / 2, y + 1);
  }

  // Engines (N1), thrust lever, flaps, gear, spoilers, brakes.
  function ecam() {
    const c = ctx;
    c.fillStyle = 'rgba(8,10,14,0.82)'; roundRect(0, 0, 250, 270, 10); c.fill();
    c.textBaseline = 'middle';
    for (let i = 0; i < 2; i++) {
      const cx = 62 + i * 126, cy = 52, r = 34;
      c.lineWidth = 3; c.strokeStyle = '#555';
      c.beginPath(); c.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25); c.stroke();
      const f = clamp(s.n1[i] / 110, 0, 1);
      c.strokeStyle = s.rev > 0.05 ? '#30d158' : '#fff'; c.lineWidth = 4;
      c.beginPath(); c.arc(cx, cy, r, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * f)); c.stroke();
      // the lever's target (cyan)
      const tl = s.lever < 0 ? IDLE_N1 : IDLE_N1 + 79 * s.lever;
      const ta = Math.PI * (0.75 + 1.5 * tl / 110);
      c.fillStyle = '#5ac8fa'; c.beginPath(); c.arc(cx + Math.cos(ta) * (r + 6), cy + Math.sin(ta) * (r + 6), 3, 0, 7); c.fill();
      c.font = '600 16px ui-monospace, monospace'; c.fillStyle = '#30d158'; c.textAlign = 'center';
      c.fillText(s.n1[i].toFixed(1), cx, cy + 4);
      c.font = '10px system-ui'; c.fillStyle = '#9ab'; c.fillText(`N1 %  ENG ${i + 1}`, cx, cy + 32);
      if (s.rev > 0.05) { c.fillStyle = s.rev > 0.95 ? '#30d158' : '#ffb000'; c.font = '600 12px system-ui'; c.fillText('REV', cx, cy - 16); }
    }
    // thrust lever
    c.font = '600 13px system-ui'; c.textAlign = 'left'; c.fillStyle = '#5ac8fa';
    c.fillText(`THR LVR  ${detentName(s.lever)}  ${s.lever < 0 ? '' : Math.round(s.lever * 100) + '%'}`, 14, 106);
    // flaps
    c.fillStyle = '#e8eef8'; c.fillText('FLAPS', 14, 134);
    for (let i = 0; i < CONF.length; i++) {
      const x = 70 + i * 28;
      c.fillStyle = i === s.conf ? '#5ac8fa' : '#556'; c.font = (i === s.conf ? '600 ' : '') + '11px system-ui'; c.textAlign = 'center';
      c.fillText(CONF[i].name, x, 134);
    }
    c.fillStyle = '#30d158'; c.fillRect(56, 144, clamp(s.flapPos / (CONF.length - 1), 0, 1) * 180, 4);
    c.strokeStyle = '#556'; c.strokeRect(56, 144, 180, 4);
    // gear
    c.textAlign = 'left'; c.font = '600 13px system-ui'; c.fillStyle = '#e8eef8'; c.fillText('GEAR', 14, 172);
    const locked = s.gear > 0.99, moving = s.gear > 0.01 && s.gear < 0.99;
    for (let i = 0; i < 3; i++) {
      const x = 70 + i * 52;
      c.strokeStyle = locked ? '#30d158' : moving ? '#ff3b30' : '#556'; c.lineWidth = 2;
      c.strokeRect(x, 162, 42, 20);
      c.fillStyle = locked ? '#30d158' : '#ff3b30'; c.font = '600 11px system-ui'; c.textAlign = 'center';
      if (locked) { c.beginPath(); c.moveTo(x + 13, 166); c.lineTo(x + 29, 166); c.lineTo(x + 21, 178); c.fill(); }
      else if (moving) c.fillText('UNLK', x + 21, 172);
    }
    c.textAlign = 'left'; c.font = '11px system-ui'; c.fillStyle = '#9ab';
    c.fillText(`lever ${s.gearDown ? 'DOWN' : 'UP'}`, 14, 190);
    // spoilers, brakes
    c.font = '600 12px system-ui';
    const spl = Math.max(s.gs, s.sb);
    c.fillStyle = spl > 0.05 ? '#30d158' : s.armed ? '#5ac8fa' : '#556';
    c.fillText(spl > 0.05 ? `SPD BRK ${Math.round(spl * 100)}%` : s.armed ? 'GND SPLR ARMED' : 'SPD BRK RET', 14, 212);
    c.fillStyle = s.parking ? '#ffb000' : s.brake > 0.05 ? '#30d158' : '#556';
    c.fillText(s.parking ? 'PARK BRK ON' : `BRAKES ${Math.round(s.brake * 100)}%`, 140, 212);
    c.font = '11px system-ui'; c.fillStyle = '#9ab';
    c.fillText(`GW ${Math.round(s.mass / 1000)} t   GS ${Math.round(s.V * Math.cos(s.gamma) / KT)} kt   G ${(s.load || 1).toFixed(2)}`, 14, 236);
    c.fillText(`${s.type}   C camera · H keys · Esc menu`, 14, 256);
  }

  // Cockpit view: a head-up display in green, lined up with the camera (which looks LOOK_DOWN° under the nose).
  function headUp(W, H) {
    const c = ctx;
    const fov = FG.view3d && FG.view3d.fov ? FG.view3d.fov() : 36.87;
    const ppd = H / fov;
    const bx = W / 2, by = H / 2 - LOOK_DOWN * ppd; // where the nose points
    c.save();
    c.strokeStyle = 'rgba(70,255,120,0.9)'; c.fillStyle = 'rgba(70,255,120,0.95)'; c.lineWidth = 1.6;
    c.font = '600 14px ui-monospace, monospace'; c.textBaseline = 'middle';
    c.save();
    c.translate(bx, by); c.rotate(-s.phi * DEG);
    c.beginPath(); c.rect(-W * 0.3, -H * 0.38, W * 0.6, H * 0.76); c.clip();
    const hy = s.theta * ppd;
    c.beginPath(); c.moveTo(-W, hy); c.lineTo(-60, hy); c.moveTo(60, hy); c.lineTo(W, hy); c.stroke();
    for (let p = -20; p <= 30; p += 5) {
      if (!p) continue;
      const y = hy - p * ppd;
      c.setLineDash(p < 0 ? [8, 6] : []);
      c.beginPath(); c.moveTo(-110, y); c.lineTo(-45, y); c.moveTo(45, y); c.lineTo(110, y); c.stroke();
      c.textAlign = 'left'; c.fillText(String(p), 116, y);
    }
    c.setLineDash([]);
    c.restore();
    // boresight and flight path marker
    c.beginPath(); c.moveTo(bx - 18, by); c.lineTo(bx - 6, by); c.lineTo(bx, by + 6); c.lineTo(bx + 6, by); c.lineTo(bx + 18, by); c.stroke();
    if (!s.onGround) {
      const fy = by + s.alpha * ppd;
      c.beginPath(); c.arc(bx, fy, 7, 0, 7); c.moveTo(bx - 22, fy); c.lineTo(bx - 7, fy); c.moveTo(bx + 7, fy); c.lineTo(bx + 22, fy); c.moveTo(bx, fy - 7); c.lineTo(bx, fy - 15); c.stroke();
    }
    // speed and altitude
    c.textAlign = 'right'; c.fillText(`${Math.round(ias())} KT`, bx - W * 0.2, by);
    c.textAlign = 'left'; c.fillText(`${Math.round(s.h / FT / 10) * 10} FT`, bx + W * 0.2, by);
    c.fillText(`${Math.round(vsFpm() / 50) * 50} FPM`, bx + W * 0.2, by + 22);
    c.textAlign = 'center'; c.fillText(String(Math.round(s.psi) % 360).padStart(3, '0'), bx, by - H * 0.36);
    c.restore();
  }

  // speed trend: the acceleration over the last moments (kt per second)
  let lastV = null, lastT = 0;
  setInterval(() => {
    if (!s.active) return;
    const now = performance.now();
    if (lastV != null) s.trend = (ias() - lastV) / ((now - lastT) / 1000) * 0.6 + (s.trend || 0) * 0.4;
    lastV = ias(); lastT = now;
  }, 250);

  // ---------- start dialog ----------
  function defaultAirport() {
    const ui = FG.ui || {};
    if (ui.selectedAirport && G.airportByCode[ui.selectedAirport]) return ui.selectedAirport;
    const p = ui.selectedPlane && G.plane(ui.selectedPlane);
    if (p) return p.status === 'flying' && p.flight ? p.flight.from : p.location;
    return G.state.home || 'ZRH';
  }
  function bestEnd(ends, code) {
    const a = G.airportByCode[code];
    let wind = null;
    try { wind = G.windAt(a.lat, a.lon, G.state.time, 0); } catch (e) { /* */ }
    const longest = Math.max(...ends.map((e) => e.len));
    const score = (e) => e.len / longest * 2 + (wind && wind.kt > 3 ? Math.cos((wind.from - e.course) * DEG) : 0);
    return ends.slice().sort((x, y) => score(y) - score(x))[0];
  }
  // The Esc menu: the flight waits behind it.
  function showMenu(on) {
    s.menu = on;
    s.keys.clear();
    let el = document.getElementById('pilot-menu');
    if (!on) { if (el) el.remove(); return; }
    if (el) return;
    el = document.createElement('div');
    el.id = 'pilot-menu';
    el.innerHTML = `<div class="ps-card" role="dialog" aria-modal="true">
      <h2>Flight paused</h2>
      <div class="pm-buttons">
        <button class="primary" data-pm="resume">▶ Resume <kbd>Esc</kbd></button>
        <button data-pm="restart">↺ Start this flight again <kbd>R</kbd></button>
        <button data-pm="leave">✕ Leave the cockpit <kbd>Q</kbd></button>
      </div></div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pm]');
      if (e.target === el || (b && b.dataset.pm === 'resume')) showMenu(false);
      else if (b && b.dataset.pm === 'restart') restart();
      else if (b && b.dataset.pm === 'leave') stop();
    });
  }
  function openDialog() {
    if (s.active) return;
    if (!FG.view3d) { toast('The 3D view is not available here.'); return; }
    let el = document.getElementById('pilot-start');
    if (el) { el.remove(); return; }
    const ui = FG.ui || {};
    const sel = ui.selectedPlane && G.plane(ui.selectedPlane);
    const mine = sel && /^A350/.test(sel.type) ? sel : null;
    el = document.createElement('div');
    el.id = 'pilot-start';
    el.innerHTML = `<div class="ps-card" role="dialog" aria-modal="true">
      <h2>✈ Fly it yourself</h2>
      <p class="ps-sub">An A350 flown by hand: throttle, flaps, gear and brakes, Airbus fly-by-wire. It flies in real time, apart from your airline.</p>
      <label>Aircraft <select id="ps-type"><option>A350-900</option><option>A350-1000</option></select></label>
      <label>Airport <input id="ps-ap" maxlength="4" spellcheck="false" autocomplete="off"></label>
      <label>Runway <select id="ps-rw"></select></label>
      <div class="ps-modes">
        <label class="check"><input type="radio" name="ps-mode" value="runway" checked> Lined up on the runway, ready for take-off</label>
        <label class="check"><input type="radio" name="ps-mode" value="final"> On final: 10 NM out, 3,000 ft, gear up</label>
        ${mine && mine.status === 'flying' ? `<label class="check"><input type="radio" name="ps-mode" value="takeover"> Take over ${mine.reg || mine.name || 'my ' + mine.type} where it is now</label>` : ''}
      </div>
      <p class="ps-err" id="ps-err"></p>
      <div class="row"><button data-ps="no">Cancel</button><button class="primary" data-ps="go">Fly</button></div>
      <p class="ps-keys">↑↓ pitch · ←→ roll · PgUp/PgDn or +/− thrust · 1-4 detents · G gear · F flaps · Space brakes · R reverse · C camera · H all keys</p>
    </div>`;
    document.body.appendChild(el);
    const ap = el.querySelector('#ps-ap'), rw = el.querySelector('#ps-rw'), err = el.querySelector('#ps-err');
    if (mine) el.querySelector('#ps-type').value = mine.type.includes('1000') ? 'A350-1000' : 'A350-900';
    let ends = [];
    const fill = () => {
      const code = ap.value.trim().toUpperCase();
      ends = G.airportByCode[code] ? runwayEnds(code).filter((e) => e.len >= 800) : [];
      const best = ends.length ? bestEnd(ends, code) : null;
      rw.innerHTML = ends.map((e, i) => `<option value="${i}"${e === best ? ' selected' : ''}>${e.name} · ${Math.round(e.len).toLocaleString()} m${e.len < 2500 ? ' (short!)' : ''}</option>`).join('');
      err.textContent = !G.airportByCode[code] ? (code ? 'No airport with that code.' : '') : ends.length ? '' : 'No runways known there.';
    };
    ap.value = defaultAirport();
    fill();
    ap.addEventListener('input', fill);
    el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') el.remove(); if (e.key === 'Enter') go(); });
    const go = () => {
      const mode = (el.querySelector('input[name="ps-mode"]:checked') || {}).value || 'runway';
      const type = el.querySelector('#ps-type').value;
      if (mode === 'takeover') {
        const t = FG.ui.time != null ? FG.ui.time : G.state.time;
        const st = G.flightState(mine, t);
        if (!st) { err.textContent = 'That plane is not in the air.'; return; }
        if (st.ground || st.phase === 'boarding' || st.phase === 'pushback' || st.phase.startsWith('taxi')) {
          err.textContent = 'It is on the ground: pick its airport and start on the runway.'; return;
        }
        el.remove();
        start({ type, mode, plane: mine, state: st });
        return;
      }
      const end = ends[Number(rw.value)];
      if (!end) { err.textContent = 'Pick an airport with a runway.'; return; }
      el.remove();
      start({ type, mode, end });
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ps]');
      if (e.target === el || (b && b.dataset.ps === 'no')) el.remove();
      else if (b && b.dataset.ps === 'go') go();
    });
    setTimeout(() => ap.select(), 0);
  }

  // P opens the dialog (in the game, not while flying: then P pauses)
  document.addEventListener('keydown', (e) => {
    if (s.active || e.ctrlKey || e.metaKey || e.altKey || e.key !== 'p' && e.key !== 'P') return;
    if (e.target.matches('input, select, textarea')) return;
    const startScreen = document.getElementById('start-screen');
    if (startScreen && !startScreen.hidden) return;
    openDialog();
  });

  FG.pilot = {
    get active() { return s.active; },
    get type() { return s.type; },
    get cam() { return s.cam; },
    get hideId() { return s.hideId; },
    get ready() { return s.active && !s.loading; },
    LOOK_DOWN,
    open: openDialog, start, stop, step, pose,
    state: s, // (for debugging)
  };
})();
