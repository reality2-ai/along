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
      const material = await issuer.enrollmentMaterial(member);
      // Independent RFC 5869 extract/expand using HMAC, not deriveBits.
      const heldRecord = (await store.read('along-browser-issuer', groupHex)).value;
      const aad = new TextEncoder().encode(JSON.stringify(['along/software-issuer/v1', groupHex, issuer.member]));
      const pkcs8 = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: heldRecord.iv, additionalData: aad}, heldRecord.wrappingKey, heldRecord.ciphertext));
      const saltKey = await crypto.subtle.importKey('raw', group, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
      const extracted = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, pkcs8.subarray(16))); pkcs8.fill(0);
      const expandKey = await crypto.subtle.importKey('raw', extracted, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']); extracted.fill(0);
      for (const [purpose, actual] of [['payload', material.payloadKey], ['integrity', material.integrityKey]]) {
        const info = new TextEncoder().encode('r2/v0/group/' + purpose), block = new Uint8Array(info.length + 1); block.set(info); block[info.length] = 1;
        const expected = new Uint8Array(await crypto.subtle.sign('HMAC', expandKey, block));
        check(expected.every((v, i) => v === actual[i]), 'material agrees with independent extract/expand'); expected.fill(0);
      }
      check(!material.payloadKey.every((v, i) => v === material.integrityKey[i]), 'purpose separation');
      material.destroy(); check(!material.payloadKey.some(Boolean) && !material.integrityKey.some(Boolean), 'material destruction');
      const {establishMembership, openMembership} = await import('./membership.mjs');
      const recipientStore = await openBrowserStorage('software-revoked-member');
      let membership;
      try {
        membership = await establishMembership(recipientStore, wasm, {group, subject: member,
          current: 0n, depth: 0n, certificate});
        const request = {subject: member, sequence: 1n, reason: 0};
        for (const sequence of [0n, -1n, 0x10000000000000000n, 1, '1']) {
          check(await denied(() => issuer.issueRevocation({...request, sequence})), 'invalid sequence refuses before WASM conversion');
        }
        for (const reason of [-1, 4, 0.5, '0']) {
          check(await denied(() => issuer.issueRevocation({...request, reason})), 'invalid reason refuses');
        }
        check(await denied(() => issuer.issueRevocation({...request, subject: member.slice(1)})), 'invalid subject refuses');
        const evidence = await issuer.issueRevocation(request);
        check(await membership.status() === 'current', 'signing alone does not claim removal');
        for (const field of ['subject', 'signature']) {
          const tampered = structuredClone(evidence); tampered[field][0] ^= 1;
          check(await denied(() => membership.applyRevocation(tampered)), 'tampered revocation refuses');
        }
        check(await membership.status() === 'current', 'invalid evidence preserves membership');
        await membership.applyRevocation(evidence);
        check(await membership.status() === 'revoked', 'restored issuer revokes real membership');
        await membership.applyRevocation(evidence);
        check((await recipientStore.read('membership', groupHex)).value.revocations.length === 1, 'replay is deduplicated');
        membership.close(); recipientStore.close();
        const reopenedStore = await openBrowserStorage('software-revoked-member');
        try {
          membership = openMembership(reopenedStore, wasm, group, member);
          check(await membership.status() === 'revoked', 'revocation survives storage reopen');
          membership.close();
        } finally { reopenedStore.close(); }
      } finally { membership?.close(); recipientStore.close(); }
      issuer.close(); check(await denied(() => issuer.issueCertificate(member)), 'closed custody refuses');
      check(await denied(() => issuer.issueRevocation({subject: member, sequence: 1n, reason: 0})), 'closed revocation custody refuses');
      const duringSigning = new AbortController();
      const cancelledIssuer = await loadSoftwareIssuer({wasm, store, expectedGroup: group, signal: duringSigning.signal});
      const originalSign = crypto.subtle.sign.bind(crypto.subtle);
      crypto.subtle.sign = async (...args) => { const signature = await originalSign(...args); duringSigning.abort(); return signature; };
      try {
        check(await denied(() => cancelledIssuer.issueRevocation({subject: member, sequence: 2n, reason: 0})),
          'cancellation while signing prevents evidence from escaping');
      } finally { crypto.subtle.sign = originalSign; cancelledIssuer.close(); }
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
      check(await denied(() => held.issueCertificate(member)), 'changed custody invalidates held issuer');
      check(await denied(() => held.issueRevocation({subject: member, sequence: 1n, reason: 0})), 'changed custody refuses revocation'); held.close();
      check(await denied(() => loadSoftwareIssuer({wasm, store, expectedGroup: group})), 'tampered ciphertext refuses restore');
      return true;
    } finally { store.close(); }
  }, group), true);
  console.log('PASS: browser software issuer restores encrypted custody and signs actual R2 certificates and revocations; real membership rejects tampering, retains revocation on storage reopen and deduplicates replay. Invalid inputs, closed/changed custody and interrupted initialization refuse. Revocation UI, distribution and epoch rotation are not covered.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
