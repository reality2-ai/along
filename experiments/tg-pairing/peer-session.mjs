// Along application handshake over a direct encrypted browser channel.
// Authenticates possession against held TG state, NOT application-secret rights
// or globally fresh revocation/epoch knowledge. Pairing inputs must be trusted.
import {createPeerLink} from './peer-link.mjs';
import {issuePeerChallenge} from './challenge.mjs';
import {sessionStatement} from './session-statement.mjs';
import {certificateCodec} from './certificate.mjs';
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const encode = bytes => Array.from(bytes);
const decode = (value, length) => {
  if (!Array.isArray(value) || value.length !== length || !value.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) throw new Error('Invalid peer evidence');
  return new Uint8Array(value);
};
const fields = (frame, names) => frame && !Array.isArray(frame) && typeof frame === 'object'
  && Object.keys(frame).length === names.length && names.every(name => Object.hasOwn(frame, name));
export function createPeerSession({role, group, epoch, local, peer, identity, certificate, membership, wasm, onClose = () => {}, onMessage}) {
  // Validate and snapshot all caller-controlled identity context before async work.
  const binding = structuredClone({group, epoch, verifier: local, prover: peer, transcript: new Uint8Array(32)});
  sessionStatement(binding);
  if (identity.publicId !== hex(binding.verifier) || !(certificate instanceof Uint8Array) || certificate.length !== 136) throw new Error('Invalid local session identity');
  const localCertificate = certificate.slice();
  if (!certificateCodec(wasm).authentic(localCertificate, binding.verifier, binding.group)) throw new Error('Local certificate does not match session context');
  let closed = false, challenge, unsubscribe, timer, link;
  const lifetime = new AbortController();
  let peerCertificate, sentSequence = 0, receivedSequence = 0, sending = Promise.resolve();
  let responded = false, verified = false, readySent = false, peerReady = false;
  let challengeSeen = false, proofSeen = false, readySeen = false, authenticated = false;
  let resolveAuthentication, rejectAuthentication;
  const result = new Promise((resolve, reject) => { resolveAuthentication = resolve; rejectAuthentication = reject; });
  // Callers may still be exchanging descriptions when an early failure occurs.
  void result.catch(() => {});
  const close = () => {
    if (closed) return;
    closed = true; authenticated = false; clearTimeout(timer); challenge?.cancel(); unsubscribe?.(); link?.close();
    lifetime.abort();
    rejectAuthentication(new Error('Peer authentication unavailable'));
    try { onClose(); } catch {}
  };
  const current = async () => {
    if (closed) throw new Error('Peer membership unavailable');
    const context = await membership.sessionContext();
    if (closed || context.epoch !== binding.epoch || hex(context.group) !== hex(binding.group)
        || hex(context.subject) !== hex(binding.verifier)) throw new Error('Peer membership context changed');
    if (peerCertificate && await membership.peerStatus(peerCertificate, binding.prover) !== 'current') throw new Error('Peer membership changed');
    if (closed) throw new Error('Peer session closed');
  };
  const send = frame => { if (closed) throw new Error('Peer session closed'); link.send(JSON.stringify(frame)); };
  const advance = async () => {
    await current();
    if (responded && verified && !readySent) { send({type: 'ready'}); readySent = true; }
    if (readySent && peerReady && !authenticated) { authenticated = true; clearTimeout(timer); resolveAuthentication(); }
  };
  let initialized;
  const receive = async text => {
    await initialized;
    await current();
    const frame = JSON.parse(text);
    if (frame.type === 'challenge' && fields(frame, ['type', 'nonce']) && !challengeSeen) {
      challengeSeen = true;
      const nonce = decode(frame.nonce, 16);
      // Never sign a peer-supplied arbitrary statement. Reconstruct our own role.
      const statement = sessionStatement({...binding, verifier: binding.prover, prover: binding.verifier});
      const signature = await identity.sign(wasm.tg_nonce_signing_bytes(statement, nonce));
      await current();
      send({type: 'proof', certificate: encode(localCertificate), signature: encode(signature)});
      responded = true;
    } else if (frame.type === 'proof' && fields(frame, ['type', 'certificate', 'signature']) && !proofSeen) {
      proofSeen = true;
      const cert = decode(frame.certificate, 136);
      if (!await challenge.verify(cert, decode(frame.signature, 64))) throw new Error('Peer proof refused');
      peerCertificate = cert;
      verified = true;
    } else if (frame.type === 'ready' && fields(frame, ['type']) && verified && !readySeen) {
      readySeen = true; peerReady = true;
    } else if (frame.type === 'application' && authenticated && typeof onMessage === 'function'
        && fields(frame, ['type', 'sequence', 'value']) && Number.isSafeInteger(frame.sequence)
        && frame.sequence === receivedSequence + 1 && Array.isArray(frame.value)
        && frame.value.length > 0 && frame.value.length <= 2048) {
      const value = decode(frame.value, frame.value.length);
      receivedSequence = frame.sequence; await current();
      await onMessage(value, lifetime.signal); await current();
    } else throw new Error('Unexpected peer session message');
    await advance();
  };
  let queue = Promise.resolve();
  link = createPeerLink({role, onClose: close, onMessage: text => {
    queue = queue.then(() => receive(text)).catch(close);
  }});
  try { unsubscribe = membership.subscribe(close); } catch (error) { close(); throw error; }
  timer = setTimeout(close, 60000);
  initialized = (async () => {
    await link.opened(); await current();
    binding.transcript = await link.transcript(); await current();
    challenge = issuePeerChallenge(membership, binding.prover, sessionStatement(binding));
    send({type: 'challenge', nonce: encode(challenge.nonce())});
  })();
  void initialized.catch(close);
  return Object.freeze({
    offer: link.offer,
    accept: link.accept,
    authenticated: async () => {
      try { await result; await current(); } catch (error) { close(); throw error; }
    },
    send: value => {
      if (!authenticated || closed || !(value instanceof Uint8Array) || !value.length || value.length > 2048) return Promise.reject(new Error('Application message unavailable'));
      const snapshot = value.slice();
      const operation = sending.then(async () => {
        try {
          await current();
          if (!authenticated || sentSequence === Number.MAX_SAFE_INTEGER) throw new Error('Application session unavailable');
          send({type: 'application', sequence: ++sentSequence, value: encode(snapshot)});
        } catch (error) { close(); throw error; }
        finally { snapshot.fill(0); }
      });
      sending = operation.catch(() => {});
      return operation;
    },
    signal: lifetime.signal,
    // Informational only; application access must apply its own current policy.
    state: () => closed ? 'closed' : authenticated ? 'authenticated' : 'authenticating',
    close,
  });
}
