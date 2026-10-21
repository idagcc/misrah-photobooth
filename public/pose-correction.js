// Still-photo experiment: reproject this person's measured surface, then sample
// their original pixels. No template facial features or generated pixels are used.
import { clamp, faceGeometry, FACE_OVAL } from './geometry.js';

const rad = n => n * Math.PI / 180;
const validPose = p => p && ['yaw', 'pitch', 'roll'].every(k => Number.isFinite(p[k]));
const mul = (a, b) => a.map(row => b[0].map((_, j) => row.reduce((v, x, k) => v + x * b[k][j], 0)));
const transpose = a => a[0].map((_, j) => a.map(row => row[j]));
const rotate = (m, p) => m.map(row => row.reduce((v, x, i) => v + x * p[i], 0));
function rotation({ yaw, pitch, roll }) {
  const [x, y, z] = [pitch, yaw, roll].map(rad), [cx, cy, cz] = [x, y, z].map(Math.cos), [sx, sy, sz] = [x, y, z].map(Math.sin);
  return mul(mul([[cz,-sz,0],[sz,cz,0],[0,0,1]], [[cy,0,sy],[0,1,0],[-sy,0,cy]]), [[1,0,0],[0,cx,-sx],[0,sx,cx]]);
}

export function poseWarp(points, width, height, sourcePose, targetPose, strength = .85, weights = null) {
  const skip = reason => ({ applied: false, reason, landmarks: points });
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      !points || points.length < 468 || points.some(p => ![p.x,p.y,p.z].every(Number.isFinite)) ||
      !validPose(sourcePose) || !validPose(targetPose) || !Number.isFinite(strength)) return skip('missing-data');
  // Weak-perspective depth is approximate; don't try to invent an occluded cheek.
  if (Math.abs(sourcePose.yaw) > 25 || Math.abs(sourcePose.pitch) > 25 ||
      Math.abs(targetPose.yaw) > 20 || Math.abs(targetPose.pitch) > 22) return skip('large-turn');
  const amount = clamp(strength, 0, 1), yaw = clamp(targetPose.yaw - sourcePose.yaw, -14, 14) * amount,
    pitch = clamp(targetPose.pitch - sourcePose.pitch, -12, 12) * amount;
  if (Math.hypot(yaw, pitch) < 1.5) return skip('already-aligned');
  const geometry = faceGeometry(points, width, height);
  if (geometry.eyeDistance < 5) return skip('missing-data');
  const depth = [33,133,362,263].reduce((n, i) => n + points[i].z * width / 4, 0);
  const desired = { yaw: sourcePose.yaw + yaw, pitch: sourcePose.pitch + pitch, roll: sourcePose.roll };
  const correction = mul(rotation(desired), transpose(rotation(sourcePose)));
  const source = points.map(p => ({ x: p.x * width, y: p.y * height }));
  let target = points.map(p => {
    // Screen Y points down and depth points away; the pose matrix uses Y up, Z toward the camera.
    const [x, y] = rotate(correction, [p.x * width - geometry.anchor.x, geometry.anchor.y - p.y * height, depth - p.z * width]);
    return { x: x + geometry.anchor.x, y: geometry.anchor.y - y };
  });
  // Leave roll, translation and eye spacing to the existing final alignment.
  const projected = faceGeometry(target.map(p => ({ x: p.x / width, y: p.y / height })), width, height);
  const scale = geometry.eyeDistance / projected.eyeDistance, angle = geometry.angle - projected.angle;
  if (!Number.isFinite(scale) || scale < .8 || scale > 1.25) return skip('unstable-depth');
  target = target.map(p => {
    const x = (p.x - projected.anchor.x) * scale, y = (p.y - projected.anchor.y) * scale;
    return { x: geometry.anchor.x + x * Math.cos(angle) - y * Math.sin(angle), y: geometry.anchor.y + x * Math.sin(angle) + y * Math.cos(angle) };
  });
  // Pin the silhouette and ease into the correction across several mesh rings.
  // The sides have unreliable depth where the cheek turns out of camera view.
  if (weights) target = target.map((p,i) => ({ x: source[i].x + (p.x-source[i].x)*(weights[i] ?? 1),
    y: source[i].y + (p.y-source[i].y)*(weights[i] ?? 1) }));
  return { applied: true, reason: 'corrected', source, target, yaw, pitch,
    landmarks: target.map((p, i) => ({ ...points[i], x: p.x / width, y: p.y / height })) };
}

export function faceTriangles(connections) {
  const triangles = [];
  for (let i = 0; i + 2 < connections.length; i += 3) {
    const [a,b,c] = connections.slice(i, i + 3);
    if (a.end === b.start && b.end === c.start && c.end === a.start) triangles.push([a.start,a.end,b.end]);
  }
  // MediaPipe's surface leaves eyes and inner lips open. Texture those openings
  // too, so the pupils and teeth move with their surrounding facial features.
  for (const loop of [
    [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],
    [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466],
    [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191]
  ]) for (let i = 1; i < loop.length - 1; i++) triangles.push([loop[0],loop[i],loop[i+1]]);
  return triangles;
}

const area = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
export function correctionWeights(triangles) {
  const neighbours = Array.from({length:468},()=>new Set()),distance=Array(468).fill(Infinity),queue=[...FACE_OVAL];
  for(const t of triangles) for(const a of t) for(const b of t) if(a!==b)neighbours[a].add(b);
  for(const i of queue)distance[i]=0;
  for(let j=0;j<queue.length;j++)for(const next of neighbours[queue[j]])if(distance[next]>distance[queue[j]]+1){distance[next]=distance[queue[j]]+1;queue.push(next);}
  return distance.map(d=>{const t=clamp(d/5,0,1);return t*t*(3-2*t);});
}
export function safeWarp(warp, triangles) {
  if (!warp.applied || triangles.length < 800) return false;
  let total=0,unstable=0;
  for(const t of triangles) {
    const a = area(...t.map(i => warp.source[i])), b = area(...t.map(i => warp.target[i]));
    if(!Number.isFinite(a)||!Number.isFinite(b))return false;
    total+=Math.abs(a);
    if(Math.abs(a)>.1 && (a*b<=0 || Math.abs(b/a)<.2 || Math.abs(b/a)>5)) unstable+=Math.max(Math.abs(a),Math.abs(b));
  }
  // Tiny nearly edge-on triangles can reverse at the cheek even in the input.
  // Reject corrections with a material unstable area, rather than a single sliver.
  return total>0 && unstable/total<.005;
}

export function warpFacePixels(input, width, height, warp, triangles) {
  const output = new Uint8ClampedArray(input);
  // Inverse rasterisation samples each destination pixel once per triangle.
  // Shared vertex coordinates prevent the hairline gaps of canvas clipping.
  for (const indices of triangles) {
    const [a,b,c] = indices.map(i => warp.target[i]), [sa,sb,sc] = indices.map(i => warp.source[i]);
    const d = area(a,b,c); if (Math.abs(d) < 1e-6) continue;
    const left = Math.max(0, Math.floor(Math.min(a.x,b.x,c.x))), right = Math.min(width-1, Math.ceil(Math.max(a.x,b.x,c.x))),
      top = Math.max(0, Math.floor(Math.min(a.y,b.y,c.y))), bottom = Math.min(height-1, Math.ceil(Math.max(a.y,b.y,c.y)));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const p = { x:x+.5, y:y+.5 }, u = area(p,b,c)/d, v = area(a,p,c)/d, w = 1-u-v;
      if (Math.min(u,v,w) < -1e-7) continue;
      const sx = clamp(u*sa.x+v*sb.x+w*sc.x-.5,0,width-1), sy = clamp(u*sa.y+v*sb.y+w*sc.y-.5,0,height-1),
        ix = Math.floor(sx), iy = Math.floor(sy), fx = sx-ix, fy = sy-iy,
        p00 = (iy*width+ix)*4, p10 = (iy*width+Math.min(width-1,ix+1))*4,
        p01 = (Math.min(height-1,iy+1)*width+ix)*4, p11 = (Math.min(height-1,iy+1)*width+Math.min(width-1,ix+1))*4,
        dest = (y*width+x)*4;
      for (let k=0;k<4;k++) output[dest+k] = (input[p00+k]*(1-fx)+input[p10+k]*fx)*(1-fy)+(input[p01+k]*(1-fx)+input[p11+k]*fx)*fy;
    }
  }
  return output;
}
