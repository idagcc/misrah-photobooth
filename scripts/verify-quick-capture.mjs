// Controlled detector sequences exercise the actual camera/shutter UI. Use the
// real-model kiosk and face-mapping scripts for independent image verification.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.PHOTOBOOTH_URL || 'http://127.0.0.1:8770';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const boot = async () => {
  await page.goto(base);
  await page.evaluate(async () => {
    const { LiveCamera } = await import('/live-camera.js');
    const good = { brightness: 120, rgb: [125,120,110], darkFraction: 0, clippedFraction: 0, imbalance: 0, sharpness: 70 };
    const source = document.createElement('canvas'); source.width = 640; source.height = 480;
    const c = source.getContext('2d'); c.fillStyle = '#c62828'; c.fillRect(0,0,640,480);
    window.quickQA = { mode: 'good', allow: false, count: 0, calls: 0, changed: 0, captures: [], numbers: [] };
    new MutationObserver(() => { window.quickQA.changed++; }).observe(document.getElementById('camera-guidance'), { childList: true });
    new MutationObserver(() => {
      const element = document.getElementById('capture-countdown'), q = window.quickQA;
      if (!element.hidden && q.numbers.at(-1)?.value !== element.textContent) q.numbers.push({ value: element.textContent, at: performance.now() });
    }).observe(document.getElementById('capture-countdown'), { childList: true, attributes: true, attributeFilter: ['hidden'] });
    const camera = new LiveCamera({ ready: Promise.resolve(), getSettings: () => ({ rate: 30 }),
      canCapture: () => window.quickQA.allow, getSample: async () => source,
      getFrame: () => ({ pose: { yaw: 0, pitch: 0 }, target: { angle: 0 }, quality: null }),
      detect: async () => {
        const q = window.quickQA, count = q.count++;
        const kind = q.mode === 'flicker' ? ['good','blur','dark','good'][count % 4] :
          q.mode === 'quick' ? ['good','blur','good'][Math.min(count,2)] : q.mode;
        const dx = count % 2 ? .008 : -.008;
        const points = Array.from({ length: 478 }, () => ({ x: .5 + dx, y: .46, z: 0 }));
        points[33] = points[133] = { x: .42 + dx, y: .4 }; points[362] = points[263] = { x: .58 + dx, y: .4 };
        points[10] = { x: .5 + dx, y: .18 }; points[152] = { x: .5 + dx, y: .75 };
        points[234] = { x: .33 + dx, y: .45 }; points[454] = { x: .67 + dx, y: .45 };
        const quality = { ...good, ...(kind === 'blur' ? { sharpness: 1 } : kind === 'dark' ? { brightness: 20 } : {}) };
        await new Promise(resolve => setTimeout(resolve, 12)); q.calls++;
        return { landmarks: kind === 'no-face' ? [] : kind === 'multiple' ? [points,points] : [points],
          poses: [{ yaw: kind === 'turned' ? 35 : 0, pitch: 0 }], qualities: [quality], elapsed: 12, delegate: 'CPU' };
      },
      capture: async (image, label, detection) => {
        window.quickQA.captures.push({ at: performance.now(), sharpness: detection.qualities[0].sharpness,
          width: image.width, height: image.height, automatic: window.quickQA.automatic,
          shutterAt: window.quickQA.shutterAt, numberAtShutter: window.quickQA.numberAtShutter });
      }, onClose: captured => { window.quickQA.closeCaptured = captured; }
    });
    const capture = camera.capture.bind(camera);
    camera.capture = (automatic, options) => {
      Object.assign(window.quickQA, { automatic, shutterAt: performance.now(), numberAtShutter: document.getElementById('capture-countdown').textContent });
      return capture(automatic, options);
    };
    window.quickCamera = camera; await camera.open({ sample: true });
  });
};
try {
  await page.route('**/app.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await boot(); await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => window.quickQA.captures.length), 0, 'Lights/preparation gate must prevent early capture');
  assert.equal(await page.locator('#capture').isDisabled(), true);
  await page.evaluate(() => { Object.assign(window.quickQA, { allow: true, mode: 'flicker', count: 0, changed: 0 }); document.getElementById('auto-capture').checked = false; });
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#capture').isEnabled(), true);
  assert.equal(await page.locator('#capture-countdown').isHidden(), true);
  const changes = await page.evaluate(() => window.quickQA.changed);
  assert.ok(changes <= 3, `Guidance changed ${changes} times in 800 ms`);
  await page.evaluate(() => { window.quickQA.mode = 'blur'; });
  await page.waitForFunction(() => window.quickCamera.lastAssessment?.code === 'blur');
  assert.equal(await page.locator('#capture').isEnabled(), true, 'Focus advice must not disable manual capture');
  await page.screenshot({ path: new URL('../qa/quick-capture-manual.png', import.meta.url).pathname });
  await page.locator('#capture').click();
  const manual = await page.evaluate(() => window.quickQA.captures);
  assert.equal(manual.length, 1); assert.equal(manual[0].automatic, false); assert.equal(manual[0].sharpness, 1);

  await boot();
  await page.waitForFunction(() => window.quickQA.calls >= 3);
  await page.evaluate(() => { Object.assign(window.quickQA, { allow: true, mode: 'quick', count: 0, started: performance.now() }); });
  await page.waitForFunction(() => !document.getElementById('capture-countdown').hidden && document.getElementById('capture-countdown').textContent === '3');
  await page.evaluate(() => { Object.assign(window.quickQA, { mode: 'flicker', count: 0 }); });
  await page.waitForFunction(() => window.quickQA.numberAtShutter === '1');
  assert.equal(await page.locator('#capture-countdown').isVisible(), true, '1 must be visible at the shutter');
  await page.waitForFunction(() => window.quickQA.captures.length === 1);
  const automatic = await page.evaluate(() => ({ ...window.quickQA.captures[0],
    elapsed: window.quickQA.captures[0].at - window.quickQA.started,
    countdown: window.quickQA.numbers,
    shutterElapsed: window.quickQA.captures[0].shutterAt - window.quickQA.numbers[0].at,
    cleared: window.quickCamera.scoredBitmap === null && window.quickCamera.pendingBitmap === null }));
  assert.equal(automatic.automatic, true); assert.equal(automatic.numberAtShutter, '1');
  assert.deepEqual(automatic.countdown.map(n => n.value), ['3','2','1']);
  assert.ok(automatic.shutterElapsed >= 1900 && automatic.shutterElapsed < 2300, `Shutter fired after ${automatic.shutterElapsed} ms`);
  assert.ok(Math.abs(automatic.shutterAt - automatic.countdown[2].at) < 80, 'The shutter must fire with 1, without another second of waiting');
  assert.equal(automatic.cleared, true);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.quickQA.captures.length), 1, 'Only one shutter may fire');

  for (const mode of ['no-face','multiple','turned']) {
    await boot();
    await page.evaluate(mode => { Object.assign(window.quickQA, { allow: true, mode, count: 0 }); }, mode);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.quickQA.captures.length), 0, mode);
    assert.equal(await page.locator('#capture').isDisabled(), true, mode);
    await page.evaluate(() => window.quickCamera.close());
  }
  for (const value of ['3', '1']) {
    await boot();
    await page.evaluate(() => { window.quickQA.allow = true; });
    await page.waitForFunction(value => !document.getElementById('capture-countdown').hidden && document.getElementById('capture-countdown').textContent === value, value);
    await page.locator('#close-camera').click();
    await page.waitForTimeout(value === '3' ? 2200 : 250);
    assert.equal(await page.evaluate(() => window.quickQA.captures.length), 0, `Cancel on ${value}`);
    assert.equal(await page.evaluate(() => window.quickQA.closeCaptured), false);
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL('../qa/quick-capture.json', import.meta.url), JSON.stringify({ manual, automatic,
    guidanceChangesIn800ms: changes, blocked: ['no-face','multiple','turned'], errors }, null, 2));
  console.log(`PASS 3 → 2 → 1, shutter on 1 at ${Math.round(automatic.shutterElapsed)} ms; no reset for quality jitter; manual override; face/pose gates; cancellation on 3 and 1; one-shot cleanup.`);
} finally { await browser.close(); }
