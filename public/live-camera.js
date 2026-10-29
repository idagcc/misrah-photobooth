import { FACE_OVAL, faceGeometry, faceCrop, landmarksForCrop, alignment } from './geometry.js';
import { assessFrame, advanceHold, advancePoseCountdown, canCaptureFace, liveDefaults } from './live-quality.js';
import { cameraProfile, analysisDue } from './camera-performance.js';
import { updateFaceMap } from './live-display.js';
import { portraitZoom, withPortraitZoom } from './face-fit.js';
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
    this.scoredBitmap = null; this.pendingBitmap = null; this.frameCallback = null; this.lastAnalysisAt = null;
    this.faceMap = $('face-map'); this.faceMapCtx = this.faceMap.getContext('2d');
    this.hold = { since: null, lastAt: null, samples: 0 };
    this.quickCapture = { frames: [], startedAt: null, invalidSince: null }; this.countdownTimer = null;
    this.mapState = { faces: [], lastSeenAt: null, at: null }; this.guidanceState = null;
    this.previous = null; this.lastGeometry = null;
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
  resetHold() {
    this.hold = { since: null, lastAt: null, samples: 0 };
    this.quickCapture = { frames: [], startedAt: null, invalidSince: null };
    clearTimeout(this.countdownTimer); this.countdownTimer = null; $('hold-progress').value = 0;
    if (this.guestExperience) $('capture-countdown').hidden = true;
  }
  stop() {
    this.epoch++; clearTimeout(this.timer); clearInterval(this.sampleTimer); this.timer = null; this.sampleTimer = null;
    if (this.frameCallback !== null) this.video.cancelVideoFrameCallback?.(this.frameCallback);
    this.frameCallback = null; this.lastAnalysisAt = null;
    this.latestFrame = null; this.lastProcessedFrame = null;
    if (this.metrics?.running) { this.reportPerformance(true); this.metrics.running = false; this.emitPerformance(); }
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; this.video.srcObject = null;
    this.previous = null; this.lastGeometry = null; this.lastFrameAt = null; this.lastVideoTime = -1; this.resetHold();
    $('camera-guidance').dataset.ready = 'false';
    this.sampleCanvas = null; this.sampleBase = null; this.lastAssessment = null;
    this.lastDetection = null; this.scoredAt = null;
    this.mapState = { faces: [], lastSeenAt: null, at: null }; this.guidanceState = null;
    this.analysisCtx.clearRect(0, 0, this.analysis.width, this.analysis.height);
    this.scoredBitmap?.close(); this.scoredBitmap = null;
    this.pendingBitmap?.close(); this.pendingBitmap = null;
    this.faceMapCtx.clearRect(0, 0, this.faceMap.width, this.faceMap.height); this.faceMap.dataset.faces = '0';
    if (this.guestExperience) $('capture-countdown').hidden = true;
    $('capture').disabled = true; $('camera-select').disabled = true; $('live-telemetry').textContent = 'Camera stopped';
    $('live-checks').replaceChildren(); this.checksKey = ''; this.previewCtx.clearRect(0, 0, this.preview.width, this.preview.height);
  }
  close() { const wasOpen = this.dialog.open; this.stop(); if (wasOpen) { this.dialog.close(); this.onClose(Boolean(this.capturing && this.captureCommitted)); } }
  async open({ deviceId, sample = false } = {}) {
    deviceId ??= this.getSettings().cameraId || undefined;
    this.stop(); const epoch = this.epoch; this.sample = sample; this.capturing = false; this.captureCommitted = false;
    $('live-rate').value = String(this.getSettings().rate || Number($('live-rate').value) || 30);
    this.profile = cameraProfile($('live-rate').value, deviceId);
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
        const stream = await navigator.mediaDevices.getUserMedia({ video: this.profile.video, audio: false });
        if (epoch !== this.epoch) { stream.getTracks().forEach(track => track.stop()); return; }
        this.stream = stream;
      }
      if (epoch !== this.epoch) return;
      this.video.srcObject = this.stream; await this.video.play();
      if (epoch !== this.epoch) return;
      const negotiated = this.stream.getVideoTracks()[0].getSettings();
      this.metrics = { running: true, sample, width: this.video.videoWidth, height: this.video.videoHeight,
        requestedWidth: this.profile.video.width.ideal, requestedHeight: this.profile.video.height.ideal,
        negotiatedFps: negotiated.frameRate || null, targetChecks: this.profile.trackingRate,
        checksFps: 0, cameraFps: null, inferenceMs: null, delegate: null, processed: 0 };
      this.metricsStartedAt = null; this.lastMetricsAt = 0; this.cameraFirstFrame = null;
      this.cameraLastFrame = null; this.cameraFirstAt = null; this.cameraLastAt = null;
      this.emitPerformance();
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
      $('camera-status').textContent = this.guestExperience ? 'Make your pose during 3, 2, 1. We take your photo when 1 appears. Or tap Take picture now.' : 'The outline follows your face. Capture automatically crops and fits it to the portrait. Manual capture is always available.';
      this.schedule(epoch);
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
  schedule(epoch) {
    if (epoch !== this.epoch || this.capturing) return;
    if (this.video.requestVideoFrameCallback) {
      if (this.frameCallback !== null) return;
      this.frameCallback = this.video.requestVideoFrameCallback((now, metadata) => {
        this.frameCallback = null;
        if (epoch !== this.epoch) return;
        if (this.cameraFirstFrame === null) { this.cameraFirstFrame = metadata.presentedFrames; this.cameraFirstAt = now; }
        this.cameraLastFrame = metadata.presentedFrames; this.cameraLastAt = now;
        this.latestFrame = metadata.presentedFrames;
        // Keep observing presentation while the worker is busy. Only the most
        // recent frame token survives; neither images nor jobs are queued.
        this.schedule(epoch);
        this.loop(epoch);
      });
    } else {
      const rate = Number($('live-rate').value) || 30;
      const delay = this.lastAnalysisAt === null ? 0 : Math.max(4, 1000 / rate - (performance.now() - this.lastAnalysisAt));
      this.timer = setTimeout(() => this.loop(epoch), delay);
    }
  }
  emitPerformance() {
    if (this.metrics) document.dispatchEvent(new CustomEvent('booth-camera-performance', { detail: { ...this.metrics } }));
  }
  reportPerformance(force = false) {
    const now = performance.now();
    if (!this.metrics || (!force && now - this.lastMetricsAt < 1000)) return;
    this.lastMetricsAt = now;
    const elapsed = now - this.metricsStartedAt;
    this.metrics.checksFps = this.metrics.processed > 1 && elapsed > 0 ? (this.metrics.processed - 1) * 1000 / elapsed : 0;
    if (this.cameraLastAt > this.cameraFirstAt) this.metrics.cameraFps = (this.cameraLastFrame - this.cameraFirstFrame) * 1000 / (this.cameraLastAt - this.cameraFirstAt);
    const m = this.metrics;
    $('live-telemetry').textContent = `${this.sample ? 'SIMULATED · ' : ''}${m.width} × ${m.height} · camera ${m.cameraFps?.toFixed(1) || '—'} fps · mapping ${m.checksFps.toFixed(1)}/${m.targetChecks} fps · ${m.delegate || '—'} · ${m.inferenceMs ?? '—'} ms`;
    this.emitPerformance();
  }
  drawSample() {
    if (!this.sampleCanvas) return;
    const c = this.sampleCanvas.getContext('2d'), condition = $('sample-condition').value;
    c.save(); c.fillStyle = '#ddd9ca'; c.fillRect(0, 0, 640, 480);
    if (condition === 'no-face') { c.restore(); return; }
    if (condition === 'dark') c.filter = 'brightness(18%)';
    if (condition === 'blur') c.filter = 'blur(10px)';
    const dx = condition === 'motion' ? Math.sin(performance.now() / 100) * 85 : condition === 'left' ? -140 : condition === 'right' ? 140 : 0;
    c.drawImage(this.sampleBase, dx, 0);
    if (condition === 'multiple') { c.fillRect(0, 0, 640, 480); c.drawImage(this.sampleBase, 0, 0, 320, 480); c.drawImage(this.sampleBase, 320, 0, 320, 480); }
    c.restore();
  }
  async loop(epoch) {
    if (epoch !== this.epoch || this.capturing) return;
    const started = performance.now();
    const frameDriven = Boolean(this.video.requestVideoFrameCallback);
    const duplicate = frameDriven ? this.latestFrame === this.lastProcessedFrame : this.video.currentTime === this.lastVideoTime;
    if (this.inFlight || this.video.readyState < 2 || duplicate) {
      this.schedule(epoch); return;
    }
    const rate = Number($('live-rate').value) || 30;
    // A 30 fps camera can deliver jittery callback intervals (e.g. 17/50 ms).
    // Process each new frame in 30 mode instead of rejecting those early frames.
    if (rate < 30 && !analysisDue(this.lastAnalysisAt, started, rate)) { this.schedule(epoch); return; }
    this.inFlight = true; this.lastVideoTime = this.video.currentTime; this.lastAnalysisAt = started;
    this.lastProcessedFrame = this.latestFrame;
    let result, bitmap;
    try {
      const factor = Math.min(1, this.profile.analysisLimit / Math.max(this.video.videoWidth, this.video.videoHeight));
      const w = Math.round(this.video.videoWidth * factor), h = Math.round(this.video.videoHeight * factor);
      if (this.analysis.width !== w || this.analysis.height !== h) { this.analysis.width = w; this.analysis.height = h; }
      // Immutable native-resolution pixels keep 4K detail for the shutter. Only
      // the 640 px analysis is rasterized every frame; no full-size canvas copy.
      bitmap = await createImageBitmap(this.video);
      if (epoch !== this.epoch || this.capturing) return;
      this.pendingBitmap = bitmap;
      this.analysisCtx.drawImage(bitmap, 0, 0, w, h);
      const frame = this.getFrame();
      result = await this.detect(this.analysis, { live: true, timestamp: started, correct: !this.guestExperience && $('auto-tone').checked, targetQuality: frame.quality });
      if (epoch !== this.epoch || this.capturing) return;
      const faces = result.landmarks.map(p => faceGeometry(p, w, h));
      const assessment = assessFrame({ faces, poses: result.poses, qualities: result.qualities, width: w, height: h,
        previous: this.previous, targetPose: frame.pose, targetRoll: frame.target.angle,
        observationMs: this.previous ? started - this.previous.at : 200 }, { requireSteady: !this.guestExperience });
      // Keep a separate scored buffer: a shutter tap during the next inference
      // must not pair old landmarks with a newer, unmeasured camera frame.
      this.scoredBitmap?.close(); this.scoredBitmap = bitmap; bitmap = null; this.pendingBitmap = null;
      this.lastDetection = { landmarks: result.landmarks, poses: result.poses, qualities: result.qualities, elapsed: result.elapsed };
      this.scoredAt = performance.now();
      this.lastAssessment = assessment;
      this.paintFaceMap(result.landmarks, w, h, assessment.ready);
      const allowed = this.canCapture();
      if (this.guestExperience) $('capture').disabled = !canCaptureFace(assessment) || !allowed;
      const f = faces[0]; this.previous = f ? { x: f.anchor.x / w, y: f.anchor.y / h, distance: f.eyeDistance / w, at: started } : null;
      const now = performance.now(), enabled = $('auto-capture').checked && allowed;
      const hold = this.guestExperience ? advancePoseCountdown(this.quickCapture, assessment, now, enabled) : advanceHold(this.hold, assessment.ready && enabled, now);
      $('hold-progress').value = hold.progress;
      if (this.guestExperience) {
        this.paintCountdown(hold, epoch);
        if (hold.value === null) this.paintGuestGuidance(assessment, allowed, enabled, now);
      } else {
        $('camera-guidance').textContent = assessment.ready && enabled ? `Hold still… ${Math.ceil((1 - hold.progress) * 14) / 10}s` : assessment.message;
        $('camera-guidance').dataset.ready = String(assessment.ready);
      }
      this.paintChecks(assessment.checks);
      if (this.metricsStartedAt === null) this.metricsStartedAt = now;
      Object.assign(this.metrics, { processed: this.metrics.processed + 1, targetChecks: rate,
        inferenceMs: result.elapsed, delegate: result.delegate || 'CPU' });
      this.reportPerformance();
      if (!this.guestExperience) this.paintPreview(result.corrected || this.analysis, f, frame);
      if (hold.capture) { this.capture(true, { countdown: this.guestExperience }); return; }
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.resetHold(); this.previous = null;
      $('camera-guidance').textContent = this.guestExperience ? 'Please close the camera and try again.' : 'Live checks stopped. Use manual capture or reopen the camera.';
      $('camera-status').textContent = this.guestExperience ? 'Your portrait could not be prepared.' : error.message; $('auto-capture').disabled = true;
      if (this.guestExperience) { this.stop(); $('capture-countdown').hidden = true; $('retry-camera').hidden = false; }
      return;
    } finally {
      result?.corrected?.close(); bitmap?.close();
      if (this.pendingBitmap === bitmap) this.pendingBitmap = null;
      this.inFlight = false;
    }
    if (frameDriven && this.latestFrame !== this.lastProcessedFrame) this.loop(epoch);
    else this.schedule(epoch);
  }
  paintChecks(checks) {
    const key = Object.values(checks).join(':'); if (this.checksKey === key) return; this.checksKey = key;
    const labels = { face: 'One face', position: 'Whole face', pose: 'Angle', light: 'Light', sharp: 'Focus', steady: 'Steady' };
    $('live-checks').replaceChildren(...Object.entries(labels).map(([key, label]) => {
      const item = document.createElement('span'); item.className = checks[key] ? 'passed' : '';
      item.textContent = `${checks[key] ? '✓' : '○'} ${label}`; return item;
    }));
  }
  paintCountdown(phase, epoch) {
    const element = $('capture-countdown');
    if (phase.value === null) {
      if (!element.hidden) this.guidanceState = null;
      element.hidden = true; clearTimeout(this.countdownTimer); this.countdownTimer = null; return;
    }
    element.hidden = false;
    if (element.textContent !== String(phase.value)) element.textContent = String(phase.value);
    const message = 'Look at the camera. Your photo is taken on 1.';
    if ($('camera-guidance').textContent !== message) $('camera-guidance').textContent = message;
    $('camera-guidance').dataset.ready = 'true';
    if (this.countdownTimer === null && !phase.capture) {
      const nextAt = this.quickCapture.startedAt + (phase.value === 3 ? 1000 : 2000);
      this.countdownTimer = setTimeout(() => {
        this.countdownTimer = null;
        if (epoch !== this.epoch || this.capturing) return;
        const enabled = $('auto-capture').checked && this.canCapture() && this.dialog.open;
        if (!this.lastDetection || performance.now() - this.scoredAt > liveDefaults.maxSampleGap) { this.resetHold(); return; }
        const next = advancePoseCountdown(this.quickCapture, this.lastAssessment, performance.now(), enabled);
        this.paintCountdown(next, epoch);
        if (next.capture) this.capture(true, { countdown: true });
      }, Math.max(0, nextAt - performance.now()));
    }
  }
  paintGuestGuidance(assessment, allowed, automatic, now) {
    const code = !allowed ? 'preparing' : assessment.ready ? (automatic ? 'ready-auto' : 'ready-manual') : assessment.code;
    const advice = assessment.code === 'blur' ? 'The camera is focusing. You can also tap Take picture now.' :
      assessment.code === 'pose-unavailable' ? 'Look straight at the camera so we can check your face.' : assessment.message;
    const message = !allowed ? 'Look straight at the camera. We’ll fit your face for you.' : assessment.ready ?
      (automatic ? 'Face found. Get ready for 3, 2, 1.' : 'Face found. Tap Take picture now when you’re ready.') : advice;
    if (!this.guidanceState) this.guidanceState = { shown: null, pending: code, since: now };
    const state = this.guidanceState;
    if (state.pending !== code) { state.pending = code; state.since = now; }
    if (state.shown === null || (state.shown === 'preparing' && allowed) || code === 'ready-auto' || now - state.since >= 250) {
      if (state.shown !== code) { $('camera-guidance').textContent = message; state.shown = code; }
      $('camera-guidance').dataset.ready = String(code.startsWith('ready-'));
    }
  }
  paintFaceMap(faces, width, height, ready) {
    const c = this.faceMapCtx;
    if (this.faceMap.width !== width || this.faceMap.height !== height) { this.faceMap.width = width; this.faceMap.height = height; }
    c.clearRect(0, 0, width, height); this.faceMap.dataset.faces = String(faces.length);
    const display = updateFaceMap(this.mapState, faces, performance.now());
    c.strokeStyle = this.guestExperience ? '#f2e8e1' : ready ? '#dfcab9' : '#f4ddb0'; c.fillStyle = c.strokeStyle;
    c.lineWidth = Math.max(1.5, width / 300); c.lineJoin = 'round';
    const trace = (points, indices, close = false) => {
      c.beginPath();
      indices.forEach((index, i) => { const p = points[index]; i ? c.lineTo(p.x * width, p.y * height) : c.moveTo(p.x * width, p.y * height); });
      if (close) c.closePath(); c.stroke();
    };
    const opacity = display.fading ? .35 : 1;
    for (const points of display.faces) {
      c.globalAlpha = opacity;
      trace(points, FACE_OVAL, true);
      c.globalAlpha = opacity * .6;
      for (const line of [[33,160,158,133,153,144,33], [362,385,387,263,373,380,362], [168,6,1], [61,40,0,270,291,321,17,84,61]]) trace(points, line);
      c.globalAlpha = opacity;
      for (const index of [1,152]) { const p = points[index]; c.beginPath(); c.arc(p.x * width, p.y * height, 2, 0, Math.PI * 2); c.fill(); }
    }
    c.globalAlpha = 1;
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
      const t = alignment(smooth, frame.target, withPortraitZoom({ x: 0, y: 0, scale: 100, flip: false, rotation: 0 }, portraitZoom(this.getSettings(), frame.id)));
      c.save(); c.scale(scale, scale);
      const b = frame.bounds; c.beginPath(); c.rect(b.left - 6, b.top - 6, b.right - b.left + 12, b.bottom - b.top + 12); c.clip();
      c.translate(t.x, t.y); c.rotate(t.angle); c.scale(t.scale, t.scale); c.translate(-smooth.anchor.x, -smooth.anchor.y);
      c.filter = frame.quality?.styleStrength ? 'none' : 'sepia(18%) saturate(92%)'; c.drawImage(source, 0, 0); c.restore(); c.drawImage(frame.layer, 0, 0, w, h);
    } else { this.lastGeometry = null; c.drawImage(frame.layer, 0, 0, w, h); }
    this.preview.dataset.ready = String(Boolean(geometry));
  }
  async capture(automatic, { countdown = false } = {}) {
    if (!this.stream || this.capturing || !this.video.videoWidth || !this.dialog.open) return;
    if (this.guestExperience && (!(automatic && !countdown ? this.lastAssessment?.ready : canCaptureFace(this.lastAssessment)) || !this.canCapture())) return;
    const scored = automatic || this.guestExperience;
    if (scored && (!this.lastDetection || performance.now() - this.scoredAt > liveDefaults.maxSampleGap)) { this.resetHold(); return; }
    this.capturing = true; $('capture').disabled = true; $('auto-capture').disabled = true;
    const source = scored ? this.scoredBitmap : this.video;
    const width = scored ? source.width : this.video.videoWidth, height = scored ? source.height : this.video.videoHeight;
    const measured = scored ? this.lastDetection : null;
    const crop = measured?.landmarks.length === 1 ? faceCrop(measured.landmarks[0], width, height) : { x: 0, y: 0, width, height };
    const image = canvas(crop.width, crop.height);
    image.getContext('2d').drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const detection = measured ? { ...measured, landmarks: measured.landmarks.map(points => landmarksForCrop(points, width, height, crop)) } : null;
    const label = this.sample ? ($('sample-person').value === 'reference' ? 'SIMULATED · SCENE REFERENCE' : 'SIMULATED · AI TEST PERSON') : automatic ? 'AUTO CAMERA CAPTURE' : 'CAMERA CAPTURE';
    if (countdown) {
      const epoch = this.epoch;
      this.video.pause();
      // The pixels are already captured on 1. Keep that frozen moment visible
      // briefly so the number is painted before opening the finished portrait.
      await new Promise(resolve => setTimeout(resolve, 180));
      if (epoch !== this.epoch || !this.dialog.open) return;
    }
    this.captureCommitted = true; this.close(); await this.onCapture(image, label, detection);
  }
}
