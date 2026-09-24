// Restore local enrollment custody only. This does not establish initial trust,
// fresh membership, peer acknowledgment, or permission to use application secrets.
import {certificateCodec} from './certificate.mjs';
import {openMembership} from './membership.mjs';
const bytes = (value, length) => value instanceof Uint8Array && value.length === length;
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const refuse = () => new Error('Local persona unavailable');

export async function loadLocalPersona({wasm, store, expectedGroup}) {
  if (!bytes(expectedGroup, 32)) throw refuse();
  const group = expectedGroup.slice(); // Established by the caller, never adopted from storage.
  const saved = await store.read('candidate-persona', 'active');
  if (!saved || saved.value === null) return null;
  const value = saved.value, record = value.record;
  const initial = value.origin === 'initial';
  if (value.format !== 1 || (initial ? value.claim !== 'open' : value.claim !== 'owner') || record?.format !== 1
      || (value.peerAcknowledged !== undefined && typeof value.peerAcknowledged !== 'boolean')
      || record.custody !== 'browser-nonextractable-unqualified'
      || !bytes(record.group, 32) || !equal(record.group, group)
      || !bytes(record.subject, 32) || !bytes(record.certificate, 136)
      || (!initial && (!bytes(value.invitation?.group, 32) || !equal(value.invitation.group, group)
        || !bytes(value.invitation?.code, 16)))
      || !(record.privateKey instanceof CryptoKey) || record.privateKey.type !== 'private'
      || record.privateKey.extractable || record.privateKey.algorithm.name !== 'Ed25519'
      || record.privateKey.usages.length !== 1 || record.privateKey.usages[0] !== 'sign') throw refuse();
  const codec = certificateCodec(wasm);
  if (!codec.authentic(record.certificate, record.subject, group)
      || !equal(record.certificate.slice(0, 72), codec.signingBytes(record.subject, group, value.epoch))) throw refuse();
  const journalScope = initial ? 'persona-bootstrap' : 'enrollment-invitations';
  const journalKey = initial ? 'initial' : hex(group) + ':' + hex(value.invitation.code);
  const journal = await store.read(journalScope, journalKey);
  if (journal?.value?.format !== 1 || (initial
      ? !bytes(journal.value.group, 32) || !equal(journal.value.group, group)
        || !bytes(journal.value.subject, 32) || !equal(journal.value.subject, record.subject)
      : journal.value.state !== 'consumed')) throw refuse();
  const current = async () => {
    const latest = await store.read('candidate-persona', 'active');
    const used = await store.read(journalScope, journalKey);
    if (latest?.revision !== saved.revision || used?.revision !== journal.revision) throw refuse();
    // Check authenticated local epoch/revocation evidence each time. This is
    // still not proof of freshness after an offline interval or a grant.
    const membership = openMembership(store, wasm, group, record.subject);
    try { await membership.sessionContext(); } finally { membership.close(); }
  };
  const publicKey = await crypto.subtle.importKey('raw', record.subject, 'Ed25519', false, ['verify']);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const proof = await crypto.subtle.sign('Ed25519', record.privateKey, challenge);
  if (!await crypto.subtle.verify('Ed25519', publicKey, proof, challenge)) throw refuse();
  await current();
  return Object.freeze({
    status: 'installed-local', provenance: 'loaded-from-storage',
    origin: initial ? 'initial' : 'enrolled', issuerAvailable: false, claim: value.claim,
    peerAcknowledged: value.peerAcknowledged === true,
    member: hex(record.subject), group: hex(group), epoch: value.epoch,
    // Trusted runtime supplies canonical protocol bytes and authorization.
    sign: async message => {
      if (!(message instanceof Uint8Array) || message.length > 1024 * 1024) throw refuse();
      const snapshot = message.slice(); await current();
      const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', record.privateKey, snapshot));
      await current(); return signature;
    },
  });
}
