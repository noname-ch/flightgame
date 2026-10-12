#!/bin/sh
# Start the game locally: serves this folder over http (the 3D view does not work from file://)
# and opens it in the browser. Ctrl+C stops the server. The airport editor (F3) saves its fixes
# into js/data/fixes.js through this server (tools/serve.py).
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"
URL="http://localhost:$PORT/"
python3 tools/serve.py "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
sleep 0.5
echo "Flightgame running at $URL (Ctrl+C to stop)"
xdg-open "$URL" >/dev/null 2>&1 || open "$URL" >/dev/null 2>&1 || true
wait $SERVER
