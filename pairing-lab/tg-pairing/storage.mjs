// Async browser persistence foundation. Not an implementation of the synchronous
// Rust Storage trait, a TG membership verifier, or an application-secret policy.
export class BrowserStorageError extends Error {
  constructor(code) { super(`Browser storage: ${code}`); this.name = 'BrowserStorageError'; this.code = code; }
}
const failure = error => new BrowserStorageError(error?.name === 'QuotaExceededError' ? 'full' : 'fault');
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value);
const validRecord = value => value && Number.isSafeInteger(value.revision) && value.revision > 0 && Object.hasOwn(value, 'value');

export async function openBrowserStorage(name) {
  if (!identifier(name)) throw new BrowserStorageError('invalid-name');
  if (!globalThis.isSecureContext || !globalThis.indexedDB) throw new BrowserStorageError('unavailable');
  const db = await new Promise((resolve, reject) => {
    let abandoned = false;
    const request = indexedDB.open(`r2-browser:${name}`, 1);
    request.onupgradeneeded = () => {
      if (abandoned) { request.transaction.abort(); return; }
      request.result.createObjectStore('records');
    };
    request.onerror = () => reject(failure(request.error));
    request.onblocked = () => { abandoned = true; reject(new BrowserStorageError('blocked')); };
    request.onsuccess = () => {
      if (abandoned) { request.result.close(); return; }
      resolve(request.result);
    };
  });
  let closed = false;
  const close = () => { closed = true; db.close(); };
  db.onversionchange = close;
  db.onclose = () => { closed = true; };

  // No await inside a transaction: all read/compare/write operations share its
  // serializable scope. A request's success is not a durable commit receipt.
  const transact = (mode, operation, signal) => new Promise((resolve, reject) => {
    if (closed) { reject(new BrowserStorageError('closed')); return; }
    if (signal?.aborted) { reject(new BrowserStorageError('cancelled')); return; }
    let tx, result, error, finished = false;
    const cancel = () => {
      if (finished) return;
      // If complete has already been queued, abort() refuses. The actual
      // completion event then wins; cancellation cannot undo a durable commit.
      try { tx.abort(); error ??= new BrowserStorageError('cancelled'); } catch {}
    };
    const finish = () => { finished = true; signal?.removeEventListener('abort', cancel); };
    try {
      tx = db.transaction('records', mode, {durability: 'strict'});
      tx.oncomplete = () => { finish(); resolve(result); };
      tx.onabort = () => { finish(); reject(error || failure(tx.error)); };
      tx.onerror = () => {}; // Abort is the terminal failure event.
      if (mode === 'readwrite' && tx.durability !== 'strict') {
        error = new BrowserStorageError('strict-durability-unavailable'); tx.abort(); return;
      }
      signal?.addEventListener('abort', cancel, {once: true});
      if (signal?.aborted) { cancel(); return; }
      operation(tx.objectStore('records'), value => { result = value; }, reason => {
        error ??= reason; tx.abort();
      });
    } catch (cause) {
      error ??= failure(cause);
      if (tx) { try { tx.abort(); } catch { finish(); reject(error); } }
      else { finish(); reject(error); }
    }
  });
  const keyOf = (scope, key) => {
    if (!identifier(scope) || !identifier(key)) throw new BrowserStorageError('invalid-key');
    return [scope, key];
  };
  const read = (scope, key) => {
    const id = keyOf(scope, key);
    return transact('readonly', (store, done, abort) => {
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result !== undefined && !validRecord(request.result)) { abort(new BrowserStorageError('corrupt')); return; }
        done(request.result ?? null);
      };
    });
  };
  const compareAndSwapMany = (changes, {signal, checks = []} = {}) => {
    if (!Array.isArray(changes) || changes.length < 1 || !Array.isArray(checks) || changes.length + checks.length > 32) throw new BrowserStorageError('invalid-batch');
    const seen = new Set();
    // Snapshot writes and read-only revision guards before opening a transaction.
    // Guards participate in the same transaction but never rewrite evidence.
    const snapshots = [...changes, ...checks].map((change, index) => {
      const write = index < changes.length;
      if (!change || typeof change !== 'object') throw new BrowserStorageError('invalid-batch');
      if (!write && (Reflect.ownKeys(change).length !== 3
          || !['scope', 'key', 'expectedRevision'].every(key => Object.hasOwn(change, key))))
        throw new BrowserStorageError('invalid-check');
      const {scope, key, expectedRevision, value} = change;
      const id = keyOf(scope, key), encodedId = JSON.stringify(id);
      if (seen.has(encodedId)) throw new BrowserStorageError('duplicate-key');
      seen.add(encodedId);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || (write && expectedRevision === Number.MAX_SAFE_INTEGER))
        throw new BrowserStorageError('invalid-revision');
      let snapshot;
      try { if (write) snapshot = structuredClone(value); } catch (cause) { throw failure(cause); }
      return {id, expectedRevision, value: snapshot, write};
    });
    return transact('readwrite', (store, done, abort) => {
      let remaining = snapshots.length;
      const previous = new Array(remaining);
      for (const [index, change] of snapshots.entries()) {
        const request = store.get(change.id);
        request.onsuccess = () => {
          previous[index] = request.result;
          if (--remaining !== 0) return;
          // No write is queued until every record and comparison is checked.
          if (previous.some(record => record !== undefined && !validRecord(record))) { abort(new BrowserStorageError('corrupt')); return; }
          if (snapshots.some((item, i) => (previous[i]?.revision ?? 0) !== item.expectedRevision)) { done({applied: false}); return; }
          try {
            for (const item of snapshots.filter(item => item.write)) store.put({revision: item.expectedRevision + 1, value: item.value}, item.id);
            done({applied: true, revisions: snapshots.filter(item => item.write).map(item => item.expectedRevision + 1)});
          } catch (cause) { abort(failure(cause)); }
        };
      }
    }, signal);
  };
  const compareAndSwap = async (scope, key, expectedRevision, value) => {
    const result = await compareAndSwapMany([{scope, key, expectedRevision, value}]);
    return result.applied ? {applied: true, revision: result.revisions[0]} : result;
  };
  return Object.freeze({read, compareAndSwap, compareAndSwapMany, close,
    capabilities: Object.freeze({transactionChecks: true}),
    // Namespaces prevent accidental key collisions, not hostile same-origin JS.
    // Persisting null is a versioned tombstone; it prevents stale-tab resurrection.
    remove: (scope, key, expectedRevision) => compareAndSwap(scope, key, expectedRevision, null),
    persistence: async () => {
      try { return {evictionProtected: await navigator.storage.persisted()}; }
      catch { return {evictionProtected: false}; }
    },
  });
}
