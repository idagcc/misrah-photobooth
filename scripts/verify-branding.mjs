// Production guest rendering, export and browser print share one branded composition.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.PHOTOBOOTH_URL || 'http://127.0.0.1:8772';
const root = new URL('../', import.meta.url);
const out = new URL('../../output/misrah-final-portraits/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`${base}/?camera=sample`);
  await page.waitForFunction(() => !document.getElementById('touch-start').disabled, null, { timeout: 60000 });
  await page.screenshot({ path: new URL('welcome.png', out).pathname });
  // Enter the existing capture path with a fictional bundled guest; no physical camera or printer.
  for (const [scene, name] of [['frontal-weaver', 'weaver'], ['frontal-pearl-trader', 'pearl-diver'], ['misrah-sailor', 'sailor']]) {
    await page.locator('#touch-start').click();
    await page.locator(`#${scene}`).click();
    await page.waitForFunction(() => document.body.dataset.step === 'lights');
    // Cancel camera acquisition, preserving the selected scene.
    await page.locator('#cancel-sequence').click();
    await page.locator('#photo-upload').setInputFiles(new URL(`public/assets/frontal/frontal-guest-${scene === 'frontal-weaver' ? 'woman' : 'man'}.png`, root).pathname);
    await page.waitForFunction(() => document.body.dataset.step === 'result', null, { timeout: 45000 });
    assert.equal(await page.locator('#portrait').isVisible(), false);
    assert.equal(await page.locator('#branded-portrait').isVisible(), true);
    const dimensions = await page.locator('#branded-portrait').evaluate(canvas => [canvas.width, canvas.height]);
    assert.deepEqual(dimensions, [1200, 1800]);
    // Compare the actual production composite with the original artwork, outside its calibrated openings.
    const layers = await page.evaluate(async scene => {
      const { APPROVED_PORTRAITS, prepareApprovedPortrait } = await import('./approved-portraits.js');
      const spec = APPROVED_PORTRAITS[scene], image = new Image(); image.src = spec.src; await image.decode();
      const make = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
      const frame = prepareApprovedPortrait({ id: scene, src: spec.src, name: spec.name }, image, make);
      const source = make(image.width, image.height), c = source.getContext('2d'); c.drawImage(image, 0, 0);
      const original = c.getImageData(0, 0, image.width, image.height).data;
      const actual = document.getElementById('portrait').getContext('2d').getImageData(0, 0, image.width, image.height).data;
      const mask = frame.mask.getContext('2d').getImageData(0, 0, image.width, image.height).data;
      let outsideChanges = 0, visibleChanges = 0;
      for (let i = 0; i < original.length; i += 4) {
        const changed = actual[i] !== original[i] || actual[i + 1] !== original[i + 1] || actual[i + 2] !== original[i + 2];
        if (changed && mask[i + 3] === 0) outsideChanges++;
        if (changed && mask[i + 3] === 255) visibleChanges++;
      }
      const alpha = (x, y) => mask[(y * image.width + x) * 4 + 3];
      return { outsideChanges, visibleChanges, plate: scene !== 'frontal-weaver' ||
        (alpha(560, 400) === 0 && alpha(520, 465) === 0 && alpha(600, 465) === 0 && alpha(510, 360) === 0 &&
         alpha(510, 400) === 255 && alpha(611, 400) === 255) };
    }, scene);
    assert.equal(layers.outsideChanges, 0, `${scene}: preserve all artwork outside the openings`);
    assert.ok(layers.visibleChanges > 2000, `${scene}: guest pixels replace the blank openings`);
    assert.equal(layers.plate, true, 'Gold brow, central bridge and lower plate remain over the inserted eyes');
    const data = await page.locator('#branded-portrait').evaluate(canvas => canvas.toDataURL('image/png'));
    await writeFile(new URL(`${name}-print.png`, out), Buffer.from(data.split(',')[1], 'base64'));
    await page.screenshot({ path: new URL(`${name}-result.png`, out).pathname });
    await page.evaluate(() => { window.printCalls = 0; window.print = () => { window.printCalls++; window.dispatchEvent(new Event('afterprint')); }; });
    await page.locator('#print-photo').click();
    await page.waitForFunction(() => window.printCalls === 1);
    assert.equal(await page.locator('#print-image').evaluate(img => img.naturalWidth), 1200);
    assert.equal(await page.locator('#print-image').evaluate(img => img.naturalHeight), 1800);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download').click();
    await (await downloadPromise).saveAs(new URL(`${name}-download.png`, out).pathname);
    await page.locator('#finish-session').click();
    await page.waitForFunction(() => document.body.dataset.step === 'welcome');
    assert.equal(await page.locator('#branded-portrait').evaluate(canvas => canvas.getContext('2d').getImageData(60, 100, 1, 1).data[3]), 0);
  }
  // Exercise real automatic capture with the synthetic video source and an approved blank-face template.
  await page.locator('#touch-start').click();
  await page.locator('#misrah-sailor').click();
  await page.waitForFunction(() => document.body.dataset.step === 'result', null, { timeout: 60000 });
  assert.equal(await page.locator('#print-photo').isEnabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: new URL('mobile-approved-result.png', out).pathname });
  await page.locator('#finish-session').click();
  await page.setViewportSize({ width: 1440, height: 1080 });
  // Confirm custom aspect ratios preserve all four corners of the artwork.
  const check = await page.evaluate(async () => {
    const { brandReady, brandedPortrait } = await import('./print-branding.js');
    const logo = await brandReady;
    return [[1600, 900], [400, 1600]].map(([width, height]) => {
      const source = document.createElement('canvas'); source.width = width; source.height = height;
      const c = source.getContext('2d'); c.fillStyle = '#ff0000'; c.fillRect(0, 0, width, height);
      const output = brandedPortrait(source, logo), ctx = output.getContext('2d');
      const w = output.width, h = output.height, scale = Math.min(w * .91 / width, h * .862 / height);
      const x = (w - width * scale) / 2, y = h * .12 + (h * .862 - height * scale) / 2;
      return [[x + 4, y + 4], [x + width * scale - 4, y + height * scale - 4]].every(([px, py]) => {
        const p = ctx.getImageData(px, py, 1, 1).data; return p[0] === 255 && p[1] === 0 && p[2] === 0;
      });
    });
  });
  assert.deepEqual(check, [true, true]);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: new URL('mobile-welcome.png', out).pathname });
  // A missing brand asset must block guest startup rather than allow an unbranded print.
  await page.route('**/assets/brand/misrah-logo.png', route => route.abort());
  await page.reload();
  await page.waitForFunction(() => document.getElementById('welcome-status').textContent.includes('could not start'));
  assert.equal(await page.locator('#touch-start').isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('PASS all three approved guest scenes, exact foreground preservation including gold plate, automatic simulated-camera capture, branded preview, PNG download, 4x6 browser print, reset clearing, custom aspect ratio preservation, mobile layout and missing-logo startup block.');
} finally { await browser.close(); }
