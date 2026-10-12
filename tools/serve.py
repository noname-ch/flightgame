#!/usr/bin/env python3
"""Serve the game locally (./play.sh): this folder over http, never cached, on 127.0.0.1 only.

The airport editor (developer tools, F3) saves its fixes here: POST /__fixes with {"code": "BRN", "ops": [...]}
puts that airport's fixes into js/data/fixes.js (no ops: the airport's fixes are removed). Commit that file to
give everyone the fixes. GET /__fixes tells the page that it can save here.
The airport checklist (F4) does the same with POST /__checks {"code": "BRN", "check": {"s": "ok", ...} or null}
into js/data/checks.js.
"""
import http.server
import json
import os
import re
import socketserver
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXES = os.path.join(ROOT, 'js', 'data', 'fixes.js')
HEADER = ('// Airport fixes drawn with the airport editor (developer tools, F3), see js/fixes.js.\n'
          '// Written by tools/serve.py when the game runs from ./play.sh: commit this file to give everyone the fixes.\n')
CHECKS = os.path.join(ROOT, 'js', 'data', 'checks.js')
CHECKS_HEADER = ('// Airport checklist (developer tools, F4), see js/airportcheck.js: s = checked (blue, an agent looked at it),\n'
                 '// ok (green, a person approved it) or bad (red, needs work). Written by tools/serve.py, tools/checks.mjs or a commit\n'
                 '// from the game: commit this file to give everyone the checks.\n')
CHECK_KEYS = ('s', 'by', 'at', 'note')
KINDS = {'runway', 'taxiway', 'apron', 'pad', 'terminal', 'hangar', 'building', 'stand', 'tower', 'airport', 'bridges'}
lock = threading.Lock()


def read_fixes():
    try:
        with open(FIXES, encoding='utf-8') as f:
            text = f.read()
    except FileNotFoundError:
        return {}
    body = text[text.index('=', text.index('FG.data.fixes')) + 1:].strip().rstrip(';')
    return json.loads(body)


def write_fixes(fixes):
    parts = []
    for code in sorted(fixes):
        if fixes[code]:
            ops = ',\n'.join('  ' + json.dumps(op, separators=(',', ':'), ensure_ascii=False) for op in fixes[code])
            parts.append(f'{json.dumps(code)}: [\n{ops}\n]')
    tmp = FIXES + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(HEADER + 'FG.data.fixes = {\n' + ',\n'.join(parts) + '\n};\n')
    os.replace(tmp, FIXES)


def read_checks():
    try:
        with open(CHECKS, encoding='utf-8') as f:
            text = f.read()
    except FileNotFoundError:
        return {}
    body = text[text.index('=', text.index('FG.data.checks')) + 1:].strip().rstrip(';')
    return json.loads(re.sub(r',(\s*})$', r'\1', body))


def clean_check(m):
    """A mark with its fields in one order, as js/airportcheck.js writes it (None: no mark)."""
    if not isinstance(m, dict) or m.get('s') not in ('checked', 'ok', 'bad'):
        return None
    return {k: str(m[k])[:2000] for k in CHECK_KEYS if m.get(k) not in (None, '')}


def write_checks(checks):
    lines = [f'{json.dumps(c)}: {json.dumps(clean_check(checks[c]), separators=(",", ":"), ensure_ascii=False)}'
             for c in sorted(checks) if clean_check(checks[c])]
    tmp = CHECKS + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(CHECKS_HEADER + 'FG.data.checks = {\n' + ',\n'.join(lines) + ('\n' if lines else '') + '};\n')
    os.replace(tmp, CHECKS)


def valid(code, ops):
    return (isinstance(code, str) and re.fullmatch(r'[A-Z0-9]{2,5}', code) and isinstance(ops, list) and len(ops) < 5000
            and all(isinstance(o, dict) and o.get('op') in ('add', 'del', 'set') and o.get('kind') in KINDS for o in ops))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')  # never mix cached old files with new ones
        super().end_headers()

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.split('?')[0] in ('/__fixes', '/__checks'):  # the page asks whether it can save here
            body = b'{"ok": true}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]
        if path not in ('/__fixes', '/__checks'):
            self.send_error(404)
            return
        try:
            n = int(self.headers.get('Content-Length') or 0)
            if n > 20_000_000:
                raise ValueError('too big')
            data = json.loads(self.rfile.read(n))
            if path == '/__checks':
                code, check = data.get('code'), data.get('check')
                if not (isinstance(code, str) and re.fullmatch(r'[A-Z0-9]{2,5}', code)) or (check is not None and not clean_check(check)):
                    raise ValueError('not a check')
                with lock:
                    checks = read_checks()
                    if check:
                        checks[code] = clean_check(check)
                    else:
                        checks.pop(code, None)
                    write_checks(checks)
                self.reply(200, {'ok': True, 'airports': len(checks)})
                return
            code, ops = data.get('code'), data.get('ops')
            if not valid(code, ops):
                raise ValueError('not a fix')
            with lock:
                fixes = read_fixes()
                if ops:
                    fixes[code] = ops
                else:
                    fixes.pop(code, None)
                write_fixes(fixes)
            self.reply(200, {'ok': True, 'airports': len(fixes)})
        except Exception as e:  # noqa: BLE001 - tell the page what went wrong
            self.reply(400, {'ok': False, 'error': str(e)})

    def reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Server(http.server.ThreadingHTTPServer):
    def server_bind(self):
        # Skip the host name lookup in HTTPServer.server_bind, it can hang for seconds.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = 'localhost', self.server_address[1]


if __name__ == '__main__':
    Server(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8000), Handler).serve_forever()
