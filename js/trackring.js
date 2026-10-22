// The ring round the plane you are following (2D and 3D): on the plane, or, when it is off the screen, an arrow at
// the screen's edge pointing to it. Used by ui.js (the 2D map) and view3d.js (the 3D map) with their own screen points.
FG.trackRing = {
  // A new ring in `parent` (hidden until it is placed).
  make(parent) {
    const el = document.createElement('div');
    el.className = 'track-ring';
    el.hidden = true;
    el.innerHTML = '<i></i>';
    parent.appendChild(el);
    return el;
  },
  // Put the ring on the screen point `pt` ({ x, y } in CSS pixels of a w × h map); null hides it.
  place(el, pt, w, h) {
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) { el.hidden = true; return; }
    const inset = 28;   // (keep the ring clear of the map's edge)
    const cx = w / 2;
    const cy = h / 2;
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const off = pt.x < inset || pt.y < inset || pt.x > w - inset || pt.y > h - inset;
    let x = pt.x;
    let y = pt.y;
    if (off) {
      // where the line from the centre to the plane leaves the screen (inside the inset)
      const k = Math.min((cx - inset) / Math.max(1e-6, Math.abs(dx)), (cy - inset) / Math.max(1e-6, Math.abs(dy)));
      x = cx + dx * k;
      y = cy + dy * k;
    }
    el.hidden = false;
    el.classList.toggle('edge', off);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    if (off) el.style.setProperty('--ang', `${(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1)}deg`);
  },
};
