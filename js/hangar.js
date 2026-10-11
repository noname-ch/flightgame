// Draws an aircraft (side view, real proportions from FG.data.looks) standing in a hangar.
// Types with a 3D model (FG.data.models) show a picture of that model instead of the drawing.
// FG.hangar.svg(type, variant) returns an SVG string; results are cached per type + variant.
(function () {
  const W = 640;
  const H = 300;
  const GROUND = 240;
  const RED = '#d52b1e';
  const cache = {};

  // ---------- small helpers ----------
  const f1 = (n) => Math.round(n * 10) / 10;

  // Builds the plane geometry in metres (x from the nose, y up from the ground).
  function build(look, belly) {
    const L = look.len;
    const d = look.dia;
    const eng = look.eng;
    const prop = eng === 'prop2' || eng === 'radial2' || eng === 'prop3';
    const concorde = eng === 'concorde';
    const yb = belly;
    const yt = yb + d;
    const nl = concorde ? 4.2 * d : look.double ? 1.3 * d : eng === 'prop3' ? 0.9 * d : prop ? 1.5 * d : 1.7 * d;
    const yn = yb + (concorde ? 0.25 : look.double ? 0.32 : 0.42) * d;
    const ts = concorde ? L * 0.9 : L - Math.max(2.3 * d, (prop ? 0.24 : 0.2) * L);

    // wing (root leading edge xw, chord c, tip position)
    const highWing = look.wing === 'high';
    let xw = eng === 'tail2' ? 0.43 * L : prop || eng === 'hw4' ? 0.4 * L : 0.36 * L;
    if (eng === 'radial2' || eng === 'prop3') xw = 0.3 * L;
    const c = prop || eng === 'hw4' ? 0.13 * L : 0.17 * L;
    const yw = highWing ? yt - 0.08 * d : yb + 0.18 * d;
    const swept = !prop && eng !== 'hw4';
    const xt = xw + (swept ? 0.27 * L : 0.05 * L);
    const ytip = yw + (highWing ? -0.05 * d : swept ? 0.38 * d : 0.15 * d);
    const ct = c * (swept ? 0.32 : 0.6);
    const wingAt = (f) => ({ x: xw + f * (xt - xw), y: yw + f * (ytip - yw), c: c + f * (ct - c) });

    // engines
    const engines = [];
    if (eng === 'uw2' || eng === 'uw4') {
      const De = (look.bigFan ? 0.56 : 0.48) * d * (eng === 'uw4' ? 0.82 : 1);
      const Le = 1.75 * De;
      const spots = eng === 'uw4' ? [0.66, 0.36] : [0.34];
      for (const f of spots) {
        const w = wingAt(f);
        engines.push({ kind: 'jet', x: w.x - 0.55 * Le, y: w.y - 0.5 * De - 0.1 * d, D: De, L: Le, wy: w.y, wx: w.x, far: f > 0.5 });
      }
    } else if (eng === 'hw4') {
      const De = 0.3 * d;
      const Le = 1.9 * De;
      for (const f of [0.5, 0.25]) {
        const w = wingAt(f);
        engines.push({ kind: 'jet', x: w.x - 0.45 * Le, y: w.y - 0.6 * De - 0.04 * d, D: De, L: Le, wy: w.y, wx: w.x, far: f > 0.4 });
      }
    } else if (eng === 'tail2') {
      const De = 0.42 * d;
      const Le = 2.5 * De;
      engines.push({ kind: 'jet', x: ts - 0.55 * Le, y: yt - 0.18 * d, D: De, L: Le, tail: true });
    } else if (prop) {
      const radial = eng !== 'prop2';
      const dn = (radial ? 0.5 : 0.34) * d;
      const ln = (radial ? 0.17 : 0.24) * L;
      const R = (radial ? 0.62 : 0.72) * d;
      const w = wingAt(0.3);
      const cy = highWing ? w.y - 0.3 * dn : w.y + (radial ? 0.15 : 0.45) * dn;
      engines.push({ kind: 'prop', x: w.x - (radial ? 0.55 : 0.4) * ln, y: cy, D: dn, L: ln, R, radial });
      if (eng === 'prop3') engines.push({ kind: 'prop', x: -0.06 * L, y: yb + 0.48 * d, D: 0.62 * d, L: 0.12 * L, R: 0.62 * d, radial: true, nose: true });
    } else if (concorde) {
      engines.push({ kind: 'concorde', x: 0.62 * L, y: yb - 0.12 * d, D: 0.5 * d, L: 0.3 * L });
    }

    // lowest point that must clear the ground
    let low = Infinity;
    for (const e of engines) low = Math.min(low, e.kind === 'prop' && !e.nose ? e.y - e.R : e.y - e.D / 2);
    return { L, d, yb, yt, yn, nl, ts, xw, c, yw, xt, ytip, ct, highWing, swept, engines, low, prop, concorde };
  }

  function geometry(look) {
    const prop = look.eng === 'prop2' || look.eng === 'radial2' || look.eng === 'prop3';
    let belly = look.eng === 'concorde' ? 1.15 * look.dia
      : prop ? (look.wing === 'high' ? 0.3 * look.dia + 0.25 : 0.4 * look.dia + 0.3)
        : 0.28 * look.dia + 0.7;
    let g = build(look, belly);
    const clear = look.tailwheel ? 0.15 : 0.45;
    if (g.low < clear) g = build(look, belly + clear - g.low);
    return g;
  }

  const finHeight = (look, g) => (g.concorde ? 1.35 : look.ttail ? 1.2 : g.prop ? 1.65 : 1.5) * g.d;

  // Screen scale (px per metre) that fits the length and the height `top` (m); bigger types come out a bit larger.
  function fitScale(L, top) {
    const sizeCue = 0.68 + 0.32 * Math.min(1, L / 72);
    return Math.min(560 / (L * 1.04), 190 / top) * sizeCue;
  }

  // ---------- picture of the 3D model (models/hangar/, made by tools/hangar_shots.html) ----------
  function photoSVG(look, file) {
    const g = geometry(look);
    const shot = FG.data.modelShot;
    const L = look.len;
    const s = fitScale(L, g.yt + finHeight(look, g) + (look.ttail ? 0.1 * g.d : 0));
    const w = shot.w * L * s;
    const h = shot.h * L * s;
    // The lowest wheel stands a little in front of the floor edge.
    const y = GROUND + (0.012 + shot.ground) * L * s - h;
    return { svg: `<image href="models/hangar/${file}.webp" x="${f1((W - w) / 2)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}"/>`, s, L };
  }

  // ---------- plane drawing (returns SVG in screen units) ----------
  function planeSVG(look, uid) {
    const g = geometry(look);
    const { L, d, yb, yt, yn, nl, ts } = g;

    // fin
    const ttail = !!look.ttail;
    const finBase = g.concorde ? 0.19 * L : g.prop ? 0.21 * L : 0.18 * L;
    const finH = finHeight(look, g);
    const sweep = finH * (g.concorde ? 1.25 : g.prop ? 0.6 : 0.85);
    const xf0 = L - finBase - 0.01 * L;
    const topChord = finBase * (ttail ? 0.5 : g.concorde ? 0.12 : 0.38);
    const finTop = yt + finH;

    // overall extent → scale
    const hump = look.hump ? yt + 0.36 * d : yt;
    const top = Math.max(finTop + (ttail ? 0.1 * d : 0), hump);
    const s = fitScale(L, top);
    const x0 = (W - L * s) / 2 + 0.03 * L * s;
    const X = (x) => f1(x0 + x * s);
    const Y = (y) => f1(GROUND - y * s);
    const P = (pts) => pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
    const M = (m) => f1(m * s);

    let out = '';
    const fuseFill = look.corrugated ? `url(#${uid}-alu)` : `url(#${uid}-body)`;

    // fuselage outline (nose left)
    const fus = `M${X(0)},${Y(yn)}
      C${X(0)},${Y(yn + 0.4 * d)} ${X(nl * 0.45)},${Y(yt)} ${X(nl)},${Y(yt)}
      L${X(ts)},${Y(yt)}
      C${X(ts + 0.55 * (L - ts))},${Y(yt)} ${X(L - 0.05 * (L - ts))},${Y(yt - 0.08 * d)} ${X(L)},${Y(yt - 0.14 * d)}
      L${X(L)},${Y(yt - 0.34 * d)}
      C${X(L - 0.35 * (L - ts))},${Y(yb + 0.3 * d)} ${X(ts + 0.25 * (L - ts))},${Y(yb)} ${X(ts)},${Y(yb)}
      L${X(nl * 0.75)},${Y(yb)}
      C${X(nl * 0.25)},${Y(yb)} ${X(0)},${Y(yn - 0.22 * d)} ${X(0)},${Y(yn)} Z`;
    let humpPath = '';
    let hx = 0;
    if (look.hump) {
      hx = look.hump * L;
      const hy = yt + 0.36 * d;
      humpPath = `M${X(nl * 0.3)},${Y(yt - 0.25 * d)}
        C${X(nl * 0.45)},${Y(hy)} ${X(nl * 0.9)},${Y(hy)} ${X(nl * 1.3)},${Y(hy)}
        L${X(hx)},${Y(hy)}
        C${X(hx + 0.07 * L)},${Y(hy)} ${X(hx + 0.09 * L)},${Y(yt)} ${X(hx + 0.13 * L)},${Y(yt)}
        L${X(nl * 0.3)},${Y(yt)} Z`;
    }

    // vertical fin (behind the fuselage)
    const finPts = [[xf0, yt - 0.1 * d], [xf0 + sweep, finTop], [xf0 + sweep + topChord, finTop],
      [L - 0.005 * L, yt - 0.2 * d]];
    out += `<polygon points="${P(finPts)}" fill="${RED}"/>`;
    // rudder line + Swiss-style cross
    const rx = xf0 + sweep + topChord * 0.55;
    out += `<line x1="${X(rx)}" y1="${Y(finTop)}" x2="${X(rx + (L - rx) * 0.15)}" y2="${Y(yt)}" stroke="#000" stroke-opacity=".18" stroke-width="${Math.max(0.6, M(0.05))}"/>`;
    const cx = xf0 + sweep * 0.55 + topChord * 0.3 + (finBase - topChord) * 0.18;
    const cy = yt + finH * 0.5;
    const cs = finH * 0.13;
    out += `<path d="M${X(cx - cs * 0.33)},${Y(cy + cs)}h${M(cs * 0.66)}v${M(cs * 0.67)}h${M(cs * 0.67)}v${M(cs * 0.66)}h${-M(cs * 0.67)}v${M(cs * 0.67)}h${-M(cs * 0.66)}v${-M(cs * 0.67)}h${-M(cs * 0.67)}v${-M(cs * 0.66)}h${M(cs * 0.67)}z" fill="#fff"/>`;

    // far engine(s) on 4-engine jets sit behind the wing
    const engSVG = (e) => engine(e, g, X, Y, M, uid);
    for (const e of g.engines) if (e.far) out += engSVG(e);

    // fuselage + hump
    if (humpPath) out += `<path d="${humpPath}" fill="${fuseFill}"/>`;
    out += `<path d="${fus}" fill="${fuseFill}"/>`;

    // livery inside the fuselage
    out += `<clipPath id="${uid}-clip"><path d="${fus}"/>${humpPath ? `<path d="${humpPath}"/>` : ''}</clipPath><g clip-path="url(#${uid}-clip)">`;
    out += `<rect x="${X(0)}" y="${Y(yb + 0.3 * d)}" width="${M(L)}" height="${M(0.3 * d)}" fill="#9aa3ae" opacity=".55"/>`;
    out += `<rect x="${X(nl * 0.35)}" y="${Y(yb + 0.42 * d)}" width="${M(L)}" height="${M(0.07 * d)}" fill="${RED}"/>`;
    if (look.corrugated) {
      for (let y = yb + 0.08 * d; y < yt + 0.2 * d; y += 0.11 * d) {
        out += `<line x1="${X(0)}" y1="${Y(y)}" x2="${X(L)}" y2="${Y(y)}" stroke="#000" stroke-opacity=".12" stroke-width="${Math.max(0.5, M(0.03))}"/>`;
      }
    }
    // windows: a dashed line with round caps = a row of round windows
    const winR = Math.max(0.15, 0.045 * d);
    const pitch = Math.max(0.55, winR * 3.6);
    const row = (xa, xb, y) => `<line x1="${X(xa)}" y1="${Y(y)}" x2="${X(xb)}" y2="${Y(y)}" stroke="#1b2430" stroke-width="${M(winR * 2)}" stroke-linecap="round" stroke-dasharray="0.01 ${M(pitch)}"/>`;
    const wy = yb + (g.concorde ? 0.62 : 0.62) * d;
    if (look.double) {
      out += row(nl * 1.1, ts - 0.2 * d, yb + 0.32 * d);
      out += row(nl * 1.25, ts - 0.4 * d, yb + 0.68 * d);
    } else {
      out += row(nl + 1.0, ts - 0.25 * d, wy);
    }
    if (look.hump) out += row(nl * 1.15, hx - 0.3, yt + 0.16 * d);
    // doors
    const doorH = Math.min(1.9, 0.62 * d);
    const doorW = Math.min(0.85, 0.3 * d);
    const door = (x, y0) => `<rect x="${X(x)}" y="${Y(y0 + doorH)}" width="${M(doorW)}" height="${M(doorH)}" rx="${M(0.12)}" fill="none" stroke="#5b6573" stroke-opacity=".7" stroke-width="${Math.max(0.5, M(0.05))}"/>`;
    const doorY = look.double ? yb + 0.14 * d : yb + 0.2 * d;
    out += door(nl * 0.95, doorY) + door(ts - doorW - 0.6, doorY);
    // company name
    const fs = Math.max(3, M(0.19 * d));
    const nameY = look.double ? yb + 0.88 * d : yb + 0.88 * d;
    const nameX = g.prop && g.highWing ? L * 0.55 : L * 0.3; // keep clear of high-wing props
    out += `<text x="${X(nameX)}" y="${Y(nameY)}" font-family="system-ui,sans-serif" font-weight="800" font-size="${fs}" letter-spacing="${f1(fs * 0.12)}" fill="${RED}">BERN AIR</text>`;
    out += `</g>`;

    // cockpit windows
    const cOff = look.hump ? 0.36 * d : 0;
    const cX = look.hump ? nl * 0.42 : 0;
    const ck = g.concorde
      ? [[nl * 0.55, yb + 0.66 * d], [nl * 0.68, yt - 0.12 * d], [nl * 0.8, yt - 0.08 * d], [nl * 0.8, yb + 0.68 * d]]
      : [[cX + nl * 0.4, yb + 0.64 * d + cOff], [cX + nl * 0.55, yt - 0.14 * d + cOff], [cX + nl * 0.86, yt - 0.1 * d + cOff], [cX + nl * 0.86, yb + 0.66 * d + cOff]];
    out += `<polygon points="${P(ck)}" fill="#1b2430"/>`;

    // horizontal stabiliser
    if (!g.concorde) {
      let st;
      if (ttail) {
        const sx = xf0 + sweep - 0.03 * L;
        st = [[sx, finTop + 0.02 * d], [sx + 0.07 * L, finTop + 0.1 * d], [sx + 0.07 * L + 0.05 * L, finTop + 0.1 * d], [sx + topChord + 0.01 * L, finTop - 0.03 * d], [sx + 0.02 * L, finTop - 0.04 * d]];
        out += `<polygon points="${P(st)}" fill="#e6e9ee"/>`;
      } else {
        const sy = yt - 0.35 * d;
        st = [[L - 0.18 * L, sy + 0.03 * d], [L - 0.08 * L, sy + 0.22 * d], [L - 0.025 * L, sy + 0.22 * d], [L - 0.045 * L, sy - 0.04 * d], [L - 0.15 * L, sy - 0.05 * d]];
        out += `<polygon points="${P(st)}" fill="#e6e9ee" stroke="#000" stroke-opacity=".1" stroke-width=".5"/>`;
      }
    }

    // wing-to-body fairing
    if (!g.highWing && !g.prop && !g.concorde) {
      out += `<ellipse cx="${X(g.xw + g.c * 0.55)}" cy="${Y(yb + 0.1 * d)}" rx="${M(g.c * 0.75)}" ry="${M(0.17 * d)}" fill="#cfd5dc"/>`;
    }

    // near wing
    if (g.concorde) {
      const wpts = [[0.3 * L, yb + 0.16 * d], [0.95 * L, yb + 0.34 * d], [0.95 * L, yb + 0.05 * d], [0.55 * L, yb - 0.02 * d]];
      out += `<polygon points="${P(wpts)}" fill="#c3c9d1"/>`;
    } else {
      const th = g.c * 0.07;
      const wpts = [[g.xw, g.yw + th], [g.xt, g.ytip + th * 0.4], [g.xt + g.ct, g.ytip], [g.xw + g.c, g.yw - th * 0.2], [g.xw + g.c * 0.3, g.yw - th]];
      out += `<polygon points="${P(wpts)}" fill="#bcc3cc" stroke="#7d8794" stroke-opacity=".5" stroke-width=".6"/>`;
      if (look.winglet) {
        const wh = 0.45 * d;
        out += `<polygon points="${P([[g.xt + g.ct * 0.1, g.ytip], [g.xt + g.ct * 0.75, g.ytip + wh], [g.xt + g.ct * 1.05, g.ytip + wh], [g.xt + g.ct, g.ytip]])}" fill="${RED}"/>`;
      }
    }

    // near engines
    for (const e of g.engines) if (!e.far) out += engSVG(e);

    // landing gear
    out += gear(look, g, X, Y, M);

    // tail-draggers sit nose-up on the tail wheel
    let tilt = 0;
    if (look.tailwheel) {
      const xm = g.xw + g.c * 0.15;
      tilt = Math.atan2(yb + 0.1 * d - 0.35, 0.9 * L - xm) * 180 / Math.PI;
      return { svg: `<g transform="rotate(${f1(tilt)} ${X(xm)} ${GROUND})">${out}</g>`, s, L };
    }
    return { svg: out, s, L };
  }

  function engine(e, g, X, Y, M, uid) {
    const shade = e.far ? ' opacity=".82"' : '';
    if (e.kind === 'jet') {
      const r = e.D / 2;
      let h = '';
      if (!e.tail) { // pylon up to the wing
        h += `<polygon points="${X(e.x + e.L * 0.35)},${Y(e.y + r * 0.6)} ${X(e.wx + g.c * 0.45)},${Y(e.wy)} ${X(e.wx + g.c * 0.1)},${Y(e.wy)} ${X(e.x + e.L * 0.25)},${Y(e.y + r * 0.6)}" fill="#c9cfd7"${shade}/>`;
      }
      h += `<path d="M${X(e.x + 0.06 * e.L)},${Y(e.y + r)} L${X(e.x + 0.78 * e.L)},${Y(e.y + r * 0.8)} L${X(e.x + e.L)},${Y(e.y + r * 0.2)}
        L${X(e.x + e.L)},${Y(e.y - r * 0.15)} L${X(e.x + 0.78 * e.L)},${Y(e.y - r * 0.75)} L${X(e.x + 0.06 * e.L)},${Y(e.y - r)} Z" fill="url(#${uid}-nac)" stroke="#5b6573" stroke-opacity=".45" stroke-width=".7"${shade}/>`;
      h += `<ellipse cx="${X(e.x + 0.06 * e.L)}" cy="${Y(e.y)}" rx="${M(0.1 * e.D)}" ry="${M(r)}" fill="#3a434f"${shade}/>`;
      h += `<ellipse cx="${X(e.x + 0.06 * e.L)}" cy="${Y(e.y)}" rx="${M(0.05 * e.D)}" ry="${M(r * 0.82)}" fill="#11161d"${shade}/>`;
      h += `<rect x="${X(e.x + 0.3 * e.L)}" y="${Y(e.y + r * 0.92)}" width="${M(0.25 * e.L)}" height="${M(0.12 * e.D)}" fill="${RED}"${shade}/>`;
      return h;
    }
    if (e.kind === 'prop') {
      const r = e.D / 2;
      let h = `<path d="M${X(e.x)},${Y(e.y + r * 0.9)} C${X(e.x + e.L * 0.3)},${Y(e.y + r * 1.05)} ${X(e.x + e.L * 0.7)},${Y(e.y + r)} ${X(e.x + e.L)},${Y(e.y + r * 0.3)}
        L${X(e.x + e.L)},${Y(e.y - r * 0.2)} C${X(e.x + e.L * 0.6)},${Y(e.y - r)} ${X(e.x + e.L * 0.3)},${Y(e.y - r)} ${X(e.x)},${Y(e.y - r * 0.9)} Z" fill="url(#${uid}-nac)" stroke="#5b6573" stroke-opacity=".55" stroke-width=".8"/>`;
      if (e.radial) h += `<ellipse cx="${X(e.x + 0.02 * e.L)}" cy="${Y(e.y)}" rx="${M(0.1 * e.D)}" ry="${M(r * 0.95)}" fill="#4b5563"/>`;
      const px = e.x - 0.1 * e.D;
      h += `<ellipse cx="${X(px)}" cy="${Y(e.y)}" rx="${M(0.07 * e.R)}" ry="${M(e.R)}" fill="url(#${uid}-disc)"/>`;
      h += `<path d="M${X(px)},${Y(e.y)} L${X(px - 0.03 * e.R)},${Y(e.y + e.R * 0.97)} L${X(px + 0.03 * e.R)},${Y(e.y + e.R * 0.97)} Z M${X(px)},${Y(e.y)} L${X(px - 0.03 * e.R)},${Y(e.y - e.R * 0.97)} L${X(px + 0.03 * e.R)},${Y(e.y - e.R * 0.97)} Z" fill="#20262e"/>`;
      h += `<path d="M${X(px - 0.32 * e.D)},${Y(e.y)} Q${X(px - 0.05 * e.D)},${Y(e.y + r * 0.75)} ${X(e.x + 0.02 * e.D)},${Y(e.y + r * 0.7)} L${X(e.x + 0.02 * e.D)},${Y(e.y - r * 0.7)} Q${X(px - 0.05 * e.D)},${Y(e.y - r * 0.75)} ${X(px - 0.32 * e.D)},${Y(e.y)} Z" fill="${RED}"/>`;
      return h;
    }
    // Concorde: paired engine box under the wing
    const t = e.y + e.D / 2;
    const b = e.y - e.D / 2;
    return `<polygon points="${X(e.x)},${Y(t)} ${X(e.x + e.L)},${Y(t + 0.05 * g.d)} ${X(e.x + e.L)},${Y(b + 0.1 * g.d)} ${X(e.x + 0.06 * e.L)},${Y(b)}" fill="url(#${uid}-nac)"/>
      <polygon points="${X(e.x + e.L)},${Y(t + 0.03 * g.d)} ${X(e.x + e.L * 1.06)},${Y(e.y + 0.05 * g.d)} ${X(e.x + e.L)},${Y(b + 0.12 * g.d)}" fill="#4b5563"/>`;
  }

  function gear(look, g, X, Y, M) {
    const { L, d, yb } = g;
    const r = 0.08 * d + 0.24;
    const strut = Math.max(1.2, M(0.06 * d + 0.08));
    let h = '';
    const wheel = (x) => `<circle cx="${X(x)}" cy="${Y(r)}" r="${M(r)}" fill="#151a20"/><circle cx="${X(x)}" cy="${Y(r)}" r="${M(r * 0.45)}" fill="#8b949f"/>`;
    const leg = (x, yTop) => `<line x1="${X(x)}" y1="${Y(yTop)}" x2="${X(x)}" y2="${Y(r)}" stroke="#7b8592" stroke-width="${strut}"/>`;
    if (look.tailwheel) {
      const xm = g.xw + g.c * 0.15;
      h += leg(xm, g.yw) + wheel(xm);
      const xtw = 0.9 * L;
      h += leg(xtw, yb + 0.15 * d) + `<circle cx="${X(xtw)}" cy="${Y(r * 0.45)}" r="${M(r * 0.45)}" fill="#151a20"/>`;
      return h;
    }
    const xn = g.concorde ? 0.2 * L : Math.max(g.nl * 0.75, 0.11 * L);
    h += leg(xn, yb + 0.05 * d) + wheel(xn);
    const n = look.gear || 1;
    const xm = g.highWing || g.prop ? g.xw + g.c * 0.45 : g.xw + g.c * 0.72;
    for (let i = 0; i < n; i++) {
      const x = xm + (i - (n - 1) / 2) * 2.3 * r;
      h += wheel(x);
    }
    h += leg(xm, g.highWing ? yb + 0.05 * d : g.yw);
    if (n > 1) h += `<line x1="${X(xm - (n - 1) * 1.15 * r)}" y1="${Y(r)}" x2="${X(xm + (n - 1) * 1.15 * r)}" y2="${Y(r)}" stroke="#7b8592" stroke-width="${strut}"/>`;
    if (g.highWing && !look.fixed) { // sponson for the main gear
      h += `<ellipse cx="${X(xm)}" cy="${Y(yb + 0.08 * d)}" rx="${M(g.c * 0.6)}" ry="${M(0.16 * d)}" fill="#cfd5dc"/>`;
    }
    return h;
  }

  // ---------- hangar scene ----------
  function scene(uid, plane, s, L) {
    const lamps = [80, 200, 320, 440, 560];
    let h = `<defs>
      <linearGradient id="${uid}-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2532"/><stop offset="1" stop-color="#0c1118"/></linearGradient>
      <linearGradient id="${uid}-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d3540"/><stop offset="1" stop-color="#12161c"/></linearGradient>
      <linearGradient id="${uid}-cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6dc" stop-opacity=".16"/><stop offset="1" stop-color="#fff6dc" stop-opacity="0"/></linearGradient>
      <radialGradient id="${uid}-spot"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <radialGradient id="${uid}-lamp"><stop offset="0" stop-color="#fffbe8"/><stop offset=".3" stop-color="#ffe9a8" stop-opacity=".6"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient>
      <linearGradient id="${uid}-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#eef1f4"/><stop offset="1" stop-color="#b9c0c9"/></linearGradient>
      <linearGradient id="${uid}-alu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3e7eb"/><stop offset=".55" stop-color="#bfc6ce"/><stop offset="1" stop-color="#8e98a3"/></linearGradient>
      <linearGradient id="${uid}-nac" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#dfe3e8"/><stop offset="1" stop-color="#9aa3ae"/></linearGradient>
      <linearGradient id="${uid}-disc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#cbd5e1" stop-opacity=".05"/><stop offset=".5" stop-color="#cbd5e1" stop-opacity=".35"/><stop offset="1" stop-color="#cbd5e1" stop-opacity=".05"/></linearGradient>
      <linearGradient id="${uid}-fade" x1="0" y1="${GROUND}" x2="0" y2="${GROUND + 55}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <mask id="${uid}-mask"><rect x="0" y="${GROUND}" width="${W}" height="${H - GROUND}" fill="url(#${uid}-fade)"/></mask>
      <filter id="${uid}-blur" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="5"/></filter>
    </defs>`;
    // walls, door panels, trusses
    h += `<rect width="${W}" height="${H}" fill="url(#${uid}-wall)"/>`;
    h += `<rect x="70" y="52" width="500" height="${GROUND - 52}" fill="#8aa0bf" opacity=".06"/>`;
    for (let x = 70; x <= 570; x += 50) h += `<line x1="${x}" y1="52" x2="${x}" y2="${GROUND}" stroke="#fff" stroke-opacity=".05"/>`;
    h += `<line x1="70" y1="52" x2="570" y2="52" stroke="#fff" stroke-opacity=".12" stroke-width="2"/>`;
    let truss = 'M0,40';
    for (let x = 0; x <= W; x += 40) truss += ` L${x + 20},14 L${x + 40},40`;
    h += `<path d="${truss}" fill="none" stroke="#c8d2e0" stroke-opacity=".14" stroke-width="1.5"/>`;
    h += `<line x1="0" y1="14" x2="${W}" y2="14" stroke="#c8d2e0" stroke-opacity=".14" stroke-width="2"/><line x1="0" y1="40" x2="${W}" y2="40" stroke="#c8d2e0" stroke-opacity=".14" stroke-width="2"/>`;
    h += `<text x="84" y="74" font-family="system-ui,sans-serif" font-size="11" font-weight="700" letter-spacing="3" fill="#fff" fill-opacity=".18">BERN AIR &#183; HANGAR 1</text>`;
    // light cones + lamps
    for (const x of lamps) {
      h += `<polygon points="${x - 6},44 ${x + 6},44 ${x + 70},${GROUND} ${x - 70},${GROUND}" fill="url(#${uid}-cone)"/>`;
    }
    // floor
    h += `<rect y="${GROUND}" width="${W}" height="${H - GROUND}" fill="url(#${uid}-floor)"/>`;
    for (let i = -8; i <= 8; i++) {
      h += `<line x1="${320 + i * 30}" y1="${GROUND}" x2="${320 + i * 95}" y2="${H}" stroke="#fff" stroke-opacity=".04"/>`;
    }
    h += `<line x1="0" y1="${GROUND + 28}" x2="${W}" y2="${GROUND + 28}" stroke="#facc15" stroke-opacity=".45" stroke-width="2"/>`;
    h += `<ellipse cx="320" cy="${GROUND + 8}" rx="300" ry="34" fill="url(#${uid}-spot)"/>`;
    for (const x of lamps) h += `<circle cx="${x}" cy="44" r="14" fill="url(#${uid}-lamp)"/><rect x="${x - 7}" y="40" width="14" height="4" rx="1" fill="#e5e7eb"/>`;
    // shadow, reflection, plane
    h += `<ellipse cx="320" cy="${GROUND + 2}" rx="${f1(L * s * 0.46)}" ry="5" fill="#000" opacity=".55" filter="url(#${uid}-blur)"/>`;
    h += `<g id="${uid}-plane">${plane}</g>`;
    h += `<use href="#${uid}-plane" transform="translate(0 ${2 * GROUND}) scale(1 -1)" mask="url(#${uid}-mask)"/>`;
    return h;
  }

  function svg(type, variant = 'tile') {
    const key = `${type}|${variant}`;
    if (cache[key]) return cache[key];
    const look = FG.data.looks[type] || { len: 37, dia: 4, eng: 'uw2' };
    const uid = `hg-${variant}-${type}`.replace(/[^a-zA-Z0-9-]/g, '_');
    const file = FG.data.models && FG.data.models[type];
    const p = file ? photoSVG(look, file) : planeSVG(look, uid);
    cache[key] = `<svg class="hangar-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${FG.data.aircraft[type].name} in the hangar">${scene(uid, p.svg, p.s, p.L)}</svg>`;
    return cache[key];
  }

  FG.hangar = { svg };
})();
