// Renew membership evidence for an already pinned AT owner. This cannot choose
// an owner, grant policy access, change a credential, or install an AT key.
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openMembership} from '../tg-pairing/membership.mjs';
import {certificateCodec} from '../tg-pairing/certificate.mjs';
import {openCredentialPolicyStore} from './policy-store.mjs';
const fixed = (v, n) => v instanceof Uint8Array && v.length === n;
const hex = v => Array.from(v, b => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => fixed(a, b.length) && a.every((v, i) => v === b[i]);
const fail = () => new Error('Saved AT owner certificate renewal unavailable');
export async function renewATOwnerCertificate({wasm, store, expectedGroup, certificate, signal}) {
  if (!fixed(expectedGroup, 32) || !fixed(certificate, 136) || store.capabilities?.transactionChecks !== true) throw fail();
  const group = expectedGroup.slice(), proof = certificate.slice(), groupId = hex(group);
  const current = () => { if (signal?.aborted) throw fail(); }; current();
  const anchor = await store.read('along-at-owners', groupId); current();
  // No binding means there is nothing to renew. Never establish one implicitly.
  if (!anchor) return Object.freeze({status: 'no-at-owner-binding'});
  const value = anchor.value;
  if (value?.format !== 1 || value.group !== groupId) throw fail();
  const policyStore = openCredentialPolicyStore({store, group: value.group, owner: value.owner, credential: value.credential});
  const persona = await store.read('candidate-persona', 'active'), held = await store.read('membership', groupId);
  const identity = await loadLocalPersona({wasm, store, expectedGroup: group}); current();
  if (!identity || !persona || !held) throw fail();
  const evidenceScope = identity.origin === 'initial' ? 'persona-bootstrap' : 'enrollment-invitations';
  const evidenceKey = identity.origin === 'initial' ? 'initial' : groupId + ':' + hex(persona.value.invitation.code);
  const evidence = await store.read(evidenceScope, evidenceKey); current();
  if (!evidence) throw fail();
  if (identity.member === value.owner) return Object.freeze({status: 'local-at-owner'});
  const owner = Uint8Array.from(value.owner.match(/../g), b => parseInt(b, 16)), codec = certificateCodec(wasm);
  if (!fixed(value.ownerCertificate, 136) || !codec.authentic(value.ownerCertificate, owner, group)
      || !codec.authentic(proof, owner, group)) throw fail();
  const from = new DataView(value.ownerCertificate.buffer, value.ownerCertificate.byteOffset).getBigUint64(64);
  const to = new DataView(proof.buffer).getBigUint64(64);
  if (to < from || to !== identity.epoch) throw fail();
  const policy = await policyStore.read({signal});
  if (policy.status !== 'policy-loaded') throw fail();
  const membership = openMembership(store, wasm, group, persona.value.record.subject);
  try { if (await membership.peerStatus(proof, owner) !== 'current') throw fail(); }
  finally { membership.close(); }
  current();
  const checks = [
    {scope: 'candidate-persona', key: 'active', expectedRevision: persona.revision},
    {scope: 'membership', key: groupId, expectedRevision: held.revision},
    {scope: evidenceScope, key: evidenceKey, expectedRevision: evidence.revision},
    {scope: 'along-at-policy:' + value.owner, key: groupId + ':' + value.credential, expectedRevision: policy.storageRevision},
  ];
  if (same(value.ownerCertificate, proof)) {
    for (const {scope, key, expectedRevision} of [...checks, {scope: 'along-at-owners', key: groupId, expectedRevision: anchor.revision}]) {
      if ((await store.read(scope, key))?.revision !== expectedRevision) throw fail(); current();
    }
    return Object.freeze({status: 'at-owner-certificate-current', epoch: to});
  }
  const result = await store.compareAndSwapMany([{scope: 'along-at-owners', key: groupId,
    expectedRevision: anchor.revision, value: {...value, ownerCertificate: proof}}], {signal, checks});
  if (!result.applied) throw fail();
  return Object.freeze({status: 'at-owner-certificate-renewed', epoch: to});
}
