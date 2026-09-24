// Real generated app/bootstrap/identity. Migration records are explicit fixtures;
// generation-migration.test.mjs separately exercises the actual migration writer.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {extname} from 'node:path';
const {chromium, expect} = await import('@playwright/test');
const root = new URL('../../releases/along-experimental-app/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('build-info.json', root)));
assert.equal(manifest.profile, 'along-experimental-app-v1');
const sources = new Map();
for (const [path, hash] of Object.entries(manifest.files)) {
  const bytes = await readFile(new URL(path, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash); sources.set('/' + path, bytes);
}
const server = createServer((req, res) => {
  const name = req.url.endsWith('/') ? req.url + 'index.html' : req.url, body = sources.get(name);
  res.writeHead(body ? 200 : 404, {'Content-Type': ({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.json':'application/json','.css':'text/css'})[extname(name)] || 'application/octet-stream'}); res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext(), page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/public/`);
  const input = await page.evaluate(async () => {
    const wasm = await import('/experiments/tg-pairing/hive_wasm.js'); await wasm.default();
    const store = await (await import('/experiments/tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');
    try {
      const setup = await (await import('/experiments/tg-pairing/software-persona.mjs')).initializeSoftwarePersona({wasm, store});
      const {emptyState} = await import('/experiments/journey-sync/state.mjs');
      const sourceState = emptyState(setup.group);
      await store.compareAndSwapMany([
        {scope:'along-saved-journeys-v1',key:setup.group,expectedRevision:0,value:{format:2,profile:'along-journey-generation-migration-v1',group:setup.group}},
        {scope:'along-saved-journeys-v2',key:setup.group,expectedRevision:0,value:{...sourceState,format:2,generation:0,checkpoint:'0'.repeat(64)}},
        {scope:'along-journey-migration-v1',key:setup.group,expectedRevision:0,value:{format:1,member:setup.member,sourceRevision:0,sourceState,importReceipt:null}},
      ]);
      const prefs = await import('/experiments/journey-sync/app-preferences.mjs');
      const raw = JSON.stringify({learning:false,journeys:[],journeySync:{format:1,group:setup.group,pending:[]}});
      localStorage.setItem(prefs.preferenceKey,raw); return {group:setup.group,raw,key:prefs.preferenceKey};
    } finally {store.close();}
  });
  const open = async () => {
    await page.locator('#settings-open').click();
    await page.getByRole('button',{name:'Share saved journeys with my devices',exact:true}).click();
  };
  await page.reload(); await open();
  await expect(page.getByText('Saved-journey migration needs to finish on this device.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Start journey connection',exact:true})).toHaveCount(0);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),input.key),input.raw);
  await page.getByRole('button',{name:'Finish saved-journey setup',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Prepare saved-journey recovery?',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key+':generation-profile-v1'),input.key),null);
  await page.getByRole('button',{name:'Finish saved-journey setup',exact:true}).click();
  await page.getByRole('button',{name:'Prepare recovery on this device',exact:true}).click();
  await expect(page.getByText('Ongoing sharing for this storage version is not enabled yet.',{exact:false})).toBeVisible();
  await page.reload(); await open();
  await expect(page.getByText('Ongoing sharing for this storage version is not enabled yet.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Start journey connection',exact:true})).toHaveCount(0);
  await page.evaluate(({raw,key})=>localStorage.setItem(key,raw+' '),input);
  await page.getByRole('button',{name:'Check saved-journey recovery',exact:true}).click();
  await expect(page.getByText('An older app copy has additional edits.',{exact:false})).toBeVisible();
  await page.evaluate(({key})=>localStorage.removeItem(key+':generation-profile-v1'),input);
  await page.getByRole('button',{name:'Check saved-journey recovery',exact:true}).click();
  await expect(page.getByText('Saved-journey migration needs to finish on this device.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Back to settings',exact:true}).click();
  await expect(page.locator('#settings')).toBeVisible();
  // The planner's local-only save is a fixture; checkpoint preparation,
  // installation and choice application below all use the real Settings flow.
  await page.evaluate(async ({group,key}) => {
    const {projectJourney} = await import('/experiments/journey-sync/state.mjs');
    const point = id=>({id,name:id,lat:-36,lon:174});
    const value = projectJourney({from:point('Home'),to:point('Work'),savedRoutes:[{mode:'bus',route:'75'}]});
    const raw = JSON.stringify({learning:false,journeys:[{...value,saved:true,count:7,hours:Array(24).fill(0),days:Array(7).fill(0),last:5}],
      journeySync:{format:1,group,pending:[]}});
    localStorage.setItem(key,raw);
  },input);
  await page.reload(); await open();
  await page.getByRole('button',{name:'Finish saved-journey setup',exact:true}).click();
  await page.getByRole('button',{name:'Prepare recovery on this device',exact:true}).click();
  await page.getByRole('button',{name:'Review recovery checkpoint',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Start a new sharing checkpoint?',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  assert.equal(await page.evaluate(async group=>{
    const store=await(await import('/experiments/tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');
    try{return (await store.read('along-saved-journeys-v2',group)).value.generation;}finally{store.close();}
  },input.group),0);
  await page.getByRole('button',{name:'Review recovery checkpoint',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Start a new sharing checkpoint?',exact:true})).toBeFocused();
  await page.evaluate(key=>{
    const profile=JSON.parse(localStorage.getItem(key+':generation-profile-v1'));
    const data=JSON.parse(profile.currentRaw);data.mobility={pace:0.8};
    profile.currentRaw=JSON.stringify(data);localStorage.setItem(key+':generation-profile-v1',JSON.stringify(profile));
  },input.key);
  await page.getByRole('button',{name:'Create checkpoint and review my places',exact:true}).click();
  await expect(page.getByText('The checkpoint could not be confirmed.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'Review recovery checkpoint',exact:true}).click();
  await expect(page.getByText('This checkpoint was prepared earlier.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Create checkpoint and review my places',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Choose what to keep',exact:true})).toBeFocused();
  await expect(page.getByText('This device: Saved places · Bus 75',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Keep this device’s version',exact:true}).click();
  await page.getByRole('button',{name:'Leave review',exact:true}).click();
  await page.getByRole('button',{name:'Review saved-place differences',exact:true}).click();
  await expect(page.getByRole('button',{name:'Keep this device’s version',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Keep this device’s version',exact:true}).click();
  await page.evaluate(key => {
    const profile = JSON.parse(localStorage.getItem(key+':generation-profile-v1'));
    const data = JSON.parse(profile.currentRaw); data.learning = true;
    profile.currentRaw = JSON.stringify(data); localStorage.setItem(key+':generation-profile-v1',JSON.stringify(profile));
  },input.key);
  await page.getByRole('button',{name:'Apply choices on this device',exact:true}).click();
  await expect(page.getByText('Your choices could not be confirmed.',{exact:false})).toBeVisible();
  assert.equal(await page.evaluate(key => JSON.parse(JSON.parse(localStorage.getItem(key+':generation-profile-v1')).currentRaw).learning,input.key),true);
  await page.getByRole('button',{name:'Leave review',exact:true}).click();
  await page.getByRole('button',{name:'Review saved-place differences',exact:true}).click();
  await page.getByRole('button',{name:'Keep this device’s version',exact:true}).click();
  await page.getByRole('button',{name:'Apply choices on this device',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Saved-place choices applied here',exact:true})).toBeFocused();
  const recovered = await page.evaluate(async key => {
    const prefs = await import('/experiments/journey-sync/app-preferences.mjs');
    const current = prefs.readEnvelope();
    return {route:current.data.journeys[0].savedRoutes[0].route,count:current.data.journeys[0].count,learning:current.data.learning,
      generation:current.sync.version.generation,pending:current.sync.pending.length,legacy:JSON.parse(localStorage.getItem(key)).journeySync.pending.length};
  },input.key);
  assert.deepEqual(recovered,{route:'75',count:7,learning:true,generation:1,pending:0,legacy:0});
  await page.reload(); await open();
  await expect(page.getByText('Ongoing sharing for this storage version is not enabled yet.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Review saved-place differences',exact:true})).toHaveCount(0);
  // Stage a genuinely signed next checkpoint as an inbox fixture. Transport is
  // independently exercised with enrolled peers; this checks the receiving UI.
  await page.evaluate(async group=>{
    const wasm=await import('/experiments/tg-pairing/hive_wasm.js');await wasm.default();
    const store=await(await import('/experiments/tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');
    const expectedGroup=Uint8Array.from(group.match(/../g),b=>parseInt(b,16));
    const issuer=await(await import('/experiments/tg-pairing/software-persona.mjs')).loadSoftwareIssuer({wasm,store,expectedGroup});
    try{
      const current=await store.read('along-saved-journeys-v2',group);
      const prepared=await issuer.prepareJourneyCheckpoint({expectedRevision:current.revision});
      await store.compareAndSwapMany([{scope:'along-journey-checkpoint-inbox-v1',key:group,expectedRevision:0,
        value:{format:1,previous:current.value,checkpoint:prepared.checkpoint,snapshot:prepared.snapshot}}]);
    }finally{issuer.close();store.close();}
  },input.group);
  await page.getByRole('button',{name:'Check saved-journey recovery',exact:true}).click();
  await page.setViewportSize({width:320,height:640});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'Review received saved places',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review received saved places',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  assert.equal(await page.evaluate(async()=>{
    const prefs=await import('/experiments/journey-sync/app-preferences.mjs');return prefs.readEnvelope().sync.version.generation;
  }),1);
  await page.getByRole('button',{name:'Review received saved places',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Review received saved places',exact:true})).toBeFocused();
  await page.evaluate(async group=>{
    const store=await(await import('/experiments/tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');
    try{
      const inbox=await store.read('along-journey-checkpoint-inbox-v1',group);
      await store.compareAndSwapMany([{scope:'along-journey-checkpoint-inbox-v1',key:group,
        expectedRevision:inbox.revision,value:inbox.value}]);
    }finally{store.close();}
  },input.group);
  await page.getByRole('button',{name:'Continue to compare my places',exact:true}).click();
  await expect(page.getByText('This update could not be confirmed.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'Review received saved places',exact:true}).click();
  await page.getByRole('button',{name:'Continue to compare my places',exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Apply choices on this device',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Saved-place choices applied here',exact:true})).toBeFocused();
  await page.reload();await open();
  await expect(page.getByRole('button',{name:'Review received saved places',exact:true})).toHaveCount(0);
  assert.deepEqual(await page.evaluate(async()=>{
    const prefs=await import('/experiments/journey-sync/app-preferences.mjs'),current=prefs.readEnvelope();
    return {generation:current.sync.version.generation,route:current.data.journeys[0].savedRoutes[0].route,count:current.data.journeys[0].count};
  }),{generation:2,route:'75',count:7});
  assert.deepEqual(errors,[]);
  console.log('PASS: received-checkpoint Settings entry, narrow-screen keyboard confirmation, Back preservation, stale inbox refusal, guarded installation, local review and fresh-page restoration. Inbox population is a signed fixture; peer transport is checked separately.');
  console.log('PASS: generated Settings/bootstrap with actual identity and fixture migration records pauses legacy connections for incomplete/recovered generations, reports later old-tab edits, detects a removed isolated profile and returns to Settings without page errors. Actual migration writer is tested separately.');
  console.log('PASS: Settings opens a real signed-checkpoint review, retains draft choices after leaving, applies them through the guarded writer, preserves history/legacy copy and reopens the recovered generation. Initial generation/planner data are fixtures; issuer signing, checkpoint installation and review application use real Settings operations.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
