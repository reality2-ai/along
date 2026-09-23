import {openLocalPersonaSession} from '../tg-pairing/local-persona-session.mjs';
import {openPermittedJourneys} from './permission.mjs';
import {createJourneyExchange} from './exchange.mjs';
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');

// A dedicated journey channel: no AT-key permission or provider request involved.
// Signaling and deliberate application consent are supplied by the enclosing UI.
export async function openJourneySession({wasm, store, expectedGroup, peer, role, signal, timeoutMs}) {
  const group = expectedGroup.slice(), selectedPeer = peer.slice(), lifetime = new AbortController();
  let session, exchange, closed = false, queue = Promise.resolve();
  const close = () => {
    if (closed) return;
    closed = true; lifetime.abort(); signal?.removeEventListener('abort', close); exchange?.close(); session?.close();
  };
  const current = () => { if (closed) throw Error('Journey connection unavailable'); };
  signal?.addEventListener('abort', close, {once: true});
  if (signal?.aborted) close();
  try {
    current();
    const journeys = await openPermittedJourneys({wasm, store, expectedGroup: group, peer: selectedPeer}); current();
    session = await openLocalPersonaSession({wasm, store, expectedGroup: group, peer: selectedPeer, role,
      signal: lifetime.signal, onMessage: async packet => {
        current(); await journeys.check(); current(); await exchange.receive(packet);
      }});
    if (closed) { session.close(); current(); }
    session.signal.addEventListener('abort', close, {once: true});
    if (session.signal.aborted) close();
    current();
    exchange = createJourneyExchange({group: hex(group), timeoutMs, signal: lifetime.signal, onClose: close,
      send: async packet => { await journeys.check(); current(); await session.send(packet); },
      commit: (snapshot, options) => journeys.merge(snapshot, options)});
    return Object.freeze({
      offer: () => { current(); return session.offer(); },
      accept: description => { current(); return session.accept(description); },
      authenticated: async () => { current(); await session.authenticated(); current(); await journeys.check(); },
      synchronize() {
        const operation = queue.then(async () => {
          current(); await session.authenticated(); current();
          return exchange.sendSnapshot(await journeys.snapshot());
        }).catch(error => { close(); throw error; });
        queue = operation.catch(() => {}); return operation;
      },
      close, signal: lifetime.signal,
    });
  } catch { close(); throw Error('Journey connection unavailable'); }
}
