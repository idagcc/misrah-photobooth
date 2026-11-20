// Browser camera IDs can change after private browsing or a profile reset.
async function openOnce(media, video, label = '', isCurrent = () => true) {
  const request = constraints => media.getUserMedia({ video: constraints, audio: false });
  try { return await request(video); }
  catch (error) {
    if (!video.deviceId || !['OverconstrainedError', 'NotFoundError'].includes(error.name) || !isCurrent()) throw error;
  }
  const { deviceId, ...fallback } = video;
  // Permission is needed to expose camera names in a new browser profile.
  const probe = await request(fallback);
  if (!label || !isCurrent()) return probe;
  try {
    const devices = (await media.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const matches = devices.filter(d => d.label === label);
    if (matches.length !== 1) throw new DOMException('The saved camera is unavailable. Connect it or choose a camera in settings.', 'NotFoundError');
    if (!isCurrent() || probe.getVideoTracks()[0].getSettings().deviceId === matches[0].deviceId) return probe;
    probe.getTracks().forEach(track => track.stop());
    return await request({ ...fallback, deviceId: { exact: matches[0].deviceId } });
  } catch (error) {
    probe.getTracks().forEach(track => track.stop());
    throw error;
  }
}

// USB cameras can enumerate or finish opening a few seconds after Windows sign-in.
export async function openPreferredCamera(media, video, label = '', isCurrent = () => true,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { return await openOnce(media, video, label, isCurrent); }
    catch (error) {
      if (attempt >= 3 || !isCurrent() || !['NotFoundError', 'NotReadableError'].includes(error.name)) throw error;
      await wait(1000 * (attempt + 1));
      if (!isCurrent()) throw error;
    }
  }
}
