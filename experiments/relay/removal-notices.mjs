// Along application framing, carried inside the chosen relay's protected EVENTs.
// These are public issuer-signed removals, never replacement keys or permissions.
// Decoding is NOT authorization: receiveRemovalSet must verify before any write.
const magic = new TextEncoder().encode('ALNRMV01');
const recordBytes = 113, maximum = 256;
const fixed = (value, length) => value instanceof Uint8Array && value.length === length;
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const base64 = bytes => btoa(String.fromCharCode(...bytes));
export const isRemovalNotice = packet => packet instanceof Uint8Array
  && packet.length >= magic.length && equal(packet.subarray(0, magic.length), magic);

export function removalNoticePackets({expectedGroup, text}) {
  if (!fixed(expectedGroup, 32) || typeof text !== 'string' || text.length > 40000)
    throw Error('Removal notices unavailable');
  const raw = atob(text);
  if (btoa(raw) !== text || raw.length % recordBytes || raw.length > maximum * recordBytes)
    throw Error('Removal notices unavailable');
  const packets = [];
  for (let offset = 0; offset < raw.length; offset += recordBytes) {
    const packet = new Uint8Array(40 + recordBytes);
    packet.set(magic); packet.set(expectedGroup, 8);
    packet.set(Uint8Array.from(raw.slice(offset, offset + recordBytes), c => c.charCodeAt(0)), 40);
    packets.push(packet);
  }
  return packets;
}

export function readRemovalNotice({expectedGroup, packet}) {
  if (!fixed(expectedGroup, 32) || !fixed(packet, 40 + recordBytes)
      || !isRemovalNotice(packet) || !equal(packet.subarray(8, 40), expectedGroup))
    throw Error('Different or invalid removal notice');
  return base64(packet.subarray(40));
}
