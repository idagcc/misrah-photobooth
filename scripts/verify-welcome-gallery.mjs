import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.PHOTOBOOTH_URL || 'http://127.0.0.1:8784';
const out = new URL('../qa/v0.13/', import.meta.url); await mkdir(out, { recursive:true });
const browser = await chromium.launch({ channel:'chrome', headless:true });
const page = await browser.newPage({ viewport:{width:1440,height:1080} }), errors=[];
page.on('pageerror', error => errors.push(error.message));
const boot = async () => { await page.goto(base); await page.waitForFunction(() => !document.getElementById('touch-start').disabled, null, { timeout:60000 }); };
const caption = () => page.locator('#welcome-portrait-name').textContent();
try {
  await boot();
  assert.equal(await page.locator('#welcome-portrait-dots button').count(),2);
  const first = await caption(), bounds = await page.locator('.welcome-photo').boundingBox();
  await page.screenshot({ path:new URL('welcome-first.png',out).pathname });
  await page.waitForFunction(first => document.getElementById('welcome-portrait-name').textContent !== first, first, {timeout:8000});
  const second = await caption(), nextBounds=await page.locator('.welcome-photo').boundingBox();
  assert.ok(Math.abs(bounds.height-nextBounds.height)<1 && Math.abs(bounds.width-nextBounds.width)<1, 'Rotation must not shift the layout');
  await page.waitForTimeout(450); await page.screenshot({ path:new URL('welcome-second.png',out).pathname });
  await page.locator('#welcome-gallery-pause').click(); const stopped=await caption();
  await page.mouse.move(0,0); await page.locator('#touch-start').focus();
  await page.waitForTimeout(4400); assert.equal(await caption(),stopped);
  await page.locator('#welcome-portrait-dots button').first().click();
  await page.waitForFunction(first=>document.getElementById('welcome-portrait-name').textContent===first,first);
  await page.locator('#welcome-gallery-pause').click();
  await page.mouse.move(0,0); await page.locator('#touch-start').focus();
  await page.waitForFunction(first=>document.getElementById('welcome-portrait-name').textContent!==first,first,{timeout:8000});
  await page.locator('#touch-start').click(); const hiddenCaption=await caption();
  await page.waitForTimeout(4400); assert.equal(await caption(),hiddenCaption,'Rotation stops after the guest starts');
  await page.emulateMedia({ reducedMotion:'reduce' }); await boot(); const reduced=await caption();
  assert.equal(await page.locator('#welcome-gallery-pause').textContent(),'Play previews');
  await page.waitForTimeout(4400); assert.equal(await caption(),reduced);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:new URL('welcome-mobile.png',out).pathname});
  const cfg=await (await fetch(`${base}/api/bootstrap`)).json();
  const toggle=async active=>fetch(`${base}/api/templates/toggle`,{method:'POST',headers:{'Content-Type':'application/json','X-Booth-Token':cfg.token},body:JSON.stringify({id:'misrah-falconer',active})});
  assert.equal((await toggle(false)).status,200);
  try {
    await boot(); assert.equal(await caption(),'The palm weaver');
    assert.equal(await page.locator('#welcome-gallery-controls').isHidden(),true);
    assert.equal(await page.locator('#welcome-portrait-dots button').count(),1);
  } finally { assert.equal((await toggle(true)).status,200); }
  assert.deepEqual(errors,[]);
  await writeFile(new URL('welcome-verification.json',out),JSON.stringify({first,second,rotation:true,layoutStable:true,
    pauseResume:true,manualSelection:true,stopsAfterStart:true,reducedMotion:true,hiddenPortraitExcluded:true,mobileOverflow:false,errors},null,2));
  console.log('PASS welcome rotation, portrait names, stable layout, pause/resume, manual selection, stopping off welcome, reduced motion, active library filtering and mobile layout.');
} finally { await browser.close(); }
