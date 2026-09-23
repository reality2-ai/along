import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openMembership} from '../tg-pairing/membership.mjs';
import {openCredentialPolicyStore} from './policy-store.mjs';
import {verifyCredentialPolicy} from './policy.mjs';
const fail = () => new Error('AT owner acceptance unavailable');
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

// Explicit local consent operation. The trusted connection controller supplies
// the reviewed binding and the connection authenticated as that owner. Never
// derive expected owner/credential from the policy or credential payload here.
export async function acceptRemoteATOwner({wasm, store, expected, ownerCertificate,
  policyBytes, policySignature, connection, signal}) {
  let membership;
  try {
    if (store.capabilities?.transactionChecks !== true || !connection?.signal
        || !(ownerCertificate instanceof Uint8Array) || ownerCertificate.length !== 136
        || !(policyBytes instanceof Uint8Array) || policyBytes.length > 2048
        || !(policySignature instanceof Uint8Array) || policySignature.length !== 64) throw fail();
    const binding = Object.freeze({group: expected?.group, owner: expected?.owner, credential: expected?.credential});
    openCredentialPolicyStore({store, ...binding}); // Validate pinned identifiers.
    const proof = ownerCertificate.slice(), bytes = policyBytes.slice(), signature = policySignature.slice();
    const group = Uint8Array.from(binding.group.match(/../g), v => parseInt(v, 16));
    const owner = Uint8Array.from(binding.owner.match(/../g), v => parseInt(v, 16));
    const lifetime = signal ? AbortSignal.any([signal, connection.signal]) : connection.signal;
    const current = () => { if (lifetime.aborted) throw fail(); };
    current(); await connection.authenticated(); current();
    if (await store.read('along-at-owners', binding.group)) throw fail();
    const persona = await store.read('candidate-persona', 'active');
    const held = await store.read('membership', binding.group);
    if (!persona || !held) throw fail();
    const evidenceScope = persona.value.origin === 'initial' ? 'persona-bootstrap' : 'enrollment-invitations';
    const evidenceKey = persona.value.origin === 'initial' ? 'initial' : binding.group + ':' + hex(persona.value.invitation.code);
    const evidence = await store.read(evidenceScope, evidenceKey); current();
    if (!evidence) throw fail();
    const identity = await loadLocalPersona({wasm, store, expectedGroup: group}); current();
    if (!identity || identity.member === binding.owner || identity.member !== hex(persona.value.record.subject)) throw fail();
    membership = openMembership(store, wasm, group, persona.value.record.subject);
    if (await membership.peerStatus(proof, owner) !== 'current') throw fail();
    const policy = await verifyCredentialPolicy(bytes, signature, {...binding, afterRevision: 0n, minimumGeneration: 1n});
    if (!policy.devices.includes(identity.member)) throw fail();
    await connection.authenticated(); current();
    const checks = [
      {scope: 'candidate-persona', key: 'active', expectedRevision: persona.revision},
      {scope: 'membership', key: binding.group, expectedRevision: held.revision},
      {scope: evidenceScope, key: evidenceKey, expectedRevision: evidence.revision},
    ];
    const guarded = {...store, compareAndSwapMany: (changes, options) => store.compareAndSwapMany([
      ...changes,
      {scope: 'along-at-owners', key: binding.group, expectedRevision: 0, value: {format: 1, ...binding}},
    ], {...options, checks})};
    const receipt = await openCredentialPolicyStore({store: guarded, ...binding}).establish(bytes, signature, {signal: lifetime});
    return Object.freeze({status: 'remote-owner-accepted', binding, policyStorageRevision: receipt.storageRevision});
  } catch { throw fail(); }
  finally { membership?.close(); }
}
