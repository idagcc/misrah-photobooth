import { faceGeometry, faceCrop, alignment, FACE_OVAL } from './geometry.js';
import { correctionFor } from './live-quality.js';
const $ = id => document.getElementById(id), canvas = (w,h) => Object.assign(document.createElement('canvas'), {width:w,height:h});
const worker = new Worker('./detector-worker.js'), jobs = new Map(); let next=0, generation=0;
let resolveReady,rejectReady;
const ready = new Promise((r,j)=>{resolveReady=r;rejectReady=j;}); ready.catch(()=>{});
const startupTimer = setTimeout(()=>rejectReady(new Error('Face detector took too long. Refresh to retry.')),45000);
worker.onmessage = ({data:d}) => {
  if(d.type==='ready'){clearTimeout(startupTimer);resolveReady();return;}
  if(d.type==='init-error'){clearTimeout(startupTimer);rejectReady(new Error(d.error));return;}
  const job=jobs.get(d.id);if(!job){d.corrected?.close();return;}jobs.delete(d.id);clearTimeout(job.timer);
  d.type==='result'?job.resolve(d):job.reject(new Error(d.error));
};
worker.onerror = () => {rejectReady(new Error('Face detector unavailable. Refresh to retry.'));for(const job of jobs.values()){clearTimeout(job.timer);job.reject(new Error('Face detector stopped.'));}jobs.clear();};
async function request(image, data={type:'detect'}) {
  await ready; const bitmap=await createImageBitmap(image);
  return new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{jobs.delete(id);reject(new Error('Processing took too long. Please retry.'));},20000);jobs.set(id,{resolve,reject,timer});worker.postMessage({...data,id,bitmap},[bitmap]);});
}
const load = async url => {const image=new Image();image.src=url;await image.decode();return image;};
const copy = bitmap => {const out=canvas(bitmap.width,bitmap.height);out.getContext('2d').drawImage(bitmap,0,0);bitmap.close();return out;};
function sample(image, points) {
  const b=faceCrop(points,image.width,image.height,.3), out=canvas(640,480),c=out.getContext('2d'),scale=Math.min(370/b.width,430/b.height);
  c.fillStyle='#ddd9ca';c.fillRect(0,0,640,480);c.drawImage(image,b.x,b.y,b.width,b.height,(640-b.width*scale)/2,(480-b.height*scale)/2,b.width*scale,b.height*scale);return out;
}
async function find(image) {
  const limit=Math.min(1,1280/Math.max(image.width,image.height)),small=canvas(Math.round(image.width*limit),Math.round(image.height*limit));small.getContext('2d').drawImage(image,0,0,small.width,small.height);
  const result=await request(small);if(result.landmarks.length!==1)throw new Error('Please choose a clear photo with exactly one face.');return result;
}
let template;
async function prepareTemplate() {
  const image=await load('./assets/frontal/frontal-weaver.png'),detected=await find(image),points=detected.landmarks[0], normalized=await find(sample(image,points));
  return {image,points,geometry:faceGeometry(points,image.width,image.height),pose:normalized.poses[0],quality:{...detected.qualities[0],styleStrength:.35}};
}
function drawFace(id,image,points) {
  const out=$(id),c=out.getContext('2d'),g=faceGeometry(points,image.width,image.height),scale=150/g.eyeDistance;
  c.clearRect(0,0,out.width,out.height);c.fillStyle='#ddd9ca';c.fillRect(0,0,out.width,out.height);c.save();c.translate(out.width/2,155);c.rotate(-g.angle);c.scale(scale,scale);c.translate(-g.anchor.x,-g.anchor.y);c.drawImage(image,0,0);c.restore();
}
function drawPortrait(id,image,points) {
  const out=$(id),c=out.getContext('2d'),t=template,g=faceGeometry(points,image.width,image.height),fit=alignment(g,t.geometry,{x:0,y:0,scale:100,rotation:0,flip:false});
  out.width=t.image.width;out.height=t.image.height;c.drawImage(t.image,0,0);
  const face=canvas(out.width,out.height),f=face.getContext('2d');f.save();f.translate(fit.x,fit.y);f.rotate(fit.angle);f.scale(fit.scale,fit.scale);f.translate(-g.anchor.x,-g.anchor.y);f.drawImage(image,0,0);f.restore();
  f.globalCompositeOperation='destination-in';f.fillStyle='white';f.beginPath();FACE_OVAL.forEach((i,j)=>{const p=t.points[i];j?f.lineTo(p.x*out.width,p.y*out.height):f.moveTo(p.x*out.width,p.y*out.height);});f.closePath();f.fill();c.drawImage(face,0,0);
}
async function show(imagePromise) {
  const token=++generation;document.body.dataset.ready='false';$('status').textContent='Preparing the comparison on this device…';
  try {
    const original=await imagePromise;await ready;template ||= await prepareTemplate();
    if(original.width*original.height>36000000)throw new Error('Choose a photo under 36 megapixels.');
    const first=await find(original),image=sample(original,first.landmarks[0]),d=await find(image);
    const toned=copy((await request(image,{type:'correct',correction:correctionFor(d.qualities[0],template.quality)})).corrected);
    const beforeMeasured=await find(toned);
    const corrected=await request(toned,{type:'pose-correct',landmarks:d.landmarks[0],pose:d.poses[0],targetPose:template.pose}),after=copy(corrected.corrected);
    const measured=await find(after);
    if(token!==generation)return;
    drawFace('before-face',toned,d.landmarks[0]);drawFace('after-face',after,corrected.landmarks);
    drawPortrait('before',toned,d.landmarks[0]);drawPortrait('after',after,corrected.landmarks);
    const angles=p=>`Estimated turn ${Math.abs(p.yaw).toFixed(1)}° · tilt ${Math.abs(p.pitch-template.pose.pitch).toFixed(1)}° from portrait`;
    $('before-angle').textContent=angles(beforeMeasured.poses[0]);$('after-angle').textContent=angles(measured.poses[0]);
    const info=corrected.poseCorrection;
    $('status').textContent=info.applied?`Correction applied after capture in ${Math.round(info.elapsed)} ms. Compare the eyes, nose and chin below.`:info.reason==='already-aligned'?'This face already matches the portrait closely. The original pixels are kept.':'Original kept. This photo needs a straighter face for a natural result.';
    // Measurements for the reproducible browser verification, never a second capture gate.
    window.poseComparison={before:beforeMeasured.poses[0],after:measured.poses[0],target:template.pose,correction:info};document.body.dataset.ready='true';
  } catch(error){if(token===generation){$('status').textContent=error.message;document.body.dataset.ready='error';}}
}
$('sample').addEventListener('change',()=>{show(load(`./assets/${$('sample').value}.png`));});
$('photo').addEventListener('change',()=>{
  const file=$('photo').files[0];if(!file)return;
  if(file.size>25*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type)){$('status').textContent='Choose a PNG, JPEG or WebP photo under 25 MB.';return;}
  const url=URL.createObjectURL(file);show(load(url).finally(()=>URL.revokeObjectURL(url)));
});
window.addEventListener('pagehide',()=>worker.terminate(),{once:true});
show(load(`./assets/${$('sample').value}.png`));
