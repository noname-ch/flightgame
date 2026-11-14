//! The world map: tile sources and everything drawn over the tiles (airports, routes, planes).

use eframe::egui::{self, Align2, Color32, FontId, Pos2, Shape, Stroke, Vec2};
use flightgame::config::DAY;
use flightgame::data::{data, interpolate};
use flightgame::game::{Game, Status, airport_size};
use walkers::sources::{Attribution, TileSource};
use walkers::{Projector, TileId, lat_lon};

/// Esri's dark grey canvas (the browser game's "Dark" map style).
pub struct EsriDark;

impl TileSource for EsriDark {
    fn tile_url(&self, t: TileId) -> String {
        format!(
            "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{}/{}/{}",
            t.zoom, t.y, t.x
        )
    }
    fn attribution(&self) -> Attribution {
        Attribution { text: "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors", url: "https://www.esri.com", logo_light: None, logo_dark: None }
    }
    fn max_zoom(&self) -> u8 {
        16
    }
}

/// Esri's satellite pictures (the browser game's default "Satellite" style).
pub struct EsriImagery;

impl TileSource for EsriImagery {
    fn tile_url(&self, t: TileId) -> String {
        format!("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{}/{}/{}", t.zoom, t.y, t.x)
    }
    fn attribution(&self) -> Attribution {
        Attribution { text: "Tiles © Esri — Esri, Maxar, Earthstar Geographics", url: "https://www.esri.com", logo_light: None, logo_dark: None }
    }
    fn max_zoom(&self) -> u8 {
        18
    }
}

/// Esri's light grey canvas (the browser game's "Standard" map style, without its recolouring).
pub struct EsriLight;

impl TileSource for EsriLight {
    fn tile_url(&self, t: TileId) -> String {
        format!(
            "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{}/{}/{}",
            t.zoom, t.y, t.x
        )
    }
    fn attribution(&self) -> Attribution {
        Attribution { text: "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors", url: "https://www.esri.com", logo_light: None, logo_dark: None }
    }
    fn max_zoom(&self) -> u8 {
        16
    }
}

pub const PLAYER: Color32 = Color32::from_rgb(255, 69, 58);
pub const ROUTE: Color32 = Color32::from_rgb(10, 132, 255);
pub const OWN: Color32 = Color32::from_rgb(52, 199, 89);

pub fn hex(c: &str) -> Color32 {
    Color32::from_hex(c).unwrap_or(Color32::GRAY)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Pick {
    Airport(usize),
    Plane(usize),
}

pub struct Layers {
    pub rivals: bool,
    pub routes: bool,
    pub all_airports: bool,
    /// the rivals' routes as thin lines in their colours
    pub rival_routes: bool,
    /// darken the map a little (the satellite pictures), so the game stands out
    pub dim: bool,
}

/// Draws the game over the map and says what is under the pointer and what was clicked.
pub fn draw(
    ui: &mut egui::Ui,
    response: &egui::Response,
    projector: &Projector,
    game: &Game,
    t: f64,
    selected: Option<Pick>,
    layers: &Layers,
) -> (Option<Pick>, Option<Pick>) {
    let d = data();
    let painter = ui.painter().with_clip_rect(response.rect);
    let rect = response.rect;
    let zoom = projector.zoom();
    let pos = |lat: f64, lon: f64| -> Pos2 { projector.project(lat_lon(lat, lon)).to_pos2() };
    let pointer = response.hover_pos();
    let mut hover: Option<(Pick, f32)> = None;
    let consider = |p: Pick, at: Pos2, r: f32, hover: &mut Option<(Pick, f32)>| {
        if let Some(m) = pointer {
            let dd = m.distance(at);
            if dd < r && hover.is_none_or(|(_, b)| dd < b) {
                *hover = Some((p, dd));
            }
        }
    };

    if layers.dim {
        painter.rect_filled(rect, 0.0, Color32::from_black_alpha(90));
    }

    // ---------- the rivals' routes ----------
    if layers.rival_routes {
        for r in &game.state.rivals {
            let color = hex(&r.color).gamma_multiply(0.45);
            for rt in &r.routes {
                let (Some(a), Some(b)) = (d.try_airport(&rt.a), d.try_airport(&rt.b)) else { continue };
                great_circle(&painter, &pos, (a.lat, a.lon), (b.lat, b.lon), Stroke::new(1.0, color));
            }
        }
    }

    // ---------- route lines of the timetables ----------
    if layers.routes {
        let mut seen = std::collections::HashSet::new();
        for p in &game.state.planes {
            for l in &p.schedule.legs {
                let key = flightgame::game::route_key(&l.from, &l.to);
                if !seen.insert(key) {
                    continue;
                }
                let (a, b) = (d.airport(&l.from), d.airport(&l.to));
                let color = if p.schedule.active { ROUTE } else { ROUTE.gamma_multiply(0.4) };
                great_circle(&painter, &pos, (a.lat, a.lon), (b.lat, b.lon), Stroke::new(4.0, color));
            }
        }
        // the selected plane's flight
        if let Some(Pick::Plane(i)) = selected {
            if let Some(f) = game.state.planes.get(i).and_then(|p| p.flight.as_ref()) {
                let (a, b) = (d.airport(&f.from), d.airport(&f.to));
                great_circle(&painter, &pos, (a.lat, a.lon), (b.lat, b.lon), Stroke::new(2.0, PLAYER.gamma_multiply(0.8)));
            }
        }
    }

    // ---------- airports ----------
    // Bigger airports show from further out; your own always.
    let min_size = if layers.all_airports {
        0
    } else if zoom < 3.5 {
        5
    } else if zoom < 4.5 {
        4
    } else if zoom < 5.5 {
        3
    } else if zoom < 6.5 {
        2
    } else {
        0
    };
    let expanded = rect.expand(20.0);
    for (k, a) in d.airports.iter().enumerate() {
        let own = game.owns_slot(&a.code);
        let sel = selected == Some(Pick::Airport(k));
        if a.factory || (!own && !sel && (a.size < min_size || (a.minor && zoom < 7.0 && !layers.all_airports))) {
            continue;
        }
        let at = pos(a.lat, a.lon);
        if !expanded.contains(at) {
            continue;
        }
        let r = 2.0 + a.size as f32 * 0.9 + if own { 1.5 } else { 0.0 };
        // as on the browser game's map: blue airports with a white rim, small airfields as white dots, yours green
        let fill = if own { OWN } else if a.size >= 2 { ROUTE } else { Color32::from_gray(235) };
        painter.circle(at, r, fill, Stroke::new(1.5, Color32::WHITE));
        if sel {
            painter.circle_stroke(at, r + 4.0, Stroke::new(2.0, Color32::YELLOW));
        }
        let show_code = own || sel || zoom >= 9.0 - a.size as f64;
        if show_code {
            painter.text(at + Vec2::new(r + 3.0, 0.0), Align2::LEFT_CENTER, &a.code, FontId::proportional(11.0 + a.size as f32 * 0.5),
                if own { OWN } else { Color32::from_rgb(120, 180, 255) });
        }
        consider(Pick::Airport(k), at, r + 6.0, &mut hover);
    }

    // ---------- rival planes ----------
    if layers.rivals {
        for rp in game.rival_flights(t) {
            let at = pos(rp.lat, rp.lon);
            if rect.contains(at) {
                plane_shape(&painter, at, rp.heading, 5.0, hex(&rp.color).gamma_multiply(0.85));
            }
        }
    }

    // ---------- your planes ----------
    let mut stacked: std::collections::HashMap<String, f32> = std::collections::HashMap::new();
    for (i, p) in game.state.planes.iter().enumerate() {
        let (lat, lon, heading, airborne) = game.plane_position(i, t);
        let mut at = pos(lat, lon);
        if !airborne {
            // planes on the ground stand side by side under their airport
            let n = stacked.entry(p.location.clone()).or_insert(0.0);
            at += Vec2::new(*n * 12.0 - 6.0, 14.0);
            *n += 1.0;
        }
        let sel = selected == Some(Pick::Plane(i));
        let size = if sel { 10.0 } else { 8.0 };
        let color = if p.status == Status::Flying { PLAYER } else { PLAYER.gamma_multiply(0.75) };
        plane_shape(&painter, at, if airborne { heading } else { 0.0 }, size, color);
        if sel {
            painter.circle_stroke(at, size + 4.0, Stroke::new(2.0, Color32::YELLOW));
        }
        if sel || zoom >= 6.0 {
            painter.text(at + Vec2::new(0.0, -size - 4.0), Align2::CENTER_BOTTOM, Game::name_of(p), FontId::proportional(11.0), Color32::WHITE);
        }
        consider(Pick::Plane(i), at, size + 6.0, &mut hover);
    }

    // planes win over airports when both are under the pointer
    let hovered = hover.map(|h| h.0);
    let clicked = if response.clicked() { hovered } else { None };
    if let Some(h) = hovered {
        response.clone().on_hover_ui_at_pointer(|ui| match h {
            Pick::Airport(k) => {
                let a = &d.airports[k];
                ui.strong(format!("{} {}", a.code, a.name));
                ui.label(format!("{}, {} · {} (size {})", a.city, a.country, flightgame::game::airport_category(&a.code), airport_size(&a.code)));
            }
            Pick::Plane(i) => {
                let p = &game.state.planes[i];
                ui.strong(Game::name_of(p));
                ui.label(&d.ac(&p.kind).name);
                if let Some(f) = &p.flight {
                    let left = (f.arr as f64 - t).max(0.0) as i64;
                    ui.label(format!("{} → {} · {} left · {} pax", f.from, f.to, flightgame::game::fmt_duration(left), f.pax));
                } else {
                    ui.label(format!("at {}", p.location));
                }
            }
        });
    }
    let _ = DAY;
    (hovered, clicked)
}

/// A plane symbol: an arrow pointing along `heading` (degrees from north).
fn plane_shape(painter: &egui::Painter, at: Pos2, heading: f64, size: f32, color: Color32) {
    let h = (heading as f32).to_radians();
    let (s, c) = h.sin_cos();
    let rot = |x: f32, y: f32| at + Vec2::new(x * c - y * s, x * s + y * c);
    // nose up (y negative), wings, tail
    let pts = vec![
        rot(0.0, -size),
        rot(size * 0.75, size * 0.55),
        rot(0.0, size * 0.25),
        rot(-size * 0.75, size * 0.55),
    ];
    painter.add(Shape::convex_polygon(vec![pts[0], pts[1], pts[2]], color, Stroke::NONE));
    painter.add(Shape::convex_polygon(vec![pts[0], pts[2], pts[3]], color, Stroke::NONE));
    painter.add(Shape::closed_line(pts, Stroke::new(1.0, Color32::from_black_alpha(180))));
}

/// A great circle as a line, broken where it crosses the antimeridian.
fn great_circle(painter: &egui::Painter, pos: &dyn Fn(f64, f64) -> Pos2, a: (f64, f64), b: (f64, f64), stroke: Stroke) {
    let n = 48;
    let mut line: Vec<Pos2> = Vec::new();
    let mut last_lon = a.1;
    for k in 0..=n {
        let (lat, lon) = interpolate(a.0, a.1, b.0, b.1, k as f64 / n as f64);
        if (lon - last_lon).abs() > 180.0 && line.len() > 1 {
            painter.add(Shape::line(std::mem::take(&mut line), stroke));
        }
        last_lon = lon;
        line.push(pos(lat, lon));
    }
    if line.len() > 1 {
        painter.add(Shape::line(line, stroke));
    }
}
