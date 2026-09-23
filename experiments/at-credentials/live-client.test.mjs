import test from 'node:test';
import assert from 'node:assert/strict';
import {createVaultATClient} from './live-client.mjs';
const response = () => ({ok: true, json: async () => ({header: {timestamp: 1000}, entity: []})});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };

test('explicit online reads use fixed AT endpoint and recheck permission without retaining a feed cache', async () => {
  let accesses = 0, connected = true;
  const calls = [];
  const client = createVaultATClient({vault: {getKey: async () => { accesses++; return 'synthetic-key'; }},
    now: () => 1001, online: () => connected,
    fetcher: async (url, options) => { calls.push({url, options}); return response(); }});
  assert.equal((await client.read('vehicles')).reason, 'not-requested');
  connected = false;
  assert.equal((await client.read('vehicles', {requested: true})).reason, 'offline');
  assert.equal(accesses, 0); assert.equal(calls.length, 0);
  connected = true;
  for (let i = 0; i < 2; i++) {
    const result = await client.read('vehicles', {requested: true});
    assert.equal(result.available, true);
    assert.equal(JSON.stringify(result).includes('synthetic-key'), false);
  }
  assert.equal(accesses, 4); assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.at.govt.nz/realtime/legacy/vehiclelocations');
  assert.equal(calls[0].options.headers['Ocp-Apim-Subscription-Key'], 'synthetic-key');
  assert.equal(calls[0].options.redirect, 'error');
  client.close();
  assert.equal((await client.read('vehicles', {requested: true})).available, false);
  assert.equal(accesses, 4);
});

for (const change of ['remove', 'rotate', 'offline']) test(`${change} during provider request suppresses result`, async () => {
  const entered = deferred(), release = deferred();
  let key = 'synthetic-old', online = true;
  const client = createVaultATClient({vault: {getKey: async () => {
    if (!key) throw new Error('private detail must not escape'); return key;
  }}, online: () => online, now: () => 1001,
  fetcher: async () => { entered.resolve(); await release.promise; return response(); }});
  const pending = client.read('predictions', {requested: true}); await entered.promise;
  if (change === 'remove') key = null;
  if (change === 'rotate') key = 'synthetic-new';
  if (change === 'offline') online = false;
  release.resolve();
  assert.equal((await pending).available, false);
  client.close();
});

test('cancel while obtaining credential returns promptly and prevents a late network call', async () => {
  const entered = deferred(), release = deferred(); let calls = 0, signal;
  const client = createVaultATClient({vault: {getKey: async options => {
    signal = options.signal; entered.resolve(); await release.promise; return 'synthetic-key';
  }}, fetcher: async () => { calls++; return response(); }});
  const pending = client.read('alerts', {requested: true}); await entered.promise;
  client.cancel();
  assert.equal((await pending).reason, 'cancelled'); assert.equal(signal.aborted, true);
  release.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0); client.close();
});

test('timeout covers final permission check even if vault ignores its abort signal', async () => {
  let calls = 0, finalSignal;
  const client = createVaultATClient({vault: {getKey: async ({signal}) => {
    if (++calls === 1) return 'synthetic-key';
    finalSignal = signal; return new Promise(() => {});
  }}, now: () => 1001, timeoutMs: 20, fetcher: async () => response()});
  assert.equal((await client.read('alerts', {requested: true})).reason, 'cancelled');
  assert.equal(calls, 2); assert.equal(finalSignal.aborted, true); client.close();
});

test('going offline during credential retrieval prevents the provider request', async () => {
  const entered = deferred(), release = deferred(); let connected = true, calls = 0;
  const client = createVaultATClient({vault: {getKey: async () => {
    entered.resolve(); await release.promise; return 'synthetic-key';
  }}, online: () => connected, fetcher: async () => { calls++; return response(); }});
  const pending = client.read('vehicles', {requested: true}); await entered.promise;
  connected = false; release.resolve();
  assert.equal((await pending).available, false); assert.equal(calls, 0); client.close();
});

test('close cancels simultaneous provider requests and ignores late responses', async () => {
  const entered = deferred(), release = deferred(), signals = [];
  const client = createVaultATClient({vault: {getKey: async () => 'synthetic-key'}, now: () => 1001,
    fetcher: async (url, {signal}) => {
      signals.push(signal); if (signals.length === 2) entered.resolve();
      await release.promise; return response();
    }});
  const requests = ['vehicles', 'alerts'].map(kind => client.read(kind, {requested: true}));
  await entered.promise; client.close();
  assert.deepEqual((await Promise.all(requests)).map(result => result.available), [false, false]);
  assert.equal(signals.every(signal => signal.aborted), true);
  release.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await client.read('vehicles', {requested: true})).available, false);
  assert.equal(signals.length, 2);
});

test('cancel is reusable while close is terminal', async () => {
  const client = createVaultATClient({vault: {getKey: async () => 'synthetic-key'}, now: () => 1001,
    fetcher: async () => response()});
  client.cancel(); assert.equal((await client.read('vehicles', {requested: true})).available, true);
  client.close(); assert.equal((await client.read('vehicles', {requested: true})).available, false);
});
