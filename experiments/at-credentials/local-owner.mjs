// Explicit local owner establishment, not an incoming-message handler. This
// binds Along authority; it does not change TG claim state or issue membership.
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {credentialPolicyBytes} from './policy.mjs';
import {openCredentialPolicyStore} from './policy-store.mjs';
import {openMembership} from '../tg-pairing/membership.mjs';
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const fail = () => new Error('Local AT owner unavailable');
// Restore an already accepted local/remote binding without adopting an owner
// from an incoming message or automatically initializing absent state.
async function loadBinding({wasm, store, expectedGroup, signal}, allowStaleOwner) {
  let renewalNeeded = false;
  try {
    if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) throw fail();
    const groupBytes = expectedGroup.slice(), group = hex(groupBytes);
    const current = () => { if (signal?.aborted) throw fail(); };
    current();
    const anchor = await store.read('along-at-owners', group); current();
    if (!anchor) return null;
    const persona = await store.read('candidate-persona', 'active');
    const membership = await store.read('membership', group); current();
    if (!persona || !membership) throw fail();
    const evidenceScope = persona.value.origin === 'initial' ? 'persona-bootstrap' : 'enrollment-invitations';
    const evidenceKey = persona.value.origin === 'initial' ? 'initial' : group + ':' + hex(persona.value.invitation.code);
    const evidence = await store.read(evidenceScope, evidenceKey); current();
    if (!evidence) throw fail();
    const identity = await loadLocalPersona({wasm, store, expectedGroup: groupBytes}); current();
    if (!identity || !persona || !membership || anchor.value?.format !== 1
        || anchor.value.group !== group
        || hex(persona.value.record.subject) !== identity.member) throw fail();
    const binding = Object.freeze({group, owner: anchor.value.owner, credential: anchor.value.credential});
    const policy = await openCredentialPolicyStore({store, ...binding}).read({signal}); current();
    if (policy.status !== 'policy-loaded') throw fail();
    const role = binding.owner === identity.member ? 'owner' : 'recipient';
    if (role === 'recipient') {
      const membership = openMembership(store, wasm, groupBytes, persona.value.record.subject);
      try {
        const owner = Uint8Array.from(binding.owner.match(/../g), v => parseInt(v, 16));
        const standing = await membership.peerStatus(anchor.value.ownerCertificate, owner);
        if (standing !== 'current' && !(allowStaleOwner && standing === 'stale')) throw fail();
        renewalNeeded = standing === 'stale';
      } finally { membership.close(); }
    }
    for (const [scope, key, revision] of [
      ['along-at-owners', group, anchor.revision],
      ['candidate-persona', 'active', persona.revision],
      ['membership', group, membership.revision],
      [evidenceScope, evidenceKey, evidence.revision],
      ['along-at-policy:' + binding.owner, group + ':' + binding.credential, policy.storageRevision],
    ]) {
      current(); const saved = await store.read(scope, key); current();
      if (saved?.revision !== revision) throw fail();
    }
    return Object.freeze({status: renewalNeeded ? 'at-owner-renewal-needed' : 'at-binding-loaded', binding, role});
  } catch { throw fail(); }
}
// Connection review only: a stale certificate never authorizes a provider read.
export const loadATConnectionBinding = options => loadBinding(options, true);
export const loadATBinding = options => loadBinding(options, false);
export async function loadLocalATOwner(options) {
  const saved = await loadATBinding(options);
  if (!saved) return null;
  if (saved.role !== 'owner') throw fail();
  return Object.freeze({status: 'local-owner-loaded', binding: saved.binding});
}
export async function establishLocalATOwner({wasm, store, expectedGroup, signal}) {
  if (store.capabilities?.transactionChecks !== true || !(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) throw fail();
  const groupBytes = expectedGroup.slice(), group = hex(groupBytes);
  const current = () => { if (signal?.aborted) throw fail(); };
  current();
  const saved = await store.read('candidate-persona', 'active');
  const existing = await store.read('along-at-owners', group); current();
  if (!saved || existing) throw fail();
  const identity = await loadLocalPersona({wasm, store, expectedGroup: groupBytes}); current();
  if (!identity || identity.member !== hex(saved.value.record.subject)) throw fail();
  const membership = await store.read('membership', group);
  const evidenceScope = identity.origin === 'initial' ? 'persona-bootstrap' : 'enrollment-invitations';
  const evidenceKey = identity.origin === 'initial' ? 'initial' : group + ':' + hex(saved.value.invitation.code);
  const evidence = await store.read(evidenceScope, evidenceKey); current();
  if (!membership || !evidence) throw fail();
  const binding = Object.freeze({group, owner: identity.member, credential: hex(crypto.getRandomValues(new Uint8Array(16)))});
  const bytes = credentialPolicyBytes({...binding, revision: 1n, generation: 1n, devices: [identity.member]});
  const signature = await identity.sign(bytes); current();
  const checks = [
    {scope: 'candidate-persona', key: 'active', expectedRevision: saved.revision},
    {scope: 'membership', key: group, expectedRevision: membership.revision},
    {scope: evidenceScope, key: evidenceKey, expectedRevision: evidence.revision},
  ];
  // Couple owner pinning to policy acceptance without rewriting the persona or
  // membership records whose signatures were checked. Older runtimes refuse
  // above rather than silently ignoring these read-only checks.
  const atomic = {...store, compareAndSwapMany: (changes, options) => store.compareAndSwapMany([
    ...changes,
    {scope: 'along-at-owners', key: group, expectedRevision: 0, value: {format: 1, ...binding}},
  ], {...options, checks})};
  const receipt = await openCredentialPolicyStore({store: atomic, ...binding}).establish(bytes, signature, {signal});
  return Object.freeze({status: 'local-owner-saved', binding, policy: receipt.policy,
    policyStorageRevision: receipt.storageRevision});
}
