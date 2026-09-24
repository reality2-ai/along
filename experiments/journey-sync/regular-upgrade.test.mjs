// Exact released regular v37 -> local flattened TG/live candidate, same /along/ scope.
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const {chromium,expect}=await import(process.env.PLAYWRIGHT_MODULE||'@playwright/test');
const sha=body=>createHash('sha256').update(body).digest('hex');
const root=new URL('../../releases/along-regular-upgrade-candidate/',import.meta.url).pathname;
const manifest=JSON.parse(await readFile(join(root,'build-info.json'),'utf8'));
assert.equal(manifest.profile,'along-regular-upgrade-candidate-v1');assert.equal(manifest.publishable,false);
for(const [name,hash] of Object.entries(manifest.files))assert.equal(sha(await readFile(join(root,name))),hash,name);
const prior=process.env.ALONG_V37_ZIP||'/tmp/along-v37-upgrade-source/along-web.zip';
assert.equal(sha(await readFile(prior)),'8dda7d208934d6f61494e67860ffe79dfbe7a3b51957e34fa9cbb99e28abf4e9');
const temporary=await mkdtemp(join(tmpdir(),'along-regular-upgrade-'));
execFileSync('unzip',['-q',prior,'-d',temporary]);
let current=false,failShell=false,browser;const requests=[],errors=[];
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;requests.push(path);
  try{
    if(!path.startsWith('/along/'))throw Error('Outside app scope');
    const name=path.slice(7)+(path.endsWith('/')?'index.html':'');
    if(name.includes('..'))throw Error('Invalid path');
    if(current&&failShell&&name==='experiments/tg-pairing/hive_wasm_bg.wasm'){res.writeHead(503);res.end('Injected incomplete update');return;}
    const body=await readFile(join(current?root:temporary,name));
    res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css','.gz':'application/gzip','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'})[extname(name)]||'text/plain');
    res.setHeader('Cache-Control','no-store');res.end(body);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  const context=await browser.newContext(),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));const url=`http://127.0.0.1:${server.address().port}/along/`;
  await page.goto(url);
  await expect(page.locator('#address-status')).toContainText('ready offline',{timeout:60000});
  await expect.poll(()=>page.evaluate(()=>navigator.serviceWorker.controller?.scriptURL)).toBe(url+'sw.js');
  await page.evaluate(async()=>{
    const prefs=await import('./preferences.js');
    const data={learning:false,journeys:[{from:{id:'upgrade-origin',name:'Upgrade origin',lat:-36.85,lon:174.76},to:{id:'upgrade-destination',name:'Upgrade destination',lat:-36.86,lon:174.77},saved:true,savedRoutes:[{mode:'bus',route:'70'}],count:7,hours:Array(24).fill(0),days:Array(7).fill(0),last:123456}]};
    if(!prefs.writePreferences(data))throw Error('Published preference writer failed');
    localStorage.setItem('along-feedback-v1','retained feedback draft sentinel');
    localStorage.setItem('along-course-notice-v1','understood');
    localStorage.setItem('along-device-preview-journeys-v1','preview remains separate');
  });
  const persistence=()=>page.evaluate(()=>Object.fromEntries(['along-journeys-v1','along-feedback-v1','along-course-notice-v1','along-device-preview-journeys-v1'].map(key=>[key,localStorage.getItem(key)])));
  let before=await persistence();
  const oldTab=await context.newPage();oldTab.on('pageerror',e=>errors.push(e.message));
  await oldTab.goto(url);await expect(oldTab.locator('#address-status')).toContainText('ready offline',{timeout:60000});
  current=true;failShell=true;
  const failed=await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.ready;
    const finished=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('Failed update did not settle')),30000);
      registration.addEventListener('updatefound',()=>{
        const worker=registration.installing;
        worker.addEventListener('statechange',()=>{if(['redundant','installed'].includes(worker.state)){clearTimeout(timeout);resolve(worker.state);}});
      },{once:true});
    });
    await registration.update();return finished;
  });
  assert.equal(failed,'redundant','incomplete shell must not install');
  assert.deepEqual(await persistence(),before);
  assert.ok((await page.evaluate(()=>caches.keys())).includes('along-shell-v37'));
  await context.setOffline(true);await oldTab.reload();
  await expect(oldTab.locator('#address-status')).toContainText('ready offline',{timeout:60000});
  await expect(oldTab.locator('#settings')).toContainText('App version 37');
  await oldTab.evaluate(async()=>{window.oldPrefs=await import('./preferences.js');});
  await context.setOffline(false);failShell=false;
  await page.goto(url+'update.html');await page.locator('#recover-update').click();
  await expect(page.locator('#recovery-status')).toContainText('38',{timeout:60000});
  await page.locator('#recover-update').click();
  await expect(page.locator('#address-status')).toContainText('ready offline',{timeout:60000});
  await expect(page.locator('#settings')).toContainText('App version 38');
  assert.deepEqual(await persistence(),before,'upgrade preserves raw saved preferences and local choices');
  await page.evaluate(async()=>{await(await import('./experiments/at-credentials/app-bootstrap.mjs')).restoration;});
  assert.equal(await page.evaluate(async()=>(await import('./experiments/at-credentials/app-live-bridge.mjs')).createLiveClient().configured),false);
  const cachesAfter=await page.evaluate(()=>caches.keys());assert.ok(cachesAfter.includes('along-shell-v38'));assert.ok(!cachesAfter.includes('along-shell-v37'));
  await page.locator('#settings-open').click();
  await page.getByRole('button',{name:'Device and AT-key setup',exact:true}).click();
  await page.getByRole('button',{name:'Set up my device',exact:true}).click();
  await page.getByRole('button',{name:'Create my device group',exact:true}).click();
  await page.getByRole('heading',{name:'Your devices and AT key',exact:true}).waitFor();
  assert.deepEqual(await persistence(),before,'optional device setup preserves previous journeys');
  const identity=()=>page.evaluate(async()=>{
    const store=await(await import('./experiments/tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');
    try{const p=await store.read('candidate-persona','active');return {revision:p.revision,group:Array.from(p.value.record.group),member:Array.from(p.value.record.subject)};}finally{store.close();}
  });
  const enrolled=await identity();
  // The pre-update page remains v37 even after its controller switches. Its
  // actual published writer can still save a local edit before sharing starts.
  await expect(oldTab.locator('#settings')).toContainText('App version 37');
  await oldTab.evaluate(()=>{
    const data=oldPrefs.readPreferences();data.journeys[0].savedRoutes=[{mode:'bus',route:'75'}];
    data.journeys[0].count+=1;if(!oldPrefs.writePreferences(data))throw Error('Old-tab save failed');
  });
  before=await persistence();
  assert.equal(JSON.parse(before['along-journeys-v1']).journeys[0].count,8);
  assert.equal(JSON.parse(before['along-journeys-v1']).journeys[0].savedRoutes[0].route,'75');
  await oldTab.close();
  await context.setOffline(true);await page.reload();
  await expect(page.locator('#address-status')).toContainText('ready offline',{timeout:60000});
  await page.evaluate(async()=>{await(await import('./experiments/at-credentials/app-bootstrap.mjs')).restoration;});
  assert.deepEqual(await persistence(),before);assert.deepEqual(await identity(),enrolled);
  await page.goto(url+'install.html');
  await expect(page.getByRole('heading',{name:'Scheduled journeys, optional current information',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Optional automatic connection',exact:true})).toBeVisible();
  await expect(page.locator('main')).toContainText('No relay is selected by default.');
  await expect(page.locator('main')).toContainText('Chrome');
  await expect(page.locator('main')).toContainText('Safari');
  await page.setViewportSize({width:320,height:740});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'offline guide fits narrow screen');
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[],'offline guide accessibility');
  await page.locator('#guide-back').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#address-status')).toContainText('ready offline',{timeout:60000});
  assert.deepEqual(await persistence(),before);
  assert.deepEqual(errors,[]);assert.deepEqual(requests.filter(path=>!path.startsWith('/along/')),[],'requests outside app scope');
  console.log('PASS: exact published v37 upgrades in the same /along/ scope to local candidate38; failed shell download leaves v37 available offline; retry preserves saved places, bus70 preference, history, learning choice, feedback and preview sentinel. Device setup retains places; an already-open actual v37 writer saves a bus75 edit, then identity and latest preferences reopen offline. Offline installation/privacy/relay guidance fits 320px and passes axe; keyboard Back preserves places. Optional live remains off; no page errors or app requests outside subpath. Local candidate only, not a release qualification.');
}finally{await browser?.close();await new Promise(r=>server.close(r));await rm(temporary,{recursive:true,force:true});}
