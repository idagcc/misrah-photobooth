export function isAdminShortcut(event) {
  if (event.repeat) return false;
  return event.code === 'F2' || ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyA');
}
