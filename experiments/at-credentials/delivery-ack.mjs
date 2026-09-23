// Public installation receipt, never continuing credential authority.
const domain = new TextEncoder().encode('along/at-saved/v1\0');
const fail = () => new Error('AT delivery acknowledgment unavailable');
function body(value) {
  const lengths = {group: 32, owner: 32, credential: 16, recipient: 32, nonce: 16};
  const result = new Uint8Array(domain.length + 144); result.set(domain);
  let offset = domain.length;
  for (const [field, length] of Object.entries(lengths)) {
    const text = value?.[field];
    if (typeof text !== 'string' || text.length !== length * 2 || !/^[0-9a-f]+$/.test(text)) throw fail();
    result.set(Uint8Array.from(text.match(/../g), v => parseInt(v, 16)), offset); offset += length;
  }
  for (const field of ['policyRevision', 'generation']) {
    if (typeof value[field] !== 'bigint' || value[field] < 1n || value[field] > 0xffffffffffffffffn) throw fail();
    new DataView(result.buffer).setBigUint64(offset, value[field]); offset += 8;
  }
  return result;
}
export {body as deliveryAckBytes};
export async function signDeliveryAck(value, sign) {
  const bytes = body(value), signature = await sign(bytes.slice());
  if (!(signature instanceof Uint8Array) || signature.length !== 64) throw fail();
  const packet = new Uint8Array(bytes.length + 64); packet.set(bytes); packet.set(signature, bytes.length);
  return packet;
}
export async function verifyDeliveryAck(packet, expected) {
  const bytes = body(expected);
  if (!(packet instanceof Uint8Array) || packet.length !== bytes.length + 64) throw fail();
  const snapshot = packet.slice();
  if (!bytes.every((v, i) => v === snapshot[i])) throw fail();
  const recipient = snapshot.slice(domain.length + 80, domain.length + 112);
  const key = await crypto.subtle.importKey('raw', recipient, 'Ed25519', false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', key, snapshot.slice(-64), bytes)) throw fail();
  return Object.freeze({status: 'recipient-confirmed-saved'});
}
