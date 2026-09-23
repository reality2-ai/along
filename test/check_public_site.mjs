// Explicitly requested deployment smoke check; no external map tiles are fetched.
import {chromium,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
const base=process.env.TEST_BASE_URL;if(!base)throw new Error('Set TEST_BASE_URL to the deployed app URL, including trailing slash.');
const profile=await mkdtemp('.along-static-profile-public-');
const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH||undefined,viewport:{width:390,height:844}});
try{
 await context.addInitScript(()=>localStorage.setItem('along-language-v1','mi'));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:120000});
 await expect(page.locator('.course-notice')).toContainText('Use at your own risk');
 const scope=await page.evaluate(async()=> (await navigator.serviceWorker.ready).scope);expect(scope).toBe(base);
 const cdp=await context.newCDPSession(page);await cdp.send('Page.enable');expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
 await page.locator('#settings-open').click();await expect(page.locator('#settings')).toContainText('App version 31');await expect(page.locator('#settings a[href="https://github.com/reality2-ai/along"]')).toBeVisible();await expect(page.locator('#course-details')).not.toHaveAttribute('open','');await page.locator('#course-details > summary').click();await expect(page.locator('#course-details')).toContainText('No coding by the human is required');await expect(page.locator('#course-details a')).toHaveCount(3);await page.locator('#settings .close-dialog').click();
 await context.setOffline(true);await page.reload();await expect(page.locator('#data-status')).toContainText(/ready/,{timeout:60000});
 async function choose(field,value){await page.locator('#'+field).fill(value);await page.locator('#'+field+'-options [data-index]').first().click();}
 await choose('destination','1 Queen Street Auckland Central');await page.locator('#destination-next').click();await choose('origin','277 Broadway Newmarket');await page.locator('#origin-next').click();await page.locator('#journey-preferences > summary').click();await page.locator('#date').fill('2026-09-23');await page.locator('#time').fill('09:00');await page.locator('#find').click();await expect(page.locator('.journey-card').first()).toBeVisible({timeout:30000});
 await page.locator('#journey-notes > summary').click();await page.locator('#journey-notes [data-feedback-open]').click();
 await page.locator('#feedback-message').fill('Deployment check draft, kept offline and not submitted.');await page.locator('#feedback-review').click();
 const report=await page.locator('#feedback-body').inputValue();expect(report).not.toContain('Broadway');expect(report).not.toContain('Shared context');await page.locator('#feedback-close').click();
 await page.reload();await expect(page.locator('#flow-title')).toHaveText('Where would you like to go?');
 await expect(page.locator('#language-choice')).toHaveCount(0);
 await page.locator('#settings-open').click();await page.locator('#settings [data-feedback-open]').click();await expect(page.locator('#feedback-title')).toHaveText('Feedback on Along');await expect(page.locator('#feedback-message')).toHaveValue('Deployment check draft, kept offline and not submitted.');await page.locator('#feedback-close').click();await page.locator('#settings .close-dialog').click();
 await page.goto(base+'install.html');await expect(page.locator('h1')).toContainText('offline');await expect(page.locator('#guide-language-choice')).toHaveCount(0);await expect(page.locator('main')).toContainText('It does not show live bus, train or ferry positions');expect(errors).toEqual([]);
 console.log(JSON.stringify({url:base,appVersion:31,workerScope:scope,installability:true,settingsAboutLink:true,offlineNewAddressJourney:true,offlineInstallGuide:true,englishOnly:true,offlineFeedbackDraft:true,pageErrors:errors},null,2));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
