//! What the developer tools (F2) do, as the browser game's js/devtools.js: money, planes, slots, events, incidents
//! and crashes, construction, the market and time. Every use is logged ("🛠 Dev: …") and marks the game.

use crate::data::data;
use crate::game::*;

pub const WORLD_EVENTS: [&str; 12] = [
    "airportStrike", "atcStrike", "pilotStrike", "volcano", "storm", "fuelSpike", "fuelDrop", "festival", "football",
    "rivalBankrupt", "flu", "influencer",
];

impl Game {
    fn dev_done(&mut self, msg: String) {
        self.state.dev_used = true;
        self.log(format!("🛠 Dev: {msg}"), LogKind::Info);
    }

    pub fn dev_money(&mut self, amount: f64) {
        self.state.money += amount;
        self.dev_done(format!("money {}{}", if amount < 0.0 { "" } else { "+" }, fmt_money(amount)));
    }

    /// Planes of a type at an airport you hold a slot at (a slot more for each where there is none free for it).
    pub fn dev_add_planes(&mut self, kind: &str, code: &str, n: usize, owned: bool) -> Result<(), String> {
        if data().try_ac(kind).is_none() || data().try_airport(code).is_none() {
            return Err("Pick a type and an airport.".into());
        }
        let mut ids = Vec::new();
        for _ in 0..n.clamp(1, 50) {
            if code != self.home() {
                let mut by = self.my_slot_classes(code);
                by[type_class(kind)] += 1;
                self.dev_set_slots(code, by);
            }
            ids.push(self.dev_plane(kind, code, owned));
        }
        self.dev_done(format!("{} × {} at {code} ({})", ids.len(), data().ac(kind).name, ids.join(", ")));
        Ok(())
    }

    pub fn dev_slot(&mut self, code: &str) {
        let mut by = self.my_slot_classes(code);
        let c = (0..6).rev().find(|&c| stands_of(code)[c] > 0).unwrap_or(2);
        by[c] += 1;
        self.dev_set_slots(code, by);
        self.dev_done(format!("a class {} slot at {code}", CLASSES[c]));
    }

    pub fn dev_world_event(&mut self, id: &str) {
        match self.make_event_pub(id) {
            Some(s) => {
                self.news(s);
                self.dev_done(format!("world event {id}"));
            }
            None => self.dev_done(format!("world event {id} – it doesn't fit right now (no slot airport?)")),
        }
    }

    /// An incident (true) or an emergency (false) on plane i's flight; it must be in the air.
    pub fn dev_trouble(&mut self, i: usize, incident: bool) -> Result<(), String> {
        let t = self.state.time;
        let name = Game::name_of(&self.state.planes[i]);
        let p = &mut self.state.planes[i];
        let Some(f) = p.flight.as_mut().filter(|_| p.status == Status::Flying) else {
            return Err(format!("{name} is on the ground: send it flying first."));
        };
        if incident {
            f.incident = true;
        } else {
            f.emergency_at = Some(t);
        }
        self.dev_done(format!("{} on {name}", if incident { "an incident" } else { "an emergency" }));
        Ok(())
    }

    pub fn dev_crash(&mut self, i: usize) -> Result<(), String> {
        let t = self.state.time;
        let name = Game::name_of(&self.state.planes[i]);
        let p = &mut self.state.planes[i];
        let Some(f) = p.flight.as_mut().filter(|_| p.status == Status::Flying) else {
            return Err(format!("{name} is on the ground: send it flying first."));
        };
        f.crash_at = Some(t + 1);
        self.dev_done(format!("{name} will crash"));
        Ok(())
    }

    pub fn dev_finish_projects(&mut self) {
        let t = self.state.time;
        let n = self.state.projects.len();
        for p in &mut self.state.projects {
            p.done = t;
        }
        self.finish_projects_pub();
        self.dev_done(format!("{n} projects finished"));
    }

    pub fn dev_market(&mut self) {
        self.refresh_market();
        self.dev_done("new pre-owned offers".into());
    }

    /// Time passes: `minutes` of the game played at once.
    pub fn dev_time(&mut self, minutes: i64) {
        self.advance(minutes);
        self.dev_done(format!("{} later", fmt_duration(minutes)));
    }

    /// Every plane's records, the rivals and the reputation as at the start (to measure from here).
    pub fn dev_reputation(&mut self, flown: u32) {
        self.state.rep.flown = flown;
        self.state.rep.crashes.clear();
        self.state.rep.incidents.clear();
        self.dev_done(format!("reputation reset ({flown} flights flown)"));
    }
}
