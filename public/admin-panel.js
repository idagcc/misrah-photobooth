import { isAdminShortcut } from './operator-shortcut.js';
import { portraitZoom, defaultPortraitZoom } from './face-fit.js';
const $ = id => document.getElementById(id);
const element = (tag, text, className) => Object.assign(document.createElement(tag), { textContent: text, ...(className ? { className } : {}) });

export function createAdminPanel({ client, addPortrait, syncLibrary, pause, previewFaceFit, currentPortrait }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'admin-dialog'; dialog.setAttribute('aria-labelledby', 'admin-title');
  dialog.innerHTML = `
    <div class="admin-heading"><div><p class="eyebrow">MISRAH · OPERATOR</p><h2 id="admin-title">Booth settings</h2></div><button id="admin-close" class="icon-button" aria-label="Close admin panel">×</button></div>
    <nav class="admin-tabs" aria-label="Admin sections"><button data-admin-tab="devices" aria-pressed="true">Devices</button><button data-admin-tab="fit" aria-pressed="false">Face fit</button><button data-admin-tab="portraits" aria-pressed="false">Portraits</button><button data-admin-tab="usage" aria-pressed="false">Usage</button><button data-admin-tab="storage" aria-pressed="false">Storage</button></nav>
    <section id="admin-devices" class="admin-section">
      <form id="admin-settings"><div class="admin-fields"><label>Camera<select id="admin-camera"><option value="">Default camera</option></select></label><button id="admin-find-cameras" type="button" class="button secondary">Find cameras</button></div>
        <label>Camera & tracking<select id="admin-rate"><option value="30">4K camera · target 30 face updates/sec</option><option value="10">Standard camera · target 10 face updates/sec</option><option value="5">Standard camera · target 5 face updates/sec</option></select></label>
        <p class="admin-hint">4K mode requests 3840 × 2160 at 30 fps and retains full camera detail for the photograph. The camera may supply a lower mode. Face tracking uses a smaller image and GPU acceleration when available. Saved changes apply to the next capture.</p>
        <p id="admin-camera-performance" class="admin-device-status" role="status">Open the guest camera to measure its actual resolution and tracking speed.</p>
        <div class="admin-divider"></div><label>Printing<select id="admin-print-mode"><option value="dialog">System print window</option><option value="native">Direct to selected printer</option></select></label>
        <div class="admin-fields"><label>Printer<select id="admin-printer"><option value="">Select a printer</option></select></label><button id="admin-refresh-printers" type="button" class="button secondary">Refresh printers</button></div>
        <label>Photo paper<select id="admin-media"><option value="">Select 4 × 6 inch paper</option></select></label>
        <div id="admin-printer-status" class="admin-device-status" role="status">Checking the print service…</div>
        <p class="admin-hint">DNP DS-RX1HS: install the DNP driver and add the printer in Windows or macOS first. Paper-out and ribbon alerts appear if the driver reports them. Remaining sheets: unavailable. An idle queue does not confirm paper is loaded.</p>
        <button class="button primary admin-save" type="submit">Save device settings</button>
      </form>
    </section>
    <section id="admin-fit" class="admin-section" hidden>
      <h3>Adjust the face size</h3><p class="admin-hint">Set the face size separately for each portrait. A smaller size gives more room around the face. Saved changes apply to future captures; the current finished photo keeps its original fit.</p>
      <form id="admin-fit-settings" class="admin-fit-layout">
        <figure class="admin-fit-preview"><canvas id="admin-fit-preview" width="560" height="672" role="img" aria-label="Face fit preview"></canvas><figcaption id="admin-fit-preview-label" role="status">Choose a portrait to preview.</figcaption></figure>
        <div><label>Portrait<select id="admin-fit-portrait"></select></label>
          <label>Preview with<select id="admin-fit-sample"><option value="current">Current photo</option><option value="bearded">Sample with a beard</option><option value="man">Sample man</option><option value="woman">Sample woman</option></select></label>
          <label for="admin-face-zoom">Face size <output id="admin-face-zoom-value" for="admin-face-zoom">92%</output></label>
          <input id="admin-face-zoom" type="range" min="75" max="115" step="1" value="92" aria-describedby="admin-face-zoom-hint">
          <div class="admin-zoom-ends"><span>Smaller · 75%</span><span>Larger · 115%</span></div>
          <p id="admin-face-zoom-hint" class="admin-hint">100% is the original size. Long beards can still extend beyond the artwork’s opening. Preview changes here before saving.</p>
          <button id="admin-fit-reset" type="button" class="button secondary admin-save">Use recommended size</button>
          <p id="admin-fit-state" class="admin-hint" role="status"></p>
          <button id="admin-fit-save" type="submit" class="button primary admin-save">Save face fit</button>
        </div>
      </form>
    </section>
    <section id="admin-portraits" class="admin-section" hidden>
      <h3>Portrait library</h3><p class="admin-hint">Add vertical artwork with one clear, straight-facing person. Guests will place their face into this portrait. Names and artwork are saved on this computer.</p>
      <form id="admin-add-portrait"><label>Portrait name<input id="admin-portrait-name" maxlength="60" required placeholder="e.g. The dhow captain"></label><label>Portrait image<input id="admin-portrait-file" type="file" accept="image/jpeg,image/png,image/webp" required></label><p class="admin-hint">JPEG, PNG or WebP · at least 900 px tall · face looking straight ahead. Images are resized for the booth.</p><button id="admin-add-button" class="button primary" type="submit">Check & add portrait</button></form>
      <div id="admin-library" class="admin-library"></div>
    </section>
    <section id="admin-usage" class="admin-section" hidden><div class="admin-section-heading"><h3>Usage on this computer</h3><button id="admin-export" class="button secondary">Export CSV</button></div><p class="admin-hint">Totals persist across restarts. Template taps count as selections; retakes count as new captures. Simulated camera and sample links are excluded.</p><div id="admin-totals" class="admin-totals"></div><div class="admin-table-wrap"><table><caption>Usage by portrait</caption><thead><tr><th>Portrait</th><th>Selected</th><th>Captured</th><th>Print requests</th><th>Accepted</th><th>Queue completed</th><th>Print windows</th><th>Errors</th></tr></thead><tbody id="admin-usage-rows"></tbody></table></div><p class="admin-hint">Accepted = jobs accepted by the print queue. Queue completed = the spooler reported completion; physical output is not independently verified. System print windows may be cancelled, so they are counted separately.</p><h3>Recent print jobs</h3><div id="admin-jobs" class="admin-jobs"></div></section>
    <section id="admin-storage" class="admin-section" hidden>
      <h3>Weekly photo archive</h3><p class="admin-hint">Every finished capture is saved as a high-quality JPEG, including retakes. Reprints use the same photo. Camera originals are not kept. Weeks run Monday–Sunday in Dubai time (UTC+4).</p>
      <form id="admin-archive-settings"><label class="admin-archive-toggle"><input id="admin-archive-enabled" type="checkbox" checked> Save finished portraits automatically</label><button type="submit" class="button primary admin-save">Save archive setting</button></form>
      <div class="admin-divider"></div><p class="admin-hint">Photo folder</p><p id="admin-archive-path" class="admin-folder-path"></p><p class="admin-hint">Folders are created automatically, for example <strong>2026-W43</strong>, then <strong>2026-W44</strong>. Copy these folders to your backup drive after each week.</p>
      <div id="admin-storage-totals" class="admin-totals"></div><div id="admin-storage-status" class="admin-device-status" role="status"></div>
      <button id="admin-retry-archive" class="button secondary admin-save" hidden>Retry saving current photo</button>
      <p id="admin-storage-estimate" class="admin-hint"></p><p class="admin-hint">Plan for about 15–30 GB for 30,000 JPEGs using the included portraits. Keep 50 GB free for larger artwork and retakes, plus space for a separate backup. New artwork can produce larger files.</p>
      <div class="admin-table-wrap"><table><caption>Saved photos by week</caption><thead><tr><th>Folder</th><th>Photos</th><th>Storage</th></tr></thead><tbody id="admin-week-rows"></tbody></table></div>
    </section>
    <p id="admin-feedback" class="admin-feedback" role="status" aria-live="polite"></p><p class="admin-shortcut">Admin: F2 or Ctrl+Alt+Shift+A · Close: Esc</p>`;
  document.body.append(dialog);
  document.addEventListener('booth-camera-performance', ({ detail: m }) => {
    const cameraFps = m.cameraFps === null ? 'measuring' : `${m.cameraFps.toFixed(1)} fps`;
    const state = m.running ? 'Current camera' : 'Last camera session';
    $('admin-camera-performance').textContent = `${state}${m.sample ? ' (simulated)' : ''}: ${m.width} × ${m.height} · camera ${cameraFps} · face tracking ${m.checksFps.toFixed(1)} / ${m.targetChecks} fps · ${m.delegate || 'starting detector'}${m.inferenceMs === null ? '' : ` · ${m.inferenceMs} ms analysis`}`;
  });
  let activeTab = 'devices', refreshing = false, busy = false, stats;
  let fitPreviewRequest = 0;
  function feedback(message, error = false) { $('admin-feedback').textContent = message; $('admin-feedback').classList.toggle('error', error); }
  async function run(action) { try { await action(); } catch (error) { feedback(error.message, true); } }
  async function fitPreview() {
    const request = ++fitPreviewRequest, id = $('admin-fit-portrait').value, zoom = Number($('admin-face-zoom').value);
    delete $('admin-fit-preview').dataset.zoom;
    $('admin-face-zoom-value').value = `${zoom}%`;
    const changed = zoom !== portraitZoom(client.config.settings, id);
    $('admin-fit-state').textContent = changed ? 'Unsaved preview · Save to use this size for future captures.' : 'Saved size · Used for future captures.';
    $('admin-fit-preview-label').textContent = 'Preparing preview…';
    try {
      const result = await previewFaceFit({ id, zoom, sample: $('admin-fit-sample').value });
      if (request !== fitPreviewRequest || !dialog.open) return;
      const canvas = $('admin-fit-preview');
      canvas.width = result.canvas.width; canvas.height = result.canvas.height;
      canvas.getContext('2d').drawImage(result.canvas, 0, 0);
      canvas.dataset.zoom = String(zoom); canvas.dataset.portrait = id;
      $('admin-fit-preview-label').textContent = result.label;
    } catch (error) {
      if (request !== fitPreviewRequest) return;
      const canvas = $('admin-fit-preview'); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      $('admin-fit-preview-label').textContent = 'Preview unavailable. Choose another sample and try again.';
      feedback(error.message, true);
    }
  }
  function selectFit() {
    const id = $('admin-fit-portrait').value, current = currentPortrait();
    const hasCurrent = current.hasPhoto && current.id === id;
    $('admin-fit-sample').querySelector('[value=current]').disabled = !hasCurrent;
    if ($('admin-fit-sample').value === 'current' && !hasCurrent) $('admin-fit-sample').value = id === 'frontal-weaver' ? 'woman' : 'bearded';
    $('admin-face-zoom').value = String(portraitZoom(client.config.settings, id));
    fitPreview();
  }
  function fitLibrary() {
    const previous = $('admin-fit-portrait').value, current = currentPortrait();
    $('admin-fit-portrait').replaceChildren(...client.config.templates.map(p => new Option(p.name, p.id)));
    const preferred = current.hasPhoto ? current.id : previous || 'misrah-falconer';
    if (client.config.templates.some(p => p.id === preferred)) $('admin-fit-portrait').value = preferred;
    $('admin-fit-sample').value = current.hasPhoto ? 'current' : $('admin-fit-portrait').value === 'frontal-weaver' ? 'woman' : 'bearded';
    selectFit();
  }
  function library() {
    $('admin-library').replaceChildren(...client.config.templates.map(item => {
      const row = element('div', '', 'admin-library-row');
      const img = new Image(); img.src = item.thumbnail || item.src; img.alt = ''; img.loading = 'lazy';
      const label = element('span', item.name), toggle = element('button', item.active ? 'Shown to guests' : 'Hidden');
      toggle.type = 'button'; toggle.setAttribute('aria-pressed', String(Boolean(item.active)));
      toggle.setAttribute('aria-label', `${item.name}: ${item.active ? 'hide from guests' : 'show to guests'}`);
      toggle.addEventListener('click', () => run(async () => {
        toggle.disabled = true;
        try {
          client.config = await client.request('templates/toggle', { id: item.id, active: !item.active });
          await syncLibrary(); library(); feedback(`${item.name} ${item.active ? 'hidden' : 'shown'}.`);
        } finally { toggle.disabled = false; }
      }));
      row.append(img, label, toggle); return row;
    }));
  }
  async function cameras(ask = false) {
    let stream;
    try {
      if (ask) stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === 'videoinput');
      const saved = $('admin-camera').value;
      $('admin-camera').replaceChildren(new Option('Default camera', ''), ...devices.map((d, i) => new Option(d.label || `Camera ${i + 1} · allow access to see its name`, d.deviceId)));
      if (saved && !devices.some(d => d.deviceId === saved)) $('admin-camera').add(new Option('Saved camera · not currently found', saved));
      $('admin-camera').value = saved;
      if (ask) feedback('Camera list updated. The preview stream has been stopped.');
    } catch (error) {
      throw new Error(error.name === 'NotAllowedError' ? 'Allow camera access in the browser, then choose Find cameras again.' : error.name === 'NotFoundError' ? 'No camera was found. Connect a camera and try again.' : 'The camera list could not be read. Open the booth in Chrome or Edge.');
    } finally { stream?.getTracks().forEach(track => track.stop()); }
  }
  async function printers(rebuild = false) {
    const selected = $('admin-printer').value;
    const value = await client.request(`status?printer=${encodeURIComponent(selected)}`);
    if (rebuild) {
      $('admin-printer').replaceChildren(new Option('Select a printer', ''), ...value.printers.map(p => new Option(`${p.name} · ${p.state}`, p.id)));
      if (selected && !value.printers.some(p => p.id === selected)) $('admin-printer').add(new Option('Saved printer · not currently found', selected));
      $('admin-printer').value = selected;
    }
    const previous = $('admin-media').value || client.config.settings.media;
    $('admin-media').replaceChildren(new Option('Select 4 × 6 inch paper', ''), ...value.media.map(p => new Option(p.name, p.id)));
    $('admin-media').value = value.media.some(p => p.id === previous) ? previous : value.media[0]?.id || '';
    const p = value.selected, node = $('admin-printer-status');
    node.textContent = value.error ? `Print status unavailable: ${value.error}` : !p ? 'No printer selected. Install or choose a printer to see its status.' : !value.media.length ? `${p.name} · No supported 4 × 6 size found. Install the manufacturer driver and check its paper settings.` : `${p.name} · ${p.fault || p.state}${p.message && p.message !== p.fault ? ` · ${p.message}` : ''}`;
    node.dataset.fault = String(Boolean(value.error || p?.blocked));
    mode();
  }
  function mode() {
    const native = $('admin-print-mode').value === 'native';
    $('admin-printer').disabled = !native; $('admin-media').disabled = !native;
  }
  async function usage() {
    stats = await client.request('stats');
    const labels = { captures: 'Portraits captured', queued: 'Jobs accepted', completed: 'Queue completed', errors: 'Print errors' };
    $('admin-totals').replaceChildren(...Object.entries(labels).map(([key, label]) => { const card = element('div', '', 'admin-total'); card.append(element('strong', String(stats.totals[key])), element('span', label)); return card; }));
    $('admin-usage-rows').replaceChildren(...stats.templates.map(item => { const row = document.createElement('tr'); for (const key of ['name', 'selections', 'captures', 'requests', 'queued', 'completed', 'dialogs', 'errors']) row.append(element(key === 'name' ? 'th' : 'td', String(item[key]))); return row; }));
    const names = new Map(client.config.templates.map(t => [t.id, t.name]));
    $('admin-jobs').replaceChildren(...stats.jobs.map(job => element('p', `${names.get(job.template) || job.template} · ${job.job_id ? `#${job.job_id} · ` : ''}${job.state} · ${job.at} UTC${job.message ? ` · ${job.message}` : ''}`)));
    if (!stats.jobs.length) $('admin-jobs').textContent = 'No direct print jobs yet.';
  }
  async function storage() {
    const value = await client.request('storage');
    const gb = bytes => `${(bytes / 1e9).toFixed(2)} GB`;
    const size = bytes => bytes >= 1e9 ? gb(bytes) : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(2)} MB` : bytes >= 1000 ? `${(bytes / 1000).toFixed(1)} KB` : `${bytes} B`;
    $('admin-archive-path').textContent = value.path;
    $('admin-storage-totals').replaceChildren(...[[value.photos.toLocaleString(), 'Photos saved'], [size(value.bytes), 'Archive size'], [value.freeBytes === null ? 'Unavailable' : gb(value.freeBytes), 'Drive free space']].map(([total, label]) => {
      const card = element('div', '', 'admin-total'); card.append(element('strong', total), element('span', label)); return card;
    }));
    const issue = client.archiveError || value.error || (value.unsaved ? `${value.unsaved} capture(s) have not been saved. ${value.lastError || 'Check the archive folder.'}` : value.lowSpace ? 'Storage is running low. Free space or move the archive to a larger drive.' : null);
    $('admin-storage-status').textContent = issue || (value.enabled ? 'Automatic weekly saving is on.' : 'Automatic saving is paused. Existing photos are kept.');
    $('admin-storage-status').dataset.fault = String(Boolean(issue));
    $('admin-retry-archive').hidden = !client.pendingArchive;
    $('admin-storage-estimate').textContent = value.estimated30000Bytes === null ? 'The live estimate will appear after the first saved portrait.' : `At the current average file size, 30,000 photos would use about ${gb(value.estimated30000Bytes)}. This estimate excludes extra captures beyond 30,000 and backup copies.`;
    $('admin-week-rows').replaceChildren(...value.weeks.map(week => { const row = document.createElement('tr'); row.append(element('th', week.week), element('td', week.photos.toLocaleString()), element('td', size(week.bytes))); return row; }));
  }
  async function refresh() {
    if (!dialog.open || refreshing || busy) return;
    refreshing = true;
    try { if (['devices', 'usage'].includes(activeTab)) await printers(); if (activeTab === 'usage') await usage(); if (activeTab === 'storage') await storage(); }
    catch (error) { feedback(error.message, true); }
    finally { refreshing = false; }
  }
  async function open() {
    if (dialog.open) { if (!busy) dialog.close(); return; }
    if (document.body.dataset.step === 'processing' || document.body.dataset.printing === 'true') return;
    await client.ready;
    pause(); dialog.showModal(); feedback('');
    const settings = client.config.settings;
    $('admin-archive-enabled').checked = settings.archiveEnabled;
    $('admin-camera').replaceChildren(new Option('Default camera', ''), ...(settings.cameraId ? [new Option('Saved camera', settings.cameraId)] : []));
    $('admin-camera').value = settings.cameraId;
    $('admin-rate').value = String(settings.rate); $('admin-print-mode').value = settings.printMode;
    $('admin-printer').replaceChildren(new Option(settings.printer || 'Select a printer', settings.printer));
    $('admin-media').replaceChildren(new Option(settings.media || 'Select 4 × 6 inch paper', settings.media));
    library();
    if (activeTab === 'fit') fitLibrary();
    await Promise.all([run(() => cameras()), run(() => printers(true))]);
    if (activeTab === 'usage') await usage();
    if (activeTab === 'storage') await storage();
  }
  document.addEventListener('keydown', event => {
    if (isAdminShortcut(event)) {
      event.preventDefault(); if (!busy) run(open);
    }
  });
  document.addEventListener('booth-admin-toggle', () => { if (!busy) run(open); });
  $('admin-close').addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    fitPreviewRequest++;
    const canvas = $('admin-fit-preview'); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    document.dispatchEvent(new CustomEvent('booth-admin-closed'));
  });
  for (const tab of dialog.querySelectorAll('[data-admin-tab]')) tab.addEventListener('click', () => {
    activeTab = tab.dataset.adminTab;
    for (const other of dialog.querySelectorAll('[data-admin-tab]')) {
      const active = other === tab; other.setAttribute('aria-pressed', String(active)); $('admin-' + other.dataset.adminTab).hidden = !active;
    }
    feedback(''); if (activeTab === 'fit') fitLibrary(); refresh();
  });
  $('admin-fit-portrait').addEventListener('change', selectFit);
  $('admin-fit-sample').addEventListener('change', fitPreview);
  $('admin-face-zoom').addEventListener('input', fitPreview);
  $('admin-fit-reset').addEventListener('click', () => {
    $('admin-face-zoom').value = String(defaultPortraitZoom($('admin-fit-portrait').value)); fitPreview();
  });
  $('admin-fit-settings').addEventListener('submit', event => {
    event.preventDefault(); if ($('admin-fit-save').disabled) return;
    const id = $('admin-fit-portrait').value, zoom = Number($('admin-face-zoom').value);
    run(async () => {
      $('admin-fit-save').disabled = true;
      try {
        await client.saveSettings({ ...client.config.settings, portraitZoom: { ...client.config.settings.portraitZoom, [id]: zoom } });
        fitPreview();
        feedback('Face fit saved on this computer. Applies to future captures.');
      } finally { $('admin-fit-save').disabled = false; }
    });
  });
  $('admin-find-cameras').addEventListener('click', () => run(() => cameras(true)));
  $('admin-refresh-printers').addEventListener('click', () => run(() => printers(true)));
  $('admin-printer').addEventListener('change', () => { $('admin-media').value = ''; run(() => printers()); });
  $('admin-print-mode').addEventListener('change', mode);
  $('admin-settings').addEventListener('submit', event => {
    event.preventDefault(); run(async () => {
      await client.saveSettings({ ...client.config.settings, cameraId: $('admin-camera').value, rate: Number($('admin-rate').value), printMode: $('admin-print-mode').value, printer: $('admin-printer').value, media: $('admin-media').value });
      feedback('Device settings saved on this computer.');
    });
  });
  $('admin-add-portrait').addEventListener('submit', event => {
    event.preventDefault(); if (busy) return;
    run(async () => {
      busy = true; $('admin-add-button').disabled = true; $('admin-close').disabled = true;
      feedback('Checking the face and preparing the portrait…');
      try {
        await addPortrait($('admin-portrait-file').files[0], $('admin-portrait-name').value);
        $('admin-add-portrait').reset(); library(); feedback('Portrait added. It is ready for guests.');
      } finally { busy = false; $('admin-add-button').disabled = false; $('admin-close').disabled = false; }
    });
  });
  $('admin-export').addEventListener('click', () => run(async () => {
    await usage();
    const keys = ['name', 'selections', 'captures', 'requests', 'queued', 'completed', 'dialogs', 'errors'];
    const quote = value => `"${String(value).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
    const csv = [keys.join(','), ...stats.templates.map(row => keys.map(k => quote(row[k])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'misrah-usage.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  $('admin-archive-settings').addEventListener('submit', event => {
    event.preventDefault(); run(async () => { await client.setArchiveEnabled($('admin-archive-enabled').checked); await storage(); feedback('Archive setting saved.'); });
  });
  $('admin-retry-archive').addEventListener('click', () => run(async () => {
    $('admin-retry-archive').disabled = true;
    try { await client.retryArchive(); await storage(); feedback('The portrait has been saved.'); }
    finally { $('admin-retry-archive').disabled = false; }
  }));
  document.addEventListener('booth-archive-state', () => { if (dialog.open && activeTab === 'storage') refresh(); });
  document.addEventListener('booth-usage-error', () => feedback('A usage count could not be saved. Check the local service.', true));
  setInterval(refresh, 5000);
  return { isOpen: () => dialog.open };
}
