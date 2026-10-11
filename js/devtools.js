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
          <button data-dev="plane" data-kind="crash"${p && p.status === 'flying' ? '' : ' disabled'}>Crash now</button>
          <button data-dev="plane" data-kind="incident"${p ? '' : ' disabled'}>Incident</button>
          <button data-dev="plane" data-kind="ready"${p ? '' : ' disabled'}>Repair &amp; ready</button>
          <button data-dev="plane" data-kind="own"${p && p.ownership === 'leased' ? '' : ' disabled'}>Make owned</button>
          <button data-dev="plane" data-kind="remove"${p ? '' : ' disabled'}>Remove</button>
        </div>
      </section>
      <section><h4>Airport <span class="muted">${ap ? `${esc(ap)} – ${esc(G.airportByCode[ap].name)}` : 'none'}</span></h4>
        <div class="dev-row">
          <button data-dev="airport" data-kind="slot"${ap && !s.slots[ap] ? '' : ' disabled'}>Free slot</button>
          <button data-dev="airport" data-kind="stake"${ap ? '' : ' disabled'}>Own 100%</button>
          <button data-dev="finish"${s.projects.length ? '' : ' disabled'}>Finish all construction (${s.projects.length})</button>
          <button data-dev="preview" title="Shows on the map where new runways, taxiways, stands and buildings would go at the selected airport">${FG.devPreview ? 'Hide' : 'Show'} expansion preview</button>
        </div>
      </section>
      <section><h4>Events <span class="muted">${G.activeEffects().length} active</span></h4>
        <div class="dev-row"><select id="dev-event">${options(D.worldEvents.map((e) => [e.id, e.id]), dv.event)}</select>
          <button data-dev="event">Trigger</button>
          <button data-dev="clearEffects">Clear all</button></div>
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
      case 'event': triggerEvent(); break;
      case 'clearEffects': clearEffects(); break;
      case 'skip': skip(Number(d.min), d.label); break;
      case 'rest': refreshCrews(); break;
      case 'market': newMarket(); break;
      default:
    }
  }

  function onChange(e) {
    const t = e.target;
    if (t.id === 'dev-type') dv.type = t.value;
    if (t.id === 'dev-at') dv.at = t.value;
    if (t.id === 'dev-own') dv.ownership = t.value;
    if (t.id === 'dev-event') dv.event = t.value;
    if (t.id === 'dev-count') dv.count = Math.max(1, Math.min(20, Math.round(Number(t.value)) || 1));
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
