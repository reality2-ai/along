import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {createRelayHello} from './hello.mjs';
// Reload the existing installed identity on every connection. No new identity,
// root signing key or AT credential is created or exported for a relay.
export async function createLocalRelayHello({wasm, store, expectedGroup, signal}) {
  const current = () => { if (signal?.aborted) throw Error('Relay greeting cancelled'); };
  current();
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) throw Error('Relay group unavailable');
  const group = expectedGroup.slice(), observed = new Map();
  const audited = {...store, read: async (scope, key) => {
    current();
    const record = await store.read(scope, key), revision = record?.revision ?? 0, id = scope + '\0' + key;
    current();
    if (observed.has(id) && observed.get(id).revision !== revision) throw Error('Relay identity changed');
    observed.set(id, {scope, key, revision});
    return record;
  }};
  const persona = await loadLocalPersona({wasm, store:audited, expectedGroup:group});
  const hello = await createRelayHello({persona, expectedGroup:group, signal});
  // Include the async signature verification window, not just signing itself.
  // This is a use-time check, not a continuing grant to send application data.
  for (const {scope, key, revision} of observed.values()) {
    if (((await store.read(scope, key))?.revision ?? 0) !== revision) throw Error('Relay identity changed');
    current();
  }
  return hello;
}
