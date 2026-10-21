import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraProfile, analysisDue } from '../public/camera-performance.js';

test('30 Hz mapping requests a 4K 30 fps camera but keeps analysis bounded', () => {
  const p = cameraProfile(30, 'link-2');
  assert.equal(p.video.width.ideal, 3840); assert.equal(p.video.height.ideal, 2160);
  assert.deepEqual(p.video.frameRate, { ideal: 30, max: 30 });
  assert.deepEqual(p.video.deviceId, { exact: 'link-2' });
  assert.equal(p.analysisLimit, 640);
  assert.equal(cameraProfile(5).video.width.ideal, 1280);
  assert.equal(cameraProfile(10).trackingRate, 10);
});

test('camera pacing accepts every 30 fps frame and caps lower-rate analysis', () => {
  for (const rate of [5, 10, 15, 30]) {
    let last = null, frames = 0;
    for (let i = 0; i < 300; i++) {
      const now = i * 1000 / 30 + (i % 2 ? .5 : -.5);
      if (analysisDue(last, now, rate)) { last = now; frames++; }
    }
    assert.ok(Math.abs(frames - rate * 10) <= 1, `${rate} Hz: ${frames}`);
  }
});
