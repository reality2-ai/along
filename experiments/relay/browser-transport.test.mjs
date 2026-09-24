// Real browser + local TLS WebSocket; synthetic identities and payloads only.
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createPublicKey,verify} from 'node:crypto';
import {chromium} from '@playwright/test';
const require=createRequire(import.meta.url);
const {wsServer}=require('../../node_modules/playwright-core/lib/utilsBundle.js');
const dir=await mkdtemp(join(tmpdir(),'along-relay-')); let browser,server,wss;
try {
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key'),'-out',join(dir,'cert'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
  const modules=new Map(await Promise.all(['transport.mjs','hello.mjs'].map(async n=>['/'+n,await readFile(new URL(n,import.meta.url))])));
  server=createServer({key:await readFile(join(dir,'key')),cert:await readFile(join(dir,'cert'))},(req,res)=>{
    res.setHeader('Content-Type',modules.has(req.url)?'text/javascript':'text/html');res.end(modules.get(req.url)||'<!doctype html><title>Relay test</title>');
  });
  wss=new wsServer({server,path:'/r2',maxPayload:65536}); let authenticated=0;
  wss.on('connection',socket=>{
    let hello;
    socket.on('message',(data,binary)=>{
      if(!hello){
        try {
          assert.equal(binary,false); const h=JSON.parse(data.toString());
          assert.equal(h.type,'hello');assert.equal(h.version,1);assert.match(h.trust_group,/^[0-9a-f]{16}$/);
          assert.ok(Math.abs(h.timestamp-Math.floor(Date.now()/1000))<60);
          const key=createPublicKey({format:'jwk',key:{kty:'OKP',crv:'Ed25519',x:Buffer.from(h.device_id,'hex').toString('base64url')}});
          assert.ok(verify(null,Buffer.from(`${h.trust_group}:${h.device_id}:${h.timestamp}`),key,Buffer.from(h.signature,'hex')));
          hello=h;authenticated++;socket.send(JSON.stringify({type:'welcome',version:1,peers:1,buffer_oldest:0}));
        }catch{socket.close(4401,'Invalid greeting');} return;
      }
      if(binary)socket.send(data,{binary:true});
      else if(JSON.parse(data.toString()).type==='ping')socket.send('{"type":"pong"}');
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage();
  await page.goto(`https://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async()=>{
    const {createRelayHello}=await import('./hello.mjs');const {createRelayTransport}=await import('./transport.mjs');
    const key=await crypto.subtle.generateKey('Ed25519',false,['sign','verify']);
    const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
    const group=crypto.getRandomValues(new Uint8Array(32));
    const persona={group:hex(group),member:hex(await crypto.subtle.exportKey('raw',key.publicKey)),sign:async b=>new Uint8Array(await crypto.subtle.sign('Ed25519',key.privateKey,b))};
    window.statuses=[];window.frames=[];
    window.transport=createRelayTransport({url:`wss://${location.host}/r2`,createHello:()=>createRelayHello({persona,expectedGroup:group}),
      onStatus:s=>statuses.push(s),onFrame:f=>frames.push([...f])});transport.start();
  });
  await page.waitForFunction(()=>statuses.at(-1)==='connected');
  await page.evaluate(()=>transport.send(new Uint8Array([7,8,9])));
  await page.waitForFunction(()=>frames.length===1);assert.deepEqual(await page.evaluate(()=>frames[0]),[7,8,9]);
  for(const client of wss.clients)client.close(1012,'Test reconnect');
  await page.waitForFunction(()=>statuses.filter(s=>s==='connected').length===2);
  assert.equal(authenticated,2);
  await page.evaluate(()=>transport.disconnect());
  assert.equal(await page.evaluate(()=>statuses.at(-1)),'disconnected');
  console.log('PASS: Chromium WSS greeting independently verified; binary echo and fresh authenticated reconnect; explicit disconnect. Synthetic key/payload, not peer authorization or encrypted journey sync.');
}finally{
  await browser?.close();for(const client of wss?.clients||[])client.terminate();
  if(wss)await new Promise(resolve=>wss.close(resolve));if(server)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});
}
