// Developer tools: a cheat panel for testing (money, planes, slots, events, time).
// Open it with Developer tools in the ⋯ menu or F2. Uses only FG.game and FG.ui.
(function () {
  const G = FG.game;
  const D = FG.data;
  const C = () => FG.config;
  const DAY = 24 * 60;

  const dv = {
    open: false,
    type: null, // aircraft type to add
    at: null, // airport for new planes
    count: 1,
    ownership: 'owned',
    event: null, // world event id
    incident: 'birdStrike', // in-flight incident to spawn on the selected plane
    emergency: 'engineFire', // in-flight emergency to spawn on the selected plane
    wdir: 270, // wind to place: from (°), speed (kt), radius (km)
    wkt: 40,
    wkm: 200,
    picking: null, // the map click handler while a wind is being placed on the map
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function note(msg, bad) {
    const el = $('dev-msg');
    if (!el) return;
    el.textContent = msg;
    el.className = bad ? 'bad' : '';
  }

  // Every cheat is logged, so the game log shows that dev tools were used.
  function done(msg) {
    G.state.devUsed = true;
    G.log(`🛠 Dev: ${msg}`, 'info');
    G.dirty = true;
    render();
    note(msg);
  }

  function addMoney(amount) {
    const s = G.state;
    s.money += amount;
    if (s.money >= G.bankruptcyLimit()) s.gameOver = false;
    done(`${amount < 0 ? 'removed' : 'added'} ${G.fmtMoney(Math.abs(amount))}.`);
  }

  function setMoney(amount) {
    if (!Number.isFinite(amount)) { note('Enter a number.', true); return; }
    G.state.money = Math.round(amount);
    if (G.state.money >= G.bankruptcyLimit()) G.state.gameOver = false;
    done(`money set to ${G.fmtMoney(G.state.money)}.`);
  }

  function giveSlot(code) {
    if (!code) { note('Pick an airport first.', true); return false; }
    if (!G.state.slots[code]) G.state.slots[code] = { since: G.state.time };
    return true;
  }

  function addPlanes() {
    const { type, at, ownership } = dv;
    if (!D.aircraft[type] || !G.airportByCode[at]) { note('Pick a type and an airport.', true); return; }
    giveSlot(at);
    const ids = [];
    for (let i = 0; i < dv.count; i++) ids.push(G.addPlane(type, at, ownership, 0));
    done(`${ids.length}× ${D.aircraft[type].name} (${ownership}) at ${at}: ${ids.join(', ')}.`);
  }

  function selectedPlane() {
    return FG.ui && FG.ui.selectedPlane ? G.plane(FG.ui.selectedPlane) : null;
  }
  function selectedAirport() {
    return (FG.ui && FG.ui.selectedAirport) || dv.at;
  }

  function planeAction(kind) {
    const p = selectedPlane();
    if (!p) { note('Select a plane first (click it on the map or in the fleet).', true); return; }
    const s = G.state;
    switch (kind) {
      case 'crash':
        if (p.status !== 'flying') { note(`${p.id} must be in the air to crash.`, true); return; }
        G.crash(p);
        done(`crashed ${p.id}.`);
        break;
      case 'emergency':
        if (p.status !== 'flying') { note(`${p.id} must be in the air for an emergency.`, true); return; }
        if (p.flight.emergency) { note(`${p.id} has already declared an emergency.`, true); return; }
        G.emergency(p);
        done(`emergency on ${p.id}${p.flight.crashAt ? ' (it will crash)' : ' (it will land safely)'}.`);
        break;
      case 'incident': {
        const f = p.flight || { from: p.location, to: p.location };
        G.incident(p, f);
        if (p.status === 'idle') p.status = 'turnaround';
        done(`incident on ${p.id}.`);
        break;
      }
      case 'ready':
        p.readyAt = s.time;
        p.repair = null;
        if (p.status === 'turnaround') p.status = 'idle';
        { const c = G.crewOf(p); if (c) c.dutyToday = 0; }
        done(`${p.id} repaired and ready.`);
        break;
      case 'own':
        p.ownership = 'owned';
        done(`${p.id} is now owned.`);
        break;
      case 'remove':
        if (s.planes.length === 1) { note('Keep at least one plane.', true); return; }
        s.planes = s.planes.filter((x) => x !== p);
        s.crews = s.crews.filter((c) => c.id !== p.crewId);
        done(`removed ${p.id} for free.`);
        break;
      default:
    }
  }

  // Spawn a chosen incident or emergency on the selected plane (the game's own stories, costs and groundings).
  const INCIDENT_NAMES = {
    birdStrike: 'Bird strike (a flock of geese)', techFault: 'Smoke in the cabin',
    unruly: 'Unruly passenger', doorPlug: 'Door panel blows out',
  };
  function spawnIncident() {
    const p = selectedPlane();
    if (!p) { note('Select a plane first (click it on the map or in the fleet).', true); return; }
    const f = p.flight || { from: p.location, to: p.location };
    G.incident(p, f, dv.incident);
    if (p.status === 'idle') p.status = 'turnaround';
    done(`${INCIDENT_NAMES[dv.incident] || dv.incident} on ${p.id}.`);
  }

  function spawnEmergency() {
    const p = selectedPlane();
    if (!p) { note('Select a plane first (click it on the map or in the fleet).', true); return; }
    if (p.status !== 'flying') { note(`${p.id} must be in the air for an emergency.`, true); return; }
    if (p.flight.emergency) { note(`${p.id} has already declared an emergency.`, true); return; }
    G.emergency(p, dv.emergency);
    done(`${D.emergencies.find((e) => e.id === dv.emergency).what} on ${p.id}${p.flight.crashAt ? ' (it will crash)' : ' (it will land safely)'}.`);
  }

  function airportAction(kind) {
    const code = selectedAirport();
    if (!code || !G.airportByCode[code]) { note('Select an airport first.', true); return; }
    switch (kind) {
      case 'slot':
        giveSlot(code);
        done(`free slot at ${code}.`);
        break;
      case 'stake':
        giveSlot(code);
        G.infraOf(code).stake = 100;
        done(`you now own 100% of ${code}.`);
        break;
      default:
    }
  }

  // Expansion preview: the maps draw where construction at the selected airport would go
  // (G.expansionPreview) while FG.devPreview is set. Not a cheat, so nothing is logged.
  function togglePreview() {
    FG.devPreview = !FG.devPreview;
    if (FG.view3d) FG.view3d.gatesDirty = true;
    G.dirty = true;
    render();
  }

  // The terminal concepts apronOf can lay out, and four example airports in the Sahara (Gilf Kebir) that
  // are alike but for the concept, to compare them side by side.
  const STYLES = [['', 'Auto'], ['linear', 'Linear'], ['pier', 'Pier'], ['satellite', 'Satellite'], ['copy', 'Copy of a real one']];
  const EXAMPLES = [
    { code: 'XLI', style: 'linear', lat: 23.045 },
    { code: 'XPI', style: 'pier', lat: 23.0 },
    { code: 'XSA', style: 'satellite', lat: 22.955 },
    { code: 'XRE', style: 'copy', lat: 22.91 },
  ];
  const isExample = (code) => EXAMPLES.some((e) => e.code === code);

  function relayout() { // the airport layouts changed
    if (FG.layouts) FG.layouts.version++;
    if (FG.view3d) FG.view3d.gatesDirty = true;
  }

  function setStyle(style) {
    const code = selectedAirport();
    if (!code || !G.airportByCode[code]) { note('Select an airport first.', true); return; }
    const real = G.apronOf(code).real;
    if (real && !real.copy) { note(`${code} has its real layout.`, true); return; }
    if (style) G.infraOf(code).style = style;
    else delete G.infraOf(code).style;
    relayout();
    done(`${code}: ${style || 'automatic'} terminal.`);
  }

  function exampleAirports() {
    const s = G.state;
    if (s.built.some((a) => isExample(a.code))) {
      if (EXAMPLES.some((e) => JSON.stringify(s.planes).includes(`"${e.code}"`))) {
        note('Planes fly to the example airports: move them and clear their timetables first.', true);
        return;
      }
      s.built = s.built.filter((a) => !isExample(a.code));
      for (const e of EXAMPLES) { delete s.infra[e.code]; delete s.slots[e.code]; }
      G.registerBuilt();
      if (isExample(dv.at)) dv.at = null;
      if (FG.ui && isExample(FG.ui.selectedAirport)) FG.ui.clearSelection();
      relayout();
      done('removed the example airports in the desert.');
      return;
    }
    if (EXAMPLES.some((e) => G.airportByCode[e.code])) { note('An airport already has one of the example codes.', true); return; }
    for (const e of EXAMPLES) {
      const name = `Desert ${e.style[0].toUpperCase()}${e.style.slice(1)} Terminal`;
      s.built.push({ code: e.code, name, city: 'Gilf Kebir', country: 'EG', lat: e.lat, lon: 26.5, size: 4, built: true, open: true });
    }
    G.registerBuilt();
    for (const e of EXAMPLES) {
      const inf = G.infraOf(e.code);
      inf.stake = 100;
      inf.style = e.style;
      inf.runways = [G.plannedRunway({ code: e.code, kind: 'runway', len: 3000 }).runway.map((v, i) => (i < 4 ? Math.round(v * 1e5) / 1e5 : v))];
    }
    relayout();
    if (FG.ui && FG.ui.showAirport) FG.ui.showAirport('XPI');
    done('built four example airports in the Sahara: linear (XLI), pier (XPI), satellite (XSA), copy of a real terminal (XRE).');
  }

  function finishProjects() {
    const s = G.state;
    if (!s.projects.length) { note('No construction under way.'); return; }
    const n = s.projects.length;
    s.projects.forEach((p) => { p.done = s.time; });
    G.finishProjects();
    done(`finished ${n} construction project${n > 1 ? 's' : ''}.`);
  }

  function triggerEvent() {
    const ev = D.worldEvents.find((e) => e.id === dv.event);
    if (!ev) return;
    G.state.effects = G.activeEffects();
    const story = ev.make(G.eventContext());
    if (!story) { note(`"${ev.id}" did not fire (it needs a fitting airport with your slot).`, true); return; }
    G.news(story);
    done(`triggered ${ev.id}.`);
  }

  function clearEffects() {
    G.state.effects = [];
    done('cleared all active events.');
  }

  function skip(minutes, label) {
    G.advance(minutes);
    done(`skipped ${label}.`);
  }

  function refreshCrews() {
    G.state.crews.forEach((c) => { c.dutyToday = 0; });
    G.state.planes.forEach((p) => { if (p.status !== 'flying') { p.readyAt = G.state.time; p.repair = null; } });
    done('all crews rested, all planes ready.');
  }

  // ---------- wind ----------
  // A wind placed by hand (G.placeWind): it blows from dv.wdir at dv.wkt knots within dv.wkm km, at every height;
  // planes crab into it and the runways there turn into it. Shown on the maps by js/weather.js.
  function placeWind(lat, lon) {
    const err = G.placeWind(lat, lon, dv.wdir, dv.wkt, dv.wkm);
    if (err) { note(err, true); return; }
    windDone(`wind from ${String(dv.wdir).padStart(3, '0')}° at ${dv.wkt} kt placed near ${G.nearestPlace(lat, lon)} (${dv.wkm} km round).`);
  }
  // (the maps show it at once, not with the next weather tick)
  function windDone(msg) {
    if (FG.weather && FG.weather.syncWinds) FG.weather.syncWinds();
    done(msg);
  }
  function mapCentre() {
    const m3 = FG.view3d && FG.view3d.on && FG.view3d.map;
    const c = m3 ? m3.getCenter() : FG.ui.map.getCenter();
    return [c.lat, c.lng];
  }
  // Click on the map (2D or 3D) to place it; the button again stops.
  function pickWind() {
    const m3 = FG.view3d && FG.view3d.on && FG.view3d.map;
    const stop = () => {
      if (!dv.picking) return;
      dv.picking.map.off('click', dv.picking.fn);
      dv.picking = null;
      $('map').classList.remove('wind-pick');
    };
    if (dv.picking) { stop(); render(); return; }
    const map = m3 || FG.ui.map;
    const fn = (e) => {
      const ll = e.lngLat || e.latlng;
      stop();
      placeWind(ll.lat, ll.lng);
    };
    map.on('click', fn);
    dv.picking = { map, fn };
    $('map').classList.add('wind-pick');
    note('Click on the map where the wind should blow.');
    render();
  }

  function newMarket() {
    G.refreshMarket();
    done('new used-aircraft offers.');
  }

  // ---------- panel ----------
  function options(list, value) {
    return list.map(([v, label]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }

  function render() {
    const el = $('devtools');
    if (!el || !dv.open) return;
    const s = G.state;
    const types = Object.entries(D.aircraft)
      .sort((a, b) => a[1].maker.localeCompare(b[1].maker) || a[1].seats - b[1].seats);
    if (!D.aircraft[dv.type]) dv.type = types[0][0];
    const slotCodes = Object.keys(s.slots).sort();
    const sel = FG.ui && FG.ui.selectedAirport;
    if (!G.airportByCode[dv.at]) dv.at = sel || slotCodes[0] || G.home();
    const atList = [...new Set([dv.at, sel, ...slotCodes].filter(Boolean))]
      .map((c) => [c, `${c} – ${G.airportByCode[c].name}${s.slots[c] ? '' : ' (no slot yet)'}`]);
    if (!dv.event) dv.event = D.worldEvents[0].id;
    const p = selectedPlane();
    const flying = p && p.status === 'flying';
    const ap = selectedAirport();

    el.innerHTML = `
      <div class="dev-head"><b>🛠 Developer tools</b><button class="mini" data-dev="close" title="Close (F2)">✕</button></div>
      <section><h4>Money <span class="muted">${G.fmtMoney(s.money)}</span></h4>
        <div class="dev-row">
          <button data-dev="money" data-amount="100000">+100k</button>
          <button data-dev="money" data-amount="1000000">+1M</button>
          <button data-dev="money" data-amount="10000000">+10M</button>
          <button data-dev="money" data-amount="100000000">+100M</button>
          <button data-dev="money" data-amount="-1000000">−1M</button>
        </div>
        <div class="dev-row"><input id="dev-money" type="number" step="100000" placeholder="Amount">
          <button data-dev="setMoney">Set</button></div>
      </section>
      <section><h4>Add planes <span class="muted">free, delivered instantly</span></h4>
        <div class="dev-row"><select id="dev-type">${options(types.map(([id, a]) => [id, `${a.maker} – ${a.name} (${a.seats})`]), dv.type)}</select></div>
        <div class="dev-row"><select id="dev-at">${options(atList, dv.at)}</select></div>
        <div class="dev-row">
          <select id="dev-own">${options([['owned', 'Owned'], ['leased', 'Leased']], dv.ownership)}</select>
          <input id="dev-count" type="number" min="1" max="20" value="${dv.count}" title="How many">
          <button class="primary" data-dev="addPlanes">Add</button>
        </div>
        <div class="muted small">Tip: select an airport on the map to deliver there. A missing slot is added for free.</div>
      </section>
      <section><h4>Selected plane <span class="muted">${p ? `${esc(p.id)} · ${esc(D.aircraft[p.type].name)} · ${p.status}` : 'none'}</span></h4>
        <div class="dev-row">
          <button data-dev="plane" data-kind="emergency"${p && p.status === 'flying' ? '' : ' disabled'}>Emergency</button>
          <button data-dev="plane" data-kind="crash"${p && p.status === 'flying' ? '' : ' disabled'}>Crash now</button>
          <button data-dev="plane" data-kind="incident"${p ? '' : ' disabled'}>Incident</button>
          <button data-dev="plane" data-kind="ready"${p ? '' : ' disabled'}>Repair &amp; ready</button>
          <button data-dev="plane" data-kind="own"${p && p.ownership === 'leased' ? '' : ' disabled'}>Make owned</button>
          <button data-dev="plane" data-kind="remove"${p ? '' : ' disabled'}>Remove</button>
        </div>
        <div class="dev-row">
          <select id="dev-incident" title="An in-flight incident: the plane is grounded for repairs">${options(D.incidents.map((i) => [i.id, INCIDENT_NAMES[i.id] || i.id]), dv.incident)}</select>
          <button data-dev="spawnIncident"${p ? '' : ' disabled'}>Spawn incident</button>
        </div>
        <div class="dev-row">
          <select id="dev-emergency" title="An in-flight emergency: needs a plane in the air">${options(D.emergencies.map((e) => [e.id, e.what]), dv.emergency)}</select>
          <button data-dev="spawnEmergency"${flying && !p.flight.emergency ? '' : ' disabled'}>Spawn emergency</button>
        </div>
      </section>
      <section><h4>Airport <span class="muted">${ap ? `${esc(ap)} – ${esc(G.airportByCode[ap].name)}` : 'none'}</span></h4>
        <div class="dev-row">
          <button data-dev="airport" data-kind="slot"${ap && !s.slots[ap] ? '' : ' disabled'}>Free slot</button>
          <button data-dev="airport" data-kind="stake"${ap ? '' : ' disabled'}>Own 100%</button>
          <button data-dev="finish"${s.projects.length ? '' : ' disabled'}>Finish all construction (${s.projects.length})</button>
          <button data-dev="preview" title="Shows on the map where new runways, taxiways, stands and buildings would go at the selected airport">${FG.devPreview ? 'Hide' : 'Show'} expansion preview</button>
        </div>
        <div class="dev-row">
          <select id="dev-style" title="Terminal concept of the selected airport (where the game lays it out)"${ap ? '' : ' disabled'}>${options(STYLES.map(([v, label]) => [v, `Terminal: ${label}`]), (ap && s.infra[ap] && s.infra[ap].style) || '')}</select>
          <button data-dev="examples" title="Four airports in the Sahara that differ only in the terminal: linear, pier, satellite, copy of a real one">${s.built.some((a) => isExample(a.code)) ? 'Remove' : 'Build'} desert examples</button>
        </div>
      </section>
      <section><h4>Airport editor <span class="muted">F3</span></h4>
        <div class="dev-row">
          <button data-dev="airportEdit" class="${FG.airportEdit && FG.airportEdit.on ? 'primary' : ''}" title="Click on the map where an airport is wrong: redraw, straighten or add runways, taxiways, aprons, buildings and stands. Saved fixes are in every game.">✏️ ${FG.airportEdit && FG.airportEdit.on ? 'Close' : 'Fix airports on the map'}</button>
          ${FG.fixes ? `<span class="muted small">${FG.fixes.codes().length} airport${FG.fixes.codes().length === 1 ? '' : 's'} fixed${FG.fixes.unsaved().length ? `, ${FG.fixes.unsaved().length} not saved` : ''}</span>` : ''}
        </div>
      </section>
      <section><h4>Airport checklist <span class="muted">F8</span></h4>
        <div class="dev-row">
          <button data-dev="airportCheck" class="${FG.checks && FG.checks.open ? 'primary' : ''}" title="Every airport in order (start airports, then the busiest): an agent marks it blue when checked, a person green when good">✅ ${FG.checks && FG.checks.open ? 'Close' : 'Check airports'}</button>
        </div>
      </section>
      <section><h4>Events <span class="muted">${G.activeEffects().length} active</span></h4>
        <div class="dev-row"><select id="dev-event">${options(D.worldEvents.map((e) => [e.id, e.id]), dv.event)}</select>
          <button data-dev="event">Trigger</button>
          <button data-dev="clearEffects">Clear all</button></div>
      </section>
      <section><h4>Wind <span class="muted">${s.winds && s.winds.length ? `${s.winds.length} placed` : 'only the weather\'s own'}</span></h4>
        <div class="row dev-wind"><label>From <input id="dev-wdir" type="number" min="0" max="359" step="5" value="${dv.wdir}">°</label>
          <span class="dev-compass">${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((n, i) =>
    `<button class="mini${dv.wdir === i * 45 ? ' on' : ''}" data-dev="wdir" data-v="${i * 45}" title="Wind from the ${n} (${i * 45}°)">${n}</button>`).join('')}</span></div>
        <div class="row dev-wind"><label>Speed <input id="dev-wkt" type="range" min="0" max="120" step="5" value="${dv.wkt}"></label>
          <b id="dev-wkt-v">${dv.wkt} kt</b>
          <label>Radius <select id="dev-wkm">${options([50, 100, 200, 400, 1000].map((k) => [String(k), `${k} km`]), String(dv.wkm))}</select></label></div>
        <div class="row"><button class="${dv.picking ? 'primary' : ''}" data-dev="windPick" title="Then click on the map (2D or 3D) where it should blow">${dv.picking ? 'Click on the map… (here to stop)' : '🌬 Place on the map'}</button>
          <button data-dev="windHere">At the map centre</button>
          ${ap ? `<button data-dev="windAirport">At ${esc(ap)}</button>` : ''}</div>
        ${(s.winds || []).map((w) => `<div class="row dev-wind-row"><span title="${w.lat}, ${w.lon}">🌬 ${esc(G.nearestPlace(w.lat, w.lon))}</span>
          <label>from <input type="number" class="dev-wnum" data-wind="${w.id}" data-k="from" min="0" max="359" step="5" value="${w.from}">°</label>
          <label><input type="number" class="dev-wnum" data-wind="${w.id}" data-k="kt" min="0" max="150" step="5" value="${w.kt}"> kt</label>
          <span class="muted">${w.km} km</span>
          <button class="mini" data-dev="windDel" data-id="${w.id}" title="Remove this wind">✕</button></div>`).join('')}
        ${s.winds && s.winds.length ? '<div class="row"><button data-dev="windClear">Remove all winds</button></div>' : ''}
      </section>
      <section><h4>Time &amp; ops</h4>
        <div class="dev-row">
          <button data-dev="skip" data-min="60" data-label="1 hour">+1 h</button>
          <button data-dev="skip" data-min="${DAY}" data-label="1 day">+1 day</button>
          <button data-dev="skip" data-min="${7 * DAY}" data-label="1 week">+1 week</button>
          <button data-dev="rest">Rest crews</button>
          <button data-dev="market">New market</button>
        </div>
      </section>
      <div id="dev-msg"></div>`;
  }

  function onClick(e) {
    const b = e.target.closest('[data-dev]');
    if (!b || b.disabled) return;
    const d = b.dataset;
    switch (d.dev) {
      case 'close': toggle(false); break;
      case 'money': addMoney(Number(d.amount)); break;
      case 'setMoney': setMoney(parseFloat($('dev-money').value)); break;
      case 'addPlanes': addPlanes(); break;
      case 'plane': planeAction(d.kind); break;
      case 'airport': airportAction(d.kind); break;
      case 'finish': finishProjects(); break;
      case 'preview': togglePreview(); break;
      case 'airportEdit': if (FG.airportEdit) { FG.airportEdit.toggle(); render(); } break;
      case 'airportCheck': if (FG.checks && FG.checks.toggle) { FG.checks.toggle(); render(); } break;
      case 'examples': exampleAirports(); break;
      case 'event': triggerEvent(); break;
      case 'spawnIncident': spawnIncident(); break;
      case 'spawnEmergency': spawnEmergency(); break;
      case 'clearEffects': clearEffects(); break;
      case 'skip': skip(Number(d.min), d.label); break;
      case 'rest': refreshCrews(); break;
      case 'market': newMarket(); break;
      case 'wdir': dv.wdir = Number(d.v); render(); break;
      case 'windPick': pickWind(); break;
      case 'windHere': { const [lat, lon] = mapCentre(); placeWind(lat, lon); break; }
      case 'windAirport': { const a = G.airportByCode[selectedAirport()]; if (a) placeWind(a.lat, a.lon); break; }
      case 'windDel': G.removeWind(Number(d.id)); windDone('wind removed.'); break;
      case 'windClear': G.clearWinds(); windDone('all placed winds removed.'); break;
      default:
    }
  }

  function onChange(e) {
    const t = e.target;
    if (t.id === 'dev-type') dv.type = t.value;
    if (t.id === 'dev-at') dv.at = t.value;
    if (t.id === 'dev-own') dv.ownership = t.value;
    if (t.id === 'dev-event') dv.event = t.value;
    if (t.id === 'dev-incident') dv.incident = t.value;
    if (t.id === 'dev-emergency') dv.emergency = t.value;
    if (t.id === 'dev-style') setStyle(t.value);
    if (t.id === 'dev-count') dv.count = Math.max(1, Math.min(20, Math.round(Number(t.value)) || 1));
    if (t.id === 'dev-wdir') dv.wdir = ((Math.round(Number(t.value)) || 0) % 360 + 360) % 360;
    if (t.id === 'dev-wkt') dv.wkt = Number(t.value);
    if (t.id === 'dev-wkm') dv.wkm = Number(t.value);
    if (t.dataset.wind) { // a placed wind's direction or speed
      const err = G.setWind(Number(t.dataset.wind), { [t.dataset.k]: Number(t.value) });
      const w = G.state.winds.find((x) => x.id === Number(t.dataset.wind));
      if (err || !w) note(err || 'No such wind.', true);
      else windDone(`wind near ${G.nearestPlace(w.lat, w.lon)} now from ${String(w.from).padStart(3, '0')}° at ${w.kt} kt.`);
    }
  }

  function toggle(open = !dv.open) {
    dv.open = open;
    $('devtools').hidden = !open;
    $('devtools-toggle').classList.toggle('active', open);
    if (open) {
      // Planes are delivered to the selected airport, if there is one.
      if (FG.ui && FG.ui.selectedAirport) dv.at = FG.ui.selectedAirport;
      render();
    }
  }

  // Keep the selection and balances current, but never while a control is in use.
  function refresh() {
    const el = $('devtools');
    if (!dv.open || el.querySelector('select:focus, input:focus')) return;
    const msg = $('dev-msg');
    const keep = msg ? [msg.textContent, msg.className] : null;
    render();
    if (keep) { $('dev-msg').textContent = keep[0]; $('dev-msg').className = keep[1]; }
  }

  function init() {
    const el = $('devtools');
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    // (the speed shows while the slider moves)
    el.addEventListener('input', (e) => { if (e.target.id === 'dev-wkt') { dv.wkt = Number(e.target.value); $('dev-wkt-v').textContent = `${dv.wkt} kt`; } });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'dev-money') setMoney(parseFloat(e.target.value));
      e.stopPropagation(); // typing here must not pause the game or move the speed slider
    });
    $('devtools-toggle').addEventListener('click', () => toggle());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F2') { toggle(); e.preventDefault(); }
    });
    setInterval(refresh, 500);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
