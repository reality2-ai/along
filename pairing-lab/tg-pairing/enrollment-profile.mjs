// Along enrollment payload profile v1, not a normative R2 wire format.
// Structural/certificate validation only: no admission, custody or storage grant.
import {invitationStatement} from './invitation.mjs';
import {certificateCodec} from './certificate.mjs';
const text = new TextEncoder();
const CLAIM = text.encode('ALNGCLM1'), BUNDLE = text.encode('ALNGBND1');
const fixed = (v, n) => v instanceof Uint8Array && v.length === n;
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const epochValid = e => typeof e === 'bigint' && e >= 0n && e <= 0xffffffffffffffffn;
const statement = (wasm, invitation) => {
  if (invitation?.role !== 'member') throw new Error('Only ordinary-member payloads supported');
  return invitationStatement(wasm, invitation);
};
export function encodeClaim(wasm, invitation, subject) {
  if (!fixed(subject, 32)) throw new TypeError('Invalid candidate identity');
  const out = new Uint8Array(129); out.set(CLAIM); out.set(statement(wasm, invitation), 8); out.set(subject, 97); return out;
}
export function decodeClaim(wasm, invitation, bytes) {
  if (!fixed(bytes, 129) || !equal(bytes.subarray(0, 8), CLAIM)
      || !equal(bytes.subarray(8, 97), statement(wasm, invitation))) throw new Error('Claim does not match invitation');
  return bytes.slice(97);
}
const validateCertificate = (wasm, invitation, claim, certificate, epoch) => {
  const subject = decodeClaim(wasm, invitation, claim);
  if (!epochValid(epoch) || !certificateCodec(wasm).authentic(certificate, subject, invitation.group)
      || new DataView(certificate.buffer, certificate.byteOffset, certificate.byteLength).getBigUint64(64) !== epoch)
    throw new Error('Bundle certificate does not match claim and epoch');
};
export function encodeBundle(wasm, invitation, claim, {certificate, epoch, payloadKey, integrityKey}) {
  validateCertificate(wasm, invitation, claim, certificate, epoch);
  if (!fixed(payloadKey, 32) || !fixed(integrityKey, 32)) throw new TypeError('Invalid current-epoch material');
  const out = new Uint8Array(345); out.set(BUNDLE); out.set(claim, 8);
  new DataView(out.buffer).setBigUint64(137, epoch); out.set(certificate, 145);
  out.set(payloadKey, 281); out.set(integrityKey, 313); return out;
}
export function decodeBundle(wasm, invitation, expectedClaim, expectedEpoch, bytes) {
  if (!epochValid(expectedEpoch) || !fixed(bytes, 345) || !equal(bytes.subarray(0, 8), BUNDLE)
      || !fixed(expectedClaim, 129) || !equal(bytes.subarray(8, 137), expectedClaim)
      || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(137) !== expectedEpoch)
    throw new Error('Bundle does not match requested enrollment');
  const certificate = bytes.slice(145, 281);
  validateCertificate(wasm, invitation, expectedClaim, certificate, expectedEpoch);
  // These arrays are volatile material, not permission to persist group keys.
  // The caller must also erase its input bundle and any further copies it makes.
  const payloadKey = bytes.slice(281, 313), integrityKey = bytes.slice(313, 345);
  return Object.freeze({certificate, epoch: expectedEpoch, payloadKey, integrityKey,
    destroy: () => { payloadKey.fill(0); integrityKey.fill(0); }});
}
