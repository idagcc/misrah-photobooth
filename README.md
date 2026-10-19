# Misrah Studio — guest kiosk photobooth v0.5

A working local prototype with two generated frontal test scenes, three generated test guests, the three client-supplied Misrah designs, live pose and quality guidance, automatic capture, a live composite, and automatic colour/exposure correction. A guest can also upload a photograph. All processing runs in the browser on the device, using the bundled MediaPipe Face Landmarker model and CPU WebAssembly runtime.

## Open the app

Requires Python 3 and a recent desktop Chrome or Edge browser. No Node installation, account, API key, internet access, or GPU is required to run the delivered folder.

- **macOS:** double-click **Start Photobooth.command**. Keep the window open.
- **Windows:** double-click **Start Photobooth.bat** with Python 3 installed.
- **Any supported desktop:** run `python3 server.py` from this folder (Windows can use `py -3 server.py`). Open the address it prints, normally <http://127.0.0.1:8765>.
- Stop the app with Ctrl+C in its server window. If the port is busy, run `python3 server.py --port 8766`.

Open through the local server, rather than double-clicking `public/index.html`. Browser camera permissions, workers, modules, and the model require a local HTTP origin. If the in-app preview does not allow a camera, open the same local address in Chrome or Edge.

## Guest experience

The default page is a touch-first guest kiosk: **Touch to start → tap one of six templates → lights video → automatic photo → Print or Retake**. The six templates are the two generated frontal scenes, three client Misrah designs, and the original artisan portrait. Tapping a template starts the bundled four-second lights video and opens the camera in the background. After the clip, the guest sees the camera and simple guidance. A continuously suitable, steady face starts a three-second countdown; losing the pose resets it. **Take picture now** is also available once the quality checks pass. Camera permission and detector failures offer a retry action.

The review screen shows the finished portrait with **Print my photo**, **Retake photo**, **Choose another template**, **Save a copy**, and **Finish · Next guest**. Retake clears the previous photo and starts capture again with the same template. Choosing another template clears the photograph and returns to the six choices. Finish clears the photograph and print image and returns to Touch to start. After two minutes of inactivity a session resets, with a warning for the final 20 seconds; active image processing and the print dialog pause this timeout.

**Printing:** Print my photo opens the browser/system print dialog with only the finished photograph on a 4 × 6 inch page. Select the connected printer, 4 × 6 paper and suitable scaling in that dialog. A template with a different aspect ratio is fitted without cropping. Closing or cancelling the print dialog keeps the portrait available; the app does not claim a print job succeeded. Silent printing and control of physical lighting require event hardware configuration and are not provided by the browser app. The lights sequence is an on-screen MP4, not a command to physical lights.

All processing stays on this device. Guest photos remain in memory until cleared or the page is refreshed; explicit downloads remain saved. Adjustment sliders, uploads, generated test faces, pose values, performance settings and diagnostic controls are absent from the guest interface. The operator studio remains separate.

A labelled client sample is available at `http://127.0.0.1:8765/?sample=woman`; supported sample names are `woman`, `man` and `bearded`. An optional `scene=frontal-pearl-trader` selects that scene. These URLs render fictional sample portraits without opening a webcam. For internal flow verification only, `?camera=sample` makes a template tap open a clearly labelled simulated stream. The plain local address always requests a real camera.

The previous adjustment studio remains available at `http://127.0.0.1:8765/studio.html` for template preparation and diagnostics. It is separate from the guest page.

## Operator studio

1. Start with **Frontal weaver** or **Frontal pearl trader**, then click one of the three **Straight-on test faces**. These are independent fictional AI portraits. **Try the sample** still loads the original client example.
2. Choose a Misrah scene, then click **Open live camera** and allow camera access. Follow the one-face, position, angle, light, focus and steadiness checks. **Auto capture** takes the exact frame that passes for 1.4 seconds continuously; **Capture now** is a manual override. The camera view is mirrored, while the composite preserves camera orientation. The stream stops after capture, close, Escape, switching cameras, or hiding the page.
3. Alternatively, **Upload a photo** (JPEG, PNG, or WebP; up to 25 MB). The largest detected face is selected initially. Choose another person if several faces are detected.
4. Adjust size, position, rotation, mirror, warmth, brightness, and edge softness. Drag directly on the portrait or focus it and use arrow keys; Shift moves ten pixels at a time. **Auto fit** restores automatic alignment.
5. **Save portrait** downloads a PNG or JPEG at the selected frame's native resolution: 1024 × 1536 for the frontal test scenes, 1441 × 2161 for the original Misrah scenes, or 1312 × 1199 for the original sample. Export always uses the composite and omits adjustment guides.
6. **Start fresh** clears the guest photograph and returns to the default frontal weaver scene. Saved downloads remain wherever the operator saved them.

No face found? The photo stays loaded with manual positioning enabled. Use a clear, well-lit, front-facing photograph for the best result. If the detector cannot load, manual positioning remains available.

**Test live guidance with a sample** creates a simulated camera stream from the selected generated test person. The **Test person** menu can also select the current scene's own face for calibration; use an independent generated person to test replacement quality. Its clear, dark, blurred, moving, two-face and no-face modes exercise the actual detector and capture rules without using a webcam. This is a diagnostic stream, not a captured guest or a hardware benchmark.

**Automatic colour & exposure** is enabled by default. It applies restrained exposure/white balance plus the client artwork's sepia treatment, using luminance rather than forcing the reference person's complexion. It keeps the original photo in memory so the adjustment can be disabled. Manual brightness and warmth remain available. Live performance can be set to 5, 10 or 15 checks per second independently of the requested 30 fps camera feed.

## Frames

The two frontal scenes and three guest headshots in `public/assets/frontal/` were created with the built-in Image Generation tool. They are synthetic alignment fixtures, not approved client artwork. Exact prompts and asset provenance are in `qa/frontal-generation-prompts.json`.

The three Misrah scenes are extracted copies of the client PDF artwork. The local detector prepares a face contour, target eye positions, normalised target head pose, and colour statistics for each scene. Their masks are prototype masks and should be refined against real guest portraits before an event. The original sample remains available as another scene; its blue placeholder is removed with a restricted chroma mask.

**Add your own frame** accepts PNGs. One enclosed transparent region is inferred as the face opening. An opaque PNG uses a movable oval: enable **Adjust frame opening**, drag it into place, resize its width and height, then disable the guide. Custom frames are kept in memory for the current session. Large custom frames are resized to at most 4096 pixels on their longest side; photographs to at most 2400 pixels. Images above 36 megapixels are rejected to keep memory use bounded.

Prepare one opening per template for this MVP. A transparent background touching the image border is deliberately excluded from automatic opening detection.

## Local architecture

`Camera → exact-frame snapshot → paced worker pose/quality/tone → live composite → steady-pose auto capture → full-resolution correction → PNG/JPEG`

- `public/app.js` owns the image session, camera connection, compositing, adjustments, and export.
- `public/guest-flow.js` owns kiosk navigation, video playback, print preparation, retry, cancellation and idle cleanup.
- `public/assets/lights.mp4` is a bundled silent, four-second 1280 × 720 lights sequence. Its editable HyperFrames source is in `../videos/photobooth-lights/`.
- `public/live-camera.js` owns the live stream, pacing, quality feedback, continuous hold, manual/auto capture and live composite. Only one analysis request is in flight; frames are skipped instead of queued.
- `public/detector-worker.js` runs inference, quality analysis and tone processing off the UI thread. IMAGE mode supports four faces for uploads; VIDEO mode checks up to two faces so multiple guests block auto capture. One selected face is inserted per portrait.
- `public/live-quality.js` contains pose decomposition, quality measures, capture policy and bounded tone correction. See `IMPLEMENTATION.md` for the rough implementation and starting thresholds.
- `public/geometry.js` contains alignment and transparent-opening geometry.
- `public/vendor/` and `public/models/` bundle all model/runtime resources locally. There are no runtime CDN dependencies, fonts, analytics, or external services.
- `server.py` serves only `public/`, binds only to `127.0.0.1`, accepts no upload endpoint, and writes no photographs. Its content policy restricts outgoing requests to the same local origin.
- Guest images, camera frames, face landmarks, and custom frames stay in browser memory. The app does not use localStorage, IndexedDB, or persistent guest history. Refresh/Start fresh clears the active photo. Browser downloads are explicitly saved files.

## Scope and next steps

This is geometric face insertion with automated tone correction and soft edges. It preserves the source face and expression. Live guidance asks for a suitable head angle; it does not synthesize an unseen side of the face or a new light direction. Large pose differences, side profiles, strong shadows, hair, glasses, and occlusions can reduce quality. Frontal scenes reduce the source/target perspective difference, but do not remove forehead/chin seams or guarantee a photorealistic result. The pose estimates and quality thresholds require camera-specific event calibration. A soft frontal light is the best starting setup.

An Apple-silicon Mac mini with 24 GB RAM is a reasonable deployment target for this CPU/WASM implementation. This is an engineering assessment, not a measured Mac mini benchmark. The exact chip, camera, display and lighting still need a sustained test on the event machine. No Python processing packages or additional model downloads are needed to run this version; Python only serves the local files. Native packaging, silent printer integration and neural identity swapping remain later upgrades.

## Dependency provenance

- MediaPipe Tasks Vision **1.1.1**, npm package `@mediapipe/tasks-vision`, Apache-2.0. Bundled runtime and license notices are in `public/vendor/` and `THIRD_PARTY_NOTICES.txt`.
- Face Landmarker model bundle, `face_landmarker/float16/1`, retrieved from Google's official model storage. Model provenance is in `THIRD_PARTY_NOTICES.txt`.
- Generated frontal test fixtures: built-in Image Generation, fictional adult identities; exact prompts in `qa/frontal-generation-prompts.json`.
- Artwork and sample face: user-supplied reference images, retained as copies under `public/assets/`. Synced project sources were not modified.

For development, `npm ci --ignore-scripts` restores the pinned dependency. Runtime assets are already copied into `public/vendor`; npm is not used by the local server. Run `npm test` for geometry, pose, quality, continuous-hold and colour regression checks. Guest flow and export verification is in `qa/guest-verification.md`. Frontal fixture verification is in `qa/frontal-verification.md`; live camera verification is in `qa/live-verification.md`; `qa/verification.md` records the first MVP.

## Kiosk flow verification

Run `npm test` for image geometry, pose, quality and tone checks. For the full browser flow, start the local server and run `node scripts/verify-kiosk.mjs` with Playwright available. Set `PHOTOBOOTH_URL` if the server is not at port 8766, and optionally `PLAYWRIGHT_PATH` to an existing Playwright `index.mjs` installation. Google Chrome must be installed. This development check uses explicit simulated-camera fixtures, exercises all six templates, cancellation, retake, printing, export, idle cleanup, phone layout and permission denial, and saves QA captures under `qa/`. The operator studio is also checked. It does not validate a real camera or physical printer.
