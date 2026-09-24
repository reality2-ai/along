import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import('@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['software-persona.mjs', 'local-persona.mjs', 'epoch-preparation.mjs', 'epoch-transition.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : sources.has(req.url) ? 'text/javascript' : 'text/html');
  res.end(sources.get(req.url) || '<!doctype html><title>Epoch preparation test</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext(), page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  const first = await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./storage.mjs');
    const {initializeSoftwarePersona, loadSoftwareIssuer} = await import('./software-persona.mjs');
    const store = await openBrowserStorage('epoch-preparation');
    const setup = await initializeSoftwarePersona({wasm, store});
    const group = Uint8Array.from(setup.group.match(/../g), b => parseInt(b, 16));
    const issuer = await loadSoftwareIssuer({wasm, store, expectedGroup: group});
    const before = await store.read('candidate-persona', 'active');
    const results = await Promise.all([issuer.prepareRotation(), issuer.prepareRotation()]);
    const saved = await store.read('along-prepared-epoch-v1', setup.group + ':1');
    const after = await store.read('candidate-persona', 'active');
    const membership = await store.read('membership', setup.group);
    const outcome = {group: setup.group, transitions: results.map(r => Array.from(r.transition)),
      revision: saved.revision, unchangedPersona: before.revision === after.revision,
      currentEpoch: String(membership.value.current), encrypted: saved.value.ciphertext.length === 80
        && saved.value.wrappingKey.extractable === false && !('payloadKey' in saved.value),
      delivered: results.some(r => r.delivered)};
    issuer.close(); store.close(); return outcome;
  });
  assert.deepEqual(first.transitions[0], first.transitions[1]);
  assert.equal(first.revision, 1); assert.equal(first.unchangedPersona, true);
  assert.equal(first.currentEpoch, '0'); assert.equal(first.encrypted, true); assert.equal(first.delivered, false);
  await page.close();
  const restored = await context.newPage(); await restored.goto(url);
  assert.equal(await restored.evaluate(async first => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./storage.mjs');
    const {initializeSoftwarePersona, loadSoftwareIssuer} = await import('./software-persona.mjs');
    const store = await openBrowserStorage('epoch-preparation');
    const group = Uint8Array.from(first.group.match(/../g), b => parseInt(b, 16));
    const issuer = await loadSoftwareIssuer({wasm, store, expectedGroup: group});
    const check = (v, text) => { if (!v) throw Error(text); };
    const denied = fn => fn().then(() => false, () => true);
    const result = await issuer.prepareRotation();
    check(JSON.stringify(Array.from(result.transition)) === JSON.stringify(first.transitions[0]), 'fresh document reuses preparation');
    const scope = 'along-prepared-epoch-v1', key = first.group + ':1';
    const original = await store.read(scope, key);
    check(original.revision === 1, 'retry does not rewrite');
    for (const field of ['ciphertext', 'transition', 'certificate']) {
      const held = await store.read(scope, key), changed = structuredClone(original.value);
      changed[field][0] ^= 1;
      await store.compareAndSwap(scope, key, held.revision, changed);
      const corrupt = await store.read(scope, key);
      check(await denied(() => issuer.prepareRotation()), 'corrupt ' + field + ' refuses');
      check((await store.read(scope, key)).revision === corrupt.revision, 'corruption not silently replaced');
      await store.compareAndSwap(scope, key, corrupt.revision, original.value);
    }
    issuer.close(); store.close();
    // A failed commit must neither advance membership nor leave half a record.
    const other = await openBrowserStorage('epoch-preparation-failure');
    const created = await initializeSoftwarePersona({wasm, store: other});
    const otherGroup = Uint8Array.from(created.group.match(/../g), b => parseInt(b, 16));
    const failing = {...other, compareAndSwapMany: async () => { throw Error('simulated storage failure'); }};
    const failedIssuer = await loadSoftwareIssuer({wasm, store: failing, expectedGroup: otherGroup});
    check(await denied(() => failedIssuer.prepareRotation()), 'failed commit refuses');
    check(await other.read(scope, created.group + ':1') === null, 'no partial preparation');
    check((await other.read('membership', created.group)).value.current === 0n, 'no advance');
    failedIssuer.close();
    const abort = new AbortController();
    const cancelled = await loadSoftwareIssuer({wasm, store: other, expectedGroup: otherGroup, signal: abort.signal});
    abort.abort();
    check(await denied(() => cancelled.prepareRotation()), 'early cancellation refuses');
    check(await other.read(scope, created.group + ':1') === null, 'cancel before commit writes nothing');
    cancelled.close();
    const raced = {...other, compareAndSwapMany: async (writes, options) => {
      const bootstrap = await other.read('persona-bootstrap', 'initial');
      await other.compareAndSwap('persona-bootstrap', 'initial', bootstrap.revision, bootstrap.value);
      return other.compareAndSwapMany(writes, options);
    }};
    const raceIssuer = await loadSoftwareIssuer({wasm, store: raced, expectedGroup: otherGroup});
    check(await denied(() => raceIssuer.prepareRotation()), 'changed custody refuses at commit');
    check(await other.read(scope, created.group + ':1') === null, 'revision guard prevents stale preparation');
    raceIssuer.close();
    const late = new AbortController();
    const lateStore = {...other, compareAndSwapMany: async (writes, options) => {
      const result = await other.compareAndSwapMany(writes, options);
      if (result.applied) late.abort();
      return result;
    }};
    const lateIssuer = await loadSoftwareIssuer({wasm, store: lateStore, expectedGroup: otherGroup, signal: late.signal});
    check(await denied(() => lateIssuer.prepareRotation()), 'late cancellation refuses handoff');
    const committed = await other.read(scope, created.group + ':1');
    check(committed?.revision === 1, 'late cancellation cannot undo saved preparation');
    lateIssuer.close();
    const resumed = await loadSoftwareIssuer({wasm, store: other, expectedGroup: otherGroup});
    check((await resumed.prepareRotation()).status === 'prepared-locally', 'retry recovers late commit');
    check((await other.read(scope, created.group + ':1')).revision === 1, 'late commit retry does not replace keys');
    resumed.close(); other.close(); return true;
  }, first), true);
  console.log('PASS: real software issuer prepares one encrypted epoch successor under concurrent calls, restores it in a fresh document, and refuses corrupted state, failed writes, changed custody and early cancellation; late cancellation preserves the committed preparation for retry. Membership remains at epoch zero; no delivery or rotation installation is claimed.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
