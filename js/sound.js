// Aircraft sounds, made up as they play with Web Audio, and three recordings made with ElevenLabs Sound Effects
// (RECORDINGS): the jets' deep rumble, a jet's starter whistling up, and a distant airliner's wash that planes far
// away turn into. Until they have loaded, or where they can't be, it is all made up. Each engine kind has its own
// voice:
// - jets: the core whining up on the starter, the igniters ticking, light-off, the fan whine at idle, a burst of
//   thrust to get rolling, the roar at take-off power (and from behind the rumble, ahead of a big fan the buzz-saw),
//   climb and cruise power, quiet on the descent, spooling up again on the approach, reverse thrust after
//   touchdown, and the whine running down at the gate;
// - turboprops: two propellers a little out of tune (they swell against each other), the air they chop (a rasp at
//   the blade rate), a rumble, the turbine's whistle (noise in a narrow band);
// - piston radials: the starter cranking, coughs as they catch, a rough idle that smooths out, the growl at full power.
// Also the APU at the gate, the tyres chirping on touchdown and the wind on the wing camera.
// Heard from where you look: the 3D camera, or a point above the 2D map's centre (higher the further out it is
// zoomed), so zoomed in on an airport you hear the planes there and zoomed out it goes quiet. The plane the camera
// follows (3D chase or wing camera, 2D follow, or the plane window's camera) is heard as from close by; the fly-by
// camera hears it pass, with the Doppler drop. Only the VOICES loudest planes play.
// Engine power follows the flight (G.flightState phases) in game time: at real time a start takes over a minute,
// fast-forwarded it is quick; above 300× it fades out, paused it is quiet, in a background tab it stops.
// Off until turned on (remembered): the 🔇/🔊 button in the top bar, M, or Settings → Sound. FG.sound.
// Four styles of the same voices (STYLES: Standard, Deep, Open, Soft; Settings → Sound), and a preview that plays
// a whole flight in about 35 s on its own voice to compare them (▶ Preview; it plays paused or in the menu too).
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
  // Recorded loops (16 kHz mono WAV: an MP3 starts with a little silence, which would stutter in a loop), each at the
  // rms it plays at. rumble (10 s): the jets' rumble at power, all its weight where it is heard (40-160 Hz), so at
  // 0.24 a little heavier than the brown noise at 0.3 was. far (15 s): an airliner drifting over far away. start (9 s,
  // once, not a loop): a jet's starter whistling up from 1 to 1.5 kHz (the hiss above 6 kHz taken out).
  const RECORDINGS = { rumble: ['sounds/jet-rumble.wav', 0.24], far: ['sounds/far-wash.wav', 0.3], start: ['sounds/jet-start.wav', 0.3] };
  const SCREECH = 5;        // the screech's level (× size, power, style)
  const START_LEVEL = 0.3;  // the start recording × the plane's size × the style's whine
  const FAR = [800, 4000]; // metres: from here the made-up voice gives way to the far recording, all of it by there
  const FAR_LEVEL = 2.5;   // the far recording × the engines' power: about as loud as the made-up voice it takes over from
  const DEG = Math.PI / 180;

  // ---------- the styles ----------
  // The same voices with other numbers (Settings → Sound). 'standard' is the sound as tuned with the user (the user:
  // "that is a good sound but it needs more bass"; later "it sounds like a tractor, it should have really strong bass
  // and air sounds" and, on the wing camera, "a fast repeating electric beat": no crackle, a quarter of the buzz-saw,
  // more bass and air; then "still a humming sound", "the engines should screech, not a high pitched tone", louder,
  // and heard close by too, not only coming towards you; "the buzz completely gone": no drone, no buzz-saw, the
  // screech); its numbers are the ones the others are measured against.
  // Jets: shelf (dB of bass below shelfHz), roar (level; its low-pass from roarLo at no power + roarHi × N1^roarPow,
  // the second one roarSpread times higher), rumble (the recording below rumbleHz), crackle (the rumble jumping about
  // at take-off power), drone (the fan shaft's hum), fan and core (the whines; tone: their pitch, also the APU's and
  // the turboprop's), saw (the buzz-saw ahead of a big fan), screech (the fan's rough screech: noise in two narrow
  // bands at its blade pitch, all round the plane), air (the air rushing past: level, airHz × its low-pass,
  // airHp a high-pass so it rushes instead of rumbling, gust), top (a low-pass on it all: muffled), spool (× the
  // time the engines take to follow the levers), level. Turboprops and pistons: prop (the propeller and engine
  // tones) and bright (× their filters), and roar, core, tone, air, shelf, top and level as above.
  const STYLES = {
    standard: {
      name: 'Standard', about: 'The full roar and rumble, the air rushing past.',
      shelf: 9, shelfHz: 220, roar: 1, roarLo: 200, roarHi: 1900, roarPow: 1.6, roarSpread: 2, rumble: 1.3, rumbleHz: 180,
      crackle: 0, drone: 0, fan: 0.35, core: 0.3, tone: 1, saw: 0, screech: 1, air: 2.4, airHz: 1, airHp: 0, gust: 0.3, top: 16000, spool: 1,
      level: 1, prop: 1, bright: 1,
    },
    deep: {
      name: 'Deep', about: 'Heavier and darker, cinematic: more rumble and low drone, a dark roar, hardly any whine.',
      shelf: 10, shelfHz: 180, roar: 1.05, roarLo: 150, roarHi: 1000, roarPow: 1.6, roarSpread: 1.5, rumble: 2, rumbleHz: 150,
      crackle: 0, drone: 0.6, fan: 0.2, core: 0.15, tone: 0.68, saw: 0, screech: 0.3, air: 1.4, airHz: 0.65, airHp: 0, gust: 0.3, top: 5000, spool: 1,
      level: 1, prop: 1.1, bright: 0.7,
    },
    open: {
      name: 'Open', about: 'Brighter and more open at full power, a strong rush of air, the bass kept.',
      shelf: 6, shelfHz: 220, roar: 1.15, roarLo: 260, roarHi: 2900, roarPow: 2, roarSpread: 2.6, rumble: 1, rumbleHz: 180,
      crackle: 0, drone: 0, fan: 0.25, core: 0.4, tone: 0.68, saw: 0, screech: 1, air: 3.6, airHz: 1.25, airHp: 350, gust: 0.45, top: 16000, spool: 1,
      level: 1, prop: 1, bright: 1.3,
    },
    soft: {
      name: 'Soft', about: 'Smooth and relaxed for long sessions: muffled, as from further away or inside, gentle air, almost no whine.',
      shelf: 4, shelfHz: 200, roar: 0.9, roarLo: 180, roarHi: 1200, roarPow: 1.6, roarSpread: 1.6, rumble: 0.75, rumbleHz: 160,
      crackle: 0, drone: 0, fan: 0.12, core: 0.08, tone: 0.68, saw: 0, screech: 0.2, air: 0.7, airHz: 0.7, airHp: 0, gust: 0.15, top: 1300, spool: 1.5,
      level: 0.7, prop: 0.8, bright: 0.6,
    },
  };

  const prefs = { on: false, volume: 0.6, style: 'standard', preview: 'jet', mix: {} }; // (off until turned on: ROADMAP)
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { /* private mode */ }
  if (!STYLES[prefs.style]) prefs.style = 'standard';
  if (!prefs.mix || typeof prefs.mix !== 'object') prefs.mix = {};

  // ---------- the mixer (F6, js/soundmix.js) ----------
  // How loud each part of a plane's sound is (× 0..3), set for all planes ('all'), an engine kind ('jet', 'turboprop',
  // 'piston') or one type ('A320neo'): prefs.mix[target][part]. A plane takes its type's, else its kind's, else all
  // planes' (else 1).
  const PARTS = {
    bass: 'Bass and rumble', roar: 'Roar', screech: 'Screech', whine: 'Whine', prop: 'Propellers',
    engine: 'Engine (pistons)', air: 'Air rushing past', start: 'Engine start', far: 'Far away', apu: 'APU',
  };
  const KIND_PARTS = {
    jet: ['bass', 'roar', 'screech', 'whine', 'air', 'start', 'far', 'apu'],
    turboprop: ['bass', 'prop', 'roar', 'whine', 'air', 'far', 'apu'],
    piston: ['bass', 'engine', 'prop', 'roar', 'air', 'far'],
  };
  const mixOf = (type, kind) => {
    const m = {};
    for (const part in PARTS) {
      const x = [type, kind, 'all'].map((k) => prefs.mix[k] && prefs.mix[k][part]).find((y) => y != null);
      m[part] = x == null ? 1 : x;
    }
    return m;
  };
  const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ } };

  const s = { ctx: null, master: null, noise: null, wobble: null, wave: null, rec: {}, voices: new Map(), picked: [], tick: 0, last: 0, timer: null, demo: null };

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
      pr = { kind: 'turboprop', prop: (old ? 80 : 104) * j, whine: (old ? 2000 : 2200) * j, whineGain: old ? 2 : 1, apu: !old };
    } else {
      // Early jets (turbojets, low bypass) roar and scream; big modern fans hum lower.
      const old = eng === 'concorde' || ((ac.year || 2000) < 1970 && !look.bigFan);
      const fan = (look.bigFan ? 1300 : ac.category === 'widebody' ? 1700 : ac.category === 'regional' ? 3100 : 2500) * j;
      // (the whines: fan from fanLo at idle to fanHi at full power, about an octave; the core lower still)
      pr = { kind: 'jet', old, fan, fanLo: fan * 0.26, fanHi: fan * 0.5, shaft: fan / (look.bigFan ? 20 : 30), core: (old ? 2600 : 2200) * j, apu: true, afterburner: eng === 'concorde' };
    }
    pr.size = Math.min(1.25, 0.5 + Math.sqrt(ac.seats || 100) / 25) * (four ? 1.1 : 1);
    pr.type = type;
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
  const OFF = { run: 0, pw: 0, np: 0, n2: 0, rev: 0, apu: 0, crank: 0, rough: 0 };
  // Running, with the levers set for flight state st.
  function running(pr, st, accel = 0) {
    const lv = levers(pr, st, accel);
    return { ...OFF, run: 1, ...lv, n2: core(pr, lv.pw), phase: st.phase };
  }
  function engines(p, t, st, accel = 0) {
    const pr = profile(p.type);
    const off = { ...OFF, phase: p.status };
    if (p.status === 'flying' && p.flight) {
      st = st || G.flightState(p, t);
      const tr = G.flightTrack(p);
      if (!st || !tr) return off;
      const m = t - p.flight.dep;
      if (m < tr.boarding) return { ...off, phase: 'boarding', apu: pr.apu ? 1 : 0 };
      const u = (m - tr.boarding) / START;
      if (u < 1) return { ...off, ...startup(pr, u), phase: st.phase, start: u, apu: pr.apu ? 1 : 0 };
      return running(pr, st, accel);
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
    s.meter = ctx.createAnalyser(); // (FG.sound.meter, spectrum)
    s.meter.fftSize = 8192;
    s.meter.smoothingTimeConstant = 0; // (else each reading is mostly the one before)
    s.master.connect(s.meter);
    // Noise: white (the short bursts), pink and brown (the roar and the rumble: their weight is low down, white
    // noise filtered sounds like static), and a slow random wobble (the uneven beat of a piston engine, the crackle
    // of a jet at full power).
    const n = ctx.sampleRate * 3;
    s.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const nd = s.noise.getChannelData(0);
    for (let i = 0; i < n; i++) nd[i] = Math.random() * 2 - 1;
    s.pink = colouredNoise(ctx, n, 'pink');
    s.brown = colouredNoise(ctx, n, 'brown');
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
    // A propeller's blades going by: a soft pulse, its overtones falling off fast (a sawtooth's buzzed like a hum).
    const bi = new Float32Array(24);
    for (let k = 1; k < 24; k++) bi[k] = 1 / k ** 1.5;
    s.blade = ctx.createPeriodicWave(new Float32Array(24), bi);
    for (const name in RECORDINGS) load(ctx, name);
    clearInterval(s.timer);
    s.timer = setInterval(update, TICK);
    return true;
  }

  // Pink (-3 dB an octave, Paul Kellet's filter) or brown (-6 dB) noise, n samples at rms 0.3, looping without a
  // click (its end faded into its start).
  function colouredNoise(ctx, n, kind) {
    const F = Math.round(ctx.sampleRate * 0.05);
    const raw = new Float32Array(n + F);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, y = 0;
    for (let i = 0; i < n + F; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      } else {
        y = (y + 0.02 * w) / 1.02;
        raw[i] = y;
      }
    }
    let mean = 0;
    for (let i = 0; i < n + F; i++) mean += raw[i];
    mean /= n + F;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const k = i < F ? i / F : 1;
      d[i] = (i < F ? raw[i] * k + raw[n + i] * (1 - k) : raw[i]) - mean;
    }
    let sq = 0;
    for (let i = 0; i < n; i++) sq += d[i] * d[i];
    const g = 0.3 / Math.sqrt(sq / n);
    for (let i = 0; i < n; i++) d[i] *= g;
    return buf;
  }

  // A recording (RECORDINGS) into s.rec. Once it is in, the voices are built again with it.
  function load(ctx, name) {
    const [url, rms] = RECORDINGS[name];
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${url}: ${r.status}`))))
      .then((data) => new Promise((ok, no) => ctx.decodeAudioData(data, ok, no))) // (old Safari: no promise)
      .then((buf) => {
        let sq = 0;
        const d0 = buf.getChannelData(0);
        for (let i = 0; i < d0.length; i++) sq += d0[i] * d0[i];
        const g = rms / Math.sqrt(sq / d0.length || 1);
        for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
        s.rec[name] = buf;
        restyle();
      })
      .catch((e) => console.warn(`sound: no recording ${name}, made up instead`, e)); // (offline, file://)
  }

  function makeVoice(pr) {
    const ctx = s.ctx;
    const S = STYLES[prefs.style];
    const v = { pr, S, M: mixOf(pr.type, pr.kind), srcs: [], L: {}, sm: null, last: {}, nextClick: 0, kill: 0 };
    const osc = (type, f) => {
      const o = ctx.createOscillator();
      if (type === 'radial') o.setPeriodicWave(s.wave); else if (type === 'blade') o.setPeriodicWave(s.blade); else o.type = type;
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
      b.start(0, Math.random() * 0.8 * buffer.duration);
      v.srcs.push(b);
      return b;
    };
    const filter = (type, f, q) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
    v.out = ctx.createGain();
    v.out.gain.value = 0;
    v.pan = ctx.createStereoPanner();
    v.air = filter('lowpass', 16000, 0.5); // the air takes the highs out with distance
    v.mix = ctx.createGain();
    v.bass = filter('lowshelf', S.shelfHz, 0.7); // (more weight low down)
    v.bass.gain.value = S.shelf;
    v.mix.connect(v.bass).connect(v.air).connect(v.pan).connect(v.out).connect(s.master);
    const gain = (to = v.mix) => { const g = ctx.createGain(); g.gain.value = 0; g.connect(to); return g; };
    const L = v.L;
    L.noise = src(s.pink); // (roar, APU, wind)
    v.rec = pr.kind === 'jet' && !!s.rec.rumble;
    L.deep = src(v.rec ? s.rec.rumble : s.brown); // (rumble)
    const lp2 = (f, q = 0.7) => { const a = filter('lowpass', f, q); const b = filter('lowpass', f, q); a.connect(b); return [a, b]; };
    // Propellers (turboprops, pistons): the blades' tone (n of them, a little apart: they swell against each other),
    // the air they chop (noise pulsing at the blade rate: the rasp, which a tone alone hasn't got) and the rumble.
    const propeller = (n) => {
      L.propF = filter('lowpass', 600, 0.7);
      L.prop = gain();
      L.prop1 = osc('blade', 50);
      L.prop1.connect(L.propF);
      if (n > 1) {
        L.prop2 = osc('blade', 50);
        const half = ctx.createGain();
        half.gain.value = 0.7;
        L.prop2.connect(half).connect(L.propF);
      }
      L.propF.connect(L.prop);
      L.chopF = filter('bandpass', 600, 0.6);
      L.chopAm = ctx.createGain(); // (its level: 0.3 ± 0.7 × a sine at the blade rate)
      L.chopAm.gain.value = 0.3;
      L.chop = gain();
      L.noise.connect(L.chopF).connect(L.chopAm).connect(L.chop);
      L.chop1 = osc('sine', 50);
      const depth = ctx.createGain();
      depth.gain.value = 0.7;
      L.chop1.connect(depth).connect(L.chopAm.gain);
      L.rumbleF = filter('lowpass', 140, 0.8);
      L.rumble = gain();
      L.deep.connect(L.rumbleF).connect(L.rumble);
    };
    if (pr.kind === 'jet') {
      [L.roarF, L.roarF2] = lp2(400);
      L.roar = gain();
      L.noise.connect(L.roarF);
      L.roarF2.connect(L.roar);
      L.rumbleF = filter('lowpass', S.rumbleHz, 0.8);
      L.rumble = gain();
      L.deep.connect(L.rumbleF).connect(L.rumble);
      L.crackle = gain(L.rumble.gain); // (crackle at take-off power: the rumble's level jumps about)
      src(s.wobble, 3).connect(L.crackle);
      // The drone: the fan shaft's turn and its harmonics, both engines a little apart (they throb).
      L.droneF = filter('lowpass', 300, 1.2);
      L.drone = gain();
      L.drone1 = osc('sine', 50);
      L.drone2 = osc('sine', 50);
      L.drone1.connect(L.droneF);
      L.drone2.connect(L.droneF);
      L.droneF.connect(L.drone);
      L.fan = gain();
      L.fan1 = osc('sine', 100); // (sines: a triangle's overtones at 3-5 kHz beat as an electric buzz)
      L.fan2 = osc('sine', 100); // the other engine, a little apart: they swell slowly
      L.fan1.connect(L.fan);
      const half = ctx.createGain();
      half.gain.value = 0.6;
      L.fan2.connect(half).connect(L.fan);
      L.core = gain();
      L.core1 = osc('sine', 100);
      L.core1.connect(L.core);
      // The screech: white noise in two narrow bands at the fan's blade pitch (rough, not a tone).
      L.scrSrc = src(s.noise);
      L.scrF1 = filter('bandpass', 2000, 5);
      L.scrF2 = filter('bandpass', 2900, 7);
      L.screech = gain();
      L.scrSrc.connect(L.scrF1).connect(L.screech);
      L.scrSrc.connect(L.scrF2).connect(L.screech);
      L.sawF = filter('bandpass', 1100, 0.6);
      L.saw = gain();
      L.saw1 = osc('sawtooth', 50);
      L.saw1.connect(L.sawF).connect(L.saw);
    } else if (pr.kind === 'turboprop') {
      propeller(2);
      L.roarF = filter('bandpass', 500, 0.5);
      L.roar = gain();
      L.noise.connect(L.roarF).connect(L.roar);
      // The turbine's whistle: mostly noise in a narrow band (a bare sine was a test tone), a little of the tone.
      L.core = gain();
      L.core1 = osc('sine', 100);
      L.core1.connect(L.core);
      L.whF = filter('bandpass', 2000, 9);
      L.wh = gain();
      L.noise.connect(L.whF).connect(L.wh);
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
      propeller(1);
      L.roarF = filter('bandpass', 400, 0.5);
      L.roar = gain();
      L.noise.connect(L.roarF).connect(L.roar);
      L.starter = gain();
      L.starter1 = osc('triangle', 300);
      L.starter1.connect(L.starter);
    }
    if (pr.apu) {
      L.apu = gain();
      L.apu1 = osc('sine', 1900 * S.tone * (0.97 + 0.06 * Math.random()));
      L.apu1.connect(L.apu);
      L.apuF = filter('bandpass', 700, 1);
      L.noise.connect(L.apuF).connect(L.apu);
    }
    // The air rushing past the plane (all kinds): stronger and brighter with speed, gusting a little.
    [L.airF, L.airF2] = lp2(800, 0.6);
    L.air = gain();
    L.noise.connect(L.airF);
    if (S.airHp) L.airF2.connect(filter('highpass', S.airHp, 0.6)).connect(L.air); // (a rush, not a rumble)
    else L.airF2.connect(L.air);
    L.gust = gain(L.air.gain);
    src(s.wobble, 0.2).connect(L.gust);
    // The wind past the wing camera (not muffled by distance).
    L.windF = filter('bandpass', 500, 0.7);
    L.wind = ctx.createGain();
    L.wind.gain.value = 0;
    L.noise.connect(L.windF).connect(L.wind).connect(v.pan);
    // Far away: the recording of a distant airliner (after the bass shelf: it is low enough).
    if (s.rec.far) {
      L.farG = gain(v.air);
      L.far = src(s.rec.far);
      L.far.connect(L.farG);
    }
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

  // A recording played once into a voice (stopped with it); returns its gain.
  function oneShot(v, buffer, lv, at) {
    const b = s.ctx.createBufferSource();
    b.buffer = buffer;
    const g = s.ctx.createGain();
    g.gain.value = lv;
    b.connect(g).connect(v.mix);
    b.start(at);
    v.srcs.push(b);
    b.onended = () => { g.disconnect(); v.srcs.splice(v.srcs.indexOf(b), 1); };
    return g;
  }

  // ---------- every TICK ----------
  function update() {
    const ctx = s.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = performance.now();
    const dt = Math.min(0.25, (now - (s.last || now)) / 1000);
    s.last = now;
    const at = ctx.currentTime;
    if (s.demo) demoTick(dt, at);
    if (!G.state || !FG.ui) return;
    const speed = FG.ui.speed; // (0 paused or in the menu)
    const dtGame = dt * speed;
    const t = FG.ui.time;
    // Faster than 300× the sound fades out (a flight in a few seconds is only noise); paused it is quiet; the
    // preview plays alone.
    const fade = speed === 0 || s.demo ? 0 : speed <= 300 ? 1 : clamp01(1 - Math.log(speed / 300) / Math.log(12));
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

  // Plane p (at P) heard from L.
  function play(v, p, P, L, t, at, dtGame, speed, fade) {
    // A burst of thrust to get rolling: on a taxiway, slow and getting faster.
    let accel = 0;
    const st = P.st;
    if (st && (st.phase === 'taxi-out' || st.phase === 'taxi-in') && st.speedKmh < 12) {
      const st2 = G.flightState(p, t + 0.05);
      if (st2 && st2.speedKmh > st.speedKmh + 0.2) accel = 1 - st.speedKmh / 12;
    }
    const e = engines(p, t, st, accel);
    const g = geometry(L, P, p);
    // The wind on the wing camera.
    const wind = L.follow === p.id && L.cam === 'wing' ? 0.5 * Math.min(1.4, (P.ms / 230) ** 2) : 0;
    sound(v, e, g, P.ms, wind, at, dtGame, speed, fade);
  }

  // Sets voice v (in its style v.S): engines e (as engines() gives), heard as g (geometry()), the plane at speedMs
  // (m/s), wind on the wing camera.
  function sound(v, e, g, speedMs, wind, at, dtGame, speed, fade) {
    const pr = v.pr;
    const S = v.S;
    const M = v.M;
    const L2 = v.L;
    const T = (param, val, tau = 0.06) => param.setTargetAtTime(Number.isFinite(val) ? val : 0, at, tau);
    // The engines follow the levers with a lag (in game time).
    const sm = v.sm || (v.sm = { ...e });
    const k = 1 - Math.exp(-dtGame / (SPOOL * S.spool));
    for (const f of ['pw', 'np', 'n2', 'rev']) sm[f] += ((e[f] || 0) - sm[f]) * (e.start != null || e.phase === 'shutdown' ? Math.max(k, 0.5) : k);
    for (const f of ['run', 'apu', 'crank', 'rough']) sm[f] = e[f] || 0;
    const sz = pr.size;
    const front = Math.max(0, g.ahead);
    const behind = Math.max(0, -g.ahead);
    const dop = g.dop;
    const run = sm.run;
    T(v.out.gain, distGain(g.d) * fade * S.level, 0.08);
    // Far away the made-up voice gives way to the recording (FAR), as loud as the engines' power.
    const far = L2.far ? smooth(FAR[0], FAR[1], g.d) : 0;
    T(v.mix.gain, 1 - 0.85 * far, 0.3);
    if (L2.far) {
      T(L2.farG.gain, M.far * far * FAR_LEVEL * sz * run * (0.05 + 0.95 * sm.pw * sm.pw), 0.3); // (not an APU, hardly idle)
      L2.far.playbackRate.setTargetAtTime(dop, at, 0.06);
    }
    T(v.air.frequency, Math.min(S.top, g.near ? 16000 : Math.min(16000, 16000 / (1 + g.d / 300))));
    T(v.pan.pan, g.pan * 0.8);
    L2.noise.playbackRate.setTargetAtTime(dop, at, 0.06);
    L2.deep.playbackRate.setTargetAtTime(dop, at, 0.06); // (not with the power: it revved like a tractor)
    if (pr.kind === 'jet') {
      const n1 = sm.pw;
      const n2 = sm.n2;
      const old = pr.old ? 1.5 : 1;
      // The roar: low and full (pink noise through two low-passes), brighter with power and from behind.
      T(L2.roar.gain, M.roar * run * sz * S.roar * (0.1 + 1.6 * n1 ** 3) * (1 + 0.6 * behind) * (1 - 0.2 * front) * old * (1 + 0.5 * sm.rev));
      const fc = (S.roarLo + S.roarHi * n1 ** S.roarPow) * (1 + 0.25 * behind + 0.4 * sm.rev) * (pr.old ? 1.2 : 1);
      T(L2.roarF.frequency, fc);
      T(L2.roarF2.frequency, fc * S.roarSpread);
      const rumble = M.bass * run * sz * S.rumble * (0.08 + 1.2 * n1 ** 3) * (0.5 + 1.0 * behind) * (pr.afterburner && e.phase === 'takeoff' ? 2 : 1);
      T(L2.rumble.gain, rumble);
      T(L2.crackle.gain, rumble * 0.5 * S.crackle * behind * smooth(0.85, 0.92, n1));
      T(L2.drone.gain, M.bass * run * sz * 0.16 * S.drone * smooth(0.25, 0.9, n1));
      T(L2.drone1.frequency, Math.max(5, pr.shaft * n1 * dop));
      T(L2.drone2.frequency, Math.max(5, pr.shaft * n1 * dop * 1.001));
      T(L2.droneF.frequency, 150 + 350 * n1);
      // The whine: clear at idle, it fades under the roar as the power comes up.
      const fanHz = n1 < IDLE ? pr.fanLo * n1 / IDLE : pr.fanLo + (pr.fanHi - pr.fanLo) * (n1 - IDLE) / (1 - IDLE);
      T(L2.fan.gain, M.whine * sz * 0.16 * S.fan * smooth(0.04, 0.18, n1) * (0.6 + 0.9 * front) * (pr.old ? 0.35 : 1) * (1 - 0.75 * smooth(0.3, 0.9, n1)));
      T(L2.fan1.frequency, Math.max(20, fanHz * dop));
      T(L2.fan2.frequency, Math.max(20, fanHz * dop * 1.0012));
      T(L2.core.gain, M.whine * sz * 0.035 * S.core * smooth(0.02, 0.12, n2) * (pr.old ? 2 : 1) * (1 - 0.8 * n1));
      T(L2.core1.frequency, Math.max(20, pr.core * S.tone * n2 * dop));
      T(L2.saw.gain, pr.old ? 0 : sz * 1.2 * S.saw * smooth(0.82, 0.92, n1) * front ** 1.5);
      // The screech: up with the power, from all round (a little more ahead), old jets more.
      const scrHz = Math.min(2000, 1.5 * pr.fan * (0.55 + 0.45 * n1)) * dop; // (higher was a hiss: small fans)
      T(L2.screech.gain, M.screech * run * sz * SCREECH * S.screech * (0.04 + 0.96 * smooth(0.25, 0.9, n1)) * (0.8 + 0.4 * front) * (pr.old ? 1.3 : 1));
      T(L2.scrF1.frequency, scrHz);
      T(L2.scrF2.frequency, scrHz * 1.25);
      T(L2.saw1.frequency, Math.max(20, pr.shaft * n1 * dop));
    } else if (pr.kind === 'turboprop') {
      const pw = sm.pw;
      const np = sm.np;
      const blades = pr.prop * np * dop;
      const turning = smooth(0.05, 0.4, np);
      T(L2.prop.gain, M.prop * sz * S.prop * 0.6 * (0.05 + 0.5 * pw ** 1.3) * turning * (1 + 0.3 * front));
      T(L2.prop1.frequency, Math.max(5, blades));
      T(L2.prop2.frequency, Math.max(5, blades * 1.004));
      T(L2.propF.frequency, (250 + 900 * pw + 200 * np) * dop * S.bright);
      // The chopped air: louder and brighter with power and propeller speed, most of all beside and behind the discs.
      T(L2.chop.gain, M.prop * sz * S.prop * 7 * (0.04 + 0.6 * pw ** 1.5) * turning * (1 + 0.3 * behind));
      T(L2.chop1.frequency, Math.max(5, blades));
      T(L2.chopF.frequency, (350 + 1300 * pw) * dop * S.bright);
      T(L2.rumble.gain, M.bass * run * sz * S.rumble * 0.9 * (0.1 + 0.9 * pw ** 2) * (0.6 + 0.6 * behind));
      T(L2.roar.gain, M.roar * run * sz * S.roar * (0.04 + 0.5 * pw * pw) * (1 + 0.6 * behind) * (1 + 0.5 * sm.rev));
      T(L2.roarF.frequency, (300 + 900 * pw) * S.bright);
      const whine = M.whine * sz * S.core * pr.whineGain * smooth(0.03, 0.15, sm.n2) * (1 - 0.5 * pw);
      const whHz = Math.max(20, pr.whine * S.tone * sm.n2 * dop);
      T(L2.core.gain, whine * 0.012);
      T(L2.core1.frequency, whHz);
      T(L2.wh.gain, whine * 1.2);
      T(L2.whF.frequency, whHz);
    } else {
      const pw = sm.pw;
      const np = sm.np;
      const base = M.engine * (sz * (sm.crank ? 0.2 * sm.crank : 0) + run * sz * (0.2 + 1.0 * pw)) * S.prop;
      T(L2.eng.gain, base);
      T(L2.rough.gain, base * (0.2 + 0.6 * sm.rough + (sm.crank ? 0.5 : 0)));
      T(L2.eng1.frequency, Math.max(1, pr.crank * np * dop));
      T(L2.eng2.frequency, Math.max(1, pr.crank * np * dop * 1.013));
      T(L2.engF.frequency, (250 + 1600 * np ** 1.2) * S.bright);
      const turning = smooth(0.1, 0.3, np);
      T(L2.prop.gain, M.prop * sz * S.prop * 0.6 * turning * (0.03 + 0.3 * pw));
      T(L2.prop1.frequency, Math.max(5, pr.prop * np * dop));
      T(L2.propF.frequency, (300 + 900 * pw) * S.bright);
      T(L2.chop.gain, M.prop * sz * S.prop * 4 * turning * (0.03 + 0.4 * pw ** 1.5) * (1 + 0.3 * behind));
      T(L2.chop1.frequency, Math.max(5, pr.prop * np * dop));
      T(L2.chopF.frequency, (300 + 1000 * pw) * S.bright);
      T(L2.rumble.gain, M.bass * run * sz * S.rumble * 0.7 * (0.15 + 0.85 * pw ** 2));
      T(L2.roar.gain, M.roar * run * sz * S.roar * (0.025 + 0.2 * pw));
      T(L2.roarF.frequency, (250 + 600 * pw) * S.bright);
      T(L2.starter.gain, M.engine * sz * 0.05 * sm.crank);
      T(L2.starter1.frequency, 260 + 260 * clamp01((e.start || 0) / 0.4));
    }
    if (L2.apu) T(L2.apu.gain, M.apu * sz * 0.02 * sm.apu, 0.4);
    // The air past the plane: grows with speed; gear and flaps out on the approach add to it.
    const ms = Math.min(speedMs, 270);
    const dirty = (e.phase === 'approach' || (e.phase === 'landing' && ms > 40)) ? 0.12 : 0;
    const air = M.air * sz * S.air * (0.45 * (ms / 200) ** 1.5 + dirty);
    T(L2.air.gain, air, 0.15);
    T(L2.gust.gain, air * S.gust, 0.15);
    T(L2.airF.frequency, (350 + 4.5 * ms) * dop * S.airHz);
    T(L2.airF2.frequency, (350 + 4.5 * ms) * dop * S.airHz * 1.6);
    T(L2.wind.gain, wind * fade, 0.2);
    T(L2.windF.frequency, 400 + 1.2 * speedMs);

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
    // A jet's start: the recording of its starter whistling up, once, from the start of it (faded out if the start is
    // over sooner, fast-forwarded).
    if (pr.kind === 'jet' && s.rec.start) {
      if (e.start != null && was.start == null && e.start < 0.3 && speed <= 60 && !v.startRec) v.startRec = oneShot(v, s.rec.start, M.start * sz * START_LEVEL * Math.max(S.fan, S.core), at);
      if (v.startRec && e.start == null) { v.startRec.gain.setTargetAtTime(0, at, 0.4); v.startRec = null; }
    }
    v.last = { lit: !!e.lit, phase: e.phase, start: e.start };
  }

  // The mixer changed: every voice takes its parts' levels again (kept with the settings).
  function remix() {
    savePrefs();
    for (const v of s.voices.values()) v.M = mixOf(v.pr.type, v.pr.kind);
    if (s.demo) s.demo.v.M = mixOf(s.demo.v.pr.type, s.demo.v.pr.kind);
  }

  // A new style: every voice is built again in it (keeping where its engines are), the old one fades out.
  function restyle() {
    if (!s.ctx) return;
    const again = (v) => {
      const nv = makeVoice(v.pr);
      Object.assign(nv, { id: v.id, sm: v.sm, last: v.last, nextClick: v.nextClick });
      fadeDrop(v, 0.03);
      return nv;
    };
    for (const [key, v] of s.voices) {
      if (v.kill) { dropVoice(v); s.voices.delete(key); } else s.voices.set(key, again(v));
    }
    if (s.demo) s.demo.v = again(s.demo.v);
  }
  function fadeDrop(v, tau) {
    const at = s.ctx.currentTime;
    v.out.gain.setTargetAtTime(0, at, tau);
    v.L.wind.gain.setTargetAtTime(0, at, tau);
    setTimeout(() => dropVoice(v), tau * 8000);
  }

  // ---------- the preview (Settings → Sound → ▶ Preview) ----------
  // A whole flight in about 40 s, as heard from a chase camera 100 m behind (a little above), on its own voice:
  // the game's planes go quiet meanwhile, and it plays paused or in the menu too. DEMO: [id, label, seconds,
  // (u: 0..1 through it, pr) -> { e: what the engines do, ms: speed (m/s) }]; the levers are levers()'s for a
  // made-up flight state, so it sounds as a plane in the game does.
  const PREVIEW_TYPES = { jet: 'A320neo', turboprop: 'ATR72-600', piston: 'DC-3' };
  const PREVIEW_HEARD = { d: 100, ahead: -0.9, pan: 0, dop: 1, near: false };
  const fs = (phase, speedKmh = 0, altFt = 0) => ({ phase, speedKmh, altFt, fieldFt: 0 });
  const DEMO = [
    ['apu', 'APU', 1.5, (u, pr) => ({ e: { phase: 'boarding', apu: pr.apu ? 1 : 0 } })],
    ['start', 'Engine start', 6, (u, pr) => ({ e: { ...startup(pr, u), phase: 'pushback', start: u, apu: pr.apu ? 1 : 0 }, ms: 0.8 })],
    ['idle', 'Idle', 2, (u, pr) => ({ e: running(pr, fs('taxi-out')) })],
    ['taxi', 'Thrust to taxi', 2.5, (u, pr) => ({ e: running(pr, fs('taxi-out', 25 * u), 1 - smooth(0.5, 0.9, u)), ms: 7 * u })],
    ['takeoff', 'Take-off power', 5, (u, pr) => ({ e: running(pr, fs('takeoff', 290 * u)), ms: 80 * u })],
    ['climb', 'Climb', 3.5, (u, pr) => ({ e: running(pr, fs('climb', 300, 1000 + 8000 * u)), ms: 85 + 60 * u })],
    ['cruise', 'Cruise', 3, (u, pr) => ({ e: running(pr, fs('cruise', 830, 35000)), ms: 230 })],
    ['far', 'Climbing, far away', 4, (u, pr) => ({ e: running(pr, fs('climb', 600, 20000)), ms: 180, d: 6000 })],
    ['descent', 'Descent', 2.5, (u, pr) => ({ e: running(pr, fs('descent', 700, 20000)), ms: 200 })],
    ['approach', 'Approach: gear and flaps', 3.5, (u, pr) => ({ e: running(pr, fs('approach', 260, 3000 * (1 - u) + 60)), ms: 72 })],
    ['flare', 'Over the threshold', 0.7, (u, pr) => ({ e: running(pr, fs('approach', 250, 20)), ms: 70 })],
    ['landing', 'Touchdown, reverse thrust', 3.5, (u, pr) => ({ e: running(pr, fs('landing', 250 * (1 - u) + 30)), ms: 69 * (1 - u) + 8 })],
    ['taxi-in', 'Idle', 1.5, (u, pr) => ({ e: running(pr, fs('taxi-in', 25)), ms: 7 })],
    ['shutdown', 'Run-down', 3.5, (u, pr) => ({ e: { ...rundown(pr, u), phase: 'shutdown', apu: pr.apu && u > 0.35 ? 1 : 0 } })],
    ['end', '', 1.2, (u, pr) => ({ e: { phase: 'turnaround', apu: pr.apu ? 1 : 0 } })],
  ];

  function demoTick(dt, at) {
    const d = s.demo;
    let t0 = 0;
    let seg = null;
    for (const x of DEMO) { if (d.t < t0 + x[2]) { seg = x; break; } t0 += x[2]; }
    if (!seg) { stopPreview(); return; }
    let u = (d.t - t0) / seg[2];
    if (d.hold === seg[0] && u >= 0.75) u = 0.75; // (FG.sound.preview({ hold }): it stays there, to be measured)
    else d.t += dt;
    d.age += dt;
    const x = seg[3](u, d.v.pr);
    const e = { ...OFF, ...x.e };
    const fade = Math.min(1, d.age / 0.3) * (seg[0] === 'end' ? 1 - smooth(0.2, 1, u) : 1);
    // (a flight quicker than a real one: so are the engines. The far part is heard from x.d away, made louder than it
    // would be so it is heard at all; preview({ d }) hears all of it from d away, as loud as in the game.)
    const dist = x.d || d.d;
    const heard = dist ? { ...PREVIEW_HEARD, d: dist, ahead: 0 } : PREVIEW_HEARD;
    const boost = x.d && !d.d ? 0.4 * distGain(PREVIEW_HEARD.d) / distGain(x.d) : 1;
    sound(d.v, e, heard, x.ms || 0, 0, at, dt * 2, 1, fade * boost);
    if (d.seg !== seg[0]) { d.seg = seg[0]; d.label = seg[1]; showPreview(); }
  }
  // (from: a DEMO id to start at, or a time in s; hold: a DEMO id to stay at, three quarters through it; dist: m)
  function startPreview(hold, from = 0, dist = 0, type = null) {
    if (s.demo) fadeDrop(s.demo.v, 0.03);
    const kind = PREVIEW_TYPES[prefs.preview] ? prefs.preview : 'jet';
    const pt = type && D.aircraft[type] ? type : PREVIEW_TYPES[kind]; // (the mixer previews the type it sets)
    let t = typeof from === 'number' ? from : 0;
    if (typeof from === 'string') {
      for (const x of DEMO) { if (x[0] === from) { t += x[0] === hold ? 0.75 * x[2] : 0; break; } t += x[2]; }
    }
    s.demo = { kind, type: type && pt, t, age: 0, hold, d: dist, seg: null, label: '', v: makeVoice(profile(pt)) };
    showPreview();
  }
  function stopPreview() {
    if (!s.demo) return;
    fadeDrop(s.demo.v, 0.05);
    s.demo = null;
    showPreview();
  }
  // The ▶ Preview button (Settings → Sound) shows whether it plays, and where in the flight it is.
  function showPreview() {
    for (const b of document.querySelectorAll('[data-set="preview"]')) {
      b.textContent = s.demo ? '■ Stop' : '▶ Preview';
      b.classList.toggle('on', !!s.demo);
    }
    for (const el of document.querySelectorAll('[data-preview-status]')) el.textContent = s.demo ? s.demo.label : '';
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
    get style() { return prefs.style; },
    styles: Object.entries(STYLES).map(([id, x]) => ({ id, name: x.name, about: x.about })), // (Settings → Sound)
    get previewKind() { return prefs.preview; }, // 'jet', 'turboprop' or 'piston'
    // { on, volume (0..1), style (a STYLES key: the voices playing change at once), preview (the preview's kind) }
    set(o) {
      if (o.on != null) prefs.on = !!o.on;
      if (o.volume != null) prefs.volume = clamp01(Number(o.volume));
      const restyled = o.style && STYLES[o.style] && o.style !== prefs.style;
      if (restyled) prefs.style = o.style;
      const rekind = o.preview && PREVIEW_TYPES[o.preview] && o.preview !== prefs.preview;
      if (rekind) prefs.preview = o.preview;
      savePrefs();
      if (prefs.on) unlock();
      else stopPreview();
      if (restyled) restyle();
      if (rekind && s.demo) startPreview(s.demo.hold, s.demo.t, s.demo.d, s.demo.type); // (on where it was)
      apply();
    },
    toggle() { this.set({ on: !prefs.on }); },
    // ▶ Preview: a whole flight in about 40 s on its own voice (a second call stops it). It turns the sound on (the
    // click lets the browser play it). o: false stops it; { kind } as set({ preview }); to measure, { from, hold }:
    // start at that part of the flight, stay three quarters through that one (DEMO ids: idle, takeoff, climb, cruise,
    // descent, approach, far, …); { d }: heard from d metres away; { type }: that aircraft type. Returns whether it
    // plays.
    preview(o) {
      const opt = o && typeof o === 'object' ? o : {};
      if (o === false || (o == null && s.demo)) { stopPreview(); return false; }
      if (opt.kind) this.set({ preview: opt.kind });
      if (!prefs.on) this.set({ on: true });
      else unlock();
      if (!s.ctx) return false;
      startPreview(opt.hold, opt.from, opt.d, opt.type);
      return true;
    },
    get previewing() { return !!s.demo; },
    get previewType() { return s.demo ? s.demo.v.pr.type : null; },
    // The mixer (F6): parts { id: label }, kindParts { kind: [part ids] }; mix(target) is what is set for 'all', a kind
    // or a type ({ part: × }); mixFor(type) what a plane of that type plays with; setMix(target, part, × or null to
    // take it from the next level again); resetMix(target). Planes playing change at once; kept with the settings.
    parts: PARTS,
    kindParts: KIND_PARTS,
    mix(target) { return { ...(prefs.mix[target] || {}) }; },
    mixFor(type) { const pr = profile(type); return mixOf(type, pr.kind); },
    setMix(target, part, x) {
      const m = prefs.mix[target] || (prefs.mix[target] = {});
      if (x == null || !Number.isFinite(Number(x))) delete m[part]; else m[part] = Math.max(0, Math.min(3, Number(x)));
      if (!Object.keys(m).length) delete prefs.mix[target];
      remix();
    },
    resetMix(target) { delete prefs.mix[target]; remix(); },
    get previewPhase() { return s.demo ? s.demo.label : ''; },
    get previewSeconds() { return DEMO.reduce((a, x) => a + x[2], 0); },
    engines, // (p, t) -> what its engines do now (developer tools, smoke test)
    heardFrom: listener, // where it is heard from now
    profile,
    get state() { return s.ctx ? s.ctx.state : 'off'; },
    get recorded() { return Object.keys(s.rec); }, // (the RECORDINGS that have loaded: 'rumble', 'far', 'start')
    get pickMs() { return s.pickMs || 0; }, // (time to find the loudest planes, 4 times a second)
    // The planes playing now: [{ id, kind, gain }] (smoke test).
    get playing() { return [...s.voices.values()].filter((v) => !v.kill).map((v) => ({ id: v.id, kind: v.pr.kind, gain: v.out.gain.value })); },
    // What it sounds like now: centroid (Hz, how bright, 60 Hz-8 kHz), flat (80-1500 Hz: 0 tones … 1 noise),
    // hf (share above 2.5 kHz: hiss, "static"), bass (share below 250 Hz). Smoke test.
    spectrum() {
      if (!s.ctx) return null;
      const a = new Float32Array(s.meter.frequencyBinCount);
      s.meter.getFloatFrequencyData(a);
      const hz = s.ctx.sampleRate / s.meter.fftSize;
      let sum = 0;
      let sf = 0;
      let hi = 0;
      let lo = 0;
      let logs = 0;
      let band = 0;
      let n = 0;
      for (let i = Math.ceil(60 / hz); i < Math.min(a.length, 8000 / hz); i++) {
        const pw = 10 ** (Math.max(-200, a[i]) / 10);
        sum += pw;
        sf += pw * i * hz;
        if (i * hz > 2500) hi += pw;
        if (i * hz < 250) lo += pw;
        if (i * hz >= 80 && i * hz <= 1500) { logs += Math.log(pw); band += pw; n++; }
      }
      if (!sum) return null;
      return { centroid: Math.round(sf / sum), flat: Math.round(100 * Math.exp(logs / n) / (band / n)) / 100, hf: Math.round(100 * hi / sum) / 100, bass: Math.round(100 * lo / sum) / 100 };
    },
    // The same, each the median of n readings 0.1 s apart (one reading of noise jumps about: ±100 Hz at take-off).
    async spectrumOver(n = 8) {
      const all = [];
      for (let i = 0; i < n; i++) {
        if (i) await new Promise((r) => setTimeout(r, 100));
        const x = this.spectrum();
        if (x) all.push(x);
      }
      if (!all.length) return null;
      const med = (k) => all.map((x) => x[k]).sort((a, b) => a - b)[all.length >> 1];
      return { centroid: med('centroid'), flat: med('flat'), hf: med('hf'), bass: med('bass') };
    },
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
