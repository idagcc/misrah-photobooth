/* Inference, quality checks and tone correction stay off the UI thread. */
importScripts('./vendor/vision_bundle.js');
let detector, runningMode = 'IMAGE', lastTimestamp = -1, queue = Promise.resolve(), quality;
const startup = (async () => {
  try {
    quality = await import('./live-quality.js');
    const files = await Vision.FilesetResolver.forVisionTasks(new URL('./vendor/wasm', self.location).href);
    detector = await Vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: new URL('./models/face_landmarker.task', self.location).href, delegate: 'CPU' },
      runningMode, numFaces: 4, minFaceDetectionConfidence: .40,
      minFacePresenceConfidence: .5, outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true
    });
    self.postMessage({ type: 'ready' });
  } catch (error) { self.postMessage({ type: 'init-error', error: String(error.message || error) }); throw error; }
})();
startup.catch(() => {});
const frame = new OffscreenCanvas(1, 1), crop = new OffscreenCanvas(112, 112);
const frameCtx = frame.getContext('2d', { willReadFrequently: true }), cropCtx = crop.getContext('2d', { willReadFrequently: true });
async function process(data) {
  try {
    await startup;
    const started = performance.now();
    if (frame.width !== data.bitmap.width || frame.height !== data.bitmap.height) { frame.width = data.bitmap.width; frame.height = data.bitmap.height; }
    frameCtx.drawImage(data.bitmap, 0, 0);
    if (data.type === 'correct') {
      const pixels = frameCtx.getImageData(0, 0, frame.width, frame.height);
      quality.correctPixels(pixels.data, data.correction); frameCtx.putImageData(pixels, 0, 0);
      const corrected = frame.transferToImageBitmap();
      self.postMessage({ type: 'result', id: data.id, corrected }, [corrected]); return;
    }
    const wanted = data.live ? 'VIDEO' : 'IMAGE';
    if (wanted !== runningMode) {
      await detector.setOptions({ runningMode: wanted, numFaces: data.live ? 2 : 4 }); runningMode = wanted;
    }
    const timestamp = Math.max(lastTimestamp + 1, data.timestamp || performance.now());
    const result = data.live ? detector.detectForVideo(frame, timestamp) : detector.detect(frame);
    if (data.live) lastTimestamp = timestamp;
    const poses = result.facialTransformationMatrixes.map(matrix => quality.poseFromMatrix(matrix));
    const qualities = result.faceLandmarks.map(points => {
      const x = Math.max(0, Math.min(...points.map(p => p.x)) * frame.width);
      const y = Math.max(0, Math.min(...points.map(p => p.y)) * frame.height);
      const right = Math.min(frame.width, Math.max(...points.map(p => p.x)) * frame.width);
      const bottom = Math.min(frame.height, Math.max(...points.map(p => p.y)) * frame.height);
      cropCtx.clearRect(0, 0, 112, 112);
      cropCtx.drawImage(frame, x, y, Math.max(1, right - x), Math.max(1, bottom - y), 0, 0, 112, 112);
      return quality.pixelQuality(cropCtx.getImageData(0, 0, 112, 112).data, 112, 112);
    });
    let corrected = null;
    if (data.live && data.correct && qualities.length === 1) {
      const pixels = frameCtx.getImageData(0, 0, frame.width, frame.height);
      quality.correctPixels(pixels.data, quality.correctionFor(qualities[0], data.targetQuality));
      frameCtx.putImageData(pixels, 0, 0); corrected = frame.transferToImageBitmap();
    }
    self.postMessage({ type: 'result', id: data.id, landmarks: result.faceLandmarks, poses, qualities,
      elapsed: Math.round(performance.now() - started), corrected }, corrected ? [corrected] : []);
  } catch (error) { self.postMessage({ type: 'error', id: data.id, error: String(error.message || error) }); }
  finally {
    data.bitmap?.close();
    frameCtx.clearRect(0, 0, frame.width, frame.height); cropCtx.clearRect(0, 0, 112, 112);
    if (!data.live) { frame.width = 1; frame.height = 1; }
  }
}
self.onmessage = ({ data }) => { if (['detect', 'correct'].includes(data.type)) queue = queue.then(() => process(data)); };
