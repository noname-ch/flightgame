//! The real airport layouts the browser game ships (`js/data/layouts/*.json`, from OpenStreetMap): aprons,
//! terminals, hangars, taxiways and stands, for drawing airports on the map when zoomed in.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

include!(concat!(env!("OUT_DIR"), "/layouts.rs"));

pub type Ring = Vec<(f64, f64)>;

#[derive(Default, Debug)]
pub struct Layout {
    pub aprons: Vec<Ring>,
    pub terminals: Vec<Ring>,
    pub hangars: Vec<Ring>,
    pub taxiways: Vec<Ring>,
    /// (lat, lon, heading, name)
    pub stands: Vec<(f64, f64, f64, String)>,
}

fn rings(v: &Value) -> Vec<Ring> {
    v.as_array()
        .map(|list| {
            list.iter()
                .filter_map(|r| r.as_array())
                .map(|r| {
                    r.iter()
                        .filter_map(|p| Some((p.get(0)?.as_f64()?, p.get(1)?.as_f64()?)))
                        .collect::<Ring>()
                })
                .filter(|r| r.len() >= 2)
                .collect()
        })
        .unwrap_or_default()
}

fn parse(text: &str) -> Layout {
    let Ok(v) = serde_json::from_str::<Value>(text) else { return Layout::default() };
    let stands = v["stands"]
        .as_array()
        .map(|l| {
            l.iter()
                .filter_map(|s| {
                    Some((s.get(0)?.as_f64()?, s.get(1)?.as_f64()?, s.get(2).and_then(|x| x.as_f64()).unwrap_or(0.0),
                        s.get(3).and_then(|x| x.as_str()).unwrap_or("").to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    Layout {
        aprons: rings(&v["aprons"]),
        terminals: rings(&v["terminals"]),
        hangars: rings(&v["hangars"]),
        taxiways: rings(&v["taxiways"]),
        stands,
    }
}

static PARSED: OnceLock<HashMap<&'static str, Layout>> = OnceLock::new();

/// The layout of an airport, if the browser game ships one.
pub fn layout(code: &str) -> Option<&'static Layout> {
    PARSED.get_or_init(|| LAYOUTS.iter().map(|(c, t)| (*c, parse(t))).collect()).get(code)
}

pub fn has_layout(code: &str) -> bool {
    LAYOUTS.iter().any(|(c, _)| *c == code)
}

#[cfg(test)]
mod tests {
    #[test]
    fn zurich() {
        let l = super::layout("ZRH").expect("ZRH layout");
        assert!(!l.aprons.is_empty() && !l.terminals.is_empty() && !l.taxiways.is_empty());
        assert!(l.stands.len() > 20);
    }
}
