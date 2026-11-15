//! Prints the same numbers the browser game shows for its "European network" quick start, to compare the two
//! versions: `cargo run --release --example compare [days] [runs]`. With days > 0 it also plays that many game days
//! (`runs` times, averaged) and prints what came of it. Switches: EXTRAS=1 (ultra long-haul, story starters, an
//! airport value), PER_PLANE=1 (one run, each plane's flights), NO_RIVALS=1 (with PER_PLANE: without rivals).

use flightgame::config::*;
use flightgame::data::data;
use flightgame::game::*;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let days: i64 = args.get(1).and_then(|x| x.parse().ok()).unwrap_or(0);
    let runs: usize = args.get(2).and_then(|x| x.parse().ok()).unwrap_or(1);
    let pr = data().presets.iter().find(|p| p.id == "europe").expect("europe preset");
    let (g, errors) = Game::from_preset(pr);
    println!("errors {errors:?}");
    let (planes, crews, slots, total) = g.weekly_costs();
    println!("time {} money {} weekly planes {planes} crews {crews} slots {slots} total {total}", g.state.time, g.state.money);
    for (i, p) in g.state.planes.iter().enumerate() {
        let legs = &p.schedule.legs;
        let est = g.estimate_timetable(i, legs);
        println!(
            "{} {} n {} first {} {}-{} | {} {}-{} last {} block {} ta {} crew {} estPax {} estProfit {}",
            p.id,
            p.kind,
            legs.len(),
            fmt_clock(legs[0].dep),
            legs[0].from,
            legs[0].to,
            fmt_clock(legs[1].dep),
            legs[1].from,
            legs[1].to,
            fmt_clock(legs[legs.len() - 1].dep),
            leg_block(&p.kind, &legs[0].from, &legs[0].to),
            turnaround_min(&p.kind),
            p.crew.sets,
            est.pax,
            est.profit.round()
        );
    }
    for c in ["ZRH", "LHR", "CDG", "BCN", "FCO", "AMS", "VIE", "MAD", "BER", "CPH", "BRN", "JFK", "SIN"] {
        let a = data().airport(c);
        println!(
            "{c} size {} catch {} cap {} maxClass {} rw {} ahead {} fee {}",
            airport_size(c),
            a.catchment,
            g.slot_capacity(c),
            max_class(c),
            longest_runway(c, true),
            g.ahead_of(c),
            landing_fee(c)
        );
    }
    for (a, b) in [
        ("ZRH", "LHR"), ("ZRH", "CDG"), ("ZRH", "BCN"), ("ZRH", "FCO"), ("ZRH", "AMS"), ("ZRH", "VIE"), ("ZRH", "MAD"),
        ("ZRH", "BER"), ("BER", "CPH"), ("CPH", "ZRH"), ("BRN", "VIE"), ("ZRH", "JFK"),
    ] {
        println!(
            "{a}-{b} daily {} pax {} fare {} dist {}",
            daily_demand(a, b),
            g.pax_demand(a, b, 0.0),
            g.fare(a, b),
            data().dist(a, b).round()
        );
    }
    let rivals: Vec<String> =
        g.state.rivals.iter().map(|r| format!("{}({},{},{})", r.name, r.kind, r.hubs.join("/"), r.routes.len())).collect();
    println!("rivals {}", rivals.join("; "));
    if std::env::var_os("EXTRAS").is_some() {
        let legs = g.build_long_timetable("A350-900", &["LAX".to_string(), "SIN".to_string()], 420, 1);
        let l: Vec<String> = legs.iter().map(|l| format!("{} {}-{}", l.dep, l.from, l.to)).collect();
        println!("ultra {} {} {} legs {:?} days {}", ultra_capable("A350-900"), ultra_capable("A220-300"), ultra_capable("B777-300ER"), l, cycle_days("A350-900", &legs));
        for y in [1960, 1985, 2010] {
            println!("starters {y} {:?}", starter_types(Some(y)));
        }
        println!("BRN value {}", g.airport_value("BRN"));
        return;
    }
    if std::env::var_os("PER_PLANE").is_some() {
        let (mut g, _) = Game::from_preset(pr);
        if std::env::var_os("NO_RIVALS").is_some() {
            let mut st = g.state.clone();
            st.rivals.clear();
            g = Game::from_state(st);
        }
        g.advance(days * DAY);
        for p in &g.state.planes {
            println!("{} {} on {} late {}", p.id, p.stats.flights, p.stats.on_time, p.stats.late);
        }
        println!("money {:.0} pax {}", g.state.money, g.state.planes.iter().map(|p| p.stats.pax).sum::<u64>());
        return;
    }
    if days == 0 {
        return;
    }
    let (mut money, mut flights, mut pax, mut inc, mut crashes, mut events, mut on_time) = (0.0, 0, 0, 0, 0, 0, 0.0);
    for _ in 0..runs {
        let (mut g, _) = Game::from_preset(pr);
        g.advance(days * DAY);
        money += g.state.money;
        flights += g.state.planes.iter().map(|p| p.stats.flights).sum::<u32>() as usize;
        pax += g.state.planes.iter().map(|p| p.stats.pax).sum::<u64>() as usize;
        inc += g.state.planes.iter().map(|p| p.stats.incidents).sum::<u32>() as usize;
        crashes += g.state.rep.crashes.len();
        events += g.state.news.len();
        let n = g.state.planes.iter().map(|p| (p.stats.on_time + p.stats.late) as f64).sum::<f64>();
        on_time += g.state.planes.iter().map(|p| p.stats.on_time as f64).sum::<f64>() / n.max(1.0);
    }
    let r = runs as f64;
    println!(
        "after {days} days (mean of {runs}): money {:.0} flights {:.1} pax {:.0} incidents {:.2} crashes {:.2} news {:.1} onTime {:.3}",
        money / r,
        flights as f64 / r,
        pax as f64 / r,
        inc as f64 / r,
        crashes as f64 / r,
        events as f64 / r,
        on_time / r
    );
}
