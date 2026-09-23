import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['journey-live-view.mjs', 'stop-live-view.mjs', '../../public/live-predictions.js', '../../public/live-context.js', '../../public/live-time.js', '../tg-pairing/comparison.css']) sources.set(name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
const server = createServer((req, res) => {
  const name = req.url.split('/').pop(), body = sources.get(name);
  res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : body ? 'text/javascript' : 'text/html');
  res.end(body || '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stop live check</title><link rel="stylesheet" href="/comparison.css"><main><h1>Stop departures</h1><p id="schedule">70 to Example: scheduled 09:00</p><div id="live"></div></main></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext({viewport: {width: 320, height: 640}});
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const {aucklandWallEpoch} = await import('./live-time.js');
    window.checkedAt = aucklandWallEpoch('2026-09-24', 9 * 3600);
    window.row = {trip: 'verified-trip', serviceDate: '20260924', routeId: 'route-70', route: '70', headsign: 'Example', startTime: '09:00:00', departure: 32400, stop: {id: 'verified-stop'}, stopSequence: 4, stopVisits: 1};
    window.feeds = {
      predictions: {available: true, updated: checkedAt, entities: [
        {trip_update: {trip: {trip_id: row.trip, route_id: row.routeId, start_date: row.serviceDate}, stop_time_update: [{stop_id: row.stop.id, stop_sequence: 4, departure: {delay: 120}}]}},
        {trip_update: {trip: {trip_id: 'unrelated', start_date: row.serviceDate}, stop_time_update: []}},
      ]},
      alerts: {available: true, updated: checkedAt, alerts: [
        {title: 'Relevant notice', description: '<img src=x onerror=alert(1)>', informed_entity: [{stop_id: row.stop.id}], active_period: []},
        {title: 'Unrelated notice', description: 'Do not display', informed_entity: [{stop_id: 'elsewhere'}], active_period: []},
      ]},
    };
    window.calls = []; window.cancels = 0; window.hold = false;
    window.client = {read: async (kind, options) => {
      calls.push({kind, options}); if (hold) await new Promise(resolve => { (window.releases ||= []).push(resolve); });
      return structuredClone(feeds[kind]);
    }, cancel: () => { cancels++; }};
    window.module = await import('./stop-live-view.mjs');
    window.mount = () => module.showStopLiveUpdates(document.querySelector('#live'), {client, place: row.stop, rows: [row], at: {date: '2026-09-24', seconds: 32400}, now: () => checkedAt});
    window.before = JSON.stringify(row); window.view = mount();
  });
  assert.equal(await page.evaluate(() => calls.length), 0);
  await page.evaluate(() => document.querySelector('#live button').click());
  assert.equal(await page.evaluate(() => calls.length), 0);
  await page.getByRole('button', {name: 'Check live times and alerts', exact: true}).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('status').filter({hasText: '1 matching departure update and 1 service update'}).waitFor();
  assert.match(await page.locator('#live').textContent(), /Expected 09:02 on 24 Sep/);
  assert.equal(await page.getByText('Unrelated notice', {exact: true}).count(), 0);
  assert.equal(await page.locator('#live img').count(), 0);
  assert.equal(await page.locator('#schedule').textContent(), '70 to Example: scheduled 09:00');
  assert.equal(await page.evaluate(() => JSON.stringify(row) === before), true);
  assert.deepEqual(await page.evaluate(() => calls), [{kind: 'predictions', options: {requested: true}}, {kind: 'alerts', options: {requested: true}}]);
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.clock.fastForward(180001);
  await page.getByRole('status').filter({hasText: 'Live information has expired'}).waitFor();
  assert.equal(await page.getByText('Relevant notice', {exact: true}).count(), 0);
  // Feed timestamp is current but wrong dated trip and unrelated alerts cannot match.
  await page.evaluate(() => { feeds.predictions.entities[0].trip_update.trip.start_date = '20260925'; feeds.alerts.alerts.splice(0, 1); });
  await page.getByRole('button', {name: 'Check live times and alerts'}).click();
  await page.getByRole('status').filter({hasText: 'No matching live information'}).waitFor();
  // Disposal ignores late responses even if the client fails to honour cancel.
  await page.evaluate(() => { hold = true; });
  await page.getByRole('button', {name: 'Check live times and alerts'}).click();
  await page.waitForFunction(() => window.releases?.length === 2);
  await page.evaluate(() => { view.dispose(); document.querySelector('#live').textContent = 'Different stop'; releases.forEach(resolve => resolve()); });
  assert.equal(await page.locator('#live').textContent(), 'Different stop');
  assert.equal(await page.evaluate(() => cancels), 1);
  await page.evaluate(() => { hold = false; feeds.predictions = feeds.alerts = {available: false}; window.view = mount(); });
  await page.getByRole('button', {name: 'Check live times and alerts'}).click();
  await page.getByRole('status').filter({hasText: 'Scheduled times remain unchanged'}).waitFor();
  assert.equal(await page.locator('#schedule').textContent(), '70 to Example: scheduled 09:00');
  await page.evaluate(() => view.dispose());
  await page.evaluate(async () => {
    window.journeyModule = await import('./journey-live-view.mjs');
    const leg = (trip, route, from, departure) => ({mode: 'bus', trip, route, routeId: route, from: {id: from, name: from}, serviceDate: '20260924', stopSequence: 1, departure, arrival: departure + 600,
      calls: [{stopId: from, arrival: departure, departure}, {stopId: 'intermediate-' + trip, arrival: departure + 300, departure: departure + 300}]});
    window.journey = {legs: [leg('completed-trip', 'OLD', 'Completed stop', 31000), {mode: 'walk'}, leg('bus-trip', '70', 'Bus stop', 32400), {...leg('train-trip', 'WEST', 'Train station', 33600), mode: 'train'}, {...leg('ferry-trip', 'DEV', 'Wharf', 34800), mode: 'ferry'}]};
    window.journeyBefore = JSON.stringify(journey);
    const entity = (trip, route, relationship, stopRelationship) => ({trip_update: {trip: {trip_id: trip, route_id: route, start_date: '20260924', schedule_relationship: relationship}, stop_time_update: [{stop_sequence: 1, schedule_relationship: stopRelationship, departure: {delay: 60}}]}});
    feeds.predictions = {available: true, updated: checkedAt, entities: [entity('completed-trip', 'OLD', 'CANCELED'), entity('bus-trip', '70', 'SCHEDULED'), entity('train-trip', 'WEST', 'CANCELED'), entity('ferry-trip', 'DEV', 'SCHEDULED', 'SKIPPED')]};
    feeds.alerts = {available: true, updated: checkedAt, alerts: [
      {title: 'Completed route notice', description: '', informed_entity: [{route_id: 'OLD'}], active_period: []},
      {title: 'Remaining bus notice', description: '', informed_entity: [{route_id: '70'}], active_period: []},
      {title: 'Intermediate station notice', description: '', informed_entity: [{stop_id: 'intermediate-train-trip'}], active_period: []},
    ]};
    window.view = journeyModule.showJourneyLiveUpdates(document.querySelector('#live'), {client, journey, date: '2026-09-24', currentLeg: 1, now: () => checkedAt});
  });
  await page.getByRole('button', {name: 'Check live times and alerts'}).click();
  await page.getByRole('status').filter({hasText: '3 matching departure updates and 2 service updates'}).waitFor();
  const journeyText = await page.locator('#live').textContent();
  assert.match(journeyText, /70 from Bus stop: Expected 09:01/);
  assert.match(journeyText, /WEST from Train station: Cancelled/);
  assert.match(journeyText, /DEV from Wharf: Not stopping here/);
  assert.equal(journeyText.includes('Completed'), false);
  assert.equal(await page.evaluate(() => JSON.stringify(journey) === journeyBefore), true);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => { window.view = journeyModule.showJourneyLiveUpdates(document.querySelector('#live'), {client, journey, date: '2026-09-24', currentLeg: journey.legs.length}); });
  assert.equal(await page.getByRole('button', {name: 'Check live times and alerts'}).count(), 0);
  await page.getByRole('status').filter({hasText: 'No remaining public-transport legs'}).waitFor();
  await page.evaluate(() => view.dispose());
  console.log('PASS: remaining bus/train/ferry legs only; predicted, cancelled and skipped labels; intermediate-stop alerts; completed legs excluded; itinerary preserved; no check after journey completion.');
  console.log('PASS: explicit keyboard stop check, dated-trip and alert filtering, unchanged schedule, no journey arguments sent to client, safe text, cancelled-view isolation, unavailable fallback, narrow zoom and axe. Mock client; not provider or physical-device verification.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
