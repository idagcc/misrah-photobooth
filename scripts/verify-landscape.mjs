import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.PHOTOBOOTH_URL || 'http://127.0.0.1:8774';
const out = new URL('../../output/misrah-landscape/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`${base}/landscape.html?camera=sample`);
  const frame = await (await page.waitForSelector('#booth-screen')).contentFrame();
  await frame.waitForFunction(() => !document.getElementById('touch-start').disabled, null, { timeout: 60000 });
  assert.equal(new URL(frame.url()).search, '?camera=sample');
  for (const [width, height] of [[1920,1080],[1366,768],[1280,800],[1080,1920],[3840,2160]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => {
      const f = document.getElementById('booth-screen'), b = f.getBoundingClientRect();
      return Math.abs(b.width - Math.min(innerWidth, innerHeight * 16 / 9)) < 1;
    });
    assert.deepEqual(await frame.evaluate(() => [innerWidth, innerHeight]), [1920,1080]);
    const b = await page.locator('#booth-screen').boundingBox();
    assert.ok(Math.abs(b.width / b.height - 16 / 9) < .0001);
    assert.ok(b.x >= -.1 && b.y >= -.1 && b.x + b.width <= width + .1 && b.y + b.height <= height + .1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: new URL('welcome-1920x1080.png', out).pathname });
  await frame.locator('#touch-start').click();
  assert.equal(await frame.locator('#scene-list .frame-card:enabled').count(), 3);
  const cards = await frame.locator('#scene-list .frame-card').evaluateAll(items => items.map(item => item.getBoundingClientRect().top));
  assert.ok(cards.every(top => top === cards[0]));
  await page.screenshot({ path: new URL('choices-1920x1080.png', out).pathname });
  await frame.locator('#misrah-sailor').click();
  await frame.waitForFunction(() => document.body.dataset.step === 'result', null, { timeout: 60000 });
  assert.deepEqual(await frame.evaluate(() => [innerWidth, innerHeight]), [1920,1080]);
  assert.equal(await frame.locator('#branded-portrait').isVisible(), true);
  assert.deepEqual(await frame.locator('#branded-portrait').evaluate(c => [c.width,c.height]), [1200,1800]);
  await page.screenshot({ path: new URL('result-1920x1080.png', out).pathname });
  await frame.evaluate(() => { window.printCalled = false; window.print = () => { window.printCalled = true; window.dispatchEvent(new Event('afterprint')); }; });
  await frame.locator('#print-photo').click();
  await frame.waitForFunction(() => window.printCalled);
  assert.deepEqual(await frame.locator('#print-image').evaluate(image => [image.naturalWidth,image.naturalHeight]), [1200,1800]);
  await frame.locator('#finish-session').click();
  await frame.waitForFunction(() => document.body.dataset.step === 'welcome');
  await page.keyboard.press('Meta+Alt+Shift+A');
  assert.equal(await frame.locator('#admin-dialog').evaluate(dialog => dialog.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await frame.locator('#admin-dialog').evaluate(dialog => dialog.open), false);
  assert.deepEqual(errors, []);
  const report = { resolution: '1920x1080', aspectRatio: '16:9', testedViewports: 5, automaticSampleCapture: 'passed', portraitPrint: '1200x1800', adminShortcut: 'passed', errors };
  await writeFile(new URL('verification.json', out), JSON.stringify(report, null, 2));
  console.log('PASS fixed 1920x1080 viewport across five display sizes, three landscape choices, automatic capture, portrait print image and admin keyboard access.');
} finally { await browser.close(); }
