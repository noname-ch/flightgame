//! The airport editor (F3, developer tools) and build mode (the player's building), after the browser game's
//! js/airportedit.js: the same tools on the map in both. The editor writes fix ops for the airport (your fixes,
//! kept in fixes.json beside the save and written into js/data/fixes.js on request: the browser game reads the
//! same ones); build mode charges for what you build (your share) and keeps it in the save game. Runways and
//! terminals are construction there: they are ready after some weeks.

#![allow(deprecated)]
use eframe::egui::{self, Align2, Color32, FontId, Pos2, Stroke, Vec2};
use flightgame::config::*;
use flightgame::data::{data, distance_km};
use flightgame::fixes;
use flightgame::game::{fmt_money, Game, CLASSES};
use serde_json::{json, Value};
use walkers::{lat_lon, Projector};

pub const TOOLS: [(&str, &str, &str); 8] = [
    ("select", "👆 Select", "Click something to see it or pull it down"),
    ("stand", "🅿 Stand", "Click on an apron: a stand there, its nose to the heading below"),
    ("apron", "⬛ Apron", "Click the corners, then Finish (or double-click)"),
    ("terminal", "🏢 Terminal", "Click the corners, then Finish"),
    ("hangar", "🏚 Hangar", "Click the corners, then Finish"),
    ("building", "🏠 Building", "Click the corners, then Finish"),
    ("taxiway", "〰 Taxiway", "Click along its line, then Finish"),
    ("runway", "🛬 Runway", "Click one end, then the other"),
];

/// Something of the airport picked with the Select tool.
#[derive(Clone, Debug)]
pub struct Picked {
    pub kind: &'static str,
    pub shape: Vec<(f64, f64)>,
    pub hdg: f64,
    pub name: String,
    /// a runway's width and surface
    pub rw: Option<[f64; 6]>,
}

pub struct Editor {
    pub code: String,
    /// build mode (the player's, paid) rather than the developer's editor
    pub player: bool,
    pub tool: &'static str,
    pub pts: Vec<(f64, f64)>,
    pub hdg: f64,
    pub cls: usize,
    pub rw_width: f64,
    pub paved: bool,
    pub name: String,
    pub picked: Option<Picked>,
    pub hover: Option<(f64, f64)>,
    /// the editor's earlier op lists of this airport (Undo)
    pub undo: Vec<Vec<Value>>,
    pub msg: Option<(bool, String)>,
}

impl Editor {
    pub fn new(code: &str, player: bool) -> Editor {
        Editor {
            code: code.to_string(),
            player,
            tool: "select",
            pts: Vec::new(),
            hdg: 0.0,
            cls: 2,
            rw_width: 45.0,
            paved: true,
            name: String::new(),
            picked: None,
            hover: None,
            undo: Vec::new(),
            msg: None,
        }
    }
}

/// Metres east and north of p0.
fn xy(p0: (f64, f64), p: (f64, f64)) -> (f64, f64) {
    ((p.1 - p0.1) * 111_320.0 * p0.0.to_radians().cos(), (p.0 - p0.0) * 111_320.0)
}

/// A ring's area in m².
pub fn area_m2(r: &[(f64, f64)]) -> f64 {
    if r.len() < 3 {
        return 0.0;
    }
    let q: Vec<(f64, f64)> = r.iter().map(|p| xy(r[0], *p)).collect();
    (0..q.len()).map(|i| q[i].0 * q[(i + 1) % q.len()].1 - q[(i + 1) % q.len()].0 * q[i].1).sum::<f64>().abs() / 2.0
}

pub fn line_m(r: &[(f64, f64)]) -> f64 {
    r.windows(2).map(|w| distance_km(w[0].0, w[0].1, w[1].0, w[1].1) * 1000.0).sum()
}

fn in_ring(p: (f64, f64), r: &[(f64, f64)]) -> bool {
    let mut inside = false;
    let mut j = r.len().wrapping_sub(1);
    for i in 0..r.len() {
        let (a, b) = (r[i], r[j]);
        if (a.1 > p.1) != (b.1 > p.1) && p.0 < (b.0 - a.0) * (p.1 - a.1) / (b.1 - a.1) + a.0 {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn seg_px(p: Pos2, a: Pos2, b: Pos2) -> f32 {
    let ab = b - a;
    let t = ((p - a).dot(ab) / ab.length_sq().max(1e-6)).clamp(0.0, 1.0);
    p.distance(a + ab * t)
}

/// What a piece costs to build (the whole cost; you pay your share): (CHF, what it is).
pub fn price(kind: &str, pts: &[(f64, f64)], rw: Option<&[f64; 6]>) -> (f64, String) {
    match kind {
        "stand" => (BUILD_STAND, "a stand".into()),
        "taxiway" => {
            let m = line_m(pts);
            (m * 23.0 * BUILD_TAXIWAY, format!("a taxiway of {m:.0} m"))
        }
        "runway" => {
            let r = rw.copied().unwrap_or([0.0; 6]);
            (flightgame::config::RUNWAY_COST_BASE + flightgame::config::RUNWAY_COST_PER_M * flightgame::game::runway_length(&r), "a runway".into())
        }
        _ => {
            let a = area_m2(pts);
            let per = match kind {
                "terminal" => BUILD_TERMINAL,
                "hangar" => BUILD_HANGAR,
                "building" => BUILD_BUILDING,
                _ => BUILD_APRON,
            };
            (a * per, format!("{} of {:.0} m²", if kind == "apron" { "an apron".to_string() } else { format!("a {kind}") }, a))
        }
    }
}

impl Editor {
    fn say(&mut self, ok: bool, m: impl Into<String>) {
        self.msg = Some((ok, m.into()));
    }

    /// The airport's elements near a screen point, as the Select tool picks them.
    fn pick_at(&self, projector: &Projector, at: Pos2) -> Option<Picked> {
        let pos = |p: (f64, f64)| projector.project(lat_lon(p.0, p.1)).to_pos2();
        let ll = projector.unproject(at.to_vec2());
        let p = (ll.y(), ll.x());
        let mut best: Option<(f32, Picked)> = None;
        let mut offer = |d: f32, pk: Picked| {
            if d < best.as_ref().map(|b| b.0).unwrap_or(f32::MAX) {
                best = Some((d, pk));
            }
        };
        if let Some(l) = flightgame::layouts::layout(&self.code) {
            for s in &l.stands {
                let d = pos((s.0, s.1)).distance(at);
                if d < 12.0 {
                    offer(d, Picked { kind: "stand", shape: vec![(s.0, s.1)], hdg: s.2, name: s.3.clone(), rw: None });
                }
            }
            for r in &l.taxiways {
                let d = r.windows(2).map(|w| seg_px(at, pos(w[0]), pos(w[1]))).fold(f32::MAX, f32::min);
                if d < 8.0 {
                    offer(d + 2.0, Picked { kind: "taxiway", shape: r.clone(), hdg: 0.0, name: String::new(), rw: None });
                }
            }
            // buildings over aprons: the smaller first
            for (kind, list, extra) in [("terminal", &l.terminals, 4.0), ("hangar", &l.hangars, 4.0), ("building", &l.others, 4.0), ("apron", &l.aprons, 9.0), ("pad", &l.pads, 9.0)] {
                for r in list {
                    if r.len() > 2 && in_ring(p, r) {
                        offer(extra, Picked { kind, shape: r.clone(), hdg: 0.0, name: String::new(), rw: None });
                    }
                }
            }
        }
        for r in flightgame::game::airport_runways(&self.code) {
            let d = seg_px(at, pos((r[0], r[1])), pos((r[2], r[3])));
            if d < 10.0 {
                offer(d + 6.0, Picked { kind: "runway", shape: vec![(r[0], r[1]), (r[2], r[3])], hdg: 0.0, name: String::new(), rw: Some(r) });
            }
        }
        best.map(|b| b.1)
    }

    /// The map part: clicks place points or pick things; what is being drawn is drawn. Call inside the map's
    /// show closure. Returns (it took the click: the map should not select anything, finish what is drawn now).
    pub fn map(&mut self, ui: &egui::Ui, response: &egui::Response, projector: &Projector) -> (bool, bool) {
        let pos = |p: (f64, f64)| projector.project(lat_lon(p.0, p.1)).to_pos2();
        let to_ll = |at: Pos2| {
            let ll = projector.unproject(at.to_vec2());
            (ll.y(), ll.x())
        };
        self.hover = response.hover_pos().map(to_ll);
        let painter = ui.painter_at(response.rect);
        let gold = Color32::from_rgb(255, 196, 0);
        // the airport's area (runways within 8 km)
        let a = data().airport(&self.code);
        let c = pos((a.lat, a.lon));
        let ppm = projector.scale_pixel_per_meter(lat_lon(a.lat, a.lon));
        painter.circle_stroke(c, 8000.0 * ppm, Stroke::new(1.0, Color32::from_rgba_unmultiplied(255, 196, 0, 90)));
        // the picked one
        if let Some(pk) = &self.picked {
            let pts: Vec<Pos2> = pk.shape.iter().map(|p| pos(*p)).collect();
            if pts.len() == 1 {
                painter.circle_stroke(pts[0], 9.0, Stroke::new(2.5, Color32::from_rgb(0, 200, 255)));
            } else {
                let mut closed = pts.clone();
                if crate::editor::ring_kind(pk.kind) {
                    closed.push(pts[0]);
                }
                painter.add(egui::Shape::line(closed, Stroke::new(3.0, Color32::from_rgb(0, 200, 255))));
            }
        }
        // what is being drawn, up to the pointer
        let mut pts: Vec<Pos2> = self.pts.iter().map(|p| pos(*p)).collect();
        if !self.pts.is_empty() {
            if let Some(h) = self.hover {
                pts.push(pos(h));
            }
            if ring_kind(self.tool) && pts.len() > 2 {
                let mut closed = pts.clone();
                closed.push(pts[0]);
                painter.add(egui::Shape::line(closed, Stroke::new(2.0, gold)));
            } else if self.tool == "runway" {
                let w = (self.rw_width as f32 * ppm).max(3.0);
                painter.add(egui::Shape::line(pts.clone(), Stroke::new(w, Color32::from_rgba_unmultiplied(80, 80, 90, 200))));
                painter.add(egui::Shape::line(pts.clone(), Stroke::new(1.5, gold)));
            } else {
                painter.add(egui::Shape::line(pts.clone(), Stroke::new(if self.tool == "taxiway" { (23.0 * ppm).max(2.0) } else { 2.0 }, gold)));
            }
            for p in &pts[..self.pts.len()] {
                painter.circle_filled(*p, 4.0, gold);
            }
            // length or area so far
            let mut shape = self.pts.clone();
            if let Some(h) = self.hover {
                shape.push(h);
            }
            let label = if ring_kind(self.tool) { format!("{:.0} m²", area_m2(&shape)) } else { format!("{:.0} m", line_m(&shape)) };
            if let Some(last) = pts.last() {
                painter.text(*last + Vec2::new(10.0, -10.0), Align2::LEFT_BOTTOM, label, FontId::proportional(13.0), Color32::WHITE);
            }
        }
        if self.tool == "stand" {
            if let Some(h) = self.hover {
                let p = pos(h);
                let r = self.hdg.to_radians() as f32;
                painter.circle_stroke(p, 6.0, Stroke::new(2.0, gold));
                painter.line_segment([p, p + Vec2::new(r.sin(), -r.cos()) * 16.0], Stroke::new(2.0, gold));
            }
        }
        // clicks
        let Some(at) = response.interact_pointer_pos() else { return (false, false) };
        if response.double_clicked() && self.pts.len() >= 2 && self.tool != "runway" {
            return (true, true);
        }
        if !response.clicked() {
            return (false, false);
        }
        let ll = to_ll(at);
        match self.tool {
            "select" => {
                self.picked = self.pick_at(projector, at);
            }
            "stand" => {
                self.pts = vec![ll];
                return (true, true);
            }
            "runway" => {
                self.pts.push(ll);
                if self.pts.len() > 2 {
                    self.pts = vec![ll];
                }
            }
            _ => self.pts.push(ll),
        }
        (true, false)
    }

    fn runway_of(&self) -> Option<[f64; 6]> {
        (self.pts.len() == 2).then(|| [self.pts[0].0, self.pts[0].1, self.pts[1].0, self.pts[1].1, self.rw_width, if self.paved { 1.0 } else { 0.0 }])
    }

    /// The op that adds what has been drawn.
    fn add_op(&self) -> Value {
        match self.tool {
            "runway" => json!({"op": "add", "kind": "runway", "geom": self.runway_of().map(|r| {
                let k = |x: f64| (x * 1e5).round() / 1e5;
                json!([k(r[0]), k(r[1]), k(r[2]), k(r[3]), r[4], r[5]])
            }).unwrap_or(Value::Null)}),
            "stand" => {
                let mut o = json!({"op": "add", "kind": "stand", "geom": fixes::geom_of("stand", &self.pts, self.hdg, &self.name)});
                if self.player {
                    o["cls"] = json!(self.cls);
                }
                o
            }
            kind => {
                let mut pts = self.pts.clone();
                if ring_kind(kind) && pts.first() != pts.last() {
                    pts.push(pts[0]);
                }
                let mut o = json!({"op": "add", "kind": kind, "geom": fixes::geom_of(kind, &pts, 0.0, "")});
                if kind == "taxiway" {
                    o["w"] = json!(23);
                }
                o
            }
        }
    }

    /// Builds (or, in the editor, adds) what has been drawn.
    pub fn finish(&mut self, g: &mut Game) {
        let need = match self.tool {
            "stand" => 1,
            "runway" | "taxiway" => 2,
            "select" => return,
            _ => 3,
        };
        if self.pts.len() < need {
            self.say(false, format!("Place {need} points at least."));
            return;
        }
        let a = data().airport(&self.code);
        if self.pts.iter().any(|p| distance_km(a.lat, a.lon, p.0, p.1) > 8.0) {
            self.say(false, format!("That is too far from {} (8 km at most).", a.name));
            self.pts.clear();
            return;
        }
        let op = self.add_op();
        let r = if self.player { self.build(g, op) } else { self.edit(vec![op], "Added") };
        match r {
            Ok(m) => self.say(true, m),
            Err(e) => self.say(false, e),
        }
        self.pts.clear();
    }

    /// The developer editor: the ops go into your fixes of the airport.
    fn edit(&mut self, new: Vec<Value>, what: &str) -> Result<String, String> {
        let old = fixes::ops(&self.code);
        self.undo.push(old.clone());
        let mut list = old;
        list.extend(new);
        fixes::set_ops(&self.code, list);
        save_local();
        Ok(format!("{what} – kept in your fixes ({} ops at {}).", fixes::ops(&self.code).len(), self.code))
    }

    /// Build mode: pay for it (or order the construction) and keep it in the save game.
    fn build(&mut self, g: &mut Game, op: Value) -> Result<String, String> {
        if let Some(e) = g.build_denied(&self.code) {
            return Err(e);
        }
        let kind = op["kind"].as_str().unwrap_or("").to_string();
        match kind.as_str() {
            "runway" => {
                let r = self.runway_of().ok_or("Click both ends of the runway.")?;
                g.order_runway(&self.code, r)?;
                Ok("Runway ordered: see Construction in the airport window.".into())
            }
            "terminal" => {
                let area = area_m2(&self.pts);
                let (full, what) = price("terminal", &self.pts, None);
                let weeks = ((4.0 + area / 2000.0).round() as i64).clamp(4, 30);
                g.order_build(&self.code, vec![op], &format!("New terminal ({:.0} m²)", area), full, weeks)?;
                Ok(format!("Ordered {what}: ready in {weeks} weeks."))
            }
            _ => {
                if kind == "stand" {
                    let on_apron = flightgame::layouts::layout(&self.code)
                        .is_some_and(|l| l.aprons.iter().chain(&l.pads).any(|r| r.len() > 2 && in_ring(self.pts[0], r)));
                    if !on_apron {
                        return Err("A stand goes on an apron: build one first.".into());
                    }
                }
                let (full, what) = price(&kind, &self.pts, None);
                g.pay_for_building(&self.code, full, &format!("built {what}"))?;
                g.add_airport_ops(&self.code, vec![op]);
                Ok(format!("Built {what}: your share {}.", fmt_money((full * g.stake(&self.code) as f64 / 100.0).round())))
            }
        }
    }

    /// Pulls down the picked element: in the editor a "del" op; in build mode only what you built (it costs a
    /// tenth of what it is worth).
    pub fn delete(&mut self, g: &mut Game) {
        let Some(pk) = self.picked.clone() else { return };
        let geom = match pk.kind {
            "runway" => {
                let r = pk.rw.unwrap_or([0.0; 6]);
                json!([r[0], r[1], r[2], r[3], r[4], r[5]])
            }
            "stand" => fixes::geom_of("stand", &pk.shape, pk.hdg, &pk.name),
            k => fixes::geom_of(k, &pk.shape, 0.0, ""),
        };
        if !self.player {
            if pk.kind == "stand" && flightgame::layouts::layout(&self.code).is_some_and(|l| l.stands.len() <= 1) {
                self.say(false, "An airport keeps its last stand (else the game makes one up again).");
                return;
            }
            let r = self.edit(vec![json!({"op": "del", "kind": pk.kind, "geom": geom})], "Pulled down");
            if let Ok(m) = r {
                self.say(true, m);
            }
            self.picked = None;
            return;
        }
        // build mode: find it among the player's own ops
        let mine = fixes::player_ops(&self.code);
        let same = |op: &Value| {
            op["op"] == "add" && op["kind"] == pk.kind && {
                let s = shape_of(pk.kind, &op["geom"]);
                s.len() == pk.shape.len() && s.iter().zip(&pk.shape).all(|(a, b)| (a.0 - b.0).abs() < 2e-5 && (a.1 - b.1).abs() < 2e-5)
            }
        };
        let Some(i) = mine.iter().position(same) else {
            self.say(false, "Only what you built can be pulled down.");
            return;
        };
        let (full, what) = price(pk.kind, &pk.shape, pk.rw.as_ref());
        match g.pay_for_building(&self.code, full * BUILD_DEMOLISH, &format!("pulled down {what}")) {
            Ok(()) => {
                g.remove_airport_op(&self.code, i);
                self.say(true, format!("Pulled down {what}."));
                self.picked = None;
            }
            Err(e) => self.say(false, e),
        }
    }

    /// The panel with the tools. Returns false when it was closed.
    pub fn panel(&mut self, ctx: &egui::Context, g: &mut Game, at: Pos2) -> bool {
        let mut open = true;
        let a = data().airport(&self.code);
        let title = if self.player { format!("🏗 Build at {}", self.code) } else { format!("🛠 Airport editor · {}", self.code) };
        egui::Window::new(title)
            .id(egui::Id::new("editorwin"))
            .open(&mut open)
            .default_pos(at)
            .default_width(300.0)
            .resizable(false)
            .show(ctx, |ui| {
                ui.weak(format!("{} · {}", a.name, a.city));
                if self.player {
                    ui.weak(format!(
                        "You own {}%: you pay that share. Money {}",
                        g.stake(&self.code),
                        fmt_money(g.state.money)
                    ));
                } else {
                    ui.weak("Developer fixes: free and at once; the browser game reads the same file.");
                }
                ui.horizontal_wrapped(|ui| {
                    for (id, label, tip) in TOOLS {
                        if ui.selectable_label(self.tool == id, label).on_hover_text(tip).clicked() {
                            self.tool = id;
                            self.pts.clear();
                        }
                    }
                });
                ui.weak(TOOLS.iter().find(|t| t.0 == self.tool).map(|t| t.2).unwrap_or(""));
                match self.tool {
                    "stand" => {
                        ui.horizontal(|ui| {
                            ui.label("Heading");
                            ui.add(egui::DragValue::new(&mut self.hdg).range(0.0..=359.0).suffix("°").speed(2.0));
                            ui.label("Name");
                            ui.add(egui::TextEdit::singleline(&mut self.name).desired_width(50.0));
                        });
                        if self.player {
                            ui.horizontal(|ui| {
                                ui.label("For");
                                for (k, c) in CLASSES.iter().enumerate() {
                                    ui.selectable_value(&mut self.cls, k, *c);
                                }
                            });
                            ui.weak(format!("A stand {} · one more slot of its class here", fmt_money(BUILD_STAND)));
                        }
                    }
                    "runway" => {
                        ui.horizontal(|ui| {
                            ui.label("Width");
                            for w in [30.0, 45.0, 60.0] {
                                ui.selectable_value(&mut self.rw_width, w, format!("{w:.0} m"));
                            }
                            ui.checkbox(&mut self.paved, "paved");
                        });
                        if let Some(r) = self.runway_of() {
                            if self.player {
                                let o = g.runway_project(&self.code, &r);
                                ui.label(format!("{:.0} m · {} (your share) · {} weeks", o.len, fmt_money(o.cost), o.weeks));
                                if let Some(e) = &o.err {
                                    ui.colored_label(Color32::from_rgb(255, 120, 100), e);
                                }
                            } else {
                                ui.label(format!("{:.0} m", flightgame::game::runway_length(&r)));
                            }
                        }
                    }
                    "select" => {}
                    kind => {
                        if self.player && self.pts.len() >= 2 {
                            let mut s = self.pts.clone();
                            if let Some(h) = self.hover {
                                s.push(h);
                            }
                            let (full, what) = price(kind, &s, None);
                            ui.label(format!("{what}: {} (your share)", fmt_money((full * g.stake(&self.code) as f64 / 100.0).round())));
                        }
                    }
                }
                if self.tool != "select" && self.tool != "stand" {
                    ui.horizontal(|ui| {
                        let label = if self.player {
                            if matches!(self.tool, "runway" | "terminal") { "Order" } else { "Build" }
                        } else {
                            "Finish"
                        };
                        if ui.add_enabled(self.pts.len() >= 2, egui::Button::new(label)).clicked() {
                            self.finish(g);
                        }
                        if ui.add_enabled(!self.pts.is_empty(), egui::Button::new("↶ Point")).clicked() {
                            self.pts.pop();
                        }
                        if ui.add_enabled(!self.pts.is_empty(), egui::Button::new("Cancel")).clicked() {
                            self.pts.clear();
                        }
                    });
                }
                if let Some(pk) = self.picked.clone() {
                    ui.separator();
                    let what = match pk.kind {
                        "stand" => format!("Stand {} · heading {:.0}°", if pk.name.is_empty() { "–" } else { &pk.name }, pk.hdg),
                        "runway" => format!("Runway · {:.0} m", line_m(&pk.shape)),
                        "taxiway" => format!("Taxiway · {:.0} m", line_m(&pk.shape)),
                        k => format!("{} · {:.0} m²", k[..1].to_uppercase() + &k[1..], area_m2(&pk.shape)),
                    };
                    ui.strong(what);
                    ui.horizontal(|ui| {
                        if ui.button("🗑 Pull down").clicked() {
                            self.delete(g);
                        }
                        if ui.button("Deselect").clicked() {
                            self.picked = None;
                        }
                    });
                }
                if !self.player {
                    ui.separator();
                    ui.horizontal(|ui| {
                        if ui.add_enabled(!self.undo.is_empty(), egui::Button::new("↶ Undo")).clicked() {
                            if let Some(prev) = self.undo.pop() {
                                fixes::set_ops(&self.code, prev);
                                save_local();
                                self.say(true, "Undone.");
                            }
                        }
                        if let Some(path) = repo_file() {
                            if ui.button("Write js/data/fixes.js").on_hover_text(path.display().to_string()).clicked() {
                                match std::fs::write(&path, fixes::file_text()) {
                                    Ok(()) => self.say(true, "Written: commit js/data/fixes.js to give everyone the fixes."),
                                    Err(e) => self.say(false, format!("Could not write it: {e}")),
                                }
                            }
                        }
                    });
                    ui.weak(format!("{} fix ops at {}", fixes::ops(&self.code).len(), self.code));
                }
                if let Some((ok, m)) = &self.msg {
                    ui.colored_label(if *ok { Color32::from_rgb(120, 220, 140) } else { Color32::from_rgb(255, 130, 110) }, m);
                }
            });
        open
    }
}

pub fn ring_kind(kind: &str) -> bool {
    matches!(kind, "apron" | "pad" | "terminal" | "hangar" | "building")
}

fn shape_of(kind: &str, g: &Value) -> Vec<(f64, f64)> {
    let n = |i: usize| g.get(i).and_then(|x| x.as_f64()).unwrap_or(0.0);
    match kind {
        "stand" => vec![(n(0), n(1))],
        "runway" => vec![(n(0), n(1)), (n(2), n(3))],
        _ => g.as_array().map(|l| l.iter().filter_map(|p| Some((p.get(0)?.as_f64()?, p.get(1)?.as_f64()?))).collect()).unwrap_or_default(),
    }
}

// ---------- your fixes, beside the save ----------

fn local_path() -> std::path::PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Flightgame").join("fixes.json")
}

/// Loads your airport editor's fixes (at start).
pub fn load_local() {
    if let Some(ops) = std::fs::read_to_string(local_path()).ok().and_then(|t| serde_json::from_str::<fixes::Ops>(&t).ok()) {
        fixes::set_local(ops);
    }
}

fn save_local() {
    let p = local_path();
    let _ = std::fs::create_dir_all(p.parent().unwrap());
    let _ = std::fs::write(p, serde_json::to_string_pretty(&fixes::local()).unwrap_or_default());
}

/// The repo's fixes.js, when the app runs from a checkout of it.
pub fn repo_file() -> Option<std::path::PathBuf> {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("js").join("data").join("fixes.js");
    p.exists().then_some(p)
}

#[cfg(test)]
mod tests {
    #[test]
    fn areas_and_prices() {
        // 100 m × 100 m near the equator
        let d = 100.0 / 111_320.0;
        let sq = [(0.0, 0.0), (0.0, d), (d, d), (d, 0.0)];
        assert!((super::area_m2(&sq) - 10_000.0).abs() < 10.0);
        let (full, _) = super::price("apron", &sq, None);
        assert!((full - 1_500_000.0).abs() < 5_000.0);
        assert!(super::in_ring((d / 2.0, d / 2.0), &sq));
    }
}
