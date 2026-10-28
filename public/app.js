import { clamp, FACE_OVAL, faceGeometry, manualGeometry, targetForOpening, alignment, findTransparentOpening } from './geometry.js';
import { correctionFor } from './live-quality.js';
import { LiveCamera } from './live-camera.js';
import { createGuestFlow } from './guest-flow.js';
import { BoothClient } from './booth-client.js';
import { createAdminPanel } from './admin-panel.js';
import { brandReady, brandedPortrait } from './print-branding.js';
import { APPROVED_PORTRAITS, prepareApprovedPortrait } from './approved-portraits.js';
import { applyPhotoGrain } from './photo-grain.js';

const $ = id => document.getElementById(id);
const guestExperience = document.body.dataset.experience === 'guest';
let guestFlow;
const booth = guestExperience ? new BoothClient() : null;
let initialized = false;
const portrait = $('portrait'), ctx = portrait.getContext('2d');
let brandLogo;
const brandingReady = brandReady.then(logo => { brandLogo = logo; });
brandingReady.catch(() => {});
function finishedPortrait() {
  if (!brandLogo) throw new Error('The Misrah logo is not ready. Refresh before printing.');
  return brandedPortrait(portrait, brandLogo, $('branded-portrait') || undefined);
}
const sourceCanvas = $('source-canvas'), sourceCtx = sourceCanvas.getContext('2d');
const defaults = { scale: 100, x: 0, y: 0, rotation: 0, warmth: 30, brightness: 100, softness: 2, flip: false };
const state = { settings: { ...defaults }, source: null, faces: [], selected: 0, frame: null,
  view: 'result', generation: 0, toneGeneration: 0, rawSource: null, qualities: [], poses: [], landmarks: [] };
// Opt-in while evaluating the still-photo experiment; ordinary booth links keep the committed capture flow.
if (new URLSearchParams(location.search).get('pose') === 'correct') $('pose-correction').checked = true;
const makeCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const imageFromURL = url => new Promise((resolve, reject) => {
  const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('This image could not be opened. Use a PNG, JPEG, or WebP photo.')); image.src = url;
});
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function busy(on, label = 'Finding your face…') { $('busy').hidden = !on; $('busy-label').textContent = label; }
function modelStatus(message, mode = 'ready') { $('model-status').textContent = message; $('model-dot').className = `small-dot ${mode}`; }
function controlsEnabled(on) { $('face-controls').disabled = !on; $('download').disabled = !on; if (guestExperience) $('print-photo').disabled = !on; $('stage-empty').hidden = on; }
function guestStep(step) {
  if (!guestExperience) return;
  guestFlow?.show(step);
  document.body.dataset.step = step;
  $('choose-step').hidden = step === 'result'; $('result-step').hidden = step !== 'result';
  $('experience-title').textContent = step === 'result' ? 'Your portrait is ready.' : 'Choose your portrait.';
  $('experience-subtitle').textContent = step === 'result' ? 'Print a keepsake, or take another photo.' : 'Tap a portrait to begin. Then look straight at the camera.';
  const sample = step === 'result' && /^(AI TEST|SIMULATED|SAMPLE)/.test($('source-tag').textContent);
  $('sample-disclosure').hidden = !sample;
  $('photo-context').textContent = step === 'result' ? (sample ? 'SAMPLE PORTRAIT' : 'YOUR FINISHED PORTRAIT') : 'SCENE PREVIEW';
  portrait.setAttribute('aria-label', step === 'result' ? 'Your finished heritage portrait' : 'Selected heritage scene');
}
let worker, engineFailed = false, nextJob = 0;
const jobs = new Map();
let acceptReady, rejectReady;
const ready = new Promise((resolve, reject) => { acceptReady = resolve; rejectReady = reject; });
// Attach the failure handler before the worker can report a startup failure.
ready.catch(() => {});
const startupTimer = setTimeout(() => rejectReady(new Error('The local detector took too long to start. Refresh to retry; manual positioning is available.')), 45000);
try {
  worker = new Worker('./detector-worker.js');
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') { clearTimeout(startupTimer); acceptReady(); return; }
    if (data.type === 'init-error') { clearTimeout(startupTimer); rejectReady(new Error(data.error)); return; }
    const job = jobs.get(data.id); if (!job) { data.corrected?.close(); return; }
    clearTimeout(job.timer); jobs.delete(data.id);
    data.type === 'result' ? job.resolve(data) : job.reject(new Error(data.error));
  };
  worker.onerror = event => {
    clearTimeout(startupTimer); rejectReady(new Error(event.message || 'Face detection is unavailable.'));
    for (const job of jobs.values()) { clearTimeout(job.timer); job.reject(new Error('The detector stopped. Refresh to retry.')); }
    jobs.clear(); engineFailed = true;
  };
} catch (error) { clearTimeout(startupTimer); rejectReady(error); }

async function requestWorker(data, bitmap) {
  try { await ready; } catch (error) { bitmap.close(); throw error; }
  if (engineFailed) { bitmap.close(); throw new Error('The detector is unavailable.'); }
  return new Promise((resolve, reject) => {
    const id = ++nextJob;
    const timer = setTimeout(() => { jobs.delete(id); reject(new Error('Detection timed out. Use manual positioning or refresh to retry.')); }, 20000);
    jobs.set(id, { resolve, reject, timer });
    worker.postMessage({ ...data, id, bitmap }, [bitmap]);
  });
}
async function detect(image, options = {}) {
  const factor = Math.min(1, (options.live ? 640 : 1280) / Math.max(image.width, image.height));
  const bitmap = await createImageBitmap(image, { resizeWidth: Math.max(1, Math.round(image.width * factor)), resizeHeight: Math.max(1, Math.round(image.height * factor)) });
  return requestWorker({ type: 'detect', ...options }, bitmap);
}

let builtIn, reference;
const clientFrames = new Map();
const testGuests = new Map();
let sceneDefinitions = [
  ...Object.entries(APPROVED_PORTRAITS).map(([id, item]) => ({ id, src: item.src, name: item.name, approved: true })),
  { id: 'misrah-1', src: 'assets/misrah-1.png', name: 'The pearl trader' },
  { id: 'misrah-2', src: 'assets/misrah-2.png', name: 'The weaver' },
  { id: 'misrah-3', src: 'assets/misrah-3.png', name: 'The woven arch' }
].filter(item => !guestExperience || item.approved);
const guestDefinitions = [
  { id: 'frontal-guest-woman', name: 'Woman' },
  { id: 'frontal-guest-man', name: 'Man' },
  { id: 'frontal-guest-bearded', name: 'Bearded man' }
];
async function makeBuiltIn() {
  const [image, demo] = await Promise.all([imageFromURL('./assets/heritage-frame.png'), imageFromURL('./assets/demo-portrait.png')]);
  reference = demo;
  const w = image.width, h = image.height, layer = makeCanvas(w, h), lctx = layer.getContext('2d', { willReadFrequently: true });
  lctx.drawImage(image, 0, 0);
  const pixels = lctx.getImageData(0, 0, w, h), matte = makeCanvas(w, h), maskctx = matte.getContext('2d');
  const maskPixels = maskctx.createImageData(w, h);
  let left = w, top = h, right = 0, bottom = 0;
  // The supplied artwork marks the opening blue. Restrict chroma removal to its
  // face region so similarly coloured details elsewhere remain intact.
  for (let y = Math.floor(h * .25); y < h * .48; y++) for (let x = Math.floor(w * .43); x < w * .62; x++) {
    const i = (y * w + x) * 4, [r, g, b] = pixels.data.slice(i, i + 3);
    if (b - r > 2 && g - r > 2 && b > 35) {
      maskPixels.data[i] = maskPixels.data[i + 1] = maskPixels.data[i + 2] = maskPixels.data[i + 3] = 255;
      left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
    }
  }
  if (right <= left) throw new Error('The heritage frame opening could not be prepared.');
  maskctx.putImageData(maskPixels, 0, 0);
  lctx.globalCompositeOperation = 'destination-out'; lctx.drawImage(matte, 0, 0); lctx.globalCompositeOperation = 'source-over';
  const bounds = { left, top, right, bottom };
  const target = { anchor: { x: w * .521, y: h * .329 }, eyeDistance: w * .053, angle: .1, width: right - left, height: bottom - top };
  builtIn = { image, preview: demo, layer, mask: matte, bounds, target, name: 'The artisan', custom: false };
  state.frame = builtIn; setCanvasSize(); render();
}

const templateReady = Promise.all([brandingReady, guestExperience ? Promise.resolve() : makeBuiltIn()]).catch(error => { status(error.message, true); throw error; });
templateReady.catch(() => {});
const engineReady = (async () => {
  try {
    await Promise.all([ready, templateReady]);
    if (guestExperience) { await booth.ready; await syncGuestLibrary(); $('live-rate').value = String(booth.config.settings.rate); }
    const calibration = !guestExperience ? await detect(reference) : null;
    if (calibration?.landmarks.length) {
      builtIn.target = faceGeometry(calibration.landmarks[0], reference.width, reference.height);
      builtIn.quality = calibration.qualities[0];
      builtIn.sample = makeCalibrationSample(reference, builtIn.target.bounds);
      const normalized = await detect(builtIn.sample); builtIn.pose = normalized.poses[0];
    }
    await prepareClientScenes();
    if (!guestExperience || /(?:[?&](?:sample|camera)=)/.test(location.search)) await prepareTestGuests();
    initialized = true;
    modelStatus('Offline face detector ready · Photos stay on this device');
    if (guestExperience) { $('open-camera').disabled = false; for (const card of $('scene-list').children) card.disabled = false; guestFlow?.ready(); status(''); }
    render();
  } catch (error) {
    engineFailed = true;
    modelStatus('Automatic detection unavailable · Manual positioning works', 'failed');
    status(guestExperience ? 'The photo booth could not start. Please refresh and try again.' : 'The local face detector could not start. You can still upload a photo and position it manually. Refresh to retry.', true);
    if (guestExperience) guestFlow?.fail('The photo booth could not start. Please ask an attendant to refresh it.');
  }
})();

async function prepareClientScenes() {
  let prepared = 0;
  // Keep at most a few decoded full-size scenes; the library uses small thumbnails.
  for (const definition of (guestExperience ? sceneDefinitions.slice(0, 3) : sceneDefinitions)) {
    try {
      await prepareScene(definition); $(definition.id).disabled = false; prepared++;
    } catch { $(definition.id).title = 'This portrait could not be prepared. Ask an attendant.'; }
  }
  $('template-status').textContent = `${prepared} portraits ready.`;
  if (guestExperience && !prepared) throw new Error('No frontal portrait could be prepared.');
  if (prepared && !state.source && (!state.frame || state.frame === builtIn)) {
    const id = sceneDefinitions.find(item => clientFrames.has(item.id)).id;
    selectScene(clientFrames.get(id), id);
  }
}

async function prepareScene(definition) {
  if (clientFrames.has(definition.id)) {
    const cached = clientFrames.get(definition.id); clientFrames.delete(definition.id); clientFrames.set(definition.id, cached); return cached;
  }
  const image = await imageFromURL(definition.src);
  const approved = prepareApprovedPortrait(definition, image, makeCanvas);
  if (approved) {
    clientFrames.set(definition.id, approved);
    if (guestExperience) trimFrameCache(definition.id);
    return approved;
  }
  const result = await detect(image);
  if (result.landmarks.length !== 1) throw new Error('The portrait must contain exactly one clear face.');
  const points = result.landmarks[0], w = image.width, h = image.height;
  const mask = makeCanvas(w, h), mctx = mask.getContext('2d'); mctx.fillStyle = 'white'; mctx.beginPath();
  FACE_OVAL.forEach((index, j) => { const p = points[index]; j ? mctx.lineTo(p.x * w, p.y * h) : mctx.moveTo(p.x * w, p.y * h); });
  mctx.closePath(); mctx.fill();
  const layer = makeCanvas(w, h), lctx = layer.getContext('2d'); lctx.drawImage(image, 0, 0);
  lctx.globalCompositeOperation = 'destination-out'; lctx.drawImage(mask, 0, 0);
  const target = faceGeometry(points, w, h);
  const sample = makeCalibrationSample(image, target.bounds), normalized = await detect(sample);
  const pose = normalized.poses[0] || result.poses[0];
  if (guestExperience && (!pose || Math.abs(pose.yaw) > 15 || Math.abs(pose.pitch) > 18 || Math.abs(target.angle * 180 / Math.PI) > 12)) throw new Error('Use a straight-facing portrait with level eyes and a neutral head angle.');
  const frame = { id: definition.id, image, layer, mask, bounds: { ...target.bounds }, target, sample,
    pose, quality: { ...result.qualities[0], styleStrength: guestExperience || definition.generated ? .35 : .85 }, name: definition.name, generated: Boolean(definition.generated), custom: false };
  clientFrames.set(definition.id, frame);
  if (guestExperience) trimFrameCache(definition.id);
  return frame;
}

function trimFrameCache(preparedId) {
  while (clientFrames.size > 3) {
    const key = [...clientFrames.keys()].find(id => id !== state.frame?.id && id !== preparedId);
    if (!key) break;
    clientFrames.delete(key);
  }
}

async function syncGuestLibrary() {
  if (!guestExperience) return;
  sceneDefinitions = booth.config.templates.filter(item => item.active).map(item => ({ ...item, generated: true }));
  $('scene-list').replaceChildren(...sceneDefinitions.map((item, index) => {
    const button = document.createElement('button'); button.id = item.id; button.className = 'frame-card'; button.disabled = !initialized;
    const image = new Image(); image.loading = index < 4 ? 'eager' : 'lazy'; image.src = item.thumbnail || item.src; image.alt = ''; image.decoding = 'async';
    const caption = document.createElement('span'), title = document.createElement('strong'), note = document.createElement('small');
    title.textContent = item.name; note.textContent = 'Tap to take your photo'; caption.append(title, note);
    const check = document.createElement('span'); check.className = 'check'; check.textContent = '✓'; check.hidden = item.id !== state.frame?.id;
    button.setAttribute('aria-pressed', String(item.id === state.frame?.id)); button.classList.toggle('selected', item.id === state.frame?.id);
    button.append(image, caption, check); return button;
  }));
  await Promise.all([...$('scene-list').querySelectorAll('img')].slice(0, 4).map(image => image.decode().catch(() => {})));
  if (initialized && !sceneDefinitions.some(item => item.id === state.frame?.id)) {
    if (state.source) await resetSession('choose');
    const definition = sceneDefinitions[0]; selectScene(await prepareScene(definition), definition.id);
  }
}

async function prepareTestGuests() {
  for (const definition of guestDefinitions) {
    try {
      const image = await imageFromURL(`./assets/frontal/${definition.id}.png`), detected = await detect(image);
      if (detected.landmarks.length !== 1) throw new Error('Expected one face');
      const geometry = faceGeometry(detected.landmarks[0], image.width, image.height);
      const sample = makeCalibrationSample(image, geometry.bounds), normalized = await detect(sample);
      const pose = normalized.poses[0];
      testGuests.set(definition.id, { image, sample, pose, name: definition.name });
      $(definition.id).disabled = false;
      $(definition.id).title = `AI-generated test person · Estimated turn ${Math.round(pose.yaw)}°, eye tilt ${(geometry.angle * 180 / Math.PI).toFixed(1)}°`;
    } catch (error) { $(definition.id).title = 'Test face unavailable. Refresh to retry.'; }
  }
  $('guest-status').textContent = `${testGuests.size} straight-on AI test faces ready`;
}

for (const definition of guestDefinitions) $(definition.id).addEventListener('click', async () => {
  const guest = testGuests.get(definition.id); if (!guest) return;
  $('sample-person').value = definition.id;
  for (const item of guestDefinitions) $(item.id).setAttribute('aria-pressed', String(item.id === definition.id));
  await setSource(guest.image, `AI TEST · ${guest.name.toUpperCase()} · STRAIGHT ON`);
});

function poseInfo() {
  const pose = state.poses[state.selected], face = state.faces[state.selected], target = state.frame?.pose;
  $('pose-info').hidden = !pose || !target || !face;
  if (pose && target && face) $('pose-info').textContent = `Estimated head turn: photo ${Math.round(pose.yaw)}° / scene ${Math.round(target.yaw)}° · Eye tilt: photo ${(face.angle * 180 / Math.PI).toFixed(1)}° / scene ${(state.frame.target.angle * 180 / Math.PI).toFixed(1)}°`;
}

function makeCalibrationSample(image, b) {
  const out = makeCanvas(640, 480), c = out.getContext('2d'); c.fillStyle = '#ddd9ca'; c.fillRect(0, 0, 640, 480);
  const bw = b.right - b.left, bh = b.bottom - b.top, cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
  const scale = Math.min(230 / bw, 290 / bh), sx = Math.max(0, b.left - bw * .2), sy = Math.max(0, b.top - bh * .22);
  const sw = Math.min(image.width - sx, bw * 1.4), sh = Math.min(image.height - sy, bh * 1.44);
  c.drawImage(image, sx, sy, sw, sh, 320 + (sx - cx) * scale, 225 + (sy - cy) * scale, sw * scale, sh * scale);
  return out;
}

function selectScene(frame, id) {
  state.frame = frame; $('custom-tools').hidden = true; $('edit-opening').checked = false;
  state.settings.warmth = frame.quality?.styleStrength ? 0 : 30;
  state.settings.softness = frame.quality?.styleStrength ? 6 : 2;
  for (const button of $('scene-list').querySelectorAll('.frame-card')) {
    button.classList.toggle('selected', button.id === id); button.querySelector('.check').hidden = button.id !== id;
    button.setAttribute('aria-pressed', String(button.id === id));
  }
  if (guestExperience) $('photo-caption').textContent = $(id)?.querySelector('strong')?.textContent || frame.name;
  setCanvasSize(); resetFit(); applyAutoTone(); poseInfo();
}
for (const definition of sceneDefinitions) if (!guestExperience) $(definition.id).addEventListener('click', () => {
  const frame = clientFrames.get(definition.id); if (frame) { selectScene(frame, definition.id); status(guestExperience ? '' : `${frame.name} selected. ${definition.generated ? 'AI-generated frontal test scene.' : 'Original client design.'} Live guidance uses this scene’s head angle.`); if (guestExperience) guestFlow?.start(); }
});
if (guestExperience) $('scene-list').addEventListener('click', async event => {
  const button = event.target.closest('.frame-card');
  if (!button || button.disabled || document.body.dataset.step !== 'choose') return;
  const definition = sceneDefinitions.find(item => item.id === button.id); if (!definition) return;
  for (const card of $('scene-list').children) card.disabled = true;
  try {
    status('Preparing your portrait…');
    const frame = await prepareScene(definition);
    if ($('admin-dialog')?.open || document.body.dataset.step !== 'choose' || !sceneDefinitions.some(item => item.id === definition.id)) return;
    selectScene(frame, definition.id); status('');
    booth.track('selection', definition.id); guestFlow?.start();
  } catch (error) { status(error.message, true); }
  finally { for (const card of $('scene-list').children) card.disabled = false; }
});

async function applyAutoTone() {
  const token = ++state.toneGeneration, generation = state.generation;
  if (!state.rawSource) return;
  state.source = state.rawSource;
  state.faces = state.landmarks.map(points => faceGeometry(points, state.rawSource.width, state.rawSource.height));
  const q = state.qualities[state.selected];
  if (!$('auto-tone').checked || !q || engineFailed) {
    $('tone-info').textContent = $('auto-tone').checked ? 'Automatic tone needs a detected face.' : 'Original colour retained. Manual controls remain available.';
    await applyPoseCorrection(token, generation); updateSourcePreview(); render(); return;
  }
  try {
    $('download').disabled = true;
    const correction = correctionFor(q, state.frame.quality);
    const bitmap = await createImageBitmap(state.rawSource);
    const result = await requestWorker({ type: 'correct', correction }, bitmap);
    try {
      if (token !== state.toneGeneration || generation !== state.generation) return;
      const corrected = makeCanvas(result.corrected.width, result.corrected.height);
      corrected.getContext('2d').drawImage(result.corrected, 0, 0); state.source = corrected;
      $('tone-info').textContent = `Auto tone applied · Exposure ${Math.round(correction.exposure * 100)}% · Gentle white balance`;
      await applyPoseCorrection(token, generation);
      if (token !== state.toneGeneration || generation !== state.generation) return;
      updateSourcePreview(); render();
    } finally { result.corrected.close(); }
  } catch (error) { if (token === state.toneGeneration) $('tone-info').textContent = 'Automatic tone unavailable. Manual adjustments still work.'; }
  finally { if (token === state.toneGeneration && generation === state.generation) $('download').disabled = false; }
}
$('auto-tone').addEventListener('change', applyAutoTone);
$('pose-correction').addEventListener('change', applyAutoTone);
async function applyPoseCorrection(token, generation) {
  const label = $('pose-correction-info');
  if (!$('pose-correction').checked || !state.landmarks[state.selected] || !state.frame?.pose || engineFailed) {
    if (label) label.textContent = 'Try a gentle correction after capture. Original capture is retained.';
    return;
  }
  try {
    const result = await requestWorker({ type: 'pose-correct', landmarks: state.landmarks[state.selected],
      pose: state.poses[state.selected], targetPose: state.frame.pose }, await createImageBitmap(state.source));
    try {
      if (token !== state.toneGeneration || generation !== state.generation) return;
      if (result.poseCorrection.applied) {
        const corrected = makeCanvas(result.corrected.width, result.corrected.height);
        corrected.getContext('2d').drawImage(result.corrected, 0, 0); state.source = corrected;
        state.faces[state.selected] = faceGeometry(result.landmarks, corrected.width, corrected.height);
      }
      if (label) label.textContent = result.poseCorrection.applied ? `Small head turn and tilt adjusted after capture · ${Math.round(result.poseCorrection.elapsed)} ms` :
        result.poseCorrection.reason === 'already-aligned' ? 'Face already aligned. Original pixels retained.' : 'Original retained. A straighter capture will give a better result.';
    } finally { result.corrected.close(); }
  } catch { if (label && token === state.toneGeneration) label.textContent = 'Correction unavailable. Original capture retained.'; }
}

function setCanvasSize() {
  portrait.width = state.frame.image.width; portrait.height = state.frame.image.height;
  $('dimensions').textContent = `${portrait.width} × ${portrait.height} px`;
  // Position sliders are measured in original image pixels.
  for (const id of ['x', 'y']) { $(id).min = -Math.round(Math.max(portrait.width, portrait.height) * .3); $(id).max = -Number($(id).min); }
}
const faceLayer = makeCanvas(1, 1), softenedMask = makeCanvas(1, 1), overlayLayer = makeCanvas(1, 1);
let maskCache = '';
function render() {
  if (!state.frame) return;
  const { frame, source, settings } = state, w = portrait.width, h = portrait.height;
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#f3eddf'; ctx.fillRect(0, 0, w, h);
  // Show the complete photograph while the guest chooses a scene.
  if (guestExperience && !source) { ctx.drawImage(frame.preview || frame.image, 0, 0, w, h); return; }
  ctx.drawImage(frame.layer, 0, 0);
  if (source && state.view === 'result') {
    const geometry = state.faces[state.selected] || manualGeometry(source.width, source.height);
    const transform = alignment(geometry, frame.target, settings);
    if (faceLayer.width !== w || faceLayer.height !== h) { faceLayer.width = w; faceLayer.height = h; }
    const fctx = faceLayer.getContext('2d'); fctx.clearRect(0, 0, w, h);
    fctx.save(); fctx.translate(transform.x, transform.y); fctx.rotate(transform.angle);
    fctx.scale(transform.scale * (settings.flip ? -1 : 1), transform.scale);
    fctx.translate(-geometry.anchor.x, -geometry.anchor.y);
    fctx.filter = `sepia(${settings.warmth * .6}%) saturate(${100 - settings.warmth * .25}%) brightness(${settings.brightness}%)`;
    fctx.drawImage(source, 0, 0); fctx.restore();
    const cacheKey = `${frame.name}:${w}:${h}:${settings.softness}:${frame.revision || 0}`;
    if (cacheKey !== maskCache) {
      softenedMask.width = w; softenedMask.height = h;
      const mctx = softenedMask.getContext('2d');
      // Keep the opening fully opaque in the matte, and feather outward into
      // the surrounding trim. Blurring inward would leave the blue key visible.
      // Approved apertures are exact: broad feathering would erase the gold face plate.
      mctx.shadowColor = 'white'; mctx.shadowBlur = frame.approved ? 0 : settings.softness * 2;
      mctx.drawImage(frame.mask, 0, 0);
      overlayLayer.width = w; overlayLayer.height = h;
      const octx = overlayLayer.getContext('2d'); octx.drawImage(frame.image, 0, 0);
      octx.globalCompositeOperation = 'destination-out'; octx.drawImage(softenedMask, 0, 0);
      maskCache = cacheKey;
    }
    // A generously padded coverage rectangle makes the face opaque underneath
    // the feathered frame. The frame alpha defines the final visible contour.
    const b = frame.bounds, pad = settings.softness * 8 + 5;
    fctx.globalCompositeOperation = 'destination-in'; fctx.fillStyle = 'white';
    fctx.fillRect(b.left - pad, b.top - pad, b.right - b.left + pad * 2, b.bottom - b.top + pad * 2);
    fctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(faceLayer, 0, 0); ctx.drawImage(overlayLayer, 0, 0);
  } else {
    ctx.save(); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#514c40'; ctx.fillRect(0, 0, w, h); ctx.restore();
    // Fill only the face opening with a warm neutral placeholder.
    const placeholder = makeCanvas(w, h), pctx = placeholder.getContext('2d');
    pctx.fillStyle = '#6b705d'; pctx.fillRect(0, 0, w, h); pctx.globalCompositeOperation = 'destination-in'; pctx.drawImage(frame.mask, 0, 0);
    ctx.drawImage(placeholder, 0, 0); ctx.drawImage(frame.layer, 0, 0);
  }
  if (frame.custom && $('edit-opening').checked) {
    ctx.save(); ctx.strokeStyle = '#eddb8a'; ctx.lineWidth = Math.max(2, w / 500); ctx.setLineDash([w / 100, w / 150]);
    const b = frame.bounds; ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top); ctx.restore();
  }
  if (source && state.view === 'result') applyPhotoGrain(ctx, w, h);
  if (guestExperience && source && brandLogo) finishedPortrait();
}

function syncSettings() {
  for (const key of Object.keys(defaults)) {
    if (key === 'flip') { $('flip').setAttribute('aria-pressed', String(state.settings.flip)); continue; }
    $(key).value = state.settings[key];
    const suffix = ['scale', 'warmth', 'brightness'].includes(key) ? '%' : key === 'rotation' ? '°' : key === 'softness' ? ' px' : '';
    $(`${key}-value`).textContent = `${state.settings[key]}${suffix}`;
  }
}
function resetFit() { state.settings.scale = 100; state.settings.x = 0; state.settings.y = 0; state.settings.rotation = 0; state.settings.flip = false; syncSettings(); render(); }
for (const key of Object.keys(defaults).filter(key => key !== 'flip')) $(key).addEventListener('input', () => {
  state.settings[key] = Number($(key).value); syncSettings(); render();
});
$('flip').addEventListener('click', () => { state.settings.flip = !state.settings.flip; syncSettings(); render(); });
$('auto-fit').addEventListener('click', () => { resetFit(); status(state.faces.length ? 'Face aligned. Drag or adjust the controls to fine-tune it.' : 'Manual fit reset. Adjust size and position to frame your face.'); });
function updateSourcePreview() {
  if (!state.source) return;
  const image = state.source;
  const factor = Math.min(sourceCanvas.width / image.width, sourceCanvas.height / image.height);
  const dx = (sourceCanvas.width - image.width * factor) / 2, dy = (sourceCanvas.height - image.height * factor) / 2;
  sourceCtx.fillStyle = '#e2e4da'; sourceCtx.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  sourceCtx.drawImage(image, dx, dy, image.width * factor, image.height * factor);
  for (let i = 0; i < state.faces.length; i++) {
    const b = state.faces[i].bounds;
    sourceCtx.strokeStyle = i === state.selected ? '#ddedbd' : '#ffffff88'; sourceCtx.lineWidth = 2;
    sourceCtx.strokeRect(dx + b.left * factor, dy + b.top * factor, (b.right - b.left) * factor, (b.bottom - b.top) * factor);
    if (state.faces.length > 1) { sourceCtx.fillStyle = '#f4f9e9'; sourceCtx.font = 'bold 18px Arial'; sourceCtx.fillText(String(i + 1), dx + b.left * factor + 5, dy + b.top * factor + 21); }
  }
}
function faceButtons() {
  $('faces-section').hidden = state.faces.length <= 1;
  $('face-list').replaceChildren(); $('face-count').textContent = `${state.faces.length} found`;
  state.faces.forEach((face, i) => {
    const button = document.createElement('button'); button.className = 'face-button'; button.textContent = `Person ${i + 1}`; button.setAttribute('aria-pressed', String(i === state.selected));
    button.addEventListener('click', () => { state.selected = i; resetFit(); faceButtons(); updateSourcePreview(); applyAutoTone(); poseInfo(); status(`Person ${i + 1} selected. Your portrait is ready to adjust or save.`); });
    $('face-list').append(button);
  });
}
async function setSource(image, label, measuredDetection = null) {
  const generation = ++state.generation;
  state.source = image; state.rawSource = image; state.qualities = []; state.poses = []; state.faces = []; state.landmarks = []; state.selected = 0; state.settings = { ...defaults }; state.toneGeneration++;
  if (state.frame?.quality?.styleStrength) { state.settings.warmth = 0; state.settings.softness = 6; }
  $('source-empty').hidden = true; sourceCanvas.hidden = false; $('source-tag').hidden = false; $('source-tag').textContent = label;
  $('faces-section').hidden = true; controlsEnabled(false); $('stage-empty').hidden = true; busy(true, guestExperience ? 'Preparing your portrait…' : 'Finding your face…'); status(guestExperience ? 'Preparing your portrait…' : 'Finding your face, right here on this device…'); updateSourcePreview();
  if (guestExperience) $('open-camera').disabled = true;
  // Run face preparation during the animation; reveal only once both have finished.
  let processingReady = Promise.resolve();
  if (guestExperience) { guestStep('processing'); processingReady = guestFlow?.processing() || processingReady; }
  let guestPortraitReady = false, archiveWarning = '';
  try {
    await Promise.all([engineReady, templateReady]);
    if (generation !== state.generation) return;
    if (engineFailed) throw new Error('The detector is unavailable.');
    // Live captures carry the landmarks measured on this exact frame, remapped
    // into its face crop. Uploads still run their own detector pass.
    const result = measuredDetection || await detect(image);
    if (generation !== state.generation) return;
    state.faces = result.landmarks.map(points => faceGeometry(points, image.width, image.height));
    state.landmarks = result.landmarks;
    state.qualities = result.qualities;
    state.poses = result.poses;
    if (guestExperience && state.faces.length !== 1) throw new Error('Please take a clear photo with just one person looking straight ahead.');
    // Start with the largest face, while retaining image-order labels.
    if (state.faces.length) state.selected = state.faces.reduce((best, face, i, faces) => face.width * face.height > faces[best].width * faces[best].height ? i : best, 0);
    faceButtons(); updateSourcePreview(); poseInfo(); await applyAutoTone();
    guestPortraitReady = state.faces.length === 1;
    if (guestExperience && guestPortraitReady && !booth.simulated && booth.config.settings.archiveEnabled) {
      busy(true, 'Saving your portrait…'); setView('result');
      try { await booth.archivePortrait(state.frame.id, finishedPortrait().toDataURL('image/jpeg', .94)); }
      catch { archiveWarning = 'Your photo needs attention. Please ask an attendant before leaving.'; }
    }
    status(guestExperience ? archiveWarning : state.faces.length ? `${state.faces.length === 1 ? 'Face found' : `${state.faces.length} faces found; largest selected`} · ${result.elapsed} ms detection. Your portrait is ready to adjust or save.` : 'No face was found. Try a brighter, front-facing photo, or use size and position to fit it manually.', Boolean(archiveWarning) || !state.faces.length);
  } catch (error) {
    if (generation !== state.generation) return;
    if (guestExperience) { state.source = null; state.rawSource = null; state.faces = []; state.qualities = []; state.poses = []; state.landmarks = []; }
    status(guestExperience ? (error.message.startsWith('Please take') ? error.message : 'Your portrait could not be prepared. Please try taking another photo.') : 'Automatic alignment is unavailable. Your photo is loaded; use the size and position controls to fit your face manually.', true);
  } finally {
    await processingReady;
    if (generation === state.generation) {
      controlsEnabled(guestExperience ? guestPortraitReady : Boolean(state.frame)); busy(false); syncSettings(); setView('result');
      if (guestExperience) { $('open-camera').disabled = engineFailed; guestStep(guestPortraitReady ? 'result' : 'choose'); }
      if (guestExperience && guestPortraitReady) booth.track('capture', state.frame.id);
    }
  }
}

async function uploadedImage(file, { frame = false } = {}) {
  if (!file) return;
  const allowed = frame ? ['image/png'] : ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) throw new Error(frame ? 'Choose a PNG frame.' : 'Choose a PNG, JPEG, or WebP photo. HEIC photos need to be converted first.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Please choose an image smaller than 25 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = await imageFromURL(url);
    if (image.width * image.height > 36000000) throw new Error('Please choose an image under 36 megapixels.');
    const limit = frame ? 4096 : 2400;
    const factor = Math.min(1, limit / Math.max(image.width, image.height));
    const canvas = makeCanvas(Math.round(image.width * factor), Math.round(image.height * factor));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); return canvas;
  } finally { URL.revokeObjectURL(url); }
}
$('photo-upload').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  const generation = state.generation;
  try { const image = await uploadedImage(file); if (generation === state.generation) await setSource(image, 'YOUR PHOTOGRAPH'); }
  catch (error) { status(error.message, true); }
});
$('demo').addEventListener('click', async () => {
  try {
    await templateReady;
    const demo = makeCanvas(300, 340), dctx = demo.getContext('2d');
    // A close-up cut from the client's supplied example, never a fabricated guest.
    dctx.drawImage(reference, reference.width * .415, reference.height * .24, reference.width * .205, reference.height * .255, 0, 0, 300, 340);
    await setSource(demo, 'SAMPLE · SUPPLIED REFERENCE');
  } catch (error) { status(error.message, true); }
});

function setView(view) {
  state.view = view;
  for (const mode of ['result', 'frame']) { $(`${mode}-view`).classList.toggle('active', view === mode); $(`${mode}-view`).setAttribute('aria-pressed', String(view === mode)); }
  $('preview-tip').textContent = view === 'frame' ? 'Frame opening · Switch to Composite to see your face' : state.source ? 'Drag your face to fine-tune the fit' : 'Add a photograph to begin';
  render();
}
$('result-view').addEventListener('click', () => setView('result'));
$('frame-view').addEventListener('click', () => setView('frame'));

let drag = null;
portrait.addEventListener('pointerdown', event => {
  if (guestExperience) return;
  if (!state.frame || $('busy').hidden === false || (!state.source && !$('edit-opening').checked)) return;
  if (state.view === 'frame' && !$('edit-opening').checked) return;
  const rect = portrait.getBoundingClientRect();
  drag = { startX: event.clientX, startY: event.clientY, x: state.settings.x, y: state.settings.y,
    bounds: { ...state.frame.bounds }, factor: portrait.width / rect.width };
  portrait.setPointerCapture(event.pointerId); portrait.focus(); event.preventDefault();
});
portrait.addEventListener('pointermove', event => {
  if (!drag) return;
  const dx = (event.clientX - drag.startX) * drag.factor, dy = (event.clientY - drag.startY) * drag.factor;
  if (state.frame.custom && $('edit-opening').checked) {
    const b = drag.bounds, width = b.right - b.left, height = b.bottom - b.top;
    const left = clamp(b.left + dx, 0, portrait.width - width), top = clamp(b.top + dy, 0, portrait.height - height);
    state.frame.bounds = { left, top, right: left + width, bottom: top + height }; rebuildCustomOpening();
  } else {
    state.settings.x = clamp(Math.round(drag.x + dx), Number($('x').min), Number($('x').max));
    state.settings.y = clamp(Math.round(drag.y + dy), Number($('y').min), Number($('y').max)); syncSettings(); render();
  }
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) portrait.addEventListener(event, () => { drag = null; });
portrait.addEventListener('keydown', event => {
  if (guestExperience) return;
  if (!state.source || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault(); const step = event.shiftKey ? 10 : 1;
  if (event.key === 'ArrowLeft') state.settings.x -= step;
  if (event.key === 'ArrowRight') state.settings.x += step;
  if (event.key === 'ArrowUp') state.settings.y -= step;
  if (event.key === 'ArrowDown') state.settings.y += step;
  for (const id of ['x', 'y']) state.settings[id] = clamp(state.settings[id], Number($(id).min), Number($(id).max));
  syncSettings(); setView('result');
});

$('download').addEventListener('click', () => {
  if (!state.source) return;
  const view = state.view, guide = $('edit-opening').checked; state.view = 'result'; $('edit-opening').checked = false; render();
  const format = $('export-format').value, extension = format === 'image/png' ? 'png' : 'jpg';
  finishedPortrait().toBlob(blob => {
    if (!blob) { status('Your portrait could not be exported. Please try again.', true); return; }
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url;
    link.download = `misrah-portrait-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    status(guestExperience ? 'Your photo has been saved to your downloads.' : 'Your portrait is ready. Check your browser’s downloads.');
  }, format, .95);
  state.view = view; $('edit-opening').checked = guide; render();
});

// Custom frames support one enclosed transparent opening, or a movable oval.
let customRevision = 0;
async function loadCustomFrame(image) {
  const sampleScale = Math.min(1, 700 / Math.max(image.width, image.height));
  const small = makeCanvas(Math.round(image.width * sampleScale), Math.round(image.height * sampleScale)), sctx = small.getContext('2d');
  sctx.drawImage(image, 0, 0, small.width, small.height);
  const found = findTransparentOpening(sctx.getImageData(0, 0, small.width, small.height).data, small.width, small.height);
  let bounds = found ? { left: found.left / sampleScale, top: found.top / sampleScale, right: found.right / sampleScale, bottom: found.bottom / sampleScale } :
    { left: image.width * .4, top: image.height * .23, right: image.width * .6, bottom: image.height * .52 };
  state.frame = { image, name: 'Your frame', custom: true, bounds, target: targetForOpening(bounds), layer: makeCanvas(image.width, image.height), mask: makeCanvas(image.width, image.height), revision: ++customRevision, transparent: Boolean(found) };
  setCanvasSize(); $('custom-tools').hidden = Boolean(found); $('edit-opening').checked = !found;
  for (const button of $('scene-list').querySelectorAll('.frame-card')) {
    button.classList.remove('selected'); button.querySelector('.check').hidden = true;
  }
  if (found) {
    const f = state.frame, maskctx = f.mask.getContext('2d');
    // Preserve the supplied alpha contour only around the enclosed opening.
    const pixels = sctx.getImageData(0, 0, small.width, small.height);
    for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) {
      const i = (y * small.width + x) * 4;
      pixels.data[i + 3] = x >= found.left - 1 && x <= found.right && y >= found.top - 1 && y <= found.bottom ? 255 - pixels.data[i + 3] : 0;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
    }
    sctx.putImageData(pixels, 0, 0); maskctx.drawImage(small, 0, 0, image.width, image.height); f.layer.getContext('2d').drawImage(image, 0, 0);
  } else rebuildCustomOpening();
  updateOpeningSliders(); resetFit(); applyAutoTone(); poseInfo(); setView('result');
  status(found ? 'Transparent face opening found. Its contour is preserved. Add a photo or use the face controls to adjust your fit.' : 'Frame loaded. Drag the highlighted oval onto the face area and resize it, then turn off “Adjust frame opening”.');
}
function updateOpeningSliders() {
  const f = state.frame, b = f.bounds;
  for (const [id, value] of [['opening-width', (b.right - b.left) / f.image.width * 100], ['opening-height', (b.bottom - b.top) / f.image.height * 100]]) {
    $(id).value = value; $(`${id}-value`).textContent = `${Math.round(value)}%`;
  }
}
function rebuildCustomOpening() {
  const f = state.frame, b = f.bounds; if (!f.custom) return;
  const mctx = f.mask.getContext('2d'), lctx = f.layer.getContext('2d');
  mctx.clearRect(0, 0, f.image.width, f.image.height); mctx.fillStyle = 'white';
  mctx.beginPath(); mctx.ellipse((b.left + b.right) / 2, (b.top + b.bottom) / 2, (b.right - b.left) / 2, (b.bottom - b.top) / 2, 0, 0, Math.PI * 2); mctx.fill();
  lctx.clearRect(0, 0, f.image.width, f.image.height); lctx.drawImage(f.image, 0, 0);
  lctx.globalCompositeOperation = 'destination-out'; lctx.drawImage(f.mask, 0, 0); lctx.globalCompositeOperation = 'source-over';
  f.target = targetForOpening(b); f.revision = ++customRevision; f.transparent = false; render();
}
$('frame-upload').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try { const image = await uploadedImage(file, { frame: true }); await templateReady; await loadCustomFrame(image); }
  catch (error) { status(error.message, true); }
});
$('edit-opening').addEventListener('change', () => { if ($('edit-opening').checked) rebuildCustomOpening(); render(); });
for (const id of ['opening-width', 'opening-height']) $(id).addEventListener('input', () => {
  const f = state.frame, b = f.bounds, cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
  const width = f.image.width * Number($('opening-width').value) / 100, height = f.image.height * Number($('opening-height').value) / 100;
  const left = clamp(cx - width / 2, 0, f.image.width - width), top = clamp(cy - height / 2, 0, f.image.height - height);
  f.bounds = { left, top, right: left + width, bottom: top + height }; updateOpeningSliders(); rebuildCustomOpening();
});
$('heritage-frame')?.addEventListener('click', async () => {
  await templateReady; selectScene(builtIn, 'heritage-frame'); status(guestExperience ? '' : 'The artisan scene selected.'); if (guestExperience) guestFlow?.start();
});

// Live capture owns the stream, cancellation, pacing, quality gates and preview.
const liveReady = engineReady.then(() => { if (engineFailed) throw new Error('The local detector is unavailable. Refresh to retry.'); });
liveReady.catch(() => {});
const liveCamera = new LiveCamera({ detect, ready: liveReady, getFrame: () => state.frame,
  getSettings: () => booth?.config?.settings || {},
  onClose: captured => { if (guestExperience && !captured) guestFlow?.cancel(); },
  canCapture: () => !guestExperience || document.body.dataset.step === 'camera',
  capture: setSource, getSample: async () => {
    await liveReady;
    const guest = testGuests.get($('sample-person').value);
    return guest?.sample || state.frame.sample || testGuests.values().next().value?.sample || builtIn?.sample;
  } });
$('sample-person').addEventListener('change', () => { if ($('camera-dialog').open) liveCamera.open({ sample: true }); });
if (!guestExperience) $('open-camera').addEventListener('click', () => liveCamera.open());
$('live-correction').addEventListener('change', () => { $('auto-tone').checked = $('live-correction').checked; });

async function resetSession(destination = 'choose') {
  const previousFrame = state.frame, previousId = state.frame?.id || $('scene-list').querySelector('.selected')?.id;
  state.generation++; state.toneGeneration++; liveCamera.close(); busy(false); state.source = null; state.rawSource = null; state.qualities = []; state.poses = []; state.faces = []; state.landmarks = []; state.selected = 0; state.settings = { ...defaults };
  faceLayer.getContext('2d').clearRect(0, 0, faceLayer.width, faceLayer.height);
  const finished = $('branded-portrait');
  if (finished) finished.getContext('2d').clearRect(0, 0, finished.width, finished.height);
  $('source-empty').hidden = false; sourceCanvas.hidden = true; sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height); $('source-tag').hidden = true; $('faces-section').hidden = true; $('face-list').replaceChildren();
  $('photo-upload').value = ''; $('frame-upload').value = ''; controlsEnabled(false); syncSettings();
  if (guestExperience && !previousFrame) { guestStep(destination); return; }
  await templateReady; state.frame = guestExperience ? previousFrame : builtIn; $('custom-tools').hidden = true; $('edit-opening').checked = false;
  const nextId = guestExperience && previousId ? previousId : clientFrames.has('frontal-weaver') ? 'frontal-weaver' : 'heritage-frame';
  selectScene(guestExperience && previousId ? previousFrame : clientFrames.get(nextId) || builtIn, nextId); setView('result'); $('tone-info').textContent = 'Gentle corrections preserve your complexion.'; status(guestExperience ? '' : 'A fresh start. Your previous guest photo has been cleared from the app.'); guestStep(destination);
}
if (guestExperience) guestFlow = createGuestFlow({ camera: liveCamera, clear: resetSession,
  client: booth, getTemplate: () => state.frame.id,
  printImage: () => { render(); return finishedPortrait().toDataURL('image/jpeg', .98); }, hasPhoto: () => Boolean(state.source && state.faces.length === 1 && !$('print-photo').disabled) });
else $('new-session').addEventListener('click', () => resetSession());
if (guestExperience) {
  createAdminPanel({ client: booth, syncLibrary: syncGuestLibrary, pause: () => liveCamera.close(),
    addPortrait: async (file, name) => {
      await liveReady;
      const original = await uploadedImage(file);
      if (original.height < 900 || original.width / original.height < .45 || original.width / original.height > .85) throw new Error('Choose a vertical portrait, at least 900 pixels tall.');
      const factor = Math.min(1, 1800 / original.height), image = makeCanvas(Math.round(original.width * factor), Math.round(original.height * factor));
      image.getContext('2d').drawImage(original, 0, 0, image.width, image.height);
      const check = await detect(image);
      if (check.landmarks.length !== 1) throw new Error('Use a portrait with exactly one clear face.');
      const geometry = faceGeometry(check.landmarks[0], image.width, image.height), centered = await detect(makeCalibrationSample(image, geometry.bounds)), pose = centered.poses[0];
      if (!pose || Math.abs(pose.yaw) > 15 || Math.abs(pose.pitch) > 18 || Math.abs(geometry.angle * 180 / Math.PI) > 12) throw new Error('Use a straight-facing portrait with level eyes and a neutral head angle.');
      const thumb = makeCanvas(200, Math.round(200 * image.height / image.width)); thumb.getContext('2d').drawImage(image, 0, 0, thumb.width, thumb.height);
      booth.config = await booth.request('templates', { name, image: image.toDataURL('image/jpeg', .94), thumbnail: thumb.toDataURL('image/jpeg', .8) });
      await syncGuestLibrary();
    }
  });
  document.addEventListener('booth-settings', () => { $('live-rate').value = String(booth.config.settings.rate); });
}
$('help').addEventListener('click', () => $('help-dialog').showModal());
$('close-help').addEventListener('click', () => $('help-dialog').close());
syncSettings();
// A labelled, static sample URL is useful for sharing a client preview. It never
// requests a webcam or presents the fictional test person as a captured guest.
if (guestExperience) {
  const params = new URLSearchParams(location.search), sampleId = { woman: 'frontal-guest-woman', man: 'frontal-guest-man', bearded: 'frontal-guest-bearded' }[params.get('sample')];
  if (sampleId) engineReady.then(async () => {
    const guest = testGuests.get(sampleId); if (!guest) return;
    const sceneId = params.get('scene'); if (clientFrames.has(sceneId)) selectScene(clientFrames.get(sceneId), sceneId);
    await setSource(guest.image, `AI TEST · ${guest.name.toUpperCase()} · STRAIGHT ON`);
  }).catch(() => {});
}
