import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs', 'peer-session.mjs', 'peer-link.mjs', 'challenge.mjs', 'session-statement.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['../tg-pairing/initial-persona.mjs', '../tg-pairing/local-persona.mjs', 'local-owner.mjs', 'owner-policy.mjs', 'owner-delivery.mjs', 'remote-owner.mjs', 'policy-update.mjs', 'policy-update-message.mjs', 'remote-owner-view.mjs', 'settings-view.mjs', 'credential-view.mjs', '../tg-pairing/comparison.css', '../tg-pairing/local-persona-session.mjs', 'policy.mjs', 'policy-store.mjs', 'local-vault.mjs', 'delivery-message.mjs']) sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
for (const name of ['live-client.mjs', '../../public/at-client.js', '../../public/live-client.js']) sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
const server = createServer((req, res) => {
  const path = '/' + req.url.split('/').pop();
  res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : req.url.endsWith('.css') ? 'text/css' : sources.has(path) ? 'text/javascript' : 'text/html');
  res.end(sources.get(path) || '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Device consent</title><link rel="stylesheet" href="/comparison.css"></head><body><main><h1 style="font:600 1.5rem system-ui">Connect devices</h1><div id="consent"></div></main></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const context = await browser.newContext({viewport: {width: 320, height: 640}});
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.exposeFunction('exerciseConsent', async action => {
    if (action === 'cancel') { await page.keyboard.press('Escape'); return; }
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
    await page.evaluate(() => document.querySelector('.pairing-primary').click());
    await page.getByRole('heading', {name: 'Use your connected device’s AT key?'}).waitFor();
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  });
  await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./storage.mjs');
    const {initializeLocalPersona} = await import('./initial-persona.mjs');
    const {openLocalATVault} = await import('./local-vault.mjs');
    const {openLocalPersonaSession} = await import('./local-persona-session.mjs');
    const {sendOwnerCredential} = await import('./owner-delivery.mjs');
    const {applyRemoteATPolicy, encodePolicyUpdate, decodePolicyUpdate} = await import('./policy-update.mjs');
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
    let sending, receiving, request, resolve, reject, messages = 0, policyReply, policyError;
    const installed = new Promise((yes, no) => { resolve = yes; reject = no; });
    let timeout;
    try {
      receiving = await openLocalPersonaSession({wasm, store: receiver.store, expectedGroup: group, peer: owner.subject,
        role: 'offer', onMessage: async packet => {
          if (policyReply) {
            try { policyReply(await applyRemoteATPolicy({wasm, store: receiver.store, expectedGroup: group,
              peer: owner.subject, connection: receiving, ...decodePolicyUpdate(packet)})); }
            catch (error) { policyError(error); }
            finally { policyReply = undefined; policyError = undefined; }
            return;
          }
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
      const {showRemoteOwnerConsent} = await import('./remote-owner-view.mjs');
      const consentOptions = {wasm, store: receiver.store, expected: binding, ownerCertificate: owner.certificate,
        policyBytes: signed.value.bytes, policySignature: signed.value.signature, connection: receiving, focus: true};
      let backs = 0;
      const cancelledView = showRemoteOwnerConsent(document.querySelector('#consent'), {...consentOptions, onBack: () => { backs++; }});
      await cancelledView.ready; await window.exerciseConsent('cancel');
      check(backs === 1 && await receiver.store.read('along-at-owners', binding.group) === null, 'Back does not accept owner');
      const consent = showRemoteOwnerConsent(document.querySelector('#consent'), consentOptions);
      await consent.ready; await window.exerciseConsent('allow');
      const accepted = await consent.completed;
      check(document.activeElement.textContent === 'Back', 'consent completion keeps keyboard focus');
      check(document.querySelector('[role=status]').textContent.includes('has not been received'), 'consent is not delivery');
      consent.dispose();
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
      const owners = await import('./local-owner.mjs');
      const restored = await owners.loadATBinding({wasm, store: receiver.store, expectedGroup: group});
      check(restored.role === 'recipient' && restored.binding.owner === binding.owner, 'recipient role restored');
      check(await owners.loadLocalATOwner({wasm, store: receiver.store, expectedGroup: group}).then(() => false, () => true), 'recipient cannot restore as owner');
      const damaged = {...receiver.store, read: async (...args) => {
        const value = await receiver.store.read(...args);
        if (args[0] === 'along-at-owners') delete value.value.ownerCertificate;
        return value;
      }};
      check(await owners.loadATBinding({wasm, store: damaged, expectedGroup: group}).then(() => false, () => true), 'missing remote certificate refuses restore');
      window.restoreGroup = Array.from(group);
      let entered, release, calls = 0;
      const fetching = new Promise(yes => { entered = yes; });
      const delayed = new Promise(yes => { release = yes; });
      const live = (await import('./live-client.mjs')).createVaultATClient({vault: receiverVault, now: () => 1001,
        fetcher: async () => { calls++; entered(); await delayed; return {ok: true, json: async () => ({header: {timestamp: 1000}, entity: []})}; }});
      const pendingLive = live.read('predictions', {requested: true}); await fetching;
      const sendPolicy = async () => {
        const record = await owner.store.read(policyScope, policyKey);
        const pending = new Promise((yes, no) => { policyReply = yes; policyError = no; });
        await sending.send(encodePolicyUpdate(record.value.bytes, record.value.signature));
        return pending;
      };
      await updateLocalATPolicy({wasm, store: owner.store, expectedGroup: group, expectedRevision: 2n, devices: [hex(owner.subject)]});
      const removal = (await owner.store.read(policyScope, policyKey)).value;
      const applying = changes => applyRemoteATPolicy({wasm, store: receiver.store, expectedGroup: group,
        peer: owner.subject, connection: receiving, policyBytes: removal.bytes, policySignature: removal.signature, ...changes});
      check(await denied(() => applying({peer: receiver.subject})), 'unrelated peer cannot apply owner policy');
      const invalid = removal.signature.slice(); invalid[0] ^= 1;
      check(await denied(() => applying({policySignature: invalid})), 'invalid removal signature refused');
      await sendPolicy();
      check(await denied(() => receiverVault.getKey()), 'received removal stops local key access');
      release(); check(!(await pendingLive).available, 'received removal suppresses pending live result');
      check(!(await live.read('predictions', {requested: true})).available && calls === 1, 'removed device cannot request another feed');
      live.close();
      check(await denied(() => applying({})), 'replayed removal refused');
      check(await sendOwnerCredential({wasm, store: owner.store, expectedGroup: group, peer: receiver.subject,
        peerCertificate: receiver.certificate, nonce: crypto.getRandomValues(new Uint8Array(16)), connection: sending}).then(() => false, () => true), 'removed peer receives no further delivery');
      check(messages === 1, 'no removed-peer message sent');
      await updateLocalATPolicy({wasm, store: owner.store, expectedGroup: group, expectedRevision: 3n,
        devices: [hex(owner.subject), hex(receiver.subject)], certificates: [receiver.certificate]});
      await sendPolicy();
      check(await receiverVault.getKey() === 'synthetic-peer-delivery', 'explicit newer grant restores local use');
    } finally { clearTimeout(timeout); request?.close(); sending?.close(); receiving?.close(); owner.store.close(); receiver.store.close(); }
  });
  const restoredGroup = await page.evaluate(() => restoreGroup);
  const reopened = await context.newPage(); await reopened.goto(page.url());
  await reopened.evaluate(async expectedGroup => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    window.store = await (await import('./storage.mjs')).openBrowserStorage('peer-key-receiver');
    const {showATSettings} = await import('./settings-view.mjs');
    window.view = showATSettings(document.querySelector('#consent'), {wasm, store, expectedGroup: new Uint8Array(expectedGroup), focus: true});
    await view.ready;
  }, restoredGroup);
  await reopened.getByRole('heading', {name: 'AT key saved on this device'}).waitFor();
  assert.equal(await reopened.getByRole('button', {name: 'Save key on this device'}).count(), 0);
  assert.equal(await reopened.getByRole('button', {name: 'Set up live information'}).count(), 0);
  await reopened.evaluate(() => { view.dispose(); store.close(); });
  console.log('PASS: distinct real browser identities mutually authenticate over direct WebRTC, owner grant gates signed delivery, receiver encrypts/consumes request, removed peer is refused. Synthetic issuer, reviewed-descriptor fixture and keys; checked receiver acceptance; one browser host, not physical-device reachability or public release.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
