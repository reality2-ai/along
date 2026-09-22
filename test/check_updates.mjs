import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));let version=7;
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
  if(path==='/')body=Buffer.from(body.toString().replace(/App version \d+/, `App version ${version}`));
  res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.gz')?'application/gzip':path.endsWith('.png')?'image/png':path.endsWith('.svg')?'image/svg+xml':path.endsWith('webmanifest')?'application/manifest+json':'text/html','Cache-Control':'no-store'});res.end(body);
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
 console.log('PASS: old app held open; recovery activates new version; saved localStorage and IndexedDB retained; offline pull stays silent; pull-to-refresh finds new release; stale open window offers reload; update-confirmation URL reopens offline.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
