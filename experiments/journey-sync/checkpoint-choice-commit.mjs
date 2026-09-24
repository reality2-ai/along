// Durable decision and optional guarded planner cutover. Neither entry point is
// mounted in the app until all writers participate in the same lock protocol.
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {createCheckpointReview} from './checkpoint-review.mjs';
import {validateGenerationState, changeGenerationJourney} from './generation-state.mjs';
import {selectPlannerStorage, readEnvelope, preferenceKey, appliedEvent} from './app-preferences.mjs';
import {journeyId, projectJourney} from './state.mjs';
const replicaScope = 'along-saved-journeys-v2', receiptScope = 'along-journey-import-v2';
const recoveryScope = 'along-journey-checkpoint-recovery-v1';
export const choiceScope = 'along-journey-recovery-choices-v1';
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = () => new Error('Journey recovery choices unavailable; a retained decision may already exist');
export async function commitCheckpointChoices({wasm, store, expectedGroup, generation, reviewId, choices,
  storage = selectPlannerStorage(), locks = navigator.locks, signal}) {
  return recover({wasm, store, expectedGroup, generation, reviewId, choices, storage, locks, signal}, false);
}
// Requires all planner writers to participate in the same Web Lock. This is not
// mounted in the app until those call sites and older-tab handling are migrated.
export async function applyCheckpointChoices({wasm, store, expectedGroup, generation, reviewId, choices,
  storage = selectPlannerStorage(), locks = navigator.locks, signal}) {
  return recover({wasm, store, expectedGroup, generation, reviewId, choices, storage, locks, signal}, true);
}
async function recover({wasm, store, expectedGroup, generation, reviewId, choices, storage, locks, signal}, applyLocal) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32
      || !Number.isSafeInteger(generation) || generation < 1 || generation >= Number.MAX_SAFE_INTEGER
      || !/^[0-9a-f]{64}$/.test(reviewId) || !Array.isArray(choices)
      || !locks?.request || store.capabilities?.transactionChecks !== true) throw fail();
  const group = expectedGroup.slice(), groupId = hex(group), selected = structuredClone(choices);
  // The review digest already binds the group/generation and fits the runtime's
  // bounded storage key; concatenating both hashes exceeds that bound.
  const recoveryKey = groupId + ':' + generation, decisionKey = reviewId;
  return locks.request('along-journey-import:' + groupId, {signal}, async () => {
    const active = () => { if (signal?.aborted) throw fail(); };
    active();
    const persona = await store.read('candidate-persona', 'active');
    const membership = await store.read('membership', groupId);
    const permission = await store.read('along-journey-sharing-v1', groupId);
    const identity = await loadLocalPersona({wasm, store, expectedGroup: group});
    if (!identity || !persona || !membership) throw fail();
    const journalScope = identity.origin === 'initial' ? 'persona-bootstrap' : 'enrollment-invitations';
    const journalKey = identity.origin === 'initial' ? 'initial' : groupId + ':' + hex(persona.value.invitation.code);
    const journal = await store.read(journalScope, journalKey);
    if (!journal) throw fail();
    const guards = [
      {scope: 'candidate-persona', key: 'active', expectedRevision: persona.revision},
      {scope: 'membership', key: groupId, expectedRevision: membership.revision},
      {scope: 'along-journey-sharing-v1', key: groupId, expectedRevision: permission?.revision ?? 0},
      {scope: journalScope, key: journalKey, expectedRevision: journal.revision},
    ];
    const current = async () => {
      active();
      const now = await loadLocalPersona({wasm, store, expectedGroup: group});
      if (now?.member !== identity.member || now.epoch !== identity.epoch) throw fail();
      for (const g of guards) if (((await store.read(g.scope, g.key))?.revision ?? 0) !== g.expectedRevision) throw fail();
      active();
    };
    const replica = await store.read(replicaScope, groupId), receipt = await store.read(receiptScope, groupId);
    const recovery = await store.read(recoveryScope, recoveryKey), retained = await store.read(choiceScope, decisionKey);
    if (!replica || !recovery || !receipt) throw fail();
    const state = validateGenerationState(replica.value, groupId);
    if (state.generation !== generation || receipt.value?.format !== 2
        || receipt.value.generation !== generation || receipt.value.checkpoint !== state.checkpoint
        || receipt.value.operation !== null) throw fail();
    const localRaw = retained ? retained.value.localRaw : readEnvelope(storage).raw;
    const before = retained ? validateGenerationState(retained.value.before, groupId) : state;
    if (retained && (retained.value?.format !== 1 || retained.value.member !== identity.member
        || retained.value.reviewId !== reviewId || !equal(retained.value.choices, selected))) throw fail();
    const review = await createCheckpointReview({current: before, recovery: recovery.value, localRaw, actor: identity.member});
    if (review.id !== reviewId) throw fail();
    const decision = review.resolve(selected);
    let after = before;
    for (const change of decision.changes) after = changeGenerationJourney(after, identity.member, change.id, change.value);
    const finish = () => {
      active();
      const local = readEnvelope({getItem: () => localRaw});
      const saved = new Map(decision.saved.map(value => [journeyId(value), value]));
      const journeys = local.data.journeys.map(journey => {
        const id = journeyId(projectJourney(journey)), value = saved.get(id); saved.delete(id);
        return value ? {...journey, ...value, saved: true} : {...journey, saved: false, savedRoutes: null};
      });
      for (const value of saved.values()) journeys.push({...value, saved: true, count: 0,
        hours: Array(24).fill(0), days: Array(7).fill(0), last: 0});
      const output = JSON.stringify({...local.data, journeys, journeySync: {...local.sync, pending: [],
        version: {generation: after.generation, checkpoint: after.checkpoint}, recoveryReview: reviewId}});
      const raw = storage.getItem(preferenceKey);
      // No asynchronous boundary between this comparison and replacement. Other
      // participating tabs are excluded by the per-group lock held above.
      if (raw !== localRaw && raw !== output) throw fail();
      if (raw !== output) storage.setItem(preferenceKey, output);
      if (storage.getItem(preferenceKey) !== output) throw fail();
      globalThis.dispatchEvent?.(new Event(appliedEvent));
      return {status: 'journey-recovery-applied-locally', reviewId, localReviewRequired: false};
    };
    guards.push({scope: recoveryScope, key: recoveryKey, expectedRevision: recovery.revision});
    await current();
    if (retained) {
      if (!equal(after, retained.value.after) || !equal(state, after)) throw fail();
      for (const [scope, key, revision] of [[replicaScope, groupId, replica.revision],
        [receiptScope, groupId, receipt.revision], [choiceScope, decisionKey, retained.revision]])
        if ((await store.read(scope, key))?.revision !== revision) throw fail();
      active();
      if (applyLocal) return finish();
      return {status: 'journey-recovery-choices-committed', reviewId, alreadyCommitted: true, localReviewRequired: true};
    }
    if (readEnvelope(storage).raw !== localRaw) throw fail();
    const result = await store.compareAndSwapMany([
      {scope: replicaScope, key: groupId, expectedRevision: replica.revision, value: after},
      {scope: receiptScope, key: groupId, expectedRevision: receipt.revision, value: receipt.value},
      {scope: choiceScope, key: decisionKey, expectedRevision: 0,
        value: {format: 1, member: identity.member, reviewId, choices: selected, localRaw, before, after}},
    ], {signal, checks: guards});
    if (!result.applied) throw fail();
    await current();
    if (applyLocal) {
      // A writer outside this lock may have advanced the replica during commit.
      const held = await store.read(replicaScope, groupId), imported = await store.read(receiptScope, groupId);
      if (!held || !equal(held.value, after) || !imported || !equal(imported.value, receipt.value)) throw fail();
      await current();
      return finish();
    }
    return {status: 'journey-recovery-choices-committed', reviewId, alreadyCommitted: false, localReviewRequired: true};
  });
}
