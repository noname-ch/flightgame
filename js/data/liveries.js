// Airline liveries for the 3D aircraft models (painted by js/livery.js from the position on the aircraft, so
// each fits every model). Simplified after photographs of the real ones (Wikimedia Commons): the colours and
// where they go, the title, and a plain mark or a simple logo on the fin.
//   title, titleColor, titleStyle (CSS font style and weight)  the name on the forward fuselage
//   titleAt     'window' (default: large, across the window row), 'above' (smaller, above the windows) or
//               'low' (on the belly); titleHeight and titleLength (in fuselage widths) make it bigger
//   body        the fuselage (its upper part where there is a belly)
//   wing        wings, tailplanes and engines (default: the body colour)
//   engine      the engine cowlings (default: as the wings)
//   belly       { color, from, line, lineWidth, nose, aft }: the fuselage below `from` fuselage widths under
//               its top, with a stripe along the edge; `nose`: the edge climbs by so many widths to the nose;
//               `aft`: only behind this point of the length (0 = the middle, -0.5 = the tail)
//   fin         colour of the fin
//   tail        true: the fin's colour goes on round the rear fuselage
//   mark        on the fin: { kind: 'cross' | 'disc' | 'ring' | 'chevron' | 'triangle' | 'split', color, color2,
//               size }, { kind: 'logo', logo: 'klm' | 'crane' | 'harp', color, size } or
//               { kind: 'text', text, color, style, angle (it rises along the fin) }
//   winglet     colour of the wing tips
// The first one is the livery of a new airline. state.livery in a saved game says which one it flies.
FG.data.liveries = [
  { id: 'swiss', name: 'SWISS', title: 'SWISS', titleColor: 0xe60005, body: 0xf1f2f4, fin: 0xe60005,
    mark: { kind: 'cross', color: 0xffffff } },
  // white, the tail dark blue down round the rear fuselage, the crane in a ring, the name above the windows
  { id: 'lufthansa', name: 'Lufthansa', title: 'Lufthansa', titleColor: 0x05164d, titleAt: 'above', body: 0xf4f5f7,
    fin: 0x05164d, tail: true, mark: { kind: 'logo', logo: 'crane', color: 0xffffff }, winglet: 0x05164d },
  // bright blue above a dark blue stripe, white below; white fin with the crown and letters
  { id: 'klm', name: 'KLM', title: 'KLM', titleColor: 0xffffff, titleAt: 'above', titleHeight: 0.26, body: 0x00a1e4, wing: 0xe9edf1,
    belly: { color: 0xf1f2f4, from: 0.7, line: 0x003a70, lineWidth: 0.05 }, fin: 0xf4f5f7,
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
  // white above an orange band that climbs to the cockpit, the name in white on it; orange engines and tail
  // with the name up the fin
  { id: 'easyjet', name: 'easyJet', title: 'easyJet', titleColor: 0xffffff, titleAt: 'low', body: 0xf4f5f7, engine: 0xff6600,
    belly: { color: 0xff6600, from: 0.56, nose: 0.4 }, fin: 0xff6600, tail: true,
    mark: { kind: 'text', text: 'easyJet', color: 0xffffff, angle: 58 }, winglet: 0xff6600 },
];

// The livery the airline flies (the first one where no game is running, as in the tools).
FG.livery = () => {
  const id = FG.game && FG.game.state && FG.game.state.livery;
  return FG.data.liveries.find((l) => l.id === id) || FG.data.liveries[0];
};
