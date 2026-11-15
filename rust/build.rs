//! Embeds the browser game's airport layouts (`../js/data/layouts/*.json`) into the binary: writes a table of
//! (code, include_str!) pairs to OUT_DIR/layouts.rs.

use std::fmt::Write as _;
use std::path::Path;

fn main() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../js/data/layouts");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .map(|r| r.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect())
        .unwrap_or_default();
    files.sort();
    let mut out = String::from("pub static LAYOUTS: &[(&str, &str)] = &[\n");
    for f in files {
        let code = f.file_stem().unwrap().to_string_lossy().to_string();
        let path = f.canonicalize().unwrap().to_string_lossy().replace('\\', "/");
        let _ = writeln!(out, "    ({code:?}, include_str!({path:?})),");
    }
    out.push_str("];\n");
    std::fs::write(Path::new(&std::env::var("OUT_DIR").unwrap()).join("layouts.rs"), out).unwrap();
}
