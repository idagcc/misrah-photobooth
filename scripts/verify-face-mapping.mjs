// Use a disposable server/data directory, as with verify-kiosk.mjs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.PHOTOBOOTH_URL || 'http://127.0.0.1:8768';
const qa = new URL('../qa/', import.meta.url).pathname;
await mkdir(qa, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
const page = await context.newPage(), errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const step = value => page.waitForFunction(s => document.body.dataset.step === s, value, { timeout: 45000 });
try {
  // Observe the real worker boundary to verify cropping and reuse of the scored
  // landmarks, without replacing the model or the guest capture pipeline.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => {
        if (window.pauseQuickCapture && document.body.dataset.step === 'camera') document.getElementById('auto-capture').checked = false;
      }).observe(document.body, { attributes: true, attributeFilter: ['data-step'] });
    });
    window.mappingQA = { still: 0, correction: null };
    const WorkerClass = window.Worker;
    window.Worker = class extends WorkerClass {
      postMessage(message, ...args) {
        if (message.type === 'detect' && !message.live) window.mappingQA.still++;
        if (message.type === 'correct') window.mappingQA.correction = { width: message.bitmap.width, height: message.bitmap.height };
        return super.postMessage(message, ...args);
      }
    };
  });
  await page.goto(`${base}/?camera=sample`);
  await page.waitForFunction(() => !document.getElementById('touch-start').disabled, null, { timeout: 60000 });
  await page.keyboard.press('Control+Alt+Shift+A');
  await page.locator('#admin-rate').selectOption('30');
  await page.locator('#admin-settings button[type=submit]').click();
  await page.locator('#admin-feedback').filter({ hasText: 'Device settings saved' }).waitFor();
  await page.locator('#admin-close').click();
  await page.locator('#touch-start').click();
  const cases = [
    ['frontal-guest-woman', 'frontal-weaver', 'left'],
    ['frontal-guest-woman', 'frontal-weaver', 'right'],
    ['frontal-guest-man', 'misrah-falconer', 'left'],
    ['frontal-guest-bearded', 'misrah-falconer', 'right']
  ];
  for (const [person, template, position] of cases) {
    await page.evaluate(({ person, position }) => {
      window.pauseQuickCapture = true;
      document.getElementById('sample-person').value = person;
      document.getElementById('sample-condition').value = position;
      window.mappingQA.correction = null;
    }, { person, position });
    const before = await page.evaluate(() => window.mappingQA.still);
    await page.locator(`#${template}`).click();
    await step('camera');
    await page.waitForFunction(() => document.getElementById('camera-guidance').dataset.ready === 'true');
    const outline = await page.locator('#face-map').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let left = canvas.width, right = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { const x = ((i - 3) / 4) % canvas.width; left = Math.min(left, x); right = Math.max(right, x); }
      return { centre: (left + right) / 2 / canvas.width, faces: canvas.dataset.faces };
    });
    assert.equal(outline.faces, '1');
    assert.ok(position === 'left' ? outline.centre < .35 : outline.centre > .65, JSON.stringify(outline));
    await page.screenshot({ path: `${qa}experiment-${person}-${position}-camera.png` });
    // Pause automatic capture for the outline assertions, then test each path.
    if (position === 'left') await page.locator('#capture').click();
    else await page.evaluate(() => { document.getElementById('auto-capture').checked = true; });
    await step('result');
    const measured = await page.evaluate(() => ({ ...window.mappingQA,
      cameraStopped: document.getElementById('camera-video').srcObject === null,
      cleared: document.getElementById('face-map').dataset.faces === '0' }));
    assert.equal(measured.still, before, 'Capture must reuse the matching live landmarks');
    assert.ok(measured.correction.width < 640 && measured.correction.height <= 480, JSON.stringify(measured));
    assert.equal(measured.cameraStopped, true); assert.equal(measured.cleared, true);
    const photo = await page.locator('#portrait').evaluate(c => c.toDataURL('image/png').split(',')[1]);
    await writeFile(`${qa}experiment-${person}-${position}-portrait.png`, Buffer.from(photo, 'base64'));
    results.push({ person, template, position, outline, crop: measured.correction });
    console.log(`PASS ${person}, ${position}, ${template}: tracked, cropped and fitted`);
    await page.locator('#choose-another').click(); await step('choose');
  }
  // Bad inputs must never trigger automatic capture. The manual shutter may
  // remain available for a frontal face when only exposure/focus needs advice.
  for (const condition of ['no-face', 'multiple', 'dark', 'blur']) {
    await page.evaluate(condition => { window.pauseQuickCapture = false; document.getElementById('sample-condition').value = condition; }, condition);
    await page.locator('#frontal-weaver').click(); await step('camera');
    await page.waitForTimeout(1800);
    assert.equal(await page.locator('body').getAttribute('data-step'), 'camera', condition);
    if (condition === 'no-face' || condition === 'multiple') {
      assert.equal(await page.locator('#capture').isDisabled(), true, condition);
    }
    assert.equal(await page.locator('#capture-countdown').isHidden(), true, condition);
    if (condition === 'no-face') assert.equal(await page.locator('#face-map').getAttribute('data-faces'), '0');
    await page.locator('#close-camera').click(); await step('choose');
  }
  // A clear moving face can now be cropped from the measured frame directly.
  await page.evaluate(() => { document.getElementById('sample-condition').value = 'motion'; });
  await page.locator('#frontal-weaver').click(); await step('result');
  await page.locator('#choose-another').click(); await step('choose');
  // A controlled delayed inference verifies that tapping during the next frame
  // uses the previous scored pixels and their matching crop coordinates.
  const race = await context.newPage();
  race.on('pageerror', error => errors.push(error.message));
  await race.route('**/app.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await race.goto(`${base}/?camera=sample`);
  await race.evaluate(async () => {
    const { LiveCamera } = await import('/live-camera.js');
    const points = Array.from({ length: 478 }, () => ({ x: .5, y: .46, z: 0 }));
    points[33] = points[133] = { x: .42, y: .4 }; points[362] = points[263] = { x: .58, y: .4 };
    points[10] = { x: .5, y: .18 }; points[152] = { x: .5, y: .75 };
    points[234] = { x: .33, y: .45 }; points[454] = { x: .67, y: .45 };
    const result = { landmarks: [points], poses: [{ yaw: 0, pitch: 0 }],
      qualities: [{ brightness: 120, rgb: [125,120,110], darkFraction: 0, clippedFraction: 0, imbalance: 0, sharpness: 70 }], elapsed: 1 };
    const sample = document.createElement('canvas'); sample.width = 640; sample.height = 480;
    sample.getContext('2d').fillStyle = '#c62828'; sample.getContext('2d').fillRect(0,0,640,480);
    window.raceCalls = 0;
    window.raceCamera = new LiveCamera({ ready: Promise.resolve(), getSample: async () => sample,
      getFrame: () => ({ pose: { yaw: 0, pitch: 0 }, target: { angle: 0 }, quality: null }),
      detect: async () => {
        window.raceCalls++;
        if (window.raceCalls === 2) setTimeout(() => {
          const c = window.raceCamera.sampleBase.getContext('2d'); c.fillStyle = '#1565c0'; c.fillRect(0,0,640,480);
          window.raceCamera.drawSample();
        }, 0);
        if (window.raceCalls >= 3) return new Promise(resolve => { window.releaseInference = () => resolve(result); });
        return result;
      },
      capture: async (image, label, detection) => {
        window.raceCapture = { width: image.width, height: image.height,
          pixel: [...image.getContext('2d').getImageData(image.width / 2, image.height / 2, 1, 1).data],
          points: detection.landmarks[0] };
      }
    });
    await window.raceCamera.open({ sample: true });
    document.getElementById('auto-capture').checked = false;
  });
  await race.waitForFunction(() => window.raceCalls >= 3 && window.raceCamera.lastAssessment?.ready);
  const pending = await race.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const ctx = c.getContext('2d'); ctx.drawImage(window.raceCamera.pendingBitmap, 0, 0);
    return [...ctx.getImageData(320,240,1,1).data];
  });
  assert.ok(pending[2] > 180 && pending[0] < 30, 'Next frame must be blue while its inference is pending');
  await race.evaluate(async () => { await window.raceCamera.capture(false); window.releaseInference(); });
  const captured = await race.evaluate(() => window.raceCapture);
  assert.ok(captured.pixel.every((v, i) => Math.abs(v - [198,40,40,255][i]) <= 2), 'Shutter must retain the scored red frame during blue-frame inference');
  assert.ok(captured.width < 640 && captured.height < 480);
  assert.ok(captured.points.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));
  await race.close();
  assert.deepEqual(errors, []);
  await writeFile(`${qa}experiment-face-mapping.json`, JSON.stringify({ cases: results, delayedInference: 'passed', qualityGates: 'passed' }, null, 2));
  console.log('PASS quality gates, cleanup, and shutter during delayed inference.');
} finally { await browser.close(); }
