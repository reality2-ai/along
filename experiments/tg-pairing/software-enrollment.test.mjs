// Actual browser-software issuer and core enrollment; harness supplies initial trust and signaling.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_BROWSER_DIR) throw new Error('Set R2_BROWSER_DIR to the experimental Reality2 browser module directory');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
const sources = new Map(await Promise.all(['peer-session', 'challenge', 'session-statement', 'membership', 'certificate', 'enrollment-session', 'storage', 'invitation-journal', 'enrollment-link', 'enrollment-exchange', 'enrollment-protection', 'peer-link', 'invitation'].map(async name => ['/' + name + '.mjs', await readFile(join(process.env.R2_BROWSER_DIR, name + '.mjs'))])));
for (const name of ['enrollment-profile.mjs', 'enrollment-payloads.mjs', 'core-candidate-session.mjs', 'software-traffic.mjs', 'initial-persona.mjs', 'software-persona.mjs', 'software-invitation.mjs', 'invitation-proof.mjs', 'receive-invitation-view.mjs', 'stored-claim.mjs', 'installation-receipt.mjs', 'local-persona.mjs', 'local-persona-session.mjs', 'receipt-recovery.mjs']) sources.set('/' + name, await readFile(new URL('./' + name, import.meta.url)));
if (process.env.RECOVERY_MODULE) sources.set('/receipt-recovery.mjs', await readFile(process.env.RECOVERY_MODULE));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.writeHead(200, {'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'}); res.end(sources.get(req.url)); }
  else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!doctype html><title>Core session test</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const url = `http://127.0.0.1:${server.address().port}`;
  await Promise.all(pages.map(async (page, index) => {
    await page.goto(url);
    await page.evaluate(async index => {
      window.wasm = await import('./hive_wasm.js'); await wasm.default();
      window.store = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
      window.restore = await import('./local-persona.mjs');
      if (index === 0) {
        const initial = await (await import('./initial-persona.mjs')).initializeLocalPersona({wasm, store}); initial.close();
      } else {
        window.software = await import('./software-persona.mjs');
        const result = await software.initializeSoftwarePersona({wasm, store});
        window.group = Uint8Array.from(result.group.match(/../g), b => parseInt(b, 16));
        store.close(); window.store = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
        window.issuer = await software.loadSoftwareIssuer({wasm, store, expectedGroup: group});
      }
    }, index);
  }));
  assert.equal(await pages[1].evaluate(async () => {
    const {createSoftwareInvitation, decodeSoftwareInvitation, encodeSoftwareInvitation} = await import('./software-invitation.mjs');
    const denied = async fn => { try { await fn(); return false; } catch { return true; } };
    const start = options => createSoftwareInvitation({wasm, store, expectedGroup: group, ...options});
    const challenge = crypto.getRandomValues(new Uint8Array(16));
    const cancelled = new AbortController(); cancelled.abort();
    if (!await denied(() => start({signal: cancelled.signal}))) return false;
    const early = await start();
    if (!await denied(() => early.enrollmentMaterial(group)) || !early.signal.aborted) return false;
    const duplicate = await start();
    await duplicate.respondChallenge(challenge);
    if (!await denied(() => duplicate.respondChallenge(challenge)) || !duplicate.signal.aborted) return false;
    const closed = await start(); closed.close();
    if (!await denied(() => closed.respondChallenge(challenge))) return false;
    const controller = new AbortController(), aborted = await start({signal: controller.signal});
    controller.abort();
    if (!aborted.signal.aborted || !await denied(() => aborted.respondChallenge(challenge))) return false;
    const expiring = await start({lifetimeMs: 1000});
    // Suspend timers as a backgrounded tab might: the use-time deadline must
    // refuse the operation even before its cleanup timer gets a turn.
    const until = performance.now() + 1001;
    while (performance.now() < until) { /* deliberately block this test page */ }
    if (!await denied(() => expiring.respondChallenge(challenge)) || !expiring.signal.aborted) return false;
    const sample = await start();
    try {
      const descriptor = JSON.parse(sample.descriptor);
      for (const text of ['{}', '[]', 'x'.repeat(1025),
        JSON.stringify({...descriptor, secret: 'unexpected'}),
        JSON.stringify({...descriptor, validity: '18446744073709551616'}),
        JSON.stringify({...descriptor, validity: '08'}),
        JSON.stringify({...descriptor, group: 'z'.repeat(64)}),
        JSON.stringify({...descriptor, profile: 'another-profile'})]) {
        if (!await denied(() => decodeSoftwareInvitation(text))) return false;
      }
      const first = sample.invitation(); first.group.fill(0);
      if (sample.invitation().group.every(value => value === 0)) return false;
      if (!await denied(() => encodeSoftwareInvitation({...sample.invitation(), validity: 8}))) return false;
      return encodeSoftwareInvitation(sample.invitation()) === sample.descriptor;
    } finally { sample.close(); }
  }), true);
  console.log('PASS: invitation descriptor validation, snapshot isolation, cancellation, single challenge and use-time expiry.');
  const invitation = await pages[1].evaluate(async () => {
    window.invite = await (await import('./software-invitation.mjs')).createSoftwareInvitation({wasm, store, expectedGroup: group});
    window.invitation = invite.invitation();
    window.session = await (await import('./enrollment-session.mjs')).createEnrollmentSession({wasm, invitation, role: 'provisioner', store});
    window.payloads = (await import('./enrollment-payloads.mjs')).enrollmentPayloads({wasm, invitation, epoch: 0n, role: 'provisioner', session});
    return {descriptor: invite.descriptor};
  });
  await pages[0].evaluate(async () => {
    window.review = (await import('./receive-invitation-view.mjs')).showReceiveInvitation(document.body, {focus: true});
  });
  await pages[0].getByLabel('Invitation text').fill(invitation.descriptor);
  await pages[0].getByRole('button', {name: 'Review invitation', exact: true}).click();
  await pages[0].getByRole('button', {name: 'Use invitation from my other device', exact: true}).click();
  assert.equal(await pages[0].evaluate(async () => (await review.completed).descriptor), invitation.descriptor);
  const request = await pages[0].evaluate(async () => {
    window.proofModule = await import('./invitation-proof.mjs');
    window.reviewed = await review.completed;
    window.proofExchange = proofModule.createInvitationProof({wasm, reviewed});
    return proofExchange.request;
  });
  const response = await pages[1].evaluate(async request => (await import('./invitation-proof.mjs')).answerInvitationProof(invite, request), request);
  // Each negative case gets a real freshly signed response for its own nonce.
  for (const fault of ['nonce', 'certificate', 'signature', 'descriptor', 'cancel', 'oversize']) {
    const descriptor = await pages[1].evaluate(async () => {
      window.testInvite = await (await import('./software-invitation.mjs')).createSoftwareInvitation({wasm, store, expectedGroup: group});
      return testInvite.descriptor;
    });
    const negativeRequest = await pages[0].evaluate(descriptor => {
      window.testAbort = new AbortController();
      window.testProof = proofModule.createInvitationProof({wasm, reviewed: {descriptor, signal: testAbort.signal}});
      return testProof.request;
    }, descriptor);
    const negativeResponse = await pages[1].evaluate(async request => {
      try { return await (await import('./invitation-proof.mjs')).answerInvitationProof(testInvite, request); }
      finally { testInvite.close(); }
    }, negativeRequest);
    assert.equal(await pages[0].evaluate(({response, fault}) => {
      const value = JSON.parse(response);
      const flip = text => (text[0] === '0' ? '1' : '0') + text.slice(1);
      if (fault === 'nonce') value.nonce = flip(value.nonce);
      if (fault === 'certificate') value.certificate = flip(value.certificate);
      if (fault === 'signature') value.proof = flip(value.proof);
      if (fault === 'descriptor') {
        const descriptor = JSON.parse(value.descriptor); descriptor.code = flip(descriptor.code); value.descriptor = JSON.stringify(descriptor);
      }
      if (fault === 'cancel') testAbort.abort();
      const denied = input => { try { testProof.verify(input).authorized.free(); return false; } catch { return true; } };
      return denied(fault === 'oversize' ? 'x'.repeat(2049) : JSON.stringify(value)) && denied(response);
    }, {response: negativeResponse, fault}), true);
  }
  await pages[0].evaluate(async response => {
    const verified = proofExchange.verify(response);
    try { proofExchange.verify(response).authorized.free(); throw new Error('Duplicate proof accepted'); }
    catch (error) { if (error.message === 'Duplicate proof accepted') throw error; }

    window.invitation = verified.invitation;
    window.session = await (await import('./core-candidate-session.mjs')).createCoreCandidateSession({wasm, store, invitation, authorized: verified.authorized,
      softwareCustody: true, signal: verified.signal, platform: {candidateDevelopment: false, provisionerDevelopment: false, provisionerHoldsCustody: true, epoch: 0n}});
  }, response);
  const offer = await pages[0].evaluate(() => session.offer());
  const answer = await pages[1].evaluate(offer => session.accept(offer), offer);
  await pages[0].evaluate(answer => session.accept(answer), answer);
  const targetGroup = await pages[0].evaluate(() => [...invitation.group]);
  const comparisons = await Promise.all(pages.map(page => page.evaluate(async () => [...await session.comparison()])));
  assert.deepEqual(comparisons[0], comparisons[1]);
  await Promise.all(pages.map(page => page.evaluate(() => session.decide(true))));
  await pages[0].evaluate(() => session.sendClaim());
  const expectedKeys = await pages[1].evaluate(async () => {
    const subject = await payloads.claim();
    const material = await invite.enrollmentMaterial(subject);
    const digests = await Promise.all([material.payloadKey, material.integrityKey].map(async key => [...new Uint8Array(await crypto.subtle.digest('SHA-256', key))]));
    try { await payloads.sendBundle(material); }
    finally { material.destroy(); }
    if (material.payloadKey.some(Boolean) || material.integrityKey.some(Boolean)) throw new Error('Temporary bundle was not cleared');
    return digests;
  });
  if (process.env.ABORT_TRAFFIC === '1') {
    assert.equal(await pages[0].evaluate(async () => {
      const original = IDBObjectStore.prototype.put; let triggered = false;
      IDBObjectStore.prototype.put = function(...args) {
        const result = original.apply(this, args);
        if (args[1]?.[0] === 'along-browser-traffic') { triggered = true; this.transaction.abort(); }
        return result;
      };
      try {
        if (await session.installLocal().then(() => true, () => false)) return false;
      } finally { IDBObjectStore.prototype.put = original; }
      const groupId = Array.from(invitation.group, b => b.toString(16).padStart(2, '0')).join('');
      return triggered && (await store.read('candidate-persona', 'active')).value.origin === 'initial'
        && await store.read('along-browser-traffic', groupId) === null && await store.read('membership', groupId) === null;
    }), true);
    console.log('PASS: interrupted traffic-key write rolls back recipient membership and persona with no orphan traffic record.');
  } else {
  const receipt = await pages[0].evaluate(() => session.installLocal());
  assert.equal(receipt.status, 'installed-local');
  await pages[0].evaluate(async () => { await session.dispose(); store.close(); });
  await pages[1].evaluate(async () => { invite.close(); issuer.close(); await session.cancel(); store.close(); });
  await pages[0].close();
  const reopened = await contexts[0].newPage(); await reopened.goto(url);
  assert.equal(await reopened.evaluate(async ({group, expectedKeys}) => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
    try {
      const restored = await (await import('./local-persona.mjs')).loadLocalPersona({wasm, store, expectedGroup: new Uint8Array(group)});
      const module = await import('./software-traffic.mjs');
      const material = await module.loadSoftwareTraffic({wasm, store, expectedGroup: new Uint8Array(group)});
      const digests = await Promise.all([material.payloadKey, material.integrityKey].map(async key => [...new Uint8Array(await crypto.subtle.digest('SHA-256', key))]));
      if (JSON.stringify(digests) !== JSON.stringify(expectedKeys)) throw new Error('Restored group material differs');
      material.destroy();
      const denied = fn => fn().then(() => false, () => true);
      const corrupt = {...store, read: async (...args) => {
        const saved = await store.read(...args);
        if (args[0] === 'along-browser-traffic') saved.value.ciphertext[0] ^= 1;
        return saved;
      }};
      if (!await denied(() => module.loadSoftwareTraffic({wasm, store: corrupt, expectedGroup: new Uint8Array(group)}))) throw new Error('Tampered material accepted');
      const stale = {...store, read: async (...args) => {
        const saved = await store.read(...args);
        if (args[0] === 'along-browser-traffic') saved.value.epoch += 1n;
        return saved;
      }};
      if (!await denied(() => module.loadSoftwareTraffic({wasm, store: stale, expectedGroup: new Uint8Array(group)}))) throw new Error('Wrong epoch accepted');
      const aborted = new AbortController(); aborted.abort();
      if (!await denied(() => module.loadSoftwareTraffic({wasm, store, expectedGroup: new Uint8Array(group), signal: aborted.signal}))) throw new Error('Cancelled traffic read accepted');
      return restored.origin === 'enrolled' && restored.claim === 'owner' && (await restored.sign(new Uint8Array(32))).length === 64;
    } finally { store.close(); }
  }, {group: targetGroup, expectedKeys}), true);
  console.log('PASS: actual restored software issuer derives enrollment material, signs the candidate certificate, and completes core browser installation over WebRTC; fresh-document member restore/sign succeeds. Harness supplies trust review, comparison decision and signaling; encrypted traffic-key restore verified; no hardware custody or physical-device claim.');
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
