import test from 'node:test';
import assert from 'node:assert/strict';
import {createScopedSessionClient} from './scoped-session-client.mjs';

test('screen cancellation reaches only its pending reads and never closes the shared session', async () => {
  const calls = [], lifetime = new AbortController();
  const session = {signal: lifetime.signal, cancel() { throw Error('Shared cancel called'); }, close() { throw Error('Shared close called'); },
    read: (kind, {signal}) => new Promise(resolve => {
      calls.push({kind, signal, resolve});
      signal.addEventListener('abort', () => resolve({available: false, reason: 'cancelled'}), {once: true});
    })};
  const first = createScopedSessionClient(session), second = createScopedSessionClient(session);
  assert.equal((await first.read('alerts')).reason, 'not-requested');
  assert.equal(calls.length, 0);
  const a = first.read('alerts', {requested: true}), b = second.read('vehicles', {requested: true});
  first.close();
  assert.equal((await a).reason, 'cancelled');
  assert.equal(calls[0].signal.aborted, true); assert.equal(calls[1].signal.aborted, false);
  calls[1].resolve({available: true}); assert.equal((await b).available, true);
  assert.equal((await first.read('alerts', {requested: true})).reason, 'cancelled');
  const c = second.read('predictions', {requested: true}); second.cancel();
  assert.equal((await c).reason, 'cancelled');
  const d = second.read('alerts', {requested: true}); calls[3].resolve({available: true});
  assert.equal((await d).available, true);
  lifetime.abort(); assert.equal((await second.read('alerts', {requested: true})).reason, 'cancelled');
  second.close();
});
