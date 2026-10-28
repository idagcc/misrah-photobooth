import test from 'node:test';
import assert from 'node:assert/strict';
import { portraitZoom, defaultPortraitZoom, withPortraitZoom } from '../public/face-fit.js';
import { alignment } from '../public/geometry.js';

test('new and existing booths get a smaller falconer fit while preserving the weaver eye fit', () => {
  assert.equal(portraitZoom({}, 'misrah-falconer'), 92);
  assert.equal(portraitZoom({}, 'frontal-weaver'), 100);
  assert.equal(defaultPortraitZoom('custom-portrait'), 100);
  assert.equal(portraitZoom({ portraitZoom: { 'misrah-falconer': 80, 'frontal-weaver': 105 } }, 'misrah-falconer'), 80);
  for (const value of [74, 116, '90', NaN, null, 85.5]) assert.equal(portraitZoom({ portraitZoom: { 'misrah-falconer': value } }, 'misrah-falconer'), 92);
});

test('portrait zoom reduces the face around its eye midpoint without changing tilt or operator offsets', () => {
  const source = { anchor: { x: 120, y: 150 }, eyeDistance: 80, angle: .2 };
  const target = { anchor: { x: 600, y: 450 }, eyeDistance: 200, angle: .1 };
  const settings = { scale: 110, x: 8, y: -5, rotation: 3, flip: false };
  const original = alignment(source, target, settings), smaller = alignment(source, target, withPortraitZoom(settings, 80));
  assert.ok(Math.abs(smaller.scale / original.scale - .8) < 1e-9);
  assert.deepEqual({ x: smaller.x, y: smaller.y, angle: smaller.angle }, { x: original.x, y: original.y, angle: original.angle });
  assert.equal(settings.scale, 110);
});
