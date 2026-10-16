// 3D model of each aircraft type: models/<file>.glb, drawn in the 3D view (js/view3d.js) and in the hangar
// (js/hangar3d.js). Types without their own model use a close relative. Each type also has a picture for the
// hangar tiles, models/hangar/<type>.webp, and a top view for the map, models/icons/<type>.webp (see typeSlug).
// After adding a model or a type, open tools/hangar_shots.html to make the pictures and icons.
FG.data.models = {
  'DHC6-400': 'dhc6', 'DO228NG': 'do228', 'B1900D': 'b1900d', 'SAAB340': 'saab340', 'SAAB2000': 'saab2000',
  'DO328': 'atr42', 'ATR42-600': 'atr42', 'ATR72-600': 'atr42', 'Q400': 'q400',
  'ERJ145': 'crj700', 'CRJ200': 'crj700', 'CRJ900': 'crj900', 'F100': 'crj900', 'RJ100': 'bae146',
  'E175': 'e170', 'E190': 'e190', 'E195': 'e190', 'E190-E2': 'e190', 'E195-E2': 'e190', 'SSJ100': 'e190',
  'A220-100': 'cs100', 'A220-300': 'cs300',
  'A318': 'a318', 'A319': 'a319', 'A320': 'a320', 'A320neo': 'a320', 'C919': 'a320',
  'A321': 'a321', 'A321neo': 'a321', 'A321XLR': 'a321',
  'B737-700': 'b737', 'B737-800': 'b738', 'B737-8': 'b738', 'B737-9': 'b739', 'B757-200': 'b752', 'MD-82': 'crj900',
  'B767-300ER': 'b763', 'A330-200': 'a332', 'A330-300': 'a333', 'A330-900': 'a333',
  'B787-8': 'b788', 'B787-9': 'b789', 'B787-10': 'b789', 'A340-600': 'a346', 'A350-900': 'a359', 'A350-1000': 'a359',
  'B777-200ER': 'b772', 'B777-300ER': 'b773', 'B777-9': 'b773', 'B747-400': 'b744', 'B747-8': 'b748', 'A380-800': 'a380',
  'JU52': 'ju52', 'DC-3': 'dc3', 'CONCORDE': 'concorde',
  // story-mode types: none has its own model yet, each borrows a relative's
  'DC-4': 'dc3', 'CV-340': 'dc3', 'DC-6B': 'dc3', 'L-1049G': 'dc3', 'DC-7C': 'dc3', 'VC-700': 'saab2000',
  'BRIT-310': 'saab2000', 'L-188': 'saab2000', 'IL-18': 'saab2000', 'TU-114': 'saab2000', 'HS748': 'saab340',
  'YS-11': 'saab340', 'EMB110': 'b1900d', 'EMB120': 'b1900d', 'DHC6': 'dhc6', 'DHC7': 'q400', 'DASH8-100': 'q400',
  'F27': 'atr42', 'ATR42-300': 'atr42', 'F50': 'atr42', 'ATR72-500': 'atr42', 'YAK-40': 'crj700', 'CRJ100': 'crj700',
  'CRJ700': 'crj700', 'VFW614': 'e170', 'E170': 'e170', 'BAE146': 'bae146', 'BAC111': 'crj900', 'TU-134': 'crj900',
  'F28': 'crj900', 'F70': 'crj900', 'CARAVELLE': 'crj900', 'B727-100': 'crj900', 'VC10': 'crj900',
  'TRIDENT': 'crj900', 'DC-9-30': 'crj900', 'B727-200': 'crj900', 'IL-62': 'crj900', 'TU-154': 'crj900',
  'DC-9-50': 'crj900', 'MD-81': 'crj900', 'B717': 'crj900', 'TU-104': 'b752', 'COMET4': 'a346', 'B707-120': 'a346',
  'CV-880': 'a346', 'B720': 'a346', 'DC-8-50': 'a346', 'B707-320B': 'a346', 'DC-8-63': 'a346', 'IL-86': 'a346',
  'A340-300': 'a346', 'B737-200': 'b737', 'B737-300': 'b737', 'B747-100': 'b744', 'B747-200B': 'b744',
  'B747SP': 'b744', 'DC-10-10': 'b772', 'L-1011': 'b772', 'DC-10-30': 'b772', 'MD-11': 'b772', 'A300': 'a332',
  'A310': 'a332', 'B767-200': 'b763', 'TU-144': 'concorde',
};

// The aircraft each model shows: its length (m) and fuselage height (m, as `dia` in looks.js). A type that
// borrows a relative's model is drawn with its own length, but with the model's wing and a fuselage as thick
// as its own (js/models3d.js modelSize): a stretched variant gets longer, not bigger all round.
FG.data.modelSize = {
  dhc6: [15.75, 1.8], do228: [16.37, 1.8], b1900d: [17.74, 1.9], saab340: [19.7, 2.3], saab2000: [27.3, 2.3],
  atr42: [22.77, 2.9], q400: [32.59, 2.7], crj700: [32.46, 2.7], crj900: [36.36, 2.7], bae146: [28.31, 3.6],
  e170: [29.8, 3.3], e190: [35.83, 3.3], cs100: [35.02, 3.7], cs300: [38.17, 3.7],
  a318: [31.71, 4.1], a319: [33.89, 4.1], a320: [38.27, 4.1], a321: [44.52, 4.1],
  b737: [34.93, 4.0], b738: [39.42, 4.0], b739: [40.62, 4.0], b752: [46.34, 4.0], b763: [55.2, 5.4],
  a332: [58.36, 5.6], a333: [63.05, 5.6], a346: [77.12, 5.6], a359: [67.02, 6.1], a380: [72.68, 8.4],
  b788: [56.68, 5.9], b789: [65.9, 5.9], b772: [64.43, 6.2], b773: [74.38, 6.2], b744: [70.94, 6.5], b748: [76.55, 6.5],
  ju52: [19.01, 2.2], dc3: [19.68, 2.4], concorde: [61.77, 3.3],
};

// File name of a type's hangar picture and map icon: 'B737-8' -> 'b737-8'.
FG.data.typeSlug = (type) => type.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// Frame of the hangar pictures, in aircraft lengths: width, height, and how far the lowest point of the
// aircraft sits above the lower edge. tools/hangar_shots.html renders with these, js/hangar.js places with them.
FG.data.modelShot = { w: 1.1, h: 0.5, ground: 0.04 };

// Models that have landing gear of their own. The others get theirs from js/gear3d.js (FG.data.gear).
FG.data.modelsOnGear = ['dhc6', 'ju52'];

// Landing gear of each model without gear of its own (js/gear3d.js builds it): main = where the main legs are
// ('wing' under the wing root, 'nacelle' in the engine nacelles, 'body' on the fuselage sides), track = half
// the distance between the main legs in fuselage widths, wheels = each main leg's tyres as rows x across
// ('1x2' a pair, '2x1' in tandem, '2x2' and '3x2' bogies), tyre = main tyre diameter (m), noseTyre = the nose
// gear's (m; else two thirds of the main ones), mainAt = the main legs' distance from the nose (share of the length;
// else behind the middle of the wing root), nose = the nose gear's distance from
// the nose (share of the length), tail = a tail wheel instead (leg = its main legs below the nacelles, m),
// body = more legs under the fuselage { track, wheels, aft: behind the main legs (share of the length) }. A type
// can have an entry of its own, for other gear than its model's (js/gear3d.js gearKey).
FG.data.gear = {
  do228: { main: 'body', track: 0.95, wheels: '1x1', tyre: 0.65 },
  b1900d: { main: 'nacelle', wheels: '1x2', tyre: 0.56, nose: 0.1 },
  saab340: { main: 'nacelle', wheels: '1x2', tyre: 0.75, nose: 0.1 },
  saab2000: { main: 'nacelle', wheels: '1x2', tyre: 0.8, nose: 0.09 },
  atr42: { main: 'body', track: 0.68, wheels: '1x2', tyre: 0.86, noseTyre: 0.45, nose: 0.08, mainAt: 0.476 },
  q400: { main: 'nacelle', wheels: '1x2', tyre: 0.85, nose: 0.09 },
  crj700: { main: 'wing', track: 0.62, wheels: '1x2', tyre: 0.9 },
  crj900: { main: 'wing', track: 0.62, wheels: '1x2', tyre: 0.9 },
  bae146: { main: 'body', track: 0.66, wheels: '1x2', tyre: 0.85, nose: 0.1 },
  e170: { main: 'wing', track: 0.95, wheels: '1x2', tyre: 1 },
  e190: { main: 'wing', track: 0.95, wheels: '1x2', tyre: 1 },
  cs100: { main: 'wing', track: 0.9, wheels: '1x2', tyre: 1.05 },
  cs300: { main: 'wing', track: 0.9, wheels: '1x2', tyre: 1.05 },
  a318: { main: 'wing', track: 0.95, wheels: '1x2', tyre: 1.17 },
  a319: { main: 'wing', track: 0.95, wheels: '1x2', tyre: 1.17 },
  a320: { main: 'wing', track: 0.95, wheels: '1x2', tyre: 1.17 },
  a321: { main: 'wing', track: 0.95, wheels: '1x2', tyre: 1.17 },
  b737: { main: 'wing', track: 0.76, wheels: '1x2', tyre: 1.1 },
  b738: { main: 'wing', track: 0.76, wheels: '1x2', tyre: 1.1 },
  b739: { main: 'wing', track: 0.76, wheels: '1x2', tyre: 1.1 },
  b752: { main: 'wing', track: 0.9, wheels: '2x2', tyre: 1.17 },
  b763: { main: 'wing', track: 0.92, wheels: '2x2', tyre: 1.17 },
  a332: { main: 'wing', track: 0.95, wheels: '2x2', tyre: 1.27 },
  a333: { main: 'wing', track: 0.95, wheels: '2x2', tyre: 1.27 },
  a346: { main: 'wing', track: 0.95, wheels: '2x2', tyre: 1.4, body: { track: 0, wheels: '2x2', aft: 0.02 } },
  a359: { main: 'wing', track: 0.89, wheels: '2x2', tyre: 1.4 },
  a380: { main: 'wing', track: 0.88, wheels: '2x2', tyre: 1.4, nose: 0.1, body: { track: 0.35, wheels: '3x2', aft: 0.05 } },
  b788: { main: 'wing', track: 0.85, wheels: '2x2', tyre: 1.3 },
  b789: { main: 'wing', track: 0.85, wheels: '2x2', tyre: 1.3 },
  b772: { main: 'wing', track: 0.89, wheels: '3x2', tyre: 1.32, nose: 0.1 },
  b773: { main: 'wing', track: 0.89, wheels: '3x2', tyre: 1.32, nose: 0.1 },
  b744: { main: 'wing', track: 0.85, wheels: '2x2', tyre: 1.25, nose: 0.1, body: { track: 0.3, wheels: '2x2', aft: 0.05 } },
  b748: { main: 'wing', track: 0.85, wheels: '2x2', tyre: 1.25, nose: 0.1, body: { track: 0.3, wheels: '2x2', aft: 0.05 } },
  dc3: { main: 'nacelle', wheels: '1x1', tyre: 1.15, tail: true, leg: 1.5 },
  concorde: { main: 'wing', track: 1.33, wheels: '2x2', tyre: 1.2, nose: 0.24 },
  // types with other gear than the model they borrow: the later propliners drawn with the DC-3 had a nose wheel
  'DC-4': { main: 'nacelle', wheels: '1x2', tyre: 1.2, nose: 0.13 },
  'CV-340': { main: 'nacelle', wheels: '1x2', tyre: 1.1, nose: 0.12 },
  'DC-6B': { main: 'nacelle', wheels: '1x2', tyre: 1.25, nose: 0.13 },
  'L-1049G': { main: 'nacelle', wheels: '1x2', tyre: 1.3, nose: 0.12 },
  'DC-7C': { main: 'nacelle', wheels: '1x2', tyre: 1.3, nose: 0.13 },
};

// Propellers of the models that have them, for their colours (js/livery.js): hub x (either side) and z, the y
// of the blades and their radius, t = half the blades' thickness along y, tip = the y of the spinner's tip
// (model units, measured off the models). Black blades with yellow tips and a black spinner, as on most
// turboprops; `blade` and `spinner` for others (the propliners' bare metal ones).
FG.data.props = {
  atr42: { x: 0.174, z: -0.024, y: 0.2216, r: 0.088, t: 0.0065, tip: 0.2558 },
  q400: { x: 0.134, z: -0.0346, y: 0.1627, r: 0.063, t: 0.0055, tip: 0.1856 },
  saab340: { x: 0.1653, z: -0.0857, y: 0.2212, r: 0.0858, t: 0.006, tip: 0.2331 },
  saab2000: { x: 0.135, z: -0.0702, y: 0.2111, r: 0.0704, t: 0.005, tip: 0.223 },
  b1900d: { x: 0.1485, z: -0.0433, y: 0.2167, r: 0.0775, t: 0.009, tip: 0.2375 },
  do228: { x: 0.154, z: -0.0096, y: 0.1834, r: 0.083, t: 0.003, tip: 0.2166 },
  dhc6: { x: 0.1814, z: -0.0029, y: 0.2659, r: 0.0788, t: 0.003, tip: 0.2923 },
  dc3: { x: 0.143, z: -0.0822, y: 0.3552, r: 0.0891, t: 0.003, tip: 0.377, blade: 0x9ea4ab, spinner: 0xb9bec4 },
};
