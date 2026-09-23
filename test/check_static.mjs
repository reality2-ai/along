// A genuine static subpath host: no Python API routes or proxy.
import {createServer} from 'node:http';
import {readFile,stat,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
await stat(root);
const prefix='/along/';
let datasetRevision=0;
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(!url.pathname.startsWith(prefix))throw new Error('Outside app');
    const file=resolve(root,decodeURIComponent(url.pathname.slice(prefix.length))||'index.html');
    if(!file.startsWith(root))throw new Error('Outside app');
    let body=await readFile(file);
    if(datasetRevision&&url.pathname.endsWith('/data/network.json.gz')){
      const network=JSON.parse(gunzipSync(body));
      network.metadata.feed_version=`refresh-regression-${datasetRevision}`;
      body=gzipSync(JSON.stringify(network));
    }
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.gz':'application/gzip','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.json':'application/json'};
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'text/plain','Cache-Control':'no-cache'});res.end(body);
  }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
await mkdir('test-results',{recursive:true});
const profile=await mkdtemp('.along-static-profile-');
const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH||undefined,viewport:{width:1280,height:900},reducedMotion:'reduce'});
const browser=context.browser();
const measurements={runtime:process.version,browser:browser.version(),host:'Local static HTTP, repository subpath, Chromium desktop',physicalPhone:false};
try{

 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const start=performance.now();await page.goto(origin+prefix);
 await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:90000});
 await expect(page.locator('#app-update')).toBeHidden();
 measurements.coldReadyMs=Math.round(performance.now()-start);
 const manifest=await page.evaluate(()=>fetch('./manifest.webmanifest').then(r=>r.json()));
 expect(manifest.start_url).toBe('./');expect(manifest.scope).toBe('./');
 expect(manifest.icons.some(i=>i.purpose==='maskable')).toBe(true);
 const cdp=await context.newCDPSession(page);await cdp.send('Page.enable');
 measurements.installability=await cdp.send('Page.getInstallabilityErrors');
 expect(measurements.installability.installabilityErrors).toEqual([]);
 // Real keyboard selection, including accessibility-tree names and states.
 async function choose(field,query){
   const input=page.locator('#'+field);await input.focus();await input.fill(query);
   await expect(page.locator('#'+field+'-options [data-index]').first()).toBeVisible();
   await input.press('ArrowDown');await expect(input).toHaveAttribute('aria-activedescendant',field+'-option-0');
   await input.press('Enter');await expect(input).toHaveAttribute('aria-expanded','false');
 }
 await choose('destination','10 Victoria Road Devonport');await page.locator('#destination-next').focus();await page.keyboard.press('Enter');
 await choose('origin','277 Broadway Newmarket');await page.locator('#origin-next').focus();await page.keyboard.press('Enter');
 await page.locator('#journey-preferences > summary').focus();await page.keyboard.press('Enter');
 await page.locator('#date').fill('2026-09-23');await page.locator('#time').fill('09:00');
 const routeStart=performance.now();await page.locator('#find').focus();await page.keyboard.press('Enter');
 await expect(page.locator('.journey-card').first()).toBeVisible({timeout:30000});
 measurements.mixedModeRouteMs=Math.round(performance.now()-routeStart);
 await expect(page.locator('.journey-card').first()).toContainText('Ferry');
 await expect(page.locator('#journey-title')).toBeFocused();
 await page.locator('[data-follow]').first().focus();await page.keyboard.press('Enter');
 await page.locator('#full-itinerary > summary').focus();await page.keyboard.press('Enter');
 await expect(page.locator('.leg').first()).toBeVisible();
 await page.locator('#save-journey').click();await expect(page.locator('#save-journey')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.journey-steps').first()).toHaveAttribute('open','');
 await expect(page.locator('#save-journey')).toBeFocused();
 const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(audit.violations).toEqual([]);
 await mkdir('test-results',{recursive:true});
 await writeFile('test-results/accessibility-tree.txt',await page.locator('main').ariaSnapshot());
 await page.screenshot({path:'test-results/static-desktop.png',fullPage:true});
 await page.evaluate(()=>document.documentElement.style.zoom='2');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.evaluate(()=>document.documentElement.style.zoom='');
 await page.setViewportSize({width:320,height:800});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});
 await page.screenshot({path:'test-results/static-forced-colors.png',fullPage:true});
 await page.emulateMedia({forcedColors:'none',reducedMotion:'reduce'});
 await page.screenshot({path:'test-results/static-mobile.png',fullPage:true});
 measurements.datasetBytes=Object.values(JSON.parse(await readFile(resolve(root,'build-info.json'),'utf8')).datasets).reduce((n,d)=>n+d.bytes,0);
 measurements.storage=await page.evaluate(()=>navigator.storage.estimate());
 measurements.mainPageResourceTransferBytes=await page.evaluate(()=>performance.getEntriesByType('resource').reduce((n,r)=>n+r.transferSize,0));
 // A failed walking-map refresh must retain the current map and saved journeys.
 datasetRevision=1;
 await page.route('**/data/streets.json.gz',route=>route.abort());
 await page.locator('#settings-open').click();await page.locator('#update-timetable').click();
 await expect(page.locator('#update-timetable')).toBeEnabled({timeout:60000});
 await expect(page.locator('#address-status')).toContainText(/downloaded|fetch/i);
 await page.locator('#settings .close-dialog').click();
 await page.locator('#flow-back').click();await page.locator('#change-search').click();
 await page.locator('#find').click();await expect(page.locator('.journey-card').first()).toBeVisible({timeout:30000});
 await page.locator('[data-follow]').first().click();
 // A successful refresh must replace the stored timetable without losing the
 // walking/address bundles or personalisation. Change provenance, not schedules.
 await page.unroute('**/data/streets.json.gz');datasetRevision=2;
 await page.locator('#settings-open').click();await page.locator('#update-timetable').click();
 await expect(page.locator('#update-timetable')).toBeEnabled({timeout:60000});
 await expect(page.locator('#address-status')).toContainText('ready offline');
 const stored=await page.evaluate(()=>new Promise((resolve,reject)=>{
   const open=indexedDB.open('along-offline');open.onerror=()=>reject(open.error);
   open.onsuccess=()=>{const db=open.result,tx=db.transaction('timetable'),store=tx.objectStore('timetable');
     const network=store.get('network'),keys=store.getAllKeys();
     tx.oncomplete=()=>{db.close();resolve({version:network.result.metadata.feed_version,keys:keys.result});};
     tx.onerror=()=>reject(tx.error);
   };
 }));
 expect(stored.version).toBe('refresh-regression-2');expect(stored.keys.sort()).toEqual(['addresses','network','routes','streets']);
 await page.locator('#settings .close-dialog').click();
 await expect(page.locator('#save-journey')).toHaveAttribute('aria-pressed','true');
 await context.setOffline(true);const warm=performance.now();await page.reload();
 await expect(page.locator('#data-status')).toContainText(/(?:offline ready|Offline · journeys ready)/,{timeout:90000});
 measurements.offlineReadyMs=Math.round(performance.now()-warm);
 expect(await page.evaluate(()=>fetch('./build-info.json?offline-check=1',{cache:'no-store'}).then(()=>false).catch(()=>true))).toBe(true);
 await expect(page.locator('.usual-card')).toHaveCount(1);
 await choose('destination','1 Queen Street Auckland Central');await page.locator('#destination-next').click();
 await choose('origin','277 Broadway Newmarket');await page.locator('#origin-next').click();
 await page.locator('#journey-preferences > summary').click();await page.locator('#date').fill('2026-09-23');await page.locator('#time').fill('09:00');
 await page.locator('#find').click();await expect(page.locator('.journey-card').first()).toBeVisible({timeout:30000});
 // The help itself remains available when the host is unreachable.
 await page.goto(origin+prefix+'install.html');await expect(page.locator('h1')).toContainText('offline');
 await expect(page.locator('main')).toContainText('Your journey searches');
 for(const name of ['Chrome — Windows','Edge — Windows','Brave — Windows','Safari — macOS','Safari — iPhone'])await expect(page.locator('summary').filter({hasText:name})).toBeVisible();
 await page.locator('summary').filter({hasText:'Brave — Windows'}).click();
 await page.setViewportSize({width:320,height:800});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 expect(errors).toEqual([]);
 await writeFile('test-results/static-metrics.json',JSON.stringify(measurements,null,2)+'\n');
 console.log(JSON.stringify(measurements,null,2));
 console.log('PASS: static subpath installability, keyboard and AX semantics, contrast, 200% zoom, 320px reflow, failed and successful data refresh, offline address routing and saved journey.');
}finally{await context.close();await rm(profile,{recursive:true,force:true});server.closeAllConnections();await new Promise(r=>server.close(r));}
