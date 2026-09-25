import test from 'node:test';
import assert from 'node:assert/strict';
import {xchacha20poly1305} from '../../public/vendor/noble-ciphers/chacha.js';
import {gate, MAX_PLAINTEXT, protectEvent, RELAY_PAYLOAD_LIMIT, wireEntry} from './group-protection.mjs';
import {parseFrame, encodeExtended, TYPE} from './frame.mjs';
import {eventHash} from './names.mjs';
import {duplicateCache} from './duplicates.mjs';
import {heartbeatFrame, readAnnouncement} from './heartbeat.mjs';
import {decode, encode} from './cbor.mjs';

const hex = s => Uint8Array.from(s.match(/../g), b => parseInt(b, 16));
const toHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const range = (from, n) => Uint8Array.from({length: n}, (_, i) => from + i);

test('XChaCha20-Poly1305: draft-irtf-cfrg-xchacha A.3.1, cross-checked with libsodium 1.0.22', () => {
  const plaintext = new TextEncoder().encode("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
  const sealed = xchacha20poly1305(range(0x80, 32), range(0x40, 24), hex('50515253c0c1c2c3c4c5c6c7')).encrypt(plaintext);
  assert.equal(toHex(sealed), 'bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52ec0875924c1c7987947deafd8780acf49');
});

const groupKey = range(1, 32), aliceKey = range(40, 32), bobKey = range(80, 32);
const keysA = {payloadKey: range(100, 32), integrityKey: range(140, 32), epoch: 0};
const keysB = {payloadKey: range(180, 32), integrityKey: range(210, 32), epoch: 1};
const setup = async () => {
  const alice = await wireEntry(groupKey, aliceKey), bob = await wireEntry(groupKey, bobKey);
  const groupTarget = new Uint8Array(8); groupTarget.set(alice.subarray(0, 4));
  return {alice, bob, groupTarget};
};
const event = eventHash('nz.along.test');

test('protected event round-trips through the gate and fits the relay limit', async () => {
  const {alice, bob, groupTarget} = await setup();
  const plaintext = encode(new Map([[0, 'hello'], [1, 42]]));
  const bytes = await protectEvent({keys: keysA, origin: alice, target: groupTarget, eventHash: event, plaintext});
  const frame = parseFrame(bytes);
  assert.equal(bytes[0], 0x06);
  assert.equal(bytes[1], 0x48);
  assert.equal(frame.payload.length, plaintext.length + 40);
  const got = await gate(bytes, {self: bob, keys: [keysA]});
  assert.equal(got.kind, 'group');
  assert.equal(decode(got.plaintext).get(0), 'hello');
  const full = await protectEvent({keys: keysA, origin: alice, target: groupTarget, eventHash: event, plaintext: new Uint8Array(MAX_PLAINTEXT)});
  assert.equal(parseFrame(full).payload.length, RELAY_PAYLOAD_LIMIT);
  await assert.rejects(protectEvent({keys: keysA, origin: alice, target: groupTarget, eventHash: event, plaintext: new Uint8Array(MAX_PLAINTEXT + 1)}), /divide/);
});

test('gate fails closed: wrong key, tampering, wrong address, untagged, relay mutation allowed', async () => {
  const {alice, bob, groupTarget} = await setup();
  const plaintext = encode('x');
  const bytes = await protectEvent({keys: keysA, origin: alice, target: groupTarget, eventHash: event, plaintext});
  assert.equal((await gate(bytes, {self: bob, keys: [keysB]})).kind, 'discard');
  assert.equal((await gate(bytes, {self: bob, keys: []})).kind, 'discard');
  for (const at of [2, 6, 14, 23, 31, 40, bytes.length - 1]) {
    const bad = bytes.slice(); bad[at] ^= 1;
    assert.equal((await gate(bad, {self: bob, keys: [keysA]})).kind, 'discard', 'byte ' + at);
  }
  const otherGroup = bob.slice(); otherGroup[0] ^= 0xff;
  assert.equal((await gate(bytes, {self: otherGroup, keys: [keysA]})).kind, 'discard');
  const toCarol = groupTarget.slice(); toCarol.set([9, 9, 9, 9], 4);
  const direct = await protectEvent({keys: keysA, origin: alice, target: toCarol, eventHash: event, plaintext});
  assert.equal((await gate(direct, {self: bob, keys: [keysA]})).kind, 'discard');
  // A relay decrements hop, halves budget and appends a route entry; the tag still verifies.
  const relayed = new Uint8Array(bytes.length + 8);
  relayed.set(bytes.subarray(0, 31)); relayed[1] = 0x34; relayed[22] = 2; relayed.set(range(7, 8), 31); relayed.set(bytes.subarray(31), 39);
  assert.equal((await gate(relayed, {self: bob, keys: [keysA]})).kind, 'group');
  const plain = encodeExtended({type: TYPE.EVENT, msgId: 1, eventHash: event, target: groupTarget, origin: alice, payload: plaintext});
  assert.equal((await gate(plain, {self: bob, keys: [keysA]})).kind, 'unauthenticated');
  // Prior key accepted only while the caller still lists it.
  assert.equal((await gate(bytes, {self: bob, keys: [keysB, keysA]})).epoch, 0);
});

test('duplicate cache keys on origin and message id and expires by age', () => {
  let t = 0;
  const cache = duplicateCache({lifetimeMs: 1000, now: () => t});
  const o = range(1, 8);
  assert.equal(cache.admit(o, 5), true);
  assert.equal(cache.admit(o, 5), false);
  assert.equal(cache.admit(range(2, 8), 5), true);
  t = 1000;
  assert.equal(cache.admit(o, 5), true);
});

test('production heartbeat carries no development element', async () => {
  const {alice} = await setup();
  const bytes = heartbeatFrame({origin: alice, msgId: 7, beaconId: range(1, 4), classHash: range(5, 4)});
  assert.equal(bytes[0], 0x2c);
  assert.equal(bytes[1], 0x10);
  assert.equal(readAnnouncement(bytes).build, 'production');
  assert.equal(readAnnouncement(heartbeatFrame({origin: alice, msgId: 7, beaconId: range(1, 4), classHash: range(5, 4), development: true})).build, 'development');
});
