import test from 'node:test';
import assert from 'node:assert/strict';
import { updateFaceMap } from '../public/live-display.js';
const face = x => Array.from({ length: 478 }, () => Object.freeze({ x, y: .5, z: 0 }));

test('display reduces landmark jitter without mutating capture observations', () => {
  const state = { faces: [], lastSeenAt: null, at: null }, first = face(.5), next = face(.51);
  updateFaceMap(state, [first], 0);
  const shown = updateFaceMap(state, [next], 33);
  assert.ok(shown.faces[0][1].x > .5 && shown.faces[0][1].x < .505);
  assert.equal(next[1].x, .51); assert.equal(first[1].x, .5);
});

test('a one-frame detection loss fades the display briefly and then clears it', () => {
  const state = { faces: [], lastSeenAt: null, at: null };
  updateFaceMap(state, [face(.5)], 0);
  assert.equal(updateFaceMap(state, [], 33).faces.length, 1);
  assert.equal(updateFaceMap(state, [], 33).fading, true);
  assert.equal(updateFaceMap(state, [], 151).faces.length, 0);
});

test('large moves and additional faces do not interpolate unrelated detections', () => {
  const state = { faces: [], lastSeenAt: null, at: null };
  updateFaceMap(state, [face(.3)], 0);
  assert.equal(updateFaceMap(state, [face(.7)], 33).faces[0][1].x, .7);
  assert.equal(updateFaceMap(state, [face(.3), face(.7)], 66).faces.length, 2);
});
