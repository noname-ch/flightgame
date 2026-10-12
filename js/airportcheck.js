// Airport checklist (developer tools, F4): every airport in the order to check them. The start airports come
// first, then the world's busiest (js/data/busiest.js), then every other airport by size. An agent looks at an
// airport and marks it blue (checked), then a person looks again and marks it green (good) or red (needs work).
// The marks are in js/data/checks.js: { CODE: { s: 'checked' | 'ok' | 'bad', by, at: 'YYYY-MM-DD', note } }.
// They are saved like the airport fixes (js/fixes.js): through the dev server (./play.sh), as a commit on GitHub
// (signed in), or only in this browser. Agents mark airports with tools/checks.mjs, which loads this file too.
(function () {
  const D = FG.data;
  const STATES = {
    checked: { dot: '🔵', label: 'Checked', who: 'an agent looked at it' },
    ok: { dot: '🟢', label: 'Good', who: 'a person approved it' },
    bad: { dot: '🔴', label: 'Needs work', who: 'a person found something wrong' },
  };
  const OPEN = { dot: '⬜', label: 'To check' };
  const KEYS = ['s', 'by', 'at', 'note'];

  // A mark with its fields in one order (so every writer gives the same file).
  function clean(m) {
    if (!m || !STATES[m.s]) return null;
    const out = {};
    for (const k of KEYS) if (m[k] != null && m[k] !== '') out[k] = String(m[k]);
    return out;
  }
  // The text of js/data/checks.js (tools/serve.py and tools/checks.mjs write the same): one airport per line.
  const HEADER = '// Airport checklist (developer tools, F4), see js/airportcheck.js: s = checked (blue, an agent looked at it),\n' +
    '// ok (green, a person approved it) or bad (red, needs work). Written by tools/serve.py, tools/checks.mjs or a commit\n' +
    '// from the game: commit this file to give everyone the checks.\n';
  function fileText(all) {
    const lines = Object.keys(all).sort().filter((c) => clean(all[c])).map((c) => `${JSON.stringify(c)}: ${JSON.stringify(clean(all[c]))}`);
    return `${HEADER}FG.data.checks = {\n${lines.join(',\n')}${lines.length ? '\n' : ''}};\n`;
  }
  const parseFile = (text) => JSON.parse(text.slice(text.indexOf('=', text.indexOf('FG.data.checks')) + 1).trim().replace(/;\s*$/, '')
    .replace(/,(\s*})$/, '$1'));

  // Every airport in checking order: [{ code, why: 'start' | 'busy' | 'size', rank }] (rank: busiest place).
  let order = null;
  let orderOf = 0;
  function orderList() {
    if (order && orderOf === D.airports.length) return order;
    const byCode = new Map(D.airports.map((a) => [a.code, a]));
    const seen = new Set();
    order = [];
    const put = (code, why, rank) => {
      if (seen.has(code) || !byCode.has(code)) return;
      seen.add(code);
      order.push({ code, why, rank });
    };
    for (const codes of Object.values(FG.config.startAirports || {})) for (const c of codes) put(c, 'start');
    (D.busiest || []).forEach((c, i) => put(c, 'busy', i + 1));
    D.airports.filter((a) => !seen.has(a.code))
      .sort((a, b) => (b.size - a.size) || (!!a.extra - !!b.extra) || (!!a.minor - !!b.minor) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
      .forEach((a) => put(a.code, 'size'));
    orderOf = D.airports.length;
    return order;
  }

  FG.checks = { STATES, OPEN, clean, fileText, parseFile, order: orderList };
  if (typeof document === 'undefined') return; // (tools/checks.mjs: no page)

  // ---------- the marks: the file's, with this browser's changes on top ----------
  const LOCAL = 'flightgame.checks';      // code -> mark (null: cleared) not in the file yet
  const SENT = 'flightgame.checks.sent';  // code -> when it was committed to GitHub
  const SENT_FOR = 3600e3;                // after an hour the website's file is the one that counts
  const NAME = 'flightgame.checks.name';  // who marks here, if not signed in to GitHub
  const repo = Object.assign({}, D.checks);
  let local = {};
  let sent = {};
  let myName = '';
  try { local = JSON.parse(localStorage.getItem(LOCAL)) || {}; } catch (e) { /* none */ }
  try { sent = JSON.parse(localStorage.getItem(SENT)) || {}; } catch (e) { /* none */ }
  try { myName = localStorage.getItem(NAME) || ''; } catch (e) { /* none */ }
  const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));
  const markOf = (code) => (code in local ? clean(local[code]) : clean(repo[code]));
  function keepLocal() {
    try {
      localStorage.setItem(LOCAL, JSON.stringify(local));
      localStorage.setItem(SENT, JSON.stringify(sent));
    } catch (e) { /* full or private: lost on reload */ }
  }
  for (const code of Object.keys(local)) {
    if (same(local[code], repo[code]) || (sent[code] && Date.now() - sent[code] > SENT_FOR)) { delete local[code]; delete sent[code]; }
  }
  keepLocal();
  const pending = () => Object.keys(local).filter((c) => !sent[c]);

  let server = null;
  const serverHere = () => (server = server || fetch('__checks').then((r) => (r.ok ? r.json() : null)).then((j) => !!(j && j.ok)).catch(() => false));
  async function target() {
    if (await serverHere()) return 'server';
    return FG.fixes && FG.fixes.github.user ? 'github' : 'browser';
  }
  async function write(code, mark) {
    try {
      const r = await fetch('__checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, check: mark }) });
      const j = r.ok ? await r.json() : null;
      return !!(j && j.ok);
    } catch (e) {
      return false;
    }
  }
  const today = () => new Date().toISOString().slice(0, 10);
  const who = () => (FG.fixes && FG.fixes.github.user ? FG.fixes.github.user.login : myName || 'someone');

  // Mark an airport (s null: clear it). With the dev server it is in the file at once, else it waits for Save.
  async function mark(code, s, note) {
    const old = markOf(code);
    const m = s ? clean({ s, by: who(), at: today(), note: note != null ? note : old && old.note }) : null;
    local[code] = m;
    delete sent[code];
    keepLocal();
    if (ck.target === 'server') await save();
  }
  async function save() {
    const codes = pending();
    if (!codes.length) return;
    ck.busy = true;
    try {
      if (ck.target === 'server') {
        for (const code of codes) {
          if (await write(code, local[code])) { if (local[code]) repo[code] = local[code]; else delete repo[code]; delete local[code]; } else throw new Error('the dev server did not take them');
        }
        msg(`Saved ${codes.join(', ')} into js/data/checks.js.`);
      } else if (ck.target === 'github') {
        await FG.fixes.github.commitFile('js/data/checks.js', (text) => {
          const all = text ? parseFile(text) : {};
          for (const c of codes) { if (local[c]) all[c] = local[c]; else delete all[c]; }
          return fileText(all);
        }, `Airport checklist: ${codes.map((c) => `${c} ${local[c] ? local[c].s : 'cleared'}`).join(', ')}`);
        for (const c of codes) sent[c] = Date.now();
        msg(`Committed ${codes.join(', ')} to GitHub (the website has them in a minute or two).`);
      }
    } catch (e) {
      msg(`Not saved: ${e.message}`, true);
    }
    ck.busy = false;
    keepLocal();
    render();
  }
  function download() {
    const all = Object.assign({}, repo);
    for (const c of Object.keys(local)) { if (local[c]) all[c] = local[c]; else delete all[c]; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([fileText(all)], { type: 'text/javascript' }));
    a.download = 'checks.js';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- the panel ----------
  const ck = { open: false, filter: 'all', q: '', sel: null, shown: 150, target: 'browser', busy: false, msg: '', bad: false };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const airport = (code) => (FG.game && FG.game.airportByCode[code]) || D.airports.find((a) => a.code === code);
  const stateOf = (code) => { const m = markOf(code); return m ? m.s : 'open'; };

  function msg(text, bad) {
    ck.msg = text;
    ck.bad = !!bad;
    const el = $('ck-msg');
    if (el) { el.textContent = text; el.className = bad ? 'bad' : ''; }
  }
  function matches(o) {
    if (ck.filter !== 'all' && stateOf(o.code) !== ck.filter) return false;
    if (!ck.q) return true;
    const a = airport(o.code);
    const q = ck.q.toLowerCase();
    return o.code.toLowerCase() === q || `${o.code} ${a.name} ${a.city} ${a.country}`.toLowerCase().includes(q);
  }
  const tag = (o) => (o.why === 'start' ? '<span class="ck-tag start" title="A start airport">🏠 start</span>'
    : o.why === 'busy' ? `<span class="ck-tag busy" title="Busiest airports in the world by flights">✈ #${o.rank}</span>`
      : `<span class="ck-tag" title="Airport size 1-5">size ${airport(o.code).size}</span>`);

  function row(o, i) {
    const a = airport(o.code);
    const m = markOf(o.code);
    const st = m ? STATES[m.s] : OPEN;
    const open = ck.sel === o.code;
    let h = `<li class="ck-row ${m ? m.s : 'open'}${open ? ' sel' : ''}" data-ck="select" data-code="${o.code}">
      <span class="ck-n">${i + 1}</span><span class="ck-dot" title="${st.label}">${st.dot}</span>
      <b>${o.code}</b><span class="ck-name">${esc(a.name)}<small> · ${esc(a.country)}</small></span>${tag(o)}${local[o.code] !== undefined && !sent[o.code] ? '<span class="ck-unsaved" title="Not saved yet">•</span>' : ''}</li>`;
    if (open) {
      h += `<li class="ck-detail">
        <div class="muted small">${m ? `${st.dot} ${st.label}, ${esc(m.by || '?')} on ${esc(m.at || '?')} (${st.who})` : 'Nobody has checked it yet.'}</div>
        <textarea id="ck-note" rows="2" placeholder="Note: what was checked or what is wrong">${esc((m && m.note) || '')}</textarea>
        <div class="dev-row">
          <button data-ck="mark" data-s="checked" title="An agent (or you) looked at it">🔵 Checked</button>
          <button data-ck="mark" data-s="ok" title="A person looked again: it is right">🟢 Good</button>
          <button data-ck="mark" data-s="bad" title="Something is wrong: an agent should fix it">🔴 Needs work</button>
          <button data-ck="mark" data-s="" title="Remove the mark"${m ? '' : ' disabled'}>↺ Clear</button>
        </div>
        <div class="dev-row">
          <button data-ck="show">⌖ Show on the map</button>
          <button data-ck="edit" title="Open the airport editor (F3) here">✏️ Fix in the editor</button>
          <button data-ck="next" title="The next airport in this list">Next ▶</button>
        </div></li>`;
    }
    return h;
  }

  function render() {
    const el = $('apcheck');
    if (!el || !ck.open) return;
    const list = orderList();
    const count = { open: 0, checked: 0, ok: 0, bad: 0 };
    let topOk = 0;
    const top = list.filter((o) => o.why !== 'size').length;
    list.forEach((o, i) => { const s = stateOf(o.code); count[s]++; if (i < top && s === 'ok') topOk++; });
    const shown = list.map((o, i) => [o, i]).filter(([o]) => matches(o));
    const waiting = pending();
    const user = FG.fixes && FG.fixes.github.user;
    const nameRow = `<div class="dev-row"><input id="ck-name" placeholder="Your name (shown on your marks)" value="${esc(myName)}"></div>`;
    const where = {
      server: `<div class="muted small">Every mark goes straight into js/data/checks.js (dev server). Commit it to share.</div>${user ? '' : nameRow}`,
      github: `<div class="muted small">Save commits js/data/checks.js to GitHub as <b>${esc(user ? user.login : '')}</b>.</div>`,
      browser: `<div class="muted small">Marks stay in this browser. Sign in to GitHub in the airport editor (F3) to save them for everyone, or download the file.</div>
        ${nameRow}`,
    }[ck.target];
    const pct = (n) => `${((100 * n) / list.length).toFixed(2)}%`;
    el.classList.toggle('beside', !!(FG.airportEdit && FG.airportEdit.on));
    el.innerHTML = `
      <div class="dev-head"><b>✅ Airport checklist</b><button class="mini" data-ck="close" title="Close (F4)">✕</button></div>
      <div class="ck-bar" title="Green: good · blue: checked · red: needs work">
        <i class="ok" style="width:${pct(count.ok)}"></i><i class="checked" style="width:${pct(count.checked)}"></i><i class="bad" style="width:${pct(count.bad)}"></i></div>
      <div class="muted small">Start + busiest ${top}: <b>${topOk}</b> good · all ${list.length}: 🟢 ${count.ok} · 🔵 ${count.checked} · 🔴 ${count.bad} · ⬜ ${count.open}</div>
      <div class="chips ck-filter">${[['all', 'All'], ['open', '⬜ To check'], ['checked', '🔵 To approve'], ['bad', '🔴 Needs work'], ['ok', '🟢 Good']]
        .map(([f, label]) => `<button class="${ck.filter === f ? 'on' : ''}" data-ck="filter" data-f="${f}">${label}</button>`).join('')}</div>
      <div class="dev-row"><input id="ck-q" type="search" placeholder="Search code, name, city, country" value="${esc(ck.q)}"></div>
      <ul class="ck-list">${shown.slice(0, ck.shown).map(([o, i]) => row(o, i)).join('') || '<li class="muted small">No airport here.</li>'}</ul>
      ${shown.length > ck.shown ? `<button class="mini" data-ck="more">Show more (${shown.length - ck.shown} left)</button>` : ''}
      <section>
        ${where}
        ${waiting.length ? `<div class="dev-row">
          ${ck.target === 'browser' ? '' : `<button class="primary" data-ck="save"${ck.busy ? ' disabled' : ''}>💾 Save (${waiting.length})</button>`}
          <button data-ck="download">⬇ checks.js</button></div>` : ''}
      </section>
      <div id="ck-msg" class="${ck.bad ? 'bad' : ''}">${esc(ck.msg)}</div>`;
    const s = el.querySelector('.ck-row.sel');
    if (s && ck.scroll) { s.scrollIntoView({ block: 'nearest' }); ck.scroll = false; }
  }

  function show(code) {
    const a = airport(code);
    if (!a || !FG.ui) return;
    if (FG.ui.showAirport) FG.ui.showAirport(code);
    if (FG.ui.map) FG.ui.map.setView([a.lat, a.lon], 15);
  }
  function select(code) {
    ck.sel = ck.sel === code ? null : code;
    if (ck.sel) show(code);
    render();
  }
  function next() {
    const list = orderList().filter(matches);
    const i = list.findIndex((o) => o.code === ck.sel);
    const o = list[i + 1] || list.find((x) => x.code !== ck.sel);
    if (!o) return;
    const at = list.indexOf(o);
    if (at >= ck.shown) ck.shown = at + 50;
    ck.sel = null;
    ck.scroll = true;
    select(o.code);
  }

  async function onClick(e) {
    const b = e.target.closest('[data-ck]');
    if (!b || b.disabled) return;
    const d = b.dataset;
    switch (d.ck) {
      case 'close': toggle(false); break;
      case 'filter': ck.filter = d.f; ck.shown = 150; render(); break;
      case 'more': ck.shown += 300; render(); break;
      case 'select': select(d.code); break;
      case 'show': show(ck.sel); break;
      case 'edit':
        if (FG.airportEdit && !FG.airportEdit.on) FG.airportEdit.toggle(true);
        show(ck.sel);
        render();
        break;
      case 'next': next(); break;
      case 'mark': {
        const code = ck.sel;
        const note = $('ck-note') ? $('ck-note').value.trim() : '';
        await mark(code, d.s || null, note);
        msg(`${code}: ${d.s ? `${STATES[d.s].dot} ${STATES[d.s].label}` : 'mark removed'}${ck.target === 'server' || !d.s ? '' : ' (not saved yet)'}.`);
        render();
        break;
      }
      case 'save': save(); break;
      case 'download': download(); break;
      default:
    }
  }
  function onInput(e) {
    if (e.target.id === 'ck-q') {
      ck.q = e.target.value.trim();
      ck.shown = 150;
      const at = e.target.selectionStart;
      render();
      const q = $('ck-q');
      q.focus();
      q.setSelectionRange(at, at);
    }
    if (e.target.id === 'ck-name') {
      myName = e.target.value.trim();
      try { localStorage.setItem(NAME, myName); } catch (err) { /* only for now */ }
    }
  }

  function toggle(open = !ck.open) {
    ck.open = open;
    $('apcheck').hidden = !open;
    if (open) {
      render();
      target().then((t) => { ck.target = t; render(); });
    }
  }

  function init() {
    const el = $('apcheck');
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'F4') return;
      e.stopPropagation(); // typing here must not pause the game or open its menu
      if (e.key === 'Escape') { e.target.blur(); toggle(false); }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F4') { toggle(); e.preventDefault(); e.stopPropagation(); }
    }, true);
    window.addEventListener('beforeunload', (e) => {
      if (ck.target === 'github' && pending().length) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  Object.defineProperty(FG.checks, 'open', { get: () => ck.open });
  Object.assign(FG.checks, {
    toggle,
    mark: (code) => markOf(code),
    set: mark,
    pending,
    state: ck,
  });
  window.addEventListener('DOMContentLoaded', init);
})();
