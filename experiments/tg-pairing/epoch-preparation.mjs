// Durable preparation only: no membership advance or delivery permission.
import {certificateCodec} from './certificate.mjs';
import {epochKeyDigest, epochTransitionStatement, encodeEpochTransition, verifyEpochTransition} from './epoch-transition.mjs';
const scope = 'along-prepared-epoch-v1';
const bytes = (v, n) => v instanceof Uint8Array && v.length === n;
const hex = v => Array.from(v, b => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const fail = () => new Error('Group-key preparation unavailable; a committed preparation may already exist');
const aad = (group, member, epoch) => new TextEncoder().encode(JSON.stringify(['along/prepared-epoch/v1', group, member, epoch.toString()]));

// Called with a custody-scoped signer and its revision guards, never a UI signer.
// Only the committed public transition is returned, never provisional key bytes.
export async function prepareEpoch({wasm, store, group, subject, from, sign, check, guards, signal}) {
  if (!bytes(group, 32) || !bytes(subject, 32) || from !== 0n
      || store.capabilities?.transactionChecks !== true) throw fail();
  group = group.slice(); subject = subject.slice();
  const groupId = hex(group), member = hex(subject), to = from + 1n;
  const key = groupId + ':' + to, codec = certificateCodec(wasm);
  const current = async () => { if (signal?.aborted) throw fail(); await check(); if (signal?.aborted) throw fail(); };
  const validate = async value => {
    let clear;
    try {
      if (value?.format !== 1 || value.member !== member || value.from !== from || value.to !== to
          || !bytes(value.iv, 12) || !bytes(value.ciphertext, 80)
          || !(value.wrappingKey instanceof CryptoKey) || value.wrappingKey.extractable
          || value.wrappingKey.type !== 'secret' || value.wrappingKey.algorithm.name !== 'AES-GCM'
          || value.wrappingKey.algorithm.length !== 256 || value.wrappingKey.usages.length !== 2
          || !['encrypt', 'decrypt'].every(u => value.wrappingKey.usages.includes(u))
          || !codec.authentic(value.certificate, subject, group)
          || !same(value.certificate.slice(0, 72), codec.signingBytes(subject, group, to))) throw fail();
      const transition = await verifyEpochTransition({bytes: value.transition, expectedGroup: group, currentEpoch: from});
      clear = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: value.iv,
        additionalData: aad(groupId, member, to)}, value.wrappingKey, value.ciphertext));
      if (clear.length !== 64 || !same(transition.keyDigest,
          await epochKeyDigest(clear.subarray(0, 32), clear.subarray(32)))) throw fail();
      await current();
    } finally { clear?.fill(0); }
  };
  let proposed, clear;
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      await current();
      const held = await store.read(scope, key);
      if (held) {
        await validate(held.value);
        if ((await store.read(scope, key))?.revision !== held.revision) continue;
        return Object.freeze({status: 'prepared-locally', from, to, transition: held.value.transition.slice(), delivered: false});
      }
      const persona = await store.read('candidate-persona', 'active');
      const membership = await store.read('membership', groupId);
      if (persona?.value?.epoch !== from || membership?.value?.current !== from) throw fail();
      if (!proposed) {
        clear = crypto.getRandomValues(new Uint8Array(64));
        const keyDigest = await epochKeyDigest(clear.subarray(0, 32), clear.subarray(32));
        const fields = {group, from, to, keyDigest};
        const transition = encodeEpochTransition(fields, await sign(epochTransitionStatement(fields)));
        const certificate = codec.encode(subject, group, to, await sign(codec.signingBytes(subject, group, to)));
        const wrappingKey = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv,
          additionalData: aad(groupId, member, to)}, wrappingKey, clear));
        clear.fill(0); clear = undefined;
        proposed = {format: 1, member, from, to, transition, certificate, wrappingKey, iv, ciphertext};
        await validate(proposed);
      }
      await current();
      const result = await store.compareAndSwapMany([{scope, key, expectedRevision: 0, value: proposed}],
        {signal, checks: [...guards,
          {scope: 'candidate-persona', key: 'active', expectedRevision: persona.revision},
          {scope: 'membership', key: groupId, expectedRevision: membership.revision}]});
      // Re-read and authenticate the winner, also after our successful commit.
      // A cancellation here cannot undo the retained preparation.
      if (result.applied) proposed = undefined;
    }
    throw fail();
  } catch { throw fail(); } finally { clear?.fill(0); }
}
