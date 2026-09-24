// Internal custody adapter: callers supply a scoped signer and live authority
// checks. No UI entry point, generation installation or network delivery here.
import {validateGenerationState, checkpointSnapshot} from './generation-state.mjs';
import {journeySnapshotDigest, journeyCheckpointStatement, encodeJourneyCheckpoint, verifyJourneyCheckpoint} from './generation-checkpoint.mjs';
const scope = 'along-prepared-journey-checkpoint-v1';
const replicaScope = 'along-saved-journeys-v2';
const refuse = () => new Error('Journey checkpoint preparation unavailable; a retained preparation may already exist');
const bytes = text => Uint8Array.from(text.match(/../g), n => parseInt(n, 16));
export async function prepareJourneyCheckpoint({store, current, expectedRevision, sign, check, guards, signal}) {
  const heldState = validateGenerationState(current, current.group);
  if (store.capabilities?.transactionChecks !== true || typeof sign !== 'function' || typeof check !== 'function'
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !Array.isArray(guards) || !guards.length) throw refuse();
  const checks = structuredClone(guards);
  if (checks.some(g => !g || typeof g.scope !== 'string' || typeof g.key !== 'string'
      || !Number.isSafeInteger(g.expectedRevision) || g.expectedRevision < 0)) throw refuse();
  const group = heldState.group, key = group + ':' + (heldState.generation + 1);
  const currentCheck = async () => {
    if (signal?.aborted) throw refuse();
    await check();
    const replica = await store.read(replicaScope, group);
    if (replica?.revision !== expectedRevision
        || JSON.stringify(validateGenerationState(replica.value, group)) !== JSON.stringify(heldState)) throw refuse();
    for (const guard of checks) if (((await store.read(guard.scope, guard.key))?.revision ?? 0) !== guard.expectedRevision) throw refuse();
    if (signal?.aborted) throw refuse();
  };
  const validate = async value => {
    if (!value || Object.keys(value).sort().join(',') !== 'checkpoint,format,snapshot'
        || value.format !== 1) throw refuse();
    const next = await verifyJourneyCheckpoint({bytes: value.checkpoint, current: heldState, snapshot: value.snapshot});
    await currentCheck();
    return next;
  };
  let proposed;
  for (let attempt = 0; attempt < 8; attempt++) {
    await currentCheck();
    const saved = await store.read(scope, key);
    if (saved) {
      const next = await validate(saved.value);
      if ((await store.read(scope, key))?.revision !== saved.revision) continue;
      return {status: 'checkpoint-prepared-locally', checkpoint: saved.value.checkpoint.slice(),
        snapshot: structuredClone(saved.value.snapshot), generation: next.generation, delivered: false};
    }
    if (!proposed) {
      const snapshot = checkpointSnapshot(heldState);
      const fields = {group: bytes(group), from: heldState.generation, to: heldState.generation + 1,
        parent: bytes(heldState.checkpoint), snapshotDigest: await journeySnapshotDigest(snapshot)};
      await currentCheck();
      const checkpoint = encodeJourneyCheckpoint(fields, await sign(journeyCheckpointStatement(fields)));
      proposed = {format: 1, checkpoint, snapshot};
      await validate(proposed);
    }
    const result = await store.compareAndSwapMany([{scope, key, expectedRevision: 0, value: proposed}],
      {signal, checks: [...checks, {scope: replicaScope, key: group, expectedRevision}]});
    // Authenticate the retained winner on the next iteration, including after our
    // successful write. Cancellation cannot erase a committed preparation.
    if (result.applied) proposed = undefined;
  }
  throw refuse();
}
