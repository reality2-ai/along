import {loadLocalATOwner} from './local-owner.mjs';
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openCredentialPolicyStore} from './policy-store.mjs';
import {credentialPolicyBytes} from './policy.mjs';
const fail = () => new Error('AT policy change unavailable');
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');

// Explicit owner action against the revision shown in the review UI. Device IDs
// are application grants, not TG membership proofs or permission to send a key.
export async function updateLocalATPolicy({wasm, store, expectedGroup, expectedRevision,
  devices, rotate = false, signal}) {
  try {
    if (store.capabilities?.transactionChecks !== true || !(expectedGroup instanceof Uint8Array)
        || expectedGroup.length !== 32 || typeof expectedRevision !== 'bigint'
        || expectedRevision < 1n || !Array.isArray(devices) || typeof rotate !== 'boolean') throw fail();
    const groupBytes = expectedGroup.slice(), group = hex(groupBytes), grants = devices.slice();
    const current = () => { if (signal?.aborted) throw fail(); };
    current();
    const anchor = await store.read('along-at-owners', group);
    const persona = await store.read('candidate-persona', 'active');
    const membership = await store.read('membership', group); current();
    if (!anchor || !persona || !membership) throw fail();
    const evidenceScope = persona.value.origin === 'initial' ? 'persona-bootstrap' : 'enrollment-invitations';
    const evidenceKey = persona.value.origin === 'initial' ? 'initial' : group + ':' + hex(persona.value.invitation.code);
    const evidence = await store.read(evidenceScope, evidenceKey); current();
    if (!evidence) throw fail();
    const owner = await loadLocalATOwner({wasm, store, expectedGroup: groupBytes, signal}); current();
    if (!owner) throw fail();
    const identity = await loadLocalPersona({wasm, store, expectedGroup: groupBytes}); current();
    if (!identity || identity.member !== owner.binding.owner) throw fail();
    const policies = openCredentialPolicyStore({store, ...owner.binding});
    const loaded = await policies.read({signal});
    if (loaded.status !== 'policy-loaded' || loaded.policy.revision !== expectedRevision) throw fail();
    const bytes = credentialPolicyBytes({...owner.binding, revision: expectedRevision + 1n,
      generation: loaded.policy.generation + (rotate ? 1n : 0n), devices: grants});
    const signature = await identity.sign(bytes); current();
    const checks = [
      {scope: 'along-at-owners', key: group, expectedRevision: anchor.revision},
      {scope: 'candidate-persona', key: 'active', expectedRevision: persona.revision},
      {scope: 'membership', key: group, expectedRevision: membership.revision},
      {scope: evidenceScope, key: evidenceKey, expectedRevision: evidence.revision},
    ];
    const guarded = {...store, compareAndSwapMany: (changes, options) => {
      if (changes.length !== 1 || changes[0].expectedRevision !== loaded.storageRevision) throw fail();
      return store.compareAndSwapMany(changes, {...options, checks});
    }};
    return await openCredentialPolicyStore({store: guarded, ...owner.binding}).update(bytes, signature, {signal});
  } catch { throw fail(); }
}
