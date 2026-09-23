// Reconnect using installed custody and local membership evidence. Signaling,
// peer selection and fresh group policy remain runtime responsibilities.
import {loadLocalPersona} from './local-persona.mjs';
import {openMembership} from './membership.mjs';
import {createPeerSession} from './peer-session.mjs';

export async function openLocalPersonaSession({wasm, store, expectedGroup, peer, role, signal}) {
  if (!(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32
      || !(peer instanceof Uint8Array) || peer.length !== 32
      || !['offer', 'answer'].includes(role)) throw new Error('Peer context unavailable');
  const group = expectedGroup.slice(), remote = peer.slice();
  let membership, session, ended = false;
  const dispose = () => {
    ended = true; signal?.removeEventListener('abort', dispose);
    const heldSession = session, heldMembership = membership;
    session = undefined; membership = undefined;
    try { heldSession?.close(); } finally { heldMembership?.close(); }
  };
  const current = () => { if (ended || signal?.aborted) throw new Error('Peer setup ended'); };
  signal?.addEventListener('abort', dispose, {once: true});
  try {
    current();
    const identity = await loadLocalPersona({wasm, store, expectedGroup: group}); current();
    if (!identity) throw new Error('Installed identity unavailable');
    const saved = await store.read('candidate-persona', 'active'); current();
    const record = saved?.value?.record;
    if (!record) throw new Error('Installed identity unavailable');
    membership = openMembership(store, wasm, group, record.subject);
    const context = await membership.sessionContext(); current();
    session = createPeerSession({wasm, role, group, epoch: context.epoch,
      local: context.subject, peer: remote, certificate: record.certificate,
      identity: {publicId: identity.member, sign: identity.sign}, membership,
      onClose: dispose});
    current(); return session;
  } catch (error) { dispose(); throw error; }
}
