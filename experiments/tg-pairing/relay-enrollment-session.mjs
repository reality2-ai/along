// Adapted from the MIT-licensed public R2 browser subset (82377f1).
// Along relay transport adaptation; see RELAY_ENROLLMENT.md.
// Owns the live comparison and durable invitation reservation. This does not
// establish initial trust, validate invitation expiry, install a persona, or
// authorize secrets. The enclosing ceremony must establish those facts.
import {createEnrollmentLink} from './relay-enrollment-link.mjs';
import {reserveInvitation} from './invitation-journal.mjs';
import {invitationStatement} from './invitation.mjs';

export async function createEnrollmentSession({wasm, invitation, role, store, candidateCeremony, createPeerLink}) {
  const expected = structuredClone(invitation);
  if (!['candidate', 'provisioner'].includes(role) || expected?.role !== 'member') throw new Error('Invalid enrollment role');
  invitationStatement(wasm, expected);
  const reservation = await reserveInvitation(store, expected.group, expected.code);
  let link, voiding, consuming;
  const voidInvitation = () => {
    // Once an installation is submitted, its transaction owns the outcome.
    // The link signal aborts pending storage; a completed commit stays consumed.
    if (consuming) {
      if (!voiding) { voiding = consuming.then(() => undefined); void voiding.catch(() => {}); }
      return voiding;
    }
    if (!voiding) {
      voiding = reservation.void();
      // Keep the rejection observable to cancel(), without an unhandled task.
      void voiding.catch(() => {});
    }
    return voiding;
  };
  try { link = createEnrollmentLink({wasm, invitation: expected, role, candidateCeremony, createPeerLink}); }
  catch (error) { await voidInvitation(); throw error; }
  link.signal.addEventListener('abort', voidInvitation, {once: true});
  if (link.signal.aborted) voidInvitation();
  const cancel = async () => { link.close(); await voidInvitation(); };
  return Object.freeze({
    offer: link.offer, accept: link.accept, comparison: link.comparison,
    confirmed: link.confirmed, state: link.state, signal: link.signal,
    // Transport of opaque, bounded payloads only; the ceremony controller owns
    // semantic validation and authorization before sending or installing them.
    sendClaim: link.sendClaim, claim: link.claim,
    sendBundle: link.sendBundle, bundle: link.bundle,
    sendInstalled: value => {
      if (role !== 'candidate' || reservation.state() !== 'consumed') throw new Error('Local commit required');
      return link.sendInstalled(value);
    },
    installed: link.installed, sendAcknowledged: link.sendAcknowledged, acknowledged: link.acknowledged,
    decide: async (matched, signal) => {
      if (signal?.aborted) { await cancel(); throw new Error('Comparison view ended'); }
      // Disposing/replacing the actual confirmation view also ends its session,
      // even if the first click has already sent a confirmation to the peer.
      const abort = () => { void cancel().catch(() => {}); };
      signal?.addEventListener('abort', abort, {once: true});
      link.signal.addEventListener('abort', () => signal?.removeEventListener('abort', abort), {once: true});
      try {
        link.decide(matched);
        if (!matched) await voidInvitation();
        else await link.confirmed();
      } catch (error) { await cancel(); throw error; }
    },
    consume: changes => {
      if (role !== 'candidate' || consuming || link.state() !== 'comparison-confirmed') throw new Error('Installation unavailable');
      consuming = reservation.consumeWith(changes, {signal: link.signal});
      void consuming.catch(() => {});
      return consuming;
    },
    recordPeerInstallation: async changes => {
      if (role !== 'provisioner') throw new Error('Wrong receipt role');
      await link.installed();
      if (consuming || link.state() !== 'comparison-confirmed') throw new Error('Peer installation unavailable');
      // Caller verifies receipt semantics before supplying this public record.
      consuming = reservation.consumeWith(changes, {signal: link.signal});
      void consuming.catch(() => {});
      return consuming;
    },
    cancel,
    invitationState: reservation.state,
  });
}
