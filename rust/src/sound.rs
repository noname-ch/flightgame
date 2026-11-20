//! Sound (off until turned on, as in the browser game): each of the loudest planes around the listener has its own
//! voice, its engines made up as they play (src/synth.rs) with the browser game's recordings (`sounds/`) in them,
//! as js/sound.js does: a jet's start (the starter whistling up, the igniters ticking, light-off), the whine at idle,
//! the roar and rumble at take-off power (and from behind), climb and cruise power, quiet on the descent, spooling up
//! on the approach, the tyres at touchdown, reverse thrust, the run-down at the gate and the APU; turboprops' two
//! propellers a little out of tune and the turbine's whistle; piston radials cranking, coughing, a rough idle and
//! the growl at full power. Heard from where you look: the map's centre (higher the further out it is zoomed), or
//! the 3D camera (the followed plane as from close by, on the wing as on it, the fly-by spot hearing it pass with
//! the Doppler drop). Far away a plane turns into the wash of a distant airliner. Fast-forwarded it fades out,
//! paused it is quiet. The sound mixer (F6) sets how loud each part is and which recorded takes play.

use crate::synth::{Banks, Burst, Kind, Set, Shared, SynthSource, VoiceIn};
use flightgame::data::data;
use flightgame::game::{Game, Status, turnaround_min};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// The recorded takes of each looping part (the browser game's banks in js/sound.js): (name, recording).
pub const BASS: [(&str, &[u8]); 4] = [
    ("Rumble", include_bytes!("../../sounds/jet-rumble.wav")),
    ("Growl", include_bytes!("../../sounds/bass-growl.wav")),
    ("Sub", include_bytes!("../../sounds/bass-sub.wav")),
    ("Thunder", include_bytes!("../../sounds/bass-thunder.wav")),
];
pub const ROAR: [(&str, &[u8]); 4] = [
    ("Deep", include_bytes!("../../sounds/roar-deep.wav")),
    ("Blast", include_bytes!("../../sounds/roar-blast.wav")),
    ("Bright", include_bytes!("../../sounds/roar-bright.wav")),
    ("Rush", include_bytes!("../../sounds/roar-rush.wav")),
];
pub const SCREECH: [(&str, &[u8]); 7] = [
    ("Scream", include_bytes!("../../sounds/jet-screech.wav")),
    ("Rasp", include_bytes!("../../sounds/screech-rasp.wav")),
    ("Tearing", include_bytes!("../../sounds/screech-tearing.wav")),
    ("Gritty", include_bytes!("../../sounds/screech-gritty.wav")),
    ("Shriek", include_bytes!("../../sounds/screech-shriek.wav")),
    ("Turbojet", include_bytes!("../../sounds/screech-turbojet.wav")),
    ("Turbulent", include_bytes!("../../sounds/screech-turbulent.wav")),
];
/// each screech take's own pitch (Hz), as js/sound.js's BANKS
const SCREECH_HZ: [f32; 7] = [1360.0, 1407.0, 1464.0, 1400.0, 1605.0, 1617.0, 1200.0];
const FAR: &[u8] = include_bytes!("../../sounds/far-wash.wav");
const START: &[u8] = include_bytes!("../../sounds/jet-start.wav");

/// The parts of the planes' sound the mixer sets (the first three also pick a take).
pub const PARTS: [&str; 10] = ["Bass and rumble", "Roar", "Screech", "Far away", "Engine start", "Whine", "Propellers", "Engine (pistons)", "Air rushing past", "APU"];

fn ones5() -> [f32; 5] {
    [1.0; 5]
}
fn one() -> f32 {
    1.0
}

/// The mixer's settings: how loud each part is (1 = as made), which take the bass, roar and screech play, and
/// the screech's pitch and speed.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Mix {
    /// bass, roar, screech, far, start
    pub level: [f32; 5],
    pub take: [usize; 3],
    pub pitch: f32,
    /// whine, propellers, pistons, air, APU
    #[serde(default = "ones5")]
    pub more: [f32; 5],
    #[serde(default = "one")]
    pub speed: f32,
}

impl Default for Mix {
    fn default() -> Self {
        Mix { level: [1.0; 5], take: [0, 0, 0], pitch: 1.0, more: [1.0; 5], speed: 1.0 }
    }
}

impl Mix {
    /// Part k of PARTS.
    pub fn part_mut(&mut self, k: usize) -> &mut f32 {
        if k < 5 { &mut self.level[k] } else { &mut self.more[k - 5] }
    }
}

/// Where the sound is heard from: a spot (m above the ground), the way it looks, and the plane the 3D camera goes
/// with ("chase", "wing" or "flyby").
#[derive(Clone, Debug, Default)]
pub struct Ear {
    pub lat: f64,
    pub lon: f64,
    pub h: f64,
    pub bearing: f64,
    pub follow: Option<String>,
    pub cam: &'static str,
}

const VOICES: usize = 4;
/// game minutes an engine start takes (from the pushback), and the run-down at the gate
const START_MIN: f64 = 1.2;
const STOP_MIN: f64 = 0.8;
/// game seconds the engines take to follow the levers
const SPOOL: f64 = 2.5;
/// metres: as loud as it gets from here in
const REF: f64 = 40.0;
const IDLE: f64 = 0.21;
const SPEED_OF_SOUND: f64 = 343.0;
/// metres: from here the made-up voice gives way to the far recording, all of it by there
const FAR_AT: (f64, f64) = (800.0, 4000.0);
const FAR_LEVEL: f64 = 2.5;
const SCREECH_LEVEL: f64 = 5.0;
const START_LEVEL: f64 = 0.3;

/// The browser game's 'Standard' style (js/sound.js STYLES.standard).
mod style {
    pub const ROAR: f64 = 1.0;
    pub const ROAR_LO: f64 = 200.0;
    pub const ROAR_HI: f64 = 1900.0;
    pub const ROAR_POW: f64 = 1.6;
    pub const ROAR_SPREAD: f64 = 2.0;
    pub const RUMBLE: f64 = 1.3;
    pub const CRACKLE: f64 = 0.0;
    pub const DRONE: f64 = 0.0;
    pub const FAN: f64 = 0.35;
    pub const CORE: f64 = 0.3;
    pub const TONE: f64 = 1.0;
    pub const SCREECH: f64 = 1.0;
    pub const AIR: f64 = 2.4;
    pub const AIR_HZ: f64 = 1.0;
    pub const GUST: f64 = 0.3;
    pub const TOP: f64 = 16000.0;
    pub const LEVEL: f64 = 1.0;
    pub const PROP: f64 = 1.0;
    pub const BRIGHT: f64 = 1.0;
}

fn clamp01(x: f64) -> f64 {
    x.clamp(0.0, 1.0)
}
fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let k = clamp01((x - a) / (b - a));
    k * k * (3.0 - 2.0 * k)
}
fn hash_str(s: &str) -> f64 {
    let mut h: u32 = 2166136261;
    for c in s.encode_utf16() {
        h = (h ^ c as u32).wrapping_mul(16777619);
    }
    h as f64 / 4294967296.0
}

/// What makes a type's sound (js/sound.js profile()).
#[derive(Clone, Debug)]
struct Profile {
    kind: Kind,
    old: bool,
    fan: f64,
    fan_lo: f64,
    fan_hi: f64,
    shaft: f64,
    core: f64,
    apu: bool,
    afterburner: bool,
    prop: f64,
    whine: f64,
    whine_gain: f64,
    crank: f64,
    rev: f64,
    size: f64,
    apu_hz: f64,
}

fn profile(kind: &str) -> Profile {
    let ac = data().ac(kind);
    let eng = ac.eng.as_str();
    let j = 0.94 + 0.12 * hash_str(kind);
    let four = eng.ends_with('4') || eng == "concorde";
    let mut p = Profile { kind: Kind::Jet, old: false, fan: 0.0, fan_lo: 0.0, fan_hi: 0.0, shaft: 0.0, core: 0.0, apu: true, afterburner: false, prop: 0.0, whine: 0.0, whine_gain: 1.0, crank: 0.0, rev: 1.0, size: 1.0, apu_hz: 1900.0 * (0.97 + 0.06 * hash_str(&format!("{kind}apu"))) };
    if eng == "radial2" || eng == "prop3" {
        p.kind = Kind::Piston;
        p.crank = 40.0 * j;
        p.prop = 72.0 * j;
        p.apu = false;
    } else if eng == "prop2" {
        let old = ac.year < 1975;
        p.kind = Kind::Turboprop;
        p.prop = if old { 80.0 } else { 104.0 } * j;
        p.whine = if old { 2000.0 } else { 2200.0 } * j;
        p.whine_gain = if old { 2.0 } else { 1.0 };
        p.apu = !old;
    } else {
        p.old = eng == "concorde" || (ac.year < 1970 && !ac.big_fan);
        let fan = (if ac.big_fan { 1300.0 } else if ac.category == "widebody" { 1700.0 } else if ac.category == "regional" { 3100.0 } else { 2500.0 }) * j;
        p.fan = fan;
        p.fan_lo = fan * 0.26;
        p.fan_hi = fan * 0.5;
        p.shaft = fan / if ac.big_fan { 20.0 } else { 30.0 };
        p.core = if p.old { 2600.0 } else { 2200.0 } * j;
        p.afterburner = eng == "concorde";
    }
    p.size = (0.5 + (ac.seats.max(1) as f64).sqrt() / 25.0).min(1.25) * if four { 1.1 } else { 1.0 };
    p
}

/// What the engines do (js/sound.js engines()): run (burning fuel), pw (jet fan speed N1, turboprop or piston
/// power), np (propeller or piston engine speed), n2 (core speed: the whine), rev, apu, crank, rough, and the
/// start's moments.
#[derive(Clone, Debug, Default)]
struct Eng {
    run: f64,
    pw: f64,
    np: f64,
    n2: f64,
    rev: f64,
    apu: f64,
    crank: f64,
    rough: f64,
    pops: bool,
    ign: bool,
    lit: bool,
    start: Option<f64>,
    phase: &'static str,
}

/// The levers by phase (js/sound.js levers()).
fn levers(pr: &Profile, phase: &str, agl: f64, speed_kmh: f64) -> Eng {
    let l = |jp: f64, tp: f64, tn: f64, pp: f64, pn: f64, rev: f64| -> Eng {
        let (pw, np) = match pr.kind {
            Kind::Jet => (jp, 0.0),
            Kind::Piston => (pp, pn),
            Kind::Turboprop => (tp, tn),
        };
        Eng { pw, np, rev, ..Default::default() }
    };
    match phase {
        "pushback" => l(IDLE, 0.06, 0.7, 0.1, 0.26, 0.0),
        "taxi-out" | "taxi-in" => l(IDLE, 0.08, 0.72, 0.12, 0.3, 0.0),
        "takeoff" => l(0.93, 1.0, 1.0, 1.0, 1.0, 0.0),
        "climb" => {
            if agl < 450.0 { l(0.93, 0.95, 1.0, 0.95, 0.97, 0.0) } else { l(0.87, 0.85, 0.95, 0.8, 0.88, 0.0) }
        }
        "cruise" => l(0.8, 0.7, 0.85, 0.62, 0.75, 0.0),
        "descent" => l(0.3, 0.2, 0.85, 0.25, 0.65, 0.0),
        "approach" => {
            if agl < 12.0 {
                l(IDLE + 0.04, 0.12, 1.0, 0.15, 0.5, 0.0)
            } else if agl > 700.0 {
                l(0.4, 0.3, 0.9, 0.35, 0.7, 0.0)
            } else {
                l(0.56, 0.4, 1.0, 0.45, 0.85, 0.0)
            }
        }
        "landing" => {
            let r = pr.rev;
            if speed_kmh <= 110.0 {
                l(IDLE, 0.08, 0.75, 0.12, 0.3, 0.0)
            } else {
                l(IDLE + (0.72 - IDLE) * r, 0.08 + 0.47 * r, if r > 0.0 { 1.0 } else { 0.75 }, 0.12 + 0.43 * r, 0.3 + 0.55 * r, r)
            }
        }
        _ => l(IDLE, 0.06, 0.7, 0.1, 0.26, 0.0),
    }
}

/// The core's speed (the whine) with the power set: idle 60 %.
fn core_of(pr: &Profile, pw: f64) -> f64 {
    match pr.kind {
        Kind::Piston => 0.0,
        Kind::Turboprop => 0.6 + 0.4 * pw,
        Kind::Jet => 0.6 + 0.4 * clamp01((pw - IDLE) / (1.0 - IDLE)),
    }
}

/// Starting (u: 0..1 through the start).
fn startup(pr: &Profile, u: f64) -> Eng {
    if pr.kind == Kind::Piston {
        if u < 0.22 {
            return Eng { np: 0.06, crank: 1.0, ..Default::default() };
        }
        if u < 0.4 {
            return Eng { run: 0.5, pw: 0.1, np: 0.06 + 0.3 * smooth(0.22, 0.4, u), crank: 1.0 - smooth(0.3, 0.4, u), pops: true, ..Default::default() };
        }
        return Eng { run: 1.0, pw: 0.1, np: 0.36 - 0.1 * smooth(0.4, 0.7, u), rough: 1.0 - 0.7 * smooth(0.4, 1.0, u), ..Default::default() };
    }
    let tp = pr.kind == Kind::Turboprop;
    if u < 0.3 {
        let k = u / 0.3;
        return Eng { n2: 0.25 * k, ign: u > 0.15, ..Default::default() };
    }
    let k = smooth(0.3, 1.0, u);
    Eng {
        run: clamp01((u - 0.3) / 0.06),
        n2: 0.25 + 0.35 * k,
        pw: if tp { 0.06 * k } else { 0.03 + (IDLE - 0.03) * k },
        np: if tp { 0.7 * k } else { 0.0 },
        ign: u < 0.42,
        lit: true,
        ..Default::default()
    }
}

/// Running down at the gate (u: 0..1 since the fuel was cut).
fn rundown(pr: &Profile, u: f64) -> Eng {
    match pr.kind {
        Kind::Piston => Eng { np: 0.26 * (-10.0 * u).exp(), ..Default::default() },
        Kind::Turboprop => Eng { np: 0.7 * (-5.0 * u).exp(), n2: 0.6 * (-2.5 * u).exp(), ..Default::default() },
        Kind::Jet => Eng { pw: IDLE * (-4.0 * u).exp(), n2: 0.6 * (-2.2 * u).exp(), ..Default::default() },
    }
}

/// The browser game's phase for the Rust track's.
fn phase_of(phase: &str) -> &'static str {
    match phase {
        "Boarding" => "boarding",
        "Pushback" => "pushback",
        "Taxiing to the runway" => "taxi-out",
        "Take-off run" => "takeoff",
        "Climbing" => "climb",
        "Cruising" => "cruise",
        "Descending" => "descent",
        "Final approach" => "approach",
        "Landing" => "landing",
        "Taxiing to the stand" => "taxi-in",
        _ => "gate",
    }
}

/// Where plane i is and what its engines do at game time t: (lat, lon, height above the ground m, heading,
/// speed m/s, engines).
fn plane_at(game: &Game, i: usize, t: f64, pr: &Profile) -> (f64, f64, f64, f64, f64, Eng) {
    let p = &game.state.planes[i];
    let pos = game.flight_pos(i, t);
    let agl = pos.alt_ft * 0.3048;
    let ms = pos.speed_kt * 0.5144;
    let ph = phase_of(pos.phase);
    let mut e = Eng { phase: ph, ..Default::default() };
    match (&p.flight, p.status) {
        (Some(_), Status::Flying) => {
            // (engines start with the pushback: before it the plane is boarding, on its APU)
            let m = pos.since_push;
            let u = m / START_MIN;
            if m < 0.0 {
                e.apu = if pr.apu { 1.0 } else { 0.0 };
            } else if u < 1.0 {
                e = startup(pr, u.max(0.0));
                e.start = Some(u.max(0.0));
                e.apu = if pr.apu { 1.0 } else { 0.0 };
                e.phase = ph;
            } else {
                e = levers(pr, ph, agl, ms * 3.6);
                e.run = 1.0;
                e.n2 = core_of(pr, e.pw);
                e.phase = ph;
            }
        }
        (_, Status::Turnaround) if !p.repair => {
            let since = t - (p.ready_at - turnaround_min(&p.kind)) as f64;
            let apu = if pr.apu && since > 0.3 { 1.0 } else { 0.0 };
            if (0.0..STOP_MIN).contains(&since) {
                e = rundown(pr, since / STOP_MIN);
                e.phase = "shutdown";
            }
            e.apu = apu;
        }
        _ => {}
    }
    (pos.lat, pos.lon, agl, pos.heading, ms, e)
}

/// How loud the engines are before distance (to pick the planes that get a voice).
fn loudness(pr: &Profile, e: &Eng) -> f64 {
    pr.size * (e.run * (0.15 + 0.85 * e.pw * e.pw) + 0.06 * e.n2 + 0.05 * e.np + 0.04 * e.apu + 0.06 * e.crank)
}
/// (softer than the real inverse distance: zoomed in on an airport its planes are heard, zoomed out it goes quiet)
fn dist_gain(d: f64) -> f64 {
    (REF / d.max(1.0)).powf(0.8).min(1.0)
}

/// The plane as heard from the ear: distance (m), ahead (1 straight ahead of the plane … -1 behind), pan, Doppler,
/// on the wing.
struct Heard {
    d: f64,
    ahead: f64,
    pan: f64,
    dop: f64,
    near: bool,
}

fn geometry(ear: &Ear, id: &str, lat: f64, lon: f64, h: f64, heading: f64, ms: f64) -> Heard {
    let mut dlon = lon - ear.lon;
    if dlon > 180.0 {
        dlon -= 360.0;
    }
    if dlon < -180.0 {
        dlon += 360.0;
    }
    let east = dlon * 111_320.0 * ear.lat.to_radians().cos();
    let north = (lat - ear.lat) * 110_574.0;
    let up = h - ear.h;
    let mut d = (east * east + north * north + up * up).sqrt();
    let hd = heading.to_radians();
    let ahead = if d > 1.0 { -(east * hd.sin() + north * hd.cos()) / d } else { 0.0 };
    let b = ear.bearing.to_radians();
    let mut pan = if d > 1.0 { (east * b.cos() - north * b.sin()) / d } else { 0.0 };
    let mut dop = 1.0 / (1.0 - (ms / SPEED_OF_SOUND).min(0.4) * ahead);
    let mut near = false;
    if ear.follow.as_deref() == Some(id) && ear.cam != "flyby" {
        // the camera goes with it: as from close by (on the wing: on it), no Doppler
        near = ear.cam == "wing";
        d = if near { 14.0 } else { d.clamp(40.0, 160.0) };
        dop = 1.0;
        if near {
            pan = 0.0;
        }
    }
    Heard { d, ahead, pan, dop: dop.clamp(0.6, 1.7), near }
}

/// What the game side keeps of a voice.
#[derive(Default)]
struct Kept {
    sm: Eng,
    lit: bool,
    phase: &'static str,
    started: bool,
    start_rec: bool,
    next_click: f64,
}

pub struct Sound {
    pub on: bool,
    pub volume: f32,
    pub mix: Mix,
    device: Option<rodio::MixerDeviceSink>,
    shared: Arc<Mutex<Shared>>,
    profiles: HashMap<String, Profile>,
    kept: HashMap<String, Kept>,
    picked: Vec<String>,
    tick: u64,
    clock: f64,
    rng: u64,
    pub status: String,
}

impl Sound {
    pub fn new() -> Self {
        Sound {
            on: false,
            volume: 0.7,
            mix: Mix::default(),
            device: None,
            shared: Arc::new(Mutex::new(Shared::default())),
            profiles: HashMap::new(),
            kept: HashMap::new(),
            picked: Vec::new(),
            tick: 0,
            clock: 0.0,
            rng: 0x1234_5678,
            status: String::new(),
        }
    }

    fn rand(&mut self) -> f64 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        (self.rng >> 11) as f64 / (1u64 << 53) as f64
    }

    pub fn toggle(&mut self) {
        self.on = !self.on;
        if self.on && self.device.is_none() {
            match rodio::DeviceSinkBuilder::open_default_sink() {
                Ok(mut dev) => {
                    dev.log_on_drop(false);
                    let banks = Arc::new(Banks::new(
                        &BASS.map(|x| x.1),
                        &ROAR.map(|x| x.1),
                        &SCREECH.map(|x| x.1),
                        FAR,
                        START,
                    ));
                    dev.mixer().add(SynthSource::new(banks, self.shared.clone()));
                    self.device = Some(dev);
                    self.status = String::new();
                }
                Err(e) => {
                    self.status = format!("No sound device: {e}");
                    self.on = false;
                }
            }
        }
        if !self.on {
            if let Ok(mut sh) = self.shared.lock() {
                sh.master = 0.0;
            }
        }
    }

    fn profile(&mut self, kind: &str) -> Profile {
        self.profiles.entry(kind.to_string()).or_insert_with(|| profile(kind)).clone()
    }

    /// Sets the voices for the planes around the ear. `speed`: game minutes a second; `dt`: real seconds since the
    /// last call.
    pub fn update(&mut self, game: &Game, t: f64, ear: &Ear, speed: f64, running: bool, dt: f64) {
        if !self.on {
            return;
        }
        self.clock += dt;
        let fade = if !running { 0.0 } else if speed > 300.0 { (1.0 - (speed - 300.0) / 900.0).max(0.0) } else { 1.0 };
        let dt_game = dt * speed * 60.0; // (game seconds)
        // the loudest planes, picked a few times a second (the ones playing count a little more, so they don't flicker)
        if fade > 0.0 && self.tick % 6 == 0 {
            let far = ear.h > 60_000.0;
            let mut out: Vec<(f64, String)> = Vec::new();
            for i in 0..game.state.planes.len() {
                let p = &game.state.planes[i];
                if far && ear.follow.as_deref() != Some(&p.id) {
                    continue;
                }
                let pr = self.profile(&p.kind);
                let (lat, lon, h, hd, ms, e) = plane_at(game, i, t, &pr);
                let g = geometry(ear, &p.id, lat, lon, h, hd, ms);
                if g.d > 40_000.0 {
                    continue;
                }
                let loud = loudness(&pr, &e) * dist_gain(g.d) * if self.picked.contains(&p.id) { 1.5 } else { 1.0 };
                if loud > 0.0015 {
                    out.push((loud, p.id.clone()));
                }
            }
            out.sort_by(|a, b| b.0.total_cmp(&a.0));
            self.picked = out.into_iter().take(VOICES).map(|x| x.1).collect();
        }
        self.tick += 1;
        if fade == 0.0 {
            self.picked.clear();
        }
        let mut ins = Vec::new();
        let picked = self.picked.clone();
        for id in &picked {
            let Some(i) = game.state.planes.iter().position(|p| &p.id == id) else { continue };
            let kind = game.state.planes[i].kind.clone();
            let pr = self.profile(&kind);
            let (lat, lon, h, hd, ms, e) = plane_at(game, i, t, &pr);
            let g = geometry(ear, id, lat, lon, h, hd, ms);
            let wind = if ear.follow.as_deref() == Some(id.as_str()) && ear.cam == "wing" { 0.5 * (ms / 230.0).powi(2).min(1.4) } else { 0.0 };
            let key = format!("{id}|{kind}");
            ins.push(self.voice(&key, &pr, &e, &g, ms, wind, dt_game, speed, fade));
        }
        let keep: Vec<String> = ins.iter().map(|v| v.key.clone()).collect();
        self.kept.retain(|k, _| keep.contains(k));
        if let Ok(mut sh) = self.shared.lock() {
            sh.master = if self.on { self.volume * 0.9 } else { 0.0 };
            sh.voices = ins;
            sh.fresh = true;
        }
    }

    /// Voice `key` (profile pr): engines e, heard as g, at speed ms (m/s), wind on the wing camera (js/sound.js
    /// sound()).
    #[allow(clippy::too_many_arguments)]
    fn voice(&mut self, key: &str, pr: &Profile, e: &Eng, g: &Heard, ms: f64, wind: f64, dt_game: f64, speed: f64, fade: f64) -> VoiceIn {
        use style as S;
        let mx = self.mix.clone();
        let m_bass = mx.level[0] as f64;
        let m_roar = mx.level[1] as f64;
        let m_screech = mx.level[2] as f64;
        let m_far = mx.level[3] as f64;
        let m_start = mx.level[4] as f64;
        let [m_whine, m_prop, m_engine, m_air, m_apu] = mx.more.map(|x| x as f64);
        let fresh = !self.kept.contains_key(key);
        let clock = self.clock;
        let r1 = self.rand();
        let r2 = self.rand();
        let kp = self.kept.entry(key.to_string()).or_insert_with(|| Kept { sm: e.clone(), ..Default::default() });
        // the engines follow the levers with a lag (in game time)
        let k = 1.0 - (-dt_game / SPOOL).exp();
        let k = if e.start.is_some() || e.phase == "shutdown" { k.max(0.5) } else { k };
        let k = if fresh { 1.0 } else { k };
        let sm = &mut kp.sm;
        sm.pw += (e.pw - sm.pw) * k;
        sm.np += (e.np - sm.np) * k;
        sm.n2 += (e.n2 - sm.n2) * k;
        sm.rev += (e.rev - sm.rev) * k;
        sm.run = e.run;
        sm.apu = e.apu;
        sm.crank = e.crank;
        sm.rough = e.rough;
        let sm = sm.clone();
        let sz = pr.size;
        let front = g.ahead.max(0.0);
        let behind = (-g.ahead).max(0.0);
        let dop = g.dop;
        let run = sm.run;
        let mut s = Set { dop: dop as f32, ..Default::default() };
        s.out = (dist_gain(g.d) * fade * S::LEVEL) as f32;
        let far = smooth(FAR_AT.0, FAR_AT.1, g.d);
        s.mix = (1.0 - 0.85 * far) as f32;
        s.far = (m_far * far * FAR_LEVEL * sz * run * (0.05 + 0.95 * sm.pw * sm.pw)) as f32;
        s.air_top = S::TOP.min(if g.near { 16000.0 } else { (16000.0 / (1.0 + g.d / 300.0)).min(16000.0) }) as f32;
        s.pan = (g.pan * 0.8) as f32;
        let mut scr_hz = 0.0;
        match pr.kind {
            Kind::Jet => {
                let n1 = sm.pw;
                let n2 = sm.n2;
                let old = if pr.old { 1.5 } else { 1.0 };
                s.roar = (m_roar * run * sz * S::ROAR * (0.1 + 1.6 * n1.powi(3)) * (1.0 + 0.6 * behind) * (1.0 - 0.2 * front) * old * (1.0 + 0.5 * sm.rev)) as f32;
                let fc = (S::ROAR_LO + S::ROAR_HI * n1.powf(S::ROAR_POW)) * (1.0 + 0.25 * behind + 0.4 * sm.rev) * if pr.old { 1.2 } else { 1.0 };
                s.roar_f = fc as f32;
                s.roar_f2 = (fc * S::ROAR_SPREAD) as f32;
                let rumble = m_bass * run * sz * S::RUMBLE * (0.08 + 1.2 * n1.powi(3)) * (0.5 + behind) * if pr.afterburner && e.phase == "takeoff" { 2.0 } else { 1.0 };
                s.rumble = rumble as f32;
                s.crackle = (rumble * 0.5 * S::CRACKLE * behind * smooth(0.85, 0.92, n1)) as f32;
                s.drone = (m_bass * run * sz * 0.16 * S::DRONE * smooth(0.25, 0.9, n1)) as f32;
                s.drone_hz = (pr.shaft * n1 * dop).max(5.0) as f32;
                s.drone_f = (150.0 + 350.0 * n1) as f32;
                // the whine: clear at idle, it fades under the roar as the power comes up
                let fan_hz = if n1 < IDLE { pr.fan_lo * n1 / IDLE } else { pr.fan_lo + (pr.fan_hi - pr.fan_lo) * (n1 - IDLE) / (1.0 - IDLE) };
                s.fan = (m_whine * sz * 0.16 * S::FAN * smooth(0.04, 0.18, n1) * (0.6 + 0.9 * front) * if pr.old { 0.35 } else { 1.0 } * (1.0 - 0.75 * smooth(0.3, 0.9, n1))) as f32;
                s.fan_hz = (fan_hz * dop).max(20.0) as f32;
                s.core = (m_whine * sz * 0.035 * S::CORE * smooth(0.02, 0.12, n2) * if pr.old { 2.0 } else { 1.0 } * (1.0 - 0.8 * n1)) as f32;
                s.core_hz = (pr.core * S::TONE * n2 * dop).max(20.0) as f32;
                // the screech: up with the power, from all round (a little more ahead), old jets more
                scr_hz = (1.15 * pr.fan * (0.55 + 0.45 * n1)).min(1550.0) * dop * mx.pitch as f64;
                s.screech = (m_screech * run * sz * SCREECH_LEVEL * S::SCREECH * (0.04 + 0.96 * smooth(0.25, 0.9, n1)) * (0.8 + 0.4 * front) * if pr.old { 1.3 } else { 1.0 }) as f32;
                let take_hz = SCREECH_HZ[mx.take[2].min(SCREECH_HZ.len() - 1)] as f64;
                let pitch = scr_hz / take_hz;
                s.scr_pitch = pitch as f32;
                s.scr_speed = (pitch / (mx.pitch as f64).max(0.05) * mx.speed as f64) as f32;
            }
            Kind::Turboprop => {
                let (pw, np) = (sm.pw, sm.np);
                let blades = pr.prop * np * dop;
                let turning = smooth(0.05, 0.4, np);
                s.prop = (m_prop * sz * S::PROP * 0.6 * (0.05 + 0.5 * pw.powf(1.3)) * turning * (1.0 + 0.3 * front)) as f32;
                s.prop_hz = blades.max(5.0) as f32;
                s.prop_f = ((250.0 + 900.0 * pw + 200.0 * np) * dop * S::BRIGHT) as f32;
                s.chop = (m_prop * sz * S::PROP * 7.0 * (0.04 + 0.6 * pw.powf(1.5)) * turning * (1.0 + 0.3 * behind)) as f32;
                s.chop_f = ((350.0 + 1300.0 * pw) * dop * S::BRIGHT) as f32;
                s.rumble = (m_bass * run * sz * S::RUMBLE * 0.9 * (0.1 + 0.9 * pw * pw) * (0.6 + 0.6 * behind)) as f32;
                s.roar = (m_roar * run * sz * S::ROAR * (0.04 + 0.5 * pw * pw) * (1.0 + 0.6 * behind) * (1.0 + 0.5 * sm.rev)) as f32;
                s.roar_f = ((300.0 + 900.0 * pw) * S::BRIGHT) as f32;
                let whine = m_whine * sz * S::CORE * pr.whine_gain * smooth(0.03, 0.15, sm.n2) * (1.0 - 0.5 * pw);
                s.core = (whine * 0.012) as f32;
                s.core_hz = (pr.whine * S::TONE * sm.n2 * dop).max(20.0) as f32;
                s.wh = (whine * 1.2) as f32;
            }
            Kind::Piston => {
                let (pw, np) = (sm.pw, sm.np);
                let base = m_engine * (sz * if sm.crank > 0.0 { 0.2 * sm.crank } else { 0.0 } + run * sz * (0.2 + pw)) * S::PROP;
                s.eng = base as f32;
                s.rough = (base * (0.2 + 0.6 * sm.rough + if sm.crank > 0.0 { 0.5 } else { 0.0 })) as f32;
                s.eng_hz = (pr.crank * np * dop).max(1.0) as f32;
                s.eng_f = ((250.0 + 1600.0 * np.powf(1.2)) * S::BRIGHT) as f32;
                let turning = smooth(0.1, 0.3, np);
                s.prop = (m_prop * sz * S::PROP * 0.6 * turning * (0.03 + 0.3 * pw)) as f32;
                s.prop_hz = (pr.prop * np * dop).max(5.0) as f32;
                s.prop_f = ((300.0 + 900.0 * pw) * S::BRIGHT) as f32;
                s.chop = (m_prop * sz * S::PROP * 4.0 * turning * (0.03 + 0.4 * pw.powf(1.5)) * (1.0 + 0.3 * behind)) as f32;
                s.chop_f = ((300.0 + 1000.0 * pw) * S::BRIGHT) as f32;
                s.rumble = (m_bass * run * sz * S::RUMBLE * 0.7 * (0.15 + 0.85 * pw * pw)) as f32;
                s.roar = (m_roar * run * sz * S::ROAR * (0.025 + 0.2 * pw)) as f32;
                s.roar_f = ((250.0 + 600.0 * pw) * S::BRIGHT) as f32;
                s.starter = (m_engine * sz * 0.05 * sm.crank) as f32;
                s.starter_hz = (260.0 + 260.0 * clamp01(e.start.unwrap_or(0.0) / 0.4)) as f32;
            }
        }
        if pr.apu {
            s.apu = (m_apu * sz * 0.02 * sm.apu) as f32;
        }
        // the air past the plane: grows with speed; gear and flaps out on the approach add to it
        let msc = ms.min(270.0);
        let dirty = if e.phase == "approach" || (e.phase == "landing" && msc > 40.0) { 0.12 } else { 0.0 };
        let air = m_air * sz * S::AIR * (0.45 * (msc / 200.0).powf(1.5) + dirty);
        s.air = air as f32;
        s.gust = (air * S::GUST) as f32;
        s.air_f = ((350.0 + 4.5 * msc) * dop * S::AIR_HZ) as f32;
        s.wind = (wind * fade) as f32;
        s.wind_f = (400.0 + 1.2 * ms) as f32;

        // one-off sounds (not fast-forwarded much: they would rattle)
        let mut bursts = Vec::new();
        let b = |ftype: u8, f: f64, q: f64, dur: f64, level: f64, attack: f64, delay: f64| Burst { ftype, f: f as f32, q: q as f32, dur: dur as f32, level: level as f32, attack: attack as f32, delay: delay as f32 };
        if speed <= 10.0 {
            if e.lit && !kp.lit {
                bursts.push(b(0, 160.0, 0.8, 1.1, sz * 2.0, 0.08, 0.0)); // light-off
            }
            if e.phase == "landing" && (kp.phase == "approach" || kp.phase == "descent") {
                // touchdown: the tyres
                bursts.push(b(1, 1700.0, 2.5, 0.22, sz * 0.5, 0.004, 0.0));
                bursts.push(b(1, 1500.0, 2.5, 0.2, sz * 0.4, 0.004, 0.11));
            }
            if e.ign && clock > kp.next_click {
                bursts.push(b(2, 2500.0, 0.7, 0.03, sz * 0.25, 0.001, 0.0)); // the igniters ticking
                kp.next_click = clock + 0.52;
            }
            if e.pops && r1 < 0.22 {
                bursts.push(b(0, 380.0, 1.0, 0.14, sz * 1.5, 0.004, r2 * 0.04)); // a cough
            }
        }
        // a jet's start: the starter whistling up, once (faded out if the start is over sooner)
        let mut start = None;
        if pr.kind == Kind::Jet {
            if let Some(u) = e.start {
                if !kp.started && u < 0.3 && speed <= 2.0 {
                    start = Some((m_start * sz * START_LEVEL * style::FAN.max(style::CORE)) as f32);
                    kp.start_rec = true;
                }
                kp.started = true;
            } else {
                if kp.start_rec {
                    start = Some(0.0);
                    kp.start_rec = false;
                }
                kp.started = false;
            }
        }
        kp.lit = e.lit;
        kp.phase = e.phase;
        VoiceIn {
            key: key.to_string(),
            kind: pr.kind,
            takes: [mx.take[0], mx.take[1], mx.take[2]],
            scr_hz: scr_hz as f32,
            apu_hz: pr.apu_hz as f32,
            set: s,
            bursts,
            start,
            alive: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flightgame::config::DAY;

    /// Renders `secs` of the planes heard from `ear` around game time t (the game standing still at speed 1),
    /// without a sound device: (left, right) samples.
    fn render(g: &Game, t: f64, ear: &Ear, secs: f64) -> Vec<(f32, f32)> {
        let mut s = Sound::new();
        s.on = true;
        let banks = Arc::new(Banks::new(&BASS.map(|x| x.1), &ROAR.map(|x| x.1), &SCREECH.map(|x| x.1), FAR, START));
        let mut src = SynthSource::new(banks, s.shared.clone());
        let mut out = Vec::new();
        let steps = (secs / 0.02) as usize;
        for k in 0..steps {
            // (game time moves at speed 1: a game minute a second)
            s.update(g, t + k as f64 * 0.02, ear, 1.0, true, 0.02);
            for _ in 0..(crate::synth::RATE as f64 * 0.02) as usize {
                let l = src.next().unwrap();
                let r = src.next().unwrap();
                out.push((l, r));
            }
        }
        if std::env::var("FLIGHTGAME_WAV").is_ok() {
            s.update(g, t + steps as f64 * 0.02, ear, 1.0, true, 0.02);
            for v in &s.shared.lock().unwrap().voices {
                eprintln!("  {} air {:.3} roar {:.3} rumble {:.3} screech {:.3} fan {:.4} apu {:.3} out {:.3} mix {:.2} far {:.3}", v.key, v.set.air, v.set.roar, v.set.rumble, v.set.screech, v.set.fan, v.set.apu, v.set.out, v.set.mix, v.set.far);
            }
        }
        out
    }

    fn write_wav(path: &str, x: &[(f32, f32)]) {
        let mut b: Vec<u8> = Vec::new();
        let n = (x.len() * 4) as u32;
        b.extend(b"RIFF");
        b.extend((36 + n).to_le_bytes());
        b.extend(b"WAVEfmt ");
        b.extend(16u32.to_le_bytes());
        b.extend(1u16.to_le_bytes());
        b.extend(2u16.to_le_bytes());
        b.extend(crate::synth::RATE.to_le_bytes());
        b.extend((crate::synth::RATE * 4).to_le_bytes());
        b.extend(4u16.to_le_bytes());
        b.extend(16u16.to_le_bytes());
        b.extend(b"data");
        b.extend(n.to_le_bytes());
        for (l, r) in x {
            b.extend(((l.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
            b.extend(((r.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
        }
        std::fs::write(path, b).unwrap();
    }

    fn rms(x: &[(f32, f32)]) -> f32 {
        (x.iter().map(|(l, r)| l * l + r * r).sum::<f32>() / (2 * x.len().max(1)) as f32).sqrt()
    }

    /// A plane of the "European network" quick start in each phase near its airport, heard from beside the runway
    /// or the stand: loud at take-off, the voices finite and not clipping, quiet far away. FLIGHTGAME_WAV=<folder>
    /// writes what it heard as .wav files.
    #[test]
    fn engines_heard() {
        let pr = data().presets.iter().find(|p| p.id == "europe").expect("europe preset");
        let (mut g, _) = Game::from_preset(pr);
        g.advance(DAY / 2);
        let t0 = g.state.time as f64;
        let dir = std::env::var("FLIGHTGAME_WAV").ok();
        let mut levels: HashMap<&str, f32> = HashMap::new();
        let mut was: HashMap<String, &str> = HashMap::new();
        // the game minute by minute (planes leave their gates), each phase heard as it begins
        for _ in 0..2 * DAY {
            if levels.len() == 4 {
                break;
            }
            g.advance(1);
            for sub in 0..20 {
                let t = g.state.time as f64 + sub as f64 * 0.05;
                for i in 0..g.state.planes.len() {
                    let pos = g.flight_pos(i, t);
                    let p = &g.state.planes[i];
                    let at_gate = p.status == Status::Turnaround && t - (p.ready_at - turnaround_min(&p.kind)) as f64 > 1.0;
                    let ph = phase_of(pos.phase);
                    let key = if at_gate { "gate" } else if ph == "gate" { "arrived" } else { ph };
                    let begins = was.get(&p.id).is_some_and(|w| *w != key);
                    was.insert(p.id.clone(), key);
                    if !["takeoff", "approach", "cruise", "gate"].contains(&key) || levels.contains_key(key) || !begins {
                        continue;
                    }
                    // beside it: 150 m off to its right, 20 m up
                    let r = (pos.heading + 90.0).to_radians();
                    let (lat, lon) = (pos.lat + r.cos() * 150.0 / 110_574.0, pos.lon + r.sin() * 150.0 / (111_320.0 * pos.lat.to_radians().cos()));
                    let ear = Ear { lat, lon, h: pos.alt_ft * 0.3048 + 20.0, bearing: pos.heading, follow: None, cam: "" };
                    let secs = if key == "takeoff" { 0.6 } else { 2.0 };
                    eprintln!("{key}:");
                    let x = render(&g, t, &ear, secs);
                    assert!(x.iter().all(|(l, r)| l.is_finite() && r.is_finite()), "{key}: not finite");
                    let peak = x.iter().fold(0.0f32, |m, (l, r)| m.max(l.abs()).max(r.abs()));
                    assert!(peak <= 1.0, "{key}: clipping {peak}");
                    levels.insert(key, rms(&x[x.len() / 3..]));
                    if let Some(d) = &dir {
                        write_wav(&format!("{d}/{key}.wav"), &x);
                    }
                }
            }
        }
        eprintln!("levels {levels:?}");
        assert!(levels.get("takeoff").copied().unwrap_or(0.0) > 0.02, "{levels:?}");
        if let (Some(a), Some(b)) = (levels.get("takeoff"), levels.get("gate")) {
            assert!(a > b, "take-off louder than the APU at the gate: {levels:?}");
        }
        // far away and high: nearly nothing
        let ear = Ear { lat: 0.0, lon: -140.0, h: 100.0, ..Default::default() };
        assert!(rms(&render(&g, t0, &ear, 0.5)) < 1e-4);
    }

    #[test]
    fn recordings_decode() {
        let all = super::BASS.iter().chain(super::ROAR.iter()).chain(super::SCREECH.iter()).map(|x| x.1);
        for b in all.chain([super::FAR, super::START]) {
            assert!(rodio::Decoder::try_from(std::io::Cursor::new(b)).is_ok());
        }
    }
}
