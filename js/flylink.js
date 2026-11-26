// Fly it yourself lives in its own repo and page: github.com/noname-ch/flightgame-fly (on GitHub Pages beside the
// game, so both share one localStorage and the fly page can read your airline's save). The ✈ Fly button in the 3D
// view and the P key open it with the selected plane's type, the airport and, when that plane is in the air, the
// plane to take over; "← Back to Flightgame" there comes back here.
// A local copy of the fly page: localStorage.setItem('flightgame.flyUrl', 'http://localhost:8000/').
(function () {
  'use strict';
  const G = FG.game;

  function base() {
    const own = localStorage.getItem('flightgame.flyUrl');
    if (own) return own;
    return /\.github\.io$/.test(location.hostname) ? `${location.origin}/flightgame-fly/` : 'https://noname-ch.github.io/flightgame-fly/';
  }

  // The link for what is selected now: ?type=&from=&mode=takeover&plane=&back=
  function url() {
    const ui = FG.ui || {};
    const q = new URLSearchParams();
    const p = ui.selectedPlane && G.plane(ui.selectedPlane);
    if (p) q.set('type', p.type);
    let from = ui.selectedAirport && G.airportByCode[ui.selectedAirport] ? ui.selectedAirport : null;
    if (!from && p) from = p.status === 'flying' && p.flight ? p.flight.from : p.location;
    if (!from) from = G.state.home;
    if (from) q.set('from', from);
    if (p && p.status === 'flying') { q.set('mode', 'takeover'); q.set('plane', p.id); }
    q.set('back', location.href.split('#')[0]);
    return `${base()}?${q}`;
  }

  function open() {
    if (G.state && G.state.company && G.save) G.save(); // (the fly page reads your airline from the save)
    location.href = url();
  }

  // P opens it (not on the start screen, not while typing)
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'p' && e.key !== 'P')) return;
    if (e.target.matches('input, select, textarea')) return;
    const startScreen = document.getElementById('start-screen');
    if (startScreen && !startScreen.hidden) return;
    open();
  });

  FG.flyLink = { url, open, base };
})();
