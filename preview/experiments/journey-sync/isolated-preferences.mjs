// Explicit namespace cutover for a reviewed generation migration. This storage
// layer establishes neither membership nor authorization; its caller must first
// complete those checks. The Settings setup coordinator provides that composition.
import {readEnvelope, preferenceKey} from './preference-envelope.mjs';
const fail = () => new Error('Isolated planner storage unavailable; existing copies are retained');
const parse = raw => readEnvelope({getItem: () => raw});
const keyFor = key => {
  if (typeof key !== 'string' || !/^along-[a-z0-9-]{1,100}$/.test(key)) throw fail();
  return key + ':generation-profile-v1';
};
function validate(raw, group) {
  if (typeof raw !== 'string') throw fail();
  const value = JSON.parse(raw);
  if (value?.format !== 1 || value.group !== group || typeof value.sourceRaw !== 'string'
      || typeof value.currentRaw !== 'string' || Object.keys(value).sort().join(',') !== 'currentRaw,format,group,sourceRaw') throw fail();
  if (parse(value.sourceRaw).sync?.group !== group) throw fail();
  const current = parse(value.currentRaw);
  if (current.sync && current.sync.group !== group) throw fail();
  return value;
}
export function openIsolatedPlannerStorage({group, storage = globalThis.localStorage, legacyKey = preferenceKey}) {
  if (!/^[0-9a-f]{64}$/.test(group)) throw fail();
  const key = keyFor(legacyKey);
  const read = () => validate(storage.getItem(key), group);
  read(); // Never create or fall back to an older namespace on opening.
  return Object.freeze({
    getItem(requested) { if (requested !== preferenceKey) throw fail(); return read().currentRaw; },
    setItem(requested, raw) {
      if (requested !== preferenceKey || typeof raw !== 'string') throw fail();
      const held = read(), next = {...held, currentRaw: raw}; validate(JSON.stringify(next), group);
      storage.setItem(key, JSON.stringify(next));
    },
    inspectLegacy() {
      const held = read(), raw = storage.getItem(legacyKey);
      return {changed: raw !== held.sourceRaw, sourceRaw: held.sourceRaw, currentLegacyRaw: raw};
    },
    key,
  });
}
export async function isolatePlannerPreferences({group, expectedRaw, storage = globalThis.localStorage,
  legacyKey = preferenceKey, locks = globalThis.navigator?.locks, signal, prepare}) {
  if (!/^[0-9a-f]{64}$/.test(group) || typeof expectedRaw !== 'string' || !locks?.request
      || parse(expectedRaw).sync?.group !== group) throw fail();
  const key = keyFor(legacyKey);
  return locks.request('along-device-preview-journey-import:' + group, {signal}, async () => {
    if (signal?.aborted) throw fail();
    // A composed migration may prepare its guarded IndexedDB records while this
    // lock excludes cooperating planner writers. Recheck local bytes afterwards.
    if (prepare) {
      const existing = storage.getItem(key);
      if (existing !== null ? validate(existing, group).sourceRaw !== expectedRaw : storage.getItem(legacyKey) !== expectedRaw) throw fail();
      await prepare();
      if (signal?.aborted) throw fail();
    }
    const heldRaw = storage.getItem(key);
    let alreadyIsolated = false;
    if (heldRaw !== null) {
      const held = validate(heldRaw, group);
      if (held.sourceRaw !== expectedRaw) throw fail();
      alreadyIsolated = true;
    } else {
      if (storage.getItem(legacyKey) !== expectedRaw) throw fail();
      // One localStorage write installs both the captured predecessor and active
      // data. Older apps know only legacyKey; they cannot accidentally overwrite
      // this new key. Their later edits remain there for explicit review.
      storage.setItem(key, JSON.stringify({format: 1, group, sourceRaw: expectedRaw, currentRaw: expectedRaw}));
    }
    const adapter = openIsolatedPlannerStorage({group, storage, legacyKey});
    if (signal?.aborted) throw fail();
    return {status: 'planner-storage-isolated', alreadyIsolated,
      legacyChangesPending: adapter.inspectLegacy().changed, storage: adapter};
  });
}

// Startup selects an already-installed profile; it never creates one. Bind a
// returned adapter for an operation/bridge so deletion cannot trigger fallback.
export function selectPlannerStorage({storage = globalThis.localStorage, legacyKey = preferenceKey} = {}) {
  const raw = storage.getItem(keyFor(legacyKey));
  if (raw === null) return storage;
  const value = JSON.parse(raw);
  return openIsolatedPlannerStorage({storage, legacyKey, group: value?.group});
}
