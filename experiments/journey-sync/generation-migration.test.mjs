import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import('@playwright/test');
const sources = new Map();
for (const name of ['state.mjs', 'store.mjs', 'generation-state.mjs', 'generation-migration.mjs'])
  sources.set('/journey-sync/' + name, await readFile(new URL(name, import.meta.url)));
for (const name of ['software-persona.mjs', 'local-persona.mjs'])
  sources.set('/tg-pairing/' + name, await readFile(new URL('../tg-pairing/' + name, import.meta.url)));
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs'])
  sources.set('/tg-pairing/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  const body = req.url === '/' ? '<!doctype html><title>Journey migration</title>' : sources.get(req.url);
  res.writeHead(body ? 200 : 404, {'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : req.url === '/' ? 'text/html' : 'text/javascript'}); res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./tg-pairing/storage.mjs');
    const {initializeSoftwarePersona} = await import('./tg-pairing/software-persona.mjs');
    const {emptyState, changeJourney, journeyId, projectJourney} = await import('./journey-sync/state.mjs');
    const {openJourneyStore} = await import('./journey-sync/store.mjs');
    const {migrateJourneyGeneration} = await import('./journey-sync/generation-migration.mjs');
    const assert = (v, message) => { if (!v) throw Error(message); };
    const refuses = async promise => assert(await promise.then(() => false, () => true), 'expected refusal');
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const oldScope = 'along-saved-journeys-v1', newScope = 'along-saved-journeys-v2', archiveScope = 'along-journey-migration-v1';
    const place = id => ({id, name: id, lat: -36, lon: 174});
    const live = projectJourney({from: place('from'), to: place('to')});
    async function fixture(name, empty = false) {
      const store = await openBrowserStorage(name), setup = await initializeSoftwarePersona({wasm, store});
      const group = Uint8Array.from(setup.group.match(/../g), n => parseInt(n, 16));
      let state = changeJourney(emptyState(setup.group), setup.member, journeyId(live), live);
      state = changeJourney(state, setup.member, JSON.stringify(['stop', 'from', 'stop', 'gone']), null);
      if (!empty) {
        await store.compareAndSwap(oldScope, setup.group, 0, state);
        await store.compareAndSwap('along-journey-import-v1', setup.group, 0, {format: 1, operation: crypto.randomUUID()});
      }
      return {store, setup, state, input: {wasm, store, expectedGroup: group, expectedRevision: empty ? 0 : 1}};
    }
    const first = await fixture('journey-migration');
    const pending = JSON.stringify({learning: true, journeys: [live], journeySync: {format: 1, group: first.setup.group,
      pending: [{id: crypto.randomUUID(), changes: [{id: journeyId(live), value: null}]}]}});
    localStorage.setItem('along-journeys-v1', pending);
    const receipt = await first.store.read('along-journey-import-v1', first.setup.group);
    const both = await Promise.all([migrateJourneyGeneration(first.input), migrateJourneyGeneration(first.input)]);
    assert(both.filter(r => !r.alreadyMigrated).length === 1, 'migration committed twice');
    const migrated = await first.store.read(newScope, first.setup.group), archive = await first.store.read(archiveScope, first.setup.group);
    assert(migrated.revision === 1 && migrated.value.generation === 0, 'wrong migrated generation');
    assert(equal(migrated.value.journeys, first.state.journeys), 'migration discarded live values or tombstones');
    assert(equal(archive.value.sourceState, first.state) && equal(archive.value.importReceipt, receipt), 'source/receipt not archived');
    assert(localStorage.getItem('along-journeys-v1') === pending, 'local journal changed');
    await refuses(openJourneyStore({store: first.store, group: first.setup.group, actor: first.setup.member}).save(live));
    await refuses(migrateJourneyGeneration({...first.input, expectedRevision: 2}));
    first.store.close();
    const fresh = await fixture('journey-migration-empty', true);
    await migrateJourneyGeneration(fresh.input);
    assert((await fresh.store.read(newScope, fresh.setup.group)).value.journeys.length === 0, 'empty replica migration');
    assert((await fresh.store.read(archiveScope, fresh.setup.group)).value.importReceipt === null, 'invented import receipt');
    fresh.store.close();
    for (const mode of ['stale', 'permission-race', 'interrupted', 'old-writer', 'cancelled']) {
      const f = await fixture('journey-migration-' + mode);
      const abort = new AbortController(); let input = {...f.input, signal: abort.signal};
      if (mode === 'stale') input.expectedRevision = 0;
      if (mode === 'cancelled') abort.abort();
      if (mode === 'permission-race') input.store = {...f.store, compareAndSwapMany: async (...args) => {
        await f.store.compareAndSwap('along-journey-sharing-v1', f.setup.group, 0, {format: 1, member: f.setup.member, peers: []});
        return f.store.compareAndSwapMany(...args);
      }};
      if (mode === 'old-writer') {
        const older = {...f.store, compareAndSwapMany: async (...args) => {
          await migrateJourneyGeneration(input); return f.store.compareAndSwapMany(...args);
        }};
        await refuses(openJourneyStore({store: older, group: f.setup.group, actor: f.setup.member}).save(live));
        assert(equal((await f.store.read(newScope, f.setup.group)).value.journeys, f.state.journeys), 'old in-flight writer changed migrated replica');
      } else if (mode === 'interrupted') {
        const put = IDBObjectStore.prototype.put; let interrupted = false;
        IDBObjectStore.prototype.put = function(...args) {
          const result = put.apply(this, args);
          if (args[1]?.[0] === newScope) { interrupted = true; this.transaction.abort(); }
          return result;
        };
        try { await refuses(migrateJourneyGeneration(input)); } finally { IDBObjectStore.prototype.put = put; }
        assert(interrupted, 'did not interrupt actual transaction');
      } else await refuses(migrateJourneyGeneration(input));
      if (mode !== 'old-writer') {
        assert(await f.store.read(newScope, f.setup.group) === null && await f.store.read(archiveScope, f.setup.group) === null, 'partial migration');
        assert(equal((await f.store.read(oldScope, f.setup.group)).value, f.state), 'failure changed legacy data');
      }
      f.store.close();
    }
    return {group: first.setup.group, pending};
  });
  await page.reload();
  const reopened = await page.evaluate(async ({group, pending}) => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./tg-pairing/storage.mjs')).openBrowserStorage('journey-migration');
    try {
      const before = await store.read('along-saved-journeys-v2', group);
      const answer = await (await import('./journey-sync/generation-migration.mjs')).migrateJourneyGeneration({wasm, store,
        expectedGroup: Uint8Array.from(group.match(/../g), n => parseInt(n, 16)), expectedRevision: 1});
      return answer.alreadyMigrated && (await store.read('along-saved-journeys-v2', group)).revision === before.revision
        && localStorage.getItem('along-journeys-v1') === pending;
    } finally { store.close(); }
  }, result);
  assert.equal(reopened, true);
  console.log('PASS: actual software identity and IndexedDB migration preserve replica/tombstones/import receipt/local pending edits; concurrent/reloaded retries do not rewrite; stale review, permission race, cancellation and interrupted transaction preserve old state; old in-flight format-1 writer cannot overwrite migration. No app migration UI enabled.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
