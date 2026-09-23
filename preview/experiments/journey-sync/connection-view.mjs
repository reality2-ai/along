import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {openMembership} from '../tg-pairing/membership.mjs';
import {showDeviceTransfer} from '../tg-pairing/transfer-view.mjs';
import {readJourneyPermission} from './permission.mjs';
import {showJourneyPermission} from './permission-view.mjs';
import {openJourneySession} from './journey-session.mjs';
const profile = 'along-journey-connect-v1', mounted = new WeakMap();
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const unhex = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw Error('Device identity unavailable');
  return Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
};
const fields = (value, names) => value && Object.keys(value).sort().join(',') === names.sort().join(',');
export function showJourneyConnection(container, {wasm, store, expectedGroup, role, focus = false,
  signal, onBack = () => {}, onConnected, onSaved}) {
  if (!['start', 'join'].includes(role) || typeof onConnected !== 'function'
      || !(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) throw Error('Journey connection unavailable');
  mounted.get(container)?.();
  const group = expectedGroup.slice(), document = container.ownerDocument, lifetime = new AbortController();
  let disposed = false, failed = false, handedOff = false, child, session, local, own;
  const current = () => { if (disposed || failed || lifetime.signal.aborted) throw Error('Connection ended'); };
  const dispose = () => {
    if (disposed) return; disposed = true; child?.dispose(); signal?.removeEventListener('abort', leave);
    session?.signal.removeEventListener('abort', fail);
    if (!handedOff) { lifetime.abort(); session?.close(); }
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  const leave = () => { if (!disposed) { dispose(); onBack(); } };
  const screen = () => { current(); child?.dispose(); child = undefined; container.replaceChildren(); return container; };
  const message = (title, text, action, run, member) => {
    const target = screen(), panel = document.createElement('section'); panel.className = 'pairing-comparison';
    const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
    const heading = node('h2', title); heading.tabIndex = -1;
    const status = node('p', text); status.setAttribute('role', 'status'); panel.append(heading, status);
    if (action) {
      const button = node('button', action); button.type = 'button'; button.className = 'pairing-primary';
      button.addEventListener('click', event => { if (event.isTrusted && !disposed && !failed && !button.disabled) { button.disabled = true; void Promise.resolve().then(run).catch(fail); } }); panel.append(button);
    }
    const back = node('button', 'Back'); back.type = 'button'; back.addEventListener('click', leave); panel.append(back);
    if (member) { const details = node('details', ''); details.append(node('summary', 'Device identity'), node('p', member)); panel.append(details); }
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); leave(); } });
    target.append(panel); if (focus) heading.focus();
  };
  const fail = () => {
    if (disposed || failed || handedOff) return;
    message('Journey connection unavailable', 'Keep your saved devices and try again with both open. A permission choice may already have been saved; it has not been reset.');
    failed = true; lifetime.abort(); session?.close();
  };
  const transfer = options => {
    child = showDeviceTransfer(screen(), {...options, focus, signal: lifetime.signal, onBack: leave,
      onReceive: async text => { try { current(); await options.onReceive(text); current(); } catch (error) { fail(); throw error; } }});
  };
  const review = async descriptor => {
    if (descriptor.profile !== profile || descriptor.group !== hex(group) || descriptor.member === local.member
        || !Array.isArray(descriptor.certificate) || descriptor.certificate.length !== 136
        || descriptor.certificate.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw Error('Different device');
    const peer = unhex(descriptor.member), certificate = new Uint8Array(descriptor.certificate);
    const held = openMembership(store, wasm, group, own.subject);
    try { if (await held.peerStatus(certificate, peer) !== 'current') throw Error('Unenrolled device'); } finally { held.close(); }
    current();
    const permission = await readJourneyPermission({wasm, store, expectedGroup: group}); current();
    if (permission.peers.includes(descriptor.member)) {
      await new Promise((resolve, reject) => {
        const abort = () => reject(Error('Review ended'));
        lifetime.signal.addEventListener('abort', abort, {once: true});
        message('Reconnect your journey-sharing device?', 'This device already has your saved permission. Connect only if this is the device you intend to use.', 'Connect this device', () => {
          lifetime.signal.removeEventListener('abort', abort); resolve();
        }, descriptor.member);
      });
    } else {
      child = showJourneyPermission(screen(), {wasm, store, expectedGroup: group, peer, certificate, focus, onBack: leave});
      await child.completed;
    }
    current(); return peer;
  };
  const open = async (peer, sessionRole) => {
    session = await openJourneySession({wasm, store, expectedGroup: group, peer, role: sessionRole, signal: lifetime.signal, onSaved});
    if (disposed || failed) { session.close(); current(); }
    session.signal.addEventListener('abort', fail, {once: true});
    if (session.signal.aborted) throw Error('Connection ended');
  };
  const watch = async () => {
    try {
      await session.authenticated(); current();
      message('Journey devices connected', 'Both enrolled identities and local sharing permission have been checked. No saved journeys have been sent by this setup screen.', 'Use journey connection', () => {
        current(); if (session.signal.aborted) throw Error('Connection ended');
        handedOff = true; dispose(); try { onConnected(session); } catch { session.close(); }
      });
    } catch { fail(); }
  };
  mounted.set(container, dispose); signal?.addEventListener('abort', leave, {once: true});
  const ready = (async () => {
    try {
      if (signal?.aborted) { leave(); return; }
      message('Checking this device', 'Connect devices already enrolled in the same group. AT-key setup is not needed.');
      local = await loadLocalPersona({wasm, store, expectedGroup: group}); current();
      if (!local) throw Error('Identity unavailable');
      own = (await store.read('candidate-persona', 'active'))?.value?.record; current();
      if (!own) throw Error('Identity unavailable');
      const descriptor = {profile, group: hex(group), member: local.member, certificate: [...own.certificate]};
      if (role === 'start') transfer({title: 'Connect your journey-sharing device', outgoing: JSON.stringify(descriptor),
        explanation: 'On your other enrolled device, choose Join journey connection. Transfer this device message, then paste its connection request here. Saved addresses are not included in these messages.',
        incomingLabel: 'Journey connection request', action: 'Review journey device', onReceive: async text => {
          const request = JSON.parse(text);
          if (!fields(request, ['profile', 'group', 'member', 'certificate', 'for', 'offer']) || request.for !== local.member) throw Error('Different request');
          const peer = await review(request); await open(peer, 'answer');
          const answer = await session.accept(request.offer); current();
          transfer({title: 'Send the journey connection reply', outgoing: JSON.stringify({profile, group: hex(group), from: local.member, to: request.member, answer}), receive: false,
            explanation: 'Transfer this reply to your other device and keep both open. Connection messages may contain network addresses; the exchange lasts one minute.',
            action: 'Wait for other device', onReceive: async () => message('Connecting journey devices', 'Waiting for your other device…')});
          void watch();
        }});
      else transfer({title: 'Join journey connection', outgoing: '',
        explanation: 'Paste the message from your other enrolled device. You will review journey-sharing permission before connecting.',
        incomingLabel: 'Journey device message', action: 'Review journey device', onReceive: async text => {
          const remote = JSON.parse(text);
          if (!fields(remote, ['profile', 'group', 'member', 'certificate'])) throw Error('Invalid device message');
          const peer = await review(remote); await open(peer, 'offer');
          const offer = await session.offer(); current();
          transfer({title: 'Send the journey connection request', outgoing: JSON.stringify({...descriptor, for: remote.member, offer}),
            explanation: 'Transfer this request to your other device and paste its reply here. Connection details may include network addresses. Keep both devices open; this exchange lasts one minute.',
            incomingLabel: 'Journey connection reply', action: 'Connect journey devices', onReceive: async text => {
              const reply = JSON.parse(text);
              if (!fields(reply, ['profile', 'group', 'from', 'to', 'answer']) || reply.profile !== profile
                  || reply.group !== hex(group) || reply.from !== remote.member || reply.to !== local.member) throw Error('Different reply');
              await session.accept(reply.answer); current(); message('Connecting journey devices', 'Checking the enrolled identities…'); void watch();
            }});
        }});
    } catch { fail(); }
  })();
  return Object.freeze({ready, dispose});
}
