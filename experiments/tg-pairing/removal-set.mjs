import {openMembership} from './membership.mjs';
const width = 113, maximum = 256;
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const fail = () => new Error('Group removal catch-up unavailable');
const fixed = (value, length) => value instanceof Uint8Array && value.length === length;
const u64 = value => typeof value === 'bigint' && value >= 0n && value <= 0xffffffffffffffffn;
function encode(records) {
  if (!Array.isArray(records) || records.length > maximum) throw fail();
  const bytes = new Uint8Array(records.length * width), view = new DataView(bytes.buffer), seen = new Set();
  records.forEach((record, index) => {
    if (!fixed(record.subject, 32) || !fixed(record.signature, 64) || !u64(record.epoch)
        || !u64(record.sequence) || record.sequence === 0n || !Number.isInteger(record.reason)
        || record.reason < 0 || record.reason > 3 || seen.has(hex(record.subject))) throw fail();
    seen.add(hex(record.subject));
    const offset = index * width; bytes.set(record.subject, offset);
    view.setBigUint64(offset + 32, record.epoch); view.setBigUint64(offset + 40, record.sequence);
    bytes[offset + 48] = record.reason; bytes.set(record.signature, offset + 49);
  });
  return btoa(String.fromCharCode(...bytes));
}
function decode(text) {
  if (typeof text !== 'string' || text.length > 40000) throw fail();
  let raw; try { raw = atob(text); } catch { throw fail(); }
  if (btoa(raw) !== text || raw.length % width || raw.length > maximum * width) throw fail();
  const bytes = Uint8Array.from(raw, char => char.charCodeAt(0)), view = new DataView(bytes.buffer), records = [];
  for (let offset = 0; offset < bytes.length; offset += width) records.push({
    subject: bytes.slice(offset, offset + 32), epoch: view.getBigUint64(offset + 32), sequence: view.getBigUint64(offset + 40),
    reason: bytes[offset + 48], signature: bytes.slice(offset + 49, offset + width),
  });
  encode(records); return records;
}
async function context(wasm, store, group) {
  if (!fixed(group, 32) || store.capabilities?.transactionChecks !== true) throw fail();
  const key = hex(group), saved = await store.read('membership', key);
  if (!fixed(saved?.value?.subject, 32)) throw fail();
  const membership = openMembership(store, wasm, group, saved.value.subject);
  try {
    if (!['current', 'revoked'].includes(await membership.status())) throw fail();
    if ((await store.read('membership', key))?.revision !== saved.revision) throw fail();
    return {key, saved};
  } finally { membership.close(); }
}
// Along connection-profile bytes, not an R2 wire-format declaration. Signatures
// bind each removal to the established group. No journey or key data is included.
export async function exportRemovalSet({wasm, store, expectedGroup}) {
  const {saved} = await context(wasm, store, expectedGroup);
  return encode(saved.value.revocations);
}
export async function receiveRemovalSet({wasm, store, expectedGroup, text, signal}) {
  if (!fixed(expectedGroup, 32)) throw fail();
  const group = expectedGroup.slice(), records = decode(text);
  for (let attempt = 0; attempt < 8; attempt++) {
    if (signal?.aborted) throw fail();
    const {key, saved} = await context(wasm, store, group);
    const verifier = wasm.BrowserMembership.establish(group, saved.value.current, saved.value.depth);
    try {
      for (const record of records) if (!verifier.apply_revocation(record.subject, record.epoch, record.sequence, record.reason, record.signature)) throw fail();
    } finally { verifier.free(); }
    const known = new Set(saved.value.revocations.map(record => hex(record.subject)));
    const additions = records.filter(record => !known.has(hex(record.subject)));
    if (!additions.length) { if (signal?.aborted) throw fail(); return {added: 0}; }
    if (known.size + additions.length > maximum) throw fail();
    const value = structuredClone(saved.value); value.revocations.push(...additions);
    const result = await store.compareAndSwapMany([{scope: 'membership', key, expectedRevision: saved.revision, value}], {signal});
    if (!result.applied) continue;
    const membership = openMembership(store, wasm, group, saved.value.subject);
    try { for (const record of additions) { try { await membership.applyRevocation(record); } catch {} } }
    finally { membership.close(); }
    return {added: additions.length}; // Local commit only, not a globally fresh roster.
  }
  throw fail();
}
