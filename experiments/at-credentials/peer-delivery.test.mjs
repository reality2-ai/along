import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map();
for (const name of ['state.mjs', 'store.mjs', 'permission.mjs', 'permission-view.mjs', 'connection-view.mjs', 'exchange.mjs', 'journey-session.mjs', 'permission-check.test.mjs', 'session-check.test.mjs']) sources.set('/' + name, await readFile(new URL('../journey-sync/' + name, import.meta.url)));
for (const name of ['app-preferences.mjs','preference-envelope.mjs','isolated-preferences.mjs','generation-state.mjs','generation-migration.mjs','generation-checkpoint.mjs','checkpoint-preparation.mjs','checkpoint-installation.mjs','checkpoint-review.mjs','checkpoint-choice-commit.mjs','startup-state.mjs','migration-setup.mjs','checkpoint-permission.mjs','checkpoint-inbox.mjs','enrolled-checkpoint.test.mjs']) sources.set('/'+name,await readFile(new URL('../journey-sync/'+name,import.meta.url)));
sources.set('/preferences.js',await readFile(new URL('../../public/preferences.js',import.meta.url)));
for (const name of ['storage.mjs', 'membership.mjs', 'certificate.mjs', 'peer-session.mjs', 'peer-link.mjs', 'challenge.mjs', 'session-statement.mjs', 'enrollment-session.mjs', 'invitation-journal.mjs', 'enrollment-link.mjs', 'enrollment-exchange.mjs', 'enrollment-protection.mjs', 'invitation.mjs']) sources.set('/' + name, await readFile(join(process.env.R2_BROWSER_DIR, name)));
for (const name of ['../tg-pairing/removal-set.mjs', '../tg-pairing/initial-persona.mjs', '../tg-pairing/software-persona.mjs', '../tg-pairing/core-candidate-session.mjs', '../tg-pairing/software-traffic.mjs', '../tg-pairing/enrollment-payloads.mjs', '../tg-pairing/enrollment-profile.mjs', '../tg-pairing/installation-receipt.mjs', '../tg-pairing/stored-claim.mjs', '../tg-pairing/local-persona.mjs', 'local-owner.mjs', 'owner-certificate.mjs', 'owner-policy.mjs', 'owner-access-view.mjs', 'owner-policy-send.mjs', 'policy-sync.mjs', 'owner-delivery.mjs', 'delivery-history.mjs', 'delivery-recovery.mjs', 'remote-owner.mjs', 'policy-update.mjs', 'policy-update-message.mjs', 'remote-owner-view.mjs', 'settings-view.mjs', 'key-replacement-view.mjs', 'credential-view.mjs', '../tg-pairing/comparison.css', '../tg-pairing/local-persona-session.mjs', '../tg-pairing/epoch-watch.mjs', 'policy.mjs', 'policy-store.mjs', 'local-vault.mjs', 'delivery-ack.mjs', 'delivery-message.mjs']) sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
for (const name of ['hive_wasm.js', 'hive_wasm_bg.wasm']) sources.set('/' + name, await readFile(join(process.env.R2_WASM_DIR, name)));
for (const name of ['scoped-session-client.mjs', 'policy-connection-view.mjs', '../tg-pairing/transfer-view.mjs', 'vehicle-live-view.mjs', '../../public/live-vehicles.js', '../../public/vendor/leaflet/leaflet.js', '../../public/vendor/leaflet/leaflet.css', 'journey-live-view.mjs', 'stop-live-view.mjs', '../../public/live-predictions.js', '../../public/live-context.js', '../../public/live-time.js', 'policy-session.mjs', 'saved-client.mjs', 'live-client.mjs', '../../public/at-client.js', '../../public/live-client.js']) sources.set('/' + name.split('/').pop(), await readFile(new URL(name, import.meta.url)));
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
  await context.addInitScript(enabled=>{globalThis.checkEnrolledJourneyCheckpoint=enabled;},process.env.ENROLLED_CHECKPOINT==='1');
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.exposeFunction('exerciseJourneyConnectionRejected', async (message, cancel) => {
    const panel = page.locator('#journey-negative');
    await panel.getByLabel('Journey device message', {exact: true}).fill(message);
    await panel.getByRole('button', {name: 'Review journey device', exact: true}).click();
    if (cancel) {
      await panel.getByRole('button', {name: 'Allow journey sharing', exact: true}).waitFor();
      await panel.getByRole('button', {name: 'Back', exact: true}).click();
    } else await panel.getByRole('heading', {name: 'Journey connection unavailable', exact: true}).waitFor();
  });
  await page.exposeFunction('exerciseJourneyConnection', async () => {
    const start = page.locator('#journey-start'), join = page.locator('#journey-join');
    const move = async (from, to, label, action) => {
      const text = await from.getByLabel('Device message to copy').inputValue();
      assert.equal(text.includes('Saved destination'), false);
      await to.getByLabel(label, {exact: true}).fill(text); await to.getByRole('button', {name: action, exact: true}).click();
    };
    const consent = async panel => {
      const button = panel.getByRole('button', {name: /^(Allow journey sharing|Connect this device)$/});
      await button.focus(); await page.keyboard.press('Enter');
    };
    await move(start, join, 'Journey device message', 'Review journey device');
    await consent(join);
    await join.getByRole('heading', {name: 'Send the journey connection request', exact: true}).waitFor();
    await move(join, start, 'Journey connection request', 'Review journey device');
    await consent(start);
    await start.getByRole('heading', {name: 'Send the journey connection reply', exact: true}).waitFor();
    await move(start, join, 'Journey connection reply', 'Connect journey devices');
    for (const panel of [start, join]) {
      await panel.getByRole('heading', {name: 'Journey devices connected', exact: true}).waitFor();
      assert.deepEqual((await new AxeBuilder({page}).include('#' + await panel.getAttribute('id')).analyze()).violations.map(v => v.id), []);
      await panel.getByRole('button', {name: 'Use journey connection', exact: true}).evaluate(button => button.click());
      await panel.getByRole('button', {name: 'Use journey connection', exact: true}).click();
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
  await page.exposeFunction('exerciseJourneyPermission', async action => {
    if (action === 'cancel') { await page.keyboard.press('Escape'); return; }
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
    const name = action === 'remove' ? 'Stop journey sharing' : 'Allow journey sharing';
    await page.evaluate(() => document.querySelector('.pairing-primary').click());
    await page.getByRole('button', {name, exact: true}).waitFor();
    await page.getByRole('button', {name, exact: true}).focus(); await page.keyboard.press('Enter');
  });
  await page.exposeFunction('exerciseConsent', async action => {
    if (action === 'cancel') { await page.keyboard.press('Escape'); return; }
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
    await page.evaluate(() => document.querySelector('.pairing-primary').click());
    await page.getByRole('heading', {name: 'Use your connected device’s AT key?'}).waitFor();
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  });
  await page.exposeFunction('exerciseOwnerAccess', async action => {
    if (action === 'cancel') { await page.keyboard.press('Escape'); return; }
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
    await page.evaluate(() => document.querySelector('.pairing-primary').click());
    await page.getByRole('button', {name: action === 'remove' ? 'Remove AT access' : 'Allow AT access', exact: true}).waitFor();
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  });
  await page.exposeFunction('exerciseLiveCheck', async () => {
    await page.getByRole('button', {name: 'Check live times and alerts', exact: true}).click();
    await page.getByRole('status').filter({hasText: '1 matching departure update and 0 service updates'}).waitFor();
    assert.match(await page.locator('#consent').textContent(), /Expected/);
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
  });
  await page.exposeFunction('exerciseReconnect', async () => {
    const recipient = page.locator('#recipient-connect'), owner = page.locator('#owner-connect');
    await recipient.getByLabel('AT-key device message', {exact: true}).fill(await owner.locator('textarea[readonly]').inputValue());
    await recipient.getByRole('button', {name: 'Review AT-key device', exact: true}).click();
    await recipient.getByRole('heading', {name: 'Send your AT connection request', exact: true}).waitFor();
    const request = await recipient.locator('textarea[readonly]').inputValue();
    assert.ok(!request.includes('synthetic-peer-delivery'));
    for (const wrong of [{...JSON.parse(request), profile: 'along-at-reconnect-v1'}, {...JSON.parse(request), owner: '00'.repeat(32)}]) {
      await owner.getByLabel('Connection request', {exact: true}).fill(JSON.stringify(wrong));
      await owner.getByRole('button', {name: 'Prepare connection reply', exact: true}).click();
      await owner.getByRole('heading', {name: 'Connection unavailable', exact: true}).waitFor();
      assert.equal(await page.evaluate(() => Boolean(window.reconnectOwner)), false);
      await page.evaluate(() => window.retryOwnerConnection());
    }
    await owner.getByLabel('Connection request', {exact: true}).fill(request);
    await owner.getByRole('button', {name: 'Prepare connection reply', exact: true}).click();
    await owner.getByRole('heading', {name: 'Reply to your other device', exact: true}).waitFor();
    const reply = await owner.locator('textarea[readonly]').inputValue();
    await recipient.getByLabel('Connection reply', {exact: true}).fill(reply);
    await recipient.getByRole('button', {name: 'Connect devices', exact: true}).click();
    await owner.getByRole('heading', {name: 'Devices connected', exact: true}).waitFor();
    await recipient.getByRole('heading', {name: 'Devices connected', exact: true}).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v => v.id), []);
    // Synthetic activation cannot transfer ownership to the app.
    await page.evaluate(() => document.querySelector('#recipient-connect .pairing-primary').click());
    assert.equal(await page.evaluate(() => Boolean(window.reconnectRecipient)), false);
    await owner.getByRole('button', {name: 'Use this connection', exact: true}).click();
    await recipient.getByRole('button', {name: 'Use this connection', exact: true}).click();
  });
  await page.exposeFunction('exerciseVehicleCheck', async () => {
    await page.getByRole('button', {name: 'Check this service’s current position', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'not an arrival prediction'}).waitFor();
  });
  await page.evaluate(async () => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const {openBrowserStorage} = await import('./storage.mjs');
    const {initializeLocalPersona} = await import('./initial-persona.mjs');
    const {openLocalATVault} = await import('./local-vault.mjs');
    const {openLocalPersonaSession} = await import('./local-persona-session.mjs');
    const {sendOwnerCredential} = await import('./owner-delivery.mjs');
    const {verifyDeliveryAck} = await import('./delivery-ack.mjs');
    const {openDeliveryHistory} = await import('./delivery-history.mjs');
    const {requestDeliveryRecovery, answerDeliveryRecovery, encodeRecoveryRequest, decodeRecoveryRequest} = await import('./delivery-recovery.mjs');
    const {applyRemoteATPolicy, encodePolicyUpdate, decodePolicyUpdate} = await import('./policy-update.mjs');
    const {updateLocalATPolicy} = await import('./owner-policy.mjs');
    const {sendOwnerPolicy} = await import('./owner-policy-send.mjs');
    const {createPolicySync, answerPolicyCheck, isPolicyCheckRequest, isPolicyCheckResponse} = await import('./policy-sync.mjs');
    const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    const check = (v, message) => { if (!v) throw new Error(message); };
    // Actual software issuer and recipient ceremony. The harness still supplies
    // the initial trust/comparison decisions and connection descriptions.
    const software = await import('./software-persona.mjs');
    let ownerStore = await openBrowserStorage('peer-key-owner');
    const createdOwner = await software.initializeSoftwarePersona({wasm, store: ownerStore});
    ownerStore.close(); ownerStore = await openBrowserStorage('peer-key-owner');
    const group = Uint8Array.from(createdOwner.group.match(/../g), b => parseInt(b, 16));
    const issuer = await software.loadSoftwareIssuer({wasm, store: ownerStore, expectedGroup: group});
    const ownerRecord = (await ownerStore.read('candidate-persona', 'active')).value.record;
    async function device(name) {
      let store = await openBrowserStorage(name);
      const initial = await initializeLocalPersona({wasm, store}); initial.close();
      const priorMember = (await store.read('candidate-persona', 'active')).value.record.subject;
      const invitation = {group, issuer: ownerRecord.subject, code: crypto.getRandomValues(new Uint8Array(16)), validity: 8n, role: 'member'};
      const nonce = crypto.getRandomValues(new Uint8Array(16));
      const statement = wasm.tg_invitation_statement(group, ownerRecord.subject, 1, invitation.code, invitation.validity);
      const identity = await (await import('./local-persona.mjs')).loadLocalPersona({wasm, store: ownerStore, expectedGroup: group});
      const proof = await identity.sign(wasm.tg_nonce_signing_bytes(statement, nonce));
      const target = wasm.BrowserMembership.establish(group, 0n, 0n);
      const authorized = target.authorise_invitation(statement, ownerRecord.certificate, nonce, proof);
      target.free(); check(authorized, 'actual provisioner invitation proof accepted');
      let candidate, provisioner;
      try {
        provisioner = await (await import('./enrollment-session.mjs')).createEnrollmentSession({wasm, store: ownerStore, invitation, role: 'provisioner'});
        const payloads = (await import('./enrollment-payloads.mjs')).enrollmentPayloads({wasm, invitation, epoch: 0n, role: 'provisioner', session: provisioner});
        candidate = await (await import('./core-candidate-session.mjs')).createCoreCandidateSession({wasm, store, invitation, authorized,
          softwareCustody: true, platform: {candidateDevelopment: false, provisionerDevelopment: false, provisionerHoldsCustody: true, epoch: 0n}});
        const offer = await candidate.offer(), answer = await provisioner.accept(offer); await candidate.accept(answer);
        const [left, right] = await Promise.all([candidate.comparison(), provisioner.comparison()]);
        check(left.every((v, i) => v === right[i]), 'enrollment comparison agrees');
        await Promise.all([candidate.decide(true), provisioner.decide(true)]);
        await candidate.sendClaim();
        const subject = await payloads.claim(), material = await issuer.enrollmentMaterial(subject);
        try { await payloads.sendBundle(material); } finally { material.destroy(); }
        const installed = await candidate.installLocal(); check(installed.status === 'installed-local', 'actual recipient installation');
        const [acknowledged] = await Promise.all([candidate.acknowledgeInstallation(), payloads.acknowledgeInstalled()]);
        check(acknowledged.peerAcknowledged === true, 'recipient enrollment acknowledged');
      } finally { await candidate?.dispose(); await provisioner?.cancel(); }
      store.close(); store = await openBrowserStorage(name);
      const restored = await (await import('./local-persona.mjs')).loadLocalPersona({wasm, store, expectedGroup: group});
      check(restored.origin === 'enrolled' && restored.peerAcknowledged, 'recipient restores actual consumed enrollment');
      const record = (await store.read('candidate-persona', 'active')).value.record;
      check(hex(record.subject) !== hex(priorMember), 'candidate generated the enrolled member key');
      return {store, subject: record.subject, certificate: record.certificate};
    }
    const owner = {store: ownerStore, subject: ownerRecord.subject, certificate: ownerRecord.certificate};
    const receiver = await device('peer-key-receiver'); issuer.close();
    check(hex(owner.subject) !== hex(receiver.subject), 'distinct identities');
    await (await import('./permission-check.test.mjs')).checkJourneyPermission({wasm, owner, receiver, group});
    await (await import('./session-check.test.mjs')).checkJourneySession({wasm, owner, receiver, group});
    if (globalThis.checkEnrolledJourneyCheckpoint) {
      await (await import('./enrolled-checkpoint.test.mjs')).checkEnrolledCheckpoint({wasm,owner,receiver,group});
      globalThis.enrolledCheckpointPassed=true;
    }
    const {binding} = await (await import('./local-owner.mjs')).establishLocalATOwner({wasm, store: owner.store, expectedGroup: group});
    const {showOwnerDeviceAccess} = await import('./owner-access-view.mjs');
    const ownerViewOptions = {wasm, store: owner.store, expectedGroup: group, peer: receiver.subject,
      certificate: receiver.certificate, deviceName: 'Test phone', focus: true};
    let ownerBacks = 0;
    const cancelledOwnerView = showOwnerDeviceAccess(document.querySelector('#consent'), {...ownerViewOptions, onBack: () => ownerBacks++});
    await cancelledOwnerView.ready; await window.exerciseOwnerAccess('cancel');
    check(ownerBacks === 1, 'owner Back leaves review');
    const ownerAccess = showOwnerDeviceAccess(document.querySelector('#consent'), ownerViewOptions);
    await ownerAccess.ready; await window.exerciseOwnerAccess('allow');
    const grantedReceipt = await ownerAccess.completed;
    check(grantedReceipt.policy.revision === 2n && grantedReceipt.policy.devices.includes(hex(receiver.subject)), 'keyboard consent saves exact owner grant');
    check(document.activeElement.textContent === 'Back' && document.querySelector('[role=status]').textContent.includes('has not been sent'), 'owner grant is not delivery');
    ownerAccess.dispose();
    const ownerVault = openLocalATVault({wasm, store: owner.store, ...binding});
    await ownerVault.saveOwnerKey('synthetic-peer-delivery');
    const policyKey = binding.group + ':' + binding.credential, policyScope = 'along-at-policy:' + binding.owner;
    const signed = await owner.store.read(policyScope, policyKey);
    const history = openDeliveryHistory({store: owner.store, ...binding, recipient: hex(receiver.subject)});
    const receiverVault = openLocalATVault({wasm, store: receiver.store, ...binding});
    let sending, receiving, request, resolve, reject, messages = 0, policyReply, policyError;
    const installed = new Promise((yes, no) => { resolve = yes; reject = no; });
    let timeout, acknowledgmentContext, confirm, rejectConfirmation, dropAcknowledgment = true;
    const confirmed = new Promise((yes, no) => { confirm = yes; rejectConfirmation = no; });
    void confirmed.catch(() => {});
    let recovering = false, policySync, lastPolicyResponse, policyCheckError, holdPolicyChecks = false;
    try {
      const receiverHandler = async packet => {
          if (isPolicyCheckResponse(packet)) {
            lastPolicyResponse = packet.slice();
            try { await policySync.receive(packet); } catch (error) { policyCheckError = error; }
            return;
          }
          if (recovering) {
            try { await answerDeliveryRecovery({wasm, store: receiver.store, expectedGroup: group, peer: owner.subject, connection: receiving, packet}); }
            catch (error) { rejectConfirmation(error); }
            return;
          }
          if (policyReply) {
            try { policyReply(await applyRemoteATPolicy({wasm, store: receiver.store, expectedGroup: group,
              peer: owner.subject, connection: receiving, acceptUnchanged: true, ...decodePolicyUpdate(packet)})); }
            catch (error) { policyError(error); }
            finally { policyReply = undefined; policyError = undefined; }
            return;
          }
          messages++;
          try {
            const receipt = await request.install(packet);
            await receiving.send(await request.acknowledgment({signal: receiving.signal}));
            resolve(receipt);
          } catch (error) { reject(error); }
        };
      receiving = await openLocalPersonaSession({wasm, store: receiver.store, expectedGroup: group, peer: owner.subject, role: 'offer', onMessage: receiverHandler});
      sending = await openLocalPersonaSession({wasm, store: owner.store, expectedGroup: group, peer: receiver.subject,
        role: 'answer', onMessage: async nonce => {
          try {
            if (acknowledgmentContext) {
              if (dropAcknowledgment) { dropAcknowledgment = false; return; }
              const context = acknowledgmentContext; acknowledgmentContext = undefined;
              await verifyDeliveryAck(nonce, context);
              confirm(await history.confirm(nonce, {signal: sending.signal})); return;
            }
            const sent = await sendOwnerCredential({wasm, store: owner.store, expectedGroup: group, peer: receiver.subject,
              peerCertificate: receiver.certificate, nonce, connection: sending});
            check(sent.status === 'sent-unconfirmed', 'send alone remains unconfirmed');
            acknowledgmentContext = sent.acknowledgmentContext;
          } catch (error) { reject(error); rejectConfirmation(error); }
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
      const pendingStatus = await history.read();
      check(pendingStatus.status === 'pending', 'lost acknowledgment leaves owner uncertain');
      request.close(); sending.close(); receiving.close();
      check(await denied(() => requestDeliveryRecovery({wasm, store: owner.store, expectedGroup: group,
        peer: receiver.subject, connection: sending})), 'closed session cannot request recovery');
      recovering = true;
      // Restore both identities into new authenticated sessions. Only the owner
      // reads its pending context; the recipient gets the request over WebRTC.
      receiving = await openLocalPersonaSession({wasm, store: receiver.store, expectedGroup: group,
        peer: owner.subject, role: 'offer', onMessage: receiverHandler});
      sending = await openLocalPersonaSession({wasm, store: owner.store, expectedGroup: group,
        peer: receiver.subject, role: 'answer', onMessage: async packet => {
          if (isPolicyCheckRequest(packet)) {
            if (holdPolicyChecks) return;
            try { await answerPolicyCheck({wasm, store: owner.store, expectedGroup: group, connection: sending, packet}); }
            catch (error) { policyCheckError = error; }
            return;
          }
          try { confirm(await history.confirm(packet, {signal: sending.signal})); }
          catch (error) { rejectConfirmation(error); }
        }});
      const nextOffer = await receiving.offer(), nextAnswer = await sending.accept(nextOffer);
      await receiving.accept(nextAnswer);
      await Promise.all([receiving.authenticated(), sending.authenticated()]);
      const recoveryPacket = encodeRecoveryRequest(pendingStatus.context);
      check(decodeRecoveryRequest(recoveryPacket).nonce === pendingStatus.context.nonce, 'recovery context round trip');
      check(await denied(async () => decodeRecoveryRequest(recoveryPacket.slice(1))), 'malformed request refused');
      const extra = new Uint8Array(recoveryPacket.length + 1); extra.set(recoveryPacket);
      check(await denied(async () => decodeRecoveryRequest(extra)), 'trailing bytes refused');
      const invalidGeneration = recoveryPacket.slice(); invalidGeneration.fill(0, invalidGeneration.length - 8);
      check(await denied(async () => decodeRecoveryRequest(invalidGeneration)), 'invalid generation refused');
      check(await denied(() => answerDeliveryRecovery({wasm, store: receiver.store, expectedGroup: group,
        peer: receiver.subject, connection: receiving, packet: recoveryPacket})), 'unrelated peer cannot request receipt');
      check(await denied(() => answerDeliveryRecovery({wasm, store: receiver.store, expectedGroup: group,
        peer: owner.subject, connection: receiving, packet: encodeRecoveryRequest({...pendingStatus.context, nonce: '00'.repeat(16)})})), 'unmatched request refused');
      await requestDeliveryRecovery({wasm, store: owner.store, expectedGroup: group,
        peer: receiver.subject, connection: sending});
      clearTimeout(timeout);
      const acknowledgment = await Promise.race([confirmed, new Promise((_, no) => {
        timeout = setTimeout(() => no(new Error('Acknowledgment timeout')), 15000);
      })]);
      check(acknowledgment.status === 'recipient-confirmed-saved', 'owner receives recipient acknowledgment on fresh session');
      recovering = false;
      check(await denied(() => requestDeliveryRecovery({wasm, store: owner.store, expectedGroup: group,
        peer: receiver.subject, connection: sending})), 'confirmed record does not request recovery');
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
      window.restoreHistory = {...binding, recipient: hex(receiver.subject)};
      let entered, release, calls = 0;
      const fetching = new Promise(yes => { entered = yes; });
      const delayed = new Promise(yes => { release = yes; });
      const live = (await import('./live-client.mjs')).createVaultATClient({vault: receiverVault, now: () => 1001,
        fetcher: async () => { calls++; entered(); await delayed; return {ok: true, json: async () => ({header: {timestamp: 1000}, entity: []})}; }});
      const pendingLive = live.read('predictions', {requested: true}); await fetching;
      const sendPolicy = async () => {
        const pending = new Promise((yes, no) => { policyReply = yes; policyError = no; });
        const sent = await sendOwnerPolicy({wasm, store: owner.store, expectedGroup: group, connection: sending});
        check(sent.status === 'policy-sent-unconfirmed', 'policy send is not receipt');
        return pending;
      };
      const beforeRefresh = await receiver.store.read(policyScope, policyKey);
      check((await sendPolicy()).status === 'policy-unchanged', 'unchanged policy accepted without new grant');
      check((await receiver.store.read(policyScope, policyKey)).revision === beforeRefresh.revision, 'unchanged policy does not rewrite storage');
      await updateLocalATPolicy({wasm, store: owner.store, expectedGroup: group, expectedRevision: 2n, devices: [hex(owner.subject)]});
      const removal = (await owner.store.read(policyScope, policyKey)).value;
      const applying = changes => applyRemoteATPolicy({wasm, store: receiver.store, expectedGroup: group,
        peer: owner.subject, connection: receiving, policyBytes: removal.bytes, policySignature: removal.signature, ...changes});
      check(await denied(() => applying({peer: receiver.subject})), 'unrelated peer cannot apply owner policy');
      const invalid = removal.signature.slice(); invalid[0] ^= 1;
      check(await denied(() => applying({policySignature: invalid})), 'invalid removal signature refused');
      check(await denied(() => applying({policySignature: invalid, acceptUnchanged: true})), 'catch-up does not accept an invalid signature');
      await sendPolicy();
      check(await denied(() => receiverVault.getKey()), 'received removal stops local key access');
      release(); check(!(await pendingLive).available, 'received removal suppresses pending live result');
      check(!(await live.read('predictions', {requested: true})).available && calls === 1, 'removed device cannot request another feed');
      live.close();
      check(await denied(() => applying({})), 'replayed removal refused');
      check((await applying({acceptUnchanged: true})).status === 'policy-unchanged', 'explicit catch-up accepts identical removal');
      check(await denied(() => receiverVault.getKey()), 'identical removal does not restore access');
      check(await denied(() => applying({acceptUnchanged: true, policyBytes: signed.value.bytes,
        policySignature: signed.value.signature})), 'catch-up refuses an older granting policy');
      check(await sendOwnerCredential({wasm, store: owner.store, expectedGroup: group, peer: receiver.subject,
        peerCertificate: receiver.certificate, nonce: crypto.getRandomValues(new Uint8Array(16)), connection: sending}).then(() => false, () => true), 'removed peer receives no further delivery');
      check(messages === 1, 'no removed-peer message sent');
      await updateLocalATPolicy({wasm, store: owner.store, expectedGroup: group, expectedRevision: 3n,
        devices: [hex(owner.subject), hex(receiver.subject)], certificates: [receiver.certificate]});
      await sendPolicy();
      check(await receiverVault.getKey() === 'synthetic-peer-delivery', 'explicit newer grant restores local use');
      policySync = createPolicySync({wasm, store: receiver.store, expectedGroup: group, peer: owner.subject, connection: receiving});
      let gatedFetches = 0;
      const {createSavedATClient} = await import('./saved-client.mjs');
      let missingSyncFetches = 0;
      const missingSync = createSavedATClient({wasm, store: receiver.store, expectedGroup: group,
        now: () => 1001, fetcher: async () => { missingSyncFetches++; throw new Error('Must not contact provider without owner sync'); }});
      check(!(await missingSync.read('predictions', {requested: true})).available && missingSyncFetches === 0, 'recipient without owner synchronizer refuses provider access');
      missingSync.close();
      let ownerFetches = 0;
      const ownerLive = createSavedATClient({wasm, store: owner.store, expectedGroup: group, now: () => 1001,
        fetcher: async (url, options) => {
          ownerFetches++;
          check(url === 'https://api.at.govt.nz/realtime/legacy/servicealerts', 'saved owner uses direct fixed endpoint');
          check(options.headers['Ocp-Apim-Subscription-Key'] === 'synthetic-peer-delivery', 'saved owner obtains encrypted key');
          return {ok: true, json: async () => ({header: {timestamp: 1000}, entity: []})};
        }});
      check(!(await ownerLive.read('alerts')).available && ownerFetches === 0, 'saved owner adapter waits for explicit request');
      check((await ownerLive.read('alerts', {requested: true})).available && ownerFetches === 1, 'owner adapter restores binding without remote sync');
      ownerLive.close();
      check(!(await ownerLive.read('alerts', {requested: true})).available && ownerFetches === 1, 'closed saved adapter cannot fetch');
      let offlineReads = 0;
      const offlineLive = createSavedATClient({wasm, store: {...owner.store, read: async (...args) => {
        offlineReads++; return owner.store.read(...args);
      }}, expectedGroup: group, online: () => false});
      check((await offlineLive.read('alerts', {requested: true})).reason === 'offline' && offlineReads === 0, 'offline adapter never opens saved credentials');
      offlineLive.close();
      let enteredQueue, releaseQueue, queueCalls = 0, queueFetches = 0;
      const queueEntered = new Promise(resolve => { enteredQueue = resolve; });
      const queueHeld = new Promise(resolve => { releaseQueue = resolve; });
      const queueClient = createSavedATClient({wasm, store: receiver.store, expectedGroup: group,
        synchronizeOwnerPolicy: async () => { queueCalls++; enteredQueue(); await queueHeld; },
        fetcher: async () => { queueFetches++; throw new Error('Cancelled queue must not fetch'); }});
      const firstQueued = queueClient.read('alerts', {requested: true}); await queueEntered;
      const secondQueued = queueClient.read('predictions', {requested: true});
      queueClient.close();
      check((await Promise.all([firstQueued, secondQueued])).every(result => !result.available), 'closing cancels queued reads promptly');
      releaseQueue(); await new Promise(resolve => setTimeout(resolve, 20));
      check(queueCalls === 1 && queueFetches === 0, 'cancelled queued checks cannot resume provider I/O');
      const guardedLive = createSavedATClient({wasm, store: receiver.store, expectedGroup: group,
        synchronizeOwnerPolicy: options => {
          check(options.binding.owner === binding.owner && options.binding.credential === binding.credential, 'sync bound to restored owner settings');
          return policySync.check(options);
        }, now: () => 1001,
        fetcher: async () => { gatedFetches++; return {ok: true, json: async () => ({header: {timestamp: 1000}, entity: []})}; }});
      check((await guardedLive.read('predictions', {requested: true})).available && gatedFetches === 1,
        'live request follows actual owner policy response');
      const concurrent = await Promise.all(['predictions', 'alerts'].map(kind => guardedLive.read(kind, {requested: true})));
      check(concurrent.every(result => result.available) && gatedFetches === 3, 'parallel feeds each perform a fresh serialized owner check');
      check(!policyCheckError, 'policy exchange completed without dispatch error');
      check(await denied(() => policySync.receive(lastPolicyResponse)), 'already consumed response refused');
      const {openATPolicySession} = await import('./policy-session.mjs');
      check(await denied(() => openATPolicySession({wasm, store: receiver.store, expectedGroup: group, role: 'recipient', peer: receiver.subject})), 'recipient cannot substitute an incoming owner ID');
      check(await denied(() => openATPolicySession({wasm, store: receiver.store, expectedGroup: group, role: 'owner', peer: owner.subject})), 'recipient cannot open owner controller');
      let controllerFetches = 0;
      const {showPolicyConnection} = await import('./policy-connection-view.mjs');
      const ownerMount = document.createElement('div'), recipientMount = document.createElement('div');
      ownerMount.id = 'owner-connect'; recipientMount.id = 'recipient-connect';
      document.querySelector('main').append(ownerMount, recipientMount);
      // Disposal during asynchronous restoration cannot overwrite the next page.
      const cancelledConnectionView = showPolicyConnection(recipientMount, {wasm, store: receiver.store, expectedGroup: group, role: 'recipient',
        onConnected: () => { throw new Error('Cancelled view cannot connect'); }});
      cancelledConnectionView.dispose(); recipientMount.textContent = 'Next screen';
      await cancelledConnectionView.ready;
      check(recipientMount.textContent === 'Next screen', 'cancelled restoration cannot replace the next screen');
      let ownerConnectionView;
      window.retryOwnerConnection = async () => {
        ownerConnectionView?.dispose();
        ownerConnectionView = showPolicyConnection(ownerMount, {wasm, store: owner.store, expectedGroup: group, role: 'owner',
          onConnected: controller => { window.reconnectOwner = controller; }});
        await ownerConnectionView.ready;
      };
      await window.retryOwnerConnection();
      const recipientConnectionView = showPolicyConnection(recipientMount, {wasm, store: receiver.store, expectedGroup: group, role: 'recipient', now: () => 1001,
        onConnected: controller => { window.reconnectRecipient = controller; },
        fetcher: async (url, options) => {
          controllerFetches++; check(options.headers['Ocp-Apim-Subscription-Key'] === 'synthetic-peer-delivery', 'controller obtains locally encrypted key after actual owner check');
          return {ok: true, json: async () => ({header: {timestamp: 1000}, entity: [
            {trip_update: {trip: {trip_id: 'view-trip', route_id: 'view-route', start_date: '19700101'}, stop_time_update: [{stop_id: 'view-stop', stop_sequence: 1, departure: {delay: 60}}]}},
            {vehicle: {trip: {trip_id: 'view-trip', route_id: 'view-route', start_date: '19700101'}, timestamp: 1000, position: {latitude: -36.85, longitude: 174.77}}},
          ]})};
        }});
      await Promise.all([ownerConnectionView.ready, recipientConnectionView.ready]);
      await window.exerciseReconnect();
      const ownerController = window.reconnectOwner, recipientController = window.reconnectRecipient;
      check(ownerController && recipientController, 'visible reconnect controls hand off authenticated controllers');
      ownerConnectionView.dispose(); recipientConnectionView.dispose();
      ownerMount.remove(); recipientMount.remove();
      delete window.retryOwnerConnection;
      check(!ownerController.signal.aborted && !recipientController.signal.aborted, 'leaving completed view preserves handed-off connection');
      const {createScopedSessionClient} = await import('./scoped-session-client.mjs');
      const cancelledScreen = createScopedSessionClient(recipientController);
      const screenRead = cancelledScreen.read('alerts', {requested: true});
      cancelledScreen.close();
      check(!(await screenRead).available && controllerFetches === 0 && !recipientController.signal.aborted,
        'closing a screen cancels its actual saved-key read without closing the authenticated owner connection');
      check(!(await recipientController.read('alerts')).available && controllerFetches === 0, 'authenticated connection is not automatic provider consent');
      const controllerResults = await Promise.all(['alerts', 'predictions'].map(kind => recipientController.read(kind, {requested: true})));
      check(controllerResults.every(result => result.available) && controllerFetches === 2, 'controller routes authenticated nonce-bound policy replies for parallel feeds');
      const stopView = (await import('./stop-live-view.mjs')).showStopLiveUpdates(document.querySelector('#consent'), {
        client: recipientController, place: {id: 'view-stop'}, at: {date: '1970-01-01', seconds: 44200}, now: () => 1001,
        rows: [{trip: 'view-trip', routeId: 'view-route', route: '70', headsign: 'Example', serviceDate: '19700101', stop: {id: 'view-stop'}, stopSequence: 1, departure: 44200}],
      });
      await window.exerciseLiveCheck();
      check(controllerFetches === 4, 'visible stop check uses authenticated controller for both feeds');
      stopView.dispose();
      const journeyView = (await import('./journey-live-view.mjs')).showJourneyLiveUpdates(document.querySelector('#consent'), {
        client: recipientController, date: '1970-01-01', currentLeg: 1, now: () => 1001,
        journey: {legs: [{mode: 'walk'}, {mode: 'bus', trip: 'view-trip', routeId: 'view-route', route: '70', serviceDate: '19700101', from: {id: 'view-stop', name: 'Boarding stop'}, stopSequence: 1, departure: 44200, arrival: 44800}]},
      });
      await window.exerciseLiveCheck();
      check(controllerFetches === 6, 'visible journey check uses authenticated controller for both feeds');
      journeyView.dispose();
      await import('./leaflet.js');
      const mapElement = document.createElement('div'); mapElement.style.height = '240px';
      mapElement.setAttribute('role', 'region'); mapElement.setAttribute('aria-label', 'Selected route map');
      document.querySelector('#consent').before(mapElement);
      const map = L.map(mapElement, {zoomAnimation: false, fadeAnimation: false}).setView([-36.85, 174.77], 14);
      const routeLine = L.polyline([[-36.86, 174.76], [-36.84, 174.78]]).addTo(map);
      const vehicleView = (await import('./vehicle-live-view.mjs')).showVehicleLivePosition(document.querySelector('#consent'), {
        client: recipientController, run: {trip: 'view-trip', routeId: 'view-route', serviceDate: '19700101'}, map, leaflet: L, now: () => 1001,
      });
      await window.exerciseVehicleCheck();
      check(controllerFetches === 7 && Object.values(map._layers).some(layer => layer instanceof L.CircleMarker), 'visible vehicle check reaches actual map after authenticated permission and encrypted key access');
      vehicleView.dispose();
      check(map.hasLayer(routeLine) && !Object.values(map._layers).some(layer => layer instanceof L.CircleMarker), 'vehicle cleanup preserves scheduled route');
      map.remove(); mapElement.remove();
      const removalOptions = {...ownerViewOptions, certificate: undefined, removalOnly: true};
      const removalView = showOwnerDeviceAccess(document.querySelector('#consent'), removalOptions);
      await removalView.ready; await window.exerciseOwnerAccess('remove');
      const removalReceipt = await removalView.completed;
      check(removalReceipt.policy.revision === 5n && !removalReceipt.policy.devices.includes(hex(receiver.subject)), 'owner removal saved from review');
      check(document.querySelector('[role=status]').textContent.includes('must receive it'), 'removal does not claim remote completion');
      removalView.dispose();
      const noRegrant = showOwnerDeviceAccess(document.querySelector('#consent'), removalOptions);
      await noRegrant.ready;
      check(await denied(() => noRegrant.completed), 'saved-grant removal entry cannot become a new grant');
      check(document.querySelector('.pairing-primary').hidden, 'no grant action without a membership proof');
      noRegrant.dispose();
      // Do not push removal: the recipient must discover it before provider I/O.
      check(await receiverVault.getKey() === 'synthetic-peer-delivery', 'recipient has not yet learned removal');
      check(!(await recipientController.read('vehicles', {requested: true})).available && controllerFetches === 7, 'controller learns owner removal before provider fetch');
      check(!(await guardedLive.read('vehicles', {requested: true})).available && gatedFetches === 3,
        'restored adapter preserves learned removal before another provider request');
      check(await denied(() => receiverVault.getKey()), 'catch-up saved owner removal');
      guardedLive.close();
      check(!(await recipientController.read('vehicles', {requested: true})).available && controllerFetches === 7, 'controller refuses locally removed recipient before provider fetch');
      ownerController.close();
      await new Promise(resolve => {
        if (recipientController.signal.aborted) resolve();
        else recipientController.signal.addEventListener('abort', resolve, {once: true});
      });
      check(!(await recipientController.read('alerts', {requested: true})).available && controllerFetches === 7, 'peer closure ends controller provider access');
      recipientController.close();
      holdPolicyChecks = true;
      const abortCheck = new AbortController();
      const waitingCheck = policySync.check({signal: abortCheck.signal});
      const cancelledCheck = denied(() => waitingCheck);
      check(await denied(() => policySync.receive(lastPolicyResponse)), 'previous nonce cannot satisfy a new check');
      abortCheck.abort(); check(await cancelledCheck, 'pending catch-up cancels');
      policySync.close();
      policySync = createPolicySync({wasm, store: receiver.store, expectedGroup: group, peer: owner.subject,
        connection: receiving, timeoutMs: 25});
      check(await denied(() => policySync.check()), 'silent owner check times out');
      policySync.close(); holdPolicyChecks = false;
      await updateLocalATPolicy({wasm, store: owner.store, expectedGroup: group, expectedRevision: 5n,
        devices: [hex(owner.subject), hex(receiver.subject)], certificates: [receiver.certificate]});
      await sendPolicy();
      const staleView = showOwnerDeviceAccess(document.querySelector('#consent'), removalOptions);
      await staleView.ready;
      await updateLocalATPolicy({wasm, store: owner.store, expectedGroup: group, expectedRevision: 6n,
        devices: [hex(owner.subject), hex(receiver.subject)]});
      await window.exerciseOwnerAccess('remove');
      check(await denied(() => staleView.completed), 'stale owner review refuses to overwrite newer policy');
      check(document.querySelector('[role=status]').textContent.includes('could not be confirmed'), 'stale review directs user to current access');
      const latest = await (await import('./policy-store.mjs')).openCredentialPolicyStore({store: owner.store, ...binding}).read();
      check(latest.policy.revision === 7n && latest.policy.devices.includes(hex(receiver.subject)), 'stale removal did not commit');
      staleView.dispose();

    } finally { policySync?.close(); clearTimeout(timeout); request?.close(); sending?.close(); receiving?.close(); owner.store.close(); receiver.store.close(); }
  });
  const restoredGroup = await page.evaluate(() => restoreGroup);
  if(process.env.ENROLLED_CHECKPOINT==='1')assert.equal(await page.evaluate(()=>globalThis.enrolledCheckpointPassed),true);
  const reopened = await context.newPage(); await reopened.goto(page.url());
  if(process.env.ENROLLED_CHECKPOINT==='1') {
    assert.equal(await reopened.evaluate(async bytes=>{
      const group=bytes.map(b=>b.toString(16).padStart(2,'0')).join('');
      const {openIsolatedPlannerStorage}=await import('./isolated-preferences.mjs');
      const {readEnvelope}=await import('./app-preferences.mjs');
      const storage={getItem:key=>localStorage.getItem('enrolled-checkpoint-1:'+key)};
      const local=readEnvelope(openIsolatedPlannerStorage({group,storage}));
      const inboxStore=await (await import('./storage.mjs')).openBrowserStorage('peer-key-receiver');
      try {
        const retained=await inboxStore.read('along-journey-checkpoint-inbox-v1',group);
        const {verifyJourneyCheckpoint}=await import('./generation-checkpoint.mjs');
        const verified=await verifyJourneyCheckpoint({bytes:retained.value.checkpoint,
          current:retained.value.previous,snapshot:retained.value.snapshot});
        if(verified.generation!==1)return false;
      } finally { inboxStore.close(); }
      return local.sync.version.generation===1&&local.sync.pending.length===0
        &&local.data.journeys.some(j=>j.to.id==='sync-denied'&&j.saved&&j.count===7);
    },restoredGroup),true);
    console.log('PASS: enrolled-device checkpoint consent, permission-removal race, guarded installation/retry and local-difference application; recovered independent save/history reopen in a fresh page. Checkpoint bytes use direct fixture handoff, not network delivery.');
  }
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
  const historyBinding = await page.evaluate(() => restoreHistory);
  assert.equal(await reopened.evaluate(async binding => {
    const ownerStore = await (await import('./storage.mjs')).openBrowserStorage('peer-key-owner');
    try { return (await (await import('./delivery-history.mjs')).openDeliveryHistory({store: ownerStore, ...binding}).read()).status; }
    finally { ownerStore.close(); }
  }, historyBinding), 'recipient-confirmed-saved');
  console.log('PASS: distinct real browser identities mutually authenticate over direct WebRTC, owner grant gates signed delivery, receiver encrypts/consumes request, removed peer is refused. Actual software issuer and acknowledged recipient enrollment; harness trust/comparison/signaling, reviewed-descriptor fixture and synthetic AT keys; checked receiver acceptance; one browser host, not physical-device reachability or public release.');
  console.log('PASS: independent journey permission and transaction-race guards; visible connection, consent/removal, wrong-device/cancel refusal, authenticated multi-chunk exchange, committed receipts, offline edits/deletion catch-up and live-session removal. Real enrolled identities; harness copies public signaling between component panels on one host, not app Settings or physical-device acceptance.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
