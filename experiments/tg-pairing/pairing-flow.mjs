// Explicit browser-software subset, verified inviter epoch. Manual public-message
// transport, actual R2 verification and WebRTC enrollment; no relay service.
import {showReceiveInvitation} from './receive-invitation-view.mjs';
import {showDeviceTransfer} from './transfer-view.mjs';
import {showComparison} from './comparison.mjs';
import {createSoftwareInvitation} from './software-invitation.mjs';
import {createInvitationProof, answerInvitationProof} from './invitation-proof.mjs';
import {createCoreCandidateSession} from './core-candidate-session.mjs';
import {createEnrollmentSession} from './enrollment-session.mjs';
import {enrollmentPayloads} from './enrollment-payloads.mjs';
const mounted = new WeakMap();
export function showPairingFlow(container, {wasm, store, role, expectedGroup, focus = false, onBack = () => {}}) {
  if (!['candidate', 'provisioner'].includes(role)) throw new Error('Pairing role required');
  mounted.get(container)?.();
  const document = container.ownerDocument, lifetime = new AbortController(), views = [];
  let disposed = false, completed = false, session, invitation, proof, payloads, installation, acknowledgment, localInstalled = false;
  const current = () => { if (disposed || lifetime.signal.aborted) throw new Error('Pairing ended'); };
  const stop = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); invitation?.close(); proof?.close();
    for (const view of views) view.dispose();
    void session?.cancel?.().catch(() => {}); void session?.dispose?.().catch(() => {});
    if (mounted.get(container) === stop) mounted.delete(container);
  };
  mounted.set(container, stop);
  const leave = () => { if (!disposed) { stop(); onBack(); } };
  const screen = (terminal = false) => { if (disposed) throw new Error('Pairing view closed'); if (!terminal) current(); const node = document.createElement('div'); container.replaceChildren(node); return node; };
  const message = (title, text, terminal = false) => {
    const node = screen(terminal), panel = document.createElement('section'); panel.className = 'pairing-comparison';
    const heading = document.createElement('h2'); heading.textContent = title; heading.tabIndex = -1;
    const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = text;
    const back = document.createElement('button'); back.type = 'button'; back.textContent = 'Back'; back.addEventListener('click', leave);
    panel.append(heading, status, back); node.append(panel); if (focus) heading.focus();
  };
  const fail = () => {
    if (disposed || completed) return;
    completed = true;
    message('Checking saved device state', 'The connection ended. Checking whether this device finished saving before it closed.');
    lifetime.abort(); invitation?.close(); proof?.close();
    void session?.cancel?.().catch(() => {}); void session?.dispose?.().catch(() => {});
    // A completed atomic commit can be delivered after the connection aborts.
    // Settle those operations before choosing recovery versus a fresh invitation.
    void (async () => {
      if (installation) {
        try { await installation; localInstalled = true; } catch { /* no successful commit reported */ }
      }
      let acknowledged = false;
      if (acknowledgment) {
        try { await acknowledgment; acknowledged = true; } catch { /* keep local installation */ }
      }
      if (disposed) return;
      if (acknowledged) message('Device connected', 'This device saved its group membership and confirmation before the connection ended.', true);
      else message(localInstalled ? 'Device group saved locally' : 'Connection did not finish', localInstalled
        ? 'This device joined the group, but confirmation from the other device was not completed. Keep the saved device data for recovery.'
        : 'Go Back and start a new invitation with both devices ready. Your downloaded journeys are still available.', true);
    })();
  };
  const watchSession = () => {
    session.signal.addEventListener('abort', fail, {once: true});
    if (disposed || lifetime.signal.aborted) {
      void session.cancel?.().catch(() => {}); void session.dispose?.().catch(() => {});
      current();
    }
    if (session.signal.aborted) throw new Error('Connection ended');
  };
  const transfer = options => {
    const view = showDeviceTransfer(screen(), {...options, focus, signal: lifetime.signal, onBack: leave,
      onReceive: async (text, signal) => {
        try { current(); await options.onReceive(text, signal); current(); }
        catch (error) { fail(); throw error; }
      }});
    views.push(view); return view;
  };
  const compare = async () => {
    message('Connecting to your other device', 'Keep both devices open while the comparison code is prepared.');
    const code = await session.comparison(); current();
    const view = showComparison(screen(), {code, focus, signal: lifetime.signal, onDecision: async (matched, signal) => {
      try {
        await session.decide(matched, signal); current();
        if (!matched) { fail(); return; }
        message('Saving your device connection', 'Keep both devices open until this step finishes.');
        if (role === 'candidate') {
          await session.sendClaim(); current();
          installation = session.installLocal();
          await installation; localInstalled = true; current();
          acknowledgment = session.acknowledgeInstallation();
          await acknowledgment; current();
          completed = true;
          message('Device connected', 'This device joined the group and received confirmation. Sharing journeys or an AT key still needs its own setup.');
        } else {
          const subject = await payloads.claim(); current();
          const material = await invitation.enrollmentMaterial(subject);
          try { current(); await payloads.sendBundle(material); } finally { material.destroy(); }
          invitation.signal.removeEventListener('abort', fail); invitation.close();
          await payloads.acknowledgeInstalled(); current(); completed = true;
          message('Other device installed', 'The other device saved its group membership. Confirmation was sent; check its screen before closing this one.');
        }
      } catch { fail(); }
    }}); views.push(view);
  };
  const start = async () => {
    try {
      if (role === 'provisioner') {
        message('Preparing an invitation', 'Keep both devices ready. The invitation stays open for up to one minute.');
        invitation = await createSoftwareInvitation({wasm, store, expectedGroup, signal: lifetime.signal}); current();
        invitation.signal.addEventListener('abort', fail, {once: true});
        transfer({title: 'Invite your other device', explanation: 'Copy this invitation into Along on your other device. Then paste the challenge it gives you here.',
          outgoing: invitation.descriptor, incomingLabel: 'Challenge from your other device', action: 'Create device reply', onReceive: async request => {
            const response = await answerInvitationProof(invitation, request); current();
            session = await createEnrollmentSession({wasm, store, invitation: invitation.invitation(), role}); watchSession(); current();
            payloads = enrollmentPayloads({wasm, invitation: invitation.invitation(), epoch: invitation.invitation().epoch, role, session});
            transfer({title: 'Send your device reply', explanation: 'Copy this reply to your other device. It will give you connection details to paste here.', outgoing: response,
              incomingLabel: 'Connection details from your other device', action: 'Prepare connection', onReceive: async text => {
                const answer = await session.accept(JSON.parse(text)); current();
                transfer({title: 'Send the connection reply', explanation: 'Copy these connection details back to your other device, then continue to compare codes. Connection details may include network addresses.',
                  outgoing: JSON.stringify(answer), receive: false, action: 'Compare device codes', onReceive: compare});
              }});
          }});
      } else {
        const review = showReceiveInvitation(screen(), {focus, onBack: leave}); views.push(review);
        const reviewed = await review.completed; current();
        proof = createInvitationProof({wasm, reviewed});
        transfer({title: 'Check your other device', explanation: 'Copy this challenge to your other device, then paste its reply here.', outgoing: proof.request,
          onReceive: async response => {
            const verified = proof.verify(response);
            session = await createCoreCandidateSession({wasm, store, invitation: verified.invitation, authorized: verified.authorized,
              softwareCustody: true, signal: lifetime.signal,
              platform: {candidateDevelopment: false, provisionerDevelopment: false, provisionerHoldsCustody: true, epoch: verified.invitation.epoch}}); watchSession(); current();
            const offer = await session.offer(); current();
            transfer({title: 'Send connection details', explanation: 'Copy these details to your other device, then paste its connection reply here. Connection details may include network addresses.',
              outgoing: JSON.stringify(offer), incomingLabel: 'Connection reply from your other device', action: 'Compare device codes',
              onReceive: async text => { await session.accept(JSON.parse(text)); current(); await compare(); }});
          }});
      }
    } catch { fail(); }
  };
  const ready = start();
  return Object.freeze({ready, dispose: stop});
}
