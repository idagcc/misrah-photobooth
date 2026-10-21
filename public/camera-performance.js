export const trackingRates = [5, 10, 15, 30];

export function cameraProfile(rate = 30, deviceId = '') {
  const trackingRate = trackingRates.includes(Number(rate)) ? Number(rate) : 30;
  const highResolution = trackingRate === 30;
  return { trackingRate, analysisLimit: 640, video: {
    width: { ideal: highResolution ? 3840 : 1280 },
    height: { ideal: highResolution ? 2160 : 960 },
    frameRate: { ideal: 30, max: 30 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' })
  } };
}

// A small tolerance avoids skipping alternate 29.97/30 fps camera frames due to
// sub-millisecond callback jitter. No duplicate video frame is ever analysed.
export function analysisDue(lastAt, now, rate) {
  return lastAt === null || now - lastAt >= 1000 / rate - 2;
}
