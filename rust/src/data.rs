//! The world: airports, towns, runways, aircraft types and rival airlines, read from the browser game's
//! data files (`../js/data`, built into the binary), plus what is worked out from them once at start
//! (catchments, longest runways).

use crate::jsdata;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

const AIRPORTS_JS: &str = include_str!("../../js/data/airports.js");
const AIRPORTS_MORE_JS: &str = include_str!("../../js/data/airports-more.js");
const TOWNS_JS: &str = include_str!("../../js/data/towns.js");
const CITIES_JS: &str = include_str!("../../js/data/cities.js");
const RUNWAYS_JS: &str = include_str!("../../js/data/runways.js");
const AIRCRAFT_JS: &str = include_str!("../../js/data/aircraft.js");
const LOOKS_JS: &str = include_str!("../../js/data/looks.js");
const FACTORIES_JS: &str = include_str!("../../js/data/factories.js");
const RIVALS_JS: &str = include_str!("../../js/data/rivals.js");
const TIMEZONES_JS: &str = include_str!("../../js/data/timezones.js");
const PRESETS_JS: &str = include_str!("../../js/data/presets.js");
const STORY_JS: &str = include_str!("../../js/data/story.js");
/// The stands (by class A–F) of the airports whose real layout the browser game knows, as it counts them
/// (taken from the online game; every other airport has the made-up apron of its size, `DEFAULT_STANDS`).
const STANDS_JSON: &str = include_str!("../data/stands.json");

/// The stands by class of a made-up apron, by airport size (as the browser game lays it out).
pub const DEFAULT_STANDS: [[u32; 6]; 6] =
    [[0, 0, 2, 0, 0, 0], [0, 0, 6, 0, 0, 0], [0, 0, 8, 4, 0, 0], [0, 0, 0, 16, 8, 0], [0, 0, 0, 0, 40, 0], [0, 0, 0, 0, 42, 22]];

#[derive(Clone, Debug)]
pub struct Airport {
    pub code: String,
    pub name: String,
    pub city: String,
    pub country: String,
    pub lat: f64,
    pub lon: f64,
    pub size: usize,
    pub minor: bool,
    pub factory: bool,
    /// passengers' catchment: people within the catchment radius, weighted by distance
    pub catchment: f64,
    /// longest runway in metres (any surface, paved only)
    pub runway: f64,
    pub runway_paved: f64,
    pub runways: Vec<[f64; 6]>,
    /// time zone: UTC offset in quarter hours, or [winter, summer, first day of summer, first day after it]
    pub zone: Vec<i32>,
    /// stands (= slots) by class A–F
    pub stands: [u32; 6],
    /// true where the stands come from a real layout
    pub real_stands: bool,
}

#[derive(Clone, Debug)]
pub struct Town {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub pop: f64,
}

#[derive(Clone, Debug)]
pub struct Aircraft {
    pub code: String,
    pub name: String,
    pub maker: String,
    pub category: String,
    pub seats: u32,
    pub range_km: f64,
    pub speed_kmh: f64,
    pub cost_per_block_hour: f64,
    pub lease_per_week: f64,
    pub price: Option<f64>,
    pub min_airport: usize,
    pub year: i32,
    pub end_year: Option<i32>,
    pub runway_m: Option<f64>,
    pub pilots: Option<u32>,
    pub span: f64,
    /// length (m), from looks.js
    pub len: f64,
    /// flight performance where the type sets it (else its category's): cruise height, climb near the ground,
    /// lift-off and approach speeds (km/h)
    pub cruise_ft: Option<f64>,
    pub climb_fpm: Option<f64>,
    pub v_lof: Option<f64>,
    pub v_app: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct RivalTemplate {
    pub name: String,
    pub kind: String,
    pub hubs: Vec<String>,
}

/// The aircraft rivals fly from a year on (story mode); all None: today's fleets.
#[derive(Clone, Debug)]
pub struct RivalEra {
    pub from: i32,
    pub flag: Option<String>,
    pub low: Option<String>,
    pub regional: Option<String>,
    pub long_haul: Option<String>,
    pub short_prop: Option<String>,
}

/// A ready-made airline for Quick start (js/data/presets.js).
#[derive(Clone, Debug)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub company: String,
    pub home: String,
    pub mode: String,
    pub difficulty: String,
    pub money: Option<f64>,
    pub planes: Vec<(String, Vec<String>)>,
}

#[derive(Clone, Debug)]
pub struct Factory {
    pub code: String,
    pub types: Vec<String>,
}

pub struct Data {
    pub airports: Vec<Airport>,
    pub by_code: HashMap<String, usize>,
    pub towns: Vec<Town>,
    pub aircraft: Vec<Aircraft>,
    pub aircraft_by_code: HashMap<String, usize>,
    pub categories: Vec<(String, String)>,
    pub rival_templates: Vec<RivalTemplate>,
    pub rival_colors: Vec<String>,
    pub factory_of: HashMap<String, String>,
    pub presets: Vec<Preset>,
    /// story mode: a line for the newspaper per type, and the rivals' aircraft by era
    pub story_news: HashMap<String, String>,
    pub rival_fleets: Vec<RivalEra>,
    town_grid: HashMap<(i32, i32), Vec<usize>>,
}

static DATA: OnceLock<Data> = OnceLock::new();

pub fn data() -> &'static Data {
    DATA.get_or_init(|| Data::load().unwrap_or_else(|e| panic!("game data: {e}")))
}

fn s(v: &Value) -> String {
    match v {
        Value::String(x) => x.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}
fn f(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}
fn of(v: &Value) -> Option<f64> {
    v.as_f64()
}

pub fn distance_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (d_lat, d_lon) = ((lat2 - lat1).to_radians(), (lon2 - lon1).to_radians());
    let h = (d_lat / 2.0).sin().powi(2) + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lon / 2.0).sin().powi(2);
    6371.0 * 2.0 * h.sqrt().atan2((1.0 - h).sqrt())
}

impl Data {
    fn load() -> Result<Self, String> {
        // ---------- airports ----------
        let mut airports: Vec<Airport> = Vec::new();
        let mut by_code: HashMap<String, usize> = HashMap::new();
        fn push(a: Airport, airports: &mut Vec<Airport>, by_code: &mut HashMap<String, usize>) {
            if a.code.is_empty() || by_code.contains_key(&a.code) {
                return;
            }
            by_code.insert(a.code.clone(), airports.len());
            airports.push(a);
        }
        let blank = |code: String, name: String, city: String, country: String, lat: f64, lon: f64, size: usize| Airport {
            code,
            name,
            city,
            country,
            lat,
            lon,
            size,
            minor: false,
            factory: false,
            catchment: 0.0,
            runway: 0.0,
            runway_paved: 0.0,
            runways: Vec::new(),
            zone: Vec::new(),
            stands: [0; 6],
            real_stands: false,
        };
        if let Value::Array(list) = jsdata::assigned(AIRPORTS_JS, "airports")? {
            for a in &list {
                let mut ap = blank(s(&a["code"]), s(&a["name"]), s(&a["city"]), s(&a["country"]), f(&a["lat"]), f(&a["lon"]), f(&a["size"]) as usize);
                ap.minor = a["minor"].as_bool().unwrap_or(false);
                push(ap, &mut airports, &mut by_code);
            }
        }
        for a in jsdata::pushed(AIRPORTS_MORE_JS, "airports")? {
            let mut ap = blank(s(&a[0]), s(&a[1]), s(&a[2]), s(&a[3]), f(&a[4]), f(&a[5]), f(&a[6]) as usize);
            ap.minor = f(&a[7]) > 0.0;
            push(ap, &mut airports, &mut by_code);
        }
        // factories: map points new planes are delivered from (not airports you can use)
        let mut factory_of = HashMap::new();
        if let Value::Array(list) = jsdata::assigned(FACTORIES_JS, "factories")? {
            for fa in &list {
                let code = s(&fa["code"]);
                if !by_code.contains_key(&code) {
                    let mut ap = blank(code.clone(), s(&fa["name"]), s(&fa["name"]), s(&fa["country"]), f(&fa["lat"]), f(&fa["lon"]), 0);
                    ap.factory = true;
                    push(ap, &mut airports, &mut by_code);
                }
                if let Value::Array(types) = &fa["types"] {
                    for t in types {
                        factory_of.insert(s(t), code.clone());
                    }
                }
            }
        }

        // ---------- runways ----------
        if let Value::Object(map) = jsdata::assigned(RUNWAYS_JS, "runways")? {
            for (code, list) in map {
                let Some(&i) = by_code.get(&code) else { continue };
                if let Value::Array(rws) = list {
                    for r in rws {
                        let rw = [f(&r[0]), f(&r[1]), f(&r[2]), f(&r[3]), f(&r[4]), f(&r[5])];
                        let len = distance_km(rw[0], rw[1], rw[2], rw[3]) * 1000.0;
                        let a = &mut airports[i];
                        a.runway = a.runway.max(len);
                        if rw[5] > 0.0 {
                            a.runway_paved = a.runway_paved.max(len);
                        }
                        a.runways.push(rw);
                    }
                }
            }
        }
        // Airports without runway data get a typical length for their size.
        const RUNWAY_BY_SIZE: [f64; 6] = [0.0, 900.0, 1800.0, 2500.0, 3200.0, 3800.0];
        for a in &mut airports {
            if a.runways.is_empty() {
                a.runway = RUNWAY_BY_SIZE[a.size.min(5)];
                a.runway_paved = a.runway;
            }
        }

        // ---------- towns and catchments ----------
        let mut towns = Vec::new();
        if let Value::Array(list) = jsdata::assigned(TOWNS_JS, "towns")? {
            for t in &list {
                towns.push(Town { name: s(&t["name"]), lat: f(&t["lat"]), lon: f(&t["lon"]), pop: f(&t["pop"]) });
            }
        }
        for t in jsdata::pushed(CITIES_JS, "towns")? {
            towns.push(Town { name: s(&t[0]), lat: f(&t[2]), lon: f(&t[3]), pop: f(&t[4]) });
        }
        let mut town_grid: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
        for (i, t) in towns.iter().enumerate() {
            town_grid.entry((t.lat.floor() as i32, t.lon.floor() as i32)).or_default().push(i);
        }

        // ---------- aircraft ----------
        let looks = jsdata::assigned(LOOKS_JS, "looks")?;
        let mut aircraft = Vec::new();
        if let Value::Object(map) = jsdata::assigned(AIRCRAFT_JS, "aircraft")? {
            for (code, a) in map {
                aircraft.push(Aircraft {
                    span: of(&looks[&code]["span"]).unwrap_or(35.0),
                    len: of(&looks[&code]["len"]).unwrap_or(37.0),
                    cruise_ft: of(&a["cruiseFt"]),
                    climb_fpm: of(&a["climbFpm"]),
                    v_lof: of(&a["vLofKmh"]),
                    v_app: of(&a["vAppKmh"]),
                    name: s(&a["name"]),
                    maker: s(&a["maker"]),
                    category: s(&a["category"]),
                    seats: f(&a["seats"]) as u32,
                    range_km: f(&a["rangeKm"]),
                    speed_kmh: f(&a["speedKmh"]).max(100.0),
                    cost_per_block_hour: f(&a["costPerBlockHour"]),
                    lease_per_week: f(&a["leasePerWeek"]),
                    price: of(&a["price"]),
                    min_airport: of(&a["minAirport"]).unwrap_or(1.0) as usize,
                    year: of(&a["year"]).unwrap_or(2000.0) as i32,
                    end_year: of(&a["endYear"]).map(|y| y as i32),
                    runway_m: of(&a["runwayM"]),
                    pilots: of(&a["pilots"]).map(|p| p as u32),
                    code,
                });
            }
        }
        let aircraft_by_code = aircraft.iter().enumerate().map(|(i, a)| (a.code.clone(), i)).collect();
        let mut categories = Vec::new();
        if let Value::Object(map) = jsdata::assigned(AIRCRAFT_JS, "aircraftCategories")? {
            for (k, v) in map {
                categories.push((k, s(&v)));
            }
        }

        // ---------- rivals ----------
        let mut rival_templates = Vec::new();
        if let Value::Array(list) = jsdata::assigned(RIVALS_JS, "rivalTemplates")? {
            for t in &list {
                let hubs = t["hubs"].as_array().map(|h| h.iter().map(s).collect()).unwrap_or_default();
                rival_templates.push(RivalTemplate { name: s(&t["name"]), kind: s(&t["kind"]), hubs });
            }
        }
        let rival_colors = jsdata::assigned(RIVALS_JS, "rivalColors")?
            .as_array()
            .map(|a| a.iter().map(s).collect())
            .unwrap_or_default();

        // ---------- time zones ----------
        if let Value::Object(map) = jsdata::assigned(TIMEZONES_JS, "timezones")? {
            for (key, codes) in map {
                let z: Vec<i32> = key.split(',').filter_map(|x| x.trim().parse().ok()).collect();
                for c in s(&codes).split(' ') {
                    if let Some(&i) = by_code.get(c) {
                        airports[i].zone = z.clone();
                    }
                }
            }
        }
        // one the data has none for takes its nearest neighbour's within about 400 km, or the sun's
        let zoned: Vec<(f64, f64, Vec<i32>)> =
            airports.iter().filter(|a| !a.zone.is_empty()).map(|a| (a.lat, a.lon, a.zone.clone())).collect();
        for a in airports.iter_mut().filter(|a| a.zone.is_empty()) {
            let mut best: Option<(f64, &Vec<i32>)> = None;
            for (lat, lon, z) in &zoned {
                if (lat - a.lat).abs() > 4.0 || (lon - a.lon).abs() > 4.0 {
                    continue;
                }
                let d = (lat - a.lat).hypot((lon - a.lon) * a.lat.to_radians().cos());
                if d < 4.0 && best.is_none_or(|(b, _)| d < b) {
                    best = Some((d, z));
                }
            }
            a.zone = best.map(|(_, z)| z.clone()).unwrap_or_else(|| vec![(a.lon / 15.0).round() as i32 * 4]);
        }

        // ---------- stands ----------
        let real: HashMap<String, [u32; 6]> = serde_json::from_str(STANDS_JSON).map_err(|e| format!("stands.json: {e}"))?;
        for a in airports.iter_mut() {
            match real.get(&a.code) {
                Some(st) => {
                    a.stands = *st;
                    a.real_stands = true;
                }
                None => a.stands = DEFAULT_STANDS[a.size.min(5)],
            }
        }

        // ---------- story mode ----------
        let story = jsdata::assigned(STORY_JS, "story")?;
        let story_news: HashMap<String, String> =
            story["news"].as_object().map(|m| m.iter().map(|(k, v)| (k.clone(), s(v))).collect()).unwrap_or_default();
        let rival_fleets = story["rivalFleets"]
            .as_array()
            .map(|l| {
                l.iter()
                    .map(|e| {
                        let o = |k: &str| e[k].as_str().map(String::from);
                        RivalEra {
                            from: f(&e["from"]) as i32,
                            flag: o("flag"),
                            low: o("low"),
                            regional: o("regional"),
                            long_haul: o("longHaul"),
                            short_prop: o("shortProp"),
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();

        // ---------- quick start ----------
        let mut presets = Vec::new();
        if let Value::Object(map) = jsdata::assigned(PRESETS_JS, "presets")? {
            for (id, p) in map {
                let planes = p["planes"]
                    .as_array()
                    .map(|l| {
                        l.iter()
                            .map(|x| (s(&x[0]), x[1].as_array().map(|st| st.iter().map(s).collect()).unwrap_or_default()))
                            .collect()
                    })
                    .unwrap_or_default();
                presets.push(Preset {
                    id,
                    name: s(&p["name"]),
                    desc: s(&p["desc"]),
                    company: s(&p["company"]),
                    home: s(&p["home"]),
                    mode: s(&p["mode"]),
                    difficulty: s(&p["difficulty"]),
                    money: of(&p["money"]),
                    planes,
                });
            }
        }

        let mut d = Data {
            airports,
            by_code,
            towns,
            aircraft,
            aircraft_by_code,
            categories,
            rival_templates,
            rival_colors,
            factory_of,
            presets,
            story_news,
            rival_fleets,
            town_grid,
        };
        let catchments: Vec<f64> = d.airports.iter().map(|a| d.catchment_of(a.lat, a.lon)).collect();
        for (a, c) in d.airports.iter_mut().zip(catchments) {
            a.catchment = c;
        }
        Ok(d)
    }

    /// Towns in the grid cells around a point (whole degrees), for searches within `km`.
    pub fn towns_near(&self, lat: f64, lon: f64, km: f64) -> Vec<&Town> {
        let d_lat = (km / 111.0).ceil() as i32;
        let c = (lat.abs() + d_lat as f64).min(89.0).to_radians().cos().max(0.05);
        let d_lon = ((km / (111.0 * c)).ceil() as i32).min(180);
        let (la, lo) = (lat.floor() as i32, lon.floor() as i32);
        let mut out = Vec::new();
        for i in la - d_lat..=la + d_lat {
            for j in lo - d_lon..=lo + d_lon {
                let jj = ((j + 180).rem_euclid(360)) - 180;
                if let Some(cell) = self.town_grid.get(&(i, jj)) {
                    out.extend(cell.iter().map(|&k| &self.towns[k]));
                }
            }
        }
        out
    }

    fn catchment_of(&self, lat: f64, lon: f64) -> f64 {
        let r = crate::config::CATCHMENT_RADIUS_KM;
        let mut sum = 0.0;
        for t in self.towns_near(lat, lon, r) {
            let d = distance_km(lat, lon, t.lat, t.lon);
            if d < r {
                sum += t.pop * (1.0 - d / r);
            }
        }
        sum.round()
    }

    pub fn nearest_town(&self, lat: f64, lon: f64) -> String {
        let mut best: Option<(&Town, f64)> = None;
        for km in [150.0, 600.0] {
            for t in self.towns_near(lat, lon, km) {
                let d = distance_km(lat, lon, t.lat, t.lon);
                if best.is_none_or(|(_, b)| d < b) {
                    best = Some((t, d));
                }
            }
            if best.is_some() {
                break;
            }
        }
        best.map(|(t, _)| t.name.clone()).unwrap_or_else(|| "the coast".into())
    }

    pub fn airport(&self, code: &str) -> &Airport {
        &self.airports[self.by_code[code]]
    }
    pub fn try_airport(&self, code: &str) -> Option<&Airport> {
        self.by_code.get(code).map(|&i| &self.airports[i])
    }
    pub fn ac(&self, code: &str) -> &Aircraft {
        &self.aircraft[self.aircraft_by_code[code]]
    }
    pub fn try_ac(&self, code: &str) -> Option<&Aircraft> {
        self.aircraft_by_code.get(code).map(|&i| &self.aircraft[i])
    }
    pub fn dist(&self, a: &str, b: &str) -> f64 {
        let (a, b) = (self.airport(a), self.airport(b));
        distance_km(a.lat, a.lon, b.lat, b.lon)
    }
}

/// Point at fraction `f` along the great circle from (lat1, lon1) to (lat2, lon2): (lat, lon).
pub fn interpolate(lat1: f64, lon1: f64, lat2: f64, lon2: f64, f: f64) -> (f64, f64) {
    let delta = distance_km(lat1, lon1, lat2, lon2) / 6371.0;
    if delta < 1e-6 {
        return (lat1, lon1);
    }
    let (wa, wb) = (((1.0 - f) * delta).sin() / delta.sin(), (f * delta).sin() / delta.sin());
    let (la1, lo1, la2, lo2) = (lat1.to_radians(), lon1.to_radians(), lat2.to_radians(), lon2.to_radians());
    let x = wa * la1.cos() * lo1.cos() + wb * la2.cos() * lo2.cos();
    let y = wa * la1.cos() * lo1.sin() + wb * la2.cos() * lo2.sin();
    let z = wa * la1.sin() + wb * la2.sin();
    (z.atan2(x.hypot(y)).to_degrees(), y.atan2(x).to_degrees())
}

pub fn bearing(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (la1, la2, dl) = (lat1.to_radians(), lat2.to_radians(), (lon2 - lon1).to_radians());
    let y = dl.sin() * la2.cos();
    let x = la1.cos() * la2.sin() - la1.sin() * la2.cos() * dl.cos();
    (y.atan2(x).to_degrees() + 360.0) % 360.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads() {
        let d = data();
        assert!(d.airports.len() > 1000, "{} airports", d.airports.len());
        assert!(d.towns.len() > 1000);
        assert!(d.aircraft.len() > 50);
        let brn = d.airport("BRN");
        assert_eq!(brn.size, 1);
        assert!(brn.catchment > 100_000.0, "BRN catchment {}", brn.catchment);
        assert!(brn.runway > 1000.0);
        assert!(d.ac("A220-300").seats > 100);
        assert!(d.rival_templates.len() > 10);
        assert!((d.dist("ZRH", "LHR") - 788.0).abs() < 20.0);
    }
}
