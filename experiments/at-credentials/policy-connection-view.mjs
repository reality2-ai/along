// Reconnect previously configured devices. This does not enroll or grant access.
import {showDeviceTransfer} from '../tg-pairing/transfer-view.mjs';
import {loadLocalPersona} from '../tg-pairing/local-persona.mjs';
import {loadATBinding} from './local-owner.mjs';
import {openATPolicySession} from './policy-session.mjs';
const profile = 'along-at-reconnect-v1';
const mounted = new WeakMap();
const unhex = value => Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));

export function showPolicyConnection(container, {wasm, store, expectedGroup, role,
  signal, focus = false, onBack = () => {}, onConnected, fetcher, online, now, timeoutMs} = {}) {
  if (!['owner', 'recipient'].includes(role) || typeof onConnected !== 'function'
      || !(expectedGroup instanceof Uint8Array) || expectedGroup.length !== 32) throw new Error('Connection setup unavailable');
  mounted.get(container)?.();
  const group = expectedGroup.slice(), document = container.ownerDocument;
  const lifetime = new AbortController();
  let disposed = false, handedOff = false, failed = false, session, child;
  const current = () => { if (disposed || failed || lifetime.signal.aborted) throw new Error('Connection ended'); };
  const dispose = () => {
    if (disposed) return;
    disposed = true; child?.dispose();
    signal?.removeEventListener('abort', leave);
    session?.signal.removeEventListener('abort', fail);
    if (!handedOff) { lifetime.abort(); session?.close(); }
    if (mounted.get(container) === dispose) mounted.delete(container);
  };
  const leave = () => { if (!disposed) { dispose(); onBack(); } };
  const screen = () => {
    current(); child?.dispose(); child = undefined;
    const node = document.createElement('div'); container.replaceChildren(node); return node;
  };
  const message = (title, text, connected = false) => {
    const node = screen(), panel = document.createElement('section'); panel.className = 'pairing-comparison';
    const heading = document.createElement('h2'); heading.textContent = title; heading.tabIndex = -1;
    const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = text;
    const back = document.createElement('button'); back.type = 'button'; back.textContent = 'Back'; back.addEventListener('click', leave);
    panel.append(heading, status);
    if (connected) {
      const use = document.createElement('button'); use.type = 'button'; use.className = 'pairing-primary'; use.textContent = 'Use this connection';
      use.addEventListener('click', event => {
        if (!event.isTrusted || disposed || failed || session.signal.aborted) return;
        // Ownership transfers synchronously. The parent must close the controller
        // when finished; disposing this screen afterwards must not close it.
        handedOff = true; dispose();
        try { onConnected(session); } catch { session.close(); }
      });
      panel.append(use);
    }
    panel.append(back); node.append(panel);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); leave(); } });
    if (focus) heading.focus();
  };
  const fail = () => {
    if (disposed || failed || handedOff) return;
    message('Connection unavailable', 'Keep your saved device data and try again with both devices open. Your downloaded journeys are still available.');
    failed = true; lifetime.abort(); session?.close();
  };
  const transfer = options => {
    child = showDeviceTransfer(screen(), {...options, focus, signal: lifetime.signal, onBack: leave,
      onReceive: async text => { try { current(); await options.onReceive(text); current(); } catch (error) { fail(); throw error; } }});
  };
  const watch = async () => {
    try {
      await session.authenticated(); current();
      message('Devices connected', role === 'owner'
        ? 'Keep this device open while your other device checks its existing AT-key permission. Connecting does not grant new access.'
        : 'Your saved AT-key owner has been verified. Live information is checked only when you ask for it.', true);
    } catch { fail(); }
  };
  mounted.set(container, dispose);
  signal?.addEventListener('abort', leave, {once: true});
  const ready = (async () => {
    try {
      if (signal?.aborted) { leave(); return; }
      message('Checking saved devices', 'This reconnects devices already set up to share an AT key.');
      const saved = await loadATBinding({wasm, store, expectedGroup: group, signal: lifetime.signal}); current();
      if (!saved || saved.role !== role) throw new Error('Saved role unavailable');
      const identity = await loadLocalPersona({wasm, store, expectedGroup: group}); current();
      if (!identity) throw new Error('Identity unavailable');
      const open = async peer => {
        session = await openATPolicySession({wasm, store, expectedGroup: group, role, peer,
          signal: lifetime.signal, fetcher, online, now, timeoutMs});
        if (disposed || failed) { session.close(); current(); }
        session.signal.addEventListener('abort', fail, {once: true});
        if (session.signal.aborted) throw new Error('Connection ended');
      };
      if (role === 'recipient') {
        await open();
        const offer = await session.offer(); current();
        transfer({title: 'Connect to your AT-key device', outgoing: JSON.stringify({profile, ...saved.binding, member: identity.member, offer}),
          explanation: 'On the device that shared its AT key, open the existing-device connection screen. Transfer this message and paste its reply here. Messages include connection details that may contain network addresses. Keep both devices open; this exchange lasts one minute.',
          incomingLabel: 'Connection reply', action: 'Connect devices',
          onReceive: async text => { await session.accept(JSON.parse(text)); current(); message('Connecting devices', 'Checking the saved identities on both devices…'); void watch(); }});
      } else {
        transfer({title: 'Connect a device using your AT key', outgoing: '',
          explanation: 'Paste the connection message from a device already set up to use your AT key. Its saved identity and permissions will be checked; this does not share your key with a new device.',
          incomingLabel: 'Connection request', action: 'Prepare connection reply',
          onReceive: async text => {
            const request = JSON.parse(text);
            if (!request || Object.keys(request).sort().join(',') !== 'credential,group,member,offer,owner,profile'
                || request.profile !== profile || typeof request.member !== 'string' || !/^[0-9a-f]{64}$/.test(request.member)
                || ['group', 'owner', 'credential'].some(key => request[key] !== saved.binding[key])) throw new Error('Different saved connection');
            await open(unhex(request.member));
            const reply = await session.accept(request.offer); current();
            transfer({title: 'Reply to your other device', outgoing: JSON.stringify(reply), receive: false,
              explanation: 'Transfer this reply to your other device and choose Connect devices there. Keep this device open. Connection details may include network addresses.',
              action: 'Wait for other device', onReceive: async () => { message('Connecting devices', 'Waiting for your other device to verify its connection…'); }});
            void watch();
          }});
      }
    } catch { fail(); }
  })();
  return Object.freeze({ready, dispose});
}
