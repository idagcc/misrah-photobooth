import test from 'node:test';
import assert from 'node:assert/strict';
import { poseFromMatrix, pixelQuality, assessFrame, advanceHold, advanceQuickCapture, advancePoseCountdown, canCaptureFace, correctionFor, correctPixels } from '../public/live-quality.js';
const face = { anchor: { x: 320, y: 220 }, eyeDistance: 100, angle: 0, width: 210, height: 270,
  bounds: { left: 215, top: 90, right: 425, bottom: 360 } };
const quality = { brightness: 120, rgb: [125,120,110], darkFraction: .02, clippedFraction: 0, imbalance: 8, sharpness: 70 };
const input = { faces: [face], poses: [{ yaw: 0, pitch: 0 }], qualities: [quality], width: 640, height: 480,
  previous: { x: .5, y: 220 / 480, distance: 100 / 640 } };
test('column-major scaled rotation yields the expected yaw', () => {
  const a = Math.PI / 6, c = Math.cos(a) * 2, s = Math.sin(a) * 2;
  const pose = poseFromMatrix([c,0,-s,0, 0,2,0,0, s,0,c,0, 4,3,8,1]);
  assert.ok(Math.abs(pose.yaw - 30) < 1e-6); assert.equal(pose.pitch, 0);
  assert.equal(poseFromMatrix([1,2]), null); assert.equal(poseFromMatrix(Array(16).fill(0)), null);
});
test('capture policy accepts a centred, steady, sharp and well-lit face', () => {
  assert.equal(assessFrame(input).ready, true);
});
test('raising mapping to 30 Hz keeps the motion speed limit consistent', () => {
  for (const hz of [5, 10, 30]) {
    const observationMs = 1000 / hz;
    const moving = { ...input, observationMs,
      previous: { ...input.previous, x: input.previous.x - .025 * observationMs / 200 } };
    assert.equal(assessFrame(moving).code, 'motion', `${hz} Hz`);
    const steady = { ...moving, previous: { ...input.previous, x: input.previous.x - .005 * observationMs / 200 } };
    assert.equal(assessFrame(steady).ready, true, `${hz} Hz`);
  }
});
test('guest capture accepts a sharp straight face despite movement or landmark jitter', () => {
  const jittering = { ...input, observationMs: 1000 / 30, previous: { ...input.previous, x: .49 } };
  assert.equal(assessFrame(jittering).code, 'motion');
  assert.equal(assessFrame(jittering, { requireSteady: false }).ready, true);
  assert.equal(assessFrame({ ...input, previous: null }, { requireSteady: false }).ready, true);
  assert.equal(assessFrame({ ...jittering, qualities: [{ ...quality, sharpness: 1 }] }, { requireSteady: false }).code, 'blur');
});
test('quick capture fires on the second usable frame without a timed hold', () => {
  for (const hz of [5, 10, 30]) {
    const state = { frames: [] }, good = assessFrame(input, { requireSteady: false });
    assert.equal(advanceQuickCapture(state, good, 0).capture, false);
    assert.equal(advanceQuickCapture(state, good, 1000 / hz).capture, true, `${hz} Hz`);
  }
});
test('quick capture tolerates an isolated focus fluctuation but never shutters a bad frame', () => {
  const state = { frames: [] }, good = assessFrame(input, { requireSteady: false });
  const blur = assessFrame({ ...input, qualities: [{ ...quality, sharpness: 1 }] }, { requireSteady: false });
  advanceQuickCapture(state, good, 0);
  assert.equal(advanceQuickCapture(state, blur, 33).capture, false);
  assert.equal(advanceQuickCapture(state, good, 66).capture, true);
});
test('lost, extra, turned or stale faces and gated phases cannot finish a quick capture', () => {
  const good = assessFrame(input, { requireSteady: false });
  const bad = [assessFrame({ ...input, faces: [] }), assessFrame({ ...input, faces: [face,face] }),
    assessFrame({ ...input, poses: [{ yaw: 35, pitch: 0 }] })];
  for (const assessment of bad) {
    const state = { frames: [] }; advanceQuickCapture(state, good, 0);
    assert.equal(advanceQuickCapture(state, assessment, 33).capture, false);
    assert.equal(advanceQuickCapture(state, good, 66).capture, false);
  }
  const state = { frames: [] }; advanceQuickCapture(state, good, 0);
  assert.equal(advanceQuickCapture(state, good, 600).capture, false);
  assert.equal(advanceQuickCapture(state, good, 633, false).capture, false);
  assert.equal(advanceQuickCapture(state, good, 666).capture, false);
});
test('manual shutter is available for one straight face despite lighting/focus advice', () => {
  assert.equal(canCaptureFace(assessFrame({ ...input, qualities: [{ ...quality, brightness: 20 }] })), true);
  assert.equal(canCaptureFace(assessFrame({ ...input, qualities: [{ ...quality, sharpness: 1 }] })), true);
  assert.equal(canCaptureFace(assessFrame({ ...input, faces: [] })), false);
  assert.equal(canCaptureFace(assessFrame({ ...input, faces: [face,face] })), false);
  assert.equal(canCaptureFace(assessFrame({ ...input, poses: [{ yaw: 40, pitch: 0 }] })), false);
});
test('pose countdown shows 3 then 2 and fires as 1 appears, two seconds after starting', () => {
  const state = {}, good = assessFrame(input, { requireSteady: false });
  assert.equal(advancePoseCountdown(state, good, 0).value, null);
  assert.deepEqual(advancePoseCountdown(state, good, 33), { value: 3, capture: false, progress: 0 });
  assert.equal(advancePoseCountdown(state, good, 1032).value, 3);
  assert.equal(advancePoseCountdown(state, good, 1033).value, 2);
  assert.equal(advancePoseCountdown(state, good, 2032).capture, false);
  assert.deepEqual(advancePoseCountdown(state, good, 2033), { value: 1, capture: true, progress: 1 });
});
test('focus and exposure fluctuations do not restart an active countdown', () => {
  const state = {}, good = assessFrame(input, { requireSteady: false });
  const blur = assessFrame({ ...input, qualities: [{ ...quality, sharpness: 1 }] });
  advancePoseCountdown(state, good, 0); advancePoseCountdown(state, good, 33);
  assert.equal(advancePoseCountdown(state, blur, 800).value, 3);
  assert.equal(advancePoseCountdown(state, blur, 1033).value, 2);
  assert.equal(advancePoseCountdown(state, blur, 2033).capture, true);
  assert.equal(state.startedAt, 33);
});
test('a brief face loss does not reset the count, but an invalid face at shutter time cannot capture', () => {
  const state = {}, good = assessFrame(input, { requireSteady: false }), absent = assessFrame({ ...input, faces: [] });
  advancePoseCountdown(state, good, 0); advancePoseCountdown(state, good, 33);
  assert.equal(advancePoseCountdown(state, absent, 500).value, 3);
  assert.equal(advancePoseCountdown(state, good, 533).value, 3);
  assert.equal(state.startedAt, 33);
  assert.equal(advancePoseCountdown(state, absent, 2033).capture, false);
  assert.equal(state.startedAt, null);
});
test('leaving the view or disabling auto capture cancels the countdown', () => {
  const good = assessFrame(input, { requireSteady: false }), absent = assessFrame({ ...input, faces: [] });
  for (const disabled of [false, true]) {
    const state = {}; advancePoseCountdown(state, good, 0); advancePoseCountdown(state, good, 33);
    advancePoseCountdown(state, absent, 500);
    assert.equal(advancePoseCountdown(state, disabled ? good : absent, 800, !disabled).value, null);
    assert.equal(advancePoseCountdown(state, good, 833).value, null);
  }
});
test('dynamic fitting accepts visible off-centre faces without dropping the quality gates', () => {
  for (const [dx, dy] of [[-160, 0], [160, 0], [0, -75], [0, 100]]) {
    const moved = { ...face, anchor: { x: face.anchor.x + dx, y: face.anchor.y + dy },
      bounds: { left: face.bounds.left + dx, right: face.bounds.right + dx,
        top: face.bounds.top + dy, bottom: face.bounds.bottom + dy } };
    const frame = { ...input, faces: [moved], previous: { ...input.previous,
      x: moved.anchor.x / input.width, y: moved.anchor.y / input.height } };
    assert.equal(assessFrame(frame).ready, true, `position ${dx}, ${dy}`);
    assert.equal(assessFrame({ ...frame, qualities: [{ ...quality, sharpness: 1 }] }).code, 'blur');
    assert.equal(assessFrame({ ...frame, faces: [moved, face] }).code, 'multiple');
  }
});
test('capture rejects no face, multiple faces, missing pose, bad lighting and blur', () => {
  assert.equal(assessFrame({ ...input, faces: [] }).code, 'no-face');
  assert.equal(assessFrame({ ...input, faces: [face,face] }).code, 'multiple');
  assert.equal(assessFrame({ ...input, poses: [] }).code, 'pose-unavailable');
  assert.equal(assessFrame({ ...input, qualities: [{ ...quality, brightness: 20 }] }).code, 'dark');
  assert.equal(assessFrame({ ...input, qualities: [{ ...quality, clippedFraction: .5 }] }).code, 'bright');
  assert.equal(assessFrame({ ...input, qualities: [{ ...quality, imbalance: 90 }] }).code, 'uneven');
  assert.equal(assessFrame({ ...input, qualities: [{ ...quality, sharpness: 1 }] }).code, 'blur');
});
test('capture uses the selected template pose and rejects substantial mismatch', () => {
  assert.equal(assessFrame({ ...input, poses: [{ yaw: 25, pitch: 0 }] }).code, 'yaw');
  assert.equal(assessFrame({ ...input, poses: [{ yaw: 25, pitch: 0 }], targetPose: { yaw: 23, pitch: 0 } }).ready, true);
  assert.equal(assessFrame({ ...input, previous: { ...input.previous, x: .3 } }).code, 'motion');
  assert.equal(assessFrame({ ...input, faces: [{ ...face, bounds: { ...face.bounds, left: 0 } }] }).code, 'clipped');
});
test('automatic capture requires continuous valid time and resets after a bad or stalled frame', () => {
  const state = { since: null, lastAt: null, samples: 0 };
  for (let t = 0; t < 1400; t += 100) assert.equal(advanceHold(state, true, t).capture, false);
  assert.equal(advanceHold(state, true, 1400).capture, true);
  advanceHold(state, false, 1500); assert.equal(state.since, null);
  advanceHold(state, true, 1600); assert.equal(advanceHold(state, true, 3000).capture, false);
  assert.equal(state.since, 3000);
});
test('quality analysis distinguishes blank dark inputs from detailed input', () => {
  const dark = new Uint8ClampedArray(32 * 32 * 4); dark.fill(10);
  const q = pixelQuality(dark,32,32); assert.ok(q.brightness < 11); assert.equal(q.sharpness,0);
  for (let i = 0; i < dark.length; i += 4) { const value = (i / 4 + Math.floor(i / 4 / 32)) % 2 ? 210 : 40; dark[i] = dark[i+1] = dark[i+2] = value; }
  assert.ok(pixelQuality(dark,32,32).sharpness > 100);
});
test('tone correction is bounded and preserves alpha', () => {
  const c = correctionFor({ ...quality, brightness: 15, rgb:[10,20,5] }, { brightness:180 });
  assert.ok(c.exposure <= 1.28); assert.ok(c.gains.every(v => v >= .9 && v <= 1.1));
  const pixels = new Uint8ClampedArray([40,30,20,103]); correctPixels(pixels,c);
  assert.equal(pixels[3],103); assert.ok(pixels[0] > 40);
});
test('a matching sepia reference retains its warm colour proportions', () => {
  const q = { ...quality, rgb:[200,150,90], brightness:156.294 };
  const correction = correctionFor(q,{ ...q, styleStrength:.85 });
  assert.ok(correction.gains.every(v => Math.abs(v - 1) < 1e-8));
  const pixels = new Uint8ClampedArray([200,150,90,255]); correctPixels(pixels,correction);
  assert.ok(pixels[0] > pixels[1] && pixels[1] > pixels[2]);
  assert.ok(pixels[2] / pixels[0] < .5);
});
