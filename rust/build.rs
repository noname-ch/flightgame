//! Embeds what the browser game ships beside its code into the binary:
//! - the airport layouts (`../js/data/layouts/*.json`) as OUT_DIR/layouts.rs,
//! - the aircraft pictures (`../models/hangar/*.webp`) and map icons (`../models/icons/*.webp`) as OUT_DIR/pictures.rs.

use std::fmt::Write as _;
use std::path::Path;

fn table(dir: &Path, ext: &str, name: &str, macro_name: &str) -> String {
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut files: Vec<_> = std::fs::read_dir(dir)
        .map(|r| r.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == ext)).collect())
        .unwrap_or_default();
    files.sort();
    let ty = if macro_name == "include_str" { "&str" } else { "&[u8]" };
    let mut out = format!("pub static {name}: &[(&str, {ty})] = &[\n");
    for f in files {
        let key = f.file_stem().unwrap().to_string_lossy().to_string();
        let path = f.canonicalize().unwrap().to_string_lossy().replace('\\', "/");
        let _ = writeln!(out, "    ({key:?}, {macro_name}!({path:?})),");
    }
    out.push_str("];\n");
    out
}

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    std::fs::write(out.join("layouts.rs"), table(&root.join("js/data/layouts"), "json", "LAYOUTS", "include_str")).unwrap();
    let pics = table(&root.join("models/hangar"), "webp", "HANGAR", "include_bytes")
        + &table(&root.join("models/icons"), "webp", "ICONS", "include_bytes");
    std::fs::write(out.join("pictures.rs"), pics).unwrap();
}
