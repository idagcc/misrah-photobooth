# Live v0.2 verification — 19 October 2026

Environment: current Mac with Apple M5 Pro and 48 GB RAM, Codex in-app Chromium. This is not a benchmark of the proposed 24 GB Mac mini. Testing used a labelled canvas-generated sample stream; no physical webcam was activated.

## Passed

- Local CPU/WASM model starts with facial transformation matrices enabled.
- All three client scenes calibrate and become selectable. Their masks, eye alignment, centred pose references and colour profiles are prepared locally.
- Live VIDEO inference, pose/quality feedback and corrected composite refresh continuously. Balanced mode targets 10 checks/sec; observed UI readings were generally around 9–11. Fast mode was selected and a 14.8 checks/sec reading was observed. Timings are short-run observations with variable browser load, not a sustained performance guarantee.
- No-face stream: requests that the guest enter the frame; auto capture blocked.
- Two-face stream: requests one guest at a time; auto capture blocked.
- Dark stream: requests soft frontal light; auto capture blocked.
- Blurred stream: requests focus/steadiness; auto capture blocked.
- Moving stream: requests holding still; the dialog stays open with auto capture enabled beyond the hold duration.
- Returning to clear/steady input allows all six checks to pass and then completes automatic capture. Failed observations reset the hold.
- Automatic capture completes against each of the three client scenes and transitions back to the main portrait editor.
- Manual Capture now works with auto capture disabled. The dialog closes and the stream is stopped by the controller.
- The auto-tone switch updates its UI state and can be restored. The original photo is retained for reversible tone correction.
- A colour regression found during review was fixed: matching sepia reference faces retain warm proportions instead of being neutralised by grey-world white balance.
- PNG export completes at 1441 × 2161. An exported auto-capture result was inspected at native resolution.
- A different supplied face was inserted into the client weaver scene through the still-photo path; native export inspected. This exposes the remaining prototype face-mask and pose-fit limitations rather than demonstrating neural face synthesis.
- All fully opaque source-artwork pixels outside the face region are unchanged in the exported PNG. Partially transparent artwork edge pixels are flattened against the app's paper background.
- Desktop live dialog inspected at 1440 px; narrow main layout at 390 px has no horizontal overflow.
- Fourteen automated checks pass: alignment, mirroring, landmark geometry, manual fallback, transparency, pose decomposition, capture gates, hold continuity/stalls, quality analysis, bounded correction and sepia retention.

## Remaining event validation

- Actual USB webcam capture, permission flow, camera switching, autofocus and exposure behaviour on the client machine.
- Sustained operation and performance on the exact Mac mini chip and attached display configuration.
- Calibrate pose direction, thresholds and the three prototype masks against varied consenting guests. Large head turns, occlusions and strong shadows remain capture limitations.
- This build provides exposure/white-balance/sepia correction and 2D alignment, not neural relighting, novel head views or photorealistic identity swapping.

## Evidence

- `live-preview.png`: simulated live camera with all quality checks passing and the client scene composite.
- `live-studio-preview.png`: main editor with a different supplied face in the Misrah scene.
- `live-auto-capture.png`: native PNG exported after automatic sample capture.
- `live-different-face.png`: native PNG with a different supplied reference face.

The simulated stream is derived from the original face in each selected client scene. It verifies processing and capture policy, not independent guest quality or physical webcam performance. The separate different-face check is a still-image test.
