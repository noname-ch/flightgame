//! The window: start screen, top bar, sections, map, plane and airport windows, newspaper.
#![allow(deprecated)]

use crate::mapview::{self, EsriDark, EsriImagery, EsriLight, Layers, Pick, hex};
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
    Slots,
    Schedule,
    Market,
    Finance,
    Rivals,
    Log,
}

const SECTIONS: [(Section, &str); 8] = [
    (Section::Fleet, "✈ Fleet"),
    (Section::Airports, "🏢 Airports"),
    (Section::Slots, "🅿 Slots"),
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
    /// ultra long-haul: the timetable repeats every `days` days
    ultra: bool,
    days: u32,
}

pub struct App {
    game: Option<Game>,
    setup: NewGame,
    tiles_dark: HttpTiles,
    tiles_light: HttpTiles,
    tiles_sat: HttpTiles,
    /// 0 satellite (as the browser game), 1 dark, 2 light
    map_style: u8,
    /// the airport the Slots section shows
    slot_code: String,
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
    /// the start screen's page: 0 new game, 1 load, 2 quick start
    menu: u8,
    /// FLIGHTGAME_SELFTEST=<folder>: plays a little by itself, saves screenshots there and quits
    selftest: Option<(PathBuf, u32, f64)>,
    sound: crate::sound::Sound,
    /// where sound is heard from: the map's centre (lat, lon) and a height (m) by the zoom
    listener: (f64, f64, f64),
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
            tiles_sat: HttpTiles::with_options(EsriImagery, opts(), cc.egui_ctx.clone()),
            map_style: 0,
            slot_code: String::new(),
            map,
            t: 0.0,
            speed: 2,
            paused: false,
            section: Some(Section::Fleet),
            selected: None,
            layers: Layers { rivals: true, routes: true, all_airports: false, rival_routes: true, dim: true, night: true, weather: true },
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
            menu: if save_path().exists() { 1 } else { 0 },
            selftest: std::env::var_os("FLIGHTGAME_SELFTEST").map(|d| (PathBuf::from(d), 0, 0.0)),
            sound: crate::sound::Sound::new(),
            listener: (0.0, 0.0, 10000.0),
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

    /// The main menu as in the browser game: New game, Load game, Quick start (ready-made airlines).
    fn start_screen(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let d = data();
        egui::CentralPanel::default().show(ui, |ui| {
            ui.vertical_centered(|ui| {
                ui.add_space(24.0);
                ui.heading(RichText::new("✈ Flightgame").size(40.0).strong());
                ui.label("Build an airline from a single plane.");
                ui.add_space(14.0);
                ui.horizontal(|ui| {
                    let w = ui.available_width();
                    ui.add_space(((w - 480.0) / 2.0).max(0.0));
                    for (k, label) in ["New game", "Load game", "Quick start"].iter().enumerate() {
                        if ui.add(egui::Button::selectable(self.menu == k as u8, RichText::new(*label).size(17.0))).clicked() {
                            self.menu = k as u8;
                        }
                    }
                });
                ui.add_space(10.0);
            });
            egui::ScrollArea::vertical().show(ui, |ui| {
                ui.vertical_centered(|ui| {
                    egui::Frame::group(ui.style()).inner_margin(16.0).show(ui, |ui| {
                        ui.set_max_width(620.0);
                        match self.menu {
                            1 => self.load_menu(ui, &ctx),
                            2 => self.quick_start_menu(ui),
                            _ => self.new_game_menu(ui),
                        }
                    });
                    ui.add_space(10.0);
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
            });
        });
    }

    fn load_menu(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        ui.heading("Load game");
        if save_path().exists() {
            let summary = std::fs::read_to_string(save_path())
                .ok()
                .and_then(|t| Game::load_json(&t).ok())
                .map(|g| format!("{} · {} · {} planes · {}", g.state.company, fmt_time(g.state.time), g.state.planes.len(), fmt_money(g.state.money)));
            ui.label(summary.unwrap_or_else(|| "A saved game that can't be read.".into()));
            if ui.button(RichText::new("▶ Continue").size(17.0)).clicked() {
                self.load(ctx);
            }
            ui.weak(format!("Saved in {}", save_path().display()));
        } else {
            ui.label("No saved game yet: found an airline under New game.");
        }
    }

    fn quick_start_menu(&mut self, ui: &mut egui::Ui) {
        ui.heading("Quick start");
        ui.label("Ready-made airlines whose planes already fly daily timetables.");
        ui.add_space(6.0);
        let mut pick = None;
        for (k, p) in data().presets.iter().enumerate() {
            egui::Frame::group(ui.style()).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    if ui.button(RichText::new(&p.name).strong()).clicked() {
                        pick = Some(k);
                    }
                    ui.weak(format!("{} · {} planes", p.home, p.planes.len()));
                });
                ui.label(&p.desc);
            });
        }
        if let Some(k) = pick {
            let (g, errors) = Game::from_preset(&data().presets[k]);
            self.start(g);
            if !errors.is_empty() {
                self.toast = Some((errors.join(" "), true, ui.ctx().input(|i| i.time) + 8.0));
            }
        }
    }

    fn new_game_menu(&mut self, ui: &mut egui::Ui) {
        let d = data();
        ui.heading("New airline");
        egui::Grid::new("setup").num_columns(2).spacing([12.0, 8.0]).show(ui, |ui| {
            ui.label("Airline name");
            ui.text_edit_singleline(&mut self.setup.company);
            ui.end_row();

            ui.label("Mode");
            ui.horizontal(|ui| {
                for m in &MODES {
                    ui.selectable_value(&mut self.setup.mode, m.id.to_string(), m.name).on_hover_text(m.desc);
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

            ui.label("Game");
            ui.horizontal(|ui| {
                if ui.selectable_label(self.setup.story.is_none(), "Free play").on_hover_text("Today's world, every aircraft on sale.").clicked() {
                    self.setup.story = None;
                }
                if ui
                    .selectable_label(self.setup.story.is_some(), "Story mode")
                    .on_hover_text("Start in the past. Every year new airliners arrive, in the year they really first flew with airlines.")
                    .clicked()
                    && self.setup.story.is_none()
                {
                    self.setup.story = Some(STORY_YEARS[0]);
                }
                if let Some(y) = self.setup.story.as_mut() {
                    egui::ComboBox::from_id_salt("storyyear").selected_text(y.to_string()).show_ui(ui, |ui| {
                        for sy in STORY_YEARS {
                            ui.selectable_value(y, sy, sy.to_string());
                        }
                    });
                }
            });
            ui.end_row();

            ui.label("Home airport");
            let cur = d
                .try_airport(&self.setup.airport)
                .map(|a| format!("{} · {} – {}", a.code, a.city, a.name))
                .unwrap_or_default();
            egui::ComboBox::from_id_salt("home").selected_text(cur).width(340.0).show_ui(ui, |ui| {
                for (region, codes) in START_AIRPORTS {
                    ui.label(RichText::new(region).strong());
                    for c in codes {
                        if let Some(a) = d.try_airport(c) {
                            ui.selectable_value(&mut self.setup.airport, c.to_string(), format!("   {} · {} – {} ({})", a.code, a.city, a.name, a.country));
                        }
                    }
                }
            });
            ui.end_row();
        });
        if let Some(a) = d.try_airport(&self.setup.airport) {
            ui.weak(format!("{}, {} · {}, size {}", a.name, a.city, airport_category(&a.code).to_lowercase(), a.size));
        }
        ui.add_space(6.0);
        ui.label(RichText::new("First aircraft").strong());
        ui.weak("leased, with crew");
        let starters = starter_types(self.setup.story);
        if !starters.contains(&self.setup.aircraft) {
            if let Some(first) = starters.iter().find(|c| fits_airport(c, &self.setup.airport)).or(starters.first()) {
                self.setup.aircraft = first.clone();
            }
        }
        ui.horizontal_wrapped(|ui| {
            for c in &starters {
                let c = c.as_str();
                let Some(a) = d.try_ac(c) else { continue };
                let ok = fits_airport(c, &self.setup.airport);
                let text = RichText::new(format!(
                    "{}\n{} seats · {:.0} km · {}/wk",
                    a.name,
                    a.seats,
                    a.range_km,
                    fmt_money(a.lease_per_week)
                ));
                let r = ui.add_enabled(ok, egui::Button::selectable(self.setup.aircraft == c, text).min_size(Vec2::new(190.0, 44.0)));
                let r = if ok { r } else { r.on_disabled_hover_text(fits_reason(c, &self.setup.airport).unwrap_or_default()) };
                if r.clicked() {
                    self.setup.aircraft = c.to_string();
                }
            }
        });
        ui.add_space(10.0);
        if let Some(why) = fits_reason(&self.setup.aircraft, &self.setup.airport) {
            ui.colored_label(Color32::LIGHT_RED, why);
        }
        let ok = fits_airport(&self.setup.aircraft, &self.setup.airport);
        if ui.add_enabled(ok, egui::Button::new(RichText::new("Found the airline").size(18.0))).clicked() {
            let g = Game::new_game(&self.setup);
            self.start(g);
        }
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
                    ui.label("Map style");
                    ui.horizontal(|ui| {
                        ui.selectable_value(&mut self.map_style, 0, "Satellite");
                        ui.selectable_value(&mut self.map_style, 1, "Dark");
                        ui.selectable_value(&mut self.map_style, 2, "Light");
                    });
                    ui.checkbox(&mut self.layers.dim, "Darker map");
                    ui.checkbox(&mut self.layers.night, "Day and night");
                    ui.checkbox(&mut self.layers.weather, "Clouds and weather");
                    ui.checkbox(&mut self.layers.routes, "Route lines");
                    ui.checkbox(&mut self.layers.rivals, "Rival planes");
                    ui.checkbox(&mut self.layers.rival_routes, "Rival routes");
                    ui.checkbox(&mut self.layers.all_airports, "All airports");
                    ui.checkbox(&mut self.newspapers, "Newspapers");
                    ui.horizontal(|ui| {
                        ui.label("Sound");
                        ui.add(egui::Slider::new(&mut self.sound.volume, 0.0..=1.0).show_value(false));
                    });
                    if !self.sound.status.is_empty() {
                        ui.weak(&self.sound.status);
                    }
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
                if ui.button(if self.sound.on { "🔊" } else { "🔇" }).on_hover_text("Sound on or off (M)").clicked() {
                    self.sound.toggle();
                }
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
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let Some(g) = &self.game else { return };
                    ui.label(RichText::new(fmt_time(self.t as i64)).monospace());
                    ui.separator();
                    ui.label(RichText::new(fmt_money(g.state.money)).strong().color(money_color(g.state.money)));
                    ui.separator();
                    ui.label(
                        RichText::new(format!("{} · {}", mode(&g.state.mode).name, g.difficulty().name).to_uppercase())
                            .small()
                            .weak(),
                    );
                    ui.label(RichText::new(&g.state.company).strong());
                });
            });
            // the sections, on a row of their own so they never run into the airline and the clock
            ui.horizontal_wrapped(|ui| {
                for (s, label) in SECTIONS {
                    if ui.selectable_label(self.section == Some(s), label).clicked() {
                        self.section = if self.section == Some(s) { None } else { Some(s) };
                    }
                }
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
            self.slot_code = code.to_string();
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
                Section::Slots => self.slots(ui),
                Section::Schedule => self.schedule(ui),
                Section::Market => self.market(ui),
                Section::Finance => self.finance(ui),
                Section::Rivals => self.rivals(ui),
                Section::Log => self.log_view(ui),
            });
        });
    }

    /// The fleet as the browser game shows it: each plane's card with what it does, its crew, its timetable and the
    /// tickets on its routes.
    fn fleet(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let Some(g) = &self.game else { return };
        let d = data();
        ui.heading(format!("Fleet ({})", g.state.planes.len()));
        enum Act {
            Pick(usize),
            Edit(usize),
            Toggle(usize, bool),
            Ferry(usize, String),
            Fare(String, String, i32),
            Dispose(usize),
        }
        let mut act = None;
        for (i, p) in g.state.planes.iter().enumerate() {
            let ac = d.ac(&p.kind);
            egui::Frame::group(ui.style()).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.horizontal(|ui| {
                    if ui.link(RichText::new(Game::name_of(p)).strong()).clicked() {
                        act = Some(Act::Pick(i));
                    }
                    ui.label(&ac.name);
                });
                let own = match p.ownership {
                    Ownership::Owned => "owned".to_string(),
                    Ownership::Leased => format!("leased {}/week", fmt_money(ac.lease_per_week)),
                };
                ui.weak(format!("{} seats · range {:.0} km · {:.0} km/h · {own}", ac.seats, ac.range_km, ac.speed_kmh));
                let status = match (&p.flight, p.status) {
                    (Some(f), Status::Flying) => format!(
                        "Flying {} → {}, {} pax, lands {} local",
                        f.from,
                        f.to,
                        f.pax,
                        g.fmt_at(&f.to, f.arr)
                    ),
                    (_, Status::Turnaround) => format!("Turnaround at {}", p.location),
                    _ => format!("At {}", p.location),
                };
                let next = g.depart_note(i).map(|n| format!(" · next {n}")).unwrap_or_default();
                ui.label(format!("{status}{next}"));
                let c = &p.crew;
                ui.weak(format!(
                    "👥 {}{} pilots, {} cabin crew · duty today {} / {}",
                    if c.sets > 1 { "2 crews: " } else { "" },
                    c.pilots,
                    c.cabin,
                    fmt_duration(c.duty_today),
                    fmt_duration(CREW_MAX_DUTY_MIN * c.sets.max(1) as i64)
                ));
                let st = &p.stats;
                ui.weak(format!(
                    "Totals: {} flights · {} pax · {}",
                    st.flights,
                    st.pax,
                    fmt_money(st.rev - st.cost - st.fixed - st.repair)
                ));
                ui.horizontal(|ui| {
                    if ui.small_button("🎥 Follow").clicked() {
                        act = Some(Act::Pick(i));
                    }
                    egui::ComboBox::from_id_salt(("ferry", i)).selected_text("Ferry there").width(110.0).show_ui(ui, |ui| {
                        for code in g.state.slots.keys() {
                            if *code != p.location && ui.selectable_label(false, format!("{} · {}", code, d.airport(code).city)).clicked() {
                                act = Some(Act::Ferry(i, code.clone()));
                            }
                        }
                    });
                });
                let sch = &p.schedule;
                if sch.legs.is_empty() {
                    ui.weak("No timetable");
                } else {
                    ui.label(RichText::new(format!("Timetable {}", if sch.active { "● running" } else { "⏸ paused" })).strong());
                    let list: Vec<String> =
                        sch.legs.iter().map(|l| format!("{} {}→{}", g.fmt_at(&l.from, l.dep), l.from, l.to)).collect();
                    ui.label(RichText::new(list.join("  ")).small());
                    // the routes it flies, with their tickets
                    let mut seen = Vec::new();
                    egui::Grid::new(("fleetroutes", i)).striped(true).show(ui, |ui| {
                        ui.weak("route");
                        ui.weak("pax/day");
                        ui.weak("ticket");
                        ui.end_row();
                        for l in &sch.legs {
                            let key = route_key(&l.from, &l.to);
                            if seen.contains(&key) {
                                continue;
                            }
                            seen.push(key);
                            ui.label(format!("{} ↔ {}", l.from, l.to));
                            let share = g.market_share(&l.from, &l.to, 0.0);
                            let pax = g.pax_demand(&l.from, &l.to, 0.0);
                            ui.label(if share < 0.999 { format!("{pax:.0} you {:.0}%", share * 100.0) } else { format!("{pax:.0}") });
                            ui.horizontal(|ui| {
                                if ui.small_button("−").clicked() {
                                    act = Some(Act::Fare(l.from.clone(), l.to.clone(), -1));
                                }
                                ui.label(format!("{} {:.0}%", fmt_money(g.fare(&l.from, &l.to)), g.fare_factor(&l.from, &l.to) * 100.0));
                                if ui.small_button("+").clicked() {
                                    act = Some(Act::Fare(l.from.clone(), l.to.clone(), 1));
                                }
                            });
                            ui.end_row();
                        }
                    });
                }
                ui.horizontal(|ui| {
                    if !sch.legs.is_empty() && ui.small_button(if sch.active { "⏸ Pause" } else { "▶ Start" }).clicked() {
                        act = Some(Act::Toggle(i, !sch.active));
                    }
                    if ui.small_button("🗓 Edit timetable").clicked() {
                        act = Some(Act::Edit(i));
                    }
                    let label = if p.ownership == Ownership::Owned {
                        format!("Sell ({})", fmt_money(g.sale_value(i)))
                    } else {
                        format!("Return lease (fee {})", fmt_money(g.return_fee(i)))
                    };
                    if ui.small_button(label).clicked() {
                        act = Some(Act::Dispose(i));
                    }
                });
            });
        }
        let Some(act) = act else { return };
        let r = match act {
            Act::Pick(i) => {
                self.select_plane(i);
                Ok(())
            }
            Act::Edit(i) => {
                self.open_draft(i);
                Ok(())
            }
            Act::Toggle(i, on) => self.game.as_mut().unwrap().set_schedule_active(i, on),
            Act::Ferry(i, code) => self.game.as_mut().unwrap().send_plane(i, &code),
            Act::Fare(a, b, s) => {
                self.game.as_mut().unwrap().change_fare(&a, &b, s);
                Ok(())
            }
            Act::Dispose(i) => {
                let r = self.game.as_mut().unwrap().dispose_plane(i);
                if r.is_ok() {
                    self.selected = None;
                }
                r
            }
        };
        self.say(&ctx, r);
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
            ultra: sch.days > 1,
            days: sch.days.max(1),
        });
        self.section = Some(Section::Schedule);
    }

    /// Your airports grouped by category (as the browser game), and a search over all of them.
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
                .filter(|a| {
                    !a.factory && (a.code.to_lowercase() == q || a.city.to_lowercase().contains(&q) || a.name.to_lowercase().contains(&q))
                })
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
        ui.weak("Click to open. 🅿 your slots · 🛩 your planes there.");
        for (cat, sizes) in [("MAJOR HUBS", 5..=5), ("LARGE AIRPORTS", 3..=4), ("REGIONAL AIRPORTS", 2..=2), ("SMALL AIRPORTS", 0..=1)] {
            let codes: Vec<&String> = g.state.slots.keys().filter(|c| sizes.contains(&airport_size(c))).collect();
            if codes.is_empty() {
                continue;
            }
            ui.add_space(4.0);
            ui.label(RichText::new(format!("{cat} {}", codes.len())).small().strong());
            for code in codes {
                let a = d.airport(code);
                let planes = g.state.planes.iter().filter(|p| p.location == *code && p.status != Status::Flying).count();
                ui.horizontal(|ui| {
                    if ui.link(RichText::new(code).strong()).clicked() {
                        pick = Some(code.clone());
                    }
                    ui.label(&a.city);
                    if code == g.home() {
                        ui.weak("home");
                    }
                    ui.weak(format!("🅿 {} · 🛩 {planes} · {} local", g.slot_count(code), g.fmt_at(code, g.state.time)));
                });
            }
        }
        // ---------- shares, construction, tips ----------
        ui.add_space(8.0);
        ui.strong("Your airport shares");
        let shares: Vec<(&String, u32)> = g.state.infra.iter().filter(|(_, i)| i.stake > 0).map(|(c, i)| (c, i.stake)).collect();
        if shares.is_empty() {
            ui.weak("None yet. Click an airport on the map to buy shares – they pay a weekly dividend.");
        } else {
            egui::Grid::new("shares").striped(true).show(ui, |ui| {
                for h in ["Airport", "stake", "value", "div./wk"] {
                    ui.weak(h);
                }
                ui.end_row();
                for (code, st) in shares {
                    if ui.link(format!("{code} · {}", d.airport(code).city)).clicked() {
                        pick = Some(code.clone());
                    }
                    ui.label(format!("{st}%"));
                    ui.label(fmt_money(g.share_sale(code, st)));
                    ui.label(fmt_money(g.dividend(code)));
                    ui.end_row();
                }
            });
        }
        ui.add_space(4.0);
        ui.strong("Construction");
        if g.state.projects.is_empty() {
            ui.weak(format!("Nothing under construction. With {BOARD_STAKE}% of an airport you can order it in its window."));
        }
        for p in &g.state.projects {
            let frac = (g.state.time - p.start) as f32 / (p.done - p.start).max(1) as f32;
            ui.add(egui::ProgressBar::new(frac).text(format!("{}: {} – ready {}", p.code, p.label, fmt_time(p.done))));
        }
        ui.add_space(4.0);
        ui.strong("Airports near your network");
        ui.weak("Best value for money (dividend per franc).");
        egui::Grid::new("tips").striped(true).show(ui, |ui| {
            for h in ["Airport", "5% costs", "div./wk"] {
                ui.weak(h);
            }
            ui.end_row();
            for (code, price, div) in g.share_tips() {
                if ui.link(format!("{code} · {}", d.airport(&code).city)).clicked() {
                    pick = Some(code.clone());
                }
                ui.label(fmt_money(price));
                ui.label(fmt_money(div));
                ui.end_row();
            }
        });
        ui.add_space(6.0);
        ui.weak("Click an airport on the map (or here) for its slots and passengers. Bigger airports bring more passengers but cost more.");
        if let Some(c) = pick {
            self.select_airport(&c, true);
        }
    }

    /// The Slots section: your slots everywhere, and one airport's slots by class, who holds the rest, the planes
    /// there now, today's plan per slot and the day's arrivals and departures.
    fn slots(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let Some(g) = &self.game else { return };
        let d = data();
        if !g.owns_slot(&self.slot_code) && d.try_airport(&self.slot_code).is_none() {
            self.slot_code = g.home().to_string();
        }
        ui.heading("Slots");
        ui.strong("Your slots");
        let mut pick = None;
        egui::Grid::new("myslots").striped(true).show(ui, |ui| {
            ui.weak("Airport");
            ui.weak("yours");
            ui.weak("of");
            ui.weak("free");
            ui.weak("held by");
            ui.end_row();
            for code in g.state.slots.keys() {
                if ui.selectable_label(self.slot_code == *code, format!("{} {}", code, d.airport(code).city)).clicked() {
                    pick = Some(code.clone());
                }
                ui.label(g.slot_count(code).to_string());
                ui.label(g.slot_capacity(code).to_string());
                ui.label(g.free_slots(code, None).to_string());
                ui.horizontal(|ui| {
                    for h in g.slot_holders(code) {
                        ui.colored_label(hex(&h.color), h.n.to_string()).on_hover_text(&h.name);
                    }
                });
                ui.end_row();
            }
        });
        ui.weak(
            "A slot is a parking place for one plane at a time. A plane uses it from landing until it takes off; after that \
             any other of your planes can use it. If all slots are taken when a plane wants to fly there, it waits at its \
             gate until one frees up. A plane needs a slot of its stand class or bigger.",
        );
        if let Some(c) = pick {
            self.slot_code = c;
        }
        ui.separator();
        let code = self.slot_code.clone();
        let a = d.airport(&code);
        ui.heading(format!("{} · {}", code, a.name));
        let tab = g.slot_table(&code);
        let free = g.free_slots(&code, None);
        ui.label(format!(
            "{} slots (one per aircraft stand{}) · {} yours · {}",
            g.slot_capacity(&code),
            if a.real_stands { "" } else { ", as the browser game lays out an airport of its size" },
            g.slot_count(&code),
            if free == 0 { "none free".to_string() } else { format!("{free} free") }
        ));
        ui.weak(format!(
            "Yours: {}/week each · free ones: {} + {}/week",
            fmt_money(g.slot_fee(&code)),
            fmt_money(slot_upfront(&code)),
            fmt_money(slot_weekly(&code))
        ));
        let mut act: Option<(u8, usize, String)> = None;
        egui::Grid::new("slotclasses").striped(true).show(ui, |ui| {
            ui.weak("Class");
            ui.weak("stands");
            ui.weak("yours");
            ui.weak("free");
            ui.weak("");
            ui.end_row();
            for c in (0..6).rev() {
                if tab.cap[c] == 0 && tab.mine[c] == 0 {
                    continue;
                }
                ui.label(CLASSES[c]).on_hover_text(match c {
                    0 => "wingspan under 15 m",
                    1 => "under 24 m (Twin Otter)",
                    2 => "under 36 m (A320, 737)",
                    3 => "under 52 m (757, 767)",
                    4 => "under 65 m (A330, 787, 747-400)",
                    _ => "under 80 m (A380, 777-9)",
                });
                ui.label(tab.cap[c].to_string());
                ui.label(if tab.mine[c] > 0 { tab.mine[c].to_string() } else { String::new() });
                ui.label(if tab.free[c] > 0 { tab.free[c].to_string() } else { String::new() });
                ui.horizontal(|ui| {
                    if tab.free[c] > 0 && ui.small_button("+ lease").clicked() {
                        act = Some((0, c, String::new()));
                    }
                    if tab.mine[c] > 0 && ui.small_button("−").on_hover_text("Give one back").clicked() {
                        act = Some((1, c, String::new()));
                    }
                });
                ui.end_row();
            }
        });
        let holders = g.slot_holders(&code);
        if !holders.is_empty() {
            ui.add_space(4.0);
            if self.offer <= 0.0 {
                self.offer = g.slot_offer_price(&code, &holders[0].id);
            }
            egui::Grid::new("holders").striped(true).show(ui, |ui| {
                for h in &holders {
                    ui.colored_label(hex(&h.color), format!("{}{}", h.name, if h.hub { " (hub)" } else { "" }));
                    ui.label(h.n.to_string());
                    if free == 0 {
                        let chance = g.slot_offer_chance(&code, &h.id, self.offer);
                        if ui.small_button(format!("Offer {} ({:.0}%)", fmt_money(self.offer), chance * 100.0)).clicked() {
                            act = Some((2, 0, h.id.clone()));
                        }
                    }
                    ui.end_row();
                }
            });
            if free == 0 {
                ui.horizontal(|ui| {
                    ui.label("Your offer");
                    ui.add(egui::DragValue::new(&mut self.offer).speed(5000.0).range(0.0..=1e9).prefix("CHF "));
                });
            }
        }
        let (rep, _) = g.reputation(Some(&code));
        ui.weak(format!(
            "Your reputation at {code}: {rep:.0}/100 · when no slot is free, offer a holder money for one of theirs: the airport \
             decides by your offer and reputation"
        ));
        let show = ui.button("Show on map").clicked();
        // ---------- right now ----------
        ui.add_space(6.0);
        ui.strong("Right now");
        let occ = g.slot_occupants(&code);
        let standing = occ.iter().filter(|o| o.1 != "inbound" && o.1 != "parked at base").count();
        ui.label(format!(
            "{standing} plane{} for {} slots{}",
            if standing == 1 { "" } else { "s" },
            g.slot_count(&code),
            if standing as u32 >= g.slot_count(&code) { " · full" } else { "" }
        ));
        for (i, how) in &occ {
            let p = &g.state.planes[*i];
            ui.label(format!("{} {} · {how}", Game::name_of(p), p.kind));
        }
        // ---------- today's plan, one row per slot ----------
        ui.add_space(6.0);
        ui.strong("Today's plan");
        let rows = slot_lanes(g, &code);
        day_bars(ui, g, &rows);
        // ---------- arrivals and departures ----------
        ui.add_space(6.0);
        ui.strong("Today's arrivals and departures");
        let mut moves: Vec<(i64, bool, String, String)> = Vec::new();
        for p in &g.state.planes {
            if !p.schedule.active {
                continue;
            }
            for l in &p.schedule.legs {
                if l.from == code {
                    moves.push((g.local_tod(&code, l.dep), true, format!("to {}", l.to), format!("{} {}", p.id, p.kind)));
                }
                if l.to == code {
                    let arr = l.dep + leg_block(&p.kind, &l.from, &l.to);
                    moves.push((g.local_tod(&code, arr), false, format!("from {}", l.from), format!("{} {}", p.id, p.kind)));
                }
            }
        }
        moves.sort();
        if moves.is_empty() {
            ui.weak("No timetabled flights here.");
        }
        egui::Grid::new("moves").striped(true).show(ui, |ui| {
            ui.weak("time (local)");
            ui.weak("");
            ui.weak("flight");
            ui.weak("aircraft");
            ui.end_row();
            for (t, dep, what, plane) in moves {
                ui.monospace(fmt_clock(t));
                ui.label(if dep { "🛫" } else { "🛬" });
                ui.label(what);
                ui.label(plane);
                ui.end_row();
            }
        });
        if show {
            self.select_airport(&code, true);
        }
        if let Some((k, c, holder)) = act {
            let g = self.game.as_mut().unwrap();
            let r = match k {
                0 => g.lease_slot(&code, Some(c)),
                1 => g.drop_slot(&code, Some(c)),
                _ => match g.make_slot_offer(&code, &holder, self.offer) {
                    Ok(true) => {
                        self.info(&ctx, "Accepted! The slot is yours.");
                        Ok(())
                    }
                    Ok(false) => Err("The airport turned your offer down. Try again tomorrow, with more money or a better reputation.".into()),
                    Err(e) => Err(e),
                },
            };
            self.say(&ctx, r);
        }
    }

    /// Timetables: the editor for one plane, every plane's day as bars, and the routes with their tickets.
    fn schedule(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let Some(g) = &mut self.game else { return };
        let d = data();
        ui.heading("Schedule");
        // ---------- timetable editor ----------
        let mut close = false;
        let mut result: Option<Result<(), String>> = None;
        let mut save: Option<(usize, Vec<Leg>, u32)> = None;
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
                    if ultra_capable(&p.kind) {
                        ui.checkbox(&mut dr.ultra, "🌏 Ultra long-haul").on_hover_text(
                            "The timetable repeats every few days: each flight leaves after the turnaround, the next morning \
                             where it would land in the night curfew. For flights longer than half a day.",
                        );
                    } else {
                        dr.ultra = false;
                    }
                    if dr.ultra && dr.days > 1 {
                        ui.weak(format!("Repeats every {} days.", dr.days));
                    }
                    ui.horizontal(|ui| {
                        ui.label("2. First departure");
                        let mut h = dr.first_dep / 60;
                        let mut m = dr.first_dep % 60;
                        ui.add(egui::DragValue::new(&mut h).range(0..=23).suffix(" h"));
                        ui.add(egui::DragValue::new(&mut m).range(0..=55).speed(0.3).suffix(" min"));
                        dr.first_dep = (h * 60 + (m / 5) * 5).rem_euclid(DAY);
                        if let Some(first) = dr.stops.first() {
                            ui.weak(format!("({} local at {first})", g.fmt_at(first, dr.first_dep)));
                        }
                        ui.label("loops");
                        ui.add(egui::DragValue::new(&mut dr.rounds).range(0..=12)).on_hover_text("0 = as many as fit into the day");
                    });
                    ui.horizontal(|ui| {
                        if ui.button("Build timetable").clicked() {
                            if dr.ultra {
                                dr.legs = g.build_long_timetable(&p.kind, &dr.stops, dr.first_dep, dr.rounds.max(1));
                                dr.days = cycle_days(&p.kind, &dr.legs);
                            } else {
                                dr.legs = g.build_timetable(&p.kind, &dr.stops, dr.first_dep, dr.rounds);
                                dr.days = 1;
                            }
                            if dr.legs.len() < 2 {
                                result = Some(Err("That route does not fit into one day (or needs at least 2 stops).".into()));
                            }
                        }
                        if ui.button("✨ Best start").on_hover_text("Tries every start time and takes the one with the most flights, no slot clashes and the best result").clicked() {
                            match best_start(g, i, &dr.stops, dr.rounds, dr.ultra) {
                                Some((dep, legs, days)) => {
                                    dr.first_dep = dep;
                                    dr.legs = legs;
                                    dr.days = days;
                                }
                                None => result = Some(Err("That route does not fit into one day.".into())),
                            }
                        }
                    });
                    if !dr.legs.is_empty() {
                        ui.label("3. Flights (local times at each airport; move one with − / +):");
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
                                    ui.monospace(g.fmt_leg_dep(&leg.from, leg.dep, dr.days));
                                    if ui.small_button("+").clicked() {
                                        shift = Some((k, 5));
                                    }
                                });
                                ui.label(format!("{}→{}", leg.from, leg.to));
                                ui.monospace(g.fmt_leg_dep(&leg.to, leg.dep + block, dr.days));
                                ui.label(format!("{pax}/{}", ac.seats));
                                ui.label(RichText::new(fmt_money(*res)).color(money_color(*res)));
                                ui.end_row();
                            }
                        });
                        if let Some((k, by)) = shift {
                            dr.legs[k].dep = if dr.days > 1 { (dr.legs[k].dep + by).max(0) } else { (dr.legs[k].dep + by).rem_euclid(DAY) };
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
                        for e in g.check_timetable(i, &dr.legs, dr.days) {
                            ui.colored_label(Color32::LIGHT_RED, format!("✖ {e}"));
                        }
                        for (code, have, need) in g.timetable_slots(i, &dr.legs, dr.days) {
                            ui.colored_label(Color32::from_rgb(255, 200, 90), format!(
                                "⚠ {code}: {need} of your planes stand there at once, you hold {have} slot{} – one waits at its gate.",
                                if have == 1 { "" } else { "s" }
                            ));
                        }
                    }
                    ui.horizontal(|ui| {
                        if ui.add_enabled(dr.legs.len() >= 2, egui::Button::new("✔ Save and start")).clicked() {
                            save = Some((i, dr.legs.clone(), dr.days));
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
        if let (Some((i, legs, days)), Some(g)) = (save, &mut self.game) {
            let r = g.set_timetable(i, legs, days).and_then(|_| g.set_schedule_active(i, true));
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
        ui.weak("Click a plane to plan its day. Blue = flying · grey = on the ground (in one of your slots). The bars run on your \n                 home base's clock; times written out are local at each airport, and so is its night curfew (no departures \n                 22:00–06:00).");
        if let Some(k) = day_bars(ui, g, &plane_rows(g)) {
            self.open_draft(k);
        }
        let Some(g) = &mut self.game else { return };
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
                    ui.label(format!("{} from {} · {} flights", p.schedule.stops.join("–"), g.fmt_at(&first.from, first.dep), p.schedule.legs.len()));
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
        let year = g.year();
        if let (Some(y), Some((ny, types))) = (year, g.next_arrival()) {
            let names: Vec<String> = types.iter().map(|t| d.ac(t).name.clone()).collect();
            ui.weak(format!("{y}: the types built this year. Next new: the {} in {ny}.", name_list(&names)));
        }
        let mut list: Vec<&flightgame::data::Aircraft> = d
            .aircraft
            .iter()
            .filter(|a| (self.market_cat.is_empty() || a.category == self.market_cat) && on_sale(&a.code, year))
            .collect();
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

    /// Finance as in the browser game: balance, weekly fixed costs, today, charts of cash (with the bankruptcy line),
    /// revenue against costs and the daily result, and the history by day.
    fn finance(&mut self, ui: &mut egui::Ui) {
        let Some(g) = &self.game else { return };
        let s = &g.state;
        ui.heading("Finance");
        ui.label(RichText::new(format!("Balance: {}", fmt_money(s.money))).size(20.0).color(money_color(s.money)));
        ui.weak(format!("Bankrupt below {}", fmt_money(g.bankruptcy_limit())));
        let (planes, crews, slots, total) = g.weekly_costs();
        let next_monday = (s.time.div_euclid(DAY) / 7 + 1) * 7 * DAY;
        ui.add_space(4.0);
        ui.strong(format!("Weekly fixed costs (next charge {})", fmt_time(next_monday)));
        egui::Grid::new("fin").striped(true).show(ui, |ui| {
            for (l, v) in [("Aircraft leases", planes), ("Crew salaries", crews), ("Slot fees", slots)] {
                ui.label(l);
                ui.label(fmt_money(v));
                ui.end_row();
            }
            ui.label(RichText::new("Total").strong());
            ui.label(RichText::new(fmt_money(total)).strong());
            ui.end_row();
        });
        ui.add_space(4.0);
        ui.strong("Today so far");
        let t = &s.today;
        ui.label(format!(
            "{} flights · {} pax · revenue {} · costs {} → {}",
            t.flights,
            t.pax,
            fmt_money(t.revenue),
            fmt_money(t.cost + t.fixed),
            fmt_money(t.revenue - t.cost - t.fixed)
        ));
        // the days, oldest first, with today so far at the end
        let mut days: Vec<DayRecord> = s.history.iter().rev().cloned().collect();
        days.push(DayRecord {
            day: s.time.div_euclid(DAY),
            revenue: t.revenue,
            cost: t.cost,
            fixed: t.fixed,
            flights: t.flights,
            pax: t.pax,
            cash: s.money,
        });
        ui.add_space(6.0);
        ui.strong("Cash balance");
        line_chart(ui, &days.iter().map(|d| d.cash).collect::<Vec<_>>(), Some(g.bankruptcy_limit()), Color32::from_rgb(10, 132, 255));
        ui.strong("Revenue vs costs per day");
        pair_bars(ui, &days.iter().map(|d| (d.revenue, d.cost + d.fixed)).collect::<Vec<_>>());
        ui.strong("Daily result");
        result_bars(ui, &days.iter().map(|d| d.revenue - d.cost - d.fixed).collect::<Vec<_>>());
        ui.weak("Costs include the weekly fixed charges. Hover a chart for its values.");
        ui.add_space(6.0);
        let (rep, parts) = g.reputation(None);
        ui.strong(format!("Reputation {rep:.0}/100"));
        ui.weak(parts.iter().map(|(l, v)| format!("{l} {v:+.0}")).collect::<Vec<_>>().join(" · "));
        let effects: Vec<&Effect> = g.active_effects().collect();
        if !effects.is_empty() {
            ui.add_space(6.0);
            ui.strong("Going on now");
            for e in effects {
                ui.label(format!("• {} (until {})", e.label, fmt_time(e.until)));
            }
        }
        ui.add_space(6.0);
        ui.strong("History");
        egui::Grid::new("history").striped(true).show(ui, |ui| {
            for h in ["Day", "flights", "pax", "operating", "fixed"] {
                ui.weak(h);
            }
            ui.end_row();
            for d in &s.history {
                ui.label(format!("Day {} ({})", d.day + 1, WEEKDAYS[d.day.rem_euclid(7) as usize]));
                ui.label(d.flights.to_string());
                ui.label(d.pax.to_string());
                ui.label(RichText::new(fmt_money(d.revenue - d.cost)).color(money_color(d.revenue - d.cost)));
                ui.label(if d.fixed > 0.0 { fmt_money(-d.fixed) } else { String::new() });
                ui.end_row();
            }
        });
    }

    /// Rivals as in the browser game: your routes with competition first, then every airline.
    fn rivals(&mut self, ui: &mut egui::Ui) {
        let Some(g) = &self.game else { return };
        let d = data();
        ui.heading("Rivals");
        ui.label(format!(
            "{} airlines compete with you. On a route you share, passengers split by the seats each airline offers and its \
             ticket price – add flights or cut your fare to win them. Every Monday they react: more flights on full routes, \
             lower fares where you take their passengers, new routes (sometimes yours).",
            g.state.rivals.len()
        ));
        let mine: Vec<(String, String)> = g
            .player_routes()
            .into_iter()
            .filter(|(a, b, _, _)| !g.rivals_on(a, b).is_empty())
            .map(|(a, b, _, _)| (a, b))
            .collect();
        let mut change = None;
        if !mine.is_empty() {
            ui.add_space(4.0);
            ui.strong("Your routes with competition");
            egui::Grid::new("compete").striped(true).show(ui, |ui| {
                for h in ["Route", "you", "rivals", "your ticket"] {
                    ui.weak(h);
                }
                ui.end_row();
                for (a, b) in &mine {
                    ui.label(format!("{a}–{b}"));
                    ui.label(format!("{:.0}%", g.market_share(a, b, 0.0) * 100.0));
                    ui.horizontal(|ui| {
                        for (r, k) in g.rivals_on(a, b) {
                            let rv = &g.state.rivals[r];
                            let rt = &rv.routes[k];
                            ui.colored_label(hex(&rv.color), format!("{}× {:.0}%", rt.per_day, rt.fare * 100.0)).on_hover_text(&rv.name);
                        }
                    });
                    ui.horizontal(|ui| {
                        if ui.small_button("−").clicked() {
                            change = Some((a.clone(), b.clone(), -1));
                        }
                        ui.label(format!("{} {:.0}%", fmt_money(g.fare(a, b)), g.fare_factor(a, b) * 100.0));
                        if ui.small_button("+").clicked() {
                            change = Some((a.clone(), b.clone(), 1));
                        }
                    });
                    ui.end_row();
                }
            });
        }
        ui.add_space(6.0);
        for r in &g.state.rivals {
            let kind = match r.kind.as_str() {
                "flag" => "flag carrier",
                "low" => "low-cost",
                _ => "regional",
            };
            let flights: u32 = r.routes.iter().map(|x| x.per_day * 2).sum();
            let yours = r.routes.iter().filter(|rt| mine.iter().any(|(a, b)| route_key(a, b) == route_key(&rt.a, &rt.b))).count();
            egui::CollapsingHeader::new(RichText::new(format!("■ {}  {kind}", r.name)).color(hex(&r.color)).strong())
                .id_salt(&r.id)
                .show(ui, |ui| {
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
            ui.weak(format!(
                "   Hub{} {} · {} routes · {flights} flights a day{}",
                if r.hubs.len() == 1 { "" } else { "s" },
                r.hubs.join(", "),
                r.routes.len(),
                if yours > 0 { format!(" · {yours} on your routes") } else { String::new() }
            ));
        }
        if let Some((a, b, s)) = change {
            self.game.as_mut().unwrap().change_fare(&a, &b, s);
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
                let now = g.state.time;
                let sun = match sun_times(&code, now) {
                    Some((rise, set)) => format!(" · sunrise {rise}, sunset {set}"),
                    None => String::new(),
                };
                ui.label(format!("🕒 {} local ({}){sun}", g.fmt_at(&code, now), fmt_zone(&code, now)));
                let wx = g.airport_weather(&code);
                ui.label(format!(
                    "{} {} {}°C · wind {:03}° {} kt{}",
                    wx.icon,
                    wx.name,
                    wx.temp_c,
                    wx.wind_from,
                    wx.wind_kt,
                    if wx.gust_kt > 0 { format!(", gusts {} kt", wx.gust_kt) } else { String::new() }
                ));
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
                let free = g.free_slots(&code, None);
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
                // ---------- shares and construction ----------
                ui.separator();
                let st = g.stake(&code);
                ui.strong(format!("Shares · you own {st}%"));
                ui.weak(format!(
                    "{:.0}k passengers a year · profit {}/week · value {} · your dividend {}/week",
                    g.airport_pax_year(&code) / 1000.0,
                    fmt_money(g.airport_profit(&code)),
                    fmt_money(g.airport_value(&code)),
                    fmt_money(g.dividend(&code))
                ));
                ui.horizontal(|ui| {
                    if st < 100 && ui.small_button(format!("Buy {SHARE_STEP}% ({})", fmt_money(g.share_price(&code, SHARE_STEP)))).clicked() {
                        action = Some((3, String::new()));
                    }
                    if st > 0 && ui.small_button(format!("Sell {SHARE_STEP}% ({})", fmt_money(g.share_sale(&code, SHARE_STEP)))).clicked() {
                        action = Some((4, String::new()));
                    }
                });
                ui.weak(format!(
                    "From {BOARD_STAKE}% you can order construction, from {MAJORITY_STAKE}% your slots there cost nothing."
                ));
                for p in g.state.projects.iter().filter(|p| p.code == code) {
                    let frac = (g.state.time - p.start) as f32 / (p.done - p.start).max(1) as f32;
                    ui.add(egui::ProgressBar::new(frac).text(format!("{} – ready {}", p.label, fmt_time(p.done))));
                }
                if st >= BOARD_STAKE {
                    ui.collapsing("Construction", |ui| {
                        for o in g.project_options(&code) {
                            ui.horizontal(|ui| {
                                let r = ui.add_enabled(
                                    o.err.is_none(),
                                    egui::Button::new(format!("{} · {} · {} weeks", o.label, fmt_money(o.cost), o.weeks)).small(),
                                );
                                let r = match &o.err {
                                    Some(e) => r.on_disabled_hover_text(e),
                                    None => r.on_hover_text(format!("Whole cost {}, your share {}", fmt_money(o.full), fmt_money(o.cost))),
                                };
                                if r.clicked() {
                                    action = Some((5, format!("{}|{}", o.kind, o.len)));
                                }
                            });
                        }
                    });
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
                0 => g.lease_slot(&code, None),
                1 => g.drop_slot(&code, None),
                3 => g.buy_shares(&code, SHARE_STEP),
                4 => g.sell_shares(&code, SHARE_STEP),
                5 => {
                    let (kind, len) = holder.split_once('|').unwrap_or(("", "0"));
                    g.start_project(&code, kind, len.parse().unwrap_or(0.0))
                }
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
        self.selftest_tick(&ctx);
        if self.game.is_none() {
            self.start_screen(ui);
            return;
        }
        // keys
        if !ctx.egui_wants_keyboard_input() && self.selftest.is_none() {
            ctx.input(|i| {
                if i.key_pressed(egui::Key::M) {
                    self.sound.toggle();
                }
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

        // ---------- the map ----------
        let mut picked = None;
        let mut listener = self.listener;
        egui::CentralPanel::no_frame().show(ui, |ui| {
            let Some(g) = &self.game else { return };
            let tiles: &mut dyn walkers::Tiles = match self.map_style {
                1 => &mut self.tiles_dark,
                2 => &mut self.tiles_light,
                _ => &mut self.tiles_sat,
            };
            let home = data().airport(g.home());
            let (t, selected, layers) = (self.t, self.selected, &self.layers);
            Map::new(Some(tiles), &mut self.map, lat_lon(home.lat, home.lon)).show(ui, |ui, response, projector, _memory| {
                let (_, clicked) = mapview::draw(ui, response, projector, g, t, selected, layers);
                let c = projector.unproject(response.rect.center().to_vec2());
                let mpp = 1.0 / projector.scale_pixel_per_meter(c).max(1e-9) as f64;
                listener = (c.y(), c.x(), mpp * 60.0);
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
        // ---------- sound ----------
        self.listener = listener;
        if let Some(g) = &self.game {
            let running = !self.paused && !g.state.game_over && g.state.news.is_empty();
            let (lat, lon, h) = self.listener;
            self.sound.update(g, self.t, lat, lon, h, SPEEDS[self.speed], running);
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
                // the browser game's "European network" quick start
                let pr = data().presets.iter().find(|p| p.id == "europe").cloned();
                let Some(pr) = pr else { return };
                let (mut g, errors) = Game::from_preset(&pr);
                let mut report = vec![format!("quick start europe: {} planes, problems {errors:?}", g.state.planes.len())];
                report.push(format!("lease a slot at LIS: {:?}", g.lease_slot("LIS", None)));
                report.push(format!("ZRH slots: {} ({} free)", g.slot_capacity("ZRH"), g.free_slots("ZRH", None)));
                let _ = std::fs::write(dir.join("report.txt"), report.join("\n"));
                self.start(g);
                self.newspapers = false;
                self.speed = 3;
                self.section = Some(Section::Schedule);
                self.open_draft(1);
                next(self, 8.0);
            }
            1 => {
                shot("1-schedule.png");
                next(self, 1.0);
            }
            2 => {
                self.draft = None;
                self.section = Some(Section::Slots);
                self.select_airport("ZRH", false);
                next(self, 4.0);
            }
            3 => {
                shot("2-slots-airport.png");
                next(self, 1.0);
            }
            4 => {
                self.speed = 5;
                self.section = Some(Section::Finance);
                self.select_plane(0);
                next(self, 8.0);
            }
            5 => {
                shot("3-finance-plane.png");
                next(self, 1.0);
            }
            6 => {
                self.section = Some(Section::Fleet);
                self.map_style = 1;
                self.selected = None;
                next(self, 5.0);
            }
            7 => {
                shot("4-fleet-dark.png");
                next(self, 1.5);
            }
            8 => {
                // Zurich from close up: its real layout, at night and in the clouds
                self.section = None;
                self.map_style = 0;
                let a = data().airport("ZRH");
                self.map.center_at(lat_lon(a.lat, a.lon));
                let _ = self.map.set_zoom(14.0);
                self.speed = 2;
                next(self, 6.0);
            }
            9 => {
                shot("5-zurich-close.png");
                next(self, 1.0);
            }
            10 => {
                self.section = Some(Section::Airports);
                let _ = self.map.set_zoom(4.0);
                self.select_airport("ZRH", false);
                if let Some(g) = self.game.as_mut() {
                    g.state.money += 1e9;
                    let _ = g.buy_shares("ZRH", 30);
                }
                next(self, 4.0);
            }
            11 => {
                shot("6-world-shares.png");
                next(self, 1.0);
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
                    ) + &format!(
                        "
all planes: {} flights · emergencies {} · incidents {}",
                        g.state.planes.iter().map(|p| p.stats.flights).sum::<u32>(),
                        g.state.log.iter().filter(|l| l.msg.contains("MAYDAY")).count(),
                        g.state.planes.iter().map(|p| p.stats.incidents).sum::<u32>()
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

// ---------- day bars (Slots and Schedule) ----------

/// One stretch of a day bar: [from, to) minutes of the day on the home base's clock.
struct Seg {
    from: i64,
    to: i64,
    color: Color32,
    text: String,
}

/// One row of day bars: its label, its stretches, red when it is more than you have (a slot too few).
struct Row {
    label: String,
    segs: Vec<Seg>,
    over: bool,
}

/// Splits [from, to) at midnight into stretches of the day.
fn day_spans(from: i64, to: i64) -> Vec<(i64, i64)> {
    let (a, len) = (from.rem_euclid(DAY), (to - from).clamp(0, DAY));
    if a + len <= DAY { vec![(a, a + len)] } else { vec![(a, DAY), (0, a + len - DAY)] }
}

const FLYING: Color32 = Color32::from_rgb(10, 132, 255);
const GROUND: Color32 = Color32::from_rgb(120, 126, 138);

/// An airport's slots over today: a row per slot of yours, each plane's stays put into the first one free for
/// the whole stay; stays that find none go into red rows beyond yours.
fn slot_lanes(g: &Game, code: &str) -> Vec<Row> {
    let mut uses: Vec<(i64, i64, String, bool)> = Vec::new(); // from, to, plane, idle all day
    for p in &g.state.planes {
        if p.schedule.active && !p.schedule.legs.is_empty() {
            for (from, to) in ground_times(&p.kind, &p.schedule.legs, code, p.schedule.days) {
                uses.push((from, to, p.id.clone(), false));
            }
        } else {
            let at = p.flight.as_ref().map(|f| f.to.as_str()).unwrap_or(&p.location);
            if at == code && !g.parks_at_base(p, code) {
                uses.push((0, DAY, p.id.clone(), true));
            }
        }
    }
    uses.sort_by_key(|u| (u.3, u.0, -u.1));
    let have = g.slot_count(code) as usize;
    let mut ends: Vec<i64> = vec![0; have];
    let mut rows: Vec<Row> = (0..have).map(|k| Row { label: format!("Slot {}", k + 1), segs: Vec::new(), over: false }).collect();
    for (from, to, id, _) in uses {
        let k = match ends.iter().position(|&e| e <= from) {
            Some(k) => k,
            None => {
                ends.push(0);
                rows.push(Row { label: "too few".into(), segs: Vec::new(), over: true });
                ends.len() - 1
            }
        };
        ends[k] = to;
        let color = if rows[k].over { Color32::from_rgb(220, 70, 60) } else { GROUND };
        rows[k].segs.push(Seg { from, to, color, text: id });
    }
    rows
}

/// Each plane's day: flying in blue, on the ground in grey with the airport.
fn plane_rows(g: &Game) -> Vec<Row> {
    let mut rows = Vec::new();
    for p in &g.state.planes {
        let mut segs = Vec::new();
        let legs = &p.schedule.legs;
        for l in legs {
            let b = leg_block(&p.kind, &l.from, &l.to);
            for (a, z) in day_spans(l.dep, l.dep + b) {
                segs.push(Seg { from: a, to: z, color: FLYING, text: format!("{}›{}", l.from, l.to) });
            }
        }
        let mut codes: Vec<&String> = legs.iter().map(|l| &l.to).collect();
        codes.sort();
        codes.dedup();
        for code in codes {
            for (a, z) in ground_times(&p.kind, legs, code, p.schedule.days) {
                segs.push(Seg { from: a, to: z, color: GROUND, text: code.clone() });
            }
        }
        if legs.is_empty() {
            segs.push(Seg { from: 0, to: DAY, color: GROUND.gamma_multiply(0.6), text: p.location.clone() });
        }
        let dot = if legs.is_empty() { "" } else if p.schedule.active { " ●" } else { " ⏸" };
        rows.push(Row { label: format!("{}{dot}\n{}", Game::name_of(p), p.kind), segs, over: false });
    }
    rows
}

/// Draws rows of day bars over 24 hours (the home base's clock), with the hours on top and a line at the time now.
fn day_bars(ui: &mut egui::Ui, g: &Game, rows: &[Row]) -> Option<usize> {
    let label_w = 90.0;
    let row_h = 22.0;
    let w = ui.available_width().max(240.0);
    let h = 16.0 + rows.len() as f32 * row_h;
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(w, h), egui::Sense::click());
    let painter = ui.painter_at(rect);
    let x0 = rect.left() + label_w;
    let span = (rect.right() - x0).max(1.0);
    let x = |m: i64| x0 + span * m as f32 / DAY as f32;
    let font = egui::FontId::proportional(10.0);
    for hh in (0..=24).step_by(3) {
        let xx = x(hh * 60);
        painter.text(egui::pos2(xx, rect.top()), Align2::CENTER_TOP, format!("{hh:02}"), font.clone(), Color32::GRAY);
        painter.line_segment([egui::pos2(xx, rect.top() + 12.0), egui::pos2(xx, rect.bottom())], Stroke::new(0.5, Color32::from_gray(60)));
    }
    let mut clicked = None;
    for (k, r) in rows.iter().enumerate() {
        let y = rect.top() + 16.0 + k as f32 * row_h;
        painter.text(
            egui::pos2(rect.left(), y + row_h / 2.0),
            Align2::LEFT_CENTER,
            &r.label,
            egui::FontId::proportional(9.5),
            if r.over { Color32::from_rgb(255, 120, 110) } else { Color32::from_gray(210) },
        );
        for s in &r.segs {
            let bar = egui::Rect::from_min_max(egui::pos2(x(s.from), y + 3.0), egui::pos2(x(s.to).max(x(s.from) + 1.0), y + row_h - 3.0));
            painter.rect_filled(bar, 3.0, s.color);
            if bar.width() > 34.0 {
                painter.text(bar.center(), Align2::CENTER_CENTER, &s.text, font.clone(), Color32::WHITE);
            }
        }
        if resp.clicked() && resp.interact_pointer_pos().is_some_and(|p| p.y >= y && p.y < y + row_h) {
            clicked = Some(k);
        }
    }
    let now = x(g.state.time.rem_euclid(DAY));
    painter.line_segment([egui::pos2(now, rect.top() + 12.0), egui::pos2(now, rect.bottom())], Stroke::new(1.5, Color32::from_rgb(255, 69, 58)));
    clicked
}

/// The ✨ button: tries every start time (5 minutes apart) and takes the one with no errors, the most flights, no
/// slot clashes and the best result.
fn best_start(g: &Game, i: usize, stops: &[String], rounds: usize, ultra: bool) -> Option<(i64, Vec<Leg>, u32)> {
    let kind = g.state.planes[i].kind.clone();
    let mut best: Option<((bool, usize, i64, i64), i64, Vec<Leg>, u32)> = None;
    for dep in (0..DAY).step_by(5) {
        let legs = if ultra { g.build_long_timetable(&kind, stops, dep, rounds.max(1)) } else { g.build_timetable(&kind, stops, dep, rounds) };
        let days = if ultra { cycle_days(&kind, &legs) } else { 1 };
        if legs.len() < 2 {
            continue;
        }
        let ok = g.check_timetable(i, &legs, days).is_empty();
        let clashes = g.timetable_slots(i, &legs, days).len() as i64;
        let profit = g.estimate_timetable(i, &legs).profit.round() as i64;
        let score = (ok, legs.len(), -clashes, profit);
        if best.as_ref().is_none_or(|b| score > b.0) {
            best = Some((score, dep, legs, days));
        }
    }
    best.map(|(_, dep, legs, days)| (dep, legs, days))
}

// ---------- finance charts ----------

fn chart_rect(ui: &mut egui::Ui) -> (egui::Rect, egui::Response, egui::Painter) {
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 110.0), egui::Sense::hover());
    let painter = ui.painter_at(rect);
    painter.rect_filled(rect, 4.0, Color32::from_gray(25));
    (rect, resp, painter)
}

fn hover_index(resp: &egui::Response, rect: egui::Rect, n: usize) -> Option<usize> {
    let m = resp.hover_pos()?;
    let k = ((m.x - rect.left()) / rect.width() * n as f32) as usize;
    (k < n).then_some(k)
}

/// A line over the days (cash), with a dashed line at `limit` (the bankruptcy limit).
fn line_chart(ui: &mut egui::Ui, values: &[f64], limit: Option<f64>, color: Color32) {
    let (rect, resp, painter) = chart_rect(ui);
    let n = values.len().max(1);
    let lo = values.iter().copied().chain(limit).fold(0.0, f64::min);
    let hi = values.iter().copied().fold(1.0, f64::max);
    let y = |v: f64| rect.bottom() - 8.0 - ((v - lo) / (hi - lo).max(1.0)) as f32 * (rect.height() - 16.0);
    let w = rect.width() / n as f32;
    let small = egui::FontId::proportional(10.0);
    if let Some(l) = limit {
        let yy = y(l);
        let mut xx = rect.left();
        while xx < rect.right() {
            painter.line_segment([egui::pos2(xx, yy), egui::pos2((xx + 6.0).min(rect.right()), yy)], Stroke::new(1.0, Color32::from_rgb(255, 105, 97)));
            xx += 10.0;
        }
        painter.text(egui::pos2(rect.right() - 4.0, yy - 2.0), Align2::RIGHT_BOTTOM, "Bankruptcy", small.clone(), Color32::from_rgb(255, 105, 97));
    }
    painter.line_segment([egui::pos2(rect.left(), y(0.0)), egui::pos2(rect.right(), y(0.0))], Stroke::new(0.5, Color32::from_gray(80)));
    let pts: Vec<egui::Pos2> = values.iter().enumerate().map(|(k, &v)| egui::pos2(rect.left() + (k as f32 + 0.5) * w, y(v))).collect();
    if pts.len() == 1 {
        painter.circle_filled(pts[0], 3.0, color);
    } else {
        painter.add(egui::Shape::line(pts, Stroke::new(2.0, color)));
    }
    painter.text(rect.left_top() + Vec2::new(4.0, 2.0), Align2::LEFT_TOP, fmt_money(hi), small.clone(), Color32::GRAY);
    painter.text(rect.left_bottom() + Vec2::new(4.0, -2.0), Align2::LEFT_BOTTOM, fmt_money(lo), small, Color32::GRAY);
    if let Some(k) = hover_index(&resp, rect, n) {
        resp.on_hover_text(format!("{}: {}", day_name(values.len(), k), fmt_money(values[k])));
    }
}

fn day_name(n: usize, k: usize) -> String {
    if k + 1 == n { "Today so far".into() } else { format!("{} days ago", n - 1 - k) }
}

/// Revenue (green) and costs (red) side by side for each day.
fn pair_bars(ui: &mut egui::Ui, values: &[(f64, f64)]) {
    let (rect, resp, painter) = chart_rect(ui);
    let n = values.len().max(1);
    let max = values.iter().map(|v| v.0.max(v.1)).fold(1.0, f64::max);
    let w = rect.width() / n as f32;
    for (k, (r, c)) in values.iter().enumerate() {
        let x = rect.left() + k as f32 * w;
        for (j, (v, col)) in [(r, Color32::from_rgb(90, 200, 120)), (c, Color32::from_rgb(230, 90, 80))].iter().enumerate() {
            let h = (**v / max) as f32 * (rect.height() - 10.0);
            let x0 = x + 1.0 + j as f32 * (w - 2.0) / 2.0;
            let bar = egui::Rect::from_min_max(egui::pos2(x0, rect.bottom() - 4.0 - h), egui::pos2(x0 + ((w - 2.0) / 2.0).max(1.0), rect.bottom() - 4.0));
            painter.rect_filled(bar, 1.0, *col);
        }
    }
    if let Some(k) = hover_index(&resp, rect, n) {
        resp.on_hover_text(format!("{}: revenue {}, costs {}", day_name(values.len(), k), fmt_money(values[k].0), fmt_money(values[k].1)));
    }
}

/// Each day's result as a bar up (profit) or down (loss).
fn result_bars(ui: &mut egui::Ui, values: &[f64]) {
    let (rect, resp, painter) = chart_rect(ui);
    let n = values.len().max(1);
    let max = values.iter().map(|v| v.abs()).fold(1.0, f64::max);
    let w = rect.width() / n as f32;
    let mid = rect.center().y;
    for (k, &v) in values.iter().enumerate() {
        let h = (v / max) as f32 * (rect.height() / 2.0 - 6.0);
        let x = rect.left() + k as f32 * w;
        painter.rect_filled(egui::Rect::from_two_pos(egui::pos2(x + 1.0, mid), egui::pos2(x + w - 1.0, mid - h)), 1.0, money_color(v));
    }
    painter.line_segment([egui::pos2(rect.left(), mid), egui::pos2(rect.right(), mid)], Stroke::new(0.5, Color32::from_gray(80)));
    if let Some(k) = hover_index(&resp, rect, n) {
        resp.on_hover_text(format!("{}: {}", day_name(values.len(), k), fmt_money(values[k])));
    }
}
