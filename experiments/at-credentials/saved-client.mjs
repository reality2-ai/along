import {loadATBinding} from './local-owner.mjs';
import {openLocalATVault} from './local-vault.mjs';
import {createVaultATClient} from './live-client.mjs';

// Application adapter: restore the user's accepted binding for each requested
// read. Never adopt an owner from a feed or assume that TG membership grants AT
// access. Recipient callers must supply the authenticated policy-sync controller.
export function createSavedATClient({wasm, store, expectedGroup, synchronizeOwnerPolicy,
  fetcher, online, now, timeoutMs} = {}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32
      || synchronizeOwnerPolicy !== undefined && typeof synchronizeOwnerPolicy !== 'function') throw new Error('Saved AT context unavailable');
  const group = expectedGroup.slice(), active = new Set();
  let closed = false, policyQueue = Promise.resolve();
  const equalBinding = (a, b) => a.group === b.group && a.owner === b.owner && a.credential === b.credential;
  const cancel = () => { for (const client of active) client.cancel(); };
  return Object.freeze({
    async read(kind, options = {}) {
      if (!['predictions', 'alerts', 'vehicles'].includes(kind)) throw new Error('Unknown live feed.');
      if (options.requested !== true) return {available: false, reason: 'not-requested'};
      if (closed) return {available: false, reason: 'cancelled'};
      // Per-read state prevents simultaneous alerts/predictions from sharing an
      // asynchronously replaced vault. The inner timeout includes restore/sync.
      let vault;
      const client = createVaultATClient({fetcher, online, now, timeoutMs,
        vault: {getKey: options => {
          if (!vault) throw new Error('Saved key unavailable');
          return vault.getKey(options);
        }},
        synchronizePolicy: async ({signal}) => {
          const saved = await loadATBinding({wasm, store, expectedGroup: group, signal});
          if (!saved) throw new Error('No accepted AT settings');
          if (saved.role === 'recipient') {
            if (!synchronizeOwnerPolicy) throw new Error('Owner check unavailable');
            // The controller must bind its authenticated owner/session to this
            // accepted binding; it must reject a mismatch, not select a new owner.
            const checked = policyQueue.then(() => {
              if (signal.aborted) throw new Error('Cancelled');
              return synchronizeOwnerPolicy({binding: saved.binding, signal});
            });
            policyQueue = checked.catch(() => {});
            await checked;
          }
          if (signal.aborted) throw new Error('Cancelled');
          const latest = await loadATBinding({wasm, store, expectedGroup: group, signal});
          if (!latest || latest.role !== saved.role || !equalBinding(latest.binding, saved.binding)) throw new Error('AT settings changed');
          vault = openLocalATVault({wasm, store, ...latest.binding});
        }});
      active.add(client);
      try { return await client.read(kind, {requested: true}); }
      finally { active.delete(client); client.close(); vault = undefined; }
    },
    cancel,
    close() { closed = true; cancel(); },
  });
}
