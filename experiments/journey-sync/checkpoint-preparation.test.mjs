// Real browser storage; synthetic custody guard/signer, not full R2 authorization.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['state.mjs', 'generation-state.mjs', 'generation-checkpoint.mjs', 'checkpoint-preparation.mjs'])
  sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
sources.set('/storage.mjs', await readFile(new URL('../../releases/along-r2-runtime-1b9229ad/browser/storage.mjs', import.meta.url)));
const server = createServer((req, res) => {
  const body = req.url === '/' ? '<!doctype html><title>Checkpoint preparation</title>' : sources.get(req.url);
  res.writeHead(body ? 200 : 404, {'Content-Type': req.url === '/' ? 'text/html' : 'text/javascript'}); res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const {prepareJourneyCheckpoint} = await import('./checkpoint-preparation.mjs');
    const {emptyState, projectJourney, journeyId} = await import('./state.mjs');
    const {initialGeneration, changeGenerationJourney} = await import('./generation-state.mjs');
    const assert = (value, message) => { if (!value) throw Error(message); };
    const refuses = async promise => { assert(await promise.then(() => false, () => true), 'expected refusal'); };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const actor = '1'.repeat(64), scope = 'along-prepared-journey-checkpoint-v1';
    const journey = id => projectJourney({from: {id: 'from', name: 'From', lat: -36, lon: 174}, to: {id, name: id, lat: -37, lon: 175}});
    async function fixture(name) {
      const store = await openBrowserStorage(name), keys = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
      const group = Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)), b => b.toString(16).padStart(2, '0')).join('');
      let current = initialGeneration(emptyState(group));
      const value = journey('saved'); current = changeGenerationJourney(current, actor, journeyId(value), value);
      current = changeGenerationJourney(current, actor, journeyId(journey('deleted')), null);
      await store.compareAndSwapMany([
        {scope: 'along-saved-journeys-v2', key: group, expectedRevision: 0, value: current},
        {scope: 'test-custody', key: 'active', expectedRevision: 0, value: {group}},
      ]);
      const input = {store, current, expectedRevision: 1,
        guards: [{scope: 'test-custody', key: 'active', expectedRevision: 1}], check: async () => {},
        sign: async bytes => new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, bytes))};
      const read = () => store.read(scope, group + ':1');
      return {store, input, read, group};
    }
    const a = await fixture('checkpoint-reload');
    const results = await Promise.all([prepareJourneyCheckpoint(a.input), prepareJourneyCheckpoint(a.input)]);
    assert(same(results[0], results[1]), 'concurrent preparation differs');
    assert((await a.read()).revision === 1, 'winner overwritten');
    assert((await a.store.read('along-saved-journeys-v2', a.group)).revision === 1, 'preparation changed replica');
    assert(results[0].snapshot.journeys.length === 1, 'proposed checkpoint retained deletion');
    const added = journey('later-local-edit');
    const changed = changeGenerationJourney(a.input.current, actor, journeyId(added), added);
    await a.store.compareAndSwap('along-saved-journeys-v2', a.group, 1, changed);
    const retry = await prepareJourneyCheckpoint({...a.input, current: changed, expectedRevision: 2,
      sign: async () => { throw Error('must reuse retained preparation'); }});
    assert(same(retry, results[0]), 'retry invented a different snapshot');
    assert((await a.store.read('along-saved-journeys-v2', a.group)).value.journeys.length === 3, 'later local edit lost');
    const before = structuredClone((await a.read()).value);
    const damaged = structuredClone(before); damaged.checkpoint[183] ^= 1;
    await a.store.compareAndSwap(scope, a.group + ':1', 1, damaged);
    await refuses(prepareJourneyCheckpoint({...a.input, current: changed, expectedRevision: 2}));
    assert((await a.read()).revision === 2, 'corrupt evidence overwritten');
    await a.store.compareAndSwap(scope, a.group + ':1', 2, before);
    a.store.close();
    for (const kind of ['before', 'race', 'after', 'bad-signature', 'failed-write']) {
      const f = await fixture('checkpoint-' + kind), abort = new AbortController();
      let input = {...f.input, signal: abort.signal};
      if (kind === 'before') abort.abort();
      if (kind === 'bad-signature') input.sign = async () => new Uint8Array(64);
      if (kind === 'race') input.store = {...f.store, compareAndSwapMany: async (...args) => {
        await f.store.compareAndSwap('test-custody', 'active', 1, {group: f.group, changed: true});
        return f.store.compareAndSwapMany(...args);
      }};
      if (kind === 'after') input.store = {...f.store, compareAndSwapMany: async (...args) => {
        const result = await f.store.compareAndSwapMany(...args); abort.abort(); return result;
      }};
      if (kind === 'failed-write') input.store = {...f.store, compareAndSwapMany: async () => { throw Error('Storage full'); }};
      await refuses(prepareJourneyCheckpoint(input));
      const record = await f.read();
      assert(kind === 'after' ? record?.revision === 1 : record === null, 'incorrect durable result: ' + kind);
      assert((await f.store.read('along-saved-journeys-v2', f.group)).revision === 1, 'replica changed: ' + kind);
      if (kind === 'after') {
        const restored = await prepareJourneyCheckpoint(f.input);
        assert(same(restored.checkpoint, record.value.checkpoint), 'post-commit retry changed checkpoint');
      }
      f.store.close();
    }
    return {group: a.group, expected: results[0], cases: 5};
  });
  assert.equal(result.cases, 5);
  await page.reload();
  const reopened = await page.evaluate(async group => {
    const store = await (await import('./storage.mjs')).openBrowserStorage('checkpoint-reload');
    try {
      const replica = await store.read('along-saved-journeys-v2', group);
      return await (await import('./checkpoint-preparation.mjs')).prepareJourneyCheckpoint({store,
        current: replica.value, expectedRevision: replica.revision,
        guards: [{scope: 'test-custody', key: 'active', expectedRevision: 1}], check: async () => {},
        sign: async () => { throw Error('reload must reuse retained preparation'); }});
    } finally { store.close(); }
  }, result.group);
  assert.deepEqual(reopened, result.expected);
  console.log('PASS: real IndexedDB retains one checkpoint across concurrent preparation, later local edits, cancellation after commit and reload; stale custody, bad signatures, corrupt records, cancellation before commit and failed writes refuse without changing replica. Synthetic authority adapter only.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
