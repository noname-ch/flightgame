//! The browser game's five styles (js/themes.js), as egui looks: Night, Tycoon, Metropolis, Pixel, Departure board;
//! and the settings kept between games (`settings.json` beside the save).

use eframe::egui::{self, Color32, CornerRadius, FontFamily, FontId, Stroke, TextStyle};
use serde::{Deserialize, Serialize};

pub struct Theme {
    pub id: &'static str,
    pub name: &'static str,
    pub desc: &'static str,
    /// background, panels, accent, text
    pub swatch: [&'static str; 4],
}

pub const THEMES: [Theme; 5] = [
    Theme { id: "night", name: "Night", desc: "The classic dark look.", swatch: ["#0b0f15", "#131a24", "#ef4444", "#e5e7eb"] },
    Theme {
        id: "tycoon",
        name: "Tycoon",
        desc: "Bevelled grey windows and a toolbar along the top, like a 90s transport tycoon.",
        swatch: ["#a8a49c", "#5c4630", "#e8b020", "#1c1a16"],
    },
    Theme {
        id: "metropolis",
        name: "Metropolis",
        desc: "Light frosted panels and a round dock at the bottom, like a modern city builder.",
        swatch: ["#eef3f8", "#ffffff", "#2f8fe8", "#1d2733"],
    },
    Theme {
        id: "pixel",
        name: "Pixel",
        desc: "Chunky pixel art with hard outlines and a tool palette, like a sprite editor.",
        swatch: ["#181425", "#3a4466", "#feae34", "#63c74d"],
    },
    Theme { id: "board", name: "Departure board", desc: "Black and airport-sign yellow, with flip-board numbers.", swatch: ["#0a0a0a", "#1a1a1a", "#ffcc00", "#f2f2f2"] },
];

fn c(h: &str) -> Color32 {
    Color32::from_hex(h).unwrap_or(Color32::GRAY)
}

/// Gives the window a style's look.
pub fn apply(ctx: &egui::Context, id: &str) {
    let t = THEMES.iter().find(|t| t.id == id).unwrap_or(&THEMES[0]);
    let [bg, panel, accent, text] = t.swatch.map(c);
    let light = matches!(id, "tycoon" | "metropolis");
    LIGHT.store(light, std::sync::atomic::Ordering::Relaxed);
    let mut v = if light { egui::Visuals::light() } else { egui::Visuals::dark() };
    v.panel_fill = if id == "tycoon" { bg } else { panel };
    v.window_fill = if id == "tycoon" { bg } else if light { panel } else { panel };
    v.extreme_bg_color = if light { Color32::from_gray(250) } else { bg };
    v.faint_bg_color = if light { Color32::from_black_alpha(10) } else { Color32::from_white_alpha(8) };
    v.override_text_color = Some(text);
    v.selection.bg_fill = accent.gamma_multiply(if light { 0.8 } else { 0.55 });
    v.selection.stroke = Stroke::new(1.0, if id == "board" || id == "pixel" { Color32::BLACK } else { Color32::WHITE });
    v.hyperlink_color = accent;
    let radius = match id {
        "metropolis" => 14,
        "night" => 6,
        _ => 0,
    };
    v.window_corner_radius = CornerRadius::same(radius);
    v.menu_corner_radius = CornerRadius::same(radius);
    for w in [&mut v.widgets.noninteractive, &mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
        w.corner_radius = CornerRadius::same(radius.min(8));
    }
    match id {
        "tycoon" => {
            // bevelled: light top-left edges, dark bottom-right (as near as egui gets: a strong frame)
            v.window_stroke = Stroke::new(2.0, Color32::from_rgb(232, 228, 220));
            v.widgets.inactive.bg_fill = Color32::from_rgb(196, 192, 184);
            v.widgets.inactive.weak_bg_fill = Color32::from_rgb(196, 192, 184);
            v.widgets.inactive.bg_stroke = Stroke::new(1.0, Color32::from_rgb(92, 70, 48));
            v.widgets.hovered.weak_bg_fill = Color32::from_rgb(220, 214, 200);
            v.widgets.active.weak_bg_fill = accent;
        }
        "metropolis" => {
            v.window_stroke = Stroke::new(1.0, Color32::from_rgb(210, 222, 236));
            v.widgets.inactive.weak_bg_fill = Color32::from_rgb(228, 236, 245);
            v.widgets.hovered.weak_bg_fill = Color32::from_rgb(214, 228, 244);
        }
        "pixel" => {
            v.window_stroke = Stroke::new(2.0, Color32::BLACK);
            v.widgets.inactive.weak_bg_fill = Color32::from_rgb(58, 68, 102);
            v.widgets.inactive.bg_stroke = Stroke::new(2.0, Color32::BLACK);
            v.widgets.hovered.weak_bg_fill = Color32::from_rgb(38, 92, 66);
            v.widgets.active.weak_bg_fill = accent;
        }
        "board" => {
            v.window_stroke = Stroke::new(1.0, Color32::from_rgb(60, 60, 60));
            v.widgets.inactive.weak_bg_fill = Color32::from_rgb(34, 34, 34);
            v.widgets.hovered.weak_bg_fill = Color32::from_rgb(60, 50, 0);
            v.widgets.active.weak_bg_fill = accent;
        }
        _ => {}
    }
    ctx.set_visuals_of(if light { egui::Theme::Light } else { egui::Theme::Dark }, v);
    ctx.set_theme(if light { egui::ThemePreference::Light } else { egui::ThemePreference::Dark });
    // pixel and the departure board write in a fixed-width face (the flip-board numbers)
    let mono = matches!(id, "pixel" | "board");
    ctx.all_styles_mut(|s| {
        let fam = if mono { FontFamily::Monospace } else { FontFamily::Proportional };
        s.text_styles.insert(TextStyle::Body, FontId::new(if mono { 13.0 } else { 14.0 }, fam.clone()));
        s.text_styles.insert(TextStyle::Button, FontId::new(if mono { 13.0 } else { 14.0 }, fam.clone()));
        s.text_styles.insert(TextStyle::Heading, FontId::new(20.0, fam.clone()));
        s.text_styles.insert(TextStyle::Small, FontId::new(10.5, fam));
    });
}

/// What the window remembers between games.
#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    /// None: not picked yet (the first start asks)
    pub style: Option<String>,
    pub autosave: bool,
    pub volume: f32,
    pub map_style: u8,
    /// the developer tools' password, as a SHA-256 hash (None: not set yet, the first F2 sets it)
    pub dev_hash: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { style: None, autosave: true, volume: 0.7, map_style: 0, dev_hash: None }
    }
}

fn path() -> std::path::PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Flightgame").join("settings.json")
}

impl Settings {
    pub fn load() -> Settings {
        std::fs::read_to_string(path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }
    pub fn save(&self) {
        let p = path();
        let _ = std::fs::create_dir_all(p.parent().unwrap());
        let _ = std::fs::write(p, serde_json::to_string_pretty(self).unwrap_or_default());
    }
}

/// SHA-256 of a password with a fixed salt, as hex.
pub fn hash(password: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(b"flightgame-dev-tools:");
    h.update(password.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

static LIGHT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Is a light style (Tycoon, Metropolis) on?
pub fn is_light() -> bool {
    LIGHT.load(std::sync::atomic::Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    #[test]
    fn password_hash() {
        let h = super::hash("geheim");
        assert_eq!(h.len(), 64);
        assert_eq!(h, super::hash("geheim"));
        assert_ne!(h, super::hash("Geheim"));
    }
}
