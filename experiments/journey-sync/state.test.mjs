import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState, projectJourney, journeyId, changeJourney, mergeStates, savedJourneys, validateState} from './state.mjs';
const group = 'a'.repeat(64), alice = '1'.repeat(64), bob = '2'.repeat(64);
const value = (id = 'destination') => projectJourney({
  from: {id: 'origin', name: 'Origin', lat: -36.8, lon: 174.7, placeType: 'address'},
  to: {id, name: 'Destination', lat: -36.9, lon: 174.8, placeType: 'address'},
  savedRoutes: [{mode: 'bus', route: '70'}], count: 800, currentLocation: 'private', hours: [3], days: [1],
});
test('independent offline saves converge in either order without copying history', () => {
  const first = value(), second = value('other');
  const a = changeJourney(emptyState(group), alice, journeyId(first), first);
  const b = changeJourney(emptyState(group), bob, journeyId(second), second);
  const result = mergeStates(a, b);
  assert.deepEqual(result, mergeStates(b, a));
  assert.deepEqual(mergeStates(result, a), result);
  assert.equal(savedJourneys(result).length, 2);
  assert.equal(JSON.stringify(result).includes('currentLocation'), false);
  assert.equal(JSON.stringify(result).includes('count'), false);
  assert.equal(result.clock, 1);
});
test('concurrent edits resolve deterministically; deletion survives old snapshots', () => {
  const original = value(), id = journeyId(original);
  const a = changeJourney(emptyState(group), alice, id, original);
  const alternative = {...original, savedRoutes: [{mode: 'train', route: 'WEST'}]};
  const b = changeJourney(emptyState(group), bob, id, alternative);
  const merged = mergeStates(a, b);
  assert.deepEqual(merged, mergeStates(b, a));
  assert.deepEqual(savedJourneys(merged), [alternative]);
  const removed = changeJourney(merged, alice, id, null);
  assert.equal(savedJourneys(mergeStates(removed, a)).length, 0);
  assert.deepEqual(mergeStates(removed, b), removed);
  const explicitResave = changeJourney(removed, bob, id, original);
  assert.deepEqual(savedJourneys(mergeStates(removed, explicitResave)), [original]);
});
test('different delivery group, unknown data, conflicting stamps and oversized state refuse', () => {
  const original = value(), id = journeyId(original);
  const a = changeJourney(emptyState(group), alice, id, original);
  assert.throws(() => mergeStates(a, emptyState('b'.repeat(64))));
  assert.throws(() => validateState({...a, history: []}, group));
  assert.throws(() => validateState({...a, format: 2}, group));
  const changed = structuredClone(a); changed.journeys[0].value.to.name = 'Conflicting value';
  assert.throws(() => mergeStates(a, changed));
  const extra = structuredClone(a); extra.journeys[0].value.from.preciseLocation = true;
  assert.throws(() => validateState(extra, group));
  assert.throws(() => validateState({...a, journeys: Array(257).fill(a.journeys[0])}, group));
  assert.throws(() => changeJourney({...a, clock: Number.MAX_SAFE_INTEGER - 1}, alice, id, null));
});
test('three replicas converge after independent changes and reordered repeated snapshots', () => {
  const actors = [alice, bob, '3'.repeat(64)];
  let states = actors.map(() => emptyState(group));
  for (let n = 0; n < 45; n++) {
    const index = n % 3, journey = value(String(n % 7));
    states[index] = changeJourney(states[index], actors[index], journeyId(journey), n % 5 === 0 ? null : journey);
    if (n % 4 === 0) states[index] = mergeStates(states[index], states[(index + 1) % 3]);
  }
  const [a, b, c] = states;
  const result = mergeStates(mergeStates(a, b), c);
  assert.deepEqual(result, mergeStates(a, mergeStates(c, b)));
  for (let n = 0; n < 3; n++) for (let i = 0; i < 3; i++) states[i] = mergeStates(states[i], states[(i + 1) % 3]);
  for (const state of states) assert.deepEqual(state, result);
});
