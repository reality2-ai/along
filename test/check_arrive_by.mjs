// Real static candidate, real downloaded data; all task interactions after initial
// preparation run offline. Temporary browser profile, no AT key or relay.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const root=resolve('releases/along-regular-upgrade-candidate');
const manifest=JSON.parse(await readFile(resolve(root,'build-info.json'),'utf8'));
expect(manifest.appVersion).toBe('42');
for(const [name,hash] of Object.entries(manifest.files))expect(createHash('sha256').update(await readFile(resolve(root,name))).digest('hex')).toBe(hash);
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/along/'))throw Error();
  const file=resolve(root,url.pathname.slice(7)||'index.html');if(!file.startsWith(root+sep))throw Error();
  const body=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.gz':'application/gzip','.wasm':'application/wasm','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'})[extname(file)]||'application/octet-stream');res.end(body);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
try{
 const context=await browser.newContext({viewport:{width:360,height:780},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-09-22T20:00:00Z'));
 const url=`http://127.0.0.1:${server.address().port}/along/`;await page.goto(url);
 await expect(page.locator('#address-status')).toContainText('ready offline',{timeout:90000});
 await context.setOffline(true);
 async function choose(field,text){await page.locator('#'+field).fill(text);await expect(page.locator('#'+field+'-options [data-index]').first()).toBeVisible();await page.locator('#'+field).press('ArrowDown');await page.locator('#'+field).press('Enter');await page.locator('#'+field+'-next').click();}
 await choose('destination','10 Victoria Road Devonport');await choose('origin','277 Broadway Newmarket');
 await page.locator('#journey-preferences > summary').click();
 await page.getByLabel('Journey timing',{exact:true}).selectOption('arrive');await page.locator('#date').fill('2026-09-23');await page.locator('#time').fill('09:00');
 await expect(page.locator('#arrive-help')).toBeVisible();await page.locator('#find').click();
 await expect(page.locator('.journey-card').first()).toContainText('08:09 → 08:58',{timeout:45000});
 await expect(page.locator('.journey-card').first()).toContainText('Latest departure');await expect(page.locator('.journey-card').first()).toContainText('Ferry');
 await expect(page.locator('#active-preferences')).toContainText('Arrive by 09:00');
 await expect(page.locator('#announcement')).toContainText('arriving by 09:00');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('along-journeys-v1')).journeys[0].hours[8])).toBe(1);
 await page.locator('#change-search').click();await expect(page.locator('#time-mode')).toHaveValue('arrive');
 await page.locator('#leave-now').click();await expect(page.locator('#time-mode')).toHaveValue('leave');await expect(page.locator('#arrive-help')).toBeHidden();
 await page.locator('#time-mode').selectOption('arrive');await page.locator('#time').fill('09:00');await page.locator('#find').click();
 await expect(page.locator('.journey-card').first()).toContainText('08:09 → 08:58',{timeout:45000});
 await page.locator('[data-follow]').first().click();await page.locator('#prefer-services').click();await expect(page.locator('#prefer-services')).toHaveAttribute('aria-pressed','true');
 await page.reload();await expect(page.locator('#address-status')).toContainText('ready offline',{timeout:60000});
 await expect(page.locator('.usual-card')).toHaveCount(1);await page.locator('.usual-card').click();
 const remove=page.getByRole('button',{name:'Remove this shortcut',exact:true});await expect(remove).toBeVisible({timeout:45000});
 const before=await page.locator('.journey-times').allTextContents();expect(before.length).toBeGreaterThan(0);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const raw=await page.evaluate(()=>localStorage.getItem('along-journeys-v1'));
 await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='along-journeys-v1')throw new DOMException('Test failure','QuotaExceededError');return window.originalSetItem.call(this,k,v);};});
 await remove.click();await expect(page.locator('#preference-write-status')).toBeVisible();await expect(remove).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('along-journeys-v1'))).toBe(raw);
 await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;delete window.originalSetItem;});
 await remove.focus();await page.keyboard.press('Enter');await expect(remove).toBeHidden();
 await expect(page.locator('#shortcut-removal-status')).toContainText('Shortcut removed');await expect(page.locator('#journey-title')).toBeFocused();
 expect(await page.locator('.journey-times').allTextContents()).toEqual(before);
 await page.reload();await expect(page.locator('#address-status')).toContainText('ready offline',{timeout:60000});await expect(page.locator('.usual-card')).toHaveCount(0);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('along-journeys-v1')).journeys)).toEqual([]);expect(errors).toEqual([]);
 console.log('PASS: real static v42 offline Arrive by address/train/ferry/walk deadline; timing summary, ordering, learning departure hour and Leave now reset; open shortcut → options → removal, failed writes, retained results, keyboard/axe/narrow screen and offline reopening. No physical device or external relay.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
