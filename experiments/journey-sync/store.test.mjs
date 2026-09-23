// Real IndexedDB durability/concurrency checks; no network synchronization claim.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['state.mjs', 'store.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
sources.set('/storage.mjs', await readFile(new URL('../../releases/along-r2-runtime-1b9229ad/browser/storage.mjs', import.meta.url)));
const server = createServer((req, res) => {
  const body = req.url === '/' ? '<!doctype html><title>Journey storage check</title>' : sources.get(req.url);
  res.writeHead(body ? 200 : 404, {'Content-Type': req.url === '/' ? 'text/html' : 'text/javascript'}); res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const {openJourneyStore} = await import('./store.mjs');
    const {projectJourney, journeyId, savedJourneys} = await import('./state.mjs');
    const group = 'a'.repeat(64), actor = '1'.repeat(64), other = '2'.repeat(64);
    const store = await openBrowserStorage('journey-sync-test');
    const second = await openBrowserStorage('journey-sync-test');
    const a = openJourneyStore({store, group, actor}), b = openJourneyStore({store: second, group, actor: other});
    const value = id => projectJourney({from: {id: 'from', name: 'From', lat: -36, lon: 174}, to: {id, name: id, lat: -37, lon: 175}});
    const x = value('one'), y = value('two');
    await Promise.all([a.save(x), b.save(y)]);
    const both = await a.read();
    await a.remove(journeyId(x));
    await b.merge(both.state); // An old peer snapshot cannot undo the deletion.
    const before = await a.read();
    let rejected = 0;
    try { await a.merge({...before.state, format: 2}); } catch { rejected++; }
    const fault = openJourneyStore({store: {...store, compareAndSwapMany: async () => { throw Error('Storage full'); }}, group, actor});
    try { await fault.save(value('not-saved')); } catch { rejected++; }
    const abort = new AbortController(); abort.abort();
    try { await a.save(value('cancelled'), {signal: abort.signal}); } catch { rejected++; }
    const preserved = JSON.stringify(await a.read()) === JSON.stringify(before);
    store.close(); second.close();
    return {count: savedJourneys(both.state).length, clocks: both.state.journeys.map(j => j.clock).sort(), rejected, preserved};
  });
  assert.deepEqual(result, {count: 2, clocks: [1, 2], rejected: 3, preserved: true});
  await page.reload();
  const reopened = await page.evaluate(async () => {
    const store = await (await import('./storage.mjs')).openBrowserStorage('journey-sync-test');
    try {
      const journeys = (await import('./store.mjs')).openJourneyStore({store, group: 'a'.repeat(64), actor: '1'.repeat(64)});
      const {state} = await journeys.read();
      return {saved: (await import('./state.mjs')).savedJourneys(state).map(j => j.to.id), tombstones: state.journeys.filter(j => j.value === null).length};
    } finally { store.close(); }
  });
  assert.deepEqual(reopened, {saved: ['two'], tombstones: 1});
  console.log('PASS: real IndexedDB concurrent writes preserve both saves, old snapshots preserve deletion, invalid/cancelled/failed writes preserve state, reload retains saved journey and tombstone. No peer transport or public integration yet.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
