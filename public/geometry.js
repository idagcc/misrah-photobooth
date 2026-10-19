// Geometry is independent of the UI so alignment can be checked deterministically.
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const radians = degrees => degrees * Math.PI / 180;
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
