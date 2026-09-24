import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState, projectJourney, journeyId, changeJourney, JourneyCapacityError} from './state.mjs';
import {initialGeneration, validateGenerationState, mergeGenerationStates, changeGenerationJourney,
  checkpointSnapshot, JourneyGenerationMismatch} from './generation-state.mjs';
import {journeySnapshotDigest, journeyCheckpointStatement, encodeJourneyCheckpoint, verifyJourneyCheckpoint} from './generation-checkpoint.mjs';
const actor = '1'.repeat(64), peer = '2'.repeat(64);
const value = id => projectJourney({from: {id: 'home', name: 'Home', lat: -36, lon: 174},
  to: {id, name: id, lat: -37, lon: 175}});
const hex = bytes => Buffer.from(bytes).toString('hex');
async function fixture() {
  const keys = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  const group = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const initial = initialGeneration(emptyState(hex(group)));
  const sign = async (current, snapshot, signingKey = keys.privateKey) => {
    const fields = {group, from: current.generation, to: current.generation + 1,
      parent: new Uint8Array(Buffer.from(current.checkpoint, 'hex')), snapshotDigest: await journeySnapshotDigest(snapshot)};
    return encodeJourneyCheckpoint(fields, new Uint8Array(await crypto.subtle.sign('Ed25519', signingKey, journeyCheckpointStatement(fields))));
  };
  return {group, initial, sign};
}
test('signed checkpoint reclaims tombstones, while old snapshots and replay cannot restore deleted journeys', async () => {
  const f = await fixture(); let full = f.initial;
  for (let n = 0; n < 256; n++) full = changeGenerationJourney(full, actor, journeyId(value(String(n))), null);
  const next = value('new');
  assert.throws(() => changeGenerationJourney(full, actor, journeyId(next), next), JourneyCapacityError);
  const before = structuredClone(full), snapshot = checkpointSnapshot(full);
  assert.equal(snapshot.journeys.length, 0);
  const bytes = await f.sign(full, snapshot), advanced = await verifyJourneyCheckpoint({bytes, current: full, snapshot});
  assert.deepEqual(full, before, 'verification does not install or delete local state');
  assert.equal(advanced.generation, 1);
  assert.equal(advanced.clock, 256);
  const saved = changeGenerationJourney(advanced, actor, journeyId(next), next);
  assert.equal(saved.journeys.length, 1);
  assert.throws(() => mergeGenerationStates(saved, full), JourneyGenerationMismatch);
  assert.throws(() => mergeGenerationStates(full, saved), JourneyGenerationMismatch);
  await assert.rejects(verifyJourneyCheckpoint({bytes, current: advanced, snapshot}), 'old checkpoint replay refused');
  const peerEdit = changeGenerationJourney(advanced, peer, journeyId(value('other')), value('other'));
  assert.deepEqual(mergeGenerationStates(saved, peerEdit), mergeGenerationStates(peerEdit, saved));
  const second = checkpointSnapshot(saved), secondBytes = await f.sign(saved, second);
  const twice = await verifyJourneyCheckpoint({bytes: secondBytes, current: saved, snapshot: second});
  assert.equal(twice.generation, 2);
  await assert.rejects(verifyJourneyCheckpoint({bytes: secondBytes, current: full, snapshot: second}), 'no skipping a checkpoint');
});
test('checkpoint binds every signed byte, exact snapshot, group authority and predecessor', async () => {
  const f = await fixture(), live = value('one');
  const current = changeGenerationJourney(f.initial, actor, journeyId(live), live);
  const snapshot = checkpointSnapshot(current), bytes = await f.sign(current, snapshot);
  const verify = message => verifyJourneyCheckpoint({bytes: message, current, snapshot});
  await verify(bytes);
  for (let n = 0; n < bytes.length; n++) {
    const changed = bytes.slice(); changed[n] ^= 1;
    await assert.rejects(verify(changed), 'changed signed byte ' + n);
  }
  const other = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  await assert.rejects(verify(await f.sign(current, snapshot, other.privateKey)));
  const changed = structuredClone(snapshot); changed.journeys[0].value.to.name = 'Not the reviewed destination';
  await assert.rejects(verifyJourneyCheckpoint({bytes, current, snapshot: changed}));
  const foreign = await fixture();
  await assert.rejects(verifyJourneyCheckpoint({bytes, current: foreign.initial, snapshot}));
  await assert.rejects(verify(bytes.slice(1)));
  await assert.rejects(verify(new Uint8Array([...bytes, 0])));
  const a = await verify(bytes), differentSnapshot = {...snapshot, journeys: []};
  const b = await verifyJourneyCheckpoint({bytes: await f.sign(current, differentSnapshot), current, snapshot: differentSnapshot});
  assert.throws(() => mergeGenerationStates(a, b), JourneyGenerationMismatch, 'conflicting signed successors cannot silently merge');
});
test('verification copies caller-owned state and message before asynchronous work', async () => {
  const f = await fixture(), snapshot = checkpointSnapshot(f.initial), bytes = await f.sign(f.initial, snapshot);
  const expected = await verifyJourneyCheckpoint({bytes, current: f.initial, snapshot});
  const pending = verifyJourneyCheckpoint({bytes, current: f.initial, snapshot});
  bytes.fill(0); snapshot.clock = 999; f.initial.group = 'f'.repeat(64);
  assert.deepEqual(await pending, expected);
});
test('migration preserves live values and tombstones; malformed and overflow generations refuse', async () => {
  const f = await fixture(), item = value('old');
  let legacy = changeJourney(emptyState(hex(f.group)), actor, journeyId(item), item);
  legacy = changeJourney(legacy, actor, journeyId(value('gone')), null);
  const migrated = initialGeneration(legacy);
  assert.deepEqual(migrated.journeys, legacy.journeys);
  assert.equal(checkpointSnapshot(migrated).journeys.length, 1);
  for (const patch of [{generation: -1}, {generation: 1}, {generation: Number.MAX_SAFE_INTEGER},
    {checkpoint: 'a'.repeat(64)}, {history: []}]) {
    assert.throws(() => validateGenerationState({...migrated, ...patch}, migrated.group));
  }
  await assert.rejects(journeySnapshotDigest(legacy), 'checkpoint snapshot cannot retain tombstones');
  const fields = {group: f.group, from: 0, to: 1, parent: new Uint8Array(32), snapshotDigest: new Uint8Array(32)};
  for (const patch of [{to: 2}, {from: -1}, {from: 1, to: 2}, {from: Number.MAX_SAFE_INTEGER - 1, to: Number.MAX_SAFE_INTEGER},
    {parent: new Uint8Array(31)}, {snapshotDigest: new Uint8Array(33)}]) assert.throws(() => journeyCheckpointStatement({...fields, ...patch}));
});
