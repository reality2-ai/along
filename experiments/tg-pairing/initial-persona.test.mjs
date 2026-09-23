import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['initial-persona.mjs', 'local-persona.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : sources.has(req.url) ? 'text/javascript' : 'text/html');
  res.end(sources.get(req.url) || '<!doctype html><title>First-use test</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  const group = await page.evaluate(async () => {
    window.wasm = await import('./hive_wasm.js'); await wasm.default();
    window.storage = await import('./storage.mjs'); window.module = await import('./initial-persona.mjs');
    const check = (v, why) => { if (!v) throw new Error(why); };
    const refused = async fn => { try { await fn(); return false; } catch { return true; } };
    window.store = await storage.openBrowserStorage('first-use');
    const created = await module.initializeLocalPersona({wasm, store});
    check(created.status === 'created-local' && created.provenance === 'created-this-session', 'creation report');
    check(created.priorStorage === 'absent-first-use-or-cleared' && created.issuerAvailable(), 'absence and custody limits');
    check(await refused(() => module.initializeLocalPersona({wasm, store})), 'never overwrite an existing persona');
    const record = (await store.read('candidate-persona', 'active')).value;
    check(record.claim === 'open' && record.origin === 'initial', 'atomic claim');
    check(Object.keys(record.record).sort().join(',') === 'certificate,custody,format,group,privateKey,subject', 'no issuer or traffic secrets persisted');
    const membership = await store.read('membership', created.group);
    check(membership.value.current === 0n, 'initial membership committed');
    created.close(); check(!created.issuerAvailable(), 'closed volatile issuer');
    store.close();
    return [...record.record.group];
  });
  const reopened = await context.newPage(); await reopened.goto(url);
  assert.equal(await reopened.evaluate(async group => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./storage.mjs')).openBrowserStorage('first-use');
    try {
      const {loadLocalPersona} = await import('./local-persona.mjs');
      const expectedGroup = new Uint8Array(group);
      const identity = await loadLocalPersona({wasm, store, expectedGroup});
      const message = new Uint8Array([1, 2, 3]);
      const signature = await identity.sign(message);
      const original = await store.read('candidate-persona', 'active');
      const publicKey = await crypto.subtle.importKey('raw', original.value.record.subject, 'Ed25519', false, ['verify']);
      if (!await crypto.subtle.verify('Ed25519', publicKey, signature, message)) throw new Error('Restored signature differs');
      for (const fault of ['bootstrap-missing', 'bootstrap-group', 'bootstrap-member', 'claim-missing', 'claim-owner', 'epoch', 'certificate', 'key']) {
        const other = fault === 'key' ? await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) : null;
        const damaged = {...store, read: async (scope, key) => {
          const saved = await store.read(scope, key);
          if (scope === 'persona-bootstrap') {
            if (fault === 'bootstrap-missing') return null;
            if (fault === 'bootstrap-group') saved.value.group[0] ^= 1;
            if (fault === 'bootstrap-member') saved.value.subject[0] ^= 1;
          }
          if (scope === 'candidate-persona') {
            if (fault === 'claim-missing') delete saved.value.claim;
            if (fault === 'claim-owner') saved.value.claim = 'owner';
            if (fault === 'epoch') saved.value.epoch = 1n;
            if (fault === 'certificate') saved.value.record.certificate[90] ^= 1;
            if (fault === 'key') saved.value.record.privateKey = other.privateKey;
          }
          return saved;
        }};
        if (await loadLocalPersona({wasm, store: damaged, expectedGroup}).then(() => true, () => false)) throw new Error('Accepted ' + fault);
      }
      // An actual revision change invalidates an already returned signing handle.
      const marker = await store.read('persona-bootstrap', 'initial');
      await store.compareAndSwap('persona-bootstrap', 'initial', marker.revision, marker.value);
      if (await identity.sign(message).then(() => true, () => false)) throw new Error('Old restored handle survived changed evidence');
      if ((await store.read('candidate-persona', 'active')).revision !== original.revision) throw new Error('Restore changed persona');
      return identity.provenance === 'loaded-from-storage' && identity.origin === 'initial'
        && identity.claim === 'open' && identity.issuerAvailable === false;
    } finally { store.close(); }
  }, group), true);
  await reopened.close();
  await page.evaluate(async () => {
    const check = (v, why) => { if (!v) throw new Error(why); };
    for (const variant of ['abort-write', 'abort-after', 'race', 'unreadable', 'tombstone', 'missing-claim']) {
      const store = await storage.openBrowserStorage('initial-' + variant);
      const cancel = new AbortController(); let group;
      const tracked = {...store, compareAndSwapMany: async (changes, options) => {
        group = changes.find(change => change.scope === 'membership').key;
        return store.compareAndSwapMany(changes, options);
      }};
      const originalPut = IDBObjectStore.prototype.put;
      const originalTransaction = IDBDatabase.prototype.transaction;
      try {
        if (variant === 'tombstone' || variant === 'missing-claim') await store.compareAndSwap('candidate-persona', 'active', 0,
          variant === 'tombstone' ? null : {format: 1});
        if (variant === 'unreadable') tracked.read = async () => { throw new Error('Read unavailable'); };
        if (variant === 'abort-write') IDBObjectStore.prototype.put = function(...args) {
          const request = originalPut.apply(this, args); cancel.abort(); return request;
        };
        if (variant === 'abort-after') IDBDatabase.prototype.transaction = function(...args) {
          const tx = originalTransaction.apply(this, args);
          if (args[1] === 'readwrite') tx.addEventListener('complete', () => cancel.abort(), {once: true});
          return tx;
        };
        if (variant === 'race') {
          const results = await Promise.allSettled([module.initializeLocalPersona({wasm, store: tracked}), module.initializeLocalPersona({wasm, store: tracked})]);
          check(results.filter(r => r.status === 'fulfilled').length === 1, 'only one concurrent initializer wins');
          results.find(r => r.status === 'fulfilled').value.close();
        } else {
          const result = await module.initializeLocalPersona({wasm, store: tracked, signal: cancel.signal}).then(value => value, () => null);
          check(Boolean(result) === (variant === 'abort-after'), variant + ' outcome');
          if (result) { check(!result.issuerAvailable(), 'late cancellation closes volatile custody'); result.close(); }
        }
      } finally { IDBObjectStore.prototype.put = originalPut; IDBDatabase.prototype.transaction = originalTransaction; }
      const persona = await store.read('candidate-persona', 'active');
      const bootstrap = await store.read('persona-bootstrap', 'initial');
      if (variant === 'abort-after' || variant === 'race') check(persona.value.claim === 'open' && bootstrap.value.format === 1, 'all records committed');
      else {
        check(bootstrap === null, 'no partial bootstrap');
        if (group) check(await store.read('membership', group) === null, 'no partial membership');
        if (variant === 'tombstone' || variant === 'missing-claim') check(persona.revision === 1, 'old record preserved');
        else check(persona === null, 'no partial persona');
      }
      store.close();
    }
  });
  console.log('PASS: real first-use identity/claim/membership commit; fresh-document member restoration with issuer unavailable; refusal on existing/damaged storage; racing initializers and cancellation respect transaction outcome. Local activation and full lifecycle integration remain pending.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
