import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function choose(page,field,query){
  await page.locator('#'+field).fill(query);
  await page.locator('#'+field+'-options [data-index]').first().click();
}
async function plan(page,from='Newmarket Train',to='Waitemata Train',time='08:00'){
  if(await page.locator('#new-journey').isVisible())await page.locator('#new-journey').click();
  await choose(page,'destination',to);await page.locator('#destination-next').click();
  await choose(page,'origin',from);await page.locator('#origin-next').click();
  if(!await page.locator('#journey-preferences').evaluate(el=>el.open))await page.locator('#journey-preferences > summary').click();
  await page.locator('#date').fill('2026-09-23');await page.locator('#time').fill(time);
  await page.locator('#find').click();await expect(page.locator('.journey-card').first()).toBeVisible({timeout:30000});
}
async function audit(page){expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);}

test('guided journey, local learning, manual progress, return and offline reopen',async({page,context})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:60000});
 await expect(page.locator('#destination')).toBeVisible();await expect(page.locator('#origin')).toBeHidden();await expect(page.locator('#journey-panel')).toBeHidden();
 await audit(page);
 const manifest=await page.evaluate(()=>fetch('/manifest.webmanifest').then(r=>r.json()));expect(manifest.icons.some(i=>i.purpose==='maskable')).toBe(true);
 for(const icon of manifest.icons.filter(i=>i.type==='image/png'))expect(await page.evaluate(async src=>{const i=new Image();i.src=src;await i.decode();return `${i.naturalWidth}x${i.naturalHeight}`;},icon.src)).toBe(icon.sizes);
 await plan(page);await expect(page.locator('.journey-card').first()).toContainText('S-C');
 await page.locator('#change-search').click();await page.locator('#save-places').click();await expect(page.locator('#save-places')).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('along-journeys-v1')).journeys.find(j=>j.saved).savedRoutes??null)).toBeNull();await page.locator('#find').click();await expect(page.locator('.journey-card').first()).toBeVisible();
 await expect(page.locator('#origin')).toBeHidden();await expect(page.locator('#destination')).toBeHidden();
 await page.locator('[data-follow]').first().click();await expect(page.locator('#current-step')).toContainText('Newmarket Train Station');
 await page.locator('#prefer-services').click();await expect(page.locator('#prefer-services')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('along-journeys-v1')).journeys.find(j=>j.saved).savedRoutes)).toEqual([{mode:'train',route:'S-C'}]);
 await page.locator('#prefer-services').click();await expect(page.locator('#prefer-services')).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('along-journeys-v1')).journeys.find(j=>j.saved).savedRoutes)).toBeNull();await page.locator('#prefer-services').click();
 await page.locator('#full-itinerary > summary').click();await expect(page.locator('#full-itinerary')).toHaveAttribute('open','');
 await page.locator('#next-leg').click();await expect(page.locator('#arrived-panel')).toBeVisible();
 await page.locator('#return-journey').click();await expect(page.locator('#review-origin')).toContainText('Waitemata');await expect(page.locator('#review-destination')).toContainText('Newmarket');await page.locator('#swap').click();await expect(page.locator('#review-origin')).toContainText('Newmarket');await expect(page.locator('#review-destination')).toContainText('Waitemata');
 await plan(page);await expect(page.locator('.usual-card')).toHaveCount(1);
 await context.setOffline(true);await page.reload();await expect(page.locator('#data-status')).toContainText(/offline ready|Offline · journeys ready/,{timeout:60000});
 expect(await page.evaluate(()=>fetch('/api/status').then(()=>false).catch(()=>true))).toBe(true);
 expect(await page.evaluate(()=>fetch('/icons/maskable-512.png').then(r=>r.ok))).toBe(true);
 await expect(page.locator('.usual-card')).toHaveCount(1);await page.locator('.usual-card').first().click();await expect(page.locator('#journey-panel')).toBeVisible();await expect(page.locator('.journey-card').first()).toBeVisible();await expect(page.locator('#saved-route-context')).toContainText('Train S-C');await page.locator('#use-any-route').click();await expect(page.locator('#saved-route-context')).toBeHidden();await plan(page);
 await page.locator('#new-journey').click();await expect(page.locator('#destination')).toHaveValue('');await expect(page.locator('#origin')).toHaveValue('');
 await page.locator('#settings-open').click();await page.locator('#learning-enabled').uncheck();await page.locator('#clear-history').click();await expect(page.locator('#storage-message')).toContainText('cleared');await page.locator('#settings .close-dialog').click();await expect(page.locator('.usual-section')).toBeHidden();
 expect(errors).toEqual([]);
});

test('mobile nearby flow, touch, location, quiet hierarchy and accessibility',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['geolocation'],geolocation:{latitude:-36.84431,longitude:174.76869}});
 const page=await context.newPage();await page.goto(process.env.TEST_BASE_URL||'http://127.0.0.1:3080');await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:60000});
 await page.screenshot({path:'test-results/guided-start-mobile.png',fullPage:true});
 await page.locator('#nearby-start').tap();await expect(page.locator('#origin')).toBeVisible();await expect(page.locator('#destination')).toBeHidden();
 await page.locator('#try-britomart').tap();await page.locator('#find').tap();await expect(page.locator('.stop-card')).toHaveCount(3);
 await page.locator('#nearby-panel .journey-preferences summary').tap();await page.locator('#nearby-mode').selectOption('bus');await expect(page.locator('.stop-card').first()).toBeVisible();await audit(page);
 await page.locator('#direct-only').check();await expect(page.locator('#departures')).toContainText('Choose a destination');await page.locator('#direct-only').uncheck();
 await page.locator('#nearby-edit').tap();await page.locator('#edit-origin').tap();await page.locator('#location').tap();await expect(page.locator('#origin')).toHaveValue('Current location');await page.locator('#origin-next').tap();await page.locator('#find').tap();
 await expect(page.locator('#nearby-context')).toContainText('your location');await expect(page.locator('.stop-card').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/guided-nearby-mobile.png',fullPage:true});await context.close();
});

test('address journey, back preserves choices, access errors and explicit progression',async({page,context})=>{
 await page.goto('/');await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:60000});
 await plan(page,'277 Broadway Newmarket','10 Victoria Road Devonport','09:00');await expect(page.locator('.journey-card').first()).toContainText('Ferry');await audit(page);
 const routeInfo=page.locator('.journey-card .journey-path [data-detail]').first();await routeInfo.click();await expect(page.locator('#information')).toBeVisible();
 const stopInfo=page.locator('#detail-body [data-detail]').first();await stopInfo.click();await expect(page.locator('#detail-body')).toContainText('Accessibility');await page.goBack();await expect(page.locator('#detail-title')).toHaveText('Walking connection');await expect(page.locator('#detail-body [data-detail]').first()).toBeFocused();
 await page.keyboard.press('Escape');await expect(page.locator('#information')).not.toBeVisible();await expect(routeInfo).toBeFocused();await expect(page.locator('#journey-panel')).toBeVisible();
 await page.locator('[data-follow]').first().click();await expect(page.locator('#current-step')).toContainText('277 Broadway');await expect(page.locator('#current-step .walk-directions')).toBeVisible();
 await page.locator('#current-step [data-detail]').first().click();await audit(page);await page.locator('#detail-back').click();await expect(page.locator('#step-count')).toHaveText('Step 1 of 5');
 await page.locator('#next-leg').click();await expect(page.locator('#step-count')).toHaveText('Step 2 of 5');await page.locator('#previous-leg').click();await expect(page.locator('#step-count')).toHaveText('Step 1 of 5');await audit(page);
 await page.locator('#full-itinerary > summary').click();await expect(page.locator('#itinerary-legs .leg').last()).toContainText('10 Victoria Road');
 await page.locator('#flow-back').click();await expect(page.locator('#journey-panel')).toBeVisible();await page.locator('#change-search').click();
 await expect(page.locator('#review-origin')).toContainText('277 Broadway');await expect(page.locator('#review-destination')).toContainText('10 Victoria Road');
 await page.locator('#confirmed-access').check();await page.locator('#find').click();await expect(page.locator('#form-error')).toContainText('does not confirm accessibility');await expect(page.locator('[data-screen="review"]')).toBeVisible();await page.locator('#confirmed-access').uncheck();
 await context.setOffline(true);await page.reload();await expect(page.locator('#data-status')).toContainText(/ready/,{timeout:60000});
 await plan(page,'277 Broadway Newmarket','1 Queen Street Auckland Central','09:00');await page.locator('[data-follow]').first().click();
 await page.setViewportSize({width:320,height:800});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/guided-follow-mobile.png',fullPage:true});
});

test('route exploration maps, street-name matches, stop times and offline nested Back',async({page,context})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:60000});
 await page.locator('#browse-routes').click();await page.locator('#route-search').fill('70');await page.locator('#route-search-results button').first().click();
 await page.locator('#detail-body > .route-variant').first().click();await expect(page.locator('#context-map .leaflet-overlay-pane path').first()).toBeVisible();
 await page.locator('#context-map path.leaflet-interactive').nth(1).click({force:true});await expect(page.locator('#detail-body')).toContainText('Departures from');await page.locator('#detail-back').click();await expect(page.locator('#route-stop-filter')).toBeVisible();
 let tileRequests=0;await page.route('https://tile.openstreetmap.org/**',route=>{tileRequests++;return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});});
 await page.locator('#map-streets').click();await expect.poll(()=>tileRequests).toBeGreaterThan(0);
 await page.locator('#route-stop-filter').fill('Symonds');await expect(page.locator('.route-stop-list li:visible').first()).toContainText('Symonds');await expect(page.locator('#route-match-status')).not.toHaveText('0 matching stops in this direction');await audit(page);
 await page.locator('.route-stop-list li:visible [data-detail]').first().click();await expect(page.locator('#detail-body')).toContainText('Departures from');await expect(page.locator('#context-map')).toBeVisible();
 await page.goBack();await expect(page.locator('#route-stop-filter')).toHaveValue('symonds');await expect(page.locator('.route-stop-list li:visible [data-detail]').first()).toBeFocused();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/route-map-mobile.png',fullPage:true});
 await context.setOffline(true);await page.reload();await expect(page.locator('#data-status')).toContainText(/ready/,{timeout:60000});
 await page.locator('#browse-routes').click();await page.locator('#route-search').fill('70');await page.locator('#route-search-results button').first().click();await page.locator('#detail-body > .route-variant').first().click();await expect(page.locator('#context-map .leaflet-overlay-pane path').first()).toBeVisible();
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');await expect(page.locator('#route-search')).toHaveValue('70');await page.keyboard.press('Escape');await expect(page.locator('#destination')).toBeVisible();expect(errors).toEqual([]);
});

test('course acknowledgement frees phone space, remains available and survives offline reopening',async({browser})=>{
 const context=await browser.newContext({viewport:{width:360,height:780},isMobile:true,hasTouch:true});
 const page=await context.newPage();await page.goto(process.env.TEST_BASE_URL||'http://127.0.0.1:3080');
 await expect(page.locator('#data-status')).toContainText('offline ready',{timeout:60000});
 await expect(page.locator('#course-notice')).toHaveAttribute('open','');
 const before=(await page.locator('#flow-title').boundingBox()).y;
 await page.locator('#course-understood').click();
 await expect(page.locator('footer #course-notice')).toBeAttached();
 await expect(page.locator('#course-notice')).not.toHaveAttribute('open','');
 await expect(page.locator('#course-notice summary')).toHaveText('Use at your own risk');
 await expect(page.locator('#flow-title')).toBeFocused();
 expect(before-(await page.locator('#flow-title').boundingBox()).y).toBeGreaterThan(100);
 await page.locator('#course-notice summary').click();await expect(page.locator('#course-notice')).toHaveAttribute('open','');
 await expect(page.locator('#course-notice')).toContainText('Experimental, not an official AT app');
 await page.locator('#course-notice summary').click();
 await choose(page,'destination','10 Victoria Road Devonport');await page.locator('#destination-next').click();
 await choose(page,'origin','277 Broadway Newmarket');await page.locator('#origin-next').click();
 await page.evaluate(()=>scrollTo(0,0));const find=await page.locator('#find').boundingBox();expect(find.y+find.height).toBeLessThanOrEqual(780);
 await audit(page);await page.screenshot({path:'test-results/review-acknowledged-mobile.png',fullPage:false});
 await context.setOffline(true);await page.reload();await expect(page.locator('#data-status')).toContainText(/ready/,{timeout:60000});
 await expect(page.locator('footer #course-notice')).toBeAttached();await expect(page.locator('#course-notice')).not.toHaveAttribute('open','');
 await page.locator('#settings-open').click();await expect(page.locator('#settings')).toContainText('Use at your own risk');
 await context.close();
});

test('course acknowledgement still works for the session when storage is blocked',async({page})=>{
 await page.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='along-course-notice-v1')throw new Error('Storage blocked');return original.call(this,key,value);};});
 await page.goto('/');await page.locator('#course-understood').click();
 await expect(page.locator('footer #course-notice')).toBeAttached();await expect(page.locator('#course-notice')).not.toHaveAttribute('open','');
 await page.reload();await expect(page.locator('#course-notice')).toHaveAttribute('open','');
});
