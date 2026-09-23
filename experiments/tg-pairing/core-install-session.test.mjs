// Protected enrollment carriage over actual channels; all payloads synthetic.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_BROWSER_DIR) throw new Error('Set R2_BROWSER_DIR to the experimental Reality2 browser module directory');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
const sources = new Map(await Promise.all(['peer-session', 'challenge', 'session-statement', 'membership', 'certificate', 'enrollment-session', 'storage', 'invitation-journal', 'enrollment-link', 'enrollment-exchange', 'enrollment-protection', 'peer-link', 'invitation'].map(async name => ['/' + name + '.mjs', await readFile(join(process.env.R2_BROWSER_DIR, name + '.mjs'))])));
for (const name of ['enrollment-profile.mjs', 'enrollment-payloads.mjs', 'core-candidate-session.mjs', 'software-traffic.mjs', 'initial-persona.mjs', 'stored-claim.mjs', 'installation-receipt.mjs', 'local-persona.mjs', 'local-persona-session.mjs', 'receipt-recovery.mjs']) sources.set('/' + name, await readFile(new URL('./' + name, import.meta.url)));
if (process.env.RECOVERY_MODULE) sources.set('/receipt-recovery.mjs', await readFile(process.env.RECOVERY_MODULE));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.writeHead(200, {'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'}); res.end(sources.get(req.url)); }
  else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!doctype html><title>Core session test</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  await Promise.all(pages.map(async (page, index) => {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async index => {
      window.wasm = await import('./hive_wasm.js'); await wasm.default();
      window.module = await import('./enrollment-session.mjs');
      window.coreModule = await import('./core-candidate-session.mjs');
      window.initialModule = await import('./initial-persona.mjs');
      window.restoreModule = await import('./local-persona.mjs');
      window.receiptModule = await import('./installation-receipt.mjs');
      window.personaSession = await import('./local-persona-session.mjs');
      window.recoveryModule = await import('./receipt-recovery.mjs');
      window.peerSessionModule = await import('./peer-session.mjs');
      window.membershipModule = await import('./membership.mjs');
      window.storageModule = await import('./storage.mjs');
      window.controller = await import('./enrollment-payloads.mjs');
      window.codec = (await import('./certificate.mjs')).certificateCodec(wasm);
      window.store = await (await import('./storage.mjs')).openBrowserStorage('core-session-test');
      window.sentAcknowledgments = 0; window.coreConfirms = 0; window.sentClaims = 0; window.claimState = 'open'; window.stateReads = 0;
      const originalConfirm = wasm.BrowserCandidateCeremony.prototype.confirm;
      wasm.BrowserCandidateCeremony.prototype.confirm = function(value) { coreConfirms++; return originalConfirm.call(this, value); };
      const originalSend = RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send = function(text) { if (JSON.parse(text).type === 'claim') sentClaims++; if (JSON.parse(text).type === 'acknowledged') sentAcknowledgments++; return originalSend.call(this, text); };
      if (index === 1) {
        window.authority = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
        window.issuerKey = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
        window.group = new Uint8Array(await crypto.subtle.exportKey('raw', authority.publicKey));
        window.issuer = new Uint8Array(await crypto.subtle.exportKey('raw', issuerKey.publicKey));
        const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey, codec.signingBytes(issuer, group, 7n)));
        window.issuerCertificate = codec.encode(issuer, group, 7n, signature);
      }
    }, index);
  }));
  await new Promise(resolve => server.close(resolve));
  let code = 0;
  const setup = async (delaySetup = false, delayReservation = false) => {
    const nonce = await pages[0].evaluate(() => { window.nonce = crypto.getRandomValues(new Uint8Array(16)); return [...nonce]; });
    const evidence = await pages[1].evaluate(async ({code, nonce}) => {
      sentAcknowledgments = 0;
      window.invitation = {group, issuer, code: new Uint8Array(16).fill(code), validity: 8n, role: 'member'};
      const statement = wasm.tg_invitation_statement(group, issuer, 1, invitation.code, 8n);
      const proof = new Uint8Array(await crypto.subtle.sign('Ed25519', issuerKey.privateKey, wasm.tg_nonce_signing_bytes(statement, new Uint8Array(nonce))));
      window.enrollment = await module.createEnrollmentSession({wasm, invitation, role: 'provisioner', store});
      window.payloads = controller.enrollmentPayloads({wasm, invitation, epoch: 7n, role: 'provisioner', session: enrollment});
      return {group: [...group], issuer: [...issuer], code: [...invitation.code], certificate: [...issuerCertificate], proof: [...proof]};
    }, {code: ++code, nonce});
    await pages[0].evaluate(async ({evidence, delaySetup, delayReservation}) => {
      // Explicit synthetic initial trust and platform facts. This fixture proves
      // session/core wiring, not how a new user's group trust is established.
      window.invitation = {group: new Uint8Array(evidence.group), issuer: new Uint8Array(evidence.issuer), code: new Uint8Array(evidence.code), validity: 8n, role: 'member'};
      const statement = wasm.tg_invitation_statement(invitation.group, invitation.issuer, 1, invitation.code, 8n);
      const membership = wasm.BrowserMembership.establish(invitation.group, 7n, 0n);
      const authorized = membership.authorise_invitation(statement, new Uint8Array(evidence.certificate), nonce, new Uint8Array(evidence.proof));
      membership.free(); if (!authorized) throw new Error('Fixture authorization failed');
      claimState = 'open'; coreConfirms = 0; sentClaims = 0; stateReads = 0;
      window.setupAbort = new AbortController(); window.delayStateRead = delaySetup; window.readWaiting = false;
      window.raceInstall = false;
      store.close();
      window.store = await storageModule.openBrowserStorage('install-fixture-' + evidence.code[0]);
      // Real group/member creation and atomic first-use storage. Initial trust
      // in the target provisioner's group is still supplied by this fixture.
      const initialized = await initialModule.initializeLocalPersona({wasm, store});
      initialized.close();
      window.reservationWaiting = false;
      const candidateStore = {...store, compareAndSwapMany: async (changes, options) => {
        if (window.raceInstall && changes.some(change => change.scope === 'candidate-persona')) {
          raceInstall = false;
          const prior = await store.read('candidate-persona', 'active');
          await store.compareAndSwap('candidate-persona', 'active', prior.revision, {format: 1, claim: 'owner', winner: 'competing-fixture'});
        }
        return store.compareAndSwapMany(changes, options);
      }};
      window.creation = coreModule.createCoreCandidateSession({wasm, invitation, authorized, store: candidateStore, signal: setupAbort.signal,
        platform: {candidateDevelopment: false, provisionerDevelopment: false, provisionerHoldsCustody: true, epoch: 7n},
        readClaimState: delaySetup ? async () => { stateReads++; if (window.delayStateRead) { window.readWaiting = true; await new Promise(resolve => { window.releaseStateRead = resolve; }); } return (await store.read('candidate-persona', 'active'))?.value?.claim; } : undefined}).then(value => { window.enrollment = value; return true; }, () => false);
      if (!delaySetup && !delayReservation && !await creation) throw new Error('Candidate setup failed');
    }, {evidence, delaySetup, delayReservation});
    if (delaySetup || delayReservation) return;
    const offer = await pages[0].evaluate(() => enrollment.offer());
    const answer = await pages[1].evaluate(value => enrollment.accept(value), offer);
    await pages[0].evaluate(value => enrollment.accept(value), answer);
    const codes = await Promise.all(pages.map(page => page.evaluate(async () => [...await enrollment.comparison()])));
    assert.deepEqual(codes[0], codes[1]);
    assert.equal(await pages[0].evaluate(() => coreConfirms), 0);
  };
  const confirm = async () => {
    await Promise.all(pages.map(page => page.evaluate(() => enrollment.decide(true))));
    assert.equal(await pages[0].evaluate(() => coreConfirms), 1);
  };
  const closed = () => Promise.all(pages.map(page => page.waitForFunction(() => enrollment.state() === 'closed' && enrollment.invitationState() === 'void')));
  const sendBundle = () => pages[1].evaluate(async () => {
    const subject = await payloads.claim();
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey, codec.signingBytes(subject, group, 7n)));
    await payloads.sendBundle({certificate: codec.encode(subject, group, 7n, signature), epoch: 7n,
      payloadKey: new Uint8Array(32).fill(4), integrityKey: new Uint8Array(32).fill(5)});
    return [...subject];
  });
  const storedSignerMatches = expected => pages[0].evaluate(async expected => {
    const saved = await store.read('candidate-persona', 'active');
    if (saved.value.claim !== 'owner') return false;
    const {record} = saved.value;
    if (record.subject.length !== expected.length || !record.subject.every((v, i) => v === expected[i])) return false;
    if (!codec.authentic(record.certificate, record.subject, record.group)) return false;
    if (record.privateKey.extractable || record.custody !== 'browser-nonextractable-unqualified') return false;
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const signature = await crypto.subtle.sign('Ed25519', record.privateKey, challenge);
    const publicKey = await crypto.subtle.importKey('raw', record.subject, 'Ed25519', false, ['verify']);
    return crypto.subtle.verify('Ed25519', publicKey, signature, challenge);
  }, expected);
  const failedInstall = async () => {
    await pages[0].waitForFunction(() => enrollment.state() === 'closed' && enrollment.invitationState() === 'unavailable');
    await pages[1].waitForFunction(() => enrollment.state() === 'closed' && enrollment.invitationState() === 'void');
  };
  await setup(); await confirm();
  await pages[0].evaluate(() => enrollment.sendClaim());
  const member = await sendBundle();
  const receipt = await pages[0].evaluate(() => enrollment.installLocal());
  assert.equal(receipt.status, 'installed-local'); assert.equal(receipt.peerAcknowledged, false);
  assert.equal(await pages[0].evaluate(() => enrollment.invitationState()), 'consumed');
  await pages[0].evaluate(async received => {
    const {record} = (await store.read('candidate-persona', 'active')).value;
    const check = bytes => receiptModule.verifyInstallationReceipt(wasm, invitation, record.subject, record.certificate, bytes);
    const bytes = new Uint8Array(received);
    if (!await check(bytes)) throw new Error('Receipt does not identify installed persona');
    for (const index of [0, 1, 66, 90, 122, 153]) {
      const bad = bytes.slice(); bad[index] ^= 1;
      if (await check(bad)) throw new Error('Changed receipt accepted');
    }
    if (await check(bytes.slice(1))) throw new Error('Truncated receipt accepted');
  }, Array.from(receipt.receipt));
  assert.equal(await storedSignerMatches(member), true);
  assert.equal(await pages[0].evaluate(async () => (await store.read('candidate-persona', 'active')).revision), receipt.revision);
  await pages[0].evaluate(() => enrollment.dispose());
  assert.equal(await pages[0].evaluate(() => enrollment.invitationState()), 'consumed');
  await pages[1].waitForFunction(() => enrollment.state() === 'closed');
  await pages[0].evaluate(async () => {
    const check = (value, reason) => { if (!value) throw new Error(reason); };
    const refuses = async action => { let refused = false; try { await action(); } catch { refused = true; } check(refused, 'Restore must refuse'); };
    const load = customStore => restoreModule.loadLocalPersona({wasm, store: customStore || store, expectedGroup: invitation.group});
    const restored = await load();
    check(restored.status === 'installed-local' && restored.peerAcknowledged === false, 'Only local receipt');
    const saved = await store.read('candidate-persona', 'active');
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const publicKey = await crypto.subtle.importKey('raw', saved.value.record.subject, 'Ed25519', false, ['verify']);
    check(await crypto.subtle.verify('Ed25519', publicKey, await restored.sign(challenge), challenge), 'Restored signer mismatch');
    // Corrupt individual input boundaries without modifying the actual record.
    const corrupt = mutate => ({...store, read: async (scope, key) => {
      const result = await store.read(scope, key); if (scope === 'candidate-persona') mutate(result.value); return result;
    }});
    await refuses(() => load(corrupt(value => { value.record.certificate[90] ^= 1; })));
    await refuses(() => load(corrupt(value => { value.epoch += 1n; })));
    await refuses(() => load(corrupt(value => { value.peerAcknowledged = 'true'; })));
    await refuses(() => load(corrupt(value => { value.peerAcknowledged = null; })));
    await refuses(() => load(corrupt(value => { value.invitation.code[0] ^= 1; })));
    const otherKey = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    await refuses(() => load(corrupt(value => { value.record.privateKey = otherKey.privateKey; })));
    await refuses(() => restoreModule.loadLocalPersona({wasm, store, expectedGroup: new Uint8Array(32)}));
    await store.compareAndSwap('candidate-persona', 'active', saved.revision, saved.value);
    await refuses(() => restored.sign(challenge));
    const fresh = await load();
    check(fresh.member === restored.member, 'Fresh handle should restore same identity');
    const originalSign = crypto.subtle.sign.bind(crypto.subtle);
    crypto.subtle.sign = async (...args) => {
      const signature = await originalSign(...args);
      const current = await store.read('candidate-persona', 'active');
      await store.compareAndSwap('candidate-persona', 'active', current.revision, current.value);
      return signature;
    };
    try { await refuses(() => fresh.sign(challenge)); }
    finally { crypto.subtle.sign = originalSign; }
  });

  const revoke = await pages[1].evaluate(async member => {
    const subject = new Uint8Array(member);
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey,
      wasm.tg_revocation_signing_bytes(subject, 7n, 1n, 0)));
    return {subject: [...subject], signature: [...signature]};
  }, member);
  await pages[0].evaluate(async evidence => {
    const subject = new Uint8Array(evidence.subject);
    const restored = await restoreModule.loadLocalPersona({wasm, store, expectedGroup: invitation.group});
    const membership = membershipModule.openMembership(store, wasm, invitation.group, subject);
    try {
      await membership.applyRevocation({subject, signature: new Uint8Array(evidence.signature), epoch: 7n, sequence: 1n, reason: 0});
      if (await membership.status() !== 'revoked') throw new Error('Actual signed revocation did not apply');
      if (await restored.sign(new Uint8Array(16)).then(() => true, () => false)) throw new Error('Revoked signer still usable');
      if (await restoreModule.loadLocalPersona({wasm, store, expectedGroup: invitation.group}).then(() => true, () => false)) throw new Error('Revoked identity restored');
    } finally { membership.close(); }
  }, revoke);

  await setup(); await confirm();
  await pages[0].evaluate(() => enrollment.sendClaim()); await sendBundle();
  await pages[0].evaluate(() => { raceInstall = true; });
  assert.equal(await pages[0].evaluate(() => enrollment.installLocal().then(() => true, () => false)), false);
  await failedInstall();
  assert.equal(await pages[0].evaluate(async () => (await store.read('candidate-persona', 'active')).value.winner), 'competing-fixture');

  // Existing group evidence, including revocations, cannot be overwritten by
  // another enrollment even when the candidate claim is locally OPEN.
  await setup(); await confirm();
  await pages[0].evaluate(() => enrollment.sendClaim()); await sendBundle();
  await pages[0].evaluate(async () => {
    const key = Array.from(invitation.group, b => b.toString(16).padStart(2, '0')).join('');
    await store.compareAndSwap('membership', key, 0, {fixture: 'existing-evidence', revocations: ['retain-marker']});
  });
  assert.equal(await pages[0].evaluate(() => enrollment.installLocal().then(() => true, () => false)), false);
  await failedInstall();
  assert.deepEqual(await pages[0].evaluate(async () => {
    const key = Array.from(invitation.group, b => b.toString(16).padStart(2, '0')).join('');
    return {claim: (await store.read('candidate-persona', 'active')).value.claim,
      membership: (await store.read('membership', key)).value};
  }), {claim: 'open', membership: {fixture: 'existing-evidence', revocations: ['retain-marker']}});

  await setup(); await confirm();
  await pages[0].evaluate(() => enrollment.sendClaim()); await sendBundle();
  assert.equal(await pages[0].evaluate(async () => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { const request = original.apply(this, args); setupAbort.abort(); return request; };
    try { return await enrollment.installLocal().then(() => true, () => false); }
    finally { IDBObjectStore.prototype.put = original; }
  }), false);
  await failedInstall();
  assert.equal(await pages[0].evaluate(async () => (await store.read('candidate-persona', 'active')).value.claim), 'open');
  assert.equal(await pages[0].evaluate(async () => {
    const key = Array.from(invitation.group, b => b.toString(16).padStart(2, '0')).join('');
    return await store.read('membership', key);
  }), null);

  await setup(); await confirm();
  await pages[0].evaluate(() => enrollment.sendClaim());
  const lateMember = await sendBundle();
  const lateReceipt = await pages[0].evaluate(async () => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args) {
      const tx = original.apply(this, args);
      if (args[1] === 'readwrite') tx.addEventListener('complete', () => setupAbort.abort(), {once: true});
      return tx;
    };
    try { return await enrollment.installLocal(); }
    finally { IDBDatabase.prototype.transaction = original; }
  });
  assert.equal(lateReceipt.status, 'installed-local'); assert.equal(lateReceipt.peerAcknowledged, false);
  assert.equal(await storedSignerMatches(lateMember), true);
  assert.equal(await pages[0].evaluate(() => enrollment.invitationState()), 'consumed');
  await pages[1].waitForFunction(() => enrollment.state() === 'closed');
  await setup(); await confirm();
  await pages[0].evaluate(() => enrollment.sendClaim()); await sendBundle();
  await pages[0].evaluate(() => enrollment.installLocal());
  const acknowledgments = await Promise.all([
    pages[0].evaluate(() => enrollment.acknowledgeInstallation()),
    pages[1].evaluate(() => payloads.acknowledgeInstalled()),
  ]);
  assert.equal(acknowledgments[0].peerAcknowledged, true);
  assert.equal(acknowledgments[1].status, 'acknowledgment-sent');
  assert.equal(await pages[1].evaluate(() => enrollment.invitationState()), 'consumed');
  assert.equal(await pages[0].evaluate(async () => (await restoreModule.loadLocalPersona({wasm, store, expectedGroup: invitation.group})).peerAcknowledged), true);
  // A new document shares only origin storage, not the enrollment JS objects.
  const reopened = await contexts[0].newPage();
  await reopened.route('**/*', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({status: 200, contentType: sources.has(path)
      ? path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' : 'text/html',
      body: sources.get(path) || '<!doctype html><title>Restored enrollment</title>'});
  });
  await reopened.goto(pages[0].url());
  const restoreInputs = await pages[0].evaluate(() => ({group: [...invitation.group], database: 'install-fixture-' + invitation.code[0]}));
  assert.equal(await reopened.evaluate(async ({group, database}) => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./storage.mjs')).openBrowserStorage(database);
    try {
      const identity = await (await import('./local-persona.mjs')).loadLocalPersona({wasm, store, expectedGroup: new Uint8Array(group)});
      return identity.status === 'installed-local' && identity.peerAcknowledged === true;
    } finally { store.close(); }
  }, restoreInputs), true);
  await reopened.close();
  await pages[0].evaluate(() => enrollment.dispose());
  await pages[1].waitForFunction(() => enrollment.state() === 'closed');
  assert.equal(await pages[0].evaluate(() => enrollment.invitationState()), 'consumed');
  // A replaced view cannot start a connection after its asynchronous read returns.
  await pages[0].evaluate(async () => {
    const originalPeer = window.RTCPeerConnection;
    let connections = 0;
    window.RTCPeerConnection = class extends originalPeer { constructor(...args) { super(...args); connections++; } };
    try {
      const cancelled = new AbortController(); cancelled.abort();
      const options = {wasm, store, expectedGroup: invitation.group, peer: invitation.issuer, role: 'offer'};
      if (await personaSession.openLocalPersonaSession({...options, signal: cancelled.signal}).then(() => true, () => false)) throw new Error('Pre-cancelled reconnect accepted');
      const pending = new AbortController(); let release, entered;
      const waiting = new Promise(resolve => { entered = resolve; }); let first = true;
      const delayedStore = {...store, read: async (...args) => {
        const value = await store.read(...args);
        if (first) { first = false; entered(); await new Promise(resolve => { release = resolve; }); }
        return value;
      }};
      const opening = personaSession.openLocalPersonaSession({...options, store: delayedStore, signal: pending.signal}).then(() => true, () => false);
      await waiting; pending.abort(); release();
      if (await opening || connections !== 0) throw new Error('Cancelled setup opened a connection');
      const after = new AbortController();
      const opened = await personaSession.openLocalPersonaSession({...options, signal: after.signal});
      after.abort();
      if (opened.state() !== 'closed') throw new Error('Screen disposal did not close reconnect');
    } finally { window.RTCPeerConnection = originalPeer; }
  });
  // Reconnect after enrollment closes, using the actual installed candidate key.
  const candidateSubject = await pages[0].evaluate(async () => {
    const record = (await store.read('candidate-persona', 'active')).value.record;
    window.reconnected = await personaSession.openLocalPersonaSession({wasm, store,
      expectedGroup: invitation.group, peer: invitation.issuer, role: 'offer'});
    return [...record.subject];
  });
  await pages[1].evaluate(async candidateSubject => {
    // Explicit fixture provisioner membership, not a production bootstrap flow.
    window.provisionerMembership = await membershipModule.establishMembership(store, wasm,
      {group, subject: issuer, current: 7n, depth: 0n, certificate: issuerCertificate});
    const publicId = Array.from(issuer, b => b.toString(16).padStart(2, '0')).join('');
    window.reconnected = peerSessionModule.createPeerSession({wasm, role: 'answer', group, epoch: 7n,
      local: issuer, peer: new Uint8Array(candidateSubject), certificate: issuerCertificate,
      identity: {publicId, sign: async message => new Uint8Array(await crypto.subtle.sign('Ed25519', issuerKey.privateKey, message))},
      membership: provisionerMembership});
  }, candidateSubject);
  const reconnectOffer = await pages[0].evaluate(() => reconnected.offer());
  const reconnectAnswer = await pages[1].evaluate(offer => reconnected.accept(offer), reconnectOffer);
  await pages[0].evaluate(answer => reconnected.accept(answer), reconnectAnswer);
  await Promise.all(pages.map(page => page.evaluate(() => reconnected.authenticated())));
  assert.deepEqual(await Promise.all(pages.map(page => page.evaluate(() => reconnected.state()))), ['authenticated', 'authenticated']);
  const reconnectRevocation = await pages[1].evaluate(async member => {
    const subject = new Uint8Array(member);
    return [...new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey,
      wasm.tg_revocation_signing_bytes(subject, 7n, 1n, 0)))];
  }, candidateSubject);
  await pages[0].evaluate(async ({subject, signature}) => {
    const membership = membershipModule.openMembership(store, wasm, invitation.group, new Uint8Array(subject));
    try { await membership.applyRevocation({subject: new Uint8Array(subject), signature: new Uint8Array(signature), epoch: 7n, sequence: 1n, reason: 0}); }
    finally { membership.close(); }
  }, {subject: candidateSubject, signature: reconnectRevocation});
  await Promise.all(pages.map(page => page.waitForFunction(() => reconnected.state() === 'closed')));
  assert.equal(await pages[0].evaluate(() => personaSession.openLocalPersonaSession({wasm, store,
    expectedGroup: invitation.group, peer: invitation.issuer, role: 'offer'}).then(() => true, () => false)), false);
  await pages[1].evaluate(() => provisionerMembership.close());

  await setup(); await confirm();
  await pages[0].evaluate(() => enrollment.sendClaim()); await sendBundle();
  await pages[0].evaluate(() => enrollment.installLocal());
  const mismatch = await Promise.all([
    pages[0].evaluate(() => enrollment.acknowledgeInstallation().then(() => true, () => false)),
    pages[1].evaluate(async () => {
      const receipt = await enrollment.installed(); receipt[receipt.length - 1] ^= 1;
      await enrollment.sendAcknowledged(receipt);
    }),
  ]);
  assert.equal(mismatch[0], false);
  assert.equal(await pages[0].evaluate(async () => (await store.read('candidate-persona', 'active')).value.peerAcknowledged), false);
  assert.equal(await pages[0].evaluate(() => enrollment.invitationState()), 'consumed');
  for (const failingSide of [1, 0]) {
    await setup(); await confirm();
    await pages[0].evaluate(() => enrollment.sendClaim()); await sendBundle();
    await pages[0].evaluate(() => enrollment.installLocal());
    await pages[failingSide].evaluate(() => {
      window.originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args) {
        const request = originalPut.apply(this, args); this.transaction.abort(); return request;
      };
    });
    let outcomes;
    try {
      outcomes = await Promise.all([
        pages[0].evaluate(() => enrollment.acknowledgeInstallation().then(() => true, () => false)),
        pages[1].evaluate(() => payloads.acknowledgeInstalled().then(() => true, () => false)),
      ]);
    } finally { await pages[failingSide].evaluate(() => { IDBObjectStore.prototype.put = originalPut; }); }
    assert.equal(outcomes[0], false);
    const saved = await pages[0].evaluate(async () => {
      const value = (await store.read('candidate-persona', 'active')).value;
      return {claim: value.claim, acknowledged: value.peerAcknowledged, invitation: enrollment.invitationState()};
    });
    assert.deepEqual(saved, {claim: 'owner', acknowledged: false, invitation: 'consumed'});
    if (failingSide === 1) {
      assert.equal(outcomes[1], false);
      assert.equal(await pages[1].evaluate(() => sentAcknowledgments), 0);
      assert.equal(await pages[1].evaluate(async () => {
        const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        return await store.read('enrollment-installations', hex(group) + ':' + hex(invitation.code));
      }), null);
    } else {
      assert.equal(await pages[1].evaluate(() => enrollment.invitationState()), 'consumed');
      // Recover in a fresh document with only persisted origin storage. No
      // invitation, private key or enrollment controller crosses from the old page.
      const recoveryInputs = await pages[0].evaluate(async () => {
        const database = 'install-fixture-' + invitation.code[0];
        enrollment.dispose(); store.close();
        return {database, group: [...invitation.group]};
      });
      const recoveryPage = await contexts[0].newPage();
      await recoveryPage.route('**/*', route => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({status: 200, contentType: sources.has(path)
          ? path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' : 'text/html',
          body: sources.get(path) || '<!doctype html><title>Recover connection</title>'});
      });
      await recoveryPage.goto(pages[0].url());
      await recoveryPage.evaluate(async ({database, group}) => {
        window.wasm = await import('./hive_wasm.js'); await wasm.default();
        window.store = await (await import('./storage.mjs')).openBrowserStorage(database);
        window.recoveryModule = await import('./receipt-recovery.mjs');
        // Expected group is caller-established; issuer and receipt must be loaded.
        window.invitation = {group: new Uint8Array(group)};
      }, recoveryInputs);
      for (const variant of ['missing', 'wrong-peer', 'bad-receipt', 'unconsumed', 'wrong-nonce', 'other-certificate', 'record-changed', 'cancel-during', 'normal', 'cancel-after']) {
        if (variant === 'cancel-after') await recoveryPage.evaluate(async () => {
          // Fixture replays an unrecorded acknowledgment without re-enrollment.
          const saved = await store.read('candidate-persona', 'active');
          await store.compareAndSwap('candidate-persona', 'active', saved.revision, {...saved.value, peerAcknowledged: false});
        });
        const before = await recoveryPage.evaluate(async () => (await store.read('candidate-persona', 'active')).revision);
        const subject = await recoveryPage.evaluate(async variant => {
          window.recoveryAbort = new AbortController();
          window.recovery = await recoveryModule.openReceiptRecovery({wasm, store, expectedGroup: invitation.group, signal: recoveryAbort.signal});
          window.recoveryOriginalPut = IDBObjectStore.prototype.put;
          window.recoveryOriginalTransaction = IDBDatabase.prototype.transaction;
          if (variant === 'cancel-during') IDBObjectStore.prototype.put = function(...args) {
            const request = recoveryOriginalPut.apply(this, args); recoveryAbort.abort(); return request;
          };
          if (variant === 'cancel-after') IDBDatabase.prototype.transaction = function(...args) {
            const tx = recoveryOriginalTransaction.apply(this, args);
            if (args[1] === 'readwrite') tx.addEventListener('complete', () => recoveryAbort.abort(), {once: true});
            return tx;
          };
          return [...(await store.read('candidate-persona', 'active')).value.record.subject];
        }, variant);
        if (variant === 'record-changed') await recoveryPage.evaluate(async () => {
          const saved = await store.read('candidate-persona', 'active');
          await store.compareAndSwap('candidate-persona', 'active', saved.revision,
            {...saved.value, concurrentMarker: 'retained'});
        });
        await pages[1].evaluate(async ({subject, variant}) => {
          const peer = new Uint8Array(subject), checkedPeer = peer.slice();
          if (variant === 'wrong-peer') checkedPeer[0] ^= 1;
          let alternate;
          if (variant === 'other-certificate') {
            const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', authority.privateKey, codec.signingBytes(peer, group, 8n)));
            alternate = codec.encode(peer, group, 8n, signature);
          }
          const checkedStore = {...store, read: async (scope, key) => {
            const saved = await store.read(scope, key);
            if (scope === 'enrollment-installations') {
              if (variant === 'missing') return null;
              if (variant === 'bad-receipt') saved.value.receipt[10] ^= 1;
              if (variant === 'other-certificate') saved.value.certificate = alternate;
            }
            if (scope === 'enrollment-invitations' && variant === 'unconsumed') saved.value.state = 'reserved';
            return saved;
          }};
          window.recoveryMembership = membershipModule.openMembership(store, wasm, group, issuer);
          const publicId = Array.from(issuer, b => b.toString(16).padStart(2, '0')).join('');
          window.recoveryPeer = peerSessionModule.createPeerSession({wasm, role: 'answer', group, epoch: 7n,
            local: issuer, peer, certificate: issuerCertificate, membership: recoveryMembership,
            identity: {publicId, sign: async message => new Uint8Array(await crypto.subtle.sign('Ed25519', issuerKey.privateKey, message))},
            onMessage: message => recoveryModule.answerReceiptRecovery({wasm, store: checkedStore, group, local: issuer, peer: checkedPeer,
              connection: {...recoveryPeer, send: bytes => {
                if (variant === 'wrong-nonce') bytes[new TextEncoder().encode('along/receipt-recovery/v1\0').length + 1] ^= 1;
                return recoveryPeer.send(bytes);
              }}}, message)});
        }, {subject, variant});
        const offer = await recoveryPage.evaluate(() => recovery.offer());
        const answer = await pages[1].evaluate(offer => recoveryPeer.accept(offer), offer);
        await recoveryPage.evaluate(answer => recovery.accept(answer), answer);
        const recovered = await recoveryPage.evaluate(() => recovery.completed.then(value => value.peerAcknowledged, () => false));
        await recoveryPage.evaluate(() => {
          IDBObjectStore.prototype.put = recoveryOriginalPut;
          IDBDatabase.prototype.transaction = recoveryOriginalTransaction;
        });
        const succeeds = variant === 'normal' || variant === 'cancel-after';
        assert.equal(recovered, succeeds, variant);
        const after = await recoveryPage.evaluate(async () => {
          const saved = await store.read('candidate-persona', 'active');
          return {revision: saved.revision, claim: saved.value.claim, acknowledged: saved.value.peerAcknowledged, marker: saved.value.concurrentMarker};
        });
        assert.equal(after.claim, 'owner'); assert.equal(after.acknowledged, succeeds);
        assert.equal(after.revision, before + (succeeds || variant === 'record-changed' ? 1 : 0));
        if (variant === 'record-changed') assert.equal(after.marker, 'retained');
        await pages[1].waitForFunction(() => recoveryPeer.state() === 'closed');
        await pages[1].evaluate(() => recoveryMembership.close());
      }
      await recoveryPage.evaluate(() => store.close());
      await recoveryPage.close();
      await pages[0].evaluate(async database => {
        window.store = await storageModule.openBrowserStorage(database);
      }, recoveryInputs.database);
    }
  }

  await setup(); await confirm();
  await pages[0].evaluate(() => enrollment.sendClaim()); await sendBundle();
  await pages[0].evaluate(() => enrollment.installLocal());
  const lateAcknowledgment = await Promise.all([
    pages[0].evaluate(async () => {
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(...args) {
        const tx = original.apply(this, args);
        if (args[1] === 'readwrite') tx.addEventListener('complete', () => setupAbort.abort(), {once: true});
        return tx;
      };
      try { return await enrollment.acknowledgeInstallation(); }
      finally { IDBDatabase.prototype.transaction = original; }
    }),
    pages[1].evaluate(() => payloads.acknowledgeInstalled().then(() => true, () => false)),
  ]);
  assert.equal(lateAcknowledgment[0].peerAcknowledged, true);
  assert.equal(await pages[0].evaluate(async () => (await store.read('candidate-persona', 'active')).value.peerAcknowledged), true);
  console.log('PASS: actual peer bundle installs requested candidate custody with claim and invitation consumption; restoration rejects corrupted evidence, mismatched keys and replacement before/during signing; existing group evidence survives refusal; signed revocation blocks restored signing; a competing revision wins without overwrite; pending cancellation rolls back; cancellation after commit still returns the durable local receipt. Real initial local persona; synthetic target-group trust, platform facts and consent; matching acknowledgment persists on both devices; aborted receipt writes cannot fabricate success and cancellation after completed acknowledgment preserves it; mismatched acknowledgment preserves local installation without claiming peer agreement; installed custody reconnects through mutual membership authentication and signed local revocation closes it; fresh-document receipt recovery uses persisted custody and rejects mismatched evidence; recovery cancellation respects the commit boundary; no hardware seal or AT credential authority.');
} finally { await browser?.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
