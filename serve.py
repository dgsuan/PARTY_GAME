#!/usr/bin/env python3
"""
Dev server for Signal Arcade.

Two things a plain `python3 -m http.server` gets wrong for this app:

1. CROSS-ORIGIN ISOLATION. MediaPipe's WASM runtime only uses multiple
   threads when SharedArrayBuffer is available, and the browser only grants
   that to a cross-origin isolated page. Without the two COOP/COEP headers
   below the tracker silently runs single-threaded — which, on the CPU
   delegate, is the difference between a playable match and a slideshow.
   Nothing in the app reports this; it just runs slow.

   COEP is sent as `credentialless` rather than `require-corp` so the
   cross-origin loads this app depends on — the tasks-vision bundle and WASM
   from jsdelivr, the models from storage.googleapis.com, Google Fonts —
   keep working without needing CORP headers of their own. That mode is
   Chrome/Edge (and Firefox); Safari does not support it, so use
   --no-isolation there and accept the slower single-threaded path.

2. CACHING. The default server sends the browser caching hints that make it
   hold on to an old main.js or style.css after an edit, which reads as "my
   change did nothing". Everything here is served no-store.

Usage:
    python3 serve.py                 # http://localhost:8124, isolated
    python3 serve.py --port 9000
    python3 serve.py --no-isolation  # if a cross-origin load breaks
"""

import argparse
import http.server
import socketserver
import sys
from functools import partial

DEFAULT_PORT = 8124


class Handler(http.server.SimpleHTTPRequestHandler):
    isolate = True

    def end_headers(self):
        if self.isolate:
            # Together these make the page cross-origin isolated, which is
            # what unlocks SharedArrayBuffer and threaded WASM.
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        # Never let a stale module survive an edit.
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    # The default logs every request; keep it to one line per non-200.
    def log_request(self, code="-", size="-"):
        if str(code) != "200":
            super().log_request(code, size)


def main():
    parser = argparse.ArgumentParser(description="Serve Signal Arcade locally.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--no-isolation",
        action="store_true",
        help="Drop the COOP/COEP headers (Safari, or if a CDN load breaks).",
    )
    args = parser.parse_args()

    handler = partial(Handler)
    Handler.isolate = not args.no_isolation

    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("", args.port), handler) as httpd:
            # ASCII only: the default Windows console codepage is cp1252 and
            # raises UnicodeEncodeError on anything prettier.
            print(f"Signal Arcade  ->  http://localhost:{args.port}")
            print(
                "  cross-origin isolated: threaded WASM available"
                if Handler.isolate
                else "  isolation OFF: MediaPipe will run single-threaded"
            )
            print("  Ctrl+C to stop")
            httpd.serve_forever()
    except OSError as error:
        print(f"Could not bind port {args.port}: {error}", file=sys.stderr)
        print("Another server may already be running. Try --port 8125.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
