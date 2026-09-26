// Generated app: one invitation link, actual enrollment, deliberate sharing, and relay-delivered saved places. No fixture identities or permissions.
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
let browser,pages,errors=[];
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--ignore-certificate-errors']});
  const contexts=await Promise.all([browser.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:780}}),browser.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:780}})]);
  await Promise.all(contexts.map(context=>context.addInitScript(()=>{window.RTCPeerConnection=class{constructor(){throw Error('Direct WebRTC disabled for guided app test');}};})));
  const [owner,candidate]=await Promise.all(contexts.map(c=>c.newPage()));pages=[owner,candidate];
  let candidateOffline=false;
  await candidate.routeWebSocket('**/r2',socket=>{if(candidateOffline)socket.close({code:1013,reason:'Test offline'});else socket.connectToServer();});
  for(const p of pages)p.on('pageerror',e=>errors.push(e.message));
  const origin=`https://127.0.0.1:${relay.server.address().port}`,endpoint=origin.replace('https:','wss:')+'/r2';
  const url=origin+prefix+(regularCandidate?'':'public/');
  await Promise.all(pages.map(p=>p.goto(url)));
  const choose=async(page,field,query)=>{
    await expect(page.locator('#address-status')).toContainText('ready offline',{timeout:60000});
    const input=page.locator('#'+field);await input.fill(query);
    await expect(page.locator('#'+field+'-options [data-index]').first()).toBeVisible({timeout:30000});
    await input.press('ArrowDown');await input.press('Enter');
  };
  const save=async(page,destination)=>{
    await choose(page,'destination',destination);await page.locator('#destination-next').click();
    await choose(page,'origin','277 Broadway Newmarket');await page.locator('#origin-next').click();
    await page.locator('#save-places').click();await expect(page.locator('#save-places')).toHaveAttribute('aria-pressed','true');
  };
  await save(owner,'10 Victoria Road Devonport');await save(candidate,'1 Queen Street Auckland Central');
  await owner.locator('#settings-open').click();
  await owner.getByRole('button',{name:/^(My devices|Device and AT-key setup)$/,exact:true}).click();
  await owner.getByRole('button',{name:'Connect another device',exact:true}).click();
  assert.equal(await owner.evaluate(async base=>{const store=await(await import(base+'experiments/tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');try{return await store.read('candidate-persona','active');}finally{store.close();}},regularCandidate?'./':'../'),null,'Opening Connect does not create an identity');
  assert.equal(relay.stats().connections,0,'No relay connection before Create invitation');
  await owner.getByRole('button',{name:'Cancel',exact:true}).click();
  await owner.getByRole('button',{name:'Connect another device',exact:true}).click();
  assert.equal(await owner.evaluate(async base=>{const store=await(await import(base+'experiments/tg-pairing/storage.mjs')).openBrowserStorage('along-pairing-lab-v1');try{return await store.read('candidate-persona','active');}finally{store.close();}},regularCandidate?'./':'../'),null,'Cancelling before Create leaves no identity');
  await owner.getByLabel('Relay server address',{exact:true}).fill(endpoint);
  await owner.getByRole('button',{name:'Create invitation',exact:true}).click();
  const link=await owner.getByLabel('Invitation link',{exact:true}).inputValue();
  await candidate.goto(link);
  await candidate.getByRole('heading',{name:'Connect to your other device?',exact:true}).waitFor();
  assert.equal(new URL(candidate.url()).hash,'');
  await candidate.getByRole('button',{name:'Connect and compare codes',exact:true}).click();
  for(const p of pages)await p.getByRole('heading',{name:'Do both devices show this code?',exact:true}).waitFor();
  assert.equal(await owner.locator('.pairing-code').textContent(),await candidate.locator('.pairing-code').textContent());
  for(const p of pages)await p.getByRole('button',{name:'Both devices are here and the codes match',exact:true}).click();
  await candidate.getByRole('heading',{name:'Device connected',exact:true}).waitFor();
  await owner.getByRole('heading',{name:'Connection saved',exact:true}).waitFor();
  for(const p of pages){
    await p.getByRole('button',{name:'Choose what to share',exact:true}).click();
    await p.getByRole('button',{name:'Share and reconnect',exact:true}).click();
    await p.getByRole('heading',{name:'Sharing enabled on this device',exact:true}).waitFor();
    await p.getByRole('button',{name:'Done',exact:true}).click();
    await p.getByRole('button',{name:'Back to settings',exact:true}).click();
    await p.getByRole('button',{name:'Close settings',exact:true}).click();
  }
  const saved=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)).journeys.filter(j=>j.saved),manifest.namespaces?.preferences||'along-journeys-v1');
  for(const p of pages)await expect.poll(async()=>(await saved(p)).length,{timeout:90000}).toBe(2);
  assert.deepEqual((await saved(owner)).map(j=>j.to.id).sort(),(await saved(candidate)).map(j=>j.to.id).sort());
  if(process.env.GUIDED_RECOVERY_APP==='1'){
    const before=await saved(candidate);
    await owner.locator('#settings-open').click();
    await owner.getByRole('button',{name:/^(My devices|Device and AT-key setup)$/,exact:true}).click();
    await owner.getByText('Advanced device options',{exact:true}).click();
    await owner.getByRole('button',{name:'Update group keys on this device',exact:true}).click();
    await owner.getByRole('button',{name:'Update keys on this device',exact:true}).click();
    await owner.getByRole('heading',{name:'Group keys updated on this device',exact:true}).waitFor();
    await owner.getByRole('button',{name:'Back',exact:true}).click();
    await owner.getByText('Advanced device options',{exact:true}).click();
    await owner.getByRole('button',{name:'Send a group key update',exact:true}).click();
    await owner.getByRole('button',{name:/^Device [0-9a-f]/}).click();
    await owner.getByRole('heading',{name:'Update your other device',exact:true}).waitFor();
    assert.equal(await owner.getByLabel('Relay server address',{exact:true}).inputValue(),endpoint,'Uses saved selected relay');
    await owner.getByRole('button',{name:'Create update invitation',exact:true}).click();
    const updateLink=await owner.getByLabel('Update invitation link',{exact:true}).inputValue();
    await candidate.goto(updateLink);
    await candidate.getByRole('heading',{name:'Reconnect for a device update?',exact:true}).waitFor();
    assert.equal(new URL(candidate.url()).hash,'','Actual app startup consumes recovery fragment');
    await candidate.getByRole('button',{name:'Connect and review update',exact:true}).click();
    await candidate.getByRole('button',{name:'Receive group key update',exact:true}).click();
    await candidate.getByRole('heading',{name:'Group keys saved on this device',exact:true}).waitFor();
    await owner.getByRole('heading',{name:'Other device confirmed its keys',exact:true}).waitFor();
    assert.deepEqual(await saved(candidate),before,'Recovery preserves saved places');
    await owner.getByRole('button',{name:'Done',exact:true}).click();
    await owner.getByRole('button',{name:'Back',exact:true}).click();
    await candidate.getByRole('button',{name:'Back',exact:true}).click();
    for(const p of pages){
      await p.getByRole('button',{name:'Back to settings',exact:true}).click();
      await p.getByRole('button',{name:'Close settings',exact:true}).click();
    }
    console.log('PASS: actual generated app rotates keys through UI, selects existing device, opens one recovery link via app bootstrap, reviews and confirms update with saved places preserved; manual exchange remains under Advanced.');
  }
  if(process.env.GUIDED_OFFLINE==='1'){
    // Local test certificate must be trusted by Chromium's service-worker process too.
    await candidate.evaluate(()=>navigator.serviceWorker.ready);
    await candidate.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
    candidateOffline=true;await contexts[1].setOffline(true);await candidate.reload();
    await choose(candidate,'destination','1 Queen Street Auckland Central');await candidate.locator('#destination-next').click();
    await choose(candidate,'origin','277 Broadway Newmarket');await candidate.locator('#origin-next').click();
    await expect(candidate.locator('#save-places')).toHaveAttribute('aria-pressed','true');
    await candidate.locator('#save-places').click();await expect(candidate.locator('#save-places')).toHaveAttribute('aria-pressed','false');
    assert.equal((await saved(candidate)).length,1);assert.equal((await saved(owner)).length,2);
    await candidate.reload();await expect(candidate.locator('#address-status')).toContainText('ready offline',{timeout:60000});
    assert.equal((await saved(candidate)).length,1);assert.equal((await saved(owner)).length,2);
    candidateOffline=false;await contexts[1].setOffline(false);
    await expect.poll(async()=>(await saved(owner)).length,{timeout:90000}).toBe(1);
    await Promise.all(pages.map(p=>p.reload()));
    for(const p of pages)await expect(p.locator('#address-status')).toContainText('ready offline',{timeout:60000});
    for(const p of pages)assert.equal((await saved(p)).length,1);
    assert.deepEqual((await saved(owner)).map(j=>j.to.id),(await saved(candidate)).map(j=>j.to.id));
    console.log('PASS: fresh guided connection preserves an offline saved-place removal across offline reload, then automatically reconnects and propagates it without another invitation; both copies survive online reload. HTTP offline emulation plus explicit WebSocket blocking.');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: generated app on subpath, fresh devices set up through UI, single invitation link, fragment removed, comparison, separate sharing consent and automatic relay delivery of both saved-place pairs; no return QR or separate journey ceremony. Local hive stand-in; no deployed-host or physical acceptance claim.');
}catch(error){console.error('Non-secret app diagnostics:',JSON.stringify({errors,pages:await Promise.all((pages??[]).map(p=>p.evaluate(()=>({hasFragment:Boolean(location.hash),headings:[...document.querySelectorAll('h2')].filter(n=>n.checkVisibility()).map(n=>n.textContent),statuses:[...document.querySelectorAll('[role=status]')].filter(n=>n.checkVisibility()).map(n=>n.textContent),dialogs:[...document.querySelectorAll('dialog[open]')].map(n=>n.getAttribute('aria-label'))})).catch(()=>({closed:true}))))}));throw error;}finally{await browser?.close();await relay.close();}
