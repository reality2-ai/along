// Real IndexedDB handles in separate page realms; no shared in-memory limiter.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium}=await import('@playwright/test');
const source=await readFile(new URL('./origin-pacing.mjs',import.meta.url));
if(process.env.REGULAR_CANDIDATE==='1')assert.deepEqual(source,await readFile(new URL('../../releases/along-regular-upgrade-candidate/experiments/r2-current/origin-pacing.mjs',import.meta.url)));
const storage=await readFile(join(process.env.R2_BROWSER_DIR,'storage.mjs'));
const server=createServer((req,res)=>{
  const body=req.url==='/origin-pacing.mjs'?source:req.url==='/storage.mjs'?storage:undefined;
  res.setHeader('Content-Type',body?'text/javascript':'text/html');
  res.end(body??'<!doctype html><title>Pacing fixture</title>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  const context=await browser.newContext();
  const open=async()=>{
    const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
    await page.evaluate(async()=>{
      window.paceTime=100000;
      window.store=await(await import('./storage.mjs')).openBrowserStorage('relay-pacing-browser-check');
      window.pacer=await(await import('./origin-pacing.mjs')).createOriginPacer({store,endpoint:'wss://synthetic.test/r2',
        origin:new Uint8Array(8).fill(9),window:{frames:56,ms:10000},now:()=>paceTime});
    });return page;
  };
  const a=await open(),b=await open();
  const results=await Promise.all([a,b].map(p=>p.evaluate(async()=>{const results=[];for(let i=0;i<40;i++)results.push(await pacer.reserve());return results;})));
  let admitted=results.flat().filter(x=>x===0).length;
  assert.ok(admitted>0&&admitted<=56);
  while(admitted<56){assert.equal(await a.evaluate(()=>pacer.reserve()),0);admitted++;}
  assert.equal(await b.evaluate(()=>pacer.reserve()),10000);
  await a.close();const replacement=await open();
  assert.equal(await replacement.evaluate(()=>pacer.reserve()),10000,'new page retains recent debt');
  await replacement.evaluate(()=>{paceTime+=10000;});
  assert.equal(await replacement.evaluate(()=>pacer.reserve()),0,'expired window admits a new frame');
  assert.equal(await b.evaluate(async()=>{paceTime+=10000;return pacer.reserve();}),0);
  console.log('PASS: separate browser tabs atomically share the 56-frame budget; a replacement page retains debt and the elapsed window permits new sends. Real browser IndexedDB; synthetic clock and routing identity.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
