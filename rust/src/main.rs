//! Flightgame – a native desktop version of the browser airline game, in Rust.
//! The simulation and data are in the library (`src/lib.rs`); this is the window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod checklist;
mod editor;
mod mapview;
mod pictures;
mod sound;
mod style;
mod synth;
mod view3d;

fn main() -> eframe::Result {
    // A crash (a panic) is written down, and the next start opens the bug report with it (as the browser game's
    // bug reports catch script errors).
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let path = app::crash_path();
        let _ = std::fs::create_dir_all(path.parent().unwrap());
        let text = format!("{info}\n\n{}", std::backtrace::Backtrace::force_capture());
        let _ = std::fs::write(path, text.lines().take(40).collect::<Vec<_>>().join("\n"));
        default_hook(info);
    }));
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title("Flightgame")
            .with_inner_size([1400.0, 860.0])
            .with_min_inner_size([900.0, 560.0]),
        // the 3D view needs a depth buffer and wgpu
        renderer: eframe::Renderer::Wgpu,
        depth_buffer: 24,
        ..Default::default()
    };
    eframe::run_native("Flightgame", options, Box::new(|cc| Ok(Box::new(app::App::new(cc)))))
}
