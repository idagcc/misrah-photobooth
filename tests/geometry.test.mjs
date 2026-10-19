import test from 'node:test';
import assert from 'node:assert/strict';
import { alignment, faceGeometry, manualGeometry, targetForOpening, findTransparentOpening } from '../public/geometry.js';

test('eye alignment maps a tilted source eye pair onto the target eyes', () => {
  const source = { anchor: { x: 150, y: 200 }, eyeDistance: 80, angle: .2 };
  const target = { anchor: { x: 680, y: 390 }, eyeDistance: 64, angle: -.1 };
  const transform = alignment(source, target, { scale: 100, x: 0, y: 0, rotation: 0, flip: false });
  for (const side of [-1, 1]) {
    const sx = side * source.eyeDistance / 2 * Math.cos(source.angle), sy = side * source.eyeDistance / 2 * Math.sin(source.angle);
    const x = transform.x + transform.scale * (sx * Math.cos(transform.angle) - sy * Math.sin(transform.angle));
    const y = transform.y + transform.scale * (sx * Math.sin(transform.angle) + sy * Math.cos(transform.angle));
    assert.ok(Math.abs(x - (target.anchor.x + side * target.eyeDistance / 2 * Math.cos(target.angle))) < 1e-8);
    assert.ok(Math.abs(y - (target.anchor.y + side * target.eyeDistance / 2 * Math.sin(target.angle))) < 1e-8);
  }
});

test('mirroring compensates source roll and retains the target eye line', () => {
  const transform = alignment({ eyeDistance: 70, angle: .3 }, { anchor: { x: 5, y: 8 }, eyeDistance: 70, angle: .1 }, { scale: 100, x: 3, y: -2, rotation: 0, flip: true });
  assert.ok(Math.abs(transform.angle - .4) < 1e-8);
  assert.equal(transform.x, 8); assert.equal(transform.y, 6);
});

test('landmarks convert to source-pixel coordinates with image-order eyes', () => {
  const p = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
  p[33] = p[133] = { x: .3, y: .4 }; p[362] = p[263] = { x: .7, y: .4 };
  p[234] = { x: .2, y: .5 }; p[454] = { x: .8, y: .5 }; p[10] = { x: .5, y: .1 }; p[152] = { x: .5, y: .9 };
  const g = faceGeometry(p, 1000, 800);
  assert.deepEqual(g.anchor, { x: 500, y: 320 }); assert.equal(g.eyeDistance, 400); assert.equal(g.height, 640); assert.equal(g.angle, 0);
});

test('manual fitting remains finite for portrait and landscape photos', () => {
  for (const [w, h] of [[1200, 800], [800, 1200], [1, 1]]) {
    const fit = alignment(manualGeometry(w, h), targetForOpening({ left: 10, top: 20, right: 90, bottom: 130 }), { scale: 100, x: 0, y: 0, rotation: 0, flip: false });
    assert.ok(Number.isFinite(fit.scale)); assert.ok(fit.scale > 0);
  }
});

test('transparent opening excludes transparent outer background and picks largest enclosed hole', () => {
  const w = 18, h = 14, p = new Uint8ClampedArray(w * h * 4); p.fill(255);
  const clear = (x, y) => { p[(y * w + x) * 4 + 3] = 0; };
  for (let y = 0; y < h; y++) clear(0, y);
  for (let y = 3; y < 10; y++) for (let x = 5; x < 11; x++) clear(x, y);
  const b = findTransparentOpening(p, w, h);
  assert.deepEqual(b, { left: 5, top: 3, right: 11, bottom: 10, area: 42 });
});

test('opaque artwork returns no transparent opening', () => {
  assert.equal(findTransparentOpening(new Uint8ClampedArray(100 * 4).fill(255), 10, 10), null);
});
