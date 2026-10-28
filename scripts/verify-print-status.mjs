// Exercise the production guest print flow against a mock native bridge.
// The page, module and status handling are real; no hardware print is submitted.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.PHOTOBOOTH_URL || 'http://127.0.0.1:8785';
const root = new URL('../', import.meta.url), out = new URL('qa/v0.13.1/', root);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
const settled = () => page.waitForFunction(() => window.printStatusQA &&
  window.printStatusQA.statusCalls > 0 && window.printStatusQA.statusCompleted === window.printStatusQA.statusCalls);
const refresh = async () => {
  await settled();
  const next = await page.evaluate(() => {
    const next = window.printStatusQA.statusCalls + 1;
    document.dispatchEvent(new Event('booth-settings'));
    return next;
  });
  await page.waitForFunction(next => window.printStatusQA.statusCompleted >= next &&
    window.printStatusQA.statusCompleted === window.printStatusQA.statusCalls, next);
};
const status = () => page.locator('#status').textContent();
const warning = () => page.locator('#guest-print-alert').textContent();
const acceptedPrint = async (doubleClick = false) => {
  await settled();
  const next = await page.evaluate(doubleClick => {
    const qa = window.printStatusQA;
    qa.submission = 'queued'; qa.jobState = 'queued';
    const next = { native: qa.nativeCalls + 1, status: qa.statusCalls + 1 };
    document.getElementById('print-photo').click();
    if (doubleClick) document.getElementById('print-photo').click();
    return next;
  }, doubleClick);
  await page.waitForFunction(next => window.printStatusQA.nativeCalls === next.native &&
    window.printStatusQA.statusCompleted >= next.status && !document.getElementById('print-photo').disabled, next);
};
try {
  const html = (await readFile(new URL('public/index.html', root), 'utf8'))
    .replace('<script type="module" src="app.js"></script>', '');
  await page.route('**/print-status-harness', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`${base}/print-status-harness`);
  await page.evaluate(async () => {
    const { createGuestFlow } = await import('/guest-flow.js');
    const fixture = document.createElement('canvas'); fixture.width = fixture.height = 1;
    fixture.getContext('2d').fillRect(0, 0, 1, 1);
    const qa = window.printStatusQA = {
      nativeCalls: 0, browserCalls: 0, dialogTracks: 0, statusCalls: 0, statusCompleted: 0,
      submission: 'queued', jobState: 'queued', lastAccepted: null, jobs: [], printRequests: [],
      selected: { id: 'DNP', blocked: false, fault: '', state: 'idle' }, error: null, throwStatus: false,
      unexpectedRequests: []
    };
    window.print = () => { qa.browserCalls++; };
    const client = {
      config: { settings: { printMode: 'native', archiveEnabled: false } }, simulated: false,
      track(kind) { if (kind === 'dialog') qa.dialogTracks++; },
      async request(path, value) {
        if (path === 'print') {
          qa.nativeCalls++; qa.printRequests.push(value);
          const outcome = qa.submission;
          await new Promise(resolve => setTimeout(resolve, 15));
          if (outcome === 'timeout') throw new Error('Windows print response timed out. Check the print queue before printing again.');
          if (outcome === 'unknown') return { id: value.id, state: 'unknown', job_id: null,
            message: 'Windows did not confirm this print submission; its status is unknown.' };
          const id = qa.lastAccepted = value.id;
          qa.jobs.push({ id, state: 'queued', job_id: 42 + qa.nativeCalls });
          return { id, state: 'queued', job_id: 42 + qa.nativeCalls };
        }
        if (path === 'status') {
          qa.statusCalls++;
          try {
            await new Promise(resolve => setTimeout(resolve, 10));
            if (qa.throwStatus) throw new Error('The Windows status lookup failed.');
            return { selected: qa.selected, error: qa.error,
              jobs: qa.jobs.map(job => job.id === qa.lastAccepted ? { ...job, state: qa.jobState } : job) };
          } finally { qa.statusCompleted++; }
        }
        qa.unexpectedRequests.push(path); throw new Error(`Unexpected bridge request: ${path}`);
      }
    };
    const flow = createGuestFlow({ client, getTemplate: () => 'misrah-falconer', hasPhoto: () => true,
      printImage: () => fixture.toDataURL('image/jpeg'), camera: { open() {}, close() {} }, clear: async () => {} });
    flow.show('result'); document.getElementById('print-photo').disabled = false;
  });
  await settled();
  await acceptedPrint(true);
  assert.equal(await page.evaluate(() => window.printStatusQA.nativeCalls), 1, 'A double click must submit only once');
  assert.match(await status(), /print queue/);

  await page.evaluate(() => { window.printStatusQA.jobState = 'unlisted'; });
  await refresh();
  const sent = 'Your photo was sent to the printer. Please collect it.';
  assert.equal(await status(), sent);
  assert.equal(await page.locator('#guest-print-alert').isHidden(), true, 'A job leaving the Windows queue is not a print failure');
  await page.screenshot({ path: new URL('accepted-unlisted.png', out).pathname });

  const warnedStates = ['held', 'stopped', 'cancelled', 'aborted', 'unknown'];
  for (const state of warnedStates) {
    await page.evaluate(state => { window.printStatusQA.jobState = state; }, state);
    await refresh();
    assert.equal(await page.locator('#guest-print-alert').isVisible(), true, `${state} must remain visible`);
    assert.match(await warning(), new RegExp(`print job is ${state}`));
  }
  await page.evaluate(() => { window.printStatusQA.jobState = 'completed'; });
  await refresh();
  assert.equal(await page.locator('#guest-print-alert').isHidden(), true, 'An explicitly completed queue job is not a warning');

  await page.evaluate(() => { const qa = window.printStatusQA; qa.jobState = 'unlisted'; qa.selected.blocked = true; qa.selected.fault = 'Paper is empty. Replace the paper and ribbon set.'; });
  await refresh();
  assert.equal(await page.locator('#guest-print-alert').isVisible(), true);
  assert.match(await warning(), /Paper is empty/);
  await page.evaluate(() => { window.printStatusQA.selected = null; });
  await refresh(); assert.match(await warning(), /printer needs attention/);
  await page.evaluate(() => { const qa = window.printStatusQA; qa.selected = { id:'DNP', blocked:false, fault:'', state:'idle' }; qa.error = 'Windows print service is unavailable.'; });
  await refresh();
  assert.equal(await page.locator('#guest-print-alert').isVisible(), true);
  await page.evaluate(() => { const qa = window.printStatusQA; qa.error = null; qa.throwStatus = true; });
  await refresh(); assert.match(await warning(), /Printer status is unavailable/);
  await page.evaluate(() => { window.printStatusQA.throwStatus = false; });
  await refresh(); assert.equal(await status(), sent);
  assert.equal(await page.locator('#guest-print-alert').isHidden(), true);

  // An old accepted job must not turn a later uncertain submission into a success message.
  const uncertainty = [];
  for (const outcome of ['unknown', 'timeout']) {
    if (outcome === 'timeout') {
      await acceptedPrint();
      await page.evaluate(() => { window.printStatusQA.jobState = 'unlisted'; });
      await refresh(); assert.equal(await status(), sent);
    }
    const expectedCalls = await page.evaluate(outcome => {
      const qa = window.printStatusQA; qa.submission = outcome;
      const next = qa.nativeCalls + 1; document.getElementById('print-photo').click(); return next;
    }, outcome);
    await page.waitForFunction(expected => window.printStatusQA.nativeCalls === expected && !document.getElementById('print-photo').disabled, expectedCalls);
    const uncertain = await status();
    assert.match(uncertain, outcome === 'unknown' ? /unknown/ : /timed out/);
    assert.match(uncertain, /attendant/);
    await refresh(); await refresh();
    assert.equal(await status(), uncertain, `${outcome}: an old unlisted job must not replace submission uncertainty`);
    assert.equal(await page.evaluate(() => window.printStatusQA.nativeCalls), expectedCalls, 'Status refresh must never resubmit');
    uncertainty.push({ outcome, messagePreserved: true });
  }
  const calls = await page.evaluate(() => ({ native: window.printStatusQA.nativeCalls, browser: window.printStatusQA.browserCalls,
    dialogs: window.printStatusQA.dialogTracks, uniqueRequests: new Set(window.printStatusQA.printRequests.map(r => r.id)).size,
    unexpected: window.printStatusQA.unexpectedRequests }));
  assert.deepEqual(calls, { native: 4, browser: 0, dialogs: 0, uniqueRequests: 4, unexpected: [] });
  assert.equal(await page.locator('#print-image').getAttribute('src'), null, 'Native errors must not open the browser print route');
  assert.deepEqual(errors, []);
  await writeFile(new URL('print-status-verification.json', out), JSON.stringify({ acceptedThenUnlisted: true,
    explicitCompleted: true, warnedStates, printerFaultsPreserved: true, uncertainty, calls, errors }, null, 2));
  console.log('PASS accepted queue removal is neutral; completed/error states and printer faults are preserved; old jobs cannot mask later unknown/timeouts; no duplicate submission or browser fallback.');
} catch (error) {
  console.error(await page.evaluate(() => ({ status: document.getElementById('status')?.textContent,
    warning: document.getElementById('guest-print-alert')?.textContent, qa: window.printStatusQA })), errors);
  throw error;
} finally { await browser.close(); }
