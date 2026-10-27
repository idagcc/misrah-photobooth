export class BoothClient {
  constructor() {
    this.config = null;
    this.pendingArchive = null;
    this.archiveError = null;
    this.ready = this.load();
    this.ready.catch(() => {});
    this.simulated = /(?:[?&](?:sample|camera)=)/.test(location.search);
  }
  async request(path, value, timeout = 20000) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`/api/${path}`, { signal: controller.signal, cache: 'no-store',
        ...(value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Booth-Token': this.token }, body: JSON.stringify(value) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The local service is unavailable.');
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(path === 'print' ? 'The local service took too long. Check the print queue before printing again.' : 'The local service took too long. Please try again.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async load() {
    const result = await this.request('bootstrap');
    this.token = result.token; this.config = result;
    return result;
  }
  track(kind, template) {
    if (this.simulated) return;
    return this.request('events', { id: crypto.randomUUID(), kind, template }).catch(() => {
      document.dispatchEvent(new CustomEvent('booth-usage-error'));
    });
  }
  async saveSettings(settings) {
    this.config = await this.request('settings', settings);
    document.dispatchEvent(new CustomEvent('booth-settings'));
  }
  async archivePortrait(template, image) {
    if (this.simulated || !this.config.settings.archiveEnabled) return { skipped: true };
    if (this.pendingArchive) throw new Error('The previous portrait still needs to be saved.');
    this.pendingArchive = { id: crypto.randomUUID(), template, image };
    return this.retryArchive();
  }
  async retryArchive() {
    if (!this.pendingArchive) return;
    try {
      const result = await this.request('archive', this.pendingArchive);
      if (!result.saved && !result.skipped) throw new Error('The photo was not saved.');
      this.pendingArchive = null; this.archiveError = null;
      return result;
    } catch (error) { this.archiveError = error.message; throw error; }
    finally { document.dispatchEvent(new CustomEvent('booth-archive-state')); }
  }
  async setArchiveEnabled(enabled) {
    this.config = await this.request('archive/settings', { enabled });
    if (!enabled) { this.pendingArchive = null; this.archiveError = null; }
    document.dispatchEvent(new CustomEvent('booth-settings'));
    document.dispatchEvent(new CustomEvent('booth-archive-state'));
  }
}
