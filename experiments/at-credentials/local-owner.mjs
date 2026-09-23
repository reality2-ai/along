// Explicit local owner establishment, not an incoming-message handler. This
// binds Along authority; it does not change TG claim state or issue membership.
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {credentialPolicyBytes} from './policy.mjs';
import {openCredentialPolicyStore} from './policy-store.mjs';
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const fail = () => new Error('Local AT owner unavailable');
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
