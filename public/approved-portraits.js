// Calibrated to the October 28 artwork, restored and exported at 2x source dimensions.
// The weaver retains her role ID; retired male portraits keep their historical records.
export const APPROVED_PORTRAITS = {
  'frontal-weaver': {
    src: 'assets/approved/palm-weaver.png', name: 'The palm weaver', width: 2048, height: 3072,
    bounds: { left: 890, top: 876, right: 1214, bottom: 1040 },
    eyes: [[970, 958], [1128, 958]], tone: [940, 1046, 48, 32],
    seeds: [[970, 958], [1128, 958]], fringe: 1
  },
  'misrah-falconer': {
    src: 'assets/approved/falconer.png', name: 'The falconer', width: 2172, height: 2896,
    bounds: { left: 954, top: 450, right: 1472, bottom: 1040 },
    eyes: [[1096, 666], [1330, 666]], tone: [1110, 1046, 80, 60],
    seeds: [[1212, 740]], fringe: 3
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
    const b = spec.bounds;
    let head = 0, tail = 0, filled = 0;
    for (const [sx, sy] of spec.seeds) { queue[tail++] = sy * w + sx; seen[sy * w + sx] = 1; }
    const matte = mctx.createImageData(w, h);
    while (head < tail) {
      const index = queue[head++], x = index % w, y = Math.floor(index / w);
      const i = index * 4, rgb = pixels.subarray(i, i + 3);
      if (x < b.left - 4 || x > b.right + 4 || y < b.top - 4 || y > b.bottom + 4 ||
          Math.min(...rgb) < 200 || Math.max(...rgb) - Math.min(...rgb) > 25) continue;
      matte.data.fill(255, i, i + 4);
      filled++;
      for (const next of [index - 1, index + 1, index - w, index + w]) {
        if (next >= 0 && next < seen.length && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
      }
    }
    if (filled < 10000) throw new Error('The approved face opening could not be prepared.');
    // Remove the antialiased placeholder fringe, including its thin grey outline.
    const solid = makeCanvas(w, h); solid.getContext('2d').putImageData(matte, 0, 0);
    for (let dy = -spec.fringe; dy <= spec.fringe; dy++) for (let dx = -spec.fringe; dx <= spec.fringe; dx++) {
      if (dx * dx + dy * dy <= spec.fringe ** 2) mctx.drawImage(solid, dx, dy);
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
    approved: true, custom: false, generated: false, revision: 'approved-v2' };
}
