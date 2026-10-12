// Ready-made airlines for the start screen's Quick start (mostly for testing): one click starts a
// game with planes, slots and running timetables. Also reachable by URL: index.html?preset=<id>.
//   home: home airport. money: cash after setup (replaces the difficulty's start money).
//   planes: [type, stops] – every plane starts at home and flies the loop home → stops… → home
//   all day. stops [] = the plane stays parked at home. Slots are given free.
window.FG = window.FG || {};
FG.data = FG.data || {};

FG.data.presets = {
  swiss: {
    name: 'Swiss regional', desc: 'Bern with 3 turboprops/regional jets on short hops.',
    company: 'Bern Air', home: 'BRN', mode: 'arcade', difficulty: 'normal', money: 2000000,
    planes: [
      ['ATR72-600', ['LUG']],
      ['Q400', ['MUC']],
      ['E190', ['LCY']],
    ],
  },
  europe: {
    name: 'European network', desc: 'Zurich hub, 8 jets to the big European cities.',
    company: 'Alpine Express', home: 'ZRH', mode: 'arcade', difficulty: 'normal', money: 25000000,
    planes: [
      ['A320neo', ['LHR']],
      ['A320neo', ['CDG']],
      ['A320neo', ['BCN']],
      ['A321', ['FCO']],
      ['A220-300', ['AMS']],
      ['A220-300', ['VIE']],
      ['B737-800', ['MAD']],
      ['E195-E2', ['BER', 'CPH']],
    ],
  },
  // Timetables repeat daily and a crew flies at most 12 h a day (C.crewMaxDutyMin), so a route can be
  // at most ~6 h one way: no New York or Asia from Europe.
  widebody: {
    name: 'Widebodies', desc: 'Frankfurt with an A380, 777, 787 and A350 to the Gulf, Israel and London.',
    company: 'Main Global', home: 'FRA', mode: 'arcade', difficulty: 'easy', money: 100000000,
    planes: [
      ['A350-900', ['DOH']],
      ['B787-9', ['DXB']],
      ['B777-300ER', ['TLV']],
      ['A380-800', ['LHR']],
      ['A320neo', ['LHR']],
    ],
  },
  busy: {
    name: 'Busy hub (20 planes)', desc: 'Zurich with 20 planes in the air – for performance and 3D tests.',
    company: 'Stress Test Air', home: 'ZRH', mode: 'arcade', difficulty: 'easy', money: 50000000,
    planes: [
      ['A320neo', ['LHR']], ['A320neo', ['CDG']], ['A320neo', ['AMS']], ['A320neo', ['FRA']],
      ['A321', ['FCO']], ['A321', ['MAD']], ['A220-300', ['VIE']], ['A220-300', ['MUC']],
      ['A220-300', ['GVA']], ['B737-800', ['BCN']], ['B737-800', ['LIS']], ['E190', ['MXP']],
      ['E190', ['NCE']], ['E195-E2', ['BER']], ['E195-E2', ['CPH']], ['Q400', ['LYS']],
      ['ATR72-600', ['STR']], ['A330-300', ['TLV']], ['B787-9', ['DXB']], ['A350-900', ['DOH']],
    ],
  },
  sandbox: {
    name: 'Sandbox', desc: 'CHF 1 billion and one parked plane at Zurich. Build whatever you want.',
    company: 'Sandbox Air', home: 'ZRH', mode: 'arcade', difficulty: 'easy', money: 1000000000,
    planes: [
      ['A320neo', []],
    ],
  },
  hard: {
    name: 'Hard start', desc: 'Realistic mode, hard, one ATR at Lugano – the toughest beginning.',
    company: 'Ticino Wings', home: 'LUG', mode: 'realistic', difficulty: 'hard',
    planes: [
      ['ATR72-600', []],
    ],
  },
};
