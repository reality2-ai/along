import assert from 'node:assert/strict';
import {encodePolicyUpdate, decodePolicyUpdate} from './policy-update-message.mjs';

const bytes = new Uint8Array([1, 2, 3]), signature = new Uint8Array(64).fill(7);
const encoded = encodePolicyUpdate(bytes, signature);
const decoded = decodePolicyUpdate(encoded);
assert.deepEqual(decoded.policyBytes, bytes); assert.deepEqual(decoded.policySignature, signature);
bytes.fill(9); signature.fill(9); encoded.fill(9);
assert.deepEqual(decoded.policyBytes, new Uint8Array([1, 2, 3]));
assert.equal(decoded.policySignature[0], 7);
const packet = encodePolicyUpdate(new Uint8Array([1]), new Uint8Array(64));
for (const changed of [packet.slice(0, -1), new Uint8Array([...packet, 0]), new Uint8Array(2049), new Uint8Array()]) {
  assert.throws(() => decodePolicyUpdate(changed));
}
const wrongDomain = packet.slice(); wrongDomain[0] ^= 1;
assert.throws(() => decodePolicyUpdate(wrongDomain));
assert.throws(() => encodePolicyUpdate(new Uint8Array(), new Uint8Array(64)));
assert.throws(() => encodePolicyUpdate(new Uint8Array(2048), new Uint8Array(64)));
assert.throws(() => encodePolicyUpdate(new Uint8Array([1]), new Uint8Array(63)));
console.log('PASS: bounded exact policy-message framing and detached byte copies. Signature, authority and replay checks are exercised in the browser delivery test.');
