// Node-side browser harness. Transcript bytes are a fixture, not a live link.
import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
export async function checkRecoveryProof(owner, recipient) {
  const review = async () => {
    await recipient.setViewportSize({width: 320, height: 720});
    await recipient.evaluate(async () => {
      document.documentElement.lang = 'en';
      if (!document.querySelector('link[rel=stylesheet]')) {
        const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = './comparison.css'; document.head.append(style);
      }
      const main = document.createElement('main'), heading = document.createElement('h1'), panel = document.createElement('div');
      heading.textContent = 'Your devices'; main.append(heading, panel); document.body.replaceChildren(main);
      window.reviewBacks = 0;
      window.recoveryView = (await import('./epoch-recovery-view.mjs')).showEpochRecoveryReview(panel, {
        session: recoverySession, focus: true, onBack: () => { reviewBacks++; }});
      await recoveryView.ready;
    });
  };
  const peer = await recipient.evaluate(async () => {
    window.recoveryWasm = await import('./hive_wasm.js'); await recoveryWasm.default();
    window.recoveryStore = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
    const saved = await recoveryStore.read('candidate-persona', 'active');
    return {subject: Array.from(saved.value.record.subject), certificate: Array.from(saved.value.record.certificate), group: Array.from(saved.value.record.group)};
  });
  await owner.evaluate(async peer => {
    window.recoveryStore = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
    window.recoveryModule = await import('./epoch-recovery-proof.mjs');
    const {installPreparedIssuerEpoch} = await import('./epoch-installation.mjs');
    await installPreparedIssuerEpoch({wasm, store: recoveryStore, expectedGroup: group, epoch: 1n});
    for (const epoch of [2n, 3n]) {
      const issuer = await software.loadSoftwareIssuer({wasm, store: recoveryStore, expectedGroup: group});
      try { await issuer.prepareRotation(); } finally { issuer.close(); }
      await installPreparedIssuerEpoch({wasm, store: recoveryStore, expectedGroup: group, epoch});
    }
    window.recoveryPeer = peer;
    window.recoveryTranscript = crypto.getRandomValues(new Uint8Array(32));
  }, peer);
  const begin = async (lifetimeMs = 60000) => owner.evaluate(async lifetimeMs => {
    window.recoveryAbort = new AbortController();
    window.recoveryChallenge = await recoveryModule.createEpochRecoveryChallenge({wasm, store: recoveryStore, expectedGroup: group,
      peer: new Uint8Array(recoveryPeer.subject), certificate: new Uint8Array(recoveryPeer.certificate),
      transcript: recoveryTranscript, signal: recoveryAbort.signal, lifetimeMs});
    return {statement: Array.from(recoveryChallenge.statement()), nonce: Array.from(recoveryChallenge.nonce()), transcript: Array.from(recoveryTranscript)};
  }, lifetimeMs);
  const answer = request => recipient.evaluate(async ({request, peer}) => {
    const {answerEpochRecoveryChallenge} = await import('./epoch-recovery-proof.mjs');
    const options = {wasm: recoveryWasm, store: recoveryStore, expectedGroup: new Uint8Array(peer.group),
      ...Object.fromEntries(Object.entries(request).map(([k, v]) => [k, new Uint8Array(v)]))};
    for (const field of ['transcript', 'statement']) {
      const bad = {...options, [field]: options[field].slice()}; bad[field][0] ^= 1;
      if (await answerEpochRecoveryChallenge(bad).then(() => true, () => false)) throw Error('Substitution accepted: ' + field);
    }
    return Array.from(await answerEpochRecoveryChallenge(options));
  }, {request, peer});
  const verify = proof => owner.evaluate(proof => recoveryChallenge.verify(new Uint8Array(proof)), proof);
  const first = await answer(await begin());
  assert.equal(await verify(first), true);
  assert.equal(await verify(first), false, 'single use');
  await begin(); assert.equal(await verify(first), false, 'new nonce rejects old proof');
  const cancelled = await answer(await begin());
  await owner.evaluate(() => recoveryAbort.abort()); assert.equal(await verify(cancelled), false);
  const expired = await answer(await begin(1000));
  await owner.evaluate(() => { const until = performance.now() + 1001; while (performance.now() < until) {} });
  assert.equal(await verify(expired), false, 'use-time expiry while timers delayed');
  const ownerId = await owner.evaluate(async () => Array.from((await recoveryStore.read('candidate-persona', 'active')).value.record.subject));
  for (const scenario of ['proof', 'cancel', 'install', 'valid']) {
    const tamper = scenario === 'proof';
    const offer = await recipient.evaluate(async ({peer, ownerId}) => {
      const {openEpochRecoverySession} = await import('./epoch-recovery-session.mjs');
      const options = {wasm: recoveryWasm, store: recoveryStore, expectedGroup: new Uint8Array(peer.group), role: 'recipient', peer: new Uint8Array(ownerId)};
      if (await openEpochRecoverySession({...options, peer: crypto.getRandomValues(new Uint8Array(32))}).then(s => { s.close(); return true; }, () => false)) throw Error('Wrong saved issuer accepted');
      const cancelled = new AbortController(); cancelled.abort();
      if (await openEpochRecoverySession({...options, signal: cancelled.signal}).then(s => { s.close(); return true; }, () => false)) throw Error('Cancelled setup accepted');
      window.recoverySession = await openEpochRecoverySession(options);
      return recoverySession.offer();
    }, {peer, ownerId});
    const reply = await owner.evaluate(async ({offer, tamper}) => {
      const {openEpochRecoverySession} = await import('./epoch-recovery-session.mjs');
      const options = {wasm, store: recoveryStore, expectedGroup: group, role: 'owner', peer: new Uint8Array(recoveryPeer.subject), certificate: new Uint8Array(recoveryPeer.certificate)};
      const bad = options.certificate.slice(); bad[135] ^= 1;
      if (await openEpochRecoverySession({...options, certificate: bad}).then(s => { s.close(); return true; }, () => false)) throw Error('Bad member certificate accepted');
      if (tamper) {
        const original = RTCDataChannel.prototype.send;
        RTCDataChannel.prototype.send = function(text) {
          const frame = JSON.parse(text);
          if (frame.type === 'owner-proof') {
            RTCDataChannel.prototype.send = original;
            frame.proof[0] ^= 1; return original.call(this, JSON.stringify(frame));
          }
          return original.call(this, text);
        };
      }
      window.recoverySession = await openEpochRecoverySession(options);
      if (await recoverySession.recoveryMaterial(2n).then(m => { m.destroy(); return true; }, () => false)) throw Error('Keys released before mutual authentication');
      return recoverySession.accept(offer);
    }, {offer, tamper});
    await recipient.evaluate(reply => recoverySession.accept(reply), reply);
    if (tamper) {
      assert.equal(await recipient.evaluate(() => recoverySession.authenticated().then(() => true, () => false)), false, 'forged issuer proof refused on real connection');
      await owner.evaluate(() => recoverySession.close());
    } else {
      const states = await Promise.all([owner, recipient].map(page => page.evaluate(async () => {
        const context = await recoverySession.authenticated();
        return {from: String(context.from), to: String(context.to), state: recoverySession.state()};
      })));
      assert.deepEqual(states, [{from: '1', to: '3', state: 'authenticated'}, {from: '1', to: '3', state: 'authenticated'}]);
      assert.equal(await recipient.evaluate(() => recoverySession.recoveryMaterial(2n).then(m => { m.destroy(); return true; }, () => false)), false);
      assert.equal(await owner.evaluate(async () => {
        for (const epoch of [0n, 1n, 4n]) if (await recoverySession.recoveryMaterial(epoch).then(m => { m.destroy(); return true; }, () => false)) throw Error('Epoch outside authenticated range');
        const material = await recoverySession.recoveryMaterial(3n);
        const traffic = await (await import('./software-traffic.mjs')).loadSoftwareTraffic({wasm, store: recoveryStore, expectedGroup: group});
        try {
          const codec = (await import('./certificate.mjs')).certificateCodec(wasm);
          return material.epoch === 3n && codec.authentic(material.certificate, new Uint8Array(recoveryPeer.subject), group)
            && material.payloadKey.every((b, i) => b === traffic.payloadKey[i]) && material.integrityKey.every((b, i) => b === traffic.integrityKey[i]);
        } finally { material.destroy(); traffic.destroy(); }
      }), true);
      await review();
      await recipient.getByRole('heading', {name: 'Receive your group key update?', exact: true}).waitFor();
      await recipient.evaluate(() => document.querySelector('.pairing-primary').click());
      assert.equal(await owner.evaluate(() => recoverySession.canRecover()), false, 'synthetic click cannot accept recipient review');
      if (scenario === 'cancel') {
        await recipient.getByRole('button', {name: 'Back', exact: true}).click();
        assert.equal(await recipient.evaluate(() => reviewBacks), 1);
        await owner.waitForFunction(() => recoverySession.state() === 'closed');
        assert.equal(await recipient.evaluate(async () => (await recoveryStore.read('candidate-persona', 'active')).value.epoch === 1n), true, 'Back before acceptance keeps existing keys');
        assert.equal(await owner.evaluate(() => recoverySession.recover().then(() => true, () => false)), false);
        continue;
      }
      if (scenario === 'install') {
        await recipient.evaluate(async () => {
          const original = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function(...args) {
            const result = original.apply(this, args);
            if (args[1]?.[0] === 'along-browser-traffic') {
              IDBObjectStore.prototype.put = original; this.transaction.abort();
            }
            return result;
          };
        });
        await recipient.getByRole('button', {name: 'Receive group key update', exact: true}).click();
        await owner.waitForFunction(() => recoverySession.canRecover());
        assert.equal(await owner.evaluate(() => recoverySession.recover().then(() => true, () => false)), false, 'failed install cannot confirm');
        assert.equal(await recipient.evaluate(async () => (await recoveryStore.read('candidate-persona', 'active')).value.epoch === 1n), true, 'failed delivery leaves predecessor intact');
        await recipient.getByRole('heading', {name: 'Key update is not confirmed', exact: true}).waitFor();
        await recipient.keyboard.press('Escape'); assert.equal(await recipient.evaluate(() => reviewBacks), 1);
        await Promise.all([owner, recipient].map(page => page.evaluate(() => recoverySession.close())));
      }
    }
  }
  assert.equal(await owner.evaluate(() => recoverySession.recover().then(() => true, () => false)), false, 'recipient review required');
  await recipient.evaluate(() => document.documentElement.style.fontSize = '200%');
  assert.equal(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual((await new AxeBuilder({page: recipient}).analyze()).violations.map(v => v.id), []);
  await recipient.evaluate(() => document.documentElement.style.fontSize = '');
  await recipient.keyboard.press('Tab'); await recipient.keyboard.press('Enter');
  await owner.waitForFunction(() => recoverySession.canRecover());
  await recipient.evaluate(() => {
    const original = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function(text) {
      const frame = JSON.parse(text);
      if (frame.type === 'installed' && frame.epoch === '3') {
        RTCDataChannel.prototype.send = original; this.close(); return;
      }
      return original.call(this, text);
    };
  });
  assert.equal(await owner.evaluate(async () => {
    const operation = recoverySession.recover();
    if (await recoverySession.recover().then(() => true, () => false)) throw Error('Concurrent recovery accepted');
    return operation.then(() => true, () => false);
  }), false, 'lost acknowledgment cannot confirm delivery');
  await recipient.getByRole('heading', {name: 'Group keys saved on this device', exact: true}).waitFor();
  assert.equal(await recipient.evaluate(async () => (await recoveryView.completed).epoch === 3n), true);
  assert.equal(await recipient.evaluate(() => document.activeElement.textContent), 'Back');
  assert.equal(await owner.evaluate(async () => {
    const bytes = new Uint8Array(64); bytes.set(group); bytes.set(recoveryPeer.subject, 32);
    const key = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    return !(await recoveryStore.read('along-epoch-delivery-v1', key + ':3'))
      && (await recoveryStore.read('along-epoch-delivery-v1', key + ':2')).value.epoch === 2n;
  }), true, 'only received confirmations are saved');
  // Reload both documents: the recovery must use durable records, not old closures.
  await Promise.all([owner, recipient].map(page => page.reload()));
  peer.certificate = await recipient.evaluate(async () => {
    window.recoveryWasm = await import('./hive_wasm.js'); await recoveryWasm.default();
    window.recoveryStore = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
    return Array.from((await recoveryStore.read('candidate-persona', 'active')).value.record.certificate);
  });
  await owner.evaluate(async peer => {
    window.wasm = await import('./hive_wasm.js'); await wasm.default();
    window.group = new Uint8Array(peer.group);
    window.recoveryStore = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
    window.recoveryModule = await import('./epoch-recovery-proof.mjs');
    window.recoveryPeer = peer; window.recoveryTranscript = crypto.getRandomValues(new Uint8Array(32));
    window.sentRecoveryKeys = 0;
    const original = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function(text) {
      if (JSON.parse(text).type === 'epoch') sentRecoveryKeys++;
      return original.call(this, text);
    };
  }, peer);
  const installationRevisions = () => recipient.evaluate(async group => {
    const id = Array.from(group, b => b.toString(16).padStart(2, '0')).join('');
    return Promise.all([['candidate-persona', 'active'], ['membership', id], ['along-browser-traffic', id],
      ['along-installed-epoch-v1', id + ':3']].map(async ([scope, key]) => (await recoveryStore.read(scope, key)).revision));
  }, peer.group);
  const reconnect = async () => {
    const reconnectOffer = await recipient.evaluate(async ({peer, ownerId}) => {
      window.recoverySession = await (await import('./epoch-recovery-session.mjs')).openEpochRecoverySession({
        wasm: recoveryWasm, store: recoveryStore, expectedGroup: new Uint8Array(peer.group), role: 'recipient', peer: new Uint8Array(ownerId)});
      return recoverySession.offer();
    }, {peer, ownerId});
    const reconnectReply = await owner.evaluate(async offer => {
      window.recoverySession = await (await import('./epoch-recovery-session.mjs')).openEpochRecoverySession({
        wasm, store: recoveryStore, expectedGroup: group, role: 'owner', peer: new Uint8Array(recoveryPeer.subject),
        certificate: new Uint8Array(recoveryPeer.certificate)});
      return recoverySession.accept(offer);
    }, reconnectOffer);
    await recipient.evaluate(reply => recoverySession.accept(reply), reconnectReply);
    for (const page of [owner, recipient]) assert.deepEqual(await page.evaluate(async () => {
      const result = await recoverySession.authenticated(); return [String(result.from), String(result.to)];
    }), ['3', '3']);
  };
  await reconnect();
  await recipient.evaluate(async group => {
    const key = Array.from(group, b => b.toString(16).padStart(2, '0')).join('') + ':3';
    const record = await recoveryStore.read('along-installed-epoch-v1', key);
    window.heldInstallationReceipt = structuredClone(record.value);
    const changed = structuredClone(record.value); changed.transition[151] ^= 1;
    await recoveryStore.compareAndSwap('along-installed-epoch-v1', key, record.revision, changed);
    await recoverySession.acceptRecovery();
  }, peer.group);
  await owner.waitForFunction(() => recoverySession.canRecover());
  assert.equal(await owner.evaluate(() => recoverySession.recover().then(() => true, () => false)), false, 'corrupted installation cannot produce confirmation');
  await recipient.evaluate(async group => {
    const key = Array.from(group, b => b.toString(16).padStart(2, '0')).join('') + ':3';
    const record = await recoveryStore.read('along-installed-epoch-v1', key);
    await recoveryStore.compareAndSwap('along-installed-epoch-v1', key, record.revision, heldInstallationReceipt);
  }, peer.group);
  const revisions = await installationRevisions();
  await reconnect();
  await review();
  await recipient.getByRole('heading', {name: 'Confirm your saved group keys?', exact: true}).waitFor();
  assert.equal(await owner.evaluate(() => recoverySession.installation().then(() => true, () => false)), false, 'owner cannot claim local recipient installation');
  assert.equal(await owner.evaluate(() => recoverySession.recover().then(() => true, () => false)), false, 'receipt recovery also requires acceptance');
  await recipient.getByRole('button', {name: 'Check saved keys and send confirmation', exact: true}).click();
  await owner.waitForFunction(() => recoverySession.canRecover());
  for (let retry = 0; retry < 2; retry++) assert.deepEqual(await owner.evaluate(async () => {
    const result = await recoverySession.recover(); return {status: result.status, epoch: String(result.epoch)};
  }), {status: 'peer-installation-confirmed', epoch: '3'});
  await recipient.getByRole('heading', {name: 'Group keys saved on this device', exact: true}).waitFor();
  assert.deepEqual(await installationRevisions(), revisions, 'receipt recovery does not rewrite installation');
  assert.equal(await owner.evaluate(() => sentRecoveryKeys), 0, 'receipt recovery sends no epoch keys');
  assert.equal(await recipient.evaluate(async () => {
    const saved = await recoveryStore.read('candidate-persona', 'active');
    const groupId = Array.from(saved.value.record.group, b => b.toString(16).padStart(2, '0')).join('');
    const receipt = await recoveryStore.read('along-installed-epoch-v1', groupId + ':3');
    return saved.value.epoch === 3n && receipt?.value?.format === 1
      && (await recoveryStore.read('along-browser-traffic', groupId)).value.epoch === 3n;
  }), true);
  assert.equal(await owner.evaluate(async () => {
    const bytes = new Uint8Array(64); bytes.set(group); bytes.set(recoveryPeer.subject, 32);
    const key = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('') + ':3';
    const receipt = await recoveryStore.read('along-epoch-delivery-v1', key);
    if (receipt?.value?.epoch !== 3n || receipt.value.signature.length !== 64 || 'payloadKey' in receipt.value) return false;
    const altered = structuredClone(receipt.value); altered.signature[0] ^= 1;
    const {saveRecoveryReceipt} = await import('./epoch-recovery-receipt.mjs');
    if (await saveRecoveryReceipt({wasm, store: recoveryStore, ...altered}).then(() => true, () => false)) return false;
    const previous = await recoveryStore.read('along-epoch-delivery-v1', key.slice(0, -1) + '2');
    return previous?.value?.epoch === 2n && (await recoveryStore.read('along-epoch-delivery-v1', key)).revision === receipt.revision;
  }), true, 'owner retains signed installation evidence');
  await owner.evaluate(async () => {
    const {readRecoveryReceipt} = await import('./epoch-recovery-receipt.mjs');
    window.readConfirmation = options => readRecoveryReceipt({wasm, store: recoveryStore, group,
      subject: new Uint8Array(recoveryPeer.subject), epoch: 3n, ...options});
    const bytes = new Uint8Array(64); bytes.set(group); bytes.set(recoveryPeer.subject, 32);
    window.deliveryKey = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('') + ':3';
    window.originalDelivery = (await recoveryStore.read('along-epoch-delivery-v1', deliveryKey)).value;
    const readonly = {...recoveryStore, compareAndSwap: () => { throw Error('Unexpected write'); },
      compareAndSwapMany: () => { throw Error('Unexpected write'); }};
    if ((await readConfirmation({store: readonly})).epoch !== 3n) throw Error('Saved confirmation not verified');
    if (await readConfirmation({subject: crypto.getRandomValues(new Uint8Array(32))}) !== null) throw Error('Absent confirmation not distinguished');
    const cancelled = new AbortController(); cancelled.abort();
    if (await readConfirmation({signal: cancelled.signal}).then(() => true, () => false)) throw Error('Cancelled read accepted');
    const issuer = await (await import('./software-persona.mjs')).loadSoftwareIssuer({wasm, store: recoveryStore, expectedGroup: group});
    try { await issuer.issueCertificate(crypto.getRandomValues(new Uint8Array(32))); } finally { issuer.close(); }
    const {showMemberDevices} = await import('./member-devices-view.mjs');
    window.devicePanel = document.createElement('div'); document.body.append(devicePanel);
    window.showDevices = async () => {
      window.deviceView?.dispose();
      window.deviceView = showMemberDevices(devicePanel, {wasm, store: recoveryStore, expectedGroup: group}); await deviceView.ready;
    };
    await showDevices();
  });
  await owner.getByText('Confirmed installation of key version 3. This is a saved receipt, not online status.', {exact: true}).waitFor();
  await owner.getByText('No installation confirmation saved for key version 3.', {exact: true}).waitFor();
  assert.equal(await owner.evaluate(() => [...devicePanel.querySelectorAll('button[aria-describedby]')].every(button =>
    document.getElementById(button.getAttribute('aria-describedby'))?.textContent.length > 0)), true);
  for (const field of ['signature', 'nonce', 'certificate', 'transition', 'group', 'subject', 'epoch']) {
    assert.equal(await owner.evaluate(async field => {
      const held = await recoveryStore.read('along-epoch-delivery-v1', deliveryKey);
      const changed = structuredClone(originalDelivery);
      if (field === 'epoch') changed.epoch = 2n; else changed[field][0] ^= 1;
      await recoveryStore.compareAndSwap('along-epoch-delivery-v1', deliveryKey, held.revision, changed);
      const refused = await readConfirmation().then(() => false, () => true);
      await showDevices();
      return refused;
    }, field), true, 'stored ' + field + ' corruption refuses confirmation');
    await owner.getByText('Key-update confirmation could not be verified. No saved data was changed.', {exact: true}).waitFor();
  }
  await owner.evaluate(async () => {
    const held = await recoveryStore.read('along-epoch-delivery-v1', deliveryKey);
    await recoveryStore.compareAndSwap('along-epoch-delivery-v1', deliveryKey, held.revision, originalDelivery);
    let replaced = false;
    const raced = {...recoveryStore, read: async (scope, key) => {
      if (scope === 'along-prepared-epoch-v1' && !replaced) {
        replaced = true;
        const before = await recoveryStore.read('along-epoch-delivery-v1', deliveryKey);
        await recoveryStore.compareAndSwap('along-epoch-delivery-v1', deliveryKey, before.revision, before.value);
      }
      return recoveryStore.read(scope, key);
    }};
    if (await readConfirmation({store: raced}).then(() => true, () => false)) throw Error('Changed receipt accepted during read');
    if ((await readConfirmation()).epoch !== 3n) throw Error('Restored receipt not verified');
  });
  const removed = await answer(await begin());
  await owner.evaluate(async () => {
    await (await import('./member-removal.mjs')).removeSoftwareMember({wasm, store: recoveryStore, expectedGroup: group,
      subject: new Uint8Array(recoveryPeer.subject), certificate: new Uint8Array(recoveryPeer.certificate)});
  });
  assert.equal(await owner.evaluate(() => readConfirmation().then(() => true, () => false)), false, 'removed peer cannot be reported as currently authorized confirmation');
  await owner.evaluate(() => showDevices());
  await owner.getByText('Removal saved here.', {exact: true}).waitFor();
  assert.equal(await owner.getByText('Confirmed installation of key version 3.', {exact: false}).count(), 0);
  await owner.evaluate(() => deviceView.dispose());
  assert.equal(await verify(removed), false, 'removal after challenge refuses');
  await assert.rejects(begin(), 'removed member cannot obtain another recovery challenge');
  for (const page of [owner, recipient]) {
    await page.waitForFunction(() => recoverySession.state() === 'closed');
    assert.equal(await page.evaluate(() => recoverySession.authenticated().then(() => true, () => false)), false);
  }
  assert.equal(await owner.evaluate(() => recoverySession.recoveryMaterial(2n).then(m => { m.destroy(); return true; }, () => false)), false);
  await owner.evaluate(() => recoveryStore.close());
  await recipient.evaluate(() => recoveryStore.close());
  const reopened = await recipient.context().newPage(); await reopened.goto(recipient.url());
  assert.equal(await reopened.evaluate(async group => {
    const wasm = await import('./hive_wasm.js'); await wasm.default();
    const store = await (await import('./storage.mjs')).openBrowserStorage('software-enrollment');
    let material;
    try {
      const options = {wasm, store, expectedGroup: new Uint8Array(group)};
      const local = await (await import('./local-persona.mjs')).loadLocalPersona(options);
      material = await (await import('./software-traffic.mjs')).loadSoftwareTraffic(options);
      return local.epoch === 3n && material.epoch === 3n && (await local.sign(new Uint8Array(32))).length === 64;
    } finally { material?.destroy(); store.close(); }
  }, peer.group), true, 'network-delivered epoch restores in a fresh document');
  await reopened.close();
}
