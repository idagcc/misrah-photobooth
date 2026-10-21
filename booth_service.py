"""Local settings, aggregate counters, portrait library and macOS/CUPS printing.

Finished portraits can be archived in local weekly folders. The operating system
owns its separate print spool once a job has been accepted.
"""
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import socket
import sqlite3
import struct
import subprocess
import tempfile
import threading
import time
import uuid

BUILTINS = [
    {"id": "frontal-weaver", "name": "The basket weaver", "src": "assets/frontal/frontal-weaver.png"},
    {"id": "frontal-pearl-trader", "name": "The pearl trader", "src": "assets/frontal/frontal-pearl-trader.png"},
]
DEFAULTS = {"cameraId": "", "rate": 5, "printMode": "dialog", "printer": "", "media": "", "archiveEnabled": True}
EVENT_TIMEZONE = timezone(timedelta(hours=4), "Asia/Dubai")
MIN_ARCHIVE_FREE = 1024 ** 3


def archive_now():
    return datetime.now(timezone.utc).astimezone(EVENT_TIMEZONE)


def jpeg_size(data):
    """Read a bounded baseline/progressive JPEG header without image dependencies."""
    if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
        raise ValueError("Choose a JPEG image.")
    i = 2
    while i + 4 <= len(data):
        if data[i] != 255:
            break
        while i < len(data) and data[i] == 255:
            i += 1
        if i >= len(data):
            break
        marker = data[i]
        i += 1
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            continue
        length = int.from_bytes(data[i:i + 2], "big")
        if length < 2 or i + length > len(data):
            break
        if marker in (0xC0, 0xC2) and length >= 8:
            height, width = struct.unpack(">HH", data[i + 3:i + 7])
            if data[i + 2] != 8 or data[i + 7] != 3 or not (0 < width <= 2400 and 0 < height <= 2400):
                break
            return width, height
        if marker == 0xDA:
            break
        i += length
    raise ValueError("Use an 8-bit RGB JPEG up to 2400 pixels per side.")


def photo_pdf(jpeg, landscape=False):
    """One 4×6 inch page, embedded JPEG, aspect-preserving fit and no cropping."""
    width, height = jpeg_size(jpeg)
    page_w, page_h = (432, 288) if landscape else (288, 432)
    if landscape:
        # DNP often calls its media 6x4. Rotate the artwork into that page rather
        # than depending on a driver's auto-rotation or shrinking into its middle.
        scale = min(page_w / height, page_h / width)
        w, h = height * scale, width * scale
        content = f"q 0 {h:.4f} {-w:.4f} 0 {(page_w+w)/2:.4f} {(page_h-h)/2:.4f} cm /Photo Do Q".encode()
    else:
        scale = min(page_w / width, page_h / height)
        w, h = width * scale, height * scale
        content = f"q {w:.4f} 0 0 {h:.4f} {(page_w-w)/2:.4f} {(page_h-h)/2:.4f} cm /Photo Do Q".encode()
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_w} {page_h}] /Resources << /XObject << /Photo 4 0 R >> >> /Contents 5 0 R >>".encode(),
               f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(jpeg)} >>\nstream\n".encode() + jpeg + b"\nendstream",
               f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"\nendstream"]
    result = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(f"{i} 0 obj\n".encode() + obj + b"\nendobj\n")
    start = len(result)
    result.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        result.extend(f"{offset:010d} 00000 n \n".encode())
    result.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode())
    return bytes(result)


def decode_jpeg(value):
    if not isinstance(value, str) or not value.startswith("data:image/jpeg;base64,"):
        raise ValueError("A JPEG image is required.")
    try:
        data = base64.b64decode(value.split(",", 1)[1], validate=True)
    except ValueError:
        raise ValueError("The image could not be read.") from None
    if len(data) > 3 * 1024 * 1024:
        raise ValueError("The prepared image must be smaller than 3 MB.")
    jpeg_size(data)
    return data


def ipp_request(operation, attributes, path="/"):
    """Read CUPS IPP attributes on loopback, never query a user-supplied host."""
    payload = bytearray(struct.pack(">BBHI", 2, 0, operation, 1) + b"\x01")
    for tag, name, values in [(0x47, "attributes-charset", ["utf-8"]),
                              (0x48, "attributes-natural-language", ["en"]), *attributes]:
        for index, value in enumerate(values):
            key = name.encode() if index == 0 else b""
            raw = value.encode()
            payload.extend(bytes([tag]) + struct.pack(">H", len(key)) + key + struct.pack(">H", len(raw)) + raw)
    payload.append(3)
    class LocalCupsConnection(http.client.HTTPConnection):
        def connect(self):
            # macOS normally exposes CUPS through this socket with TCP disabled.
            cups_socket = next((p for p in ("/var/run/cupsd", "/run/cups/cups.sock") if Path(p).is_socket()), None)
            if cups_socket:
                self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                self.sock.settimeout(self.timeout)
                self.sock.connect(cups_socket)
            else:
                super().connect()
    connection = LocalCupsConnection("127.0.0.1", 631, timeout=3)
    try:
        connection.request("POST", path, payload, {"Content-Type": "application/ipp"})
        response = connection.getresponse()
        data = response.read(1024 * 1024)
        if response.status == 200 and len(data) >= 9 and operation == 0x4002 and int.from_bytes(data[2:4], "big") == 0x0406:
            return []
        if response.status != 200 or len(data) < 9 or int.from_bytes(data[2:4], "big") >= 0x0400:
            raise RuntimeError("The Mac print service could not report this status.")
    finally:
        connection.close()
    groups, group, key, i = [], {}, "", 8
    while i < len(data):
        tag = data[i]
        i += 1
        if tag == 3:
            break
        if tag <= 0x0f:
            group = {}
            groups.append(group)
            key = ""
            continue
        length = int.from_bytes(data[i:i + 2], "big")
        i += 2
        if length:
            key = data[i:i + length].decode("utf-8", "replace")
        i += length
        length = int.from_bytes(data[i:i + 2], "big")
        i += 2
        value = data[i:i + length]
        i += length
        if tag in (0x21, 0x23):
            value = int.from_bytes(value, "big", signed=True)
        elif tag == 0x22:
            value = bool(value and value[0])
        else:
            value = value.decode("utf-8", "replace")
        group.setdefault(key, []).append(value)
    return groups


def first(attrs, key, default=None):
    return attrs.get(key, [default])[0]


def printer_summary(attrs):
    name = first(attrs, "printer-name", "")
    reasons = attrs.get("printer-state-reasons", [])
    message = first(attrs, "printer-state-message", "")
    words = (" ".join(reasons) + " " + message).lower()
    state = first(attrs, "printer-state", 0)
    accepting = first(attrs, "printer-is-accepting-jobs", False)
    fault = None
    if any(word in words for word in ("media-empty", "paper end", "paper-end", "out of paper", "paper empty", "paper-out")):
        fault = "Paper is empty. Replace the paper and ribbon set."
    elif any(word in words for word in ("ribbon-empty", "ribbon end", "ribbon-end", "marker-supply-empty")):
        fault = "Ribbon is empty. Replace the paper and ribbon set."
    elif "media-jam" in words or "paper jam" in words:
        fault = "Paper jam. Check the printer."
    elif "cover-open" in words or "door-open" in words:
        fault = "Printer cover is open."
    elif any(word in words for word in ("offline", "not-connected", "unable to connect", "disconnected")):
        fault = "Printer is disconnected or unavailable."
    elif state == 5 or not accepting or any(r.endswith("-error") for r in reasons):
        fault = message or "Printer needs attention. Check the Mac print queue."
    return {"id": name, "name": first(attrs, "printer-info", name), "model": first(attrs, "printer-make-and-model", ""),
            "state": {3: "idle", 4: "printing", 5: "stopped"}.get(state, "unknown"),
            "message": message, "reasons": reasons, "accepting": accepting,
            "fault": fault, "blocked": bool(fault) or state not in (3, 4),
            "mediaRemaining": None, "statusSource": "macOS print queue · driver-reported"}


class CupsPrinter:
    def __init__(self):
        self.media_cache = {}

    def printers(self):
        attrs = ["printer-name", "printer-info", "printer-state", "printer-state-message", "printer-state-reasons",
                 "printer-is-accepting-jobs", "printer-make-and-model"]
        return [printer_summary(group) for group in ipp_request(0x4002, [(0x44, "requested-attributes", attrs)]) if "printer-name" in group]

    def media(self, printer):
        cached = self.media_cache.get(printer)
        if cached and time.monotonic() - cached[0] < 60:
            return cached[1]
        result = subprocess.run(["lpoptions", "-p", printer, "-l"], capture_output=True, text=True, timeout=4,
                                env={**os.environ, "LC_ALL": "C"})
        choices = []
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                if line.split("/", 1)[0].split(":", 1)[0] not in ("PageSize", "media"):
                    continue
                for code in line.split(":", 1)[-1].split():
                    code = code.lstrip("*")
                    if re.search(r"4[xX]6|6[xX]4|w288h432|w432h288", code) and re.fullmatch(r"[A-Za-z0-9_.-]+", code):
                        choices.append({"id": code, "name": f"4 × 6 inch · {code}"})
        if not choices:
            groups = ipp_request(0x000B, [(0x45, "printer-uri", [f"ipp://localhost/printers/{printer}"]),
                                            (0x44, "requested-attributes", ["media-supported"])], f"/printers/{printer}")
            for group in groups:
                for code in group.get("media-supported", []):
                    if re.search(r"4[xX]6|6[xX]4|w288h432|w432h288", code) and re.fullmatch(r"[A-Za-z0-9_.-]+", code):
                        choices.append({"id": code, "name": f"4 × 6 inch · {code}"})
        choices = list({item["id"]: item for item in choices}.values())
        self.media_cache[printer] = (time.monotonic(), choices)
        return choices

    def submit(self, printer, media, pdf):
        if not shutil.which("lp"):
            raise RuntimeError("Direct printing is unavailable. Use the system print window.")
        # lp copies the document to the OS spool before returning; delete our copy.
        with tempfile.TemporaryDirectory(prefix="misrah-print-") as directory:
            path = Path(directory) / "portrait.pdf"
            path.write_bytes(pdf)
            path.chmod(0o600)
            try:
                result = subprocess.run(["lp", "-d", printer, "-n", "1", "-t", "Misrah portrait", "-o", f"media={media}",
                                         "-o", "fit-to-page", "-o", "print-scaling=fit", "-o", "sides=one-sided",
                                         "-o", "job-sheets=none", str(path)], capture_output=True, text=True, timeout=15,
                                        env={**os.environ, "LC_ALL": "C"})
            except subprocess.TimeoutExpired:
                # The scheduler may have accepted the job already. Never retry it here.
                raise RuntimeError("Print response timed out. Check the Mac queue before printing again.") from None
            match = re.search(r"request id is (\S+)-(\d+)", result.stdout)
            if result.returncode or not match:
                raise RuntimeError((result.stderr.strip() or "The Mac print service did not confirm the job.")[:240])
            return int(match[2])

    def job(self, printer, job_id):
        groups = ipp_request(0x0009, [(0x45, "job-uri", [f"ipp://localhost/jobs/{job_id}"]),
                                     (0x44, "requested-attributes", ["job-state", "job-state-reasons"])], f"/jobs/{job_id}")
        attrs = next((g for g in groups if "job-state" in g), {})
        return {3: "queued", 4: "held", 5: "processing", 6: "stopped", 7: "cancelled", 8: "aborted", 9: "completed"}.get(first(attrs, "job-state"), "unknown")


class BoothService:
    def __init__(self, directory, printer=None, photos_directory=None):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        (self.directory / "templates").mkdir(exist_ok=True, mode=0o700)
        self.photos_directory = Path(photos_directory or self.directory / "photos").resolve()
        self.lock = threading.RLock()
        self.print_lock = threading.Lock()
        self.printer = printer or CupsPrinter()
        self.db = sqlite3.connect(self.directory / "booth.sqlite3", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, template TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, template TEXT NOT NULL, printer TEXT NOT NULL, job_id INTEGER, state TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE INDEX IF NOT EXISTS event_totals ON events(template, kind);
            CREATE TABLE IF NOT EXISTS archives (id TEXT PRIMARY KEY, template TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
                week TEXT NOT NULL, bytes INTEGER NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL,
                at TEXT NOT NULL, error TEXT NOT NULL DEFAULT '');
            CREATE INDEX IF NOT EXISTS archive_weeks ON archives(state, week);
        """)
        self.db.execute("INSERT OR IGNORE INTO settings VALUES (1, ?)", (json.dumps(DEFAULTS),))
        for item in BUILTINS:
            self.db.execute("INSERT OR IGNORE INTO templates(id, name) VALUES (?, ?)", (item["id"], item["name"]))
        self.db.execute("UPDATE jobs SET state='unknown', message='Server restarted before the print response was recorded. Check the Mac queue.' WHERE state='submitting'")
        self.db.commit()

    def config(self):
        with self.lock:
            settings = {**DEFAULTS, **json.loads(self.db.execute("SELECT value FROM settings WHERE id=1").fetchone()[0])}
            templates = [dict(row) for row in self.db.execute("SELECT * FROM templates ORDER BY rowid")]
        sources = {item["id"]: item["src"] for item in BUILTINS}
        for item in templates:
            item["src"] = sources.get(item["id"], f"/api/template-images/{item['id']}.jpg")
            thumb = self.directory / "templates" / f"{item['id']}-thumb.jpg"
            item["thumbnail"] = f"/api/template-images/{item['id']}-thumb.jpg" if thumb.exists() else item["src"]
        return {"settings": settings, "templates": templates}

    def template(self, template):
        with self.lock:
            if not self.db.execute("SELECT 1 FROM templates WHERE id=?", (template,)).fetchone():
                raise ValueError("Choose an available portrait.")

    def save_settings(self, value):
        if not isinstance(value, dict) or set(value) != set(DEFAULTS):
            raise ValueError("The device settings are incomplete.")
        if value["rate"] not in (5, 10) or type(value["rate"]) is not int or value["printMode"] not in ("dialog", "native"):
            raise ValueError("Choose a supported performance and printing mode.")
        if type(value["archiveEnabled"]) is not bool:
            raise ValueError("Choose whether finished portraits should be saved.")
        for key in ("cameraId", "printer", "media"):
            if not isinstance(value[key], str) or len(value[key]) > 256:
                raise ValueError("Invalid device selection.")
        if value["printMode"] == "native":
            printers = self.printer.printers()
            if value["printer"] not in [p["id"] for p in printers]:
                raise ValueError("Select a printer installed on this Mac.")
            if value["media"] not in [m["id"] for m in self.printer.media(value["printer"])]:
                raise ValueError("Select a supported 4 × 6 inch paper size.")
        with self.lock, self.db:
            self.db.execute("UPDATE settings SET value=? WHERE id=1", (json.dumps(value),))
        return self.config()

    def add_template(self, name, image, thumbnail):
        name = name.strip() if isinstance(name, str) else ""
        if not 1 <= len(name) <= 60:
            raise ValueError("Give the portrait a name, up to 60 characters.")
        data = decode_jpeg(image)
        preview = decode_jpeg(thumbnail)
        if len(preview) > 100000 or max(jpeg_size(preview)) > 500:
            raise ValueError("The thumbnail is too large.")
        width, height = jpeg_size(data)
        if height < 900 or not .45 <= width / height <= .85:
            raise ValueError("Use a vertical portrait, at least 900 pixels tall.")
        with self.lock:
            if self.db.execute("SELECT count(*) FROM templates").fetchone()[0] >= 50:
                raise ValueError("The library supports up to 50 portraits.")
            template = "custom-" + uuid.uuid4().hex
            path = self.directory / "templates" / f"{template}.jpg"
            path.write_bytes(data)
            path.chmod(0o600)
            thumb = path.with_name(f"{template}-thumb.jpg")
            thumb.write_bytes(preview)
            thumb.chmod(0o600)
            try:
                with self.db:
                    self.db.execute("INSERT INTO templates(id, name) VALUES (?, ?)", (template, name))
            except Exception:
                path.unlink(missing_ok=True)
                thumb.unlink(missing_ok=True)
                raise
        return self.config()

    def set_active(self, template, active):
        self.template(template)
        if type(active) is not bool:
            raise ValueError("Choose whether to show the portrait.")
        with self.lock, self.db:
            if not active and self.db.execute("SELECT count(*) FROM templates WHERE active=1 AND id<>?", (template,)).fetchone()[0] == 0:
                raise ValueError("Keep at least one portrait available.")
            self.db.execute("UPDATE templates SET active=? WHERE id=?", (active, template))
        return self.config()

    def event(self, event_id, template, kind):
        self.template(template)
        if kind not in ("selection", "capture", "dialog") or not isinstance(event_id, str) or not re.fullmatch(r"[a-f0-9-]{36}", event_id):
            raise ValueError("Invalid usage event.")
        with self.lock, self.db:
            self.db.execute("INSERT OR IGNORE INTO events(id, template, kind) VALUES (?, ?, ?)", (event_id, template, kind))

    def archive_directory(self):
        # Do not silently create a replacement folder on the internal drive if
        # an explicitly configured external Mac volume has been disconnected.
        parts = self.photos_directory.parts
        if len(parts) > 2 and parts[1] == "Volumes" and not Path(*parts[:3]).is_mount():
            raise RuntimeError("The photo storage drive is disconnected. Reconnect it to save portraits.")
        self.photos_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        return self.photos_directory

    def set_archive_enabled(self, enabled):
        if type(enabled) is not bool:
            raise ValueError("Choose whether finished portraits should be saved.")
        with self.lock, self.db:
            settings = self.config()["settings"]
            settings["archiveEnabled"] = enabled
            self.db.execute("UPDATE settings SET value=? WHERE id=1", (json.dumps(settings),))
        return self.config()

    def archive_photo(self, capture_id, template, image):
        self.template(template)
        if not isinstance(capture_id, str) or not re.fullmatch(r"[a-f0-9-]{36}", capture_id):
            raise ValueError("Invalid capture ID.")
        data = decode_jpeg(image)
        digest = hashlib.sha256(data).hexdigest()
        with self.lock:
            existing = self.db.execute("SELECT * FROM archives WHERE id=?", (capture_id,)).fetchone()
            if existing and (existing["digest"] != digest or existing["template"] != template):
                raise ValueError("This capture ID belongs to a different portrait.")
            if existing and existing["state"] == "saved":
                if not (self.photos_directory / existing["path"]).is_file():
                    raise RuntimeError("The saved photo is missing. Check the photo storage drive.")
                return {"id": capture_id, "saved": True, "path": existing["path"], "bytes": existing["bytes"]}
            if not self.config()["settings"]["archiveEnabled"]:
                return {"id": capture_id, "saved": False, "skipped": True}
            if not existing:
                now = archive_now().astimezone(EVENT_TIMEZONE)
                year, week, _ = now.isocalendar()
                folder = f"{year}-W{week:02d}"
                relative = f"{folder}/{now:%Y-%m-%d_%H-%M-%S}_{capture_id}.jpg"
                # Reserve the original week before I/O. A retry after midnight,
                # a restart or a lost HTTP response still targets the same file.
                with self.db:
                    self.db.execute("INSERT INTO archives(id, template, path, week, bytes, digest, state, at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
                                    (capture_id, template, relative, folder, len(data), digest, now.isoformat()))
            else:
                relative = existing["path"]
            temporary = None
            try:
                root = self.archive_directory()
                path = root / relative
                # Recover a completed rename if the DB commit or HTTP response
                # was interrupted. The capture's reserved digest verifies it.
                recovered = path.is_file() and path.stat().st_size == len(data) and hashlib.sha256(path.read_bytes()).hexdigest() == digest
                if not recovered:
                    if shutil.disk_usage(root).free - len(data) < MIN_ARCHIVE_FREE:
                        raise RuntimeError("Photo storage is almost full. Free space or connect the storage drive, then retry saving.")
                    path.parent.mkdir(exist_ok=True, mode=0o700)
                    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".saving-", delete=False) as stream:
                        temporary = Path(stream.name)
                        stream.write(data)
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.replace(temporary, path)
                with self.db:
                    self.db.execute("UPDATE archives SET state='saved', error='' WHERE id=?", (capture_id,))
                return {"id": capture_id, "saved": True, "path": relative, "bytes": len(data)}
            except (OSError, RuntimeError) as error:
                with self.db:
                    self.db.execute("UPDATE archives SET state='failed', error=? WHERE id=?", (str(error)[:240], capture_id))
                raise RuntimeError(str(error)[:240]) from None
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)

    def storage(self):
        with self.lock:
            totals = self.db.execute("SELECT count(*), coalesce(sum(bytes),0) FROM archives WHERE state='saved'").fetchone()
            weeks = [dict(row) for row in self.db.execute("SELECT week, count(*) AS photos, sum(bytes) AS bytes FROM archives WHERE state='saved' GROUP BY week ORDER BY week DESC")]
            failures = self.db.execute("SELECT count(*) FROM archives WHERE state<>'saved'").fetchone()[0]
            latest = self.db.execute("SELECT error FROM archives WHERE state='failed' ORDER BY rowid DESC LIMIT 1").fetchone()
        error, free, capacity = None, None, None
        try:
            usage = shutil.disk_usage(self.archive_directory())
            free, capacity = usage.free, usage.total
        except (OSError, RuntimeError) as exc:
            error = str(exc)[:240]
        count, size = totals
        return {"path": str(self.photos_directory), "enabled": self.config()["settings"]["archiveEnabled"],
                "timezone": "Asia/Dubai", "weekStarts": "Monday", "photos": count, "bytes": size, "weeks": weeks,
                "freeBytes": free, "capacityBytes": capacity, "lowSpace": free is not None and free < 5 * 1024 ** 3,
                "estimated30000Bytes": round(size / count * 30000) if count else None,
                "unsaved": failures, "lastError": latest[0] if latest else None, "error": error}

    def stats(self):
        with self.lock:
            rows = []
            for item in self.config()["templates"]:
                counts = {row[0]: row[1] for row in self.db.execute("SELECT kind, count(*) FROM events WHERE template=? GROUP BY kind", (item["id"],))}
                jobs = {row[0]: row[1] for row in self.db.execute("SELECT state, count(*) FROM jobs WHERE template=? GROUP BY state", (item["id"],))}
                rows.append({"id": item["id"], "name": item["name"], "selections": counts.get("selection", 0),
                             "captures": counts.get("capture", 0), "dialogs": counts.get("dialog", 0),
                             "requests": sum(jobs.values()), "queued": self.db.execute("SELECT count(*) FROM jobs WHERE template=? AND job_id IS NOT NULL", (item["id"],)).fetchone()[0],
                             "completed": jobs.get("completed", 0), "errors": sum(jobs.get(k, 0) for k in ("failed", "aborted", "stopped"))})
            recent = [dict(row) for row in self.db.execute("SELECT * FROM jobs ORDER BY rowid DESC LIMIT 12")]
        return {"templates": rows, "totals": {k: sum(row[k] for row in rows) for k in ("selections", "captures", "dialogs", "requests", "queued", "completed", "errors")}, "jobs": recent}

    def status(self, selected=None, include_jobs=True):
        settings = self.config()["settings"]
        selected = selected if selected is not None else settings["printer"]
        try:
            printers = self.printer.printers()
            chosen = next((p for p in printers if p["id"] == selected), None)
            media = self.printer.media(selected) if chosen else []
            error = None
        except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
            printers, chosen, media, error = [], None, [], str(exc)[:240]
        with self.lock:
            jobs = [dict(row) for row in self.db.execute("SELECT * FROM jobs WHERE job_id IS NOT NULL AND state NOT IN ('completed','cancelled','aborted') ORDER BY rowid ASC LIMIT 3")] if include_jobs else []
        for job in jobs:
            try:
                state = self.printer.job(job["printer"], job["job_id"])
                with self.lock, self.db:
                    self.db.execute("UPDATE jobs SET state=? WHERE id=?", (state, job["id"]))
            except (OSError, RuntimeError, subprocess.SubprocessError):
                pass
        with self.lock:
            recent = [dict(row) for row in self.db.execute("SELECT id, job_id, state, message FROM jobs ORDER BY rowid DESC LIMIT 12")] if include_jobs else []
        return {"printers": printers, "selected": chosen, "media": media, "error": error,
                "jobs": recent,
                "note": "Paper/ribbon alerts depend on the installed driver. An idle queue does not confirm paper is loaded. Remaining sheets are unavailable through this connection."}

    def print_photo(self, request_id, template, image):
        self.template(template)
        if not isinstance(request_id, str) or not re.fullmatch(r"[a-f0-9-]{36}", request_id):
            raise ValueError("Invalid print request.")
        jpeg = decode_jpeg(image)
        with self.print_lock:
            with self.lock:
                previous = self.db.execute("SELECT * FROM jobs WHERE id=?", (request_id,)).fetchone()
            if previous:
                return dict(previous)
            settings = self.config()["settings"]
            if settings["printMode"] != "native":
                raise ValueError("Direct printing has not been configured in the admin panel.")
            with self.lock, self.db:
                self.db.execute("INSERT INTO jobs(id, template, printer, state) VALUES (?, ?, ?, 'submitting')", (request_id, template, settings["printer"]))
            try:
                status = self.status(include_jobs=False)
                if not status["selected"]:
                    raise RuntimeError("The selected printer is unavailable. Ask an attendant to check it.")
                if status["selected"]["blocked"]:
                    raise RuntimeError(status["selected"]["fault"] or "The printer status is unknown. Check the Mac queue.")
                if settings["media"] not in [item["id"] for item in status["media"]]:
                    raise RuntimeError("The selected paper size is unavailable. Check the admin printer settings.")
                landscape = bool(re.search(r"6[xX]4|w432h288", settings["media"]))
                job_id = self.printer.submit(settings["printer"], settings["media"], photo_pdf(jpeg, landscape=landscape))
                with self.lock, self.db:
                    self.db.execute("UPDATE jobs SET job_id=?, state='queued' WHERE id=?", (job_id, request_id))
            except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as exc:
                message = str(exc)[:240]
                uncertain = "timed out" in message or "did not confirm" in message
                with self.lock, self.db:
                    self.db.execute("UPDATE jobs SET state=?, message=? WHERE id=?", ("unknown" if uncertain else "failed", message, request_id))
            with self.lock:
                return dict(self.db.execute("SELECT * FROM jobs WHERE id=?", (request_id,)).fetchone())
