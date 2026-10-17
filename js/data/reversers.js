// Thrust reversers: what each type has to slow down after touchdown (looks and sound only, js/livery.js and
// js/sound.js; the landing run is the same either way).
// kind:
//   cascade  translating sleeve: the rear of the fan cowl slides back and opens a band of cascade vanes (big fans)
//   doors    pivoting doors: four doors in the cowl swing out at the back (Airbus with CFM56-5)
//   buckets  target/clamshell: two buckets swing shut behind the exhaust (low-bypass jets, Concorde)
//   prop     propellers turned to reverse pitch, the engines spool up (most turboprops, the last piston airliners)
//   flat     propellers to ground fine pitch only: drag, no reverse power (the Dart turboprops)
//   none     brakes only: airbrakes (BAe 146, F28), a drag chute (Tu-104, Tu-144) or nothing (DC-3, Ju 52)
// on: which engines have them, where not all: inner (A380, A340-600), outer (the outer engine of each pair or
//   side: Il-62, VC10, Comet), sides (not the tail engine: Tu-154, Trident), center (only the tail engine: Yak-40)
FG.data.reversers = (() => {
  const R = {};
  const set = (kind, types, on) => types.split(' ').forEach((t) => { R[t] = on ? { kind, on } : { kind }; });
  set('cascade', 'CRJ100 CRJ200 CRJ700 CRJ900 E170 E175 E190 E195 E190-E2 E195-E2 SSJ100 A220-100 A220-300 ' +
    'A320neo A321neo A321XLR B737-300 B737-700 B737-800 B737-8 B737-9 B757-200 C919 ' +
    'B767-200 B767-300ER A300 A310 A330-200 A330-300 A330-900 B787-8 B787-9 B787-10 A350-900 A350-1000 ' +
    'B777-200ER B777-300ER B777-9 B747-100 B747-200B B747SP B747-400 B747-8 DC-10-10 DC-10-30 MD-11 L-1011 IL-86');
  set('cascade', 'A380-800 A340-600', 'inner');
  set('doors', 'A318 A319 A320 A321 A340-300');
  set('buckets', 'ERJ145 F70 F100 BAC111 TU-134 CARAVELLE DC-9-30 DC-9-50 MD-81 MD-82 B717 B737-200 ' +
    'B727-100 B727-200 B707-120 B707-320B B720 DC-8-50 DC-8-63 CV-880 CONCORDE');
  set('buckets', 'IL-62 VC10 COMET4', 'outer');
  set('buckets', 'TU-154 TRIDENT', 'sides');
  set('buckets', 'YAK-40', 'center');
  set('prop', 'DHC6 DHC6-400 DO228NG B1900D DO328 SAAB340 SAAB2000 ATR42-300 ATR42-600 ATR72-500 ATR72-600 ' +
    'Q400 DASH8-100 DHC7 EMB110 EMB120 F50 BRIT-310 L-188 IL-18 TU-114 DC-6B DC-7C L-1049G CV-340');
  set('flat', 'VC-700 F27 HS748 YS-11');
  set('none', 'BAE146 RJ100 F28 VFW614 TU-104 TU-144 DC-3 DC-4 JU52');
  return R;
})();
// A type's reversers ({ kind, on }); types not in the table go by their engines.
FG.data.reverserOf = (type) => {
  const r = FG.data.reversers[type];
  if (r) return r;
  const eng = FG.data.looks[type] && FG.data.looks[type].eng;
  return { kind: eng === 'prop2' ? 'prop' : eng === 'radial2' || eng === 'prop3' ? 'none' : 'cascade' };
};
// How the market and the plane window name them.
FG.data.reverserText = (type) => {
  const r = FG.data.reverserOf(type);
  const kind = { cascade: 'Cascade (translating sleeve)', doors: 'Pivoting doors', buckets: 'Clamshell buckets',
    prop: 'Reverse-pitch propellers', flat: 'Ground fine pitch only', none: 'None (brakes only)' }[r.kind];
  const on = { inner: 'inner engines', outer: 'outer engines', sides: 'side engines', center: 'tail engine' }[r.on];
  return on ? `${kind}, ${on} only` : kind;
};
