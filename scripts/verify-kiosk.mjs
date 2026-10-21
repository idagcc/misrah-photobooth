// Run against the local server. Playwright is a development-only dependency.
// PLAYWRIGHT_PATH may point to an existing Playwright installation's index.mjs.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.PHOTOBOOTH_URL || 'http://127.0.0.1:8766';
const qa = new URL('../qa/', import.meta.url).pathname;
await mkdir(qa, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
const errors = [];
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const waitStep = step => page.waitForFunction(s => document.body.dataset.step === s, step, { timeout: 45000 });
const shot = name => page.screenshot({ path: `${qa}kiosk-${name}.png` });
const boot = async url => {
  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById('touch-start').disabled, null, { timeout: 60000 });
};
try {
  await boot(`${base}/?camera=sample`);
  assert.equal(await page.locator('body').getAttribute('data-step'), 'welcome');
  await shot('welcome');
  await page.locator('#touch-start').click();
  assert.equal(await page.locator('#scene-list .frame-card:enabled').count(), 2);
  await shot('templates');
  // Cancelling while camera acquisition and the light clip overlap must not capture later.
  await page.locator('#frontal-weaver').click();
  await waitStep('lights');
  await page.waitForFunction(() => document.getElementById('lights-video').currentTime > .5);
  await shot('lights');
  await page.locator('#cancel-sequence').click();
  await waitStep('choose');
  await page.waitForTimeout(5000);
  assert.equal(await page.locator('body').getAttribute('data-step'), 'choose');
  assert.equal(await page.evaluate(() => document.getElementById('camera-video').srcObject), null);
  await page.locator('#frontal-weaver').click();
  await waitStep('camera');
  await shot('camera');
  await waitStep('result');
  await shot('result');
  assert.match(await page.locator('#sample-disclosure').textContent(), /Sample portrait/);
  assert.equal(await page.locator('#print-photo').isEnabled(), true);
  assert.equal(await page.evaluate(() => document.getElementById('camera-video').srcObject), null);
  // Stub only the external print window; verify the actual photo and print stylesheet.
  await page.evaluate(() => { window.printCalls = 0; window.print = () => { window.printCalls++; window.dispatchEvent(new Event('afterprint')); }; });
  await page.locator('#print-photo').click();
  await page.waitForFunction(() => window.printCalls === 1);
  assert.match(await page.locator('#print-image').getAttribute('src'), /^data:image\/jpeg/);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.guest-header').isVisible(), false);
  assert.equal(await page.locator('#print-sheet').isVisible(), true);
  await page.pdf({ path: `${qa}kiosk-print.pdf`, preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /misrah-portrait.*\.png$/);
  await download.saveAs(`${qa}kiosk-export.png`);
  await page.locator('#new-session').click();
  await waitStep('lights');
  assert.equal(await page.locator('#scene-list .selected').getAttribute('id'), 'frontal-weaver');
  assert.equal(await page.locator('#print-image').getAttribute('src'), null);
  await waitStep('result');
  await page.locator('#choose-another').click();
  await waitStep('choose');
  // Exercise both frontal portraits through the real model/compositor.
  // Scene references are explicit internal fixtures, never represented as real guests.
  await page.evaluate(() => { document.getElementById('sample-person').value = 'reference'; });
  const ids = await page.locator('#scene-list .frame-card').evaluateAll(items => items.map(item => item.id));
  for (const id of ids) {
    await page.locator(`#${id}`).click();
    await waitStep('result');
    assert.equal(await page.locator('#print-photo').isEnabled(), true, id);
    console.log(`PASS capture and review: ${id}`);
    await page.locator('#choose-another').click();
    await waitStep('choose');
  }
  // Return for the next guest and clear the print image.
  await page.locator('#frontal-weaver').click();
  await waitStep('result');
  await page.locator('#finish-session').click();
  await waitStep('welcome');
  assert.equal(await page.locator('#print-image').getAttribute('src'), null);
  assert.equal(await page.locator('#download').isEnabled(), false);
  // Idle warning/reset without waiting two real minutes (only the wall clock changes).
  await page.locator('#touch-start').click();
  await page.evaluate(() => { const original = Date.now; window.realNow = original; Date.now = () => original() + 105000; });
  await page.locator('#idle-notice').waitFor({ state: 'visible' });
  await page.evaluate(() => { Date.now = () => window.realNow() + 125000; });
  await waitStep('welcome');
  await page.evaluate(() => { Date.now = window.realNow; });
  // Phone layout: no horizontal overflow, both portrait touch targets remain available.
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('mobile-welcome');
  await page.locator('#touch-start').click();
  await shot('mobile-templates');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const cards = await page.locator('#scene-list .frame-card').evaluateAll(items => items.map(item => ({ x: item.getBoundingClientRect().x, y: item.getBoundingClientRect().y })));
  assert.equal(cards[0].y, cards[1].y);
  assert.ok(cards[1].x > cards[0].x);
  // Keep the default independent test guest for the mobile result.
  await page.evaluate(() => { document.getElementById('sample-person').value = 'frontal-guest-woman'; });
  await page.locator('#frontal-weaver').click();
  await waitStep('result');
  await shot('mobile-result');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  // Camera denial has a recoverable retry action, with no active stream.
  const denied = await context.newPage();
  denied.on('pageerror', error => errors.push(error.message));
  await denied.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied in verification', 'NotAllowedError'); }; });
  await denied.goto(base);
  await denied.waitForFunction(() => !document.getElementById('touch-start').disabled, null, { timeout: 60000 });
  await denied.locator('#touch-start').click();
  await denied.locator('#frontal-weaver').click();
  await denied.locator('#retry-camera').waitFor({ state: 'visible' });
  assert.match(await denied.locator('#camera-guidance').textContent(), /Allow camera access/);
  assert.equal(await denied.evaluate(() => document.getElementById('camera-video').srcObject), null);
  await denied.locator('#close-camera').click();
  assert.equal(await denied.locator('body').getAttribute('data-step'), 'choose');
  await denied.close();
  // Operator entry still loads and its diagnostics stay available.
  await page.goto(`${base}/studio.html`);
  await page.waitForFunction(() => document.getElementById('model-status').textContent.includes('ready'), null, { timeout: 60000 });
  assert.equal(await page.locator('#photo-upload').count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS welcome, lights, cancellation, auto-capture, retry, two frontal portraits, print layout, export, finish, idle cleanup, phone, permission failure and operator startup.');
} finally { await browser.close(); }
