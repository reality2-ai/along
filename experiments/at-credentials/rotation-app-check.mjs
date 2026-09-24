import assert from 'node:assert/strict';
export async function checkAppRotation({owner, recipient, move, atBinding = true, databaseName}) {
  if (databaseName) for (const page of [owner, recipient]) {
    await page.addInitScript(name => { window.testDeviceDatabase = name; }, databaseName);
    await page.evaluate(name => { window.testDeviceDatabase = name; }, databaseName);
  }
  const state = page => page.evaluate(async atBinding => {
    const wasm = await import('../experiments/tg-pairing/hive_wasm.js'); await wasm.default();
    const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(window.testDeviceDatabase);
    try {
      const persona = (await store.read('candidate-persona', 'active')).value;
      const group = Array.from(persona.record.group, b => b.toString(16).padStart(2, '0')).join('');
      const common = {member: Array.from(persona.record.subject, b => b.toString(16).padStart(2, '0')).join(''), epoch: String(persona.epoch),
        journeyPermission: await store.read('along-journey-sharing-v1', group)};
      if (!atBinding) return common;
      const {binding} = await (await import('../experiments/at-credentials/local-owner.mjs')).loadATBinding({wasm, store, expectedGroup: persona.record.group});
      const key = binding.group + ':' + binding.credential;
      const policy = await store.read('along-at-policy:' + binding.owner, key);
      const secret = await store.read('along-at-secret:' + binding.owner, key);
      const fingerprint = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), b => b.toString(16).padStart(2, '0')).join('');
      return {...common, binding,
        policyRevision: policy.revision, policy: await fingerprint(policy.value.bytes), signature: await fingerprint(policy.value.signature),
        secretRevision: secret.revision, ciphertext: await fingerprint(secret.value.ciphertext)};
    } finally { store.close(); }
  }, atBinding);
  const before = await Promise.all([owner, recipient].map(state));
  for (const page of [owner, recipient]) {
    await page.locator('#settings-open').click();
    await page.getByRole('button', {name: 'Device and AT-key setup', exact: true}).click();
    await page.getByText('Connect or recover another device', {exact: true}).click();
  }
  await owner.getByRole('button', {name: 'Update group keys on this device', exact: true}).click();
  await owner.getByRole('button', {name: 'Update keys on this device', exact: true}).click();
  await owner.getByRole('heading', {name: 'Group keys updated on this device', exact: true}).waitFor();
  await owner.getByRole('button', {name: 'Back', exact: true}).click();
  await owner.getByText('Connect or recover another device', {exact: true}).click();
  await owner.getByRole('button', {name: 'Send a group key update', exact: true}).click();
  const member = before[1].member;
  await owner.getByRole('button', {name: `Device ${member.slice(0, 8)}…${member.slice(-8)}`, exact: true}).click();
  await recipient.getByRole('button', {name: 'Receive a group key update', exact: true}).click();
  await owner.getByRole('heading', {name: 'Connect the device to update', exact: true}).waitFor();
  await move(owner, recipient, 'Starting message from your other device', 'Create update request');
  await recipient.getByRole('heading', {name: 'Send your update request', exact: true}).waitFor();
  await move(recipient, owner, 'Update request from your other device', 'Prepare update reply');
  await owner.getByRole('heading', {name: 'Send the key-update reply', exact: true}).waitFor();
  await move(owner, recipient, 'Key-update reply from your other device', 'Review group key update');
  await recipient.getByRole('button', {name: 'Receive group key update', exact: true}).click();
  await owner.getByRole('button', {name: 'Send update or check confirmation', exact: true}).click();
  await owner.getByRole('heading', {name: 'Other device confirmed its keys', exact: true}).waitFor();
  await recipient.getByRole('heading', {name: 'Group keys saved on this device', exact: true}).waitFor();
  // Wait for the actual Settings renewal callback, without invoking it in the test.
  if (atBinding) await recipient.waitForFunction(async () => {
    const store = await (await import('../experiments/tg-pairing/storage.mjs')).openBrowserStorage(window.testDeviceDatabase);
    try {
      const persona = (await store.read('candidate-persona', 'active')).value;
      const group = Array.from(persona.record.group, b => b.toString(16).padStart(2, '0')).join('');
      const anchor = (await store.read('along-at-owners', group)).value;
      return new DataView(anchor.ownerCertificate.buffer, anchor.ownerCertificate.byteOffset).getBigUint64(64) === persona.epoch;
    } finally { store.close(); }
  });
  const after = await Promise.all([owner, recipient].map(state));
  for (let i = 0; i < 2; i++) {
    assert.equal(BigInt(after[i].epoch), BigInt(before[i].epoch) + 1n);
    assert.deepEqual({...after[i], epoch: before[i].epoch}, before[i], 'rotation preserves AT binding, policy, device identity and encrypted key');
  }
  await owner.getByRole('button', {name: 'Back', exact: true}).click();
  await owner.getByText('Confirmed installation of key version 1. This is a saved receipt, not online status.', {exact: true}).waitFor();
  await owner.getByRole('button', {name: 'Back', exact: true}).click();
  await recipient.getByRole('button', {name: 'Back', exact: true}).click();
  for (const page of [owner, recipient]) {
    await page.getByRole('button', {name: 'Back to settings', exact: true}).click();
    await page.getByRole('button', {name: 'Close settings', exact: true}).click();
    await page.reload();
  }
  assert.deepEqual(await Promise.all([owner, recipient].map(state)), after, 'both app instances restore renewed authority without rewriting AT data');
  console.log(atBinding ? 'PASS: both app Settings rotate and deliver group keys; actual renewal callback preserves AT binding, policy and encrypted credentials across reload.' : 'PASS: both app Settings rotate and deliver group keys while preserving saved journey permissions across reload.');
}
