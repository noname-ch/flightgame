//! Flightgame – a native desktop version of the browser airline game, in Rust.
//! The simulation and data are in the library (`src/lib.rs`); this is the window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod bevy3d;
mod checklist;
mod editor;
mod mapview;
mod pictures;
mod liveries;
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
        // the device with everything the adapter can do, as Bevy asks for its own (src/bevy3d.rs renders on it)
        wgpu_options: eframe::egui_wgpu::WgpuConfiguration {
            wgpu_setup: eframe::egui_wgpu::WgpuSetup::CreateNew(eframe::egui_wgpu::WgpuSetupCreateNew {
                device_descriptor: std::sync::Arc::new(|adapter| {
                    let mut features = adapter.features();
                    if adapter.get_info().device_type == eframe::wgpu::DeviceType::DiscreteGpu {
                        features.remove(eframe::wgpu::Features::MAPPABLE_PRIMARY_BUFFERS);
                    }
                    eframe::wgpu::DeviceDescriptor {
                        label: Some("flightgame"),
                        required_features: features,
                        required_limits: adapter.limits(),
                        // SAFETY: as Bevy's own device (bevy_render renderer/mod.rs)
                        experimental_features: unsafe { eframe::wgpu::ExperimentalFeatures::enabled() },
                        ..Default::default()
                    }
                }),
                ..eframe::egui_wgpu::WgpuSetupCreateNew::without_display_handle()
            }),
            ..Default::default()
        },
        ..Default::default()
    };
    eframe::run_native("Flightgame", options, Box::new(|cc| Ok(Box::new(app::App::new(cc)))))
}
