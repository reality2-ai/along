// Along software-profile framing, not a normative R2 wire format.
// Verification alone MUST NOT advance membership or authorize key installation.
const domain = new TextEncoder().encode('ALNGEPC1');
const keyDomain = new TextEncoder().encode('along/software-epoch-keys/v1');
const fixed = (value, length) => value instanceof Uint8Array && value.length === length;
const u64 = value => typeof value === 'bigint' && value >= 0n && value <= 0xffffffffffffffffn;
const same = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const refuse = () => new Error('Group epoch transition unavailable');

// The digest binds BOTH keys and their roles. Copies containing key bytes are
// erased after hashing; callers retain ownership of the supplied arrays.
export async function epochKeyDigest(payloadKey, integrityKey) {
  if (!fixed(payloadKey, 32) || !fixed(integrityKey, 32)) throw refuse();
  const input = new Uint8Array(keyDomain.length + 64);
  input.set(keyDomain); input.set(payloadKey, keyDomain.length);
  input.set(integrityKey, keyDomain.length + 32);
  try { return new Uint8Array(await crypto.subtle.digest('SHA-256', input)); }
  finally { input.fill(0); }
}

// Strictly one successor. Offline devices will need a verified ordered chain;
// a larger signed epoch is not permission to skip locally held state.
export function epochTransitionStatement({group, from, to, keyDigest}) {
  if (!fixed(group, 32) || !u64(from) || !u64(to) || to !== from + 1n
      || !fixed(keyDigest, 32)) throw refuse();
  const out = new Uint8Array(88), view = new DataView(out.buffer);
  out.set(domain); out.set(group, 8); view.setBigUint64(40, from);
  view.setBigUint64(48, to); out.set(keyDigest, 56); return out;
}

export function encodeEpochTransition(fields, signature) {
  if (!fixed(signature, 64)) throw refuse();
  const out = new Uint8Array(152);
  out.set(epochTransitionStatement(fields)); out.set(signature, 88); return out;
}

export async function verifyEpochTransition({bytes, expectedGroup, currentEpoch}) {
  if (!fixed(bytes, 152) || !fixed(expectedGroup, 32) || !u64(currentEpoch)) throw refuse();
  // Snapshot all caller-owned bytes before the first asynchronous boundary.
  const message = bytes.slice(), group = expectedGroup.slice();
  const view = new DataView(message.buffer);
  const from = view.getBigUint64(40), to = view.getBigUint64(48);
  const keyDigest = message.slice(56, 88);
  if (from !== currentEpoch || !same(message.slice(0, 88),
      epochTransitionStatement({group, from, to, keyDigest}))) throw refuse();
  const key = await crypto.subtle.importKey('raw', group, 'Ed25519', false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', key, message.slice(88), message.slice(0, 88))) throw refuse();
  // Public evidence only; no storage write, key grant, or global-freshness claim.
  return Object.freeze({group, from, to, keyDigest});
}
