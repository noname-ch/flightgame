// Bug reports (F5, or ⋯ menu → Report a bug): a short form whose report goes, with the game's details if wanted,
// - as a GitHub issue of the repo, for contributors signed in to GitHub (airport editor, F3),
// - else into BUGS.md through the dev server (./play.sh, tools/serve.py POST /__bugs),
// - else to GitHub's own "new issue" page, filled in (needs a GitHub account), or copied to the clipboard.
// Every report sent from this browser is kept in localStorage ('flightgame.bugs', the last 30) and listed below
// the form. Script errors are collected from the start (this file loads early) and go with the details.
(function () {
  const REPO = 'noname-ch/flightgame';
  const KEPT = 'flightgame.bugs';
  const NAME = 'flightgame.bugs.name';

  // ---------- the last script errors, from page load on ----------
  const errors = [];
  const note = (text) => {
    text = String(text).slice(0, 400);
    if (errors.length && errors[errors.length - 1].text === text) { errors[errors.length - 1].n++; return; }
    errors.push({ text, at: new Date().toISOString().slice(11, 19), n: 1 });
    if (errors.length > 15) errors.shift();
  };
  window.addEventListener('error', (e) => {
    if (e.message) note(`${e.message} (${String(e.filename || '').replace(/^.*\//, '').replace(/\?.*$/, '')}:${e.lineno || '?'})`);
    else if (e.target && e.target !== window) note(`could not load ${e.target.src || e.target.href || e.target.tagName}`);
  }, true);
  window.addEventListener('unhandledrejection', (e) => note(`unhandled: ${(e.reason && (e.reason.stack || e.reason.message)) || e.reason}`));
  const consoleError = console.error;
  console.error = function (...args) {
    note(args.map((a) => (a instanceof Error ? a.message : typeof a === 'object' ? safeJson(a) : String(a))).join(' '));
    return consoleError.apply(this, args);
  };
  function safeJson(o) { try { return JSON.stringify(o); } catch (e) { return String(o); } }

  // ---------- the game's details ----------
  function details() {
    const G = FG.game;
    const s = G && G.state;
    const ui = FG.ui || {};
    const v = (document.querySelector('script[src*="js/game.js"]') || {}).src || '';
    const lines = [
      `Version: ${(v.match(/[?&]v=([^&]+)/) || [])[1] || '?'}`,
      `Page: ${location.href.replace(/[?#].*$/, '')}`,
      `Browser: ${navigator.userAgent}`,
      `Screen: ${innerWidth}×${innerHeight} @${devicePixelRatio}x, style ${FG.themes ? FG.themes.current() : '?'}`,
    ];
    if (s) {
      lines.push(`Game: ${s.company || '?'}, ${s.mode || '?'} mode${s.story ? ', story' : ''}${s.difficulty ? `, ${s.difficulty}` : ''}, ` +
        `home ${G.home ? (G.home().code || G.home()) : '?'}, ${G.fmtTime ? G.fmtTime(s.time) : s.time}, money ${Math.round(s.money)}, ` +
        `${s.planes.length} planes${s.devUsed ? ', dev tools used' : ''}`);
      const p = ui.selectedPlane != null && s.planes.find((x) => x.id === ui.selectedPlane);
      if (p) {
        lines.push(`Selected plane: #${p.id} ${p.type}${p.name ? ` "${p.name}"` : ''}, ${p.status}` +
          `${p.flight ? ` ${p.flight.from}→${p.flight.to}` : p.location ? ` at ${p.location}` : ''}`);
      }
      if (ui.selectedAirport) lines.push(`Selected airport: ${ui.selectedAirport}`);
    }
    const m = ui.map;
    if (m) { const c = m.getCenter(); lines.push(`2D map: ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} zoom ${m.getZoom()}`); }
    const v3 = FG.view3d;
    if (v3 && v3.on && v3.map) {
      const c = v3.map.getCenter();
      lines.push(`3D view on: ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} zoom ${v3.map.getZoom().toFixed(1)}${v3.follow ? ', following a plane' : ''}`);
    }
    const open = [['devtools', 'dev tools'], ['apedit', 'airport editor'], ['apcheck', 'airport checklist'], ['market', 'market']]
      .filter(([id]) => { const el = document.getElementById(id); return el && !el.hidden; }).map(([, n]) => n);
    if (open.length) lines.push(`Open: ${open.join(', ')}`);
    lines.push(errors.length ? `Script errors (last ${errors.length}):\n${errors.map((e) => `  ${e.at} ${e.text}${e.n > 1 ? ` ×${e.n}` : ''}`).join('\n')}`
      : 'Script errors: none');
    return lines.join('\n');
  }

  // ---------- the panel ----------
  const br = { open: false, busy: false, msg: '', bad: false, target: 'browser', kind: 'bug', last: null };
  const KINDS = { bug: '🐞 Bug', idea: '💡 Idea', other: '💬 Other' };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  let kept = load(KEPT, []);
  let myName = '';
  try { myName = localStorage.getItem(NAME) || ''; } catch (e) { /* none */ }
  const keep = () => { try { localStorage.setItem(KEPT, JSON.stringify(kept.slice(-30))); } catch (e) { /* lost on reload */ } };

  let server = null;
  const serverHere = () => (server = server || fetch('__bugs').then((r) => (r.ok ? r.json() : null)).then((j) => !!(j && j.ok)).catch(() => false));
  async function target() {
    if (FG.fixes && FG.fixes.github.user) return 'github';
    return (await serverHere()) ? 'server' : 'browser';
  }
  const who = () => (FG.fixes && FG.fixes.github.user ? FG.fixes.github.user.login : myName);

  function report() {
    const title = ($('br-title').value || '').trim();
    const text = ($('br-text').value || '').trim();
    const withDetails = $('br-details').checked;
    const body = `${text || '(no description)'}\n\n${who() ? `Reported by: ${who()}\n` : ''}` +
      (withDetails ? `\n<details><summary>Game details</summary>\n\n\`\`\`\n${details()}\n\`\`\`\n</details>\n` : '');
    return { title: `${{ bug: 'Bug', idea: 'Idea', other: 'Report' }[br.kind]}: ${title}`, body, kind: br.kind };
  }

  // GitHub's new-issue page, filled in (its address may be at most about 8000 characters).
  function issueUrl(r) {
    let body = r.body;
    const url = () => `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(r.title)}&body=${encodeURIComponent(body)}`;
    while (url().length > 7800 && body.length > 200) body = `${body.slice(0, Math.floor(body.length * 0.8))}\n…(cut)`;
    return url();
  }

  async function send(how) {
    if (br.busy) return;
    if (!($('br-title').value || '').trim()) { msg('Give it a short title first.', true); $('br-title').focus(); return; }
    const r = report();
    br.busy = true;
    render(true);
    try {
      let link = null;
      let where = how;
      if (how === 'github') {
        const j = await FG.fixes.github.createIssue(r.title, r.body);
        link = j.html_url;
        msg(`Sent as issue #${j.number} on GitHub. Thank you!`);
      } else if (how === 'server') {
        const res = await fetch('__bugs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) });
        const j = res.ok ? await res.json() : null;
        if (!j || !j.ok) throw new Error((j && j.error) || 'the dev server did not take it');
        msg('Written into BUGS.md (dev server). Thank you!');
      } else if (how === 'web') {
        window.open(issueUrl(r), '_blank', 'noopener');
        msg('GitHub opened in a new tab: press "Create" there to send it.');
      } else {
        await navigator.clipboard.writeText(`${r.title}\n\n${r.body}`);
        msg('Copied: paste it wherever you like (chat, mail).');
        where = 'copied';
      }
      kept.push({ title: r.title, at: new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16).replace('T', ' '), where, link });
      keep();
      $('br-title').value = '';
      $('br-text').value = '';
    } catch (e) {
      msg(`Not sent: ${e.message}`, true);
    }
    br.busy = false;
    render(true);
  }

  function msg(text, bad) {
    br.msg = text;
    br.bad = !!bad;
    const el = $('br-msg');
    if (el) { el.textContent = text; el.className = bad ? 'bad' : ''; }
  }

  // keepForm: leave the text fields as they are (only the parts around them change).
  function render(keepForm) {
    const el = $('bugreport');
    if (!el || !br.open) return;
    const user = FG.fixes && FG.fixes.github.user;
    const where = {
      github: `Sends a GitHub issue as <b>${esc(user ? user.login : '')}</b>.`,
      server: 'Writes it into BUGS.md (dev server), or open it on GitHub.',
      browser: 'Opens GitHub with the report filled in (you need a GitHub account), or copy it.',
    }[br.target];
    const buttons = {
      github: '<button class="primary" data-br="github">📨 Send</button><button data-br="copy">📋 Copy</button>',
      server: '<button class="primary" data-br="server">📨 Send</button><button data-br="web">GitHub ↗</button><button data-br="copy">📋 Copy</button>',
      browser: '<button class="primary" data-br="web">📨 Send on GitHub ↗</button><button data-br="copy">📋 Copy</button>',
    }[br.target];
    const list = kept.slice().reverse().slice(0, 8).map((k) => `<li>${k.link ? `<a href="${esc(k.link)}" target="_blank" rel="noopener">${esc(k.title)}</a>` : esc(k.title)}
      <small class="muted">${esc(k.at)} · ${{ github: 'GitHub issue', server: 'BUGS.md', web: 'GitHub page', copied: 'copied' }[k.where] || ''}</small></li>`).join('');
    const parts = {
      kinds: `<div class="chips">${Object.entries(KINDS).map(([k, label]) => `<button class="${br.kind === k ? 'on' : ''}" data-br="kind" data-k="${k}">${label}</button>`).join('')}</div>`,
      where: `<div class="muted small">${where}</div>${user || br.target === 'github' ? '' : `<div class="dev-row"><input id="br-name" placeholder="Your name (optional)" value="${esc(myName)}"></div>`}`,
      buttons: `<div class="dev-row">${buttons.replace(/<button/g, br.busy ? '<button disabled' : '<button')}</div>`,
      mine: list ? `<section><div class="muted small">Sent from here</div><ul class="br-list">${list}</ul></section>` : '',
    };
    if (keepForm && el.querySelector('#br-text')) {
      for (const [k, h] of Object.entries(parts)) el.querySelector(`[data-part="${k}"]`).innerHTML = h;
    } else {
      el.innerHTML = `
        <div class="dev-head"><b>🐞 Report a bug</b><button class="mini" data-br="close" title="Close (F5)">✕</button></div>
        <div data-part="kinds">${parts.kinds}</div>
        <div class="dev-row"><input id="br-title" maxlength="120" placeholder="Short title, e.g. Plane stuck at the gate in Zurich"></div>
        <textarea id="br-text" rows="6" placeholder="What happened? What did you expect? How can we make it happen again?"></textarea>
        <label class="small br-check"><input type="checkbox" id="br-details" checked> Add the game's details (version, browser, game date, selection, map position, script errors)</label>
        <details class="br-peek"><summary class="small muted">See the details</summary><pre id="br-peek"></pre></details>
        <div data-part="where">${parts.where}</div>
        <div data-part="buttons">${parts.buttons}</div>
        <div id="br-msg" class="${br.bad ? 'bad' : ''}">${esc(br.msg)}</div>
        <div data-part="mine">${parts.mine}</div>`;
    }
    $('br-msg').textContent = br.msg;
    $('br-msg').className = br.bad ? 'bad' : '';
  }

  function toggle(open = !br.open) {
    br.open = open;
    $('bugreport').hidden = !open;
    if (!open) return;
    br.msg = '';
    render();
    setTimeout(() => $('br-title') && $('br-title').focus(), 0);
    target().then((t) => { br.target = t; render(true); });
  }

  function init() {
    const el = $('bugreport');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-br]');
      if (!b || b.disabled) return;
      const d = b.dataset;
      if (d.br === 'close') toggle(false);
      else if (d.br === 'kind') { br.kind = d.k; render(true); }
      else send(d.br);
    });
    el.addEventListener('toggle', (e) => { if (e.target.classList.contains('br-peek') && e.target.open) $('br-peek').textContent = details(); }, true);
    el.addEventListener('input', (e) => {
      if (e.target.id !== 'br-name') return;
      myName = e.target.value.trim();
      try { localStorage.setItem(NAME, myName); } catch (err) { /* only for now */ }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'F5') return;
      e.stopPropagation(); // typing here must not pause the game or open its menu
      if (e.key === 'Escape') toggle(false);
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(br.target === 'browser' ? 'web' : br.target);
    });
    // F5 opens this instead of reloading the page (Ctrl+R still reloads).
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F5' && !e.ctrlKey && !e.shiftKey) { toggle(); e.preventDefault(); e.stopPropagation(); }
    }, true);
    if ($('bugreport-toggle')) $('bugreport-toggle').addEventListener('click', () => toggle());
  }

  FG.bugs = { toggle, details, errors, get open() { return br.open; }, state: br };
  window.addEventListener('DOMContentLoaded', init);
})();
