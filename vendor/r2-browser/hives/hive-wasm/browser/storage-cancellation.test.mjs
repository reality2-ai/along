// Real IndexedDB cancellation timing. Synthetic records only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const source = await readFile(process.env.STORAGE_MODULE || new URL('./storage.mjs', import.meta.url));
const journalSource = await readFile(new URL('./invitation-journal.mjs', import.meta.url));
const server = createServer((req, res) => {
  if (req.url === '/storage.mjs') { res.setHeader('Content-Type', 'text/javascript'); res.end(source); }
  else if (req.url === '/invitation-journal.mjs') { res.setHeader('Content-Type', 'text/javascript'); res.end(journalSource); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Atomic cancellation test</title>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH});
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const {openBrowserStorage} = await import('./storage.mjs');
    const store = await openBrowserStorage('cancel-transaction-test');
    const {reserveInvitation} = await import('./invitation-journal.mjs');
    const change = (key, value) => ({scope: 'test', key, expectedRevision: 0, value});
    const check = (value, why) => { if (!value) throw new Error(why); };
    const cancelled = async action => {
      try { await action(); } catch (error) { check(error.code === 'cancelled', `Wrong refusal: ${error.code}`); return; }
      throw new Error('Cancellation must refuse a pending write');
    };
    const before = new AbortController(); before.abort();
    await cancelled(() => store.compareAndSwapMany([change('before', 1)], {signal: before.signal}));
    check(await store.read('test', 'before') === null, 'pre-cancelled write must not appear');

    const during = new AbortController();
    const originalPut = IDBObjectStore.prototype.put; let puts = 0;
    IDBObjectStore.prototype.put = function(...args) {
      const request = originalPut.apply(this, args);
      if (++puts === 2) during.abort();
      return request;
    };
    try {
      await cancelled(() => store.compareAndSwapMany([change('first', 1), change('second', 2)], {signal: during.signal}));
    } finally { IDBObjectStore.prototype.put = originalPut; }
    check(puts === 2, 'both writes must actually be queued before cancellation');
    check(await store.read('test', 'first') === null && await store.read('test', 'second') === null, 'cancelled batch must roll back both writes');

    const after = new AbortController();
    const originalTransaction = IDBDatabase.prototype.transaction;
    let completed = 0;
    IDBDatabase.prototype.transaction = function(...args) {
      const tx = originalTransaction.apply(this, args);
      if (args[1] === 'readwrite') tx.addEventListener('complete', () => { completed++; after.abort(); }, {once: true});
      return tx;
    };
    let committed;
    try {
      committed = await store.compareAndSwapMany([change('committed-a', 3), change('committed-b', 4)], {signal: after.signal});
    } finally { IDBDatabase.prototype.transaction = originalTransaction; }
    check(completed === 1 && after.signal.aborted, 'cancellation must occur during completion delivery');
    check(committed.applied && committed.revisions.every(v => v === 1), 'actual commit must win over late cancellation');
    check((await store.read('test', 'committed-a')).value === 3 && (await store.read('test', 'committed-b')).value === 4, 'reported commit matches actual records');
    const group = new Uint8Array(32).fill(10), code = n => new Uint8Array(16).fill(n);
    const reserved = await reserveInvitation(store, group, code(1));
    const journalAbort = new AbortController(); let journalPuts = 0;
    IDBObjectStore.prototype.put = function(...args) {
      const request = originalPut.apply(this, args);
      if (++journalPuts === 2) journalAbort.abort();
      return request;
    };
    try {
      await cancelled(() => reserved.consumeWith([change('cancelled-claim', 'OWNER'), change('cancelled-persona', 'synthetic')], {signal: journalAbort.signal}));
    } finally { IDBObjectStore.prototype.put = originalPut; }
    check(reserved.state() === 'unavailable', 'failed consumption has no retryable handle');
    check(await store.read('test', 'cancelled-claim') === null && await store.read('test', 'cancelled-persona') === null, 'journal and installation writes roll back together');
    let reused = false;
    try { await reserveInvitation(store, group, code(1)); reused = true; } catch {}
    check(!reused, 'cancelled reservation cannot be reopened');
    const hex = value => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
    const journalKey = n => hex(group) + ':' + hex(code(n));
    check((await store.read('enrollment-invitations', journalKey(1))).value.state === 'reserved', 'failed consume must not claim a committed terminal state');

    const accepted = await reserveInvitation(store, group, code(2));
    const late = new AbortController();
    IDBDatabase.prototype.transaction = function(...args) {
      const tx = originalTransaction.apply(this, args);
      if (args[1] === 'readwrite') tx.addEventListener('complete', () => late.abort(), {once: true});
      return tx;
    };
    let receipt;
    try {
      receipt = await accepted.consumeWith([change('accepted-claim', 'OWNER'), change('accepted-persona', 'synthetic')], {signal: late.signal});
    } finally { IDBDatabase.prototype.transaction = originalTransaction; }
    check(late.signal.aborted && receipt.state === 'consumed' && receipt.revisions.length === 2 && receipt.revisions.every(v => v === 1), 'receipt describes actual completed installation writes');
    check(accepted.state() === 'consumed', 'late cancellation cannot revoke the committed receipt');
    check((await store.read('test', 'accepted-claim')).value === 'OWNER' && (await store.read('enrollment-invitations', journalKey(2))).value.state === 'consumed', 'claim and journal agree with receipt');
    store.close();
    const reopened = await openBrowserStorage('cancel-transaction-test');
    check(await reopened.read('test', 'first') === null && (await reopened.read('test', 'committed-b')).value === 4, 'reopen agrees with transaction outcomes');
    check((await reopened.read('enrollment-invitations', journalKey(1))).value.state === 'reserved' && (await reopened.read('enrollment-invitations', journalKey(2))).value.state === 'consumed', 'reopened journal agrees with both outcomes');
    reopened.close(); return true;
  });
  assert.equal(result, true);
  console.log('PASS: pre-cancelled batches refuse; cancellation after both puts rolls back both; cancellation during completion delivery preserves the actual committed result; reopened records agree. Transaction primitive only, not enrollment or power-loss qualification.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
