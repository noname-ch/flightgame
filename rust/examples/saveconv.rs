//! Converts save files between the browser game and this app, and checks a round trip:
//! `cargo run --release --example saveconv -- <in.json> <out.json> [days]`: reads a save from either game, plays
//! `days` game days (default 0) and writes it in the browser game's format.
//! `... -- --preset europe <out.json> [days]` starts a quick start instead.

use flightgame::data::data;
use flightgame::game::*;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut g = if args[0] == "--preset" {
        let pr = data().presets.iter().find(|p| p.id == args[1]).expect("preset");
        Game::from_preset(pr).0
    } else {
        Game::load_json(&std::fs::read_to_string(&args[0]).expect("read")).expect("load")
    };
    let out = if args[0] == "--preset" { 2 } else { 1 };
    let days: i64 = args.get(out + 1).and_then(|d| d.parse().ok()).unwrap_or(0);
    let show = |g: &Game, what: &str| {
        let s = &g.state;
        let flights: u32 = s.planes.iter().map(|p| p.stats.flights).sum();
        let flying = s.planes.iter().filter(|p| p.status == Status::Flying).count();
        println!("{what}: {} time {} money {:.0} planes {} flying {flying} flights {flights} slots {} rivals {} log {}",
            s.company, s.time, s.money, s.planes.len(), s.slots.len(), s.rivals.len(), s.log.len());
    };
    show(&g, "loaded");
    // OPEN=<code>: open that site first (its checklist must be done)
    if let Ok(code) = std::env::var("OPEN") {
        println!("before opening: fits A350-900: {:?}; checklist {:?}", fits_reason("A350-900", &code), g.site_checklist(&code));
        println!("open {code}: {:?}", g.open_airport(&code));
    }
    g.advance(days * 1440);
    show(&g, "played");
    // the airports the player built: in the world, their stands and size, the flights there
    for (code, open) in data().built_airports().iter().map(|a| (a.code.clone(), a.open)) {
        let to_there: u32 = g.state.planes.iter().flat_map(|p| &p.stats.recent).filter(|r| r.to == code).count() as u32;
        println!("built airports: {code} open {open} size {} stands {:?} runway {:.0} m · recent flights there {to_there} · fits A350-900: {:?}",
            airport_size(&code), stands_of(&code), longest_runway(&code, true), fits_reason("A350-900", &code));
    }
    std::fs::write(&args[out], g.export_json()).expect("write");
    // the export reads back the same
    let back = Game::load_json(&g.export_json()).expect("read back");
    let a = serde_json::to_value(&g.state).unwrap();
    let mut b = serde_json::to_value(&back.state).unwrap();
    // (what only the browser game keeps comes back with `built` and `winds` added)
    b.as_object_mut().unwrap().remove("browser");
    let mut a = a;
    a.as_object_mut().unwrap().remove("browser");
    if a != b {
        diff(&a, &b, "");
    } else {
        println!("round trip: same state");
    }
}

fn diff(a: &serde_json::Value, b: &serde_json::Value, path: &str) {
    use serde_json::Value;
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys().chain(y.keys().filter(|k| !x.contains_key(*k))) {
                diff(&x.get(k).cloned().unwrap_or(Value::Null), &y.get(k).cloned().unwrap_or(Value::Null), &format!("{path}.{k}"));
            }
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => {
            for (k, (p, q)) in x.iter().zip(y).enumerate() {
                diff(p, q, &format!("{path}[{k}]"));
            }
        }
        (Value::Number(x), Value::Number(y)) if x != y => println!("round trip differs at {path}: {x:?} vs {y:?}"),
        _ if a != b => println!("round trip differs at {path}: {a} vs {b}"),
        _ => {}
    }
}
