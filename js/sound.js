// Aircraft sounds, made up as they play with Web Audio (no sound files). Each engine kind has its own voice:
// - jets: the core whining up on the starter, the igniters ticking, light-off, the fan whine at idle, a burst of
//   thrust to get rolling, the roar at take-off power (and from behind the rumble, ahead of a big fan the buzz-saw),
//   climb and cruise power, quiet on the descent, spooling up again on the approach, reverse thrust after
//   touchdown, and the whine running down at the gate;
// - turboprops: two propellers buzzing a little out of tune (they beat against each other), the turbine whistle;
// - piston radials: the starter cranking, coughs as they catch, a rough idle that smooths out, the growl at full power.
// Also the APU at the gate, the tyres chirping on touchdown and the wind on the wing camera.
// Heard from where you look: the 3D camera, or a point above the 2D map's centre (higher the further out it is
// zoomed), so zoomed in on an airport you hear the planes there and zoomed out it goes quiet. The plane the camera
// follows (3D chase or wing camera, 2D follow, or the plane window's camera) is heard as from close by; the fly-by
// camera hears it pass, with the Doppler drop. Only the VOICES loudest planes play.
// Engine power follows the flight (G.flightState phases) in game time: at real time a start takes over a minute,
// fast-forwarded it is quick; above 300× it fades out, paused it is quiet, in a background tab it stops.
// Off until turned on (remembered): the 🔇/🔊 button in the top bar, M, or Settings → Sound. FG.sound.
(function () {
  const G = FG.game;
  const D = FG.data;
  const KEY = 'flightgame.sound';
  const VOICES = 4;
  const TICK = 50;      // ms between updates
  const START = 1.2;    // game minutes an engine start takes (it begins with the pushback)
  const STOP = 0.8;     // ... the engines take to run down once the plane is at the gate
  const SPOOL = 2.5;    // game seconds the engines take to follow the levers
  const REF = 40;       // metres: as loud as it gets from here in
  const IDLE = 0.21;    // jet fan speed at idle
  const SPEED_OF_SOUND = 343;
  const DEG = Math.PI / 180;

  const prefs = { on: false, volume: 0.6 }; // (off until turned on: ROADMAP)
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { /* private mode */ }
  const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ } };

  const s = { ctx: null, master: null, noise: null, wobble: null, wave: null, voices: new Map(), picked: [], tick: 0, last: 0, timer: null };

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const smooth = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const hashStr = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return (h >>> 0) / 4294967296;
  };

  // ---------- how a type sounds ----------
  // { kind: 'jet' | 'turboprop' | 'piston', size (how loud), its tones in Hz at full speed, apu }
  const profiles = {};
  function profile(type) {
    if (profiles[type]) return profiles[type];
    const ac = D.aircraft[type] || {};
    const look = (D.looks && D.looks[type]) || {};
    const eng = look.eng || 'uw2';
    const j = 0.94 + 0.12 * hashStr(type); // each type a little different
    const four = /4$/.test(eng) || eng === 'concorde';
    let pr;
    if (eng === 'radial2' || eng === 'prop3') {
      pr = { kind: 'piston', crank: 40 * j, prop: 72 * j, apu: false };
    } else if (eng === 'prop2') {
      const old = (ac.year || 2000) < 1975; // (the Dart's whistle)
      pr = { kind: 'turboprop', prop: (old ? 80 : 104) * j, whine: (old ? 2300 : 3600) * j, whineGain: old ? 2.2 : 1, apu: !old };
    } else {
      // Early jets (turbojets, low bypass) roar and scream; big modern fans hum lower.
      const old = eng === 'concorde' || ((ac.year || 2000) < 1970 && !look.bigFan);
      const fan = (look.bigFan ? 1300 : ac.category === 'widebody' ? 1700 : ac.category === 'regional' ? 3100 : 2500) * j;
      pr = { kind: 'jet', old, fan, shaft: fan / (look.bigFan ? 20 : 30), core: (old ? 5200 : 6400) * j, apu: true, afterburner: eng === 'concorde' };
    }
    pr.size = Math.min(1.25, 0.5 + Math.sqrt(ac.seats || 100) / 25) * (four ? 1.1 : 1);
    return (profiles[type] = pr);
  }

  // ---------- what the engines do ----------
  // The levers by flight phase: pw = jet fan speed (N1), turboprop or piston power; np = propeller (or piston
  // engine) speed; rev = reverse thrust. accel: 0..1, the plane is getting going on the ground (a burst of thrust).
  function levers(pr, st, accel) {
    const agl = Math.max(0, (st.altFt || 0) - (st.fieldFt || 0)) * 0.3048;
    const jet = pr.kind === 'jet';
    const pis = pr.kind === 'piston';
    const L = (jp, tp, tn, pp, pn, rev = 0) => (jet ? { pw: jp, np: 0, rev } : pis ? { pw: pp, np: pn, rev: 0 } : { pw: tp, np: tn, rev });
    switch (st.phase) {
      case 'pushback': return L(IDLE, 0.06, 0.7, 0.1, 0.26);
      case 'taxi-out': case 'taxi-in': return L(IDLE + 0.13 * accel, 0.08 + 0.14 * accel, 0.72, 0.12 + 0.18 * accel, 0.3 + 0.14 * accel);
      case 'takeoff': return L(0.93, 1, 1, 1, 1);
      case 'climb': return agl < 450 ? L(0.93, 0.95, 1, 0.95, 0.97) : L(0.87, 0.85, 0.95, 0.8, 0.88);
      case 'cruise': return L(0.8, 0.7, 0.85, 0.62, 0.75);
      case 'descent': return L(0.3, 0.2, 0.85, 0.25, 0.65);
      case 'approach':
        if (agl < 12) return L(IDLE + 0.04, 0.12, 1, 0.15, 0.5); // "retard": over the threshold, power off
        return agl > 700 ? L(0.4, 0.3, 0.9, 0.35, 0.7) : L(0.56, 0.4, 1, 0.45, 0.85); // gear and flaps out
      case 'landing': // reversers until about 60 kt
        return st.speedKmh > 110 ? L(0.72, 0.55, 1, 0.12, 0.4, 1) : L(IDLE, 0.08, 0.75, 0.12, 0.3);
      default: return L(IDLE, 0.06, 0.7, 0.1, 0.26);
    }
  }

  // Starting (u: 0..1 through the start): the starter turns the core (jets, turboprops) or cranks the engine
  // (pistons); light-off at 0.3; then up to idle.
  function startup(pr, u) {
    if (pr.kind === 'piston') {
      if (u < 0.22) return { run: 0, pw: 0, np: 0.06, crank: 1 };
      if (u < 0.4) return { run: 0.5, pw: 0.1, np: 0.06 + 0.3 * smooth(0.22, 0.4, u), crank: 1 - smooth(0.3, 0.4, u), pops: true }; // coughing
      return { run: 1, pw: 0.1, np: 0.36 - 0.1 * smooth(0.4, 0.7, u), rough: 1 - 0.7 * smooth(0.4, 1, u) };
    }
    const tp = pr.kind === 'turboprop';
    if (u < 0.3) { const k = u / 0.3; return { run: 0, pw: 0, n2: 0.25 * k, np: 0, n1: 0.03 * k, ign: u > 0.15 }; }
    const k = smooth(0.3, 1, u);
    return { run: clamp01((u - 0.3) / 0.06), n2: 0.25 + 0.35 * k, pw: tp ? 0.06 * k : 0.03 + (IDLE - 0.03) * k, np: tp ? 0.7 * k : 0, ign: u < 0.42, lit: true };
  }

  // Running down at the gate (u: 0..1 since the fuel was cut).
  function rundown(pr, u) {
    if (pr.kind === 'piston') return { run: 0, pw: 0, np: 0.26 * Math.exp(-10 * u) };
    if (pr.kind === 'turboprop') return { run: 0, pw: 0, np: 0.7 * Math.exp(-5 * u), n2: 0.6 * Math.exp(-2.5 * u) };
    return { run: 0, pw: IDLE * Math.exp(-4 * u), n2: 0.6 * Math.exp(-2.2 * u) };
  }

  // What the engines of plane p do at game time t: { run (burning fuel, 0..1), pw, np, n2 (core speed: the whine),
  // rev, apu, crank, rough, pops, ign, phase }. st: its G.flightState at t when at hand.
  function engines(p, t, st, accel = 0) {
    const pr = profile(p.type);
    const off = { run: 0, pw: 0, np: 0, n2: 0, rev: 0, apu: 0, crank: 0, rough: 0, phase: p.status };
    if (p.status === 'flying' && p.flight) {
      st = st || G.flightState(p, t);
      const tr = G.flightTrack(p);
      if (!st || !tr) return off;
      const m = t - p.flight.dep;
      if (m < tr.boarding) return { ...off, phase: 'boarding', apu: pr.apu ? 1 : 0 };
      const u = (m - tr.boarding) / START;
      if (u < 1) return { ...off, ...startup(pr, u), phase: st.phase, start: u, apu: pr.apu ? 1 : 0 };
      const lv = levers(pr, st, accel);
      return { ...off, run: 1, ...lv, n2: core(pr, lv.pw), phase: st.phase };
    }
    if (p.status === 'turnaround' && !p.repair) {
      const since = t - (p.readyAt - G.turnaroundMin(p.type)); // (minutes since it pulled up at the gate)
      const apu = pr.apu && since > 0.3 ? 1 : 0;
      if (since >= 0 && since < STOP) return { ...off, ...rundown(pr, since / STOP), apu, phase: 'shutdown' };
      return { ...off, apu, phase: 'turnaround' };
    }
    return off;
  }
  // The core's speed (the whine) with the power set: idle 60 %.
  const core = (pr, pw) => (pr.kind === 'piston' ? 0 : pr.kind === 'turboprop' ? 0.6 + 0.4 * pw : 0.6 + 0.4 * clamp01((pw - IDLE) / (1 - IDLE)));

  // How loud the engines are (before distance), to pick the planes that get a voice.
  const level = (pr, e) => pr.size * ((e.run || 0) * (0.15 + 0.85 * e.pw * e.pw) + 0.06 * (e.n2 || 0) + 0.05 * (e.np || 0) + 0.04 * (e.apu || 0) + 0.06 * (e.crank || 0));
  // (softer than the real inverse distance: zoomed in on an airport its planes are heard, zoomed out it goes quiet)
  const distGain = (d) => Math.min(1, (REF / d) ** 0.8);

  // ---------- where it is heard from ----------
  // { lat, lon, h (m above the ground), bearing (the way it looks), follow (id), cam ('chase' | 'wing' | 'flyby' |
  // 'window'), followD (2D: how far the followed plane is heard from) }
  function listener() {
    const v3 = FG.view3d;
    const ui = FG.ui;
    if (v3 && v3.on && v3.map) {
      const map = v3.map;
      const L = { bearing: map.getBearing(), follow: null, cam: null };
      if (v3.follow && ui.selectedPlane) { L.follow = ui.selectedPlane; L.cam = v3.cam; }
      const fb = L.cam === 'flyby' && v3.flyby;
      const c = fb ? { lat: fb.lat, lon: fb.lon, alt: fb.alt } : cameraAt(map);
      const ground = (map.queryTerrainElevation && map.queryTerrainElevation([c.lon, c.lat])) || 0;
      Object.assign(L, { lat: c.lat, lon: c.lon, h: Math.max(1.5, c.alt - ground) });
      if (!L.follow && FG.planeWin && FG.planeWin.id) { L.follow = FG.planeWin.id; L.cam = 'window'; }
      return L;
    }
    const map = ui.map;
    if (!map) return null;
    const c = map.getCenter();
    const mpp = 156543.03 * Math.cos(c.lat * DEG) / 2 ** map.getZoom();
    const L = { lat: c.lat, lon: c.lng, h: mpp * 60, bearing: 0, follow: null, cam: null };
    // (following: as far from it as the map is zoomed, whatever its height)
    if (ui.following) { L.follow = ui.following; L.cam = 'chase'; L.followD = L.h; } else if (FG.planeWin && FG.planeWin.id) { L.follow = FG.planeWin.id; L.cam = 'window'; }
    return L;
  }
  // The 3D camera's place { lat, lon, alt (m above the sea) }: back from the centre along the view, up by the tilt
  // (MapLibre's camera sits 1.5 screen heights from the centre).
  function cameraAt(map) {
    const c = map.getCenter();
    const mpp = 40075016.686 * Math.cos(c.lat * DEG) / (512 * 2 ** map.getZoom());
    const dist = 1.5 * map.getCanvas().clientHeight * mpp;
    const pitch = map.getPitch() * DEG;
    const b = map.getBearing() * DEG;
    const back = dist * Math.sin(pitch);
    const base = (map.getCenterElevation && map.getCenterElevation()) || 0;
    return { lat: c.lat - back * Math.cos(b) / 111320, lon: c.lng - back * Math.sin(b) / (111320 * Math.cos(c.lat * DEG)), alt: base + dist * Math.cos(pitch) };
  }

  // Where plane p is: { lat, lon, h (m above the runways), heading, ms (speed, m/s), st }.
  function placeOf(p, t) {
    if (p.status === 'flying' && p.flight) {
      const st = G.flightState(p, t);
      if (!st) return null;
      return { lat: st.lat, lon: st.lon, h: Math.max(0, (st.altFt || 0) - (st.fieldFt || 0)) * 0.3048, heading: st.heading + (st.crab || 0), ms: st.speedKmh / 3.6, st };
    }
    const g = G.gateOf ? G.gateOf(p.location, p.id) : null;
    const a = g || G.airportByCode[p.location];
    return a ? { lat: a.lat, lon: a.lon, h: 0, heading: (g && g.heading) || 0, ms: 0, st: null } : null;
  }

  // The plane as heard from the listener: distance d (m), ahead (1 straight ahead of the plane … -1 behind), pan
  // (-1 left … 1 right as the listener looks), dop (Doppler pitch factor).
  function geometry(L, P, p) {
    let dLon = P.lon - L.lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const east = dLon * 111320 * Math.cos(L.lat * DEG);
    const north = (P.lat - L.lat) * 110574;
    const up = P.h - L.h;
    let d = Math.hypot(east, north, up);
    const hd = P.heading * DEG;
    const ahead = d > 1 ? -(east * Math.sin(hd) + north * Math.cos(hd)) / d : 0;
    const b = L.bearing * DEG;
    let pan = d > 1 ? (east * Math.cos(b) - north * Math.sin(b)) / d : 0;
    let dop = 1 / (1 - Math.min(0.4, P.ms / SPEED_OF_SOUND) * ahead);
    let near = false;
    if (L.follow === p.id && L.cam !== 'flyby') {
      // The camera goes with it: as from close by (wing camera: on the wing), no Doppler.
      near = L.cam === 'wing';
      if (L.followD) d = L.followD;
      d = near ? 14 : L.cam === 'window' ? Math.min(Math.max(d, 150), 300) : Math.min(Math.max(d, 40), 160);
      dop = 1;
      if (near) pan = 0;
    }
    return { d, ahead, pan, dop: Math.max(0.6, Math.min(1.7, dop)), near };
  }

  // ---------- the sound graph ----------
  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = s.ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); // (many planes at full power: no clipping)
    comp.threshold.value = -16;
    comp.ratio.value = 6;
    comp.attack.value = 0.01;
    comp.release.value = 0.3;
    s.master = ctx.createGain();
    s.master.gain.value = 0;
    s.master.connect(comp);
    comp.connect(ctx.destination);
    s.meter = ctx.createAnalyser(); // (FG.sound.meter)
    s.meter.fftSize = 2048;
    s.master.connect(s.meter);
    // White noise, and a slow random wobble (the uneven beat of a piston engine, the crackle of a jet at full power).
    const n = ctx.sampleRate * 3;
    s.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const nd = s.noise.getChannelData(0);
    for (let i = 0; i < n; i++) nd[i] = Math.random() * 2 - 1;
    s.wobble = ctx.createBuffer(1, n, ctx.sampleRate);
    const wd = s.wobble.getChannelData(0);
    const step = Math.round(ctx.sampleRate / 22);
    let a = 0;
    let b = Math.random() * 2 - 1;
    for (let i = 0; i < n; i++) {
      if (i % step === 0) { a = b; b = i + step >= n ? wd[0] : Math.random() * 2 - 1; }
      const k = (i % step) / step;
      wd[i] = a + (b - a) * k * k * (3 - 2 * k);
    }
    // A radial's exhaust: harmonics of the crank speed, strongest at the firing pulses (7 a turn per row).
    const H = 48;
    const re = new Float32Array(H);
    const im = new Float32Array(H);
    for (let k = 1; k < H; k++) im[k] = (k < 7 ? 0.25 : 1) * (k % 7 === 0 ? 2.5 : k % 7 === 3 || k % 7 === 4 ? 1.4 : 1) / Math.sqrt(k);
    s.wave = ctx.createPeriodicWave(re, im);
    clearInterval(s.timer);
    s.timer = setInterval(update, TICK);
    return true;
  }

  function makeVoice(pr) {
    const ctx = s.ctx;
    const v = { pr, srcs: [], L: {}, sm: null, last: {}, nextClick: 0, kill: 0 };
    const osc = (type, f) => {
      const o = ctx.createOscillator();
      if (type === 'radial') o.setPeriodicWave(s.wave); else o.type = type;
      o.frequency.value = f;
      o.start();
      v.srcs.push(o);
      return o;
    };
    const src = (buffer, rate = 1) => {
      const b = ctx.createBufferSource();
      b.buffer = buffer;
      b.loop = true;
      b.playbackRate.value = rate;
      b.start(0, Math.random() * 2.5);
      v.srcs.push(b);
      return b;
    };
    const filter = (type, f, q) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
    v.out = ctx.createGain();
    v.out.gain.value = 0;
    v.pan = ctx.createStereoPanner();
    v.air = filter('lowpass', 16000, 0.5); // the air takes the highs out with distance
    v.mix = ctx.createGain();
    v.mix.connect(v.air).connect(v.pan).connect(v.out).connect(s.master);
    const gain = (to = v.mix) => { const g = ctx.createGain(); g.gain.value = 0; g.connect(to); return g; };
    const L = v.L;
    L.noise = src(s.noise);
    if (pr.kind === 'jet') {
      L.roarF = filter('lowpass', 400, 0.4);
      L.roar = gain();
      L.noise.connect(L.roarF).connect(L.roar);
      L.rumbleF = filter('lowpass', 150, 0.9);
      L.rumble = gain();
      L.noise.connect(L.rumbleF).connect(L.rumble);
      L.crackle = gain(L.rumble.gain); // (crackle: the rumble's level jumps about)
      src(s.wobble, 4).connect(L.crackle);
      L.fan = gain();
      L.fan1 = osc('triangle', 100);
      L.fan2 = osc('triangle', 100); // the other engine, a little apart: they beat
      L.fan1.connect(L.fan);
      const half = ctx.createGain();
      half.gain.value = 0.6;
      L.fan2.connect(half).connect(L.fan);
      L.core = gain();
      L.core1 = osc('sine', 100);
      L.core1.connect(L.core);
      L.sawF = filter('bandpass', 1100, 0.6);
      L.saw = gain();
      L.saw1 = osc('sawtooth', 50);
      L.saw1.connect(L.sawF).connect(L.saw);
    } else if (pr.kind === 'turboprop') {
      L.propF = filter('lowpass', 600, 0.8);
      L.prop = gain();
      L.prop1 = osc('sawtooth', 50);
      L.prop2 = osc('sawtooth', 50);
      L.prop1.connect(L.propF);
      const half = ctx.createGain();
      half.gain.value = 0.7;
      L.prop2.connect(half).connect(L.propF);
      L.propF.connect(L.prop);
      L.roarF = filter('bandpass', 500, 0.5);
      L.roar = gain();
      L.noise.connect(L.roarF).connect(L.roar);
      L.core = gain();
      L.core1 = osc('sine', 100);
      L.core1.connect(L.core);
    } else {
      L.engF = filter('lowpass', 800, 0.8);
      L.eng = gain();
      L.eng1 = osc('radial', 10);
      L.eng2 = osc('radial', 10);
      L.eng1.connect(L.engF);
      L.eng2.connect(L.engF);
      L.engF.connect(L.eng);
      L.rough = gain(L.eng.gain); // (the beat's level jumps about: a rough idle)
      src(s.wobble, 1).connect(L.rough);
      L.propF = filter('lowpass', 500, 0.7);
      L.prop = gain();
      L.prop1 = osc('sawtooth', 20);
      L.prop1.connect(L.propF).connect(L.prop);
      L.roarF = filter('bandpass', 400, 0.5);
      L.roar = gain();
      L.noise.connect(L.roarF).connect(L.roar);
      L.starter = gain();
      L.starter1 = osc('triangle', 300);
      L.starter1.connect(L.starter);
    }
    if (pr.apu) {
      L.apu = gain();
      L.apu1 = osc('sine', 2900 * (0.97 + 0.06 * Math.random()));
      L.apu1.connect(L.apu);
      L.apuF = filter('bandpass', 1500, 1.2);
      L.noise.connect(L.apuF).connect(L.apu);
    }
    // The wind past the wing camera (not muffled by distance).
    L.windF = filter('bandpass', 650, 0.5);
    L.wind = ctx.createGain();
    L.wind.gain.value = 0;
    L.noise.connect(L.windF).connect(L.wind).connect(v.pan);
    return v;
  }

  function dropVoice(v) {
    for (const x of v.srcs) { try { x.stop(); } catch (e) { /* already */ } }
    try { v.out.disconnect(); } catch (e) { /* already */ }
  }

  // A short burst of filtered noise (light-off, igniter tick, a cough, the tyres) into a voice.
  function burst(v, at, { type = 'bandpass', f, q = 1, dur, level: lv, attack = 0.004 }) {
    const ctx = s.ctx;
    const b = ctx.createBufferSource();
    b.buffer = s.noise;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(lv, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    b.connect(fl).connect(g).connect(v.mix);
    b.start(at, Math.random() * 2, dur + 0.05);
    b.onended = () => g.disconnect();
  }

  // ---------- every TICK ----------
  function update() {
    const ctx = s.ctx;
    if (!ctx || ctx.state !== 'running' || !G.state || !FG.ui) return;
    const now = performance.now();
    const dt = Math.min(0.25, (now - (s.last || now)) / 1000);
    s.last = now;
    const speed = FG.ui.speed; // (0 paused or in the menu)
    const dtGame = dt * speed;
    const t = FG.ui.time;
    const at = ctx.currentTime;
    // Faster than 300× the sound fades out (a flight in a few seconds is only noise); paused it is quiet.
    const fade = speed === 0 ? 0 : speed <= 300 ? 1 : clamp01(1 - Math.log(speed / 300) / Math.log(12));
    const L = fade ? listener() : null;
    if (L && s.tick++ % 4 === 0) { const a = performance.now(); s.picked = pick(L, t); s.pickMs = 0.8 * (s.pickMs || 0) + 0.2 * (performance.now() - a); }
    const want = new Set(L ? s.picked : []);
    for (const id of want) {
      const p = G.plane(id);
      const P = p && placeOf(p, t);
      if (!P) continue;
      const key = `${id}|${p.type}`;
      let v = s.voices.get(key);
      if (!v) { v = makeVoice(profile(p.type)); v.id = id; s.voices.set(key, v); }
      v.kill = 0;
      play(v, p, P, L, t, at, dtGame, speed, fade);
    }
    for (const [key, v] of s.voices) {
      if (want.has(v.id)) continue;
      if (!v.kill) { v.kill = now + 1500; v.out.gain.setTargetAtTime(0, at, 0.25); v.L.wind.gain.setTargetAtTime(0, at, 0.25); }
      if (now > v.kill) { dropVoice(v); s.voices.delete(key); }
    }
  }

  // The loudest planes as heard from L (the ones playing now count a little more, so voices don't flicker).
  function pick(L, t) {
    const out = [];
    const far = L.h > 60000;
    for (const p of G.state.planes) {
      if (far && p.id !== L.follow) continue;
      const P = placeOf(p, t);
      if (!P) continue;
      const g = geometry(L, P, p);
      if (g.d > 40000) continue;
      const e = engines(p, t, P.st);
      const loud = level(profile(p.type), e) * distGain(g.d) * (s.picked.includes(p.id) ? 1.5 : 1);
      if (loud > 0.0015) out.push([loud, p.id]);
    }
    return out.sort((a, b) => b[0] - a[0]).slice(0, VOICES).map((x) => x[1]);
  }

  function play(v, p, P, L, t, at, dtGame, speed, fade) {
    const pr = v.pr;
    const L2 = v.L;
    const T = (param, val, tau = 0.06) => param.setTargetAtTime(Number.isFinite(val) ? val : 0, at, tau);
    // A burst of thrust to get rolling: on a taxiway, slow and getting faster.
    let accel = 0;
    const st = P.st;
    if (st && (st.phase === 'taxi-out' || st.phase === 'taxi-in') && st.speedKmh < 12) {
      const st2 = G.flightState(p, t + 0.05);
      if (st2 && st2.speedKmh > st.speedKmh + 0.2) accel = 1 - st.speedKmh / 12;
    }
    const e = engines(p, t, st, accel);
    // The engines follow the levers with a lag (in game time).
    const sm = v.sm || (v.sm = { ...e });
    const k = 1 - Math.exp(-dtGame / SPOOL);
    for (const f of ['pw', 'np', 'n2', 'rev']) sm[f] += ((e[f] || 0) - sm[f]) * (e.start != null || e.phase === 'shutdown' ? Math.max(k, 0.5) : k);
    for (const f of ['run', 'apu', 'crank', 'rough']) sm[f] = e[f] || 0;
    const g = geometry(L, P, p);
    const sz = pr.size;
    const front = Math.max(0, g.ahead);
    const behind = Math.max(0, -g.ahead);
    const dop = g.dop;
    const run = sm.run;
    T(v.out.gain, distGain(g.d) * fade, 0.08);
    T(v.air.frequency, g.near ? 16000 : Math.min(16000, 16000 / (1 + g.d / 300)));
    T(v.pan.pan, g.pan * 0.8);
    L2.noise.playbackRate.setTargetAtTime(dop, at, 0.06);
    if (pr.kind === 'jet') {
      const n1 = sm.pw;
      const n2 = sm.n2;
      const old = pr.old ? 1.5 : 1;
      T(L2.roar.gain, run * sz * (0.12 + 2.7 * n1 ** 3) * (1 + 0.9 * behind) * (1 - 0.25 * front) * old * (1 + 0.5 * sm.rev));
      T(L2.roarF.frequency, Math.min(9000, (250 + 3800 * n1 ** 1.6) * (1 + 0.4 * behind + 0.6 * sm.rev)));
      const rumble = run * sz * 3 * n1 ** 4 * (0.4 + 1.3 * behind) * (pr.afterburner && e.phase === 'takeoff' ? 2 : 1);
      T(L2.rumble.gain, rumble);
      T(L2.crackle.gain, rumble * 0.6 * behind);
      T(L2.fan.gain, sz * 0.16 * smooth(0.04, 0.18, n1) * (0.6 + 0.9 * front) * (pr.old ? 0.35 : 1) * (1 - 0.5 * smooth(0.7, 1, n1)));
      T(L2.fan1.frequency, Math.max(20, pr.fan * n1 * dop));
      T(L2.fan2.frequency, Math.max(20, pr.fan * n1 * dop * 1.006));
      T(L2.core.gain, sz * 0.05 * smooth(0.02, 0.12, n2) * (pr.old ? 2 : 1) * (1 - 0.6 * n1));
      T(L2.core1.frequency, Math.max(20, pr.core * n2 * dop));
      T(L2.saw.gain, pr.old ? 0 : sz * 1.2 * smooth(0.82, 0.92, n1) * front ** 1.5);
      T(L2.saw1.frequency, Math.max(20, pr.shaft * n1 * dop));
    } else if (pr.kind === 'turboprop') {
      const pw = sm.pw;
      const np = sm.np;
      T(L2.prop.gain, sz * (0.05 + 0.55 * pw ** 1.3) * smooth(0.05, 0.4, np) * (1 + 0.3 * front));
      T(L2.prop1.frequency, Math.max(5, pr.prop * np * dop));
      T(L2.prop2.frequency, Math.max(5, pr.prop * np * dop * 1.007));
      T(L2.propF.frequency, (250 + 1400 * pw + 300 * np) * dop);
      T(L2.roar.gain, run * sz * (0.04 + 0.5 * pw * pw) * (1 + 0.6 * behind) * (1 + 0.5 * sm.rev));
      T(L2.roarF.frequency, 300 + 900 * pw);
      T(L2.core.gain, sz * 0.04 * pr.whineGain * smooth(0.03, 0.15, sm.n2) * (1 - 0.4 * pw));
      T(L2.core1.frequency, Math.max(20, pr.whine * sm.n2 * dop));
    } else {
      const pw = sm.pw;
      const np = sm.np;
      const base = sz * (sm.crank ? 0.2 * sm.crank : 0) + run * sz * (0.2 + 1.0 * pw);
      T(L2.eng.gain, base);
      T(L2.rough.gain, base * (0.2 + 0.6 * sm.rough + (sm.crank ? 0.5 : 0)));
      T(L2.eng1.frequency, Math.max(1, pr.crank * np * dop));
      T(L2.eng2.frequency, Math.max(1, pr.crank * np * dop * 1.013));
      T(L2.engF.frequency, 250 + 1600 * np ** 1.2);
      T(L2.prop.gain, sz * smooth(0.1, 0.3, np) * (0.03 + 0.3 * pw));
      T(L2.prop1.frequency, Math.max(5, pr.prop * np * dop));
      T(L2.propF.frequency, 300 + 1400 * pw);
      T(L2.roar.gain, run * sz * (0.025 + 0.2 * pw));
      T(L2.roarF.frequency, 250 + 600 * pw);
      T(L2.starter.gain, sz * 0.05 * sm.crank);
      T(L2.starter1.frequency, 260 + 260 * clamp01((e.start || 0) / 0.4));
    }
    if (L2.apu) T(L2.apu.gain, sz * 0.02 * sm.apu, 0.4);
    // The wind on the wing camera (a little on the chase camera too).
    const wind = L.follow === p.id && (L.cam === 'wing' || L.cam === 'chase') ? (L.cam === 'wing' ? 0.16 : 0.03) * Math.min(1.4, (P.ms / 230) ** 2) : 0;
    T(L2.wind.gain, wind * fade, 0.2);
    T(L2.windF.frequency, 400 + 1.2 * P.ms);

    // One-off sounds (not when fast-forwarded: they would rattle).
    const was = v.last;
    if (speed <= 300) {
      if (e.lit && !was.lit) burst(v, at, { type: 'lowpass', f: 160, q: 0.8, dur: 1.1, level: sz * 2, attack: 0.08 }); // light-off
      if (e.phase === 'landing' && (was.phase === 'approach' || was.phase === 'descent')) { // touchdown: the tyres
        burst(v, at, { f: 1700, q: 2.5, dur: 0.22, level: sz * 0.5 });
        burst(v, at + 0.11, { f: 1500, q: 2.5, dur: 0.2, level: sz * 0.4 });
      }
    }
    if (speed <= 30) {
      if (e.ign && performance.now() > v.nextClick) { // igniters ticking
        burst(v, at, { type: 'highpass', f: 2500, q: 0.7, dur: 0.03, level: sz * 0.25, attack: 0.001 });
        v.nextClick = performance.now() + 520;
      }
      if (e.pops && Math.random() < 0.22) burst(v, at + Math.random() * 0.04, { type: 'lowpass', f: 380, q: 1, dur: 0.14, level: sz * 1.5 }); // a cough
    }
    v.last = { lit: !!e.lit, phase: e.phase };
  }

  // ---------- on, off, volume ----------
  function apply() {
    const btn = document.getElementById('sound-toggle');
    if (btn) {
      btn.textContent = prefs.on ? '🔊' : '🔇';
      btn.classList.toggle('off', !prefs.on);
      btn.title = `Sound ${prefs.on ? 'on' : 'off'} (M)`;
    }
    if (!s.ctx) return;
    const at = s.ctx.currentTime;
    s.master.gain.setTargetAtTime(prefs.on ? prefs.volume * 0.9 : 0, at, 0.05);
    const quiet = () => {}; // (a browser may refuse; the next click tries again)
    if (prefs.on && !document.hidden) s.ctx.resume().catch(quiet);
    else setTimeout(() => { if ((!prefs.on || document.hidden) && s.ctx.state === 'running') s.ctx.suspend().catch(quiet); }, 250);
  }
  // Browsers only let a page make sound after a click or a key: the sound starts with the first one.
  function unlock() {
    if (!prefs.on || document.hidden) return;
    if (!s.ctx && !build()) return;
    apply();
  }
  for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) apply(); else unlock(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'm' && e.key !== 'M') return;
    if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!document.getElementById('start-screen').hidden) return;
    FG.sound.toggle();
    if (FG.ui && FG.ui.toast) FG.ui.toast(prefs.on ? '🔊 Sound on' : '🔇 Sound off');
  });
  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('sound-toggle');
    if (btn) btn.addEventListener('click', () => FG.sound.toggle());
    apply();
  });

  FG.sound = {
    get on() { return prefs.on; },
    get volume() { return prefs.volume; },
    set(o) {
      if (o.on != null) prefs.on = !!o.on;
      if (o.volume != null) prefs.volume = clamp01(Number(o.volume));
      savePrefs();
      if (prefs.on) unlock();
      apply();
    },
    toggle() { this.set({ on: !prefs.on }); },
    engines, // (p, t) -> what its engines do now (developer tools, smoke test)
    heardFrom: listener, // where it is heard from now
    profile,
    get state() { return s.ctx ? s.ctx.state : 'off'; },
    get pickMs() { return s.pickMs || 0; }, // (time to find the loudest planes, 4 times a second)
    // The planes playing now: [{ id, kind, gain }] (smoke test).
    get playing() { return [...s.voices.values()].filter((v) => !v.kill).map((v) => ({ id: v.id, kind: v.pr.kind, gain: v.out.gain.value })); },
    // How loud it is coming out now, in dB (-Infinity: quiet; smoke test).
    meter() {
      if (!s.ctx) return -Infinity;
      const a = new Float32Array(s.meter.fftSize);
      s.meter.getFloatTimeDomainData(a);
      let sum = 0;
      for (const x of a) sum += x * x;
      return 10 * Math.log10(sum / a.length);
    },
  };
})();
