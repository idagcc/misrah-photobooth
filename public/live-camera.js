import { faceGeometry, alignment } from './geometry.js';
import { assessFrame, advanceHold } from './live-quality.js';
const $ = id => document.getElementById(id);
const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

export class LiveCamera {
  constructor({ detect, ready, getFrame, capture, getSample, getSettings = () => ({}), onClose = () => {}, canCapture = () => true }) {
    Object.assign(this, { detect, ready, getFrame, onCapture: capture, getSample, getSettings, onClose, canCapture });
    this.dialog = $('camera-dialog'); this.video = $('camera-video'); this.stream = null;
    this.guestExperience = document.body.dataset.experience === 'guest';
    this.epoch = 0; this.timer = null; this.sampleTimer = null; this.inFlight = false;
    this.preview = $('live-composite'); this.previewCtx = this.preview.getContext('2d');
    this.analysis = canvas(640, 480); this.analysisCtx = this.analysis.getContext('2d');
    this.snapshot = canvas(1280, 960); this.snapshotCtx = this.snapshot.getContext('2d');
    this.hold = { since: null, lastAt: null, samples: 0 }; this.previous = null; this.lastGeometry = null;
    $('close-camera').addEventListener('click', () => this.close());
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener('close', () => { if (this.stream) this.close(); });
    $('camera-select').addEventListener('change', () => this.open({ deviceId: $('camera-select').value }));
    $('capture').addEventListener('click', () => this.capture(false));
    $('auto-capture').addEventListener('change', () => this.resetHold());
    $('live-rate').addEventListener('change', () => this.resetHold());
    $('live-test').addEventListener('click', () => this.open({ sample: true }));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.stream) this.close(); });
    window.addEventListener('pagehide', () => this.close());
  }
  resetHold() { this.hold = { since: null, lastAt: null, samples: 0 }; $('hold-progress').value = 0; }
  stop() {
    this.epoch++; clearTimeout(this.timer); clearInterval(this.sampleTimer); this.timer = null; this.sampleTimer = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; this.video.srcObject = null;
    this.previous = null; this.lastGeometry = null; this.lastFrameAt = null; this.lastVideoTime = -1; this.resetHold();
    $('camera-guidance').dataset.ready = 'false';
    this.sampleCanvas = null; this.sampleBase = null; this.lastAssessment = null;
    this.analysisCtx.clearRect(0, 0, this.analysis.width, this.analysis.height);
    this.snapshotCtx.clearRect(0, 0, this.snapshot.width, this.snapshot.height);
    $('capture').disabled = true; $('camera-select').disabled = true; $('live-telemetry').textContent = 'Camera stopped';
    $('live-checks').replaceChildren(); this.previewCtx.clearRect(0, 0, this.preview.width, this.preview.height);
  }
  close() { const wasOpen = this.dialog.open; this.stop(); if (wasOpen) { this.dialog.close(); this.onClose(this.capturing); } }
  async open({ deviceId, sample = false } = {}) {
    deviceId ??= this.getSettings().cameraId || undefined;
    this.stop(); const epoch = this.epoch; this.sample = sample; this.capturing = false;
    if (this.guestExperience) { $('auto-capture').checked = true; $('retry-camera').hidden = true; $('capture-countdown').hidden = true; }
    $('live-correction').checked = $('auto-tone').checked;
    if (!this.dialog.open) this.dialog.showModal();
    $('live-mode').textContent = sample ? ($('sample-person').value === 'reference' ? 'SIMULATED CAMERA · SCENE REFERENCE' : 'SIMULATED CAMERA · AI TEST PERSON') : this.guestExperience ? 'YOUR PHOTOGRAPH' : 'LIVE CAMERA · ON THIS DEVICE';
    $('camera-guidance').textContent = this.guestExperience ? 'Getting the camera ready…' : 'Starting the local camera and face detector…'; $('camera-status').textContent = this.guestExperience ? 'Please allow camera access when your browser asks.' : 'Loading live guidance…';
    $('auto-capture').disabled = true; this.preview.dataset.ready = 'false';
    try {
      if (sample) {
        const image = await this.getSample(); if (epoch !== this.epoch) return;
        const base = canvas(640, 480), c = base.getContext('2d');
        c.fillStyle = '#ddd9ca'; c.fillRect(0, 0, 640, 480);
        c.drawImage(image, 0, 0, 640, 480);
        this.sampleBase = base; this.sampleCanvas = canvas(640, 480); this.drawSample();
        this.stream = this.sampleCanvas.captureStream(30);
        this.sampleTimer = setInterval(() => this.drawSample(), 1000 / 30);
        $('sample-controls').hidden = false;
        $('camera-select').replaceChildren(new Option('Simulated camera', 'sample'));
      } else {
        $('sample-controls').hidden = true;
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Open the local address in Chrome or Edge to use a webcam.');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 960 }, frameRate: { ideal: 30, max: 30 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }) }, audio: false });
        if (epoch !== this.epoch) { stream.getTracks().forEach(track => track.stop()); return; }
        this.stream = stream;
      }
      if (epoch !== this.epoch) return;
      this.video.srcObject = this.stream; await this.video.play();
      if (epoch !== this.epoch) return;
      if (!sample) {
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        if (epoch !== this.epoch) return;
        $('camera-select').replaceChildren(...devices.map((d, i) => new Option(d.label || `Camera ${i + 1}`, d.deviceId)));
        $('camera-select').value = this.stream.getVideoTracks()[0].getSettings().deviceId || '';
        $('camera-select').disabled = false;
      }
      $('capture').disabled = this.guestExperience;
      await this.ready;
      if (epoch !== this.epoch) return;
      $('auto-capture').disabled = false;
      $('camera-status').textContent = this.guestExperience ? 'Your photo is taken automatically after a steady 3-second countdown.' : 'Match the guide. Auto capture waits for a clear, well-lit and steady face. Manual capture is always available.';
      this.loop(epoch);
      return true;
    } catch (error) {
      if (epoch !== this.epoch) return;
      clearTimeout(this.timer);
      if (!this.stream) {
        $('camera-guidance').textContent = error.name === 'NotAllowedError' ? 'Allow camera access in your browser, then close this window and try again.' : error.name === 'NotFoundError' ? 'No camera was found. Connect a camera and try again.' : this.guestExperience ? 'The camera could not start. Please close this window and try again.' : error.message;
      } else $('camera-guidance').textContent = this.guestExperience ? 'Your portrait could not be prepared. Please close the camera and try again.' : 'Live detection is unavailable. Manual capture is available.';
      $('camera-status').textContent = this.guestExperience ? 'Your photo stays on this device.' : error.message; $('auto-capture').disabled = true;
      this.stop();
      if (this.guestExperience) $('retry-camera').hidden = false;
      return false;
    }
  }
  drawSample() {
    if (!this.sampleCanvas) return;
    const c = this.sampleCanvas.getContext('2d'), condition = $('sample-condition').value;
    c.save(); c.fillStyle = '#ddd9ca'; c.fillRect(0, 0, 640, 480);
    if (condition === 'no-face') { c.restore(); return; }
    if (condition === 'dark') c.filter = 'brightness(18%)';
    if (condition === 'blur') c.filter = 'blur(10px)';
    const dx = condition === 'motion' ? Math.sin(performance.now() / 100) * 85 : 0;
    c.drawImage(this.sampleBase, dx, 0);
    if (condition === 'multiple') { c.fillRect(0, 0, 640, 480); c.drawImage(this.sampleBase, 0, 0, 320, 480); c.drawImage(this.sampleBase, 320, 0, 320, 480); }
    c.restore();
  }
  async loop(epoch) {
    if (epoch !== this.epoch || this.capturing) return;
    const started = performance.now();
    if (this.inFlight || this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) {
      this.timer = setTimeout(() => this.loop(epoch), 30); return;
    }
    this.inFlight = true; this.lastVideoTime = this.video.currentTime;
    let result;
    try {
      const factor = Math.min(1, 640 / Math.max(this.video.videoWidth, this.video.videoHeight));
      const w = Math.round(this.video.videoWidth * factor), h = Math.round(this.video.videoHeight * factor);
      if (this.analysis.width !== w || this.analysis.height !== h) { this.analysis.width = w; this.analysis.height = h; }
      const snapshotScale = Math.min(1, 1600 / Math.max(this.video.videoWidth, this.video.videoHeight));
      const sw = Math.round(this.video.videoWidth * snapshotScale), sh = Math.round(this.video.videoHeight * snapshotScale);
      if (this.snapshot.width !== sw || this.snapshot.height !== sh) {
        this.snapshot.width = sw; this.snapshot.height = sh;
      }
      this.snapshotCtx.drawImage(this.video, 0, 0, sw, sh);
      this.analysisCtx.drawImage(this.snapshot, 0, 0, w, h);
      const frame = this.getFrame();
      result = await this.detect(this.analysis, { live: true, timestamp: started, correct: !this.guestExperience && $('auto-tone').checked, targetQuality: frame.quality });
      if (epoch !== this.epoch) return;
      const faces = result.landmarks.map(p => faceGeometry(p, w, h));
      const assessment = assessFrame({ faces, poses: result.poses, qualities: result.qualities, width: w, height: h,
        previous: this.previous, targetPose: frame.pose, targetRoll: frame.target.angle });
      this.lastAssessment = assessment;
      const allowed = this.canCapture();
      if (this.guestExperience) $('capture').disabled = !assessment.ready || !allowed;
      const f = faces[0]; this.previous = f ? { x: f.anchor.x / w, y: f.anchor.y / h, distance: f.eyeDistance / w } : null;
      const now = performance.now(), hold = advanceHold(this.hold, assessment.ready && $('auto-capture').checked && allowed, now, this.guestExperience ? { holdMs: 3000 } : {});
      $('hold-progress').value = hold.progress;
      $('camera-guidance').textContent = assessment.ready && $('auto-capture').checked && allowed ? (this.guestExperience ? 'Looking good. Hold still for your photo.' : `Hold still… ${Math.ceil((1 - hold.progress) * 14) / 10}s`) : assessment.message;
      if (this.guestExperience) { $('capture-countdown').hidden = !assessment.ready || !allowed; $('capture-countdown').textContent = String(Math.max(1, Math.ceil((1 - hold.progress) * 3))); }
      $('camera-guidance').dataset.ready = String(assessment.ready); this.paintChecks(assessment.checks);
      const fps = this.lastFrameAt ? 1000 / (now - this.lastFrameAt) : 0; this.lastFrameAt = now;
      const p = result.poses[0];
      $('live-telemetry').textContent = `${this.sample ? 'SIMULATED · ' : ''}${fps ? fps.toFixed(1) : '—'} checks/s · ${result.elapsed} ms · ${p ? `turn ${Math.round(p.yaw)}° / chin ${Math.round(p.pitch)}°` : 'looking for a face'}`;
      if (!this.guestExperience) this.paintPreview(result.corrected || this.analysis, f, frame);
      if (hold.capture) { this.capture(true); return; }
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.resetHold(); this.previous = null;
      $('camera-guidance').textContent = this.guestExperience ? 'Please close the camera and try again.' : 'Live checks stopped. Use manual capture or reopen the camera.';
      $('camera-status').textContent = this.guestExperience ? 'Your portrait could not be prepared.' : error.message; $('auto-capture').disabled = true;
      if (this.guestExperience) { this.stop(); $('capture-countdown').hidden = true; $('retry-camera').hidden = false; }
      return;
    } finally { result?.corrected?.close(); this.inFlight = false; }
    this.timer = setTimeout(() => this.loop(epoch), Math.max(0, 1000 / Number($('live-rate').value) - (performance.now() - started)));
  }
  paintChecks(checks) {
    const labels = { face: 'One face', position: 'Position', pose: 'Angle', light: 'Light', sharp: 'Focus', steady: 'Steady' };
    $('live-checks').replaceChildren(...Object.entries(labels).map(([key, label]) => {
      const item = document.createElement('span'); item.className = checks[key] ? 'passed' : '';
      item.textContent = `${checks[key] ? '✓' : '○'} ${label}`; return item;
    }));
  }
  paintPreview(source, geometry, frame) {
    const w = 480, h = Math.round(w * frame.image.height / frame.image.width), scale = w / frame.image.width;
    if (this.preview.width !== w || this.preview.height !== h) { this.preview.width = w; this.preview.height = h; }
    const c = this.previewCtx; c.fillStyle = '#eae3d4'; c.fillRect(0, 0, w, h);
    if (geometry) {
      // Display smoothing never affects the raw observations used for capture.
      const old = this.lastGeometry;
      const smooth = old ? { ...geometry, anchor: { x: old.anchor.x * .35 + geometry.anchor.x * .65, y: old.anchor.y * .35 + geometry.anchor.y * .65 },
        eyeDistance: old.eyeDistance * .35 + geometry.eyeDistance * .65, angle: old.angle * .35 + geometry.angle * .65 } : geometry;
      this.lastGeometry = smooth;
      const t = alignment(smooth, frame.target, { x: 0, y: 0, scale: 100, flip: false, rotation: 0 });
      c.save(); c.scale(scale, scale);
      const b = frame.bounds; c.beginPath(); c.rect(b.left - 6, b.top - 6, b.right - b.left + 12, b.bottom - b.top + 12); c.clip();
      c.translate(t.x, t.y); c.rotate(t.angle); c.scale(t.scale, t.scale); c.translate(-smooth.anchor.x, -smooth.anchor.y);
      c.filter = frame.quality?.styleStrength ? 'none' : 'sepia(18%) saturate(92%)'; c.drawImage(source, 0, 0); c.restore(); c.drawImage(frame.layer, 0, 0, w, h);
    } else { this.lastGeometry = null; c.drawImage(frame.layer, 0, 0, w, h); }
    this.preview.dataset.ready = String(Boolean(geometry));
  }
  async capture(automatic) {
    if (!this.stream || this.capturing || !this.video.videoWidth || !this.dialog.open) return;
    if (this.guestExperience && (!this.lastAssessment?.ready || !this.canCapture())) return;
    this.capturing = true; $('capture').disabled = true; $('auto-capture').disabled = true;
    // Guest shutter and auto capture use the exact full-resolution scored frame.
    const source = automatic || this.guestExperience ? this.snapshot : this.video;
    const image = canvas(source === this.snapshot ? this.snapshot.width : this.video.videoWidth, source === this.snapshot ? this.snapshot.height : this.video.videoHeight); image.getContext('2d').drawImage(source, 0, 0);
    const label = this.sample ? ($('sample-person').value === 'reference' ? 'SIMULATED · SCENE REFERENCE' : 'SIMULATED · AI TEST PERSON') : automatic ? 'AUTO CAMERA CAPTURE' : 'CAMERA CAPTURE';
    this.close(); await this.onCapture(image, label);
  }
}
