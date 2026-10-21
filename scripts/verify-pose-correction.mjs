// Real local model + actual worker, studio compositor and guest capture pipeline.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_PATH||'playwright');
const base=process.env.PHOTOBOOTH_URL||'http://127.0.0.1:8770',qa=new URL('../qa/',import.meta.url).pathname;
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1200,height:1100}}),page=await context.newPage(),errors=[],samples=[];
page.on('pageerror',e=>errors.push(e.message));
const complete=async()=>{await page.waitForFunction(()=>document.body.dataset.ready==='true'||document.body.dataset.ready==='error',null,{timeout:60000});assert.equal(await page.locator('body').getAttribute('data-ready'),'true',await page.locator('#status').innerText());};
try {
  await page.goto(`${base}/pose-demo.html`);await complete();
  for(const name of ['misrah-2','misrah-1','frontal/frontal-guest-woman','frontal/frontal-guest-man','frontal/frontal-guest-bearded']) {
    if(name!=='misrah-2'){await page.locator('#sample').selectOption(name);await complete();}
    const result=await page.evaluate(()=>window.poseComparison);samples.push({name,...result});
    if(name.startsWith('misrah')) {
      assert.equal(result.correction.applied,true,name);
      assert.ok(Math.abs(result.after.yaw-result.target.yaw)<Math.abs(result.before.yaw-result.target.yaw)-1,`${name}: head turn should improve`);
      assert.ok(Math.abs(result.after.pitch-result.target.pitch)<Math.abs(result.before.pitch-result.target.pitch)+2,`${name}: avoid worsening pitch`);
      await page.screenshot({path:`${qa}pose-correction-${name==='misrah-2'?'weaver':'trader'}.png`,fullPage:true});
    }
    assert.ok(result.correction.elapsed<1000,'Bounded still processing on the QA host');
  }
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${qa}pose-correction-mobile.png`,fullPage:true});
  await page.setViewportSize({width:1440,height:1080});
  await page.addInitScript(()=>{
    window.poseQA={requests:[],results:[],fail:false,delay:0};const Original=Worker;
    window.Worker=class extends Original {
      constructor(...args){super(...args);this.addEventListener('message',({data:d})=>{if(d.poseCorrection)window.poseQA.results.push(d.poseCorrection);});}
      postMessage(message,...args){
        if(message.type!=='pose-correct')return super.postMessage(message,...args);
        const q=window.poseQA;q.requests.push({width:message.bitmap.width,height:message.bitmap.height});
        if(q.fail){message.bitmap.close();queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:{type:'error',id:message.id,error:'QA correction unavailable'}})));return;}
        if(q.delay){setTimeout(()=>super.postMessage(message,...args),q.delay);return;}
        return super.postMessage(message,...args);
      }
    };
  });
  await page.goto(`${base}/studio.html`);await page.waitForFunction(()=>document.getElementById('model-status').textContent.includes('ready'),null,{timeout:60000});
  await page.locator('#frontal-weaver').click();
  await page.locator('#photo-upload').setInputFiles(new URL('../public/assets/misrah-2.png',import.meta.url).pathname);
  await page.waitForFunction(()=>!document.getElementById('download').disabled&&document.getElementById('busy').hidden);
  const pixels=()=>page.locator('#portrait').evaluate(c=>c.toDataURL());
  const original=await pixels();assert.equal(await page.evaluate(()=>window.poseQA.requests.length),0,'Ordinary links leave pose correction off');
  await page.locator('#pose-correction').check();await page.waitForFunction(()=>document.getElementById('pose-correction-info').textContent.includes('adjusted'));
  const adjusted=await pixels();assert.notEqual(adjusted,original,'Pose correction must reach the actual compositor');
  await page.screenshot({path:`${qa}pose-correction-studio.png`});
  await page.locator('#pose-correction').uncheck();await page.waitForFunction(()=>!document.getElementById('download').disabled);assert.equal(await pixels(),original,'Turning it off must restore exactly the original fit');
  await page.evaluate(()=>{window.poseQA.fail=true;});await page.locator('#pose-correction').check();await page.waitForFunction(()=>document.getElementById('pose-correction-info').textContent.includes('unavailable'));
  assert.equal(await pixels(),original,'A failed correction retains the usable original');
  await page.locator('#pose-correction').uncheck();await page.waitForFunction(()=>!document.getElementById('download').disabled);
  const count=await page.evaluate(()=>window.poseQA.requests.length);await page.evaluate(()=>Object.assign(window.poseQA,{fail:false,delay:300}));
  await page.locator('#pose-correction').check();await page.waitForFunction(n=>window.poseQA.requests.length>n,count);await page.locator('#pose-correction').uncheck();await page.waitForFunction(()=>!document.getElementById('download').disabled);await page.waitForTimeout(400);
  assert.equal(await pixels(),original,'A stale correction cannot overwrite a later toggle');
  // A genuine model capture still shows 3, 2, 1 and closes before the still warp.
  await page.goto(`${base}/?camera=sample&pose=correct`);await page.waitForFunction(()=>!document.getElementById('touch-start').disabled,null,{timeout:60000});
  assert.equal(await page.locator('#pose-correction').isChecked(),true);
  await page.evaluate(()=>{window.numbers=[];new MutationObserver(()=>{const e=document.getElementById('capture-countdown');if(!e.hidden&&window.numbers.at(-1)!==e.textContent)window.numbers.push(e.textContent);}).observe(document.getElementById('capture-countdown'),{childList:true,attributes:true,attributeFilter:['hidden']});});
  await page.locator('#touch-start').click();await page.locator('#frontal-weaver').click();await page.waitForFunction(()=>document.body.dataset.step==='result',null,{timeout:45000});
  const guest=await page.evaluate(()=>({numbers:window.numbers,requests:window.poseQA.requests,results:window.poseQA.results,stopped:document.getElementById('camera-video').srcObject===null}));
  assert.deepEqual(guest.numbers,['3','2','1']);assert.equal(guest.requests.length,1);assert.equal(guest.stopped,true);assert.equal(await page.locator('#download').isEnabled(),true);
  await page.screenshot({path:`${qa}pose-correction-guest.png`});
  // Native 4K acquisition, using the same synthetic source as the 30 fps benchmark.
  await page.evaluate(()=>{
    window.poseQA.requests=[];window.poseQA.results=[];
    const original=HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream=function(rate){
      if(this.width!==640||this.height!==480)return original.call(this,rate);
      const large=document.createElement('canvas');large.width=3840;large.height=2160;const c=large.getContext('2d');
      c.fillStyle='#ddd9ca';c.fillRect(0,0,3840,2160);c.drawImage(this,480,0,2880,2160);
      let tick=0;const timer=setInterval(()=>{c.fillStyle=tick++%2?'#ddd9ca':'#dcd8c9';c.fillRect(0,0,1,1);},1000/30),stream=original.call(large,30);
      const track=stream.getVideoTracks()[0],stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};return stream;
    };
  });
  await page.locator('#new-session').click();await page.waitForFunction(()=>document.body.dataset.step==='result',null,{timeout:45000});
  const native4k=await page.evaluate(()=>({requests:window.poseQA.requests,results:window.poseQA.results,stopped:document.getElementById('camera-video').srcObject===null}));
  assert.equal(native4k.requests.length,1);assert.ok(native4k.requests[0].width>1000);assert.equal(native4k.stopped,true);assert.equal(native4k.results[0].applied,true);
  assert.deepEqual(errors,[]);await writeFile(`${qa}pose-correction.json`,JSON.stringify({samples,guest,native4k,studio:{changed:true,undoExact:true,failureFallback:true,staleIgnored:true},errors},null,2));
  console.log('PASS measured pose improvement, all five samples, mobile layout, actual compositor, exact undo, worker failure fallback, stale result protection, opt-in guest capture and 3 → 2 → 1.');
}finally{await browser.close();}
