# v0.6 verification — 21 October 2026

## Passed

- 14 existing JavaScript geometry, continuous-hold, quality and colour checks (`npm test`).
- 15 Python service checks: persistent settings and counts, event deduplication, template persistence/visibility, invalid imports/settings, concurrent print request deduplication, paper/ribbon/cover/offline status, blocked paper-out submission, accepted/completed/cancelled/unknown accounting, uncertain timeout without retry, selected printer/media command arguments, temporary PDF removal, and 4×6/6×4 PDF geometry.
- Full Chrome kiosk suite against the real bundled MediaPipe model: welcome, exactly two frontal choices, lights, cancellation, independent simulated-guest auto capture, both portrait captures, retake, choose another, finish, idle warning/reset, denied camera retry, PNG download, print-only PDF, phone layout and legacy studio startup. No page errors.
- Full Chrome admin suite: hidden keyboard access, saved settings after reload, successful real frontal-artwork upload, blank/angled input rejection by the model, imported portrait available after reload, actual capture with the imported portrait, hiding the active result clears its photo, aggregate event deduplication, CSV, mobile admin, and native print/error UI using a mock bridge. Cross-origin writes rejected. No page errors; no hardware prints submitted.
- Actual local macOS CUPS connection using its Unix socket. It returned an empty printer list, matching the installed system queues. TCP was unavailable; socket fallback was necessary and verified.
- Generated native PDFs opened/rendered with PyMuPDF. Exactly one page each: 288×432 points (portrait 4×6), 432×288 points (DNP landscape 6×4). Visual inspection confirms the whole portrait fits with no cropping. The DNP version rotates the art into the media page without shrinking it into the center.
- Desktop guest welcome, selection and review; mobile guest views; admin Devices, Portraits, Usage and phone layout visually inspected. Both choice images load before the booth becomes ready. The phone choices share one row. A clean-start network check confirms diagnostic guests and angled artwork are not requested.
- Python/JavaScript syntax checks and `git diff --check` passed.

## Evidence

`kiosk-welcome.png`, `kiosk-templates.png`, `kiosk-camera.png`, `kiosk-result.png`, `kiosk-mobile-*.png`, `kiosk-print.pdf`, `admin-devices.png`, `admin-portraits.png`, `admin-usage.png`, `admin-mobile.png`, `native-print-4x6.pdf/png`, `native-print-dnp-6x4.pdf/png`.

The print harness mocks only the external native bridge response; its button and error handling are the production guest-flow module. The Python command test mocks `lp`, inspects the actual temporary PDF path and options, and verifies its deletion. Model-based import/capture checks use the real worker and supplied synthetic assets.

## Hardware limits

No physical camera or DNP printer was used. The guest checks use explicit, disclosed simulated cameras. Paper/ribbon and submission states are service fixtures, not a hardware observation. A Mac mini M6 with 16 GB was not benchmarked.

DNP's official RX1HS page describes its detailed remaining-media Status App as Windows software. The app therefore exposes Mac queue/driver reasons, shows remaining sheets as unavailable, and does not equate idle with paper present. Driver support on the event Mac's exact OS and forwarding of real RX1HS paper-out errors remain unverified. The discovered EU Mac driver listing advertises macOS 11–15; it does not establish newer-OS support.

Before event use, the actual printer should be exercised for paper/ribbon exhaustion, open cover, disconnect/reconnect, and reload/recovery. A physical sample should confirm paper size, rotation, margins, finish and colour. These are pending hardware validation, not failed software checks.
