// HEARTBEAT announcement (L2 5; body as in the L1 bindings 5.3 and the hive
// WebSocket binding). Unauthenticated and not relayed (hop 1, budget 0).
// Along's public build is production: it emits no development element (L2 5.4a).
import {TYPE, encodeExtended, parseFrame} from './frame.mjs';

export function announcementBody({beaconId, classHash, development = false}) {
  if (beaconId.length !== 4 || classHash.length !== 4) throw new Error('Beacon and class hash are 4 bytes');
  const out = new Uint8Array(development ? 15 : 12);
  out.set([1, 4]); out.set(beaconId, 2); out.set([2, 4], 6); out.set(classHash, 8);
  if (development) out.set([3, 1, 1], 12);
  return out;
}

export function heartbeatFrame({origin, msgId, beaconId, classHash, development = false}) {
  return encodeExtended({type: TYPE.HEARTBEAT, hop: 1, budget: 0, msgId, eventHash: 0, origin,
    payload: announcementBody({beaconId, classHash, development})});
}

// Returns {beaconId, classHash, build: 'development'|'production'|'unknown'} or null.
export function readAnnouncement(bytes) {
  const frame = parseFrame(bytes, 'extended');
  if (frame.discard || frame.originless || frame.type !== TYPE.HEARTBEAT) return null;
  const body = frame.payload, out = {origin: frame.origin, build: 'unknown'};
  let at = 0, last = 0, readable = true;
  while (at < body.length) {
    if (at + 2 > body.length) { readable = false; break; }
    const type = body[at], length = body[at + 1];
    if (type <= last || at + 2 + length > body.length) { readable = false; break; }
    const value = body.slice(at + 2, at + 2 + length);
    if (type === 1 && length === 4) out.beaconId = value;
    if (type === 2 && length === 4) out.classHash = value;
    if (type === 3) { if (length === 1 && value[0] === 1) out.build = 'development'; else readable = false; }
    last = type; at += 2 + length;
  }
  if (readable && out.build === 'unknown') out.build = 'production';
  return out;
}
