import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['software-persona.mjs', 'local-persona.mjs', 'member-removal.mjs', 'removal-message.mjs']) sources.set('/' + name, await readFile(new URL(name, import.meta.url)));
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
      const {removeSoftwareMember} = await import('./member-removal.mjs');
      const peers = await Promise.all([0, 1].map(async () => {
        const subject = crypto.getRandomValues(new Uint8Array(32));
        return {subject, certificate: await issuer.issueCertificate(subject)};
      }));
      const {readIssuedMembers} = await import('./software-persona.mjs');
      const issued = await readIssuedMembers({wasm, store, expectedGroup: group});
      check(issued.length === 3 && peers.every(peer => issued.some(entry => entry.subject.every((b, i) => b === peer.subject[i]))),
        'concurrent certificate issuance retains all directory entries');
      const directoryBefore = await store.read('along-issued-members-v1', groupHex);
      await issuer.issueCertificate(member);
      check((await store.read('along-issued-members-v1', groupHex)).revision === directoryBefore.revision, 'repeated certificate does not duplicate directory');
      const base = {wasm, store, expectedGroup: group};
      const originalMembership = await store.read('membership', groupHex);
      const abortedRemoval = new AbortController(); abortedRemoval.abort();
      check(await denied(() => removeSoftwareMember({...base, ...peers[0], signal: abortedRemoval.signal})), 'cancelled removal refuses');
      const badCertificate = peers[0].certificate.slice(); badCertificate[135] ^= 1;
      check(await denied(() => removeSoftwareMember({...base, ...peers[0], certificate: badCertificate})), 'wrong target proof refuses');
      const own = (await store.read('candidate-persona', 'active')).value.record;
      check(await denied(() => removeSoftwareMember({...base, subject: own.subject, certificate: own.certificate})), 'self removal refuses');
      const failingStore = {...store, compareAndSwapMany: async () => { throw Error('synthetic storage failure'); }};
      check(await denied(() => removeSoftwareMember({...base, store: failingStore, ...peers[0]})), 'failed commit refuses');
      const racingStore = {...store, compareAndSwapMany: async (...args) => {
        const identity = await store.read('candidate-persona', 'active');
        await store.compareAndSwap('candidate-persona', 'active', identity.revision, identity.value);
        return store.compareAndSwapMany(...args);
      }};
      check(await denied(() => removeSoftwareMember({...base, store: racingStore, ...peers[0]})), 'identity revision changes at commit refuse');
      check((await store.read('membership', groupHex)).revision === originalMembership.revision, 'refusals leave membership unchanged');
      const removed = await Promise.all(peers.map(peer => removeSoftwareMember({...base, ...peer})));
      check(removed.every(result => result.status === 'removed-locally' && result.delivered === false), 'local commit does not claim delivery');
      const persisted = await store.read('membership', groupHex);
      const {encodeRemoval, receiveRemoval} = await import('./removal-message.mjs');
      const receivingStore = await openBrowserStorage('removal-transfer');
      let receivingMembership;
      try {
        receivingMembership = await establishMembership(receivingStore, wasm, {group, subject: member, certificate, current: 0n, depth: 0n});
        const message = encodeRemoval(group, removed[0].evidence);
        const receive = (text, options = {}) => receiveRemoval({wasm, store: receivingStore, expectedGroup: group, text, ...options});
        const initial = await receivingStore.read('membership', groupHex);
        const invalid = JSON.parse(message); invalid.signature = (invalid.signature[0] === '0' ? '1' : '0') + invalid.signature.slice(1);
        check(await denied(() => receive(JSON.stringify(invalid))), 'forged remote removal refuses');
        invalid.group = '00'.repeat(32);
        check(await denied(() => receive(JSON.stringify(invalid))), 'wrong group refuses');
        check(await denied(() => receive(message.slice(0, -1))), 'truncated message refuses');
        const cancelled = new AbortController(); cancelled.abort();
        check(await denied(() => receive(message, {signal: cancelled.signal})), 'cancelled receive refuses');
        check((await receivingStore.read('membership', groupHex)).revision === initial.revision, 'invalid remote messages do not write');
        check((await receive(message)).thisDeviceRemoved === false, 'peer removal does not remove receiver');
        const committed = await receivingStore.read('membership', groupHex);
        check((await receive(message)).alreadyKnown === true
          && (await receivingStore.read('membership', groupHex)).revision === committed.revision, 'remote replay does not rewrite');
        check(await receivingMembership.peerStatus(peers[0].certificate, peers[0].subject) === 'revoked', 'remote removal enforced');
        const self = encodeRemoval(group, await issuer.issueRevocation({subject: member, sequence: 99n, reason: 0}));
        check((await receive(self)).thisDeviceRemoved === true, 'receiver accepts signed self removal');
        check(await receivingMembership.status() === 'revoked', 'receiver membership revoked');
        check((await receive(self)).alreadyKnown === true, 'revoked receiver can verify replay');
      } finally { receivingMembership?.close(); receivingStore.close(); }
      check(await denied(() => issuer.issueCertificate(peers[0].subject)), 'removed member cannot be reissued a certificate');
      check(await denied(() => issuer.enrollmentMaterial(peers[0].subject)), 'removed member cannot receive fresh enrollment material');
      check(persisted.value.revocations.length === 2 && new Set(persisted.value.revocations.map(r => r.sequence)).size === 2,
        'concurrent removals retain both records with unique sequences');
      const repeated = await removeSoftwareMember({...base, ...peers[0]});
      check(repeated.evidence.sequence === removed[0].evidence.sequence
        && (await store.read('membership', groupHex)).revision === persisted.revision, 'retry returns original evidence without rewriting');
      const observer = openMembership(store, wasm, group, own.subject);
      try {
        for (const peer of peers) check(await observer.peerStatus(peer.certificate, peer.subject) === 'revoked', 'persisted removal verifies');
      } finally { observer.close(); }
      const lateSubject = crypto.getRandomValues(new Uint8Array(32)), lateCertificate = await issuer.issueCertificate(lateSubject);
      for (const removeAfter of [1, 2]) {
        const subject = crypto.getRandomValues(new Uint8Array(32));
        const certificate = await issuer.issueCertificate(subject);
        const derive = crypto.subtle.deriveBits.bind(crypto.subtle), returned = [];
        crypto.subtle.deriveBits = async (...args) => {
          const buffer = await derive(...args); returned.push(new Uint8Array(buffer));
          if (returned.length === removeAfter) await removeSoftwareMember({...base, subject, certificate});
          return buffer;
        };
        try {
          check(await denied(() => issuer.enrollmentMaterial(subject)), 'recipient removal during derivation refuses material');
          check(returned.length === removeAfter && returned.every(bytes => !bytes.some(Boolean)), 'derived material is wiped on recipient removal');
        } finally { crypto.subtle.deriveBits = derive; }
      }
      const lateAbort = new AbortController();
      const lateStore = {...store, compareAndSwapMany: async (...args) => {
        const committed = await store.compareAndSwapMany(...args); lateAbort.abort(); return committed;
      }};
      check((await removeSoftwareMember({...base, store: lateStore, subject: lateSubject,
        certificate: lateCertificate, signal: lateAbort.signal})).status === 'removed-locally', 'late cancellation does not undo committed fact');
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
  await reopened.close();
  const afterRemoval = await context.newPage(); await afterRemoval.goto(url);
  assert.equal(await afterRemoval.evaluate(async groupHex => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./storage.mjs')).openBrowserStorage('software-persona');
    const group = Uint8Array.from(groupHex.match(/../g), b => parseInt(b, 16));
    const saved = await store.read('membership', groupHex);
    const issued = await (await import('./software-persona.mjs')).readIssuedMembers({wasm, store, expectedGroup: group});
    const membership = (await import('./membership.mjs')).openMembership(store, wasm, group, saved.value.subject);
    try {
      return issued.length === 6 && saved.value.revocations.length === 5 && await membership.status() === 'current';
    } finally { membership.close(); store.close(); }
  }, group), true);
  console.log('PASS: restored software issuer signs verified revocations; durable removals and issued-device directory survive a fresh document. Signed-message receipt rejects tampering/wrong groups and handles replay, peer removal and self-removal. Invalid targets, failed writes and early cancellation refuse; late cancellation retains the committed result. UI, automatic propagation and epoch rotation are not covered by this test.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
