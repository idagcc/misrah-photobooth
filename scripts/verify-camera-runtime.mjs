import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.PHOTOBOOTH_URL || 'http://127.0.0.1:8769';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.route('**/app.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  const workerSource = await readFile(new URL('../public/detector-worker.js', import.meta.url), 'utf8');
  await page.route('**/detector-worker.js?fallback=1', route => route.fulfill({ contentType: 'application/javascript',
    body: workerSource.replace('canvas: new OffscreenCanvas(1, 1)', "canvas: (() => { throw new Error('GPU unavailable in verification'); })()") }));
  await page.goto(base);
  const workers = await page.evaluate(async () => {
    const image = new Image(); image.src = '/assets/frontal/frontal-guest-woman.png'; await image.decode();
    const results = [];
    for (const query of ['delegate=CPU', 'fallback=1']) {
      const worker = new Worker(`/detector-worker.js?${query}`);
      try {
        const ready = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Worker startup timed out')), 45000);
          worker.onmessage = ({ data }) => { clearTimeout(timer); data.type === 'ready' ? resolve(data) : reject(new Error(data.error)); };
          worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
        });
        const bitmap = await createImageBitmap(image, { resizeWidth: 426, resizeHeight: 640 });
        const result = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Detection timed out')), 20000);
          worker.onmessage = ({ data }) => { clearTimeout(timer); data.type === 'result' ? resolve(data) : reject(new Error(data.error)); };
          worker.postMessage({ id: 1, type: 'detect', bitmap }, [bitmap]);
        });
        results.push({ query, delegate: ready.delegate, faces: result.landmarks.length });
      } finally { worker.terminate(); }
    }
    return results;
  });
  for (const result of workers) { assert.equal(result.delegate, 'CPU'); assert.equal(result.faces, 1); }
  const runtime = await page.evaluate(async () => {
    const { LiveCamera } = await import('/live-camera.js');
    const points = Array.from({ length: 478 }, () => ({ x: .5, y: .46, z: 0 }));
    points[33] = points[133] = { x: .42, y: .4 }; points[362] = points[263] = { x: .58, y: .4 };
    points[10] = { x: .5, y: .18 }; points[152] = { x: .5, y: .75 };
    points[234] = { x: .33, y: .45 }; points[454] = { x: .67, y: .45 };
    const result = { landmarks: [points], poses: [{ yaw: 0, pitch: 0 }], delegate: 'CPU', elapsed: 75,
      qualities: [{ brightness: 120, rgb: [125,120,110], darkFraction: 0, clippedFraction: 0, imbalance: 0, sharpness: 70 }] };
    const source = document.createElement('canvas'); source.width = 1280; source.height = 720;
    const c = source.getContext('2d'); c.fillStyle = '#aaa'; c.fillRect(0,0,1280,720);
    const stream = source.captureStream(30); let tick = 0;
    const timer = setInterval(() => { c.fillStyle = tick++ % 2 ? '#aaa' : '#bbb'; c.fillRect(0,0,1,1); }, 1000 / 30);
    let constraints, active = 0, maxActive = 0;
    navigator.mediaDevices.getUserMedia = async value => { constraints = value; return stream; };
    navigator.mediaDevices.enumerateDevices = async () => [];
    const camera = new LiveCamera({ ready: Promise.resolve(), getSettings: () => ({ rate: 30 }), canCapture: () => false,
      getFrame: () => ({ pose: { yaw: 0, pitch: 0 }, target: { angle: 0 }, quality: null }),
      detect: async () => { active++; maxActive = Math.max(maxActive, active); await new Promise(r => setTimeout(r, 75)); active--; return result; },
      capture: () => { throw new Error('Capture must stay gated'); } });
    await camera.open(); await new Promise(r => setTimeout(r, 1800));
    const measured = { ...camera.metrics }; camera.close(); clearInterval(timer);
    await new Promise(r => setTimeout(r, 100));
    return { constraints, measured, maxActive, ended: stream.getTracks().every(t => t.readyState === 'ended'),
      cleared: camera.scoredBitmap === null && camera.pendingBitmap === null && camera.frameCallback === null };
  });
  assert.equal(runtime.constraints.video.width.ideal, 3840);
  assert.equal(runtime.constraints.video.height.ideal, 2160);
  assert.equal(runtime.measured.width, 1280); assert.equal(runtime.measured.height, 720);
  assert.equal(runtime.measured.targetChecks, 30);
  assert.ok(runtime.measured.checksFps > 0 && runtime.measured.checksFps < 20);
  assert.equal(runtime.maxActive, 1); assert.equal(runtime.ended, true); assert.equal(runtime.cleared, true);
  assert.deepEqual(errors, []);
  await writeFile(new URL('../qa/4k30-runtime.json', import.meta.url), JSON.stringify({ workers, runtime }, null, 2));
  console.log('PASS real CPU inference, GPU initialization fallback, lower negotiated camera resolution, truthful slow-worker fps, single in-flight job and stop cleanup.');
} finally { await browser.close(); }
