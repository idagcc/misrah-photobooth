// Geometry is independent of the UI so alignment can be checked deterministically.
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const radians = degrees => degrees * Math.PI / 180;
export const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

export function faceGeometry(landmarks, width, height) {
  const p = i => ({ x: landmarks[i].x * width, y: landmarks[i].y * height });
  const eyes = [midpoint(p(33), p(133)), midpoint(p(362), p(263))].sort((a, b) => a.x - b.x);
  const anchor = midpoint(...eyes);
  return { anchor, eyeDistance: distance(...eyes), angle: Math.atan2(eyes[1].y - eyes[0].y, eyes[1].x - eyes[0].x),
    width: distance(p(234), p(454)), height: distance(p(10), p(152)),
    bounds: { left: Math.min(...landmarks.map(q => q.x)) * width, top: Math.min(...landmarks.map(q => q.y)) * height,
      right: Math.max(...landmarks.map(q => q.x)) * width, bottom: Math.max(...landmarks.map(q => q.y)) * height } };
}

// Crop the measured frame at its original resolution. Padding leaves room for
// roll correction and the portrait's feathered opening without upscaling pixels.
export function faceCrop(landmarks, width, height, padding = .3, lowerPadding = .65) {
  const b = faceGeometry(landmarks, width, height).bounds;
  const px = (b.right - b.left) * padding, py = (b.bottom - b.top) * padding;
  const x = Math.floor(clamp(b.left - px, 0, width - 1));
  const y = Math.floor(clamp(b.top - py, 0, height - 1));
  const right = Math.ceil(clamp(b.right + px, x + 1, width));
  // Retain more original pixels below the chin for beards and smaller face fits.
  const bottom = Math.ceil(clamp(b.bottom + (b.bottom - b.top) * Math.max(padding, lowerPadding), y + 1, height));
  return { x, y, width: right - x, height: bottom - y };
}

export function landmarksForCrop(landmarks, width, height, crop) {
  return landmarks.map(p => ({ ...p, x: (p.x * width - crop.x) / crop.width,
    y: (p.y * height - crop.y) / crop.height,
    ...(Number.isFinite(p.z) ? { z: p.z * width / crop.width } : {}) }));
}

export function manualGeometry(width, height) {
  const faceHeight = Math.min(height * .72, width * 1.1);
  return { anchor: { x: width / 2, y: height / 2 - faceHeight * .12 }, eyeDistance: faceHeight * .36,
    angle: 0, width: faceHeight * .72, height: faceHeight,
    bounds: { left: width / 2 - faceHeight * .36, top: height / 2 - faceHeight / 2,
      right: width / 2 + faceHeight * .36, bottom: height / 2 + faceHeight / 2 } };
}

export function targetForOpening(bounds) {
  const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
  return { anchor: { x: (bounds.left + bounds.right) / 2, y: bounds.top + height * .31 },
    eyeDistance: width * .44, angle: 0, width, height };
}

export function alignment(source, target, settings) {
  return { x: target.anchor.x + settings.x, y: target.anchor.y + settings.y,
    scale: target.eyeDistance / Math.max(1, source.eyeDistance) * settings.scale / 100,
    angle: target.angle - (settings.flip ? -source.angle : source.angle) + radians(settings.rotation) };
}

// A transparent region touching the image border is background, not a face hole.
// Find the largest enclosed transparent component to infer a custom frame opening.
export function findTransparentOpening(rgba, width, height) {
  const seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let best = null;
  for (let seed = 0; seed < seen.length; seed++) {
    if (seen[seed] || rgba[seed * 4 + 3] > 100) continue;
    let head = 0, tail = 1, touchesBorder = false;
    let left = width, top = height, right = 0, bottom = 0;
    queue[0] = seed; seen[seed] = 1;
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (next >= 0 && !seen[next] && rgba[next * 4 + 3] <= 100) {
          seen[next] = 1; queue[tail++] = next;
        }
      }
    }
    if (!touchesBorder && tail > 16 && (!best || tail > best.area)) {
      best = { left, top, right: right + 1, bottom: bottom + 1, area: tail };
    }
  }
  return best;
}
