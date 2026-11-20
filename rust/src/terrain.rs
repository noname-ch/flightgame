//! The real ground for the 3D view (drawn by src/bevy3d.rs): Esri's satellite pictures on the shape of the land
//! (the AWS Terrain Tiles, Terrarium heights), in map tiles that are finer the closer they are to the camera
//! (down to zoom 18, a third of a metre a pixel, under the plane) and coarser out to the horizon, with the
//! airports levelled (their runways and buildings stand on flat ground at the airport's height). Tiles are fetched
//! and built in background threads and kept on disk; a tile not loaded yet is drawn by its coarser parent until
//! its four children are there, so the picture sharpens as it loads instead of leaving holes.
//!
//! Tile meshes are in metres from the tile's north-west corner without the cos(latitude) of the east–west
//! distances: the renderer scales x by the cos of the scene's reference latitude, as `view3d::local` does, so
//! neighbouring tiles meet exactly. Bevy's axes: x east, y up (metres above the sea), z south.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Condvar, Mutex};

pub type Key = (u8, u32, u32);

/// Vertices a tile side (a grid of GRID × GRID cells).
const GRID: usize = 32;
/// A tile is split while the camera is closer than this many tile sizes.
const SPLIT: f64 = 1.8;
const ZMIN: u8 = 6;
const ZMAX: u8 = 18;
/// the heights' finest zoom (about 30 m a pixel; airports are levelled anyway)
const DEM_Z: u8 = 12;
const WORKERS: usize = 16;
/// airports are levelled on tiles from this zoom on
const LEVEL_Z: u8 = 10;
/// beyond this the tiles are not drawn (the haze hides it)
const FAR_M: f64 = 320_000.0;
const M_PER_DEG: f64 = 111_320.0;

/// A tile ready to be drawn: its mesh (Bevy's axes) and picture (RGBA with every mip level, 256 px down to 1).
pub struct TileData {
    pub key: Key,
    pub pos: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
    pub rgba: Vec<u8>,
    pub mips: u32,
}

#[derive(Default)]
struct Shared {
    /// the tiles wanted, nearest first (the workers take from the front)
    queue: Vec<Key>,
    busy: HashSet<Key>,
    failed: HashSet<Key>,
    done: Vec<TileData>,
    dem: HashMap<Key, Arc<Vec<f32>>>,
    /// airports' heights (m), by code, and those asked for
    elev: HashMap<String, f32>,
    asked: HashSet<String>,
}

pub struct Terrain {
    shared: Arc<(Mutex<Shared>, Condvar)>,
    /// tiles handed to the renderer
    ready: HashSet<Key>,
    started: bool,
}

impl Default for Terrain {
    fn default() -> Self {
        Terrain { shared: Arc::new((Mutex::new(Shared::default()), Condvar::new())), ready: HashSet::new(), started: false }
    }
}

// ---------- tiles and places ----------

fn n_of(z: u8) -> f64 {
    2f64.powi(z as i32)
}

/// The north-west corner of tile x, y at zoom z (fractions allowed).
pub fn corner(z: u8, x: f64, y: f64) -> (f64, f64) {
    let n = n_of(z);
    let lon = x / n * 360.0 - 180.0;
    let lat = (std::f64::consts::PI * (1.0 - 2.0 * y / n)).sinh().atan().to_degrees();
    (lat, lon)
}

fn tile_xy(z: u8, lat: f64, lon: f64) -> (f64, f64) {
    let n = n_of(z);
    let lr = lat.clamp(-85.0, 85.0).to_radians();
    ((lon + 180.0) / 360.0 * n, (1.0 - (lr.tan() + 1.0 / lr.cos()).ln() / std::f64::consts::PI) / 2.0 * n)
}

/// How far a point is from the camera's spot on the ground and the camera's height (m).
fn dist_to_tile(k: Key, lat: f64, lon: f64, alt: f64) -> f64 {
    let (z, x, y) = k;
    let (n_lat, w_lon) = corner(z, x as f64, y as f64);
    let (s_lat, e_lon) = corner(z, x as f64 + 1.0, y as f64 + 1.0);
    let clat = lat.clamp(s_lat, n_lat);
    let mut dlon = lon - lon.clamp(w_lon, e_lon);
    if dlon.abs() > 180.0 {
        dlon -= 360.0 * dlon.signum();
    }
    let dy = (lat - clat) * M_PER_DEG;
    let dx = dlon * M_PER_DEG * lat.to_radians().cos();
    (dx * dx + dy * dy + alt * alt).sqrt()
}

fn size_m(k: Key) -> f64 {
    let (z, _, y) = k;
    let (lat, _) = corner(z, 0.0, y as f64 + 0.5);
    40_075_016.0 * lat.to_radians().cos() / n_of(z)
}

fn children(k: Key) -> [Key; 4] {
    let (z, x, y) = k;
    [(z + 1, 2 * x, 2 * y), (z + 1, 2 * x + 1, 2 * y), (z + 1, 2 * x, 2 * y + 1), (z + 1, 2 * x + 1, 2 * y + 1)]
}

impl Terrain {
    /// The tiles to draw for a camera at lat, lon, alt metres above the ground: finer near it, each one as soon as
    /// it is loaded. Where a tile's finer children are only partly loaded it is drawn too, lowered by the metres
    /// given with it, so it shows only through the gaps. Asks for the tiles still missing, coarse ones first.
    pub fn select(&mut self, lat: f64, lon: f64, alt: f64) -> Vec<(Key, f32)> {
        if !self.started {
            self.started = true;
            for _ in 0..WORKERS {
                let sh = self.shared.clone();
                std::thread::spawn(move || worker(sh));
            }
        }
        let (rx, ry) = tile_xy(ZMIN, lat, lon);
        let n = n_of(ZMIN) as i64;
        let mut want: Vec<(f64, Key)> = Vec::new();
        let mut draw = Vec::new();
        for dy in -1i64..=1 {
            for dx in -1i64..=1 {
                let (x, y) = ((rx as i64 + dx).rem_euclid(n), ry as i64 + dy);
                if y < 0 || y >= n {
                    continue;
                }
                self.visit((ZMIN, x as u32, y as u32), lat, lon, alt, &mut want, &mut draw);
            }
        }
        want.sort_by(|a, b| a.0.total_cmp(&b.0));
        want.dedup_by_key(|w| w.1);
        if std::env::var_os("FLIGHTGAME_TERRAIN_LOG").is_some() {
            static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
            if N.fetch_add(1, std::sync::atomic::Ordering::Relaxed) % 120 == 0 {
                let (f, b) = self.shared.0.lock().map(|s| (s.failed.len(), s.busy.len())).unwrap_or_default();
                let mut zs: Vec<u8> = draw.iter().map(|k| k.0.0).collect();
                zs.sort();
                eprintln!("terrain at {lat:.4},{lon:.4} alt {alt:.0}: draw {} (zooms {:?}) ready {} want {} failed {f} busy {b}", draw.len(), zs, self.ready.len(), want.len());
            }
        }
        if let Ok(mut s) = self.shared.0.lock() {
            let done: HashSet<Key> = s.done.iter().map(|t| t.key).collect();
            let (failed, busy) = (&s.failed, &s.busy);
            let q: Vec<Key> = want.iter().map(|w| w.1).filter(|k| !failed.contains(k) && !busy.contains(k) && !done.contains(k)).take(96).collect();
            s.queue = q;
            self.shared.1.notify_all();
        }
        draw
    }

    fn visit(&self, k: Key, lat: f64, lon: f64, alt: f64, want: &mut Vec<(f64, Key)>, draw: &mut Vec<(Key, f32)>) {
        let d = dist_to_tile(k, lat, lon, alt);
        if d > FAR_M && k.0 > ZMIN {
            return;
        }
        let ready = self.ready.contains(&k);
        if !ready {
            // (nearest first, the coarser a little before the finer at the same distance)
            want.push((d + 0.03 * size_m(k), k));
        }
        if k.0 < ZMAX && d < SPLIT * size_m(k) {
            // finer tiles here: each drawn as soon as it is loaded (whether this one is or not); this one, if it is
            // loaded, lowered under them to fill the gaps of those still loading
            let mut gap = false;
            for c in children(k) {
                if dist_to_tile(c, lat, lon, alt) > FAR_M {
                    continue;
                }
                gap |= !self.covered(c, lat, lon, alt);
                self.visit(c, lat, lon, alt, want, draw);
            }
            if gap && ready {
                draw.push((k, (size_m(k) * 0.002) as f32 + 1.0));
            }
            return;
        }
        if ready {
            draw.push((k, 0.0));
        }
    }

    /// Is a tile's area drawn: the tile loaded, or (where it is split) all its children's areas?
    fn covered(&self, k: Key, lat: f64, lon: f64, alt: f64) -> bool {
        if self.ready.contains(&k) {
            return true;
        }
        let d = dist_to_tile(k, lat, lon, alt);
        k.0 < ZMAX && d < SPLIT * size_m(k) && children(k).iter().all(|c| dist_to_tile(*c, lat, lon, alt) > FAR_M || self.covered(*c, lat, lon, alt))
    }

    /// The tiles built since the last call (they count as drawable from now on).
    pub fn take_done(&mut self) -> Vec<TileData> {
        let done = self.shared.0.lock().map(|mut s| std::mem::take(&mut s.done)).unwrap_or_default();
        for t in &done {
            self.ready.insert(t.key);
        }
        done
    }

    /// The renderer dropped a tile (to save memory): it is fetched again when wanted.
    pub fn forget(&mut self, k: Key) {
        self.ready.remove(&k);
    }

    /// An airport's height (m above the sea), once known; asks for it otherwise.
    pub fn airport_elev(&self, code: &str) -> Option<f32> {
        let mut s = self.shared.0.lock().ok()?;
        if let Some(e) = s.elev.get(code) {
            return Some(*e);
        }
        if s.asked.insert(code.to_string()) {
            let (sh, code) = (self.shared.clone(), code.to_string());
            std::thread::spawn(move || {
                let a = flightgame::data::data().airport(&code);
                let _ = airport_height(&sh, &code, a.lat, a.lon);
            });
        }
        None
    }
}

// ---------- fetching ----------

fn cached(dir: &str, name: &str, url: &str) -> Option<Vec<u8>> {
    let file = dirs::cache_dir().map(|d| d.join("Flightgame").join(dir).join(name));
    if let Some(b) = file.as_ref().and_then(|f| std::fs::read(f).ok()) {
        return Some(b);
    }
    let mut resp = ureq::get(url).header("User-Agent", "flightgame/0.1").call().ok()?;
    let b = resp.body_mut().read_to_vec().ok()?;
    if let Some(f) = &file {
        let _ = std::fs::create_dir_all(f.parent().unwrap());
        let _ = std::fs::write(f, &b);
    }
    Some(b)
}

fn imagery(k: Key) -> Option<image::RgbaImage> {
    let (z, x, y) = k;
    let url = format!("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}");
    // (the same files as the old ground picture's, view3d.rs fetch_ground)
    let bytes = cached("sat3d", &format!("{z}_{x}_{y}.jpg"), &url)?;
    let img = image::load_from_memory(&bytes).ok()?.to_rgba8();
    Some(if img.width() == 256 && img.height() == 256 { img } else { image::imageops::resize(&img, 256, 256, image::imageops::FilterType::Triangle) })
}

/// A height tile: 256 × 256 metres above the sea (the sea floor counts as the sea).
fn dem(sh: &Arc<(Mutex<Shared>, Condvar)>, k: Key) -> Option<Arc<Vec<f32>>> {
    if let Some(d) = sh.0.lock().ok()?.dem.get(&k) {
        return Some(d.clone());
    }
    let (z, x, y) = k;
    let url = format!("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png");
    let bytes = cached("dem", &format!("{z}_{x}_{y}.png"), &url)?;
    let img = image::load_from_memory(&bytes).ok()?.to_rgb8();
    if img.width() != 256 || img.height() != 256 {
        return None;
    }
    let h: Vec<f32> = img.pixels().map(|p| ((p.0[0] as f32 * 256.0 + p.0[1] as f32 + p.0[2] as f32 / 256.0) - 32768.0).max(0.0)).collect();
    let h = Arc::new(h);
    if let Ok(mut s) = sh.0.lock() {
        if s.dem.len() > 160 {
            let drop: Vec<Key> = s.dem.keys().take(40).copied().collect();
            for d in drop {
                s.dem.remove(&d);
            }
        }
        s.dem.insert(k, h.clone());
    }
    Some(h)
}

/// The height at a place from a height tile at zoom `dz` (bilinear).
fn height_in(d: &[f32], dz: u8, dk: (u32, u32), lat: f64, lon: f64) -> f32 {
    let (fx, fy) = tile_xy(dz, lat, lon);
    let px = ((fx - dk.0 as f64) * 256.0 - 0.5).clamp(0.0, 254.999);
    let py = ((fy - dk.1 as f64) * 256.0 - 0.5).clamp(0.0, 254.999);
    let (ix, iy) = (px as usize, py as usize);
    let (tx, ty) = ((px - ix as f64) as f32, (py - iy as f64) as f32);
    let at = |x: usize, y: usize| d[y * 256 + x];
    let top = at(ix, iy) * (1.0 - tx) + at(ix + 1, iy) * tx;
    let bot = at(ix, iy + 1) * (1.0 - tx) + at(ix + 1, iy + 1) * tx;
    top * (1.0 - ty) + bot * ty
}

/// An airport's height: the ground at its point (kept).
fn airport_height(sh: &Arc<(Mutex<Shared>, Condvar)>, code: &str, lat: f64, lon: f64) -> Option<f32> {
    if let Some(e) = sh.0.lock().ok()?.elev.get(code) {
        return Some(*e);
    }
    let (fx, fy) = tile_xy(DEM_Z, lat, lon);
    let dk = (fx as u32, fy as u32);
    let d = dem(sh, (DEM_Z, dk.0, dk.1))?;
    let e = height_in(&d, DEM_Z, dk, lat, lon);
    if let Ok(mut s) = sh.0.lock() {
        s.elev.insert(code.to_string(), e);
    }
    Some(e)
}

fn worker(sh: Arc<(Mutex<Shared>, Condvar)>) {
    loop {
        let k = {
            let Ok(mut s) = sh.0.lock() else { return };
            loop {
                if !s.queue.is_empty() {
                    let k = s.queue.remove(0);
                    if s.busy.insert(k) {
                        break k;
                    }
                    continue;
                }
                s = match sh.1.wait(s) {
                    Ok(s) => s,
                    Err(_) => return,
                };
            }
        };
        let built = build(&sh, k);
        if let Ok(mut s) = sh.0.lock() {
            s.busy.remove(&k);
            match built {
                Some(t) => s.done.push(t),
                None => {
                    s.failed.insert(k);
                }
            }
        }
    }
}

// ---------- building a tile ----------

fn build(sh: &Arc<(Mutex<Shared>, Condvar)>, k: Key) -> Option<TileData> {
    let (z, x, y) = k;
    let pic = imagery(k)?;
    let dz = z.min(DEM_Z);
    let (dx, dy) = (x >> (z - dz), y >> (z - dz));
    let d = dem(sh, (dz, dx, dy))?;
    let (n_lat, w_lon) = corner(z, x as f64, y as f64);
    let (s_lat, e_lon) = corner(z, x as f64 + 1.0, y as f64 + 1.0);
    // the airports near it, levelled: (lat, lon, height, inner radius, outer radius)
    let pad = 0.08;
    // (only on the finer tiles: from far off a levelled airport can't be told apart, and a coarse tile holds hundreds)
    let mut ports = Vec::new();
    for a in flightgame::data::data().airports.iter().filter(|_| z >= LEVEL_Z) {
        if a.lat < s_lat - pad || a.lat > n_lat + pad || a.lon < w_lon - pad / 0.5 || a.lon > e_lon + pad / 0.5 || a.runway <= 0.0 {
            continue;
        }
        let r_in = (a.runway * 0.65).clamp(700.0, 3200.0);
        if let Some(e) = airport_height(sh, &a.code, a.lat, a.lon) {
            ports.push((a.lat, a.lon, e, r_in, r_in + 1800.0));
        }
    }
    let g = GRID;
    let mut hs = vec![0f32; (g + 1) * (g + 1)];
    let mut lls = vec![(0f64, 0f64); (g + 1) * (g + 1)];
    for j in 0..=g {
        for i in 0..=g {
            let (lat, lon) = corner(z, x as f64 + i as f64 / g as f64, y as f64 + j as f64 / g as f64);
            let mut h = height_in(&d, dz, (dx, dy), lat, lon);
            let mut best = 0.0f32;
            let mut to = h;
            for &(alat, alon, e, r0, r1) in &ports {
                let ddy = (lat - alat) * M_PER_DEG;
                let ddx = (lon - alon) * M_PER_DEG * alat.to_radians().cos();
                let r = (ddx * ddx + ddy * ddy).sqrt();
                if r < r1 {
                    let t = ((r1 - r) / (r1 - r0)).clamp(0.0, 1.0) as f32;
                    let w = t * t * (3.0 - 2.0 * t);
                    if w > best {
                        best = w;
                        to = e;
                    }
                }
            }
            h += (to - h) * best;
            hs[j * (g + 1) + i] = h;
            lls[j * (g + 1) + i] = (lat, lon);
        }
    }
    // metres from the north-west corner: x east (degrees × M_PER_DEG, the cos comes with the renderer), z south
    let mut pos = Vec::with_capacity((g + 1) * (g + 1) + 4 * (g + 1));
    let mut uvs = Vec::with_capacity(pos.capacity());
    for j in 0..=g {
        for i in 0..=g {
            let (lat, lon) = lls[j * (g + 1) + i];
            pos.push([((lon - w_lon) * M_PER_DEG) as f32, hs[j * (g + 1) + i], ((n_lat - lat) * M_PER_DEG) as f32]);
            uvs.push([i as f32 / g as f32, j as f32 / g as f32]);
        }
    }
    let at = |i: usize, j: usize| j * (g + 1) + i;
    let mut normals = Vec::with_capacity(pos.capacity());
    for j in 0..=g {
        for i in 0..=g {
            let (l, r) = (at(i.saturating_sub(1), j), at((i + 1).min(g), j));
            let (u, dn) = (at(i, j.saturating_sub(1)), at(i, (j + 1).min(g)));
            let dhx = (pos[r][1] - pos[l][1]) / (pos[r][0] - pos[l][0]).max(1e-3);
            let dhz = (pos[dn][1] - pos[u][1]) / (pos[dn][2] - pos[u][2]).max(1e-3);
            let nv = glam::Vec3::new(-dhx, 1.0, -dhz).normalize();
            normals.push(nv.to_array());
        }
    }
    let mut indices = Vec::with_capacity(g * g * 6 + 4 * g * 6);
    for j in 0..g {
        for i in 0..g {
            let (a, b, c, e) = (at(i, j) as u32, at(i, j + 1) as u32, at(i + 1, j) as u32, at(i + 1, j + 1) as u32);
            indices.extend([a, b, c, c, b, e]);
        }
    }
    // skirts round the edge, hanging down, so no gap shows where a finer tile meets a coarser one
    let drop = (size_m(k) * 0.03) as f32 + 15.0;
    let edges: [Vec<usize>; 4] = [
        (0..=g).map(|i| at(i, 0)).collect(),
        (0..=g).map(|i| at(i, g)).collect(),
        (0..=g).map(|j| at(0, j)).collect(),
        (0..=g).map(|j| at(g, j)).collect(),
    ];
    for edge in edges {
        let base = pos.len() as u32;
        for &v in &edge {
            let p = pos[v];
            pos.push([p[0], p[1] - drop, p[2]]);
            uvs.push(uvs[v]);
            normals.push(normals[v]);
        }
        for s in 0..edge.len() - 1 {
            let (t0, t1, b0, b1) = (edge[s] as u32, edge[s + 1] as u32, base + s as u32, base + s as u32 + 1);
            indices.extend([t0, b0, t1, t1, b0, b1]);
        }
    }
    // the picture with its mip levels (box filtered), so far tiles don't shimmer
    let mut rgba = pic.into_raw();
    let mut level = rgba.clone();
    let mut w = 256usize;
    let mut mips = 1;
    while w > 1 {
        let h = w / 2;
        let mut next = vec![0u8; h * h * 4];
        for yy in 0..h {
            for xx in 0..h {
                for c in 0..4 {
                    let s = |dx: usize, dy: usize| level[((2 * yy + dy) * w + 2 * xx + dx) * 4 + c] as u32;
                    next[(yy * h + xx) * 4 + c] = ((s(0, 0) + s(1, 0) + s(0, 1) + s(1, 1) + 2) / 4) as u8;
                }
            }
        }
        rgba.extend_from_slice(&next);
        level = next;
        w = h;
        mips += 1;
    }
    Some(TileData { key: k, pos, normals, uvs, indices, rgba, mips })
}

/// The tile's north-west corner (where its mesh's 0 is).
pub fn anchor(k: Key) -> (f64, f64) {
    corner(k.0, k.1 as f64, k.2 as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiles_and_places() {
        // Zurich at zoom 12 and back
        let (fx, fy) = tile_xy(12, 47.4647, 8.5492);
        let (lat, lon) = corner(12, fx, fy);
        assert!((lat - 47.4647).abs() < 1e-6 && (lon - 8.5492).abs() < 1e-6);
        // the camera's own tile is 0 m away (but its height)
        let k = (14, fx as u32 * 4, fy as u32 * 4);
        let (clat, clon) = corner(14, k.1 as f64 + 0.5, k.2 as f64 + 0.5);
        assert!((dist_to_tile(k, clat, clon, 120.0) - 120.0).abs() < 1e-6);
        assert!(size_m((12, 0, fy as u32)) > 6000.0 && size_m((12, 0, fy as u32)) < 7000.0);
        assert_eq!(children((3, 1, 2))[3], (4, 3, 5));
    }

    #[test]
    fn terrarium_heights() {
        // a flat tile of 500 m: R 129, G 244, B 0 is 129 * 256 + 244 - 32768 = 500
        let d = vec![500.0f32; 256 * 256];
        assert!((height_in(&d, 12, (2145, 1434), 47.46, 8.55) - 500.0).abs() < 1e-3);
        assert_eq!(129.0f32 * 256.0 + 244.0 - 32768.0, 500.0);
    }
}

#[cfg(test)]
mod live {
    use super::*;

    /// (network) A tile at Zurich: its picture varies and its middle is about the airport's height.
    #[test]
    #[ignore]
    fn zurich_tile() {
        let sh = Arc::new((Mutex::new(Shared::default()), Condvar::new()));
        let (fx, fy) = tile_xy(14, 47.4582, 8.5555);
        let t = build(&sh, (14, fx as u32, fy as u32)).expect("built");
        let base = &t.rgba[..256 * 256 * 4];
        let (mn, mx) = base.chunks(4).fold((255u8, 0u8), |(a, b), p| (a.min(p[1]), b.max(p[1])));
        let hs: Vec<f32> = t.pos.iter().take(33 * 33).map(|p| p[1]).collect();
        let (h0, h1) = hs.iter().fold((f32::MAX, f32::MIN), |(a, b), h| (a.min(*h), b.max(*h)));
        let e = sh.0.lock().unwrap().elev.get("ZRH").copied();
        println!("green {mn}..{mx}, mips {}, heights {h0:.0}..{h1:.0}, ZRH {e:?}, uv {:?} {:?}", t.mips, t.uvs[0], t.uvs[33 * 33 - 1]);
        image::save_buffer(std::env::temp_dir().join("zrh_tile.png"), base, 256, 256, image::ExtendedColorType::Rgba8).unwrap();
        assert!(mx - mn > 40);
    }
}
