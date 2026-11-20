//! Weather (looks only, flights never wait for it) and day and night, as in the browser game's `js/game.js`:
//! noise drifting east and changing shape over a day or two, drier in the subtropics, wetter at the equator, colder
//! towards the poles, in winter and at night; storm events show up as real storms.

use crate::config::DAY;
use crate::data::distance_km;
use crate::game::{Game, day_of_year, utc_offset};

/// Degrees of longitude the weather drifts east per game minute.
pub const WX_DRIFT: f64 = 0.0064;
/// Minutes for the pattern to change shape (1.5 days).
const WX_MORPH: f64 = 2160.0;

fn wx_hash(x: i32, y: i32, z: i32, s: i32) -> f64 {
    let mut h = x
        .wrapping_mul(374761393)
        .wrapping_add(y.wrapping_mul(668265263))
        .wrapping_add(z.wrapping_mul(2147483647))
        .wrapping_add(s.wrapping_mul(1274126177));
    h = (h ^ ((h as u32) >> 13) as i32).wrapping_mul(1274126177);
    ((h ^ ((h as u32) >> 16) as i32) as u32) as f64 / 4294967296.0
}

/// Smooth value noise in [0, 1).
fn wx_noise(x: f64, y: f64, z: f64, s: i32) -> f64 {
    let (xi, yi, zi) = (x.floor(), y.floor(), z.floor());
    let (fx, fy, fz) = (x - xi, y - yi, z - zi);
    let (u, w, q) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy), fz * fz * (3.0 - 2.0 * fz));
    let (xi, yi, zi) = (xi as i32, yi as i32, zi as i32);
    let h = |dx: i32, dy: i32, dz: i32| wx_hash(xi.wrapping_add(dx), yi.wrapping_add(dy), zi.wrapping_add(dz), s);
    let (a0, b0, c0, d0) = (h(0, 0, 0), h(1, 0, 0), h(0, 1, 0), h(1, 1, 0));
    let (a1, b1, c1, d1) = (h(0, 0, 1), h(1, 0, 1), h(0, 1, 1), h(1, 1, 1));
    let lo = a0 + (b0 - a0) * u + (c0 + (d0 - c0) * u - a0 - (b0 - a0) * u) * w;
    let hi = a1 + (b1 - a1) * u + (c1 + (d1 - c1) * u - a1 - (b1 - a1) * u) * w;
    lo + (hi - lo) * q
}

pub fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let k = ((x - a) / (b - a)).clamp(0.0, 1.0);
    k * k * (3.0 - 2.0 * k)
}

fn hash01(a: f64, b: f64, c: f64, d: f64) -> f64 {
    let x = (a * 12.9898 + b * 78.233 + c * 37.719 + d * 4.581).sin() * 43758.5453;
    x - x.floor()
}

/// The surface wind's direction (degrees it blows from) in a 4° cell on a day: mostly westerlies.
pub fn wind_from(lat: f64, lon: f64, day: i64) -> f64 {
    let (a, b, c) = ((lat / 4.0).floor(), (lon / 4.0).floor(), day as f64);
    let r = hash01(a, b, c, 1.0);
    let easterly = hash01(a, b, c, 2.0) < 0.2;
    ((if easterly { 70.0 } else { 250.0 }) + (r - 0.5) * 120.0 + 360.0) % 360.0
}

/// The weather at a place and time.
#[derive(Clone, Debug)]
pub struct Weather {
    /// 0 clear … 1 overcast
    pub cover: f64,
    /// 0 … 1 (snow when cold)
    pub rain: f64,
    pub storm: bool,
    pub snow: bool,
    pub fog: bool,
    pub temp_c: i64,
    pub wind_from: i64,
    pub wind_kt: i64,
    pub gust_kt: i64,
    pub name: &'static str,
    pub icon: &'static str,
}

impl Game {
    /// Storm events under way: (lat, lon, radius km).
    pub fn storms_now(&self) -> Vec<(f64, f64, f64)> {
        self.active_effects()
            .filter(|e| e.storm || e.label.starts_with("Storm "))
            .filter_map(|e| e.at.near.map(|(lat, lon)| (lat, lon, if e.at.radius_km > 0.0 { e.at.radius_km } else { 400.0 })))
            .collect()
    }

    /// Cloud cover, rain and storm only (the cloud layer asks this thousands of times).
    pub fn weather_lite(&self, lat: f64, lon: f64, t: f64, storms: &[(f64, f64, f64)]) -> (f64, f64, bool) {
        let x = lon - WX_DRIFT * t;
        let z = t / WX_MORPH;
        let n = 0.62 * wx_noise(x / 9.0, lat / 7.0, z, 1) + 0.38 * wx_noise(x / 2.6, lat / 2.2, z * 1.7, 2);
        let a = lat.abs();
        let climate = (if a < 9.0 { 0.07 } else { 0.0 }) - 0.13 * smooth(14.0, 22.0, a) * (1.0 - smooth(30.0, 38.0, a))
            + if a > 40.0 { 0.03 } else { 0.0 };
        let wet = n + climate;
        let mut cover = smooth(0.36, 0.64, wet);
        let mut rain = smooth(0.6, 0.76, wet);
        let mut storm = rain > 0.4 && wx_noise(x / 1.1, lat / 1.1, z * 3.0, 3) > 0.74 && a < 55.0;
        for &(slat, slon, km) in storms {
            let d = distance_km(lat, lon, slat, slon);
            if d >= km {
                continue;
            }
            let k = 1.0 - d / km;
            cover = cover.max((0.4 + 1.2 * k).min(1.0));
            rain = rain.max((1.4 * k).min(1.0));
            if k > 0.2 {
                storm = true;
            }
        }
        (cover, rain, storm)
    }

    pub fn weather_at(&self, lat: f64, lon: f64, t: i64) -> Weather {
        let storms = self.storms_now();
        let (cover, rain, storm) = self.weather_lite(lat, lon, t as f64, &storms);
        let storm_k = storms
            .iter()
            .map(|&(slat, slon, km)| 1.0 - distance_km(lat, lon, slat, slon) / km)
            .filter(|k| *k > 0.2)
            .fold(0.0, f64::max);
        let x = lon - WX_DRIFT * t as f64;
        let z = t as f64 / WX_MORPH;
        let a = lat.abs();
        // temperature: latitude, season (opposite in the south), time of day; storms cool it down
        let doy = day_of_year(t) as f64;
        let season = (2.0 * std::f64::consts::PI * (doy - 200.0) / 365.0).cos() * if lat >= 0.0 { 1.0 } else { -1.0 };
        let hour = t.rem_euclid(DAY) as f64 / 60.0;
        let temp_c = (29.0 - 0.007 * a * a - 0.1 * a + season * 0.25 * a.min(60.0)
            + 4.0 * (2.0 * std::f64::consts::PI * (hour - 15.0) / 24.0).cos()
            - 3.0 * rain)
            .round() as i64;
        let snow = rain > 0.15 && temp_c <= 1;
        let mut wind_kt = (4.0 + 16.0 * wx_noise(x / 5.0, lat / 5.0, z * 1.5, 4) + 10.0 * rain + if storm { 12.0 } else { 0.0 }).round() as i64;
        if storm_k > 0.0 {
            wind_kt = wind_kt.max((30.0 + 25.0 * storm_k).round() as i64);
        }
        let gust_kt = if wind_kt >= 15 { (wind_kt as f64 * 1.45).round() as i64 } else { 0 };
        let fog = rain == 0.0 && !storm && wind_kt < 7 && cover > 0.55 && hour > 3.0 && hour < 10.0 && temp_c < 14;
        let (name, icon) = if storm && snow {
            ("Blizzard", "🌨")
        } else if storm {
            ("Thunderstorm", "⛈")
        } else if snow {
            ("Snow", "🌨")
        } else if fog {
            ("Fog", "🌫")
        } else if rain > 0.55 {
            ("Rain", "🌧")
        } else if rain > 0.15 {
            ("Showers", "🌦")
        } else if cover > 0.85 {
            ("Overcast", "☁")
        } else if cover > 0.55 {
            ("Cloudy", "🌥")
        } else if cover > 0.2 {
            ("Some clouds", "⛅")
        } else {
            ("Clear", if hour > 6.0 && hour < 20.0 { "☀" } else { "🌙" })
        };
        let wind_from = wind_from(lat, lon, t.div_euclid(DAY)).round() as i64 % 360;
        Weather { cover, rain, storm, snow, fog, temp_c, wind_from, wind_kt, gust_kt, name, icon }
    }

    /// The wind at a height (ft) as (from, kt), as the browser game's windAt: the surface wind near the ground,
    /// turning to the winds aloft and stronger with height; the mid-latitudes' jet stream only blows up high (from
    /// FL150, all of it by FL330).
    pub fn wind_at(&self, lat: f64, lon: f64, t: f64, alt_ft: f64) -> (f64, f64) {
        let w = self.weather_at(lat, lon, t as i64);
        let x = lon - WX_DRIFT * t;
        let z = t / WX_MORPH;
        let aloft = (if (-25.0..=25.0).contains(&lat) { 90.0 } else { 270.0 }) + (wx_noise(x / 12.0, lat / 10.0, z, 5) - 0.5) * 100.0;
        let k = smooth(2000.0, 12000.0, alt_ft);
        let k_jet = smooth(15000.0, 33000.0, alt_ft);
        let jet = 60.0 * (-((lat.abs() - 40.0) / 12.0).powi(2)).exp() * (0.6 + 0.8 * wx_noise(x / 8.0, lat / 8.0, z, 6));
        let wf = w.wind_from as f64;
        let from = (wf + k * ((aloft - wf + 540.0).rem_euclid(360.0) - 180.0) + 360.0).rem_euclid(360.0);
        (from, w.wind_kt as f64 * (1.0 + 0.6 * k) + k_jet * jet)
    }

    /// The weather at an airport now (in its local time of day).
    pub fn airport_weather(&self, code: &str) -> Weather {
        let a = crate::data::data().airport(code);
        self.weather_at(a.lat, a.lon, self.state.time)
    }

    /// Where the sun is at game time t: (declination, longitude it is overhead at), both in degrees.
    pub fn sun_point(&self, t: f64) -> (f64, f64) {
        let ti = t.floor() as i64;
        let u = t - utc_offset(&self.state.home, ti) as f64;
        let doy = day_of_year(ti) as f64 + u.rem_euclid(DAY as f64) / DAY as f64;
        let g = 2.0 * std::f64::consts::PI * (doy - 1.0) / 365.0;
        let dec = 0.006918 - 0.399912 * g.cos() + 0.070257 * g.sin() - 0.006758 * (2.0 * g).cos()
            + 0.000907 * (2.0 * g).sin()
            - 0.002697 * (3.0 * g).cos()
            + 0.00148 * (3.0 * g).sin();
        let eot = 229.18
            * (0.000075 + 0.001868 * g.cos() - 0.032077 * g.sin() - 0.014615 * (2.0 * g).cos() - 0.040849 * (2.0 * g).sin());
        let lon = ((720.0 - u.rem_euclid(DAY as f64) - eot) / 4.0 + 540.0).rem_euclid(360.0) - 180.0;
        (dec.to_degrees(), lon)
    }
}

/// How light it is at a place with the sun at `sun` (declination, longitude): 1 in daylight, 0 at night (the sun
/// more than 9° under the horizon), dusk in between.
pub fn daylight(lat: f64, lon: f64, sun: (f64, f64)) -> f64 {
    let (f, d, h) = (lat.to_radians(), sun.0.to_radians(), (lon - sun.1).to_radians());
    let sin_e = f.sin() * d.sin() + f.cos() * d.cos() * h.cos();
    smooth(-9.0, 4.0, sin_e.clamp(-1.0, 1.0).asin().to_degrees())
}
