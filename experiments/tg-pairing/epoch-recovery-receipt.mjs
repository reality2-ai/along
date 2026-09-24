import {loadLocalPersona} from './local-persona.mjs';
import {verifyEpochTransition} from './epoch-transition.mjs';
const fixed = (v, n) => v instanceof Uint8Array && v.length === n;
const hex = v => Array.from(v, b => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => fixed(a, b.length) && a.every((v, i) => v === b[i]);
const fail = () => new Error('Recovery receipt unavailable');

export async function recoveryReceiptStatement({group, subject, epoch, transition, certificate}) {
  if (!fixed(group, 32) || !fixed(subject, 32) || !fixed(transition, 152) || !fixed(certificate, 136)
      || typeof epoch !== 'bigint' || epoch < 1n || epoch > 0xffffffffffffffffn) throw fail();
  const message = new Uint8Array(112), bound = new Uint8Array(288);
  message.set(new TextEncoder().encode('ALNGERA1')); message.set(group, 8); message.set(subject, 40);
  new DataView(message.buffer).setBigUint64(72, epoch);
  bound.set(transition); bound.set(certificate, 152);
  message.set(new Uint8Array(await crypto.subtle.digest('SHA-256', bound)), 80); return message;
}

export async function saveRecoveryReceipt({wasm, store, group, subject, epoch, transition, certificate, nonce, signature, signal}) {
  if (!fixed(nonce, 16) || !fixed(signature, 64)) throw fail();
  const value = structuredClone({format: 1, group, subject, epoch, transition, certificate, nonce, signature});
  const statement = await recoveryReceiptStatement(value);
  await verifyEpochTransition({bytes: value.transition, expectedGroup: value.group, currentEpoch: epoch - 1n});
  const keyBytes = new Uint8Array(64); keyBytes.set(value.group); keyBytes.set(value.subject, 32);
  const key = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', keyBytes))) + ':' + epoch;
  const groupId = hex(value.group), scope = 'along-epoch-delivery-v1';
  for (let attempt = 0; attempt < 8; attempt++) {
    if (signal?.aborted) throw fail();
    const persona = await store.read('candidate-persona', 'active'), membership = await store.read('membership', groupId);
    const identity = await loadLocalPersona({wasm, store, expectedGroup: value.group});
    if (identity?.origin !== 'initial' || identity.epoch < epoch) throw fail();
    const verifier = wasm.BrowserMembership.establish(value.group, epoch, 0n);
    try {
      for (const r of membership.value.revocations) if (!verifier.apply_revocation(r.subject, r.epoch, r.sequence, r.reason, r.signature)) throw fail();
      if (!verifier.verify_nonce(value.certificate, value.subject, statement, value.nonce, value.signature)) throw fail();
    } finally { verifier.free(); }
    const prior = await store.read(scope, key);
    if (prior && (prior.value?.format !== 1 || !same(prior.value.transition, value.transition)
        || !same(prior.value.certificate, value.certificate))) throw fail();
    const result = await store.compareAndSwapMany([{scope, key, expectedRevision: prior?.revision ?? 0, value}], {signal, checks: [
      {scope: 'candidate-persona', key: 'active', expectedRevision: persona.revision},
      {scope: 'membership', key: groupId, expectedRevision: membership.revision},
    ]});
    if (result.applied) return Object.freeze({status: 'peer-installation-confirmed', epoch});
  }
  throw fail();
}

// Read-only evidence for one named device and version. Absence is distinct from
// unreadable/invalid evidence. A confirmation is historical, not online presence.
export async function readRecoveryReceipt({wasm, store, group: inputGroup, subject: inputSubject, epoch, signal}) {
  if (!fixed(inputGroup, 32) || !fixed(inputSubject, 32) || typeof epoch !== 'bigint'
      || epoch < 1n || epoch > 0xffffffffffffffffn) throw fail();
  const group = inputGroup.slice(), subject = inputSubject.slice(), groupId = hex(group);
  const live = () => { if (signal?.aborted) throw fail(); }; live();
  const keyBytes = new Uint8Array(64); keyBytes.set(group); keyBytes.set(subject, 32);
  const key = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', keyBytes))) + ':' + epoch;
  const scope = 'along-epoch-delivery-v1';
  const persona = await store.read('candidate-persona', 'active'), membership = await store.read('membership', groupId);
  const identity = await loadLocalPersona({wasm, store, expectedGroup: group}); live();
  if (identity?.origin !== 'initial' || identity.epoch < epoch) throw fail();
  const saved = await store.read(scope, key);
  const checks = [['candidate-persona', 'active', persona?.revision], ['membership', groupId, membership?.revision], [scope, key, saved?.revision]];
  if (saved) {
    const value = saved.value;
    if (value?.format !== 1 || value.epoch !== epoch || !same(value.group, group) || !same(value.subject, subject)
        || !fixed(value.nonce, 16) || !fixed(value.signature, 64)) throw fail();
    const statement = await recoveryReceiptStatement(value);
    await verifyEpochTransition({bytes: value.transition, expectedGroup: group, currentEpoch: epoch - 1n});
    const preparedKey = groupId + ':' + epoch;
    const prepared = await store.read('along-prepared-epoch-v1', preparedKey);
    if (!same(prepared?.value?.transition, value.transition)) throw fail();
    checks.push(['along-prepared-epoch-v1', preparedKey, prepared?.revision]);
    const verifier = wasm.BrowserMembership.establish(group, epoch, 0n);
    try {
      for (const r of membership.value.revocations) if (!verifier.apply_revocation(r.subject, r.epoch, r.sequence, r.reason, r.signature)) throw fail();
      if (!verifier.verify_nonce(value.certificate, subject, statement, value.nonce, value.signature)) throw fail();
    } finally { verifier.free(); }
  }
  for (const [scope, key, revision] of checks) {
    if ((await store.read(scope, key))?.revision !== revision) throw fail(); live();
  }
  return saved ? Object.freeze({status: 'peer-installation-confirmed', epoch}) : null;
}
