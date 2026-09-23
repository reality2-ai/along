import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['software-persona.mjs', 'local-persona.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : sources.has(req.url) ? 'text/javascript' : 'text/html');
  res.end(sources.get(req.url) || '<!doctype html><title>First-use test</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext(), page = await context.newPage();
  const url = `http://127.0.0.1:${server.address().port}`; await page.goto(url);
  const group = await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./storage.mjs');
    const {initializeSoftwarePersona} = await import('./software-persona.mjs');
    const check = (v, why) => { if (!v) throw new Error(why); };
    const denied = fn => fn().then(() => false, () => true);
    const store = await openBrowserStorage('software-persona');
    const result = await initializeSoftwarePersona({wasm, store});
    check(await denied(() => initializeSoftwarePersona({wasm, store})), 'existing identity not replaced');
    const record = await store.read('along-browser-issuer', result.group);
    check(record.value.wrappingKey.extractable === false && record.value.ciphertext instanceof Uint8Array
      && !('privateKey' in record.value), 'only encrypted issuer and nonextractable wrapper persisted');
    store.close();
    const concurrent = await openBrowserStorage('software-concurrent');
    const outcomes = await Promise.allSettled([initializeSoftwarePersona({wasm, store: concurrent}), initializeSoftwarePersona({wasm, store: concurrent})]);
    check(outcomes.filter(v => v.status === 'fulfilled').length === 1, 'one first-use winner'); concurrent.close();
    const interrupted = await openBrowserStorage('software-interrupted');
    const original = IDBObjectStore.prototype.put; let writes = 0;
    IDBObjectStore.prototype.put = function(...args) { const result = original.apply(this, args); if (++writes === 4) this.transaction.abort(); return result; };
    try { check(await denied(() => initializeSoftwarePersona({wasm, store: interrupted})), 'interrupted install refuses'); }
    finally { IDBObjectStore.prototype.put = original; }
    check(await interrupted.read('candidate-persona', 'active') === null
      && await interrupted.read('persona-bootstrap', 'initial') === null, 'no partial initial state'); interrupted.close();
    return result.group;
  });
  await page.close();
  const reopened = await context.newPage(); await reopened.goto(url);
  assert.equal(await reopened.evaluate(async groupHex => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./storage.mjs');
    const {loadSoftwareIssuer} = await import('./software-persona.mjs');
    const codec = (await import('./certificate.mjs')).certificateCodec(wasm);
    const store = await openBrowserStorage('software-persona');
    const group = Uint8Array.from(groupHex.match(/../g), b => parseInt(b, 16));
    const denied = fn => fn().then(() => false, () => true);
    const check = (v, why) => { if (!v) throw new Error(why); };
    try {
      const issuer = await loadSoftwareIssuer({wasm, store, expectedGroup: group});
      const member = crypto.getRandomValues(new Uint8Array(32));
      const certificate = await issuer.issueCertificate(member);
      check(codec.authentic(certificate, member, group), 'restored real issuer signs correct group');
      issuer.close(); check(await denied(() => issuer.issueCertificate(member)), 'closed custody refuses');
      const aborted = new AbortController(); aborted.abort();
      check(await denied(() => loadSoftwareIssuer({wasm, store, expectedGroup: group, signal: aborted.signal})), 'cancelled restore refuses');
      const other = group.slice(); other[0] ^= 1;
      check(await denied(() => loadSoftwareIssuer({wasm, store, expectedGroup: other})), 'wrong group refuses');
      const missing = {...store, read: async (...args) => args[0] === 'along-browser-issuer' ? null : store.read(...args)};
      check(await denied(() => loadSoftwareIssuer({wasm, store: missing, expectedGroup: group})), 'missing issuer does not recreate');
      const held = await loadSoftwareIssuer({wasm, store, expectedGroup: group});
      const record = await store.read('along-browser-issuer', groupHex);
      const damaged = structuredClone(record.value); damaged.ciphertext[0] ^= 1;
      await store.compareAndSwap('along-browser-issuer', groupHex, record.revision, damaged);
      check(await denied(() => held.issueCertificate(member)), 'changed custody invalidates held issuer'); held.close();
      check(await denied(() => loadSoftwareIssuer({wasm, store, expectedGroup: group})), 'tampered ciphertext refuses restore');
      return true;
    } finally { store.close(); }
  }, group), true);
  console.log('PASS: browser software issuer persists encrypted, restores in a fresh document and signs actual R2 certificates; concurrent/aborted writes, wrong group, missing/tampered records, changed custody and cancellation refuse. No hardware-sealing or completed enrollment claim.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
