import {emptyState, validateState, changeJourney, journeyId, projectJourney} from './state.mjs';
import {readEnvelope, preferenceKey, appliedEvent} from './app-preferences.mjs';

// Preferences and the local outbound journal share one localStorage write.
// A matching IndexedDB receipt makes replay after a crash idempotent. Web Locks
// serialize this bridge across tabs; peer merges still use storage CAS guards.
export function openAppJourneyStore({store, group, actor, storage = globalThis.localStorage, locks = navigator.locks}) {
  emptyState(group);
  if (!/^[0-9a-f]{64}$/.test(actor) || !locks?.request || store.capabilities?.transactionChecks !== true) throw Error('Journey sharing storage unavailable');
  const scope = 'along-saved-journeys-v1', receipts = 'along-journey-import-v1';
  const read = async () => {
    const saved = await store.read(scope, group);
    return {revision: saved?.revision ?? 0, state: saved ? validateState(saved.value, group) : emptyState(group)};
  };
  const commit = async (operation, signal) => {
    if (!operation || typeof operation.id !== 'string' || !/^[0-9a-f-]{36}$/.test(operation.id)
        || !Array.isArray(operation.changes) || operation.changes.length > 512) throw Error('Sharing journal unavailable');
    for (let attempt = 0; attempt < 8; attempt++) {
      if (signal?.aborted) throw Error('Sharing ended');
      const receipt = await store.read(receipts, group);
      if (receipt?.value?.operation === operation.id) return;
      const before = await read(); let state = before.state;
      for (const change of operation.changes) state = changeJourney(state, actor, change.id, change.value);
      const result = await store.compareAndSwapMany([
        {scope, key: group, expectedRevision: before.revision, value: state},
        {scope: receipts, key: group, expectedRevision: receipt?.revision ?? 0, value: {format: 1, operation: operation.id}},
      ], {signal});
      if (result.applied) return;
    }
    throw Error('Journey storage busy');
  };
  const reconcile = ({signal} = {}) => locks.request('along-journey-import:' + group, {signal}, async () => {
    for (;;) {
      if (signal?.aborted) throw Error('Sharing ended');
      const before = readEnvelope(storage);
      if (before.sync?.group !== group) throw Error('Journey sharing is not enabled');
      const operation = before.sync.pending[0];
      if (operation) {
        await commit(operation, signal);
        const latest = readEnvelope(storage);
        if (latest.sync?.group !== group || latest.sync.pending[0]?.id !== operation.id) throw Error('Sharing journal changed');
        latest.sync.pending.shift();
        storage.setItem(preferenceKey, JSON.stringify(latest.data));
        continue;
      }
      const {state} = await read();
      if (signal?.aborted) throw Error('Sharing ended');
      // A local edit while IndexedDB was read must be committed before applying
      // incoming state. Never overwrite the new edit with the older snapshot.
      if (storage.getItem(preferenceKey) !== before.raw) continue;
      const entries = new Map(state.journeys.map(entry => [entry.id, entry.value]));
      const journeys = before.data.journeys.map(journey => {
        const id = journeyId(projectJourney(journey));
        if (!entries.has(id)) return journey;
        const value = entries.get(id); entries.delete(id);
        return value ? {...journey, ...value, saved: true} : {...journey, saved: false, savedRoutes: null};
      });
      for (const value of entries.values()) if (value) journeys.push({...value, saved: true, count: 0, hours: Array(24).fill(0), days: Array(7).fill(0), last: 0});
      const next = JSON.stringify({...before.data, journeys});
      if (next !== before.raw) {
        storage.setItem(preferenceKey, next);
        globalThis.dispatchEvent?.(new Event(appliedEvent));
      }
      return state;
    }
  });
  return Object.freeze({reconcile});
}
