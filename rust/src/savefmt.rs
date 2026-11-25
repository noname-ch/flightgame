//! Save files shared with the browser game.
//!
//! The browser game saves its `G.state` as JSON (camelCase, crews in a list of their own, stats with `year`/`last`).
//! This app keeps its own `State` (snake_case). A save file can come from either: [`read`] takes both, and
//! [`to_browser`] writes the browser game's format, which Menu → Save to file uses so the file loads in both games.
//! What only the browser game has (its airline livery and designs, placed winds, airports built from scratch) is kept
//! in `State::browser` and written back on export, so a game can go back and forth without losing it.

use crate::data::data;
use crate::game::*;
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashMap};

/// The browser game's top-level keys this module reads or writes; any other key is carried over in `State::browser`.
const KNOWN: [&str; 30] = [
    "version", "mode", "difficulty", "story", "home", "localCurfew", "company", "time", "money", "slots", "planes",
    "crews", "fares", "carriedToday", "today", "history", "log", "market", "effects", "news", "infra", "projects",
    "fees", "rep", "slotBuys", "offers", "gameOver", "airportOps", "rivals", "devUsed",
];

/// A browser game save (rather than one of this app's)?
pub fn is_browser(v: &Value) -> bool {
    ["crews", "carriedToday", "gameOver", "slotBuys"].iter().any(|k| v.get(k).is_some())
}

/// A save file's text, from either game. Returns the state and, for a browser save, what could not come along.
pub fn read(text: &str) -> Result<(State, Vec<String>), String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("Not a save game: {e}"))?;
    if is_browser(&v) {
        if !v["planes"].is_array() || !v["slots"].is_object() || !v["time"].is_number() {
            return Err("That is not a Flightgame save file.".into());
        }
        let mut s = from_browser(&v);
        let mut notes = sanitize(&mut s);
        let dropped = arr(&v["planes"]).len() - s.planes.len();
        if dropped > 0 {
            notes.push(format!("{dropped} plane(s) of a type this version doesn't have"));
        }
        Ok((s, notes))
    } else {
        let s: State = serde_json::from_value(v).map_err(|e| format!("Not a save game: {e}"))?;
        Ok((s, Vec::new()))
    }
}

// ---------- small readers (the browser's numbers may be fractions or missing) ----------

fn f(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}
fn of(v: &Value) -> Option<f64> {
    v.as_f64()
}
fn i(v: &Value) -> i64 {
    v.as_f64().map(|x| x.round() as i64).unwrap_or(0)
}
fn oi(v: &Value) -> Option<i64> {
    v.as_f64().map(|x| x.round() as i64)
}
fn u(v: &Value) -> u32 {
    i(v).max(0) as u32
}
fn s(v: &Value) -> String {
    v.as_str().unwrap_or("").to_string()
}
fn os(v: &Value) -> Option<String> {
    v.as_str().filter(|x| !x.is_empty()).map(String::from)
}
fn b(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(x) => *x,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(x) => !x.is_empty(),
        _ => true,
    }
}
fn arr(v: &Value) -> &[Value] {
    v.as_array().map(|a| a.as_slice()).unwrap_or(&[])
}
fn obj(v: &Value) -> impl Iterator<Item = (&String, &Value)> {
    v.as_object().into_iter().flat_map(|m| m.iter())
}

fn flight_kind(v: &Value) -> FlightKind {
    match v.as_str() {
        Some("ferry") => FlightKind::Ferry,
        Some("delivery") => FlightKind::Delivery,
        _ => FlightKind::Scheduled,
    }
}
fn flight_kind_str(k: FlightKind) -> &'static str {
    match k {
        FlightKind::Scheduled => "scheduled",
        FlightKind::Ferry => "ferry",
        FlightKind::Delivery => "delivery",
    }
}
fn log_kind(v: &Value) -> LogKind {
    match v.as_str() {
        Some("good") => LogKind::Good,
        Some("bad") => LogKind::Bad,
        Some("cost") => LogKind::Cost,
        Some("summary") => LogKind::Summary,
        _ => LogKind::Info,
    }
}
fn log_kind_str(k: LogKind) -> &'static str {
    match k {
        LogKind::Info => "info",
        LogKind::Good => "good",
        LogKind::Bad => "bad",
        LogKind::Cost => "cost",
        LogKind::Summary => "summary",
    }
}

fn tally(v: &Value, key: &str) -> Tally {
    Tally {
        week: i(&v[key]),
        rev: f(&v["rev"]),
        cost: f(&v["cost"]),
        fixed: f(&v["fixed"]),
        repair: f(&v["repair"]),
        flights: u(&v["flights"]),
        pax: u(&v["pax"]),
        seats: u(&v["seats"]),
        km: f(&v["km"]),
    }
}
fn tally_json(t: &Tally, key: &str) -> Value {
    json!({ "rev": t.rev, "cost": t.cost, "fixed": t.fixed, "repair": t.repair, "flights": t.flights, "pax": t.pax,
        "seats": t.seats, "km": t.km, key: t.week })
}

// ---------- browser → this app ----------

fn from_browser(v: &Value) -> State {
    let crews: HashMap<String, &Value> = arr(&v["crews"]).iter().map(|c| (s(&c["id"]), c)).collect();
    let planes = arr(&v["planes"])
        .iter()
        .filter(|p| data().try_ac(p["type"].as_str().unwrap_or("")).is_some())
        .map(|p| plane_from(p, crews.get(p["crewId"].as_str().unwrap_or("")).copied()))
        .collect();
    let mut extra = Map::new();
    for (k, x) in obj(v) {
        if !KNOWN.contains(&k.as_str()) {
            extra.insert(k.clone(), x.clone());
        }
    }
    State {
        version: 1,
        mode: v["mode"].as_str().unwrap_or("arcade").into(),
        difficulty: v["difficulty"].as_str().unwrap_or("normal").into(),
        home: s(&v["home"]),
        company: s(&v["company"]),
        time: i(&v["time"]),
        money: f(&v["money"]),
        slots: obj(&v["slots"])
            .map(|(code, sl)| {
                let by_class: Vec<u32> = arr(&sl["byClass"]).iter().map(u).collect();
                (code.clone(), SlotHolding { since: i(&sl["since"]), count: u(&sl["count"]).max(1), by_class })
            })
            .collect(),
        planes,
        fares: obj(&v["fares"]).map(|(k, x)| (k.clone(), f(x))).collect(),
        carried_today: obj(&v["carriedToday"]).map(|(k, x)| (k.clone(), u(x))).collect(),
        today: Today {
            revenue: f(&v["today"]["revenue"]),
            cost: f(&v["today"]["cost"]),
            fixed: f(&v["today"]["fixed"]),
            flights: u(&v["today"]["flights"]),
            pax: u(&v["today"]["pax"]),
        },
        history: arr(&v["history"])
            .iter()
            .map(|h| DayRecord {
                day: i(&h["day"]),
                revenue: f(&h["revenue"]),
                cost: f(&h["cost"]),
                fixed: f(&h["fixed"]),
                flights: u(&h["flights"]),
                pax: u(&h["pax"]),
                cash: f(&h["cash"]),
            })
            .collect(),
        log: arr(&v["log"]).iter().map(|l| LogEntry { t: i(&l["t"]), msg: s(&l["msg"]), kind: log_kind(&l["kind"]) }).collect(),
        market: Market {
            listings: arr(&v["market"]["listings"])
                .iter()
                .map(|l| Listing { id: s(&l["id"]), kind: s(&l["type"]), age: i(&l["age"]), price: f(&l["price"]), at: s(&l["at"]) })
                .collect(),
            next_id: u(&v["market"]["nextId"]).max(1),
        },
        effects: arr(&v["effects"]).iter().map(effect_from).collect(),
        news: arr(&v["news"])
            .iter()
            .map(|n| Story {
                good: n["kind"] == "good",
                headline: s(&n["headline"]),
                sub: s(&n["sub"]),
                body: s(&n["body"]),
                paper: s(&n["paper"]),
                t: i(&n["t"]),
            })
            .collect(),
        rivals: arr(&v["rivals"])
            .iter()
            .map(|r| Rival {
                id: s(&r["id"]),
                name: s(&r["name"]),
                kind: s(&r["kind"]),
                hubs: arr(&r["hubs"]).iter().map(s).collect(),
                color: s(&r["color"]),
                routes: arr(&r["routes"])
                    .iter()
                    .map(|x| RivalRoute {
                        a: s(&x["a"]),
                        b: s(&x["b"]),
                        kind: s(&x["type"]),
                        seats: u(&x["seats"]),
                        per_day: u(&x["perDay"]).max(1),
                        fare: of(&x["fare"]).unwrap_or(1.0),
                        since: i(&x["since"]),
                        weak: u(&x["weak"]),
                        value: f(&x["value"]),
                    })
                    .collect(),
                since: i(&r["since"]),
            })
            .collect(),
        rep: Rep {
            flown: u(&v["rep"]["flown"]),
            on_time: f(&v["rep"]["onTime"]),
            late: f(&v["rep"]["late"]),
            crashes: arr(&v["rep"]["crashes"]).iter().map(i).collect(),
            incidents: arr(&v["rep"]["incidents"]).iter().map(i).collect(),
        },
        slot_buys: obj(&v["slotBuys"])
            .map(|(code, m)| (code.clone(), obj(m).map(|(h, n)| (h.clone(), u(n))).collect()))
            .collect(),
        infra: obj(&v["infra"])
            .map(|(code, x)| {
                let runways = x["runways"].as_array().map(|rws| {
                    rws.iter()
                        .map(|r| {
                            let mut o = [0.0, 0.0, 0.0, 0.0, 45.0, 1.0];
                            for (k, n) in arr(r).iter().take(6).enumerate() {
                                o[k] = f(n);
                            }
                            o
                        })
                        .collect()
                });
                (code.clone(), Infra { stake: u(&x["stake"]), terminal: u(&x["terminal"]), runways, invested: f(&x["invested"]) })
            })
            .collect(),
        airport_ops: obj(&v["airportOps"]).map(|(code, ops)| (code.clone(), arr(ops).to_vec())).collect(),
        fees: obj(&v["fees"]).map(|(k, x)| (k.clone(), f(x))).collect(),
        projects: arr(&v["projects"])
            .iter()
            .map(|p| Project {
                code: s(&p["code"]),
                kind: s(&p["kind"]),
                len: f(&p["len"]),
                label: s(&p["label"]),
                cost: f(&p["cost"]),
                full: f(&p["full"]),
                start: i(&p["start"]),
                done: i(&p["done"]),
                // (an extension's geometry is worked out again when it is done, by both games)
                geo: match (&p["geo"]["runway"], &p["geo"]["ops"]) {
                    _ if p["kind"] == "extend" => None,
                    (r @ Value::Array(_), _) => Some(r.clone()),
                    (_, o @ Value::Array(_)) => Some(o.clone()),
                    _ => None,
                },
            })
            .collect(),
        offers: obj(&v["offers"]).map(|(k, x)| (k.clone(), i(x))).collect(),
        game_over: b(&v["gameOver"]),
        dev_used: b(&v["devUsed"]),
        story: v["story"].is_object().then(|| StoryYears { start: i(&v["story"]["start"]) as i32, year: i(&v["story"]["year"]) as i32 }),
        browser: (!extra.is_empty()).then_some(Value::Object(extra)),
    }
}

fn plane_from(p: &Value, crew: Option<&Value>) -> Plane {
    let kind = s(&p["type"]);
    let st = &p["stats"];
    let sch = &p["schedule"];
    let flight = p["flight"].is_object().then(|| {
        let x = &p["flight"];
        Flight {
            from: s(&x["from"]),
            to: s(&x["to"]),
            kind: flight_kind(&x["kind"]),
            dep: i(&x["dep"]),
            arr: i(&x["arr"]),
            distance: f(&x["distance"]),
            pax: u(&x["pax"]),
            revenue: f(&x["revenue"]),
            cost: f(&x["cost"]),
            crash_at: oi(&x["crashAt"]),
            incident: b(&x["incident"]),
            emergency_at: oi(&x["emergencyAt"]),
            emergency: os(&x["emergency"]),
            rw_from: os(&x["rw"]["from"]),
            rw_to: os(&x["rw"]["to"]),
        }
    });
    let crew = match crew {
        Some(c) => Crew {
            pilots: u(&c["pilots"]),
            cabin: u(&c["cabin"]),
            weekly_salary: f(&c["weeklySalary"]),
            sets: u(&c["sets"]).max(1),
            duty_today: i(&c["dutyToday"]),
        },
        None => crew_for(&kind),
    };
    // the year so far and the year before
    let mut years = Vec::new();
    for k in ["last", "year"] {
        if st[k].is_object() {
            years.push(tally(&st[k], "y"));
        }
    }
    Plane {
        id: s(&p["id"]),
        name: os(&p["name"]),
        location: s(&p["location"]),
        status: match p["status"].as_str() {
            Some("flying") => Status::Flying,
            Some("turnaround") => Status::Turnaround,
            _ => Status::Idle,
        },
        ownership: if p["ownership"] == "owned" { Ownership::Owned } else { Ownership::Leased },
        age: f(&p["age"]),
        acquired_at: i(&p["acquiredAt"]),
        ready_at: i(&p["readyAt"]),
        flight,
        pending_ferry: os(&p["pendingFerry"]),
        wait_slot: os(&p["waitSlot"]),
        repair: b(&p["repair"]),
        schedule: Schedule {
            stops: arr(&sch["stops"]).iter().map(s).collect(),
            legs: arr(&sch["legs"]).iter().map(|l| Leg { from: s(&l["from"]), to: s(&l["to"]), dep: i(&l["dep"]) }).collect(),
            index: u(&sch["index"]) as usize,
            active: b(&sch["active"]),
            due: i(&sch["due"]),
            days: u(&sch["days"]),
            offset: i(&sch["offset"]),
        },
        crew,
        stats: Stats {
            flights: u(&st["flights"]),
            pax: i(&st["pax"]).max(0) as u64,
            seats: i(&st["seats"]).max(0) as u64,
            rev: f(&st["rev"]),
            cost: f(&st["cost"]),
            fixed: f(&st["fixed"]),
            repair: f(&st["repair"]),
            km: f(&st["km"]),
            mins: i(&st["mins"]),
            on_time: u(&st["onTime"]),
            late: u(&st["late"]),
            incidents: u(&st["incidents"]),
            ferries: u(&st["ferries"]),
            weeks: arr(&st["weeks"]).iter().map(|w| tally(w, "w")).collect(),
            years,
            recent: arr(&st["recent"])
                .iter()
                .map(|r| Recent {
                    t: i(&r["t"]),
                    from: s(&r["from"]),
                    to: s(&r["to"]),
                    kind: flight_kind(&r["kind"]),
                    pax: u(&r["pax"]),
                    seats: u(&r["seats"]),
                    result: f(&r["result"]),
                })
                .collect(),
        },
        runways: obj(&p["runways"]).filter_map(|(k, x)| os(x).map(|x| (k.clone(), x))).collect(),
        livery: os(&p["livery"]),
        kind,
    }
}

fn effect_from(e: &Value) -> Effect {
    let w = &e["where"];
    let near = w["near"].is_object().then(|| (f(&w["near"]["lat"]), f(&w["near"]["lon"])));
    Effect {
        label: s(&e["label"]),
        until: i(&e["until"]),
        at: Where {
            all: b(&w["all"]),
            airport: os(&w["airport"]),
            country: os(&w["country"]),
            near,
            radius_km: of(&w["radiusKm"]).unwrap_or(if near.is_some() { 400.0 } else { 0.0 }),
        },
        demand_mult: of(&e["demandMult"]),
        cost_mult: of(&e["costMult"]),
        no_flights: b(&e["noFlights"]),
        storm: e["weather"] == "storm" || s(&e["label"]).starts_with("Storm "),
    }
}

/// What this app's world doesn't know (airports built from scratch in the browser game, aircraft types newer than
/// this build) is left out or sent home. Returns what was changed, for the log.
fn sanitize(st: &mut State) -> Vec<String> {
    let d = data();
    let known = |c: &str| d.try_airport(c).is_some();
    let mut notes = Vec::new();
    let home = st.home.clone();
    if !known(&home) {
        notes.push(format!("the home airport {home} is not in this version's world"));
        return notes;
    }
    for p in &mut st.planes {
        let mut moved = false;
        if p.flight.as_ref().is_some_and(|f| !known(&f.from) || !known(&f.to)) {
            p.flight = None;
            p.status = Status::Idle;
            moved = true;
        }
        if !known(&p.location) {
            p.location = home.clone();
            p.status = Status::Idle;
            p.flight = None;
            moved = true;
        }
        if p.schedule.stops.iter().any(|c| !known(c)) || p.schedule.legs.iter().any(|l| !known(&l.from) || !known(&l.to)) {
            p.schedule = Schedule::default();
            notes.push(format!("{}'s timetable went to an airport this version doesn't have", p.id));
        }
        if moved {
            notes.push(format!("{} was at an airport this version doesn't have and is back home", p.id));
        }
        if p.pending_ferry.as_deref().is_some_and(|c| !known(c)) {
            p.pending_ferry = None;
        }
        if p.wait_slot.as_deref().is_some_and(|c| !known(c)) {
            p.wait_slot = None;
        }
    }
    let n = st.slots.len();
    st.slots.retain(|c, _| known(c));
    if st.slots.len() < n {
        notes.push(format!("{} slot(s) at airports this version doesn't have", n - st.slots.len()));
    }
    st.slots.entry(home.clone()).or_insert(SlotHolding { since: 0, count: 1, by_class: Vec::new() });
    st.infra.retain(|c, _| known(c));
    st.airport_ops.retain(|c, _| known(c));
    st.fees.retain(|c, _| known(c));
    st.slot_buys.retain(|c, _| known(c));
    st.projects.retain(|p| known(&p.code));
    st.market.listings.retain(|l| known(&l.at) && d.try_ac(&l.kind).is_some());
    for r in &mut st.rivals {
        r.hubs.retain(|c| known(c));
        r.routes.retain(|x| known(&x.a) && known(&x.b) && d.try_ac(&x.kind).is_some());
    }
    st.rivals.retain(|r| !r.hubs.is_empty());
    notes
}

// ---------- this app → browser ----------

/// The game in the browser game's save format (Menu → Save to file): it loads in the browser game and here.
pub fn to_browser(st: &State) -> Value {
    let mut out = match &st.browser {
        Some(Value::Object(m)) => m.clone(),
        _ => Map::new(),
    };
    let crews: Vec<Value> = st
        .planes
        .iter()
        .map(|p| {
            json!({ "id": format!("crew-{}", p.id), "name": format!("Crew {}", p.id), "base": st.home,
                "pilots": p.crew.pilots, "cabin": p.crew.cabin, "weeklySalary": p.crew.weekly_salary,
                "sets": p.crew.sets.max(1), "dutyToday": p.crew.duty_today })
        })
        .collect();
    let planes: Vec<Value> = st.planes.iter().map(plane_json).collect();
    let effects: Vec<Value> = st
        .effects
        .iter()
        .map(|e| {
            let w = if let Some((lat, lon)) = e.at.near {
                json!({ "near": { "lat": lat, "lon": lon }, "radiusKm": e.at.radius_km })
            } else if let Some(a) = &e.at.airport {
                json!({ "airport": a })
            } else if let Some(c) = &e.at.country {
                json!({ "country": c })
            } else {
                json!({ "all": true })
            };
            let mut x = json!({ "label": e.label, "until": e.until, "where": w });
            if let Some(m) = e.demand_mult {
                x["demandMult"] = json!(m);
            }
            if let Some(m) = e.cost_mult {
                x["costMult"] = json!(m);
            }
            if e.no_flights {
                x["noFlights"] = json!(true);
            }
            if e.storm {
                x["weather"] = json!("storm");
            }
            x
        })
        .collect();
    let projects: Vec<Value> = st
        .projects
        .iter()
        .map(|p| {
            let mut x = json!({ "code": p.code, "kind": p.kind, "len": p.len, "label": p.label, "cost": p.cost,
                "full": p.full, "start": p.start, "done": p.done });
            // a placed runway is its 6 numbers, a building its list of fix ops
            match &p.geo {
                Some(Value::Array(a)) if a.len() == 6 && a.iter().all(|n| n.is_number()) => x["geo"] = json!({ "runway": a }),
                Some(Value::Array(a)) => x["geo"] = json!({ "ops": a }),
                _ => {}
            }
            x
        })
        .collect();
    let slots: BTreeMap<&String, Value> = st
        .slots
        .iter()
        .map(|(c, sl)| {
            let mut x = json!({ "since": sl.since, "count": sl.count });
            if sl.by_class.len() == 6 {
                x["byClass"] = json!(sl.by_class);
            }
            (c, x)
        })
        .collect();
    let infra: BTreeMap<&String, Value> = st
        .infra
        .iter()
        .map(|(c, x)| {
            let mut o = json!({ "stake": x.stake, "terminal": x.terminal, "invested": x.invested });
            if let Some(r) = &x.runways {
                o["runways"] = json!(r);
            }
            (c, o)
        })
        .collect();
    let known = json!({
        "version": 1,
        "mode": st.mode,
        "difficulty": st.difficulty,
        "story": st.story.as_ref().map(|y| json!({ "start": y.start, "year": y.year })),
        "home": st.home,
        "localCurfew": true,
        "company": st.company,
        "time": st.time,
        "money": st.money,
        "slots": slots,
        "planes": planes,
        "crews": crews,
        "fares": st.fares,
        "carriedToday": st.carried_today,
        "today": { "revenue": st.today.revenue, "cost": st.today.cost, "fixed": st.today.fixed,
            "flights": st.today.flights, "pax": st.today.pax },
        "history": st.history.iter().map(|h| json!({ "day": h.day, "revenue": h.revenue, "cost": h.cost, "fixed": h.fixed,
            "flights": h.flights, "pax": h.pax, "cash": h.cash })).collect::<Vec<_>>(),
        "log": st.log.iter().map(|l| json!({ "t": l.t, "msg": l.msg, "kind": log_kind_str(l.kind) })).collect::<Vec<_>>(),
        "market": { "listings": st.market.listings.iter().map(|l| json!({ "id": l.id, "type": l.kind, "age": l.age,
            "price": l.price, "at": l.at })).collect::<Vec<_>>(), "nextId": st.market.next_id },
        "effects": effects,
        "news": st.news.iter().map(|n| json!({ "kind": if n.good { "good" } else { "bad" }, "headline": n.headline,
            "sub": n.sub, "body": n.body, "paper": n.paper, "t": n.t })).collect::<Vec<_>>(),
        "infra": infra,
        "projects": projects,
        "fees": st.fees,
        "rep": { "flown": st.rep.flown, "onTime": st.rep.on_time, "late": st.rep.late, "crashes": st.rep.crashes,
            "incidents": st.rep.incidents },
        "slotBuys": st.slot_buys,
        "offers": st.offers,
        "gameOver": st.game_over,
        "devUsed": st.dev_used,
        "airportOps": st.airport_ops,
        "rivals": st.rivals.iter().map(|r| json!({ "id": r.id, "name": r.name, "kind": r.kind, "hubs": r.hubs,
            "color": r.color, "since": r.since, "routes": r.routes.iter().map(|x| json!({ "a": x.a, "b": x.b,
            "type": x.kind, "seats": x.seats, "perDay": x.per_day, "fare": x.fare, "since": x.since, "weak": x.weak,
            "value": x.value })).collect::<Vec<_>>() })).collect::<Vec<_>>(),
    });
    for (k, x) in known.as_object().unwrap() {
        out.insert(k.clone(), x.clone());
    }
    // the browser game expects these even when empty
    for k in ["built", "winds"] {
        out.entry(k).or_insert_with(|| json!([]));
    }
    Value::Object(out)
}

fn plane_json(p: &Plane) -> Value {
    let st = &p.stats;
    let year = st.years.last();
    let last = year.and_then(|y| st.years.iter().find(|x| x.week == y.week - 1));
    let mut sch = json!({ "stops": p.schedule.stops, "index": p.schedule.index, "active": p.schedule.active,
        "due": p.schedule.due,
        "legs": p.schedule.legs.iter().map(|l| json!({ "from": l.from, "to": l.to, "dep": l.dep })).collect::<Vec<_>>() });
    if p.schedule.days > 1 {
        sch["days"] = json!(p.schedule.days);
        sch["offset"] = json!(p.schedule.offset);
    }
    let flight = p.flight.as_ref().map(|x| {
        let mut o = json!({ "from": x.from, "to": x.to, "kind": flight_kind_str(x.kind), "dep": x.dep, "arr": x.arr,
            "distance": x.distance, "pax": x.pax, "revenue": x.revenue, "cost": x.cost });
        if let Some(t) = x.crash_at {
            o["crashAt"] = json!(t);
        }
        if x.incident {
            o["incident"] = json!(true);
        }
        if let Some(t) = x.emergency_at {
            o["emergencyAt"] = json!(t);
        }
        if let Some(e) = &x.emergency {
            o["emergency"] = json!(e);
        }
        if x.rw_from.is_some() || x.rw_to.is_some() {
            o["rw"] = json!({ "from": x.rw_from, "to": x.rw_to });
        }
        o
    });
    let mut o = json!({
        "id": p.id,
        "type": p.kind,
        "location": p.location,
        "status": match p.status { Status::Idle => "idle", Status::Flying => "flying", Status::Turnaround => "turnaround" },
        "ownership": if p.ownership == Ownership::Owned { "owned" } else { "leased" },
        "age": p.age,
        "acquiredAt": p.acquired_at,
        "readyAt": p.ready_at,
        "flight": flight,
        "pendingFerry": p.pending_ferry,
        "waitSlot": p.wait_slot,
        "repair": if p.repair { json!("repair") } else { Value::Null },
        "crewId": format!("crew-{}", p.id),
        "schedule": sch,
        "stats": {
            "flights": st.flights, "pax": st.pax, "profit": st.rev - st.cost, "rev": st.rev, "cost": st.cost,
            "fixed": st.fixed, "repair": st.repair, "seats": st.seats, "km": st.km, "mins": st.mins,
            "onTime": st.on_time, "late": st.late, "incidents": st.incidents, "ferries": st.ferries,
            "year": year.map(|t| tally_json(t, "y")), "last": last.map(|t| tally_json(t, "y")),
            "weeks": st.weeks.iter().map(|t| tally_json(t, "w")).collect::<Vec<_>>(),
            "recent": st.recent.iter().map(|r| json!({ "t": r.t, "from": r.from, "to": r.to,
                "kind": flight_kind_str(r.kind), "pax": r.pax, "seats": r.seats, "result": r.result })).collect::<Vec<_>>(),
        },
    });
    if let Some(n) = &p.name {
        o["name"] = json!(n);
    }
    if !p.runways.is_empty() {
        o["runways"] = json!(p.runways);
    }
    if let Some(l) = &p.livery {
        o["livery"] = json!(l);
    }
    o
}
