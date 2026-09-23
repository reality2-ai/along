import {test,expect} from '@playwright/test';

test('nearby live requests require an explicit action and offline fallback retains departures',async({browser})=>{
 const context=await browser.newContext({serviceWorkers:'block'});
 let requests=0;
 await context.route('**/live-config.js',route=>route.fulfill({contentType:'text/javascript',body:"export const liveBaseURL='./api/';"}));
 await context.route('**/api/predictions',route=>{requests++;return route.fulfill({contentType:'application/json',body:JSON.stringify({available:true,updated:Math.floor(Date.now()/1000),entities:[]})});});
 const page=await context.newPage();await page.goto(process.env.TEST_BASE_URL||'http://127.0.0.1:3080');
 await expect(page.locator('#data-status')).toContainText('session ready',{timeout:60000});
 await page.locator('#nearby-start').click();await page.locator('#try-britomart').click();await page.locator('#find').click();
 await expect(page.locator('.stop-card').first()).toBeVisible();expect(requests).toBe(0);
 await expect(page.locator('#nearby-live-help')).toContainText('locations and journey history are not sent');
 await page.locator('#nearby-live').click();await expect(page.locator('#nearby-live-status')).toContainText('Current feed checked');expect(requests).toBe(1);
 await page.locator('#refresh').click();await expect(page.locator('#refresh')).toBeEnabled();expect(requests).toBe(1);
 await context.setOffline(true);await page.locator('#nearby-live').click();
 await expect(page.locator('#nearby-live-status')).toContainText('Scheduled departures are still available');
 await expect(page.locator('.stop-card').first()).toBeVisible();expect(requests).toBe(1);
 await context.setOffline(false);
 await page.locator('.stop-header .detail-link').first().click();
 await expect(page.locator('#stop-live')).toBeVisible();expect(requests).toBe(1);
 await page.locator('#stop-live').click();await expect(page.locator('#stop-live-status')).toContainText('No live match');expect(requests).toBe(2);
 await expect(page.locator('.departure-board caption')).toContainText('Scheduled');
 await page.locator('#detail-back').click();await expect(page.locator('#information')).not.toBeVisible();
 await context.close();
});
