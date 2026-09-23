import {readPreferences as readLocal} from '../../public/preferences.js';
import {projectJourney, journeyId} from './state.mjs';
export {recordJourney, suggestions, journeyRoutes, sameRoutes} from '../../public/preferences.js';
export const preferenceKey = 'along-journeys-v1';
export const changedEvent = 'along-saved-journeys-changed';
export const appliedEvent = 'along-saved-journeys-applied';
export const readPreferences = readLocal;
const hex = /^[0-9a-f]{64}$/;
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
  return {raw, data, sync};
}
export function writePreferences(data, storage = globalThis.localStorage) {
  try {
    const previous = readEnvelope(storage), sync = previous.sync && structuredClone(previous.sync);
    if (sync) {
      const before = savedValues(previous.data), after = savedValues(data), changes = [];
      for (const [id, value] of after) if (JSON.stringify(before.get(id)) !== JSON.stringify(value)) changes.push({id, value});
      for (const id of before.keys()) if (!after.has(id)) changes.push({id, value: null});
      if (changes.length) sync.pending.push({id: crypto.randomUUID(), changes});
      if (sync.pending.length > 256) throw Error('Sharing journal full');
    }
    storage.setItem(preferenceKey, JSON.stringify({...data, ...(sync ? {journeySync: sync} : {})}));
    globalThis.dispatchEvent?.(new Event(changedEvent)); return true;
  } catch { return false; }
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
