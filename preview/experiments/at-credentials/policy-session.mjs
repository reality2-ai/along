import {openLocalPersonaSession} from '../tg-pairing/local-persona-session.mjs';
import {loadATBinding} from './local-owner.mjs';
import {createPolicySync, answerPolicyCheck, isPolicyCheckRequest, isPolicyCheckResponse} from './policy-sync.mjs';
import {createSavedATClient} from './saved-client.mjs';
const same = (a, b) => a.group === b.group && a.owner === b.owner && a.credential === b.credential;
const unhex = value => Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
const fail = () => new Error('AT owner connection unavailable');

// Restored-device controller for policy freshness, not enrollment or credential
// delivery. The recipient's peer comes only from its previously accepted owner.
// The owner explicitly selects a group member; the runtime authenticates its key.
export async function openATPolicySession({wasm, store, expectedGroup, role, peer, signal,
  fetcher, online, now, timeoutMs} = {}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32
      || !['owner', 'recipient'].includes(role)
      || role === 'owner' && (!(peer instanceof Uint8Array) || peer.length !== 32)
      || role === 'recipient' && peer !== undefined) throw fail();
  const group = expectedGroup.slice(), selectedPeer = peer?.slice();
  const lifetime = new AbortController();
  let session, sync, client, closed = false;
  const close = () => {
    if (closed) return;
    closed = true; lifetime.abort(); signal?.removeEventListener('abort', close);
    client?.close(); sync?.close(); session?.close();
  };
  const current = () => { if (closed || signal?.aborted) throw fail(); };
  signal?.addEventListener('abort', close, {once: true});
  try {
    current();
    const saved = await loadATBinding({wasm, store, expectedGroup: group, signal: lifetime.signal}); current();
    if (!saved || saved.role !== role) throw fail();
    const remote = role === 'recipient' ? unhex(saved.binding.owner) : selectedPeer;
    session = await openLocalPersonaSession({wasm, store, expectedGroup: group, peer: remote,
      role: role === 'recipient' ? 'offer' : 'answer', signal: lifetime.signal,
      onMessage: async packet => {
        current();
        if (role === 'recipient') {
          if (!sync || !isPolicyCheckResponse(packet)) throw fail();
          await sync.receive(packet);
        } else {
          if (!isPolicyCheckRequest(packet)) throw fail();
          const latest = await loadATBinding({wasm, store, expectedGroup: group, signal: lifetime.signal}); current();
          if (!latest || latest.role !== 'owner' || !same(latest.binding, saved.binding)) throw fail();
          await answerPolicyCheck({wasm, store, expectedGroup: group, connection: session, packet});
        }
        current();
      }});
    if (closed) { session.close(); throw fail(); }
    session.signal.addEventListener('abort', close, {once: true});
    if (session.signal.aborted) close();
    current();
    if (role === 'recipient') {
      sync = createPolicySync({wasm, store, expectedGroup: group, peer: remote, connection: session, timeoutMs});
      client = createSavedATClient({wasm, store, expectedGroup: group, fetcher, online, now, timeoutMs,
        synchronizeOwnerPolicy: ({binding, signal}) => {
          current();
          if (!same(binding, saved.binding)) throw fail();
          return sync.check({signal});
        }});
    }
    return Object.freeze({
      offer: async () => { current(); if (role !== 'recipient') throw fail(); return session.offer(); },
      accept: async description => { current(); return session.accept(description); },
      authenticated: async () => { current(); await session.authenticated(); current(); },
      read: async (kind, options) => {
        if (closed || !client) return {available: false, reason: closed ? 'cancelled' : 'not-recipient'};
        return client.read(kind, options);
      },
      cancel: () => client?.cancel(), close, signal: lifetime.signal,
    });
  } catch { close(); throw fail(); }
}
