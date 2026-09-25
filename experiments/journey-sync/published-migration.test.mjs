// Exact published app -> current candidate namespace/migration test. Separate
// paths and blocked service workers deliberately exclude installed-update claims.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {extname} from 'node:path';
import {chromium,expect} from '@playwright/test';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const regularCandidate=process.env.REGULAR_CANDIDATE==='1';
const zip=regularCandidate?(process.env.ALONG_V37_ZIP||new URL('../../releases/along-web-v37.zip',import.meta.url).pathname):fileURLToPath(new URL('../../releases/along-device-preview-3805.zip',import.meta.url));
assert.equal(digest(await readFile(zip)),regularCandidate?'8dda7d208934d6f61494e67860ffe79dfbe7a3b51957e34fa9cbb99e28abf4e9':'ccfd7943aedd1c2de81ddf2cd13358165c882496024a02346dea973e6ec82119');
const oldFile=name=>execFileSync('unzip',['-p',zip,name],{maxBuffer:64*1024*1024});
const oldBytes=oldFile('build-info.json');
if(!regularCandidate)assert.equal(digest(oldBytes),'2e62dcc2c3860ce523baa52d29aad8f628749732397c00613a795e7ef9fcc320');
const oldManifest=JSON.parse(oldBytes),root=new URL(regularCandidate?'../../releases/along-regular-upgrade-candidate/':'../../releases/along-device-preview/',import.meta.url);
const candidate=JSON.parse(await readFile(new URL('build-info.json',root)));
assert.equal(candidate.profile,regularCandidate?'along-regular-upgrade-candidate-v1':'along-device-preview-v1');
assert.ok(candidate.files['DO-NOT-PUBLISH.txt'],'migration target must remain an unpublished candidate');
if(!regularCandidate)assert.deepEqual(candidate.namespaces,oldManifest.namespaces);
const deviceDatabase=candidate.namespaces?.devices??'along-pairing-lab-v1';
const appPath=regularCandidate?'':'public/';
const prior=new Map(),current=new Map();
if(regularCandidate){
  // Whole released archive is hash-verified above; v37 uses a different manifest.
  const names=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n');
  for(const name of names)if(!name.endsWith('/'))prior.set(name,oldFile(name));
}else for(const [name,hash] of Object.entries(oldManifest.files)){
  const body=oldFile(name);assert.equal(digest(body),hash);prior.set(name,body);
}
for(const [name,hash] of Object.entries(candidate.files)){
  const body=await readFile(new URL(name,root));assert.equal(digest(body),hash);current.set(name,body);
}
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname,old=path.startsWith('/prior/');
  const name=path.slice(old?7:11)+(path.endsWith('/')?'index.html':'');
  const body=(old?prior:current).get(name);
  res.writeHead(body?200:404,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
    '.json':'application/json','.wasm':'application/wasm','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(name)]||'application/octet-stream'});
  res.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  const context=await browser.newContext({serviceWorkers:'block'}),old=await context.newPage(),fresh=await context.newPage();
  const origin=`http://127.0.0.1:${server.address().port}`,errors=[];
  for(const page of [old,fresh])page.on('pageerror',error=>errors.push(error.message));
  await old.addInitScript(()=>{window.testExperimentBase='/prior/experiments/';});
  await fresh.addInitScript(()=>{window.testExperimentBase='/candidate/experiments/';});
  await old.goto(origin+'/prior/'+appPath);
  await expect(old.locator('#address-status')).toContainText('ready offline',{timeout:60000});
  for(const [field,query,next] of [['destination','10 Victoria Road Devonport','destination-next'],['origin','277 Broadway Newmarket','origin-next']]){
    const input=old.locator('#'+field);await input.fill(query);
    await expect(old.locator('#'+field+'-options [data-index]').first()).toBeVisible();
    await input.press('ArrowDown');await input.press('Enter');await old.locator('#'+next).click();
  }
  await old.locator('#save-places').click();
  if(regularCandidate){
    await old.evaluate(async()=>{globalThis.oldPrefs=await import('./preferences.js');});
    await fresh.goto(origin+'/candidate/');
  }
  const setupPage=regularCandidate?fresh:old;
  await setupPage.locator('#settings-open').click();
  await setupPage.getByRole('button',{name:/^(My devices|Device and AT-key setup)$/,exact:true}).click();
  await setupPage.getByRole('button',{name:'Set up my device',exact:true}).click();
  await setupPage.getByRole('button',{name:'Create my device group',exact:true}).click();
  await setupPage.getByRole('heading',{name:/^(My devices|Your devices and AT key)$/,exact:true}).waitFor();
  const baseline=await setupPage.evaluate(async database=>{
    const store=await(await import(window.testExperimentBase+'tg-pairing/storage.mjs')).openBrowserStorage(database);
    try{
      const persona=await store.read('candidate-persona','active'),record=persona.value.record;
      const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
      const group=hex(record.group),actor=hex(record.subject);
      globalThis.oldPrefs=await import(window.testExperimentBase+'journey-sync/app-preferences.mjs');
      oldPrefs.enableJourneyTracking(group);
      await(await import(window.testExperimentBase+'journey-sync/app-store.mjs')).openAppJourneyStore({store,group,actor}).reconcile();
      return {group,personaRevision:persona.revision,raw:localStorage.getItem(oldPrefs.preferenceKey)};
    }finally{store.close();}
  },deviceDatabase);
  await fresh.goto(origin+'/candidate/'+appPath);
  const share=async()=>{
    await fresh.locator('#settings-open').click();
    await fresh.getByRole('button',{name:'Share saved journeys with my devices',exact:true}).click();
  };
  await share();
  await fresh.getByRole('button',{name:'Review sharing recovery',exact:true}).click();
  await fresh.getByRole('button',{name:'Prepare recovery on this device',exact:true}).click();
  await fresh.getByRole('button',{name:'Review recovery checkpoint',exact:true}).click();
  await fresh.getByRole('button',{name:'Create checkpoint and review my places',exact:true}).click();
  await fresh.getByRole('button',{name:'Apply choices on this device',exact:true}).click();
  await fresh.getByRole('heading',{name:'Saved-place choices applied here',exact:true}).waitFor();
  const recovered=await fresh.evaluate(async()=>{
    return(await import(window.testExperimentBase+'journey-sync/app-preferences.mjs')).readEnvelope().raw;
  });
  assert.deepEqual(JSON.parse(recovered).journeys,JSON.parse(baseline.raw).journeys,'migration changed saved places or local history');
  await old.evaluate(()=>{
    const data=oldPrefs.readPreferences();data.journeys[0].savedRoutes=[{mode:'bus',route:'75'}];
    if(!oldPrefs.writePreferences(data))throw Error('old writer failed');
  });
  await fresh.reload();await share();
  await expect(fresh.getByText('An older app copy has additional edits.',{exact:false})).toBeVisible();
  const result=await fresh.evaluate(async database=>{
    const prefs=await import(window.testExperimentBase+'journey-sync/app-preferences.mjs');
    const store=await(await import(window.testExperimentBase+'tg-pairing/storage.mjs')).openBrowserStorage(database);
    try{return {raw:prefs.readEnvelope().raw,version:prefs.readEnvelope().sync.version.generation,
      personaRevision:(await store.read('candidate-persona','active')).revision,
      legacy:JSON.parse(localStorage.getItem(prefs.preferenceKey)).journeys[0].savedRoutes[0].route};}
    finally{store.close();}
  },deviceDatabase);
  assert.deepEqual(result,{raw:recovered,version:1,personaRevision:baseline.personaRevision,legacy:'75'});
  await fresh.setViewportSize({width:360,height:780});
  await fresh.getByRole('button',{name:'Review older-copy edits',exact:true}).click();
  await expect(fresh.getByRole('heading',{name:'Choose what to keep',exact:true})).toBeFocused();
  await expect(fresh.getByText('Older app copy: Saved places · Bus 75',{exact:true})).toBeVisible();
  await fresh.getByRole('button',{name:'Leave review',exact:true}).click();
  assert.equal(await fresh.evaluate(async()=>(await import(window.testExperimentBase+'journey-sync/app-preferences.mjs')).readEnvelope().raw),recovered);
  await fresh.getByRole('button',{name:'Review older-copy edits',exact:true}).click();
  await fresh.getByRole('button',{name:'Use older copy’s version',exact:true}).focus();await fresh.keyboard.press('Enter');
  // The shared-state commit succeeds but the planner replacement fails once.
  await fresh.evaluate(()=>{
    const original=Storage.prototype.setItem;let failed=false;
    Storage.prototype.setItem=function(key,value){if(!failed&&key.endsWith(':generation-profile-v1')){failed=true;throw Error('Fixture planner quota');}return original.call(this,key,value);};
  });
  await fresh.getByRole('button',{name:'Apply choices on this device',exact:true}).click();
  await expect(fresh.getByText('Your choices could not be confirmed.',{exact:false})).toBeVisible();
  await fresh.evaluate(async()=>{
    const prefs=await import(window.testExperimentBase+'journey-sync/app-preferences.mjs');
    const data=prefs.readPreferences();data.journeys[0].savedRoutes=[{mode:'bus',route:'90'}];
    if(!prefs.writePreferences(data))throw Error('newer local edit failed');
  });
  await fresh.reload();await share();
  await expect(fresh.getByRole('button',{name:'Start journey connection',exact:true})).toHaveCount(0);
  await fresh.getByRole('button',{name:'Finish older-copy review',exact:true}).click();
  await expect(fresh.getByRole('heading',{name:'Finish your saved-place choices',exact:true})).toBeFocused();
  await fresh.getByRole('button',{name:'Finish applying my choices',exact:true}).click();
  await expect(fresh.getByText('The retained choices could not be finished.',{exact:false})).toBeVisible();
  await fresh.getByRole('button',{name:'Review newer edits',exact:true}).click();
  await expect(fresh.getByText('Earlier committed choice: Saved places · Bus 75',{exact:true})).toBeVisible();
  await expect(fresh.getByText('This device: Saved places · Bus 90',{exact:true})).toBeVisible();
  await fresh.getByRole('button',{name:'Keep this device’s version',exact:true}).click();
  await fresh.getByRole('button',{name:'Apply choices on this device',exact:true}).click();
  await expect(fresh.getByRole('heading',{name:'Saved-place choices applied here',exact:true})).toBeFocused();
  await fresh.getByRole('button',{name:'Back',exact:true}).click();
  await expect(fresh.getByRole('button',{name:'Review older-copy edits',exact:true})).toHaveCount(0);
  await expect(fresh.getByRole('button',{name:'Start journey connection',exact:true})).toBeVisible();
  const applied=await fresh.evaluate(async()=> (await import(window.testExperimentBase+'journey-sync/app-preferences.mjs')).readEnvelope().data);
  assert.equal(applied.journeys[0].savedRoutes[0].route,'90');
  assert.equal(applied.journeys[0].count,JSON.parse(recovered).journeys[0].count);
  await fresh.reload();await share();
  await expect(fresh.getByRole('button',{name:'Review older-copy edits',exact:true})).toHaveCount(0);
  await expect(fresh.getByRole('button',{name:'Finish older-copy review',exact:true})).toHaveCount(0);
  console.log('PASS: published older writer → narrow-screen keyboard review, Leave preservation, interrupted planner application, newer local edits, explicit recovery comparison after reload, route/history preservation and acknowledgment without repeated prompts.');
  await old.evaluate(()=>{const data=oldPrefs.readPreferences();data.journeys[0].savedRoutes=[{mode:'bus',route:'80'}];if(!oldPrefs.writePreferences(data))throw Error('old writer failed');});
  // Fixture the interruption between retaining a decision and applying it;
  // its storage writer is real. The subsequent reset and re-review use the UI.
  await fresh.evaluate(async database=>{
    const wasm=await import(window.testExperimentBase+'tg-pairing/hive_wasm.js');await wasm.default();
    const store=await(await import(window.testExperimentBase+'tg-pairing/storage.mjs')).openBrowserStorage(database);
    try{
      const persona=await store.read('candidate-persona','active'),expectedGroup=persona.value.record.group;
      const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),group=hex(expectedGroup),member=hex(persona.value.record.subject);
      const isolated=(await import(window.testExperimentBase+'journey-sync/isolated-preferences.mjs')).openIsolatedPlannerStorage({group}),legacy=isolated.inspectLegacy();
      const progress=await(await import(window.testExperimentBase+'journey-sync/older-edit-progress.mjs')).readOlderEditProgress({store,group,member,sourceRaw:legacy.sourceRaw});
      const prefs=await import(window.testExperimentBase+'journey-sync/app-preferences.mjs');
      const review=await(await import(window.testExperimentBase+'journey-sync/older-edit-review.mjs')).createOlderEditReview({current:(await store.read('along-saved-journeys-v2',group)).value,
        currentRaw:prefs.readEnvelope().raw,sourceRaw:progress.sourceRaw,olderRaw:legacy.currentLegacyRaw,actor:member});
      await(await import(window.testExperimentBase+'journey-sync/older-edit-decision.mjs')).retainOlderEditDecision({wasm,store,expectedGroup,reviewId:review.id,choices:review.differences.map(d=>({id:d.id,use:'older'}))});
    }finally{store.close();}
  },deviceDatabase);
  await old.evaluate(()=>{const data=oldPrefs.readPreferences();data.journeys[0].savedRoutes=[{mode:'bus',route:'81'}];if(!oldPrefs.writePreferences(data))throw Error('old writer failed');});
  await fresh.reload();await share();
  await fresh.getByRole('button',{name:'Finish older-copy review',exact:true}).click();
  await fresh.getByRole('button',{name:'Finish applying my choices',exact:true}).click();
  await expect(fresh.getByText('The retained choices could not be finished.',{exact:false})).toBeVisible();
  await fresh.getByRole('button',{name:'Start a fresh review',exact:true}).click();
  await expect(fresh.getByText('Older app copy: Saved places · Bus 81',{exact:true})).toBeVisible();
  await fresh.getByRole('button',{name:'Use older copy’s version',exact:true}).click();
  await fresh.getByRole('button',{name:'Apply choices on this device',exact:true}).click();
  await expect(fresh.getByRole('heading',{name:'Saved-place choices applied here',exact:true})).toBeFocused();
  assert.equal(await fresh.evaluate(async()=>(await import(window.testExperimentBase+'journey-sync/app-preferences.mjs')).readEnvelope().data.journeys[0].savedRoutes[0].route),'81');
  console.log('PASS: a retained unapplied decision made stale by a newer published-app edit refuses application, then Settings starts a fresh review and applies the latest route.');
  assert.deepEqual(errors,[]);
  console.log('PASS: exact published '+(regularCandidate?'v37 creates saved places; candidate creates identity':'3805 creates saved places/identity')+', current candidate migrates and recovers through Settings, and the actual older writer retains edits without overwriting the recovered planner. Service workers blocked: not installed-update qualification.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
