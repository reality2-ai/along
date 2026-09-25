// Real generated app/bootstrap/identity. Migration records are explicit fixtures;
// generation-migration.test.mjs separately exercises the actual migration writer.
import assert from 'node:assert/strict';
import {createLocalTestRelay} from './test-server.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {extname} from 'node:path';
const {chromium, expect} = await import('@playwright/test');
const regularCandidate=process.env.REGULAR_CANDIDATE==='1';
assert.ok(!(regularCandidate&&process.env.PREVIEW==='1'));
const prefix=regularCandidate?'/along/':'/';
const root = new URL(regularCandidate?'../../releases/along-regular-upgrade-candidate/':process.env.PREVIEW==='1'?'../../releases/along-device-preview/':'../../releases/along-experimental-app/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('build-info.json', root)));
assert.equal(manifest.profile, regularCandidate?'along-regular-upgrade-candidate-v1':process.env.PREVIEW==='1'?'along-device-preview-v1':'along-experimental-app-v1');
const sources = new Map();
for (const [path, hash] of Object.entries(manifest.files)) {
  const bytes = await readFile(new URL(path, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash); sources.set(prefix + path, bytes);
}
const relay=await createLocalTestRelay((req,res)=>{
  const name=req.url.endsWith('/')?req.url+'index.html':req.url,body=sources.get(name);
  res.writeHead(body?200:404,{'Content-Type':({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.json':'application/json','.css':'text/css'})[extname(name)]||'application/octet-stream'});res.end(body);
});
await new Promise(r=>relay.server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:780}}),page=await context.newPage();
  await page.addInitScript(({name,base})=>{window.testDeviceStore=name;window.testExperimentBase=base;},{name:manifest.namespaces?.devices||'along-pairing-lab-v1',base:prefix+'experiments/'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const origin=`https://127.0.0.1:${relay.server.address().port}`,endpoint=origin.replace('https:','wss:')+'/r2';
  await page.goto(origin+prefix+(regularCandidate?'':'public/'));
  await page.evaluate(async()=>{
    const wasm=await import(window.testExperimentBase+'tg-pairing/hive_wasm.js');await wasm.default();
    const store=await(await import(window.testExperimentBase+'tg-pairing/storage.mjs')).openBrowserStorage(window.testDeviceStore);
    try{await(await import(window.testExperimentBase+'tg-pairing/software-persona.mjs')).initializeSoftwarePersona({wasm,store});}finally{store.close();}
  });
  await page.reload();
  const home=async()=>{await page.locator('#settings-open').click();await page.getByRole('button',{name:'Share saved journeys with my devices',exact:true}).click();};
  const open=async()=>{await page.getByRole('button',{name:'Automatic connection with a relay',exact:true}).click();await expect(page.getByRole('heading',{name:'Automatically reconnect my devices',exact:true})).toBeFocused();};
  await home();await open();
  await expect(page.getByText('No relay is enabled.',{exact:false})).toBeVisible();assert.equal(relay.stats().connections,0);
  const address=page.getByRole('textbox',{name:'Relay server address'});
  await address.fill('https://example.invalid');await page.getByRole('button',{name:'Use this relay',exact:true}).click();
  await expect(page.getByText('Enter a secure wss:// relay address',{exact:false})).toBeVisible();await expect(address).toBeFocused();assert.equal(relay.stats().connections,0);
  await address.fill(endpoint);await page.getByRole('button',{name:'Use this relay',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.getByText('Relay enabled on this device.',{exact:false})).toBeVisible();
  await expect.poll(()=>relay.stats().connections).toBe(1);
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect(page.getByText('Relay connected. Waiting for a permitted device with Along open.',{exact:true})).toBeVisible();
  // Stored opt-in restores through the real bootstrap, with no settings visit.
  await page.reload();await expect.poll(()=>relay.stats().connections).toBe(2);
  await home();await open();await expect(address).toHaveValue(endpoint);
  await page.getByRole('button',{name:'Stop automatic relay sharing',exact:true}).click();
  await expect(page.getByText('Automatic relay sharing stopped.',{exact:false})).toBeVisible();
  await page.reload();await home();await open();
  await expect(page.getByText('Automatic relay sharing is stopped.',{exact:true})).toBeVisible();
  assert.equal(relay.stats().connections,2);
  await page.getByRole('button',{name:'Remove relay address',exact:true}).click();
  await expect(address).toHaveValue('');await expect(page.getByRole('button',{name:'Remove relay address',exact:true})).toBeDisabled();
  // A pending generation migration must prevent startup reconnection, even
  // with explicit saved relay opt-in. Records below model interrupted setup.
  await page.evaluate(async()=>{
    const wasm=await import(window.testExperimentBase+'tg-pairing/hive_wasm.js');
    const store=await(await import(window.testExperimentBase+'tg-pairing/storage.mjs')).openBrowserStorage(window.testDeviceStore);
    try{
      const persona=await store.read('candidate-persona','active');
      const expectedGroup=persona.value.record.group;
      const identity=await(await import(window.testExperimentBase+'tg-pairing/local-persona.mjs')).loadLocalPersona({wasm,store,expectedGroup});
      const group=Array.from(expectedGroup,b=>b.toString(16).padStart(2,'0')).join('');
      const old=await store.read('along-saved-journeys-v1',group);
      const sourceState=old?.value||(await import(window.testExperimentBase+'journey-sync/state.mjs')).emptyState(group);
      await store.compareAndSwapMany([
        {scope:'along-saved-journeys-v1',key:group,expectedRevision:old?.revision??0,value:{format:2,profile:'along-journey-generation-migration-v1',group}},
        {scope:'along-saved-journeys-v2',key:group,expectedRevision:0,value:{...sourceState,format:2,generation:0,checkpoint:'0'.repeat(64)}},
        {scope:'along-journey-migration-v1',key:group,expectedRevision:0,value:{format:1,member:identity.member,sourceRevision:old?.revision??0,sourceState,importReceipt:null}},
      ]);
    }finally{store.close();}
  });
  await address.fill(endpoint);await page.getByRole('button',{name:'Use this relay',exact:true}).click();
  await expect(page.getByText('Relay enabled on this device.',{exact:false})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('heading',{name:'Share your saved journeys',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Back to settings',exact:true}).click();await expect(page.locator('#settings')).toBeVisible();
  await page.reload();await home();
  await expect(page.getByText('Automatic sharing is paused until saved-journey recovery is reviewed.',{exact:true})).toBeVisible();
  assert.equal(relay.stats().connections,2);
  assert.deepEqual(errors,[]);
  console.log('PASS: generated app relay Settings: default off, URL refusal, narrow-screen keyboard enable, local WSS connection over the current hive binding, startup restoration, stop persistence, removal, interrupted-recovery pause, Escape/Back and no page errors. No peer enrolled or external relay tested here.');
}finally{await browser?.close();await relay.close();}
