// Node-side browser harness. Transcript bytes are a fixture, not a live link.
import assert from 'node:assert/strict';
export async function checkRecoveryProof(owner, recipient) {
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
  for (const scenario of ['proof', 'install', 'valid']) {
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
          await recoverySession.acceptRecovery();
        });
        await owner.waitForFunction(() => recoverySession.canRecover());
        assert.equal(await owner.evaluate(() => recoverySession.recover().then(() => true, () => false)), false, 'failed install cannot confirm');
        assert.equal(await recipient.evaluate(async () => (await recoveryStore.read('candidate-persona', 'active')).value.epoch === 1n), true, 'failed delivery leaves predecessor intact');
        await Promise.all([owner, recipient].map(page => page.evaluate(() => recoverySession.close())));
      }
    }
  }
  const removed = await answer(await begin());
  assert.equal(await owner.evaluate(() => recoverySession.recover().then(() => true, () => false)), false, 'recipient review required');
  await recipient.evaluate(() => recoverySession.acceptRecovery());
  await owner.waitForFunction(() => recoverySession.canRecover());
  assert.deepEqual(await owner.evaluate(async () => {
    const operation = recoverySession.recover();
    if (await recoverySession.recover().then(() => true, () => false)) throw Error('Concurrent recovery accepted');
    const result = await operation;
    return {status: result.status, epoch: String(result.epoch)};
  }), {status: 'peer-installation-confirmed', epoch: '3'});
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
    await (await import('./member-removal.mjs')).removeSoftwareMember({wasm, store: recoveryStore, expectedGroup: group,
      subject: new Uint8Array(recoveryPeer.subject), certificate: new Uint8Array(recoveryPeer.certificate)});
  });
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
