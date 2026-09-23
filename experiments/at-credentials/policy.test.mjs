import assert from 'node:assert/strict';
import {credentialPolicyBytes, verifyCredentialPolicy} from './policy.mjs';
const key = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
const owner = Buffer.from(await crypto.subtle.exportKey('raw', key.publicKey)).toString('hex');
const policy = {group: '11'.repeat(32), owner, credential: '22'.repeat(16), revision: 3n, generation: 2n,
  devices: ['44'.repeat(32), '33'.repeat(32)]};
const expected = {group: policy.group, owner, credential: policy.credential, afterRevision: 2n, minimumGeneration: 2n};
const bytes = credentialPolicyBytes(policy);
const sign = async bytes => new Uint8Array(await crypto.subtle.sign('Ed25519', key.privateKey, bytes));
const signature = await sign(bytes);
const verified = await verifyCredentialPolicy(bytes, signature, expected);
assert.deepEqual(verified.devices, ['33'.repeat(32), '44'.repeat(32)]);
assert(!verified.devices.includes('55'.repeat(32)), 'same-group membership does not appear as an implicit grant');
assert(Object.isFrozen(verified) && Object.isFrozen(verified.devices));
for (const changed of [
  {group: '66'.repeat(32)}, {owner: '77'.repeat(32)}, {credential: '88'.repeat(16)},
  {afterRevision: 3n}, {minimumGeneration: 3n}, {afterRevision: undefined},
]) await assert.rejects(verifyCredentialPolicy(bytes, signature, {...expected, ...changed}));
const tampered = bytes.slice(); tampered[tampered.length - 5] ^= 1;
await assert.rejects(verifyCredentialPolicy(tampered, signature, expected));
const wrong = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
await assert.rejects(verifyCredentialPolicy(bytes, new Uint8Array(await crypto.subtle.sign('Ed25519', wrong.privateKey, bytes)), expected));
for (const changed of [
  {revision: 0n}, {revision: 1n << 64n}, {revision: 3}, {generation: -1n},
  {devices: [owner, owner]}, {devices: Array(17).fill(owner)}, {devices: ['AA'.repeat(32)]},
  {extra: 'ignored authority'},
]) assert.throws(() => credentialPolicyBytes({...policy, ...changed}));
// Even a genuine owner signature cannot authorize an ambiguous wire encoding.
for (const source of [new TextDecoder().decode(bytes) + ' ',
  JSON.stringify(JSON.parse(new TextDecoder().decode(bytes)).concat('ignored')),
  JSON.stringify(['another/application', policy.group, owner, policy.credential, '3', '2', []]),
]) {
  const encoded = new TextEncoder().encode(source);
  await assert.rejects(verifyCredentialPolicy(encoded, await sign(encoded), expected));
}
const removed = credentialPolicyBytes({...policy, revision: 4n, devices: []});
assert.deepEqual((await verifyCredentialPolicy(removed, await sign(removed), {...expected, afterRevision: 3n})).devices, []);
// A caller mutation during asynchronous crypto cannot change the accepted policy.
const pending = verifyCredentialPolicy(bytes, signature, expected);
bytes.fill(0); signature.fill(0); expected.owner = '99'.repeat(32);
assert.equal((await pending).owner, owner);
console.log('PASS: actual owner signatures, pinned context, strict revision/generation floors, explicit grants/removal, canonical bounded messages and async input snapshots. No TG freshness, persistence or credential delivery claim.');
