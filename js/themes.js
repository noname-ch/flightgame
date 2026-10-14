// Interface styles (Settings → Style, and the start screen): colours, fonts and the look and place of the
// section bar. A style is html[data-theme=<id>] with its rules in css/themes.css; 'night' has none (the
// classic dark look of css/style.css). Loaded in <head>, so the saved style is there before the page draws;
// each style's web fonts load only when it is picked. The section bar gets two new icon sets here: pixel art
// (Tycoon, Pixel) and pictograms (Metropolis, Departure board).
(function () {
  window.FG = window.FG || {};
  const KEY = 'flightgame.settings';

  const THEMES = [
    { id: 'night', name: 'Night', desc: 'The classic dark look.',
      swatch: ['#0b0f15', '#131a24', '#ef4444', '#e5e7eb'] },
    { id: 'tycoon', name: 'Tycoon', desc: 'Bevelled grey windows and a toolbar along the top, like a 90s transport tycoon.',
      fonts: 'family=Pixelify+Sans:wght@400;600;700', swatch: ['#a8a49c', '#5c4630', '#e8b020', '#1c1a16'] },
    { id: 'metropolis', name: 'Metropolis', desc: 'Light frosted panels and a round dock at the bottom, like a modern city builder.',
      fonts: 'family=Nunito:wght@400;600;700;800', swatch: ['#eef3f8', '#ffffff', '#2f8fe8', '#1d2733'] },
    { id: 'pixel', name: 'Pixel', desc: 'Chunky pixel art with hard outlines and a tool palette, like a sprite editor.',
      fonts: 'family=Silkscreen:wght@400;700&family=Pixelify+Sans:wght@400;600;700', swatch: ['#181425', '#3a4466', '#feae34', '#63c74d'] },
    { id: 'board', name: 'Departure board', desc: 'Black and airport-sign yellow, with flip-board numbers.',
      fonts: 'family=B612:wght@400;700&family=B612+Mono:wght@400;700', swatch: ['#0a0a0a', '#1a1a1a', '#ffcc00', '#f2f2f2'] },
  ];

  const loaded = {};
  function loadFonts(t) {
    if (!t.fonts || loaded[t.id]) return;
    loaded[t.id] = true;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?${t.fonts}&display=swap`;
    document.head.appendChild(l);
  }

  function apply(id) {
    const t = THEMES.find((x) => x.id === id) || THEMES[0];
    document.documentElement.dataset.theme = t.id;
    loadFonts(t);
    return t.id;
  }

  // ---------- section bar icons ----------
  // Pixel art, 12 × 12: k outline, w light, a main colour, b shade (per icon), . empty.
  const PIXEL = {
    fleet: ['#5fcde4', '#306082', [
      '.....kk.....', '....kwak....', '....kaak....', '...kkaakk...', '.kkaaaaaakk.', 'kaaaaaaaaaak',
      '.kkkkaakkkk.', '....kaak....', '....kaak....', '...kaaaak...', '...kkkkkk...', '............']],
    airports: ['#8f974a', '#524b24', [
      '...kkkkkk...', '..kwwwwwwk..', '..kwbbbbwk..', '..kkkkkkkk..', '...kaaaak...', '....kaak....',
      '....kaak....', '....kbak....', '....kaak....', '...kaaaak...', '..kaaaaaak..', '..kkkkkkkk..']],
    slots: ['#3f7fd9', '#22427a', [
      '.kkkkkkkkkk.', 'kaaaaaaaaaak', 'kaawwwwwaaak', 'kaawaaaawaak', 'kaawaaaawaak', 'kaawwwwwaaak',
      'kaawaaaaaaak', 'kaawaaaaaaak', 'kaaaaaaaaaak', '.kkkkkkkkkk.', '.....kk.....', '.....kk.....']],
    schedule: ['#e43b44', '#9e2835', [
      '..k....k....', '.kkkkkkkkkk.', 'kaaaaaaaaaak', 'kkkkkkkkkkkk', 'kwwwwwwwwwwk', 'kwbwbwbwbwwk',
      'kwwwwwwwwwwk', 'kwbwbwbwaawk', 'kwwwwwwwaawk', 'kwbwbwwwwwwk', 'kwwwwwwwwwwk', '.kkkkkkkkkk.']],
    market: ['#e43b44', '#8b9bb4', [
      '.kkkkkkkkkk.', 'kawawawawawk', 'kawawawawawk', '.kkkkkkkkkk.', '.kwwwwwwwwk.', '.kwbbwwkkwk.',
      '.kwbbwwkbwk.', '.kwwwwwkbwk.', '.kwwwwwkbwk.', '.kkkkkkkkkk.', '............', '............']],
    finance: ['#feae34', '#be4a2f', [
      '............', '...kkkkkk...', '..kaaaaaak..', '..kbbbbbbk..', '..kkkkkkkk..', '.kkkkkkkkkk.',
      'kaaaaaaaaaak', 'kbbbbbbbbbbk', 'kkkkkkkkkkkk', 'kaaaaaaaaaak', 'kbbbbbbbbbbk', '.kkkkkkkkkk.']],
    rivals: ['#b86f50', '#733e39', [
      'k..........k', 'kwk......kwk', '.kwk....kwk.', '..kwk..kwk..', '...kwkkwk...', '....kwwk....',
      '....kwwk....', '...kwkkwk...', '.kakk..kkak.', 'kaak....kaak', 'kak......kak', '.k........k.']],
    log: ['#ead4aa', '#b86f50', [
      '.kkkkkkkkk..', 'kwwwwwwwwwk.', '.kwbbbbbwk..', '.kwwwwwwwk..', '.kwbbbbwwk..', '.kwwwwwwwk..',
      '.kwbbbbbwk..', '.kwwwwwwwk..', '.kwbbbwwwk..', '.kwwwwwwwwk.', 'kwwwwwwwwwk.', '.kkkkkkkkk..']],
  };
  function pixelIcon(tab) {
    const [a, b, rows] = PIXEL[tab];
    let r = '';
    rows.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === '.') return;
      const fill = c === 'a' ? ` fill="${a}"` : c === 'b' ? ` fill="${b}"` : '';
      r += `<rect class="${c}" x="${x}" y="${y}" width="1.02" height="1.02"${fill}/>`;
    }));
    return `<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
  }

  // Pictograms, 24 × 24, in the text colour.
  const PICTO = {
    fleet: '<path d="M12 1.5c.9 0 1.5 1 1.5 2.4V9l8 4.6v2.2l-8-2.4v4.8l2.4 1.8v1.7L12 20.8l-3.9.9V20l2.4-1.8v-4.8l-8 2.4v-2.2l8-4.6V3.9c0-1.4.6-2.4 1.5-2.4z"/>',
    airports: '<path d="M11.3 1h1.4v3h-1.4zM6 4.5h12L16.5 9h-9zM8.2 6l.6 1.6h6.4l.6-1.6zM10 10h4v9h-4zM6.5 19.5h11V23h-11z"/>',
    slots: '<path fill-rule="evenodd" d="M5 2h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zm3.5 4v12h3v-4h2.2a4 4 0 0 0 0-8zm3 2.6v2.8h2a1.4 1.4 0 0 0 0-2.8z"/>',
    schedule: '<path fill-rule="evenodd" d="M12 1.5a10.5 10.5 0 1 1 0 21 10.5 10.5 0 0 1 0-21zm0 2.5a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-1.2 2.5h2.4v5l3.6 2.1-1.2 2.1-4.8-2.8z"/>',
    market: '<path fill-rule="evenodd" d="M2 11.6V3.2C2 2.5 2.5 2 3.2 2h8.4L22 12.4 12.4 22zM7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>',
    finance: '<path d="M3 20h18v2.5H3zM4.5 12h3.5v7H4.5zM10.25 7.5h3.5V19h-3.5zM16 3h3.5v16H16z"/>',
    rivals: '<path d="M3 2l7.5 7.5-1.8 1.8L3 5.6zM21 2v3.6l-11 11 1.4 1.4-1.6 1.6-2-2-3 3L3 19l3-3-2-2 1.6-1.6 1.4 1.4zM13.2 13.4l1.8-1.8L22 18.6 19 21.6l-1.8-1.8 1.2-1.2z"/>',
    log: '<path fill-rule="evenodd" d="M5 1.5h11l4 4v17H5zm2.5 6h9V9h-9zm0 4h9V13h-9zm0 4h6V17h-6z"/>',
  };
  const pictoIcon = (tab) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${PICTO[tab]}</svg>`;

  // Both icon sets into the section bar's buttons; css/themes.css shows the style's one.
  function decorate() {
    document.querySelectorAll('#rail [data-tab]').forEach((b) => {
      const tab = b.dataset.tab;
      if (!PIXEL[tab] || b.querySelector('.ic')) return;
      b.insertAdjacentHTML('afterbegin', `<i class="ic ic-pixel">${pixelIcon(tab)}</i><i class="ic ic-picto">${pictoIcon(tab)}</i>`);
    });
  }

  // The saved style, before anything is drawn.
  let saved = null;
  try { saved = (JSON.parse(localStorage.getItem(KEY) || '{}') || {}).theme; } catch (e) { /* private mode */ }
  apply(saved);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorate);
  else decorate();

  FG.themes = { list: THEMES, apply, current: () => document.documentElement.dataset.theme || 'night' };
})();
