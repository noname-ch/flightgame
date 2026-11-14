//! The window: start screen, top bar, sections, map, plane and airport windows, newspaper.
#![allow(deprecated)]

use crate::mapview::{self, EsriDark, EsriLight, Layers, Pick, hex};
use eframe::egui::{self, Align2, Color32, RichText, Stroke, Vec2};
use flightgame::config::*;
use flightgame::data::data;
use flightgame::game::*;
use std::path::PathBuf;
use walkers::{HttpOptions, HttpTiles, Map, MapMemory, lat_lon};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Section {
    Fleet,
    Airports,
    Schedule,
    Market,
    Finance,
    Rivals,
    Log,
}

const SECTIONS: [(Section, &str); 7] = [
    (Section::Fleet, "✈ Fleet"),
    (Section::Airports, "🏢 Airports"),
    (Section::Schedule, "🗓 Schedule"),
    (Section::Market, "🛒 Market"),
    (Section::Finance, "💰 Finance"),
    (Section::Rivals, "⚔ Rivals"),
    (Section::Log, "📜 Log"),
];

/// A timetable being edited for one plane.
struct Draft {
    plane: String,
    stops: Vec<String>,
    first_dep: i64,
    rounds: usize,
    legs: Vec<Leg>,
    add: String,
}

pub struct App {
    game: Option<Game>,
    setup: NewGame,
    tiles_dark: HttpTiles,
    tiles_light: HttpTiles,
    light_map: bool,
    map: MapMemory,
    /// exact (fractional) game time for animation
    t: f64,
    speed: usize,
    paused: bool,
    section: Option<Section>,
    selected: Option<Pick>,
    layers: Layers,
    newspapers: bool,
    toast: Option<(String, bool, f64)>,
    draft: Option<Draft>,
    delivery: String,
    market_cat: String,
    offer: f64,
    search: String,
    rename: String,
    last_save: f64,
    show_help: bool,
    /// FLIGHTGAME_SELFTEST=<folder>: plays a little by itself, saves screenshots there and quits
    selftest: Option<(PathBuf, u32, f64)>,
}

fn save_path() -> PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Flightgame").join("save.json")
}

fn money_color(v: f64) -> Color32 {
    if v < 0.0 { Color32::from_rgb(255, 105, 97) } else { Color32::from_rgb(120, 220, 140) }
}

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        cc.egui_ctx.set_theme(egui::ThemePreference::Dark);
        let cache = dirs::cache_dir().map(|d| d.join("Flightgame").join("tiles"));
        let opts = || HttpOptions { cache: cache.clone(), ..Default::default() };
        // load the world while the window opens
        std::thread::spawn(|| {
            let _ = data();
        });
        let mut map = MapMemory::default();
        let _ = map.set_zoom(5.0);
        map.center_at(lat_lon(49.0, 10.0));
        App {
            game: None,
            setup: NewGame::default(),
            tiles_dark: HttpTiles::with_options(EsriDark, opts(), cc.egui_ctx.clone()),
            tiles_light: HttpTiles::with_options(EsriLight, opts(), cc.egui_ctx.clone()),
            light_map: false,
            map,
            t: 0.0,
            speed: 2,
            paused: false,
            section: Some(Section::Fleet),
            selected: None,
            layers: Layers { rivals: true, routes: true, all_airports: false },
            newspapers: true,
            toast: None,
            draft: None,
            delivery: String::new(),
            market_cat: String::new(),
            offer: 0.0,
            search: String::new(),
            rename: String::new(),
            last_save: 0.0,
            show_help: false,
            selftest: std::env::var_os("FLIGHTGAME_SELFTEST").map(|d| (PathBuf::from(d), 0, 0.0)),
        }
    }

    fn say(&mut self, ctx: &egui::Context, r: Result<(), String>) {
        if let Err(e) = r {
            self.toast = Some((e, true, ctx.input(|i| i.time) + 6.0));
        }
    }

    fn info(&mut self, ctx: &egui::Context, msg: impl Into<String>) {
        self.toast = Some((msg.into(), false, ctx.input(|i| i.time) + 4.0));
    }

    fn start(&mut self, g: Game) {
        self.t = g.state.time as f64;
        let home = data().airport(g.home());
        self.map.center_at(lat_lon(home.lat, home.lon));
        let _ = self.map.set_zoom(6.0);
        self.delivery = g.home().to_string();
        self.selected = None;
        self.draft = None;
        self.paused = false;
        self.game = Some(g);
    }

    fn save(&mut self, ctx: &egui::Context) {
        let Some(g) = &self.game else { return };
        let path = save_path();
        let r = std::fs::create_dir_all(path.parent().unwrap()).and_then(|_| std::fs::write(&path, g.save_json()));
        self.last_save = ctx.input(|i| i.time);
        if let Err(e) = r {
            self.toast = Some((format!("Could not save: {e}"), true, self.last_save + 6.0));
        }
    }

    fn load(&mut self, ctx: &egui::Context) {
        match std::fs::read_to_string(save_path()).map_err(|e| e.to_string()).and_then(|t| Game::load_json(&t)) {
            Ok(g) => {
                self.start(g);
                self.info(ctx, "Game loaded.");
            }
            Err(e) => self.toast = Some((format!("Could not load: {e}"), true, ctx.input(|i| i.time) + 6.0)),
        }
    }

    // ---------- start screen ----------

    fn start_screen(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        egui::CentralPanel::default().show(ui, |ui| {
            ui.vertical_centered(|ui| {
                ui.add_space(30.0);
                ui.heading(RichText::new("✈ Flightgame").size(40.0).strong());
                ui.label("Build an airline: lease planes and slots, fly timetables, beat the rivals.");
                ui.add_space(20.0);
            });
            let d = data();
            egui::Frame::group(ui.style()).inner_margin(16.0).show(ui, |ui| {
                ui.set_max_width(560.0);
                if save_path().exists() {
                    ui.horizontal(|ui| {
                        if ui.button(RichText::new("▶ Continue").size(18.0)).clicked() {
                            self.load(&ctx);
                        }
                        ui.weak(format!("(saved game in {})", save_path().display()));
                    });
                    ui.separator();
                }
                ui.heading("New airline");
                egui::Grid::new("setup").num_columns(2).spacing([12.0, 8.0]).show(ui, |ui| {
                    ui.label("Name");
                    ui.text_edit_singleline(&mut self.setup.company);
                    ui.end_row();

                    ui.label("Home airport");
                    let cur = d.try_airport(&self.setup.airport).map(|a| format!("{} {}", a.code, a.name)).unwrap_or_default();
                    egui::ComboBox::from_id_salt("home").selected_text(cur).width(320.0).show_ui(ui, |ui| {
                        for (region, codes) in START_AIRPORTS {
                            ui.label(RichText::new(region).strong());
                            for c in codes {
                                if let Some(a) = d.try_airport(c) {
                                    ui.selectable_value(&mut self.setup.airport, c.to_string(), format!("   {} {} ({})", a.code, a.name, a.country));
                                }
                            }
                        }
                    });
                    ui.end_row();

                    ui.label("First aircraft (leased)");
                    let cur = d.try_ac(&self.setup.aircraft).map(|a| a.name.clone()).unwrap_or_default();
                    egui::ComboBox::from_id_salt("ac").selected_text(cur).width(320.0).show_ui(ui, |ui| {
                        for c in STARTER_AIRCRAFT {
                            if let Some(a) = d.try_ac(c) {
                                let ok = fits_airport(c, &self.setup.airport);
                                let text = format!("{} – {} seats, {:.0} km{}", a.name, a.seats, a.range_km, if ok { "" } else { " (can't use this airport)" });
                                ui.add_enabled_ui(ok, |ui| ui.selectable_value(&mut self.setup.aircraft, c.to_string(), text));
                            }
                        }
                    });
                    ui.end_row();

                    ui.label("Difficulty");
                    ui.horizontal(|ui| {
                        for df in &DIFFICULTIES {
                            ui.selectable_value(&mut self.setup.difficulty, df.id.to_string(), df.name).on_hover_text(df.desc);
                        }
                    });
                    ui.end_row();

                    ui.label("Mode");
                    ui.horizontal(|ui| {
                        for m in &MODES {
                            ui.selectable_value(&mut self.setup.mode, m.id.to_string(), m.name).on_hover_text(m.desc);
                        }
                    });
                    ui.end_row();
                });
                ui.add_space(10.0);
                if let Some(why) = fits_reason(&self.setup.aircraft, &self.setup.airport) {
                    ui.colored_label(Color32::LIGHT_RED, why);
                }
                ui.add_space(6.0);
                let ok = fits_airport(&self.setup.aircraft, &self.setup.airport);
                if ui.add_enabled(ok, egui::Button::new(RichText::new("Found the airline").size(18.0))).clicked() {
                    let g = Game::new_game(&self.setup);
                    self.start(g);
                }
            });
            ui.add_space(12.0);
            ui.weak(format!(
                "{} airports, {} towns, {} aircraft types – the same world as the browser game.",
                d.airports.len(),
                d.towns.len(),
                d.aircraft.len()
            ));
            if let Some((msg, err, _)) = &self.toast {
                ui.colored_label(if *err { Color32::LIGHT_RED } else { Color32::LIGHT_GREEN }, msg);
            }
        });
    }

    // ---------- top bar ----------

    fn top_bar(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        egui::Panel::top("top").show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.menu_button("⚙ Menu", |ui| {
                    if ui.button("💾 Save").clicked() {
                        self.save(&ctx);
                        self.info(&ctx, "Saved.");
                        ui.close();
                    }
                    if ui.button("📂 Load last save").clicked() {
                        self.load(&ctx);
                        ui.close();
                    }
                    if ui.button("✚ New game").clicked() {
                        self.save(&ctx);
                        self.game = None;
                        ui.close();
                    }
                    ui.separator();
                    ui.checkbox(&mut self.light_map, "Light map");
                    ui.checkbox(&mut self.layers.routes, "Route lines");
                    ui.checkbox(&mut self.layers.rivals, "Rival planes");
                    ui.checkbox(&mut self.layers.all_airports, "All airports");
                    ui.checkbox(&mut self.newspapers, "Newspapers");
                    ui.separator();
                    if ui.button("❓ How to play").clicked() {
                        self.show_help = true;
                        ui.close();
                    }
                    if ui.button("⏻ Quit").clicked() {
                        self.save(&ctx);
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                });
                // speed
                let pause_label = if self.paused { "▶" } else { "⏸" };
                if ui.button(pause_label).on_hover_text("Pause (Space)").clicked() {
                    self.paused = !self.paused;
                }
                for (k, s) in SPEEDS.iter().enumerate() {
                    if ui.selectable_label(!self.paused && self.speed == k, format!("{s}×")).on_hover_text("Game minutes per second").clicked() {
                        self.speed = k;
                        self.paused = false;
                    }
                }
                ui.separator();
                for (s, label) in SECTIONS {
                    if ui.selectable_label(self.section == Some(s), label).clicked() {
                        self.section = if self.section == Some(s) { None } else { Some(s) };
                    }
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let Some(g) = &self.game else { return };
                    ui.label(RichText::new(fmt_time(self.t as i64)).monospace());
                    ui.separator();
                    ui.label(RichText::new(fmt_money(g.state.money)).strong().color(money_color(g.state.money)));
                    ui.separator();
                    ui.label(RichText::new(&g.state.company).strong());
                });
            });
            if let Some((msg, err, until)) = &self.toast {
                if ctx.input(|i| i.time) < *until {
                    ui.colored_label(if *err { Color32::from_rgb(255, 140, 130) } else { Color32::LIGHT_GREEN }, msg);
                }
            }
        });
    }

    // ---------- plane cards at the bottom ----------

    fn plane_strip(&mut self, ui: &mut egui::Ui) {
        let Some(g) = &self.game else { return };
        let mut pick = None;
        egui::Panel::bottom("strip").show(ui, |ui| {
            egui::ScrollArea::horizontal().show(ui, |ui| {
                ui.horizontal(|ui| {
                    for (i, p) in g.state.planes.iter().enumerate() {
                        let what = match (&p.flight, p.status) {
                            (Some(f), Status::Flying) => format!("{}→{}", f.from, f.to),
                            (_, Status::Turnaround) => format!("{} ⟳", p.location),
                            _ => p.location.clone(),
                        };
                        let sel = self.selected == Some(Pick::Plane(i));
                        let text = RichText::new(format!("{}\n{}", Game::name_of(p), what)).size(12.0);
                        let r = ui.add(egui::Button::selectable(sel, text)).on_hover_ui(|ui| {
                            ui.label(&data().ac(&p.kind).name);
                            if let Some(n) = g.depart_note(i) {
                                ui.label(format!("Next: {n}"));
                            }
                        });
                        if r.clicked() {
                            pick = Some(i);
                        }
                    }
                });
            });
        });
        if let Some(i) = pick {
            self.select_plane(i);
        }
    }

    fn select_plane(&mut self, i: usize) {
        self.selected = Some(Pick::Plane(i));
        if let Some(g) = &self.game {
            self.rename = g.state.planes[i].name.clone().unwrap_or_default();
            let (lat, lon, _, _) = g.plane_position(i, self.t);
            self.map.center_at(lat_lon(lat, lon));
        }
    }

    fn select_airport(&mut self, code: &str, center: bool) {
        let d = data();
        if let Some(&k) = d.by_code.get(code) {
            self.selected = Some(Pick::Airport(k));
            self.offer = 0.0;
            if center {
                let a = &d.airports[k];
                self.map.center_at(lat_lon(a.lat, a.lon));
            }
        }
    }

    // ---------- the sections ----------

    fn side_panel(&mut self, ui: &mut egui::Ui) {
        let Some(section) = self.section else { return };
        egui::Panel::left("side").default_size(430.0).min_size(320.0).show(ui, |ui| {
            egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| match section {
                Section::Fleet => self.fleet(ui),
                Section::Airports => self.airports(ui),
                Section::Schedule => self.schedule(ui),
                Section::Market => self.market(ui),
                Section::Finance => self.finance(ui),
                Section::Rivals => self.rivals(ui),
                Section::Log => self.log_view(ui),
            });
        });
    }

    fn fleet(&mut self, ui: &mut egui::Ui) {
        let Some(g) = &self.game else { return };
        let d = data();
        ui.heading(format!("Fleet ({})", g.state.planes.len()));
        let mut pick = None;
        let mut edit = None;
        for (i, p) in g.state.planes.iter().enumerate() {
            let ac = d.ac(&p.kind);
            egui::Frame::group(ui.style()).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    if ui.link(RichText::new(Game::name_of(p)).strong()).clicked() {
                        pick = Some(i);
                    }
                    ui.label(&ac.name);
                    ui.weak(if p.ownership == Ownership::Owned { "owned" } else { "leased" });
                });
                let status = match (&p.flight, p.status) {
                    (Some(f), Status::Flying) => format!("Flying {} → {}, {} pax, lands {}", f.from, f.to, f.pax, fmt_clock(f.arr)),
                    (_, Status::Turnaround) => format!("Turnaround at {}", p.location),
                    _ => format!("At {}", p.location),
                };
                ui.label(status);
                if let Some(n) = g.depart_note(i) {
                    ui.weak(format!("Next: {n}"));
                }
                ui.horizontal(|ui| {
                    let sch = &p.schedule;
                    if sch.legs.is_empty() {
                        ui.weak("No timetable");
                    } else {
                        ui.label(format!("{} {} flights a day", if sch.active { "▶" } else { "⏸" }, sch.legs.len()));
                    }
                    if ui.small_button("🗓 Timetable").clicked() {
                        edit = Some(i);
                    }
                    let profit = p.stats.rev - p.stats.cost - p.stats.fixed - p.stats.repair;
                    ui.label(RichText::new(fmt_money(profit)).color(money_color(profit))).on_hover_text("Profit so far");
                });
            });
        }
        if let Some(i) = pick {
            self.select_plane(i);
        }
        if let Some(i) = edit {
            self.open_draft(i);
        }
    }

    fn open_draft(&mut self, i: usize) {
        let Some(g) = &self.game else { return };
        let p = &g.state.planes[i];
        let sch = &p.schedule;
        let stops = if sch.stops.is_empty() { vec![p.location.clone()] } else { sch.stops.clone() };
        let mut stops_dedup: Vec<String> = Vec::new();
        for s in stops {
            if !stops_dedup.contains(&s) {
                stops_dedup.push(s);
            }
        }
        self.draft = Some(Draft {
            plane: p.id.clone(),
            first_dep: sch.legs.first().map(|l| l.dep).unwrap_or(CURFEW_START + 60),
            stops: stops_dedup,
            rounds: 0,
            legs: sch.legs.clone(),
            add: String::new(),
        });
        self.section = Some(Section::Schedule);
    }

    fn airports(&mut self, ui: &mut egui::Ui) {
        let d = data();
        ui.heading("Airports");
        ui.horizontal(|ui| {
            ui.label("🔍");
            ui.text_edit_singleline(&mut self.search).on_hover_text("Code, city or name");
        });
        let q = self.search.trim().to_lowercase();
        let mut pick: Option<String> = None;
        if q.len() >= 2 {
            let mut hits: Vec<&flightgame::data::Airport> = d
                .airports
                .iter()
                .filter(|a| !a.factory && (a.code.to_lowercase() == q || a.city.to_lowercase().contains(&q) || a.name.to_lowercase().contains(&q)))
                .collect();
            hits.sort_by_key(|a| (a.code.to_lowercase() != q, std::cmp::Reverse(a.size)));
            for a in hits.into_iter().take(25) {
                if ui.link(format!("{} {} – {} (size {})", a.code, a.name, a.city, a.size)).clicked() {
                    pick = Some(a.code.clone());
                }
            }
            ui.separator();
        }
        let Some(g) = &self.game else { return };
        ui.strong("Your airports");
        for (code, sl) in &g.state.slots {
            let a = d.airport(code);
            ui.horizontal(|ui| {
                if ui.link(format!("{} {}", a.code, a.name)).clicked() {
                    pick = Some(code.clone());
                }
                ui.weak(format!("{} slot{} · {}", sl.count, if sl.count == 1 { "" } else { "s" }, airport_category(code)));
                if code == g.home() {
                    ui.label("🏠");
                }
            });
        }
        ui.add_space(6.0);
        ui.weak("Click an airport on the map (or here) for its slots and passengers. Bigger airports bring more passengers but cost more.");
        if let Some(c) = pick {
            self.select_airport(&c, true);
        }
    }

    fn schedule(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let Some(g) = &mut self.game else { return };
        let d = data();
        ui.heading("Schedule");
        // ---------- timetable editor ----------
        let mut close = false;
        let mut result: Option<Result<(), String>> = None;
        let mut save: Option<(usize, Vec<Leg>)> = None;
        if let Some(dr) = &mut self.draft {
            if let Some(i) = g.plane_idx(&dr.plane) {
                let p = &g.state.planes[i];
                let ac = d.ac(&p.kind);
                egui::Frame::group(ui.style()).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.strong(format!("Timetable for {} ({})", Game::name_of(p), ac.name));
                    ui.weak(format!("Range {:.0} km · turnaround {} min · {} seats", ac.range_km, turnaround_min(&p.kind), ac.seats));
                    ui.label("1. Route (the plane flies round it, back to the start):");
                    let mut remove = None;
                    let mut swap = None;
                    for (k, s) in dr.stops.iter().enumerate() {
                        ui.horizontal(|ui| {
                            ui.label(format!("{}. {} {}", k + 1, s, d.airport(s).city));
                            if k > 0 && ui.small_button("⬆").clicked() {
                                swap = Some(k);
                            }
                            if ui.small_button("✖").clicked() {
                                remove = Some(k);
                            }
                        });
                    }
                    if let Some(k) = remove {
                        dr.stops.remove(k);
                    }
                    if let Some(k) = swap {
                        dr.stops.swap(k, k - 1);
                    }
                    ui.horizontal(|ui| {
                        egui::ComboBox::from_id_salt("addstop").selected_text(if dr.add.is_empty() { "add a stop…".to_string() } else { dr.add.clone() }).show_ui(ui, |ui| {
                            for code in g.state.slots.keys() {
                                let last = dr.stops.last().cloned().unwrap_or_else(|| p.location.clone());
                                let far = d.dist(&last, code);
                                let ok = fits_airport(&p.kind, code) && far <= ac.range_km && *code != last;
                                let note = if !fits_airport(&p.kind, code) {
                                    " (too small)".to_string()
                                } else if far > ac.range_km {
                                    format!(" ({far:.0} km: out of range)")
                                } else {
                                    format!(" ({far:.0} km)")
                                };
                                ui.add_enabled_ui(ok, |ui| ui.selectable_value(&mut dr.add, code.clone(), format!("{} {}{note}", code, d.airport(code).city)));
                            }
                        });
                        if ui.add_enabled(!dr.add.is_empty(), egui::Button::new("Add")).clicked() {
                            dr.stops.push(std::mem::take(&mut dr.add));
                        }
                    });
                    ui.weak("Only airports where you hold a slot – lease slots in an airport's window.");
                    ui.horizontal(|ui| {
                        ui.label("2. First departure");
                        let mut h = dr.first_dep / 60;
                        let mut m = dr.first_dep % 60;
                        ui.add(egui::DragValue::new(&mut h).range(6..=21).suffix(" h"));
                        ui.add(egui::DragValue::new(&mut m).range(0..=55).speed(0.3).suffix(" min"));
                        dr.first_dep = (h * 60 + (m / 5) * 5).clamp(CURFEW_START, CURFEW_END);
                        ui.label("loops");
                        ui.add(egui::DragValue::new(&mut dr.rounds).range(0..=12)).on_hover_text("0 = as many as fit into the day");
                    });
                    if ui.button("Build timetable").clicked() {
                        dr.legs = Game::build_timetable(&p.kind, &dr.stops, dr.first_dep, dr.rounds);
                        if dr.legs.len() < 2 {
                            result = Some(Err("That route does not fit into one day (or needs at least 2 stops).".into()));
                        }
                    }
                    if !dr.legs.is_empty() {
                        ui.label("3. Flights (move one with − / +):");
                        let est = g.estimate_timetable(i, &dr.legs);
                        let mut shift: Option<(usize, i64)> = None;
                        egui::Grid::new("legs").striped(true).show(ui, |ui| {
                            ui.weak("dep");
                            ui.weak("flight");
                            ui.weak("arr");
                            ui.weak("pax");
                            ui.weak("result");
                            ui.end_row();
                            for (k, (leg, block, pax, res)) in est.rows.iter().enumerate() {
                                ui.horizontal(|ui| {
                                    if ui.small_button("−").clicked() {
                                        shift = Some((k, -5));
                                    }
                                    ui.monospace(fmt_clock(leg.dep));
                                    if ui.small_button("+").clicked() {
                                        shift = Some((k, 5));
                                    }
                                });
                                ui.label(format!("{}→{}", leg.from, leg.to));
                                ui.monospace(fmt_clock(leg.dep + block));
                                ui.label(format!("{pax}/{}", ac.seats));
                                ui.label(RichText::new(fmt_money(*res)).color(money_color(*res)));
                                ui.end_row();
                            }
                        });
                        if let Some((k, by)) = shift {
                            dr.legs[k].dep = (dr.legs[k].dep + by).rem_euclid(DAY);
                        }
                        let day = est.profit - est.fixed_per_day;
                        ui.label(format!(
                            "A day: {} pax, {} in the air, flights {} – lease and crew {} = {}",
                            est.pax,
                            fmt_duration(est.block),
                            fmt_money(est.profit),
                            fmt_money(est.fixed_per_day),
                            fmt_money(day)
                        ));
                        for e in g.check_timetable(i, &dr.legs) {
                            ui.colored_label(Color32::LIGHT_RED, format!("✖ {e}"));
                        }
                        for (code, have, need) in g.timetable_slots(i, &dr.legs) {
                            ui.colored_label(Color32::from_rgb(255, 200, 90), format!(
                                "⚠ {code}: {need} of your planes stand there at once, you hold {have} slot{} – one waits at its gate.",
                                if have == 1 { "" } else { "s" }
                            ));
                        }
                    }
                    ui.horizontal(|ui| {
                        if ui.add_enabled(dr.legs.len() >= 2, egui::Button::new("✔ Save and start")).clicked() {
                            save = Some((i, dr.legs.clone()));
                        }
                        if ui.button("Cancel").clicked() {
                            close = true;
                        }
                    });
                });
            } else {
                close = true;
            }
        }
        if let (Some((i, legs)), Some(g)) = (save, &mut self.game) {
            let r = g.set_timetable(i, legs).and_then(|_| g.set_schedule_active(i, true));
            if r.is_ok() {
                close = true;
            }
            result = Some(r);
        }
        if close {
            self.draft = None;
        }
        if let Some(r) = result {
            self.say(&ctx, r);
        }
        let Some(g) = &mut self.game else { return };
        // ---------- planes ----------
        ui.add_space(8.0);
        ui.strong("Timetables");
        let mut edit = None;
        let mut toggle = None;
        let mut clear = None;
        for (i, p) in g.state.planes.iter().enumerate() {
            ui.horizontal(|ui| {
                ui.label(RichText::new(Game::name_of(p)).strong());
                if p.schedule.legs.is_empty() {
                    ui.weak("none");
                } else {
                    let first = &p.schedule.legs[0];
                    ui.label(format!("{} from {} · {} flights", p.schedule.stops.join("–"), fmt_clock(first.dep), p.schedule.legs.len()));
                    if ui.small_button(if p.schedule.active { "⏸" } else { "▶" }).clicked() {
                        toggle = Some((i, !p.schedule.active));
                    }
                    if ui.small_button("✖").on_hover_text("Clear the timetable").clicked() {
                        clear = Some(i);
                    }
                }
                if ui.small_button("✏").clicked() {
                    edit = Some(i);
                }
            });
        }
        if let Some((i, a)) = toggle {
            let r = g.set_schedule_active(i, a);
            self.say(&ctx, r);
        }
        let Some(g) = &mut self.game else { return };
        if let Some(i) = clear {
            g.clear_timetable(i);
        }
        if let Some(i) = edit {
            self.open_draft(i);
        }
        // ---------- routes and fares ----------
        let Some(g) = &mut self.game else { return };
        ui.add_space(8.0);
        ui.strong("Routes and fares");
        ui.weak("Dearer tickets sell fewer seats. Rivals on a route split the passengers by seats and fares.");
        let mut change = None;
        egui::Grid::new("routes").striped(true).show(ui, |ui| {
            ui.weak("route");
            ui.weak("fare");
            ui.weak("pax/day");
            ui.weak("seats/day");
            ui.weak("rivals");
            ui.end_row();
            for (a, b, seats, pax) in g.player_routes() {
                ui.label(format!("{a}–{b}"));
                ui.horizontal(|ui| {
                    if ui.small_button("−").clicked() {
                        change = Some((a.clone(), b.clone(), -1));
                    }
                    ui.label(format!("{} ({:.0}%)", fmt_money(g.fare(&a, &b)), g.fare_factor(&a, &b) * 100.0));
                    if ui.small_button("+").clicked() {
                        change = Some((a.clone(), b.clone(), 1));
                    }
                });
                ui.label(format!("{pax:.0}"));
                ui.label(format!("{:.0}", seats / 2.0));
                let names: Vec<String> = g.rivals_on(&a, &b).iter().map(|&(r, k)| {
                    let rv = &g.state.rivals[r];
                    format!("{} {}×", rv.name, rv.routes[k].per_day)
                }).collect();
                ui.label(if names.is_empty() { "–".into() } else { names.join(", ") });
                ui.end_row();
            }
        });
        if let Some((a, b, s)) = change {
            g.change_fare(&a, &b, s);
        }
    }

    fn market(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let Some(g) = &mut self.game else { return };
        let d = data();
        ui.heading("Marketplace");
        if !g.owns_slot(&self.delivery) {
            self.delivery = g.home().to_string();
        }
        ui.horizontal(|ui| {
            ui.label("Deliver to");
            egui::ComboBox::from_id_salt("delivery").selected_text(self.delivery.clone()).show_ui(ui, |ui| {
                for code in g.state.slots.keys() {
                    ui.selectable_value(&mut self.delivery, code.clone(), format!("{} {}", code, d.airport(code).city));
                }
            });
        });
        ui.horizontal_wrapped(|ui| {
            ui.selectable_value(&mut self.market_cat, String::new(), "All");
            for (k, name) in &d.categories {
                ui.selectable_value(&mut self.market_cat, k.clone(), name);
            }
        });
        let mut action: Option<(u8, String)> = None;
        ui.collapsing(RichText::new("Pre-owned (new offers every Monday)").strong(), |ui| {
            for l in &g.state.market.listings {
                let ac = d.ac(&l.kind);
                ui.horizontal(|ui| {
                    ui.label(format!("{} · {} years · {} seats · from {}", ac.name, l.age, ac.seats, l.at));
                    if ui.button(format!("Buy {}", fmt_money(l.price))).clicked() {
                        action = Some((2, l.id.clone()));
                    }
                });
            }
        });
        ui.separator();
        ui.strong("New aircraft");
        let mut list: Vec<&flightgame::data::Aircraft> =
            d.aircraft.iter().filter(|a| self.market_cat.is_empty() || a.category == self.market_cat).collect();
        list.sort_by_key(|a| a.seats);
        for ac in list {
            let fits = fits_reason(&ac.code, &self.delivery);
            egui::Frame::group(ui.style()).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    ui.strong(&ac.name);
                    ui.weak(format!("{} · class {}", ac.maker, CLASSES[type_class(&ac.code)]));
                });
                ui.label(format!(
                    "{} seats · {:.0} km · {:.0} km/h · {}/block hour · runway {:.0} m",
                    ac.seats,
                    ac.range_km,
                    ac.speed_kmh,
                    fmt_money(ac.cost_per_block_hour),
                    runway_need(&ac.code).0
                ));
                ui.horizontal(|ui| {
                    let ok = fits.is_none();
                    if ui.add_enabled(ok, egui::Button::new(format!("Lease {}/week", fmt_money(ac.lease_per_week))))
                        .on_hover_text(format!("Deposit {}", fmt_money(lease_deposit(&ac.code))))
                        .clicked()
                    {
                        action = Some((0, ac.code.clone()));
                    }
                    if ui.add_enabled(ok, egui::Button::new(format!("Buy {}", fmt_money(price_new(&ac.code))))).clicked() {
                        action = Some((1, ac.code.clone()));
                    }
                    if let Some(why) = &fits {
                        ui.weak(why);
                    }
                });
            });
        }
        if let Some((k, what)) = action {
            let at = self.delivery.clone();
            let r = match k {
                0 => g.lease_new(&what, &at),
                1 => g.buy_new(&what, &at),
                _ => g.buy_used(&what, &at),
            };
            let ok = r.is_ok();
            self.say(&ctx, r);
            if ok {
                self.info(&ctx, "Done – see the Fleet.");
            }
        }
    }

    fn finance(&mut self, ui: &mut egui::Ui) {
        let Some(g) = &self.game else { return };
        let s = &g.state;
        ui.heading("Finance");
        ui.label(RichText::new(fmt_money(s.money)).size(22.0).color(money_color(s.money)));
        ui.weak(format!("Bankrupt below {}", fmt_money(g.bankruptcy_limit())));
        let (planes, crews, slots, total) = g.weekly_costs();
        egui::Grid::new("fin").show(ui, |ui| {
            ui.label("Today: revenue");
            ui.label(fmt_money(s.today.revenue));
            ui.end_row();
            ui.label("Today: flight costs");
            ui.label(fmt_money(s.today.cost));
            ui.end_row();
            ui.label("Today: flights / pax");
            ui.label(format!("{} / {}", s.today.flights, s.today.pax));
            ui.end_row();
            ui.label("Weekly (Mondays): aircraft");
            ui.label(fmt_money(planes));
            ui.end_row();
            ui.label("crews");
            ui.label(fmt_money(crews));
            ui.end_row();
            ui.label("slots");
            ui.label(fmt_money(slots));
            ui.end_row();
            ui.label(RichText::new("weekly total").strong());
            ui.label(RichText::new(fmt_money(total)).strong());
            ui.end_row();
        });
        ui.add_space(8.0);
        ui.strong("Cash and daily result (last 60 days)");
        chart(ui, &s.history);
        ui.add_space(8.0);
        let (rep, parts) = g.reputation(None);
        ui.strong(format!("Reputation {rep:.0}/100"));
        for (l, v) in parts {
            ui.label(format!("{l}: {v:+.0}"));
        }
        let effects: Vec<&Effect> = g.active_effects().collect();
        if !effects.is_empty() {
            ui.add_space(8.0);
            ui.strong("Going on now");
            for e in effects {
                ui.label(format!("• {} (until {})", e.label, fmt_time(e.until)));
            }
        }
    }

    fn rivals(&mut self, ui: &mut egui::Ui) {
        let Some(g) = &self.game else { return };
        let d = data();
        ui.heading("Rival airlines");
        ui.weak("They fly from their hubs, react every Monday, and fight you with fares where you take their passengers.");
        for r in &g.state.rivals {
            let kind = match r.kind.as_str() {
                "flag" => "flag carrier",
                "low" => "low-cost",
                _ => "regional",
            };
            let flights: u32 = r.routes.iter().map(|x| x.per_day * 2).sum();
            egui::CollapsingHeader::new(RichText::new(format!("■ {}", r.name)).color(hex(&r.color)).strong())
                .id_salt(&r.id)
                .show(ui, |ui| {
                    ui.label(format!("{kind} · hubs {} · {} routes · {flights} flights a day", r.hubs.join(", "), r.routes.len()));
                    for rt in &r.routes {
                        ui.label(format!(
                            "{}–{} · {}× a day · {} · fares {:.0}%",
                            rt.a,
                            rt.b,
                            rt.per_day,
                            d.try_ac(&rt.kind).map(|a| a.name.as_str()).unwrap_or("?"),
                            rt.fare * 100.0
                        ));
                    }
                });
        }
    }

    fn log_view(&mut self, ui: &mut egui::Ui) {
        let Some(g) = &self.game else { return };
        ui.heading("Log");
        for e in &g.state.log {
            let color = match e.kind {
                LogKind::Good => Color32::from_rgb(120, 220, 140),
                LogKind::Bad => Color32::from_rgb(255, 130, 120),
                LogKind::Cost => Color32::from_rgb(255, 200, 120),
                LogKind::Summary => Color32::from_gray(150),
                LogKind::Info => Color32::from_gray(210),
            };
            ui.horizontal_wrapped(|ui| {
                ui.monospace(RichText::new(fmt_time(e.t)).weak());
                ui.colored_label(color, &e.msg);
            });
        }
    }

    // ---------- windows ----------

    fn plane_window(&mut self, ctx: &egui::Context) {
        let Some(Pick::Plane(i)) = self.selected else { return };
        let Some(g) = &mut self.game else { return };
        if i >= g.state.planes.len() {
            self.selected = None;
            return;
        }
        let d = data();
        let mut open = true;
        let mut action: Option<u8> = None;
        let mut send: Option<String> = None;
        let p = g.state.planes[i].clone();
        let ac = d.ac(&p.kind);
        egui::Window::new(format!("✈ {}", Game::name_of(&p)))
            .id(egui::Id::new("planewin"))
            .open(&mut open)
            .default_pos([ctx.content_rect().right() - 380.0, 80.0])
            .default_width(340.0)
            .show(ctx, |ui| {
                ui.label(RichText::new(&ac.name).strong());
                ui.weak(format!(
                    "{} · {} · {:.1} years old · {} seats · {:.0} km range · class {}",
                    ac.maker,
                    if p.ownership == Ownership::Owned { "owned" } else { "leased" },
                    g.plane_age(i),
                    ac.seats,
                    ac.range_km,
                    CLASSES[type_class(&p.kind)]
                ));
                ui.separator();
                match (&p.flight, p.status) {
                    (Some(f), Status::Flying) => {
                        let frac = ((self.t - f.dep as f64) / (f.arr - f.dep).max(1) as f64).clamp(0.0, 1.0);
                        ui.label(format!(
                            "{} {} → {} ({:.0} km)",
                            match f.kind {
                                FlightKind::Scheduled => "Flight",
                                FlightKind::Ferry => "Ferry",
                                FlightKind::Delivery => "Delivery",
                            },
                            d.airport(&f.from).city,
                            d.airport(&f.to).city,
                            f.distance
                        ));
                        ui.add(egui::ProgressBar::new(frac as f32).text(format!(
                            "{} left · lands {}",
                            fmt_duration((f.arr as f64 - self.t).max(0.0) as i64),
                            fmt_clock(f.arr)
                        )));
                        if f.kind == FlightKind::Scheduled {
                            ui.label(format!("{}/{} passengers · revenue {}", f.pax, ac.seats, fmt_money(f.revenue)));
                        }
                    }
                    _ => {
                        ui.label(format!("At {} {}", p.location, d.airport(&p.location).name));
                    }
                }
                if let Some(n) = g.depart_note(i) {
                    ui.weak(format!("Next: {n}"));
                }
                ui.separator();
                ui.horizontal(|ui| {
                    if ui.button("🗓 Timetable").clicked() {
                        action = Some(0);
                    }
                    if !p.schedule.legs.is_empty() && ui.button(if p.schedule.active { "⏸ Pause" } else { "▶ Start" }).clicked() {
                        action = Some(1);
                    }
                    egui::ComboBox::from_id_salt("sendto").selected_text("Send to…").show_ui(ui, |ui| {
                        for code in g.state.slots.keys() {
                            if *code != p.location && ui.selectable_label(false, format!("{} {}", code, d.airport(code).city)).clicked() {
                                send = Some(code.clone());
                            }
                        }
                    });
                });
                ui.horizontal(|ui| {
                    ui.label("Name");
                    ui.add(egui::TextEdit::singleline(&mut self.rename).desired_width(140.0));
                    if ui.button("Rename").clicked() {
                        action = Some(3);
                    }
                });
                // ---------- stats ----------
                ui.separator();
                let st = &p.stats;
                let profit = st.rev - st.cost - st.fixed - st.repair;
                egui::Grid::new("pstats").show(ui, |ui| {
                    ui.label("Flights / pax");
                    ui.label(format!("{} / {}", st.flights, st.pax));
                    ui.end_row();
                    ui.label("Seats filled");
                    ui.label(if st.seats > 0 { format!("{:.0}%", st.pax as f64 / st.seats as f64 * 100.0) } else { "–".into() });
                    ui.end_row();
                    ui.label("On time");
                    let n = st.on_time + st.late;
                    ui.label(if n > 0 { format!("{:.0}%", st.on_time as f64 / n as f64 * 100.0) } else { "–".into() });
                    ui.end_row();
                    ui.label("Flown");
                    ui.label(format!("{:.0} km, {}", st.km, fmt_duration(st.mins)));
                    ui.end_row();
                    ui.label("Revenue / costs");
                    ui.label(format!("{} / {}", fmt_money(st.rev), fmt_money(st.cost + st.fixed + st.repair)));
                    ui.end_row();
                    ui.label("Profit");
                    ui.label(RichText::new(fmt_money(profit)).color(money_color(profit)).strong());
                    ui.end_row();
                    ui.label("Running cost");
                    ui.label(format!("{}/block hour", fmt_money(ac.cost_per_block_hour * g.cost_mult(i))));
                    ui.end_row();
                });
                week_bars(ui, &st.weeks);
                if !st.recent.is_empty() {
                    ui.collapsing("Last flights", |ui| {
                        for r in &st.recent {
                            ui.horizontal(|ui| {
                                ui.monospace(fmt_clock(r.t));
                                ui.label(format!("{}→{} {}/{}", r.from, r.to, r.pax, r.seats));
                                ui.label(RichText::new(fmt_money(r.result)).color(money_color(r.result)));
                            });
                        }
                    });
                }
                ui.separator();
                let label = if p.ownership == Ownership::Owned {
                    format!("Sell for {}", fmt_money(g.sale_value(i)))
                } else {
                    format!("Return (fee {})", fmt_money(g.return_fee(i)))
                };
                if ui.button(label).clicked() {
                    action = Some(2);
                }
            });
        if !open {
            self.selected = None;
        }
        let r = match action {
            Some(0) => {
                self.open_draft(i);
                Ok(())
            }
            Some(1) => g.set_schedule_active(i, !p.schedule.active),
            Some(2) => {
                let r = g.dispose_plane(i);
                if r.is_ok() {
                    self.selected = None;
                }
                r
            }
            Some(3) => {
                g.rename_plane(i, &self.rename);
                Ok(())
            }
            _ => Ok(()),
        };
        self.say(ctx, r);
        if let (Some(code), Some(g)) = (send, &mut self.game) {
            let r = g.send_plane(i, &code);
            self.say(ctx, r);
        }
    }

    fn airport_window(&mut self, ctx: &egui::Context) {
        let Some(Pick::Airport(k)) = self.selected else { return };
        let Some(g) = &mut self.game else { return };
        let d = data();
        let a = &d.airports[k];
        let code = a.code.clone();
        let mut open = true;
        let mut action: Option<(u8, String)> = None;
        egui::Window::new(format!("🏢 {} {}", a.code, a.name))
            .id(egui::Id::new("airportwin"))
            .open(&mut open)
            .default_pos([ctx.content_rect().right() - 380.0, 80.0])
            .default_width(340.0)
            .show(ctx, |ui| {
                ui.label(format!("{}, {} · {} (size {})", a.city, a.country, airport_category(&code), a.size));
                ui.weak(format!(
                    "Catchment {:.0}k people · longest runway {:.0} m{} · stands up to class {}",
                    a.catchment / 1000.0,
                    a.runway,
                    if a.runway_paved < a.runway { format!(" ({:.0} m paved)", a.runway_paved) } else { String::new() },
                    CLASSES[max_class(&code)]
                ));
                ui.separator();
                let mine = g.slot_count(&code);
                let cap = g.slot_capacity(&code);
                let free = g.free_slots(&code);
                ui.strong(format!("Slots: {cap} · yours {mine} · free {free}"));
                ui.weak(format!("Lease {} upfront + {}/week. A slot holds one of your planes on the ground at a time.",
                    fmt_money(slot_upfront(&code)), fmt_money(slot_weekly(&code))));
                ui.horizontal(|ui| {
                    if ui.add_enabled(free > 0, egui::Button::new(if mine == 0 { "Lease a slot" } else { "Lease another slot" })).clicked() {
                        action = Some((0, String::new()));
                    }
                    if mine > 0 && ui.button(if mine == 1 { "Give up the airport" } else { "Give one back" }).clicked() {
                        action = Some((1, String::new()));
                    }
                });
                let holders = g.slot_holders(&code);
                if !holders.is_empty() {
                    ui.collapsing("Who holds the other slots", |ui| {
                        for h in &holders {
                            ui.horizontal(|ui| {
                                ui.colored_label(hex(&h.color), "■");
                                ui.label(format!("{} – {}{}", h.name, h.n, if h.hub { " (hub)" } else { "" }));
                            });
                        }
                        if free == 0 {
                            ui.separator();
                            ui.label("No slot is free: offer a holder money for one of theirs.");
                            if self.offer <= 0.0 {
                                self.offer = g.slot_offer_price(&code, &holders[0].id);
                            }
                            ui.add(egui::DragValue::new(&mut self.offer).speed(1000.0).range(0.0..=1e9).prefix("CHF "));
                            for h in &holders {
                                let chance = g.slot_offer_chance(&code, &h.id, self.offer);
                                if ui.button(format!("Offer to {} ({:.0}% chance)", h.name, chance * 100.0)).clicked() {
                                    action = Some((2, h.id.clone()));
                                }
                            }
                        }
                    });
                }
                let occ = g.slot_occupants(&code);
                if !occ.is_empty() {
                    ui.separator();
                    ui.strong("Your planes here");
                    for (i, how) in occ {
                        ui.label(format!("{} – {how}", Game::name_of(&g.state.planes[i])));
                    }
                }
                // passengers to and from your airports
                ui.separator();
                ui.strong("Passengers a day to your airports");
                egui::Grid::new("dem").striped(true).show(ui, |ui| {
                    ui.weak("to");
                    ui.weak("km");
                    ui.weak("pax/day");
                    ui.weak("fare");
                    ui.end_row();
                    let mut rows: Vec<(String, f64, f64)> = g
                        .state
                        .slots
                        .keys()
                        .filter(|c| **c != code)
                        .map(|c| (c.clone(), d.dist(&code, c), g.pax_demand(&code, c, 0.0)))
                        .collect();
                    rows.sort_by(|x, y| y.2.total_cmp(&x.2));
                    for (c, km, pax) in rows.into_iter().take(12) {
                        ui.label(c.clone());
                        ui.label(format!("{km:.0}"));
                        ui.label(format!("{pax:.0}"));
                        ui.label(fmt_money(g.fare(&code, &c)));
                        ui.end_row();
                    }
                });
                let rivals: Vec<String> = g.state.rivals.iter().filter(|r| r.hubs.contains(&code)).map(|r| r.name.clone()).collect();
                if !rivals.is_empty() {
                    ui.weak(format!("Hub of {}", rivals.join(", ")));
                }
                let effects: Vec<String> = g.active_effects().filter(|e| Game::effect_hits(e, &code) && !e.at.all).map(|e| e.label.clone()).collect();
                for e in effects {
                    ui.colored_label(Color32::from_rgb(255, 200, 90), format!("⚠ {e}"));
                }
            });
        if !open {
            self.selected = None;
        }
        if let Some((k, holder)) = action {
            let r = match k {
                0 => g.lease_slot(&code),
                1 => g.drop_slot(&code),
                _ => match g.make_slot_offer(&code, &holder, self.offer) {
                    Ok(true) => {
                        self.info(ctx, "Accepted! The slot is yours.");
                        Ok(())
                    }
                    Ok(false) => Err("The airport turned your offer down. Try again tomorrow, with more money or a better reputation.".into()),
                    Err(e) => Err(e),
                },
            };
            self.say(ctx, r);
        }
    }

    fn newspaper(&mut self, ctx: &egui::Context) -> bool {
        let Some(g) = &mut self.game else { return false };
        if !self.newspapers {
            g.state.news.clear();
            return false;
        }
        let Some(story) = g.state.news.first().cloned() else { return false };
        let mut done = false;
        egui::Modal::new(egui::Id::new("news")).show(ctx, |ui| {
            ui.set_width(520.0);
            ui.vertical_centered(|ui| {
                ui.label(RichText::new(story.paper.to_uppercase()).size(14.0).weak());
                ui.label(RichText::new(fmt_time(story.t)).weak());
                ui.separator();
                ui.label(RichText::new(&story.headline).size(24.0).strong().color(if story.good {
                    Color32::from_rgb(140, 230, 150)
                } else {
                    Color32::from_rgb(255, 150, 140)
                }));
                ui.label(RichText::new(&story.sub).size(16.0).italics());
            });
            ui.add_space(8.0);
            ui.label(&story.body);
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                if ui.button("Continue").clicked() || ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                    done = true;
                }
                ui.checkbox(&mut self.newspapers, "Show newspapers");
            });
        });
        if done {
            g.state.news.remove(0);
        }
        true
    }

    fn help(&mut self, ctx: &egui::Context) {
        egui::Window::new("How to play").open(&mut self.show_help).default_width(460.0).show(ctx, |ui| {
            ui.label("1. Click an airport on the map (or search it in Airports) and lease a slot there.");
            ui.label("2. Open your plane's 🗓 Timetable, add the airports, build the day plan and save it.");
            ui.label("3. Watch the money: every flight earns its tickets and pays fuel, fees and crew; leases, crews \
                      and slots are paid every Monday.");
            ui.label("4. Grow: lease or buy more planes in the Marketplace, set fares in Schedule, and keep an eye \
                      on the rivals.");
            ui.separator();
            ui.label("Departures only 06:00–22:00 (night curfew). A plane that would find all your slots at its \
                      destination taken waits at its gate. Your home base always has room.");
            ui.label("Keys: Space pauses, 1–6 set the speed.");
        });
    }
}

/// Cash as a line and each day's result as bars.
fn chart(ui: &mut egui::Ui, history: &[DayRecord]) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 140.0), egui::Sense::hover());
    let painter = ui.painter_at(rect);
    painter.rect_filled(rect, 4.0, Color32::from_gray(25));
    if history.len() < 2 {
        painter.text(rect.center(), Align2::CENTER_CENTER, "after a few days", egui::FontId::proportional(12.0), Color32::GRAY);
        return;
    }
    let days: Vec<&DayRecord> = history.iter().rev().collect();
    let n = days.len() as f32;
    let (mut lo, mut hi) = (f64::MAX, f64::MIN);
    for d in &days {
        lo = lo.min(d.cash).min(0.0);
        hi = hi.max(d.cash);
    }
    let y = |v: f64| rect.bottom() - 6.0 - ((v - lo) / (hi - lo).max(1.0)) as f32 * (rect.height() - 12.0);
    let rmax = days.iter().map(|d| (d.revenue - d.cost - d.fixed).abs()).fold(1.0, f64::max);
    let mid = rect.center().y;
    let w = rect.width() / n;
    for (k, d) in days.iter().enumerate() {
        let r = d.revenue - d.cost - d.fixed;
        let h = (r / rmax) as f32 * rect.height() * 0.3;
        let x = rect.left() + k as f32 * w;
        let bar = egui::Rect::from_two_pos(egui::pos2(x + 1.0, mid), egui::pos2(x + w - 1.0, mid - h));
        painter.rect_filled(bar, 0.0, money_color(r).gamma_multiply(0.5));
    }
    let pts: Vec<egui::Pos2> = days.iter().enumerate().map(|(k, d)| egui::pos2(rect.left() + (k as f32 + 0.5) * w, y(d.cash))).collect();
    painter.add(egui::Shape::line(pts, Stroke::new(2.0, Color32::from_rgb(10, 132, 255))));
    painter.text(rect.left_top() + Vec2::new(4.0, 2.0), Align2::LEFT_TOP, fmt_money(hi), egui::FontId::proportional(11.0), Color32::GRAY);
    painter.text(rect.left_bottom() + Vec2::new(4.0, -2.0), Align2::LEFT_BOTTOM, fmt_money(lo), egui::FontId::proportional(11.0), Color32::GRAY);
}

/// A bar per week (profit), the last 12 weeks.
fn week_bars(ui: &mut egui::Ui, weeks: &[Tally]) {
    if weeks.is_empty() {
        return;
    }
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 60.0), egui::Sense::hover());
    let painter = ui.painter_at(rect);
    painter.rect_filled(rect, 4.0, Color32::from_gray(25));
    let max = weeks.iter().map(|w| w.profit().abs()).fold(1.0, f64::max);
    let w = rect.width() / 12.0;
    let mid = rect.center().y;
    for (k, wk) in weeks.iter().enumerate() {
        let p = wk.profit();
        let h = (p / max) as f32 * rect.height() * 0.45;
        let x = rect.left() + k as f32 * w;
        painter.rect_filled(egui::Rect::from_two_pos(egui::pos2(x + 2.0, mid), egui::pos2(x + w - 2.0, mid - h)), 1.0, money_color(p));
    }
    if let Some(m) = resp.hover_pos() {
        let k = ((m.x - rect.left()) / w) as usize;
        if let Some(wk) = weeks.get(k) {
            resp.on_hover_text(format!(
                "Week {}: {} flights, {} pax, revenue {}, costs {}, profit {}",
                wk.week + 1,
                wk.flights,
                wk.pax,
                fmt_money(wk.rev),
                fmt_money(wk.cost + wk.fixed + wk.repair),
                fmt_money(wk.profit())
            ));
        }
    }
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        if self.game.is_none() {
            self.start_screen(ui);
            return;
        }
        // keys
        if !ctx.egui_wants_keyboard_input() && self.selftest.is_none() {
            ctx.input(|i| {
                if i.key_pressed(egui::Key::Space) {
                    self.paused = !self.paused;
                }
                for (k, key) in [egui::Key::Num1, egui::Key::Num2, egui::Key::Num3, egui::Key::Num4, egui::Key::Num5, egui::Key::Num6].iter().enumerate() {
                    if i.key_pressed(*key) {
                        self.speed = k;
                        self.paused = false;
                    }
                }
            });
        }
        let news_open = self.newspaper(&ctx);
        // ---------- time ----------
        if let Some(g) = &mut self.game {
            let running = !self.paused && !news_open && !g.state.game_over;
            if running {
                let dt = ctx.input(|i| i.stable_dt).min(0.1) as f64;
                self.t += dt * SPEEDS[self.speed];
                let target = self.t.floor() as i64;
                if target > g.state.time {
                    g.advance((target - g.state.time).min(6 * 60));
                }
                self.t = self.t.clamp(g.state.time as f64, g.state.time as f64 + 1.0);
                ctx.request_repaint();
            }
            if g.state.game_over {
                self.paused = true;
            }
        }
        let now = ctx.input(|i| i.time);
        if now - self.last_save > 60.0 && self.selftest.is_none() {
            self.save(&ctx);
        }

        self.top_bar(ui);
        self.plane_strip(ui);
        self.side_panel(ui);
        self.plane_window(&ctx);
        self.airport_window(&ctx);
        self.help(&ctx);
        self.selftest_tick(&ctx);

        // ---------- the map ----------
        let mut picked = None;
        egui::CentralPanel::no_frame().show(ui, |ui| {
            let Some(g) = &self.game else { return };
            let tiles: &mut dyn walkers::Tiles = if self.light_map { &mut self.tiles_light } else { &mut self.tiles_dark };
            let home = data().airport(g.home());
            let (t, selected, layers) = (self.t, self.selected, &self.layers);
            Map::new(Some(tiles), &mut self.map, lat_lon(home.lat, home.lon)).show(ui, |ui, response, projector, _memory| {
                let (_, clicked) = mapview::draw(ui, response, projector, g, t, selected, layers);
                if response.clicked() {
                    picked = Some(clicked);
                }
            });
            if g.state.game_over {
                egui::Area::new(egui::Id::new("over")).anchor(Align2::CENTER_CENTER, [0.0, 0.0]).show(ui.ctx(), |ui| {
                    egui::Frame::window(ui.style()).show(ui, |ui| {
                        ui.heading(RichText::new("Bankrupt!").color(Color32::LIGHT_RED));
                        ui.label("Your airline has run out of money. Menu → New game.");
                    });
                });
            }
        });
        match picked {
            Some(Some(Pick::Plane(i))) => self.select_plane(i),
            Some(Some(Pick::Airport(k))) => {
                self.selected = Some(Pick::Airport(k));
                self.offer = 0.0;
            }
            Some(None) => {}
            None => {}
        }
    }

    fn on_exit(&mut self) {
        if let Some(g) = &self.game {
            let path = save_path();
            let _ = std::fs::create_dir_all(path.parent().unwrap());
            let _ = std::fs::write(path, g.save_json());
        }
    }
}

impl App {
    /// The self-test: a new game with a timetable to Vienna at full speed, a screenshot of each section, a report.
    fn selftest_tick(&mut self, ctx: &egui::Context) {
        let Some((dir, step, at)) = self.selftest.clone() else { return };
        let now = ctx.input(|i| i.time);
        ctx.request_repaint();
        if now < at {
            return;
        }
        let shot = |name: &str| {
            let path = dir.join(name);
            ctx.request_screenshot(move |img| {
                let [w, h] = img.size;
                let bytes: Vec<u8> = img.pixels.iter().flat_map(|c| c.to_array()).collect();
                let _ = image::save_buffer(&path, &bytes, w as u32, h as u32, image::ExtendedColorType::Rgba8);
            });
        };
        let next = |s: &mut Self, wait: f64| {
            if let Some(st) = &mut s.selftest {
                st.1 += 1;
                st.2 = now + wait;
            }
        };
        match step {
            0 => {
                let _ = std::fs::create_dir_all(&dir);
                let mut g = Game::new_game(&NewGame::default());
                g.state.money += 2_000_000.0;
                let mut report = Vec::new();
                report.push(format!("lease VIE: {:?}", g.lease_slot("VIE")));
                report.push(format!("lease ZRH: {:?}", g.lease_slot("ZRH")));
                let stops = vec!["BRN".to_string(), "VIE".to_string()];
                let legs = Game::build_timetable("A220-300", &stops, CURFEW_START + 60, 0);
                report.push(format!("timetable: {:?}", g.set_timetable(0, legs).and_then(|_| g.set_schedule_active(0, true))));
                report.push(format!("lease Q400 to ZRH: {:?}", g.lease_new("Q400", "ZRH")));
                let _ = std::fs::write(dir.join("report.txt"), report.join("\n"));
                self.start(g);
                self.newspapers = false;
                self.speed = 3;
                self.select_plane(0);
                let _ = self.map.set_zoom(5.0);
                self.open_draft(0);
                next(self, 8.0);
            }
            1 => {
                shot("1-schedule.png");
                next(self, 1.0);
            }
            2 => {
                self.speed = 5;
                self.section = Some(Section::Market);
                self.select_airport("VIE", false);
                next(self, 6.0);
            }
            3 => {
                shot("2-market-airport.png");
                next(self, 1.0);
            }
            4 => {
                self.section = Some(Section::Finance);
                self.select_plane(0);
                next(self, 6.0);
            }
            5 => {
                shot("3-finance-plane.png");
                next(self, 1.0);
            }
            6 => {
                self.section = Some(Section::Rivals);
                self.light_map = true;
                self.selected = None;
                next(self, 5.0);
            }
            7 => {
                shot("4-rivals-light.png");
                next(self, 1.5);
            }
            _ => {
                if let Some(g) = &self.game {
                    let p = &g.state.planes[0];
                    let line = format!(
                        "\n{} · money {} · plane 0: {} flights, {} pax · planes {} · rivals {} · log {}",
                        fmt_time(g.state.time),
                        fmt_money(g.state.money),
                        p.stats.flights,
                        p.stats.pax,
                        g.state.planes.len(),
                        g.state.rivals.len(),
                        g.state.log.len()
                    );
                    let path = dir.join("report.txt");
                    let old = std::fs::read_to_string(&path).unwrap_or_default();
                    let _ = std::fs::write(&path, old + &line);
                }
                self.game = None; // (don't overwrite the player's save)
                self.selftest = None;
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
        }
    }
}
