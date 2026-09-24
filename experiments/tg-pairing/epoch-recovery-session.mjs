// Recovery-only mutual identity over the real direct WebRTC transcript.
// Only ordered epoch recovery and signed installation receipts are carried.
import {createPeerLink} from './peer-link.mjs';
import {loadLocalPersona} from './local-persona.mjs';
import {openMembership} from './membership.mjs';
import {watchLocalEpoch} from './epoch-watch.mjs';
import {createEpochRecoveryChallenge, answerEpochRecoveryChallenge} from './epoch-recovery-proof.mjs';
import {loadSoftwareTraffic} from './software-traffic.mjs';
import {verifyEpochTransition} from './epoch-transition.mjs';
import {installRecipientEpoch} from './epoch-installation.mjs';
import {recoveryReceiptStatement, saveRecoveryReceipt} from './epoch-recovery-receipt.mjs';
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
  let accepted = false, recipientAccepted = false, busy = false, pending, progress, confirmationChecked = false;
  const lifetime = new AbortController();
  const started = performance.now();
  let deadline = started + 60000;
  const live = () => {
    if (closed || signal?.aborted || ((phase !== 'authenticated' || busy)
        && (performance.now() < started || performance.now() >= deadline))) throw Error('Recovery ended');
  };
  let resolve, reject, installedResolve, installedReject, acceptedResolve, acceptedReject;
  const acceptance = new Promise((yes, no) => { acceptedResolve = yes; acceptedReject = no; });
  void acceptance.catch(() => {});
  const installation = new Promise((yes, no) => { installedResolve = yes; installedReject = no; });
  void installation.catch(() => {});
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  void result.catch(() => {});
  const close = () => {
    if (closed) return;
    closed = true; phase = 'closed'; clearTimeout(timer); challenge?.close(); watcher?.close(); unsubscribe?.();
    signal?.removeEventListener('abort', close); link?.close(); membership?.close(); lifetime.abort();
    reject(Error('Recovery connection ended'));
    acceptedReject(Error('Recipient acceptance unavailable'));
    installedReject(Error('Local installation was not confirmed by this connection'));
    pending?.reject(Error('Recovery interrupted; installation may already be saved'));
  };
  const current = async () => {
    live();
    const local = await loadLocalPersona({wasm, store, expectedGroup: group});
    if (local?.member !== identity.member || local.epoch !== identity.epoch || local.origin !== identity.origin) throw Error('Recovery identity changed');
    if (role === 'owner' && !['current', 'stale'].includes(await membership.peerStatus(peerCertificate, remote))) throw Error('Recovery peer removed');
    live();
  };
  const send = frame => { if (closed) throw Error('Recovery ended'); link.send(JSON.stringify(frame)); };
  const authenticated = () => { phase = 'authenticated'; progress = from; clearTimeout(timer); resolve(); };
  const boundOperation = () => { deadline = performance.now() + 60000; clearTimeout(timer); timer = setTimeout(close, 60000); };
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
      if (from > to || to === 0n) throw Error('Peer recovery epoch unavailable');
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
      } else if (role === 'owner' && phase === 'authenticated' && frame.type === 'accept-recovery' && fields(frame, ['type']) && !recipientAccepted) {
        recipientAccepted = true; acceptedResolve();
      } else if (role === 'recipient' && phase === 'authenticated' && accepted && frame.type === 'epoch'
          && fields(frame, ['type', 'epoch', 'transition', 'certificate', 'payload', 'integrity', 'nonce'])
          && frame.epoch === String(identity.epoch + 1n) && identity.epoch < to) {
        const epoch = identity.epoch + 1n, memberId = identity.member, transition = decode(frame.transition, 152), certificate = decode(frame.certificate, 136);
        const payloadKey = decode(frame.payload, 32), integrityKey = decode(frame.integrity, 32), nonce = decode(frame.nonce, 16);
        try {
          boundOperation(); phase = 'installing';
          // This recovery connection alone survives its expected installation so
          // it can acknowledge the commit. Other old-epoch sessions still close.
          watcher.close();
          await installRecipientEpoch({wasm, store, expectedGroup: group, transition, certificate, payloadKey, integrityKey, signal: lifetime.signal});
          identity = await loadLocalPersona({wasm, store, expectedGroup: group}); live();
          if (identity?.epoch !== epoch || identity.member !== memberId || identity.origin !== 'enrolled') throw Error('Installed recovery identity differs');
          watcher = watchLocalEpoch({store, group, subject: unhex(identity.member), epoch, onChange: close});
          await watcher.check(); await current();
          if (epoch === to) installedResolve(Object.freeze({status: 'installed-local', epoch}));
          const receipt = await recoveryReceiptStatement({group, subject: unhex(identity.member), epoch, transition, certificate});
          const proof = await identity.sign(wasm.tg_nonce_signing_bytes(receipt, nonce)); await current();
          phase = 'authenticated'; clearTimeout(timer); send({type: 'installed', epoch: String(epoch), proof: Array.from(proof)});
        } finally { payloadKey.fill(0); integrityKey.fill(0); frame.payload.fill(0); frame.integrity.fill(0); }
      } else if (role === 'recipient' && phase === 'authenticated' && accepted && frame.type === 'receipt-request'
          && fields(frame, ['type', 'epoch', 'nonce']) && frame.epoch === String(identity.epoch) && identity.epoch === to) {
        const epoch = identity.epoch, nonce = decode(frame.nonce, 16);
        boundOperation(); phase = 'checking-installation';
        const saved = await store.read('along-installed-epoch-v1', hex(group) + ':' + epoch);
        if (saved?.value?.format !== 1) throw Error('Saved installation receipt unavailable');
        const {transition, certificate} = saved.value;
        const material = await loadSoftwareTraffic({wasm, store, expectedGroup: group, signal: lifetime.signal});
        try {
          // The duplicate path verifies the receipt against current identity and
          // decrypted keys, without rewriting any installation record.
          const installed = await installRecipientEpoch({wasm, store, expectedGroup: group, transition, certificate,
            payloadKey: material.payloadKey, integrityKey: material.integrityKey, signal: lifetime.signal});
          if (!installed.alreadyInstalled || installed.epoch !== epoch) throw Error('Saved installation differs');
        } finally { material.destroy(); }
        await current();
        installedResolve(Object.freeze({status: 'installed-local', epoch}));
        const receipt = await recoveryReceiptStatement({group, subject: unhex(identity.member), epoch, transition, certificate});
        const proof = await identity.sign(wasm.tg_nonce_signing_bytes(receipt, nonce)); await current();
        phase = 'authenticated'; clearTimeout(timer); send({type: 'installed', epoch: String(epoch), proof: Array.from(proof)});
      } else if (role === 'owner' && phase === 'waiting-install' && frame.type === 'installed'
          && fields(frame, ['type', 'epoch', 'proof']) && frame.epoch === String(pending?.epoch)) {
        await current();
        await saveRecoveryReceipt({wasm, store, group, subject: remote, ...pending,
          signature: decode(frame.proof, 64), signal: lifetime.signal});
        await current(); progress = pending.epoch; phase = 'authenticated'; clearTimeout(timer);
        const complete = pending.resolve; pending = undefined; complete();
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
    const controller = Object.freeze({offer: link.offer, accept: link.accept, close, signal: lifetime.signal,
      state: () => phase,
      installation: async () => {
        if (role !== 'recipient') throw Error('Local recipient installation unavailable');
        return installation;
      },
      accepted: async () => {
        if (role !== 'owner') throw Error('Remote acceptance unavailable');
        await acceptance; await current();
      },
      canRecover: () => role === 'owner' && phase === 'authenticated' && recipientAccepted && !busy,
      acceptRecovery: async () => {
        if (role !== 'recipient' || phase !== 'authenticated') throw Error('Recovery review unavailable');
        await current(); if (!accepted) { accepted = true; send({type: 'accept-recovery'}); }
      },
      recover: async () => {
        if (role !== 'owner' || phase !== 'authenticated' || !recipientAccepted || busy) throw Error('Recovery is not ready');
        busy = true; boundOperation();
        try {
          await current();
          if (from === to && !confirmationChecked) {
            const prepared = await store.read('along-prepared-epoch-v1', hex(group) + ':' + to);
            const transition = prepared?.value?.transition;
            await verifyEpochTransition({bytes: transition, expectedGroup: group, currentEpoch: to - 1n});
            await current();
            const receipt = new Promise((resolve, reject) => {
              pending = {epoch: to, transition, certificate: peerCertificate,
                nonce: crypto.getRandomValues(new Uint8Array(16)), resolve, reject};
            });
            void receipt.catch(() => {}); phase = 'waiting-install';
            send({type: 'receipt-request', epoch: String(to), nonce: Array.from(pending.nonce)});
            await receipt; confirmationChecked = true;
          }
          while (progress < to) {
            const epoch = progress + 1n;
            const material = await controller.recoveryMaterial(epoch);
            try {
              await current(); boundOperation();
              const receipt = new Promise((resolve, reject) => {
                pending = {epoch, transition: material.transition, certificate: material.certificate,
                  nonce: crypto.getRandomValues(new Uint8Array(16)), resolve, reject};
              });
              void receipt.catch(() => {});
              phase = 'waiting-install';
              const frame = {type: 'epoch', epoch: String(epoch), transition: Array.from(material.transition), certificate: Array.from(material.certificate),
                payload: Array.from(material.payloadKey), integrity: Array.from(material.integrityKey), nonce: Array.from(pending.nonce)};
              try { send(frame); } finally { frame.payload.fill(0); frame.integrity.fill(0); material.destroy(); }
              await receipt;
            } finally { material.destroy(); }
          }
          return Object.freeze({status: 'peer-installation-confirmed', epoch: progress});
        } catch (error) { close(); throw error; }
        finally { busy = false; clearTimeout(timer); }
      },
      recoveryMaterial: async epoch => {
        let issuer, material;
        try {
          if (role !== 'owner' || phase !== 'authenticated' || typeof epoch !== 'bigint' || epoch <= from || epoch > to) throw Error('Recovery material not authorized');
          await current();
          const {loadSoftwareIssuer} = await import('./software-persona.mjs');
          issuer = await loadSoftwareIssuer({wasm, store, expectedGroup: group, signal: lifetime.signal});
          material = await issuer.recoveryMaterial({subject: remote, certificate: peerCertificate, epoch});
          await current(); return material;
        } catch (error) { material?.destroy(); throw error; }
        finally { issuer?.close(); }
      },
      authenticated: async () => {
        try { await result; await current(); return Object.freeze({from, to}); }
        catch (error) { close(); throw error; }
      }});
    return controller;
  } catch (error) { close(); throw error; }
}
