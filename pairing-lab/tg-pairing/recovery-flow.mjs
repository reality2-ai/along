// Resume installation confirmation only; never re-enroll or grant secret access.
import {showDeviceTransfer} from './transfer-view.mjs';
import {loadLocalPersona} from './local-persona.mjs';
import {openLocalPersonaSession} from './local-persona-session.mjs';
import {openReceiptRecovery, answerReceiptRecovery} from './receipt-recovery.mjs';
const profile = 'along-installation-recovery-v1';
const unhex = text => Uint8Array.from(text.match(/../g), byte => parseInt(byte, 16));
export function showRecoveryFlow(container, {wasm, store, expectedGroup, role, focus = false, onBack = () => {}}) {
  if (!['candidate', 'provisioner'].includes(role)) throw new Error('Recovery role required');
  const document = container.ownerDocument, lifetime = new AbortController(), views = [];
  let disposed = false, complete = false, session, answering = false;
  const current = () => { if (disposed || lifetime.signal.aborted) throw new Error('Recovery ended'); };
  const stop = () => {
    if (disposed) return;
    disposed = true; lifetime.abort(); session?.close(); views.forEach(view => view.dispose());
  };
  const leave = () => { stop(); onBack(); };
  const screen = () => { current(); const node = document.createElement('div'); container.replaceChildren(node); return node; };
  const message = (title, text) => {
    const node = screen(), panel = document.createElement('section'); panel.className = 'pairing-comparison';
    const heading = document.createElement('h2'); heading.textContent = title; heading.tabIndex = -1;
    const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = text;
    const back = document.createElement('button'); back.type = 'button'; back.textContent = 'Back'; back.addEventListener('click', leave);
    panel.append(heading, status, back); node.append(panel); if (focus) heading.focus();
  };
  const fail = () => {
    if (disposed || complete) return;
    complete = true;
    message('Confirmation is still unverified', 'Keep this device’s saved data. Go Back and retry with the device that invited it. This attempt did not replace its identity or grant access to an AT key.');
    lifetime.abort(); session?.close();
  };
  const transfer = options => {
    const view = showDeviceTransfer(screen(), {...options, focus, signal: lifetime.signal, onBack: leave,
      onReceive: async text => { try { current(); await options.onReceive(text); } catch (error) { fail(); throw error; } }});
    views.push(view);
  };
  const ready = (async () => {
    try {
      message('Checking saved device data', 'Keep both devices open. This only checks confirmation of a previously saved installation.');
      const identity = await loadLocalPersona({wasm, store, expectedGroup}); current();
      if (!identity) throw new Error('Identity unavailable');
      if (role === 'candidate') {
        if (identity.origin !== 'enrolled' || identity.peerAcknowledged) throw new Error('Recovery not needed');
        session = await openReceiptRecovery({wasm, store, expectedGroup, signal: lifetime.signal});
        if (disposed) { session.close(); return; }
        void session.completed.then(() => {
          if (disposed || complete) return;
          complete = true;
          message('Installation confirmed', 'This device saved confirmation from the device that invited it. Its identity was preserved. Journey sharing and AT-key access still require their own setup.');
        }, fail);
        const offer = await session.offer(); current();
        transfer({title: 'Recover installation confirmation',
          explanation: 'On the device that invited this one, choose Confirm an interrupted connection. Transfer this message, then paste its reply here. Connection details may include network addresses. Keep both devices ready; this exchange lasts one minute.',
          outgoing: JSON.stringify({profile, member: identity.member, offer}), incomingLabel: 'Recovery reply from your other device', action: 'Check installation confirmation',
          onReceive: async text => {
            await session.accept(JSON.parse(text)); current();
            if (!complete) message('Checking installation confirmation', 'Keep both devices open while their saved identities and installation record are checked.');
          }});
      } else {
        transfer({title: 'Confirm an interrupted connection',
          explanation: 'Paste the recovery message from the device you previously invited. This checks its saved installation; it cannot enroll a new device or share an AT key.', outgoing: '',
          incomingLabel: 'Recovery message from your other device', action: 'Prepare recovery reply',
          onReceive: async text => {
            const request = JSON.parse(text);
            if (!request || Object.keys(request).length !== 3 || request.profile !== profile || typeof request.member !== 'string' || !/^[0-9a-f]{64}$/.test(request.member)) throw new Error('Recovery message unavailable');
            const peer = unhex(request.member), local = unhex(identity.member);
            session = await openLocalPersonaSession({wasm, store, expectedGroup, peer, role: 'answer', signal: lifetime.signal,
              onMessage: async bytes => {
                if (answering || complete) throw new Error('Recovery already answered');
                answering = true;
                try {
                  await answerReceiptRecovery({wasm, store, group: expectedGroup, local, peer, connection: session}, bytes); current();
                  complete = true;
                  message('Installation confirmation sent', 'The saved installation matched. Check the other device for Installation confirmed before closing this screen. Sending a reply does not prove it was saved there.');
                } catch (error) { fail(); throw error; }
              }});
            if (disposed) { session.close(); return; }
            session.signal.addEventListener('abort', fail, {once: true});
            if (session.signal.aborted) throw new Error('Connection ended');
            const answer = await session.accept(request.offer); current();
            transfer({title: 'Send the recovery reply', explanation: 'Transfer this reply to your other device, then keep this screen open. Its installed key and the saved receipt must match before confirmation can be sent.',
              outgoing: JSON.stringify(answer), receive: false, action: 'Wait for the other device',
              onReceive: async () => { if (!complete) message('Waiting for your other device', 'Paste the reply there and choose Check installation confirmation. Keep both screens open.'); }});
          }});
      }
    } catch { fail(); }
  })();
  return Object.freeze({ready, dispose: stop});
}
