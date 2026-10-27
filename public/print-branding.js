// Keep branding in the pixels shared by preview, download, archive and both print routes.
export const INSTAGRAM_HANDLE = 'MISRAH_AE';
export const brandReady = new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('The Misrah logo could not load. Refresh before printing.'));
  image.src = new URL('./assets/brand/misrah-logo.png', import.meta.url).href;
});
brandReady.catch(() => {});

export function brandedPortrait(portrait, logo, canvas = document.createElement('canvas')) {
  // A fixed 4 x 6 layout, at least 300 dpi, also accommodates custom artwork without cropping.
  canvas.width = Math.max(1200, portrait.width, Math.ceil(portrait.height / 1.5));
  canvas.height = Math.round(canvas.width * 1.5);
  const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  c.fillStyle = '#f3e8d5'; c.fillRect(0, 0, w, h);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  const margin = w * .045, top = h * .12, bottom = h * .018;
  const scale = Math.min((w - margin * 2) / portrait.width, (h - top - bottom) / portrait.height);
  const pw = portrait.width * scale, ph = portrait.height * scale;
  c.drawImage(portrait, (w - pw) / 2, top + (h - top - bottom - ph) / 2, pw, ph);

  // Source bounds remove transparent padding without redrawing or distorting the supplied mark.
  const logoWidth = w * .26, logoHeight = logoWidth * 398 / 768;
  c.drawImage(logo, 156, 341, 768, 398, w - margin - logoWidth, (top - logoHeight) / 2, logoWidth, logoHeight);

  const size = w * .029, x = margin, y = top / 2 - size / 2, radius = size * .25;
  c.strokeStyle = '#211f1c'; c.fillStyle = '#211f1c'; c.lineWidth = w * .0018;
  c.beginPath(); c.roundRect(x, y, size, size, radius); c.stroke();
  c.beginPath(); c.arc(x + size / 2, y + size / 2, size * .235, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(x + size * .765, y + size * .235, size * .058, 0, Math.PI * 2); c.fill();
  c.font = `${w * .027}px Georgia, 'Times New Roman', serif`;
  c.textBaseline = 'middle'; c.fillText(INSTAGRAM_HANDLE, x + size * 1.28, top / 2 + 1);
  return canvas;
}
