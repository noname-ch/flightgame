//! Where a flight is and what it does (looks only; the simulation goes by departure and arrival times), after the
//! browser game's buildTrack (js/game.js): the plane waits at the gate boarding, is pushed back and taxis along the
//! taxiways to the runway the wind (or its pilot's choice) gives it, takes off, climbs out, turns at its bank angle
//! onto the great circle, cruises at a flight level, turns onto a 15 km final, comes down a 3° glide path, brakes
//! to an exit and taxis in to its stand, every part as long as it really takes.

use crate::config::DAY;
use std::cell::RefCell;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::rc::Rc;
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
    /// where its nose points (the track and the crab into a crosswind)
    pub heading: f64,
    /// the way it goes over the ground
    pub track: f64,
    /// degrees the nose points into the wind (heading = track + crab)
    pub crab: f64,
    pub alt_ft: f64,
    pub speed_kt: f64,
    pub phase: &'static str,
    pub airborne: bool,
    /// minutes since the pushback began (less than 0 while it is still boarding at the gate)
    pub since_push: f64,
    /// the flight's cruise level (ft), 0 at the gate
    pub cruise_ft: f64,
}

// ---------- the browser game's constants (js/game.js) ----------
const PUSHBACK: f64 = 2.0; // minutes: pushed back from the gate, tail first
const DOCK: f64 = 1.5; // minutes: turning onto the stand and pulling up to the gate
const FINAL_KM: f64 = 15.0; // final approach fix before the threshold (~2700 ft on a 3° glide)
const DESCENT_KM_PER_KFT: f64 = 5.6; // 3° descent path
const TAXI_KMH: f64 = 25.0;
const HOLD_KM: f64 = 0.25; // planes wait for their departure this far before the runway threshold
const TAXI_LANE: f64 = 70.0; // m from a stand back to the taxi lane (= the pushback)
const RUNWAY_TAXI_COST: f64 = 3.0; // taxiing along a runway counts this many times its length
const MAX_CRAB: f64 = 15.0;

fn metres(a: (f64, f64), b: (f64, f64)) -> f64 {
    distance_km(a.0, a.1, b.0, b.1) * 1000.0
}

/// A point relative to a runway end: metres along it from the threshold and across (+ = right).
fn rwy_coords(r: &RunwayEnd, p: (f64, f64)) -> (f64, f64) {
    let kx = 111_320.0 * r.thr.0.to_radians().cos();
    let (ux, uy) = (r.hdg.to_radians().sin(), r.hdg.to_radians().cos());
    let vx = (p.1 - r.thr.1) * kx;
    let vy = (p.0 - r.thr.0) * 111_320.0;
    (vx * ux + vy * uy, vx * uy - vy * ux)
}

fn rwy_point(r: &RunwayEnd, along: f64, across: f64) -> (f64, f64) {
    let kx = 111_320.0 * r.thr.0.to_radians().cos();
    let (ux, uy) = (r.hdg.to_radians().sin(), r.hdg.to_radians().cos());
    (r.thr.0 + (along * uy - across * ux) / 111_320.0, r.thr.1 + (along * ux + across * uy) / kx)
}

/// Distance from p to the segment a-b (m) and the nearest point on it.
fn seg_metres(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> (f64, (f64, f64)) {
    let kx = 111_320.0 * p.0.to_radians().cos();
    let (ax, ay) = ((a.1 - p.1) * kx, (a.0 - p.0) * 111_320.0);
    let (bx, by) = ((b.1 - p.1) * kx, (b.0 - p.0) * 111_320.0);
    let (dx, dy) = (bx - ax, by - ay);
    let l = dx * dx + dy * dy;
    let t = if l > 0.0 { (-(ax * dx + ay * dy) / l).clamp(0.0, 1.0) } else { 0.0 };
    let (x, y) = (ax + t * dx, ay + t * dy);
    (x.hypot(y), (p.0 + y / 111_320.0, p.1 + x / kx))
}

/// Turn from `pos` on heading `hdg` with radius r (m) towards `target` until pointing at it: the arc's points.
fn turn_toward(pos: (f64, f64), hdg: f64, target: (f64, f64), r: f64) -> Vec<(f64, f64)> {
    let mut pts = Vec::new();
    let (mut p, mut h) = (pos, hdg);
    for _ in 0..40 {
        let diff = (bearing(p.0, p.1, target.0, target.1) - h + 540.0).rem_euclid(360.0) - 180.0;
        if diff.abs() < 4.0 {
            break;
        }
        let step = diff.signum() * diff.abs().min(10.0);
        p = offset_point(p.0, p.1, h + step / 2.0, 2.0 * r * (step.abs().to_radians() / 2.0).sin());
        h += step;
        pts.push(p);
    }
    pts
}

/// A 180° turn on a runway, as at its end: from the centre line 4r before `x0` (coming the other way), out to one
/// side and round, ending on the centre line at x0 facing `dir` (+1 the runway's heading, -1 the other way).
fn turn_around(r: &RunwayEnd, x0: f64, dir: f64, w: f64, side: f64) -> Vec<(f64, f64)> {
    let rad = (w * 0.27).clamp(6.0, 20.0);
    let mut pts = vec![rwy_point(r, x0 + dir * 4.0 * rad, 0.0)];
    let mut a = -90.0f64;
    while a >= -270.0 {
        pts.push(rwy_point(r, x0 + dir * rad * a.to_radians().cos(), side * rad * (a.to_radians().sin() - 1.0)));
        a -= 15.0;
    }
    pts
}

// ---------- taxiways ----------

/// A runway's centre line in the taxiway graph: its points (ids) from its first end `a`.
struct RwyLine {
    a: (f64, f64),
    b: (f64, f64),
    w: f64,
    on: HashSet<usize>,
    ids: Vec<usize>,
}

/// The taxiways of an airport with a real layout as a graph (js/game.js taxiGraph): the taxiway lines, their loose
/// ends joined to lines within 8 m, the runways' centre lines (taxiing along them costs 3×), the biggest piece.
struct Graph {
    pts: Vec<(f64, f64)>,
    adj: Vec<Vec<(usize, f64)>>,
    rwys: Vec<RwyLine>,
    /// the segments of the biggest connected piece
    segs: Vec<(usize, usize)>,
}

impl Graph {
    fn build(code: &str, lines: &[Vec<(f64, f64)>]) -> Graph {
        let mut g = Graph { pts: Vec::new(), adj: Vec::new(), rwys: Vec::new(), segs: Vec::new() };
        let mut index: HashMap<(u64, u64), usize> = HashMap::new();
        let mut node = |g: &mut Graph, p: (f64, f64)| -> usize {
            *index.entry((p.0.to_bits(), p.1.to_bits())).or_insert_with(|| {
                g.pts.push(p);
                g.adj.push(Vec::new());
                g.pts.len() - 1
            })
        };
        let link = |g: &mut Graph, u: usize, v: usize, d: f64| {
            if u != v {
                g.adj[u].push((v, d));
                g.adj[v].push((u, d));
            }
        };
        for line in lines {
            for w in line.windows(2) {
                let (u, v) = (node(&mut g, w[0]), node(&mut g, w[1]));
                link(&mut g, u, v, metres(w[0], w[1]));
            }
        }
        // Loose ends: a line that ends on another line (within 8 m) without sharing a point with it, as where the
        // data was cut into map tiles: the end is joined to both ends of that stretch. (Segments in a grid.)
        const CELL: f64 = 0.0005;
        let cell = |p: (f64, f64)| ((p.0 / CELL).floor() as i64, (p.1 / CELL).floor() as i64);
        let mut grid: HashMap<(i64, i64), Vec<(usize, usize)>> = HashMap::new();
        for u in 0..g.adj.len() {
            for &(w, _) in &g.adj[u] {
                if u >= w {
                    continue;
                }
                let (a, b) = (g.pts[u], g.pts[w]);
                let grow = 0.0001 / a.0.to_radians().cos().max(0.05);
                let (c0, c1) = (cell((a.0.min(b.0) - 0.0001, a.1.min(b.1) - grow)), cell((a.0.max(b.0) + 0.0001, a.1.max(b.1) + grow)));
                if (c1.0 - c0.0 + 1) * (c1.1 - c0.1 + 1) > 400 {
                    continue; // (a very long stretch: leave it)
                }
                for i in c0.0..=c1.0 {
                    for j in c0.1..=c1.1 {
                        grid.entry((i, j)).or_default().push((u, w));
                    }
                }
            }
        }
        for u in 0..g.pts.len() {
            if g.adj[u].len() != 1 {
                continue;
            }
            let p = g.pts[u];
            let mut best: Option<(usize, usize)> = None;
            let mut near = 8.0;
            for &(a, b) in grid.get(&cell(p)).map(|v| v.as_slice()).unwrap_or(&[]) {
                if a == u || b == u {
                    continue;
                }
                let (d, _) = seg_metres(p, g.pts[a], g.pts[b]);
                if d < near {
                    near = d;
                    best = Some((a, b));
                }
            }
            if let Some((a, b)) = best {
                for w in [a, b] {
                    let d = metres(p, g.pts[w]);
                    link(&mut g, u, w, d);
                }
            }
        }
        // The runways: their centre line from end to end, joined to every taxiway point on or beside them.
        let before = g.pts.len();
        for r in airport_runways(code) {
            let len = runway_length(&r);
            let e = RunwayEnd { thr: (r[0], r[1]), end: (r[2], r[3]), hdg: bearing(r[0], r[1], r[2], r[3]), len, paved: true, key: String::new() };
            let w = if r[4] > 0.0 { r[4] } else { 45.0 };
            let reach = (if r[4] > 0.0 { r[4] } else { 30.0 }).max(18.0) / 2.0 + 25.0;
            let mut at = vec![0.0, len];
            let mut x = 100.0;
            while x < len {
                at.push(x);
                x += 100.0;
            }
            let mut touch = Vec::new();
            for i in 0..before {
                let (along, across) = rwy_coords(&e, g.pts[i]);
                if along < -reach || along > len + reach || across.abs() > reach {
                    continue;
                }
                let x = along.clamp(0.0, len);
                touch.push((i, x.round() as i64));
                at.push(x);
            }
            let mut xs: Vec<i64> = at.iter().map(|x| x.round() as i64).collect();
            xs.sort();
            xs.dedup();
            let ids: Vec<usize> = xs.iter().map(|&x| node(&mut g, rwy_point(&e, x as f64, 0.0))).collect();
            for k in 1..ids.len() {
                link(&mut g, ids[k - 1], ids[k], (xs[k] - xs[k - 1]) as f64 * RUNWAY_TAXI_COST);
            }
            for (i, x) in touch {
                if let Ok(k) = xs.binary_search(&x) {
                    let d = metres(g.pts[i], g.pts[ids[k]]);
                    link(&mut g, i, ids[k], d);
                }
            }
            g.rwys.push(RwyLine { a: e.thr, b: e.end, w, on: ids.iter().copied().collect(), ids });
        }
        // the biggest connected piece
        let mut piece = vec![usize::MAX; g.pts.len()];
        let mut sizes = Vec::new();
        for i in 0..g.pts.len() {
            if piece[i] != usize::MAX {
                continue;
            }
            let id = sizes.len();
            piece[i] = id;
            let (mut stack, mut n) = (vec![i], 0);
            while let Some(u) = stack.pop() {
                n += 1;
                for &(w, _) in &g.adj[u] {
                    if piece[w] == usize::MAX {
                        piece[w] = id;
                        stack.push(w);
                    }
                }
            }
            sizes.push(n);
        }
        let biggest = (0..sizes.len()).max_by_key(|&k| sizes[k]).unwrap_or(0);
        for u in 0..g.adj.len() {
            for &(w, _) in &g.adj[u] {
                if u < w && piece[u] == biggest {
                    g.segs.push((u, w));
                }
            }
        }
        g
    }

    /// Where a plane joins the taxiways from p: the nearest point along a line of the biggest piece.
    fn onto(&self, p: (f64, f64)) -> Option<(f64, (f64, f64), usize, usize)> {
        let mut best: Option<(f64, (f64, f64), usize, usize)> = None;
        for &(u, w) in &self.segs {
            let (a, b) = (self.pts[u], self.pts[w]);
            if (a.0 - p.0).abs() > 0.05 && (b.0 - p.0).abs() > 0.05 {
                continue;
            }
            let (d, pt) = seg_metres(p, a, b);
            if best.is_none_or(|x| d < x.0) {
                best = Some((d, pt, u, w));
            }
        }
        best
    }

    /// Shortest ways from near p to every point (Dijkstra), without going along runway `block`'s centre line
    /// (crossing it is fine). `prev` leads back towards p.
    fn distances(&self, p: (f64, f64), block: Option<usize>) -> Option<Dist> {
        let (_, pt, su, sw) = self.onto(p)?;
        let n = self.pts.len();
        let mut best = vec![f64::INFINITY; n];
        let mut prev = vec![usize::MAX; n];
        let mut heap = BinaryHeap::new();
        for u in [su, sw] {
            let d = metres(pt, self.pts[u]);
            if d < best[u] {
                best[u] = d;
                heap.push(Reverse((d.to_bits(), u)));
            }
        }
        let on = block.map(|k| &self.rwys[k].on);
        while let Some(Reverse((bits, u))) = heap.pop() {
            let d = f64::from_bits(bits);
            if d > best[u] {
                continue;
            }
            let along = on.is_some_and(|s| s.contains(&u));
            for &(w, len) in &self.adj[u] {
                if along && on.is_some_and(|s| s.contains(&w)) {
                    continue;
                }
                let nd = d + len;
                if nd < best[w] {
                    best[w] = nd;
                    prev[w] = u;
                    heap.push(Reverse((nd.to_bits(), w)));
                }
            }
        }
        Some(Dist { best, prev, end: pt, su, sw })
    }

    /// The points from u back to the start (prev chain), u first.
    fn chain(&self, d: &Dist, mut u: usize) -> Vec<(f64, f64)> {
        let mut out = Vec::new();
        while u != usize::MAX {
            out.push(self.pts[u]);
            u = d.prev[u];
        }
        out
    }

    /// Shortest way along the taxiways from near `from` to near `to` (empty if they don't connect them).
    fn path(&self, from: (f64, f64), to: (f64, f64)) -> Vec<(f64, f64)> {
        let (Some(d), Some((_, tpt, tu, tw))) = (self.distances(from, None), self.onto(to)) else { return Vec::new() };
        let via_u = d.best[tu] + metres(self.pts[tu], tpt);
        let via_w = d.best[tw] + metres(self.pts[tw], tpt);
        let same = (d.su == tu && d.sw == tw) || (d.su == tw && d.sw == tu);
        if same && metres(d.end, tpt) <= via_u.min(via_w) {
            return vec![d.end, tpt];
        }
        let end = if via_u <= via_w { tu } else { tw };
        if d.best[end].is_infinite() {
            return Vec::new();
        }
        let mut path = self.chain(&d, end);
        path.reverse();
        path.insert(0, d.end);
        path.push(tpt);
        path
    }

    /// The way between the stand side and runway end `r` (js/game.js realRunwayWay): where the plane turns off
    /// after landing (the best exit from `x_min` metres past the threshold) or comes onto it to take off (an entry
    /// from the side at most `x_max` in, as near the threshold as it can). (x, path in the order it is driven), or
    /// None if no exit or entry fits.
    fn runway_way(&self, r: &RunwayEnd, lane: (f64, f64), landing: bool, x_min: f64, x_max: f64) -> Option<(f64, Vec<(f64, f64)>)> {
        let same = |p: (f64, f64), q: (f64, f64)| (p.0 - q.0).abs() < 1e-7 && (p.1 - q.1).abs() < 1e-7;
        let k = self.rwys.iter().position(|q| same(q.a, r.thr) || same(q.b, r.thr))?;
        let rl = &self.rwys[k];
        let d = self.distances(lane, Some(k))?;
        let mut pick: Option<(f64, f64, usize, usize)> = None; // cost, x, runway point, first off it
        for &id in &rl.ids {
            let x = rwy_coords(r, self.pts[id]).0;
            if x < x_min || x > x_max {
                continue;
            }
            for &(n, len) in &self.adj[id] {
                if rl.on.contains(&n) || d.best[n].is_infinite() {
                    continue;
                }
                // The first 800 m: while on the runway it keeps going the way the plane rolls, and every turn
                // sharper than 135° counts as 3 km more.
                let (mut u, mut p) = (n, self.pts[id]);
                let mut h0 = if landing { r.hdg } else { r.hdg + 180.0 };
                let (mut walked, mut sharp, mut wrong) = (0.0, 0, false);
                while u != usize::MAX && walked < 800.0 {
                    let q = self.pts[u];
                    let m = metres(p, q);
                    if m >= 3.0 {
                        let (a, b) = (rwy_coords(r, p), rwy_coords(r, q));
                        let go = if landing { 1.0 } else { -1.0 } * (b.0 - a.0) / m;
                        if a.1.abs() < rl.w / 2.0 + 3.0 && a.0 > -60.0 && a.0 < r.len + 60.0 && go < -0.5 {
                            wrong = true;
                            break;
                        }
                        let h = bearing(p.0, p.1, q.0, q.1);
                        if ((h - h0 + 540.0).rem_euclid(360.0) - 180.0).abs() > 135.0 {
                            sharp += 1;
                        }
                        h0 = h;
                        walked += m;
                        p = q;
                    }
                    u = d.prev[u];
                }
                if wrong {
                    continue;
                }
                let cost = len + d.best[n] + sharp as f64 * 3000.0 + if landing { (x - x_min) * 0.5 } else { x * 3.0 };
                if pick.is_none_or(|b| cost < b.0) {
                    pick = Some((cost, x, id, n));
                }
            }
        }
        let (_, mut x, id, n) = pick?;
        let mut path = vec![self.pts[id]];
        path.extend(self.chain(&d, n));
        path.push(d.end);
        // a taxiway that ends on the runway a few metres from its point: on or off right there, without a jog
        let c = rwy_coords(r, self.pts[n]);
        if c.1.abs() < (rl.w / 2.0).min(10.0) && (c.0 - x).abs() < 60.0 {
            x = c.0;
            path[0] = rwy_point(r, x, 0.0);
            path.remove(1);
        }
        if !landing {
            path.reverse();
        }
        Some((x, path))
    }
}

struct Dist {
    best: Vec<f64>,
    prev: Vec<usize>,
    end: (f64, f64),
    su: usize,
    sw: usize,
}

thread_local! {
    static GRAPHS: RefCell<HashMap<String, Rc<Graph>>> = RefCell::new(HashMap::new());
    static TRACKS: RefCell<(u64, HashMap<String, (u64, Rc<Track>)>)> = RefCell::new((0, HashMap::new()));
}

/// The taxiway graph of an airport with a real layout that has taxiways.
fn graph(code: &str) -> Option<Rc<Graph>> {
    let lay = crate::layouts::layout(code)?;
    if lay.taxiways.is_empty() {
        return None;
    }
    let rws = airport_runways(code);
    let key = format!("{code}|{}|{}|{:?}", lay.taxiways.len(), lay.taxiways.iter().map(|l| l.len()).sum::<usize>(), rws.iter().map(|r| r[0] + r[1] + r[2] + r[3]).collect::<Vec<_>>());
    GRAPHS.with(|g| {
        let mut g = g.borrow_mut();
        if let Some(x) = g.get(&key) {
            return Some(x.clone());
        }
        if g.len() > 60 {
            g.clear();
        }
        let built = Rc::new(Graph::build(code, &lay.taxiways));
        g.insert(key, built.clone());
        Some(built)
    })
}

/// How far a landing run along a runway's fast exit goes before it meets the parallel taxiway `off` metres away.
fn exit_run(len: f64, off: f64) -> f64 {
    if len >= 1800.0 { off.abs() / 30f64.to_radians().tan() } else { 0.0 }
}

/// The way between the stand side (`lane`) and runway end `r`, in the order it is driven: (x, path). Landing
/// (`along`: where the plane has slowed down, metres past the threshold): from where it turns off the runway, x, to
/// lane. Takeoff: from lane to where it lines up, x metres past the threshold (up to `x_max` in). Along the real
/// taxiways where the airport has them, else along a parallel taxiway on the stand side.
fn runway_way(code: &str, r: &RunwayEnd, lane: (f64, f64), landing: bool, along: f64, x_max: f64) -> (f64, Vec<(f64, f64)>) {
    if let Some(g) = graph(code) {
        if let Some(w) = g.runway_way(r, lane, landing, if landing { along - 100.0 } else { 0.0 }, if landing { r.len } else { x_max }) {
            return w;
        }
        // No exit or entry from the side: along the runway (backtracking), turning round on it where the way goes
        // back the way the plane came.
        let x = if landing { along } else { 0.0 };
        let at = rwy_point(r, x, 0.0);
        let mut path = g.path(lane, at);
        if path.len() >= 2 {
            if landing {
                path.reverse();
            }
            let w = airport_runways(code)
                .iter()
                .find(|q| (q[0] == r.thr.0 && q[1] == r.thr.1) || (q[2] == r.thr.0 && q[3] == r.thr.1))
                .map(|q| if q[4] > 0.0 { q[4] } else { 45.0 })
                .unwrap_or(45.0);
            let seq: Vec<(f64, f64)> = if landing { path.clone() } else { path.iter().rev().copied().collect() };
            let on = |across: f64| across.abs() < w / 2.0 + 3.0;
            let (mut moved, mut m, mut off) = (0.0, 0.0, None);
            for i in 1..seq.len() {
                if m >= 500.0 {
                    break;
                }
                let (a, b) = (rwy_coords(r, seq[i - 1]), rwy_coords(r, seq[i]));
                if on(a.1) && on(b.1) {
                    moved += if landing { 1.0 } else { -1.0 } * (b.0 - a.0);
                }
                if off.is_none() && metres(seq[i], at) >= 30.0 {
                    off = Some(b);
                }
                m += metres(seq[i - 1], seq[i]);
            }
            let Some(off) = off else { return (x, path) };
            let back = moved < -10.0 || (off.0 - x) * if landing { 1.0 } else { -1.0 } < -0.5 * (off.0 - x).hypot(off.1);
            if !back {
                return (x, path);
            }
            let side = if off.1 < 0.0 { -1.0 } else { 1.0 };
            let r4 = 4.0 * (w * 0.27).clamp(6.0, 20.0);
            if landing {
                let mut out = turn_around(r, (along + r4).min(r.len - 25.0), -1.0, w, side)[1..].to_vec();
                out.extend(path);
                return (x, out);
            }
            let mut keep: Vec<(f64, f64)> = path.iter().enumerate().filter(|(i, p)| *i == 0 || metres(**p, at) > r4 + 10.0).map(|(_, p)| *p).collect();
            keep.extend(turn_around(r, 0.0, 1.0, w, side));
            return (0.0, keep);
        }
    }
    // a parallel taxiway on the stand side, joined to the runway at the threshold and by a fast exit
    let across = rwy_coords(r, lane).1;
    let off = if across < 0.0 { -1.0 } else { 1.0 } * (across.abs() * 0.6).clamp(120.0, 180.0);
    let a = rwy_coords(r, lane).0.clamp(0.0, r.len);
    let x = if landing { along } else { 0.0 };
    let run = if landing { exit_run(r.len, off) } else { 0.0 };
    let mut path = vec![lane, rwy_point(r, a, off), rwy_point(r, (x + run).min(r.len), off)];
    if landing {
        path.reverse();
    }
    (x, path)
}

// ---------- the flight's track ----------

#[derive(Clone, Copy)]
enum Ease {
    Both,
    In,
    /// cubic Hermite: starts and ends at m0 and m1 times the segment's average speed
    Hermite(f64, f64),
}

/// Where a flight goes, how high and when (js/game.js buildTrack): pushback, taxi along the taxiways to the
/// runway, takeoff run, climb straight out, a turn at the type's bank angle onto the great circle, cruise at a
/// flight level (odd thousands eastbound, even westbound, lower on short hops), a turn onto a 15 km final, a 3°
/// glide path, the landing run braking to the exit and taxiing in to the stand. Every part takes as long as it
/// really takes; the rest of the block time the plane waits at the gate, boarding.
pub struct Track {
    /// the points (lat, lon) and the distance to each (km)
    pub pts: Vec<(f64, f64)>,
    pub cum: Vec<f64>,
    i_push: usize,
    i_thr: usize,
    i_stop: usize,
    pub cruise_ft: f64,
    pub dep_runway: String,
    pub arr_runway: String,
    /// minutes from leaving the stand (the flight's departure) to arriving at the other one
    pub total: f64,
    /// minutes it waits at the gate first
    pub boarding: f64,
    s_lift: f64,
    s_touch: f64,
    n: usize,
    ds: f64,
    alt: Vec<f64>,
    // the time: the airborne part by `raw` (unscaled minutes at each of `steps` steps), the rest by segments
    t0: f64,
    t1: f64,
    scale: f64,
    raw: Vec<f64>,
    segs: Vec<(f64, f64, f64, f64, Ease)>,
}

impl Track {
    /// Height (ft) at distance s (km) along the track.
    pub fn alt_at(&self, s: f64) -> f64 {
        if s <= self.s_lift || s >= self.s_touch {
            return 0.0;
        }
        let x = (s - self.s_lift) / self.ds;
        let i = (x.floor() as usize).min(self.n - 1);
        self.alt[i] + (self.alt[i + 1] - self.alt[i]) * (x - i as f64)
    }

    /// Distance along the track (km) at minutes since the departure.
    pub fn s_at(&self, tm: f64) -> f64 {
        if tm >= self.t0 && tm <= self.t1 {
            let u = (tm - self.t0) / self.scale;
            let steps = self.raw.len() - 1;
            let (mut lo, mut hi) = (0, steps);
            while hi - lo > 1 {
                let m = (lo + hi) / 2;
                if self.raw[m] <= u { lo = m } else { hi = m }
            }
            let span = self.raw[hi] - self.raw[lo];
            let fr = if span > 0.0 { ((u - self.raw[lo]) / span).clamp(0.0, 1.0) } else { 0.0 };
            return self.s_lift + (self.s_touch - self.s_lift) * (lo as f64 + fr) / steps as f64;
        }
        for &(a, b, s0, s1, ease) in &self.segs {
            if tm < a || tm > b {
                continue;
            }
            let mut u = if b > a { (tm - a) / (b - a) } else { 1.0 };
            u = match ease {
                Ease::In => u * u,
                Ease::Both => u * u * (3.0 - 2.0 * u),
                Ease::Hermite(m0, m1) => (u * u * u - 2.0 * u * u + u) * m0 + (3.0 * u * u - 2.0 * u * u * u) + (u * u * u - u * u) * m1,
            };
            return s0 + (s1 - s0) * u;
        }
        if tm < 0.0 { 0.0 } else { *self.cum.last().unwrap() }
    }

    /// Position and the way it goes at distance s (pushed back: the nose the other way).
    pub fn at(&self, s: f64) -> (f64, f64, f64) {
        let (mut i, mut hi) = (1, self.cum.len() - 1);
        while i < hi {
            let m = (i + hi) / 2;
            if self.cum[m] < s { i = m + 1 } else { hi = m }
        }
        // (a point repeated: the way from the one before)
        let mut j = i;
        while j > 1 && self.cum[j] - self.cum[j - 1] < 1e-9 {
            j -= 1;
        }
        let (a, b) = (self.pts[j - 1], self.pts[j]);
        let seg = self.cum[i] - self.cum[i - 1];
        let fr = if seg > 0.0 { ((s - self.cum[i - 1]) / seg).clamp(0.0, 1.0) } else { 1.0 };
        let (a2, b2) = (self.pts[i - 1], self.pts[i]);
        let mut dlon = b2.1 - a2.1;
        if dlon > 180.0 {
            dlon -= 360.0;
        }
        if dlon < -180.0 {
            dlon += 360.0;
        }
        let lon = a2.1 + dlon * fr;
        let lon = (lon + 540.0).rem_euclid(360.0) - 180.0;
        let h = bearing(a.0, a.1, b.0, b.1) + if j == self.i_push { 180.0 } else { 0.0 };
        (a2.0 + (b2.0 - a2.0) * fr, lon, h.rem_euclid(360.0))
    }

    /// Distance (km) at the threshold, lift-off, touchdown, where it leaves the runway, and in all.
    pub fn marks(&self) -> (f64, f64, f64, f64, f64) {
        (self.cum[self.i_thr], self.s_lift, self.s_touch, self.cum[self.i_stop], *self.cum.last().unwrap())
    }

    #[allow(clippy::too_many_arguments)]
    fn build(kind: &str, from: &str, to: &str, total: f64, dep: RunwayEnd, arr: RunwayEnd, sa: (f64, f64, f64), sb: (f64, f64, f64)) -> Track {
        let ac = data().ac(kind);
        let (climb_fpm, v_lof, v_app) = perf(kind);
        let bank: f64 = if ac.category == "classic" { 20.0 } else { 25.0 };
        let (need, _) = runway_need(kind);
        // turn radius at the bank angle at about 1.35 × the approach speed: r = v² / (g tan φ)
        let v_turn = v_app * 1.35 / 3.6;
        let radius = v_turn * v_turn / (9.81 * bank.to_radians().tan());
        let v_lof_ms = v_lof / 3.6;
        let v_app_ms = v_app / 3.6;
        // landing run within the runway, braking at the type's rate (reversers help: they turn off earlier)
        let props = ac.category == "turboprop" || ac.category == "classic";
        let decel = if props { 1.4 } else { 1.6 };
        let stop_m = (arr.len * 0.85).min((400.0 + 300.0f64).max(400.0 + v_app_ms * v_app_ms / (2.0 * decel)));

        let (stand_a, stand_b) = ((sa.0, sa.1), (sb.0, sb.1));
        let push_a = offset_point(sa.0, sa.1, sa.2 + 180.0, TAXI_LANE);
        let lead_b = offset_point(sb.0, sb.1, sb.2 + 180.0, TAXI_LANE);
        let (out_x, out_path) = runway_way(from, &dep, push_a, false, 0.0, (dep.len - need).min(400.0).max(60.0));
        let (in_x, in_path) = runway_way(to, &arr, lead_b, true, stop_m, 0.0);
        let line_up = if out_x > 1.0 { rwy_point(&dep, out_x, 0.0) } else { dep.thr };
        let stop = rwy_point(&arr, in_x, 0.0);
        let near = |p: Option<&(f64, f64)>, q: (f64, f64)| p.is_some_and(|p| metres(*p, q) < 5.0);
        let out_path: Vec<(f64, f64)> = if near(out_path.last(), line_up) { out_path[..out_path.len() - 1].to_vec() } else { out_path };
        let in_path: Vec<(f64, f64)> = if near(in_path.first(), stop) { in_path[1..].to_vec() } else { in_path };
        let roll_m = ((dep.len - out_x) * 0.85).min((v_lof_ms * v_lof_ms / 4.4).max(250.0));
        let lift = offset_point(line_up.0, line_up.1, dep.hdg, roll_m);
        let climb_out = offset_point(dep.end.0, dep.end.1, dep.hdg, if ac.speed_kmh < 450.0 { 2500.0 } else { 5000.0 });
        let faf = offset_point(arr.thr.0, arr.thr.1, arr.hdg + 180.0, FINAL_KM * 1000.0);
        let touch = offset_point(arr.thr.0, arr.thr.1, arr.hdg, 400.0);
        let out_turn = turn_toward(climb_out, dep.hdg, faf, radius);
        let turn_end = *out_turn.last().unwrap_or(&climb_out);
        // (the arrival turn is built backwards from the final approach fix)
        let mut in_turn = turn_toward(faf, arr.hdg + 180.0, turn_end, radius);
        in_turn.reverse();
        let turn_start = *in_turn.first().unwrap_or(&faf);
        let cruise_km = distance_km(turn_end.0, turn_end.1, turn_start.0, turn_start.1);
        let n_cruise = ((cruise_km / 25.0).ceil() as usize).max(1);

        let mut pts = vec![stand_a, push_a];
        pts.extend(&out_path);
        pts.extend([line_up, lift, dep.end, climb_out]);
        pts.extend(&out_turn);
        for i in 1..n_cruise {
            pts.push(interpolate(turn_end.0, turn_end.1, turn_start.0, turn_start.1, i as f64 / n_cruise as f64));
        }
        pts.extend(&in_turn);
        pts.extend([faf, arr.thr, touch, stop]);
        pts.extend(&in_path);
        pts.extend([lead_b, stand_b]);
        let i_thr = 2 + out_path.len();
        let (i_lift, i_touch, i_stop, i_lead) = (i_thr + 1, pts.len() - 4 - in_path.len(), pts.len() - 3 - in_path.len(), pts.len() - 2);
        let mut cum = vec![0.0];
        for w in pts.windows(2) {
            cum.push(cum.last().unwrap() + distance_km(w[0].0, w[0].1, w[1].0, w[1].1));
        }

        // ---------- heights (ft) between lift-off and touchdown ----------
        let type_cruise = cruise_ft(kind);
        let v_cruise = ac.speed_kmh;
        let v250 = v_cruise.min(463.0);
        let climb_rate = |alt: f64| climb_fpm * (1.0 - 0.65 * alt / type_cruise).max(0.3);
        let (s_lift, s_touch) = (cum[i_lift], cum[i_touch]);
        let airborne = (s_touch - s_lift).max(0.1);
        let n = ((airborne / 0.4).ceil() as usize).clamp(200, 4000);
        let ds = airborne / n as f64;
        let at_s = |i: usize| s_lift + i as f64 * ds;
        // speed (km/h): lift-off speed to 250 kt by 3000 ft, cruise speed above 10,000 ft, slowing to the approach
        // speed for the last 25 km before the final approach fix
        let speed_at = |s: f64, alt: f64, cruise_alt: f64| {
            let mut v = if alt < 3000.0 {
                v_lof * 1.15 + (v250 - v_lof * 1.15) * (alt.max(0.0) / 3000.0).sqrt()
            } else if alt < 10000.0 {
                v250
            } else {
                v250 + (v_cruise - v250) * ((alt - 10000.0) / (cruise_alt - 10000.0).max(5000.0)).min(1.0)
            };
            let to_touch = s_touch - s;
            if to_touch < FINAL_KM {
                v = v_app * (0.93 + 0.07 * to_touch / FINAL_KM);
            } else if to_touch < FINAL_KM + 25.0 {
                v = v.min(v_app + (v250 - v_app) * (to_touch - FINAL_KM) / 25.0);
            }
            v.max(v_lof.min(v_app) * 0.9)
        };
        // highest it can be: climbing at its rate from the runway, and still able to come down a 3° glide path
        let mut cl = vec![0.0; n + 1];
        for i in 0..n {
            let v = speed_at(at_s(i), cl[i], type_cruise) / 60.0;
            cl[i + 1] = type_cruise.min(cl[i] + climb_rate(cl[i]) * ds / v);
        }
        let glide = 1000.0 / DESCENT_KM_PER_KFT; // ft per km
        let dn: Vec<f64> = (0..=n)
            .map(|i| {
                let d = s_touch - at_s(i);
                d.min(FINAL_KM) * glide + (d - FINAL_KM).max(0.0) / DESCENT_KM_PER_KFT * 1000.0
            })
            .collect();
        let peak = (0..=n).map(|i| cl[i].min(dn[i])).fold(0.0, f64::max);
        let mut fl = (type_cruise.min(peak) / 1000.0).floor() as i64;
        let a0 = data().airport(from);
        let b0 = data().airport(to);
        let east = bearing(a0.lat, a0.lon, b0.lat, b0.lon) < 180.0;
        if fl >= 5 && fl % 2 != if east { 1 } else { 0 } {
            fl -= 1;
        }
        let cruise_alt = (fl as f64 * 1000.0).max(1000.0);
        let mut alt: Vec<f64> = (0..=n).map(|i| cl[i].min(dn[i]).min(cruise_alt)).collect();
        alt[0] = 0.0;
        alt[n] = 0.0;

        // ---------- times (minutes) ----------
        let steps = n.min(600);
        let mut raw = vec![0.0];
        let alt_of = |s: f64| {
            let x = ((s - s_lift) / ds).clamp(0.0, n as f64);
            let i = (x.floor() as usize).min(n - 1);
            alt[i] + (alt[i + 1] - alt[i]) * (x - i as f64)
        };
        for i in 1..=steps {
            let sm = s_lift + airborne * (i as f64 - 0.5) / steps as f64;
            raw.push(raw[i - 1] + (airborne / steps as f64) / (speed_at(sm, alt_of(sm), cruise_alt) / 60.0));
        }
        let s_hold = cum[1].max(cum[i_thr] - HOLD_KM);
        let taxi = |km: f64| km / TAXI_KMH * 60.0;
        let t_taxi_out = taxi(s_hold - cum[1]);
        let t_line_up = taxi(cum[i_thr] - s_hold) + 0.5;
        let t_roll = 2.0 * (roll_m / 1000.0) / (v_lof / 60.0);
        // braking evenly from the touchdown speed to taxi speed at the exit, and taxiing on at that speed
        let v_touch = v_app * 0.93;
        let v_exit = TAXI_KMH * 1.2;
        let t_land = 2.0 * (cum[i_stop] - s_touch) / ((v_touch + v_exit) / 60.0);
        let t_taxi_in = taxi(cum[i_lead] - cum[i_stop]);
        let air = raw[steps];
        let natural = PUSHBACK + t_taxi_out + t_line_up + t_roll + air + t_land + t_taxi_in + DOCK;
        // too little time (a long way round): everything a little faster
        let k = (total / natural).min(1.0);
        let wait = (total - natural).max(0.0);
        let mut segs = Vec::new();
        let mut t = 0.0;
        let seg = |segs: &mut Vec<_>, t: &mut f64, dt: f64, s0: f64, s1: f64, e: Ease| {
            segs.push((*t, *t + dt, s0, s1, e));
            *t += dt;
        };
        seg(&mut segs, &mut t, wait, 0.0, 0.0, Ease::Both);
        seg(&mut segs, &mut t, PUSHBACK * k, 0.0, cum[1], Ease::Both);
        seg(&mut segs, &mut t, t_taxi_out * k, cum[1], s_hold, Ease::Both);
        seg(&mut segs, &mut t, t_line_up * k, s_hold, cum[i_thr], Ease::Both);
        seg(&mut segs, &mut t, t_roll * k, cum[i_thr], s_lift, Ease::In);
        let t0 = t;
        let t1 = t0 + air * k;
        t = t1;
        seg(&mut segs, &mut t, t_land * k, s_touch, cum[i_stop], Ease::Hermite(2.0 * v_touch / (v_touch + v_exit), 2.0 * v_exit / (v_touch + v_exit)));
        let end = *cum.last().unwrap();
        let v_dock = (end - cum[i_lead]) / DOCK * 60.0;
        seg(&mut segs, &mut t, t_taxi_in * k, cum[i_stop], cum[i_lead], Ease::Hermite(v_exit / TAXI_KMH, v_dock / TAXI_KMH));
        let rest = (total - t).max(0.0);
        seg(&mut segs, &mut t, rest, cum[i_lead], end, Ease::Hermite(1.0, 0.0));

        Track {
            pts,
            cum,
            i_push: 1,
            i_thr,
            i_stop,
            cruise_ft: cruise_alt,
            dep_runway: designator(dep.hdg),
            arr_runway: designator(arr.hdg),
            total,
            boarding: wait,
            s_lift,
            s_touch,
            n,
            ds,
            alt,
            t0,
            t1,
            scale: k,
            raw,
            segs,
        }
    }
}

/// A track out of the cache, or built and kept (the 300 used last).
#[allow(clippy::too_many_arguments)]
fn cached(kind: &str, from: &str, to: &str, total: f64, dep: RunwayEnd, arr: RunwayEnd, sa: (f64, f64, f64), sb: (f64, f64, f64)) -> Rc<Track> {
    let key = format!(
        "{kind}|{from}|{to}|{total}|{}|{}|{:.7},{:.7},{:.1}|{:.7},{:.7},{:.1}|{}",
        dep.key, dep.hdg as i64, sa.0, sa.1, sa.2, sb.0, sb.1, sb.2, arr.key.clone() + &(arr.hdg as i64).to_string()
    );
    TRACKS.with(|c| {
        let mut c = c.borrow_mut();
        c.0 += 1;
        let now = c.0;
        if let Some(e) = c.1.get_mut(&key) {
            e.0 = now;
            return e.1.clone();
        }
        if c.1.len() >= 300 {
            if let Some(old) = c.1.iter().min_by_key(|(_, v)| v.0).map(|(k, _)| k.clone()) {
                c.1.remove(&old);
            }
        }
        let tr = Rc::new(Track::build(kind, from, to, total, dep, arr, sa, sb));
        c.1.insert(key, (now, tr.clone()));
        tr
    })
}

impl Game {
    /// Where a plane stands at an airport: one of the real stands where the browser game has its layout (each of
    /// your planes its own), else on a row of stands beside the main runway. (lat, lon, heading, stand name)
    pub fn stand_of(&self, code: &str, i: usize) -> (f64, f64, f64, String) {
        let here: Vec<usize> = (0..self.state.planes.len())
            .filter(|&k| {
                let q = &self.state.planes[k];
                q.location == code || q.flight.as_ref().is_some_and(|f| f.to == code || f.from == code)
            })
            .collect();
        let n = here.iter().position(|&k| k == i).unwrap_or(i);
        if let Some(l) = crate::layouts::layout(code).filter(|l| !l.stands.is_empty()) {
            let s = &l.stands[(n * 7 + 3) % l.stands.len()];
            return (s.0, s.1, s.2, s.3.clone());
        }
        let a = data().airport(code);
        let rws = airport_runways(code);
        let Some(r) = rws.iter().max_by(|x, y| runway_length(x).total_cmp(&runway_length(y))) else {
            let p = offset_point(a.lat, a.lon, 135.0 + i as f64 * 25.0, 350.0 + 60.0 * (i % 4) as f64);
            return (p.0, p.1, 0.0, String::new());
        };
        // (beside the middle of the longest runway, on the side of the airport's point, noses away from it)
        let e = RunwayEnd { thr: (r[0], r[1]), end: (r[2], r[3]), hdg: bearing(r[0], r[1], r[2], r[3]), len: runway_length(r), paved: true, key: String::new() };
        let side = if rwy_coords(&e, (a.lat, a.lon)).1 < 0.0 { -1.0 } else { 1.0 };
        let row = (n / 8) as f64;
        let along = e.len / 2.0 + ((n % 8) as f64 - 3.5) * 65.0;
        let p = rwy_point(&e, along, side * (280.0 + row * 110.0));
        (p.0, p.1, (e.hdg + 90.0 * side).rem_euclid(360.0), format!("{}", n + 1))
    }

    /// The runway a plane takes at an airport for a flight starting on game day `day`.
    pub fn runway_for(&self, p: &Plane, code: &str, day: i64) -> RunwayEnd {
        pick_runway(code, day, &p.kind, p.runways.get(code).map(|s| s.as_str()))
    }

    /// The track of plane i's flight now, if it flies.
    pub fn flight_track(&self, i: usize) -> Option<Rc<Track>> {
        let p = &self.state.planes[i];
        let f: &Flight = p.flight.as_ref().filter(|_| p.status == Status::Flying)?;
        let rf = pick_runway(&f.from, f.dep.div_euclid(DAY), &p.kind, f.rw_from.as_deref().or(p.runways.get(&f.from).map(|s| s.as_str())));
        let rt = pick_runway(&f.to, f.arr.div_euclid(DAY), &p.kind, f.rw_to.as_deref().or(p.runways.get(&f.to).map(|s| s.as_str())));
        let a = self.stand_of(&f.from, i);
        let b = self.stand_of(&f.to, i);
        Some(cached(&p.kind, &f.from, &f.to, (f.arr - f.dep) as f64, rf, rt, (a.0, a.1, a.2), (b.0, b.1, b.2)))
    }

    /// Today's track for a leg plane i flies (for the route lines): the runways it takes today.
    pub fn leg_track(&self, i: usize, from: &str, to: &str) -> Rc<Track> {
        let p = &self.state.planes[i];
        let day = self.state.time.div_euclid(DAY);
        let rf = pick_runway(from, day, &p.kind, p.runways.get(from).map(|s| s.as_str()));
        let rt = pick_runway(to, day, &p.kind, p.runways.get(to).map(|s| s.as_str()));
        let a = self.stand_of(from, i);
        let b = self.stand_of(to, i);
        let block = crate::game::block_minutes(&p.kind, data().dist(from, to)) as f64;
        cached(&p.kind, from, to, block, rf, rt, (a.0, a.1, a.2), (b.0, b.1, b.2))
    }

    /// "FL370 · 830 km/h · Cruising", "Taxiing to runway 28" (the browser game's flightText).
    pub fn flight_text(&self, i: usize, t: f64) -> String {
        let pos = self.flight_pos(i, t);
        let Some(tr) = self.flight_track(i) else { return pos.phase.to_string() };
        let kmh = (pos.speed_kt * 1.852).round();
        let (dep, arr) = (&tr.dep_runway, &tr.arr_runway);
        let alt = if pos.alt_ft >= 10000.0 { format!("FL{:.0}", pos.alt_ft / 100.0) } else { format!("{:.0} ft", (pos.alt_ft / 100.0).round() * 100.0) };
        match pos.phase {
            "Boarding" => format!("Boarding · runway {dep}"),
            "Pushback" => format!("Pushing back · runway {dep}"),
            "Taxiing to the runway" => format!("Taxiing to runway {dep}"),
            "Take-off run" => format!("Taking off from runway {dep} · {kmh} km/h"),
            "Landing" => format!("Landing on runway {arr} · {kmh} km/h"),
            "Taxiing to the stand" => format!("Taxiing to the stand from runway {arr}"),
            "Final approach" => format!("{alt} · {kmh} km/h · on final runway {arr}"),
            ph => format!("{alt} · {kmh} km/h · {ph}"),
        }
    }

    /// Where plane i is at fractional game time t, and what it does.
    pub fn flight_pos(&self, i: usize, t: f64) -> FlightPos {
        let p = &self.state.planes[i];
        let tr = match (&p.flight, p.status) {
            (Some(_), Status::Flying) => self.flight_track(i),
            _ => None,
        };
        let (Some(tr), Some(f)) = (tr, p.flight.as_ref()) else {
            let (lat, lon, hdg, _) = self.stand_of(&p.location, i);
            let phase = if p.status == Status::Turnaround { "At the gate (turnaround)" } else { "At the gate" };
            return FlightPos { lat, lon, heading: hdg, track: hdg, crab: 0.0, alt_ft: 0.0, speed_kt: 0.0, phase, airborne: false, since_push: -1.0, cruise_ft: 0.0 };
        };
        let m = (t - f.dep as f64).clamp(0.0, tr.total);
        let s = tr.s_at(m);
        let (lat, lon, track) = tr.at(s);
        let alt = tr.alt_at(s);
        let kmh = (tr.s_at((m + 0.25).min(tr.total)) - tr.s_at((m - 0.25).max(0.0))).max(0.0) * 120.0;
        let (s_thr, s_lift, s_touch, s_stop, _) = tr.marks();
        let phase = if m < tr.boarding {
            "Boarding"
        } else if s < tr.cum[tr.i_push] {
            "Pushback"
        } else if s < s_thr {
            "Taxiing to the runway"
        } else if s < s_lift {
            "Take-off run"
        } else if s >= s_stop {
            "Taxiing to the stand"
        } else if s >= s_touch {
            "Landing"
        } else if s_touch - s < FINAL_KM + 1.0 {
            "Final approach"
        } else if alt >= tr.cruise_ft - 50.0 {
            "Cruising"
        } else if tr.alt_at(s + 0.5) >= alt {
            "Climbing"
        } else {
            "Descending"
        };
        let airborne = s > s_lift && s < s_touch;
        // crab: in a crosswind the nose points partly into the wind so the plane keeps to its track; it builds up
        // over the first 1000 ft and is kicked out just before touchdown
        let mut crab = 0.0;
        if airborne {
            let (from, wkt) = self.wind_at(lat, lon, t, alt);
            let kt = (kmh / 1.852).max(60.0);
            crab = ((wkt / kt) * (from - track).to_radians().sin()).clamp(-1.0, 1.0).asin().to_degrees().clamp(-MAX_CRAB, MAX_CRAB);
            crab *= if phase == "Climbing" { crate::weather::smooth(0.0, 1000.0, alt) } else { (alt / 40.0).clamp(0.0, 1.0) };
        }
        FlightPos {
            lat,
            lon,
            heading: (track + crab).rem_euclid(360.0),
            track,
            crab,
            alt_ft: alt,
            speed_kt: kmh / 1.852,
            phase,
            airborne,
            since_push: m - tr.boarding,
            cruise_ft: tr.cruise_ft,
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
        let first = g.flight_pos(0, f.dep as f64 + 0.5).phase;
        assert!(first == "Boarding" || first == "Pushback", "{first}");
        // it takes off from a runway end and lands on one, and taxis there along the way
        let tr = g.flight_track(0).unwrap();
        let (s_thr, s_lift, s_touch, s_stop, end) = tr.marks();
        assert!(s_thr < s_lift && s_lift < s_touch && s_touch < s_stop && s_stop < end);
        assert!(tr.cruise_ft >= 5000.0, "{}", tr.cruise_ft);
        // no jumps: from one minute to the next it moves no further than it can fly
        let mut last = g.flight_pos(0, f.dep as f64);
        let mut m = f.dep as f64;
        while m < f.arr as f64 {
            m += 0.1;
            let q = g.flight_pos(0, m);
            let km = distance_km(last.lat, last.lon, q.lat, q.lon);
            assert!(km < 2.5, "{km} km at {m}: {} → {}", last.phase, q.phase);
            last = q;
        }
        assert!(!g.flight_pos(0, f.arr as f64 - 0.5).airborne);
    }

    #[test]
    fn made_up_airports() {
        // two airports without a real layout but with runways: the stands lie beside the main runway, and the
        // taxiing stays at the airport
        let d = data();
        let codes: Vec<&str> = d.airports.iter().filter(|a| !a.factory && !crate::layouts::has_layout(&a.code) && airport_runways(&a.code).len() == 1 && a.runway > 2000.0).map(|a| a.code.as_str()).take(2).collect();
        let (a, b) = (codes[0], codes[1]);
        let pr = data().presets.iter().find(|p| p.id == "europe").unwrap();
        let (g, _) = Game::from_preset(pr);
        let sa = g.stand_of(a, 0);
        let rw = pick_runway(a, 0, "A320", None);
        assert!(rwy_coords(&rw, (sa.0, sa.1)).1.abs() > 150.0, "stand off the runway");
        let sb = g.stand_of(b, 0);
        let block = crate::game::block_minutes("A320", data().dist(a, b)) as f64 + 30.0;
        let tr = cached("A320", a, b, block, rw.clone(), pick_runway(b, 0, "A320", None), (sa.0, sa.1, sa.2), (sb.0, sb.1, sb.2));
        let (thr, ..) = tr.marks();
        let ap = data().airport(a);
        for (k, p) in tr.pts.iter().enumerate() {
            if tr.cum[k] <= thr {
                assert!(distance_km(p.0, p.1, ap.lat, ap.lon) < 5.0);
            }
        }
        assert!(tr.boarding > 0.0);
    }
}
