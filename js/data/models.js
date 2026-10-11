// 3D model of each aircraft type: models/<file>.glb, drawn in the 3D view (js/view3d.js), and its picture
// models/hangar/<file>.webp, shown in the hangar (js/hangar.js). Types without their own model use a close
// relative; types missing here have no model (placeholder in 3D, drawing from looks.js in the hangar).
// After adding a model, open tools/hangar_shots.html to make its hangar picture.
FG.data.models = {
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
};

// Frame of the hangar pictures, in aircraft lengths: width, height, and how far the lowest point of the
// aircraft sits above the lower edge. tools/hangar_shots.html renders with these, js/hangar.js places with them.
FG.data.modelShot = { w: 1.1, h: 0.5, ground: 0.04 };
