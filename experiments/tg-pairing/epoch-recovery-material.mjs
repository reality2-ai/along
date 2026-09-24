// Trusted recovery controller only. This custody operation is not proof that a
// remote requester owns the named member key; the transport must establish that.
import {openMembership} from './membership.mjs';
import {certificateCodec} from './certificate.mjs';
import {epochKeyDigest, verifyEpochTransition} from './epoch-transition.mjs';
const fixed = (v, n) => v instanceof Uint8Array && v.length === n;
const hex = v => Array.from(v, b => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const fail = () => new Error('Recovery key material unavailable');

export async function loadEpochRecoveryMaterial({wasm, store, group, owner, currentEpoch, subject, certificate, epoch, check, sign, signal}) {
  if (!fixed(group, 32) || !fixed(owner, 32) || !fixed(subject, 32) || !fixed(certificate, 136)
      || typeof currentEpoch !== 'bigint' || currentEpoch < 1n || currentEpoch > 0xffffffffffffffffn
      || typeof epoch !== 'bigint' || epoch < 1n || epoch > currentEpoch) throw fail();
  group = group.slice(); owner = owner.slice(); subject = subject.slice(); certificate = certificate.slice();
  const groupId = hex(group), key = groupId + ':' + epoch, codec = certificateCodec(wasm);
  if (!codec.authentic(certificate, subject, group) || new DataView(certificate.buffer).getBigUint64(64) >= epoch) throw fail();
  const membership = openMembership(store, wasm, group, owner);
  let clear, payloadKey, integrityKey;
  const current = async () => {
    if (signal?.aborted) throw fail(); await check();
    if (!['current', 'stale'].includes(await membership.peerStatus(certificate, subject))) throw fail();
    if (signal?.aborted) throw fail();
  };
  try {
    await current();
    const standing = await store.read('membership', groupId);
    const prepared = await store.read('along-prepared-epoch-v1', key), value = prepared?.value;
    if (value?.format !== 1 || value.member !== hex(owner) || value.from !== epoch - 1n || value.to !== epoch
        || !fixed(value.iv, 12) || !fixed(value.ciphertext, 80)
        || !(value.wrappingKey instanceof CryptoKey) || value.wrappingKey.extractable
        || value.wrappingKey.type !== 'secret' || value.wrappingKey.algorithm.name !== 'AES-GCM'
        || value.wrappingKey.algorithm.length !== 256 || value.wrappingKey.usages.length !== 2
        || !['encrypt', 'decrypt'].every(u => value.wrappingKey.usages.includes(u))
        || !codec.authentic(value.certificate, owner, group)
        || !same(value.certificate.slice(0, 72), codec.signingBytes(owner, group, epoch))) throw fail();
    const transition = await verifyEpochTransition({bytes: value.transition, expectedGroup: group, currentEpoch: epoch - 1n});
    clear = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: value.iv,
      additionalData: new TextEncoder().encode(JSON.stringify(['along/prepared-epoch/v1', groupId, hex(owner), epoch.toString()]))}, value.wrappingKey, value.ciphertext));
    if (clear.length !== 64 || !same(await epochKeyDigest(clear.subarray(0, 32), clear.subarray(32)), transition.keyDigest)) throw fail();
    await current();
    const signature = await sign(codec.signingBytes(subject, group, epoch));
    const renewed = codec.encode(subject, group, epoch, signature);
    await current();
    if ((await store.read('along-prepared-epoch-v1', key))?.revision !== prepared.revision
        || (await store.read('membership', groupId))?.revision !== standing.revision) throw fail();
    await current();
    payloadKey = clear.slice(0, 32); integrityKey = clear.slice(32);
    return Object.freeze({epoch, transition: value.transition.slice(), certificate: renewed, payloadKey, integrityKey,
      destroy: () => { payloadKey.fill(0); integrityKey.fill(0); }});
  } catch { payloadKey?.fill(0); integrityKey?.fill(0); throw fail(); }
  finally { clear?.fill(0); membership.close(); }
}
