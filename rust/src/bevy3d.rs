//! The 3D view drawn by Bevy: the same scene as src/view3d.rs builds (the planes with every moving part posed,
//! the airports' buildings, the satellite ground, the clouds), lit by the sun with its shadows under a physically
//! based sky (Bevy's atmosphere: blue by day, red at dusk, dark at night), with haze, tone mapping and bloom.
//! Bevy runs on the window's own wgpu device (main.rs asks for the same device Bevy would), driven by hand a frame
//! at a time, and renders into a texture the egui window shows. Where it can't start, or with it switched off
//! (the ✨ button in the 3D view), the classic renderer of src/view3d.rs draws instead.

use crate::view3d::{Frame, GROUND_PX};
use bevy::app::{PluginGroup, SubApps};
use bevy::asset::RenderAssetUsages;
use bevy::camera::{Exposure, RenderTarget};
use bevy::core_pipeline::tonemapping::Tonemapping;
use bevy::light::atmosphere::ScatteringMedium;
use bevy::light::{Atmosphere, CascadeShadowConfigBuilder, light_consts::lux};
use bevy::mesh::{Indices, PrimitiveTopology};
use bevy::pbr::{AtmosphereSettings, DistanceFog, FogFalloff};
use bevy::post_process::bloom::Bloom;
use bevy::prelude as b;
use bevy::render::render_asset::RenderAssets;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use bevy::render::renderer::{RenderAdapter, RenderAdapterInfo, RenderDevice, RenderInstance, RenderQueue};
use bevy::render::settings::RenderCreation;
use bevy::render::texture::GpuImage;
use bevy::render::{RenderApp, RenderPlugin};
use bevy::window::{ExitCondition, WindowPlugin};
use eframe::{egui, egui_wgpu, wgpu};
use std::cell::RefCell;
use std::collections::HashMap;

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    static ON: RefCell<bool> = const { RefCell::new(true) };
}

/// What drawing a frame needs to keep.
struct State {
    apps: SubApps,
    rs: egui_wgpu::RenderState,
    /// the picture Bevy renders into: its image, size and egui's texture of it
    target: Option<(b::Handle<b::Image>, u32, u32, Option<egui::TextureId>)>,
    camera: b::Entity,
    sun: b::Entity,
    plane_mat: b::Handle<b::StandardMaterial>,
    planes: Vec<(b::Entity, b::Handle<b::Mesh>, String)>,
    build_mat: b::Handle<b::StandardMaterial>,
    /// walls with bands of windows (lit at night), ribbed walls
    windows_mat: b::Handle<b::StandardMaterial>,
    ribs_mat: b::Handle<b::StandardMaterial>,
    buildings: HashMap<String, Vec<b::Entity>>,
    ground: b::Entity,
    ground_mat: b::Handle<b::StandardMaterial>,
    puff_mesh: b::Handle<b::Mesh>,
    puff_tex: b::Handle<b::Image>,
    puffs: Vec<(b::Entity, b::Handle<b::StandardMaterial>)>,
    /// the plain land under everything (where no ground tile is loaded yet)
    land: b::Entity,
    /// the real ground (src/terrain.rs) and its tiles made so far: entity, mesh, picture, material, frame last drawn
    terrain: crate::terrain::Terrain,
    tiles: HashMap<crate::terrain::Key, (b::Entity, b::Handle<b::Mesh>, b::Handle<b::Image>, b::Handle<b::StandardMaterial>, u64)>,
    tick: u64,
}

/// An airport's height above the sea (m) as the real ground has it (None until it is known, or without Bevy).
pub fn airport_elev(code: &str) -> Option<f32> {
    STATE.with(|s| s.borrow().as_ref().and_then(|st| st.terrain.airport_elev(code)))
}

/// Bevy draws the 3D view (it started, and isn't switched off).
pub fn enabled() -> bool {
    ON.with(|o| *o.borrow()) && STATE.with(|s| s.borrow().is_some())
}
/// Bevy started on this machine.
pub fn available() -> bool {
    STATE.with(|s| s.borrow().is_some())
}
pub fn set_enabled(on: bool) {
    ON.with(|o| *o.borrow_mut() = on);
}

/// z up (x east, y north: the 3D view's metres) → Bevy's y up (x east, y up, z south).
fn cv(v: glam::Vec3) -> b::Vec3 {
    b::Vec3::new(v.x, v.z, -v.y)
}
fn conv() -> b::Mat4 {
    b::Mat4::from_rotation_x(-std::f32::consts::FRAC_PI_2)
}
fn mat(m: glam::Mat4) -> b::Mat4 {
    conv() * b::Mat4::from_cols_array(&m.to_cols_array())
}

/// Starts Bevy on the window's device. False where it can't (the classic renderer draws then).
pub fn init(rs: &egui_wgpu::RenderState) -> bool {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| start(rs)));
    match r {
        Ok(Some(st)) => {
            STATE.with(|s| *s.borrow_mut() = Some(st));
            true
        }
        _ => false,
    }
}

fn start(rs: &egui_wgpu::RenderState) -> Option<State> {
    let creation = RenderCreation::manual(
        RenderDevice::from(rs.device.clone()),
        RenderQueue::new(rs.queue.clone()),
        RenderAdapterInfo::new(rs.adapter.get_info()),
        RenderAdapter::new(rs.adapter.clone()),
        RenderInstance::new(rs.instance.clone()),
    );
    let mut app = b::App::new();
    app.add_plugins(
        b::DefaultPlugins
            .set(WindowPlugin { primary_window: None, exit_condition: ExitCondition::DontExit, ..Default::default() })
            .set(RenderPlugin { render_creation: creation, synchronous_pipeline_compilation: true, ..Default::default() })
            .set(b::AssetPlugin { file_path: "/nonexistent-flightgame-assets".into(), ..Default::default() })
            .disable::<bevy::render::pipelined_rendering::PipelinedRenderingPlugin>()
            .disable::<bevy::log::LogPlugin>(),
    );
    app.insert_resource(b::ClearColor(b::Color::BLACK));
    app.insert_resource(b::GlobalAmbientLight { brightness: 0.0, ..Default::default() });
    app.finish();
    app.cleanup();
    let mut apps = std::mem::take(app.sub_apps_mut());
    let w = apps.main.world_mut();
    // the sky: the earth's atmosphere under the origin (the 3D view's ground)
    let medium = w.resource_mut::<b::Assets<ScatteringMedium>>().add(ScatteringMedium::earth(256, 256));
    // (its surface 100 m under the scene: anything below the surface comes out black, and the plain land around
    // the ground picture lies a little under it)
    w.spawn((Atmosphere::earth(medium), b::Transform::from_xyz(0.0, -6_360_100.0, 0.0)));
    let sun = w
        .spawn((
            b::DirectionalLight { illuminance: lux::RAW_SUNLIGHT, shadow_maps_enabled: true, ..Default::default() },
            CascadeShadowConfigBuilder { num_cascades: 3, minimum_distance: 0.5, first_cascade_far_bound: 120.0, maximum_distance: 4000.0, overlap_proportion: 0.2 }.build(),
            b::Transform::from_xyz(0.0, 1.0, 0.0).looking_at(b::Vec3::ZERO, b::Vec3::Z),
        ))
        .id();
    let camera = w
        .spawn((
            b::Camera3d::default(),
            b::Projection::Perspective(b::PerspectiveProjection { fov: 50f32.to_radians(), near: 0.5, far: 400_000.0, ..Default::default() }),
            AtmosphereSettings::default(),
            Exposure { ev100: 13.0 },
            Tonemapping::AcesFitted,
            Bloom::NATURAL,
            b::Msaa::Sample4,
            DistanceFog { color: b::Color::srgba(0.6, 0.7, 0.8, 1.0), falloff: FogFalloff::Exponential { density: 1e-5 }, ..Default::default() },
            b::Transform::default(),
        ))
        .id();
    let mut mats = w.resource_mut::<b::Assets<b::StandardMaterial>>();
    // the aircraft: their livery in the vertices' colours, glossy paint
    let plane_mat = mats.add(b::StandardMaterial { base_color: b::Color::WHITE, perceptual_roughness: 0.32, metallic: 0.05, reflectance: 0.5, double_sided: true, cull_mode: None, ..Default::default() });
    let build_mat = mats.add(b::StandardMaterial { base_color: b::Color::WHITE, perceptual_roughness: 0.9, reflectance: 0.2, ..Default::default() });
    drop(mats);
    // the walls' textures, repeating: a storey (4.2 m) with its band of windows between mullions (2.6 m), and the
    // ribs of a hangar's or a shed's cladding (1.4 m); the windows glow at night (their emissive mask)
    let repeat = || bevy::image::ImageSampler::Descriptor(bevy::image::ImageSamplerDescriptor {
        address_mode_u: bevy::image::ImageAddressMode::Repeat,
        address_mode_v: bevy::image::ImageAddressMode::Repeat,
        mag_filter: bevy::image::ImageFilterMode::Linear,
        min_filter: bevy::image::ImageFilterMode::Linear,
        mipmap_filter: bevy::image::ImageFilterMode::Linear,
        ..Default::default()
    });
    let tex = |w: &mut b::World, n: usize, f: &dyn Fn(f32, f32) -> [u8; 4]| {
        let mut px = Vec::with_capacity(n * n * 4);
        for y in 0..n {
            for x in 0..n {
                px.extend(f(x as f32 / n as f32, y as f32 / n as f32));
            }
        }
        let mut img = b::Image::new(Extent3d { width: n as u32, height: n as u32, depth_or_array_layers: 1 }, TextureDimension::D2, px, TextureFormat::Rgba8UnormSrgb, RenderAssetUsages::RENDER_WORLD);
        img.sampler = repeat();
        w.resource_mut::<b::Assets<b::Image>>().add(img)
    };
    // (v from the top of the storey: the glass from 0.15 to 0.7 of it)
    let glass = |u: f32, v: f32| v > 0.15 && v < 0.7 && u > 0.04;
    let win = tex(w, 64, &|u, v| if glass(u, v) { [70, 92, 112, 255] } else if u <= 0.04 { [150, 152, 156, 255] } else { [255, 255, 255, 255] });
    let glow = tex(w, 64, &|u, v| if glass(u, v) { [255, 214, 140, 255] } else { [0, 0, 0, 255] });
    let ribs = tex(w, 32, &|u, _| if u < 0.14 { [190, 190, 190, 255] } else { [255, 255, 255, 255] });
    let mut mats = w.resource_mut::<b::Assets<b::StandardMaterial>>();
    let windows_mat = mats.add(b::StandardMaterial { base_color: b::Color::WHITE, base_color_texture: Some(win), emissive_texture: Some(glow), emissive: b::LinearRgba::BLACK, perceptual_roughness: 0.75, reflectance: 0.25, ..Default::default() });
    let ribs_mat = mats.add(b::StandardMaterial { base_color: b::Color::WHITE, base_color_texture: Some(ribs), perceptual_roughness: 0.85, reflectance: 0.2, ..Default::default() });
    let ground_mat = mats.add(b::StandardMaterial { base_color: b::Color::srgb(0.3, 0.33, 0.26), perceptual_roughness: 1.0, reflectance: 0.1, ..Default::default() });
    let land_mat = mats.add(b::StandardMaterial { base_color: b::Color::srgb(0.30, 0.33, 0.26), perceptual_roughness: 1.0, reflectance: 0.1, ..Default::default() });
    let mut meshes = w.resource_mut::<b::Assets<b::Mesh>>();
    // the ground picture: a unit square (x east 0..1, z south 0..1), placed and sized on its rect each frame
    let mut quad = b::Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    quad.insert_attribute(b::Mesh::ATTRIBUTE_POSITION, vec![[0.0f32, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 0.0, 1.0], [0.0, 0.0, 1.0]]);
    quad.insert_attribute(b::Mesh::ATTRIBUTE_NORMAL, vec![[0.0f32, 1.0, 0.0]; 4]);
    quad.insert_attribute(b::Mesh::ATTRIBUTE_UV_0, vec![[0.0f32, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]);
    quad.insert_indices(Indices::U32(vec![0, 2, 1, 0, 3, 2]));
    let quad = meshes.add(quad);
    let land = meshes.add(b::Plane3d::new(b::Vec3::Y, b::Vec2::splat(300_000.0)));
    // a cloud puff: a soft round sprite facing the camera (its edge fading, a little lumpy)
    let mut sprite = b::Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    sprite.insert_attribute(b::Mesh::ATTRIBUTE_POSITION, vec![[-0.5f32, -0.5, 0.0], [0.5, -0.5, 0.0], [0.5, 0.5, 0.0], [-0.5, 0.5, 0.0]]);
    sprite.insert_attribute(b::Mesh::ATTRIBUTE_NORMAL, vec![[0.0f32, 0.0, 1.0]; 4]);
    sprite.insert_attribute(b::Mesh::ATTRIBUTE_UV_0, vec![[0.0f32, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]);
    sprite.insert_indices(Indices::U32(vec![0, 1, 2, 0, 2, 3]));
    let puff_mesh = meshes.add(sprite);
    let n = 128usize;
    let mut px = vec![255u8; n * n * 4];
    for y in 0..n {
        for x in 0..n {
            let (dx, dy) = ((x as f32 + 0.5) / n as f32 * 2.0 - 1.0, (y as f32 + 0.5) / n as f32 * 2.0 - 1.0);
            let r = (dx * dx + dy * dy).sqrt();
            let lump = 0.82 + 0.18 * ((dx * 9.0).sin() * (dy * 7.0 + dx * 3.0).sin());
            let a = (1.0 - (r / lump).clamp(0.0, 1.0)).powf(1.6);
            // (a little darker underneath)
            let shade = (0.86 + 0.14 * (1.0 - dy)).min(1.0);
            let o = (y * n + x) * 4;
            px[o] = (255.0 * shade) as u8;
            px[o + 1] = (255.0 * shade) as u8;
            px[o + 2] = (255.0 * shade.min(1.0)) as u8;
            px[o + 3] = (a * 255.0) as u8;
        }
    }
    let soft = w.resource_mut::<b::Assets<b::Image>>().add(b::Image::new(Extent3d { width: n as u32, height: n as u32, depth_or_array_layers: 1 }, TextureDimension::D2, px, TextureFormat::Rgba8UnormSrgb, RenderAssetUsages::RENDER_WORLD));
    let ground = w.spawn((b::Mesh3d(quad), b::MeshMaterial3d(ground_mat.clone()), b::Transform::from_xyz(1e7, 0.0, 0.0))).id();
    let land = w.spawn((b::Mesh3d(land), b::MeshMaterial3d(land_mat), b::Transform::from_xyz(0.0, -0.4, 0.0))).id();
    Some(State {
        apps,
        rs: rs.clone(),
        target: None,
        camera,
        sun,
        plane_mat,
        planes: Vec::new(),
        build_mat,
        windows_mat,
        ribs_mat,
        buildings: HashMap::new(),
        ground,
        ground_mat,
        puff_mesh,
        puff_tex: soft,
        puffs: Vec::new(),
        land,
        terrain: Default::default(),
        tiles: HashMap::new(),
        tick: 0,
    })
}

fn mesh_of(ps: Vec<[f32; 3]>, ns: Vec<[f32; 3]>, cs: Vec<[f32; 4]>, idx: &[u32]) -> b::Mesh {
    let mut m = b::Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    m.insert_attribute(b::Mesh::ATTRIBUTE_POSITION, ps);
    m.insert_attribute(b::Mesh::ATTRIBUTE_NORMAL, ns);
    m.insert_attribute(b::Mesh::ATTRIBUTE_COLOR, cs);
    m.insert_indices(Indices::U32(idx.to_vec()));
    m
}

/// Draws the frame with Bevy into `rect`. False if it couldn't (then it is off, and the classic renderer draws).
pub fn draw(ui: &mut egui::Ui, rect: egui::Rect, frame: &Frame) -> bool {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let Some(st) = s.as_mut() else { return false };
        let ppp = ui.ctx().pixels_per_point();
        let (w, h) = (((rect.width() * ppp) as u32).max(16), ((rect.height() * ppp) as u32).max(16));
        let ok = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| render(st, frame, w, h)));
        match ok {
            Ok(Some(tex)) => {
                ui.painter().image(tex, rect, egui::Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), egui::Color32::WHITE);
                true
            }
            Ok(None) => {
                // (the first frames: the picture isn't rendered yet)
                ui.painter().rect_filled(rect, 0.0, egui::Color32::from_rgb(40, 50, 64));
                true
            }
            Err(_) => {
                *s = None;
                false
            }
        }
    })
}

fn render(st: &mut State, frame: &Frame, w: u32, h: u32) -> Option<egui::TextureId> {
    let world = st.apps.main.world_mut();
    // the picture: a new one when the view's size changes
    if st.target.as_ref().is_none_or(|t| t.1 != w || t.2 != h) {
        if let Some((_, _, _, Some(id))) = st.target.take() {
            st.rs.renderer.write().free_texture(&id);
        }
        let mut img = b::Image::new_target_texture(w, h, TextureFormat::Rgba8UnormSrgb, None);
        img.asset_usage = RenderAssetUsages::RENDER_WORLD;
        let handle = world.resource_mut::<b::Assets<b::Image>>().add(img);
        world.entity_mut(st.camera).insert(RenderTarget::Image(handle.clone().into()));
        st.target = Some((handle, w, h, None));
    }
    // the camera, the sun, the haze
    let eye = cv(frame.eye);
    world.entity_mut(st.camera).insert(b::Transform::from_translation(eye).looking_at(cv(frame.target), cv(frame.up)));
    let sun = cv(frame.sun_true);
    let up = sun.y.clamp(-1.0, 1.0);
    let day = ((up + 0.05) / 0.1).clamp(0.0, 1.0);
    let fog = frame.fog;
    world.entity_mut(st.sun).insert((
        b::DirectionalLight { illuminance: lux::RAW_SUNLIGHT * day * (0.25 + 0.75 * frame.light.clamp(0.0, 1.0)), shadow_maps_enabled: true, ..Default::default() },
        b::Transform::from_translation(sun).looking_at(b::Vec3::ZERO, if sun.y.abs() > 0.99 { b::Vec3::Z } else { b::Vec3::Y }),
    ));
    // the light from the sky into the shade, in the haze's colour: a little blue on a clear day, grey under
    // cloud (the atmosphere's own reflections stay clear-sky blue whatever the weather)
    {
        let mx = fog[0].max(fog[1]).max(fog[2]).max(0.05);
        let mut amb = world.resource_mut::<b::GlobalAmbientLight>();
        amb.color = b::Color::srgb(0.5 + 0.5 * fog[0] / mx, 0.5 + 0.5 * fog[1] / mx, 0.5 + 0.5 * fog[2] / mx);
        amb.brightness = 20000.0 * day * (0.45 + 0.55 * frame.light.clamp(0.0, 1.0)) + 250.0;
    }
    // the exposure follows the light, as a camera's would: full day ev 13, dusk and night brighter
    let ev = 9.6 + 3.4 * (up.max(0.0) / 0.45).min(1.0) * (0.6 + 0.4 * frame.light.clamp(0.0, 1.0));
    world.entity_mut(st.camera).insert(Exposure { ev100: ev });
    world.entity_mut(st.camera).insert(DistanceFog {
        color: b::Color::srgba(fog[0], fog[1], fog[2], 1.0),
        falloff: FogFalloff::Exponential { density: fog[3] * 1.4 },
        directional_light_color: b::Color::srgba(1.0, 0.95, 0.85, 0.4),
        directional_light_exponent: 30.0,
    });
    // the planes, posed as the classic renderer would move their parts
    for (k, p) in frame.planes.iter().enumerate() {
        let (ps, ns, cs) = crate::view3d::posed(&p.mesh, p);
        let model = glam::Mat4::from_translation(p.at)
            * glam::Mat4::from_rotation_z(-p.heading.to_radians())
            * glam::Mat4::from_rotation_x(p.pitch.to_radians())
            * glam::Mat4::from_rotation_y(p.bank.to_radians())
            * glam::Mat4::from_scale(glam::Vec3::splat(p.len));
        let tf = b::Transform::from_matrix(mat(model));
        if k < st.planes.len() && st.planes[k].2 == p.file {
            let (e, mh, _) = &st.planes[k];
            if let Some(mut m) = world.resource_mut::<b::Assets<b::Mesh>>().get_mut(mh) {
                m.insert_attribute(b::Mesh::ATTRIBUTE_POSITION, ps);
                m.insert_attribute(b::Mesh::ATTRIBUTE_NORMAL, ns);
                m.insert_attribute(b::Mesh::ATTRIBUTE_COLOR, cs);
            }
            world.entity_mut(*e).insert((tf, b::Visibility::Visible));
        } else {
            let mh = world.resource_mut::<b::Assets<b::Mesh>>().add(mesh_of(ps, ns, cs, &p.mesh.indices));
            let e = world.spawn((b::Mesh3d(mh.clone()), b::MeshMaterial3d(st.plane_mat.clone()), tf)).id();
            if k < st.planes.len() {
                world.despawn(st.planes[k].0);
                st.planes[k] = (e, mh, p.file.clone());
            } else {
                st.planes.push((e, mh, p.file.clone()));
            }
        }
    }
    for (e, _, _) in st.planes.iter().skip(frame.planes.len()) {
        world.entity_mut(*e).insert(b::Visibility::Hidden);
    }
    // the airports' buildings (their walls' own colours)
    let mut seen = Vec::new();
    for (key, at, m) in &frame.buildings {
        seen.push(key.clone());
        let tf = b::Transform::from_matrix(mat(glam::Mat4::from_translation(*at)));
        match st.buildings.get(key) {
            Some(es) => {
                for e in es {
                    world.entity_mut(*e).insert(tf);
                }
            }
            None => {
                // in three: plain (and roofs), with windows, ribbed (a wall's vertices: info height and distance
                // along it, anim.y its style)
                let style = |i: u32| {
                    let v = &m.vertices[i as usize];
                    if v.info[0] > 5.5 { v.anim[1].round() as i32 } else { 0 }
                };
                let mut es = Vec::new();
                for (s, matl) in [(0, st.build_mat.clone()), (1, st.windows_mat.clone()), (2, st.ribs_mat.clone())] {
                    let idx: Vec<u32> = m.indices.chunks(3).filter(|tri| style(tri[0]) == s).flatten().copied().collect();
                    if idx.is_empty() {
                        continue;
                    }
                    let ps: Vec<[f32; 3]> = m.vertices.iter().map(|v| v.pos).collect();
                    let ns: Vec<[f32; 3]> = m.vertices.iter().map(|v| v.normal).collect();
                    // (the layouts' wall colours are light greys: real concrete, glass and cladding reflect about
                    // half of that, else they glare white in the sun)
                    let cs: Vec<[f32; 4]> = m.vertices.iter().map(|v| [v.color[0].powf(2.2) * 0.5, v.color[1].powf(2.2) * 0.5, v.color[2].powf(2.2) * 0.5, 1.0]).collect();
                    let (su, sv) = if s == 1 { (2.6, 4.2) } else { (1.4, 4.2) };
                    let uv: Vec<[f32; 2]> = m.vertices.iter().map(|v| [v.info[2] / su, -v.info[1] / sv]).collect();
                    let mut mesh = mesh_of(ps, ns, cs, &idx);
                    mesh.insert_attribute(b::Mesh::ATTRIBUTE_UV_0, uv);
                    let mh = world.resource_mut::<b::Assets<b::Mesh>>().add(mesh);
                    es.push(world.spawn((b::Mesh3d(mh), b::MeshMaterial3d(matl), tf)).id());
                }
                st.buildings.insert(key.clone(), es);
            }
        }
    }
    st.buildings.retain(|k, es| {
        let keep = seen.contains(k);
        if !keep {
            for e in es.iter() {
                world.despawn(*e);
            }
        }
        keep
    });
    // the windows lit after dusk
    if let Some(mut m) = world.resource_mut::<b::Assets<b::StandardMaterial>>().get_mut(&st.windows_mat) {
        m.emissive = b::LinearRgba::rgb(1.0, 1.0, 1.0) * (1.0 - day) * 220.0;
    }
    // the ground picture: its rect, and a new picture when one has come
    let gr = frame.ground_rect;
    world.entity_mut(st.ground).insert(b::Transform::from_xyz(gr[0], 0.0, -gr[3]).with_scale(b::Vec3::new(gr[2] - gr[0], 1.0, gr[3] - gr[1])));
    let pixels = frame.ground.lock().ok().and_then(|mut g| if g.fresh { g.fresh = false; g.pixels.clone() } else { None });
    if let Some(px) = pixels {
        let img = b::Image::new(Extent3d { width: GROUND_PX, height: GROUND_PX, depth_or_array_layers: 1 }, TextureDimension::D2, px, TextureFormat::Rgba8UnormSrgb, RenderAssetUsages::RENDER_WORLD);
        let ih = world.resource_mut::<b::Assets<b::Image>>().add(img);
        if let Some(mut m) = world.resource_mut::<b::Assets<b::StandardMaterial>>().get_mut(&st.ground_mat) {
            m.base_color = b::Color::WHITE;
            m.base_color_texture = Some(ih);
        }
    }
    // the real ground (src/terrain.rs): satellite tiles on the land's shape, finer the nearer they are
    let (lat0, lon0) = frame.origin;
    let cosl = lat0.to_radians().cos();
    let eye_lat = lat0 + frame.eye.y as f64 / 111_320.0;
    let eye_lon = lon0 + frame.eye.x as f64 / (111_320.0 * cosl);
    for td in st.terrain.take_done() {
        let mut m = b::Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
        m.insert_attribute(b::Mesh::ATTRIBUTE_POSITION, td.pos);
        m.insert_attribute(b::Mesh::ATTRIBUTE_NORMAL, td.normals);
        m.insert_attribute(b::Mesh::ATTRIBUTE_UV_0, td.uvs);
        m.insert_indices(Indices::U32(td.indices));
        let mh = world.resource_mut::<b::Assets<b::Mesh>>().add(m);
        let mut img = b::Image::new(Extent3d { width: 256, height: 256, depth_or_array_layers: 1 }, TextureDimension::D2, td.rgba[..256 * 256 * 4].to_vec(), TextureFormat::Rgba8UnormSrgb, RenderAssetUsages::RENDER_WORLD);
        img.data = Some(td.rgba);
        img.texture_descriptor.mip_level_count = td.mips;
        img.sampler = bevy::image::ImageSampler::Descriptor(bevy::image::ImageSamplerDescriptor {
            address_mode_u: bevy::image::ImageAddressMode::ClampToEdge,
            address_mode_v: bevy::image::ImageAddressMode::ClampToEdge,
            mag_filter: bevy::image::ImageFilterMode::Linear,
            min_filter: bevy::image::ImageFilterMode::Linear,
            mipmap_filter: bevy::image::ImageFilterMode::Linear,
            anisotropy_clamp: 16,
            ..Default::default()
        });
        let ih = world.resource_mut::<b::Assets<b::Image>>().add(img);
        let mat = world.resource_mut::<b::Assets<b::StandardMaterial>>().add(b::StandardMaterial {
            base_color: b::Color::WHITE,
            base_color_texture: Some(ih.clone()),
            perceptual_roughness: 1.0,
            reflectance: 0.06,
            double_sided: true,
            cull_mode: None,
            ..Default::default()
        });
        let e = world.spawn((b::Mesh3d(mh.clone()), b::MeshMaterial3d(mat.clone()), b::Transform::default(), b::Visibility::Hidden, bevy::light::NotShadowCaster)).id();
        st.tiles.insert(td.key, (e, mh, ih, mat, st.tick));
    }
    st.tick += 1;
    let draw: HashMap<crate::terrain::Key, f32> = st.terrain.select(eye_lat, eye_lon, (frame.eye.z as f64).max(2.0)).into_iter().collect();
    for (k, t) in st.tiles.iter_mut() {
        if let Some(lower) = draw.get(k) {
            let (alat, alon) = crate::terrain::anchor(*k);
            let (x, y) = ((alon - lon0) * 111_320.0 * cosl, (alat - lat0) * 111_320.0);
            let tf = b::Transform::from_xyz(x as f32, -frame.ref_m - lower, -y as f32).with_scale(b::Vec3::new(cosl as f32, 1.0, 1.0));
            world.entity_mut(t.0).insert((tf, b::Visibility::Visible));
            t.4 = st.tick;
        } else if t.4 + 1 == st.tick {
            world.entity_mut(t.0).insert(b::Visibility::Hidden);
        }
    }
    // (at most 900 tiles kept: the longest unused go)
    if st.tiles.len() > 900 {
        let mut old: Vec<(u64, crate::terrain::Key)> = st.tiles.iter().filter(|(k, _)| !draw.contains_key(k)).map(|(k, t)| (t.4, *k)).collect();
        old.sort();
        for (_, k) in old.into_iter().take(120) {
            if let Some((e, mh, ih, mat, _)) = st.tiles.remove(&k) {
                world.despawn(e);
                world.resource_mut::<b::Assets<b::Mesh>>().remove(&mh);
                world.resource_mut::<b::Assets<b::Image>>().remove(&ih);
                world.resource_mut::<b::Assets<b::StandardMaterial>>().remove(&mat);
                st.terrain.forget(k);
            }
        }
    }
    if !draw.is_empty() {
        // the old single ground picture is not needed any more; the plain land stays below, for the gaps
        world.entity_mut(st.ground).insert(b::Transform::from_xyz(1e7, 0.0, 0.0));
        world.entity_mut(st.land).insert(b::Transform::from_xyz(0.0, -frame.ref_m - 60.0, 0.0));
    }
    // the clouds: soft white puffs (the nearest 260)
    let mut puffs: Vec<&crate::view3d::Puff> = frame.puffs.iter().collect();
    let e3 = frame.eye;
    puffs.sort_by(|a, c| {
        let da = glam::Vec3::from(a.at).distance_squared(e3);
        let dc = glam::Vec3::from(c.at).distance_squared(e3);
        da.total_cmp(&dc)
    });
    puffs.truncate(260);
    while st.puffs.len() < puffs.len() {
        let mh = world.resource_mut::<b::Assets<b::StandardMaterial>>().add(b::StandardMaterial {
            base_color: b::Color::srgba(1.0, 1.0, 1.0, 0.5),
            base_color_texture: Some(st.puff_tex.clone()),
            alpha_mode: b::AlphaMode::Blend,
            unlit: true,
            double_sided: true,
            cull_mode: None,
            fog_enabled: true,
            ..Default::default()
        });
        let e = world.spawn((b::Mesh3d(st.puff_mesh.clone()), b::MeshMaterial3d(mh.clone()), b::Transform::default())).id();
        st.puffs.push((e, mh));
    }
    for (k, (e, mh)) in st.puffs.iter().enumerate() {
        match puffs.get(k) {
            Some(p) => {
                // (facing the camera; as wide as the puff, as tall as it is high)
                let at = cv(glam::Vec3::from(p.at));
                let wide = p.size[0].max(p.size[1]) * 1.5;
                let tf = b::Transform::from_translation(at).looking_at(eye, b::Vec3::Y).with_scale(b::Vec3::new(wide, p.size[2] * 1.6, 1.0));
                world.entity_mut(*e).insert((tf, b::Visibility::Visible));
                if let Some(mut m) = world.resource_mut::<b::Assets<b::StandardMaterial>>().get_mut(mh) {
                    // (unlit: as bright as the day, a little warmer when the sun is low)
                    let k = 0.25 + 0.95 * day * (0.4 + 0.6 * frame.light.clamp(0.0, 1.0));
                    let warm = 1.0 - 0.25 * (1.0 - up.clamp(0.0, 0.3) / 0.3) * day;
                    m.base_color = b::Color::linear_rgba(p.color[0].powf(2.2) * k * 1.6, p.color[1].powf(2.2) * k * 1.6 * warm, p.color[2].powf(2.2) * k * 1.6 * warm * warm, (p.color[3] * 0.9).min(0.9));
                }
            }
            None => {
                world.entity_mut(*e).insert(b::Visibility::Hidden);
            }
        }
    }
    // render it
    st.apps.update();
    // egui's texture of the picture, once it is on the GPU
    let (handle, _, _, tex) = st.target.as_mut()?;
    if tex.is_none() {
        let render = st.apps.sub_apps.get(&bevy::app::AppLabel::intern(&RenderApp))?;
        let gpu = render.world().resource::<RenderAssets<GpuImage>>().get(handle.id())?;
        let view: &wgpu::TextureView = &gpu.texture_view;
        *tex = Some(st.rs.renderer.write().register_native_texture(&st.rs.device, view, wgpu::FilterMode::Linear));
    }
    *tex
}
