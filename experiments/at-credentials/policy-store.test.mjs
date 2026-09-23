import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['policy.mjs', 'policy-store.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
sources.set('/storage.mjs', await readFile(join(process.env.R2_BROWSER_DIR, 'storage.mjs')));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', sources.has(req.url) ? 'text/javascript' : 'text/html');
  res.end(sources.get(req.url) || '<!doctype html><title>Policy storage</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext(), page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`; await page.goto(url);
  const binding = await page.evaluate(async () => {
    const check = (v, why) => { if (!v) throw new Error(why); };
    const refused = async fn => { try { await fn(); return false; } catch { return true; } };
    const {credentialPolicyBytes} = await import('./policy.mjs');
    const {openCredentialPolicyStore} = await import('./policy-store.mjs');
    window.store = await (await import('./storage.mjs')).openBrowserStorage('at-policy');
    const pair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    const owner = Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)), b => b.toString(16).padStart(2, '0')).join('');
    const binding = {group: '11'.repeat(32), owner, credential: '22'.repeat(16)};
    const signed = async (revision, generation = 1n, devices = [owner]) => {
      const bytes = credentialPolicyBytes({...binding, revision, generation, devices});
      return [bytes, new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, bytes))];
    };
    const policies = openCredentialPolicyStore({store, ...binding});
    const first = await signed(1n);
    check((await policies.read()).status === 'unconfigured', 'no policy initially');
    check(await refused(() => policies.update(...first)), 'network update cannot establish owner');
    check((await policies.establish(...first)).storageRevision === 1, 'first policy committed');
    check(await refused(() => policies.establish(...first)), 'cannot establish twice');
    check(await refused(() => policies.update(...first)), 'replay refused');
    // Both candidates reach their transaction with the same storage revision.
    let entered = 0, release; const ready = new Promise(resolve => { release = resolve; });
    const raced = openCredentialPolicyStore({...binding, store: {...store,
      compareAndSwapMany: async (...args) => { if (++entered === 2) release(); await ready; return store.compareAndSwapMany(...args); }}});
    const results = await Promise.allSettled([raced.update(...await signed(2n)), raced.update(...await signed(3n))]);
    check(results.filter(r => r.status === 'fulfilled').length === 1, 'one concurrent writer wins');
    await policies.update(...await signed(4n, 2n));
    check(await refused(async () => policies.update(...await signed(5n, 1n))), 'credential generation cannot go backwards');
    await policies.update(...await signed(5n, 2n, []));
    check((await policies.read()).policy.devices.length === 0, 'removal persisted');
    const before = await policies.read();
    for (const afterCommit of [false, true]) {
      const cancel = new AbortController();
      const put = IDBObjectStore.prototype.put, transaction = IDBDatabase.prototype.transaction;
      try {
        if (!afterCommit) IDBObjectStore.prototype.put = function(...args) { const request = put.apply(this, args); cancel.abort(); return request; };
        else IDBDatabase.prototype.transaction = function(...args) {
          const tx = transaction.apply(this, args);
          if (args[1] === 'readwrite') tx.addEventListener('complete', () => cancel.abort(), {once: true});
          return tx;
        };
        const result = await policies.update(...await signed(6n, 2n, []), {signal: cancel.signal}).then(v => v, () => null);
        check(Boolean(result) === afterCommit, 'cancellation follows commit boundary');
      } finally { IDBObjectStore.prototype.put = put; IDBDatabase.prototype.transaction = transaction; }
      check((await policies.read()).storageRevision === before.storageRevision + Number(afterCommit), 'actual durable revision');
    }
    const damaged = openCredentialPolicyStore({...binding, store: {...store, read: async (...args) => {
      const saved = await store.read(...args); saved.value.signature[0] ^= 1; return saved;
    }}});
    check(await refused(() => damaged.read()), 'damaged saved signature refused');
    store.close(); return binding;
  });
  const reopened = await context.newPage(); await reopened.goto(url);
  assert.equal(await reopened.evaluate(async binding => {
    const store = await (await import('./storage.mjs')).openBrowserStorage('at-policy');
    const policies = (await import('./policy-store.mjs')).openCredentialPolicyStore({store, ...binding});
    try {
      const loaded = await policies.read();
      return loaded.policy.revision === 6n && loaded.policy.generation === 2n && loaded.policy.devices.length === 0;
    } finally { store.close(); }
  }, binding), true);
  console.log('PASS: actual IndexedDB policy establishment, update-only refusal on absence, replay/generation refusal, concurrent CAS, removal persistence, cancellation/commit boundary, saved-signature validation and fresh-document restore. No credential or fresh TG authorization claim.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
