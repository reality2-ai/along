// Recovery-only mutual identity over the real direct WebRTC transcript.
// No application payload or key delivery API is exposed by this stage.
import {createPeerLink} from './peer-link.mjs';
import {loadLocalPersona} from './local-persona.mjs';
import {openMembership} from './membership.mjs';
import {watchLocalEpoch} from './epoch-watch.mjs';
import {createEpochRecoveryChallenge, answerEpochRecoveryChallenge} from './epoch-recovery-proof.mjs';
const fixed = (v, n) => v instanceof Uint8Array && v.length === n;
const hex = v => Array.from(v, b => b.toString(16).padStart(2, '0')).join('');
const unhex = v => Uint8Array.from(v.match(/../g), b => parseInt(b, 16));
const decode = (v, n) => {
  if (!Array.isArray(v) || v.length !== n || !v.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) throw Error('Invalid recovery message');
  return new Uint8Array(v);
};
const fields = (v, keys) => v && !Array.isArray(v) && Object.keys(v).sort().join(',') === keys.sort().join(',');
const ownerStatement = message => { const value = message.slice(); value.set(new TextEncoder().encode('ALNGERO1')); return value; };

export async function openEpochRecoverySession({wasm, store, expectedGroup, role, peer, certificate, signal}) {
  if (!['owner', 'recipient'].includes(role) || !fixed(expectedGroup, 32) || !fixed(peer, 32)
      || (role === 'owner' && !fixed(certificate, 136))) throw Error('Recovery context unavailable');
  const group = expectedGroup.slice(), remote = peer.slice(), peerCertificate = certificate?.slice();
  let closed = false, phase = 'opening', link, membership, watcher, unsubscribe, timer, challenge, transcript;
  let identity, memberStatement, ownerNonce, from, to, ready, queue = Promise.resolve();
  const lifetime = new AbortController();
  const started = performance.now();
  const live = () => {
    if (closed || signal?.aborted || (phase !== 'authenticated'
        && (performance.now() < started || performance.now() - started >= 60000))) throw Error('Recovery ended');
  };
  let resolve, reject;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  void result.catch(() => {});
  const close = () => {
    if (closed) return;
    closed = true; phase = 'closed'; clearTimeout(timer); challenge?.close(); watcher?.close(); unsubscribe?.();
    signal?.removeEventListener('abort', close); link?.close(); membership?.close(); lifetime.abort();
    reject(Error('Recovery connection ended'));
  };
  const current = async () => {
    live();
    const local = await loadLocalPersona({wasm, store, expectedGroup: group});
    if (local?.member !== identity.member || local.epoch !== identity.epoch || local.origin !== identity.origin) throw Error('Recovery identity changed');
    if (role === 'owner' && !['current', 'stale'].includes(await membership.peerStatus(peerCertificate, remote))) throw Error('Recovery peer removed');
    live();
  };
  const send = frame => { if (closed) throw Error('Recovery ended'); link.send(JSON.stringify(frame)); };
  const authenticated = () => { phase = 'authenticated'; clearTimeout(timer); resolve(); };
  signal?.addEventListener('abort', close, {once: true});
  try {
    if (signal?.aborted) throw Error('Recovery cancelled');
    identity = await loadLocalPersona({wasm, store, expectedGroup: group});
    live();
    if (!identity || identity.origin !== (role === 'owner' ? 'initial' : 'enrolled')) throw Error('Recovery role unavailable');
    const saved = await store.read('candidate-persona', 'active');
    live();
    if (role === 'recipient' && hex(saved.value.invitation.issuer) !== hex(remote)) throw Error('Different saved issuer');
    membership = openMembership(store, wasm, group, unhex(identity.member));
    unsubscribe = membership.subscribe(close);
    watcher = watchLocalEpoch({store, group, subject: unhex(identity.member), epoch: identity.epoch, onChange: close});
    await watcher.check(); await current();
    if (role === 'owner') {
      from = new DataView(peerCertificate.buffer).getBigUint64(64); to = identity.epoch;
      if (from >= to) throw Error('Peer does not need older-epoch recovery');
    }
    const receive = async text => {
      await ready; await current();
      const frame = JSON.parse(text);
      if (role === 'recipient' && phase === 'waiting-member-challenge' && frame.type === 'member-challenge'
          && fields(frame, ['type', 'statement', 'nonce'])) {
        memberStatement = decode(frame.statement, 152);
        const proof = await answerEpochRecoveryChallenge({wasm, store, expectedGroup: group, statement: memberStatement,
          nonce: decode(frame.nonce, 16), transcript, signal: lifetime.signal});
        from = identity.epoch; to = new DataView(memberStatement.buffer).getBigUint64(112);
        ownerNonce = crypto.getRandomValues(new Uint8Array(16)); await current();
        phase = 'waiting-owner-proof'; send({type: 'member-proof', proof: Array.from(proof), nonce: Array.from(ownerNonce)});
      } else if (role === 'owner' && phase === 'waiting-member-proof' && frame.type === 'member-proof'
          && fields(frame, ['type', 'proof', 'nonce'])) {
        if (!await challenge.verify(decode(frame.proof, 64))) throw Error('Member recovery proof refused');
        await current(); ownerNonce = decode(frame.nonce, 16);
        const local = await store.read('candidate-persona', 'active');
        const proof = await identity.sign(wasm.tg_nonce_signing_bytes(ownerStatement(memberStatement), ownerNonce));
        await current(); phase = 'waiting-ready';
        send({type: 'owner-proof', certificate: Array.from(local.value.record.certificate), proof: Array.from(proof)});
      } else if (role === 'recipient' && phase === 'waiting-owner-proof' && frame.type === 'owner-proof'
          && fields(frame, ['type', 'certificate', 'proof'])) {
        const cert = decode(frame.certificate, 136), proof = decode(frame.proof, 64);
        const held = await store.read('membership', hex(group));
        // Future-epoch verifier is scoped to this proof; local membership is not advanced.
        const verifier = wasm.BrowserMembership.establish(group, to, 0n);
        try {
          for (const r of held.value.revocations) if (!verifier.apply_revocation(r.subject, r.epoch, r.sequence, r.reason, r.signature)) throw Error('Invalid held removal');
          if (!verifier.verify_nonce(cert, remote, ownerStatement(memberStatement), ownerNonce, proof)) throw Error('Issuer recovery proof refused');
        } finally { verifier.free(); }
        await current(); phase = 'waiting-ready'; send({type: 'ready'});
      } else if (phase === 'waiting-ready' && frame.type === 'ready' && fields(frame, ['type'])) {
        await current(); if (role === 'owner') send({type: 'ready'}); authenticated();
      } else throw Error('Unexpected recovery message');
    };
    link = createPeerLink({role: role === 'owner' ? 'answer' : 'offer', onClose: close,
      onMessage: text => { queue = queue.then(() => receive(text)).catch(close); }});
    timer = setTimeout(close, 60000);
    ready = (async () => {
      await link.opened(); await current(); transcript = await link.transcript(); await current();
      if (role === 'owner') {
        const created = await createEpochRecoveryChallenge({wasm, store, expectedGroup: group, peer: remote,
          certificate: peerCertificate, transcript, signal: lifetime.signal});
        if (closed) { created.close(); throw Error('Recovery ended'); }
        challenge = created; await current();
        memberStatement = challenge.statement(); phase = 'waiting-member-proof';
        send({type: 'member-challenge', statement: Array.from(memberStatement), nonce: Array.from(challenge.nonce())});
      } else phase = 'waiting-member-challenge';
    })();
    void ready.catch(close);
    return Object.freeze({offer: link.offer, accept: link.accept, close, signal: lifetime.signal,
      state: () => phase,
      authenticated: async () => {
        try { await result; await current(); return Object.freeze({from, to}); }
        catch (error) { close(); throw error; }
      }});
  } catch (error) { close(); throw error; }
}
