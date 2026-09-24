import {readPreferences as readLocal} from '../../public/preferences.js';
import {projectJourney, journeyId, validateState} from './state.mjs';
export {recordJourney, suggestions, journeyRoutes, sameRoutes} from '../../public/preferences.js';
export const preferenceKey = 'along-journeys-v1';
export const changedEvent = 'along-saved-journeys-changed';
export const appliedEvent = 'along-saved-journeys-applied';
export const readPreferences = readLocal;
const hex = /^[0-9a-f]{64}$/;
// The head may already have an IndexedDB receipt, or be committing in another
// tab. Keep it byte-for-byte; only its unstarted successors can be coalesced.
// Retain final deletions even when an earlier pending save is removed: another
// device may still hold that journey. New operation IDs cannot match old receipts.
function compactPending(pending, group, version) {
  const latest = new Map();
  for (const operation of pending.slice(1)) {
    if (!operation || !/^[0-9a-f-]{36}$/.test(operation.id)
        || !Array.isArray(operation.changes) || operation.changes.length > 512) throw Error('Sharing journal unavailable');
    const origin = operation.version ?? {generation: 0, checkpoint: '0'.repeat(64)};
    const target = version ?? {generation: 0, checkpoint: '0'.repeat(64)};
    if (origin.generation !== target.generation || origin.checkpoint !== target.checkpoint) throw Error('Sharing journal needs recovery');
    for (const change of operation.changes) {
      validateState({format: 1, group, clock: 1, journeys: [
        {id: change.id, value: change.value, actor: group, clock: 1},
      ]}, group);
      // Reinsert to keep the order of the final local edits across pairs.
      latest.delete(change.id); latest.set(change.id, change);
    }
  }
  const result = pending.slice(0, 1), changes = [...latest.values()];
  for (let offset = 0; offset < changes.length; offset += 512)
    result.push({id: crypto.randomUUID(), changes: changes.slice(offset, offset + 512), ...(version ? {version: structuredClone(version)} : {})});
  return result;
}
export function savedValues(data) {
  const values = new Map();
  for (const journey of data.journeys ?? []) if (journey.saved) {
    const value = projectJourney(journey); values.set(journeyId(value), value);
  }
  return values;
}
export function readEnvelope(storage = globalThis.localStorage) {
  const raw = storage.getItem(preferenceKey);
  const data = raw === null ? {learning: true, journeys: []} : JSON.parse(raw);
  if (!data || !Array.isArray(data.journeys)) throw Error('Saved places unavailable');
  const sync = data.journeySync;
  if (sync !== undefined && (sync?.format !== 1 || !hex.test(sync.group) || !Array.isArray(sync.pending)
      || sync.pending.length > 256)) throw Error('Saved sharing journal unavailable');
  if (sync?.version !== undefined && (!Number.isSafeInteger(sync.version?.generation) || sync.version.generation < 0
      || sync.version.generation >= Number.MAX_SAFE_INTEGER || !hex.test(sync.version.checkpoint)
      || (sync.version.generation === 0) !== (sync.version.checkpoint === '0'.repeat(64)))) throw Error('Saved sharing generation unavailable');
  return {raw, data, sync};
}
export function writePreferences(data, storage = globalThis.localStorage) {
  try {
    const previous = readEnvelope(storage), sync = previous.sync && structuredClone(previous.sync);
    if (sync) {
      const before = savedValues(previous.data), after = savedValues(data), changes = [];
      for (const [id, value] of after) if (JSON.stringify(before.get(id)) !== JSON.stringify(value)) changes.push({id, value});
      for (const id of before.keys()) if (!after.has(id)) changes.push({id, value: null});
      if (changes.length) sync.pending.push({id: crypto.randomUUID(), changes, ...(sync.version ? {version: structuredClone(sync.version)} : {})});
      if (sync.pending.length > 256) sync.pending = compactPending(sync.pending, sync.group, sync.version);
      if (sync.pending.length > 256) throw Error('Sharing journal full');
    }
    storage.setItem(preferenceKey, JSON.stringify({...data, ...(sync ? {journeySync: sync} : {})}));
    globalThis.dispatchEvent?.(new Event(changedEvent)); return true;
  } catch { return false; }
}
// Explicit async path for generation recovery. Callers must retain the raw
// envelope associated with their edit; a stale tab must reload rather than
// write its entire older preferences object over recovered data.
// Existing synchronous app callers are not yet migrated to this contract.
export async function writePreferencesLocked(data, {expectedRaw, storage = globalThis.localStorage,
  locks = navigator.locks, signal} = {}) {
  const copy = structuredClone(data), before = readEnvelope(storage);
  if (before.raw !== expectedRaw || !before.sync || !locks?.request) return false;
  return locks.request('along-journey-import:' + before.sync.group, {signal}, () => {
    if (signal?.aborted || storage.getItem(preferenceKey) !== expectedRaw) return false;
    return writePreferences(copy, storage);
  });
}
// Explicit opt-in starts local tracking. No identity, consent or delivery claim.
export function enableJourneyTracking(group, storage = globalThis.localStorage) {
  if (!hex.test(group)) throw Error('Journey group unavailable');
  const {data, sync} = readEnvelope(storage);
  if (sync) { if (sync.group !== group) throw Error('Different saved sharing group'); return; }
  const changes = [...savedValues(data)].map(([id, value]) => ({id, value}));
  data.journeySync = {format: 1, group, pending: changes.length ? [{id: crypto.randomUUID(), changes}] : []};
  storage.setItem(preferenceKey, JSON.stringify(data));
}
