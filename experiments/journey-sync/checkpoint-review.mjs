// Read-only review model. A future guarded writer must rebuild this model from
// current records before accepting choices; an old review is not authorization.
import {validateState} from './state.mjs';
import {validateGenerationState, changeGenerationJourney} from './generation-state.mjs';
import {verifyJourneyCheckpoint} from './generation-checkpoint.mjs';
import {readEnvelope, savedValues} from './app-preferences.mjs';
const fail = () => new Error('Journey recovery review unavailable');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export async function createCheckpointReview({current, recovery, localRaw, actor}) {
  const state = validateGenerationState(current, current.group), record = structuredClone(recovery);
  if (!/^[0-9a-f]{64}$/.test(actor) || record?.format !== 1 || record.member !== actor || typeof localRaw !== 'string') throw fail();
  const previous = validateGenerationState(record.previous, state.group);
  const local = readEnvelope({getItem: () => localRaw});
  const version = local.sync?.version ?? {generation: 0, checkpoint: '0'.repeat(64)};
  if (local.sync?.group !== state.group || version.generation !== previous.generation || version.checkpoint !== previous.checkpoint) throw fail();
  const intent = new Map(previous.journeys.map(entry => [entry.id, entry.value]));
  const saved = savedValues(local.data), pending = new Map();
  for (const operation of local.sync.pending) {
    const origin = operation.version ?? {generation: 0, checkpoint: '0'.repeat(64)};
    if (typeof operation.id !== 'string' || !/^[0-9a-f-]{36}$/.test(operation.id)
        || !Array.isArray(operation.changes) || operation.changes.length > 512
        || origin.generation !== previous.generation || origin.checkpoint !== previous.checkpoint) throw fail();
    for (const change of operation.changes) {
      const entry = validateState({format: 1, group: state.group, clock: 1,
        journeys: [{id: change.id, actor, clock: 1, value: change.value}]}, state.group).journeys[0];
      pending.set(entry.id, entry.value);
    }
  }
  for (const [id, value] of saved) intent.set(id, value);
  for (const [id, value] of pending) {
    // The final pending edit must agree with the current local saved view. Do
    // not guess which copy is newer if storage is inconsistent.
    if (!equal(saved.get(id) ?? null, value)) throw fail();
    intent.set(id, value);
  }
  const verified = await verifyJourneyCheckpoint({bytes: record.checkpoint, current: previous, snapshot: record.snapshot});
  if (verified.generation !== state.generation || verified.checkpoint !== state.checkpoint) throw fail();
  const shared = new Map(state.journeys.map(entry => [entry.id, entry.value]));
  const differences = [...intent].filter(([id, value]) => !equal(value, shared.get(id) ?? null))
    .map(([id, value]) => ({id, local: value, shared: shared.get(id) ?? null})).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const binding = new TextEncoder().encode(JSON.stringify(['along/journey-recovery-review/v1', actor, state,
    previous, hex(record.checkpoint), localRaw]));
  const id = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', binding)));
  return Object.freeze({id, differences: structuredClone(differences),
    resolve(choices) {
      if (!Array.isArray(choices) || choices.length !== differences.length) throw fail();
      const selected = new Map();
      for (const choice of choices) {
        if (!choice || Object.keys(choice).sort().join(',') !== 'id,use'
            || !['local', 'shared'].includes(choice.use) || selected.has(choice.id)) throw fail();
        selected.set(choice.id, choice.use);
      }
      let planned = state; const changes = [];
      for (const difference of differences) {
        const choice = selected.get(difference.id);
        if (!choice) throw fail();
        if (choice === 'local') {
          planned = changeGenerationJourney(planned, actor, difference.id, difference.local);
          changes.push({id: difference.id, value: structuredClone(difference.local)});
        }
      }
      // Simulating the resulting state enforces the actual replication bound
      // before any write. No hidden trimming or automatic capacity expansion.
      return {reviewId: id, changes, saved: planned.journeys.filter(entry => entry.value !== null).map(entry => structuredClone(entry.value)),
        generation: state.generation, checkpoint: state.checkpoint};
    },
  });
}
