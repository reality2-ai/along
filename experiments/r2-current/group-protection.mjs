// Current R2 group protection for extended frames.
// - Wire identity halves: FORMATS 3.3–3.5, PROVISIONAL(SS23).
// - Payload envelope: XChaCha20-Poly1305, nonce(24) ‖ ciphertext ‖ tag(16),
//   AAD = L4 authenticated span without payload: FORMATS 4.1–4.3, PROVISIONAL(SS35).
// - Frame tag: HMAC-SHA256 over the L4 span, L4 10.1–10.2.
// - Recipient gate: L5 7.1 and 7.3.3, failing closed with no key identifier.
import {xchacha20poly1305} from '../../public/vendor/noble-ciphers/chacha.js';
import {TYPE, associatedData, authenticatedSpan, encodeExtended, parseFrame, tagLength} from './frame.mjs';

export const NONCE_LENGTH = 24;
export const ENVELOPE_OVERHEAD = NONCE_LENGTH + 16;
// Shared-mesh replication limit on the L4 payload at the deployed hive (L3 5.7.1).
export const RELAY_PAYLOAD_LIMIT = 200;
export const MAX_PLAINTEXT = RELAY_PAYLOAD_LIMIT - ENVELOPE_OVERHEAD;

const subtle = globalThis.crypto.subtle;
const RESERVED = new Set([0, 0xffffffff]);

// SHA-256(public key)[0..4]; a reserved value re-hashes key ‖ 0x01 (FV-002).
// The published text leaves open whether suffixes accumulate; they do here, which
// only matters if a reserved value is actually produced.
export async function wireHalf(publicKey) {
  let input = Uint8Array.from(publicKey);
  for (;;) {
    const digest = new Uint8Array(await subtle.digest('SHA-256', input));
    const half = digest.slice(0, 4);
    if (!RESERVED.has(new DataView(half.buffer).getUint32(0))) return half;
    const next = new Uint8Array(input.length + 1); next.set(input); next[input.length] = 1; input = next;
  }
}

export async function wireEntry(groupPublicKey, memberPublicKey) {
  const out = new Uint8Array(8);
  out.set(await wireHalf(groupPublicKey)); out.set(await wireHalf(memberPublicKey), 4);
  return out;
}

async function hmac(key, data) {
  const k = await subtle.importKey('raw', key, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Verifies a parsed frame's tag; truncation applies at the compact tier (L4 10.1.1).
export async function verifyTag(frame, integrityKey) {
  if (!frame.tag || !frame.origin) return false;
  const full = await hmac(integrityKey, authenticatedSpan(frame));
  return constantTimeEqual(full.subarray(0, tagLength(frame.tier)), frame.tag);
}

const randomU32 = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0];

// Builds a group-protected EVENT. `keys` = {payloadKey, integrityKey} (32 bytes each).
export async function protectEvent({keys, origin, target, eventHash, plaintext, msgId = randomU32(),
  hop = 4, budget = 8, nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_LENGTH))}) {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error(`Plaintext exceeds ${MAX_PLAINTEXT} bytes; divide it above L4`);
  const fields = {tier: 'extended', type: TYPE.EVENT, msgId, eventHash, target, origin};
  const sealed = xchacha20poly1305(keys.payloadKey, nonce, associatedData(fields)).encrypt(plaintext);
  const payload = new Uint8Array(NONCE_LENGTH + sealed.length);
  payload.set(nonce); payload.set(sealed, NONCE_LENGTH);
  const tag = await hmac(keys.integrityKey, authenticatedSpan({...fields, payload}));
  return encodeExtended({type: TYPE.EVENT, hop, budget, msgId, eventHash, target, origin, payload, tag});
}

const addressedTo = (target, self) => {
  const group = target.subarray(0, 4), hive = target.subarray(4, 8);
  const zero = a => a.every(b => b === 0);
  if (zero(target)) return true;
  if (!constantTimeEqual(group, self.subarray(0, 4)) && !zero(group)) return false;
  return zero(hive) || constantTimeEqual(hive, self.subarray(4, 8));
};

// Recipient gate. `keyring` = {self: 8-byte own entry, keys: [{payloadKey,
// integrityKey, epoch}, ...]} holding the current key and, only inside a
// non-persisted grace period, the immediately prior key. Results:
//   {kind: 'discard'}          malformed, not for us, or failed verification/decryption
//   {kind: 'unauthenticated', frame}  untagged frame; never group traffic (L5 10.1)
//   {kind: 'group', frame, plaintext, epoch}
// Failure reasons are deliberately not distinguished (L5 7.3.3).
export async function gate(bytes, keyring) {
  const frame = parseFrame(bytes, 'extended');
  if (frame.discard || frame.originless) return {kind: 'discard'};
  if (!addressedTo(frame.target, keyring.self)) return {kind: 'discard'};
  if (!frame.tag) return {kind: 'unauthenticated', frame};
  if (frame.type !== TYPE.EVENT) return {kind: 'discard'};
  for (const keys of keyring.keys) {
    if (!(await verifyTag(frame, keys.integrityKey))) continue;
    if (frame.payload.length < ENVELOPE_OVERHEAD) return {kind: 'discard'};
    try {
      const plaintext = xchacha20poly1305(keys.payloadKey, frame.payload.subarray(0, NONCE_LENGTH), associatedData(frame))
        .decrypt(frame.payload.subarray(NONCE_LENGTH));
      return {kind: 'group', frame, plaintext, epoch: keys.epoch};
    } catch { return {kind: 'discard'}; }
  }
  return {kind: 'discard'};
}
