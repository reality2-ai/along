// Deterministic CBOR for current R2 payloads: L4 11 and FORMATS 4b
// (PROVISIONAL(SS95)). Definite lengths, no tags, shortest heads, map keys
// sorted by encoded bytes, shortest exact float. The decoder rejects rather
// than repairs non-canonical input (4b.2a–b), duplicate keys (4b.3), tags
// (4b.4) and nesting deeper than MAX_DEPTH (4b.5).

export const MAX_DEPTH = 8;

// Wrap a number to force float encoding (JavaScript cannot distinguish 1 and 1.0).
export class CborFloat { constructor(value) { this.value = Number(value); } }
export const cborFloat = value => new CborFloat(value);

const concat = parts => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

function head(major, value) {
  const m = major << 5;
  if (typeof value === 'bigint') {
    if (value < 24n) return Uint8Array.of(m | Number(value));
    if (value <= 0xffffffffn) return head(major, Number(value));
    const out = new Uint8Array(9); out[0] = m | 27; new DataView(out.buffer).setBigUint64(1, value); return out;
  }
  if (value < 24) return Uint8Array.of(m | value);
  if (value < 0x100) return Uint8Array.of(m | 24, value);
  if (value < 0x10000) return Uint8Array.of(m | 25, value >> 8, value & 0xff);
  if (value < 0x100000000) { const out = new Uint8Array(5); out[0] = m | 26; new DataView(out.buffer).setUint32(1, value); return out; }
  return head(major, BigInt(value));
}

function halfBits(value) {
  // Exact IEEE binary16 encoding, or null if the value is not exactly representable.
  if (Number.isNaN(value)) return 0x7e00;
  if (value === Infinity) return 0x7c00;
  if (value === -Infinity) return 0xfc00;
  const sign = (value < 0 || Object.is(value, -0)) ? 0x8000 : 0;
  const abs = Math.abs(value);
  if (abs === 0) return sign;
  for (let exp = -14; exp <= 15; exp++) {
    const scale = 2 ** exp;
    const mant = abs / scale; // normal: 1 <= mant < 2
    if (mant >= 1 && mant < 2) {
      const frac = (mant - 1) * 1024;
      return Number.isInteger(frac) ? sign | ((exp + 15) << 10) | frac : null;
    }
  }
  const sub = abs / 2 ** -24; // subnormal
  return Number.isInteger(sub) && sub < 1024 ? sign | sub : null;
}

function encodeFloat(value) {
  const half = halfBits(value);
  if (half !== null) return Uint8Array.of(0xf9, half >> 8, half & 0xff);
  if (Math.fround(value) === value) { const out = new Uint8Array(5); out[0] = 0xfa; new DataView(out.buffer).setFloat32(1, value); return out; }
  const out = new Uint8Array(9); out[0] = 0xfb; new DataView(out.buffer).setFloat64(1, value); return out;
}

function compareBytes(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

export function encode(value, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('CBOR nesting exceeds limit');
  if (value === null) return Uint8Array.of(0xf6);
  if (value === false) return Uint8Array.of(0xf4);
  if (value === true) return Uint8Array.of(0xf5);
  if (value instanceof CborFloat) return encodeFloat(value.value);
  if (typeof value === 'bigint') return value >= 0n ? head(0, value) : head(1, -1n - value);
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && !Object.is(value, -0)) return value >= 0 ? head(0, value) : head(1, -1 - value);
    return encodeFloat(value);
  }
  if (typeof value === 'string') { const b = new TextEncoder().encode(value); return concat([head(3, b.length), b]); }
  if (value instanceof Uint8Array) return concat([head(2, value.length), value]);
  if (Array.isArray(value)) return concat([head(4, value.length), ...value.map(v => encode(v, depth + 1))]);
  if (value instanceof Map || (typeof value === 'object' && value.constructor === Object)) {
    const entries = value instanceof Map ? [...value] : Object.entries(value);
    const encoded = entries.map(([k, v]) => [encode(k, depth + 1), encode(v, depth + 1)]).sort((a, b) => compareBytes(a[0], b[0]));
    for (let i = 1; i < encoded.length; i++) if (compareBytes(encoded[i - 1][0], encoded[i][0]) === 0) throw new Error('Duplicate CBOR map key');
    return concat([head(5, encoded.length), ...encoded.flat()]);
  }
  throw new Error('Value has no CBOR encoding in this profile');
}

// Maps decode to Map so integer keys and key order are preserved.
export function decode(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const need = n => { if (at + n > bytes.length) throw new Error('Truncated CBOR'); };
  function argument(info) {
    if (info < 24) return info;
    let value;
    if (info === 24) { need(1); value = bytes[at]; at += 1; if (value < 24) throw new Error('Non-canonical CBOR head'); return value; }
    if (info === 25) { need(2); value = view.getUint16(at); at += 2; if (value < 0x100) throw new Error('Non-canonical CBOR head'); return value; }
    if (info === 26) { need(4); value = view.getUint32(at); at += 4; if (value < 0x10000) throw new Error('Non-canonical CBOR head'); return value; }
    if (info === 27) {
      need(8); value = view.getBigUint64(at); at += 8;
      if (value <= 0xffffffffn) throw new Error('Non-canonical CBOR head');
      return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
    }
    throw new Error('Indefinite or reserved CBOR length');
  }
  const length = info => { const n = argument(info); if (typeof n === 'bigint') throw new Error('CBOR length too large'); need(0); return n; };
  function item(depth) {
    need(1);
    const initial = bytes[at++], major = initial >> 5, info = initial & 31;
    switch (major) {
      case 0: return argument(info);
      case 1: { const n = argument(info); return typeof n === 'bigint' ? -1n - n : (n >= Number.MAX_SAFE_INTEGER ? -1n - BigInt(n) : -1 - n); }
      case 2: { const n = length(info); need(n); const out = bytes.slice(at, at + n); at += n; return out; }
      case 3: {
        const n = length(info); need(n);
        const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(at, at + n)); at += n; return text;
      }
      case 4: {
        if (depth >= MAX_DEPTH) throw new Error('CBOR nesting exceeds limit');
        const n = length(info), out = [];
        for (let i = 0; i < n; i++) out.push(item(depth + 1));
        return out;
      }
      case 5: {
        if (depth >= MAX_DEPTH) throw new Error('CBOR nesting exceeds limit');
        const n = length(info), out = new Map();
        let previous = null;
        for (let i = 0; i < n; i++) {
          const start = at; const key = item(depth + 1); const keyBytes = bytes.subarray(start, at);
          if (previous) {
            const order = compareBytes(previous, keyBytes);
            if (order === 0) throw new Error('Duplicate CBOR map key');
            if (order > 0) throw new Error('Non-canonical CBOR map order');
          }
          previous = keyBytes;
          out.set(key instanceof Uint8Array || typeof key === 'object' ? keyBytes.slice() : key, item(depth + 1));
        }
        return out;
      }
      case 6: throw new Error('CBOR tags are not permitted');
      default: {
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        let value;
        if (info === 25) { need(2); const bits = view.getUint16(at); at += 2; value = decodeHalf(bits); }
        else if (info === 26) { need(4); value = view.getFloat32(at); at += 4; }
        else if (info === 27) { need(8); value = view.getFloat64(at); at += 8; }
        else throw new Error('CBOR simple value not permitted');
        const canonical = encodeFloat(value);
        if (canonical.length !== (info === 25 ? 3 : info === 26 ? 5 : 9)) throw new Error('Non-canonical CBOR float');
        return value;
      }
    }
  }
  const value = item(0);
  if (at !== bytes.length) throw new Error('Trailing CBOR bytes');
  return value;
}

function decodeHalf(bits) {
  const sign = bits & 0x8000 ? -1 : 1, exp = (bits >> 10) & 31, frac = bits & 1023;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}
