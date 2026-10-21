// Synthetic 4K/30 camera + the real app/model. Run separately from other browser
// QA, on a disposable service. This does not certify a physical camera or Mac.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.PHOTOBOOTH_URL || 'http://127.0.0.1:8769';
const seconds = Number(process.env.BENCHMARK_SECONDS || 20);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => {
        if (document.body.dataset.step === 'camera') document.getElementById('auto-capture').checked = false;
      }).observe(document.body, { attributes: true, attributeFilter: ['data-step'] });
    });
    window.benchmarkSamples = []; window.benchmarkMetrics = null; window.benchmarkCorrection = null;
    document.addEventListener('booth-camera-performance', event => { window.benchmarkMetrics = event.detail; });
    const WorkerClass = window.Worker;
    window.Worker = class extends WorkerClass {
      constructor(url, options) {
        super(url, options); this.liveJobs = new Map();
        this.addEventListener('message', ({ data }) => {
          const start = this.liveJobs.get(data.id);
          if (start !== undefined) {
            this.liveJobs.delete(data.id);
            window.benchmarkSamples.push({ at: performance.now(), inference: data.elapsed,
              roundTrip: performance.now() - start, delegate: data.delegate });
          }
        });
      }
      postMessage(message, ...args) {
        if (message.type === 'detect' && message.live) this.liveJobs.set(message.id, performance.now());
        if (message.type === 'correct') window.benchmarkCorrection = { width: message.bitmap.width, height: message.bitmap.height };
        return super.postMessage(message, ...args);
      }
    };
    // Feed a native 3840 x 2160 stream from the app's fictional sample. This
    // exercises full-size snapshot acquisition and all real model/quality work.
    const original = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = function(rate) {
      if (this.width !== 640 || this.height !== 480) return original.call(this, rate);
      const source = this, large = document.createElement('canvas'); large.width = 3840; large.height = 2160;
      const c = large.getContext('2d');
      c.fillStyle = '#ddd9ca'; c.fillRect(0,0,3840,2160); c.drawImage(source,480,0,2880,2160);
      // Change a corner pixel to deliver fresh frames without making synthetic
      // 4K artwork resampling compete with the app's real processing budget.
      let tick = 0;
      const draw = () => { c.fillStyle = tick++ % 2 ? '#ddd9ca' : '#dcd8c9'; c.fillRect(0,0,1,1); };
      const timer = setInterval(draw, 1000 / 30), stream = original.call(large, 30);
      const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      return stream;
    };
  });
  await page.goto(`${base}/?camera=sample`);
  await page.waitForFunction(() => !document.getElementById('touch-start').disabled, null, { timeout: 60000 });
  await page.locator('#touch-start').click();
  // Explicitly select/persist the target profile, including on an older booth.
  await page.keyboard.press('Control+Alt+Shift+A');
  await page.locator('#admin-rate').selectOption('30');
  await page.locator('#admin-settings button[type=submit]').click();
  await page.locator('#admin-feedback').filter({ hasText: 'Device settings saved' }).waitFor();
  await page.locator('#admin-close').click();
  await page.locator('#frontal-weaver').click();
  await page.waitForFunction(() => document.body.dataset.step === 'camera');
  await page.evaluate(() => { document.getElementById('auto-capture').checked = false; });
  await page.waitForTimeout(5000);
  await page.evaluate(() => { window.benchmarkSamples = []; });
  await page.waitForTimeout(seconds * 1000);
  const measured = await page.evaluate(() => ({ samples: window.benchmarkSamples, metrics: window.benchmarkMetrics,
    width: document.getElementById('camera-video').videoWidth, height: document.getElementById('camera-video').videoHeight }));
  assert.equal(measured.width, 3840); assert.equal(measured.height, 2160);
  assert.equal(measured.metrics.targetChecks, 30);
  assert.ok(measured.samples.length > 20, 'The real model must keep analysing frames');
  const samples = measured.samples;
  const fps = (samples.length - 1) * 1000 / (samples.at(-1).at - samples[0].at);
  const percentile = (key, p) => [...samples].sort((a,b) => a[key] - b[key])[Math.min(samples.length - 1, Math.floor(samples.length * p))][key];
  await page.waitForFunction(() => !document.getElementById('capture').disabled);
  await page.locator('#capture').click();
  await page.waitForFunction(() => document.body.dataset.step === 'result', null, { timeout: 45000 });
  const crop = await page.evaluate(() => window.benchmarkCorrection);
  assert.ok(crop.width > 1000 && crop.height > 1000, 'The final face crop must retain native 4K camera detail');
  assert.equal(await page.locator('#face-map').getAttribute('data-faces'), '0');
  await page.keyboard.press('Control+Alt+Shift+A');
  assert.match(await page.locator('#admin-camera-performance').textContent(), /3840 × 2160/);
  await page.screenshot({ path: new URL('../qa/4k30-performance.png', import.meta.url).pathname });
  assert.deepEqual(errors, []);
  const report = { measuredAt: new Date().toISOString(), host: { cpu: os.cpus()[0].model,
    memoryGB: os.totalmem() / 1024 ** 3, arch: os.arch(), browser: browser.version() },
    source: 'Synthetic 3840×2160 canvas camera at target 30 fps; fictional sample face; real MediaPipe inference',
    durationSeconds: seconds, processed: samples.length, mappingFps: fps,
    inferenceMedianMs: percentile('inference', .5), inferenceP95Ms: percentile('inference', .95),
    workerRoundTripP95Ms: percentile('roundTrip', .95), delegate: samples.at(-1).delegate,
    camera: measured.metrics, nativeFaceCrop: crop,
    caveat: 'This host is not the target 16 GB M6. Physical Insta360 Link 2 USB/driver capture and sustained event conditions were not tested.' };
  await writeFile(new URL('../qa/4k30-benchmark.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
