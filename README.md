# Misrah Studio — local photobooth v0.7

A clean, touch-first photobooth for an Apple-silicon Mac mini with 16 GB unified memory. Guests choose a straight-facing heritage portrait, look at the camera, and print a keepsake. Everything runs on the booth computer. This prototype uses geometric face insertion and local tone correction, rather than a cloud or neural identity-swap service.

## Start

Requires Python 3.9+ and a recent desktop Chrome or Edge browser. Double-click **Start Photobooth.command** on macOS, or run `python3 server.py`. Keep its window open. The address is normally <http://127.0.0.1:8765>. If the port is busy, use `python3 server.py --port 8766`.

Camera access requires this local address; opening `index.html` directly will not work. The bundled model, runtime, artwork and lights clip work offline. No Node installation or additional Python packages are needed to operate the booth.

## Guest flow

**Touch to start → choose a portrait → lights → steady 3-second capture → print or retake.**

Only the two frontal portraits are enabled initially: The basket weaver and The pearl trader. The welcome screen also uses a straight-facing portrait. Large cards start capture with one tap, without a second scene preview or exposed settings. A single camera view gives short, actionable guidance. Retake keeps the chosen portrait; Choose another portrait clears the photograph. Finish clears the photograph and print image for the next guest. After two idle minutes, the session clears, with a warning during the final 20 seconds. Processing, printing and the open admin panel suspend that timer.

The original generated scenes are synthetic alignment fixtures, not approved client artwork. Add approved frontal artwork through the admin panel before an event.

## Hidden admin panel

Press **Command + Option + Shift + A** on a Mac, or **Control + Alt + Shift + A**. Repeat the shortcut or press Escape to close it. Opening admin stops an active camera; the guest can start capture again afterward.

- **Devices:** choose the camera, 5 or 10 live checks per second, printing mode, installed Mac printer, and a supported 4 × 6 paper size. Find cameras requests permission, enumerates cameras, and immediately stops its temporary stream. Save applies the choice to the next capture and persists it across restarts.
- **Portraits:** add a named JPEG, PNG or WebP with one straight-facing person. Use vertical artwork at least 900 px tall. The local model checks for exactly one face, approximately frontal head pose and level eyes before adding it. The image is resized to at most 1800 px tall and stored with a small thumbnail. Hide/show controls update the guest selection without deleting artwork or its statistics. Keep at least one portrait enabled. Up to 50 portraits can be stored.
- **Storage:** turn automatic saving on/off, see the archive location, weekly photo counts, bytes used, free drive space and a live estimate for 30,000 photos. A failed save keeps the current photo available for operator retry.
- **Usage:** lifetime totals and per-portrait selections, captures, direct print requests, accepted print jobs, spooler-completed jobs, system print windows, and errors. Recent jobs include their queue IDs and status. Export CSV downloads the per-portrait totals. No guest images appear in usage history.

A selection means a guest tapped a portrait, even if capture was later cancelled. A successful retake is another capture. System print windows can be cancelled and are never counted as accepted or completed prints. A completed spooler job is not independent proof of physical output. Sample links and simulated-camera sessions do not contribute to usage totals and always use the system print window.

## Printing on macOS, including DNP DS-RX1HS

There are two printing modes:

1. **System print window (default):** Print my photo prepares a full-resolution JPEG and opens the browser/system dialog. Select the printer, 4 × 6 paper, suitable scaling, and disable browser headers/footers. Closing or cancelling keeps the portrait available. The browser cannot tell whether a physical print was produced.
2. **Direct to selected Mac printer:** install the printer and its driver in macOS first. In admin, choose Direct printing, the printer, and a 4 × 6 media choice reported by that driver. Save settings. Print my photo then sends one 4 × 6 PDF to the local Mac print queue, without asking the guest to select a printer. Each request has a unique ID; repeating the same request cannot submit another job. There is no automatic fallback or retry after an uncertain submission.

Both routes fit the complete portrait without cropping. The direct PDF uses a 4 × 6 inch page. For DNP’s `6x4` media, it rotates the artwork into a 6 × 4 inch page to match the driver, keeping the portrait full-size. Driver media names vary: DNP may report `6x4`, while other drivers use `4x6` or an IPP size keyword. The app discovers those choices rather than assuming a universal paper code. Direct printing remains unavailable unless an installed printer reports a matching size. Gloss/matte finish and colour profile use the installed driver's defaults.

**DNP status research, checked 21 October 2026:**

- [DNP's RX1HS product page](https://www.dnpphoto.com/products/printers/rx1hs) lists its Mac print driver, and describes the detailed status app (remaining media, printer status and lifetime count) as a **Windows** tool.
- The booth reads the Mac/CUPS queue state, driver status message and state reasons. Paper empty, ribbon empty, cover open, paper jam and connection errors are shown when the installed driver exposes them. A known blocking error prevents a new direct submission. While the review or admin screen is open, status refreshes every five seconds.
- [CUPS backend documentation](https://openprinting.github.io/cups/doc/api-filter.html) defines these driver-reported state reasons, including `media-empty`. An idle queue alone does **not** establish that the paper/ribbon is loaded or that USB hardware is ready. The panel labels the status source and shows remaining sheets as unavailable; it never estimates paper from the event's print count.
- [DNP's European RX1HS download listing](https://www.dnpphoto.eu/en/support-and-downloads/drivers-tools/drivers/rx1hs-1) advertises driver 5.2.7 for macOS 11–15. That listing does not establish support for a newer event Mac's exact macOS version. Confirm the currently supported driver with DNP for that machine.

The DS-RX1HS has **not** been physically connected during development. A real paper-out/unplug/reload test is required to establish exactly which alerts its driver forwards. Exact remaining-paper telemetry would need a supported DNP hardware/status integration beyond this queue connection. No driver, firmware, printer configuration, or physical print was changed during these checks.

Print jobs go through macOS's local CUPS socket, with local TCP as a fallback. Guest JPEGs are converted to PDF in a private temporary folder and removed after submission; the OS manages its own spool and retention. A timeout produces an uncertain status and asks the operator to inspect the Mac queue before trying again.

## 16 GB Mac mini profile

The default **Efficient** profile uses one 1280 × 960 camera request, capped at 30 fps, with face checks at 5 Hz. Only one analysis request is in flight; slow frames are skipped rather than queued. Analysis is bounded to 640 px on its longest side and exact-frame still snapshots to 1600 px. Final portraits retain the artwork's full size (1024 × 1536 for the two bundled frontal scenes).

The guest screen skips the hidden live composite and its per-frame tone correction; final stills still receive tone correction. Full-size prepared template caching is capped at three, the library uses small thumbnails, test people and legacy templates are omitted from ordinary guest startup, and worker buffers are reused during live checks and released after still processing. Starting a new guest clears the active photo.

These choices target a 16 GB Apple-silicon setup. They are not an M6 benchmark or a guarantee of a sustained frame rate. The CPU/WebAssembly pipeline does not use Core ML or Apple's Neural Engine. Run an extended session on the actual Mac, browser, camera, display and lighting before an event. Select 10 Hz in admin if that machine benefits from faster guidance.

## Weekly photo folders and storage

Automatic saving is **on by default**. Every successfully generated guest portrait is saved as a high-quality JPEG (quality 94%, full output dimensions) before review. Original webcam frames, PNG duplicates and print PDFs are not retained in the archive. Each retake is another capture and gets its own file; reprints and retransmissions reuse the existing capture and do not create another archive copy. Sample/simulated sessions are excluded.

The default folder is `photos/` beside the app:

```
photos/
  2026-W43/
    2026-10-21_14-25-02_<capture-id>.jpg
  2026-W44/
    2026-10-26_09-10-11_<capture-id>.jpg
```

Folders use ISO week years/numbers, **Monday–Sunday in Asia/Dubai (UTC+4)**. A week that crosses New Year belongs to its ISO week year. Names include the capture UUID, so simultaneous photos cannot overwrite each other. A retried save stays in its originally assigned week, even after a restart or week rollover.

Measured with Chrome's actual canvas encoder on the existing 1024 × 1536 finished sample:

| Format | Sample size | 30,000 copies |
| --- | ---: | ---: |
| Archive JPEG, quality 94% | 0.470 MB | 14.10 GB |
| Print JPEG, quality 98% | 0.769 MB | 23.08 GB |
| PNG | 3.296 MB | 98.87 GB |

These are sample-derived estimates in decimal MB/GB, not fixed sizes. **Budget about 15–30 GB for 30,000 final JPEGs with the included artwork; keep 50 GB free** for larger artwork and additional retakes. A separate backup needs additional space. The Storage tab calculates an updated 30,000-photo estimate from the actual archived average. It shows a low-space warning below 5 GiB free and refuses new writes that would leave less than 1 GiB. It never automatically deletes photos.

Use `--photos-dir "/Volumes/Event Drive/Misrah Photos"` to choose an archive on another drive. The drive must remain connected; an unavailable Mac external volume produces an error rather than silently falling back to internal storage. With a custom `--data-dir` and no `--photos-dir`, the archive goes into that data directory's `photos/` folder. Archive folders inside `public/` are rejected.

A save uses a private temporary file, flushes it to disk, and atomically renames it. Persistent capture IDs prevent duplicate files after a lost response. Failed saves display an alert, pause clearing/idle reset of the current photo, and expose **Retry saving current photo** in admin Storage. Retry before closing the browser; the current image is retained in that browser's memory. An operator can explicitly pause automatic saving to continue without an archive. Existing archived photos remain. Copy completed weekly folders to a separate backup drive.

## Local data and privacy

`.local-data/` contains SQLite settings/counters/job/archive metadata and reusable artwork/thumbnails. The default `photos/` folder contains the finished guest JPEGs. Both are outside `public/`, excluded from Git and distribution ZIPs, and intentionally survive guest resets and restarts. Preserve both folders when moving the booth. The archive is not exposed as a web gallery.

Original camera frames, face landmarks and intermediate corrected images stay in browser memory and clear with the guest session. Finished JPEGs are saved locally by default. Direct printing also sends the final image to the loopback service and selected OS queue; the OS manages its separate spool. Explicit downloads are additional saved files. No cloud service or analytics is contacted. The loopback API validates host/origin and requires a same-origin request token for writes. Guest wording reflects whether automatic saving is enabled.

The old preparation studio remains at `/studio.html` for diagnostics, separate from the frontal-only guest library. `/?sample=woman`, `?sample=man`, or `?sample=bearded` renders clearly labelled fictional sample portraits; `?camera=sample` exercises simulated capture. Sample modes neither archive nor affect activation usage. The plain address uses the configured camera.

## Development and verification

`npm ci --ignore-scripts` restores the pinned MediaPipe development dependency. Runtime resources are already bundled. Run:

```
npm test
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

For browser verification, start a disposable data directory with `python3 server.py --port 8767 --no-open --data-dir /tmp/misrah-qa`. With Playwright and Chrome available, run `PHOTOBOOTH_URL=http://127.0.0.1:8767 node scripts/verify-kiosk.mjs`, then `node scripts/verify-admin.mjs` with the same URL. `PLAYWRIGHT_PATH` can point to an existing Playwright `index.mjs` installation.

The kiosk script covers the real local model, both frontal templates, lights, cancellation, automatic capture, retake, export, print layout, idle cleanup, mobile layout, denied camera and studio startup. The admin script checks shortcut access, saved settings, accepted frontal imports, rejection of blank/angled inputs, library persistence and visibility, deduplicated counts, CSV export, and native-print/error UI with a mock bridge. Python checks cover persistence, print deduplication under concurrency, paper/ribbon faults, timeouts, completion/cancellation accounting and temporary-photo handling. Hardware output is not mocked as a successful physical print.

The archive browser check is `node scripts/verify-archive.mjs` against the same disposable server; it saves only fictional QA fixtures.

See `IMPLEMENTATION.md`, `qa/v07-verification.md`, and `THIRD_PARTY_NOTICES.txt` for implementation details, verification evidence and model/runtime provenance.
