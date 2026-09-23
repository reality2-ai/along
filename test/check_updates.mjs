import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));let version=7,htmlVersion=null;
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){res.writeHead(404);res.end('{}');return;}
  const file=path.startsWith('/data/')?root+path:root+'/public'+(path==='/'?'/index.html':path);
  let body=await readFile(file);
  if(path==='/sw.js'){
   let script=body.toString().replace(/along-shell-v\d+/, `along-shell-v${version}`);
   if(version===7)script=script.replace(/self.addEventListener\('message',[\s\S]*?\n\}\);/,'');
   body=Buffer.from(script);
  }
  if(path==='/')body=Buffer.from(body.toString().replace(/App version \d+/, `App version ${htmlVersion??version}`));
  res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.gz')?'application/gzip':path.endsWith('.png')?'image/png':path.endsWith('.svg')?'image/svg+xml':path.endsWith('webmanifest')?'application/manifest+json':'text/html','Cache-Control':path==='/sw.js'?'no-store':'public, max-age=600'});res.end(body);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true});
try{
 const context=await browser.newContext();const old=await context.newPage();
 await old.goto(origin+'/update.html');
 await old.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js',{type:'module'});await navigator.serviceWorker.ready;localStorage.setItem('update-check','saved');await new Promise((resolve,reject)=>{const r=indexedDB.open('update-check',1);r.onupgradeneeded=()=>r.result.createObjectStore('saved');r.onsuccess=()=>{r.result.close();resolve();};r.onerror=reject;});});
 version=8;
 const page=await context.newPage();await page.goto(origin+'/update.html');await page.locator('#recover-update').click();
 await page.waitForFunction(()=>document.getElementById('recovery-status').textContent==='Updated to version 8.',{timeout:45000});
 await page.locator('#recover-update').click();
 await page.waitForURL(origin+'/?updated=8',{timeout:45000});
 const current=await context.newPage();await current.goto(origin+'/update.html');await current.locator('#recover-update').click();
 await current.waitForFunction(()=>document.getElementById('recovery-status').textContent==='Already up to date — version 8.');
 assert.equal(await current.locator('#recover-update').textContent(),'Open Along →');await current.close();
 assert.match(await page.locator('#settings').textContent(),/App version 8/);
 assert.equal(await page.evaluate(()=>localStorage.getItem('update-check')),'saved');
 assert.equal(await page.evaluate(async()=>(await indexedDB.databases()).some(d=>d.name==='update-check')),true);
 const held=await context.newPage();await held.goto(origin+'/');
 assert.match(await held.locator('#settings').textContent(),/App version 8/);
 version=9;
 await page.evaluate(()=>{
  for(const [type,y] of [['touchstart',20],['touchmove',140],['touchend',140]]){
   const event=new Event(type,{bubbles:true});
   Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[{identifier:1,clientX:100,clientY:y}]});
   document.body.dispatchEvent(event);
  }
 });
 await page.locator('#app-update').waitFor({state:'visible',timeout:30000});
 await page.locator('#apply-update').click();
 await page.waitForFunction(()=>document.querySelector('#settings')?.textContent.includes('App version 9'),{timeout:30000});
 await held.locator('#app-update').waitFor({state:'visible',timeout:10000});
 await held.locator('#apply-update').click();
 await held.waitForFunction(()=>document.querySelector('#settings')?.textContent.includes('App version 9'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('update-check')),'saved');
 await context.setOffline(true);
 await page.reload();
 assert.match(await page.locator('#settings').textContent(),/App version 9/);
 await page.evaluate(()=>{
  document.getElementById('announcement').textContent='Offline journey remains available.';
  for(const [type,y] of [['touchstart',20],['touchmove',140],['touchend',140]]){
   const event=new Event(type,{bubbles:true});
   Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[{identifier:1,clientX:100,clientY:y}]});
   document.body.dispatchEvent(event);
  }
 });
 assert.equal(await page.locator('#announcement').textContent(),'Offline journey remains available.');
 // A deployment serving mismatched HTML must leave the working shell intact.
 version=10;htmlVersion=9;
 await context.setOffline(false);
 const rejected=await page.evaluate(async()=>{
  const registration=await navigator.serviceWorker.ready;
  await registration.update();
  const worker=registration.installing;
  if(worker)await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('Mismatched update did not settle')),15000);
   const changed=()=>{if(['redundant','installed'].includes(worker.state)){clearTimeout(timeout);worker.removeEventListener('statechange',changed);resolve();}};
   worker.addEventListener('statechange',changed);changed();
  });
  return {state:worker?.state,waiting:!!registration.waiting,caches:await caches.keys()};
 });
 assert.equal(rejected.waiting,false);
 assert.equal(rejected.caches.includes('along-shell-v10'),false);
 assert.equal(rejected.caches.includes('along-shell-v9'),true);
 await context.setOffline(true);await page.reload();
 assert.match(await page.locator('#settings').textContent(),/App version 9/);
 assert.equal(await page.evaluate(()=>localStorage.getItem('update-check')),'saved');
 // A standalone recovery page uses stored language, and remains functional
 // when the optional translation module cannot load in the document.
 version=11;htmlVersion=null;
 const bilingual=await browser.newContext();
 await bilingual.addInitScript(()=>localStorage.setItem('along-language-v1','mi'));
 const reo=await bilingual.newPage();await reo.goto(origin+'/update.html');
 await reo.waitForFunction(()=>document.querySelector('h1').textContent==='Whakahoutia a Along');
 assert.equal(await reo.locator('#recovery-draft').isVisible(),true);
 await reo.locator('#recover-update').click();
 await reo.waitForFunction(()=>document.getElementById('recovery-status').textContent==='Kua tāutahia te putanga 11.',{timeout:45000});
 assert.equal(await reo.locator('#recover-update').textContent(),'Huakina a Along →');
 await bilingual.close();
 const fallback=await browser.newContext();
 await fallback.route('**/i18n.js',route=>route.request().resourceType()==='script'?route.abort():route.continue());
 const rescue=await fallback.newPage();await rescue.goto(origin+'/update.html');
 await rescue.locator('#recover-update').click();
 await rescue.waitForFunction(()=>document.getElementById('recovery-status').textContent==='Installed version 11.',{timeout:45000});
 assert.equal(await rescue.locator('#recover-update').textContent(),'Open Along →');
 await fallback.close();
 console.log('PASS: Māori recovery uses stored language; missing document translation module leaves English recovery operational.');
 console.log('PASS: ten-minute HTTP cache cannot contaminate new shell; mismatched deployment keeps old offline app; old app held open; recovery activates new version; saved localStorage and IndexedDB retained; offline pull stays silent; pull-to-refresh finds new release; stale open window offers reload; update-confirmation URL reopens offline.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
