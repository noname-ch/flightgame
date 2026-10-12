// Airport fixes: corrections a developer drew with the airport editor (js/airportedit.js, F3) where the map
// data is wrong or missing. Each airport has a list of operations, applied on top of its data whenever that
// is loaded, so every game has them, new or saved:
//   { op: 'add', kind, geom }        a new element
//   { op: 'del', kind, geom }        the element with this shape goes
//   { op: 'set', kind, from, geom }  the element with the shape `from` becomes `geom`
// Kinds: runway ([lat1, lon1, lat2, lon2, width m, paved 0/1], in FG.data.runways), taxiway (line [[lat, lon]..]),
// apron, pad (open concrete where planes go straight to their stand), terminal, hangar, building (rings), stand ([lat, lon, heading, name, 1, length m of its lead-in line and
// pushback, if set]), tower ([lat, lon]) and
// airport (add only: { code, name, city, country, lat, lon, size }, kept under its own code), and
// bridges ({ op: 'set', kind: 'bridges', geom: false | true }: whether its stands at a terminal get jet bridges).
// An element is found again by its shape (within a few metres), so a fix still holds when the map data round it
// changes a little. A `set` whose element is gone adds its new shape anyway; a `del` then does nothing.
// js/data/fixes.js has everyone's fixes. Save puts them there: through the dev server (tools/serve.py, when the
// game runs from ./play.sh; commit the file then), or on the website (GitHub Pages) as a commit to the repo on
// GitHub, for contributors signed in with a GitHub token (GitHub takes it only from those who may push to the
// repo). Until the website has the new file, and for everyone else, the fixes stay in this browser.
(function () {
  const D = FG.data;
  const LOCAL = 'flightgame.fixes';
  const M = 111320;
  const DEG = Math.PI / 180;
  const TOL = 6; // m: how far an element may lie from the shape a fix remembers
  // where each kind lives in a layout (js/layouts.js), and its heights
  const LISTS = { taxiway: 'taxiways', apron: 'aprons', pad: 'pads', terminal: 'terminals', hangar: 'hangars', building: 'others', stand: 'stands', tower: 'towers' };
  const HEIGHTS = { terminal: 'terminals', hangar: 'hangars', building: 'others' };
  const RINGS = new Set(['apron', 'pad', 'terminal', 'hangar', 'building']);

  const SENT = 'flightgame.fixes.sent';  // code -> when it was committed to GitHub (kept here until the site has it)
  const SENT_FOR = 3600e3;               // after an hour the website's file is the one that counts
  const repo = Object.assign({}, D.fixes);
  let local = {};
  let sent = {};
  try { local = JSON.parse(localStorage.getItem(LOCAL)) || {}; } catch (e) { /* none, or private mode */ }
  try { sent = JSON.parse(localStorage.getItem(SENT)) || {}; } catch (e) { /* none */ }
  const drafts = {};   // code -> ops being edited, not saved yet
  const revs = {};     // code -> goes up whenever the airport's fixes change (caches built before are dropped)
  const runways0 = {}; // code -> its runways before the fixes (null: none)
  const missedRw = {}; // code -> runway ops that found nothing to change, the last time they were applied
  const missedLay = {}; // code -> the same for its layout

  const saved = (code) => local[code] || repo[code] || [];
  const opsOf = (code) => drafts[code] || saved(code);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const copy = (g) => JSON.parse(JSON.stringify(g));

  // ---------- shapes ----------
  // The points of an element: runway ends, a stand's or tower's spot, a line, a ring.
  function shape(kind, g) {
    if (kind === 'runway') return [[g[0], g[1]], [g[2], g[3]]];
    if (kind === 'stand' || kind === 'tower') return [[g[0], g[1]]];
    return g;
  }
  // Metres from p to the segment a-b (flat, round p).
  function segM(p, a, b) {
    const kx = M * Math.cos(p[0] * DEG);
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * M;
    const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * M;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(ax + t * dx, ay + t * dy);
  }
  const ptM = (p, q) => Math.hypot((q[1] - p[1]) * M * Math.cos(p[0] * DEG), (q[0] - p[0]) * M);
  // Farthest any point of `pts` lies from the line or ring `to`.
  function reach(pts, to, closed) {
    let worst = 0;
    for (const p of pts) {
      let d = to.length === 1 ? ptM(p, to[0]) : Infinity;
      const n = closed ? to.length : to.length - 1;
      for (let i = 0; i < n; i++) d = Math.min(d, segM(p, to[i], to[(i + 1) % to.length]));
      worst = Math.max(worst, d);
    }
    return worst;
  }
  // How far apart two elements of one kind are (m): 0 = the same shape.
  function gap(kind, a, b) {
    const p = shape(kind, a);
    const q = shape(kind, b);
    if (kind === 'runway') return Math.min(Math.max(ptM(p[0], q[0]), ptM(p[1], q[1])), Math.max(ptM(p[0], q[1]), ptM(p[1], q[0])));
    if (p.length === 1 || q.length === 1) return ptM(p[0], q[0]);
    const ring = RINGS.has(kind);
    return Math.max(reach(p, q, ring), reach(q, p, ring));
  }
  // The element of `list` with this shape (or -1).
  function find(list, kind, g) {
    let best = -1;
    let bestGap = TOL;
    list.forEach((e, i) => {
      const d = gap(kind, e, g);
      if (d < bestGap) { bestGap = d; best = i; }
    });
    return best;
  }
  // One operation on a list (and the heights that go with it). False when it found nothing to change.
  function apply(list, op, heights) {
    if (op.op === 'add') {
      list.push(copy(op.geom));
      if (heights) heights.push(0);
      return true;
    }
    const i = find(list, op.kind, op.op === 'set' ? op.from : op.geom);
    if (op.op === 'del') {
      if (i < 0) return false;
      list.splice(i, 1);
      if (heights) heights.splice(i, 1);
      return true;
    }
    if (i >= 0) list[i] = copy(op.geom);
    else { list.push(copy(op.geom)); if (heights) heights.push(0); }
    return i >= 0;
  }

  // ---------- runways and airports: straight into the data ----------
  function fixRunways(code) {
    if (!(code in runways0)) runways0[code] = D.runways[code] || null;
    delete missedRw[code];
    const ops = opsOf(code).filter((o) => o.kind === 'runway');
    if (!ops.length) {
      if (runways0[code]) D.runways[code] = runways0[code]; else delete D.runways[code];
      return;
    }
    const list = (runways0[code] || []).map((r) => r.slice());
    for (const op of ops) if (!apply(list, op)) (missedRw[code] = missedRw[code] || []).push(op);
    D.runways[code] = list;
  }
  // An airport a fix adds stays until the page is loaded again (planes may fly there by then).
  function fixAirports(code) {
    for (const op of opsOf(code)) {
      if (op.kind !== 'airport' || op.op !== 'add' || D.airports.some((a) => a.code === op.geom.code)) continue;
      const a = Object.assign({ city: '', country: '', size: 1 }, copy(op.geom), { fixed: true });
      D.airports.push(a);
      if (FG.game) FG.game.airportByCode[a.code] = a;
    }
  }

  // ---------- layouts ----------
  const centreLine = (r) => {
    const n = Math.max(1, Math.round(ptM([r[0], r[1]], [r[2], r[3]]) / 100));
    return Array.from({ length: n + 1 }, (_, i) => [r[0] + ((r[2] - r[0]) * i) / n, r[1] + ((r[3] - r[1]) * i) / n]);
  };
  function inRing(p, r) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i];
      const b = r[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  // The airport's layout (from its file or the tiles: `raw`, null if there is none) with its fixes. Without a
  // layout to start from, the fixes make one of their own (an apron and a stand at least make it usable).
  function layout(code, raw) {
    const ops = opsOf(code);
    const own = ops.filter((o) => LISTS[o.kind]);
    const rw = ops.some((o) => o.kind === 'runway');
    const br = ops.filter((o) => o.kind === 'bridges').pop();
    delete missedLay[code];
    if (!own.length && !rw && !br) return raw;
    const out = Object.assign({ aprons: [], terminals: [], hangars: [], others: [], towers: [], taxiways: [], stands: [], links: [] }, raw);
    for (const k of Object.values(LISTS).concat('links')) out[k] = (out[k] || []).slice();
    const h0 = (raw && raw.heights) || {};
    out.heights = {};
    for (const k of Object.values(HEIGHTS)) out.heights[k] = out[k].map((_, i) => (h0[k] && h0[k][i]) || 0);
    for (const op of own) {
      if (!apply(out[LISTS[op.kind]], op, HEIGHTS[op.kind] && out.heights[HEIGHTS[op.kind]])) (missedLay[code] = missedLay[code] || []).push(op);
    }
    // Planes may taxi along the runways (links): along the fixed ones, not the old ones.
    const rws = D.runways[code] || [];
    if (rw || !raw) {
      const old = runways0[code] || [];
      const along = (l, r) => (ptM(l[0], [r[0], r[1]]) < 30 && ptM(l[l.length - 1], [r[2], r[3]]) < 30) ||
        (ptM(l[0], [r[2], r[3]]) < 30 && ptM(l[l.length - 1], [r[0], r[1]]) < 30);
      out.links = out.links.filter((l) => !old.some((r) => along(l, r))).concat(rws.map(centreLine));
    }
    // A layout of the fixes alone: where no taxiway reaches an apron, a way from the apron to the nearest runway.
    if (!raw && out.aprons.length && rws.length &&
      !out.taxiways.some((l) => l.some((p) => out.aprons.some((r) => inRing(p, r) || reach([p], r, true) < 15)))) {
      let best = { d: Infinity };
      for (const r of out.aprons) {
        for (const p of r) {
          for (const w of rws) {
            const line = centreLine(w);
            for (const q of line) { const d = ptM(p, q); if (d < best.d) best = { d, line: [p, q] }; }
          }
        }
      }
      if (best.line) out.links.push(best.line);
    }
    // The stands the fixes added or moved: the game uses them, whatever its rule for how many (game.js realApron).
    const placed = own.filter((o) => o.kind === 'stand' && o.op !== 'del').map((o) => JSON.stringify(o.geom));
    out.pinned = new Set(out.stands.filter((st) => placed.includes(JSON.stringify(st))));
    if (br) out.bridges = !!br.geom;
    out.source = raw ? `${raw.source || 'file'}+fixes` : 'fixes';
    out.fixed = true;
    out.key = `${code}#fix${revs[code] || 0}`; // (game.js caches the taxi graph by it)
    return out;
  }

  // ---------- saving ----------
  function keepLocal() {
    try {
      localStorage.setItem(LOCAL, JSON.stringify(local));
      localStorage.setItem(SENT, JSON.stringify(sent));
    } catch (e) { /* full or private: lost on reload */ }
  }
  // Committed fixes the website has by now (or that are old enough) are the file's again.
  for (const code of Object.keys(sent)) {
    if (same(local[code], repo[code] || []) || Date.now() - sent[code] > SENT_FOR) { delete local[code]; delete sent[code]; }
  }
  for (const code of Object.keys(local)) if (same(local[code], repo[code] || [])) delete local[code];
  keepLocal();
  function changed(code) {
    revs[code] = (revs[code] || 0) + 1;
    FG.fixes.version++;
    fixAirports(code);
    fixRunways(code);
    if (FG.layouts) FG.layouts.refix(code);
  }
  // The text of js/data/fixes.js (as tools/serve.py writes it): one operation per line.
  const parseFile = (text) => JSON.parse(text.slice(text.indexOf('=', text.indexOf('FG.data.fixes')) + 1).trim().replace(/;\s*$/, ''));
  function fileText(all) {
    const parts = Object.keys(all).sort().filter((c) => all[c].length)
      .map((c) => `${JSON.stringify(c)}: [\n${all[c].map((op) => `  ${JSON.stringify(op)}`).join(',\n')}\n]`);
    return '// Airport fixes drawn with the airport editor (developer tools, F3), see js/fixes.js.\n' +
      '// Written by tools/serve.py when the game runs from ./play.sh: commit this file to give everyone the fixes.\n' +
      `FG.data.fixes = {\n${parts.join(',\n')}\n};\n`;
  }
  // Is the dev server there (./play.sh)? Asked once.
  let server = null;
  const serverHere = () => (server = server || fetch('__fixes').then((r) => (r.ok ? r.json() : null)).then((j) => !!(j && j.ok)).catch(() => false));
  // Write one airport's fixes into js/data/fixes.js through the dev server. False where there is none.
  async function write(code, ops) {
    try {
      const r = await fetch('__fixes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, ops }) });
      if (!r.ok) return false;
      const j = await r.json();
      return !!(j && j.ok);
    } catch (e) {
      return false;
    }
  }

  // ---------- saving into the repo on GitHub ----------
  const GH = { repo: 'noname-ch/flightgame', branch: 'main', path: 'js/data/fixes.js' };
  const GH_KEY = 'flightgame.github'; // { token, login } of the contributor signed in on this device
  let gh = null;
  try { gh = JSON.parse(localStorage.getItem(GH_KEY)); } catch (e) { /* not signed in */ }
  const ghFetch = (path, opts = {}, token = gh && gh.token) => fetch(`https://api.github.com${path}`, Object.assign({}, opts, {
    headers: Object.assign({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` }, opts.headers),
  }));
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  // Change one file of the repo on GitHub in one commit: edit(text now, '' if none) gives the new text. Done
  // again on top if someone saved the file meanwhile.
  async function commitFile(path, edit, message) {
    if (!gh) throw new Error('Sign in to GitHub first.');
    const at = `/repos/${GH.repo}/contents/${path}`;
    for (let tries = 0; tries < 3; tries++) {
      const r = await ghFetch(`${at}?ref=${GH.branch}`, { cache: 'no-store' });
      let text = '';
      let sha;
      if (r.ok) {
        const j = await r.json();
        sha = j.sha;
        text = j.content ? fromBase64(j.content) : '';
        if (!text && j.size) { // (over 1 MB: the API gives the text only on its own)
          const raw = await ghFetch(`${at}?ref=${GH.branch}`, { cache: 'no-store', headers: { Accept: 'application/vnd.github.raw' } });
          text = await raw.text();
        }
      } else if (r.status === 401) throw new Error('GitHub no longer takes this token (expired?): sign in again.');
      else if (r.status !== 404) throw new Error(`GitHub answered ${r.status}.`);
      const put = await ghFetch(at, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: toBase64(edit(text)), sha, branch: GH.branch }),
      });
      if (put.ok) return;
      if (put.status === 409) continue; // someone saved in between: on top of theirs
      if (put.status === 401) throw new Error('GitHub no longer takes this token (expired?): sign in again.');
      if (put.status === 403 || put.status === 404) throw new Error(`${gh.login} may not change ${GH.repo} (or the token lacks the right): only its contributors can save.`);
      throw new Error(`GitHub answered ${put.status}.`);
    }
    throw new Error('the file kept changing on GitHub: save again.');
  }
  // These airports' fixes into js/data/fixes.js on GitHub, in one commit.
  function commit(codes) {
    return commitFile(GH.path, (text) => {
      const all = text ? parseFile(text) : {};
      for (const c of codes) { const ops = opsOf(c); if (ops.length) all[c] = ops; else delete all[c]; }
      return fileText(all);
    }, `Airport fixes: ${codes.join(', ')}`);
  }

  FG.fixes = {
    version: 0,
    LISTS,
    ops: opsOf,
    saved,
    has: (code) => opsOf(code).length > 0,
    rev: (code) => revs[code] || 0,
    missed: (code) => [...(missedRw[code] || []), ...(missedLay[code] || [])],
    gap,
    layout,
    // Airports with fixes (saved or not).
    codes: () => [...new Set([...Object.keys(repo), ...Object.keys(local), ...Object.keys(drafts)])].filter((c) => opsOf(c).length || saved(c).length),
    // Airports whose changes are not saved yet.
    unsaved: () => Object.keys(drafts).filter((c) => !same(drafts[c], saved(c))),
    // Airports whose saved fixes are only in this browser (not those on their way to the website).
    localOnly: () => Object.keys(local).filter((c) => !sent[c]),
    // Change an airport's fixes (not saved yet): the maps show it at once.
    edit(code, ops) {
      drafts[code] = ops;
      changed(code);
    },
    discard(code) {
      if (!(code in drafts)) return;
      delete drafts[code];
      changed(code);
    },
    // Where Save puts the fixes: 'server' (js/data/fixes.js through ./play.sh), 'github' (a commit to the repo,
    // signed in) or 'browser' (only here).
    async target() {
      if (await serverHere()) return 'server';
      return gh ? 'github' : 'browser';
    },
    // Save every change. Resolves to { where, saved: [codes], error } (on an error they stay in this browser).
    async save() {
      const codes = [...new Set([...this.unsaved(), ...this.localOnly()])];
      const where = await this.target();
      const out = { where, saved: [], error: null };
      if (!codes.length) return out;
      const keep = (code) => { local[code] = opsOf(code); };
      if (where === 'server') {
        for (const code of codes) {
          const ops = opsOf(code);
          if (await write(code, ops)) { repo[code] = ops; delete local[code]; delete sent[code]; out.saved.push(code); } else keep(code);
        }
        if (!out.saved.length) out.error = 'the dev server did not take them';
      } else if (where === 'github') {
        try {
          await commit(codes);
          for (const code of codes) { keep(code); sent[code] = Date.now(); }
          out.saved = codes;
        } catch (e) {
          out.error = e.message;
          codes.forEach(keep);
        }
      } else codes.forEach(keep);
      for (const code of codes) delete drafts[code];
      for (const code of Object.keys(drafts)) if (same(drafts[code], saved(code))) delete drafts[code];
      keepLocal();
      return out;
    },
    // The contributor signed in on this device ({ login } or null), and signing in and out.
    github: {
      repo: GH.repo,
      get user() { return gh ? { login: gh.login } : null; },
      // Checks the token with GitHub: it must belong to someone who may push to the repo.
      async signIn(token) {
        token = String(token || '').trim();
        if (!token) throw new Error('Paste a token first.');
        const u = await ghFetch('/user', {}, token).catch(() => null);
        if (!u || !u.ok) throw new Error(u && u.status === 401 ? 'GitHub does not know this token.' : 'GitHub could not be reached.');
        const login = (await u.json()).login;
        const r = await ghFetch(`/repos/${GH.repo}`, {}, token);
        const j = r.ok ? await r.json() : null;
        if (!j || !j.permissions || !j.permissions.push) throw new Error(`${login} is not a contributor of ${GH.repo}: only they can save fixes.`);
        gh = { token, login };
        try { localStorage.setItem(GH_KEY, JSON.stringify(gh)); } catch (e) { /* only for this visit */ }
        return login;
      },
      signOut() {
        gh = null;
        try { localStorage.removeItem(GH_KEY); } catch (e) { /* not kept */ }
      },
      commitFile, // (the airport checklist, js/airportcheck.js, saves its file this way too)
    },
    // js/data/fixes.js with every fix in it (for when there is no dev server to write it).
    fileText: () => {
      const all = Object.assign({}, repo, local);
      for (const c of Object.keys(drafts)) all[c] = drafts[c];
      return fileText(all);
    },
  };

  // Everything but the layouts is fixed before the game starts (the layouts when they load).
  for (const code of FG.fixes.codes()) { fixAirports(code); fixRunways(code); }
})();
