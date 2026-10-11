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

  const pl = {
    edit: null,       // plane whose timetable is open in the editor
    draft: null,      // { stops, first, rounds, legs } being edited
    slotAt: null,     // airport shown in the Slots section
    open: {},         // airport code -> expanded in the Airports section
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

  // Flight blocks and ground blocks of one plane's day.
  function dayBlocks(p, legs, draft) {
    let h = '';
    for (const g of G.groundTimes(p.type, legs)) {
      h += `<b class="tl-ground" style="left:${pct(g.from)};width:${pct(g.to - g.from)}" data-pl="slotAt" data-code="${g.code}"
        title="${g.code}: on the ground ${clock(g.arr)}–${clock(g.dep)} (takes a slot) · double-click for the slot">${g.to - g.from >= 50 ? g.code : ''}</b>`;
    }
    for (const l of legs) {
      const block = G.legBlock(p.type, l.from, l.to);
      const parts = l.dep + block > DAY ? [[l.dep, DAY - l.dep], [0, l.dep + block - DAY]] : [[l.dep, block]];
      for (const [s, w] of parts) {
        h += `<b class="tl-flight${draft ? ' draft' : ''}" style="left:${pct(s)};width:${pct(w)}"
          title="${clock(l.dep)} ${l.from} → ${l.to} ${clock(l.dep + block)} · ${G.fmtDuration(block)}">${w >= 70 ? `${l.from}›${l.to}` : ''}</b>`;
      }
    }
    return h;
  }

  // ---------- Schedule ----------
  function scheduleTab() {
    const s = G.state;
    let h = `<div class="panel"><h3>Day plan</h3>
      <div class="muted">Every plane's day: flights in blue, time on the ground in grey (it holds one of your slots there).
      Shaded = night curfew (no departures ${clock(C.curfew.end)}–${clock(C.curfew.start)}). Click a plane to plan its day.</div>
      <div class="timeline">${axis()}`;
    for (const p of s.planes) {
      const sch = p.schedule;
      const editing = pl.edit === p.id;
      const legs = editing && pl.draft ? pl.draft.legs : sch.legs || [];
      let bar;
      if (legs.length) bar = dayBlocks(p, legs, editing);
      else if (sch.stops.length >= 2) bar = `<span class="tl-text">flies when ready: ${sch.stops.join(' → ')} ↺</span>`;
      else bar = `<span class="tl-text">no schedule · at ${p.location}</span>`;
      const state = !sch.legs && !editing ? '' : sch.active ? '<em class="pos">●</em>' : '<em class="muted">⏸</em>';
      h += `<div class="tl-row${editing ? ' editing' : ''}" data-pl="edit" data-plane="${p.id}">
        <div class="tl-label"><span class="type-icon">${ctx.planeGlyph(p.type)}</span>${p.id} ${state}<small>${p.type}</small></div>
        <div class="tl-bar">${nightAndNow()}${bar}</div></div>`;
    }
    h += `</div></div>`;
    const p = pl.edit && G.plane(pl.edit);
    if (p) h += editor(p);
    return h;
  }

  function startDraft(p) {
    const sch = p.schedule;
    const legs = sch.legs ? sch.legs.map((l) => ({ ...l })) : [];
    const stops = sch.legs ? loopOf(sch.legs) : sch.stops.length >= 2 ? sch.stops.slice() : [p.location];
    const first = legs.length ? legs[0].dep : C.curfew.start + 60;
    pl.draft = { stops, first, rounds: 0, legs };
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

  function rebuild(p) {
    const d = pl.draft;
    d.legs = G.buildTimetable(p.type, d.stops, d.first, d.rounds);
  }

  function editor(p) {
    const d = pl.draft;
    const owned = Object.keys(G.state.slots);
    const errors = d.legs.length ? G.checkTimetable(p.id, d.legs) : [];
    let h = `<div class="panel plan"><h3>${p.id} <span class="muted">${D.aircraft[p.type].name} · at ${p.location}</span></h3>
      <div class="label">1 · Route <span class="muted">(loops back to the first stop)</span></div>
      <div class="chips stops-chips">${d.stops.map((c, i) => `<span class="chip">${c}
        ${i ? `<button class="mini" data-pl="stopUp" data-i="${i}" title="Earlier">↑</button>` : ''}
        <button class="mini" data-pl="stopDel" data-i="${i}" title="Remove">✕</button></span>`).join('<span class="arrow">→</span>')}
        <select id="pl-add"><option value="">+ stop…</option>${owned.filter((c) => c !== d.stops[d.stops.length - 1])
          .map((c) => `<option value="${c}">${c} · ${G.airportByCode[c].city}</option>`).join('')}</select></div>
      <div class="label">2 · Times</div>
      <div class="row">First departure <input type="time" id="pl-first" step="300" value="${clock(d.first)}">
        Loops <select id="pl-rounds"><option value="0"${d.rounds ? '' : ' selected'}>as many as fit</option>
        ${[1, 2, 3, 4, 5, 6, 8].map((n) => `<option value="${n}"${d.rounds === n ? ' selected' : ''}>${n}×</option>`).join('')}</select>
        <button data-pl="rebuild">Fill the day</button></div>`;
    if (d.legs.length) {
      const est = G.estimateTimetable(p.type, d.legs, G.costMult(p));
      h += `<table class="small legs"><tr><th>dep</th><th>flight</th><th>arr</th><th>pax</th><th>result</th><th></th></tr>`;
      est.rows.forEach((r, i) => {
        h += `<tr><td class="nowrap"><button class="mini" data-pl="shift" data-i="${i}" data-by="-15">−</button>
          <input type="time" class="pl-dep" data-i="${i}" step="300" value="${clock(r.dep)}">
          <button class="mini" data-pl="shift" data-i="${i}" data-by="15">+</button></td>
          <td>${r.from} → ${r.to} <span class="muted">${G.fmtDuration(r.block)}</span></td><td>${clock(r.arr)}</td>
          <td>${r.pax}/${r.seats}</td><td class="${r.result >= 0 ? 'pos' : 'neg'}">${G.fmtMoney(r.result)}</td>
          <td><button class="mini" data-pl="legDel" data-i="${i}" title="Drop this flight and the ones after it on this loop">✕</button></td></tr>`;
      });
      h += `</table><div class="muted">${d.legs.length} flights · ${G.fmtDuration(est.block)} in the air · about
        <b class="${est.profit >= 0 ? 'pos' : 'neg'}">${G.fmtMoney(est.profit)}</b> a day before fixed costs ·
        − / + moves a flight by 15 min and the ones after it.</div>`;
      h += `<div class="label">3 · Slots on the way</div>${[...new Set(d.legs.map((l) => l.from))].map((c) => slotLanes(c, { planeId: p.id, type: p.type, legs: d.legs }, true)).join('')}`;
    } else if (d.stops.length >= 2) {
      h += `<div class="warn">Nothing fits: move the first departure into ${clock(C.curfew.start)}–${clock(C.curfew.end)} or shorten the route.</div>`;
    } else {
      h += `<div class="hint">Add a second airport where you hold a slot.</div>`;
    }
    if (errors.length) h += `<ul class="errors">${errors.map((e) => `<li>${e}</li>`).join('')}</ul>`;
    h += `<div class="row">
      <button class="primary" data-pl="save" data-start="1" ${errors.length || !d.legs.length ? 'disabled' : ''}>Save & fly</button>
      <button data-pl="save" ${errors.length || !d.legs.length ? 'disabled' : ''}>Save</button>
      ${p.schedule.legs ? `<button data-pl="toggle">${p.schedule.active ? 'Pause' : 'Start'}</button>` : ''}
      <button data-pl="close">Close</button></div></div>`;
    return h;
  }

  // ---------- Slots ----------
  // One row per slot you hold at an airport, with the planes standing in it during the day.
  function slotLanes(code, draft, compact) {
    const u = G.slotUsage(code, draft);
    const rows = Math.max(u.have, u.need);
    let h = `<div class="slot-lanes${compact ? ' compact' : ''}"><div class="sl-head" data-pl="slotAt" data-code="${code}">
      <b>${code}</b> <span class="muted">${G.airportByCode[code].city} · ${u.have} slot${u.have === 1 ? '' : 's'}</span>
      ${u.need > u.have ? '<span class="neg">· over capacity</span>' : ''}</div>`;
    if (!compact) h += axis();
    for (let k = 0; k < rows; k++) {
      const over = k >= u.have;
      h += `<div class="tl-row slot${over ? ' over' : ''}"><div class="tl-label">${over ? '<span class="neg">no slot</span>' : `Slot ${k + 1}`}</div>
        <div class="tl-bar">${nightAndNow()}${u.uses.filter((x) => x.lane === k).map((x) => {
          const mine = draft && x.planeId === draft.planeId;
          const title = x.idle ? `${x.planeId}: parked here all day (no timetable)` : `${x.planeId}: lands ${clock(x.arr)}, leaves ${clock(x.dep)}`;
          return `<b class="tl-use${x.idle ? ' idle' : ''}${mine ? ' draft' : ''}" style="left:${pct(x.from)};width:${pct(x.to - x.from)}" title="${title}">${x.to - x.from >= 60 ? x.planeId : ''}</b>`;
        }).join('')}</div></div>`;
    }
    return h + `</div>`;
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
    rows.sort((a, b) => a.t - b.t);
    if (!rows.length) return '<div class="muted">No timetabled flights here yet.</div>';
    const now = G.state.time % DAY;
    return `<table class="small board"><tr><th>time</th><th></th><th>flight</th><th>aircraft</th></tr>${rows.map((r) =>
      `<tr class="${r.t < now ? 'past' : ''}"><td>${clock(r.t)}</td><td>${r.kind === 'arr' ? '🛬' : '🛫'}</td>
        <td>${r.kind === 'arr' ? `from ${r.other}` : `to ${r.other}`}</td>
        <td class="click" data-pl="edit" data-plane="${r.p.id}">${r.p.id} <span class="muted">${r.p.type}</span></td></tr>`).join('')}</table>`;
  }

  function slotsTab() {
    const s = G.state;
    const codes = Object.keys(s.slots);
    if (!pl.slotAt || !s.slots[pl.slotAt]) pl.slotAt = codes.includes(ctx.ui.selectedAirport) ? ctx.ui.selectedAirport : codes[0];
    let h = `<div class="panel"><h3>Your slots</h3><div class="chips">${codes.map((c) => {
      const u = G.slotUsage(c);
      return `<button class="${c === pl.slotAt ? 'on' : ''}${u.need > u.have ? ' bad' : ''}" data-pl="slotAt" data-code="${c}">${c} <span class="n">${u.need}/${u.have}</span></button>`;
    }).join('')}</div><div class="muted">Each slot takes one plane on the ground at a time. A plane holds it from landing until it
      leaves; then the slot is free for another plane.</div></div>`;
    const code = pl.slotAt;
    if (code) {
      const a = G.airportByCode[code];
      const n = G.slotCount(code);
      const fee = G.slotFee(code);
      h += `<div class="panel"><h3>${code} · ${a.name}</h3>
        <div class="muted">${a.city}, ${a.country} · ${n} slot${n === 1 ? '' : 's'} · ${fee ? `${G.fmtMoney(fee)}/week each` : 'no weekly fee – you control the airport'}</div>
        <div class="row"><button class="primary" data-pl="addSlot" data-code="${code}" ${s.money < G.slotUpfront(code) ? 'disabled' : ''}>
          Lease another slot · ${G.fmtMoney(G.slotUpfront(code))}</button>
          ${n > 1 || code !== G.home() ? `<button data-pl="dropSlot" data-code="${code}">Give one back</button>` : ''}
          <button data-pl="showAirport" data-code="${code}">Show on map</button></div>
        ${slotLanes(code)}
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
    for (const code of myAirports()) {
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
          h += `<div class="muted">No slot here. <button class="mini" data-pl="addSlot" data-code="${code}">Lease one · ${G.fmtMoney(G.slotUpfront(code))}</button></div>`;
        }
        if (planes.length) {
          h += `<table class="small"><tr><th>Plane</th><th>route</th><th>here</th></tr>${planes.map((p) => {
            const legs = (p.schedule.legs || []).filter((l) => l.to === code);
            const when = legs.length ? legs.map((l) => clock(l.dep + G.legBlock(p.type, l.from, l.to))).join(', ') : p.location === code && p.status !== 'flying' ? 'parked' : '–';
            return `<tr class="click" data-pl="edit" data-plane="${p.id}"><td>${p.id} <span class="muted">${p.type}</span></td>
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
    // Move this flight and every later one by the same amount.
    for (let k = i; k < d.legs.length; k++) d.legs[k].dep = (d.legs[k].dep + by + DAY) % DAY;
    if (i === 0) d.first = d.legs[0].dep;
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
        ctx.setTab('schedule');
        break;
      }
      case 'close': pl.edit = null; pl.draft = null; break;
      case 'stopDel': d.stops.splice(i, 1); rebuild(p); break;
      case 'stopUp': [d.stops[i - 1], d.stops[i]] = [d.stops[i], d.stops[i - 1]]; rebuild(p); break;
      case 'rebuild': rebuild(p); break;
      case 'shift': shift(i, Number(el.dataset.by)); break;
      case 'legDel': d.legs.splice(i, d.legs.length - i); break;
      case 'save': {
        err = G.setTimetable(p.id, d.legs);
        if (!err && el.dataset.start) err = G.setScheduleActive(p.id, true);
        if (!err) ctx.toast(el.dataset.start ? `${p.id} flies its new timetable.` : 'Timetable saved.');
        break;
      }
      case 'toggle': err = G.setScheduleActive(p.id, !p.schedule.active); break;
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
      case 'dropSlot': err = G.dropSlot(code); break;
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
    if (el.id === 'pl-add' && el.value) { d.stops.push(el.value); rebuild(p); }
    else if (el.id === 'pl-first') { d.first = parseClock(el.value); rebuild(p); }
    else if (el.id === 'pl-rounds') { d.rounds = Number(el.value); rebuild(p); }
    else if (el.classList.contains('pl-dep')) { const i = Number(el.dataset.i); shift(i, parseClock(el.value) - d.legs[i].dep); }
    else return false;
    G.dirty = true;
    return true;
  }

  FG.planner = {
    init(c) { ctx = c; },
    scheduleTab, slotsTab, airportsTab, action, change,
    openPlane(id) { const p = G.plane(id); if (p) { pl.edit = id; startDraft(p); } },
    reset() { pl.edit = null; pl.draft = null; pl.slotAt = null; pl.open = {}; },
  };
})();
