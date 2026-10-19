// Pure quality and capture policy functions shared by the worker, UI and tests.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const degrees = value => value * 180 / Math.PI;

// MediaPipe serializes the pose transform in column-major order. Normalize
// rotation columns first because the canonical-to-camera matrix includes scale.
export function poseFromMatrix(matrix) {
  const m = matrix?.data || matrix;
  if (!m || m.length !== 16 || !Array.from(m).every(Number.isFinite)) return null;
  const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  if (Math.min(sx, sy, sz) < 1e-6) return null;
  const yaw = Math.asin(clamp(-m[2] / sx, -1, 1));
  const pitch = Math.atan2(m[6] / sy, m[10] / sz);
  // Screen Y is down; use the eye line for roll in guidance instead.
  return { yaw: degrees(yaw), pitch: degrees(pitch), roll: degrees(Math.atan2(m[1] / sx, m[0] / sx)) };
}

export function pixelQuality(rgba, width, height) {
  const gray = new Float32Array(width * height);
  let sum = 0, red = 0, green = 0, blue = 0, n = 0, dark = 0, clipped = 0, left = 0, right = 0, nl = 0, nr = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, p = i * 4;
    const luma = rgba[p] * .2126 + rgba[p + 1] * .7152 + rgba[p + 2] * .0722; gray[i] = luma;
    // Use a central ellipse, avoiding the crop background and much of the hair.
    if (((x / width - .5) / .38) ** 2 + ((y / height - .53) / .43) ** 2 > 1) continue;
    sum += luma; red += rgba[p]; green += rgba[p + 1]; blue += rgba[p + 2]; n++;
    dark += luma < 24; clipped += luma > 246;
    if (x < width * .5) { left += luma; nl++; } else { right += luma; nr++; }
  }
  let lapSum = 0, lapSquared = 0, lapN = 0;
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    if (((x / width - .5) / .34) ** 2 + ((y / height - .53) / .38) ** 2 > 1) continue;
    const i = y * width + x;
    const lap = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
    lapSum += lap; lapSquared += lap * lap; lapN++;
  }
  return { brightness: sum / Math.max(1, n), rgb: [red, green, blue].map(v => v / Math.max(1, n)),
    darkFraction: dark / Math.max(1, n), clippedFraction: clipped / Math.max(1, n),
    imbalance: Math.abs(left / Math.max(1, nl) - right / Math.max(1, nr)),
    sharpness: Math.max(0, lapSquared / Math.max(1, lapN) - (lapSum / Math.max(1, lapN)) ** 2) };
}

export const liveDefaults = { yawLimit: 16, pitchLimit: 17, rollLimit: 18, minSharpness: 16,
  minBrightness: 42, maxBrightness: 224, maxImbalance: 65, holdMs: 1400, maxSampleGap: 750 };

export function assessFrame({ faces = [], poses = [], qualities = [], width, height, previous, targetPose, targetRoll = 0 }, options = {}) {
  const o = { ...liveDefaults, ...options }, checks = { face: false, position: false, pose: false, light: false, sharp: false, steady: false };
  const issue = (code, message) => ({ ready: false, code, message, checks });
  if (!faces.length) return issue('no-face', 'Step into the outline and look toward the camera.');
  if (faces.length > 1) return issue('multiple', 'One guest at a time. Keep other faces outside the camera view.');
  checks.face = true;
  const f = faces[0], b = f.bounds, cx = (b.left + b.right) / 2 / width, cy = (b.top + b.bottom) / 2 / height;
  const ratio = f.width / width;
  if (b.left < width * .025 || b.right > width * .975 || b.top < height * .025 || b.bottom > height * .975) return issue('clipped', 'Keep your whole face inside the camera view.');
  if (ratio < .20 || f.height / height < .25) return issue('too-far', 'Move a little closer to the camera.');
  if (ratio > .62 || f.height / height > .82) return issue('too-close', 'Move a little farther from the camera.');
  if (Math.abs(cx - .5) > .15 || Math.abs(cy - .47) > .17) return issue('off-center', 'Move your face into the centre of the outline.');
  checks.position = true;
  const pose = poses[0];
  if (!pose) return issue('pose-unavailable', 'Face angle is unavailable. Use manual capture or refresh the detector.');
  const yawDelta = pose.yaw - (targetPose?.yaw || 0), pitchDelta = pose.pitch - (targetPose?.pitch || 0);
  if (Math.abs(yawDelta) > o.yawLimit) return issue('yaw', 'Turn your face gently toward the camera to match the portrait.');
  if (Math.abs(pitchDelta) > o.pitchLimit) return issue('pitch', pitchDelta > 0 ? 'Lower your chin a little.' : 'Raise your chin a little.');
  if (Math.abs(degrees(f.angle - targetRoll)) > o.rollLimit) return issue('roll', 'Straighten your head a little.');
  checks.pose = true;
  const q = qualities[0];
  if (!q || !Number.isFinite(q.brightness)) return issue('quality-unavailable', 'Checking the light on your face…');
  if (q.brightness < o.minBrightness || q.darkFraction > .48) return issue('dark', 'Add soft light in front of your face.');
  if (q.brightness > o.maxBrightness || q.clippedFraction > .22) return issue('bright', 'The light is too strong. Move away from direct light.');
  if (q.imbalance > o.maxImbalance) return issue('uneven', 'Turn toward the light so both sides of your face are lit.');
  checks.light = true;
  if (q.sharpness < o.minSharpness) return issue('blur', 'Hold still while the camera focuses.');
  checks.sharp = true;
  if (!previous) return issue('settling', 'Great. Hold your pose for a moment.');
  const motion = Math.hypot(f.anchor.x / width - previous.x, f.anchor.y / height - previous.y);
  const scaleChange = Math.abs(f.eyeDistance / width - previous.distance) / Math.max(.001, previous.distance);
  if (motion > .018 || scaleChange > .065) return issue('motion', 'Hold still for a moment.');
  checks.steady = true;
  return { ready: true, code: 'ready', message: 'Looking good. Hold still for your portrait.', checks };
}

export function advanceHold(state, ready, now, options = {}) {
  const o = { ...liveDefaults, ...options };
  if (!ready || (state.lastAt !== null && now - state.lastAt > o.maxSampleGap)) {
    state.since = null; state.samples = 0;
  }
  state.lastAt = now;
  if (!ready) return { progress: 0, capture: false };
  if (state.since === null) state.since = now;
  state.samples++;
  const progress = clamp((now - state.since) / o.holdMs, 0, 1);
  return { progress, capture: progress >= 1 && state.samples >= 5 };
}

export function correctionFor(quality, target = null) {
  if (!quality || quality.brightness <= 1) return { exposure: 1, contrast: 1, gains: [1, 1, 1], shadow: 0 };
  // Blend toward a restrained reference exposure, preserving complexion.
  const reference = clamp(target?.brightness || 125, 90, 158);
  const exposure = clamp((reference / quality.brightness) ** .45, .8, 1.28);
  const mean = quality.rgb.reduce((a, b) => a + b, 0) / 3;
  const targetMean = target?.rgb ? target.rgb.reduce((a,b) => a+b,0) / 3 : null;
  const gains = quality.rgb.map((v, i) => clamp(((targetMean ? target.rgb[i] / targetMean : 1) * mean / Math.max(25, v)) ** .24, .90, 1.10));
  const style = target?.styleStrength ? { strength: target.styleStrength,
    rgb: target.rgb.map(v => clamp(v / Math.max(30, target.brightness), .6, 1.65)) } : null;
  return { exposure, contrast: quality.brightness < 75 ? .96 : 1.02, gains, style,
    shadow: quality.brightness < 95 ? clamp((95 - quality.brightness) / 600, 0, .08) : 0 };
}

export function correctPixels(rgba, correction) {
  const rgb = new Float64Array(3);
  for (let i = 0; i < rgba.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      let value = rgba[i + channel] / 255 * correction.exposure * correction.gains[channel];
      value = (value - .5) * correction.contrast + .5;
      rgb[channel] = value + correction.shadow * (1 - clamp(value, 0, 1)) ** 2;
    }
    const luma = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    for (let channel = 0; channel < 3; channel++) {
      const value = correction.style ? rgb[channel] * (1 - correction.style.strength) + luma * correction.style.rgb[channel] * correction.style.strength : rgb[channel];
      rgba[i + channel] = clamp(Math.round(value * 255), 0, 255);
    }
  }
  return rgba;
}
