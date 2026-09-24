import assert from 'node:assert/strict';
export async function prepareATOwnerRenewal(owner, recipient, peer) {
  const fixture = await owner.evaluate(async peer => {
    const {establishLocalATOwner} = await import('./at-credentials/local-owner.mjs');
    const created = await establishLocalATOwner({wasm, store: recoveryStore, expectedGroup: group});
    await (await import('./at-credentials/owner-policy.mjs')).updateLocalATPolicy({wasm, store: recoveryStore,
      expectedGroup: group, expectedRevision: 1n, devices: [created.binding.owner,
        Array.from(peer.subject, b => b.toString(16).padStart(2, '0')).join('')], certificates: [new Uint8Array(peer.certificate)]});
    const signed = await recoveryStore.read('along-at-policy:' + created.binding.owner, created.binding.group + ':' + created.binding.credential);
    const certificate = (await recoveryStore.read('candidate-persona', 'active')).value.record.certificate;
    return {binding: created.binding, certificate: Array.from(certificate), bytes: Array.from(signed.value.bytes), signature: Array.from(signed.value.signature)};
  }, peer);
  await recipient.evaluate(async fixture => {
    await (await import('./at-credentials/remote-owner.mjs')).acceptRemoteATOwner({wasm: recoveryWasm, store: recoveryStore,
      expected: fixture.binding, ownerCertificate: new Uint8Array(fixture.certificate), policyBytes: new Uint8Array(fixture.bytes),
      policySignature: new Uint8Array(fixture.signature), connection: recoverySession});
    window.atRenewalFixture = fixture;
    const policy = await recoveryStore.read('along-at-policy:' + fixture.binding.owner, fixture.binding.group + ':' + fixture.binding.credential);
    window.atPolicyBeforeRenewal = policy;
    await (await import('./at-credentials/local-owner.mjs')).loadATBinding({wasm: recoveryWasm, store: recoveryStore,
      expectedGroup: Uint8Array.from(fixture.binding.group.match(/../g), b => parseInt(b, 16))});
  }, fixture);
  return async () => {
    const certificate = await recipient.evaluate(async () => Array.from((await keyFlow.completed).ownerCertificate));
    assert.deepEqual(certificate, await owner.evaluate(async () => Array.from((await recoveryStore.read('candidate-persona', 'active')).value.record.certificate)), 'renewal evidence comes from the authenticated recovery flow');
    assert.equal(await recipient.evaluate(async certificate => {
      const {renewATOwnerCertificate} = await import('./at-credentials/owner-certificate.mjs');
      const {loadATBinding} = await import('./at-credentials/local-owner.mjs');
      const group = Uint8Array.from(atRenewalFixture.binding.group.match(/../g), b => parseInt(b, 16));
      const options = {wasm: recoveryWasm, store: recoveryStore, expectedGroup: group, certificate: new Uint8Array(certificate)};
      const denied = action => action().then(() => false, () => true);
      if (!await denied(() => loadATBinding(options))) throw Error('Stale owner certificate restored');
      const anchor = await recoveryStore.read('along-at-owners', atRenewalFixture.binding.group);
      const corrupt = options.certificate.slice(); corrupt[135] ^= 1;
      const own = (await recoveryStore.read('candidate-persona', 'active')).value.record.certificate;
      for (const proof of [corrupt, own, new Uint8Array(atRenewalFixture.certificate)]) {
        if (!await denied(() => renewATOwnerCertificate({...options, certificate: proof}))) throw Error('Wrong or stale certificate renewed');
      }
      const cancelled = new AbortController(); cancelled.abort();
      if (!await denied(() => renewATOwnerCertificate({...options, signal: cancelled.signal}))) throw Error('Cancelled renewal accepted');
      for (const scope of ['membership', 'along-at-policy:' + atRenewalFixture.binding.owner, 'enrollment-invitations']) {
        const persona = await recoveryStore.read('candidate-persona', 'active');
        const key = scope === 'membership' ? atRenewalFixture.binding.group : scope === 'enrollment-invitations'
          ? atRenewalFixture.binding.group + ':' + Array.from(persona.value.invitation.code, b => b.toString(16).padStart(2, '0')).join('')
          : atRenewalFixture.binding.group + ':' + atRenewalFixture.binding.credential;
        const raced = {...recoveryStore, compareAndSwapMany: async (...args) => {
          const saved = await recoveryStore.read(scope, key);
          await recoveryStore.compareAndSwap(scope, key, saved.revision, saved.value);
          return recoveryStore.compareAndSwapMany(...args);
        }};
        if (!await denied(() => renewATOwnerCertificate({...options, store: raced}))) throw Error('Stale renewal write accepted');
      }
      if ((await recoveryStore.read('along-at-owners', atRenewalFixture.binding.group)).revision !== anchor.revision) throw Error('Failed renewal changed binding');
      const result = await renewATOwnerCertificate(options);
      if (result.status !== 'at-owner-certificate-renewed' || result.epoch !== 4n) throw Error('Renewal not saved');
      const renewed = await recoveryStore.read('along-at-owners', atRenewalFixture.binding.group);
      const copy = {...renewed.value, ownerCertificate: anchor.value.ownerCertificate};
      if (JSON.stringify(copy) !== JSON.stringify(anchor.value)) throw Error('Binding or consent changed');
      if ((await renewATOwnerCertificate(options)).status !== 'at-owner-certificate-current'
          || (await recoveryStore.read('along-at-owners', atRenewalFixture.binding.group)).revision !== renewed.revision) throw Error('Duplicate renewal rewrites');
      const restored = await loadATBinding(options);
      const policy = await recoveryStore.read('along-at-policy:' + atRenewalFixture.binding.owner, atRenewalFixture.binding.group + ':' + atRenewalFixture.binding.credential);
      if (!policy.value.bytes.every((b, i) => b === atPolicyBeforeRenewal.value.bytes[i])
          || !policy.value.signature.every((b, i) => b === atPolicyBeforeRenewal.value.signature[i])) throw Error('Renewal changed signed policy');
      return restored.role === 'recipient' && JSON.stringify(restored.binding) === JSON.stringify(atRenewalFixture.binding);
    }, certificate), true, 'renewed owner evidence restores the same pinned AT binding and policy');
    console.log('PASS: authenticated recovery certificate renews the pinned AT owner without changing binding or signed policy; wrong/stale proofs, cancellation and raced membership/policy/enrollment writes refuse; duplicate renewal is read-only.');
  };
}
