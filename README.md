# Misrah Studio — local photobooth v0.10

A clean, touch-first photobooth for an Apple-silicon Mac mini with 16 GB unified memory. Guests choose a straight-facing heritage portrait, look at the camera, and print a keepsake. Everything runs on the booth computer. This prototype uses geometric face insertion and local tone correction, rather than a cloud or neural identity-swap service.

## Misrah branding

Finished portraits include the supplied official Arabic/English Misrah logo at the top right and the Instagram icon with `MISRAH_AE` at the top left, following the supplied reference. No Nahj logo is included. The warm cream 4 × 6 layout preserves the entire source photograph without cropping. The result preview, saved copy, local photo archive and both printing routes use the same branding composition. Exports are at least 1200 × 1800 pixels; lower-resolution source photographs are fitted rather than given additional image detail. The supplied black logo is used without recolouring or distortion, with a visible width of at least 312 pixels and clear space.

## Locked landscape screen

The launcher opens `/landscape.html`: a fixed 1920 × 1080 (16:9) guest screen. It scales uniformly to the browser window and centres with dark borders when the display has another aspect ratio. Resizing never changes the guest layout or switches it into a mobile/portrait layout. Camera dialogs, processing, portrait choices and results all use the same fixed viewport. This locks the app layout rather than changing the operating system display settings. Prints remain 4 × 6 portrait. The original `/index.html` remains available for responsive diagnostics.

## Start

Requires a recent desktop Chrome or Edge browser. The Windows x64 release includes Python; the macOS package and source checkout require Python 3.9+. Double-click **Start Photobooth.command** on macOS, or run `python3 server.py`. Keep its window open. The address is normally <http://127.0.0.1:8765/landscape.html>. If the port is busy, use `python3 server.py --port 8766`.

On Windows 10/11 x64, extract the complete Windows ZIP to a writable folder, then double-click **Start Photobooth.bat**. Do not run it from inside the ZIP. The launcher opens Microsoft Edge full screen automatically (Chrome is the fallback), using a separate booth browser profile. Keep the console open. Press **Alt+F4** to close the booth browser; stop the server with **Ctrl+C** in its console. For ordinary browser access, run `Start Photobooth.bat --windowed`. Allow camera access on first use. No Python or Node installation is required for the Windows release. For direct printing, install the manufacturer’s Windows printer driver, then choose **Direct to selected printer** in admin, select the printer and its reported 4 × 6 paper size, and save. The app submits one copy to the Windows spooler without opening a guest print dialog. Browser printing remains available. File-output printers such as Microsoft Print to PDF are excluded from direct printing. Windows ARM64 and 32-bit packages are not included.

Camera access requires this local address; opening `index.html` directly will not work. The bundled model, runtime, artwork and lights clip work offline. No Node installation or additional Python packages are needed to operate the booth.

## Guest flow

**Touch to start → choose a portrait → lights → look straight ahead → automatic capture → print or retake.**

The three supplied final portraits are enabled initially: The basket weaver, The pearl diver and The sailor. The welcome screen uses the supplied basket-weaver artwork. The female portrait keeps the original gold face plate as foreground; only its two eye openings reveal the guest. The male portraits fill their complete oval face openings. Large cards start capture with one tap, without a second scene preview or exposed settings. A single camera view gives short, actionable guidance. Retake keeps the chosen portrait; Choose another portrait clears the photograph. Finish clears the photograph and print image for the next guest. After two idle minutes, the session clears, with a warning during the final 20 seconds. Processing, printing and the open admin panel suspend that timer.

On the `experiment` branch, MediaPipe maps the guest's face live. A smoothed outline follows their face, eyes, nose and mouth; guests can stand off-centre as long as their whole face is visible and large enough for a clear photograph. After the lights, two clear, straight-facing observations start a visible **3 → 2 → 1** countdown. **The shutter fires when 1 appears**, two seconds after 3 starts. The counter sits in a corner so guests can see their face and make their pose. The captured moment remains visible briefly before processing.

The countdown runs on a fixed clock, without requiring a continuously steady pose. Small movement, focus/exposure changes and a brief detection loss do not restart it. Leaving the view, additional faces or an unsuitable pose sustained for 250 ms cancels it; the shutter still requires one complete, front-facing face and a recent measured image. Light/focus checks arm the countdown but do not delay the shutter after it begins.

**Take picture now** is available as soon as one complete, front-facing face is detected, even while light or focus advice is showing. It takes the measured current frame immediately. The booth crops that frame around the face and automatically positions, sizes and rotates it into the selected portrait using the eyes. The captured pixels and landmarks stay paired even when the next camera frame is being analysed. Outline smoothing and a brief guidance delay affect display only; they never supply stale landmarks to the shutter.

The three final artworks have fixed, calibrated face/eye openings because their blank faces cannot be detected by a face model. Original supplied pixels remain unchanged outside those openings. The older generated scenes remain diagnostic fixtures in the preparation studio, and bundled test guests are synthetic. Additional admin imports still require a visible, detectable frontal face; new blank-face artwork needs its own opening calibration.

## Hidden admin panel

Press **F2** to open the admin panel on Windows or Mac (use **Fn+F2** if your keyboard assigns F2 to a hardware control). **Control + Alt + Shift + A** and **Command + Option + Shift + A** also work. Repeat the shortcut or press Escape to close it. Opening admin stops an active camera; the guest can start capture again afterward.

- **Devices:** choose the camera, 4K/30 face updates per second or standard 5/10 updates, printing mode, installed Mac printer, and a supported 4 × 6 paper size. The performance readout reports actual camera dimensions, delivered camera fps, measured tracking fps and GPU/CPU backend from the latest session. Find cameras requests permission, enumerates cameras, and immediately stops its temporary stream. Save applies the choice to the next capture and persists it across restarts.
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

On `experiment`, new installations default to **4K camera · target 30 face updates/sec**. This requests 3840 × 2160 at up to 30 fps, retains original-resolution camera pixels for the final face crop and analyses a 640 px copy. Existing saved 5/10 Hz choices are preserved; select 30 in the hidden admin panel to upgrade an existing installation. Standard modes request 1280 × 960 at up to 30 fps. The camera/browser can negotiate a lower mode; the operator readout shows what was actually supplied.

The tracker uses a GPU-accelerated MediaPipe worker when supported, with a CPU/WASM fallback. Camera-frame callbacks follow newly delivered frames. Only one analysis request is in flight; a late worker processes the latest available frame next, with no image backlog. At most two native-resolution camera bitmaps are retained during analysis (about 66 MB of raw RGBA pixels at 3840 × 2160, excluding browser/model overhead), and are closed on replacement or stop. Full 4K pixels are cropped only at the shutter. The source compositor retains the artwork's full size (1122 × 1402 for the female artwork and 1024 × 1536 for each male artwork); the branded keepsake fits that complete image into a 1200 × 1800 or larger 4 × 6 layout.

The guest screen skips the hidden live composite and its per-frame tone correction; final stills still receive tone correction. Full-size prepared template caching is capped at three, the library uses small thumbnails, test people and legacy templates are omitted from ordinary guest startup, and worker buffers are reused during live checks and released after still processing. Starting a new guest clears the active photo.

These choices target a 16 GB Apple-silicon setup. GPU acceleration uses browser WebGL; there is no Core ML/Neural Engine integration. Camera fps and measured face-tracking fps are separate readings, and 30 tracking fps is a target until validated on the event machine. Run an extended session on the actual Mac, browser, camera, display and lighting before an event. The benchmark script is `node scripts/benchmark-camera.mjs`, using the same `PHOTOBOOTH_URL` and `PLAYWRIGHT_PATH` variables as verification. Its synthetic 4K stream and the development Mac cannot certify physical Link 2 or 16 GB M6 performance.

The [Insta360 Link 2 supported modes](https://onlinemanual.insta360.com/link2/en-us/faq/functions/clientsoftware) include 4K at 30 fps. Choose the physical **Insta360 Link 2** camera in admin for this setup. The [manufacturer's setup guide](https://onlinemanual.insta360.com/link2/en-us/operating-tutorials/reframe-live/live-tutorial-cameraconfiguration-tutorial) recommends closing Link Controller's preview when another application uses the camera. Test exposure and autofocus in the actual booth lighting, and check the reported camera mode rather than assuming a 4K request was granted.

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

### Optional pose correction experiment

Open `/pose-demo.html` for a before/after comparison using reference samples or a photo processed on this device. `/?pose=correct` enables the experiment for real camera captures; `/studio.html?pose=correct` exposes a checkbox to compare it with the original fit. Ordinary booth links keep the existing capture flow. The 3 → 2 → 1 sequence still takes the photo as 1 appears.

After capture, the worker gently reprojects the guest's measured face surface toward the portrait's head angle and resamples that same photo. It keeps the outer contour fixed and tapers the adjustment toward it. Eye alignment and colour matching then produce the finished portrait. This can reduce small yaw/pitch differences; it does not reconstruct a hidden cheek, fix blur or guarantee a fully frontal face. Large or unstable corrections retain the original. Camera pose limits remain in place.

Run `node scripts/verify-pose-correction.mjs` with the same browser environment variables below. It checks five samples, measured pose changes, the actual studio compositor, exact undo, worker failure/stale-result fallback, mobile layout and normal/native-4K simulated guest capture. Results and timing limits are in `qa/pose-correction-verification.md`. The previous capture implementation is preserved in commit `362d5c1`; the pose trial is a separate working-tree change on `experiment`.

`npm ci --ignore-scripts` restores the pinned MediaPipe development dependency. Runtime resources are already bundled. Run:

```
npm test
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

For browser verification, start a disposable data directory with `python3 server.py --port 8767 --no-open --data-dir /tmp/misrah-qa`. With Playwright and Chrome available, run `PHOTOBOOTH_URL=http://127.0.0.1:8767 node scripts/verify-kiosk.mjs`, then `node scripts/verify-admin.mjs` with the same URL. `PLAYWRIGHT_PATH` can point to an existing Playwright `index.mjs` installation.

The branding check is `node scripts/verify-branding.mjs`; it validates all three approved portraits, foreground preservation including the gold plate, branded output, synthetic automatic capture, exports, print dimensions, reset clearing, mobile layout and logo failure handling.

The kiosk script covers the real local model, all three approved templates, lights, cancellation, automatic capture, retake, export, print layout, idle cleanup, mobile layout, denied camera and studio startup. The admin script checks shortcut access, saved settings, accepted frontal imports, rejection of blank/angled inputs, library persistence and visibility, deduplicated counts, CSV export, and native-print/error UI with a mock bridge. Python checks cover persistence, print deduplication under concurrency, paper/ribbon faults, timeouts, completion/cancellation accounting and temporary-photo handling. Hardware output is not mocked as a successful physical print.

The archive browser check is `node scripts/verify-archive.mjs` against the same disposable server; it saves only fictional QA fixtures.

The dynamic mapping check is `node scripts/verify-face-mapping.mjs` (default port 8768, or set `PHOTOBOOTH_URL`). It uses the bundled model on four off-centre sample captures, both shutter paths, quality failures, tracking cleanup, and a delayed-inference shutter check. `node scripts/verify-quick-capture.mjs` checks the visible 3/2/1 sequence, shutter timing on 1, jitter/focus tolerance, stable guidance, cancellation and the manual override with controlled detector sequences. See `qa/experiment-verification.md` and `qa/quick-capture-verification.md` for results.

See `IMPLEMENTATION.md`, `qa/v07-verification.md`, and `THIRD_PARTY_NOTICES.txt` for implementation details, verification evidence and model/runtime provenance.

## Release packages

Run `python3 scripts/build-release.py` to create macOS and Windows x64 ZIPs plus `SHA256SUMS.txt` in `dist/`. Windows bundles the official Python 3.14.10 embeddable runtime from python.org, checked against a pinned SHA-256 digest; its license is included in `runtime/LICENSE.txt`. macOS uses the installed Python. Both contain the current offline artwork, models, scripts and landscape screen. Local settings, guest photographs, development dependencies and QA files are excluded. `BUILD.json` records the source revision.

The desktop packages workflow builds and verifies each package on its native operating system, including launching the embedded Windows Python from a folder containing spaces. For a local package smoke check, run `python3 scripts/verify-package.py dist/<package>.zip` on the matching operating system. Releases are attached as GitHub Release assets, outside source control.

Windows direct printing uses the installed Windows PowerShell 5.1, .NET desktop printing APIs and GDI. Printer and paper choices come from the installed driver. Driver-reported paper, door, offline and queue errors block submission. The Windows spool job ID is recorded and request deduplication prevents resubmission; timeouts remain uncertain and are never retried automatically. Jobs disappearing from the queue remain unknown rather than being counted as completed. Driver support determines ribbon alerts; remaining media is not inferred. Physical printer output must be verified with the event printer.

## DNP RX1HS setup on Windows

1. Extract the entire Windows release ZIP into a writable folder. Do not run inside the ZIP.
2. Install the official DNP driver for the exact printer and Windows version: [DNP RX1HS drivers](https://www.dnpphoto.eu/en/support-and-downloads/drivers-tools/drivers/rx1hs-1). Follow the included connection instructions, connect the printer by USB, load matching paper and ribbon, and power it on.
3. In Windows **Printers & scanners**, open the DNP printer and print a Windows test page. In its printing preferences, select **4 × 6 / 6 × 4**, one copy, and your intended finish. Use the single-photo size, rather than a double-print or strip mode.
4. Open **Start Photobooth.bat**. The booth opens full screen. Press **F2**, then **Devices**.
5. Choose **Direct to selected printer**, click **Refresh printers**, select the DNP queue, and choose its reported **4 × 6 inch** photo paper. Click **Save device settings**.
6. Close admin with **Esc**. Capture one portrait and tap **Print my photo**. Confirm one complete 4 × 6 print, orientation, borders and colour before starting the event.

If the DNP queue is absent, confirm that Windows can print to it and refresh the printer list. If no 4 × 6 size appears, check the manufacturer’s driver and paper settings; the booth lists sizes reported by that driver. After an uncertain submission, check the Windows queue before requesting another print.
