# Post-capture pose trial — 21 October 2026

Previous dynamic mapping, 4K tracking and capture-on-1 countdown committed first as `362d5c1` on `experiment`. This optional trial is the subsequent working-tree change. No push or hardware print was performed.

## Behavior

- `/pose-demo.html`: local, interactive before/after comparison, five samples and optional photo input. Face crops are upright in both columns; the existing eye alignment is already included in “before”. Full portrait previews use the same alignment geometry. Both comparisons receive identical tone treatment.
- `/?pose=correct`: enables correction in the actual guest pipeline after the shutter and before final alignment/archive/export. The regular URL keeps correction off. Studio has a checkbox to undo/reapply it.
- The worker reprojects the source's own approximate XYZ surface, samples the same source image and pins/tapers the outer contour. It does not map the person's features to the template person's face or create an unseen side.
- Missing/invalid pose, substantial angles, already aligned inputs or unstable mesh geometry keep the original. Manual capture gates, countdown and camera tracking policy are unchanged.

## Evidence

`npm test`: 39 passed, including inverse reprojection for both yaw signs, crop/depth invariance, silhouette weights, unsafe-fold rejection and texture/alpha preservation. The pre-trial checkpoint also passed all 22 Python service tests; the service is unchanged in this trial.

`verify-pose-correction.mjs`: real bundled model and worker, all five samples; turn improvement on the two angled references; actual studio compositor changes; byte-identical original portrait after disabling correction; worker failure fallback; late result ignored after disabling; phone layout; guest capture with exactly one post-capture correction, visible 3/2/1 and no active video stream at result; second simulated native 4K capture preserved a 1673 × 1996 source crop. See `pose-correction.json` for current measurements and screenshots alongside it.

Representative measured estimates toward the weaver template (not physical angle ground truth):

| Reference | Before yaw magnitude | After yaw magnitude | Observation |
| --- | ---: | ---: | --- |
| Weaver | ~11.9° | ~9.1° | Modest turn reduction; pitch mismatch rose by about 1° |
| Pearl trader | ~8.1° | ~6.2° | Turn and pitch mismatch reduced |

Straight-face woman/man/bearded fixtures also processed successfully with small pitch adjustments toward the template. Front-facing or near-zero-error synthetic cases are skipped by unit coverage. This is evidence of modest correction, not complete frontalisation or broad identity/perceptual validation.

Development host: Apple M5 Pro, 48 GiB unified memory, Chrome. Worker correction on the 640 × 480 comparison samples took approximately 5–15 ms after removing a redundant contour pass. The 1673 × 1996 native crop took ~71 ms in the recorded synthetic capture, with another browser test running concurrently. These are single still-job observations, excluding model startup, camera acquisition, tone correction, transfers to the UI and full portrait rendering. They do not certify a 16 GB M6, a physical Insta360 Link 2 or sustained live frame rate. The correction is never called per live frame.

`verify-camera-runtime.mjs`: CPU inference, GPU initialization fallback, negotiated lower camera resolution, single in-flight tracking job and stream/snapshot cleanup passed with the updated worker. The normal kiosk journey was also exercised separately.

## Basis and limits

[MediaPipe's face geometry documentation](https://github.com/google-ai-edge/mediapipe/wiki/MediaPipe-Face-Mesh) describes relative width-scaled depth under weak perspective and a separate metric reconstruction pipeline. This trial uses the approximate screen-space surface, so it deliberately applies only bounded adjustments. It cannot restore occluded texture, repair closed eyes or remove motion blur. Retain camera guidance and review the actual event-camera results before deciding whether to enable this trial routinely.
