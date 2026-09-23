// Protected enrollment carriage over actual channels; all payloads synthetic.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
if (!process.env.R2_BROWSER_DIR) throw new Error('Set R2_BROWSER_DIR to the experimental Reality2 browser module directory');
if (!process.env.R2_WASM_DIR) throw new Error('Set R2_WASM_DIR');
const sources = new Map(await Promise.all(['certificate', 'enrollment-session', 'storage', 'invitation-journal', 'enrollment-link', 'enrollment-exchange', 'enrollment-protection', 'peer-link', 'invitation'].map(async name => ['/' + name + '.mjs', await readFile(join(process.env.R2_BROWSER_DIR, name + '.mjs'))])));
for (const name of ['enrollment-profile.mjs', 'enrollment-payloads.mjs', 'core-candidate-session.mjs', 'stored-claim.mjs', 'installation-receipt.mjs']) sources.set('/' + name, await readFile(new URL('./' + name, import.meta.url)));
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
      window.controller = await import('./enrollment-payloads.mjs');
      window.codec = (await import('./certificate.mjs')).certificateCodec(wasm);
      window.store = await (await import('./storage.mjs')).openBrowserStorage('core-session-test');
      window.coreConfirms = 0; window.sentClaims = 0; window.claimState = 'open'; window.stateReads = 0;
      const originalConfirm = wasm.BrowserCandidateCeremony.prototype.confirm;
      wasm.BrowserCandidateCeremony.prototype.confirm = function(value) { coreConfirms++; return originalConfirm.call(this, value); };
      const originalSend = RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send = function(text) { if (JSON.parse(text).type === 'claim') sentClaims++; return originalSend.call(this, text); };
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
      window.reservationWaiting = false;
      const candidateStore = delayReservation ? {...store, compareAndSwap: async (...args) => {
        const result = await store.compareAndSwap(...args); reservationWaiting = true;
        await new Promise(resolve => { window.releaseReservation = resolve; }); return result;
      }} : store;
      window.creation = coreModule.createCoreCandidateSession({wasm, invitation, authorized, store: candidateStore, signal: setupAbort.signal,
        platform: {candidateDevelopment: false, provisionerDevelopment: false, provisionerHoldsCustody: true, epoch: 7n},
        readClaimState: async () => { stateReads++; if (window.delayStateRead) { window.readWaiting = true; await new Promise(resolve => { window.releaseStateRead = resolve; }); } return claimState; }}).then(value => { window.enrollment = value; return true; }, () => false);
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
  await setup(); await confirm();
  await pages[0].evaluate(() => enrollment.sendClaim());
  const requested = await sendBundle();
  assert.deepEqual(await pages[0].evaluate(async () => [...(await enrollment.prepare()).member]), requested);
  assert.equal(await pages[0].evaluate(() => stateReads), 3);
  await pages[0].evaluate(() => enrollment.dispose()); await closed();
  await pages[0].evaluate(() => enrollment.dispose());

  await setup();
  await pages[0].evaluate(() => { window.decision = enrollment.decide(true).then(() => true, () => false); });
  assert.equal(await pages[0].evaluate(() => coreConfirms), 0);
  assert.equal(await pages[0].evaluate(() => enrollment.sendClaim().then(() => true, () => false)), false);
  await closed();
  assert.equal(await pages[0].evaluate(() => sentClaims), 0);

  await setup(); await confirm();
  await pages[0].evaluate(() => { claimState = 'owner'; });
  assert.equal(await pages[0].evaluate(() => enrollment.sendClaim().then(() => true, () => false)), false);
  await closed(); assert.equal(await pages[0].evaluate(() => sentClaims), 0);

  await setup(); await confirm();
  await pages[0].evaluate(() => enrollment.sendClaim()); await sendBundle();
  await pages[0].evaluate(() => { claimState = 'owner'; });
  assert.equal(await pages[0].evaluate(() => enrollment.prepare().then(() => true, () => false)), false);
  await closed();
  await setup(); await confirm();
  await pages[0].evaluate(() => { claimState = undefined; });
  assert.equal(await pages[0].evaluate(() => enrollment.sendClaim().then(() => true, () => false)), false);
  await closed(); assert.equal(await pages[0].evaluate(() => sentClaims), 0);

  // Both UI decisions are insufficient if the core refuses its transition.
  await setup();
  await pages[0].evaluate(() => {
    window.restoreConfirm = wasm.BrowserCandidateCeremony.prototype.confirm;
    wasm.BrowserCandidateCeremony.prototype.confirm = function() { window.stateDuringCore = enrollment.state(); throw new Error('controlled core refusal'); };
  });
  await Promise.all(pages.map(page => page.evaluate(() => enrollment.decide(true).then(() => true, () => false))));
  await closed();
  assert.equal(await pages[0].evaluate(() => sentClaims), 0);
  assert.equal(await pages[0].evaluate(() => enrollment.sendClaim().then(() => true, () => false)), false);
  assert.notEqual(await pages[0].evaluate(() => stateDuringCore), 'comparison-confirmed');
  await pages[0].evaluate(() => { wasm.BrowserCandidateCeremony.prototype.confirm = restoreConfirm; });

  // Cancel while the second claim-state read is pending. It must never produce
  // prepared metadata after session invalidation, even when the read completes.
  await setup(); await confirm();
  await pages[0].evaluate(() => enrollment.sendClaim()); await sendBundle();
  await pages[0].evaluate(() => {
    window.delayStateRead = true; window.readWaiting = false;
    window.preparing = enrollment.prepare().then(() => true, () => false);
  });
  await pages[0].waitForFunction(() => readWaiting);
  await pages[1].evaluate(() => enrollment.cancel()); await closed();
  await pages[0].evaluate(() => { delayStateRead = false; releaseStateRead(); });
  assert.equal(await pages[0].evaluate(() => preparing), false);

  // Cancel during actual candidate key generation and release it afterwards.
  await setup(); await confirm();
  await pages[0].evaluate(() => {
    const original = wasm.BrowserCandidateKey.generate;
    const originalClose = wasm.BrowserCandidateKey.prototype.close;
    window.lateKeyClosed = 0; window.generationReady = false;
    wasm.BrowserCandidateKey.prototype.close = function() { lateKeyClosed++; return originalClose.call(this); };
    wasm.BrowserCandidateKey.generate = async () => {
      const generated = await original(); generationReady = true;
      await new Promise(resolve => { window.releaseGeneration = resolve; }); return generated;
    };
    window.claiming = enrollment.sendClaim().then(() => true, () => false).finally(() => {
      wasm.BrowserCandidateKey.generate = original; wasm.BrowserCandidateKey.prototype.close = originalClose;
    });
  });
  await pages[0].waitForFunction(() => generationReady);
  await pages[1].evaluate(() => enrollment.cancel()); await closed();
  await pages[0].evaluate(() => releaseGeneration());
  assert.equal(await pages[0].evaluate(() => claiming), false);
  assert.equal(await pages[0].evaluate(() => lateKeyClosed), 1);
  assert.equal(await pages[0].evaluate(() => sentClaims), 0);
  await setup(true);
  await pages[0].waitForFunction(() => readWaiting);
  await pages[0].evaluate(() => { setupAbort.abort(); delayStateRead = false; releaseStateRead(); });
  assert.equal(await pages[0].evaluate(() => creation), false);
  assert.equal(await pages[0].evaluate(() => sentClaims), 0);
  assert.equal(await pages[0].evaluate(async () => {
    const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
    return await store.read('enrollment-invitations', hex(invitation.group) + ':' + hex(invitation.code));
  }), null);
  await pages[1].evaluate(() => enrollment.cancel());
  // The reservation has committed but setup has not returned. Cancellation
  // must finish by voiding it; it must not leave a reusable code or live link.
  await setup(false, true);
  await pages[0].waitForFunction(() => reservationWaiting);
  await pages[0].evaluate(() => { setupAbort.abort(); releaseReservation(); });
  assert.equal(await pages[0].evaluate(() => creation), false);
  assert.equal(await pages[0].evaluate(() => sentClaims), 0);
  assert.equal(await pages[0].evaluate(async () => {
    const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
    return (await store.read('enrollment-invitations', hex(invitation.group) + ':' + hex(invitation.code))).value.state;
  }), 'void');
  await pages[1].evaluate(() => enrollment.cancel());
  console.log('PASS: live peer commitment/exchange and both confirmations drive actual core ordering; generated key request and protected bundle reach a prepared persona; first and second claim-state changes refuse; early claim and repeated disposal close safely. Initial trust/platform facts are synthetic; no atomic installation or credential authority.');
} finally { await browser?.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
