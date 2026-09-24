// Real IndexedDB checks. Only synthetic records and generated test keys are used.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const sources = new Map(await Promise.all(['storage.mjs', 'identity.mjs', 'invitation-journal.mjs'].map(async name => ['/' + name, await readFile(new URL('./' + name, import.meta.url))])));
if (process.env.STORAGE_MODULE) sources.set('/storage.mjs', await readFile(process.env.STORAGE_MODULE));
const server = createServer((req, res) => {
  if (sources.has(req.url)) { res.writeHead(200, {'Content-Type': 'text/javascript'}); res.end(sources.get(req.url)); }
  else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<!doctype html><title>Storage test</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'r2-browser-storage-'));
const options = {headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})};
let context;
try {
  context = await chromium.launchPersistentContext(profile, options);
  const first = await context.newPage(); await first.goto(url);
  const result = await first.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const store = await openBrowserStorage('test');
    const key = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    const created = await store.compareAndSwap('device', 'test-key', 0, key);
    const missing = await store.read('device', 'missing');
    const writes = await Promise.all(Array.from({length: 8}, (_, n) => store.compareAndSwap('app', 'race', 0, n)));
    const winner = await store.read('app', 'race');
    await store.remove('app', 'race', 1);
    const stale = await store.compareAndSwap('app', 'race', 1, 'resurrected');
    const otherScope = await store.read('other-app', 'race');
    let invalid;
    try { await store.compareAndSwap('app', 'bad', 0, () => {}); } catch (e) { invalid = e.code; }
    const afterInvalid = await store.read('app', 'bad');
    store.close();
    let closed;
    try { await store.read('app', 'race'); } catch (e) { closed = e.code; }
    return {created, missing, winners: writes.filter(w => w.applied).length, winnerRevision: winner.revision, stale, otherScope, invalid, afterInvalid, closed};
  });
  assert.deepEqual(result, {created: {applied: true, revision: 1}, missing: null, winners: 1, winnerRevision: 1, stale: {applied: false}, otherScope: null, invalid: 'fault', afterInvalid: null, closed: 'closed'});
  const guards = await first.evaluate(async () => {
    const store = await (await import('./storage.mjs')).openBrowserStorage('guarded-test');
    const change = (key, expectedRevision, value) => ({scope: 'app', key, expectedRevision, value});
    const check = (key, expectedRevision) => ({scope: 'app', key, expectedRevision});
    await store.compareAndSwap('app', 'policy', 0, {allowed: true});
    const guard = check('policy', 1);
    const saving = store.compareAndSwapMany([change('credential', 0, 'synthetic')], {checks: [guard, check('absent', 0)]});
    guard.expectedRevision = 99; // already snapshotted
    const saved = await saving;
    const unchanged = await store.read('app', 'policy');
    const absent = await store.read('app', 'absent');
    await store.compareAndSwap('app', 'policy', 1, {allowed: false});
    const refused = await store.compareAndSwapMany([change('credential', 1, 'must-not-save'), change('partial', 0, 1)], {checks: [check('policy', 1)]});
    let duplicate, malformed, oversized;
    try { await store.compareAndSwapMany([change('credential', 1, 2)], {checks: [check('credential', 1)]}); } catch (e) { duplicate = e.code; }
    try { await store.compareAndSwapMany([change('credential', 1, 2)], {checks: [{...check('policy', 2), value: 'not-a-write'}]}); } catch (e) { malformed = e.code; }
    try { await store.compareAndSwapMany([change('credential', 1, 2)], {checks: Array.from({length: 32}, (_, i) => check('guard' + i, 0))}); } catch (e) { oversized = e.code; }
    const kept = await store.read('app', 'credential'), partial = await store.read('app', 'partial');
    store.close(); return {saved, unchanged, absent, refused, duplicate, malformed, oversized, kept, partial};
  });
  assert.deepEqual(guards, {saved: {applied: true, revisions: [1]}, unchanged: {revision: 1, value: {allowed: true}},
    absent: null, refused: {applied: false}, duplicate: 'duplicate-key', malformed: 'invalid-check', oversized: 'invalid-batch',
    kept: {revision: 1, value: 'synthetic'}, partial: null});
  // Two independent pages race the same record, not merely one JS promise queue.
  const second = await context.newPage(); await second.goto(url);
  const races = await Promise.all([first, second].map(page => page.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const store = await openBrowserStorage('test');
    const result = await store.compareAndSwap('app', 'tabs', 0, 'synthetic'); store.close(); return result;
  })));
  assert.equal(races.filter(r => r.applied).length, 1);
  const identities = await Promise.all([first, second].map(page => page.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const {loadDeviceIdentity, provisionDeviceIdentity} = await import('./identity.mjs');
    const store = await openBrowserStorage('identity-test');
    const identity = await provisionDeviceIdentity(store);
    const reloaded = await loadDeviceIdentity(store);
    store.close(); return {id: identity.publicId, loaded: reloaded.publicId};
  })));
  assert.match(identities[0].id, /^[0-9a-f]{64}$/);
  assert.equal(identities[0].id, identities[1].id);
  assert.equal(identities[0].loaded, identities[0].id);
  const batchRaces = await Promise.all([first, second].map((page, candidate) => page.evaluate(async candidate => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const store = await openBrowserStorage('batch-test');
    const result = await store.compareAndSwapMany([
      {scope: 'persona', key: 'claim', expectedRevision: 0, value: {state: 'OWNER', candidate}},
      {scope: 'persona', key: 'membership', expectedRevision: 0, value: {candidate}},
    ]);
    store.close(); return result;
  }, candidate)));
  assert.equal(batchRaces.filter(r => r.applied).length, 1);
  const batchFailures = await first.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const store = await openBrowserStorage('batch-test');
    const change = (key, expectedRevision, value) => ({scope: 'persona', key, expectedRevision, value});
    const conflict = await store.compareAndSwapMany([change('claim', 0, 'wrong'), change('untouched', 0, 'wrong')]);
    let duplicate, invalid, full;
    try { await store.compareAndSwapMany([change('same', 0, 1), change('same', 0, 2)]); } catch (e) { duplicate = e.code; }
    try { await store.compareAndSwapMany([change('clone', 0, 1), change('function', 0, () => {})]); } catch (e) { invalid = e.code; }
    const put = IDBObjectStore.prototype.put; let calls = 0;
    try {
      IDBObjectStore.prototype.put = function(...args) {
        if (++calls === 2) throw new DOMException('synthetic', 'QuotaExceededError');
        return put.apply(this, args);
      };
      try { await store.compareAndSwapMany([change('claim', 1, 'damaged'), change('membership', 1, 'damaged')]); }
      catch (e) { full = e.code; }
    } finally { IDBObjectStore.prototype.put = put; }
    const claim = await store.read('persona', 'claim'), membership = await store.read('persona', 'membership');
    const absent = await Promise.all(['untouched', 'same', 'clone', 'function'].map(key => store.read('persona', key)));
    store.close();
    return {conflict, duplicate, invalid, full, unchanged: claim.revision === 1 && membership.revision === 1
      && claim.value.state === 'OWNER' && claim.value.candidate === membership.value.candidate, absent};
  });
  assert.deepEqual(batchFailures, {conflict: {applied: false}, duplicate: 'duplicate-key', invalid: 'fault', full: 'full', unchanged: true, absent: [null, null, null, null]});
  const invitationRace = await Promise.all([first, second].map(page => page.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const {reserveInvitation} = await import('./invitation-journal.mjs');
    const store = await openBrowserStorage('invitation-race');
    try {
      const handle = await reserveInvitation(store, new Uint8Array(32).fill(11), new Uint8Array(16).fill(11));
      // Simulate two UI handlers firing while the first transaction is pending.
      const results = await Promise.allSettled([handle.void(), handle.consumeWith([
        {scope: 'claim', key: 'unwanted', expectedRevision: 0, value: 'OWNER'},
      ])]);
      return {reserved: true, completed: results.filter(r => r.status === 'fulfilled').length,
        state: handle.state(), unwanted: await store.read('claim', 'unwanted')};
    } catch { return {reserved: false}; } finally { store.close(); }
  })));
  assert.equal(invitationRace.filter(r => r.reserved).length, 1);
  assert.deepEqual(invitationRace.find(r => r.reserved), {reserved: true, completed: 1, state: 'void', unwanted: null});
  const journal = await first.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const {reserveInvitation} = await import('./invitation-journal.mjs');
    const store = await openBrowserStorage('invitation-test');
    const group = new Uint8Array(32).fill(10), code = n => new Uint8Array(16).fill(n);
    const declined = await reserveInvitation(store, group, code(1)); await declined.void();
    let declinedInstall = false;
    try { await declined.consumeWith([{scope: 'claim', key: 'state', expectedRevision: 0, value: 'OWNER'}]); } catch { declinedInstall = true; }
    const accepted = await reserveInvitation(store, group, code(2));
    await accepted.consumeWith([
      {scope: 'claim', key: 'state', expectedRevision: 0, value: 'OWNER'},
      {scope: 'claim', key: 'membership', expectedRevision: 0, value: 'synthetic'},
    ]);
    let repeatedInstall = false;
    try { await accepted.consumeWith([{scope: 'claim', key: 'state', expectedRevision: 1, value: 'changed'}]); } catch { repeatedInstall = true; }
    const failed = await reserveInvitation(store, group, code(3));
    const put = IDBObjectStore.prototype.put; let count = 0, error;
    try {
      IDBObjectStore.prototype.put = function(...args) {
        if (++count === 2) throw new DOMException('synthetic', 'QuotaExceededError');
        return put.apply(this, args);
      };
      try { await failed.consumeWith([{scope: 'claim', key: 'partial', expectedRevision: 0, value: 'wrong'}]); } catch (e) { error = e.code; }
    } finally { IDBObjectStore.prototype.put = put; }
    const partial = await store.read('claim', 'partial');
    // Leave an untouched reservation, representing a lost browser process.
    await reserveInvitation(store, group, code(4));
    const states = [declined.state(), accepted.state(), failed.state()];
    store.close(); return {declinedInstall, repeatedInstall, error, partial, states};
  });
  assert.deepEqual(journal, {declinedInstall: true, repeatedInstall: true, error: 'full', partial: null, states: ['void', 'consumed', 'unavailable']});
  await context.close();
  context = await chromium.launchPersistentContext(profile, options);
  const page = await context.newPage(); await page.goto(url);
  await page.evaluate(() => import('./storage.mjs'));
  await page.evaluate(() => import('./identity.mjs'));
  await page.evaluate(() => import('./invitation-journal.mjs'));
  await context.setOffline(true);
  const restoredBatch = await page.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const store = await openBrowserStorage('batch-test');
    const claim = await store.read('persona', 'claim'), membership = await store.read('persona', 'membership');
    store.close(); return claim.revision === 1 && membership.revision === 1
      && claim.value.state === 'OWNER' && claim.value.candidate === membership.value.candidate;
  });
  assert.equal(restoredBatch, true);
  const restoredInvitations = await page.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const {reserveInvitation} = await import('./invitation-journal.mjs');
    const store = await openBrowserStorage('invitation-test'); let refusals = 0;
    for (let n = 1; n <= 4; n++) {
      try { await reserveInvitation(store, new Uint8Array(32).fill(10), new Uint8Array(16).fill(n)); } catch { refusals++; }
    }
    const claim = await store.read('claim', 'state'), membership = await store.read('claim', 'membership');
    store.close(); return {refusals, installed: claim.value === 'OWNER' && membership.value === 'synthetic'};
  });
  assert.deepEqual(restoredInvitations, {refusals: 4, installed: true});


  const restarted = await page.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const store = await openBrowserStorage('test');
    const record = await store.read('device', 'test-key');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, record.value, new Uint8Array([1, 2, 3]));
    const plaintext = await crypto.subtle.decrypt({name: 'AES-GCM', iv}, record.value, ciphertext);
    const tombstone = await store.read('app', 'race');
    store.close(); return {extractable: record.value.extractable, plaintext: [...new Uint8Array(plaintext)], tombstone};
  });
  assert.deepEqual(restarted, {extractable: false, plaintext: [1, 2, 3], tombstone: {revision: 2, value: null}});
  const identityRestart = await page.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const {loadDeviceIdentity, provisionDeviceIdentity} = await import('./identity.mjs');
    const store = await openBrowserStorage('identity-test');
    const identity = await loadDeviceIdentity(store);
    const bytes = Uint8Array.from(identity.publicId.match(/../g), b => parseInt(b, 16));
    const publicKey = await crypto.subtle.importKey('raw', bytes, 'Ed25519', false, ['verify']);
    const message = new Uint8Array([4, 5, 6]);
    const signature = await identity.sign(message);
    const verified = await crypto.subtle.verify('Ed25519', publicKey, signature, message);
    const oldHandle = await loadDeviceIdentity(store);
    await identity.forget();
    let denied, reprovision;
    try { await oldHandle.sign(message); } catch (e) { denied = e.code; }
    try { await provisionDeviceIdentity(store); } catch (e) { reprovision = e.code; }
    const missing = await loadDeviceIdentity(store); store.close();
    return {id: identity.publicId, verified, denied, reprovision, missing};
  });
  assert.deepEqual(identityRestart, {id: identities[0].id, verified: true, denied: 'identity-unavailable', reprovision: 'identity-forgotten', missing: null});
  const refusedIdentity = await page.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const {loadDeviceIdentity, provisionDeviceIdentity} = await import('./identity.mjs');
    const store = await openBrowserStorage('identity-refusal');
    const absent = await loadDeviceIdentity(store);
    const put = IDBObjectStore.prototype.put;
    let failedProvision;
    try {
      IDBObjectStore.prototype.put = function() { throw new DOMException('synthetic', 'QuotaExceededError'); };
      try { await provisionDeviceIdentity(store); } catch (e) { failedProvision = e.code; }
    } finally { IDBObjectStore.prototype.put = put; }
    const afterFailure = await loadDeviceIdentity(store);
    const a = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    const b = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    await store.compareAndSwap('runtime-identity', 'device', 0, {format: 1, privateKey: a.privateKey, publicKey: b.publicKey});
    let mismatch;
    try { await loadDeviceIdentity(store); } catch (e) { mismatch = e.code; }
    store.close(); return {absent, failedProvision, afterFailure, mismatch};
  });
  assert.deepEqual(refusedIdentity, {absent: null, failedProvision: 'full', afterFailure: null, mismatch: 'identity-unavailable'});
  const failures = await page.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const store = await openBrowserStorage('test');
    const put = IDBObjectStore.prototype.put;
    let full, aborted;
    try {
      IDBObjectStore.prototype.put = function() { throw new DOMException('synthetic', 'QuotaExceededError'); };
      try { await store.compareAndSwap('app', 'failure', 0, 'synthetic'); } catch (e) { full = e.code; }
      IDBObjectStore.prototype.put = function(...args) {
        const request = put.apply(this, args); this.transaction.abort(); return request;
      };
      try { await store.compareAndSwap('app', 'failure', 0, 'synthetic'); } catch (e) { aborted = e.code; }
    } finally { IDBObjectStore.prototype.put = put; }
    const afterFailure = await store.read('app', 'failure');
    // Deliberate corrupt fixture: bypass the public API to exercise its reader.
    const raw = await new Promise((resolve, reject) => {
      const request = indexedDB.open('r2-browser:test', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = reject;
    });
    await new Promise((resolve, reject) => {
      const tx = raw.transaction('records', 'readwrite');
      tx.objectStore('records').put({value: 'invalid revision'}, ['app', 'corrupt']);
      tx.oncomplete = resolve; tx.onabort = reject;
    });
    raw.close();
    let corruptRead, corruptWrite;
    try { await store.read('app', 'corrupt'); } catch (e) { corruptRead = e.code; }
    try { await store.compareAndSwap('app', 'corrupt', 0, 'replacement'); } catch (e) { corruptWrite = e.code; }
    store.close(); return {full, aborted, afterFailure, corruptRead, corruptWrite};
  });
  assert.deepEqual(failures, {full: 'full', aborted: 'fault', afterFailure: null, corruptRead: 'corrupt', corruptWrite: 'corrupt'});
  console.log('PASS: independent tabs cannot reserve one invitation twice; concurrent decline/install handlers cannot both commit.');
  console.log('PASS: declined, consumed, interrupted and failed invitation reservations cannot be reused after restart; consumption commits with the installation set and write failure leaves no partial install.');
  console.log('PASS: atomic multi-record updates elect one competing tab, survive restart, and leave every record unchanged after a conflict, duplicate, clone failure or second-write quota failure.');
  console.log('PASS: committed records and non-extractable test key survive browser restart; offline access, concurrent tabs, tombstones, namespace isolation, clone failure and closed-store failure.');
  console.log('PASS: quota errors distinguished from other faults; aborted writes do not commit; corrupt records are never treated as absent.');
  console.log('PASS: concurrent provisioning publishes one committed Ed25519 identity; restart retains it; offline signatures verify; forgetting rejects stale handles and implicit replacement.');
  console.log('PASS: failed identity commit returns no identity; ordinary load never provisions; mismatched public/private custody is refused.');
} finally {
  await context?.close(); await new Promise(resolve => server.close(resolve));
  await rm(profile, {recursive: true, force: true});
}
