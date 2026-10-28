// Use a disposable data directory. All faces are bundled fictional fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.PHOTOBOOTH_URL || 'http://127.0.0.1:8783';
const root = new URL('../', import.meta.url), out = new URL('qa/v0.13/', root);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
const ready = () => page.waitForFunction(() => !document.getElementById('touch-start').disabled, null, { timeout: 60000 });
const admin = async () => { await page.keyboard.press('F2'); await page.locator('[data-admin-tab=fit]').click(); };
const zoom = async value => {
  await page.locator('#admin-face-zoom').evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  await page.waitForFunction(value => document.getElementById('admin-fit-preview').dataset.zoom === String(value), value);
};
const save = async () => {
  await page.locator('#admin-fit-save').click();
  await page.locator('#admin-feedback').filter({ hasText: 'Face fit saved' }).waitFor();
};
const pixels = () => page.locator('#portrait').evaluate(canvas => canvas.toDataURL());
const capture = async () => {
  await page.evaluate(() => {
    window.fitCaptureComplete = new Promise(resolve => {
      let processing = false;
      const observer = new MutationObserver(() => {
        if (document.body.dataset.step === 'processing') processing = true;
        if (processing && document.body.dataset.step === 'result') { observer.disconnect(); resolve(); }
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-step'] });
    });
  });
  await page.locator('#photo-upload').setInputFiles(new URL('public/assets/frontal/frontal-guest-bearded.png', root).pathname);
  await page.evaluate(() => window.fitCaptureComplete);
};
try {
  const initial = await (await fetch(`${base}/api/bootstrap`)).json();
  const reset = await fetch(`${base}/api/settings`, { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Booth-Token':initial.token },
    body:JSON.stringify({ ...initial.settings, portraitZoom:{} }) });
  assert.equal(reset.status, 200);
  await page.goto(`${base}/?camera=sample`); await ready(); await admin();
  assert.equal(await page.locator('#admin-fit-portrait').inputValue(), 'misrah-falconer');
  await page.waitForFunction(() => document.getElementById('admin-fit-preview').dataset.zoom === '92');
  assert.match(await page.locator('#admin-fit-preview-label').textContent(), /Synthetic sample/);
  const originalPreview = await page.locator('#admin-fit-preview').evaluate(c => c.toDataURL());
  await zoom(80);
  assert.notEqual(await page.locator('#admin-fit-preview').evaluate(c => c.toDataURL()), originalPreview);
  await save();
  await page.screenshot({ path: new URL('admin-bearded-fit.png', out).pathname });
  await page.locator('#admin-fit-portrait').selectOption('frontal-weaver');
  assert.equal(await page.locator('#admin-face-zoom').inputValue(), '100');
  await zoom(110); // Closing must discard an unsaved draft.
  await page.locator('#admin-close').click();
  await page.reload(); await ready(); await admin();
  assert.equal(await page.locator('#admin-face-zoom').inputValue(), '80');
  const settings = await (await fetch(`${base}/api/bootstrap`)).json();
  assert.equal(settings.settings.portraitZoom['misrah-falconer'], 80);
  assert.equal(settings.settings.portraitZoom['frontal-weaver'], undefined);
  await page.locator('#admin-close').click();
  await page.locator('#touch-start').click(); await page.locator('#misrah-falconer').click();
  await page.locator('#cancel-sequence').click();
  await page.evaluate(() => { document.getElementById('auto-tone').checked = false; });
  await capture(); const captured80 = await pixels();
  await page.screenshot({ path: new URL('bearded-result-80.png', out).pathname });
  await admin();
  assert.equal(await page.locator('#admin-fit-sample').inputValue(), 'current');
  await page.locator('#admin-fit-preview-label').filter({ hasText: 'Current photo' }).waitFor();
  await zoom(100); assert.equal(await pixels(), captured80, 'A draft must not change the current photograph');
  await save(); assert.equal(await pixels(), captured80, 'Saving the future fit must not change the already prepared photograph');
  await page.locator('#admin-close').click();
  await page.waitForFunction(() => document.getElementById('admin-fit-preview').getContext('2d').getImageData(20,20,1,1).data[3] === 0);
  assert.equal(await page.locator('#admin-fit-preview').evaluate(c => c.getContext('2d').getImageData(20,20,1,1).data[3]), 0);
  await page.evaluate(() => { window.printedPhoto = null; window.print = () => { window.printedPhoto = document.getElementById('print-image').src; window.dispatchEvent(new Event('afterprint')); }; });
  const print80 = await page.locator('#branded-portrait').evaluate(c => c.toDataURL('image/jpeg', .98));
  await page.locator('#print-photo').click();
  assert.equal(await page.evaluate(() => window.printedPhoto), print80, 'Print must retain the captured fit after settings change');
  await capture(); assert.ok(await pixels() !== captured80, 'The next capture must use the newly saved size');
  await page.screenshot({ path: new URL('bearded-result-100.png', out).pathname });
  await admin(); await zoom(75); await zoom(115);
  await page.locator('#admin-fit-reset').click();
  assert.equal(await page.locator('#admin-face-zoom').inputValue(), '92');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator('#admin-dialog').evaluate(d => d.scrollWidth > d.clientWidth), false);
  await page.screenshot({ path: new URL('admin-mobile-fit.png', out).pathname });
  // Keep the recommended setting for the subsequent automatic camera check.
  await save(); await page.locator('#admin-close').click();
  await page.locator('#finish-session').click();
  await page.locator('#touch-start').click();
  await page.evaluate(() => { document.getElementById('sample-person').value = 'frontal-guest-bearded'; });
  await page.locator('#misrah-falconer').click();
  await page.waitForFunction(() => document.body.dataset.step === 'result', null, { timeout: 60000 });
  assert.equal(await page.locator('#print-photo').isEnabled(), true);
  assert.deepEqual(errors, []);
  await writeFile(new URL('verification.json', out), JSON.stringify({ defaultMaleZoom:92, persistedZoom:80,
    independentFemaleZoom:100, currentPhotoFrozen:true, futureCapturesUpdated:true, printConsistency:true,
    automaticBeardedCapture:true, mobileOverflow:false, errors }, null, 2));
  console.log('PASS per-portrait zoom, sample/current-photo previews, persistence, discarded drafts, frozen current photo and print, updated future captures, reset, range endpoints, mobile layout and automatic bearded capture.');
} catch (error) {
  console.error(await page.evaluate(() => ({ feedback:document.getElementById('admin-feedback')?.textContent,
    preview:document.getElementById('admin-fit-preview-label')?.textContent, size:document.getElementById('admin-face-zoom')?.value,
    portrait:document.getElementById('admin-fit-portrait')?.value })), errors);
  throw error;
} finally { await browser.close(); }
