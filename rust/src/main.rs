//! Flightgame – a native desktop version of the browser airline game, in Rust.
//! The simulation and data are in the library (`src/lib.rs`); this is the window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod mapview;
mod pictures;
mod sound;
mod style;

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title("Flightgame")
            .with_inner_size([1400.0, 860.0])
            .with_min_inner_size([900.0, 560.0]),
        ..Default::default()
    };
    eframe::run_native("Flightgame", options, Box::new(|cc| Ok(Box::new(app::App::new(cc)))))
}
