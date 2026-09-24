// Explicit format-2 bridge; not mounted by the app yet. It never migrates or
// adopts a generation. A reviewed installer must have established local state.
import {journeyId, projectJourney} from './state.mjs';
import {validateGenerationState, changeGenerationJourney, JourneyGenerationMismatch} from './generation-state.mjs';
import {readEnvelope, preferenceKey, appliedEvent} from './app-preferences.mjs';
const scope = 'along-saved-journeys-v2', receipts = 'along-journey-import-v2';
const archiveScope = 'along-journey-migration-v1', zero = '0'.repeat(64);
const tag = state => ({generation: state.generation, checkpoint: state.checkpoint});
const matches = (a, b) => a?.generation === b.generation && a?.checkpoint === b.checkpoint;
export function openGenerationAppJourneyStore({store, group, actor, storage = globalThis.localStorage, locks = navigator.locks}) {
  if (!/^[0-9a-f]{64}$/.test(group) || !/^[0-9a-f]{64}$/.test(actor)
      || !locks?.request || store.capabilities?.transactionChecks !== true) throw Error('Journey sharing storage unavailable');
  const read = async () => {
    const record = await store.read(scope, group);
    if (!record) throw Error('Journey sharing migration required');
    return {revision: record.revision, state: validateGenerationState(record.value, group)};
  };
  const checkTag = (sync, state) => {
    // Only legacy journals from migration may omit a generation marker.
    const held = sync?.version ?? {generation: 0, checkpoint: zero};
    if (!matches(held, state)) throw new JourneyGenerationMismatch();
  };
  const commit = async (operation, sync, signal) => {
    if (!operation || typeof operation.id !== 'string' || !/^[0-9a-f-]{36}$/.test(operation.id)
        || !Array.isArray(operation.changes) || operation.changes.length > 512) throw Error('Sharing journal unavailable');
    for (let attempt = 0; attempt < 8; attempt++) {
      if (signal?.aborted) throw Error('Sharing ended');
      const before = await read(); checkTag(sync, before.state);
      checkTag({version: operation.version}, before.state);
      const receipt = await store.read(receipts, group);
      if (receipt && (receipt.value?.format !== 2 || !matches(receipt.value, before.state))) throw new JourneyGenerationMismatch();
      if (receipt && receipt.value.operation !== null && (typeof receipt.value.operation !== 'string'
          || !/^[0-9a-f-]{36}$/.test(receipt.value.operation))) throw Error('Journey import receipt unavailable');
      if (receipt?.value.operation === operation.id) return tag(before.state);
      let state = before.state, alreadyImported = false;
      const checks = [];
      if (!receipt && state.generation === 0) {
        const archive = await store.read(archiveScope, group);
        if (!archive || archive.value?.format !== 1 || archive.value.member !== actor) throw Error('Journey migration evidence unavailable');
        const oldReceipt = archive.value.importReceipt;
        if (oldReceipt !== null && (!oldReceipt || !Number.isSafeInteger(oldReceipt.revision) || oldReceipt.revision < 1
            || oldReceipt.value?.format !== 1 || typeof oldReceipt.value.operation !== 'string'
            || !/^[0-9a-f-]{36}$/.test(oldReceipt.value.operation))) throw Error('Journey migration receipt unavailable');
        // A crash could have left the old committed head in localStorage when
        // migration archived its receipt. Transfer that receipt, not the edit.
        alreadyImported = oldReceipt?.value.operation === operation.id;
        checks.push({scope: archiveScope, key: group, expectedRevision: archive.revision});
      }
      if (!alreadyImported) for (const change of operation.changes)
        state = changeGenerationJourney(state, actor, change.id, change.value);
      const result = await store.compareAndSwapMany([
        {scope, key: group, expectedRevision: before.revision, value: state},
        {scope: receipts, key: group, expectedRevision: receipt?.revision ?? 0,
          value: {format: 2, ...tag(state), operation: operation.id}},
      ], {signal, checks});
      if (result.applied) return tag(state);
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
        const version = await commit(operation, before.sync, signal);
        const latest = readEnvelope(storage);
        if (latest.sync?.group !== group || latest.sync.pending[0]?.id !== operation.id) throw Error('Sharing journal changed');
        checkTag(latest.sync, version);
        const held = await read();
        if (!matches(version, held.state)) throw new JourneyGenerationMismatch();
        // Recheck local edits after the asynchronous IndexedDB read.
        if (storage.getItem(preferenceKey) !== latest.raw) continue;
        latest.sync.pending.shift(); latest.sync.version = version;
        storage.setItem(preferenceKey, JSON.stringify(latest.data));
        continue;
      }
      const {state} = await read(); checkTag(before.sync, state);
      if (signal?.aborted) throw Error('Sharing ended');
      if (storage.getItem(preferenceKey) !== before.raw) continue;
      const entries = new Map(state.journeys.map(entry => [entry.id, entry.value]));
      const journeys = before.data.journeys.map(journey => {
        const id = journeyId(projectJourney(journey));
        if (!entries.has(id)) return journey;
        const value = entries.get(id); entries.delete(id);
        return value ? {...journey, ...value, saved: true} : {...journey, saved: false, savedRoutes: null};
      });
      for (const value of entries.values()) if (value) journeys.push({...value, saved: true, count: 0, hours: Array(24).fill(0), days: Array(7).fill(0), last: 0});
      const next = JSON.stringify({...before.data, journeys, journeySync: {...before.sync, version: tag(state)}});
      if (next !== before.raw) { storage.setItem(preferenceKey, next); globalThis.dispatchEvent?.(new Event(appliedEvent)); }
      return state;
    }
  });
  return Object.freeze({reconcile});
}
