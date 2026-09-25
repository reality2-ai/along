// Wires automatic signalling to the same invitation proof and enrollment engines
// as manual pairing. The caller owns reviewed invitation/relay consent, expiry,
// comparison UI and durable installation. This module grants no sharing rights.
import {createAutomaticSignalling} from './automatic-signalling.mjs';
import {answerInvitationProof, createInvitationProof} from './invitation-proof.mjs';
import {createEnrollmentSession} from './enrollment-session.mjs';
import {createCoreCandidateSession} from './core-candidate-session.mjs';
import {enrollmentPayloads} from './enrollment-payloads.mjs';
export function createAutomaticEnrollment({role, wasm, store, channel, invitation, reviewed,
  signal, onReady = () => {}, onError = () => {}}) {
  const lifetime = new AbortController();
  let proof, signalling, payloads, peer, closed = false;
  const close = () => {
    if (closed) return; closed = true; lifetime.abort(); proof?.close();
    if (signalling) signalling.close(); else channel?.close();
    signal?.removeEventListener('abort', close);
    reviewed?.signal.removeEventListener('abort', sourceEnded);
    invitation?.signal.removeEventListener('abort', sourceEnded);
  };
  const fail = error => { if (closed) return; close(); try { onError(error); } catch {} };
  const sourceEnded = () => fail(Error('Invitation ended'));
  try {
    if (!['candidate','provisioner'].includes(role)) throw Error('Enrollment role required');
    const sourceSignal = role === 'candidate' ? reviewed?.signal : invitation?.signal;
    if (!sourceSignal || sourceSignal.aborted || signal?.aborted) throw Error('Invitation ended');
    signal?.addEventListener('abort', close, {once:true});
    sourceSignal.addEventListener('abort', sourceEnded, {once:true});
    if (role === 'candidate') proof = createInvitationProof({wasm, reviewed, onExpired:()=>fail(Error('Invitation expired'))});
    signalling = createAutomaticSignalling({role, channel, signal:lifetime.signal,
      answerProof: request => answerInvitationProof(invitation, request),
      verifyProof: response => {
        const verified = proof.verify(response);
        try {
          const certificate = JSON.parse(response).certificate;
          peer = {member:verified.invitation.issuer.slice(),certificate:Uint8Array.from(certificate.match(/../g),b=>parseInt(b,16))};
          return verified;
        } catch (error) { verified.authorized.free(); throw error; }
      },
      discardProof: verified => verified.authorized.free(),
      createSession: async verified => {
        if (role === 'provisioner') {
          const session = await createEnrollmentSession({wasm, store, invitation:invitation.invitation(), role});
          try {
            payloads = enrollmentPayloads({wasm, invitation:invitation.invitation(), epoch:invitation.invitation().epoch, role, session});
            return session;
          } catch (error) { await session.cancel(); throw error; }
        }
        const session = await createCoreCandidateSession({wasm, store, invitation:verified.invitation,
          authorized:verified.authorized, softwareCustody:true, signal:lifetime.signal,
          platform:{candidateDevelopment:false,provisionerDevelopment:false,provisionerHoldsCustody:true,epoch:verified.invitation.epoch}});
        return Object.freeze({...session, cancel:()=>session.dispose()});
      },
      onSession: session => onReady({session,payloads,peer}), onError:fail,
    });
    return Object.freeze({start:()=>role==='candidate' ? signalling.start(proof.request) : Promise.resolve(),close});
  } catch (error) { close(); throw error; }
}
