//! Game balance, as in the browser game's `js/config.js`.

pub const CURRENCY: &str = "CHF";
pub const COMPANY_NAME: &str = "Bern Air";
pub const START_AIRPORT: &str = "BRN";
pub const START_AIRCRAFT: &str = "A220-300";
pub const START_REGISTRATION: &str = "HB-AEA";

pub const DAY: i64 = 1440;

// Demand model
pub const CATCHMENT_RADIUS_KM: f64 = 150.0;
pub const DEMAND_FACTOR: f64 = 0.00011;
pub const TICKET_BASE: f64 = 60.0;
pub const TICKET_PER_KM: f64 = 0.11;
pub const ELASTICITY: f64 = 1.5;
pub const FARE_MIN: f64 = 0.5;
pub const FARE_MAX: f64 = 2.0;
pub const FARE_STEP: f64 = 0.05;
pub const PAX_FEE: f64 = 8.0;
pub const LANDING_FEE_BASE: f64 = 300.0;
pub const LANDING_FEE_PER_SIZE: f64 = 400.0;

// Slot prices by airport size (index 1..5)
pub const SLOT_UPFRONT: [f64; 6] = [0.0, 60000.0, 120000.0, 250000.0, 450000.0, 750000.0];
pub const SLOT_WEEKLY: [f64; 6] = [0.0, 1500.0, 4000.0, 9000.0, 18000.0, 32000.0];
/// Share of the slots airlines that aren't in the game hold, by size.
pub const OTHER_AIRLINES: [f64; 6] = [0.0, 0.1, 0.25, 0.4, 0.55, 0.7];
pub const MINOR_FACTOR: f64 = 0.3;

// Operations
pub const TAXI_MIN: f64 = 30.0;
pub const TURNAROUND_BASE: f64 = 10.0;
pub const TURNAROUND_PER_SEAT: f64 = 0.11;
pub const TURNAROUND_MIN: i64 = 15;
pub const TURNAROUND_MAX: i64 = 60;
pub const CURFEW_START: i64 = 6 * 60;
pub const CURFEW_END: i64 = 22 * 60;
pub const CREW_MAX_DUTY_MIN: i64 = 12 * 60;
pub const CREWS_MAX: u32 = 2;

// Aircraft market
pub const PRICE_WEEKS: f64 = 110.0;
pub const LEASE_DEPOSIT_WEEKS: f64 = 2.0;
pub const RETURN_FEE_WEEKS: f64 = 2.0;
pub const RESALE_FACTOR: f64 = 0.9;
pub const DEPRECIATION_PER_YEAR: f64 = 0.07;
pub const AGING_COST_PER_YEAR: f64 = 0.012;
pub const USED_LISTINGS: usize = 8;
pub const USED_AGE: (i64, i64) = (3, 28);
pub const REGISTRATION_PREFIX: &str = "HB-";
pub const PILOT_SALARY: f64 = 4000.0;
pub const CABIN_SALARY: f64 = 1500.0;

// Reputation 0-100
pub const REP_BASE: f64 = 50.0;
pub const REP_FLIGHTS_PER_POINT: f64 = 40.0;
pub const REP_EXPERIENCE_MAX: f64 = 15.0;
pub const REP_PUNCTUALITY: f64 = 15.0;
pub const REP_CRASH: f64 = 30.0;
pub const REP_CRASH_DAYS: f64 = 120.0;
pub const REP_INCIDENT: f64 = 6.0;
pub const REP_INCIDENT_DAYS: f64 = 30.0;
pub const REP_HOME: f64 = 5.0;

// Slot offers: fair price = upfront × FAIR_UPFRONTS (× HUB_FACTOR at a rival's hub)
pub const OFFER_FAIR_UPFRONTS: f64 = 3.0;
pub const OFFER_HUB_FACTOR: f64 = 1.5;
pub const OFFER_REP_LOW: f64 = 0.6;
pub const OFFER_REP_HIGH: f64 = 1.4;
pub const OFFER_FROM: f64 = 0.55;
pub const OFFER_SPAN: f64 = 0.8;
pub const OFFER_MAX_CHANCE: f64 = 0.95;

// Rivals
pub const RIVALS_NEAR: usize = 5;
pub const RIVALS_FAR: usize = 5;
pub const CAPACITY_EXP: f64 = 0.8;
pub const RIVAL_MAX_PER_DAY: u32 = 8;
pub const RIVAL_TARGET_LOAD: f64 = 0.8;
pub const RIVAL_GROWTH: f64 = 0.6;
pub const RIVAL_ATTACK: f64 = 0.35;
pub const FARE_WAR_SHARE: f64 = 0.3;
pub const FARE_WAR_CUT: f64 = 0.05;
pub const FARE_WAR_MIN: f64 = 0.65;
pub const LONG_HAUL_KM: f64 = 4000.0;
pub const LONG_HAUL_TYPE: &str = "A330-300";
pub const SHORT_PROP_KM: f64 = 500.0;
pub const SHORT_PROP_TYPE: &str = "ATR72-600";

pub fn rival_routes(kind: &str) -> usize {
    match kind {
        "flag" => 12,
        "low" => 14,
        _ => 8,
    }
}
pub fn rival_fare(kind: &str) -> f64 {
    match kind {
        "flag" => 1.1,
        "low" => 0.75,
        _ => 1.05,
    }
}
pub fn rival_range(kind: &str) -> f64 {
    match kind {
        "flag" => 9000.0,
        "low" => 3500.0,
        _ => 1500.0,
    }
}
pub fn rival_fleet(kind: &str) -> &'static str {
    match kind {
        "flag" => "A320",
        "low" => "A320neo",
        _ => "E190",
    }
}

// Random events
/// A crash always starts as an in-flight emergency: CRASH_SHARE of them (times the mode's maker multiplier) end
/// in a crash, the rest land safely and are grounded for an inspection.
pub const EMERGENCY_PER_FLIGHT: f64 = 1.0 / 150.0;
pub const CRASH_SHARE: f64 = 0.05;
pub const INCIDENT_PER_FLIGHT: f64 = 1.0 / 150.0;
pub const EVENTS_PER_DAY: f64 = 0.5;
pub const CRASH_PAX_COMPENSATION: f64 = 25000.0;
pub const CRASH_INVESTIGATION: f64 = 300000.0;
pub const CRASH_INSURANCE_SHARE: f64 = 0.6;
pub const CRASH_LEASE_PENALTY_WEEKS: f64 = 20.0;
pub const CRASH_REP_DEMAND: f64 = 0.7;
pub const CRASH_REP_DAYS: i64 = 21;

pub struct Difficulty {
    pub id: &'static str,
    pub name: &'static str,
    pub desc: &'static str,
    pub start_money: f64,
    pub demand_mult: f64,
    pub cost_mult: f64,
    pub bankruptcy_limit: f64,
}

pub const DIFFICULTIES: [Difficulty; 3] = [
    Difficulty {
        id: "easy",
        name: "Easy",
        desc: "CHF 5M to start, more passengers, cheaper flights.",
        start_money: 5_000_000.0,
        demand_mult: 1.25,
        cost_mult: 0.85,
        bankruptcy_limit: -2_000_000.0,
    },
    Difficulty {
        id: "normal",
        name: "Normal",
        desc: "CHF 1.5M to start, the standard game.",
        start_money: 1_500_000.0,
        demand_mult: 1.0,
        cost_mult: 1.0,
        bankruptcy_limit: -500_000.0,
    },
    Difficulty {
        id: "hard",
        name: "Hard",
        desc: "CHF 750k, fewer passengers, dearer flights.",
        start_money: 750_000.0,
        demand_mult: 0.85,
        cost_mult: 1.15,
        bankruptcy_limit: -250_000.0,
    },
];

pub fn difficulty(id: &str) -> &'static Difficulty {
    DIFFICULTIES.iter().find(|d| d.id == id).unwrap_or(&DIFFICULTIES[1])
}

pub struct Mode {
    pub id: &'static str,
    pub name: &'static str,
    pub desc: &'static str,
    /// crash chance multiplier for planes of this maker
    pub maker_crash: Option<(&'static str, f64)>,
}

pub const MODES: [Mode; 2] = [
    Mode { id: "arcade", name: "Arcade", desc: "Normal accident rates.", maker_crash: None },
    Mode { id: "realistic", name: "Realistic", desc: "Boeing aircraft crash 1000% more often.", maker_crash: Some(("Boeing", 11.0)) },
];

pub fn mode(id: &str) -> &'static Mode {
    MODES.iter().find(|m| m.id == id).unwrap_or(&MODES[0])
}

/// Home airports offered on the start screen, by region. All small, so slots are cheap.
pub const START_AIRPORTS: [(&str, &[&str]); 6] = [
    ("Europe", &["BRN", "LUG", "SIR", "SOU", "SEN", "EXT", "ANR", "BZO", "AVN", "LRH"]),
    ("North America", &["HPN", "ISP", "YTZ", "SBA", "ACK"]),
    ("South America", &["EPA", "JOI", "KNA"]),
    ("Middle East & Africa", &["WIL", "GCJ", "MEK", "MYD"]),
    ("Asia", &["BDO", "BPM", "USN", "ISG", "XSP", "TNJ"]),
    ("Oceania", &["MEB", "TRG"]),
];

/// Aircraft offered as the first (leased) plane on the start screen.
pub const STARTER_AIRCRAFT: [&str; 6] = ["ATR72-600", "Q400", "E190", "A220-300", "A320neo", "B737-800"];

/// Game minutes per real second, as in the browser game's speed menu.
pub const SPEEDS: [f64; 6] = [1.0, 10.0, 60.0, 300.0, 1200.0, 3600.0];
