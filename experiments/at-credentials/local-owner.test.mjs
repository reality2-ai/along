import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['../tg-pairing/initial-persona.mjs', '../tg-pairing/local-persona.mjs', 'local-owner.mjs', 'policy.mjs', 'policy-store.mjs']) sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
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
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./storage.mjs');
    const {initializeLocalPersona} = await import('./initial-persona.mjs');
    const {establishLocalATOwner, loadLocalATOwner} = await import('./local-owner.mjs');
    const {openCredentialPolicyStore} = await import('./policy-store.mjs');
    const check = (v, why) => { if (!v) throw new Error(why); };
    for (const variant of ['normal', 'old-runtime', 'membership-changed', 'second-write-fails']) {
      const store = await openBrowserStorage('at-owner-' + variant);
      const initial = await initializeLocalPersona({wasm, store}); initial.close();
      const saved = await store.read('candidate-persona', 'active');
      const group = saved.value.record.group;
      check(await loadLocalATOwner({wasm, store, expectedGroup: group}) === null, 'absent owner is not created');
      let policyLocation;
      const checked = {...store, compareAndSwapMany: async (changes, options) => {
        policyLocation = changes[0];
        if (variant === 'membership-changed') {
          const prior = await store.read('membership', initial.group);
          await store.compareAndSwap('membership', initial.group, prior.revision, prior.value);
        }
        return store.compareAndSwapMany(changes, options);
      }};
      if (variant === 'old-runtime') delete checked.capabilities;
      const originalPut = IDBObjectStore.prototype.put; let puts = 0;
      if (variant === 'second-write-fails') IDBObjectStore.prototype.put = function(...args) {
        const request = originalPut.apply(this, args); if (++puts === 2) this.transaction.abort(); return request;
      };
      let result;
      try { result = await establishLocalATOwner({wasm, store: checked, expectedGroup: group}).then(value => value, () => null); }
      finally { IDBObjectStore.prototype.put = originalPut; }
      check(Boolean(result) === (variant === 'normal'), variant + ' result');
      const owner = await store.read('along-at-owners', initial.group);
      if (result) {
        check(result.binding.owner === initial.member, 'owner is actual local member');
        check(owner.value.owner === initial.member, 'owner pin persisted');
        const loaded = await openCredentialPolicyStore({store, ...result.binding}).read();
        check(loaded.policy.devices.length === 1 && loaded.policy.devices[0] === initial.member, 'only local owner initially granted');
        check(!await establishLocalATOwner({wasm, store, expectedGroup: group}).then(() => true, () => false), 'existing owner not replaced');
        const restored = await loadLocalATOwner({wasm, store, expectedGroup: group});
        check(restored.status === 'local-owner-loaded' && JSON.stringify(restored.binding) === JSON.stringify(result.binding), 'binding restored');
        window.restoreExpected = {binding: result.binding, group: Array.from(group)};
        check((await store.read('along-at-owners', initial.group)).revision === owner.revision, 'restore is read only');
        const denied = fn => fn().then(() => false, () => true);
        for (const corruption of ['owner', 'group', 'credential', 'signature', 'missing-policy']) {
          const damaged = {...store, read: async (scope, key) => {
            const record = await store.read(scope, key);
            if (scope === 'along-at-owners') {
              if (corruption === 'owner') record.value.owner = '00'.repeat(32);
              if (corruption === 'group') record.value.group = '00'.repeat(32);
              if (corruption === 'credential') record.value.credential = 'malformed';
            }
            if (scope.startsWith('along-at-policy:')) {
              if (corruption === 'missing-policy') return null;
              if (corruption === 'signature') record.value.signature[0] ^= 1;
            }
            return record;
          }};
          check(await denied(() => loadLocalATOwner({wasm, store: damaged, expectedGroup: group})), 'restore refuses ' + corruption);
        }
        const cancelled = new AbortController(); cancelled.abort();
        check(await denied(() => loadLocalATOwner({wasm, store, expectedGroup: group, signal: cancelled.signal})), 'cancelled restore');
        let changed = false;
        const racing = {...store, read: async (scope, key) => {
          const record = await store.read(scope, key);
          if (!changed && scope.startsWith('along-at-policy:')) {
            changed = true;
            const prior = await store.read('along-at-owners', initial.group);
            await store.compareAndSwap('along-at-owners', initial.group, prior.revision, prior.value);
          }
          return record;
        }};
        check(await denied(() => loadLocalATOwner({wasm, store: racing, expectedGroup: group})), 'concurrent anchor change refuses');
      } else {
        check(owner === null, 'no partial owner pin');
        if (policyLocation) check(await store.read(policyLocation.scope, policyLocation.key) === null, 'no orphan policy');
      }
      check((await store.read('candidate-persona', 'active')).revision === saved.revision, 'persona not rewritten');
      if (variant !== 'membership-changed') check((await store.read('membership', initial.group)).revision === 1, 'membership not rewritten');
      store.close();
    }
  });
  const expected = await page.evaluate(() => restoreExpected);
  const reopened = await context.newPage(); await reopened.goto(page.url());
  assert.deepEqual(await reopened.evaluate(async expected => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./storage.mjs')).openBrowserStorage('at-owner-normal');
    try {
      return (await (await import('./local-owner.mjs')).loadLocalATOwner({wasm, store, expectedGroup: new Uint8Array(expected.group)})).binding;
    } finally { store.close(); }
  }, expected), expected.binding);
  console.log('PASS: real local member establishes owner and initial policy atomically; no implicit grant to peers, no persona/membership rewrite; older runtime, changed membership and interrupted writes cannot leave a partial owner/policy. Owner binding restores in a fresh document; mismatched pins, damaged/missing policy, cancellation and concurrent anchor changes refuse. No peer credential delivery claim.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
