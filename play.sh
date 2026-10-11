#!/bin/sh
# Start the game locally: serves this folder over http (the 3D view does not work from file://)
# and opens it in the browser. Ctrl+C stops the server.
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"
URL="http://localhost:$PORT/"
python3 - "$PORT" <<'EOF' &
import http.server, sys
class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')  # never mix cached old files with new ones
        super().end_headers()
    def log_message(self, *args):
        pass
class Server(http.server.ThreadingHTTPServer):
    def server_bind(self):
        # Skip the host name lookup in HTTPServer.server_bind, it can hang for seconds.
        import socketserver
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = 'localhost', self.server_address[1]
Server(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()
EOF
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
sleep 0.5
echo "Flightgame running at $URL (Ctrl+C to stop)"
xdg-open "$URL" >/dev/null 2>&1 || open "$URL" >/dev/null 2>&1 || true
wait $SERVER
