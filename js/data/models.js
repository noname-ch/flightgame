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

// Models that stand on their own landing gear. The others have none and hover a little above the hangar floor.
FG.data.modelsOnGear = ['dhc6', 'ju52'];
