// The sound mixer (F6, or 🎚 in the ⋯ menu): how loud each part of the planes' sound is (bass, roar, screech, whine,
// air, …), for all planes, one engine kind or one aircraft type. A type takes what is set for it, else its kind's,
// else all planes'. The planes playing change at once; ▶ plays the chosen type's flight (FG.sound.preview). The
// numbers live in sound.js (FG.sound.mix / setMix, kept with the sound settings).
(function () {
  const G = FG.game;
  const D = FG.data;
  const KINDS = { jet: 'All jets', turboprop: 'All turboprops', piston: 'All pistons' };
  const mx = { win: null, target: null };
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const kindOf = (type) => FG.sound.profile(type).kind;
  const pct = (x) => `${Math.round(x * 100)}%`;

  // The parts a target has: a type or kind its engine kind's, all planes every one.
  function partsOf(target) {
    if (target === 'all') return Object.keys(FG.sound.parts);
    return FG.sound.kindParts[KINDS[target] ? target : kindOf(target)];
  }
  // What a part plays at for the target, and where that comes from (this target or one above it).
  function level(target, part) {
    const chain = target === 'all' ? ['all'] : KINDS[target] ? [target, 'all'] : [target, kindOf(target), 'all'];
    for (const k of chain) { const x = FG.sound.mix(k)[part]; if (x != null) return { x, from: k }; }
    return { x: 1, from: null };
  }
  const nameOf = (k) => (k === 'all' ? 'all planes' : KINDS[k] ? KINDS[k].toLowerCase() : (D.aircraft[k] && D.aircraft[k].name) || k);

  function options() {
    const mine = [...new Set(((G.state && G.state.planes) || []).map((p) => p.type))].filter((t) => D.aircraft[t]).sort();
    const all = Object.keys(D.aircraft).sort((a, b) => D.aircraft[a].name.localeCompare(D.aircraft[b].name));
    const opt = (v, label) => `<option value="${esc(v)}"${v === mx.target ? ' selected' : ''}>${esc(label)}${FG.sound.mix(v) && Object.keys(FG.sound.mix(v)).length ? ' •' : ''}</option>`;
    return opt('all', 'All planes')
      + Object.entries(KINDS).map(([k, l]) => opt(k, l)).join('')
      + (mine.length ? `<optgroup label="In your fleet">${mine.map((t) => opt(t, D.aircraft[t].name)).join('')}</optgroup>` : '')
      + `<optgroup label="Every type">${all.map((t) => opt(t, D.aircraft[t].name)).join('')}</optgroup>`;
  }

  function render() {
    if (!mx.win) return;
    const t = mx.target;
    const rows = partsOf(t).map((part) => {
      const { x, from } = level(t, part);
      const own = from === t;
      const note = own ? '' : from ? `from ${esc(nameOf(from))}` : '';
      return `<div class="mix-row${own ? ' own' : ''}">
        <label for="mix-${part}">${esc(FG.sound.parts[part])}</label>
        <input id="mix-${part}" type="range" min="0" max="3" step="0.05" value="${x}" data-part="${part}">
        <span class="mix-val">${pct(x)}</span>
        <button class="mini" data-reset="${part}" title="${own ? 'Back to what the planes above set' : 'Not changed here'}"${own ? '' : ' disabled'}>↺</button>
        ${note ? `<div class="mix-note muted">${note}</div>` : ''}</div>`;
    }).join('');
    const type = KINDS[t] || t === 'all' ? null : t;
    mx.win.body.innerHTML = `
      <div class="mix-pick"><select data-target>${options()}</select>
        <button class="mini${FG.sound.previewing ? ' on' : ''}" data-play title="Play a whole flight of ${esc(nameOf(type || (KINDS[t] ? t : 'jet')))}">${FG.sound.previewing ? '■' : '▶'}</button></div>
      <p class="muted mix-help">Each part ×0 to ×3. A type follows its kind and all planes until you change it here.${FG.sound.on ? '' : ' Sound is off: ▶ turns it on.'}</p>
      ${rows}
      <div class="mix-foot"><button class="mini" data-resetall${Object.keys(FG.sound.mix(t)).length ? '' : ' disabled'}>Reset ${esc(nameOf(t))}</button></div>`;
  }

  function play() {
    if (FG.sound.previewing) { FG.sound.preview(false); render(); return; }
    const t = mx.target;
    const kind = KINDS[t] ? t : t === 'all' ? FG.sound.previewKind : kindOf(t);
    const type = KINDS[t] || t === 'all' ? null : t;
    FG.sound.preview({ kind, type });
    render();
  }

  function open() {
    if (!mx.target) {
      const sel = FG.ui && FG.ui.selectedPlane && G.plane(FG.ui.selectedPlane);
      mx.target = sel ? sel.type : 'jet';
    }
    mx.win = FG.win.open('soundmix', { className: 'mix-win', width: 360, at: [Math.max(16, innerWidth - 400), 80], title: '🎚 Sound mixer <span class="muted">F6</span>', onClose: () => { mx.win = null; } });
    const b = mx.win.body;
    if (!b.dataset.wired) {
      b.dataset.wired = '1';
      b.addEventListener('input', (e) => {
        const part = e.target.dataset.part;
        if (!part) return;
        FG.sound.setMix(mx.target, part, Number(e.target.value));
        const row = e.target.closest('.mix-row');
        row.querySelector('.mix-val').textContent = pct(Number(e.target.value));
        row.classList.add('own');
        row.querySelector('[data-reset]').disabled = false;
        const n = row.querySelector('.mix-note');
        if (n) n.remove();
        b.querySelector('[data-resetall]').disabled = false;
      });
      b.addEventListener('change', (e) => {
        if (e.target.matches('[data-target]')) { mx.target = e.target.value; render(); } else if (e.target.dataset.part) render();
      });
      b.addEventListener('click', (e) => {
        const r = e.target.closest('[data-reset]');
        if (r) { FG.sound.setMix(mx.target, r.dataset.reset, null); render(); return; }
        if (e.target.closest('[data-resetall]')) { FG.sound.resetMix(mx.target); render(); return; }
        if (e.target.closest('[data-play]')) play();
      });
    }
    render();
  }
  function toggle(on) {
    if (on === false || (on == null && mx.win)) { if (mx.win) mx.win.close(); return; }
    open();
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F6' || e.ctrlKey || e.altKey || e.metaKey) return;
    toggle();
    e.preventDefault();
    e.stopPropagation();
  }, true);
  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('soundmix-toggle');
    if (btn) btn.addEventListener('click', () => toggle(true));
  });
  // (the preview stops by itself at the end of the flight: the ▶ button follows)
  setInterval(() => {
    const b = mx.win && mx.win.body.querySelector('[data-play]');
    if (b && b.classList.contains('on') !== FG.sound.previewing) render();
  }, 500);

  FG.soundMix = { open, toggle, get target() { return mx.target; }, set target(t) { mx.target = t; render(); }, get shown() { return !!mx.win; } };
})();
