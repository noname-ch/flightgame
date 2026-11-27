// Airline liveries for the 3D aircraft models (painted by js/livery.js from the position on the aircraft, so
// each fits every model). Simplified after photographs of the real ones (Wikimedia Commons): the colours and
// where they go, the title, and a plain mark or a simple logo on the fin.
//   title, titleColor, titleStyle (CSS font style and weight)  the name on the forward fuselage
//   titleAt     'window' (default: large, across the window row), 'above' (smaller, above the windows) or
//               'low' (on the belly); titleHeight and titleLength (in fuselage widths) make it bigger
//   body        the fuselage (its upper part where there is a belly)
//   wing        wings and tailplanes (default: FG.data.wingGrey, the light grey nearly every airliner's are painted)
//   engine      the engine cowlings (default: the body colour)
//   belly       { color, from, line, lineWidth, nose, aft }: the fuselage below `from` fuselage widths under
//               its top, with a stripe along the edge; `nose`: the edge climbs by so many widths to the nose;
//               `aft`: only behind this point of the length (0 = the middle, -0.5 = the tail)
//   fin         colour of the fin
//   tail        true: the fin's colour goes on round the rear fuselage
//   mark        on the fin: { kind: 'cross' | 'disc' | 'ring' | 'chevron' | 'triangle' | 'split', color, color2,
//               size }, { kind: 'flag', color (the bar along the front), color2 (top band), color3 (bottom band;
//               the middle one is the fin's colour) }, { kind: 'stripes', color (three thin ones), color2 (the wide one) }, { kind: 'logo', logo: 'klm' | 'crane' | 'harp', color, size } or
//               { kind: 'text', text, color, style, angle (it rises along the fin) }
//   winglet     colour of the wing tips
//   stripe      { color, at, width }: a cheatline along the fuselage, its middle `at` fuselage widths under the top
//   group       where the Liveries window (F7, js/liverywin.js) lists it
// Logos: 'klm' | 'crane' | 'harp' | 'star' | 'maple' | 'sun' | 'bird' | 'wave' | 'globe' | 'plane' | 'tulip'.
// The first one is the livery of a new airline. state.livery in a saved game says which one it flies; a plane
// with a livery of its own has p.livery. Liveries made in the designer or downloaded from the community are kept in
// this browser (FG.liveries.library) and in the saved game that uses them (state.liveries).
FG.data.wingGrey = 0xc9cdd2;
FG.data.liveries = [
  // white, the name large in red above the windows, the red fin with the white cross
  { id: 'swiss', name: 'SWISS', title: 'SWISS', titleColor: 0xe60005, titleAt: 'above', titleHeight: 0.36, titleLength: 2.2,
    body: 0xf1f2f4, fin: 0xe60005, mark: { kind: 'cross', color: 0xffffff } },
  // white, the tail dark blue down round the rear fuselage, the crane in a ring, the name above the windows
  { id: 'lufthansa', name: 'Lufthansa', title: 'Lufthansa', titleColor: 0x05164d, titleAt: 'above', body: 0xf4f5f7,
    fin: 0x05164d, tail: true, mark: { kind: 'logo', logo: 'crane', color: 0xffffff }, winglet: 0x05164d },
  // bright blue above a dark blue stripe, white below; white fin with the crown and letters
  { id: 'klm', name: 'KLM', title: 'KLM', titleColor: 0xffffff, titleAt: 'above', titleHeight: 0.26, body: 0x00a1e4, wing: 0xe9edf1,
    belly: { color: 0xf1f2f4, from: 0.74, line: 0x003a70, lineWidth: 0.05 }, fin: 0xf4f5f7,
    mark: { kind: 'logo', logo: 'klm', color: 0x00a1e4 }, winglet: 0x00a1e4 },
  // white with a dark blue belly and engines; the red widget fills the dark blue fin
  { id: 'delta', name: 'Delta', title: 'DELTA', titleColor: 0x0b2a5b, titleAt: 'above', body: 0xf4f5f7, engine: 0x0b2a5b,
    belly: { color: 0x0b2a5b, from: 0.8 }, fin: 0x0b2a5b,
    mark: { kind: 'triangle', color: 0xe01933, color2: 0x98002e, size: 1.8 }, winglet: 0x0b2a5b },
  // white with the name large in blue; blue tail with the yellow harp, blue lower rear fuselage with a yellow stripe
  { id: 'ryanair', name: 'Ryanair', title: 'RYANAIR', titleColor: 0x073590, titleLength: 3.2, titleHeight: 0.5, body: 0xf4f5f7,
    belly: { color: 0x073590, from: 0.72, aft: -0.06, line: 0xf1c933, lineWidth: 0.07 }, fin: 0x073590, tail: true,
    mark: { kind: 'logo', logo: 'harp', color: 0xf1c933 }, winglet: 0x073590 },
  // white; the tail burgundy below and light blue above, the name above the windows
  { id: 'eurowings', name: 'Eurowings', title: 'Eurowings', titleColor: 0x8f174f, titleAt: 'above', titleHeight: 0.26, body: 0xf4f5f7,
    fin: 0x8f174f, tail: true, mark: { kind: 'split', color: 0x2aa9e0 }, winglet: 0x2aa9e0 },
  // white above an orange band that climbs to the cockpit, the name in orange above the windows; orange engines and
  // tail with the name up the fin
  { id: 'easyjet', name: 'easyJet', title: 'easyJet', titleColor: 0xff6600, titleAt: 'above', titleHeight: 0.3, body: 0xf4f5f7, engine: 0xff6600,
    belly: { color: 0xff6600, from: 0.56, nose: 0.4 }, fin: 0xff6600, tail: true,
    mark: { kind: 'text', text: 'easyJet', color: 0xffffff, angle: 58 }, winglet: 0xff6600 },
  // white, a red, white and blue sweep on the tail
  { id: 'britannia', name: 'British style', title: 'BRITISH', titleColor: 0x1b2a5c, titleAt: 'above', body: 0xf4f5f7,
    belly: { color: 0x1b2a5c, from: 0.8 }, engine: 0x1b2a5c, fin: 0x1b2a5c, mark: { kind: 'split', color: 0xd2232a }, winglet: 0x1b2a5c, group: 'Airlines' },
  // white, the white fin with thin dark blue stripes swept back along its leading edge and a red one below them
  { id: 'airfrance', name: 'Air France', title: 'AIR FRANCE', titleColor: 0x002157, titleAt: 'above', body: 0xf4f5f7,
    fin: 0xf4f5f7, mark: { kind: 'stripes', color: 0x002157, color2: 0xe4002b }, winglet: 0x002157, group: 'Airlines' },
  // white, the name in gold, the UAE's flag over the fin (a red bar along the front, green, white and black bands)
  { id: 'emirates', name: 'Emirates', title: 'Emirates', titleColor: 0xb8912b, titleStyle: '700 italic', titleAt: 'above', titleHeight: 0.3,
    body: 0xf4f5f7, fin: 0xf4f5f7, mark: { kind: 'flag', color: 0xd71921, color2: 0x00843d, color3: 0x1a1a1a }, winglet: 0xd71921, group: 'Airlines' },
  // grey with a burgundy tail and the oryx shape, name in burgundy
  { id: 'qatar', name: 'Qatar', title: 'QATAR', titleColor: 0x5c0632, titleAt: 'above', body: 0xd9dbde, fin: 0x5c0632, tail: true,
    mark: { kind: 'logo', logo: 'bird', color: 0xd9dbde }, winglet: 0x5c0632, group: 'Airlines' },
  // white with a red tail and the white tulip-like bird in a disc
  { id: 'turkish', name: 'Turkish', title: 'TURKISH', titleColor: 0x0b2a5b, titleAt: 'above', body: 0xf4f5f7, fin: 0xc70a0c,
    mark: { kind: 'logo', logo: 'tulip', color: 0xffffff }, winglet: 0xc70a0c, group: 'Airlines' },
  // red tail with a white band, red-white-red
  { id: 'austrian', name: 'Austrian', title: 'Austrian', titleColor: 0xd0021b, titleAt: 'above', titleHeight: 0.26, body: 0xf4f5f7,
    fin: 0xd0021b, tail: true, mark: { kind: 'chevron', color: 0xffffff, size: 0.7 }, winglet: 0xd0021b, group: 'Airlines' },
  // white, the name large in dark blue, the red fin with the white edelweiss flower (here a star)
  { id: 'edelweiss', name: 'Edelweiss', title: 'edelweiss', titleColor: 0x0f2a52, titleAt: 'above', titleHeight: 0.34, body: 0xf4f5f7,
    fin: 0xd6001c, mark: { kind: 'logo', logo: 'star', color: 0xffffff }, winglet: 0xd6001c, group: 'Airlines' },
  // pink and purple
  { id: 'wizz', name: 'Wizz Air', title: 'WIZZ', titleColor: 0xc6007e, titleLength: 2.2, titleHeight: 0.45, body: 0xf4f5f7,
    belly: { color: 0x2c1f63, from: 0.75, line: 0xc6007e, lineWidth: 0.08 }, engine: 0xc6007e, fin: 0x2c1f63, tail: true,
    mark: { kind: 'text', text: 'wizz', color: 0xc6007e, angle: 60 }, winglet: 0xc6007e, group: 'Airlines' },
  // grey with a dark blue globe tail
  { id: 'united', name: 'United', title: 'UNITED', titleColor: 0x002244, titleAt: 'above', body: 0xf4f5f7,
    belly: { color: 0x002244, from: 0.82 }, engine: 0x002244, fin: 0x002244, mark: { kind: 'logo', logo: 'globe', color: 0x2f9be0 }, winglet: 0x002244, group: 'Airlines' },
  // bare-metal look, the flag on the tail
  { id: 'american', name: 'American', title: 'American', titleColor: 0x36495a, titleAt: 'above', body: 0xc8ced6, fin: 0x0078d2,
    mark: { kind: 'split', color: 0xc30019 }, winglet: 0x0078d2, group: 'Airlines' },
  // white with a dark blue tail, a gold bird
  { id: 'singapore', name: 'Singapore', title: 'SINGAPORE AIRLINES', titleColor: 0x1d2d5c, titleAt: 'above', titleHeight: 0.2, body: 0xf4f5f7,
    fin: 0x1d2d5c, mark: { kind: 'logo', logo: 'bird', color: 0xf6a800 }, winglet: 0x1d2d5c, stripe: { color: 0xf6a800, at: 0.86, width: 0.04 }, group: 'Airlines' },
  // white, a red and yellow tail
  { id: 'iberia', name: 'Iberia', title: 'IBERIA', titleColor: 0xd7192d, titleAt: 'above', body: 0xf4f5f7, fin: 0xd7192d,
    mark: { kind: 'split', color: 0xffcc00 }, winglet: 0xd7192d, group: 'Airlines' },
  // white with a black tail and the red maple leaf
  { id: 'aircanada', name: 'Air Canada', title: 'AIR CANADA', titleColor: 0x111111, titleAt: 'above', body: 0xf4f5f7,
    belly: { color: 0x111111, from: 0.85 }, engine: 0x111111, fin: 0x111111, mark: { kind: 'logo', logo: 'maple', color: 0xd22630 }, winglet: 0x111111, group: 'Airlines' },
  // white, a red tail with the white kangaroo shape (here a bird)
  { id: 'qantas', name: 'Qantas', title: 'QANTAS', titleColor: 0xe0001b, titleAt: 'above', body: 0xf4f5f7, fin: 0xe0001b, tail: true,
    mark: { kind: 'logo', logo: 'plane', color: 0xffffff }, winglet: 0xe0001b, group: 'Airlines' },
  // white with a dark green tail, the white brushwing
  { id: 'cathay', name: 'Cathay', title: 'CATHAY', titleColor: 0x005d63, titleAt: 'above', body: 0xf4f5f7, fin: 0x005d63,
    mark: { kind: 'logo', logo: 'wave', color: 0xffffff }, winglet: 0x005d63, group: 'Airlines' },
  // white, the red sun on the fin
  { id: 'jal', name: 'JAL', title: 'JAPAN AIRLINES', titleColor: 0x111111, titleAt: 'above', titleHeight: 0.2, body: 0xf4f5f7,
    fin: 0xf4f5f7, mark: { kind: 'logo', logo: 'crane', color: 0xcc0000 }, group: 'Airlines' },
  // white with a blue fin and the white F, blue engines
  { id: 'finnair', name: 'Finnair', title: 'FINNAIR', titleColor: 0x0b1560, titleAt: 'above', body: 0xf4f5f7, engine: 0x0b1560, fin: 0x0b1560,
    mark: { kind: 'text', text: 'F', color: 0xffffff, angle: 0 }, winglet: 0x0b1560, group: 'Airlines' },
  // Classic: a cheatline along the windows
  { id: 'classic-blue', name: 'Classic blue', title: 'AIRWAYS', titleColor: 0x14306b, titleAt: 'above', body: 0xf4f5f7,
    stripe: { color: 0x14306b, at: 0.6, width: 0.16 }, belly: { color: 0xb9c0c8, from: 0.8 }, fin: 0x14306b,
    mark: { kind: 'logo', logo: 'globe', color: 0xffffff }, group: 'Classic' },
  { id: 'classic-red', name: 'Classic red', title: 'INTERNATIONAL', titleColor: 0x8c1c13, titleAt: 'above', titleHeight: 0.18, body: 0xf4f5f7,
    stripe: { color: 0xc0281d, at: 0.6, width: 0.14 }, belly: { color: 0xc8ced6, from: 0.78 }, fin: 0xf4f5f7,
    mark: { kind: 'disc', color: 0xc0281d }, group: 'Classic' },
  { id: 'polished', name: 'Polished metal', title: 'JET CLIPPER', titleColor: 0x0d3d7a, titleAt: 'above', body: 0xf4f5f7,
    stripe: { color: 0x0d3d7a, at: 0.6, width: 0.12 }, belly: { color: 0xbcc3cb, from: 0.7 }, wing: 0xbcc3cb, engine: 0xbcc3cb, fin: 0xf4f5f7,
    mark: { kind: 'logo', logo: 'globe', color: 0x0d3d7a }, group: 'Classic' },
  { id: 'sunset', name: 'Sunset', title: 'SUNWAYS', titleColor: 0xffffff, titleAt: 'low', body: 0xf4f5f7, engine: 0xf28c28,
    belly: { color: 0xf28c28, from: 0.55, nose: 0.3, line: 0xd8343a, lineWidth: 0.1 }, fin: 0xd8343a, tail: true,
    mark: { kind: 'logo', logo: 'sun', color: 0xffd23f }, winglet: 0xf28c28, group: 'Classic' },
  // Basic
  { id: 'white', name: 'Plain white', title: '', titleColor: 0, body: 0xf4f5f7, fin: 0xf4f5f7, group: 'Basic' },
  { id: 'grey', name: 'Leasing grey', title: '', titleColor: 0, body: 0xd5d8dc, wing: 0xc4c8cd, fin: 0xd5d8dc, group: 'Basic' },
  { id: 'night', name: 'Night', title: 'NIGHTJET', titleColor: 0xbfa36b, body: 0x1c2333, wing: 0xc4c8cd, engine: 0x1c2333,
    fin: 0x1c2333, tail: true, mark: { kind: 'logo', logo: 'star', color: 0xbfa36b }, winglet: 0xbfa36b, group: 'Basic' },
  { id: 'green', name: 'Eco green', title: 'GREENAIR', titleColor: 0x1d6b3a, titleAt: 'above', body: 0xf4f5f7,
    belly: { color: 0x2f9a57, from: 0.78, line: 0x9fd36b, lineWidth: 0.06 }, engine: 0x2f9a57, fin: 0x2f9a57, tail: true,
    mark: { kind: 'logo', logo: 'wave', color: 0xffffff }, winglet: 0x9fd36b, group: 'Basic' },
];

// Every livery to choose from, and the airline's and each plane's (FG.liveries is the whole interface).
//   all()          the built-in ones, then those of this browser's library, then any the saved game brings along
//   find(id)       a livery by id (null if unknown)
//   of(p)          the livery a plane flies: its own (p.livery) or the airline's
//   key(l)         id and revision: what the 3D view caches a painted model under
//   library        own designs and downloads, kept in this browser (localStorage 'flightgame.liveries')
//   keep(l)        put a livery into the library (and into the saved game if it uses it); it gets a new revision
//   drop(id)       take it out of the library
//   use(l)         make sure the saved game carries it (state.liveries), so the save works in another browser
FG.liveries = (function () {
  const KEY = 'flightgame.liveries';
  let library = [];
  try { library = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { /* none yet */ }
  if (!Array.isArray(library)) library = [];
  const state = () => (FG.game && FG.game.state) || null;
  const saved = () => { const s = state(); return (s && Array.isArray(s.liveries)) ? s.liveries : []; };
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(library)); } catch (e) { /* only for this visit */ } };
  const api = {
    library,
    version: 0, // goes up whenever a livery changes or is chosen (windows redraw on it)
    all() {
      const out = FG.data.liveries.slice();
      const ids = new Set(out.map((l) => l.id));
      for (const l of [...library, ...saved()]) if (!ids.has(l.id)) { ids.add(l.id); out.push(l); }
      return out;
    },
    find(id) {
      if (!id) return null;
      return saved().find((l) => l.id === id) || library.find((l) => l.id === id) || FG.data.liveries.find((l) => l.id === id) || null;
    },
    of(p) {
      return (p && p.livery && api.find(p.livery)) || FG.livery();
    },
    key: (l) => `${l.id}@${l.rev || 0}`,
    builtIn: (id) => FG.data.liveries.some((l) => l.id === id),
    keep(l) {
      const copy = JSON.parse(JSON.stringify(l));
      copy.rev = Date.now();
      const i = library.findIndex((x) => x.id === copy.id);
      if (i >= 0) library[i] = copy; else library.push(copy);
      store();
      const s = saved();
      const j = s.findIndex((x) => x.id === copy.id);
      if (j >= 0) s[j] = copy;
      api.changed();
      return copy;
    },
    drop(id) {
      const i = library.findIndex((x) => x.id === id);
      if (i >= 0) library.splice(i, 1);
      store();
      api.changed();
    },
    use(l) {
      const s = state();
      if (!s || !l || api.builtIn(l.id)) return;
      if (!Array.isArray(s.liveries)) s.liveries = [];
      const j = s.liveries.findIndex((x) => x.id === l.id);
      if (j >= 0) s.liveries[j] = l; else s.liveries.push(l);
    },
    changed() {
      api.version++;
      if (FG.game) FG.game.dirty = true;
    },
  };
  return api;
})();

// The livery the airline flies (the first one where no game is running, as in the tools). With a plane: the
// one that plane flies (its own, else the airline's).
FG.livery = (p) => {
  if (p) return FG.liveries.of(p);
  const id = FG.game && FG.game.state && FG.game.state.livery;
  return (id && FG.liveries.find(id)) || FG.data.liveries[0];
};
