//! The airport checklist (F8), as the browser game's js/airportcheck.js: every airport in checking order (the start
//! airports first, then the world's busiest, then every other by size) with its mark from js/data/checks.js:
//! checked (blue, an agent looked at it), ok (green, a person approved it) or bad (red, needs work). Your marks are
//! kept beside the save (checks.json) on top of the repo's, and can be written into js/data/checks.js.

use flightgame::config::START_AIRPORTS;
use flightgame::data::data;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const CHECKS_JS: &str = include_str!("../../js/data/checks.js");
const BUSIEST_JS: &str = include_str!("../../js/data/busiest.js");

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Mark {
    /// "checked", "ok" or "bad"
    pub s: String,
    pub by: String,
    pub at: String,
    pub note: String,
}

/// Why an airport is where it is in the list.
#[derive(Clone, Debug)]
pub enum Why {
    Start,
    Busy(usize),
    Size,
}

pub struct Checklist {
    /// the repo's marks, then yours over them
    pub repo: BTreeMap<String, Mark>,
    pub mine: BTreeMap<String, Mark>,
    pub order: Vec<(String, Why)>,
}

fn local_path() -> std::path::PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Flightgame").join("checks.json")
}

/// The repo's checks.js, when the app runs from a checkout of it (to write the marks into).
pub fn repo_file() -> Option<std::path::PathBuf> {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("js").join("data").join("checks.js");
    p.exists().then_some(p)
}

impl Checklist {
    pub fn load() -> Checklist {
        let mut repo = BTreeMap::new();
        if let Ok(serde_json::Value::Object(map)) = flightgame::jsdata::assigned(CHECKS_JS, "checks") {
            for (code, v) in map {
                let s = |k: &str| v[k].as_str().unwrap_or("").to_string();
                repo.insert(code, Mark { s: s("s"), by: s("by"), at: s("at"), note: s("note") });
            }
        }
        let mine = std::fs::read_to_string(local_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        // the order: start airports, the busiest, then every other by size
        let d = data();
        let mut order: Vec<(String, Why)> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut put = |code: &str, why: Why, order: &mut Vec<(String, Why)>| {
            if d.try_airport(code).is_some_and(|a| !a.factory) && seen.insert(code.to_string()) {
                order.push((code.to_string(), why));
            }
        };
        for (_, codes) in START_AIRPORTS {
            for c in codes {
                put(c, Why::Start, &mut order);
            }
        }
        if let Ok(serde_json::Value::Array(list)) = flightgame::jsdata::assigned(BUSIEST_JS, "busiest") {
            for (i, c) in list.iter().enumerate() {
                if let Some(c) = c.as_str() {
                    put(c, Why::Busy(i + 1), &mut order);
                }
            }
        }
        let mut rest: Vec<&flightgame::data::Airport> = d.airports.iter().filter(|a| !a.factory).collect();
        rest.sort_by(|a, b| b.size.cmp(&a.size).then(a.minor.cmp(&b.minor)).then(a.code.cmp(&b.code)));
        for a in rest {
            put(&a.code, Why::Size, &mut order);
        }
        Checklist { repo, mine, order }
    }

    pub fn mark(&self, code: &str) -> Option<&Mark> {
        self.mine.get(code).or_else(|| self.repo.get(code))
    }

    /// Sets your mark ("" clears yours, back to the repo's).
    pub fn set(&mut self, code: &str, s: &str, note: &str) {
        if s.is_empty() {
            self.mine.remove(code);
        } else {
            let today = chrono_today();
            self.mine.insert(code.to_string(), Mark { s: s.into(), by: "you".into(), at: today, note: note.into() });
        }
        let p = local_path();
        let _ = std::fs::create_dir_all(p.parent().unwrap());
        let _ = std::fs::write(p, serde_json::to_string_pretty(&self.mine).unwrap_or_default());
    }

    /// js/data/checks.js with the repo's marks and yours, in the browser game's format.
    pub fn file_text(&self) -> String {
        let mut all = self.repo.clone();
        for (k, v) in &self.mine {
            all.insert(k.clone(), v.clone());
        }
        let mut out = String::from(
            "// Airport checklist (developer tools, F8), see js/airportcheck.js: s = checked (blue, an agent looked at it),\n\
             // ok (green, a person approved it) or bad (red, needs work). Written by tools/serve.py, tools/checks.mjs or a commit\n\
             // from the game: commit this file to give everyone the checks.\nFG.data.checks = {\n",
        );
        for (code, m) in all {
            let o = serde_json::json!({ "s": m.s, "by": m.by, "at": m.at, "note": m.note });
            out.push_str(&format!("{}: {},\n", serde_json::to_string(&code).unwrap(), o));
        }
        out.push_str("};\n");
        out
    }
}

/// Today as YYYY-MM-DD (from the system clock, UTC).
fn chrono_today() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (y, m, d) = flightgame::game::civil_from_days((secs / 86400) as i64);
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    #[test]
    fn checklist_reads_the_marks() {
        let c = super::Checklist::load();
        assert!(c.repo.len() > 50, "{} marks", c.repo.len());
        assert_eq!(c.order[0].0, "BRN");
        assert!(c.order.len() > 10000);
        assert!(c.file_text().contains("\"AMS\": {"));
    }
}
