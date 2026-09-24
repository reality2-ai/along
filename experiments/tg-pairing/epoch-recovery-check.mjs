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
    const issuer = await software.loadSoftwareIssuer({wasm, store: recoveryStore, expectedGroup: group});
    try { await issuer.prepareRotation(); } finally { issuer.close(); }
    await installPreparedIssuerEpoch({wasm, store: recoveryStore, expectedGroup: group, epoch: 2n});
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
  const removed = await answer(await begin());
  await owner.evaluate(async () => {
    await (await import('./member-removal.mjs')).removeSoftwareMember({wasm, store: recoveryStore, expectedGroup: group,
      subject: new Uint8Array(recoveryPeer.subject), certificate: new Uint8Array(recoveryPeer.certificate)});
  });
  assert.equal(await verify(removed), false, 'removal after challenge refuses');
  await assert.rejects(begin(), 'removed member cannot obtain another recovery challenge');
  await owner.evaluate(() => recoveryStore.close());
  await recipient.evaluate(() => recoveryStore.close());
}
