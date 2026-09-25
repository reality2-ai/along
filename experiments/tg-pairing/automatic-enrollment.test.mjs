// Actual browser-software issuer and core enrollment; harness supplies initial trust and signaling.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_BROWSER_DIR) throw new Error('Set R2_BROWSER_DIR to the experimental Reality2 browser module directory');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
const sources = new Map(await Promise.all(['peer-session', 'challenge', 'session-statement', 'membership', 'certificate', 'enrollment-session', 'storage', 'invitation-journal', 'enrollment-link', 'enrollment-exchange', 'enrollment-protection', 'peer-link', 'invitation'].map(async name => ['/' + name + '.mjs', await readFile(join(process.env.R2_BROWSER_DIR, name + '.mjs'))])));
for (const name of ['enrollment-profile.mjs', 'enrollment-payloads.mjs', 'core-candidate-session.mjs', 'software-traffic.mjs', 'initial-persona.mjs', 'software-persona.mjs', 'software-invitation.mjs', 'invitation-proof.mjs', 'transfer-view.mjs', 'receive-invitation-view.mjs', 'stored-claim.mjs', 'installation-receipt.mjs', 'local-persona.mjs', 'local-persona-session.mjs', 'epoch-watch.mjs', 'receipt-recovery.mjs', 'automatic-signalling.mjs', 'automatic-enrollment.mjs']) sources.set('/' + name, await readFile(new URL('./' + name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
for (const name of ['qr-transfer.mjs', 'vendor/qrcode.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.writeHead(200, {'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : req.url.endsWith('.css') ? 'text/css' : 'text/javascript'}); res.end(sources.get(req.url)); }
  else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!doctype html><title>Core session test</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const url = `http://127.0.0.1:${server.address().port}`;
  await Promise.all(pages.map(async (page, index) => {
    await page.goto(url);
    await page.evaluate(async index => {
      window.wasm = await import('./hive_wasm.js'); await wasm.default();
      window.store = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
      window.restore = await import('./local-persona.mjs');
      if (index === 0) {
        const initial = await (await import('./initial-persona.mjs')).initializeLocalPersona({wasm, store}); initial.close();
      } else {
        window.software = await import('./software-persona.mjs');
        const result = await software.initializeSoftwarePersona({wasm, store});
        window.group = Uint8Array.from(result.group.match(/../g), b => parseInt(b, 16));
        store.close(); window.store = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
        window.issuer = await software.loadSoftwareIssuer({wasm, store, expectedGroup: group});
      }
    }, index);
  }));
  const descriptor = await pages[1].evaluate(async () => {
    window.invite = await (await import('./software-invitation.mjs')).createSoftwareInvitation({wasm,store,expectedGroup:group});
    return invite.descriptor;
  });
  // Harness moves bytes only: it does not construct or sequence proof/SDP replies.
  const sent=[];
  await Promise.all(pages.map((page,index)=>page.exposeFunction('deliver',async text=>{
    sent.push(JSON.parse(text).kind);
    await pages[1-index].evaluate(text=>window.inbound?.(text),text);
  })));
  for(const index of [1,0]) await pages[index].evaluate(async ({index,descriptor})=>{
    window.errors=[];window.ready=false;
    window.reviewAbort=new AbortController();
    window.flow=(await import('./automatic-enrollment.mjs')).createAutomaticEnrollment({
      role:index===0?'candidate':'provisioner',wasm,store,
      invitation:index===1?invite:undefined,
      reviewed:index===0?{descriptor,signal:reviewAbort.signal}:undefined,
      channel:{send:text=>window.deliver(text),subscribe:fn=>{window.inbound=fn;return ()=>{window.inbound=undefined;};},close(){}},
      onReady:result=>{window.session=result.session;window.payloads=result.payloads;window.ready=true;},
      onError:error=>errors.push(error.message),
    });
  },{index,descriptor});
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
  const expectedGroup=await pages[1].evaluate(()=>[...group]);
  await pages[0].reload();
  assert.equal(await pages[0].evaluate(async expectedGroup=>{
    const wasm=await import('./hive_wasm.js');await wasm.default();
    const store=await(await import('./storage.mjs')).openBrowserStorage('software-enrollment');
    try{
      const restored=await(await import('./local-persona.mjs')).loadLocalPersona({wasm,store,expectedGroup:new Uint8Array(expectedGroup)});
      return restored.origin==='enrolled'&&restored.peerAcknowledged&&(await restored.sign(new Uint8Array(32))).length===64;
    }finally{store.close();}
  },expectedGroup),true);
  console.log('PASS: automatic challenge/proof/offer/answer with actual software identities, verified proof, WebRTC comparison, explicit confirmation, durable installation/acknowledgment and reload. Harness supplies reviewed invitation and byte-only channel; not public rendezvous or physical acceptance.');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
