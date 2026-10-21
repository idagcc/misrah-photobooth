// Use a disposable --data-dir. Only fictional local fixtures are archived.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.PHOTOBOOTH_URL || 'http://127.0.0.1:8768';
const root = new URL('../', import.meta.url);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const storage = async () => (await fetch(`${base}/api/storage`)).json();
const boot = async url => { await page.goto(url); await page.waitForFunction(() => !document.getElementById('touch-start').disabled, null, { timeout: 60000 }); };
const capture = async () => {
  // The hidden shared upload path enters the production guest setSource pipeline
  // without opening any physical camera or rewriting application code.
  await page.evaluate(() => {
    window.nextCapture = new Promise(resolve => {
      let processing = false;
      const observer = new MutationObserver(() => {
        if (document.body.dataset.step === 'processing') processing = true;
        if (processing && document.body.dataset.step === 'result') { observer.disconnect(); resolve(); }
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-step'] });
    });
  });
  await page.locator('#photo-upload').setInputFiles(new URL('public/assets/frontal/frontal-guest-woman.png', root).pathname);
  await page.evaluate(() => window.nextCapture);
};
try {
  const initial = await storage();
  await boot(base);
  let firstRequest;
  page.on('request', request => { if (request.url().endsWith('/api/archive') && !firstRequest) firstRequest = request.postDataJSON(); });
  await capture();
  const saved = await storage();
  assert.equal(saved.photos, initial.photos + 1);
  assert.ok(saved.bytes > initial.bytes);
  assert.match(saved.weeks[0].week, /^\d{4}-W\d{2}$/);
  assert.match(await page.locator('.guest-privacy').textContent(), /saved on this Mac/);
  const response = await fetch(`${base}/api/bootstrap`), cfg = await response.json();
  const retry = await fetch(`${base}/api/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Booth-Token': cfg.token }, body: JSON.stringify(firstRequest) });
  const receipt = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal((await storage()).photos, saved.photos);
  const bytes = await readFile(`${saved.path}/${receipt.path}`);
  assert.equal(bytes.length, receipt.bytes);
  assert.equal(bytes[0], 255); assert.equal(bytes[1], 216);
  assert.equal((await fetch(`${base}/photos/${receipt.path}`)).status, 404);
  // Reprinting never adds an archive file.
  await page.evaluate(() => { window.print = () => window.dispatchEvent(new Event('afterprint')); });
  await page.locator('#print-photo').click();
  assert.equal((await storage()).photos, saved.photos);
  // Another completed capture is a new photo, even if the same person retakes it.
  await capture();
  assert.equal((await storage()).photos, saved.photos + 1);
  // A real failed network save retains the current portrait for operator retry.
  let blocked = true;
  await page.route('**/api/archive', route => blocked ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Storage write failed in verification.' }) }) : route.continue());
  await capture();
  assert.equal(await page.locator('#finish-session').isEnabled(), false);
  assert.equal(await page.locator('#guest-save-alert').isVisible(), true);
  await page.keyboard.press('Control+Alt+Shift+A');
  await page.locator('[data-admin-tab=storage]').click();
  await page.locator('#admin-retry-archive').waitFor();
  blocked = false;
  await page.locator('#admin-retry-archive').click();
  await page.locator('#admin-feedback').filter({ hasText: 'portrait has been saved' }).waitFor();
  assert.equal((await storage()).photos, saved.photos + 2);
  await page.screenshot({ path: new URL('qa/archive-storage.png', root).pathname });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: new URL('qa/archive-storage-mobile.png', root).pathname });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#admin-close').click();
  assert.equal(await page.locator('#finish-session').isEnabled(), true);
  assert.equal(await page.locator('#guest-save-alert').isVisible(), false);
  // Archive pause persists, leaves existing files, and stops new auto saves.
  await page.keyboard.press('Control+Alt+Shift+A');
  await page.locator('#admin-archive-enabled').uncheck();
  await page.locator('#admin-archive-settings button').click();
  await page.locator('#admin-feedback').filter({ hasText: 'Archive setting saved' }).waitFor();
  await page.locator('#admin-close').click();
  const pausedCount = (await storage()).photos;
  await capture();
  assert.equal((await storage()).photos, pausedCount);
  await boot(base);
  assert.equal((await (await fetch(`${base}/api/bootstrap`)).json()).settings.archiveEnabled, false);
  await page.keyboard.press('Control+Alt+Shift+A');
  await page.locator('[data-admin-tab=storage]').click();
  await page.locator('#admin-archive-enabled').check();
  await page.locator('#admin-archive-settings button').click();
  await page.locator('#admin-feedback').filter({ hasText: 'Archive setting saved' }).waitFor();
  await page.locator('#admin-close').click();
  await boot(`${base}/?sample=woman`);
  await page.waitForFunction(() => document.body.dataset.step === 'result', null, { timeout: 45000 });
  assert.equal((await storage()).photos, pausedCount);
  assert.deepEqual(errors, []);
  console.log('PASS production capture archive, JPEG file, weekly folder, private storage, retry deduplication, reprint/retake policy, failed-save recovery, desktop/mobile Storage, persisted pause, and sample exclusion.');
} finally { await browser.close(); }
