import test from 'node:test';
import assert from 'node:assert/strict';
import {openAppJourneyStore} from './app-store.mjs';
import {writePreferences, readPreferences, readEnvelope, enableJourneyTracking, preferenceKey} from './app-preferences.mjs';
import {changeJourney, projectJourney, journeyId} from './state.mjs';
const group = '11'.repeat(32), actor = '22'.repeat(32), peer = '33'.repeat(32);
const journey = n => ({from: {id: 'from', name: 'Home', lat: -36, lon: 174}, to: {id: 'to-' + n, name: 'Place ' + n, lat: -37, lon: 175}, savedRoutes: [{mode: 'bus', route: '70'}], saved: true, count: 3, hours: Array(24).fill(2), days: Array(7).fill(1), last: 1234});
function fixture() {
  let raw = null, failWrite = false, beforeCommit;
  const records = new Map();
  const storage = {getItem: () => raw, setItem: (key, value) => { assert.equal(key, preferenceKey); if (failWrite) throw Error('full'); raw = value; }};
  const store = {capabilities: {transactionChecks: true},
    read: async (scope, key) => structuredClone(records.get(scope + ':' + key) ?? null),
    compareAndSwapMany: async changes => {
      const callback = beforeCommit; beforeCommit = undefined; callback?.();
      if (changes.some(c => (records.get(c.scope + ':' + c.key)?.revision ?? 0) !== c.expectedRevision)) return {applied: false};
      const revisions = changes.map(c => { const revision = c.expectedRevision + 1; records.set(c.scope + ':' + c.key, {revision, value: structuredClone(c.value)}); return revision; });
      return {applied: true, revisions};
    }};
  let tail = Promise.resolve();
  const locks = {request: (key, options, run) => { const next = tail.then(run); tail = next.catch(() => {}); return next; }};
  const bridge = openAppJourneyStore({store, group, actor, storage, locks});
  const state = async () => (await store.read('along-saved-journeys-v1', group))?.value;
  return {store, storage, bridge, state, fail: value => { failWrite = value; }, before: callback => { beforeCommit = callback; }};
}
test('opt-in imports only saved projections, preserves learning and applies peer changes without history', async () => {
  const f = fixture();
  assert.equal(writePreferences({learning: false, mobility: {pace: 0.8}, journeys: [journey(1), {...journey(2), saved: false}]}, f.storage), true);
  enableJourneyTracking(group, f.storage); await f.bridge.reconcile();
  assert.equal((await f.state()).journeys.length, 1);
  assert.equal(JSON.stringify(await f.state()).includes('hours'), false);
  const value = projectJourney(journey(3));
  const record = await f.store.read('along-saved-journeys-v1', group);
  await f.store.compareAndSwapMany([{scope: 'along-saved-journeys-v1', key: group, expectedRevision: record.revision, value: changeJourney(record.value, peer, journeyId(value), value)}]);
  await f.bridge.reconcile();
  const local = readPreferences(f.storage);
  assert.equal(local.learning, false); assert.deepEqual(local.mobility, {pace: 0.8});
  assert.equal(local.journeys.find(j => j.to.id === 'to-1').count, 3);
  assert.equal(local.journeys.find(j => j.to.id === 'to-2').saved, false);
  assert.equal(local.journeys.find(j => j.to.id === 'to-3').count, 0);
  assert.equal(readEnvelope(f.storage).sync.pending.length, 0);
});
test('crash between IndexedDB commit and local journal consumption replays exactly once', async () => {
  const f = fixture(); writePreferences({journeys: [journey(1)]}, f.storage); enableJourneyTracking(group, f.storage);
  f.before(() => f.fail(true));
  await assert.rejects(f.bridge.reconcile());
  assert.equal((await f.state()).clock, 1); assert.equal(readEnvelope(f.storage).sync.pending.length, 1);
  f.fail(false); await f.bridge.reconcile();
  assert.equal((await f.state()).clock, 1); assert.equal(readEnvelope(f.storage).sync.pending.length, 0);
});
test('local edits during commit survive; offline deletion is durably journalled before reconciliation', async () => {
  const f = fixture(); writePreferences({journeys: [journey(1)]}, f.storage); enableJourneyTracking(group, f.storage);
  f.before(() => { const data = readPreferences(f.storage); data.journeys[0].saved = false; assert.equal(writePreferences(data, f.storage), true); });
  await f.bridge.reconcile();
  assert.equal((await f.state()).journeys[0].value, null); assert.equal(readPreferences(f.storage).journeys[0].saved, false);
  assert.equal((await f.state()).clock, 2);
  const data = readPreferences(f.storage); data.journeys[0].saved = true; writePreferences(data, f.storage);
  assert.equal(readEnvelope(f.storage).sync.pending.length, 1);
  const changed = readPreferences(f.storage); changed.journeys[0].saved = false; writePreferences(changed, f.storage);
  await f.bridge.reconcile(); assert.equal((await f.state()).journeys[0].value, null);
});
test('retains more than thirty saved places and refuses a silent group switch', async () => {
  const f = fixture(); writePreferences({journeys: Array.from({length: 40}, (_, n) => journey(n))}, f.storage);
  enableJourneyTracking(group, f.storage); await f.bridge.reconcile();
  assert.equal(readPreferences(f.storage).journeys.length, 40);
  assert.equal((await f.state()).journeys.length, 40);
  assert.throws(() => enableJourneyTracking(peer, f.storage));
});
test('replication capacity refusal retains every local save and the outbound journal', async () => {
  const f = fixture(); writePreferences({journeys: Array.from({length: 257}, (_, n) => journey(n))}, f.storage);
  enableJourneyTracking(group, f.storage);
  await assert.rejects(f.bridge.reconcile());
  assert.equal(readPreferences(f.storage).journeys.length, 257);
  assert.equal(readEnvelope(f.storage).sync.pending[0].changes.length, 257);
  assert.equal(await f.state(), undefined, 'failed batch never partially imports places');
});

function queuedEdits(f, count) {
  for (let n = 0; n < count; n++) {
    const data = readPreferences(f.storage);
    data.journeys[0].savedRoutes = [{mode: 'bus', route: String(n + 1)}];
    assert.equal(writePreferences(data, f.storage), true, 'offline edits remain writable');
  }
}
test('compacts repeated offline edits, retaining the head, final deletion and local history', async () => {
  const f = fixture();
  writePreferences({learning: false, journeys: [journey(1), journey(2)]}, f.storage);
  enableJourneyTracking(group, f.storage);
  const head = structuredClone(readEnvelope(f.storage).sync.pending[0]);
  queuedEdits(f, 255);
  const data = readPreferences(f.storage); data.journeys[1].saved = false;
  assert.equal(writePreferences(data, f.storage), true);
  const pending = readEnvelope(f.storage).sync.pending;
  assert.equal(pending.length, 2);
  assert.deepEqual(pending[0], head);
  assert.equal(pending[1].changes.length, 2);
  assert.equal(pending[1].changes[1].value, null);
  await f.bridge.reconcile();
  const state = await f.state();
  assert.equal(state.journeys.find(e => e.id === journeyId(projectJourney(journey(2)))).value, null);
  assert.deepEqual(state.journeys.find(e => e.value)?.value.savedRoutes, [{mode: 'bus', route: '255'}]);
  assert.equal(readPreferences(f.storage).learning, false);
  assert.equal(readPreferences(f.storage).journeys[0].count, 3);
  assert.equal(readEnvelope(f.storage).sync.pending.length, 0);
});
test('compaction during a head commit preserves its receipt across a failed journal write', async () => {
  const f = fixture(); writePreferences({journeys: [journey(1)]}, f.storage);
  enableJourneyTracking(group, f.storage); queuedEdits(f, 255);
  const head = structuredClone(readEnvelope(f.storage).sync.pending[0]);
  f.before(() => {
    queuedEdits(f, 1);
    assert.deepEqual(readEnvelope(f.storage).sync.pending[0], head);
    assert.equal(readEnvelope(f.storage).sync.pending.length, 2);
    f.fail(true);
  });
  await assert.rejects(f.bridge.reconcile());
  assert.equal((await f.state()).clock, 1);
  f.fail(false); await f.bridge.reconcile();
  assert.equal((await f.state()).clock, 2, 'head was not replayed with a new operation ID');
  assert.equal((await f.state()).journeys[0].value.savedRoutes[0].route, '1');
  assert.equal(readEnvelope(f.storage).sync.pending.length, 0);
});
test('compaction storage failure leaves the exact previous journal and preferences intact', () => {
  const f = fixture(); writePreferences({journeys: [journey(1)]}, f.storage);
  enableJourneyTracking(group, f.storage); queuedEdits(f, 255);
  const before = f.storage.getItem(preferenceKey), data = readPreferences(f.storage);
  data.journeys[0].saved = false; f.fail(true);
  assert.equal(writePreferences(data, f.storage), false);
  assert.equal(f.storage.getItem(preferenceKey), before);
});
test('versioned edits and compaction keep their generation; mixed generations are never relabelled', () => {
  const f = fixture(); writePreferences({journeys: [journey(1)]}, f.storage); enableJourneyTracking(group, f.storage);
  const data = readEnvelope(f.storage).data;
  data.journeySync.version = {generation: 1, checkpoint: 'a'.repeat(64)};
  data.journeySync.pending = [];
  f.storage.setItem(preferenceKey, JSON.stringify(data));
  queuedEdits(f, 257);
  let envelope = readEnvelope(f.storage);
  assert.equal(envelope.sync.pending.length, 2);
  for (const operation of envelope.sync.pending) assert.deepEqual(operation.version, data.journeySync.version);
  // A retained older operation in the unstarted tail must not get a fresh tag.
  delete envelope.sync.pending[1].version;
  while (envelope.sync.pending.length < 256) envelope.sync.pending.push({id: crypto.randomUUID(), changes: [], version: data.journeySync.version});
  f.storage.setItem(preferenceKey, JSON.stringify(envelope.data));
  const before = f.storage.getItem(preferenceKey), next = readPreferences(f.storage);
  next.journeys[0].saved = false;
  assert.equal(writePreferences(next, f.storage), false);
  assert.equal(f.storage.getItem(preferenceKey), before);
});
