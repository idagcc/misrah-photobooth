// Display-only smoothing. Capture always uses the untouched current landmarks.
export function updateFaceMap(state, faces, now) {
  if (!faces.length) return { faces: now - (state.lastSeenAt ?? -Infinity) <= 150 ? state.faces : [], fading: true };
  let displayed = faces;
  if (faces.length === 1 && state.faces?.length === 1 && now - state.lastSeenAt < 250) {
    const current = faces[0], previous = state.faces[0];
    const jump = Math.hypot(current[1].x - previous[1].x, current[1].y - previous[1].y);
    if (current.length === previous.length && jump < .12) {
      const alpha = Math.max(.12, 1 - Math.exp(-(now - state.at) / 75));
      displayed = [current.map((p, i) => ({ ...p,
        x: previous[i].x + (p.x - previous[i].x) * alpha,
        y: previous[i].y + (p.y - previous[i].y) * alpha }))];
    }
  }
  state.faces = displayed; state.at = now; state.lastSeenAt = now;
  return { faces: displayed, fading: false };
}
