import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['../tg-pairing/initial-persona.mjs', '../tg-pairing/local-persona.mjs', 'local-owner.mjs', 'owner-policy.mjs', 'local-vault.mjs', 'policy.mjs', 'policy-store.mjs']) sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  const path = '/' + req.url.split('/').pop();
  res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : sources.has(path) ? 'text/javascript' : 'text/html');
  res.end(sources.get(path) || '<!doctype html><title>First-use test</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./storage.mjs')).openBrowserStorage('owner-policy-actions');
    const initial = await (await import('./initial-persona.mjs')).initializeLocalPersona({wasm, store}); initial.close();
    const expectedGroup = (await store.read('candidate-persona', 'active')).value.record.group;
    const {binding} = await (await import('./local-owner.mjs')).establishLocalATOwner({wasm, store, expectedGroup});
    const policies = (await import('./policy-store.mjs')).openCredentialPolicyStore({store, ...binding});
    const vault = (await import('./local-vault.mjs')).openLocalATVault({wasm, store, ...binding});
    const {updateLocalATPolicy} = await import('./owner-policy.mjs');
    const update = options => updateLocalATPolicy({wasm, store, expectedGroup, ...options});
    const check = (v, message) => { if (!v) throw new Error(message); };
    const denied = fn => fn().then(() => false, () => true);
    await vault.saveOwnerKey('synthetic-first');
    // A device grant records explicit app intent only; no key is delivered here.
    const devices = [binding.owner, 'ab'.repeat(32)];
    const pending = update({expectedRevision: 1n, devices}); devices.length = 0;
    const granted = await pending;
    check(granted.policy.revision === 2n && granted.policy.generation === 1n && granted.policy.devices.length === 2, 'snapshot explicit grants');
    check(await denied(() => update({expectedRevision: 1n, devices: []})), 'stale review refused');
    check((await policies.read()).policy.revision === 2n, 'stale review did not write');
    const removed = await update({expectedRevision: 2n, devices: []});
    check(removed.policy.devices.length === 0, 'remove all grants');
    check(await denied(() => vault.getKey()), 'removed own-device access stops');
    // App ownership remains distinct from the permission to read an AT key.
    await update({expectedRevision: 3n, devices: [binding.owner], rotate: true});
    check((await vault.inspect()).status === 'replacement-needed', 'rotation invalidates old stored generation');
    await vault.saveOwnerKey('synthetic-replacement');
    check(await vault.getKey() === 'synthetic-replacement', 'replacement usable');
    const anchor = await store.read('along-at-owners', binding.group);
    const racing = {...store, compareAndSwapMany: async (changes, options) => {
      await store.compareAndSwap('along-at-owners', binding.group, anchor.revision, anchor.value);
      return store.compareAndSwapMany(changes, options);
    }};
    check(await denied(() => update({store: racing, expectedRevision: 4n, devices: []})), 'changed anchor refuses commit');
    check((await policies.read()).policy.revision === 4n, 'no stale authority write');
    const cancelled = new AbortController(); cancelled.abort();
    check(await denied(() => update({expectedRevision: 4n, devices: [], signal: cancelled.signal})), 'cancelled operation refuses');
    check(await denied(() => update({expectedRevision: 4n, devices: [binding.owner, binding.owner]})), 'duplicate grants refused');
    const outcomes = await Promise.allSettled([
      update({expectedRevision: 4n, devices: [binding.owner]}),
      update({expectedRevision: 4n, devices: [], rotate: true}),
    ]);
    check(outcomes.filter(v => v.status === 'fulfilled').length === 1, 'one concurrent review wins');
    check((await policies.read()).policy.revision === 5n, 'only one revision committed');
    const afterCommit = new AbortController();
    const committing = {...store, compareAndSwapMany: async (...args) => {
      const result = await store.compareAndSwapMany(...args);
      if (result.applied) afterCommit.abort();
      return result;
    }};
    const receipt = await update({store: committing, expectedRevision: 5n, devices: [binding.owner], signal: afterCommit.signal});
    check(receipt.status === 'policy-saved' && receipt.policy.revision === 6n, 'completed commit wins late cancellation');
    check((await policies.read()).policy.revision === 6n, 'late cancellation receipt matches persisted policy');
    store.close();
  });
  console.log('PASS: actual owner signs explicit grant/removal/rotation, input snapshot, stale-review refusal, access removal and encrypted replacement; changed authority, cancellation, malformed grants and concurrent reviews refuse safely. Synthetic keys; no peer delivery or AT-side rotation claim.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
