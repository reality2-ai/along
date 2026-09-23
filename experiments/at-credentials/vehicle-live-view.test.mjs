import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['vehicle-live-view.mjs', '../../public/live-vehicles.js', '../tg-pairing/comparison.css', '../../public/vendor/leaflet/leaflet.js', '../../public/vendor/leaflet/leaflet.css']) sources.set(name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
const server = createServer((req, res) => {
  const name = req.url.split('/').pop(), body = sources.get(name);
  res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : body ? 'text/javascript' : 'text/html');
  res.end(body || '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vehicle check</title><link rel="stylesheet" href="/comparison.css"><link rel="stylesheet" href="/leaflet.css"><script src="/leaflet.js"></script><main><h1>Selected departure</h1><div id="map" role="region" aria-label="Scheduled route map" style="height:240px"></div><div id="live"></div></main></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext({viewport: {width: 320, height: 640}}), page = await context.newPage();
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    window.map = L.map('map', {zoomAnimation: false, fadeAnimation: false}).setView([-36.85, 174.77], 14);
    window.route = L.polyline([[-36.86, 174.76], [-36.84, 174.78]]).addTo(map);
    window.run = {trip: 'verified-trip', routeId: 'verified-route', serviceDate: '20260924', startTime: '09:00:00', stops: [{stop: {name: 'Example stop', lat: -36.85, lon: 174.77}}]};
    window.feed = {available: true, updated: 1000, entities: [{vehicle: {trip: {trip_id: run.trip, route_id: run.routeId, start_date: run.serviceDate, start_time: run.startTime}, timestamp: 1000, position: {latitude: -36.85, longitude: 174.77}}}]};
    window.calls = []; window.cancels = 0; window.hold = false;
    window.client = {read: async (kind, options) => { calls.push({kind, options}); if (hold) await new Promise(resolve => { window.release = resolve; }); return structuredClone(feed); }, cancel: () => cancels++};
    window.module = await import('./vehicle-live-view.mjs');
    window.mount = () => module.showVehicleLivePosition(document.querySelector('#live'), {client, run, map, leaflet: L, now: () => 1001});
    window.view = mount(); window.markers = () => Object.values(map._layers).filter(layer => layer instanceof L.CircleMarker).length;
  });
  assert.equal(await page.evaluate(() => calls.length), 0);
  await page.evaluate(() => document.querySelector('#live button').click());
  assert.equal(await page.evaluate(() => calls.length), 0);
  const check = async () => page.getByRole('button', {name: 'Check this service’s current position', exact: true}).click();
  await check();
  await page.getByRole('status').filter({hasText: 'not an arrival prediction'}).waitFor();
  assert.equal(await page.evaluate(() => markers()), 1);
  assert.equal(await page.evaluate(() => map.hasLayer(route)), true);
  assert.deepEqual(await page.evaluate(() => calls), [{kind: 'vehicles', options: {requested: true}}]);
  assert.match(await page.getByRole('status').textContent(), /0 metres in a straight line from Example stop/);
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  await page.clock.fastForward(180001);
  await page.getByRole('status').filter({hasText: 'position has expired'}).waitFor();
  assert.equal(await page.evaluate(() => markers()), 0);
  assert.equal(await page.evaluate(() => map.hasLayer(route)), true);
  for (const mismatch of ['date', 'timestamp', 'duplicate']) {
    await page.evaluate(mismatch => {
      const v = feed.entities[0].vehicle; feed.entities.length = 1; v.trip.start_date = '20260924'; v.timestamp = 1000;
      if (mismatch === 'date') v.trip.start_date = '20260925';
      if (mismatch === 'timestamp') v.timestamp = 700;
      if (mismatch === 'duplicate') feed.entities.push(structuredClone(feed.entities[0]));
    }, mismatch);
    await check(); await page.getByRole('status').filter({hasText: 'No current position'}).waitFor();
    assert.equal(await page.evaluate(() => markers()), 0);
  }
  await page.evaluate(() => { feed.entities.length = 1; hold = true; });
  await check(); await page.waitForFunction(() => typeof release === 'function');
  await page.evaluate(() => { view.dispose(); document.querySelector('#live').textContent = 'Another service'; release(); });
  assert.equal(await page.locator('#live').textContent(), 'Another service');
  assert.equal(await page.evaluate(() => markers()), 0);
  assert.equal(await page.evaluate(() => map.hasLayer(route)), true);
  assert.equal(await page.evaluate(() => cancels), 1);
  await page.evaluate(() => map.remove());
  console.log('PASS: explicit matched vehicle on actual Leaflet map; route retained; expiry, stale/different-date/ambiguous positions refused; late navigation ignored; no location arguments to client; zoom and axe. Mock provider, no street tiles fetched.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
