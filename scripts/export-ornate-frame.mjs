// Export the generated frame with the supplied, unmodified brand mark and exact Instagram copy.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = new URL('../', import.meta.url), out = new URL('../../output/misrah-ornate-frame/', import.meta.url);
await mkdir(out, { recursive: true });
const data = async path => `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
const sources = await Promise.all([
  data(new URL('public/assets/frames/misrah-ivory-ornate-v1.png', root)),
  data(new URL('public/assets/brand/misrah-logo.png', root)),
  data(new URL('../../output/misrah-final-portraits/pearl-diver-print.png', import.meta.url))
]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const images = await page.evaluate(async sources => {
    const load = async src => { const image = new Image(); image.src = src; await image.decode(); return image; };
    const [frame, logo, photo] = await Promise.all(sources.map(load));
    const make = () => Object.assign(document.createElement('canvas'), { width: frame.width, height: frame.height });
    const canvas = make(), c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    c.drawImage(frame, 0, 0);
    const scale = w / 1024;
    // Crop only the transparent padding around the original official lockup.
    c.drawImage(logo, 156, 341, 768, 398, 716 * scale, 35 * scale, 250 * scale, 250 * 398 / 768 * scale);
    c.save(); c.scale(scale, scale);
    c.strokeStyle = '#211f1c'; c.fillStyle = '#211f1c'; c.lineWidth = 2;
    c.beginPath(); c.roundRect(58, 90, 29, 29, 7); c.stroke();
    c.beginPath(); c.arc(72.5, 104.5, 7, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(80, 97, 1.8, 0, Math.PI * 2); c.fill();
    c.font = '27px Georgia, serif'; c.textBaseline = 'middle'; c.fillText('MISRAH_AE', 97, 105); c.restore();
    const alpha = c.getImageData(w / 2, h / 2, 1, 1).data[3];
    if (alpha !== 0) throw new Error('The portrait opening must be genuinely transparent.');
    // Demonstrate the overlay with the existing fictional guest composite, excluding its old print border/header.
    const preview = make(), p = preview.getContext('2d');
    p.imageSmoothingEnabled = true; p.imageSmoothingQuality = 'high';
    p.fillStyle = '#c3a57f'; p.fillRect(0, 0, w, h);
    // A smaller photo behind the oval protects the headwear from the upper frame.
    p.drawImage(photo, 83, 216, 1034, 1552, w * .09, h * .12, w * .82, h * .82);
    p.drawImage(canvas, 0, 0);
    const small = Object.assign(document.createElement('canvas'), { width: 512, height: 768 });
    small.getContext('2d').drawImage(preview, 0, 0, 512, 768);
    return { frame: canvas.toDataURL('image/png'), preview: preview.toDataURL('image/png'), small: small.toDataURL('image/png'), width: w, height: h, alpha };
  }, sources);
  for (const [key, name] of [['frame','misrah-ivory-frame.png'],['preview','pearl-diver-framed-preview.png'],['small','preview.png']]) {
    await writeFile(new URL(name, out), Buffer.from(images[key].split(',')[1], 'base64'));
  }
  await copyFile(new URL('misrah-ivory-frame.png', out), new URL('public/assets/frames/misrah-ivory-ornate-branded-v1.png', root));
  console.log(`Exported ${images.width} x ${images.height} branded PNG; centre alpha ${images.alpha}; official source logo and exact MISRAH_AE applied.`);
} finally { await browser.close(); }
