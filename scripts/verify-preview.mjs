const {chromium}=await import(process.env.PLAYWRIGHT_PATH || 'playwright');
import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.PHOTOBOOTH_URL || 'http://127.0.0.1:8785';
const out=new URL('../../output/misrah-simple-preview/',import.meta.url).pathname;await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const result=()=>page.waitForFunction(()=>document.body.dataset.step==='result'&&!document.getElementById('print-photo').disabled,null,{timeout:60000});
const offset=async ms=>{await page.evaluate(ms=>{window.qaNow??=Date.now;Date.now=()=>window.qaNow()+ms},ms);await page.waitForTimeout(1150);};
try{
 await page.goto(`${base}/?sample=woman&camera=sample`);await result();
 assert.match(await page.locator('#finish-session').textContent(),/Next participant/);
 assert.equal(await page.locator('#finish-session').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(54, 39, 31)');
 const margins=await page.evaluate(async()=>{
  const {brandReady,brandedPortrait}=await import('./print-branding.js');const c=document.createElement('canvas'),ctx=c.getContext('2d'),draw=ctx.drawImage.bind(ctx),calls=[];ctx.drawImage=(...args)=>{calls.push(args.slice(1));draw(...args)};
  brandedPortrait(document.getElementById('portrait'),await brandReady,c);
  return {width:c.width,height:c.height,photo:calls[0],logo:calls[1]};
 });
 assert.ok(margins.logo[5]>=margins.width*.045);assert.ok(margins.logo[5]+margins.logo[7]<margins.height*.15);
 await page.screenshot({path:out+'/desktop.png'});
 const print=await page.locator('#branded-portrait').evaluate(c=>c.toDataURL('image/png'));await writeFile(out+'/finished-photo.png',Buffer.from(print.split(',')[1],'base64'));
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+'/mobile.png'});
 await offset(21000);assert.equal(await page.locator('#idle-notice').isVisible(),true);assert.equal(await page.locator('body').getAttribute('data-step'),'result');
 await page.locator('#keep-session').click();await offset(49000);assert.equal(await page.locator('body').getAttribute('data-step'),'result','Keep session restarts the 30-second timer');
 await offset(53000);await page.waitForFunction(()=>document.body.dataset.step==='welcome');assert.equal(await page.locator('#print-image').getAttribute('src'),null);
 await page.evaluate(()=>{Date.now=window.qaNow});
 await page.goto(`${base}/?sample=woman&camera=sample`);await result();
 await page.evaluate(()=>{window.printCalls=0;window.print=()=>{window.printCalls++;window.dispatchEvent(new Event('afterprint'));}});await page.locator('#print-photo').click();await page.waitForFunction(()=>window.printCalls===1);assert.equal(await page.locator('#print-image').evaluate(x=>x.naturalWidth),1600);
 await page.locator('#new-session').click();await page.waitForFunction(()=>['lights','camera'].includes(document.body.dataset.step));await result();await page.locator('#finish-session').click();await page.waitForFunction(()=>document.body.dataset.step==='welcome');
 assert.deepEqual(errors,[]);await writeFile(out+'/verification.json',JSON.stringify({logoPlacement:margins,nextParticipantProminent:true,idleResetSeconds:30,idleWarning:true,keepSessionRestarts:true,print:true,retake:true,nextParticipant:true,mobileOverflow:false,errors},null,2));console.log('PASS logo safe margin, prominent Next participant, 30-second result idle reset, keep-session extension, print, retake and session clearing');
}finally{await browser.close()}
