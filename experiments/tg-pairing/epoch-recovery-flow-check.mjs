import assert from 'node:assert/strict';
// Uses the real enrolled browser profiles and visible transfer/review controls.
export async function checkEpochRecoveryFlow(owner, recipient, peer) {
  owner.setDefaultTimeout(15000); recipient.setDefaultTimeout(15000);
  const mount = async () => {
    await owner.evaluate(async peer => {
      const panel = document.createElement('div'); document.body.replaceChildren(panel);
      window.keyFlow?.dispose();
      window.keyFlow = (await import('./epoch-recovery-flow.mjs')).showEpochRecoveryFlow(panel, {
        wasm, store: recoveryStore, expectedGroup: group, role: 'owner', peer: new Uint8Array(peer.subject), focus: true});
      await keyFlow.ready;
    }, peer);
    await recipient.evaluate(async group => {
      const panel = document.createElement('div'); document.body.replaceChildren(panel);
      window.keyFlow?.dispose();
      window.keyFlow = (await import('./epoch-recovery-flow.mjs')).showEpochRecoveryFlow(panel, {
        wasm: recoveryWasm, store: recoveryStore, expectedGroup: new Uint8Array(group), role: 'recipient', focus: true});
      await keyFlow.ready;
    }, peer.group);
  };
  const message = page => page.getByLabel('Device message to copy', {exact: true}).inputValue();
  const transfer = async (from, to, label, button, mutate = text => text) => {
    await to.getByLabel(label, {exact: true}).fill(mutate(await message(from)));
    await to.getByRole('button', {name: button, exact: true}).click();
  };
  for (const scenario of ['wrong-reply', 'confirm', 'update']) {
    if (scenario === 'update') await owner.evaluate(async () => {
      const issuer = await (await import('./software-persona.mjs')).loadSoftwareIssuer({wasm, store: recoveryStore, expectedGroup: group});
      try { await issuer.prepareRotation(); } finally { issuer.close(); }
      await (await import('./epoch-installation.mjs')).installPreparedIssuerEpoch({wasm, store: recoveryStore, expectedGroup: group, epoch: 4n});
    });
    await mount();
    await transfer(owner, recipient, 'Starting message from your other device', 'Create update request');
    await recipient.getByRole('heading', {name: 'Send your update request', exact: true}).waitFor();
    await transfer(recipient, owner, 'Update request from your other device', 'Prepare update reply');
    await owner.getByRole('heading', {name: 'Send the key-update reply', exact: true}).waitFor();
    await transfer(owner, recipient, 'Key-update reply from your other device', 'Review group key update', text => {
      if (scenario !== 'wrong-reply') return text;
      const value = JSON.parse(text); value.nonce = '00'.repeat(16); return JSON.stringify(value);
    });
    if (scenario === 'wrong-reply') {
      await recipient.getByRole('heading', {name: 'Device update is not confirmed', exact: true}).waitFor();
      assert.equal(await recipient.evaluate(async () => (await recoveryStore.read('candidate-persona', 'active')).value.epoch === 3n), true);
      continue;
    }
    const label = scenario === 'confirm' ? 'Check saved keys and send confirmation' : 'Receive group key update';
    await recipient.getByRole('button', {name: label, exact: true}).click();
    await owner.getByRole('heading', {name: 'Your other device is ready', exact: true}).waitFor();
    assert.equal(await recipient.evaluate(async () => (await recoveryStore.read('candidate-persona', 'active')).value.epoch === 3n), true, 'recipient acceptance alone does not send keys');
    await owner.getByRole('button', {name: 'Send update or check confirmation', exact: true}).click();
    await owner.getByRole('heading', {name: 'Other device confirmed its keys', exact: true}).waitFor();
    await recipient.getByRole('heading', {name: 'Group keys saved on this device', exact: true}).waitFor();
    const epoch = scenario === 'confirm' ? '3' : '4';
    assert.deepEqual(await owner.evaluate(async () => { const result = await keyFlow.completed; return [result.status, String(result.epoch)]; }), ['peer-installation-confirmed', epoch]);
    assert.deepEqual(await recipient.evaluate(async () => { const result = await keyFlow.completed; return [result.status, String(result.epoch)]; }), ['installed-local', epoch]);
  }
  const removalSets = await Promise.all([owner, recipient].map(page => page.evaluate(async () => {
    const saved = await recoveryStore.read('candidate-persona', 'active');
    return (await import('./removal-set.mjs')).exportRemovalSet({wasm: typeof recoveryWasm === 'undefined' ? wasm : recoveryWasm,
      store: recoveryStore, expectedGroup: saved.value.record.group});
  })));
  assert.equal(removalSets[0], removalSets[1], 'visible exchange catches up signed removals');
  peer.certificate = await recipient.evaluate(async () => Array.from((await recoveryStore.read('candidate-persona', 'active')).value.record.certificate));
  await owner.evaluate(peer => { window.recoveryPeer = peer; }, peer);
}
