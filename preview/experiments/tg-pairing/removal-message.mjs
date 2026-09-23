import {openMembership} from './membership.mjs';
const profile = 'along-member-removal-v1';
const hex = value => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
const bytes = (value, length) => value instanceof Uint8Array && value.length === length;
const fail = () => new Error('Group removal message unavailable');
const keys = ['profile', 'group', 'subject', 'epoch', 'sequence', 'reason', 'signature'];
export function decodeRemoval(text, expectedGroup) {
  if (!bytes(expectedGroup, 32) || typeof text !== 'string' || text.length > 1024) throw fail();
  const value = JSON.parse(text);
  if (!value || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))
      || value.profile !== profile || value.group !== hex(expectedGroup)
      || !Number.isInteger(value.reason) || value.reason < 0 || value.reason > 3) throw fail();
  const result = {reason: value.reason};
  for (const [key, length] of [['subject', 64], ['signature', 128]]) {
    if (typeof value[key] !== 'string' || value[key].length !== length || !/^[0-9a-f]+$/.test(value[key])) throw fail();
    result[key] = Uint8Array.from(value[key].match(/../g), byte => parseInt(byte, 16));
  }
  for (const key of ['epoch', 'sequence']) {
    if (typeof value[key] !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value[key])) throw fail();
    result[key] = BigInt(value[key]);
    if (result[key] > 0xffffffffffffffffn) throw fail();
  }
  if (result.sequence === 0n) throw fail();
  return result;
}
export function encodeRemoval(group, evidence) {
  if (!bytes(group, 32) || !bytes(evidence?.subject, 32) || !bytes(evidence.signature, 64)
      || typeof evidence.epoch !== 'bigint' || typeof evidence.sequence !== 'bigint') throw fail();
  const text = JSON.stringify({profile, group: hex(group), subject: hex(evidence.subject),
    epoch: String(evidence.epoch), sequence: String(evidence.sequence), reason: evidence.reason, signature: hex(evidence.signature)});
  decodeRemoval(text, group); return text;
}

// The caller supplies its established group, never a group adopted from input.
// Public signed evidence may be carried over an untrusted channel. Validate its
// signature before any write, then retain it atomically before reporting success.
export async function receiveRemoval({wasm, store, expectedGroup, text, signal}) {
  const evidence = decodeRemoval(text, expectedGroup), group = expectedGroup.slice(), key = hex(group);
  if (store.capabilities?.transactionChecks !== true) throw fail();
  for (let attempt = 0; attempt < 8; attempt++) {
    if (signal?.aborted) throw fail();
    const saved = await store.read('membership', key);
    if (!saved || !bytes(saved.value?.subject, 32)) throw fail();
    const membership = openMembership(store, wasm, group, saved.value.subject);
    try {
      if (!['current', 'revoked'].includes(await membership.status())) throw fail();
      if ((await store.read('membership', key))?.revision !== saved.revision) continue;
      const verifier = wasm.BrowserMembership.establish(group, saved.value.current, saved.value.depth);
      try {
        if (!verifier.apply_revocation(evidence.subject, evidence.epoch, evidence.sequence, evidence.reason, evidence.signature)) throw fail();
      } finally { verifier.free(); }
      const known = saved.value.revocations.some(entry => hex(entry.subject) === hex(evidence.subject));
      if (!known) {
        if (saved.value.revocations.length >= 256) throw fail();
        const value = structuredClone(saved.value); value.revocations.push(evidence);
        const result = await store.compareAndSwapMany([
          {scope: 'membership', key, expectedRevision: saved.revision, value},
        ], {signal});
        if (!result.applied) continue;
      } else if (signal?.aborted) throw fail();
      // Existing verifier publishes authenticated invalidation to other local tabs.
      // Failure here cannot undo an already durable commit.
      try { await membership.applyRevocation(evidence); } catch {}
      return {status: 'removal-saved', alreadyKnown: known, thisDeviceRemoved: hex(evidence.subject) === hex(saved.value.subject)
        || saved.value.revocations.some(entry => hex(entry.subject) === hex(saved.value.subject))};
    } finally { membership.close(); }
  }
  throw fail();
}
