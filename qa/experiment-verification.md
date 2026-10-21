# Dynamic face mapping — experiment branch

Verified 21 October 2026 with desktop Chrome, the bundled MediaPipe model, and a disposable local service/data directory on port 8768.

## Behavior

- The fixed camera oval is replaced by a live detected face contour and eye/nose/mouth lines, mirrored with the camera video.
- A fully visible off-centre face can pass capture; the existing size, angle, focus, light, single-face and movement checks remain.
- Both the guest shutter and automatic capture use a measured snapshot, crop around its landmarks at original pixel density, remap the coordinates and automatically fit its eyes/tilt into the template. Frontal-face confirmation now starts a fixed-clock 3/2/1 countdown with capture on 1; see `quick-capture-verification.md`.
- The next frame uses a separate buffer, so an in-flight analysis cannot overwrite the scored photograph used by a shutter tap.
- Closing or capturing stops the stream and clears the tracking overlay and both snapshot buffers.

## Checks

- `npm test`: 32 passed, including off-centre policy, crop bounds, preserved eye geometry, normalized depth scaling, camera pacing, quick confirmation, countdown timing and display-only smoothing.
- `python3 -m unittest discover -s tests -p 'test_*.py' -v`: 22 passed, including persistence of the 30 Hz profile.
- `scripts/verify-kiosk.mjs`: passed the complete guest regression flow, both frontal portraits, cancellation, retake, export, print layout, idle cleanup, mobile layout, denied-camera recovery and operator startup.
- `scripts/verify-face-mapping.mjs`: passed four real-model off-centre captures using three fictional sample people and both templates, explicit shutter and automatic capture. Face centres were approximately 28% and 72% across the source camera frame. Captures were cropped from 640 × 480 to roughly 363–365 × 439–452 pixels, with no second still-detection pass.
- No-face, multiple-face, dark and blurred samples do not trigger automatic capture. A sharp, frontal moving face can now be captured without a displacement hold.
- A controlled delayed-inference case changed the pending camera frame from red to blue, then tapped the shutter. The photograph retained the scored red pixels and their matching remapped landmarks.
- `git diff --check` and JavaScript syntax checks passed. No browser page errors were reported.

Raw measurements are in `experiment-face-mapping.json`. `experiment-*-camera.png` and `experiment-*-portrait.png` show the fictional camera inputs and fitted outputs; the overlay and both template results were visually inspected.

These checks used simulated camera streams and actual local model inference. Physical webcam, event lighting and subjective blending quality still need an on-device trial. The compositor retains the existing eye-based geometric fitting and feathering; this experiment changes tracking, capture framing and automatic placement, without adding a neural identity-morphing model.

The branch now also supports the 4K/30 tracking profile, original-resolution immutable snapshots, GPU acceleration with CPU fallback, frame-driven scheduling and measured operator diagnostics. See `4k30-verification.md` for benchmark conditions, results and hardware limits.
