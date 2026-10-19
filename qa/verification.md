# MVP verification — 19 October 2026

Verified in the Codex in-app Chromium browser on the current Mac. Local app and model served from 127.0.0.1; no external runtime assets required.

## Passed

- Local server returns HTTP 200, JavaScript and WebAssembly MIME types are correct, outgoing connections are restricted to the local origin, and the server binds only to loopback.
- Bundled MediaPipe model initializes successfully in a worker using the CPU delegate.
- The supplied sample is detected and aligned automatically. Observed warm inference time: 15–19 ms for the sample close-up on this device, excluding image loading and model initialization. This is an observation, not a client hardware guarantee.
- A local two-face test fixture yields two detected faces; selecting Person 2 updates the active face.
- Uploading the face-free reference displays a no-face message while retaining manual adjustment and export.
- Size, rotation, keyboard positioning, and mirror controls update their visible state. Auto fit restores the initial alignment.
- Transparent PNG custom frame: enclosed hole found automatically; native 600 × 700 frame dimensions retained.
- Opaque PNG custom frame: movable oval controls appear; width adjustment works; guides can be hidden.
- Returning to the heritage scene restores 1312 × 1199 output.
- PNG and JPEG downloads complete and both have 1312 × 1199 dimensions. Exporting from Frame preview still produces the composed portrait.
- Exported PNG pixels outside the face region are identical to the supplied original frame.
- The blue placeholder fringe observed in the first render was removed; the final sample was visually inspected at native resolution.
- Start fresh clears the source preview, face selection, and custom frame; adjustment and export controls become disabled.
- Desktop (1440 px), intermediate (618 px), and narrow (390 px) layouts inspected. No horizontal overflow at the narrow breakpoint.
- Browser console has no captured application errors during the verified flows.
- After stopping the local preview server for cleanup, the already-loaded tab still cleared the session, detected the sample again in 15 ms, and rendered the composite. The launcher is needed to open or reload the app in a fresh tab.
- Six geometry tests passed: eye alignment, mirror rotation, landmark coordinates, manual fallback, enclosed transparency, and opaque frames.

## Not exercised

- Physical webcam permission/capture, camera switching, and USB camera hardware. The implemented capture lifecycle and timer require a hardware check with the client.
- Windows/macOS double-click launch on a second clean computer; Python 3 is a documented prerequisite.
- Offline network-disconnection test. All runtime dependencies are bundled and the app's connection policy is local-only; no operating-system network setting was changed during verification.
- Printer integration, kiosk lock-down, neural identity swapping, and neural relighting are outside this MVP.

`sample-portrait.png` is an actual browser-exported composite using the supplied demonstration face. Test fixture `two-faces.png` repeats that same supplied face to verify selection; it is not two independently captured guests.
