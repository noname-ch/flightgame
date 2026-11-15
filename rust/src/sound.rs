//! Sound (off until turned on, as in the browser game): the browser game's recordings (`sounds/`), mixed by what
//! the planes near the map's centre do. Near ones rumble, roar and screech by their engines' power (taxiing,
//! take-off, climb, cruise, approach, reverse thrust after landing), planes a few kilometres off turn into the wash
//! of a distant airliner, and a jet starting up at its gate whistles up. Fast-forwarded above 300× it fades out,
//! paused it is quiet. The sound mixer (F6) sets how loud each part is and which recorded take the bass, roar and
//! screech play, as the browser game's (js/soundmix.js).

use flightgame::data::distance_km;
use flightgame::game::{Game, Status};
use rodio::{Decoder, Player, Source};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Cursor;

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
const FAR: &[u8] = include_bytes!("../../sounds/far-wash.wav");
const START: &[u8] = include_bytes!("../../sounds/jet-start.wav");

/// The parts of the planes' sound the mixer sets.
pub const PARTS: [&str; 5] = ["Bass", "Roar", "Screech", "Far wash", "Start"];

/// The mixer's settings: how loud each part is (1 = as made), which take the bass, roar and screech play, and
/// the screech's pitch (its speed).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Mix {
    pub level: [f32; 5],
    pub take: [usize; 3],
    pub pitch: f32,
}

impl Default for Mix {
    fn default() -> Self {
        Mix { level: [1.0; 5], take: [0, 0, 0], pitch: 0.85 }
    }
}

pub struct Sound {
    pub on: bool,
    pub volume: f32,
    pub mix: Mix,
    device: Option<rodio::MixerDeviceSink>,
    /// bass, roar, screech, far
    loops: Vec<Player>,
    /// the takes the loops play now
    playing: [usize; 3],
    started: HashSet<(String, i64)>,
    pub status: String,
}

fn looped(bytes: &'static [u8], device: &rodio::MixerDeviceSink, speed: f32) -> Option<Player> {
    let player = Player::connect_new(device.mixer());
    let src = Decoder::try_from(Cursor::new(bytes)).ok()?.buffered().repeat_infinite();
    player.append(src);
    player.set_volume(0.0);
    player.set_speed(speed);
    Some(player)
}

/// A plane's engine power (0 … 1) and height (m) from what it is doing.
fn engines(game: &Game, i: usize, t: f64) -> (f64, f64) {
    let p = &game.state.planes[i];
    match (&p.flight, p.status) {
        (Some(f), Status::Flying) => {
            let since = t - f.dep as f64;
            let left = f.arr as f64 - t;
            if since < 9.0 {
                (0.25, 0.0) // taxiing out
            } else if since < 12.0 {
                (1.0, ((since - 10.0).max(0.0) * 300.0)) // take-off power
            } else if since < 30.0 {
                (0.7, (since - 10.0) * 500.0) // climb
            } else if left < 1.5 {
                (0.8, 0.0) // reverse thrust on the landing run
            } else if left < 8.0 {
                (0.25, 0.0) // taxiing in
            } else if left < 20.0 {
                (0.5, (left - 8.0) * 300.0) // approach
            } else {
                (0.35, 10000.0) // cruise
            }
        }
        _ => (0.04, 0.0), // the APU at the gate
    }
}

impl Sound {
    pub fn new() -> Self {
        Sound {
            on: false,
            volume: 0.7,
            mix: Mix::default(),
            device: None,
            loops: Vec::new(),
            playing: [0, 0, 0],
            started: HashSet::new(),
            status: String::new(),
        }
    }

    fn build(&mut self) {
        let Some(dev) = &self.device else { return };
        let t = self.mix.take;
        let takes = [
            BASS[t[0].min(BASS.len() - 1)].1,
            ROAR[t[1].min(ROAR.len() - 1)].1,
            SCREECH[t[2].min(SCREECH.len() - 1)].1,
            FAR,
        ];
        let speeds = [1.0, 1.0, self.mix.pitch, 1.0];
        self.loops = takes.iter().zip(speeds).filter_map(|(b, s)| looped(b, dev, s)).collect();
        self.playing = t;
    }

    pub fn toggle(&mut self) {
        self.on = !self.on;
        if self.on && self.device.is_none() {
            match rodio::DeviceSinkBuilder::open_default_sink() {
                Ok(mut dev) => {
                    dev.log_on_drop(false);
                    self.device = Some(dev);
                    self.build();
                    self.status = format!("{} recordings loaded", self.loops.len());
                }
                Err(e) => {
                    self.status = format!("No sound device: {e}");
                    self.on = false;
                }
            }
        }
        if !self.on {
            for l in &self.loops {
                l.set_volume(0.0);
            }
        }
    }

    /// Sets the mix for the planes around the listener (the map's centre, `height` metres up).
    pub fn update(&mut self, game: &Game, t: f64, lat: f64, lon: f64, height: f64, speed: f64, running: bool) {
        if !self.on {
            return;
        }
        if self.playing != self.mix.take {
            self.build(); // another take picked in the mixer
        }
        if self.loops.len() < 4 {
            return;
        }
        if let Some(s) = self.loops.get(2) {
            s.set_speed(self.mix.pitch);
        }
        let fade = if !running { 0.0 } else if speed > 300.0 { (1.0 - (speed - 300.0) / 900.0).max(0.0) } else { 1.0 };
        let (mut near, mut power, mut far) = (0.0f64, 0.0f64, 0.0f64);
        for i in 0..game.state.planes.len() {
            let (plat, plon, _, _) = game.plane_position(i, t);
            let (level, alt) = engines(game, i, t);
            let h = distance_km(lat, lon, plat, plon);
            let dist = (h * h + ((alt - height) / 1000.0).powi(2)).sqrt();
            let g = level / (1.0 + (dist / 0.4).powi(2));
            near += g;
            power = power.max(g * level);
            far += level / (1.0 + (dist / 4.0).powi(2)) * (dist > 1.0) as u8 as f64;
            // a jet whistling up at its gate when it starts its engines (its first minutes of a flight)
            let p = &game.state.planes[i];
            if let Some(f) = &p.flight {
                let key = (p.id.clone(), f.dep);
                if t - (f.dep as f64) < 3.0 && dist < 2.0 && fade > 0.0 && !self.started.contains(&key) {
                    self.started.insert(key);
                    if let (Some(dev), Ok(src)) = (&self.device, Decoder::try_from(Cursor::new(START))) {
                        dev.mixer().add(src.amplify((self.volume * self.mix.level[4] * 0.5 / (1.0 + dist as f32)) as _));
                    }
                }
            }
        }
        // the rivals' planes in the air: heard far off
        for rp in game.rival_flights(t) {
            let dist = (distance_km(lat, lon, rp.lat, rp.lon).powi(2) + ((8000.0 - height) / 1000.0).powi(2)).sqrt();
            far += 0.3 / (1.0 + (dist / 4.0).powi(2));
        }
        let v = self.volume as f64 * fade;
        let lv = self.mix.level;
        let set = |k: usize, x: f64| self.loops[k].set_volume((x * v * lv[k] as f64).clamp(0.0, 1.0) as _);
        set(0, near.min(1.2) * 0.8); // bass
        set(1, power.min(1.0) * 0.9); // roar
        set(2, (power - 0.15).max(0.0).min(1.0) * 0.5); // screech
        set(3, far.min(1.0) * 0.6); // far wash
        if self.started.len() > 500 {
            self.started.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn recordings_decode() {
        let all = super::BASS.iter().chain(super::ROAR.iter()).chain(super::SCREECH.iter()).map(|x| x.1);
        for b in all.chain([super::FAR, super::START]) {
            assert!(rodio::Decoder::try_from(std::io::Cursor::new(b)).is_ok());
        }
    }
}
