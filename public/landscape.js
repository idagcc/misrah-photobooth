// Keep the guest document's viewport fixed, including its dialogs and viewport-based sizing.
// Scale only its outer surface, so narrower windows never trigger a portrait/mobile reflow.
const screen = document.getElementById('booth-screen');
const resolution = Object.freeze({ width: 1920, height: 1080 });
function fit() {
  const scale = Math.min(window.innerWidth / resolution.width, window.innerHeight / resolution.height);
  screen.style.setProperty('--booth-scale', String(scale));
}
window.addEventListener('resize', fit);
screen.addEventListener('load', () => screen.contentWindow.focus());
fit();
// Preserve explicit sample/testing options, without changing the fixed display resolution.
screen.src = `index.html${window.location.search}`;
