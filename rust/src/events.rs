//! Random events: world events once a day, incidents and crashes on flights, and their newspaper stories
//! (from the browser game's `js/data/events.js`).

use crate::config::*;
use crate::data::{data, interpolate};
use crate::game::*;

fn pick<'a>(list: &[&'a str]) -> &'a str {
    list[rand::random_range(0..list.len())]
}

fn rand_int(a: i64, b: i64) -> i64 {
    rand::random_range(a..=b)
}

fn story(good: bool, headline: String, sub: String, body: String) -> Story {
    Story { good, headline, sub, body, paper: String::new(), t: 0 }
}

fn country_name(code: &str) -> String {
    match code {
        "AT" => "Austria", "BE" => "Belgium", "BG" => "Bulgaria", "CH" => "Switzerland", "CZ" => "Czechia",
        "DE" => "Germany", "DK" => "Denmark", "ES" => "Spain", "FI" => "Finland", "FR" => "France", "GB" => "Britain",
        "GR" => "Greece", "HR" => "Croatia", "HU" => "Hungary", "IE" => "Ireland", "IS" => "Iceland", "IT" => "Italy",
        "LV" => "Latvia", "NL" => "the Netherlands", "NO" => "Norway", "PL" => "Poland", "PT" => "Portugal",
        "RO" => "Romania", "RS" => "Serbia", "SE" => "Sweden", "TR" => "Türkiye", "US" => "the United States",
        "CA" => "Canada", "AU" => "Australia", "JP" => "Japan", "CN" => "China", "IN" => "India", "BR" => "Brazil",
        _ => code,
    }
    .to_string()
}

struct Incident {
    weight: f64,
    grounded_hours: i64,
    repair: f64,
    maker: Option<&'static str>,
    story: fn(&IncidentInfo) -> Story,
}

struct IncidentInfo {
    id: String,
    company: String,
    kind: String,
    from: String,
    to: String,
    airport: String,
    repair: String,
}

/// In-flight emergencies (EMERGENCY_PER_FLIGHT). The news comes out when the crew declares it; CRASH_SHARE of
/// them end in a crash, the rest land at the destination and are grounded. `what` finishes "reports …".
struct Emergency {
    id: &'static str,
    weight: f64,
    grounded_hours: i64,
    repair: f64,
    what: &'static str,
    story: fn(&EmergencyInfo) -> Story,
}

struct EmergencyInfo {
    id: String,
    company: String,
    kind: String,
    from: String,
    to: String,
    place: String,
    airport: String,
    on_board: u32,
}

const EMERGENCIES: [Emergency; 5] = [
    Emergency { id: "engineFire", weight: 4.0, grounded_hours: 48, repair: 180000.0, what: "an engine fire", story: |x| story(
        false,
        format!("MAYDAY! ENGINE FIRE OVER {}", x.place.to_uppercase()),
        format!("{} {} with {} on board heads for {}", x.company, x.kind, x.on_board, x.airport),
        format!("Witnesses near {} saw flames trailing from an engine of flight {} ({}–{}). The crew shut the engine down, \
                 declared an emergency and is flying on to {}, where fire crews are waiting.", x.place, x.id, x.from, x.to, x.airport),
    ) },
    Emergency { id: "hydraulics", weight: 3.0, grounded_hours: 36, repair: 120000.0, what: "a hydraulic failure", story: |x| story(
        false,
        "MAYDAY: JET LOSES HYDRAULICS".into(),
        format!("{} flight {} struggles towards {}", x.company, x.id, x.airport),
        format!("The pilots of the {} report a hydraulic failure near {}, leaving them with heavy controls and gear that may \
                 have to be dropped by hand. {} people are on board. Emergency services at {} are on standby.", x.kind, x.place, x.on_board, x.airport),
    ) },
    Emergency { id: "depressurisation", weight: 3.0, grounded_hours: 30, repair: 90000.0, what: "a loss of cabin pressure", story: |x| story(
        false,
        "OXYGEN MASKS DROP IN DIVE".into(),
        format!("{} {} plunges 25,000 ft after losing pressure", x.company, x.kind),
        format!("Passengers on flight {} from {} filmed oxygen masks swinging as the jet dived over {}. The crew declared an \
                 emergency and is continuing at low altitude to {}.", x.id, x.from, x.place, x.airport),
    ) },
    Emergency { id: "gearFault", weight: 2.0, grounded_hours: 24, repair: 70000.0, what: "a landing gear fault", story: |x| story(
        false,
        "GEAR WON'T COME DOWN".into(),
        format!("{} jet circles with {} on board", x.company, x.on_board),
        format!("Flight {} ({}) declared an emergency near {} after a landing gear warning. The crew is burning off fuel before \
                 trying to land at {}; the runway is being foamed.", x.id, x.kind, x.place, x.airport),
    ) },
    Emergency { id: "smokeCockpit", weight: 2.0, grounded_hours: 30, repair: 60000.0, what: "smoke in the cockpit", story: |x| story(
        false,
        "SMOKE IN THE COCKPIT".into(),
        format!("Pilots of {} flight {} don oxygen masks", x.company, x.id),
        format!("The crew of the {} from {} to {} reported smoke in the cockpit over {} and declared an emergency. The jet is \
                 heading for {} as fast as it can.", x.kind, x.from, x.to, x.place, x.airport),
    ) },
];

const INCIDENTS: [Incident; 4] = [
    Incident { weight: 4.0, grounded_hours: 36, repair: 80000.0, maker: None, story: |x| story(
        false,
        "BIRD STRIKE FORCES RETURN".into(),
        format!("{} {} lands safely at {}", x.company, x.kind, x.airport),
        format!("Shortly after take-off from {}, flight {} flew through a flock of geese. The crew reported a damaged engine \
                 and landed safely at {}. The aircraft is grounded for repairs costing {}.", x.from, x.id, x.airport, x.repair),
    ) },
    Incident { weight: 4.0, grounded_hours: 24, repair: 40000.0, maker: None, story: |x| story(
        false,
        "SMOKE IN THE CABIN".into(),
        format!("{} jet evacuated at {}", x.company, x.airport),
        format!("Passengers on {} slid down emergency chutes at {} after an electrical fault filled the cabin with smoke. \
                 Nobody was seriously hurt. The {} is out of service for a day; repairs cost {}.", x.id, x.airport, x.kind, x.repair),
    ) },
    Incident { weight: 2.0, grounded_hours: 3, repair: 15000.0, maker: None, story: |x| story(
        false,
        "PASSENGER DUCT-TAPED TO SEAT".into(),
        format!("Unruly traveller causes chaos on {}–{} flight", x.from, x.to),
        format!("A passenger on {} flight {} tried to open a door in mid-air, shouting about \"the lizard people\". Fellow \
                 travellers restrained the passenger until police met the plane at {}. The airline faces cleaning and delay \
                 costs of {}.", x.company, x.id, x.airport, x.repair),
    ) },
    Incident { weight: 2.0, grounded_hours: 72, repair: 250000.0, maker: Some("Boeing"), story: |x| story(
        false,
        "DOOR PANEL BLOWS OUT AT 16,000 FT".into(),
        format!("Terrifying moments aboard {} {}", x.company, x.kind),
        format!("A panel tore off the fuselage of {} minutes after leaving {}, leaving a gaping hole in the cabin. The crew made \
                 an emergency landing at {}; everyone on board survived. Investigators found bolts missing. The plane is \
                 grounded for three days, repairs cost {}.", x.id, x.from, x.airport, x.repair),
    ) },
];

impl Game {
    /// A random airport where you hold a slot (that `ok` accepts).
    fn slot_airport(&self, ok: impl Fn(&crate::data::Airport) -> bool) -> Option<crate::data::Airport> {
        let d = data();
        let list: Vec<&crate::data::Airport> = self.state.slots.keys().map(|c| d.airport(c)).filter(|a| ok(a)).collect();
        if list.is_empty() { None } else { Some(list[rand::random_range(0..list.len())].clone()) }
    }

    fn effect(&mut self, label: String, hours: i64, at: Where, f: impl FnOnce(&mut Effect)) {
        let mut e = Effect { label, until: self.state.time + hours * 60, at, ..Default::default() };
        f(&mut e);
        self.state.effects.push(e);
    }

    /// Once a day: maybe a world event (strike, weather, fuel prices, festivals…).
    pub fn roll_world_event(&mut self) {
        let t = self.state.time;
        self.state.effects.retain(|e| e.until > t);
        if rand::random::<f64>() >= EVENTS_PER_DAY {
            return;
        }
        // (id, weight) as in events.js
        const LIST: [(&str, f64); 12] = [
            ("airportStrike", 3.0), ("atcStrike", 2.0), ("pilotStrike", 1.0), ("volcano", 1.0), ("storm", 3.0),
            ("fuelSpike", 2.0), ("fuelDrop", 2.0), ("festival", 3.0), ("football", 2.0), ("rivalBankrupt", 1.0),
            ("flu", 1.0), ("influencer", 2.0),
        ];
        let mut r = rand::random::<f64>() * LIST.iter().map(|x| x.1).sum::<f64>();
        let id = LIST.iter().find(|x| { r -= x.1; r < 0.0 }).unwrap_or(&LIST[0]).0;
        if let Some(s) = self.make_event(id) {
            self.news(s);
        }
    }

    pub(crate) fn make_event(&mut self, id: &str) -> Option<Story> {
        let company = self.state.company.clone();
        match id {
            "airportStrike" => {
                let a = self.slot_airport(|_| true)?;
                let days = rand_int(1, 2);
                self.effect(format!("Ground staff strike at {}", a.code), days * 24,
                    Where { airport: Some(a.code.clone()), ..Default::default() }, |e| e.no_flights = true);
                Some(story(false, format!("{} AIRPORT PARALYSED BY STRIKE", a.city.to_uppercase()),
                    format!("Baggage handlers and ground staff walk out for {}", if days == 1 { "one day".into() } else { format!("{days} days") }),
                    format!("Travellers at {} faced empty check-in desks this morning as ground staff downed tools over pay. \
                             \"Nothing moves until management listens,\" a union spokesperson told reporters outside Terminal 1. \
                             All departures and arrivals are cancelled.", a.name)))
            }
            "atcStrike" => {
                let a = self.slot_airport(|x| x.country != "CH").or_else(|| self.slot_airport(|_| true))?;
                let country = country_name(&a.country);
                self.effect(format!("Air traffic control strike in {country}"), 24,
                    Where { country: Some(a.country.clone()), ..Default::default() }, |e| e.no_flights = true);
                Some(story(false, format!("CONTROLLERS STRIKE: {}'S SKIES EMPTY", country.to_uppercase()),
                    "Air traffic controllers walk out for 24 hours".into(),
                    format!("Air traffic control in {country} ground to a halt at dawn. No flights may take off or land at any \
                             airport in the country until tomorrow. Airlines called the strike \"the {}th this year\" and demanded \
                             compensation.", rand_int(3, 9))))
            }
            "pilotStrike" => {
                for p in &mut self.state.planes {
                    p.crew.weekly_salary = (p.crew.weekly_salary * 1.04).round();
                }
                self.effect("Your pilots are on strike".into(), 24, Where { all: true, ..Default::default() }, |e| e.no_flights = true);
                Some(story(false, format!("{} PILOTS STRIKE", company.to_uppercase()),
                    "Entire fleet grounded for a day – management concedes 4% pay rise".into(),
                    format!("Pilots of {company} gathered on the apron with hand-painted signs reading \"Fair pay for fair skies\". \
                             After a tense night of negotiations the airline agreed to raise all crew salaries by 4%. Flights resume tomorrow.")))
            }
            "volcano" => {
                let days = rand_int(2, 4);
                self.effect("Volcanic ash cloud over the North Atlantic".into(), days * 24,
                    Where { near: Some((60.0, -8.0)), radius_km: 1500.0, ..Default::default() }, |e| e.no_flights = true);
                Some(story(false, "ICELANDIC VOLCANO ERUPTS – ASH CLOSES NORTHERN SKIES".into(),
                    format!("Airspace over Iceland, Britain, Ireland and Scandinavia shut for {days} days"),
                    "A towering plume of ash rose from an Icelandic volcano overnight. Aviation authorities closed airspace across \
                     the North Atlantic and northern Europe as the cloud drifted south-east. Volcanologists could not say how long it will last.".into()))
            }
            "storm" => {
                let a = self.slot_airport(|_| true)?;
                let name = pick(&["Anna", "Bruno", "Ciara", "Dieter", "Elsa", "Franz", "Greta", "Hugo", "Ingrid", "Jules"]);
                let doy = (self.state.time / DAY) % 365;
                let winter = !(60..=270).contains(&doy);
                self.effect(format!("Storm {name}"), 18, Where { near: Some((a.lat, a.lon)), radius_km: 400.0, ..Default::default() },
                    |e| { e.no_flights = true; e.storm = true; });
                Some(story(false, format!("STORM {} BATTERS {}", name.to_uppercase(), a.city.to_uppercase()),
                    if winter { "Blizzard closes runways across the region".into() } else { "Hurricane-force gusts ground all flights".into() },
                    format!("Storm {name} swept in with gusts of up to {} km/h. Airports within 400 km of {} suspended operations as \
                             crews struggled to keep runways clear. Forecasters expect calmer weather by tomorrow.", rand_int(110, 160), a.city)))
            }
            "fuelSpike" => {
                let pct = rand_int(15, 35);
                self.effect(format!("Fuel price +{pct}%"), 7 * 24, Where { all: true, ..Default::default() },
                    |e| e.cost_mult = Some(1.0 + pct as f64 / 100.0));
                Some(story(false, format!("OIL SHOCK: JET FUEL UP {pct}%"), "Airlines brace for a costly week".into(),
                    format!("Crude prices surged after producers announced surprise output cuts. Jet fuel now costs {pct}% more, \
                             and analysts warn that thin-margin airlines will feel it in their operating costs all week.")))
            }
            "fuelDrop" => {
                let pct = rand_int(10, 20);
                self.effect(format!("Fuel price −{pct}%"), 7 * 24, Where { all: true, ..Default::default() },
                    |e| e.cost_mult = Some(1.0 - pct as f64 / 100.0));
                Some(story(true, format!("JET FUEL PRICES TUMBLE {pct}%"), "Good week for airline accountants".into(),
                    format!("A glut of crude oil sent fuel prices sliding. Operating costs for airlines drop by about {pct}% \
                             this week, though experts doubt the relief will last.")))
            }
            "festival" => {
                let a = self.slot_airport(|_| true)?;
                let what = pick(&["music festival", "film festival", "wine fair", "marathon", "trade fair", "royal wedding"]);
                let mut label = what.to_string();
                label[..1].make_ascii_uppercase();
                self.effect(format!("{label} in {}", a.city), 5 * 24, Where { airport: Some(a.code.clone()), ..Default::default() },
                    |e| e.demand_mult = Some(1.6));
                Some(story(true, format!("{} {} DRAWS RECORD CROWDS", a.city.to_uppercase(), what.to_uppercase()),
                    "Hotels fully booked, flights selling out".into(),
                    format!("Visitors are pouring into {} for this year's {what}. Demand for flights to and from {} is up by around \
                             60% for the next five days, and travel agents report a rush on last-minute tickets.", a.city, a.name)))
            }
            "football" => {
                let a = self.slot_airport(|x| x.size >= 3).or_else(|| self.slot_airport(|_| true))?;
                self.effect(format!("Cup final in {}", a.city), 2 * 24, Where { airport: Some(a.code.clone()), ..Default::default() },
                    |e| e.demand_mult = Some(2.0));
                Some(story(true, format!("CUP FINAL FEVER GRIPS {}", a.city.to_uppercase()), "Tens of thousands of fans on their way".into(),
                    format!("With the cup final kicking off in {} on Saturday, supporters are booking every seat they can find. \
                             Airlines serving the city expect twice the usual traffic for two days.", a.city)))
            }
            "rivalBankrupt" => {
                let gone = self.bust_rival();
                let (rival, what, routes) = match &gone {
                    Some(r) => (r.name.clone(), match r.kind.as_str() { "flag" => "Flag carrier", "low" => "Low-cost carrier", _ => "Regional airline" }, Some(r.routes.len())),
                    None => (pick(&["Air Edelweissbrot", "FlyCheapo", "Alpenwind Airways", "SkyBudget", "Eurojumbo"]).to_string(), "Low-cost carrier", None),
                };
                self.effect(format!("{rival} collapsed – more passengers for you"), 10 * 24, Where { all: true, ..Default::default() },
                    |e| e.demand_mult = Some(1.25));
                Some(story(true, format!("{} GOES BUST", rival.to_uppercase()), "Thousands of passengers stranded – rivals step in".into(),
                    format!("{what} {rival} ceased operations overnight after failing to find new investors{}. {company} and other \
                             airlines expect about 25% more bookings over the next ten days.",
                        routes.map(|n| format!(" – its {n} routes are gone")).unwrap_or_default())))
            }
            "flu" => {
                self.effect("Flu wave – fewer travellers".into(), 7 * 24, Where { all: true, ..Default::default() }, |e| e.demand_mult = Some(0.65));
                Some(story(false, "FLU WAVE SWEEPS THE CONTINENT".into(), "Holidaymakers cancel trips by the thousand".into(),
                    "Health authorities report the worst flu season in a decade. Travel bookings have dropped by a third, and \
                     airlines are flying half-empty planes.".into()))
            }
            "influencer" => {
                let a = self.slot_airport(|_| true)?;
                self.effect(format!("{} is trending online", a.city), 7 * 24, Where { airport: Some(a.code.clone()), ..Default::default() },
                    |e| e.demand_mult = Some(1.35));
                Some(story(true, format!("\"HIDDEN GEM\": {} GOES VIRAL", a.city.to_uppercase()),
                    "A travel video with 40 million views sends tourists flocking".into(),
                    format!("A famous travel influencer called {} \"the most underrated city around\". Bookings to {} jumped 35% \
                             within hours. Locals are less impressed.", a.city, a.code)))
            }
            _ => None,
        }
    }

    /// Mayday in the air: the news comes out now, and crash_chance decides if it crashes a few minutes later
    /// (before it would land) or lands safely at its destination (emergency_landed).
    pub(crate) fn emergency(&mut self, i: usize) {
        let d = data();
        let t = self.state.time;
        let mut r = rand::random::<f64>() * EMERGENCIES.iter().map(|e| e.weight).sum::<f64>();
        let em = EMERGENCIES.iter().find(|e| {
            r -= e.weight;
            r < 0.0
        }).unwrap_or(&EMERGENCIES[0]);
        let crash = rand::random::<f64>() < self.crash_chance(&self.state.planes[i].kind.clone());
        let p = &mut self.state.planes[i];
        let Some(f) = p.flight.as_mut() else { return };
        f.emergency = Some(em.id.into());
        f.incident = false;
        if crash {
            f.crash_at = Some(t.max((f.arr - 1).min(t + 3 + rand::random_range(0..13))));
        }
        let f = f.clone();
        let p = p.clone();
        let frac = (t - f.dep) as f64 / (f.arr - f.dep).max(1) as f64;
        let (a, b) = (d.airport(&f.from), d.airport(&f.to));
        let (lat, lon) = interpolate(a.lat, a.lon, b.lat, b.lon, frac);
        let ac = d.ac(&p.kind);
        self.log(
            format!("⚠ MAYDAY: {} ({}) on {}→{} reports {} – heading for {}.", Game::name_of(&p), ac.name, f.from, f.to, em.what, b.name),
            LogKind::Bad,
        );
        let x = EmergencyInfo {
            id: p.id.clone(),
            company: self.state.company.clone(),
            kind: ac.name.clone(),
            from: f.from.clone(),
            to: f.to.clone(),
            place: d.nearest_town(lat, lon),
            airport: b.name.clone(),
            on_board: f.pax + p.crew.pilots + p.crew.cabin,
        };
        self.news((em.story)(&x));
    }

    /// The emergency ended well: the plane is grounded for an inspection and repairs.
    pub(crate) fn emergency_landed(&mut self, i: usize, f: &Flight) {
        let id = f.emergency.clone().unwrap_or_default();
        let em = EMERGENCIES.iter().find(|e| e.id == id).unwrap_or(&EMERGENCIES[0]);
        let t = self.state.time;
        self.state.money -= em.repair;
        self.state.today.cost += em.repair;
        let p = &mut self.state.planes[i];
        p.stats.repair += em.repair;
        p.stats.incidents += 1;
        let w = t.div_euclid(DAY * 7);
        let y = year_of(t);
        for wk in p.stats.weeks.iter_mut().filter(|x| x.week == w).chain(p.stats.years.iter_mut().filter(|x| x.week == y)) {
            wk.repair += em.repair;
        }
        p.ready_at = p.ready_at.max(t + em.grounded_hours * 60);
        p.repair = true;
        let name = Game::name_of(p);
        self.state.rep.incidents.push(t);
        self.log(
            format!(
                "✔ {name} landed safely at {} after {}. Everyone is fine; inspection and repairs cost {}, grounded {} h.",
                data().airport(&f.to).name,
                em.what,
                fmt_money(em.repair),
                em.grounded_hours
            ),
            LogKind::Good,
        );
    }

    pub(crate) fn incident(&mut self, i: usize, f: &Flight) {
        let d = data();
        let (kind, id) = (self.state.planes[i].kind.clone(), self.state.planes[i].id.clone());
        let ac = d.ac(&kind);
        let mm = self.maker_mult(&kind);
        let list: Vec<(&Incident, f64)> = INCIDENTS
            .iter()
            .filter(|x| x.maker.is_none_or(|m| m == ac.maker))
            .map(|x| (x, x.weight * if x.maker.is_some() { mm } else { 1.0 }))
            .collect();
        let mut r = rand::random::<f64>() * list.iter().map(|x| x.1).sum::<f64>();
        let inc = list.iter().find(|x| { r -= x.1; r < 0.0 }).unwrap_or(&list[0]).0;
        let t = self.state.time;
        self.state.money -= inc.repair;
        self.state.today.cost += inc.repair;
        let p = &mut self.state.planes[i];
        p.stats.repair += inc.repair;
        p.stats.incidents += 1;
        let w = t.div_euclid(DAY * 7);
        let y = year_of(t);
        for wk in p.stats.weeks.iter_mut().filter(|x| x.week == w).chain(p.stats.years.iter_mut().filter(|x| x.week == y)) {
            wk.repair += inc.repair;
        }
        p.ready_at = p.ready_at.max(t + inc.grounded_hours * 60);
        p.repair = true;
        self.state.rep.incidents.push(t);
        let info = IncidentInfo {
            id,
            company: self.state.company.clone(),
            kind: ac.name.clone(),
            from: f.from.clone(),
            to: f.to.clone(),
            airport: d.airport(&f.to).name.clone(),
            repair: fmt_money(inc.repair),
        };
        self.news((inc.story)(&info));
    }

    pub(crate) fn crash(&mut self, i: usize) {
        let d = data();
        let t = self.state.time;
        let p = self.state.planes[i].clone();
        let f = p.flight.clone().unwrap();
        let ac = d.ac(&p.kind);
        let frac = (t - f.dep) as f64 / (f.arr - f.dep).max(1) as f64;
        let (a, b) = (d.airport(&f.from), d.airport(&f.to));
        let (lat, lon) = interpolate(a.lat, a.lon, b.lat, b.lon, frac);
        let on_board = f.pax + p.crew.pilots + p.crew.cabin;
        let r = rand::random::<f64>();
        let survivors = if r < 0.35 { on_board } else if r < 0.7 { (on_board as f64 * rand::random::<f64>()).floor() as u32 } else { 0 };
        let compensation = f.pax as f64 * CRASH_PAX_COMPENSATION + CRASH_INVESTIGATION;
        let (hull, cash) = if p.ownership == Ownership::Owned {
            let value = self.sale_value(i);
            let insurance = (value * CRASH_INSURANCE_SHARE).round();
            (value - insurance, insurance - compensation)
        } else {
            let hull = ac.lease_per_week * CRASH_LEASE_PENALTY_WEEKS;
            (hull, -hull - compensation)
        };
        self.state.money += cash;
        if cash < 0.0 { self.state.today.cost += -cash } else { self.state.today.revenue += cash }
        self.state.planes.remove(i);
        self.state.rep.crashes.push(t);
        let name = Game::name_of(&p);
        self.state.effects.push(Effect {
            label: format!("Bookings slump after the {name} crash"),
            until: t + CRASH_REP_DAYS * DAY,
            at: Where { all: true, ..Default::default() },
            demand_mult: Some(CRASH_REP_DEMAND),
            ..Default::default()
        });
        let place = d.nearest_town(lat, lon);
        self.log(
            format!("✖ {name} ({}) crashed near {place} on {}→{}. {survivors}/{on_board} survived. Cash effect {}.",
                ac.name, f.from, f.to, fmt_money(cash)),
            LogKind::Bad,
        );
        let company = self.state.company.clone();
        let all = survivors == on_board;
        let none = survivors == 0;
        self.news(story(
            false,
            if all {
                format!("MIRACLE NEAR {}: ALL {on_board} SURVIVE CRASH", place.to_uppercase())
            } else {
                format!("{} JET CRASHES NEAR {}", company.to_uppercase(), place.to_uppercase())
            },
            if all {
                format!("{} {} destroyed in emergency landing", ac.name, p.id)
            } else if none {
                format!("No survivors among {on_board} on board flight {}–{}", f.from, f.to)
            } else {
                format!("{survivors} of {on_board} on board survive")
            },
            format!(
                "{company} flight {} from {} to {}, a {}, went down near {place}. {}Accident investigators have recovered the flight \
                 recorders. Bookings with {company} are expected to slump for weeks; compensation, investigation and the lost \
                 aircraft cost the airline {}.",
                p.id, f.from, f.to, ac.name,
                if all { "Rescue teams found everyone alive in the wreckage, an outcome experts called \"astonishing\". " } else { "Rescue teams are searching the crash site. " },
                fmt_money(compensation + hull)
            ),
        ));
    }
}
