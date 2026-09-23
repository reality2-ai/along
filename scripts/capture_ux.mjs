// Capture real rendered UI with public example addresses and a preserved timetable.
import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3080/';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await mkdir('docs/screenshots',{recursive:true});await page.goto(base);await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:90000});
 async function capture(name){await page.screenshot({path:`docs/screenshots/${name}.png`,fullPage:true});}
 async function choose(field,text){await page.locator('#'+field).fill(text);await page.locator('#'+field+'-options [data-index]').first().click();}
 await capture('01-start');
 await choose('destination','10 Victoria Road Devonport');await page.locator('#destination-next').click();await choose('origin','277 Broadway Newmarket');await page.locator('#origin-next').click();
 await page.locator('#journey-preferences > summary').click();await page.locator('#date').fill('2026-09-23');await page.locator('#time').fill('09:00');await page.locator('#find').click();await expect(page.locator('.journey-card').first()).toBeVisible({timeout:30000});
 await capture('02-journey');await page.locator('[data-follow]').first().click();await expect(page.locator('#current-step')).toContainText('Broadway');await capture('03-follow');
 await page.locator('#new-journey').click();await page.locator('#browse-routes').click();await page.locator('#route-search').fill('70');await page.locator('#route-search-results button').first().click();await page.locator('#detail-body > .route-variant').first().click();await expect(page.locator('#context-map .leaflet-overlay-pane path').first()).toBeVisible();
 await page.setViewportSize({width:390,height:960});await capture('04-route-map');
 expect(errors).toEqual([]);console.log('Captured four real UI states without requesting online street tiles.');
 await context.close();
}finally{await browser.close();}
