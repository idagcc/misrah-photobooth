# 4K camera and 30 fps tracking — experiment

Verified 21 October 2026. This is a development-machine result, not certification of the requested M6/16 GB/physical Link 2 setup.

## Implementation

- New settings default to a 3840 × 2160 / 30 fps camera request and a target of 30 fresh face analyses per second. Existing saved 5/10 Hz choices remain available and unchanged until the operator selects the new profile.
- Each analysis uses a 640 px longest-side copy. MediaPipe runs in a dedicated worker with GPU/WebGL acceleration and a CPU fallback when GPU initialization fails. Multiple-face rejection is retained.
- Native-resolution ImageBitmaps retain the scored camera frame and the one being analysed. Only the final face crop is rasterized at the shutter. At 4K, two raw RGBA frames total about 66 MB; this excludes the browser, model, driver, artwork and other allocations.
- A camera-frame callback pump tracks the latest presented frame token while inference runs. There is a single inference in flight and no queued image backlog. This avoids losing a new frame simply because its presentation callback arrived before the previous analysis completed.
- Fixed-rate throttling is retained for lower tracking profiles. The original elapsed-time motion gate remains in the operator studio. Guest capture was subsequently changed to quick frontal-face confirmation without a displacement hold; see `quick-capture-verification.md`.
- The operator panel reports actual dimensions, measured camera presentation fps, measured face-analysis fps, inference time and actual CPU/GPU delegate. A negotiated lower camera mode or a slow worker is shown as measured.

## Measured benchmark

Host: Apple M5 Pro, 48 GiB RAM, arm64, Chrome 155.0.8059.85. Input: synthetic 3840 × 2160 canvas camera at target 30 fps, using a fictional static sample face with a changing corner pixel to deliver fresh frames. Five seconds of warm-up preceded a twenty-second measurement. No other browser QA was running during measurement.

| Reading | Result |
| --- | ---: |
| Face analyses | 600 in 20 seconds |
| Measured face tracking | 30.01 fps |
| Camera presentation | 30.04 fps |
| Model backend | GPU |
| Median inference | 12.3 ms |
| 95th-percentile inference | 25.4 ms |
| 95th-percentile worker round trip | 25.7 ms |
| Final source face crop | 1673 × 1996 px |

The initial implementation reached about 25 fps on a synthetic stream. Updating scheduling to consume the latest frame token, together with removing repeated 4K artwork resampling from the synthetic source, produced the result above. The source-generation change prevents the test's own 4K drawing loop from competing unnecessarily with application processing; it does not represent real USB capture or camera decoding.

Raw readings: `4k30-benchmark.json`. Operator screenshot: `4k30-performance.png`. Reproduce against a disposable local service using `scripts/benchmark-camera.mjs`, `PHOTOBOOTH_URL`, `PLAYWRIGHT_PATH` and optional `BENCHMARK_SECONDS`.

## Verification

- 20 JavaScript and 22 Python unit checks passed, including 30 Hz pacing, settings persistence and time-scaled movement checks.
- Complete kiosk verification passed at the 30 Hz setting: welcome, lights, cancellation, both templates, automatic capture, retake, export, print layout, cleanup, mobile layout, denied-camera recovery and studio startup.
- Runtime checks passed using real CPU inference and a deliberately failed GPU initialization, plus a controlled slow worker and lower negotiated 1280 × 720 camera mode. The requested 4K dimensions remained separate from actual dimensions, tracking throughput reported the slower result, at most one request was in flight, and stop released the camera/bitmaps/callback. See `4k30-runtime.json` and `scripts/verify-camera-runtime.mjs`.
- The dynamic face-map and admin verification scripts cover both shutter paths, off-centre fitting, quality failures, shutter/inference overlap, and persisted 30/10/5 Hz selection.

The physical Insta360 Link 2, real 4K USB/driver decoding, 16 GB M6 memory pressure, and extended event conditions were not available for measurement. A sustained on-device camera session remains necessary before guaranteeing 30 tracking fps. The operator can inspect actual measurements after a capture; GPU selection or a 30 fps request alone does not establish achieved throughput.

## Hardware references

Checked 21 October 2026: [Insta360's supported camera modes](https://onlinemanual.insta360.com/link2/en-us/faq/functions/clientsoftware) include 4K at 30 fps. [Camera compatibility](https://onlinemanual.insta360.com/link2/en-us/faq/compatibility/camera) documents Mac support. [The setup guide](https://onlinemanual.insta360.com/link2/en-us/operating-tutorials/reframe-live/live-tutorial-cameraconfiguration-tutorial) recommends closing Link Controller's preview while another app uses the camera. [Apple's Mac mini specifications](https://www.apple.com/mac-mini/specs/) list the M6 and 16 GB unified-memory configuration; the benchmark host above is a different model.
