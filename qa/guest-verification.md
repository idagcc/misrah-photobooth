# Guest experience verification — v0.4

19 October 2026. Local app, in-app browser. No real guest or webcam was used for the automated flow checks.

- Default page: complete scene photograph, five scene choices and one Open camera action. Accessibility snapshot exposes no adjustment sliders, upload inputs, test-person gallery, pose values or performance controls.
- Scene selection: switched between the two generated frontal scenes and verified the selected state and photograph caption update.
- On `?camera=sample`, the normal Open camera button starts the existing synthetic stream, clearly labelled SIMULATED CAMERA / AI TEST PERSON. The camera dialog exposes Close camera and Take picture, plus plain-language guidance. Hidden quality and tone settings remain automatic.
- Take picture waited for the quality policy to pass, captured the scored frame, closed the stream and showed the final portrait with Save photo and Take another photo. No automatic shutter is enabled in the guest interface.
- Save photo produced a native 1024 × 1536 PNG without UI, sliders or guides. A separately labelled `?sample=woman` static preview was also exported from the original higher-resolution synthetic source as `misrah-sample-portrait.png` in the project root.
- Take another photo cleared the source and returned to scene selection, retaining the chosen scene. Closing the camera also returned correctly.
- Desktop 1440 × 1080 and mobile 390 × 844 layouts inspected. Mobile scene choices use one compact row and do not overflow horizontally. Corrected an inherited operator grid rule that initially expanded mobile scene cards.
- HTML identifiers: no duplicates or missing directly referenced controls. JavaScript syntax checks and all 14 existing geometry, pose, capture-policy and tone tests passed.

Screenshots: `guest-scene-selection.jpg`, `guest-camera.jpg`, `guest-final-portrait.jpg`, `guest-mobile.jpg`. Root shareable UI sample: `misrah-client-preview.jpg`. Simulated tests do not verify real camera permission, autofocus or the target Mac mini's performance.
