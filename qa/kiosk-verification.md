# Guest kiosk verification — v0.5

19 October 2026. Google Chrome headless, local server on port 8766. Explicit simulated-camera fixtures; no real guest, webcam or physical printer used.

## Browser integration

The reproducible development check is `scripts/verify-kiosk.mjs`. It ran successfully against the actual bundled MediaPipe worker and image compositor, with no page errors.

- The default route opens Touch to start; entering reveals six enabled templates.
- Tapping a template immediately starts the bundled four-second lights video while the camera opens. Capture remains gated until the lights screen ends.
- Cancelling during the overlapping video/camera startup returns to templates, stops the stream, and does not produce a delayed capture.
- The normal simulated guest completes the three-second steady-pose countdown and produces a final portrait. The camera stream is stopped at review.
- All six calibrated templates completed camera → automatic capture → review using their explicit scene-reference fixtures: frontal-weaver, frontal-pearl-trader, misrah-1, misrah-2, misrah-3, heritage-frame. These fixtures test the flow/compositor, not identity-swapping quality or pose suitability for arbitrary guests.
- Print my photo passes a decoded full-resolution JPEG to the print sheet and invokes the print action. The external print window was stubbed; the actual print stylesheet was separately rendered through Chrome PDF output.
- Print proof: `kiosk-print.pdf`, one page, 288 × 432 points (4 × 6 inches). Its rendered proof contains only the portrait, with no buttons, caption, sample text or guides. A differently proportioned template fits with margins rather than cropping.
- Save a copy downloads a native 1024 × 1536 PNG for the frontal scene.
- Retake clears the print image and restarts capture with the same selected template. Choosing another template clears the guest and returns to all six choices. Finish disables photo export and returns to welcome.
- An accelerated wall clock exercised the 20-second idle warning and two-minute session cleanup.
- A rejected camera-permission request exposes a retry action and helpful guidance, retains no stream and returns to templates when closed.
- Desktop 1440 × 1080 and phone 390 × 844 screenshots were inspected. Phone layouts have no horizontal overflow. After the full integration pass, the phone result was tightened and re-inspected to bring Print and Retake onto the initial view.
- The operator studio still starts its real detector and exposes its existing upload/diagnostic controls.

## Other checks

All 14 existing geometry, pose, quality, continuous-hold and tone tests pass. All changed JavaScript modules pass syntax checks. The six-template HTML has no duplicate IDs.

The lights asset is silent H.264/yuv420p, 1280 × 720, 30 fps, exactly 4.000 seconds (120 frames). HyperFrames composition checks reported zero errors and warnings; source and encoded-frame proofs were visually inspected. Editable source: `../../videos/photobooth-lights/`.

## Practical limits

The print action uses the browser/system dialog and cannot confirm whether a job was printed or cancelled. Select the event printer and 4 × 6 inch paper there. Real camera permissions, autofocus, varied guest portraits, physical print alignment and sustained event-machine performance require testing on the intended hardware. The screen lights video does not control physical lights.
