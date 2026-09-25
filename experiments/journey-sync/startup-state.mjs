import {readOlderEditProgress} from './older-edit-progress.mjs';
// Read-only startup diagnosis, never an authorization token for a later write.
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {validateState} from './state.mjs';
import {validateGenerationState} from './generation-state.mjs';
import {verifyJourneyCheckpoint} from './generation-checkpoint.mjs';
import {preferenceKey, readEnvelope} from './preference-envelope.mjs';
import {openIsolatedPlannerStorage} from './isolated-preferences.mjs';
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const matches = (a, b) => a?.generation === b.generation && a?.checkpoint === b.checkpoint;
const changedDuringRead = Symbol('startup-snapshot-changed');
export async function readJourneyStartupState(options) {
  // Reconciliation can commit while this read-only diagnosis is in flight.
  // Revalidate a fresh snapshot, never accept the inconsistent one or retry
  // malformed data, cancellation, failed storage or missing authority.
  for (let attempt=0;attempt<3;attempt++) {
    const result=await inspectJourneyStartupState(options);
    if(result!==changedDuringRead)return result;
  }
  return {status:'unavailable'};
}
async function inspectJourneyStartupState({wasm, store, expectedGroup, storage = globalThis.localStorage, signal}) {
  const unavailable = {status: 'unavailable'};
  try {
    if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) return unavailable;
    const group = expectedGroup.slice(), groupId = hex(group), observed = [];
    const read = async (scope, key) => {
      if (signal?.aborted) throw Error('Cancelled');
      const record = await store.read(scope, key); observed.push({scope, key, revision: record?.revision ?? 0}); return record;
    };
    const persona = await read('candidate-persona', 'active');
    await read('membership', groupId); await read('along-journey-sharing-v1', groupId);
    const identity = await loadLocalPersona({wasm, store, expectedGroup: group});
    if (!identity || !persona) return unavailable;
    const journalScope = identity.origin === 'initial' ? 'persona-bootstrap' : 'enrollment-invitations';
    const journalKey = identity.origin === 'initial' ? 'initial' : groupId + ':' + hex(persona.value.invitation.code);
    if (!await read(journalScope, journalKey)) return unavailable;
    const old = await read('along-saved-journeys-v1', groupId);
    const replica = await read('along-saved-journeys-v2', groupId);
    const archive = await read('along-journey-migration-v1', groupId);
    const profileKey = preferenceKey + ':generation-profile-v1';
    const profileRaw = storage.getItem(profileKey), legacyRaw = storage.getItem(preferenceKey);
    let result;
    if (!replica && !archive) {
      if (profileRaw !== null) return unavailable;
      if (old) validateState(old.value, groupId);
      const local = readEnvelope({getItem: () => legacyRaw});
      if (local.sync && (local.sync.group !== groupId || (local.sync.version?.generation ?? 0) !== 0)) return unavailable;
      result = {status: 'legacy'};
    } else {
      if (!replica || !archive || archive.value?.format !== 1 || archive.value.member !== identity.member
          || !Number.isSafeInteger(archive.value.sourceRevision) || archive.value.sourceRevision < 0
          || old?.value?.format !== 2 || old.value.profile !== 'along-journey-generation-migration-v1'
          || old.value.group !== groupId) return unavailable;
      validateState(archive.value.sourceState, groupId);
      const state = validateGenerationState(replica.value, groupId);
      let previous;
      if (state.generation > 0) {
        const recovery = await read('along-journey-checkpoint-recovery-v1', groupId + ':' + state.generation);
        if (recovery?.value?.format !== 1 || recovery.value.member !== identity.member) return unavailable;
        const verified = await verifyJourneyCheckpoint({bytes: recovery.value.checkpoint,
          current: recovery.value.previous, snapshot: recovery.value.snapshot});
        if (!matches(verified, state)) return unavailable;
        previous = validateGenerationState(recovery.value.previous, groupId);
      }
      if (profileRaw === null) result = {status: 'isolation-required', generation: state.generation};
      else {
        const isolated = openIsolatedPlannerStorage({group: groupId, storage});
        const local = readEnvelope(isolated), version = local.sync?.version ?? {generation: 0, checkpoint: '0'.repeat(64)};
        if (local.sync?.group !== groupId) return unavailable;
        const legacy=isolated.inspectLegacy();
        const progress=await readOlderEditProgress({store:{read},group:groupId,member:identity.member,sourceRaw:legacy.sourceRaw});
        const legacyChangesPending=legacy.currentLegacyRaw!==progress.sourceRaw;
        if (matches(version, state)) result = {status: progress.pendingReviewId?'older-edit-pending':'generation-ready', generation: state.generation, legacyChangesPending, ...(progress.pendingReviewId?{olderReviewId:progress.pendingReviewId}:{})};
        else if (previous && matches(version, previous)) result = {status: 'local-review-required', generation: state.generation, legacyChangesPending};
        else return unavailable;
      }
    }
    const checked = await loadLocalPersona({wasm, store, expectedGroup: group});
    if (!checked) return unavailable;
    if (checked.member !== identity.member || checked.epoch !== identity.epoch) return changedDuringRead;
    for (const record of observed) if (((await store.read(record.scope, record.key))?.revision ?? 0) !== record.revision) return changedDuringRead;
    if (signal?.aborted) return unavailable;
    if (storage.getItem(profileKey) !== profileRaw || storage.getItem(preferenceKey) !== legacyRaw) return changedDuringRead;
    return {...result, canPrepareCheckpoint: identity.origin === 'initial'};
  } catch { return unavailable; }
}
