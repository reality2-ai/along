// Typed JS boundary around hive-wasm's actual r2-trust certificate codec.
// A valid certificate alone never grants current membership or application access.
const bytes = (value, length) => value instanceof Uint8Array && value.length === length;
const epochValid = epoch => typeof epoch === 'bigint' && epoch >= 0n && epoch <= 0xffffffffffffffffn;
export function certificateCodec(wasm) {
  return Object.freeze({
    signingBytes(subject, group, epoch) {
      // wasm-bindgen converts u64 modulo 2^64. Refuse overflow/negative values
      // here rather than silently signing a different epoch from the caller's.
      if (!bytes(subject, 32) || !bytes(group, 32) || !epochValid(epoch)) throw new TypeError('Invalid certificate identity or epoch');
      const result = wasm.tg_certificate_signing_bytes(subject, group, epoch);
      if (!bytes(result, 72)) throw new Error('Certificate codec refused');
      return result;
    },
    encode(subject, group, epoch, signature) {
      if (!bytes(subject, 32) || !bytes(group, 32) || !epochValid(epoch) || !bytes(signature, 64)) throw new TypeError('Invalid certificate fields');
      const result = wasm.tg_certificate_encode(subject, group, epoch, signature);
      if (!bytes(result, 136)) throw new Error('Certificate signature refused');
      return result;
    },
    authentic(certificate, subject, expectedGroup) {
      return bytes(certificate, 136) && bytes(subject, 32) && bytes(expectedGroup, 32)
        && wasm.tg_certificate_authentic(certificate, subject, expectedGroup);
    },
  });
}
