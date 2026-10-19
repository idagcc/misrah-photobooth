#!/usr/bin/env python3
"""Serve the photobooth on loopback only; no uploads, API, or photo storage."""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import webbrowser

PUBLIC = Path(__file__).resolve().parent / "public"


class LocalHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "application/javascript", ".mjs": "application/javascript",
                      ".wasm": "application/wasm", ".task": "application/octet-stream"}

    def end_headers(self):
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
                         "style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; "
                         "worker-src 'self'; media-src 'self' blob:; font-src 'self'; "
                         "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'")
        self.send_header("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    def log_message(self, format, *args):
        # Guest filenames and photographs are never sent to this server.
        if args and str(args[1] if len(args) > 1 else "") not in ("200", "304"):
            super().log_message(format, *args)


def main():
    parser = argparse.ArgumentParser(description="Start the private local photobooth")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()
    handler = functools.partial(LocalHandler, directory=str(PUBLIC))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    except OSError as error:
        parser.exit(1, f"Could not open port {args.port}: {error}\nTry: python3 server.py --port 8766\n")
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"\nMisrah Studio is ready: {url}\n", flush=True)
    print("Keep this window open while using the photobooth. Press Ctrl+C to stop.\n", flush=True)
    if not args.no_open:
        threading.Timer(.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nPhotobooth stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
