// A fixed monochrome film texture shared by the preview, archive, save and print.
// Cache one small tile so face adjustments never flicker or process millions of pixels.
let tile;
export function applyPhotoGrain(context, width, height) {
  if (!tile) {
    tile = document.createElement('canvas'); tile.width = tile.height = 256;
    const c = tile.getContext('2d'), pixels = c.createImageData(256, 256);
    let seed = 827;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const value = 64 + (seed >>> 25);
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      pixels.data[i + 3] = 255;
    }
    c.putImageData(pixels, 0, 0);
  }
  context.save(); context.globalCompositeOperation = 'soft-light'; context.globalAlpha = .16;
  context.fillStyle = context.createPattern(tile, 'repeat'); context.fillRect(0, 0, width, height);
  context.restore();
}
