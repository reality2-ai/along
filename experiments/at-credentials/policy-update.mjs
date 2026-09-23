import {loadATBinding} from './local-owner.mjs';
import {openCredentialPolicyStore} from './policy-store.mjs';
export {encodePolicyUpdate, decodePolicyUpdate} from './policy-update-message.mjs';
const fail = () => new Error('AT policy update unavailable');
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

// Session controller supplies the actual authenticated peer, not a payload ID.
// Removal policies must be accepted even when they no longer grant this device.
export async function applyRemoteATPolicy({wasm, store, expectedGroup, peer,
  policyBytes, policySignature, connection, signal}) {
  try {
    if (store.capabilities?.transactionChecks !== true || !connection?.signal
        || !(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32
        || !(peer instanceof Uint8Array) || peer.length !== 32
        || !(policyBytes instanceof Uint8Array) || policyBytes.length > 2048
        || !(policySignature instanceof Uint8Array) || policySignature.length !== 64) throw fail();
    const group = expectedGroup.slice(), owner = hex(peer), groupId = hex(group);
    const bytes = policyBytes.slice(), signature = policySignature.slice();
    const lifetime = signal ? AbortSignal.any([signal, connection.signal]) : connection.signal;
    const current = () => { if (lifetime.aborted) throw fail(); };
    current(); await connection.authenticated(); current();
    const anchor = await store.read('along-at-owners', groupId);
    const persona = await store.read('candidate-persona', 'active');
    const membership = await store.read('membership', groupId);
    if (!anchor || !persona || !membership) throw fail();
    const evidenceScope = persona.value.origin === 'initial' ? 'persona-bootstrap' : 'enrollment-invitations';
    const evidenceKey = persona.value.origin === 'initial' ? 'initial' : groupId + ':' + hex(persona.value.invitation.code);
    const evidence = await store.read(evidenceScope, evidenceKey); current();
    if (!evidence) throw fail();
    const saved = await loadATBinding({wasm, store, expectedGroup: group, signal: lifetime});
    if (saved?.role !== 'recipient' || saved.binding.owner !== owner) throw fail();
    await connection.authenticated(); current();
    const checks = [
      {scope: 'along-at-owners', key: groupId, expectedRevision: anchor.revision},
      {scope: 'candidate-persona', key: 'active', expectedRevision: persona.revision},
      {scope: 'membership', key: groupId, expectedRevision: membership.revision},
      {scope: evidenceScope, key: evidenceKey, expectedRevision: evidence.revision},
    ];
    const guarded = {...store, compareAndSwapMany: (changes, options) => store.compareAndSwapMany(changes, {...options, checks})};
    return await openCredentialPolicyStore({store: guarded, ...saved.binding}).update(bytes, signature, {signal: lifetime});
  } catch { throw fail(); }
}
