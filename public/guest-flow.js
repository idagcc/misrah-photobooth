const $ = id => document.getElementById(id);

// Guest navigation is separate from the operator's image preparation controls.
export function createGuestFlow({ camera, clear, printImage, hasPhoto, client, getTemplate }) {
  let step = 'welcome', token = 0, releaseLights, lastActivity = Date.now(), printing = false, activePrintId = null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const video = $('lights-video'), processingVideo = $('processing-video');
  const processingDialog = $('processing-dialog');
  const sample = new URLSearchParams(location.search).get('camera') === 'sample';
  function stopLights() { releaseLights?.(); releaseLights = null; video.pause(); }
  function show(next) {
    step = next; document.body.dataset.step = next; lastActivity = Date.now();
    $('welcome-step').hidden = next !== 'welcome';
    document.querySelector('.guest-main').hidden = next === 'welcome';
    $('choose-step').hidden = next === 'result'; $('result-step').hidden = next !== 'result';
    $('lights-overlay').hidden = next !== 'lights';
    $('idle-notice').hidden = true;
    (['camera', 'lights'].includes(next) ? $('camera-dialog') : document.body).append($('idle-notice'));
    for (const child of $('camera-dialog').children) child.inert = next === 'lights' && !['lights-overlay', 'idle-notice'].includes(child.id);
    if (next !== 'processing') {
      if (processingDialog.open) processingDialog.close();
      processingVideo.pause();
    }
    const current = next === 'result' ? 'result' : ['lights', 'camera', 'processing'].includes(next) ? 'camera' : 'choose';
    for (const item of document.querySelectorAll('[data-progress]')) {
      if (next !== 'welcome' && item.dataset.progress === current) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
    if (next === 'result' || next === 'choose') $('experience-title').focus({ preventScroll: true });
    if (next === 'welcome') $('touch-start').focus({ preventScroll: true });
    if (next === 'camera') $('close-camera').focus({ preventScroll: true });
    $('guest-print-alert').hidden = true;
    archiveState();
    if (next === 'result') refreshPrinter();
  }
  function waitForLights() {
    stopLights();
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); video.removeEventListener('ended', finish); releaseLights = null; resolve(); };
      const timer = setTimeout(finish, reducedMotion ? 1000 : 4500);
      releaseLights = finish;
      video.addEventListener('ended', finish, { once: true });
      video.currentTime = 0;
      if (!reducedMotion) video.play().catch(() => {});
    });
  }
  async function start() {
    if (!['choose', 'result'].includes(step) || $('admin-dialog')?.open || archiveBlocked()) return;
    const run = ++token;
    show('lights');
    // Acquire the camera during the video, but gate the shutter until it ends.
    await Promise.all([waitForLights(), camera.open({ sample })]);
    if (run !== token) return;
    stopLights(); show('camera');
  }
  function cancel() {
    if (!['lights', 'camera'].includes(step)) return;
    token++; stopLights(); show('choose');
  }
  function processing() {
    stopLights();
    if (!processingDialog.open) processingDialog.showModal();
    if (!reducedMotion) processingVideo.play().catch(() => {});
    $('processing-title').focus();
    const countdown = $('processing-countdown'), started = performance.now();
    processingDialog.dataset.preparing = 'true';
    countdown.textContent = '3';
    return new Promise(resolve => {
      const tick = () => {
        const remaining = 3000 - (performance.now() - started);
        countdown.textContent = String(Math.max(0, Math.ceil(remaining / 1000)));
        if (remaining > 0) { setTimeout(tick, Math.min(remaining, 100)); return; }
        processingDialog.dataset.preparing = 'false';
        $('processing-caption').textContent = 'Adding the finishing touches…';
        resolve();
      };
      $('processing-caption').textContent = 'A timeless keepsake, made just for you.';
      setTimeout(tick, 100);
    });
  }
  async function reset(destination) {
    if (archiveBlocked()) { archiveState(); return false; }
    token++; stopLights(); activePrintId = null; $('print-image').removeAttribute('src');
    await clear(destination);
    return true;
  }
  async function retake() { if (await reset('choose')) await start(); }
  $('touch-start').addEventListener('click', () => {
    show('choose');
    $('experience-title').textContent = 'Choose your portrait.';
    $('experience-subtitle').textContent = 'Tap a portrait to begin. Then look straight at the camera.';
  });
  $('open-camera').addEventListener('click', start);
  $('new-session').addEventListener('click', retake);
  $('choose-another').addEventListener('click', () => reset('choose'));
  $('finish-session').addEventListener('click', () => reset('welcome'));
  $('cancel-sequence').addEventListener('click', () => camera.close());
  $('retry-camera').addEventListener('click', () => { show('choose'); start(); });
  document.querySelector('.guest-brand').addEventListener('click', event => { event.preventDefault(); if (!printing) reset('welcome'); });
  processingDialog.addEventListener('cancel', event => event.preventDefault());
  $('print-photo').addEventListener('click', async () => {
    if (printing || step !== 'result' || !hasPhoto()) return;
    printing = true; $('print-photo').disabled = true;
    document.body.dataset.printing = 'true';
    const navigation = ['new-session', 'choose-another', 'finish-session'];
    for (const id of navigation) $(id).disabled = true;
    try {
      if (client.config.settings.printMode === 'native' && !client.simulated) {
        activePrintId = null;
        $('status').textContent = 'Sending your photo to the printer…';
        const result = await client.request('print', { id: crypto.randomUUID(), template: getTemplate(), image: printImage() }, 30000);
        if (result.state === 'failed' || result.state === 'unknown') throw new Error(result.message || 'Please ask an attendant to check the printer.');
        activePrintId = result.id;
        $('status').textContent = `Your photo is in the print queue. Please collect it from the printer.`;
        refreshPrinter();
        return;
      }
      $('print-image').src = printImage();
      await $('print-image').decode();
      if (step !== 'result') return;
      $('status').textContent = 'Choose your printer and 4 × 6 inch paper in the print window.';
      client.track('dialog', getTemplate());
      window.print();
    } catch (error) {
      $('status').textContent = `${error.message} Ask an attendant for help before trying again.`;
    } finally {
      printing = false; lastActivity = Date.now();
      document.body.dataset.printing = 'false';
      archiveState();
      if (step === 'result') $('print-photo').disabled = false;
    }
  });
  window.addEventListener('afterprint', () => {
    lastActivity = Date.now();
    if (step === 'result') $('status').textContent = 'Print window closed. You can print again, or finish for the next guest.';
  });
  function activity() { lastActivity = Date.now(); $('idle-notice').hidden = true; }
  function archiveBlocked() { return Boolean(client.pendingArchive && client.config?.settings.archiveEnabled); }
  function archiveState() {
    const blocked = archiveBlocked();
    for (const id of ['new-session', 'choose-another', 'finish-session']) $(id).disabled = printing || blocked;
    if ($('guest-save-alert')) {
      $('guest-save-alert').hidden = !blocked;
      $('guest-save-alert').textContent = 'Your photo could not be saved. Please ask an attendant before leaving.';
    }
    document.querySelector('.guest-privacy').textContent = client.simulated ? 'Sample mode · photos are not archived.' : client.config?.settings.archiveEnabled ? 'Finished portraits are saved on this Mac.' : 'Your photo stays on this device.';
    if (!blocked && step === 'result' && $('status').textContent.startsWith('Your photo needs attention')) $('status').textContent = '';
  }
  document.addEventListener('booth-archive-state', () => { activity(); archiveState(); });
  document.addEventListener('booth-settings', archiveState);
  for (const name of ['pointerdown', 'keydown']) document.addEventListener(name, activity, { passive: true });
  $('keep-session').addEventListener('click', activity);
  document.addEventListener('booth-admin-closed', activity);
  let checkingPrinter = false;
  async function refreshPrinter() {
    const native = client.config?.settings.printMode === 'native' && !client.simulated;
    document.querySelector('.print-note').textContent = native ? '4 × 6 inch photo · Sent to the booth printer.' : '4 × 6 inch photo · Choose your printer in the print window.';
    if (step !== 'result' || !native || checkingPrinter || $('admin-dialog')?.open) return;
    checkingPrinter = true;
    try {
      const value = await client.request('status');
      if (step !== 'result') return;
      const p = value.selected;
      const job = value.jobs?.find(item => item.id === activePrintId);
      const jobIssue = job && ['aborted', 'cancelled', 'stopped', 'held', 'unknown'].includes(job.state);
      if (job?.state === 'unlisted' && p && !p.blocked && !value.error) {
        $('status').textContent = 'Your photo was sent to the printer. Please collect it.';
      }
      $('guest-print-alert').hidden = !value.error && p && !p.blocked && !jobIssue;
      $('guest-print-alert').textContent = p?.fault || (jobIssue ? `Your print job is ${job.state}. Please ask an attendant before printing again.` : !p || value.error ? 'The printer needs attention. Please ask an attendant.' : '');
    } catch { if (step === 'result') { $('guest-print-alert').textContent = 'Printer status is unavailable. Please ask an attendant.'; $('guest-print-alert').hidden = false; } }
    finally { checkingPrinter = false; }
  }
  document.addEventListener('booth-settings', refreshPrinter);
  setInterval(refreshPrinter, 5000);
  setInterval(() => {
    if (['welcome', 'processing'].includes(step) || printing || $('admin-dialog')?.open || archiveBlocked()) return;
    const left = Math.ceil((120000 - (Date.now() - lastActivity)) / 1000);
    if (left <= 0) { reset('welcome'); return; }
    $('idle-seconds').textContent = String(left); $('idle-notice').hidden = left > 20;
  }, 1000);
  show('welcome');
  return { show, start, cancel, processing,
    ready() { archiveState(); $('touch-start').disabled = false; $('welcome-status').textContent = 'Touch the screen to make a memory.'; },
    fail(message) { $('welcome-status').textContent = message; $('touch-start').disabled = true; }
  };
}
