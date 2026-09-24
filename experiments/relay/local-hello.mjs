import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {createRelayHello} from './hello.mjs';
// Reload the existing installed identity on every connection. No new identity,
// root signing key or AT credential is created or exported for a relay.
export async function createLocalRelayHello({wasm, store, expectedGroup, signal}) {
  if (signal?.aborted) throw Error('Relay greeting cancelled');
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) throw Error('Relay group unavailable');
  const group = expectedGroup.slice();
  const persona = await loadLocalPersona({wasm, store, expectedGroup:group});
  return createRelayHello({persona, expectedGroup:group, signal});
}
