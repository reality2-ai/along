// Explicitly invoked migration only. No app startup or peer message calls this.
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {emptyState, validateState} from './state.mjs';
import {initialGeneration, validateGenerationState} from './generation-state.mjs';
const legacyScope = 'along-saved-journeys-v1', nextScope = 'along-saved-journeys-v2';
const archiveScope = 'along-journey-migration-v1', receiptScope = 'along-journey-import-v1';
const profile = 'along-journey-generation-migration-v1';
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const fail = () => new Error('Journey migration unavailable; a committed migration may already exist');
export async function migrateJourneyGeneration({wasm, store, expectedGroup, expectedRevision, signal}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32
      || store.capabilities?.transactionChecks !== true || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw fail();
  const group = expectedGroup.slice(), groupId = hex(group);
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
    const checked = await loadLocalPersona({wasm, store, expectedGroup: group});
    if (checked?.member !== identity.member || checked.epoch !== identity.epoch) throw fail();
    for (const g of guards) if (((await store.read(g.scope, g.key))?.revision ?? 0) !== g.expectedRevision) throw fail();
    active();
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    await current();
    const old = await store.read(legacyScope, groupId), next = await store.read(nextScope, groupId);
    const archive = await store.read(archiveScope, groupId), receipt = await store.read(receiptScope, groupId);
    if (next || archive) {
      if (!next || !archive || archive.value?.format !== 1 || archive.value.member !== identity.member
          || archive.value.sourceRevision !== expectedRevision
          || old?.value?.format !== 2 || old.value.profile !== profile || old.value.group !== groupId) throw fail();
      validateState(archive.value.sourceState, groupId);
      validateGenerationState(next.value, groupId);
      await current();
      if ((await store.read(archiveScope, groupId))?.revision !== archive.revision
          || (await store.read(legacyScope, groupId))?.revision !== old.revision
          || (await store.read(nextScope, groupId))?.revision !== next.revision) continue;
      return {status: 'journey-generation-migrated', alreadyMigrated: true, revision: next.revision};
    }
    if ((old?.revision ?? 0) !== expectedRevision) throw fail();
    const sourceState = old ? validateState(old.value, groupId) : emptyState(groupId);
    const value = initialGeneration(sourceState);
    await current();
    const result = await store.compareAndSwapMany([
      {scope: legacyScope, key: groupId, expectedRevision, value: {format: 2, profile, group: groupId}},
      {scope: nextScope, key: groupId, expectedRevision: 0, value},
      {scope: archiveScope, key: groupId, expectedRevision: 0,
        value: {format: 1, member: identity.member, sourceRevision: expectedRevision, sourceState,
          importReceipt: receipt ? structuredClone(receipt) : null}},
    ], {signal, checks: [...guards, {scope: receiptScope, key: groupId, expectedRevision: receipt?.revision ?? 0}]});
    if (result.applied) { await current(); return {status: 'journey-generation-migrated', alreadyMigrated: false, revision: result.revisions[1]}; }
  }
  throw fail();
}
