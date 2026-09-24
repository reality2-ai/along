import {emptyState, validateState, mergeStates, changeJourney, journeyValue, journeyId} from './state.mjs';

// A single CAS persists the visible state, logical clock and outbound snapshot.
// Tombstones are never discarded. This layer does not authorize network callers.
export function openJourneyStore({store, group, actor}) {
  emptyState(group);
  if (!/^[0-9a-f]{64}$/.test(actor) || store.capabilities?.transactionChecks !== true) throw Error('Journey storage unavailable');
  const scope = 'along-saved-journeys-v1';
  const read = async () => {
    const record = await store.read(scope, group);
    return {revision: record?.revision ?? 0, state: record ? validateState(record.value, group) : emptyState(group)};
  };
  const update = async (change, signal) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      if (signal?.aborted) throw Error('Journey change cancelled');
      const previous = await read(), state = change(previous.state);
      const result = await store.compareAndSwapMany([{scope, key: group, expectedRevision: previous.revision, value: state}], {signal});
      if (result.applied) return {status: 'journeys-saved', state, revision: result.revisions[0]};
    }
    throw Error('Journey storage busy; retry the change');
  };
  return Object.freeze({
    read,
    save(value, {signal} = {}) {
      const copy = journeyValue(value), id = journeyId(copy);
      return update(state => changeJourney(state, actor, id, copy), signal);
    },
    remove(id, {signal} = {}) { return update(state => changeJourney(state, actor, id, null), signal); },
    merge(snapshot, {signal} = {}) {
      const copy = validateState(snapshot, group);
      return update(state => mergeStates(state, copy), signal);
    },
  });
}
