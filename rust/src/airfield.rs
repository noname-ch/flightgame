//! The airports' ground in the 3D view, as the browser game draws it on its map (js/view3d.js `gateFeatures`,
//! `runwayPaint`, `holdBars` and the fg-* layers' colours): paved and grass runways with their white paint (side
//! stripes, the dashed centre line, threshold stripes, aiming points, touchdown zone bars, the numbers), taxiways
//! with their shoulders and yellow centre lines (not across the aprons), aprons and pads in solid concrete (the
//! satellite picture's own parked planes don't show through), holding positions where taxiways come up to a
//! runway, and the stands' yellow lead-in lines and stop bars. Airports without a layout of their own get the
//! made-up apron and parallel taxiway their planes use (track.rs `stand_of`, `runway_way`).
//!
//! All flat, in metres east (x) and north (y) of the airport's point, a few centimetres above its levelled ground,
//! each layer a little higher than the one under it (in the browser's order).

use crate::view3d::triangulate;
use flightgame::data::data;
use flightgame::game::{airport_runways, airport_size, runway_length};

type P = (f64, f64);

/// The ground's triangles: positions (x east, y north, z up, metres from the airport's point), colours (linear RGBA).
pub struct Flat {
    pub pos: Vec<[f32; 3]>,
    pub color: Vec<[f32; 4]>,
    pub indices: Vec<u32>,
}

// The layers' heights above the ground (m), in the browser's order of its layers: shoulders, taxiways, their
// centre lines, runways, aprons, pads, the runways' paint, holding positions, stand markings.
const Z_SHOULDER: f32 = 0.05;
const Z_TAXIWAY: f32 = 0.07;
const Z_TWLINE: f32 = 0.09;
const Z_GRASS: f32 = 0.10;
const Z_RUNWAY: f32 = 0.11;
const Z_APRON: f32 = 0.13;
const Z_PAD: f32 = 0.14;
const Z_PAINT: f32 = 0.16;
const Z_HOLD: f32 = 0.17;
const Z_STAND: f32 = 0.18;

/// A colour as the browser writes it (#rrggbb), linear. (The greys half as blue: under Bevy's sky light, bluer than
/// the browser's map light, the asphalt came out navy.)
fn hex(c: u32) -> [f32; 4] {
    let ch = |v: u32| ((v & 255) as f32 / 255.0).powf(2.2);
    let [r, g, b] = [ch(c >> 16), ch(c >> 8), ch(c)];
    let (mx, mn) = (r.max(g).max(b), r.min(g).min(b));
    if mx - mn < 0.25 * mx {
        let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return [(r + y) / 2.0, (g + y) / 2.0, (b + y) / 2.0 * 0.92, 1.0];
    }
    [r, g, b, 1.0]
}

struct B {
    f: Flat,
}

impl B {
    fn tri(&mut self, a: P, b: P, c: P, z: f32, col: [f32; 4]) {
        // (counter-clockwise from above: facing up)
        let cross = (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
        let (b, c) = if cross < 0.0 { (c, b) } else { (b, c) };
        let n = self.f.pos.len() as u32;
        for p in [a, b, c] {
            self.f.pos.push([p.0 as f32, p.1 as f32, z]);
            self.f.color.push(col);
        }
        self.f.indices.extend([n, n + 1, n + 2]);
    }
    fn quad(&mut self, q: [P; 4], z: f32, col: [f32; 4]) {
        self.tri(q[0], q[1], q[2], z, col);
        self.tri(q[0], q[2], q[3], z, col);
    }
    fn poly(&mut self, ring: &[P], z: f32, col: [f32; 4]) {
        let mut pts: Vec<(f32, f32)> = ring.iter().map(|p| (p.0 as f32, p.1 as f32)).collect();
        if pts.len() > 2 && (pts[0].0 - pts[pts.len() - 1].0).abs() < 0.01 && (pts[0].1 - pts[pts.len() - 1].1).abs() < 0.01 {
            pts.pop();
        }
        for [a, b, c] in triangulate(&pts) {
            let p = |i: usize| (pts[i].0 as f64, pts[i].1 as f64);
            self.tri(p(a), p(b), p(c), z, col);
        }
    }
    /// A strip `w` wide along a -> b, `ext` longer at both ends.
    fn strip(&mut self, a: P, b: P, w: f64, ext: f64, z: f32, col: [f32; 4]) {
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let len = dx.hypot(dy);
        if len < 1e-6 {
            return;
        }
        let (ux, uy) = (dx / len, dy / len);
        let (rx, ry) = (uy * w / 2.0, -ux * w / 2.0);
        let (a, b) = ((a.0 - ux * ext, a.1 - uy * ext), (b.0 + ux * ext, b.1 + uy * ext));
        self.quad([(a.0 - rx, a.1 - ry), (b.0 - rx, b.1 - ry), (b.0 + rx, b.1 + ry), (a.0 + rx, a.1 + ry)], z, col);
    }
    fn disc(&mut self, c: P, r: f64, z: f32, col: [f32; 4]) {
        let n = 12;
        for k in 0..n {
            let (a0, a1) = (k as f64 / n as f64 * std::f64::consts::TAU, (k + 1) as f64 / n as f64 * std::f64::consts::TAU);
            self.tri(c, (c.0 + r * a0.cos(), c.1 + r * a0.sin()), (c.0 + r * a1.cos(), c.1 + r * a1.sin()), z, col);
        }
    }
    /// A wide line along the points, with round joints and ends (as the map's line-join round).
    fn path(&mut self, pts: &[P], w: f64, z: f32, col: [f32; 4]) {
        for s in pts.windows(2) {
            self.strip(s[0], s[1], w, 0.0, z, col);
        }
        if w >= 3.0 {
            for &p in pts {
                self.disc(p, w / 2.0, z, col);
            }
        }
    }
}

/// A runway in metres: its first end, the unit vector along it, its length and width; points by (along, across:
/// + to the right).
#[derive(Clone, Copy)]
struct Frame {
    a: P,
    u: P,
    len: f64,
    width: f64,
    hdg: f64,
}

impl Frame {
    fn at(&self, along: f64, across: f64) -> P {
        // (right of the way along: u turned clockwise)
        (self.a.0 + self.u.0 * along + self.u.1 * across, self.a.1 + self.u.1 * along - self.u.0 * across)
    }
    fn of(&self, p: P) -> P {
        let (x, y) = (p.0 - self.a.0, p.1 - self.a.1);
        (x * self.u.0 + y * self.u.1, x * self.u.1 - y * self.u.0)
    }
    fn corners(&self, ext: f64) -> [P; 4] {
        let w = self.width / 2.0;
        [self.at(-ext, -w), self.at(self.len + ext, -w), self.at(self.len + ext, w), self.at(-ext, w)]
    }
}

/// Where the other runways cross this one (G.runwayCover): the stretches of along a0..a1 that are open within the
/// band c0..c1 across it.
fn open(f: &Frame, others: &[Frame], a0: f64, a1: f64, c0: f64, c1: f64) -> Vec<(f64, f64)> {
    let mut free = vec![(a0, a1)];
    for o in others {
        // the other runway's slab in this one's frame, clipped to the band: its stretch along
        let mut poly: Vec<P> = o.corners(0.0).iter().map(|&p| f.of(p)).collect();
        for (lim, keep_above) in [(c0, true), (c1, false)] {
            let inside = |p: &P| if keep_above { p.1 >= lim } else { p.1 <= lim };
            let mut out = Vec::new();
            for i in 0..poly.len() {
                let (p, q) = (poly[i], poly[(i + 1) % poly.len()]);
                if inside(&p) {
                    out.push(p);
                }
                if inside(&p) != inside(&q) {
                    let t = (lim - p.1) / (q.1 - p.1);
                    out.push((p.0 + t * (q.0 - p.0), lim));
                }
            }
            poly = out;
            if poly.is_empty() {
                break;
            }
        }
        if poly.is_empty() {
            continue;
        }
        let (lo, hi) = poly.iter().fold((f64::MAX, f64::MIN), |(lo, hi), p| (lo.min(p.0), hi.max(p.0)));
        free = free.into_iter().flat_map(|(s, e)| {
            let mut v = Vec::new();
            if lo > s {
                v.push((s, lo.min(e)));
            }
            if hi < e {
                v.push((hi.max(s), e));
            }
            v.into_iter().filter(|(s, e)| e - s > 0.01)
        }).collect();
    }
    free
}

/// The segments of a digit (as a seven-segment figure: a top, b top right, c bottom right, d bottom, e bottom left,
/// f top left, g middle).
fn segments(d: u32) -> &'static str {
    ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgedc", "abc", "abcdefg", "abcdfg"][d as usize % 10]
}

/// The white paint of a paved runway (`runwayPaint`), as rectangles, and its two numbers, each read from its own end.
fn runway_paint(b: &mut B, f: &Frame, others: &[Frame]) {
    let white = hex(0xeef0f3);
    let (len, w) = (f.len, f.width);
    let rect = |b: &mut B, a0: f64, a1: f64, c: f64, cw: f64| {
        for (s, e) in open(f, others, a0.min(a1), a0.max(a1), c - cw / 2.0, c + cw / 2.0) {
            b.quad([f.at(s, c - cw / 2.0), f.at(e, c - cw / 2.0), f.at(e, c + cw / 2.0), f.at(s, c + cw / 2.0)], Z_PAINT, white);
        }
    };
    for s in [-1.0, 1.0] {
        rect(b, 0.0, len, s * (w / 2.0 - 1.0), 1.0);
    }
    let mut x = 80.0;
    while x + 30.0 <= len - 80.0 {
        rect(b, x, x + 30.0, 0.0, 1.2);
        x += 50.0;
    }
    let n = if w >= 45.0 { 12 } else if w >= 30.0 { 8 } else if w >= 23.0 { 6 } else { 4 };
    let sw = (w / 2.0 - 0.9) / n as f64;
    let aim = if len >= 2400.0 { 400.0 } else { 300.0 };
    let inner = w * 0.2;
    for end in [false, true] {
        let xx = |x: f64| if end { len - x } else { x };
        for i in 0..n / 2 {
            for s in [-1.0, 1.0] {
                rect(b, xx(6.0), xx(36.0), s * sw * (1.5 + 2.0 * i as f64), sw);
            }
        }
        if len >= 1200.0 {
            let aw = if w >= 45.0 { 9.0 } else { w * 0.18 };
            for s in [-1.0, 1.0] {
                rect(b, xx(aim), xx(aim + if len >= 2400.0 { 60.0 } else { 45.0 }), s * (inner + aw / 2.0), aw);
            }
        }
        if len < 1800.0 || w < 30.0 {
            continue;
        }
        for (x, bars) in [(150.0, 3), (300.0, 3), (450.0, 2), (600.0, 2), (750.0, 1), (900.0, 1)] {
            if (x - aim).abs() < 80.0 {
                continue;
            }
            for i in 0..bars {
                for s in [-1.0, 1.0] {
                    rect(b, xx(x), xx(x + 22.5), s * (inner + 0.9 + i as f64 * 3.3), 1.8);
                }
            }
        }
    }
    // the numbers (the heading in tens), each upright for a pilot coming in over its own end; none where it would
    // lie on another runway
    if len < 400.0 {
        return;
    }
    let num = |h: f64| {
        let v = ((h / 10.0).round() as i64).rem_euclid(36);
        if v == 0 { 36 } else { v as u32 }
    };
    let gh = if w >= 45.0 { 9.0 } else { (w / 5.0).max(3.0) };
    let (gw, t) = (gh * 0.5, gh * 0.14);
    for (end, h) in [(false, f.hdg), (true, f.hdg + 180.0)] {
        let x = if end { len - 50.0 } else { 50.0 };
        let o = open(f, others, x - 20.0, x + 20.0, -w / 4.0, w / 4.0);
        if !(o.len() == 1 && o[0].1 - o[0].0 >= 40.0) {
            continue;
        }
        let v = num(h);
        let digits = [v / 10, v % 10];
        // a point of the figure (right, up) in metres from its middle, in the runway's frame
        let dir = if end { -1.0 } else { 1.0 };
        let put = |r: f64, up: f64| f.at(x + dir * up, dir * r);
        let gap = gw * 0.35;
        for (k, d) in digits.iter().enumerate() {
            let cx = (k as f64 - 0.5) * (gw + gap);
            let (l, r, top, bot, mid) = (cx - gw / 2.0, cx + gw / 2.0, gh / 2.0, -gh / 2.0, 0.0);
            let bar = |b: &mut B, x0: f64, y0: f64, x1: f64, y1: f64| {
                b.quad([put(x0, y0), put(x1, y0), put(x1, y1), put(x0, y1)], Z_PAINT, white);
            };
            for s in segments(*d).chars() {
                match s {
                    'a' => bar(b, l, top - t, r, top),
                    'd' => bar(b, l, bot, r, bot + t),
                    'g' => bar(b, l, mid - t / 2.0, r, mid + t / 2.0),
                    'b' => bar(b, r - t, mid, r, top),
                    'c' => bar(b, r - t, bot, r, mid),
                    'e' => bar(b, l, bot, l + t, mid),
                    _ => bar(b, l, mid, l + t, top),
                }
            }
        }
    }
}

/// Holding positions (`holdBars`): where the taxiway stretch p -> q comes up to the runway, two yellow bars across it.
fn hold_bars(b: &mut B, f: &Frame, p: P, q: P, width: f64) {
    let hold = if f.width >= 45.0 { 90.0 } else if f.width >= 30.0 { 60.0 } else { 40.0 };
    let (c, d) = (f.of(p), f.of(q));
    for s in [-1.0, 1.0] {
        if (c.1 - s * hold) * (d.1 - s * hold) >= 0.0 {
            continue;
        }
        let t = (s * hold - c.1) / (d.1 - c.1);
        let along = c.0 + t * (d.0 - c.0);
        if along < -30.0 || along > f.len + 30.0 {
            continue;
        }
        let m = (p.0 + t * (q.0 - p.0), p.1 + t * (q.1 - p.1));
        let away = if c.1 * s > d.1 * s { p } else { q };
        let dist = (away.0 - m.0).hypot(away.1 - m.1).max(1e-6);
        let step = |k: f64| (m.0 + (away.0 - m.0) * k / dist, m.1 + (away.1 - m.1) * k / dist);
        b.strip(step(0.0), step(0.9), width, 0.0, Z_HOLD, hex(0xf2c40f));
        b.strip(step(2.2), step(3.1), width, 0.0, Z_HOLD, hex(0xf2c40f));
    }
}

fn in_ring(p: P, r: &[P]) -> bool {
    let mut inside = false;
    let n = r.len();
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        let (a, c) = (r[i], r[j]);
        if (a.1 > p.1) != (c.1 > p.1) && p.0 < (c.0 - a.0) * (p.1 - a.1) / (c.1 - a.1) + a.0 {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// The ground of airport `code`; `rows`: rows of eight stands on the made-up apron of an airport without a layout.
pub fn airfield_mesh(code: &str, rows: usize) -> Option<Flat> {
    let a = data().try_airport(code)?;
    let (lat0, lon0) = (a.lat, a.lon);
    let kx = 111_320.0 * lat0.to_radians().cos();
    let m = |p: (f64, f64)| ((p.1 - lon0) * kx, (p.0 - lat0) * 111_320.0);
    let mut b = B { f: Flat { pos: Vec::new(), color: Vec::new(), indices: Vec::new() } };
    let rws = airport_runways(code);
    let frames: Vec<(Frame, bool)> = rws
        .iter()
        .map(|r| {
            let (p, q) = (m((r[0], r[1])), m((r[2], r[3])));
            let len = (q.0 - p.0).hypot(q.1 - p.1).max(1e-3);
            let u = ((q.0 - p.0) / len, (q.1 - p.1) / len);
            (Frame { a: p, u, len, width: r[4].max(18.0), hdg: u.0.atan2(u.1).to_degrees().rem_euclid(360.0) }, r[5] > 0.0)
        })
        .collect();
    // runways (grass under paved), their paint and numbers
    for (i, (f, paved)) in frames.iter().enumerate() {
        b.quad(f.corners(0.0), if *paved { Z_RUNWAY } else { Z_GRASS }, if *paved { hex(0x2b2f36) } else { hex(0x6f9a55) });
        if *paved {
            let others: Vec<Frame> = frames.iter().enumerate().filter(|(j, _)| *j != i).map(|(_, o)| o.0).collect();
            runway_paint(&mut b, f, &others);
        }
    }
    let big = airport_size(code) >= 3;
    let tw_w = if big { 23.0 } else { 15.0 };
    let shoulder = tw_w + if big { 14.0 } else { 7.0 };
    let paved: Vec<Frame> = frames.iter().filter(|(_, p)| *p).map(|(f, _)| *f).collect();
    let yellow = hex(0xfacc15);
    let taxi = |b: &mut B, line: &[P]| {
        b.path(line, shoulder, Z_SHOULDER, hex(0x5f6670));
        b.path(line, tw_w, Z_TAXIWAY, hex(0x4a515c));
        b.path(line, 0.5, Z_TWLINE, hex(0xe3b70f));
        for f in &paved {
            for s in line.windows(2) {
                hold_bars(b, f, s[0], s[1], tw_w * 0.85);
            }
        }
    };
    let stand_marks = |b: &mut B, at: P, hdg: f64, push: f64| {
        let (ux, uy) = (hdg.to_radians().sin(), hdg.to_radians().cos());
        let ahead = |d: f64, side: f64| (at.0 + ux * d + uy * side, at.1 + uy * d - ux * side);
        b.strip(ahead(-push, 0.0), ahead(14.0, 0.0), 0.35, 0.0, Z_STAND, yellow);
        b.strip(ahead(14.0, -4.0), ahead(14.0, 4.0), 1.0, 0.0, Z_STAND, yellow);
    };
    if let Some(l) = flightgame::layouts::layout(code) {
        let ring = |r: &Vec<(f64, f64)>| r.iter().map(|&p| m(p)).collect::<Vec<P>>();
        let concrete: Vec<Vec<P>> = l.aprons.iter().chain(&l.pads).map(ring).filter(|r| r.len() > 2).collect();
        for (k, r) in concrete.iter().enumerate() {
            if k < l.aprons.len() {
                b.poly(r, Z_APRON, hex(0x3a4049));
            } else {
                b.poly(r, Z_PAD, hex(0x6b7280));
            }
        }
        // taxiways, cut where they reach an apron (planes cross the open slab), looked at every 4 m
        let on_concrete = |p: P| concrete.iter().any(|r| in_ring(p, r));
        for line in l.taxiways.iter().map(ring) {
            let mut cur: Vec<P> = Vec::new();
            for (i, &p) in line.iter().enumerate() {
                if i == 0 {
                    if !on_concrete(p) {
                        cur.push(p);
                    }
                    continue;
                }
                let q = line[i - 1];
                let n = ((p.0 - q.0).hypot(p.1 - q.1) / 4.0).ceil().max(1.0) as usize;
                let mut was = !cur.is_empty();
                for k in 1..=n {
                    let t = k as f64 / n as f64;
                    let s = (q.0 + (p.0 - q.0) * t, q.1 + (p.1 - q.1) * t);
                    let off = !on_concrete(s);
                    if off && !was {
                        cur.push(s);
                    } else if !off && was {
                        cur.push(s);
                        if cur.len() > 1 {
                            taxi(&mut b, &cur);
                        }
                        cur.clear();
                    } else if off && k == n {
                        cur.push(p);
                    }
                    was = off;
                }
            }
            if cur.len() > 1 {
                taxi(&mut b, &cur);
            }
        }
        for (lat, lon, hdg, _) in &l.stands {
            stand_marks(&mut b, m((*lat, *lon)), *hdg, 70.0);
        }
    } else if let Some((r, _)) = rws.iter().zip(&frames).filter(|(_, (_, p))| *p).map(|(r, f)| (r, f.0)).max_by(|x, y| runway_length(x.0).total_cmp(&runway_length(y.0))) {
        // the made-up apron (track.rs `stand_of`): rows of eight stands beside the middle of the longest runway, on
        // the side of the airport's point, noses away from it; a parallel taxiway between (`runway_way`)
        let f = frames.iter().map(|(f, _)| *f).find(|f| (f.a.0 - m((r[0], r[1])).0).abs() < 0.01 && (f.a.1 - m((r[0], r[1])).1).abs() < 0.01).unwrap_or(frames[0].0);
        let side = if f.of((0.0, 0.0)).1 < 0.0 { -1.0 } else { 1.0 };
        let rows = rows.max(1) as f64;
        let (x0, x1) = (f.len / 2.0 - 4.0 * 65.0 - 25.0, f.len / 2.0 + 4.0 * 65.0 + 25.0);
        let (c0, c1) = (side * (280.0 - 75.0), side * (280.0 + (rows - 1.0) * 110.0 + 45.0));
        b.quad([f.at(x0, c0), f.at(x1, c0), f.at(x1, c1), f.at(x0, c1)], Z_APRON, hex(0x3a4049));
        let off = side * 168.0;
        taxi(&mut b, &[f.at(0.0, 0.0), f.at(0.0, off), f.at(f.len, off), f.at(f.len, 0.0)]);
        if f.len >= 1800.0 {
            // the fast exits, from both ends
            let run = 168.0 / 30f64.to_radians().tan();
            for x in [f.len / 2.0 - 200.0 - run, f.len / 2.0 + 200.0 + run] {
                let dir = if x < f.len / 2.0 { 1.0 } else { -1.0 };
                taxi(&mut b, &[f.at(x, 0.0), f.at(x + dir * run, off)]);
            }
        }
        taxi(&mut b, &[f.at(f.len / 2.0, off), f.at(f.len / 2.0, c0)]);
        let hdg = (f.hdg + 90.0 * side).rem_euclid(360.0);
        for row in 0..rows as usize {
            for k in 0..8 {
                let p = f.at(f.len / 2.0 + (k as f64 - 3.5) * 65.0, side * (280.0 + row as f64 * 110.0));
                stand_marks(&mut b, p, hdg, 70.0);
            }
        }
    }
    if b.f.indices.is_empty() { None } else { Some(b.f) }
}

#[cfg(test)]
pub(crate) fn tests_apron_colour() -> [f32; 4] {
    hex(0x3a4049)
}
