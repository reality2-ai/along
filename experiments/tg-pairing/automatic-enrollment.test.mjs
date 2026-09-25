// Actual browser-software issuer and core enrollment; harness supplies initial trust and signaling.
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
const guidedMode=process.env.GUIDED_PAIRING==='1';
const guidedScan=process.env.GUIDED_SCAN==='1';
if(guidedScan)assert.ok(guidedMode);
const guidedCancel=process.env.GUIDED_CANCEL==='1';
const guidedConflict=process.env.GUIDED_CONFLICT==='1';
if(guidedConflict)assert.ok(guidedMode&&!guidedCancel);
const guidedInterrupt=process.env.GUIDED_INTERRUPT;
if(guidedInterrupt)assert.ok(guidedMode&&!guidedCancel&&['install','ack'].includes(guidedInterrupt));
import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {createLocalTestRelay} from '../relay/test-server.mjs';
const relayMode = process.env.AUTOMATIC_RELAY === '1' || guidedMode;
import {join} from 'node:path';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_BROWSER_DIR) throw new Error('Set R2_BROWSER_DIR to the experimental Reality2 browser module directory');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
const sources = new Map(await Promise.all(['peer-session', 'challenge', 'session-statement', 'membership', 'certificate', 'enrollment-session', 'storage', 'invitation-journal', 'enrollment-link', 'enrollment-exchange', 'enrollment-protection', 'peer-link', 'invitation'].map(async name => ['/' + name + '.mjs', await readFile(join(process.env.R2_BROWSER_DIR, name + '.mjs'))])));
for (const name of ['enrollment-profile.mjs', 'enrollment-payloads.mjs', 'core-candidate-session.mjs', 'software-traffic.mjs', 'initial-persona.mjs', 'software-persona.mjs', 'software-invitation.mjs', 'invitation-proof.mjs', 'transfer-view.mjs', 'receive-invitation-view.mjs', 'stored-claim.mjs', 'installation-receipt.mjs', 'local-persona.mjs', 'local-persona-session.mjs', 'epoch-watch.mjs', 'receipt-recovery.mjs', 'automatic-signalling.mjs', 'automatic-enrollment.mjs', 'connection-invitation.mjs', 'invitation-channel.mjs', 'invitation-channel-checks.mjs', 'automatic-pairing-view.mjs', 'connected-sharing-view.mjs', 'comparison.mjs', 'comparison.css']) sources.set('/' + name, await readFile(new URL('./' + name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
for (const name of ['qr-transfer.mjs', 'vendor/qrcode.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
for (const name of await readdir(new URL('../r2-current/',import.meta.url))) {
  if (name.endsWith('.mjs')) sources.set('/r2-current/'+name,await readFile(new URL('../r2-current/'+name,import.meta.url)));
}
for (const name of await readdir(new URL('../../public/vendor/noble-ciphers/',import.meta.url))) {
  if (name.endsWith('.js')) sources.set('/public/vendor/noble-ciphers/'+name,await readFile(new URL('../../public/vendor/noble-ciphers/'+name,import.meta.url)));
}
sources.set('/relay/transport.mjs',await readFile(new URL('../relay/transport.mjs',import.meta.url)));
for(const directory of ['relay','journey-sync'])for(const name of await readdir(new URL('../'+directory+'/',import.meta.url))){
  if(name.endsWith('.mjs'))sources.set('/'+directory+'/'+name,await readFile(new URL('../'+directory+'/'+name,import.meta.url)));
}
for(const [path,bytes] of [...sources])sources.set('/tg-pairing'+path,bytes);
const handler = (req, res) => {
  if (sources.has(req.url)) { res.writeHead(200, {'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : req.url.endsWith('.css') ? 'text/css' : 'text/javascript'}); res.end(sources.get(req.url)); }
  else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect devices</title><link rel="stylesheet" href="/comparison.css"></head><body><main><h1>My devices</h1><div id="flow"></div></main></body></html>'); }
};
const relay = relayMode ? await createLocalTestRelay(handler) : undefined;
const server = relay?.server ?? createServer(handler);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser,pages;
const sent=[];
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const contexts = await Promise.all([browser.newContext({ignoreHTTPSErrors:relayMode,viewport:{width:360,height:780}}), browser.newContext({ignoreHTTPSErrors:relayMode,viewport:{width:360,height:780}})]);
  pages = await Promise.all(contexts.map(c => c.newPage()));
  const url = `${relayMode?'https':'http'}://127.0.0.1:${server.address().port}`;
  await Promise.all(pages.map(async (page, index) => {
    await page.goto(url);
    await page.evaluate(async ({index,guidedConflict}) => {
      window.wasm = await import('./hive_wasm.js'); await wasm.default();
      window.store = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
      window.restore = await import('./local-persona.mjs');
      if (index === 0 && !guidedConflict) {
        const initial = await (await import('./initial-persona.mjs')).initializeLocalPersona({wasm, store}); initial.close();
      } else {
        window.software = await import('./software-persona.mjs');
        const result = await software.initializeSoftwarePersona({wasm, store});
        window.group = Uint8Array.from(result.group.match(/../g), b => parseInt(b, 16));
        store.close(); window.store = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
        window.issuer = await software.loadSoftwareIssuer({wasm, store, expectedGroup: group});
      }
    }, {index,guidedConflict});
  }));
  if(guidedMode){
    const previous=guidedConflict?await pages[0].evaluate(async()=>({persona:(await store.read('candidate-persona','active')).revision,group:[...group],custody:(await store.read('along-browser-issuer',Array.from(group,b=>b.toString(16).padStart(2,'0')).join(''))).revision})):undefined;
    const relayURL=`wss://127.0.0.1:${server.address().port}/r2`;
    await pages[1].evaluate(async relay=>{
      window.view=(await import('./automatic-pairing-view.mjs')).showAutomaticPairing(document.querySelector('#flow'),
        {wasm,store,role:'provisioner',expectedGroup:group,relay,focus:true,onConnected:result=>{window.connected=result;},
          onShare:async result=>{window.sharing=(await import('./connected-sharing-view.mjs')).showConnectedSharing(document.querySelector('#flow'),{wasm,store,expectedGroup:result.group,peer:result.peer,relay:result.relay,focus:true,onChanged:()=>{window.sharingSaved=true;}});}});
    },relayURL);
    assert.equal(relay.stats().connections,0,'No relay contact before explicit create');
    await pages[1].getByRole('button',{name:'Create invitation',exact:true}).click();
    const link=await pages[1].getByLabel('Invitation link',{exact:true}).inputValue();
    assert.ok(link.includes('#connect='));
    await pages[0].evaluate(async ({link,guidedInterrupt,guidedScan})=>{
      if(!guidedScan)history.replaceState({kept:'yes'},'',link);
      const module=await import('./automatic-pairing-view.mjs');
      const consumed=guidedScan?{}:module.consumeConnectionFragment(location,history);
      if(!guidedScan&&(location.hash||history.state.kept!=='yes'||!consumed.invitation))throw Error('Fragment not removed safely');
      let flowStore=store;
      if(guidedInterrupt)flowStore={...store,compareAndSwapMany:async(...args)=>{
        const result=await store.compareAndSwapMany(...args);
        if(result.applied&&args[0].some(write=>write.scope==='candidate-persona'&&write.value?.invitation&&write.value.peerAcknowledged===(guidedInterrupt==='ack'))){
          window.heldCommit=true;await new Promise(resolve=>{window.releaseHeld=resolve;});
        }
        return result;
      }};
      window.view=module.showAutomaticPairing(document.querySelector('#flow'),{wasm,store:flowStore,role:'candidate',focus:true,
        connectionText:consumed.invitation,onBack:()=>{window.back=true;},onConnected:result=>{window.connected=result;},
        onShare:async result=>{window.sharing=(await import('./connected-sharing-view.mjs')).showConnectedSharing(document.querySelector('#flow'),{wasm,store,expectedGroup:result.group,peer:result.peer,relay:result.relay,focus:true,onChanged:()=>{window.sharingSaved=true;}});}});
    },{link,guidedInterrupt,guidedScan});
    if(guidedScan){
      await pages[0].evaluate(link=>{
        window.cameraStopped=0;window.cameraRequested=0;
        HTMLMediaElement.prototype.play=async()=>{};
        window.BarcodeDetector=class{static async getSupportedFormats(){return ['qr_code'];}async detect(){return [{format:'qr_code',rawValue:link}];}};
        Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
          cameraRequested++;const stream=new MediaStream();Object.defineProperty(stream,'getTracks',{value:()=>[{stop:()=>cameraStopped++}]});return stream;
        }});
      },link);
      assert.equal(await pages[0].evaluate(()=>cameraRequested),0);
      await pages[0].getByRole('button',{name:'Scan invitation',exact:true}).click();
      await pages[0].getByRole('heading',{name:'Connect to your other device?',exact:true}).waitFor();
      assert.equal(await pages[0].evaluate(()=>cameraStopped),1);
      console.log('PASS: scan result advances to invitation review and releases the camera, with no return QR. Camera/decoder stub; physical scanning is not verified.');
    }
    await pages[0].getByRole('heading',{name:'Connect to your other device?',exact:true}).waitFor();
    // Only the inviter may have opened a socket; parsing/review creates none.
    assert.ok(relay.stats().connections<=1);
    await pages[0].getByRole('button',{name:'Connect and compare codes',exact:true}).focus();
    await pages[0].keyboard.press('Enter');
    if(guidedConflict){
      await pages[0].getByRole('heading',{name:'Check this device’s connection',exact:true}).waitFor();
      assert.equal(relay.stats().connections,1,'Existing-group conflict must not contact the relay');
      assert.deepEqual(await pages[0].evaluate(async()=>{
        const saved=await store.read('candidate-persona','active'),group=saved.value.record.group;
        return {persona:saved.revision,group:[...group],custody:(await store.read('along-browser-issuer',Array.from(group,b=>b.toString(16).padStart(2,'0')).join(''))).revision};
      }),previous);
      assert.equal(await pages[0].evaluate(()=>Boolean(window.connected)),false);
      await pages[0].getByRole('button',{name:'Back to my devices',exact:true}).click();
      await pages[0].waitForFunction(()=>window.back===true);await pages[1].evaluate(()=>view.dispose());
      console.log('PASS: an existing software group is refused before candidate networking; persona and encrypted issuer custody retain their revisions and group.');
    }else{
    for(const p of pages)await p.getByRole('heading',{name:'Do both devices show this code?',exact:true}).waitFor();
    const codes=await Promise.all(pages.map(p=>p.locator('.pairing-code').textContent()));
    assert.equal(codes[0],codes[1]);
    for(const p of pages){
      assert.deepEqual((await new AxeBuilder({page:p}).analyze()).violations.map(v=>v.id),[]);
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    assert.equal(await pages[0].evaluate(async()=>(await store.read('candidate-persona','active')).value.origin),'initial');
    if(guidedCancel){
      await pages[0].getByRole('button',{name:'Cancel — codes differ or I’m unsure',exact:true}).click();
      await pages[0].waitForFunction(()=>window.back===true);
      assert.equal(await pages[0].evaluate(async()=>(await store.read('candidate-persona','active')).value.origin),'initial');
      assert.equal(await pages[0].evaluate(()=>Boolean(window.connected)),false);
      await pages[1].evaluate(()=>view.dispose());
      console.log('PASS: cancelling the comparison returns without replacing the saved identity or claiming connection.');
    }else{
    for(const p of pages)await p.getByRole('button',{name:'Both devices are here and the codes match',exact:true}).click();
    if(guidedInterrupt){
      await pages[0].waitForFunction(()=>window.heldCommit===true);
      await pages[1].evaluate(()=>view.dispose());
      await pages[0].getByRole('heading',{name:'Checking the saved connection',exact:true}).waitFor();
      await pages[0].evaluate(()=>releaseHeld());
      await pages[0].getByRole('heading',{name:guidedInterrupt==='ack'?'Device connected':'Connection saved on this device',exact:true}).waitFor();
      assert.equal(await pages[0].evaluate(async()=>(await store.read('candidate-persona','active')).value.peerAcknowledged),guidedInterrupt==='ack');
      console.log('PASS: guided '+guidedInterrupt+' commit survives interruption before its promise returns; UI reports saved state after settling, without replacing the group.');
    }else{
    await pages[0].getByRole('heading',{name:'Device connected',exact:true}).waitFor();
    await pages[1].getByRole('heading',{name:'Connection saved',exact:true}).waitFor();
    assert.equal(await pages[0].evaluate(()=>connected.peer.certificate.length),136);
    assert.equal(await pages[1].evaluate(()=>connected.peer.certificate.length),136);
    for(const p of pages){
      assert.equal(await p.evaluate(async()=>{
        const key=Array.from(connected.group,b=>b.toString(16).padStart(2,'0')).join('');
        return (await store.read('along-journey-sharing-v1',key))===null&&(await store.read('along-relay-configuration-v1',key))===null;
      }),true,'Enrollment did not grant sharing or persist relay consent');
      await p.getByRole('button',{name:'Choose what to share',exact:true}).click();
      await p.getByRole('heading',{name:'Share with this device?',exact:true}).waitFor();
      await p.getByRole('button',{name:'Share and reconnect',exact:true}).click();
      await p.waitForFunction(()=>window.sharingSaved===true);
      assert.equal(await p.evaluate(async()=>{
        const key=Array.from(connected.group,b=>b.toString(16).padStart(2,'0')).join('');
        const remote=Array.from(connected.peer.member,b=>b.toString(16).padStart(2,'0')).join('');
        const permission=await store.read('along-journey-sharing-v1',key),relay=await store.read('along-relay-configuration-v1',key);
        return permission.value.peers.includes(remote)&&relay.value.enabled&&relay.value.url===connected.relay;
      }),true);
    }

    assert.equal(await pages[0].evaluate(async()=>(await store.read('candidate-persona','active')).value.peerAcknowledged),true);
    }
    }
    }
  }else{
  const descriptor = await pages[1].evaluate(async () => {
    window.invite = await (await import('./software-invitation.mjs')).createSoftwareInvitation({wasm,store,expectedGroup:group});
    return invite.descriptor;
  });
  const relayURL = `wss://127.0.0.1:${server.address().port}/r2`;
  if (process.env.CHANNEL_CHECKS === '1') console.log('PASS:',await pages[1].evaluate(async ({descriptor,relay}) =>
    (await import('./invitation-channel-checks.mjs')).checkInvitationChannel({descriptor,relay}),{descriptor,relay:relayURL}));
  const connection = relayMode ? await pages[1].evaluate(async ({descriptor,relayURL}) =>
    (await import('./connection-invitation.mjs')).createConnectionInvitation({descriptor,relay:relayURL}),{descriptor,relayURL}) : undefined;
  // Harness moves bytes only: it does not construct or sequence proof/SDP replies.
  await Promise.all(pages.map((page,index)=>page.exposeFunction('deliver',async text=>{
    sent.push(JSON.parse(text).kind);
    if (!relayMode) await pages[1-index].evaluate(text=>window.inbound?.(text),text);
  })));
  for(const index of [1,0]) await pages[index].evaluate(async ({index,descriptor,connection,relayMode})=>{
    window.errors=[];window.ready=false;window.channelStatus=[];
    window.reviewAbort=new AbortController();
    const channel = relayMode ? await (await import('./invitation-channel.mjs')).createInvitationChannel({
      invitation:connection,role:index===0?'candidate':'provisioner',signal:reviewAbort.signal,
      onError:error=>errors.push(error.message),onStatus:status=>channelStatus.push(status),
    }) : {send:text=>window.deliver(text),subscribe:fn=>{window.inbound=fn;return ()=>{window.inbound=undefined;};},close(){}};
    if (relayMode) channel.start();
    window.channel=channel;
    window.flow=(await import('./automatic-enrollment.mjs')).createAutomaticEnrollment({
      role:index===0?'candidate':'provisioner',wasm,store,
      invitation:index===1?invite:undefined,
      reviewed:index===0?{descriptor,signal:reviewAbort.signal}:undefined,
      channel:relayMode?{...channel,send:text=>{void window.deliver(text);return channel.send(text);}}:channel,
      onReady:result=>{window.session=result.session;window.payloads=result.payloads;window.ready=true;},
      onError:error=>errors.push(error.message),onStatus:status=>channelStatus.push(status),
    });
  },{index,descriptor,connection,relayMode});
  await pages[0].evaluate(()=>flow.start());
  await Promise.all(pages.map(p=>p.waitForFunction(()=>ready||errors.length)));
  for(const p of pages)assert.deepEqual(await p.evaluate(()=>errors),[]);
  assert.deepEqual(sent,['challenge','proof','offer','answer']);
  const codes=await Promise.all(pages.map(p=>p.evaluate(async()=>[...await session.comparison()])));
  assert.deepEqual(codes[0],codes[1]);
  // No membership installed before the explicit comparison decision.
  assert.equal(await pages[0].evaluate(async()=>(await store.read('candidate-persona','active')).value.origin),'initial');
  await Promise.all(pages.map(p=>p.evaluate(()=>session.decide(true))));
  await pages[0].evaluate(()=>session.sendClaim());
  await pages[1].evaluate(async()=>{
    const subject=await payloads.claim(),material=await invite.enrollmentMaterial(subject);
    try{await payloads.sendBundle(material);}finally{material.destroy();}
  });
  assert.equal((await pages[0].evaluate(()=>session.installLocal())).status,'installed-local');
  await Promise.all([
    pages[1].evaluate(()=>payloads.acknowledgeInstalled()),
    pages[0].evaluate(()=>session.acknowledgeInstallation()),
  ]);
  assert.equal(await pages[0].evaluate(async()=>(await store.read('candidate-persona','active')).value.peerAcknowledged),true);
  }
  if(!guidedCancel&&!guidedConflict){
  const expectedGroup=await pages[1].evaluate(()=>[...group]);
  await pages[0].reload();
  assert.equal(await pages[0].evaluate(async ({expectedGroup,acknowledged})=>{
    const wasm=await import('./hive_wasm.js');await wasm.default();
    const store=await(await import('./storage.mjs')).openBrowserStorage('software-enrollment');
    try{
      const restored=await(await import('./local-persona.mjs')).loadLocalPersona({wasm,store,expectedGroup:new Uint8Array(expectedGroup)});
      return restored.origin==='enrolled'&&restored.peerAcknowledged===acknowledged&&(await restored.sign(new Uint8Array(32))).length===64;
    }finally{store.close();}
  },{expectedGroup,acknowledged:guidedInterrupt!=='install'}),true);
  if (relayMode) { assert.equal(relay.stats().connections,2); assert.equal(relay.stats().limited,0); }
  if(guidedMode&&!guidedInterrupt)console.log('PASS: guided invitation/review/comparison, keyboard confirmation, no pre-consent candidate network, fragment removed from history, narrow layout and automated accessibility, real enrollment and reload. Explicit sharing and relay choices saved for the verified peer. Automatic journey delivery and physical devices remain untested.');
  if(!guidedInterrupt)console.log('PASS: automatic challenge/proof/offer/answer with actual software identities, verified proof, WebRTC comparison, explicit confirmation, durable installation/acknowledgment and reload. ' + (relayMode?(process.env.R2_HIVE_UPSTREAM?'Current hive binding through deployed upstream via local TLS test bridge.':'Current hive binding through local relay with protected invitation channel.'):'Harness supplies byte-only channel.') + ' Harness supplies reviewed invitation; not public rendezvous or physical acceptance.');
  }
} catch (error) {
  console.error('Non-secret connection diagnostics:',JSON.stringify({sent,relay:relay?.stats(),profiles:await Promise.all((pages??[]).map(p=>
    p.evaluate(()=>({ready:window.ready,errors:window.errors,status:window.channelStatus})).catch(()=>({closed:true}))))}));
  throw error;
} finally {
  await browser?.close();
  if (relay) await relay.close(); else await new Promise(resolve=>server.close(resolve));
}
