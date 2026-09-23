import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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

async function openObservedStop(browser,{time=new Date('2026-09-22T21:00:00Z'),workerClock=false}={}){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:360,height:780}});
 await context.route('**/live-config.js',r=>r.fulfill({contentType:'text/javascript',body:"export const liveBaseURL='./api/';"}));
 await context.addInitScript(()=>{
  const Original=Worker;
  window.Worker=class extends Original{
   constructor(...args){super(...args);this.planRequests=new Set();this.stopRequests=new Set();this.addEventListener('message',({data})=>{if(this.stopRequests.has(data.id))window.observedStopRows=data.result;if(this.planRequests.has(data.id))window.observedJourneys=data.result;});}
   postMessage(data,...rest){if(data.type==='stopDetails')this.stopRequests.add(data.id);if(data.type==='plan')this.planRequests.add(data.id);return super.postMessage(data,...rest);}
  };
 });
 if(workerClock)await context.route('**/worker.js',async route=>{
  const response=await route.fetch();
  const prefix=`const TestDate=Date;globalThis.Date=class extends TestDate{constructor(...args){super(...(args.length?args:[${time.getTime()}]));}static now(){return ${time.getTime()};}};\n`;
  await route.fulfill({response,body:prefix+await response.text()});
 });
 const page=await context.newPage();await page.clock.install({time});
 await page.goto(process.env.TEST_BASE_URL||'http://127.0.0.1:3080');
 await expect(page.locator('#data-status')).toContainText('session ready',{timeout:60000});
 await page.locator('#nearby-start').click();await page.locator('#try-britomart').click();await page.locator('#find').click();
 await page.locator('.stop-header .detail-link').first().click();await expect(page.locator('#stop-live')).toBeVisible();
 const rows=await page.evaluate(()=>window.observedStopRows);
 return {page,context,rows};
}

test('matched stop predictions preserve schedule and ordering, then expire',async({browser})=>{
 const {page,context,rows}=await openObservedStop(browser);
 try{
  const seen=new Set(),chosen=[];
  rows.forEach((d,i)=>{if(d.stopVisits===1&&!seen.has(d.trip)&&chosen.length<3){seen.add(d.trip);chosen.push({d,i});}});
  expect(chosen).toHaveLength(3);
  const before=await page.locator('[data-stop-time]').allTextContents();
  const routes=await page.locator('.board-route').allTextContents();
  await context.route('**/api/predictions',async route=>{
   const updated=await page.evaluate(()=>Math.floor(Date.now()/1000));
   const entities=chosen.map(({d},i)=>({trip_update:{timestamp:updated-120,trip:{trip_id:d.trip,start_date:d.serviceDate,route_id:d.routeId,...(i===1?{schedule_relationship:'CANCELED'}:{})},stop_time_update:[{stop_id:d.stop.id,...(i===2?{schedule_relationship:'SKIPPED'}:{departure:{delay:120}})}]}}));
   await route.fulfill({contentType:'application/json',body:JSON.stringify({available:true,updated,entities})});
  });
  await page.locator('#stop-live').click();await expect(page.locator('#stop-live-status')).toContainText('matched to 3');
  for(const [j,label] of ['Expected','Cancelled','Not stopping here'].entries()){
   const cell=page.locator(`[data-stop-time="${chosen[j].i}"]`);await expect(cell).toContainText(label);
   await expect(cell.locator('small')).toHaveText('Scheduled '+before[chosen[j].i]);
  }
  expect(await page.locator('.board-route').allTextContents()).toEqual(routes);
  await expect(page.locator('.departure-board caption')).toHaveText('Departures · scheduled and live');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:'test-results/live-stop-board.png',fullPage:true});
  await page.clock.fastForward(61000);
  await expect(page.locator('#stop-live-status')).toContainText('expired');
  expect(await page.locator('[data-stop-time]').allTextContents()).toEqual(before);
  await expect(page.locator('.departure-board caption')).toContainText('Scheduled');
 }finally{await context.close();}
});

test('leaving a stop cancels its request and a late response cannot change another screen',async({browser})=>{
 const {page,context}=await openObservedStop(browser);
 try{
  let finish;const waiting=new Promise(resolve=>finish=resolve);
  let arrived;const requestArrived=new Promise(resolve=>arrived=resolve);
  await context.route('**/api/predictions',async route=>{arrived();await waiting;await route.fulfill({contentType:'application/json',body:JSON.stringify({available:true,updated:Math.floor(Date.now()/1000),entities:[]})}).catch(()=>{});});
  const failed=page.waitForEvent('requestfailed',{predicate:r=>r.url().endsWith('/api/predictions')});
  await page.locator('#stop-live').click();await requestArrived;
  await page.locator('#detail-back').click();await failed;finish();
  await expect(page.locator('#information')).not.toBeVisible();
  await page.locator('.stop-header .detail-link').first().click();
  await expect(page.locator('#stop-live')).toBeEnabled();await expect(page.locator('#stop-live-status')).toBeEmpty();
 }finally{await context.close();}
});

test('stop alerts disclose only matching service and time scopes, then expire',async({browser})=>{
 const {page,context,rows}=await openObservedStop(browser);
 try{
  const row=rows[0];expect(row).toBeTruthy();
  await context.route('**/api/predictions',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({available:false})}));
  await context.route('**/api/alerts',async route=>{
   const updated=await page.evaluate(()=>Math.floor(Date.now()/1000));
   expect(row.agencyId).toBeTruthy();expect([0,1]).toContain(row.directionId);
   const selected={agency_id:row.agencyId,direction_id:row.directionId,stop_id:row.stop.id,route_id:row.routeId,trip:{trip_id:row.trip,start_date:row.serviceDate}};
   const alerts=[
    {title:'Platform access changed',description:'<img src=x onerror=alert(1)> Use the signposted entrance.',informed_entity:[selected]},
    {title:'Unrelated route',informed_entity:[{...selected,route_id:'not-this-route'}]},
    {title:'Another operator',informed_entity:[{...selected,agency_id:'not-this-operator'}]},
    {title:'Opposite direction',informed_entity:[{...selected,direction_id:1-row.directionId}]},
    {title:'Another service day',informed_entity:[{...selected,trip:{trip_id:row.trip,start_date:'20990101'}}]},
    {title:'Expired disruption',informed_entity:[selected],active_period:[{end:updated-1}]},
   ];
   await route.fulfill({contentType:'application/json',body:JSON.stringify({available:true,updated,alerts})});
  });
  await expect(page.locator('#stop-alerts')).toBeEmpty();
  await page.locator('#stop-live').click();
  await expect(page.locator('#stop-alerts summary')).toHaveText('1 service update for this stop');
  await expect(page.locator('#stop-alerts details')).not.toHaveAttribute('open','');
  await page.locator('#stop-alerts summary').click();
  await expect(page.locator('#stop-alerts')).toContainText('Platform access changed');
  await expect(page.locator('#stop-alerts')).not.toContainText('Unrelated route');await expect(page.locator('#stop-alerts')).not.toContainText('Expired disruption');
  await expect(page.locator('#stop-alerts')).not.toContainText('Another operator');await expect(page.locator('#stop-alerts')).not.toContainText('Opposite direction');
  await expect(page.locator('#stop-alerts img')).toHaveCount(0);
  await expect(page.locator('.departure-board')).toBeVisible();
  await page.clock.fastForward(181000);await expect(page.locator('#stop-alerts')).toContainText('expired');await expect(page.locator('#stop-alerts details')).toHaveCount(0);
 }finally{await context.close();}
});

test('selected journey checks matched predictions and alerts while preserving the chosen route',async({browser})=>{
 const {page,context}=await openObservedStop(browser);
 try{
  await page.locator('#detail-back').click();await page.locator('#new-journey').click();
  for(const [field,query,next] of [['destination','Waitemata Train','destination-next'],['origin','Newmarket Train','origin-next']]){
   await page.locator('#'+field).fill(query);await page.locator('#'+field+'-options [data-index]').first().click();await page.locator('#'+next).click();
  }
  await page.locator('#journey-preferences > summary').click();await page.locator('#date').fill('2026-09-23');await page.locator('#time').fill('09:00');await page.locator('#find').click();
  await page.locator('[data-follow]').first().click();const leg=await page.evaluate(()=>window.observedJourneys[0].legs.find(l=>l.trip));expect(leg).toBeTruthy();
  let requests=0;
  await context.route('**/api/alerts',async route=>{
   requests++;const updated=await page.evaluate(()=>Math.floor(Date.now()/1000));
   const selector={route_id:leg.routeId,trip:{trip_id:leg.trip,start_date:leg.serviceDate}};
   await route.fulfill({contentType:'application/json',body:JSON.stringify({available:true,updated,alerts:[{title:'Relevant service change',description:'Check platform signs.',informed_entity:[selector]},{title:'Wrong day',informed_entity:[{...selector,trip:{trip_id:leg.trip,start_date:'20990101'}}]}]})});
  });
  let predictionKind='predicted',predictionRequests=0;
  await context.route('**/api/predictions',async route=>{
   predictionRequests++;const updated=await page.evaluate(()=>Math.floor(Date.now()/1000));
   const trip={trip_id:leg.trip,start_date:predictionKind==='unmatched'?'20990101':leg.serviceDate,route_id:leg.routeId,start_time:leg.startTime};
   if(predictionKind==='cancelled')trip.schedule_relationship='CANCELED';
   const event={stop_id:leg.from.id,...(predictionKind==='skipped'?{schedule_relationship:'SKIPPED'}:{departure:{delay:120}})};
   await route.fulfill({contentType:'application/json',body:JSON.stringify({available:true,updated,entities:[{trip_update:{timestamp:updated-120,trip,stop_time_update:[event]}}]})});
  });
  const before=await page.locator('#current-step').innerText();expect(requests).toBe(0);expect(predictionRequests).toBe(0);
  await page.locator('#journey-alert-check').click();await expect(page.locator('#journey-alert-status')).toContainText('1 matching service update');
  await expect(page.locator('#journey-prediction-results')).toContainText('Expected');
  await expect(page.locator('#journey-prediction-results')).toContainText('Scheduled');
  await page.locator('#journey-alert-results summary').click();await expect(page.locator('#journey-alert-results')).toContainText('Relevant service change');await expect(page.locator('#journey-alert-results')).not.toContainText('Wrong day');
  expect(await page.locator('#current-step').innerText()).toBe(before);
  await page.clock.fastForward(61000);await expect(page.locator('#journey-prediction-results')).toContainText('expired');
  await expect(page.locator('#journey-alert-results details')).toHaveCount(1);
  await page.clock.fastForward(120000);await expect(page.locator('#journey-alert-status')).toContainText('expired');
  await expect(page.locator('#journey-prediction-results')).toContainText('expired');
  for(const [kind,label] of [['cancelled','Cancelled'],['skipped','Not stopping at your boarding stop'],['unmatched','No live departure match']]){
   predictionKind=kind;await page.locator('#journey-alert-check').click();
   await expect(page.locator('#journey-prediction-results')).toContainText(label);
   expect(await page.locator('#current-step').innerText()).toBe(before);
  }
  await context.setOffline(true);await page.locator('#journey-alert-check').click();await expect(page.locator('#journey-alert-status')).toContainText('scheduled journey is still here');
  expect(await page.locator('#current-step').innerText()).toBe(before);expect(requests).toBe(4);expect(predictionRequests).toBe(4);
  await expect(page.locator('#journey-prediction-results')).toContainText('unavailable');
 }finally{await context.close();}
});

test('nearby predictions expire from the trip measurement without another AT request',async({browser})=>{
 // Playwright's page clock does not replace Date inside a Web Worker.
 const {page,context,rows}=await openObservedStop(browser,{workerClock:true});
 try{
  const row=rows.find(r=>r.stopVisits===1);expect(row).toBeTruthy();
  let requests=0;
  await context.route('**/api/predictions',async route=>{
   requests++;const now=await page.evaluate(()=>Math.floor(Date.now()/1000));
   const trip={trip_id:row.trip,start_date:row.serviceDate,route_id:row.routeId,start_time:row.startTime};
   await route.fulfill({contentType:'application/json',body:JSON.stringify({available:true,updated:now,entities:[{trip_update:{timestamp:now-120,trip,stop_time_update:[{stop_id:row.stop.id,departure:{delay:120}}]}}]})});
  });
  await page.locator('#detail-back').click();await page.locator('#nearby-live').click();
  await expect(page.locator('#nearby-live-status')).toContainText('Current feed checked');
  await expect(page.locator('#nearby-live')).toBeEnabled();
  await page.clock.fastForward(61000);
  await expect(page.locator('#nearby-live-status')).toContainText('expired');
  await expect(page.locator('.stop-card').first()).toBeVisible();expect(requests).toBe(1);
 }finally{await context.close();}
});
