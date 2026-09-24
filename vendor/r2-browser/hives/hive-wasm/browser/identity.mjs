// Ed25519 device identity primitive for the browser hive. No enrollment or
// membership authority is implied by possessing this signing key.
import {BrowserStorageError} from './storage.mjs';
const scope = 'runtime-identity', key = 'device';
const fail = () => new BrowserStorageError('identity-unavailable');
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

async function validate(record) {
  const value = record?.value;
  if (!value || value.format !== 1 || !(value.privateKey instanceof CryptoKey) ||
      !(value.publicKey instanceof CryptoKey) || value.privateKey.type !== 'private' ||
      value.publicKey.type !== 'public' || value.privateKey.extractable ||
      value.privateKey.algorithm.name !== 'Ed25519' || value.publicKey.algorithm.name !== 'Ed25519' ||
      value.privateKey.usages.length !== 1 || value.privateKey.usages[0] !== 'sign' ||
      value.publicKey.usages.length !== 1 || value.publicKey.usages[0] !== 'verify') throw fail();
  try {
    const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', value.publicKey));
    if (publicBytes.length !== 32) throw fail();
    // Refuse mismatched/corrupt custody rather than adopting the public half.
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const signature = await crypto.subtle.sign('Ed25519', value.privateKey, challenge);
    if (!await crypto.subtle.verify('Ed25519', value.publicKey, signature, challenge)) throw fail();
    return {publicBytes, value};
  } catch { throw fail(); }
}

export async function loadDeviceIdentity(store) {
  const record = await store.read(scope, key);
  if (!record || record.value === null) return null;
  const {publicBytes, value} = await validate(record);
  const revision = record.revision, publicId = hex(publicBytes);
  const current = async () => {
    const latest = await store.read(scope, key);
    if (latest?.revision !== revision || latest.value === null) throw fail();
  };
  return Object.freeze({
    publicId,
    // No private key, seed or arbitrary persistence callback leaves this closure.
    // Caller must supply the canonical bytes of the actual runtime protocol.
    sign: async message => {
      if (!(message instanceof Uint8Array) || message.byteLength > 1024 * 1024) throw fail();
      const snapshot = message.slice();
      await current();
      const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', value.privateKey, snapshot));
      await current();
      return signature;
    },
    forget: async () => store.remove(scope, key, revision),
  });
}

// Only call for an explicit new-identity operation. Missing data on ordinary
// startup must not silently mint a replacement for a previously enrolled device.
export async function provisionDeviceIdentity(store) {
  const existing = await store.read(scope, key);
  if (existing) {
    if (existing.value === null) throw new BrowserStorageError('identity-forgotten');
    return loadDeviceIdentity(store);
  }
  let pair;
  try { pair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']); }
  catch { throw new BrowserStorageError('identity-unsupported'); }
  // Competing tabs may generate provisional keys, but only the committed winner
  // is returned or used. A losing key never becomes an externally visible ID.
  await store.compareAndSwap(scope, key, 0, {format: 1, privateKey: pair.privateKey, publicKey: pair.publicKey});
  const identity = await loadDeviceIdentity(store);
  if (!identity) throw fail();
  return identity;
}
