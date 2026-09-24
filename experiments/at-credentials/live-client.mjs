import {createATClient} from '../../at-client.js';

// Experimental transport adapter. Callers still apply Along's verified journey/
// stop filters; a network feed is not itself contextual advice. No shared cache.
export function createVaultATClient({vault, fetcher = globalThis.fetch,
  synchronizePolicy,
  online = () => globalThis.navigator?.onLine !== false,
  now = () => Date.now() / 1000, timeoutMs = 5000} = {}) {
  if (typeof vault?.getKey !== 'function') throw new Error('AT vault required');
  if (synchronizePolicy !== undefined && typeof synchronizePolicy !== 'function') throw new Error('Invalid policy synchronizer');
  const pending = new Set();
  let closed = false;
  const unavailable = reason => ({available: false, reason});
  function cancel() { for (const controller of pending) controller.abort(); }
  async function read(kind, {requested = false} = {}) {
    if (!['predictions', 'alerts', 'vehicles'].includes(kind)) throw new Error('Unknown live feed.');
    if (!requested) return unavailable('not-requested');
    if (closed) return unavailable('cancelled');
    if (!online()) { cancel(); return unavailable('offline'); }
    const controller = new AbortController(), {signal} = controller;
    pending.add(controller);
    let client, heldKey, onAbort;
    const aborted = new Promise(resolve => {
      onAbort = () => { client?.cancel(); resolve(unavailable('cancelled')); };
      signal.addEventListener('abort', onAbort, {once: true});
    });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const work = (async () => {
      try {
        if (synchronizePolicy) await synchronizePolicy({signal});
        if (signal.aborted || !online()) return unavailable('cancelled');
        client = createATClient({fetcher, online, now, timeoutMs, getKey: async () => {
          const key = await vault.getKey({signal});
          if (signal.aborted || !online()) throw new Error('Cancelled');
          heldKey = key;
          return key;
        }});
        const result = await client.read(kind, {requested: true});
        if (!result.available || signal.aborted) return unavailable('unavailable');
        // Recheck after network I/O: locally accepted removals/rotation must stop
        // this result even if the provider already received the earlier key.
        const currentKey = await vault.getKey({signal});
        if (signal.aborted || !online() || currentKey !== heldKey) return unavailable('cancelled');
        return result;
      } catch { return unavailable('unavailable'); }
      finally { heldKey = undefined; client?.cancel(); }
    })();
    try { return await Promise.race([work, aborted]); }
    finally {
      clearTimeout(timer); pending.delete(controller);
      signal.removeEventListener('abort', onAbort);
      heldKey = undefined; client?.cancel();
    }
  }
  return Object.freeze({read, cancel, close() { closed = true; cancel(); }});
}
