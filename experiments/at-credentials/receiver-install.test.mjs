import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['../tg-pairing/initial-persona.mjs', '../tg-pairing/local-persona.mjs', 'local-owner.mjs', 'policy.mjs', 'policy-store.mjs', 'local-vault.mjs', 'delivery-ack.mjs', 'delivery-message.mjs']) sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
for (const name of ['live-client.mjs', '../../public/at-client.js', '../../public/live-client.js']) sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
const server = createServer((req, res) => {
  const path = '/' + req.url.split('/').pop();
  res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : sources.has(path) ? 'text/javascript' : 'text/html');
  res.end(sources.get(path) || '<!doctype html><title>First-use test</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext(), page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./storage.mjs');
    const {initializeLocalPersona} = await import('./initial-persona.mjs');
    const {establishLocalATOwner} = await import('./local-owner.mjs');
    const {loadLocalPersona} = await import('./local-persona.mjs');
    const {openLocalATVault} = await import('./local-vault.mjs');
    const {encodeCredentialDelivery} = await import('./delivery-message.mjs');
    const {verifyDeliveryAck} = await import('./delivery-ack.mjs');
    const check = (v, message) => { if (!v) throw new Error(message); };
    const denied = fn => fn().then(() => false, () => true);
    for (const variant of ['normal', 'interrupted', 'cancelled', 'policy-changed', 'concurrent', 'superseded', 'late-cancel']) {
      const store = await openBrowserStorage('receiver-install-' + variant);
      const initial = await initializeLocalPersona({wasm, store}); initial.close();
      const persona = (await store.read('candidate-persona', 'active')).value.record;
      const {binding} = await establishLocalATOwner({wasm, store, expectedGroup: persona.group});
      const identity = await loadLocalPersona({wasm, store, expectedGroup: persona.group});
      const cancellation = new AbortController();
      const guarded = {...store, compareAndSwapMany: async (changes, options) => {
        const result = await store.compareAndSwapMany(changes, options);
        if (variant === 'late-cancel' && result.applied && changes[0].scope.startsWith('along-at-secret:')) cancellation.abort();
        return result;
      }};
      const vault = openLocalATVault({wasm, store: guarded, ...binding});
      check(await denied(() => vault.prepareDelivery({ownerCertificate: new Uint8Array(136)})), 'invalid owner evidence refused');
      const request = await vault.prepareDelivery({ownerCertificate: persona.certificate, signal: cancellation.signal});
      check(await denied(() => request.acknowledgment()), 'pending request cannot acknowledge storage');
      const key = binding.group + ':' + binding.credential;
      const policy = (await store.read('along-at-policy:' + binding.owner, key)).value;
      const packet = await encodeCredentialDelivery({nonce: request.nonce, recipient: persona.subject,
        policyBytes: policy.bytes, policySignature: policy.signature, key: 'synthetic-received-key', sign: identity.sign});
      if (variant === 'cancelled') request.close();
      if (variant === 'superseded') {
        const newer = await vault.prepareDelivery({ownerCertificate: persona.certificate}); newer.close();
      }
      if (variant === 'policy-changed') {
        const prior = await store.read('along-at-policy:' + binding.owner, key);
        await store.compareAndSwap('along-at-policy:' + binding.owner, key, prior.revision, prior.value);
      }
      const originalPut = IDBObjectStore.prototype.put; let puts = 0;
      if (variant === 'interrupted') IDBObjectStore.prototype.put = function(...args) {
        const result = originalPut.apply(this, args); if (++puts === 2) this.transaction.abort(); return result;
      };
      let results;
      try { results = await Promise.allSettled(variant === 'concurrent' ? [request.install(packet), request.install(packet)] : [request.install(packet)]); }
      finally { IDBObjectStore.prototype.put = originalPut; }
      const successful = ['normal', 'concurrent', 'late-cancel'].includes(variant);
      check(results.filter(v => v.status === 'fulfilled').length === (successful ? 1 : 0), variant + ' result');
      const secret = await store.read('along-at-secret:' + binding.owner, key);
      const journal = await store.read('along-at-request:' + binding.owner, key);
      if (successful) {
        check(journal.value.state === 'consumed', 'request consumed with secret');
        check(await vault.getKey() === 'synthetic-received-key', 'installed ciphertext readable');
        check(!Object.values(secret.value).includes('synthetic-received-key'), 'no plaintext storage');
        check(await denied(() => request.install(packet)), 'replay refused');
        const ack = await request.acknowledgment();
        check((await verifyDeliveryAck(ack, {...binding, recipient: binding.owner,
          nonce: Array.from(request.nonce, b => b.toString(16).padStart(2, '0')).join(''),
          policyRevision: 1n, generation: 1n})).status === 'recipient-confirmed-saved', 'committed receipt verified');
      } else {
        check(secret === null && journal.value.state === 'pending', 'no partial install');
        check(await denied(() => request.acknowledgment()), 'failed installation cannot acknowledge');
      }
      request.close(); packet.fill(0); store.close();
      if (variant === 'normal') window.savedBinding = binding;
    }
  });
  const binding = await page.evaluate(() => savedBinding);
  const reopened = await context.newPage(); await reopened.goto(page.url());
  assert.equal(await reopened.evaluate(async binding => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./storage.mjs')).openBrowserStorage('receiver-install-normal');
    try {
      const vault = (await import('./local-vault.mjs')).openLocalATVault({wasm, store, ...binding});
      const journal = await store.read('along-at-request:' + binding.owner, binding.group + ':' + binding.credential);
      return await vault.getKey() === 'synthetic-received-key' && journal.value.state === 'consumed';
    } finally { store.close(); }
  }, binding), true);
  console.log('PASS: actual signed message to encrypted IndexedDB installation with atomic nonce consumption; replay, concurrent install, interrupted writes, cancellation, supersession and policy revision changes. Self-recipient fixture; no authenticated peer transport or owner-consent bootstrap claim.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
