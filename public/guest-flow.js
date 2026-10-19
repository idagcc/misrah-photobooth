const $ = id => document.getElementById(id);

// Guest navigation is separate from the operator's image preparation controls.
export function createGuestFlow({ camera, clear, printImage, hasPhoto }) {
  let step = 'welcome', token = 0, releaseLights, lastActivity = Date.now(), printing = false;
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
    if (!['choose', 'result'].includes(step)) return;
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
  }
  async function reset(destination) {
    token++; stopLights(); $('print-image').removeAttribute('src');
    await clear(destination);
  }
  async function retake() { await reset('choose'); await start(); }
  $('touch-start').addEventListener('click', () => {
    show('choose');
    $('experience-title').textContent = 'Which story will you step into?';
    $('experience-subtitle').textContent = 'Tap a template. Your portrait experience starts right away.';
  });
  $('open-camera').addEventListener('click', start);
  $('new-session').addEventListener('click', retake);
  $('choose-another').addEventListener('click', () => reset('choose'));
  $('finish-session').addEventListener('click', () => reset('welcome'));
  $('cancel-sequence').addEventListener('click', () => camera.close());
  $('retry-camera').addEventListener('click', () => { show('choose'); start(); });
  document.querySelector('.guest-brand').addEventListener('click', event => { event.preventDefault(); reset('welcome'); });
  processingDialog.addEventListener('cancel', event => event.preventDefault());
  $('print-photo').addEventListener('click', async () => {
    if (printing || step !== 'result' || !hasPhoto()) return;
    printing = true; $('print-photo').disabled = true;
    try {
      $('print-image').src = printImage();
      await $('print-image').decode();
      if (step !== 'result') return;
      $('status').textContent = 'Choose your printer and 4 × 6 inch paper in the print window.';
      window.print();
    } catch {
      $('status').textContent = 'The print window could not open. Please try again, or save a copy.';
    } finally {
      printing = false; lastActivity = Date.now();
      if (step === 'result') $('print-photo').disabled = false;
    }
  });
  window.addEventListener('afterprint', () => {
    lastActivity = Date.now();
    if (step === 'result') $('status').textContent = 'Print window closed. You can print again, or finish for the next guest.';
  });
  function activity() { lastActivity = Date.now(); $('idle-notice').hidden = true; }
  for (const name of ['pointerdown', 'keydown']) document.addEventListener(name, activity, { passive: true });
  $('keep-session').addEventListener('click', activity);
  setInterval(() => {
    if (['welcome', 'processing'].includes(step) || printing) return;
    const left = Math.ceil((120000 - (Date.now() - lastActivity)) / 1000);
    if (left <= 0) { reset('welcome'); return; }
    $('idle-seconds').textContent = String(left); $('idle-notice').hidden = left > 20;
  }, 1000);
  show('welcome');
  return { show, start, cancel, processing,
    ready() { $('touch-start').disabled = false; $('welcome-status').textContent = 'Touch the screen to make a memory.'; },
    fail(message) { $('welcome-status').textContent = message; $('touch-start').disabled = true; }
  };
}
