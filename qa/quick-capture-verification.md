# Visible pose countdown and stable capture

Updated 21 October 2026 on `experiment`. The guest sees 3, then 2, and the shutter fires as 1 appears. The count gives time to pose without a continuously steady hold.

## Behavior

After the lights intro, two usable frontal observations in the latest three frames arm the countdown. Observations older than 500 ms cannot arm it. It shows 3 at the start, 2 after one second, and captures as 1 appears after two seconds. A circular corner counter leaves the face visible.

Small movement, landmark jitter and light/focus fluctuations do not restart an active countdown. A face/size/pose failure gets 250 ms grace during 3/2; persistent failure cancels the count. At the deadline, one complete, front-facing face and a recent measured bitmap are required. Exposure/focus checks arm the countdown but do not postpone 1 after it starts. The manual shutter remains available for a frontal face during lighting/focus advice, and captures immediately when tapped.

The pixels are copied on 1; the frozen camera and number stay visible for 180 ms before processing. Cancellation during that brief interval discards pending delivery and returns to selection. Stop/cancel clears the counter timer and camera bitmaps. Neither shutter path can run during lights/preparation. The operator studio retains its existing timed hold.

Displayed landmarks use a 75 ms smoothing time constant and reset on large jumps or additional faces. A lost detection fades for at most 150 ms. The guest outline has a consistent colour; guidance switches settle for 250 ms. Crop and face eligibility always use unsmoothed observations.

## Verification

- 32 JavaScript unit tests passed, including exact 3/2/1 phase boundaries, capture at the start of 1, quality-fluctuation tolerance, brief face-loss grace, invalid-face rejection at the deadline and cancellation. Existing camera pacing, crop geometry and display-smoothing checks passed.
- `scripts/verify-quick-capture.mjs` recorded the visible sequence `3, 2, 1` with approximately 1000 ms between digits. The shutter was recorded at 2000 ms from 3, within 1 ms of rendering 1 in the controlled run. The current frame was copied before the 180 ms display pause; no extra second was added after 1.
- The controlled run alternated good, blurred and dark observations with changing landmark offsets during the countdown. Its clock did not restart. Manual capture remained available during focus advice, and fired once only.
- No-face, multiple-face and turned-face sequences could not arm or use the shutter. Closing on 3 and during the visible 1 cancelled pending delivery without a later capture.
- `scripts/verify-kiosk.mjs` exercised the real bundled model and guest journey, both templates, countdown, cancellation, retake, export/print layout, mobile layout, idle cleanup, denied-camera recovery and studio startup. The countdown layout is shown in `kiosk-countdown.png`.

Raw controlled readings are in `quick-capture.json`. `quick-capture-manual.png` is an intentionally synthetic red-frame harness, not a real guest photo. The real-model screenshot uses a clearly labelled fictional sample person. Physical webcam timing and booth-lighting behaviour still need a hands-on trial.
