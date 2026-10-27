#!/usr/bin/env python3
"""Loopback-only photobooth and local device bridge. No cloud services."""
import argparse
import functools
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import secrets
import threading
from urllib.parse import parse_qs, urlsplit
import webbrowser
from booth_service import BoothService

PUBLIC = Path(__file__).resolve().parent / "public"


class LocalHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "application/javascript", ".mjs": "application/javascript",
                      ".wasm": "application/wasm", ".task": "application/octet-stream"}

    def end_headers(self):
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
                         "style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; "
                         "worker-src 'self'; media-src 'self' blob:; font-src 'self'; "
                         "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'none'")
        self.send_header("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    def local_request(self):
        hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        return (host in hosts and (not origin or origin == f"http://{host}")
                and self.headers.get("Sec-Fetch-Site") not in ("cross-site", "same-site"))

    def json_response(self, value, status=200):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.local_request():
            self.send_error(403, "Open the local photobooth address.")
            return
        url = urlsplit(self.path)
        service = self.server.booth
        if url.path.startswith("/api/template-images/"):
            template = url.path.removeprefix("/api/template-images/").removesuffix(".jpg")
            if not re.fullmatch(r"custom-[a-f0-9]{32}(?:-thumb)?", template):
                self.send_error(404)
                return
            path = service.directory / "templates" / f"{template}.jpg"
            if not path.is_file():
                self.send_error(404)
                return
            data = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if url.path == "/api/bootstrap":
            self.json_response({**service.config(), "token": self.server.api_token})
        elif url.path == "/api/stats":
            self.json_response(service.stats())
        elif url.path == "/api/storage":
            self.json_response(service.storage())
        elif url.path == "/api/status":
            self.json_response(service.status(parse_qs(url.query).get("printer", [None])[0]))
        elif url.path.startswith("/api/"):
            self.json_response({"error": "Not found"}, 404)
        else:
            super().do_GET()

    def do_POST(self):
        if not self.local_request() or not secrets.compare_digest(self.headers.get("X-Booth-Token", ""), self.server.api_token):
            self.json_response({"error": "Reload the local photobooth to reconnect."}, 403)
            return
        if self.headers.get_content_type() != "application/json":
            self.json_response({"error": "JSON is required."}, 415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 5 * 1024 * 1024:
                raise ValueError("The request is too large or empty.")
            self.connection.settimeout(20)
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise ValueError("Invalid request.")
            service, route = self.server.booth, urlsplit(self.path).path
            if route == "/api/settings":
                result = service.save_settings(value)
            elif route == "/api/templates":
                result = service.add_template(value.get("name"), value.get("image"), value.get("thumbnail"))
            elif route == "/api/templates/toggle":
                result = service.set_active(value.get("id"), value.get("active"))
            elif route == "/api/events":
                service.event(value.get("id"), value.get("template"), value.get("kind"))
                result = {"ok": True}
            elif route == "/api/print":
                result = service.print_photo(value.get("id"), value.get("template"), value.get("image"))
            elif route == "/api/archive":
                result = service.archive_photo(value.get("id"), value.get("template"), value.get("image"))
            elif route == "/api/archive/settings":
                result = service.set_archive_enabled(value.get("enabled"))
            else:
                self.json_response({"error": "Not found"}, 404)
                return
            self.json_response(result)
        except (ValueError, TypeError, KeyError) as error:
            self.json_response({"error": str(error)}, 400)
        except (OSError, RuntimeError) as error:
            self.json_response({"error": str(error)[:240]}, 503)
        except Exception:
            self.json_response({"error": "The local service could not complete this request. Check available disk space and restart."}, 500)

    def log_message(self, format, *args):
        # Never log request bodies, photographs or filenames supplied by guests.
        if args and str(args[1] if len(args) > 1 else "") not in ("200", "304"):
            super().log_message(format, *args)


def main():
    parser = argparse.ArgumentParser(description="Start the private local photobooth")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parent / ".local-data")
    parser.add_argument("--photos-dir", type=Path, help="Weekly photo folder; default: photos/ beside this app")
    args = parser.parse_args()
    handler = functools.partial(LocalHandler, directory=str(PUBLIC))
    try:
        photos = (args.photos_dir or (args.data_dir / "photos" if args.data_dir != parser.get_default("data_dir") else Path(__file__).resolve().parent / "photos")).resolve()
        if photos.is_relative_to(PUBLIC.resolve()):
            parser.error("Choose a photo folder outside public/ so guest photos are not web-accessible.")
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
        server.booth = BoothService(args.data_dir, photos_directory=photos)
        server.api_token = secrets.token_urlsafe(32)
    except OSError as error:
        parser.exit(1, f"Could not open port {args.port}: {error}\nTry: python3 server.py --port 8766\n")
    url = f"http://127.0.0.1:{server.server_port}/landscape.html"
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
