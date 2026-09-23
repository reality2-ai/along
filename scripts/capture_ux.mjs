// Capture real rendered UI with public example addresses and a preserved timetable.
import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3080/';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
try{
 const context=await browser.newContext({viewport:{width:390,height:900},deviceScaleFactor:2,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await mkdir('docs/screenshots',{recursive:true});await page.goto(base);await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:90000});
 async function capture(name){await page.screenshot({path:`docs/screenshots/${name}.png`,fullPage:false});}
 async function choose(field,text){await page.locator('#'+field).fill(text);await page.locator('#'+field+'-options [data-index]').first().click();}
 await capture('01-start');
 await choose('destination','10 Victoria Road Devonport');await page.locator('#destination-next').click();await choose('origin','277 Broadway Newmarket');await page.locator('#origin-next').click();
 await capture('05-save-places');
 await page.locator('#journey-preferences > summary').click();await page.locator('#date').fill('2026-09-23');await page.locator('#time').fill('09:00');await page.locator('#find').click();await expect(page.locator('.journey-card').first()).toBeVisible({timeout:30000});
 await capture('02-journey');await page.locator('[data-follow]').first().click();await expect(page.locator('#current-step')).toContainText('Broadway');await capture('03-follow');
 await page.locator('#new-journey').click();await page.locator('#browse-routes').click();await page.locator('#route-search').fill('70');await page.locator('#route-search-results button').first().click();await page.locator('#detail-body > .route-variant').first().click();await expect(page.locator('#context-map .leaflet-overlay-pane path').first()).toBeVisible();
 // Optional one-viewport street background for a user-requested presentation capture.
 // Automated tests use intercepted tiles; this option is never enabled by CI.
 if(process.env.CAPTURE_STREET_MAP==='1'){
  await page.locator('#map-streets').click();
  await expect.poll(()=>page.locator('#context-map img.leaflet-tile').evaluateAll(images=>images.length>0&&images.every(i=>i.complete&&i.naturalWidth>0)),{timeout:30000}).toBe(true);
 }
 await capture('04-route-map');
 await page.locator('.route-stop-list [data-detail]').first().click();await expect(page.locator('.departure-board')).toBeVisible();
 await page.locator('.departure-board').evaluate(el=>{el.scrollIntoView({block:'start'});document.getElementById('information').scrollTop-=150;});
 await capture('06-departures');
 expect(errors).toEqual([]);console.log(`Captured six equal-size UI states; street background: ${process.env.CAPTURE_STREET_MAP==='1'?'requested for map screenshot':'off'}.`);
 await context.close();
}finally{await browser.close();}
