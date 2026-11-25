// Fly it yourself: an aircraft flown by hand in the 3D view (P, or ✈ Fly among the 3D view's buttons). Sixteen types
// (TYPES), each flying in its own way: Airbus fly-by-wire, conventional (Boeing, Bombardier, Concorde, turboprops) or classic
// (DC-3, Ju 52); jets, Concorde's reheat, turboprops and pistons; their own flaps, weights and limits.
// The A350's physics are a point-mass model with Airbus-like fly-by-wire (normal law): the stick asks for a pitch rate and
// holds the flight path when let go, the roll keys ask for a roll rate and the bank stays where it is left (up to 33°),
// the angle of attack is limited so the wing never stalls (alpha protection, alpha floor gives TOGA). The engines spool
// up slowly from idle; flaps and gear take seconds to move and add drag; wheel brakes, ground spoilers and reversers
// stop it on the runway. Touchdowns are rated by their sink rate; too hard, gear up or a wing tip down is a crash.
// The plane is the player's alone (not part of the airline): it runs in real time, whatever the game speed.
// view3d.js draws it (FG.pilot.pose()), points the cameras at it and calls FG.pilot.step() every frame.
(function () {
  'use strict';
  const G = FG.game;
  const KT = 0.514444, FT = 0.3048, DEG = Math.PI / 180, R_E = 6371008.8, G0 = 9.80665;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const wrap360 = (d) => ((d % 360) + 360) % 360;
  const wrap180 = (d) => ((((d % 360) + 540) % 360) - 180);

  // ---------- the aircraft ----------
  // Each type flies in its own way: its control law, engines, flaps, weights and limits.
  //   law: 'airbus'  fly-by-wire normal law: the stick asks for a pitch rate and the path is held when let go,
  //                  bank holds up to 33°, alpha protection and alpha floor, high speed protection;
  //        'conventional'  (Boeing, Concorde, turboprops) the stick moves the elevator, let go it springs back to
  //                  the trim (speed stable: more thrust makes it climb); no hard protections: it stalls
  //                  (stick shaker first), overspeed only warns;
  //        'classic' (DC-3, Ju 52) as conventional, heavier on the controls, the wings level themselves, no
  //                  stick shaker, and in a stall a wing drops.
  //   engine: 'jet' (thrust N per engine, falls with height and Mach), 'sst' (Concorde: ram air keeps the thrust up
  //           at Mach 2, reheat at the take-off detent), 'prop' (turboprop) and 'piston': power W per engine,
  //           thrust = power / speed, static thrust N per engine.
  //   Masses kg, wing area S m², wheelbase m, tail: pitch at which the tail strikes (°), speeds kt.
  //   conf: flap lever positions: flap angle drawn (°), extra lift at 0° alpha, max lift, extra drag, VFE kt.
  //   aero: lift at 0° alpha (clBase), lift slope /° (clA), drag (cd0, induced k), Mach of the drag rise (mdd).
  const AIRBUS_CONF = [
    { name: '0', flap: 0, cl0: 0, clmax: 1.30, cd: 0, vfe: 999 },
    { name: '1', flap: 0, cl0: 0.05, clmax: 1.65, cd: 0.004, vfe: 255 },
    { name: '1+F', flap: 8, cl0: 0.28, clmax: 1.92, cd: 0.012, vfe: 220 },
    { name: '2', flap: 15, cl0: 0.42, clmax: 2.10, cd: 0.022, vfe: 212 },
    { name: '3', flap: 22, cl0: 0.52, clmax: 2.25, cd: 0.032, vfe: 195 },
    { name: 'FULL', flap: 35, cl0: 0.70, clmax: 2.50, cd: 0.055, vfe: 186 },
  ];
  const A350 = {
    maker: 'Airbus', directName: 'DIRECT LAW', law: 'airbus', engine: 'jet', engines: 2, idle: 21, spool: 1, rev: 0.45, athr: true,
    speedBrake: true, groundSpoilers: true, gear: 'retract', conf: AIRBUS_CONF, toConf: 2,
    vmo: 340, mmo: 0.89, vle: 250, clbKt: 300, crzM: 0.85, vr: 150, finalKt: 165, finalNm: 10, finalConf: 3,
    clBase: 0.22, clA: 0.085, cd0: 0.017, k: 0.0394, mdd: 0.84, roll: 15,
    crashFpm: 1100, tipBank: 11, tyreKt: 230, gauge: 'N1 %', lawName: 'NORMAL LAW',
    detents: ['IDLE', 'CL', 'FLX/MCT', 'TOGA'],
  };
  const TYPES = {
    'A350-900': { ...A350, name: 'Airbus A350-900', toMass: 250000, landMass: 200000, S: 442, thrust: 374000, wheelbase: 28.7, tail: 11.5,
      blurb: 'Long-haul twin, Airbus fly-by-wire: let go of the stick and it holds its path; it cannot stall.' },
    'A350-1000': { ...A350, name: 'Airbus A350-1000', toMass: 290000, landMass: 225000, S: 464, thrust: 431000, wheelbase: 32.5, tail: 9.6,
      blurb: 'The stretched A350: heavier and longer, the tail strikes at under 10° on the rotation.' },
    'A320': { ...A350, name: 'Airbus A320', toMass: 70000, landMass: 60000, S: 122.6, thrust: 118000, wheelbase: 12.6, tail: 11.7, idle: 19, spool: 1.15,
      vmo: 350, mmo: 0.82, vle: 280, clbKt: 290, crzM: 0.78, vr: 145, finalKt: 150, finalConf: 3, clBase: 0.25, clA: 0.09, cd0: 0.019, k: 0.042, mdd: 0.79,
      roll: 17, tipBank: 10, rev: 0.35,
      conf: [
        { name: '0', flap: 0, cl0: 0, clmax: 1.35, cd: 0, vfe: 999 },
        { name: '1', flap: 0, cl0: 0.06, clmax: 1.70, cd: 0.004, vfe: 230 },
        { name: '1+F', flap: 10, cl0: 0.30, clmax: 2.00, cd: 0.013, vfe: 215 },
        { name: '2', flap: 15, cl0: 0.45, clmax: 2.20, cd: 0.024, vfe: 200 },
        { name: '3', flap: 20, cl0: 0.55, clmax: 2.35, cd: 0.034, vfe: 185 },
        { name: 'FULL', flap: 35, cl0: 0.75, clmax: 2.60, cd: 0.058, vfe: 177 },
      ],
      blurb: 'Short-haul Airbus: the same fly-by-wire as the A350, but light and nimble, quick to roll and to speed up.' },
    'A330-300': { ...A350, name: 'Airbus A330-300', toMass: 230000, landMass: 185000, S: 361.6, thrust: 316000, wheelbase: 25.6, tail: 10.5,
      spool: 0.9, vmo: 330, mmo: 0.86, clbKt: 300, crzM: 0.82, vr: 150, finalKt: 140, clBase: 0.23, clA: 0.088, cd0: 0.018, k: 0.04, mdd: 0.82, roll: 13,
      conf: AIRBUS_CONF.map((c, i) => ({ ...c, vfe: [999, 240, 215, 196, 186, 180][i] })),
      blurb: 'The workhorse twin: the A350\'s fly-by-wire on an older, lighter wing. Steady and easy, a little slower to speed up.' },
    'A340-300': { ...A350, name: 'Airbus A340-300', engines: 4, toMass: 276000, landMass: 190000, S: 361.6, thrust: 151000, wheelbase: 25.4, tail: 10.5,
      spool: 0.6, idle: 22, rev: 0.3, vmo: 330, mmo: 0.86, clbKt: 290, crzM: 0.82, vr: 155, finalKt: 140, clBase: 0.23, clA: 0.088, cd0: 0.018, k: 0.04, mdd: 0.82, roll: 12,
      conf: AIRBUS_CONF.map((c, i) => ({ ...c, vfe: [999, 240, 215, 196, 186, 180][i] })),
      blurb: 'Four small CFM56s on a heavy long-haul frame: the slowest climber of them all, and the engines take ages to spool up. Use the whole runway.' },
    'A340-600': { ...A350, name: 'Airbus A340-600', engines: 4, toMass: 368000, landMass: 265000, S: 439.4, thrust: 249000, wheelbase: 37.5, tail: 9,
      spool: 0.75, idle: 22, rev: 0.25, vmo: 330, mmo: 0.86, clbKt: 300, crzM: 0.83, vr: 160, finalKt: 150, clBase: 0.23, clA: 0.086, cd0: 0.018, k: 0.041, mdd: 0.83, roll: 10,
      conf: AIRBUS_CONF.map((c, i) => ({ ...c, vfe: [999, 240, 215, 196, 186, 180][i] })),
      blurb: 'The longest Airbus before the A380: 75 m and four Trents. A long fuselage, so the tail strikes early: rotate gently, under 9°.' },
    'A380-800': { ...A350, name: 'Airbus A380-800', engines: 4, toMass: 560000, landMass: 390000, S: 845, thrust: 332000, wheelbase: 31.9, tail: 11,
      spool: 0.7, idle: 21, rev: 0.25, vmo: 340, mmo: 0.89, vle: 250, clbKt: 300, crzM: 0.85, vr: 150, finalKt: 140, clBase: 0.24, clA: 0.085, cd0: 0.019, k: 0.04, mdd: 0.86, roll: 9,
      conf: AIRBUS_CONF.map((c, i) => ({ ...c, vfe: [999, 263, 222, 220, 196, 182][i] })),
      blurb: 'The double-decker: 560 t, a huge wing that lands slowly, slow to roll and to spool up. Only the inner engines reverse.' },
    'B737-800': { name: 'Boeing 737-800', maker: 'Boeing', law: 'conventional', engine: 'jet', engines: 2, idle: 20, spool: 1, rev: 0.35, athr: true,
      speedBrake: true, groundSpoilers: true, gear: 'retract', toMass: 70000, landMass: 62000, S: 124.6, thrust: 121000, wheelbase: 15.6, tail: 11,
      vmo: 340, mmo: 0.82, vle: 270, clbKt: 280, crzM: 0.78, vr: 150, finalKt: 150, finalNm: 10, finalConf: 3,
      clBase: 0.24, clA: 0.09, cd0: 0.019, k: 0.043, mdd: 0.79, pitchRate: 3.5, roll: 14, aTau: 0.35, shaker: true,
      crashFpm: 1000, tipBank: 9, tyreKt: 225, gauge: 'N1 %', lawName: 'MANUAL', detents: ['IDLE', 'CLB', 'CON', 'TO/GA'],
      conf: [
        { name: 'UP', flap: 0, cl0: 0, clmax: 1.30, cd: 0, vfe: 999 },
        { name: '1', flap: 1, cl0: 0.10, clmax: 1.65, cd: 0.005, vfe: 250 },
        { name: '5', flap: 5, cl0: 0.28, clmax: 1.90, cd: 0.012, vfe: 250 },
        { name: '15', flap: 15, cl0: 0.45, clmax: 2.15, cd: 0.024, vfe: 200 },
        { name: '30', flap: 30, cl0: 0.65, clmax: 2.45, cd: 0.050, vfe: 175 },
        { name: '40', flap: 40, cl0: 0.75, clmax: 2.60, cd: 0.065, vfe: 162 },
      ], toConf: 2,
      blurb: 'Conventional Boeing: let go and the stick springs back to the trim; hold it and the trim follows (or Home / End). Speed stable: thrust changes the path. No protections: it stalls (stick shaker first) and can be overstressed.' },
    'B747-400': { name: 'Boeing 747-400', maker: 'Boeing', law: 'conventional', engine: 'jet', engines: 4, idle: 22, spool: 0.7, rev: 0.4, athr: true,
      speedBrake: true, groundSpoilers: true, gear: 'retract', toMass: 360000, landMass: 260000, S: 541, thrust: 252000, wheelbase: 25.6, tail: 11,
      vmo: 365, mmo: 0.92, vle: 270, clbKt: 320, crzM: 0.85, vr: 165, finalKt: 155, finalNm: 10, finalConf: 4,
      clBase: 0.24, clA: 0.085, cd0: 0.018, k: 0.045, mdd: 0.86, pitchRate: 2, roll: 8, aTau: 0.7, shaker: true,
      crashFpm: 1000, tipBank: 10, tyreKt: 225, gauge: 'N1 %', lawName: 'MANUAL', detents: ['IDLE', 'CLB', 'CON', 'TO/GA'],
      conf: [
        { name: 'UP', flap: 0, cl0: 0, clmax: 1.30, cd: 0, vfe: 999 },
        { name: '1', flap: 1, cl0: 0.10, clmax: 1.65, cd: 0.005, vfe: 280 },
        { name: '5', flap: 5, cl0: 0.25, clmax: 1.85, cd: 0.011, vfe: 260 },
        { name: '10', flap: 10, cl0: 0.38, clmax: 2.00, cd: 0.018, vfe: 240 },
        { name: '20', flap: 20, cl0: 0.50, clmax: 2.20, cd: 0.028, vfe: 230 },
        { name: '25', flap: 25, cl0: 0.62, clmax: 2.40, cd: 0.042, vfe: 205 },
        { name: '30', flap: 30, cl0: 0.72, clmax: 2.55, cd: 0.055, vfe: 180 },
      ], toConf: 3,
      blurb: 'The Jumbo: four engines that spool up slowly and a lot of mass, slow to pitch and to roll. Plan everything early.' },
    'B777-300ER': { name: 'Boeing 777-300ER', maker: 'Boeing', law: 'conventional', engine: 'jet', engines: 2, idle: 22, spool: 0.75, rev: 0.4, athr: true,
      speedBrake: true, groundSpoilers: true, gear: 'retract', toMass: 351000, landMass: 251000, S: 436.8, thrust: 513000, wheelbase: 31.2, tail: 8.5,
      vmo: 330, mmo: 0.89, vle: 270, clbKt: 310, crzM: 0.84, vr: 165, finalKt: 150, finalNm: 10, finalConf: 6,
      clBase: 0.23, clA: 0.088, cd0: 0.018, k: 0.041, mdd: 0.86, pitchRate: 2.3, roll: 9, aTau: 0.55, shaker: true, softProt: true,
      crashFpm: 1000, tipBank: 10, tyreKt: 225, gauge: 'N1 %', lawName: 'NORMAL', detents: ['IDLE', 'CLB', 'CON', 'TO/GA'],
      conf: [
        { name: 'UP', flap: 0, cl0: 0, clmax: 1.30, cd: 0, vfe: 999 },
        { name: '1', flap: 1, cl0: 0.10, clmax: 1.65, cd: 0.005, vfe: 255 },
        { name: '5', flap: 5, cl0: 0.26, clmax: 1.88, cd: 0.011, vfe: 235 },
        { name: '15', flap: 15, cl0: 0.42, clmax: 2.10, cd: 0.022, vfe: 215 },
        { name: '20', flap: 20, cl0: 0.52, clmax: 2.25, cd: 0.030, vfe: 195 },
        { name: '25', flap: 25, cl0: 0.64, clmax: 2.42, cd: 0.044, vfe: 190 },
        { name: '30', flap: 30, cl0: 0.74, clmax: 2.58, cd: 0.056, vfe: 170 },
      ], toConf: 3,
      blurb: 'The biggest twin: two GE90s. Boeing fly-by-wire that flies like a conventional aircraft: it returns to its trimmed speed; soft protections you can pull through (it won\'t trim into a stall, steep banks roll back to 30°). Tail strike past 8.5°.' },
    'GLOBAL7500': { name: 'Bombardier Global 7500', maker: 'Bombardier', law: 'airbus', engine: 'jet', engines: 2, idle: 22, spool: 1.25, rev: 0.35, athr: true, deepStall: true,
      speedBrake: true, groundSpoilers: true, gear: 'retract', toMass: 52000, landMass: 40000, S: 102, thrust: 84000, wheelbase: 15.5, tail: 12,
      vmo: 340, mmo: 0.925, vle: 250, clbKt: 300, crzM: 0.90, vr: 130, finalKt: 125, finalNm: 8, finalConf: 3,
      clBase: 0.2, clA: 0.09, cd0: 0.017, k: 0.04, mdd: 0.9, pitchRate: 4.5, roll: 20, aTau: 0.25, shaker: true,
      crashFpm: 900, tipBank: 8, tyreKt: 200, gauge: 'N1 %', lawName: 'NORMAL MODE', directName: 'DIRECT MODE', detents: ['IDLE', 'CLB', 'MCT', 'TO'],
      conf: [
        { name: '0', flap: 0, cl0: 0, clmax: 1.35, cd: 0, vfe: 999 },
        { name: '6', flap: 6, cl0: 0.25, clmax: 1.85, cd: 0.010, vfe: 230 },
        { name: '16', flap: 16, cl0: 0.42, clmax: 2.10, cd: 0.022, vfe: 210 },
        { name: '30', flap: 30, cl0: 0.68, clmax: 2.45, cd: 0.050, vfe: 175 },
      ], toConf: 2,
      blurb: 'Long-range business jet with fly-by-wire and full protections: light, lots of thrust, quick to roll, Mach 0.90. Limiter off (direct mode) its T-tail can get into a deep stall.' },
    'CONCORDE': { name: 'Concorde', maker: 'Aérospatiale/BAC', law: 'conventional', engine: 'sst', engines: 4, idle: 25, spool: 0.8, rev: 0.3, reheat: 1.2, athr: true,
      speedBrake: false, groundSpoilers: false, gear: 'retract', toMass: 185000, landMass: 105000, S: 358, thrust: 140000, wheelbase: 18.2, tail: 13.5,
      vmo: 530, mmo: 2.04, vle: 270, clbKt: 400, crzM: 2.0, vr: 195, finalKt: 165, finalNm: 10, finalConf: 0,
      clBase: 0, clA: 0.05, cd0: 0.012, k: 0.22, kMin: 0, mdd: 0.95, pitchRate: 2.5, roll: 12, aTau: 0.4, shaker: true, delta: true, shakerA: 17, hiAlpha: 20,
      crashFpm: 900, tipBank: 7, tyreKt: 250, gauge: 'N1 %', lawName: 'AFCS OFF', detents: ['IDLE', 'CLB', 'MAX DRY', 'REHEAT'],
      conf: [{ name: '—', flap: 0, cl0: 0, clmax: 1.15, cd: 0, vfe: 999 }], toConf: 0,
      blurb: 'No flaps: the delta wing lifts at a high angle, nose high and draggy on the approach. It never stalls with a break: past 20° the drag grows until it sinks like a brick. Reheat for take-off and through Mach 1, then Mach 2.' },
    'Q400': { name: 'Dash 8-400', maker: 'De Havilland Canada', law: 'conventional', engine: 'prop', engines: 2, idle: 8, rev: 0.5, athr: false,
      speedBrake: false, groundSpoilers: true, gear: 'retract', toMass: 29000, landMass: 27000, S: 63.1, power: 3780000, thrust: 55000, altExp: 0.7,
      wheelbase: 13.9, tail: 8, vmo: 286, mmo: 0.6, vle: 200, clbKt: 220, crzM: 0.6, vr: 120, finalKt: 130, finalNm: 8, finalConf: 3,
      clBase: 0.3, clA: 0.1, cd0: 0.024, k: 0.035, mdd: 0.62, pitchRate: 4, roll: 18, aTau: 0.3, shaker: true,
      crashFpm: 900, tipBank: 9, tyreKt: 170, gauge: 'TQ %', lawName: 'MANUAL', detents: ['FLT IDLE', 'CLB', 'MCL', 'MTOP'],
      conf: [
        { name: '0', flap: 0, cl0: 0, clmax: 1.45, cd: 0, vfe: 999 },
        { name: '5', flap: 5, cl0: 0.20, clmax: 1.85, cd: 0.010, vfe: 200 },
        { name: '10', flap: 10, cl0: 0.35, clmax: 2.10, cd: 0.020, vfe: 181 },
        { name: '15', flap: 15, cl0: 0.45, clmax: 2.25, cd: 0.030, vfe: 172 },
        { name: '35', flap: 35, cl0: 0.75, clmax: 2.70, cd: 0.065, vfe: 158 },
      ], toConf: 2,
      blurb: 'The fast turboprop: the propellers answer the levers at once and pull hard when slow. No autothrust: fly the speed yourself.' },
    'ATR72-600': { name: 'ATR 72-600', maker: 'ATR', law: 'conventional', engine: 'prop', engines: 2, idle: 6, rev: 0.45, athr: false,
      speedBrake: false, groundSpoilers: false, gear: 'retract', toMass: 23000, landMass: 21500, S: 61, power: 2050000, thrust: 40000, altExp: 0.7,
      wheelbase: 10.8, tail: 7.5, vmo: 250, mmo: 0.55, vle: 185, clbKt: 170, crzM: 0.5, vr: 110, finalKt: 115, finalNm: 6, finalConf: 1,
      clBase: 0.35, clA: 0.1, cd0: 0.026, k: 0.033, mdd: 0.55, pitchRate: 3.5, roll: 15, aTau: 0.3, shaker: true,
      crashFpm: 900, tipBank: 8, tyreKt: 160, gauge: 'TQ %', lawName: 'MANUAL', detents: ['FI', 'CLB', 'MCT', 'RTO'],
      conf: [
        { name: '0', flap: 0, cl0: 0, clmax: 1.50, cd: 0, vfe: 999 },
        { name: '15', flap: 15, cl0: 0.40, clmax: 2.05, cd: 0.020, vfe: 185 },
        { name: '30', flap: 30, cl0: 0.70, clmax: 2.50, cd: 0.050, vfe: 150 },
      ], toConf: 1,
      blurb: 'A slow, gentle high-wing turboprop: short take-offs, no spoilers and no autothrust; only 250 kt at most.' },
    'DC-3': { name: 'Douglas DC-3', maker: 'Douglas', law: 'classic', tailwheel: true, engine: 'piston', engines: 2, idle: 10, rev: 0, athr: false,
      speedBrake: false, groundSpoilers: false, gear: 'retract', toMass: 11400, landMass: 11000, S: 91.7, power: 895000, thrust: 13000, altExp: 0.9,
      wheelbase: 13, tail: 20, vmo: 200, mmo: 0.5, vle: 140, clbKt: 120, crzM: 0.4, vr: 80, finalKt: 90, finalNm: 5, finalConf: 1,
      clBase: 0.25, clA: 0.095, cd0: 0.03, k: 0.05, mdd: 0.5, pitchRate: 5, roll: 9, aTau: 0.4, shaker: false, dihedral: 1.5,
      crashFpm: 800, tipBank: 12, tyreKt: 120, gauge: 'PWR %', lawName: 'CABLES', detents: ['IDLE', 'CRUISE', 'METO', 'T.O.'],
      conf: [
        { name: 'UP', flap: 0, cl0: 0, clmax: 1.40, cd: 0, vfe: 999 },
        { name: '½', flap: 20, cl0: 0.30, clmax: 1.80, cd: 0.025, vfe: 110 },
        { name: 'FULL', flap: 45, cl0: 0.55, clmax: 2.10, cd: 0.070, vfe: 97 },
      ], toConf: 0,
      blurb: 'A 1936 classic: cables and pulleys, no protections, no autothrust, no reversers. Slow and forgiving until it stalls; then a wing drops.' },
    'JU52': { name: 'Junkers Ju 52/3m', maker: 'Junkers', law: 'classic', tailwheel: true, engine: 'piston', engines: 3, idle: 10, rev: 0, athr: false,
      speedBrake: false, groundSpoilers: false, gear: 'fixed', gearCd: 0, toMass: 10500, landMass: 10000, S: 110.5, power: 540000, thrust: 9000, altExp: 0.9,
      wheelbase: 10, tail: 20, vmo: 155, mmo: 0.4, vle: 999, clbKt: 90, crzM: 0.3, vr: 60, finalKt: 70, finalNm: 4, finalConf: 1,
      clBase: 0.25, clA: 0.09, cd0: 0.045, k: 0.06, mdd: 0.45, pitchRate: 4, roll: 6, aTau: 0.5, shaker: false, dihedral: 2,
      crashFpm: 800, tipBank: 14, tyreKt: 100, gauge: 'PWR %', lawName: 'CABLES', detents: ['IDLE', 'CRUISE', 'CLIMB', 'T.O.'],
      conf: [
        { name: 'UP', flap: 0, cl0: 0, clmax: 1.35, cd: 0, vfe: 999 },
        { name: 'LAND', flap: 25, cl0: 0.35, clmax: 1.75, cd: 0.040, vfe: 100 },
      ], toConf: 0,
      blurb: 'Tante Ju: three engines, a corrugated skin full of drag and fixed gear. Lifts off at 60 kt and lands on a field; sluggish to roll.' },
  };
  // Defaults for what a type leaves out.
  for (const t of Object.values(TYPES)) {
    Object.assign(t, { kMin: 0.1, gearCd: 0.02, pitchRate: 3, aTau: 0.3, dihedral: 0, gLimit: t.law === 'classic' ? 3.5 : t.engine === 'prop' ? 2.6 : 2.5, ...t });
    // protections the limiter (L) can turn off: fly-by-wire (law 'airbus'), the 777's soft ones, Concorde's high-incidence one
    t.prot = t.law === 'airbus' || !!t.softProt || !!t.hiAlpha;
    t.altExp = t.altExp ?? 0.75;
    // inertia (s): how long the roll and the pitch take to get going and to stop, from the mass (about 0.35 s for
    // the DC-3 and the Ju 52, about 1.1 s for the A350 and the 747)
    t.inertia = t.inertia ?? clamp(0.35 + 0.8 * Math.log10(t.toMass / 10000) / Math.log10(36), 0.35, 1.2);
  }
  // What start() sets from the type flown (the A350-900's until then).
  let CONF, DETENTS, VMO, MMO, VLE, CL_A, CL_BASE, CD0, K_IND, IDLE_N1;
  function useType(sp) {
    CONF = sp.conf; VMO = sp.vmo; MMO = sp.mmo; VLE = sp.vle;
    CL_A = sp.clA; CL_BASE = sp.clBase; CD0 = sp.cd0; K_IND = sp.k; IDLE_N1 = sp.idle;
    // Thrust lever detents: idle, climb, max continuous, take-off. Below 0: reverse.
    DETENTS = [0, 0.86, 0.93, 1].map((at, i) => ({ at, name: sp.detents[i] }));
  }
  useType(TYPES['A350-900']);
  const LOOK_DOWN = 4; // cockpit camera: looks this far below the nose (°)
  // airbus(): Airbus normal law with its protections. With the limiter off (L) an Airbus flies in direct law: as
  // the conventional types, it can stall, overbank and pull as hard as the stick asks.
  const isFbw = () => s.spec.law === 'airbus'; // (the Airbuses and the Global 7500: normal law with hard protections)
  const isAirbus = () => s.spec.maker === 'Airbus'; // (LVR CLB, alpha floor)
  const airbus = () => isFbw() && s.limiter;
  const lim = () => s.limiter || !s.spec.prot; // (protections on; a type without any is always "on")
  const lawName = () => (lim() ? s.spec.lawName : isFbw() ? s.spec.directName : 'PROT OFF');
  const lastConf = () => CONF.length - 1;
  const CAMS = ['chase', 'cockpit', 'wing', 'flyby'];

  const s = { active: false, keys: new Set(), cam: 'chase', msgs: [], help: false };

  function atmo(h) {
    h = Math.max(-500, h);
    const T = h < 11000 ? 288.15 - 0.0065 * h : 216.65;
    const p = h < 11000 ? 101325 * Math.pow(T / 288.15, 5.2559) : 22632 * Math.exp(-(h - 11000) / 6341.6);
    return { rho: p / (287.05 * T), a: Math.sqrt(1.4 * 287.05 * T) };
  }
  function confAt(f) {
    if (CONF.length === 1) return CONF[0];
    const i = clamp(Math.floor(f), 0, CONF.length - 2), u = clamp(f - i, 0, 1);
    const a = CONF[i], b = CONF[i + 1];
    const mix = (k) => a[k] + (b[k] - a[k]) * u;
    return { flap: mix('flap'), cl0: mix('cl0'), clmax: mix('clmax'), cd: mix('cd') };
  }
  // share of full thrust at this N1 (jets) or torque/power (propellers: nearly in line with the lever)
  const thrustFrac = (n1) => 0.04 + 0.96 * Math.pow(clamp((n1 - IDLE_N1) / (100 - IDLE_N1), 0, 1), s.spec.engine === 'jet' || s.spec.engine === 'sst' ? 1.8 : 1.1);
  // Full thrust of one engine (N) at this air density, true airspeed (m/s) and Mach.
  function engineThrust(sp, rho, V, M) {
    const r = rho / 1.225;
    if (sp.engine === 'jet') return sp.thrust * Math.pow(r, 0.75) * (1 - 0.35 * M + 0.1 * M * M);
    if (sp.engine === 'sst') return sp.thrust * Math.pow(r, 0.6) * (1 + 0.5 * M) * (s.lever > 0.98 ? sp.reheat : 1);
    // propellers: power / speed, the static thrust when standing still
    const P = sp.power * 0.8 * Math.pow(r, sp.altExp);
    const v0 = (sp.power * 0.8) / sp.thrust;
    return P / Math.sqrt(V * V + v0 * v0);
  }
  // Drag rise near and past Mach 1. Concorde: the hump through the sound barrier, little left at Mach 2.
  function waveDrag(sp, M) {
    if (sp.engine === 'sst') return M < 0.85 ? 0 : 0.018 * Math.exp(-(((M - 1.15) / 0.25) ** 2)) + 0.006 * clamp((M - 0.95) / 0.2, 0, 1);
    return M > sp.mdd ? 12 * Math.pow(M - sp.mdd, 2) : 0;
  }
  const ias = () => s.V * Math.sqrt(atmo(s.h).rho / 1.225) / KT;
  const detentName = (l) => (l < 0 ? (l < -0.9 ? 'MAX REV' : 'REV') : (DETENTS.find((d) => Math.abs(l - d.at) < 0.005) || { name: 'MAN THR' }).name);
  const agl = () => (s.h - s.groundH) / FT;
  const vsFpm = () => (s.V * Math.sin(s.gamma)) / FT * 60;
  // the lowest selectable speed for a flap setting at this weight (1.23 × the 1 g stall speed), kt
  const vls = (conf) => (1.23 * Math.sqrt((2 * s.mass * G0) / (1.225 * s.spec.S * CONF[conf].clmax))) / KT;
  // The speed the autothrust flies (kt, indicated): picked with [ ] (cyan), or managed (magenta): 250 kt below
  // 10,000 ft, then 300 kt up to M 0.85; with flaps out a speed between the flaps' lowest and highest, on the
  // approach (FULL, or 3 with the gear down) VLS + 5.
  function spdTarget() {
    const sp = s.spec;
    const top = Math.min(VMO - 10, s.conf ? CONF[s.conf].vfe - 5 : 999, s.gear > 0.05 && sp.gear !== 'fixed' ? VLE - 5 : 999);
    if (s.spdSel != null) return { kt: Math.min(s.spdSel, top + 5), sel: true };
    let kt;
    if (CONF.length === 1 && s.gearDown && sp.gear !== 'fixed') kt = sp.finalKt; // (no flaps: the approach speed with the gear down)
    else if (!s.conf) {
      const at = atmo(s.h);
      kt = s.h / FT < 10000 ? Math.min(250, sp.clbKt) : Math.min(sp.clbKt, (sp.crzM * at.a * Math.sqrt(at.rho / 1.225)) / KT);
    } else if (s.conf >= lastConf() || (s.conf === lastConf() - 1 && s.gearDown)) kt = vls(s.conf) + 5;
    else kt = vls(s.conf) + 25;
    return { kt: Math.round(Math.min(kt, top)), sel: false };
  }
  // the autothrust works with the levers in CL (or between idle and CL: then that is the most it gives), in the air
  const athrOn = () => s.athr && !s.onGround && !s.afloor && s.lever > 0.01 && s.lever < 0.87;
  function say(text, level = 'info', ms = 3500) {
    s.msgs = s.msgs.filter((m) => m.text !== text);
    s.msgs.push({ text, level, until: performance.now() + ms });
  }
  function speak(text) {
    if (!FG.sound || !FG.sound.on || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.25; u.lang = 'en-US'; u.volume = Math.min(1, (FG.sound.volume ?? 0.8) + 0.2);
      speechSynthesis.speak(u);
    } catch (e) { /* no speech */ }
  }

  // ---------- runways ----------
  const airportList = () => (s.apList || (s.apList = Object.values(G.airportByCode)));
  const designator = (hdg) => String(Math.round(wrap360(hdg) / 10) || 36).padStart(2, '0');
  // Both ends of every runway at an airport: { code, lat, lon (threshold), course, len, far: [lat, lon], name }.
  const endsCache = new Map();
  function runwayEnds(code) {
    const rws = G.airportRunways(code) || [];
    const key = `${code}:${rws.length}`;
    if (endsCache.has(key)) return endsCache.get(key);
    const out = [];
    for (const r of rws) {
      const len = G.runwayLength(r);
      if (!(len > 0)) continue;
      for (const [a, b] of [[[r[0], r[1]], [r[2], r[3]]], [[r[2], r[3]], [r[0], r[1]]]]) {
        const course = G.bearing({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });
        out.push({ code, lat: a[0], lon: a[1], far: b, course, len, width: r[4] || 45, name: designator(course) });
      }
    }
    endsCache.set(key, out);
    return out;
  }
  const offset = (lat, lon, brg, m) => [lat + (m * Math.cos(brg * DEG)) / 111320, lon + (m * Math.sin(brg * DEG)) / (111320 * Math.cos(lat * DEG))];
  // Runways near the plane, refreshed every few seconds (for the ILS and the off-runway warning).
  function nearbyEnds() {
    const now = performance.now();
    if (s.near && now - s.near.at < 3000) return s.near.ends;
    const here = { lat: s.lat, lon: s.lon };
    const ends = [];
    for (const a of airportList()) {
      if (Math.abs(a.lat - s.lat) > 0.6 || G.distanceKm(here, a) > 60) continue;
      for (const e of runwayEnds(a.code)) if (e.len > 500) ends.push(e);
    }
    s.near = { at: now, ends };
    return ends;
  }
  // The ILS the plane is lined up with: the runway end ahead within 35 km whose centre line it is nearest to.
  function ils() {
    if (s.onGround && !s.landed) return null;
    let best = null;
    for (const e of nearbyEnds()) {
      const d = G.distanceKm({ lat: s.lat, lon: s.lon }, e) * 1000;
      if (d > 35000 || d < 30) continue;
      const toThr = G.bearing({ lat: s.lat, lon: s.lon }, e);
      const loc = wrap180(toThr - e.course); // + : the plane is left of the centre line (the runway is to its right)
      if (Math.abs(loc) > 12 || Math.abs(wrap180(s.psi - e.course)) > 70) continue;
      if (!best || Math.abs(loc) < Math.abs(best.loc)) best = { e, d, loc };
    }
    if (!best) return null;
    const e = best.e;
    if (e.h == null && !e.asked && FG.flat) { e.asked = true; FG.flat.heightsAt([[e.lat, e.lon]], 12).then(([h]) => { e.h = h; }, () => { e.asked = false; }); }
    const thrH = e.h;
    const gsAngle = thrH == null ? null : Math.atan2(s.h - thrH - 15, best.d) / DEG;
    return { ...best, gs: gsAngle == null ? null : gsAngle - 3 };
  }
  function onRunway() {
    for (const e of nearbyEnds()) {
      const d = G.distanceKm(e, { lat: s.lat, lon: s.lon }) * 1000;
      if (d > e.len + 100) continue;
      const a = (G.bearing(e, { lat: s.lat, lon: s.lon }) - e.course) * DEG;
      const along = d * Math.cos(a), across = Math.abs(d * Math.sin(a));
      if (along > -80 && along < e.len + 80 && across < e.width / 2 + 12) return true;
    }
    return false;
  }

  // ---------- ground ----------
  function groundAt(lat, lon) {
    const v = FG.view3d;
    if (!v || !v.map || !v.map.queryTerrainElevation) return null;
    const h = v.map.queryTerrainElevation([lon, lat]);
    return h == null || !isFinite(h) ? null : h;
  }
  const heightsAt = (pts) => (FG.flat ? FG.flat.heightsAt(pts, 12) : Promise.resolve(pts.map(() => null)));

  // ---------- start ----------
  // opts: { type, mode: 'runway' | 'final' | 'takeover', end (a runwayEnds() entry), plane (takeover) }
  function start(opts) {
    const v = FG.view3d;
    if (!v) { toast('The 3D view is not available here.'); return; }
    const type = TYPES[opts.type] ? opts.type : 'A350-900';
    const sp = TYPES[type];
    useType(sp);
    if (opts !== s.startOpts) s.ck = null; // (a checkpoint belongs to its flight: kept when it starts again)
    const n1At = (v) => Array(sp.engines).fill(v);
    Object.assign(s, {
      active: true, loading: true, startOpts: opts, type, spec: sp, startAt: performance.now(),
      lat: 0, lon: 0, h: 0, groundH: 0, V: 0, gamma: 0, psi: 0, theta: 0, phi: 0, alpha: 0,
      load: 0, onGround: true, landed: false, n1: n1At(IDLE_N1), lever: 0, rev: 0, gearDown: true, gear: 1,
      conf: sp.toConf, flapPos: sp.toConf, sb: 0, gs: 0, armed: sp.groundSpoilers, brake: 0, parking: false, afloor: false,
      stick: 0, roll: 0, rud: 0, crashed: null, touch: null, tail: false, paused: false, calls: {}, near: null,
      hideId: opts.plane ? opts.plane.id : null, mass: sp.toMass, prevAgl: null, ghReal: null, ghAt: 0,
      gref: null, aCmd: null, qCmd: 0, aTrim: null, deep: false, limiter: s.limiterPref !== false, p: 0, stalled: false, stallAmt: 0, buffet: 0, drop: 0, athr: sp.athr, spdSel: null, athrN1: null, iasPrev: null, iasAcc: 0, menu: false, lvrClb: false, sway: { p: 0, pv: 0, r: 0, rv: 0 }, vPrev: null,
    });
    s.msgs = [];
    const e = opts.end;
    let pts;
    if (opts.mode === 'takeover' && opts.state) {
      const st = opts.state;
      s.mode = 'air';
      s.lat = st.lat; s.lon = st.lon; s.psi = st.heading; s.h = st.altFt * FT;
      s.V = Math.max(75, st.speedKmh / 3.6); s.onGround = false; s.mass = (s.spec.toMass + s.spec.landMass) / 2;
      const a = (st.altFt || 0) - (st.fieldFt || 0);
      const ph = st.phase;
      s.conf = ph === 'approach' ? (a < 2000 ? sp.finalConf : Math.min(sp.toConf, sp.finalConf)) : ph === 'climb' && a < 3000 ? sp.toConf : 0;
      s.flapPos = s.conf;
      s.gearDown = sp.gear === 'fixed' || (ph === 'approach' && a < 2500); s.gear = s.gearDown ? 1 : 0;
      s.lever = 0.86; // (CL: the autothrust holds the speed)
      s.gamma = ph === 'climb' ? 4 * DEG : ph === 'cruise' ? 0 : -3 * DEG;
      s.n1 = n1At(ph === 'climb' ? 86 : ph === 'cruise' ? 70 : 45);
      s.groundH = (st.fieldFt || 0) * FT;
      pts = [[s.lat, s.lon]];
    } else if (opts.mode === 'final') {
      s.mode = 'final';
      const [lat, lon] = offset(e.lat, e.lon, e.course + 180, sp.finalNm * 1852); // on the centre line
      const fixed = sp.gear === 'fixed';
      Object.assign(s, { lat, lon, psi: e.course, V: (sp.finalKt + 15) * KT, onGround: false, conf: sp.finalConf, flapPos: sp.finalConf,
        gearDown: fixed, gear: fixed ? 1 : 0, lever: 0.86, gamma: -3 * DEG, mass: s.spec.landMass });
      s.n1 = n1At(sp.engine === 'jet' || sp.engine === 'sst' ? 60 : 45);
      pts = [[e.lat, e.lon], [lat, lon]];
    } else {
      s.mode = 'runway';
      const [lat, lon] = offset(e.lat, e.lon, e.course, 60);
      Object.assign(s, { lat, lon, psi: e.course });
      pts = [[lat, lon]];
    }
    s.alpha = s.onGround ? 0 : 3;
    s.theta = s.alpha + s.gamma / DEG;
    s.gref = s.onGround ? null : s.gamma; // (in the air: fly on along the path it has)
    s.trimStart = !s.onGround;
    // heights where it starts (the 3D map's own tiles may not be there yet)
    heightsAt(pts).then((h) => {
      if (!s.active || s.startOpts !== opts) return;
      if (s.mode === 'final') {
        const thr = h[0] ?? 0;
        e.h = thr;
        s.h = thr + 15 + Math.tan(3 * DEG) * sp.finalNm * 1852;
        s.groundH = h[1] ?? thr;
      } else if (s.mode === 'runway') {
        s.h = s.groundH = h[0] ?? 0;
      } else if (h[0] != null) s.groundH = h[0];
      s.loading = false;
      s.last = null;
    }, () => { s.loading = false; });
    if (s.mode === 'air') s.loading = false;
    bindKeys(true);
    showHud(true);
    const go = () => { v.pilotCam(s.cam = 'chase'); };
    if (!v.on) v.setOn(true);
    go();
    const flapsTxt = CONF.length > 1 ? `Flaps ${CONF[sp.toConf].name}. ` : '';
    say(s.mode === 'runway' ? `${sp.name}, lined up on runway ${e.name} at ${e.code}. ${flapsTxt}Throttle up (4 = ${DETENTS[3].name}), pull ↓ at ${sp.vr} kt.`
      : s.mode === 'final' ? `${sp.finalNm} NM final for runway ${e.code} ${e.name}, ${sp.name}. ${sp.gear === 'fixed' ? '' : 'Gear (G), '}${CONF.length > 1 ? 'flaps (F), ' : ''}about ${sp.finalKt} kt, follow the ILS.` : 'You have control.', 'info', 7000);
    if (s.mode === 'air') speak('You have control');
  }
  function stop() {
    if (!s.active) return;
    showMenu(false);
    s.active = false;
    bindKeys(false);
    showHud(false);
    if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) { /* */ }
    if (FG.view3d) FG.view3d.pilotCam(null);
  }
  function restart() { showMenu(false); if (s.startOpts) start(s.startOpts); }

  // ---------- checkpoints ----------
  // Z keeps the flight as it is now; Backspace puts it back there (paused, P to go on), as often as it takes.
  const CK = ['lat', 'lon', 'h', 'groundH', 'V', 'gamma', 'psi', 'theta', 'phi', 'alpha', 'onGround', 'landed', 'n1', 'lever',
    'rev', 'revOk', 'gearDown', 'gear', 'conf', 'flapPos', 'sb', 'gs', 'armed', 'brake', 'parking', 'afloor', 'tail', 'mass',
    'gref', 'aCmd', 'qCmd', 'aTrim', 'deep', 'limiter', 'p', 'trimStart', 'stalled', 'stallAmt', 'buffet', 'drop', 'athr', 'spdSel', 'athrN1', 'iasPrev', 'iasAcc', 'lvrClb', 'sway', 'vPrev', 'ghReal', 'calls', 'prevAgl'];
  function saveCheckpoint() {
    if (s.loading || s.crashed) { say('No checkpoint while crashed', 'amber', 2000); return; }
    const st = {};
    for (const k of CK) st[k] = s[k];
    s.ck = { state: structuredClone(st), at: performance.now(), where: s.onGround ? 'on the ground' : `${Math.round(s.h / FT / 10) * 10} ft, ${Math.round(ias())} kt` };
    say(`⚑ Checkpoint saved (${s.ck.where}) · Backspace: back here`, 'info', 3000);
  }
  function toCheckpoint() {
    showMenu(false);
    if (!s.ck) { restart(); say('No checkpoint yet (Z saves one): started again', 'amber', 3000); return; }
    Object.assign(s, structuredClone(s.ck.state));
    Object.assign(s, { crashed: null, touch: null, stick: 0, roll: 0, rud: 0, paused: true, help: false });
    s.keys.clear(); s.msgs = []; lastV = null; s.trend = null;
    s.limiterPref = s.limiter; limiterButton();
    say(`⚑ Back at the checkpoint (${s.ck.where}) · P to go`, 'info', 4000);
  }
  const toast = (t) => (FG.ui && FG.ui.toast ? FG.ui.toast(t) : alert(t));

  // ---------- keys ----------
  const held = (...k) => k.some((x) => s.keys.has(x));
  const held_ = held;
  function onKey(e) {
    if (!s.active) return;
    if (e.target.matches && e.target.matches('input, select, textarea')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const down = e.type === 'keydown';
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // the sound key, the F keys (bug report, dev tools) and Tab stay the browser's and the game's
    if (k === 'm' || /^F\d+$/.test(k) || k === 'Tab') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!down) { s.keys.delete(k); s.keys.delete(e.code); return; }
    s.keys.add(k); s.keys.add(e.code);
    if (e.repeat) return;
    // the Esc menu: resume, start again or leave (nothing else while it is open)
    if (s.menu) {
      s.keys.clear();
      if (k === 'Escape') showMenu(false);
      else if (k === 'Enter' || k === 'r') restart();
      else if (k === 'q' || k === 'l') stop();
      else if (k === 'z') { saveCheckpoint(); showMenu(false); }
      else if (k === 'Backspace') toCheckpoint();
      return;
    }
    switch (k) {
      case 'Escape': showMenu(true); break;
      case 'Enter': if (s.crashed) restart(); break;
      case 'z': saveCheckpoint(); break;
      case 'Backspace': toCheckpoint(); break;
      case 'p': s.paused = !s.paused; say(s.paused ? 'Paused (P)' : 'Resumed', 'info', 1500); break;
      case 'h': s.help = !s.help; break;
      case 'l': toggleLimiter(); break;
      case 'g':
        if (s.spec.gear === 'fixed') { say(`The ${s.spec.name}'s gear is fixed: always down`, 'info', 2000); break; }
        if (s.onGround && !s.gearDown) break;
        if (s.onGround) { say('The gear cannot come up on the ground', 'amber'); break; }
        s.gearDown = !s.gearDown; break;
      case 'f':
        if (CONF.length === 1) { say('No flaps: the delta wing lands at a high angle of attack instead', 'info', 2500); break; }
        s.conf = clamp(s.conf + (e.shiftKey ? -1 : 1), 0, CONF.length - 1); break;
      case 'x':
        if (e.shiftKey) {
          if (!s.spec.groundSpoilers) { say(`The ${s.spec.name} has no ground spoilers`, 'info', 2000); break; }
          s.armed = !s.armed; say(s.armed ? 'Ground spoilers armed' : 'Ground spoilers disarmed', 'info', 1500);
        } else if (!s.spec.speedBrake) say(`The ${s.spec.name} has no speed brakes: thrust back and fly the path`, 'info', 2500);
        else s.sb = s.sb >= 1 ? 0 : s.sb + 0.5;
        break;
      case 'r':
        if (!s.spec.rev) { say(`The ${s.spec.name} has no reversers: brakes only`, 'amber', 2500); break; }
        if (!s.onGround) { say('Reversers only on the ground', 'amber'); break; }
        s.lever = s.lever < 0 ? 0 : -1; break;
      case '1': s.lever = 0; s.afloor = false; break;
      case '2': s.lever = 0.86; s.afloor = false; break;
      case '3': s.lever = 0.93; s.afloor = false; break;
      case '4': s.lever = 1; s.afloor = false; break;
      case 'c': FG.view3d.pilotCam(s.cam = CAMS[(CAMS.indexOf(s.cam) + 1) % CAMS.length]); break;
      case 'v': FG.view3d.pilotCam(s.cam = 'chase'); break;
      case 'n': FG.view3d.pilotCam(s.cam === 'wing' ? 'wing2' : 'wing'); s.cam = 'wing'; break;
      case 'k': s.parking = !s.parking; break;
      case 't':
        if (!s.spec.athr) { say(`The ${s.spec.name} has no autothrust: set the power yourself`, 'info', 2500); break; }
        s.athr = !s.athr; s.athrN1 = null;
        say(s.athr ? 'A/THR on: levers in CL, it holds the speed' : 'A/THR off: the levers set the thrust', s.athr ? 'info' : 'amber', 2500);
        break;
      case '[': case ']': {
        const now = Math.round(spdTarget().kt);
        s.spdSel = clamp(Math.round((now + (k === ']' ? 5 : -5)) / 5) * 5, Math.min(120, s.spec.vr), VMO - 10);
        break;
      }
      case '\\': s.spdSel = null; say('Managed speed', 'info', 1500); break;
      default:
    }
  }
  // The limiter (L, or the 🛡 button): the protections and limits on or off. Off, an Airbus is in direct law (no
  // alpha protection, no alpha floor, no bank limit: it stalls like any other) and no type has a g limit.
  function toggleLimiter() {
    if (!s.spec.prot) { say(`The ${s.spec.name} has no protections to turn off: it can stall and be overstressed as it is`, 'info', 3000); return; }
    s.limiter = s.limiterPref = !s.limiter;
    s.aCmd = null; s.aTrim = null; s.gref = null; s.trimStart = false; s.afloor = false; // (the new law starts from where the aircraft is)
    say(s.limiter ? `Limiter on: ${s.spec.lawName}`
      : isFbw() ? `Limiter off: ${s.spec.directName}. No protections: it can stall and be overstressed`
        : s.spec.hiAlpha ? 'Limiter off: no high-incidence protection' : 'Limiter off: no stall or bank protection', s.limiter ? 'info' : 'amber', 3500);
    limiterButton();
  }
  function limiterButton() {
    const b = hud && hud.querySelector('[data-pl="limiter"]');
    if (!b || !s.spec) return;
    b.textContent = !s.spec.prot ? '— No limiter' : s.limiter ? '🛡 Limiter on' : '⚠ Limiter off';
    b.classList.toggle('off', !lim());
  }
  function bindKeys(on) {
    s.keys.clear();
    for (const t of ['keydown', 'keyup']) {
      if (on) window.addEventListener(t, onKey, true); else window.removeEventListener(t, onKey, true);
    }
    if (on) window.addEventListener('blur', clearKeys); else window.removeEventListener('blur', clearKeys);
  }
  const clearKeys = () => s.keys.clear();
  function inputs(dt) {
    const ease = (cur, to, tau) => cur + (to - cur) * (1 - Math.exp(-dt / tau));
    const pitch = (held('ArrowDown', 's') ? 1 : 0) - (held('ArrowUp', 'w') ? 1 : 0); // ↓ pulls the nose up (a stick)
    const roll = (held('ArrowRight', 'd') ? 1 : 0) - (held('ArrowLeft', 'a') ? 1 : 0);
    const rud = (held('e') ? 1 : 0) - (held('q') ? 1 : 0);
    s.stick = ease(s.stick, pitch, 0.35);
    s.roll = ease(s.roll, roll, 0.25);
    s.rud = ease(s.rud, rud, 0.3);
    const thr = (held('PageUp', '+', '=', 'NumpadAdd') ? 1 : 0) - (held('PageDown', '-', 'NumpadSubtract') ? 1 : 0);
    if (thr) {
      s.afloor = false;
      // into reverse only on the ground, and only from idle on a fresh press (it stops at idle first)
      const min = s.onGround && s.spec.rev && (s.lever < 0 || s.revOk) ? -1 : 0;
      s.lever = clamp(s.lever + thr * 0.45 * dt, min, 1);
      if (thr > 0 || s.lever > 0) s.revOk = false;
    } else s.revOk = s.lever <= 0 && s.onGround;
    s.brake = ease(s.brake, held(' ', 'b', '.') || s.parking ? 1 : 0, 0.3);
  }

  // ---------- physics ----------
  function physics(dt) {
    const sp = s.spec, m = s.mass, W = m * G0;
    const at = atmo(s.h);
    const V = Math.max(0, s.V);
    const q = 0.5 * at.rho * V * V;
    const M = V / at.a;
    s.flapPos += clamp(s.conf - s.flapPos, -dt / 7, dt / 7); // about 7 s a notch
    const c = confAt(s.flapPos);
    if (sp.gear === 'fixed') { s.gearDown = true; s.gear = 1; }
    s.gear += clamp((s.gearDown ? 1 : 0) - s.gear, -dt / 10, dt / 10);
    // engines: jets spool up slowly from idle, faster once turning; propellers answer at once. Reverse once the
    // sleeves are open (or the blades past fine pitch)
    const props = sp.engine === 'prop' || sp.engine === 'piston';
    s.rev += clamp((s.lever < 0 && s.onGround && sp.rev ? 1 : 0) - s.rev, -dt / 2.5, dt / (props ? 1 : 2));
    let target = s.lever < 0 ? (s.rev > 0.95 ? IDLE_N1 + (75 - IDLE_N1) * -s.lever : IDLE_N1) : IDLE_N1 + (100 - IDLE_N1) * s.lever;
    // autothrust: N1 asked for from the speed error and how fast the speed changes
    const spdNow = V * Math.sqrt(at.rho / 1.225) / KT;
    if (s.iasPrev != null && dt > 0) s.iasAcc += ((spdNow - s.iasPrev) / dt - s.iasAcc) * (1 - Math.exp(-dt / 0.6));
    s.iasPrev = spdNow;
    if (athrOn()) {
      const most = IDLE_N1 + (100 - IDLE_N1) * s.lever;
      if (s.athrN1 == null) s.athrN1 = clamp(s.n1.reduce((x, y) => x + y, 0) / s.n1.length, IDLE_N1, most);
      const want = clamp((spdTarget().kt - spdNow) * 0.25, -1.5, 1.5); // kt/s
      s.athrN1 = clamp(s.athrN1 + clamp((want - s.iasAcc) * 5, -6, 6) * dt, IDLE_N1, most);
      target = s.athrN1;
    } else s.athrN1 = null;
    if (s.afloor) target = 100;
    let fr = 0;
    for (let i = 0; i < s.n1.length; i++) {
      const n = s.n1[i];
      const diff = target - n;
      if (props) s.n1[i] = clamp(n + clamp(diff * 2.5, -35, 30) * dt, IDLE_N1 - 1, 101);
      else {
        const up = (n < 45 ? 3 + (n - IDLE_N1) * 0.35 : 12) * sp.spool;
        s.n1[i] = clamp(n + clamp(diff * (diff > 0 ? 0.9 : 1.2) * sp.spool, -15 * sp.spool, up) * dt, IDLE_N1 - 1, 101);
      }
      fr += thrustFrac(s.n1[i]);
    }
    let T = engineThrust(sp, at.rho, V, M) * fr;
    T *= 1 - (1 + sp.rev) * s.rev; // (reversed: part of it backwards)
    // ground spoilers: up on the ground with the thrust levers at idle (armed, or in reverse) after touchdown, and
    // for a rejected take-off above 72 kt
    const gsUp = sp.groundSpoilers && s.onGround && s.lever <= 0.02 && (s.armed || s.lever < 0) && (s.landed ? V > 40 * KT : V > 72 * KT);
    s.gs += clamp((gsUp ? 1 : 0) - s.gs, -dt, dt * 2);
    const spoil = Math.max(s.gs, s.sb * (s.onGround ? 1 : 0.5));
    // aerodynamics
    const clBase = CL_BASE + c.cl0;
    // (a delta wing has no sharp stall: the vortices over it go on lifting, less and less, up to about 35°)
    const aStall = sp.delta ? 35 : (c.clmax - clBase) / CL_A;
    s.aProt = sp.delta ? sp.shakerA : aStall - 2;
    // stalled, the flow breaks away from the wing: about a third of the lift goes within half a second, and it stays
    // gone until the angle of attack is well back below the stall (stallAmt, set by conventionalLaw)
    s.stallAmt += ((s.stalled ? 1 : 0) - s.stallAmt) * (1 - Math.exp(-dt / 0.4));
    let CL;
    if (sp.delta) {
      const aK = (c.clmax - clBase) / CL_A; // (the lift slope halves past here: about 23°)
      CL = clBase + CL_A * Math.min(s.alpha, aK) + 0.5 * CL_A * clamp(s.alpha - aK, 0, aStall - aK) - 0.04 * Math.max(0, s.alpha - aStall);
    } else {
      CL = Math.min(clBase + CL_A * s.alpha, c.clmax);
      if (s.alpha > aStall) CL -= 0.04 * (s.alpha - aStall);
    }
    CL *= 1 - 0.35 * s.stallAmt;
    // (far past the stall it still lifts as a flat plate does: most at 45°)
    if (!sp.delta && s.alpha > aStall) CL = Math.max(CL, 0.9 * Math.sin(2 * s.alpha * DEG));
    CL -= 0.45 * spoil;
    const CD = CD0 + c.cd + sp.gearCd * s.gear + 0.05 * spoil + K_IND * Math.pow(CL - sp.kMin, 2) + waveDrag(sp, M) + 0.2 * s.stallAmt
      // (past the stall the wing is more and more a flat plate across the air: a huge air brake at 30-40°)
      + (sp.delta ? 0 : 1.8 * Math.max(0, Math.sin(s.alpha * DEG) ** 2 - Math.sin(aStall * DEG) ** 2));
    // buffet: the airframe shakes as the flow starts to break away, hard once stalled (looks only: pose())
    s.buffet = s.onGround || airbus() ? 0 : clamp(Math.max((s.alpha - (sp.delta ? s.aProt : aStall - 1.5)) / (sp.delta ? 10 : 3), s.stallAmt), 0, 1);
    const L = q * sp.S * CL, D = q * sp.S * CD;
    s.load = L / W;
    s.aStall = aStall;
    let psiRate = 0; // °/s
    if (!s.onGround) {
      const Vs = Math.max(30, V);
      const cg = Math.cos(s.gamma), cphi = Math.cos(s.phi * DEG);
      const cphiL = Math.max(0.5, cphi);
      const Ty = T * Math.sin(s.alpha * DEG);
      const alphaFor = (nz) => ((nz * W - Ty) / Math.max(1, q * sp.S) + 0.45 * spoil - clBase) / CL_A;
      if (airbus()) airbusLaw(dt, alphaFor, cg, cphiL, M);
      else conventionalLaw(dt, alphaFor, q, aStall);
      s.V += ((T * Math.cos(s.alpha * DEG) - D) / m - G0 * Math.sin(s.gamma)) * dt;
      s.gamma += (((L + Ty) * cphi) / (m * Vs) - (G0 * cg) / Vs) * dt;
      s.gamma = clamp(s.gamma, -80 * DEG, 80 * DEG);
      psiRate = (((L + Ty) * Math.sin(s.phi * DEG)) / (m * Vs * Math.max(0.2, cg))) / DEG + s.rud * 1.5;
      rollLaw(dt);
      // the nose is alpha above the path in the aircraft's own up direction: banked, part of it is sideways
      s.theta = s.gamma / DEG + s.alpha * Math.cos(s.phi * DEG);
      // the airframe: past 1.5 × its limit load the wings fail; far past its dive speed (VD, about VMO + 50 kt /
      // MMO + 0.07) flutter breaks it up
      if (s.load > sp.gLimit * 1.5 || s.load < -1.5) { breakUp(`Overstressed at ${s.load.toFixed(1)} g: the wings failed`); return; }
      if (ias() > VMO + 90 || M > MMO + 0.12) { breakUp(`Far past its dive speed (${Math.round(ias())} kt, M ${M.toFixed(2)}): flutter broke it up`); return; }
      // alpha floor: TOGA by itself near the stall (away from the ground)
      if (airbus() && isAirbus() && !s.afloor && s.alpha > s.aProt - 0.3 && agl() > 100) { s.afloor = true; say('A.FLOOR — TOGA', 'amber', 4000); }
    } else {
      s.gamma = 0;
      s.gref = null; s.aCmd = null; s.aTrim = null; s.gPrev = null; s.vLaw = null; s.stalled = false; s.deep = false; s.p = 0;
      s.phi *= Math.exp(-dt / 0.3);
      // rotation: the elevator lifts the nose once there is speed; let go, the nose wheel comes back down
      const vRot = sp.vr * KT;
      const auth = clamp(q / (0.5 * 1.225 * vRot * vRot * 0.9), 0, 1);
      const liftFrac = clamp(L / W, 0, 1);
      let rate = s.stick > 0 ? s.stick * 3.5 * auth : s.stick * 2 * auth;
      rate -= (1 + 2 * (1 - liftFrac)) * (1 - clamp(s.stick, 0, 1));
      s.theta = clamp(s.theta + rate * dt, 0, sp.tail + 4);
      s.qCmd = s.theta > 0 && s.theta < sp.tail + 4 ? rate : 0; // (still rotating as it lifts off: the nose goes on coming up)
      s.alpha = s.theta;
      if (s.theta > sp.tail && !s.tail) { s.tail = true; say('TAIL STRIKE', 'red', 5000); speak('tail strike'); }
      if (s.theta < sp.tail - 2) s.tail = false;
      const N = Math.max(0, W - L);
      const fric = (0.015 + 0.4 * s.brake) * N;
      let a = (T - D) / m;
      if (V > 0.05) a -= fric / m;
      else if (Math.abs(T - D) < fric) a = 0;
      s.V = Math.max(0, V + a * dt);
      // nose wheel steering: up to 60° when slow, a few degrees at speed (the rudder pedals)
      const steerIn = Math.abs(s.rud) > Math.abs(s.roll) ? s.rud : s.roll;
      const most = 60 + (6 - 60) * clamp((V - 5) / 30, 0, 1);
      psiRate = ((s.V / sp.wheelbase) * Math.tan(steerIn * most * DEG)) / DEG;
      if (L > W && s.V > vRot * 0.7) {
        s.onGround = false; s.landed = false; s.gamma = 0.002; s.liftAt = performance.now();
      }
    }
    s.psi = wrap360(s.psi + psiRate * dt);
    sway(dt, psiRate);
    s.h += s.V * Math.sin(s.gamma) * dt;
    const run = s.V * Math.cos(s.gamma) * dt;
    s.lat += (run * Math.cos(s.psi * DEG)) / R_E / DEG;
    s.lon += (run * Math.sin(s.psi * DEG)) / (R_E * Math.cos(s.lat * DEG)) / DEG;
    if (!s.onGround && s.h <= s.groundH) touchdown();
    if (s.onGround) s.h = s.groundH;
  }

  // Conventional controls (the Boeings, Concorde, turboprops, the classics, and any fly-by-wire type with the limiter
  // off: direct law). As a real aircraft: the stick moves the elevator, which changes the angle of attack at the
  // type's own pace (heavier at low speed, quicker at high); let go, it springs back to where the aircraft is
  // trimmed (aTrim). Hold the stick and the trim follows, as a pilot trims the force away (a few seconds), so a
  // tap doesn't retrim but a held pull does. Trimmed for an angle of attack, the aircraft is speed stable: it
  // returns to its trimmed speed by itself, in the slow, lightly damped up-and-down swing (the phugoid) every
  // aircraft has; more thrust makes it climb, less makes it sink.
  // No g limit (the 777 and the classics have none either): past 1.5 × the limit load the wings fail (physics()).
  // Stalling: past the critical angle of attack the lift breaks away, the nose drops by itself (fully back it only
  // just stays stalled, sinking fast), a wing drops (hard on the classics) and the ailerons hardly answer; it stays
  // stalled until the angle is 2° back below the stall. Trimmed into the stall, it stays there hands off.
  // A T-tail (Global 7500) past the stall can sink into a deep stall: the wing's wake blankets the tail, the elevator
  // hardly answers and the nose doesn't drop by itself; only the stick held full forward gets it out, slowly.
  // Delta (Concorde): no break, the drag grows until it sinks (physics()); its high-incidence protection
  // (limiter) holds it under 20°. 777 soft protections (limiter): it won't trim past the stick shaker, and lets the
  // nose down by itself there unless the stick is held back; it won't trim faster than VMO.
  function conventionalLaw(dt, alphaFor, q, aStall) {
    const sp = s.spec;
    // (started in the air: trimmed for 1 g along the path it has; just lifted off: where the rotation left it)
    if (s.aCmd == null) s.aCmd = s.trimStart ? (s.alpha = clamp(alphaFor(Math.cos(s.gamma)), -4, aStall - 2)) : s.alpha;
    if (s.aTrim == null) s.aTrim = s.aCmd;
    s.trimStart = false;
    const auth = clamp(q / (0.5 * 1.225 * (sp.vr * KT * 1.3) ** 2), 0.3, 1.4) * (s.deep ? 0.2 : 1);
    // the elevator starts and stops the nose at the aircraft's own pace (its inertia)
    s.qCmd += (s.stick * sp.pitchRate * auth - s.qCmd) * (1 - Math.exp(-dt / (sp.inertia * 0.6)));
    s.aCmd += s.qCmd * dt;
    const held = Math.abs(s.stick) > 0.05;
    if (held) s.aTrim += (s.aCmd - s.aTrim) * (1 - Math.exp(-dt / 2)); // (trimming the force away)
    else s.aCmd += (s.aTrim - s.aCmd) * (1 - Math.exp(-dt / 1.2)); // (the stick springs back to the trim)
    // the trim switches (Home / End, U / J): the trim itself, 1° of angle of attack a second; the nose follows
    const trimIn = (held_('End', 'j') ? 1 : 0) - (held_('Home', 'u') ? 1 : 0);
    if (trimIn) { s.aTrim += trimIn * dt; if (!held) s.aCmd += trimIn * dt; }
    const prot = lim();
    if (prot && sp.softProt) {
      s.aTrim = Math.min(s.aTrim, s.aProt - 0.5, alphaFor(1) + 4);
      if (ias() > VMO) s.aTrim += Math.min(1, (ias() - VMO) * 0.1) * dt; // (overspeed: it pitches up to slow down)
    }
    let aMax = aStall + 25;
    if (prot && sp.hiAlpha) aMax = sp.hiAlpha;
    const aMin = Math.max(-12, alphaFor(-2.5));
    if (s.aCmd > aMax || s.aCmd < aMin) s.qCmd = 0;
    s.aCmd = clamp(s.aCmd, aMin, aMax);
    s.aTrim = clamp(s.aTrim, aMin, aMax);
    const stalled = sp.delta ? s.alpha > aStall : s.stalled ? s.alpha > aStall - 2 : s.alpha > aStall;
    if (stalled && !s.stalled) { s.drop = (Math.random() < 0.5 ? -1 : 1) * (sp.law === 'classic' ? 14 : 6); speak('stall'); }
    s.stalled = stalled;
    // deep stall: well past the stall on a T-tail it locks in about 22° past it (35-40°), nose near level, sinking fast
    if (sp.deepStall && stalled && s.alpha > aStall + 5) s.deep = true;
    if (s.deep && s.alpha < aStall) s.deep = false;
    if (s.deep) s.aCmd += clamp(aStall + 22 - s.aCmd, -0.4, 0.4) * dt;
    else if (stalled) s.aCmd -= (4 + 4 * (1 - clamp(s.stick, 0, 1))) * dt;
    // The tail and the wing's response to speed changes damp the phugoid as on a real aircraft (a jet's swing loses about
    // a quarter of its size each cycle, a propeller aircraft's more): a little less angle of attack while the path
    // rises, a little more while it speeds up.
    const gdot = s.gPrev == null ? 0 : (s.gamma - s.gPrev) / DEG / Math.max(1e-3, dt);
    const vdot = s.vLaw == null ? 0 : (s.V - s.vLaw) / Math.max(1e-3, dt);
    s.gPrev = s.gamma; s.vLaw = s.V;
    s.alpha += (s.aCmd - 0.8 * clamp(gdot, -3, 3) + 0.1 * clamp(vdot, -5, 5) - s.alpha) * (1 - Math.exp(-dt / sp.aTau));
  }

  // Airbus normal law. The stick moves the flight path the aircraft is asked to fly (gref), up to 3°/s at full; the
  // angle of attack asked for is the one for 1 g along the path plus what it takes to bend the path onto gref
  // at the wing's own pace. So the nose turns smoothly at the stick's rate and the path follows a moment later,
  // without the nose jumping as the stick is pressed or let go (it used to snap up or down a few degrees and
  // come back). Let go, gref stays: the path is held. Pitch 30° up, 15° down at most.
  function airbusLaw(dt, alphaFor, cg, cphiL, M) {
    const aHold = alphaFor(cg / cphiL);
    if (s.gref == null) s.gref = s.gamma + (s.alpha - aHold) * cphiL * DEG;
    s.qCmd += (s.stick * 3 - s.qCmd) * (1 - Math.exp(-dt / (s.spec.inertia * 0.5)));
    let rate = s.qCmd; // °/s
    if (s.theta > 25 && rate > 0) rate *= clamp((30 - s.theta) / 5, 0, 1);
    if (s.theta < -10 && rate < 0) rate *= clamp((s.theta + 15) / 5, 0, 1);
    // high speed protection: the nose comes up by itself above VMO / MMO
    const over = Math.max(ias() - VMO - 6, (M - MMO - 0.01) * 600);
    if (over > 0 && s.stick <= 0) rate += Math.min(2, over * 0.15);
    s.gref += rate * DEG * dt;
    const flaps = s.flapPos > 0.5;
    const aMin = Math.max(-6, alphaFor(flaps ? 0 : -1)), aMax = Math.min(s.aProt, alphaFor(flaps ? 2 : 2.5));
    // (the path asked for can't run away from the one flown while the angle of attack is at a limit)
    s.gref = clamp(s.gref, s.gamma + (aMin - aHold) * cphiL * DEG, s.gamma + (aMax - aHold) * cphiL * DEG);
    const aCmd = clamp(aHold + (s.gref - s.gamma) / DEG / cphiL, aMin, aMax);
    s.alpha += (aCmd - s.alpha) * (1 - Math.exp(-dt / (0.2 + 0.25 * s.spec.inertia)));
  }

  // Roll. Airbus: the stick asks for a roll rate, let go the bank stays (up to 33°, beyond that it comes back to
  // 33°); 67° at most. Conventional: the bank stays where it is left, up to 75°. Classics: the dihedral levels
  // the wings by themselves. Each type rolls at its own rate (°/s at full).
  function rollLaw(dt) {
    const sp = s.spec;
    let rate = sp.roll * (airbus() ? 1 : clamp(s.V / (sp.vr * KT * 1.2), 0.4, 1.2));
    if (s.stalled) rate *= 0.35; // (stalled: the ailerons hardly answer)
    // the roll rate wanted; the aircraft gets into it and out of it at its own pace (s.p, its inertia)
    let want = 0;
    if (Math.abs(s.roll) > 0.02) want = s.roll * rate;
    else if (airbus() && Math.abs(s.phi) > 33) want = -Math.sign(s.phi) * Math.min(5, (Math.abs(s.phi) - 33) * 2);
    else if (s.spec.softProt && lim() && Math.abs(s.phi) > 35) want = -Math.sign(s.phi) * Math.min(3, (Math.abs(s.phi) - 30) * 0.6); // (777: back to 30°)
    else if (sp.dihedral && !s.stalled) want = -Math.sign(s.phi) * Math.min(sp.dihedral, Math.abs(s.phi) * 0.5);
    // (stalled, a wing drops: a sudden roll that runs out at 25°, 45° on the classics, unless the stall goes on deeper)
    if (s.stalled) want += s.drop * clamp(1 - (s.phi * Math.sign(s.drop)) / (s.spec.law === 'classic' ? 45 : 25), 0, 1);
    want += s.rud * 2;
    const tau = sp.inertia * (airbus() ? 0.4 : 0.6);
    s.p += (want - s.p) * (1 - Math.exp(-dt / tau));
    s.phi += s.p * dt;
    const most = airbus() ? 67 : 75;
    if (Math.abs(s.phi) > most) { s.phi = Math.sign(s.phi) * most; s.p = 0; }
  }

  // On its legs the aircraft sways on the shock absorbers (drawn only: the physics keep the wheels on the runway):
  // braking (or reversing) it tips forward and the nose leg is pushed in (view3d oleo()), accelerating it sits back, turning it leans to the
  // outside; damped springs, so it rocks back once it stops or the brakes come off. Degrees.
  function sway(dt, psiRate) {
    const w = s.sway;
    const acc = s.vPrev == null || dt <= 0 ? 0 : (s.V - s.vPrev) / dt;
    s.vPrev = s.V;
    w.acc = (w.acc || 0) + (acc - (w.acc || 0)) * (1 - Math.exp(-dt / 0.15));
    const lat = s.V * psiRate * DEG; // m/s² towards the inside of the turn
    const pT = s.onGround ? clamp(w.acc * 0.2, -0.8, 0.5) : 0; // (nose up while it speeds up)
    const rT = s.onGround ? clamp(-lat * 0.3, -1, 1) : 0;
    const k = (2 * Math.PI * 0.7) ** 2, c = 2 * 0.3 * 2 * Math.PI * 0.7;
    w.pv += (k * (pT - w.p) - c * w.pv) * dt; w.p += w.pv * dt;
    w.rv += (k * (rT - w.r) - c * w.rv) * dt; w.r += w.rv * dt;
  }

  function breakUp(why) {
    s.crashed = why; s.V = 0; s.lever = 0; s.n1 = s.n1.map(() => IDLE_N1);
    speak('crash');
  }
  function touchdown() {
    const vs = s.V * Math.sin(s.gamma);
    const fpm = vs / FT * 60;
    s.h = s.groundH;
    s.onGround = true;
    s.gamma = 0;
    let crash = null;
    const sp = s.spec;
    if (s.gear < 0.99) crash = s.gear < 0.1 ? 'Gear-up landing' : 'The gear was not down and locked';
    else if (fpm < -sp.crashFpm) crash = `Hit the ground at ${Math.round(-fpm)} ft/min`;
    else if (Math.abs(s.phi) > sp.tipBank) crash = sp.engine === 'piston' ? 'A wing tip hit the ground' : 'A wing tip and an engine hit the ground';
    else if (s.theta < -2.5) crash = sp.tailwheel ? 'Nosed over: the propellers hit the runway' : 'Nose wheel first: the nose gear collapsed';
    else if (s.V > sp.tyreKt * KT) crash = 'Far too fast for the tyres';
    if (crash) {
      s.crashed = crash; s.V = 0; s.lever = 0; s.n1 = s.n1.map(() => IDLE_N1);
      speak('crash');
      return;
    }
    s.landed = true;
    const r = -fpm;
    const rating = r < 120 ? 'butter' : r < 300 ? 'smooth' : r < 600 ? 'firm' : 'HARD landing';
    s.touch = { fpm: Math.round(fpm), rating, at: performance.now(), on: onRunway(), kt: Math.round(ias()) };
    if (s.theta > s.spec.tail) { s.tail = true; say('TAIL STRIKE', 'red', 5000); }
  }

  // ---------- warnings and callouts ----------
  function warnings() {
    const w = [];
    const a = agl(), vs = vsFpm(), spd = ias();
    const M = s.V / atmo(s.h).a;
    if (s.onGround) {
      if (s.lever >= 0.86 && !s.landed && s.V < 80 * KT) {
        if (s.conf === 0 && s.spec.toConf > 0) w.push(['CONFIG: FLAPS NOT IN T.O. CONFIG', 'red']);
        if (s.sb > 0) w.push(['CONFIG: SPEED BRAKES NOT RETRACTED', 'red']);
        if (s.parking) w.push(['CONFIG: PARK BRAKE ON', 'red']);
      }
      if (s.V > 40 * KT && !onRunway()) w.push(['OFF THE RUNWAY', 'red']);
    } else {
      if (spd > VMO + 4 || M > MMO + 0.006) w.push([s.lever > 0.87 ? `OVERSPEED: thrust back to ${DETENTS[1].name} (2)` : 'OVERSPEED', 'red']);
      // after take-off: the levers come back to CL, where the autothrust takes over
      if (isAirbus() && s.lever > 0.87 && !s.afloor && s.athr && a > 1200 && !s.landed) {
        w.push(['LVR CLB: thrust levers to CL (2)', 'amber']);
        if (!s.lvrClb) { s.lvrClb = true; speak('thrust levers climb'); }
      } else if (s.lever <= 0.87) s.lvrClb = false;
      if (spd > CONF[s.conf].vfe + 4 && s.conf > 0) w.push([`FLAP SPEED (VFE ${CONF[s.conf].vfe} kt)`, 'red']);
      if (s.spec.gear !== 'fixed' && s.gear > 0.05 && spd > VLE + 4) w.push([`GEAR SPEED (VLE ${VLE} kt)`, 'red']);
      if (airbus()) {
        if (s.alpha > s.aProt - 0.5) w.push(['ALPHA PROT', 'amber']);
        if (s.afloor) w.push(['A.FLOOR — TOGA LOCK (any throttle key)', 'amber']);
      } else if (s.stalled) w.push(['STALL — stick forward, power up', 'red']);
      else if ((s.spec.shaker || isFbw()) && s.alpha > s.aProt) w.push([isFbw() ? 'STALL WARNING' : 'STICK SHAKER', 'red']);
      if (!s.onGround && s.load > s.spec.gLimit + 0.05) w.push([`OVERSTRESS ${s.load.toFixed(1)} g`, 'red']);
      if (s.deep) w.push(['DEEP STALL — full nose down', 'red']);
      const sinking = vs < 0 ? a / (-vs / 60) : Infinity; // seconds to the ground
      const landing = s.gear > 0.99 && s.conf >= Math.min(s.spec.finalConf, lastConf());
      if (a < 2500 && sinking < 9 && !landing) w.push(['PULL UP', 'red']);
      else if (a < 2500 && vs < -Math.max(1500, 1000 + a * 1.2)) w.push(['SINK RATE', 'red']);
      if (a < 500 && s.gear < 0.99 && vs < 0) w.push(['TOO LOW — GEAR', 'red']);
      else if (a < 245 && s.conf < Math.min(s.spec.finalConf, lastConf()) && vs < 0) w.push(['TOO LOW — FLAPS', 'red']);
      if (s.gearDown !== (s.gear > 0.99) && s.gear > 0 && s.gear < 1) w.push(['GEAR IN TRANSIT', 'amber']);
    }
    // radio altitude callouts on the way down
    if (!s.onGround && FG.sound && FG.sound.on) {
      const prev = s.prevAgl;
      if (prev != null && vs < -100) {
        for (const h of [2500, 1000, 500, 100, 50, 40, 30, 20, 10]) {
          if (prev > h && a <= h && !s.calls[h]) {
            s.calls[h] = true;
            if (h === 20 && s.lever > 0.02) speak('retard');
            else speak(h === 2500 ? 'twenty five hundred' : h === 1000 ? 'one thousand' : h === 500 ? 'five hundred' : h === 100 ? 'one hundred' : String(h));
          }
        }
      }
      for (const h of Object.keys(s.calls)) if (a > Number(h) + 150) delete s.calls[h];
    }
    s.prevAgl = s.onGround ? 0 : a;
    return w;
  }

  // ---------- each frame (view3d calls it from its render loop) ----------
  function step(dtAll) {
    if (!s.active) return;
    const now = performance.now();
    if (s.loading) {
      if (now - s.startAt > 10000) s.loading = false;
      draw([]);
      return;
    }
    // the ground under the plane, as the 3D map draws it (FG.flat.heightsAt, asked a few times a second: the map's
    // own terrain reads 0 m where its tiles haven't come yet), smoothed
    if (FG.flat && !s.ghBusy && now - (s.ghAt || 0) > 150) {
      s.ghBusy = true; s.ghAt = now;
      const at = [s.lat, s.lon];
      FG.flat.heightsAt([at], 12).then(([h]) => { if (h != null && isFinite(h)) { s.ghReal = h; s.ghReal0 = at; } }, () => {}).finally(() => { s.ghBusy = false; });
    }
    const gh = s.ghReal != null ? s.ghReal : groundAt(s.lat, s.lon);
    if (gh != null) {
      if (Math.abs(gh - s.groundH) > 60 && !s.onGround) s.groundH = gh;
      else s.groundH += (gh - s.groundH) * (1 - Math.exp(-dtAll / 0.25));
    }
    if (!s.paused && !s.menu && !s.crashed) {
      inputs(dtAll);
      let left = Math.min(dtAll, 0.25);
      while (left > 1e-6) { const dt = Math.min(0.02, left); physics(dt); left -= dt; if (s.crashed) break; }
    }
    draw(s.crashed ? [] : warnings());
  }

  // The pose view3d draws: degrees, metres; altM: the wheels' height above the ground; st: as G.flightState gives,
  // for the parts of the 3D view that read it (lights, wing bending, tyre smoke).
  function pose() {
    const a = Math.max(0, s.h - s.groundH);
    const vs = s.V * Math.sin(s.gamma);
    const phase = s.onGround ? (s.V < 30 * KT ? 'taxi-out' : s.landed ? 'landing' : 'takeoff')
      : a < 900 && vs < -1 ? 'approach' : vs > 2 ? 'climb' : vs < -2 ? 'descent' : 'cruise';
    const kmh = s.V * 3.6;
    const tb = performance.now() / 1000, bf = s.paused || s.menu || s.crashed ? 0 : s.buffet;
    const shakeP = bf * (0.5 * Math.sin(tb * 37) + 0.3 * Math.sin(tb * 23 + 1.3));
    const shakeR = bf * (0.6 * Math.sin(tb * 29 + 0.7) + 0.4 * Math.sin(tb * 17 + 2.1));
    return {
      lat: s.lat, lon: s.lon, altM: a, altMSL: s.h, heading: wrap360(s.psi + (s.onGround ? 0 : s.alpha * Math.sin(s.phi * DEG))), bank: s.phi + s.sway.r + shakeR, pitch: s.theta + s.sway.p + shakeP, flying: true,
      st: { phase, speedKmh: kmh, altFt: s.h / FT, fieldFt: s.groundH / FT, ground: s.onGround, windKt: 0, windFrom: 0, gusty: false, airFrac: 0 },
      pilot: { gear: s.gear, flap: confAt(s.flapPos).flap, ail: s.roll, elev: s.onGround ? s.stick : s.stick * 0.7, rud: s.onGround ? s.rud : s.rud, rev: s.rev, n1: s.n1.reduce((x, y) => x + y, 0) / s.n1.length, gamma: s.gamma / DEG, vs,
        nz: (s.load || 0) + bf * 0.25 * Math.sin(tb * 13), stall: s.stallAmt || 0 },
    };
  }

  // ---------- instruments ----------
  let hud, cv, ctx;
  function showHud(on) {
    if (on && !hud) {
      hud = document.createElement('div');
      hud.id = 'pilot-hud';
      hud.innerHTML = `<canvas></canvas>
        <div class="pl-bar"><button data-pl="ck-save" title="Save a checkpoint here (Z)">⚑ Checkpoint</button><button data-pl="ck-back" title="Back to the checkpoint (Backspace)">⟲ Retry</button><button data-pl="limiter" title="Protections and limits on / off (L)">🛡 Limiter on</button><button data-pl="cam" title="Camera (C)">🎥 Camera</button><button data-pl="help" title="Keys (H)">⌨ Keys</button><button data-pl="exit" title="Menu (Esc)">☰ Menu</button></div>`;
      document.body.appendChild(hud);
      cv = hud.querySelector('canvas');
      ctx = cv.getContext('2d');
      hud.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pl]');
        if (!b) return;
        if (b.dataset.pl === 'exit') showMenu(!s.menu);
        if (b.dataset.pl === 'help') s.help = !s.help;
        if (b.dataset.pl === 'limiter') toggleLimiter();
        if (b.dataset.pl === 'ck-save') saveCheckpoint();
        if (b.dataset.pl === 'ck-back') toCheckpoint();
        if (b.dataset.pl === 'cam') FG.view3d.pilotCam(s.cam = CAMS[(CAMS.indexOf(s.cam) + 1) % CAMS.length]);
        b.blur();
      });
    }
    if (hud) hud.hidden = !on;
    limiterButton();
    document.body.classList.toggle('piloting', on);
  }

  const HELP = [
    ['↑ ↓  /  W S', () => (airbus() ? 'nose down / up (stick: pitch rate, holds the path)' : 'nose down / up (let go: back to the trim; hold it and the trim follows; it can stall)')],
    ['← →  /  A D', () => (s.spec.dihedral ? 'roll (the wings level by themselves); steer on the ground' : 'roll (bank holds); steer on the ground')],
    ['Q E', 'rudder / nose wheel'],
    ['PgUp PgDn  + −', 'thrust levers (on the ground, − past idle = reverse)'],
    ['1 2 3 4', () => DETENTS.map((d) => d.name).join(' · ')],
    ['2', () => (s.spec.athr ? `${DETENTS[1].name}: autothrust holds the speed (magenta, or [ ] to pick one, \\ managed)` : 'no autothrust on this one: set the power yourself')],
    ['Home End  U J', () => (airbus() ? 'pitch trim (fly-by-wire trims itself)' : 'pitch trim: nose down / up (the angle it flies at hands off)')],
    ['T', 'autothrust off / on (off: the levers set the thrust)'],
    ['R', 'full reverse / stow (on the ground)'],
    ['G', 'landing gear'],
    ['F  /  Shift+F', 'flaps one notch down / up'],
    ['X  /  Shift+X', 'speed brakes · arm ground spoilers'],
    ['Space  B', 'wheel brakes (hold)    K: parking brake'],
    ['C  V  N', 'camera: next · chase · wing'],
    ['Z   Backspace', 'save a checkpoint · back to it (try again until it works)'],
    ['L', () => (!s.spec.prot ? 'limiter: this one has no protections at all' : s.limiter ? 'limiter off: no protections (it can stall and be overstressed)' : 'limiter back on')],
    ['P   Esc', 'pause · menu (resume, checkpoint, start again, leave)'],
  ];

  function draw(warn) {
    if (!hud || hud.hidden) return;
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth, H = window.innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (s.loading) { banner(W / 2, H / 2, 'Loading the ground…', '#fff', 22); return; }
    const k = Math.min(1, W / 900, H / 620);
    if (s.cam === 'cockpit') headUp(W, H);
    // PFD bottom left, engines and config bottom right
    ctx.save(); ctx.translate(12, H - 12 - 270 * k); ctx.scale(k, k); pfd(); ctx.restore();
    ctx.save(); ctx.translate(W - 12 - 250 * k, H - 12 - 270 * k); ctx.scale(k, k); ecam(); ctx.restore();
    // warnings, messages
    const now = performance.now();
    s.msgs = s.msgs.filter((m) => m.until > now);
    let y = 70;
    const flash = Math.floor(now / 400) % 2 === 0;
    for (const [t, lvl] of warn) {
      if (lvl === 'red' && !flash && /PULL UP|SINK|TOO LOW|OVERSPEED/.test(t)) { y += 30; continue; }
      banner(W / 2, y, t, lvl === 'red' ? '#ff3b30' : '#ffb000', 20); y += 30;
    }
    for (const m of s.msgs) { banner(W / 2, y, m.text, m.level === 'red' ? '#ff3b30' : m.level === 'amber' ? '#ffb000' : '#e8f0ff', 15); y += 26; }
    if (s.touch && now - s.touch.at < 9000) {
      const t = s.touch;
      const col = t.rating === 'butter' || t.rating === 'smooth' ? '#30d158' : t.rating === 'firm' ? '#ffd60a' : '#ff453a';
      banner(W / 2, H * 0.32, `Touchdown ${t.fpm} ft/min · ${t.kt} kt · ${t.rating}${t.on ? '' : ' · not on a runway!'}`, col, 22);
      if (s.ck) banner(W / 2, H * 0.32 + 30, 'Backspace: try it again from the checkpoint', '#e8f0ff', 14);
    }
    if (s.crashed) {
      banner(W / 2, H * 0.4, `💥 CRASH — ${s.crashed}`, '#ff3b30', 28);
      banner(W / 2, H * 0.4 + 44, s.ck ? 'Backspace: back to the checkpoint · Enter: start again · Esc: menu' : 'Enter: try again · Esc: menu', '#fff', 16);
    }
    if (s.paused) banner(W / 2, H * 0.45, 'PAUSED (P)', '#fff', 26);
    if (s.help) helpBox(W, H);
  }
  function banner(x, y, text, color, size) {
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + size * 1.2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(x - w / 2, y - size * 0.95, w, size * 1.6, 6); ctx.fill();
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y - size * 0.15);
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function helpBox(W, H) {
    const w = 470, h = 26 + HELP.length * 22;
    const x = W / 2 - w / 2, y = Math.max(110, H / 2 - h / 2);
    ctx.fillStyle = 'rgba(10,14,22,0.85)'; roundRect(x, y, w, h, 10); ctx.fill();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    HELP.forEach(([key, what], i) => {
      ctx.font = '600 13px ui-monospace, monospace'; ctx.fillStyle = '#7fd4ff'; ctx.fillText(key, x + 16, y + 22 + i * 22);
      ctx.font = '13px system-ui, sans-serif'; ctx.fillStyle = '#e8eef8'; ctx.fillText(typeof what === 'function' ? what() : what, x + 160, y + 22 + i * 22);
    });
  }

  // Primary flight display: attitude, speed tape, altitude tape, vertical speed, heading, ILS.
  function pfd() {
    const c = ctx;
    c.fillStyle = 'rgba(8,10,14,0.82)'; roundRect(0, 0, 400, 270, 10); c.fill();
    c.textBaseline = 'middle';
    // mode line (thrust)
    c.font = '600 13px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillStyle = s.afloor ? '#ffb000' : '#30d158';
    const dn = detentName(s.lever);
    if (athrOn()) c.fillText(s.spdSel != null ? 'SPEED SEL' : 'SPEED', 100, 16);
    else c.fillText(s.afloor ? 'A.FLOOR' : s.lever < 0 ? 'REV' : dn === 'MAN THR' ? dn : `MAN ${dn}`, 100, 16);
    if (isAirbus() && !s.onGround && s.lever > 0.87 && s.athr && !s.afloor && Math.floor(performance.now() / 500) % 2) { c.fillStyle = '#ffb000'; c.font = '600 11px system-ui, sans-serif'; c.fillText('LVR CLB', 100, 30); c.font = '600 13px system-ui, sans-serif'; }
    c.fillStyle = s.athr || !s.spec.athr ? '#e8eef8' : '#ffb000'; c.font = '600 10px system-ui, sans-serif'; c.fillText(!s.spec.athr ? 'NO A/THR' : s.athr ? (athrOn() ? 'A/THR' : 'A/THR ARM') : 'A/THR OFF', 300, 30); c.font = '600 13px system-ui, sans-serif';
    c.fillStyle = '#e8eef8'; c.fillText(CONF.length > 1 ? `FLAPS ${CONF[s.conf].name}` : 'NO FLAPS', 200, 16);
    c.fillStyle = !lim() ? '#ffb000' : airbus() ? '#30d158' : '#e8eef8'; c.fillText(lawName(), 300, 16);
    // attitude
    const ax = 200, ay = 128, r = 82, ppd = 4;
    c.save();
    c.beginPath(); c.rect(ax - r, ay - r, 2 * r, 2 * r); c.clip();
    c.translate(ax, ay); c.rotate(-s.phi * DEG);
    const hy = s.theta * ppd;
    c.fillStyle = '#2f7dd1'; c.fillRect(-300, -600 + hy, 600, 600);
    c.fillStyle = '#8a5a2b'; c.fillRect(-300, hy, 600, 600);
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(-300, hy); c.lineTo(300, hy); c.stroke();
    c.lineWidth = 1.2; c.font = '10px system-ui'; c.fillStyle = '#fff'; c.textAlign = 'left';
    for (let p = -30; p <= 30; p += 2.5) {
      if (!p) continue;
      const y = hy - p * ppd; const w = p % 10 === 0 ? 34 : p % 5 === 0 ? 20 : 8;
      c.beginPath(); c.moveTo(-w, y); c.lineTo(w, y); c.stroke();
      if (p % 10 === 0) c.fillText(String(Math.abs(p)), w + 4, y);
    }
    c.restore();
    // bank scale and pointer
    c.strokeStyle = '#fff'; c.lineWidth = 1.2;
    for (const b of [-45, -30, -20, -10, 0, 10, 20, 30, 45]) {
      const a = (b - 90) * DEG; const l = b % 30 === 0 ? 10 : 6;
      c.beginPath(); c.moveTo(ax + Math.cos(a) * (r - 2), ay + Math.sin(a) * (r - 2)); c.lineTo(ax + Math.cos(a) * (r - 2 - l), ay + Math.sin(a) * (r - 2 - l)); c.stroke();
    }
    const pa = (-s.phi - 90) * DEG;
    c.fillStyle = Math.abs(s.phi) > 33 ? '#ffb000' : '#ffd60a';
    c.beginPath(); c.moveTo(ax + Math.cos(pa) * (r - 14), ay + Math.sin(pa) * (r - 14));
    c.lineTo(ax + Math.cos(pa + 0.06) * (r - 24), ay + Math.sin(pa + 0.06) * (r - 24));
    c.lineTo(ax + Math.cos(pa - 0.06) * (r - 24), ay + Math.sin(pa - 0.06) * (r - 24)); c.fill();
    // aircraft symbol
    c.strokeStyle = '#000'; c.fillStyle = '#ffd60a'; c.lineWidth = 1;
    c.fillRect(ax - 52, ay - 2, 30, 5); c.fillRect(ax + 22, ay - 2, 30, 5); c.fillRect(ax - 3, ay - 3, 6, 6);
    // flight path vector (bird)
    const fy = ay + s.alpha * ppd; // (straight below the aircraft symbol: no sideslip)
    if (!s.onGround) { c.strokeStyle = '#30d158'; c.lineWidth = 2; c.beginPath(); c.arc(ax, fy, 5, 0, 7); c.moveTo(ax - 13, fy); c.lineTo(ax - 5, fy); c.moveTo(ax + 5, fy); c.lineTo(ax + 13, fy); c.moveTo(ax, fy - 5); c.lineTo(ax, fy - 10); c.stroke(); }
    // ILS
    const l = ils();
    if (l) {
      c.fillStyle = '#ff6ef2'; c.strokeStyle = '#fff';
      for (const d of [-2, -1, 1, 2]) { c.beginPath(); c.arc(ax + d * 30, ay + r + 10, 3, 0, 7); c.stroke(); }
      const lx = ax + clamp(-l.loc / 0.8, -2.3, 2.3) * 30;
      c.beginPath(); c.moveTo(lx - 7, ay + r + 10); c.lineTo(lx, ay + r + 4); c.lineTo(lx + 7, ay + r + 10); c.lineTo(lx, ay + r + 16); c.fill();
      if (l.gs != null) {
        for (const d of [-2, -1, 1, 2]) { c.beginPath(); c.arc(ax + r + 10, ay + d * 30, 3, 0, 7); c.stroke(); }
        const gy = ay + clamp(l.gs / 0.35, -2.3, 2.3) * 30;
        c.beginPath(); c.moveTo(ax + r + 10, gy - 7); c.lineTo(ax + r + 4, gy); c.lineTo(ax + r + 10, gy + 7); c.lineTo(ax + r + 16, gy); c.fill();
      }
      c.font = '11px system-ui'; c.textAlign = 'left'; c.fillStyle = '#ff6ef2';
      c.textAlign = 'center';
      c.fillText(`ILS ${l.e.code} ${l.e.name}  ${(l.d / 1852).toFixed(1)} NM`, ax, 33);
    }
    // radio altitude
    const a = agl();
    if (!s.onGround && a < 2500) { c.font = '600 15px system-ui'; c.textAlign = 'center'; c.fillStyle = a < 400 ? '#ffb000' : '#30d158'; c.fillText(String(Math.round(a / (a < 50 ? 1 : 10)) * (a < 50 ? 1 : 10)), ax, ay + 60); }
    // speed tape
    const spd = ias();
    tape(10, 40, 62, 176, spd, 3, 10, 20, (vv) => String(vv), '#fff');
    const top = Math.min(VMO, CONF[s.conf].vfe, s.gear > 0.05 && s.spec.gear !== 'fixed' ? VLE : 999);
    // red band above the max speed
    const yTop = 128 - (top - spd) * 3;
    if (yTop > 40) { c.fillStyle = '#ff3b30'; c.fillRect(64, 40, 6, Math.min(176, yTop - 40)); }
    // the alpha protection band (amber) from the speed it would take at that angle
    if (!s.onGround) {
      const vProt = spd * Math.sqrt(Math.max(0.05, (CL_BASE + confAt(s.flapPos).cl0 + CL_A * s.alpha)) / Math.max(0.05, CL_BASE + confAt(s.flapPos).cl0 + CL_A * s.aProt));
      const yP = 128 + (spd - vProt) * 3;
      if (yP < 216) { c.fillStyle = '#ffb000'; c.fillRect(64, Math.max(40, yP), 6, 216 - Math.max(40, yP)); }
    }
    // speed trend
    if (s.trend != null) {
      const ty = 128 - s.trend * 10 * 3;
      c.strokeStyle = '#ffd60a'; c.lineWidth = 2; c.beginPath(); c.moveTo(74, 128); c.lineTo(74, clamp(ty, 40, 216)); c.stroke();
    }
    // the speed the autothrust flies: magenta managed, cyan picked ([ ])
    if (s.spec.athr) { const tg = spdTarget(); const y = clamp(128 - (tg.kt - spd) * 3, 40, 216);
      c.fillStyle = tg.sel ? '#5ac8fa' : '#ff6ef2'; c.beginPath(); c.moveTo(64, y); c.lineTo(76, y - 6); c.lineTo(76, y + 6); c.fill();
      if (Math.abs(tg.kt - spd) > 26) { c.font = '600 11px system-ui'; c.textAlign = 'center'; c.fillText(String(tg.kt), 41, tg.kt > spd ? 33 : 223); } }
    box(10, 128, 62, String(Math.round(spd)), '#ffd60a');
    c.font = '11px system-ui'; c.fillStyle = '#9ab'; c.textAlign = 'center';
    const M = s.V / atmo(s.h).a;
    c.fillText(M > 0.45 ? `M ${M.toFixed(2).slice(1)}` : `GS ${Math.round(s.V / KT)}`, 41, 230);
    // altitude tape
    const alt = s.h / FT;
    tape(306, 40, 62, 176, alt, 0.18, 100, 500, (vv) => String(Math.round(vv / 100)).padStart(3, '0'), '#fff');
    // the ground on the altitude tape
    const yG = 128 + (alt - s.groundH / FT) * 0.18;
    if (yG < 216) { c.fillStyle = 'rgba(255,59,48,0.8)'; c.fillRect(306, Math.max(40, yG), 62, 216 - Math.max(40, yG)); }
    box(306, 128, 62, String(Math.round(alt / 10) * 10), '#30d158');
    // vertical speed
    const vs = vsFpm();
    c.strokeStyle = '#555'; c.lineWidth = 1; c.beginPath(); c.moveTo(380, 50); c.lineTo(380, 206); c.stroke();
    const vy = 128 - clamp(Math.sign(vs) * Math.sqrt(Math.abs(vs) / 6000), -1, 1) * 78;
    c.strokeStyle = Math.abs(vs) > 6000 ? '#ffb000' : '#30d158'; c.lineWidth = 3; c.beginPath(); c.moveTo(372, 128); c.lineTo(390, vy); c.stroke();
    c.font = '11px system-ui'; c.fillStyle = '#30d158'; c.textAlign = 'center';
    if (Math.abs(vs) > 200) c.fillText(String(Math.round(Math.abs(vs) / 100)), 384, vs > 0 ? 42 : 216);
    // heading
    c.save(); c.beginPath(); c.rect(100, 232, 200, 32); c.clip();
    c.strokeStyle = '#fff'; c.fillStyle = '#fff'; c.font = '11px system-ui'; c.lineWidth = 1;
    for (let d = Math.floor(s.psi / 5) * 5 - 30; d <= s.psi + 30; d += 5) {
      const x = 200 + (d - s.psi) * 3.3;
      c.beginPath(); c.moveTo(x, 236); c.lineTo(x, d % 10 === 0 ? 244 : 240); c.stroke();
      if (d % 10 === 0) c.fillText(String(wrap360(d) / 10 | 0), x, 254);
    }
    c.restore();
    c.fillStyle = '#ffd60a'; c.fillRect(199, 230, 2, 16);
    c.font = '11px system-ui'; c.fillStyle = '#9ab'; c.fillText(`HDG ${String(Math.round(s.psi) % 360).padStart(3, '0')}`, 350, 250);
  }
  function tape(x, y, w, h, val, ppu, tick, label, fmt, color) {
    const c = ctx;
    c.save(); c.fillStyle = 'rgba(60,64,72,0.7)'; c.fillRect(x, y, w, h);
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1; c.font = '11px system-ui'; c.textAlign = 'center';
    const span = h / 2 / ppu;
    for (let u = Math.ceil((val - span) / tick) * tick; u <= val + span; u += tick) {
      if (u < 0 && ppu > 1) continue;
      const yy = y + h / 2 - (u - val) * ppu;
      c.beginPath(); c.moveTo(x + w - 8, yy); c.lineTo(x + w, yy); c.stroke();
      if (Math.abs(u % label) < 1e-6) c.fillText(fmt(u), x + w / 2 - 4, yy);
    }
    c.restore();
  }
  function box(x, y, w, text, color) {
    const c = ctx;
    c.fillStyle = '#000'; c.fillRect(x + 2, y - 11, w - 4, 22);
    c.strokeStyle = color; c.lineWidth = 1.5; c.strokeRect(x + 2, y - 11, w - 4, 22);
    c.fillStyle = color; c.font = '600 14px ui-monospace, monospace'; c.textAlign = 'center'; c.fillText(text, x + w / 2, y + 1);
  }

  // Engines (N1), thrust lever, flaps, gear, spoilers, brakes.
  function ecam() {
    const c = ctx;
    c.fillStyle = 'rgba(8,10,14,0.82)'; roundRect(0, 0, 250, 270, 10); c.fill();
    c.textBaseline = 'middle';
    const ne = s.n1.length;
    for (let i = 0; i < ne; i++) {
      const r = ne > 2 ? (ne > 3 ? 22 : 27) : 34, cx = ne > 2 ? 125 + (i - (ne - 1) / 2) * (ne > 3 ? 56 : 72) : 62 + i * 126, cy = 52;
      c.lineWidth = 3; c.strokeStyle = '#555';
      c.beginPath(); c.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25); c.stroke();
      const f = clamp(s.n1[i] / 110, 0, 1);
      c.strokeStyle = s.rev > 0.05 ? '#30d158' : '#fff'; c.lineWidth = 4;
      c.beginPath(); c.arc(cx, cy, r, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * f)); c.stroke();
      // the lever's target (cyan)
      const tl = s.lever < 0 ? IDLE_N1 : IDLE_N1 + (100 - IDLE_N1) * s.lever;
      const ta = Math.PI * (0.75 + 1.5 * tl / 110);
      c.fillStyle = '#5ac8fa'; c.beginPath(); c.arc(cx + Math.cos(ta) * (r + 6), cy + Math.sin(ta) * (r + 6), 3, 0, 7); c.fill();
      c.font = `600 ${ne > 2 ? 12 : 16}px ui-monospace, monospace`; c.fillStyle = '#30d158'; c.textAlign = 'center';
      c.fillText(s.n1[i].toFixed(ne > 3 ? 0 : 1), cx, cy + 4);
      c.font = '10px system-ui'; c.fillStyle = '#9ab'; c.fillText(ne > 2 ? `ENG ${i + 1}` : `${s.spec.gauge}  ENG ${i + 1}`, cx, cy + r - 2);
      if (ne > 2 && i === 0) c.fillText(s.spec.gauge, 125, 90);
      if (s.rev > 0.05) { c.fillStyle = s.rev > 0.95 ? '#30d158' : '#ffb000'; c.font = '600 12px system-ui'; c.fillText('REV', cx, cy - 16); }
    }
    // thrust lever
    c.font = '600 13px system-ui'; c.textAlign = 'left'; c.fillStyle = '#5ac8fa';
    c.fillText(`THR LVR  ${detentName(s.lever)}  ${s.lever < 0 ? '' : Math.round(s.lever * 100) + '%'}`, 14, 106);
    // flaps
    c.fillStyle = '#e8eef8'; c.fillText('FLAPS', 14, 134);
    if (CONF.length === 1) { c.fillStyle = '#9ab'; c.font = '11px system-ui'; c.fillText('none: delta wing', 70, 134); }
    const fStep = CONF.length > 1 ? Math.min(28, 166 / (CONF.length - 1)) : 0;
    for (let i = 0; i < CONF.length && CONF.length > 1; i++) {
      const x = 70 + i * fStep;
      c.fillStyle = i === s.conf ? '#5ac8fa' : '#556'; c.font = (i === s.conf ? '600 ' : '') + '11px system-ui'; c.textAlign = 'center';
      c.fillText(CONF[i].name, x, 134);
    }
    c.fillStyle = '#30d158'; c.fillRect(56, 144, clamp(s.flapPos / Math.max(1, CONF.length - 1), 0, 1) * 180, 4);
    c.strokeStyle = '#556'; c.strokeRect(56, 144, 180, 4);
    // gear
    c.textAlign = 'left'; c.font = '600 13px system-ui'; c.fillStyle = '#e8eef8'; c.fillText('GEAR', 14, 172);
    const locked = s.gear > 0.99, moving = s.gear > 0.01 && s.gear < 0.99;
    for (let i = 0; i < 3; i++) {
      const x = 70 + i * 52;
      c.strokeStyle = locked ? '#30d158' : moving ? '#ff3b30' : '#556'; c.lineWidth = 2;
      c.strokeRect(x, 162, 42, 20);
      c.fillStyle = locked ? '#30d158' : '#ff3b30'; c.font = '600 11px system-ui'; c.textAlign = 'center';
      if (locked) { c.beginPath(); c.moveTo(x + 13, 166); c.lineTo(x + 29, 166); c.lineTo(x + 21, 178); c.fill(); }
      else if (moving) c.fillText('UNLK', x + 21, 172);
    }
    c.textAlign = 'left'; c.font = '11px system-ui'; c.fillStyle = '#9ab';
    c.fillText(s.spec.gear === 'fixed' ? 'fixed gear' : `lever ${s.gearDown ? 'DOWN' : 'UP'}`, 14, 190);
    // spoilers, brakes
    c.font = '600 12px system-ui';
    const spl = Math.max(s.gs, s.sb);
    c.fillStyle = spl > 0.05 ? '#30d158' : s.armed ? '#5ac8fa' : '#556';
    if (s.spec.speedBrake || s.spec.groundSpoilers) c.fillText(spl > 0.05 ? `SPD BRK ${Math.round(spl * 100)}%` : s.armed ? 'GND SPLR ARMED' : 'SPD BRK RET', 14, 212);
    else if (s.spec.engine === 'sst' && s.lever > 0.98 && !s.onGround || s.spec.engine === 'sst' && s.lever > 0.98) { c.fillStyle = '#ffb000'; c.fillText('REHEAT ON', 14, 212); }
    else { c.fillStyle = '#556'; c.fillText('NO SPOILERS', 14, 212); }
    c.fillStyle = s.parking ? '#ffb000' : s.brake > 0.05 ? '#30d158' : '#556';
    c.fillText(s.parking ? 'PARK BRK ON' : `BRAKES ${Math.round(s.brake * 100)}%`, 140, 212);
    c.font = '11px system-ui'; c.fillStyle = '#9ab';
    c.fillText(`GW ${Math.round(s.mass / 1000)} t   GS ${Math.round(s.V * Math.cos(s.gamma) / KT)} kt   G ${(s.load || 1).toFixed(2)}`, 14, 236);
    c.fillText(`${s.type}   C camera · H keys · Esc menu`, 14, 256);
  }

  // Cockpit view: a head-up display in green, lined up with the camera (which looks LOOK_DOWN° under the nose).
  function headUp(W, H) {
    const c = ctx;
    const fov = FG.view3d && FG.view3d.fov ? FG.view3d.fov() : 36.87;
    const ppd = H / fov;
    const bx = W / 2, by = H / 2 - LOOK_DOWN * ppd; // where the nose points
    c.save();
    c.strokeStyle = 'rgba(70,255,120,0.9)'; c.fillStyle = 'rgba(70,255,120,0.95)'; c.lineWidth = 1.6;
    c.font = '600 14px ui-monospace, monospace'; c.textBaseline = 'middle';
    c.save();
    c.translate(bx, by); c.rotate(-s.phi * DEG);
    c.beginPath(); c.rect(-W * 0.3, -H * 0.38, W * 0.6, H * 0.76); c.clip();
    const hy = s.theta * ppd;
    c.beginPath(); c.moveTo(-W, hy); c.lineTo(-60, hy); c.moveTo(60, hy); c.lineTo(W, hy); c.stroke();
    for (let p = -20; p <= 30; p += 5) {
      if (!p) continue;
      const y = hy - p * ppd;
      c.setLineDash(p < 0 ? [8, 6] : []);
      c.beginPath(); c.moveTo(-110, y); c.lineTo(-45, y); c.moveTo(45, y); c.lineTo(110, y); c.stroke();
      c.textAlign = 'left'; c.fillText(String(p), 116, y);
    }
    c.setLineDash([]);
    c.restore();
    // boresight and flight path marker
    c.beginPath(); c.moveTo(bx - 18, by); c.lineTo(bx - 6, by); c.lineTo(bx, by + 6); c.lineTo(bx + 6, by); c.lineTo(bx + 18, by); c.stroke();
    if (!s.onGround) {
      const fy = by + s.alpha * ppd;
      c.beginPath(); c.arc(bx, fy, 7, 0, 7); c.moveTo(bx - 22, fy); c.lineTo(bx - 7, fy); c.moveTo(bx + 7, fy); c.lineTo(bx + 22, fy); c.moveTo(bx, fy - 7); c.lineTo(bx, fy - 15); c.stroke();
    }
    // speed and altitude
    c.textAlign = 'right'; c.fillText(`${Math.round(ias())} KT`, bx - W * 0.2, by);
    c.textAlign = 'left'; c.fillText(`${Math.round(s.h / FT / 10) * 10} FT`, bx + W * 0.2, by);
    c.fillText(`${Math.round(vsFpm() / 50) * 50} FPM`, bx + W * 0.2, by + 22);
    c.textAlign = 'center'; c.fillText(String(Math.round(s.psi) % 360).padStart(3, '0'), bx, by - H * 0.36);
    c.restore();
  }

  // speed trend: the acceleration over the last moments (kt per second)
  let lastV = null, lastT = 0;
  setInterval(() => {
    if (!s.active) return;
    const now = performance.now();
    if (lastV != null) s.trend = (ias() - lastV) / ((now - lastT) / 1000) * 0.6 + (s.trend || 0) * 0.4;
    lastV = ias(); lastT = now;
  }, 250);

  // ---------- start dialog ----------
  function defaultAirport() {
    const ui = FG.ui || {};
    if (ui.selectedAirport && G.airportByCode[ui.selectedAirport]) return ui.selectedAirport;
    const p = ui.selectedPlane && G.plane(ui.selectedPlane);
    if (p) return p.status === 'flying' && p.flight ? p.flight.from : p.location;
    return G.state.home || 'ZRH';
  }
  function bestEnd(ends, code) {
    const a = G.airportByCode[code];
    let wind = null;
    try { wind = G.windAt(a.lat, a.lon, G.state.time, 0); } catch (e) { /* */ }
    const longest = Math.max(...ends.map((e) => e.len));
    const score = (e) => e.len / longest * 2 + (wind && wind.kt > 3 ? Math.cos((wind.from - e.course) * DEG) : 0);
    return ends.slice().sort((x, y) => score(y) - score(x))[0];
  }
  // The Esc menu: the flight waits behind it.
  function showMenu(on) {
    s.menu = on;
    s.keys.clear();
    let el = document.getElementById('pilot-menu');
    if (!on) { if (el) el.remove(); return; }
    if (el) return;
    el = document.createElement('div');
    el.id = 'pilot-menu';
    el.innerHTML = `<div class="ps-card" role="dialog" aria-modal="true">
      <h2>Flight paused</h2>
      <div class="pm-buttons">
        <button class="primary" data-pm="resume">▶ Resume <kbd>Esc</kbd></button>
        <button data-pm="ck-back"${s.ck ? '' : ' disabled'}>⟲ Back to the checkpoint${s.ck ? ` (${s.ck.where})` : ''} <kbd>Backspace</kbd></button>
        <button data-pm="ck-save"${s.crashed ? ' disabled' : ''}>⚑ Save a checkpoint here <kbd>Z</kbd></button>
        <button data-pm="restart">↺ Start this flight again <kbd>R</kbd></button>
        <button data-pm="leave">✕ Leave the cockpit <kbd>Q</kbd></button>
      </div></div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pm]');
      if (e.target === el || (b && b.dataset.pm === 'resume')) showMenu(false);
      else if (b && b.dataset.pm === 'restart') restart();
      else if (b && b.dataset.pm === 'leave') stop();
      else if (b && b.dataset.pm === 'ck-back') toCheckpoint();
      else if (b && b.dataset.pm === 'ck-save') { saveCheckpoint(); showMenu(false); }
    });
  }
  function openDialog() {
    if (s.active) return;
    if (!FG.view3d) { toast('The 3D view is not available here.'); return; }
    let el = document.getElementById('pilot-start');
    if (el) { el.remove(); return; }
    const ui = FG.ui || {};
    const sel = ui.selectedPlane && G.plane(ui.selectedPlane);
    const mine = sel && TYPES[sel.type] ? sel : null;
    el = document.createElement('div');
    el.id = 'pilot-start';
    el.innerHTML = `<div class="ps-card" role="dialog" aria-modal="true">
      <h2>✈ Fly it yourself</h2>
      <p class="ps-sub">Fly by hand: throttle, flaps, gear and brakes. Each aircraft flies in its own way. It flies in real time, apart from your airline.</p>
      <label>Aircraft <select id="ps-type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('')}</select></label>
      <p class="ps-sub" id="ps-blurb"></p>
      <label>Airport <input id="ps-ap" maxlength="4" spellcheck="false" autocomplete="off"></label>
      <label>Runway <select id="ps-rw"></select></label>
      <div class="ps-modes">
        <label class="check"><input type="radio" name="ps-mode" value="runway" checked> Lined up on the runway, ready for take-off</label>
        <label class="check"><input type="radio" name="ps-mode" value="final"> On final: on the ILS, gear up</label>
        ${mine && mine.status === 'flying' ? `<label class="check"><input type="radio" name="ps-mode" value="takeover"> Take over ${mine.reg || mine.name || 'my ' + mine.type} where it is now</label>` : ''}
      </div>
      <p class="ps-err" id="ps-err"></p>
      <div class="row"><button data-ps="no">Cancel</button><button class="primary" data-ps="go">Fly</button></div>
      <p class="ps-keys">↑↓ pitch · ←→ roll · PgUp/PgDn or +/− thrust · 1-4 detents · G gear · F flaps · Space brakes · R reverse · Home/End trim · L limiter · C camera · H all keys</p>
    </div>`;
    document.body.appendChild(el);
    const ap = el.querySelector('#ps-ap'), rw = el.querySelector('#ps-rw'), err = el.querySelector('#ps-err');
    const typeSel = el.querySelector('#ps-type'), blurb = el.querySelector('#ps-blurb');
    typeSel.value = mine ? mine.type : s.type && TYPES[s.type] ? s.type : 'A350-900';
    let ends = [];
    const fill = () => {
      const code = ap.value.trim().toUpperCase();
      const t = TYPES[typeSel.value];
      blurb.textContent = t.blurb;
      // the runway it needs: longer for the heavy jets, a field will do for the old propliners
      const need = t.engine === 'piston' ? 600 : t.engine === 'prop' ? 1200 : t.toMass > 150000 ? 2500 : 1800;
      ends = G.airportByCode[code] ? runwayEnds(code).filter((e) => e.len >= Math.min(800, need)) : [];
      const best = ends.length ? bestEnd(ends, code) : null;
      rw.innerHTML = ends.map((e, i) => `<option value="${i}"${e === best ? ' selected' : ''}>${e.name} · ${Math.round(e.len).toLocaleString()} m${e.len < need ? ' (short!)' : ''}</option>`).join('');
      err.textContent = !G.airportByCode[code] ? (code ? 'No airport with that code.' : '') : ends.length ? '' : 'No runways known there.';
    };
    ap.value = defaultAirport();
    fill();
    ap.addEventListener('input', fill);
    typeSel.addEventListener('change', fill);
    el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') el.remove(); if (e.key === 'Enter') go(); });
    const go = () => {
      const mode = (el.querySelector('input[name="ps-mode"]:checked') || {}).value || 'runway';
      const type = el.querySelector('#ps-type').value;
      if (mode === 'takeover') {
        const t = FG.ui.time != null ? FG.ui.time : G.state.time;
        const st = G.flightState(mine, t);
        if (!st) { err.textContent = 'That plane is not in the air.'; return; }
        if (st.ground || st.phase === 'boarding' || st.phase === 'pushback' || st.phase.startsWith('taxi')) {
          err.textContent = 'It is on the ground: pick its airport and start on the runway.'; return;
        }
        el.remove();
        start({ type, mode, plane: mine, state: st });
        return;
      }
      const end = ends[Number(rw.value)];
      if (!end) { err.textContent = 'Pick an airport with a runway.'; return; }
      el.remove();
      start({ type, mode, end });
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ps]');
      if (e.target === el || (b && b.dataset.ps === 'no')) el.remove();
      else if (b && b.dataset.ps === 'go') go();
    });
    setTimeout(() => ap.select(), 0);
  }

  // P opens the dialog (in the game, not while flying: then P pauses)
  document.addEventListener('keydown', (e) => {
    if (s.active || e.ctrlKey || e.metaKey || e.altKey || e.key !== 'p' && e.key !== 'P') return;
    if (e.target.matches('input, select, textarea')) return;
    const startScreen = document.getElementById('start-screen');
    if (startScreen && !startScreen.hidden) return;
    openDialog();
  });

  FG.pilot = {
    get active() { return s.active; },
    get type() { return s.type; },
    get cam() { return s.cam; },
    get hideId() { return s.hideId; },
    get ready() { return s.active && !s.loading; },
    LOOK_DOWN,
    types: TYPES,
    open: openDialog, start, stop, step, pose,
    state: s, // (for debugging)
  };
})();
