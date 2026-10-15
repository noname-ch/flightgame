// The plane window: click a plane (on the map, in 3D or in the strip) and a window shows it, as in OpenTTD: a
// live 3D camera behind it (js/view3d.js FG.view3d.chase), what it is doing, its speed and height, where it
// comes from and goes to. 🗓 opens its timetable in a window of its own (the editor of js/planner.js). Both
// windows can be moved (js/windows.js); clicking another plane shows that one.
(function () {
  const G = FG.game;
  const D = FG.data;
  const DAY = 1440;
  const PHASE = {
    boarding: 'Boarding', pushback: 'Pushing back', 'taxi-out': 'Taxiing to the runway', takeoff: 'Taking off', climb: 'Climbing',
    cruise: 'Cruising', descent: 'Descending', approach: 'On final', landing: 'Landing', 'taxi-in': 'Taxiing to the gate',
  };
  const pw = { id: null, win: null, cam: null, tt: null, timer: null };
  const pad = (n) => String(n).padStart(2, '0');
  const clock = (m) => `${pad(Math.floor((((m % DAY) + DAY) % DAY) / 60))}:${pad(Math.floor(((m % 60) + 60) % 60))}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------- the plane window ----------
  function open(id) {
    const p = G.plane(id);
    if (!p) return;
    pw.id = id;
    if (!pw.win || !pw.win.shown) {
      pw.win = FG.win.open('plane', { className: 'plane-win', width: 360, at: [64, 64], onClose: closed });
      pw.win.body.innerHTML = `<div class="pw-cam"><div class="pw-cam-map"></div><div class="pw-cam-note"></div></div>
        <div class="pw-stats"></div>
        <div class="pw-rw"></div>
        <div class="row pw-buttons"><button data-pw="timetable" title="Plan its day">🗓 Timetable</button>
          <button data-pw="follow" title="Keep the map on it">🎥 Follow on the map</button>
          <button data-pw="fleet" title="Its card in Fleet">Fleet</button></div>`;
      pw.win.body.onclick = onClick;
      pw.win.body.onchange = onChange;
      clearInterval(pw.timer);
      pw.timer = setInterval(update, 250);
    }
    pw.rwSig = null;
    camera();
    update();
  }
  function closed() {
    clearInterval(pw.timer);
    pw.timer = null;
    if (pw.cam) { pw.cam.destroy(); pw.cam = null; }
    pw.id = null;
  }
  // The live camera, once the 3D module is there (it loads on its own; it may not load at all offline).
  function camera() {
    if (!pw.win || !pw.win.shown) return;
    const note = pw.win.body.querySelector('.pw-cam-note');
    if (pw.cam) { pw.cam.setPlane(pw.id); return; }
    if (FG.view3d && FG.view3d.chase) {
      try {
        pw.cam = FG.view3d.chase(pw.win.body.querySelector('.pw-cam-map'), pw.id);
        note.textContent = '';
      } catch (e) {
        note.textContent = `No camera: ${e.message}`;
      }
    } else note.textContent = 'The camera comes with the 3D view…';
  }
  function onClick(e) {
    const b = e.target.closest('[data-pw]');
    if (!b || !pw.id) return;
    if (b.dataset.pw === 'timetable') { FG.planner.openPlane(pw.id); showTimetable(); }
    if (b.dataset.pw === 'follow') FG.ui.follow(pw.id);
    if (b.dataset.pw === 'fleet') FG.ui.showFleet(pw.id);
  }
  // Where it is in its day: the flight it is on, or where it stands and when it leaves next.
  function update() {
    if (!pw.win || !pw.win.shown) return;
    const p = G.plane(pw.id);
    if (!p) { pw.win.close(); return; }
    if (!pw.cam) camera();
    const ac = D.aircraft[p.type];
    pw.win.title(`✈ ${esc(G.planeName(p))} <span class="muted">${p.name ? `${esc(p.id)} · ` : ''}${esc(ac.name)}</span>`);
    const t = FG.ui.time;
    let h = '';
    if (p.status === 'flying' && p.flight) {
      const f = p.flight;
      const st = G.flightState(p, t);
      const frac = Math.min(1, Math.max(0, (t - f.dep) / Math.max(1, f.arr - f.dep)));
      const a = G.airportByCode[f.from];
      const b = G.airportByCode[f.to];
      h += `<div class="pw-phase">${st ? PHASE[st.phase] || 'Flying' : 'Flying'}${f.kind && f.kind !== 'scheduled' ? ` <span class="muted">(${esc(f.kind)})</span>` : ''}</div>
        <div class="pw-route"><span><b>${f.from}</b> ${esc(a ? a.city : '')}<small>${clock(f.dep)}</small></span><span class="pw-arrow">→</span>
          <span><b>${f.to}</b> ${esc(b ? b.city : '')}<small>${clock(f.arr)}</small></span></div>
        <div class="pw-bar"><i style="width:${(frac * 100).toFixed(1)}%"></i></div>
        <div class="pw-grid">
          <span>Speed</span><b>${st ? `${st.speedKmh} km/h` : '–'}</b><small>${st ? `${Math.round(st.speedKmh / 1.852)} kt` : ''}</small>
          <span>Height</span><b>${st && !st.ground ? `${(Math.round(st.altFt / 100) * 100).toLocaleString('de-CH')} ft` : 'on the ground'}</b><small>${st && !st.ground ? `${Math.round(st.altFt * 0.3048).toLocaleString('de-CH')} m` : ''}</small>
          <span>Left</span><b>${G.fmtDuration(Math.max(0, Math.round(f.arr - t)))}</b><small>${Math.round(G.dist(f.from, f.to) * (1 - frac))} km</small>
          ${st && st.depRunway ? `<span>Runways</span><b>${st.depRunway} → ${st.arrRunway}</b><small>off · on</small>` : ''}
          ${f.pax != null ? `<span>On board</span><b>${f.pax} / ${ac.seats}</b><small>passengers</small>` : ''}
        </div>`;
    } else {
      const ap = G.airportByCode[p.location];
      const next = nextLeg(p, t);
      const gate = G.gateOf(p.location, p.id);
      h += `<div class="pw-phase">${p.status === 'turnaround' ? 'Turnaround' : 'At the gate'}</div>
        <div class="pw-route"><span><b>${p.location}</b> ${esc(ap ? ap.city : '')}<small>stand ${esc(gate.name || '–')}</small></span>
          ${next ? `<span class="pw-arrow">→</span><span><b>${next.to}</b> ${esc(G.airportByCode[next.to].city)}<small>leaves ${clock(next.dep)}</small></span>` : ''}</div>
        <div class="pw-grid"><span>Speed</span><b>0 km/h</b><small></small><span>Next</span><b>${next ? `${next.from} → ${next.to} at ${clock(next.dep)}` : 'no timetable'}</b><small></small></div>`;
    }
    h += `<div class="muted small">${p.schedule.legs ? `${p.schedule.legs.length} flights a day${p.schedule.active ? '' : ' · paused'}` : 'No timetable yet'}
      · ${p.stats.flights} flights flown · ${p.ownership === 'owned' ? 'owned' : 'leased'}
      · <span title="${D.looks[p.type].span} m wingspan: it needs stands and slots of this class or bigger">class ${G.CLASSES[G.typeClass(p.type)]}</span></div>`;
    pw.win.body.querySelector('.pw-stats').innerHTML = h;
    runways(p);
  }
  // Which runway it takes at each airport of its day: Auto (the shortest one it can use, so the long ones stay
  // free for the big planes) or one chosen here (G.setRunway). Drawn again only when its airports change.
  function runways(p) {
    const codes = [...new Set([
      ...(p.status === 'flying' && p.flight ? [p.flight.from, p.flight.to] : [p.location]),
      ...(p.schedule.legs || []).map((l) => l.from),
    ])].filter((c) => G.airportRunways(c).length).slice(0, 8);
    const sig = `${p.id}|${codes.join(',')}|${JSON.stringify(p.runways || {})}|${codes.map((c) => G.airportRunways(c).length).join(',')}`;
    if (sig === pw.rwSig) return;
    const box = pw.win.body.querySelector('.pw-rw');
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return; // (being picked)
    pw.rwSig = sig;
    const mine = p.runways || {};
    box.innerHTML = `<div class="pw-rw-head">Runways <span class="muted small">(from its next flight there on)</span></div>${codes.map((c) => {
      const list = G.runwayChoices(p.type, c);
      return `<label class="pw-rw-row"><b>${c}</b><select data-pw-rw="${c}">
        <option value="auto">Auto · the shortest it can use</option>
        ${list.map((r) => `<option value="${r.key}"${mine[c] === r.key ? ' selected' : ''}${r.ok ? '' : ' disabled'}>${r.name} · ${r.len.toLocaleString('de-CH')} m${r.paved ? '' : ' grass'}${r.why ? ` – ${r.why}` : ''}</option>`).join('')}
      </select></label>`;
    }).join('')}`;
  }
  function onChange(e) {
    const sel = e.target.closest('[data-pw-rw]');
    if (!sel || !pw.id) return;
    const err = G.setRunway(pw.id, sel.dataset.pwRw, sel.value);
    if (err && FG.ui.toast) FG.ui.toast(err, true);
    pw.rwSig = null;
    update();
  }
  // The next departure of its timetable from now on.
  function nextLeg(p, t) {
    const legs = p.schedule.legs;
    if (!legs || !legs.length) return null;
    const now = ((t % DAY) + DAY) % DAY;
    const later = legs.filter((l) => l.from === p.location).sort((x, y) => ((x.dep - now + DAY) % DAY) - ((y.dep - now + DAY) % DAY));
    return later[0] || null;
  }

  // ---------- the timetable window ----------
  function showTimetable() {
    if (!FG.planner.editing()) return;
    if (!pw.tt || !pw.tt.shown) {
      pw.tt = FG.win.open('timetable', { className: 'tt-win', width: 520, at: [440, 64], onClose: () => { FG.planner.closeEditor(); G.dirty = true; } });
      const body = pw.tt.body;
      body.onclick = (e) => {
        const el = e.target.closest('[data-pl]');
        if (el && el.tagName !== 'SELECT' && el.tagName !== 'INPUT') { FG.planner.action(el); G.dirty = true; renderTimetable(true); }
      };
      body.onchange = (e) => { FG.planner.change(e.target); G.dirty = true; renderTimetable(true); };
      body.oninput = (e) => FG.planner.input(e.target);
    } else FG.win.front(pw.tt.el);
    renderTimetable(true);
  }
  // Drawn again with the game (not while a field in it is being typed in or dragged).
  function renderTimetable(force) {
    if (!pw.tt || !pw.tt.shown) return;
    const id = FG.planner.editing();
    if (!id) { pw.tt.onClose = null; pw.tt.close(); return; }
    const a = document.activeElement;
    if (!force && a && pw.tt.el.contains(a) && a.matches('input, select, textarea')) return;
    const p = G.plane(id);
    pw.tt.title(`🗓 Timetable · ${esc(G.planeName(p))}`);
    const html = FG.planner.editorHtml();
    if (html !== pw.tt.last) { pw.tt.last = html; pw.tt.body.innerHTML = html; }
  }

  FG.planeWin = {
    open,
    get id() { return pw.win && pw.win.shown ? pw.id : null; },
    showTimetable,
    render() { renderTimetable(false); },
  };
})();
