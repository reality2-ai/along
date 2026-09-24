import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState, changeJourney, projectJourney, journeyId, JourneyCapacityError} from './state.mjs';
import {initialGeneration} from './generation-state.mjs';
import {journeySnapshotDigest, journeyCheckpointStatement, encodeJourneyCheckpoint, verifyJourneyCheckpoint} from './generation-checkpoint.mjs';
import {createCheckpointReview} from './checkpoint-review.mjs';
const actor = '1'.repeat(64);
const value = (id, route = '70') => projectJourney({from: {id: 'from', name: 'From', lat: -36, lon: 174},
  to: {id, name: id, lat: -37, lon: 175}, savedRoutes: [{mode: 'bus', route}]});
async function fixture(capacity = false) {
  const keys = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  const group = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)), groupId = Buffer.from(group).toString('hex');
  let old = emptyState(groupId), snapshot = emptyState(groupId);
  const a = value('a'), b = value('b'), c = value('c'), d = value('d');
  old = changeJourney(old, actor, journeyId(a), a);
  old = changeJourney(old, actor, journeyId(b), null);
  for (const item of capacity ? Array.from({length: 256}, (_, i) => value('filled-' + i)) : [a, b, d])
    snapshot = changeJourney(snapshot, actor, journeyId(item), item);
  const previous = initialGeneration(old), fields = {group, from: 0, to: 1, parent: new Uint8Array(32), snapshotDigest: await journeySnapshotDigest(snapshot)};
  const checkpoint = encodeJourneyCheckpoint(fields, new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, journeyCheckpointStatement(fields))));
  const current = await verifyJourneyCheckpoint({bytes: checkpoint, current: previous, snapshot});
  const changed = value('a', '75');
  const local = {learning: false, mobility: {pace: 0.8}, journeys: [
    {...changed, saved: true, count: 900}, {...c, saved: true}, {...value('history'), saved: false, hours: [1, 2, 3]},
  ], journeySync: {format: 1, group: groupId, pending: [{id: crypto.randomUUID(), changes: [
    {id: journeyId(changed), value: changed}, {id: journeyId(b), value: null}, {id: journeyId(c), value: c},
  ]}]}};
  return {current, recovery: {format: 1, member: actor, previous, checkpoint, snapshot}, localRaw: JSON.stringify(local), actor};
}
test('review requires an explicit choice for each retained save, service preference and deletion', async () => {
  const input = await fixture(), before = structuredClone(input), review = await createCheckpointReview(input);
  assert.equal(review.differences.length, 3);
  const byId = new Map(review.differences.map(d => [d.id, d]));
  assert.equal(byId.get(journeyId(value('a'))).local.savedRoutes[0].route, '75');
  assert.equal(byId.get(journeyId(value('b'))).local, null);
  assert.equal(byId.get(journeyId(value('c'))).shared, null);
  assert.equal(JSON.stringify(review.differences).includes('hours'), false);
  assert.equal(JSON.stringify(review.differences).includes('count'), false);
  assert.throws(() => review.resolve([]));
  const choices = review.differences.map(d => ({id: d.id, use: 'local'}));
  const result = review.resolve(choices);
  assert.equal(result.changes.length, 3);
  assert.equal(result.changes.find(c => c.id === journeyId(value('b'))).value, null, 'deletion is explicit, not a resave');
  assert.deepEqual(result.saved.map(j => j.to.id).sort(), ['a', 'c', 'd']);
  const adopted = review.resolve(choices.map(c => ({...c, use: 'shared'})));
  assert.deepEqual(adopted.changes, []);
  assert.deepEqual(adopted.saved.map(j => j.to.id).sort(), ['a', 'b', 'd']);
  assert.deepEqual(input, before, 'review does not modify persisted inputs');
  review.differences[0].local = null;
  assert.deepEqual(review.resolve(choices), result, 'editable display copies cannot alter the captured decision model');
  assert.throws(() => review.resolve(choices.map((c, i) => i === 0 ? {...c, use: 'automatic'} : c)));
  assert.throws(() => review.resolve(choices.map(() => choices[0])));
});
test('review refuses damaged evidence, mismatched generations and inconsistent pending/local views', async () => {
  const input = await fixture();
  const damaged = structuredClone(input); damaged.recovery.checkpoint[183] ^= 1;
  await assert.rejects(createCheckpointReview(damaged));
  await assert.rejects(createCheckpointReview({...input, actor: '2'.repeat(64)}));
  const wrong = structuredClone(input); wrong.current.generation = 2;
  await assert.rejects(createCheckpointReview(wrong));
  const local = JSON.parse(input.localRaw); local.journeys[0].savedRoutes[0].route = 'different';
  await assert.rejects(createCheckpointReview({...input, localRaw: JSON.stringify(local)}));
  local.journeys[0].savedRoutes[0].route = '75';
  local.journeySync.pending[0].version = {generation: 1, checkpoint: input.current.checkpoint};
  await assert.rejects(createCheckpointReview({...input, localRaw: JSON.stringify(local)}));
});
test('review binding changes with current local data; choices cannot silently overfill the replica', async () => {
  const input = await fixture(), review = await createCheckpointReview(input);
  const local = JSON.parse(input.localRaw); local.learning = true;
  const changed = await createCheckpointReview({...input, localRaw: JSON.stringify(local)});
  assert.notEqual(review.id, changed.id);
  const full = await fixture(true), fullReview = await createCheckpointReview(full);
  const choices = fullReview.differences.map(d => ({id: d.id, use: 'local'}));
  assert.throws(() => fullReview.resolve(choices), JourneyCapacityError);
  assert.equal(fullReview.resolve(choices.map(c => ({...c, use: 'shared'}))).saved.length, 256);
});
