// Atomic local advancement. Authenticated delivery and reviewed controls remain
// separate; no app rotation UI is mounted yet.
import {loadLocalPersona} from './local-persona.mjs';
import {certificateCodec} from './certificate.mjs';
import {prepareSoftwareTraffic, loadSoftwareTraffic} from './software-traffic.mjs';
import {epochKeyDigest, verifyEpochTransition} from './epoch-transition.mjs';
import {announceEpochChange} from './epoch-watch.mjs';
const receiptScope = 'along-installed-epoch-v1';
const fixed = (v, n) => v instanceof Uint8Array && v.length === n;
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const hex = v => Array.from(v, b => b.toString(16).padStart(2, '0')).join('');
const fail = () => new Error('Group-key installation unavailable; check retained state before retrying');

export const installRecipientEpoch = options => installEpoch(options, false);

async function installEpoch({wasm, store, expectedGroup, transition, certificate, payloadKey, integrityKey, signal}, initial, guards = []) {
  if (!fixed(expectedGroup, 32) || !fixed(transition, 152) || !fixed(certificate, 136)
      || !fixed(payloadKey, 32) || !fixed(integrityKey, 32)
      || store.capabilities?.transactionChecks !== true) throw fail();
  const group = expectedGroup.slice(), message = transition.slice(), cert = certificate.slice();
  const payload = payloadKey.slice(), integrity = integrityKey.slice(), groupId = hex(group);
  const current = () => { if (signal?.aborted) throw fail(); };
  try {
    current();
    const from = new DataView(message.buffer).getBigUint64(40);
    const verified = await verifyEpochTransition({bytes: message, expectedGroup: group, currentEpoch: from});
    if (!same(await epochKeyDigest(payload, integrity), verified.keyDigest)) throw fail();
    current();
    const saved = await store.read('candidate-persona', 'active');
    const standing = await store.read('membership', groupId);
    const traffic = await store.read('along-browser-traffic', groupId);
    const persona = await loadLocalPersona({wasm, store, expectedGroup: group});
    if (!persona || persona.origin !== (initial ? 'initial' : 'enrolled')
        || (!traffic && !(initial && persona.epoch === 0n)) || !standing
        || persona.epoch !== standing.value.current || saved.value.epoch !== persona.epoch) throw fail();
    const subject = saved.value.record.subject, codec = certificateCodec(wasm);
    if (!codec.authentic(cert, subject, group)
        || !same(cert.slice(0, 72), codec.signingBytes(subject, group, verified.to))) throw fail();
    const key = groupId + ':' + verified.to;
    const receipt = await store.read(receiptScope, key);
    if (persona.epoch === verified.to) {
      if (receipt?.value?.format !== 1 || receipt.value.member !== persona.member
          || !fixed(receipt.value.transition, 152) || !same(receipt.value.transition, message)
          || !fixed(receipt.value.certificate, 136) || !same(receipt.value.certificate, cert)
          || !same(saved.value.record.certificate, cert)) throw fail();
      const held = await loadSoftwareTraffic({wasm, store, expectedGroup: group, signal});
      try { if (!same(await epochKeyDigest(held.payloadKey, held.integrityKey), verified.keyDigest)) throw fail(); }
      finally { held.destroy(); }
      current();
      try { await announceEpochChange(group); } catch { /* retained commit remains authoritative */ }
      return Object.freeze({status: 'installed-local', epoch: verified.to, alreadyInstalled: true});
    }
    if (persona.epoch !== from || receipt) throw fail();
    const journalScope = initial ? 'persona-bootstrap' : 'enrollment-invitations';
    const journalKey = initial ? 'initial' : groupId + ':' + hex(saved.value.invitation.code);
    const journal = await store.read(journalScope, journalKey);
    if (!journal || (!initial && journal.value.state !== 'consumed')) throw fail();
    // Retain all terminal removals and verify the new certificate against them.
    const state = wasm.BrowserMembership.establish(group, verified.to, standing.value.depth);
    try {
      for (const r of standing.value.revocations) {
        if (!state.apply_revocation(r.subject, r.epoch, r.sequence, r.reason, r.signature)) throw fail();
      }
      if (state.status(cert, subject) !== 'current') throw fail();
    } finally { state.free(); }
    const encrypted = await prepareSoftwareTraffic({group, subject, epoch: verified.to,
      payloadKey: payload, integrityKey: integrity, signal});
    current();
    const result = await store.compareAndSwapMany([
      {scope: 'candidate-persona', key: 'active', expectedRevision: saved.revision,
        value: {...saved.value, epoch: verified.to, record: {...saved.value.record, certificate: cert}}},
      {scope: 'membership', key: groupId, expectedRevision: standing.revision,
        value: {...standing.value, current: verified.to, certificate: cert}},
      {...encrypted, expectedRevision: traffic?.revision ?? 0},
      {scope: receiptScope, key, expectedRevision: 0,
        value: {format: 1, member: persona.member, transition: message, certificate: cert}},
    ], {signal, checks: [...guards, {scope: journalScope, key: journalKey, expectedRevision: journal.revision}]});
    if (!result.applied) throw fail();
    try { await announceEpochChange(group); } catch { /* commit remains authoritative */ }
    // A committed result remains true even if cancellation arrives afterwards.
    return Object.freeze({status: 'installed-local', epoch: verified.to, alreadyInstalled: false});
  } catch { throw fail(); } finally { payload.fill(0); integrity.fill(0); }
}

// Explicit target allows retry of an already committed preparation without
// accidentally preparing/advancing another epoch. No raw keys leave this API.
export async function installPreparedIssuerEpoch({wasm, store, expectedGroup, epoch, signal}) {
  if (!fixed(expectedGroup, 32) || typeof epoch !== 'bigint' || epoch < 1n || epoch > 0xffffffffffffffffn) throw fail();
  const group = expectedGroup.slice(), groupId = hex(group), key = groupId + ':' + epoch;
  let issuer, clear;
  try {
    const {loadSoftwareIssuer} = await import('./software-persona.mjs');
    issuer = await loadSoftwareIssuer({wasm, store, expectedGroup: group, signal});
    const custody = await store.read('along-browser-issuer', groupId);
    const held = await store.read('along-prepared-epoch-v1', key), value = held?.value;
    if (value?.format !== 1 || value.member !== issuer.member || value.from !== epoch - 1n || value.to !== epoch
        || !fixed(value.iv, 12) || !fixed(value.ciphertext, 80)
        || !(value.wrappingKey instanceof CryptoKey) || value.wrappingKey.extractable
        || value.wrappingKey.type !== 'secret' || value.wrappingKey.algorithm.name !== 'AES-GCM'
        || value.wrappingKey.algorithm.length !== 256) throw fail();
    clear = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: value.iv,
      additionalData: new TextEncoder().encode(JSON.stringify(['along/prepared-epoch/v1', groupId, issuer.member, epoch.toString()]))}, value.wrappingKey, value.ciphertext));
    if (clear.length !== 64) throw fail();
    return await installEpoch({wasm, store, expectedGroup: group, transition: value.transition,
      certificate: value.certificate, payloadKey: clear.subarray(0, 32), integrityKey: clear.subarray(32), signal}, true,
    [{scope: 'along-prepared-epoch-v1', key, expectedRevision: held.revision},
      {scope: 'along-browser-issuer', key: groupId, expectedRevision: custody.revision}]);
  } catch { throw fail(); } finally { issuer?.close(); clear?.fill(0); }
}
