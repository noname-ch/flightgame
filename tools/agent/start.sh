#!/bin/bash
# Start what the airport-checking tools need, in the background: the game on GAME_PORT (default 8848) and a
# headless Chrome with its DevTools port on CDP_PORT (default 9447). Logs go to tools/agent/shots/.
# Stop them again with: kill $(cat tools/agent/shots/pids)
D=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$D/../.." && pwd)
GAME_PORT=${GAME_PORT:-8848}
CDP_PORT=${CDP_PORT:-9447}
mkdir -p "$D/shots"
CHROME=${CHROME:-$(for c in google-chrome google-chrome-stable chromium chromium-browser; do command -v $c && break; done)}
[ -n "$CHROME" ] || { echo "No Chrome or Chromium found (set CHROME=/path/to/chrome)"; exit 1; }
(cd "$ROOT" && exec python3 -m http.server "$GAME_PORT" --bind 127.0.0.1) > "$D/shots/server.log" 2>&1 &
echo $! > "$D/shots/pids"
"$CHROME" --headless=new --no-sandbox --disable-gpu --remote-debugging-address=127.0.0.1 --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$D/shots/profile" --window-size=1600,1200 about:blank > "$D/shots/chrome.log" 2>&1 &
echo $! >> "$D/shots/pids"
for i in $(seq 1 30); do curl -s "http://127.0.0.1:$CDP_PORT/json" > /dev/null && break; sleep 1; done
curl -s "http://127.0.0.1:$CDP_PORT/json" > /dev/null && echo "ready: game :$GAME_PORT, Chrome DevTools :$CDP_PORT" || { echo "Chrome did not start, see $D/shots/chrome.log"; exit 1; }
