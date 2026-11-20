//! The Liveries window (F7, Menu, or 🎨 Livery in a plane's window), as the browser game's js/liverywin.js:
//!   Choose     every livery as a little side view: make one the airline's (every plane without a livery of its own
//!              flies it) or give it to the plane picked
//!   Fleet      each plane with its livery: the airline's, or one of its own
//!   Designer   make a livery: colours, the title, the belly, the cheatline, the mark on the fin
//!   Community  liveries others made (community/liveries.json in the repo, read from GitHub), and share codes
//!              (`FGLIV1:…`, the same as the browser game's) to pass one on
//! Liveries are written as in js/data/liveries.js; the player's own (made or downloaded) are kept with the settings.
//! The 3D view paints the fuselage, belly, cheatline, fin, wings and engines in their colours (view3d.rs).
#![allow(deprecated)]

use crate::view3d::{self, Livery};
use eframe::egui::{self, Align2, Color32, RichText, Stroke, Vec2};
use flightgame::game::Game;
use serde_json::{Map, Value, json};
use std::sync::{Arc, Mutex};

const COMMUNITY_RAW: &str = "https://raw.githubusercontent.com/noname-ch/flightgame/main/community/liveries.json";
const CODE: &str = "FGLIV1:";
const MARKS: [(&str, &str); 9] = [
    ("", "None"),
    ("cross", "Cross"),
    ("disc", "Disc"),
    ("ring", "Ring"),
    ("chevron", "Band"),
    ("triangle", "Triangle"),
    ("split", "Split (two colours)"),
    ("logo", "Logo"),
    ("text", "Text"),
];
const LOGOS: [(&str, &str); 11] = [
    ("star", "Star"),
    ("klm", "Crown"),
    ("crane", "Crane"),
    ("harp", "Harp"),
    ("maple", "Maple leaf"),
    ("sun", "Sun"),
    ("bird", "Bird"),
    ("wave", "Waves"),
    ("globe", "Globe"),
    ("plane", "Paper plane"),
    ("tulip", "Tulip"),
];

#[derive(PartialEq, Clone, Copy)]
enum Tab {
    Choose,
    Fleet,
    Design,
    Community,
}

type Fetched = Arc<Mutex<Option<Result<Vec<Value>, String>>>>;

pub struct LiveryWin {
    pub open: bool,
    tab: Tab,
    /// the plane the window gives liveries to (None: only the airline's)
    pub plane: Option<String>,
    draft: Value,
    code: String,
    note: String,
    community: Fetched,
    asked: bool,
}

impl Default for LiveryWin {
    fn default() -> Self {
        LiveryWin {
            open: false,
            tab: Tab::Choose,
            plane: None,
            draft: Value::Null,
            code: String::new(),
            note: String::new(),
            community: Arc::new(Mutex::new(None)),
            asked: false,
        }
    }
}

/// The player's own liveries (made or downloaded), as the 3D view paints them.
pub fn mine(list: &[Value]) -> Vec<Livery> {
    list.iter().map(Livery::from_value).collect()
}

/// Every livery: the player's first, then the built-in ones.
fn all(list: &[Value]) -> Vec<Livery> {
    let mut out = mine(list);
    for l in view3d::liveries() {
        if !out.iter().any(|m| m.id == l.id) {
            out.push(l.clone());
        }
    }
    out
}

fn builtin(id: &str) -> bool {
    view3d::liveries().iter().any(|l| l.id == id)
}

fn now_id(prefix: &str) -> String {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("{prefix}-{ms:x}")
}

// ---------- colours of a livery written as JSON ----------

fn num(v: &Value) -> Option<u32> {
    v.as_f64().map(|n| n as u32 & 0xff_ffff)
}
fn c32(n: u32) -> Color32 {
    Color32::from_rgb((n >> 16) as u8, (n >> 8) as u8, n as u8)
}
fn col(l: &Value, k: &str, or: u32) -> u32 {
    num(&l[k]).unwrap_or(or)
}

/// A livery as a little side view (nose left, as the hangar pictures): the fuselage row by row in its colours
/// (belly, cheatline, the fin's colour round the rear), the wing and engine, the fin with its mark, the title.
pub fn side_view(p: &egui::Painter, rect: egui::Rect, l: &Value) {
    p.rect_filled(rect, 6.0, Color32::from_rgb(125, 152, 180));
    let body = col(l, "body", 0xf4f5f7);
    let wing = col(l, "wing", body);
    let engine = col(l, "engine", wing);
    let fin = col(l, "fin", body);
    let w = rect.width();
    let h = rect.height();
    let (x0, x1) = (rect.left() + w * 0.06, rect.left() + w * 0.9);
    let len = x1 - x0;
    let fh = h * 0.2; // fuselage height
    let cy = rect.top() + h * 0.56;
    let top = cy - fh / 2.0;
    // wing (behind the fuselage) and engine
    let wx = x0 + len * 0.36;
    p.add(egui::Shape::convex_polygon(
        vec![egui::pos2(wx, cy + fh * 0.2), egui::pos2(wx + len * 0.26, cy + fh * 0.2), egui::pos2(wx + len * 0.36, cy + fh * 0.9), egui::pos2(wx + len * 0.2, cy + fh * 0.9)],
        c32(wing).gamma_multiply(0.85),
        Stroke::NONE,
    ));
    // fin
    let fx = x0 + len * 0.83;
    let fin_pts = vec![egui::pos2(fx, top + 1.0), egui::pos2(x1 - len * 0.035, top - fh * 1.6), egui::pos2(x1 + len * 0.02, top - fh * 1.6), egui::pos2(x1, top + 1.0)];
    p.add(egui::Shape::convex_polygon(fin_pts, c32(fin), Stroke::NONE));
    // fuselage, row by row
    let rows = 36;
    let belly_from = l["belly"]["from"].as_f64().map(|f| f as f32);
    let belly = num(&l["belly"]["color"]);
    let line = num(&l["belly"]["line"]);
    let line_w = l["belly"]["lineWidth"].as_f64().unwrap_or(0.04) as f32;
    let stripe = num(&l["stripe"]["color"]);
    let st_at = l["stripe"]["at"].as_f64().unwrap_or(0.62) as f32;
    let st_w = l["stripe"]["width"].as_f64().unwrap_or(0.08) as f32;
    let tail = l["tail"].as_bool().unwrap_or(false);
    for r in 0..rows {
        let v = (r as f32 + 0.5) / rows as f32; // 0 top … 1 bottom
        let hh = 1.0 - 2.0 * v; // 1 top … -1 bottom
        let nose = x0 + fh * 0.9 * (1.0 - (1.0 - hh * hh).max(0.0).sqrt());
        let end = x1 - (v * v) * len * 0.16; // the tail sweeps up from below
        let mut c = body;
        if let (Some(b), Some(from)) = (belly, belly_from) {
            if v > from {
                c = b;
            }
            if let Some(li) = line {
                if (v - from).abs() < line_w / 2.0 {
                    c = li;
                }
            }
        }
        if let Some(s) = stripe {
            if (v - st_at).abs() < st_w / 2.0 {
                c = s;
            }
        }
        let y = top + fh * r as f32 / rows as f32;
        let row = egui::Rect::from_min_max(egui::pos2(nose, y), egui::pos2(end, y + fh / rows as f32 + 0.6));
        p.rect_filled(row, 0.0, c32(c));
        if tail {
            let from = (x0 + len * 0.84).max(nose);
            if end > from {
                p.rect_filled(egui::Rect::from_min_max(egui::pos2(from, y), egui::pos2(end, y + fh / rows as f32 + 0.6)), 0.0, c32(fin));
            }
        }
    }
    // windows
    for k in 0..26 {
        let x = x0 + len * (0.14 + k as f32 * 0.026);
        p.circle_filled(egui::pos2(x, top + fh * 0.36), (fh * 0.05).max(0.8), Color32::from_rgb(28, 33, 40));
    }
    p.circle_filled(egui::pos2(x0 + fh * 0.35, top + fh * 0.3), (fh * 0.08).max(1.0), Color32::from_rgb(28, 33, 40));
    // engine under the wing
    let ec = egui::pos2(wx + len * 0.1, cy + fh * 0.75);
    p.rect_filled(egui::Rect::from_center_size(ec, Vec2::new(len * 0.12, fh * 0.55)), fh * 0.27, c32(engine));
    // mark on the fin
    let mc = egui::pos2(x1 - len * 0.02, top - fh * 0.8);
    let mark = &l["mark"];
    let mcol = c32(num(&mark["color"]).unwrap_or(0xffffff));
    let ms = fh * 0.45 * mark["size"].as_f64().unwrap_or(1.0).clamp(0.4, 2.0) as f32;
    match mark["kind"].as_str().unwrap_or("") {
        "cross" => {
            p.rect_filled(egui::Rect::from_center_size(mc, Vec2::new(ms * 1.2, ms * 0.36)), 0.0, mcol);
            p.rect_filled(egui::Rect::from_center_size(mc, Vec2::new(ms * 0.36, ms * 1.2)), 0.0, mcol);
        }
        "disc" => {
            p.circle_filled(mc, ms * 0.55, mcol);
        }
        "ring" => {
            p.circle_stroke(mc, ms * 0.5, Stroke::new((ms * 0.16).max(1.0), mcol));
        }
        "chevron" | "split" => {
            p.line_segment([mc + Vec2::new(-ms * 0.8, ms * 0.6), mc + Vec2::new(ms * 0.5, -ms * 0.8)], Stroke::new((ms * 0.45).max(1.0), mcol));
        }
        "triangle" => {
            p.add(egui::Shape::convex_polygon(vec![mc + Vec2::new(0.0, -ms * 0.7), mc + Vec2::new(ms * 0.6, ms * 0.5), mc + Vec2::new(-ms * 0.6, ms * 0.5)], mcol, Stroke::NONE));
        }
        "logo" => {
            p.circle_stroke(mc, ms * 0.5, Stroke::new((ms * 0.14).max(1.0), mcol));
            p.circle_filled(mc, ms * 0.2, mcol);
        }
        "text" => {
            p.text(mc, Align2::CENTER_CENTER, mark["text"].as_str().unwrap_or(""), egui::FontId::proportional((ms * 0.9).max(6.0)), mcol);
        }
        _ => {}
    }
    // the title
    let title = l["title"].as_str().unwrap_or("");
    if !title.is_empty() {
        let size = (fh * if l["titleAt"].as_str() == Some("above") { 0.32 } else { 0.42 }).max(6.0);
        let ty = match l["titleAt"].as_str() {
            Some("above") => top + fh * 0.2,
            Some("low") => top + fh * 0.75,
            _ => top + fh * 0.5,
        };
        p.text(egui::pos2(x0 + len * 0.18, ty), Align2::LEFT_CENTER, title, egui::FontId::proportional(size), c32(col(l, "titleColor", 0)));
    }
}

// ---------- share codes ----------

const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
fn b64_encode(data: &[u8]) -> String {
    let mut out = String::new();
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for k in 0..4 {
            if k <= c.len() {
                out.push(B64[(n >> (18 - 6 * k) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}
fn b64_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let (mut acc, mut bits) = (0u32, 0);
    for ch in s.bytes().filter(|b| !b.is_ascii_whitespace()) {
        if ch == b'=' {
            break;
        }
        let v = B64.iter().position(|&b| b == ch)? as u32;
        acc = acc << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits & 0xff) as u8);
        }
    }
    Some(out)
}

pub fn share_code(l: &Value) -> String {
    let mut c = l.clone();
    if let Some(o) = c.as_object_mut() {
        o.remove("rev");
        o.remove("source");
    }
    format!("{CODE}{}", b64_encode(c.to_string().as_bytes()))
}

/// The liveries in a share code, livery JSON or a file of them, checked (only what a livery may hold).
pub fn from_code(text: &str) -> Result<Vec<Value>, String> {
    let text = text.trim();
    let json: Value = if let Some(rest) = text.strip_prefix(CODE) {
        let bytes = b64_decode(rest).ok_or("not a share code")?;
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())?
    } else {
        serde_json::from_str(text).map_err(|e| e.to_string())?
    };
    let list = match &json {
        Value::Array(a) => a.clone(),
        Value::Object(o) if o.get("liveries").is_some_and(|v| v.is_array()) => o["liveries"].as_array().cloned().unwrap_or_default(),
        v => vec![v.clone()],
    };
    let out: Vec<Value> = list.iter().filter_map(clean).collect();
    if out.is_empty() { Err("no livery in it".into()) } else { Ok(out) }
}

fn clean(l: &Value) -> Option<Value> {
    let o = l.as_object()?;
    let mut out = Map::new();
    let s = |v: &Value, n: usize| v.as_str().map(|x| Value::from(x.chars().take(n).collect::<String>()));
    let f = |v: &Value, lo: f64, hi: f64| v.as_f64().map(|x| Value::from(x.clamp(lo, hi)));
    out.insert("id".into(), s(&l["id"], 60).unwrap_or_else(|| now_id("x").into()));
    out.insert("name".into(), s(&l["name"], 40).unwrap_or_else(|| "Livery".into()));
    out.insert("title".into(), s(&l["title"], 24).unwrap_or_else(|| "".into()));
    for k in ["titleColor", "body", "wing", "engine", "fin", "winglet"] {
        if let Some(n) = num(&l[k]) {
            out.insert(k.into(), n.into());
        }
    }
    for (k, ok) in [("titleAt", &["above", "low"][..]), ("titleStyle", &["400", "700", "900", "700 italic"][..])] {
        if let Some(v) = l[k].as_str().filter(|v| ok.contains(v)) {
            out.insert(k.into(), v.into());
        }
    }
    if let Some(v) = f(&l["titleHeight"], 0.05, 0.6) {
        out.insert("titleHeight".into(), v);
    }
    if l["tail"].as_bool() == Some(true) {
        out.insert("tail".into(), true.into());
    }
    if let Some(b) = num(&l["belly"]["color"]) {
        let mut m = json!({ "color": b, "from": l["belly"]["from"].as_f64().unwrap_or(0.75).clamp(0.3, 1.0) });
        if let Some(n) = f(&l["belly"]["nose"], 0.0, 1.0) {
            m["nose"] = n;
        }
        if let Some(li) = num(&l["belly"]["line"]) {
            m["line"] = li.into();
            m["lineWidth"] = l["belly"]["lineWidth"].as_f64().unwrap_or(0.04).clamp(0.01, 0.3).into();
        }
        out.insert("belly".into(), m);
    }
    if let Some(c) = num(&l["stripe"]["color"]) {
        out.insert("stripe".into(), json!({ "color": c, "at": l["stripe"]["at"].as_f64().unwrap_or(0.62).clamp(0.1, 1.0),
            "width": l["stripe"]["width"].as_f64().unwrap_or(0.08).clamp(0.01, 0.4) }));
    }
    let kind = l["mark"]["kind"].as_str().unwrap_or("");
    if !kind.is_empty() && MARKS.iter().any(|(k, _)| *k == kind) {
        let mut m = json!({ "kind": kind });
        for k in ["color", "color2"] {
            if let Some(n) = num(&l["mark"][k]) {
                m[k] = n.into();
            }
        }
        if let Some(v) = f(&l["mark"]["size"], 0.3, 2.5) {
            m["size"] = v;
        }
        if let Some(v) = f(&l["mark"]["angle"], 0.0, 85.0) {
            m["angle"] = v;
        }
        if let Some(v) = s(&l["mark"]["text"], 12) {
            m["text"] = v;
        }
        let logo = l["mark"]["logo"].as_str().filter(|g| LOGOS.iter().any(|(k, _)| k == g)).unwrap_or("star");
        if kind == "logo" {
            m["logo"] = logo.into();
        }
        out.insert("mark".into(), m);
    }
    if let Some(a) = s(&l["author"], 40) {
        out.insert("author".into(), a);
    }
    if o.get("source").and_then(|v| v.as_str()) == Some("community") {
        out.insert("source".into(), "community".into());
    }
    Some(Value::Object(out))
}

fn fetch_community(into: Fetched) {
    std::thread::spawn(move || {
        let got = (|| -> Result<Vec<Value>, String> {
            let text = match ureq::get(COMMUNITY_RAW).header("User-Agent", "flightgame/0.1").call() {
                Ok(mut r) => r.body_mut().read_to_string().map_err(|e| e.to_string())?,
                Err(e) => {
                    // offline: the list as it is in this copy of the repo
                    let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("community").join("liveries.json");
                    std::fs::read_to_string(file).map_err(|_| format!("the community list could not be loaded ({e})"))?
                }
            };
            Ok(from_code(&text).unwrap_or_default())
        })();
        *into.lock().unwrap() = Some(got);
    });
}

// ---------- the window ----------

impl LiveryWin {
    pub fn open_for(&mut self, plane: Option<String>) {
        self.open = true;
        self.tab = Tab::Choose;
        if plane.is_some() {
            self.plane = plane;
        }
    }

    /// Shows one tab: "choose", "fleet", "design" or "community" (the self-test's screenshots).
    pub fn show_tab(&mut self, name: &str) {
        self.open = true;
        self.tab = match name {
            "fleet" => Tab::Fleet,
            "design" => Tab::Design,
            "community" => Tab::Community,
            _ => Tab::Choose,
        };
    }

    fn new_draft(&mut self, from: Option<&Livery>, company: &str, airline: &Livery) {
        let base = from.unwrap_or(airline);
        let mut d = if base.src.is_object() { base.src.clone() } else { json!({ "body": 0xf4f5f7, "fin": 0x14306b, "titleColor": 0x14306b }) };
        let own = from.is_some_and(|l| !builtin(&l.id) && l.src["source"].as_str() != Some("community"));
        if !own {
            d["id"] = now_id("my").into();
            d["name"] = match from {
                Some(l) => format!("{} (mine)", l.name).into(),
                None => "My livery".into(),
            };
            if from.is_none() {
                d["title"] = company.into();
            }
            if let Some(o) = d.as_object_mut() {
                o.remove("author");
                o.remove("source");
                o.remove("group");
            }
        }
        self.draft = d;
    }

    /// Shows the window. `airline`: the airline's livery id (in the settings); `list`: the player's own liveries.
    /// True when the settings changed (to be saved).
    pub fn show(&mut self, ctx: &egui::Context, game: &mut Game, airline: &mut Option<String>, list: &mut Vec<Value>) -> bool {
        if !self.open {
            return false;
        }
        let mut changed = false;
        let mut open = true;
        let livs = all(list);
        let mine_l = mine(list);
        let def = view3d::livery_in(airline.as_deref(), &mine_l);
        if self.plane.as_ref().is_some_and(|id| !game.state.planes.iter().any(|p| &p.id == id)) {
            self.plane = None;
        }
        let title = match self.plane.as_ref().and_then(|id| game.state.planes.iter().find(|p| &p.id == id)) {
            Some(p) => format!("🎨 Liveries · {}", Game::name_of(p)),
            None => "🎨 Liveries".into(),
        };
        egui::Window::new(title)
            .id(egui::Id::new("liverywin"))
            .open(&mut open)
            .default_pos([90.0, 80.0])
            .default_width(560.0)
            .default_height(560.0)
            .vscroll(true)
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    for (t, n) in [(Tab::Choose, "Choose"), (Tab::Fleet, "Fleet"), (Tab::Design, "Designer"), (Tab::Community, "Community")] {
                        if ui.selectable_label(self.tab == t, n).clicked() {
                            self.tab = t;
                        }
                    }
                });
                if !self.note.is_empty() {
                    ui.horizontal_wrapped(|ui| {
                        ui.label(RichText::new(&self.note).strong());
                        if ui.small_button("✕").clicked() {
                            self.note.clear();
                        }
                    });
                }
                ui.separator();
                match self.tab {
                    Tab::Choose => changed |= self.choose(ui, game, airline, list, &livs, &def),
                    Tab::Fleet => self.fleet(ui, game, &livs, &def),
                    Tab::Design => changed |= self.design(ui, game, airline, list, &def),
                    Tab::Community => changed |= self.community_tab(ui, list),
                }
            });
        if !open {
            self.open = false;
        }
        changed
    }

    fn choose(&mut self, ui: &mut egui::Ui, game: &mut Game, airline: &mut Option<String>, list: &mut Vec<Value>, livs: &[Livery], def: &Livery) -> bool {
        let mut changed = false;
        let plane = self.plane.clone().and_then(|id| game.state.planes.iter().position(|p| p.id == id));
        ui.horizontal_wrapped(|ui| {
            ui.label(format!("Airline: {}", def.name));
            if let Some(k) = plane {
                let p = &game.state.planes[k];
                ui.label(format!("· {}: {}", Game::name_of(p), match &p.livery {
                    Some(id) => livs.iter().find(|l| &l.id == id).map(|l| l.name.clone()).unwrap_or_else(|| id.clone()),
                    None => "the airline's".into(),
                }));
            }
            if ui.button("＋ New design").clicked() {
                self.new_draft(None, &game.state.company, def);
                self.tab = Tab::Design;
            }
        });
        if plane.is_none() {
            ui.weak("Open a plane's window and press 🎨 Livery to give it one of its own; the others fly the airline's.");
        }
        let groups: [(&str, Box<dyn Fn(&Livery) -> bool>); 5] = [
            ("My designs", Box::new(|l: &Livery| !builtin(&l.id) && l.src["source"].as_str() != Some("community"))),
            ("Downloaded", Box::new(|l: &Livery| !builtin(&l.id) && l.src["source"].as_str() == Some("community"))),
            ("Airlines", Box::new(|l: &Livery| builtin(&l.id) && l.src["group"].as_str().is_none_or(|g| g == "Airlines"))),
            ("Classic", Box::new(|l: &Livery| builtin(&l.id) && l.src["group"].as_str() == Some("Classic"))),
            ("Basic", Box::new(|l: &Livery| builtin(&l.id) && l.src["group"].as_str() == Some("Basic"))),
        ];
        let mut act: Option<(u8, String)> = None;
        for (name, test) in groups.iter() {
            let these: Vec<&Livery> = livs.iter().filter(|l| test(l)).collect();
            if these.is_empty() {
                continue;
            }
            ui.add_space(4.0);
            ui.label(RichText::new(*name).strong());
            let cols = ((ui.available_width() / 170.0).floor() as usize).max(1);
            egui::Grid::new(("lwgrid", *name)).spacing([6.0, 6.0]).show(ui, |ui| {
                for (n, l) in these.iter().enumerate() {
                    ui.vertical(|ui| {
                        ui.set_width(164.0);
                        let (rect, _) = ui.allocate_exact_size(Vec2::new(164.0, 66.0), egui::Sense::hover());
                        side_view(ui.painter(), rect, &l.src);
                        if l.id == def.id {
                            ui.painter().rect_stroke(rect, 6.0, Stroke::new(2.0, Color32::from_rgb(74, 222, 128)), egui::StrokeKind::Outside);
                        }
                        ui.label(RichText::new(&l.name).strong());
                        if let Some(a) = l.src["author"].as_str() {
                            ui.weak(format!("by {a}"));
                        }
                        ui.horizontal(|ui| {
                            if ui.selectable_label(l.id == def.id, if l.id == def.id { "✓ Airline" } else { "Airline" }).on_hover_text("Every plane without a livery of its own").clicked() {
                                act = Some((0, l.id.clone()));
                            }
                            if let Some(k) = plane {
                                let on = game.state.planes[k].livery.as_deref() == Some(l.id.as_str());
                                if ui.selectable_label(on, if on { "✓ This plane" } else { "This plane" }).clicked() {
                                    act = Some((if on { 2 } else { 1 }, l.id.clone()));
                                }
                            }
                            let own = !builtin(&l.id);
                            if ui.small_button(if own { "✏" } else { "⧉" }).on_hover_text(if own { "Change it" } else { "Make your own from it" }).clicked() {
                                act = Some((3, l.id.clone()));
                            }
                            if own {
                                if ui.small_button("📋").on_hover_text("Copy a share code").clicked() {
                                    act = Some((4, l.id.clone()));
                                }
                                if ui.small_button("🗑").on_hover_text("Remove it").clicked() {
                                    act = Some((5, l.id.clone()));
                                }
                            }
                        });
                    });
                    if (n + 1) % cols == 0 {
                        ui.end_row();
                    }
                }
            });
        }
        if let Some((k, id)) = act {
            match k {
                0 => {
                    *airline = Some(id);
                    changed = true;
                }
                1 | 2 => {
                    if let Some(p) = plane {
                        game.state.planes[p].livery = if k == 1 { Some(id) } else { None };
                    }
                }
                3 => {
                    let l = livs.iter().find(|l| l.id == id).cloned();
                    self.new_draft(l.as_ref(), &game.state.company, def);
                    self.tab = Tab::Design;
                }
                4 => {
                    if let Some(l) = livs.iter().find(|l| l.id == id) {
                        ui.ctx().copy_text(share_code(&l.src));
                        self.note = format!("The code for “{}” is copied: paste it anywhere (also into the browser game).", l.name);
                    }
                }
                _ => {
                    let used = airline.as_deref() == Some(id.as_str()) || game.state.planes.iter().any(|p| p.livery.as_deref() == Some(id.as_str()));
                    if used {
                        self.note = "It is flown: give those planes another livery first.".into();
                    } else {
                        list.retain(|v| v["id"].as_str() != Some(id.as_str()));
                        changed = true;
                    }
                }
            }
        }
        changed
    }

    fn fleet(&mut self, ui: &mut egui::Ui, game: &mut Game, livs: &[Livery], def: &Livery) {
        if game.state.planes.is_empty() {
            ui.weak("No planes yet.");
            return;
        }
        ui.horizontal(|ui| {
            ui.label(format!("{} planes · airline: {}", game.state.planes.len(), def.name));
            if ui.button("All the airline's").on_hover_text("Every plane flies the airline's livery again").clicked() {
                for p in &mut game.state.planes {
                    p.livery = None;
                }
            }
        });
        let mut same_type: Option<usize> = None;
        let mut pick: Option<String> = None;
        egui::Grid::new("lwfleet").striped(true).spacing([8.0, 4.0]).show(ui, |ui| {
            for (k, p) in game.state.planes.iter_mut().enumerate() {
                let l = p.livery.as_ref().and_then(|id| livs.iter().find(|l| &l.id == id)).unwrap_or(def);
                let (rect, _) = ui.allocate_exact_size(Vec2::new(96.0, 38.0), egui::Sense::hover());
                side_view(ui.painter(), rect, &l.src);
                ui.vertical(|ui| {
                    ui.set_min_width(110.0);
                    ui.strong(Game::name_of(p));
                    ui.weak(&p.kind);
                });
                let shown = match &p.livery {
                    Some(_) => l.name.clone(),
                    None => format!("Airline's ({})", def.name),
                };
                egui::ComboBox::from_id_salt(("lwplane", k)).selected_text(shown).width(170.0).show_ui(ui, |ui| {
                    if ui.selectable_label(p.livery.is_none(), format!("Airline's ({})", def.name)).clicked() {
                        p.livery = None;
                    }
                    for l in livs {
                        if ui.selectable_label(p.livery.as_deref() == Some(l.id.as_str()), &l.name).clicked() {
                            p.livery = Some(l.id.clone());
                        }
                    }
                });
                if ui.small_button(format!("all {}", p.kind)).on_hover_text("Every plane of this type gets this one's livery").clicked() {
                    same_type = Some(k);
                }
                if ui.small_button("🖼").on_hover_text("Choose with pictures").clicked() {
                    pick = Some(p.id.clone());
                }
                ui.end_row();
            }
        });
        if let Some(k) = same_type {
            let (kind, liv) = (game.state.planes[k].kind.clone(), game.state.planes[k].livery.clone());
            for q in &mut game.state.planes {
                if q.kind == kind {
                    q.livery = liv.clone();
                }
            }
            self.note = format!("Every {kind} now flies the same livery.");
        }
        if let Some(id) = pick {
            self.plane = Some(id);
            self.tab = Tab::Choose;
        }
    }

    fn design(&mut self, ui: &mut egui::Ui, game: &mut Game, airline: &mut Option<String>, list: &mut Vec<Value>, def: &Livery) -> bool {
        if !self.draft.is_object() {
            self.new_draft(None, &game.state.company, def);
        }
        let mut changed = false;
        let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width().min(520.0), 170.0), egui::Sense::hover());
        side_view(ui.painter(), rect, &self.draft);
        ui.weak("The 3D view paints the colours, the belly, the cheatline and the fin; the title and the mark are in the browser game's 3D.");
        let d = &mut self.draft;
        let color = |ui: &mut egui::Ui, v: &mut Value, label: &str| {
            let n = num(v).unwrap_or(0xf4f5f7);
            let mut c = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
            ui.label(label);
            if egui::color_picker::color_edit_button_srgb(ui, &mut c).changed() {
                *v = ((c[0] as u32) << 16 | (c[1] as u32) << 8 | c[2] as u32).into();
            }
        };
        let slider = |ui: &mut egui::Ui, v: &mut Value, label: &str, lo: f64, hi: f64, or: f64| {
            let mut x = v.as_f64().unwrap_or(or);
            ui.label(label);
            if ui.add(egui::Slider::new(&mut x, lo..=hi).show_value(false)).changed() {
                *v = x.into();
            }
        };
        egui::Grid::new("lwname").num_columns(2).spacing([10.0, 4.0]).show(ui, |ui| {
            for (k, label, max) in [("name", "Livery", 40), ("title", "Title", 24)] {
                let mut s = d[k].as_str().unwrap_or("").to_string();
                ui.label(label);
                if ui.add(egui::TextEdit::singleline(&mut s).char_limit(max).desired_width(200.0)).changed() {
                    d[k] = s.into();
                }
                ui.end_row();
            }
            color(ui, &mut d["titleColor"], "Title colour");
            ui.end_row();
            ui.label("Title at");
            let at = d["titleAt"].as_str().unwrap_or("window").to_string();
            egui::ComboBox::from_id_salt("lwtitleat").selected_text(match at.as_str() { "above" => "Above the windows", "low" => "Low (belly)", _ => "Across the windows" }).show_ui(ui, |ui| {
                for (k, n) in [("window", "Across the windows"), ("above", "Above the windows"), ("low", "Low (belly)")] {
                    if ui.selectable_label(at == k, n).clicked() {
                        if k == "window" {
                            if let Some(o) = d.as_object_mut() {
                                o.remove("titleAt");
                            }
                        } else {
                            d["titleAt"] = k.into();
                        }
                    }
                }
            });
            ui.end_row();
            let body = d["body"].clone();
            for (k, label) in [("body", "Fuselage"), ("wing", "Wings"), ("engine", "Engines"), ("fin", "Fin"), ("winglet", "Wing tips")] {
                if d[k].is_null() {
                    d[k] = body.clone();
                }
                color(ui, &mut d[k], label);
                ui.end_row();
            }
            let mut tail = d["tail"].as_bool().unwrap_or(false);
            ui.label("");
            if ui.checkbox(&mut tail, "Fin colour round the rear fuselage").changed() {
                d["tail"] = tail.into();
            }
            ui.end_row();
            // belly
            let mut on = d["belly"].is_object();
            ui.label("Belly");
            if ui.checkbox(&mut on, "in another colour").changed() {
                d["belly"] = if on { json!({ "color": 0x1b2a5c, "from": 0.75 }) } else { Value::Null };
            }
            ui.end_row();
            if d["belly"].is_object() {
                color(ui, &mut d["belly"]["color"], "  colour");
                ui.end_row();
                slider(ui, &mut d["belly"]["from"], "  height", 0.4, 0.95, 0.75);
                ui.end_row();
                let mut line = d["belly"]["line"].is_number();
                ui.label("");
                if ui.checkbox(&mut line, "a stripe along its edge").changed() {
                    if line {
                        d["belly"]["line"] = 0xd2232a.into();
                        d["belly"]["lineWidth"] = 0.06.into();
                    } else if let Some(o) = d["belly"].as_object_mut() {
                        o.remove("line");
                        o.remove("lineWidth");
                    }
                }
                ui.end_row();
                if line {
                    color(ui, &mut d["belly"]["line"], "  stripe");
                    ui.end_row();
                    slider(ui, &mut d["belly"]["lineWidth"], "  stripe width", 0.02, 0.2, 0.06);
                    ui.end_row();
                }
            }
            // cheatline
            let mut on = d["stripe"].is_object();
            ui.label("Cheatline");
            if ui.checkbox(&mut on, "a line along the windows").changed() {
                d["stripe"] = if on { json!({ "color": 0x14306b, "at": 0.6, "width": 0.1 }) } else { Value::Null };
            }
            ui.end_row();
            if d["stripe"].is_object() {
                color(ui, &mut d["stripe"]["color"], "  colour");
                ui.end_row();
                slider(ui, &mut d["stripe"]["at"], "  height", 0.2, 0.9, 0.62);
                ui.end_row();
                slider(ui, &mut d["stripe"]["width"], "  width", 0.02, 0.3, 0.08);
                ui.end_row();
            }
            // fin mark
            let kind = d["mark"]["kind"].as_str().unwrap_or("").to_string();
            ui.label("On the fin");
            egui::ComboBox::from_id_salt("lwmark").selected_text(MARKS.iter().find(|(k, _)| *k == kind).map_or("None", |m| m.1)).show_ui(ui, |ui| {
                for (k, n) in MARKS {
                    if ui.selectable_label(kind == k, n).clicked() {
                        if k.is_empty() {
                            d["mark"] = Value::Null;
                        } else {
                            if !d["mark"].is_object() {
                                d["mark"] = json!({ "color": 0xffffff });
                            }
                            d["mark"]["kind"] = k.into();
                            if k == "logo" && d["mark"]["logo"].is_null() {
                                d["mark"]["logo"] = "star".into();
                            }
                            if k == "text" && d["mark"]["text"].is_null() {
                                d["mark"]["text"] = d["title"].as_str().unwrap_or("AIR").chars().take(6).collect::<String>().into();
                            }
                        }
                    }
                }
            });
            ui.end_row();
            if !kind.is_empty() {
                if kind == "logo" {
                    let logo = d["mark"]["logo"].as_str().unwrap_or("star").to_string();
                    ui.label("  logo");
                    egui::ComboBox::from_id_salt("lwlogo").selected_text(LOGOS.iter().find(|(k, _)| *k == logo).map_or("Star", |m| m.1)).show_ui(ui, |ui| {
                        for (k, n) in LOGOS {
                            if ui.selectable_label(logo == k, n).clicked() {
                                d["mark"]["logo"] = k.into();
                            }
                        }
                    });
                    ui.end_row();
                }
                if kind == "text" {
                    let mut s = d["mark"]["text"].as_str().unwrap_or("").to_string();
                    ui.label("  text");
                    if ui.add(egui::TextEdit::singleline(&mut s).char_limit(12).desired_width(120.0)).changed() {
                        d["mark"]["text"] = s.into();
                    }
                    ui.end_row();
                }
                color(ui, &mut d["mark"]["color"], "  colour");
                ui.end_row();
                if kind == "triangle" || kind == "split" {
                    if d["mark"]["color2"].is_null() {
                        d["mark"]["color2"] = d["mark"]["color"].clone();
                    }
                    color(ui, &mut d["mark"]["color2"], "  second colour");
                    ui.end_row();
                }
            }
        });
        // (the JSON keeps no nulls: the browser game reads these files too)
        if let Some(o) = self.draft.as_object_mut() {
            o.retain(|_, v| !v.is_null());
        }
        ui.horizontal_wrapped(|ui| {
            let plane = self.plane.clone().filter(|id| game.state.planes.iter().any(|p| &p.id == id));
            let save = ui.button("💾 Save design").clicked();
            let fly = ui.button("Save & fly it").on_hover_text("Save it and make it the airline's livery").clicked();
            let give = plane.is_some() && ui.button("Save & give it to this plane").clicked();
            if ui.button("Start again").clicked() {
                self.new_draft(None, &game.state.company, def);
            }
            if save || fly || give {
                let mut d = self.draft.clone();
                if d["name"].as_str().is_none_or(|s| s.trim().is_empty()) {
                    d["name"] = "My livery".into();
                }
                let id = d["id"].as_str().unwrap_or("").to_string();
                match list.iter_mut().find(|v| v["id"].as_str() == Some(id.as_str())) {
                    Some(v) => *v = d.clone(),
                    None => list.push(d.clone()),
                }
                changed = true;
                if fly {
                    *airline = Some(id.clone());
                }
                if give {
                    if let Some(p) = game.state.planes.iter_mut().find(|p| Some(&p.id) == plane.as_ref()) {
                        p.livery = Some(id.clone());
                    }
                }
                self.note = format!("Saved “{}”{}.", d["name"].as_str().unwrap_or(""), if fly { ": the airline flies it now" } else if give { ": that plane flies it now" } else { "" });
            }
        });
        changed
    }

    fn community_tab(&mut self, ui: &mut egui::Ui, list: &mut Vec<Value>) -> bool {
        let mut changed = false;
        if !self.asked {
            self.asked = true;
            fetch_community(self.community.clone());
        }
        ui.horizontal(|ui| {
            ui.label(RichText::new("From the community").strong());
            if ui.small_button("↻").on_hover_text("Load the list again").clicked() {
                *self.community.lock().unwrap() = None;
                fetch_community(self.community.clone());
            }
        });
        let got = self.community.lock().unwrap().clone();
        match got {
            None => {
                ui.weak("Loading…");
                ui.ctx().request_repaint_after(std::time::Duration::from_millis(300));
            }
            Some(Err(e)) => {
                ui.weak(e);
            }
            Some(Ok(items)) if items.is_empty() => {
                ui.weak("Nothing shared yet: be the first!");
            }
            Some(Ok(items)) => {
                let cols = ((ui.available_width() / 170.0).floor() as usize).max(1);
                egui::Grid::new("lwcommunity").spacing([6.0, 6.0]).show(ui, |ui| {
                    for (n, c) in items.iter().enumerate() {
                        let id = format!("c-{}", c["id"].as_str().unwrap_or(""));
                        let have = list.iter().any(|v| v["id"].as_str() == Some(id.as_str()));
                        ui.vertical(|ui| {
                            ui.set_width(164.0);
                            let (rect, _) = ui.allocate_exact_size(Vec2::new(164.0, 66.0), egui::Sense::hover());
                            side_view(ui.painter(), rect, c);
                            ui.label(RichText::new(c["name"].as_str().unwrap_or("")).strong());
                            if let Some(a) = c["author"].as_str() {
                                ui.weak(format!("by {a}"));
                            }
                            if have {
                                ui.add_enabled(false, egui::Button::new("✓ In your liveries"));
                            } else if ui.button("⬇ Get").clicked() {
                                let mut v = c.clone();
                                v["id"] = id.clone().into();
                                v["source"] = "community".into();
                                list.push(v);
                                changed = true;
                                self.note = format!("“{}” is in your liveries now (Choose → Downloaded).", c["name"].as_str().unwrap_or(""));
                            }
                        });
                        if (n + 1) % cols == 0 {
                            ui.end_row();
                        }
                    }
                });
            }
        }
        ui.add_space(8.0);
        ui.label(RichText::new("Share yours").strong());
        let own: Vec<Value> = list.iter().filter(|v| v["source"].as_str() != Some("community")).cloned().collect();
        if own.is_empty() {
            ui.weak("Make one in the Designer first.");
        }
        for v in &own {
            ui.horizontal(|ui| {
                ui.label(v["name"].as_str().unwrap_or(""));
                if ui.small_button("📋 Copy code").clicked() {
                    ui.ctx().copy_text(share_code(v));
                    self.note = format!("The code for “{}” is copied.", v["name"].as_str().unwrap_or(""));
                }
            });
        }
        ui.weak("Send the code to a friend (it works in the browser game too), or post it in a GitHub issue so it gets on the community list.");
        ui.add_space(8.0);
        ui.label(RichText::new("Add one").strong());
        ui.add(egui::TextEdit::multiline(&mut self.code).hint_text("Paste a share code (FGLIV1:…) or livery JSON").desired_rows(3).desired_width(f32::INFINITY));
        if ui.button("Add from code").clicked() {
            match from_code(&self.code) {
                Ok(got) => {
                    let mut names = Vec::new();
                    for mut v in got {
                        let id = v["id"].as_str().unwrap_or("").to_string();
                        if builtin(&id) || list.iter().any(|x| x["id"].as_str() == Some(id.as_str()) && x["source"].as_str() == Some("community")) {
                            v["id"] = now_id("my").into();
                        }
                        if let Some(o) = v.as_object_mut() {
                            o.remove("source");
                        }
                        names.push(format!("“{}”", v["name"].as_str().unwrap_or("")));
                        let vid = v["id"].as_str().unwrap_or("").to_string();
                        match list.iter_mut().find(|x| x["id"].as_str() == Some(vid.as_str())) {
                            Some(x) => *x = v,
                            None => list.push(v),
                        }
                    }
                    self.code.clear();
                    changed = true;
                    self.note = format!("Added {}: find it under My designs in Choose.", names.join(", "));
                }
                Err(e) => self.note = format!("That code doesn't work: {e}"),
            }
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_codes_read_back() {
        let l = json!({ "id": "my-1", "name": "Zürich Blau", "title": "ZÜRI", "titleColor": 0x14306b, "body": 0xf4f5f7, "fin": 0x14306b,
            "stripe": { "color": 0xd2232a, "at": 0.6, "width": 0.1 }, "mark": { "kind": "logo", "logo": "star", "color": 0xffffff } });
        let code = share_code(&l);
        assert!(code.starts_with(CODE));
        let back = from_code(&code).unwrap();
        assert_eq!(back[0]["name"], "Zürich Blau");
        assert_eq!(back[0]["stripe"]["color"], 0xd2232a);
        assert_eq!(back[0]["mark"]["logo"], "star");
        // the browser game's codes are base64 of the UTF-8 JSON too
        assert_eq!(b64_encode(b"Ma"), "TWE=");
        assert_eq!(b64_decode("TWFu").unwrap(), b"Man");
        assert!(from_code("FGLIV1:!!!").is_err());
        assert!(Livery::from_value(&back[0]).stripe.is_some());
    }

    #[test]
    fn community_file_reads() {
        let text = include_str!("../../community/liveries.json");
        let got = from_code(text).unwrap();
        assert!(got.len() >= 3);
    }
}
