// Along recovery-only possession proof. Does not grant application access,
// release keys, or advance membership. The caller supplies its real link transcript.
import {loadLocalPersona} from './local-persona.mjs';
import {openMembership} from './membership.mjs';
import {certificateCodec} from './certificate.mjs';
const domain = new TextEncoder().encode('ALNGERC1');
const fixed = (v, n) => v instanceof Uint8Array && v.length === n;
const hex = v => Array.from(v, b => b.toString(16).padStart(2, '0')).join('');
const unhex = v => Uint8Array.from(v.match(/../g), b => parseInt(b, 16));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const fail = () => new Error('Older-device proof unavailable');
function statement(group, owner, peer, from, to, transcript) {
  const out = new Uint8Array(152), view = new DataView(out.buffer);
  out.set(domain); out.set(group, 8); out.set(owner, 40); out.set(peer, 72);
  view.setBigUint64(104, from); view.setBigUint64(112, to); out.set(transcript, 120); return out;
}

export async function createEpochRecoveryChallenge({wasm, store, expectedGroup, peer, certificate, transcript, signal, lifetimeMs = 60000}) {
  if (!fixed(expectedGroup, 32) || !fixed(peer, 32) || !fixed(certificate, 136) || !fixed(transcript, 32)
      || !Number.isFinite(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > 60000) throw fail();
  const group = expectedGroup.slice(), subject = peer.slice(), cert = certificate.slice(), link = transcript.slice();
  let membership, timer, unsubscribe, closed = false, used = false;
  const started = performance.now();
  const close = () => {
    if (closed) return;
    closed = true; clearTimeout(timer); unsubscribe?.(); membership?.close(); signal?.removeEventListener('abort', close);
  };
  const live = () => { if (closed || signal?.aborted || performance.now() < started || performance.now() - started >= lifetimeMs) throw fail(); };
  signal?.addEventListener('abort', close, {once: true});
  try {
    live();
    const owner = await loadLocalPersona({wasm, store, expectedGroup: group});
    if (owner?.origin !== 'initial' || !certificateCodec(wasm).authentic(cert, subject, group)) throw fail();
    const from = new DataView(cert.buffer).getBigUint64(64), to = owner.epoch;
    if (from > to || to === 0n || owner.member === hex(subject)) throw fail();
    membership = openMembership(store, wasm, group, unhex(owner.member));
    const check = async () => {
      live();
      const local = await loadLocalPersona({wasm, store, expectedGroup: group});
      if (local?.origin !== 'initial' || local.member !== owner.member || local.epoch !== to
          || !['current', 'stale'].includes(await membership.peerStatus(cert, subject))) throw fail();
      live();
    };
    unsubscribe = membership.subscribe(close);
    await check();
    const message = statement(group, unhex(owner.member), subject, from, to, link);
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    timer = setTimeout(close, Math.max(1, lifetimeMs - (performance.now() - started)));
    return Object.freeze({statement: () => message.slice(), nonce: () => nonce.slice(), close,
      verify: async signature => {
        if (used) return false;
        used = true;
        let verifier;
        try {
          if (!fixed(signature, 64)) throw fail();
          const proof = signature.slice(); await check();
          // Core signature verification at the certificate's historical epoch,
          // strictly within this recovery challenge. Current issuer standing and
          // removals are checked separately before AND after; no general grant.
          verifier = wasm.BrowserMembership.establish(group, from, 0n);
          if (!verifier.verify_nonce(cert, subject, message, nonce, proof)) throw fail();
          await check(); return true;
        } catch { return false; } finally { verifier?.free(); close(); }
      }});
  } catch { close(); throw fail(); }
}

export async function answerEpochRecoveryChallenge({wasm, store, expectedGroup, statement: input, nonce, transcript, signal}) {
  if (!fixed(expectedGroup, 32) || !fixed(input, 152) || !fixed(nonce, 16) || !fixed(transcript, 32)) throw fail();
  const group = expectedGroup.slice(), message = input.slice(), challenge = nonce.slice(), link = transcript.slice();
  if (signal?.aborted) throw fail();
  const identity = await loadLocalPersona({wasm, store, expectedGroup: group});
  const saved = await store.read('candidate-persona', 'active');
  if (identity?.origin !== 'enrolled' || !fixed(saved?.value?.invitation?.issuer, 32)) throw fail();
  const view = new DataView(message.buffer), from = view.getBigUint64(104), to = view.getBigUint64(112);
  if (from !== identity.epoch || to < from || to === 0n || !same(message,
      statement(group, saved.value.invitation.issuer, unhex(identity.member), from, to, link))) throw fail();
  if (signal?.aborted) throw fail();
  const proof = await identity.sign(wasm.tg_nonce_signing_bytes(message, challenge));
  if (signal?.aborted) throw fail();
  return proof;
}
