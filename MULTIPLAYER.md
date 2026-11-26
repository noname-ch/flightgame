# Multiplayer protocol

Flightgame's multiplayer rooms (browser: `js/multiplayer.js`; desktop: github.com/lianhirter-arch/flightgame-rust)
speak this protocol, so browser and desktop players can share a room. Version 1.

## The idea

- One player **hosts**: their game is the world. They open a room and get a 6-character code.
- Others **join** with the code and found an airline of their own in that world (the host's mode, difficulty and
  story year), at the host's time. Each client keeps simulating its own airline, its own AI rivals, market and events.
- Every client sends its airline (routes, slots, planes in the air) a few times a minute. The others treat each
  player's airline as a rival: passengers split on shared routes (seats × fare, as with the AI rivals), slots held by
  a player are taken, and their planes are drawn.
- The host's clock sets the time and speed for everyone.

There is no game server: messages go through public MQTT brokers, end-to-end encrypted with a key from the room code.

## Transport

- MQTT 3.1.1 over WebSocket (subprotocol `mqtt`), QoS 0, clean session, keep-alive 30 s.
- Brokers (`C.multiplayer.brokers` in js/config.js), in this order:
  - `wss://broker.emqx.io:8084/mqtt`
  - `wss://broker.hivemq.com:8884/mqtt`
- A client connects to **all** of them, subscribes on each and publishes every message on each one it is connected
  to. Receivers drop duplicates by `from` + `seq` (below). So one broker being down or slow never splits a room.
- Client ids: anything unique, e.g. `fg-<peer id>-<random>`.

## Room code, key and topic

- Code: 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, shown as `ABC-234`. Before use it is normalised:
  upper case, everything but `A-Z0-9` removed.
- Key: PBKDF2-HMAC-SHA256, password = the normalised code (UTF-8), salt = `flightgame-mp-v1`, 100 000 iterations,
  32 bytes → AES-256-GCM key.
- Topic: `flightgame/v1/` + the first 32 hex digits (lower case) of SHA-256(`flightgame-mp-v1 topic ` + code).
- Payload: 12 random bytes IV, then the AES-GCM ciphertext of the message with its 16-byte tag appended (what
  WebCrypto's `encrypt` returns), no additional data. The plaintext is UTF-8 JSON.
- A payload that does not decrypt or parse is ignored (another room, or garbage).

## Messages

Every message is a JSON object with:

| field  | meaning |
|--------|---------|
| `v`    | `1` (the protocol version; others are ignored) |
| `k`    | the kind, below |
| `from` | the sender's peer id: 8 hex digits, random per session |
| `seq`  | a number the sender counts up with every message (duplicates from several brokers are dropped by `from:seq`) |

A client ignores its own messages (`from` = its id).

### `hello` (guest → host)

`{ name, client: "web" | "desktop", look? }` — sent every 1.5 s while looking for the room (`look: true`: only
looking, the host answers but doesn't list them), and once without `look` when the guest's airline is set up.

### `room` (host → all, every second, and at once after a `hello`)

```json
{ "proto": 1, "host": "Bern Air",
  "players": [{ "id": "a1b2c3d4", "name": "Bern Air", "color": "#e11d48", "client": "web" }, ...],
  "utc": 1234.56, "speed": 300,
  "mode": "arcade", "difficulty": "normal", "story": 1975, "year": 1979 }
```

- `players`: everyone in the room, the host first. The host picks the colours (`C.multiplayer.colors`, the host
  takes the first); a guest uses its colour from this list, and the list is who is in the room.
- `utc`: the host's game time in **UTC game minutes** (fractional). Game time is local at each player's home base, so
  clocks are exchanged in UTC: `utc = t − utcOffset(home, t)` (browser: `G.utcOf(t)`), and a guest's own time for
  it is `utc + utcOffset(guestHome)`.
- `speed`: how fast the host's game runs, a multiple of real time; `0` = paused.
- `mode`, `difficulty`: the host's (`C.modes`, `C.difficulties` ids). `story`: the start year of a story game, or
  `null` for free play (a guest's new airline uses the same start year, so the dates agree). `year`: the year now
  in a story game (which aircraft a new airline can start with), else `null`.

A guest that doesn't get a `room` within 10 s after its first `hello` reports that no game with that code is open.

### `airline` (everyone → all, every 3 s)

```json
{ "airline": {
  "name": "Gast Airways", "home": "LUG", "money": 1500000, "planes": 3,
  "routes": [{ "a": "BRN", "b": "LUG", "type": "ATR72-600", "perDay": 7, "seats": 70, "fare": 1 }],
  "slots": { "LUG": 2, "BRN": 1 },
  "flights": [{ "id": "HB-AAA", "type": "Q400", "from": "MUC", "to": "BRN", "dep": 453, "arr": 516 }] } }
```

- `routes`: the routes the player's running timetables fly, both directions together: `perDay` flights a day each
  way with `seats` seats each, at `fare` (the price factor on the standard fare, 1 = standard). Receivers use it like
  an AI rival's route: its pull on the passengers is `(perDay × seats)^capacityExp × fare^−elasticity`.
- `slots`: slots held per airport. Receivers count them as held by that player (not for sale).
- `flights`: the planes in the air, times in UTC game minutes. Receivers draw a plane between `dep` and `arr` on the
  great circle.
- Receivers drop routes, slots and flights at airports or with aircraft types they don't know, and clamp numbers.

### `chat` (anyone → all)

`{ text }`, at most 300 characters. Shown as text, never as HTML.

### `bye` (anyone → all)

`{}` — the sender leaves. A `bye` from the host closes the room: the guests' airlines go on alone.

### `full` (host → one guest)

`{ to: <peer id> }` — the room has no colour left (8 players).

## Time

- A guest's game runs at the host's `speed`. It predicts the host's time as `utc + (now − received) × speed / 60000`
  (real milliseconds). When it is 2 or more game minutes behind, it simulates the minutes at once; when it is ahead,
  it stands still until the host catches up.
- Speed and pause belong to the host; a guest's own controls do nothing in a room.
- The host is gone when no `room` came for 15 s (the guest's clock stands still); after a minute the guest goes on
  alone as after a `bye`.
- The host drops a player not heard from for 15 s.

## Saving

- The host's game is its normal save; it remembers its room code (`state.mp = { room, host: true }`), so opening a
  room again later gives the same code and guests can go on with their airlines.
- A guest's airline is saved apart (browser: localStorage `flightgame.save.v1.mp`, with `state.mp = { room }`), so it
  never replaces the player's own game. Joining the same room again offers to go on with it.
