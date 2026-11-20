//! The 3D view (V), after the browser game's js/view3d.js: the aircraft as their 3D models (`models/*.glb`, the
//! same files the browser game uses), painted in the airline's livery (js/data/liveries.js), with their moving
//! parts (propellers and fans turning, ailerons, flaps, elevators and rudder, the wings bending, the landing gear
//! folding away), over the satellite pictures of where they are, with the airports' buildings, the clouds of the
//! game's weather and haze, from a chase camera behind the followed plane (drag to turn round it, wheel to come
//! closer), a fly-by camera standing beside its path, or a camera on its wing. Drawn with wgpu inside egui.

use eframe::egui;
use eframe::egui_wgpu::{self, CallbackResources, CallbackTrait, ScreenDescriptor};
use eframe::wgpu;
use flightgame::data::{data, distance_km};
use glam::{Mat4, Vec3};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const LIVERIES_JS: &str = include_str!("../../js/data/liveries.js");
const MODELS_JS: &str = include_str!("../../js/data/models.js");

// ---------- liveries ----------

/// The colours of a livery the 3D models are painted in.
#[derive(Clone, Debug)]
pub struct Livery {
    pub id: String,
    pub name: String,
    pub body: [f32; 3],
    pub wing: [f32; 3],
    pub engine: [f32; 3],
    pub fin: [f32; 3],
    /// the fin's colour on round the rear fuselage
    pub tail: bool,
    /// belly colour and from how far down (0 top … 1 bottom of the fuselage)
    pub belly: Option<([f32; 3], f32)>,
    pub title: [f32; 3],
}

fn rgb(v: &Value) -> Option<[f32; 3]> {
    let n = v.as_f64()? as u32;
    let s = |x: u32| (x & 0xff) as f32 / 255.0; // (sRGB; made linear where the screen wants it)
    Some([s(n >> 16), s(n >> 8), s(n)])
}

pub fn liveries() -> &'static Vec<Livery> {
    static L: std::sync::OnceLock<Vec<Livery>> = std::sync::OnceLock::new();
    L.get_or_init(|| {
        let mut out = Vec::new();
        if let Ok(Value::Array(list)) = flightgame::jsdata::assigned(LIVERIES_JS, "liveries") {
            for l in &list {
                let body = rgb(&l["body"]).unwrap_or([0.88, 0.89, 0.9]);
                let wing = rgb(&l["wing"]).unwrap_or([0.8, 0.82, 0.85]);
                out.push(Livery {
                    id: l["id"].as_str().unwrap_or("").into(),
                    name: l["name"].as_str().unwrap_or("").into(),
                    body,
                    wing,
                    engine: rgb(&l["engine"]).unwrap_or(wing),
                    fin: rgb(&l["fin"]).unwrap_or(body),
                    tail: l["tail"].as_bool().unwrap_or(false),
                    belly: rgb(&l["belly"]["color"]).map(|c| (c, l["belly"]["from"].as_f64().unwrap_or(0.7) as f32)),
                    title: rgb(&l["titleColor"]).unwrap_or([0.8, 0.0, 0.0]),
                });
            }
        }
        out
    })
}

pub fn livery(id: Option<&str>) -> Livery {
    let all = liveries();
    id.and_then(|id| all.iter().find(|l| l.id == id)).or(all.first()).cloned().unwrap_or(Livery {
        id: "swiss".into(),
        name: "SWISS".into(),
        body: [0.88; 3],
        wing: [0.8; 3],
        engine: [0.8; 3],
        fin: [0.79, 0.0, 0.0],
        tail: false,
        belly: None,
        title: [0.79, 0.0, 0.0],
    })
}

// ---------- the models ----------

/// What js/data/models.js says about the models: the file of each type, each model's real length and fuselage
/// height, its landing gear, its propellers, and which models have gear of their own.
struct ModelData {
    files: HashMap<String, String>,
    size: HashMap<String, (f32, f32)>,
    gear: serde_json::Map<String, Value>,
    props: serde_json::Map<String, Value>,
    on_gear: Vec<String>,
}

fn model_data() -> &'static ModelData {
    static M: std::sync::OnceLock<ModelData> = std::sync::OnceLock::new();
    M.get_or_init(|| {
        let obj = |name: &str| flightgame::jsdata::assigned(MODELS_JS, name).ok().and_then(|v| v.as_object().cloned()).unwrap_or_default();
        ModelData {
            files: obj("models").iter().filter_map(|(k, v)| v.as_str().map(|f| (k.clone(), f.to_string()))).collect(),
            size: obj("modelSize")
                .iter()
                .filter_map(|(k, v)| Some((k.clone(), (v.get(0)?.as_f64()? as f32, v.get(1)?.as_f64()? as f32))))
                .collect(),
            gear: obj("gear"),
            props: obj("props"),
            on_gear: flightgame::jsdata::assigned(MODELS_JS, "modelsOnGear")
                .ok()
                .and_then(|v| v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()))
                .unwrap_or_default(),
        }
    })
}

/// The model file of each type (js/data/models.js).
fn model_file(kind: &str) -> Option<String> {
    model_data().files.get(kind).cloned()
}

fn models_dir() -> std::path::PathBuf {
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("models");
    if repo.exists() {
        return repo;
    }
    std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("models"))).unwrap_or(repo)
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Vertex {
    pub(crate) pos: [f32; 3],
    pub(crate) normal: [f32; 3],
    /// part: 0 fuselage, 1 fin, 2 wings and tailplane, 3 engines, 4 dark, 5 its own colour, 6 a building's wall;
    /// then for the fuselage its height (-1 bottom … 1 top) and the place along it (-0.5 tail … 0.5 nose), for a
    /// wall the height (m) and the distance along it (m)
    pub(crate) info: [f32; 3],
    /// what moves: kind (1 aileron, 2 flap, 3 elevator: hinge y, z; 4 rudder: hinge y; 5 propeller: hub x, z;
    /// 6 a fan's face: hub x, z, radius; 7 landing gear: the height it folds up to, then 1 on a main leg's or
    /// 2 on the nose leg's shock absorber (it slides); 8 a jet engine's rear: how far it slides back with a
    /// translating sleeve reverser (0 for the parts that don't), the bucket's hinge y, the engine's axis z;
    /// 10 a spoiler panel: its hinge (front edge) y, z); for a wall: 0, its style (0 plain, 1 windows, 2 ribbed),
    /// its top (m)
    pub(crate) anim: [f32; 4],
    /// own colour and alpha (parts 5 and 6); on the aircraft x is how far the wing bends there (per unit of flex)
    pub(crate) color: [f32; 4],
}

fn vx(pos: [f32; 3], normal: [f32; 3], info: [f32; 3]) -> Vertex {
    Vertex { pos, normal, info, anim: [0.0; 4], color: [0.0; 4] }
}

/// A model, 1 unit long (x right wing, y nose, z up, centred), its vertices sorted into the livery's parts and
/// what moves; `ground`: the height (model units) its wheels stand on.
pub struct Mesh {
    pub(crate) vertices: Vec<Vertex>,
    pub(crate) indices: Vec<u32>,
    pub(crate) ground: f32,
}

fn load_mesh(file: &str) -> Option<Mesh> {
    let bytes = std::fs::read(models_dir().join(format!("{file}.glb"))).ok()?;
    let doc = gltf::Gltf::from_slice(&bytes).ok()?;
    let buffers = gltf::import_buffers(&doc.document, None, doc.blob.clone()).ok()?;
    let mut pos: Vec<[f32; 3]> = Vec::new();
    let mut nor: Vec<[f32; 3]> = Vec::new();
    let mut dark: Vec<bool> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    fn walk(
        node: gltf::Node,
        parent: Mat4,
        buffers: &[gltf::buffer::Data],
        pos: &mut Vec<[f32; 3]>,
        nor: &mut Vec<[f32; 3]>,
        dark: &mut Vec<bool>,
        indices: &mut Vec<u32>,
    ) {
        let m = parent * Mat4::from_cols_array_2d(&node.transform().matrix());
        if let Some(mesh) = node.mesh() {
            for prim in mesh.primitives() {
                let r = prim.reader(|b| buffers.get(b.index()).map(|d| &d.0[..]));
                let Some(p) = r.read_positions() else { continue };
                let base = pos.len() as u32;
                let c = prim.material().pbr_metallic_roughness().base_color_factor();
                let is_dark = c[0] + c[1] + c[2] < 0.75;
                for v in p {
                    pos.push(m.transform_point3(Vec3::from(v)).to_array());
                    dark.push(is_dark);
                }
                match r.read_normals() {
                    Some(n) => {
                        for v in n {
                            nor.push(m.transform_vector3(Vec3::from(v)).normalize_or_zero().to_array());
                        }
                    }
                    None => nor.resize(pos.len(), [0.0, 0.0, 1.0]),
                }
                match r.read_indices() {
                    Some(ix) => indices.extend(ix.into_u32().map(|i| i + base)),
                    None => indices.extend(base..pos.len() as u32),
                }
            }
        }
        for child in node.children() {
            walk(child, m, buffers, pos, nor, dark, indices);
        }
    }
    let scene = doc.document.default_scene().or_else(|| doc.document.scenes().next())?;
    for node in scene.nodes() {
        walk(node, Mat4::IDENTITY, &buffers, &mut pos, &mut nor, &mut dark, &mut indices);
    }
    if pos.is_empty() {
        return None;
    }
    // the fuselage: its height and width in a slice across the middle (left of the wings)
    let slice: Vec<&[f32; 3]> = pos.iter().filter(|p| p[1].abs() < 0.04 && p[0].abs() < 0.05).collect();
    let (zmin, zmax) = slice.iter().fold((f32::MAX, f32::MIN), |(a, b), p| (a.min(p[2]), b.max(p[2])));
    let (zmin, zmax) = if zmin < zmax { (zmin, zmax) } else { (-0.03, 0.03) };
    let zc = (zmin + zmax) / 2.0;
    let hz = ((zmax - zmin) / 2.0).max(0.01);
    let rx = pos
        .iter()
        .filter(|p| p[1].abs() < 0.04 && p[2] > zc + hz * 0.35)
        .fold(0.0f32, |a, p| a.max(p[0].abs()))
        .clamp(hz * 0.6, hz * 1.6);
    let mut vertices: Vec<Vertex> = pos
        .iter()
        .zip(&nor)
        .zip(&dark)
        .map(|((p, n), &d)| {
            let (x, y, z) = (p[0].abs(), p[1], p[2]);
            let part = if d {
                4.0
            } else if x <= rx * 1.12 {
                if z > zmax + hz * 0.15 && y < -0.2 { 1.0 } else { 0.0 }
            } else if z < zc - hz * 0.2 && y > -0.2 && y < 0.25 && x < 0.35 {
                3.0 // engines hang under the wing
            } else {
                2.0
            };
            vx(*p, *n, [part, ((z - zc) / hz).clamp(-1.5, 3.0), y])
        })
        .collect();
    let zlow = pos.iter().fold(f32::MAX, |a, p| a.min(p[2]));
    let shape = mark_moving(&mut vertices, file, rx, zmax, hz);
    let ground = add_gear(&mut vertices, &mut indices, file, &shape, rx, zmin, zlow);
    add_spoilers(&mut vertices, &mut indices, &shape);
    Some(Mesh { vertices, indices, ground })
}

/// A model's vertices as the shader moves them for plane `p` (its moving parts, wing bend, gear, shock absorbers,
/// reversers, spoilers: the same as `vs_main`), with their colours from its livery (as `fs_main` paints them,
/// linear): for the Bevy renderer, which draws them with its own lighting. (positions, normals, colours)
pub(crate) fn posed(m: &Mesh, p: &Plane) -> (Vec<[f32; 3]>, Vec<[f32; 3]>, Vec<[f32; 4]>) {
    let (a0, a1, a2, a3) = (p.anim0, p.anim1, p.anim2, p.anim3);
    let rot2 = |x: f32, y: f32, a: f32| (x * a.cos() - y * a.sin(), x * a.sin() + y * a.cos());
    let lin = |c: [f32; 3]| [c[0].powf(2.2), c[1].powf(2.2), c[2].powf(2.2), 1.0];
    let lv = &p.livery;
    let n = m.vertices.len();
    let (mut ps, mut ns, mut cs) = (Vec::with_capacity(n), Vec::with_capacity(n), Vec::with_capacity(n));
    for v in &m.vertices {
        let (mut q, mut nn) = (v.pos, v.normal);
        let (k, an) = (v.anim[0], v.anim);
        let mut show = true;
        if k > 0.5 && k < 3.5 {
            let a = if k < 1.5 { a0[2] * q[0].signum() } else if k > 2.5 { a0[3] } else { a0[1] };
            let (y, z) = rot2(q[1] - an[1], q[2] - an[2], a);
            q[1] = an[1] + y;
            q[2] = an[2] + z;
            let (ny, nz) = rot2(nn[1], nn[2], a);
            nn = [nn[0], ny, nz];
        } else if k > 3.5 && k < 4.5 {
            let (x, y) = rot2(q[0], q[1] - an[1], a1[0]);
            q[0] = x;
            q[1] = an[1] + y;
        } else if k > 4.5 && k < 5.5 {
            let a = a0[0] * an[1].signum();
            let (x, z) = rot2(q[0] - an[1], q[2] - an[2], a);
            q[0] = an[1] + x;
            q[2] = an[2] + z;
            let (nx, nz) = rot2(nn[0], nn[2], a);
            nn = [nx, nn[1], nz];
        } else if k > 6.5 && k < 7.5 {
            if an[2] > 0.5 {
                q[2] -= if an[2] < 1.5 { a2[2] } else { a2[3] };
            }
            let g = a1[2];
            if g < 0.02 {
                q = [0.0, 0.0, an[1]];
                show = false;
            } else {
                q[2] = an[1] + (q[2] - an[1]) * g;
            }
        } else if k > 7.5 && k < 8.5 {
            let on = a2[1] == 0.0 || (a2[1] > 0.0 && q[0].abs() < a2[1]) || (a2[1] < 0.0 && q[0].abs() > -a2[1]);
            let rk = a3[1];
            if a2[0] > 0.001 && on {
                if rk > 0.5 && rk < 2.5 {
                    if an[1] > 0.0 {
                        q[1] -= an[1] * a2[0] * if rk > 1.5 { 0.7 } else { 1.0 };
                    }
                } else if rk > 2.5 && q[1] < an[2] {
                    let a = if q[2] >= an[3] { 1.0 } else { -1.0 } * a2[0];
                    let (y, z) = rot2(q[1] - an[2], q[2] - an[3], a);
                    q[1] = an[2] + y;
                    q[2] = an[3] + z;
                    let (ny, nz) = rot2(nn[1], nn[2], a);
                    nn = [nn[0], ny, nz];
                }
            }
        } else if k > 9.5 && k < 10.5 {
            let a = -a3[0];
            let (y, z) = rot2(q[1] - an[1], q[2] - an[2], a);
            q[1] = an[1] + y;
            q[2] = an[2] + z;
            let (ny, nz) = rot2(nn[1], nn[2], a);
            nn = [nn[0], ny, nz];
        }
        if v.info[0] < 4.5 {
            q[2] += a1[1] * v.color[0];
        }
        let part = v.info[0];
        let c = if part > 4.5 {
            lin([v.color[0], v.color[1], v.color[2]])
        } else if part > 3.5 {
            lin([0.08, 0.09, 0.1])
        } else if k > 5.5 && k < 6.5 {
            lin([0.35, 0.36, 0.38]) // (a fan's face)
        } else if part > 2.5 {
            lin(lv.engine)
        } else if part > 1.5 {
            lin(lv.wing)
        } else if part > 0.5 {
            lin(lv.fin)
        } else {
            let mut c = lv.body;
            if let Some((belly, from)) = lv.belly {
                if from > 0.0 && v.info[1] < 1.0 - 2.0 * from {
                    c = belly;
                }
            }
            if lv.tail && v.info[2] < -0.36 {
                c = lv.fin;
            }
            lin(c)
        };
        ps.push(q);
        ns.push(nn);
        cs.push(if show { c } else { [0.0, 0.0, 0.0, 0.0] });
    }
    (ps, ns, cs)
}

/// What the gear needs to know about a model's shape: the wing root (leading and trailing edge, underside), the
/// engines (hub x, z, radius, lowest point), the fuselage half width.
struct Shape {
    root: Option<(f32, f32, f32)>,
    engines: Vec<(f32, f32, f32, f32)>,
    /// the spoiler panels' strips on the wing ahead of the flaps: x from, x to (one side), hinge of the flap y, the
    /// chord, the wing's top there; and where the wing starts bending and its tip (for their bend)
    spoilers: Vec<(f32, f32, f32, f32, f32)>,
    bend: (f32, f32),
}

/// The median of each value and its neighbours (two either side): a nacelle or a fairing in a strip or two
/// would bend the line.
fn median5(vals: &[Option<f32>]) -> Vec<Option<f32>> {
    (0..vals.len())
        .map(|i| {
            let mut v: Vec<f32> = (i.saturating_sub(2)..=(i + 2).min(vals.len() - 1)).filter_map(|j| vals[j]).collect();
            v.sort_by(|a, b| a.total_cmp(b));
            v.get(v.len() / 2).copied()
        })
        .collect()
}

/// Finds what moves, as the browser game's js/livery.js does (markEngines, markSurfaces), more simply: the
/// propellers (where js/data/models.js puts them), the fans' faces in the front of the engines, the ailerons
/// (outer third) and flaps (inboard) at the rear of the wing's chord, the elevators on the tailplane behind the
/// empty gap between it and the wing, the rudder at the rear of the fin; and how far each part of the wing bends.
fn mark_moving(v: &mut [Vertex], file: &str, rx: f32, zmax: f32, hz: f32) -> Shape {
    let x0 = 1.25 * rx;
    let wingv: Vec<usize> = (0..v.len()).filter(|&i| v[i].info[0] == 2.0 && v[i].pos[0].abs() > x0).collect();
    let xmax = wingv.iter().fold(x0 + 0.01, |m, &i| m.max(v[i].pos[0].abs()));
    // wing and tailplane: split where, over the whole span, no flat vertex lies between them (the widest empty
    // stretch behind the middle; none on a delta wing)
    const BINS: usize = 200;
    let mut occ = [false; BINS];
    for &i in &wingv {
        occ[((v[i].pos[1] + 0.5) * BINS as f32).floor().clamp(0.0, (BINS - 1) as f32) as usize] = true;
    }
    let (mut split, mut best) = (f32::NEG_INFINITY, 0);
    let mut i = 0;
    while i < BINS / 2 {
        if occ[i] {
            i += 1;
            continue;
        }
        let mut j = i;
        while j < BINS && !occ[j] {
            j += 1;
        }
        if occ[..i].iter().any(|&o| o) && j < BINS && j - i > best && j - i >= BINS / 25 && (i + j) < BINS {
            best = j - i;
            split = (i + j) as f32 / 2.0 / BINS as f32 - 0.5;
        }
        i = j;
    }
    // across the span in strips: the leading and trailing edges, the hinge at its share of the chord
    const STRIPS: usize = 24;
    let xw = (xmax - x0) / STRIPS as f32;
    let mut per: Vec<[Vec<usize>; 2]> = (0..STRIPS).map(|_| [Vec::new(), Vec::new()]).collect();
    for &i in &wingv {
        let s = (((v[i].pos[0].abs() - x0) / xw).floor().max(0.0) as usize).min(STRIPS - 1);
        per[s][(v[i].pos[1] < split) as usize].push(i);
    }
    let mut root = None;
    let mut spoilers = Vec::new();
    for w in 0..2 {
        let le = median5(&per.iter().map(|p| p[w].iter().map(|&i| v[i].pos[1]).reduce(f32::max)).collect::<Vec<_>>());
        let te = median5(&per.iter().map(|p| p[w].iter().map(|&i| v[i].pos[1]).reduce(f32::min)).collect::<Vec<_>>());
        for s in 0..STRIPS {
            let (Some(l), Some(t)) = (le[s], te[s]) else { continue };
            let c = l - t;
            if c < 0.01 || per[s][w].is_empty() {
                continue;
            }
            if w == 0 && root.is_none() {
                let under = per[s][w].iter().map(|&i| v[i].pos[2]).fold(f32::MAX, f32::min);
                root = Some((l, t, under));
            }
            let hy = t + if w == 0 { 0.27 } else { 0.32 } * c;
            let mut zs: Vec<f32> = per[s][w].iter().filter(|&&i| (v[i].pos[1] - hy).abs() < 0.15 * c).map(|&i| v[i].pos[2]).collect();
            if zs.is_empty() {
                zs = per[s][w].iter().map(|&i| v[i].pos[2]).collect();
            }
            zs.sort_by(|a, b| a.total_cmp(b));
            let hzz = zs[zs.len() / 2];
            let half = 0.06 * c + 0.003;
            let kind = if w == 1 { 3.0 } else if s >= STRIPS * 2 / 3 { 1.0 } else { 2.0 };
            if kind == 2.0 && s > 0 {
                // the spoilers: ahead of the flap, on the wing's top
                let top = per[s][w].iter().filter(|&&i| v[i].pos[1] > hy && v[i].pos[1] < hy + 0.3 * c).map(|&i| v[i].pos[2]).reduce(f32::max);
                if let Some(top) = top {
                    spoilers.push((x0 + s as f32 * xw, x0 + (s + 1) as f32 * xw, hy, c, top));
                }
            }
            for &i in &per[s][w] {
                if v[i].pos[1] < hy && (v[i].pos[2] - hzz).abs() < half {
                    v[i].anim = [kind, hy, hzz, 0.0];
                }
            }
        }
    }
    // the rudder: the rear of the fin, from a little above the fuselage
    let finv: Vec<usize> = (0..v.len()).filter(|&i| v[i].info[0] == 1.0).collect();
    if let Some(top) = finv.iter().map(|&i| v[i].pos[2]).reduce(f32::max) {
        let z0 = zmax + 0.3 * hz;
        let n = 8usize;
        let zw = ((top - z0) / n as f32).max(1e-4);
        let mut rows: Vec<Vec<usize>> = vec![Vec::new(); n];
        for &i in &finv {
            if v[i].pos[2] > z0 {
                rows[(((v[i].pos[2] - z0) / zw) as usize).min(n - 1)].push(i);
            }
        }
        for r in &rows {
            let (Some(l), Some(t)) = (r.iter().map(|&i| v[i].pos[1]).reduce(f32::max), r.iter().map(|&i| v[i].pos[1]).reduce(f32::min)) else { continue };
            let hy = t + 0.32 * (l - t);
            for &i in r {
                if v[i].pos[1] < hy {
                    v[i].anim = [4.0, hy, 0.0, 0.0];
                }
            }
        }
    }
    // how far each part of the wing bends (not the tailplane): with the square of the way out
    for p in v.iter_mut() {
        let x = p.pos[0].abs();
        let part = p.info[0];
        if x > x0 && (part == 3.0 || part == 4.0 || (part == 2.0 && p.pos[1] >= split)) {
            let f = ((x - x0) / (xmax - x0)).clamp(0.0, 1.0);
            p.color[0] = f * f * xmax;
        }
    }
    // the engines under the wing: each side's engine vertices in runs across the span
    let mut engines = Vec::new();
    for side in [-1.0f32, 1.0] {
        let mut ev: Vec<usize> = (0..v.len()).filter(|&i| v[i].info[0] == 3.0 && v[i].pos[0] * side > 0.0).collect();
        ev.sort_by(|&a, &b| v[a].pos[0].abs().total_cmp(&v[b].pos[0].abs()));
        let mut runs: Vec<Vec<usize>> = Vec::new();
        for &i in &ev {
            match runs.last_mut() {
                Some(r) if v[i].pos[0].abs() - v[*r.last().unwrap()].pos[0].abs() < 0.02 => r.push(i),
                _ => runs.push(vec![i]),
            }
        }
        for r in runs.iter().filter(|r| r.len() > 30) {
            let ext = |k: usize| r.iter().fold((f32::MAX, f32::MIN), |(a, b), &i| (a.min(v[i].pos[k]), b.max(v[i].pos[k])));
            let ((xa, xb), (ya, yb), (za, zb)) = (ext(0), ext(1), ext(2));
            let (dx, dz) = (xb - xa, zb - za);
            if dx < 0.005 || dz < 0.4 * dx || dz > 2.5 * dx {
                continue;
            }
            let (hx, hzc, rad) = ((xa + xb) / 2.0, (za + zb) / 2.0, dx.max(dz) / 2.0);
            engines.push((hx, hzc, rad, za));
            if model_data().props.contains_key(file) {
                continue;
            }
            // the thrust reverser's parts (the shader moves them for the type's kind): the outer skin of the rear of
            // the cowl slides back as a translating sleeve, the rear fifth swings shut behind it as buckets
            let el = (yb - ya).max(1e-4);
            for &i in r {
                let p = v[i].pos;
                let tt = (yb - p[1]) / el;
                if tt > 0.55 && v[i].anim[0] == 0.0 {
                    let rr = ((p[0] - hx).powi(2) + (p[2] - hzc).powi(2)).sqrt();
                    let slide = if rr > 0.75 * rad { 0.16 * el } else { 0.0 };
                    v[i].anim = [8.0, slide, yb - 0.8 * el, hzc];
                }
            }
            // a jet's fan: the faces in the front of the nacelle that look forwards, inside its lip
            for &i in r {
                let p = v[i].pos;
                let rr = ((p[0] - hx).powi(2) + (p[2] - hzc).powi(2)).sqrt();
                if p[1] > yb - 0.3 * (yb - ya) && v[i].normal[1].abs() > 0.6 && rr < 0.85 * rad {
                    v[i].anim = [6.0, hx, hzc, rad];
                }
            }
        }
    }
    // the propellers, where the data puts them: blades and spinner turn round the hub
    if let Some(pr) = model_data().props.get(file) {
        let g = |k: &str| pr[k].as_f64().unwrap_or(0.0) as f32;
        let (px, pz, py, r, t, tip) = (g("x"), g("z"), g("y"), g("r"), g("t").max(0.002), g("tip"));
        let blade = rgb(&pr["blade"]).unwrap_or([0.07, 0.07, 0.08]);
        let metal = pr.get("blade").is_some();
        for side in [-1.0f32, 1.0] {
            let hx = side * px;
            let bend = {
                let f = ((px - x0) / (xmax - x0)).clamp(0.0, 1.0);
                f * f * xmax
            };
            for p in v.iter_mut() {
                if p.pos[0] * side <= 0.0 {
                    continue;
                }
                let dy = p.pos[1] - py;
                let rr = ((p.pos[0] - hx).powi(2) + (p.pos[2] - pz).powi(2)).sqrt();
                let on_blade = dy.abs() < 2.5 * t && rr < 1.08 * r;
                let spinner = dy > -3.0 * t && p.pos[1] < tip + 0.003 && rr < 0.22 * r;
                if on_blade || spinner {
                    p.anim = [5.0, hx, pz, 0.0];
                    p.info[0] = 5.0;
                    let c = if on_blade && !metal && rr > 0.9 * r { [0.95, 0.78, 0.1] } else { blade };
                    p.color = [c[0], c[1], c[2], 1.0];
                    let _ = bend;
                }
            }
        }
    }
    Shape { root, engines, spoilers, bend: (x0, xmax) }
}

/// The spoiler panels on top of the wings (thin plates hinged at their front edge, in the wing's colour, bending
/// with it), ahead of the flaps: a panel a strip, a little apart.
fn add_spoilers(v: &mut Vec<Vertex>, ix: &mut Vec<u32>, shape: &Shape) {
    let (x0, xmax) = shape.bend;
    for &(xa, xb, hy, c, top) in &shape.spoilers {
        let (y0, y1) = (hy + 0.01 * c, hy + 0.19 * c);
        let th = 0.0015;
        let gap = 0.06 * (xb - xa);
        for side in [-1.0f32, 1.0] {
            let (a, b) = (side * (xa + gap), side * (xb - gap));
            let xm = (xa + xb) / 2.0;
            let f = ((xm - x0) / (xmax - x0)).clamp(0.0, 1.0);
            let bend = f * f * xmax;
            let c3 = Vec3::new((a + b) / 2.0, (y0 + y1) / 2.0, top + th);
            let h = Vec3::new((b - a).abs() / 2.0, (y1 - y0) / 2.0, th);
            for axis in 0..3 {
                for s in [-1.0f32, 1.0] {
                    let mut n = Vec3::ZERO;
                    n[axis] = s;
                    let (aa, bb) = ((axis + 1) % 3, (axis + 2) % 3);
                    let base = v.len() as u32;
                    for (ua, ub) in [(-1.0f32, -1.0f32), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
                        let mut p = c3;
                        p[axis] += s * h[axis];
                        p[aa] += ua * h[aa];
                        p[bb] += ub * h[bb];
                        v.push(Vertex { pos: p.to_array(), normal: n.to_array(), info: [2.0, 0.0, p.y], anim: [10.0, y1, top, 0.0], color: [bend, 0.0, 0.0, 0.0] });
                    }
                    ix.extend([base, base + 1, base + 2, base, base + 2, base + 3]);
                }
            }
        }
    }
}

/// A box of the landing gear: centre, half sizes, colour; it folds up to `fold`.
fn push_box(v: &mut Vec<Vertex>, ix: &mut Vec<u32>, c: Vec3, h: Vec3, col: [f32; 3], fold: f32) {
    push_box_as(v, ix, c, h, col, fold, 0.0, None);
}

/// A box of the gear that slides with a shock absorber (`slide`: 1 main, 2 nose), or painted as the livery's
/// fuselage underside (`belly`: a gear door).
#[allow(clippy::too_many_arguments)]
fn push_box_as(v: &mut Vec<Vertex>, ix: &mut Vec<u32>, c: Vec3, h: Vec3, col: [f32; 3], fold: f32, slide: f32, belly: Option<f32>) {
    for axis in 0..3 {
        for s in [-1.0f32, 1.0] {
            let mut n = Vec3::ZERO;
            n[axis] = s;
            let (a, b) = ((axis + 1) % 3, (axis + 2) % 3);
            let base = v.len() as u32;
            for (ua, ub) in [(-1.0f32, -1.0f32), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
                let mut p = c;
                p[axis] += s * h[axis];
                p[a] += ua * h[a];
                p[b] += ub * h[b];
                let info = match belly { Some(y) => [0.0, -1.0, y], None => [5.0, 0.0, 0.0] };
                v.push(Vertex { pos: p.to_array(), normal: n.to_array(), info, anim: [7.0, fold, slide, 0.0], color: [col[0], col[1], col[2], 1.0] });
            }
            ix.extend([base, base + 1, base + 2, base, base + 2, base + 3]);
        }
    }
}

/// A tyre (a cylinder across, along x) with a lighter wheel in its sides.
fn push_wheel(v: &mut Vec<Vertex>, ix: &mut Vec<u32>, c: Vec3, r: f32, w: f32, fold: f32, slide: f32) {
    const N: usize = 14;
    let tyre = [0.06, 0.06, 0.065];
    let rim = [0.62, 0.63, 0.65];
    let mk = |p: Vec3, n: Vec3, col: [f32; 3]| Vertex { pos: p.to_array(), normal: n.to_array(), info: [5.0, 0.0, 0.0], anim: [7.0, fold, slide, 0.0], color: [col[0], col[1], col[2], 1.0] };
    let base = v.len() as u32;
    for k in 0..=N {
        let a = k as f32 / N as f32 * std::f32::consts::TAU;
        let n = Vec3::new(0.0, a.cos(), a.sin());
        for s in [-0.5f32, 0.5] {
            v.push(mk(c + Vec3::new(s * w, r * a.cos(), r * a.sin()), n, tyre));
        }
    }
    for k in 0..N as u32 {
        let (a, b) = (base + 2 * k, base + 2 * k + 2);
        ix.extend([a, b, a + 1, b, b + 1, a + 1]);
    }
    for s in [-0.5f32, 0.5] {
        let n = Vec3::new(s.signum(), 0.0, 0.0);
        let mid = v.len() as u32;
        v.push(mk(c + Vec3::new(s * w * 1.02, 0.0, 0.0), n, rim));
        for k in 0..=N {
            let a = k as f32 / N as f32 * std::f32::consts::TAU;
            v.push(mk(c + Vec3::new(s * w * 1.02, r * a.cos(), r * a.sin()), n, if k % 2 == 0 { tyre } else { tyre }));
        }
        for k in 0..N as u32 {
            ix.extend([mid, mid + 1 + k, mid + 2 + k]);
        }
    }
}

/// The landing gear of a model without gear of its own, from FG.data.gear (js/gear3d.js, more simply): the nose
/// gear (or a tail wheel), the main legs under the wing root, in the nacelles or on the fuselage sides, the legs
/// under the fuselage of the big ones, each with its tyres as rows × across. Returns the height of the ground
/// under the wheels (model units).
fn add_gear(v: &mut Vec<Vertex>, ix: &mut Vec<u32>, file: &str, shape: &Shape, rx: f32, zb: f32, zlow: f32) -> f32 {
    let md = model_data();
    if md.on_gear.iter().any(|f| f == file) {
        return zlow;
    }
    let (len_m, dia_m) = md.size.get(file).copied().unwrap_or((30.0, 3.5));
    let u = 1.0 / len_m;
    let spec = md.gear.get(file).cloned().unwrap_or(Value::Null);
    let num = |k: &str| spec[k].as_f64().map(|x| x as f32);
    let ground = (zb - 0.42 * dia_m * u).min(zlow - 0.35 * u);
    let tyre = num("tyre").unwrap_or(1.1) * u;
    let grey = [0.76, 0.77, 0.79];
    // the fuselage's underside at y (model units)
    let under = |y: f32| {
        v.iter()
            .filter(|p| p.info[0] == 0.0 && p.pos[0].abs() < 0.5 * rx && (p.pos[1] - y).abs() < 0.02)
            .map(|p| p.pos[2])
            .reduce(f32::min)
            .unwrap_or(zb)
    };
    let wheels = |s: &str| {
        let mut it = s.split('x').map(|n| n.parse::<usize>().unwrap_or(1));
        (it.next().unwrap_or(1), it.next().unwrap_or(2))
    };
    // one leg: from `top` down to its wheels on the ground
    let mut legs: Vec<(f32, f32, f32, f32, (usize, usize), f32)> = Vec::new(); // x, y, top, tyre, rows × across, 1 main 2 nose 0 tail
    let main = spec["main"].as_str().unwrap_or("wing");
    let main_y = match (num("mainAt"), shape.root) {
        (Some(at), _) => 0.5 - at,
        (None, Some((le, te, _))) => le - if main == "wing" { 0.65 } else { 0.55 } * (le - te),
        _ => 0.0,
    };
    let mw = wheels(spec["wheels"].as_str().unwrap_or("1x2"));
    let (mx, mtop) = match main {
        "nacelle" => {
            let px = md.props.get(file).and_then(|p| p["x"].as_f64()).map(|x| x as f32);
            let eng = shape.engines.iter().find(|e| e.0 > 0.0).copied();
            match (px, eng) {
                (_, Some(e)) => (px.unwrap_or(e.0), e.3),
                (Some(x), None) => (x, under(main_y) + 0.3 * (zb.abs())),
                _ => (2.5 * rx, under(main_y)),
            }
        }
        "body" => (num("track").unwrap_or(0.9) * 2.0 * rx, under(main_y) + 0.02),
        _ => (num("track").unwrap_or(0.9) * 2.0 * rx, shape.root.map(|r| r.2).unwrap_or(zb)),
    };
    for s in [-1.0f32, 1.0] {
        legs.push((s * mx, main_y, mtop, tyre, mw, 1.0));
    }
    if spec["body"].is_object() {
        let b = &spec["body"];
        let bt = b["track"].as_f64().unwrap_or(0.0) as f32 * 2.0 * rx;
        let by = main_y - b["aft"].as_f64().unwrap_or(0.03) as f32;
        let bw = wheels(b["wheels"].as_str().unwrap_or("2x2"));
        if bt < 1e-4 {
            legs.push((0.0, by, under(by), tyre, bw, 1.0));
        } else {
            for s in [-1.0f32, 1.0] {
                legs.push((s * bt, by, under(by), tyre, bw, 1.0));
            }
        }
    }
    if spec["tail"].as_bool().unwrap_or(false) {
        legs.push((0.0, -0.41, under(-0.41), tyre * 0.4, (1, 1), 0.0));
    } else {
        let ny = 0.5 - num("nose").unwrap_or(0.11);
        legs.push((0.0, ny, under(ny), num("noseTyre").map(|t| t * u).unwrap_or(tyre * 0.68), (1, 2), 2.0));
    }
    let chrome = [0.86, 0.87, 0.9];
    for (x, y, top, d, (rows, across), slide) in legs {
        let r = d / 2.0;
        let w = 0.36 * d;
        let axle = ground + r;
        let top = top.max(axle + 0.2 * d);
        let leg = 0.06 * d.max(0.6 * u);
        if slide > 0.0 {
            // the shock absorber: the cylinder above, the shiny piston below sliding out of it (reaching well up
            // inside it, so no gap opens with the leg out), the axle and the wheels on the piston
            let mid = axle + 0.45 * (top - axle);
            push_box(v, ix, Vec3::new(x, y, (top + mid) / 2.0), Vec3::new(leg, leg, (top - mid) / 2.0), grey, top);
            let ptop = (mid + 0.8 * u).min(top);
            push_box_as(v, ix, Vec3::new(x, y, (ptop + axle) / 2.0), Vec3::new(leg * 0.7, leg * 0.7, (ptop - axle) / 2.0), chrome, top, slide, None);
        } else {
            push_box(v, ix, Vec3::new(x, y, (top + axle) / 2.0), Vec3::new(leg, leg, (top - axle) / 2.0), grey, top);
        }
        if rows > 1 {
            push_box_as(v, ix, Vec3::new(x, y, axle), Vec3::new(leg * 0.8, rows as f32 * d * 0.55, leg * 0.8), grey, top, slide, None);
        }
        for k in 0..rows {
            let wy = y + (k as f32 - (rows as f32 - 1.0) / 2.0) * d * 1.08;
            for j in 0..across {
                let wx = if across == 1 { x } else { x + (j as f32 - (across as f32 - 1.0) / 2.0) * (w * 1.15 + 2.0 * leg) };
                push_wheel(v, ix, Vec3::new(wx, wy, axle), r, w, top, slide);
            }
        }
        // the gear doors, in the fuselage underside's colour (they go with the gear): a main leg's on its outer
        // side, the nose bay's two hanging open beside it
        let dz = 0.55 * (top - axle);
        if slide == 1.0 && x.abs() > 1e-4 {
            let s = x.signum();
            push_box_as(v, ix, Vec3::new(x + s * leg * 2.2, y, top - dz / 2.0), Vec3::new(0.12 * leg, 0.45 * d, dz / 2.0), grey, top, 0.0, Some(y));
        } else if slide == 2.0 {
            for s in [-1.0f32, 1.0] {
                push_box_as(v, ix, Vec3::new(x + s * (leg * 2.5 + 0.2 * d), y, top - dz * 0.4), Vec3::new(0.1 * leg, 0.7 * d, dz * 0.4), grey, top, 0.0, Some(y));
            }
        }
    }
    ground
}

/// A low round puff (a sphere 1 across, squashed by its instance), for the clouds.
fn sphere() -> (Vec<Vertex>, Vec<u32>) {
    let (rings, segs) = (7usize, 12usize);
    let mut v = Vec::new();
    let mut ix = Vec::new();
    for i in 0..=rings {
        let th = i as f32 / rings as f32 * std::f32::consts::PI;
        for j in 0..=segs {
            let ph = j as f32 / segs as f32 * std::f32::consts::TAU;
            let n = [th.sin() * ph.cos(), th.sin() * ph.sin(), th.cos()];
            v.push(vx([n[0] * 0.5, n[1] * 0.5, n[2] * 0.5], n, [7.0, 0.0, 0.0]));
        }
    }
    for i in 0..rings as u32 {
        for j in 0..segs as u32 {
            let a = i * (segs as u32 + 1) + j;
            let b = a + segs as u32 + 1;
            ix.extend([a, b, a + 1, b, b + 1, a + 1]);
        }
    }
    (v, ix)
}

// ---------- the airports' buildings ----------

/// Ear clipping: the triangles of a simple polygon.
fn triangulate(p: &[(f32, f32)]) -> Vec<[usize; 3]> {
    let n = p.len();
    if n < 3 {
        return Vec::new();
    }
    let area: f32 = (0..n).map(|i| p[i].0 * p[(i + 1) % n].1 - p[(i + 1) % n].0 * p[i].1).sum();
    let mut idx: Vec<usize> = (0..n).collect();
    if area < 0.0 {
        idx.reverse();
    }
    let cross = |a: (f32, f32), b: (f32, f32), c: (f32, f32)| (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
    let mut out = Vec::new();
    let mut guard = 0;
    while idx.len() > 3 && guard < n * n {
        guard += 1;
        let m = idx.len();
        let mut found = false;
        for k in 0..m {
            let (a, b, c) = (idx[(k + m - 1) % m], idx[k], idx[(k + 1) % m]);
            if cross(p[a], p[b], p[c]) <= 1e-6 {
                continue;
            }
            let inside = idx.iter().any(|&o| {
                o != a && o != b && o != c && cross(p[a], p[b], p[o]) >= 0.0 && cross(p[b], p[c], p[o]) >= 0.0 && cross(p[c], p[a], p[o]) >= 0.0
            });
            if inside {
                continue;
            }
            out.push([a, b, c]);
            idx.remove(k);
            found = true;
            break;
        }
        if !found {
            break;
        }
    }
    // (what is left, if the ring crosses itself: a fan)
    for k in 1..idx.len().saturating_sub(1) {
        out.push([idx[0], idx[k], idx[k + 1]]);
    }
    out
}

/// The buildings of an airport with a layout, in metres east and north of its point: terminals (with bands of
/// windows), hangars (ribbed), the others, each extruded to a height after its kind and size, with a flat roof.
fn building_mesh(code: &str) -> Option<Mesh> {
    let l = flightgame::layouts::layout(code)?;
    let a = data().try_airport(code)?;
    let mut v = Vec::new();
    let mut ix = Vec::new();
    for (rings, kind) in [(&l.terminals, 0), (&l.hangars, 1), (&l.others, 2)] {
        for r in rings.iter() {
            let mut pts: Vec<(f32, f32)> = r.iter().map(|&(la, lo)| {
                let (x, y) = local(a.lat, a.lon, la, lo);
                (x as f32, y as f32)
            }).collect();
            if pts.len() > 2 && (pts[0].0 - pts[pts.len() - 1].0).abs() < 0.01 && (pts[0].1 - pts[pts.len() - 1].1).abs() < 0.01 {
                pts.pop();
            }
            if pts.len() < 3 {
                continue;
            }
            let n = pts.len();
            let area = (0..n).map(|i| pts[i].0 * pts[(i + 1) % n].1 - pts[(i + 1) % n].0 * pts[i].1).sum::<f32>().abs() / 2.0;
            let side = area.sqrt();
            let (h, wall, roof, style) = match kind {
                0 => ((side * 0.12).clamp(10.0, 24.0), [0.78, 0.8, 0.83], [0.56, 0.58, 0.6], 1.0),
                1 => ((side * 0.16).clamp(10.0, 28.0), [0.82, 0.84, 0.86], [0.5, 0.53, 0.56], 2.0),
                _ => ((side * 0.1).clamp(5.0, 16.0), [0.76, 0.72, 0.66], [0.5, 0.47, 0.44], if side > 40.0 { 1.0 } else { 0.0 }),
            };
            // walls
            let mut along = 0.0f32;
            for i in 0..n {
                let (p, q) = (pts[i], pts[(i + 1) % n]);
                let d = ((q.0 - p.0).powi(2) + (q.1 - p.1).powi(2)).sqrt();
                if d < 0.01 {
                    continue;
                }
                let nrm = [(q.1 - p.1) / d, -(q.0 - p.0) / d, 0.0];
                let base = v.len() as u32;
                for (x, y, z, s) in [(p.0, p.1, 0.0, along), (q.0, q.1, 0.0, along + d), (q.0, q.1, h, along + d), (p.0, p.1, h, along)] {
                    v.push(Vertex { pos: [x, y, z], normal: nrm, info: [6.0, z, s], anim: [0.0, style, h, 0.0], color: [wall[0], wall[1], wall[2], 1.0] });
                }
                ix.extend([base, base + 1, base + 2, base, base + 2, base + 3]);
                along += d;
            }
            // the roof
            let base = v.len() as u32;
            for p in &pts {
                v.push(Vertex { pos: [p.0, p.1, h], normal: [0.0, 0.0, 1.0], info: [5.0, 0.0, 0.0], anim: [0.0; 4], color: [roof[0], roof[1], roof[2], 1.0] });
            }
            for t in triangulate(&pts) {
                ix.extend([base + t[0] as u32, base + t[1] as u32, base + t[2] as u32]);
            }
        }
    }
    if ix.is_empty() {
        return None;
    }
    Some(Mesh { vertices: v, indices: ix, ground: 0.0 })
}

// ---------- satellite ground ----------

/// The satellite pictures under the camera: 4 × 4 tiles of Esri's World Imagery, fetched in the background.
pub struct Ground {
    /// the tiles asked for last: (zoom, tile x, tile y of the top-left one)
    want: (u32, u32, u32),
    /// the tiles the picture shows (None: none yet, a plain colour)
    shown: Option<(u32, u32, u32)>,
    loading: bool,
    pub(crate) pixels: Option<Vec<u8>>,
    pub(crate) fresh: bool,
}

/// The ground picture's size (pixels a side).
pub(crate) const GROUND_PX: u32 = 256 * GROUND_TILES;

const GROUND_TILES: u32 = 4;

fn tile_of(lat: f64, lon: f64, z: u32) -> (f64, f64) {
    let n = 2f64.powi(z as i32);
    let x = (lon + 180.0) / 360.0 * n;
    let lr = lat.to_radians();
    let y = (1.0 - (lr.tan() + 1.0 / lr.cos()).ln() / std::f64::consts::PI) / 2.0 * n;
    (x, y)
}

fn tile_corner(x: f64, y: f64, z: u32) -> (f64, f64) {
    let n = 2f64.powi(z as i32);
    let lon = x / n * 360.0 - 180.0;
    let lat = (std::f64::consts::PI * (1.0 - 2.0 * y / n)).sinh().atan().to_degrees();
    (lat, lon)
}

fn fetch_ground(key: (u32, u32, u32), out: Arc<Mutex<Ground>>) {
    std::thread::spawn(move || {
        let (z, x0, y0) = key;
        let size = 256 * GROUND_TILES as usize;
        let mut img = vec![60u8; size * size * 4];
        for ty in 0..GROUND_TILES {
            for tx in 0..GROUND_TILES {
                let url = format!(
                    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{}/{}",
                    y0 + ty,
                    x0 + tx
                );
                // kept on disk: the same airports come back again and again
                let file = dirs::cache_dir().map(|d| d.join("Flightgame").join("sat3d").join(format!("{z}_{}_{}.jpg", x0 + tx, y0 + ty)));
                let cached = file.as_ref().and_then(|f| std::fs::read(f).ok());
                let bytes = match cached {
                    Some(b) => b,
                    None => {
                        let Ok(mut resp) = ureq::get(&url).header("User-Agent", "flightgame/0.1").call() else { continue };
                        let Ok(b) = resp.body_mut().read_to_vec() else { continue };
                        if let Some(f) = &file {
                            let _ = std::fs::create_dir_all(f.parent().unwrap());
                            let _ = std::fs::write(f, &b);
                        }
                        b
                    }
                };
                let Ok(tile) = image::load_from_memory(&bytes) else { continue };
                let tile = tile.to_rgba8();
                for py in 0..256usize.min(tile.height() as usize) {
                    for px in 0..256usize.min(tile.width() as usize) {
                        let p = tile.get_pixel(px as u32, py as u32).0;
                        let o = ((ty as usize * 256 + py) * size + tx as usize * 256 + px) * 4;
                        img[o..o + 4].copy_from_slice(&p);
                    }
                }
            }
        }
        if let Ok(mut g) = out.lock() {
            g.pixels = Some(img);
            g.shown = Some(key);
            g.fresh = true;
            g.loading = false;
        }
    });
}

// ---------- the frame ----------

/// One aircraft to draw: its model, where (in metres from the camera's reference point, x east, y north, z up),
/// its heading, pitch and bank, its length, its livery, and how its moving parts stand.
#[derive(Clone)]
pub struct Plane {
    pub file: String,
    pub mesh: Arc<Mesh>,
    pub at: Vec3,
    pub heading: f32,
    pub pitch: f32,
    pub bank: f32,
    pub len: f32,
    pub livery: Livery,
    /// propellers' angle, flaps, ailerons, elevators (radians)
    pub anim0: [f32; 4],
    /// rudder (radians), wing bend (half spans), gear down (0 … 1), how sharp the fans' blades look
    pub anim1: [f32; 4],
    /// thrust reversers out (0 … 1), on which engines (0 all, above 0 those nearer than it, below 0 those further
    /// out than -it), the main and nose legs' shock absorbers out from standing (model units)
    pub anim2: [f32; 4],
    /// spoilers up (radians), the reversers' kind (0 none, 1 translating sleeve, 2 pivoting doors, 3 buckets)
    pub anim3: [f32; 4],
}

/// One cloud puff: where (metres), its size (m), its colour and how thick it is.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Puff {
    pub(crate) at: [f32; 3],
    pub(crate) size: [f32; 3],
    pub(crate) color: [f32; 4],
}

/// What a frame of the 3D view draws.
#[derive(Clone)]
pub struct Frame {
    pub view_proj: Mat4,
    pub eye: Vec3,
    /// where the camera looks, which way is up for it
    pub target: Vec3,
    pub up: Vec3,
    /// the sun's true direction (east, north, up) for the Bevy renderer's sky; the classic one's `sun` is lifted
    pub sun_true: Vec3,
    pub sun: Vec3,
    /// how light it is (0 night … 1 day)
    pub light: f32,
    /// the haze's colour and how thick it is (per metre)
    pub fog: [f32; 4],
    pub planes: Vec<Plane>,
    /// the airports' buildings: key, where the airport's point is, the mesh
    pub buildings: Vec<(String, Vec3, Arc<Mesh>)>,
    pub puffs: Arc<Vec<Puff>>,
    /// the ground picture's corners (metres from the reference point): x0, y0 (south-west), x1, y1 (north-east)
    pub ground_rect: [f32; 4],
    pub ground: Arc<Mutex<Ground>>,
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniforms {
    view_proj: [[f32; 4]; 4],
    model: [[f32; 4]; 4],
    body: [f32; 4],
    wing: [f32; 4],
    engine: [f32; 4],
    fin: [f32; 4],
    /// belly colour, its "from" in w
    belly: [f32; 4],
    /// sun direction, light in w
    sun: [f32; 4],
    /// x: the tail colour goes on round the rear (1), y: draw the ground (1) or a model (0)
    flags: [f32; 4],
    /// ground rect
    ground: [f32; 4],
    anim0: [f32; 4],
    anim1: [f32; 4],
    eye: [f32; 4],
    fog: [f32; 4],
    anim2: [f32; 4],
    anim3: [f32; 4],
}

const UNIFORM_STRIDE: u64 = 512;
const MAX_DRAWS: u64 = 96;
const MAX_PUFFS: usize = 900;

type GpuMesh = Option<(wgpu::Buffer, wgpu::Buffer, u32)>;

struct Gpu {
    pipeline: wgpu::RenderPipeline,
    clouds: wgpu::RenderPipeline,
    uniforms: wgpu::Buffer,
    bind: wgpu::BindGroup,
    ground_layout: wgpu::BindGroupLayout,
    ground_bind: wgpu::BindGroup,
    ground_tex: wgpu::Texture,
    ground_vb: wgpu::Buffer,
    sphere: (wgpu::Buffer, wgpu::Buffer, u32),
    puffs: wgpu::Buffer,
    puff_count: u32,
    meshes: HashMap<String, GpuMesh>,
    sampler: wgpu::Sampler,
    /// the screen takes linear light (an sRGB format): colours are converted
    srgb: bool,
    /// what this frame draws: (mesh key, uniform slot)
    draws: Vec<(String, u32)>,
    ground_slot: Option<u32>,
}

const SHADER: &str = r#"
struct U {
    view_proj: mat4x4<f32>,
    model: mat4x4<f32>,
    body: vec4<f32>,
    wing: vec4<f32>,
    engine: vec4<f32>,
    fin: vec4<f32>,
    belly: vec4<f32>,
    sun: vec4<f32>,
    flags: vec4<f32>,
    ground: vec4<f32>,
    anim0: vec4<f32>,
    anim1: vec4<f32>,
    eye: vec4<f32>,
    fog: vec4<f32>,
    anim2: vec4<f32>,
    anim3: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: U;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;

struct VOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) info: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) world: vec3<f32>,
    @location(4) anim: vec4<f32>,
    @location(5) color: vec4<f32>,
    @location(6) mpos: vec3<f32>,
    @location(7) rev: f32,
};

fn rot2(v: vec2<f32>, a: f32) -> vec2<f32> {
    let c = cos(a);
    let s = sin(a);
    return vec2<f32>(v.x * c - v.y * s, v.x * s + v.y * c);
}

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) info: vec3<f32>,
           @location(3) anim: vec4<f32>, @location(4) color: vec4<f32>) -> VOut {
    var p = pos;
    var n = normal;
    var rv = 0.0;
    let k = anim.x;
    if (k > 0.5 && k < 3.5) {
        // ailerons (opposite either side), flaps, elevators: round their hinge, the trailing edge down for +
        var a = u.anim0.y;
        if (k < 1.5) { a = u.anim0.z * sign(p.x); }
        if (k > 2.5) { a = u.anim0.w; }
        let d = rot2(vec2<f32>(p.y - anim.y, p.z - anim.z), a);
        p.y = anim.y + d.x;
        p.z = anim.z + d.y;
        let nn = rot2(n.yz, a);
        n = vec3<f32>(n.x, nn.x, nn.y);
    } else if (k > 3.5 && k < 4.5) {
        // the rudder, round its hinge line
        let d = rot2(vec2<f32>(p.x, p.y - anim.y), u.anim1.x);
        p.x = d.x;
        p.y = anim.y + d.y;
    } else if (k > 4.5 && k < 5.5) {
        // propellers turn round their hub (opposite either side)
        let d = rot2(vec2<f32>(p.x - anim.y, p.z - anim.z), u.anim0.x * sign(anim.y));
        p.x = anim.y + d.x;
        p.z = anim.z + d.y;
        let nn = rot2(n.xz, u.anim0.x * sign(anim.y));
        n = vec3<f32>(nn.x, n.y, nn.y);
    } else if (k > 6.5 && k < 7.5) {
        // the shock absorbers: the pistons, axles and wheels slide out of the legs
        if (anim.z > 0.5) {
            p.z = p.z - select(u.anim2.w, u.anim2.z, anim.z < 1.5);
        }
        // the landing gear folds up into the aircraft
        let g = u.anim1.z;
        if (g < 0.02) {
            p = vec3<f32>(0.0, 0.0, anim.y);
        } else {
            p.z = anim.y + (p.z - anim.y) * g;
        }
    } else if (k > 7.5 && k < 8.5) {
        // thrust reversers, on the engines that have them
        let on = u.anim2.y == 0.0 || (u.anim2.y > 0.0 && abs(p.x) < u.anim2.y) || (u.anim2.y < 0.0 && abs(p.x) > -u.anim2.y);
        let rk = u.anim3.y;
        if (u.anim2.x > 0.001 && on) {
            if (rk > 0.5 && rk < 2.5) {
                // a translating sleeve slides back (pivoting doors: their rear opens about as far), the cascade
                // vanes in the gap
                if (anim.y > 0.0) {
                    p.y = p.y - anim.y * u.anim2.x * select(1.0, 0.7, rk > 1.5);
                    rv = 1.0;
                }
            } else if (rk > 2.5 && p.y < anim.z) {
                // target buckets: the rear of the exhaust in two halves swings back and shut behind it
                let a = select(-1.0, 1.0, p.z >= anim.w) * 1.0 * u.anim2.x;
                let d = rot2(vec2<f32>(p.y - anim.z, p.z - anim.w), a);
                p.y = anim.z + d.x;
                p.z = anim.w + d.y;
                let nn = rot2(n.yz, a);
                n = vec3<f32>(n.x, nn.x, nn.y);
                rv = 1.0;
            }
        }
    } else if (k > 9.5 && k < 10.5) {
        // spoilers: up about their front edge
        let a = -u.anim3.x;
        let d = rot2(vec2<f32>(p.y - anim.y, p.z - anim.z), a);
        p.y = anim.y + d.x;
        p.z = anim.z + d.y;
        let nn = rot2(n.yz, a);
        n = vec3<f32>(n.x, nn.x, nn.y);
    }
    if (info.x < 4.5) {
        // the wings bend
        p.z = p.z + u.anim1.y * color.x;
    }
    var o: VOut;
    let w = u.model * vec4<f32>(p, 1.0);
    o.pos = u.view_proj * w;
    o.normal = normalize((u.model * vec4<f32>(n, 0.0)).xyz);
    o.info = info;
    o.anim = anim;
    o.color = color;
    o.mpos = p;
    o.rev = rv;
    o.world = w.xyz;
    o.uv = vec2<f32>((w.x - u.ground.x) / (u.ground.z - u.ground.x), 1.0 - (w.y - u.ground.y) / (u.ground.w - u.ground.y));
    return o;
}

fn hazy(c: vec3<f32>, world: vec3<f32>) -> vec3<f32> {
    let d = distance(world, u.eye.xyz);
    let f = clamp(1.0 - exp(-d * u.fog.w), 0.0, 1.0);
    return mix(c, u.fog.rgb, f);
}

@fragment
fn fs_main(i: VOut) -> @location(0) vec4<f32> {
    let light = u.sun.w;
    if (u.flags.y > 0.5) {
        // the ground: the satellite picture inside its rect, a plain colour around it
        // (beyond it the haze: its edge never shows)
        let beyond = mix(hazy(vec3<f32>(0.30, 0.33, 0.26) * (0.12 + 0.88 * light), i.world), u.fog.rgb, 0.45);
        if (i.uv.x < 0.0 || i.uv.x > 1.0 || i.uv.y < 0.0 || i.uv.y > 1.0) {
            return vec4<f32>(beyond, 1.0);
        }
        let c = textureSample(tex, samp, i.uv).rgb;
        // (and it fades into the haze towards its edge)
        let edge = min(min(i.uv.x, 1.0 - i.uv.x), min(i.uv.y, 1.0 - i.uv.y));
        return vec4<f32>(mix(beyond, hazy(c * (0.12 + 0.88 * light), i.world), smoothstep(0.0, 0.12, edge)), 1.0);
    }
    var c = u.body.rgb;
    var glow = vec3<f32>(0.0);
    let part = i.info.x;
    if (part > 5.5) {
        // a building's wall: bands of windows (lit at night), or ribs
        c = i.color.rgb;
        let h = i.info.y;
        let along = i.info.z;
        if (i.anim.y > 0.5 && i.anim.y < 1.5) {
            let band = fract(h / 4.2);
            if (h > 1.2 && h < i.anim.z - 1.0 && band > 0.3 && band < 0.85) {
                c = vec3<f32>(0.16, 0.22, 0.28) + 0.3 * u.fog.rgb;
                if (fract(along / 2.6) < 0.08) {
                    c = vec3<f32>(0.5, 0.52, 0.55);
                } else {
                    glow = vec3<f32>(1.0, 0.82, 0.5) * 0.55 * (1.0 - light);
                }
            }
        } else if (i.anim.y > 1.5) {
            if (fract(along / 1.4) < 0.14) {
                c = c * 0.8;
            }
            if (h < 0.4) {
                c = c * 0.6;
            }
        }
    } else if (part > 4.5) {
        c = i.color.rgb;
    } else if (part > 3.5) {
        c = vec3<f32>(0.08, 0.09, 0.1);
    } else if (part > 2.5) {
        c = u.engine.rgb;
    } else if (part > 1.5) {
        c = u.wing.rgb;
    } else if (part > 0.5) {
        c = u.fin.rgb;
    } else {
        // the fuselage: the belly below its line, the tail colour round the rear where the livery has it
        if (u.belly.w > 0.0 && i.info.y < 1.0 - 2.0 * u.belly.w) {
            c = u.belly.rgb;
        }
        if (u.flags.x > 0.5 && i.info.z < -0.36) {
            c = u.fin.rgb;
        }
    }
    if (i.anim.x > 5.5 && i.anim.x < 6.5) {
        // a fan's face: its blades turn (blurred the faster they go), the spinner in the middle with its swirl
        let d = i.mpos.xz - i.anim.yz;
        let r = length(d) / max(i.anim.w, 0.0001);
        let ang = atan2(d.y, d.x) + u.anim0.x * sign(i.anim.y);
        let b = fract(ang * 22.0 / 6.2831853);
        let blade = smoothstep(0.2, 0.45, b) - smoothstep(0.55, 0.8, b);
        c = mix(vec3<f32>(0.2, 0.21, 0.23), vec3<f32>(0.55, 0.57, 0.6), 0.5 + (blade - 0.5) * u.anim1.w);
        if (r < 0.3) {
            c = vec3<f32>(0.1, 0.1, 0.11);
            if (fract((ang + r * 9.0) / 6.2831853) < 0.12) {
                c = vec3<f32>(0.9, 0.9, 0.9);
            }
        }
    }
    if (i.rev > 0.02 && i.rev < 0.98) {
        // a thrust reverser's opening (between its moved part and the fixed cowl): dark, ribbed by the cascade vanes
        c = select(vec3<f32>(0.09, 0.095, 0.1), mix(vec3<f32>(0.07, 0.075, 0.08), vec3<f32>(0.2, 0.21, 0.22), step(0.6, fract(i.rev * 7.0))), u.anim3.y < 1.5);
    }
    let n = normalize(i.normal);
    let diffuse = abs(dot(n, normalize(u.sun.xyz)));
    let shade = 0.28 + 0.72 * diffuse;
    return vec4<f32>(hazy(c * shade * (0.18 + 0.82 * light) + glow, i.world), 1.0);
}

struct COut {
    @builtin(position) pos: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) world: vec3<f32>,
    @location(2) color: vec4<f32>,
};

@vertex
fn vs_cloud(@location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>,
            @location(5) at: vec3<f32>, @location(6) size: vec3<f32>, @location(7) color: vec4<f32>) -> COut {
    var o: COut;
    let w = at + pos * size;
    o.pos = u.view_proj * vec4<f32>(w, 1.0);
    o.normal = normalize(normal / size);
    o.world = w;
    o.color = color;
    return o;
}

@fragment
fn fs_cloud(i: COut) -> @location(0) vec4<f32> {
    let light = u.sun.w;
    let n = normalize(i.normal);
    let view = normalize(u.eye.xyz - i.world);
    // soft edges: thin where the puff is seen edge on
    let edge = abs(dot(n, view));
    let a = i.color.a * pow(edge, 1.3);
    let sunlit = 0.72 + 0.28 * max(dot(n, normalize(u.sun.xyz)), 0.0);
    let under = 0.82 + 0.18 * n.z;
    let c = i.color.rgb * sunlit * under * (0.12 + 0.88 * light);
    return vec4<f32>(hazy(c, i.world), a);
}
"#;

fn depth_format() -> wgpu::TextureFormat {
    egui_wgpu::depth_format_from_bits(24, 0).unwrap_or(wgpu::TextureFormat::Depth24Plus)
}

const VERTEX_ATTRS: [wgpu::VertexAttribute; 5] = wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Float32x3, 3 => Float32x4, 4 => Float32x4];
const PUFF_ATTRS: [wgpu::VertexAttribute; 3] = wgpu::vertex_attr_array![5 => Float32x3, 6 => Float32x3, 7 => Float32x4];

/// Sets up the GPU side once (from App::new).
pub fn init(rs: &egui_wgpu::RenderState) {
    let device = &rs.device;
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("view3d"), source: wgpu::ShaderSource::Wgsl(SHADER.into()) });
    let layout0 = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("view3d u"),
        entries: &[wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: true,
                min_binding_size: wgpu::BufferSize::new(std::mem::size_of::<Uniforms>() as u64),
            },
            count: None,
        }],
    });
    let ground_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("view3d ground"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
        ],
    });
    let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("view3d"),
        bind_group_layouts: &[Some(&layout0), Some(&ground_layout)],
        immediate_size: 0,
    });
    let vertex_layout = wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<Vertex>() as u64,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &VERTEX_ATTRS,
    };
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("view3d"),
        layout: Some(&pl),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_main"),
            compilation_options: Default::default(),
            buffers: &[Some(vertex_layout.clone())],
        },
        primitive: wgpu::PrimitiveState { cull_mode: None, ..Default::default() },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: depth_format(),
            depth_write_enabled: Some(true),
            depth_compare: Some(wgpu::CompareFunction::Less),
            stencil: Default::default(),
            bias: Default::default(),
        }),
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState { format: rs.target_format, blend: Some(wgpu::BlendState::REPLACE), write_mask: wgpu::ColorWrites::ALL })],
        }),
        multiview_mask: None,
        cache: None,
    });
    // the clouds: see-through, drawn last, behind what is nearer but not hiding each other
    let clouds = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("view3d clouds"),
        layout: Some(&pl),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_cloud"),
            compilation_options: Default::default(),
            buffers: &[
                Some(vertex_layout),
                Some(wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Puff>() as u64,
                    step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &PUFF_ATTRS,
                }),
            ],
        },
        primitive: wgpu::PrimitiveState { cull_mode: Some(wgpu::Face::Back), ..Default::default() },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: depth_format(),
            depth_write_enabled: Some(false),
            depth_compare: Some(wgpu::CompareFunction::Less),
            stencil: Default::default(),
            bias: Default::default(),
        }),
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_cloud"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState { format: rs.target_format, blend: Some(wgpu::BlendState::ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })],
        }),
        multiview_mask: None,
        cache: None,
    });
    let uniforms = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("view3d u"),
        size: UNIFORM_STRIDE * MAX_DRAWS,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("view3d u"),
        layout: &layout0,
        entries: &[wgpu::BindGroupEntry {
            binding: 0,
            resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                buffer: &uniforms,
                offset: 0,
                size: wgpu::BufferSize::new(std::mem::size_of::<Uniforms>() as u64),
            }),
        }],
    });
    let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        ..Default::default()
    });
    let (ground_tex, ground_bind) = ground_texture(device, &ground_layout, &sampler, 4, 4, rs.target_format.is_srgb());
    // the ground: one big square, 2000 km across (the picture is mapped into it by its rect)
    let s = 1.0e6f32;
    let up = [0.0, 0.0, 1.0];
    let quad: Vec<Vertex> = [[-s, -s], [s, -s], [s, s], [-s, -s], [s, s], [-s, s]].iter().map(|p| vx([p[0], p[1], 0.0], up, [0.0; 3])).collect();
    let ground_vb = buffer(device, bytemuck::cast_slice(&quad), wgpu::BufferUsages::VERTEX);
    let (sv, si) = sphere();
    let sphere = (buffer(device, bytemuck::cast_slice(&sv), wgpu::BufferUsages::VERTEX), buffer(device, bytemuck::cast_slice(&si), wgpu::BufferUsages::INDEX), si.len() as u32);
    let puffs = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("view3d puffs"),
        size: (std::mem::size_of::<Puff>() * MAX_PUFFS) as u64,
        usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    rs.renderer.write().callback_resources.insert(Gpu {
        pipeline,
        clouds,
        uniforms,
        bind,
        ground_layout,
        ground_bind,
        ground_tex,
        ground_vb,
        sphere,
        puffs,
        puff_count: 0,
        meshes: HashMap::new(),
        srgb: rs.target_format.is_srgb(),
        sampler,
        draws: Vec::new(),
        ground_slot: None,
    });
}

fn buffer(device: &wgpu::Device, data: &[u8], usage: wgpu::BufferUsages) -> wgpu::Buffer {
    use wgpu::util::DeviceExt;
    device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: None, contents: data, usage: usage | wgpu::BufferUsages::COPY_DST })
}

fn ground_texture(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, sampler: &wgpu::Sampler, w: u32, h: u32, srgb: bool) -> (wgpu::Texture, wgpu::BindGroup) {
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("view3d ground"),
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: if srgb { wgpu::TextureFormat::Rgba8UnormSrgb } else { wgpu::TextureFormat::Rgba8Unorm },
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let view = tex.create_view(&Default::default());
    let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("view3d ground"),
        layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(sampler) },
        ],
    });
    (tex, bind)
}

fn upload(device: &wgpu::Device, m: &Mesh) -> GpuMesh {
    if m.indices.is_empty() {
        return None;
    }
    Some((
        buffer(device, bytemuck::cast_slice(&m.vertices), wgpu::BufferUsages::VERTEX),
        buffer(device, bytemuck::cast_slice(&m.indices), wgpu::BufferUsages::INDEX),
        m.indices.len() as u32,
    ))
}

impl CallbackTrait for Frame {
    fn prepare(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        _screen: &ScreenDescriptor,
        _encoder: &mut wgpu::CommandEncoder,
        res: &mut CallbackResources,
    ) -> Vec<wgpu::CommandBuffer> {
        let Some(gpu) = res.get_mut::<Gpu>() else { return Vec::new() };
        // a new ground picture
        if let Ok(mut g) = self.ground.lock() {
            if g.fresh {
                if let Some(px) = g.pixels.take() {
                    let size = 256 * GROUND_TILES;
                    let (tex, bind) = ground_texture(device, &gpu.ground_layout, &gpu.sampler, size, size, gpu.srgb);
                    queue.write_texture(
                        wgpu::TexelCopyTextureInfo { texture: &tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                        &px,
                        wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(4 * size), rows_per_image: Some(size) },
                        wgpu::Extent3d { width: size, height: size, depth_or_array_layers: 1 },
                    );
                    gpu.ground_tex = tex;
                    gpu.ground_bind = bind;
                }
                g.fresh = false;
            }
        }
        let srgb = gpu.srgb;
        let lin = |x: f32| if srgb { x.powf(2.2) } else { x };
        let fog = [lin(self.fog[0]), lin(self.fog[1]), lin(self.fog[2]), self.fog[3]];
        let base = |model: Mat4, ground: bool, l: Option<&Livery>, anim0: [f32; 4], anim1: [f32; 4], anim2: [f32; 4], anim3: [f32; 4]| {
            let c = |v: [f32; 3]| [lin(v[0]), lin(v[1]), lin(v[2]), 1.0];
            let lv = l.cloned().unwrap_or_else(|| livery(None));
            Uniforms {
                view_proj: self.view_proj.to_cols_array_2d(),
                model: model.to_cols_array_2d(),
                body: c(lv.body),
                wing: c(lv.wing),
                engine: c(lv.engine),
                fin: c(lv.fin),
                belly: match lv.belly {
                    Some((col, from)) => [lin(col[0]), lin(col[1]), lin(col[2]), from],
                    None => [0.0; 4],
                },
                sun: [self.sun.x, self.sun.y, self.sun.z, self.light],
                flags: [if lv.tail { 1.0 } else { 0.0 }, if ground { 1.0 } else { 0.0 }, 0.0, 0.0],
                ground: self.ground_rect,
                anim0,
                anim1,
                eye: [self.eye.x, self.eye.y, self.eye.z, 0.0],
                fog,
                anim2,
                anim3,
            }
        };
        gpu.draws.clear();
        let mut slot = 0u32;
        let ground = base(Mat4::IDENTITY, true, None, [0.0; 4], [0.0; 4], [0.0; 4], [0.0; 4]);
        queue.write_buffer(&gpu.uniforms, 0, bytemuck::bytes_of(&ground));
        gpu.ground_slot = Some(slot);
        slot += 1;
        for (key, at, mesh) in &self.buildings {
            if slot as u64 >= MAX_DRAWS {
                break;
            }
            if !gpu.meshes.contains_key(key) {
                let m = upload(device, mesh);
                gpu.meshes.insert(key.clone(), m);
            }
            let u = base(Mat4::from_translation(*at), false, None, [0.0; 4], [0.0; 4], [0.0; 4], [0.0; 4]);
            queue.write_buffer(&gpu.uniforms, slot as u64 * UNIFORM_STRIDE, bytemuck::bytes_of(&u));
            gpu.draws.push((key.clone(), slot));
            slot += 1;
        }
        for p in &self.planes {
            if slot as u64 >= MAX_DRAWS {
                break;
            }
            if !gpu.meshes.contains_key(&p.file) {
                let m = upload(device, &p.mesh);
                gpu.meshes.insert(p.file.clone(), m);
            }
            // model space (x right wing, y nose, z up, 1 long) → the world: its size, attitude and place
            let rot = Mat4::from_rotation_z(-p.heading.to_radians()) * Mat4::from_rotation_x(p.pitch.to_radians()) * Mat4::from_rotation_y(p.bank.to_radians());
            let model = Mat4::from_translation(p.at) * rot * Mat4::from_scale(Vec3::splat(p.len));
            let u = base(model, false, Some(&p.livery), p.anim0, p.anim1, p.anim2, p.anim3);
            queue.write_buffer(&gpu.uniforms, slot as u64 * UNIFORM_STRIDE, bytemuck::bytes_of(&u));
            gpu.draws.push((p.file.clone(), slot));
            slot += 1;
        }
        let n = self.puffs.len().min(MAX_PUFFS);
        let puffs: Vec<Puff> = self.puffs[..n].iter().map(|p| Puff { color: [lin(p.color[0]), lin(p.color[1]), lin(p.color[2]), p.color[3]], ..*p }).collect();
        if n > 0 {
            queue.write_buffer(&gpu.puffs, 0, bytemuck::cast_slice(&puffs));
        }
        gpu.puff_count = n as u32;
        Vec::new()
    }

    fn paint(&self, _info: egui::PaintCallbackInfo, pass: &mut wgpu::RenderPass<'static>, res: &CallbackResources) {
        let Some(gpu) = res.get::<Gpu>() else { return };
        pass.set_pipeline(&gpu.pipeline);
        pass.set_bind_group(1, &gpu.ground_bind, &[]);
        if let Some(s) = gpu.ground_slot {
            pass.set_bind_group(0, &gpu.bind, &[(s as u64 * UNIFORM_STRIDE) as u32]);
            pass.set_vertex_buffer(0, gpu.ground_vb.slice(..));
            pass.draw(0..6, 0..1);
        }
        for (key, slot) in &gpu.draws {
            let Some(Some((vb, ib, n))) = gpu.meshes.get(key) else { continue };
            pass.set_bind_group(0, &gpu.bind, &[(*slot as u64 * UNIFORM_STRIDE) as u32]);
            pass.set_vertex_buffer(0, vb.slice(..));
            pass.set_index_buffer(ib.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..*n, 0, 0..1);
        }
        if gpu.puff_count > 0 {
            pass.set_pipeline(&gpu.clouds);
            pass.set_bind_group(0, &gpu.bind, &[0]);
            pass.set_vertex_buffer(0, gpu.sphere.0.slice(..));
            pass.set_vertex_buffer(1, gpu.puffs.slice(..));
            pass.set_index_buffer(gpu.sphere.1.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..gpu.sphere.2, 0, 0..gpu.puff_count);
        }
    }
}

// ---------- the view: cameras and what is in it ----------

/// How a plane is drawn, smoothed from frame to frame: bank, pitch (degrees) and its propellers' angle.
#[derive(Clone, Copy, Default)]
struct Pose {
    bank: f32,
    pitch: f32,
    spin: f32,
    /// the main and nose shock absorbers: out from standing (m) and how fast; the main wheels were well up
    om: f32,
    omv: f32,
    on: f32,
    onv: f32,
    up: bool,
    nose_up: bool,
    /// thrust reversers and spoilers out (0 … 1)
    rev: f32,
    spo: f32,
}

/// A damped spring (in real seconds, so it works the same at any game speed): position, speed, target, its
/// frequency (Hz) and damping, bottoming out at `min`.
fn spring(y: &mut f32, v: &mut f32, target: f32, hz: f32, damp: f32, dt: f32, min: f32) {
    let w = 2.0 * std::f32::consts::PI * hz;
    let n = (dt / 0.008).ceil().max(1.0) as usize;
    let h = dt / n as f32;
    for _ in 0..n {
        *v += (w * w * (target - *y) - 2.0 * damp * w * *v) * h;
        *y += *v * h;
        if *y < min {
            *y = min;
            *v = v.max(0.0);
        }
    }
}

/// A type's thrust reversers from js/data/reversers.js: (kind: 0 none or propellers, 1 translating sleeve,
/// 2 pivoting doors, 3 buckets; on which engines: 0 all, 0.27 the inner ones, -0.27 the outer ones).
fn reverser(kind: &str) -> (f32, f32) {
    static TABLE: std::sync::OnceLock<HashMap<String, (f32, f32)>> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let src = include_str!("../../js/data/reversers.js");
        let mut out = HashMap::new();
        for call in src.split("set('").skip(1) {
            let body = &call[..call.find(");").unwrap_or(call.len())];
            // (the first piece is the kind, then the types' strings joined with +, maybe the engines it is on)
            let kind = body.split('\'').next().unwrap_or("");
            let parts: Vec<&str> = body.split('\'').skip(1).enumerate().filter(|(k, _)| k % 2 == 1).map(|(_, s)| s).collect();
            let (types, on): (Vec<&str>, f32) = match parts.last() {
                Some(&"inner") => (parts[..parts.len() - 1].to_vec(), 0.27),
                Some(&"outer") => (parts[..parts.len() - 1].to_vec(), -0.27),
                Some(&"sides") | Some(&"center") => (parts[..parts.len() - 1].to_vec(), 0.0),
                _ => (parts, 0.0),
            };
            let k = match kind { "cascade" => 1.0, "doors" => 2.0, "buckets" => 3.0, _ => 0.0 };
            for ty in types.iter().flat_map(|s| s.split_whitespace()) {
                out.insert(ty.to_string(), (k, on));
            }
        }
        out
    });
    match table.get(kind) {
        Some(r) => *r,
        None => {
            let eng = data().ac(kind).eng.as_str();
            (if eng == "prop2" || eng == "radial2" || eng == "prop3" { 0.0 } else { 1.0 }, 0.0)
        }
    }
}

/// The 3D view's state: which plane it follows and how the camera looks at it.
pub struct View3d {
    pub on: bool,
    /// "chase", "flyby" or "wing", as the browser game's V / B / N
    pub cam: &'static str,
    pub follow: Option<String>,
    /// turned round the plane (degrees) and looking down (degrees); distance in plane lengths
    pub yaw: f32,
    pub pitch: f32,
    pub dist: f32,
    /// the fly-by camera's spot (lat, lon, height m) and the plane it is for
    flyby: Option<(f64, f64, f64, String)>,
    /// what the last frame drew (for the self-test report)
    pub debug: String,
    ground: Arc<Mutex<Ground>>,
    meshes: HashMap<String, Option<Arc<Mesh>>>,
    buildings: HashMap<String, Option<Arc<Mesh>>>,
    poses: HashMap<String, Pose>,
}

impl View3d {
    /// Where the sound is heard from with plane i on screen: the fly-by spot, else with the plane (the chase camera
    /// as from close by, the wing camera on it), looking the way the camera does.
    pub fn ear(&self, g: &flightgame::game::Game, t: f64, i: usize) -> crate::sound::Ear {
        let p = &g.state.planes[i];
        let pos = g.flight_pos(i, t);
        if self.cam == "flyby" {
            if let Some((la, lo, h, id)) = &self.flyby {
                if id == &p.id {
                    let (x, y) = local(*la, *lo, pos.lat, pos.lon);
                    return crate::sound::Ear { lat: *la, lon: *lo, h: *h, bearing: x.atan2(y).to_degrees(), follow: Some(p.id.clone()), cam: "flyby" };
                }
            }
        }
        crate::sound::Ear { lat: pos.lat, lon: pos.lon, h: pos.alt_ft * 0.3048, bearing: pos.heading + self.yaw as f64, follow: Some(p.id.clone()), cam: self.cam }
    }
}

impl Default for View3d {
    fn default() -> Self {
        View3d {
            on: false,
            cam: "chase",
            follow: None,
            yaw: 0.0,
            pitch: 12.0,
            dist: 2.6,
            flyby: None,
            debug: String::new(),
            ground: Arc::new(Mutex::new(Ground { want: (0, 0, 0), shown: None, loading: false, pixels: None, fresh: false })),
            meshes: HashMap::new(),
            buildings: HashMap::new(),
            poses: HashMap::new(),
        }
    }
}

/// Metres east and north of (lat0, lon0).
fn local(lat0: f64, lon0: f64, lat: f64, lon: f64) -> (f64, f64) {
    let y = (lat - lat0) * 111_320.0;
    let x = (lon - lon0) * 111_320.0 * lat0.to_radians().cos();
    (x, y)
}

fn wrap180(a: f64) -> f64 {
    (a + 540.0).rem_euclid(360.0) - 180.0
}

fn hash3(a: i64, b: i64, c: i64) -> f32 {
    let x = ((a as f64) * 12.9898 + (b as f64) * 78.233 + (c as f64) * 37.719).sin() * 43758.5453;
    (x - x.floor()) as f32
}

/// How the moving parts of a plane stand in a phase of its flight (after the browser game's js/view3d.js:
/// propRate, surfaceAngles, wingFlex, gearFor): what the pose is heading for (bank, pitch, degrees), the
/// propellers' speed (rad/s), flaps, the elevators' pull (degrees), the wing's bend (half spans), gear down.
struct Parts {
    bank: f32,
    pitch: f32,
    rate: f32,
    flap: f32,
    pull: f32,
    ground: bool,
    gear: f32,
    lift: f32,
}

fn parts_for(kind: &str, pos: &flightgame::track::FlightPos, turn_deg_s: f64, running: bool) -> Parts {
    let (_, v_lof, v_app) = flightgame::track::perf(kind);
    let agl = pos.alt_ft as f32;
    let kmh = (pos.speed_kt * 1.852) as f32;
    let x = kmh / v_lof as f32;
    let ph = pos.phase;
    let (rate, flap, pull, pitch): (f32, f32, f32, f32) = match ph {
        "Pushback" => (5.0, 0.0, 0.0, 0.0),
        "Taxiing to the runway" => (7.0, 12.0, 0.0, 0.0),
        "Take-off run" => {
            let rot = ((x - 0.86) / 0.12).clamp(0.0, 1.0);
            (15.0, 12.0, 15.0 * rot, 8.0 * rot)
        }
        "Climbing" => (14.0, if agl < 1500.0 { 12.0 } else if agl < 3000.0 { 5.0 } else { 0.0 }, 1.0 + 9.0 * (1.0 - agl / 1000.0).max(0.0), if agl < 400.0 { 8.0 } else { 6.0 }),
        "Cruising" => (12.0, 0.0, 0.0, 2.0),
        "Descending" => (9.0, 0.0, 0.0, -1.0),
        "Final approach" => {
            let flare = if agl < 120.0 { 1.0 - agl / 120.0 } else { 0.0 };
            (10.0, if agl < 1500.0 { 35.0 } else if agl < 4000.0 { 20.0 } else { 8.0 }, 2.0 + 12.0 * flare, 2.5 + 3.0 * flare)
        }
        "Landing" => {
            let nose = ((kmh / v_app as f32 - 0.7) / 0.3).clamp(0.0, 1.0) * 5.0;
            (9.0, 35.0, 2.0 * nose, nose)
        }
        "Taxiing to the stand" => (7.0, 0.0, 0.0, 0.0),
        _ => (0.0, 0.0, 0.0, 0.0),
    };
    let gear = if !pos.airborne {
        1.0
    } else {
        match ph {
            "Cruising" => 0.0,
            "Climbing" => 1.0 - (agl - 300.0) / 400.0,
            _ => (2200.0 - agl) / 400.0,
        }
        .clamp(0.0, 1.0)
    };
    let lift = if pos.airborne { 1.0 } else { (x * x).min(1.0) };
    Parts {
        bank: if pos.airborne { (turn_deg_s * 9.0).clamp(-30.0, 30.0) as f32 } else { 0.0 },
        pitch,
        rate: if running { rate } else { 0.0 },
        flap,
        pull,
        ground: !pos.airborne,
        gear,
        lift,
    }
}

impl View3d {
    fn mesh(&mut self, file: &str) -> Option<Arc<Mesh>> {
        self.meshes.entry(file.to_string()).or_insert_with(|| load_mesh(file).map(Arc::new)).clone()
    }

    /// The 3D view in `rect`: drag to turn the camera round the plane, wheel to come closer. `running`: the
    /// game is not paused (propellers stand still while it is). Returns the plane's index it follows (for the
    /// panel over it).
    pub fn show(&mut self, ui: &mut egui::Ui, rect: egui::Rect, g: &flightgame::game::Game, t: f64, livery_id: Option<&str>, running: bool) -> Option<usize> {
        let d = data();
        // the plane: the one asked for, else the first one flying, else the first
        let i = self
            .follow
            .as_ref()
            .and_then(|id| g.plane_idx(id))
            .or_else(|| g.state.planes.iter().position(|p| p.status == flightgame::game::Status::Flying))
            .or(if g.state.planes.is_empty() { None } else { Some(0) })?;
        let p = &g.state.planes[i];
        let pos = g.flight_pos(i, t);
        let resp = ui.allocate_rect(rect, egui::Sense::click_and_drag());
        if resp.dragged() {
            let dlt = resp.drag_delta();
            self.yaw += dlt.x * 0.4;
            self.pitch = (self.pitch + dlt.y * 0.3).clamp(-10.0, 85.0);
        }
        if resp.hovered() {
            let scroll = ui.input(|i| i.smooth_scroll_delta.y);
            self.dist = (self.dist * (1.0 - scroll * 0.002)).clamp(0.8, 40.0);
        }
        let dt = ui.input(|i| i.stable_dt).clamp(0.0, 0.1);
        // the reference point: the plane's spot on the ground
        let (lat0, lon0) = (pos.lat, pos.lon);
        // the planes: the followed one and every other of yours within 60 km, posed and with their parts set
        let lv = livery(livery_id);
        let mut planes = Vec::new();
        let mut me = Vec3::new(0.0, 0.0, (pos.alt_ft * 0.3048) as f32);
        let mut my_rot = Mat4::from_rotation_z(-(pos.heading as f32).to_radians());
        let mut seen = Vec::new();
        for (k, q) in g.state.planes.iter().enumerate() {
            let qp = if k == i { pos.clone() } else { g.flight_pos(k, t) };
            if distance_km(lat0, lon0, qp.lat, qp.lon) > 60.0 {
                continue;
            }
            let Some(file) = model_file(&q.kind) else { continue };
            let Some(mesh) = self.mesh(&file) else { continue };
            seen.push(q.id.clone());
            let flying = q.status == flightgame::game::Status::Flying;
            // the turn: how its heading changes over a few game seconds either side
            let (turn, ahead) = if flying {
                let a = g.flight_pos(k, t - 0.15);
                let b = g.flight_pos(k, t + 0.15);
                (wrap180(b.heading - a.heading) / 18.0, wrap180(b.heading - qp.heading))
            } else {
                (0.0, 0.0)
            };
            let parts = parts_for(&q.kind, &qp, turn, running);
            let pose = self.poses.entry(q.id.clone()).or_default();
            let k_s = (dt * 1.6).min(1.0);
            let to_bank = parts.bank - pose.bank;
            let to_pitch = parts.pitch - pose.pitch;
            pose.bank += to_bank * k_s;
            pose.pitch += to_pitch * k_s;
            pose.spin = (pose.spin + parts.rate * dt).rem_euclid(std::f32::consts::TAU * 64.0);
            let deg = std::f32::consts::PI / 180.0;
            let ail = if parts.ground { 0.0 } else { (to_bank * 1.5).clamp(-18.0, 18.0) };
            let elev = (-parts.pull - to_pitch * 6.0).clamp(-20.0, 20.0);
            let rud = (ahead as f32 * if parts.ground { 4.0 } else { 1.5 }).clamp(if parts.ground { -20.0 } else { -10.0 }, if parts.ground { 20.0 } else { 10.0 });
            let qlen = d.ac(&q.kind).len as f32;
            let soft = 0.6 + 0.4 * (qlen / 60.0).min(1.0);
            let gload = (1.0 / pose.bank.abs().min(60.0).to_radians().cos() + 0.03 * (pose.pitch - 2.5)).clamp(0.5, 1.8);
            let flex = soft * (-0.012 * (1.0 - parts.lift) + 0.045 * gload * parts.lift);
            // the shock absorbers: in the air the legs hang out (stroke); coming down the wheels meet the runway, the
            // plane settles onto its legs, pushing them in a little further and bouncing back; the nose leg the same
            // as the nose wheel comes down
            let dts = if running { dt } else { 0.0 };
            let stroke = (0.009 * qlen).clamp(0.25, 0.6);
            let h = if qp.airborne { (qp.alt_ft * 0.3048) as f32 } else { 0.0 };
            let reach = h.min(stroke);
            let kmh = (qp.speed_kt * 1.852) as f32;
            if pose.up && h < 0.01 && kmh > 120.0 {
                pose.omv -= 1.3; // (the weight coming onto the legs)
            }
            pose.up = h > 0.5 || (pose.up && h > 0.01);
            spring(&mut pose.om, &mut pose.omv, reach, 1.6, 0.3, dts, -0.5 * stroke);
            let nose_off = h > 0.01 || pose.pitch > 1.0;
            if pose.nose_up && !nose_off && kmh > 60.0 {
                pose.onv -= 0.7;
            }
            pose.nose_up = nose_off;
            // (braking on the landing run, the nose leg is pushed in a little)
            let brake = if qp.phase == "Landing" && !nose_off { -0.35 } else { 0.0 };
            spring(&mut pose.on, &mut pose.onv, if nose_off { 0.75 * stroke } else { brake * 0.75 * stroke }, 2.2, 0.4, dts, -0.5 * stroke);
            let body = h - reach + pose.om;
            // thrust reversers after touchdown until about 60 kt; the ground spoilers until slow
            let rev_to = if qp.phase == "Landing" && kmh > 110.0 { 1.0 } else { 0.0 };
            pose.rev += (rev_to - pose.rev) * (1.0 - (-dts / if rev_to > pose.rev { 0.4 } else { 1.0 }).exp());
            let spo_to = if qp.phase == "Landing" && kmh > 50.0 { 1.0 } else { 0.0 };
            pose.spo += (spo_to - pose.spo) * (1.0 - (-dts / 0.5).exp());
            let (rkind, ron) = reverser(&q.kind);
            let (x, y) = local(lat0, lon0, qp.lat, qp.lon);
            let at = Vec3::new(x as f32, y as f32, body - mesh.ground * qlen);
            let rot = Mat4::from_rotation_z(-(qp.heading as f32).to_radians()) * Mat4::from_rotation_x(pose.pitch.to_radians()) * Mat4::from_rotation_y(pose.bank.to_radians());
            if k == i {
                me = at;
                my_rot = rot;
            }
            planes.push(Plane {
                file,
                mesh,
                at,
                heading: qp.heading as f32,
                pitch: pose.pitch,
                bank: pose.bank,
                len: qlen,
                livery: lv.clone(),
                anim0: [pose.spin, parts.flap * deg, ail * deg, elev * deg],
                anim1: [rud * deg, flex, parts.gear, 1.0 / (1.0 + parts.rate * 0.25)],
                anim2: [if rkind > 0.0 { pose.rev } else { 0.0 }, ron, pose.om / qlen, pose.on / qlen],
                anim3: [pose.spo * 50.0 * deg, rkind, 0.0, 0.0],
            });
        }
        self.poses.retain(|id, _| seen.contains(id));
        let ac = d.ac(&p.kind);
        let len = ac.len as f32;
        let alt = (pos.alt_ft * 0.3048) as f32;
        let hdg = pos.heading as f32;
        let fwd = Vec3::new(hdg.to_radians().sin(), hdg.to_radians().cos(), 0.0);
        let mut up = Vec3::Z;
        let (eye, target) = match self.cam {
            "wing" => {
                // on the left wing, looking along the fuselage: it banks and pitches with the plane
                let place = |m: Vec3| me + (my_rot * Mat4::from_scale(Vec3::splat(len))).transform_point3(m);
                up = my_rot.transform_vector3(Vec3::Z);
                (place(Vec3::new(-0.42 * ac.span as f32 / len, -0.05, 0.06)), place(Vec3::new(0.0, 0.6, 0.0)))
            }
            "flyby" => {
                // a spot beside its path ahead, kept until the plane is well past
                let need_new = match &self.flyby {
                    Some((la, lo, _, id)) => id != &p.id || distance_km(*la, *lo, pos.lat, pos.lon) > (len as f64 * 0.04).max(0.8),
                    None => true,
                };
                if need_new {
                    let ahead = flightgame::game::offset_point(pos.lat, pos.lon, pos.heading, len as f64 * 14.0);
                    let side = flightgame::game::offset_point(ahead.0, ahead.1, pos.heading + 90.0, len as f64 * 3.0);
                    self.flyby = Some((side.0, side.1, alt as f64 + len as f64 * 0.2, p.id.clone()));
                }
                let (la, lo, h, _) = self.flyby.clone().unwrap();
                let (x, y) = local(lat0, lon0, la, lo);
                (Vec3::new(x as f32, y as f32, h as f32), me)
            }
            _ => {
                let a = (hdg + 180.0 + self.yaw).to_radians();
                let back = Vec3::new(a.sin(), a.cos(), 0.0);
                let upa = self.pitch.to_radians();
                let r = len * self.dist;
                (me + back * r * upa.cos() + Vec3::Z * r * upa.sin(), me)
            }
        };
        let _ = fwd;
        let eye = Vec3::new(eye.x, eye.y, eye.z.max(2.0));
        let aspect = rect.width() / rect.height().max(1.0);
        let proj = glam::camera::rh::proj::directx::perspective(50f32.to_radians(), aspect, 1.0, 600_000.0);
        let view = glam::camera::rh::view::look_at_mat4(eye, target, up);
        // the sun: from the game's sun point, seen from here
        let (dec, sun_lon) = g.sun_point(t);
        let day = flightgame::weather::daylight(lat0, lon0, (dec, sun_lon)) as f32;
        let hrel = (lon0 - sun_lon).to_radians();
        let sun = Vec3::new(-(hrel.sin() as f32), ((dec - lat0).to_radians().sin()) as f32, 0.6 + day).normalize();
        // the weather here: overcast skies are greyer and darker, rain and fog thicken the haze
        let wx = g.weather_at(lat0, lon0, t.floor() as i64);
        let cover = wx.cover as f32;
        let above = alt > 2600.0; // over the clouds it stays bright
        let light = if above { day } else { day * (1.0 - 0.35 * cover * cover - if wx.storm { 0.2 } else { 0.0 }) };
        let blue = [0.42, 0.62, 0.86];
        let grey = [0.66, 0.68, 0.71];
        let k = if above { 0.0 } else { (cover * 0.85 + wx.rain as f32 * 0.15).min(1.0) };
        let horizon: [f32; 3] = std::array::from_fn(|c| (blue[c] + (grey[c] - blue[c]) * k) * (0.08 + 0.92 * light) + 0.02);
        let density = if above {
            1.6e-5
        } else if wx.fog {
            3.0e-4
        } else {
            1.0e-5 + 3.0e-5 * wx.rain as f32 + 0.8e-5 * cover + if wx.storm { 4.0e-5 } else { 0.0 }
        };
        let fog = [horizon[0], horizon[1], horizon[2], density];
        // the ground picture under the camera: finer the lower it is
        let h = eye.z as f64;
        let z: u32 = if h < 800.0 { 15 } else if h < 3000.0 { 13 } else if h < 9000.0 { 11 } else { 9 };
        let (tx, ty) = tile_of(lat0, lon0, z);
        let key = (z, (tx.floor() as u32).saturating_sub(GROUND_TILES / 2 - 1), (ty.floor() as u32).saturating_sub(GROUND_TILES / 2 - 1));
        // one fetch at a time; one that failed (offline) is not tried again until the camera moves on
        let need = match self.ground.lock() {
            Ok(mut gr) if !gr.loading && gr.want != key => {
                gr.want = key;
                gr.loading = true;
                true
            }
            _ => false,
        };
        if need {
            fetch_ground(key, self.ground.clone());
        }
        // the rect the picture covers (whatever is loaded: the key it was fetched for)
        let shown = self.ground.lock().ok().and_then(|gr| gr.shown);
        let (x0, y0, x1, y1) = match shown {
            Some(shown) => {
                let (nw_lat, nw_lon) = tile_corner(shown.1 as f64, shown.2 as f64, shown.0);
                let (se_lat, se_lon) = tile_corner((shown.1 + GROUND_TILES) as f64, (shown.2 + GROUND_TILES) as f64, shown.0);
                let (x0, y1) = local(lat0, lon0, nw_lat, nw_lon);
                let (x1, y0) = local(lat0, lon0, se_lat, se_lon);
                (x0, y0, x1, y1)
            }
            None => (1e9, 1e9, 1e9 + 1.0, 1e9 + 1.0),
        };
        // the buildings of the airports within 25 km (those with a layout of their own)
        let mut buildings = Vec::new();
        for a in &d.airports {
            if (a.lat - lat0).abs() > 0.25 || distance_km(lat0, lon0, a.lat, a.lon) > 25.0 {
                continue;
            }
            let Some(l) = flightgame::layouts::layout(&a.code) else { continue };
            let key = format!("bld:{}:{}:{}:{}", a.code, l.terminals.len(), l.hangars.len(), l.others.len());
            let mesh = self.buildings.entry(key.clone()).or_insert_with(|| building_mesh(&a.code).map(Arc::new)).clone();
            if let Some(m) = mesh {
                let (x, y) = local(lat0, lon0, a.lat, a.lon);
                buildings.push((key, Vec3::new(x as f32, y as f32, 0.0), m));
            }
        }
        let puffs = Arc::new(clouds(g, t, lat0, lon0, eye));
        self.debug = format!(
            "eye {eye:?} target {target:?} hdg {hdg} weather {} cover {cover:.2} puffs {} buildings {} planes {:?}",
            wx.name,
            puffs.len(),
            buildings.len(),
            planes.iter().map(|p| (p.file.clone(), p.at, p.heading, p.anim1[2])).collect::<Vec<_>>()
        );
        // the sun's true place in the sky (its hour angle and declination)
        let (la, de, ha) = (lat0.to_radians(), dec.to_radians(), (lon0 - sun_lon).to_radians());
        let sun_true = Vec3::new(-(de.cos() * ha.sin()) as f32, (la.cos() * de.sin() - la.sin() * de.cos() * ha.cos()) as f32, (la.sin() * de.sin() + la.cos() * de.cos() * ha.cos()) as f32).normalize_or_zero();
        let frame = Frame {
            view_proj: proj * view,
            eye,
            target,
            up,
            sun_true,
            sun,
            light,
            fog,
            planes,
            buildings,
            puffs,
            ground_rect: [x0 as f32, y0 as f32, x1 as f32, y1 as f32],
            ground: self.ground.clone(),
        };
        // the Bevy renderer (lit by the sun with shadows under a real sky), where it runs
        if crate::bevy3d::enabled() && crate::bevy3d::draw(ui, rect, &frame) {
            ui.ctx().request_repaint();
            return Some(i);
        }
        // the sky behind: deeper blue up high, the haze's colour at the horizon
        let c32 = |c: [f32; 3]| egui::Color32::from_rgb((c[0].clamp(0.0, 1.0) * 255.0) as u8, (c[1].clamp(0.0, 1.0) * 255.0) as u8, (c[2].clamp(0.0, 1.0) * 255.0) as u8);
        let zenith: [f32; 3] = std::array::from_fn(|c| horizon[c] * if c == 2 { 0.78 } else { 0.55 });
        let mut sky = egui::Mesh::default();
        sky.colored_vertex(rect.left_top(), c32(zenith));
        sky.colored_vertex(rect.right_top(), c32(zenith));
        sky.colored_vertex(rect.right_bottom(), c32(horizon));
        sky.colored_vertex(rect.left_bottom(), c32(horizon));
        sky.add_triangle(0, 1, 2);
        sky.add_triangle(0, 2, 3);
        ui.painter().add(egui::Shape::mesh(sky));
        ui.painter().add(egui_wgpu::Callback::new_paint_callback(rect, frame));
        ui.ctx().request_repaint();
        Some(i)
    }
}

/// The clouds round the camera from the game's weather (Game::weather_lite, as the browser game's
/// FG.weather.puffs): in cells of the pattern drifting east with it, up to three puffs where the cover is thick,
/// greyer with rain, towering in storms; farthest first (they are see-through).
fn clouds(g: &flightgame::game::Game, t: f64, lat0: f64, lon0: f64, eye: Vec3) -> Vec<Puff> {
    const CELL: f64 = 0.045;
    const RADIUS_KM: f64 = 50.0;
    let storms = g.storms_now();
    let drift = flightgame::weather::WX_DRIFT * t;
    let dlat = RADIUS_KM / 111.32;
    let dlon = dlat / lat0.to_radians().cos().max(0.2);
    let mut out = Vec::new();
    let (j0, j1) = (((lat0 - dlat) / CELL).floor() as i64, ((lat0 + dlat) / CELL).ceil() as i64);
    let (i0, i1) = (((lon0 - drift - dlon) / CELL).floor() as i64, ((lon0 - drift + dlon) / CELL).ceil() as i64);
    for j in j0..=j1 {
        for i in i0..=i1 {
            let (clat, clon) = ((j as f64 + 0.5) * CELL, (i as f64 + 0.5) * CELL + drift);
            if distance_km(lat0, lon0, clat, clon) > RADIUS_KM {
                continue;
            }
            let (cover, rain, storm) = g.weather_lite(clat, clon, t, &storms);
            let n = (cover as f32 * 3.2 + hash3(i, j, 0) - 0.6).floor().clamp(0.0, 3.0) as i64;
            for k in 0..n {
                let (hx, hy, hs) = (hash3(i, j, 3 * k + 1), hash3(i, j, 3 * k + 2), hash3(i, j, 3 * k + 3));
                let la = clat + (hx as f64 - 0.5) * CELL;
                let lo = clon + (hy as f64 - 0.5) * CELL;
                let (x, y) = local(lat0, lon0, la, lo);
                let wide = 1400.0 + 2600.0 * hs * cover as f32;
                let (tall, base) = if storm && hs > 0.4 { (wide * 2.2, 700.0) } else { (wide * (0.32 + 0.25 * hx), 900.0 + 1100.0 * (1.0 - rain as f32) + 500.0 * hy) };
                let grey = (0.98 - 0.42 * rain as f32 - if storm { 0.18 } else { 0.0 }).max(0.35);
                out.push(Puff {
                    at: [x as f32, y as f32, base + tall * 0.5],
                    size: [wide, wide * (0.8 + 0.4 * hy), tall],
                    color: [grey, grey, grey * 1.02 + 0.01, (0.5 + 0.35 * cover as f32).min(0.85)],
                });
            }
        }
    }
    let dist = |p: &Puff| (Vec3::from(p.at) - eye).length_squared();
    out.sort_by(|a, b| dist(a).total_cmp(&dist(b)));
    out.truncate(MAX_PUFFS);
    out.reverse();
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn liveries_and_models() {
        let l = super::liveries();
        assert!(l.len() >= 5, "{} liveries", l.len());
        assert_eq!(l[0].id, "swiss");
        assert!(l[0].fin[0] > 0.5 && l[0].fin[1] < 0.1, "SWISS red fin {:?}", l[0].fin);
        let file = super::model_file("A320").expect("A320 model");
        let m = super::load_mesh(&file).expect("A320 mesh loads");
        assert!(m.vertices.len() > 1000);
        // a fin and wings were found
        assert!(m.vertices.iter().any(|v| v.info[0] == 1.0));
        assert!(m.vertices.iter().any(|v| v.info[0] == 2.0));
    }

    /// What moves was found on a jet and a turboprop, and the gear puts the wheels under the aircraft.
    #[test]
    fn shader_compiles() {
        // (WGSL errors would only show when the 3D view opens: parse and validate it here)
        let m = naga::front::wgsl::parse_str(super::SHADER).unwrap_or_else(|e| panic!("{}", e.emit_to_string(super::SHADER)));
        naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::all()).validate(&m).expect("valid");
    }

    #[test]
    fn moving_parts_and_gear() {
        let count = |m: &super::Mesh, k: f32| m.vertices.iter().filter(|v| v.anim[0] == k).count();
        let a320 = super::load_mesh("a320").expect("a320");
        for (k, what) in [(1.0, "ailerons"), (2.0, "flaps"), (3.0, "elevators"), (4.0, "rudder"), (6.0, "fans"), (7.0, "gear")] {
            assert!(count(&a320, k) > 0, "A320 {what}");
        }
        assert!(a320.vertices.iter().any(|v| v.color[0] > 0.05 && v.info[0] == 2.0), "A320 wings bend");
        assert!(a320.ground < -0.04 && a320.ground > -0.2, "A320 ground {}", a320.ground);
        // the wheels reach the ground
        let low = a320.vertices.iter().filter(|v| v.anim[0] == 7.0).map(|v| v.pos[2]).fold(f32::MAX, f32::min);
        assert!((low - a320.ground).abs() < 0.005, "wheels at {low}, ground {}", a320.ground);
        // the reversers' parts on the engines, the spoiler panels, the shock absorbers (main and nose) and doors
        assert!(a320.vertices.iter().any(|v| v.anim[0] == 8.0 && v.anim[1] > 0.0), "A320 reverser sleeves");
        assert!(count(&a320, 10.0) > 40, "A320 spoilers");
        for s in [1.0, 2.0] {
            assert!(a320.vertices.iter().any(|v| v.anim[0] == 7.0 && v.anim[2] == s), "A320 shock absorber {s}");
        }
        assert!(a320.vertices.iter().any(|v| v.anim[0] == 7.0 && v.info[0] == 0.0), "A320 gear doors");
        assert_eq!(super::reverser("A320"), (2.0, 0.0));
        assert_eq!(super::reverser("A350-900"), (1.0, 0.0));
        assert_eq!(super::reverser("B727-200"), (3.0, 0.0));
        assert_eq!(super::reverser("A380-800"), (1.0, 0.27));
        assert_eq!(super::reverser("DC-3").0, 0.0);
        let atr = super::load_mesh("atr42").expect("atr42");
        assert!(count(&atr, 5.0) > 0, "ATR propellers");
        assert!(count(&atr, 7.0) > 0, "ATR gear");
        // a model with gear of its own gets none
        if let Some(dhc6) = super::load_mesh("dhc6") {
            assert_eq!(count(&dhc6, 7.0), 0);
        }
    }

    #[test]
    fn buildings_and_roofs() {
        let sq = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        assert_eq!(super::triangulate(&sq).len(), 2);
        // an L: four triangles, none outside it
        let l = [(0.0, 0.0), (20.0, 0.0), (20.0, 10.0), (10.0, 10.0), (10.0, 20.0), (0.0, 20.0)];
        assert_eq!(super::triangulate(&l).len(), 4);
        let zrh = super::building_mesh("ZRH").expect("Zurich has buildings");
        assert!(zrh.indices.len() > 300, "{} indices", zrh.indices.len());
        assert!(zrh.vertices.iter().any(|v| v.info[0] == 6.0 && v.anim[1] == 1.0), "terminal windows");
    }
}

#[cfg(test)]
mod cam {
    use glam::{Mat4, Vec3, Vec4};
    #[test]
    fn chase_looks_from_behind() {
        let hdg: f32 = 134.0;
        let len = 37.6f32;
        let me = Vec3::new(0.0, 0.0, 5.0);
        let a = (hdg + 180.0).to_radians();
        let back = Vec3::new(a.sin(), a.cos(), 0.0);
        let up = 12f32.to_radians();
        let r = len * 2.6;
        let eye = me + back * r * up.cos() + Vec3::Z * r * up.sin();
        let proj = glam::camera::rh::proj::directx::perspective(50f32.to_radians(), 1.6, 1.0, 600_000.0);
        let view = glam::camera::rh::view::look_at_mat4(eye, me, Vec3::Z);
        let rot = Mat4::from_rotation_z(-hdg.to_radians());
        let model = Mat4::from_translation(me) * rot * Mat4::from_scale(Vec3::splat(len));
        // the nose is farther from the camera than the tail
        let w = |p: Vec3| (proj * view * model * Vec4::new(p.x, p.y, p.z, 1.0)).w;
        assert!(w(Vec3::new(0.0, 0.5, 0.0)) > w(Vec3::new(0.0, -0.5, 0.0)));
    }
}
