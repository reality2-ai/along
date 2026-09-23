import test from 'node:test';
import assert from 'node:assert/strict';
import {configureAppLiveConnection, createLiveClient} from './app-live-bridge.mjs';
const deferred = () => { let resolve; return {promise: new Promise(yes => { resolve = yes; }), resolve: value => resolve(value)}; };

test('no configuration or explicit request means no underlying client; close is terminal', async () => {
  configureAppLiveConnection(undefined);
  const client = createLiveClient(); let created = 0;
  assert.equal(client.configured, false);
  assert.equal((await client.read('alerts', {requested: true})).reason, 'not-configured');
  configureAppLiveConnection(() => { created++; return {read: async () => ({available: true}), cancel() {}, close() {}}; });
  assert.equal(client.configured, true);
  assert.equal((await client.read('alerts')).reason, 'not-requested'); assert.equal(created, 0);
  assert.equal((await client.read('alerts', {requested: true})).available, true); assert.equal(created, 1);
  client.close();
  assert.equal(client.configured, false);
  assert.equal((await client.read('alerts', {requested: true})).reason, 'cancelled'); assert.equal(created, 1);
  configureAppLiveConnection(undefined);
});

test('changing device context suppresses a late old response even when transport ignores cancellation', async () => {
  const delayed = deferred(); let closed = 0;
  configureAppLiveConnection(() => ({read: () => delayed.promise, close() { closed++; }, cancel() {}}));
  const client = createLiveClient();
  const pending = client.read('predictions', {requested: true});
  configureAppLiveConnection(() => ({read: async () => ({available: true, source: 'new-context'}), close() {}, cancel() {}}));
  assert.equal(closed, 1);
  delayed.resolve({available: true, source: 'old-context'});
  assert.equal((await pending).reason, 'cancelled');
  assert.equal((await client.read('predictions', {requested: true})).source, 'new-context');
  client.close(); configureAppLiveConnection(undefined);
});

test('separate screen clients own separate transport cancellation and cancelled clients can retry', async () => {
  const delayed = [deferred(), deferred()]; let created = 0;
  configureAppLiveConnection(() => { const index = created++; return {read: () => delayed[index]?.promise || Promise.resolve({available: true}), close() {}, cancel() {}}; });
  const first = createLiveClient(), second = createLiveClient();
  const a = first.read('alerts', {requested: true}), b = second.read('vehicles', {requested: true});
  first.cancel(); delayed[0].resolve({available: true}); delayed[1].resolve({available: true});
  assert.equal((await a).reason, 'cancelled'); assert.equal((await b).available, true);
  assert.equal((await first.read('alerts', {requested: true})).available, true); assert.equal(created, 3);
  first.close(); second.close(); configureAppLiveConnection(undefined);
});
