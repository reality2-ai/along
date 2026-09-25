// Current R2 L4 frame layout (published 0.9.0, rev 006d57a4, L4 4.1–4.3, 8, 10).
// A bearer fixes the tier: compact (4.2) or extended (4.3). The WebSocket hive
// binding `r2.extended.v1` is extended only; compact parsing exists for the
// published span vectors and is never emitted by Along.

export const TYPE = Object.freeze({EVENT: 0, CAPABILITY: 3, GROUP_MGMT: 4, HEARTBEAT: 5});
export const FLAG = Object.freeze({ROUTE: 4, TAG: 2, CONSTRAINED: 1});
const RESERVED_TYPES = new Set([1, 2, 6, 7]);
const TIERS = {
  compact: {msgId: 2, target: 4, entry: 4, lengthField: false, tag: 8},
  extended: {msgId: 4, target: 8, entry: 8, lengthField: true, tag: 32},
};
export const MAX_ROUTE = 8;

const uint = (bytes, at, size) => {
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + bytes[at + i];
  return value;
};
const putUint = (bytes, at, size, value) => {
  for (let i = size - 1; i >= 0; i--) { bytes[at + i] = value & 0xff; value = Math.floor(value / 256); }
};

// Returns {discard: reason} for frames a receiver drops unparsed or as malformed
// (4.1.3, 4.3.3, 5.1, 8.4, 10.1.4), otherwise the parsed frame. Origin-less
// EVENT/CAPABILITY/HEARTBEAT frames parse but carry `originless: true` (8.3).
export function parseFrame(input, tier = 'extended') {
  const layout = TIERS[tier];
  if (!layout) throw new Error('Unknown tier');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 2) return {discard: 'truncated'};
  const version = bytes[0] >> 6, type = (bytes[0] >> 3) & 7, flags = bytes[0] & 7;
  if (version !== 0) return {discard: 'version'};
  if (RESERVED_TYPES.has(type)) return {discard: 'reserved-type'};
  const hasRoute = !!(flags & FLAG.ROUTE), hasTag = !!(flags & FLAG.TAG);
  if (hasTag && !hasRoute) return {discard: 'malformed'};
  let at = 2;
  const fixed = layout.msgId + 4 + (layout.lengthField ? 4 : 0) + layout.target;
  if (bytes.length < at + fixed) return {discard: 'truncated'};
  const msgId = uint(bytes, at, layout.msgId); at += layout.msgId;
  const eventHash = uint(bytes, at, 4); at += 4;
  const payloadLength = layout.lengthField ? uint(bytes, at, 4) : null; if (layout.lengthField) at += 4;
  const target = bytes.slice(at, at + layout.target); at += layout.target;
  const route = [];
  if (hasRoute) {
    if (bytes.length < at + 1) return {discard: 'truncated'};
    const count = bytes[at++];
    if (count > MAX_ROUTE) return {discard: 'malformed'};
    if (bytes.length < at + count * layout.entry) return {discard: 'malformed'};
    for (let i = 0; i < count; i++, at += layout.entry) route.push(bytes.slice(at, at + layout.entry));
    if (hasTag && count === 0) return {discard: 'malformed'};
  }
  const tagLength = hasTag ? layout.tag : 0;
  let payloadEnd;
  if (layout.lengthField) {
    if (bytes.length - at !== payloadLength + tagLength) return {discard: 'malformed'};
    payloadEnd = at + payloadLength;
  } else {
    if (bytes.length - at < tagLength) return {discard: 'malformed'};
    payloadEnd = bytes.length - tagLength;
  }
  const frame = {
    tier, version, type, flags, hop: bytes[1] >> 4, budget: bytes[1] & 15, msgId, eventHash, target, route,
    payload: bytes.slice(at, payloadEnd), tag: hasTag ? bytes.slice(payloadEnd) : null,
  };
  frame.origin = route[0] ?? null;
  frame.originless = type !== TYPE.GROUP_MGMT && !frame.origin;
  return frame;
}

// Extended frames only. `origin` is this hive's 8-byte group‖hive entry.
export function encodeExtended({type, hop = 4, budget = 8, msgId, eventHash = 0, target = new Uint8Array(8),
  origin, payload = new Uint8Array(0), tag = null}) {
  if (!TYPE_VALUES.has(type) || type === TYPE.GROUP_MGMT) throw new Error('Along does not send this frame type');
  if (!(origin instanceof Uint8Array) || origin.length !== 8) throw new Error('Origin must be an 8-byte route entry');
  if (target.length !== 8) throw new Error('Target must be 8 bytes');
  if (hop > 15 || budget > 15 || hop < 0 || budget < 0) throw new Error('Hop and budget are 4-bit values');
  if (tag && tag.length !== 32) throw new Error('Extended tags are 32 bytes');
  const out = new Uint8Array(31 + payload.length + (tag ? 32 : 0));
  out[0] = (type << 3) | FLAG.ROUTE | (tag ? FLAG.TAG : 0);
  out[1] = (hop << 4) | budget;
  putUint(out, 2, 4, msgId >>> 0);
  putUint(out, 6, 4, eventHash >>> 0);
  putUint(out, 10, 4, payload.length);
  out.set(target, 14);
  out[22] = 1;
  out.set(origin, 23);
  out.set(payload, 31);
  if (tag) out.set(tag, 31 + payload.length);
  return out;
}
const TYPE_VALUES = new Set(Object.values(TYPE));

// L4 10.2.1: the authenticated span, computed from the frame itself (L5 7.1.3a).
// The AAD for payload encryption is the same span without the payload (FORMATS 4.3).
export function associatedData(frame) {
  const layout = TIERS[frame.tier];
  const out = new Uint8Array(1 + layout.msgId + layout.entry + 4 + layout.target);
  let at = 0;
  out[at++] = frame.type;
  putUint(out, at, layout.msgId, frame.msgId); at += layout.msgId;
  out.set(frame.origin, at); at += layout.entry;
  putUint(out, at, 4, frame.eventHash); at += 4;
  out.set(frame.target, at);
  return out;
}

export function authenticatedSpan(frame) {
  const aad = associatedData(frame);
  const out = new Uint8Array(aad.length + frame.payload.length);
  out.set(aad); out.set(frame.payload, aad.length);
  return out;
}

export const tagLength = tier => TIERS[tier].tag;
