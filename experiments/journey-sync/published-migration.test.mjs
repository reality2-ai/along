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
const zip=fileURLToPath(new URL('../../releases/along-device-preview-3805.zip',import.meta.url));
assert.equal(digest(await readFile(zip)),'ccfd7943aedd1c2de81ddf2cd13358165c882496024a02346dea973e6ec82119');
const oldFile=name=>execFileSync('unzip',['-p',zip,name],{maxBuffer:64*1024*1024});
const oldBytes=oldFile('build-info.json');assert.equal(digest(oldBytes),'2e62dcc2c3860ce523baa52d29aad8f628749732397c00613a795e7ef9fcc320');
const oldManifest=JSON.parse(oldBytes),root=new URL('../../releases/along-device-preview/',import.meta.url);
const candidate=JSON.parse(await readFile(new URL('build-info.json',root)));
assert.equal(candidate.profile,'along-device-preview-v1');
assert.ok(candidate.files['DO-NOT-PUBLISH.txt'],'migration target must remain an unpublished candidate');
assert.deepEqual(candidate.namespaces,oldManifest.namespaces);
const prior=new Map(),current=new Map();
for(const [name,hash] of Object.entries(oldManifest.files)){
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
  await old.goto(origin+'/prior/public/');
  await expect(old.locator('#address-status')).toContainText('ready offline',{timeout:60000});
  for(const [field,query,next] of [['destination','10 Victoria Road Devonport','destination-next'],['origin','277 Broadway Newmarket','origin-next']]){
    const input=old.locator('#'+field);await input.fill(query);
    await expect(old.locator('#'+field+'-options [data-index]').first()).toBeVisible();
    await input.press('ArrowDown');await input.press('Enter');await old.locator('#'+next).click();
  }
  await old.locator('#save-places').click();
  await old.locator('#settings-open').click();
  await old.getByRole('button',{name:'Device and AT-key setup',exact:true}).click();
  await old.getByRole('button',{name:'Set up my device',exact:true}).click();
  await old.getByRole('button',{name:'Create my device group',exact:true}).click();
  await old.getByRole('heading',{name:'Your devices and AT key',exact:true}).waitFor();
  const baseline=await old.evaluate(async database=>{
    const store=await(await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(database);
    try{
      const persona=await store.read('candidate-persona','active'),record=persona.value.record;
      const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
      const group=hex(record.group),actor=hex(record.subject);
      globalThis.oldPrefs=await import('../experiments/journey-sync/app-preferences.mjs');
      oldPrefs.enableJourneyTracking(group);
      await(await import('../experiments/journey-sync/app-store.mjs')).openAppJourneyStore({store,group,actor}).reconcile();
      return {group,personaRevision:persona.revision,raw:localStorage.getItem(oldPrefs.preferenceKey)};
    }finally{store.close();}
  },candidate.namespaces.devices);
  await fresh.goto(origin+'/candidate/public/');
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
    return(await import('../experiments/journey-sync/app-preferences.mjs')).readEnvelope().raw;
  });
  assert.deepEqual(JSON.parse(recovered).journeys,JSON.parse(baseline.raw).journeys,'migration changed saved places or local history');
  await old.evaluate(()=>{
    const data=oldPrefs.readPreferences();data.journeys[0].savedRoutes=[{mode:'bus',route:'75'}];
    if(!oldPrefs.writePreferences(data))throw Error('old writer failed');
  });
  await fresh.reload();await share();
  await expect(fresh.getByText('An older app copy has additional edits.',{exact:false})).toBeVisible();
  const result=await fresh.evaluate(async database=>{
    const prefs=await import('../experiments/journey-sync/app-preferences.mjs');
    const store=await(await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(database);
    try{return {raw:prefs.readEnvelope().raw,version:prefs.readEnvelope().sync.version.generation,
      personaRevision:(await store.read('candidate-persona','active')).revision,
      legacy:JSON.parse(localStorage.getItem(prefs.preferenceKey)).journeys[0].savedRoutes[0].route};}
    finally{store.close();}
  },candidate.namespaces.devices);
  assert.deepEqual(result,{raw:recovered,version:1,personaRevision:baseline.personaRevision,legacy:'75'});
  assert.deepEqual(errors,[]);
  console.log('PASS: exact published 3805 app creates saved places/identity, current candidate migrates and recovers through Settings, and an older open app writes its retained copy without overwriting the recovered planner. Reopening preserves identity and reports older edits. Service workers are blocked: not installed-update qualification.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
