# Frontal fixture verification — v0.3

19 October 2026, local browser at http://127.0.0.1:8765/.

Five new static images were generated with the built-in Image Generation tool: two 1024 × 1536 target scenes, three independent 1254 × 1254 guest headshots. All are fictional adults. Exact prompts and saved image paths are in `frontal-generation-prompts.json`. The original client PDF scenes remain available unchanged.

## Observed estimates

The local MediaPipe detector measured these approximate poses. Head turn is measured on a standardised centred crop; eye tilt is measured in the original image. These are model estimates, not ground truth or quality scores.

| Asset | Estimated head turn | Eye tilt |
| --- | ---: | ---: |
| Frontal weaver scene | −1° | −1.8° |
| Frontal pearl trader scene | 1° | −1.4° |
| Generated woman | 0° | −0.2° |
| Generated man | 1° | 0.0° |
| Generated bearded man | 0° | −0.6° |
| Original client pearl trader | 9° | 19.3° |
| Original client weaver | −11° | −15.8° |
| Original client woven arch | 8° | 17.9° |

## Browser checks

- All five calibrated scenes and all three generated guest buttons enabled successfully. New scenes are labelled AI tests and original client designs retain their labels.
- Independent woman → frontal weaver and independent man → frontal pearl trader produced native 1024 × 1536 PNG downloads. Inspected both exports; retained as `frontal-woman-composite.png` and `frontal-man-composite.png`.
- Simulated live guidance automatically captured an independent bearded guest into frontal pearl trader and an independent woman into frontal weaver. Both streams used the actual worker detector and continuous quality hold; no webcam was used.
- Switched the live stream between independent generated man and woman while the dialog stayed open; both reached the ready guidance state. The UI clearly labelled the source as a simulated AI test person. Saved studio and live screenshots as `frontal-studio-preview.png` and `frontal-live-preview.png`.
- All 14 existing geometry, pose, quality, hold and tone regression tests passed, plus JavaScript and Python syntax checks.
- The live test selector exposes generated woman, man, bearded man, or the scene reference. Generated people are the default, so the target face is not reused as its own replacement in the normal test.

## Practical result

The frontal fixtures reduce the visible geometric mismatch. The original scene facial contour is still a fixed prototype mask: forehead/chin seams and complexion mismatch with hands/neck can remain. This is geometric compositing, not neural pose correction or full relighting. A real guest test with the event camera and soft frontal light is still needed. These simulated tests do not benchmark a 24 GB Mac mini.
