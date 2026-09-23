import {verifyCredentialPolicy} from './policy.mjs';
const domain = new TextEncoder().encode('along/at-key/v1\0');
const fail = () => new Error('AT credential delivery unavailable');
const fixed = (value, length) => value instanceof Uint8Array && value.length === length;
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const token = value => typeof value === 'string' && /^[\x21-\x7e]{1,512}$/.test(value);
const prefix = domain.length + 16 + 32 + 4;

// Plaintext application message: only send inside the encrypted, mutually
// authenticated owner/device channel. Never log, cache, or put it in an invite.
export async function encodeCredentialDelivery({nonce, recipient, policyBytes, policySignature, key, sign}) {
  let body;
  try {
    if (!fixed(nonce, 16) || !fixed(recipient, 32) || !(policyBytes instanceof Uint8Array)
        || !policyBytes.length || policyBytes.length > 2048 || !fixed(policySignature, 64)
        || !token(key) || typeof sign !== 'function') throw fail();
    body = new Uint8Array(prefix + policyBytes.length + 64 + key.length);
    if (body.length + 64 > 2048) throw fail();
    body.set(domain); body.set(nonce, domain.length); body.set(recipient, domain.length + 16);
    const lengths = new DataView(body.buffer);
    lengths.setUint16(prefix - 4, policyBytes.length); lengths.setUint16(prefix - 2, key.length);
    body.set(policyBytes, prefix); body.set(policySignature, prefix + policyBytes.length);
    for (let i = 0; i < key.length; i++) body[prefix + policyBytes.length + 64 + i] = key.charCodeAt(i);
    const signature = await sign(body.slice());
    if (!fixed(signature, 64)) throw fail();
    const packet = new Uint8Array(body.length + 64); packet.set(body); packet.set(signature, body.length);
    return packet;
  } catch { throw fail(); } finally { body?.fill(0); }
}

// Caller pins owner/group/credential and floors before receipt, supplies the
// current request nonce, and must consume that nonce atomically on installation.
export async function verifyCredentialDelivery(packet, {nonce, recipient, ...expected}) {
  let snapshot;
  try {
    if (!(packet instanceof Uint8Array) || packet.length > 2048 || packet.length < prefix + 130
        || !fixed(nonce, 16) || !fixed(recipient, 32)) throw fail();
    snapshot = packet.slice(); const request = nonce.slice(), device = recipient.slice(), binding = {...expected};
    if (!same(snapshot.slice(0, domain.length), domain)
        || !same(snapshot.slice(domain.length, domain.length + 16), request)
        || !same(snapshot.slice(domain.length + 16, prefix - 4), device)) throw fail();
    const lengths = new DataView(snapshot.buffer), policyLength = lengths.getUint16(prefix - 4), keyLength = lengths.getUint16(prefix - 2);
    if (!policyLength || keyLength < 1 || keyLength > 512 || snapshot.length !== prefix + policyLength + keyLength + 128) throw fail();
    const policyBytes = snapshot.slice(prefix, prefix + policyLength);
    const policySignature = snapshot.slice(prefix + policyLength, prefix + policyLength + 64);
    const policy = await verifyCredentialPolicy(policyBytes, policySignature, binding);
    if (!policy.devices.includes(hex(device))) throw fail();
    const publicKey = await crypto.subtle.importKey('raw', Uint8Array.from(policy.owner.match(/../g), v => parseInt(v, 16)), 'Ed25519', false, ['verify']);
    if (!await crypto.subtle.verify('Ed25519', publicKey, snapshot.slice(-64), snapshot.subarray(0, -64))) throw fail();
    const key = new TextDecoder('utf-8', {fatal: true}).decode(snapshot.subarray(prefix + policyLength + 64, -64));
    if (!token(key)) throw fail();
    return {policy, policyBytes, policySignature, key}; // Trusted atomic installer only.
  } catch { throw fail(); } finally { snapshot?.fill(0); }
}
