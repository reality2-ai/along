// Along-specific public evidence. Verification does not install a checkpoint,
// remove local data, grant sharing permission or establish current membership.
import {validateState} from './state.mjs';
import {validateGenerationState} from './generation-state.mjs';
const domain = new TextEncoder().encode('ALNJCP01');
const hashDomain = new TextEncoder().encode('along/journey-checkpoint-snapshot/v1:');
const fixed = (value, length) => value instanceof Uint8Array && value.length === length;
const number = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const bytesOf = text => Uint8Array.from(text.match(/../g), n => parseInt(n, 16));
const refuse = () => new Error('Journey checkpoint unavailable');
const hash = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
function snapshotCopy(snapshot, group) {
  const value = validateState(snapshot, group);
  if (value.journeys.some(entry => entry.value === null)) throw refuse();
  return value;
}
export async function journeySnapshotDigest(snapshot) {
  const copy = snapshotCopy(snapshot, snapshot.group);
  const encoded = new TextEncoder().encode(JSON.stringify(copy));
  const input = new Uint8Array(hashDomain.length + encoded.length);
  input.set(hashDomain); input.set(encoded, hashDomain.length); return hash(input);
}
export function journeyCheckpointStatement({group, from, to, parent, snapshotDigest}) {
  if (!fixed(group, 32) || !number(from) || !number(to) || to !== from + 1
      || !fixed(parent, 32) || !fixed(snapshotDigest, 32)
      || (from === 0) !== parent.every(byte => byte === 0)) throw refuse();
  const out = new Uint8Array(120), view = new DataView(out.buffer);
  out.set(domain); out.set(group, 8); view.setBigUint64(40, BigInt(from));
  view.setBigUint64(48, BigInt(to)); out.set(parent, 56); out.set(snapshotDigest, 88); return out;
}
export function encodeJourneyCheckpoint(fields, signature) {
  if (!fixed(signature, 64)) throw refuse();
  const out = new Uint8Array(184); out.set(journeyCheckpointStatement(fields)); out.set(signature, 120); return out;
}
export async function verifyJourneyCheckpoint({bytes, current, snapshot}) {
  if (!fixed(bytes, 184)) throw refuse();
  // Snapshot all mutable arguments before the first await.
  const message = bytes.slice(), held = validateGenerationState(current, current.group);
  const copy = snapshotCopy(snapshot, held.group), group = bytesOf(held.group);
  const view = new DataView(message.buffer);
  const fields = {group, from: Number(view.getBigUint64(40)), to: Number(view.getBigUint64(48)),
    parent: message.slice(56, 88), snapshotDigest: message.slice(88, 120)};
  if (fields.from !== held.generation || hex(fields.parent) !== held.checkpoint
      || !same(message.slice(0, 120), journeyCheckpointStatement(fields))) throw refuse();
  if (!same(await journeySnapshotDigest(copy), fields.snapshotDigest)) throw refuse();
  const key = await crypto.subtle.importKey('raw', group, 'Ed25519', false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', key, message.slice(120), message.slice(0, 120))) throw refuse();
  // A proposal for guarded durable installation, never an in-place replacement.
  return validateGenerationState({format: 2, group: held.group, generation: fields.to,
    checkpoint: hex(await hash(message)), clock: copy.clock, journeys: copy.journeys}, held.group);
}
