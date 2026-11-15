//! Airport fixes, as the browser game's js/fixes.js: operations on an airport's layout and runways
//! (`{"op": "add" | "del" | "set", "kind": "stand" | "apron" | "terminal" | "hangar" | "building" | "pad" |
//! "taxiway" | "runway", "geom": …, "from": …}`). Three sets: the repo's (js/data/fixes.js, drawn with the airport
//! editor), your own edits from the airport editor (F3; they replace the repo's for that airport, as the browser
//! game's local fixes do) and what the player built in build mode (kept in the save game, `State::airport_ops`).
//! Layouts and runways are read through here, so all of them show everywhere.

use crate::layouts::{Layout, Ring};
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;
use std::sync::OnceLock;

const FIXES_JS: &str = include_str!("../../js/data/fixes.js");

/// How far (m) an element may lie from the shape a fix remembers.
const TOL: f64 = 6.0;
const M: f64 = 111_320.0;

pub type Ops = BTreeMap<String, Vec<Value>>;

fn repo() -> &'static Ops {
    static R: OnceLock<Ops> = OnceLock::new();
    R.get_or_init(|| match crate::jsdata::assigned(FIXES_JS, "fixes") {
        Ok(Value::Object(m)) => m.into_iter().filter_map(|(k, v)| Some((k, v.as_array()?.clone()))).collect(),
        _ => Ops::new(),
    })
}

thread_local! {
    static LOCAL: RefCell<Ops> = RefCell::new(Ops::new());
    static PLAYER: RefCell<Ops> = RefCell::new(Ops::new());
    static REV: Cell<u64> = const { Cell::new(1) };
    static LAYOUTS: RefCell<HashMap<String, (u64, Option<Rc<Layout>>)>> = RefCell::new(HashMap::new());
    static RUNWAYS: RefCell<HashMap<String, (u64, Vec<[f64; 6]>)>> = RefCell::new(HashMap::new());
}

fn bump() {
    REV.with(|r| r.set(r.get() + 1));
}

/// Your airport editor's fixes (from the app's fixes.json), replacing the repo's for each airport they name.
pub fn set_local(ops: Ops) {
    LOCAL.with(|l| *l.borrow_mut() = ops);
    bump();
}

pub fn local() -> Ops {
    LOCAL.with(|l| l.borrow().clone())
}

/// What the player built (the save game's), on top of the developer fixes.
pub fn set_player(ops: &Ops) {
    PLAYER.with(|p| *p.borrow_mut() = ops.clone());
    bump();
}

/// The developer fixes of an airport: yours where you edited it, else the repo's.
pub fn ops(code: &str) -> Vec<Value> {
    LOCAL.with(|l| l.borrow().get(code).cloned()).or_else(|| repo().get(code).cloned()).unwrap_or_default()
}

pub fn player_ops(code: &str) -> Vec<Value> {
    PLAYER.with(|p| p.borrow().get(code).cloned()).unwrap_or_default()
}

/// The developer fixes and the player's, as the layouts get them.
pub fn all(code: &str) -> Vec<Value> {
    let mut v = ops(code);
    v.extend(player_ops(code));
    v
}

/// Sets your editor's fixes of one airport (an empty list goes back to the repo's).
pub fn set_ops(code: &str, list: Vec<Value>) {
    LOCAL.with(|l| {
        let mut l = l.borrow_mut();
        if list.is_empty() && !repo().contains_key(code) {
            l.remove(code);
        } else {
            l.insert(code.to_string(), list);
        }
    });
    bump();
}

/// js/data/fixes.js with the repo's fixes and yours over them, in the browser game's format.
pub fn file_text() -> String {
    let mut all = repo().clone();
    for (k, v) in local() {
        if v.is_empty() {
            all.remove(&k);
        } else {
            all.insert(k, v);
        }
    }
    let mut out = String::from(
        "// Airport fixes drawn with the airport editor (developer tools, F3), see js/fixes.js.\n\
         // Written by tools/serve.py when the game runs from ./play.sh: commit this file to give everyone the fixes.\n\
         FG.data.fixes = {\n",
    );
    let n = all.len();
    for (i, (code, list)) in all.iter().enumerate() {
        out.push_str(&format!("{}: [\n", serde_json::to_string(code).unwrap()));
        for (j, op) in list.iter().enumerate() {
            out.push_str("  ");
            out.push_str(&serde_json::to_string(op).unwrap_or_default());
            out.push_str(if j + 1 < list.len() { ",\n" } else { "\n" });
        }
        out.push_str(if i + 1 < n { "],\n" } else { "]\n" });
    }
    out.push_str("};\n");
    out
}

// ---------- shapes ----------

fn pts(v: &Value) -> Vec<(f64, f64)> {
    v.as_array()
        .map(|l| l.iter().filter_map(|p| Some((p.get(0)?.as_f64()?, p.get(1)?.as_f64()?))).collect())
        .unwrap_or_default()
}

/// The points of an element of a kind, as js/fixes.js `shape`.
fn shape(kind: &str, g: &Value) -> Vec<(f64, f64)> {
    let n = |i: usize| g.get(i).and_then(|x| x.as_f64()).unwrap_or(0.0);
    match kind {
        "runway" => vec![(n(0), n(1)), (n(2), n(3))],
        "stand" | "tower" => vec![(n(0), n(1))],
        _ => pts(g),
    }
}

fn pt_m(p: (f64, f64), q: (f64, f64)) -> f64 {
    ((q.1 - p.1) * M * p.0.to_radians().cos()).hypot((q.0 - p.0) * M)
}

fn seg_m(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let kx = M * p.0.to_radians().cos();
    let (ax, ay) = ((a.1 - p.1) * kx, (a.0 - p.0) * M);
    let (bx, by) = ((b.1 - p.1) * kx, (b.0 - p.0) * M);
    let (dx, dy) = (bx - ax, by - ay);
    let l = dx * dx + dy * dy;
    let t = if l > 0.0 { (-(ax * dx + ay * dy) / l).clamp(0.0, 1.0) } else { 0.0 };
    (ax + t * dx).hypot(ay + t * dy)
}

/// Farthest any point of `p` lies from the line or ring `to`.
fn reach(p: &[(f64, f64)], to: &[(f64, f64)], closed: bool) -> f64 {
    let mut worst: f64 = 0.0;
    for &q in p {
        let mut d = if to.len() == 1 { pt_m(q, to[0]) } else { f64::INFINITY };
        let n = if closed { to.len() } else { to.len().saturating_sub(1) };
        for i in 0..n {
            d = d.min(seg_m(q, to[i], to[(i + 1) % to.len()]));
        }
        worst = worst.max(d);
    }
    worst
}

fn is_ring(kind: &str) -> bool {
    matches!(kind, "apron" | "pad" | "terminal" | "hangar" | "building")
}

/// How far apart two shapes of one kind are (m): 0 = the same.
fn gap(kind: &str, p: &[(f64, f64)], q: &[(f64, f64)]) -> f64 {
    if p.is_empty() || q.is_empty() {
        return f64::INFINITY;
    }
    if kind == "runway" && p.len() == 2 && q.len() == 2 {
        return pt_m(p[0], q[0]).max(pt_m(p[1], q[1])).min(pt_m(p[0], q[1]).max(pt_m(p[1], q[0])));
    }
    if p.len() == 1 || q.len() == 1 {
        return pt_m(p[0], q[0]);
    }
    let ring = is_ring(kind);
    reach(p, q, ring).max(reach(q, p, ring))
}

fn bbox(p: &[(f64, f64)]) -> [f64; 4] {
    p.iter().fold([f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY], |b, q| {
        [b[0].min(q.0), b[1].min(q.1), b[2].max(q.0), b[3].max(q.1)]
    })
}

/// The element of `list` with this shape, or None.
fn find(list: &[Vec<(f64, f64)>], kind: &str, g: &[(f64, f64)]) -> Option<usize> {
    let bg = bbox(g);
    let t_lat = TOL * 1.1 / M;
    let t_lon = TOL * 1.1 / (M * bg[0].to_radians().cos().max(0.01));
    let mut best = None;
    let mut best_gap = TOL;
    for (i, e) in list.iter().enumerate() {
        let be = bbox(e);
        if (be[0] - bg[0]).abs() > t_lat || (be[2] - bg[2]).abs() > t_lat || (be[1] - bg[1]).abs() > t_lon || (be[3] - bg[3]).abs() > t_lon {
            continue;
        }
        let d = gap(kind, e, g);
        if d < best_gap {
            best_gap = d;
            best = Some(i);
        }
    }
    best
}

/// One element of a layout: its shape, and the rest of a stand (heading, name).
#[derive(Clone)]
struct El {
    shape: Vec<(f64, f64)>,
    hdg: f64,
    name: String,
}

fn el(kind: &str, g: &Value) -> El {
    El {
        shape: shape(kind, g),
        hdg: if kind == "stand" { g.get(2).and_then(|x| x.as_f64()).unwrap_or(0.0) } else { 0.0 },
        name: if kind == "stand" { g.get(3).and_then(|x| x.as_str()).unwrap_or("").to_string() } else { String::new() },
    }
}

/// Applies one op to a list. False when it found nothing to change.
fn apply(list: &mut Vec<El>, kind: &str, op: &Value) -> bool {
    let what = op["op"].as_str().unwrap_or("");
    let geom = &op["geom"];
    if what == "add" {
        list.push(el(kind, geom));
        return true;
    }
    let key = if what == "set" { &op["from"] } else { geom };
    let shapes: Vec<Vec<(f64, f64)>> = list.iter().map(|e| e.shape.clone()).collect();
    let i = find(&shapes, kind, &shape(kind, key));
    match (what, i) {
        ("del", Some(i)) => {
            list.remove(i);
            true
        }
        ("del", None) => false,
        (_, Some(i)) => {
            list[i] = el(kind, geom);
            true
        }
        (_, None) => {
            list.push(el(kind, geom));
            false
        }
    }
}

fn to_els(rings: &[Ring]) -> Vec<El> {
    rings.iter().map(|r| El { shape: r.clone(), hdg: 0.0, name: String::new() }).collect()
}

fn to_rings(els: Vec<El>) -> Vec<Ring> {
    els.into_iter().map(|e| e.shape).filter(|r| r.len() >= 2).collect()
}

/// A layout with fixes applied.
pub fn fixed(base: Option<&Layout>, list: &[Value]) -> Layout {
    let empty = Layout::default();
    let b = base.unwrap_or(&empty);
    let mut kinds: BTreeMap<&str, Vec<El>> = BTreeMap::new();
    kinds.insert("apron", to_els(&b.aprons));
    kinds.insert("pad", to_els(&b.pads));
    kinds.insert("terminal", to_els(&b.terminals));
    kinds.insert("hangar", to_els(&b.hangars));
    kinds.insert("building", to_els(&b.others));
    kinds.insert("taxiway", to_els(&b.taxiways));
    kinds.insert(
        "stand",
        b.stands.iter().map(|s| El { shape: vec![(s.0, s.1)], hdg: s.2, name: s.3.clone() }).collect(),
    );
    for op in list {
        let kind = op["kind"].as_str().unwrap_or("");
        if let Some(l) = kinds.get_mut(kind) {
            apply(l, kind, op);
        }
    }
    let mut take = |k: &str| kinds.remove(k).unwrap_or_default();
    let stands = take("stand").into_iter().filter_map(|e| Some((e.shape.first()?.0, e.shape.first()?.1, e.hdg, e.name))).collect();
    Layout {
        aprons: to_rings(take("apron")),
        pads: to_rings(take("pad")),
        terminals: to_rings(take("terminal")),
        hangars: to_rings(take("hangar")),
        others: to_rings(take("building")),
        taxiways: to_rings(take("taxiway")),
        stands,
    }
}

/// The layout of an airport with every fix (cached until the fixes change). None where there is nothing.
pub fn layout(code: &str) -> Option<Rc<Layout>> {
    let rev = REV.with(|r| r.get());
    if let Some(hit) = LAYOUTS.with(|c| c.borrow().get(code).filter(|e| e.0 == rev).map(|e| e.1.clone())) {
        return hit;
    }
    let list = all(code);
    let base = crate::layouts::raw(code);
    let out = if base.is_none() && list.is_empty() { None } else { Some(Rc::new(fixed(base, &list))) };
    LAYOUTS.with(|c| c.borrow_mut().insert(code.to_string(), (rev, out.clone())));
    out
}

/// An airport's runways with the fixes: from the data's.
pub fn runways(code: &str, base: &[[f64; 6]]) -> Vec<[f64; 6]> {
    let rev = REV.with(|r| r.get());
    if let Some(hit) = RUNWAYS.with(|c| c.borrow().get(code).filter(|e| e.0 == rev).map(|e| e.1.clone())) {
        return hit;
    }
    let list: Vec<Value> = all(code).into_iter().filter(|o| o["kind"] == "runway").collect();
    let out = if list.is_empty() {
        base.to_vec()
    } else {
        let mut els: Vec<El> = base.iter().map(|r| El { shape: vec![(r[0], r[1]), (r[2], r[3])], hdg: r[4], name: if r[5] > 0.0 { "1".into() } else { "0".into() } }).collect();
        for op in &list {
            // (a runway's width and surface ride along in hdg / name)
            let what = op["op"].as_str().unwrap_or("");
            let g = &op["geom"];
            let n = |i: usize| g.get(i).and_then(|x| x.as_f64()).unwrap_or(0.0);
            let new = El { shape: vec![(n(0), n(1)), (n(2), n(3))], hdg: g.get(4).and_then(|x| x.as_f64()).unwrap_or(45.0), name: if n(5) > 0.0 || g.get(5).and_then(|x| x.as_bool()) == Some(true) { "1".into() } else { "0".into() } };
            if what == "add" {
                els.push(new);
                continue;
            }
            let key = if what == "set" { &op["from"] } else { g };
            let shapes: Vec<Vec<(f64, f64)>> = els.iter().map(|e| e.shape.clone()).collect();
            match (what, find(&shapes, "runway", &shape("runway", key))) {
                ("del", Some(i)) => {
                    els.remove(i);
                }
                ("del", None) => {}
                (_, Some(i)) => els[i] = new,
                (_, None) => els.push(new),
            }
        }
        els.into_iter().map(|e| [e.shape[0].0, e.shape[0].1, e.shape[1].0, e.shape[1].1, e.hdg, if e.name == "1" { 1.0 } else { 0.0 }]).collect()
    };
    RUNWAYS.with(|c| c.borrow_mut().insert(code.to_string(), (rev, out.clone())));
    out
}

/// An element's geometry as a fix op writes it: a stand [lat, lon, heading, name, 1], a runway [6 numbers], a
/// ring or line [[lat, lon], …] (5 decimals, as the browser game's editor).
pub fn geom_of(kind: &str, pts: &[(f64, f64)], hdg: f64, name: &str) -> Value {
    let r = |x: f64| (x * 1e5).round() / 1e5;
    match kind {
        "stand" | "tower" => serde_json::json!([r(pts[0].0), r(pts[0].1), hdg.round(), name, 1]),
        _ => Value::Array(pts.iter().map(|p| serde_json::json!([r(p.0), r(p.1)])).collect()),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn fixes_apply() {
        assert!(super::repo().len() > 50, "{} airports with fixes", super::repo().len());
        // a stand added and one taken away
        let base = crate::layouts::raw("ZRH").expect("ZRH");
        let s = base.stands[0].clone();
        let ops = vec![
            json!({"op": "add", "kind": "stand", "geom": [47.46, 8.55, 90, "X1", 1]}),
            json!({"op": "del", "kind": "stand", "geom": [s.0 + 0.00001, s.1, s.2, s.3, 1]}),
            json!({"op": "add", "kind": "apron", "geom": [[47.46, 8.55], [47.461, 8.55], [47.461, 8.551]]}),
        ];
        let l = super::fixed(Some(base), &ops);
        assert_eq!(l.stands.len(), base.stands.len());
        assert!(l.stands.iter().any(|x| x.3 == "X1"));
        assert!(!l.stands.iter().any(|x| x.0 == s.0 && x.1 == s.1 && x.3 == s.3));
        assert_eq!(l.aprons.len(), base.aprons.len() + 1);
        // the repo's runway fix at ABQ moves its runway
        let a = crate::data::data().airport("ABQ");
        let rws = super::runways("ABQ", &a.runways);
        assert_eq!(rws.len(), a.runways.len());
        // the file round-trips
        let text = super::file_text();
        assert!(text.starts_with("// Airport fixes"));
        let back = crate::jsdata::assigned(&text, "fixes").unwrap();
        assert_eq!(back.as_object().unwrap().len(), super::repo().len());
    }

    #[test]
    fn build_mode() {
        let pr = crate::data::data().presets.iter().find(|p| p.id == "europe").cloned().unwrap();
        let (mut g, _) = crate::game::Game::from_preset(&pr);
        g.state.money = 1e10;
        let code = "BRN";
        assert!(g.build_denied(code).is_some());
        g.buy_shares(code, 30).unwrap();
        assert!(g.build_denied(code).is_none());
        // a stand of class C, paid at once: one more slot there
        let before = crate::game::stands_of(code)[2];
        g.pay_for_building(code, crate::config::BUILD_STAND, "stand").unwrap();
        g.add_airport_ops(code, vec![json!({"op": "add", "kind": "stand", "geom": [46.913, 7.499, 90, "N1", 1], "cls": 2})]);
        assert_eq!(crate::game::stands_of(code)[2], before + 1);
        assert!(super::layout(code).unwrap().stands.iter().any(|s| s.3 == "N1"));
        // a runway placed by hand, built over weeks
        let a = crate::data::data().airport(code);
        let n = crate::game::airport_runways(code).len();
        let r = [a.lat + 0.01, a.lon - 0.01, a.lat + 0.01, a.lon + 0.01, 30.0, 1.0];
        let o = g.runway_project(code, &r);
        assert!(o.err.is_none() && o.len > 1400.0 && o.cost > 0.0, "{:?}", o.err);
        g.order_runway(code, r).unwrap();
        g.dev_finish_projects();
        assert_eq!(crate::game::airport_runways(code).len(), n + 1);
        // pulled down again
        g.remove_airport_op(code, 0);
        assert_eq!(crate::game::stands_of(code)[2], before);
    }
}
