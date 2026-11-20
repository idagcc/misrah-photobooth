// Installed in both documents: browser gestures inside an iframe do not bubble
// to its parent. Keep this limited to the fixed landscape booth.
export function lockBoothViewport(view) {
  const doc = view.document;
  if (doc.documentElement.classList.contains('booth-locked')) return;
  doc.documentElement.classList.add('booth-locked');
  const cancel = event => event.preventDefault();
  const inAdmin = target => target?.closest?.('#admin-dialog[open]');
  doc.addEventListener('contextmenu', cancel, { capture: true });
  doc.addEventListener('dragstart', cancel, { capture: true });
  doc.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey || !inAdmin(event.target)) cancel(event);
  }, { passive: false, capture: true });
  doc.addEventListener('touchmove', event => {
    if (event.touches.length > 1 || !inAdmin(event.target)) cancel(event);
  }, { passive: false, capture: true });
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    doc.addEventListener(name, cancel, { passive: false, capture: true });
  }
  doc.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0', 'Add', 'Subtract'].includes(event.key)) cancel(event);
  }, { capture: true });
}
