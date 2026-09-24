import assert from 'node:assert/strict';
import {test} from 'node:test';
import {epochKeyDigest, epochTransitionStatement, encodeEpochTransition, verifyEpochTransition} from './epoch-transition.mjs';

test('signed successor binds authority, epochs and both traffic keys', async () => {
  const issuer = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  const group = new Uint8Array(await crypto.subtle.exportKey('raw', issuer.publicKey));
  const payload = crypto.getRandomValues(new Uint8Array(32));
  const integrity = crypto.getRandomValues(new Uint8Array(32));
  const before = payload.slice(), keyDigest = await epochKeyDigest(payload, integrity);
  assert.deepEqual(payload, before, 'digest does not destroy caller custody');
  assert.notDeepEqual(keyDigest, await epochKeyDigest(integrity, payload), 'key roles are bound');
  const fields = {group, from: 0n, to: 1n, keyDigest};
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', issuer.privateKey, epochTransitionStatement(fields)));
  const bytes = encodeEpochTransition(fields, signature);
  const verify = (message, expectedGroup = group, currentEpoch = 0n) => verifyEpochTransition({bytes: message, expectedGroup, currentEpoch});
  assert.deepEqual(await verify(bytes), fields);
  // Every byte is authenticated, including domain, group, epochs and key digest.
  for (let i = 0; i < bytes.length; i++) {
    const changed = bytes.slice(); changed[i] ^= 1;
    await assert.rejects(verify(changed), `changed byte ${i}`);
  }
  await assert.rejects(verify(bytes.slice(1)));
  await assert.rejects(verify(new Uint8Array([...bytes, 0])));
  await assert.rejects(verify(bytes, crypto.getRandomValues(new Uint8Array(32))));
  await assert.rejects(verify(bytes, group, 1n), 'replay after advancing is refused');
  await assert.rejects(verify(bytes, group, 2n), 'rollback is refused');
  const mutable = bytes.slice(), expected = group.slice();
  const pending = verify(mutable, expected);
  mutable.fill(0); expected.fill(0);
  assert.deepEqual(await pending, fields, 'async verification snapshots caller arrays');
  const padded = new Uint8Array(bytes.length + 9); padded.set(bytes, 5);
  assert.deepEqual(await verify(padded.subarray(5, 5 + bytes.length)), fields);
});

test('bounds refuse skipped epochs, overflow and malformed key material', async () => {
  const fields = {group: new Uint8Array(32), from: 0n, to: 1n, keyDigest: new Uint8Array(32)};
  for (const changes of [{from: -1n}, {from: 0}, {to: 0n}, {to: 2n},
    {from: 0xffffffffffffffffn, to: 0x10000000000000000n},
    {group: new Uint8Array(31)}, {keyDigest: new Uint8Array(33)}]) {
    assert.throws(() => epochTransitionStatement({...fields, ...changes}));
  }
  assert.throws(() => encodeEpochTransition(fields, new Uint8Array(63)));
  await assert.rejects(epochKeyDigest(new Uint8Array(31), new Uint8Array(32)));
  const last = {...fields, from: 0xfffffffffffffffen, to: 0xffffffffffffffffn};
  assert.equal(new DataView(epochTransitionStatement(last).buffer).getBigUint64(48), last.to);
});
