const domain = new TextEncoder().encode('along/at-policy/v1\0');
const fail = () => new Error('AT policy update unavailable');
export function encodePolicyUpdate(bytes, signature) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || !(signature instanceof Uint8Array)
      || signature.length !== 64 || domain.length + 2 + bytes.length + 64 > 2048) throw fail();
  const packet = new Uint8Array(domain.length + 2 + bytes.length + 64);
  packet.set(domain); new DataView(packet.buffer).setUint16(domain.length, bytes.length);
  packet.set(bytes, domain.length + 2); packet.set(signature, domain.length + 2 + bytes.length);
  return packet;
}
export function decodePolicyUpdate(packet) {
  if (!(packet instanceof Uint8Array) || packet.length > 2048 || packet.length < domain.length + 67
      || !domain.every((v, i) => packet[i] === v)) throw fail();
  const copy = packet.slice(), length = new DataView(copy.buffer).getUint16(domain.length);
  if (!length || copy.length !== domain.length + 2 + length + 64) throw fail();
  return {policyBytes: copy.slice(domain.length + 2, -64), policySignature: copy.slice(-64)};
}

