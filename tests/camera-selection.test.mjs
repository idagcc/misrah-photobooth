import test from 'node:test';
import assert from 'node:assert/strict';
import { openPreferredCamera } from '../public/camera-selection.js';

const stream = id => {
  const track = { stopped: false, stop() { this.stopped = true; }, getSettings: () => ({ deviceId: id }) };
  return { getTracks: () => [track], getVideoTracks: () => [track] };
};
const stale = { deviceId: { exact: 'old-id' }, width: { ideal: 3840 } };

test('restores the exact saved camera without opening another camera', async () => {
  const saved = stream('old-id');
  const media = { getUserMedia: async request => { assert.deepEqual(request, { video: stale, audio: false }); return saved; } };
  assert.equal(await openPreferredCamera(media, stale, 'Booth Camera'), saved);
});

test('recovers a rotated ID by camera name and closes the permission probe', async () => {
  const probe = stream('built-in'), selected = stream('new-id'), requests = [];
  const media = {
    async getUserMedia(request) {
      requests.push(request);
      if (requests.length === 1) throw new DOMException('', 'OverconstrainedError');
      return requests.length === 2 ? probe : selected;
    },
    enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'new-id', label: 'Booth Camera' }]
  };
  assert.equal(await openPreferredCamera(media, stale, 'Booth Camera'), selected);
  assert.equal(probe.getTracks()[0].stopped, true);
  assert.deepEqual(requests[2].video.deviceId, { exact: 'new-id' });
  assert.equal(requests[2].video.width.ideal, 3840);
});

test('missing or ambiguous saved cameras do not silently replace the operator choice', async () => {
  for (const devices of [[], ['one', 'two'].map(deviceId => ({ kind: 'videoinput', deviceId, label: 'Booth Camera' }))]) {
    const probe = stream('built-in');
    const media = { getUserMedia: async ({ video }) => { if (video.deviceId) throw new DOMException('', 'NotFoundError'); return probe; }, enumerateDevices: async () => devices };
    await assert.rejects(openPreferredCamera(media, stale, 'Booth Camera', () => true, async () => {}), { name: 'NotFoundError' });
    assert.equal(probe.getTracks()[0].stopped, true);
  }
});

test('permission and busy camera errors are preserved without requesting another camera', async () => {
  for (const name of ['NotAllowedError', 'NotReadableError']) {
    let calls = 0;
    await assert.rejects(openPreferredCamera({ getUserMedia: async () => { calls++; throw new DOMException('', name); } }, stale, 'Booth Camera', () => true, async () => {}), { name });
    assert.equal(calls, name === 'NotReadableError' ? 4 : 1);
  }
});

test('old ID-only settings recover permission and use the default once', async () => {
  const probe = stream('default'); let calls = 0;
  assert.equal(await openPreferredCamera({ getUserMedia: async () => { if (++calls === 1) throw new DOMException('', 'OverconstrainedError'); return probe; } }, stale), probe);
});

test('reopens the saved camera when it finishes starting', async () => {
  const saved = stream('old-id');
  let attempts = 0;
  const media = { getUserMedia: async ({ video }) => {
    assert.deepEqual(video, stale);
    if (++attempts === 1) throw new DOMException('', 'NotReadableError');
    return saved;
  } };
  assert.equal(await openPreferredCamera(media, stale, 'Booth Camera', () => true, async () => {}), saved);
});
