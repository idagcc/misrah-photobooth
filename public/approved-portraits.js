// Calibrated to the three supplied final artworks, which deliberately contain no detectable faces.
// Retain the existing role IDs so stored selections and operator visibility settings survive updates.
export const APPROVED_PORTRAITS = {
  'frontal-weaver': {
    src: 'assets/approved/basket-weaver.png', name: 'The basket weaver', width: 1122, height: 1402,
    bounds: { left: 460, top: 336, right: 665, bottom: 536 },
    eyes: [[510, 400], [611, 400]], tone: [544, 526, 32, 9],
    // Only the two skin-coloured eye apertures are removed. The brow, bridge and lower plate stay opaque.
    apertures: [
      'M 469 380 L 551 380 L 552 417 C 528 423 497 422 483 413 Q 471 402 469 380 Z',
      'M 569 380 L 656 381 Q 653 401 640 412 C 622 423 593 423 569 418 Z'
    ]
  },
  'frontal-pearl-trader': {
    src: 'assets/approved/pearl-diver.png', name: 'The pearl diver', width: 1024, height: 1536,
    bounds: { left: 427, top: 279, right: 610, bottom: 532 },
    eyes: [[478, 369], [558, 369]], tone: [483, 541, 64, 36],
    seed: [515, 400]
  },
  'misrah-sailor': {
    src: 'assets/approved/sailor.png', name: 'The sailor', width: 1024, height: 1536,
    bounds: { left: 421, top: 322, right: 631, bottom: 604 },
    eyes: [[480, 415], [572, 415]], tone: [490, 610, 64, 30],
    seed: [520, 460]
  }
};

export function prepareApprovedPortrait(definition, image, makeCanvas) {
  const spec = APPROVED_PORTRAITS[definition.id];
  if (!spec || definition.src !== spec.src) return null;
  const w = image.width, h = image.height;
  if (w !== spec.width || h !== spec.height) throw new Error('The approved artwork dimensions have changed. Recalibrate its face opening before use.');
  const mask = makeCanvas(w, h), mctx = mask.getContext('2d');
  mctx.fillStyle = 'white';
  if (spec.apertures) {
    for (const path of spec.apertures) mctx.fill(new Path2D(path));
  } else {
    // Flood only the enclosed neutral white placeholder, not the beige headwear or background.
    const original = makeCanvas(w, h), c = original.getContext('2d'); c.drawImage(image, 0, 0);
    const pixels = c.getImageData(0, 0, w, h).data, seen = new Uint8Array(w * h), queue = new Int32Array(w * h);
    const [sx, sy] = spec.seed, b = spec.bounds;
    let head = 0, tail = 1;
    queue[0] = sy * w + sx; seen[queue[0]] = 1;
    const matte = mctx.createImageData(w, h);
    while (head < tail) {
      const index = queue[head++], x = index % w, y = Math.floor(index / w);
      const i = index * 4, rgb = pixels.subarray(i, i + 3);
      if (x < b.left - 4 || x > b.right + 4 || y < b.top - 4 || y > b.bottom + 4 ||
          Math.min(...rgb) < 200 || Math.max(...rgb) - Math.min(...rgb) > 25) continue;
      matte.data.fill(255, i, i + 4);
      for (const next of [index - 1, index + 1, index - w, index + w]) {
        if (next >= 0 && next < seen.length && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
      }
    }
    if (head < 10000) throw new Error('The approved face opening could not be prepared.');
    // Remove the antialiased placeholder fringe, including its thin grey outline.
    const solid = makeCanvas(w, h); solid.getContext('2d').putImageData(matte, 0, 0);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy <= 4) mctx.drawImage(solid, dx, dy);
    }
  }
  const layer = makeCanvas(w, h), c = layer.getContext('2d'); c.drawImage(image, 0, 0);
  c.globalCompositeOperation = 'destination-out'; c.drawImage(mask, 0, 0); c.globalCompositeOperation = 'source-over';
  const [left, right] = spec.eyes;
  const target = { anchor: { x: (left[0] + right[0]) / 2, y: (left[1] + right[1]) / 2 },
    eyeDistance: Math.hypot(right[0] - left[0], right[1] - left[1]), angle: Math.atan2(right[1] - left[1], right[0] - left[0]),
    width: spec.bounds.right - spec.bounds.left, height: spec.bounds.bottom - spec.bounds.top, bounds: spec.bounds };
  const tone = makeCanvas(w, h).getContext('2d'); tone.drawImage(image, 0, 0);
  const patch = tone.getImageData(...spec.tone).data, rgb = [0, 0, 0];
  for (let i = 0; i < patch.length; i += 4) for (let ch = 0; ch < 3; ch++) rgb[ch] += patch[i + ch] / (patch.length / 4);
  return { id: definition.id, name: definition.name, image, layer, mask, bounds: { ...spec.bounds }, target,
    pose: { yaw: 0, pitch: 0, roll: 0 }, quality: { rgb, brightness: (rgb[0] + rgb[1] + rgb[2]) / 3, styleStrength: .85 },
    approved: true, custom: false, generated: false, revision: 'approved-v1' };
}
