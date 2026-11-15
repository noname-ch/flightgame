//! Where a flight is and what it does (looks only; the simulation goes by departure and arrival times), after the
//! browser game: the plane is pushed back from its stand and taxis to the runway the wind (or its pilot's choice)
//! gives it, takes off, climbs out straight ahead, flies the great circle at its type's cruise height, joins a
//! straight-in final to the landing runway, rolls out and taxis to its stand.

use crate::config::DAY;
use crate::data::{bearing, data, distance_km, interpolate};
use crate::game::{Flight, Game, Plane, Status, airport_runways, offset_point, runway_length, runway_need};

/// One end of a runway to take off or land on: from its threshold `thr` towards `end`, on heading `hdg`.
#[derive(Clone, Debug)]
pub struct RunwayEnd {
    pub thr: (f64, f64),
    pub end: (f64, f64),
    pub hdg: f64,
    pub len: f64,
    pub paved: bool,
    /// the runway (both ends), as the browser game keys it
    pub key: String,
}

/// The browser game's runway key: its first four numbers with four decimals.
pub fn runway_key(r: &[f64; 6]) -> String {
    r[..4].iter().map(|v| format!("{v:.4}")).collect::<Vec<_>>().join(",")
}

/// A heading as a runway designator: 137° → "14", 355° → "36".
pub fn designator(h: f64) -> String {
    let n = (h.rem_euclid(360.0) / 10.0).round() as i64;
    format!("{:02}", if n == 0 { 36 } else { n })
}

/// The runway a plane of `kind` takes at `code` on game day `day`: its pick (a runway key) if it fits, else the
/// shortest that fits within 45° of the wind, else the one most into the wind. Airports without runway data get an
/// imaginary 2.5 km one into the wind.
pub fn pick_runway(code: &str, day: i64, kind: &str, pick: Option<&str>) -> RunwayEnd {
    let a = data().airport(code);
    let wind = crate::weather::wind_from(a.lat, a.lon, day);
    let mut ends = Vec::new();
    for r in airport_runways(code) {
        let len = runway_length(&r);
        let h = bearing(r[0], r[1], r[2], r[3]);
        let key = runway_key(&r);
        let paved = r[5] > 0.0;
        ends.push(RunwayEnd { thr: (r[0], r[1]), end: (r[2], r[3]), hdg: h, len, paved, key: key.clone() });
        ends.push(RunwayEnd { thr: (r[2], r[3]), end: (r[0], r[1]), hdg: (h + 180.0) % 360.0, len, paved, key });
    }
    if ends.is_empty() {
        let t = offset_point(a.lat, a.lon, wind + 180.0, 1250.0);
        let e = offset_point(a.lat, a.lon, wind, 1250.0);
        return RunwayEnd { thr: t, end: e, hdg: wind, len: 2500.0, paved: true, key: String::new() };
    }
    let off = |e: &RunwayEnd| ((e.hdg - wind + 540.0).rem_euclid(360.0) - 180.0).abs();
    let (need, paved) = runway_need(kind);
    let fits = |e: &RunwayEnd| e.len >= need && (e.paved || !paved);
    if let Some(p) = pick {
        if let Some(e) = ends.iter().filter(|e| e.key == p && fits(e)).min_by(|x, y| off(x).total_cmp(&off(y))) {
            return e.clone();
        }
    }
    let ok: Vec<&RunwayEnd> = ends.iter().filter(|e| fits(e)).collect();
    let paved_ok: Vec<&RunwayEnd> = ok.iter().copied().filter(|e| e.paved).collect();
    let long: Vec<&RunwayEnd> = ends.iter().filter(|e| e.len >= need).collect();
    let pool: Vec<&RunwayEnd> = if !paved_ok.is_empty() {
        paved_ok
    } else if !ok.is_empty() {
        ok
    } else if !long.is_empty() {
        long
    } else {
        ends.iter().collect()
    };
    let calm: Vec<&RunwayEnd> = pool.iter().copied().filter(|e| off(e) <= 45.0).collect();
    if !calm.is_empty() {
        return (*calm
            .iter()
            .reduce(|b, e| if e.len < b.len - 1.0 || ((e.len - b.len).abs() <= 1.0 && off(e) < off(b)) { e } else { b })
            .unwrap())
        .clone();
    }
    (*pool.iter().reduce(|b, e| if off(e) < off(b) - 20.0 || (off(e) < off(b) + 20.0 && e.len < b.len) { e } else { b }).unwrap()).clone()
}

/// The runways a plane may choose at an airport, shortest first: (key, "14/32", length, why not, or "").
pub fn runway_choices(kind: &str, code: &str) -> Vec<(String, String, f64, String)> {
    let (need, paved) = runway_need(kind);
    let mut out: Vec<(String, String, f64, String)> = airport_runways(code)
        .iter()
        .map(|r| {
            let h = bearing(r[0], r[1], r[2], r[3]);
            let len = runway_length(r).round();
            let why = if len < need {
                format!("too short (needs {need:.0} m)")
            } else if paved && r[5] == 0.0 {
                "needs a paved one".into()
            } else {
                String::new()
            };
            (runway_key(r), format!("{}/{}", designator(h), designator(h + 180.0)), len, why)
        })
        .collect();
    out.sort_by(|x, y| x.2.total_cmp(&y.2));
    out
}

/// A type's cruise height (ft).
pub fn cruise_ft(kind: &str) -> f64 {
    let ac = data().ac(kind);
    if let Some(c) = ac.cruise_ft {
        return c;
    }
    match kind {
        "JU52" => return 6000.0,
        "DC-3" => return 9000.0,
        "CONCORDE" => return 58000.0,
        "DHC6-400" => return 10000.0,
        "DO228NG" => return 12000.0,
        _ => {}
    }
    match ac.category.as_str() {
        "turboprop" if ac.seats <= 19 => 14000.0,
        "turboprop" => 25000.0,
        "regional" => 36000.0,
        "narrowbody" => 37000.0,
        "widebody" => 39000.0,
        _ => 30000.0,
    }
}

/// Climb rate near the ground (ft/min), lift-off and approach speeds (km/h), as the browser game's perf().
pub fn perf(kind: &str) -> (f64, f64, f64) {
    let ac = data().ac(kind);
    let small = ac.category == "turboprop" && ac.seats <= 20;
    let (climb, lof, app) = match ac.category.as_str() {
        "turboprop" => (1800.0, 200.0, 210.0),
        "regional" => (3000.0, 265.0, 245.0),
        "widebody" => (2300.0, 315.0, 275.0),
        "classic" => (1000.0, 180.0, 195.0),
        _ => (2600.0, 285.0, 255.0),
    };
    (
        ac.climb_fpm.unwrap_or(if small { 1600.0 } else { climb }),
        ac.v_lof.unwrap_or(if small { 160.0 } else { lof }),
        ac.v_app.unwrap_or(if small { 170.0 } else { app }),
    )
}

/// Where a plane is and what it does.
#[derive(Clone, Debug)]
pub struct FlightPos {
    pub lat: f64,
    pub lon: f64,
    /// where its nose points
    pub heading: f64,
    pub alt_ft: f64,
    pub speed_kt: f64,
    pub phase: &'static str,
    pub airborne: bool,
}

fn lerp(a: (f64, f64), b: (f64, f64), f: f64) -> (f64, f64) {
    (a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f)
}

/// Along a line of points by distance: (point, heading) at fraction f.
fn along(pts: &[(f64, f64)], f: f64) -> ((f64, f64), f64) {
    let seg: Vec<f64> = pts.windows(2).map(|w| distance_km(w[0].0, w[0].1, w[1].0, w[1].1)).collect();
    let total: f64 = seg.iter().sum::<f64>().max(1e-9);
    let mut d = f.clamp(0.0, 1.0) * total;
    for (k, s) in seg.iter().enumerate() {
        if d <= *s || k == seg.len() - 1 {
            let x = if *s > 0.0 { (d / s).min(1.0) } else { 0.0 };
            let (a, b) = (pts[k], pts[k + 1]);
            let p = if *s > 50.0 { interpolate(a.0, a.1, b.0, b.1, x) } else { lerp(a, b, x) };
            let ahead = if *s > 50.0 { interpolate(a.0, a.1, b.0, b.1, (x + 0.002).min(1.0)) } else { b };
            let h = if distance_km(p.0, p.1, ahead.0, ahead.1) > 1e-6 { bearing(p.0, p.1, ahead.0, ahead.1) } else { bearing(a.0, a.1, b.0, b.1) };
            return (p, h);
        }
        d -= s;
    }
    (pts[pts.len() - 1], 0.0)
}

impl Game {
    /// Where a plane stands at an airport: one of the real stands where the browser game has its layout (each of
    /// your planes its own), else beside the airport. (lat, lon, heading, stand name)
    pub fn stand_of(&self, code: &str, i: usize) -> (f64, f64, f64, String) {
        let a = data().airport(code);
        if let Some(l) = crate::layouts::layout(code).filter(|l| !l.stands.is_empty()) {
            // the planes at that airport by their place in the fleet, each on its own stand
            let here: Vec<usize> = (0..self.state.planes.len())
                .filter(|&k| {
                    let q = &self.state.planes[k];
                    q.location == code || q.flight.as_ref().is_some_and(|f| f.to == code || f.from == code)
                })
                .collect();
            let n = here.iter().position(|&k| k == i).unwrap_or(i);
            let s = &l.stands[(n * 7 + 3) % l.stands.len()];
            return (s.0, s.1, s.2, s.3.clone());
        }
        let p = offset_point(a.lat, a.lon, 135.0 + i as f64 * 25.0, 350.0 + 60.0 * (i % 4) as f64);
        (p.0, p.1, 0.0, String::new())
    }

    /// The runway a plane takes at an airport for a flight starting on game day `day`.
    pub fn runway_for(&self, p: &Plane, code: &str, day: i64) -> RunwayEnd {
        pick_runway(code, day, &p.kind, p.runways.get(code).map(|s| s.as_str()))
    }

    /// Where plane i is at fractional game time t, and what it does.
    pub fn flight_pos(&self, i: usize, t: f64) -> FlightPos {
        let p = &self.state.planes[i];
        let f: &Flight = match (&p.flight, p.status) {
            (Some(f), Status::Flying) => f,
            _ => {
                let (lat, lon, hdg, _) = self.stand_of(&p.location, i);
                let phase = if p.status == Status::Turnaround { "At the gate (turnaround)" } else { "At the gate" };
                return FlightPos { lat, lon, heading: hdg, alt_ft: 0.0, speed_kt: 0.0, phase, airborne: false };
            }
        };
        let day = f.dep.div_euclid(DAY);
        let rf = pick_runway(&f.from, day, &p.kind, f.rw_from.as_deref().or(p.runways.get(&f.from).map(|s| s.as_str())));
        let rt = pick_runway(&f.to, f.arr.div_euclid(DAY), &p.kind, f.rw_to.as_deref().or(p.runways.get(&f.to).map(|s| s.as_str())));
        let (sf_lat, sf_lon, _, _) = self.stand_of(&f.from, i);
        let (st_lat, st_lon, st_hdg, _) = self.stand_of(&f.to, i);
        let dur = (f.arr - f.dep) as f64;
        let e = t - f.dep as f64; // minutes since it left the stand
        let taxi_out = (dur * 0.12).min(9.0);
        let roll = 0.8;
        let taxi_in = (dur * 0.08).min(6.0);
        let rollout = 0.8;
        let air = (dur - taxi_out - roll - taxi_in - rollout).max(1.0);
        let (climb, v_lof, v_app) = perf(&p.kind);
        let cruise_kt = data().ac(&p.kind).speed_kmh / 1.852;
        let cruise = cruise_ft(&p.kind);
        let a_from = data().airport(&f.from);
        let a_to = data().airport(&f.to);
        let field_from = 0.0;
        let _ = (a_from, a_to, field_from);
        if e < taxi_out {
            let x = e / taxi_out;
            let (pt, h) = along(&[(sf_lat, sf_lon), rf.thr], x);
            return FlightPos { lat: pt.0, lon: pt.1, heading: h, alt_ft: 0.0, speed_kt: if x < 0.1 { 3.0 } else { 15.0 }, phase: if x < 0.1 { "Pushback" } else { "Taxiing to the runway" }, airborne: false };
        }
        let e = e - taxi_out;
        if e < roll {
            let x = e / roll;
            let pt = lerp(rf.thr, rf.end, x * x * 0.85);
            return FlightPos { lat: pt.0, lon: pt.1, heading: rf.hdg, alt_ft: 0.0, speed_kt: v_lof / 1.852 * x, phase: "Take-off run", airborne: false };
        }
        let e = e - roll;
        if e < air {
            // the path: runway end → straight out 8 km → great circle → 15 km final → threshold
            let out = offset_point(rf.end.0, rf.end.1, rf.hdg, 8000.0);
            let fin = offset_point(rt.thr.0, rt.thr.1, rt.hdg + 180.0, 15000.0);
            let pts = [rf.end, out, fin, rt.thr];
            let x = e / air;
            let x = x * x * (3.0 - 2.0 * x) * 0.25 + x * 0.75; // slower at both ends
            let (pt, h) = along(&pts, x);
            let climb_min = cruise / (climb * 0.6);
            let descent_min = cruise / 1800.0;
            let alt = cruise * (e / climb_min).min(1.0).min((air - e) / descent_min).max(0.0);
            let left = air - e;
            let (phase, spd) = if e < climb_min {
                ("Climbing", v_lof / 1.852 + (cruise_kt - v_lof / 1.852) * (e / climb_min))
            } else if left < 6.0 {
                ("Final approach", v_app / 1.852)
            } else if left < descent_min {
                ("Descending", v_app / 1.852 + (cruise_kt - v_app / 1.852) * (left / descent_min))
            } else {
                ("Cruising", cruise_kt)
            };
            return FlightPos { lat: pt.0, lon: pt.1, heading: h, alt_ft: alt.min(cruise), speed_kt: spd, phase, airborne: true };
        }
        let e = e - air;
        if e < rollout {
            let x = e / rollout;
            let pt = lerp(rt.thr, rt.end, 0.1 + 0.45 * (1.0 - (1.0 - x) * (1.0 - x)));
            return FlightPos { lat: pt.0, lon: pt.1, heading: rt.hdg, alt_ft: 0.0, speed_kt: v_app / 1.852 * (1.0 - x) + 15.0 * x, phase: "Landing", airborne: false };
        }
        let e = e - rollout;
        let x = (e / taxi_in).min(1.0);
        let exit = lerp(rt.thr, rt.end, 0.55);
        let (pt, h) = along(&[exit, (st_lat, st_lon)], x);
        FlightPos {
            lat: pt.0,
            lon: pt.1,
            heading: if x >= 1.0 { st_hdg } else { h },
            alt_ft: 0.0,
            speed_kt: if x >= 1.0 { 0.0 } else { 15.0 },
            phase: "Taxiing to the stand",
            airborne: false,
        }
    }
}

impl Game {
    /// Chooses the runway plane i takes at an airport (None: auto). A flight under way keeps its runways; the
    /// choice counts from its next flight there.
    pub fn set_runway(&mut self, i: usize, code: &str, key: Option<String>) {
        let p = &mut self.state.planes[i];
        match key {
            Some(k) => {
                p.runways.insert(code.to_string(), k);
            }
            None => {
                p.runways.remove(code);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::NewGame;

    #[test]
    fn runways_and_tracks() {
        // Zurich's runways: the A320 gets one long enough, and a pick of a too short one is ignored
        let e = pick_runway("ZRH", 0, "A320", None);
        assert!(e.len >= runway_need("A320").0);
        let short = runway_choices("A320", "ZRH").into_iter().find(|c| !c.3.is_empty());
        if let Some((key, ..)) = short {
            assert_ne!(pick_runway("ZRH", 0, "A320", Some(&key)).key, key);
        }
        assert_eq!(designator(137.0), "14");
        assert_eq!(designator(355.0), "36");
        // a flight goes through its phases, high up in the middle
        let pr = data().presets.iter().find(|p| p.id == "europe").unwrap();
        let (mut g, _) = Game::from_preset(pr);
        let _ = NewGame::default();
        g.advance(65); // 07:05: HB-AEA left at 07:00
        let f = g.state.planes[0].flight.clone().expect("in the air");
        let mid = g.flight_pos(0, (f.dep + f.arr) as f64 / 2.0);
        assert!(mid.airborne && mid.alt_ft > 20000.0, "{mid:?}");
        assert_eq!(g.flight_pos(0, f.dep as f64 + 0.5).phase, "Pushback");
        assert!(!g.flight_pos(0, f.arr as f64 - 0.5).airborne);
    }
}
