import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('route vehicle check is explicit, dated, expires, and clears when the run changes',async({browser})=>{
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:360,height:780}});
 try{
  await context.route('**/live-config.js',r=>r.fulfill({contentType:'text/javascript',body:"export const liveBaseURL='./api/';"}));
  await context.addInitScript(()=>{
   const Original=Worker;
   window.Worker=class extends Original{
    constructor(...args){super(...args);this.routes=new Set();this.addEventListener('message',({data})=>{if(this.routes.has(data.id))window.observedRoute=data.result;});}
    postMessage(data,...rest){if(data.type==='routeDetails')this.routes.add(data.id);return super.postMessage(data,...rest);}
   };
  });
  const page=await context.newPage();await page.clock.install({time:new Date('2026-09-22T21:00:00Z')});
  await page.goto(process.env.TEST_BASE_URL||'http://127.0.0.1:3080');await expect(page.locator('#data-status')).toContainText('session ready',{timeout:60000});
  await page.locator('#browse-routes').click();await page.locator('#route-search').fill('70');await page.locator('#route-search-results button').first().click();await page.locator('#detail-body > .route-variant').first().click();
  const data=await page.evaluate(()=>window.observedRoute),v=data.variants[0],run=v.runs.find(r=>r.trip===v.selectedTrip);
  let requests=0,wrongDate=false;
  await context.route('**/api/vehicles',async route=>{
   requests++;const now=await page.evaluate(()=>Math.floor(Date.now()/1000));
   const body={available:true,updated:now,entities:[{vehicle:{trip:{trip_id:run.trip,route_id:data.id,start_date:wrongDate?'20990101':data.date.replaceAll('-','')},timestamp:now-10,position:{latitude:run.stops[0].stop.lat,longitude:run.stops[0].stop.lon}}}]};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  const marker=page.locator('#context-map path[fill="#884400"]');expect(requests).toBe(0);await expect(marker).toHaveCount(0);
  await page.locator('#route-vehicle').click();await expect(page.locator('#route-vehicle-status')).toContainText('Vehicle position reported');await expect(marker).toHaveCount(1);
  await expect(page.locator('#route-vehicle-status')).toContainText('0 metres in a straight line from '+run.stops[0].stop.name);
  await page.screenshot({path:'test-results/live-vehicle-route.png',fullPage:true});
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.clock.fastForward(171000);await expect(page.locator('#route-vehicle-status')).toContainText('expired');await expect(marker).toHaveCount(0);
  wrongDate=true;await page.locator('#route-vehicle').click();await expect(page.locator('#route-vehicle-status')).toContainText('No current position');await expect(marker).toHaveCount(0);
  wrongDate=false;await page.locator('#route-vehicle').click();await expect(marker).toHaveCount(1);
  const other=v.runs.find(r=>r.trip!==run.trip);expect(other).toBeTruthy();await page.locator('#route-run').selectOption(other.trip);
  await expect(marker).toHaveCount(0);await expect(page.locator('#route-vehicle-status')).toBeEmpty();expect(requests).toBe(3);
  await context.setOffline(true);await page.locator('#route-vehicle').click();await expect(page.locator('#route-vehicle-status')).toContainText('scheduled route is still shown');expect(requests).toBe(3);
  await expect(page.locator('.route-stop-list')).toBeVisible();
 }finally{await context.close();}
});
