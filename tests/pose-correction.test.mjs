import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { poseWarp, faceTriangles, correctionWeights, safeWarp, warpFacePixels } from '../public/pose-correction.js';
import { faceGeometry, faceCrop, landmarksForCrop, FACE_OVAL } from '../public/geometry.js';

const triangles=faceTriangles(FaceLandmarker.FACE_LANDMARKS_TESSELATION);
function fixture(yaw=12,pitch=8) {
  const points=Array.from({length:478},()=>[0,-30,0]);
  points[33]=points[133]=[-100,0,20];points[362]=points[263]=[100,0,20];
  points[1]=[0,-65,90];points[234]=[-160,-80,-15];points[454]=[160,-80,-15];points[10]=[0,100,-15];points[152]=[0,-220,-10];
  const [y,p]=[yaw,pitch].map(v=>v*Math.PI/180);
  return points.map(([x,y0,z])=>{const yp=y0*Math.cos(p)-z*Math.sin(p),zp=y0*Math.sin(p)+z*Math.cos(p);
    return {x:(500+x*Math.cos(y)+zp*Math.sin(y))/1000,y:(350-yp)/800,z:(x*Math.sin(y)-zp*Math.cos(y))/1000};});
}
test('inverse pose reprojection recentres the nose for left and right turns while retaining the eye fit',()=>{
  for(const yaw of [-12,12]) {
    const points=fixture(yaw),before=faceGeometry(points,1000,800),warp=poseWarp(points,1000,800,{yaw,pitch:8,roll:0},{yaw:0,pitch:0,roll:0},1),after=faceGeometry(warp.landmarks,1000,800);
    assert.equal(warp.applied,true);assert.ok(Math.abs(before.eyeDistance-after.eyeDistance)<1e-8);
    assert.ok(Math.abs(before.angle-after.angle)<1e-8);assert.ok(Math.abs(before.anchor.x-after.anchor.x)<1e-8);
    const nose=warp.target[1],dx=nose.x-after.anchor.x,dy=nose.y-after.anchor.y;
    assert.ok(Math.abs(dx*Math.cos(after.angle)+dy*Math.sin(after.angle))<1e-8);
    assert.ok(Math.abs((-dx*Math.sin(after.angle)+dy*Math.cos(after.angle))/after.eyeDistance-65/200)<1e-8);
  }
});
test('pose correction is invariant to the native face crop and its depth remapping',()=>{
  const points=fixture(),pose={yaw:12,pitch:8,roll:0},target={yaw:0,pitch:0,roll:0};
  const crop=faceCrop(points,1000,800),full=poseWarp(points,1000,800,pose,target),cropped=poseWarp(landmarksForCrop(points,1000,800,crop),crop.width,crop.height,pose,target);
  full.target.forEach((p,i)=>{assert.ok(Math.abs(p.x-crop.x-cropped.target[i].x)<1e-8);assert.ok(Math.abs(p.y-crop.y-cropped.target[i].y)<1e-8);});
});
test('front-facing, missing, nonfinite and large-turn inputs keep their original landmarks',()=>{
  const points=fixture(0,0),front={yaw:0,pitch:0,roll:0};
  for(const [p,s,t] of [[points,front,front],[[],front,front],[points,null,front],[points,{...front,yaw:40},front],[points,front,{...front,pitch:30}],[points,{...front,yaw:NaN},front]]) {
    const result=poseWarp(p,1000,800,s,t);assert.equal(result.applied,false);assert.equal(result.landmarks,p);
  }
  assert.equal(poseWarp(points,1000,800,{yaw:20,pitch:20,roll:0},front,1).yaw,-14);
});
test('bundled tessellation includes eye and lip interiors, without invalid vertex indices',()=>{
  assert.equal(triangles.length,898);assert.ok(triangles.flat().every(i=>Number.isInteger(i)&&i>=0&&i<468));
  assert.ok(triangles.some(t=>t.join(',')==='33,7,163'));assert.ok(triangles.some(t=>t.join(',')==='78,95,88'));
});
test('correction preserves the silhouette and tapers smoothly toward the inner features',()=>{
  const weights=correctionWeights(triangles);assert.equal(weights.length,468);
  for(const i of FACE_OVAL)assert.equal(weights[i],0);
  assert.equal(weights[1],1);assert.ok(weights.every(w=>w>=0&&w<=1));
  const points=fixture(),warp=poseWarp(points,1000,800,{yaw:12,pitch:8,roll:0},{yaw:0,pitch:0,roll:0},.85,weights);
  for(const i of FACE_OVAL)assert.deepEqual(warp.target[i],warp.source[i]);
});
test('unsafe folded surfaces are rejected before sampling',()=>{
  const source=[{x:0,y:0},{x:10,y:0},{x:0,y:10}],surface=Array.from({length:850},()=>[0,1,2]);
  assert.equal(safeWarp({applied:true,source,target:source},surface),true);
  assert.equal(safeWarp({applied:true,source,target:[source[0],source[2],source[1]]},surface),false);
  assert.equal(safeWarp({applied:true,source,target:source.map(p=>({...p,x:p.x*10}))},surface),false);
});
test('inverse texture sampling preserves an identity image, alpha and shared triangle edges',()=>{
  const width=12,height=12,pixels=Uint8ClampedArray.from({length:width*height*4},(_,i)=>(i*37)%256),positions=[{x:0,y:0},{x:12,y:0},{x:12,y:12},{x:0,y:12}];
  // Supply a contour for the same full image; no feather can alter an identity sample.
  const p=Array.from({length:478},()=>({x:0,y:0}));[0,1,2,3].forEach(i=>p[i]=positions[i]);
  const out=warpFacePixels(pixels,width,height,{source:p,target:p},[[0,1,2],[0,2,3]]);
  assert.deepEqual(out,pixels);assert.notEqual(out,pixels);
  assert.equal(safeWarp({applied:false},triangles),false);
});
