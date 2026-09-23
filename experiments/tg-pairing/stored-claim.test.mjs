import assert from 'node:assert/strict';
import {inspectStoredClaim, readStoredClaim} from './stored-claim.mjs';

for (const [record, status] of [
  [null, 'missing'], [{revision: 2, value: null}, 'missing'],
  [{revision: 1, value: {format: 1}}, 'missing'],
  [{revision: 1, value: {format: 1, claim: 'OPEN'}}, 'invalid'],
  [{revision: 1, value: {format: 9, claim: 'open'}}, 'invalid'],
  [{revision: 0, value: {format: 1, claim: 'open'}}, 'invalid'],
]) {
  const store = {read: async (scope, key) => {
    assert.equal(scope, 'candidate-persona'); assert.equal(key, 'active'); return record;
  }};
  assert.deepEqual(await inspectStoredClaim(store), {status});
  await assert.rejects(readStoredClaim(store), {code: 'claim-' + status});
}
const unreadable = {read: async () => { throw new Error('Private storage diagnostic'); }};
assert.deepEqual(await inspectStoredClaim(unreadable), {status: 'unreadable'});
await assert.rejects(readStoredClaim(unreadable), {code: 'claim-unreadable'});
let current = {revision: 3, value: {format: 1, claim: 'open'}};
const store = {read: async () => current};
assert.equal(await readStoredClaim(store), 'open');
current = {revision: 4, value: {format: 1, claim: 'owner'}};
assert.equal(await readStoredClaim(store), 'owner');
current = null;
await assert.rejects(readStoredClaim(store), {code: 'claim-missing'});
console.log('PASS: missing, invalid and unreadable claims remain distinct and never become OPEN; each read observes current storage without writes or cached authority.');
