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
    /// night where the sun is down, and the clouds and rain
    pub night: bool,
    pub weather: bool,
    /// towns as circles by their population, and their names (the browser game's "Towns" and "Place names")
    pub towns: bool,
    pub place_names: bool,
    pub legend: bool,
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
    icons: &std::collections::HashMap<String, egui::TextureId>,
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
    // the airports themselves when zoomed in: runways, and the real layout where the game has one
    if zoom >= 10.5 {
        ground(&painter, projector, rect, zoom);
    }
    if layers.night || layers.weather {
        sky(&painter, projector, rect, game, t, layers);
    }

    if layers.towns && zoom >= 4.0 {
        towns(&painter, projector, rect, zoom, layers.place_names);
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
                match icons.get(&rp.kind) {
                    Some(tex) => plane_icon(&painter, *tex, at, rp.heading, 15.0, hex(&rp.color)),
                    None => plane_shape(&painter, at, rp.heading, 5.0, hex(&rp.color).gamma_multiply(0.85)),
                }
            }
        }
    }

    // ---------- your planes ----------
    for (i, p) in game.state.planes.iter().enumerate() {
        // where it really is: at its stand, taxiing, on the runway or in the air (game.flight_pos)
        let (lat, lon, heading, _airborne) = game.plane_position(i, t);
        let at = pos(lat, lon);
        let sel = selected == Some(Pick::Plane(i));
        let size = if sel { 10.0 } else { 8.0 };
        let color = if p.status == Status::Flying { PLAYER } else { PLAYER.gamma_multiply(0.75) };
        let hdg = heading;
        match icons.get(&p.kind) {
            // the type seen from above, real size when zoomed in, never smaller than a symbol
            Some(tex) => {
                let ppm = projector.scale_pixel_per_meter(lat_lon(lat, lon));
                let px = (data().ac(&p.kind).span as f32 * ppm * 1.15).clamp(size * 2.6, 160.0);
                plane_icon(&painter, *tex, at, hdg, px, if p.status == Status::Flying { Color32::WHITE } else { Color32::from_gray(215) });
            }
            None => plane_shape(&painter, at, hdg, size, color),
        }
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

/// Night and clouds over the map: a grid over the view, each corner coloured by how dark it is there and how
/// cloudy, blended smoothly in between.
fn sky(painter: &egui::Painter, projector: &Projector, rect: egui::Rect, game: &Game, t: f64, layers: &Layers) {
    const NX: usize = 48;
    const NY: usize = 32;
    let sun = game.sun_point(t);
    let storms: Vec<(f64, f64, f64)> = game
        .active_effects()
        .filter(|e| e.storm || e.label.starts_with("Storm "))
        .filter_map(|e| e.at.near.map(|(a, b)| (a, b, if e.at.radius_km > 0.0 { e.at.radius_km } else { 400.0 })))
        .collect();
    let mut night = egui::Mesh::default();
    let mut clouds = egui::Mesh::default();
    for j in 0..=NY {
        for i in 0..=NX {
            let p = egui::pos2(rect.left() + rect.width() * i as f32 / NX as f32, rect.top() + rect.height() * j as f32 / NY as f32);
            let geo = projector.unproject(p.to_vec2());
            let (lat, lon) = (geo.y().clamp(-85.0, 85.0), (geo.x() + 540.0).rem_euclid(360.0) - 180.0);
            let dark = 1.0 - flightgame::weather::daylight(lat, lon, sun);
            night.colored_vertex(p, Color32::from_rgba_unmultiplied(4, 8, 28, (dark * 150.0) as u8));
            let (cover, rain, storm) = if layers.weather { game.weather_lite(lat, lon, t, &storms) } else { (0.0, 0.0, false) };
            let grey = if storm { 120 } else { (235.0 - 90.0 * rain) as u8 };
            let alpha = (cover.powf(1.6) * 120.0 + if storm { 40.0 } else { 0.0 }) * (1.0 - 0.6 * dark);
            clouds.colored_vertex(p, Color32::from_rgba_unmultiplied(grey, grey, grey.saturating_add(8), alpha.min(200.0) as u8));
        }
    }
    for j in 0..NY as u32 {
        for i in 0..NX as u32 {
            let a = j * (NX as u32 + 1) + i;
            let (b, c, d) = (a + 1, a + NX as u32 + 1, a + NX as u32 + 2);
            for m in [&mut night, &mut clouds] {
                m.add_triangle(a, b, c);
                m.add_triangle(b, d, c);
            }
        }
    }
    if layers.weather {
        painter.add(egui::Shape::mesh(clouds));
    }
    if layers.night {
        painter.add(egui::Shape::mesh(night));
    }
}

/// Airports drawn as they are: runways (with the ones you built), and aprons, terminals, hangars, taxiways and
/// stands where the browser game ships a real layout.
fn ground(painter: &egui::Painter, projector: &Projector, rect: egui::Rect, zoom: f64) {
    let d = data();
    let pos = |lat: f64, lon: f64| -> Pos2 { projector.project(lat_lon(lat, lon)).to_pos2() };
    let near = rect.expand(rect.width().max(rect.height()) * 0.5);
    for a in &d.airports {
        let at = pos(a.lat, a.lon);
        if a.factory || !near.contains(at) {
            continue;
        }
        let ppm = projector.scale_pixel_per_meter(lat_lon(a.lat, a.lon));
        if let Some(l) = flightgame::layouts::layout(&a.code) {
            for r in l.aprons.iter().chain(&l.pads) {
                fill_polygon(painter, &r.iter().map(|p| pos(p.0, p.1)).collect::<Vec<_>>(), Color32::from_rgb(92, 96, 104));
            }
            for r in &l.taxiways {
                let pts: Vec<Pos2> = r.iter().map(|p| pos(p.0, p.1)).collect();
                painter.add(Shape::line(pts.clone(), Stroke::new((23.0 * ppm).max(1.5), Color32::from_rgb(72, 76, 84))));
                if zoom >= 14.0 {
                    painter.add(Shape::line(pts, Stroke::new(1.0, Color32::from_rgb(230, 190, 60))));
                }
            }
        }
        for r in flightgame::game::airport_runways(&a.code) {
            let (p1, p2) = (pos(r[0], r[1]), pos(r[2], r[3]));
            let w = (r[4].max(30.0) as f32 * ppm).max(2.5);
            let surface = if r[5] > 0.0 { Color32::from_rgb(52, 54, 58) } else { Color32::from_rgb(96, 120, 70) };
            painter.line_segment([p1, p2], Stroke::new(w, surface));
            if r[5] > 0.0 && w > 6.0 {
                // centre line, dashed
                let len = p1.distance(p2);
                let dir = (p2 - p1) / len.max(1.0);
                let dash = (30.0 * ppm).max(4.0);
                let mut s = dash;
                while s + dash < len - dash {
                    painter.line_segment([p1 + dir * s, p1 + dir * (s + dash)], Stroke::new((0.9 * ppm).max(1.0), Color32::WHITE));
                    s += dash * 2.0;
                }
            }
        }
        if let Some(l) = flightgame::layouts::layout(&a.code) {
            for r in &l.hangars {
                fill_polygon(painter, &r.iter().map(|p| pos(p.0, p.1)).collect::<Vec<_>>(), Color32::from_rgb(150, 140, 120));
            }
            for r in &l.others {
                fill_polygon(painter, &r.iter().map(|p| pos(p.0, p.1)).collect::<Vec<_>>(), Color32::from_rgb(170, 160, 150));
            }
            for r in &l.terminals {
                fill_polygon(painter, &r.iter().map(|p| pos(p.0, p.1)).collect::<Vec<_>>(), Color32::from_rgb(200, 205, 215));
            }
            if zoom >= 14.0 {
                for (lat, lon, _, name) in &l.stands {
                    let p = pos(*lat, *lon);
                    painter.circle_filled(p, (3.0 * ppm).clamp(1.5, 5.0), Color32::from_rgb(255, 214, 10));
                    if zoom >= 15.5 && !name.is_empty() {
                        painter.text(p + Vec2::new(4.0, 0.0), Align2::LEFT_CENTER, name, FontId::proportional(10.0), Color32::from_rgb(255, 230, 120));
                    }
                }
            }
        }
    }
}

/// Fills a simple polygon, convex or not, by ear clipping.
fn fill_polygon(painter: &egui::Painter, pts: &[Pos2], color: Color32) {
    let mut p: Vec<Pos2> = pts.to_vec();
    if p.len() > 2 && p.first() == p.last() {
        p.pop();
    }
    if p.len() < 3 {
        return;
    }
    // counter-clockwise on the screen (y down: positive area is clockwise)
    let area: f32 = (0..p.len()).map(|i| {
        let (a, b) = (p[i], p[(i + 1) % p.len()]);
        a.x * b.y - b.x * a.y
    }).sum();
    if area > 0.0 {
        p.reverse();
    }
    let cross = |a: Pos2, b: Pos2, c: Pos2| (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    let inside = |p0: Pos2, a: Pos2, b: Pos2, c: Pos2| cross(a, b, p0) <= 0.0 && cross(b, c, p0) <= 0.0 && cross(c, a, p0) <= 0.0;
    let mut mesh = egui::Mesh::default();
    for q in &p {
        mesh.colored_vertex(*q, color);
    }
    let mut idx: Vec<u32> = (0..p.len() as u32).collect();
    let mut guard = 0;
    while idx.len() > 3 && guard < 10_000 {
        guard += 1;
        let n = idx.len();
        let mut clipped = false;
        for i in 0..n {
            let (ia, ib, ic) = (idx[(i + n - 1) % n], idx[i], idx[(i + 1) % n]);
            let (a, b, c) = (p[ia as usize], p[ib as usize], p[ic as usize]);
            if cross(a, b, c) >= 0.0 {
                continue; // reflex corner
            }
            if idx.iter().any(|&k| k != ia && k != ib && k != ic && inside(p[k as usize], a, b, c)) {
                continue;
            }
            mesh.add_triangle(ia, ib, ic);
            idx.remove(i);
            clipped = true;
            break;
        }
        if !clipped {
            break; // (a self-crossing ring: leave the rest)
        }
    }
    if idx.len() == 3 {
        mesh.add_triangle(idx[0], idx[1], idx[2]);
    }
    painter.add(Shape::mesh(mesh));
}

/// Towns as small circles by their population (more of them the closer you zoom), with their names.
fn towns(painter: &egui::Painter, projector: &Projector, rect: egui::Rect, zoom: f64, names: bool) {
    let min_pop = if zoom < 5.0 {
        3_000_000.0
    } else if zoom < 6.0 {
        1_000_000.0
    } else if zoom < 7.0 {
        300_000.0
    } else if zoom < 8.5 {
        100_000.0
    } else {
        30_000.0
    };
    for t in &data().towns {
        if t.pop < min_pop {
            continue;
        }
        let p = projector.project(lat_lon(t.lat, t.lon)).to_pos2();
        if !rect.contains(p) {
            continue;
        }
        let r = (t.pop.log10() - 4.0).max(0.5) as f32 * 1.4;
        painter.circle(p, r, Color32::from_rgba_unmultiplied(255, 236, 200, 60), Stroke::new(1.0, Color32::from_rgba_unmultiplied(255, 230, 190, 140)));
        if names && (t.pop > min_pop * 3.0 || zoom >= 9.0) {
            painter.text(p + Vec2::new(0.0, r + 2.0), Align2::CENTER_TOP, &t.name, FontId::proportional(10.0), Color32::from_rgba_unmultiplied(255, 240, 215, 200));
        }
    }
}

/// A plane's top view (its icon, nose up) turned to `heading`, `px` wide, tinted with `tint` (white: as it is).
fn plane_icon(painter: &egui::Painter, tex: egui::TextureId, at: Pos2, heading: f64, px: f32, tint: Color32) {
    let h = (heading as f32).to_radians();
    let (s, c) = h.sin_cos();
    let half = px / 2.0;
    let rot = |x: f32, y: f32| at + Vec2::new(x * c - y * s, x * s + y * c);
    let mut mesh = egui::Mesh::with_texture(tex);
    for (x, y, u, v) in [(-half, -half, 0.0, 0.0), (half, -half, 1.0, 0.0), (half, half, 1.0, 1.0), (-half, half, 0.0, 1.0)] {
        mesh.vertices.push(egui::epaint::Vertex { pos: rot(x, y), uv: egui::pos2(u, v), color: tint });
    }
    mesh.add_triangle(0, 1, 2);
    mesh.add_triangle(0, 2, 3);
    painter.add(Shape::mesh(mesh));
}
