// Reviewed local installation only; no startup/network caller is wired yet.
// Local preferences are never replaced here. Their prior and current copies
// remain available for a separate review of differences after installation.
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {validateState} from './state.mjs';
import {validateGenerationState} from './generation-state.mjs';
import {verifyJourneyCheckpoint} from './generation-checkpoint.mjs';
import {selectPlannerStorage, readEnvelope} from './app-preferences.mjs';
const scope = 'along-saved-journeys-v2', receipts = 'along-journey-import-v2';
const recovery = 'along-journey-checkpoint-recovery-v1';
const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((v, i) => v === b[i]);
const fail = () => new Error('Journey checkpoint installation unavailable; a committed installation may already exist');
export async function installJourneyCheckpoint({wasm, store, expectedGroup, expectedRevision, expectedLocalRaw,
  checkpoint, snapshot, storage = selectPlannerStorage(), locks = navigator.locks, signal}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32 || !(checkpoint instanceof Uint8Array)
      || checkpoint.length !== 184 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1
      || typeof expectedLocalRaw !== 'string' || !locks?.request || store.capabilities?.transactionChecks !== true) throw fail();
  const group = expectedGroup.slice(), groupId = hex(group), message = checkpoint.slice();
  const copy = validateState(snapshot, groupId), target = Number(new DataView(message.buffer).getBigUint64(48));
  const key = groupId + ':' + target;
  return locks.request('along-device-preview-journey-import:' + groupId, {signal}, async () => {
    const active = () => { if (signal?.aborted) throw fail(); };
    active();
    const persona = await store.read('candidate-persona', 'active'), membership = await store.read('membership', groupId);
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
    const before = await store.read(scope, groupId), receipt = await store.read(receipts, groupId);
    const saved = await store.read(recovery, key);
    if (!before) throw fail();
    const held = validateGenerationState(before.value, groupId);
    if (saved) {
      const value = saved.value;
      if (value?.format !== 1 || value.member !== identity.member || value.sourceRevision !== expectedRevision
          || value.localRaw !== expectedLocalRaw || !same(value.checkpoint, message)) throw fail();
      const verified = await verifyJourneyCheckpoint({bytes: message, current: value.previous, snapshot: copy});
      await verifyJourneyCheckpoint({bytes: message, current: value.previous, snapshot: value.snapshot});
      if (held.generation !== verified.generation || held.checkpoint !== verified.checkpoint
          || receipt?.value?.format !== 2 || receipt.value.generation !== held.generation
          || receipt.value.checkpoint !== held.checkpoint) throw fail();
      await current();
      for (const [s, k, revision] of [[scope, groupId, before.revision], [receipts, groupId, receipt.revision], [recovery, key, saved.revision]])
        if ((await store.read(s, k))?.revision !== revision) throw fail();
      return {status: 'checkpoint-installed-locally', generation: held.generation, alreadyInstalled: true, localReviewRequired: true};
    }
    if (before.revision !== expectedRevision) throw fail();
    const local = readEnvelope(storage);
    const localVersion = local.sync?.version ?? {generation: 0, checkpoint: '0'.repeat(64)};
    if (local.raw !== expectedLocalRaw || local.sync?.group !== groupId
        || localVersion.generation !== held.generation || localVersion.checkpoint !== held.checkpoint) throw fail();
    const next = await verifyJourneyCheckpoint({bytes: message, current: held, snapshot: copy});
    await current();
    if (readEnvelope(storage).raw !== expectedLocalRaw) throw fail();
    const result = await store.compareAndSwapMany([
      {scope, key: groupId, expectedRevision, value: next},
      {scope: receipts, key: groupId, expectedRevision: receipt?.revision ?? 0,
        value: {format: 2, generation: next.generation, checkpoint: next.checkpoint, operation: null}},
      {scope: recovery, key, expectedRevision: 0,
        value: {format: 1, member: identity.member, sourceRevision: expectedRevision, previous: held,
          localRaw: expectedLocalRaw, importReceipt: receipt ? structuredClone(receipt) : null,
          checkpoint: message, snapshot: copy}},
    ], {signal, checks: guards});
    if (!result.applied) throw fail();
    await current();
    return {status: 'checkpoint-installed-locally', generation: next.generation, alreadyInstalled: false, localReviewRequired: true};
  });
}
