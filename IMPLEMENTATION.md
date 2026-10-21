# Misrah Studio implementation — v0.7

## Guest and operator boundaries

`public/index.html`, `guest.css` and `guest-flow.js` implement the guest kiosk. The flow is welcome, frontal portrait choice, bundled four-second lights clip, camera, processing and review. The camera acquires during the lights clip, with capture gated until it ends. Two usable frontal observations in the latest three frames (within 500 ms) arm a fixed-clock 3/2/1 countdown. It shows 3 immediately, 2 at +1000 ms, and captures as 1 appears at +2000 ms. The countdown is time to pose, without a continuous steadiness requirement. Capture crops the exact original-resolution camera bitmap whose smaller copy was analysed.

Only the two frontal scenes are initially enabled. The guest no longer loads the original angled artwork, blue-key demo or diagnostic people at startup. Simulated camera and labelled sample URLs load test people explicitly. `studio.html` retains the legacy preparation workflow separately.

The guest choice screen uses large portrait cards. The finished print preview appears only on review. Device/performance controls and library management live in the hidden modal from `admin-panel.js`. The shortcut is Command–Option–Shift–A (Control–Alt–Shift–A also works). Escape closes it. It stops the live camera before opening, and idle cleanup pauses while it is open. Processing and active print submission cannot be interrupted by opening admin. No admin link is displayed in the guest flow.

## Persistent local service

`server.py` binds to `127.0.0.1` and serves `public/`. `booth_service.py` adds a standard-library SQLite service. `.local-data/` (or `--data-dir`) stores:

- One settings record: camera ID, 5/10/30 Hz analysis rate, system/direct printing mode, printer queue and media code. New settings default to 30; existing settings keep their selected rate.
- Built-in/imported portrait names and visibility, full normalized JPEGs for imports, and small thumbnails.
- Unique aggregate usage events and print job metadata: template, queue ID, state, time and generic error text. The aggregate usage view does not include guest images; archive metadata identifies locally saved final JPEGs.

Writes require the per-process request token returned to the same-origin frontend. Host and Origin are checked, cross-site requests are rejected, directory listing is disabled and request bodies are bounded. The token is a local browser capability; the panel's keyboard shortcut is intended for the booth operator.

Routes: `GET /api/bootstrap`, `/api/status`, `/api/stats`, `/api/template-images/<id>.jpg`; `POST /api/settings`, `/api/templates`, `/api/templates/toggle`, `/api/events`, `/api/print`. The `status` route can query the draft printer choice, without saving it. Settings and portrait visibility are committed immediately; guest reset only clears the active capture, not the weekly archive. `GET /api/storage`, `POST /api/archive` and `POST /api/archive/settings` support storage reporting, capture archiving and its independent setting.

Imported artwork is decoded locally, bounded by the existing upload size/pixel limits, then resized to at most 1800 px tall. It must be vertical, at least 900 px tall, and contain exactly one detectable face. The centered face crop is analysed for approximate yaw/pitch; original eye roll is checked. Initial limits are 15° yaw, 18° pitch and 12° roll. These are alignment heuristics, not a guarantee of subjective photographic quality. The server validates bounded RGB JPEG dimensions and library size; the trusted operator frontend performs the model-based face check before saving.

Frames are calibrated on demand using a landmark face contour, target eye alignment, centered pose and tone statistics. Only three prepared full-size frames are cached. Imported library cards load 200 px thumbnails. Hiding the active result's portrait clears that guest image before selecting another template, preventing an operator action from silently changing the finished photograph.

## Printing and truthful accounting

System mode decodes a full-resolution JPEG and calls `window.print()`. The print-only stylesheet creates a 4 × 6 page, fits the photograph without cropping and hides the entire guest/admin UI. Browser headers/footers and printer configuration remain system dialog choices. `afterprint` means only that the dialog closed. Each invocation is counted separately from direct jobs.

Direct mode sends the JPEG to the loopback service. The service creates a one-page 4 × 6 inch PDF with the JPEG embedded and fitted without cropping. When the driver reports landscape `6x4` media, the PDF page is 432 × 288 points and the portrait rotates 90° to fill it; portrait media uses 288 × 432 points. This avoids relying on driver auto-rotation. It validates the selected queue and discovered 4 × 6 media against the installed driver, checks reported blocking faults, then invokes `lp` once with one copy, the selected media, fit scaling, simplex and no job sheets. No shell is involved. DNP may use the media code `6x4`; codes are discovered through `lpoptions` and IPP, rather than hardcoded. Finish and colour profile follow the driver defaults.

Each print request has a UUID persisted before submission. A lock and uniqueness check prevent duplicate submissions of the same UUID, including concurrent delivery. Frontend double taps are gated. Accepted jobs record their CUPS job ID. A timeout or unconfirmed response is marked uncertain, with no automatic retry/fallback. After a server restart, incomplete submissions stay uncertain. The operator must inspect the Mac queue before making a new request.

The PDF is placed in a private temporary directory, copied by the OS spooler and removed on return/error. The OS owns spool-file retention afterward. This is local device printing, and is disclosed in the privacy wording.

CUPS is queried with IPP on `/var/run/cupsd` on macOS (or the Linux CUPS socket), with loopback TCP fallback. Printer state, accepting-jobs, message and state reasons are surfaced. Paper/ribbon empty, cover open, jam, disconnect and stopped/error reasons block new direct requests. Unknown status does not assert readiness. The admin and guest review screens poll at five-second intervals; completed/cancelled/aborted jobs leave the active polling list. At most three pending job queries are made per refresh, and print preflight skips old-job polling to keep submission latency bounded. Job errors are shown separately from printer-wide faults.

Totals distinguish selections, successful captures, native print requests, jobs accepted by the spooler, spooler-completed jobs, system print windows and errors. Accepted counts remain stable after a cancellation or lost status history. Completing a job is not a physical-sheet sensor. Retakes are additional captures; simulated/sample sessions are excluded and cannot trigger direct hardware printing. SQLite events and request UUIDs deduplicate retransmission.

## DNP DS-RX1HS evidence

Checked 21 October 2026. [DNP's product information](https://www.dnpphoto.com/products/printers/rx1hs) lists a Mac print driver but describes its detailed remaining-media Status App as Windows software. [CUPS documents driver state reasons](https://openprinting.github.io/cups/doc/api-filter.html), including `media-empty`, and that is the connection used here. This does not prove that a particular DNP driver forwards every USB hardware condition.

The UI explicitly labels queue/driver status, never equates idle with loaded paper, and reports remaining sheets as unavailable. Accurate DNP consumable counts would require an additional supported hardware/status integration. The [EU download listing](https://www.dnpphoto.eu/en/support-and-downloads/drivers-tools/drivers/rx1hs-1) advertises driver 5.2.7 for macOS 11–15; support on a newer event Mac's exact OS must be confirmed. No physical RX1HS was available in this development session.

## 16 GB Apple-silicon profile

- Video request: 3840 × 2160 in the 30 Hz profile; 1280 × 960 in 5/10 Hz profiles. Ideal/max 30 fps, audio disabled. These are preferred dimensions; negotiated values are reported separately.
- Analysis: longest side ≤640 px, target 30 Hz for new settings, optional 5/10 Hz. `requestVideoFrameCallback` follows frame presentation; a timer supports browsers without that API. Only one live job is in flight; the latest frame token replaces older unprocessed tokens without queuing images.
- Guest preview: mirrored camera only. Hidden live composite painting and per-frame correction are skipped. Final still correction remains enabled.
- One Face Landmarker worker, with a dedicated OffscreenCanvas for GPU/WebGL inference and automatic CPU/WASM fallback during initialization. It reuses analysis allocations and releases full-size worker buffers after still jobs. Camera snapshots use at most two original-resolution ImageBitmaps, about 66 MB of raw RGBA pixels at 4K, excluding browser/model/driver allocations. Both are closed when replaced or stopped. Full-frame 4K 2D raster copies are avoided during tracking.
- A maximum of three full-size calibrated frames, small library thumbnails, and no diagnostic assets on normal startup. Guest image references and canvases are cleared on finish/idle reset.
- Native output: 1024 × 1536 for included frontal scenes, up to the import bound for additional artwork. The final photograph is not reduced to the live-analysis size.

These are resource-bounding choices for the requested 16 GB machine. WebGL acceleration does not use a native Core ML/Neural Engine integration. `booth-camera-performance` events report the camera size, negotiated frame rate, measured presentation rate, cumulative tracking throughput, last inference time and actual delegate. The hidden operator panel keeps the last session's readings after stopping the camera. The target 16 GB M6, Link 2 USB capture, lighting and driver still need a sustained event-machine test.

## Core image pipeline and thresholds

`Camera → original-resolution bitmap → 640 px worker analysis + smoothed face display → frontal face/quality confirmation → 3 → 2 → shutter on 1 (or manual shutter) → native face crop + remapped landmarks → still tone correction → eye alignment + feathered template → JPEG/PNG or print`

`live-quality.js` provides matrix pose decomposition, exposure/sharpness metrics, quality policy and bounded tone correction. Exposure adjustment is restrained to 0.8–1.28×, white-balance channel gain to 0.9–1.1×, with a small shadow lift. A matching artistic colour treatment is applied without forcing the guest to the original face's complexion. `geometry.js` owns eye alignment, the shared face contour, padded camera crops, landmark coordinate remapping, manual geometry and opening inference. The legacy studio retains manual positioning and tone controls.

The guest automatic policy arms with one fully visible face of sufficient size, approximately 16° yaw / 17° pitch / 18° roll relative to the frontal target, usable face luminance (about 42–224/255), limited asymmetric shadow and fixed-crop Laplacian sharpness ≥16. `requireSteady: false` removes displacement as a shutter gate. `advancePoseCountdown` uses `advanceQuickCapture` to arm from two good observations, then advances independently of quality fluctuations. A face/size/pose failure gets 250 ms grace during 3/2, but any invalid face at the shutter deadline cancels capture. A separate timer keeps the number changes aligned to the wall clock. Both countdown and manual shutter require `canCaptureFace` and a recent measured bitmap; light/focus advice does not delay 1. Neither path can capture during lights. The operator studio retains the original timed steady hold and elapsed-time motion thresholds.

On 1, the image is copied synchronously from the scored bitmap, then the camera display pauses for 180 ms so 1 and the captured moment can be painted. Only then does processing open. Closing during that interval cancels the pending delivery and returns to portrait selection; a committed capture is distinguished from a pending shutter. Stop/cancel clears the countdown timer, and in-flight analyses cannot overwrite the frozen moment.

The mirrored face-map canvas uses the same contained aspect ratio as the video, including letterboxing. It draws the current MediaPipe oval and feature lines; it has no fixed guide to match. Both normal and simulated cameras use it. Capture uses a separate scored snapshot, while the next frame is acquired into a second buffer. A guest shutter tap during inference therefore retains the last measured pixels and their matching landmarks. The face crop adds 30% padding per side, clamps to camera bounds and retains original pixel density; normalized landmark X/Y/Z coordinates are remapped to that crop. `setSource` reuses these observations instead of detecting the cropped still again. Uploaded photos and the studio manual override continue to run their own detection. Stop/cancel/reset clears both image buffers, mapping canvas and observations.

`live-display.js` smooths only displayed landmark X/Y coordinates with a 75 ms time constant, resets on large jumps/multiple faces, and fades an isolated loss for up to 150 ms. The guest outline keeps a consistent colour; guidance changes wait 250 ms to settle, while successful automatic confirmation is shown immediately. Raw face count, pose, quality, crop coordinates and capture gates remain unsmoothed. A transient missing face therefore cannot authorize a shutter even while its outline is briefly fading.


## Weekly archives — v0.7

Final portraits are automatically saved as JPEG at canvas quality .94, after full-resolution tone/compositing completes and before guest review. This is separate from print JPEG quality .98 and export PNG. One UUID is assigned per completed capture; retakes get another UUID, reprints do not archive again. Sample/diagnostic URLs are excluded. Original webcam frames are not persisted.

`archives` records capture UUID, template, original event timestamp, ISO week, relative filename, bytes, SHA-256, state and last error. The default folder is `photos/` beside the application, outside public/ and Git. With a custom data directory, its photos/ subfolder is used unless `--photos-dir` overrides it. The server rejects a photos path inside public/. Explicit Mac /Volumes paths require a mounted volume, preventing fallback onto an internal replacement folder after drive removal.

A capture reserves its timestamp/path before writing. Weeks are Monday–Sunday in fixed Dubai UTC+4, independent of the host's timezone. ISO week years handle New Year. Private temporary files are flushed/fsynced and atomically renamed. The row then becomes saved. A retry with the same UUID and matching digest reuses the file and original week. A UUID with different bytes/template is rejected. Pending rows with an already-complete file recover after an interrupted DB commit/HTTP response. Failed rows remain visible in storage status.

The frontend retains one pending JPEG for an operator retry after a save error, pauses idle clearing and guest navigation while that photo remains unsaved, and exposes Retry saving current photo in Storage. Successful retry clears the pending copy and resumes navigation. Explicitly pausing saving discards that pending browser copy and permits continuation; existing archive files are untouched. Closing the browser after a failed write can lose the pending image, so the failure UI asks for an attendant before leaving.

Storage totals and week groups query indexed metadata rather than walking/decoding 30,000 images. Free space comes from the archive drive; warnings start below 5 GiB and writes stop before reducing free space below 1 GiB. There is no automatic deletion or retention expiry. Admin shows the actual average × 30,000 as a live estimate. Sample measurements (qa/storage-estimate.json) from Chrome: .94 JPEG 469,877 bytes, .98 JPEG 769,231 bytes, PNG 3,295,576 bytes for the same 1024×1536 output. Thus the configured archive is about 14.1 GB per 30,000 of this sample; 15–30 GB is a planning range for the included art, with 50 GB free advised for variation/retakes. Larger/different artwork and backup copies change the total.
