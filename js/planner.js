// Sidebar sections for planning: the day's timetable of every plane (Schedule), what fills each slot
// (Slots) and the airports you fly to or own something at (Airports). ui.js renders them and passes
// clicks on [data-pl] elements to FG.planner.action().
(function () {
  const G = FG.game;
  const C = FG.config;
  const D = FG.data;
  const DAY = 1440;
  const pad = (n) => String(n).padStart(2, '0');
  const clock = (m) => `${pad(Math.floor((((m % DAY) + DAY) % DAY) / 60))}:${pad(Math.round(m) % 60)}`;
  const parseClock = (s) => { const [h, m] = String(s).split(':').map(Number); return ((h || 0) * 60 + (m || 0)) % DAY; };
  const pct = (m) => `${(m / DAY) * 100}%`;
  const nameOf = (id) => { const q = G.plane(id); return q ? G.planeName(q) : id; };

  const pl = {
    edit: null,       // plane whose timetable is open in the editor
    draft: null,      // { stops, first, rounds, legs, ultra } being edited (ultra: an ultra long-haul timetable)
    slotAt: null,     // airport shown in the Slots section
    open: {},         // airport code -> expanded in the Airports section
    offer: {},        // 'code|holder' -> amount of the offer being made
    lastClick: { key: null, t: 0 }, // for double clicks that survive a re-render
  };
  let ctx = null; // helpers from ui.js: { ui, toast, planeGlyph, fmtPop, setTab, selectAirport, selectPlane }

  // Day axis with hours, the night curfew and the current time.
  function axis() {
    let h = '<div class="tl-axis">';
    for (let hr = 0; hr <= 24; hr += 3) h += `<span style="left:${pct(hr * 60)}">${pad(hr)}</span>`;
    return h + '</div>';
  }
  function nightAndNow() {
    const now = G.state.time % DAY;
    return `<i class="tl-night" style="left:0;width:${pct(C.curfew.start)}"></i>
      <i class="tl-night" style="left:${pct(C.curfew.end)};width:${pct(DAY - C.curfew.end)}"></i>
      <i class="tl-now" style="left:${pct(now)}"></i>`;
  }

  // Days a draft's timetable takes before it repeats (an ultra long-haul one can take several).
  const daysOf = (p, d) => (d.ultra && d.legs.length ? G.cycleDays(p.type, d.legs) : 1);

  // Flight blocks and ground blocks of one plane's day.
  function dayBlocks(p, legs, draft, days = 1) {
    if (days > 1) return roundBlocks(p, legs, draft, days);
    let h = '';
    for (const g of G.groundTimes(p.type, legs)) {
      h += `<b class="tl-ground" style="left:${pct(g.from)};width:${pct(g.to - g.from)}" data-pl="slotAt" data-code="${g.code}"
        title="${g.code}: on the ground ${clock(toLocal(g.code, g.arr))}–${clock(toLocal(g.code, g.dep))} local (takes a slot) · double-click for the slot">${g.to - g.from >= 50 ? g.code : ''}</b>`;
    }
    for (const l of legs) {
      const block = G.legBlock(p.type, l.from, l.to);
      const dep = l.dep % DAY; // (an ultra long-haul draft that fits into a day can count past midnight)
      const parts = dep + block > DAY ? [[dep, DAY - dep], [0, dep + block - DAY]] : [[dep, block]];
      for (const [s, w] of parts) {
        h += `<b class="tl-flight${draft ? ' draft' : ''}" style="left:${pct(s)};width:${pct(w)}"
          title="${clock(toLocal(l.from, l.dep))} ${l.from} → ${l.to} ${clock(toLocal(l.to, l.dep + block))} (local times) · ${G.fmtDuration(block)}">${w >= 70 ? `${l.from}›${l.to}` : ''}</b>`;
      }
    }
    return h;
  }
  // An ultra long-haul timetable: each day of its round as a lane of its own (the first on top), on the same clock.
  function roundBlocks(p, legs, draft, days) {
    let h = '';
    const piece = (cls, from, to, attrs, label) => {
      for (let t = from; t < to;) {
        const k = Math.floor(t / DAY) % days;
        const end = Math.min(to, (Math.floor(t / DAY) + 1) * DAY);
        const w = end - t;
        h += `<b class="${cls}" style="--k:${k};left:${pct(t % DAY)};width:${pct(w)}" ${attrs}>${w >= 70 ? label : ''}</b>`;
        t = end;
      }
    };
    legs.forEach((l, i) => {
      const block = G.legBlock(p.type, l.from, l.to);
      const next = i + 1 < legs.length ? legs[i + 1].dep : legs[0].dep + days * DAY;
      const arr = l.dep + block;
      piece('tl-ground', arr + 0, next, `data-pl="slotAt" data-code="${l.to}" title="${l.to}: on the ground ${G.fmtLegDep(arr, days, l.to)}–${G.fmtLegDep(next % (days * DAY), days, l.to)} local (takes a slot) · double-click for the slot"`, l.to);
      piece(`tl-flight${draft ? ' draft' : ''}`, l.dep, arr, `title="${G.fmtLegDep(l.dep, days, l.from)} ${l.from} → ${l.to} ${G.fmtLegDep(arr, days, l.to)} (local times) · ${G.fmtDuration(block)}"`, `${l.from}›${l.to}`);
    });
    return h;
  }

  // ---------- Schedule ----------
  function scheduleTab() {
    const s = G.state;
    let h = `<div class="panel"><h3>Timetables</h3>
      <ol class="howto">
        <li><b>Click a plane</b> to plan its day.</li>
        <li><b>Pick its airports</b>. You need a slot at each one, and the route loops back to the start.</li>
        <li><b>Drag the start time</b> until its slot bars show no red (or press ✨), then <b>Save & fly</b>.</li>
      </ol>
      <div class="muted">Blue = flying · grey = on the ground (in one of your slots) · striped = night at your home base. The bars
      run on your home base's clock; times written out are local at each airport, and so is its night curfew (no departures ${clock(C.curfew.end)}–${clock(C.curfew.start)}).</div>
      <div class="timeline">${axis()}`;
    for (const p of s.planes) {
      const sch = p.schedule;
      const editing = pl.edit === p.id;
      const legs = editing && pl.draft ? pl.draft.legs : sch.legs || [];
      const days = editing && pl.draft ? daysOf(p, pl.draft) : sch.days || 1;
      let bar;
      if (legs.length) bar = dayBlocks(p, legs, editing, days);
      else bar = `<span class="tl-text">no timetable · parked at ${p.status === 'flying' && p.flight ? p.flight.to : p.location} · click to plan</span>`;
      const state = !sch.legs && !editing ? '' : p.waitSlot ? '<em class="neg" title="Waiting for a free slot">⏳</em>' : sch.active ? '<em class="pos" title="Flying its timetable">●</em>' : '<em class="muted" title="Paused">⏸</em>';
      h += `<div class="tl-row${editing ? ' editing' : ''}" data-pl="edit" data-plane="${p.id}">
        <div class="tl-label"><span class="type-icon">${ctx.planeGlyph(p.type)}</span>${G.planeName(p)} ${state}<small>${p.name ? `${p.id} · ` : ''}${p.type}${days > 1 ? ` · <span title="Ultra long-haul: repeats every ${days} days">🌏 ${days}d</span>` : ''}</small></div>
        <div class="tl-bar${days > 1 ? ' days' : ''}" style="--n:${days}">${nightAndNow()}${bar}</div></div>`;
    }
    h += `</div></div>`;
    // (the timetable being planned is in its own window, js/planewin.js)
    const p = pl.edit && G.plane(pl.edit);
    if (p && !FG.planeWin) h += editor(p);
    return h;
  }

  function startDraft(p) {
    const sch = p.schedule;
    const legs = sch.legs ? sch.legs.map((l) => ({ ...l })) : [];
    const at = p.status === 'flying' && p.flight ? p.flight.to : p.location;
    const stops = sch.legs ? loopOf(sch.legs) : G.ownsSlot(at) ? [at] : [];
    const first = legs.length ? legs[0].dep : toHome(stops[0], C.curfew.start + 60);
    pl.draft = { stops, first, rounds: 0, legs, ultra: (sch.days || 1) > 1 };
    if (!legs.length && stops.length >= 2) rebuild(p);
  }

  // The shortest repeating loop in a timetable (BRN LHR BRN LHR → BRN LHR).
  function loopOf(legs) {
    const stops = legs.map((l) => l.from);
    for (let n = 2; n <= stops.length; n++) {
      if (stops.length % n === 0 && stops.every((c, i) => c === stops[i % n])) return stops.slice(0, n);
    }
    return stops;
  }

  // The first departure is set in local time at the first stop (its curfew is): d.first stays in home-base time.
  const norm = (m) => ((m % DAY) + DAY) % DAY;
  const aheadAt = (code) => (code ? G.aheadOf(code, G.state.time) : 0);
  const toLocal = (code, m) => norm(m + aheadAt(code));
  const toHome = (code, m) => norm(m - aheadAt(code));

  function rebuild(p) {
    const d = pl.draft;
    d.legs = d.ultra ? G.buildLongTimetable(p.type, d.stops, d.first, d.rounds || 1) : G.buildTimetable(p.type, d.stops, d.first, d.rounds);
  }
  // One round of the loop, turnarounds included (a daily timetable must fit it into the day).
  const roundMin = (p, stops) => stops.reduce((n, c, i) => n + G.legBlock(p.type, c, stops[(i + 1) % stops.length]) + G.turnaroundMin(p.type), 0);

  // "local at JFK · 12:00 your time" (nothing where the first stop keeps the home base's clock)
  function firstNote(d) {
    const c = d.stops[0];
    return c && aheadAt(c) ? `local at ${c} · ${clock(d.first)} your time` : '';
  }

  function editor(p) {
    const d = pl.draft;
    const ac = D.aircraft[p.type];
    const owned = Object.keys(G.state.slots);
    const last = d.stops[d.stops.length - 1];
    const days = daysOf(p, d);
    const errors = d.legs.length ? G.checkTimetable(p.id, d.legs, days) : [];
    const ultraOk = G.ultraCapable(p.type);
    // Airports you can add: every one with your slot; ones the plane can't reach or land at are shown greyed.
    const options = owned.filter((c) => c !== last).map((c) => {
      const why = !G.fitsAirport(p.type, c) ? 'runway too short' : last && G.dist(last, c) > ac.rangeKm ? 'out of range' : '';
      return `<option value="${c}"${why ? ' disabled' : ''}>${c} · ${G.airportByCode[c].city}${last ? ` · ${Math.round(G.dist(last, c))} km` : ''}${why ? ` (${why})` : ''}</option>`;
    }).join('');
    const where = p.status === 'flying' && p.flight ? `flying to ${p.flight.to}` : `at ${p.location}`;
    let h = `<div class="panel plan"><h3>${G.planeLabel(p)} <span class="muted">${ac.name} · ${ac.seats} seats · ${ac.rangeKm} km range · ${where}</span></h3>
      <div class="label">1 · Where does it fly? <span class="muted">(the last stop flies back to the first)</span></div>
      <div class="chips stops-chips">${d.stops.map((c, i) => `<span class="chip">${c}
        ${i ? `<button class="mini" data-pl="stopUp" data-i="${i}" title="Earlier">↑</button>` : ''}
        <button class="mini" data-pl="stopDel" data-i="${i}" title="Remove">✕</button></span>`).join('<span class="arrow">→</span>')}
        ${d.stops.length >= 2 ? `<span class="arrow">↺ ${d.stops[0]}</span>` : ''}
        <select id="pl-add"><option value="">+ add airport…</option>${options}</select></div>
      ${owned.length < 2 ? '<div class="hint">You only have one slot. Click another airport on the map and lease a slot there first.</div>' : ''}
      ${ultraOk || d.ultra ? `<label class="row pl-ultra" title="For routes whose round trip takes longer than a day: the timetable repeats every few days instead of every day">
        <input type="checkbox" id="pl-ultra"${d.ultra ? ' checked' : ''}> 🌏 <b>Ultra long-haul</b> <span class="muted">– the timetable may run over several days
        ${d.ultra && d.legs.length ? `(this one: every ${days} day${days === 1 ? '' : 's'})` : ''}</span></label>` : ''}
      <div class="label">2 · When does its ${d.ultra ? 'round' : 'day'} start? <span class="muted">(drag, and watch the slots below)</span></div>
      <div class="row pl-when"><button class="mini" data-pl="firstStep" data-by="-5" title="5 min earlier">−</button>
        <input type="range" id="pl-first-range" min="${C.curfew.start}" max="${C.curfew.end}" step="5" value="${toLocal(d.stops[0], d.first)}">
        <button class="mini" data-pl="firstStep" data-by="5" title="5 min later">+</button>
        <input type="time" id="pl-first" step="300" value="${clock(toLocal(d.stops[0], d.first))}" title="Local time at the first airport">
        <span class="muted" id="pl-first-home">${firstNote(d)}</span>
        Loops <select id="pl-rounds">${d.ultra ? '' : `<option value="0"${d.rounds ? '' : ' selected'}>as many as fit</option>`}
        ${[1, 2, 3, 4, 5, 6, 8].map((n) => `<option value="${n}"${(d.rounds || (d.ultra ? 1 : 0)) === n ? ' selected' : ''}>${n}×</option>`).join('')}</select></div>
      ${d.stops.length >= 2 ? `<div class="row"><button class="primary" data-pl="fit" title="Tries every start time and every stop as the place it spends the night">✨ Find a time that fits the slots</button></div>` : ''}
      <div id="pl-fit">${fitView(p, d)}</div>`;
    if (d.legs.length) {
      const est = G.estimateTimetable(p.type, d.legs, G.costMult(p));
      // (times in the table are local at the airport: the departure at the one it leaves, the arrival where it lands)
      const n = days * DAY;
      const local = (code, m) => (((m + aheadAt(code)) % n) + n) % n;
      const dayOf = (m) => (days > 1 ? `<small class="muted">day ${Math.floor(m / DAY) + 1}</small> ` : '');
      const zone = (code) => (aheadAt(code) ? ` <small class="muted">${G.fmtZone(code, G.state.time)}</small>` : '');
      h += `<table class="small legs"><tr><th title="Local time at the airport it leaves">dep (local)</th><th>flight</th><th title="Local time at the airport it lands at">arr (local)</th><th>pax</th><th>result</th><th></th></tr>`;
      est.rows.forEach((r, i) => {
        const dep = local(r.from, r.dep), arr = local(r.to, r.arr);
        h += `<tr><td class="nowrap">${dayOf(dep)}<button class="mini" data-pl="shift" data-i="${i}" data-by="-15">−</button>
          <input type="time" class="pl-dep" data-i="${i}" step="300" value="${clock(dep)}" title="Local time at ${r.from}${aheadAt(r.from) ? ` (${clock(r.dep)} your time)` : ''}">
          <button class="mini" data-pl="shift" data-i="${i}" data-by="15">+</button>${zone(r.from)}</td>
          <td>${r.from} → ${r.to} <span class="muted">${G.fmtDuration(r.block)}</span></td><td class="nowrap" title="${aheadAt(r.to) ? `${clock(r.arr)} your time` : ''}">${dayOf(arr)}${clock(arr)}${zone(r.to)}</td>
          <td>${r.pax}/${r.seats}</td><td class="${r.result >= 0 ? 'pos' : 'neg'}">${G.fmtMoney(r.result)}</td>
          <td><button class="mini" data-pl="legDel" data-i="${i}" title="Drop this flight and the ones after it on this loop">✕</button></td></tr>`;
      });
      h += days > 1
        ? `</table><div class="muted">${d.legs.length} flights every ${days} days · ${G.fmtDuration(est.block)} in the air · about
          <b class="${est.profit >= 0 ? 'pos' : 'neg'}">${G.fmtMoney(est.profit)}</b> a round (${G.fmtMoney(est.profit / days)} a day) before fixed costs ·
          − / + moves a flight by 15 min and the ones after it.</div>`
        : `</table><div class="muted">${d.legs.length} flights · ${G.fmtDuration(est.block)} in the air · about
          <b class="${est.profit >= 0 ? 'pos' : 'neg'}">${G.fmtMoney(est.profit)}</b> a day before fixed costs ·
          − / + moves a flight by 15 min and the ones after it.</div>`;
      const crews = G.crewsFor(p.type, d.legs, days);
      if (crews > 1) {
        h += `<div class="hint">👥 More than ${G.fmtDuration(C.crewMaxDutyMin)} in the air a day: a second crew flies with it
          (+${G.fmtMoney(G.crewFor(p.type).weeklySalary * (crews - 1))} a week).</div>`;
      }
    } else if (d.stops.length >= 2) {
      // (a timetable repeats every day: one round, turnarounds included, must fit into one)
      const round = roundMin(p, d.stops);
      h += round > DAY
        ? `<div class="warn">Nothing fits: one round ${d.stops.join(' → ')} → ${d.stops[0]} takes ${G.fmtDuration(round)} with the
          turnarounds, and a timetable repeats every day. ${ultraOk ? '<b>Tick 🌏 Ultra long-haul</b> above: then it repeats every few days.'
            : `Pick an airport closer by: only planes with the range for flights longer than half a day fly ultra long-haul timetables over several days.`}</div>`
        : `<div class="warn">Nothing fits: move the first departure into ${clock(C.curfew.start)}–${clock(C.curfew.end)} local, or shorten the route (or start
          from another of its airports: each one's night curfew is in its local time).</div>`;
    } else {
      h += `<div class="hint">Add ${d.stops.length ? 'a second airport' : 'two airports'} where you hold a slot.</div>`;
    }
    if (errors.length) h += `<div class="label neg">Fix this first</div><ul class="errors">${errors.map((e) => `<li>${e}</li>`).join('')}</ul>`;
    const can = !errors.length && d.legs.length;
    h += `<div class="row">
      <button class="primary" data-pl="save" data-start="1" ${can ? '' : 'disabled'}>Save & fly</button>
      <button data-pl="save" ${can ? '' : 'disabled'}>Save, don't start yet</button>
      ${p.schedule.legs ? `<button data-pl="toggle">${p.schedule.active ? '⏸ Pause' : '▶ Start'}</button>
        <button data-pl="clear" title="The plane stays where it is">Remove timetable</button>` : ''}
      <button data-pl="close">Close</button></div></div>`;
    return h;
  }

  // When this plane stands at each airport of its day, next to when your other planes do: orange = this plane,
  // grey = the others, red = all your slots there are taken then (whoever comes last waits at its gate).
  function fitView(p, d) {
    if (!d.legs.length) return '';
    const fit = G.slotFit(p.id, d.legs, daysOf(p, d));
    let h = `<div class="pl-fit">${axis()}`;
    for (const a of fit.airports) {
      h += `<div class="tl-row"><div class="tl-label" data-pl="slotAt" data-code="${a.code}" title="Open the slots at ${a.code}">${a.code}
        <small>${a.have} slot${a.have === 1 ? '' : 's'}</small></div><div class="tl-bar fit">${nightAndNow()}`;
      for (const x of a.others) {
        h += `<b class="fit-other" style="left:${pct(x.from)};width:${pct(x.to - x.from)}" title="${nameOf(x.planeId)} ${x.idle ? 'parked here all day (no timetable)' : `here ${clock(toLocal(a.code, x.arr))}–${clock(toLocal(a.code, x.dep))} local`}">${x.to - x.from >= 70 ? nameOf(x.planeId) : ''}</b>`;
      }
      for (const x of a.mine) {
        h += `<b class="fit-mine" style="left:${pct(x.from)};width:${pct(x.to - x.from)}" title="${G.planeName(p)} here ${clock(toLocal(a.code, x.arr))}–${clock(toLocal(a.code, x.dep))} local">${x.to - x.from >= 70 ? p.id : ''}</b>`;
      }
      for (const x of a.over) h += `<i class="fit-over" style="left:${pct(x.from)};width:${pct(x.to - x.from)}" title="No free slot ${clock(toLocal(a.code, x.from))}–${clock(toLocal(a.code, x.to))} local"></i>`;
      h += '</div></div>';
    }
    h += `<div class="muted fit-legend"><b class="key mine"></b> ${G.planeName(p)} on the ground · <b class="key other"></b> your other planes ·
      <b class="key over"></b> no free slot</div>`;
    if (!fit.minutes) h += '<div class="pos">✔ Fits: whenever this plane is on the ground, one of your slots there is free.</div>';
    else {
      h += '<ul class="slot-check">';
      for (const a of fit.airports.filter((x) => x.minutes)) {
        const when = `${a.over.map((x) => `${clock(toLocal(a.code, x.from))}–${clock(toLocal(a.code, x.to))}`).join(', ')} local`;
        h += `<li class="warn-li">⚠ <b>${a.code}</b> ${when}: your ${a.have} slot${a.have === 1 ? ' is' : 's are'} taken, so a plane waits at its
          gate (delays). Drag the start time, press ✨, or ${G.freeSlots(a.code) ? `<button class="mini" data-pl="addSlot" data-code="${a.code}">lease another slot · ${G.fmtMoney(G.slotPrice(a.code))}</button>` : `get another slot (none is free: <button class="mini" data-pl="slotAt" data-code="${a.code}">make an offer</button>)`}.</li>`;
      }
      h += '</ul>';
    }
    return h + '</div>';
  }

  // ---------- slot market of one airport ----------
  // Who holds the airport's slots, leasing a free one, and offers for someone else's when none is free.
  function slotMarket(code) {
    const s = G.state;
    const cap = G.slotCapacity(code);
    const mine = G.slotCount(code);
    const holders = G.slotHolders(code);
    const free = G.freeSlots(code);
    const price = G.slotPrice(code);
    const fee = G.slotFee(code);
    const seg = (n, color, title, cls = '') => (n ? `<i class="${cls}" style="flex:${n};background:${color}" title="${title}"></i>` : '');
    let h = `<div class="slot-market">
      <div class="sm-head"><b>${cap} slots</b> <span class="muted">(one per aircraft stand)</span> ·
        <b class="pos">${mine} yours</b> · ${free ? `<b>${free} free</b>` : '<b class="neg">none free</b>'}</div>
      <div class="sm-bar">${seg(mine, 'var(--accent)', `yours: ${mine}`)}${holders.map((x) => seg(x.n, x.color, `${x.name}: ${x.n}`)).join('')}${seg(free, 'transparent', `free: ${free}`, 'free')}</div>
      <table class="small sm-table">
        <tr><td><span class="rv-dot" style="background:var(--accent)"></span>You</td><td class="num">${mine}</td>
          <td class="muted">${mine ? (fee ? `${G.fmtMoney(fee)}/week each` : 'no weekly fee (you control the airport)') : ''}</td>
          <td></td></tr>
        <tr><td><span class="rv-dot sm-free"></span>Free</td><td class="num">${free}</td>
          <td class="muted">${price ? `${G.fmtMoney(price)} + ${G.fmtMoney(G.slotWeekly(code))}/week` : 'no charge: you control the airport'}</td><td></td></tr>`;
    // By class: a plane needs a slot of its class or a bigger one (its wingspan, see the market).
    const t = G.slotTable(code);
    const big = Math.max(0, ...s.planes.map((q) => G.typeClass(q.type)));
    h += `<tr class="sm-classes"><td colspan="4"><table class="sm-cls"><tr><th>Class</th><th>stands</th><th>yours</th><th>free</th><th></th></tr>`;
    for (let c = 5; c >= 0; c--) {
      if (!t.cap[c] && !t.mine[c]) continue;
      const fits = s.planes.filter((q) => G.typeClass(q.type) <= c).length;
      h += `<tr${c >= big ? '' : ' class="muted"'}><td title="${['up to 15', '15–24', '24–36', '36–52', '52–65', '65–80'][c]} m wingspan">${G.CLASSES[c]}</td><td class="num">${t.cap[c]}</td>
        <td class="num">${t.mine[c] || ''}</td><td class="num">${t.free[c] || ''}</td>
        <td class="nowrap">${t.free[c] ? `<button class="mini${c >= big ? ' primary' : ''}" data-pl="leaseFree" data-code="${code}" data-cls="${c}" ${s.money < price ? 'disabled' : ''} title="${fits} of your planes fit">Lease</button>` : ''}
          ${t.mine[c] && (mine > 1 || code !== G.home()) ? `<button class="mini" data-pl="dropSlot" data-code="${code}" data-cls="${c}" title="Give a class ${G.CLASSES[c]} slot back">−</button>` : ''}</td></tr>`;
    }
    h += '</table></td></tr>';
    for (const x of holders) {
      h += `<tr><td><span class="rv-dot" style="background:${x.color}"></span>${x.name}${x.hub ? ' <span class="muted">(hub)</span>' : ''}</td><td class="num">${x.n}</td>`;
      if (free) { h += '<td></td><td></td></tr>'; continue; }
      const key = `${code}|${x.id}`;
      const fair = G.slotOfferPrice(code, x.id);
      const amount = pl.offer[key] || Math.round(fair);
      const chance = Math.round(G.slotOfferChance(code, x.id, amount) * 100);
      const wait = s.offers[key] && s.time - s.offers[key] < 1440;
      h += `<td class="nowrap"><button class="mini" data-pl="offerStep" data-key="${key}" data-fair="${fair}" data-by="-0.1">−</button>
          <b>${G.fmtMoney(amount)}</b>
          <button class="mini" data-pl="offerStep" data-key="${key}" data-fair="${fair}" data-by="0.1">+</button>
          <span class="${chance >= 60 ? 'pos' : chance >= 30 ? '' : 'neg'}" title="Chance the airport agrees">${chance}%</span></td>
        <td>${wait ? '<span class="muted">tomorrow</span>' : `<button class="mini" data-pl="offer" data-code="${code}" data-holder="${x.id}" data-amount="${amount}" ${s.money < amount ? 'disabled' : ''}>Make offer</button>`}</td></tr>`;
    }
    h += '</table>';
    const rep = G.reputation(code);
    h += `<div class="muted sm-rep" title="${rep.parts.map(([l, v]) => `${l}: ${v > 0 && l !== 'Base' ? '+' : ''}${v}`).join('\n')}">
      Your reputation at ${code}: <b class="${rep.value >= 60 ? 'pos' : rep.value < 40 ? 'neg' : ''}">${rep.value}/100</b>
      ${free ? '' : '· when no slot is free, offer a holder money for one of theirs: the airport decides by your offer and reputation'}</div>`;
    return h + '</div>';
  }

  // All the airports where you hold slots.
  function slotOverview() {
    const codes = Object.keys(G.state.slots);
    if (!codes.length) return '';
    return `<table class="small sm-overview"><tr><th>Airport</th><th>yours</th><th>of</th><th>free</th><th>held by</th></tr>${codes.map((c) => {
      const holders = G.slotHolders(c);
      return `<tr class="click${c === pl.slotAt ? ' on' : ''}" data-pl="slotAt" data-code="${c}"><td><b>${c}</b> <span class="muted">${G.airportByCode[c].city}</span></td>
        <td class="num pos">${G.slotCount(c)}</td><td class="num">${G.slotCapacity(c)}</td><td class="num">${G.freeSlots(c) || '<span class="neg">0</span>'}</td>
        <td>${holders.map((x) => `<span class="rv-dot" style="background:${x.color}" title="${x.name}: ${x.n}"></span>${x.n}`).join(' ')}</td></tr>`;
    }).join('')}</table>`;
  }

  // ---------- Slots ----------
  // One row per slot you hold at an airport, with the planes standing in it during the day.
  function slotLanes(code, draft, compact) {
    const u = G.slotUsage(code, draft);
    const rows = Math.max(u.have, u.need);
    let h = `<div class="slot-lanes${compact ? ' compact' : ''}"><div class="sl-head" data-pl="slotAt" data-code="${code}">
      <b>${code}</b> <span class="muted">${G.airportByCode[code].city} · ${u.have} slot${u.have === 1 ? '' : 's'}</span>
      ${u.need > u.have ? `<span class="neg">· at times ${u.need} planes for ${u.have} slot${u.have === 1 ? '' : 's'}</span>` : ''}</div>`;
    if (!compact) h += axis();
    for (let k = 0; k < rows; k++) {
      const over = k >= u.have;
      h += `<div class="tl-row slot${over ? ' over' : ''}"><div class="tl-label">${over ? '<span class="neg">no slot</span>' : `Slot ${k + 1}`}</div>
        <div class="tl-bar">${nightAndNow()}${u.uses.filter((x) => x.lane === k).map((x) => {
          const mine = draft && x.planeId === draft.planeId;
          const title = x.idle ? `${nameOf(x.planeId)}: parked here (no running timetable) – it keeps this slot until it leaves` : `${nameOf(x.planeId)}: lands ${clock(toLocal(code, x.arr))}, leaves ${clock(toLocal(code, x.dep))} local`;
          return `<b class="tl-use${x.idle ? ' idle' : ''}${mine ? ' draft' : ''}" style="left:${pct(x.from)};width:${pct(x.to - x.from)}" title="${title}">${x.to - x.from >= 60 ? nameOf(x.planeId) : ''}</b>`;
        }).join('')}</div></div>`;
    }
    return h + `</div>`;
  }

  // Which of your planes fill the slots at an airport at this moment.
  function slotsNow(code) {
    const occ = G.slotOccupants(code);
    const n = G.slotCount(code);
    const taken = occ.filter((o) => o.how !== 'leaving').length;
    const label = { parked: 'parked here', turnaround: 'turnaround', leaving: 'about to leave', inbound: 'on its way here' };
    const waiting = G.state.planes.filter((q) => q.waitSlot === code).map((q) => q.id);
    let h = `<div class="slots-now"><b class="${taken > n ? 'neg' : 'pos'}">${taken} plane${taken === 1 ? '' : 's'} for ${n} slot${n === 1 ? '' : 's'}</b>
      ${taken < n ? `<span class="muted">· ${n - taken} free</span>` : taken > n ? '<span class="neg">· one has to wait or leave first</span>' : '<span class="muted">· full</span>'}`;
    h += occ.length ? `<ul>${occ.map((o) => `<li class="click" data-pl="edit" data-plane="${o.p.id}"><b>${o.p.id}</b> <span class="muted">${o.p.type} · ${label[o.how]}</span></li>`).join('')}</ul>`
      : '<div class="muted">No plane here: every slot is free.</div>';
    if (waiting.length) h += `<div class="neg">⏳ Waiting elsewhere for a slot here: ${waiting.join(', ')}</div>`;
    const base = G.parkedAtBase(code);
    if (base.length) h += `<div class="muted">🏠 Parked at your base without a slot: ${base.map((q) => q.id).join(', ')}</div>`;
    return h + '</div>';
  }

  // Arrivals and departures at an airport today, from the timetables.
  function board(code) {
    const rows = [];
    for (const p of G.state.planes) {
      const legs = p.schedule.legs;
      if (!legs) continue;
      for (const l of legs) {
        if (l.from === code) rows.push({ t: l.dep, kind: 'dep', p, other: l.to });
        if (l.to === code) rows.push({ t: (l.dep + G.legBlock(p.type, l.from, l.to)) % DAY, kind: 'arr', p, other: l.from });
      }
    }
    // (the board shows the local time here, like the one in the terminal)
    for (const r of rows) r.t = toLocal(code, r.t);
    rows.sort((a, b) => a.t - b.t);
    if (!rows.length) return '<div class="muted">No timetabled flights here yet.</div>';
    const now = toLocal(code, G.state.time);
    return `<table class="small board"><tr><th title="Local time at ${code}">time (local)</th><th></th><th>flight</th><th>aircraft</th></tr>${rows.map((r) =>
      `<tr class="${r.t < now ? 'past' : ''}"><td>${clock(r.t)}</td><td>${r.kind === 'arr' ? '🛬' : '🛫'}</td>
        <td>${r.kind === 'arr' ? `from ${r.other}` : `to ${r.other}`}</td>
        <td class="click" data-pl="edit" data-plane="${r.p.id}">${r.p.id} <span class="muted">${r.p.type}</span></td></tr>`).join('')}</table>`;
  }

  function slotsTab() {
    const s = G.state;
    const codes = Object.keys(s.slots);
    if (!pl.slotAt || !s.slots[pl.slotAt]) pl.slotAt = codes.includes(ctx.ui.selectedAirport) ? ctx.ui.selectedAirport : codes[0];
    let h = `<div class="panel"><h3>Your slots</h3>${slotOverview()}<div class="muted">A slot is a parking place for <b>one plane at a time</b>. A plane uses it from landing
      until it takes off. After that the slot is free and any other plane can use it. If all slots are taken when a plane wants
      to fly there, it waits at its gate until one frees up.</div></div>`;
    const code = pl.slotAt;
    if (code) {
      const a = G.airportByCode[code];
      h += `<div class="panel"><h3>${code} · ${a.name}</h3>
        <div class="muted">${a.city}, ${a.country}${G.stake(code) ? ` · you own ${G.stake(code)}%` : ''}</div>
        ${slotMarket(code)}
        <div class="row"><button data-pl="showAirport" data-code="${code}">Show on map</button></div>
        <h4>Right now</h4>${slotsNow(code)}
        <h4>Today's plan</h4>${slotLanes(code)}
        <h4>Today's arrivals and departures</h4>${board(code)}</div>`;
    }
    return h + ctx.bestRoutes();
  }

  // ---------- Airports ----------
  // Airports you hold a slot or shares at, or that one of your planes flies to.
  function myAirports() {
    const s = G.state;
    const set = new Set([...Object.keys(s.slots), ...Object.keys(s.infra).filter((c) => G.stake(c) > 0)]);
    for (const p of s.planes) for (const c of p.schedule.stops) set.add(c);
    return [...set].filter((c) => G.airportByCode[c]);
  }

  function airportsTab() {
    let h = `<div class="panel"><h3>Your airports</h3><div class="muted">Click to open · double-click a slot row for its timetable.</div>`;
    // In the four categories (C.airports.categories), the biggest first.
    const no = (code) => C.airports.categories.indexOf(G.airportCategory(code));
    const mine = myAirports().sort((a, b) => no(b) - no(a));
    let group = null;
    for (const code of mine) {
      if (G.airportCategory(code) !== group) {
        group = G.airportCategory(code);
        h += `<h4 class="ap-group">${group.plural} <span class="muted">${mine.filter((c) => G.airportCategory(c) === group).length}</span></h4>`;
      }
      const a = G.airportByCode[code];
      const open = !!pl.open[code];
      const planes = G.state.planes.filter((p) => p.schedule.stops.includes(code) || p.location === code);
      const st = G.stake(code);
      h += `<div class="ap-item${open ? ' open' : ''}">
        <div class="ap-sum" data-pl="toggleAp" data-code="${code}"><span class="caret">${open ? '▾' : '▸'}</span>
          <b>${code}</b> <span class="city">${a.city}</span>
          ${code === G.home() ? '<span class="tag">home</span>' : ''}
          ${G.slotCount(code) ? `<span class="tag slot">🅿 ${G.slotCount(code)}</span>` : ''}
          ${st ? `<span class="tag stake">${st}%</span>` : ''}
          <span class="tag">🛩 ${planes.length}</span></div>`;
      if (open) {
        h += `<div class="ap-body">`;
        if (G.slotCount(code)) {
          const u = G.slotUsage(code);
          h += `<div class="ap-slot click" data-pl="slotRow" data-code="${code}" title="Double-click: open in Slots">
            🅿 ${G.slotCount(code)} slot${G.slotCount(code) === 1 ? '' : 's'} · busiest ${u.need}/${u.have} · ${G.fmtMoney(G.slotFee(code))}/week each
            <span class="muted">(double-click)</span></div>`;
        } else {
          h += `<div class="muted">No slot here. ${G.freeSlots(code) ? `<button class="mini" data-pl="addSlot" data-code="${code}">Lease one · ${G.fmtMoney(G.slotPrice(code))}</button>` : `All ${G.slotCapacity(code)} are taken: <button class="mini" data-pl="showAirport" data-code="${code}">make an offer</button>`}</div>`;
        }
        if (planes.length) {
          h += `<table class="small"><tr><th>Plane</th><th>route</th><th>here</th></tr>${planes.map((p) => {
            const legs = (p.schedule.legs || []).filter((l) => l.to === code);
            const when = legs.length ? legs.map((l) => clock(toLocal(code, l.dep + G.legBlock(p.type, l.from, l.to)))).join(', ') : p.location === code && p.status !== 'flying' ? 'parked' : '–';
            return `<tr class="click" data-pl="edit" data-plane="${p.id}"><td>${G.planeName(p)} <span class="muted">${p.name ? `${p.id} · ` : ''}${p.type}</span></td>
              <td>${p.schedule.stops.length >= 2 ? p.schedule.stops.join('→') : '–'}</td><td>${when}</td></tr>`;
          }).join('')}</table>`;
        }
        if (st) h += `<div>Shares: <b>${st}%</b> · worth ${G.fmtMoney(G.shareSale(code, st))}</div>`;
        h += `<div class="row"><button class="mini" data-pl="showAirport" data-code="${code}">Details & map</button></div></div>`;
      }
      h += `</div>`;
    }
    return h + `</div>` + ctx.legacyAirports();
  }

  // ---------- input ----------
  // True when the same element key was clicked twice within 400 ms.
  function isDouble(key) {
    const now = performance.now();
    const dbl = pl.lastClick.key === key && now - pl.lastClick.t < 400;
    pl.lastClick = dbl ? { key: null, t: 0 } : { key, t: now };
    return dbl;
  }

  function shift(i, by) {
    const d = pl.draft;
    // Move this flight and every later one by the same amount (on an ultra long-haul timetable, across midnight to
    // the day before or after).
    for (let k = i; k < d.legs.length; k++) d.legs[k].dep = d.ultra ? Math.max(0, d.legs[k].dep + by) : (d.legs[k].dep + by + DAY) % DAY;
    if (i === 0) d.first = d.legs[0].dep % DAY;
  }

  function action(el) {
    const a = el.dataset.pl;
    const code = el.dataset.code;
    const i = Number(el.dataset.i);
    const p = pl.edit && G.plane(pl.edit);
    const d = pl.draft;
    let err = null;
    switch (a) {
      case 'edit': {
        const plane = G.plane(el.dataset.plane);
        if (pl.edit !== plane.id) { pl.edit = plane.id; startDraft(plane); }
        if (FG.planeWin) FG.planeWin.showTimetable(); else ctx.setTab('schedule');
        break;
      }
      case 'close': pl.edit = null; pl.draft = null; break;
      case 'stopDel': d.stops.splice(i, 1); rebuild(p); break;
      case 'stopUp': [d.stops[i - 1], d.stops[i]] = [d.stops[i], d.stops[i - 1]]; rebuild(p); break;
      case 'rebuild': rebuild(p); break;
      case 'firstStep': d.first = toHome(d.stops[0], Math.min(C.curfew.end, Math.max(C.curfew.start, toLocal(d.stops[0], d.first) + Number(el.dataset.by)))); rebuild(p); break;
      case 'fit': {
        const best = G.fitTimetable(p.id, d.stops, d.rounds, d.first, d.ultra);
        if (!best) { err = G.ultraCapable(p.type) && !d.ultra ? 'Nothing fits into the day: shorten the route, or tick 🌏 Ultra long-haul.' : 'Nothing fits into the day: shorten the route.'; break; }
        Object.assign(d, { stops: best.stops, first: best.first, rounds: best.rounds, legs: best.legs });
        const often = best.days > 1 ? `every ${best.days} days` : 'a day';
        ctx.toast(best.over ? `Best there is: ${clock(toLocal(best.stops[0], best.first))} local from ${best.stops[0]}, ${best.legs.length} flights ${often}, but still ${G.fmtDuration(best.over)} without a free slot – lease another one.`
          : `Fits: first departure ${clock(toLocal(best.stops[0], best.first))} local from ${best.stops[0]}, ${best.legs.length} flights ${often}.`, !!best.over);
        break;
      }
      case 'shift': shift(i, Number(el.dataset.by)); break;
      case 'legDel': d.legs.splice(i, d.legs.length - i); break;
      case 'save': {
        err = G.setTimetable(p.id, d.legs, daysOf(p, d));
        if (!err && el.dataset.start) err = G.setScheduleActive(p.id, true);
        if (!err) ctx.toast(el.dataset.start ? `${G.planeName(p)} flies its new timetable.` : 'Timetable saved.');
        break;
      }
      case 'toggle': err = G.setScheduleActive(p.id, !p.schedule.active); break;
      case 'clear': err = G.clearTimetable(p.id); startDraft(p); break;
      case 'slotAt':
        if (el.classList.contains('tl-ground') && !isDouble(`g${code}`)) {
          const row = el.closest('.tl-row[data-pl="edit"]'); // a single click opens the plane's day
          if (row) action(row);
          return;
        }
        pl.slotAt = code; ctx.setTab('slots'); break;
      case 'slotRow':
        if (!isDouble(`s${code}`)) return;
        pl.slotAt = code; ctx.setTab('slots'); break;
      case 'toggleAp': pl.open[code] = !pl.open[code]; break;
      case 'addSlot': err = G.addSlot(code); break;
      case 'leaseFree': err = G.leaseSlot(code, el.dataset.cls); break;
      case 'offerStep': {
        const fair = Number(el.dataset.fair);
        const now = pl.offer[el.dataset.key] || Math.round(fair);
        pl.offer[el.dataset.key] = Math.max(Math.round(fair * 0.3), Math.round(now + fair * Number(el.dataset.by)));
        break;
      }
      case 'offer': {
        const r = G.makeSlotOffer(code, el.dataset.holder, Number(el.dataset.amount));
        if (typeof r === 'string') err = r;
        else { ctx.toast(r.text, !r.accepted); delete pl.offer[`${code}|${el.dataset.holder}`]; }
        break;
      }
      case 'dropSlot': err = G.dropSlot(code, el.dataset.cls); break;
      case 'showAirport': ctx.selectAirport(code); break;
      default: return;
    }
    if (err) ctx.toast(err, true);
    G.dirty = true;
  }

  function change(el) {
    const p = pl.edit && G.plane(pl.edit);
    if (!p || !pl.draft) return false;
    const d = pl.draft;
    if (el.id === 'pl-add' && el.value) {
      d.stops.push(el.value);
      rebuild(p);
    }
    else if (el.id === 'pl-first' || el.id === 'pl-first-range') { d.first = toHome(d.stops[0], el.id === 'pl-first' ? parseClock(el.value) : Number(el.value)); rebuild(p); }
    else if (el.id === 'pl-rounds') { d.rounds = Number(el.value); rebuild(p); }
    else if (el.id === 'pl-ultra') { d.ultra = el.checked; d.rounds = d.ultra ? Math.max(1, d.rounds) : 0; rebuild(p); }
    else if (el.classList.contains('pl-dep')) {
      // (typed in local time at the airport it leaves; moved the short way round the clock)
      const i = Number(el.dataset.i);
      const by = parseClock(el.value) - toLocal(d.legs[i].from, d.legs[i].dep);
      shift(i, ((by % DAY) + DAY + 720) % DAY - 720);
    }
    else return false;
    G.dirty = true;
    return true;
  }

  // Dragging the start-time slider: the sidebar doesn't re-render while an input has focus, so the time and
  // the slot bars are updated here.
  function input(el) {
    const p = pl.edit && G.plane(pl.edit);
    if (!p || !pl.draft || el.id !== 'pl-first-range') return;
    pl.draft.first = toHome(pl.draft.stops[0], Number(el.value));
    rebuild(p);
    const t = document.getElementById('pl-first');
    if (t) t.value = clock(toLocal(pl.draft.stops[0], pl.draft.first));
    const n = document.getElementById('pl-first-home');
    if (n) n.textContent = firstNote(pl.draft);
    const f = document.getElementById('pl-fit');
    if (f) f.innerHTML = fitView(p, pl.draft);
  }

  FG.planner = {
    init(c) { ctx = c; },
    scheduleTab, slotsTab, airportsTab, action, change, input, slotMarket,
    editing() { return pl.edit && pl.draft ? pl.edit : null; },
    // Stops of the timetable being edited for this plane (drawn on the map as a dotted route), or null.
    draftStops(id) { return pl.edit === id && pl.draft && pl.draft.stops.length >= 2 ? pl.draft.stops : null; },
    // Clicked an airport on the map while planning: add it as the next stop.
    addStop(code) {
      const p = pl.edit && G.plane(pl.edit);
      if (!p || !pl.draft) return 'Open a plane in Schedule first.';
      if (!G.ownsSlot(code)) return `Lease a slot at ${code} first.`;
      if (pl.draft.stops[pl.draft.stops.length - 1] === code) return `${code} is already the last stop.`;
      pl.draft.stops.push(code);
      rebuild(p);
      G.dirty = true;
      return null;
    },
    openPlane(id) { const p = G.plane(id); if (p && pl.edit !== id) { pl.edit = id; startDraft(p); } },
    // The timetable editor of the plane being planned (the timetable window draws it), or ''.
    editorHtml() { const p = pl.edit && G.plane(pl.edit); return p && pl.draft ? editor(p) : ''; },
    closeEditor() { pl.edit = null; pl.draft = null; },
    reset() { pl.edit = null; pl.draft = null; pl.slotAt = null; pl.open = {}; pl.offer = {}; },
  };
})();
