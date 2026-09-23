// Application-specific L5 statement, not a new Reality2 wire format or grant.
// Both participants construct this locally from their expected pairing context.
const domain = new TextEncoder().encode('along-peer-session-v1\0');
export function sessionStatement({group, epoch, verifier, prover, transcript}) {
  for (const value of [group, verifier, prover, transcript]) {
    if (!(value instanceof Uint8Array) || value.length !== 32) throw new TypeError('Invalid session binding');
  }
  if (typeof epoch !== 'bigint' || epoch < 0n || epoch > 0xffffffffffffffffn) throw new TypeError('Invalid session epoch');
  if (verifier.every((byte, index) => byte === prover[index])) throw new TypeError('Distinct session participants required');
  const bytes = new Uint8Array(domain.length + 136);
  bytes.set(domain);
  let offset = domain.length;
  bytes.set(group, offset); offset += 32;
  new DataView(bytes.buffer).setBigUint64(offset, epoch, false); offset += 8;
  for (const value of [verifier, prover, transcript]) { bytes.set(value, offset); offset += 32; }
  return bytes;
}
