// Along browser-only profile: encrypted software storage, not hardware sealing.
import {loadLocalPersona} from './local-persona.mjs';
const scope = 'along-browser-traffic';
const bytes = (value, n) => value instanceof Uint8Array && value.length === n;
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const validEpoch = value => typeof value === 'bigint' && value >= 0n && value <= 0xffffffffffffffffn;
const fail = () => new Error('Browser group material unavailable');
const aad = (group, member, epoch) => new TextEncoder().encode(JSON.stringify(['along/software-traffic/v1', group, member, epoch.toString()]));
const current = signal => { if (signal?.aborted) throw fail(); };
// Returns a write for the SAME atomic installation transaction. Never save it
// independently of the member, membership and consumed invitation.
export async function prepareSoftwareTraffic({group, subject, epoch, payloadKey, integrityKey, signal}) {
  let plaintext;
  try {
    if (!bytes(group, 32) || !bytes(subject, 32) || !validEpoch(epoch)
        || !bytes(payloadKey, 32) || !bytes(integrityKey, 32)) throw fail();
    const groupId = hex(group), member = hex(subject);
    plaintext = new Uint8Array(64); plaintext.set(payloadKey); plaintext.set(integrityKey, 32);
    current(signal);
    const wrappingKey = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12)); current(signal);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv,
      additionalData: aad(groupId, member, epoch)}, wrappingKey, plaintext)); current(signal);
    return {scope, key: groupId, expectedRevision: 0,
      value: {format: 1, profile: 'along-browser-software-v1', member, epoch, wrappingKey, iv, ciphertext}};
  } catch { throw fail(); } finally { plaintext?.fill(0); }
}
// Trusted runtime only; returned bytes must be destroyed after use and restored
// again for a subsequent operation. A returned array is not a continuing grant.
export async function loadSoftwareTraffic({wasm, store, expectedGroup, signal}) {
  let plaintext;
  try {
    if (!bytes(expectedGroup, 32)) throw fail();
    const group = expectedGroup.slice(), groupId = hex(group); current(signal);
    const personaRecord = await store.read('candidate-persona', 'active');
    const membership = await store.read('membership', groupId);
    const persona = await loadLocalPersona({wasm, store, expectedGroup: group});
    const saved = await store.read(scope, groupId), value = saved?.value;
    if (!persona || persona.origin !== 'enrolled' || value?.format !== 1 || value.profile !== 'along-browser-software-v1'
        || value.member !== persona.member || !validEpoch(value.epoch) || value.epoch !== membership?.value?.current
        || value.epoch !== persona.epoch || !bytes(value.iv, 12) || !bytes(value.ciphertext, 80)
        || !(value.wrappingKey instanceof CryptoKey) || value.wrappingKey.type !== 'secret' || value.wrappingKey.extractable
        || value.wrappingKey.algorithm.name !== 'AES-GCM' || value.wrappingKey.algorithm.length !== 256
        || value.wrappingKey.usages.length !== 2 || !['encrypt', 'decrypt'].every(u => value.wrappingKey.usages.includes(u))) throw fail();
    current(signal);
    plaintext = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: value.iv,
      additionalData: aad(groupId, persona.member, value.epoch)}, value.wrappingKey, value.ciphertext));
    current(signal);
    // Verify current membership again and compare every storage fact used above.
    await loadLocalPersona({wasm, store, expectedGroup: group});
    for (const [s, key, revision] of [[scope, groupId, saved.revision],
      ['candidate-persona', 'active', personaRecord?.revision], ['membership', groupId, membership.revision]]) {
      if ((await store.read(s, key))?.revision !== revision) throw fail(); current(signal);
    }
    if (plaintext.length !== 64) throw fail();
    const payloadKey = plaintext.slice(0, 32), integrityKey = plaintext.slice(32);
    return Object.freeze({epoch: value.epoch, payloadKey, integrityKey,
      destroy: () => { payloadKey.fill(0); integrityKey.fill(0); }});
  } catch { throw fail(); } finally { plaintext?.fill(0); }
}
