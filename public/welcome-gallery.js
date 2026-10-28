// Rotate only available artwork while the welcome screen is visible.
export function createWelcomeGallery() {
  const region = document.querySelector('.welcome-gallery');
  const dots = document.getElementById('welcome-portrait-dots'), pause = document.getElementById('welcome-gallery-pause');
  const caption = document.getElementById('welcome-portrait-name'), controls = document.getElementById('welcome-gallery-controls');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const cache = new Map();
  let entries = [], index = 0, paused = motion.matches, timer, revision = 0, hovering = false, focused = false;
  function schedule() {
    clearTimeout(timer);
    if (entries.length > 1 && !paused && !hovering && !focused && !document.hidden && document.body.dataset.step === 'welcome') {
      timer = setTimeout(() => show((index + 1) % entries.length), 4000);
    }
  }
  function load(entry) {
    if (!cache.has(entry.src)) {
      const pending = new Promise((resolve, reject) => {
        const image = new Image(); image.decoding = 'async';
        image.onload = () => resolve(image); image.onerror = reject; image.src = entry.src;
      });
      cache.set(entry.src, pending);
      pending.catch(() => cache.delete(entry.src));
      while (cache.size > 3) cache.delete(cache.keys().next().value);
    }
    return cache.get(entry.src);
  }
  async function show(next) {
    if (!entries.length) return;
    const run = ++revision, entry = entries[next]; index = next;
    try {
      const image = await load(entry);
      if (run !== revision) return;
      image.id = 'welcome-portrait'; image.alt = `${entry.name} portrait option`;
      image.className = 'welcome-portrait-enter';
      document.getElementById('welcome-portrait').replaceWith(image);
      caption.textContent = entry.name;
      for (const [i, button] of [...dots.children].entries()) button.setAttribute('aria-pressed', String(i === index));
    } catch { /* Keep the current artwork visible and try the next option later. */ }
    if (run === revision) schedule();
  }
  function updatePause() {
    pause.textContent = paused ? 'Play previews' : 'Pause previews';
    pause.setAttribute('aria-label', paused ? 'Play portrait previews' : 'Pause portrait previews');
    pause.setAttribute('aria-pressed', String(paused)); schedule();
  }
  pause.addEventListener('click', () => {
    paused = !paused;
    if (!paused) { hovering = false; focused = false; }
    updatePause();
  });
  region.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { hovering = true; schedule(); } });
  region.addEventListener('pointerleave', () => { hovering = false; schedule(); });
  region.addEventListener('focusin', () => { focused = true; schedule(); });
  region.addEventListener('focusout', event => { if (!region.contains(event.relatedTarget)) { focused = false; schedule(); } });
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', () => { if (motion.matches) paused = true; updatePause(); });
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['data-step'] });
  updatePause();
  return {
    update(templates) {
      const current = entries[index]?.id;
      entries = templates.filter(item => item.active);
      index = Math.max(0, entries.findIndex(item => item.id === current));
      controls.hidden = entries.length < 2;
      dots.replaceChildren(...entries.map((entry, i) => {
        const button = document.createElement('button'); button.type = 'button';
        button.setAttribute('aria-label', `Preview ${entry.name}`); button.setAttribute('aria-pressed', String(i === index));
        button.addEventListener('click', () => show(i)); return button;
      }));
      if (entries.length) show(index); else { revision++; clearTimeout(timer); }
    }
  };
}
