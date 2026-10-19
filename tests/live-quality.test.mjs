import test from 'node:test';
import assert from 'node:assert/strict';
import { poseFromMatrix, pixelQuality, assessFrame, advanceHold, correctionFor, correctPixels } from '../public/live-quality.js';
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
