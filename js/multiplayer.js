// Multiplayer (FG.mp): play in one world with friends, live. One player opens a room for their game and gets a
// code; the others join with it and start an airline of their own in that world. Every airline is a rival of the
// others (passengers split on shared routes, slots held, planes on the map); the host's clock sets the time and the
// speed for everyone. The protocol (MULTIPLAYER.md) is the same in the desktop game (github.com/lianhirter-arch/
// flightgame-rust), so browser and desktop players can share a room.
//
// No server of our own: messages go through public MQTT brokers over WebSocket (C.multiplayer.brokers). Each
// message is encrypted with AES-GCM under a key made from the room code (PBKDF2), and the topic is a hash of the
// code, so the brokers see neither the code nor the game.
(function () {
  const G = FG.game;
  const D = FG.data;
  const MC = () => FG.config.multiplayer;
  const PROTO = 1;
  const SALT = 'flightgame-mp-v1';
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // (no I, L, O, 0, 1: easy to read out)
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (msg, bad) => FG.ui && FG.ui.toast && FG.ui.toast(msg, bad);

  // ---------- a small MQTT 3.1.1 client over WebSocket (QoS 0 only: what the game needs) ----------
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  function mqttString(s) {
    const b = enc.encode(s);
    return [b.length >> 8, b.length & 255, ...b];
  }
  function mqttPacket(type, body) {
    const len = [];
    let n = body.length;
    do { let x = n % 128; n = Math.floor(n / 128); if (n > 0) x |= 128; len.push(x); } while (n > 0);
    const out = new Uint8Array(1 + len.length + body.length);
    out[0] = type;
    out.set(len, 1);
    out.set(body, 1 + len.length);
    return out;
  }

  class Broker {
    constructor(url, clientId, onMessage, onChange) {
      Object.assign(this, { url, clientId, onMessage, onChange });
      this.topics = new Set();
      this.ready = false;
      this.closed = false;
      this.buf = new Uint8Array(0);
      this.retry = 1000;
      this.open();
    }
    open() {
      if (this.closed) return;
      let ws;
      try { ws = new WebSocket(this.url, 'mqtt'); } catch (e) { this.later(); return; }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        const id = mqttString(this.clientId);
        // CONNECT: protocol "MQTT" level 4, clean session, keep alive 30 s
        this.send(mqttPacket(0x10, [...mqttString('MQTT'), 4, 0x02, 0, 30, ...id]));
      };
      ws.onmessage = (e) => this.data(new Uint8Array(e.data));
      ws.onclose = () => { this.down(); this.later(); };
      ws.onerror = () => { /* onclose follows */ };
    }
    later() {
      if (this.closed) return;
      clearTimeout(this.again);
      this.again = setTimeout(() => this.open(), this.retry);
      this.retry = Math.min(30000, this.retry * 2);
    }
    down() {
      clearInterval(this.ping);
      if (this.ready) { this.ready = false; this.onChange(); }
    }
    send(bytes) { if (this.ws && this.ws.readyState === 1) this.ws.send(bytes); }
    data(bytes) {
      const b = new Uint8Array(this.buf.length + bytes.length);
      b.set(this.buf);
      b.set(bytes, this.buf.length);
      let at = 0;
      for (;;) {
        if (b.length - at < 2) break;
        let len = 0, mul = 1, i = at + 1;
        for (; i < b.length; i++) {
          len += (b[i] & 127) * mul;
          mul *= 128;
          if (!(b[i] & 128)) break;
        }
        if (i >= b.length || b.length < i + 1 + len) break;
        this.packet(b[at], b.subarray(i + 1, i + 1 + len));
        at = i + 1 + len;
      }
      this.buf = b.slice(at);
    }
    packet(head, body) {
      const type = head >> 4;
      if (type === 2) { // CONNACK
        if (body[1] !== 0) { this.ws.close(); return; }
        this.ready = true;
        this.retry = 1000;
        for (const t of this.topics) this.subscribeNow(t);
        clearInterval(this.ping);
        this.ping = setInterval(() => this.send(new Uint8Array([0xc0, 0])), 20000);
        this.onChange();
      } else if (type === 3) { // PUBLISH
        const tl = (body[0] << 8) | body[1];
        const topic = dec.decode(body.subarray(2, 2 + tl));
        const qos = (head >> 1) & 3;
        this.onMessage(topic, body.slice(2 + tl + (qos ? 2 : 0)));
      }
    }
    subscribe(topic) {
      this.topics.add(topic);
      if (this.ready) this.subscribeNow(topic);
    }
    subscribeNow(topic) { this.send(mqttPacket(0x82, [0, 1, ...mqttString(topic), 0])); }
    publish(topic, payload) {
      if (!this.ready) return false;
      const t = mqttString(topic);
      const body = new Uint8Array(t.length + payload.length);
      body.set(t);
      body.set(payload, t.length);
      this.send(mqttPacket(0x30, body));
      return true;
    }
    close() {
      this.closed = true;
      clearTimeout(this.again);
      this.down();
      if (this.ws) {
        this.send(new Uint8Array([0xe0, 0])); // DISCONNECT
        try { this.ws.close(); } catch (e) { /* gone */ }
      }
    }
  }

  // ---------- the room: code, key, topic ----------
  const hex = (bytes) => [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
  function newCode() {
    const r = crypto.getRandomValues(new Uint8Array(6));
    return [...r].map((x) => ALPHABET[x % ALPHABET.length]).join('');
  }
  const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const showCode = (c) => `${c.slice(0, 3)}-${c.slice(3)}`;
  async function roomKeys(code) {
    const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode(SALT), iterations: 100000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${SALT} topic ${code}`)));
    return { key, topic: `flightgame/v1/${hex(h).slice(0, 32)}` };
  }

  // ---------- state ----------
  const mp = {
    role: null,      // 'host' | 'guest' | null
    code: '',
    id: hex(crypto.getRandomValues(new Uint8Array(4))),
    seq: 0,
    brokers: [],
    keys: null,
    players: new Map(), // id -> { id, name, color, client, seen, airline, host }
    seen: new Set(),    // 'from:seq' of the messages had (each comes once from every broker)
    seenOrder: [],
    chat: [],
    room: null,      // a guest: the host's last room message, and when it came (performance.now)
    roomAt: 0,
    open: false,     // the window
    closed: '',      // a guest whose host closed the room: why
    timers: [],
    sentSig: '',
    joinWait: null,
  };

  function connect(code) {
    for (const b of mp.brokers) b.close();
    mp.brokers = MC().brokers.map((url) => new Broker(url, `fg-${mp.id}-${Math.random().toString(36).slice(2, 8)}`, onRaw, render));
    for (const b of mp.brokers) b.subscribe(mp.keys.topic);
    mp.code = code;
  }

  async function send(k, body = {}) {
    if (!mp.keys) return;
    const { key, topic } = mp.keys;
    const brokers = mp.brokers; // (a bye still goes out after leave() let go of them)
    const msg = { v: PROTO, k, from: mp.id, seq: ++mp.seq, ...body };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(msg))));
    const out = new Uint8Array(12 + data.length);
    out.set(iv);
    out.set(data, 12);
    for (const b of brokers) b.publish(topic, out);
  }

  async function onRaw(topic, payload) {
    if (!mp.keys || topic !== mp.keys.topic || payload.length < 29) return;
    let msg;
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.subarray(0, 12) }, mp.keys.key, payload.subarray(12));
      msg = JSON.parse(dec.decode(plain));
    } catch (e) {
      return; // (not ours, or broken)
    }
    if (!msg || msg.v !== PROTO || typeof msg.from !== 'string' || msg.from === mp.id) return;
    const tag = `${msg.from}:${msg.seq}`;
    if (mp.seen.has(tag)) return;
    mp.seen.add(tag);
    mp.seenOrder.push(tag);
    if (mp.seenOrder.length > 2000) mp.seen.delete(mp.seenOrder.shift());
    handle(msg);
  }

  // ---------- what comes in ----------
  const cleanName = (s) => String(s || '').replace(/[<>&"'`]/g, '').trim().slice(0, 40) || 'Airline';
  const cleanColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#64748b');
  // An airline as sent (G.mpAirline), checked: only airports and aircraft this game knows, numbers as numbers.
  function cleanAirline(a) {
    if (!a || typeof a !== 'object') return null;
    const ap = (c) => typeof c === 'string' && G.airportByCode[c];
    const num = (x, lo, hi) => (Number.isFinite(+x) ? Math.min(hi, Math.max(lo, +x)) : lo);
    const routes = (Array.isArray(a.routes) ? a.routes : []).slice(0, 2000)
      .filter((r) => r && ap(r.a) && ap(r.b) && r.a !== r.b && D.aircraft[r.type])
      .map((r) => ({ a: r.a, b: r.b, type: r.type, perDay: num(r.perDay, 1, 200), seats: num(r.seats, 1, 1000), fare: num(r.fare, 0.3, 3) }));
    const slots = {};
    for (const [c, n] of Object.entries(a.slots && typeof a.slots === 'object' ? a.slots : {})) if (ap(c)) slots[c] = Math.round(num(n, 0, 500));
    const flights = (Array.isArray(a.flights) ? a.flights : []).slice(0, 2000)
      .filter((f) => f && ap(f.from) && ap(f.to) && D.aircraft[f.type] && Number.isFinite(+f.dep) && Number.isFinite(+f.arr) && +f.arr > +f.dep)
      .map((f) => ({ type: f.type, from: f.from, to: f.to, dep: +f.dep, arr: +f.arr }));
    return { name: cleanName(a.name), home: ap(a.home) ? a.home : null, money: num(a.money, -1e12, 1e13),
      planes: Math.round(num(a.planes, 0, 100000)), routes, slots, flights };
  }

  function player(id) {
    let p = mp.players.get(id);
    if (!p) {
      p = { id, name: 'Airline', color: '#64748b', client: 'web', seen: 0, airline: null };
      mp.players.set(id, p);
    }
    p.seen = performance.now();
    return p;
  }

  function handle(m) {
    if (mp.role === 'host') {
      if (m.k === 'hello' && m.look && !mp.players.has(m.from)) { sendRoom(); return; } // (only looking at the room)
      if (m.k === 'hello' || m.k === 'airline' || m.k === 'chat') {
        const known = mp.players.has(m.from);
        const p = player(m.from);
        if (!known) {
          if (mp.players.size > MC().colors.length - 1) { mp.players.delete(m.from); send('full', { to: m.from }); return; }
          p.color = freeColor();
        }
        if (m.k === 'hello') {
          p.name = cleanName(m.name);
          p.client = m.client === 'desktop' ? 'desktop' : 'web';
          if (!known) { say(`👋 ${p.name} joined the room.`); }
          sendRoom();
        }
      }
    }
    if (m.k === 'room' && mp.role === 'guest') {
      if (m.proto !== PROTO) return;
      mp.room = m;
      mp.roomAt = performance.now();
      const was = new Set(mp.players.keys());
      for (const x of Array.isArray(m.players) ? m.players : []) {
        if (x.id === mp.id) { mp.myColor = cleanColor(x.color); continue; }
        const p = mp.players.get(x.id) || { id: x.id, seen: performance.now(), airline: null };
        Object.assign(p, { name: cleanName(x.name), color: cleanColor(x.color), client: x.client === 'desktop' ? 'desktop' : 'web', host: x.id === m.from });
        mp.players.set(x.id, p);
        was.delete(x.id);
        if (p.host) p.seen = performance.now();
      }
      for (const id of was) mp.players.delete(id); // (the host says who is in)
      if (mp.joinWait) { const w = mp.joinWait; mp.joinWait = null; w.resolve(roomInfo()); }
      if (mp.guest) catchUp();
      updatePeers();
    }
    if (m.k === 'full' && m.to === mp.id && mp.joinWait) { const w = mp.joinWait; mp.joinWait = null; w.reject(new Error('That room is full.')); }
    if (m.k === 'airline') {
      const p = mp.role === 'host' || mp.players.has(m.from) ? player(m.from) : null;
      if (!p) return;
      const a = cleanAirline(m.airline);
      if (a) {
        p.airline = a;
        if (mp.role === 'host') p.name = a.name;
        updatePeers();
      }
    }
    if (m.k === 'chat' && typeof m.text === 'string') {
      const p = mp.players.get(m.from);
      if (!p) return;
      const text = m.text.slice(0, 300);
      mp.chat.push({ who: p.name, color: p.color, text });
      if (mp.chat.length > 100) mp.chat.shift();
      if (!mp.open) toast(`💬 ${p.name}: ${text}`);
      render();
    }
    if (m.k === 'bye') {
      const p = mp.players.get(m.from);
      if (!p) return;
      if (mp.role === 'guest' && mp.room && m.from === mp.room.from) { hostGone('The host closed the room.'); return; }
      mp.players.delete(m.from);
      say(`${p.name} left the room.`);
      if (mp.role === 'host') sendRoom();
      updatePeers();
    }
  }

  function freeColor() {
    const used = new Set([...mp.players.values()].map((p) => p.color));
    used.add(MC().colors[0]); // (the host's)
    return MC().colors.find((c) => !used.has(c)) || MC().colors[mp.players.size % MC().colors.length];
  }

  function say(text) {
    mp.chat.push({ who: '', text });
    if (mp.chat.length > 100) mp.chat.shift();
    toast(text);
    render();
  }

  // The others' airlines as rivals in this game (G.setPeers), when they changed.
  function updatePeers() {
    const list = [...mp.players.values()].filter((p) => p.airline).map((p) => ({
      id: `mp-${p.id}`, name: p.airline.name || p.name, color: p.color, home: p.airline.home, routes: p.airline.routes,
      slots: p.airline.slots, flights: p.airline.flights, money: p.airline.money, planes: p.airline.planes, since: G.state.time,
    }));
    const sig = JSON.stringify(list.map((x) => [x.id, x.name, x.color, x.routes, x.slots, x.flights]));
    if (sig === mp.peerSig) {
      for (const x of list) { const q = G.peers.find((y) => y.id === x.id); if (q) { q.money = x.money; q.planes = x.planes; } }
    } else {
      mp.peerSig = sig;
      G.setPeers(list);
    }
    render();
  }

  // ---------- the clock ----------
  // The host sends its time in UTC game minutes (homes in other time zones have other game clocks) and its speed;
  // a guest's game runs at that speed, jumps ahead when it fell behind and waits when it is ahead.
  function hostUtcNow() {
    if (!mp.room) return null;
    return mp.room.utc + ((performance.now() - mp.roomAt) * (mp.room.speed || 0)) / 60000;
  }
  function catchUp() {
    const host = hostUtcNow();
    if (host == null || !G.state) return;
    const behind = host - G.utcOf(G.state.time);
    if (behind >= 2) {
      G.advance(Math.floor(behind));
      G.dirty = true;
    }
  }
  function hostAlive() { return mp.room && performance.now() - mp.roomAt < MC().timeoutMs; }

  function hostGone(why) {
    if (mp.role !== 'guest') return;
    mp.closed = why;
    stopTimers();
    for (const b of mp.brokers) b.close();
    mp.brokers = [];
    mp.role = null;
    mp.keys = null;
    mp.players.clear();
    G.setPeers([]);
    toast(`${why} Your airline goes on alone; it stays saved for this room.`, true);
    render();
  }

  // ---------- sending ----------
  function roomPlayers() {
    const me = { id: mp.id, name: G.state.company, color: MC().colors[0], client: 'web' };
    return [me, ...[...mp.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, client: p.client }))];
  }
  function sendRoom() {
    if (mp.role !== 'host' || !G.state) return;
    const s = G.state;
    send('room', {
      proto: PROTO, host: s.company, players: roomPlayers(),
      utc: G.utcOf(FG.ui ? FG.ui.time : s.time), speed: FG.ui ? FG.ui.speed : 0,
      mode: s.mode, difficulty: s.difficulty, story: s.story ? s.story.start : null, year: G.year(),
    });
  }
  function sendAirline() {
    if (!mp.role || !G.state) return;
    send('airline', { airline: G.mpAirline() });
  }

  function startTimers() {
    stopTimers();
    if (mp.role === 'host') mp.timers.push(setInterval(sendRoom, MC().roomEvery));
    mp.timers.push(setInterval(sendAirline, MC().airlineEvery));
    mp.timers.push(setInterval(tick, 1000));
  }
  function stopTimers() { mp.timers.forEach(clearInterval); mp.timers = []; }

  // Once a second: players not heard from leave, a guest keeps up with the host.
  function tick() {
    const now = performance.now();
    for (const p of mp.role === 'host' ? [...mp.players.values()] : []) { // (a guest goes by the host's list)
      if (now - p.seen > MC().timeoutMs) {
        mp.players.delete(p.id);
        say(`${p.name} lost the connection.`);
        if (mp.role === 'host') sendRoom();
        updatePeers();
      }
    }
    if (mp.role === 'guest') {
      if (!hostAlive() && mp.room && now - mp.roomAt > MC().timeoutMs * 4) { hostGone('The host is gone.'); return; }
      catchUp();
    }
    render();
  }

  function roomInfo() {
    const r = mp.room;
    return { code: mp.code, host: cleanName(r.host), mode: r.mode, difficulty: r.difficulty, story: r.story || null,
      year: r.year || null, utc: hostUtcNow(), players: (r.players || []).length };
  }

  // ---------- what the game calls ----------
  // Open a room for the game being played (its old code again if it had one, so friends' airlines fit).
  async function host() {
    if (mp.role) leave();
    const code = (G.state.mp && G.state.mp.host && G.state.mp.room) || newCode();
    mp.keys = await roomKeys(code);
    mp.role = 'host';
    mp.closed = '';
    mp.players.clear();
    mp.chat = [];
    G.state.mp = { room: code, host: true };
    connect(code);
    startTimers();
    sendRoom();
    show(true);
    return showCode(code);
  }

  // A guest: find the room with that code. Resolves with what the host's game is (mode, difficulty, story,
  // year, its time), or fails when no host answers.
  async function find(input) {
    const code = normCode(input);
    if (code.length !== 6) throw new Error('A room code has 6 letters and digits, like ABC-234.');
    if (mp.role) leave();
    mp.keys = await roomKeys(code);
    mp.role = 'guest';
    mp.guestReady = false;
    mp.closed = '';
    mp.players.clear();
    mp.chat = [];
    mp.room = null;
    connect(code);
    const hello = () => send('hello', { name: (G.state && G.state.company) || 'Airline', client: 'web', look: true });
    const again = setInterval(hello, 1500);
    hello();
    try {
      return await new Promise((resolve, reject) => {
        mp.joinWait = { resolve, reject };
        setTimeout(() => {
          if (mp.joinWait) { mp.joinWait = null; reject(new Error(`No game with the code ${showCode(code)} is open right now.`)); }
        }, MC().joinWaitMs);
      });
    } catch (e) {
      leave();
      throw e;
    } finally {
      clearInterval(again);
    }
  }

  // A guest whose airline is set up (a new one, or the one saved for this room): play.
  function joined() {
    if (mp.role !== 'guest') return;
    G.state.mp = { room: mp.code };
    mp.guestReady = true;
    send('hello', { name: G.state.company, client: 'web' });
    sendAirline();
    startTimers();
    catchUp();
    updatePeers();
    show(true);
  }

  // Leave the room. A guest's airline is saved for the room and the game saved in this browser comes back.
  // Returns whether a game is loaded afterwards.
  function leave() {
    if (mp.role) send('bye');
    stopTimers();
    const brokers = mp.brokers;
    setTimeout(() => brokers.forEach((b) => b.close()), 300); // (the bye goes out first)
    mp.brokers = [];
    mp.role = null;
    mp.keys = null;
    mp.room = null;
    mp.joinWait = null;
    mp.players.clear();
    mp.closed = '';
    mp.peerSig = '';
    G.setPeers([]);
    let loaded = true;
    if (G.saveSlot === 'mp') {
      G.save();
      G.saveSlot = '';
      loaded = G.load();
      if (!loaded) G.newGame();
    }
    show(false);
    return loaded;
  }

  function chat(text) {
    text = String(text || '').trim().slice(0, 300);
    if (!text || !mp.role) return;
    send('chat', { text });
    mp.chat.push({ who: G.state.company, color: mp.role === 'host' ? MC().colors[0] : mp.myColor || '#64748b', text, me: true });
    render();
  }

  // ---------- the window ----------
  function show(on) {
    mp.open = on;
    const el = $('mp');
    if (!el) return;
    el.hidden = !on;
    if (on) { mp.shownHtml = ''; render(); }
  }
  function connected() { return mp.brokers.filter((b) => b.ready).length; }

  function render() {
    const el = $('mp');
    if (!el || el.hidden) return;
    const keepInput = el.querySelector('#mp-say');
    const typed = keepInput ? keepInput.value : '';
    const focused = document.activeElement === keepInput;
    let h = `<div class="dev-head mp-head"><b>👥 Multiplayer</b><button class="close" data-mp="close">×</button></div>`;
    if (!mp.role) {
      if (G.saveSlot === 'mp') { // (a guest whose host closed the room)
        h += `<p class="muted">${esc(mp.closed || 'The room is closed.')} Your airline goes on alone and stays saved for that room:
          join it again from the title screen (Multiplayer) when the host opens it again. Exit to the title screen to go back
          to your own game.</p>`;
      } else {
        h += `<p class="muted">Play in one world with friends: open a room for this game and send them its code. They join from
          the title screen (Multiplayer) with an airline of their own; you all compete for the same passengers and slots,
          and your clock sets the time for everyone.</p>
          <div class="dev-row"><button class="primary" data-mp="host">Open a room for ${esc(G.state.company)}</button></div>`;
      }
    } else {
      const n = connected();
      h += `<div class="mp-code"><span class="muted">Room code</span><b>${showCode(mp.code)}</b>
        <button class="mini" data-mp="copy" title="Copy a link that opens the game with this code">🔗 Copy link</button></div>
        <div class="muted small">${n ? `Connected (${n}/${mp.brokers.length} relays)` : 'Connecting…'}${mp.role === 'guest'
          ? ` · ${hostAlive() ? `the host sets the speed: ${mp.room.speed ? `${Math.round(mp.room.speed)}×` : 'paused'}` : 'waiting for the host…'}` : ' · you are the host: your speed and pauses count for everyone'}</div>`;
      h += '<table class="small mp-players"><tr><th></th><th>Airline</th><th>planes</th><th>cash</th></tr>';
      const me = { name: G.state.company, color: mp.role === 'host' ? MC().colors[0] : mp.myColor, planes: G.state.planes.length, money: G.state.money };
      h += `<tr><td><span class="rv-dot" style="background:${cleanColor(me.color)}"></span></td><td><b>${esc(me.name)}</b> <span class="muted">you${mp.role === 'host' ? ', host' : ''}</span></td>
        <td class="num">${me.planes}</td><td class="num">${G.fmtMoney(me.money)}</td></tr>`;
      for (const p of mp.players.values()) {
        const a = p.airline;
        h += `<tr><td><span class="rv-dot" style="background:${cleanColor(p.color)}"></span></td><td>${esc(a ? a.name : p.name)}${p.host ? ' <span class="muted">host</span>' : ''}${p.client === 'desktop' ? ' <span class="muted" title="plays the desktop game">🖥</span>' : ''}</td>
          <td class="num">${a ? a.planes : '…'}</td><td class="num">${a ? G.fmtMoney(a.money) : '…'}</td></tr>`;
      }
      h += '</table>';
      if (!mp.players.size) h += `<p class="muted small">Nobody else here yet. Send your friends the code ${showCode(mp.code)} (or the link).</p>`;
      h += `<div class="mp-chat">${mp.chat.slice(-40).map((c) => (c.who
        ? `<div><b style="color:${cleanColor(c.color || '#64748b')}">${esc(c.who)}</b> ${esc(c.text)}</div>`
        : `<div class="muted">${esc(c.text)}</div>`)).join('')}</div>
        <div class="dev-row"><input id="mp-say" maxlength="300" placeholder="Say something…"><button data-mp="say">Send</button></div>
        <div class="dev-row"><button data-mp="leave">${mp.role === 'host' ? 'Close the room' : 'Leave the room'}</button></div>`;
    }
    if (h === mp.shownHtml && el.childElementCount) return; // (a click must not land on a window drawn anew)
    mp.shownHtml = h;
    el.innerHTML = h;
    const box = el.querySelector('.mp-chat');
    if (box) box.scrollTop = box.scrollHeight;
    const input = el.querySelector('#mp-say');
    if (input) { input.value = typed; if (focused) input.focus(); }
    if (FG.win) FG.win.movable(el, '.mp-head', 'mp');
  }

  function onClick(e) {
    const b = e.target.closest('[data-mp]');
    if (!b) return;
    const what = b.dataset.mp;
    if (what === 'close') show(false);
    if (what === 'host') host().then((code) => toast(`Room ${code} is open: send your friends the code.`)).catch((err) => toast(err.message, true));
    if (what === 'copy') {
      const url = `${location.origin}${location.pathname}?join=${mp.code}`;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied.'), () => toast(url));
    }
    if (what === 'say') { const i = $('mp-say'); chat(i.value); i.value = ''; }
    if (what === 'leave') {
      if (mp.role === 'guest') { if (FG.ui && FG.ui.exitToTitle) FG.ui.exitToTitle(); else leave(); } else leave();
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const el = $('mp');
    if (!el) return;
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'mp-say') { chat(e.target.value); e.target.value = ''; }
      e.stopPropagation(); // (typing here is not the game's keys)
    });
    const btn = $('mp-toggle');
    if (btn) btn.addEventListener('click', () => show(!mp.open));
  });
  window.addEventListener('beforeunload', () => { if (mp.role) { send('bye'); if (G.saveSlot === 'mp') G.save(); } });

  FG.mp = {
    host, find, joined, leave, chat, show,
    get role() { return mp.role; },
    get inRoom() { return !!mp.role; },
    // A guest playing in the room: the host sets the time.
    get guest() { return mp.role === 'guest' && mp.guestReady; },
    // Does the game belong to a room (a guest's own save)?
    get active() { return !!mp.role || G.saveSlot === 'mp'; },
    get code() { return mp.code ? showCode(mp.code) : ''; },
    get players() { return [...mp.players.values()]; },
    get open() { return mp.open; },
    normCode, showCode,
    // The speed a guest's game runs at now: the host's, or 0 while it is ahead of the host or the host is gone.
    clockSpeed() {
      if (!hostAlive()) return 0;
      const host = hostUtcNow();
      if (G.utcOf(G.state.time) > host + 0.5) return 0;
      return mp.room.speed || 0;
    },
    hostSpeed() { return hostAlive() ? mp.room.speed || 0 : 0; },
    hostUtc: () => hostUtcNow(),
    // (for tests) messages as if they came from the room
    _handle: handle,
  };
})();
