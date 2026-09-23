import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs', 'peer-session.mjs', 'peer-link.mjs', 'challenge.mjs', 'session-statement.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['../tg-pairing/initial-persona.mjs', '../tg-pairing/local-persona.mjs', 'local-owner.mjs', 'owner-policy.mjs', 'owner-delivery.mjs', 'remote-owner.mjs', '../tg-pairing/local-persona-session.mjs', 'policy.mjs', 'policy-store.mjs', 'local-vault.mjs', 'delivery-message.mjs']) sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
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
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./storage.mjs');
    const {initializeLocalPersona} = await import('./initial-persona.mjs');
    const {openLocalATVault} = await import('./local-vault.mjs');
    const {openLocalPersonaSession} = await import('./local-persona-session.mjs');
    const {sendOwnerCredential} = await import('./owner-delivery.mjs');
    const {updateLocalATPolicy} = await import('./owner-policy.mjs');
    const codec = (await import('./certificate.mjs')).certificateCodec(wasm);
    const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    const check = (v, message) => { if (!v) throw new Error(message); };
    // Synthetic issuer and confirmed-owner bootstrap only. Each device retains
    // its own actual nonextractable member key; the channel proves possession.
    const issuer = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const group = new Uint8Array(await crypto.subtle.exportKey('raw', issuer.publicKey));
    async function device(name) {
      const store = await openBrowserStorage(name);
      const initial = await initializeLocalPersona({wasm, store}); initial.close();
      const persona = await store.read('candidate-persona', 'active'), subject = persona.value.record.subject;
      const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', issuer.privateKey, codec.signingBytes(subject, group, 0n)));
      const certificate = codec.encode(subject, group, 0n, signature);
      await store.compareAndSwap('candidate-persona', 'active', persona.revision,
        {...persona.value, record: {...persona.value.record, group, certificate}});
      const bootstrap = await store.read('persona-bootstrap', 'initial');
      await store.compareAndSwap('persona-bootstrap', 'initial', bootstrap.revision, {format: 1, group, subject});
      await store.compareAndSwap('membership', hex(group), 0, {format: 1, group, subject, certificate, current: 0n, depth: 0n, revocations: []});
      return {store, subject, certificate};
    }
    const owner = await device('peer-key-owner'), receiver = await device('peer-key-receiver');
    check(hex(owner.subject) !== hex(receiver.subject), 'distinct identities');
    const {binding} = await (await import('./local-owner.mjs')).establishLocalATOwner({wasm, store: owner.store, expectedGroup: group});
    await updateLocalATPolicy({wasm, store: owner.store, expectedGroup: group, expectedRevision: 1n,
      devices: [hex(owner.subject), hex(receiver.subject)], certificates: [receiver.certificate]});
    const ownerVault = openLocalATVault({wasm, store: owner.store, ...binding});
    await ownerVault.saveOwnerKey('synthetic-peer-delivery');
    const policyKey = binding.group + ':' + binding.credential, policyScope = 'along-at-policy:' + binding.owner;
    const signed = await owner.store.read(policyScope, policyKey);
    const receiverVault = openLocalATVault({wasm, store: receiver.store, ...binding});
    let sending, receiving, request, resolve, reject, messages = 0;
    const installed = new Promise((yes, no) => { resolve = yes; reject = no; });
    let timeout;
    try {
      receiving = await openLocalPersonaSession({wasm, store: receiver.store, expectedGroup: group, peer: owner.subject,
        role: 'offer', onMessage: async packet => {
          messages++;
          try { resolve(await request.install(packet)); } catch (error) { reject(error); }
        }});
      sending = await openLocalPersonaSession({wasm, store: owner.store, expectedGroup: group, peer: receiver.subject,
        role: 'answer', onMessage: async nonce => {
          try { await sendOwnerCredential({wasm, store: owner.store, expectedGroup: group, peer: receiver.subject,
            peerCertificate: receiver.certificate, nonce, connection: sending}); } catch (error) { reject(error); }
        }});
      const offer = await receiving.offer(), answer = await sending.accept(offer); await receiving.accept(answer);
      await Promise.all([receiving.authenticated(), sending.authenticated()]);
      const {acceptRemoteATOwner} = await import('./remote-owner.mjs');
      const accept = changes => acceptRemoteATOwner({wasm, store: receiver.store, expected: binding,
        ownerCertificate: owner.certificate, policyBytes: signed.value.bytes, policySignature: signed.value.signature,
        connection: receiving, ...changes});
      const denied = fn => fn().then(() => false, () => true);
      const badSignature = signed.value.signature.slice(); badSignature[0] ^= 1;
      check(await denied(() => accept({policySignature: badSignature})), 'invalid policy cannot establish owner');
      check(await denied(() => accept({expected: {...binding, credential: '00'.repeat(16)}})), 'credential not adopted from incoming policy');
      check(await denied(() => accept({ownerCertificate: receiver.certificate})), 'wrong owner certificate refused');
      const ownerIdentity = await (await import('./local-persona.mjs')).loadLocalPersona({wasm, store: owner.store, expectedGroup: group});
      const ungranted = (await import('./policy.mjs')).credentialPolicyBytes({...binding, revision: 2n, generation: 1n, devices: [binding.owner]});
      const ungrantedSignature = await ownerIdentity.sign(ungranted);
      check(await denied(() => accept({policyBytes: ungranted, policySignature: ungrantedSignature})), 'valid owner policy without local grant refused');
      const cancelled = new AbortController(); cancelled.abort();
      check(await denied(() => accept({signal: cancelled.signal})), 'cancelled consent refused');
      const originalPut = IDBObjectStore.prototype.put; let writes = 0;
      IDBObjectStore.prototype.put = function(...args) {
        const result = originalPut.apply(this, args); if (++writes === 2) this.transaction.abort(); return result;
      };
      try { check(await denied(() => accept({})), 'partial owner acceptance rolls back'); }
      finally { IDBObjectStore.prototype.put = originalPut; }
      check(await receiver.store.read('along-at-owners', binding.group) === null
        && await receiver.store.read(policyScope, policyKey) === null, 'no orphan pin or policy');
      const accepted = await accept({});
      check(accepted.status === 'remote-owner-accepted', 'receiver accepted owner and grant');
      check(await denied(() => accept({})), 'accepted owner is not replaced');
      request = await receiverVault.prepareDelivery({ownerCertificate: owner.certificate, signal: receiving.signal});
      await receiving.send(request.nonce);
      const result = await Promise.race([installed, new Promise((_, no) => { timeout = setTimeout(() => no(new Error('Delivery timeout')), 15000); })]);
      check(result.status === 'credential-saved' && messages === 1, 'one authenticated delivery installed');
      check(await receiverVault.getKey() === 'synthetic-peer-delivery', 'receiver decrypts its own record');
      const receivedRecord = await receiver.store.read('along-at-secret:' + binding.owner, policyKey);
      check(receivedRecord.value.member === hex(receiver.subject), 'ciphertext bound to receiver');
      check(receivedRecord.value.wrappingKey.extractable === false, 'receiver wrapping key nonextractable');
      await updateLocalATPolicy({wasm, store: owner.store, expectedGroup: group, expectedRevision: 2n, devices: [hex(owner.subject)]});
      check(await sendOwnerCredential({wasm, store: owner.store, expectedGroup: group, peer: receiver.subject,
        peerCertificate: receiver.certificate, nonce: crypto.getRandomValues(new Uint8Array(16)), connection: sending}).then(() => false, () => true), 'removed peer receives no further delivery');
      check(messages === 1, 'no removed-peer message sent');
    } finally { clearTimeout(timeout); request?.close(); sending?.close(); receiving?.close(); owner.store.close(); receiver.store.close(); }
  });
  console.log('PASS: distinct real browser identities mutually authenticate over direct WebRTC, owner grant gates signed delivery, receiver encrypts/consumes request, removed peer is refused. Synthetic issuer, reviewed-descriptor fixture and keys; checked receiver acceptance; one browser host, not physical-device reachability or public release.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
