// Division above L4 (L4 6.2.2): an application packet larger than one relayed
// frame travels as independently protected pieces. Each piece's plaintext is the
// deterministic CBOR array [packet id, index, count, bytes]. The receiver
// reassembles per (origin, packet id), bounded in pieces, bytes, entries and age.
// Incomplete packets are dropped; retries belong to the application protocol.
import {decode, encode} from './cbor.mjs';

export const MAX_PACKET = 4096;
export const MAX_PIECES = 32;

export function segment(packet, packetId, maxPlaintext) {
  if (!(packet instanceof Uint8Array) || !packet.length || packet.length > MAX_PACKET) throw new Error('Packet size unavailable');
  // Header: array(1) + id(≤5) + index(≤2) + count(≤2) + byte-string head(≤3).
  const room = maxPlaintext - 13;
  const count = Math.ceil(packet.length / room);
  if (count > MAX_PIECES) throw new Error('Packet needs too many pieces');
  return Array.from({length: count}, (_, index) =>
    encode([packetId >>> 0, index, count, packet.subarray(index * room, (index + 1) * room)]));
}

export function reassembler({maxEntries = 32, lifetimeMs = 10_000, now = () => Date.now()} = {}) {
  const pending = new Map();
  const prune = t => { for (const [k, v] of pending) if (t - v.started >= lifetimeMs) pending.delete(k); };
  return {
    // Returns the complete packet, or null while pieces are missing or input is invalid.
    accept(originKey, plaintext) {
      let piece;
      try { piece = decode(plaintext); } catch { return null; }
      if (!Array.isArray(piece) || piece.length !== 4) return null;
      const [id, index, count, bytes] = piece;
      if (!Number.isSafeInteger(id) || !Number.isSafeInteger(index) || !Number.isSafeInteger(count)
          || count < 1 || count > MAX_PIECES || index < 0 || index >= count || !(bytes instanceof Uint8Array) || !bytes.length) return null;
      const t = now(); prune(t);
      const key = originKey + ':' + id;
      let entry = pending.get(key);
      if (entry && entry.count !== count) { pending.delete(key); return null; }
      if (!entry) {
        if (count === 1) return bytes;
        while (pending.size >= maxEntries) pending.delete(pending.keys().next().value);
        entry = {count, started: t, pieces: new Array(count), received: 0, size: 0};
        pending.set(key, entry);
      }
      if (entry.pieces[index]) return null;
      entry.size += bytes.length;
      if (entry.size > MAX_PACKET) { pending.delete(key); return null; }
      entry.pieces[index] = bytes; entry.received++;
      if (entry.received < count) return null;
      pending.delete(key);
      const out = new Uint8Array(entry.size);
      let at = 0; for (const p of entry.pieces) { out.set(p, at); at += p.length; }
      return out;
    },
    get size() { return pending.size; },
  };
}
