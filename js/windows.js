// Windows that can be moved: every panel that floats over the map (developer tools, airport editor, bug
// report, airport checklist, settings, newspaper, plane and timetable windows) is dragged by its title bar
// and stays where it was put (per window, in this browser). FG.win.movable(el, handle, key) makes an element
// movable; FG.win.open(key, opts) makes a new window. On a phone the panels keep their places.
(function () {
  const KEY = 'flightgame.win.';
  const phone = window.matchMedia('(max-width: 640px), (max-height: 500px) and (pointer: coarse)');
  let top = 2100; // the window last touched comes to the front

  function load(key) {
    try { return JSON.parse(localStorage.getItem(KEY + key)); } catch (e) { return null; }
  }
  function keep(key, pos) {
    try { localStorage.setItem(KEY + key, JSON.stringify(pos)); } catch (e) { /* only for this visit */ }
  }
  // Within the screen: at least 60 px of the window and all of its title bar stay in view.
  function clamp(el, x, y) {
    const w = el.offsetWidth || 200;
    return [Math.min(window.innerWidth - 60, Math.max(60 - w, x)), Math.min(window.innerHeight - 40, Math.max(0, y))];
  }
  function place(el, x, y) {
    [x, y] = clamp(el, x, y);
    el.style.position = 'fixed';
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.margin = '0';
    el.style.transform = 'none';
  }
  function front(el) { el.style.zIndex = String(++top); }

  // `el` is dragged by any element in it matching `handle` (also when the window draws its contents anew).
  function movable(el, handle, key) {
    if (!el || el.dataset.movable) return;
    el.dataset.movable = '1';
    el.classList.add('fg-movable');
    const saved = key && load(key);
    const restore = () => {
      if (phone.matches || !saved || el.hidden) return;
      place(el, saved[0], saved[1]);
    };
    // (where it was left, once it shows: a hidden element has no size yet)
    new MutationObserver(restore).observe(el, { attributes: true, attributeFilter: ['hidden'] });
    restore();
    el.addEventListener('pointerdown', () => { if (!phone.matches) front(el); }, true);
    el.addEventListener('pointerdown', (e) => {
      if (phone.matches || e.button !== 0) return;
      const h = e.target.closest(handle);
      if (!h || !el.contains(h) || e.target.closest('button, input, select, textarea, a, label')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      el.classList.add('fg-dragging');
      const moveTo = (ev) => place(el, ev.clientX - dx, ev.clientY - dy);
      const up = () => {
        window.removeEventListener('pointermove', moveTo);
        window.removeEventListener('pointerup', up);
        el.classList.remove('fg-dragging');
        const b = el.getBoundingClientRect();
        if (key) keep(key, [b.left, b.top]);
      };
      window.addEventListener('pointermove', moveTo);
      window.addEventListener('pointerup', up);
    });
    window.addEventListener('resize', () => {
      if (phone.matches || el.hidden || !el.style.left) return;
      const b = el.getBoundingClientRect();
      place(el, b.left, b.top);
    });
  }

  // A new window: { title, at: [x, y] where it first opens, width, onClose, className }. Returns
  // { el, body, title(html), close(), shown }.
  function open(key, opts = {}) {
    let el = document.getElementById(`win-${key}`);
    if (!el) {
      el = document.createElement('div');
      el.id = `win-${key}`;
      el.className = `fg-win ${opts.className || ''}`;
      el.innerHTML = '<div class="fg-win-head"><b class="fg-win-title"></b><button class="mini fg-win-close" title="Close">✕</button></div><div class="fg-win-body"></div>';
      el.hidden = true;
      document.body.appendChild(el);
      if (opts.width) el.style.width = `${opts.width}px`;
      const at = opts.at || [80, 80];
      el.style.left = `${at[0]}px`;
      el.style.top = `${at[1]}px`;
      movable(el, '.fg-win-head', key);
      // (typing in it must not reach the game's keys)
      el.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    }
    const w = {
      el,
      body: el.querySelector('.fg-win-body'),
      title(html) { el.querySelector('.fg-win-title').innerHTML = html; },
      close() {
        if (el.hidden) return;
        el.hidden = true;
        if (w.onClose) w.onClose();
      },
      get shown() { return !el.hidden; },
      onClose: opts.onClose || null,
    };
    el.querySelector('.fg-win-close').onclick = () => w.close();
    if (opts.title) w.title(opts.title);
    el.hidden = false;
    front(el);
    return w;
  }

  FG.win = { movable, open, front };

  // The panels that are there from the start.
  function init() {
    movable(document.getElementById('devtools'), '.dev-head', 'devtools');
    movable(document.getElementById('apedit'), '.dev-head', 'apedit');
    movable(document.getElementById('apcheck'), '.dev-head', 'apcheck');
    movable(document.getElementById('bugreport'), '.dev-head', 'bugreport');
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init);
  else init();
})();
