import assert from 'node:assert/strict';
import {credentialPolicyBytes} from './policy.mjs';
import {encodeCredentialDelivery, verifyCredentialDelivery} from './delivery-message.mjs';
const issuer = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
const owner = Buffer.from(await crypto.subtle.exportKey('raw', issuer.publicKey)).toString('hex');
const sign = async value => new Uint8Array(await crypto.subtle.sign('Ed25519', issuer.privateKey, value));
const recipient = new Uint8Array(32).fill(3), nonce = crypto.getRandomValues(new Uint8Array(16));
const device = Buffer.from(recipient).toString('hex');
const policy = {group: '11'.repeat(32), owner, credential: '22'.repeat(16), revision: 3n, generation: 2n, devices: [device]};
const policyBytes = credentialPolicyBytes(policy), policySignature = await sign(policyBytes);
const expected = {...policy, afterRevision: 2n, minimumGeneration: 2n, recipient, nonce};
const args = {nonce, recipient, policyBytes, policySignature, key: 'synthetic-delivered-key', sign};
const packet = await encodeCredentialDelivery(args);
const loaded = await verifyCredentialDelivery(packet, expected);
assert.equal(loaded.key, args.key); assert.deepEqual(loaded.policy, policy);
for (const changed of [
  {nonce: new Uint8Array(16)}, {recipient: new Uint8Array(32)}, {group: '44'.repeat(32)},
  {owner: '55'.repeat(32)}, {credential: '66'.repeat(16)}, {afterRevision: 3n}, {minimumGeneration: 3n},
]) await assert.rejects(verifyCredentialDelivery(packet, {...expected, ...changed}), /AT credential delivery unavailable/);
for (const offset of [0, 20, 40, 64, packet.length - 65, packet.length - 1]) {
  const altered = packet.slice(); altered[offset] ^= 1;
  await assert.rejects(verifyCredentialDelivery(altered, expected));
}
for (const altered of [packet.slice(0, -1), new Uint8Array([...packet, 0]), new Uint8Array(2049)]) {
  await assert.rejects(verifyCredentialDelivery(altered, expected));
}
const removedBytes = credentialPolicyBytes({...policy, devices: []});
const removed = await encodeCredentialDelivery({...args, policyBytes: removedBytes, policySignature: await sign(removedBytes)});
await assert.rejects(verifyCredentialDelivery(removed, expected));
const wrongSigner = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
const wrong = await encodeCredentialDelivery({...args, sign: async body => new Uint8Array(await crypto.subtle.sign('Ed25519', wrongSigner.privateKey, body))});
await assert.rejects(verifyCredentialDelivery(wrong, expected));
// All policy limits together must fit the real peer-session message ceiling.
const maximum = {...policy, revision: 0xffffffffffffffffn, generation: 0xffffffffffffffffn,
  devices: Array.from({length: 16}, (_, i) => i.toString(16).padStart(2, '0').repeat(32))};
const maximumBytes = credentialPolicyBytes(maximum);
const largest = await encodeCredentialDelivery({...args, policyBytes: maximumBytes, policySignature: await sign(maximumBytes), key: 'x'.repeat(512)});
assert(largest.length <= 2048);
assert.equal((await verifyCredentialDelivery(largest, expected)).key.length, 512);
// Inputs cannot be changed underneath async signature verification.
const copy = packet.slice(), context = {...expected, nonce: nonce.slice(), recipient: recipient.slice()};
const pending = verifyCredentialDelivery(copy, context); copy.fill(0); context.nonce.fill(0); context.owner = '00'.repeat(32);
assert.equal((await pending).key, args.key);
for (const key of ['', 'bad key', 'x'.repeat(513), 'māori']) await assert.rejects(encodeCredentialDelivery({...args, key}));
console.log('PASS: owner-signed bounded credential message, exact recipient/request/context/grant/floors, changed secret/signature, malformed lengths, input snapshots and maximum-size policy/key. Plaintext codec only: no channel, replay consumption, storage or delivery claim.');
