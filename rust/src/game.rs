//! Game state and simulation (the Rust port of the browser game's `js/game.js`). No UI code in here.
//!
//! Time is in game minutes since the start; a day is 1440 minutes and day 0 is a Monday.

use crate::config::*;
use crate::data::{bearing, data, distance_km, interpolate};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};

pub const WEEKDAYS: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
pub const CLASSES: [&str; 6] = ["A", "B", "C", "D", "E", "F"];
const CLASS_SPAN: [f64; 6] = [15.0, 24.0, 36.0, 52.0, 65.0, 80.0];
/// The biggest stand class an airport has, by size (the browser game reads it off the real layout).
const CLASS_BY_SIZE: [usize; 6] = [2, 2, 3, 4, 4, 5];
const STATS_WEEKS: usize = 12;
const STATS_RECENT: usize = 8;

// ---------- state ----------

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Leg {
    pub from: String,
    pub to: String,
    /// minutes after midnight
    pub dep: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Schedule {
    pub stops: Vec<String>,
    pub legs: Vec<Leg>,
    pub index: usize,
    pub active: bool,
    /// when the next leg is due to leave (absolute minutes)
    pub due: i64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Idle,
    Flying,
    Turnaround,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum FlightKind {
    Scheduled,
    Ferry,
    Delivery,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ownership {
    Leased,
    Owned,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Flight {
    pub from: String,
    pub to: String,
    pub kind: FlightKind,
    pub dep: i64,
    pub arr: i64,
    pub distance: f64,
    pub pax: u32,
    pub revenue: f64,
    pub cost: f64,
    pub crash_at: Option<i64>,
    pub incident: bool,
    /// when the crew declares an emergency (it may end in a crash), and which one once declared
    #[serde(default)]
    pub emergency_at: Option<i64>,
    #[serde(default)]
    pub emergency: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Crew {
    pub pilots: u32,
    pub cabin: u32,
    pub weekly_salary: f64,
    /// one crew, or two on a long-haul day (the second one is paid too)
    pub sets: u32,
    pub duty_today: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Tally {
    pub week: i64,
    pub rev: f64,
    pub cost: f64,
    pub fixed: f64,
    pub repair: f64,
    pub flights: u32,
    pub pax: u32,
}

impl Tally {
    pub fn profit(&self) -> f64 {
        self.rev - self.cost - self.fixed - self.repair
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Recent {
    pub t: i64,
    pub from: String,
    pub to: String,
    pub kind: FlightKind,
    pub pax: u32,
    pub seats: u32,
    pub result: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Stats {
    pub flights: u32,
    pub pax: u64,
    pub seats: u64,
    pub rev: f64,
    pub cost: f64,
    pub fixed: f64,
    pub repair: f64,
    pub km: f64,
    pub mins: i64,
    pub on_time: u32,
    pub late: u32,
    pub incidents: u32,
    pub ferries: u32,
    pub weeks: Vec<Tally>,
    pub recent: Vec<Recent>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Plane {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub name: Option<String>,
    pub location: String,
    pub status: Status,
    pub ownership: Ownership,
    /// years when acquired
    pub age: f64,
    pub acquired_at: i64,
    pub ready_at: i64,
    pub flight: Option<Flight>,
    pub pending_ferry: Option<String>,
    pub wait_slot: Option<String>,
    pub repair: bool,
    pub schedule: Schedule,
    pub crew: Crew,
    pub stats: Stats,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SlotHolding {
    pub since: i64,
    pub count: u32,
    /// the slots by stand class A–F (a plane needs one of its class or bigger)
    #[serde(default)]
    pub by_class: Vec<u32>,
}

/// The slots of an airport by class: capacity, yours, held by others, free.
pub struct SlotTable {
    pub cap: [u32; 6],
    pub mine: [u32; 6],
    pub held: [u32; 6],
    pub free: [u32; 6],
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RivalRoute {
    pub a: String,
    pub b: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub seats: u32,
    pub per_day: u32,
    pub fare: f64,
    pub since: i64,
    pub weak: u32,
    pub value: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Rival {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub hubs: Vec<String>,
    pub color: String,
    pub routes: Vec<RivalRoute>,
    pub since: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Where {
    pub all: bool,
    pub airport: Option<String>,
    pub country: Option<String>,
    pub near: Option<(f64, f64)>,
    pub radius_km: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Effect {
    pub label: String,
    pub until: i64,
    pub at: Where,
    pub demand_mult: Option<f64>,
    pub cost_mult: Option<f64>,
    pub no_flights: bool,
    pub storm: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Story {
    pub good: bool,
    pub headline: String,
    pub sub: String,
    pub body: String,
    #[serde(default)]
    pub paper: String,
    #[serde(default)]
    pub t: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Today {
    pub revenue: f64,
    pub cost: f64,
    pub fixed: f64,
    pub flights: u32,
    pub pax: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DayRecord {
    pub day: i64,
    pub revenue: f64,
    pub cost: f64,
    pub fixed: f64,
    pub flights: u32,
    pub pax: u32,
    pub cash: f64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogKind {
    Info,
    Good,
    Bad,
    Cost,
    Summary,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LogEntry {
    pub t: i64,
    pub msg: String,
    pub kind: LogKind,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Listing {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub age: i64,
    pub price: f64,
    pub at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Market {
    pub listings: Vec<Listing>,
    pub next_id: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Rep {
    pub flown: u32,
    pub on_time: f64,
    pub late: f64,
    pub crashes: Vec<i64>,
    pub incidents: Vec<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct State {
    pub version: u32,
    pub mode: String,
    pub difficulty: String,
    pub home: String,
    pub company: String,
    pub time: i64,
    pub money: f64,
    pub slots: BTreeMap<String, SlotHolding>,
    pub planes: Vec<Plane>,
    pub fares: HashMap<String, f64>,
    pub carried_today: HashMap<String, u32>,
    pub today: Today,
    pub history: Vec<DayRecord>,
    pub log: Vec<LogEntry>,
    pub market: Market,
    pub effects: Vec<Effect>,
    pub news: Vec<Story>,
    pub rivals: Vec<Rival>,
    pub rep: Rep,
    /// code -> holder id -> slots bought from it
    pub slot_buys: HashMap<String, HashMap<String, u32>>,
    /// "code|holder" -> time a slot offer was turned down
    pub offers: HashMap<String, i64>,
    pub game_over: bool,
}

pub struct NewGame {
    pub company: String,
    pub mode: String,
    pub difficulty: String,
    pub airport: String,
    pub aircraft: String,
}

impl Default for NewGame {
    fn default() -> Self {
        Self {
            company: COMPANY_NAME.into(),
            mode: "arcade".into(),
            difficulty: "normal".into(),
            airport: START_AIRPORT.into(),
            aircraft: START_AIRCRAFT.into(),
        }
    }
}

pub struct SlotHolder {
    pub id: String,
    pub name: String,
    pub color: String,
    pub n: u32,
    pub hub: bool,
}

pub struct Estimate {
    pub rows: Vec<(Leg, i64, u32, f64)>, // leg, block minutes, pax, result
    pub pax: u32,
    pub profit: f64,
    pub block: i64,
    pub fixed_per_day: f64,
}

/// A plane drawn on the map.
pub struct MapPlane {
    pub lat: f64,
    pub lon: f64,
    pub heading: f64,
    pub color: String,
    pub plane: Option<usize>,
    pub label: String,
}

// ---------- the model: free functions on the data ----------

pub fn airport_size(code: &str) -> usize {
    data().airport(code).size.min(5)
}

pub fn airport_category(code: &str) -> &'static str {
    match airport_size(code) {
        0 | 1 => "Small airport",
        2 => "Regional airport",
        3 | 4 => "Large airport",
        _ => "Major hub",
    }
}

/// Small airfields without an IATA code get fewer passengers.
pub fn attraction(code: &str) -> f64 {
    let a = data().airport(code);
    if a.minor && a.size < 2 { MINOR_FACTOR } else { 1.0 }
}

/// Short hops lose to trains and cars, very long ones get less demand.
pub fn distance_factor(d: f64) -> f64 {
    let mut f = ((d - 100.0) / 500.0).clamp(0.1, 1.0);
    if d > 2500.0 {
        f *= 2500.0 / d;
    }
    f
}

pub fn daily_demand(from: &str, to: &str) -> f64 {
    let d = data();
    let (a, b) = (d.airport(from), d.airport(to));
    (DEMAND_FACTOR * (a.catchment * b.catchment).sqrt() * distance_factor(d.dist(from, to)) * attraction(from) * attraction(to))
        .round()
}

pub fn ticket_price(d: f64) -> f64 {
    (TICKET_BASE + TICKET_PER_KM * d).round()
}

pub fn route_key(a: &str, b: &str) -> String {
    if a < b { format!("{a}-{b}") } else { format!("{b}-{a}") }
}

/// First moment at or after `after` that is `tod` minutes past midnight.
pub fn next_at(tod: i64, after: i64) -> i64 {
    after + (tod - after.rem_euclid(DAY)).rem_euclid(DAY)
}

pub fn block_minutes(kind: &str, d: f64) -> i64 {
    (d / data().ac(kind).speed_kmh * 60.0 + TAXI_MIN).round() as i64
}

pub fn leg_block(kind: &str, from: &str, to: &str) -> i64 {
    block_minutes(kind, data().dist(from, to))
}

pub fn turnaround_min(kind: &str) -> i64 {
    let seats = data().ac(kind).seats as f64;
    ((((TURNAROUND_BASE + TURNAROUND_PER_SEAT * seats) / 5.0).round() * 5.0) as i64).clamp(TURNAROUND_MIN, TURNAROUND_MAX)
}

pub fn landing_fee(code: &str) -> f64 {
    LANDING_FEE_BASE + LANDING_FEE_PER_SIZE * airport_size(code) as f64
}

pub fn slot_upfront(code: &str) -> f64 {
    SLOT_UPFRONT[airport_size(code)]
}

pub fn slot_weekly(code: &str) -> f64 {
    SLOT_WEEKLY[airport_size(code)]
}

pub fn flight_cost(kind: &str, d: f64, to: &str, pax: u32, cost_mult: f64) -> f64 {
    let block = block_minutes(kind, d) as f64;
    (block / 60.0 * data().ac(kind).cost_per_block_hour * cost_mult + landing_fee(to) + pax as f64 * PAX_FEE).round()
}

/// ICAO stand class A–F (0–5) by wingspan.
pub fn type_class(kind: &str) -> usize {
    let span = data().ac(kind).span;
    CLASS_SPAN.iter().position(|&m| span < m).unwrap_or(5)
}

/// The biggest stand class an airport has: from its real stands where the game knows them, else by its size.
pub fn max_class(code: &str) -> usize {
    let a = data().airport(code);
    if a.factory {
        return 5;
    }
    if a.real_stands {
        return (0..6).rev().find(|&c| a.stands[c] > 0).unwrap_or(0);
    }
    CLASS_BY_SIZE[a.size.min(5)]
}

/// Do planes of these classes fit into slots `have` (by class)? Each needs one of its class or bigger.
pub fn slots_fit(have: &[u32; 6], needs: &[usize]) -> bool {
    let (mut h, mut n) = (0, 0);
    for c in (0..6).rev() {
        h += have[c];
        n += needs.iter().filter(|&&x| x == c).count() as u32;
        if n > h {
            return false;
        }
    }
    true
}

pub fn class_list(n: &[u32; 6]) -> String {
    let parts: Vec<String> = (0..6).filter(|&c| n[c] > 0).map(|c| format!("{}× {}", n[c], CLASSES[c])).collect();
    if parts.is_empty() { "none".into() } else { parts.join(", ") }
}

// ---------- local time ----------
// The game clock is the time at the home airport. Every airport has its own local time (its zone's UTC offsets in
// winter and summer and the days the clocks change), and the night curfew is in local time.

pub fn day_of_year(t: i64) -> i64 {
    t.div_euclid(DAY).rem_euclid(365)
}

/// Minutes ahead of UTC at an airport on game day t (summer time included), as the browser game reckons it.
pub fn utc_offset(code: &str, t: i64) -> i64 {
    let z = &data().airport(code).zone;
    if z.len() < 4 {
        return *z.first().unwrap_or(&0) as i64 * 15;
    }
    let doy = day_of_year(t) as i32;
    let north = z[2] < z[3];
    let summer = if north { doy >= z[2] && doy < z[3] } else { doy >= z[2] || doy < z[3] };
    (if summer == north { z[1] } else { z[0] }) as i64 * 15
}

/// "UTC+2", "UTC−4", "UTC+5:45"
pub fn fmt_zone(code: &str, t: i64) -> String {
    let m = utc_offset(code, t);
    let (h, mm) = (m.abs() / 60, m.abs() % 60);
    format!("UTC{}{h}{}", if m < 0 { '−' } else { '+' }, if mm > 0 { format!(":{mm:02}") } else { String::new() })
}

/// The runway a type needs (m) and whether it must be paved.
pub fn runway_need(kind: &str) -> (f64, bool) {
    let ac = data().ac(kind);
    let paved_cat = ac.category != "turboprop" && ac.category != "classic";
    if let Some(m) = ac.runway_m {
        return (m, paved_cat);
    }
    let min = ac.min_airport.max(1) as f64;
    let m = match ac.category.as_str() {
        "turboprop" => {
            if ac.seats <= 19 {
                500.0
            } else if ac.seats <= 50 {
                1000.0
            } else {
                1200.0
            }
        }
        "regional" => 1400.0,
        "narrowbody" => 1600.0 + (min - 1.0) * 200.0,
        "widebody" => 2100.0 + (min - 1.0) * 200.0,
        _ => 1500.0,
    };
    (m, ac.category != "turboprop")
}

/// Why a type can't use an airport, or None.
pub fn fits_reason(kind: &str, code: &str) -> Option<String> {
    let d = data();
    let a = d.airport(code);
    if a.factory {
        return None;
    }
    let ac = d.ac(kind);
    let pc = type_class(kind);
    if max_class(code) < pc {
        return Some(format!(
            "{code} has no stand big enough for the {} (class {}: {} m wingspan).",
            ac.name, CLASSES[pc], ac.span
        ));
    }
    let (m, paved) = runway_need(kind);
    let have = if paved { a.runway_paved } else { a.runway };
    if have < m {
        return Some(format!(
            "The {} needs {m:.0} m of {}runway, {code} has {have:.0} m.",
            ac.name,
            if paved { "paved " } else { "" }
        ));
    }
    None
}

pub fn fits_airport(kind: &str, code: &str) -> bool {
    fits_reason(kind, code).is_none()
}

pub fn crew_for(kind: &str) -> Crew {
    let ac = data().ac(kind);
    let pilots = ac.pilots.unwrap_or(if ac.category == "widebody" { 3 } else { 2 });
    let cabin = if ac.seats < 20 { 0 } else { ac.seats.div_ceil(50) };
    Crew { pilots, cabin, weekly_salary: pilots as f64 * PILOT_SALARY + cabin as f64 * CABIN_SALARY, sets: 1, duty_today: 0 }
}

pub fn crew_weekly(c: &Crew) -> f64 {
    c.weekly_salary * c.sets.max(1) as f64
}

pub fn crews_for(kind: &str, legs: &[Leg]) -> u32 {
    let duty: i64 = legs.iter().map(|l| leg_block(kind, &l.from, &l.to)).sum();
    if duty > CREW_MAX_DUTY_MIN { CREWS_MAX } else { 1 }
}

pub fn price_new(kind: &str) -> f64 {
    let ac = data().ac(kind);
    ac.price.unwrap_or(ac.lease_per_week * PRICE_WEEKS)
}

pub fn used_price(kind: &str, age: f64) -> f64 {
    (price_new(kind) * (1.0 - DEPRECIATION_PER_YEAR).powf(age) / 1000.0).round() * 1000.0
}

pub fn lease_deposit(kind: &str) -> f64 {
    data().ac(kind).lease_per_week * LEASE_DEPOSIT_WEEKS
}

fn hash01(a: f64, b: f64, c: f64) -> f64 {
    let x = (a * 12.9898 + b * 78.233 + c * 37.719).sin() * 43758.5453;
    x - x.floor()
}

// ---------- formatting ----------

pub fn fmt_money(n: f64) -> String {
    let v = n.round() as i64;
    let digits = v.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push('’');
        }
        out.push(c);
    }
    format!("{}{CURRENCY} {out}", if v < 0 { "-" } else { "" })
}

pub fn fmt_clock(t: i64) -> String {
    let m = t.rem_euclid(DAY);
    format!("{:02}:{:02}", m / 60, m % 60)
}

pub fn fmt_time(t: i64) -> String {
    let day = t.div_euclid(DAY);
    format!("Day {} ({}) {}", day + 1, WEEKDAYS[day.rem_euclid(7) as usize], fmt_clock(t))
}

pub fn fmt_duration(m: i64) -> String {
    format!("{}h{:02}", m / 60, m % 60)
}

/// Where the sun is at UTC minute `u` of day-of-year `doy`: (declination, longitude overhead, equation of time).
fn sun_point(doy: f64, u: f64) -> (f64, f64, f64) {
    let doy = doy + u.rem_euclid(DAY as f64) / DAY as f64;
    let g = 2.0 * std::f64::consts::PI * (doy - 1.0) / 365.0;
    let dec = 0.006918 - 0.399912 * g.cos() + 0.070257 * g.sin() - 0.006758 * (2.0 * g).cos() + 0.000907 * (2.0 * g).sin()
        - 0.002697 * (3.0 * g).cos()
        + 0.00148 * (3.0 * g).sin();
    let eot = 229.18
        * (0.000075 + 0.001868 * g.cos() - 0.032077 * g.sin() - 0.014615 * (2.0 * g).cos() - 0.040849 * (2.0 * g).sin());
    let lon = ((720.0 - u.rem_euclid(DAY as f64) - eot) / 4.0 + 540.0).rem_euclid(360.0) - 180.0;
    (dec.to_degrees(), lon, eot)
}

/// Sunrise and sunset at an airport on game day t, as local clock times; None in polar day or night.
pub fn sun_times(code: &str, t: i64) -> Option<(String, String)> {
    let a = data().airport(code);
    let (dec, _, eot) = sun_point(day_of_year(t) as f64, 720.0);
    let c = ((-0.833f64).to_radians().sin() - a.lat.to_radians().sin() * dec.to_radians().sin())
        / (a.lat.to_radians().cos() * dec.to_radians().cos());
    if !(-1.0..=1.0).contains(&c) {
        return None;
    }
    let h0 = c.acos().to_degrees() / 15.0 * 60.0;
    let transit = 720.0 - 4.0 * a.lon - eot;
    let off = utc_offset(code, t) as f64;
    let clock = |m: f64| fmt_clock((m + off).round() as i64);
    Some((clock(transit - h0), clock(transit + h0)))
}

// ---------- the game ----------

pub struct Game {
    pub state: State,
    rival_idx: HashMap<String, Vec<(usize, usize)>>,
    seat_cache: RefCell<Option<(String, HashMap<String, f64>)>>,
}

impl Game {
    pub fn from_state(state: State) -> Self {
        let mut g = Game { state, rival_idx: HashMap::new(), seat_cache: RefCell::new(None) };
        g.index_rivals();
        g
    }

    // ---------- local time and the night curfew ----------

    /// Minutes an airport's clock is ahead of the home base's, today.
    pub fn ahead_of(&self, code: &str) -> i64 {
        let now = self.state.time;
        utc_offset(code, now) - utc_offset(&self.state.home, now)
    }

    /// Local time of day at an airport for game time t.
    pub fn local_tod(&self, code: &str, t: i64) -> i64 {
        (t + self.ahead_of(code)).rem_euclid(DAY)
    }

    /// A game time as the local clock at an airport ("07:00").
    pub fn fmt_at(&self, code: &str, t: i64) -> String {
        fmt_clock(self.local_tod(code, t))
    }

    /// Departures from an airport only between CURFEW_START and CURFEW_END there, local time.
    pub fn curfew_open(&self, code: &str, t: i64) -> bool {
        (CURFEW_START..=CURFEW_END).contains(&self.local_tod(code, t))
    }

    /// When planes may next leave an airport (game time; t itself while its curfew is open).
    pub fn curfew_opens_at(&self, code: &str, t: i64) -> i64 {
        if self.curfew_open(code, t) { t } else { t + (CURFEW_START - self.local_tod(code, t)).rem_euclid(DAY) }
    }

    /// An airport's curfew window on the home base's clock ("12:00–04:00"), for messages.
    pub fn curfew_home(&self, code: &str) -> String {
        let a = self.ahead_of(code);
        format!("{}–{}", fmt_clock(CURFEW_START - a), fmt_clock(CURFEW_END - a))
    }

    pub fn new_game(opts: &NewGame) -> Self {
        let d = data();
        let home = if d.try_airport(&opts.airport).is_some() { opts.airport.clone() } else { START_AIRPORT.into() };
        let kind = if d.try_ac(&opts.aircraft).is_some() { opts.aircraft.clone() } else { START_AIRCRAFT.into() };
        let diff = difficulty(&opts.difficulty);
        let company = opts.company.trim().chars().take(40).collect::<String>();
        let mut slots = BTreeMap::new();
        let mut by_class = vec![0; 6];
        by_class[type_class(&kind)] = 1;
        slots.insert(home.clone(), SlotHolding { since: 0, count: 1, by_class });
        let state = State {
            version: 1,
            mode: mode(&opts.mode).id.into(),
            difficulty: diff.id.into(),
            home: home.clone(),
            company: if company.is_empty() { COMPANY_NAME.into() } else { company },
            time: CURFEW_START,
            money: diff.start_money,
            slots,
            planes: vec![new_plane(START_REGISTRATION, &kind, &home, Ownership::Leased, 0.0, 0)],
            fares: HashMap::new(),
            carried_today: HashMap::new(),
            today: Today::default(),
            history: Vec::new(),
            log: Vec::new(),
            market: Market { listings: Vec::new(), next_id: 1 },
            effects: Vec::new(),
            news: Vec::new(),
            rivals: Vec::new(),
            rep: Rep::default(),
            slot_buys: HashMap::new(),
            offers: HashMap::new(),
            game_over: false,
        };
        let mut g = Game::from_state(state);
        g.setup_rivals();
        g.refresh_market();
        let m = mode(&g.state.mode);
        g.log(
            format!(
                "Welcome to {}! You start with a slot at {}, the {} {START_REGISTRATION} and a base crew. Mode: {} – {} Difficulty: {}.",
                g.state.company,
                d.airport(&home).name,
                d.ac(&kind).name,
                m.name,
                m.desc,
                diff.name
            ),
            LogKind::Info,
        );
        g
    }

    pub fn home(&self) -> &str {
        &self.state.home
    }

    pub fn difficulty(&self) -> &'static Difficulty {
        difficulty(&self.state.difficulty)
    }

    pub fn bankruptcy_limit(&self) -> f64 {
        self.difficulty().bankruptcy_limit
    }

    pub fn log(&mut self, msg: impl Into<String>, kind: LogKind) {
        let t = self.state.time;
        self.state.log.insert(0, LogEntry { t, msg: msg.into(), kind });
        self.state.log.truncate(300);
    }

    pub fn plane_idx(&self, id: &str) -> Option<usize> {
        self.state.planes.iter().position(|p| p.id == id)
    }

    pub fn name_of(p: &Plane) -> String {
        match &p.name {
            Some(n) => format!("{n} ({})", p.id),
            None => p.id.clone(),
        }
    }

    pub fn rename_plane(&mut self, i: usize, name: &str) {
        let n: String = name.trim().chars().take(24).collect();
        self.state.planes[i].name = if n.is_empty() { None } else { Some(n) };
    }

    /// Quick start: a ready-made airline whose planes already fly daily timetables (js/data/presets.js). Slots are
    /// given free: one per plane at home and per plane that stops there elsewhere. Returns the game and any problems.
    pub fn from_preset(pr: &crate::data::Preset) -> (Game, Vec<String>) {
        let d = data();
        let home = if d.try_airport(&pr.home).is_some() { pr.home.clone() } else { START_AIRPORT.into() };
        let planes: Vec<&(String, Vec<String>)> = pr.planes.iter().filter(|(t, _)| d.try_ac(t).is_some()).collect();
        let mut g = Game::new_game(&NewGame {
            company: pr.company.clone(),
            mode: pr.mode.clone(),
            difficulty: pr.difficulty.clone(),
            airport: home.clone(),
            aircraft: planes.first().map(|p| p.0.clone()).unwrap_or_else(|| START_AIRCRAFT.into()),
        });
        let mut errors = Vec::new();
        let mut need: BTreeMap<String, [u32; 6]> = BTreeMap::new();
        for (kind, stops) in &planes {
            let c = type_class(kind);
            need.entry(home.clone()).or_insert([0; 6])[c] += 1;
            for s in stops {
                if d.try_airport(s).is_some() {
                    need.entry(s.clone()).or_insert([0; 6])[c] += 1;
                } else {
                    errors.push(format!("Unknown airport {s}."));
                }
            }
        }
        for (code, by) in need {
            g.set_slot_classes(&code, by);
        }
        let mut idx = vec![0];
        for (kind, _) in planes.iter().skip(1) {
            g.add_plane(kind, &home, Ownership::Leased, 0.0, None);
            idx.push(g.state.planes.len() - 1);
        }
        for (k, (kind, stops)) in planes.iter().enumerate() {
            if stops.is_empty() {
                continue;
            }
            let mut route = vec![home.clone()];
            route.extend(stops.iter().cloned());
            // departures 10 minutes apart, so a busy hub doesn't send everything off at once
            let legs = g.build_timetable(kind, &route, CURFEW_START + 60 + (k as i64 % 12) * 10, 0);
            let r = if legs.len() < 2 {
                Err(format!("{} does not fit into one day.", route.join("→")))
            } else {
                g.set_timetable(idx[k], legs).and_then(|_| g.set_schedule_active(idx[k], true))
            };
            if let Err(e) = r {
                errors.push(format!("{} ({}): {e}", g.state.planes[idx[k]].id, d.ac(kind).name));
            }
        }
        if let Some(m) = pr.money {
            g.state.money = m;
        }
        let msg = format!(
            "Quick start \"{}\": {} plane{} at {home}.{}",
            pr.name,
            planes.len(),
            if planes.len() == 1 { "" } else { "s" },
            if errors.is_empty() { String::new() } else { format!(" Problems: {}", errors.join(" ")) }
        );
        g.log(msg, LogKind::Info);
        (g, errors)
    }

    // ---------- slots ----------

    pub fn owns_slot(&self, code: &str) -> bool {
        self.state.slots.contains_key(code)
    }

    pub fn slot_count(&self, code: &str) -> u32 {
        self.state.slots.get(code).map(|s| s.count.max(1)).unwrap_or(0)
    }

    pub fn slot_fee(&self, _code: &str) -> f64 {
        slot_weekly(_code)
    }

    pub fn weekly_costs(&self) -> (f64, f64, f64, f64) {
        let d = data();
        let s = &self.state;
        let planes: f64 =
            s.planes.iter().map(|p| if p.ownership == Ownership::Owned { 0.0 } else { d.ac(&p.kind).lease_per_week }).sum();
        let crews: f64 = s.planes.iter().map(|p| crew_weekly(&p.crew)).sum();
        let slots: f64 = s.slots.keys().map(|c| self.slot_fee(c) * self.slot_count(c) as f64).sum();
        (planes, crews, slots, planes + crews + slots)
    }

    pub fn slot_capacity(&self, code: &str) -> u32 {
        let stands: u32 = data().airport(code).stands.iter().sum();
        self.slot_count(code).max(2).max(stands)
    }

    /// Your slots at an airport by class (A–F). Slots from before classes get those your planes there need, then
    /// the class most of the stands there have.
    pub fn my_slot_classes(&self, code: &str) -> [u32; 6] {
        let Some(sl) = self.state.slots.get(code) else { return [0; 6] };
        let n = self.slot_count(code);
        if sl.by_class.len() == 6 && sl.by_class.iter().sum::<u32>() == n {
            let mut out = [0; 6];
            out.copy_from_slice(&sl.by_class);
            return out;
        }
        let stands = data().airport(code).stands;
        let common = (0..6).max_by_key(|&c| (stands[c], c)).unwrap_or(2);
        let mut need: Vec<usize> = self
            .state
            .planes
            .iter()
            .filter(|p| {
                p.location == code || p.flight.as_ref().is_some_and(|f| f.to == code) || p.schedule.stops.iter().any(|s| s == code)
            })
            .map(|p| type_class(&p.kind))
            .collect();
        need.sort_by(|a, b| b.cmp(a));
        let mut out = [0; 6];
        for k in 0..n as usize {
            out[*need.get(k).unwrap_or(&common)] += 1;
        }
        out
    }

    fn set_slot_classes(&mut self, code: &str, by: [u32; 6]) {
        let t = self.state.time;
        let n: u32 = by.iter().sum();
        let sl = self.state.slots.entry(code.into()).or_insert(SlotHolding { since: t, count: 0, by_class: Vec::new() });
        sl.count = n;
        sl.by_class = by.to_vec();
    }

    /// The slots of an airport by class. The holders' slots are spread over the classes as the stands are (what
    /// is left of each after yours).
    pub fn slot_table(&self, code: &str) -> SlotTable {
        let mine = self.my_slot_classes(code);
        let stands = data().airport(code).stands;
        let mut cap = [0u32; 6];
        for c in 0..6 {
            cap[c] = stands[c].max(mine[c]);
        }
        let total: u32 = cap.iter().sum();
        let want = self.slot_capacity(code);
        if total < want {
            cap[2] += want - total;
        }
        let rest: Vec<u32> = (0..6).map(|c| cap[c] - mine[c]).collect();
        let rest_n: u32 = rest.iter().sum();
        let held_n = rest_n.min(self.slot_holders(code).iter().map(|h| h.n).sum());
        let share: Vec<f64> =
            rest.iter().map(|&r| if rest_n > 0 { held_n as f64 * r as f64 / rest_n as f64 } else { 0.0 }).collect();
        let mut held = [0u32; 6];
        for c in 0..6 {
            held[c] = share[c].floor() as u32;
        }
        let mut left = held_n - held.iter().sum::<u32>();
        let mut order: Vec<usize> = (0..6).collect();
        order.sort_by(|&x, &y| (share[y] - held[y] as f64).total_cmp(&(share[x] - held[x] as f64)));
        for c in order {
            if left == 0 {
                break;
            }
            if held[c] < rest[c] {
                held[c] += 1;
                left -= 1;
            }
        }
        let mut free = [0u32; 6];
        for c in 0..6 {
            free[c] = rest[c].saturating_sub(held[c]);
        }
        SlotTable { cap, mine, held, free }
    }

    /// The class a new slot should have: the smallest free one your biggest plane fits, else the biggest free one.
    pub fn lease_class_for(&self, code: &str) -> Option<usize> {
        let free = self.slot_table(code).free;
        let big = self.state.planes.iter().map(|p| type_class(&p.kind)).max().unwrap_or(0);
        (big..6).find(|&c| free[c] > 0).or_else(|| (0..big).rev().find(|&c| free[c] > 0))
    }

    /// Slots a rival's flights need at an airport: one per 4 daily flights on each route, 2 more at a hub.
    fn rival_slot_need(r: &Rival, code: &str) -> u32 {
        let mut n = if r.hubs.iter().any(|h| h == code) { 2 } else { 0 };
        for rt in &r.routes {
            if rt.a == code || rt.b == code {
                n += rt.per_day.div_ceil(4);
            }
        }
        n
    }

    pub fn slot_holders(&self, code: &str) -> Vec<SlotHolder> {
        let empty = HashMap::new();
        let bought = self.state.slot_buys.get(code).unwrap_or(&empty);
        let cap = self.slot_capacity(code);
        let mut left = cap.saturating_sub(self.slot_count(code));
        let mut out = Vec::new();
        for r in &self.state.rivals {
            let need = Self::rival_slot_need(r, code).saturating_sub(*bought.get(&r.id).unwrap_or(&0));
            let n = left.min(need);
            if n == 0 {
                continue;
            }
            left -= n;
            out.push(SlotHolder {
                id: r.id.clone(),
                name: r.name.clone(),
                color: r.color.clone(),
                n,
                hub: r.hubs.iter().any(|h| h == code),
            });
        }
        let others = ((cap as f64 * OTHER_AIRLINES[airport_size(code)]).round() as u32)
            .saturating_sub(*bought.get("others").unwrap_or(&0));
        let n = left.min(others);
        if n > 0 {
            out.push(SlotHolder { id: "others".into(), name: "Other airlines".into(), color: "#64748b".into(), n, hub: false });
        }
        out
    }

    /// Free slots at an airport (of class `cls`, or all).
    pub fn free_slots(&self, code: &str, cls: Option<usize>) -> u32 {
        if let Some(c) = cls {
            return self.slot_table(code).free[c];
        }
        let held: u32 = self.slot_holders(code).iter().map(|h| h.n).sum();
        self.slot_capacity(code).saturating_sub(self.slot_count(code) + held)
    }

    /// Leases a free slot of class `cls` (None: the one `lease_class_for` picks).
    pub fn lease_slot(&mut self, code: &str, cls: Option<usize>) -> Result<(), String> {
        let d = data();
        let a = d.airport(code);
        if a.factory {
            return Err(format!("{} is a factory, not an airport.", a.name));
        }
        if self.free_slots(code, None) == 0 {
            return Err(format!(
                "All {} slots at {code} are taken – make one of the holders an offer.",
                self.slot_capacity(code)
            ));
        }
        let Some(cls) = cls.or_else(|| self.lease_class_for(code)) else {
            return Err(format!("No slot is free at {code}."));
        };
        if self.free_slots(code, Some(cls)) == 0 {
            return Err(format!("No class {} slot is free at {code}.", CLASSES[cls]));
        }
        let cost = slot_upfront(code);
        if self.state.money < cost {
            return Err(format!("Not enough money ({} needed).", fmt_money(cost)));
        }
        self.state.money -= cost;
        let mut by = self.my_slot_classes(code);
        by[cls] += 1;
        self.set_slot_classes(code, by);
        let n = self.slot_count(code);
        self.log(
            format!(
                "Leased a class {} slot at {} ({n} there) for {} (+{}/week).",
                CLASSES[cls],
                a.name,
                fmt_money(cost),
                fmt_money(self.slot_fee(code))
            ),
            LogKind::Cost,
        );
        self.seat_cache.replace(None);
        Ok(())
    }

    /// Gives one slot back, of class `cls` (None: the smallest you hold); the last one drops the airport.
    pub fn drop_slot(&mut self, code: &str, cls: Option<usize>) -> Result<(), String> {
        if !self.owns_slot(code) {
            return Err("You have no slot there.".into());
        }
        let n = self.slot_count(code);
        if n <= 1 {
            if code == self.home() {
                return Err("You cannot give up your home base.".into());
            }
            let used = self.state.planes.iter().any(|p| {
                p.location == code
                    || p.pending_ferry.as_deref() == Some(code)
                    || p.flight.as_ref().is_some_and(|f| f.to == code)
                    || p.schedule.stops.iter().any(|s| s == code)
            });
            if used {
                return Err("A plane is there, heading there or scheduled there.".into());
            }
            self.state.slots.remove(code);
            self.state.fares.retain(|k, _| !k.split('-').any(|c| c == code));
            self.log(format!("Released the slot at {}.", data().airport(code).name), LogKind::Info);
            return Ok(());
        }
        let mut by = self.my_slot_classes(code);
        let Some(cls) = cls.or_else(|| (0..6).find(|&c| by[c] > 0)) else {
            return Err("No slot to give back.".into());
        };
        if by[cls] == 0 {
            return Err(format!("You hold no class {} slot at {code}.", CLASSES[cls]));
        }
        by[cls] -= 1;
        let busy: Vec<usize> = self
            .slot_occupants(code)
            .into_iter()
            .filter(|o| o.1 != "leaving" && o.1 != "parked at base")
            .map(|o| type_class(&self.state.planes[o.0].kind))
            .collect();
        if !slots_fit(&by, &busy) {
            return Err(format!("Your planes at {code} need that slot right now."));
        }
        self.set_slot_classes(code, by);
        self.log(format!("Gave back a class {} slot at {code} ({} left).", CLASSES[cls], n - 1), LogKind::Info);
        Ok(())
    }

    /// A plane at the home base without a running timetable parks off the stands, without a slot.
    pub fn parks_at_base(&self, q: &Plane, code: &str) -> bool {
        code == self.home() && !(q.schedule.active && q.schedule.stops.len() >= 2)
    }

    /// Will plane q still stand at `code` at time t?
    fn stays_until(&self, q: &Plane, code: &str, t: i64) -> bool {
        if q.status == Status::Flying || q.location != code || self.parks_at_base(q, code) {
            return false;
        }
        if let Some(f) = &q.pending_ferry {
            if f != code {
                return q.status == Status::Turnaround && q.ready_at > t;
            }
        }
        let sch = &q.schedule;
        if !sch.active || sch.stops.len() < 2 || sch.legs.is_empty() {
            return true;
        }
        let leg = &sch.legs[sch.index % sch.legs.len()];
        if leg.from != code {
            return q.ready_at > t;
        }
        sch.due.max(q.ready_at) > t
    }

    /// Is one of your slots at `code` (of its class or bigger) free for plane `me` landing at time t?
    pub fn slot_free_at(&self, code: &str, t: i64, me: usize) -> bool {
        let p = &self.state.planes[me];
        if self.parks_at_base(p, code) {
            return true;
        }
        let mut used = Vec::new();
        for (i, q) in self.state.planes.iter().enumerate() {
            if i == me || self.parks_at_base(q, code) {
                continue;
            }
            if q.status == Status::Flying && q.flight.as_ref().is_some_and(|f| f.to == code) {
                let f = q.flight.as_ref().unwrap();
                let sch = &q.schedule;
                let gone = sch.active
                    && !sch.legs.is_empty()
                    && sch.legs[sch.index % sch.legs.len()].from == code
                    && sch.due.max(f.arr + turnaround_min(&q.kind)) < t;
                if !gone {
                    used.push(type_class(&q.kind));
                }
            } else if self.stays_until(q, code, t) {
                used.push(type_class(&q.kind));
            }
        }
        used.push(type_class(&p.kind));
        slots_fit(&self.my_slot_classes(code), &used)
    }

    /// Your planes in or heading for a slot at an airport, with what they do there.
    pub fn slot_occupants(&self, code: &str) -> Vec<(usize, &'static str)> {
        let t = self.state.time;
        let mut out = Vec::new();
        for (i, q) in self.state.planes.iter().enumerate() {
            if self.parks_at_base(q, code) {
                if q.location == code && q.status != Status::Flying {
                    out.push((i, "parked at base"));
                }
                continue;
            }
            if q.status == Status::Flying && q.flight.as_ref().is_some_and(|f| f.to == code) {
                out.push((i, "inbound"));
            } else if q.status != Status::Flying && q.location == code {
                out.push((
                    i,
                    if !self.stays_until(q, code, t + 30) {
                        "leaving"
                    } else if q.status == Status::Turnaround {
                        "turnaround"
                    } else {
                        "parked"
                    },
                ));
            }
        }
        out
    }

    /// Why a plane of this type couldn't stand at `code`, else None.
    pub fn room_reason(&self, kind: &str, code: &str, me: Option<usize>) -> Option<String> {
        if code == self.home() {
            return None;
        }
        if self.slot_count(code) == 0 {
            return Some(format!("You need a slot at {code} first."));
        }
        let need = type_class(kind);
        let mine = self.my_slot_classes(code);
        if !slots_fit(&mine, &[need]) {
            return Some(format!(
                "Your slot at {code} is too small ({}): the {} needs a class {} stand or bigger. Lease one there first.",
                class_list(&mine),
                data().ac(kind).name,
                CLASSES[need]
            ));
        }
        let stay: Vec<&Plane> = self
            .state
            .planes
            .iter()
            .enumerate()
            .filter(|&(i, q)| {
                Some(i) != me
                    && if q.status == Status::Flying && q.flight.as_ref().is_some_and(|f| f.to == code) {
                        !(q.schedule.active && !q.schedule.legs.is_empty())
                            && q.pending_ferry.as_ref().is_none_or(|f| f == code)
                    } else {
                        self.stays_until(q, code, i64::MAX)
                    }
            })
            .map(|(_, q)| q)
            .collect();
        let mut classes: Vec<usize> = stay.iter().map(|q| type_class(&q.kind)).collect();
        classes.push(need);
        if !slots_fit(&mine, &classes) {
            let names: Vec<String> = stay.iter().map(|q| Self::name_of(q)).collect();
            return Some(format!(
                "Every slot at {code} it fits in is taken by {}, parked there with no running timetable. Move one away or lease another slot first.",
                names.join(", ")
            ));
        }
        None
    }

    // ---------- reputation and slot offers ----------

    pub fn reputation(&self, code: Option<&str>) -> (f64, Vec<(String, f64)>) {
        let s = &self.state;
        let mut parts = vec![("Base".to_string(), REP_BASE)];
        parts.push(("Flights flown".into(), (s.rep.flown as f64 / REP_FLIGHTS_PER_POINT).min(REP_EXPERIENCE_MAX)));
        let n = s.rep.on_time + s.rep.late;
        if n >= 5.0 {
            let v = ((s.rep.on_time / n - 0.85) * REP_PUNCTUALITY * 6.0).clamp(-REP_PUNCTUALITY, REP_PUNCTUALITY * 0.6);
            parts.push(("Punctuality".into(), v));
        }
        let fade = |list: &[i64], pts: f64, days: f64| -> f64 {
            list.iter().map(|&t| pts * (1.0 - (s.time - t) as f64 / (days * DAY as f64)).max(0.0)).sum()
        };
        let crash = fade(&s.rep.crashes, REP_CRASH, REP_CRASH_DAYS);
        if crash > 0.0 {
            parts.push(("Crashes".into(), -crash));
        }
        let inc = fade(&s.rep.incidents, REP_INCIDENT, REP_INCIDENT_DAYS);
        if inc > 0.0 {
            parts.push(("Incidents".into(), -inc));
        }
        if code == Some(self.home()) {
            parts.push(("Home base".into(), REP_HOME));
        }
        let value = parts.iter().map(|p| p.1).sum::<f64>().clamp(0.0, 100.0).round();
        (value, parts.into_iter().map(|(l, v)| (l, v.round())).collect())
    }

    pub fn slot_offer_price(&self, code: &str, holder: &str) -> f64 {
        let hub = self.state.rivals.iter().any(|r| r.id == holder && r.hubs.iter().any(|h| h == code));
        slot_upfront(code) * OFFER_FAIR_UPFRONTS * if hub { OFFER_HUB_FACTOR } else { 1.0 }
    }

    pub fn slot_offer_chance(&self, code: &str, holder: &str, amount: f64) -> f64 {
        let rep = self.reputation(Some(code)).0;
        let v = amount / self.slot_offer_price(code, holder).max(1.0) * (OFFER_REP_LOW + rep / 100.0 * (OFFER_REP_HIGH - OFFER_REP_LOW));
        ((v - OFFER_FROM) / OFFER_SPAN).clamp(0.0, OFFER_MAX_CHANCE)
    }

    /// Makes an offer for one of `holder`'s slots; the airport decides at once. Ok(true) = accepted.
    pub fn make_slot_offer(&mut self, code: &str, holder: &str, amount: f64) -> Result<bool, String> {
        let name = data().airport(code).name.clone();
        let Some(h) = self.slot_holders(code).into_iter().find(|h| h.id == holder) else {
            return Err("They hold no slot there any more.".into());
        };
        if self.free_slots(code, None) > 0 {
            return Err("A slot is free there: lease that one.".into());
        }
        let amount = amount.round();
        if amount <= 0.0 {
            return Err("Offer something.".into());
        }
        if self.state.money < amount {
            return Err(format!("Not enough money ({}).", fmt_money(amount)));
        }
        let key = format!("{code}|{holder}");
        if self.state.offers.get(&key).is_some_and(|&t| self.state.time - t < DAY) {
            return Err(format!("{name} won't look at another offer for {}'s slots before tomorrow.", h.name));
        }
        if rand::random::<f64>() >= self.slot_offer_chance(code, holder, amount) {
            self.state.offers.insert(key, self.state.time);
            self.log(format!("{name} turned down your offer of {} for one of {}'s slots.", fmt_money(amount), h.name), LogKind::Bad);
            return Ok(false);
        }
        self.state.money -= amount;
        self.state.today.cost += amount;
        self.state.offers.remove(&key);
        // the slot comes in the class of theirs your biggest plane fits best
        let held = self.slot_table(code).held;
        let big = self.state.planes.iter().map(|p| type_class(&p.kind)).max().unwrap_or(2);
        let cls = (big..6).find(|&c| held[c] > 0).or_else(|| (0..big).rev().find(|&c| held[c] > 0)).unwrap_or(2);
        let mut by = self.my_slot_classes(code);
        by[cls] += 1;
        self.set_slot_classes(code, by);
        let mut dropped = String::new();
        let mut freed = 0;
        if let Some(ri) = self.state.rivals.iter().position(|r| r.id == holder) {
            let before = Self::rival_slot_need(&self.state.rivals[ri], code);
            let r = &mut self.state.rivals[ri];
            if let Some(k) = (0..r.routes.len())
                .filter(|&k| r.routes[k].a == code || r.routes[k].b == code)
                .max_by_key(|&k| r.routes[k].per_day)
            {
                let rt = &mut r.routes[k];
                rt.per_day -= 1;
                dropped = if rt.per_day > 0 {
                    format!(" and flies {}–{} once a day less", rt.a, rt.b)
                } else {
                    format!(" and stops flying {}–{}", rt.a, rt.b)
                };
                if rt.per_day == 0 {
                    r.routes.remove(k);
                }
            }
            freed = before - Self::rival_slot_need(&self.state.rivals[ri], code);
            self.index_rivals();
        }
        let e = self.state.slot_buys.entry(code.into()).or_default().entry(holder.into()).or_insert(0);
        *e = (*e + 1).saturating_sub(freed);
        self.log(format!("{name} moved one of {}'s slots to you for {}{dropped}.", h.name, fmt_money(amount)), LogKind::Good);
        Ok(true)
    }

    // ---------- fares and demand ----------

    pub fn fare_factor(&self, a: &str, b: &str) -> f64 {
        *self.state.fares.get(&route_key(a, b)).unwrap_or(&1.0)
    }

    pub fn fare(&self, a: &str, b: &str) -> f64 {
        (ticket_price(data().dist(a, b)) * self.fare_factor(a, b)).round()
    }

    pub fn change_fare(&mut self, a: &str, b: &str, steps: i32) {
        let f = ((self.fare_factor(a, b) + steps as f64 * FARE_STEP) * 100.0).round() / 100.0;
        self.state.fares.insert(route_key(a, b), f.clamp(FARE_MIN, FARE_MAX));
    }

    pub fn demand(&self, a: &str, b: &str) -> f64 {
        (daily_demand(a, b) * self.fare_factor(a, b).powf(-ELASTICITY) * self.event_demand_mult(a, b) * self.difficulty().demand_mult)
            .round()
    }

    /// Seats per day the player's running timetables offer from a to b.
    pub fn player_seats(&self, a: &str, b: &str) -> f64 {
        let s = &self.state;
        let sig: String = s
            .planes
            .iter()
            .map(|p| format!("{}{}{}{}|", p.id, p.kind, p.schedule.active as u8, p.schedule.legs.len()))
            .collect();
        let fresh = !matches!(&*self.seat_cache.borrow(), Some((k, _)) if *k == sig);
        if fresh {
            let mut m: HashMap<String, f64> = HashMap::new();
            for p in &s.planes {
                if !p.schedule.active {
                    continue;
                }
                let seats = data().ac(&p.kind).seats as f64;
                for l in &p.schedule.legs {
                    *m.entry(format!("{}>{}", l.from, l.to)).or_default() += seats;
                }
            }
            self.seat_cache.replace(Some((sig, m)));
        }
        let c = self.seat_cache.borrow();
        *c.as_ref().unwrap().1.get(&format!("{a}>{b}")).unwrap_or(&0.0)
    }

    /// Routes the player's timetables fly (both directions together), busiest first: (a, b, seats, pax).
    pub fn player_routes(&self) -> Vec<(String, String, f64, f64)> {
        self.player_seats("", "");
        let c = self.seat_cache.borrow();
        let mut seen: BTreeMap<String, (String, String, f64)> = BTreeMap::new();
        for (k, seats) in &c.as_ref().unwrap().1 {
            let (a, b) = k.split_once('>').unwrap();
            seen.entry(route_key(a, b)).or_insert((a.into(), b.into(), 0.0)).2 += seats;
        }
        drop(c);
        let mut out: Vec<_> = seen.into_values().map(|(a, b, s)| {
            let pax = self.pax_demand(&a, &b, 0.0);
            (a, b, s, pax)
        }).collect();
        out.sort_by(|x, y| y.3.total_cmp(&x.3));
        out
    }

    fn pull(seats: f64, fare: f64) -> f64 {
        seats.max(1.0).powf(CAPACITY_EXP) * fare.powf(-ELASTICITY)
    }

    pub fn rivals_on(&self, a: &str, b: &str) -> Vec<(usize, usize)> {
        self.rival_idx.get(&route_key(a, b)).cloned().unwrap_or_default()
    }

    fn rival_route(&self, (r, k): (usize, usize)) -> &RivalRoute {
        &self.state.rivals[r].routes[k]
    }

    /// The player's share of the passengers on a–b against the rivals flying it.
    pub fn market_share(&self, a: &str, b: &str, min_seats: f64) -> f64 {
        let comp = self.rivals_on(a, b);
        if comp.is_empty() {
            return 1.0;
        }
        let mine = Self::pull(min_seats.max(self.player_seats(a, b)), self.fare_factor(a, b));
        let theirs: f64 = comp.iter().map(|&c| {
            let rt = self.rival_route(c);
            Self::pull(rt.per_day as f64 * rt.seats as f64, rt.fare)
        }).sum();
        mine / (mine + theirs)
    }

    /// Passengers a day the player can expect from a to b.
    pub fn pax_demand(&self, a: &str, b: &str, min_seats: f64) -> f64 {
        (self.demand(a, b) * self.market_share(a, b, min_seats)).round()
    }

    // ---------- rivals ----------

    fn index_rivals(&mut self) {
        let mut idx: HashMap<String, Vec<(usize, usize)>> = HashMap::new();
        for (ri, r) in self.state.rivals.iter().enumerate() {
            for (k, rt) in r.routes.iter().enumerate() {
                idx.entry(route_key(&rt.a, &rt.b)).or_default().push((ri, k));
            }
        }
        self.rival_idx = idx;
    }

    fn setup_rivals(&mut self) {
        let d = data();
        let home = d.airport(&self.state.home);
        let mut by_dist: Vec<(&crate::data::RivalTemplate, f64)> = d
            .rival_templates
            .iter()
            .filter(|t| t.hubs.iter().all(|h| d.try_airport(h).is_some()))
            .map(|t| {
                let dd = t.hubs.iter().map(|h| {
                    let a = d.airport(h);
                    distance_km(home.lat, home.lon, a.lat, a.lon)
                }).fold(f64::INFINITY, f64::min);
                (t, dd)
            })
            .collect();
        by_dist.sort_by(|x, y| x.1.total_cmp(&y.1));
        let mut chosen: Vec<_> = by_dist.iter().take(RIVALS_NEAR).map(|x| x.0).collect();
        let mut rest: Vec<_> = by_dist.iter().skip(RIVALS_NEAR).map(|x| x.0).collect();
        for _ in 0..RIVALS_FAR {
            if rest.is_empty() {
                break;
            }
            let flags: Vec<usize> = (0..rest.len()).filter(|&i| rest[i].kind == "flag").collect();
            let i = if !flags.is_empty() && rand::random::<f64>() < 0.8 {
                flags[rand::random_range(0..flags.len())]
            } else {
                rand::random_range(0..rest.len())
            };
            chosen.push(rest.remove(i));
        }
        let t = self.state.time;
        self.state.rivals = chosen
            .iter()
            .enumerate()
            .map(|(i, tp)| Rival {
                id: format!("r{}", i + 1),
                name: tp.name.clone(),
                kind: tp.kind.clone(),
                hubs: tp.hubs.clone(),
                color: d.rival_colors.get(i % d.rival_colors.len().max(1)).cloned().unwrap_or_else(|| "#f97316".into()),
                routes: Vec::new(),
                since: t,
            })
            .collect();
        for ri in 0..self.state.rivals.len() {
            let max = rival_routes(&self.state.rivals[ri].kind);
            let plans = self.rival_candidates(ri, 40);
            let r = &mut self.state.rivals[ri];
            for p in plans {
                if r.routes.len() >= max {
                    break;
                }
                r.routes.push(p);
            }
        }
        self.index_rivals();
    }

    /// How a rival would fly a–b; None if not worth it.
    fn rival_plan(&self, ri: usize, a: &str, b: &str) -> Option<RivalRoute> {
        let d = data();
        let r = &self.state.rivals[ri];
        let dd = d.dist(a, b);
        let mut kind = rival_fleet(&r.kind);
        if r.kind == "flag" && dd > LONG_HAUL_KM {
            kind = LONG_HAUL_TYPE;
        }
        if r.kind == "regional" && dd < SHORT_PROP_KM {
            kind = SHORT_PROP_TYPE;
        }
        let ac = d.try_ac(kind)?;
        if dd > ac.range_km || !fits_airport(kind, a) || !fits_airport(kind, b) {
            return None;
        }
        let fare = rival_fare(&r.kind);
        let pax = daily_demand(a, b) * fare.powf(-ELASTICITY);
        let my_seats = (self.player_seats(a, b) + self.player_seats(b, a)) / 2.0;
        let mut others = if my_seats > 0.0 { Self::pull(my_seats, self.fare_factor(a, b)) } else { 0.0 };
        for c in self.rivals_on(a, b) {
            if c.0 != ri {
                let rt = self.rival_route(c);
                others += Self::pull(rt.per_day as f64 * rt.seats as f64, rt.fare);
            }
        }
        let mut per_day = 0;
        for n in 1..=RIVAL_MAX_PER_DAY {
            let own = Self::pull(n as f64 * ac.seats as f64, fare);
            if pax * own / (own + others) < n as f64 * ac.seats as f64 * RIVAL_TARGET_LOAD {
                break;
            }
            per_day = n;
        }
        if per_day < 1 {
            return None;
        }
        Some(RivalRoute {
            a: a.into(),
            b: b.into(),
            kind: kind.into(),
            seats: ac.seats,
            per_day,
            fare,
            since: self.state.time,
            weak: 0,
            value: (per_day as f64 * ac.seats as f64 * ticket_price(dd) * fare).round(),
        })
    }

    /// A rival's best routes from its hubs that it doesn't fly yet, best first.
    fn rival_candidates(&self, ri: usize, per_hub: usize) -> Vec<RivalRoute> {
        let d = data();
        let r = &self.state.rivals[ri];
        let range = rival_range(&r.kind);
        let min_size = if r.kind == "regional" { 1 } else { 2 };
        let have: std::collections::HashSet<String> = r.routes.iter().map(|x| route_key(&x.a, &x.b)).collect();
        let mut out: Vec<RivalRoute> = Vec::new();
        for h in &r.hubs {
            let hub = d.airport(h);
            let mut pre: Vec<(&str, f64)> = Vec::new();
            for a in &d.airports {
                if a.code == *h || a.minor || a.factory || a.size < min_size || have.contains(&route_key(h, &a.code)) {
                    continue;
                }
                let dd = distance_km(hub.lat, hub.lon, a.lat, a.lon);
                if !(200.0..=range).contains(&dd) {
                    continue;
                }
                pre.push((&a.code, (a.size * a.size) as f64 * distance_factor(dd)));
            }
            pre.sort_by(|x, y| y.1.total_cmp(&x.1));
            for (code, _) in pre.into_iter().take(per_hub) {
                let key = route_key(h, code);
                if out.iter().any(|o| route_key(&o.a, &o.b) == key) {
                    continue;
                }
                if let Some(p) = self.rival_plan(ri, h, code) {
                    out.push(p);
                }
            }
        }
        out.sort_by(|x, y| y.value.total_cmp(&x.value));
        out
    }

    /// How a rival route is doing: (load factor, the player's share there).
    fn rival_load(&self, c: (usize, usize)) -> (f64, f64) {
        let rt = self.rival_route(c);
        let comp = self.rivals_on(&rt.a, &rt.b);
        let mut total: f64 = comp.iter().map(|&x| {
            let o = self.rival_route(x);
            Self::pull(o.per_day as f64 * o.seats as f64, o.fare)
        }).sum();
        let my_seats = (self.player_seats(&rt.a, &rt.b) + self.player_seats(&rt.b, &rt.a)) / 2.0;
        let mine = if my_seats > 0.0 { Self::pull(my_seats, self.fare_factor(&rt.a, &rt.b)) } else { 0.0 };
        total += mine;
        let share = Self::pull(rt.per_day as f64 * rt.seats as f64, rt.fare) / total;
        let pax = daily_demand(&rt.a, &rt.b) * rt.fare.powf(-ELASTICITY) * share * self.event_demand_mult(&rt.a, &rt.b);
        (pax / (rt.per_day as f64 * rt.seats as f64), mine / total)
    }

    /// Every Monday: rivals add flights on full routes, cut them on empty ones, fight the player with lower fares,
    /// and sometimes open a new route (now and then one of the player's).
    fn rivals_week(&mut self) {
        let mut story: Option<Story> = None;
        for ri in 0..self.state.rivals.len() {
            let mut k = 0;
            while k < self.state.rivals[ri].routes.len() {
                let (load, player_share) = self.rival_load((ri, k));
                let name = self.state.rivals[ri].name.clone();
                let kind = self.state.rivals[ri].kind.clone();
                let mut msgs: Vec<(String, LogKind)> = Vec::new();
                let mut removed = false;
                {
                    let rt = &mut self.state.rivals[ri].routes[k];
                    let route = format!("{}–{}", rt.a, rt.b);
                    let you = player_share > 0.0;
                    if you && player_share >= FARE_WAR_SHARE && rt.fare > FARE_WAR_MIN {
                        rt.fare = (((rt.fare - FARE_WAR_CUT) * 100.0).round() / 100.0).max(FARE_WAR_MIN);
                        msgs.push((
                            format!("⚔ {name} cuts its fares on {route} to {:.0}% to win passengers back from you.", rt.fare * 100.0),
                            LogKind::Bad,
                        ));
                        if story.is_none() {
                            story = Some(fare_war_story(&name, &self.state.company, &rt.a, &rt.b, rt.fare));
                        }
                    } else if !you && rt.fare < rival_fare(&kind) {
                        rt.fare = (((rt.fare + FARE_WAR_CUT) * 100.0).round() / 100.0).min(rival_fare(&kind));
                    }
                    if load > 0.95 && rt.per_day < RIVAL_MAX_PER_DAY {
                        rt.per_day += 1;
                        rt.weak = 0;
                        if you {
                            msgs.push((format!("{name} adds a flight on {route} (now {}× a day).", rt.per_day), LogKind::Bad));
                        }
                    } else if load < 0.45 {
                        rt.weak += 1;
                        if rt.weak >= 2 {
                            rt.weak = 0;
                            rt.per_day = rt.per_day.saturating_sub(1);
                            if rt.per_day == 0 {
                                removed = true;
                                if you {
                                    msgs.push((format!("🏳 {name} gives up {route} – the route is yours."), LogKind::Good));
                                }
                            } else if you {
                                msgs.push((format!("{name} drops a flight on {route} (now {}× a day).", rt.per_day), LogKind::Good));
                            }
                        }
                    } else {
                        rt.weak = 0;
                    }
                }
                for (m, kd) in msgs {
                    self.log(m, kd);
                }
                if removed {
                    self.state.rivals[ri].routes.remove(k);
                    self.index_rivals();
                } else {
                    k += 1;
                }
            }
            self.index_rivals();
            if rand::random::<f64>() < RIVAL_GROWTH {
                if let Some((rt, attack)) = self.rival_expand(ri) {
                    if attack && story.is_none() {
                        story = Some(enter_story(&self.state.rivals[ri].name, &self.state.company, &rt));
                    }
                }
                self.index_rivals();
            }
        }
        if let Some(s) = story {
            self.news(s);
        }
    }

    fn rival_expand(&mut self, ri: usize) -> Option<(RivalRoute, bool)> {
        if rand::random::<f64>() < RIVAL_ATTACK {
            let d = data();
            for (a, b, _, _) in self.player_routes() {
                if self.rivals_on(&a, &b).iter().any(|c| c.0 == ri) {
                    continue;
                }
                let r = &self.state.rivals[ri];
                let mut base = if r.hubs.contains(&a) {
                    Some(a.clone())
                } else if r.hubs.contains(&b) {
                    Some(b.clone())
                } else {
                    None
                };
                if base.is_none() && r.kind == "low" {
                    let big = if airport_size(&a) >= airport_size(&b) { a.clone() } else { b.clone() };
                    let near = d.dist(&r.hubs[0], &big) < 3000.0;
                    if airport_size(&big) >= 3 && near {
                        base = Some(big);
                    }
                }
                let Some(base) = base else { continue };
                let other = if base == a { b.clone() } else { a.clone() };
                let Some(plan) = self.rival_plan(ri, &base, &other) else { continue };
                let r = &mut self.state.rivals[ri];
                if !r.hubs.contains(&base) {
                    r.hubs.push(base.clone());
                }
                r.routes.push(plan.clone());
                let name = r.name.clone();
                self.log(
                    format!(
                        "⚔ {name} starts flying {}–{} ({}× a day, fares {:.0}%) – one of your routes.",
                        plan.a,
                        plan.b,
                        plan.per_day,
                        plan.fare * 100.0
                    ),
                    LogKind::Bad,
                );
                return Some((plan, true));
            }
        }
        let best = self.rival_candidates(ri, 15).into_iter().next()?;
        self.state.rivals[ri].routes.push(best.clone());
        Some((best, false))
    }

    /// A rival goes out of business; returns it.
    pub fn bust_rival(&mut self) -> Option<Rival> {
        if self.state.rivals.is_empty() {
            return None;
        }
        let small: Vec<usize> = (0..self.state.rivals.len()).filter(|&i| self.state.rivals[i].kind != "flag").collect();
        let i = if small.is_empty() {
            rand::random_range(0..self.state.rivals.len())
        } else {
            small[rand::random_range(0..small.len())]
        };
        let r = self.state.rivals.remove(i);
        self.index_rivals();
        Some(r)
    }

    /// Rival planes in the air at time t (fractional minutes): departures spread over the day on every route.
    pub fn rival_flights(&self, t: f64) -> Vec<MapPlane> {
        let d = data();
        let mut out = Vec::new();
        let day = (t / DAY as f64).floor();
        let tod = t - day * DAY as f64;
        let span = (CURFEW_END - CURFEW_START) as f64;
        for r in &self.state.rivals {
            for rt in &r.routes {
                let (Some(a), Some(b)) = (d.try_airport(&rt.a), d.try_airport(&rt.b)) else { continue };
                let block = block_minutes(&rt.kind, distance_km(a.lat, a.lon, b.lat, b.lon)) as f64;
                for dir in 0..2 {
                    let (f, g) = if dir == 1 { (b, a) } else { (a, b) };
                    let ahead = self.ahead_of(&f.code);
                    let phase = hash01(r.id.len() as f64 + r.since as f64, (rt.a.as_bytes()[0] as f64) * 131.0 + rt.b.as_bytes()[2 % rt.b.len()] as f64, dir as f64);
                    for i in 0..rt.per_day {
                        let dep = ((CURFEW_START - ahead) as f64 + (i as f64 + phase) * span / rt.per_day as f64).rem_euclid(DAY as f64); // (local time there)
                        for back in [0.0, DAY as f64] {
                            let x = (tod + back - dep) / block;
                            if !(0.0..1.0).contains(&x) {
                                continue;
                            }
                            let (lat, lon) = interpolate(f.lat, f.lon, g.lat, g.lon, x);
                            let ahead = interpolate(f.lat, f.lon, g.lat, g.lon, (x + 0.01).min(1.0));
                            out.push(MapPlane {
                                lat,
                                lon,
                                heading: bearing(lat, lon, ahead.0, ahead.1),
                                color: r.color.clone(),
                                plane: None,
                                label: format!("{} {}→{}", r.name, f.code, g.code),
                            });
                        }
                    }
                }
            }
        }
        out
    }

    // ---------- effects (events) ----------

    pub fn active_effects(&self) -> impl Iterator<Item = &Effect> {
        let t = self.state.time;
        self.state.effects.iter().filter(move |e| e.until > t)
    }

    pub fn effect_hits(e: &Effect, code: &str) -> bool {
        let w = &e.at;
        let ap = data().airport(code);
        w.all
            || w.airport.as_deref() == Some(code)
            || w.country.as_deref() == Some(ap.country.as_str())
            || w.near.is_some_and(|(lat, lon)| distance_km(ap.lat, ap.lon, lat, lon) <= w.radius_km)
    }

    pub fn event_demand_mult(&self, a: &str, b: &str) -> f64 {
        let mut m = 1.0;
        for e in self.active_effects() {
            if let Some(dm) = e.demand_mult {
                if Self::effect_hits(e, a) || Self::effect_hits(e, b) {
                    m *= dm;
                }
            }
        }
        m
    }

    pub fn fuel_mult(&self) -> f64 {
        self.active_effects().map(|e| e.cost_mult.unwrap_or(1.0)).product()
    }

    /// Why a plane can't leave for `to` right now (strike, weather), or None.
    pub fn hold_reason(&self, from: &str, to: &str) -> Option<String> {
        self.active_effects()
            .find(|e| e.no_flights && (Self::effect_hits(e, from) || Self::effect_hits(e, to)))
            .map(|e| e.label.clone())
    }

    pub fn news(&mut self, mut story: Story) {
        const PAPERS: [&str; 5] =
            ["The Daily Contrail", "Tarmac Tribune", "The Holding Pattern Herald", "Alpine Evening Post", "The Jetstream Journal"];
        story.paper = PAPERS[rand::random_range(0..PAPERS.len())].into();
        story.t = self.state.time;
        let h = &story.headline;
        let mut head = h.chars().take(1).collect::<String>();
        head.push_str(&h.chars().skip(1).collect::<String>().to_lowercase());
        let msg = format!("📰 {head} – {}", story.sub);
        let kind = if story.good { LogKind::Good } else { LogKind::Bad };
        self.state.news.push(story);
        self.log(msg, kind);
    }

    // ---------- simulation ----------

    pub fn advance(&mut self, minutes: i64) {
        for _ in 0..minutes {
            if self.state.game_over {
                return;
            }
            self.state.time += 1;
            if self.state.time % DAY == 0 {
                self.new_day();
            }
            for i in (0..self.state.planes.len()).rev() {
                if i < self.state.planes.len() {
                    self.update_plane(i);
                }
            }
        }
    }

    fn new_day(&mut self) {
        let day = self.state.time / DAY;
        let t = std::mem::take(&mut self.state.today);
        let cash = self.state.money;
        self.state.history.insert(
            0,
            DayRecord { day: day - 1, revenue: t.revenue, cost: t.cost, fixed: t.fixed, flights: t.flights, pax: t.pax, cash },
        );
        self.state.history.truncate(60);
        self.log(
            format!("Day {day} closed: {} flights, {} pax, operating result {}.", t.flights, t.pax, fmt_money(t.revenue - t.cost)),
            LogKind::Summary,
        );
        self.state.carried_today.clear();
        for p in &mut self.state.planes {
            p.crew.duty_today = 0;
        }
        self.state.rep.on_time *= 0.93;
        self.state.rep.late *= 0.93;

        if day % 7 == 0 {
            let (planes, crews, slots, total) = self.weekly_costs();
            self.state.money -= total;
            self.state.today.fixed += total;
            self.log(
                format!(
                    "Weekly costs paid: {} (aircraft {}, crew {}, slots {}).",
                    fmt_money(total),
                    fmt_money(planes),
                    fmt_money(crews),
                    fmt_money(slots)
                ),
                LogKind::Cost,
            );
            let time = self.state.time - 1;
            for p in &mut self.state.planes {
                let fixed = if p.ownership == Ownership::Owned { 0.0 } else { data().ac(&p.kind).lease_per_week } + crew_weekly(&p.crew);
                record(p, time, |w| w.fixed += fixed);
                p.stats.fixed += fixed;
            }
            self.refresh_market();
            self.rivals_week();
        }
        self.roll_world_event();
        if self.state.money < self.bankruptcy_limit() {
            self.state.game_over = true;
            self.log("Bankrupt! Your airline has run out of money. Start a new game.", LogKind::Bad);
        }
    }

    fn update_plane(&mut self, i: usize) {
        let t = self.state.time;
        let p = &self.state.planes[i];
        if p.status == Status::Flying {
            let f = p.flight.as_ref().unwrap();
            if f.emergency.is_none() && f.emergency_at.is_some_and(|e| t >= e) {
                self.emergency(i);
            }
            let f = self.state.planes[i].flight.as_ref().unwrap();
            if f.crash_at.is_some_and(|c| t >= c) {
                self.crash(i);
                return;
            }
            if t >= f.arr {
                self.land(i);
            }
        }
        let p = &mut self.state.planes[i];
        if p.status == Status::Turnaround && t >= p.ready_at {
            p.status = Status::Idle;
            p.repair = false;
        }
        if self.state.planes[i].status == Status::Idle {
            self.try_depart(i);
        }
    }

    fn land(&mut self, i: usize) {
        let t = self.state.time;
        let p = &mut self.state.planes[i];
        let f = p.flight.take().unwrap();
        let result = f.revenue - f.cost;
        p.location = f.to.clone();
        p.status = Status::Turnaround;
        p.ready_at = t + turnaround_min(&p.kind);
        let seats = data().ac(&p.kind).seats;
        p.stats.rev += f.revenue;
        p.stats.cost += f.cost;
        p.stats.km += f.distance;
        p.stats.mins += f.arr - f.dep;
        let (rev, cost, pax) = (f.revenue, f.cost, f.pax);
        record(p, t, |w| {
            w.rev += rev;
            w.cost += cost;
            if f.kind == FlightKind::Scheduled {
                w.flights += 1;
                w.pax += pax;
            }
        });
        match f.kind {
            FlightKind::Scheduled => {
                p.stats.flights += 1;
                p.stats.pax += f.pax as u64;
                p.stats.seats += seats as u64;
            }
            FlightKind::Ferry => p.stats.ferries += 1,
            FlightKind::Delivery => {}
        }
        p.stats.recent.insert(
            0,
            Recent { t, from: f.from.clone(), to: f.to.clone(), kind: f.kind, pax: f.pax, seats, result },
        );
        p.stats.recent.truncate(STATS_RECENT);
        let name = Self::name_of(p);
        let kind_name = data().ac(&p.kind).name.clone();
        self.state.money += result;
        self.state.today.revenue += f.revenue;
        self.state.today.cost += f.cost;
        match f.kind {
            FlightKind::Scheduled => {
                self.state.today.flights += 1;
                self.state.rep.flown += 1;
                self.state.today.pax += f.pax;
                self.log(
                    format!(
                        "{name} {}→{}: {}/{seats} pax, revenue {}, cost {} → {}",
                        f.from,
                        f.to,
                        f.pax,
                        fmt_money(f.revenue),
                        fmt_money(f.cost),
                        fmt_money(result)
                    ),
                    if result >= 0.0 { LogKind::Good } else { LogKind::Bad },
                );
            }
            FlightKind::Delivery => {
                let from = data().airport(&f.from).name.clone();
                self.log(format!("{name} ({kind_name}) delivered to {} from {from}.", f.to), LogKind::Good);
            }
            FlightKind::Ferry => {
                self.log(format!("{name} ferried {}→{} (cost {}).", f.from, f.to, fmt_money(f.cost)), LogKind::Cost);
            }
        }
        if f.emergency.is_some() {
            self.emergency_landed(i, &f);
        } else if f.incident {
            self.incident(i, &f);
        }
    }

    /// Where an idle plane goes next: (to, kind, timed leg index).
    fn next_leg(&mut self, i: usize) -> Option<(String, FlightKind, Option<usize>)> {
        let t = self.state.time;
        // More than half a day behind its timetable (a strike, a storm, repairs): it takes up the timetable again from
        // its next departure instead of flying yesterday's flights late. (The browser game stays late for good.)
        {
            let p = &self.state.planes[i];
            if p.pending_ferry.is_none() && p.schedule.active && p.schedule.legs.len() >= 2 && t - p.schedule.due > DAY / 2 {
                self.sync_timetable(i);
            }
        }
        let p = &mut self.state.planes[i];
        if let Some(f) = &p.pending_ferry {
            if *f == p.location {
                p.pending_ferry = None;
                return None;
            }
            return Some((f.clone(), FlightKind::Ferry, None));
        }
        let sch = &p.schedule;
        if !sch.active || sch.legs.len() < 2 {
            return None;
        }
        let leg = &sch.legs[sch.index % sch.legs.len()];
        if p.location != leg.from {
            return Some((leg.from.clone(), FlightKind::Ferry, None));
        }
        if t < sch.due {
            return None;
        }
        Some((leg.to.clone(), FlightKind::Scheduled, Some((sch.index + 1) % sch.legs.len())))
    }

    fn try_depart(&mut self, i: usize) {
        let t = self.state.time;
        let Some((to, kind, next_index)) = self.next_leg(i) else {
            self.state.planes[i].wait_slot = None;
            return;
        };
        let d = data();
        let (ptype, from, pid) = {
            let p = &self.state.planes[i];
            (p.kind.clone(), p.location.clone(), p.id.clone())
        };
        let name = Self::name_of(&self.state.planes[i]);
        if !self.owns_slot(&to) && !d.airport(&to).factory {
            self.stop_plane(i, format!("{name} has no slot at {to} – stopped."));
            return;
        }
        if let Some(why) = fits_reason(&ptype, &to) {
            self.stop_plane(i, format!("{name} stopped: {why}"));
            return;
        }
        let ac = d.ac(&ptype);
        let dd = d.dist(&from, &to);
        if dd > ac.range_km {
            self.stop_plane(i, format!("{to} is out of range for {name} – stopped."));
            return;
        }
        if !self.curfew_open(&from, t) {
            return; // night curfew there (local time)
        }
        if self.hold_reason(&from, &to).is_some() || self.state.planes[i].repair {
            return;
        }
        let block = block_minutes(&ptype, dd);
        let crew = &self.state.planes[i].crew;
        if crew.duty_today > 0 && crew.duty_today + block > CREW_MAX_DUTY_MIN * crew.sets.max(1) as i64 {
            return; // the crew rests until tomorrow
        }
        let full = !self.slot_free_at(&to, t + block, i);
        self.state.planes[i].wait_slot = if full { Some(to.clone()) } else { None };
        if full {
            return;
        }

        let mut pax = 0;
        let mut revenue = 0.0;
        if kind == FlightKind::Scheduled {
            let key = format!("{from}-{to}");
            let carried = *self.state.carried_today.get(&key).unwrap_or(&0) as f64;
            let left = (self.pax_demand(&from, &to, ac.seats as f64) - carried).max(0.0);
            let luck = 0.85 + rand::random::<f64>() * 0.3;
            pax = (ac.seats as f64).min(left).min((left * luck).round()) as u32;
            *self.state.carried_today.entry(key).or_default() += pax;
            revenue = pax as f64 * self.fare(&from, &to);
            let p = &mut self.state.planes[i];
            let ni = next_index.unwrap();
            p.schedule.index = ni;
            // punctual: within 15 minutes of the timetable
            if t - p.schedule.due > 15 {
                self.state.rep.late += 1.0;
                p.stats.late += 1;
            } else {
                self.state.rep.on_time += 1.0;
                p.stats.on_time += 1;
            }
            p.schedule.due = next_at(p.schedule.legs[ni].dep, p.schedule.due + 1);
        } else if self.state.planes[i].pending_ferry.as_deref() == Some(to.as_str()) {
            self.state.planes[i].pending_ferry = None;
        }
        let cost_mult = self.cost_mult(i) * self.fuel_mult() * self.difficulty().cost_mult;
        let cost = flight_cost(&ptype, dd, &to, pax, cost_mult);
        let mut flight = Flight {
            from,
            to,
            kind,
            dep: t,
            arr: t + block,
            distance: dd.round(),
            pax,
            revenue,
            cost,
            crash_at: None,
            incident: false,
            emergency_at: None,
            emergency: None,
        };
        // at take-off: will this flight declare an emergency (which may end in a crash), or have an incident?
        let r = rand::random::<f64>();
        if r < EMERGENCY_PER_FLIGHT {
            flight.emergency_at = Some(t + ((block as f64 * (0.1 + rand::random::<f64>() * 0.7)).round() as i64).max(1));
        } else if r < EMERGENCY_PER_FLIGHT + INCIDENT_PER_FLIGHT {
            flight.incident = true;
        }
        let _ = pid;
        let p = &mut self.state.planes[i];
        p.flight = Some(flight);
        p.status = Status::Flying;
        p.wait_slot = None;
        p.crew.duty_today += block;
    }

    fn stop_plane(&mut self, i: usize, msg: String) {
        let p = &mut self.state.planes[i];
        p.schedule.active = false;
        p.pending_ferry = None;
        self.log(msg, LogKind::Bad);
    }

    /// How often an emergency ends in a crash (realistic mode: Boeing 5 % × 11).
    pub fn crash_chance(&self, kind: &str) -> f64 {
        (CRASH_SHARE * self.maker_mult(kind)).min(1.0)
    }

    pub fn maker_mult(&self, kind: &str) -> f64 {
        match mode(&self.state.mode).maker_crash {
            Some((maker, m)) if data().ac(kind).maker == maker => m,
            _ => 1.0,
        }
    }

    /// Why a plane isn't leaving right now, in a few words, or None.
    pub fn depart_note(&self, i: usize) -> Option<String> {
        let p = &self.state.planes[i];
        let t = self.state.time;
        match p.status {
            Status::Flying => return p.flight.as_ref().map(|f| format!("after it lands at {}", f.to)),
            Status::Turnaround => {
                return Some(if p.repair { "after its repairs".into() } else { format!("after its turnaround ({})", fmt_clock(p.ready_at)) })
            }
            Status::Idle => {}
        }
        if let Some(w) = &p.wait_slot {
            return Some(format!("waiting for a free slot at {w}"));
        }
        if let Some(f) = &p.pending_ferry {
            return Some(format!("ferry to {f}"));
        }
        let sch = &p.schedule;
        if !sch.active || sch.legs.is_empty() {
            return None;
        }
        let leg = &sch.legs[sch.index % sch.legs.len()];
        if let Some(h) = self.hold_reason(&p.location, &leg.to) {
            return Some(format!("held: {h}"));
        }
        if sch.due > t {
            return Some(format!("{}→{} at {} local", leg.from, leg.to, self.fmt_at(&leg.from, sch.due)));
        }
        if !self.curfew_open(&p.location, t) {
            let at = self.curfew_opens_at(&p.location, t);
            return Some(format!("at {} local (night curfew at {}, {} your time)", fmt_clock(CURFEW_START), p.location, fmt_clock(at)));
        }
        None
    }

    // ---------- fleet & market ----------

    pub fn plane_age(&self, i: usize) -> f64 {
        let p = &self.state.planes[i];
        p.age + (self.state.time - p.acquired_at) as f64 / DAY as f64 / 365.0
    }

    pub fn cost_mult(&self, i: usize) -> f64 {
        1.0 + AGING_COST_PER_YEAR * self.plane_age(i)
    }

    pub fn sale_value(&self, i: usize) -> f64 {
        (used_price(&self.state.planes[i].kind, self.plane_age(i)) * RESALE_FACTOR).round()
    }

    pub fn return_fee(&self, i: usize) -> f64 {
        data().ac(&self.state.planes[i].kind).lease_per_week * RETURN_FEE_WEEKS
    }

    pub fn refresh_market(&mut self) {
        let d = data();
        let mut list = Vec::new();
        let homes: Vec<&crate::data::Airport> = d.airports.iter().filter(|a| !a.minor && !a.factory && a.size >= 2).collect();
        for _ in 0..USED_LISTINGS {
            let types: Vec<&crate::data::Aircraft> =
                d.aircraft.iter().filter(|a| a.category != "classic" || rand::random::<f64>() < 0.3).collect();
            let ac = types[rand::random_range(0..types.len())];
            let age = rand::random_range(USED_AGE.0..=USED_AGE.1);
            let fits: Vec<&&crate::data::Airport> = homes.iter().filter(|a| fits_airport(&ac.code, &a.code)).take(400).collect();
            let at = if fits.is_empty() { self.state.home.clone() } else { fits[rand::random_range(0..fits.len())].code.clone() };
            let n = self.state.market.next_id;
            self.state.market.next_id += 1;
            list.push(Listing { id: format!("U{n}"), kind: ac.code.clone(), age, price: used_price(&ac.code, age as f64), at });
        }
        list.sort_by(|a, b| a.price.total_cmp(&b.price));
        self.state.market.listings = list;
    }

    pub fn next_registration(&self) -> String {
        const L: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        for i in 0..26 * 26 * 26 {
            let id = format!(
                "{REGISTRATION_PREFIX}{}{}{}",
                L[(i / 676) % 26] as char,
                L[(i / 26) % 26] as char,
                L[i % 26] as char
            );
            if !self.state.planes.iter().any(|p| p.id == id) {
                return id;
            }
        }
        format!("{REGISTRATION_PREFIX}{}", self.state.time)
    }

    fn check_delivery(&self, kind: &str, code: &str, cost: f64) -> Result<(), String> {
        if !self.owns_slot(code) {
            return Err(format!("You need a slot at {code} for the delivery."));
        }
        if let Some(why) = fits_reason(kind, code) {
            return Err(why);
        }
        if let Some(room) = self.room_reason(kind, code, None) {
            return Err(format!("For the delivery: {room}"));
        }
        if self.state.money < cost {
            return Err(format!("Not enough money ({} needed).", fmt_money(cost)));
        }
        Ok(())
    }

    fn add_plane(&mut self, kind: &str, code: &str, own: Ownership, age: f64, from: Option<String>) -> String {
        let id = self.next_registration();
        let t = self.state.time;
        let mut p = new_plane(&id, kind, code, own, age, t);
        if let Some(from) = from {
            // delivery flight, paid by the seller; ignores curfew and crew duty
            let dd = data().dist(&from, code);
            p.location = from.clone();
            p.status = Status::Flying;
            p.flight = Some(Flight {
                from,
                to: code.into(),
                kind: FlightKind::Delivery,
                dep: t,
                arr: t + block_minutes(kind, dd),
                distance: dd.round(),
                pax: 0,
                revenue: 0.0,
                cost: 0.0,
                crash_at: None,
                incident: false,
                emergency_at: None,
                emergency: None,
            });
        }
        self.state.planes.push(p);
        id
    }

    fn delivery_from(&self, kind: &str, code: &str) -> Option<String> {
        data().factory_of.get(kind).filter(|f| *f != code).cloned()
    }

    pub fn buy_new(&mut self, kind: &str, code: &str) -> Result<(), String> {
        let cost = price_new(kind);
        self.check_delivery(kind, code, cost)?;
        self.state.money -= cost;
        let from = self.delivery_from(kind, code);
        let id = self.add_plane(kind, code, Ownership::Owned, 0.0, from.clone());
        let name = data().ac(kind).name.clone();
        self.log(
            match from {
                Some(f) => format!("Bought a new {name} ({id}) for {} – delivery flight {f} → {code}.", fmt_money(cost)),
                None => format!("Bought a new {name} ({id}) for {}, delivered to {code}.", fmt_money(cost)),
            },
            LogKind::Cost,
        );
        Ok(())
    }

    pub fn lease_new(&mut self, kind: &str, code: &str) -> Result<(), String> {
        let cost = lease_deposit(kind);
        self.check_delivery(kind, code, cost)?;
        self.state.money -= cost;
        let from = self.delivery_from(kind, code);
        let id = self.add_plane(kind, code, Ownership::Leased, 0.0, from.clone());
        let ac = data().ac(kind);
        self.log(
            format!(
                "Leased a {} ({id}) – deposit {}, {}/week{}",
                ac.name,
                fmt_money(cost),
                fmt_money(ac.lease_per_week),
                match from {
                    Some(f) => format!(" – delivery flight {f} → {code}."),
                    None => format!(". Delivered to {code}."),
                }
            ),
            LogKind::Cost,
        );
        Ok(())
    }

    pub fn buy_used(&mut self, listing: &str, code: &str) -> Result<(), String> {
        let Some(li) = self.state.market.listings.iter().position(|l| l.id == listing) else {
            return Err("That aircraft has already been sold.".into());
        };
        let l = self.state.market.listings[li].clone();
        self.check_delivery(&l.kind, code, l.price)?;
        self.state.money -= l.price;
        self.state.market.listings.remove(li);
        let from = if l.at != code { Some(l.at.clone()) } else { None };
        let id = self.add_plane(&l.kind, code, Ownership::Owned, l.age as f64, from.clone());
        let name = data().ac(&l.kind).name.clone();
        self.log(
            format!(
                "Bought a used {name} ({id}, {} years) for {}{}",
                l.age,
                fmt_money(l.price),
                match from {
                    Some(f) => format!(" – ferried in from {f}."),
                    None => format!(", delivered to {code}."),
                }
            ),
            LogKind::Cost,
        );
        Ok(())
    }

    /// Sells an owned plane or hands a leased one back.
    pub fn dispose_plane(&mut self, i: usize) -> Result<(), String> {
        if self.state.planes.len() == 1 {
            return Err("You cannot give up your last plane.".into());
        }
        let p = &self.state.planes[i];
        let name = Self::name_of(p);
        if p.status == Status::Flying {
            return Err(format!("{name} is in the air – wait until it lands."));
        }
        let tname = data().ac(&p.kind).name.clone();
        if p.ownership == Ownership::Owned {
            let v = self.sale_value(i);
            self.state.money += v;
            self.log(format!("Sold {name} ({tname}) for {}.", fmt_money(v)), LogKind::Good);
        } else {
            let fee = self.return_fee(i);
            self.state.money -= fee;
            self.log(format!("Returned leased {name} ({tname}), return fee {}.", fmt_money(fee)), LogKind::Cost);
        }
        self.state.planes.remove(i);
        Ok(())
    }

    pub fn send_plane(&mut self, i: usize, code: &str) -> Result<(), String> {
        let p = &self.state.planes[i];
        let name = Self::name_of(p);
        if !self.owns_slot(code) {
            return Err(format!("You need a slot at {code} first."));
        }
        if p.location == code && p.status != Status::Flying {
            return Err(format!("{name} is already at {code}."));
        }
        if let Some(why) = fits_reason(&p.kind, code) {
            return Err(why);
        }
        if data().dist(&p.location, code) > data().ac(&p.kind).range_km {
            return Err("Out of range.".into());
        }
        if let Some(r) = self.room_reason(&p.kind.clone(), code, Some(i)) {
            return Err(r);
        }
        let idle = p.status == Status::Idle;
        let p = &mut self.state.planes[i];
        p.schedule.active = false;
        p.pending_ferry = Some(code.into());
        self.log(format!("{name} will ferry to {code}{}.", if idle { "" } else { " when ready" }), LogKind::Info);
        Ok(())
    }

    // ---------- timetables ----------

    /// A day plan for a route: as many loops as fit into the day (or `rounds`), from `first_dep` (home-base clock).
    /// Each departure must fall within the night curfew window of its airport, local time.
    pub fn build_timetable(&self, kind: &str, stops: &[String], first_dep: i64, rounds: usize) -> Vec<Leg> {
        let mut legs = Vec::new();
        if stops.len() < 2 {
            return legs;
        }
        let ta = turnaround_min(kind);
        let loop_duty: i64 = (0..stops.len()).map(|i| leg_block(kind, &stops[i], &stops[(i + 1) % stops.len()])).sum();
        let max_duty = CREW_MAX_DUTY_MIN * if rounds > 0 || loop_duty > CREW_MAX_DUTY_MIN { CREWS_MAX as i64 } else { 1 };
        let (mut t, mut duty) = (first_dep, 0);
        let mut r = 0;
        loop {
            if rounds > 0 && r >= rounds {
                break;
            }
            let mut lp = Vec::new();
            let (mut tt, mut dd, mut ok) = (t, duty, true);
            for i in 0..stops.len() {
                let (from, to) = (&stops[i], &stops[(i + 1) % stops.len()]);
                let block = leg_block(kind, from, to);
                if !self.curfew_open(from, tt) || dd + block > max_duty {
                    ok = false;
                }
                lp.push(Leg { from: from.clone(), to: to.clone(), dep: tt % DAY });
                tt += block + ta;
                dd += block;
            }
            // the day must end where it started, in time for the first departure tomorrow
            if !ok || tt - ta > first_dep + DAY - ta {
                break;
            }
            legs.extend(lp);
            t = tt;
            duty = dd;
            r += 1;
            if r > 30 {
                break;
            }
        }
        legs
    }

    /// Problems with a timetable for a plane: errors block saving.
    pub fn check_timetable(&self, i: usize, legs: &[Leg]) -> Vec<String> {
        let p = &self.state.planes[i];
        let ac = data().ac(&p.kind);
        let mut errors: Vec<String> = Vec::new();
        if legs.len() < 2 {
            return vec!["A timetable needs at least two flights.".into()];
        }
        let mut duty = 0;
        for (k, leg) in legs.iter().enumerate() {
            let next = &legs[(k + 1) % legs.len()];
            duty += leg_block(&p.kind, &leg.from, &leg.to);
            let name = format!("{} {}→{}", self.fmt_at(&leg.from, leg.dep), leg.from, leg.to);
            if leg.to != next.from {
                errors.push(format!("{name} ends at {}, but the next flight leaves from {}.", leg.to, next.from));
            }
            if !self.owns_slot(&leg.from) {
                errors.push(format!("No slot at {}.", leg.from));
            }
            if leg.from == leg.to {
                errors.push(format!("{name} goes nowhere."));
            }
            if !self.curfew_open(&leg.from, leg.dep) {
                let yours = if self.ahead_of(&leg.from) != 0 {
                    format!(" ({} your time)", self.curfew_home(&leg.from))
                } else {
                    String::new()
                };
                errors.push(format!(
                    "{name}: night curfew at {}, departures only {}–{} local{yours}.",
                    leg.from,
                    fmt_clock(CURFEW_START),
                    fmt_clock(CURFEW_END)
                ));
            }
            if !self.my_slot_classes(&leg.from).iter().enumerate().any(|(c, &n)| n > 0 && c >= type_class(&p.kind)) && self.owns_slot(&leg.from) {
                errors.push(format!(
                    "No slot at {} big enough for the {}: it needs class {} or bigger.",
                    leg.from,
                    ac.name,
                    CLASSES[type_class(&p.kind)]
                ));
            }
            if data().dist(&leg.from, &leg.to) > ac.range_km {
                errors.push(format!("{name} is out of range."));
            }
            if let Some(why) = fits_reason(&p.kind, &leg.to) {
                errors.push(why);
            }
        }
        // the legs must fit into one day, each with a turnaround
        let ta = turnaround_min(&p.kind);
        let mut t = legs[0].dep;
        for (k, leg) in legs.iter().enumerate() {
            if k > 0 {
                let mut dep = leg.dep;
                while dep < t {
                    dep += DAY;
                }
                t = dep;
            }
            let ready = t + leg_block(&p.kind, &leg.from, &leg.to) + ta;
            let next_dep = if k + 1 < legs.len() {
                let mut d = legs[k + 1].dep;
                while d < t {
                    d += DAY;
                }
                d
            } else {
                legs[0].dep + DAY
            };
            if next_dep < ready {
                errors.push(format!(
                    "After {} {}→{} the plane is ready at {} – too late for the next flight at {}.",
                    self.fmt_at(&leg.from, leg.dep),
                    leg.from,
                    leg.to,
                    self.fmt_at(&leg.to, ready),
                    self.fmt_at(&leg.to, next_dep)
                ));
            }
        }
        if duty > CREW_MAX_DUTY_MIN * CREWS_MAX as i64 {
            errors.push(format!(
                "{} in the air a day – {CREWS_MAX} crews may fly {}.",
                fmt_duration(duty),
                fmt_duration(CREW_MAX_DUTY_MIN * CREWS_MAX as i64)
            ));
        }
        let mut seen = std::collections::HashSet::new();
        errors.retain(|e| seen.insert(e.clone()));
        errors
    }

    /// Slot check for a timetable: airports where more of your planes stand at once than you hold slots
    /// (a plane then waits at its gate until one is free). (code, have, need)
    pub fn timetable_slots(&self, i: usize, legs: &[Leg]) -> Vec<(String, u32, u32)> {
        let mut out = Vec::new();
        let mut codes: Vec<&String> = legs.iter().map(|l| &l.from).collect();
        codes.sort();
        codes.dedup();
        for code in codes {
            if code == self.home() {
                continue;
            }
            // minute-by-minute occupancy over a day: this plane's draft plus every other plane
            let mut busy = vec![0u32; DAY as usize];
            for (k, q) in self.state.planes.iter().enumerate() {
                let (kind, ls): (&str, &[Leg]) = if k == i { (&q.kind, legs) } else { (&q.kind, &q.schedule.legs) };
                if k != i && (!q.schedule.active || ls.is_empty()) {
                    let at = q.flight.as_ref().map(|f| f.to.as_str()).unwrap_or(&q.location);
                    if at == code && !self.parks_at_base(q, code) {
                        busy.iter_mut().for_each(|b| *b += 1);
                    }
                    continue;
                }
                for (from, to) in ground_times(kind, ls, code) {
                    for m in from..to {
                        busy[m as usize] += 1;
                    }
                }
            }
            let need = busy.iter().copied().max().unwrap_or(0);
            let have = self.slot_count(code);
            if need > have {
                out.push((code.clone(), have, need));
            }
        }
        out
    }

    pub fn set_timetable(&mut self, i: usize, legs: Vec<Leg>) -> Result<(), String> {
        let errors = self.check_timetable(i, &legs);
        if let Some(e) = errors.into_iter().next() {
            return Err(e);
        }
        let legs: Vec<Leg> = legs.into_iter().map(|l| Leg { dep: l.dep.rem_euclid(DAY), ..l }).collect();
        let p = &mut self.state.planes[i];
        let active = p.schedule.active;
        p.schedule = Schedule { stops: legs.iter().map(|l| l.from.clone()).collect(), legs, index: 0, active, due: 0 };
        self.sync_timetable(i);
        let p = &self.state.planes[i];
        let list: Vec<String> = p.schedule.legs.iter().map(|l| format!("{} {}→{}", self.fmt_at(&l.from, l.dep), l.from, l.to)).collect();
        let name = Self::name_of(p);
        let n = crews_for(&p.kind, &p.schedule.legs);
        self.log(format!("{name} timetable: {} (local times).", list.join(", ")), LogKind::Info);
        self.set_crews(i, n);
        self.seat_cache.replace(None);
        Ok(())
    }

    pub fn clear_timetable(&mut self, i: usize) {
        let p = &mut self.state.planes[i];
        p.schedule = Schedule::default();
        p.wait_slot = None;
        let at = p.flight.as_ref().map(|f| f.to.clone()).unwrap_or_else(|| p.location.clone());
        let name = Self::name_of(p);
        self.log(format!("{name} has no timetable any more and stays at {at}."), LogKind::Info);
        self.set_crews(i, 1);
    }

    fn set_crews(&mut self, i: usize, n: u32) {
        let p = &mut self.state.planes[i];
        if p.crew.sets.max(1) == n {
            return;
        }
        p.crew.sets = n;
        let (name, extra) = (Self::name_of(p), p.crew.weekly_salary * (n as f64 - 1.0));
        if n > 1 {
            self.log(
                format!(
                    "{name} flies more than {} a day: a second crew joins it (+{}/week).",
                    fmt_duration(CREW_MAX_DUTY_MIN),
                    fmt_money(extra)
                ),
                LogKind::Cost,
            );
        } else {
            self.log(format!("{name} needs only one crew again."), LogKind::Info);
        }
    }

    /// Next leg to fly: the one leaving soonest from where the plane is (or will be).
    fn sync_timetable(&mut self, i: usize) {
        let t = self.state.time;
        let p = &mut self.state.planes[i];
        if p.schedule.legs.is_empty() {
            return;
        }
        let (at, from) = match (&p.flight, p.status) {
            (Some(f), Status::Flying) => (f.to.clone(), t.max(f.arr + turnaround_min(&p.kind))),
            _ => (p.location.clone(), t),
        };
        let mut best = (0, i64::MAX);
        for (k, l) in p.schedule.legs.iter().enumerate() {
            let due = next_at(l.dep, from) + if l.from == at { 0 } else { DAY / 2 };
            if due < best.1 {
                best = (k, due);
            }
        }
        p.schedule.index = best.0;
        p.schedule.due = next_at(p.schedule.legs[best.0].dep, from);
    }

    pub fn set_schedule_active(&mut self, i: usize, active: bool) -> Result<(), String> {
        let p = &mut self.state.planes[i];
        if active && p.schedule.legs.len() < 2 {
            return Err("Create a timetable first.".into());
        }
        p.schedule.active = active;
        p.wait_slot = None;
        if active {
            p.pending_ferry = None;
            self.sync_timetable(i);
        }
        let name = Self::name_of(&self.state.planes[i]);
        self.log(format!("{name} timetable {}.", if active { "started" } else { "paused" }), LogKind::Info);
        self.seat_cache.replace(None);
        Ok(())
    }

    /// Rough forecast for a timetable day.
    pub fn estimate_timetable(&self, i: usize, legs: &[Leg]) -> Estimate {
        let p = &self.state.planes[i];
        let ac = data().ac(&p.kind);
        let cost_mult = self.cost_mult(i) * self.difficulty().cost_mult;
        let mut used: HashMap<String, f64> = HashMap::new();
        let (mut profit, mut pax, mut block) = (0.0, 0, 0);
        let mut rows = Vec::new();
        for l in legs {
            let d = data().dist(&l.from, &l.to);
            let key = format!("{}-{}", l.from, l.to);
            let left = (self.pax_demand(&l.from, &l.to, ac.seats as f64) - used.get(&key).copied().unwrap_or(0.0)).max(0.0);
            let n = (ac.seats as f64).min(left);
            *used.entry(key).or_default() += n;
            let rev = n * self.fare(&l.from, &l.to);
            let cost = flight_cost(&p.kind, d, &l.to, n as u32, cost_mult);
            let b = block_minutes(&p.kind, d);
            profit += rev - cost;
            pax += n as u32;
            block += b;
            rows.push((l.clone(), b, n as u32, rev - cost));
        }
        let sets = crews_for(&p.kind, legs) as f64;
        let lease = if p.ownership == Ownership::Owned { 0.0 } else { ac.lease_per_week };
        Estimate { rows, pax, profit, block, fixed_per_day: (lease + p.crew.weekly_salary * sets) / 7.0 }
    }

    // ---------- the map ----------

    /// Where plane i is at fractional time t: (lat, lon, heading, airborne).
    pub fn plane_position(&self, i: usize, t: f64) -> (f64, f64, f64, bool) {
        let d = data();
        let p = &self.state.planes[i];
        match &p.flight {
            Some(f) if p.status == Status::Flying => {
                let (a, b) = (d.airport(&f.from), d.airport(&f.to));
                // taxi and climb/approach take some of the block time: the plane moves along the great circle
                // over the rest
                let taxi = 10.0f64.min((f.arr - f.dep) as f64 * 0.2);
                let x = ((t - f.dep as f64 - taxi) / ((f.arr - f.dep) as f64 - 2.0 * taxi)).clamp(0.0, 1.0);
                let x = x * x * (3.0 - 2.0 * x) * 0.3 + x * 0.7; // a little slower at both ends
                let (lat, lon) = interpolate(a.lat, a.lon, b.lat, b.lon, x);
                let ahead = interpolate(a.lat, a.lon, b.lat, b.lon, (x + 0.01).min(1.0));
                let h = if x < 0.99 { bearing(lat, lon, ahead.0, ahead.1) } else { bearing(a.lat, a.lon, b.lat, b.lon) };
                (lat, lon, h, x > 0.0 && x < 1.0)
            }
            _ => {
                let a = d.airport(&p.location);
                (a.lat, a.lon, 0.0, false)
            }
        }
    }

    // ---------- saving ----------

    pub fn save_json(&self) -> String {
        serde_json::to_string(&self.state).unwrap_or_default()
    }

    pub fn load_json(text: &str) -> Result<Game, String> {
        let state: State = serde_json::from_str(text).map_err(|e| format!("Not a save game: {e}"))?;
        // drop what the data no longer knows
        if data().try_airport(&state.home).is_none() {
            return Err(format!("Unknown home airport {}.", state.home));
        }
        Ok(Game::from_state(state))
    }
}

fn new_plane(id: &str, kind: &str, code: &str, ownership: Ownership, age: f64, t: i64) -> Plane {
    Plane {
        id: id.into(),
        kind: kind.into(),
        name: None,
        location: code.into(),
        status: Status::Idle,
        ownership,
        age,
        acquired_at: t,
        ready_at: 0,
        flight: None,
        pending_ferry: None,
        wait_slot: None,
        repair: false,
        schedule: Schedule::default(),
        crew: crew_for(kind),
        stats: Stats::default(),
    }
}

/// Adds to the tally of the week of time t (the last 12 weeks are kept).
fn record(p: &mut Plane, t: i64, add: impl FnOnce(&mut Tally)) {
    let w = t.div_euclid(DAY * 7);
    let weeks = &mut p.stats.weeks;
    if !weeks.iter().any(|x| x.week == w) {
        if weeks.iter().any(|x| x.week > w) {
            return;
        }
        weeks.push(Tally { week: w, ..Default::default() });
        if weeks.len() > STATS_WEEKS {
            weeks.remove(0);
        }
    }
    add(weeks.iter_mut().find(|x| x.week == w).unwrap());
}

/// Where a plane with these legs stands at `code` during the day: [from, to) minutes, split at midnight.
pub fn ground_times(kind: &str, legs: &[Leg], code: &str) -> Vec<(i64, i64)> {
    let mut out = Vec::new();
    let n = legs.len();
    for k in 0..n {
        let (leg, next) = (&legs[k], &legs[(k + 1) % n]);
        if leg.to != code {
            continue;
        }
        let arr = leg.dep + leg_block(kind, &leg.from, &leg.to);
        let mut dep = next.dep;
        while dep < arr {
            dep += DAY;
        }
        let a = arr % DAY;
        let len = (dep - arr).min(DAY);
        if a + len <= DAY {
            out.push((a, a + len));
        } else {
            out.push((a, DAY));
            out.push((0, a + len - DAY));
        }
    }
    out
}

fn enter_story(rival: &str, company: &str, rt: &RivalRoute) -> Story {
    let d = data();
    let (a, b) = (&d.airport(&rt.a).city, &d.airport(&rt.b).city);
    Story {
        good: false,
        headline: format!("{} MUSCLES IN ON {}–{}", rival.to_uppercase(), a.to_uppercase(), b.to_uppercase()),
        sub: format!("New competition for {company}"),
        body: format!(
            "{rival} will fly between {a} and {b} {} times a day, with tickets at {:.0}% of the usual price. Analysts expect \
             {company} to lose passengers on the route unless it adds flights or cuts its own fares.",
            rt.per_day,
            rt.fare * 100.0
        ),
        paper: String::new(),
        t: 0,
    }
}

fn fare_war_story(rival: &str, company: &str, a: &str, b: &str, fare: f64) -> Story {
    let d = data();
    let (a, b) = (&d.airport(a).city, &d.airport(b).city);
    Story {
        good: false,
        headline: format!("FARE WAR ON {}–{}", a.to_uppercase(), b.to_uppercase()),
        sub: format!("{rival} slashes ticket prices"),
        body: format!(
            "Stung by {company}'s success between {a} and {b}, {rival} has cut its fares to {:.0}% of the usual price. \
             Travellers rejoice; airline shareholders less so.",
            fare * 100.0
        ),
        paper: String::new(),
        t: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_month_of_flying() {
        let mut g = Game::new_game(&NewGame::default());
        assert!(!g.state.rivals.is_empty());
        g.state.money += 1e6;
        // London City is too short for the A220
        assert!(fits_reason("A220-300", "LCY").is_some());
        g.lease_slot("MAD", None).unwrap();
        // the A220 is class C: the slot leased for it
        assert_eq!(g.my_slot_classes("MAD")[2], 1);
        let stops = vec!["BRN".to_string(), "MAD".to_string()];
        let legs = g.build_timetable("A220-300", &stops, CURFEW_START + 60, 0);
        assert!(legs.len() >= 2, "{legs:?}");
        g.set_timetable(0, legs).unwrap();
        g.set_schedule_active(0, true).unwrap();
        let est = g.estimate_timetable(0, &g.state.planes[0].schedule.legs.clone());
        assert!(est.pax > 0);
        g.advance(30 * DAY);
        assert!(!g.state.rivals.iter().all(|r| r.routes.is_empty()));
        assert!(g.state.planes[0].stats.flights > 20, "flights {}", g.state.planes[0].stats.flights);
        assert!(g.state.history.len() >= 29);
        let saved = g.save_json();
        let g2 = Game::load_json(&saved).unwrap();
        assert_eq!(g2.state.planes.len(), g.state.planes.len());
    }

    #[test]
    fn local_time_and_curfew() {
        let g = Game::new_game(&NewGame { airport: "ZRH".into(), ..Default::default() });
        // London is an hour behind Zurich, New York six
        assert_eq!(g.ahead_of("LHR"), -60);
        assert_eq!(g.ahead_of("JFK"), -360);
        // 06:00 in Zurich is 00:00 in New York: no departures there yet
        assert!(g.curfew_open("ZRH", CURFEW_START));
        assert!(!g.curfew_open("JFK", CURFEW_START));
        assert_eq!(g.curfew_opens_at("JFK", CURFEW_START), CURFEW_START + 360);
        assert!(sun_times("ZRH", 0).is_some());
        // the stands the browser game counts at Zurich, and a made-up apron elsewhere
        assert_eq!(g.slot_capacity("ZRH"), 42);
        assert_eq!(max_class("ZRH"), 5);
        assert_eq!(g.slot_capacity("SIR"), crate::data::DEFAULT_STANDS[airport_size("SIR")].iter().sum::<u32>());
    }

    #[test]
    fn quick_start() {
        let pr = data().presets.iter().find(|p| p.id == "europe").expect("europe preset");
        let (mut g, errors) = Game::from_preset(pr);
        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(g.state.planes.len(), 8);
        assert!(g.state.planes.iter().all(|p| p.schedule.active));
        // ZRH→LHR leaves at 07:00 Zurich time, 06:00 in London; the way back leaves London by its clock
        g.advance(3 * DAY);
        assert!(g.state.planes.iter().map(|p| p.stats.flights).sum::<u32>() > 100);
    }

    #[test]
    fn money_format() {
        assert_eq!(fmt_money(1500000.0), "CHF 1’500’000");
        assert_eq!(fmt_money(-12.4), "-CHF 12");
    }
}
