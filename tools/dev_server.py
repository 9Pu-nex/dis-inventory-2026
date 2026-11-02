#!/usr/bin/env python3
"""
Dev server for full-stack testing WITHOUT deploying the Apps Script backend.

It serves the static frontend AND /api, which speaks the NEW contract
(`{success, updatedAt, items:[...]}`) by fetching the OLD deployed endpoint
(`?action=getAll`) and flattening `data` into one array.

Why: the new frontend needs `?action=items`, but deploying that endpoint is
blocked until the script owner (same Google domain) clicks Deploy. This proxy
lets you exercise the whole app — fetch, timeout/retry, sessionStorage cache,
client-side search, rendering — against the real 1,282 items today.

It is a development tool only. It is NOT part of the shipped site and must not
be used in production: it depends on the legacy `action=getAll` endpoint.

Usage:
    python tools/dev_server.py [--port 8123] [--refresh 60]

Then open:
    http://localhost:8123/?api=/api          # real sheet data via the proxy
    http://localhost:8123/?mock=1            # hand-written fixture (16 items)
"""

import argparse
import json
import threading
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Deployed (legacy) web app — still on the old code until the owner redeploys.
LEGACY_API = (
    'https://script.google.com/macros/s/'
    'AKfycbzWO17Ys0l6DVBlb6saYm1i5krAVZjVjlPD1plCDEAqrKg4-h3nEXWqlWsOOUAdmxw/exec'
)

_cache = {'at': 0.0, 'body': b''}
_lock = threading.Lock()


def fetch_items(refresh_seconds: int) -> bytes:
    """Return the flattened payload, cached for `refresh_seconds`."""
    with _lock:
        if _cache['body'] and time.time() - _cache['at'] < refresh_seconds:
            return _cache['body']

        url = f'{LEGACY_API}?action=getAll'
        req = urllib.request.Request(url, headers={'User-Agent': 'dis-inventory-dev-proxy'})
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode('utf-8'))

        if not payload.get('success'):
            raise RuntimeError(f'legacy endpoint reported failure: {payload.get("error")!r}')

        items = []
        for sheet, rows in (payload.get('data') or {}).items():
            for index, row in enumerate(rows or []):
                item = dict(row)
                item.setdefault('sheet', sheet)
                # Real backend uses `${sheet}:${rowNumber}`; approximate it here.
                item.setdefault('id', f'{sheet}:{index + 2}')
                items.append(item)

        body = json.dumps(
            {
                'success': True,
                'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'items': items,
            },
            ensure_ascii=False,
        ).encode('utf-8')

        _cache['body'] = body
        _cache['at'] = time.time()
        print(f'[proxy] rebuilt from legacy endpoint: {len(items)} items, {len(body)} bytes')
        return body


class DevHandler(SimpleHTTPRequestHandler):
    refresh_seconds = 60

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO_ROOT), **kwargs)

    def do_GET(self):  # noqa: N802 (stdlib naming)
        if self.path.split('?')[0] in ('/api', '/api/'):
            self.serve_api()
            return
        super().do_GET()

    def serve_api(self):
        try:
            body = fetch_items(self.refresh_seconds)
        except Exception as exc:  # noqa: BLE001 - report any upstream problem as JSON
            body = json.dumps({'success': False, 'error': f'{type(exc).__name__}: {exc}'}).encode('utf-8')
            self.send_response(502)
        else:
            self.send_response(200)

        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A002 - matches the stdlib signature
        if self.path.startswith('/api'):
            super().log_message(format, *args)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8123)
    parser.add_argument('--refresh', type=int, default=60, help='seconds to cache the upstream payload')
    args = parser.parse_args()

    DevHandler.refresh_seconds = args.refresh
    server = ThreadingHTTPServer(('0.0.0.0', args.port), DevHandler)
    print(f'[dev] serving {REPO_ROOT} on http://localhost:{args.port}')
    print(f'[dev]   real data  -> http://localhost:{args.port}/?api=/api')
    print(f'[dev]   fake data  -> http://localhost:{args.port}/?mock=1')
    print(f'[dev]   upstream   -> {LEGACY_API}?action=getAll  (cached {args.refresh}s)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
