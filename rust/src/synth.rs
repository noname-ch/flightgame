//! The planes' engines made up as they play, as the browser game's js/sound.js does with Web Audio: each of the
//! loudest few planes near the listener is a voice of oscillators, noise and the recorded takes through filters
//! (jets: roar, rumble, fan whine, core whine, screech; turboprops: two propellers a little out of tune, the air they
//! chop, the turbine's whistle; pistons: the radial's beat, a rough idle, the starter; the APU, the air rushing past,
//! the wind on the wing camera, far away the wash of a distant airliner), panned and muffled with distance, the
//! Doppler drop as it passes. The game sets each voice's targets (`Set`) a few dozen times a second
//! (src/sound.rs); this side glides to them and renders the samples (a rodio Source on the audio thread).

use rodio::Source;
use std::f32::consts::PI;
use std::num::NonZero;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const RATE: u32 = 44_100;
const SR: f32 = RATE as f32;
/// samples between filter coefficient updates
const BLOCK: usize = 32;

/// What makes the sound of a kind of engine.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Jet,
    Turboprop,
    Piston,
}

/// A voice's targets, set by the game (levels are linear gains, frequencies in Hz, rates × as recorded).
#[derive(Clone, Default, Debug)]
pub struct Set {
    pub out: f32,
    pub mix: f32,
    pub far: f32,
    pub dop: f32,
    pub air_top: f32,
    pub pan: f32,
    pub roar: f32,
    pub roar_f: f32,
    pub roar_f2: f32,
    pub rumble: f32,
    pub crackle: f32,
    pub drone: f32,
    pub drone_hz: f32,
    pub drone_f: f32,
    pub fan: f32,
    pub fan_hz: f32,
    pub core: f32,
    pub core_hz: f32,
    pub screech: f32,
    pub scr_pitch: f32,
    pub scr_speed: f32,
    pub prop: f32,
    pub prop_hz: f32,
    pub prop_f: f32,
    pub chop: f32,
    pub chop_f: f32,
    pub wh: f32,
    pub eng: f32,
    pub rough: f32,
    pub eng_hz: f32,
    pub eng_f: f32,
    pub starter: f32,
    pub starter_hz: f32,
    pub apu: f32,
    pub air: f32,
    pub gust: f32,
    pub air_f: f32,
    pub wind: f32,
    pub wind_f: f32,
}

/// A short burst of filtered noise (light-off, an igniter's tick, a cough, the tyres at touchdown).
#[derive(Clone, Copy, Debug)]
pub struct Burst {
    /// 0 low-pass, 1 band-pass, 2 high-pass
    pub ftype: u8,
    pub f: f32,
    pub q: f32,
    pub dur: f32,
    pub level: f32,
    pub attack: f32,
    pub delay: f32,
}

/// What the game hands the audio thread for one voice.
#[derive(Clone, Debug)]
pub struct VoiceIn {
    pub key: String,
    pub kind: Kind,
    /// the takes it plays: rumble, roar, screech (indexes into the banks) and the screech take's own pitch (Hz)
    pub takes: [usize; 3],
    pub scr_hz: f32,
    pub apu_hz: f32,
    /// the bass shelf (dB) and the rumble's low-pass (Hz)
    pub set: Set,
    pub bursts: Vec<Burst>,
    /// start the starter's recording (level), or fade it out (0)
    pub start: Option<f32>,
    /// false: fade out and drop
    pub alive: bool,
}

/// The sounds the voices play, decoded once.
pub struct Banks {
    pub rumble: Vec<Arc<Vec<f32>>>,
    pub roar: Vec<Arc<Vec<f32>>>,
    pub screech: Vec<Arc<Vec<f32>>>,
    pub far: Arc<Vec<f32>>,
    pub start: Arc<Vec<f32>>,
    pub white: Arc<Vec<f32>>,
    pub pink: Arc<Vec<f32>>,
    pub brown: Arc<Vec<f32>>,
    pub wobble: Arc<Vec<f32>>,
    blade: Arc<Vec<f32>>,
    radial: Arc<Vec<f32>>,
}

/// A recording at 44.1 kHz mono, at the rms given.
pub fn decode(bytes: &'static [u8], rms: f32) -> Arc<Vec<f32>> {
    let Ok(d) = rodio::Decoder::try_from(std::io::Cursor::new(bytes)) else { return Arc::new(vec![0.0; 1000]) };
    let ch = d.channels().get() as usize;
    let sr = d.sample_rate().get() as f32;
    let raw: Vec<f32> = d.collect();
    let mono: Vec<f32> = raw.chunks(ch.max(1)).map(|c| c.iter().sum::<f32>() / c.len() as f32).collect();
    // to 44.1 kHz (linear: the recordings hold nothing above 8 kHz)
    let n = ((mono.len() as f32) * SR / sr) as usize;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let x = i as f32 * sr / SR;
        let k = x as usize;
        let f = x - k as f32;
        let a = mono[k.min(mono.len() - 1)];
        let b = mono[(k + 1).min(mono.len() - 1)];
        out.push(a + (b - a) * f);
    }
    let sq = (out.iter().map(|x| x * x).sum::<f32>() / out.len().max(1) as f32).sqrt().max(1e-6);
    for x in &mut out {
        *x *= rms / sq;
    }
    Arc::new(out)
}

#[derive(Clone)]
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        ((self.0 >> 40) as f32 / (1u64 << 24) as f32) * 2.0 - 1.0
    }
}

/// Pink (Paul Kellet's filter) or brown noise, n samples at rms 0.3, looping without a click.
fn coloured(n: usize, pink: bool, rng: &mut Rng) -> Vec<f32> {
    let f = (SR * 0.05) as usize;
    let mut raw = vec![0.0f32; n + f];
    let (mut b0, mut b1, mut b2, mut b3, mut b4, mut b5, mut b6, mut y) = (0.0f32, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    for r in raw.iter_mut() {
        let w = rng.next();
        if pink {
            b0 = 0.99886 * b0 + w * 0.0555179;
            b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.969 * b2 + w * 0.153852;
            b3 = 0.8665 * b3 + w * 0.3104856;
            b4 = 0.55 * b4 + w * 0.5329522;
            b5 = -0.7616 * b5 - w * 0.016898;
            *r = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
            b6 = w * 0.115926;
        } else {
            y = (y + 0.02 * w) / 1.02;
            *r = y;
        }
    }
    let mean = raw.iter().sum::<f32>() / raw.len() as f32;
    let mut d: Vec<f32> = (0..n)
        .map(|i| if i < f { let k = i as f32 / f as f32; raw[i] * k + raw[n + i] * (1.0 - k) } else { raw[i] } - mean)
        .collect();
    let rms = (d.iter().map(|x| x * x).sum::<f32>() / n as f32).sqrt().max(1e-9);
    for x in &mut d {
        *x *= 0.3 / rms;
    }
    d
}

/// One turn of a wave from its harmonics' sine amplitudes, at peak 1 (as Web Audio's periodic waves).
fn wavetable(amps: &[f32]) -> Vec<f32> {
    let n = 2048;
    let mut w: Vec<f32> = (0..n)
        .map(|i| {
            let x = i as f32 / n as f32 * 2.0 * PI;
            amps.iter().enumerate().map(|(k, a)| a * (x * k as f32).sin()).sum()
        })
        .collect();
    let peak = w.iter().fold(0.0f32, |m, x| m.max(x.abs())).max(1e-9);
    for x in &mut w {
        *x /= peak;
    }
    w
}

impl Banks {
    pub fn new(rumble: &[&'static [u8]], roar: &[&'static [u8]], screech: &[&'static [u8]], far: &'static [u8], start: &'static [u8]) -> Banks {
        let mut rng = Rng(0x9e3779b97f4a7c15);
        let n = RATE as usize * 3;
        let white: Vec<f32> = (0..n).map(|_| rng.next()).collect();
        // a slow random wobble: the uneven beat of a piston engine, the air gusting
        let step = (SR / 22.0) as usize;
        let mut wob = vec![0.0f32; n];
        let (mut a, mut b) = (0.0f32, rng.next());
        for i in 0..n {
            if i % step == 0 {
                a = b;
                b = if i + step >= n { wob[0] } else { rng.next() };
            }
            let k = (i % step) as f32 / step as f32;
            wob[i] = a + (b - a) * k * k * (3.0 - 2.0 * k);
        }
        // a radial's exhaust: harmonics of the crank speed, strongest at the firing pulses (7 a turn per row)
        let radial: Vec<f32> = (0..48)
            .map(|k| if k == 0 { 0.0 } else { (if k < 7 { 0.25 } else { 1.0 }) * (if k % 7 == 0 { 2.5 } else if k % 7 == 3 || k % 7 == 4 { 1.4 } else { 1.0 }) / (k as f32).sqrt() })
            .collect();
        // a propeller's blades going by: a soft pulse, its overtones falling off fast
        let blade: Vec<f32> = (0..24).map(|k| if k == 0 { 0.0 } else { 1.0 / (k as f32).powf(1.5) }).collect();
        Banks {
            rumble: rumble.iter().map(|b| decode(b, 0.24)).collect(),
            roar: roar.iter().map(|b| decode(b, 0.3)).collect(),
            screech: screech.iter().map(|b| decode(b, 0.13)).collect(),
            far: decode(far, 0.3),
            start: decode(start, 0.3),
            pink: Arc::new(coloured(n, true, &mut rng)),
            brown: Arc::new(coloured(n, false, &mut rng)),
            white: Arc::new(white),
            wobble: Arc::new(wob),
            blade: Arc::new(wavetable(&blade)),
            radial: Arc::new(wavetable(&radial)),
        }
    }
}

// ---------- building blocks ----------

/// A looping buffer played at a rate (linear interpolation).
#[derive(Clone)]
struct Loop {
    buf: Arc<Vec<f32>>,
    pos: f64,
}
impl Loop {
    fn new(buf: Arc<Vec<f32>>, at: f32) -> Loop {
        let pos = (at.clamp(0.0, 0.99) as f64) * buf.len() as f64;
        Loop { buf, pos }
    }
    #[inline]
    fn tick(&mut self, rate: f32) -> f32 {
        let n = self.buf.len();
        let k = self.pos as usize % n;
        let f = (self.pos - self.pos.floor()) as f32;
        let a = self.buf[k];
        let b = self.buf[(k + 1) % n];
        self.pos += rate as f64;
        if self.pos >= n as f64 {
            self.pos -= n as f64;
        }
        a + (b - a) * f
    }
}

#[derive(Clone, Copy, Default)]
struct Osc {
    ph: f32,
}
impl Osc {
    #[inline]
    fn sine(&mut self, hz: f32) -> f32 {
        self.ph = (self.ph + hz / SR).fract();
        (self.ph * 2.0 * PI).sin()
    }
    #[inline]
    fn table(&mut self, hz: f32, t: &[f32]) -> f32 {
        self.ph = (self.ph + hz / SR).fract();
        let x = self.ph * t.len() as f32;
        let k = x as usize % t.len();
        let f = x.fract();
        t[k] + (t[(k + 1) % t.len()] - t[k]) * f
    }
    #[inline]
    fn saw(&mut self, hz: f32) -> f32 {
        self.ph = (self.ph + hz / SR).fract();
        2.0 * self.ph - 1.0
    }
    #[inline]
    fn triangle(&mut self, hz: f32) -> f32 {
        self.ph = (self.ph + hz / SR).fract();
        1.0 - 4.0 * (self.ph - 0.5).abs()
    }
}

#[derive(Clone, Copy, PartialEq)]
enum FT {
    Low,
    Band,
    High,
    LowShelf(f32),
}

/// A biquad (the RBJ cookbook's, as Web Audio's BiquadFilterNode).
#[derive(Clone, Copy)]
struct Biquad {
    t: FT,
    q: f32,
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
    f: f32,
}
impl Biquad {
    fn new(t: FT, f: f32, q: f32) -> Biquad {
        let mut b = Biquad { t, q, b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0, f: -1.0 };
        b.tune(f);
        b
    }
    fn tune(&mut self, f: f32) {
        let f = f.clamp(10.0, SR * 0.45);
        if (f - self.f).abs() < 0.5 {
            return;
        }
        self.f = f;
        let w = 2.0 * PI * f / SR;
        let (s, c) = w.sin_cos();
        let (b0, b1, b2, a0, a1, a2);
        match self.t {
            FT::LowShelf(db) => {
                let a = 10f32.powf(db / 40.0);
                let al = s / 2.0 * ((a + 1.0 / a) * (1.0 / 0.7 - 1.0) + 2.0).sqrt();
                let sa = 2.0 * a.sqrt() * al;
                b0 = a * ((a + 1.0) - (a - 1.0) * c + sa);
                b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * c);
                b2 = a * ((a + 1.0) - (a - 1.0) * c - sa);
                a0 = (a + 1.0) + (a - 1.0) * c + sa;
                a1 = -2.0 * ((a - 1.0) + (a + 1.0) * c);
                a2 = (a + 1.0) + (a - 1.0) * c - sa;
            }
            _ => {
                // (Web Audio's Q for low- and high-passes is in dB; these are tuned by ear, as linear Q)
                let al = s / (2.0 * self.q.max(0.05));
                match self.t {
                    FT::Low => {
                        b0 = (1.0 - c) / 2.0;
                        b1 = 1.0 - c;
                        b2 = (1.0 - c) / 2.0;
                    }
                    FT::High => {
                        b0 = (1.0 + c) / 2.0;
                        b1 = -(1.0 + c);
                        b2 = (1.0 + c) / 2.0;
                    }
                    _ => {
                        b0 = al;
                        b1 = 0.0;
                        b2 = -al;
                    }
                }
                a0 = 1.0 + al;
                a1 = -2.0 * c;
                a2 = 1.0 - al;
            }
        }
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }
    #[inline]
    fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = if y.is_finite() { y } else { 0.0 };
        self.y1
    }
}

/// The screech's grain player: pitch and speed apart (as js/grains.js): 70 ms grains, each from up to 30 ms either
/// side of the playhead and a little sharp or flat, two at a time, overlapping by half.
#[derive(Clone)]
struct Grains {
    buf: Arc<Vec<f32>>,
    head: f64,
    g: [(f64, f32, usize); 2],
    n: usize,
    rng: Rng,
    wander: f32,
}
impl Grains {
    fn new(buf: Arc<Vec<f32>>, at: f32, seed: u64) -> Grains {
        let head = at as f64 * buf.len() as f64;
        let n = (0.07 * SR) as usize;
        Grains { buf, head, g: [(head, 1.0, 0), (head, 1.0, n / 2)], n, rng: Rng(seed | 1), wander: 0.0 }
    }
    #[inline]
    fn tick(&mut self, pitch: f32, speed: f32) -> f32 {
        let len = self.buf.len() as f64;
        let mut out = 0.0;
        for i in 0..2 {
            let (pos, rate, age) = &mut self.g[i];
            if *age >= self.n {
                // a new grain
                self.wander = (self.wander + self.rng.next() * 0.002).clamp(-0.02, 0.02);
                let jitter = self.rng.next() as f64 * 0.03 * SR as f64;
                *pos = (self.head + jitter).rem_euclid(len);
                *rate = 1.0 + self.rng.next() * 0.015 + self.wander;
                *age = 0;
            }
            let k = *pos as usize % self.buf.len();
            let f = (*pos - pos.floor()) as f32;
            let s = self.buf[k] + (self.buf[(k + 1) % self.buf.len()] - self.buf[k]) * f;
            let w = 0.5 - 0.5 * (2.0 * PI * *age as f32 / self.n as f32).cos();
            out += s * w;
            *pos = (*pos + (pitch * *rate) as f64).rem_euclid(len);
            *age += 1;
        }
        self.head = (self.head + speed as f64).rem_euclid(len);
        out
    }
}

struct BurstOn {
    f: Biquad,
    t: f32,
    b: Burst,
    noise: Loop,
}

/// A value gliding to its target (Web Audio's setTargetAtTime).
#[inline]
fn glide(cur: &mut f32, to: f32, k: f32) {
    *cur += (to - *cur) * k;
}

struct Voice {
    key: String,
    kind: Kind,
    takes: [usize; 3],
    cur: Set,
    to: Set,
    alive: bool,
    gone: bool,
    noise: Loop,
    deep: Loop,
    roar_src: Option<Loop>,
    far: Loop,
    wob_crackle: Loop,
    wob_gust: Loop,
    wob_rough: Loop,
    scr1: Option<Grains>,
    scr2: Option<Grains>,
    scr_hz: f32,
    start: Option<(Loop, f32, f32)>,
    o: [Osc; 12],
    // filters
    shelf: Biquad,
    air_top: Biquad,
    roar_f: Biquad,
    roar_f2: Biquad,
    rumble_f: Biquad,
    drone_f: Biquad,
    prop_f: Biquad,
    chop_f: Biquad,
    wh_f: Biquad,
    eng_f: Biquad,
    apu_f: Biquad,
    air_f: Biquad,
    air_f2: Biquad,
    wind_f: Biquad,
    apu_hz: f32,
    bursts: Vec<BurstOn>,
    n: usize,
}

impl Voice {
    fn new(v: &VoiceIn, b: &Banks, seed: u64) -> Voice {
        let mut rng = Rng(seed.wrapping_mul(0x2545F4914F6CDD1D) | 1);
        let mut r01 = || rng.next() * 0.5 + 0.5;
        let jet = v.kind == Kind::Jet;
        let deep = if jet { b.rumble[v.takes[0].min(b.rumble.len() - 1)].clone() } else { b.brown.clone() };
        let scr = b.screech[v.takes[2].min(b.screech.len() - 1)].clone();
        Voice {
            key: v.key.clone(),
            kind: v.kind,
            takes: v.takes,
            cur: Set { dop: 1.0, air_top: 16000.0, ..v.set.clone() }.zeroed(),
            to: v.set.clone(),
            alive: true,
            gone: false,
            noise: Loop::new(b.pink.clone(), r01()),
            deep: Loop::new(deep, r01()),
            roar_src: if jet { Some(Loop::new(b.roar[v.takes[1].min(b.roar.len() - 1)].clone(), r01())) } else { None },
            far: Loop::new(b.far.clone(), r01()),
            wob_crackle: Loop::new(b.wobble.clone(), r01()),
            wob_gust: Loop::new(b.wobble.clone(), r01()),
            wob_rough: Loop::new(b.wobble.clone(), r01()),
            scr1: if jet { Some(Grains::new(scr.clone(), r01(), seed ^ 0x51)) } else { None },
            scr2: if jet { Some(Grains::new(scr, r01(), seed ^ 0x77)) } else { None },
            scr_hz: v.scr_hz,
            start: None,
            o: [Osc::default(); 12],
            shelf: Biquad::new(FT::LowShelf(9.0), 220.0, 0.7),
            air_top: Biquad::new(FT::Low, 16000.0, 0.5),
            roar_f: Biquad::new(if jet { FT::Low } else { FT::Band }, 400.0, if jet { 0.7 } else { 0.5 }),
            roar_f2: Biquad::new(FT::Low, 800.0, 0.7),
            rumble_f: Biquad::new(FT::Low, if jet { 180.0 } else { 140.0 }, 0.8),
            drone_f: Biquad::new(FT::Low, 300.0, 1.2),
            prop_f: Biquad::new(FT::Low, 600.0, 0.7),
            chop_f: Biquad::new(FT::Band, 600.0, 0.6),
            wh_f: Biquad::new(FT::Band, 2000.0, 9.0),
            eng_f: Biquad::new(FT::Low, 800.0, 0.8),
            apu_f: Biquad::new(FT::Band, 700.0, 1.0),
            air_f: Biquad::new(FT::Low, 800.0, 0.6),
            air_f2: Biquad::new(FT::Low, 1300.0, 0.6),
            wind_f: Biquad::new(FT::Band, 500.0, 0.7),
            apu_hz: v.apu_hz,
            bursts: Vec::new(),
            n: 0,
        }
    }

    /// One stereo sample.
    #[inline]
    fn tick(&mut self, b: &Banks, k_fast: f32, k_slow: f32) -> (f32, f32) {
        let c = &mut self.cur;
        let t = &self.to;
        // glide (the levels and pitches about 60 ms, the mix and the far wash slower)
        macro_rules! g {
            ($($f:ident),*) => { $( glide(&mut c.$f, t.$f, k_fast); )* };
        }
        g!(dop, pan, roar, roar_f, roar_f2, rumble, crackle, drone, drone_hz, drone_f, fan, fan_hz, core, core_hz, screech, scr_pitch, scr_speed,
           prop, prop_hz, prop_f, chop, chop_f, wh, eng, rough, eng_hz, eng_f, starter, starter_hz, air_top, wind_f, air_f);
        glide(&mut c.out, if self.alive { t.out } else { 0.0 }, k_fast * 0.75);
        glide(&mut c.mix, t.mix, k_slow);
        glide(&mut c.far, t.far, k_slow);
        glide(&mut c.apu, t.apu, k_slow * 0.75);
        glide(&mut c.air, t.air, k_slow * 2.0);
        glide(&mut c.gust, t.gust, k_slow * 2.0);
        glide(&mut c.wind, if self.alive { t.wind } else { 0.0 }, k_slow * 1.5);
        if self.n % BLOCK == 0 {
            self.air_top.tune(c.air_top);
            self.roar_f.tune(c.roar_f);
            self.roar_f2.tune(c.roar_f2);
            self.drone_f.tune(c.drone_f);
            self.prop_f.tune(c.prop_f);
            self.chop_f.tune(c.chop_f);
            self.wh_f.tune(c.core_hz);
            self.eng_f.tune(c.eng_f);
            self.air_f.tune(c.air_f);
            self.air_f2.tune(c.air_f * 1.6);
            self.wind_f.tune(c.wind_f);
            if !self.alive && c.out < 1e-4 && c.wind < 1e-4 {
                self.gone = true;
            }
        }
        self.n += 1;
        let dop = c.dop;
        let noise = self.noise.tick(dop);
        let deep = self.deep.tick(dop);
        let mut mix = 0.0;
        match self.kind {
            Kind::Jet => {
                let roar_in = match &mut self.roar_src { Some(l) => l.tick(dop), None => noise };
                mix += self.roar_f2.run(self.roar_f.run(roar_in)) * c.roar;
                let crackle = self.wob_crackle.tick(3.0) * c.crackle;
                mix += self.rumble_f.run(deep) * (c.rumble + crackle);
                if c.drone > 1e-5 {
                    let d = self.o[0].sine(c.drone_hz) + self.o[1].sine(c.drone_hz * 1.001);
                    mix += self.drone_f.run(d) * c.drone;
                }
                if c.fan > 1e-5 {
                    mix += (self.o[2].sine(c.fan_hz) + 0.6 * self.o[3].sine(c.fan_hz * 1.0012)) * c.fan;
                }
                if c.core > 1e-6 {
                    mix += self.o[4].sine(c.core_hz) * c.core;
                }
                if c.screech > 1e-5 {
                    let p = c.scr_pitch.clamp(0.05, 8.0);
                    let sp = c.scr_speed.clamp(0.0, 8.0);
                    let a = self.scr1.as_mut().map_or(0.0, |g| g.tick(p, sp));
                    let b2 = self.scr2.as_mut().map_or(0.0, |g| g.tick(p, sp));
                    mix += (a + 0.7 * b2) * c.screech;
                } else {
                    // (keep them moving, so the screech comes in where it would be)
                    if let Some(g) = &mut self.scr1 {
                        g.head = (g.head + 1.0) % g.buf.len() as f64;
                    }
                }
                let _ = self.o[5].saw(0.0);
            }
            Kind::Turboprop | Kind::Piston => {
                // the propeller: the blades' tone (two a little apart on a twin), the chopped air, the rumble
                let blade = &b.blade;
                let mut p = self.o[6].table(c.prop_hz, blade);
                if self.kind == Kind::Turboprop {
                    p += 0.7 * self.o[7].table(c.prop_hz * 1.004, blade);
                }
                mix += self.prop_f.run(p) * c.prop;
                let am = 0.3 + 0.7 * self.o[8].sine(c.prop_hz);
                mix += self.chop_f.run(noise) * am * c.chop;
                mix += self.rumble_f.run(deep) * c.rumble;
                mix += self.roar_f.run(noise) * c.roar;
                if self.kind == Kind::Turboprop {
                    mix += self.o[4].sine(c.core_hz) * c.core;
                    mix += self.wh_f.run(noise) * c.wh;
                } else {
                    let e = self.o[9].table(c.eng_hz, &b.radial) + self.o[10].table(c.eng_hz * 1.013, &b.radial);
                    let rough = self.wob_rough.tick(1.0) * c.rough;
                    mix += self.eng_f.run(e) * (c.eng + rough);
                    if c.starter > 1e-5 {
                        mix += self.o[11].triangle(c.starter_hz) * c.starter;
                    }
                }
            }
        }
        if c.apu > 1e-5 {
            mix += (self.o[5].sine(self.apu_hz) + self.apu_f.run(noise)) * c.apu;
        }
        // the air rushing past, gusting a little
        let gust = self.wob_gust.tick(0.2) * c.gust;
        mix += self.air_f2.run(self.air_f.run(noise)) * (c.air + gust);
        // one-off bursts
        let white = &b.white;
        let mut i = 0;
        while i < self.bursts.len() {
            let bo = &mut self.bursts[i];
            bo.t += 1.0 / SR;
            if bo.t >= 0.0 {
                let bb = bo.b;
                let env = if bo.t < bb.attack { bb.level * bo.t / bb.attack.max(1e-4) } else { bb.level * (0.0001f32 / bb.level.max(1e-4)).powf(((bo.t - bb.attack) / (bb.dur - bb.attack).max(1e-3)).min(1.0)) };
                mix += bo.f.run(bo.noise.tick(1.0)) * env;
            }
            if bo.t > bo.b.dur {
                self.bursts.swap_remove(i);
            } else {
                i += 1;
            }
            let _ = white;
        }
        // the starter's recording, once
        if let Some((l, g, to)) = &mut self.start {
            *g += (*to - *g) * k_slow;
            if l.pos as usize + 2 >= l.buf.len() {
                self.start = None;
            } else {
                mix += l.tick(1.0) * *g;
            }
        }
        let mut y = self.shelf.run(mix * c.mix);
        y += self.far.tick(dop) * c.far;
        let y = self.air_top.run(y) * c.out;
        let w = self.wind_f.run(noise) * c.wind;
        let s = y + w;
        // equal-power pan
        let x = (c.pan.clamp(-1.0, 1.0) + 1.0) * 0.25 * PI;
        (s * x.cos(), s * x.sin())
    }

    fn take(&mut self, v: VoiceIn, b: &Banks) {
        self.to = v.set;
        self.alive = v.alive;
        self.scr_hz = v.scr_hz;
        for bu in v.bursts {
            let ft = match bu.ftype { 0 => FT::Low, 2 => FT::High, _ => FT::Band };
            self.bursts.push(BurstOn { f: Biquad::new(ft, bu.f, bu.q), t: -bu.delay, b: bu, noise: Loop::new(b.white.clone(), (self.n % 977) as f32 / 977.0) });
        }
        match v.start {
            Some(l) if l > 0.0 && self.start.is_none() => self.start = Some((Loop::new(b.start.clone(), 0.0), l, l)),
            Some(_) => {
                if let Some(s) = &mut self.start {
                    s.2 = 0.0;
                }
            }
            None => {}
        }
    }
}

impl Set {
    /// The same voice with every level at 0 (it fades in).
    fn zeroed(mut self) -> Set {
        for f in [
            &mut self.out, &mut self.roar, &mut self.rumble, &mut self.crackle, &mut self.drone, &mut self.fan, &mut self.core, &mut self.screech,
            &mut self.prop, &mut self.chop, &mut self.wh, &mut self.eng, &mut self.rough, &mut self.starter, &mut self.apu, &mut self.air,
            &mut self.gust, &mut self.wind, &mut self.far,
        ] {
            *f = 0.0;
        }
        self
    }
}

/// What the game and the audio thread share.
#[derive(Default)]
pub struct Shared {
    pub master: f32,
    pub voices: Vec<VoiceIn>,
    pub fresh: bool,
    /// the loudest sample of the last moments (a level meter for the tests)
    pub peak: f32,
}

/// The audio thread's side: a rodio Source of all the voices.
pub struct Synth {
    banks: Arc<Banks>,
    shared: Arc<Mutex<Shared>>,
    voices: Vec<Voice>,
    master: f32,
    master_to: f32,
    right: Option<f32>,
    env: f32,
    seed: u64,
    n: u64,
    peak: f32,
}

impl Synth {
    pub fn new(banks: Arc<Banks>, shared: Arc<Mutex<Shared>>) -> Synth {
        Synth { banks, shared, voices: Vec::new(), master: 0.0, master_to: 0.0, right: None, env: 0.0, seed: 1, n: 0, peak: 0.0 }
    }

    fn sync(&mut self) {
        let Ok(mut sh) = self.shared.try_lock() else { return };
        sh.peak = sh.peak.max(self.peak);
        self.peak = 0.0;
        if !sh.fresh {
            self.master_to = sh.master;
            return;
        }
        sh.fresh = false;
        self.master_to = sh.master;
        let ins = std::mem::take(&mut sh.voices);
        drop(sh);
        for v in &mut self.voices {
            v.alive = false;
        }
        for vi in ins {
            match self.voices.iter_mut().find(|v| v.key == vi.key && v.kind == vi.kind && v.takes == vi.takes) {
                Some(v) => v.take(vi, &self.banks),
                None => {
                    if !vi.alive {
                        continue;
                    }
                    self.seed += 1;
                    let mut v = Voice::new(&vi, &self.banks, self.seed);
                    v.take(vi, &self.banks);
                    self.voices.push(v);
                }
            }
        }
        self.voices.retain(|v| !v.gone);
    }
}

pub struct SynthSource {
    s: Synth,
}

impl SynthSource {
    pub fn new(banks: Arc<Banks>, shared: Arc<Mutex<Shared>>) -> SynthSource {
        SynthSource { s: Synth::new(banks, shared) }
    }
}

impl Iterator for SynthSource {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let s = &mut self.s;
        if let Some(r) = s.right.take() {
            return Some(r);
        }
        if s.n % 512 == 0 {
            s.sync();
        }
        s.n += 1;
        let k_fast = 1.0 - (-1.0 / (SR * 0.06)).exp();
        let k_slow = 1.0 - (-1.0 / (SR * 0.3)).exp();
        let (mut l, mut r) = (0.0f32, 0.0f32);
        let banks = s.banks.clone();
        for v in &mut s.voices {
            let (a, b) = v.tick(&banks, k_fast, k_slow);
            l += a;
            r += b;
        }
        s.master += (s.master_to - s.master) * (1.0 - (-1.0 / (SR * 0.05)).exp());
        l *= s.master;
        r *= s.master;
        // a compressor (many planes at full power: no clipping): above -16 dB, 6:1
        let lv = l.abs().max(r.abs());
        let att = if lv > s.env { 1.0 - (-1.0 / (SR * 0.01)).exp() } else { 1.0 - (-1.0 / (SR * 0.3)).exp() };
        s.env += (lv - s.env) * att;
        let th = 0.158;
        let gain = if s.env > th { (th * (s.env / th).powf(1.0 / 6.0)) / s.env } else { 1.0 };
        let (l, r) = ((l * gain).tanh(), (r * gain).tanh());
        s.peak = s.peak.max(l.abs().max(r.abs()));
        s.right = Some(r);
        Some(l)
    }
}

impl Source for SynthSource {
    fn current_span_len(&self) -> Option<usize> {
        None
    }
    fn channels(&self) -> rodio::ChannelCount {
        NonZero::new(2).unwrap()
    }
    fn sample_rate(&self) -> rodio::SampleRate {
        NonZero::new(RATE).unwrap()
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One part of a voice alone, rendered for a second: its rms and its spectrum's share above 300 Hz.
    #[test]
    fn air_alone() {
        let banks = Arc::new(Banks::new(&[crate::sound::BASS[0].1], &[crate::sound::ROAR[0].1], &[crate::sound::SCREECH[0].1], crate::sound::BASS[0].1, crate::sound::BASS[0].1));
        let shared = Arc::new(Mutex::new(Shared::default()));
        let set = Set { out: 1.0, mix: 1.0, dop: 1.0, air_top: 16000.0, air: 1.0, air_f: 1500.0, ..Default::default() };
        {
            let mut sh = shared.lock().unwrap();
            sh.master = 1.0;
            sh.fresh = true;
            sh.voices = vec![VoiceIn { key: "a".into(), kind: Kind::Jet, takes: [0, 0, 0], scr_hz: 1360.0, apu_hz: 1900.0, set, bursts: vec![], start: None, alive: true }];
        }
        let mut src = SynthSource::new(banks, shared);
        let x: Vec<f32> = (0..RATE as usize * 2).map(|_| src.next().unwrap()).step_by(2).collect();
        let tail = &x[x.len() / 2..];
        let rms = (tail.iter().map(|v| v * v).sum::<f32>() / tail.len() as f32).sqrt();
        // (a one-pole high-pass at 300 Hz: how much is above it)
        let a = (-2.0 * PI * 300.0 / SR).exp();
        let (mut y, mut prev) = (0.0f32, 0.0f32);
        let hp: Vec<f32> = tail.iter().map(|&v| { y = a * (y + v - prev); prev = v; y }).collect();
        let rms_hp = (hp.iter().map(|v| v * v).sum::<f32>() / hp.len() as f32).sqrt();
        eprintln!("air rms {rms} above 300 Hz {rms_hp}");
        assert!(rms > 0.05 && rms_hp > 0.03);
    }
}
