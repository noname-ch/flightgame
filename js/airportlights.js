// Airport lights (looks only): where every light of an airport's runways stands, for the 3D view (view3d.js draws
// them as glowing points that stay in sight from far away). No open data says which runway end has which
// approach lights, so they go by the airport's size and the runway's length, as most real airports have them:
//   full    big airports' long runways (CAT II/III): 900 m of centre-line barrettes, crossbars at 150 m and 300 m,
//           red side rows over the last 270 m, sequenced flashers (the "rabbit") from 900 m in, touchdown zone and
//           centre-line lights on the runway
//   cat1    other airline airports (CAT I): 720 m of barrettes, a crossbar at 300 m, flashers on the outer part
//   simple  smaller paved runways: 420 m of short barrettes and a crossbar at 300 m
// Every paved runway long enough has edge lights (white, yellow over the last 600 m of instrument runways),
// green threshold and red end lights, and a PAPI left of each end (four lights: white above the glide path,
// red below; on it two of each). Control towers whose layout is in (FG.layouts.has) get a red obstruction light on
// the cab's roof and, at airline airports, the rotating airport beacon (white and green).
//
// FG.airportLights.of(code) -> { key, lights: [{ p: [lat, lon], c: [r, g, b], s, b, d, k, x, app }] }
//   s   glow size in metres; b brightness
//   d   heading the light shines towards (degrees), null for all round
//   k   0 steady, 1 sequenced flasher (x = its place in the sequence, 0 first .. 1 last), 2 PAPI (x = its angle),
//       3 rotating beacon (x = 0 its white lamp, 1 its green one, half a turn behind)
//   app [threshold lat, lon, metres out]: an approach light, stands level with the threshold where the ground falls
//   up  metres above the ground (on a tower)
// FG.airportLights.systems(code) -> per runway end its approach lights ('full', 'cat1', 'simple' or null).
(function () {
  const DEG = Math.PI / 180;
  const WHITE = [1, 0.93, 0.8];
  const YELLOW = [1, 0.75, 0.25];
  const GREEN = [0.25, 1, 0.45];
  const RED = [1, 0.12, 0.08];
  const FLASH = [0.85, 0.92, 1];

  // length, heading and a point `along` from the first end and `across` to its right (as view3d.js runwayFrame)
  function frame(r) {
    const kx = 111320 * Math.cos(r[0] * DEG);
    const dx = (r[3] - r[1]) * kx;
    const dy = (r[2] - r[0]) * 111320;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    return {
      len, width: Math.max(18, r[4] || 30), hdg: (Math.atan2(dx, dy) / DEG + 360) % 360,
      at: (along, across) => [r[0] + (uy * along - ux * across) / 111320, r[1] + (ux * along + uy * across) / kx],
    };
  }

  // The approach lights of a paved runway at an airport of `size` (G.airportSize).
  function system(len, size) {
    if ((size >= 5 && len >= 2500) || (size >= 4 && len >= 3000)) return 'full';
    if ((size >= 3 && len >= 1800) || (size >= 4 && len >= 1500) || (size >= 2 && len >= 2400)) return 'cat1';
    if ((size >= 2 && len >= 1400) || (size >= 1 && len >= 2000)) return 'simple';
    return null;
  }
  const edged = (len, size) => len >= 1000 || (len >= 800 && size >= 2);

  function runwayLights(r, size, out) {
    const f = frame(r);
    const { len, width: W } = f;
    if (!r[5] || !edged(len, size)) return [null, null];
    const sys = system(len, size);
    const add = (along, across, c, s, b, d, k = 0, x = 0, app = null) => out.push({ p: f.at(along, across), c, s, b, d, k, x, app });
    const back = (f.hdg + 180) % 360; // towards the first end's approach
    // Edge lights about every 60 m. On an instrument runway the last 600 m ahead of a landing plane are yellow:
    // those lights shine yellow one way and white the other.
    const n = Math.max(2, Math.round(len / 60));
    for (let i = 0; i <= n; i++) {
      const a = (len * i) / n;
      for (const s of [-1, 1]) {
        const across = s * (W / 2 + 1.5);
        if (sys && a > len - 600) { add(a, across, YELLOW, 2.6, 0.8, back); add(a, across, WHITE, 2.6, 0.8, f.hdg); }
        else if (sys && a < 600) { add(a, across, YELLOW, 2.6, 0.8, f.hdg); add(a, across, WHITE, 2.6, 0.8, back); }
        else add(a, across, WHITE, 2.6, 0.8, null);
      }
    }
    const ends = [];
    for (const end of [0, 1]) {
      const X = (x) => (end ? len - x : x); // metres in from this end
      const toApp = end ? f.hdg : back; // towards this end's approach
      const into = end ? back : f.hdg; // along the runway from this end
      const left = end ? 1 : -1; // `across` sign of the left side for a plane landing here
      // threshold (green, seen from the approach) and runway end (red, seen from the runway), across the whole width
      for (let c = -W / 2; c <= W / 2 + 0.1; c += Math.max(3, W / 14)) {
        add(X(-1), c, GREEN, 3.2, 1, toApp);
        add(X(-1), c, RED, 3, 0.9, into);
      }
      const thr = f.at(X(0), 0);
      const app = (m) => [thr[0], thr[1], m];
      const out2 = (m, across, c, s, b, k = 0, x = 0) => add(X(-m), across, c, s, b, toApp, k, x, app(m));
      const sysHere = sys;
      ends.push(sysHere);
      // PAPI: four lights left of the runway at the aiming point; the one nearest the runway is set highest
      if (len >= 1000) {
        const at = len >= 2400 ? 400 : 300;
        for (let i = 0; i < 4; i++) add(X(at), left * (W / 2 + 15 + i * 9), WHITE, 3.4, 1.2, toApp, 2, 3.5 - i / 3);
      }
      if (sysHere === 'full') {
        // touchdown zone: rows of three short bars either side of the centre line, 60 m apart over the first 900 m
        for (let a = 60; a <= Math.min(900, len / 2); a += 60) {
          for (const s of [-1, 1]) for (let j = 0; j < 3; j++) add(X(a), s * (W * 0.16 + j * 1.5), WHITE, 1.8, 0.6, toApp);
        }
      }
      if (sysHere === 'full' || (len >= 2400 && W >= 45)) {
        // centre line every 30 m (seen by a plane rolling towards this end: white, then red/white for 600 m, red for the last 300 m)
        // (and white the other way, for a plane rolling away from it)
        for (let a = 15; a < len / 2; a += 30) {
          const c = a < 300 ? RED : a < 900 ? (Math.round(a / 30) % 2 ? RED : WHITE) : WHITE;
          add(X(a), 0, c, 1.6, 0.55, into);
          add(X(a), 0, WHITE, 1.6, 0.55, toApp);
        }
      }
      if (!sysHere) continue;
      const far = sysHere === 'full' ? 900 : sysHere === 'cat1' ? 720 : 420;
      const step = sysHere === 'simple' ? 60 : 30;
      const bar = sysHere === 'simple' ? 1 : 2; // barrette half width (3 or 5 lights)
      for (let m = step; m <= far + 0.1; m += step) {
        for (let j = -bar; j <= bar; j++) out2(m, j, WHITE, 3.4, 1.1);
      }
      // crossbars
      const cross = sysHere === 'full' ? [[150, 7], [300, 15]] : sysHere === 'cat1' ? [[300, 15]] : [[300, 9]];
      for (const [m, half] of cross) {
        for (let c = bar + 1.5; c <= half + 0.1; c += 1.5) for (const s of [-1, 1]) out2(m, s * c, WHITE, 3.4, 1.1);
      }
      // red side rows over the last 270 m (CAT II/III)
      if (sysHere === 'full') {
        for (let m = 30; m <= 270; m += 30) for (const s of [-1, 1]) for (let j = 0; j < 3; j++) out2(m, s * (9 + j * 1.5), RED, 3, 1);
      }
      // the rabbit: flashers running in towards the runway twice a second
      const from = sysHere === 'full' ? 330 : sysHere === 'cat1' ? 450 : 0;
      if (from) {
        const fl = [];
        for (let m = far; m >= from - 0.1; m -= 30) fl.push(m);
        fl.forEach((m, i) => out2(m, 0, FLASH, 7, 2.2, 1, i / fl.length));
      }
    }
    return ends;
  }

  // The tops of the control towers' cabs: [lat, lon, metres up] (only where the airport's layout is in already:
  // asking for it here would read the layouts of every airport in sight).
  function towers(code) {
    if (!FG.layouts || !FG.layouts.has(code)) return [];
    const out = [];
    for (const b of FG.game.apronOf(code).buildings || []) {
      if (b.kind !== 'cab' || !b.ring || !b.ring.length) continue;
      const n = b.ring.length;
      out.push([b.ring.reduce((s, p) => s + p[0], 0) / n, b.ring.reduce((s, p) => s + p[1], 0) / n, b.h || 30]);
    }
    return out;
  }

  const cache = new Map();
  function of(code) {
    const G = FG.game;
    const rws = G.airportRunways(code);
    const size = G.airportSize(code);
    const tw = towers(code);
    const key = `${size}|${JSON.stringify(rws)}|${JSON.stringify(tw)}`;
    const hit = cache.get(code);
    if (hit && hit.key === key) return hit;
    const lights = [];
    const systems = [];
    for (const r of rws) systems.push(runwayLights(r, size, lights));
    tw.forEach(([lat, lon, h], i) => {
      lights.push({ p: [lat, lon], c: RED, s: 3, b: 1, d: null, k: 0, x: 0, app: null, up: h + 1 });
      if (i === 0 && size >= 2) {
        lights.push({ p: [lat, lon], c: WHITE, s: 9, b: 2.5, d: null, k: 3, x: 0, app: null, up: h + 2.5 });
        lights.push({ p: [lat, lon], c: GREEN, s: 9, b: 2.5, d: null, k: 3, x: 1, app: null, up: h + 2.5 });
      }
    });
    const res = { key, lights, systems };
    if (cache.size > 400) cache.clear();
    cache.set(code, res);
    return res;
  }

  FG.airportLights = { of, systems: (code) => of(code).systems, system };
})();
