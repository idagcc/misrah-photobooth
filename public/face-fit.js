export const MIN_FACE_ZOOM = 75;
export const MAX_FACE_ZOOM = 115;
export const defaultPortraitZoom = id => id === 'misrah-falconer' ? 92 : 100;

export function portraitZoom(settings, id) {
  const zoom = settings?.portraitZoom?.[id];
  return Number.isInteger(zoom) && zoom >= MIN_FACE_ZOOM && zoom <= MAX_FACE_ZOOM ? zoom : defaultPortraitZoom(id);
}

// Zoom around the eye midpoint: the face stays centred and never stretches.
export function withPortraitZoom(settings, zoom) {
  return { ...settings, scale: settings.scale * zoom / 100 };
}
