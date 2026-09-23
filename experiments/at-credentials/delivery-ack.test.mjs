import assert from 'node:assert/strict';
import {signDeliveryAck, verifyDeliveryAck} from './delivery-ack.mjs';
const identity = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
const recipient = Buffer.from(await crypto.subtle.exportKey('raw', identity.publicKey)).toString('hex');
const value = {group: '11'.repeat(32), owner: '22'.repeat(32), credential: '33'.repeat(16), recipient,
  nonce: '44'.repeat(16), policyRevision: 2n, generation: 1n};
const sign = async bytes => new Uint8Array(await crypto.subtle.sign('Ed25519', identity.privateKey, bytes));
const packet = await signDeliveryAck(value, sign);
assert.equal((await verifyDeliveryAck(packet, value)).status, 'recipient-confirmed-saved');
for (const change of [{group: '55'.repeat(32)}, {owner: '66'.repeat(32)}, {credential: '77'.repeat(16)},
  {recipient: '88'.repeat(32)}, {nonce: '99'.repeat(16)}, {policyRevision: 3n}, {generation: 2n}]) {
  await assert.rejects(verifyDeliveryAck(packet, {...value, ...change}));
}
const changed = packet.slice(); changed[changed.length - 1] ^= 1;
await assert.rejects(verifyDeliveryAck(changed, value));
await assert.rejects(verifyDeliveryAck(packet.slice(0, -1), value));
const wrong = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
await assert.rejects(verifyDeliveryAck(await signDeliveryAck(value,
  async bytes => new Uint8Array(await crypto.subtle.sign('Ed25519', wrong.privateKey, bytes))), value));
const input = packet.slice(), expected = {...value};
const pending = verifyDeliveryAck(input, expected); input.fill(0); expected.recipient = '00'.repeat(32);
assert.equal((await pending).status, 'recipient-confirmed-saved');
console.log('PASS: recipient signature binds public saved receipt to exact group, owner, credential, recipient, request and policy generation/revision; tampering and wrong signer refuse. No continuing access or physical durability claim.');
