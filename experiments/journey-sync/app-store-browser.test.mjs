// Real localStorage, IndexedDB and Web Locks; the pause is a deliberate crash/race fixture.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const preview = process.env.PREVIEW === '1';
const sourceRoot = new URL(preview ? '../../releases/along-device-preview/experiments/journey-sync/' : './', import.meta.url);
const sources = new Map();
for (const name of ['state.mjs', 'app-store.mjs', 'app-preferences.mjs', 'preference-envelope.mjs', 'isolated-preferences.mjs'])
  sources.set('/' + name, await readFile(new URL(name, sourceRoot)));
sources.set('/public/preferences.js', await readFile(new URL('../../public/preferences.js', sourceRoot)));
sources.set('/storage.mjs', await readFile(preview
  ? new URL('../tg-pairing/storage.mjs', sourceRoot)
  : new URL('../../releases/along-r2-runtime-1b9229ad/browser/storage.mjs', import.meta.url)));
const server = createServer((req, res) => {
  const body = req.url === '/' ? '<!doctype html><title>Journey journal check</title>' : sources.get(req.url);
  res.writeHead(body ? 200 : 404, {'Content-Type': req.url === '/' ? 'text/html' : 'text/javascript'}); res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext(), first = await context.newPage(), second = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}/`;
  await first.goto(url); await second.goto(url);
  const head = await first.evaluate(async () => {
    const {writePreferences, readPreferences, enableJourneyTracking, readEnvelope} = await import('./app-preferences.mjs');
    const place = id => ({id, name: id, lat: -36, lon: 174, placeType: 'address'});
    if (!writePreferences({journeys: [1, 2].map(n => ({from: place('from'), to: place('to-' + n), saved: true,
      savedRoutes: null, count: 7, hours: Array(24).fill(0), days: Array(7).fill(0)}))})) throw Error('save');
    enableJourneyTracking('a'.repeat(64));
    for (let n = 0; n < 255; n++) {
      const data = readPreferences(); data.journeys[0].savedRoutes = [{mode: 'bus', route: String(n)}];
      if (!writePreferences(data)) throw Error('edit');
    }
    const store = await (await import('./storage.mjs')).openBrowserStorage('journal-browser');
    let resume; globalThis.commitPaused = false;
    const gate = new Promise(resolve => { resume = resolve; }); globalThis.resume = resume;
    const wrapped = {...store, compareAndSwapMany: async (...args) => {
      globalThis.commitPaused = true; await gate;
      const result = await store.compareAndSwapMany(...args);
      // Simulate losing the document after IDB commit, before consuming the journal.
      throw Error('simulated document stop after durable commit: ' + result.applied);
    }};
    const bridge = (await import('./app-store.mjs')).openAppJourneyStore({store: wrapped, group: 'a'.repeat(64), actor: '1'.repeat(64)});
    globalThis.finished = bridge.reconcile().then(() => 'unexpected', error => error.message).finally(() => store.close());
    return readEnvelope().sync.pending[0];
  });
  await first.waitForFunction(() => globalThis.commitPaused);
  const compacted = await second.evaluate(async () => {
    const {readPreferences, writePreferences, readEnvelope} = await import('./app-preferences.mjs');
    const data = readPreferences(); data.journeys[1].saved = false;
    if (!writePreferences(data)) throw Error('compaction failed');
    return readEnvelope().sync.pending;
  });
  assert.equal(compacted.length, 2); assert.deepEqual(compacted[0], head);
  assert.match(await first.evaluate(async () => { globalThis.resume(); return await globalThis.finished; }), /durable commit: true/);
  await first.close(); await second.reload();
  const restored = await second.evaluate(async () => {
    const store = await (await import('./storage.mjs')).openBrowserStorage('journal-browser');
    try {
      const bridge = (await import('./app-store.mjs')).openAppJourneyStore({store, group: 'a'.repeat(64), actor: '1'.repeat(64)});
      const state = await bridge.reconcile();
      const {readPreferences, readEnvelope} = await import('./app-preferences.mjs');
      return {clock: state.clock, saved: state.journeys.filter(e => e.value).map(e => e.value.savedRoutes),
        deleted: state.journeys.filter(e => e.value === null).length,
        pending: readEnvelope().sync.pending.length, counts: readPreferences().journeys.map(j => j.count)};
    } finally { store.close(); }
  });
  assert.deepEqual(restored, {clock: 4, saved: [[{mode: 'bus', route: '254'}]], deleted: 1, pending: 0, counts: [7, 7]});
  console.log('PASS: another tab compacts 257 queued operations while the head is paused; real IndexedDB receipt survives reload, head replays once, final deletion/service preference and local history survive.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
